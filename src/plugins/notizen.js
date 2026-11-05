// Plugin „Notizen“: Apple Notizen durchsuchen, lesen und neue Notizen anlegen.

import { runJxa, JxaError } from '../lib/jxa.js';

const SEARCH = `// @notes.search
function run(argv) {
  const input = JSON.parse(argv[0]);
  const Notes = Application('Notes');
  const spec = input.query ? Notes.notes.whose({ _or: [{ name: { _contains: input.query } }, { plaintext: { _contains: input.query } }] }) : Notes.notes;
  const ids = spec.id();
  const names = spec.name();
  const dates = spec.modificationDate();
  const rows = ids.map(function (id, i) { return { id: id, name: names[i], date: dates[i] ? dates[i].getTime() : null }; });
  rows.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
  return JSON.stringify(rows.slice(0, input.limit || 15));
}`;

const READ = `// @notes.read
function run(argv) {
  const input = JSON.parse(argv[0]);
  const n = Application('Notes').notes.byId(input.id);
  return JSON.stringify({ name: n.name(), text: String(n.plaintext() || '').slice(0, 12000), date: n.modificationDate().getTime() });
}`;

const CREATE = `// @notes.create
function run(argv) {
  const input = JSON.parse(argv[0]);
  const Notes = Application('Notes');
  const n = Notes.make({ new: 'note', withProperties: { body: input.html } });
  return JSON.stringify({ id: n.id(), name: n.name() });
}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function jxa(ctx, source, input) {
  await ctx.services.apps.ensurePermission('notes', 'Notizen');
  try {
    return await runJxa(source, input, { timeoutMs: 60000 });
  } catch (err) {
    if (err instanceof JxaError && err.code === 'denied') throw new Error('Ich darf die Notizen-App nicht steuern. Erlauben kannst du es unter Einstellungen → Apps.');
    if (err instanceof JxaError && err.code === 'notFound') throw new Error('Diese Notiz gibt es nicht mehr.');
    throw err;
  }
}

export default {
  id: 'notizen',
  name: 'Notizen',
  description: 'Der Agent durchsucht und liest deine Apple Notizen und legt neue an – zum Beispiel „Schreib mir die Einkaufsliste auf“.',
  icon: 'note',
  color: 'amber',
  needsMac: true,
  examples: ['Such meine Notiz zum Urlaub', 'Leg eine Notiz „Einkaufen“ an: Milch, Brot, Äpfel'],
  tools: [
    {
      name: 'notes_search',
      title: 'Notizen suchen',
      short: 'Sucht Notizen nach einem Wort.',
      description: 'Sucht in den Apple Notizen nach einem Wort (Titel und Text). Ohne Suche: die neuesten Notizen.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: [], additionalProperties: false },
      readOnly: true,
      async run(args, ctx) {
        const rows = await jxa(ctx, SEARCH, { query: args.query || '', limit: 15 });
        return { notizen: (rows || []).map((r) => ({ id: r.id, titel: r.name, geaendert: r.date ? new Date(r.date).toISOString().slice(0, 10) : undefined })) };
      },
    },
    {
      name: 'note_read',
      title: 'Notiz lesen',
      short: 'Liest eine Notiz (id aus notes_search).',
      description: 'Liest eine Apple Notiz (id aus notes_search).',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      readOnly: true,
      async run(args, ctx) {
        const n = await jxa(ctx, READ, { id: args.id });
        return { titel: n.name, text: n.text };
      },
    },
    {
      name: 'note_create',
      title: 'Notiz anlegen',
      short: 'Legt eine neue Notiz an (title, text).',
      description: 'Legt eine neue Apple Notiz an. Der Titel wird die erste Zeile.',
      input_schema: { type: 'object', properties: { title: { type: 'string', maxLength: 200 }, text: { type: 'string', maxLength: 20000 } }, required: ['title'], additionalProperties: false },
      async run(args, ctx) {
        const lines = String(args.text || '').split('\n').map((l) => `<div>${esc(l) || '<br>'}</div>`).join('');
        const html = `<div><h1>${esc(args.title)}</h1></div>${lines}`;
        const n = await jxa(ctx, CREATE, { html });
        return { angelegt: true, titel: n?.name || args.title };
      },
    },
  ],
};
