// QA t04: scale. 300 employees in one Singapore entity, made only through
// operations (setup.complete, departments, people.hire with managers, members),
// 60 pending leave requests in the Inbox, then a November pay run: calculate
// time, and the main list reads at that size (directory, payslips, leave
// calendar, attendance board, Inbox, Home), each timed three times.
//
//   QA_APP=<qa/app> QA_PORT=3191 node t04_scale.mjs
import { newApi, section, ok, summary, writeResult, freshServer, makeMember, timed, DEMO, O } from './lib.mjs';

const api = newApi();
const N = Number(process.env.QA_N || 300);
const boot = freshServer();
console.log('fresh server ' + boot.ms + ' ms');
const t0 = Date.now();
await api.op('setup.complete', { company_name: 'Scale Co', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const ent = (await api.op('entities.list', {}, O)).entities[0];
const loc = (await api.op('locations.add', { entity: ent.id, name: 'HQ', lat: 1.284, lng: 103.851, radius_m: 150 }, O)).location;
const depts = [];
for (const [n, c] of [['Engineering', 'ENG'], ['Sales', 'SAL'], ['Operations', 'OPS'], ['Finance', 'FIN'], ['People', 'PPL']]) depts.push((await api.op('departments.add', { name: n, code: c }, O)).department);
const hired = [];
const hireMs = [];
for (let i = 0; i < N; i++) {
  const mgr = i < 10 ? (i === 0 ? '' : hired[0].employee.id) : hired[i % 10].employee.id;
  const t = Date.now();
  const out = await api.op('people.hire', {
    entity: ent.id, legal_name: 'Person ' + String(i + 1).padStart(3, '0') + ' Scale', family_name: 'Scale', given_name: 'Person ' + (i + 1), name_order: 'given_first',
    birth_date: String(1970 + (i % 35)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9), gender: i % 2 ? 'female' : 'male', nationality: 'SG', start_day: i % 7 === 0 ? '2026-11-01' : '2024-0' + (1 + (i % 9)) + '-01',
    title: 'Staff', department: depts[i % 5].id, location: loc.id, manager: mgr, pay_basis: 'salary', pay_amount: String(3000 + (i * 37) % 12000) + '.00', pay_per: 'month',
    tax_fields: { sg_residency: 'sc', sg_shg: i % 4 === 0 ? 'cdac' : 'none' }, work_email: 'p' + i + '@scale.test',
  }, O);
  hireMs.push(Date.now() - t);
  hired.push(out);
}
const seedS = (Date.now() - t0) / 1000;
hireMs.sort((a, b) => a - b);
console.log('seeded ' + N + ' people in ' + seedS.toFixed(1) + ' s (people.hire p50 ' + hireMs[Math.floor(N / 2)] + ' ms, p95 ' + hireMs[Math.floor(N * 0.95)] + ' ms, max ' + hireMs[N - 1] + ' ms)');
await makeMember(api, 'hr@scale.test', 'Hana HR', 'hr_admin');
await makeMember(api, 'payroll@scale.test', 'Paul Payroll', 'payroll_admin');
await makeMember(api, 'mgr@scale.test', 'Mia Manager', 'manager', hired[1].employee.id);
await makeMember(api, 'emp@scale.test', 'Eli Employee', 'employee', hired[42].employee.id);
// 60 pending leave requests (HR asks for people; they wait for managers).
const types = (await api.op('leave.types', { entity: ent.id }, O)).types;
const unpaid = types.find((t) => t.code === 'unpaid') || types.find((t) => !t.paid) || types[0];
let pending = 0;
for (let i = 10; i < 70; i++) {
  const r = await api.call('leave.request', { employment: hired[i].employment.id, type: unpaid.code, start: '2026-12-0' + (1 + (i % 4)), reason: 'scale test' }, { as: 'hr@scale.test' });
  if (r.status === 200) pending++;
}
console.log('pending leave requests: ' + pending + ' (' + unpaid.code + ')');

section('Pay run of ' + N);
const PAY = { as: 'payroll@scale.test' };
const home = await api.op('payroll.home', {}, PAY);
const run = (await api.op('payruns.create', { schedule: home.schedules[0].schedule }, PAY)).payrun;
const c0 = Date.now();
let r = await api.op('payruns.calculate', { payrun: run.id }, PAY);
let calls = 1;
const chunks = [];
for (let i = 0; i < 200 && !r.done; i++) {
  const s = Date.now();
  r = await api.op('payruns.calculate', { payrun: run.id, continue: true }, PAY);
  chunks.push(Date.now() - s);
  calls++;
}
const calcMs = Date.now() - c0;
const got = await api.op('payruns.get', { payrun: run.id, limit: 50 }, PAY);
ok(got.payrun.employee_count === N && got.payrun.status === 'calculated', 'calculated ' + got.payrun.employee_count + ' payslips in ' + (calcMs / 1000).toFixed(1) + ' s over ' + calls + ' calls');
chunks.sort((a, b) => a - b);
console.log('  chunk call p50 ' + chunks[Math.floor(chunks.length / 2)] + ' ms, max ' + chunks[chunks.length - 1] + ' ms');
const iss = await api.op('payruns.issues', { payrun: run.id }, PAY);
console.log('  issues: ' + iss.issues.filter((i) => i.severity === 'blocker').length + ' blockers, ' + iss.issues.filter((i) => i.severity !== 'blocker').length + ' warnings');

section('List reads at ' + N + ' people (three tries each, ms)');
const reads = [
  ['people.directory', { status: 'current', limit: 50 }, O],
  ['people.directory', { status: 'current', limit: 500 }, O],
  ['home.directory', { limit: 50 }, { as: 'emp@scale.test' }],
  ['payslips.list', { payrun: run.id, limit: 50 }, PAY],
  ['payruns.get', { payrun: run.id, limit: 50 }, PAY],
  ['payruns.get', { payrun: run.id, limit: 500 }, PAY],
  ['payruns.variance', { payrun: run.id }, PAY],
  ['leave.calendar', { from: '2026-12-01', to: '2026-12-31' }, O],
  ['leave.calendar', { from: '2026-12-01', to: '2026-12-31' }, { as: 'mgr@scale.test' }],
  ['leave.home', {}, O],
  ['leave.attention', {}, O],
  ['leave.attention', {}, { as: 'mgr@scale.test' }],
  ['leave.balances', { limit: 500 }, O],
  ['leave.balances', { limit: 50 }, { as: 'hr@scale.test' }],
  ['attendance.board', {}, O],
  ['attendance.board', {}, { as: 'mgr@scale.test' }],
  ['approvals.list', { view: 'all', status: 'pending', limit: 50 }, O],
  ['approvals.list', { status: 'pending' }, { as: 'mgr@scale.test' }],
  ['proposals.list', { status: 'pending' }, O],
  ['app.home', {}, O],
  ['home.admin', {}, O],
  ['home.manager', {}, { as: 'mgr@scale.test' }],
  ['home.me', {}, { as: 'emp@scale.test' }],
  ['home.me', { places: true }, { as: 'emp@scale.test' }],
  ['home.me', { places: true }, { as: 'mgr@scale.test' }],
  ['notifications.list', { limit: 50 }, O],
  ['notifications.list', { limit: 50 }, { as: 'mgr@scale.test' }],
  ['perf.inbox', {}, { as: 'mgr@scale.test' }],
  ['questions.list', { everyone: true }, O],
  ['payroll.home', {}, PAY],
  ['reports.headcount', {}, O],
  ['reports.absence', {}, O],
  ['reports.absence', { fresh: true }, O],
  ['reports.leave-liability', {}, O],
  ['search.query', { q: 'Person 2' }, O],
];
const timings = [];
for (const [name, p, o] of reads) {
  const ms = [];
  let status = 0;
  let server = [];
  for (let k = 0; k < 3; k++) {
    const t = await timed(api, name, p, o);
    ms.push(Math.round(t.ms));
    server.push(t.server);
    status = t.status;
  }
  const best = Math.min(...ms);
  timings.push({ op: name, who: o.as, params: p, status, ms, server, best });
  console.log('  ' + name.padEnd(20) + ' ' + String(o.as).padEnd(20) + ' ' + status + '  ' + ms.join(' / ') + '  (server ' + server.join(' / ') + ')');
  ok(status < 500, name + ' as ' + o.as + ' answers (' + status + ')');
}
const slow = timings.filter((t) => t.best > 1500);
ok(slow.length === 0, 'every main list read under 1.5 s at ' + N + ' people (' + slow.map((t) => t.op + ' ' + t.best + ' ms').join(', ') + ')');
writeResult('t04_scale.json', { N, seed_s: seedS, hire_ms: { p50: hireMs[Math.floor(N / 2)], p95: hireMs[Math.floor(N * 0.95)], max: hireMs[N - 1] }, calc_ms: calcMs, calc_calls: calls, timings });
const s = summary('t04_scale');
process.exitCode = s.failed > 0 ? 1 : 0;
