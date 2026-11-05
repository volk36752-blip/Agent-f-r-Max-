#!/bin/bash
# Startet das fertige Paket build/Assistent.app einmal richtig und prüft, ob alles läuft.
# Läuft beim automatischen Bauen auf GitHub; geht aber auch auf jedem Mac.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$DIR/build/Assistent.app"
DATA="$HOME/Library/Application Support/Assistent"
URL="http://127.0.0.1:3000"
fail() { echo "::error::$1"; [ -f "$DATA/assistent.log" ] && { echo "--- assistent.log ---"; cat "$DATA/assistent.log"; }; exit 1; }

echo "  Architekturen: $(lipo -archs "$APP/Contents/MacOS/Assistent")"
codesign --verify --deep --strict "$APP" || fail "Die Signatur der App stimmt nicht"
echo "  ✓ Signatur in Ordnung"
"$APP/Contents/Helpers/node-arm64" --version >/dev/null || fail "Das mitgelieferte Node.js startet nicht"
echo "  ✓ Mitgeliefertes Node.js startet ($("$APP/Contents/Helpers/node-arm64" --version))"

# Beim Test nicht fragen, ob die App nach „Programme“ soll
defaults write de.assistent-agent.mac nichtVerschieben -bool true
rm -rf "$DATA"
open "$APP"
up=""
for _ in $(seq 1 90); do
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
[ -n "$up" ] || fail "Die App hat den Assistenten nicht gestartet"
echo "  ✓ App startet den Assistenten"
pgrep -fl "Contents/Helpers/node-" >/dev/null || fail "Der Assistent läuft nicht mit dem mitgelieferten Node.js"
echo "  ✓ Läuft mit dem mitgelieferten Node.js"

KEY="$(cat "$DATA/app-schluessel" 2>/dev/null || true)"
[ -n "$KEY" ] || fail "Kein App-Schlüssel im Datenordner"
COOKIE="$(curl -fsS -o /dev/null -D - "$URL/api/app-login?key=$KEY" | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | head -1)"
[ -n "$COOKIE" ] || fail "Die App kann sich nicht ohne Passwort anmelden"
STATUS="$(curl -fsS -H "Cookie: $COOKIE" "$URL/api/status")"
echo "$STATUS" | grep -q '"loggedIn":true' || fail "Nicht angemeldet: $STATUS"
echo "  ✓ App meldet sich ohne Passwort an"
# Die App verbindet sich mit dem Assistenten (Kalender, WhatsApp, Apple Intelligence …)
bridge=""
for _ in $(seq 1 30); do
  if curl -fsS "$URL/api/status" | grep -q '"mac":true'; then bridge=1; break; fi
  sleep 1
done
[ -n "$bridge" ] || fail "Die Mac-App verbindet sich nicht mit dem Assistenten (Brücke)"
echo "  ✓ Brücke zur Mac-App steht"
BRAIN="$(curl -fsS -H "Cookie: $COOKIE" "$URL/api/brain" || true)"
echo "  Apple Intelligence: $(echo "$BRAIN" | sed -n 's/.*"apple":{\([^}]*\)}.*/\1/p')"
APPS="$(curl -fsS -H "Cookie: $COOKIE" "$URL/api/apps" || true)"
echo "$APPS" | grep -q '"permission":"unknown"' || echo "$APPS" | grep -q '"permission":"notInstalled"' || fail "Die Mac-App meldet keine Berechtigungen: $APPS"
echo "  ✓ Berechtigungen kommen von der Mac-App"
W="$(curl -fsS -H "Cookie: $COOKIE" "$URL/api/widget/termine" || true)"
echo "$W" | grep -q '"state":"ask"' || fail "Kalender-Widget sollte nach Erlaubnis fragen: $W"
echo "  ✓ Kalender fragt erst nach Erlaubnis"
PAGE="$(curl -fsS "$URL/" || true)"
grep -q 'id="app"' <<<"$PAGE" || fail "Die Oberfläche wird nicht ausgeliefert"
echo "  ✓ Oberfläche wird ausgeliefert"

# Stimmen aus dem Internet: die kleinste laden und einen Satz sprechen lassen.
# Ist das Sprach-Programm dabei, muss es auch wirklich sprechen. Klappt nur das Laden aus dem Netz nicht,
# ist das eine Warnung (Netz-Wackler beim Bauen).
if [ -x "$APP/Contents/Helpers/sherpa/bin/sherpa-onnx-offline-tts" ]; then
  V="$(curl -fsS -H "Cookie: $COOKIE" "$URL/api/stimmen" || true)"
  echo "$V" | grep -q '"engine":true' || fail "Der Assistent findet das Sprach-Programm nicht: $V"
  curl -fsS -X POST -H "Cookie: $COOKIE" -H "x-assistent: 1" "$URL/api/stimmen/eva_k-x_low/laden" >/dev/null || fail "Stimme laden startet nicht"
  loaded=""
  for _ in $(seq 1 240); do
    V="$(curl -fsS -H "Cookie: $COOKIE" "$URL/api/stimmen" || true)"
    if echo "$V" | grep -q '"id":"eva_k-x_low"[^}]*"installed":true'; then loaded=1; break; fi
    if echo "$V" | grep -q '"state":"fehler"'; then echo "::warning::Stimme aus dem Internet ließ sich beim Bauen nicht laden: $V"; break; fi
    sleep 1
  done
  if [ -n "$loaded" ]; then
    echo "  ✓ Stimme „Eva“ aus dem Internet geladen"
    T0=$(date +%s)
    curl -fsS -X POST -H "Cookie: $COOKIE" -H "x-assistent: 1" -H "content-type: application/json" \
      -d '{"voice":"netz:eva_k-x_low","text":"Hallo! Schön, dass du da bist.","speed":1.1}' "$URL/api/sprechen" -o "$DIR/build/stimme.wav" \
      || fail "Sprechen mit der geladenen Stimme klappt nicht"
    head -c 4 "$DIR/build/stimme.wav" | grep -q RIFF || fail "Das Sprach-Programm liefert keine Tondatei"
    echo "  ✓ Internet-Stimme spricht ($(wc -c < "$DIR/build/stimme.wav" | tr -d ' ') Bytes in $(( $(date +%s) - T0 )) s)"
  else
    echo "::warning::Internet-Stimme nicht fertig geladen – Sprechen nicht geprüft"
  fi
  curl -fsS -H "Cookie: $COOKIE" "$URL/api/stimmen/eva_k-x_low/probe" -o /dev/null && echo "  ✓ Hörprobe von Hugging Face kommt an" || echo "::warning::Hörprobe von Hugging Face kam nicht an"
else
  echo "::warning::Ohne Sprach-Programm gebaut – Internet-Stimmen sind in dieser Version aus"
fi

sleep 6
screencapture -x "$DIR/build/vorschau.png" 2>/dev/null && echo "  ✓ Bildschirmfoto gemacht" || echo "  (kein Bildschirmfoto möglich)"

# Beenden: Der Server soll mit der App stoppen
pkill -TERM -x Assistent || true
down=""
for _ in $(seq 1 20); do
  if ! curl -fsS "$URL/api/health" >/dev/null 2>&1; then down=1; break; fi
  sleep 0.5
done
[ -n "$down" ] && echo "  ✓ Beim Beenden stoppt auch der Assistent" || { echo "::warning::Der Assistent lief nach dem Beenden weiter"; pkill -f "Contents/Helpers/node-" || true; }
pgrep -x Assistent >/dev/null && { echo "::warning::Die App lief nach dem Beenden weiter"; pkill -9 -x Assistent || true; }

rm -rf "$DATA"
defaults delete de.assistent-agent.mac >/dev/null 2>&1 || true
echo "  Alles geprüft."
