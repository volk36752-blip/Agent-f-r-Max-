// Stimmen aus dem Internet: freie, natürliche deutsche Stimmen aus dem Piper-Projekt
// (huggingface.co/rhasspy/piper-voices), fertig umgewandelt vom Open-Source-Projekt sherpa-onnx
// (github.com/k2-fsa/sherpa-onnx). Ein Klick lädt sie – danach spricht der Mac sie ohne Internet.
// Geladen wird nur von diesen beiden Seiten und nur über https.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const MODELS = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';
const PIPER = 'https://huggingface.co/rhasspy/piper-voices';
const TRUSTED = /^(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com|huggingface\.co|cdn-lfs[a-z0-9.-]*\.huggingface\.co|cas-bridge\.xethub\.hf\.co|[a-z0-9-]+\.hf\.co)$/i;
const MAX_BYTES = 400 * 1024 * 1024;

// Nur Stimmen mit klarer Herkunft aus dem offiziellen Piper-Verzeichnis
export const NET_VOICES = [
  { id: 'thorsten-high', piper: 'de_DE-thorsten-high', speaker: 'thorsten', q: 'high', name: 'Thorsten', gender: 'männlich', level: 'sehr natürlich', about: 'Die bekannteste freie deutsche Stimme – warm und deutlich.', mb: 110, score: 95 },
  { id: 'thorsten-medium', piper: 'de_DE-thorsten-medium', speaker: 'thorsten', q: 'medium', name: 'Thorsten (leicht)', gender: 'männlich', level: 'natürlich', about: 'Dieselbe Stimme, kleiner und etwas schneller.', mb: 65, score: 85 },
  { id: 'kerstin-low', piper: 'de_DE-kerstin-low', speaker: 'kerstin', q: 'low', name: 'Kerstin', gender: 'weiblich', level: 'gut', about: 'Freundliche, ruhige Frauenstimme.', mb: 65, score: 75 },
  { id: 'ramona-low', piper: 'de_DE-ramona-low', speaker: 'ramona', q: 'low', name: 'Ramona', gender: 'weiblich', level: 'gut', about: 'Klare Frauenstimme, etwas lebhafter.', mb: 65, score: 74 },
  { id: 'eva_k-x_low', piper: 'de_DE-eva_k-x_low', speaker: 'eva_k', q: 'x_low', name: 'Eva', gender: 'weiblich', level: 'einfach', about: 'Sehr klein und schnell geladen.', mb: 25, score: 60 },
  { id: 'karlsson-low', piper: 'de_DE-karlsson-low', speaker: 'karlsson', q: 'low', name: 'Karlsson', gender: 'männlich', level: 'gut', about: 'Tiefe, ruhige Männerstimme.', mb: 65, score: 73 },
  { id: 'pavoque-low', piper: 'de_DE-pavoque-low', speaker: 'pavoque', q: 'low', name: 'Pavoque', gender: 'männlich', level: 'gut', about: 'Sachliche Männerstimme (nur für den privaten Gebrauch).', mb: 65, score: 70 },
];

export class VoiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const run = (bin, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    if (err) reject(Object.assign(err, { stderr: String(stderr || '') }));
    else resolve(String(stdout || ''));
  });
});

function archiveUrl(v) {
  return `${process.env.VOICES_BASE_URL || MODELS}/vits-piper-${v.piper}.tar.bz2`;
}

function sampleUrl(v) {
  return process.env.VOICES_SAMPLE_BASE_URL
    ? `${process.env.VOICES_SAMPLE_BASE_URL}/${v.id}.mp3`
    : `${PIPER}/resolve/main/de/de_DE/${v.speaker}/${v.q}/samples/speaker_0.mp3`;
}

function trustedUrl(u) {
  try {
    const url = new URL(u);
    if (process.env.VOICES_BASE_URL && u.startsWith(new URL(process.env.VOICES_BASE_URL).origin)) return true;
    if (process.env.VOICES_SAMPLE_BASE_URL && u.startsWith(new URL(process.env.VOICES_SAMPLE_BASE_URL).origin)) return true;
    return url.protocol === 'https:' && TRUSTED.test(url.hostname);
  } catch {
    return false;
  }
}

// Folgt Weiterleitungen selbst – aber nur zu den vertrauenswürdigen Seiten
async function trustedFetch(url, { timeoutMs }) {
  let current = url;
  for (let i = 0; i < 6; i++) {
    if (!trustedUrl(current)) throw new VoiceError('Die Stimme liegt nicht mehr auf einer vertrauenswürdigen Seite – abgebrochen.', 502);
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'assistent-agent' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }
    if (!res.ok) throw new VoiceError(`Die Stimme konnte nicht geladen werden (Status ${res.status}).`, 502);
    return res;
  }
  throw new VoiceError('Zu viele Weiterleitungen.', 502);
}

// Das Sprach-Programm (sherpa-onnx) steckt in der Mac-App
export function findEngine(root) {
  const candidates = [
    process.env.TTS_ENGINE,
    path.resolve(root, '..', '..', 'Helpers', 'sherpa', 'bin', 'sherpa-onnx-offline-tts'),
    path.join(root, 'build', 'sherpa', 'bin', 'sherpa-onnx-offline-tts'),
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

export function createVoices({ dataDir, root, log = console }) {
  const base = path.join(dataDir, 'stimmen');
  const jobs = new Map();
  let speaking = 0;

  const find = (id) => NET_VOICES.find((v) => v.id === id);
  const dirOf = (v) => path.join(base, v.id);
  const filesOf = (v) => {
    const folder = path.join(dirOf(v), `vits-piper-${v.piper}`);
    return { folder, model: path.join(folder, `${v.piper}.onnx`), tokens: path.join(folder, 'tokens.txt'), data: path.join(folder, 'espeak-ng-data') };
  };
  const installed = (v) => fs.existsSync(path.join(dirOf(v), 'fertig.json'));

  function info(v) {
    const job = jobs.get(v.id);
    return {
      id: v.id,
      name: v.name,
      gender: v.gender,
      level: v.level,
      about: v.about,
      mb: v.mb,
      score: v.score,
      installed: installed(v),
      job: job ? { state: job.state, received: job.received, total: job.total, error: job.error || null } : null,
      source: `${PIPER}/tree/main/de/de_DE/${v.speaker}/${v.q}`,
    };
  }

  async function download(v) {
    const job = jobs.get(v.id);
    const dir = dirOf(v);
    const tmp = path.join(base, `${v.id}.laden-${randomUUID().slice(0, 8)}.tar.bz2`);
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    try {
      const res = await trustedFetch(archiveUrl(v), { timeoutMs: 45 * 60 * 1000 });
      job.total = Number(res.headers.get('content-length')) || v.mb * 1024 * 1024;
      if (job.total > MAX_BYTES) throw new VoiceError('Diese Stimme ist ungewöhnlich groß – abgebrochen.', 502);
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      try {
        for await (const chunk of res.body) {
          job.received += chunk.length;
          if (job.received > MAX_BYTES) throw new VoiceError('Diese Stimme ist ungewöhnlich groß – abgebrochen.', 502);
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      job.state = 'entpacken';
      // Erst nachsehen, was im Archiv steckt: nur der eine erwartete Ordner, keine Tricks mit „..“
      const listing = (await run(process.env.TAR || 'tar', ['-tjf', tmp])).split('\n').map((l) => l.trim().replace(/^\.\//, '')).filter((l) => l && l !== '.' && !/(^|\/)\._/.test(l));
      const prefix = `vits-piper-${v.piper}/`;
      if (!listing.length || listing.some((n) => !(n === prefix.slice(0, -1) || n.startsWith(prefix)) || n.split('/').includes('..'))) {
        throw new VoiceError('Das Archiv sieht nicht aus wie erwartet – abgebrochen.', 502);
      }
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      await run(process.env.TAR || 'tar', ['-xjf', tmp, '-C', dir]);
      const f = filesOf(v);
      if (!fs.existsSync(f.model) || !fs.existsSync(f.tokens) || !fs.existsSync(f.data)) throw new VoiceError('Im Archiv fehlt etwas – bitte nochmal laden.', 502);
      fs.writeFileSync(path.join(dir, 'fertig.json'), JSON.stringify({ at: Date.now(), bytes: job.received, url: archiveUrl(v) }));
      job.state = 'fertig';
      setTimeout(() => jobs.get(v.id) === job && jobs.delete(v.id), 60000);
    } catch (err) {
      job.state = 'fehler';
      job.error = err instanceof VoiceError ? err.message : `Laden hat nicht geklappt (${err.cause?.code || err.code || err.name}).`;
      log.error?.('Stimme laden:', err.message);
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  return {
    engine: () => findEngine(root),

    list() {
      return { engine: Boolean(findEngine(root)), voices: NET_VOICES.map(info) };
    },

    installedList() {
      return NET_VOICES.filter(installed).map((v) => ({ id: v.id, name: v.name, gender: v.gender, level: v.level, score: v.score }));
    },

    start(id) {
      const v = find(id);
      if (!v) throw new VoiceError('Diese Stimme gibt es nicht.', 404);
      if (!findEngine(root)) throw new VoiceError('Stimmen aus dem Internet gehen nur in der Mac-App „Assistent“.', 409);
      const running = jobs.get(id);
      if (running && (running.state === 'laden' || running.state === 'entpacken')) return info(v);
      jobs.set(id, { state: 'laden', received: 0, total: v.mb * 1024 * 1024 });
      download(v);
      return info(v);
    },

    remove(id) {
      const v = find(id);
      if (!v) throw new VoiceError('Diese Stimme gibt es nicht.', 404);
      fs.rmSync(dirOf(v), { recursive: true, force: true });
      jobs.delete(id);
      return info(v);
    },

    // Hörprobe von der Piper-Seite – einmal geladen, danach aus dem Zwischenspeicher
    async sample(id) {
      const v = find(id);
      if (!v) throw new VoiceError('Diese Stimme gibt es nicht.', 404);
      const cache = path.join(base, 'proben', `${v.id}.mp3`);
      if (fs.existsSync(cache)) return fs.readFileSync(cache);
      const res = await trustedFetch(sampleUrl(v), { timeoutMs: 30000 });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 5 * 1024 * 1024) throw new VoiceError('Hörprobe zu groß.', 502);
      fs.mkdirSync(path.dirname(cache), { recursive: true, mode: 0o700 });
      fs.writeFileSync(cache, buf);
      return buf;
    },

    // Spricht einen Text mit einer geladenen Stimme – liefert eine WAV-Datei
    async speak(id, text, { speed = 1 } = {}) {
      const v = find(id);
      if (!v || !installed(v)) throw new VoiceError('Diese Stimme ist noch nicht geladen.', 404);
      const engine = findEngine(root);
      if (!engine) throw new VoiceError('Das Sprach-Programm fehlt – das geht nur in der Mac-App.', 409);
      const clean = String(text || '').replace(/\s+/g, ' ').replace(/^[\s\-–—]+/, '').trim().slice(0, 1500);
      if (!clean) throw new VoiceError('Kein Text.', 400);
      if (speaking >= 3) throw new VoiceError('Einen Moment – ich spreche schon.', 429);
      const f = filesOf(v);
      const tmpDir = path.join(base, 'tmp');
      fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
      const out = path.join(tmpDir, `${randomUUID()}.wav`);
      const s = Math.max(0.6, Math.min(1.6, Number(speed) || 1));
      speaking++;
      const args = (withSpeed) => [
        `--vits-model=${f.model}`,
        `--vits-tokens=${f.tokens}`,
        `--vits-data-dir=${f.data}`,
        ...(withSpeed ? [`--vits-length-scale=${(1 / s).toFixed(3)}`] : []),
        '--num-threads=2',
        `--output-filename=${out}`,
        clean,
      ];
      try {
        const withSpeed = Math.abs(s - 1) > 0.01;
        try {
          await run(engine, args(withSpeed), { timeout: 60000 });
        } catch (err) {
          if (!withSpeed) throw err;
          await run(engine, args(false), { timeout: 60000 }); // ältere Programmversion ohne Tempo
        }
        return fs.readFileSync(out);
      } catch (err) {
        log.error?.('Sprechen:', err.message, err.stderr?.slice(-400));
        throw new VoiceError('Die Stimme konnte gerade nicht sprechen.', 500);
      } finally {
        speaking--;
        fs.rmSync(out, { force: true });
      }
    },
  };
}
