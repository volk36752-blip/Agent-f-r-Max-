// Claude als Gehirn über das Claude-Konto (ohne Schlüssel): verbinden, anmelden, fragen –
// Claude benutzt die Werkzeuge des Assistenten über die MCP-Schnittstelle.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const KEY = 'q'.repeat(40);
let app;
let base;
let dir;
let cookie = '';
let argsLog;

async function api(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'x-assistent': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function chat(message) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-assistent': '1', cookie, accept: 'application/x-ndjson' },
    body: JSON.stringify({ message }),
  });
  return (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type !== 'ping');
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistent-konto-'));
  fs.writeFileSync(path.join(dir, 'app-schluessel'), KEY);
  const state = path.join(dir, 'claude-state.json');
  argsLog = path.join(dir, 'claude-args.log');
  fs.writeFileSync(state, JSON.stringify({ loggedIn: false }));
  // nachgebautes „claude“ (Claude Code): auth status/login und -p mit stream-json, ruft die MCP-Schnittstelle auf
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: st.loggedIn, authMethod: st.loggedIn ? 'claude.ai' : 'none', email: st.loggedIn ? 'max@example.com' : undefined }));
  process.exit(st.loggedIn ? 0 : 1);
}
if (args[0] === 'auth' && args[1] === 'login') {
  fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args) + '\\n');
const get = (k) => args[args.indexOf(k) + 1];
const url = JSON.parse(get('--mcp-config')).mcpServers.assistent.url;
const prompt = get('-p');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
(async () => {
  const call = async (method, params) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code' } });
  const list = await call('tools/list', {});
  out({ type: 'system', subtype: 'init', session_id: 'sitzung-1', tools: list.result.tools.map((t) => t.name) });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__assistent__todo_add', input: { title: prompt } }] } });
  const r = await call('tools/call', { name: 'todo_add', arguments: { title: prompt } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: r.result.content, is_error: r.result.isError }] } });
  for (const t of ['Erledigt, ', 'steht drauf!']) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
  out({ type: 'result', is_error: false, result: 'Erledigt, steht drauf!', session_id: 'sitzung-1', total_cost_usd: 0.01, tools_seen: list.result.tools.map((t) => t.name) });
})();
`, { mode: 0o755 });
  process.env.CLAUDE_BIN = bin;
  process.env.OPEN_BIN = '/bin/true';
  app = createApp({ dataDir: dir, log: { log() {}, error() {} } });
  await app.listen(0);
  base = `http://127.0.0.1:${app.port}`;
  const res = await fetch(`${base}/api/app-login?key=${KEY}`, { redirect: 'manual' });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  await api('POST', '/api/setup/finish');
});

after(async () => {
  await app?.close();
  delete process.env.CLAUDE_BIN;
  delete process.env.OPEN_BIN;
});

test('Verbinden: anmelden lassen – danach ist Claude das Gehirn', async () => {
  let r = await api('GET', '/api/claude');
  assert.equal(r.data.installed, true);
  assert.equal(r.data.loggedIn, false);
  assert.notEqual(r.data.brain.active, 'konto');
  r = await api('POST', '/api/claude/verbinden');
  assert.equal(r.status, 200);
  for (let i = 0; i < 100 && !r.data.loggedIn; i++) {
    await new Promise((res) => setTimeout(res, 30));
    r = await api('GET', '/api/claude');
  }
  assert.equal(r.data.loggedIn, true);
  assert.equal(r.data.email, 'max@example.com');
  assert.equal(r.data.brain.active, 'konto');
});

test('Fragen: Claude benutzt die Werkzeuge des Assistenten, Karten und Text kommen live', async () => {
  const events = await chat('Steuer machen');
  const start = events.find((e) => e.type === 'tool_start');
  const end = events.find((e) => e.type === 'tool_end');
  assert.equal(start.name, 'todo_add');
  assert.equal(end.ok, true, JSON.stringify(end));
  assert.match(JSON.stringify(end.result), /Steuer machen/);
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'Erledigt, steht drauf!');
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).brain, 'konto');
  assert.ok(app.todos.list({ status: 'alle' }).some((t) => t.title === 'Steuer machen' && t.source === 'agent'));
  const args = JSON.parse(fs.readFileSync(argsLog, 'utf8').trim().split('\n')[0]);
  assert.equal(args[args.indexOf('--tools') + 1], '', 'keine eigenen Werkzeuge (Terminal, Dateien)');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args.includes('--resume'), false);
});

test('Gespräch geht weiter (--resume), Neu fängt von vorn an', async () => {
  await chat('Noch was');
  let args = JSON.parse(fs.readFileSync(argsLog, 'utf8').trim().split('\n').at(-1));
  assert.equal(args[args.indexOf('--resume') + 1], 'sitzung-1');
  await api('DELETE', '/api/chat');
  await chat('Neu');
  args = JSON.parse(fs.readFileSync(argsLog, 'utf8').trim().split('\n').at(-1));
  assert.equal(args.includes('--resume'), false);
});
