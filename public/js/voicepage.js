// Einstellungen → Stimme: wie der Assistent klingt. Mit Probehören – am natürlichsten mit einer Siri-Stimme.

import { h, ICONS, icon, api, toast } from './ui.js';
import { speech, voiceSettings, rankedVoices, reloadVoices, voiceQuality, isMacApp, nativeCall, ears } from './voice.js';

const QUALITY_LABEL = { premium: 'Premium', erweitert: 'Erweitert', siri: 'Siri', system: 'Systemstimme', internet: 'Aus dem Internet', standard: 'Standard', online: 'Online' };

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
      ? good ? 'Tippe auf ▶ zum Probehören, auf den Namen zum Auswählen.' : 'Du hast gerade nur einfache Stimmen – die klingen blechern. Stell oben eine Siri-Stimme ein, dann klingt es richtig echt.'
      : 'Noch keine deutsche Stimme gefunden. Stell oben eine Siri-Stimme ein.';
  }
  drawMine();
  const onVoices = () => mineList.isConnected && drawMine();
  window.addEventListener('assistent-voices', onVoices);
  const mine = h('section', { class: 'panel tinted violet' },
    h('div', { class: 'panel-head' }, h('span', { class: 'tile', html: ICONS.wave }), h('h3', {}, 'Deine Stimmen')),
    mineHint, mineList);

  // ---------- Von Apple ----------
  const apple = h('section', { class: 'panel tinted amber' },
    h('div', { class: 'panel-head' }, h('span', { class: 'tile', html: ICONS.sparkle }), h('h3', {}, 'So klingt er richtig echt')),
    h('p', { class: 'hint' }, 'Die natürlichsten Stimmen auf dem Mac sind die Siri-Stimmen. So stellst du eine ein – danach benutze ich sie automatisch:'),
    h('ol', { class: 'steps-big' },
      h('li', {}, h('span', {}, 'Öffne ', h('b', {}, 'Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte'), '.')),
      h('li', {}, h('span', {}, 'Wähle bei „Systemstimme“ eine ', h('b', {}, 'Siri-Stimme'), ' (Deutsch). Alternativ unter ', h('b', {}, 'Stimmen verwalten …'), ' eine deutsche Stimme mit „Premium“ laden.')),
      h('li', {}, h('span', {}, 'Zurück hier auf ', h('b', {}, '„Liste neu laden“'), ' tippen und probehören.'))),
    h('div', { class: 'row-actions' },
      isMacApp ? h('button', { class: 'btn btn-small btn-accent', type: 'button', onclick: () => nativeCall('openSettings', { kind: 'voices' }, 5000).catch(() => toast('Öffne Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte.')) }, 'Systemeinstellungen öffnen') : '',
      h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: async () => {
        await reloadVoices();
        drawMine();
        toast('Stimmen neu geladen.');
      } }, icon('refresh'), 'Liste neu laden')),
    h('p', { class: 'hint' }, 'Claudes eigene Stimme kann ich hier leider nicht einbauen – die gibt es nur direkt in der Claude-App. Taucht eine neue Stimme nicht auf, beende den Assistenten einmal und öffne ihn wieder.'));

  return [
    h('h2', {}, 'Stimme'),
    h('p', { class: 'lead' }, 'Wie dein Assistent klingt. Tippe auf ▶ zum Probehören. Unten in der Leiste schaltest du mit dem Lautsprecher zwischen „Nur Text“ und „Text + Stimme“ um.'),
    answers, apple, mine,
    h('p', { class: 'hint' }, 'Diese Einstellungen gelten für dieses Gerät.'),
  ];
}
