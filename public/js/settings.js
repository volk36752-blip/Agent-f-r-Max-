// Einstellungen: Apps (ohne Passwörter), Plugins, Startseite, Gehirn, Stimme, Tagesplan, Mac, Erweitert.
// Dazu die kurze Einrichtung beim ersten Öffnen.

import { h, ICONS, icon, toast, api, go, shell, switchInput } from './ui.js';
import { isMacApp, nativeCall } from './voice.js';
import { permissionList } from './permissions.js';
import { voiceSection } from './setup.js';

const root = () => document.getElementById('app');

const TABS = [
  ['apps', 'Apps', 'grid'],
  ['plugins', 'Plugins', 'puzzle'],
  ['startseite', 'Startseite', 'home'],
  ['gehirn', 'Gehirn', 'brain'],
  ['stimme', 'Stimme', 'speaker'],
  ['tagesplan', 'Tagesplan', 'sunrise'],
  ['mac', 'Mac', 'laptop'],
  ['erweitert', 'Erweitert', 'gear'],
];

const PERM_CHIP = {
  granted: ['ok', 'Erlaubt'],
  unknown: ['ask', 'Fragt beim ersten Mal'],
  denied: ['bad', 'Nicht erlaubt'],
  offline: ['off', 'Nur in der Mac-App'],
  notInstalled: ['off', 'Nicht installiert'],
  unavailable: ['off', 'Geht hier nicht'],
  none: ['ok', 'Immer dabei'],
};
const SETTINGS_KIND = { kalender: 'calendar', erinnerungen: 'reminders', kontakte: 'contacts', mail: 'automation', whatsapp: 'appdata' };
const APP_COLOR = { kalender: 'sky', todos: 'orange', whatsapp: 'green', mail: 'sky', erinnerungen: 'orange', kontakte: 'green', wetter: 'amber' };

function chip(state) {
  const [cls, label] = PERM_CHIP[state] || ['off', state];
  return h('span', { class: `chip ${cls}` }, cls === 'ok' ? icon('check') : '', label);
}

function frame(tab, ...content) {
  return h('main', { class: 'page' },
    h('h1', {}, 'Einstellungen'),
    h('div', { class: 'settings' },
      h('nav', { class: 'settings-nav', 'aria-label': 'Bereiche' }, TABS.map(([id, label, ic]) => h('a', { href: `#/einstellungen/${id}`, 'aria-current': tab === id ? 'page' : null }, h('span', { html: ICONS[ic] }), h('span', {}, label)))),
      h('div', { class: 'settings-main' }, ...content)));
}

export async function renderSettings(tab = 'apps') {
  if (!TABS.some(([id]) => id === tab)) return go('/einstellungen/apps');
  const main = h('div', { class: 'settings-main' }, h('p', { class: 'hint' }, 'Lade …'));
  root().replaceChildren(...shell('/einstellungen', frame(tab, main)));
  try {
    const content = await PAGES[tab]();
    main.replaceWith(h('div', { class: 'settings-main' }, ...[].concat(content)));
  } catch (err) {
    main.replaceChildren(h('p', { class: 'c-error' }, err.message));
  }
}

const rerender = (tab) => renderSettings(tab);

// ---------------------------------------------------------------- Apps

async function allow(id, btn, tab = 'apps') {
  btn.disabled = true;
  btn.textContent = 'Frage macOS …';
  try {
    const r = await api('POST', `/api/apps/${id}/allow`);
    toast(r.status === 'granted' ? 'Erlaubt.' : 'Nicht erlaubt – du kannst es jederzeit wieder versuchen.', r.status === 'granted' ? 'ok' : 'error');
  } catch (err) {
    toast(err.message, 'error');
  }
  rerender(tab);
}

const openSystemSettings = (kind) => nativeCall('openSettings', { kind }, 5000).catch(() => toast('Öffne die Systemeinstellungen → Datenschutz & Sicherheit.'));

function appRow(a, mac) {
  const setEnabled = async (on) => {
    try {
      await api('PUT', `/api/apps/${a.id}`, { enabled: on });
      toast(on ? `${a.name} ist an.` : `${a.name} ist aus – der Agent greift nicht mehr darauf zu.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const side = h('div', { class: 'side' });
  if (a.permission === 'unknown' && a.enabled) side.append(h('button', { class: 'btn btn-small', type: 'button', onclick: (e) => allow(a.id, e.currentTarget) }, 'Jetzt erlauben'));
  if (a.permission === 'denied' && isMacApp) side.append(h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => openSystemSettings(SETTINGS_KIND[a.id]) }, 'Systemeinstellungen'));
  side.append(switchInput(a.enabled, setEnabled, { label: `${a.name} für den Agenten` }));
  const extra = h('div', { class: 'extra' });
  if (a.id === 'whatsapp' && a.permission !== 'offline') {
    const ax = a.accessibility === 'granted';
    extra.append(
      opt('Selbst auf „Senden“ drücken', ax ? 'Wenn du einen Vorschlag antippst, schickt der Assistent ihn ganz ab.' : 'Dafür braucht der Assistent die Bedienungshilfen (einmal in den Systemeinstellungen einschalten). Ohne drückst du in WhatsApp nur noch Enter.',
        switchInput(Boolean(a.options.autoSend), async (on, input) => {
          if (on && !ax && isMacApp) {
            await nativeCall('requestPermission', { kind: 'accessibility' }, 120000).catch(() => {});
            toast('Schalte in den Systemeinstellungen bei „Bedienungshilfen“ den Assistenten ein.');
          }
          await api('PUT', '/api/apps/whatsapp', { autoSend: on }).catch((err) => {
            toast(err.message, 'error');
            input.checked = !on;
          });
        })),
      opt('To-do, wenn mich jemand etwas fragt', 'Fragt dich jemand „Hast du heute Zeit?“, landet ein To-do auf deiner Liste und du bekommst eine Mitteilung.',
        switchInput(a.options.askTodos !== false, (on) => api('PUT', '/api/apps/whatsapp', { askTodos: on }).catch((err) => toast(err.message, 'error')))));
  }
  if (a.id === 'kalender' && (a.permission === 'granted' || !mac)) extra.append(calendarPicker());
  if (a.id === 'wetter') extra.append(weatherPicker());
  return h('div', { class: 'app-row' },
    h('span', { class: `tile ${APP_COLOR[a.id] || 'orange'}`, html: ICONS[a.icon] || ICONS.grid }),
    h('div', { class: 'info' }, h('div', { class: 'name' }, a.name, chip(a.permission)), h('p', { class: 'text' }, a.text)),
    side,
    extra);
}

function opt(title, text, control) {
  return h('div', { class: 'opt' }, h('div', { class: 't' }, h('span', {}, title), h('small', {}, text)), control);
}

function calendarPicker() {
  const box = h('div', { class: 'stack-tight' }, h('p', { class: 'hint' }, 'Lade Kalender …'));
  api('GET', '/api/calendars').then((data) => {
    const checks = data.calendars.map((c) => {
      const input = h('input', { type: 'checkbox', checked: c.selected });
      const label = h('label', { class: 'check' }, input, h('span', {}, c.name, c.readOnly ? h('span', { class: 'muted' }, ' · nur lesen') : '', c.account ? h('span', { class: 'muted' }, ` · ${c.account}`) : ''));
      if (c.color) input.style.setProperty('accent-color', c.color);
      return { input, label, c };
    });
    const def = h('select', { 'aria-label': 'Neue Termine landen in' }, h('option', { value: '' }, 'Automatisch'), data.calendars.filter((c) => !c.readOnly).map((c) => h('option', { value: c.id, selected: c.id === data.defaultCalendar }, c.name)));
    const save = async () => {
      try {
        await api('PUT', '/api/calendars', { selected: checks.filter((x) => x.input.checked).map((x) => x.c.id), defaultCalendar: def.value || null });
        toast('Gespeichert.');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    checks.forEach((x) => x.input.addEventListener('change', save));
    def.addEventListener('change', save);
    box.replaceChildren(h('span', { class: 'hint' }, 'Welche Kalender der Assistent zeigt:'), ...checks.map((x) => x.label), h('div', { class: 'field' }, h('label', {}, 'Neue Termine landen in'), def));
  }).catch((err) => {
    box.replaceChildren(h('p', { class: 'hint' }, err.status === 409 || err.status === 403 ? 'Sobald der Kalender erlaubt ist, kannst du hier auswählen, welche Kalender angezeigt werden.' : err.message));
  });
  return box;
}

function weatherPicker() {
  const q = h('input', { type: 'search', placeholder: 'Ort suchen, z. B. Stuttgart', autocomplete: 'off', 'aria-label': 'Ort' });
  const results = h('ul', { class: 'places', 'aria-live': 'polite' });
  const current = h('p', { class: 'hint' });
  api('GET', '/api/connections').then((c) => {
    current.textContent = c.weather.enabled ? `Eingestellt: ${c.weather.name}${c.weather.region ? ` (${c.weather.region})` : ''}` : 'Noch kein Ort eingestellt.';
  }).catch(() => {});
  const pick = async (p) => {
    try {
      await api('PUT', '/api/connections/weather', p);
      toast(`Wetter für ${p.name} eingestellt.`);
      current.textContent = `Eingestellt: ${p.name}${p.region ? ` (${p.region})` : ''}`;
      results.replaceChildren();
      q.value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  let timer;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (q.value.trim().length < 2) return results.replaceChildren();
      try {
        const { places } = await api('GET', `/api/weather/places?q=${encodeURIComponent(q.value.trim())}`);
        results.replaceChildren(...(places.length ? places.slice(0, 6).map((p) => h('li', {}, h('button', { type: 'button', onclick: () => pick(p) }, p.name, h('small', {}, p.region)))) : [h('li', { class: 'hint' }, 'Nichts gefunden.')]));
      } catch (err) {
        toast(err.message, 'error');
      }
    }, 300);
  });
  const here = isMacApp ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async (e) => {
    e.currentTarget.disabled = true;
    try {
      const m = await nativeCall('requestPermission', { kind: 'location' }, 60000);
      if (Number.isFinite(m.latitude)) await pick({ name: m.name || 'Mein Standort', region: m.region || '', latitude: m.latitude, longitude: m.longitude });
      else toast(m.error || 'Ich konnte deinen Ort nicht bestimmen.', 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
    e.currentTarget.disabled = false;
  } }, icon('pin'), 'Meinen Standort nehmen') : '';
  return h('div', { class: 'stack-tight' }, current, h('div', { class: 'inline' }, q, here), results);
}

const PAGES = {
  async apps() {
    const data = await api('GET', '/api/apps');
    return [
      h('h2', {}, 'Apps'),
      h('p', { class: 'lead' }, data.mac
        ? 'Der Assistent nimmt alles direkt von deinem Mac – ohne Passwörter. Beim ersten Zugriff fragt macOS dich mit einem kleinen Fenster, ein Klick auf „Erlauben“ genügt. Mit dem Schalter nimmst du dem Agenten eine App jederzeit wieder weg.'
        : 'Kalender, Mail, WhatsApp, Erinnerungen und Kontakte ohne Passwort gibt es nur in der Mac-App „Assistent“. Im Browser geht Kalender und Mail über iCloud (unter „Erweitert“).'),
      ...data.apps.map((a) => appRow(a, data.mac)),
      h('p', { class: 'hint' }, 'Sicher: Senden, Löschen und Kurzbefehle passieren nur, wenn du eine Karte antippst. Alles bleibt auf deinem Mac.'),
    ];
  },

  async plugins() {
    const data = await api('GET', '/api/plugins');
    const card = (p) => {
      const btn = h('button', { class: `btn btn-small ${p.enabled ? 'btn-quiet' : ''}`, type: 'button', disabled: !p.enabled && !p.available }, p.enabled ? 'Entfernen' : 'Hinzufügen');
      btn.addEventListener('click', async () => {
        try {
          await api('PUT', `/api/plugins/${p.id}`, { enabled: !p.enabled });
          toast(p.enabled ? `${p.name} entfernt.` : `${p.name} hinzugefügt.`);
          rerender('plugins');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      return h('article', { class: `plugin${p.enabled ? ' on' : ''}` },
        h('div', { class: 'top' }, h('span', { class: `tile ${p.color}`, html: ICONS[p.icon] || ICONS.puzzle }), h('h3', {}, p.name), h('span', { class: 'spacer' }), p.enabled ? h('span', { class: 'chip ok' }, icon('check'), 'Aktiv') : ''),
        h('p', {}, p.description),
        p.examples.length ? h('p', { class: 'ex' }, `„${p.examples[0]}“`) : '',
        h('div', { class: 'inline' }, btn, p.widget ? h('span', { class: 'chip' }, 'mit Widget') : '', p.needsMac ? h('span', { class: 'chip off' }, 'nur Mac-App') : ''));
    };
    return [
      h('h2', {}, 'Plugins'),
      h('p', { class: 'lead' }, 'Zusätzliche Fähigkeiten für deinen Assistenten. Füg nur hinzu, was du brauchst – entfernen geht jederzeit.'),
      h('div', { class: 'plugin-grid' }, data.plugins.map(card)),
    ];
  },

  async startseite() {
    const data = await api('GET', '/api/widgets');
    let widgets = data.widgets;
    const ul = h('ul', { class: 'widget-order' });
    const save = async () => {
      try {
        widgets = (await api('PUT', '/api/widgets', { widgets: widgets.map((w) => ({ id: w.id, on: w.on })) })).widgets;
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const draw = () => ul.replaceChildren(...widgets.map((w, i) => h('li', {},
      h('span', { class: `tile ${w.color || 'orange'}`, html: ICONS[w.icon] || ICONS.grid }),
      h('span', { class: 'name' }, w.title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${w.title} nach oben`, html: ICONS.up, disabled: i === 0, onclick: async () => { [widgets[i - 1], widgets[i]] = [widgets[i], widgets[i - 1]]; draw(); await save(); } }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${w.title} nach unten`, html: ICONS.down, disabled: i === widgets.length - 1, onclick: async () => { [widgets[i + 1], widgets[i]] = [widgets[i], widgets[i + 1]]; draw(); await save(); } }),
      switchInput(w.on, async (on) => { w.on = on; await save(); }, { label: `${w.title} zeigen` }))));
    draw();
    return [h('h2', {}, 'Startseite'), h('p', { class: 'lead' }, 'Welche Widgets du siehst und in welcher Reihenfolge. Plugins mit Widget tauchen hier auf, sobald du sie hinzufügst.'), ul];
  },

  async gehirn() {
    const b = await api('GET', '/api/brain');
    const option = (mode, title, text, statusEl) => h('button', { class: 'brain-opt', type: 'button', 'aria-pressed': b.mode === mode ? 'true' : 'false', onclick: async () => {
      try {
        await api('PUT', '/api/brain', { mode });
        rerender('gehirn');
      } catch (err) {
        toast(err.message, 'error');
      }
    } }, h('span', { class: `tile ${mode === 'apple' ? 'green' : mode === 'claude' ? 'orange' : 'sky'}`, html: mode === 'auto' ? ICONS.refresh : ICONS.brain }), h('span', { class: 't' }, h('span', {}, title), h('small', {}, text)), statusEl || '');
    const appleStatus = b.apple.available ? h('span', { class: 'chip ok' }, icon('check'), 'Bereit') : h('span', { class: 'chip off' }, 'nicht verfügbar');
    const claudeStatus = b.claude.available ? h('span', { class: 'chip ok' }, icon('check'), 'Bereit') : h('span', { class: 'chip off' }, 'kein Schlüssel');
    const key = h('input', { type: 'password', autocomplete: 'off', placeholder: b.hasKey ? 'Gespeichert – leer lassen zum Behalten' : 'sk-ant-…', 'aria-label': 'Claude-API-Schlüssel' });
    const model = h('select', { 'aria-label': 'Modell' }, b.models.map((m) => h('option', { value: m.id, selected: m.id === b.claude.model }, `${m.label} – ${m.hint}`)));
    const saveKey = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('PUT', '/api/connections/claude', { apiKey: key.value, model: model.value });
        toast('Claude ist verbunden.');
        rerender('gehirn');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    };
    return [
      h('h2', {}, 'Gehirn'),
      h('p', { class: 'lead' }, 'Womit der Assistent denkt. Aktiv ist gerade: ', h('strong', {}, b.active === 'apple' ? 'Apple Intelligence' : b.active === 'claude' ? 'Claude' : 'nichts'), b.active ? '.' : ' – ohne Gehirn zeige ich nur deinen Überblick.'),
      h('div', { class: 'brain-opts' },
        option('auto', 'Automatisch', 'Claude, wenn ein Schlüssel da ist – sonst Apple Intelligence.'),
        option('apple', 'Apple Intelligence', b.apple.available ? 'Direkt auf deinem Mac: kostenlos, ohne Anmeldung, privat.' : b.reasons[b.apple.reason] || 'Gerade nicht verfügbar.', appleStatus),
        option('claude', 'Claude', 'Am schlauesten für schwierige Aufgaben. Braucht einen API-Schlüssel und kostet pro Nutzung ein paar Cent.', claudeStatus)),
      h('section', { class: 'panel' },
        h('h3', {}, 'Claude (optional)'),
        h('p', { class: 'hint' }, 'Den Schlüssel bekommst du unter ', h('a', { href: 'https://platform.claude.com/settings/keys', target: '_blank', rel: 'noopener' }, 'platform.claude.com/settings/keys'), ' → „Create key“. Vorher unter „Billing“ etwas Guthaben kaufen.'),
        h('div', { class: 'row-2' }, h('div', { class: 'field' }, h('label', {}, 'API-Schlüssel'), key), h('div', { class: 'field' }, h('label', {}, 'Modell'), model)),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-small', type: 'button', onclick: saveKey }, 'Speichern'),
          b.hasKey ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async () => {
            await api('DELETE', '/api/connections/claude').catch(() => {});
            toast('Schlüssel entfernt.');
            rerender('gehirn');
          } }, 'Schlüssel entfernen') : '')),
    ];
  },

  async stimme() {
    const sec = voiceSection();
    return [h('h2', {}, 'Stimme'), h('p', { class: 'lead' }, 'Unten in der Leiste schaltest du mit dem Lautsprecher zwischen „Nur Text“ und „Text + Stimme“ um. Hier stellst du die Stimme ein.'), h('section', { class: 'panel' }, ...sec.childNodes)];
  },

  async tagesplan() {
    const s = await api('GET', '/api/settings');
    const time = h('input', { type: 'time', value: s.planTime, 'aria-label': 'Frühestens um' });
    const save = async (patch) => {
      try {
        await api('PUT', '/api/settings', patch);
        toast('Gespeichert.');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    time.addEventListener('change', () => save({ planTime: time.value }));
    return [
      h('h2', {}, 'Tagesplan'),
      h('p', { class: 'lead' }, 'Jeden Morgen schaut der Assistent in Kalender, Mails und WhatsApp, legt To-dos an und schreibt dir ein kurzes Briefing.'),
      h('section', { class: 'panel' },
        opt('Tagesplan jeden Morgen', 'Kommt frühestens zur eingestellten Zeit – oder sobald dein Mac an ist.', switchInput(s.planEnabled, (on) => save({ planEnabled: on }))),
        h('div', { class: 'inline' }, h('label', {}, 'Frühestens um'), time),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api('POST', '/api/plan/run');
            toast('Dein Tagesplan ist fertig.');
          } catch (err) {
            toast(err.message, 'error');
          }
          e.currentTarget.disabled = false;
        } }, 'Jetzt planen'))),
    ];
  },

  async mac() {
    const perms = await permissionList();
    return [
      h('h2', {}, 'Mac'),
      h('p', { class: 'lead' }, isMacApp ? 'Mikrofon, Mitteilungen, Standort, Dock und ob der Assistent morgens von selbst startet.' : 'Diese Einstellungen gibt es in der Mac-App.'),
      perms.el,
      isMacApp ? h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => nativeCall('showDataFolder', {}, 5000).catch(() => {}) }, icon('folder'), 'Datenordner zeigen')) : '',
    ];
  },

  async erweitert() {
    const [s, status, conn] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/status'), api('GET', '/api/connections')]);
    const tz = h('input', { type: 'text', value: s.timezone, autocomplete: 'off', 'aria-label': 'Zeitzone' });
    const lanInfo = h('p', { class: 'hint' }, s.lanUrls.length ? ['Auf dem iPhone in Safari öffnen (gleiches WLAN): ', ...s.lanUrls.map((u, i) => [i ? ' oder ' : '', h('a', { href: u }, u)])] : 'Nur auf diesem Mac erreichbar.');
    const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', 'aria-label': 'Neues Passwort' });
    const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Aktuelles Passwort' });
    const ic = conn.status;
    return [
      h('h2', {}, 'Erweitert'),
      h('section', { class: 'panel' },
        h('h3', {}, 'Ohne Mac-App: iCloud mit Passwort'),
        h('p', { class: 'hint' }, 'Nur nötig, wenn du den Assistenten im Browser oder auf einem Server benutzt. In der Mac-App geht alles ohne Passwort.'),
        h('div', { class: 'row-actions' },
          h('a', { class: 'btn btn-quiet btn-small', href: '#/verbindungen/kalender' }, `iCloud-Kalender${ic.icloud.calendar ? ' ✓' : ''}`),
          h('a', { class: 'btn btn-quiet btn-small', href: '#/verbindungen/mail' }, `iCloud-Mail${ic.icloud.mail ? ' ✓' : ''}`),
          ic.icloud.calendar || ic.icloud.mail ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async () => {
            await api('DELETE', '/api/connections/icloud').catch(() => {});
            toast('iCloud getrennt.');
            rerender('erweitert');
          } }, 'iCloud trennen') : '')),
      h('section', { class: 'panel' },
        h('h3', {}, 'In der Claude-App benutzen'),
        h('p', { class: 'hint' }, 'Mit dem Connector kann Claude (Desktop-App) direkt mit deinem Assistenten arbeiten – mit deinem Claude-Abo.'),
        h('div', { class: 'row-actions' }, h('a', { class: 'btn btn-quiet btn-small', href: '#/verbindungen/claude-app' }, 'Connector einrichten'))),
      h('section', { class: 'panel' },
        opt('Im WLAN freigeben', 'Damit du die Startseite auch auf iPhone und iPad öffnen kannst (ohne Kalender & Co. vom Mac).', switchInput(s.lanAccess, async (on) => {
          await api('PUT', '/api/settings', { lanAccess: on }).catch((err) => toast(err.message, 'error'));
          setTimeout(() => rerender('erweitert'), 900);
        }, { disabled: s.hostOverride })),
        lanInfo),
      h('section', { class: 'panel' },
        h('h3', {}, status.hasPassword ? 'Passwort ändern' : 'Passwort für Safari und iPhone'),
        h('p', { class: 'hint' }, status.hasPassword ? 'Nach dem Ändern sind andere Geräte abgemeldet.' : 'In der Mac-App brauchst du keins. Für Safari oder das iPhone leg hier eins fest.'),
        h('div', { class: 'row-2' }, status.hasPassword ? h('div', { class: 'field' }, h('label', {}, 'Aktuelles Passwort'), cur) : '', h('div', { class: 'field' }, h('label', {}, 'Neues Passwort'), pw)),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async () => {
          try {
            if (status.hasPassword) await api('POST', '/api/password', { current: cur.value, next: pw.value });
            else await api('POST', '/api/setup/password', { password: pw.value });
            toast('Passwort gespeichert.');
            rerender('erweitert');
          } catch (err) {
            toast(err.message, 'error');
          }
        } }, 'Speichern'))),
      h('section', { class: 'panel' },
        h('h3', {}, 'Zeitzone'),
        h('div', { class: 'inline' }, tz, h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => api('PUT', '/api/settings', { timezone: tz.value.trim() }).then(() => toast('Gespeichert.')).catch((err) => toast(err.message, 'error')) }, 'Speichern'))),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => go('/einrichtung') }, 'Einrichtung nochmal'),
        !isMacApp ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async () => { await api('POST', '/api/logout').catch(() => {}); go('/'); } }, 'Abmelden') : ''),
    ];
  },
};

// ---------------------------------------------------------------- Einrichtung (kurz)

const STEPS = ['hallo', 'mac', 'apps', 'fertig'];

export async function renderOnboarding(step = 'hallo') {
  if (!STEPS.includes(step)) step = 'hallo';
  if (step === 'mac' && !isMacApp) step = 'apps';
  const idx = STEPS.indexOf(step);
  const next = () => go(`/einrichtung/${STEPS[idx + 1]}`);
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, STEPS.map((s, i) => h('i', { class: i <= idx ? 'on' : '' })));
  let content;
  if (step === 'hallo') {
    content = [
      h('button', { class: 'orb big', type: 'button', tabindex: '-1', 'aria-hidden': 'true', html: ICONS.mic }),
      h('h1', {}, 'Hallo! Ich bin dein Assistent.'),
      h('p', { class: 'lead' }, 'Ich kümmere mich um deine Termine, To-dos, Mails und WhatsApp – direkt auf deinem Mac, ohne Passwörter. Bevor ich zum ersten Mal auf eine App zugreife, fragt macOS dich mit einem kleinen Fenster. Ein Klick auf „Erlauben“ genügt.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: next }, 'Los geht’s')),
    ];
  } else if (step === 'mac') {
    const perms = await permissionList();
    const primary = h('button', { class: 'btn', type: 'button' }, perms.pending() ? 'Alle erlauben' : 'Weiter');
    primary.addEventListener('click', async () => {
      if (!perms.pending() || primary.dataset.done) return next();
      primary.disabled = true;
      primary.textContent = 'Frage nach …';
      await perms.allowAll();
      primary.disabled = false;
      primary.dataset.done = '1';
      primary.textContent = 'Weiter';
    });
    content = [
      h('h1', {}, 'Was darf ich auf deinem Mac?'),
      h('p', { class: 'lead' }, 'Für jede Erlaubnis zeigt macOS ein kleines Fenster – dort auf „Erlauben“ bzw. „OK“ klicken. Alles kannst du später unter Einstellungen → Mac ändern.'),
      perms.el,
      h('div', { class: 'actions' }, primary, h('button', { class: 'btn btn-quiet', type: 'button', onclick: next }, 'Überspringen')),
    ];
  } else if (step === 'apps') {
    const data = await api('GET', '/api/apps');
    const rows = data.apps.filter((a) => a.permission !== 'none').map((a) => h('div', { class: 'app-row' },
      h('span', { class: `tile ${APP_COLOR[a.id] || 'orange'}`, html: ICONS[a.icon] || ICONS.grid }),
      h('div', { class: 'info' }, h('div', { class: 'name' }, a.name, chip(a.permission)), h('p', { class: 'text' }, a.text)),
      h('div', { class: 'side' }, a.permission === 'unknown' ? h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Frage macOS …';
        try {
          await api('POST', `/api/apps/${a.id}/allow`);
        } catch (err) {
          toast(err.message, 'error');
        }
        renderOnboarding('apps');
      } }, 'Jetzt erlauben') : '')));
    content = [
      h('h1', {}, 'Deine Apps'),
      h('p', { class: 'lead' }, data.mac
        ? 'Du kannst jetzt schon erlauben – oder einfach loslegen: Beim ersten Mal, wenn ich eine App brauche, fragt macOS dich automatisch.'
        : 'Diese Apps gibt es ohne Passwort in der Mac-App „Assistent“.'),
      ...rows,
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: next }, 'Weiter')),
    ];
  } else {
    const b = await api('GET', '/api/brain');
    content = [
      h('h1', {}, 'Fertig!'),
      h('p', { class: 'lead' }, b.active === 'apple' ? 'Ich denke mit Apple Intelligence – direkt auf deinem Mac, ohne Anmeldung.' : b.active === 'claude' ? 'Ich denke mit Claude.' : `Für richtige Antworten brauche ich noch ein Gehirn. ${b.reasons[b.apple.reason] || ''} Bis dahin zeige ich dir deinen Überblick – und unter Einstellungen → Gehirn kannst du Claude dazunehmen.`),
      h('p', { class: 'lead' }, 'Unten auf der Startseite tippst du auf die orange Kugel und sprichst – oder schreibst. Mit dem Lautsprecher daneben stellst du ein, ob ich auch laut antworte.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
        await api('POST', '/api/setup/finish').catch(() => {});
        go('/');
      } }, 'Zur Startseite')),
    ];
  }
  root().replaceChildren(...shell(null, h('main', { class: 'onboard' }, dots, ...content)));
}

