// t05: leave at scale. One Singapore company grown to 300 and then 1,000 people
// through operations (setup.complete, people.hire), with approved and waiting leave,
// then the list reads and the daily run at each size, each timed three times.
// Run on an EMPTY scratch database (reset, serve), zz_leave_test.pb.js in pb_hooks:
//   T05_SIZES=300,1000 node t05_scale.mjs
import { readFileSync } from 'node:fs';
import { api, ok, done, section, DEMO } from './lib.mjs';

const O = { as: 'owner' };
const SIZES = (process.env.T05_SIZES || '300,1000').split(',').map(Number);
const tr = async (fn, body) => {
  const res = await fetch(api.base + '/api/leave-test/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', 'X-A2App-Token': readFileSync(api.app + '/.agent-token', 'utf8').trim() }, body: JSON.stringify(body || {}) });
  const j = await res.json();
  if (res.status !== 200) throw new Error(fn + ': ' + JSON.stringify(j));
  return j.out;
};
await api.op('setup.complete', { company_name: 'Scale Leave Co', entity_name: 'Scale Leave Pte Ltd', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const ent = (await api.op('entities.list', {}, O)).entities[0];
const depts = [];
for (const [n, c] of [['Engineering', 'ENG'], ['Sales', 'SAL'], ['Operations', 'OPS'], ['Finance', 'FIN'], ['People', 'PPL']]) depts.push((await api.op('departments.add', { name: n, code: c }, O)).department);
const today = (await api.op('auth.me', {}, O)).today;
const plus = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const hired = [];
const results = [];

async function grow(n) {
  const t0 = Date.now();
  while (hired.length < n) {
    const i = hired.length;
    const out = await api.op('people.hire', { entity: ent.id, legal_name: 'Person ' + String(i + 1).padStart(4, '0') + ' Scale', family_name: 'Scale', given_name: 'Person ' + (i + 1), name_order: 'given_first', start_day: i % 9 === 0 ? '2026-10-01' : '2023-0' + (1 + (i % 9)) + '-01', title: 'Staff', department: depts[i % 5].id }, O);
    hired.push(out.employment.id);
    // One in five has leave booked this month or next; one in ten has a request waiting.
    if (i % 5 === 1) await api.call('leave.request', { employment: out.employment.id, type: 'annual', start: plus(today, 1 + (i % 20)), end: plus(today, 2 + (i % 20)), record: true, reason: 'scale' }, O);
    if (i % 10 === 3) await api.call('leave.request', { employment: out.employment.id, type: 'annual', start: plus(today, 25 + (i % 10)), reason: 'scale' }, O);
  }
  console.log('  ' + n + ' people (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s to add)');
}

async function timed(name, fn) {
  const ms = [];
  let err = '';
  for (let k = 0; k < 3; k++) {
    const t = Date.now();
    try {
      await fn();
    } catch (e) {
      err = String(e && e.message ? e.message : e).slice(0, 200);
    }
    ms.push(Date.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { name, ms, err };
}

for (const n of SIZES) {
  section(n + ' people');
  await grow(n);
  const month = today.slice(0, 8) + '01';
  const reads = [
    ['leave.home', () => api.op('leave.home', {}, O)],
    ['leave.attention', () => api.op('leave.attention', {}, O)],
    ['leave.balances --limit 500', () => api.op('leave.balances', { entity: ent.id, limit: 500 }, O)],
    ['leave.calendar (month)', () => api.op('leave.calendar', { from: month }, O)],
    ['leave.out (week)', () => api.op('leave.out', { from: today, to: plus(today, 6) }, O)],
    ['leave.requests --status pending', () => api.op('leave.requests', { status: 'pending', limit: 200 }, O)],
    ['leave.mine (one person)', () => api.op('leave.mine', { employment: hired[1] }, O)],
    ['daily run + notices (forced)', () => tr('runEntity', { entity: ent.id, force: true })],
  ];
  for (const [name, fn] of reads) {
    const r = await timed(name, fn);
    results.push(Object.assign({ people: n }, r));
    console.log('  ' + name.padEnd(34) + r.ms.join(' / ') + ' ms' + (r.err ? '  ERROR ' + r.err : ''));
    ok(r.err === '', name + ' answers at ' + n + ' people', r.err);
  }
  const bal = await api.op('leave.balances', { entity: ent.id, limit: 500 }, O);
  ok(bal.rows.length === Math.min(500, n) && bal.total === n, 'balances list ' + bal.rows.length + ' of ' + bal.total);
  const cal = await api.op('leave.calendar', { from: month }, O);
  ok(cal.rows.length === n, 'the wallchart has a row per person (' + cal.rows.length + ')');
  const run = await tr('runEntity', { entity: ent.id, force: true });
  ok(run.errors === 0, 'the daily run has no errors (' + run.employments + ' employments, ' + run.ms + ' ms)', run);
}
console.log(JSON.stringify(results.map((r) => ({ people: r.people, read: r.name, median_ms: r.ms[1], max_ms: r.ms[2] }))));
done('t05 scale');
