#!/usr/bin/env bash
# Build and publish Playlist Share to Cloudflare Pages (https://playlist-share.pages.dev).
# Uses the Pages API directly (worker-only upload; static files are embedded in the worker).
# Needs: CF_TOOLS (folder with node_modules/.bin/esbuild) and Cloudflare API access (token injected by the proxy).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACCOUNT=058330dfa7634a8b9f33a5764aca57a5
"$ROOT/cf/build.sh"
curl -sS -m 180 -X POST -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:-proxy-injected}" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects/playlist-share/deployments" \
  -F "manifest={}" -F "branch=main" -F "commit_message=${1:-update}" \
  -F "_worker.js=@$ROOT/dist-cf/_worker.js;type=application/javascript" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('deployed' if d.get('success') else 'FAILED', d.get('errors') or '')"
