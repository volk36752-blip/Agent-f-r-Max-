// Werkzeuge des Agenten – gemeinsam für den Chat (Claude oder Apple Intelligence)
// und für den Connector (MCP) in der Claude-App. Plugins bringen weitere Werkzeuge mit.

import { todayIso, nowWall, localDateTimeToMs, parseIsoDate } from './lib/tz.js';
import { currentRun } from './apps.js';

export class ToolInputError extends Error {}

const DATE = { type: 'string', description: 'Datum im Format JJJJ-MM-TT', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DATETIME = { type: 'string', description: 'Lokale Zeit im Format JJJJ-MM-TTTHH:MM, z. B. 2026-11-05T14:30 (bei ganztägig nur JJJJ-MM-TT)' };
const SUGGESTIONS = { type: 'array', items: { type: 'string', maxLength: 1500 }, minItems: 1, maxItems: 3, description: 'Genau drei kurze, unterschiedliche Vorschläge im Ton des Nutzers (z. B. zusagen, absagen, nachfragen)' };

export function validate(schema, args) {
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
    } else if (def.type === 'array') {
      if (typeof v === 'string') v = [v];
      if (!Array.isArray(v)) throw new ToolInputError(`„${key}“ muss eine Liste sein.`);
      v = v.map((x) => String(x ?? '').trim()).filter(Boolean);
      if (def.maxItems) v = v.slice(0, def.maxItems);
      if (def.minItems && v.length < def.minItems) throw new ToolInputError(`„${key}“ braucht mindestens ${def.minItems} Einträge.`);
    }
    out[key] = v;
  }
  return out;
}

export const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

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

const shortMail = ({ dateMs, ...m }) => m;
const shortChat = (c) => ({ id: c.id, name: c.name, gruppe: c.group || undefined, ungelesen: c.unread || undefined, zuletzt: c.last, letzte_nachricht: c.lastText, von_mir: c.lastFromMe || undefined });
const shortReminder = (r) => ({ id: r.id, titel: r.title, erledigt: r.done || undefined, faellig: r.due || undefined, uhrzeit: r.time || undefined, liste: r.list, notizen: r.notes || undefined, prioritaet: r.priority === 'hoch' ? 'hoch' : undefined });

function suggestionResult(action, extra = {}) {
  return {
    karte: action.id,
    an: action.to,
    vorschlaege: action.options,
    hinweis: 'Die Vorschläge stehen als Karte im Chat. Gesendet wird erst, wenn der Nutzer einen antippt. Sag nur kurz, dass du Vorschläge gemacht hast – wiederhole sie nicht.',
    ...extra,
  };
}

export const TOOLS = [
  {
    name: 'day_overview',
    title: 'Tagesüberblick',
    short: 'Überblick für einen Tag: To-dos, Termine, ungelesene Mails und WhatsApp, Wetter.',
    description: 'Überblick für einen Tag: Datum und Uhrzeit, offene To-dos, Termine, ungelesene Mails, ungelesene WhatsApp-Chats und Wetter. Gut als erster Schritt bei Fragen wie „Was steht heute an?“.',
    input_schema: obj({ date: { ...DATE, description: 'Tag (JJJJ-MM-TT), Standard: heute' } }),
    readOnly: true,
    async run(args, ctx) {
      const tz = ctx.services.tz();
      const date = args.date || todayIso(tz);
      const now = nowWall(tz);
      const out = { jetzt: `${now.date}T${now.time}`, zeitzone: tz, tag: date };
      out.todos = ctx.todos.list({ status: 'offen' }).filter((t) => !t.due || t.due <= date).slice(0, 30).map(shortTodo);
      const s = ctx.services;
      const tasks = [];
      if (s.calendar.enabled()) tasks.push(s.calendar.events(date, date).then((ev) => { out.termine = ev.map(shortEvent); }).catch((e) => { out.termine_fehler = e.message; }));
      if (s.mail.enabled()) tasks.push(s.mail.list({ unreadOnly: true, limit: 8 }).then((m) => { out.ungelesene_mails = { anzahl: m.total, neueste: m.messages.map(shortMail) }; }).catch((e) => { out.mail_fehler = e.message; }));
      if (s.whatsapp.enabled()) tasks.push(s.whatsapp.chats({ unreadOnly: true, limit: 6 }).then((c) => { out.ungelesene_whatsapp = c.map(shortChat); }).catch((e) => { out.whatsapp_fehler = e.message; }));
      if (s.weather.enabled()) tasks.push(s.weather.get().then((w) => { out.wetter = { ort: w.place, jetzt: `${Math.round(w.current.temp)} °C, ${w.current.text}`, heute: w.today }; }).catch((e) => { out.wetter_fehler = e.message; }));
      await Promise.all(tasks);
      return out;
    },
  },

  // ---------- To-dos ----------
  {
    name: 'todos_list',
    title: 'To-dos anzeigen',
    short: 'Listet die To-dos. status: offen, heute, erledigt oder alle.',
    description: 'Listet die To-dos aus dem Dashboard. status: offen (Standard), heute (fällig bis heute), erledigt oder alle.',
    input_schema: obj({ status: { type: 'string', enum: ['offen', 'heute', 'erledigt', 'alle'] } }),
    requires: 'todos',
    readOnly: true,
    async run(args, ctx) {
      return { todos: ctx.todos.list({ status: args.status || 'offen' }).slice(0, 100).map(shortTodo) };
    },
  },
  {
    name: 'todo_add',
    title: 'To-do anlegen',
    short: 'Legt ein To-do an (Titel, optional Datum JJJJ-MM-TT und Uhrzeit HH:MM).',
    description: 'Legt ein To-do im Dashboard an. Kurzer, klarer Titel (z. B. „Lena wegen Freitag antworten“). Optional Fälligkeit (JJJJ-MM-TT), Uhrzeit (HH:MM), Notizen und Priorität. Doppelte offene To-dos werden erkannt.',
    input_schema: obj({
      title: { type: 'string', maxLength: 200, description: 'Was zu tun ist' },
      due: DATE,
      time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Uhrzeit HH:MM' },
      notes: { type: 'string', maxLength: 2000 },
      priority: { type: 'string', enum: ['normal', 'hoch'] },
    }, ['title']),
    requires: 'todos',
    async run(args, ctx) {
      const t = ctx.todos.add(args, ctx.source);
      ctx.changed?.('todos');
      return t.duplicate ? { schon_vorhanden: true, todo: shortTodo(t) } : { angelegt: true, todo: shortTodo(t) };
    },
  },
  {
    name: 'todo_update',
    title: 'To-do ändern',
    short: 'Ändert ein To-do oder hakt es ab (done: true).',
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
    requires: 'todos',
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
    short: 'Löscht ein To-do (der Nutzer bestätigt per Karte).',
    description: 'Löscht ein To-do endgültig – der Nutzer bestätigt das mit einem Tipp auf eine Karte. Zum Abhaken stattdessen todo_update mit done: true benutzen.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
    requires: 'todos',
    destructive: true,
    confirm: (args, ctx) => ({ title: `To-do „${ctx.todos.get(args.id).title}“ löschen?`, label: 'Löschen' }),
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
    short: 'Termine von Tag from bis Tag to (JJJJ-MM-TT).',
    description: 'Termine aus dem Kalender zwischen zwei Tagen (beide inklusive, höchstens 3 Monate). Optional nach Text filtern.',
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
    short: 'Prüft, ob der Nutzer von start bis end (JJJJ-MM-TTTHH:MM) Zeit hat.',
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
    short: 'Listet die Kalender.',
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
    short: 'Trägt einen Termin ein (title, start JJJJ-MM-TTTHH:MM, optional end, location).',
    description: 'Trägt einen neuen Termin in den Kalender ein. Zeiten sind lokale Zeit. Ohne Ende dauert der Termin eine Stunde. Ohne Kalenderangabe wird der Standardkalender benutzt.',
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
    short: 'Ändert einen Termin (id aus calendar_events; title, start, end, location).',
    description: 'Ändert einen Termin: Titel, Beginn, Ende, Ort oder Notizen. Die id kommt aus calendar_events. Nur Beginn ändern verschiebt den Termin mit gleicher Dauer. Bei wiederkehrenden Terminen nur dieses eine Mal.',
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
    short: 'Löscht einen Termin (der Nutzer bestätigt per Karte).',
    description: 'Löscht einen Termin aus dem Kalender (bei wiederkehrenden nur dieses eine Mal). Der Nutzer bestätigt das mit einem Tipp auf eine Karte.',
    input_schema: obj({ id: { type: 'string' }, title: { type: 'string', description: 'Titel des Termins (für die Rückfrage)' } }, ['id']),
    requires: 'calendar',
    destructive: true,
    confirm: (args) => ({ title: `Termin${args.title ? ` „${args.title}“` : ''} löschen?`, label: 'Löschen' }),
    async run(args, ctx) {
      const r = await ctx.services.calendar.remove(args.id);
      ctx.changed?.('calendar');
      return r;
    },
  },

  // ---------- WhatsApp ----------
  {
    name: 'whatsapp_chats',
    title: 'WhatsApp-Chats',
    short: 'Listet WhatsApp-Chats (optional Suche nach Name, nur ungelesene).',
    description: 'Listet die WhatsApp-Chats, neueste zuerst: Name, ungelesene Nachrichten, letzte Nachricht. Mit query nach einem Namen suchen, mit unread_only nur Chats mit ungelesenen Nachrichten.',
    input_schema: obj({ query: { type: 'string', description: 'Name (oder Teil davon)' }, unread_only: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }),
    requires: 'whatsapp',
    readOnly: true,
    async run(args, ctx) {
      const list = await ctx.services.whatsapp.chats({ query: args.query, unreadOnly: args.unread_only, limit: args.limit || 12 });
      return { chats: list.map(shortChat) };
    },
  },
  {
    name: 'whatsapp_read',
    title: 'WhatsApp lesen',
    short: 'Liest die letzten Nachrichten eines WhatsApp-Chats (chat = Name).',
    description: 'Liest die letzten Nachrichten eines WhatsApp-Chats. chat ist der Name oder die id aus whatsapp_chats.',
    input_schema: obj({ chat: { type: 'string', description: 'Name oder id des Chats' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['chat']),
    requires: 'whatsapp',
    readOnly: true,
    async run(args, ctx) {
      const r = await ctx.services.whatsapp.messages(args.chat, args.limit || 15);
      return { chat: r.chat.name, gruppe: r.chat.group || undefined, nachrichten: r.messages.map((m) => ({ von: m.from, text: m.text, zeit: m.at })) };
    },
  },
  {
    name: 'whatsapp_suggest',
    title: 'WhatsApp-Vorschläge',
    short: 'Macht drei Vorschläge für eine WhatsApp-Nachricht an chat (Name). Gesendet wird erst nach Antippen.',
    description: 'Wenn der Nutzer jemandem per WhatsApp schreiben oder antworten will: Mach genau drei kurze, unterschiedliche Vorschläge. Sie erscheinen als Karte; gesendet wird erst, wenn der Nutzer einen antippt. chat ist der Name oder die id aus whatsapp_chats; ohne Chat geht auch eine Telefonnummer.',
    input_schema: obj({ chat: { type: 'string', description: 'Name oder id des Chats' }, phone: { type: 'string', description: 'Telefonnummer, falls es noch keinen Chat gibt' }, suggestions: SUGGESTIONS }, ['suggestions']),
    requires: 'whatsapp',
    async run(args, ctx) {
      const wa = ctx.services.whatsapp;
      let chat = args.chat ? await wa.findChat(args.chat).catch(() => null) : null;
      let phone = args.phone || chat?.phone || null;
      let name = chat?.name || args.chat || args.phone;
      if (!chat && !phone && args.chat && ctx.services.contacts.enabled()) {
        const people = await ctx.services.contacts.search(args.chat, 3).catch(() => []);
        const person = people.find((p) => p.phones?.length);
        if (person) {
          phone = person.phones.find((p) => /mobil|iphone|handy/i.test(p.label))?.value || person.phones[0].value;
          name = person.name;
        }
      }
      if (!chat && !phone) throw new ToolInputError(`Ich finde keinen WhatsApp-Chat und keine Nummer für „${args.chat || ''}“.`);
      const action = ctx.actions.create({
        kind: 'whatsapp',
        title: `WhatsApp an ${name}`,
        to: name,
        target: { chatId: chat?.id || null, phone: chat ? null : phone },
        options: args.suggestions,
      });
      return suggestionResult(action);
    },
  },

  // ---------- Mail ----------
  {
    name: 'mail_list',
    title: 'Mails anzeigen',
    short: 'Listet Mails im Posteingang (unread_only für ungelesene).',
    description: 'Listet Mails aus einem Ordner (Standard: Posteingang), neueste zuerst. unread_only für nur ungelesene, days begrenzt auf die letzten Tage.',
    input_schema: obj({
      folder: { type: 'string', description: 'z. B. Posteingang, Gesendet, Entwürfe, Papierkorb' },
      unread_only: { type: 'boolean' },
      days: { type: 'integer', minimum: 1, maximum: 365 },
      limit: { type: 'integer', minimum: 1, maximum: 30 },
    }),
    requires: 'mail',
    readOnly: true,
    async run(args, ctx) {
      const r = await ctx.services.mail.list({ folder: args.folder, unreadOnly: args.unread_only, days: args.days, limit: args.limit });
      return { ordner: r.folder, gesamt: r.total, mails: r.messages.map(shortMail) };
    },
  },
  {
    name: 'mail_read',
    title: 'Mail lesen',
    short: 'Liest eine Mail (id aus mail_list).',
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
    short: 'Sucht Mails nach Absender oder Betreff.',
    description: 'Sucht Mails nach einem Begriff (Absender, Betreff).',
    input_schema: obj({ query: { type: 'string' }, folder: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, ['query']),
    requires: 'mail',
    readOnly: true,
    async run(args, ctx) {
      const r = await ctx.services.mail.search(args);
      return { ordner: r.folder, treffer: r.total, mails: r.messages.map(shortMail) };
    },
  },
  {
    name: 'mail_mark',
    title: 'Mail markieren',
    short: 'Markiert eine Mail als gelesen/ungelesen oder setzt eine Markierung.',
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
    short: 'Verschiebt eine Mail ins Archiv, in den Papierkorb oder Spam.',
    description: 'Verschiebt eine Mail, z. B. ins Archiv, in den Papierkorb oder Spam. Beim Papierkorb bestätigt der Nutzer per Karte.',
    input_schema: obj({ id: { type: 'string' }, to: { type: 'string', description: 'Archiv, Papierkorb, Spam oder Posteingang' }, subject: { type: 'string', description: 'Betreff (für die Rückfrage)' } }, ['id', 'to']),
    requires: 'mail',
    confirm: (args) => (/papierkorb|trash|lösch/i.test(args.to) ? { title: `Mail${args.subject ? ` „${args.subject}“` : ''} in den Papierkorb legen?`, label: 'In den Papierkorb' } : null),
    async run(args, ctx) {
      const r = await ctx.services.mail.move(args.id, args.to);
      ctx.changed?.('mail');
      return r;
    },
  },
  {
    name: 'mail_suggest_reply',
    title: 'Antwort-Vorschläge',
    short: 'Macht drei Vorschläge für eine Antwort auf eine Mail (id). Gesendet wird erst nach Antippen.',
    description: 'Wenn der Nutzer auf eine Mail antworten will: Mach genau drei kurze, unterschiedliche Antwort-Vorschläge (nur der Text, ohne Betreff). Sie erscheinen als Karte; gesendet wird erst, wenn der Nutzer einen antippt.',
    input_schema: obj({ id: { type: 'string', description: 'id der Mail aus mail_list/mail_read' }, suggestions: SUGGESTIONS }, ['id', 'suggestions']),
    requires: 'mail',
    async run(args, ctx) {
      const info = await ctx.services.mail.replyInfo(args.id);
      const action = ctx.actions.create({ kind: 'mail', title: `Antwort an ${info.to}`, to: info.to, target: { to: info.to, subject: info.subject }, options: args.suggestions, detail: info.subject });
      return suggestionResult(action, { betreff: info.subject });
    },
  },
  {
    name: 'mail_suggest_new',
    title: 'Mail-Vorschläge',
    short: 'Macht drei Vorschläge für eine neue Mail (to, subject). Gesendet wird erst nach Antippen.',
    description: 'Wenn der Nutzer eine neue Mail schreiben will: Mach genau drei kurze, unterschiedliche Vorschläge für den Text. Empfänger als Mail-Adresse (findest du mit contacts_search). Gesendet wird erst, wenn der Nutzer einen antippt.',
    input_schema: obj({ to: { type: 'string', description: 'z. B. "Lena <lena@example.com>"' }, subject: { type: 'string', maxLength: 300 }, suggestions: SUGGESTIONS }, ['to', 'subject', 'suggestions']),
    requires: 'mail',
    async run(args, ctx) {
      const action = ctx.actions.create({ kind: 'mail', title: `Mail an ${args.to}`, to: args.to, target: { to: args.to, subject: args.subject }, options: args.suggestions, detail: args.subject });
      return suggestionResult(action, { betreff: args.subject });
    },
  },
  {
    name: 'mail_create_draft',
    title: 'Mail-Entwurf',
    short: 'Öffnet einen Mail-Entwurf zum Prüfen (to, subject, body).',
    description: 'Öffnet einen fertigen Mail-Entwurf zum Prüfen in der Mail-App (oder speichert ihn bei iCloud im Ordner Entwürfe). Verschickt nichts. Mit reply_to_id wird es eine Antwort.',
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

  // ---------- Erinnerungen & Kontakte ----------
  {
    name: 'reminders_list',
    title: 'Erinnerungen anzeigen',
    short: 'Listet die offenen Erinnerungen aus der Erinnerungen-App.',
    description: 'Listet die Erinnerungen aus der Erinnerungen-App (Standard: offene). Optional eine Liste (Name) und erledigte.',
    input_schema: obj({ list: { type: 'string', description: 'Name der Liste' }, include_done: { type: 'boolean' } }),
    requires: 'reminders',
    readOnly: true,
    async run(args, ctx) {
      const r = await ctx.services.reminders.list({ list: args.list, includeCompleted: args.include_done });
      return { erinnerungen: r.slice(0, 80).map(shortReminder) };
    },
  },
  {
    name: 'reminder_add',
    title: 'Erinnerung anlegen',
    short: 'Legt eine Erinnerung in der Erinnerungen-App an (title, optional due JJJJ-MM-TT, time HH:MM).',
    description: 'Legt eine Erinnerung in der Erinnerungen-App an – praktisch, wenn der Nutzer auf dem iPhone daran erinnert werden will. Optional Datum (JJJJ-MM-TT), Uhrzeit (HH:MM), Notizen und Liste.',
    input_schema: obj({ title: { type: 'string', maxLength: 300 }, due: DATE, time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, notes: { type: 'string', maxLength: 2000 }, list: { type: 'string' } }, ['title']),
    requires: 'reminders',
    async run(args, ctx) {
      const r = await ctx.services.reminders.add(args);
      ctx.changed?.('reminders');
      return { angelegt: true, erinnerung: shortReminder(r) };
    },
  },
  {
    name: 'reminder_done',
    title: 'Erinnerung abhaken',
    short: 'Hakt eine Erinnerung ab (id).',
    description: 'Hakt eine Erinnerung ab (done: true) oder öffnet sie wieder (done: false).',
    input_schema: obj({ id: { type: 'string' }, done: { type: 'boolean' } }, ['id']),
    requires: 'reminders',
    async run(args, ctx) {
      const r = await ctx.services.reminders.setDone(args.id, args.done !== false);
      ctx.changed?.('reminders');
      return { geaendert: true, erinnerung: shortReminder(r) };
    },
  },
  {
    name: 'contacts_search',
    title: 'Kontakt suchen',
    short: 'Sucht eine Person in den Kontakten (Telefon, Mail).',
    description: 'Sucht eine Person in den Kontakten und liefert Telefonnummern, Mail-Adressen und Geburtstag.',
    input_schema: obj({ query: { type: 'string', description: 'Name' } }, ['query']),
    requires: 'contacts',
    readOnly: true,
    async run(args, ctx) {
      const list = await ctx.services.contacts.search(args.query);
      return { kontakte: list.map((c) => ({ name: c.name, telefon: c.phones?.map((p) => `${p.label ? `${p.label}: ` : ''}${p.value}`), mail: c.emails?.map((e) => e.value), geburtstag: c.birthday || undefined })) };
    },
  },

  // Nur für den Connector in der Claude-App: Dort gibt es keine Karten zum Antippen.
  {
    name: 'card_run',
    title: 'Vorschlag ausführen',
    description: 'Führt eine Karte aus (z. B. WhatsApp- oder Mail-Vorschlag senden, Löschen bestätigen) – NUR nachdem der Nutzer in diesem Gespräch ausdrücklich gesagt hat, welchen Vorschlag er will. choice ist 1, 2 oder 3; alternativ text für einen selbst formulierten Text.',
    input_schema: obj({ card: { type: 'string', description: 'karte aus dem Vorschlags-Ergebnis' }, choice: { type: 'integer', minimum: 1, maximum: 4 }, text: { type: 'string', maxLength: 4000 } }, ['card']),
    mcpOnly: true,
    async run(args, ctx) {
      const a = await ctx.actions.run(args.card, { choice: args.choice ? args.choice - 1 : undefined, text: args.text });
      ctx.changed?.('actions');
      return { status: a.status, gesendet: a.chosen || undefined, hinweis: a.result?.hint || undefined };
    },
  },

  // ---------- Wetter & Briefing ----------
  {
    name: 'weather_get',
    title: 'Wetter',
    short: 'Wetter am Ort des Nutzers: jetzt, heute, morgen.',
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
    short: 'Speichert das Tagesbriefing (2–4 Sätze).',
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
const PLAN_TOOLS = new Set(['day_overview', 'todos_list', 'todo_add', 'calendar_events', 'calendar_is_free', 'calendar_list', 'mail_list', 'mail_read', 'mail_search', 'whatsapp_chats', 'whatsapp_read', 'reminders_list', 'weather_get', 'briefing_save']);

export function allTools(services) {
  return [...TOOLS, ...(services.plugins?.tools() || [])];
}

export function findTool(name, services) {
  return allTools(services).find((t) => t.name === name) || null;
}

function requirementMet(req, services) {
  if (!req) return true;
  if (req === 'todos') return services.apps ? services.apps.isOn('todos') : true;
  if (req === 'weather') return services.weather.enabled() && (services.apps ? services.apps.isOn('wetter') : true);
  if (typeof req === 'function') return req(services);
  return Boolean(services[req]?.enabled?.());
}

export function availableTools(services, { purpose = 'chat' } = {}) {
  return allTools(services).filter((t) => {
    if (purpose === 'plan' && !PLAN_TOOLS.has(t.name)) return false;
    if (!requirementMet(t.requires, services)) return false;
    if (t.name === 'briefing_save' && purpose === 'mcp') return false;
    if (t.mcpOnly && purpose !== 'mcp') return false;
    if (t.needsActions && purpose === 'plan') return false;
    return true;
  });
}

export async function runTool(name, rawArgs, ctx) {
  const tool = findTool(name, ctx.services);
  if (!tool) throw new ToolInputError(`Unbekanntes Werkzeug: ${name}`);
  if (ctx.purpose === 'plan' && !PLAN_TOOLS.has(name)) throw new ToolInputError('Dieses Werkzeug ist beim automatischen Tagesplan nicht erlaubt.');
  if (tool.mcpOnly && ctx.purpose !== 'mcp') throw new ToolInputError('Dieses Werkzeug gibt es nur im Connector.');
  if (!requirementMet(tool.requires, ctx.services)) throw new ToolInputError(`${tool.title} ist gerade nicht verfügbar (App ausgeschaltet oder nicht verbunden).`);
  const args = validate(tool.input_schema, rawArgs);
  if (args.from && !parseIsoDate(args.from)) throw new ToolInputError('from bitte als JJJJ-MM-TT angeben.');
  if (args.to && tool.name === 'calendar_events' && !parseIsoDate(args.to)) throw new ToolInputError('to bitte als JJJJ-MM-TT angeben.');
  // Löschen & Co.: erst nach einem Tipp auf die Karte
  if (tool.confirm && ctx.purpose !== 'action' && ctx.actions) {
    const c = tool.confirm(args, ctx);
    if (c) {
      const action = ctx.actions.create({ kind: 'confirm', title: c.title, target: { tool: tool.name, args }, options: [], allowEdit: false, confirmLabel: c.label || 'Ja' });
      return { bestaetigung_noetig: true, karte: action.id, frage: c.title, hinweis: 'Der Nutzer bestätigt das mit einem Tipp auf die Karte im Chat. Sag nur kurz, dass er es dort bestätigen kann.' };
    }
  }
  const run = currentRun();
  return tool.run(args, { ...ctx, emit: ctx.emit || run.emit });
}
