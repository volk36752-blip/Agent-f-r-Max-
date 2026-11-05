// Der Webserver: Dashboard, API für die Oberfläche und der Connector-Zugang für Claude.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStores } from './store.js';
import { createServices, ServiceError } from './services.js';
import { createTodos, TodoError } from './todos.js';
import { createChat, brainStatus, handleAppleToolCall, APPLE_REASONS } from './agent.js';
import { createPlanner } from './plan.js';
import { handleMcpMessage } from './mcp.js';
import { ToolInputError, runTool, availableTools } from './tools.js';
import { createBridge, BridgeError } from './bridge.js';
import { createApps, AppError, withRun } from './apps.js';
import { MacError } from './mac.js';
import { createActions, ActionError } from './actions.js';
import { createPlugins, PluginError } from './plugins/index.js';
import { JxaError } from './lib/jxa.js';
import { ClaudeError, checkApiKey, MODELS } from './lib/claude.js';
import { CalDAVError } from './lib/caldav.js';
import { ImapError } from './lib/imap.js';
import { hashPassword, verifyPassword, Sessions, RateLimiter, randomToken, safeEqual, setupCode } from './auth.js';
import { Router, HttpError, sendJson, readJson, parseCookies, cookie, serveStatic, isLoopback, clientIp } from './web.js';
import { nowWall, addDaysIso, isValidTimeZone, todayIso } from './lib/tz.js';
import { createVoices, VoiceError } from './voices.js';
import { buildExtension, openInClaude, claudeAppInstalled, claudeLinkPossible, configEntry, writeConfigEntry, removeConfigEntry, hasConfigEntry } from './claude-app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_VERSION = process.env.APP_VERSION || (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '0.3.0';
  }
})();
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
  const bridge = createBridge();
  const apps = createApps({ stores, bridge });
  const services = createServices(stores, { bridge, apps });
  const todos = createTodos(stores.todos, () => stores.config.data.timezone);
  const sessions = new Sessions(stores.sessions);
  const limiter = new RateLimiter();
  const listeners = new Set();
  const changed = (what) => listeners.forEach((fn) => fn(what));
  const ctx = { stores, services, todos, changed };
  const actions = createActions(ctx);
  ctx.actions = actions;
  const plugins = createPlugins(ctx);
  const voices = createVoices({ dataDir, root: ROOT, log });
  services.plugins = plugins;

  // Was passiert, wenn du einen Vorschlag antippst
  actions.register('whatsapp', (a, text) => services.whatsapp.send({ chatId: a.target.chatId, phone: a.target.phone, name: a.to, text }));
  actions.register('mail', async (a, text) => {
    if (!services.mail.canSend()) {
      const r = await services.mail.draft({ to: a.target.to, subject: a.target.subject, body: text });
      return { status: 'entwurf', hint: r.hint };
    }
    const r = await services.mail.compose({ to: a.target.to, subject: a.target.subject, body: text, send: true });
    return r.sent ? { status: 'gesendet' } : { status: 'geoeffnet', hint: 'Die Mail ist in der Mail-App geöffnet – dort auf Senden klicken.' };
  });
  actions.register('confirm', async (a) => {
    const result = await runTool(a.target.tool, a.target.args, { ...ctx, purpose: 'action', source: 'agent' });
    return { status: 'erledigt', result };
  });
  plugins.registerActions(actions);

  const chat = createChat(ctx);
  const planner = createPlanner(ctx);
  const code = setupCode();

  // Die Mac-App legt beim Start einen Schlüssel in den Datenordner. Wer ihn kennt (nur die App
  // auf diesem Rechner), wird ohne Passwort angemeldet.
  function appKey() {
    try {
      const key = fs.readFileSync(path.join(dataDir, 'app-schluessel'), 'utf8').trim();
      return key.length >= 32 ? key : null;
    } catch {
      return null;
    }
  }

  const appAuthorized = (req) => {
    const key = appKey();
    return Boolean(isLoopback(req) && key && safeEqual(String(req.headers['x-assistent-app'] || ''), key));
  };

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
    hasPassword: Boolean(stores.secrets.data.passwordHash),
    needsCode: !stores.secrets.data.passwordHash && !isLoopback(req),
    loggedIn: loggedIn(req),
    setupDone: stores.config.data.setupDone,
    mac: bridge.connected(),
    // Nur das Datum – damit die Mac-App melden kann, dass der Tagesplan fertig ist
    planDate: stores.state.data.lastPlanDate || null,
  }), { auth: 'none' });

  // ---------- Mac-App (nur die App auf diesem Rechner, mit ihrem Schlüssel) ----------

  r('GET', '/api/intern/bridge/next', (req, res) => bridge.poll(req, res), { auth: 'app' });
  r('POST', '/api/intern/bridge/hello', (req, res, { body }) => bridge.hello(body), { auth: 'app' });
  r('POST', '/api/intern/bridge/result', (req, res, { body }) => bridge.result(body), { auth: 'app', bodyLimit: 16 * 1024 * 1024 });
  r('POST', '/api/intern/bridge/event', (req, res, { body }) => bridge.event(body), { auth: 'app' });
  r('POST', '/api/intern/tool', (req, res, { body }) => handleAppleToolCall(body), { auth: 'app' });

  r('GET', '/api/app-login', (req, res, { query }) => {
    const key = appKey();
    const given = String(query.get('key') || '');
    if (isLoopback(req) && key && safeEqual(given, key)) startSession(req, res);
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
    res.end();
  }, { auth: 'none' });

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

  const CORE_WIDGETS = [
    { id: 'termine', title: 'Termine', app: 'kalender', icon: 'calendar', color: 'violet' },
    { id: 'todos', title: 'To-dos', app: 'todos', icon: 'check', color: 'orange' },
    { id: 'whatsapp', title: 'WhatsApp', app: 'whatsapp', icon: 'chat', color: 'green' },
    { id: 'mail', title: 'Mail', app: 'mail', icon: 'mail', color: 'sky' },
    { id: 'wetter', title: 'Wetter', app: 'wetter', icon: 'weather', color: 'amber' },
    { id: 'erinnerungen', title: 'Erinnerungen', app: 'erinnerungen', icon: 'bell', color: 'pink', defaultOff: true },
  ];

  function widgetLayout() {
    const all = [...CORE_WIDGETS, ...plugins.widgets()];
    const saved = Array.isArray(stores.config.data.widgets) ? stores.config.data.widgets : [];
    const order = saved.map((w) => w.id).filter((id, i, a) => all.some((x) => x.id === id) && a.indexOf(id) === i);
    const ids = [...order, ...all.filter((x) => !order.includes(x.id)).map((x) => x.id)];
    return ids.map((id) => {
      const w = all.find((x) => x.id === id);
      const sv = saved.find((x) => x.id === id);
      return { ...w, on: sv ? sv.on !== false : !w.defaultOff };
    });
  }

  // Ein Widget laden – ohne macOS-Fenster: Was noch nicht erlaubt ist, zeigt einen „Erlauben“-Knopf.
  async function section(fn) {
    try {
      return { state: 'ok', data: await withRun({ purpose: 'dashboard', emit: null }, fn) };
    } catch (err) {
      if (err instanceof AppError) return { state: { unknown: 'ask', denied: 'denied', off: 'off', offline: 'offline', notInstalled: 'notInstalled', unavailable: 'unavailable' }[err.code] || 'error', error: err.message };
      if (err instanceof BridgeError && err.code === 'offline') return { state: 'offline', error: err.message };
      if (err instanceof ServiceError && err.status === 409) return { state: 'setup', error: err.message };
      return { state: 'error', error: err.message };
    }
  }

  // big = das Widget ist groß aufgeklappt (du hast danach gefragt) – dann gibt es mehr zu sehen
  const overlaps = (e, day) => {
    const next = addDaysIso(day, 1);
    if (e.allDay) return e.start <= day && e.end >= day;
    return e.start < `${next}T00:00` && e.end > `${day}T00:00`;
  };
  const WIDGET_LOADERS = {
    termine: ({ big }) => section(async () => {
      if (!apps.isOn('kalender')) throw new AppError('Kalender ist ausgeschaltet.', 'off');
      const today = todayIso(services.tz());
      const tomorrow = addDaysIso(today, 1);
      const last = addDaysIso(today, big ? 6 : 1);
      const evs = await services.calendar.events(today, last);
      const out = {
        today: evs.filter((e) => (e.allDay ? e.start <= today && e.end >= today : e.start.slice(0, 10) <= today && e.end.slice(0, 10) >= today)),
        tomorrow: evs.filter((e) => (e.allDay ? e.start <= tomorrow && e.end >= tomorrow : e.start.slice(0, 10) === tomorrow)),
        provider: services.calendar.provider(),
      };
      if (big) {
        out.days = Array.from({ length: 7 }, (_, i) => {
          const date = addDaysIso(today, i);
          return { date, events: evs.filter((e) => overlaps(e, date)) };
        });
      }
      return out;
    }),
    whatsapp: ({ big }) => section(async () => {
      if (!apps.isOn('whatsapp')) throw new AppError('WhatsApp ist ausgeschaltet.', 'off');
      if (!bridge.connected()) throw new AppError('Nur in der Mac-App.', 'offline');
      return { chats: await services.whatsapp.chats({ limit: big ? 12 : 6 }) };
    }),
    mail: ({ big }) => section(async () => {
      if (!apps.isOn('mail')) throw new AppError('Mail ist ausgeschaltet.', 'off');
      const m = await services.mail.list({ unreadOnly: true, limit: big ? 12 : 6 });
      return { ...m, provider: services.mail.provider() };
    }),
    wetter: () => section(async () => {
      if (!apps.isOn('wetter')) throw new AppError('Wetter ist ausgeschaltet.', 'off');
      return services.weather.get();
    }),
    erinnerungen: ({ big }) => section(async () => {
      if (!apps.isOn('erinnerungen')) throw new AppError('Erinnerungen sind ausgeschaltet.', 'off');
      if (!bridge.connected()) throw new AppError('Nur in der Mac-App.', 'offline');
      const today = todayIso(services.tz());
      const list = await services.reminders.list();
      const shown = big ? list : list.filter((r) => !r.due || r.due <= addDaysIso(today, 1));
      return { reminders: shown.slice(0, big ? 30 : 8), total: list.length };
    }),
  };

  r('GET', '/api/dashboard', async () => {
    const tz = services.tz();
    const now = nowWall(tz);
    const today = now.date;
    const b = brainStatus(ctx);
    return {
      now: { date: today, time: now.time, weekday: WEEKDAYS[new Date(Date.UTC(now.y, now.m - 1, now.d)).getUTCDay()], timezone: tz },
      connections: services.status(),
      mac: bridge.connected(),
      userName: stores.config.data.userName || '',
      claudeApp: { possible: claudeLinkPossible(), lastSeen: stores.state.data.claudeApp?.lastSeen || null },
      brain: { active: b.active, mode: b.mode, appleReason: b.apple.reason },
      briefing: stores.state.data.briefing?.date === today ? stores.state.data.briefing : null,
      plan: { running: planner.isRunning(), lastError: stores.state.data.plan.date === today ? stores.state.data.plan.lastError : null, doneToday: stores.state.data.lastPlanDate === today, planTime: stores.config.data.planTime },
      todos: todos.list({ status: 'alle' }).filter((t) => !t.done || (t.doneAt && todayIso(tz, t.doneAt) === today)),
      doneCount: todos.list({ status: 'erledigt' }).length,
      widgets: widgetLayout(),
    };
  });

  r('GET', '/api/widget/:id', async (req, res, { params, query }) => {
    const id = params.id;
    const big = query.get('gross') === '1';
    if (id.startsWith('plugin:')) return section(() => plugins.widgetData(id.slice(7), { big }));
    const load = WIDGET_LOADERS[id];
    if (!load) throw new HttpError(404, 'Dieses Widget gibt es nicht.');
    return load({ big });
  });

  r('GET', '/api/widgets', () => ({ widgets: widgetLayout() }));
  r('PUT', '/api/widgets', (req, res, { body }) => {
    if (!Array.isArray(body.widgets)) throw new HttpError(400, 'Bitte eine Liste der Widgets schicken.');
    stores.config.update((c) => {
      c.widgets = body.widgets.slice(0, 40).map((w) => ({ id: String(w.id).slice(0, 60), on: w.on !== false }));
    });
    return { widgets: widgetLayout() };
  });

  // ---------- Apps, Plugins, Gehirn, Karten ----------

  r('GET', '/api/apps', async () => ({ apps: await apps.list(), mac: bridge.connected(), status: services.status() }));
  r('PUT', '/api/apps/:id', (req, res, { params, body }) => {
    const options = apps.set(params.id, body);
    services.calendar.reset();
    services.mail.reset();
    changed('apps');
    return { options };
  });
  r('POST', '/api/apps/:id/allow', async (req, res, { params }) => {
    const r1 = await apps.request(params.id);
    services.calendar.reset();
    changed('apps');
    return r1;
  });

  r('GET', '/api/plugins', () => ({ plugins: plugins.list(), mac: bridge.connected() }));
  r('PUT', '/api/plugins/:id', (req, res, { params, body }) => {
    const plugin = plugins.set(params.id, Boolean(body.enabled));
    changed('plugins');
    return { plugin };
  });
  r('POST', '/api/plugins/:id/control', (req, res, { params, body }) => withRun({ purpose: 'user', emit: null }, () => plugins.control(params.id, String(body.command || ''), body)));

  r('GET', '/api/brain', () => ({ ...brainStatus(ctx), reasons: APPLE_REASONS, models: MODELS, hasKey: Boolean(stores.secrets.data.claudeApiKey) }));
  r('PUT', '/api/brain', (req, res, { body }) => {
    if (!['auto', 'apple', 'claude'].includes(body.mode)) throw new HttpError(400, 'Unbekannte Auswahl.');
    stores.config.update((c) => {
      c.brain = { ...(c.brain || {}), mode: body.mode };
    });
    return brainStatus(ctx);
  });

  r('GET', '/api/actions/:id', (req, res, { params }) => {
    const a = actions.get(params.id);
    if (!a) throw new HttpError(404, 'Diese Karte gibt es nicht mehr.');
    return { action: a };
  });
  r('POST', '/api/actions/:id', async (req, res, { params, body }) => {
    const action = await actions.run(params.id, { choice: Number.isInteger(body.choice) ? body.choice : undefined, text: body.text });
    if (action.kind === 'confirm' || action.kind === 'shortcut') changed('todos');
    return { action };
  });
  r('POST', '/api/actions/:id/cancel', (req, res, { params }) => ({ action: actions.cancel(params.id) }));

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
  const calendarPrefs = () => (services.calendar.provider() === 'mac' ? stores.config.data.apps.kalender : { selected: stores.config.data.icloud.selectedCalendars, defaultCalendar: stores.config.data.icloud.defaultCalendar });
  r('GET', '/api/calendars', async () => withRun({ purpose: 'user', emit: null }, async () => ({ calendars: await services.calendar.calendars({ fresh: true }), defaultCalendar: calendarPrefs().defaultCalendar || null, provider: services.calendar.provider() })));
  r('PUT', '/api/calendars', async (req, res, { body }) => {
    const cals = await withRun({ purpose: 'user', emit: null }, () => services.calendar.calendars({ fresh: true }));
    const ids = cals.map((c) => c.id);
    const selected = Array.isArray(body.selected) ? body.selected.filter((id) => ids.includes(id)) : null;
    const def = ids.includes(body.defaultCalendar) ? body.defaultCalendar : null;
    const sel = selected && selected.length < ids.length ? selected : null;
    const mac = services.calendar.provider() === 'mac';
    stores.config.update((c) => {
      if (mac) {
        c.apps.kalender = { ...(c.apps.kalender || {}), selected: sel, defaultCalendar: def };
      } else {
        c.icloud.selectedCalendars = sel;
        c.icloud.defaultCalendar = def;
      }
    });
    services.calendar.reset();
    return { calendars: await withRun({ purpose: 'user', emit: null }, () => services.calendar.calendars()) };
  });

  const asUser = (fn) => withRun({ purpose: 'user', emit: null }, fn);
  r('GET', '/api/mail', async (req, res, { query }) => asUser(() => services.mail.list({ unreadOnly: query.get('unread') === '1', limit: Number(query.get('limit') || 15) })));
  r('GET', '/api/mail/:id', async (req, res, { params }) => ({ mail: await asUser(() => services.mail.read(params.id)) }));
  r('POST', '/api/mail/:id/mark', async (req, res, { params, body }) => asUser(() => services.mail.mark(params.id, { read: body.read, flagged: body.flagged })));
  r('GET', '/api/whatsapp/:chat', async (req, res, { params }) => asUser(() => services.whatsapp.messages(params.chat, 25)));

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
          assistent: {
            command: process.execPath,
            args: [path.join(ROOT, 'bin', 'mcp-stdio.js')],
            env: { DATA_DIR: dataDir, PORT: String(port) },
          },
        },
      },
      publicHint: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, '')}/mcp/${token}` : null,
    };
  });
  // ---------- Stimmen aus dem Internet ----------

  r('GET', '/api/stimmen', () => voices.list());
  r('POST', '/api/stimmen/:id/laden', (req, res, { params }) => ({ voice: voices.start(params.id) }));
  r('DELETE', '/api/stimmen/:id', (req, res, { params }) => ({ voice: voices.remove(params.id) }));
  r('GET', '/api/stimmen/:id/probe', async (req, res, { params }) => {
    const buf = await voices.sample(params.id);
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
    res.end(buf);
  });
  r('POST', '/api/sprechen', async (req, res, { body }) => {
    const id = String(body.voice || '').replace(/^netz:/, '');
    const wav = await voices.speak(id, body.text, { speed: body.speed });
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
    res.end(wav);
  });

  // ---------- Claude-App: der Assistent als Erweiterung in Claude ----------

  const claudeStatus = () => {
    const seen = stores.state.data.claudeApp || {};
    return {
      possible: claudeLinkPossible(),
      installed: claudeAppInstalled(),
      lastSeen: seen.lastSeen || null,
      client: seen.client || null,
      linkedAt: seen.linkedAt || null,
      configEntry: hasConfigEntry(),
    };
  };
  r('GET', '/api/claude-app', () => claudeStatus());
  r('POST', '/api/claude-app/install', async () => {
    if (!claudeLinkPossible()) throw new HttpError(409, 'Das geht nur auf dem Mac mit der App „Assistent“.');
    const { buffer } = buildExtension({ root: ROOT, dataDir: path.resolve(dataDir), port: app.port, version: APP_VERSION, tools: availableTools(services, { purpose: 'mcp' }) });
    const file = path.join(dataDir, 'Assistent.mcpb');
    fs.writeFileSync(file, buffer, { mode: 0o644 });
    const opened = await openInClaude(file);
    return { ...claudeStatus(), opened, file };
  });
  r('POST', '/api/claude-app/config', () => {
    if (!claudeLinkPossible()) throw new HttpError(409, 'Das geht nur auf dem Mac mit der App „Assistent“.');
    try {
      const file = writeConfigEntry(configEntry({ root: ROOT, dataDir: path.resolve(dataDir), port: app.port }));
      return { ...claudeStatus(), file };
    } catch (err) {
      throw new HttpError(err.status || 500, err.message);
    }
  });
  r('DELETE', '/api/claude-app/config', () => {
    try {
      return { removed: removeConfigEntry(), ...claudeStatus() };
    } catch (err) {
      throw new HttpError(err.status || 500, err.message);
    }
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
      userName: c.userName || '',
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
    if (body.userName !== undefined) patch.userName = String(body.userName || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
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

  r('GET', '/api/chat', () => {
    const log = chat.log();
    const ids = log.flatMap((m) => (m.parts || []).map((p) => p.result?.karte).filter(Boolean));
    const b = brainStatus(ctx);
    return { log, available: true, busy: chat.busy(), brain: { active: b.active, mode: b.mode, appleReason: b.apple.reason }, actions: actions.many(ids) };
  });
  r('POST', '/api/chat', async (req, res, { body }) => {
    const voice = Boolean(body.voice);
    if (!String(req.headers.accept || '').includes('application/x-ndjson')) return chat.send(body.message, body.display, { voice });
    // Live-Übertragung: eine JSON-Zeile pro Ereignis (Text-Stücke, Werkzeug-Start/-Ende, Erlaubnis, Ende)
    if (chat.busy()) throw new HttpError(409, 'Ich antworte gerade noch auf deine letzte Nachricht.');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const send = (evt) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(evt)}\n`);
    };
    const keepAlive = setInterval(() => send({ type: 'ping' }), 15000);
    try {
      const result = await chat.send(body.message, body.display, { voice, stream: true, onEvent: send });
      send({ type: 'done', reply: result.reply, tools: result.tools, brain: result.brain });
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
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }

  function errorStatus(err) {
    if (err instanceof HttpError) return err.status;
    if (err instanceof TodoError || err instanceof ServiceError || err instanceof ToolInputError || err instanceof MacError || err instanceof ActionError || err instanceof PluginError || err instanceof VoiceError) return err.status || 400;
    if (err instanceof AppError || err instanceof BridgeError) return err.status || 409;
    if (err instanceof JxaError) return err.code === 'denied' ? 403 : 502;
    if (err instanceof ClaudeError) return err.status === 401 || err.status === 409 || err.status === 400 ? (err.status === 401 ? 400 : err.status) : 502;
    if (err instanceof CalDAVError) return err.status === 401 || err.status === 403 ? 400 : 502;
    if (err instanceof ImapError) return err.code === 'AUTHENTICATIONFAILED' ? 400 : 502;
    return 500;
  }

  // Merkt sich, wann Claude zuletzt mit dem Assistenten gearbeitet hat (für „Verbunden“ in den Einstellungen)
  let lastNoted = 0;
  function noteClaude(msg, transport) {
    const now = Date.now();
    const client = msg?.params?.clientInfo?.name || msg?.params?._meta?.['io.modelcontextprotocol/clientInfo']?.name || null;
    if (now - lastNoted < 30000 && !client) return;
    lastNoted = now;
    stores.state.update((s) => {
      const prev = s.claudeApp || {};
      s.claudeApp = { ...prev, lastSeen: now, client: client || prev.client || null, transport, linkedAt: prev.linkedAt || now };
    });
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
    noteClaude(Array.isArray(msg) ? msg[0] : msg, transport);
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
        if (route.opts.auth === 'app' && !appAuthorized(req)) throw new HttpError(403, 'Nur für die Mac-App.');
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req, route.opts.bodyLimit) : {};
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
    bridge,
    actions,
    plugins,
    voices,
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
      bridge.close();
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
