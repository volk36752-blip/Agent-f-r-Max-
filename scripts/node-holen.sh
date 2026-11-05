#!/bin/bash
# Lädt Node.js (LTS-Linie 22) für Apple-Chips und Intel-Macs nach build/node.
# Wird für das fertige App-Paket gebraucht (scripts/mac-app-bauen.sh --paket).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/build/node"
LINE="${NODE_LINE:-latest-v22.x}"
BASE="https://nodejs.org/dist/$LINE"

rm -rf "$OUT"
mkdir -p "$OUT"
cd "$OUT"
curl -fsSL --retry 3 "$BASE/SHASUMS256.txt" -o SHASUMS256.txt
for arch in arm64 x64; do
  file="$(grep -Eo "node-v[0-9.]+-darwin-$arch\.tar\.gz" SHASUMS256.txt | head -1)"
  [ -n "$file" ] || { echo "Keine Node.js-Datei für $arch gefunden"; exit 1; }
  echo "  Lade $file …"
  curl -fsSL --retry 3 "$BASE/$file" -o "$file"
  grep " $file\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null
  tar -xzf "$file"
  cp "${file%.tar.gz}/bin/node" "node-$arch"
  cp "${file%.tar.gz}/LICENSE" LICENSE
  rm -rf "$file" "${file%.tar.gz}"
done
rm -f SHASUMS256.txt
chmod +x node-arm64 node-x64
echo "  Node.js $(grep -Eo 'v[0-9]+\.[0-9]+\.[0-9]+' <<<"$file" | head -1) liegt in $OUT"
