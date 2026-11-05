// Einstellungen → Stimme: wie der Assistent klingt. Mit Probehören, Stimmen von Apple
// und freien Stimmen aus dem Internet (Piper), die man mit einem Klick lädt.

import { h, ICONS, icon, api, toast } from './ui.js';
import { speech, voiceSettings, rankedVoices, reloadVoices, voiceQuality, isMacApp, nativeCall, ears } from './voice.js';

const QUALITY_LABEL = { premium: 'Premium', erweitert: 'Erweitert', siri: 'Siri', system: 'Systemstimme', internet: 'Aus dem Internet', standard: 'Standard', online: 'Online' };
const NET_COLORS = ['teal', 'violet', 'pink', 'sky', 'amber', 'green', 'orange'];

function playButton(label, onPlay) {
  const btn = h('button', { class: 'play-btn', type: 'button', 'aria-label': label, title: label, html: ICONS.play });
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    document.querySelectorAll('.play-btn.playing').forEach((b) => b.classList.remove('playing'));
    btn.classList.add('playing');
    try {
      await onPlay();
    } finally {
      setTimeout(() => btn.classList.remove('playing'), 400);
    }
  });
  return btn;
}

function slider(id, label, min, max, step, get, set, fmt) {
  const out = h('output', { for: id }, fmt(get()));
  const input = h('input', { type: 'range', id, min, max, step, value: String(get()) });
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = fmt(Number(input.value));
  });
  input.addEventListener('change', () => speech.test());
  return h('div', { class: 'slider-row' }, h('label', { for: id }, label), input, out);
}

export async function voicePage() {
  // ---------- Antworten ----------
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Antwort als' });
  const mk = (mode, label) => h('button', { type: 'button', 'aria-pressed': voiceSettings.mode === mode ? 'true' : 'false', onclick: () => {
    voiceSettings.mode = mode;
    seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', (i === 0 ? 'text' : 'stimme') === mode ? 'true' : 'false'));
    if (mode === 'stimme') speech.test();
    else speech.stop();
  } }, label);
  seg.append(mk('text', 'Nur Text'), mk('stimme', 'Text + Stimme'));
  const keep = h('input', { type: 'checkbox', checked: voiceSettings.keepListening });
  keep.addEventListener('change', () => {
    voiceSettings.keepListening = keep.checked;
  });
  const answers = h('section', { class: 'panel tinted green' },
    h('div', { class: 'panel-head' }, h('span', { class: 'tile', html: ICONS.speaker }), h('h3', {}, 'Wie soll ich antworten?')),
    seg,
    slider('rate', 'Tempo', '0.8', '1.3', '0.02', () => voiceSettings.rate, (v) => { voiceSettings.rate = v; }, (v) => `${Math.round(v * 100)} %`),
    slider('pitch', 'Tonhöhe', '0.85', '1.2', '0.01', () => voiceSettings.pitch, (v) => { voiceSettings.pitch = v; }, (v) => (v < 0.95 ? 'tiefer' : v > 1.05 ? 'höher' : 'natürlich')),
    h('label', { class: 'check' }, keep, h('span', {}, 'Wenn ich gesprochen habe: nach der Antwort automatisch wieder zuhören')),
    ears.problem() ? h('p', { class: 'hint' }, ears.problem()) : '');

  // ---------- Deine Stimmen ----------
  const mineList = h('div', { class: 'voice-list', role: 'radiogroup', 'aria-label': 'Stimme' });
  const mineHint = h('p', { class: 'hint' });
  const choose = (uri) => {
    voiceSettings.voiceURI = uri;
    drawMine();
    speech.test();
  };
  function voiceRow(uri, title, sub, q, onPlay) {
    const checked = voiceSettings.voiceURI === uri;
    const row = h('button', { class: `voice q-${q}`, type: 'button', role: 'radio', 'aria-checked': checked ? 'true' : 'false', onclick: () => choose(uri) },
      h('span', { class: 'radio', 'aria-hidden': 'true' }),
      h('span', { class: 't' }, h('span', {}, title), sub ? h('small', {}, sub) : ''),
      q !== 'auto' ? h('span', { class: 'chip tint' }, QUALITY_LABEL[q] || q) : '',
      playButton(`${title} probehören`, onPlay));
    return row;
  }
  function drawMine() {
    const voices = rankedVoices();
    const best = voices[0];
    const rows = [voiceRow('', 'Automatisch', best ? `Nimmt immer die beste – gerade „${best.name}“` : 'Nimmt immer die beste Stimme', 'auto', () => speech.test(''))];
    for (const v of voices) {
      const q = voiceQuality(v);
      const sub = [v.male === true ? 'männlich' : v.male === false && q === 'internet' ? 'weiblich' : '', v.level || '', v.lang && v.lang !== 'de-DE' ? v.lang : ''].filter(Boolean).join(' · ');
      rows.push(voiceRow(v.voiceURI, v.name, sub, q, () => speech.test(v.voiceURI)));
    }
    mineList.replaceChildren(...rows);
    const good = voices.some((v) => ['premium', 'siri', 'internet', 'erweitert'].includes(voiceQuality(v)));
    mineHint.textContent = voices.length
      ? good ? 'Tippe auf ▶ zum Probehören, auf den Namen zum Auswählen.' : 'Du hast gerade nur einfache Stimmen. Unten kannst du schönere laden – aus dem Internet oder von Apple.'
      : 'Noch keine deutsche Stimme gefunden. Unten kannst du welche laden.';
  }
  drawMine();
  const onVoices = () => mineList.isConnected && drawMine();
  window.addEventListener('assistent-voices', onVoices);
  const mine = h('section', { class: 'panel tinted violet' },
    h('div', { class: 'panel-head' }, h('span', { class: 'tile', html: ICONS.wave }), h('h3', {}, 'Deine Stimmen')),
    mineHint, mineList);

  // ---------- Aus dem Internet ----------
  const netGrid = h('div', { class: 'net-grid' });
  const netNote = h('p', { class: 'hint' });
  let netData = { engine: false, voices: [] };
  let polling = null;

  async function refreshNet() {
    try {
      netData = await api('GET', '/api/stimmen');
    } catch (err) {
      netNote.textContent = err.message;
      return;
    }
    drawNet();
    const busy = netData.voices.some((v) => v.job && (v.job.state === 'laden' || v.job.state === 'entpacken'));
    if (busy && !polling) {
      polling = setInterval(async () => {
        if (!netGrid.isConnected) {
          clearInterval(polling);
          polling = null;
          return;
        }
        const before = new Set(netData.voices.filter((v) => v.installed).map((v) => v.id));
        await refreshNet();
        const fresh = netData.voices.filter((v) => v.installed && !before.has(v.id));
        if (fresh.length) {
          await reloadVoices();
          toast(`${fresh.map((v) => v.name).join(', ')} ist da – tippe auf „Benutzen“.`);
        }
      }, 800);
    } else if (!busy && polling) {
      clearInterval(polling);
      polling = null;
    }
  }

  function drawNet() {
    netNote.textContent = netData.engine
      ? 'Freie, natürlich klingende Stimmen. Erst probehören, dann laden – danach sprechen sie auf deinem Mac ohne Internet.'
      : 'Stimmen aus dem Internet gibt es in der Mac-App „Assistent“. Probehören geht trotzdem.';
    netGrid.replaceChildren(...netData.voices.map((v, i) => {
      const color = NET_COLORS[i % NET_COLORS.length];
      const job = v.job;
      const busy = job && (job.state === 'laden' || job.state === 'entpacken');
      const uri = `netz:${v.id}`;
      const actions = h('div', { class: 'row-actions' },
        playButton(`Hörprobe von ${v.name}`, () => speech.sample(`/api/stimmen/${encodeURIComponent(v.id)}/probe`).catch(() => toast('Die Hörprobe kam gerade nicht an.', 'error'))));
      if (v.installed) {
        const using = voiceSettings.voiceURI === uri;
        actions.append(
          h('button', { class: `btn btn-small${using ? ' btn-quiet' : ''}`, type: 'button', disabled: using, onclick: async () => {
            await reloadVoices();
            choose(uri);
            drawNet();
          } }, using ? icon('check') : '', using ? 'In Benutzung' : 'Benutzen'),
          h('button', { class: 'link-btn', type: 'button', onclick: async () => {
            try {
              await api('DELETE', `/api/stimmen/${encodeURIComponent(v.id)}`);
              if (voiceSettings.voiceURI === uri) voiceSettings.voiceURI = '';
              await reloadVoices();
              toast(`${v.name} gelöscht.`);
              refreshNet();
            } catch (err) {
              toast(err.message, 'error');
            }
          } }, 'Löschen'));
      } else if (!busy) {
        actions.append(h('button', { class: 'btn btn-small', type: 'button', disabled: !netData.engine, onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api('POST', `/api/stimmen/${encodeURIComponent(v.id)}/laden`);
            refreshNet();
          } catch (err) {
            toast(err.message, 'error');
            e.currentTarget.disabled = false;
          }
        } }, icon('download'), `Laden · ca. ${v.mb} MB`));
      }
      const pct = job?.total ? Math.min(100, Math.round((job.received / job.total) * 100)) : 0;
      const progress = busy ? h('div', { class: 'stack-tight' },
        h('div', { class: 'progress' }, h('i')),
        h('p', { class: 'hint' }, job.state === 'entpacken' ? 'Fast fertig – packe aus …' : `Lade … ${pct} % (${Math.round(job.received / 1048576)} von ${Math.round(job.total / 1048576)} MB)`)) : '';
      const bar = progress ? progress.querySelector('.progress') : null;
      if (bar) bar.style.setProperty('--p', `${job.state === 'entpacken' ? 100 : pct}%`);
      return h('article', { class: `net-voice ${color}` },
        h('div', { class: 'top' }, h('span', { class: 'tile', html: ICONS.wave }), h('div', {}, h('h3', {}, v.name), h('small', {}, `${v.gender} · ${v.level}`)), v.installed ? h('span', { class: 'chip ok' }, icon('check'), 'Geladen') : ''),
        h('p', {}, v.about),
        progress,
        job?.state === 'fehler' ? h('p', { class: 'c-error' }, job.error) : '',
        actions);
    }));
  }
  refreshNet();
  const net = h('section', { class: 'panel tinted teal' },
    h('div', { class: 'panel-head' }, h('span', { class: 'tile', html: ICONS.download }), h('h3', {}, 'Neue Stimmen aus dem Internet')),
    netNote, netGrid,
    h('p', { class: 'source-note' }, 'Herkunft: Piper-Stimmen von ',
      h('a', { href: 'https://huggingface.co/rhasspy/piper-voices', target: '_blank', rel: 'noopener' }, 'Hugging Face (rhasspy/piper-voices)'),
      ', umgewandelt vom Open-Source-Projekt ',
      h('a', { href: 'https://github.com/k2-fsa/sherpa-onnx', target: '_blank', rel: 'noopener' }, 'sherpa-onnx auf GitHub'),
      '. Geladen wird nur von diesen Seiten und nur verschlüsselt. Dein Text verlässt beim Sprechen nie deinen Mac.'));

  // ---------- Von Apple ----------
  const apple = h('section', { class: 'panel tinted amber' },
    h('div', { class: 'panel-head' }, h('span', { class: 'tile', html: ICONS.sparkle }), h('h3', {}, 'Noch mehr Stimmen von Apple')),
    h('ol', { class: 'steps-big' },
      h('li', {}, h('span', {}, 'Öffne ', h('b', {}, 'Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte'), '.')),
      h('li', {}, h('span', {}, 'Klick neben „Systemstimme“ auf ', h('b', {}, 'Stimmen verwalten …'), ', wähle ', h('b', {}, 'Deutsch'), ' und lade eine Stimme mit „Premium“ oder „Erweitert“ (z. B. Anna, Helena oder Markus).')),
      h('li', {}, h('span', {}, 'Am natürlichsten: Wähle dort eine ', h('b', {}, 'Siri-Stimme'), ' als Systemstimme – ich benutze sie dann automatisch.')),
      h('li', {}, h('span', {}, 'Zurück hier auf ', h('b', {}, '„Liste neu laden“'), ' tippen.'))),
    h('div', { class: 'row-actions' },
      isMacApp ? h('button', { class: 'btn btn-small btn-accent', type: 'button', onclick: () => nativeCall('openSettings', { kind: 'voices' }, 5000).catch(() => toast('Öffne Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte.')) }, 'Systemeinstellungen öffnen') : '',
      h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async () => {
        await reloadVoices();
        drawMine();
        toast('Stimmen neu geladen.');
      } }, icon('refresh'), 'Liste neu laden')),
    h('p', { class: 'hint' }, 'Taucht eine neue Apple-Stimme nicht auf, beende den Assistenten einmal und öffne ihn wieder.'));

  return [
    h('h2', {}, 'Stimme'),
    h('p', { class: 'lead' }, 'Wie dein Assistent klingt. Tippe auf ▶ zum Probehören. Unten in der Leiste schaltest du mit dem Lautsprecher zwischen „Nur Text“ und „Text + Stimme“ um.'),
    answers, mine, net, apple,
    h('p', { class: 'hint' }, 'Diese Einstellungen gelten für dieses Gerät.'),
  ];
}
