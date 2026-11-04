// Karten im Chat: was der Agent gerade macht – und danach das Ergebnis.

import { h, icon, shortDate, monthShort, dateFromIso } from './ui.js';

export const RUNNING = {
  day_overview: 'Verschaffe mir einen Überblick …',
  todos_list: 'Schaue in deine To-dos …',
  todo_add: 'Lege ein To-do an …',
  todo_update: 'Ändere das To-do …',
  todo_delete: 'Lösche das To-do …',
  calendar_events: 'Schaue in deinen Kalender …',
  calendar_is_free: 'Prüfe, ob du Zeit hast …',
  calendar_list: 'Schaue nach deinen Kalendern …',
  calendar_create_event: 'Trage den Termin ein …',
  calendar_update_event: 'Ändere den Termin …',
  calendar_delete_event: 'Lösche den Termin …',
  mail_list: 'Schaue in deinen Posteingang …',
  mail_read: 'Lese die Mail …',
  mail_search: 'Durchsuche deine Mails …',
  mail_mark: 'Markiere die Mail …',
  mail_move: 'Verschiebe die Mail …',
  mail_create_draft: 'Schreibe einen Entwurf …',
  mail_folders: 'Schaue nach deinen Ordnern …',
  weather_get: 'Hole das Wetter …',
  briefing_save: 'Speichere das Briefing …',
};

const DONE = {
  day_overview: 'Tagesüberblick',
  todos_list: 'Deine To-dos',
  todo_add: 'To-do angelegt',
  todo_update: 'To-do geändert',
  todo_delete: 'To-do gelöscht',
  calendar_events: 'Termine',
  calendar_is_free: 'Kalender geprüft',
  calendar_list: 'Deine Kalender',
  calendar_create_event: 'Termin eingetragen',
  calendar_update_event: 'Termin geändert',
  calendar_delete_event: 'Termin gelöscht',
  mail_list: 'Posteingang',
  mail_read: 'Mail gelesen',
  mail_search: 'Suchergebnis',
  mail_mark: 'Mail markiert',
  mail_move: 'Mail verschoben',
  mail_create_draft: 'Entwurf gespeichert',
  mail_folders: 'Mail-Ordner',
  weather_get: 'Wetter',
  briefing_save: 'Briefing gespeichert',
};

export const MUTATING = new Set(['todo_add', 'todo_update', 'todo_delete', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event', 'mail_mark', 'mail_move', 'mail_create_draft', 'briefing_save']);

function head(statusClass, label) {
  return h('div', { class: 'widget-head' },
    h('span', { class: `status ${statusClass}` }, statusClass === 'ok' ? icon('check') : statusClass === 'fail' ? icon('cross') : ''),
    h('span', {}, label));
}

export function runningWidget(name, id) {
  return h('div', { class: 'widget running', dataset: { id } }, head('run', RUNNING[name] || 'Arbeite …'));
}

// "2026-11-06T15:00" -> "Fr. 6. Nov, 15:00"
function when(start, end, allDay) {
  if (!start) return '';
  if (allDay || start.length === 10) {
    const last = end && end.slice(0, 10) !== start.slice(0, 10) ? ` bis ${shortDate(end.slice(0, 10))}` : '';
    return `${shortDate(start.slice(0, 10))}, ganztags${last}`;
  }
  const sameDay = end && end.slice(0, 10) === start.slice(0, 10);
  return `${shortDate(start.slice(0, 10))}, ${start.slice(11)}${end ? `–${sameDay ? end.slice(11) : `${shortDate(end.slice(0, 10))} ${end.slice(11)}`}` : ''} Uhr`;
}

function todoMeta(t) {
  const bits = [];
  if (t.faellig) bits.push(shortDate(t.faellig));
  if (t.uhrzeit) bits.push(`${t.uhrzeit} Uhr`);
  if (t.prioritaet === 'hoch') bits.push('wichtig');
  return bits.join(', ');
}

function eventList(list, max = 6) {
  if (!list?.length) return h('p', { class: 'w-sub' }, 'Keine Termine.');
  return [
    h('ul', { class: 'w-list' }, list.slice(0, max).map((e) => h('li', {},
      h('time', {}, e.ganztaegig ? 'ganztags' : (e.beginn || '').slice(11)),
      h('span', { class: 'v' }, e.titel, e.ort ? h('small', {}, e.ort) : '')))),
    list.length > max ? h('p', { class: 'w-more' }, `und ${list.length - max} weitere`) : '',
  ];
}

// Heute nur die Uhrzeit, sonst Wochentag und Tag
function compactWhen(iso) {
  if (!iso) return '–';
  const today = new Date().toLocaleDateString('sv');
  if (iso.slice(0, 10) === today) return iso.slice(11);
  return shortDate(iso.slice(0, 10)).replace(/\s\S+$/, '');
}

function mailList(list, max = 5) {
  if (!list?.length) return h('p', { class: 'w-sub' }, 'Keine Mails.');
  return [
    h('ul', { class: 'w-list' }, list.slice(0, max).map((m) => h('li', {},
      h('span', { class: 'k' }, compactWhen(m.date)),
      h('span', { class: 'v' }, m.from, h('small', {}, m.subject))))),
    list.length > max ? h('p', { class: 'w-more' }, `und ${list.length - max} weitere`) : '',
  ];
}

function body(...children) {
  return h('div', { class: 'widget-body' }, ...children);
}

const RENDER = {
  day_overview(r) {
    const termine = r.termine || [];
    const mails = r.ungelesene_mails?.anzahl ?? null;
    const next = termine.find((e) => !e.ganztaegig && (e.beginn || '') >= (r.jetzt || ''));
    return body(
      h('div', { class: 'w-stats' },
        h('div', {}, h('b', {}, termine.length), h('span', {}, termine.length === 1 ? 'Termin' : 'Termine')),
        h('div', {}, h('b', {}, (r.todos || []).length), h('span', {}, 'To-dos')),
        h('div', {}, h('b', {}, mails ?? '–'), h('span', {}, 'ungelesen'))),
      next ? h('p', { class: 'w-sub' }, `Als Nächstes: ${next.beginn.slice(11)} ${next.titel}`) : '');
  },
  todos_list(r) {
    const list = r.todos || [];
    if (!list.length) return body(h('p', { class: 'w-sub' }, 'Keine To-dos.'));
    return body(h('ul', { class: 'w-list plain' }, list.slice(0, 6).map((t) => h('li', {}, h('span', { class: 'k' }, t.erledigt ? '✓' : '○'), h('span', { class: 'v' }, t.titel, todoMeta(t) ? h('small', {}, todoMeta(t)) : '')))),
      list.length > 6 ? h('p', { class: 'w-more' }, `und ${list.length - 6} weitere`) : '');
  },
  todo_add(r) {
    const t = r.todo || {};
    return body(h('p', { class: 'w-title' }, t.titel), h('p', { class: 'w-sub' }, r.schon_vorhanden ? 'Stand schon auf deiner Liste.' : todoMeta(t) || 'Ohne Datum'));
  },
  todo_update(r) {
    const t = r.todo || {};
    return body(h('p', { class: 'w-title' }, t.titel), h('p', { class: 'w-sub' }, t.erledigt ? 'Abgehakt.' : todoMeta(t) || 'Geändert.'));
  },
  todo_delete(r) {
    return body(h('p', { class: 'w-title' }, r.titel));
  },
  calendar_events(r) {
    return body(eventList(r.termine));
  },
  calendar_is_free(r, input) {
    return body(
      h('p', { class: `w-big${r.frei ? ' orange' : ''}` }, r.frei ? 'Frei' : 'Schon belegt'),
      h('p', { class: 'w-sub' }, when(input?.start, input?.end || null, false) || ''),
      r.ueberschneidungen?.length ? eventList(r.ueberschneidungen, 3) : '',
      r.ganztaegige_termine_an_dem_tag?.length ? h('p', { class: 'w-more' }, `Ganztags: ${r.ganztaegige_termine_an_dem_tag.map((e) => e.titel).join(', ')}`) : '');
  },
  calendar_list(r) {
    return body(h('div', { class: 'w-chips' }, (r.kalender || []).map((c) => h('span', {}, c.name))));
  },
  calendar_create_event(r) {
    const day = (r.start || '').slice(0, 10);
    return body(h('div', { class: 'w-date' },
      day ? h('div', { class: 'cal', 'aria-hidden': 'true' }, h('span', {}, monthShort(day)), h('b', {}, dateFromIso(day).getUTCDate())) : '',
      h('div', {}, h('p', { class: 'w-title' }, r.title), h('p', { class: 'w-sub' }, when(r.start, r.end, r.allDay)), r.calendar ? h('p', { class: 'w-more' }, `Kalender: ${r.calendar}`) : '')));
  },
  calendar_update_event(r) {
    return body(h('p', { class: 'w-title' }, r.title || 'Termin'));
  },
  calendar_delete_event() {
    return null;
  },
  mail_list(r) {
    return body(h('p', { class: 'w-sub' }, `${r.gesamt ?? (r.mails || []).length} in ${r.ordner || 'Posteingang'}`), mailList(r.mails));
  },
  mail_search(r) {
    return body(h('p', { class: 'w-sub' }, `${r.treffer ?? 0} Treffer`), mailList(r.mails));
  },
  mail_read(r) {
    const text = String(r.text || '').replace(/\s+/g, ' ').trim();
    return body(h('p', { class: 'w-title' }, r.subject), h('p', { class: 'w-sub' }, `Von ${r.from}`), text ? h('p', { class: 'w-quote' }, text.length > 220 ? `${text.slice(0, 220)} …` : text) : '');
  },
  mail_mark() {
    return null;
  },
  mail_move(r) {
    return body(h('p', { class: 'w-sub' }, `Liegt jetzt in ${r.folder}.`));
  },
  mail_create_draft(r) {
    return body(h('p', { class: 'w-title' }, r.subject || '(ohne Betreff)'), h('p', { class: 'w-sub' }, `An ${r.to}`), h('p', { class: 'w-more' }, `Liegt in „${r.savedTo || 'Entwürfe'}“. Abschicken tust du selbst in der Mail-App.`));
  },
  mail_folders(r) {
    return body(h('div', { class: 'w-chips' }, (r.ordner || []).map((f) => h('span', {}, f))));
  },
  weather_get(r) {
    const now = r.jetzt || {};
    const today = r.heute || {};
    return body(h('div', { class: 'w-weather' },
      icon(now.icon),
      h('span', { class: 'temp' }, `${Math.round(now.temp)}°`),
      h('div', {}, h('p', { class: 'w-title' }, now.text), h('p', { class: 'w-sub' }, `${Math.round(today.min)} bis ${Math.round(today.max)} °C${today.rainChance ? `, Regen ${today.rainChance} %` : ''}${r.ort ? `, ${r.ort}` : ''}`))));
  },
  briefing_save() {
    return null;
  },
};

export function resultWidget(part) {
  if (!part.ok) {
    return h('div', { class: 'widget' }, head('fail', `${DONE[part.name] || part.title || 'Schritt'} – hat nicht geklappt`), h('div', { class: 'widget-body tight' }, h('p', { class: 'w-error' }, part.error || 'Unbekannter Fehler')));
  }
  let content = null;
  try {
    content = RENDER[part.name]?.(part.result || {}, part.input || {}) ?? null;
  } catch {
    content = null;
  }
  return h('div', { class: 'widget', dataset: { tool: part.name } }, head('ok', DONE[part.name] || part.title || 'Erledigt'), content);
}
