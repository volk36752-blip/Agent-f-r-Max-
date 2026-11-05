// Startseite: Widgets, unten die Leiste mit Mikrofon, Eingabe und Lautsprecher.
// Fragst du etwas, schiebt sich das Gespräch hoch – mit Karten für alles, was der Agent tut.

import { h, ICONS, icon, api, toast, renderSay, shortDate, addDays, relativeDay, openDialog, initials, shell, ApiError, minutesOf } from './ui.js';
import { speech, ears, voiceSettings, isMacApp, nativeCall, rankedVoices } from './voice.js';
import { runningCard, resultCard, permissionCard, actionCard, MUTATING } from './widgets.js';

const st = { data: null, timers: [], state: 'idle', voiceTurn: false, chat: null, els: {}, widgets: new Map(), sheetOpen: false, pop: null };
const root = () => document.getElementById('app');

const APP_NAMES = { kalender: 'Kalender', whatsapp: 'WhatsApp', mail: 'Mail', erinnerungen: 'Erinnerungen', wetter: 'Wetter', todos: 'To-do-Liste' };
const SETTINGS_KIND = { kalender: 'calendar', erinnerungen: 'reminders', mail: 'automation', whatsapp: 'appdata', kontakte: 'contacts' };
const BRAIN_LABEL = { apple: 'Apple Intelligence', claude: 'Claude' };
const SUGGESTIONS = ['Was steht heute an?', 'Hab ich morgen Nachmittag Zeit?', 'Wer hat mir auf WhatsApp geschrieben?', 'Welche Mails brauchen eine Antwort?'];
const SOURCE_LABEL = { agent: 'vom Agent', tagesplan: 'Tagesplan', claude: 'über Claude', whatsapp: 'aus WhatsApp' };

export function stopDashboard() {
  st.timers.forEach((t) => clearInterval(t));
  st.timers = [];
  st.pop?.remove();
  st.pop = null;
  if (ears.active) ears.stop(true);
}

function greeting(time) {
  const hh = Number(time.slice(0, 2));
  if (hh < 5) return 'Gute Nacht';
  if (hh < 11) return 'Guten Morgen';
  if (hh < 17) return 'Hallo';
  if (hh < 22) return 'Guten Abend';
  return 'Gute Nacht';
}

function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

// ---------------------------------------------------------------- Seite

export async function renderDashboard() {
  stopDashboard();
  let data;
  try {
    data = await api('GET', '/api/dashboard');
  } catch (err) {
    root().replaceChildren(...shell('/', h('main', { class: 'page page-narrow' }, h('h1', {}, 'Das hat nicht geklappt'), h('p', { class: 'lead' }, err.message), h('button', { class: 'btn', type: 'button', onclick: renderDashboard }, 'Nochmal'))));
    return;
  }
  st.data = data;
  st.widgets = new Map();
  const hero = h('section', { class: 'hero' });
  const grid = h('div', { class: 'grid' });
  st.els = { hero, grid };
  const page = h('main', { class: 'home' }, hero, grid);
  const dock = buildDock();
  const sheet = buildSheet();
  root().replaceChildren(...shell('/', page), sheet, st.els.reopen, dock);
  renderHero();
  for (const w of data.widgets.filter((x) => x.on)) {
    const el = h('section', { class: `widget ${w.color || 'orange'}`, dataset: { widget: w.id } });
    st.widgets.set(w.id, { w, el });
    grid.append(el);
    loadWidget(w.id);
  }
  if (!data.widgets.some((x) => x.on)) grid.append(h('p', { class: 'hint' }, 'Alle Widgets sind ausgeschaltet. Unter Einstellungen → Startseite kannst du sie wieder einschalten.'));
  await loadChat();
  st.timers.push(setInterval(() => renderHero(true), 30000));
  st.timers.push(setInterval(refreshBase, 90000));
  st.timers.push(setInterval(() => ['termine', 'whatsapp', 'mail', 'erinnerungen'].forEach((id) => st.widgets.has(id) && loadWidget(id, { quiet: true })), 180000));
}

async function refreshBase() {
  try {
    const data = await api('GET', '/api/dashboard');
    st.data = { ...st.data, ...data };
    renderHero();
    if (st.widgets.has('todos')) renderWidget('todos');
  } catch {
    /* nächstes Mal */
  }
}

let reloadTimer;
function reloadSoon(ids) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await refreshBase();
    (ids || ['termine', 'erinnerungen']).forEach((id) => st.widgets.has(id) && loadWidget(id, { quiet: true }));
  }, 400);
}

function renderHero(clockOnly = false) {
  const d = st.data;
  const n = nowLocal();
  const dateText = `${new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} · ${n.time} Uhr`;
  if (clockOnly && st.els.date) {
    st.els.date.textContent = dateText;
    return;
  }
  const date = h('p', { class: 'date' }, dateText);
  st.els.date = date;
  const brain = d.brain?.active;
  const badge = h('a', { class: `brain-badge ${brain ? 'on' : 'warn'}`, href: '#/einstellungen/gehirn', title: 'Gehirn des Agenten' }, h('span', { class: 'led' }), brain ? BRAIN_LABEL[brain] : 'Ohne Gehirn');
  const macChip = !d.mac ? h('span', { class: 'chip off', title: 'Kalender, WhatsApp & Co. ohne Passwort gibt es nur in der Mac-App.' }, icon('laptop'), 'Browser') : '';
  const b = d.briefing;
  const plan = d.plan || {};
  const briefing = h('div', { class: 'briefing' },
    h('span', { class: 'tile orange', html: ICONS.sunrise }),
    h('div', {},
      b ? h('p', {}, b.text) : h('p', {}, plan.running ? 'Ich erstelle gerade deinen Tagesplan …' : `Dein Tagesplan kommt ab ${plan.planTime || '06:00'} Uhr – oder sobald dein Mac an ist.`),
      h('p', { class: 'meta' }, b ? `Tagesplan von ${new Date(b.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : '',
        b ? ' · ' : '', h('button', { class: 'link-btn', type: 'button', onclick: runPlan }, b ? 'Neu planen' : 'Jetzt planen'))));
  st.els.hero.replaceChildren(
    h('div', {}, h('h1', {}, greeting(n.time), h('span', { class: 'accent' }, '.')), date),
    h('div', { class: 'hero-side' }, badge, macChip),
    briefing,
    h('div', { class: 'suggest-row' }, SUGGESTIONS.map((s) => h('button', { type: 'button', onclick: () => { speech.unlock(); sendChat(s); } }, s))));
}

async function runPlan(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Plane …';
  try {
    await api('POST', '/api/plan/run');
    toast('Dein Tagesplan ist fertig.');
    await refreshBase();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- Widgets

function widgetHead(w, extra = []) {
  return h('div', { class: 'w-head' }, h('span', { class: `tile ${w.color || 'orange'}`, html: ICONS[w.icon] || ICONS.grid }), h('h2', {}, w.title), ...extra);
}

function skeleton() {
  return h('div', { class: 'skeleton' }, h('i'), h('i'), h('i'));
}

async function loadWidget(id, { quiet = false } = {}) {
  const entry = st.widgets.get(id);
  if (!entry) return;
  if (id === 'todos') return renderWidget(id);
  if (!quiet || !entry.result) entry.el.replaceChildren(widgetHead(entry.w), skeleton());
  try {
    entry.result = await api('GET', `/api/widget/${encodeURIComponent(id)}`);
  } catch (err) {
    entry.result = { state: 'error', error: err.message };
  }
  renderWidget(id);
}

function renderWidget(id) {
  const entry = st.widgets.get(id);
  if (!entry) return;
  const { w, el } = entry;
  if (id === 'todos') {
    el.replaceChildren(...todoWidget(w));
    return;
  }
  const r = entry.result || { state: 'error' };
  if (r.state !== 'ok') {
    el.replaceChildren(widgetHead(w), h('div', { class: 'w-body' }, stateView(r, w, id)));
    return;
  }
  const render = RENDERERS[id] || (id.startsWith('plugin:') ? PLUGIN_RENDERERS[id.slice(7)] : null);
  try {
    el.replaceChildren(...(render ? render(w, r.data) : [widgetHead(w), h('div', { class: 'w-body' }, h('p', { class: 'w-empty' }, 'Bereit.'))]));
  } catch (err) {
    el.replaceChildren(widgetHead(w), h('div', { class: 'w-body' }, h('p', { class: 'w-empty' }, err.message)));
  }
}

function stateView(r, w, id) {
  const app = w.app || (id.startsWith('plugin:') ? id.slice(7) : id);
  const name = APP_NAMES[app] || w.title;
  const box = (...c) => h('div', { class: 'w-state' }, ...c);
  switch (r.state) {
    case 'ask':
      return box(h('p', {}, `Darf ich auf ${app === 'mail' ? 'deine Mail-App' : app === 'whatsapp' ? 'WhatsApp' : `deine ${name}`} zugreifen? macOS fragt dich dafür einmal – ohne Passwort.`),
        h('button', { class: 'btn btn-small', type: 'button', onclick: (e) => allowApp(app, e.currentTarget, id) }, icon('check'), 'Erlauben'));
    case 'denied':
      return box(h('p', {}, app === 'whatsapp'
        ? 'macOS lässt mich die WhatsApp-Daten noch nicht lesen. Schalte in den Systemeinstellungen unter „Festplattenvollzugriff“ den Assistenten ein.'
        : `Der Zugriff auf ${name} ist in macOS nicht erlaubt.`),
        isMacApp ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => nativeCall('openSettings', { kind: SETTINGS_KIND[app] || 'privacy' }, 5000).catch(() => {}) }, 'Systemeinstellungen öffnen') : '');
    case 'offline':
      return box(h('p', {}, `${name} ohne Passwort geht nur in der Mac-App „Assistent“.`));
    case 'off':
      return box(h('p', {}, `${name} ist für den Assistenten ausgeschaltet.`), h('a', { class: 'btn btn-quiet btn-small', href: '#/einstellungen/apps' }, 'Einstellungen'));
    case 'notInstalled':
      return box(h('p', {}, `${name} ist auf diesem Mac nicht installiert.`), app === 'whatsapp' ? h('a', { class: 'btn btn-quiet btn-small', href: 'https://www.whatsapp.com/download', target: '_blank', rel: 'noopener' }, 'WhatsApp für Mac laden') : '');
    case 'setup':
      if (id === 'wetter') return box(h('p', {}, 'Für welchen Ort soll ich das Wetter zeigen?'), h('a', { class: 'btn btn-small', href: '#/einstellungen/apps' }, 'Ort wählen'));
      return box(h('p', {}, `${name} ist noch nicht verbunden.`), h('a', { class: 'btn btn-quiet btn-small', href: '#/einstellungen/apps' }, 'Einstellungen'));
    default:
      return box(h('p', { class: 'c-error' }, r.error || 'Hat nicht geklappt.'), h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => loadWidget(id) }, icon('refresh'), 'Nochmal'));
  }
}

async function allowApp(app, btn, widgetId) {
  btn.disabled = true;
  btn.textContent = 'Frage macOS …';
  try {
    const r = await api('POST', `/api/apps/${app}/allow`);
    if (r.status === 'granted') toast(`${APP_NAMES[app] || app} ist jetzt erlaubt.`);
    else if (r.status === 'denied') toast('Nicht erlaubt. Ändern kannst du das unter Einstellungen → Apps.', 'error');
  } catch (err) {
    toast(err.message, 'error');
  }
  loadWidget(widgetId);
}

const list = (...items) => h('ul', { class: 'list' }, ...items);

const RENDERERS = {
  termine(w, d) {
    const today = st.data.now.date;
    const n = nowLocal();
    const nowMin = minutesOf(`${n.date}T${n.time}`);
    const row = (e, isToday) => {
      const ongoing = isToday && !e.allDay && e.start <= `${today}T${n.time}` && e.end > `${today}T${n.time}`;
      const past = isToday && !e.allDay && e.end.slice(0, 10) === today && minutesOf(e.end) < nowMin;
      const li = h('li', { class: `clickable${past ? ' past' : ''}`, onclick: () => showEvent(e) },
        h('span', { class: `when${ongoing ? ' now' : ''}` }, ongoing ? 'jetzt' : e.allDay ? 'ganzt.' : e.start.slice(0, 10) < today ? `–${e.end.slice(11)}` : e.start.slice(11)),
        h('span', { class: 'main' }, h('span', { class: 'title' }, e.title), e.location ? h('span', { class: 'sub' }, e.location) : ''));
      return li;
    };
    const todayList = d.today || [];
    const tomorrowList = d.tomorrow || [];
    return [
      widgetHead(w, [h('span', { class: 'chip' }, todayList.length ? `${todayList.length} heute` : 'frei')]),
      h('div', { class: 'w-body' },
        todayList.length ? list(...todayList.map((e) => row(e, true))) : h('p', { class: 'w-empty' }, 'Heute keine Termine. 🎉'),
        tomorrowList.length ? [h('p', { class: 'hint' }, 'Morgen'), list(...tomorrowList.slice(0, 3).map((e) => row(e, false)))] : ''),
    ];
  },

  whatsapp(w, d) {
    const chats = d.chats || [];
    const unread = chats.reduce((s, c) => s + (c.unread || 0), 0);
    return [
      widgetHead(w, [unread ? h('span', { class: 'badge' }, unread) : '']),
      h('div', { class: 'w-body' }, chats.length ? list(...chats.map((c) => h('li', { class: 'clickable', onclick: () => showChat(c) },
        h('span', { class: 'avatar green' }, initials(c.name)),
        h('span', { class: 'main' }, h('span', { class: 'title' }, c.name), h('span', { class: 'sub' }, `${c.lastFromMe ? 'Du: ' : ''}${c.lastText || ''}`)),
        h('span', { class: 'when' }, c.unread ? h('span', { class: 'badge' }, c.unread) : relTime(c.last))))) : h('p', { class: 'w-empty' }, 'Keine Chats gefunden.')),
    ];
  },

  mail(w, d) {
    const msgs = d.messages || [];
    return [
      widgetHead(w, [h('span', { class: 'chip' }, d.total ? `${d.total} ungelesen` : 'alles gelesen')]),
      h('div', { class: 'w-body' }, msgs.length ? list(...msgs.map((m) => h('li', { class: 'clickable', onclick: () => showMail(m) },
        h('span', { class: 'avatar sky' }, initials(m.from)),
        h('span', { class: 'main' }, h('span', { class: 'title' }, m.from), h('span', { class: 'sub' }, m.subject)),
        h('span', { class: 'when' }, relTime(m.date))))) : h('p', { class: 'w-empty' }, 'Keine ungelesenen Mails.')),
    ];
  },

  wetter(w, d) {
    const n = nowLocal();
    const hours = (d.hours || []).filter((x) => x.time.slice(0, 13) >= `${n.date}T${n.time.slice(0, 2)}`).filter((x, i) => i % 2 === 0).slice(0, 6);
    return [
      widgetHead(w, [h('span', { class: 'chip' }, d.place || '')]),
      h('div', { class: 'w-body' },
        h('div', { class: 'weather-now' }, icon(d.current?.icon), h('span', { class: 'temp' }, `${Math.round(d.current?.temp)}°`),
          h('div', {}, h('p', { class: 'c-title' }, d.current?.text), h('p', { class: 'c-sub' }, `${Math.round(d.today?.min)}° bis ${Math.round(d.today?.max)}°${d.today?.rainChance ? ` · Regen ${d.today.rainChance} %` : ''}`))),
        hours.length ? h('div', { class: 'weather-hours' }, hours.map((x) => h('div', {}, h('span', {}, x.time.slice(11, 13)), icon(x.icon), h('b', {}, `${Math.round(x.temp)}°`)))) : ''),
    ];
  },

  erinnerungen(w, d) {
    const items = d.reminders || [];
    const today = st.data.now.date;
    return [
      widgetHead(w, [h('span', { class: 'chip' }, `${d.total || 0} offen`)]),
      h('div', { class: 'w-body' }, items.length ? list(...items.map((r) => h('li', {},
        h('span', { class: 'when' }, r.due ? (r.due < today ? h('span', { class: 'overdue' }, 'fällig') : relativeDay(r.due, today)) : '–'),
        h('span', { class: 'main' }, h('span', { class: 'title' }, r.title), h('span', { class: 'sub' }, [r.time ? `${r.time} Uhr` : '', r.list].filter(Boolean).join(' · ')))))) : h('p', { class: 'w-empty' }, 'Keine fälligen Erinnerungen.')),
    ];
  },
};

const PLUGIN_RENDERERS = {
  schlagzeilen(w, d) {
    return [widgetHead(w, [h('span', { class: 'chip' }, 'tagesschau')]), h('div', { class: 'w-body' }, list(...(d.items || []).map((n) => h('li', {}, h('span', { class: 'main' }, h('a', { href: n.link, target: '_blank', rel: 'noopener', class: 'title' }, n.title), n.dateMs ? h('span', { class: 'sub' }, new Date(n.dateMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })) : '')))))];
  },
  musik(w, d) {
    if (d.needsPermission) {
      return [widgetHead(w), h('div', { class: 'w-body' }, h('div', { class: 'w-state' }, h('p', {}, 'Darf ich die Musik-App steuern?'), h('button', { class: 'btn btn-small', type: 'button', onclick: () => musicControl('allow') }, 'Erlauben')))];
    }
    const playing = d.zustand === 'spielt';
    return [widgetHead(w), h('div', { class: 'w-body' }, h('div', { class: 'music' },
      h('div', { class: 'art', html: ICONS.music }),
      h('div', {}, h('p', { class: 'c-title' }, d.titel || 'Nichts läuft'), h('p', { class: 'c-sub' }, d.kuenstler || d.zustand || '')),
      h('div', { class: 'controls' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zurück', html: ICONS.prev, onclick: () => musicControl('previous') }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': playing ? 'Pause' : 'Abspielen', html: playing ? ICONS.pause : ICONS.play, onclick: () => musicControl('toggle') }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Weiter', html: ICONS.next, onclick: () => musicControl('next') }))))];
  },
};

async function musicControl(command) {
  try {
    await api('POST', '/api/plugins/musik/control', { command });
  } catch (err) {
    toast(err.message, 'error');
  }
  loadWidget('plugin:musik', { quiet: true });
}

function relTime(iso) {
  if (!iso) return '';
  const today = st.data.now.date;
  if (iso.slice(0, 10) === today) return iso.slice(11, 16);
  if (iso.slice(0, 10) === addDays(today, -1)) return 'gestern';
  return shortDate(iso.slice(0, 10)).replace(/\s\S+$/, '');
}

// ---------- To-dos ----------

function todoWidget(w) {
  const d = st.data;
  const today = d.now.date;
  const open = d.todos.filter((t) => !t.done);
  const sorted = [...d.todos].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99'));
  const input = h('input', { type: 'text', placeholder: 'Neues To-do …', 'aria-label': 'Neues To-do', maxlength: '200', autocomplete: 'off' });
  const form = h('form', { class: 'todo-add', onsubmit: async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const { todo } = await api('POST', '/api/todos', { title: text, due: today });
      d.todos.push(todo);
      renderWidget('todos');
      st.widgets.get('todos').el.querySelector('.todo-add input')?.focus();
    } catch (err) {
      toast(err.message, 'error');
      input.value = text;
    }
  } }, input, h('button', { class: 'btn btn-small', type: 'submit', 'aria-label': 'Hinzufügen' }, icon('plus')));
  const items = sorted.slice(0, 9).map((t) => {
    const meta = [];
    if (t.due && t.due < today && !t.done) meta.push(h('span', { class: 'overdue' }, `seit ${relativeDay(t.due, today)}`));
    else if (t.due && t.due > today) meta.push(relativeDay(t.due, today));
    if (t.time) meta.push(`${t.time} Uhr`);
    if (SOURCE_LABEL[t.source]) meta.push(h('span', { class: 'src' }, SOURCE_LABEL[t.source]));
    return h('li', { class: t.done ? 'done' : '' },
      h('button', { class: 'todo-check', type: 'button', 'aria-label': t.done ? 'Wieder öffnen' : 'Abhaken', 'aria-pressed': t.done ? 'true' : 'false', html: ICONS.check, onclick: () => toggleTodo(t) }),
      h('button', { class: 'title-btn', type: 'button', onclick: () => editTodo(t) },
        h('span', { class: 'title' }, t.priority === 'hoch' ? h('span', { class: 'prio' }, '!') : '', t.title),
        meta.length ? h('span', { class: 'sub' }, meta.flatMap((m, i) => (i ? [' · ', m] : [m]))) : ''));
  });
  return [
    widgetHead(w, [h('span', { class: 'chip' }, open.length ? `${open.length} offen` : 'alles erledigt')]),
    h('div', { class: 'w-body' }, items.length ? h('ul', { class: 'list todo-list' }, items) : h('p', { class: 'w-empty' }, 'Nichts zu tun. Schreib unten ein To-do rein oder sag es mir.'),
      sorted.length > 9 ? h('p', { class: 'hint' }, `und ${sorted.length - 9} weitere`) : '', form),
  ];
}

async function toggleTodo(t) {
  const done = !t.done;
  t.done = done;
  renderWidget('todos');
  try {
    const { todo } = await api('PATCH', `/api/todos/${t.id}`, { done });
    Object.assign(t, todo);
  } catch (err) {
    t.done = !done;
    renderWidget('todos');
    toast(err.message, 'error');
  }
}

function editTodo(t) {
  const title = h('input', { type: 'text', value: t.title, maxlength: '200', 'aria-label': 'Was' });
  const due = h('input', { type: 'date', value: t.due || '', 'aria-label': 'Fällig am' });
  const time = h('input', { type: 'time', value: t.time || '', 'aria-label': 'Uhrzeit' });
  const important = h('input', { type: 'checkbox', checked: t.priority === 'hoch' });
  const notes = h('textarea', { rows: '3', maxlength: '2000', 'aria-label': 'Notizen' });
  notes.value = t.notes || '';
  const { close } = openDialog({
    title: 'To-do bearbeiten',
    body: [h('div', { class: 'field' }, h('label', {}, 'Was'), title), h('div', { class: 'row-2' }, h('div', { class: 'field' }, h('label', {}, 'Fällig am'), due), h('div', { class: 'field' }, h('label', {}, 'Uhrzeit'), time)), h('label', { class: 'check' }, important, h('span', {}, 'Wichtig')), h('div', { class: 'field' }, h('label', {}, 'Notizen'), notes)],
    foot: [
      h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
        try {
          await api('DELETE', `/api/todos/${t.id}`);
          st.data.todos = st.data.todos.filter((x) => x.id !== t.id);
          close();
          renderWidget('todos');
        } catch (err) {
          toast(err.message, 'error');
        }
      } }, 'Löschen'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        try {
          const { todo } = await api('PATCH', `/api/todos/${t.id}`, { title: title.value, due: due.value || null, time: time.value || null, priority: important.checked ? 'hoch' : 'normal', notes: notes.value });
          Object.assign(t, todo);
          close();
          renderWidget('todos');
        } catch (err) {
          toast(err.message, 'error');
        }
      } }, 'Speichern'),
    ],
  });
  title.focus();
}

// ---------- Details ----------

function showEvent(e) {
  const day = e.start.slice(0, 10);
  openDialog({
    title: e.title,
    sub: e.allDay ? `${shortDate(day)}, ganztags` : `${shortDate(day)}, ${e.start.slice(11)}–${e.end.slice(11)} Uhr`,
    body: [e.location ? h('p', {}, '📍 ', e.location) : '', e.notes ? h('p', { class: 'mail-text' }, e.notes) : '', h('p', { class: 'hint' }, `Kalender: ${e.calendar || '–'}`)],
    foot: [h('button', { class: 'btn btn-quiet', type: 'button', onclick: (ev) => { ev.target.closest('dialog').close(); sendChat(`Verschieb den Termin „${e.title}“ am ${shortDate(day)}.`); } }, 'Verschieben …')],
  });
}

async function showChat(c) {
  const box = h('div', { class: 'c-bubbles' }, h('p', { class: 'hint' }, 'Lade …'));
  const { close } = openDialog({
    title: c.name,
    sub: c.group ? 'WhatsApp-Gruppe' : 'WhatsApp',
    body: [box],
    foot: [h('button', { class: 'btn btn-green', type: 'button', onclick: () => {
      close();
      sendChat(`Lies meinen WhatsApp-Chat mit ${c.name} und schlag mir drei kurze Antworten vor. (Chat-ID: ${c.id})`, `Schlag mir Antworten für ${c.name} vor`);
    } }, icon('chat'), 'Antwort vorschlagen')],
  });
  try {
    const r = await api('GET', `/api/whatsapp/${encodeURIComponent(c.id)}`);
    box.replaceChildren(...r.messages.slice(-25).map((m) => h('div', { class: m.fromMe ? 'me' : '' }, m.text, h('small', {}, `${m.fromMe ? 'Du' : m.from} · ${relTime(m.at)}`))));
    box.lastElementChild?.scrollIntoView({ block: 'end' });
  } catch (err) {
    box.replaceChildren(h('p', { class: 'c-error' }, err.message));
  }
}

async function showMail(m) {
  const text = h('div', { class: 'mail-text' }, 'Lade …');
  const { close } = openDialog({
    title: m.subject,
    sub: `Von ${m.from} · ${relTime(m.date)}`,
    body: [text],
    foot: [
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
        try {
          await api('POST', `/api/mail/${encodeURIComponent(m.id)}/mark`, { read: true });
          close();
          loadWidget('mail', { quiet: true });
        } catch (err) {
          toast(err.message, 'error');
        }
      } }, 'Gelesen'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        close();
        sendChat(`Lies die Mail von ${m.from} („${m.subject}“, Mail-ID: ${m.id}) und schlag mir drei kurze Antworten vor.`, `Antworte auf die Mail von ${m.from}`);
      } }, icon('mail'), 'Antwort vorschlagen'),
    ],
  });
  try {
    const r = await api('GET', `/api/mail/${encodeURIComponent(m.id)}`);
    text.textContent = r.mail.text || '(kein Text)';
  } catch (err) {
    text.textContent = err.message;
  }
}

// ---------------------------------------------------------------- Unten: Mikrofon, Eingabe, Lautsprecher

function buildDock() {
  const orb = h('button', { class: 'orb', type: 'button', 'aria-label': 'Sprechen', html: ICONS.mic, onclick: onOrb });
  const input = h('textarea', { rows: '1', placeholder: 'Frag mich was …', 'aria-label': 'Nachricht an den Assistenten', maxlength: '8000' });
  const send = h('button', { class: 'send', type: 'submit', 'aria-label': 'Senden', html: ICONS.send });
  const speaker = h('button', { class: 'speaker', type: 'button', 'aria-label': 'Antworten vorlesen', 'aria-haspopup': 'dialog' });
  const paintSpeaker = () => {
    const on = voiceSettings.mode === 'stimme';
    speaker.innerHTML = on ? ICONS.speaker : ICONS.speakerOff;
    speaker.setAttribute('aria-pressed', on ? 'true' : 'false');
    speaker.title = on ? 'Antwortet mit Text und Stimme' : 'Antwortet nur mit Text';
  };
  paintSpeaker();
  speaker.addEventListener('click', () => toggleSpeakerPop(speaker, paintSpeaker));
  const form = h('form', { class: 'dock', onsubmit: (e) => {
    e.preventDefault();
    speech.unlock();
    sendChat(input.value);
  } }, orb, input, send, speaker);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    send.classList.toggle('ready', Boolean(input.value.trim()));
  });
  st.els.input = input;
  st.els.orb = orb;
  st.els.send = send;
  return form;
}

function toggleSpeakerPop(anchor, paint) {
  if (st.pop) {
    st.pop.remove();
    st.pop = null;
    return;
  }
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Antwort als' });
  const mk = (mode, label) => h('button', { type: 'button', 'aria-pressed': voiceSettings.mode === mode ? 'true' : 'false', onclick: () => {
    voiceSettings.mode = mode;
    seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', (i === 0 ? 'text' : 'stimme') === mode ? 'true' : 'false'));
    if (mode === 'stimme') {
      speech.unlock();
      if (!speech.supported) toast('Vorlesen kann dieser Browser leider nicht.', 'error');
    } else speech.stop();
    paint();
  } }, label);
  seg.append(mk('text', 'Nur Text'), mk('stimme', 'Text + Stimme'));
  const voices = rankedVoices();
  const select = h('select', { 'aria-label': 'Stimme' }, h('option', { value: '' }, voices.length ? `Automatisch (${voices[0].name})` : 'Automatisch'), voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === voiceSettings.voiceURI }, v.name)));
  select.addEventListener('change', () => {
    voiceSettings.voiceURI = select.value;
    speech.test();
  });
  const rate = h('input', { type: 'range', min: '0.7', max: '1.2', step: '0.02', value: String(voiceSettings.rate), 'aria-label': 'Tempo' });
  const rateOut = h('output', {}, `${Math.round(voiceSettings.rate * 100)} %`);
  rate.addEventListener('input', () => {
    voiceSettings.rate = Number(rate.value);
    rateOut.textContent = `${Math.round(voiceSettings.rate * 100)} %`;
  });
  const keep = h('input', { type: 'checkbox', checked: voiceSettings.keepListening });
  keep.addEventListener('change', () => {
    voiceSettings.keepListening = keep.checked;
  });
  const pop = h('div', { class: 'speaker-pop', role: 'dialog', 'aria-label': 'Antworten' },
    h('h3', {}, 'Wie soll ich antworten?'), seg,
    h('div', { class: 'field' }, h('label', {}, 'Stimme'), select),
    h('div', { class: 'slider-row' }, h('label', {}, 'Tempo'), rate, rateOut),
    h('label', { class: 'check' }, keep, h('span', { class: 'hint' }, 'Wenn ich gesprochen habe: danach weiter zuhören')),
    h('div', { class: 'inline' }, h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => speech.test() }, 'Probe hören'), h('a', { class: 'link-btn', href: '#/einstellungen/stimme' }, 'Mehr …')));
  anchor.closest('.dock').append(pop);
  st.pop = pop;
  const outside = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
      pop.remove();
      st.pop = null;
      document.removeEventListener('pointerdown', outside);
    }
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    pop.remove();
    st.pop = null;
    document.removeEventListener('keydown', onKey);
    anchor.focus();
  };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}

const STATE_LABEL = { idle: '', listening: 'Hört zu …', thinking: 'Arbeitet …', speaking: 'Spricht …' };

function setState(state) {
  st.state = state;
  const orb = st.els.orb;
  if (orb) {
    orb.classList.toggle('is-listening', state === 'listening');
    orb.classList.toggle('is-thinking', state === 'thinking');
    orb.classList.toggle('is-speaking', state === 'speaking');
    orb.innerHTML = state === 'listening' || state === 'speaking' ? ICONS.stop : ICONS.mic;
    orb.setAttribute('aria-label', state === 'listening' ? 'Zuhören beenden' : state === 'speaking' ? 'Vorlesen stoppen' : 'Sprechen');
  }
  if (st.els.stateLabel) {
    st.els.stateLabel.textContent = STATE_LABEL[state] || '';
    st.els.stateLabel.classList.toggle('active', state !== 'idle');
  }
  if (st.els.send) st.els.send.disabled = state === 'thinking';
}

speech.onState = (s) => {
  if (s === 'speaking' && st.state !== 'thinking') setState('speaking');
  if (s === 'idle-speech' && st.state === 'speaking') setState('idle');
};

function onOrb() {
  speech.unlock();
  if (st.state === 'listening') return ears.stop(false);
  if (st.state === 'speaking') {
    st.voiceTurn = false;
    speech.stop();
    return setState('idle');
  }
  if (st.state === 'thinking') return toast('Einen Moment, ich bin gleich so weit.');
  listen();
}

function listen() {
  const input = st.els.input;
  if (!input) return;
  const started = ears.start({
    onText: (text) => {
      input.value = text;
    },
    onEnd: (text) => {
      if (st.state === 'listening') setState('idle');
      if (text) sendChat(text, null, { spoken: true });
      else st.voiceTurn = false;
    },
    onError: (msg, code) => {
      if (code !== 'no-speech') toast(msg, 'error');
      if (st.state === 'listening') setState('idle');
    },
  });
  if (started) {
    speech.stop();
    setState('listening');
  }
}

// ---------------------------------------------------------------- Gespräch

function buildSheet() {
  const convo = h('div', { class: 'convo', 'aria-live': 'polite' });
  const stateLabel = h('span', { class: 'state' });
  const brain = h('span', { class: 'chip' });
  const sheet = h('section', { class: 'sheet', hidden: true, 'aria-label': 'Gespräch' },
    h('div', { class: 'sheet-head' },
      h('h2', {}, 'Gespräch'), brain, stateLabel, h('span', { class: 'spacer' }),
      h('button', { class: 'link-btn', type: 'button', onclick: clearChat }, 'Neu'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Gespräch schließen', html: ICONS.down, onclick: () => openSheet(false) })),
    convo);
  const reopen = h('button', { class: 'reopen', type: 'button', hidden: true, onclick: () => openSheet(true) }, 'Gespräch anzeigen');
  st.els.sheet = sheet;
  st.els.convo = convo;
  st.els.stateLabel = stateLabel;
  st.els.brainChip = brain;
  st.els.reopen = reopen;
  return sheet;
}

function openSheet(open) {
  st.sheetOpen = open;
  st.els.sheet.hidden = !open;
  st.els.reopen.hidden = open || !(st.chat?.log?.length);
  if (open) scrollConvo();
}

async function clearChat() {
  try {
    speech.stop();
    await api('DELETE', '/api/chat');
    st.chat.log = [];
    renderConvo();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadChat() {
  try {
    const data = await api('GET', '/api/chat');
    st.chat = { log: data.log, actions: data.actions || {}, brain: data.brain };
  } catch {
    st.chat = { log: [], actions: {} };
  }
  paintBrainChip(st.chat.brain?.active);
  renderConvo();
  openSheet(false);
  setState('idle');
}

function paintBrainChip(active) {
  const chip = st.els.brainChip;
  if (!chip) return;
  chip.className = `chip ${active ? 'ok' : 'ask'}`;
  chip.textContent = active ? BRAIN_LABEL[active] : 'Ohne Gehirn';
}

function scrollConvo() {
  const c = st.els.convo;
  if (c) requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

function afterAction(a) {
  if (a.kind === 'whatsapp') loadWidget('whatsapp', { quiet: true });
  else if (a.kind === 'mail') loadWidget('mail', { quiet: true });
  else reloadSoon(['termine', 'erinnerungen']);
}

function renderTurn(entry) {
  const turn = h('div', { class: 'turn' });
  const parts = entry.parts?.length ? entry.parts : [{ type: 'text', text: entry.text }];
  for (const p of parts) {
    if (p.type === 'tool' || p.type === 'permission') {
      const card = resultCard(p, { actions: st.chat.actions, onDone: afterAction });
      if (card) turn.append(card);
    } else if (p.text?.trim()) {
      const say = h('div', { class: 'say' });
      renderSay(say, p.text.trim());
      turn.append(say);
    }
  }
  return turn;
}

function renderConvo() {
  const convo = st.els.convo;
  if (!convo) return;
  const items = [];
  for (const m of st.chat.log) {
    if (m.role === 'user') items.push(h('div', { class: 'msg-user' }, m.text, m.voice ? h('span', { class: 'via' }, 'gesprochen') : ''));
    else items.push(renderTurn(m));
  }
  if (!items.length) {
    items.push(h('div', { class: 'convo-empty' },
      h('h3', {}, 'Frag mich was.'),
      h('p', {}, ears.supported ? 'Tippe auf die orange Kugel und sprich – oder schreib unten. Was ich tue, siehst du hier als Karten.' : 'Schreib unten deine Frage. Was ich tue, siehst du hier als Karten.')));
  }
  convo.replaceChildren(...items);
  scrollConvo();
}

// Schickt eine Nachricht und zeigt live: Text, laufende Schritte, Ergebnis-Karten, Erlaubnis, Vorschläge
export async function sendChat(text, display, { spoken = false } = {}) {
  const message = String(text || '').trim();
  if (!message || !st.chat || st.state === 'thinking' || !st.els.convo) return;
  const voiceOn = voiceSettings.mode === 'stimme' && speech.supported;
  st.voiceTurn = spoken;
  speech.stop();
  openSheet(true);
  const convo = st.els.convo;
  convo.querySelector('.convo-empty')?.remove();
  const shown = display || message;
  st.chat.log.push({ role: 'user', text: shown, voice: spoken || undefined });
  convo.append(h('div', { class: 'msg-user' }, shown, spoken ? h('span', { class: 'via' }, 'gesprochen') : ''));
  const turn = h('div', { class: 'turn' });
  convo.append(turn);
  st.els.input.value = '';
  st.els.input.style.height = '';
  st.els.send.classList.remove('ready');
  setState('thinking');
  scrollConvo();

  let say = null;
  let sayText = '';
  const parts = [];
  const running = new Map();
  const perms = new Map();
  const endSay = () => {
    say?.classList.remove('streaming');
    say = null;
    sayText = '';
  };
  const handle = (evt) => {
    if (evt.type === 'text') {
      if (!say) {
        say = h('div', { class: 'say streaming' });
        turn.append(say);
        parts.push({ type: 'text', text: '' });
      }
      sayText += evt.text;
      parts[parts.length - 1].text = sayText;
      renderSay(say, sayText);
      if (voiceOn) speech.feed(evt.text);
    } else if (evt.type === 'tool_start') {
      endSay();
      if (voiceOn) speech.flush();
      const card = runningCard(evt.name, evt.id);
      running.set(evt.id, card);
      turn.append(card);
    } else if (evt.type === 'tool_end') {
      const part = { type: 'tool', name: evt.name, title: evt.title, ok: evt.ok, input: evt.input, result: evt.result, error: evt.error };
      parts.push(part);
      const done = resultCard(part, { actions: st.chat.actions, onDone: afterAction });
      const card = running.get(evt.id);
      if (card) card.replaceWith(done);
      else turn.append(done);
      running.delete(evt.id);
      if (evt.ok && MUTATING.has(evt.name)) reloadSoon(evt.name.startsWith('todo') ? [] : ['termine', 'erinnerungen']);
    } else if (evt.type === 'permission') {
      const card = permissionCard(evt);
      const prev = perms.get(evt.kind);
      if (prev) prev.replaceWith(card);
      else turn.append(card);
      perms.set(evt.kind, card);
      if (evt.state !== 'asking') {
        parts.push({ type: 'permission', kind: evt.kind, name: evt.name, state: evt.state });
        reloadSoon(['termine', 'whatsapp', 'mail', 'erinnerungen']);
      }
    } else if (evt.type === 'done') {
      paintBrainChip(evt.brain);
    } else if (evt.type === 'error') {
      throw new ApiError(evt.error, 500);
    }
    scrollConvo();
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-assistent': '1', 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({ message, display, voice: voiceOn }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || `Fehler ${res.status}`, res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(JSON.parse(line));
      }
    }
    if (buf.trim()) handle(JSON.parse(buf));
  } catch (err) {
    endSay();
    const msg = err instanceof ApiError ? err.message : 'Die Verbindung zum Assistenten ist abgebrochen.';
    turn.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'status fail' }, icon('cross')), h('span', {}, 'Hat nicht geklappt')), h('div', { class: 'card-body tight' }, h('p', { class: 'c-error' }, msg))));
    if (voiceOn) speech.say(msg);
  }
  endSay();
  running.forEach((c) => c.remove());
  st.chat.log.push({ role: 'assistant', parts });
  setState(voiceOn && speech.speaking ? 'speaking' : 'idle');
  scrollConvo();
  if (voiceOn) {
    speech.flush();
    if (speech.speaking) setState('speaking');
    speech.whenDone(() => {
      if (st.state === 'speaking') setState('idle');
      if (st.voiceTurn && voiceSettings.keepListening && !ears.problem() && st.els.convo?.isConnected && st.state === 'idle') listen();
    });
  }
}

