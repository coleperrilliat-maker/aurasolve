#!/usr/bin/env sh
set -eu

# Builds the store zip from minified bundles. Server-only code (prompts, answer
# formats, model routing) lives in server/ and is never copied into the zip.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT_DIR="$ROOT/dist"
BUILD="$OUT_DIR/extension"
OUT="$OUT_DIR/AuraSolve-extension.zip"
ESBUILD="npx --yes esbuild@0.25.0"
FLAGS="--minify --legal-comments=none --target=chrome120 --log-level=warning"

cd "$ROOT"
rm -rf "$BUILD" "$OUT"
mkdir -p "$BUILD/src/background" "$BUILD/src/content" "$BUILD/src/popup" "$BUILD/src/options" "$BUILD/src/vendor/katex"

cp manifest.json "$BUILD/"
cp -R icons "$BUILD/"
cp src/popup/popup.html src/popup/mini.html src/popup/pilot.html "$BUILD/src/popup/"
cp src/options/index.html "$BUILD/src/options/"
cp -R src/vendor/katex/fonts src/vendor/katex/LICENSE "$BUILD/src/vendor/katex/"

$ESBUILD src/background/worker.js --bundle --format=esm $FLAGS --outfile="$BUILD/src/background/worker.js"
$ESBUILD src/content/app.js --bundle --format=esm $FLAGS --outfile="$BUILD/src/content/app.js"
$ESBUILD src/popup/popup.js --bundle --format=esm $FLAGS --outfile="$BUILD/src/popup/popup.js"
$ESBUILD src/popup/mini.js --bundle --format=esm $FLAGS --outfile="$BUILD/src/popup/mini.js"
$ESBUILD src/popup/pilot.js --bundle --format=esm $FLAGS --outfile="$BUILD/src/popup/pilot.js"
$ESBUILD src/options/options.js --bundle --format=esm $FLAGS --outfile="$BUILD/src/options/options.js"
$ESBUILD src/content/bootstrap.js $FLAGS --outfile="$BUILD/src/content/bootstrap.js"
$ESBUILD src/content/region-pick.js $FLAGS --outfile="$BUILD/src/content/region-pick.js"
$ESBUILD src/popup/popup.css $FLAGS --loader:.css=css --outfile="$BUILD/src/popup/popup.css"
$ESBUILD src/popup/mini.css $FLAGS --loader:.css=css --outfile="$BUILD/src/popup/mini.css"
$ESBUILD src/options/options.css $FLAGS --loader:.css=css --outfile="$BUILD/src/options/options.css"
cp src/vendor/katex/katex.min.css "$BUILD/src/vendor/katex/"

if grep -rqE "sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY|INSTALL_SECRET|TUTOR_INSTRUCTIONS" "$BUILD"; then
  echo "Refusing to package: server-only text found in the extension build." >&2
  exit 1
fi

(cd "$BUILD" && zip -qr "$OUT" . -x "*.DS_Store")
printf 'Created %s\n' "$OUT"
