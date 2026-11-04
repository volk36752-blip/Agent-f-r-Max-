import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToMs, todayIso, addDaysIso, localDateTimeToMs, msToLocalIso, resolveTimeZone } from '../src/lib/tz.js';
import { eventsInRange, buildEvent, parseICS, findMasterEvent, getProp } from '../src/lib/ical.js';
import { parseXml, descendants, DAV, textOf } from '../src/lib/xml.js';
import { decodeWords, parseMessage, composeMessage, htmlToText, parseAddressList } from '../src/lib/mime.js';
import { tokenize, findResponseEnd, parseFetch, decodeMailboxName, encodeMailboxName } from '../src/lib/imap.js';

const TZ = 'Europe/Berlin';
const range = (from, to) => [localDateTimeToMs(`${from}T00:00`, TZ), localDateTimeToMs(`${to}T00:00`, TZ)];
const local = (ms) => msToLocalIso(ms, TZ);

test('Zeitzonen: Sommer- und Winterzeit', () => {
  assert.equal(new Date(zonedToMs(2026, 7, 1, 12, 0, 0, TZ)).toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(new Date(zonedToMs(2026, 11, 4, 12, 0, 0, TZ)).toISOString(), '2026-11-04T11:00:00.000Z');
  assert.equal(todayIso(TZ, Date.parse('2026-11-04T23:30:00Z')), '2026-11-05');
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(resolveTimeZone('W. Europe Standard Time', 'UTC'), 'Europe/Berlin');
  assert.equal(resolveTimeZone('Quatsch/Zone', 'Europe/Berlin'), 'Europe/Berlin');
});

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

test('Einzeltermin mit Zeitzone und Zeilenumbruch', () => {
  const ics = wrap(`BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:a1\r\nDTSTART;TZID=Europe/Berlin:20261104T100000\r\nDTEND;TZID=Europe/Berlin:20261104T113000\r\nSUMMARY:Zahnarzt\\, Kontrolle\r\nLOCATION:Praxis Dr. M\r\n üller\r\nEND:VEVENT`);
  const evs = eventsInRange(ics, ...range('2026-11-04', '2026-11-05'), TZ);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].title, 'Zahnarzt, Kontrolle');
  assert.equal(evs[0].location, 'Praxis Dr. Müller');
  assert.equal(local(evs[0].startMs), '2026-11-04T10:00');
  assert.equal(local(evs[0].endMs), '2026-11-04T11:30');
});

test('Ganztägiger Termin über zwei Tage', () => {
  const ics = wrap('BEGIN:VEVENT\r\nUID:a2\r\nDTSTART;VALUE=DATE:20261104\r\nDTEND;VALUE=DATE:20261106\r\nSUMMARY:Urlaub\r\nEND:VEVENT');
  const evs = eventsInRange(ics, ...range('2026-11-05', '2026-11-06'), TZ);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].allDay, true);
  assert.equal(evs[0].startDate, '2026-11-04');
  assert.equal(evs[0].endDate, '2026-11-06');
});

test('Wöchentlich mit Ausnahme, verschobenem Termin und Zeitumstellung', () => {
  const ics = wrap([
    'BEGIN:VEVENT', 'UID:w1', 'DTSTART;TZID=Europe/Berlin:20261007T180000', 'DTEND;TZID=Europe/Berlin:20261007T190000',
    'RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE;TZID=Europe/Berlin:20261021T180000', 'SUMMARY:Training', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:w1', 'RECURRENCE-ID;TZID=Europe/Berlin:20261028T180000', 'DTSTART;TZID=Europe/Berlin:20261029T190000',
    'DTEND;TZID=Europe/Berlin:20261029T200000', 'SUMMARY:Training (verschoben)', 'END:VEVENT',
  ].join('\r\n'));
  const evs = eventsInRange(ics, ...range('2026-10-01', '2026-11-12'), TZ);
  assert.deepEqual(evs.map((e) => local(e.startMs)), ['2026-10-07T18:00', '2026-10-14T18:00', '2026-10-29T19:00', '2026-11-04T18:00', '2026-11-11T18:00']);
  assert.equal(evs[2].title, 'Training (verschoben)');
  assert.ok(evs.every((e) => e.recurring));
});

test('Monatlich: letzter Freitag, COUNT und UNTIL', () => {
  const ics = wrap('BEGIN:VEVENT\r\nUID:m1\r\nDTSTART:20260130T090000Z\r\nDURATION:PT1H\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=4\r\nSUMMARY:Monatsrunde\r\nEND:VEVENT');
  const evs = eventsInRange(ics, ...range('2026-01-01', '2026-12-31'), TZ);
  assert.deepEqual(evs.map((e) => new Date(e.startMs).toISOString().slice(0, 10)), ['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24']);
  const ics2 = wrap('BEGIN:VEVENT\r\nUID:m2\r\nDTSTART;VALUE=DATE:20260115\r\nRRULE:FREQ=MONTHLY;UNTIL=20260415\r\nSUMMARY:Miete\r\nEND:VEVENT');
  assert.deepEqual(eventsInRange(ics2, ...range('2026-01-01', '2026-12-31'), TZ).map((e) => e.startDate), ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
});

test('Jährlich (Geburtstag) und täglich mit Intervall', () => {
  const ics = wrap('BEGIN:VEVENT\r\nUID:y1\r\nDTSTART;VALUE=DATE:19980305\r\nDTEND;VALUE=DATE:19980306\r\nRRULE:FREQ=YEARLY\r\nSUMMARY:Geburtstag Oma\r\nEND:VEVENT');
  const evs = eventsInRange(ics, ...range('2027-03-01', '2027-03-10'), TZ);
  assert.deepEqual(evs.map((e) => e.startDate), ['2027-03-05']);
  const ics2 = wrap('BEGIN:VEVENT\r\nUID:d1\r\nDTSTART;TZID=Europe/Berlin:20261101T070000\r\nRRULE:FREQ=DAILY;INTERVAL=2\r\nSUMMARY:Laufen\r\nEND:VEVENT');
  assert.deepEqual(eventsInRange(ics2, ...range('2026-11-04', '2026-11-08'), TZ).map((e) => local(e.startMs)), ['2026-11-05T07:00', '2026-11-07T07:00']);
});

test('Werktags-Regel mit BYSETPOS', () => {
  const ics = wrap('BEGIN:VEVENT\r\nUID:s1\r\nDTSTART;TZID=Europe/Berlin:20261130T080000\r\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\r\nSUMMARY:Monatsabschluss\r\nEND:VEVENT');
  const evs = eventsInRange(ics, ...range('2026-11-01', '2027-03-01'), TZ);
  assert.deepEqual(evs.map((e) => local(e.startMs).slice(0, 10)), ['2026-11-30', '2026-12-31', '2027-01-29', '2027-02-26']);
});

test('Neuer Termin wird korrekt geschrieben und wieder gelesen', () => {
  const startMs = localDateTimeToMs('2026-11-05T09:30', TZ);
  const ics = buildEvent({ uid: 'neu-1', title: 'Treffen mit Lena; Café, Stadtmitte', location: 'Café', notes: 'Zeile 1\nZeile 2', times: { allDay: false, startMs, endMs: startMs + 3600000 } });
  assert.match(ics, /DTSTART:20261105T083000Z/);
  const evs = eventsInRange(ics, ...range('2026-11-05', '2026-11-06'), TZ);
  assert.equal(evs[0].title, 'Treffen mit Lena; Café, Stadtmitte');
  assert.equal(evs[0].notes, 'Zeile 1\nZeile 2');
  const longTitle = 'Ä'.repeat(60);
  const ics2 = buildEvent({ uid: 'neu-2', title: longTitle, times: { allDay: true, startDate: '2026-11-05', endDate: '2026-11-06' } });
  assert.ok(ics2.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(getProp(findMasterEvent(parseICS(ics2)), 'SUMMARY').value, longTitle);
});

test('XML mit Namensräumen', () => {
  const xml = `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/1/calendars/home/</href><propstat><prop><C:calendar-data><![CDATA[BEGIN:VCALENDAR]]></C:calendar-data><displayname>Privat &amp; Familie</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
  const doc = parseXml(xml);
  const resp = descendants(doc, DAV, 'response');
  assert.equal(resp.length, 1);
  assert.equal(textOf(descendants(doc, DAV, 'displayname')[0]), 'Privat & Familie');
  assert.equal(textOf(descendants(doc, 'urn:ietf:params:xml:ns:caldav', 'calendar-data')[0]), 'BEGIN:VCALENDAR');
});

test('MIME: Kopfzeilen, mehrteilige Mail, HTML', () => {
  assert.equal(decodeWords('=?UTF-8?B?R3LDvMOfZQ==?= aus =?iso-8859-1?Q?M=FCnchen?='), 'Grüße aus München');
  assert.equal(decodeWords('=?UTF-8?Q?Sch=C3=B6n?= =?UTF-8?Q?_hier?='), 'Schön hier');
  const raw = [
    'From: =?UTF-8?Q?J=C3=BCrgen?= <juergen@example.com>',
    'To: du@icloud.com',
    'Subject: =?UTF-8?B?VGVybWluIGFtIEZyZWl0YWc/?=',
    'Content-Type: multipart/mixed; boundary="abc"',
    '',
    '--abc',
    'Content-Type: multipart/alternative; boundary="xyz"',
    '',
    '--xyz',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hast du Freitag um 15 Uhr Zeit? Gr=C3=BC=C3=9Fe',
    '--xyz',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>HTML</p>',
    '--xyz--',
    '--abc',
    'Content-Type: application/pdf; name="Plan.pdf"',
    'Content-Disposition: attachment; filename*=utf-8\'\'Pl%C3%A4ne.pdf',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQ=',
    '--abc--',
    '',
  ].join('\r\n');
  const msg = parseMessage(Buffer.from(raw, 'utf8'));
  assert.equal(msg.subject, 'Termin am Freitag?');
  assert.equal(msg.from, 'Jürgen <juergen@example.com>');
  assert.equal(msg.text, 'Hast du Freitag um 15 Uhr Zeit? Grüße');
  assert.deepEqual(msg.attachments.map((a) => a.filename), ['Pläne.pdf']);
  assert.equal(htmlToText('<style>x{}</style><p>Hallo&nbsp;du</p><ul><li>Eins</li></ul><a href="https://a.de">Link</a>'), 'Hallo du\n\n• Eins\nLink (https://a.de)');
});

test('MIME: Entwurf bauen und wieder lesen', () => {
  const buf = composeMessage({ from: 'ich@icloud.com', to: 'Jürgen Mayer <j@example.com>', subject: 'Re: Grüße', body: 'Ja, passt!\nBis dann' });
  const msg = parseMessage(buf);
  assert.equal(msg.subject, 'Re: Grüße');
  assert.equal(msg.to, 'Jürgen Mayer <j@example.com>');
  assert.equal(msg.text, 'Ja, passt!\nBis dann');
  assert.throws(() => composeMessage({ from: 'a@b.de', to: 'x@y.de', subject: 'a\r\nBcc: evil@x.de', body: '' }));
  assert.throws(() => parseAddressList('kein-empfaenger'));
});

test('IMAP: Antworten zerlegen', () => {
  const line = '* 12 FETCH (UID 345 FLAGS (\\Seen \\Flagged) INTERNALDATE "04-Nov-2026 10:00:00 +0100" ENVELOPE ("Wed, 4 Nov 2026 10:00:00 +0100" "=?UTF-8?Q?Hast_du_Zeit=3F?=" (("Lena" NIL "lena" "example.com")) NIL NIL ((NIL NIL "ich" "icloud.com")) NIL NIL NIL "<id@x>") BODY[] {5}\r\nHallo)';
  const buf = Buffer.from(line + '\r\n* 13 EXISTS\r\n', 'latin1');
  const end = findResponseEnd(buf);
  assert.equal(buf.subarray(0, end).toString('latin1'), line + '\r\n');
  const data = tokenize(line.slice(line.indexOf('(')));
  const m = parseFetch(data[0]);
  assert.equal(m.uid, 345);
  assert.deepEqual(m.flags, ['\\Seen', '\\Flagged']);
  assert.equal(m.envelope.subject, 'Hast du Zeit?');
  assert.deepEqual(m.envelope.from, [{ name: 'Lena', address: 'lena@example.com' }]);
  assert.equal(m.body.toString(), 'Hallo');
  assert.equal(new Date(m.internalDate).toISOString(), '2026-11-04T09:00:00.000Z');
  assert.equal(decodeMailboxName('Entw&APw-rfe'), 'Entwürfe');
  assert.equal(encodeMailboxName('Entwürfe & Co'), 'Entw&APw-rfe &- Co');
});
