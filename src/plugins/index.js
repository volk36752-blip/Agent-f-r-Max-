// Plugins: Zusatz-Fähigkeiten, die du in den Einstellungen hinzufügst, wenn du sie brauchst.
// Ein Plugin bringt Werkzeuge für den Agenten mit – und manchmal ein Widget für die Startseite.

import schlagzeilen from './schlagzeilen.js';
import kurzbefehle from './kurzbefehle.js';
import notizen from './notizen.js';
import musik from './musik.js';
import webseiten from './webseiten.js';

export const PLUGINS = [schlagzeilen, kurzbefehle, notizen, musik, webseiten];

export class PluginError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createPlugins(ctx) {
  const enabled = () => new Set(ctx.stores.config.data.plugins || []);
  const find = (id) => PLUGINS.find((p) => p.id === id);
  const macOk = () => Boolean(ctx.services.bridge?.connected());

  const api = {
    list() {
      const on = enabled();
      return PLUGINS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        icon: p.icon,
        color: p.color || 'orange',
        examples: p.examples || [],
        needsMac: Boolean(p.needsMac),
        widget: p.widget ? p.widget.title : null,
        enabled: on.has(p.id),
        available: !p.needsMac || macOk(),
      }));
    },

    set(id, on) {
      if (!find(id)) throw new PluginError('Dieses Plugin gibt es nicht.', 404);
      ctx.stores.config.update((c) => {
        const list = new Set(c.plugins || []);
        if (on) list.add(id);
        else list.delete(id);
        c.plugins = [...list];
      });
      return api.list().find((p) => p.id === id);
    },

    isOn: (id) => enabled().has(id),

    tools() {
      const on = enabled();
      return PLUGINS.filter((p) => on.has(p.id)).flatMap((p) => p.tools.map((t) => ({
        ...t,
        plugin: p.id,
        requires: t.requires || (p.needsMac ? () => macOk() : undefined),
      })));
    },

    widgets() {
      const on = enabled();
      return PLUGINS.filter((p) => on.has(p.id) && p.widget).map((p) => ({ id: `plugin:${p.id}`, plugin: p.id, title: p.widget.title, icon: p.icon, color: p.color || 'orange' }));
    },

    async widgetData(id) {
      const p = find(id);
      if (!p?.widget || !enabled().has(id)) throw new PluginError('Dieses Widget ist nicht aktiv.', 404);
      return p.widget.load(ctx);
    },

    // Knöpfe in Widgets (z. B. Musik: Pause)
    async control(id, command, args = {}) {
      const p = find(id);
      if (!p?.control || !enabled().has(id)) throw new PluginError('Das geht hier nicht.', 404);
      return p.control(command, args, ctx);
    },

    registerActions(actions) {
      for (const p of PLUGINS) {
        for (const [kind, fn] of Object.entries(p.actions || {})) actions.register(kind, (a, value) => fn(a, value, ctx));
      }
    },
  };
  return api;
}
