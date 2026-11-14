#!/usr/bin/env bash
# Build the Cloudflare Pages output (dist/) from public/ + the shared server handlers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${CF_TOOLS:-$ROOT}"   # the folder whose node_modules/.bin has esbuild ("npm install" puts it in this repo)
SITE="https://playlist-share.pages.dev"
rm -rf "$ROOT/dist" && mkdir -p "$ROOT/dist"
cp -r "$ROOT/public/." "$ROOT/dist/"
rm -f "$ROOT/dist/_redirects"
# point absolute URLs (link previews, privacy page) at the new address
grep -rl "https://playlist-share.netlify.app" "$ROOT/dist" --include=*.html --include=*.webmanifest | xargs -r sed -i "s#https://playlist-share.netlify.app#$SITE#g"
node "$ROOT/cf/gen-static.mjs" "$ROOT/dist" "$ROOT/cf/static.gen.mjs"
"$TOOLS/node_modules/.bin/esbuild" "$ROOT/cf/worker.mjs" --bundle --format=esm --platform=browser --target=es2022 \
  --alias:@netlify/blobs="$ROOT/cf/blobs-adapter.mjs" \
  --banner:js="globalThis.__SITE='$SITE';" \
  --outfile="$ROOT/dist/_worker.js" --log-level=warning
# only the worker is uploaded (static files are embedded in it)
mkdir -p "$ROOT/dist-cf" && rm -rf "$ROOT/dist-cf/"* && mv "$ROOT/dist/_worker.js" "$ROOT/dist-cf/_worker.js"
echo "built dist/ ($(du -sh "$ROOT/dist" | cut -f1)), worker $(wc -c < "$ROOT/dist-cf/_worker.js") bytes"
