// Wiederholungsregeln (RRULE, RFC 5545) für Kalendertermine.
// Rechnet in Tagesnummern; die Uhrzeit übernimmt der Aufrufer vom Termin-Beginn.

import { dayNumber, fromDayNumber, weekdayOf, daysInMonth } from './tz.js';

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MAX_PERIODS = 100000;

export function parseRRule(value) {
  const rule = { freq: null, interval: 1, count: null, until: null, byDay: null, byMonthDay: null, byMonth: null, bySetPos: null, byYearDay: null, wkst: 1 };
  for (const part of String(value).split(';')) {
    const [rawKey, rawVal = ''] = part.split('=');
    const key = rawKey.trim().toUpperCase();
    const val = rawVal.trim();
    const ints = () => val.split(',').map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n) && n !== 0);
    switch (key) {
      case 'FREQ': rule.freq = val.toUpperCase(); break;
      case 'INTERVAL': rule.interval = Math.max(1, parseInt(val, 10) || 1); break;
      case 'COUNT': rule.count = Math.max(0, parseInt(val, 10) || 0); break;
      case 'UNTIL': rule.until = val; break;
      case 'BYDAY':
        rule.byDay = val.split(',').map((v) => {
          const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(v.trim());
          return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WEEKDAYS[m[2].toUpperCase()] } : null;
        }).filter(Boolean);
        break;
      case 'BYMONTHDAY': rule.byMonthDay = ints(); break;
      case 'BYMONTH': rule.byMonth = ints().filter((n) => n >= 1 && n <= 12); break;
      case 'BYSETPOS': rule.bySetPos = ints(); break;
      case 'BYYEARDAY': rule.byYearDay = ints(); break;
      case 'WKST': if (WEEKDAYS[val.toUpperCase()] !== undefined) rule.wkst = WEEKDAYS[val.toUpperCase()]; break;
      default: break;
    }
  }
  return rule;
}

function monthDayCandidates(y, m, rule, startDay) {
  const dim = daysInMonth(y, m);
  const first = dayNumber(y, m, 1);
  let byMonthDays = null;
  let byDays = null;
  if (rule.byMonthDay && rule.byMonthDay.length) {
    byMonthDays = rule.byMonthDay.map((d) => (d < 0 ? dim + 1 + d : d)).filter((d) => d >= 1 && d <= dim).map((d) => first + d - 1);
  }
  if (rule.byDay && rule.byDay.length) {
    byDays = [];
    for (const { n, wd } of rule.byDay) {
      const matches = [];
      for (let d = 0; d < dim; d++) if (weekdayOf(first + d) === wd) matches.push(first + d);
      if (n === 0) byDays.push(...matches);
      else {
        const pick = n > 0 ? matches[n - 1] : matches[matches.length + n];
        if (pick !== undefined) byDays.push(pick);
      }
    }
  }
  if (byMonthDays && byDays) return byMonthDays.filter((dn) => byDays.includes(dn));
  if (byMonthDays) return byMonthDays;
  if (byDays) return byDays;
  return startDay <= dim ? [first + startDay - 1] : [];
}

function yearCandidates(y, rule, start) {
  const out = [];
  if (rule.byMonth && rule.byMonth.length) {
    for (const m of rule.byMonth) out.push(...monthDayCandidates(y, m, rule, start.d));
    return out;
  }
  if (rule.byYearDay && rule.byYearDay.length) {
    const first = dayNumber(y, 1, 1);
    const len = dayNumber(y + 1, 1, 1) - first;
    for (const n of rule.byYearDay) {
      const idx = n > 0 ? n - 1 : len + n;
      if (idx >= 0 && idx < len) out.push(first + idx);
    }
    return out;
  }
  if (rule.byMonthDay && rule.byMonthDay.length) {
    for (let m = 1; m <= 12; m++) out.push(...monthDayCandidates(y, m, { byMonthDay: rule.byMonthDay, byDay: rule.byDay }, start.d));
    return out;
  }
  if (rule.byDay && rule.byDay.length) {
    const first = dayNumber(y, 1, 1);
    const len = dayNumber(y + 1, 1, 1) - first;
    for (const { n, wd } of rule.byDay) {
      const matches = [];
      for (let i = 0; i < len; i++) if (weekdayOf(first + i) === wd) matches.push(first + i);
      if (n === 0) out.push(...matches);
      else {
        const pick = n > 0 ? matches[n - 1] : matches[matches.length + n];
        if (pick !== undefined) out.push(pick);
      }
    }
    return out;
  }
  if (start.m === 2 && start.d === 29 && daysInMonth(y, 2) < 29) return [];
  return [dayNumber(y, start.m, start.d)];
}

function applySetPos(candidates, setPos) {
  if (!setPos || !setPos.length || !candidates.length) return candidates;
  const out = [];
  for (const pos of setPos) {
    const pick = pos > 0 ? candidates[pos - 1] : candidates[candidates.length + pos];
    if (pick !== undefined) out.push(pick);
  }
  return out;
}

function passesFilters(dn, rule) {
  const { m, d, y } = fromDayNumber(dn);
  if (rule.byMonth && rule.byMonth.length && !rule.byMonth.includes(m)) return false;
  if (rule.byMonthDay && rule.byMonthDay.length) {
    const dim = daysInMonth(y, m);
    if (!rule.byMonthDay.some((x) => (x < 0 ? dim + 1 + x : x) === d)) return false;
  }
  if (rule.byDay && rule.byDay.length && !rule.byDay.some((b) => b.wd === weekdayOf(dn))) return false;
  return true;
}

/**
 * Liefert die Tagesnummern aller Wiederholungen ab dem Startdatum (aufsteigend),
 * bis zur Tagesnummer `limitDn`. Der Start selbst wird nicht mitgeliefert.
 */
export function* recurrenceDays(rule, startDn, limitDn) {
  const start = fromDayNumber(startDn);
  const interval = rule.interval || 1;
  let periods = 0;
  const emit = function* (cands) {
    const sorted = [...new Set(cands)].sort((a, b) => a - b);
    for (const dn of applySetPos(sorted, rule.bySetPos)) if (dn > startDn) yield dn;
  };

  switch (rule.freq) {
    case 'DAILY':
      for (let dn = startDn; dn <= limitDn && periods < MAX_PERIODS; dn += interval, periods++) {
        if (passesFilters(dn, rule)) yield* emit([dn]);
      }
      return;
    case 'WEEKLY': {
      const wkst = rule.wkst ?? 1;
      const weekStart0 = startDn - ((weekdayOf(startDn) - wkst + 7) % 7);
      const days = rule.byDay && rule.byDay.length ? rule.byDay.map((b) => b.wd) : [weekdayOf(startDn)];
      const offsets = [...new Set(days.map((wd) => (wd - wkst + 7) % 7))].sort((a, b) => a - b);
      for (let ws = weekStart0; ws <= limitDn && periods < MAX_PERIODS; ws += 7 * interval, periods++) {
        const cands = offsets.map((o) => ws + o).filter((dn) => !rule.byMonth || !rule.byMonth.length || rule.byMonth.includes(fromDayNumber(dn).m));
        yield* emit(cands);
      }
      return;
    }
    case 'MONTHLY': {
      const startIndex = start.y * 12 + (start.m - 1);
      for (let i = 0; periods < MAX_PERIODS; i++, periods++) {
        const idx = startIndex + i * interval;
        const y = Math.floor(idx / 12);
        const m = (idx % 12) + 1;
        if (dayNumber(y, m, 1) > limitDn) return;
        if (rule.byMonth && rule.byMonth.length && !rule.byMonth.includes(m)) continue;
        yield* emit(monthDayCandidates(y, m, rule, start.d));
      }
      return;
    }
    case 'YEARLY':
      for (let i = 0; periods < MAX_PERIODS; i++, periods++) {
        const y = start.y + i * interval;
        if (dayNumber(y, 1, 1) > limitDn) return;
        yield* emit(yearCandidates(y, rule, start));
      }
      return;
    default:
      return; // HOURLY/MINUTELY usw. werden nicht unterstützt -> nur der erste Termin
  }
}
