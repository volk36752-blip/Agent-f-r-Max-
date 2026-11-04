// Gemeinsame Helfer für die Oberfläche: Elemente bauen, Symbole, API, Datumsangaben.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
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

const svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  check: svg('<path d="M5 12.5l4.2 4.2L19 7" stroke-width="2.6"/>'),
  cross: svg('<path d="M7 7l10 10M17 7L7 17" stroke-width="2.6"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  plus: svg('<path d="M12 5v14M5 12h14" stroke-width="2.2"/>'),
  plusCircle: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke-width="2"/>'),
  send: svg('<path d="M12 19V5M6 11l6-6 6 6" stroke-width="2.4"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none"/>'),
  today: svg('<path d="M4 17a8 8 0 0 1 16 0"/><path d="M2 17h20"/><path d="M12 5v2M5.6 7.6l1.4 1.4M18.4 7.6L17 9"/>'),
  agent: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'),
  inbox: svg('<path d="M3 13l2.5-7.5h13L21 13v5.5H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  mail: svg('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>'),
  weather: svg('<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.2M2.5 9h1.2M4.4 4.4l.9.9M13.6 4.4l-.9.9"/><path d="M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.4 1.4A2.8 2.8 0 0 0 8 20z"/>'),
  plug: svg('<path d="M9 3v4M15 3v4"/><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 16v5"/>'),
  klar: svg('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  heiter: svg('<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.2M2.5 9h1.2M4.4 4.4l.9.9M13.6 4.4l-.9.9"/><path d="M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.4 1.4A2.8 2.8 0 0 0 8 20z"/>'),
  wolkig: svg('<path d="M7 19h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 19z"/>'),
  bedeckt: svg('<path d="M7 19h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 19z"/><path d="M9 7.5a5 5 0 0 1 8.6 1"/>'),
  regen: svg('<path d="M7 15.5h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 15.5z"/><path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>'),
  schnee: svg('<path d="M7 15.5h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 15.5z"/><path d="M8 19.5h.01M12 21h.01M16 19.5h.01" stroke-width="2.6"/>'),
  gewitter: svg('<path d="M7 15.5h10.5a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.8A3.2 3.2 0 0 0 7 15.5z"/><path d="M12.5 15.5L10.5 19h3l-2 3"/>'),
  nebel: svg('<path d="M4 9h16M3 13h18M5 17h14"/>'),
};

export function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = ICONS[name] || ICONS.wolkig;
  return span.firstElementChild;
}

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show${kind === 'error' ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, kind === 'error' ? 6000 : 3000);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function go(path) {
  if ((location.hash || '#/').slice(1) === path) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = path;
}

export async function api(method, url, body) {
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
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    throw new ApiError(data.error || 'Bitte anmelden.', 401);
  }
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, res.status);
  return data;
}

// Kleiner Speicher im Browser (pro Gerät), z. B. für die Stimme
export const local = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`assistent.${key}`);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`assistent.${key}`, String(value));
    } catch {
      /* privater Modus – egal */
    }
  },
};

// ---------- Datum & Zeit ----------

const WEEKDAYS_SHORT = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

export function dateFromIso(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function longDate(d) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateFromIso(d));
}

export function shortDate(d) {
  const dt = dateFromIso(d);
  return `${WEEKDAYS_SHORT[dt.getUTCDay()]} ${dt.getUTCDate()}. ${new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' }).format(dt).replace('.', '')}`;
}

export function monthShort(d) {
  return new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' }).format(dateFromIso(d)).replace('.', '').toUpperCase();
}

export function addDays(d, n) {
  const dt = dateFromIso(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export const minutesOf = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
export const hm = (str) => Number(str.slice(0, 2)) * 60 + Number(str.slice(3, 5));

export function relativeDay(d, today) {
  if (d === today) return 'heute';
  if (d === addDays(today, 1)) return 'morgen';
  if (d === addDays(today, -1)) return 'gestern';
  return shortDate(d);
}

export function copy(text) {
  const app = window.webkit?.messageHandlers?.assistentNative;
  if (app) {
    app.postMessage({ cmd: 'copy', id: 'kopie', text: String(text) });
    toast('Kopiert.');
    return;
  }
  navigator.clipboard?.writeText(text).then(() => toast('Kopiert.'), () => toast('Kopieren hat nicht geklappt – bitte von Hand markieren.', 'error'));
}

// ---------- Text vom Agenten (kleines, sicheres Markdown) ----------

function inline(text) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('strong', {}, m[1]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((x) => (typeof x === 'string' ? x.replace(/\*(\S[^*]*)\*/g, '$1').replace(/`([^`]+)`/g, '$1') : x));
}

export function renderSay(el, text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  const nodes = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.replace(/^#{1,6}\s+/, '')).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) {
      nodes.push(h('ul', {}, lines.map((l) => h('li', {}, inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ''))))));
    } else {
      const p = h('p');
      lines.forEach((l, i) => {
        if (i) p.append(h('br'));
        p.append(...inline(l));
      });
      nodes.push(p);
    }
  }
  el.replaceChildren(...nodes);
}

export function shell(active, ...content) {
  const nav = [['/', 'Heute'], ['/verbindungen', 'Verbindungen'], ['/einstellungen', 'Einstellungen']];
  return [
    h('header', { class: 'topbar' },
      h('a', { class: 'wordmark', href: '#/' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Assistent'),
      h('nav', { class: 'topnav', 'aria-label': 'Hauptmenü' }, nav.map(([p, label]) => h('a', { href: `#${p}`, 'aria-current': active === p ? 'page' : null }, label)))),
    ...content,
  ];
}
