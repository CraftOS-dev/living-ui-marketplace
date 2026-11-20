// Run every network test in order (each resets the scratch database).
//   VO_APP=<scratch app> VO_PORT=3184 node run_all.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => /^t\d\d_.*\.mjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  console.log('\n=== ' + f);
  try {
    const out = execFileSync(process.execPath, [join(here, f)], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
    const last = out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop();
    console.log(last || out.slice(-400));
    for (const l of out.split('\n')) if (l.indexOf('  FAIL') === 0) console.log(l.slice(0, 300));
  } catch (err) {
    failed++;
    console.log(String(err.stdout || '').split('\n').filter((l) => l.indexOf('FAIL') >= 0 || /passed, \d+ failed/.test(l)).join('\n'));
    console.log(String(err.stderr || err.message).slice(0, 800));
  }
}
console.log(failed === 0 ? '\nall test files passed' : '\n' + failed + ' test file(s) failed');
process.exitCode = failed > 0 ? 1 : 0;
