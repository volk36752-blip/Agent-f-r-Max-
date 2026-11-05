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
  bell: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  dock: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M6.5 16.5h11" stroke-width="2.4"/>'),
  sunrise: svg('<path d="M5 18a7 7 0 0 1 14 0"/><path d="M2.5 18h19M12 4.5v4M9.5 7l2.5-2.5L14.5 7M4.6 11.6l1.4 1M19.4 11.6l-1.4 1"/>'),
  shield: svg('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6" stroke-width="2.2"/>'),
  folder: svg('<path d="M3 7.5a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  chat: svg('<path d="M4 19.5l1.4-4.1A7.6 7.6 0 1 1 8.6 18.6z"/><path d="M9 11.5h.01M12.5 11.5h.01M16 11.5h.01" stroke-width="2.6"/>'),
  person: svg('<circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>'),
  bolt: svg('<path d="M13 2.8L5.5 13.2h6L10.8 21.2l7.7-10.4h-6z"/>'),
  note: svg('<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M9 10h6M9 13.5h6M9 17h4"/>'),
  music: svg('<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z"/>'),
  news: svg('<rect x="3.5" y="5" width="13" height="14.5" rx="2"/><path d="M16.5 9h2.5a1.5 1.5 0 0 1 1.5 1.5V17a2.5 2.5 0 0 1-5 0"/><path d="M7 9h6M7 12.5h6M7 16h4"/>'),
  speaker: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  speakerOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7" stroke-width="2.2"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>'),
  next: svg('<path d="M5.5 6v12l8.5-6zM18 6v12" stroke-width="2"/>'),
  prev: svg('<path d="M18.5 6v12L10 12zM6 6v12" stroke-width="2"/>'),
  trash: svg('<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  up: svg('<path d="M6 14l6-6 6 6" stroke-width="2.2"/>'),
  down: svg('<path d="M6 10l6 6 6-6" stroke-width="2.2"/>'),
  brain: svg('<path d="M9 4.5a3 3 0 0 0-3 3v.3A3.2 3.2 0 0 0 4 13a3.3 3.3 0 0 0 2.3 3.2A3 3 0 0 0 9.5 19.5c1.1 0 2-.5 2.5-1.3V5.8A3 3 0 0 0 9 4.5z"/><path d="M15 4.5a3 3 0 0 1 3 3v.3A3.2 3.2 0 0 1 20 13a3.3 3.3 0 0 1-2.3 3.2 3 3 0 0 1-3.2 3.3c-1.1 0-2-.5-2.5-1.3"/>'),
  home: svg('<path d="M4 10.5L12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
  puzzle: svg('<path d="M9.5 4.5a2 2 0 0 1 4 0V6H17a1 1 0 0 1 1 1v3.5h-1.5a2 2 0 0 0 0 4H18V18a1 1 0 0 1-1 1h-3.5v-1.5a2 2 0 0 0-4 0V19H6a1 1 0 0 1-1-1v-3.5h1.5a2 2 0 0 0 0-4H5V7a1 1 0 0 1 1-1h3.5z"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  refresh: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4v5h-5"/>'),
  laptop: svg('<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 18.5h18"/>'),
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
  const nav = [['/', 'Start'], ['/einstellungen', 'Einstellungen']];
  return [
    h('header', { class: 'topbar' },
      h('a', { class: 'wordmark', href: '#/' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Assistent'),
      h('span', { class: 'spacer' }),
      h('nav', { class: 'topnav', 'aria-label': 'Hauptmenü' }, nav.map(([p, label]) => h('a', { href: `#${p}`, 'aria-current': active && (active === p || (p !== '/' && active.startsWith(p))) ? 'page' : null }, label)))),
    ...content,
  ];
}

// Einfacher Dialog (nativ <dialog>)
export function openDialog({ title, sub, body = [], foot = [], onClose } = {}) {
  const dlg = h('dialog', {});
  const close = () => dlg.close();
  dlg.append(h('div', { class: 'dlg' },
    h('div', { class: 'dlg-head' },
      h('div', {}, h('h2', {}, title || ''), sub ? h('p', { class: 'hint' }, sub) : ''),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', html: ICONS.cross, onclick: close })),
    h('div', { class: 'dlg-body' }, body),
    foot.length ? h('div', { class: 'dlg-foot' }, foot) : ''));
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

export function switchInput(checked, onchange, { disabled = false, label = '' } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, disabled, 'aria-label': label || null });
  input.addEventListener('change', () => onchange(input.checked, input));
  return h('label', { class: 'switch' }, input, h('span', { 'aria-hidden': 'true' }));
}

export function initials(name) {
  const parts = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
