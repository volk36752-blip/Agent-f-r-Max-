// Karten mit Vorschlägen: Der Agent schlägt z. B. drei WhatsApp-Antworten vor – gesendet wird erst,
// wenn du einen Vorschlag antippst. Genauso für Mails, Kurzbefehle und zum Bestätigen beim Löschen.

import { randomUUID } from 'node:crypto';
import { withRun } from './apps.js';

export class ActionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const FINAL = new Set(['gesendet', 'erledigt', 'verworfen', 'entwurf']);
const KEEP = 80;

export function createActions(ctx) {
  const handlers = new Map();
  const state = ctx.stores.state;
  const all = () => state.data.actions || {};

  function save(a) {
    state.update((s) => {
      s.actions = s.actions || {};
      s.actions[a.id] = a;
      const ids = Object.keys(s.actions);
      if (ids.length > KEEP) {
        ids.sort((x, y) => s.actions[x].createdAt - s.actions[y].createdAt).slice(0, ids.length - KEEP).forEach((id) => delete s.actions[id]);
      }
    });
    ctx.changed?.('actions');
    return { ...a };
  }

  return {
    register(kind, fn) {
      handlers.set(kind, fn);
    },

    create({ kind, title, to = '', target = {}, options = [], allowEdit = true, confirmLabel = null, detail = '' }) {
      if (!handlers.has(kind)) throw new ActionError(`Unbekannte Aktion: ${kind}`);
      const opts = options.map((o) => String(o ?? '').trim()).filter(Boolean).slice(0, 4);
      return save({
        id: randomUUID().replace(/-/g, '').slice(0, 12),
        kind,
        title: String(title || ''),
        to: String(to || ''),
        target,
        options: opts,
        allowEdit: Boolean(allowEdit),
        confirmLabel,
        detail: String(detail || '').slice(0, 600),
        status: 'offen',
        createdAt: Date.now(),
      });
    },

    get(id) {
      const a = all()[id];
      return a ? { ...a } : null;
    },

    many(ids) {
      const out = {};
      for (const id of ids || []) if (all()[id]) out[id] = { ...all()[id] };
      return out;
    },

    // choice: Nummer des Vorschlags – oder text: selbst geschrieben
    async run(id, { choice, text } = {}) {
      const a = all()[id];
      if (!a) throw new ActionError('Diese Karte gibt es nicht mehr.', 404);
      if (a.status === 'laeuft') throw new ActionError('Das läuft gerade schon.', 409);
      if (FINAL.has(a.status)) throw new ActionError('Das ist schon erledigt.', 409);
      let value = null;
      if (text !== undefined && text !== null && String(text).trim()) {
        if (!a.allowEdit) throw new ActionError('Hier kann man nichts selbst schreiben.');
        value = String(text).trim().slice(0, 4000);
      } else if (Number.isInteger(choice) && a.options[choice] !== undefined) value = a.options[choice];
      else if (a.options.length) throw new ActionError('Bitte einen Vorschlag antippen.');
      const handler = handlers.get(a.kind);
      save({ ...a, status: 'laeuft', error: null });
      try {
        const r = await withRun({ purpose: 'user', emit: null }, () => handler(a, value));
        return save({ ...a, status: r?.status || 'erledigt', chosen: value, result: r || {}, error: null, doneAt: Date.now() });
      } catch (err) {
        save({ ...a, status: 'offen', error: err.message });
        throw err;
      }
    },

    cancel(id) {
      const a = all()[id];
      if (!a) throw new ActionError('Diese Karte gibt es nicht mehr.', 404);
      if (FINAL.has(a.status)) return { ...a };
      return save({ ...a, status: 'verworfen' });
    },
  };
}
