#!/bin/bash
# Stop the scratch server (or mock bridge) listening on a port: tools/dev/stop.sh <port>
PORT="${1:?usage: stop.sh <port>}"
if [ "$PORT" -ge 3100 ] && [ "$PORT" -le 3179 ]; then echo "refusing live port $PORT" >&2; exit 2; fi
if [ "$PORT" -ge 3900 ]; then echo "refusing shadow port $PORT" >&2; exit 2; fi
if [ "${OS:-}" = "Windows_NT" ]; then
  for p in $(netstat -ano | grep "127.0.0.1:$PORT " | grep LISTENING | awk '{print $5}' | sort -u); do taskkill //F //PID "$p" > /dev/null 2>&1 && echo "stopped pid $p"; done
else
  for p in $(lsof -ti tcp:"$PORT" -s tcp:listen 2>/dev/null); do kill "$p" && echo "stopped pid $p"; done
fi
sleep 0.5
