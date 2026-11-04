#!/bin/bash
# Doppelklick baut die Mac-App „Assistent“ und legt sie in den Programme-Ordner.
cd "$(dirname "$0")" || exit 1
./scripts/mac-app-bauen.sh
status=$?
echo ""
read -n 1 -s -r -p "  Taste drücken zum Schließen"
exit $status
