#!/bin/bash
# Baut die Mac-App „Assistent“ aus mac/main.swift und legt sie in den Programme-Ordner.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

if [ "$(uname)" != "Darwin" ]; then
  echo "Das geht nur auf einem Mac."
  exit 1
fi

echo ""
echo "  Baue die Mac-App „Assistent“ …"
echo ""

SWIFTC=""
if command -v swiftc >/dev/null 2>&1; then
  SWIFTC="swiftc"
elif xcrun --find swiftc >/dev/null 2>&1; then
  SWIFTC="xcrun swiftc"
fi
if [ -z "$SWIFTC" ]; then
  echo "  Dafür brauche ich die Xcode-Befehlszeilenwerkzeuge."
  echo "  Ich starte jetzt die Installation. Wenn sie fertig ist, starte mich nochmal."
  xcode-select --install || true
  exit 1
fi

case "$DIR" in
  "$HOME/Desktop"*|"$HOME/Documents"*|"$HOME/Downloads"*|"$HOME/Library/Mobile Documents"*)
    echo "  Hinweis: Der Ordner liegt in Schreibtisch, Dokumente, Downloads oder iCloud Drive."
    echo "  Die App funktioniert trotzdem. Für den Hintergrund-Modus ist dein Benutzerordner besser,"
    echo "  z. B. $HOME/assistent-agent – dann einfach dort nochmal bauen."
    echo ""
    ;;
esac

BUILD="$DIR/mac/build"
APP="$BUILD/Assistent.app"
rm -rf "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# 1. Programm übersetzen
echo "  1/4  Übersetze das Programm …"
$SWIFTC -O -o "$APP/Contents/MacOS/Assistent" "$DIR/mac/main.swift" \
  -framework Cocoa -framework WebKit -framework AVFoundation -framework Speech

# 2. Symbol
echo "  2/4  Erzeuge das Symbol …"
ICONSET="$BUILD/Assistent.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size" "$DIR/mac/icon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$double" "$double" "$DIR/mac/icon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Assistent.icns"
rm -rf "$ICONSET"

# 3. Beschreibung der App (Info.plist)
echo "  3/4  Schreibe die App-Beschreibung …"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DIR/package.json" | head -1)"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Assistent</string>
  <key>CFBundleDisplayName</key><string>Assistent</string>
  <key>CFBundleIdentifier</key><string>de.assistent-agent.mac</string>
  <key>CFBundleExecutable</key><string>Assistent</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Assistent</string>
  <key>CFBundleShortVersionString</key><string>${VERSION:-0.1.0}</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>CFBundleDevelopmentRegion</key><string>de</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Dein persönlicher Assistent</string>
  <key>NSMicrophoneUsageDescription</key><string>Damit du mit deinem Assistenten sprechen kannst.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Damit der Assistent versteht, was du sagst.</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
  <key>AssistentOrdner</key><string>$(xml "$DIR")</string>
  <key>AssistentPort</key><string>${PORT:-3000}</string>
</dict>
</plist>
PLIST

# Ohne Apple-Entwicklerkonto: lokal signieren, damit macOS die App erkennt
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

# 4. In den Programme-Ordner legen
echo "  4/4  Lege die App in den Programme-Ordner …"
TARGET="/Applications"
[ -w "$TARGET" ] || TARGET="$HOME/Applications"
mkdir -p "$TARGET"
if pgrep -x Assistent >/dev/null 2>&1; then
  osascript -e 'quit app "Assistent"' >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf "$TARGET/Assistent.app"
ditto "$APP" "$TARGET/Assistent.app"
rm -rf "$BUILD"

echo ""
echo "  Fertig! Die App liegt jetzt in: $TARGET"
echo "  Ich öffne sie für dich. Damit sie im Dock bleibt:"
echo "  Rechtsklick auf das orange Symbol im Dock → Optionen → Im Dock behalten."
echo ""
open "$TARGET/Assistent.app"
