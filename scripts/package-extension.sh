#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT_DIR="$ROOT/dist"
OUT="$OUT_DIR/AuraSolve-extension.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT"

cd "$ROOT"
zip -qr "$OUT" manifest.json icons src \
  -x "*.DS_Store" "*/.DS_Store"

printf 'Created %s\n' "$OUT"
