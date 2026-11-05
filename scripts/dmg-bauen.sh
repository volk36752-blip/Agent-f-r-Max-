#!/bin/bash
# Packt build/Assistent.app in ein Disk-Image (build/Assistent.dmg) – mit Verknüpfung zu „Programme“.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$DIR/build/Assistent.app"
STAGE="$DIR/build/dmg"
DMG="$DIR/build/Assistent.dmg"

rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/Assistent.app"
ln -s /Applications "$STAGE/Programme"
for attempt in 1 2 3; do
  if hdiutil create -volname "Assistent" -srcfolder "$STAGE" -ov -format ULMO -fs HFS+ "$DMG" >/dev/null; then break; fi
  [ "$attempt" = 3 ] && exit 1
  echo "  hdiutil hat nicht geklappt, nächster Versuch …"
  sleep 5
done
hdiutil verify "$DMG" >/dev/null
rm -rf "$STAGE"
echo "  Fertig: $DMG ($(du -h "$DMG" | cut -f1))"
