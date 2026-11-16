#!/bin/bash
# kernel-frontend tests on a scratch copy (default: this builder's scratch app on port 3183).
# APP=<app dir> PORT=<port> bash run_all.sh
# Starts from an EMPTY database: setup.mjs (the four steps), then seed.mjs, the screenshot pass, the
# flows (they consume the Next items), a reseed, the theme audit (16 packs x 2 modes) and the UX audit.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
export APP="${APP:-C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/790747a9-d304-46c5-bb28-509598fb5d81/scratchpad/venture_os/kernel-frontend/app}"
export PORT="${PORT:-3183}"
npm run build --prefix "$APP/frontend" > /dev/null
bash "$APP/tools/dev/stop.sh" "$PORT" > /dev/null 2>&1 || true
rm -rf "$APP/pb/pb_data"
bash "$APP/tools/dev/serve.sh" "$APP" "$PORT"
node "$HERE/setup.mjs"
node "$HERE/seed.mjs"
node "$HERE/shots.mjs"
node "$HERE/flows.mjs"
node "$HERE/seed.mjs"
node "$HERE/audit.mjs"
node "$HERE/ux_audit.mjs"
echo "all kernel-frontend tests passed"
