#!/bin/bash
# Scratch server for HR OS builders (never a live port 3100-3179, never 3900+):
#   tools/dev/serve.sh <app dir> <port>
# Migrates <app dir>/pb/pb_data up, upserts a scratch superuser BEFORE serve
# (or PocketBase opens its installer in a browser), writes .agent-token when
# missing, serves 127.0.0.1:<port> with --hooksWatch=false in the background,
# waits for /api/health and prints the PID. Logs: <app dir>/logs/scratch_<port>.log
# Extra serve flags: PB_SERVE_FLAGS="--hooksPool=60" tools/dev/serve.sh ...
set -u
APP="${1:?usage: serve.sh <app dir> <port>}"
PORT="${2:?usage: serve.sh <app dir> <port>}"
if [ "$PORT" -ge 3100 ] && [ "$PORT" -le 3179 ]; then echo "refusing live port $PORT" >&2; exit 2; fi
if [ "$PORT" -ge 3900 ]; then echo "refusing shadow port $PORT" >&2; exit 2; fi
PB="${PB:-C:/Users/zfoong/.craftbot/bin/pocketbase-0.39.6.exe}"
[ -x "$PB" ] || PB="$(command -v pocketbase)"
[ -n "$PB" ] || { echo "no PocketBase binary (set PB=...)" >&2; exit 2; }
DIR="$(dirname "$0")"
bash "$DIR/stop.sh" "$PORT" >/dev/null 2>&1
mkdir -p "$APP/pb/pb_data" "$APP/pb/pb_public" "$APP/logs"
LOG="$APP/logs/scratch_$PORT.log"
"$PB" migrate up --dir "$APP/pb/pb_data" --migrationsDir "$APP/pb/pb_migrations" --hooksDir "$APP/pb/pb_hooks" > "$LOG" 2>&1
if grep -q -E "^\s*Error|RECOVERED FROM PANIC|^panic:" "$LOG"; then echo "migration failed:" >&2; tail -20 "$LOG" >&2; exit 1; fi
"$PB" superuser upsert "scratch@hr-os.local" "Scratch-$(node -e "process.stdout.write(require('crypto').randomBytes(12).toString('hex'))")" --dir "$APP/pb/pb_data" > /dev/null 2>&1
if [ ! -s "$APP/.agent-token" ]; then node -e "process.stdout.write(require('crypto').randomBytes(30).toString('base64url'))" > "$APP/.agent-token"; fi
("$PB" serve --http="127.0.0.1:$PORT" --dir "$APP/pb/pb_data" --hooksDir "$APP/pb/pb_hooks" --migrationsDir "$APP/pb/pb_migrations" --publicDir "$APP/pb/pb_public" --hooksWatch=false ${PB_SERVE_FLAGS:-} >> "$LOG" 2>&1 &)
for i in $(seq 1 80); do
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q 200; then break; fi
  sleep 0.25
done
if ! curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" | grep -q 200; then echo "server did not start:" >&2; tail -30 "$LOG" >&2; exit 1; fi
PID=""
if command -v netstat >/dev/null 2>&1 && [ "${OS:-}" = "Windows_NT" ]; then
  PID=$(netstat -ano | grep "127.0.0.1:$PORT " | grep LISTENING | awk '{print $5}' | head -1)
else
  PID=$(lsof -ti tcp:"$PORT" -s tcp:listen 2>/dev/null | head -1)
fi
grep -i -E "failed to execute|panic|\[hr\].*failed" "$LOG" | head -5
echo "HR OS up on http://127.0.0.1:$PORT (pid $PID, log $LOG)"
