// Run every markets test in order (each resets the scratch database). Env as lib.mjs.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = ['t01_empty_sweep.mjs', 't02_radar_flow.mjs', 't03_maps.mjs', 't04_sources.mjs'];
let failed = 0;
for (const f of files) {
  try {
    const out = execFileSync('node', [join(HERE, f)], { stdio: 'pipe', env: process.env, maxBuffer: 64 * 1024 * 1024 }).toString();
    console.log(out.split('\n').filter((l) => /passed|FAIL/.test(l)).join('\n'));
  } catch (err) {
    failed++;
    console.log(String(err.stdout || '').split('\n').filter((l) => /passed|FAIL|Error/.test(l)).join('\n'));
    console.log(String(err.stderr || '').slice(0, 2000));
  }
}
console.log(failed === 0 ? '\nall markets tests passed' : '\n' + failed + ' test file(s) failed');
process.exit(failed > 0 ? 1 : 0);
