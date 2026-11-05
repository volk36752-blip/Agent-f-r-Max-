// Brücke zur Mac-App.
//
// Die App fragt ständig „Gibt es etwas für mich?“ (Long-Polling) und schickt die Ergebnisse zurück.
// So erledigt der Server über die App alles, was nur eine echte Mac-App darf: Kalender, Erinnerungen,
// Kontakte, WhatsApp-Daten, Apple Intelligence und die Erlaubnis-Fenster von macOS.

import { randomUUID } from 'node:crypto';

export class BridgeError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.code = code;
    this.status = { offline: 409, unknown: 409, denied: 403, off: 403, timeout: 504, notInstalled: 409 }[code] || 502;
  }
}

const HOLD_MS = 25000;

export function createBridge() {
  const queue = [];
  const pending = new Map();
  const pollers = new Set();
  let lastSeen = 0;
  let info = null;

  const connected = () => pollers.size > 0 || Date.now() - lastSeen < 10000;

  function reply(res, body) {
    if (res.writableEnded || res.destroyed) return false;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
    return true;
  }

  function deliver() {
    while (queue.length && pollers.size) {
      const p = pollers.values().next().value;
      pollers.delete(p);
      clearTimeout(p.timer);
      const batch = queue.splice(0);
      if (reply(p.res, { requests: batch })) p.done();
      else {
        queue.unshift(...batch);
        p.done();
      }
    }
  }

  return {
    connected,
    info: () => info,

    // Die App meldet sich (beim Start und regelmäßig) mit Version, Apple-Intelligence-Status usw.
    hello(body) {
      info = { ...body, at: Date.now() };
      lastSeen = Date.now();
      return { ok: true };
    },

    // Die App holt Aufträge ab. Wartet bis zu 25 Sekunden, wenn gerade nichts ansteht.
    poll(req, res) {
      lastSeen = Date.now();
      return new Promise((resolve) => {
        if (queue.length) {
          reply(res, { requests: queue.splice(0) });
          resolve();
          return;
        }
        const p = { res, done: resolve };
        p.timer = setTimeout(() => {
          pollers.delete(p);
          lastSeen = Date.now();
          reply(res, { requests: [] });
          resolve();
        }, HOLD_MS);
        pollers.add(p);
        res.on('close', () => {
          if (pollers.delete(p)) {
            clearTimeout(p.timer);
            lastSeen = Date.now();
            resolve();
          }
        });
      });
    },

    result(body) {
      const p = pending.get(body?.id);
      if (!p) return { ok: false };
      pending.delete(body.id);
      clearTimeout(p.timer);
      if (body.ok) p.resolve(body.result ?? null);
      else p.reject(new BridgeError(body.error || 'Die Mac-App meldet einen Fehler.', body.code || 'error'));
      return { ok: true };
    },

    event(body) {
      const p = pending.get(body?.id);
      try {
        p?.onEvent?.(body.event);
      } catch {
        /* Anzeige darf nichts kaputt machen */
      }
      return { ok: Boolean(p) };
    },

    call(cmd, args = {}, { timeoutMs = 30000, onEvent } = {}) {
      if (!connected()) return Promise.reject(new BridgeError('Dafür muss die Mac-App „Assistent“ geöffnet sein.', 'offline'));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          const i = queue.findIndex((q) => q.id === id);
          if (i >= 0) queue.splice(i, 1);
          reject(new BridgeError('Die Mac-App hat nicht rechtzeitig geantwortet.', 'timeout'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, onEvent });
        queue.push({ id, cmd, args });
        deliver();
      });
    },

    close() {
      for (const p of pollers) {
        clearTimeout(p.timer);
        reply(p.res, { requests: [] });
        p.done();
      }
      pollers.clear();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new BridgeError('Der Assistent wird beendet.', 'offline'));
      }
      pending.clear();
    },
  };
}
