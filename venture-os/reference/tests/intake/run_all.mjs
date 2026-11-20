// Run every intake test in order (each starts from a fresh scratch database).
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3185). t04 needs the built frontend
// (npm run build --prefix frontend) and playwright-core.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = ['t01_empty_sweep.mjs', 't02_flows.mjs', 't03_rules.mjs', 't04_ui.mjs'].filter((f) => process.argv.length <= 2 || process.argv.slice(2).some((a) => f.startsWith(a)));
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [join(HERE, f)], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const last = out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop() || '(no summary)';
  console.log(f.padEnd(20), last.trim(), r.status === 0 ? '' : '(exit ' + r.status + ')');
  if (r.status !== 0) {
    bad++;
    console.log(out.split('\n').filter((l) => /^\s*FAIL|Error:/.test(l)).slice(0, 12).join('\n'));
  }
}
process.exitCode = bad > 0 ? 1 : 0;
