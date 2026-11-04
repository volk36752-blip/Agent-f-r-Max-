// Schlanker IMAP-Client (RFC 3501) für iCloud-Mail – nur mit Node-Bordmitteln.

import tls from 'node:tls';
import net from 'node:net';
import { decodeWords } from './mime.js';

export class ImapError extends Error {
  constructor(message, status = 'ERROR', code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- Ordnernamen (modifiziertes UTF-7) ----------

export function decodeMailboxName(name) {
  return String(name).replace(/&([^-]*)-/g, (m, b64) => {
    if (b64 === '') return '&';
    const bytes = Buffer.from(b64.replace(/,/g, '/'), 'base64');
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  });
}

export function encodeMailboxName(name) {
  let out = '';
  let run = '';
  const flush = () => {
    if (!run) return;
    const bytes = [];
    for (let i = 0; i < run.length; i++) {
      const c = run.charCodeAt(i);
      bytes.push(c >> 8, c & 0xff);
    }
    out += '&' + Buffer.from(bytes).toString('base64').replace(/=+$/, '').replace(/\//g, ',') + '-';
    run = '';
  };
  for (const ch of String(name)) {
    const code = ch.codePointAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      flush();
      out += ch === '&' ? '&-' : ch;
    } else run += ch;
  }
  flush();
  return out;
}

// ---------- Antworten zerlegen ----------

export function tokenize(s) {
  let i = 0;
  const skip = () => {
    while (s[i] === ' ') i++;
  };
  const value = () => {
    const c = s[i];
    if (c === '(') {
      i++;
      const arr = [];
      for (;;) {
        skip();
        if (i >= s.length) break;
        if (s[i] === ')') {
          i++;
          break;
        }
        arr.push(value());
      }
      return arr;
    }
    if (c === '"') {
      i++;
      let out = '';
      while (i < s.length) {
        const ch = s[i];
        if (ch === '\\') {
          out += s[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (ch === '"') {
          i++;
          break;
        }
        out += ch;
        i++;
      }
      return Buffer.from(out, 'latin1').toString('utf8');
    }
    if (c === '{') {
      const m = /^\{(\d+)\+?\}\r\n/.exec(s.slice(i, i + 32));
      if (m) {
        i += m[0].length;
        const n = Number(m[1]);
        const lit = s.slice(i, i + n);
        i += n;
        return { literal: Buffer.from(lit, 'latin1') };
      }
    }
    const start = i;
    let depth = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '[') depth++;
      else if (ch === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (ch === ' ' || ch === '(' || ch === ')')) break;
      i++;
    }
    if (i === start) {
      i++;
      return s[start];
    }
    const atom = s.slice(start, i);
    return atom.toUpperCase() === 'NIL' ? null : atom;
  };
  const out = [];
  while (i < s.length) {
    skip();
    if (i >= s.length) break;
    if (s[i] === ')') {
      i++;
      continue;
    }
    out.push(value());
  }
  return out;
}

export function findResponseEnd(buf) {
  let pos = 0;
  for (;;) {
    const idx = buf.indexOf('\r\n', pos, 'latin1');
    if (idx < 0) return -1;
    const tail = buf.subarray(Math.max(pos, idx - 24), idx).toString('latin1');
    const m = /\{(\d+)\+?\}$/.exec(tail);
    if (!m) return idx + 2;
    const n = Number(m[1]);
    if (buf.length < idx + 2 + n) return -1;
    pos = idx + 2 + n;
  }
}

function parseUntagged(s) {
  const numbered = /^(\d+) ([A-Za-z]+)\s?([\s\S]*)$/.exec(s);
  if (numbered) {
    const type = numbered[2].toUpperCase();
    return { num: Number(numbered[1]), type, data: type === 'FETCH' ? tokenize(numbered[3]) : null };
  }
  const sp = s.indexOf(' ');
  const type = (sp < 0 ? s : s.slice(0, sp)).toUpperCase();
  const rest = sp < 0 ? '' : s.slice(sp + 1);
  const structured = ['LIST', 'LSUB', 'SEARCH', 'CAPABILITY', 'STATUS', 'FLAGS'].includes(type);
  return { type, rest, data: structured ? tokenize(rest) : null };
}

const str = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && v.literal) return v.literal.toString('utf8');
  return String(v);
};

function parseAddresses(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => Array.isArray(a) && a[2])
    .map((a) => ({ name: decodeWords(str(a[0])), address: a[3] ? `${str(a[2])}@${str(a[3])}` : str(a[2]) }));
}

export function parseEnvelope(env) {
  if (!Array.isArray(env)) return null;
  return {
    date: str(env[0]),
    subject: decodeWords(str(env[1])),
    from: parseAddresses(env[2]),
    replyTo: parseAddresses(env[4]),
    to: parseAddresses(env[5]),
    cc: parseAddresses(env[6]),
    inReplyTo: str(env[8]),
    messageId: str(env[9]),
  };
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function parseInternalDate(v) {
  const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})/.exec(str(v));
  if (!m) return null;
  const offset = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) * 60000;
  return Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()] ?? 0, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offset;
}

export function parseFetch(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const key = String(list[i]).toUpperCase();
    const val = list[i + 1];
    if (key === 'UID') out.uid = Number(val);
    else if (key === 'FLAGS') out.flags = Array.isArray(val) ? val.map(String) : [];
    else if (key === 'ENVELOPE') out.envelope = parseEnvelope(val);
    else if (key === 'INTERNALDATE') out.internalDate = parseInternalDate(val);
    else if (key === 'RFC822.SIZE') out.size = Number(val);
    else if (key.startsWith('BODY[')) out.body = val && val.literal ? val.literal : Buffer.from(str(val), 'utf8');
  }
  return out;
}

export function quote(value) {
  const s = String(value);
  if (/^[\x20-\x7e]*$/.test(s)) return `"${s.replace(/[\\"]/g, '\\$&')}"`;
  return { literal: Buffer.from(s, 'utf8') };
}

// ---------- Verbindung ----------

export class ImapClient {
  constructor({ host, port = 993, secure = true, timeoutMs = 30000, connectFn = null }) {
    this.host = host;
    this.port = port;
    this.secure = secure;
    this.timeoutMs = timeoutMs;
    this.connectFn = connectFn;
    this.buf = Buffer.alloc(0);
    this.seq = 0;
    this.queue = Promise.resolve();
    this.current = null;
    this.capabilities = new Set();
    this.closed = false;
    this.loggingOut = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._greeting = { resolve, reject };
      const sock = this.connectFn
        ? this.connectFn()
        : this.secure
          ? tls.connect({ host: this.host, port: this.port, servername: this.host })
          : net.connect({ host: this.host, port: this.port });
      this.socket = sock;
      sock.setTimeout(this.timeoutMs, () => sock.destroy(new Error('Zeitüberschreitung')));
      sock.on('data', (chunk) => this._onData(chunk));
      sock.on('error', (err) => this._fail(err));
      sock.on('close', () => this._fail(new Error('Verbindung geschlossen')));
    }).then(async () => {
      this.capabilities = await this.capability();
    });
  }

  _fail(err) {
    if (this.closed) return;
    this.closed = true;
    const msg = err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || err?.code === 'EAI_AGAIN'
      ? 'Der Mail-Server ist nicht erreichbar. Bist du online?'
      : `Verbindung zum Mail-Server abgebrochen (${err?.message || 'unbekannt'}).`;
    if (this._greeting) {
      this._greeting.reject(new ImapError(msg));
      this._greeting = null;
    }
    if (this.current && !this.loggingOut) this.current.reject(new ImapError(msg));
    else if (this.current) this.current.resolve({ untagged: this.current.untagged, text: '' });
    this.current = null;
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const end = findResponseEnd(this.buf);
      if (end < 0) break;
      const raw = this.buf.subarray(0, end).toString('latin1').replace(/\r\n$/, '');
      this.buf = this.buf.subarray(end);
      this._handle(raw);
    }
  }

  _handle(line) {
    if (this._greeting) {
      const g = this._greeting;
      this._greeting = null;
      if (/^\* (OK|PREAUTH)/i.test(line)) g.resolve();
      else g.reject(new ImapError(`Der Mail-Server hat die Verbindung abgelehnt: ${line.slice(0, 120)}`));
      return;
    }
    if (line.startsWith('+')) {
      const cont = this._continue;
      this._continue = null;
      if (cont) cont();
      return;
    }
    if (line.startsWith('* ')) {
      const parsed = parseUntagged(line.slice(2));
      if (this.current) this.current.untagged.push(parsed);
      return;
    }
    const sp = line.indexOf(' ');
    const tag = line.slice(0, sp);
    const rest = line.slice(sp + 1);
    const cur = this.current;
    if (!cur || cur.tag !== tag) return;
    this.current = null;
    const m = /^(OK|NO|BAD)\s?([\s\S]*)$/i.exec(rest);
    const status = m ? m[1].toUpperCase() : 'BAD';
    const text = m ? m[2] : rest;
    if (status === 'OK') cur.resolve({ untagged: cur.untagged, text });
    else {
      const code = /^\[([A-Z-]+)/.exec(text)?.[1] || null;
      cur.reject(new ImapError(text.replace(/^\[[^\]]*\]\s*/, '') || 'Fehler vom Mail-Server', status, code));
    }
  }

  command(...parts) {
    const run = () => {
      if (this.closed) return Promise.reject(new ImapError('Keine Verbindung zum Mail-Server.'));
      const tag = `A${++this.seq}`;
      const segments = [];
      let text = `${tag} `;
      for (const p of parts.flat()) {
        if (typeof p === 'string') text += p;
        else if (p && p.literal) {
          segments.push({ text: `${text}{${p.literal.length}}\r\n`, literal: p.literal });
          text = '';
        }
      }
      segments.push({ text: `${text}\r\n` });
      return new Promise((resolve, reject) => {
        this.current = { tag, untagged: [], resolve, reject };
        let i = 0;
        const sendNext = () => {
          const seg = segments[i++];
          if (!seg) return;
          this.socket.write(Buffer.from(seg.text, 'utf8'));
          if (seg.literal) {
            this._continue = () => {
              this.socket.write(seg.literal);
              sendNext();
            };
          }
        };
        sendNext();
      });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async capability() {
    const r = await this.command('CAPABILITY');
    const c = r.untagged.find((u) => u.type === 'CAPABILITY');
    return new Set((c?.data || []).map((x) => String(x).toUpperCase()));
  }

  async login(user, password) {
    try {
      await this.command('LOGIN ', quote(user), ' ', quote(password));
    } catch (err) {
      if (err instanceof ImapError && err.status === 'NO') {
        throw new ImapError('Anmeldung bei iCloud-Mail fehlgeschlagen. Prüfe Mail-Adresse und app-spezifisches Passwort.', 'NO', 'AUTHENTICATIONFAILED');
      }
      throw err;
    }
    this.capabilities = await this.capability();
  }

  async list() {
    const r = await this.command('LIST "" "*"');
    return r.untagged
      .filter((u) => u.type === 'LIST' && u.data)
      .map((u) => {
        const [flags, delimiter, name] = u.data;
        const raw = str(name);
        return { name: raw, display: decodeMailboxName(raw), delimiter: delimiter ?? '/', flags: (Array.isArray(flags) ? flags : []).map((f) => String(f).toLowerCase()) };
      });
  }

  async select(mailbox, readOnly = false) {
    const r = await this.command(readOnly ? 'EXAMINE ' : 'SELECT ', quote(mailbox));
    const exists = r.untagged.find((u) => u.type === 'EXISTS')?.num ?? 0;
    const uv = r.untagged.map((u) => /\[UIDVALIDITY (\d+)\]/.exec(u.rest || '')).find(Boolean);
    this.selected = mailbox;
    return { exists, uidValidity: uv ? Number(uv[1]) : null };
  }

  async uidSearch(...criteria) {
    const r = await this.command('UID SEARCH ', ...criteria);
    const s = r.untagged.filter((u) => u.type === 'SEARCH');
    return s.flatMap((u) => (u.data || []).map(Number).filter(Number.isFinite)).sort((a, b) => a - b);
  }

  async uidFetch(uids, items) {
    if (!uids.length) return [];
    const r = await this.command(`UID FETCH ${uids.join(',')} ${items}`);
    return r.untagged.filter((u) => u.type === 'FETCH').map((u) => parseFetch(u.data?.[0])).filter((m) => m.uid);
  }

  async uidStore(uids, op, flags) {
    await this.command(`UID STORE ${uids.join(',')} ${op} (${flags.join(' ')})`);
  }

  async uidMove(uids, mailbox) {
    if (this.capabilities.has('MOVE')) {
      await this.command(`UID MOVE ${uids.join(',')} `, quote(mailbox));
      return;
    }
    if (!this.capabilities.has('UIDPLUS')) throw new ImapError('Der Mail-Server unterstützt das Verschieben nicht.');
    await this.command(`UID COPY ${uids.join(',')} `, quote(mailbox));
    await this.uidStore(uids, '+FLAGS.SILENT', ['\\Deleted']);
    await this.command(`UID EXPUNGE ${uids.join(',')}`);
  }

  async append(mailbox, flags, message) {
    await this.command('APPEND ', quote(mailbox), ` (${flags.join(' ')}) `, { literal: message });
  }

  async logout() {
    if (this.closed) return;
    this.loggingOut = true;
    try {
      await Promise.race([this.command('LOGOUT'), new Promise((r) => setTimeout(r, 3000))]);
    } catch {
      /* egal */
    } finally {
      this.closed = true;
      this.socket?.end();
      this.socket?.destroy();
    }
  }
}
