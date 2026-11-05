// Führt kleine JavaScript-Skripte für Mac-Apps aus (JXA über osascript) – z. B. für Mail, Notizen, Musik.
// Beim ersten Mal fragt macOS: „Assistent möchte ‚Mail‘ steuern“ – ein Klick auf OK.

import { execFile } from 'node:child_process';

export class JxaError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.code = code;
  }
}

/**
 * source: Skript mit `function run(argv) { const input = JSON.parse(argv[0]); … return JSON.stringify(x); }`
 * input: wird als JSON an das Skript übergeben (nie in den Skripttext eingebaut).
 */
export function runJxa(source, input = {}, { timeoutMs = 90000 } = {}) {
  const bin = process.env.OSASCRIPT || '/usr/bin/osascript';
  return new Promise((resolve, reject) => {
    execFile(bin, ['-l', 'JavaScript', '-e', source, JSON.stringify(input)], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const text = String(stderr || err.message || '').trim();
        const m = /\((-?\d+)\)\s*$/.exec(text);
        const code = m ? Number(m[1]) : null;
        if (err.code === 'ENOENT') return reject(new JxaError('Das geht nur auf einem Mac.', 'notMac'));
        if (err.killed) return reject(new JxaError('Die App hat zu lange nicht geantwortet.', 'timeout'));
        if (code === -1743 || /not authori[sz]ed|nicht berechtigt/i.test(text)) return reject(new JxaError('Keine Erlaubnis, diese App zu steuern.', 'denied'));
        if (code === -600 || code === -609) return reject(new JxaError('Die App läuft gerade nicht.', 'notRunning'));
        if (code === -1728) return reject(new JxaError('Nicht gefunden (vielleicht gelöscht oder verschoben).', 'notFound'));
        const clean = text.replace(/^.*?execution error:\s*/s, '').replace(/^Error:\s*/, '').replace(/\s*\(-?\d+\)\s*$/, '').trim();
        return reject(new JxaError(clean || 'Das Skript ist fehlgeschlagen.', code ?? 'error'));
      }
      const out = String(stdout).trim();
      if (!out) return resolve(null);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(out);
      }
    });
  });
}
