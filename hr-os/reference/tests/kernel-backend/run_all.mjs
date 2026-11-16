// Run every kernel test in order against the scratch copy (each test resets the scratch database).
//   HR_APP=<scratch app dir> HR_PORT=3181 node run_all.mjs
// The scratch copy needs the scratch-only test kit (stubs/: events_test.js,
// lib_testkit.js, cat_test_core.js, cron_test.js, the rule_packs stub
// migration and country stubs where APP has none) and `node tools/gen.mjs`.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const tests = ['t01_empty_sweep.mjs', 't02_auth.mjs', 't03_scope_dating.mjs', 't04_sealed_agent.mjs', 't05_flows_jobs_csv.mjs', 't06_profile_photo.mjs', 't07_kiosk.mjs', 't08_agent_cli.mjs', 't09_facts_pin.mjs', 't10_handover.mjs', 't11_pay_update.mjs'];
let failed = 0;
for (const t of tests) {
  try {
    const out = execFileSync('node', [join(here, t)], { encoding: 'utf8', stdio: 'pipe', timeout: 2400000 });
    const last = out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop();
    console.log(last);
  } catch (err) {
    failed++;
    console.log(t + ' FAILED');
    console.log(String(err.stdout || '').split('\n').filter((l) => /FAIL|passed/.test(l)).join('\n'));
    console.log(String(err.stderr || '').slice(0, 2000));
  }
}
process.exitCode = failed > 0 ? 1 : 0;
