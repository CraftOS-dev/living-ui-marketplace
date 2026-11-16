// Run every performance test in order (each resets the scratch database): node run_all.mjs
// Env as lib.mjs (HR_APP, HR_PORT). The scratch copy needs the test-only ops of
// stubs/pb/pb_hooks (cat_perftest_core.js, lib_perftest.js) for t03 and t05.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of ['i18n_check.mjs', 't01_empty.mjs', 't02_goals.mjs', 't03_reviews.mjs', 't04_feedback_skills_training.mjs', 't05_contracts.mjs']) {
  try {
    const out = execFileSync('node', [join(here, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 });
    console.log(out.trim().split('\n').pop());
  } catch (err) {
    failed++;
    console.log(String(err.stdout || '').split('\n').filter((l) => /FAIL|failed|problem|missing/.test(l)).join('\n') || f + ' failed: ' + err.message);
  }
}
console.log(failed === 0 ? 'all performance tests passed' : failed + ' test file(s) failed');
process.exitCode = failed === 0 ? 0 : 1;
