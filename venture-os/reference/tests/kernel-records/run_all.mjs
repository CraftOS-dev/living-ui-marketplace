// Run every kernel-records test in order against the scratch copy (each resets the scratch database).
//   VO_APP=<scratch app dir> VO_PORT=3182 node run_all.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tests = ['t01_identity_merge.mjs', 't02_deals.mjs', 't03_files.mjs', 't04_theses.mjs', 't05_sweep.mjs'];
let failed = 0;
for (const t of tests) {
  try {
    const out = execFileSync('node', [join(here, t)], { encoding: 'utf8', stdio: 'pipe', timeout: 1800000 });
    console.log(out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop());
  } catch (err) {
    failed++;
    console.log(t + ' FAILED');
    console.log(String(err.stdout || '').split('\n').filter((l) => /FAIL|passed/.test(l)).join('\n'));
    console.log(String(err.stderr || '').slice(0, 2000));
  }
}
process.exitCode = failed > 0 ? 1 : 0;
