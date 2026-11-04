// Passwort, Anmeldung und Zugangsschlüssel für den Connector.

import crypto from 'node:crypto';

const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class Sessions {
  constructor(store) {
    this.store = store;
  }

  create() {
    const token = randomToken();
    const now = Date.now();
    this.store.update((d) => {
      for (const [k, v] of Object.entries(d.items)) if (v.expires < now) delete d.items[k];
      d.items[sha(token)] = { created: now, expires: now + SESSION_DAYS * 86400000 };
    });
    return token;
  }

  valid(token) {
    if (!token) return false;
    const s = this.store.data.items[sha(token)];
    return Boolean(s && s.expires > Date.now());
  }

  destroy(token) {
    if (!token) return;
    this.store.update((d) => {
      delete d.items[sha(token)];
    });
  }

  destroyAll() {
    this.store.update((d) => {
      d.items = {};
    });
  }
}

// Bremst wiederholte Fehlversuche beim Anmelden.
export class RateLimiter {
  constructor({ max = 8, windowMs = 15 * 60000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, list);
    return list.length < this.max;
  }

  fail(key) {
    const list = this.hits.get(key) || [];
    list.push(Date.now());
    this.hits.set(key, list);
  }

  reset(key) {
    this.hits.delete(key);
  }
}

export function setupCode() {
  return String(crypto.randomInt(100000, 1000000));
}
