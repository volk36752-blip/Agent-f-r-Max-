// Sprechen und Vorlesen – mit den Stimmen, die im Browser eingebaut sind (Safari, Chrome, Edge).

import { local } from './ui.js';

// ---------- Einstellungen (pro Gerät) ----------

export const voiceSettings = {
  get mode() {
    return local.get('antwort', 'text') === 'stimme' ? 'stimme' : 'text';
  },
  set mode(v) {
    local.set('antwort', v === 'stimme' ? 'stimme' : 'text');
  },
  get voiceURI() {
    return local.get('stimme', '');
  },
  set voiceURI(v) {
    local.set('stimme', v || '');
  },
  get rate() {
    return Number(local.get('tempo', '0.92')) || 0.92;
  },
  set rate(v) {
    local.set('tempo', v);
  },
  get pitch() {
    return Number(local.get('tonhoehe', '0.8')) || 0.8;
  },
  set pitch(v) {
    local.set('tonhoehe', v);
  },
  get keepListening() {
    return local.get('weiterhoeren', '1') === '1';
  },
  set keepListening(v) {
    local.set('weiterhoeren', v ? '1' : '0');
  },
};

// ---------- Vorlesen ----------

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const MALE = /(Markus|Yannick|Martin|Viktor|Stefan|Conrad|Killian|Florian|Ralf|Reed|Eddy|Rocko|Jonas|Daniel|Bernd|Hans|Thomas)/i;
const QUALITY = /(Premium|Erweitert|Enhanced|Natural|Neural|Siri)/i;
const NOVELTY = /(Grandma|Grandpa|Shelley|Sandy|Flo\b|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Kathy|Fred)/i;

export function germanVoices() {
  if (!synth) return [];
  return synth.getVoices().filter((v) => /^de/i.test(v.lang));
}

function score(v) {
  let s = 0;
  if (QUALITY.test(v.name)) s += 30;
  if (MALE.test(v.name)) s += 40;
  if (NOVELTY.test(v.name)) s -= 80;
  if (v.localService) s += 5;
  if (/de-DE/i.test(v.lang)) s += 3;
  return s;
}

// Tiefe, ruhige Stimme: am liebsten eine männliche deutsche Stimme in guter Qualität
export function pickVoice() {
  const voices = germanVoices();
  const saved = voiceSettings.voiceURI;
  if (saved) {
    const hit = voices.find((v) => v.voiceURI === saved) || (synth?.getVoices() || []).find((v) => v.voiceURI === saved);
    if (hit) return hit;
  }
  return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
}

export function rankedVoices() {
  return [...germanVoices()].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

const ABBREVIATION = /(?:(?:^|[\s(])[A-Za-zÄÖÜäöü]|\b(?:bzw|ca|evtl|inkl|usw|etc|Nr|Dr|Str|Tel|Mo|Di|Mi|Do|Fr|Sa|So|Jan|Feb|Mär|Apr|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez|vgl|ggf|bspw|max|min)|\d)$/;

// Wo endet der erste ganze Satz? (nicht bei „z. B.“ oder „6. November“)
export function sentenceEnd(buf) {
  const re = /([.!?…]+|\n)(\s+)/g;
  let m;
  while ((m = re.exec(buf))) {
    if (m[1] === '.' && ABBREVIATION.test(buf.slice(0, m.index))) continue;
    return m.index + m[0].length;
  }
  return -1;
}

export function cleanForSpeech(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*|__|`|#+\s/g, '')
    .replace(/^\s*([-•*]|\d+\.)\s+/gm, '')
    .replace(/\bz\. ?B\./g, 'zum Beispiel')
    .replace(/\bd\. ?h\./g, 'das heißt')
    .replace(/\bu\. ?a\./g, 'unter anderem')
    .replace(/\bbzw\./g, 'beziehungsweise')
    .replace(/\bca\./g, 'circa')
    .replace(/\busw\./g, 'und so weiter')
    .replace(/\bNr\./g, 'Nummer')
    .replace(/°C/g, ' Grad')
    .replace(/\s[–—]\s/g, ', ')
    .replace(/[„“”"»«]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const speech = {
  supported: Boolean(synth && typeof SpeechSynthesisUtterance !== 'undefined'),
  buffer: '',
  pending: 0,
  idleCallback: null,
  unlocked: false,
  onState: () => {},

  // iPhone: Vorlesen muss einmal durch einen Fingertipp freigeschaltet werden
  unlock() {
    if (!this.supported || this.unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
      this.unlocked = true;
    } catch {
      /* egal */
    }
  },

  say(text) {
    const t = cleanForSpeech(text);
    if (!this.supported || !t) return;
    const u = new SpeechSynthesisUtterance(t);
    const v = pickVoice();
    u.lang = v?.lang || 'de-DE';
    if (v) u.voice = v;
    u.rate = voiceSettings.rate;
    u.pitch = voiceSettings.pitch;
    this.pending++;
    this.onState('speaking');
    const finish = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (!this.pending) {
        this.onState('idle-speech');
        const cb = this.idleCallback;
        this.idleCallback = null;
        cb?.();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  },

  // Während die Antwort hereinkommt: ganze Sätze sofort vorlesen
  feed(delta) {
    this.buffer += delta;
    let cut;
    while ((cut = sentenceEnd(this.buffer)) > 0) {
      this.say(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut);
    }
  },

  flush() {
    if (this.buffer.trim()) this.say(this.buffer);
    this.buffer = '';
  },

  whenDone(cb) {
    if (!this.pending) cb();
    else this.idleCallback = cb;
  },

  stop() {
    this.buffer = '';
    this.idleCallback = null;
    this.pending = 0;
    if (this.supported) synth.cancel();
    this.onState('idle-speech');
  },

  get speaking() {
    return this.pending > 0;
  },

  test() {
    this.stop();
    this.unlock();
    this.say('Hallo, ich bin dein Assistent. So klinge ich, wenn ich dir antworte.');
  },
};

if (synth) {
  // Chrome lädt die Stimmen erst später
  synth.getVoices();
  synth.addEventListener?.('voiceschanged', () => synth.getVoices());
}

// ---------- Zuhören ----------

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const ears = {
  supported: Boolean(Recognition),
  rec: null,
  active: false,

  problem() {
    if (!Recognition) return 'Spracheingabe kann dieser Browser nicht. Nimm Safari oder Chrome – oder das Mikrofon auf deiner Tastatur.';
    if (!window.isSecureContext) return 'Das Mikrofon geht hier nur über eine sichere Verbindung (https) oder direkt am Mac über localhost. Auf dem iPhone kannst du solange das Mikrofon der Tastatur benutzen.';
    return null;
  },

  // onText(text, final) für die Live-Anzeige, onEnd(text) wenn fertig
  start({ onText, onEnd, onError }) {
    const problem = this.problem();
    if (problem) {
      onError?.(problem);
      return false;
    }
    this.stop(true);
    const rec = new Recognition();
    rec.lang = 'de-DE';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let latest = '';
    let cancelled = false;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      latest = `${finalText}${interim}`.trim();
      onText?.(latest, !interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      if (e.error === 'no-speech') onError?.('Ich habe nichts gehört.', 'no-speech');
      else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') onError?.('Kein Zugriff aufs Mikrofon. Erlaube es in den Browser-Einstellungen für diese Seite.', 'denied');
      else if (e.error === 'network') onError?.('Die Spracherkennung braucht gerade Internet.', 'network');
      else onError?.('Die Spracheingabe hat nicht geklappt.', e.error);
    };
    rec.onend = () => {
      this.active = false;
      this.rec = null;
      rec.cancelled = rec.cancelled || cancelled;
      onEnd?.(rec.cancelled ? '' : latest);
    };
    try {
      rec.start();
    } catch {
      onError?.('Die Spracheingabe konnte nicht starten.');
      return false;
    }
    this.rec = rec;
    this.active = true;
    return true;
  },

  // cancel: nichts abschicken
  stop(cancel = false) {
    if (!this.rec) return;
    this.rec.cancelled = cancel;
    try {
      if (cancel) this.rec.abort();
      else this.rec.stop();
    } catch {
      /* schon beendet */
    }
  },
};
