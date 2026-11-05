// Die angebundenen Apps. Kalender und Mail kommen am liebsten direkt vom Mac (ohne Passwort);
// iCloud mit app-spezifischem Passwort bleibt als Weg für den Browser oder einen Server.

import { randomUUID } from 'node:crypto';
import { CalDAVClient } from './lib/caldav.js';
import { ImapClient, ImapError } from './lib/imap.js';
import {
  eventsInRange, buildEvent, parseICS, findMasterEvent, isRecurringResource, setEventTimes, setProp,
  escapeText, touchEvent, serializeComponent, getProp, parseDateValue, dateValueToMs, unescapeText,
} from './lib/ical.js';
import { parseMessage, composeMessage } from './lib/mime.js';
import * as weatherApi from './lib/weather.js';
import { dayStartMs, addDaysIso, localDateTimeToMs, msToLocalIso, parseIsoDate } from './lib/tz.js';
import { createMacCalendar, createMacReminders, createMacContacts, createMacMail, createWhatsApp } from './mac.js';

export class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class Cache {
  constructor(ttlMs) {
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e || Date.now() - e.at > this.ttl) return undefined;
    return e.value;
  }
  set(key, value) {
    this.map.set(key, { at: Date.now(), value });
    return value;
  }
  clear() {
    this.map.clear();
  }
}

const encodeId = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
function decodeId(id) {
  try {
    return JSON.parse(Buffer.from(String(id), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const SPECIAL_FOLDERS = {
  drafts: { flag: '\\drafts', names: ['Drafts', 'Entwürfe'] },
  trash: { flag: '\\trash', names: ['Deleted Messages', 'Trash', 'Papierkorb', 'Gelöschte Objekte'] },
  archive: { flag: '\\archive', names: ['Archive', 'Archiv'] },
  junk: { flag: '\\junk', names: ['Junk', 'Spam', 'Werbung'] },
  sent: { flag: '\\sent', names: ['Sent Messages', 'Sent', 'Gesendet', 'Gesendete Objekte'] },
};
const FOLDER_ALIASES = {
  posteingang: 'INBOX', inbox: 'INBOX', eingang: 'INBOX',
  archiv: 'archive', archive: 'archive',
  papierkorb: 'trash', trash: 'trash', 'gelöscht': 'trash', 'deleted messages': 'trash',
  entwürfe: 'drafts', entwurf: 'drafts', drafts: 'drafts',
  gesendet: 'sent', sent: 'sent',
  spam: 'junk', junk: 'junk', werbung: 'junk',
};

function imapDate(ms) {
  const d = new Date(ms);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()}-${m}-${d.getUTCFullYear()}`;
}

function parseMailId(id) {
  const s = String(id || '');
  const idx = s.lastIndexOf(':');
  const uid = Number(s.slice(idx + 1));
  if (idx <= 0 || !Number.isInteger(uid) || uid <= 0) throw new ServiceError('Unbekannte Mail-ID.');
  return { box: s.slice(0, idx), uid };
}

const formatAddr = (a) => (a ? (a.name ? `${a.name} <${a.address}>` : a.address) : '');

export function createServices(stores, { bridge, apps } = {}) {
  const config = () => stores.config.data;
  const secrets = () => stores.secrets.data;
  const tz = () => config().timezone;
  const caldavUrl = () => process.env.ICLOUD_CALDAV_URL || 'https://caldav.icloud.com/';
  const imapOptions = () => ({
    host: process.env.ICLOUD_IMAP_HOST || 'imap.mail.me.com',
    port: Number(process.env.ICLOUD_IMAP_PORT || 993),
    secure: process.env.ICLOUD_IMAP_SECURE !== 'false',
  });

  // ---------------- Kalender ----------------

  let calClient = null;
  let calKey = '';
  const calCache = new Cache(10 * 60000);
  const evCache = new Cache(90000);

  function calendarClient(creds) {
    const c = creds || { appleId: config().icloud.appleId, appPassword: secrets().icloudAppPassword };
    if (!c.appleId || !c.appPassword) throw new ServiceError('Der Kalender ist noch nicht verbunden.', 409);
    if (creds) return new CalDAVClient({ serverUrl: caldavUrl(), username: c.appleId, password: c.appPassword });
    const key = `${c.appleId}\n${c.appPassword}`;
    if (!calClient || calKey !== key) {
      calClient = new CalDAVClient({ serverUrl: caldavUrl(), username: c.appleId, password: c.appPassword });
      calKey = key;
    }
    return calClient;
  }

  function publicCalendar(c) {
    const selected = config().icloud.selectedCalendars;
    const id = encodeId({ u: c.url });
    return { id, url: c.url, name: c.name, color: c.color, readOnly: c.readOnly, selected: !selected || selected.includes(id) };
  }

  function toEvent(e, cal, objUrl) {
    const zone = tz();
    return {
      id: encodeId(e.recurring ? { u: objUrl, k: e.occurrenceKey } : { u: objUrl }),
      title: e.title,
      start: e.allDay ? e.startDate : msToLocalIso(e.startMs, zone),
      end: e.allDay ? addDaysIso(e.endDate, -1) : msToLocalIso(e.endMs, zone),
      allDay: e.allDay,
      startMs: e.startMs,
      endMs: e.endMs,
      location: e.location || '',
      notes: (e.notes || '').slice(0, 1500),
      recurring: Boolean(e.recurring),
      calendar: cal.name,
      calendarId: cal.id,
      color: cal.color,
      readOnly: cal.readOnly,
    };
  }

  async function findCalendar(ref) {
    const cals = await icloudCalendar.calendars();
    if (ref) {
      const r = String(ref).toLowerCase();
      const hit = cals.find((c) => c.id === ref || c.name.toLowerCase() === r);
      if (!hit) throw new ServiceError(`Kalender „${ref}“ nicht gefunden. Vorhanden: ${cals.map((c) => c.name).join(', ')}.`);
      if (hit.readOnly) throw new ServiceError(`In den Kalender „${hit.name}“ kann ich nicht schreiben.`);
      return hit;
    }
    const def = config().icloud.defaultCalendar;
    return cals.find((c) => c.id === def && !c.readOnly) || cals.find((c) => c.selected && !c.readOnly) || cals.find((c) => !c.readOnly)
      || (() => { throw new ServiceError('Kein Kalender gefunden, in den ich schreiben kann.'); })();
  }

  function eventCalendarReadOnly(url, cals) {
    const cal = cals.find((c) => url.startsWith(c.url));
    return cal ? cal.readOnly : false;
  }

  function parseTimes({ start, end, allDay }, existing) {
    const zone = tz();
    if (allDay) {
      if (!parseIsoDate(start)) throw new ServiceError('Bei ganztägigen Terminen bitte das Datum als JJJJ-MM-TT angeben.');
      const last = end ? end.slice(0, 10) : start;
      if (!parseIsoDate(last) || last < start) throw new ServiceError('Das Ende liegt vor dem Beginn.');
      return { allDay: true, startDate: start, endDate: addDaysIso(last, 1) };
    }
    const startMs = localDateTimeToMs(start, zone);
    if (startMs === null) throw new ServiceError('Beginn bitte als JJJJ-MM-TTTHH:MM angeben, z. B. 2026-11-05T14:30.');
    let endMs;
    if (end) {
      endMs = localDateTimeToMs(end, zone);
      if (endMs === null) throw new ServiceError('Ende bitte als JJJJ-MM-TTTHH:MM angeben.');
    } else endMs = startMs + (existing?.durationMs ?? 3600000);
    if (endMs <= startMs) throw new ServiceError('Das Ende muss nach dem Beginn liegen.');
    return { allDay: false, startMs, endMs };
  }

  const icloudCalendar = {
    enabled: () => Boolean(config().icloud.calendarEnabled && config().icloud.appleId && secrets().icloudAppPassword),

    async test(appleId, appPassword) {
      const cals = await calendarClient({ appleId, appPassword }).listCalendars();
      return cals.length;
    },

    async calendars({ fresh = false } = {}) {
      if (!icloudCalendar.enabled()) throw new ServiceError('Der Kalender ist noch nicht verbunden.', 409);
      let cals = fresh ? undefined : calCache.get('list');
      if (!cals) cals = calCache.set('list', await calendarClient().listCalendars());
      return cals.map(publicCalendar);
    },

    async events(fromDate, toDate) {
      if (!parseIsoDate(fromDate) || !parseIsoDate(toDate)) throw new ServiceError('Datum bitte als JJJJ-MM-TT angeben.');
      if (toDate < fromDate) throw new ServiceError('Das Ende liegt vor dem Beginn.');
      if (dayStartMs(toDate, tz()) - dayStartMs(fromDate, tz()) > 92 * 86400000) throw new ServiceError('Bitte höchstens drei Monate auf einmal abfragen.');
      const key = `${fromDate}|${toDate}`;
      const cached = evCache.get(key);
      if (cached) return cached;
      const zone = tz();
      const startMs = dayStartMs(fromDate, zone);
      const endMs = dayStartMs(addDaysIso(toDate, 1), zone);
      const cals = (await icloudCalendar.calendars()).filter((c) => c.selected);
      const client = calendarClient();
      const errors = [];
      const lists = await Promise.all(cals.map(async (cal) => {
        try {
          const objects = await client.queryEvents(cal.url, startMs, endMs);
          return objects.flatMap((o) => {
            try {
              return eventsInRange(o.ics, startMs, endMs, zone).map((e) => toEvent(e, cal, o.url));
            } catch {
              return [];
            }
          });
        } catch (err) {
          errors.push(err);
          return [];
        }
      }));
      if (errors.length && errors.length === cals.length) throw errors[0];
      const events = lists.flat().sort((a, b) => a.startMs - b.startMs || Number(b.allDay) - Number(a.allDay));
      return evCache.set(key, events);
    },

    async create({ title, start, end, allDay = false, location, notes, calendar: calRef }) {
      if (!title || !String(title).trim()) throw new ServiceError('Der Termin braucht einen Titel.');
      const times = parseTimes({ start, end, allDay });
      const cal = await findCalendar(calRef);
      const uid = randomUUID().toUpperCase();
      const base = cal.url.endsWith('/') ? cal.url : `${cal.url}/`;
      const url = new URL(`${uid}.ics`, base).toString();
      await calendarClient().put(url, buildEvent({ uid, title: String(title).trim(), location, notes, times }), { create: true });
      evCache.clear();
      return { created: true, title: String(title).trim(), calendar: cal.name, ...describeTimes(times) };
    },

    async update({ id, title, start, end, location, notes }) {
      const ref = decodeId(id);
      if (!ref?.u) throw new ServiceError('Unbekannte Termin-ID.');
      const client = calendarClient();
      if (eventCalendarReadOnly(ref.u, await icloudCalendar.calendars())) throw new ServiceError('Dieser Kalender kann nur gelesen werden.');
      const { ics, etag } = await client.get(ref.u);
      const root = parseICS(ics);
      if (isRecurringResource(root)) throw new ServiceError('Wiederkehrende Termine kann ich noch nicht ändern. Bitte direkt in der Kalender-App ändern.');
      const ev = findMasterEvent(root);
      if (!ev) throw new ServiceError('Termin nicht gefunden.');
      if (title !== undefined) setProp(ev, 'SUMMARY', escapeText(title));
      if (location !== undefined) setProp(ev, 'LOCATION', location ? escapeText(location) : null);
      if (notes !== undefined) setProp(ev, 'DESCRIPTION', notes ? escapeText(notes) : null);
      if (start !== undefined || end !== undefined) {
        const zone = tz();
        const sp = getProp(ev, 'DTSTART');
        const cur = parseDateValue(sp.value, sp.params, zone);
        const ep = getProp(ev, 'DTEND');
        const curEnd = ep ? parseDateValue(ep.value, ep.params, zone) : null;
        const allDay = cur.date;
        const curStartMs = dateValueToMs(cur, zone);
        const durationMs = curEnd ? dateValueToMs(curEnd, zone) - curStartMs : 3600000;
        let times;
        if (allDay) {
          const curStart = msToLocalIso(curStartMs, zone).slice(0, 10);
          const curLast = curEnd ? addDaysIso(msToLocalIso(dateValueToMs(curEnd, zone), zone).slice(0, 10), -1) : curStart;
          const newStart = start ? start.slice(0, 10) : curStart;
          const span = Math.round((dayStartMs(curLast, zone) - dayStartMs(curStart, zone)) / 86400000);
          times = parseTimes({ allDay: true, start: newStart, end: end ? end.slice(0, 10) : addDaysIso(newStart, span) });
        } else {
          const newStart = start || msToLocalIso(curStartMs, zone);
          times = parseTimes({ allDay: false, start: newStart, end }, { durationMs });
        }
        setEventTimes(ev, times);
      }
      touchEvent(ev);
      await client.put(ref.u, serializeComponent(root), { etag });
      evCache.clear();
      return { updated: true, title: unescapeText(getProp(ev, 'SUMMARY')?.value || '') };
    },

    async remove(id) {
      const ref = decodeId(id);
      if (!ref?.u) throw new ServiceError('Unbekannte Termin-ID.');
      const client = calendarClient();
      if (eventCalendarReadOnly(ref.u, await icloudCalendar.calendars())) throw new ServiceError('Dieser Kalender kann nur gelesen werden.');
      const { ics, etag } = await client.get(ref.u);
      const root = parseICS(ics);
      if (isRecurringResource(root)) throw new ServiceError('Wiederkehrende Termine kann ich noch nicht löschen. Bitte direkt in der Kalender-App löschen.');
      await client.delete(ref.u, etag);
      evCache.clear();
      return { deleted: true };
    },

    reset() {
      calClient = null;
      calCache.clear();
      evCache.clear();
    },
  };

  function describeTimes(t) {
    if (t.allDay) return { allDay: true, start: t.startDate, end: addDaysIso(t.endDate, -1) };
    return { allDay: false, start: msToLocalIso(t.startMs, tz()), end: msToLocalIso(t.endMs, tz()) };
  }

  // ---------------- Mail ----------------

  const mailCache = new Cache(60000);

  async function withImap(fn, creds) {
    const c = creds || { login: config().icloud.mailLogin || config().icloud.mailAddress, appPassword: secrets().icloudAppPassword };
    if (!c.login || !c.appPassword) throw new ServiceError('Mail ist noch nicht verbunden.', 409);
    const client = new ImapClient(imapOptions());
    await client.connect();
    try {
      await client.login(c.login, c.appPassword);
      return await fn(client);
    } finally {
      await client.logout();
    }
  }

  async function folderList(client) {
    return (await client.list()).filter((f) => !f.flags.includes('\\noselect') && !f.flags.includes('\\nonexistent'));
  }

  function special(list, kind) {
    const s = SPECIAL_FOLDERS[kind];
    return list.find((f) => f.flags.includes(s.flag)) || list.find((f) => s.names.some((n) => f.display.toLowerCase() === n.toLowerCase())) || null;
  }

  async function resolveFolder(client, name) {
    const list = await folderList(client);
    const wanted = String(name || 'INBOX').trim();
    const alias = FOLDER_ALIASES[wanted.toLowerCase()];
    if (alias === 'INBOX' || wanted.toUpperCase() === 'INBOX') return list.find((f) => f.name.toUpperCase() === 'INBOX') || { name: 'INBOX', display: 'Posteingang', flags: [] };
    if (alias) {
      const hit = special(list, alias);
      if (hit) return hit;
    }
    const hit = list.find((f) => f.display.toLowerCase() === wanted.toLowerCase() || f.name === wanted);
    if (hit) return hit;
    throw new ServiceError(`Ordner „${wanted}“ nicht gefunden. Vorhanden: ${list.map((f) => (f.name === 'INBOX' ? 'Posteingang' : f.display)).join(', ')}.`);
  }

  function listItem(box, m) {
    const env = m.envelope || {};
    const from = env.from?.[0];
    const dateMs = Date.parse(env.date) || m.internalDate || null;
    return {
      id: `${box}:${m.uid}`,
      from: from ? from.name || from.address : '(unbekannt)',
      fromAddress: from?.address || '',
      subject: env.subject || '(kein Betreff)',
      date: dateMs ? msToLocalIso(dateMs, tz()) : '',
      dateMs,
      unread: !(m.flags || []).includes('\\Seen'),
      flagged: (m.flags || []).includes('\\Flagged'),
    };
  }

  const icloudMail = {
    enabled: () => Boolean(config().icloud.mailEnabled && config().icloud.mailAddress && secrets().icloudAppPassword),

    // Probiert die volle Adresse und den Namensteil (Apple erlaubt beides je nach Konto).
    async test(address, appPassword) {
      const candidates = [address, address.split('@')[0]].filter((v, i, a) => v && a.indexOf(v) === i);
      let lastErr;
      for (const login of candidates) {
        try {
          const count = await withImap(async (c) => (await c.select('INBOX', true)).exists, { login, appPassword });
          return { login, count };
        } catch (err) {
          lastErr = err;
          if (!(err instanceof ImapError && err.code === 'AUTHENTICATIONFAILED')) break;
        }
      }
      throw lastErr;
    },

    async list({ folder, unreadOnly = false, limit = 15, days } = {}) {
      const lim = Math.min(Math.max(Number(limit) || 15, 1), 50);
      const key = JSON.stringify({ folder, unreadOnly, lim, days });
      const cached = mailCache.get(key);
      if (cached) return cached;
      const result = await withImap(async (c) => {
        const box = await resolveFolder(c, folder);
        await c.select(box.name, true);
        const crit = [];
        if (unreadOnly) crit.push('UNSEEN');
        const d = days ?? (unreadOnly ? null : 30);
        if (d) crit.push(`SINCE ${imapDate(Date.now() - d * 86400000)}`);
        const uids = await c.uidSearch(crit.length ? crit.join(' ') : 'ALL');
        const picked = uids.slice(-lim);
        const msgs = await c.uidFetch(picked, '(UID FLAGS INTERNALDATE ENVELOPE)');
        return {
          folder: box.name === 'INBOX' ? 'Posteingang' : box.display,
          total: uids.length,
          messages: msgs.map((m) => listItem(box.name, m)).sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0)),
        };
      });
      return mailCache.set(key, result);
    },

    async read(id) {
      const { box, uid } = parseMailId(id);
      return withImap(async (c) => {
        await c.select(box, true);
        const [m] = await c.uidFetch([uid], '(UID FLAGS ENVELOPE BODY.PEEK[]<0.3000000>)');
        if (!m) throw new ServiceError('Diese Mail gibt es nicht mehr (vielleicht verschoben).', 404);
        const parsed = parseMessage(m.body || Buffer.alloc(0));
        const item = listItem(box, m);
        const text = parsed.text.length > 15000 ? `${parsed.text.slice(0, 15000)}\n\n[… gekürzt]` : parsed.text;
        return {
          ...item,
          from: parsed.from || formatAddr(m.envelope?.from?.[0]),
          to: parsed.to,
          cc: parsed.cc,
          subject: parsed.subject || item.subject,
          text,
          attachments: parsed.attachments.map((a) => a.filename),
        };
      });
    },

    async search({ query, folder, limit = 10 }) {
      const q = String(query || '').trim();
      if (!q) throw new ServiceError('Wonach soll ich suchen?');
      const lim = Math.min(Math.max(Number(limit) || 10, 1), 30);
      return withImap(async (c) => {
        const box = await resolveFolder(c, folder);
        await c.select(box.name, true);
        const ascii = /^[\x20-\x7e]*$/.test(q);
        const uids = ascii
          ? await c.uidSearch(`TEXT "${q.replace(/[\\"]/g, '\\$&')}"`)
          : await c.uidSearch('CHARSET UTF-8 TEXT ', { literal: Buffer.from(q, 'utf8') });
        const msgs = await c.uidFetch(uids.slice(-lim), '(UID FLAGS INTERNALDATE ENVELOPE)');
        return { folder: box.display, total: uids.length, messages: msgs.map((m) => listItem(box.name, m)).sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0)) };
      });
    },

    async mark(id, { read, flagged }) {
      const { box, uid } = parseMailId(id);
      await withImap(async (c) => {
        await c.select(box);
        if (read !== undefined) await c.uidStore([uid], read ? '+FLAGS.SILENT' : '-FLAGS.SILENT', ['\\Seen']);
        if (flagged !== undefined) await c.uidStore([uid], flagged ? '+FLAGS.SILENT' : '-FLAGS.SILENT', ['\\Flagged']);
      });
      mailCache.clear();
      return { ok: true };
    },

    async move(id, to) {
      const { box, uid } = parseMailId(id);
      const dest = await withImap(async (c) => {
        const target = await resolveFolder(c, to);
        if (target.name === box) return target;
        await c.select(box);
        await c.uidMove([uid], target.name);
        return target;
      });
      mailCache.clear();
      return { moved: true, folder: dest.name === 'INBOX' ? 'Posteingang' : dest.display };
    },

    async draft({ to, cc, subject, body, replyToId }) {
      const from = config().icloud.mailAddress;
      const result = await withImap(async (c) => {
        let inReplyTo;
        let references;
        let recipients = to;
        let subj = subject;
        if (replyToId) {
          const { box, uid } = parseMailId(replyToId);
          await c.select(box, true);
          const [orig] = await c.uidFetch([uid], '(UID ENVELOPE BODY.PEEK[HEADER.FIELDS (REFERENCES)])');
          if (orig?.envelope) {
            inReplyTo = orig.envelope.messageId || undefined;
            const refHeader = orig.body ? orig.body.toString('latin1').replace(/^references:\s*/i, '').replace(/\r?\n[ \t]*/g, ' ').trim() : '';
            references = refHeader || undefined;
            if (!recipients) recipients = formatAddr(orig.envelope.replyTo?.[0] || orig.envelope.from?.[0]);
            if (!subj) subj = /^(re|aw):/i.test(orig.envelope.subject) ? orig.envelope.subject : `Re: ${orig.envelope.subject}`;
          }
        }
        if (!recipients) throw new ServiceError('An wen soll der Entwurf gehen?');
        const message = composeMessage({ from, to: recipients, cc, subject: subj || '', body, inReplyTo, references });
        const drafts = special(await folderList(c), 'drafts');
        if (!drafts) throw new ServiceError('Kein Entwürfe-Ordner gefunden.');
        await c.append(drafts.name, ['\\Draft', '\\Seen'], message);
        return { savedTo: drafts.display, to: recipients, subject: subj || '' };
      });
      mailCache.clear();
      return { draftSaved: true, ...result, hint: 'Der Entwurf liegt im Ordner Entwürfe. Abschicken musst du ihn selbst in der Mail-App.' };
    },

    async folders() {
      return withImap(async (c) => (await folderList(c)).map((f) => (f.name === 'INBOX' ? 'Posteingang' : f.display)));
    },

    reset() {
      mailCache.clear();
    },
  };

  // ---------------- Wetter ----------------

  const weatherCache = new Cache(15 * 60000);
  const weather = {
    enabled: () => Boolean(config().weather.enabled && config().weather.latitude !== null),
    async get() {
      if (!weather.enabled()) throw new ServiceError('Wetter ist noch nicht eingerichtet.', 409);
      const { latitude, longitude, name } = config().weather;
      const key = `${latitude},${longitude}`;
      const cached = weatherCache.get(key);
      if (cached) return cached;
      const data = await weatherApi.forecast({ latitude, longitude });
      return weatherCache.set(key, { place: name, ...data });
    },
    search: (q) => weatherApi.searchPlaces(q),
    reset: () => weatherCache.clear(),
  };

  // ---------------- Claude ----------------

  const claude = {
    enabled: () => Boolean(secrets().claudeApiKey),
    apiKey: () => secrets().claudeApiKey,
    model: () => config().claude.model,
  };

  // ---------------- Direkt vom Mac ----------------

  const mac = { bridge, apps, stores, tz };
  const macCalendar = createMacCalendar(mac);
  const macMail = createMacMail(mac);
  const reminders = createMacReminders(mac);
  const contacts = createMacContacts(mac);
  const whatsapp = createWhatsApp(mac);

  const need = (provider, message) => {
    if (!provider) throw new ServiceError(message, 409);
    return provider;
  };

  const calProvider = () => (macCalendar.enabled() ? macCalendar : icloudCalendar.enabled() ? icloudCalendar : null);
  const CAL_OFF = 'Der Kalender ist noch nicht verbunden. In der Mac-App geht das ohne Passwort unter Einstellungen → Apps.';
  const calendar = {
    provider: () => (macCalendar.enabled() ? 'mac' : icloudCalendar.enabled() ? 'icloud' : null),
    enabled: () => Boolean(calProvider()),
    calendars: (opts) => need(calProvider(), CAL_OFF).calendars(opts),
    events: (from, to) => need(calProvider(), CAL_OFF).events(from, to),
    create: (input) => need(calProvider(), CAL_OFF).create(input),
    update: (input) => need(calProvider(), CAL_OFF).update(input),
    remove: (id) => need(calProvider(), CAL_OFF).remove(id),
    test: (appleId, appPassword) => icloudCalendar.test(appleId, appPassword),
    reset() {
      macCalendar.reset();
      icloudCalendar.reset();
    },
  };

  const mailProvider = () => (macMail.enabled() ? macMail : icloudMail.enabled() ? icloudMail : null);
  const MAIL_OFF = 'Mail ist noch nicht verbunden. In der Mac-App geht das ohne Passwort unter Einstellungen → Apps.';
  const mail = {
    provider: () => (macMail.enabled() ? 'mac' : icloudMail.enabled() ? 'icloud' : null),
    enabled: () => Boolean(mailProvider()),
    canSend: () => macMail.enabled(),
    list: (opts) => need(mailProvider(), MAIL_OFF).list(opts),
    read: (id, opts) => need(mailProvider(), MAIL_OFF).read(id, opts),
    search: (opts) => need(mailProvider(), MAIL_OFF).search(opts),
    mark: (id, opts) => need(mailProvider(), MAIL_OFF).mark(id, opts),
    move: (id, to) => need(mailProvider(), MAIL_OFF).move(id, to),
    draft: (opts) => need(mailProvider(), MAIL_OFF).draft(opts),
    folders: () => need(mailProvider(), MAIL_OFF).folders(),
    async replyInfo(id) {
      const p = need(mailProvider(), MAIL_OFF);
      if (p.replyInfo) return p.replyInfo(id);
      const m = await p.read(id);
      return { to: m.from, subject: /^(re|aw):/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, original: m };
    },
    compose: (opts) => need(macMail.enabled() ? macMail : null, 'Mails senden geht nur über die Mail-App in der Mac-App.').compose(opts),
    test: (address, appPassword) => icloudMail.test(address, appPassword),
    reset() {
      macMail.reset();
      icloudMail.reset();
    },
  };

  function status() {
    const c = config();
    return {
      mac: { connected: Boolean(bridge?.connected()) },
      calendar: { connected: calendar.enabled(), provider: calendar.provider(), account: c.icloud.calendarEnabled ? c.icloud.appleId : '' },
      mail: { connected: mail.enabled(), provider: mail.provider(), address: c.icloud.mailEnabled ? c.icloud.mailAddress : '' },
      whatsapp: { connected: whatsapp.enabled() },
      reminders: { connected: reminders.enabled() },
      contacts: { connected: contacts.enabled() },
      weather: { connected: weather.enabled(), place: c.weather.enabled ? [c.weather.name, c.weather.region].filter(Boolean).join(', ') : '' },
      claude: { connected: claude.enabled(), model: c.claude.model },
      icloud: { calendar: icloudCalendar.enabled(), mail: icloudMail.enabled() },
      connector: { ready: Boolean(secrets().connectorToken) },
    };
  }

  return { calendar, mail, weather, claude, whatsapp, reminders, contacts, bridge, apps, status, tz };
}
