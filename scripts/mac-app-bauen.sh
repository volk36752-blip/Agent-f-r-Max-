#!/bin/bash
# Baut die Mac-App „Assistent“ aus mac/main.swift.
#
#   scripts/mac-app-bauen.sh           App aus diesem Ordner: benutzt dein installiertes Node.js,
#                                      Daten in ./data, legt die App in „Programme“ und öffnet sie.
#   scripts/mac-app-bauen.sh --paket   Fertiges Paket zum Weitergeben (so wie der Download):
#                                      Server und Node.js stecken in der App, Ergebnis in build/Assistent.app.
#                                      Vorher scripts/node-holen.sh ausführen.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

MODE="ordner"
[ "${1:-}" = "--paket" ] && MODE="paket"

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

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DIR/package.json" | head -1)"
VERSION="${APP_VERSION:-${VERSION:-0.2.0}}"
BUILD_NUMBER="${APP_BUILD:-$(date +%Y%m%d%H%M)}"

if [ "$MODE" = "paket" ]; then
  BUILD="$DIR/build"
  NODE_DIR="$BUILD/node"
  for arch in arm64 x64; do
    if [ ! -x "$NODE_DIR/node-$arch" ]; then
      echo "  Node.js fehlt in $NODE_DIR – erst scripts/node-holen.sh ausführen."
      exit 1
    fi
  done
else
  BUILD="$DIR/mac/build"
fi
APP="$BUILD/Assistent.app"
rm -rf "$APP" "$BUILD/obj"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$BUILD/obj"

# Apple Intelligence (Foundation Models) gibt es erst ab dem macOS-26-SDK. Die App startet trotzdem
# auf älteren Macs: Das Framework wird nur „schwach“ eingebunden.
SDK="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
AI_FLAGS=()
if [ -n "$SDK" ] && [ -d "$SDK/System/Library/Frameworks/FoundationModels.framework" ]; then
  AI_FLAGS=(-Xfrontend -disable-autolink-framework -Xfrontend FoundationModels -Xlinker -weak_framework -Xlinker FoundationModels)
  echo "       Mit Apple Intelligence (SDK: $(basename "$SDK"))"
else
  echo "       Ohne Apple Intelligence (SDK zu alt: $(basename "${SDK:-unbekannt}"))"
fi

# Fehler von swiftc als Hinweise in GitHub anzeigen
compile() {
  local out="$1"; shift
  local log="$BUILD/obj/swiftc-$(basename "$out").log"
  if ! $SWIFTC -O -o "$out" "$DIR"/mac/*.swift \
      -framework Cocoa -framework WebKit -framework AVFoundation -framework Speech \
      -framework UserNotifications -framework CoreLocation -framework EventKit -framework Contacts \
      -lsqlite3 ${AI_FLAGS[@]+"${AI_FLAGS[@]}"} "$@" >"$log" 2>&1; then
    cat "$log"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      grep -E '^[^ ]+\.swift:[0-9]+:[0-9]+: error:' "$log" | sed -E 's#^.*/(mac/[^:]+):([0-9]+):([0-9]+): error: (.*)$#::error file=\1,line=\2,col=\3::\4#' || true
    fi
    return 1
  fi
  echo "       ($(grep -c 'warning:' "$log" || true) Warnungen)"
}

# 1. Programm übersetzen
echo "  1/4  Übersetze das Programm …"
if [ "$MODE" = "paket" ]; then
  # Für Apple-Chips und Intel-Macs
  compile "$BUILD/obj/Assistent-arm64" -target arm64-apple-macos12.0
  compile "$BUILD/obj/Assistent-x86_64" -target x86_64-apple-macos12.0
  lipo -create -output "$APP/Contents/MacOS/Assistent" "$BUILD/obj/Assistent-arm64" "$BUILD/obj/Assistent-x86_64"
else
  compile "$APP/Contents/MacOS/Assistent"
fi

# 2. Symbol
echo "  2/4  Erzeuge das Symbol …"
ICONSET="$BUILD/obj/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size" "$DIR/mac/icon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$double" "$double" "$DIR/mac/icon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# 3. Inhalt und Beschreibung der App (Info.plist)
echo "  3/4  Packe die App …"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
EXTRA=""
if [ "$MODE" = "paket" ]; then
  mkdir -p "$APP/Contents/Resources/server" "$APP/Contents/Helpers"
  cp -R "$DIR/server.js" "$DIR/package.json" "$DIR/src" "$DIR/public" "$DIR/bin" "$APP/Contents/Resources/server/"
  find "$APP/Contents/Resources/server" -name '.DS_Store' -delete
  cp "$NODE_DIR/node-arm64" "$NODE_DIR/node-x64" "$APP/Contents/Helpers/"
  # Sprach-Programm für die Stimmen aus dem Internet (scripts/stimmen-programm-holen.sh)
  if [ -x "$BUILD/sherpa/bin/sherpa-onnx-offline-tts" ]; then
    ditto "$BUILD/sherpa" "$APP/Contents/Helpers/sherpa"
    echo "       Mit Sprach-Programm für Internet-Stimmen ($(du -sh "$APP/Contents/Helpers/sherpa" | cut -f1))"
  else
    echo "       Ohne Sprach-Programm – Internet-Stimmen gehen dann nicht (erst scripts/stimmen-programm-holen.sh)"
  fi
  [ -f "$NODE_DIR/LICENSE" ] && cp "$NODE_DIR/LICENSE" "$APP/Contents/Resources/Node.js-Lizenz.txt"
else
  EXTRA="  <key>AssistentOrdner</key><string>$(xml "$DIR")</string>"
fi

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
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
  <key>CFBundleDevelopmentRegion</key><string>de</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Dein persönlicher Assistent</string>
  <key>NSMicrophoneUsageDescription</key><string>Damit du mit deinem Assistenten sprechen kannst.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Damit der Assistent versteht, was du sagst.</string>
  <key>NSLocationUsageDescription</key><string>Damit der Assistent das Wetter für deinen Ort zeigt.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Damit der Assistent das Wetter für deinen Ort zeigt.</string>
  <key>NSCalendarsUsageDescription</key><string>Damit der Assistent deine Termine zeigt, freie Zeit prüft und Termine einträgt.</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>Damit der Assistent deine Termine zeigt, freie Zeit prüft und Termine einträgt.</string>
  <key>NSRemindersUsageDescription</key><string>Damit der Assistent deine Erinnerungen zeigt und neue anlegt.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>Damit der Assistent deine Erinnerungen zeigt und neue anlegt.</string>
  <key>NSContactsUsageDescription</key><string>Damit der Assistent Telefonnummern und Mail-Adressen findet, wenn du jemandem schreiben willst.</string>
  <key>NSAppleEventsUsageDescription</key><string>Damit der Assistent deine Mails, Notizen und Musik für dich bedienen kann.</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
  <key>AssistentPort</key><string>${PORT:-3000}</string>
${EXTRA}
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Ohne Apple-Entwicklerkonto: ad hoc signieren, damit macOS die App als Ganzes erkennt
if [ -d "$APP/Contents/Helpers/sherpa" ]; then
  find "$APP/Contents/Helpers/sherpa" -type f \( -name '*.dylib' -o -perm -u+x \) -exec codesign --force --sign - --timestamp=none {} \;
fi
if ! codesign --force --sign - --timestamp=none "$APP" 2>"$BUILD/obj/codesign.log"; then
  cat "$BUILD/obj/codesign.log"
  echo "  Signieren ohne --deep ging nicht, versuche es mit --deep …"
  codesign --force --deep --sign - --timestamp=none "$APP"
fi
codesign --verify --deep --strict "$APP"
rm -rf "$BUILD/obj"

if [ "$MODE" = "paket" ]; then
  echo "  4/4  Fertig: $APP"
  du -sh "$APP" | sed 's/^/       Größe: /'
  exit 0
fi

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
echo "  Ich öffne sie für dich – sie fragt dann nach den Berechtigungen."
echo ""
open "$TARGET/Assistent.app"
