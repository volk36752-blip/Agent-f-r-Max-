#!/bin/bash
# Startet den Assistenten ab jetzt automatisch, sobald du dich am Mac anmeldest.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js nicht gefunden. Bitte zuerst die LTS-Version von https://nodejs.org installieren."
  exit 1
fi

case "$DIR" in
  "$HOME/Desktop"*|"$HOME/Documents"*|"$HOME/Downloads"*|"$HOME/Library/Mobile Documents"*)
    echo ""
    echo "Achtung: Der Ordner liegt in Schreibtisch, Dokumente, Downloads oder iCloud Drive."
    echo "Dort darf ein automatisch gestarteter Dienst unter macOS oft nicht lesen."
    echo "Verschieb den Ordner am besten direkt in deinen Benutzerordner (z. B. $HOME/assistent-agent)"
    echo "und starte dieses Skript dann nochmal."
    echo ""
    if [ "${ASSISTENT_OHNE_FRAGEN:-}" != "1" ]; then
      read -r -p "Trotzdem weitermachen? (j/n) " answer
      [ "$answer" = "j" ] || exit 1
    fi
    ;;
esac

LABEL="de.assistent-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/data"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/data/assistent.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/assistent.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2

if curl -s http://localhost:3000/api/health >/dev/null 2>&1; then
  echo "Fertig. Der Assistent läuft jetzt und startet nach jedem Anmelden von selbst."
  echo "Dashboard: http://localhost:3000"
  [ "${ASSISTENT_KEIN_BROWSER:-}" = "1" ] || open -a Safari http://localhost:3000 2>/dev/null || true
else
  echo "Gestartet, aber noch nicht erreichbar. Details stehen in: $DIR/data/assistent.log"
fi
