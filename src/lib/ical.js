// iCalendar (RFC 5545): lesen, Termine im Zeitraum berechnen, neue Termine schreiben.

import { parseRRule, recurrenceDays } from './rrule.js';
import { zonedToMs, resolveTimeZone, dayNumber, fromDayNumber, isoDate, wallParts } from './tz.js';

// ---------- Parser ----------

function splitOutsideQuotes(str, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of str) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseLine(line) {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = splitOutsideQuotes(head, ';');
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value, rawHead: head };
}

export function parseICS(text) {
  const unfolded = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const root = { name: 'ROOT', props: [], components: [] };
  const stack = [root];
  for (const line of unfolded.split('\n')) {
    if (!line.trim()) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    const top = stack[stack.length - 1];
    if (prop.name === 'BEGIN') {
      const comp = { name: prop.value.trim().toUpperCase(), props: [], components: [] };
      top.components.push(comp);
      stack.push(comp);
    } else if (prop.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      top.props.push(prop);
    }
  }
  return root;
}

export const getProp = (comp, name) => comp.props.find((p) => p.name === name) || null;
export const getProps = (comp, name) => comp.props.filter((p) => p.name === name);

export function findComponents(comp, name, out = []) {
  for (const c of comp.components) {
    if (c.name === name) out.push(c);
    findComponents(c, name, out);
  }
  return out;
}

export function unescapeText(value) {
  return String(value || '').replace(/\\([nN,;\\])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// ---------- Datumswerte ----------

// Liefert { date: true, y, m, d } oder { date: false, y, m, d, h, mi, s, tz }
export function parseDateValue(raw, params = {}, defaultTz = 'UTC') {
  const v = String(raw || '').trim();
  const dm = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dm || params.VALUE === 'DATE') {
    const m = dm || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { date: true, y: +m[1], m: +m[2], d: +m[3] };
  }
  const tm = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!tm) return null;
  const tz = tm[7] ? 'UTC' : resolveTimeZone(params.TZID, defaultTz);
  return { date: false, y: +tm[1], m: +tm[2], d: +tm[3], h: +tm[4], mi: +tm[5], s: +(tm[6] || 0), tz };
}

export function dateValueToMs(dv, defaultTz) {
  if (!dv) return null;
  if (dv.date) return zonedToMs(dv.y, dv.m, dv.d, 0, 0, 0, defaultTz);
  return zonedToMs(dv.y, dv.m, dv.d, dv.h, dv.mi, dv.s, dv.tz || defaultTz);
}

function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = m.slice(2).map((x) => Number(x || 0));
  return sign * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

function multiDateValues(props, defaultTz) {
  const out = [];
  for (const p of props) {
    for (const part of p.value.split(',')) {
      const dv = parseDateValue(part, p.params, defaultTz);
      if (dv) out.push(dv);
    }
  }
  return out;
}

// ---------- Termine berechnen ----------

function baseInfo(vevent) {
  const text = (name) => {
    const p = getProp(vevent, name);
    return p ? unescapeText(p.value) : '';
  };
  return {
    uid: text('UID'),
    title: text('SUMMARY') || '(ohne Titel)',
    location: text('LOCATION'),
    notes: text('DESCRIPTION'),
    status: (getProp(vevent, 'STATUS')?.value || '').toUpperCase(),
    url: text('URL'),
  };
}

function eventTimes(vevent, defaultTz) {
  const dtStartProp = getProp(vevent, 'DTSTART');
  if (!dtStartProp) return null;
  const start = parseDateValue(dtStartProp.value, dtStartProp.params, defaultTz);
  if (!start) return null;
  const dtEndProp = getProp(vevent, 'DTEND');
  const durProp = getProp(vevent, 'DURATION');
  let end = dtEndProp ? parseDateValue(dtEndProp.value, dtEndProp.params, defaultTz) : null;
  let durationMs;
  let durationDays = 1;
  if (start.date) {
    if (end && end.date) durationDays = Math.max(1, dayNumber(end.y, end.m, end.d) - dayNumber(start.y, start.m, start.d));
    else if (durProp) durationDays = Math.max(1, Math.round((parseDuration(durProp.value) || 86400000) / 86400000));
    end = null;
  } else {
    const startMs = dateValueToMs(start, defaultTz);
    if (end) durationMs = Math.max(0, dateValueToMs(end, defaultTz) - startMs);
    else if (durProp) durationMs = Math.max(0, parseDuration(durProp.value) || 0);
    else durationMs = 0;
  }
  return { start, durationMs, durationDays };
}

function makeOccurrence(info, times, startDv, defaultTz, extra = {}) {
  if (startDv.date) {
    const dn = dayNumber(startDv.y, startDv.m, startDv.d);
    const endDay = fromDayNumber(dn + times.durationDays);
    return {
      ...info,
      allDay: true,
      startDate: isoDate(startDv.y, startDv.m, startDv.d),
      endDate: isoDate(endDay.y, endDay.m, endDay.d),
      startMs: zonedToMs(startDv.y, startDv.m, startDv.d, 0, 0, 0, defaultTz),
      endMs: zonedToMs(endDay.y, endDay.m, endDay.d, 0, 0, 0, defaultTz),
      ...extra,
    };
  }
  const startMs = dateValueToMs(startDv, defaultTz);
  return { ...info, allDay: false, startMs, endMs: startMs + times.durationMs, ...extra };
}

function overlaps(occ, rangeStart, rangeEnd) {
  if (occ.endMs === occ.startMs) return occ.startMs >= rangeStart && occ.startMs < rangeEnd;
  return occ.startMs < rangeEnd && occ.endMs > rangeStart;
}

function occurrenceKey(dv, defaultTz) {
  return dv.date ? `d${dayNumber(dv.y, dv.m, dv.d)}` : `t${dateValueToMs(dv, defaultTz)}`;
}

/**
 * Alle Termine einer .ics-Datei im Zeitraum [rangeStart, rangeEnd) (ms).
 * Berücksichtigt Wiederholungen, Ausnahmen (EXDATE) und geänderte Einzeltermine.
 */
export function eventsInRange(ics, rangeStart, rangeEnd, defaultTz = 'UTC') {
  const root = typeof ics === 'string' ? parseICS(ics) : ics;
  const vevents = findComponents(root, 'VEVENT');
  const byUid = new Map();
  for (const ev of vevents) {
    const uid = getProp(ev, 'UID')?.value || `ohne-uid-${byUid.size}`;
    if (!byUid.has(uid)) byUid.set(uid, { master: null, overrides: [] });
    const group = byUid.get(uid);
    if (getProp(ev, 'RECURRENCE-ID')) group.overrides.push(ev);
    else if (!group.master) group.master = ev;
  }

  const result = [];
  for (const { master, overrides } of byUid.values()) {
    const overrideMap = new Map();
    for (const ov of overrides) {
      const rid = getProp(ov, 'RECURRENCE-ID');
      const dv = parseDateValue(rid.value, rid.params, defaultTz);
      if (dv) overrideMap.set(occurrenceKey(dv, defaultTz), ov);
    }
    const used = new Set();
    const pushOverride = (ov, key) => {
      used.add(key);
      const times = eventTimes(ov, defaultTz);
      if (!times) return;
      const info = baseInfo(ov);
      if (info.status === 'CANCELLED') return;
      const occ = makeOccurrence(info, times, times.start, defaultTz, { recurring: true, occurrenceKey: key });
      if (overlaps(occ, rangeStart, rangeEnd)) result.push(occ);
    };

    if (master) {
      const info = baseInfo(master);
      const times = eventTimes(master, defaultTz);
      if (times && info.status !== 'CANCELLED') {
        const rruleProp = getProp(master, 'RRULE');
        const rdates = multiDateValues(getProps(master, 'RDATE'), defaultTz);
        if (!rruleProp && !rdates.length) {
          const occ = makeOccurrence(info, times, times.start, defaultTz, { recurring: false });
          if (overlaps(occ, rangeStart, rangeEnd)) result.push(occ);
        } else {
          const exKeys = new Set(multiDateValues(getProps(master, 'EXDATE'), defaultTz).map((dv) => occurrenceKey(dv, defaultTz)));
          const s = times.start;
          const startDn = dayNumber(s.y, s.m, s.d);
          const tz = s.date ? defaultTz : s.tz || defaultTz;
          const pe = wallParts(rangeEnd, tz);
          const rangeEndDn = dayNumber(pe.y, pe.m, pe.d) + 1;
          const starts = [s];
          if (rruleProp) {
            const rule = parseRRule(rruleProp.value);
            let untilMs = Infinity;
            if (rule.until) {
              const u = parseDateValue(rule.until, {}, tz);
              if (u) untilMs = u.date ? zonedToMs(u.y, u.m, u.d, 23, 59, 59, tz) : dateValueToMs(u, tz);
            }
            let count = 1;
            for (const dn of recurrenceDays(rule, startDn, rangeEndDn)) {
              if (rule.count && count >= rule.count) break;
              const day = fromDayNumber(dn);
              const dv = s.date ? { date: true, ...day } : { date: false, ...day, h: s.h, mi: s.mi, s: s.s, tz: s.tz };
              const ms = dateValueToMs(dv, defaultTz);
              if (ms > untilMs) break;
              starts.push(dv);
              count++;
            }
          }
          for (const dv of rdates) starts.push(dv);
          for (const dv of starts) {
            const key = occurrenceKey(dv, defaultTz);
            if (exKeys.has(key) || used.has(key)) continue;
            if (overrideMap.has(key)) {
              pushOverride(overrideMap.get(key), key);
              continue;
            }
            used.add(key);
            const occ = makeOccurrence(info, times, dv, defaultTz, { recurring: true, occurrenceKey: key });
            if (overlaps(occ, rangeStart, rangeEnd)) result.push(occ);
          }
        }
      }
    }
    // Verschobene Einzeltermine, deren ursprünglicher Termin außerhalb des Zeitraums lag
    for (const [key, ov] of overrideMap) if (!used.has(key)) pushOverride(ov, key);
  }
  result.sort((a, b) => a.startMs - b.startMs);
  return result;
}

// ---------- Schreiben ----------

const pad = (n) => String(n).padStart(2, '0');

export function formatUtc(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

export function formatDate(isoDateStr) {
  return isoDateStr.replace(/-/g, '');
}

function foldLine(line) {
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function serializeComponent(comp) {
  const lines = [];
  const walk = (c) => {
    if (c.name !== 'ROOT') lines.push(`BEGIN:${c.name}`);
    for (const p of c.props) lines.push(foldLine(`${p.rawHead ?? p.name}:${p.value}`));
    for (const child of c.components) walk(child);
    if (c.name !== 'ROOT') lines.push(`END:${c.name}`);
  };
  walk(comp);
  return lines.join('\r\n') + '\r\n';
}

export function setProp(comp, name, value, params = {}) {
  comp.props = comp.props.filter((p) => p.name !== name);
  if (value === null || value === undefined) return;
  const paramStr = Object.entries(params).map(([k, v]) => `;${k}=${v}`).join('');
  comp.props.push({ name, params, value, rawHead: `${name}${paramStr}` });
}

/**
 * Zeitangaben eines Termins setzen.
 * timed: { allDay: false, startMs, endMs } – wird in UTC geschrieben
 * ganztägig: { allDay: true, startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' (exklusiv) }
 */
export function setEventTimes(vevent, t) {
  vevent.props = vevent.props.filter((p) => !['DTSTART', 'DTEND', 'DURATION'].includes(p.name));
  if (t.allDay) {
    setProp(vevent, 'DTSTART', formatDate(t.startDate), { VALUE: 'DATE' });
    setProp(vevent, 'DTEND', formatDate(t.endDate), { VALUE: 'DATE' });
  } else {
    setProp(vevent, 'DTSTART', formatUtc(t.startMs));
    setProp(vevent, 'DTEND', formatUtc(t.endMs));
  }
}

export function buildEvent({ uid, title, location, notes, times, nowMs = Date.now() }) {
  const root = { name: 'ROOT', props: [], components: [] };
  const cal = { name: 'VCALENDAR', props: [], components: [] };
  setProp(cal, 'VERSION', '2.0');
  setProp(cal, 'PRODID', '-//Assistent-Agent//DE');
  setProp(cal, 'CALSCALE', 'GREGORIAN');
  const ev = { name: 'VEVENT', props: [], components: [] };
  setProp(ev, 'UID', uid);
  setProp(ev, 'DTSTAMP', formatUtc(nowMs));
  setProp(ev, 'CREATED', formatUtc(nowMs));
  setProp(ev, 'LAST-MODIFIED', formatUtc(nowMs));
  setEventTimes(ev, times);
  setProp(ev, 'SUMMARY', escapeText(title));
  if (location) setProp(ev, 'LOCATION', escapeText(location));
  if (notes) setProp(ev, 'DESCRIPTION', escapeText(notes));
  setProp(ev, 'SEQUENCE', '0');
  cal.components.push(ev);
  root.components.push(cal);
  return serializeComponent(root);
}

export function findMasterEvent(root) {
  return findComponents(root, 'VEVENT').find((e) => !getProp(e, 'RECURRENCE-ID')) || null;
}

export function isRecurringResource(root) {
  return findComponents(root, 'VEVENT').some((e) => getProp(e, 'RRULE') || getProp(e, 'RDATE') || getProp(e, 'RECURRENCE-ID'));
}

export function touchEvent(vevent, nowMs = Date.now()) {
  const seq = parseInt(getProp(vevent, 'SEQUENCE')?.value || '0', 10) || 0;
  setProp(vevent, 'SEQUENCE', String(seq + 1));
  setProp(vevent, 'DTSTAMP', formatUtc(nowMs));
  setProp(vevent, 'LAST-MODIFIED', formatUtc(nowMs));
}
