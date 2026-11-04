// Zeitzonen-Hilfen ohne externe Pakete (nutzt Intl, das in Node eingebaut ist).

const formatters = new Map();

function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

// Wanduhrzeit (Jahr, Monat, Tag, Stunde ...) eines Zeitpunkts in einer Zeitzone.
export function wallParts(ms, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const out = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

export function offsetMs(ms, timeZone) {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = wallParts(whole, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - whole;
}

// Wanduhrzeit in einer Zeitzone -> Zeitpunkt (ms seit 1970, UTC).
export function zonedToMs(y, m, d, h = 0, mi = 0, s = 0, timeZone = 'UTC') {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  if (timeZone === 'UTC') return guess;
  const off1 = offsetMs(guess, timeZone);
  let ms = guess - off1;
  const off2 = offsetMs(ms, timeZone);
  if (off2 !== off1) ms = guess - off2;
  return ms;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function isoDate(y, m, d) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseIsoDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function todayIso(timeZone, now = Date.now()) {
  const p = wallParts(now, timeZone);
  return isoDate(p.y, p.m, p.d);
}

export function nowWall(timeZone, now = Date.now()) {
  const p = wallParts(now, timeZone);
  return { date: isoDate(p.y, p.m, p.d), time: `${pad(p.h)}:${pad(p.mi)}`, ...p };
}

export function addDaysIso(dateStr, days) {
  const p = parseIsoDate(dateStr);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function dayStartMs(dateStr, timeZone) {
  const p = parseIsoDate(dateStr);
  return zonedToMs(p.y, p.m, p.d, 0, 0, 0, timeZone);
}

// "2026-11-05T09:30" (Wanduhrzeit) -> ms
export function localDateTimeToMs(str, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(str || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map((v) => (v === undefined ? 0 : Number(v)));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedToMs(y, mo, d, h, mi, s || 0, timeZone);
}

export function msToLocalIso(ms, timeZone) {
  const p = wallParts(ms, timeZone);
  return `${isoDate(p.y, p.m, p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

// Häufige Windows-Zeitzonennamen (z. B. aus Outlook-Einladungen) -> IANA.
const WINDOWS_ZONES = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

export function resolveTimeZone(tzid, fallback) {
  if (!tzid) return fallback;
  let id = String(tzid).trim().replace(/^"|"$/g, '');
  if (id.startsWith('/')) id = id.replace(/^\/[^/]*\//, ''); // z. B. "/mozilla.org/20050126_1/Europe/Berlin"
  if (WINDOWS_ZONES[id]) return WINDOWS_ZONES[id];
  if (isValidTimeZone(id)) return id;
  const tail = id.match(/[A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/);
  if (tail && isValidTimeZone(tail[0])) return tail[0];
  return fallback;
}

// Tagesnummer (Tage seit 1970-01-01) für Kalender-Rechnungen ohne Zeitzonen.
export const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);

export function fromDayNumber(dn) {
  const t = new Date(dn * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// 0 = Sonntag ... 6 = Samstag
export const weekdayOf = (dn) => (((dn + 4) % 7) + 7) % 7;

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
