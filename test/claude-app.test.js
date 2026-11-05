// Mit Claude verbinden: Erweiterung (.mcpb) bauen und öffnen, Ersatzweg über Claudes Einstellungsdatei,
// und die Brücke aus der Erweiterung spricht wirklich mit dem Assistenten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from '../src/app.js';
import { zip, unzip } from '../src/lib/zip.js';
import { buildExtension } from '../src/claude-app.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const KEY = 'c'.repeat(40);
let app;
let base;
let dir;
let cookie = '';
let openLog;
let configFile;

async function api(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'x-assistent': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistent-claude-'));
  fs.writeFileSync(path.join(dir, 'app-schluessel'), KEY);
  // nachgebautes „open“: schreibt auf, womit es aufgerufen wurde
  openLog = path.join(dir, 'open.log');
  const fakeOpen = path.join(dir, 'open');
  fs.writeFileSync(fakeOpen, `#!/bin/sh\necho "$@" >> "${openLog}"\n`, { mode: 0o755 });
  process.env.OPEN_BIN = fakeOpen;
  configFile = path.join(dir, 'Claude', 'claude_desktop_config.json');
  process.env.CLAUDE_CONFIG_PATH = configFile;
  process.env.CLAUDE_APP_PATHS = path.join(dir, 'Claude.app');
  app = createApp({ dataDir: dir, log: { log() {}, error() {} } });
  await app.listen(0);
  base = `http://127.0.0.1:${app.port}`;
  const res = await fetch(`${base}/api/app-login?key=${KEY}`, { redirect: 'manual' });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  await api('POST', '/api/setup/finish');
});

after(async () => {
  await app?.close();
  delete process.env.OPEN_BIN;
  delete process.env.CLAUDE_CONFIG_PATH;
  delete process.env.CLAUDE_APP_PATHS;
});

test('ZIP: hin und zurück', () => {
  const files = [{ name: 'a.txt', data: 'Hallo Ü' }, { name: 'ordner/b.bin', data: Buffer.from([0, 1, 2, 255]) }];
  const back = unzip(zip(files));
  assert.equal(back['a.txt'].toString('utf8'), 'Hallo Ü');
  assert.deepEqual([...back['ordner/b.bin']], [0, 1, 2, 255]);
});

test('Erweiterung: Manifest nach MCPB-Vorgabe, Server und Symbol stecken drin', () => {
  const { manifest, buffer } = buildExtension({ root: ROOT, dataDir: '/Users/du/Library/Application Support/Assistent', port: 3000, version: '0.3.17', tools: [{ name: 'todo_add', description: 'Legt ein To-do an. Mehr Text.' }] });
  assert.equal(manifest.manifest_version, '0.2');
  assert.equal(manifest.name, 'assistent');
  assert.equal(manifest.version, '0.3.17');
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.mjs');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.mjs']);
  assert.equal(manifest.server.mcp_config.env.PORT, '3000');
  assert.deepEqual(manifest.tools, [{ name: 'todo_add', description: 'Legt ein To-do an.' }]);
  const files = unzip(buffer);
  assert.deepEqual(Object.keys(files).sort(), ['icon.png', 'manifest.json', 'server/index.mjs']);
  assert.deepEqual(JSON.parse(files['manifest.json']), manifest);
  assert.match(files['server/index.mjs'].toString(), /api\/mcp-stdio/);
  assert.equal(files['icon.png'].subarray(1, 4).toString(), 'PNG');
  // nur Felder, die das Format kennt
  const allowed = ['manifest_version', 'name', 'display_name', 'version', 'description', 'long_description', 'author', 'icon', 'server', 'tools', 'tools_generated', 'keywords', 'compatibility'];
  assert.deepEqual(Object.keys(manifest).filter((k) => !allowed.includes(k)), []);
});

test('Mit Claude verbinden: legt die Erweiterung an und öffnet sie mit Claude', async () => {
  let r = await api('GET', '/api/claude-app');
  assert.equal(r.status, 200);
  assert.equal(r.data.possible, true);
  assert.equal(r.data.installed, false);
  assert.equal(r.data.lastSeen, null);
  r = await api('POST', '/api/claude-app/install');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.opened, true);
  const file = path.join(dir, 'Assistent.mcpb');
  assert.ok(fs.existsSync(file));
  const log = fs.readFileSync(openLog, 'utf8').trim();
  assert.equal(log, `-b com.anthropic.claudefordesktop ${file}`);
  const manifest = JSON.parse(unzip(fs.readFileSync(file))['manifest.json']);
  assert.equal(manifest.server.mcp_config.env.DATA_DIR, path.resolve(dir));
  assert.equal(manifest.server.mcp_config.env.PORT, String(app.port));
  assert.ok(manifest.tools.some((t) => t.name === 'todo_add'));
  assert.ok(!manifest.tools.some((t) => t.name === 'briefing_save'), 'interne Werkzeuge bleiben draußen');
});

test('Die Brücke aus der Erweiterung spricht mit dem Assistenten – und Claude gilt danach als verbunden', async () => {
  const files = unzip(fs.readFileSync(path.join(dir, 'Assistent.mcpb')));
  const manifest = JSON.parse(files['manifest.json']);
  const extDir = path.join(dir, 'erweiterung');
  fs.mkdirSync(path.join(extDir, 'server'), { recursive: true });
  fs.writeFileSync(path.join(extDir, 'server', 'index.mjs'), files['server/index.mjs']);
  const args = manifest.server.mcp_config.args.map((a) => a.replace('${__dirname}', extDir));
  const child = spawn(process.execPath, args, { env: { ...process.env, ...manifest.server.mcp_config.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const ask = async (msg) => {
    child.stdin.write(`${JSON.stringify(msg)}\n`);
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const hit = lines.find((l) => l.id === msg.id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Keine Antwort auf ${msg.method}`);
  };
  try {
    const init = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1.0' } } });
    assert.equal(init.result.serverInfo.name, 'assistent-agent');
    assert.match(init.result.instructions, /Vorschläge/);
    const list = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.ok(list.result.tools.some((t) => t.name === 'todo_add'));
    const add = await ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'todo_add', arguments: { title: 'Von Claude' } } });
    assert.equal(add.result.isError, false, JSON.stringify(add));
    assert.ok(app.todos.list({ status: 'alle' }).some((t) => t.title === 'Von Claude' && t.source === 'claude'));
  } finally {
    child.stdin.end();
    child.kill();
  }
  const r = await api('GET', '/api/claude-app');
  assert.ok(r.data.lastSeen > Date.now() - 60000);
  assert.equal(r.data.client, 'claude-ai');
});

test('Ersatzweg: Eintrag in Claudes Einstellungsdatei – andere Einträge bleiben, Sicherung wird angelegt', async () => {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { anderer: { command: 'x' } }, globalShortcut: 'Cmd+Space' }));
  let r = await api('POST', '/api/claude-app/config');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.configEntry, true);
  const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.deepEqual(cfg.mcpServers.anderer, { command: 'x' });
  assert.equal(cfg.globalShortcut, 'Cmd+Space');
  assert.equal(cfg.mcpServers.assistent.env.PORT, String(app.port));
  assert.match(cfg.mcpServers.assistent.args[0], /bin\/mcp-stdio\.js$/);
  assert.ok(fs.existsSync(`${configFile}.vor-assistent`));
  r = await api('DELETE', '/api/claude-app/config');
  assert.equal(r.data.removed, true);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(configFile, 'utf8')).mcpServers), ['anderer']);
});

test('Ersatzweg: kaputte Datei wird nicht überschrieben', async () => {
  fs.writeFileSync(configFile, '{ kaputt');
  const r = await api('POST', '/api/claude-app/config');
  assert.equal(r.status, 409);
  assert.equal(fs.readFileSync(configFile, 'utf8'), '{ kaputt');
});
