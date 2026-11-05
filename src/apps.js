// Die Apps, auf die der Assistent zugreifen darf – ohne Passwörter.
//
// Beim ersten Zugriff fragt macOS selbst nach („Assistent möchte auf deinen Kalender zugreifen“) –
// ein Klick auf „Erlauben“ genügt. In den Einstellungen lässt sich jede App für den Agenten ausschalten.

import { AsyncLocalStorage } from 'node:async_hooks';

// Wer gerade arbeitet: Chat (darf fragen), Tagesplan/Dashboard (dürfen nicht fragen) – und wohin
// Hinweise wie „Frage nach Erlaubnis …“ gehen.
export const runContext = new AsyncLocalStorage();
export const currentRun = () => runContext.getStore() || {};
export function withRun(info, fn) {
  return runContext.run({ ...currentRun(), ...info }, fn);
}

export class AppError extends Error {
  constructor(message, code = 'error', app = null) {
    super(message);
    this.code = code;
    this.app = app;
    this.status = code === 'off' || code === 'denied' ? 403 : 409;
  }
}

export const APPS = [
  { id: 'kalender', name: 'Kalender', icon: 'calendar', permission: 'calendar', mac: true, text: 'Termine anzeigen, freie Zeit prüfen, Termine eintragen und verschieben.' },
  { id: 'todos', name: 'To-do-Liste', icon: 'check', permission: null, mac: false, text: 'Deine eigene Liste auf der Startseite. Der Agent legt To-dos an und hakt sie ab.' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', permission: 'whatsapp', mac: true, text: 'Chats lesen und Antworten vorschlagen. Gesendet wird erst, wenn du einen Vorschlag antippst. Braucht WhatsApp für den Mac.' },
  { id: 'mail', name: 'Mail', icon: 'mail', permission: 'mail', mac: true, text: 'Mails aus der Mail-App lesen und beantworten. Gesendet wird erst, wenn du einen Vorschlag antippst.' },
  { id: 'erinnerungen', name: 'Erinnerungen', icon: 'bell', permission: 'reminders', mac: true, text: 'Deine Erinnerungen-App – auch auf dem iPhone sichtbar.' },
  { id: 'kontakte', name: 'Kontakte', icon: 'person', permission: 'contacts', mac: true, text: 'Telefonnummern und Mail-Adressen finden, wenn du jemandem schreiben willst.' },
  { id: 'wetter', name: 'Wetter', icon: 'weather', permission: null, mac: false, text: 'Wetter für deinen Ort.' },
];

export const PERMISSION_NAMES = {
  calendar: 'Kalender', reminders: 'Erinnerungen', contacts: 'Kontakte', mail: 'Mail', whatsapp: 'WhatsApp',
  notes: 'Notizen', music: 'Musik', accessibility: 'Bedienungshilfen',
};

const QUIET = new Set(['plan', 'dashboard', 'background']);

export function createApps({ stores, bridge }) {
  const conf = () => stores.config.data.apps;
  let cache = { at: 0, value: null };

  async function permissions(fresh = false) {
    if (!bridge.connected()) return {};
    if (!fresh && cache.value && Date.now() - cache.at < 4000) return cache.value;
    try {
      const st = await bridge.call('permissions', {}, { timeoutMs: 8000 });
      cache = { at: Date.now(), value: st || {} };
    } catch {
      if (!cache.value) return {};
    }
    return cache.value;
  }

  const def = (id) => APPS.find((a) => a.id === id);
  const isOn = (id) => conf()[id]?.enabled !== false;

  // Stellt sicher, dass macOS den Zugriff erlaubt – fragt notfalls einmal nach.
  async function ensurePermission(kind, label = PERMISSION_NAMES[kind] || kind) {
    const run = currentRun();
    const st = (await permissions())[kind] || 'unknown';
    if (st === 'granted') return;
    if (st === 'notInstalled') throw new AppError(`${label} ist auf diesem Mac nicht installiert.`, 'notInstalled');
    if (st === 'denied') throw new AppError(`Ich darf nicht auf ${label} zugreifen. Erlauben kannst du es unter Einstellungen → Apps.`, 'denied');
    if (st === 'unavailable') throw new AppError(`${label} geht auf diesem Mac leider nicht.`, 'unavailable');
    if (QUIET.has(run.purpose)) throw new AppError(`${label} ist noch nicht erlaubt.`, 'unknown');
    run.emit?.({ type: 'permission', kind, name: label, state: 'asking' });
    let result;
    try {
      result = await bridge.call('permission.request', { kind }, { timeoutMs: 300000 });
    } finally {
      cache.at = 0;
    }
    const status = result?.status || 'denied';
    run.emit?.({ type: 'permission', kind, name: label, state: status });
    if (status === 'notInstalled') throw new AppError(`${label} ist auf diesem Mac nicht installiert.`, 'notInstalled');
    if (status !== 'granted') throw new AppError(`Du hast den Zugriff auf ${label} nicht erlaubt. Ändern kannst du das jederzeit unter Einstellungen → Apps.`, 'denied');
  }

  async function ensure(id) {
    const app = def(id);
    if (!app) return;
    if (!isOn(id)) throw new AppError(`${app.name} ist in den Einstellungen für den Assistenten ausgeschaltet.`, 'off', id);
    if (!app.permission) return;
    if (!bridge.connected()) throw new AppError(`Für ${app.name} muss die Mac-App „Assistent“ geöffnet sein.`, 'offline', id);
    await ensurePermission(app.permission, app.name);
  }

  // Ausdrücklich erlauben (Klick in den Einstellungen oder auf der Startseite)
  async function request(id) {
    const app = def(id);
    if (!app) throw new AppError('Unbekannte App.', 'error');
    stores.config.update((c) => {
      c.apps[id] = { ...(c.apps[id] || {}), enabled: true };
    });
    if (!app.permission) return { status: 'granted' };
    await runContext.run({ purpose: 'user' }, () => ensurePermission(app.permission, app.name)).catch((err) => {
      if (!(err instanceof AppError)) throw err;
    });
    const st = (await permissions(true))[app.permission] || 'unknown';
    return { status: st };
  }

  async function list() {
    const online = bridge.connected();
    const st = online ? await permissions(true) : {};
    return APPS.map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      text: a.text,
      mac: a.mac,
      enabled: isOn(a.id),
      permission: !a.permission ? 'none' : online ? st[a.permission] || 'unknown' : 'offline',
      options: { ...(conf()[a.id] || {}) },
      accessibility: a.id === 'whatsapp' ? st.accessibility || 'unknown' : undefined,
    }));
  }

  function set(id, patch = {}) {
    if (!def(id)) throw new AppError('Unbekannte App.', 'error');
    const allowed = { enabled: 'boolean', autoSend: 'boolean', askTodos: 'boolean', sendDirect: 'boolean', selected: 'array' };
    stores.config.update((c) => {
      const cur = { ...(c.apps[id] || {}) };
      for (const [k, type] of Object.entries(allowed)) {
        if (patch[k] === undefined) continue;
        if (type === 'boolean') cur[k] = Boolean(patch[k]);
        else if (type === 'array') cur[k] = Array.isArray(patch[k]) ? patch[k].map(String).slice(0, 100) : null;
      }
      c.apps[id] = cur;
    });
    cache.at = 0;
    return { ...conf()[id] };
  }

  return { list, set, ensure, ensurePermission, request, isOn, permissions, def, option: (id, key) => conf()[id]?.[key] };
}
