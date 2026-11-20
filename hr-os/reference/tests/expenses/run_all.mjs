// Run every expenses API test in order against the scratch copy (each resets the scratch database).
//   HR_APP=<scratch app dir> HR_PORT=3185 node run_all.mjs
// The scratch copy needs the scratch-only test ops (stubs/pb/pb_hooks/cat_testexp_core.js and
// lib_testexp.js, never shipped) and `node tools/gen.mjs`. Screens: t05_screens.mjs after seeding.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const tests = ['t01_empty.mjs', 't02_claims.mjs', 't03_advances_travel.mjs', 't04_agent_perms.mjs'];
let failed = 0;
for (const t of tests) {
  try {
    const out = execFileSync('node', [join(here, t)], { encoding: 'utf8', stdio: 'pipe', timeout: 900000 });
    console.log(out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop());
  } catch (err) {
    failed++;
    console.log(t + ' FAILED');
    console.log(String(err.stdout || '').split('\n').filter((l) => /FAIL|passed/.test(l)).join('\n'));
    console.log(String(err.stderr || '').slice(0, 2000));
  }
}
process.exitCode = failed > 0 ? 1 : 0;
