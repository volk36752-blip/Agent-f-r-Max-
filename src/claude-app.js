// Verbindung zur Claude-App auf dem Mac: Der Assistent wird mit einem Klick eine Erweiterung in Claude.
// Danach kann Claude direkt mit deinen Terminen, To-dos, WhatsApp, Mails … arbeiten –
// Senden und Löschen weiterhin nur, wenn du es ausdrücklich bestätigst.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { zip } from './lib/zip.js';

export const CLAUDE_BUNDLE_ID = 'com.anthropic.claudefordesktop';
export const EXTENSION_NAME = 'assistent';

const run = (bin, args) => new Promise((resolve) => {
  execFile(bin, args, { timeout: 15000 }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

export function claudeConfigPath() {
  return process.env.CLAUDE_CONFIG_PATH || path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
}

// Ob die Verbindung hier überhaupt geht (Mac – oder in Tests ein nachgebautes „open“)
export function claudeLinkPossible() {
  return process.platform === 'darwin' || Boolean(process.env.OPEN_BIN);
}

export function claudeAppInstalled() {
  if (process.env.CLAUDE_APP_PATHS !== undefined) return process.env.CLAUDE_APP_PATHS.split(':').filter(Boolean).some((p) => fs.existsSync(p));
  if (process.platform !== 'darwin') return false;
  return ['/Applications/Claude.app', path.join(os.homedir(), 'Applications', 'Claude.app')].some((p) => fs.existsSync(p));
}

function semver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '0.3.0';
}

function firstSentence(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const m = /^(.{12,}?[.!?])\s/.exec(`${s} `);
  return (m ? m[1] : s).slice(0, 200);
}

/** Die Erweiterung für Claude (.mcpb = ZIP mit manifest.json, kleinem Server und Symbol). */
export function buildExtension({ root, dataDir, port, version, tools = [] }) {
  const manifest = {
    manifest_version: '0.2',
    name: EXTENSION_NAME,
    display_name: 'Assistent',
    version: semver(version),
    description: 'Dein persönlicher Assistent vom Mac: Termine, To-dos, WhatsApp, Mail, Erinnerungen, Wetter und mehr – direkt in Claude.',
    long_description: [
      'Verbindet Claude mit der App **Assistent** auf deinem Mac.',
      '',
      'Frag Claude zum Beispiel:',
      '- „Was steht heute bei mir an?“',
      '- „Hab ich Freitagnachmittag Zeit?“',
      '- „Wer hat mir auf WhatsApp geschrieben? Schlag mir Antworten vor.“',
      '- „Setz mir ein To-do: Steuer machen, morgen.“',
      '',
      'Sicher: Nachrichten und Mails werden erst gesendet und Dinge erst gelöscht, wenn du ausdrücklich zustimmst. Alles bleibt auf deinem Mac – die App „Assistent“ muss dafür laufen.',
    ].join('\n'),
    author: { name: 'Assistent' },
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/index.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.mjs'],
        env: { DATA_DIR: dataDir, PORT: String(port) },
      },
    },
    tools: tools.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
    tools_generated: true,
    keywords: ['assistent', 'kalender', 'todo', 'whatsapp', 'mail', 'erinnerungen', 'mac'],
    compatibility: { platforms: ['darwin'], runtimes: { node: '>=18.0.0' } },
  };
  const files = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'server/index.mjs', data: fs.readFileSync(path.join(root, 'bin', 'mcp-stdio.js')), mode: 0o755 },
  ];
  const iconFile = path.join(root, 'public', 'icon-512.png');
  if (fs.existsSync(iconFile)) files.push({ name: 'icon.png', data: fs.readFileSync(iconFile) });
  return { manifest, buffer: zip(files) };
}

/** Öffnet die Erweiterung mit der Claude-App – Claude fragt dann „Installieren?“. */
export async function openInClaude(file) {
  const bin = process.env.OPEN_BIN || '/usr/bin/open';
  let r = await run(bin, ['-b', CLAUDE_BUNDLE_ID, file]);
  if (!r.ok) r = await run(bin, ['-a', 'Claude', file]);
  return r.ok;
}

export async function openClaudeDownload() {
  const bin = process.env.OPEN_BIN || '/usr/bin/open';
  return (await run(bin, ['https://claude.ai/download'])).ok;
}

// ---------- Ersatzweg: Eintrag direkt in Claudes Einstellungsdatei ----------

function readConfig(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('kein Objekt');
    return data;
  } catch {
    const err = new Error('Claudes Einstellungsdatei lässt sich nicht lesen. Ich ändere lieber nichts daran – nimm bitte den Weg über „Mit Claude verbinden“.');
    err.status = 409;
    throw err;
  }
}

export function configEntry({ root, dataDir, port }) {
  return {
    command: process.execPath,
    args: [path.join(root, 'bin', 'mcp-stdio.js')],
    env: { DATA_DIR: dataDir, PORT: String(port) },
  };
}

export function hasConfigEntry() {
  try {
    return Boolean(readConfig(claudeConfigPath()).mcpServers?.[EXTENSION_NAME]);
  } catch {
    return false;
  }
}

export function writeConfigEntry(entry) {
  const file = claudeConfigPath();
  const cfg = readConfig(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.vor-assistent`);
  cfg.mcpServers = { ...(cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {}), [EXTENSION_NAME]: entry };
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return file;
}

export function removeConfigEntry() {
  const file = claudeConfigPath();
  const cfg = readConfig(file);
  if (!cfg.mcpServers?.[EXTENSION_NAME]) return false;
  delete cfg.mcpServers[EXTENSION_NAME];
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return true;
}
