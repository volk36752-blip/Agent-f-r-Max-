// Claude als Gehirn – über dein Claude-Konto, ohne API-Schlüssel.
// Dafür benutzt der Assistent das offizielle Programm „Claude Code“ von Anthropic auf deinem Mac:
// einmal verbinden (im Browser anmelden und „Erlauben“), danach antwortet Claude im Assistenten und
// verbraucht dabei das Kontingent deines Claude-Abos. Die Werkzeuge (Kalender, WhatsApp, Mail …)
// bekommt Claude über die MCP-Schnittstelle des Assistenten – Senden und Löschen nur per Karte.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const INSTALL_CMD = 'curl -fsSL https://claude.ai/install.sh | bash';

export class ClaudeCodeError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

function home() {
  return process.env.HOME || os.homedir();
}

function searchPath() {
  const extra = [path.join(home(), '.local', 'bin'), path.join(home(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  return [...new Set([...extra, ...String(process.env.PATH || '').split(':')].filter(Boolean))].join(':');
}

export function findClaude() {
  if (process.env.CLAUDE_BIN) return fs.existsSync(process.env.CLAUDE_BIN) ? process.env.CLAUDE_BIN : null;
  if (process.platform !== 'darwin') return null; // der Assistent läuft als App nur auf dem Mac
  for (const dir of searchPath().split(':')) {
    const p = path.join(dir, 'claude');
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* weiter */
    }
  }
  return null;
}

const env = () => ({ ...process.env, PATH: searchPath(), HOME: home() });

function run(bin, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, env: env(), maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export function createClaudeCode({ dataDir, log = console, getMcp }) {
  const work = path.join(dataDir, 'claude-gehirn');
  let cache = { at: 0, value: null };
  let job = null; // { state: 'installieren' | 'anmelden' | 'fertig' | 'fehler', error }

  async function status({ fresh = false } = {}) {
    if (!fresh && cache.value && Date.now() - cache.at < 30000) return { ...cache.value, job };
    const bin = findClaude();
    let value = { installed: Boolean(bin), loggedIn: false, method: null, email: null };
    if (bin) {
      const r = await run(bin, ['auth', 'status']);
      try {
        const data = JSON.parse(r.stdout);
        value = { installed: true, loggedIn: r.ok && data.authMethod !== 'none' && Boolean(data.loggedIn ?? true), method: data.authMethod || null, email: data.email || data.account?.email || null };
      } catch {
        value = { installed: true, loggedIn: r.ok, method: null, email: null };
      }
    }
    cache = { at: Date.now(), value };
    return { ...value, job };
  }

  // Anmelden: „claude auth login“ öffnet den Browser – dort anmelden und erlauben. Fertig.
  function startLogin(bin) {
    job = { state: 'anmelden', since: Date.now() };
    const child = spawn(bin, ['auth', 'login'], { env: env(), stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.on('exit', (code) => {
      cache.at = 0;
      if (code !== 0 && job?.state === 'anmelden') openLoginInTerminal(bin);
    });
    child.unref();
  }

  // Ersatzweg, falls die Anmeldung ein Fenster braucht: im Terminal starten
  function openLoginInTerminal(bin) {
    try {
      fs.mkdirSync(work, { recursive: true, mode: 0o700 });
      const file = path.join(work, 'Bei Claude anmelden.command');
      fs.writeFileSync(file, `#!/bin/bash\necho "Melde dich bei Claude an – danach kannst du dieses Fenster schließen."\n"${bin}" auth login\n`, { mode: 0o755 });
      execFile(process.env.OPEN_BIN || '/usr/bin/open', [file], () => {});
    } catch (err) {
      log.error?.('Claude-Anmeldung:', err.message);
    }
  }

  return {
    status,

    // Ein Klick: installieren (falls nötig), dann anmelden lassen
    async connect() {
      const s = await status({ fresh: true });
      if (s.installed && s.loggedIn) {
        job = { state: 'fertig' };
        return status();
      }
      if (job && (job.state === 'installieren' || job.state === 'anmelden') && Date.now() - (job.since || 0) < 300000) return status();
      if (!s.installed) {
        job = { state: 'installieren', since: Date.now() };
        // offizieller Installer von Anthropic
        const child = spawn('/bin/bash', ['-c', process.env.CLAUDE_INSTALL_CMD || INSTALL_CMD], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
        let errText = '';
        child.stderr.on('data', (d) => {
          errText = (errText + d).slice(-2000);
        });
        child.on('error', (err) => {
          job = { state: 'fehler', error: `Installieren ging nicht: ${err.message}` };
        });
        child.on('exit', (code) => {
          cache.at = 0;
          const bin = findClaude();
          if (code === 0 && bin) startLogin(bin);
          else job = { state: 'fehler', error: 'Claude Code ließ sich nicht installieren. Prüf die Internetverbindung und versuch es nochmal.' };
          if (code !== 0) log.error?.('Claude Code installieren:', errText);
        });
        return status();
      }
      startLogin(findClaude());
      return status();
    },

    async ready() {
      const s = await status();
      return s.installed && s.loggedIn;
    },

    cachedReady() {
      return Boolean(cache.value?.installed && cache.value?.loggedIn);
    },

    // Eine Frage beantworten. Ereignisse wie bei den anderen Gehirnen: text, tool_start, tool_end.
    ask({ prompt, system, sessionId, model = 'sonnet', onEvent, onPermission = null }) {
      const bin = findClaude();
      if (!bin) return Promise.reject(new ClaudeCodeError('Claude ist nicht verbunden. Klick auf „Mit Claude verbinden“.'));
      const runId = randomUUID();
      const mcp = getMcp(runId, onPermission);
      fs.mkdirSync(work, { recursive: true, mode: 0o700 });
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--mcp-config', JSON.stringify({ mcpServers: { assistent: { type: 'http', url: mcp.url } } }),
        '--strict-mcp-config',
        '--tools', '',
        '--allowedTools', 'mcp__assistent',
        '--permission-mode', 'dontAsk',
        '--append-system-prompt', system,
        '--model', model,
        '--max-turns', '10',
      ];
      if (sessionId) args.push('--resume', sessionId);
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd: work, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
        const tools = new Map();
        let buf = '';
        let text = '';
        let newSession = sessionId || null;
        let final = null;
        let errText = '';
        const timer = setTimeout(() => child.kill('SIGINT'), 240000);
        const handle = (msg) => {
          if (msg.session_id) newSession = msg.session_id;
          if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
            text += msg.event.delta.text;
            onEvent({ type: 'text', text: msg.event.delta.text });
          } else if (msg.type === 'assistant') {
            for (const b of msg.message?.content || []) {
              if (b.type !== 'tool_use' || tools.has(b.id)) continue;
              const name = String(b.name || '').replace(/^mcp__assistent__/, '');
              tools.set(b.id, { name, input: b.input || {} });
              onEvent({ type: 'tool_start', id: b.id, name, input: b.input || {} });
            }
          } else if (msg.type === 'user') {
            for (const b of msg.message?.content || []) {
              if (b.type !== 'tool_result') continue;
              const t = tools.get(b.tool_use_id);
              if (!t || t.done) continue;
              t.done = true;
              const raw = Array.isArray(b.content) ? b.content.filter((c) => c.type === 'text').map((c) => c.text).join('') : String(b.content || '');
              let result = null;
              try {
                result = JSON.parse(raw);
              } catch {
                result = { text: raw };
              }
              const failed = Boolean(b.is_error) || /^Fehler:/.test(raw);
              onEvent({ type: 'tool_end', id: b.tool_use_id, name: t.name, input: t.input, ok: !failed, result: failed ? undefined : result, error: failed ? raw.replace(/^Fehler:\s*/, '') : undefined });
            }
          } else if (msg.type === 'result') {
            final = msg;
          }
        };
        child.stdout.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            try {
              handle(JSON.parse(line));
            } catch {
              /* keine JSON-Zeile */
            }
          }
        });
        child.stderr.on('data', (d) => {
          errText = (errText + d).slice(-4000);
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          mcp.done();
          reject(new ClaudeCodeError(`Claude startet nicht: ${err.message}`, 500));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          mcp.done();
          if (final && !final.is_error) {
            if (!text && final.result) {
              text = String(final.result);
              onEvent({ type: 'text', text });
            }
            resolve({ text, sessionId: newSession, cost: final.total_cost_usd ?? null });
            return;
          }
          const why = String(final?.result || errText || '').slice(-600);
          log.error?.('Claude Code:', code, why);
          cache.at = 0;
          if (/log ?in|not logged|auth|token/i.test(why)) reject(new ClaudeCodeError('Claude ist abgemeldet. Klick auf „Mit Claude verbinden“, um dich wieder anzumelden.'));
          else if (/limit|usage/i.test(why)) reject(new ClaudeCodeError('Dein Claude-Kontingent ist gerade aufgebraucht. Versuch es später nochmal.', 429));
          else reject(new ClaudeCodeError('Claude hat gerade nicht geantwortet. Versuch es gleich nochmal.', 502));
        });
      });
    },
  };
}
