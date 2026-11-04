// Werkzeuge, die Claude benutzen darf – gemeinsam für den Chat auf der Website
// und für den Connector (MCP) in der Claude-App.

import { todayIso, nowWall, localDateTimeToMs, parseIsoDate } from './lib/tz.js';

export class ToolInputError extends Error {}

const DATE = { type: 'string', description: 'Datum im Format JJJJ-MM-TT', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DATETIME = { type: 'string', description: 'Lokale Zeit im Format JJJJ-MM-TTTHH:MM, z. B. 2026-11-05T14:30 (bei ganztägig nur JJJJ-MM-TT)' };

function validate(schema, args) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const out = {};
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null || input[key] === '') throw new ToolInputError(`Angabe „${key}“ fehlt.`);
  }
  for (const [key, def] of Object.entries(schema.properties || {})) {
    let v = input[key];
    if (v === undefined || v === null) continue;
    if (def.type === 'string') {
      if (typeof v === 'number') v = String(v);
      if (typeof v !== 'string') throw new ToolInputError(`„${key}“ muss Text sein.`);
      if (def.maxLength && v.length > def.maxLength) throw new ToolInputError(`„${key}“ ist zu lang.`);
      if (def.enum && !def.enum.includes(v)) throw new ToolInputError(`„${key}“ muss eins davon sein: ${def.enum.join(', ')}.`);
      if (def.pattern && v !== '' && !new RegExp(def.pattern).test(v)) throw new ToolInputError(`„${key}“ hat das falsche Format (${def.description || def.pattern}).`);
    } else if (def.type === 'integer') {
      v = Number(v);
      if (!Number.isInteger(v)) throw new ToolInputError(`„${key}“ muss eine ganze Zahl sein.`);
      if (def.minimum !== undefined && v < def.minimum) v = def.minimum;
      if (def.maximum !== undefined && v > def.maximum) v = def.maximum;
    } else if (def.type === 'boolean') {
      if (typeof v === 'string') v = v === 'true';
      v = Boolean(v);
    }
    out[key] = v;
  }
  return out;
}

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

function shortEvent(e) {
  const out = { id: e.id, titel: e.title, beginn: e.start, ende: e.end, kalender: e.calendar };
  if (e.allDay) out.ganztaegig = true;
  if (e.location) out.ort = e.location;
  if (e.notes) out.notizen = e.notes.slice(0, 400);
  if (e.recurring) out.wiederkehrend = true;
  return out;
}

function shortTodo(t) {
  const out = { id: t.id, titel: t.title, erledigt: t.done };
  if (t.due) out.faellig = t.due;
  if (t.time) out.uhrzeit = t.time;
  if (t.priority === 'hoch') out.prioritaet = 'hoch';
  if (t.notes) out.notizen = t.notes;
  if (t.overdue) out.ueberfaellig = true;
  return out;
}

export const TOOLS = [
  {
    name: 'day_overview',
    title: 'Tagesüberblick',
    description: 'Überblick für einen Tag: Datum und Uhrzeit, offene To-dos, Termine, ungelesene Mails und Wetter. Gut als erster Schritt bei Fragen wie „Was steht heute an?“.',
    input_schema: obj({ date: { ...DATE, description: 'Tag (JJJJ-MM-TT), Standard: heute' } }),
    readOnly: true,
    async run(args, ctx) {
      const tz = ctx.services.tz();
      const date = args.date || todayIso(tz);
      const now = nowWall(tz);
      const out = { jetzt: `${now.date}T${now.time}`, zeitzone: tz, tag: date };
      out.todos = ctx.todos.list({ status: 'offen' }).filter((t) => !t.due || t.due <= date).slice(0, 40).map(shortTodo);
      const s = ctx.services;
      const tasks = [];
      if (s.calendar.enabled()) tasks.push(s.calendar.events(date, date).then((ev) => { out.termine = ev.map(shortEvent); }).catch((e) => { out.termine_fehler = e.message; }));
      if (s.mail.enabled()) tasks.push(s.mail.list({ unreadOnly: true, limit: 10 }).then((m) => { out.ungelesene_mails = { anzahl: m.total, neueste: m.messages.map(({ dateMs, ...r }) => r) }; }).catch((e) => { out.mail_fehler = e.message; }));
      if (s.weather.enabled()) tasks.push(s.weather.get().then((w) => { out.wetter = { ort: w.place, jetzt: `${Math.round(w.current.temp)} °C, ${w.current.text}`, heute: w.today }; }).catch((e) => { out.wetter_fehler = e.message; }));
      await Promise.all(tasks);
      return out;
    },
  },

  // ---------- To-dos ----------
  {
    name: 'todos_list',
    title: 'To-dos anzeigen',
    description: 'Listet die To-dos aus dem Dashboard. status: offen (Standard), heute (fällig bis heute), erledigt oder alle.',
    input_schema: obj({ status: { type: 'string', enum: ['offen', 'heute', 'erledigt', 'alle'] } }),
    readOnly: true,
    async run(args, ctx) {
      return { todos: ctx.todos.list({ status: args.status || 'offen' }).slice(0, 100).map(shortTodo) };
    },
  },
  {
    name: 'todo_add',
    title: 'To-do anlegen',
    description: 'Legt ein To-do im Dashboard an. Kurzer, klarer Titel (z. B. „Lena wegen Freitag antworten“). Optional Fälligkeit (JJJJ-MM-TT), Uhrzeit (HH:MM), Notizen und Priorität. Doppelte offene To-dos werden erkannt.',
    input_schema: obj({
      title: { type: 'string', maxLength: 200, description: 'Was zu tun ist' },
      due: DATE,
      time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Uhrzeit HH:MM' },
      notes: { type: 'string', maxLength: 2000 },
      priority: { type: 'string', enum: ['normal', 'hoch'] },
    }, ['title']),
    async run(args, ctx) {
      const t = ctx.todos.add(args, ctx.source);
      ctx.changed?.('todos');
      return t.duplicate ? { schon_vorhanden: true, todo: shortTodo(t) } : { angelegt: true, todo: shortTodo(t) };
    },
  },
  {
    name: 'todo_update',
    title: 'To-do ändern',
    description: 'Ändert ein To-do: abhaken (done: true), wieder öffnen (done: false), Titel, Fälligkeit, Uhrzeit, Notizen oder Priorität. Leerer Text bei due/time entfernt den Wert.',
    input_schema: obj({
      id: { type: 'string' },
      title: { type: 'string', maxLength: 200 },
      done: { type: 'boolean' },
      due: { type: 'string', description: 'JJJJ-MM-TT oder leer' },
      time: { type: 'string', description: 'HH:MM oder leer' },
      notes: { type: 'string', maxLength: 2000 },
      priority: { type: 'string', enum: ['normal', 'hoch'] },
    }, ['id']),
    async run(args, ctx) {
      const { id, ...patch } = args;
      const t = ctx.todos.update(id, patch);
      ctx.changed?.('todos');
      return { geaendert: true, todo: shortTodo(t) };
    },
  },
  {
    name: 'todo_delete',
    title: 'To-do löschen',
    description: 'Löscht ein To-do endgültig. Zum Abhaken stattdessen todo_update mit done: true benutzen.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
    destructive: true,
    async run(args, ctx) {
      const t = ctx.todos.remove(args.id);
      ctx.changed?.('todos');
      return { geloescht: true, titel: t.title };
    },
  },

  // ---------- Kalender ----------
  {
    name: 'calendar_events',
    title: 'Termine anzeigen',
    description: 'Termine aus dem iCloud-Kalender zwischen zwei Tagen (beide inklusive, höchstens 3 Monate). Optional nach Text filtern.',
    input_schema: obj({ from: DATE, to: { ...DATE, description: 'Letzter Tag (inklusive), Standard: wie from' }, query: { type: 'string', description: 'Nur Termine, deren Titel/Ort/Notizen diesen Text enthalten' } }, ['from']),
    requires: 'calendar',
    readOnly: true,
    async run(args, ctx) {
      let events = await ctx.services.calendar.events(args.from, args.to || args.from);
      if (args.query) {
        const q = args.query.toLowerCase();
        events = events.filter((e) => [e.title, e.location, e.notes].some((x) => (x || '').toLowerCase().includes(q)));
      }
      return { termine: events.slice(0, 150).map(shortEvent) };
    },
  },
  {
    name: 'calendar_is_free',
    title: 'Freie Zeit prüfen',
    description: 'Prüft, ob in einem Zeitraum Termine liegen – für Fragen wie „Hast du Freitag um 15 Uhr Zeit?“. Ohne Ende wird eine Stunde angenommen.',
    input_schema: obj({ start: DATETIME, end: DATETIME }, ['start']),
    requires: 'calendar',
    readOnly: true,
    async run(args, ctx) {
      const tz = ctx.services.tz();
      const startMs = localDateTimeToMs(args.start, tz);
      if (startMs === null) throw new ToolInputError('start bitte als JJJJ-MM-TTTHH:MM angeben.');
      const endMs = args.end ? localDateTimeToMs(args.end, tz) : startMs + 3600000;
      if (endMs === null || endMs <= startMs) throw new ToolInputError('Das Ende muss nach dem Beginn liegen.');
      const day = args.start.slice(0, 10);
      const lastDay = (args.end || args.start).slice(0, 10);
      const events = await ctx.services.calendar.events(day, lastDay < day ? day : lastDay);
      const clashes = events.filter((e) => !e.allDay && e.startMs < endMs && e.endMs > startMs);
      const allDay = events.filter((e) => e.allDay);
      return {
        frei: clashes.length === 0,
        ueberschneidungen: clashes.map(shortEvent),
        ganztaegige_termine_an_dem_tag: allDay.map(shortEvent),
        offene_todos_mit_uhrzeit: ctx.todos.list({ status: 'offen' }).filter((t) => t.due === day && t.time).map(shortTodo),
      };
    },
  },
  {
    name: 'calendar_list',
    title: 'Kalender anzeigen',
    description: 'Listet die Kalender (Name, ob nur lesbar).',
    input_schema: obj({}),
    requires: 'calendar',
    readOnly: true,
    async run(args, ctx) {
      const cals = await ctx.services.calendar.calendars();
      return { kalender: cals.map((c) => ({ name: c.name, nur_lesen: c.readOnly, im_dashboard: c.selected })) };
    },
  },
  {
    name: 'calendar_create_event',
    title: 'Termin eintragen',
    description: 'Trägt einen neuen Termin in den iCloud-Kalender ein. Zeiten sind lokale Zeit. Ohne Ende dauert der Termin eine Stunde. Ohne Kalenderangabe wird der Standardkalender benutzt.',
    input_schema: obj({
      title: { type: 'string', maxLength: 300 },
      start: DATETIME,
      end: DATETIME,
      all_day: { type: 'boolean', description: 'Ganztägig (dann start/end als JJJJ-MM-TT, end = letzter Tag)' },
      location: { type: 'string', maxLength: 300 },
      notes: { type: 'string', maxLength: 4000 },
      calendar: { type: 'string', description: 'Name des Kalenders (optional)' },
    }, ['title', 'start']),
    requires: 'calendar',
    async run(args, ctx) {
      const r = await ctx.services.calendar.create({ ...args, allDay: args.all_day });
      ctx.changed?.('calendar');
      return r;
    },
  },
  {
    name: 'calendar_update_event',
    title: 'Termin ändern',
    description: 'Ändert einen einzelnen (nicht wiederkehrenden) Termin: Titel, Beginn, Ende, Ort oder Notizen. Die id kommt aus calendar_events. Nur Beginn ändern verschiebt den Termin mit gleicher Dauer.',
    input_schema: obj({
      id: { type: 'string' },
      title: { type: 'string', maxLength: 300 },
      start: DATETIME,
      end: DATETIME,
      location: { type: 'string', maxLength: 300 },
      notes: { type: 'string', maxLength: 4000 },
    }, ['id']),
    requires: 'calendar',
    async run(args, ctx) {
      const r = await ctx.services.calendar.update(args);
      ctx.changed?.('calendar');
      return r;
    },
  },
  {
    name: 'calendar_delete_event',
    title: 'Termin löschen',
    description: 'Löscht einen einzelnen (nicht wiederkehrenden) Termin aus dem Kalender. Vorher immer nachfragen.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
    requires: 'calendar',
    destructive: true,
    async run(args, ctx) {
      const r = await ctx.services.calendar.remove(args.id);
      ctx.changed?.('calendar');
      return r;
    },
  },

  // ---------- Mail ----------
  {
    name: 'mail_list',
    title: 'Mails anzeigen',
    description: 'Listet Mails aus einem Ordner (Standard: Posteingang), neueste zuerst. unread_only für nur ungelesene, days begrenzt auf die letzten Tage.',
    input_schema: obj({
      folder: { type: 'string', description: 'z. B. Posteingang, Archiv, Entwürfe, Gesendet' },
      unread_only: { type: 'boolean' },
      days: { type: 'integer', minimum: 1, maximum: 365 },
      limit: { type: 'integer', minimum: 1, maximum: 30 },
    }),
    requires: 'mail',
    readOnly: true,
    async run(args, ctx) {
      const r = await ctx.services.mail.list({ folder: args.folder, unreadOnly: args.unread_only, days: args.days, limit: args.limit });
      return { ordner: r.folder, gesamt: r.total, mails: r.messages.map(({ dateMs, ...m }) => m) };
    },
  },
  {
    name: 'mail_read',
    title: 'Mail lesen',
    description: 'Liest eine Mail vollständig (Text, Absender, Empfänger, Anhänge). Markiert sie nicht als gelesen.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
    requires: 'mail',
    readOnly: true,
    async run(args, ctx) {
      const { dateMs, ...m } = await ctx.services.mail.read(args.id);
      return m;
    },
  },
  {
    name: 'mail_search',
    title: 'Mails suchen',
    description: 'Sucht Mails nach einem Begriff (Absender, Betreff, Text).',
    input_schema: obj({ query: { type: 'string' }, folder: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, ['query']),
    requires: 'mail',
    readOnly: true,
    async run(args, ctx) {
      const r = await ctx.services.mail.search(args);
      return { ordner: r.folder, treffer: r.total, mails: r.messages.map(({ dateMs, ...m }) => m) };
    },
  },
  {
    name: 'mail_mark',
    title: 'Mail markieren',
    description: 'Markiert eine Mail als gelesen/ungelesen (read) und/oder setzt/entfernt die Markierung (flagged).',
    input_schema: obj({ id: { type: 'string' }, read: { type: 'boolean' }, flagged: { type: 'boolean' } }, ['id']),
    requires: 'mail',
    async run(args, ctx) {
      const r = await ctx.services.mail.mark(args.id, { read: args.read, flagged: args.flagged });
      ctx.changed?.('mail');
      return r;
    },
  },
  {
    name: 'mail_move',
    title: 'Mail verschieben',
    description: 'Verschiebt eine Mail in einen Ordner, z. B. Archiv oder Papierkorb. Vor dem Papierkorb nachfragen.',
    input_schema: obj({ id: { type: 'string' }, to: { type: 'string', description: 'Archiv, Papierkorb, Spam oder ein Ordnername' } }, ['id', 'to']),
    requires: 'mail',
    async run(args, ctx) {
      const r = await ctx.services.mail.move(args.id, args.to);
      ctx.changed?.('mail');
      return r;
    },
  },
  {
    name: 'mail_create_draft',
    title: 'Mail-Entwurf schreiben',
    description: 'Speichert einen Mail-Entwurf im Ordner Entwürfe. Verschickt NICHTS – der Nutzer prüft und sendet selbst. Mit reply_to_id wird es eine Antwort (Empfänger und Betreff werden dann automatisch übernommen, wenn leer).',
    input_schema: obj({
      to: { type: 'string', description: 'Empfänger, z. B. "Lena <lena@example.com>"; bei Antworten optional' },
      cc: { type: 'string' },
      subject: { type: 'string', maxLength: 300 },
      body: { type: 'string', maxLength: 20000 },
      reply_to_id: { type: 'string', description: 'id der Mail, auf die geantwortet wird' },
    }, ['body']),
    requires: 'mail',
    async run(args, ctx) {
      const r = await ctx.services.mail.draft({ to: args.to, cc: args.cc, subject: args.subject, body: args.body, replyToId: args.reply_to_id });
      ctx.changed?.('mail');
      return r;
    },
  },
  {
    name: 'mail_folders',
    title: 'Mail-Ordner anzeigen',
    description: 'Listet die Mail-Ordner.',
    input_schema: obj({}),
    requires: 'mail',
    readOnly: true,
    async run(args, ctx) {
      return { ordner: await ctx.services.mail.folders() };
    },
  },

  // ---------- Wetter & Briefing ----------
  {
    name: 'weather_get',
    title: 'Wetter',
    description: 'Wetter am eingestellten Ort: jetzt, heute, morgen und die nächsten Stunden.',
    input_schema: obj({}),
    requires: 'weather',
    readOnly: true,
    async run(args, ctx) {
      const w = await ctx.services.weather.get();
      return { ort: w.place, jetzt: w.current, heute: w.today, morgen: w.tomorrow, stunden: w.hours.filter((h, i) => i % 3 === 0).slice(0, 12) };
    },
  },
  {
    name: 'briefing_save',
    title: 'Tagesbriefing speichern',
    description: 'Speichert das kurze Tagesbriefing, das oben im Dashboard steht (2–4 Sätze, Du-Form).',
    input_schema: obj({ text: { type: 'string', maxLength: 1200 } }, ['text']),
    async run(args, ctx) {
      const tz = ctx.services.tz();
      ctx.stores.state.update((s) => {
        s.briefing = { date: todayIso(tz), text: args.text.trim(), createdAt: Date.now() };
      });
      ctx.changed?.('briefing');
      return { gespeichert: true };
    },
  },
];

// Beim automatischen Tagesplan liest niemand mit – dann nur lesen, To-dos anlegen und das Briefing speichern.
const PLAN_TOOLS = new Set(['day_overview', 'todos_list', 'todo_add', 'calendar_events', 'calendar_is_free', 'calendar_list', 'mail_list', 'mail_read', 'mail_search', 'weather_get', 'briefing_save']);

export function availableTools(services, { purpose = 'chat' } = {}) {
  return TOOLS.filter((t) => {
    if (purpose === 'plan' && !PLAN_TOOLS.has(t.name)) return false;
    if (t.requires === 'calendar' && !services.calendar.enabled()) return false;
    if (t.requires === 'mail' && !services.mail.enabled()) return false;
    if (t.requires === 'weather' && !services.weather.enabled()) return false;
    if (t.name === 'briefing_save' && purpose === 'mcp') return false;
    return true;
  });
}

export async function runTool(name, rawArgs, ctx) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolInputError(`Unbekanntes Werkzeug: ${name}`);
  if (ctx.purpose === 'plan' && !PLAN_TOOLS.has(name)) throw new ToolInputError('Dieses Werkzeug ist beim automatischen Tagesplan nicht erlaubt.');
  const args = validate(tool.input_schema, rawArgs);
  if (args.from && !parseIsoDate(args.from)) throw new ToolInputError('from bitte als JJJJ-MM-TT angeben.');
  if (args.to && tool.name === 'calendar_events' && !parseIsoDate(args.to)) throw new ToolInputError('to bitte als JJJJ-MM-TT angeben.');
  return tool.run(args, ctx);
}

