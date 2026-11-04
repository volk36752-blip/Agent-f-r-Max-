// CalDAV-Client (z. B. für den iCloud-Kalender) – nur mit fetch aus Node.

import { parseXml, child, children, descendants, textOf, DAV, CALDAV, APPLE_ICAL, CALSERVER } from './xml.js';

export class CalDAVError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const PROPFIND_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;

const PROPFIND_HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;

const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><a:calendar-color/><cs:getctag/><d:current-user-privilege-set/>
  </d:prop>
</d:propfind>`;

function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export class CalDAVClient {
  constructor({ serverUrl = 'https://caldav.icloud.com/', username, password, timeoutMs = 25000 }) {
    this.serverUrl = serverUrl;
    this.auth = 'Basic ' + Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    this.timeoutMs = timeoutMs;
    this.homeUrl = null;
  }

  async request(method, url, { body, depth, headers = {} } = {}) {
    let target = url;
    for (let hop = 0; hop < 5; hop++) {
      const h = { Authorization: this.auth, ...headers };
      if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/xml; charset=utf-8';
      if (depth !== undefined) h.Depth = String(depth);
      let res;
      try {
        res = await fetch(target, { method, headers: h, body, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        throw new CalDAVError(`Der Kalender-Server ist nicht erreichbar (${err.cause?.code || err.name}).`, 0);
      }
      if ([301, 302, 307, 308].includes(res.status) && res.headers.get('location')) {
        target = new URL(res.headers.get('location'), target).toString();
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new CalDAVError('Anmeldung beim Kalender fehlgeschlagen. Prüfe Apple-ID und app-spezifisches Passwort.', res.status);
      }
      return { res, url: target };
    }
    throw new CalDAVError('Zu viele Weiterleitungen vom Kalender-Server.', 0);
  }

  async multistatus(method, url, depth, body) {
    const { res, url: finalUrl } = await this.request(method, url, { body, depth });
    if (res.status !== 207) {
      throw new CalDAVError(`Kalender-Server antwortet mit Status ${res.status}.`, res.status);
    }
    const doc = parseXml(await res.text());
    const responses = descendants(doc, DAV, 'response').map((r) => {
      const href = textOf(child(r, DAV, 'href'));
      const props = {};
      for (const ps of children(r, DAV, 'propstat')) {
        const status = textOf(child(ps, DAV, 'status'));
        if (status && !/\s2\d\d\s/.test(status + ' ')) continue;
        const prop = child(ps, DAV, 'prop');
        for (const p of prop?.children || []) props[`${p.ns}|${p.name}`] = p;
      }
      return { href, url: new URL(href, finalUrl).toString(), props };
    });
    return { responses, url: finalUrl };
  }

  async discover() {
    if (this.homeUrl) return this.homeUrl;
    const first = await this.multistatus('PROPFIND', this.serverUrl, 0, PROPFIND_PRINCIPAL);
    const principalNode = first.responses.map((r) => r.props[`${DAV}|current-user-principal`]).find(Boolean);
    const principalHref = textOf(child(principalNode, DAV, 'href'));
    if (!principalHref) throw new CalDAVError('Kalender-Konto nicht gefunden (kein Principal).', 0);
    const principalUrl = new URL(principalHref, first.url).toString();
    const second = await this.multistatus('PROPFIND', principalUrl, 0, PROPFIND_HOME);
    const homeNode = second.responses.map((r) => r.props[`${CALDAV}|calendar-home-set`]).find(Boolean);
    const homeHref = textOf(child(homeNode, DAV, 'href'));
    if (!homeHref) throw new CalDAVError('Kalender-Ordner nicht gefunden.', 0);
    this.homeUrl = new URL(homeHref, second.url).toString();
    return this.homeUrl;
  }

  async listCalendars() {
    const home = await this.discover();
    const { responses } = await this.multistatus('PROPFIND', home, 1, PROPFIND_CALENDARS);
    const calendars = [];
    for (const r of responses) {
      const rt = r.props[`${DAV}|resourcetype`];
      if (!child(rt, CALDAV, 'calendar')) continue;
      const compSet = r.props[`${CALDAV}|supported-calendar-component-set`];
      const comps = children(compSet, CALDAV, 'comp').map((c) => (c.attrs.name || '').toUpperCase());
      if (comps.length && !comps.includes('VEVENT')) continue;
      let color = textOf(r.props[`${APPLE_ICAL}|calendar-color`]);
      if (/^#[0-9a-f]{8}$/i.test(color)) color = color.slice(0, 7);
      if (!/^#[0-9a-f]{6}$/i.test(color)) color = null;
      const privs = r.props[`${DAV}|current-user-privilege-set`];
      const readOnly = privs ? !descendants(privs, DAV, 'write').length && !descendants(privs, DAV, 'all').length && !descendants(privs, DAV, 'write-content').length : false;
      calendars.push({
        url: r.url,
        name: textOf(r.props[`${DAV}|displayname`]) || 'Kalender',
        color,
        ctag: textOf(r.props[`${CALSERVER}|getctag`]) || null,
        readOnly,
      });
    }
    return calendars;
  }

  async queryEvents(calendarUrl, startMs, endMs) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${utcStamp(startMs)}" end="${utcStamp(endMs)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
    const { responses } = await this.multistatus('REPORT', calendarUrl, 1, body);
    return responses
      .map((r) => ({ url: r.url, etag: textOf(r.props[`${DAV}|getetag`]) || null, ics: textOf(r.props[`${CALDAV}|calendar-data`]) }))
      .filter((r) => r.ics);
  }

  async get(url) {
    const { res } = await this.request('GET', url);
    if (res.status === 404) throw new CalDAVError('Den Termin gibt es nicht mehr.', 404);
    if (!res.ok) throw new CalDAVError(`Termin konnte nicht geladen werden (Status ${res.status}).`, res.status);
    return { ics: await res.text(), etag: res.headers.get('etag') };
  }

  async put(url, ics, { etag, create } = {}) {
    const headers = { 'Content-Type': 'text/calendar; charset=utf-8' };
    if (create) headers['If-None-Match'] = '*';
    else if (etag) headers['If-Match'] = etag;
    const { res } = await this.request('PUT', url, { body: ics, headers });
    if (res.status === 412) throw new CalDAVError('Der Termin wurde inzwischen woanders geändert. Bitte neu laden.', 412);
    if (!res.ok) throw new CalDAVError(`Termin konnte nicht gespeichert werden (Status ${res.status}).`, res.status);
    return { etag: res.headers.get('etag') };
  }

  async delete(url, etag) {
    const headers = {};
    if (etag) headers['If-Match'] = etag;
    const { res } = await this.request('DELETE', url, { headers });
    if (res.status === 412) throw new CalDAVError('Der Termin wurde inzwischen woanders geändert. Bitte neu laden.', 412);
    if (!res.ok && res.status !== 404) throw new CalDAVError(`Termin konnte nicht gelöscht werden (Status ${res.status}).`, res.status);
  }
}
