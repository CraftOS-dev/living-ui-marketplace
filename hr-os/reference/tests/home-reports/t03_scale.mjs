// Scale: 300 people in one Singapore entity made only through operations (the QA scale seed of
// reference/tests/qa/t04_scale.mjs: setup, five departments, people.hire with managers, members),
// plus leavers and recorded leave, then every home and report read timed three times (the first
// call of each warms the server's script runtime and is not counted). Fails when the median of
// the timed calls is 2 s or more.
//   node t03_scale.mjs            (HR_PORT 3190, HR_APP as lib.mjs; QA_N for another size)
import { DEMO, fresh, newApi, ok, OWNER, PIN, section, summary } from './lib.mjs';

const api = newApi();
const N = Number(process.env.QA_N || 300);
fresh();
const t0 = Date.now();
await api.op('setup.complete', { company_name: 'Scale Co', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const ent = (await api.op('entities.list', {}, OWNER)).entities[0];
const loc = (await api.op('locations.add', { entity: ent.id, name: 'HQ', lat: 1.284, lng: 103.851, radius_m: 150 }, OWNER)).location;
const depts = [];
for (const [n, c] of [['Engineering', 'ENG'], ['Sales', 'SAL'], ['Operations', 'OPS'], ['Finance', 'FIN'], ['People', 'PPL']]) depts.push((await api.op('departments.add', { name: n, code: c }, OWNER)).department);
const hired = [];
for (let i = 0; i < N; i++) {
  const mgr = i < 10 ? (i === 0 ? '' : hired[0].employee.id) : hired[i % 10].employee.id;
  hired.push(
    await api.op(
      'people.hire',
      {
        entity: ent.id, legal_name: 'Person ' + String(i + 1).padStart(3, '0') + ' Scale', family_name: 'Scale', given_name: 'Person ' + (i + 1), name_order: 'given_first',
        birth_date: String(1970 + (i % 35)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9), gender: i % 2 ? 'female' : 'male', nationality: 'SG', start_day: i % 7 === 0 ? '2026-11-01' : '2024-0' + (1 + (i % 9)) + '-01',
        title: 'Staff', department: depts[i % 5].id, location: loc.id, manager: mgr, pay_basis: 'salary', pay_amount: String(3000 + ((i * 37) % 12000)) + '.00', pay_per: 'month',
        tax_fields: { sg_residency: 'sc', sg_shg: i % 4 === 0 ? 'cdac' : 'none' }, work_email: 'p' + i + '@scale.test',
      },
      OWNER,
    ),
  );
}
console.log('seeded ' + N + ' people in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
async function member(email, name, role, employee) {
  const inv = await api.op('members.invite', Object.assign({ email, name, role }, employee ? { employee } : {}), PIN);
  await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
}
await member('hr@scale.test', 'Hana HR', 'hr_admin');
await member('mgr@scale.test', 'Mia Manager', 'manager', hired[1].employee.id);
await member('emp@scale.test', 'Eli Employee', 'employee', hired[42].employee.id);
const HR = { as: 'hr@scale.test' };
// Ten leavers this year, and recorded leave for sixty people last month.
for (let i = 0; i < 10; i++) await api.call('employments.end', { employment: hired[20 + i * 7].employment.id, end_day: '2026-0' + (1 + i % 9) + '-28', reason: 'Scale leaver' }, OWNER);
const types = (await api.op('leave.types', { entity: ent.id }, OWNER)).types || [];
const annual = types.find((t) => t.code === 'annual') || types[0];
let recorded = 0;
for (let i = 0; i < 60; i++) {
  const d = '2026-10-' + String(5 + (i % 20)).padStart(2, '0');
  const r = await api.call('leave.request', { employment: hired[100 + i].employment.id, type: annual.code, start: d, end: d, record: true, reason: 'scale' }, HR);
  if (r.status === 200) recorded++;
}
console.log('recorded leave: ' + recorded + ' of 60; total seed ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

section('reads at ' + N + ' people (median of three warm calls, ms)');
const READS = [
  ['home.admin', {}, OWNER],
  ['home.manager', {}, { as: 'mgr@scale.test' }],
  ['home.me', {}, { as: 'emp@scale.test' }],
  ['home.directory', {}, { as: 'emp@scale.test' }],
  ['reports.list', {}, OWNER],
  ['reports.headcount', {}, OWNER],
  ['reports.headcount', { group_by: 'department' }, OWNER],
  ['reports.movement', {}, OWNER],
  ['reports.tenure', {}, OWNER],
  ['reports.span', {}, OWNER],
  ['reports.diversity', { dimension: 'gender' }, OWNER],
  ['reports.diversity', { dimension: 'age' }, OWNER],
  ['reports.diversity', { dimension: 'nationality' }, OWNER],
  ['reports.comp-bands', {}, OWNER],
  ['reports.cost', {}, OWNER],
  ['reports.leave-liability', {}, OWNER],
  ['reports.leave-liability', { basis: 'paid' }, OWNER],
  ['reports.absence', {}, OWNER],
  ['reports.hiring', {}, OWNER],
  ['reports.training', {}, OWNER],
  ['reports.export', { report: 'absence' }, OWNER],
  ['reports.export', { report: 'leave-liability', basis: 'paid' }, OWNER],
];
const out = [];
// First reads after the seed: the company figures the warm-up job keeps are counted here (cold).
for (const [name, params] of [['reports.absence', {}], ['reports.leave-liability', {}]]) {
  const t = Date.now();
  await api.op(name, params, OWNER);
  console.log('cold ' + name + ': ' + (Date.now() - t) + ' ms (counted once, then kept)');
}
for (const [name, params, who] of READS) {
  await api.call(name, params, who);
  const ms = [];
  let status = 0;
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    const r = await api.call(name, params, who);
    ms.push(Date.now() - t);
    status = r.status;
  }
  ms.sort((a, b) => a - b);
  out.push({ name, params, ms });
  ok(status === 200 && ms[1] < 2000, `${name} ${JSON.stringify(params)}: ${ms.join(' / ')} ms`, status !== 200 ? status : undefined);
}
const ab = await api.op('reports.absence', {}, OWNER);
ok(ab.table.rows.length >= N - 50 && ab.readouts.leave_days >= recorded, 'absence covers everyone and the recorded leave', { rows: ab.table.rows.length, leave: ab.readouts.leave_days });
const mv = await api.op('reports.movement', {}, OWNER);
ok(mv.readouts.left === 10, 'ten leavers', mv.readouts);
console.log(JSON.stringify(out));
const s = summary('t03_scale');
process.exit(s.failed === 0 ? 0 : 1);
