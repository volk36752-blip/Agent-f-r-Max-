// Tagesplan: frühestens zur eingestellten Uhrzeit (Standard 6 Uhr), sonst sobald der Rechner läuft.

import { runAgent, PLAN_PROMPT } from './agent.js';
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
      parts.push('Den Kalender konnte ich gerade nicht lesen.');
    }
  }
  const sum = ctx.todos.summary();
  parts.push(`${sum.today + sum.overdue === 0 ? 'Für heute ist kein To-do fällig' : `${sum.today + sum.overdue} To-do${sum.today + sum.overdue === 1 ? ' ist' : 's sind'} für heute fällig`}${sum.overdue ? `, davon ${sum.overdue} überfällig` : ''}.`);
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

export function createPlanner(ctx, { intervalMs = 120000 } = {}) {
  let running = false;
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
      if (ctx.services.claude.enabled()) {
        const before = ctx.todos.list({ status: 'alle' }).length;
        await runAgent({ ...ctx, source: 'tagesplan' }, { messages: [{ role: 'user', content: PLAN_PROMPT }], purpose: 'plan' });
        created = Math.max(0, ctx.todos.list({ status: 'alle' }).length - before);
        if (state.data.briefing?.date !== today) {
          const text = await simpleBriefing(ctx);
          state.update((s) => {
            s.briefing = { date: today, text, createdAt: Date.now() };
          });
        }
      } else {
        const text = await simpleBriefing(ctx);
        state.update((s) => {
          s.briefing = { date: today, text, createdAt: Date.now(), simple: true };
        });
      }
      state.update((s) => {
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

  async function tick() {
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
    isRunning: () => running,
  };
}
