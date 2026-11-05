// Plugin „Musik“: Apple Music steuern – abspielen, Pause, weiter, Playlist oder Song suchen.

import { runJxa, JxaError } from '../lib/jxa.js';

const CONTROL = `// @music.control
function run(argv) {
  const input = JSON.parse(argv[0]);
  const Music = Application('Music');
  const a = input.action;
  if (a === 'status') {
    if (!Music.running()) return JSON.stringify({ state: 'stopped' });
  }
  if (a === 'play') Music.play();
  else if (a === 'pause') { if (Music.running()) Music.pause(); }
  else if (a === 'toggle') Music.playpause();
  else if (a === 'next') Music.nextTrack();
  else if (a === 'previous') Music.previousTrack();
  else if (a === 'louder') Music.soundVolume = Math.min(100, Music.soundVolume() + 15);
  else if (a === 'quieter') Music.soundVolume = Math.max(0, Music.soundVolume() - 15);
  else if (a === 'playlist') {
    const pl = Music.playlists.whose({ name: { _contains: input.query } });
    if (!pl.length) return JSON.stringify({ error: 'notFound' });
    pl[0].play();
  } else if (a === 'search') {
    const found = Music.search(Music.libraryPlaylists[0], { for: input.query });
    if (!found || !found.length) return JSON.stringify({ error: 'notFound' });
    Music.play(found[0]);
  }
  delay(0.4);
  let track = null;
  try {
    const t = Music.currentTrack;
    track = { name: t.name(), artist: t.artist(), album: t.album() };
  } catch (e) {}
  return JSON.stringify({ state: Music.playerState(), volume: Music.soundVolume(), track: track });
}`;

const ACTIONS = { abspielen: 'play', play: 'play', pause: 'pause', stopp: 'pause', weiter: 'next', naechster: 'next', zurueck: 'previous', lauter: 'louder', leiser: 'quieter', umschalten: 'toggle', playlist: 'playlist', suche: 'search', status: 'status' };
const STATE = { playing: 'spielt', paused: 'pausiert', stopped: 'gestoppt' };

async function control(ctx, action, query) {
  await ctx.services.apps.ensurePermission('music', 'Musik');
  try {
    const r = await runJxa(CONTROL, { action, query: query || '' }, { timeoutMs: 30000 });
    if (r?.error === 'notFound') throw new Error(`Dazu finde ich nichts in deiner Musik: „${query}“.`);
    return r;
  } catch (err) {
    if (err instanceof JxaError && err.code === 'denied') throw new Error('Ich darf die Musik-App nicht steuern. Erlauben kannst du es unter Einstellungen → Apps.');
    throw err;
  }
}

const describe = (r) => ({ zustand: STATE[r?.state] || r?.state || 'unbekannt', titel: r?.track?.name, kuenstler: r?.track?.artist, lautstaerke: r?.volume });

export default {
  id: 'musik',
  name: 'Musik',
  description: 'Der Agent steuert die Musik-App: abspielen, Pause, nächster Song, lauter/leiser, eine Playlist oder einen Song suchen.',
  icon: 'music',
  color: 'pink',
  needsMac: true,
  examples: ['Spiel meine Playlist „Fokus“', 'Mach mal Pause', 'Was läuft gerade?'],
  tools: [
    {
      name: 'music_control',
      title: 'Musik steuern',
      short: 'Steuert die Musik: action = abspielen, pause, weiter, zurueck, lauter, leiser, playlist (mit query), suche (mit query), status.',
      description: 'Steuert die Musik-App. action: abspielen, pause, weiter, zurueck, lauter, leiser, playlist (query = Name der Playlist), suche (query = Song/Künstler), status.',
      input_schema: { type: 'object', properties: { action: { type: 'string', enum: Object.keys(ACTIONS) }, query: { type: 'string' } }, required: ['action'], additionalProperties: false },
      async run(args, ctx) {
        return describe(await control(ctx, ACTIONS[args.action], args.query));
      },
    },
  ],
  widget: {
    title: 'Musik',
    async load(ctx) {
      const st = (await ctx.services.apps.permissions())?.music;
      if (st !== 'granted') return { needsPermission: true };
      return describe(await control(ctx, 'status'));
    },
  },
  async control(command, args, ctx) {
    const action = { toggle: 'toggle', next: 'next', previous: 'previous', allow: 'status' }[command];
    if (!action) throw new Error('Unbekannter Befehl.');
    return describe(await control(ctx, action));
  },
};
