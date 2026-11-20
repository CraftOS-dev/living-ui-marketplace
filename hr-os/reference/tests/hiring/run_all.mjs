// Run every hiring test in order against the scratch copy (each resets the scratch database).
//   HR_APP=<scratch app dir> HR_PORT=3187 node run_all.mjs
// The scratch copy needs the scratch-only stubs (cat_test_hiring.js,
// lib_testhiring.js) and `node tools/gen.mjs`; ../sync.sh puts them in.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const tests = ['t01_empty_sweep.mjs', 't02_flow.mjs', 't03_access.mjs', 't04_edges.mjs', 't05_post_ui.mjs'];
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
