#!/bin/sh
set -e
DIR="${1:-$HOME/Projects/aurasolve}"
git -C "$DIR" pull origin main
echo "Done. Reload AuraSolve at chrome://extensions"
