// Einrichtung, Verbindungen und Einstellungen.

import { h, ICONS, toast, api, go, copy, shell } from './ui.js';
import { speech, voiceSettings, rankedVoices, germanVoices, ears } from './voice.js';

const root = { replaceChildren: (...n) => document.getElementById('app').replaceChildren(...n) };

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
      h('div', { class: 'app-mark' }, h('span', { class: 'orb', 'aria-hidden': 'true', html: ICONS.mic })),
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

export async function renderSetup(step) {
  if (!STEP_RENDERERS[step]) return go('/einrichtung/willkommen');
  try {
    const page = await STEP_RENDERERS[step](step, false);
    root.replaceChildren(...shell(null, page));
    page.querySelector('input:not([type="checkbox"]), button.btn')?.focus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function renderSingleStep(step) {
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

export async function renderConnections() {
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
      h('div', { class: 'conn-list' },
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
        h('a', { class: 'btn btn-quiet', href: '#/verbindungen/claude-app' }, 'Anleitung')))),
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

export async function renderSettings() {
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
      voiceSection(),
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
          go('/');
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


// ---------------- Stimme ----------------

function voiceSection() {
  const section = h('section', {});
  const fill = () => {
    const voices = rankedVoices();
    const select = h('select', { id: 'voice' },
      h('option', { value: '' }, voices.length ? `Automatisch (${voices[0].name})` : 'Automatisch'),
      voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === voiceSettings.voiceURI }, `${v.name}${v.localService ? '' : ' (online)'}`)));
    select.addEventListener('change', () => {
      voiceSettings.voiceURI = select.value;
      speech.test();
    });
    const slider = (id, label, min, max, step, get, set, fmt) => {
      const out = h('output', { for: id }, fmt(get()));
      const input = h('input', { type: 'range', id, min, max, step, value: String(get()) });
      input.addEventListener('input', () => {
        set(Number(input.value));
        out.textContent = fmt(Number(input.value));
      });
      input.addEventListener('change', () => speech.test());
      return h('div', { class: 'slider-row' }, h('label', { for: id }, label), input, out);
    };
    const mode = h('input', { type: 'checkbox', id: 'mode-voice', checked: voiceSettings.mode === 'stimme' });
    mode.addEventListener('change', () => {
      voiceSettings.mode = mode.checked ? 'stimme' : 'text';
      toast(mode.checked ? 'Der Agent antwortet jetzt auch mit Stimme.' : 'Der Agent antwortet nur noch mit Text.');
    });
    const keep = h('input', { type: 'checkbox', id: 'keep', checked: voiceSettings.keepListening });
    keep.addEventListener('change', () => {
      voiceSettings.keepListening = keep.checked;
    });
    section.replaceChildren(
      h('h2', {}, 'Stimme'),
      !speech.supported ? h('p', { class: 'hint' }, 'Dieser Browser kann nicht vorlesen.') : '',
      h('label', { class: 'check' }, mode, h('span', {}, 'Antworten auch vorlesen')),
      h('label', { class: 'check' }, keep, h('span', {}, 'Wenn ich gesprochen habe: nach der Antwort automatisch wieder zuhören')),
      h('div', { class: 'field' }, h('label', { for: 'voice' }, 'Stimme'), select),
      slider('rate', 'Tempo', '0.7', '1.2', '0.02', () => voiceSettings.rate, (v) => { voiceSettings.rate = v; }, (v) => `${Math.round(v * 100)} %`),
      slider('pitch', 'Tonhöhe', '0.5', '1.2', '0.02', () => voiceSettings.pitch, (v) => { voiceSettings.pitch = v; }, (v) => (v < 0.9 ? 'tief' : v > 1.05 ? 'hoch' : 'normal')),
      h('div', { class: 'inline' }, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => speech.test() }, 'Probe hören')),
      h('p', { class: 'hint' }, germanVoices().length ? 'Die Stimmen kommen von deinem Gerät. Bessere, tiefere Stimmen kannst du nachladen – am Mac unter Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte → Systemstimme, am iPhone unter Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen → Deutsch. Danach die Seite neu laden.' : 'Auf diesem Gerät habe ich keine deutsche Stimme gefunden. Am Mac kannst du eine unter Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte → Systemstimme nachladen.'),
      h('p', { class: 'hint' }, ears.problem() || 'Sprechen: Im Dashboard auf die orange Kugel tippen. Beim ersten Mal fragt der Browser nach dem Mikrofon.'),
      h('p', { class: 'hint' }, 'Diese Einstellungen gelten nur für dieses Gerät.'));
  };
  fill();
  if (speech.supported && !germanVoices().length) window.speechSynthesis.addEventListener?.('voiceschanged', fill, { once: true });
  return section;
}
