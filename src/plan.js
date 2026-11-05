// Tagesplan: frühestens zur eingestellten Uhrzeit (Standard 6 Uhr), sonst sobald der Mac läuft.
// Dazu: Wenn dich jemand per WhatsApp fragt, ob du Zeit hast oder was du machst, landet ein To-do auf deiner Liste.

import { runAgent, runAppleAgent, brainStatus, PLAN_PROMPT } from './agent.js';
import { runTool } from './tools.js';
import { withRun } from './apps.js';
import { nowWall } from './lib/tz.js';

async function simpleBriefing(ctx) {
  const tz = ctx.services.tz();
  const today = nowWall(tz).date;
  const parts = [];
  const s = ctx.services;
  if (s.calendar.enabled()) {
    try {
      const events = await s.calendar.events(today, today);
      const timed = events.filter((e) => !e.allDay);
      if (!events.length) parts.push('Heute stehen keine Termine im Kalender.');
      else parts.push(`Heute hast du ${events.length === 1 ? 'einen Termin' : `${events.length} Termine`}${timed[0] ? `, der erste um ${timed[0].start.slice(11)}: ${timed[0].title}` : ''}.`);
    } catch {
      /* Kalender gerade nicht lesbar oder noch nicht erlaubt */
    }
  }
  const sum = ctx.todos.summary();
  parts.push(`${sum.today + sum.overdue === 0 ? 'Für heute ist kein To-do fällig' : `${sum.today + sum.overdue} To-do${sum.today + sum.overdue === 1 ? ' ist' : 's sind'} für heute fällig`}${sum.overdue ? `, davon ${sum.overdue} überfällig` : ''}.`);
  if (s.whatsapp.enabled()) {
    try {
      const chats = await s.whatsapp.chats({ unreadOnly: true, limit: 10 });
      if (chats.length) parts.push(`In WhatsApp warten ${chats.length === 1 ? `Nachrichten von ${chats[0].name}` : `${chats.length} Chats`} auf dich.`);
    } catch {
      /* WhatsApp gerade nicht lesbar */
    }
  }
  if (s.mail.enabled()) {
    try {
      const m = await s.mail.list({ unreadOnly: true, limit: 1 });
      parts.push(m.total ? `Im Posteingang warten ${m.total} ungelesene Mail${m.total === 1 ? '' : 's'}.` : 'Dein Posteingang ist gelesen.');
    } catch {
      /* Mail gerade nicht erreichbar */
    }
  }
  if (s.weather.enabled()) {
    try {
      const w = await s.weather.get();
      parts.push(`Wetter: ${w.today.text}, ${Math.round(w.today.min)} bis ${Math.round(w.today.max)} °C.`);
    } catch {
      /* Wetter gerade nicht erreichbar */
    }
  }
  return parts.join(' ');
}

function compactJson(value, max) {
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)} …` : text;
}

// Apple Intelligence hat wenig Platz: Daten vorher einsammeln, das Modell legt To-dos an und schreibt das Briefing.
async function applePlan(ctx, today) {
  const overview = await withRun({ purpose: 'plan' }, () => runTool('day_overview', {}, { ...ctx, purpose: 'plan' }));
  const prompt = `Hier ist mein Tag (${today}) als Daten:\n${compactJson(overview, 2600)}\n\nLege mit todo_add höchstens 5 sinnvolle To-dos für heute an (due = ${today}): Vorbereitung für Termine oder Antworten auf Nachrichten mit dem Namen im Titel. Nichts doppelt, nichts, was schon als To-do da ist. Schreib danach ein Briefing in 2–3 Sätzen in Du-Form: was heute wichtig ist, erster Termin, Wetter in einem Halbsatz.`;
  const r = await runAppleAgent({ ...ctx, source: 'tagesplan' }, { text: prompt, prompt, purpose: 'plan', tools: ['todo_add'] });
  return r.text;
}

const ASKS = /(hast du|habt ihr|bist du|kannst du|kommst du|machst du|lust|bock|zeit|frei|treffen|sehen wir uns|wann|heute|morgen|abend|wochenende|vorbei)/i;

export function looksLikeQuestion(text) {
  const t = String(text || '');
  if (/was (machst|hast) du (heute|morgen|so|vor)/i.test(t)) return true;
  return /\?/.test(t) && ASKS.test(t);
}

export function createPlanner(ctx, { intervalMs = 120000 } = {}) {
  let running = false;
  let watching = false;
  let timer = null;
  const state = ctx.stores.state;

  async function run() {
    if (running) return { ok: false, message: 'Der Tagesplan wird gerade schon erstellt.' };
    running = true;
    const tz = ctx.services.tz();
    const today = nowWall(tz).date;
    state.update((s) => {
      if (s.plan.date !== today) s.plan = { date: today, attempts: 0, lastAttemptAt: 0, lastError: null };
      s.plan.attempts++;
      s.plan.lastAttemptAt = Date.now();
    });
    try {
      let created = 0;
      const before = ctx.todos.list({ status: 'alle' }).length;
      const brain = brainStatus(ctx).active;
      let text = null;
      if (brain === 'claude') {
        await runAgent({ ...ctx, source: 'tagesplan' }, { messages: [{ role: 'user', content: PLAN_PROMPT }], purpose: 'plan' });
        if (state.data.briefing?.date === today) text = state.data.briefing.text;
      } else if (brain === 'apple') {
        text = await applePlan(ctx, today).catch((err) => {
          console.error(`Tagesplan mit Apple Intelligence: ${err.message}`);
          return null;
        });
      }
      created = Math.max(0, ctx.todos.list({ status: 'alle' }).length - before);
      if (!text) text = await withRun({ purpose: 'plan' }, () => simpleBriefing(ctx));
      state.update((s) => {
        s.briefing = { date: today, text, createdAt: Date.now(), simple: !brain || undefined };
        s.lastPlanDate = today;
        s.plan.lastError = null;
      });
      ctx.changed?.('briefing');
      ctx.changed?.('todos');
      return { ok: true, created };
    } catch (err) {
      state.update((s) => {
        s.plan.lastError = err.message;
      });
      throw err;
    } finally {
      running = false;
    }
  }

  function isDue() {
    const c = ctx.stores.config.data;
    if (!c.planEnabled || !c.setupDone) return false;
    const now = nowWall(c.timezone);
    const s = state.data;
    if (s.lastPlanDate === now.date) return false;
    if (now.time < c.planTime) return false;
    if (s.plan.date === now.date) {
      if (s.plan.attempts >= 4) return false;
      if (Date.now() - s.plan.lastAttemptAt < 15 * 60000) return false;
    }
    return true;
  }

  // Neue WhatsApp-Nachrichten: Fragt dich jemand, ob du Zeit hast? Dann To-do + Mitteilung.
  async function watchWhatsApp() {
    const s = ctx.services;
    const c = ctx.stores.config.data;
    if (watching || !c.setupDone || !s.whatsapp.enabled() || c.apps.whatsapp?.askTodos === false) return 0;
    const perms = await s.apps.permissions().catch(() => ({}));
    if (perms.whatsapp !== 'granted') return 0;
    watching = true;
    try {
      const seen = state.data.whatsapp?.seenMs || 0;
      if (!seen) {
        state.update((st) => {
          st.whatsapp = { seenMs: Date.now(), todoKeys: [] };
        });
        return 0;
      }
      const incoming = await withRun({ purpose: 'background' }, () => s.whatsapp.incomingSince(seen));
      if (!incoming.length) return 0;
      const today = nowWall(c.timezone).date;
      const keys = new Set(state.data.whatsapp.todoKeys || []);
      let added = 0;
      for (const m of incoming) {
        if (m.group || keys.has(String(m.id)) || !looksLikeQuestion(m.text)) continue;
        const excerpt = m.text.replace(/\s+/g, ' ').trim();
        const short = excerpt.length > 70 ? `${excerpt.slice(0, 67)}…` : excerpt;
        const t = ctx.todos.add({ title: `${m.name} antworten: „${short}“`, due: today, notes: `WhatsApp von ${m.name}: ${excerpt}`.slice(0, 2000) }, 'whatsapp');
        keys.add(String(m.id));
        if (!t.duplicate) {
          added++;
          s.bridge.call('notify', { title: `${m.name} fragt dich etwas`, body: short, route: '/' }, { timeoutMs: 8000 }).catch(() => {});
        }
      }
      const last = incoming[incoming.length - 1].atMs || Date.now();
      state.update((st) => {
        st.whatsapp = { seenMs: Math.max(seen, last), todoKeys: [...keys].slice(-300) };
      });
      if (added) ctx.changed?.('todos');
      return added;
    } finally {
      watching = false;
    }
  }

  async function tick() {
    watchWhatsApp().catch((err) => console.error(`WhatsApp-Hinweise: ${err.message}`));
    if (running || !isDue()) return;
    try {
      const r = await run();
      console.log(`Tagesplan erstellt (${r.created ?? 0} neue To-dos).`);
    } catch (err) {
      console.error(`Tagesplan fehlgeschlagen: ${err.message}`);
    }
  }

  return {
    start() {
      timer = setInterval(tick, intervalMs);
      setTimeout(tick, 10000).unref?.();
    },
    stop() {
      clearInterval(timer);
    },
    run,
    tick,
    isDue,
    watchWhatsApp,
    isRunning: () => running,
  };
}
