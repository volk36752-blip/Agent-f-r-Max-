// E-Mails lesen (MIME) und Entwürfe zusammenbauen – ohne externe Pakete.

import { randomUUID } from 'node:crypto';

// ---------- Zeichensätze ----------

const CHARSET_ALIASES = { utf8: 'utf-8', latin1: 'iso-8859-1', 'us-ascii': 'utf-8', ascii: 'utf-8', 'x-unknown': 'utf-8', unknown: 'utf-8' };

export function decodeCharset(bytes, charset = 'utf-8') {
  let cs = String(charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  cs = CHARSET_ALIASES[cs] || cs;
  try {
    return new TextDecoder(cs, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function binaryToUtf8OrLatin1(bin) {
  const buf = Buffer.from(bin, 'latin1');
  const utf8 = buf.toString('utf8');
  return utf8.includes('\uFFFD') ? bin : utf8;
}

// ---------- Kodierungen ----------

export function qpDecode(bin, inHeader = false) {
  const s = inHeader ? bin.replace(/_/g, ' ') : bin.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g;

// "=?UTF-8?B?...?=" in Kopfzeilen entschlüsseln (RFC 2047)
export function decodeWords(input) {
  if (!input) return '';
  const str = String(input);
  const pieces = [];
  let last = 0;
  let m;
  ENCODED_WORD.lastIndex = 0;
  while ((m = ENCODED_WORD.exec(str))) {
    const between = str.slice(last, m.index);
    const prev = pieces[pieces.length - 1];
    const charset = m[1].split('*')[0];
    const bytes = m[2].toUpperCase() === 'B' ? Buffer.from(m[3], 'base64') : qpDecode(m[3], true);
    if (prev && prev.encoded && /^\s*$/.test(between)) {
      if (prev.charset.toLowerCase() === charset.toLowerCase()) prev.bytes = Buffer.concat([prev.bytes, bytes]);
      else pieces.push({ encoded: true, charset, bytes });
    } else {
      if (between) pieces.push({ encoded: false, text: between });
      pieces.push({ encoded: true, charset, bytes });
    }
    last = ENCODED_WORD.lastIndex;
  }
  if (last < str.length) pieces.push({ encoded: false, text: str.slice(last) });
  return pieces.map((p) => (p.encoded ? decodeCharset(p.bytes, p.charset) : p.text)).join('');
}

// ---------- Kopfzeilen ----------

export function parseHeaders(bin) {
  const headers = new Map();
  const unfolded = bin.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!headers.has(name)) headers.set(name, []);
    headers.get(name).push(value);
  }
  return headers;
}

export function parseHeaderValue(str) {
  const out = { value: '', params: {} };
  if (!str) return out;
  const parts = [];
  let cur = '';
  let quoted = false;
  for (const ch of str) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  out.value = parts.shift().trim().toLowerCase();
  const continued = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    let key = p.slice(0, eq).trim().toLowerCase();
    let val = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
    const m = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (m) {
      // RFC 2231: name*=utf-8''Gr%C3%BC%C3%9Fe.pdf oder name*0*=...
      key = m[1];
      if (!continued[key]) continued[key] = [];
      continued[key].push({ idx: Number(m[2] || 0), val, enc: Boolean(m[3]) || m[2] === undefined });
      continue;
    }
    out.params[key] = decodeWords(binaryToUtf8OrLatin1(val));
  }
  for (const [key, chunks] of Object.entries(continued)) {
    chunks.sort((a, b) => a.idx - b.idx);
    let charset = 'utf-8';
    const bytes = [];
    chunks.forEach((c, i) => {
      let v = c.val;
      if (c.enc) {
        if (i === 0) {
          const q = v.split("'");
          if (q.length >= 3) {
            charset = q[0] || 'utf-8';
            v = q.slice(2).join("'");
          }
        }
        bytes.push(Buffer.from(v.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'));
      } else bytes.push(Buffer.from(v, 'latin1'));
    });
    out.params[key] = decodeCharset(Buffer.concat(bytes), charset);
  }
  return out;
}

export function headerText(headers, name) {
  const v = headers.get(name)?.[0];
  return v ? decodeWords(binaryToUtf8OrLatin1(v)) : '';
}

// ---------- MIME-Teile ----------

function decodeTransfer(bin, cte) {
  switch (cte) {
    case 'base64':
      return Buffer.from(bin.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    case 'quoted-printable':
      return qpDecode(bin);
    default:
      return Buffer.from(bin, 'latin1');
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitMultipart(body, boundary) {
  const text = '\r\n' + body;
  const re = new RegExp('\\r?\\n--' + escapeRe(boundary) + '(--)?[ \\t]*(?=\\r?\\n|$)', 'g');
  const parts = [];
  let start = null;
  let m;
  while ((m = re.exec(text))) {
    if (start !== null) parts.push(text.slice(start, m.index));
    if (m[1]) {
      start = null;
      break;
    }
    start = re.lastIndex;
    if (text[start] === '\r') start++;
    if (text[start] === '\n') start++;
  }
  if (start !== null && start < text.length) parts.push(text.slice(start));
  return parts;
}

function parsePart(bin, depth = 0) {
  const sepMatch = /\r?\n\r?\n/.exec(bin);
  const headerStr = sepMatch ? bin.slice(0, sepMatch.index) : bin;
  const body = sepMatch ? bin.slice(sepMatch.index + sepMatch[0].length) : '';
  const headers = parseHeaders(headerStr);
  const ct = parseHeaderValue(headers.get('content-type')?.[0] || 'text/plain; charset=us-ascii');
  const disp = parseHeaderValue(headers.get('content-disposition')?.[0] || '');
  const cte = (headers.get('content-transfer-encoding')?.[0] || '7bit').trim().toLowerCase();
  if (ct.value.startsWith('multipart/') && ct.params.boundary && depth < 12) {
    return { headers, ct, disp, parts: splitMultipart(body, ct.params.boundary).map((p) => parsePart(p, depth + 1)) };
  }
  return { headers, ct, disp, bytes: decodeTransfer(body, cte) };
}

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', zwnj: '', zwj: '', shy: '', eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', ccedil: 'ç' };

export function htmlToText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|tr|h[1-6]|table|blockquote|ul|ol|section|article)>/gi, '\n')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      return !label || href.startsWith('mailto:') || label === href ? label || href : `${label} (${href})`;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
      }
      return NAMED[e] ?? m;
    })
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Ganze Nachricht (Buffer) -> { subject, from, to, cc, date, messageId, text, attachments }
 */
export function parseMessage(buf) {
  const bin = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf);
  const tree = parsePart(bin);
  const plain = [];
  const html = [];
  const attachments = [];
  const walk = (node, inAlternative = false) => {
    if (node.parts) {
      const alt = node.ct.value === 'multipart/alternative';
      if (alt) {
        // nur die beste Variante nehmen
        const textPart = node.parts.find((p) => !p.parts && p.ct.value === 'text/plain');
        const htmlPart = node.parts.find((p) => !p.parts && p.ct.value === 'text/html');
        const nested = node.parts.find((p) => p.parts);
        if (textPart) walk(textPart, true);
        else if (nested) walk(nested, true);
        else if (htmlPart) walk(htmlPart, true);
        return;
      }
      node.parts.forEach((p) => walk(p, inAlternative));
      return;
    }
    const filename = node.disp.params.filename || node.ct.params.name || '';
    const isAttachment = node.disp.value === 'attachment' || (filename && !node.ct.value.startsWith('text/'));
    if (!isAttachment && node.ct.value === 'text/plain') plain.push(decodeCharset(node.bytes, node.ct.params.charset));
    else if (!isAttachment && node.ct.value === 'text/html') html.push(decodeCharset(node.bytes, node.ct.params.charset));
    else if (node.ct.value !== 'application/pgp-signature' && (filename || isAttachment)) {
      attachments.push({ filename: filename || 'Anhang', contentType: node.ct.value, size: node.bytes.length });
    }
  };
  walk(tree);
  let text = plain.join('\n\n').trim();
  if (!text && html.length) text = htmlToText(html.join('\n'));
  return {
    subject: headerText(tree.headers, 'subject'),
    from: headerText(tree.headers, 'from'),
    to: headerText(tree.headers, 'to'),
    cc: headerText(tree.headers, 'cc'),
    replyTo: headerText(tree.headers, 'reply-to'),
    date: tree.headers.get('date')?.[0] || '',
    messageId: tree.headers.get('message-id')?.[0] || '',
    references: tree.headers.get('references')?.[0] || '',
    text: text.replace(/\r\n/g, '\n'),
    attachments,
  };
}

// ---------- Entwurf zusammenbauen ----------

const NON_ASCII = /[^\x20-\x7e]/;

export function encodeWord(str) {
  if (!NON_ASCII.test(str)) return str;
  const chars = [...str];
  const out = [];
  for (let i = 0; i < chars.length; i += 20) {
    out.push(`=?UTF-8?B?${Buffer.from(chars.slice(i, i + 20).join(''), 'utf8').toString('base64')}?=`);
  }
  return out.join(' ');
}

function assertHeaderSafe(value, label) {
  if (/[\r\n]/.test(value)) throw new Error(`${label} darf keine Zeilenumbrüche enthalten.`);
}

// "Max Muster <max@example.com>, anna@example.com" -> [{ name, address }]
export function parseAddressList(input) {
  const list = [];
  const parts = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  for (const ch of String(input || '')) {
    if (ch === '"') quoted = !quoted;
    if (ch === '<') angle++;
    if (ch === '>') angle = Math.max(0, angle - 1);
    if ((ch === ',' || ch === ';') && !quoted && !angle) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(p);
    if (m) list.push({ name: m[1].trim().replace(/^"|"$/g, ''), address: m[2] });
    else if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(p)) list.push({ name: '', address: p });
    else throw new Error(`Ungültige E-Mail-Adresse: ${p}`);
  }
  return list;
}

function formatAddress({ name, address }) {
  if (!name) return address;
  if (NON_ASCII.test(name)) return `${encodeWord(name)} <${address}>`;
  return `"${name.replace(/["\\]/g, '')}" <${address}>`;
}

function rfc2822Date(ms) {
  const d = new Date(ms);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

export function composeMessage({ from, to, cc, subject, body, inReplyTo, references, nowMs = Date.now() }) {
  const toList = parseAddressList(to);
  if (!toList.length) throw new Error('Mindestens ein Empfänger ist nötig.');
  const ccList = cc ? parseAddressList(cc) : [];
  for (const [v, label] of [[subject || '', 'Der Betreff'], [inReplyTo || '', 'In-Reply-To'], [references || '', 'References'], [from || '', 'Absender']]) assertHeaderSafe(v, label);
  const domain = String(from || 'localhost').split('@')[1]?.replace(/[>\s]/g, '') || 'localhost';
  const lines = [
    `From: ${from}`,
    `To: ${toList.map(formatAddress).join(', ')}`,
    ...(ccList.length ? [`Cc: ${ccList.map(formatAddress).join(', ')}`] : []),
    `Subject: ${encodeWord(subject || '')}`,
    `Date: ${rfc2822Date(nowMs)}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references || inReplyTo ? [`References: ${[references, inReplyTo].filter(Boolean).join(' ')}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  const b64 = Buffer.from(String(body || '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return Buffer.from(lines.join('\r\n') + '\r\n\r\n' + b64, 'utf8');
}
