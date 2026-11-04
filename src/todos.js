// Die To-do-Liste im Dashboard.

import { randomUUID } from 'node:crypto';
import { parseIsoDate, todayIso, addDaysIso } from './lib/tz.js';

export class TodoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function clean(input, partial = false) {
  const out = {};
  if (!partial || input.title !== undefined) {
    const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
    if (!title) throw new TodoError('Das To-do braucht einen Titel.');
    if (title.length > 200) throw new TodoError('Der Titel ist zu lang (höchstens 200 Zeichen).');
    out.title = title;
  }
  if (input.notes !== undefined) out.notes = String(input.notes ?? '').slice(0, 2000);
  if (input.due !== undefined) {
    if (input.due === null || input.due === '') out.due = null;
    else if (!parseIsoDate(input.due)) throw new TodoError('Fälligkeitsdatum bitte als JJJJ-MM-TT angeben.');
    else out.due = input.due;
  }
  if (input.time !== undefined) {
    if (input.time === null || input.time === '') out.time = null;
    else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new TodoError('Uhrzeit bitte als HH:MM angeben.');
    else out.time = input.time;
  }
  if (input.priority !== undefined) {
    if (!['normal', 'hoch'].includes(input.priority)) throw new TodoError('Priorität ist „normal“ oder „hoch“.');
    out.priority = input.priority;
  }
  if (input.done !== undefined) out.done = Boolean(input.done);
  return out;
}

export function createTodos(store, getTimeZone) {
  const items = () => store.data.items;

  function sortKey(t) {
    return [t.done ? 1 : 0, t.due || '9999-99-99', t.time || '99:99', t.priority === 'hoch' ? 0 : 1, t.createdAt];
  }

  function sorted(list) {
    return [...list].sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  }

  const api = {
    list({ status = 'offen' } = {}) {
      const today = todayIso(getTimeZone());
      let list = items();
      if (status === 'offen') list = list.filter((t) => !t.done);
      else if (status === 'erledigt') list = list.filter((t) => t.done);
      else if (status === 'heute') list = list.filter((t) => !t.done && t.due && t.due <= today);
      return sorted(list).map((t) => ({ ...t, overdue: !t.done && Boolean(t.due) && t.due < today }));
    },

    get(id) {
      const t = items().find((x) => x.id === id);
      if (!t) throw new TodoError('Dieses To-do gibt es nicht (mehr).', 404);
      return t;
    },

    add(input, source = 'du') {
      const data = clean(input);
      const due = data.due ?? null;
      if (source !== 'du') {
        const dup = items().find((t) => !t.done && norm(t.title) === norm(data.title) && (t.due ?? null) === due);
        if (dup) return { ...dup, duplicate: true };
      }
      const now = Date.now();
      const todo = {
        id: randomUUID().slice(0, 8),
        title: data.title,
        notes: data.notes || '',
        due,
        time: data.time ?? null,
        priority: data.priority || 'normal',
        done: false,
        doneAt: null,
        source,
        createdAt: now,
        updatedAt: now,
      };
      store.update((d) => {
        d.items.push(todo);
      });
      return todo;
    },

    update(id, input) {
      const patch = clean(input, true);
      return store.update((d) => {
        const t = d.items.find((x) => x.id === id);
        if (!t) throw new TodoError('Dieses To-do gibt es nicht (mehr).', 404);
        Object.assign(t, patch, { updatedAt: Date.now() });
        if (patch.done === true && !t.doneAt) t.doneAt = Date.now();
        if (patch.done === false) t.doneAt = null;
        return { ...t };
      });
    },

    remove(id) {
      return store.update((d) => {
        const idx = d.items.findIndex((x) => x.id === id);
        if (idx < 0) throw new TodoError('Dieses To-do gibt es nicht (mehr).', 404);
        const [t] = d.items.splice(idx, 1);
        return t;
      });
    },

    // Erledigtes nach 30 Tagen aufräumen
    cleanup() {
      const limit = Date.now() - 30 * 86400000;
      const before = items().length;
      if (items().some((t) => t.done && t.doneAt && t.doneAt < limit)) {
        store.update((d) => {
          d.items = d.items.filter((t) => !(t.done && t.doneAt && t.doneAt < limit));
        });
      }
      return before - items().length;
    },

    summary() {
      const today = todayIso(getTimeZone());
      const open = items().filter((t) => !t.done);
      return {
        open: open.length,
        today: open.filter((t) => t.due === today).length,
        overdue: open.filter((t) => t.due && t.due < today).length,
        tomorrow: open.filter((t) => t.due === addDaysIso(today, 1)).length,
      };
    },
  };
  return api;
}
