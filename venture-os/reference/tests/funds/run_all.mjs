// Every funds test in order (each resets the scratch database): t01 to t05 backend, then the seed with
// the screen flows. VO_APP=<scratch app> VO_PORT=3190 VO_BRIDGE=3290 node run_all.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = ['t01_empty.mjs', 't02_capital.mjs', 't03_close.mjs', 't04_agent.mjs', 't05_fixes.mjs', 'seed_ui.mjs', 'flow_ui.mjs'];
let bad = 0;
for (const f of files) {
  try {
    const out = execFileSync(process.execPath, [join(HERE, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 });
    const last = out.trim().split('\n').filter((l) => /passed|seeded/.test(l)).pop() ?? 'done';
    console.log(f.padEnd(16), last.trim());
  } catch (err) {
    bad++;
    console.log(f.padEnd(16), 'FAILED');
    console.log(String(err.stdout ?? '').split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 12).join('\n'));
    console.log(String(err.stderr ?? '').split('\n').slice(0, 8).join('\n'));
  }
}
process.exitCode = bad > 0 ? 1 : 0;
