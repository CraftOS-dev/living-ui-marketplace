// The home builder's tests, in order. Env: VO_APP (scratch app), VO_PORT (3192), VO_BRIDGE (port + 100).
//   node run_all.mjs            seeded firm (seed_demo), its screens and Focus walk, then the empty firm,
//                               its screens, then 5,000 deals and the timing
//   node run_all.mjs --no-seed  skip seeding (the demo firm is already loaded)
// Build the frontend first (npm run build --prefix <app>/frontend).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDemo } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const run = (f, ...a) => {
  try {
    execFileSync(process.execPath, [join(HERE, f), ...a], { stdio: 'inherit', env: process.env });
    return true;
  } catch {
    return false;
  }
};
const results = {};
if (!process.argv.includes('--no-seed')) seedDemo();
results.t02_seeded = run('t02_seeded.mjs');
results.ui_shots = run('ui_shots.mjs');
results.focus_walk = run('focus_walk.mjs');
results.t01_empty = run('t01_empty.mjs');
results.ui_shots_empty = run('ui_shots.mjs', '--empty');
results.t03_perf = run('t03_perf.mjs');
console.log('\n' + Object.entries(results).map(([k, v]) => `${v ? 'PASS' : 'FAIL'} ${k}`).join('\n'));
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
