#!/bin/bash
# Doppelklick startet den Assistenten und öffnet das Dashboard in Safari.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-3000}"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js fehlt noch. Ich öffne die Download-Seite."
  echo "  Installiere dort die LTS-Version und starte mich dann nochmal."
  echo ""
  open "https://nodejs.org/de/download"
  read -n 1 -s -r -p "  Taste drücken zum Schließen"
  exit 1
fi

if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
  echo "Der Assistent läuft schon – ich öffne das Dashboard."
  open -a Safari "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT"
  exit 0
fi

( sleep 1.5; open -a Safari "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT" ) &
exec node server.js
