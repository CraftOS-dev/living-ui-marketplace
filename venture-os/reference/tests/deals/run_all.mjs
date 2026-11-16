// Run every deals module test in order: node run_all.mjs (scratch app on VO_PORT, default 3186).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const lines = [];
const unit = (() => {
  try {
    return execFileSync(process.execPath, ['--test', join(HERE, 't00_funnel.test.mjs')], { encoding: 'utf8' });
  } catch (err) {
    failed++;
    return String(err.stdout || err);
  }
})();
lines.push('t00_funnel: ' + (/# pass (\d+)/.exec(unit)?.[1] ?? /pass (\d+)/.exec(unit)?.[1] ?? '?') + ' passed, ' + (/fail (\d+)/.exec(unit)?.[1] ?? '?') + ' failed');
for (const f of ['t01_empty.mjs', 't02_notes.mjs', 't03_flow.mjs']) {
  let out = '';
  try {
    out = execFileSync(process.execPath, [join(HERE, f)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    out = String(err.stdout || '') + String(err.stderr || err);
    failed++;
  }
  const m = /(\w+): (\d+) passed, (\d+) failed/.exec(out);
  if (m && Number(m[3]) > 0) failed++;
  lines.push(m ? m[0] : f + ': did not finish\n' + out.slice(-2000));
}
console.log(lines.join('\n'));
process.exit(failed > 0 ? 1 : 0);
