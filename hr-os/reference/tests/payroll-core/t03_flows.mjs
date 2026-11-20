// payroll-core t03: the pay run flows end to end on the demo seed.
// Inputs (recurring, one-off, CSV), time, leave and expenses inputs (the real modules),
// approval and lock with the PIN, lock effects, publication, lock immutability,
// determinism, void and replace, holds, loans, US supplemental bonus, final pay
// with leave encashment, correction run, back pay, declarations, tax profile
// self-service, variance, your AI agent and employee refusals, pay calendar.
import { newApi, fresh, preparePayable, calcRun, section, ok, eq, refuses, summary, O, PAY, PIN, PAYPIN, byCode, cents, stubData, stubCalls, decideAny, DEMO, PORT } from './lib.mjs';

const api = newApi();
fresh({ seed: true });
await preparePayable(api);

const dir = await api.op('people.directory', { status: 'all', limit: 500 }, O);
const P = {};
for (const r of dir.people) P[r.number] = r;
const SAM = 'sam@northwind.test';
const AG = { as: 'agent' };

/** Decide an approval until it is no longer pending (multi-step flows). */
async function decideAll(id) {
  for (let i = 0; i < 4; i++) {
    const a = await api.op('approvals.get', { approval: id }, O);
    if (a.approval.status !== 'pending') return a.approval.status;
    await decideAny(api, id, 'approved');
  }
  return (await api.op('approvals.get', { approval: id }, O)).approval.status;
}

async function runFor(entityName, extra) {
  const home = await api.op('payroll.home', {}, O);
  const s = home.schedules.find((x) => x.entity_name === entityName);
  return (await api.op('payruns.create', Object.assign({ schedule: s.schedule }, extra || {}), O)).payrun;
}
async function slip(runId, number) {
  const got = await api.op('payruns.get', { payrun: runId }, O);
  const row = got.payslips.find((x) => x.number === number);
  return row ? (await api.op('payslips.get', { payslip: row.id }, O)).payslip : null;
}
async function approveAndLock(runId) {
  const iss = await api.op('payruns.issues', { payrun: runId }, O);
  if (iss.issues.some((i) => i.severity !== 'blocker')) await api.op('payruns.acknowledge', { payrun: runId, reason: 'reviewed_ok' }, PAY);
  const sub = await api.op('payruns.submit', { payrun: runId }, PAY);
  await decideAny(api, sub.approval.id, 'approved');
  return api.op('payruns.lock', { payrun: runId }, PAYPIN);
}

section('Pay calendar: pay days move off weekends and holidays');
{
  const home = await api.op('payroll.home', {}, O);
  const jp = home.schedules.find((x) => x.entity_name === 'Northwind KK');
  const cal = await api.op('pay-schedules.calendar', { schedule: jp.schedule, year: '2026' }, O);
  const apr = cal.periods.find((x) => x.period_start === '2026-04-01');
  eq([apr.planned_pay_date, apr.pay_date, apr.pay_date_moved], ['2026-04-25', '2026-04-24', true], 'JP pay day 25 April 2026 (a Saturday) moves to Friday 24th');
  const sg = home.schedules.find((x) => x.entity_name === 'Northwind Pte Ltd');
  const cal2 = await api.op('pay-schedules.calendar', { schedule: sg.schedule, year: '2027' }, O);
  const jan = cal2.periods.find((x) => x.period_start === '2027-01-01');
  eq(jan.pay_date, '2027-01-29', 'SG pay day 31 January 2027 (a Sunday) moves to Friday 29th');
  const nov = cal.periods.find((x) => x.period_start === '2026-11-01');
  eq([nov.pay_date, nov.cutoff_day], ['2026-11-25', '2026-11-20'], 'JP November: pay day 25th, inputs close 5 days before');
}

section('Pay items: recurring, one-off, CSV with a dry run');
const allowance = await api.op('recurring.save', { employment: P.E0005.employment, component: 'SG_ALLOWANCE', amount: '300.00', from_day: '2026-11-01', note: 'Transport' }, O);
ok(allowance.item.component_code === 'SG_ALLOWANCE' && allowance.item.amount_minor === 30000, 'recurring allowance added');
const bonus = await api.op('pay-inputs.add', { employment: P.E0002.employment, component: 'SG_BONUS', amount: '2000.00', note: 'Project bonus' }, O);
eq([bonus.input.period_start, bonus.input.status], ['2026-11-01', 'open'], 'one-off bonus lands in the next period');
{
  const bad = await api.op('pay-inputs.import-check', { csv: 'employee,component,amount\nE0003,SG_ALLOWANCE,150.00\nE0099,SG_ALLOWANCE,10\nE0003,NOPE,5' }, O);
  ok(!bad.ok && bad.problems.length === 2 && bad.would_add === 0, 'CSV dry run reports the unknown person and the unknown component, adds nothing', bad.problems);
  await refuses(api, 'pay-inputs.import', { csv: 'employee,component,amount\nE0003,SG_ALLOWANCE,150.00\nE0099,SG_ALLOWANCE,10' }, O, 400, 'import_problems', 'a CSV with problems imports nothing');
  const good = await api.op('pay-inputs.import', { csv: 'employee,component,amount,note\nE0008,SG_ALLOWANCE,150.00,Meal\nE0007,SG_ALLOWANCE,80.00,Phone' }, O);
  eq(good.added, 2, 'a clean CSV adds every row');
}

section('Singapore November: inputs from every source, approval, lock with the PIN');
// Time (the real module when it is installed): a long day for Sam; payroll pays what Time reports.
const marked = await api.call('attendance.mark', { employment: P.E0005.employment, day: '2026-11-02', status: 'present', in_time: '09:00', out_time: '21:00', break_min: 60, note: 'Release night' }, O);
const sgRun = await runFor('Northwind Pte Ltd');
await calcRun(api, sgRun.id);
let samOt = 0;
{
  const sam = byCode(await slip(sgRun.id, 'E0005'));
  if (marked.status === 200) {
    const tp = await api.op('time.pay-inputs', { employment: P.E0005.employment, from: '2026-11-01', to: '2026-11-30' }, O);
    // Hourly rate 7,800 x 12 / 52 / 40 = 45.00 (schedule 40 hours a week); each bucket: minutes / 60 x 45.00 x multiplier.
    for (const o of tp.overtime || []) samOt += Math.round(((o.minutes / 60) * 4500 * o.multiplier) + 1e-7);
    const paid = Object.keys(sam).filter((k) => /^(OT|RD|SUN|PH|NIGHT)\d/.test(k)).reduce((a, k) => a + sam[k], 0);
    ok((tp.overtime || []).length > 0 && paid === samOt, 'Sam: overtime from Time paid at the hourly rate times each multiplier (' + paid + ')', { overtime: tp.overtime, paid });
  } else {
    samOt = sam.OT150 || 0;
    eq(samOt, 13500, 'Sam: overtime from Time (stub: 2 hours x 45.00 x 1.5)');
  }
  eq([sam.SG_BASIC, sam.SG_ALLOWANCE], [780000, 30000], 'Sam: base and recurring allowance');
  // OW 8,235 is above the 8,000 ceiling: CPF on 8,000.
  eq([sam.SG_CPF_EE, sam.SG_CPF_ER], [160000, 136000], 'Sam: CPF on the capped ordinary wage');
  const priya = byCode(await slip(sgRun.id, 'E0002'));
  // Additional wage 2,000 within the AW ceiling (102,000 - 8,000 x 2 months left): total 37% x 10,000, employee 20%.
  eq([priya.SG_BONUS, priya.SG_CPF_EE, priya.SG_CPF_ER, priya.SG_CPF_AW], [200000, 200000, 170000, 200000], 'Priya: bonus is an additional wage; CPF on OW 8,000 + AW 2,000');
  const v = await api.op('payruns.variance', { payrun: sgRun.id }, O);
  ok(v.previous !== null, 'variance compares with the demo\'s locked October run (' + (v.previous ? v.previous.number : 'none') + ')');
  ok(!v.by_employee.some((x) => x.reasons.indexOf('first_run') >= 0), 'not a first run: no first_run reasons');
}
await refuses(api, 'payruns.lock', { payrun: sgRun.id }, PAYPIN, 409, 'not_approved', 'a calculated run cannot be locked before approval');
{
  const warn = await api.op('payruns.issues', { payrun: sgRun.id, severity: 'warning' }, O);
  if (warn.issues.length > 0) {
    await refuses(api, 'payruns.submit', { payrun: sgRun.id }, PAY, 409, 'unacknowledged', 'warnings need an acknowledgement before approval');
    await api.op('payruns.acknowledge', { payrun: sgRun.id, reason: 'reviewed_ok' }, PAY);
  }
  const sub = await api.op('payruns.submit', { payrun: sgRun.id }, PAY);
  ok(sub.approval && sub.approval.kind === 'payrun' && sub.approval.status === 'pending', 'submit opens a payrun approval');
  await refuses(api, 'approvals.decide', { approval: sub.approval.id, decision: 'approved' }, PAYPIN, 403, 'not_permitted', 'the preparer cannot approve their own run');
  await decideAny(api, sub.approval.id, 'approved');
  const r = await api.op('payruns.get', { payrun: sgRun.id }, O);
  eq(r.payrun.status, 'approved', 'approved by the flow (owner)');
  await refuses(api, 'payruns.lock', { payrun: sgRun.id }, { as: 'payroll@northwind.test', pin: '000000' }, 403, 'wrong_pin', 'a wrong PIN does not lock');
  const locked = await api.op('payruns.lock', { payrun: sgRun.id }, PAYPIN);
  eq(locked.payrun.status, 'locked', 'locked with the PIN');
  ok(locked.payrun.hash.length === 64 && locked.payrun.input_hash.length === 64, 'the run keeps its output and input fingerprints');
  const calls = stubCalls();
  if (marked.status === 200) {
    const again = await api.call('attendance.mark', { employment: P.E0005.employment, day: '2026-11-02', status: 'absent', note: 'x' }, O);
    ok(again.status >= 400, 'Time refuses changes to a day the locked run used (lib_time.lockDays ran)', again.body);
  } else eq(calls.filter((c) => c.fn === 'lib_time.lockDays' && c.args[3] === sgRun.id).length, r.payrun.employee_count, 'lock calls lib_time.lockDays for every employment');
  const inp = await api.op('pay-inputs.list', { employment: P.E0002.employment, status: 'all' }, O);
  ok(inp.inputs.find((x) => x.id === bonus.input.id).status === 'used', 'pay inputs paid by the run are marked used');
}

section('Publication and the employee view');
{
  const before = await api.op('payslips.mine', {}, { as: SAM });
  const inRun = (list) => (list.payslips || []).filter((x) => x.payrun === sgRun.id || x.pay_date === sgRun.pay_date).length;
  eq(inRun(before), 0, 'before publication Sam sees no November payslip (October is published)');
  const pub = await api.op('payruns.publish', { payrun: sgRun.id }, PAY);
  ok(pub.published > 0, 'payslips published (' + pub.published + ')');
  const mine = await api.op('payslips.mine', {}, { as: SAM });
  eq(inRun(mine), 1, 'Sam sees his published November payslip');
  const own = await api.op('payslips.get', { payslip: mine.payslips.find((x) => x.payrun === sgRun.id || x.pay_date === sgRun.pay_date).id }, { as: SAM });
  ok(own.payslip.groups.length > 0 && own.payslip.issues === undefined, 'Sam opens it (no payroll issues shown to him)');
  const notes = await api.op('notifications.list', {}, { as: SAM });
  ok((notes.notifications || []).some((n) => n.kind === 'payslip' && !/\d{3}/.test(n.title.replace(/\d{4}-\d{2}-\d{2}/g, ''))), 'Sam got a payslip notice without amounts');
  const priyaRow = (await api.op('payruns.get', { payrun: sgRun.id }, O)).payslips.find((x) => x.number === 'E0002');
  await refuses(api, 'payslips.get', { payslip: priyaRow.id }, { as: SAM }, 403, 'not_permitted', 'Sam cannot open Priya\'s payslip');
  await api.op('payslips.viewed', { payslip: mine.payslips[0].id }, { as: SAM });
  const again = await api.op('payslips.mine', {}, { as: SAM });
  ok(again.payslips[0].viewed, 'first view recorded');
}

section('Lock immutability: every write to a locked run is refused');
{
  const before = await api.op('payruns.get', { payrun: sgRun.id }, O);
  const usedInput = bonus.input.id;
  await refuses(api, 'payruns.calculate', { payrun: sgRun.id }, PAY, 409, 'run_locked', 'calculate');
  await refuses(api, 'payruns.people', { payrun: sgRun.id, remove: [P.E0005.employment] }, PAY, 409, 'run_locked', 'remove a person');
  await refuses(api, 'payruns.acknowledge', { payrun: sgRun.id, reason: 'reviewed_ok' }, PAY, 409, 'run_locked', 'acknowledge');
  await refuses(api, 'payruns.reopen', { payrun: sgRun.id }, PAY, 409, 'run_locked', 'reopen');
  await refuses(api, 'payruns.delete', { payrun: sgRun.id }, PAY, 409, 'run_locked', 'delete');
  await refuses(api, 'payruns.submit', { payrun: sgRun.id }, PAY, 409, 'not_calculated', 'submit again');
  await refuses(api, 'payruns.lock', { payrun: sgRun.id }, PAYPIN, 409, 'not_approved', 'lock again');
  await refuses(api, 'holds.hold', { payrun: sgRun.id, employment: P.E0005.employment, reason: 'x' }, PAY, 409, 'run_locked', 'hold pay');
  await refuses(api, 'pay-inputs.update', { input: usedInput, amount: '1.00' }, PAY, 409, 'locked', 'change a used input');
  await refuses(api, 'pay-inputs.void', { input: usedInput }, PAY, 409, 'locked', 'void a used input');
  await refuses(api, 'pay-inputs.add', { employment: P.E0005.employment, component: 'SG_BONUS', amount: '1.00', payrun: sgRun.id }, PAY, 409, 'run_locked', 'add an input to the locked run');
  await refuses(api, 'recurring.save', { item: allowance.item.id, amount: '999.00' }, PAY, 409, 'locked', 'change the amount of a recurring item it used');
  const payRec = (await api.op('pay.history', { employment: P.E0005.employment }, O)).records.find((x) => x.state === 'current');
  await refuses(api, 'pay.edit', { record: payRec.id, amount: '9000.00' }, O, 409, 'locked', 'edit the pay record it used (kernel Edit asks payroll)');
  const tax = (await api.op('tax.history', { employment: P.E0005.employment }, O)).records.slice(-1)[0];
  await refuses(api, 'tax.edit', { record: tax.id, fields: { sg_shg: 'cdac' } }, O, 409, 'locked', 'edit the tax profile it used');
  const raw = await fetch('http://127.0.0.1:' + PORT + '/api/collections/payslips/records', { method: 'GET' });
  ok(raw.status >= 400, 'raw collection access is refused (' + raw.status + ')');
  const after = await api.op('payruns.get', { payrun: sgRun.id }, O);
  eq([after.payrun.hash, after.payrun.net_minor, after.payrun.status], [before.payrun.hash, before.payrun.net_minor, 'locked'], 'the locked run is unchanged');
}

section('Determinism: recalculating the stored inputs gives the same fingerprints');
{
  const v = await api.op('payruns.verify', { payrun: sgRun.id }, O);
  ok(v.checked > 0 && v.matching === v.checked && v.mismatches.length === 0, 'every payslip recomputes to its stored hash (' + v.matching + '/' + v.checked + ')');
  ok(v.run_hash_ok && v.run_hash === v.stored_run_hash, 'the run fingerprint matches');
}

section('Loans: request, two approvals, repayment through payroll');
let loan = null;
{
  const req = await api.op('loans.request', { employment: P.E0016.employment, amount: '120000', installments: 12, start_period: '2026-11', kind: 'personal', reason: 'Moving' }, { as: 'haruto@northwind.test' });
  loan = req.loan;
  eq([loan.status, loan.installment_minor], ['requested', 10000], 'Haruto asks for 120,000 yen over 12 months');
  await decideAny(api, req.approval.id, 'approved');
  const a2 = await api.op('approvals.get', { approval: req.approval.id }, O);
  if (a2.approval.status === 'pending') await decideAny(api, req.approval.id, 'approved');
  const got = await api.op('loans.get', { loan: loan.id }, O);
  eq([got.loan.status, got.loan.balance_minor], ['active', 120000], 'approved by the manager step and payroll: active');
}

section('Expenses (the real module): a claim, an advance paid out and an advance recovered');
const exp = {};
{
  const cats = (await api.op('expense-categories.list', { entity: P.E0016.entity }, O)).categories;
  const cat = cats.find((c) => !c.archived && !c.taxable && c.kind !== 'mileage') || cats[0];
  const claim = await api.op('claims.create', { employment: P.E0016.employment, title: 'Client visit', pay_via: 'payroll' }, O);
  exp.claim = claim.claim.id;
  await api.op('claim-lines.add', { claim: exp.claim, employment: P.E0016.employment, day: '2026-11-03', category: cat.code, amount: '12000', merchant: 'JR East', description: 'Train to the client' }, O);
  await api.op('claims.submit', { claim: exp.claim }, { as: 'haruto@northwind.test' });
  const claimApproval = (await api.op('claims.get', { claim: exp.claim }, O)).claim.approval;
  eq(await decideAll(claimApproval), 'approved', 'Haruto\'s 12,000 yen claim is approved (pay with payroll)');
  const a1 = await api.op('advances.request', { employment: P.E0016.employment, amount: '50000', purpose: 'Trip to Osaka', pay_via: 'payroll', recover_via: 'claim' }, O);
  exp.payout = a1.advance.id;
  eq(await decideAll((await api.op('advances.get', { advance: exp.payout }, O)).advance.approval), 'approved', 'a 50,000 yen advance to pay with the run is approved');
  const a2 = await api.op('advances.request', { employment: P.E0017.employment, amount: '30000', purpose: 'Conference', pay_via: 'bank', recover_via: 'payroll', recover_from: '2026-11-01' }, O);
  exp.recover = a2.advance.id;
  eq(await decideAll((await api.op('advances.get', { advance: exp.recover }, O)).advance.approval), 'approved', 'Yui\'s 30,000 yen advance (paid by bank, recovered through payroll) is approved');
  await api.op('advances.mark-paid', { advance: exp.recover, reference: 'TRF-001', day: '2026-11-04' }, O);
  const g = await api.op('advances.get', { advance: exp.recover }, O);
  eq([g.advance.status, g.advance.balance_minor], ['paid', 30000], 'it was paid by transfer: 30,000 to recover');
}
async function expenseState() {
  const c = (await api.op('claims.get', { claim: exp.claim }, O)).claim;
  const p = (await api.op('advances.get', { advance: exp.payout }, O)).advance;
  const r = (await api.op('advances.get', { advance: exp.recover }, O)).advance;
  return { claim: [c.status, c.payrun || ''], payout: [p.status, p.payrun || '', p.balance_minor], recover: [r.status, r.balance_minor, (r.settlements || []).filter((x) => x.kind === 'payroll').map((x) => x.payrun)] };
}

section('Japan November: lock, then void and replace before payment');
const jpRun = await runFor('Northwind KK');
await calcRun(api, jpRun.id);
let jpReplacement = null;
{
  const h = byCode(await slip(jpRun.id, 'E0016'));
  eq(h.LOAN_REPAY, 10000, 'the loan installment is deducted');
  const y = byCode(await slip(jpRun.id, 'E0017'));
  eq([h.REIMB, h.ADVANCE, y.ADV_RECOVERY], [12000, 50000, 30000], 'the claim (REIMB) and the advance (ADVANCE) are paid with Haruto\'s pay; Yui\'s advance is recovered');
  const hs = await slip(jpRun.id, 'E0016');
  ok(hs.gross_minor === 520000 && hs.net_minor > 0, 'reimbursement and advance are not wages (gross stays 520,000)');
  const before = await api.op('payruns.get', { payrun: jpRun.id }, O);
  await approveAndLock(jpRun.id);
  eq((await api.op('loans.get', { loan: loan.id }, O)).loan.balance_minor, 110000, 'lock posts the repayment (balance 110,000)');
  const st1 = await expenseState();
  eq([st1.claim, st1.payout, st1.recover], [['paid', jpRun.id], ['paid', jpRun.id, 50000], ['settled', 0, [jpRun.id]]], 'lock: Expenses marks the claim and the advance paid and records the recovery (lib_expenses.markPaid)');
  await refuses(api, 'payruns.void', { payrun: jpRun.id, reason: 'x' }, AG, 403, 'agent_not_permitted', 'your AI agent cannot void');
  await refuses(api, 'payruns.void', { payrun: jpRun.id }, PAYPIN, 400, 'missing_param', 'void needs a reason');
  const v = await api.op('payruns.void', { payrun: jpRun.id, reason: 'Wrong prefecture for one person' }, PAYPIN);
  jpReplacement = v.replacement;
  eq([v.voided.status, v.replacement.status, v.replacement.replaces], ['void', 'draft', jpRun.id], 'voided; a linked draft replaces it');
  eq((await api.op('loans.get', { loan: loan.id }, O)).loan.balance_minor, 120000, 'void reverses the repayment');
  const st2 = await expenseState();
  eq([st2.claim, st2.payout, st2.recover], [['approved', ''], ['approved', '', 0], ['paid', 30000, []]], 'void: Expenses takes the claim, the advance and the recovery back (lib_expenses.unmarkPaid)');
  const vs = await api.op('payruns.get', { payrun: jpRun.id }, O);
  ok(vs.payslips.length === before.payslips.length && vs.payslips.every((s) => s.status === 'void'), 'the void run keeps every payslip (status void)');
  await calcRun(api, jpReplacement.id);
  const after = await api.op('payruns.get', { payrun: jpReplacement.id }, O);
  eq([after.payrun.net_minor, after.payrun.employee_count], [before.payrun.net_minor, before.payrun.employee_count], 'the replacement calculates to the same totals');
  const h2 = byCode(await slip(jpReplacement.id, 'E0016'));
  const y2 = byCode(await slip(jpReplacement.id, 'E0017'));
  eq([h2.REIMB, h2.ADVANCE, y2.ADV_RECOVERY], [12000, 50000, 30000], 'the replacement pays the claim and the advance and recovers the advance once each (no copies)');
}

section('Salary hold: held pay stays out of the payout until released');
{
  let hold = await api.op('holds.hold', { payrun: jpReplacement.id, employment: P.E0017.employment, reason: 'Missing documents' }, PAY);
  eq(hold.hold.status, 'held', 'Yui\'s pay held');
  {
    const g = (await api.op('payruns.get', { payrun: jpReplacement.id }, O)).payrun;
    const yui = (await api.op('payruns.get', { payrun: jpReplacement.id }, O)).payslips.find((x) => x.number === 'E0017');
    eq([g.held_count, g.held_minor, g.to_pay_minor, g.to_pay_count], [1, yui.net_minor, g.net_minor - yui.net_minor, g.employee_count - 1], 'the run reconciles: net less Yui\'s held pay is what it pays, for one person fewer');
  }
  {
    // A held person's missing bank account waits for the release; it does not block the run.
    const yuiEmp = (await api.op('people.directory', { q: 'E0017', status: 'all' }, O)).people.find((x) => x.number === 'E0017');
    const banks = (await api.op('bank.list', { employee: yuiEmp.employee }, O)).accounts || [];
    const iss0 = await api.op('payruns.issues', { payrun: jpReplacement.id }, O);
    ok(iss0.issues.filter((i) => i.employment === P.E0017.employment && i.severity === 'blocker').every((i) => ['bank_missing', 'bank_currency_mismatch'].indexOf(i.code) < 0), 'no bank blocker for the held person (' + banks.length + ' accounts)');
  }
  {
    // The approver is asked to approve what the run pays: held pay apart (QA2 PC5).
    const g = (await api.op('payruns.get', { payrun: jpReplacement.id }, O)).payrun;
    const iss = await api.op('payruns.issues', { payrun: jpReplacement.id }, O);
    if (iss.issues.some((i) => i.severity === 'warning')) await api.op('payruns.acknowledge', { payrun: jpReplacement.id, reason: 'reviewed_ok' }, PAY);
    const sub = await api.op('payruns.submit', { payrun: jpReplacement.id }, PAY);
    const a = (await api.op('approvals.get', { approval: sub.approval.id }, O)).approval;
    const fact = (k) => (a.facts || []).find((f) => f.key === k);
    eq([a.amount_minor, fact('to_pay') && fact('to_pay').amount_minor, fact('held') && fact('held').amount_minor, fact('people') && fact('people').value], [g.to_pay_minor, g.to_pay_minor, g.held_minor, g.to_pay_count], 'the approval asks for net to pay without the held pay, held shown apart');
    await api.op('holds.cancel', { hold: hold.hold.id }, PAY).catch(() => null);
    const after = (await api.op('payruns.get', { payrun: jpReplacement.id }, O)).payrun;
    eq([after.status, after.approval], ['calculated', ''], 'taking a hold off after it was sent for approval asks for approval again');
    hold = await api.op('holds.hold', { payrun: jpReplacement.id, employment: P.E0017.employment, reason: 'Missing documents' }, PAY);
  }
  await approveAndLock(jpReplacement.id);
  const pay = await api.op('testpay.payout', { payrun: jpReplacement.id }, O);
  ok(!pay.items.some((x) => x.employment === P.E0017.employment) && pay.items.length > 0, 'the payout leaves the held payslip out');
  const list = await api.op('holds.list', {}, O);
  const h = list.holds.find((x) => x.id === hold.hold.id);
  ok(h && h.amount_minor > 0, 'the hold records the net held (' + (h && h.amount_minor) + ')');
  const dec = await runFor('Northwind KK');
  await refuses(api, 'holds.release', { hold: hold.hold.id, via: 'payrun', into: dec.id }, AG, 403, 'agent_not_permitted', 'your AI agent cannot release held pay');
  const rel = await api.op('holds.release', { hold: hold.hold.id, via: 'payrun', into: dec.id }, PAYPIN);
  eq(rel.hold.status, 'released', 'released into December with the PIN');
  const pay2 = await api.op('testpay.payout', { payrun: dec.id }, O);
  ok(pay2.items.some((x) => x.kind === 'hold_release' && x.amount_minor === h.amount_minor), 'December\'s payout carries the released pay');
  eq((await api.op('loans.get', { loan: loan.id }, O)).loan.balance_minor, 110000, 'the replacement\'s lock posts the installment once');
  const st3 = await expenseState();
  eq([st3.claim, st3.payout, st3.recover], [['paid', jpReplacement.id], ['paid', jpReplacement.id, 50000], ['settled', 0, [jpReplacement.id]]], 're-lock: claim, advance and recovery each paid exactly once, by the replacement');
  const decRun = (await api.op('payruns.list', { entity: P.E0016.entity, status: 'open' }, O)).payruns.find((r) => r.kind === 'regular' && r.period_start === '2026-12-01');
  if (decRun) {
    await calcRun(api, decRun.id);
    const hd = byCode(await slip(decRun.id, 'E0016'));
    const yd = byCode(await slip(decRun.id, 'E0017'));
    eq([hd.REIMB || 0, hd.ADVANCE || 0, yd.ADV_RECOVERY || 0], [0, 0, 0], 'December pays none of them again');
  }
}

section('Pay runs: plain names, every status, plain issues');
{
  const all = (await api.op('payruns.list', { status: 'all', limit: 200 }, O)).payruns;
  const none = (await api.op('payruns.list', { limit: 200 }, O)).payruns;
  ok(all.length > 3 && all.length === none.length && new Set(all.map((r) => r.status)).size > 2, 'payruns.list --status all returns every run (' + all.length + ', ' + [...new Set(all.map((r) => r.status))].join(' ') + ')');
  await refuses(api, 'payruns.list', { status: 'everything' }, O, 400, 'invalid_param', 'an unknown status is refused, not an empty list');
  const nov = all.find((r) => r.kind === 'regular' && r.period_start === '2026-11-01');
  eq(nov.label, 'November 2026', 'a regular run is named by its month in words');
  // A missing birth date: the engine's step error becomes a plain "add the birth date" with the Fix on the person.
  const sgDec = await runFor('Northwind Pte Ltd');
  const priya = P.E0002;
  const born = (await api.op('people.get', { employee: priya.employee }, O)).employee.birth_date;
  await api.op('people.update', { employee: priya.employee, birth_date: '' }, O);
  await calcRun(api, sgDec.id);
  const iss = (await api.op('payruns.issues', { payrun: sgDec.id }, O)).issues.filter((i) => i.employment === priya.employment);
  const dm = iss.find((i) => i.code === 'data_missing');
  ok(dm !== undefined && dm.field === 'birth_date' && dm.scope === 'employee' && dm.message.indexOf('birth date') >= 0 && dm.fix.link.indexOf('tab=personal') >= 0 && typeof dm.detail === 'string', 'no birth date: data_missing "' + (dm ? dm.message : '') + '" with the Fix on the person', iss.map((i) => i.code + ' ' + i.message));
  ok(!iss.some((i) => i.code === 'step_error'), 'no raw engine step error is shown');
  ok(!iss.some((i) => (i.message || '').indexOf(priya.name) >= 0), 'messages do not repeat the name of the person');
  // Payroll may not change a person: the issue goes to HR as an Inbox item, once (QA2 N4).
  const ask1 = await api.op('payruns.ask-fix', { payrun: sgDec.id, employment: priya.employment, code: 'data_missing', scope: 'employee', field: 'birth_date', field_label: 'birth date', message: dm ? dm.message : '' }, PAY);
  const ask2 = await api.op('payruns.ask-fix', { payrun: sgDec.id, employment: priya.employment, code: 'data_missing', scope: 'employee', field: 'birth_date', field_label: 'birth date', message: dm ? dm.message : '' }, PAY);
  ok(ask1.routed_to === 'hr_admin' && ask1.sent > 0 && ask2.already === true, 'asking for the birth date reaches the HR Inbox once (' + ask1.sent + ' sent, then already sent)');
  const hrN = await api.op('notifications.list', {}, { as: 'hr@northwind.test' });
  ok((hrN.notifications || []).some((n) => n.title.indexOf('birth date') >= 0 && n.link.indexOf('tab=personal') >= 0), 'HR sees it with a link to the personal details');
  await api.op('people.update', { employee: priya.employee, birth_date: born }, O);
  await api.op('payruns.delete', { payrun: sgDec.id }, O);
  // A pay change before the first day of work is refused in plain words, with the day as data (QA2 N5).
  const early = await api.call('comp.request', { employment: priya.employment, amount: '9000.00', per: 'month', effective_from: '2000-01-01', reason: 'raise' }, PAY);
  ok(early.status === 400 && early.body.code === 'before_start' && typeof early.body.data.start_day === 'string' && early.body.message.indexOf('effective_from') < 0, 'a pay change before the first day: before_start, no field name in the words (' + early.body.message + ')');
}

section('United States: November locked, then an off-cycle bonus at the supplemental rate');
const usRun = await runFor('Northwind Inc');
await calcRun(api, usRun.id);
await approveAndLock(usRun.id);
{
  const b = (await api.op('payruns.create', { kind: 'bonus', entity: 'Northwind Inc', employments: [P.E0010.employment], pay_date: '2026-12-04', label: 'Q3 bonus' }, O)).payrun;
  await api.op('pay-inputs.add', { employment: P.E0010.employment, component: 'US_BONUS', amount: '5000.00', payrun: b.id }, O);
  await calcRun(api, b.id);
  const e = byCode(await slip(b.id, 'E0010'));
  // Publication 15 (2026) section 7: supplemental wages identified separately, flat 22% (under 1M).
  // FICA 6.2% and 1.45%; CA DE 44: bonus 10.23%; SDI 1.3%. FUTA and CA UI: November already used the 7,000 base.
  eq([e.US_BONUS, e.US_FIT_SUPP, e.US_FIT || 0, e.US_SS_EE, e.US_MED_EE, e.US_CA_SIT, e.US_CA_SDI], [500000, cents(5000 * 0.22), 0, cents(5000 * 0.062), cents(5000 * 0.0145), cents(5000 * 0.1023), cents(5000 * 0.013)], 'Emily bonus 5,000: FIT 22% 1,100.00, SS 310.00, Medicare 72.50, CA 511.50, SDI 65.00');
  eq([e.US_FUTA || 0, e.US_CA_UI || 0], [0, 0], 'no FUTA or CA UI: the year\'s 7,000 base was used in November');
}

section('Time: a day changed after the lock is paid in the next run, one line a day');
{
  // The US November lock locked the days up to today (the cutoff is later). Grace, paid by the hour,
  // clocks in and out today anyway: the day now has no worked hours, so December takes them back.
  const grace = dir.people.find((x) => x.name === 'Grace Kim');
  const inv = await api.op('members.invite', { email: 'grace@northwind.test', name: 'Grace Kim', role: 'employee', employee: grace.employee }, PIN);
  const joined = await api.op('auth.accept-invite', { email: 'grace@northwind.test', code: inv.code, password: DEMO.password });
  api.setToken('grace@northwind.test', joined.token);
  const GR = { as: 'grace@northwind.test' };
  const pin = await api.call('clock.punch', { kind: 'in' }, GR);
  const pout = await api.call('clock.punch', { kind: 'out' }, GR);
  ok(pin.status === 200 && pout.status === 200, 'punches on a day a locked run paid are taken (' + pin.status + ', ' + pout.status + ')', [pin.body, pout.body]);
  const tp = await api.op('time.pay-inputs', { employment: grace.employment, from: '2026-12-01', to: '2026-12-31' }, O);
  const adj = tp.adjustments || [];
  ok(adj.length > 0, 'Time lists the change as adjustments (' + adj.map((x) => x.day + ' ' + x.component + ' ' + x.minutes).join(', ') + ')', tp);
  const dec = await runFor('Northwind Inc');
  await calcRun(api, dec.id);
  const ps = await slip(dec.id, grace.number);
  const lines = [];
  for (const g of ps.groups) for (const l of g.lines) if (l.explain && l.explain.source === 'time_adjustment') lines.push(l);
  // Paid by the hour: regular minutes, overtime and premiums are paid; lateness changes no pay.
  const payable = adj.filter((x) => x.component !== 'late' && (x.component === 'absent' ? false : x.minutes !== 0));
  eq(lines.length, payable.length, 'December pays each difference as its own line (' + lines.map((l) => l.name + ' ' + l.amount_minor).join('; ') + ')');
  const reg = adj.filter((x) => x.component === 'regular').reduce((a, x) => a + x.minutes, 0);
  const regLine = lines.filter((l) => l.explain.component === 'regular').reduce((a, l) => a + l.amount_minor, 0);
  eq(regLine, Math.round((reg / 60) * 3250), 'regular hours at 32.50 an hour (' + reg + ' minutes)');
  ok(lines.length > 0 && lines.every((l) => /adjustment, \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(l.name) && typeof l.explain.reason === 'string' && l.explain.reason !== '' && typeof l.explain.day === 'string'), 'each line names the day and carries the reason');
  await api.op('payruns.delete', { payrun: dec.id }, O);
}

section('Final pay: salary to the last day and leave encashment');
{
  await api.op('employments.end', { employment: P.E0011.employment, end_day: '2026-12-15', reason: 'Resigned' }, O);
  // Leave (the real module): an encashable paid type, 5 days on the balance, a cash-in paid on the last day.
  const types = (await api.op('leave.types', { entity: P.E0011.entity }, O)).types;
  const paidType = types.find((x) => x.encashable) || types.find((x) => x.paid && x.unit === 'day');
  if (!paidType.encashable) await api.op('leave.types-save', { type: paidType.id, encashable: true }, O);
  await api.op('leave.adjust', { employment: P.E0011.employment, type: paidType.code, amount: 5, reason: 'Opening balance' }, O);
  const enc = await api.op('leave.encash-request', { employment: P.E0011.employment, type: paidType.code, days: 5, pay_on: '2026-12-15', reason: 'Final pay' }, O);
  for (let i = 0; i < 3; i++) {
    const a = await api.op('approvals.get', { approval: enc.approval.id }, O);
    if (a.approval.status !== 'pending') break;
    await decideAny(api, enc.approval.id, 'approved');
  }
  const t = (await api.op('payruns.create', { kind: 'termination', employment: P.E0011.employment }, O)).payrun;
  eq([t.period_start, t.period_end, t.pay_date], ['2026-12-01', '2026-12-31', '2026-12-15'], 'final pay run for December, paid on the last day');
  await calcRun(api, t.id);
  const m = byCode(await slip(t.id, 'E0011'));
  // 95,000 / 12 = 7,916.67 a month; December 2026 in California has 22 working days
  // (Christmas on Friday 25th); employed 1 to 15 December = 11 working days.
  // Salary 791,666.67 x 11 / 22 = 395,833 cents. Leave at the final rate of pay (CA Labor Code 227.3):
  // 95,000 / (52 x 5) = 365.38 a day, whatever the month's working days; 5 days = 182,692 cents.
  eq([m.US_SALARY, m.LEAVE_ENCASH], [395833, 182692], 'salary 3,958.33 for 11 of 22 working days; 5 days of leave at 365.38 (95,000 / 260) = 1,826.92');
  const usDec = await runFor('Northwind Inc');
  await calcRun(api, usDec.id);
  const decRows = (await api.op('payruns.get', { payrun: usDec.id }, O)).payslips;
  ok(!decRows.some((x) => x.number === 'E0011'), 'December\'s regular run leaves the leaver to the final pay run');
  await approveAndLock(t.id);
  const encs = await api.op('leave.encashments', { employment: P.E0011.employment, status: 'paid' }, O);
  ok((encs.encashments || encs.requests || []).some((x) => x.id === enc.encash.id), 'lock marks the cash-in paid (lib_leave.markEncashPaid)', encs);
}

section('Final pay follows the last day when it moves');
{
  const who = dir.people.find((x) => x.entity_name === 'Northwind Inc' && /Jordan/.test(x.name));
  const sep = await api.op('separations.request', { employment: who.employment, kind: 'resignation', last_day: '2026-12-11', reason: 'Moving abroad' }, O);
  const sid = sep.separation.id;
  eq(await decideAll(sep.separation.approval), 'approved', who.name + ' resigns, last day 11 Dec, approved');
  const findFinal = async () => {
    for (const r of (await api.op('payruns.list', { status: 'all', kind: 'termination', limit: 100 }, O)).payruns) {
      const g = (await api.op('payruns.get', { payrun: r.id }, O)).payrun;
      if ((g.scope.employments || []).indexOf(who.employment) >= 0 && g.status !== 'void') return g;
    }
    return null;
  };
  const f1 = await findFinal();
  eq(f1 ? [f1.period_start, f1.pay_date, f1.status] : null, ['2026-12-01', '2026-12-11', 'draft'], 'the approval drafts the final pay run for December');
  await api.op('separations.update', { separation: sid, last_day: '2027-01-08' }, O);
  const f2 = await findFinal();
  eq(f2 ? [f2.id, f2.period_start, f2.period_end, f2.pay_date, f2.status] : null, [f1 ? f1.id : '', '2027-01-01', '2027-01-31', '2027-01-08', 'draft'], 'the last day moves to 8 Jan: the same final pay run moves to January (separation.changed)');
  // Unused PTO is paid out on leaving in California: leave's exit cash-in lands on the final pay at the final rate of pay.
  const exits = ((await api.op('leave.encashments', { employment: who.employment, status: 'all' }, O)).encashments || []).filter((x) => x.kind === 'exit' && x.status === 'approved');
  ok(exits.length > 0 && exits.every((x) => x.pay_on === '2027-01-08'), 'leave made the exit cash-in for the last day (' + exits.map((x) => x.type + ' ' + x.days + ' on ' + x.pay_on).join(', ') + ')', exits);
  await calcRun(api, f2.id);
  const fs = await slip(f2.id, who.number);
  const enc = [];
  for (const g of fs.groups) for (const l of g.lines) if (l.code === 'LEAVE_EXIT') enc.push(l);
  const rec = (await api.op('pay.history', { employment: who.employment }, O)).records.find((x) => x.state === 'current');
  const annual = rec.per === 'year' ? rec.amount_minor : rec.amount_minor * 12;
  const want = exits.reduce((a, x) => a + Math.round(x.days * (annual / 260)), 0);
  eq(enc.reduce((a, l) => a + l.amount_minor, 0), want, 'the payout is on LEAVE_EXIT: the days times annual pay / 260 (' + exits.map((x) => x.days).join(' + ') + ' days)');
  ok(!(fs.issues || []).some((i) => i.code === 'leaver_leave_unpaid'), 'nothing payable is left unpaid, so no warning');
  // A type switched to paid out after the separation: either leave pays it out too, or the final pay warns.
  const types = (await api.op('leave.types', { entity: who.entity }, O)).types;
  const ty = types.find((x) => !x.payout_on_exit && x.paid && !x.archived);
  await api.op('leave.adjust', { employment: who.employment, type: ty.code, amount: ty.unit === 'hour' ? 16 : 2, reason: 'Carried over' }, O);
  await api.op('leave.types-save', { type: ty.id, payout_on_exit: true }, O);
  await calcRun(api, f2.id);
  const s2 = await slip(f2.id, who.number);
  const warned = (s2.issues || []).find((i) => i.code === 'leaver_leave_unpaid' && i.type === ty.code) || null;
  const paidToo = ((await api.op('leave.encashments', { employment: who.employment, status: 'all' }, O)).encashments || []).some((x) => x.kind === 'exit' && x.type === ty.code && x.status === 'approved');
  ok(paidToo ? warned === null : warned !== null, ty.code + ' switched to paid out after the separation: ' + (paidToo ? 'leave pays it out too, no warning' : 'no payout line, so leaver_leave_unpaid (' + (warned ? warned.message : '') + ')'));
  await api.op('leave.types-save', { type: ty.id, payout_on_exit: false }, O);
}

section('Correction run after payment: difference lines only');
{
  await refuses(api, 'payruns.create', { kind: 'correction', corrects: jpReplacement.id, employments: [P.E0016.employment] }, O, 409, 'not_paid', 'a locked, unpaid run is voided, not corrected');
  await api.op('testpay.mark-paid', { payrun: sgRun.id, paid_at: '2026-11-30' }, PAY);
  const c = (await api.op('payruns.create', { kind: 'correction', corrects: sgRun.id, employments: [P.E0003.employment], pay_date: '2026-12-05' }, O)).payrun;
  await api.op('pay-inputs.add', { employment: P.E0003.employment, component: 'SG_ALLOWANCE', amount: '200.00', payrun: c.id, note: 'Missed November allowance' }, O);
  await calcRun(api, c.id);
  const d = await slip(c.id, 'E0003');
  const lines = byCode(d);
  // Daniel 7,200: OW 7,400 instead of 7,200: CPF total 37% (2,738 - 2,664 = 74), employee 20% (1,480 - 1,440 = 40), employer 34; SDL capped both times.
  eq(lines, { SG_ALLOWANCE: 20000, SG_CPF_EE: 4000, SG_CPF_ER: 3400, SG_CPF_OW: 20000 }, 'only the differences: allowance +200, CPF employee +40, employer +34');
  eq(d.net_minor, 16000, 'net difference 160.00');
}

section('Back pay for a raise back-dated into a locked period');
{
  const req = await api.op('comp.request', { employment: P.E0016.employment, effective_from: '2026-11-01', amount: '560000', reason: 'raise', note: 'Annual review' }, PAY);
  ok(req.request.retro === true, 'the request knows it reaches into a locked period');
  await decideAny(api, req.approval.id, 'approved');
  const comp = await api.op('comp.list', { employment: P.E0016.employment }, O);
  ok(comp.requests[0].status === 'approved' && comp.requests[0].backpay === 'suggested', 'approved: pay record written, back pay suggested');
  const prev = await api.op('backpay.preview', { employment: P.E0016.employment, from_day: '2026-11-01' }, O);
  eq([prev.periods.length, prev.total_minor], [1, 40000], 'one locked period, 40,000 yen more base pay');
  const app = await api.op('backpay.apply', { employment: P.E0016.employment, from_day: '2026-11-01', target: 'next' }, O);
  eq(app.added, 1, 'one ARREARS input for the next run');
  const dec = await runFor('Northwind KK');
  await calcRun(api, dec.id);
  const h = byCode(await slip(dec.id, 'E0016'));
  eq([h.JP_BASE, h.ARREARS], [560000, 40000], 'December pays the new base and the back pay');
  const v = await api.op('payruns.variance', { payrun: dec.id }, O);
  const hv = v.by_employee.find((x) => x.employment === P.E0016.employment);
  ok(hv && hv.reasons.indexOf('raise') >= 0 && hv.reasons.indexOf('bonus') >= 0, 'variance names the raise and the back pay', hv);
  ok(v.by_component.some((x) => x.code === 'ARREARS' && x.added), 'components: ARREARS added against last run');
}

section('India: an old regime declaration changes TDS after approval');
{
  const d = await api.op('declarations.save', { employment: P.E0021.employment, regime: 'old', items: [{ section: '80C', amount: '100000', description: 'PPF' }] }, { as: 'ananya@northwind.test' });
  const sub = await api.op('declarations.submit', { declaration: d.declaration.id }, { as: 'ananya@northwind.test' });
  eq(sub.declaration.status, 'submitted', 'Ananya submits her declaration');
  await decideAny(api, sub.approval.id, 'approved');
  const tp = await api.op('taxprofile.get', { employment: P.E0021.employment }, O);
  eq([tp.values.in_regime, tp.values.in_80c_annual], ['old', 100000], 'approved: tax profile fields from today');
  const inRun = await runFor('Northwind India Pvt Ltd');
  await calcRun(api, inRun.id);
  const a = byCode(await slip(inRun.id, 'E0021'));
  // Old regime (tax year 2026-27): the year's salary is the demo's locked October payslip plus November
  // x 5 months to March, less 50,000 standard and 1,00,000 80C; tax 5% of 2.5 to 5 lakh, 20% of 5 to 10
  // lakh (no rebate above 5 lakh), cess 4%; less October's TDS, spread over the 5 months left.
  const oct = (await api.op('payslips.recent', { employment: P.E0021.employment, limit: 5 }, O)).payslips.find((x) => x.period_start === '2026-10-01');
  const octFull = (await api.op('payslips.get', { payslip: oct.id }, O)).payslip;
  const octSlip = byCode(octFull);
  const income = octFull.gross_minor / 100 + 140000 * 5 - 50000 - 100000;
  const oldTax = (Math.min(income, 500000) - 250000) * 0.05 + Math.max(0, Math.min(income, 1000000) - 500000) * 0.2 + Math.max(0, income - 1000000) * 0.3;
  const want = Math.round((oldTax * 1.04 - (octSlip.IN_TDS || 0) / 100) / 5) * 100;
  // The pack's exact figure is packs-asia's (its own vectors); the hand estimate holds it within 2%.
  ok(a.IN_TDS > 0 && Math.abs(a.IN_TDS - want) <= want * 0.02, 'Ananya TDS under the old regime: ' + (a.IN_TDS / 100) + ' a month, hand estimate ' + want / 100 + ' (October gross ' + octFull.gross_minor / 100 + ' plus 140,000 x 5)');
}

section('Tax profile self-service: the employee asks, payroll approves');
{
  const tp = await api.op('taxprofile.get', { employment: P.E0005.employment }, { as: SAM });
  ok(tp.fields.some((f) => f.key === 'sg_shg') && tp.can.submit && !tp.can.edit, 'Sam sees his form (CPF residency, self-help group) and may submit');
  const sub = await api.op('taxprofile.submit', { employment: P.E0005.employment, fields: { sg_shg: 'cdac' }, effective_from: '2026-12-01' }, { as: SAM });
  ok(sub.applied === false && sub.approval && sub.approval.kind === 'tax_declaration', 'his change waits for payroll');
  await refuses(api, 'taxprofile.submit', { employment: P.E0005.employment, fields: { sg_shg: 'nope' } }, { as: SAM }, 400, 'invalid_field', 'a value outside the field options is refused');
  await decideAny(api, sub.approval.id, 'approved');
  const after = await api.op('taxprofile.get', { employment: P.E0005.employment, as_of: '2026-12-01' }, O);
  eq(after.values.sg_shg, 'cdac', 'approved: CDAC from 1 December');
  const direct = await api.op('taxprofile.submit', { employment: P.E0003.employment, fields: { sg_shg: 'cdac' } }, PAY);
  ok(direct.applied === true, 'payroll changes apply at once');
}

section('Your AI agent: allowed, proposed and denied');
{
  const p1 = await api.call('pay-inputs.add', { employment: P.E0005.employment, component: 'SG_BONUS', amount: '100.00', why: 'Asked by HR' }, AG);
  ok(p1.status === 200 && p1.body.proposal, 'pay-inputs.add becomes a proposal', p1.body);
  const p2 = await api.call('comp.request', { employment: P.E0005.employment, amount: '8000.00', reason: 'raise' }, AG);
  ok(p2.status === 200 && p2.body.proposal, 'comp.request becomes a proposal');
  const run = await runFor('Northwind India Pvt Ltd');
  const c = await api.call('payruns.calculate', { payrun: run.id }, AG);
  ok(c.status === 200, 'your AI agent may calculate a run');
  const n = await api.call('payruns.note', { payrun: run.id, kind: 'flag', code: 'tds_jump', severity: 'warning', body: 'TDS rose for one person.' }, AG);
  ok(n.status === 200 && n.body.note.who === 'Your AI agent', 'it writes flags on the run');
  const j = await api.call('payruns.review', { payrun: run.id }, AG);
  ok(j.status === 200 && j.body.agent.trigger === 'payrun_review' && j.body.agent.record === run.id, 'a review is asked (payrun_review with the run)', j.body);
  for (const name of ['payruns.lock', 'payruns.void', 'payruns.acknowledge', 'payruns.reopen', 'holds.release', 'loans.write-off', 'declarations.submit', 'payruns.publish']) {
    const r = await api.call(name, { payrun: run.id, hold: 'x', loan: 'x', declaration: 'x', reason: 'reviewed_ok' }, AG);
    ok(r.status === 403 && r.body.code === 'agent_not_permitted', name + ' is refused to your AI agent');
  }
}

section('Employees and managers stay in their lane');
{
  await refuses(api, 'payruns.list', {}, { as: SAM }, 403, 'not_permitted', 'an employee cannot list pay runs');
  await refuses(api, 'pay-inputs.add', { employment: P.E0005.employment, component: 'SG_BONUS', amount: '1.00' }, { as: SAM }, 403, 'not_permitted', 'an employee cannot add pay inputs');
  await refuses(api, 'comp.list', { employment: P.E0002.employment }, { as: SAM }, 403, 'not_permitted', 'an employee cannot see another person\'s pay');
  await refuses(api, 'taxprofile.get', { employment: P.E0002.employment }, { as: SAM }, 403, 'not_permitted', 'nor their tax profile');
  const mine = await api.op('loans.list', {}, { as: 'haruto@northwind.test' });
  ok(mine.loans.length === 1 && mine.loans[0].employment === P.E0016.employment, 'Haruto sees his own loan');
  const facts = await api.op('people.get', { employee: 'E0005' }, { as: SAM });
  const pf = (facts.facts || []).find((f) => f.module === 'payroll');
  ok(pf && pf.facts.some((x) => x.key === 'next_pay_day') && pf.facts.some((x) => x.key === 'last_net'), 'profile facts: next pay day and last net pay for Sam himself');
  const recent = await api.op('payslips.recent', { employment: P.E0005.employment }, { as: SAM });
  ok(recent.payslips.some((x) => x.pay_date === sgRun.pay_date), 'payslips.recent shows his November payslip (with October)');
}

const s = summary('t03_flows');
process.exitCode = s.failed > 0 ? 1 : 0;
