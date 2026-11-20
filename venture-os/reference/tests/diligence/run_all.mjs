// Run every diligence test file in order (each resets the scratch database). Env: VO_APP, VO_PORT, VO_BRIDGE.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => /^t\d\d_.*\.mjs$/.test(f)).sort();
let passed = 0;
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [join(here, f)], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /: (\d+) passed, (\d+) failed/.exec(out);
  const p = m ? Number(m[1]) : 0;
  const x = m ? Number(m[2]) : 1;
  passed += p;
  failed += x;
  console.log(f + ': ' + p + ' passed, ' + x + ' failed' + (r.status !== 0 && !m ? ' (crashed)' : ''));
  if (x > 0 || !m) console.log(out.split('\n').filter((l) => l.indexOf('FAIL') >= 0 || l.indexOf('Error') >= 0).slice(0, 20).join('\n'));
}
console.log('\nall: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
