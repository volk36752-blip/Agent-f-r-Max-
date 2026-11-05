// Mit Claude verbinden: ein Klick – im Browser bei Claude anmelden und „Erlauben“ – fertig.
// Danach denkt der Assistent mit Claude und nutzt dein Claude-Konto. Ohne API-Schlüssel.

import { api, toast } from './ui.js';

let watcher = null;

const MESSAGES = {
  installieren: 'Ich richte Claude auf deinem Mac ein – das dauert einen Moment …',
  anmelden: 'Gleich öffnet sich dein Browser: bei Claude anmelden und auf „Erlauben“ klicken.',
};

// onState({ installed, loggedIn, job }) wird bei jeder Änderung aufgerufen
export async function connectClaude({ onState } = {}) {
  let st = await api('POST', '/api/claude/verbinden');
  onState?.(st);
  if (st.installed && st.loggedIn) {
    toast('Claude ist dein Gehirn. 🎉');
    return st;
  }
  let shown = '';
  const say = (s) => {
    const msg = s.job?.state === 'fehler' ? s.job.error : MESSAGES[s.job?.state];
    if (msg && msg !== shown) {
      shown = msg;
      toast(msg, s.job?.state === 'fehler' ? 'error' : 'ok');
    }
  };
  say(st);
  clearInterval(watcher);
  const until = Date.now() + 10 * 60000;
  watcher = setInterval(async () => {
    if (Date.now() > until) return clearInterval(watcher);
    try {
      st = await api('GET', '/api/claude');
    } catch {
      return undefined;
    }
    onState?.(st);
    say(st);
    if (st.installed && st.loggedIn) {
      clearInterval(watcher);
      await api('PUT', '/api/brain', { mode: 'auto' }).catch(() => {});
      toast('Verbunden! 🎉 Claude ist jetzt dein Gehirn – frag einfach unten.');
      onState?.({ ...st, done: true });
    } else if (st.job?.state === 'fehler') clearInterval(watcher);
    return undefined;
  }, 2000);
  return st;
}
