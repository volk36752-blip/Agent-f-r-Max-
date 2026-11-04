// Assistent – Oberfläche (ohne Framework). Alle Texte für Nutzer auf Deutsch.

const root = document.getElementById('app');

// ---------------- Helfer ----------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // nur für feste Symbole, nie für Daten
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (paths, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 22a11 11 0 0 1 22 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M2.5 22h27" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M16 6v3M7.2 9.8l2 2M24.8 9.8l-2 2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M11 26.5h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".45"/></svg>',
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  today: svg('<path d="M4 17a8 8 0 0 1 16 0"/><path d="M2 17h20"/><path d="M12 5v2M5.6 7.6l1.4 1.4M18.4 7.6L17 9"/>'),
  agent: svg('<path d="M5 18.5l-1.5 3 4-1.6A9 9 0 1 0 5 18.5z"/><path d="M8.5 11h7M8.5 14.5h4.5"/>'),
  inbox: svg('<path d="M3 13l2.5-7.5h13L21 13v5.5H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  mail: svg('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>'),
  weather: svg('<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.2M2.5 9h1.2M4.4 4.4l.9.9M13.6 4.4l-.9.9"/><path d="M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.4 1.4A2.8 2.8 0 0 0 8 20z"/>'),
  plug: svg('<path d="M9 3v4M15 3v4"/><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 16v5"/>'),
  plus: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>'),
  back: svg('<path d="M14.5 6l-6 6 6 6"/>'),
  klar: svg('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  heiter: svg('<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.2M2.5 9h1.2M4.4 4.4l.9.9M13.6 4.4l-.9.9"/><path d="M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.4 1.4A2.8 2.8 0 0 0 8 20z"/>'),
  wolkig: svg('<path d="M7 19h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 19z"/>'),
  bedeckt: svg('<path d="M7 19h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 19z"/><path d="M9 7.5a5 5 0 0 1 8.6 1"/>'),
  regen: svg('<path d="M7 15.5h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 15.5z"/><path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>'),
  schnee: svg('<path d="M7 15.5h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 15.5z"/><path d="M8 19.5h.01M12 21h.01M16 19.5h.01" stroke-width="2.6"/>'),
  gewitter: svg('<path d="M7 15.5h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 15.5z"/><path d="M12.5 15.5L10.5 19h3l-2 3"/>'),
  nebel: svg('<path d="M4 9h16M3 13h18M5 17h14"/>'),
};

const icon = (name, cls = '') => {
  const span = h('span', { class: cls, html: ICONS[name] || ICONS.wolkig });
  return span.firstElementChild;
};

let toastTimer;
function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show${kind === 'error' ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, kind === 'error' ? 6000 : 3000);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'x-assistent': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Der Assistent ist nicht erreichbar. Läuft er noch auf deinem Mac?', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/password')) {
    route();
    throw new ApiError(data.error || 'Bitte anmelden.', 401);
  }
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, res.status);
  return data;
}

const WEEKDAYS_SHORT = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

function dateFromIso(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function longDate(d) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateFromIso(d));
}

function shortDate(d) {
  const dt = dateFromIso(d);
  return `${WEEKDAYS_SHORT[dt.getUTCDay()]} ${dt.getUTCDate()}. ${new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' }).format(dt)}`;
}

function addDays(d, n) {
  const dt = dateFromIso(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

const minutesOf = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

function relativeDay(d, today) {
  if (d === today) return 'heute';
  if (d === addDays(today, 1)) return 'morgen';
  if (d === addDays(today, -1)) return 'gestern';
  return shortDate(d);
}

function greeting(time) {
  const hr = Number(time.slice(0, 2));
  if (hr >= 5 && hr < 11) return 'Guten Morgen.';
  if (hr >= 11 && hr < 17) return 'Hallo.';
  if (hr >= 17 && hr < 23) return 'Guten Abend.';
  return 'Gute Nacht.';
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Kopiert.'), () => toast('Kopieren hat nicht geklappt – bitte von Hand markieren.', 'error'));
}

// ---------------- Navigation ----------------

let status = null;

function currentPath() {
  return (location.hash || '#/').slice(1) || '/';
}

function go(path) {
  if (currentPath() === path) route();
  else location.hash = path;
}

window.addEventListener('hashchange', () => route());

async function route() {
  stopDashboard();
  try {
    status = await api('GET', '/api/status');
  } catch (err) {
    root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Keine Verbindung'), h('p', {}, err.message), h('button', { class: 'btn', onclick: () => route() }, 'Nochmal versuchen'))));
    return;
  }
  if (status.needsPassword) return renderCreatePassword();
  if (!status.loggedIn) return renderLogin();
  const path = currentPath();
  if (!status.setupDone && !path.startsWith('/einrichtung')) return go('/einrichtung/willkommen');
  if (path.startsWith('/einrichtung')) return renderSetup(path.split('/')[2] || 'willkommen');
  if (path.startsWith('/verbindungen/')) return renderSingleStep(path.split('/')[2]);
  if (path === '/verbindungen') return renderConnections();
  if (path === '/einstellungen') return renderSettings();
  return renderDashboard();
}

function shell(active, ...content) {
  const nav = [
    ['/', 'Heute'],
    ['/verbindungen', 'Verbindungen'],
    ['/einstellungen', 'Einstellungen'],
  ];
  return [
    h('header', { class: 'topbar' },
      h('a', { class: 'wordmark', href: '#/' }, icon('logo'), 'Assistent'),
      h('nav', { class: 'topnav', 'aria-label': 'Hauptmenü' }, nav.map(([p, label]) => h('a', { href: `#${p}`, 'aria-current': active === p ? 'page' : null }, label)))),
    ...content,
  ];
}

// ---------------- Anmelden ----------------

function renderCreatePassword() {
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'new-password', minlength: '8', required: true });
  const pw2 = h('input', { type: 'password', id: 'pw2', autocomplete: 'new-password', required: true });
  const codeInput = h('input', { type: 'text', id: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', required: true });
  const err = h('p', { class: 'error-line', role: 'alert' });
  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pw.value !== pw2.value) {
      err.textContent = 'Die beiden Passwörter sind nicht gleich.';
      return;
    }
    try {
      await api('POST', '/api/setup/password', { password: pw.value, code: codeInput.value });
      go('/einrichtung/willkommen');
    } catch (ex) {
      err.textContent = ex.message;
    }
  } },
  h('span', { class: 'wordmark' }, icon('logo'), 'Assistent'),
  h('h1', {}, 'Leg ein Passwort fest'),
  h('p', {}, 'Damit nur du an deine Termine, Mails und To-dos kommst. Du brauchst es, wenn du das Dashboard auf einem anderen Gerät öffnest.'),
  status.needsCode && h('div', { class: 'field' }, h('label', { for: 'code' }, 'Einrichtungscode'), codeInput, h('span', { class: 'hint' }, 'Steht im Fenster, in dem der Assistent auf deinem Mac läuft.')),
  h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Passwort'), pw, h('span', { class: 'hint' }, 'Mindestens 8 Zeichen.')),
  h('div', { class: 'field' }, h('label', { for: 'pw2' }, 'Passwort wiederholen'), pw2),
  err,
  h('button', { class: 'btn', type: 'submit' }, 'Passwort festlegen'));
  root.replaceChildren(h('main', { class: 'auth' }, form));
  (status.needsCode ? codeInput : pw).focus();
}

function renderLogin() {
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'error-line', role: 'alert' });
  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await api('POST', '/api/login', { password: pw.value });
      route();
    } catch (ex) {
      err.textContent = ex.message;
      pw.select();
    }
  } },
  h('span', { class: 'wordmark' }, icon('logo'), 'Assistent'),
  h('h1', {}, 'Anmelden'),
  h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Passwort'), pw),
  err,
  h('button', { class: 'btn', type: 'submit' }, 'Anmelden'));
  root.replaceChildren(h('main', { class: 'auth' }, form));
  pw.focus();
}

// ---------------- Dashboard ----------------

const dash = { data: null, fetchedAt: 0, timer: null, tick: null, tab: 'heute', els: {}, chat: null };

function stopDashboard() {
  clearInterval(dash.timer);
  clearInterval(dash.tick);
  dash.timer = null;
  dash.tick = null;
}

function nowLocal() {
  // Uhrzeit des Assistenten (seine Zeitzone) plus vergangene Zeit seit dem Laden
  const d = dash.data.now;
  const mins = minutesOf(`${d.date}T${d.time}`) + Math.floor((Date.now() - dash.fetchedAt) / 60000);
  return { date: mins >= 1440 ? addDays(d.date, 1) : d.date, minutes: mins % 1440 };
}

async function loadDashboard() {
  const data = await api('GET', '/api/dashboard');
  dash.data = data;
  dash.fetchedAt = Date.now();
  renderDashboardParts();
}

function renderDashboard() {
  const els = {
    head: h('section', { class: 'daystart', 'aria-label': 'Dein Tag' }),
    band: h('section', { class: 'dayband-wrap', 'aria-label': 'Tagesband' }),
    todos: h('section', { class: 'panel panel-todos', 'aria-labelledby': 'h-todos' }),
    events: h('section', { class: 'panel panel-events', 'aria-labelledby': 'h-events' }),
    agent: h('section', { class: 'panel panel-agent', 'aria-labelledby': 'h-agent' }),
    mail: h('section', { class: 'panel panel-mail', 'aria-labelledby': 'h-mail' }),
  };
  dash.els = els;
  const more = h('nav', { class: 'more-links', 'aria-label': 'Mehr' },
    h('a', { href: '#/verbindungen' }, 'Verbindungen', h('span', { 'aria-hidden': 'true' }, '›')),
    h('a', { href: '#/einstellungen' }, 'Einstellungen', h('span', { 'aria-hidden': 'true' }, '›')));
  const main = h('main', { class: 'page', dataset: { tab: dash.tab } },
    els.head, els.band,
    h('div', { class: 'columns' },
      h('div', { class: 'col' }, els.todos, els.events),
      h('div', { class: 'col' }, els.agent, els.mail)),
    more);
  const tabs = [['heute', 'Heute', 'today'], ['agent', 'Agent', 'agent'], ['post', 'Post', 'inbox'], ['mehr', 'Mehr', 'menu']];
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Bereiche' }, tabs.map(([id, label, ic]) => h('button', {
    type: 'button',
    'aria-current': dash.tab === id ? 'true' : 'false',
    dataset: { tab: id },
    onclick: () => {
      dash.tab = id;
      main.dataset.tab = id;
      tabbar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === id ? 'true' : 'false'));
      window.scrollTo({ top: 0 });
      if (id === 'agent') scrollChat();
    },
  }, icon(ic), label)));
  dash.els.tabbar = tabbar;
  root.replaceChildren(...shell('/', main), tabbar);
  els.head.append(h('p', { class: 'date' }, 'Lade deinen Tag …'));
  renderAgentPanel();
  loadDashboard().catch((err) => toast(err.message, 'error'));
  dash.timer = setInterval(() => {
    if (document.visibilityState === 'visible') loadDashboard().catch(() => {});
  }, 120000);
  dash.tick = setInterval(() => {
    if (dash.data) renderBand();
  }, 60000);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (dash.data && dash.els.band?.isConnected) renderBand();
  }, 150);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (dash.data && dash.els.band?.isConnected) renderBand();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dash.timer && Date.now() - dash.fetchedAt > 30000) loadDashboard().catch(() => {});
});

function renderDashboardParts() {
  renderHead();
  renderBand();
  renderTodos();
  renderEvents();
  renderMail();
  const unread = dash.data.mail?.total || 0;
  const postBtn = dash.els.tabbar?.querySelector('[data-tab="post"]');
  if (postBtn) {
    postBtn.querySelector('.badge')?.remove();
    if (unread) postBtn.append(h('span', { class: 'badge', 'aria-label': `${unread} ungelesen` }, unread > 99 ? '99+' : unread));
  }
}

function renderHead() {
  const d = dash.data;
  const el = dash.els.head;
  const w = d.weather;
  let briefing;
  if (d.briefing) briefing = h('p', { class: 'briefing' }, d.briefing.text);
  else if (d.plan.running) briefing = h('p', { class: 'briefing briefing-muted' }, 'Ich stelle gerade deinen Tagesplan zusammen …');
  else {
    const runBtn = h('button', { class: 'link-btn', type: 'button', onclick: async () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Wird erstellt …';
      try {
        const r = await api('POST', '/api/plan/run');
        toast(r.created ? `Tagesplan fertig – ${r.created} neue To-dos.` : 'Tagesplan fertig.');
        await loadDashboard();
      } catch (err) {
        toast(err.message, 'error');
        runBtn.disabled = false;
        runBtn.textContent = 'Jetzt erstellen';
      }
    } }, 'Jetzt erstellen');
    const text = d.plan.lastError
      ? `Der Tagesplan hat nicht geklappt: ${d.plan.lastError}`
      : `Dein Tagesplan kommt jeden Morgen ab ${d.plan.planTime} Uhr, sobald dein Mac an ist.`;
    briefing = h('p', { class: `briefing briefing-muted${d.plan.lastError ? ' error-line' : ''}` }, text, ' ', runBtn);
  }
  const weather = w
    ? h('div', { class: 'weather' },
      icon(w.current.icon),
      h('span', { class: 'temp' }, `${Math.round(w.current.temp)}°`),
      h('span', { class: 'desc' }, h('strong', {}, w.current.text), `${Math.round(w.today.min)} bis ${Math.round(w.today.max)} °C`, h('br'), w.place))
    : d.weatherError ? h('div', { class: 'weather' }, h('span', { class: 'desc' }, d.weatherError)) : null;
  el.replaceChildren(
    h('div', {}, h('p', { class: 'date' }, longDate(d.now.date)), h('h1', {}, greeting(d.now.time))),
    weather,
    briefing,
  );
}

// Himmel über den Tag: Farben nach Uhrzeit, Sonnenauf- und -untergang aus dem Wetter
const hm = (str) => Number(str.slice(0, 2)) * 60 + Number(str.slice(3, 5));

function skyGradient(startMin, endMin, sunrise, sunset, dark) {
  const rise = sunrise ? hm(sunrise) : 7 * 60;
  const set = sunset ? hm(sunset) : 17 * 60;
  const palette = dark
    ? { night: '#121a33', dawn: '#6a4a5e', morning: '#3a5a86', day: '#2f5d8f', dusk: '#6b4b62' }
    : { night: '#26305a', dawn: '#e8a57f', morning: '#bcd7f0', day: '#97c3ec', dusk: '#e3a989' };
  const stops = [
    [0, palette.night],
    [rise - 70, palette.night],
    [rise, palette.dawn],
    [rise + 90, palette.morning],
    [(rise + set) / 2, palette.day],
    [set - 60, palette.morning],
    [set, palette.dusk],
    [set + 70, palette.night],
    [1440, palette.night],
  ];
  const pct = (m) => `${(((m - startMin) / (endMin - startMin)) * 100).toFixed(2)}%`;
  return `linear-gradient(90deg, ${stops.map(([m, c]) => `${c} ${pct(m)}`).join(', ')})`;
}

function renderBand() {
  const d = dash.data;
  const el = dash.els.band;
  const today = d.now.date;
  const events = d.events?.today || [];
  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);
  const startOfDay = (e) => (e.start.slice(0, 10) < today ? 0 : minutesOf(e.start));
  const endOfDay = (e) => (e.end.slice(0, 10) > today ? 1440 : minutesOf(e.end));
  const firstHour = Math.min(6, ...timed.map((e) => Math.floor(startOfDay(e) / 60)));
  const lastHour = Math.max(23, ...timed.map((e) => Math.ceil(endOfDay(e) / 60)));
  const startMin = firstHour * 60;
  const endMin = Math.min(lastHour + 1, 24) * 60;
  const span = endMin - startMin;
  const pos = (m) => `${(((Math.min(Math.max(m, startMin), endMin) - startMin) / span) * 100).toFixed(3)}%`;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const now = nowLocal();
  const band = h('div', { class: 'dayband', role: 'img', 'aria-label': timed.length ? `Heute: ${timed.map((e) => `${e.start.slice(11)} ${e.title}`).join(', ')}` : 'Heute keine Termine mit Uhrzeit' });
  band.style.backgroundImage = skyGradient(startMin, endMin, d.weather?.today?.sunrise, d.weather?.today?.sunset, dark);
  // Termine auf Spuren verteilen, damit sich nichts überdeckt. Kurze Termine werden so breit wie ihr Text.
  const isMobile = matchMedia('(max-width: 860px)').matches;
  const W = el.clientWidth || 1000;
  const laneTop = isMobile ? 8 : 12;
  const laneHeight = isMobile ? 29 : 40;
  const lanesEnd = [];
  const sorted = [...timed].sort((a, b) => startOfDay(a) - startOfDay(b));
  for (const e of sorted) {
    const s = startOfDay(e);
    const en = Math.max(endOfDay(e), s + 15);
    const label = `${e.start.slice(11)} ${e.title}`;
    const textW = Math.min(isMobile ? 110 : 240, label.length * (isMobile ? 6.2 : 7.4) + 26);
    const w = Math.max(((en - s) / span) * W - 3, isMobile ? Math.min(textW, 90) : textW, 24);
    let x = ((Math.max(s, startMin) - startMin) / span) * W;
    if (x + w > W - 6) x = Math.max(0, W - 6 - w);
    let lane = lanesEnd.findIndex((end) => end + 4 <= x);
    if (lane < 0) {
      lane = Math.min(lanesEnd.length, 2);
      if (lane === lanesEnd.length) lanesEnd.push(0);
    }
    lanesEnd[lane] = Math.max(lanesEnd[lane], x + w);
    const block = h('div', { class: `lane-block${now.date === today && endOfDay(e) < now.minutes ? ' past' : ''}`, title: `${e.start.slice(11)}–${e.end.slice(11)} ${e.title}${e.location ? `, ${e.location}` : ''}` },
      h('b', { class: 't' }, e.start.slice(0, 10) < today ? '…' : e.start.slice(11)), e.title);
    block.style.left = `${((x / W) * 100).toFixed(3)}%`;
    block.style.width = `${Math.round(w)}px`;
    block.style.top = `${laneTop + lane * laneHeight}px`;
    if (e.color) block.style.setProperty('--cal', e.color);
    band.append(block);
  }
  for (const t of d.todos.filter((x) => x.due === today && x.time)) {
    const pin = h('span', { class: `todo-pin${t.done ? ' done' : ''}`, title: `${t.time} ${t.title}` });
    pin.style.left = pos(hm(t.time));
    band.append(pin);
  }
  if (!timed.length) band.append(h('span', { class: 'band-empty' }, d.connections.calendar.connected ? (d.eventsError ? 'Kalender gerade nicht erreichbar' : 'Heute keine Termine mit Uhrzeit') : 'Verbinde deinen Kalender, dann siehst du hier deinen Tag'));
  if (now.date === today && now.minutes >= startMin && now.minutes <= endMin) {
    const marker = h('span', { class: 'now', title: 'Jetzt' });
    marker.style.left = pos(now.minutes);
    band.append(marker);
  }
  const hours = h('div', { class: 'hours', 'aria-hidden': 'true' });
  for (let hr = firstHour; hr < endMin / 60; hr += 3) {
    const s = h('span', {}, `${hr}`);
    s.style.left = pos(hr * 60);
    hours.append(s);
  }
  el.replaceChildren(
    allDay.length ? h('div', { class: 'allday' }, allDay.map((e) => h('span', {}, e.title))) : '',
    band,
    hours,
  );
}

// ---------------- To-dos ----------------

const SOURCE_LABEL = { agent: 'vom Agent', tagesplan: 'Tagesplan', claude: 'über Claude' };

function groupTodos(list, today) {
  const tomorrow = addDays(today, 1);
  const groups = [
    { id: 'late', title: 'Überfällig', items: [] },
    { id: 'today', title: 'Heute', items: [] },
    { id: 'tomorrow', title: 'Morgen', items: [] },
    { id: 'later', title: 'Später', items: [] },
    { id: 'none', title: 'Ohne Datum', items: [] },
    { id: 'done', title: 'Heute erledigt', items: [] },
  ];
  const g = Object.fromEntries(groups.map((x) => [x.id, x]));
  for (const t of list) {
    if (t.done) g.done.items.push(t);
    else if (!t.due) g.none.items.push(t);
    else if (t.due < today) g.late.items.push(t);
    else if (t.due === today) g.today.items.push(t);
    else if (t.due === tomorrow) g.tomorrow.items.push(t);
    else g.later.items.push(t);
  }
  return groups.filter((x) => x.items.length);
}

function renderTodos() {
  const d = dash.data;
  const el = dash.els.todos;
  const today = d.now.date;
  const open = d.todos.filter((t) => !t.done);
  const dueToday = open.filter((t) => t.due && t.due <= today).length;

  const title = h('input', { type: 'text', placeholder: 'Neues To-do', 'aria-label': 'Neues To-do', maxlength: '200', autocomplete: 'off' });
  const when = h('select', { 'aria-label': 'Wann' },
    h('option', { value: 'heute' }, 'Heute'),
    h('option', { value: 'morgen' }, 'Morgen'),
    h('option', { value: 'ohne' }, 'Ohne Datum'));
  const form = h('form', { class: 'todo-add', onsubmit: async (e) => {
    e.preventDefault();
    const text = title.value.trim();
    if (!text) return title.focus();
    const due = when.value === 'heute' ? today : when.value === 'morgen' ? addDays(today, 1) : null;
    title.value = '';
    try {
      const { todo } = await api('POST', '/api/todos', { title: text, due });
      d.todos.push(todo);
      renderTodos();
      dash.els.todos.querySelector('input[type="text"]').focus();
    } catch (err) {
      toast(err.message, 'error');
      title.value = text;
    }
  } }, title, when, h('button', { class: 'btn', type: 'submit' }, 'Hinzufügen'));

  const groups = groupTodos(d.todos, today);
  const body = groups.length
    ? groups.map((g) => h('div', { class: `todo-group${g.id === 'late' ? ' late' : ''}` },
      h('h3', {}, g.title),
      h('ul', { class: 'todo-list' }, g.items.map((t) => todoItem(t, today)))))
    : h('p', { class: 'empty' }, d.connections.claude.connected ? 'Nichts zu tun. Schreib oben ein To-do rein oder frag den Agenten.' : 'Nichts zu tun. Schreib oben dein erstes To-do rein.');

  const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.matches('.todo-add input');
  el.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', { id: 'h-todos' }, 'To-dos'), h('span', { class: 'count' }, dueToday ? `${dueToday} für heute` : open.length ? `${open.length} offen` : '')),
    form,
    ...[].concat(body),
  );
  if (focused) title.focus();
}

function todoItem(t, today) {
  const meta = [];
  if (t.due && t.due < today && !t.done) meta.push(h('span', { class: 'late' }, `seit ${relativeDay(t.due, today)}`));
  else if (t.due && t.due > addDays(today, 1)) meta.push(h('span', {}, shortDate(t.due)));
  if (t.time) meta.push(h('span', {}, `${t.time} Uhr`));
  if (t.priority === 'hoch') meta.push(h('span', { class: 'important' }, 'wichtig'));
  if (SOURCE_LABEL[t.source]) meta.push(h('span', {}, SOURCE_LABEL[t.source]));
  const li = h('li', { class: `todo${t.done ? ' done' : ''}` },
    h('button', { class: 'tick', type: 'button', 'aria-pressed': t.done ? 'true' : 'false', 'aria-label': t.done ? `„${t.title}“ wieder öffnen` : `„${t.title}“ abhaken`, onclick: () => toggleTodo(t) },
      h('span', {}, icon('check'))),
    h('div', { class: 'todo-body' },
      h('div', { class: 'todo-title' }, t.title),
      meta.length ? h('div', { class: 'todo-meta' }, meta) : '',
      t.notes ? h('div', { class: 'todo-notes' }, t.notes.length > 140 ? `${t.notes.slice(0, 140)} …` : t.notes) : ''),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `„${t.title}“ bearbeiten`, onclick: () => editTodo(t), html: ICONS.more }));
  return li;
}

async function toggleTodo(t) {
  const done = !t.done;
  t.done = done;
  t.doneAt = done ? Date.now() : null;
  renderTodos();
  renderBand();
  try {
    const { todo } = await api('PATCH', `/api/todos/${t.id}`, { done });
    Object.assign(t, todo);
  } catch (err) {
    t.done = !done;
    renderTodos();
    toast(err.message, 'error');
  }
}

function editTodo(t) {
  const title = h('input', { type: 'text', id: 'et-title', value: t.title, maxlength: '200', required: true });
  const due = h('input', { type: 'date', id: 'et-due', value: t.due || '' });
  const time = h('input', { type: 'time', id: 'et-time', value: t.time || '' });
  const important = h('input', { type: 'checkbox', id: 'et-prio', checked: t.priority === 'hoch' });
  const notes = h('textarea', { id: 'et-notes', maxlength: '2000' });
  notes.value = t.notes || '';
  const dialog = h('dialog', { 'aria-labelledby': 'et-h' });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const form = h('form', { class: 'dialog-inner', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const { todo } = await api('PATCH', `/api/todos/${t.id}`, { title: title.value, due: due.value || null, time: time.value || null, priority: important.checked ? 'hoch' : 'normal', notes: notes.value });
      Object.assign(t, todo);
      close();
      renderTodos();
      renderBand();
    } catch (err) {
      toast(err.message, 'error');
    }
  } },
  h('h2', { id: 'et-h' }, 'To-do bearbeiten'),
  h('div', { class: 'field' }, h('label', { for: 'et-title' }, 'Was'), title),
  h('div', { class: 'row-2' }, h('div', { class: 'field' }, h('label', { for: 'et-due' }, 'Fällig am'), due), h('div', { class: 'field' }, h('label', { for: 'et-time' }, 'Uhrzeit'), time)),
  h('label', { class: 'check' }, important, h('span', {}, 'Wichtig')),
  h('div', { class: 'field' }, h('label', { for: 'et-notes' }, 'Notizen'), notes),
  h('div', { class: 'dialog-actions' },
    h('button', { class: 'btn btn-danger left', type: 'button', onclick: async () => {
      try {
        await api('DELETE', `/api/todos/${t.id}`);
        dash.data.todos = dash.data.todos.filter((x) => x.id !== t.id);
        close();
        renderTodos();
        renderBand();
        toast('To-do gelöscht.');
      } catch (err) {
        toast(err.message, 'error');
      }
    } }, 'Löschen'),
    h('button', { class: 'btn btn-quiet', type: 'button', onclick: close }, 'Abbrechen'),
    h('button', { class: 'btn', type: 'submit' }, 'Speichern')));
  dialog.append(form);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  title.focus();
}

// ---------------- Termine ----------------

function eventRow(e, day, nowMin) {
  const start = e.allDay ? 'ganztags' : e.start.slice(0, 10) < day ? 'bis' : e.start.slice(11);
  const shown = e.allDay ? start : start === 'bis' ? `bis ${e.end.slice(11)}` : start;
  const li = h('li', { class: `event${nowMin !== null && !e.allDay && e.end.slice(0, 10) === day && minutesOf(e.end) < nowMin ? ' past' : ''}` },
    h('time', {}, shown),
    h('div', {}, h('div', { class: 'title' }, h('span', { class: 'dot' }), h('span', {}, e.title)), e.location ? h('div', { class: 'where' }, e.location) : ''));
  if (e.color) li.style.setProperty('--cal', e.color);
  return li;
}

function renderEvents() {
  const d = dash.data;
  const el = dash.els.events;
  const head = h('div', { class: 'panel-head' }, h('h2', { id: 'h-events' }, 'Termine'));
  if (!d.connections.calendar.connected) {
    el.replaceChildren(head, h('div', { class: 'notice' }, h('p', {}, 'Wenn du deinen iCloud-Kalender verbindest, stehen hier deine Termine von heute und morgen.'), h('a', { class: 'btn btn-quiet', href: '#/verbindungen/kalender' }, 'Kalender verbinden')));
    return;
  }
  if (d.eventsError) {
    el.replaceChildren(head, h('p', { class: 'error-line' }, d.eventsError));
    return;
  }
  const now = nowLocal();
  const today = d.events?.today || [];
  const tomorrow = d.events?.tomorrow || [];
  el.replaceChildren(head,
    h('p', { class: 'subhead' }, 'Heute'),
    today.length ? h('ul', { class: 'events' }, today.map((e) => eventRow(e, d.now.date, now.minutes))) : h('p', { class: 'empty' }, 'Keine Termine.'),
    h('p', { class: 'subhead' }, `Morgen, ${shortDate(addDays(d.now.date, 1))}`),
    tomorrow.length ? h('ul', { class: 'events' }, tomorrow.map((e) => eventRow(e, addDays(d.now.date, 1), null))) : h('p', { class: 'empty' }, 'Keine Termine.'));
}

// ---------------- Post ----------------

function renderMail() {
  const d = dash.data;
  const el = dash.els.mail;
  const total = d.mail?.total || 0;
  const head = h('div', { class: 'panel-head' }, h('h2', { id: 'h-mail' }, 'Posteingang'), h('span', { class: 'count' }, d.mail ? (total ? `${total} ungelesen` : 'alles gelesen') : ''));
  if (!d.connections.mail.connected) {
    el.replaceChildren(head, h('div', { class: 'notice' }, h('p', {}, 'Verbinde deine iCloud-Mail, dann zeige ich dir hier, was ungelesen ist – und der Agent kann Antworten vorschreiben.'), h('a', { class: 'btn btn-quiet', href: '#/verbindungen/mail' }, 'Mail verbinden')));
    return;
  }
  if (d.mailError) {
    el.replaceChildren(head, h('p', { class: 'error-line' }, d.mailError));
    return;
  }
  const list = d.mail.messages;
  el.replaceChildren(head, list.length
    ? h('ul', { class: 'mails' }, list.map((m) => h('li', {}, h('button', { class: 'mail-row', type: 'button', onclick: () => openMail(m) },
      h('span', { class: 'from' }, m.from),
      h('time', {}, m.date.slice(0, 10) === d.now.date ? m.date.slice(11) : shortDate(m.date.slice(0, 10))),
      h('span', { class: 'subject' }, m.subject)))))
    : h('p', { class: 'empty' }, 'Keine ungelesenen Mails.'));
}

async function openMail(m) {
  const dialog = h('dialog', { class: 'wide', 'aria-labelledby': 'mail-h' });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const inner = h('div', { class: 'dialog-inner' }, h('h2', { id: 'mail-h' }, m.subject), h('p', { class: 'thinking' }, 'Lade die Mail …'));
  dialog.append(inner);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  try {
    const { mail } = await api('GET', `/api/mail/${encodeURIComponent(m.id)}`);
    const chatAbout = (prompt, display) => {
      close();
      dash.tab = 'agent';
      dash.els.tabbar?.querySelector('[data-tab="agent"]')?.click();
      sendChat(prompt, display);
    };
    inner.replaceChildren(
      h('h2', { id: 'mail-h' }, mail.subject),
      h('div', { class: 'mail-meta' }, h('span', {}, `Von: ${mail.from}`), mail.to ? h('span', {}, `An: ${mail.to}`) : '', mail.date ? h('span', {}, `${shortDate(mail.date.slice(0, 10))}, ${mail.date.slice(11)} Uhr`) : '', mail.attachments.length ? h('span', {}, `Anhänge: ${mail.attachments.join(', ')}`) : ''),
      h('div', { class: 'mail-text' }, mail.text || '(kein Text)'),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-quiet left', type: 'button', onclick: async () => {
          try {
            await api('POST', `/api/mail/${encodeURIComponent(m.id)}/mark`, { read: true });
            close();
            toast('Als gelesen markiert.');
            loadDashboard().catch(() => {});
          } catch (err) {
            toast(err.message, 'error');
          }
        } }, 'Als gelesen markieren'),
        dash.data.connections.claude.connected ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => chatAbout(`Lies die Mail mit der id ${m.id} von ${m.from} („${m.subject}“). Prüf, ob ich Zeit habe, falls es um einen Termin geht, und schreib mir einen kurzen Antwort-Entwurf (als Entwurf speichern).`, `Schreib mir eine Antwort auf die Mail von ${m.from}: „${m.subject}“`) }, 'Antwort vorschreiben') : '',
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Schließen')));
  } catch (err) {
    inner.replaceChildren(h('h2', { id: 'mail-h' }, m.subject), h('p', { class: 'error-line' }, err.message), h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Schließen')));
  }
}

// ---------------- Agent-Chat ----------------

const SUGGESTIONS = ['Was steht heute an?', 'Hab ich morgen Nachmittag Zeit?', 'Welche Mails brauchen eine Antwort?', 'Plan mir den morgigen Tag'];

function scrollChat() {
  const log = dash.els.agent?.querySelector('.chat-log');
  if (log) requestAnimationFrame(() => {
    log.scrollTop = log.scrollHeight;
  });
}

async function renderAgentPanel() {
  const el = dash.els.agent;
  const head = h('div', { class: 'panel-head' }, h('h2', { id: 'h-agent' }, 'Agent'), h('span', { class: 'spacer' }));
  el.replaceChildren(head, h('p', { class: 'thinking' }, 'Lade …'));
  let data;
  try {
    data = await api('GET', '/api/chat');
  } catch (err) {
    el.replaceChildren(head, h('p', { class: 'error-line' }, err.message));
    return;
  }
  dash.chat = { log: data.log, busy: false };
  if (!data.available) {
    el.replaceChildren(head, h('div', { class: 'notice' },
      h('p', {}, 'Hier kannst du mit dem Agenten schreiben: „Hab ich Freitag Zeit?“, „Trag mir Zahnarzt am Dienstag um 10 ein“, „Fass meine Mails zusammen“. Dafür braucht er einen Claude-API-Schlüssel.'),
      h('a', { class: 'btn btn-quiet', href: '#/verbindungen/claude' }, 'Claude verbinden')));
    return;
  }
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = h('textarea', { rows: '1', placeholder: 'Schreib dem Agenten …', 'aria-label': 'Nachricht an den Agenten', maxlength: '8000' });
  const send = h('button', { class: 'btn', type: 'submit' }, 'Senden');
  const form = h('form', { class: 'chat-form', onsubmit: (e) => {
    e.preventDefault();
    sendChat(input.value);
  } }, input, send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 160)}px`;
  });
  head.append(h('button', { class: 'link-btn', type: 'button', onclick: async () => {
    try {
      await api('DELETE', '/api/chat');
      dash.chat.log = [];
      renderChatLog();
    } catch (err) {
      toast(err.message, 'error');
    }
  } }, 'Neuer Chat'));
  el.replaceChildren(head, h('div', { class: 'chat' }, log, form));
  dash.els.chatLog = log;
  dash.els.chatInput = input;
  dash.els.chatSend = send;
  renderChatLog();
}

function renderChatLog() {
  const log = dash.els.chatLog;
  if (!log) return;
  const items = dash.chat.log.map((m) => (m.role === 'user'
    ? h('div', { class: 'msg msg-user' }, m.text)
    : h('div', { class: 'msg msg-assistant' }, m.text, m.tools?.length ? h('div', { class: 'msg-tools', 'aria-label': 'Benutzt' }, [...new Set(m.tools)].map((t) => h('span', {}, t))) : '')));
  if (dash.chat.busy) items.push(h('p', { class: 'thinking msg' }, 'Denkt nach', h('i', {}, '.'), h('i', {}, '.'), h('i', {}, '.')));
  if (!items.length) {
    items.push(h('div', { class: 'suggestions' }, SUGGESTIONS.map((s) => h('button', { type: 'button', onclick: () => sendChat(s) }, s))));
  }
  log.replaceChildren(...items);
  scrollChat();
}

async function sendChat(text, display) {
  const message = String(text || '').trim();
  if (!message || !dash.chat || dash.chat.busy) return;
  if (!dash.els.chatLog) return;
  dash.chat.log.push({ role: 'user', text: display || message });
  dash.chat.busy = true;
  dash.els.chatInput.value = '';
  dash.els.chatInput.style.height = '';
  dash.els.chatSend.disabled = true;
  renderChatLog();
  try {
    const r = await api('POST', '/api/chat', { message, display });
    dash.chat.log.push({ role: 'assistant', text: r.reply, tools: r.tools.map((t) => t.title) });
    if (r.tools.some((t) => !/anzeigen|lesen|suchen|prüfen|Überblick|Wetter/i.test(t.title))) loadDashboard().catch(() => {});
  } catch (err) {
    dash.chat.log.push({ role: 'assistant', text: `Das hat nicht geklappt: ${err.message}` });
  } finally {
    dash.chat.busy = false;
    dash.els.chatSend.disabled = false;
    renderChatLog();
    dash.els.chatInput.focus({ preventScroll: true });
  }
}

// ---------------- Einrichtung ----------------

const STEPS = ['willkommen', 'kalender', 'mail', 'wetter', 'claude', 'claude-app', 'wuensche', 'fertig'];

async function connections() {
  return api('GET', '/api/connections');
}

async function skip(id) {
  const c = await connections();
  await api('PUT', '/api/wishes', { skipped: [...new Set([...c.skipped, id])] });
}

function stepPage(step, single, ...content) {
  const idx = STEPS.indexOf(step);
  const progress = single
    ? h('p', { class: 'setup-progress' }, h('a', { href: '#/verbindungen' }, '‹ Zurück zu den Verbindungen'))
    : [h('p', { class: 'setup-progress' }, idx > 0 && idx < STEPS.length - 1 ? `Schritt ${idx} von ${STEPS.length - 2}` : 'Einrichtung'), h('div', { class: 'setup-bar' }, (() => {
      const bar = h('div');
      bar.style.setProperty('--p', `${(idx / (STEPS.length - 1)) * 100}%`);
      return bar;
    })())];
  return h('main', { class: 'page page-narrow setup' }, progress, ...content);
}

function nextStep(step, single) {
  if (single) return go('/verbindungen');
  go(`/einrichtung/${STEPS[STEPS.indexOf(step) + 1]}`);
}

function actions(...btns) {
  return h('div', { class: 'actions' }, btns);
}

function laterButton(step, id, single) {
  if (single) return h('a', { class: 'btn btn-quiet', href: '#/verbindungen' }, 'Abbrechen');
  return h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
    await skip(id).catch(() => {});
    nextStep(step, single);
  } }, 'Später');
}

function submitting(form, fn) {
  return async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Prüfe …';
    const err = form.querySelector('.error-line');
    err.textContent = '';
    try {
      await fn();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

const APP_PW_HELP = () => h('div', { class: 'stack-tight' },
  h('ol', { class: 'steps-help' },
    h('li', {}, 'Öffne ', h('a', { href: 'https://account.apple.com', target: '_blank', rel: 'noopener' }, 'account.apple.com'), ' und melde dich an.'),
    h('li', {}, 'Wähle bei „Anmeldung und Sicherheit“ den Punkt „App-spezifische Passwörter“.'),
    h('li', {}, 'Erzeuge ein neues Passwort, zum Beispiel mit dem Namen „Assistent“, und kopiere es hierher.')),
  h('p', { class: 'hint' }, 'Dafür muss bei deiner Apple-ID die Zwei-Faktor-Authentifizierung an sein. ', h('a', { href: 'https://support.apple.com/de-de/102654', target: '_blank', rel: 'noopener' }, 'Anleitung von Apple')));

const STEP_RENDERERS = {
  async willkommen(step) {
    return stepPage(step, false,
      h('div', { class: 'app-mark', html: ICONS.logo }),
      h('h1', {}, 'Hallo! Ich bin dein Assistent.'),
      h('p', { class: 'lead' }, 'Ich frage dich jetzt nacheinander, auf welche Apps ich zugreifen darf: Kalender, Mail, Wetter, Claude und was du dir sonst noch wünschst. Jede Frage kannst du überspringen und später unter „Verbindungen“ nachholen.'),
      h('p', { class: 'lead' }, 'Deine Zugangsdaten bleiben auf deinem Mac im Ordner „data“ und werden nirgendwo hochgeladen.'),
      actions(h('button', { class: 'btn', type: 'button', onclick: () => nextStep(step) }, 'Los geht’s')));
  },

  async kalender(step, single) {
    const c = await connections();
    const appleId = h('input', { type: 'email', id: 'apple-id', value: c.icloud.appleId || '', autocomplete: 'username', required: true, placeholder: 'name@icloud.com' });
    const pw = h('input', { type: 'password', id: 'app-pw', autocomplete: 'off', placeholder: c.icloud.hasPassword ? 'Schon gespeichert – leer lassen zum Behalten' : 'xxxx-xxxx-xxxx-xxxx', required: !c.icloud.hasPassword });
    const form = h('form', {},
      h('div', { class: 'field' }, h('label', { for: 'apple-id' }, 'Apple-ID'), appleId, h('span', { class: 'hint' }, 'Die E-Mail-Adresse, mit der du dich bei Apple anmeldest.')),
      h('div', { class: 'field' }, h('label', { for: 'app-pw' }, 'App-spezifisches Passwort'), pw, h('span', { class: 'hint' }, 'Nicht dein normales Apple-Passwort, sondern ein extra Passwort nur für den Assistenten. Du kannst es jederzeit bei Apple widerrufen.')),
      APP_PW_HELP(),
      h('p', { class: 'error-line', role: 'alert' }),
      actions(h('button', { class: 'btn', type: 'submit' }, 'Kalender verbinden'), laterButton(step, 'calendar', single)));
    form.addEventListener('submit', submitting(form, async () => {
      const r = await api('PUT', '/api/connections/icloud', { appleId: appleId.value, appPassword: pw.value, calendar: true });
      toast(`Kalender verbunden – ${r.calendars} ${r.calendars === 1 ? 'Kalender' : 'Kalender'} gefunden.`);
      nextStep(step, single);
    }));
    return stepPage(step, single,
      h('div', { class: 'app-mark', html: ICONS.calendar }),
      h('h1', {}, 'Darf ich deinen Kalender sehen?'),
      h('p', { class: 'lead' }, 'Dann zeige ich dir deinen Tag, sage dir, ob du Zeit hast, und trage auf Wunsch Termine ein. Verbunden wird dein iCloud-Kalender, also dasselbe wie in der Kalender-App auf iPhone und Mac.'),
      form);
  },

  async mail(step, single) {
    const c = await connections();
    const guess = c.icloud.mailAddress || (/@(icloud|me|mac)\.com$/i.test(c.icloud.appleId) ? c.icloud.appleId : '');
    const address = h('input', { type: 'email', id: 'mail-addr', value: guess, autocomplete: 'email', required: true, placeholder: 'name@icloud.com' });
    const pw = h('input', { type: 'password', id: 'app-pw', autocomplete: 'off', placeholder: 'xxxx-xxxx-xxxx-xxxx', required: !c.icloud.hasPassword });
    const pwField = h('div', { class: 'field' }, h('label', { for: 'app-pw' }, 'App-spezifisches Passwort'), pw);
    const reuse = c.icloud.hasPassword
      ? h('p', { class: 'hint' }, 'Ich benutze dasselbe app-spezifische Passwort wie beim Kalender. ', h('button', { class: 'link-btn', type: 'button', onclick: (e) => {
        e.target.closest('p').replaceWith(pwField, APP_PW_HELP());
      } }, 'Anderes eingeben'))
      : null;
    const form = h('form', {},
      h('div', { class: 'field' }, h('label', { for: 'mail-addr' }, 'iCloud-Mail-Adresse'), address, h('span', { class: 'hint' }, 'Deine Adresse, die auf @icloud.com, @me.com oder @mac.com endet.')),
      reuse || [pwField, APP_PW_HELP()],
      h('p', { class: 'error-line', role: 'alert' }),
      actions(h('button', { class: 'btn', type: 'submit' }, 'Mail verbinden'), laterButton(step, 'mail', single)));
    form.addEventListener('submit', submitting(form, async () => {
      const r = await api('PUT', '/api/connections/icloud', { mailAddress: address.value, appPassword: pw.value, mail: true });
      toast(`Mail verbunden – ${r.inbox} Mails im Posteingang.`);
      nextStep(step, single);
    }));
    return stepPage(step, single,
      h('div', { class: 'app-mark', html: ICONS.mail }),
      h('h1', {}, 'Darf ich deine Mails lesen?'),
      h('p', { class: 'lead' }, 'Dann zeige ich dir Ungelesenes, fasse zusammen, mache aus Fragen wie „Hast du Freitag Zeit?“ ein To-do und schreibe Antwort-Entwürfe. Abschicken tust du immer selbst – ich verschicke nie etwas.'),
      form);
  },

  async wetter(step, single) {
    const c = await connections();
    const q = h('input', { type: 'search', id: 'place', placeholder: 'Ort eingeben, z. B. Stuttgart', autocomplete: 'off', value: c.weather.enabled ? c.weather.name : '' });
    const results = h('ul', { class: 'places', 'aria-live': 'polite' });
    const err = h('p', { class: 'error-line', role: 'alert' });
    let timer;
    const search = async () => {
      err.textContent = '';
      if (q.value.trim().length < 2) {
        results.replaceChildren();
        return;
      }
      try {
        const { places } = await api('GET', `/api/weather/places?q=${encodeURIComponent(q.value.trim())}`);
        results.replaceChildren(...(places.length ? places.map((p) => h('li', {}, h('button', { type: 'button', onclick: async () => {
          try {
            await api('PUT', '/api/connections/weather', p);
            toast(`Wetter für ${p.name} eingestellt.`);
            nextStep(step, single);
          } catch (ex) {
            err.textContent = ex.message;
          }
        } }, p.name, h('small', {}, p.region)))) : [h('li', { class: 'hint' }, 'Nichts gefunden. Versuch es mit einem anderen Namen.')]));
      } catch (ex) {
        err.textContent = ex.message;
      }
    };
    q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, 350);
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        search();
      }
    });
    return stepPage(step, single,
      h('div', { class: 'app-mark', html: ICONS.weather }),
      h('h1', {}, 'Für welchen Ort soll ich das Wetter zeigen?'),
      h('p', { class: 'lead' }, 'Das Wetter steht oben im Dashboard und kommt in deinen Tagesplan. Dafür brauche ich kein Konto.'),
      h('div', { class: 'stack' }, h('div', { class: 'field' }, h('label', { for: 'place' }, 'Ort'), q), results, err, actions(laterButton(step, 'weather', single))));
  },

  async claude(step, single) {
    const c = await connections();
    const key = h('input', { type: 'password', id: 'api-key', autocomplete: 'off', placeholder: c.claude.hasKey ? 'Schon gespeichert – leer lassen zum Behalten' : 'sk-ant-…', required: !c.claude.hasKey });
    const model = h('select', { id: 'model' }, c.claude.models.map((m) => h('option', { value: m.id, selected: m.id === c.claude.model }, `${m.label} – ${m.hint}`)));
    const form = h('form', {},
      h('div', { class: 'field' }, h('label', { for: 'api-key' }, 'Claude-API-Schlüssel'), key, h('span', { class: 'hint' }, 'Bekommst du in der ', h('a', { href: 'https://platform.claude.com/', target: '_blank', rel: 'noopener' }, 'Claude Console'), ' unter „API Keys“. Die API wird nach Verbrauch abgerechnet, getrennt von deinem Claude-Abo – ein Tagesplan kostet grob ein paar Cent.')),
      h('div', { class: 'field' }, h('label', { for: 'model' }, 'Modell'), model),
      h('p', { class: 'error-line', role: 'alert' }),
      actions(h('button', { class: 'btn', type: 'submit' }, 'Claude verbinden'), laterButton(step, 'claude', single)));
    form.addEventListener('submit', submitting(form, async () => {
      await api('PUT', '/api/connections/claude', { apiKey: key.value, model: model.value });
      toast('Claude ist verbunden.');
      nextStep(step, single);
    }));
    return stepPage(step, single,
      h('div', { class: 'app-mark', html: ICONS.agent }),
      h('h1', {}, 'Soll ich mitdenken?'),
      h('p', { class: 'lead' }, 'Mit Claude kannst du im Dashboard mit mir schreiben, und ich erstelle dir jeden Morgen ab 6 Uhr einen Tagesplan: To-dos aus Terminen und Mails, dazu ein kurzes Briefing. Ohne Schlüssel funktionieren To-dos, Kalender, Mail und Wetter trotzdem.'),
      form);
  },

  async 'claude-app'(step, single) {
    const info = await api('GET', '/api/connector');
    const json = JSON.stringify(info.desktopConfig, null, 2);
    return stepPage(step, single,
      h('div', { class: 'app-mark', html: ICONS.plug }),
      h('h1', {}, 'Willst du mich auch in der Claude-App benutzen?'),
      h('p', { class: 'lead' }, 'Dann kannst du direkt in Claude schreiben „Was steht heute an?“ oder „Setz mir ein To-do“ – Claude arbeitet mit deinem Dashboard.'),
      h('div', { class: 'stack' },
        h('h2', {}, 'Claude-App auf dem Mac'),
        h('ol', { class: 'steps-help' },
          h('li', {}, 'Öffne in der Claude-App für den Mac die Einstellungen, dann „Entwickler“ und „Konfiguration bearbeiten“.'),
          h('li', {}, 'Füge diesen Eintrag ein. Wenn dort schon „mcpServers“ steht, nur den Teil „assistent“ ergänzen.'),
          h('li', {}, 'Beende Claude ganz und starte es neu. Der Assistent muss dabei laufen.')),
        h('div', { class: 'code' }, json),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => copy(json) }, 'Eintrag kopieren')),
        h('h2', {}, 'claude.ai und iPhone'),
        h('p', { class: 'hint' }, 'Dafür muss der Assistent aus dem Internet erreichbar sein, also auf einem Server laufen. Sobald du einen hast, trägst du in Claude einen eigenen Connector mit dieser Adresse ein:'),
        h('div', { class: 'code' }, info.publicHint || `https://<deine-server-adresse>/mcp/${info.token}`),
        h('p', { class: 'hint' }, 'Die lange Zeichenfolge am Ende ist dein Zugangsschlüssel – gib ihn nicht weiter. Unter „Verbindungen“ kannst du ihn jederzeit neu erzeugen.'),
        actions(h('button', { class: 'btn', type: 'button', onclick: () => nextStep(step, single) }, single ? 'Fertig' : 'Weiter'))));
  },

  async wuensche(step, single) {
    const c = await connections();
    const boxes = c.wishApps.map((w) => h('label', {}, h('input', { type: 'checkbox', value: w.id, checked: c.wishes.includes(w.id) }), h('span', {}, w.name)));
    return stepPage(step, single,
      h('div', { class: 'app-mark', html: ICONS.plus }),
      h('h1', {}, 'Worauf soll ich später noch zugreifen?'),
      h('p', { class: 'lead' }, 'Diese Apps kann ich noch nicht. Kreuz an, was dir wichtig ist – dann bauen wir es als Nächstes ein. WhatsApp zum Beispiel braucht einen eigenen Weg, weil es keine offizielle Schnittstelle für private Chats gibt.'),
      h('div', { class: 'stack' }, h('div', { class: 'wish-grid' }, boxes),
        actions(h('button', { class: 'btn', type: 'button', onclick: async () => {
          const wishes = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
          try {
            await api('PUT', '/api/wishes', { wishes });
            nextStep(step, single);
          } catch (err) {
            toast(err.message, 'error');
          }
        } }, 'Weiter'))));
  },

  async fertig(step) {
    const [c, s] = await Promise.all([connections(), api('GET', '/api/settings')]);
    const row = (ic, name, on, detail) => h('li', {}, h('span', { html: ICONS[ic] }), h('div', {}, h('div', {}, name), h('div', { class: `state${on ? ' on' : ''}` }, detail)));
    return stepPage(step, false,
      h('h1', {}, 'Fertig eingerichtet.'),
      h('p', { class: 'lead' }, `Dein Tagesplan kommt jeden Tag ab ${s.planTime} Uhr – oder sobald dein Mac an ist und der Assistent läuft.`),
      h('div', { class: 'stack' },
        h('ul', { class: 'summary' },
          row('calendar', 'Kalender', c.status.calendar.connected, c.status.calendar.connected ? `Verbunden mit ${c.status.calendar.account}` : 'Noch nicht verbunden'),
          row('mail', 'Mail', c.status.mail.connected, c.status.mail.connected ? `Verbunden mit ${c.status.mail.address}` : 'Noch nicht verbunden'),
          row('weather', 'Wetter', c.status.weather.connected, c.status.weather.connected ? c.status.weather.place : 'Noch nicht eingestellt'),
          row('agent', 'Claude', c.status.claude.connected, c.status.claude.connected ? 'Chat und Tagesplan aktiv' : 'Ohne Chat und automatischen Tagesplan')),
        actions(h('button', { class: 'btn', type: 'button', onclick: async () => {
          await api('POST', '/api/setup/finish');
          go('/');
        } }, 'Zum Dashboard'))));
  },
};

async function renderSetup(step) {
  if (!STEP_RENDERERS[step]) return go('/einrichtung/willkommen');
  try {
    const page = await STEP_RENDERERS[step](step, false);
    root.replaceChildren(...shell(null, page));
    page.querySelector('input:not([type="checkbox"]), button.btn')?.focus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renderSingleStep(step) {
  if (!STEP_RENDERERS[step] || ['willkommen', 'fertig'].includes(step)) return go('/verbindungen');
  try {
    const page = await STEP_RENDERERS[step](step, true);
    root.replaceChildren(...shell('/verbindungen', page));
    page.querySelector('input:not([type="checkbox"])')?.focus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Verbindungen ----------------

async function renderConnections() {
  let c;
  let connector;
  try {
    [c, connector] = await Promise.all([connections(), api('GET', '/api/connector')]);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const s = c.status;
  const disconnect = (url, label) => h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
    if (!confirm(`${label} wirklich trennen?`)) return;
    try {
      await api('DELETE', url);
      toast('Getrennt.');
      renderConnections();
    } catch (err) {
      toast(err.message, 'error');
    }
  } }, 'Trennen');
  const disconnectIcloud = (which, st) => h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
    const label = which === 'calendar' ? 'Den Kalender' : 'Die Mail';
    if (!confirm(`${label} wirklich trennen?`)) return;
    const other = which === 'calendar' ? st.mail.connected : st.calendar.connected;
    try {
      if (other) await api('PUT', '/api/connections/icloud', { [which]: false });
      else await api('DELETE', '/api/connections/icloud');
      toast('Getrennt.');
      renderConnections();
    } catch (err) {
      toast(err.message, 'error');
    }
  } }, 'Trennen');
  const row = (ic, name, on, detail, ...buttons) => h('div', { class: 'conn' },
    h('span', { class: 'conn-icon', html: ICONS[ic] }),
    h('div', {}, h('div', { class: 'name' }, name), h('div', { class: `state${on ? ' on' : ''}` }, detail)),
    h('div', { class: 'conn-actions' }, buttons));
  const page = h('main', { class: 'page page-narrow' },
    h('h1', {}, 'Verbindungen'),
    h('section', { class: 'conn-section' },
      h('p', {}, 'Worauf der Assistent zugreifen darf. Zugangsdaten bleiben auf deinem Rechner.'),
      row('calendar', 'iCloud-Kalender', s.calendar.connected, s.calendar.connected ? `Verbunden mit ${s.calendar.account}` : 'Nicht verbunden',
        h('a', { class: 'btn btn-quiet', href: '#/verbindungen/kalender' }, s.calendar.connected ? 'Ändern' : 'Verbinden'),
        s.calendar.connected && disconnectIcloud('calendar', s)),
      row('mail', 'iCloud-Mail', s.mail.connected, s.mail.connected ? `Verbunden mit ${s.mail.address}` : 'Nicht verbunden',
        h('a', { class: 'btn btn-quiet', href: '#/verbindungen/mail' }, s.mail.connected ? 'Ändern' : 'Verbinden'),
        s.mail.connected && disconnectIcloud('mail', s)),
      row('weather', 'Wetter', s.weather.connected, s.weather.connected ? s.weather.place : 'Kein Ort eingestellt',
        h('a', { class: 'btn btn-quiet', href: '#/verbindungen/wetter' }, s.weather.connected ? 'Ort ändern' : 'Einstellen'),
        s.weather.connected && disconnect('/api/connections/weather', 'Das Wetter')),
      row('agent', 'Claude (Chat & Tagesplan)', s.claude.connected, s.claude.connected ? `Aktiv mit ${c.claude.models.find((m) => m.id === c.claude.model)?.label || c.claude.model}` : 'Kein API-Schlüssel',
        h('a', { class: 'btn btn-quiet', href: '#/verbindungen/claude' }, s.claude.connected ? 'Ändern' : 'Verbinden'),
        s.claude.connected && disconnect('/api/connections/claude', 'Claude')),
      row('plug', 'In der Claude-App benutzen', false, 'Damit Claude auf dem Mac direkt mit deinem Dashboard arbeiten kann',
        h('a', { class: 'btn btn-quiet', href: '#/verbindungen/claude-app' }, 'Anleitung'))),
    h('section', { class: 'conn-section' },
      h('h2', {}, 'Geplant'),
      h('p', {}, c.wishes.length ? 'Das hast du dir gewünscht. Diese Verbindungen gibt es noch nicht – sie kommen als Nächstes dazu.' : 'Noch keine Wünsche. Unter „Wünsche ändern“ kannst du ankreuzen, worauf der Assistent später zugreifen soll.'),
      c.wishes.length ? h('ul', { class: 'summary' }, c.wishes.map((id) => h('li', {}, h('span', { html: ICONS.plus }), c.wishApps.find((w) => w.id === id)?.name || id))) : '',
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-quiet', href: '#/verbindungen/wuensche' }, 'Wünsche ändern'))),
    h('section', { class: 'conn-section' },
      h('h2', {}, 'Zugangsschlüssel für Claude'),
      h('p', {}, 'Damit meldet sich Claude beim Assistenten an. Wenn du glaubst, jemand anderes kennt ihn, erzeuge einen neuen – danach musst du ihn in Claude neu eintragen.'),
      h('div', { class: 'code' }, connector.token),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
        if (!confirm('Neuen Zugangsschlüssel erzeugen? Der alte funktioniert dann nicht mehr.')) return;
        await api('POST', '/api/connector/token');
        toast('Neuer Schlüssel erzeugt.');
        renderConnections();
      } }, 'Neuen Schlüssel erzeugen'))));
  root.replaceChildren(...shell('/verbindungen', page));
}

// ---------------- Einstellungen ----------------

async function renderSettings() {
  let s;
  try {
    s = await api('GET', '/api/settings');
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const save = async (patch, msg = 'Gespeichert.') => {
    try {
      const r = await api('PUT', '/api/settings', patch);
      toast(msg);
      return r;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
  };
  const planTime = h('input', { type: 'time', id: 'plan-time', value: s.planTime });
  const planOn = h('input', { type: 'checkbox', id: 'plan-on', checked: s.planEnabled });
  const tz = h('input', { type: 'text', id: 'tz', value: s.timezone, autocomplete: 'off' });
  const lan = h('input', { type: 'checkbox', id: 'lan', checked: s.lanAccess, disabled: s.hostOverride });
  const lanInfo = h('div', { class: 'hint' });
  const showLan = (urls) => {
    lanInfo.replaceChildren(...(urls.length ? ['Auf dem iPhone in Safari öffnen (gleiches WLAN): ', ...urls.map((u, i) => [i ? ' oder ' : '', h('a', { href: u }, u)])] : ['Nur auf diesem Mac erreichbar.']));
  };
  showLan(s.lanUrls);
  lan.addEventListener('change', async () => {
    const r = await save({ lanAccess: lan.checked }, lan.checked ? 'Im WLAN freigegeben.' : 'Nur noch auf diesem Mac.');
    if (r) setTimeout(() => api('GET', '/api/settings').then((x) => showLan(x.lanUrls)).catch(() => {}), 800);
  });
  const calSection = h('section', {}, h('h2', {}, 'Kalender im Dashboard'), h('p', { class: 'hint' }, 'Lade …'));
  const curPw = h('input', { type: 'password', id: 'pw-cur', autocomplete: 'current-password' });
  const newPw = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: '8' });
  const page = h('main', { class: 'page page-narrow' },
    h('h1', {}, 'Einstellungen'),
    h('div', { class: 'settings-list' },
      h('section', {},
        h('h2', {}, 'Tagesplan'),
        h('label', { class: 'check' }, planOn, h('span', {}, 'Jeden Morgen automatisch To-dos und Briefing erstellen')),
        h('div', { class: 'inline' }, h('label', { for: 'plan-time' }, 'Frühestens um'), planTime, h('span', { class: 'hint' }, 'Ist dein Mac später erst an, kommt der Plan, sobald er läuft.')),
        h('div', { class: 'inline' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => save({ planTime: planTime.value, planEnabled: planOn.checked }) }, 'Speichern'))),
      calSection,
      h('section', {},
        h('h2', {}, 'Vom iPhone aus öffnen'),
        h('label', { class: 'check' }, lan, h('span', {}, 'Im WLAN freigeben, damit du das Dashboard auch auf iPhone und iPad öffnen kannst')),
        s.hostOverride ? h('p', { class: 'hint' }, 'Wird vom Server vorgegeben.') : '',
        lanInfo,
        h('p', { class: 'hint' }, 'Tipp: In Safari „Zum Home-Bildschirm“ wählen, dann sieht es aus wie eine App.')),
      h('section', {},
        h('h2', {}, 'Zeitzone'),
        h('p', { class: 'hint' }, 'Nach dieser Zeitzone richten sich Tagesplan, Termine und To-dos. Zum Beispiel Europe/Berlin.'),
        h('div', { class: 'inline' }, tz, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => save({ timezone: tz.value.trim() }) }, 'Speichern'))),
      h('section', {},
        h('h2', {}, 'Passwort ändern'),
        h('div', { class: 'row-2' }, h('div', { class: 'field' }, h('label', { for: 'pw-cur' }, 'Aktuelles Passwort'), curPw), h('div', { class: 'field' }, h('label', { for: 'pw-new' }, 'Neues Passwort'), newPw)),
        h('div', { class: 'inline' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
          try {
            await api('POST', '/api/password', { current: curPw.value, next: newPw.value });
            curPw.value = '';
            newPw.value = '';
            toast('Passwort geändert. Andere Geräte sind jetzt abgemeldet.');
          } catch (err) {
            toast(err.message, 'error');
          }
        } }, 'Passwort ändern'))),
      h('section', {},
        h('h2', {}, 'Abmelden'),
        h('div', { class: 'inline' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
          await api('POST', '/api/logout').catch(() => {});
          route();
        } }, 'Abmelden'), h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => go('/einrichtung/willkommen') }, 'Einrichtung nochmal durchgehen')))));
  root.replaceChildren(...shell('/einstellungen', page));
  loadCalendarSettings(calSection);
}

async function loadCalendarSettings(section) {
  const head = h('h2', {}, 'Kalender im Dashboard');
  let data;
  try {
    data = await api('GET', '/api/calendars');
  } catch (err) {
    section.replaceChildren(head, h('p', { class: 'hint' }, err.status === 409 ? 'Der Kalender ist noch nicht verbunden.' : err.message));
    return;
  }
  const checks = data.calendars.map((c) => {
    const box = h('input', { type: 'checkbox', value: c.id, checked: c.selected });
    const label = h('label', { class: 'check' }, box, h('span', {}, c.name, c.readOnly ? ' (nur lesen)' : ''));
    if (c.color) label.style.setProperty('accent-color', c.color);
    return { box, label, cal: c };
  });
  const writable = data.calendars.filter((c) => !c.readOnly);
  const def = h('select', { id: 'def-cal' }, h('option', { value: '' }, 'Automatisch'), writable.map((c) => h('option', { value: c.id, selected: c.id === data.defaultCalendar }, c.name)));
  section.replaceChildren(head,
    h('p', { class: 'hint' }, 'Welche Kalender im Dashboard und beim Agenten auftauchen.'),
    ...checks.map((x) => x.label),
    h('div', { class: 'field' }, h('label', { for: 'def-cal' }, 'Neue Termine landen in'), def),
    h('div', { class: 'inline' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
      try {
        await api('PUT', '/api/calendars', { selected: checks.filter((x) => x.box.checked).map((x) => x.cal.id), defaultCalendar: def.value || null });
        toast('Gespeichert.');
      } catch (err) {
        toast(err.message, 'error');
      }
    } }, 'Speichern')));
}

route();
