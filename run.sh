#!/usr/bin/env bash
# Run Planner on your Wi-Fi: build, then serve it so any phone on the same network can open it.
#   ./run.sh            build and start on port 3100
#   ./run.sh --sync     pull from Runalyze first
#   PORT=4000 ./run.sh  another port
# For use at home only: it is plain http, so the passphrase crosses the Wi-Fi unencrypted.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3100}"

[ -f .env.local ] || { echo "Missing .env.local: copy .env.example to .env.local and fill it in."; exit 1; }
[ -d node_modules ] || npm install
if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use (another copy running?). Stop it, or run: PORT=4000 ./run.sh"; exit 1
fi
[ "${1:-}" = "--sync" ] && npm run sync

npm run build

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo
echo "  On this computer:          http://localhost:$PORT"
[ -n "$IP" ] && echo "  On a phone on the Wi-Fi:   http://$IP:$PORT"
echo "  (If macOS asks whether node may accept incoming connections, allow it.)"
echo

# plain http on the local network: the login cookie can't be https-only here
COOKIE_INSECURE=1 exec npx next start -H 0.0.0.0 -p "$PORT"
