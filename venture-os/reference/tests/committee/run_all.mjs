// Run every committee test in order (each API test resets the scratch database first).
// VO_APP=<scratch app> VO_PORT=3188 VO_BRIDGE=3288 node run_all.mjs
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let bad = 0;
const unit = spawnSync(process.execPath, ['--test', join(HERE, 't05_rules.test.mjs')], { stdio: 'inherit', env: process.env });
if (unit.status !== 0) bad++;
for (const f of ['t01_empty_sweep.mjs', 't02_memos.mjs', 't03_meetings_votes.mjs', 't04_decisions_conditions.mjs', 't06_nda_quotes.mjs']) {
  const r = spawnSync(process.execPath, [join(HERE, f)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) bad++;
}
console.log(bad === 0 ? '\nall committee tests passed' : '\n' + bad + ' committee test file(s) failed');
process.exit(bad === 0 ? 0 : 1);
