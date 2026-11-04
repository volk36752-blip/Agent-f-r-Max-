// Der Webserver: Dashboard, API für die Oberfläche und der Connector-Zugang für Claude.

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStores } from './store.js';
import { createServices, ServiceError } from './services.js';
import { createTodos, TodoError } from './todos.js';
import { createChat } from './agent.js';
import { createPlanner } from './plan.js';
import { handleMcpMessage } from './mcp.js';
import { ToolInputError } from './tools.js';
import { ClaudeError, checkApiKey, MODELS } from './lib/claude.js';
import { CalDAVError } from './lib/caldav.js';
import { ImapError } from './lib/imap.js';
import { hashPassword, verifyPassword, Sessions, RateLimiter, randomToken, safeEqual, setupCode } from './auth.js';
import { Router, HttpError, sendJson, readJson, parseCookies, cookie, serveStatic, isLoopback, clientIp } from './web.js';
import { nowWall, addDaysIso, isValidTimeZone, todayIso } from './lib/tz.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_COOKIE = 'assistent_sitzung';
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export const WISH_APPS = [
  { id: 'erinnerungen', name: 'Apple Erinnerungen' },
  { id: 'kontakte', name: 'Kontakte' },
  { id: 'whatsapp', name: 'WhatsApp' },
  { id: 'notizen', name: 'Apple Notizen' },
  { id: 'google', name: 'Google Kalender & Gmail' },
  { id: 'outlook', name: 'Outlook' },
  { id: 'musik', name: 'Spotify / Apple Music' },
  { id: 'health', name: 'Apple Health' },
];

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function hostNames() {
  const h = os.hostname().toLowerCase();
  const base = h.replace(/\.local$/, '');
  return [h, base, `${base}.local`];
}

export function createApp({ dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'), publicDir = path.join(ROOT, 'public'), log = console } = {}) {
  const stores = createStores(dataDir);
  const services = createServices(stores);
  const todos = createTodos(stores.todos, () => stores.config.data.timezone);
  const sessions = new Sessions(stores.sessions);
  const limiter = new RateLimiter();
  const listeners = new Set();
  const changed = (what) => listeners.forEach((fn) => fn(what));
  const ctx = { stores, services, todos, changed };
  const chat = createChat(ctx);
  const planner = createPlanner(ctx);
  const code = setupCode();

  if (!stores.secrets.data.connectorToken) {
    stores.secrets.update((s) => {
      s.connectorToken = randomToken(24);
    });
  }

  const extraHosts = String(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  function hostAllowed(req) {
    if (extraHosts.includes('*')) return true;
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!host) return false;
    if (['localhost', '127.0.0.1', '::1'].includes(host) || host.endsWith('.localhost')) return true;
    if (extraHosts.includes(host)) return true;
    if (hostNames().includes(host)) return true;
    if (lanAddresses().includes(host)) return true;
    return false;
  }

  const isSecure = (req) => Boolean(req.socket.encrypted) || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');
  const sessionToken = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const loggedIn = (req) => sessions.valid(sessionToken(req));

  function startSession(req, res) {
    const token = sessions.create();
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, token, { maxAge: 30 * 86400, secure: isSecure(req) }));
  }

  function bearer(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  }

  const router = new Router();
  const r = (method, pattern, handler, opts = {}) => router.add(method, pattern, handler, { auth: 'session', ...opts });

  // ---------- Anmeldung ----------

  r('GET', '/api/health', () => ({ ok: true }), { auth: 'none' });

  r('GET', '/api/status', (req) => ({
    needsPassword: !stores.secrets.data.passwordHash,
    needsCode: !stores.secrets.data.passwordHash && !isLoopback(req),
    loggedIn: loggedIn(req),
    setupDone: stores.config.data.setupDone,
  }), { auth: 'none' });

  r('POST', '/api/setup/password', async (req, res, { body }) => {
    if (stores.secrets.data.passwordHash) throw new HttpError(409, 'Es gibt schon ein Passwort. Bitte anmelden.');
    if (!isLoopback(req)) {
      const ip = clientIp(req);
      if (!limiter.check(ip)) throw new HttpError(429, 'Zu viele Versuche. Warte 15 Minuten.');
      if (String(body.code || '').trim() !== code) {
        limiter.fail(ip);
        throw new HttpError(403, 'Der Einrichtungscode stimmt nicht. Du findest ihn im Fenster, in dem der Assistent läuft.');
      }
    }
    const pw = String(body.password || '');
    if (pw.length < 8) throw new HttpError(400, 'Das Passwort braucht mindestens 8 Zeichen.');
    stores.secrets.update((s) => {
      s.passwordHash = hashPassword(pw);
    });
    startSession(req, res);
    return { ok: true };
  }, { auth: 'none' });

  r('POST', '/api/login', async (req, res, { body }) => {
    const ip = clientIp(req);
    if (!limiter.check(ip)) throw new HttpError(429, 'Zu viele Fehlversuche. Warte 15 Minuten und versuch es dann nochmal.');
    if (!verifyPassword(String(body.password || ''), stores.secrets.data.passwordHash)) {
      limiter.fail(ip);
      throw new HttpError(401, 'Das Passwort stimmt nicht.');
    }
    limiter.reset(ip);
    startSession(req, res);
    return { ok: true };
  }, { auth: 'none' });

  r('POST', '/api/logout', async (req, res) => {
    sessions.destroy(sessionToken(req));
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) }));
    return { ok: true };
  }, { auth: 'none' });

  r('POST', '/api/password', async (req, res, { body }) => {
    if (!verifyPassword(String(body.current || ''), stores.secrets.data.passwordHash)) throw new HttpError(401, 'Das aktuelle Passwort stimmt nicht.');
    if (String(body.next || '').length < 8) throw new HttpError(400, 'Das neue Passwort braucht mindestens 8 Zeichen.');
    stores.secrets.update((s) => {
      s.passwordHash = hashPassword(String(body.next));
    });
    sessions.destroyAll();
    startSession(req, res);
    return { ok: true };
  });

  // ---------- Dashboard ----------

  r('GET', '/api/dashboard', async () => {
    const tz = services.tz();
    const now = nowWall(tz);
    const today = now.date;
    const tomorrow = addDaysIso(today, 1);
    const out = {
      now: { date: today, time: now.time, weekday: WEEKDAYS[new Date(Date.UTC(now.y, now.m - 1, now.d)).getUTCDay()], timezone: tz },
      connections: services.status(),
      briefing: stores.state.data.briefing?.date === today ? stores.state.data.briefing : null,
      plan: { running: planner.isRunning(), lastError: stores.state.data.plan.date === today ? stores.state.data.plan.lastError : null, doneToday: stores.state.data.lastPlanDate === today, planTime: stores.config.data.planTime },
      todos: todos.list({ status: 'alle' }).filter((t) => !t.done || (t.doneAt && todayIso(tz, t.doneAt) === today)),
      doneCount: todos.list({ status: 'erledigt' }).length,
    };
    const jobs = [];
    if (services.calendar.enabled()) {
      jobs.push(services.calendar.events(today, tomorrow).then((evs) => {
        out.events = { today: evs.filter((e) => (e.allDay ? e.start <= today && e.end >= today : e.start.slice(0, 10) <= today && e.end.slice(0, 10) >= today)), tomorrow: evs.filter((e) => (e.allDay ? e.start <= tomorrow && e.end >= tomorrow : e.start.slice(0, 10) === tomorrow)) };
      }).catch((err) => {
        out.eventsError = err.message;
      }));
    }
    if (services.mail.enabled()) {
      jobs.push(services.mail.list({ unreadOnly: true, limit: 8 }).then((m) => {
        out.mail = m;
      }).catch((err) => {
        out.mailError = err.message;
      }));
    }
    if (services.weather.enabled()) {
      jobs.push(services.weather.get().then((w) => {
        out.weather = w;
      }).catch((err) => {
        out.weatherError = err.message;
      }));
    }
    await Promise.all(jobs);
    return out;
  });

  // ---------- To-dos ----------

  r('GET', '/api/todos', (req, res, { query }) => ({ todos: todos.list({ status: query.get('status') || 'alle' }) }));
  r('POST', '/api/todos', (req, res, { body }) => ({ todo: todos.add(body, 'du') }));
  r('PATCH', '/api/todos/:id', (req, res, { body, params }) => ({ todo: todos.update(params.id, body) }));
  r('DELETE', '/api/todos/:id', (req, res, { params }) => ({ todo: todos.remove(params.id) }));

  // ---------- Kalender & Mail ----------

  r('GET', '/api/calendar', async (req, res, { query }) => {
    const from = query.get('from') || todayIso(services.tz());
    return { events: await services.calendar.events(from, query.get('to') || from) };
  });
  r('GET', '/api/calendars', async () => ({ calendars: await services.calendar.calendars({ fresh: true }), defaultCalendar: stores.config.data.icloud.defaultCalendar }));
  r('PUT', '/api/calendars', async (req, res, { body }) => {
    const cals = await services.calendar.calendars();
    const ids = cals.map((c) => c.id);
    const selected = Array.isArray(body.selected) ? body.selected.filter((id) => ids.includes(id)) : null;
    const def = ids.includes(body.defaultCalendar) ? body.defaultCalendar : null;
    stores.config.update((c) => {
      c.icloud.selectedCalendars = selected && selected.length < ids.length ? selected : null;
      c.icloud.defaultCalendar = def;
    });
    services.calendar.reset();
    return { calendars: await services.calendar.calendars() };
  });

  r('GET', '/api/mail', async (req, res, { query }) => services.mail.list({ unreadOnly: query.get('unread') === '1', limit: Number(query.get('limit') || 15) }));
  r('GET', '/api/mail/:id', async (req, res, { params }) => ({ mail: await services.mail.read(params.id) }));
  r('POST', '/api/mail/:id/mark', async (req, res, { params, body }) => services.mail.mark(params.id, { read: body.read, flagged: body.flagged }));

  // ---------- Verbindungen ----------

  r('GET', '/api/connections', () => {
    const c = stores.config.data;
    return {
      status: services.status(),
      icloud: { appleId: c.icloud.appleId, mailAddress: c.icloud.mailAddress, calendarEnabled: c.icloud.calendarEnabled, mailEnabled: c.icloud.mailEnabled, hasPassword: Boolean(stores.secrets.data.icloudAppPassword) },
      weather: c.weather,
      claude: { model: c.claude.model, models: MODELS, hasKey: Boolean(stores.secrets.data.claudeApiKey) },
      wishes: c.wishes,
      skipped: c.skipped,
      wishApps: WISH_APPS,
      setupDone: c.setupDone,
    };
  });

  r('PUT', '/api/connections/icloud', async (req, res, { body }) => {
    const appleId = String(body.appleId ?? stores.config.data.icloud.appleId ?? '').trim();
    const mailAddress = String(body.mailAddress ?? stores.config.data.icloud.mailAddress ?? '').trim();
    const appPassword = String(body.appPassword || '').trim() || stores.secrets.data.icloudAppPassword;
    const wantCalendar = body.calendar !== undefined ? Boolean(body.calendar) : stores.config.data.icloud.calendarEnabled;
    const wantMail = body.mail !== undefined ? Boolean(body.mail) : stores.config.data.icloud.mailEnabled;
    if (!appPassword) throw new HttpError(400, 'Bitte das app-spezifische Passwort eintragen.');
    const result = {};
    let mailLogin = stores.config.data.icloud.mailLogin;
    if (wantCalendar) {
      if (!appleId) throw new HttpError(400, 'Bitte deine Apple-ID eintragen.');
      result.calendars = await services.calendar.test(appleId, appPassword);
    }
    if (wantMail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailAddress)) throw new HttpError(400, 'Bitte deine iCloud-Mail-Adresse eintragen (z. B. name@icloud.com).');
      const t = await services.mail.test(mailAddress, appPassword);
      mailLogin = t.login;
      result.inbox = t.count;
    }
    stores.secrets.update((s) => {
      s.icloudAppPassword = appPassword;
    });
    stores.config.update((c) => {
      c.icloud.appleId = appleId;
      c.icloud.mailAddress = mailAddress;
      c.icloud.mailLogin = mailLogin;
      c.icloud.calendarEnabled = wantCalendar;
      c.icloud.mailEnabled = wantMail;
      c.skipped = c.skipped.filter((x) => !(wantCalendar && x === 'calendar') && !(wantMail && x === 'mail'));
    });
    services.calendar.reset();
    services.mail.reset();
    return { ok: true, ...result, status: services.status() };
  });

  r('DELETE', '/api/connections/icloud', () => {
    stores.secrets.update((s) => {
      s.icloudAppPassword = '';
    });
    stores.config.update((c) => {
      c.icloud.calendarEnabled = false;
      c.icloud.mailEnabled = false;
    });
    services.calendar.reset();
    services.mail.reset();
    return { ok: true, status: services.status() };
  });

  r('GET', '/api/weather/places', async (req, res, { query }) => ({ places: await services.weather.search(query.get('q')) }));
  r('PUT', '/api/connections/weather', (req, res, { body }) => {
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'Bitte einen Ort aus der Liste wählen.');
    stores.config.update((c) => {
      c.weather = { enabled: true, name: String(body.name || '').slice(0, 80), region: String(body.region || '').slice(0, 120), latitude: lat, longitude: lon };
      c.skipped = c.skipped.filter((x) => x !== 'weather');
    });
    services.weather.reset();
    return { ok: true, status: services.status() };
  });
  r('DELETE', '/api/connections/weather', () => {
    stores.config.update((c) => {
      c.weather.enabled = false;
    });
    return { ok: true, status: services.status() };
  });

  r('PUT', '/api/connections/claude', async (req, res, { body }) => {
    const key = String(body.apiKey || '').trim();
    const model = MODELS.some((m) => m.id === body.model) ? body.model : stores.config.data.claude.model;
    if (key) {
      if (!/^sk-ant-/.test(key)) throw new HttpError(400, 'Ein Claude-API-Schlüssel beginnt mit „sk-ant-“.');
      await checkApiKey(key);
      stores.secrets.update((s) => {
        s.claudeApiKey = key;
      });
    } else if (!stores.secrets.data.claudeApiKey) throw new HttpError(400, 'Bitte den API-Schlüssel eintragen.');
    stores.config.update((c) => {
      c.claude.model = model;
      c.skipped = c.skipped.filter((x) => x !== 'claude');
    });
    return { ok: true, status: services.status() };
  });
  r('DELETE', '/api/connections/claude', () => {
    stores.secrets.update((s) => {
      s.claudeApiKey = '';
    });
    return { ok: true, status: services.status() };
  });

  r('PUT', '/api/wishes', (req, res, { body }) => {
    const ids = WISH_APPS.map((w) => w.id);
    stores.config.update((c) => {
      if (Array.isArray(body.wishes)) c.wishes = body.wishes.filter((w) => ids.includes(w));
      if (Array.isArray(body.skipped)) c.skipped = [...new Set(body.skipped.filter((s) => ['calendar', 'mail', 'weather', 'claude', 'connector'].includes(s)))];
    });
    return { ok: true };
  });

  r('POST', '/api/setup/finish', () => {
    stores.config.update((c) => {
      c.setupDone = true;
    });
    return { ok: true };
  });

  r('GET', '/api/connector', () => {
    const token = stores.secrets.data.connectorToken;
    const port = app.port;
    return {
      token,
      localUrl: `http://localhost:${port}/mcp/${token}`,
      bridgePath: path.join(ROOT, 'bin', 'mcp-stdio.js'),
      desktopConfig: {
        mcpServers: {
          assistent: { command: 'node', args: [path.join(ROOT, 'bin', 'mcp-stdio.js')] },
        },
      },
      publicHint: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, '')}/mcp/${token}` : null,
    };
  });
  r('POST', '/api/connector/token', () => {
    stores.secrets.update((s) => {
      s.connectorToken = randomToken(24);
    });
    return { token: stores.secrets.data.connectorToken };
  });

  // ---------- Einstellungen ----------

  r('GET', '/api/settings', () => {
    const c = stores.config.data;
    return {
      planTime: c.planTime,
      planEnabled: c.planEnabled,
      timezone: c.timezone,
      lanAccess: c.lanAccess,
      lanUrls: app.lanUrls(),
      port: app.port,
      hostOverride: Boolean(process.env.HOST),
    };
  });
  r('PUT', '/api/settings', async (req, res, { body }) => {
    const patch = {};
    if (body.planTime !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.planTime)) throw new HttpError(400, 'Uhrzeit bitte als HH:MM.');
      patch.planTime = body.planTime;
    }
    if (body.planEnabled !== undefined) patch.planEnabled = Boolean(body.planEnabled);
    if (body.timezone !== undefined) {
      if (!isValidTimeZone(body.timezone)) throw new HttpError(400, 'Unbekannte Zeitzone.');
      patch.timezone = body.timezone;
    }
    if (body.lanAccess !== undefined) patch.lanAccess = Boolean(body.lanAccess);
    const lanChanged = patch.lanAccess !== undefined && patch.lanAccess !== stores.config.data.lanAccess;
    stores.config.update((c) => Object.assign(c, patch));
    if (patch.timezone) {
      services.calendar.reset();
    }
    if (lanChanged) setTimeout(() => app.rebind().catch((err) => log.error(err.message)), 300);
    return { ok: true, lanUrls: app.lanUrls() };
  });

  r('POST', '/api/plan/run', async () => {
    const result = await planner.run();
    return { ...result, briefing: stores.state.data.briefing };
  });

  // ---------- Chat ----------

  r('GET', '/api/chat', () => ({ log: chat.log(), available: services.claude.enabled(), busy: chat.busy() }));
  r('POST', '/api/chat', async (req, res, { body }) => {
    const voice = Boolean(body.voice);
    if (!String(req.headers.accept || '').includes('application/x-ndjson')) return chat.send(body.message, body.display, { voice });
    // Live-Übertragung: eine JSON-Zeile pro Ereignis (Text-Stücke, Werkzeug-Start/-Ende, Ende)
    if (!services.claude.enabled()) throw new HttpError(409, 'Für den Chat brauche ich einen Claude-API-Schlüssel. Du kannst ihn unter „Verbindungen“ eintragen.');
    if (chat.busy()) throw new HttpError(409, 'Ich antworte gerade noch auf deine letzte Nachricht.');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const send = (evt) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(evt)}\n`);
    };
    const keepAlive = setInterval(() => send({ type: 'ping' }), 15000);
    try {
      const result = await chat.send(body.message, body.display, { voice, stream: true, onEvent: send });
      send({ type: 'done', reply: result.reply, tools: result.tools });
    } catch (err) {
      send({ type: 'error', error: err.message });
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
    return undefined;
  });
  r('DELETE', '/api/chat', () => {
    chat.clear();
    return { ok: true };
  });

  // ---------- Anfragen bearbeiten ----------

  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }

  function errorStatus(err) {
    if (err instanceof HttpError) return err.status;
    if (err instanceof TodoError || err instanceof ServiceError || err instanceof ToolInputError) return err.status || 400;
    if (err instanceof ClaudeError) return err.status === 401 || err.status === 409 || err.status === 400 ? (err.status === 401 ? 400 : err.status) : 502;
    if (err instanceof CalDAVError) return err.status === 401 || err.status === 403 ? 400 : 502;
    if (err instanceof ImapError) return err.code === 'AUTHENTICATIONFAILED' ? 400 : 502;
    return 500;
  }

  async function handleMcpHttp(req, res, tokenFromPath) {
    const token = tokenFromPath || bearer(req);
    if (!token || !safeEqual(token, stores.secrets.data.connectorToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Falscher oder fehlender Zugangsschlüssel.' } }));
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === req.headers.host;
      } catch {
        ok = false;
      }
      if (!ok) {
        sendJson(res, 403, { jsonrpc: '2.0', error: { code: -32600, message: 'Origin nicht erlaubt' } });
        return;
      }
    }
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    let msg;
    try {
      msg = await readJson(req, 512 * 1024);
    } catch {
      sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const transport = req.url.startsWith('/api/mcp-stdio') ? 'stdio' : 'http';
    if (Array.isArray(msg)) {
      const out = [];
      for (const m of msg) {
        const r1 = await handleMcpMessage(m, ctx, { transport, headers: req.headers });
        if (r1.body) out.push(r1.body);
      }
      if (!out.length) {
        res.writeHead(202);
        res.end();
      } else sendJson(res, 200, out);
      return;
    }
    const result = await handleMcpMessage(msg, ctx, { transport, headers: req.headers });
    if (!result.body) {
      res.writeHead(202);
      res.end();
      return;
    }
    sendJson(res, result.status, result.body);
  }

  async function handler(req, res) {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      // Connector (MCP) – geschützt durch den Zugangsschlüssel
      const mcpMatch = /^\/mcp(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(pathname);
      if (mcpMatch) return await handleMcpHttp(req, res, mcpMatch[1]);
      if (pathname === '/api/mcp-stdio') {
        if (!isLoopback(req)) throw new HttpError(403, 'Nur vom eigenen Rechner aus erlaubt.');
        return await handleMcpHttp(req, res, null);
      }

      if (!hostAllowed(req)) {
        res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unbekannter Hostname. Trage ihn in ALLOWED_HOSTS ein, wenn du den Assistenten unter dieser Adresse öffnen willst.');
        return;
      }

      if (pathname.startsWith('/api/')) {
        const m = router.match(req.method, pathname);
        if (!m) throw new HttpError(404, 'Gibt es nicht.');
        if (m.methodNotAllowed) throw new HttpError(405, 'Methode nicht erlaubt.');
        const { route, params } = m;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          if (req.headers['x-assistent'] !== '1') throw new HttpError(403, 'Anfrage abgelehnt.');
          const origin = req.headers.origin;
          if (origin) {
            let host = '';
            try {
              host = new URL(origin).host;
            } catch {
              host = '';
            }
            if (host !== req.headers.host) throw new HttpError(403, 'Anfrage von fremder Seite abgelehnt.');
          }
        }
        if (route.opts.auth === 'session' && !loggedIn(req)) throw new HttpError(401, 'Bitte zuerst anmelden.');
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
        const result = await route.handler(req, res, { params, query: url.searchParams, body });
        if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt.');
      if (serveStatic(req, res, publicDir, pathname)) return;
      if (!path.extname(pathname) && serveStatic(req, res, publicDir, '/index.html')) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
    } catch (err) {
      const status = errorStatus(err);
      if (status >= 500) log.error(`[${req.method} ${pathname}]`, err.stack || err.message);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Da ist intern etwas schiefgelaufen.' : err.message, ...(err.extra || {}) });
      else res.end();
    }
  }

  const app = {
    stores,
    services,
    todos,
    planner,
    chat,
    setupCode: code,
    port: Number(process.env.PORT || 3000),
    server: null,
    handler,
    bindHost() {
      if (process.env.HOST) return process.env.HOST;
      return stores.config.data.lanAccess ? '0.0.0.0' : '127.0.0.1';
    },
    lanUrls() {
      if (app.bindHost() === '127.0.0.1') return [];
      const base = hostNames()[2];
      return [`http://${base}:${app.port}`, ...lanAddresses().map((ip) => `http://${ip}:${app.port}`)];
    },
    listen(port = app.port) {
      app.port = port;
      return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.requestTimeout = 300000;
        server.once('error', reject);
        server.listen(port, app.bindHost(), () => {
          server.off('error', reject);
          app.server = server;
          app.port = server.address().port;
          resolve(server);
        });
      });
    },
    async rebind() {
      const old = app.server;
      if (old) {
        await new Promise((resolve) => {
          old.close(() => resolve());
          old.closeAllConnections?.();
        });
      }
      await app.listen(app.port);
      log.log(`Assistent hört jetzt auf ${app.bindHost()}:${app.port}`);
    },
    async close() {
      planner.stop();
      if (app.server) {
        await new Promise((resolve) => {
          app.server.close(() => resolve());
          app.server.closeAllConnections?.();
        });
      }
    },
  };
  return app;
}
