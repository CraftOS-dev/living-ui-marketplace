// Run every kernel-core test in order against the scratch copy (each test
// resets the scratch database and starts it with the mock bridge).
//   VO_APP=<scratch app dir> VO_PORT=3181 VO_BRIDGE=3281 node run_all.mjs
// The scratch copy needs the scratch-only test kit first: bash sync_stubs.sh
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tests = ['t01_empty_sweep.mjs', 't02_auth.mjs', 't03_proposals_scope.mjs', 't04_triggers.mjs', 't05_next_outbound.mjs', 't06_imports_activity.mjs', 't07_firm_fx_misc.mjs'];
let failed = 0;
let total = 0;
for (const t of tests) {
  try {
    const out = execFileSync('node', [join(here, t)], { encoding: 'utf8', stdio: 'pipe', timeout: 1200000 });
    const last = out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop();
    const m = /(\d+) passed/.exec(last || '');
    if (m) total += Number(m[1]);
    console.log(last);
  } catch (err) {
    failed++;
    console.log(t + ' FAILED');
    console.log(String(err.stdout || '').split('\n').filter((l) => /FAIL|passed/.test(l)).join('\n'));
    console.log(String(err.stderr || '').slice(0, 2000));
  }
}
console.log('\n' + tests.length + ' files, ' + total + ' checks passed' + (failed > 0 ? ', ' + failed + ' file(s) failed' : ', none failed'));
process.exitCode = failed > 0 ? 1 : 0;
