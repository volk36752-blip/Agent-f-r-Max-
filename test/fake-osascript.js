#!/usr/bin/env node
// Spielt „osascript“ für die Tests: erkennt das Skript an der Markierung in der ersten Zeile
// und antwortet aus einer JSON-Datei (FAKE_OSA_STATE).

import fs from 'node:fs';

const [, , , , , source, json] = process.argv;
const input = JSON.parse(json || '{}');
const file = process.env.FAKE_OSA_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const marker = (/\/\/ @([\w.]+)/.exec(source) || [])[1];
const save = () => fs.writeFileSync(file, JSON.stringify(state));

if (state.denied?.includes(marker?.split('.')[0])) {
  process.stderr.write('execution error: Error: Not authorized to send Apple events to Mail. (-1743)\n');
  process.exit(1);
}

const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const box = () => state.mail.filter((m) => (m.box || 'inbox') === (input.box || 'inbox'));

switch (marker) {
  case 'mail.list': {
    let list = box();
    if (input.unreadOnly) list = list.filter((m) => !m.read);
    if (input.query) list = list.filter((m) => `${m.subject} ${m.sender}`.toLowerCase().includes(input.query.toLowerCase()));
    out({ total: list.length, unread: box().filter((m) => !m.read).length, messages: list.slice(0, input.limit || 15).map(({ content, ...m }) => m) });
    break;
  }
  case 'mail.read': {
    const m = box().find((x) => x.id === input.id);
    if (!m) {
      process.stderr.write('execution error: Error: Can’t get object. (-1728)\n');
      process.exit(1);
    }
    if (input.markRead) m.read = true;
    save();
    out({ id: m.id, subject: m.subject, sender: m.sender, replyTo: '', to: ['ich@icloud.com'], cc: [], date: m.date, read: m.read, content: m.content, attachments: [] });
    break;
  }
  case 'mail.change': {
    const m = box().find((x) => x.id === input.id);
    if (input.read !== null && input.read !== undefined) m.read = input.read;
    if (input.move) m.box = input.move;
    save();
    out({ ok: true });
    break;
  }
  case 'mail.send': {
    state.sent = [...(state.sent || []), input];
    save();
    out(input.send ? { sent: true } : { opened: true });
    break;
  }
  default:
    process.stderr.write(`execution error: Error: Unbekanntes Testskript ${marker}\n`);
    process.exit(1);
}
