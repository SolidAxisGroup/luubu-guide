#!/usr/bin/env bash
# Minify the engine for the CDN. Run after editing src/guide.js.
set -e
cd "$(dirname "$0")/.."
npx -y terser src/guide.js -c -m --comments '/^!/' -o src/guide.min.js
echo "built src/guide.min.js ($(wc -c < src/guide.min.js) bytes)"
