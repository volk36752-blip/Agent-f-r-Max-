// Die Apps direkt vom Mac: Brücke zur Mac-App, Erlaubnis beim ersten Zugriff, Apple Intelligence,
// WhatsApp, Mail-App, Karten zum Antippen, Plugins.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { startFakeMac, createWhatsAppDb, toCd } from './fake-mac.js';
import { todayIso, addDaysIso } from '../src/lib/tz.js';
import { pickAppleTools } from '../src/agent.js';
import { availableTools } from '../src/tools.js';
import { looksLikeQuestion } from '../src/plan.js';
import { normalizePhone, phoneFromJid } from '../src/mac.js';
import { parseRss } from '../src/plugins/schlagzeilen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TZ = 'Europe/Berlin';
const KEY = 'k'.repeat(40);
const today = todayIso(TZ);
const tomorrow = addDaysIso(today, 1);

let app;
let base;
let dir;
let mac;
let db;
let news;
let cookie = '';
const script = { ai: null, deny: [], lastAi: null };

async function api(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'x-assistent': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function chat(message) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-assistent': '1', cookie, accept: 'application/x-ndjson' },
    body: JSON.stringify({ message }),
  });
  assert.equal(res.status, 200);
  return (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type !== 'ping');
}

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Zeitüberschreitung');
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistent-mac-'));
  fs.writeFileSync(path.join(dir, 'app-schluessel'), KEY);
  const osa = path.join(HERE, 'fake-osascript.js');
  fs.chmodSync(osa, 0o755);
  process.env.OSASCRIPT = osa;
  process.env.FAKE_OSA_STATE = path.join(dir, 'osa.json');
  fs.writeFileSync(process.env.FAKE_OSA_STATE, JSON.stringify({
    mail: [
      { id: 11, subject: 'Treffen am Freitag?', sender: 'Lena Berg <lena@example.com>', date: Date.now() - 3600000, read: false, flagged: false, content: 'Hi! Hast du Freitag um 15 Uhr Zeit?' },
      { id: 12, subject: 'Newsletter', sender: 'Shop <news@shop.example>', date: Date.now() - 7200000, read: true, flagged: false, content: 'Angebote' },
    ],
    sent: [],
  }));
  news = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.end(`<?xml version="1.0"?><rss><channel><title>Test</title><item><title>Erste Meldung</title><link>https://example.org/1</link><pubDate>${new Date().toUTCString()}</pubDate><description><![CDATA[Kurz &amp; knapp]]></description></item><item><title>Sturm im Norden</title><link>https://example.org/2</link><description>Wetter</description></item></channel></rss>`);
  });
  await new Promise((r) => news.listen(0, '127.0.0.1', r));
  process.env.NEWS_FEED_URL = `http://127.0.0.1:${news.address().port}/rss`;
  app = createApp({ dataDir: dir, log: { log() {}, error() {} } });
  app.stores.config.update((c) => {
    c.timezone = TZ;
  });
  await app.listen(0);
  base = `http://127.0.0.1:${app.port}`;
  const res = await fetch(`${base}/api/app-login?key=${KEY}`, { redirect: 'manual' });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'App-Anmeldung setzt eine Sitzung');
  await api('POST', '/api/setup/finish');
  db = createWhatsAppDb(path.join(dir, 'wa.sqlite'));
});

after(async () => {
  await mac?.stop();
  await app?.close();
  news?.close();
  db?.close();
});

test('Ohne Mac-App: Apps sind offline, interne Wege nur mit App-Schlüssel', async () => {
  let r = await api('GET', '/api/apps');
  assert.equal(r.data.mac, false);
  assert.equal(r.data.apps.find((a) => a.id === 'kalender').permission, 'offline');
  assert.equal(r.data.apps.find((a) => a.id === 'todos').permission, 'none');
  let res = await fetch(`${base}/api/intern/bridge/next`);
  assert.equal(res.status, 403);
  res = await fetch(`${base}/api/intern/bridge/next`, { headers: { 'x-assistent-app': 'falsch' } });
  assert.equal(res.status, 403);
  r = await api('GET', '/api/brain');
  assert.equal(r.data.active, null);
  assert.equal(r.data.apple.reason, 'noApp');
});

test('Mac-App verbindet sich: Apple Intelligence wird das Gehirn', async () => {
  mac = startFakeMac({ base, key: KEY, db, script });
  await waitFor(() => app.bridge.connected() && app.bridge.info());
  const r = await api('GET', '/api/brain');
  assert.equal(r.data.active, 'apple');
  assert.equal((await api('GET', '/api/status')).data.mac, true);
});

test('Kalender: Startseite fragt nicht, ein Klick erlaubt', async () => {
  let r = await api('GET', '/api/widget/termine');
  assert.equal(r.data.state, 'ask', JSON.stringify(r.data));
  assert.equal(mac.calls.filter((c) => c.cmd === 'permission.request').length, 0, 'Startseite öffnet kein macOS-Fenster');
  r = await api('POST', '/api/apps/kalender/allow');
  assert.equal(r.data.status, 'granted');
  const created = await app.services.calendar.create({ title: 'Zahnarzt', start: `${today}T10:00` });
  assert.equal(created.calendar, 'Privat');
  assert.equal(created.end, `${today}T11:00`);
  r = await api('GET', '/api/widget/termine');
  assert.equal(r.data.state, 'ok', JSON.stringify(r.data));
  assert.deepEqual(r.data.data.today.map((e) => e.title), ['Zahnarzt']);
  assert.equal(r.data.data.provider, 'mac');
  r = await api('GET', '/api/calendars');
  assert.deepEqual(r.data.calendars.map((c) => c.name), ['Privat', 'Feiertage']);
  await assert.rejects(app.services.calendar.create({ title: 'x', start: `${today}T12:00`, calendar: 'Feiertage' }), /nicht schreiben/);
});

test('Chat mit Apple Intelligence: Werkzeuge über die Mac-App, Karten live', async () => {
  script.ai = (a) => {
    script.lastAi = a;
    return { tools: [{ name: 'calendar_is_free', args: { start: `${tomorrow}T15:00` } }], text: 'Morgen um 15 Uhr bist du frei.' };
  };
  const events = await chat('Hab ich morgen um 15 Uhr Zeit?');
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['tool_start', 'tool_end', 'text', 'done']);
  assert.equal(events[1].result.frei, true);
  assert.equal(events[3].brain, 'apple');
  const a = script.lastAi;
  assert.match(a.instructions, new RegExp(`morgen ${tomorrow}`));
  assert.ok(a.tools.some((t) => t.name === 'calendar_is_free'));
  assert.ok(a.tools.length <= 6, 'nur passende Werkzeuge für das kleine Modell');
  assert.equal(typeof a.tools[0].parameters, 'object');
  const log = (await api('GET', '/api/chat')).data;
  assert.equal(log.log[1].brain, 'apple');
  assert.deepEqual(log.log[1].parts.map((p) => p.type), ['tool', 'text']);
});

test('WhatsApp: Erlaubnis im Chat, drei Vorschläge, Antippen sendet', async () => {
  script.ai = () => ({
    tools: [
      { name: 'whatsapp_read', args: { chat: 'Lisa' } },
      { name: 'whatsapp_suggest', args: { chat: 'Lisa', suggestions: ['Ja, gerne!', 'Morgen klappt leider nicht.', 'Wann denn?'] } },
    ],
    text: 'Ich habe dir drei Vorschläge gemacht.',
  });
  const events = await chat('Was schreibt Lisa? Antworte ihr per WhatsApp.');
  const perm = events.filter((e) => e.type === 'permission');
  assert.deepEqual(perm.map((e) => e.state), ['asking', 'granted'], 'beim ersten Zugriff fragt macOS');
  const read = events.find((e) => e.type === 'tool_end' && e.name === 'whatsapp_read');
  assert.equal(read.ok, true, read.error);
  assert.equal(read.result.nachrichten.at(-1).text, 'Hast du morgen Zeit für einen Kaffee?');
  assert.equal(read.result.nachrichten.at(-2).von, 'ich');
  const sug = events.find((e) => e.type === 'tool_end' && e.name === 'whatsapp_suggest');
  assert.equal(sug.ok, true, sug.error);
  const card = sug.result.karte;
  assert.deepEqual(sug.result.vorschlaege, ['Ja, gerne!', 'Morgen klappt leider nicht.', 'Wann denn?']);
  assert.equal(mac.sent.length, 0, 'vor dem Antippen wird nichts gesendet');

  // Ohne Bedienungshilfen: WhatsApp öffnet sich mit dem Text, du drückst Enter
  let r = await api('POST', `/api/actions/${card}`, { choice: 2 });
  assert.equal(r.data.action.status, 'geoeffnet');
  assert.deepEqual(mac.sent.at(-1), { phone: '491701234567', text: 'Wann denn?', autoSend: false });

  // Mit automatischem Senden
  await api('PUT', '/api/apps/whatsapp', { autoSend: true });
  const again = await app.actions.create({ kind: 'whatsapp', title: 'x', to: 'Lisa', target: { chatId: '491701234567@s.whatsapp.net' }, options: ['Ja, gerne!'] });
  r = await api('POST', `/api/actions/${again.id}`, { choice: 0 });
  assert.equal(r.data.action.status, 'gesendet', JSON.stringify(r.data));
  r = await api('POST', `/api/actions/${again.id}`, { choice: 0 });
  assert.equal(r.status, 409, 'nicht doppelt senden');

  const chats = await api('GET', '/api/widget/whatsapp');
  assert.equal(chats.data.state, 'ok', JSON.stringify(chats.data));
  assert.deepEqual(chats.data.data.chats.map((c) => c.name), ['Lisa', 'Familie', 'Tom']);
  const fam = await app.services.whatsapp.messages('Familie');
  assert.deepEqual(fam.messages.map((m) => [m.from, m.text]), [['Mama', 'Sonntag Essen bei uns?'], ['Mama', '[Foto]']]);

  // Chat ohne Telefonnummer: Text kopieren und WhatsApp öffnen
  const tom = await app.actions.create({ kind: 'whatsapp', title: 'x', to: 'Tom', target: { chatId: '98765@lid' }, options: ['Bis gleich!'] });
  r = await api('POST', `/api/actions/${tom.id}`, { choice: 0 });
  assert.equal(r.data.action.status, 'kopiert');
});

test('Mail-App: lesen und Antwort per Antippen senden', async () => {
  let r = await api('GET', '/api/widget/mail');
  assert.equal(r.data.state, 'ask');
  r = await api('POST', '/api/apps/mail/allow');
  assert.equal(r.data.status, 'granted');
  r = await api('GET', '/api/widget/mail');
  assert.equal(r.data.state, 'ok', JSON.stringify(r.data));
  assert.equal(r.data.data.total, 1);
  assert.equal(r.data.data.messages[0].from, 'Lena Berg');
  assert.equal(r.data.data.provider, 'mac');
  script.ai = () => ({ tools: [{ name: 'mail_read', args: { id: 'mb:inbox:11' } }, { name: 'mail_suggest_reply', args: { id: 'mb:inbox:11', suggestions: ['Freitag passt!', 'Leider nicht', 'Lieber Samstag?'] } }], text: 'Hier sind drei Antworten.' });
  const events = await chat('Antworte Lena auf ihre Mail.');
  const read = events.find((e) => e.name === 'mail_read' && e.type === 'tool_end');
  assert.match(read.result.text, /Freitag um 15 Uhr/);
  const sug = events.find((e) => e.name === 'mail_suggest_reply' && e.type === 'tool_end');
  assert.equal(sug.ok, true, sug.error);
  r = await api('POST', `/api/actions/${sug.result.karte}`, { choice: 0 });
  assert.equal(r.data.action.status, 'gesendet', JSON.stringify(r.data));
  const sent = JSON.parse(fs.readFileSync(process.env.FAKE_OSA_STATE, 'utf8')).sent;
  assert.deepEqual(sent.at(-1), { to: [{ name: 'Lena Berg', address: 'lena@example.com' }], subject: 'Re: Treffen am Freitag?', body: 'Freitag passt!', send: true });
});

test('Löschen nur nach Bestätigung per Karte', async () => {
  const t = (await api('POST', '/api/todos', { title: 'Altes To-do' })).data.todo;
  script.ai = () => ({ tools: [{ name: 'todo_delete', args: { id: t.id } }], text: 'Bitte bestätige das Löschen.' });
  const events = await chat('Lösch das To-do „Altes To-do“');
  const end = events.find((e) => e.type === 'tool_end');
  assert.equal(end.result.bestaetigung_noetig, true);
  assert.ok(app.todos.list().some((x) => x.id === t.id), 'noch nicht gelöscht');
  const r = await api('POST', `/api/actions/${end.result.karte}`, {});
  assert.equal(r.data.action.status, 'erledigt', JSON.stringify(r.data));
  assert.equal(app.todos.list().some((x) => x.id === t.id), false);
});

test('WhatsApp-Frage („Hast du Zeit?“) wird zum To-do mit Mitteilung', async () => {
  assert.equal(await app.planner.watchWhatsApp(), 0, 'beim ersten Mal nur merken, was schon da ist');
  const now = Date.now() + 1500;
  db.prepare('INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZISFROMME, ZTEXT, ZMESSAGEDATE, ZMESSAGETYPE) VALUES (1, 0, ?, ?, 0)').run('Hast du heute Abend Zeit?', toCd(now));
  db.prepare('INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZISFROMME, ZTEXT, ZMESSAGEDATE, ZMESSAGETYPE) VALUES (1, 0, ?, ?, 0)').run('Okay, bis dann', toCd(now + 10));
  db.prepare('INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZISFROMME, ZTEXT, ZMESSAGEDATE, ZMESSAGETYPE, ZGROUPMEMBER) VALUES (2, 0, ?, ?, 0, 1)').run('Habt ihr Sonntag Zeit?', toCd(now + 20));
  app.stores.state.update((s) => {
    s.whatsapp.seenMs = now - 1000;
  });
  assert.equal(await app.planner.watchWhatsApp(), 1);
  const t = app.todos.list().find((x) => x.source === 'whatsapp');
  assert.equal(t.title, 'Lisa antworten: „Hast du heute Abend Zeit?“');
  assert.equal(t.due, today);
  await waitFor(() => mac.notifications.length > 0);
  assert.equal(mac.notifications.at(-1).title, 'Lisa fragt dich etwas');
  assert.equal(await app.planner.watchWhatsApp(), 0, 'nicht doppelt');
});

test('Plugins: hinzufügen bringt Werkzeug und Widget', async () => {
  let r = await api('GET', '/api/plugins');
  assert.equal(r.data.plugins.find((p) => p.id === 'schlagzeilen').enabled, false);
  assert.equal(availableTools(app.services).some((t) => t.name === 'news_headlines'), false);
  r = await api('PUT', '/api/plugins/schlagzeilen', { enabled: true });
  assert.equal(r.data.plugin.enabled, true);
  r = await api('GET', '/api/dashboard');
  assert.ok(r.data.widgets.some((w) => w.id === 'plugin:schlagzeilen' && w.on));
  r = await api('GET', '/api/widget/plugin:schlagzeilen');
  assert.equal(r.data.state, 'ok', JSON.stringify(r.data));
  assert.equal(r.data.data.items[0].title, 'Erste Meldung');
  const tools = availableTools(app.services);
  assert.ok(tools.some((t) => t.name === 'news_headlines'));
  assert.ok(pickAppleTools('Was gibt’s Neues?', tools).some((t) => t.name === 'news_headlines'));
  r = await api('PUT', '/api/widgets', { widgets: [{ id: 'plugin:schlagzeilen', on: true }, { id: 'mail', on: false }] });
  assert.equal(r.data.widgets[0].id, 'plugin:schlagzeilen');
  assert.equal(r.data.widgets.find((w) => w.id === 'mail').on, false);
});

test('Ohne Gehirn: Überblick und ehrlicher Hinweis', async () => {
  await api('PUT', '/api/brain', { mode: 'claude' });
  const events = await chat('Was steht heute an?');
  assert.ok(events.some((e) => e.type === 'tool_end' && e.name === 'day_overview'));
  assert.match(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), /Gehirn/);
  await api('PUT', '/api/brain', { mode: 'auto' });
});

test('Kleinkram: Telefonnummern, Fragen erkennen, RSS', () => {
  assert.equal(normalizePhone('0172 5555555'), '491725555555');
  assert.equal(normalizePhone('+49 (172) 555-5555'), '491725555555');
  assert.equal(normalizePhone('0043 664 1234567'), '436641234567');
  assert.equal(phoneFromJid('491701234567@s.whatsapp.net'), '491701234567');
  assert.equal(phoneFromJid('98765@lid'), null);
  assert.equal(looksLikeQuestion('Hast du morgen Zeit?'), true);
  assert.equal(looksLikeQuestion('Was machst du heute'), true);
  assert.equal(looksLikeQuestion('Danke dir!'), false);
  assert.equal(looksLikeQuestion('Wie geht es dir?'), false);
  const items = parseRss('<rss><item><title><![CDATA[A &amp; B]]></title><link>x</link></item></rss>');
  assert.equal(items[0].title, 'A & B');
  const tools = availableTools(app.services);
  assert.deepEqual(pickAppleTools('Hab ich Freitag um 15 Uhr Zeit?', tools).map((t) => t.name).slice(0, 2), ['calendar_is_free', 'calendar_events']);
  assert.ok(pickAppleTools('Schreib Lisa auf WhatsApp', tools).some((t) => t.name === 'whatsapp_suggest'));
});
