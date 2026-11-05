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
curl -fsS "$URL/" | grep -q '<div id="app">' || fail "Die Oberfläche wird nicht ausgeliefert"
echo "  ✓ Oberfläche wird ausgeliefert"

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
