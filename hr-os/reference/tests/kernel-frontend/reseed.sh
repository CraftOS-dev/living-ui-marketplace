#!/bin/bash
# Fresh demo database on the kernel-frontend scratch server (port 3182).
K="$(cd "$(dirname "$0")/.." && pwd)/app"
bash "$K/tools/dev/stop.sh" 3182 >/dev/null 2>&1
bash "$K/tools/dev/reset.sh" "$K" >/dev/null
bash "$K/tools/dev/serve.sh" "$K" 3182 | tail -1
[ "${1:-}" = "empty" ] || node "$K/tools/dev/seed_demo.mjs" --port 3182 --app "$K" | tail -1
# "hiring": the demo seed plus hiring's own seed from HIRING_TESTS (default ../hiring_tests, a copy of APP/reference/tests/hiring without its test-only backdate step, so its fixtures stay in this scratch folder).
[ "${1:-}" = "hiring" ] && HR_APP="$K" HR_PORT=3182 node "${HIRING_TESTS:-$(dirname "$0")/../hiring_tests}/seed_hiring.mjs" | tail -1
exit 0
