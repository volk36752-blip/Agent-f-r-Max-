#!/usr/bin/env node
// Brücke für die Claude-Desktop-App: verbindet Claude über stdio mit dem laufenden Assistenten.
// Eintrag in claude_desktop_config.json:  { "command": "node", "args": ["<Pfad>/bin/mcp-stdio.js"] }

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);
const BASE = process.env.ASSISTENT_URL || `http://127.0.0.1:${PORT}`;

function token() {
  if (process.env.ASSISTENT_TOKEN) return process.env.ASSISTENT_TOKEN;
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'geheim.json'), 'utf8')).connectorToken || '';
  } catch {
    return '';
  }
}

const OFFLINE = 'Der Assistent läuft gerade nicht. Öffne auf dem Mac die App „Assistent“ und versuch es dann nochmal.';

function localAnswer(msg) {
  // Damit Claude die Verbindung auch dann anzeigt, wenn der Assistent noch nicht läuft
  if (msg.method === 'initialize') {
    return { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'assistent-agent', version: '0.1.0' }, instructions: OFFLINE };
  }
  if (msg.method === 'server/discover') {
    return { resultType: 'complete', supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18'], capabilities: { tools: {} }, instructions: OFFLINE, ttlMs: 10000, cacheScope: 'private' };
  }
  if (msg.method === 'tools/list') return { tools: [] };
  if (msg.method === 'ping') return {};
  return null;
}

async function forward(msg) {
  try {
    const res = await fetch(`${BASE}/api/mcp-stdio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(120000),
    });
    if (res.status === 202) return null;
    return await res.json();
  } catch {
    if (!('id' in msg)) return null;
    const local = localAnswer(msg);
    if (local) return { jsonrpc: '2.0', id: msg.id, result: local };
    if (msg.method === 'tools/call') return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: OFFLINE }], isError: true } };
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: OFFLINE } };
  }
}

const rl = readline.createInterface({ input: process.stdin });
let pending = 0;
let closing = false;
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
    return;
  }
  pending++;
  const reply = await forward(msg);
  pending--;
  if (reply) process.stdout.write(JSON.stringify(reply) + '\n');
  if (closing && pending === 0) process.exit(0);
});
rl.on('close', () => {
  closing = true;
  if (pending === 0) process.exit(0);
});
