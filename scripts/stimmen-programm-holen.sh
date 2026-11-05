#!/bin/bash
# Lädt das freie Sprach-Programm sherpa-onnx (https://github.com/k2-fsa/sherpa-onnx, Apache-2.0)
# für Apple-Chips und Intel-Macs nach build/sherpa. Damit spricht der Assistent die Stimmen,
# die du in den Einstellungen aus dem Internet lädst – danach ganz ohne Internet.
# Wird für das fertige App-Paket gebraucht (scripts/mac-app-bauen.sh --paket).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/build/sherpa"
VERSION="${SHERPA_VERSION:-v1.13.6}"
FILE="sherpa-onnx-$VERSION-osx-universal2-shared.tar.bz2"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/$VERSION/$FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/lib"

echo "  Lade $FILE …"
curl -fsSL --retry 3 "$URL" -o "$TMP/$FILE"
echo "  SHA-256: $(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)"
tar -xjf "$TMP/$FILE" -C "$TMP"

BIN="$(find "$TMP" -type f -name sherpa-onnx-offline-tts | head -1)"
if [ -z "$BIN" ]; then
  echo "sherpa-onnx-offline-tts fehlt im Archiv. Inhalt:"
  find "$TMP" -maxdepth 3 | head -60
  exit 1
fi
SRC="$(cd "$(dirname "$BIN")/.." && pwd)"
cp "$BIN" "$OUT/bin/"
chmod 755 "$OUT/bin/sherpa-onnx-offline-tts"
# nur die Bibliotheken, die das Programm braucht (Symlinks bleiben erhalten)
find "$SRC/lib" -maxdepth 1 \( -name '*.dylib' \) -exec cp -a {} "$OUT/lib/" \;
for f in LICENSE LICENSE.txt; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$OUT/LICENSE-sherpa-onnx.txt"; done

echo "  Verknüpfte Bibliotheken:"
otool -L "$OUT/bin/sherpa-onnx-offline-tts" | sed 's/^/    /'
if ! otool -l "$OUT/bin/sherpa-onnx-offline-tts" | grep -A2 LC_RPATH | grep -Eq '@(loader|executable)_path/\.\./lib'; then
  echo "  Ergänze den Suchpfad @executable_path/../lib"
  install_name_tool -add_rpath @executable_path/../lib "$OUT/bin/sherpa-onnx-offline-tts"
fi
codesign --force --sign - --timestamp=none "$OUT/bin/sherpa-onnx-offline-tts" "$OUT"/lib/*.dylib 2>/dev/null || true
HELP="$("$OUT/bin/sherpa-onnx-offline-tts" --help 2>&1 || true)"
if grep -Eq 'dyld|Library not loaded|image not found' <<<"$HELP"; then
  echo "  Das Sprach-Programm startet nicht:"
  tail -20 <<<"$HELP"
  exit 1
fi
grep -q -- '--vits-length-scale' <<<"$HELP" || echo "::warning::sherpa-onnx kennt --vits-length-scale nicht – das Tempo der Internet-Stimmen bleibt gleich"
echo "  ✓ sherpa-onnx $VERSION liegt in $OUT ($(du -sh "$OUT" | cut -f1))"
