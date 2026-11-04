// Nachgebaute Server für Tests: CalDAV (wie iCloud), IMAP, Claude-API, Wetter.

import http from 'node:http';
import net from 'node:net';
import { parseHeaders } from '../src/lib/mime.js';
import { tokenize } from '../src/lib/imap.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

// ---------------- CalDAV ----------------

export async function startCalDAV({ user, password }) {
  const objects = new Map(); // path -> { ics, etag }
  let etagSeq = 1;
  const calendars = [
    { path: '/123/calendars/privat/', name: 'Privat', color: '#1BADF8FF', comps: ['VEVENT'], readOnly: false },
    { path: '/123/calendars/feiertage/', name: 'Feiertage', color: '#CC73E1', comps: ['VEVENT'], readOnly: true },
    { path: '/123/calendars/tasks/', name: 'Erinnerungen', color: '#FF2968', comps: ['VTODO'], readOnly: false },
  ];
  const log = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    log.push(`${req.method} ${req.url}`);
    const expected = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' });
      return res.end();
    }
    const base = `http://127.0.0.1:${server.address().port}`;
    const ms = (inner) => {
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">${inner}</multistatus>`);
    };
    if (req.method === 'PROPFIND' && req.url === '/') {
      return ms('<response><href>/</href><propstat><prop><current-user-principal><href>/123/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response>');
    }
    if (req.method === 'PROPFIND' && req.url === '/123/principal/') {
      return ms(`<response><href>/123/principal/</href><propstat><prop><C:calendar-home-set><href>${base}/123/calendars/</href></C:calendar-home-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>`);
    }
    if (req.method === 'PROPFIND' && req.url === '/123/calendars/') {
      const own = '<response><href>/123/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>';
      const inbox = '<response><href>/123/calendars/inbox/</href><propstat><prop><resourcetype><collection/><C:schedule-inbox/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>';
      const cals = calendars.map((c) => `<response><href>${c.path}</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>${c.name}</displayname><C:supported-calendar-component-set>${c.comps.map((x) => `<C:comp name="${x}"/>`).join('')}</C:supported-calendar-component-set><A:calendar-color>${c.color}</A:calendar-color><current-user-privilege-set><privilege><read/></privilege>${c.readOnly ? '' : '<privilege><write/></privilege>'}</current-user-privilege-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>`).join('');
      return ms(own + inbox + cals);
    }
    if (req.method === 'REPORT') {
      const items = [...objects.entries()].filter(([p]) => p.startsWith(req.url));
      return ms(items.map(([p, o]) => `<response><href>${p}</href><propstat><prop><getetag>"${o.etag}"</getetag><C:calendar-data>${o.ics.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>`).join(''));
    }
    if (req.method === 'GET') {
      const o = objects.get(req.url);
      if (!o) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'text/calendar', ETag: `"${o.etag}"` });
      return res.end(o.ics);
    }
    if (req.method === 'PUT') {
      const exists = objects.has(req.url);
      if (req.headers['if-none-match'] === '*' && exists) {
        res.writeHead(412);
        return res.end();
      }
      if (req.headers['if-match'] && (!exists || req.headers['if-match'] !== `"${objects.get(req.url).etag}"`)) {
        res.writeHead(412);
        return res.end();
      }
      const etag = String(etagSeq++);
      objects.set(req.url, { ics: body, etag });
      res.writeHead(exists ? 204 : 201, { ETag: `"${etag}"` });
      return res.end();
    }
    if (req.method === 'DELETE') {
      const o = objects.get(req.url);
      if (o && req.headers['if-match'] && req.headers['if-match'] !== `"${o.etag}"`) {
        res.writeHead(412);
        return res.end();
      }
      objects.delete(req.url);
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(405);
    res.end();
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}/`,
    objects,
    log,
    add(path, ics) {
      objects.set(path, { ics, etag: String(etagSeq++) });
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

// ---------------- IMAP ----------------

function imapString(s) {
  if (s === null || s === undefined || s === '') return 'NIL';
  return `"${String(s).replace(/[\\"]/g, '\\$&')}"`;
}

function addrList(header) {
  if (!header) return 'NIL';
  const parts = header.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = /^(.*)<([^@>]+)@([^>]+)>$/.exec(p);
    if (m) return `(${imapString(m[1].trim().replace(/^"|"$/g, '') || null)} NIL ${imapString(m[2])} ${imapString(m[3])})`;
    const [mb, host] = p.split('@');
    return `(NIL NIL ${imapString(mb)} ${imapString(host)})`;
  });
  return `(${parts.join(' ')})`;
}

function envelope(raw) {
  const head = raw.toString('utf8').split(/\r?\n\r?\n/)[0];
  const h = parseHeaders(head);
  const g = (n) => h.get(n)?.[0] || null;
  return `(${imapString(g('date'))} ${imapString(g('subject'))} ${addrList(g('from'))} ${addrList(g('from'))} ${addrList(g('reply-to') || g('from'))} ${addrList(g('to'))} ${addrList(g('cc'))} NIL ${imapString(g('in-reply-to'))} ${imapString(g('message-id'))})`;
}

export async function startImap({ user, password }) {
  const boxes = {
    INBOX: { flags: ['\\HasNoChildren'], msgs: [] },
    Drafts: { flags: ['\\HasNoChildren', '\\Drafts'], msgs: [] },
    Archive: { flags: ['\\HasNoChildren', '\\Archive'], msgs: [] },
    'Deleted Messages': { flags: ['\\HasNoChildren', '\\Trash'], msgs: [] },
    'Sent Messages': { flags: ['\\HasNoChildren', '\\Sent'], msgs: [] },
  };
  let uidNext = 100;
  const commands = [];
  const add = (box, raw, { seen = false, date = Date.now() } = {}) => {
    const m = { uid: uidNext++, flags: new Set(seen ? ['\\Seen'] : []), raw: Buffer.from(raw, 'utf8'), date };
    boxes[box].msgs.push(m);
    return m;
  };

  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let authed = false;
    let selected = null;
    let pendingLiteral = null; // { needed, collected, prefix }
    const send = (s) => sock.write(typeof s === 'string' ? Buffer.from(s, 'utf8') : s);
    send('* OK [CAPABILITY IMAP4rev1 MOVE UIDPLUS] Mock bereit\r\n');

    const fetchItems = (m, seq, items) => {
      const parts = [`UID ${m.uid}`];
      const up = items.toUpperCase();
      if (up.includes('FLAGS')) parts.push(`FLAGS (${[...m.flags].join(' ')})`);
      if (up.includes('INTERNALDATE')) parts.push('INTERNALDATE "04-Nov-2026 09:15:00 +0100"');
      if (up.includes('ENVELOPE')) parts.push(`ENVELOPE ${envelope(m.raw)}`);
      const chunks = [Buffer.from(`* ${seq} FETCH (${parts.join(' ')}`, 'utf8')];
      if (/BODY\.PEEK\[\]/i.test(items)) {
        chunks.push(Buffer.from(` BODY[]<0> {${m.raw.length}}\r\n`, 'latin1'), m.raw);
      } else if (/BODY\.PEEK\[HEADER\.FIELDS \(REFERENCES\)\]/i.test(items)) {
        const ref = /^references:.*$/im.exec(m.raw.toString('latin1'))?.[0] || '';
        const b = Buffer.from(ref ? `${ref}\r\n\r\n` : '\r\n', 'latin1');
        chunks.push(Buffer.from(` BODY[HEADER.FIELDS (REFERENCES)] {${b.length}}\r\n`, 'latin1'), b);
      }
      chunks.push(Buffer.from(')\r\n'));
      return Buffer.concat(chunks);
    };

    const run = (line) => {
      commands.push(line.replace(/LOGIN .*/, 'LOGIN ***'));
      const sp = line.indexOf(' ');
      const tag = line.slice(0, sp);
      const rest = line.slice(sp + 1);
      const tokens = tokenize(rest);
      const cmd = String(tokens[0] || '').toUpperCase();
      const ok = (t = 'erledigt') => send(`${tag} OK ${t}\r\n`);
      const no = (t) => send(`${tag} NO ${t}\r\n`);
      const strTok = (t) => (t && t.literal ? t.literal.toString('utf8') : String(t));
      if (cmd === 'CAPABILITY') {
        send('* CAPABILITY IMAP4rev1 MOVE UIDPLUS\r\n');
        return ok();
      }
      if (cmd === 'LOGOUT') {
        send('* BYE tschüss\r\n');
        ok();
        return sock.end();
      }
      if (cmd === 'LOGIN') {
        if (strTok(tokens[1]) === user && strTok(tokens[2]) === password) {
          authed = true;
          return ok();
        }
        return no('[AUTHENTICATIONFAILED] Authentication failed.');
      }
      if (!authed) return send(`${tag} BAD erst anmelden\r\n`);
      if (cmd === 'LIST') {
        for (const [name, b] of Object.entries(boxes)) send(`* LIST (${b.flags.join(' ')}) "/" "${name}"\r\n`);
        return ok();
      }
      if (cmd === 'SELECT' || cmd === 'EXAMINE') {
        const name = strTok(tokens[1]);
        if (!boxes[name]) return no('gibt es nicht');
        selected = name;
        send(`* ${boxes[name].msgs.length} EXISTS\r\n* OK [UIDVALIDITY 42] ok\r\n`);
        return ok(`[${cmd === 'EXAMINE' ? 'READ-ONLY' : 'READ-WRITE'}] ok`);
      }
      if (cmd === 'APPEND') {
        const name = strTok(tokens[1]);
        const flags = Array.isArray(tokens[2]) ? tokens[2] : [];
        const lit = tokens.find((t) => t && t.literal);
        const m = add(name, lit.literal.toString('utf8'));
        flags.forEach((f) => m.flags.add(f));
        return ok('[APPENDUID 42 ' + m.uid + '] ok');
      }
      if (cmd === 'UID') {
        const sub = String(tokens[1]).toUpperCase();
        const msgs = boxes[selected]?.msgs || [];
        if (sub === 'SEARCH') {
          let list = [...msgs];
          const crit = tokens.slice(2).map((t) => (t && t.literal ? t.literal.toString('utf8') : t));
          for (let i = 0; i < crit.length; i++) {
            const c = String(crit[i]).toUpperCase();
            if (c === 'UNSEEN') list = list.filter((m) => !m.flags.has('\\Seen'));
            if (c === 'TEXT') {
              const q = String(crit[i + 1]).toLowerCase();
              list = list.filter((m) => m.raw.toString('utf8').toLowerCase().includes(q));
            }
          }
          send(`* SEARCH ${list.map((m) => m.uid).join(' ')}\r\n`);
          return ok();
        }
        const uids = String(tokens[2]).split(',').map(Number);
        const hit = msgs.map((m, i) => ({ m, seq: i + 1 })).filter((x) => uids.includes(x.m.uid));
        if (sub === 'FETCH') {
          const items = rest.slice(rest.indexOf(String(tokens[2])) + String(tokens[2]).length + 1);
          hit.forEach(({ m, seq }) => send(fetchItems(m, seq, items)));
          return ok();
        }
        if (sub === 'STORE') {
          const op = String(tokens[3]).toUpperCase();
          const flags = tokens[4] || [];
          hit.forEach(({ m }) => flags.forEach((f) => (op.startsWith('+') ? m.flags.add(f) : m.flags.delete(f))));
          return ok();
        }
        if (sub === 'MOVE') {
          const dest = strTok(tokens[3]);
          if (!boxes[dest]) return no('[TRYCREATE] Ziel fehlt');
          hit.forEach(({ m }) => {
            boxes[selected].msgs.splice(boxes[selected].msgs.indexOf(m), 1);
            boxes[dest].msgs.push(m);
          });
          return ok();
        }
      }
      send(`${tag} BAD unbekannt\r\n`);
    };

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (pendingLiteral) {
          if (buf.length < pendingLiteral.needed) return;
          const lit = buf.subarray(0, pendingLiteral.needed);
          buf = buf.subarray(pendingLiteral.needed);
          pendingLiteral.prefix = Buffer.concat([pendingLiteral.prefix, lit]);
          pendingLiteral.needed = 0;
          const idx = buf.indexOf('\r\n');
          if (idx < 0) return;
          const restLine = buf.subarray(0, idx);
          buf = buf.subarray(idx + 2);
          const full = Buffer.concat([pendingLiteral.prefix, restLine]);
          const m2 = /\{(\d+)\}$/.exec(restLine.toString('latin1'));
          if (m2) {
            pendingLiteral = { needed: Number(m2[1]), prefix: Buffer.concat([full, Buffer.from('\r\n')]) };
            send('+ weiter\r\n');
            continue;
          }
          pendingLiteral = null;
          run(full.toString('latin1'));
          continue;
        }
        const idx = buf.indexOf('\r\n');
        if (idx < 0) return;
        const line = buf.subarray(0, idx).toString('latin1');
        buf = buf.subarray(idx + 2);
        const m = /\{(\d+)\}$/.exec(line);
        if (m) {
          pendingLiteral = { needed: Number(m[1]), prefix: Buffer.from(line + '\r\n', 'latin1') };
          send('+ weiter\r\n');
          continue;
        }
        run(line);
      }
    });
    sock.on('error', () => {});
  });
  const port = await listen(server);
  return { port, boxes, add, commands, close: () => new Promise((r) => server.close(r)) };
}

// ---------------- Claude-API ----------------

export async function startClaude({ apiKey, script }) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    if (req.headers['x-api-key'] !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5' }] }));
    }
    requests.push({ headers: req.headers, body });
    const reply = script(body, requests.length);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, usage: { input_tokens: 10, output_tokens: 5 }, ...reply }));
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

// ---------------- Wetter ----------------

export async function startWeather() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/v1/search')) {
      return res.end(JSON.stringify({ results: [{ name: 'Tübingen', admin1: 'Baden-Württemberg', country: 'Deutschland', latitude: 48.52, longitude: 9.05, timezone: 'Europe/Berlin' }] }));
    }
    const hours = Array.from({ length: 48 }, (_, i) => `2026-11-0${4 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`);
    res.end(JSON.stringify({
      timezone: 'Europe/Berlin',
      current: { temperature_2m: 9.4, apparent_temperature: 7.1, weather_code: 3, is_day: 1, wind_speed_10m: 12 },
      hourly: { time: hours, temperature_2m: hours.map((_, i) => 5 + (i % 24) / 3), precipitation_probability: hours.map(() => 20), weather_code: hours.map(() => 61) },
      daily: { time: ['2026-11-04', '2026-11-05'], weather_code: [3, 61], temperature_2m_max: [11.2, 9], temperature_2m_min: [3.8, 4], precipitation_probability_max: [30, 80], sunrise: ['2026-11-04T07:21', '2026-11-05T07:23'], sunset: ['2026-11-04T17:01', '2026-11-05T16:59'] },
    }));
  });
  return listen(server).then((port) => ({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) }));
}
