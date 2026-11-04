import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { startCalDAV, startImap, startClaude, startWeather } from './mocks.js';
import { todayIso, addDaysIso } from '../src/lib/tz.js';

const TZ = 'Europe/Berlin';
const APPLE_ID = 'test@example.com';
const MAIL = 'tester@icloud.com';
const APP_PW = 'abcd-efgh-ijkl-mnop';
const API_KEY = 'sk-ant-test-123';

let caldav;
let imap;
let claude;
let weather;
let app;
let base;
let dataDir;
let cookieJar = '';
const today = todayIso(TZ);
const tomorrow = addDaysIso(today, 1);
const stamp = (d) => d.replace(/-/g, '');

async function api(method, url, body, { headers = {}, raw = false } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'x-assistent': '1', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookieJar ? { cookie: cookieJar } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookieJar = set.split(';')[0];
  if (raw) return res;
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function claudeScript(body) {
  const last = body.messages[body.messages.length - 1];
  const isResult = Array.isArray(last.content) && last.content[0]?.type === 'tool_result';
  const firstUser = body.messages.find((m) => m.role === 'user' && typeof m.content === 'string')?.content || '';
  if (firstUser.startsWith('Erstelle meinen Tagesplan')) {
    const steps = body.messages.filter((m) => m.role === 'assistant').length;
    if (steps === 0) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'p1', name: 'day_overview', input: {} }] };
    if (steps === 1) {
      return {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ich lege To-dos an.' },
          { type: 'tool_use', id: 'p2', name: 'todo_add', input: { title: 'Lena antworten: Treffen Freitag?', due: today } },
          { type: 'tool_use', id: 'p3', name: 'briefing_save', input: { text: 'Heute ein Termin um 10 Uhr. Eine Mail von Lena wartet auf Antwort.' } },
        ],
      };
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fertig – 1 neues To-do.' }] };
  }
  if (!isResult) {
    return {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'calendar_is_free', input: { start: `${tomorrow}T15:00` } },
        { type: 'tool_use', id: 't2', name: 'todo_add', input: { title: 'Lena zurückschreiben', due: today, priority: 'hoch' } },
      ],
    };
  }
  const free = JSON.parse(last.content[0].content).frei;
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: free ? 'Morgen um 15 Uhr bist du frei.' : 'Da hast du schon was.' }] };
}

before(async () => {
  caldav = await startCalDAV({ user: APPLE_ID, password: APP_PW });
  imap = await startImap({ user: MAIL, password: APP_PW });
  claude = await startClaude({ apiKey: API_KEY, script: claudeScript });
  weather = await startWeather();
  process.env.ICLOUD_CALDAV_URL = caldav.url;
  process.env.ICLOUD_IMAP_HOST = '127.0.0.1';
  process.env.ICLOUD_IMAP_PORT = String(imap.port);
  process.env.ICLOUD_IMAP_SECURE = 'false';
  process.env.ANTHROPIC_BASE_URL = claude.url;
  process.env.WEATHER_API_BASE = weather.url;
  process.env.GEOCODING_API_BASE = weather.url;

  caldav.add('/123/calendars/privat/termin1.ics', `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:termin1\r\nDTSTART;TZID=Europe/Berlin:${stamp(today)}T100000\r\nDTEND;TZID=Europe/Berlin:${stamp(today)}T110000\r\nSUMMARY:Zahnarzt\r\nLOCATION:Praxis\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  caldav.add('/123/calendars/privat/serie.ics', `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:serie\r\nDTSTART;TZID=Europe/Berlin:20260101T070000\r\nDTEND;TZID=Europe/Berlin:20260101T073000\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Joggen\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  caldav.add('/123/calendars/feiertage/f.ics', `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:f1\r\nDTSTART;VALUE=DATE:${stamp(tomorrow)}\r\nSUMMARY:Feiertag\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  imap.add('INBOX', 'From: Lena <lena@example.com>\r\nTo: tester@icloud.com\r\nSubject: =?UTF-8?Q?Hast_du_Freitag_Zeit=3F?=\r\nDate: Wed, 4 Nov 2026 09:15:00 +0100\r\nMessage-ID: <lena-1@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHi! Hast du Freitag um 15 Uhr Zeit für einen Kaffee? Grüße, Lena');
  imap.add('INBOX', 'From: Newsletter <news@shop.de>\r\nTo: tester@icloud.com\r\nSubject: Angebote\r\nDate: Tue, 3 Nov 2026 08:00:00 +0100\r\n\r\nRabatt!', { seen: true });

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistent-test-'));
  const { createApp } = await import('../src/app.js');
  app = createApp({ dataDir, log: { log() {}, error: console.error } });
  app.stores.config.update((c) => {
    c.timezone = TZ;
  });
  await app.listen(0);
  base = `http://127.0.0.1:${app.port}`;
});

after(async () => {
  await app.close();
  await Promise.all([caldav.close(), imap.close(), claude.close(), weather.close()]);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Einrichtung: Passwort, Anmeldung, Schutz', async () => {
  let r = await api('GET', '/api/status');
  assert.equal(r.data.needsPassword, true);
  r = await api('GET', '/api/dashboard');
  assert.equal(r.status, 401);
  r = await api('POST', '/api/setup/password', { password: 'kurz' });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/setup/password', { password: 'sicheres-passwort' });
  assert.equal(r.status, 200);
  assert.ok(cookieJar.startsWith('assistent_sitzung='));
  r = await api('POST', '/api/todos', { title: 'x' }, { headers: { 'x-assistent': '' } });
  assert.equal(r.status, 403, 'ohne Schutz-Kopfzeile abgelehnt');
  r = await api('POST', '/api/todos', { title: 'x' }, { headers: { origin: 'https://boese.example' } });
  assert.equal(r.status, 403, 'fremde Seite abgelehnt');
  const saved = cookieJar;
  cookieJar = '';
  r = await api('POST', '/api/login', { password: 'falsch' });
  assert.equal(r.status, 401);
  r = await api('POST', '/api/login', { password: 'sicheres-passwort' });
  assert.equal(r.status, 200);
  assert.notEqual(cookieJar, saved);
  const secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'geheim.json'), 'utf8'));
  assert.match(secrets.passwordHash, /^scrypt\$/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dataDir, 'geheim.json')).mode & 0o777, 0o600);
});

test('Verbindungen: iCloud, Wetter, Claude', async () => {
  let r = await api('PUT', '/api/connections/icloud', { appleId: APPLE_ID, mailAddress: MAIL, appPassword: 'falsch-falsch', calendar: true, mail: false });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Anmeldung beim Kalender fehlgeschlagen/);
  r = await api('PUT', '/api/connections/icloud', { appleId: APPLE_ID, mailAddress: MAIL, appPassword: APP_PW, calendar: true, mail: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.calendars, 2, 'nur Kalender mit Terminen, ohne Erinnerungen');
  assert.equal(r.data.inbox, 2);
  r = await api('GET', '/api/weather/places?q=Tübingen');
  assert.equal(r.data.places[0].name, 'Tübingen');
  r = await api('PUT', '/api/connections/weather', r.data.places[0]);
  assert.equal(r.status, 200);
  r = await api('PUT', '/api/connections/claude', { apiKey: 'sk-ant-falsch', model: 'claude-haiku-5-5' });
  assert.equal(r.status, 400);
  r = await api('PUT', '/api/connections/claude', { apiKey: API_KEY, model: 'claude-haiku-5-5' });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/connections');
  assert.deepEqual(Object.fromEntries(Object.entries(r.data.status).map(([k, v]) => [k, v.connected ?? v.ready])), { calendar: true, mail: true, weather: true, claude: true, connector: true });
  assert.equal(JSON.stringify(r.data).includes(APP_PW), false, 'Passwort wird nie zurückgeschickt');
  assert.equal(JSON.stringify(r.data).includes(API_KEY), false, 'Schlüssel wird nie zurückgeschickt');
  r = await api('POST', '/api/setup/finish');
  assert.equal(r.status, 200);
});

test('Dashboard zeigt Termine, Mails, Wetter', async () => {
  const r = await api('GET', '/api/dashboard');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const titles = r.data.events.today.map((e) => e.title);
  assert.deepEqual(titles, ['Joggen', 'Zahnarzt']);
  assert.equal(r.data.events.today[1].start, `${today}T10:00`);
  assert.deepEqual(r.data.events.tomorrow.map((e) => e.title), ['Feiertag', 'Joggen']);
  assert.equal(r.data.mail.total, 1);
  assert.equal(r.data.mail.messages[0].subject, 'Hast du Freitag Zeit?');
  assert.equal(r.data.weather.current.text, 'Bedeckt');
  assert.equal(r.data.weather.place, 'Tübingen');
});

test('Kalender: Termin eintragen, ändern, löschen', async () => {
  const { stores, services } = app;
  assert.ok(stores);
  const created = await services.calendar.create({ title: 'Kaffee mit Lena', start: `${tomorrow}T15:00`, location: 'Café Mitte' });
  assert.equal(created.calendar, 'Privat');
  assert.equal(created.end, `${tomorrow}T16:00`);
  let evs = await services.calendar.events(tomorrow, tomorrow);
  const ev = evs.find((e) => e.title === 'Kaffee mit Lena');
  assert.ok(ev);
  await services.calendar.update({ id: ev.id, start: `${tomorrow}T16:30` });
  evs = await services.calendar.events(tomorrow, tomorrow);
  const moved = evs.find((e) => e.title === 'Kaffee mit Lena');
  assert.equal(moved.start, `${tomorrow}T16:30`);
  assert.equal(moved.end, `${tomorrow}T17:30`);
  const serie = evs.find((e) => e.title === 'Joggen');
  await assert.rejects(services.calendar.update({ id: serie.id, title: 'x' }), /Wiederkehrende Termine/);
  const holiday = evs.find((e) => e.title === 'Feiertag');
  await assert.rejects(services.calendar.remove(holiday.id), /nur gelesen/);
  await assert.rejects(services.calendar.create({ title: 'x', start: `${tomorrow}T15:00`, calendar: 'Feiertage' }), /nicht schreiben/);
  await services.calendar.remove(moved.id);
  evs = await services.calendar.events(tomorrow, tomorrow);
  assert.equal(evs.some((e) => e.title === 'Kaffee mit Lena'), false);
  const allDay = await services.calendar.create({ title: 'Urlaub', start: tomorrow, end: addDaysIso(tomorrow, 2), allDay: true });
  assert.equal(allDay.end, addDaysIso(tomorrow, 2));
});

test('Mail: lesen, Entwurf, markieren, verschieben', async () => {
  const { services } = app;
  const list = await services.mail.list({ unreadOnly: true });
  const lena = list.messages[0];
  assert.equal(lena.from, 'Lena');
  const full = await services.mail.read(lena.id);
  assert.match(full.text, /Freitag um 15 Uhr/);
  assert.equal(imap.boxes.INBOX.msgs[0].flags.has('\\Seen'), false, 'Lesen markiert nicht als gelesen');
  const draft = await services.mail.draft({ body: 'Hi Lena, Freitag passt!', replyToId: lena.id });
  assert.equal(draft.to, 'Lena <lena@example.com>');
  assert.equal(draft.subject, 'Re: Hast du Freitag Zeit?');
  const saved = imap.boxes.Drafts.msgs[0];
  assert.ok(saved.flags.has('\\Draft'));
  assert.match(saved.raw.toString(), /In-Reply-To: <lena-1@example.com>/);
  const search = await services.mail.search({ query: 'Kaffee' });
  assert.equal(search.total, 1);
  await services.mail.mark(lena.id, { read: true });
  assert.equal(imap.boxes.INBOX.msgs[0].flags.has('\\Seen'), true);
  const news = (await services.mail.list({})).messages.find((m) => m.from === 'Newsletter');
  const moved = await services.mail.move(news.id, 'Archiv');
  assert.equal(moved.folder, 'Archive');
  assert.equal(imap.boxes.Archive.msgs.length, 1);
  await assert.rejects(services.mail.move(lena.id, 'Gibtsnicht'), /nicht gefunden/);
  assert.ok(!imap.commands.some((c) => /EXPUNGE|DELETE/.test(c)), 'nichts wird endgültig gelöscht');
});

test('To-dos über die API', async () => {
  let r = await api('POST', '/api/todos', { title: '  Einkaufen   gehen ', due: today, time: '18:00' });
  assert.equal(r.data.todo.title, 'Einkaufen gehen');
  const id = r.data.todo.id;
  r = await api('POST', '/api/todos', { title: 'x', due: '2026-13-01' });
  assert.equal(r.status, 400);
  r = await api('PATCH', `/api/todos/${id}`, { done: true });
  assert.equal(r.data.todo.done, true);
  assert.ok(r.data.todo.doneAt);
  r = await api('GET', '/api/dashboard');
  assert.ok(r.data.todos.some((t) => t.id === id && t.done), 'heute Erledigtes bleibt sichtbar');
  r = await api('DELETE', `/api/todos/${id}`);
  assert.equal(r.status, 200);
  r = await api('DELETE', `/api/todos/${id}`);
  assert.equal(r.status, 404);
});

test('Chat mit Claude benutzt Werkzeuge', async () => {
  const r = await api('POST', '/api/chat', { message: 'Hab ich morgen um 15 Uhr Zeit? Und erinnere mich, Lena zu schreiben.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.reply, 'Morgen um 15 Uhr bist du frei.');
  assert.deepEqual(r.data.tools.map((t) => t.name), ['calendar_is_free', 'todo_add']);
  const first = claude.requests[claude.requests.length - 2];
  assert.equal(first.headers['anthropic-version'], '2026-10-21');
  assert.equal(first.body.model, 'claude-haiku-5-5');
  assert.deepEqual(first.body.cache_control, { type: 'ephemeral' });
  assert.ok(first.body.tools.some((t) => t.name === 'mail_create_draft'));
  assert.match(first.body.system, /verschickst niemals Mails/);
  assert.equal('temperature' in first.body, false);
  const second = claude.requests[claude.requests.length - 1];
  const results = second.body.messages[second.body.messages.length - 1].content;
  assert.equal(results.length, 2);
  assert.equal(results.every((b) => !b.is_error), true, JSON.stringify(results));
  const todos = app.todos.list();
  const t = todos.find((x) => x.title === 'Lena zurückschreiben');
  assert.equal(t.source, 'agent');
  assert.equal(t.priority, 'hoch');
  const log = await api('GET', '/api/chat');
  assert.equal(log.data.log.length, 2);
  assert.deepEqual(log.data.log[1].tools, ['Freie Zeit prüfen', 'To-do anlegen']);
});

test('Chat live: Text-Stücke und Werkzeug-Karten kommen nacheinander', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-assistent': '1', cookie: cookieJar, accept: 'application/x-ndjson' },
    body: JSON.stringify({ message: 'Hab ich morgen um 15 Uhr Zeit?', voice: true }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /ndjson/);
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type !== 'ping');
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 4), ['tool_start', 'tool_end', 'tool_start', 'tool_end']);
  assert.equal(events[1].name, 'calendar_is_free');
  assert.equal(events[1].result.frei, true);
  assert.equal(events[0].input.start, `${tomorrow}T15:00`, 'Werkzeug-Eingabe aus den JSON-Stücken zusammengesetzt');
  assert.ok(types.filter((t) => t === 'text').length > 1, 'Text kommt in Stücken');
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'Morgen um 15 Uhr bist du frei.');
  assert.equal(types[types.length - 1], 'done');
  const last = claude.requests[claude.requests.length - 1];
  assert.equal(last.body.stream, true);
  assert.match(last.body.system, /laut vorgelesen/);
  const log = (await api('GET', '/api/chat')).data.log;
  const entry = log[log.length - 1];
  assert.deepEqual(entry.parts.map((p) => p.type), ['tool', 'tool', 'text']);
  assert.equal(entry.parts[0].result.frei, true);
});

test('Tagesplan: erst ab der eingestellten Uhrzeit, einmal pro Tag', async () => {
  const { planner, stores } = app;
  stores.config.update((c) => {
    c.planTime = '23:59';
  });
  const now = new Date();
  const hhmm = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(now);
  if (hhmm < '23:59') assert.equal(planner.isDue(), false, 'vor der Uhrzeit nicht fällig');
  stores.config.update((c) => {
    c.planTime = '00:00';
  });
  assert.equal(planner.isDue(), true);
  const r = await api('POST', '/api/plan/run');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.created, 1);
  assert.match(r.data.briefing.text, /Mail von Lena/);
  assert.equal(planner.isDue(), false, 'heute schon erledigt');
  const planReq = claude.requests.find((q) => q.body.messages[0].content.startsWith?.('Erstelle meinen Tagesplan'));
  const planTools = planReq.body.tools.map((t) => t.name);
  assert.ok(planTools.includes('todo_add') && planTools.includes('mail_read'));
  assert.ok(!planTools.includes('mail_move') && !planTools.includes('calendar_delete_event') && !planTools.includes('mail_create_draft'), 'beim Tagesplan nichts Ändernd-Riskantes');
  const planTodo = app.todos.list().find((t) => t.title.startsWith('Lena antworten'));
  assert.equal(planTodo.source, 'tagesplan');
  const dash = await api('GET', '/api/dashboard');
  assert.equal(dash.data.briefing.date, today);
});

test('Connector: alte MCP-Version mit initialize', async () => {
  const token = app.stores.secrets.data.connectorToken;
  const post = (body, headers = {}) => fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  let res = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  let data = await res.json();
  assert.equal(data.result.protocolVersion, '2025-06-18');
  assert.ok(data.result.capabilities.tools);
  res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
  res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  data = await res.json();
  const names = data.result.tools.map((t) => t.name);
  assert.ok(names.includes('todo_add') && names.includes('calendar_create_event') && !names.includes('briefing_save'));
  assert.equal(data.result.tools.find((t) => t.name === 'todo_delete').annotations.destructiveHint, true);
  res = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'todo_add', arguments: { title: 'Über Claude angelegt' } } });
  data = await res.json();
  assert.equal(data.result.isError, false);
  assert.equal(JSON.parse(data.result.content[0].text).angelegt, true);
  assert.equal(app.todos.list().find((t) => t.title === 'Über Claude angelegt').source, 'claude');
  res = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'todo_add', arguments: {} } });
  data = await res.json();
  assert.equal(data.result.isError, true);
  res = await fetch(`${base}/mcp/falsch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 401);
  res = await fetch(`${base}/mcp/${token}`, { method: 'GET' });
  assert.equal(res.status, 405);
});

test('Connector: neue zustandslose MCP-Version 2026-07-28', async () => {
  const token = app.stores.secrets.data.connectorToken;
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
  const call = (body, headers) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
  let res = await call({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: { _meta: meta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover' });
  let data = await res.json();
  assert.equal(data.result.resultType, 'complete');
  assert.ok(data.result.supportedVersions.includes('2026-07-28'));
  assert.equal(data.result._meta['io.modelcontextprotocol/serverInfo'].name, 'assistent-agent');
  res = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
  data = await res.json();
  assert.equal(typeof data.result.ttlMs, 'number');
  assert.equal(data.result.cacheScope, 'private');
  const sortedNames = data.result.tools.map((t) => t.name);
  assert.deepEqual(sortedNames, [...sortedNames].sort());
  res = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'day_overview', arguments: {}, _meta: meta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'day_overview' });
  data = await res.json();
  assert.equal(data.result.resultType, 'complete');
  const overview = JSON.parse(data.result.content[0].text);
  assert.equal(overview.tag, today);
  assert.ok(overview.termine.some((t) => t.titel === 'Zahnarzt'));
  res = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'day_overview', arguments: {}, _meta: meta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32020);
  res = await call({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } }, { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' });
  assert.equal(res.status, 400);
  data = await res.json();
  assert.equal(data.error.code, -32022);
  assert.ok(data.error.data.supported.includes('2026-07-28'));
  res = await call({ jsonrpc: '2.0', id: 5, method: 'gibts/nicht', params: { _meta: meta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'gibts/nicht' });
  assert.equal(res.status, 404);
  res = await call({ jsonrpc: '2.0', id: 6, method: 'tools/list', params: { _meta: meta } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list', origin: 'https://boese.example' });
  assert.equal(res.status, 403);
});

test('Connector: Brücke für die Claude-Desktop-App (stdio)', async () => {
  const child = spawn(process.execPath, [path.resolve('bin/mcp-stdio.js')], { env: { ...process.env, PORT: String(app.port), DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'todos_list', arguments: {}, _meta: meta } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } }) + '\n');
  child.stdin.end();
  await new Promise((r) => child.on('exit', r));
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.ok(byId[1].result.supportedVersions.includes('2026-07-28'));
  assert.ok(JSON.parse(byId[2].result.content[0].text).todos.length > 0);
  assert.equal(byId[3].result.protocolVersion, '2025-11-25');
});

test('Statische Seiten und Sicherheit', async () => {
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  res = await fetch(`${base}/../geheim.json`);
  assert.notEqual(res.status, 200);
  res = await fetch(`${base}/%2e%2e/data/geheim.json`);
  assert.notEqual(res.status, 200);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/status`, { headers: { host: 'evil.example.com' } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 421, 'fremder Hostname wird abgelehnt (DNS-Rebinding)');
});
