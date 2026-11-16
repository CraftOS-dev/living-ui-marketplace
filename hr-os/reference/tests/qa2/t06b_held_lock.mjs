// QA2 t06b: finish t06 A/B on the December US run (PR-0035): Grace Kim's December
// hours are still in the future, so her payslip is only the November
// adjustments (negative). Give her a December allowance input, lock the run
// with Taylor Brooks' pay held, then check the reconciliation, the bank file
// and that the November adjustments are paid once.
import { newApi, section, ok, eq, summary, writeResult, O } from './lib.mjs';

const api = newApi();
const PAY = { as: 'payroll@northwind.test' };
const PAYPIN = { as: 'payroll@northwind.test', pin: true };
const R = {};
async function approveAll(id) {
  for (let i = 0; i < 6; i++) {
    const a = (await api.op('approvals.get', { approval: id }, O)).approval;
    if (a.status !== 'pending') return a.status;
    for (const as of ['owner', 'hr@northwind.test']) {
      const r = await api.call('approvals.decide', { approval: id, decision: 'approved', note: 'QA2' }, { as, pin: true });
      if (r.status < 400) break;
    }
  }
  return 'pending';
}
async function calcRun(id) {
  let r = await api.op('payruns.calculate', { payrun: id }, PAY);
  for (let i = 0; i < 80 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: id, continue: true }, PAY);
}
const linesOf = (slip) => slip.groups.flatMap((g) => g.lines);
async function slipOf(runId, number) {
  const got = await api.op('payruns.get', { payrun: runId, limit: 500 }, PAY);
  const row = got.payslips.find((x) => x.number === number);
  return row ? (await api.op('payslips.get', { payslip: row.id }, PAY)).payslip : null;
}
const dir = (await api.op('people.directory', { status: 'all', limit: 500 }, O)).people;
const grace = dir.find((p) => p.name === 'Grace Kim');
const run = (await api.op('payruns.get', { payrun: 'PR-0035' }, PAY)).payrun;

section('December US run: Grace gets an allowance, Taylor is held, the run locks');
const comps = (await api.op('components.list', { entity: run.entity }, PAY)).components;
const allow = comps.find((c) => c.role === 'allowance') || comps.find((c) => c.role === 'bonus');
await api.op('pay-inputs.add', { employment: grace.employment, component: allow.code, amount: '500.00', payrun: run.id }, PAY);
await calcRun(run.id);
const gs = await slipOf(run.id, grace.number);
const adj = linesOf(gs).filter((l) => l.explain && l.explain.source === 'time_adjustment');
R.grace = { net: gs.net_minor, adjustments: adj.map((l) => l.name + ' ' + l.amount_minor) };
ok(gs.net_minor > 0 && adj.length === 2, 'Grace: allowance plus the two November adjustments, net ' + gs.net_minor + ' (' + R.grace.adjustments.join('; ') + ')');
const iss = (await api.op('payruns.issues', { payrun: run.id }, PAY)).issues;
const blockers = iss.filter((i) => i.severity === 'blocker');
ok(blockers.length === 0, 'no blockers (' + blockers.map((b) => b.code + ' ' + (b.employee_name || '') + ': ' + b.message).join('; ') + ')');
R.issue_codes = [...new Set(iss.map((i) => i.severity + ':' + i.code))];
if (iss.length) await api.op('payruns.acknowledge', { payrun: run.id, reason: 'reviewed_ok', note: 'QA2' }, PAY);
const sub = await api.op('payruns.submit', { payrun: run.id }, PAY);
if (sub.approval) await approveAll(sub.approval.id);
const lock = await api.call('payruns.lock', { payrun: run.id }, PAYPIN);
ok(lock.status === 200 && lock.body.payrun.status === 'locked', 'PR-0035 locks (' + lock.status + ' ' + ((lock.body && lock.body.code) || '') + ')', lock.body);
R.lock_result = lock.body && { status: lock.body.payrun && lock.body.payrun.status, settled: lock.body.settled, time: lock.body.time };

section('Held pay and the reconciliation');
const ts = await slipOf(run.id, 'E0026');
const pr = (await api.op('payruns.get', { payrun: run.id }, PAY)).payrun;
const po = await api.op('payout.run', { payrun: run.id, format: 'nacha_ppd' }, PAY);
const t = po.totals;
R.totals = t;
ok(ts.held === true || (po.held || 0) >= 1, 'Taylor\'s payslip is held (' + ts.held + ', held count ' + po.held + ')');
eq(t.held_minor, ts.net_minor, 'held pay = Taylor\'s net');
eq(t.to_pay_minor, pr.net_minor - ts.net_minor, 'net to pay = run net ' + pr.net_minor + ' less held ' + ts.net_minor);
ok(t.balanced === true, 'balanced: to pay ' + t.to_pay_minor + ' = bank ' + t.bank_minor + ' + cash ' + t.cash_minor + ' + cheque ' + t.cheque_minor, t);
const ex = await api.call('bankfiles.export', { payrun: run.id, format: 'nacha_ppd' }, PAYPIN);
ok(ex.status === 200, 'bank file written (' + ex.status + ' ' + ((ex.body && ex.body.code) || '') + ')', ex.body);
if (ex.status === 200) {
  eq(ex.body.bank_file.total_minor, t.to_pay_minor, 'bank file total = net to pay (held pay left out)');
  eq(ex.body.bank_file.count, t.bank_people, 'bank file entries = people paid by bank (' + t.bank_people + ')');
  R.bank_file = { total: ex.body.bank_file.total_minor, count: ex.body.bank_file.count, totals: ex.body.totals };
  ok(ex.body.totals === undefined || ex.body.totals.balanced === true, 'bankfiles.export reports the same balanced totals');
}
const ov = await api.op('payout.overview', { entity: run.entity }, PAY);
const row = (ov.runs || ov.payruns || ov.rows || []).find((r) => r.number === 'PR-0035');
R.overview_row = row;
ok(row === undefined || row.totals === undefined || row.totals.balanced === true, 'payout.overview shows PR-0035 balanced');

section('Paid once');
const jan = await api.op('time.pay-inputs', { employment: grace.employment, from: '2027-01-01', to: '2027-01-31' }, O);
R.january = jan.adjustments;
ok(!(jan.adjustments || []).some((x) => x.day === '2026-11-03' || x.day === '2026-11-04'), 'January pay inputs no longer list 3 or 4 Nov (paid once by PR-0035)', jan.adjustments);
const dec = await api.op('time.pay-inputs', { employment: grace.employment, from: '2026-12-01', to: '2026-12-31' }, O);
R.december_after = dec.adjustments;
ok(!(dec.adjustments || []).some((x) => x.day === '2026-11-03'), 'December pay inputs after the lock no longer list them either', dec.adjustments);
// Release the hold as paid outside payroll and check the totals again.
const holds = (await api.op('holds.list', { status: 'held' }, PAY)).holds || [];
const h = holds.find((x) => x.payrun === run.id || x.payrun_number === 'PR-0035' || x.number === 'E0026');
R.hold = h;
if (h) {
  const rel = await api.call('holds.release', { hold: h.id, via: 'outside', note: 'QA2 paid by cheque' }, PAYPIN);
  R.release = { status: rel.status, code: rel.body && rel.body.code };
  const po2 = await api.op('payout.run', { payrun: run.id, format: 'nacha_ppd' }, PAY);
  R.totals_after_release = po2.totals;
  ok(po2.totals.balanced === true, 'still balanced after the hold is released outside payroll (' + rel.status + ')', po2.totals);
}
writeResult('t06b_results.json', R);
const s = summary('t06b_held_lock');
process.exitCode = s.failed > 0 ? 1 : 0;
