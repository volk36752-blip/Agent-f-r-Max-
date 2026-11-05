// Die Apps direkt vom Mac – ohne Passwörter:
// Kalender, Erinnerungen und Kontakte über die Mac-App (EventKit/Contacts), Mail über die Mail-App,
// WhatsApp über die WhatsApp-App für den Mac.

import { runJxa, JxaError } from './lib/jxa.js';
import { AppError } from './apps.js';
import { dayStartMs, addDaysIso, localDateTimeToMs, msToLocalIso, parseIsoDate } from './lib/tz.js';
import { parseAddressList } from './lib/mime.js';

export class MacError extends Error {
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
    return e && Date.now() - e.at <= this.ttl ? e.value : undefined;
  }
  set(key, value) {
    this.map.set(key, { at: Date.now(), value });
    return value;
  }
  clear() {
    this.map.clear();
  }
}

// ---------------------------------------------------------------- Kalender

export function createMacCalendar({ bridge, apps, stores, tz }) {
  const calCache = new Cache(5 * 60000);
  const evCache = new Cache(60000);
  const opts = () => stores.config.data.apps.kalender || {};

  async function raw(fresh = false) {
    await apps.ensure('kalender');
    let list = fresh ? undefined : calCache.get('list');
    if (!list) list = calCache.set('list', (await bridge.call('calendar.calendars', {}, { timeoutMs: 20000 }))?.calendars || []);
    return list;
  }

  const publicCal = (c) => {
    const sel = opts().selected;
    return { id: c.id, name: c.title, color: c.color || null, readOnly: !c.writable, account: c.source || '', isDefault: Boolean(c.isDefault), selected: !sel || sel.includes(c.id) };
  };

  function toEvent(e) {
    const zone = tz();
    return {
      id: e.id,
      title: e.title || '(ohne Titel)',
      start: e.allDay ? e.startDate : msToLocalIso(e.startMs, zone),
      end: e.allDay ? e.endDate : msToLocalIso(e.endMs, zone),
      allDay: Boolean(e.allDay),
      startMs: e.startMs,
      endMs: e.endMs,
      location: e.location || '',
      notes: String(e.notes || '').slice(0, 1500),
      recurring: Boolean(e.recurring),
      calendar: e.calendar || '',
      calendarId: e.calendarId || '',
      color: e.color || null,
      readOnly: !e.writable,
    };
  }

  function times({ start, end, allDay }) {
    const zone = tz();
    if (allDay || (start && start.length === 10)) {
      if (!parseIsoDate(String(start || '').slice(0, 10))) throw new MacError('Bei ganztägigen Terminen das Datum als JJJJ-MM-TT angeben.');
      const first = start.slice(0, 10);
      const last = end ? end.slice(0, 10) : first;
      if (!parseIsoDate(last) || last < first) throw new MacError('Das Ende liegt vor dem Beginn.');
      return { allDay: true, startDate: first, endDate: last };
    }
    const startMs = localDateTimeToMs(start, zone);
    if (startMs === null) throw new MacError('Beginn bitte als JJJJ-MM-TTTHH:MM angeben, z. B. 2026-11-05T14:30.');
    let endMs = null;
    if (end) {
      endMs = localDateTimeToMs(end, zone);
      if (endMs === null) throw new MacError('Ende bitte als JJJJ-MM-TTTHH:MM angeben.');
      if (endMs <= startMs) throw new MacError('Das Ende muss nach dem Beginn liegen.');
    }
    return { allDay: false, startMs, endMs };
  }

  async function findCalendar(ref) {
    const cals = (await raw()).map(publicCal);
    if (ref) {
      const r = String(ref).toLowerCase();
      const hit = cals.find((c) => c.id === ref || c.name.toLowerCase() === r);
      if (!hit) throw new MacError(`Kalender „${ref}“ nicht gefunden. Vorhanden: ${cals.map((c) => c.name).join(', ')}.`);
      if (hit.readOnly) throw new MacError(`In den Kalender „${hit.name}“ kann ich nicht schreiben.`);
      return hit;
    }
    const def = opts().defaultCalendar;
    return cals.find((c) => c.id === def && !c.readOnly) || cals.find((c) => c.isDefault && !c.readOnly) || cals.find((c) => c.selected && !c.readOnly) || cals.find((c) => !c.readOnly)
      || (() => { throw new MacError('Kein Kalender gefunden, in den ich schreiben kann.'); })();
  }

  const describe = (e) => ({ title: e.title, calendar: e.calendar, allDay: e.allDay, start: e.start, end: e.end });

  return {
    enabled: () => bridge.connected() && apps.isOn('kalender'),
    async calendars({ fresh = false } = {}) {
      return (await raw(fresh)).map(publicCal);
    },
    async events(fromDate, toDate) {
      if (!parseIsoDate(fromDate) || !parseIsoDate(toDate)) throw new MacError('Datum bitte als JJJJ-MM-TT angeben.');
      if (toDate < fromDate) throw new MacError('Das Ende liegt vor dem Beginn.');
      const zone = tz();
      const fromMs = dayStartMs(fromDate, zone);
      const toMs = dayStartMs(addDaysIso(toDate, 1), zone);
      if (toMs - fromMs > 93 * 86400000) throw new MacError('Bitte höchstens drei Monate auf einmal abfragen.');
      await apps.ensure('kalender');
      const key = `${fromDate}|${toDate}|${JSON.stringify(opts().selected || null)}`;
      const cached = evCache.get(key);
      if (cached) return cached;
      const r = await bridge.call('calendar.events', { fromMs, toMs, calendarIds: opts().selected || null }, { timeoutMs: 30000 });
      const events = (r?.events || []).map(toEvent).sort((a, b) => a.startMs - b.startMs || Number(b.allDay) - Number(a.allDay));
      return evCache.set(key, events);
    },
    async create({ title, start, end, allDay = false, location, notes, calendar }) {
      const t = String(title || '').trim();
      if (!t) throw new MacError('Der Termin braucht einen Titel.');
      const tm = times({ start, end, allDay });
      if (!tm.allDay && tm.endMs === null) tm.endMs = tm.startMs + 3600000;
      const cal = await findCalendar(calendar);
      const r = await bridge.call('calendar.create', { title: t, ...tm, location: location || '', notes: notes || '', calendarId: cal.id }, { timeoutMs: 30000 });
      evCache.clear();
      return { created: true, ...describe(toEvent(r.event)) };
    },
    async update({ id, title, start, end, location, notes }) {
      if (!id) throw new MacError('Unbekannte Termin-ID.');
      await apps.ensure('kalender');
      const patch = { id };
      if (title !== undefined) patch.title = String(title);
      if (location !== undefined) patch.location = String(location);
      if (notes !== undefined) patch.notes = String(notes);
      if (start !== undefined) Object.assign(patch, times({ start, end, allDay: start.length === 10 }));
      else if (end !== undefined) {
        if (end.length === 10) patch.endDate = end;
        else {
          patch.endMs = localDateTimeToMs(end, tz());
          if (patch.endMs === null) throw new MacError('Ende bitte als JJJJ-MM-TTTHH:MM angeben.');
        }
      }
      const r = await bridge.call('calendar.update', patch, { timeoutMs: 30000 });
      evCache.clear();
      return { updated: true, ...describe(toEvent(r.event)) };
    },
    async remove(id) {
      if (!id) throw new MacError('Unbekannte Termin-ID.');
      await apps.ensure('kalender');
      await bridge.call('calendar.delete', { id }, { timeoutMs: 30000 });
      evCache.clear();
      return { deleted: true };
    },
    reset() {
      calCache.clear();
      evCache.clear();
    },
  };
}

// ---------------------------------------------------------------- Erinnerungen

export function createMacReminders({ bridge, apps }) {
  const toItem = (r) => ({ id: r.id, title: r.title || '(ohne Titel)', notes: r.notes || '', due: r.dueDate || null, time: r.dueTime || null, priority: r.priority === 'hoch' ? 'hoch' : 'normal', done: Boolean(r.completed), list: r.list || '' });
  return {
    enabled: () => bridge.connected() && apps.isOn('erinnerungen'),
    async lists() {
      await apps.ensure('erinnerungen');
      return (await bridge.call('reminders.lists', {}, { timeoutMs: 20000 }))?.lists || [];
    },
    async list({ list, includeCompleted = false } = {}) {
      await apps.ensure('erinnerungen');
      const r = await bridge.call('reminders.list', { list: list || null, includeCompleted }, { timeoutMs: 30000 });
      return (r?.reminders || []).map(toItem);
    },
    async add({ title, due, time, notes, priority, list }) {
      const t = String(title || '').trim();
      if (!t) throw new MacError('Die Erinnerung braucht einen Titel.');
      if (due && !parseIsoDate(due)) throw new MacError('Datum bitte als JJJJ-MM-TT angeben.');
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new MacError('Uhrzeit bitte als HH:MM angeben.');
      await apps.ensure('erinnerungen');
      const r = await bridge.call('reminders.create', { title: t, dueDate: due || null, dueTime: due ? time || null : null, notes: notes || '', priority: priority || 'normal', list: list || null }, { timeoutMs: 20000 });
      return toItem(r.reminder);
    },
    async setDone(id, done = true) {
      await apps.ensure('erinnerungen');
      const r = await bridge.call('reminders.update', { id, completed: Boolean(done) }, { timeoutMs: 20000 });
      return toItem(r.reminder);
    },
    async remove(id) {
      await apps.ensure('erinnerungen');
      await bridge.call('reminders.delete', { id }, { timeoutMs: 20000 });
      return { deleted: true };
    },
  };
}

// ---------------------------------------------------------------- Kontakte

export function createMacContacts({ bridge, apps }) {
  return {
    enabled: () => bridge.connected() && apps.isOn('kontakte'),
    async search(query, limit = 8) {
      const q = String(query || '').trim();
      if (!q) throw new MacError('Wen soll ich suchen?');
      await apps.ensure('kontakte');
      const r = await bridge.call('contacts.search', { query: q, limit }, { timeoutMs: 20000 });
      return r?.contacts || [];
    },
  };
}

// ---------------------------------------------------------------- Mail (Mail-App)

const MAIL_BOXES = `const boxes = { inbox: Mail.inbox, sent: Mail.sentMailbox, drafts: Mail.draftsMailbox, trash: Mail.trashMailbox, junk: Mail.junkMailbox };`;

const MAIL_LIST = `// @mail.list
function run(argv) {
  const input = JSON.parse(argv[0]);
  const Mail = Application('Mail');
  if (Mail.accounts().length === 0) return JSON.stringify({ error: 'noAccount' });
  ${MAIL_BOXES}
  const box = boxes[input.box] || Mail.inbox;
  const conds = [];
  if (input.days) conds.push({ dateReceived: { _greaterThan: new Date(Date.now() - input.days * 86400000) } });
  if (input.unreadOnly) conds.push({ readStatus: false });
  if (input.query) conds.push({ _or: [{ subject: { _contains: input.query } }, { sender: { _contains: input.query } }] });
  const spec = conds.length === 0 ? box.messages : box.messages.whose(conds.length === 1 ? conds[0] : { _and: conds });
  const ids = spec.id();
  let unread = 0;
  try { unread = box.unreadCount(); } catch (e) {}
  if (!ids.length) return JSON.stringify({ total: 0, unread: unread, messages: [] });
  const subjects = spec.subject();
  const senders = spec.sender();
  const dates = spec.dateReceived();
  const read = spec.readStatus();
  const flagged = spec.flaggedStatus();
  const rows = ids.map(function (id, i) {
    return { id: id, subject: subjects[i], sender: senders[i], date: dates[i] ? dates[i].getTime() : null, read: read[i], flagged: flagged[i] };
  });
  rows.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
  return JSON.stringify({ total: ids.length, unread: unread, messages: rows.slice(0, input.limit || 15) });
}`;

const MAIL_READ = `// @mail.read
function run(argv) {
  const input = JSON.parse(argv[0]);
  const Mail = Application('Mail');
  ${MAIL_BOXES}
  const m = (boxes[input.box] || Mail.inbox).messages.byId(input.id);
  let attachments = [];
  try { attachments = m.mailAttachments.name(); } catch (e) {}
  const out = {
    id: m.id(), subject: m.subject(), sender: m.sender(), replyTo: m.replyTo(),
    to: m.toRecipients.address(), cc: m.ccRecipients.address(),
    date: m.dateReceived() ? m.dateReceived().getTime() : null, read: m.readStatus(),
    content: String(m.content() || '').slice(0, 15000), attachments: attachments,
  };
  if (input.markRead) m.readStatus = true;
  return JSON.stringify(out);
}`;

const MAIL_CHANGE = `// @mail.change
function run(argv) {
  const input = JSON.parse(argv[0]);
  const Mail = Application('Mail');
  ${MAIL_BOXES}
  const m = (boxes[input.box] || Mail.inbox).messages.byId(input.id);
  if (input.read !== undefined && input.read !== null) m.readStatus = Boolean(input.read);
  if (input.flagged !== undefined && input.flagged !== null) m.flaggedStatus = Boolean(input.flagged);
  if (input.move === 'trash') { Mail.delete(m); return JSON.stringify({ moved: 'trash' }); }
  if (input.move === 'junk') { m.junkMailStatus = true; Mail.move(m, { to: Mail.junkMailbox }); return JSON.stringify({ moved: 'junk' }); }
  if (input.move === 'inbox') { Mail.move(m, { to: Mail.inbox }); return JSON.stringify({ moved: 'inbox' }); }
  if (input.move === 'archive') {
    const acc = m.mailbox.account();
    const names = ['Archive', 'Archiv', 'Archived', 'Archivierte E-Mails'];
    for (let i = 0; i < names.length; i++) {
      try {
        const mb = acc.mailboxes.byName(names[i]);
        mb.name();
        Mail.move(m, { to: mb });
        return JSON.stringify({ moved: 'archive' });
      } catch (e) {}
    }
    return JSON.stringify({ error: 'noArchive' });
  }
  return JSON.stringify({ ok: true });
}`;

const MAIL_SEND = `// @mail.send
function run(argv) {
  const input = JSON.parse(argv[0]);
  const Mail = Application('Mail');
  if (Mail.accounts().length === 0) return JSON.stringify({ error: 'noAccount' });
  const msg = Mail.OutgoingMessage({ subject: input.subject || '', content: input.body || '', visible: !input.send });
  Mail.outgoingMessages.push(msg);
  for (let i = 0; i < input.to.length; i++) {
    const r = input.to[i];
    const props = r.name ? { address: r.address, name: r.name } : { address: r.address };
    try { msg.toRecipients.push(Mail.ToRecipient(props)); } catch (e) { msg.toRecipients.push(Mail.Recipient(props)); }
  }
  if (input.send) {
    const ok = msg.send();
    return JSON.stringify({ sent: ok !== false });
  }
  Mail.activate();
  return JSON.stringify({ opened: true });
}`;

const BOX_ALIASES = { posteingang: 'inbox', inbox: 'inbox', eingang: 'inbox', gesendet: 'sent', sent: 'sent', entwürfe: 'drafts', entwurf: 'drafts', drafts: 'drafts', papierkorb: 'trash', trash: 'trash', 'gelöscht': 'trash', spam: 'junk', junk: 'junk', werbung: 'junk' };
const BOX_NAMES = { inbox: 'Posteingang', sent: 'Gesendet', drafts: 'Entwürfe', trash: 'Papierkorb', junk: 'Spam' };

export function createMacMail({ bridge, apps, tz }) {
  const cache = new Cache(45000);

  function parseId(id) {
    const m = /^mb:([a-z]+):(\d+)$/.exec(String(id || ''));
    if (!m) throw new MacError('Unbekannte Mail-ID.');
    return { box: m[1], id: Number(m[2]) };
  }

  async function jxa(source, input, timeoutMs) {
    await apps.ensure('mail');
    try {
      const r = await runJxa(source, input, { timeoutMs });
      if (r?.error === 'noAccount') throw new MacError('In der Mail-App ist noch kein Mail-Konto eingerichtet.', 409);
      return r;
    } catch (err) {
      if (err instanceof JxaError) {
        if (err.code === 'denied') throw new AppError('Ich darf die Mail-App nicht steuern. Erlauben kannst du es unter Einstellungen → Apps.', 'denied', 'mail');
        if (err.code === 'notFound') throw new MacError('Diese Mail gibt es nicht mehr (vielleicht verschoben oder gelöscht).', 404);
        throw new MacError(`Mail: ${err.message}`, 502);
      }
      throw err;
    }
  }

  const firstAddress = (str) => {
    try {
      return parseAddressList(str || '')[0] || null;
    } catch {
      return null;
    }
  };

  function item(box, m) {
    const from = firstAddress(m.sender);
    return {
      id: `mb:${box}:${m.id}`,
      from: from ? from.name || from.address : m.sender || '(unbekannt)',
      fromAddress: from?.address || '',
      subject: m.subject || '(kein Betreff)',
      date: m.date ? msToLocalIso(m.date, tz()) : '',
      dateMs: m.date || null,
      unread: !m.read,
      flagged: Boolean(m.flagged),
    };
  }

  const resolveBox = (folder) => {
    if (!folder) return 'inbox';
    const b = BOX_ALIASES[String(folder).trim().toLowerCase()];
    if (!b) throw new MacError(`Ordner „${folder}“ kenne ich nicht. Möglich: Posteingang, Gesendet, Entwürfe, Papierkorb, Spam.`);
    return b;
  };

  const mail = {
    enabled: () => bridge.connected() && apps.isOn('mail'),
    async list({ folder, unreadOnly = false, limit = 15, days } = {}) {
      const box = resolveBox(folder);
      const lim = Math.min(Math.max(Number(limit) || 15, 1), 50);
      const d = days ?? (unreadOnly ? null : 30);
      const key = JSON.stringify({ box, unreadOnly, lim, d });
      const cached = cache.get(key);
      if (cached) return cached;
      const r = await jxa(MAIL_LIST, { box, unreadOnly, limit: lim, days: d }, 60000);
      return cache.set(key, { folder: BOX_NAMES[box], total: r.total, unread: r.unread, messages: (r.messages || []).map((m) => item(box, m)) });
    },
    async search({ query, folder, limit = 10 }) {
      const q = String(query || '').trim();
      if (!q) throw new MacError('Wonach soll ich suchen?');
      const box = resolveBox(folder);
      const r = await jxa(MAIL_LIST, { box, query: q, limit: Math.min(Number(limit) || 10, 30), days: 365 }, 90000);
      return { folder: BOX_NAMES[box], total: r.total, messages: (r.messages || []).map((m) => item(box, m)) };
    },
    async read(id, { markRead = false } = {}) {
      const ref = parseId(id);
      const m = await jxa(MAIL_READ, { ...ref, markRead }, 60000);
      const base = item(ref.box, m);
      if (markRead) cache.clear();
      return { ...base, from: m.sender, replyTo: m.replyTo || '', to: (m.to || []).join(', '), cc: (m.cc || []).join(', '), text: m.content || '', attachments: m.attachments || [] };
    },
    async mark(id, { read, flagged }) {
      const ref = parseId(id);
      await jxa(MAIL_CHANGE, { ...ref, read: read ?? null, flagged: flagged ?? null }, 30000);
      cache.clear();
      return { ok: true };
    },
    async move(id, to) {
      const ref = parseId(id);
      const t = String(to || '').trim().toLowerCase();
      const target = /archiv/.test(t) ? 'archive' : resolveBox(t);
      const r = await jxa(MAIL_CHANGE, { ...ref, move: target }, 30000);
      if (r?.error === 'noArchive') throw new MacError('Ich finde keinen Archiv-Ordner in diesem Mail-Konto.');
      cache.clear();
      return { moved: true, folder: target === 'archive' ? 'Archiv' : BOX_NAMES[target] };
    },
    async folders() {
      return Object.values(BOX_NAMES).concat('Archiv');
    },
    // Neue Mail oder Antwort. send=false öffnet ein Fenster in der Mail-App zum Prüfen.
    async compose({ to, subject, body, send = false }) {
      let list;
      try {
        list = parseAddressList(to || '').filter((a) => /@/.test(a.address));
      } catch (err) {
        throw new MacError(err.message);
      }
      if (!list.length) throw new MacError('An wen soll die Mail gehen? (Mail-Adresse fehlt)');
      if (!String(body || '').trim()) throw new MacError('Die Mail ist leer.');
      const r = await jxa(MAIL_SEND, { to: list, subject: subject || '', body: String(body), send }, 60000);
      cache.clear();
      return { sent: Boolean(r?.sent), opened: Boolean(r?.opened), to: list.map((a) => a.address).join(', '), subject: subject || '' };
    },
    async replyInfo(id) {
      const m = await mail.read(id);
      const target = m.replyTo || m.from;
      const subj = /^(re|aw):/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
      return { to: target, subject: subj, original: m };
    },
    async draft({ to, subject, body, replyToId }) {
      let recipients = to;
      let subj = subject;
      if (replyToId) {
        const info = await mail.replyInfo(replyToId);
        recipients = recipients || info.to;
        subj = subj || info.subject;
      }
      const r = await mail.compose({ to: recipients, subject: subj, body, send: false });
      return { draftOpened: true, to: r.to, subject: r.subject, hint: 'Der Entwurf ist in der Mail-App geöffnet. Abschicken kannst du ihn dort.' };
    },
    reset() {
      cache.clear();
    },
  };
  return mail;
}

// ---------------------------------------------------------------- WhatsApp

const CORE_DATA_EPOCH = 978307200;
const cdToMs = (t) => (t === null || t === undefined ? null : Math.round((Number(t) + CORE_DATA_EPOCH) * 1000));
const msToCd = (ms) => ms / 1000 - CORE_DATA_EPOCH;
const MEDIA = { 1: 'Foto', 2: 'Video', 3: 'Sprachnachricht', 4: 'Kontakt', 5: 'Standort', 7: 'Link', 8: 'Dokument', 11: 'GIF', 14: 'Gelöschte Nachricht', 15: 'Sticker' };

export function phoneFromJid(jid) {
  const m = /^(\d{6,16})@s\.whatsapp\.net$/.exec(String(jid || ''));
  return m ? m[1] : null;
}

export function normalizePhone(raw, countryCode = '49') {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith('0')) s = `${countryCode}${s.slice(1)}`;
  return /^\d{7,15}$/.test(s) ? s : null;
}

export function createWhatsApp({ bridge, apps, stores, tz }) {
  const columns = new Map();

  async function query(sql, params = []) {
    await apps.ensure('whatsapp');
    const r = await bridge.call('whatsapp.query', { sql, params }, { timeoutMs: 30000 });
    const cols = r?.columns || [];
    return (r?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  }

  async function columnsOf(table) {
    if (!columns.has(table)) {
      const rows = await query(`PRAGMA table_info(${table})`);
      if (!rows.length) throw new MacError('Die WhatsApp-Daten haben ein unbekanntes Format. Ist WhatsApp für den Mac installiert und angemeldet?', 409);
      columns.set(table, new Set(rows.map((r) => r.name)));
    }
    return columns.get(table);
  }

  const isGroup = (jid) => /@g\.us$/.test(jid || '');

  function chatItem(r) {
    const lastMs = cdToMs(r.last);
    return {
      id: String(r.jid),
      name: r.name || phoneFromJid(r.jid) || 'Unbekannt',
      group: isGroup(r.jid),
      phone: phoneFromJid(r.jid),
      unread: Math.max(0, Number(r.unread) || 0),
      lastMs,
      last: lastMs ? msToLocalIso(lastMs, tz()) : '',
      lastText: r.lastText ? String(r.lastText).slice(0, 200) : r.lastType ? MEDIA[r.lastType] || 'Anhang' : '',
      lastFromMe: Boolean(r.lastFromMe),
    };
  }

  async function chats({ query: q, unreadOnly = false, limit = 15 } = {}) {
    const cols = await columnsOf('ZWACHATSESSION');
    const where = ['s.ZCONTACTJID IS NOT NULL', "s.ZCONTACTJID NOT LIKE '%broadcast%'", "s.ZCONTACTJID NOT LIKE 'status@%'"];
    if (cols.has('ZREMOVED')) where.push('(s.ZREMOVED IS NULL OR s.ZREMOVED = 0)');
    if (cols.has('ZHIDDEN')) where.push('(s.ZHIDDEN IS NULL OR s.ZHIDDEN = 0)');
    const params = [];
    if (q) {
      where.push('(s.ZPARTNERNAME LIKE ? OR s.ZCONTACTJID LIKE ?)');
      params.push(`%${q}%`, `%${String(q).replace(/\D/g, '') || q}%`);
    }
    if (unreadOnly && cols.has('ZUNREADCOUNT')) where.push('s.ZUNREADCOUNT > 0');
    const unread = cols.has('ZUNREADCOUNT') ? 's.ZUNREADCOUNT' : '0';
    const lim = Math.min(Math.max(Number(limit) || 15, 1), 50);
    const sql = `SELECT s.Z_PK AS pk, s.ZCONTACTJID AS jid, s.ZPARTNERNAME AS name, s.ZLASTMESSAGEDATE AS last, ${unread} AS unread,
      (SELECT m.ZTEXT FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK ORDER BY m.ZMESSAGEDATE DESC LIMIT 1) AS lastText,
      (SELECT m.ZMESSAGETYPE FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK ORDER BY m.ZMESSAGEDATE DESC LIMIT 1) AS lastType,
      (SELECT m.ZISFROMME FROM ZWAMESSAGE m WHERE m.ZCHATSESSION = s.Z_PK ORDER BY m.ZMESSAGEDATE DESC LIMIT 1) AS lastFromMe
      FROM ZWACHATSESSION s WHERE ${where.join(' AND ')} ORDER BY s.ZLASTMESSAGEDATE DESC LIMIT ${lim}`;
    return (await query(sql, params)).map(chatItem);
  }

  async function findChat(ref) {
    const r = String(ref || '').trim();
    if (!r) throw new MacError('Welcher Chat?');
    if (/@/.test(r)) {
      const hit = (await query('SELECT s.Z_PK AS pk, s.ZCONTACTJID AS jid, s.ZPARTNERNAME AS name, s.ZLASTMESSAGEDATE AS last, 0 AS unread FROM ZWACHATSESSION s WHERE s.ZCONTACTJID = ? LIMIT 1', [r]))[0];
      if (hit) return { ...chatItem(hit), pk: hit.pk };
    }
    const list = await chats({ query: r.replace(/^\+/, ''), limit: 10 });
    if (!list.length) return null;
    const exact = list.find((c) => c.name.toLowerCase() === r.toLowerCase()) || list[0];
    const pk = (await query('SELECT Z_PK AS pk FROM ZWACHATSESSION WHERE ZCONTACTJID = ? LIMIT 1', [exact.id]))[0]?.pk;
    return { ...exact, pk };
  }

  async function messages(ref, limit = 20) {
    const chat = await findChat(ref);
    if (!chat) throw new MacError(`Ich finde keinen WhatsApp-Chat mit „${ref}“.`, 404);
    const lim = Math.min(Math.max(Number(limit) || 20, 1), 60);
    const cols = await columnsOf('ZWAMESSAGE');
    const member = cols.has('ZGROUPMEMBER') ? 'gm.ZCONTACTNAME AS member' : 'NULL AS member';
    const join = cols.has('ZGROUPMEMBER') ? 'LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER' : '';
    const rows = await query(`SELECT m.Z_PK AS pk, m.ZISFROMME AS fromMe, m.ZTEXT AS text, m.ZMESSAGEDATE AS date, m.ZMESSAGETYPE AS type, ${member}
      FROM ZWAMESSAGE m ${join} WHERE m.ZCHATSESSION = ? AND (m.ZMESSAGETYPE IS NULL OR m.ZMESSAGETYPE <> 6) ORDER BY m.ZMESSAGEDATE DESC LIMIT ${lim}`, [chat.pk]);
    const zone = tz();
    return {
      chat,
      messages: rows.reverse().map((m) => ({
        id: m.pk,
        from: m.fromMe ? 'ich' : chat.group ? m.member || 'jemand' : chat.name,
        fromMe: Boolean(m.fromMe),
        text: m.text ? String(m.text).slice(0, 2000) : `[${MEDIA[m.type] || 'Anhang'}]`,
        at: m.date ? msToLocalIso(cdToMs(m.date), zone) : '',
        atMs: cdToMs(m.date),
      })),
    };
  }

  // Neue Nachrichten an mich seit einem Zeitpunkt (für Hinweise und To-dos)
  async function incomingSince(sinceMs, limit = 40) {
    const rows = await query(`SELECT m.Z_PK AS pk, m.ZTEXT AS text, m.ZMESSAGEDATE AS date, s.ZPARTNERNAME AS name, s.ZCONTACTJID AS jid
      FROM ZWAMESSAGE m JOIN ZWACHATSESSION s ON s.Z_PK = m.ZCHATSESSION
      WHERE m.ZISFROMME = 0 AND m.ZMESSAGEDATE > ? AND m.ZTEXT IS NOT NULL ORDER BY m.ZMESSAGEDATE ASC LIMIT ${Number(limit)}`, [msToCd(sinceMs)]);
    return rows.map((r) => ({ id: r.pk, text: String(r.text), atMs: cdToMs(r.date), name: r.name || phoneFromJid(r.jid) || 'Unbekannt', chatId: r.jid, group: isGroup(r.jid) }));
  }

  async function wasSent(chatId, text, sinceMs) {
    const rows = await query(`SELECT m.Z_PK AS pk FROM ZWAMESSAGE m JOIN ZWACHATSESSION s ON s.Z_PK = m.ZCHATSESSION
      WHERE m.ZISFROMME = 1 AND s.ZCONTACTJID = ? AND m.ZMESSAGEDATE >= ? AND m.ZTEXT = ? LIMIT 1`, [chatId, msToCd(sinceMs - 5000), text]);
    return rows.length > 0;
  }

  // Schickt eine Nachricht: WhatsApp öffnet den Chat mit dem Text, die Mac-App drückt „Senden“
  // (wenn die Bedienungshilfen erlaubt sind) – sonst drückst du Enter.
  async function send({ chatId, phone, name, text }) {
    const msg = String(text || '').trim();
    if (!msg) throw new MacError('Die Nachricht ist leer.');
    if (msg.length > 4000) throw new MacError('Die Nachricht ist zu lang.');
    await apps.ensure('whatsapp');
    const number = phone ? normalizePhone(phone, stores.config.data.countryCode) : phoneFromJid(chatId);
    const started = Date.now();
    const autoSend = apps.option('whatsapp', 'autoSend') === true;
    if (!number) {
      // Gruppen und Chats ohne Nummer: Text kopieren und WhatsApp öffnen
      await bridge.call('whatsapp.open', { text: msg }, { timeoutMs: 15000 });
      return { status: 'kopiert', to: name || chatId, hint: 'Der Text ist kopiert und WhatsApp ist offen – öffne den Chat und füge ihn mit ⌘V ein.' };
    }
    const r = await bridge.call('whatsapp.send', { phone: number, text: msg, autoSend }, { timeoutMs: 30000 });
    const target = chatId || `${number}@s.whatsapp.net`;
    if (r?.pressed) {
      for (let i = 0; i < 6; i++) {
        await new Promise((res) => setTimeout(res, 700));
        if (await wasSent(target, msg, started).catch(() => false)) return { status: 'gesendet', to: name || number };
      }
      return { status: 'geoeffnet', to: name || number, hint: 'WhatsApp ist offen. Falls die Nachricht noch im Eingabefeld steht, drück dort Enter.' };
    }
    return { status: 'geoeffnet', to: name || number, hint: autoSend ? 'WhatsApp ist offen – drück dort Enter zum Senden. (Für automatisches Senden braucht der Assistent die Bedienungshilfen.)' : 'WhatsApp ist offen und der Text steht schon drin – drück dort Enter zum Senden.' };
  }

  return {
    enabled: () => bridge.connected() && apps.isOn('whatsapp'),
    chats,
    findChat,
    messages,
    incomingSince,
    send,
    reset: () => columns.clear(),
  };
}
