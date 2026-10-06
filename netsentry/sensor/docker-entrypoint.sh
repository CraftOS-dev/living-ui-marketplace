#!/bin/sh
# NetSentry monitor (container): enrol once with a join token, then run.
#   NETSENTRY_CONSOLE  https address of NetSentry (or http://127.0.0.1:<port> on the same machine)
#   NETSENTRY_JOIN     a join token from NetSentry (only needed the first time; swapped for this
#                      machine's own credential, kept in /state, and not used again)
#   NETSENTRY_NAME     a name for this machine (default: its hostname)
#   NETSENTRY_EXECUTOR on = allow NetSentry to make changes here when a person confirms them
set -eu
: "${NETSENTRY_CONSOLE:?Set NETSENTRY_CONSOLE to NetSentry's address}"
STATE=/state
if [ ! -s "$STATE/token" ]; then
  : "${NETSENTRY_JOIN:?Set NETSENTRY_JOIN to a join token from NetSentry (first start only)}"
  python -m netsentry_sensor enrol --console "$NETSENTRY_CONSOLE" --join "$NETSENTRY_JOIN" --name "${NETSENTRY_NAME:-$(cat /host/proc/sys/kernel/hostname 2>/dev/null || hostname)}" --state-dir "$STATE"
fi
exec python -m netsentry_sensor run --console "$NETSENTRY_CONSOLE" --state-dir "$STATE"
