// Das Dashboard: Begrüßung, Wetter, Tagesband, Agent mit Sprache, To-dos, Termine, Post.

import { h, icon, ICONS, toast, api, ApiError, shell, longDate, shortDate, addDays, minutesOf, hm, relativeDay, renderSay } from './ui.js';
import { runningWidget, resultWidget, MUTATING } from './widgets.js';
import { speech, ears, voiceSettings } from './voice.js';

const root = () => document.getElementById('app');
const dash = { data: null, fetchedAt: 0, timer: null, tick: null, tab: 'heute', els: {}, chat: null, state: 'idle', voiceTurn: false };

export function stopDashboard() {
  clearInterval(dash.timer);
  clearInterval(dash.tick);
  dash.timer = null;
  dash.tick = null;
  ears.stop(true);
  speech.stop();
  dash.els = {};
}

function nowLocal() {
  const d = dash.data.now;
  const mins = minutesOf(`${d.date}T${d.time}`) + Math.floor((Date.now() - dash.fetchedAt) / 60000);
  return { date: mins >= 1440 ? addDays(d.date, 1) : d.date, minutes: mins % 1440 };
}

function greeting(time) {
  const hr = Number(time.slice(0, 2));
  if (hr >= 5 && hr < 11) return 'Guten Morgen.';
  if (hr >= 11 && hr < 17) return 'Hallo.';
  if (hr >= 17 && hr < 23) return 'Guten Abend.';
  return 'Gute Nacht.';
}

let reloadTimer;
function reloadSoon() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadDashboard().catch(() => {}), 350);
}

async function loadDashboard() {
  const data = await api('GET', '/api/dashboard');
  if (!dash.els.head) return;
  dash.data = data;
  dash.fetchedAt = Date.now();
  renderHead();
  renderWeather();
  renderBand();
  renderTodos();
  renderEvents();
  renderMail();
  const unread = data.mail?.total || 0;
  const postBtn = dash.els.tabbar?.querySelector('[data-tab="post"]');
  if (postBtn) {
    postBtn.querySelector('.badge')?.remove();
    if (unread) postBtn.append(h('span', { class: 'badge', 'aria-label': `${unread} ungelesen` }, unread > 99 ? '99+' : unread));
  }
}

export function renderDashboard() {
  const els = {
    head: h('section', { class: 'area-head', 'aria-label': 'Dein Tag' }),
    weather: h('section', { class: 'area-weather', 'aria-label': 'Wetter' }),
    band: h('section', { class: 'area-band', 'aria-label': 'Tagesband' }),
    agent: h('section', { class: 'panel panel-agent', 'aria-labelledby': 'h-agent' }),
    todos: h('section', { class: 'panel panel-todos', 'aria-labelledby': 'h-todos' }),
    events: h('section', { class: 'panel panel-events', 'aria-labelledby': 'h-events' }),
    mail: h('section', { class: 'panel panel-mail', 'aria-labelledby': 'h-mail' }),
  };
  dash.els = els;
  const more = h('nav', { class: 'more-links', 'aria-label': 'Mehr' },
    h('a', { href: '#/verbindungen' }, 'Verbindungen', h('span', { 'aria-hidden': 'true' }, '›')),
    h('a', { href: '#/einstellungen' }, 'Einstellungen', h('span', { 'aria-hidden': 'true' }, '›')));
  const main = h('main', { class: 'page', dataset: { tab: dash.tab } },
    h('div', { class: 'dash' }, els.head, els.weather, els.band, els.agent, els.todos, els.events, els.mail),
    more);
  const tabs = [['heute', 'Heute', 'today'], ['agent', 'Agent', 'agent'], ['post', 'Post', 'inbox'], ['mehr', 'Mehr', 'menu']];
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Bereiche' }, tabs.map(([id, label, ic]) => h('button', {
    type: 'button',
    'aria-current': dash.tab === id ? 'true' : 'false',
    dataset: { tab: id },
    onclick: () => switchTab(id),
  }, icon(ic), label)));
  els.tabbar = tabbar;
  els.main = main;
  root().replaceChildren(...shell('/', main), tabbar);
  els.head.append(h('p', { class: 'date' }, 'Lade deinen Tag …'));
  renderAgentPanel();
  loadDashboard().catch((err) => toast(err.message, 'error'));
  dash.timer = setInterval(() => {
    if (document.visibilityState === 'visible' && dash.state === 'idle') loadDashboard().catch(() => {});
  }, 120000);
  dash.tick = setInterval(() => {
    if (dash.data) renderBand();
  }, 60000);
}

function switchTab(id) {
  dash.tab = id;
  if (dash.els.main) dash.els.main.dataset.tab = id;
  dash.els.tabbar?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === id ? 'true' : 'false'));
  window.scrollTo({ top: 0 });
  if (id === 'agent') scrollConvo();
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (dash.data && dash.els.band?.isConnected) renderBand();
  }, 150);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dash.timer && Date.now() - dash.fetchedAt > 30000) loadDashboard().catch(() => {});
});

// ---------------- Kopf & Wetter ----------------

function renderHead() {
  const d = dash.data;
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
  dash.els.head.replaceChildren(h('p', { class: 'date' }, longDate(d.now.date)), h('h1', {}, greeting(d.now.time)), briefing);
}

function renderWeather() {
  const d = dash.data;
  const w = d.weather;
  const el = dash.els.weather;
  if (!d.connections.weather.connected) {
    el.replaceChildren(h('div', { class: 'weather-card weather-empty' }, h('p', {}, 'Stell deinen Ort ein, dann siehst du hier das Wetter.'), h('a', { class: 'btn btn-quiet', href: '#/verbindungen/wetter' }, 'Wetter einstellen')));
    return;
  }
  if (!w) {
    el.replaceChildren(h('div', { class: 'weather-card weather-empty' }, h('p', { class: 'error-line' }, d.weatherError || 'Wetter gerade nicht verfügbar.')));
    return;
  }
  const nowKey = `${d.now.date}T${d.now.time.slice(0, 2)}:00`;
  const start = Math.max(0, w.hours.findIndex((x) => x.time >= nowKey));
  const next = w.hours.slice(start + 1, start + 7);
  el.replaceChildren(h('div', { class: 'weather-card' },
    h('div', { class: 'weather-top' },
      icon(w.current.icon),
      h('span', { class: 'weather-temp' }, `${Math.round(w.current.temp)}°`),
      h('div', { class: 'weather-desc' }, h('strong', {}, w.current.text), h('span', {}, `${Math.round(w.today.min)} bis ${Math.round(w.today.max)} °C, ${w.place}`))),
    next.length ? h('div', { class: 'hours-row', 'aria-label': 'Die nächsten Stunden' }, next.map((x) => h('div', {},
      x.time.slice(11, 13),
      h('b', {}, `${Math.round(x.temp)}°`),
      x.rainChance >= 30 ? h('span', { class: 'rain' }, `${x.rainChance} %`) : ''))) : ''));
}

// ---------------- Tagesband ----------------

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
  const pct = (m) => `${(((Math.min(Math.max(m, startMin), endMin) - startMin) / span) * 100).toFixed(3)}%`;
  const now = nowLocal();
  const band = h('div', { class: 'dayband', role: 'img', 'aria-label': timed.length ? `Heute: ${timed.map((e) => `${e.start.slice(11)} ${e.title}`).join(', ')}` : 'Heute keine Termine mit Uhrzeit' });

  // Tageslicht zwischen Sonnenaufgang und -untergang
  const rise = d.weather?.today?.sunrise ? hm(d.weather.today.sunrise) : 7 * 60;
  const set = d.weather?.today?.sunset ? hm(d.weather.today.sunset) : 17 * 60;
  const light = h('div', { class: 'daylight' });
  light.style.left = pct(rise);
  light.style.width = `calc(${pct(set)} - ${pct(rise)})`;
  light.style.background = 'linear-gradient(90deg, rgba(255,107,26,0), rgba(255,107,26,0.13) 18%, rgba(255,155,82,0.18) 50%, rgba(255,107,26,0.13) 82%, rgba(255,107,26,0))';
  band.append(light);
  for (let hr = firstHour + 3; hr < endMin / 60; hr += 3) {
    const line = h('span', { class: 'grid-line' });
    line.style.left = pct(hr * 60);
    band.append(line);
  }

  const isMobile = matchMedia('(max-width: 860px)').matches;
  const W = el.clientWidth || 1000;
  const laneTop = isMobile ? 10 : 12;
  const laneHeight = isMobile ? 31 : 38;
  const lanesEnd = [];
  for (const e of [...timed].sort((a, b) => startOfDay(a) - startOfDay(b))) {
    const s = startOfDay(e);
    const en = Math.max(endOfDay(e), s + 15);
    const label = `${e.start.slice(11)} ${e.title}`;
    const textW = Math.min(isMobile ? 120 : 240, label.length * (isMobile ? 6.4 : 7.4) + 28);
    const w = Math.max(((en - s) / span) * W - 3, isMobile ? Math.min(textW, 96) : textW, 24);
    let x = ((Math.max(s, startMin) - startMin) / span) * W;
    if (x + w > W - 6) x = Math.max(0, W - 6 - w);
    let lane = lanesEnd.findIndex((end) => end + 4 <= x);
    if (lane < 0) {
      lane = Math.min(lanesEnd.length, 1);
      if (lane === lanesEnd.length) lanesEnd.push(0);
    }
    lanesEnd[lane] = Math.max(lanesEnd[lane], x + w);
    const block = h('div', { class: `lane-block${now.date === today && endOfDay(e) < now.minutes ? ' is-past' : ''}`, title: `${e.start.slice(11)}–${e.end.slice(11)} ${e.title}${e.location ? `, ${e.location}` : ''}` },
      h('b', {}, e.start.slice(0, 10) < today ? '…' : e.start.slice(11)), e.title);
    block.style.left = `${((x / W) * 100).toFixed(3)}%`;
    block.style.width = `${Math.round(w)}px`;
    block.style.top = `${laneTop + lane * laneHeight}px`;
    band.append(block);
  }
  for (const t of d.todos.filter((x) => x.due === today && x.time)) {
    const pin = h('span', { class: `todo-pin${t.done ? ' done' : ''}`, title: `${t.time} ${t.title}` });
    pin.style.left = pct(hm(t.time));
    band.append(pin);
  }
  if (!timed.length) band.append(h('span', { class: 'band-empty' }, d.connections.calendar.connected ? (d.eventsError ? 'Kalender gerade nicht erreichbar' : 'Heute keine Termine mit Uhrzeit') : 'Verbinde deinen Kalender, dann siehst du hier deinen Tag'));
  const hours = h('div', { class: 'hours', 'aria-hidden': 'true' });
  for (let hr = firstHour; hr < endMin / 60; hr += 3) {
    const s = h('span', {}, `${hr}`);
    s.style.left = pct(hr * 60);
    hours.append(s);
  }
  if (now.date === today && now.minutes >= startMin && now.minutes <= endMin) {
    const past = h('div', { class: 'past' });
    past.style.width = pct(now.minutes);
    const marker = h('span', { class: 'now', title: 'Jetzt' });
    marker.style.left = pct(now.minutes);
    band.append(past, marker);
  }
  el.replaceChildren(allDay.length ? h('div', { class: 'allday' }, allDay.map((e) => h('span', {}, e.title))) : '', band, hours);
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
  const when = h('select', { 'aria-label': 'Wann' }, h('option', { value: 'heute' }, 'Heute'), h('option', { value: 'morgen' }, 'Morgen'), h('option', { value: 'ohne' }, 'Ohne Datum'));
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
      renderBand();
      dash.els.todos.querySelector('input[type="text"]').focus();
    } catch (err) {
      toast(err.message, 'error');
      title.value = text;
    }
  } }, title, when, h('button', { class: 'btn', type: 'submit', 'aria-label': 'To-do hinzufügen' }, icon('plus')));
  const groups = groupTodos(d.todos, today);
  const body = groups.length
    ? groups.map((g) => h('div', { class: `todo-group${g.id === 'late' ? ' late' : ''}` }, h('h3', {}, g.title), h('ul', { class: 'todo-list' }, g.items.map((t) => todoItem(t, today)))))
    : [h('p', { class: 'empty' }, 'Nichts zu tun. Schreib oben ein To-do rein oder sag es dem Agenten.')];
  const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.matches('.todo-add input');
  el.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', { id: 'h-todos' }, 'To-dos'), h('span', { class: 'count' }, dueToday ? `${dueToday} für heute` : open.length ? `${open.length} offen` : '')),
    form,
    ...body,
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
  return h('li', { class: `todo${t.done ? ' done' : ''}` },
    h('button', { class: 'tick', type: 'button', 'aria-pressed': t.done ? 'true' : 'false', 'aria-label': t.done ? `„${t.title}“ wieder öffnen` : `„${t.title}“ abhaken`, onclick: () => toggleTodo(t) }, h('span', {}, icon('check'))),
    h('div', { class: 'todo-body' },
      h('div', { class: 'todo-title' }, t.title),
      meta.length ? h('div', { class: 'todo-meta' }, meta) : '',
      t.notes ? h('div', { class: 'todo-notes' }, t.notes.length > 140 ? `${t.notes.slice(0, 140)} …` : t.notes) : ''),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `„${t.title}“ bearbeiten`, onclick: () => editTodo(t), html: ICONS.more }));
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
  const shown = e.allDay ? 'ganztags' : e.start.slice(0, 10) < day ? `bis ${e.end.slice(11)}` : e.start.slice(11);
  const li = h('li', { class: `event${nowMin !== null && !e.allDay && e.end.slice(0, 10) === day && minutesOf(e.end) < nowMin ? ' is-past' : ''}` },
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
    el.replaceChildren(head, h('div', { class: 'notice' }, h('p', {}, 'Verbinde deinen iCloud-Kalender, dann stehen hier deine Termine von heute und morgen.'), h('a', { class: 'btn btn-quiet', href: '#/verbindungen/kalender' }, 'Kalender verbinden')));
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
    el.replaceChildren(head, h('div', { class: 'notice' }, h('p', {}, 'Verbinde deine iCloud-Mail, dann siehst du hier Ungelesenes – und der Agent kann Antworten vorschreiben.'), h('a', { class: 'btn btn-quiet', href: '#/verbindungen/mail' }, 'Mail verbinden')));
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
  const inner = h('div', { class: 'dialog-inner' }, h('h2', { id: 'mail-h' }, m.subject), h('p', { class: 'hint' }, 'Lade die Mail …'));
  dialog.append(inner);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  try {
    const { mail } = await api('GET', `/api/mail/${encodeURIComponent(m.id)}`);
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
        dash.data.connections.claude.connected ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => {
          close();
          switchTab('agent');
          sendChat(`Lies die Mail mit der id ${m.id} von ${m.from} („${m.subject}“). Prüf, ob ich Zeit habe, falls es um einen Termin geht, und schreib mir einen kurzen Antwort-Entwurf (als Entwurf speichern).`, `Schreib mir eine Antwort auf die Mail von ${m.from}: „${m.subject}“`);
        } }, 'Antwort vorschreiben') : '',
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Schließen')));
  } catch (err) {
    inner.replaceChildren(h('h2', { id: 'mail-h' }, m.subject), h('p', { class: 'error-line' }, err.message), h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Schließen')));
  }
}

// ---------------- Agent ----------------

const SUGGESTIONS = ['Was steht heute an?', 'Hab ich morgen Nachmittag Zeit?', 'Welche Mails brauchen eine Antwort?', 'Wie wird das Wetter?'];
const STATE_LABEL = { idle: 'Bereit', listening: 'Hört zu …', thinking: 'Arbeitet …', speaking: 'Spricht …' };

function setState(state) {
  dash.state = state;
  const label = dash.els.agentState;
  if (label) {
    label.textContent = STATE_LABEL[state] || '';
    label.classList.toggle('active', state !== 'idle');
  }
  document.querySelectorAll('.panel-agent .orb').forEach((orb) => {
    orb.classList.toggle('is-listening', state === 'listening');
    orb.classList.toggle('is-thinking', state === 'thinking');
    orb.classList.toggle('is-speaking', state === 'speaking');
    orb.innerHTML = state === 'listening' || state === 'speaking' ? ICONS.stop : ICONS.mic;
    orb.setAttribute('aria-label', state === 'listening' ? 'Zuhören beenden' : state === 'speaking' ? 'Vorlesen stoppen' : 'Sprechen');
  });
  if (dash.els.sendBtn) dash.els.sendBtn.disabled = state === 'thinking';
}

speech.onState = (s) => {
  if (s === 'speaking' && dash.state !== 'thinking') setState('speaking');
  if (s === 'idle-speech' && dash.state === 'speaking') setState('idle');
};

function scrollConvo() {
  const c = dash.els.convo;
  if (c) requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight;
  });
}

function orbButton(extraClass = '') {
  return h('button', { class: `orb ${extraClass}`.trim(), type: 'button', 'aria-label': 'Sprechen', html: ICONS.mic, onclick: onOrb });
}

function onOrb() {
  speech.unlock();
  if (dash.state === 'listening') {
    ears.stop(false);
    return;
  }
  if (dash.state === 'speaking') {
    dash.voiceTurn = false;
    speech.stop();
    setState('idle');
    return;
  }
  if (dash.state === 'thinking') {
    toast('Einen Moment, ich bin gleich so weit.');
    return;
  }
  listen();
}

function listen() {
  const input = dash.els.input;
  if (!input) return;
  const started = ears.start({
    onText: (text) => {
      input.value = text;
      autosize(input);
    },
    onEnd: (text) => {
      if (dash.state === 'listening') setState('idle');
      if (text) sendChat(text, null, { spoken: true });
      else dash.voiceTurn = false;
    },
    onError: (msg, code) => {
      if (code !== 'no-speech') toast(msg, 'error');
      if (dash.state === 'listening') setState('idle');
    },
  });
  if (started) {
    speech.stop();
    setState('listening');
  }
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
}

function modeToggle() {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Antwort als' });
  const make = (mode, label) => h('button', { type: 'button', 'aria-pressed': voiceSettings.mode === mode ? 'true' : 'false', onclick: () => {
    voiceSettings.mode = mode;
    wrap.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', (i === 0 ? 'text' : 'stimme') === mode ? 'true' : 'false'));
    if (mode === 'stimme') {
      speech.unlock();
      if (!speech.supported) toast('Vorlesen kann dieser Browser leider nicht.', 'error');
    } else speech.stop();
  } }, label);
  wrap.append(make('text', 'Nur Text'), make('stimme', 'Text + Stimme'));
  return wrap;
}

async function renderAgentPanel() {
  const el = dash.els.agent;
  const state = h('span', { class: 'agent-state' }, STATE_LABEL.idle);
  dash.els.agentState = state;
  const newChat = h('button', { class: 'link-btn', type: 'button', onclick: async () => {
    try {
      speech.stop();
      await api('DELETE', '/api/chat');
      dash.chat.log = [];
      renderConvo();
    } catch (err) {
      toast(err.message, 'error');
    }
  } }, 'Neuer Chat');
  const head = h('div', { class: 'agent-head' }, h('h2', { id: 'h-agent' }, 'Agent'), state, h('span', { class: 'spacer' }), newChat);
  const convo = h('div', { class: 'convo', 'aria-live': 'polite' });
  dash.els.convo = convo;
  el.replaceChildren(head, convo);
  let data;
  try {
    data = await api('GET', '/api/chat');
  } catch (err) {
    convo.replaceChildren(h('p', { class: 'error-line' }, err.message));
    return;
  }
  dash.chat = { log: data.log, available: data.available };
  if (!data.available) {
    newChat.remove();
    convo.replaceChildren(h('div', { class: 'agent-empty' },
      orbButton(),
      h('h3', {}, 'Dein Agent wartet auf Claude.'),
      h('p', {}, 'Damit du mit ihm schreiben und sprechen kannst, braucht er einen Claude-API-Schlüssel.'),
      h('a', { class: 'btn', href: '#/verbindungen/claude' }, 'Claude verbinden')));
    el.querySelector('.agent-empty .orb').disabled = true;
    return;
  }
  const input = h('textarea', { rows: '1', placeholder: 'Frag mich was …', 'aria-label': 'Nachricht an den Agenten', maxlength: '8000' });
  const send = h('button', { class: 'btn send-btn', type: 'submit', 'aria-label': 'Senden', html: ICONS.send });
  const form = h('form', { class: 'composer-row', onsubmit: (e) => {
    e.preventDefault();
    speech.unlock();
    sendChat(input.value);
  } }, orbButton(), input, send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', () => autosize(input));
  const composer = h('div', { class: 'composer' }, form, h('div', { class: 'composer-foot' }, h('span', {}, 'Antwort:'), modeToggle(), h('span', { class: 'spacer' }), h('span', {}, ears.supported ? 'Kugel antippen und sprechen' : 'Enter zum Senden')));
  el.append(composer);
  dash.els.input = input;
  dash.els.sendBtn = send;
  renderConvo();
  setState('idle');
}

function renderTurn(entry) {
  const turn = h('div', { class: 'turn' });
  const parts = entry.parts?.length ? entry.parts : [{ type: 'text', text: entry.text }];
  for (const p of parts) {
    if (p.type === 'tool') turn.append(resultWidget(p));
    else if (p.text?.trim()) {
      const say = h('div', { class: 'say' });
      renderSay(say, p.text.trim());
      turn.append(say);
    }
  }
  return turn;
}

function renderConvo() {
  const convo = dash.els.convo;
  if (!convo) return;
  const items = [];
  for (const m of dash.chat.log) {
    if (m.role === 'user') items.push(h('div', { class: 'msg-user' }, m.text, m.voice ? h('span', { class: 'via' }, 'gesprochen') : ''));
    else items.push(renderTurn(m));
  }
  if (!items.length) {
    items.push(h('div', { class: 'agent-empty' },
      orbButton(),
      h('h3', {}, 'Frag mich was.'),
      h('p', {}, ears.supported ? 'Tippe auf die Kugel und sprich – oder schreib unten. Was ich tue, siehst du hier als Karten.' : 'Schreib unten deine Frage. Was ich tue, siehst du hier als Karten.'),
      h('div', { class: 'suggestions' }, SUGGESTIONS.map((s) => h('button', { type: 'button', onclick: () => {
        speech.unlock();
        sendChat(s);
      } }, s)))));
  }
  convo.replaceChildren(...items);
  setState(dash.state);
  scrollConvo();
}

// Schickt eine Nachricht und zeigt live: Text-Stücke, laufende Schritte, Ergebnis-Karten
export async function sendChat(text, display, { spoken = false } = {}) {
  const message = String(text || '').trim();
  if (!message || !dash.chat || dash.state === 'thinking' || !dash.els.convo) return;
  const voiceOn = voiceSettings.mode === 'stimme' && speech.supported;
  dash.voiceTurn = spoken;
  speech.stop();
  const convo = dash.els.convo;
  convo.querySelector('.agent-empty')?.remove();
  const shown = display || message;
  dash.chat.log.push({ role: 'user', text: shown, voice: spoken || undefined });
  convo.append(h('div', { class: 'msg-user' }, shown, spoken ? h('span', { class: 'via' }, 'gesprochen') : ''));
  const turn = h('div', { class: 'turn' });
  convo.append(turn);
  dash.els.input.value = '';
  dash.els.input.style.height = '';
  setState('thinking');
  scrollConvo();

  let say = null;
  let sayText = '';
  const parts = [];
  const running = new Map();
  const endSay = () => {
    if (say) say.classList.remove('streaming');
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
      if (voiceOn) speech.flush(); // angefangenen Satz vor dem Werkzeug vorlesen
      const w = runningWidget(evt.name, evt.id);
      running.set(evt.id, w);
      turn.append(w);
    } else if (evt.type === 'tool_end') {
      const part = { type: 'tool', name: evt.name, title: evt.title, ok: evt.ok, input: evt.input, result: evt.result, error: evt.error };
      parts.push(part);
      const done = resultWidget(part);
      const w = running.get(evt.id);
      if (w) w.replaceWith(done);
      else turn.append(done);
      if (evt.ok && MUTATING.has(evt.name)) reloadSoon();
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
    turn.append(h('div', { class: 'widget' }, h('div', { class: 'widget-head' }, h('span', { class: 'status fail' }, icon('cross')), h('span', {}, 'Hat nicht geklappt')), h('div', { class: 'widget-body tight' }, h('p', { class: 'w-error' }, msg))));
    parts.push({ type: 'text', text: '' });
    if (voiceOn) speech.say(msg);
  }
  endSay();
  running.forEach((w) => w.remove());
  dash.chat.log.push({ role: 'assistant', parts });
  setState(voiceOn && speech.speaking ? 'speaking' : 'idle');
  scrollConvo();
  if (voiceOn) {
    speech.flush();
    if (speech.speaking) setState('speaking');
    // Gespräch: nach der gesprochenen Antwort wieder zuhören
    speech.whenDone(() => {
      if (dash.state === 'speaking') setState('idle');
      if (dash.voiceTurn && voiceSettings.keepListening && !ears.problem() && dash.els.convo?.isConnected && dash.state === 'idle') listen();
    });
  }
}
