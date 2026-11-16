// payroll-core t04: 300 employees calculated within a measured time, then
// locked, verified (determinism) and a second month calculated with history.
import { newApi, fresh, section, ok, eq, summary, O, PAY, PAYPIN, calcRun, decideAny } from './lib.mjs';

const api = newApi();
fresh({ seed: true });
const N = Number(process.env.HR_SCALE || 300);

section('Hire ' + N + ' people into a new Singapore entity');
const ent = (await api.op('entities.add', { name: 'Northwind Ops', code: 'SG02', legal_name: 'Northwind Ops Pte. Ltd.', country: 'SG' }, O)).entity;
await api.op('payroll.settings-save', { entity: ent.id, pay_method: 'cash' }, O);
// A new employer for this test: nobody was paid earlier this tax year (else the first run asks for opening balances).
await api.op('ytd.no-earlier-pay', { entity: ent.id, on: true }, O);
const rows = ['legal_name,entity,start_day,pay_basis,pay_amount,pay_per,birth_date'];
for (let i = 0; i < N; i++) rows.push(['Ops Person ' + (i + 1), 'Northwind Ops', '2025-0' + (1 + (i % 9)) + '-01', 'salary', String(3000 + (i % 50) * 137) + '.00', 'month', 1960 + (i % 45) + '-0' + (1 + (i % 9)) + '-15'].join(','));
const t0 = Date.now();
const imp = await api.op('people.import', { csv: rows.join('\n') }, O);
console.log('  imported in ' + (Date.now() - t0) + ' ms', JSON.stringify(imp).slice(0, 200));

section('Calculate ' + N + ' payslips');
const home = await api.op('payroll.home', { entity: ent.id }, O);
const run = (await api.op('payruns.create', { schedule: home.schedules[0].schedule }, O)).payrun;
const t1 = Date.now();
const res = await calcRun(api, run.id);
const ms = Date.now() - t1;
const got = await api.op('payruns.get', { payrun: run.id, limit: 5 }, O);
eq(got.payrun.employee_count, N, N + ' payslips');
ok(res.done && got.payrun.blockers === 0, 'calculated with no blockers', got.payrun.issues_summary);
ok(ms < 240000, N + ' payslips calculated in ' + ms + ' ms (' + Math.round(ms / N) + ' ms each, server time ' + got.payrun.calc_ms + ' ms)');

section('Lock and verify');
const warns = await api.op('payruns.issues', { payrun: run.id, severity: 'warning' }, O);
const codes = [...new Set(warns.issues.map((i) => i.code))];
console.log('  warnings: ' + warns.issues.length + ' (' + codes.join(', ') + ')');
if (warns.issues.length > 0) await api.op('payruns.acknowledge', { payrun: run.id, reason: 'reviewed_ok' }, PAY);
const sub = await api.op('payruns.submit', { payrun: run.id }, PAY);
await decideAny(api, sub.approval.id, 'approved');
const t2 = Date.now();
await api.op('payruns.lock', { payrun: run.id }, PAYPIN);
ok(true, 'locked ' + N + ' payslips in ' + (Date.now() - t2) + ' ms');
const t3 = Date.now();
const v = await api.op('payruns.verify', { payrun: run.id }, O);
ok(v.matching === N && v.run_hash_ok, 'all ' + N + ' recompute to their fingerprints (' + (Date.now() - t3) + ' ms)');

section('Next month with history');
const run2 = (await api.op('payruns.create', { schedule: home.schedules[0].schedule }, O)).payrun;
const t4 = Date.now();
await calcRun(api, run2.id);
const ms2 = Date.now() - t4;
const g2 = await api.op('payruns.get', { payrun: run2.id, limit: 1 }, O);
ok(g2.payrun.employee_count === N && g2.payrun.blockers === 0, 'December: ' + N + ' payslips with one month of history in ' + ms2 + ' ms');
const v2 = await api.op('payruns.variance', { payrun: run2.id }, O);
ok(v2.previous && v2.previous.id === run.id, 'variance compares with November');

console.log('\nSCALE: ' + N + ' payslips: first month ' + ms + ' ms, second month ' + ms2 + ' ms');
const s = summary('t04_scale');
process.exitCode = s.failed > 0 ? 1 : 0;
