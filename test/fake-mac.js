// Spielt die Mac-App: holt Aufträge über die Brücke ab und beantwortet sie –
// mit einem Kalender im Speicher, einer WhatsApp-Datenbank (SQLite) und einem „Apple Intelligence“,
// das nach einem Drehbuch Werkzeuge aufruft.

import { DatabaseSync } from 'node:sqlite';

const CD = 978307200;
export const toCd = (ms) => ms / 1000 - CD;

export function createWhatsAppDb(file, now = Date.now()) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT, ZLASTMESSAGEDATE REAL, ZUNREADCOUNT INTEGER, ZSESSIONTYPE INTEGER, ZREMOVED INTEGER, ZHIDDEN INTEGER);
    CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZISFROMME INTEGER, ZTEXT TEXT, ZMESSAGEDATE REAL, ZMESSAGETYPE INTEGER, ZFROMJID TEXT, ZGROUPMEMBER INTEGER);
    CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZMEMBERJID TEXT, ZCONTACTNAME TEXT);
  `);
  const chat = db.prepare('INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME, ZLASTMESSAGEDATE, ZUNREADCOUNT, ZSESSIONTYPE) VALUES (?, ?, ?, ?, ?, ?)');
  chat.run(1, '491701234567@s.whatsapp.net', 'Lisa', toCd(now - 60000), 1, 0);
  chat.run(2, '120363000000@g.us', 'Familie', toCd(now - 3600000), 0, 1);
  chat.run(3, '98765@lid', 'Tom', toCd(now - 7200000), 0, 0);
  chat.run(4, 'status@broadcast', null, toCd(now), 0, 3);
  db.prepare('INSERT INTO ZWAGROUPMEMBER (Z_PK, ZMEMBERJID, ZCONTACTNAME) VALUES (1, ?, ?)').run('491711111111@s.whatsapp.net', 'Mama');
  const msg = db.prepare('INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZISFROMME, ZTEXT, ZMESSAGEDATE, ZMESSAGETYPE, ZGROUPMEMBER) VALUES (?, ?, ?, ?, ?, ?)');
  msg.run(1, 1, 'Hey, wie geht’s?', toCd(now - 120000), 0, null);
  msg.run(1, 0, 'Hast du morgen Zeit für einen Kaffee?', toCd(now - 60000), 0, null);
  msg.run(2, 0, 'Sonntag Essen bei uns?', toCd(now - 3600000), 0, 1);
  msg.run(2, 0, null, toCd(now - 3500000), 1, 1);
  msg.run(3, 0, 'Bis später', toCd(now - 7200000), 0, null);
  return db;
}

export function startFakeMac({ base, key, db, ai = { available: true }, permissions = {}, script = {} }) {
  const calls = [];
  const notifications = [];
  const sent = [];
  const perms = { calendar: 'unknown', reminders: 'unknown', contacts: 'unknown', mail: 'unknown', whatsapp: 'unknown', accessibility: 'denied', notes: 'unknown', music: 'unknown', ...permissions };
  const events = [];
  let nextId = 1;
  let stopped = false;
  const controller = new AbortController();
  const headers = { 'x-assistent-app': key, 'x-assistent': '1', 'content-type': 'application/json' };
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal }).then((r) => r.json());

  const handlers = {
    permissions: () => ({ ...perms }),
    'permission.request': ({ kind }) => {
      if (perms[kind] === 'unknown') perms[kind] = script.deny?.includes(kind) ? 'denied' : 'granted';
      return { status: perms[kind] };
    },
    'calendar.calendars': () => ({ calendars: [{ id: 'cal-1', title: 'Privat', color: '#ff7a1f', writable: true, source: 'iCloud', isDefault: true }, { id: 'cal-2', title: 'Feiertage', color: '#3fd17a', writable: false, source: 'Abonniert' }] }),
    'calendar.events': ({ fromMs, toMs }) => ({ events: events.filter((e) => e.startMs < toMs && e.endMs > fromMs) }),
    'calendar.create': (a) => {
      const e = { id: `ev-${nextId++}`, title: a.title, startMs: a.startMs, endMs: a.endMs, allDay: Boolean(a.allDay), startDate: a.startDate, endDate: a.endDate, location: a.location, notes: a.notes, calendar: 'Privat', calendarId: a.calendarId, writable: true };
      events.push(e);
      return { event: e };
    },
    'calendar.update': (a) => {
      const e = events.find((x) => x.id === a.id);
      if (!e) throw Object.assign(new Error('Termin nicht gefunden.'), { code: 'notFound' });
      const dur = e.endMs - e.startMs;
      if (a.title !== undefined) e.title = a.title;
      if (a.startMs !== undefined) {
        e.startMs = a.startMs;
        e.endMs = a.endMs ?? a.startMs + dur;
      }
      return { event: e };
    },
    'calendar.delete': (a) => {
      const i = events.findIndex((x) => x.id === a.id);
      if (i >= 0) events.splice(i, 1);
      return { ok: true };
    },
    'contacts.search': ({ query }) => ({ contacts: /anna/i.test(query) ? [{ id: 'c1', name: 'Anna Berg', phones: [{ label: 'Mobil', value: '0172 5555555' }], emails: [{ label: 'privat', value: 'anna@example.com' }] }] : [] }),
    'whatsapp.query': ({ sql, params }) => {
      const rows = db.prepare(sql).all(...(params || []));
      const columns = rows.length ? Object.keys(rows[0]) : [];
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
    },
    'whatsapp.send': ({ phone, text, autoSend }) => {
      sent.push({ phone, text, autoSend });
      if (!autoSend) return { opened: true, pressed: false };
      const chat = db.prepare('SELECT Z_PK AS pk FROM ZWACHATSESSION WHERE ZCONTACTJID = ?').get(`${phone}@s.whatsapp.net`);
      if (chat) db.prepare('INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZISFROMME, ZTEXT, ZMESSAGEDATE, ZMESSAGETYPE) VALUES (?, 1, ?, ?, 0)').run(chat.pk, text, toCd(Date.now()));
      return { opened: true, pressed: true };
    },
    'whatsapp.open': ({ text }) => {
      sent.push({ copied: text });
      return { opened: true };
    },
    notify: (a) => {
      notifications.push(a);
      return { ok: true };
    },
    // „Apple Intelligence“: ruft nach Drehbuch Werkzeuge über den Server auf
    'ai.respond': async (a) => {
      const plan = script.ai?.(a) || { text: 'Okay.' };
      for (const step of plan.tools || []) {
        const r = await post('/api/intern/tool', { runId: a.runId, name: step.name, arguments: JSON.stringify(step.args || {}) });
        step.output = r.output;
      }
      return { text: typeof plan.text === 'function' ? plan.text(plan.tools) : plan.text };
    },
  };

  async function handle(req) {
    calls.push(req);
    try {
      const fn = handlers[req.cmd];
      if (!fn) throw Object.assign(new Error(`Unbekannter Befehl ${req.cmd}`), { code: 'unknown' });
      const result = await fn(req.args || {});
      await post('/api/intern/bridge/result', { id: req.id, ok: true, result });
    } catch (err) {
      if (stopped) return;
      await post('/api/intern/bridge/result', { id: req.id, ok: false, error: err.message, code: err.code || 'error' }).catch(() => {});
    }
  }

  async function loop() {
    await post('/api/intern/bridge/hello', { version: 'test', ai });
    while (!stopped) {
      try {
        const res = await fetch(`${base}/api/intern/bridge/next`, { headers, signal: controller.signal });
        const data = await res.json();
        for (const req of data.requests || []) handle(req);
      } catch {
        if (stopped) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
  const running = loop();

  return {
    calls,
    notifications,
    sent,
    perms,
    events,
    async stop() {
      stopped = true;
      controller.abort();
      await running.catch(() => {});
    },
  };
}
