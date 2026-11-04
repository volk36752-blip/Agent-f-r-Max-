import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceEnd, cleanForSpeech } from '../public/js/voice.js';

function splitAll(text) {
  const out = [];
  let buf = text;
  let cut;
  while ((cut = sentenceEnd(buf)) > 0) {
    out.push(buf.slice(0, cut).trim());
    buf = buf.slice(cut);
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

test('Vorlesen: Sätze richtig trennen', () => {
  assert.deepEqual(splitAll('Ja, du bist frei. Soll ich Lena schreiben? Gern!'), ['Ja, du bist frei.', 'Soll ich Lena schreiben?', 'Gern!']);
  assert.deepEqual(splitAll('Am Freitag, dem 6. November, hast du z. B. um 15 Uhr Zeit. Danach Training.'), ['Am Freitag, dem 6. November, hast du z. B. um 15 Uhr Zeit.', 'Danach Training.']);
  assert.equal(sentenceEnd('Noch nicht fertig'), -1, 'ohne Satzende wird gewartet');
  assert.equal(sentenceEnd('Ende.'), -1, 'erst trennen, wenn danach etwas kommt');
});

test('Vorlesen: Text wird sprechbar gemacht', () => {
  assert.equal(cleanForSpeech('**Heute:**\n- Zahnarzt – 10 Uhr\n- 9 °C, z. B. Regen'), 'Heute: Zahnarzt, 10 Uhr 9 Grad, zum Beispiel Regen');
  assert.equal(cleanForSpeech('Mehr unter https://example.com/abc dazu.'), 'Mehr unter dazu.');
});
