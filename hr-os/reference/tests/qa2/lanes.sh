#!/bin/bash
# QA2: run the modules' own API test suites on scratch suite copies (never APP).
#   bash lanes.sh A   (port 3191, qa2/suiteA): kernel-backend, expenses, hiring, performance, lifecycle, home-reports
#   bash lanes.sh B   (port 3192, qa2/suiteB): leave, payroll-core, payroll-out, time
# Browser-only files (screenshots, UI passes) are left to UI QA. Scale files run separately (lanes.sh S).
set -u
Q="C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/qa2"
R="$Q/results/suites"
mkdir -p "$R"
lane="${1:?A, B or S}"
if [ "$lane" = "A" ] || [ "$lane" = "S" ]; then export HR_APP="$Q/suiteA" HR_PORT=3191; else export HR_APP="$Q/suiteB" HR_PORT=3192; fi
T="$HR_APP/reference/tests"
run() { # run <module> <file> [env...]
  local mod="$1" f="$2"; shift 2
  local log="$R/${mod}_${f%.mjs}.log"
  local s=$(date +%s)
  (cd "$T/$mod" && env "$@" node "$f" > "$log" 2>&1)
  local rc=$?
  local last=$(grep -E "passed, [0-9]+ failed|[0-9]+ passed|passed|all .* pass" "$log" | tail -1)
  echo "$mod/$f rc=$rc $(( $(date +%s) - s ))s :: $last" | tee -a "$R/summary_$lane.txt"
}
reset_serve() { bash "$HR_APP/tools/dev/stop.sh" "$HR_PORT" > /dev/null 2>&1; bash "$HR_APP/tools/dev/reset.sh" "$HR_APP" > /dev/null; bash "$HR_APP/tools/dev/serve.sh" "$HR_APP" "$HR_PORT" > /dev/null; }
seed() { node "$HR_APP/tools/dev/seed_demo.mjs" --port "$HR_PORT" --app "$HR_APP" > /dev/null 2>&1; }
: > "$R/summary_$lane.txt"
if [ "$lane" = "A" ]; then
  for f in t01_empty_sweep.mjs t02_auth.mjs t03_scope_dating.mjs t04_sealed_agent.mjs t05_flows_jobs_csv.mjs t06_profile_photo.mjs t07_kiosk.mjs t08_agent_cli.mjs t09_facts_pin.mjs; do run kernel-backend $f; done
  for f in t01_empty.mjs t02_claims.mjs t03_advances_travel.mjs t04_agent_perms.mjs; do run expenses $f; done
  for f in t01_empty_sweep.mjs t02_flow.mjs t03_access.mjs t04_edges.mjs; do run hiring $f; done
  for f in i18n_check.mjs t01_empty.mjs t02_goals.mjs t03_reviews.mjs t04_feedback_skills_training.mjs t05_contracts.mjs; do run performance $f; done
  for f in t01_empty.mjs t02_flows.mjs; do run lifecycle $f; done
  run home-reports t01_empty.mjs
  run home-reports seed_reports.mjs
  run home-reports t02_seeded.mjs
elif [ "$lane" = "B" ]; then
  reset_serve; run leave t01_empty.mjs
  reset_serve; seed; run leave t02_flows.mjs; run leave t03_engine.mjs
  reset_serve; seed; run leave t04_payroll_void.mjs; run leave t06_exit.mjs
  for f in t01_sweep.mjs t02_countries.mjs t03_flows.mjs t05_bonus_history.mjs; do run payroll-core $f; done
  run payroll-out t01_empty.mjs
  run payroll-out t02_flows.mjs
  run payroll-out t03_permissions.mjs NO_FRESH=1
  for f in t01_empty_sweep.mjs t02_flows.mjs t03_permissions.mjs; do run time $f; done
elif [ "$lane" = "S" ]; then
  run payroll-core t04_scale.mjs
  run home-reports t03_scale.mjs
  reset_serve; run leave t05_scale.mjs T05_SIZES=300
fi
echo "lane $lane done"
