// Kleiner XML-Parser mit Namensräumen – reicht für CalDAV-Antworten (WebDAV multistatus).

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  return attrs;
}

/** Liefert den Wurzelknoten: { ns, name, attrs, children, text } */
export function parseXml(xml) {
  const root = { ns: '', name: '#document', attrs: {}, children: [], text: '' };
  const stack = [{ node: root, nsMap: { xml: 'http://www.w3.org/XML/1998/namespace' } }];
  let i = 0;
  const s = String(xml);
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.node.text += decodeEntities(s.slice(i));
      break;
    }
    if (lt > i) top.node.text += decodeEntities(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      top.node.text += s.slice(lt + 9, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s[lt + 1] === '?' || s[lt + 1] === '!') {
      const end = s.indexOf('>', lt);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    // Tag-Ende suchen (Anführungszeichen in Attributen beachten)
    let j = lt + 1;
    let quote = null;
    while (j < s.length) {
      const ch = s[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    const inner = s.slice(lt + 1, j);
    i = j + 1;
    if (inner[0] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const sp = body.search(/\s/);
    const qname = sp < 0 ? body : body.slice(0, sp);
    const attrs = parseAttrs(sp < 0 ? '' : body.slice(sp));
    const nsMap = { ...top.nsMap };
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'xmlns') nsMap[''] = v;
      else if (k.startsWith('xmlns:')) nsMap[k.slice(6)] = v;
    }
    const colon = qname.indexOf(':');
    const prefix = colon < 0 ? '' : qname.slice(0, colon);
    const local = colon < 0 ? qname : qname.slice(colon + 1);
    const node = { ns: nsMap[prefix] ?? '', name: local, attrs, children: [], text: '' };
    top.node.children.push(node);
    if (!selfClosing) stack.push({ node, nsMap });
  }
  return root;
}

export const DAV = 'DAV:';
export const CALDAV = 'urn:ietf:params:xml:ns:caldav';
export const APPLE_ICAL = 'http://apple.com/ns/ical/';
export const CALSERVER = 'http://calendarserver.org/ns/';

export function child(node, ns, name) {
  return node?.children.find((c) => c.ns === ns && c.name === name) || null;
}

export function children(node, ns, name) {
  return node ? node.children.filter((c) => c.ns === ns && c.name === name) : [];
}

export function descendants(node, ns, name, out = []) {
  if (!node) return out;
  for (const c of node.children) {
    if (c.ns === ns && c.name === name) out.push(c);
    descendants(c, ns, name, out);
  }
  return out;
}

export function textOf(node) {
  if (!node) return '';
  return (node.text + node.children.map(textOf).join('')).trim();
}
