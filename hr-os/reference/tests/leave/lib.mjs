// Shared helpers for the leave builder's tests (reference/tests/leave/).
//
// Run on a SCRATCH copy of the app (never the delivered folder):
//   1. copy zz_leave_test.pb.js from this folder into <copy>/pb/pb_hooks/ (a test-only
//      route t02 and t03 use to call lib_leave.payInputs, balance and the cron; never ship it);
//      without the time module, also give the copy a lib_time.js with payInputs (t03 per-hours accrual).
//   2. HR_APP=<copy> HR_PORT=3184: bash <copy>/tools/dev/reset.sh <copy>; bash <copy>/tools/dev/serve.sh <copy> 3184
//   3. node t01_empty.mjs                      (empty database: before and after setup)
//   4. reset, serve, node <copy>/tools/dev/seed_demo.mjs --port 3184 --app <copy>
//      then node t02_flows.mjs and node t03_engine.mjs (in that order, same database)
//   5. reset, serve, seed_demo, then node t04_payroll_void.mjs and node t06_exit.mjs (same database)
//   6. reset, serve (empty), node t05_scale.mjs (300 then 1,000 people; about 30 minutes)
//   7. screenshots: reset, serve, seed_demo, node seed_leave.mjs, node shots.mjs seed
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APPDIR = process.env.HR_APP || 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/leave/app';
export const PORT = Number(process.env.HR_PORT || 3184);

const { client, DEMO } = await import('file:///' + join(APPDIR, 'tools/dev/api.mjs').replace(/\\/g, '/'));
export { DEMO };
export const api = client({ port: PORT, app: APPDIR });

let pass = 0;
let fail = 0;
const failures = [];
export function ok(cond, name, extra) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (extra !== undefined ? ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 400)) : ''));
    console.log('  FAIL ' + name + (extra !== undefined ? ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 400)) : ''));
  }
}
export function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b });
}
export function near(a, b, name, eps = 0.011) {
  ok(typeof a === 'number' && Math.abs(a - b) <= eps, name, { got: a, want: b });
}
export async function expectStatus(promise, status, name, code) {
  const r = await promise;
  ok(r.status === status && (code === undefined || (r.body && r.body.code === code)), name, { status: r.status, body: r.body });
  return r;
}
export function done(label) {
  console.log(`${label}: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(failures.map((f) => ' - ' + f).join('\n'));
    process.exitCode = 1;
  }
  return { pass, fail };
}
export function ops(prefix) {
  const m = JSON.parse(readFileSync(join(APPDIR, 'operations.json'), 'utf8'));
  return m.operations.filter((o) => o.name.startsWith(prefix));
}
export function section(t) {
  console.log('-- ' + t);
}
