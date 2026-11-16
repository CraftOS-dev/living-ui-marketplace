// Runs every portfolio test in order (each starts from an empty scratch database on VO_PORT, default 3189).
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter((f) => /^t\d\d_.*\.mjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  console.log('\n=== ' + f);
  try {
    const out = execFileSync(process.execPath, [join(HERE, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
    const last = out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop() || '';
    console.log(last);
    const m = /(\d+) failed/.exec(last);
    if (!m || Number(m[1]) > 0) {
      failed++;
      console.log(out.split('\n').filter((l) => l.indexOf('FAIL') >= 0).join('\n'));
    }
  } catch (err) {
    failed++;
    console.log(String(err.stdout || '').split('\n').filter((l) => l.indexOf('FAIL') >= 0 || /passed, \d+ failed/.test(l)).join('\n'));
  }
}
console.log(failed === 0 ? '\nall portfolio tests passed' : '\n' + failed + ' test file(s) failed');
process.exitCode = failed === 0 ? 0 : 1;
