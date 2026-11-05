// Stimmen aus dem Internet: laden (nur von erlaubten Seiten), prüfen, entpacken, damit sprechen, Hörprobe.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app.js';

const KEY = 'v'.repeat(40);
let app;
let base;
let dir;
let cookie = '';
let files;
let engineLog;
const archives = {};

async function api(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'x-assistent': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function waitJob(id) {
  for (let i = 0; i < 200; i++) {
    const { data } = await api('GET', '/api/stimmen');
    const v = data.voices.find((x) => x.id === id);
    if (v.job?.state === 'fertig' || v.job?.state === 'fehler' || (!v.job && v.installed)) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Zeitüberschreitung');
}

function makeArchive(name, extra = []) {
  const src = path.join(dir, 'quelle', name);
  const folder = path.join(src, `vits-piper-${name}`);
  fs.mkdirSync(path.join(folder, 'espeak-ng-data'), { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.onnx`), 'modell');
  fs.writeFileSync(path.join(folder, 'tokens.txt'), 'a 1');
  fs.writeFileSync(path.join(folder, 'espeak-ng-data', 'de_dict'), 'x');
  const out = path.join(dir, `${name}.tar.bz2`);
  execFileSync('tar', ['-cjf', out, '-C', src, `vits-piper-${name}`, ...extra]);
  return fs.readFileSync(out);
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistent-stimmen-'));
  fs.writeFileSync(path.join(dir, 'app-schluessel'), KEY);
  archives['/vits-piper-de_DE-eva_k-x_low.tar.bz2'] = makeArchive('de_DE-eva_k-x_low');
  // ein Archiv, das aus seinem Ordner ausbrechen will
  const evilSrc = path.join(dir, 'quelle', 'de_DE-kerstin-low');
  makeArchive('de_DE-kerstin-low');
  fs.writeFileSync(path.join(evilSrc, 'boese.txt'), 'x');
  execFileSync('tar', ['-cjf', path.join(dir, 'boese.tar.bz2'), '-C', evilSrc, 'vits-piper-de_DE-kerstin-low', 'boese.txt']);
  archives['/vits-piper-de_DE-kerstin-low.tar.bz2'] = fs.readFileSync(path.join(dir, 'boese.tar.bz2'));

  files = http.createServer((req, res) => {
    if (req.url === '/vits-piper-de_DE-ramona-low.tar.bz2') {
      res.writeHead(302, { location: 'http://example.invalid/stimme.tar.bz2' });
      return res.end();
    }
    if (req.url === '/umweg/eva.tar.bz2') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': archives['/vits-piper-de_DE-eva_k-x_low.tar.bz2'].length });
      return res.end(archives['/vits-piper-de_DE-eva_k-x_low.tar.bz2']);
    }
    if (req.url === '/vits-piper-de_DE-eva_k-x_low.tar.bz2') {
      res.writeHead(302, { location: '/umweg/eva.tar.bz2' });
      return res.end();
    }
    if (archives[req.url]) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(archives[req.url]);
    }
    if (req.url === '/proben/eva_k-x_low.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      return res.end(Buffer.from('ID3probe'));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => files.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${files.address().port}`;
  process.env.VOICES_BASE_URL = origin;
  process.env.VOICES_SAMPLE_BASE_URL = `${origin}/proben`;

  // nachgebautes Sprach-Programm: schreibt eine kleine WAV-Datei und merkt sich die Aufrufe
  engineLog = path.join(dir, 'engine.log');
  const engine = path.join(dir, 'sherpa-onnx-offline-tts');
  fs.writeFileSync(engine, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(engineLog)}, JSON.stringify(args) + '\\n');
const out = args.find((a) => a.startsWith('--output-filename=')).split('=')[1];
const wav = Buffer.alloc(44); wav.write('RIFF', 0); wav.write('WAVE', 8);
fs.writeFileSync(out, wav);
`, { mode: 0o755 });
  process.env.TTS_ENGINE = engine;

  app = createApp({ dataDir: dir, log: { log() {}, error() {} } });
  await app.listen(0);
  base = `http://127.0.0.1:${app.port}`;
  const res = await fetch(`${base}/api/app-login?key=${KEY}`, { redirect: 'manual' });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  await api('POST', '/api/setup/finish');
});

after(async () => {
  await app?.close();
  files?.close();
  for (const k of ['VOICES_BASE_URL', 'VOICES_SAMPLE_BASE_URL', 'TTS_ENGINE']) delete process.env[k];
});

test('Liste: freie Stimmen mit Herkunft, noch keine geladen', async () => {
  const { data } = await api('GET', '/api/stimmen');
  assert.equal(data.engine, true);
  assert.ok(data.voices.length >= 5);
  assert.ok(data.voices.every((v) => !v.installed && v.source.startsWith('https://huggingface.co/rhasspy/piper-voices/')));
  assert.ok(data.voices.some((v) => v.gender === 'weiblich') && data.voices.some((v) => v.gender === 'männlich'));
});

test('Laden: folgt der Weiterleitung, entpackt, danach ist die Stimme da', async () => {
  const r = await api('POST', '/api/stimmen/eva_k-x_low/laden');
  assert.equal(r.status, 200);
  const v = await waitJob('eva_k-x_low');
  assert.equal(v.job?.state ?? 'fertig', 'fertig', JSON.stringify(v));
  assert.equal(v.installed, true);
  assert.ok(fs.existsSync(path.join(dir, 'stimmen', 'eva_k-x_low', 'vits-piper-de_DE-eva_k-x_low', 'de_DE-eva_k-x_low.onnx')));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'stimmen')).filter((f) => f.includes('.laden-')), [], 'keine Reste vom Laden');
});

test('Sprechen: liefert WAV, ruft das Programm mit der Stimme auf', async () => {
  const res = await fetch(`${base}/api/sprechen`, {
    method: 'POST',
    headers: { 'x-assistent': '1', cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ voice: 'netz:eva_k-x_low', text: '--version Hallo du!', speed: 1.25 }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
  const args = JSON.parse(fs.readFileSync(engineLog, 'utf8').trim().split('\n').pop());
  assert.ok(args.some((a) => a.endsWith('de_DE-eva_k-x_low.onnx')));
  assert.ok(args.includes('--vits-length-scale=0.800'));
  assert.equal(args.at(-1), 'version Hallo du!', 'Text kann keine Schalter einschmuggeln');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'stimmen', 'tmp')), [], 'Tondatei wird aufgeräumt');
});

test('Hörprobe kommt über den Assistenten', async () => {
  const res = await fetch(`${base}/api/stimmen/eva_k-x_low/probe`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'ID3probe');
});

test('Sicher: Archiv mit fremden Dateien und Umleitung auf fremde Seite werden abgelehnt', async () => {
  await api('POST', '/api/stimmen/kerstin-low/laden');
  let v = await waitJob('kerstin-low');
  assert.equal(v.job.state, 'fehler');
  assert.match(v.job.error, /nicht aus wie erwartet/);
  assert.equal(v.installed, false);
  assert.equal(fs.existsSync(path.join(dir, 'stimmen', 'boese.txt')), false, 'nichts außerhalb entpackt');
  assert.equal(fs.existsSync(path.join(dir, 'stimmen', 'kerstin-low')), false);

  await api('POST', '/api/stimmen/ramona-low/laden');
  v = await waitJob('ramona-low');
  assert.equal(v.job.state, 'fehler');
  assert.match(v.job.error, /vertrauenswürdigen/);
});

test('Löschen und unbekannte Stimmen', async () => {
  let r = await api('DELETE', '/api/stimmen/eva_k-x_low');
  assert.equal(r.data.voice.installed, false);
  r = await api('POST', '/api/sprechen', { voice: 'netz:eva_k-x_low', text: 'Hallo' });
  assert.equal(r.status, 404);
  r = await api('POST', '/api/stimmen/gibtsnicht/laden');
  assert.equal(r.status, 404);
});
