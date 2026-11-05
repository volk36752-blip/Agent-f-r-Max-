// Plugin „Kurzbefehle“: Der Agent kann deine Kurzbefehle (Shortcuts) starten – damit kann er fast alles,
// was dein Mac kann: Smart Home, Fokus, Musik, eigene Abläufe … Jeder Start wird per Karte bestätigt.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BIN = () => process.env.SHORTCUTS_BIN || '/usr/bin/shortcuts';

function run(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(BIN(), args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') return reject(new Error('Kurzbefehle gibt es nur auf dem Mac (ab macOS 12).'));
        return reject(new Error(String(stderr || err.message).trim().split('\n').pop() || 'Der Kurzbefehl ist fehlgeschlagen.'));
      }
      resolve(String(stdout));
    });
  });
}

let cache = { at: 0, names: null };
async function names() {
  if (cache.names && Date.now() - cache.at < 60000) return cache.names;
  const list = (await run(['list'], 20000)).split('\n').map((s) => s.trim()).filter(Boolean);
  cache = { at: Date.now(), names: list };
  return list;
}

async function runShortcut(name, input) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistent-kb-'));
  try {
    const out = path.join(dir, 'ausgabe.txt');
    const args = ['run', name, '--output-path', out, '--output-type', 'public.plain-text'];
    if (input) {
      const inFile = path.join(dir, 'eingabe.txt');
      await fs.writeFile(inFile, input, 'utf8');
      args.push('--input-path', inFile);
    }
    await run(args, 120000);
    const text = await fs.readFile(out, 'utf8').catch(() => '');
    return text.slice(0, 3000);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export default {
  id: 'kurzbefehle',
  name: 'Kurzbefehle',
  description: 'Der Agent startet deine Kurzbefehle aus der Kurzbefehle-App – für Smart Home, Fokus und alles, was du dort eingerichtet hast. Jeden Start bestätigst du mit einem Tipp.',
  icon: 'bolt',
  color: 'violet',
  needsMac: true,
  examples: ['Welche Kurzbefehle habe ich?', 'Starte meinen Kurzbefehl „Feierabend“'],
  tools: [
    {
      name: 'shortcuts_list',
      title: 'Kurzbefehle anzeigen',
      short: 'Listet die Kurzbefehle des Nutzers.',
      description: 'Listet die Namen aller Kurzbefehle aus der Kurzbefehle-App.',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: true,
      async run() {
        return { kurzbefehle: (await names()).slice(0, 200) };
      },
    },
    {
      name: 'shortcut_run',
      title: 'Kurzbefehl starten',
      short: 'Startet einen Kurzbefehl (name) – der Nutzer bestätigt per Karte.',
      description: 'Startet einen Kurzbefehl. Der Nutzer bestätigt den Start mit einem Tipp auf eine Karte. Optional ein Text als Eingabe.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, input: { type: 'string', maxLength: 4000 } }, required: ['name'], additionalProperties: false },
      async run(args, ctx) {
        const list = await names();
        const hit = list.find((n) => n === args.name) || list.find((n) => n.toLowerCase() === args.name.toLowerCase());
        if (!hit) throw new Error(`Einen Kurzbefehl „${args.name}“ finde ich nicht.`);
        const action = ctx.actions.create({ kind: 'shortcut', title: `Kurzbefehl „${hit}“ starten?`, target: { name: hit, input: args.input || '' }, options: [], allowEdit: false, confirmLabel: 'Starten' });
        return { bestaetigung_noetig: true, karte: action.id, hinweis: 'Der Nutzer startet den Kurzbefehl mit einem Tipp auf die Karte.' };
      },
    },
  ],
  actions: {
    async shortcut(a) {
      const output = await runShortcut(a.target.name, a.target.input);
      return { status: 'erledigt', output: output || null };
    },
  },
};
