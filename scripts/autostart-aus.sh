#!/bin/bash
# Schaltet den automatischen Start wieder aus und beendet den Assistenten.
LABEL="de.assistent-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Automatischer Start ist aus. Starten kannst du den Assistenten weiter mit Start.command."
