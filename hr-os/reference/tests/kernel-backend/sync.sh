#!/bin/bash
# Refresh the scratch copy SCR/kernel-backend/app from APP (code only; the
# scratch pb_data, .agent-token and frontend/node_modules stay), then add the
# scratch-only stubs (country files) where APP has none. Never copies back.
K="C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-backend"
A="C:/Users/zfoong/Desktop/agent/code/git/CraftBot/agent_file_system/workspace/agent_app/hr_os_37878b99"
S="$K/app"
mkdir -p "$S"
for d in pb/pb_hooks pb/pb_migrations tools; do rm -rf "$S/$d"; mkdir -p "$(dirname "$S/$d")"; cp -r "$A/$d" "$S/$d"; done
for f in manifest.json operations.json triggers.json AGENT_APP.md; do [ -f "$A/$f" ] && cp "$A/$f" "$S/$f"; done
if [ ! -d "$S/frontend" ]; then cp -r "$A/frontend" "$S/frontend"; else rm -rf "$S/frontend/src"; cp -r "$A/frontend/src" "$S/frontend/src"; cp "$A/frontend/package.json" "$S/frontend/package.json"; fi
mkdir -p "$S/.agent-app"; cp -r "$A/.agent-app/." "$S/.agent-app/"
for f in $(cd "$K/stubs" && find . -type f); do [ -f "$A/$f" ] || { mkdir -p "$(dirname "$S/$f")"; cp "$K/stubs/$f" "$S/$f"; }; done
(cd "$S" && node tools/gen.mjs > /dev/null) || exit 1
echo "synced $S"
