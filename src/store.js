// Speichert alles als JSON-Dateien im Ordner "data" (wird nicht ins Git-Repo hochgeladen).

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MODEL } from './lib/claude.js';
import { isValidTimeZone } from './lib/tz.js';

function systemTimeZone() {
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz && tz !== 'UTC' && isValidTimeZone(tz) ? tz : 'Europe/Berlin';
}

function deepMerge(defaults, value) {
  if (Array.isArray(defaults) || typeof defaults !== 'object' || defaults === null) return value === undefined ? defaults : value;
  const out = { ...defaults };
  for (const [k, v] of Object.entries(value || {})) out[k] = k in defaults ? deepMerge(defaults[k], v) : v;
  return out;
}

export class JsonFile {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return deepMerge(structuredClone(this.defaults), JSON.parse(raw));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        const backup = `${this.file}.kaputt-${Date.now()}`;
        try {
          fs.copyFileSync(this.file, backup);
        } catch {
          /* ignorieren */
        }
        console.error(`Konnte ${path.basename(this.file)} nicht lesen, starte mit leeren Daten (Sicherung: ${path.basename(backup)}).`);
      }
      return structuredClone(this.defaults);
    }
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  update(fn) {
    const result = fn(this.data);
    this.save();
    return result;
  }
}

export function createStores(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = (name) => path.join(dataDir, name);
  return {
    dataDir,
    config: new JsonFile(file('einstellungen.json'), {
      version: 1,
      timezone: systemTimeZone(),
      planTime: '06:00',
      planEnabled: true,
      lanAccess: false,
      setupDone: false,
      icloud: { appleId: '', mailAddress: '', calendarEnabled: false, mailEnabled: false, selectedCalendars: null, defaultCalendar: null },
      weather: { enabled: false, name: '', region: '', latitude: null, longitude: null },
      claude: { model: DEFAULT_MODEL },
      skipped: [],
      wishes: [],
      // Apps direkt vom Mac – ohne Passwörter
      apps: {
        kalender: { enabled: true, selected: null, defaultCalendar: null },
        todos: { enabled: true },
        whatsapp: { enabled: true, autoSend: false, askTodos: true },
        mail: { enabled: true },
        erinnerungen: { enabled: true },
        kontakte: { enabled: true },
        wetter: { enabled: true },
      },
      plugins: [],
      brain: { mode: 'auto' },
      widgets: null,
      countryCode: '49',
    }),
    secrets: new JsonFile(file('geheim.json'), {
      passwordHash: null,
      icloudAppPassword: '',
      claudeApiKey: '',
      connectorToken: '',
    }),
    todos: new JsonFile(file('todos.json'), { items: [] }),
    chat: new JsonFile(file('chat.json'), { messages: [], log: [] }),
    state: new JsonFile(file('status.json'), { lastPlanDate: null, plan: { date: null, attempts: 0, lastAttemptAt: 0, lastError: null }, briefing: null, actions: {}, whatsapp: { seenMs: 0, todoKeys: [] } }),
    sessions: new JsonFile(file('sitzungen.json'), { items: {} }),
  };
}
