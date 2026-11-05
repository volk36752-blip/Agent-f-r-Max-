// Sprechen und Vorlesen – mit den Stimmen, die im Browser eingebaut sind (Safari, Chrome, Edge).

import { local, api } from './ui.js';

// ---------- Einstellungen (pro Gerät) ----------

// Neue Schlüssel (…2): Die alte, tiefe Grundeinstellung klang blechern – alle starten mit natürlicher Stimme.
export const voiceSettings = {
  get mode() {
    return local.get('antwort', 'text') === 'stimme' ? 'stimme' : 'text';
  },
  set mode(v) {
    local.set('antwort', v === 'stimme' ? 'stimme' : 'text');
  },
  get voiceURI() {
    return local.get('stimme2', '');
  },
  set voiceURI(v) {
    local.set('stimme2', v || '');
  },
  get rate() {
    return Number(local.get('tempo2', '1')) || 1;
  },
  set rate(v) {
    local.set('tempo2', v);
  },
  get pitch() {
    return Number(local.get('tonhoehe2', '1')) || 1;
  },
  set pitch(v) {
    local.set('tonhoehe2', v);
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

// In der Mac-App übernimmt macOS das Vorlesen und Zuhören – über eine Brücke zur App.
const nativeHandler = typeof window !== 'undefined' && window.webkit?.messageHandlers?.assistentNative ? window.webkit.messageHandlers.assistentNative : null;
export const isMacApp = Boolean(nativeHandler);
const bridge = {
  seq: 0,
  handlers: new Map(),
  call(cmd, data = {}, handler) {
    const id = `n${++this.seq}`;
    if (handler) this.handlers.set(id, handler);
    nativeHandler.postMessage({ cmd, id, ...data });
    return id;
  },
};
// Frage an die Mac-App, Antwort kommt als Nachricht mit derselben id zurück
export function nativeCall(cmd, data = {}, timeoutMs = 120000) {
  if (!nativeHandler) return Promise.reject(new Error('Das geht nur in der Mac-App.'));
  return new Promise((resolve, reject) => {
    let timer = null;
    const id = bridge.call(cmd, data, (m) => {
      bridge.handlers.delete(m.id);
      clearTimeout(timer);
      resolve(m);
    });
    timer = setTimeout(() => {
      bridge.handlers.delete(id);
      reject(new Error('Die App antwortet gerade nicht.'));
    }, timeoutMs);
  });
}

let nativeVoices = [];
if (nativeHandler) {
  window.__assistentNative = {
    receive(msg) {
      const handler = bridge.handlers.get(msg?.id);
      if (handler) handler(msg);
    },
  };
}

// Stimmen aus dem Internet, die schon geladen sind (spricht der Assistent selbst – auch fürs iPhone)
let netVoices = [];
let engineReady = false;
async function loadNetVoices() {
  try {
    const data = await api('GET', '/api/stimmen');
    engineReady = Boolean(data.engine);
    netVoices = engineReady ? data.voices.filter((v) => v.installed).map((v) => ({ name: v.name, lang: 'de-DE', voiceURI: `netz:${v.id}`, localService: true, quality: 'internet', male: v.gender === 'männlich', nativeScore: v.score, level: v.level })) : [];
  } catch {
    netVoices = [];
  }
}

// Stimmen (neu) laden – z. B. nachdem du eine geladen hast
export async function reloadVoices() {
  const net = loadNetVoices();
  if (nativeHandler) {
    await new Promise((resolve) => {
      bridge.call('voices', {}, (m) => {
        bridge.handlers.delete(m.id);
        nativeVoices = (m.voices || []).map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.id, localService: true, quality: v.quality, male: v.male, nativeScore: v.score }));
        resolve();
      });
    });
  } else synth?.getVoices();
  await net;
  window.dispatchEvent(new Event('assistent-voices'));
  return germanVoices();
}
if (typeof window !== 'undefined') reloadVoices();

const PREMIUM = /(Premium|Natural|Neural|Siri)/i;
const ENHANCED = /(Erweitert|Enhanced|verbessert)/i;
const NOVELTY = /(Grandma|Grandpa|Shelley|Sandy|Flo\b|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Kathy|Fred|Eddy|Reed|Rocko)/i;

// Qualität der Stimme, wie sie in der Auswahl angezeigt wird
export function voiceQuality(v) {
  if (v.quality) return v.quality;
  if (PREMIUM.test(v.name)) return 'premium';
  if (ENHANCED.test(v.name)) return 'erweitert';
  return v.localService === false ? 'online' : 'standard';
}

function deviceVoices() {
  if (nativeHandler) return nativeVoices;
  if (!synth) return [];
  return synth.getVoices().filter((v) => /^de/i.test(v.lang));
}

export function germanVoices() {
  return [...deviceVoices(), ...netVoices];
}

const isNet = (uri) => String(uri || '').startsWith('netz:');

function score(v) {
  if (v.nativeScore !== undefined) return v.nativeScore;
  let s = 0;
  const q = voiceQuality(v);
  if (q === 'premium') s += 100;
  if (q === 'erweitert') s += 60;
  if (q === 'online') s += 40; // Online-Stimmen (z. B. in Chrome) klingen meist natürlich
  if (NOVELTY.test(v.name)) s -= 300;
  if (/de-DE/i.test(v.lang)) s += 5;
  return s;
}

// Am liebsten die natürlichste deutsche Stimme, die das Gerät hat
export function pickVoice() {
  const voices = deviceVoices();
  const saved = voiceSettings.voiceURI;
  if (saved) {
    const hit = voices.find((v) => v.voiceURI === saved) || (synth?.getVoices() || []).find((v) => v.voiceURI === saved);
    if (hit) return hit;
  }
  return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
}

export function rankedVoices() {
  return [...germanVoices()].filter((v) => score(v) > -100).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
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
  supported: Boolean(nativeHandler || (synth && typeof SpeechSynthesisUtterance !== 'undefined') || typeof Audio !== 'undefined'),
  buffer: '',
  pending: 0,
  generation: 0,
  idleCallback: null,
  unlocked: false,
  onState: () => {},

  // iPhone: Vorlesen muss einmal durch einen Fingertipp freigeschaltet werden
  unlock() {
    if (nativeHandler || !this.supported || this.unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
      this.unlocked = true;
    } catch {
      /* egal */
    }
  },

  say(text, { voice } = {}) {
    const t = cleanForSpeech(text);
    if (!this.supported || !t) return;
    const gen = this.generation;
    this.pending++;
    this.onState('speaking');
    let finished = false;
    const finish = () => {
      if (finished || gen !== this.generation) return; // gestoppt: alte Meldungen ignorieren
      finished = true;
      this.pending = Math.max(0, this.pending - 1);
      if (!this.pending) {
        this.onState('idle-speech');
        const cb = this.idleCallback;
        this.idleCallback = null;
        cb?.();
      }
    };
    // Automatisch: die beste Stimme – das kann auch eine geladene Internet-Stimme sein
    let chosen = voice ?? voiceSettings.voiceURI;
    if (!chosen && netVoices.length) {
      const best = rankedVoices()[0];
      if (best && isNet(best.voiceURI)) chosen = best.voiceURI;
    }
    if (isNet(chosen) && netVoices.some((v) => v.voiceURI === chosen)) this.sayNet(t, chosen, gen, finish);
    else this.sayDevice(t, isNet(chosen) ? '' : chosen, finish);
  },

  // Mit den Stimmen von macOS (Mac-App) oder des Browsers
  sayDevice(t, voice, finish) {
    if (nativeHandler) {
      bridge.call('speak', { text: t, rate: voiceSettings.rate, pitch: voiceSettings.pitch, voice: voice || '' }, (m) => {
        if (m.type !== 'speech-end') return;
        bridge.handlers.delete(m.id);
        finish();
      });
      return;
    }
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      finish();
      return;
    }
    const u = new SpeechSynthesisUtterance(t);
    const v = voice ? deviceVoices().find((x) => x.voiceURI === voice) || pickVoice() : pickVoice();
    u.lang = v?.lang || 'de-DE';
    if (v) u.voice = v;
    u.rate = voiceSettings.rate;
    u.pitch = voiceSettings.pitch;
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  },

  // Internet-Stimme: der Assistent macht daraus eine Tondatei. Der nächste Satz wird schon
  // vorbereitet, während der aktuelle läuft – so gibt es kaum Pausen.
  netChain: Promise.resolve(),
  netStop: null,
  audio: null,
  sayNet(t, uri, gen, finish) {
    const req = fetch('/api/sprechen', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-assistent': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ text: t, voice: uri, speed: voiceSettings.rate }),
    }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
    req.catch(() => {});
    this.netChain = this.netChain.then(async () => {
      if (gen !== this.generation) return finish();
      let blob;
      try {
        blob = await req;
      } catch {
        if (gen === this.generation) this.sayDevice(t, '', finish); // klappt es nicht, spricht die Mac-Stimme
        else finish();
        return undefined;
      }
      if (gen !== this.generation) return finish();
      await this.playBlob(blob);
      return finish();
    });
  },

  audioEl() {
    if (!this.audio) this.audio = new Audio();
    return this.audio;
  },

  play(src) {
    return new Promise((resolve) => {
      const a = this.audioEl();
      const done = () => {
        a.onended = null;
        a.onerror = null;
        this.netStop = null;
        resolve();
      };
      this.netStop = () => {
        a.pause();
        done();
      };
      a.onended = done;
      a.onerror = done;
      a.src = src;
      a.play().catch(done);
    });
  },

  async playBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      await this.play(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  // Hörprobe einer Internet-Stimme, bevor du sie lädst
  async sample(url) {
    this.stop();
    this.onState('speaking');
    await this.play(url);
    if (!this.pending) this.onState('idle-speech');
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
    this.generation++;
    this.buffer = '';
    this.idleCallback = null;
    this.pending = 0;
    this.netStop?.();
    this.netChain = Promise.resolve();
    if (nativeHandler) bridge.call('stopSpeaking');
    else if (synth) synth.cancel();
    this.onState('idle-speech');
  },

  get speaking() {
    return this.pending > 0;
  },

  test(voice) {
    this.stop();
    this.unlock();
    this.say('Hallo! Schön, dass du da bist. So klinge ich, wenn ich dir antworte.', voice !== undefined ? { voice } : {});
  },
};

if (synth) {
  // Chrome lädt die Stimmen erst später
  synth.getVoices();
  synth.addEventListener?.('voiceschanged', () => {
    synth.getVoices();
    window.dispatchEvent(new Event('assistent-voices'));
  });
}

// ---------- Zuhören ----------

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const ears = {
  supported: Boolean(nativeHandler || Recognition),
  rec: null,
  active: false,
  nativeId: null,
  cancelledId: null,

  problem() {
    if (nativeHandler) return null;
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
    if (nativeHandler) {
      let latest = '';
      const id = bridge.call('listen', {}, (m) => {
        if (m.type === 'listen-text') {
          latest = m.text || '';
          onText?.(latest, Boolean(m.final));
        } else if (m.type === 'listen-error') {
          onError?.(m.message, m.code);
        } else if (m.type === 'listen-end') {
          bridge.handlers.delete(id);
          if (this.nativeId === id) {
            this.nativeId = null;
            this.active = false;
          }
          onEnd?.(this.cancelledId === id ? '' : (m.text || latest).trim());
        }
      });
      this.nativeId = id;
      this.active = true;
      return true;
    }
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
    if (nativeHandler) {
      if (!this.nativeId) return;
      if (cancel) this.cancelledId = this.nativeId;
      bridge.call('stopListening', { cancel });
      return;
    }
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
