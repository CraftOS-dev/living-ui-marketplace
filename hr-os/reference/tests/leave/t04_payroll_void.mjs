// t04: a cash-in of leave across lock, void, replace and lock again (the real
// payroll module): paid once, by the replacement; the days leave the balance once.
// Run on a fresh demo seed (tools/dev/seed_demo.mjs), with zz_leave_test.pb.js in pb_hooks.
import { readFileSync } from 'node:fs';
import { api, ok, eq, near, done, section } from './lib.mjs';

const O = { as: 'owner' };
const PAY = 'payroll@northwind.test';
const PAYPIN = { as: PAY, pin: true };
const SAM = 'sam@northwind.test';
const tr = async (fn, body) => {
  const res = await fetch(api.base + '/api/leave-test/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', 'X-A2App-Token': readFileSync(api.app + '/.agent-token', 'utf8').trim() }, body: JSON.stringify(body || {}) });
  const j = await res.json();
  if (res.status !== 200) throw new Error(fn + ': ' + JSON.stringify(j));
  return j.out;
};
async function decideAny(id, decision) {
  let last = null;
  for (const as of [PAY, 'owner', 'hr@northwind.test', 'eng.lead@northwind.test']) {
    const r = await api.call('approvals.decide', { approval: id, decision }, { as, pin: true });
    if (r.status < 400) return r.body;
    last = r;
  }
  throw new Error('nobody could decide ' + id + ': ' + JSON.stringify(last.body));
}
async function decideAll(id) {
  for (let i = 0; i < 4; i++) {
    const a = await api.op('approvals.get', { approval: id }, O);
    if (a.approval.status !== 'pending') return a.approval.status;
    await decideAny(id, 'approved');
  }
  return (await api.op('approvals.get', { approval: id }, O)).approval.status;
}
async function calcRun(id) {
  let r = await api.op('payruns.calculate', { payrun: id }, O);
  for (let i = 0; i < 60 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: id, continue: true }, O);
  return r;
}
async function approveAndLock(id) {
  const iss = await api.op('payruns.issues', { payrun: id }, O);
  const blockers = iss.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length > 0) throw new Error('blockers: ' + JSON.stringify(blockers.slice(0, 3)));
  if (iss.issues.length > 0) await api.op('payruns.acknowledge', { payrun: id, reason: 'reviewed_ok' }, { as: PAY });
  const sub = await api.op('payruns.submit', { payrun: id }, { as: PAY });
  if (sub.approval && sub.approval.status === 'pending') await decideAll(sub.approval.id);
  return api.op('payruns.lock', { payrun: id }, PAYPIN);
}
async function samLines(runId) {
  const got = await api.op('payruns.get', { payrun: runId }, O);
  const row = got.payslips.find((x) => x.number === 'E0005');
  if (!row) return { slip: null, lines: [] };
  const s = (await api.op('payslips.get', { payslip: row.id }, O)).payslip;
  return { slip: s, lines: (s.groups || []).flatMap((g) => g.lines || []) };
}
/** Cash-in lines: from leave.payInputs (ref_kind encash) or payroll's copy at void (a pay input whose detail says encash). */
const isEncash = (l) => l.ref_kind === 'encash' || (l.explain && l.explain.detail && l.explain.detail.ref_kind === 'encash');

section('prepare: the Singapore people can be paid');
const ents = (await api.op('entities.list', {}, O)).entities;
const sg = ents.find((e) => e.country === 'SG');
const dir = await api.op('people.directory', { entity: sg.id, status: 'current', limit: 200 }, O);
for (const r of dir.people) {
  if (r.number === 'E0005') continue;
  const add = await api.op('bank.add', { employee: r.employee, number: '99' + r.number.replace(/\D/g, '') + '0001', bank_name: 'Test Bank', bank_code: '7171', holder: r.name }, O);
  if (add.approval && add.approval.status === 'pending') await decideAny(add.approval.id, 'approved');
}
for (const a of (await api.op('approvals.list', { view: 'all', status: 'pending', kind: 'bank_account' }, O)).approvals) await decideAny(a.id, 'approved');
const samEmp = dir.people.find((x) => x.number === 'E0005').employment;

section('Sam cashes in two days; manager and HR approve');
const before = (await api.op('leave.balance', { employment: samEmp, type: 'annual' }, O)).available;
const enc = await api.op('leave.encash-request', { type: 'annual', days: 2, reason: 'Year-end' }, { as: SAM });
eq(await decideAll(enc.approval.id), 'approved', 'approved by both steps');
const typeId = (await api.op('leave.balance', { employment: samEmp, type: 'annual' }, O)).type_id;
near((await api.op('leave.balance', { employment: samEmp, type: 'annual' }, O)).available, before - 2, 'the days leave the balance at approval');
let e1 = (await api.op('leave.encashments', { employment: samEmp }, O)).encashments.find((x) => x.id === enc.encash.id);
eq([e1.status, e1.payrun], ['approved', ''], 'approved, not paid yet');

section('lock: the November run pays it');
const home = await api.op('payroll.home', {}, O);
const sched = home.schedules.find((x) => x.entity_name === sg.name);
const run1 = (await api.op('payruns.create', { schedule: sched.schedule }, O)).payrun;
await calcRun(run1.id);
const l1 = await samLines(run1.id);
const encLines1 = l1.lines.filter(isEncash);
eq(encLines1.length, 1, 'one cash-in line on Sam\'s payslip');
const code = encLines1[0] ? encLines1[0].code : '';
const amount = encLines1[0] ? encLines1[0].amount_minor : 0;
ok(amount > 0, 'it pays an amount (' + code + ' ' + amount + ')');
await approveAndLock(run1.id);
e1 = (await api.op('leave.encashments', { employment: samEmp }, O)).encashments.find((x) => x.id === enc.encash.id);
eq([e1.status, e1.payrun], ['paid', run1.id], 'lock marks it paid by the run');

section('void: the cash-in goes back to approved, reserved for the replacement');
const v = await api.op('payruns.void', { payrun: run1.id, reason: 'Wrong allowance for one person' }, PAYPIN);
const repl = v.replacement;
const e2 = (await api.op('leave.encashments', { employment: samEmp }, O)).encashments.find((x) => x.id === enc.encash.id);
eq([e2.status, e2.payrun, e2.reserved_for], ['approved', '', repl.id], 'approved and unpaid, reserved for the replacement');
eq(e2.pay_history.map((h) => h.event), ['paid', 'released'], 'the history keeps the payment and the release');
near((await api.op('leave.balance', { employment: samEmp, type: 'annual' }, O)).available, before - 2, 'the days stay cashed in (no change to the balance)');
const pi = await tr('payInputs', { employment: samEmp, from: run1.period_start, to: run1.period_end });
eq(pi.encash.length, 0, 'payInputs leaves it out: the replacement pays it from the copy payroll made');
const audit = await api.op('audit.list', { collection: 'leave_encash_requests', record: enc.encash.id }, O);
ok(audit.entries.some((x) => /released from a voided pay run/.test(x.summary)), 'the release is in the audit trail');

section('replace and lock again: paid once, by the replacement');
await calcRun(repl.id);
const l2 = await samLines(repl.id);
const again = l2.lines.filter(isEncash);
eq(again.length, 1, 'one cash-in line on the replacement payslip');
eq(again[0] ? again[0].amount_minor : 0, amount, 'the same amount');
await approveAndLock(repl.id);
const e3 = (await api.op('leave.encashments', { employment: samEmp }, O)).encashments.find((x) => x.id === enc.encash.id);
eq([e3.status, e3.payrun, e3.reserved_for], ['paid', repl.id, ''], 'paid by the replacement');
eq(e3.pay_history.map((h) => h.event), ['paid', 'released', 'paid'], 'paid, released, paid again');
eq(await tr('markEncashPaid', { ids: [enc.encash.id], payrun: repl.id }), 0, 'marking it again changes nothing');
eq(await tr('markEncashPaid', { ids: [enc.encash.id], payrun: run1.id }), 0, 'the void run cannot take it back');
const rows = (await api.op('leave.ledger', { employment: samEmp, type: 'annual' }, O)).rows.filter((r) => r.kind === 'encash' && r.ref === enc.encash.id);
eq(rows.map((r) => r.amount), [-2], 'one ledger row for the cash-in, never reversed or repeated');
near((await api.op('leave.balance', { employment: samEmp, type: 'annual' }, O)).available, before - 2, 'the balance counts the two days once');
const sum = await tr('ledgerSum', { employment: samEmp, type: typeId, day: '2026-12-31' });
ok(Number.isFinite(sum.n), 'ledger still sums');
let paidLines = 0;
for (const runId of [run1.id, repl.id]) {
  const got = await api.op('payruns.get', { payrun: runId }, O);
  if (got.payrun.status === 'void') continue;
  paidLines += (await samLines(runId)).lines.filter(isEncash).length;
}
eq(paidLines, 1, 'across the runs that stand, Sam is paid the cash-in once');

done('t04 payroll void');
