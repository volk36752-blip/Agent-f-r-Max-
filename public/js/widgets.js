// Karten im Gespräch: was der Agent gerade macht, das Ergebnis – und Vorschläge zum Antippen.

import { h, icon, ICONS, api, toast, shortDate, monthShort, dateFromIso } from './ui.js';

export const RUNNING = {
  day_overview: 'Verschaffe mir einen Überblick …',
  todos_list: 'Schaue in deine To-dos …',
  todo_add: 'Lege ein To-do an …',
  todo_update: 'Ändere das To-do …',
  todo_delete: 'Bereite das Löschen vor …',
  calendar_events: 'Schaue in deinen Kalender …',
  calendar_is_free: 'Prüfe, ob du Zeit hast …',
  calendar_list: 'Schaue nach deinen Kalendern …',
  calendar_create_event: 'Trage den Termin ein …',
  calendar_update_event: 'Ändere den Termin …',
  calendar_delete_event: 'Bereite das Löschen vor …',
  whatsapp_chats: 'Schaue in WhatsApp …',
  whatsapp_read: 'Lese den Chat …',
  whatsapp_suggest: 'Schreibe Vorschläge …',
  mail_list: 'Schaue in deinen Posteingang …',
  mail_read: 'Lese die Mail …',
  mail_search: 'Durchsuche deine Mails …',
  mail_mark: 'Markiere die Mail …',
  mail_move: 'Verschiebe die Mail …',
  mail_suggest_reply: 'Schreibe Antwort-Vorschläge …',
  mail_suggest_new: 'Schreibe Vorschläge …',
  mail_create_draft: 'Öffne einen Entwurf …',
  reminders_list: 'Schaue in deine Erinnerungen …',
  reminder_add: 'Lege eine Erinnerung an …',
  reminder_done: 'Hake die Erinnerung ab …',
  contacts_search: 'Suche in deinen Kontakten …',
  weather_get: 'Hole das Wetter …',
  briefing_save: 'Speichere das Briefing …',
  news_headlines: 'Hole die Schlagzeilen …',
  shortcuts_list: 'Schaue nach deinen Kurzbefehlen …',
  shortcut_run: 'Bereite den Kurzbefehl vor …',
  notes_search: 'Durchsuche deine Notizen …',
  note_read: 'Lese die Notiz …',
  note_create: 'Lege die Notiz an …',
  music_control: 'Steuere die Musik …',
  web_read: 'Lese die Webseite …',
};

const DONE = {
  day_overview: 'Tagesüberblick', todos_list: 'Deine To-dos', todo_add: 'To-do angelegt', todo_update: 'To-do geändert', todo_delete: 'To-do löschen?',
  calendar_events: 'Termine', calendar_is_free: 'Kalender geprüft', calendar_list: 'Deine Kalender', calendar_create_event: 'Termin eingetragen',
  calendar_update_event: 'Termin geändert', calendar_delete_event: 'Termin löschen?', whatsapp_chats: 'WhatsApp', whatsapp_read: 'WhatsApp-Chat',
  whatsapp_suggest: 'WhatsApp – such dir eine Antwort aus', mail_list: 'Posteingang', mail_read: 'Mail', mail_search: 'Suchergebnis', mail_mark: 'Mail markiert',
  mail_move: 'Mail verschoben', mail_suggest_reply: 'Antwort – such dir eine aus', mail_suggest_new: 'Mail – such dir einen Text aus', mail_create_draft: 'Entwurf',
  reminders_list: 'Erinnerungen', reminder_add: 'Erinnerung angelegt', reminder_done: 'Erinnerung abgehakt', contacts_search: 'Kontakte', weather_get: 'Wetter',
  briefing_save: 'Briefing gespeichert', news_headlines: 'Schlagzeilen', shortcuts_list: 'Deine Kurzbefehle', shortcut_run: 'Kurzbefehl starten?', notes_search: 'Notizen',
  note_read: 'Notiz', note_create: 'Notiz angelegt', music_control: 'Musik', web_read: 'Webseite',
};

export const MUTATING = new Set(['todo_add', 'todo_update', 'todo_delete', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event', 'mail_mark', 'mail_move', 'reminder_add', 'reminder_done', 'briefing_save']);

function head(statusClass, label) {
  return h('div', { class: 'card-head' },
    h('span', { class: `status ${statusClass}` }, statusClass === 'ok' ? icon('check') : statusClass === 'fail' ? icon('cross') : statusClass === 'ask' ? icon('lock') : ''),
    h('span', {}, label));
}

export function runningCard(name, id) {
  return h('div', { class: 'card running', dataset: { id } }, head('run', RUNNING[name] || 'Arbeite …'));
}

export function permissionCard(evt) {
  const asking = evt.state === 'asking';
  const ok = evt.state === 'granted';
  return h('div', { class: 'card', dataset: { perm: evt.kind } },
    head(asking ? 'ask' : ok ? 'ok' : 'fail', asking ? `Darf ich auf ${evt.name} zugreifen?` : ok ? `${evt.name} erlaubt` : `${evt.name} nicht erlaubt`),
    h('div', { class: 'card-body tight' }, h('p', { class: 'c-sub' }, asking
      ? 'macOS hat ein kleines Fenster geöffnet – klick dort auf „Erlauben“ bzw. „OK“. Das musst du nur einmal machen.'
      : ok ? 'Danke! Das merkt sich macOS.' : 'Kein Problem. Du kannst es jederzeit unter Einstellungen → Apps erlauben.')));
}

function when(start, end, allDay) {
  if (!start) return '';
  if (allDay || start.length === 10) {
    const last = end && end.slice(0, 10) !== start.slice(0, 10) ? ` bis ${shortDate(end.slice(0, 10))}` : '';
    return `${shortDate(start.slice(0, 10))}, ganztags${last}`;
  }
  const sameDay = end && end.slice(0, 10) === start.slice(0, 10);
  return `${shortDate(start.slice(0, 10))}, ${start.slice(11)}${end ? `–${sameDay ? end.slice(11) : `${shortDate(end.slice(0, 10))} ${end.slice(11)}`}` : ''} Uhr`;
}

function compactWhen(iso) {
  if (!iso) return '–';
  const today = new Date().toLocaleDateString('sv');
  if (iso.slice(0, 10) === today) return iso.slice(11, 16);
  return shortDate(iso.slice(0, 10)).replace(/\s\S+$/, '');
}

function todoMeta(t) {
  const bits = [];
  if (t.faellig) bits.push(shortDate(t.faellig));
  if (t.uhrzeit) bits.push(`${t.uhrzeit} Uhr`);
  if (t.prioritaet === 'hoch') bits.push('wichtig');
  return bits.join(', ');
}

const more = (list, max) => (list.length > max ? h('p', { class: 'c-more' }, `und ${list.length - max} weitere`) : '');
const body = (...c) => h('div', { class: 'card-body' }, ...c);

function eventList(list, max = 6) {
  if (!list?.length) return h('p', { class: 'c-sub' }, 'Keine Termine.');
  return [h('ul', { class: 'c-list' }, list.slice(0, max).map((e) => h('li', {}, h('span', { class: 'k' }, e.ganztaegig ? 'ganzt.' : (e.beginn || '').slice(11)), h('span', { class: 'v' }, e.titel, e.ort ? h('small', {}, e.ort) : '')))), more(list, max)];
}

function mailList(list, max = 5) {
  if (!list?.length) return h('p', { class: 'c-sub' }, 'Keine Mails.');
  return [h('ul', { class: 'c-list' }, list.slice(0, max).map((m) => h('li', {}, h('span', { class: 'k' }, compactWhen(m.date)), h('span', { class: 'v' }, m.from, h('small', {}, m.subject))))), more(list, max)];
}

const RENDER = {
  day_overview(r) {
    const termine = r.termine || [];
    const mails = r.ungelesene_mails?.anzahl ?? null;
    const wa = r.ungelesene_whatsapp?.length ?? null;
    const next = termine.find((e) => !e.ganztaegig && (e.beginn || '') >= (r.jetzt || ''));
    return body(
      h('div', { class: 'c-stats' },
        h('div', {}, h('b', {}, termine.length), h('span', {}, termine.length === 1 ? 'Termin' : 'Termine')),
        h('div', {}, h('b', {}, (r.todos || []).length), h('span', {}, 'To-dos')),
        h('div', {}, h('b', {}, wa ?? mails ?? '–'), h('span', {}, wa !== null ? 'WhatsApp neu' : 'Mails neu'))),
      next ? h('p', { class: 'c-sub' }, `Als Nächstes: ${next.beginn.slice(11)} ${next.titel}`) : '',
      r.wetter ? h('p', { class: 'c-sub' }, `Wetter: ${r.wetter.jetzt}`) : '');
  },
  todos_list(r) {
    const list = r.todos || [];
    if (!list.length) return body(h('p', { class: 'c-sub' }, 'Keine To-dos.'));
    return body(h('ul', { class: 'c-list' }, list.slice(0, 6).map((t) => h('li', {}, h('span', { class: 'k' }, t.erledigt ? '✓' : '○'), h('span', { class: 'v' }, t.titel, todoMeta(t) ? h('small', {}, todoMeta(t)) : '')))), more(list, 6));
  },
  todo_add: (r) => body(h('p', { class: 'c-title' }, r.todo?.titel), h('p', { class: 'c-sub' }, r.schon_vorhanden ? 'Stand schon auf deiner Liste.' : todoMeta(r.todo || {}) || 'Ohne Datum')),
  todo_update: (r) => body(h('p', { class: 'c-title' }, r.todo?.titel), h('p', { class: 'c-sub' }, r.todo?.erledigt ? 'Abgehakt.' : todoMeta(r.todo || {}) || 'Geändert.')),
  calendar_events: (r) => body(eventList(r.termine)),
  calendar_is_free(r, input) {
    return body(
      h('p', { class: `c-big ${r.frei ? 'green' : 'orange'}` }, r.frei ? 'Frei' : 'Schon belegt'),
      h('p', { class: 'c-sub' }, when(input?.start, input?.end || null, false) || ''),
      r.ueberschneidungen?.length ? eventList(r.ueberschneidungen, 3) : '',
      r.ganztaegige_termine_an_dem_tag?.length ? h('p', { class: 'c-more' }, `Ganztags: ${r.ganztaegige_termine_an_dem_tag.map((e) => e.titel).join(', ')}`) : '');
  },
  calendar_list: (r) => body(h('div', { class: 'c-chips' }, (r.kalender || []).map((c) => h('span', {}, c.name)))),
  calendar_create_event(r) {
    const day = (r.start || '').slice(0, 10);
    return body(h('div', { class: 'inline' },
      day ? h('div', { class: 'tile sky', 'aria-hidden': 'true' }, h('b', {}, dateFromIso(day).getUTCDate())) : '',
      h('div', {}, h('p', { class: 'c-title' }, r.title), h('p', { class: 'c-sub' }, when(r.start, r.end, r.allDay)), r.calendar ? h('p', { class: 'c-more' }, `${monthShort(day)} · Kalender: ${r.calendar}`) : '')));
  },
  calendar_update_event: (r) => body(h('p', { class: 'c-title' }, r.title || 'Termin'), r.start ? h('p', { class: 'c-sub' }, when(r.start, r.end, r.allDay)) : ''),
  whatsapp_chats(r) {
    const list = r.chats || [];
    if (!list.length) return body(h('p', { class: 'c-sub' }, 'Keine Chats gefunden.'));
    return body(h('ul', { class: 'c-list' }, list.slice(0, 6).map((c) => h('li', {}, h('span', { class: 'k' }, compactWhen(c.zuletzt)), h('span', { class: 'v' }, c.name, c.ungelesen ? ` · ${c.ungelesen} neu` : '', h('small', {}, c.letzte_nachricht || ''))))), more(list, 6));
  },
  whatsapp_read(r) {
    const list = (r.nachrichten || []).slice(-6);
    return body(h('p', { class: 'c-title' }, r.chat), h('div', { class: 'c-bubbles' }, list.map((m) => h('div', { class: m.von === 'ich' ? 'me' : '' }, m.text, h('small', {}, `${m.von === 'ich' ? 'Du' : m.von} · ${compactWhen(m.zeit)}`)))));
  },
  mail_list: (r) => body(h('p', { class: 'c-sub' }, `${r.gesamt ?? (r.mails || []).length} in ${r.ordner || 'Posteingang'}`), mailList(r.mails)),
  mail_search: (r) => body(h('p', { class: 'c-sub' }, `${r.treffer ?? 0} Treffer`), mailList(r.mails)),
  mail_read(r) {
    const text = String(r.text || '').replace(/\s+/g, ' ').trim();
    return body(h('p', { class: 'c-title' }, r.subject), h('p', { class: 'c-sub' }, `Von ${r.from}`), text ? h('p', { class: 'c-quote' }, text.length > 260 ? `${text.slice(0, 260)} …` : text) : '');
  },
  mail_mark: () => null,
  mail_move: (r) => body(h('p', { class: 'c-sub' }, `Liegt jetzt in ${r.folder}.`)),
  mail_create_draft: (r) => body(h('p', { class: 'c-title' }, r.subject || '(ohne Betreff)'), h('p', { class: 'c-sub' }, `An ${r.to}`), h('p', { class: 'c-more' }, r.hint || 'Der Entwurf wartet auf dich.')),
  reminders_list(r) {
    const list = r.erinnerungen || [];
    if (!list.length) return body(h('p', { class: 'c-sub' }, 'Keine offenen Erinnerungen.'));
    return body(h('ul', { class: 'c-list' }, list.slice(0, 6).map((x) => h('li', {}, h('span', { class: 'k' }, x.faellig ? shortDate(x.faellig).replace(/\s\S+$/, '') : '○'), h('span', { class: 'v' }, x.titel, h('small', {}, x.liste || ''))))), more(list, 6));
  },
  reminder_add: (r) => body(h('p', { class: 'c-title' }, r.erinnerung?.titel), h('p', { class: 'c-sub' }, `In „${r.erinnerung?.liste || 'Erinnerungen'}“${r.erinnerung?.faellig ? `, ${shortDate(r.erinnerung.faellig)}${r.erinnerung.uhrzeit ? ` ${r.erinnerung.uhrzeit}` : ''}` : ''} – auch auf deinem iPhone.`)),
  reminder_done: (r) => body(h('p', { class: 'c-title' }, r.erinnerung?.titel)),
  contacts_search(r) {
    const list = r.kontakte || [];
    if (!list.length) return body(h('p', { class: 'c-sub' }, 'Niemanden gefunden.'));
    return body(h('ul', { class: 'c-list' }, list.slice(0, 4).map((c) => h('li', {}, h('span', { class: 'k' }, '👤'), h('span', { class: 'v' }, c.name, h('small', {}, [...(c.telefon || []), ...(c.mail || [])].slice(0, 3).join(' · ')))))));
  },
  weather_get(r) {
    const now = r.jetzt || {};
    const today = r.heute || {};
    return body(h('div', { class: 'weather-now' }, icon(now.icon), h('span', { class: 'temp' }, `${Math.round(now.temp)}°`),
      h('div', {}, h('p', { class: 'c-title' }, now.text), h('p', { class: 'c-sub' }, `${Math.round(today.min)} bis ${Math.round(today.max)} °C${today.rainChance ? `, Regen ${today.rainChance} %` : ''}${r.ort ? `, ${r.ort}` : ''}`))));
  },
  briefing_save: () => null,
  news_headlines(r) {
    const list = r.schlagzeilen || [];
    return body(h('ul', { class: 'c-list' }, list.slice(0, 5).map((n) => h('li', {}, h('span', { class: 'k' }, '•'), h('span', { class: 'v' }, n.link ? h('a', { href: n.link, target: '_blank', rel: 'noopener' }, n.titel) : n.titel)))), h('p', { class: 'c-more' }, 'Quelle: tagesschau.de'));
  },
  shortcuts_list: (r) => body(h('div', { class: 'c-chips' }, (r.kurzbefehle || []).slice(0, 24).map((n) => h('span', {}, n)))),
  notes_search(r) {
    const list = r.notizen || [];
    if (!list.length) return body(h('p', { class: 'c-sub' }, 'Keine Notizen gefunden.'));
    return body(h('ul', { class: 'c-list' }, list.slice(0, 6).map((n) => h('li', {}, h('span', { class: 'k' }, n.geaendert ? shortDate(n.geaendert).replace(/\s\S+$/, '') : ''), h('span', { class: 'v' }, n.titel)))), more(list, 6));
  },
  note_read: (r) => body(h('p', { class: 'c-title' }, r.titel), h('p', { class: 'c-quote' }, String(r.text || '').slice(0, 300))),
  note_create: (r) => body(h('p', { class: 'c-title' }, r.titel), h('p', { class: 'c-sub' }, 'Liegt in deinen Notizen.')),
  music_control: (r) => body(h('div', { class: 'music' }, h('div', { class: 'art', html: ICONS.music }), h('div', {}, h('p', { class: 'c-title' }, r.titel || 'Musik'), h('p', { class: 'c-sub' }, [r.kuenstler, r.zustand].filter(Boolean).join(' · '))))),
  web_read: (r) => body(h('p', { class: 'c-title' }, r.titel), h('p', { class: 'c-sub' }, r.adresse), h('p', { class: 'c-quote' }, String(r.text || '').slice(0, 220))),
};

// ---------- Vorschläge und Bestätigungen zum Antippen ----------

const KIND_OF_TOOL = { whatsapp_suggest: 'whatsapp', mail_suggest_reply: 'mail', mail_suggest_new: 'mail', todo_delete: 'confirm', calendar_delete_event: 'confirm', mail_move: 'confirm', shortcut_run: 'shortcut' };

const RESULT_TEXT = {
  gesendet: 'Gesendet',
  geoeffnet: 'Geöffnet – bitte dort noch absenden',
  kopiert: 'Text kopiert, WhatsApp ist offen',
  erledigt: 'Erledigt',
  entwurf: 'Als Entwurf gespeichert',
  verworfen: 'Verworfen',
};

export function actionFromResult(part) {
  const r = part.result || {};
  if (!r.karte) return null;
  return {
    id: r.karte,
    kind: KIND_OF_TOOL[part.name] || 'confirm',
    to: r.an || '',
    options: r.vorschlaege || [],
    title: r.frage || DONE[part.name] || 'Bitte bestätigen',
    detail: r.betreff || '',
    status: 'offen',
  };
}

export function actionCard(initial, { onDone } = {}) {
  let a = { ...initial };
  const card = h('div', { class: 'card action', dataset: { action: a.id } });

  const run = async (payload, btn) => {
    card.querySelectorAll('button, textarea').forEach((b) => { b.disabled = true; });
    btn?.classList.add('chosen');
    try {
      const r = await api('POST', `/api/actions/${a.id}`, payload);
      a = r.action;
      render();
      onDone?.(a);
    } catch (err) {
      toast(err.message, 'error');
      try {
        a = (await api('GET', `/api/actions/${a.id}`)).action;
      } catch {
        /* egal */
      }
      render();
    }
  };

  function render() {
    const finished = ['gesendet', 'erledigt', 'verworfen', 'entwurf'].includes(a.status);
    card.classList.toggle('done', finished || a.status === 'geoeffnet' || a.status === 'kopiert');
    const isChoice = a.options?.length > 0;
    const label = a.kind === 'whatsapp' ? `WhatsApp an ${a.to}` : a.kind === 'mail' ? `Mail an ${a.to}` : a.title;
    const headEl = head(finished || a.status === 'geoeffnet' || a.status === 'kopiert' ? 'ok' : 'ask', label);
    const content = [];
    if (a.detail) content.push(h('p', { class: 'c-sub' }, a.detail));
    if (isChoice) {
      content.push(h('div', { class: 'choices' }, a.options.map((text, i) => {
        const chosen = a.chosen === text;
        const b = h('button', { class: `choice${chosen ? ' chosen' : ''}`, type: 'button', disabled: a.status !== 'offen' && !(a.status === 'geoeffnet' || a.status === 'kopiert') ? true : chosen }, h('span', { class: 'n' }, chosen ? icon('check') : String(i + 1)), h('span', {}, text));
        b.addEventListener('click', () => run({ choice: i }, b));
        return b;
      })));
    }
    if (a.status === 'offen') {
      const foot = h('div', { class: 'action-foot' });
      if (isChoice && a.allowEdit !== false) {
        const own = h('button', { class: 'link-btn', type: 'button' }, 'Selbst schreiben');
        own.addEventListener('click', () => {
          const ta = h('textarea', { rows: '2', placeholder: 'Dein Text …', maxlength: '4000' });
          const send = h('button', { class: 'btn btn-small', type: 'button' }, 'Senden');
          send.addEventListener('click', () => ta.value.trim() && run({ text: ta.value.trim() }));
          own.replaceWith(h('div', { class: 'own' }, ta, send));
          ta.focus();
        });
        foot.append(own);
      }
      if (!isChoice) {
        const ok = h('button', { class: `btn btn-small ${a.kind === 'confirm' ? 'btn-danger' : ''}`, type: 'button' }, a.confirmLabel || 'Ja');
        ok.addEventListener('click', () => run({}, ok));
        foot.append(ok);
      }
      const cancel = h('button', { class: 'link-btn', type: 'button' }, isChoice ? 'Verwerfen' : 'Abbrechen');
      cancel.addEventListener('click', async () => {
        try {
          a = (await api('POST', `/api/actions/${a.id}/cancel`)).action;
          render();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      foot.append(cancel);
      if (a.error) content.push(h('p', { class: 'c-error' }, a.error));
      content.push(foot);
    } else if (a.status === 'laeuft') {
      content.push(h('p', { class: 'c-sub' }, 'Einen Moment …'));
    } else {
      const warn = a.status === 'geoeffnet' || a.status === 'kopiert';
      content.push(h('div', { class: `action-result${warn ? ' warn' : ''}` }, icon(warn ? 'external' : a.status === 'verworfen' ? 'cross' : 'check'), RESULT_TEXT[a.status] || a.status));
      if (a.result?.hint) content.push(h('p', { class: 'c-sub' }, a.result.hint));
      if (a.result?.output) content.push(h('p', { class: 'c-quote' }, a.result.output));
    }
    card.replaceChildren(headEl, h('div', { class: 'card-body' }, content));
  }
  render();
  return card;
}

export function resultCard(part, { actions = {}, onDone } = {}) {
  if (part.type === 'permission') return permissionCard(part);
  if (!part.ok) {
    return h('div', { class: 'card' }, head('fail', `${DONE[part.name] || part.title || 'Schritt'} – hat nicht geklappt`), h('div', { class: 'card-body tight' }, h('p', { class: 'c-error' }, part.error || 'Unbekannter Fehler')));
  }
  const fromResult = actionFromResult(part);
  if (fromResult) return actionCard({ ...fromResult, ...(actions[fromResult.id] || {}) }, { onDone });
  let content = null;
  try {
    content = RENDER[part.name]?.(part.result || {}, part.input || {}) ?? null;
  } catch {
    content = null;
  }
  return h('div', { class: 'card', dataset: { tool: part.name } }, head('ok', DONE[part.name] || part.title || 'Erledigt'), content);
}
