// Berechtigungen: Mikrofon, Mitteilungen, Standort, Dock und Hintergrund.
// In der Mac-App fragt macOS selbst nach, im Browser fragt der Browser.

import { h, ICONS, toast, api, shell } from './ui.js';
import { isMacApp, nativeCall } from './voice.js';

const ITEMS = [
  {
    id: 'mikrofon',
    icon: 'mic',
    title: 'Mikrofon und Spracherkennung',
    text: 'Damit du mit mir sprechen kannst. Ich höre nur zu, wenn du auf die orange Kugel tippst.',
    kinds: ['microphone', 'speech'],
    settings: 'microphone',
  },
  {
    id: 'mitteilungen',
    icon: 'bell',
    title: 'Mitteilungen',
    text: 'Damit ich dir morgens Bescheid sage, sobald dein Tagesplan fertig ist.',
    kinds: ['notifications'],
    settings: 'notifications',
    macOnly: true,
  },
  {
    id: 'standort',
    icon: 'pin',
    title: 'Standort',
    text: 'Damit ich das Wetter für deinen Ort zeige. Ich merke mir nur die Stadt.',
    kinds: ['location'],
    settings: 'location',
  },
  {
    id: 'dock',
    icon: 'dock',
    title: 'Im Dock behalten',
    text: 'Damit du mich immer mit einem Klick findest.',
    kinds: ['dock'],
    macOnly: true,
    granted: 'Liegt im Dock',
    off: 'Noch nicht im Dock',
    ask: 'Ins Dock legen',
  },
  {
    id: 'hintergrund',
    icon: 'sunrise',
    title: 'Morgens von selbst starten',
    text: 'Ich starte beim Anmelden leise im Hintergrund, damit dein Tagesplan ab 6 Uhr fertig ist – auch wenn das Fenster zu ist. Oben in der Menüleiste siehst du mich dann als orangen Punkt.',
    kinds: ['background'],
    macOnly: true,
    granted: 'An',
    off: 'Aus',
    ask: 'Einschalten',
    canTurnOff: true,
  },
];

// ---------- Status abfragen ----------

async function webStatus(kind) {
  const name = kind === 'microphone' ? 'microphone' : kind === 'location' ? 'geolocation' : null;
  if (!name) return 'unavailable';
  if (kind === 'microphone' && !(window.isSecureContext && navigator.mediaDevices?.getUserMedia)) return 'unavailable';
  if (kind === 'location' && !(window.isSecureContext && navigator.geolocation)) return 'unavailable';
  try {
    const r = await navigator.permissions.query({ name });
    return r.state === 'granted' ? 'granted' : r.state === 'denied' ? 'denied' : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function statuses() {
  if (isMacApp) {
    const m = await nativeCall('permissions', {}, 10000);
    return m.status || {};
  }
  const out = {};
  for (const kind of ['microphone', 'location']) out[kind] = await webStatus(kind);
  out.speech = out.microphone;
  return out;
}

function combined(item, st) {
  const list = item.kinds.map((k) => st[k] || 'unknown');
  if (list.every((s) => s === 'granted')) return 'granted';
  if (list.some((s) => s === 'unavailable')) return 'unavailable';
  if (list.some((s) => s === 'denied')) return 'denied';
  return 'unknown';
}

// ---------- Nachfragen ----------

async function saveWeather(place) {
  await api('PUT', '/api/connections/weather', place);
  toast(`Wetter für ${place.name} eingestellt.`);
}

async function requestKind(kind) {
  if (isMacApp) {
    const m = await nativeCall('requestPermission', { kind }, kind === 'location' ? 60000 : 180000);
    if (kind === 'location' && Number.isFinite(m.latitude) && Number.isFinite(m.longitude)) {
      await saveWeather({ name: m.name || 'Mein Standort', region: m.region || '', latitude: m.latitude, longitude: m.longitude }).catch((err) => toast(err.message, 'error'));
    } else if (kind === 'location' && m.error) toast(m.error, 'error');
    if (kind === 'background' && m.status !== 'granted') toast('Das geht erst, wenn die App im Ordner „Programme“ liegt.', 'error');
    if (kind === 'dock' && m.status !== 'granted') toast('Das geht erst, wenn die App im Ordner „Programme“ liegt.', 'error');
    return m.status;
  }
  if (kind === 'microphone' || kind === 'speech') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return 'granted';
    } catch (err) {
      return err?.name === 'NotAllowedError' ? 'denied' : 'unavailable';
    }
  }
  if (kind === 'location') {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        await saveWeather({ name: 'Mein Standort', region: '', latitude: Number(pos.coords.latitude.toFixed(3)), longitude: Number(pos.coords.longitude.toFixed(3)) }).catch((err) => toast(err.message, 'error'));
        resolve('granted');
      }, (err) => resolve(err?.code === 1 ? 'denied' : 'unknown'), { timeout: 20000, maximumAge: 3600000 });
    });
  }
  return 'unavailable';
}

async function requestItem(item) {
  let result = 'granted';
  for (const kind of item.kinds) {
    result = await requestKind(kind);
    if (result !== 'granted') break;
  }
  return result;
}

// ---------- Darstellung ----------

const LABEL = {
  granted: 'Erlaubt',
  denied: 'Nicht erlaubt',
  unknown: 'Noch nicht gefragt',
  unavailable: 'Geht hier leider nicht',
};

export async function permissionList() {
  const items = ITEMS.filter((i) => isMacApp || !i.macOnly);
  const list = h('div', { class: 'conn-list perm-list' });
  let st = {};
  let busy = false;

  const render = () => {
    const visible = items.filter((i) => combined(i, st) !== 'unavailable' || i.id === 'mikrofon');
    list.replaceChildren(...visible.map((item) => {
      const state = combined(item, st);
      const buttons = [];
      if (state === 'unknown') {
        buttons.push(h('button', { class: 'btn btn-quiet', type: 'button', disabled: busy, onclick: () => run([item]) }, item.ask || 'Erlauben'));
      } else if (state === 'denied' && isMacApp && item.settings) {
        buttons.push(h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => nativeCall('openSettings', { kind: item.settings }, 5000).catch(() => {}) }, 'Einstellungen öffnen'));
      } else if (state === 'granted' && item.canTurnOff) {
        buttons.push(h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
          await nativeCall('setBackground', { on: false }, 10000).catch(() => {});
          toast('Startet nicht mehr von selbst.');
          refresh();
        } }, 'Ausschalten'));
      }
      const detail = state === 'granted' ? (item.granted || LABEL.granted)
        : state === 'denied' && isMacApp ? 'Nicht erlaubt – in den Systemeinstellungen änderbar'
          : state === 'denied' ? 'Nicht erlaubt – in den Browser-Einstellungen änderbar'
            : state === 'unavailable' ? (item.id === 'mikrofon' && !isMacApp ? 'Geht nur in der Mac-App oder über eine sichere Verbindung (https)' : LABEL.unavailable)
              : (item.off || LABEL.unknown);
      return h('div', { class: 'conn' },
        h('span', { class: 'conn-icon', html: ICONS[item.icon] }),
        h('div', {},
          h('div', { class: 'name' }, item.title),
          h('p', { class: 'perm-text' }, item.text),
          h('div', { class: `state${state === 'granted' ? ' on' : ''}` }, state === 'granted' ? h('span', { class: 'perm-ok', html: ICONS.check }) : '', detail)),
        h('div', { class: 'conn-actions' }, buttons));
    }));
  };

  const refresh = async () => {
    try {
      st = await statuses();
    } catch (err) {
      toast(err.message, 'error');
    }
    render();
  };

  // Nacheinander fragen – macOS zeigt jedes Mal ein eigenes Fenster
  const run = async (which) => {
    if (busy) return;
    busy = true;
    render();
    try {
      for (const item of which) {
        if (combined(item, st) !== 'unknown') continue;
        await requestItem(item);
        st = await statuses().catch(() => st);
        render();
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  };

  await refresh();
  return {
    el: list,
    hasItems: () => items.some((i) => combined(i, st) !== 'unavailable'),
    pending: () => items.filter((i) => combined(i, st) === 'unknown').length,
    allowAll: () => run(items),
  };
}

export async function renderPermissionsPage() {
  const perms = await permissionList();
  const page = h('main', { class: 'page page-narrow' },
    h('p', { class: 'setup-progress' }, h('a', { href: '#/einstellungen' }, '‹ Zurück zu den Einstellungen')),
    h('h1', {}, 'Berechtigungen'),
    h('p', { class: 'lead' }, isMacApp
      ? 'Was der Assistent auf deinem Mac darf. Für jede Erlaubnis fragt macOS einmal nach. Später kannst du sie in den Systemeinstellungen unter „Datenschutz & Sicherheit“ wieder wegnehmen.'
      : 'Was der Assistent in diesem Browser darf.'),
    perms.el,
    h('p', { class: 'hint' }, 'Kalender, Mail und Claude verbindest du unter ', h('a', { href: '#/verbindungen' }, 'Verbindungen'), '.'));
  document.getElementById('app').replaceChildren(...shell('/einstellungen', page));
}
