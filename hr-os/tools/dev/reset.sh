#!/bin/bash
# Wipe the scratch database of an app copy (stop its server first): tools/dev/reset.sh <app dir>
APP="${1:?usage: reset.sh <app dir>}"
case "$APP" in
  *agent_app/hr_os_37878b99|*agent_app/hr_os_37878b99/) echo "refusing to wipe the delivered app folder; use a scratch copy" >&2; exit 2 ;;
esac
rm -rf "$APP/pb/pb_data" && echo "wiped $APP/pb/pb_data"
