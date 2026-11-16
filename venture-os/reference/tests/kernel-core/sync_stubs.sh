#!/bin/bash
# Add the scratch-only test kit (stubs/: a fake module zz_test, stand-ins for
# kernel-records' deals, deal_people, files and lib_files.pathOf; its trigger
# zz_review) to a scratch copy of the app, then regenerate the catalog and the
# triggers there.
#   VO_APP=<scratch app dir> bash sync_stubs.sh
# Never run it on the delivered app folder.
HERE="$(cd "$(dirname "$0")" && pwd)"
STUBS="$HERE/stubs"
[ -d "$STUBS" ] || STUBS="$HERE/../stubs"
S="${VO_APP:-$HERE/../app}"
case "$S" in
  *agent_app/venture_os_10f02ad4*|*scratchpad/venture_os/venture_os_10f02ad4*) echo "refusing the delivered app folder; use a scratch copy" >&2; exit 2 ;;
esac
cp -r "$STUBS/pb/." "$S/pb/"
(cd "$S" && node tools/gen.mjs && node tools/gen_triggers.mjs) || exit 1
echo "stubs synced into $S"
