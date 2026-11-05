// Mit Claude verbinden: ein Klick, Claude fragt „Installieren?“ – fertig. Ohne Schlüssel, ohne Passwort.

import { api, toast } from './ui.js';

let watcher = null;

// Wartet bis zu 3 Minuten, bis Claude sich zum ersten Mal meldet
function watch(before, onLinked) {
  clearInterval(watcher);
  const until = Date.now() + 180000;
  watcher = setInterval(async () => {
    if (Date.now() > until) return clearInterval(watcher);
    try {
      const info = await api('GET', '/api/claude-app');
      if ((info.lastSeen || 0) > before) {
        clearInterval(watcher);
        toast('Verbunden! 🎉 Frag Claude jetzt einfach – zum Beispiel „Was steht heute an?“');
        onLinked?.(info);
      }
    } catch {
      /* nächstes Mal */
    }
    return undefined;
  }, 2500);
}

export async function connectClaude({ onLinked, onMissing } = {}) {
  const before = (await api('GET', '/api/claude-app').catch(() => ({}))).lastSeen || 0;
  const r = await api('POST', '/api/claude-app/install');
  if (r.opened) {
    toast('Claude ist offen – klick dort auf „Installieren“. Fertig!');
    watch(before, onLinked);
  } else {
    toast('Ich habe die Claude-App nicht gefunden. Lade sie zuerst, dann nochmal klicken.', 'error');
    onMissing?.();
  }
  return r;
}
