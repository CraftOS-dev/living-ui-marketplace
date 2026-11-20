// t02: leave flows on the Northwind demo (tools/dev/seed_demo.mjs on an empty
// scratch database). Requests, approvals, withdraw and cancel, overrides,
// locks, half days and hours, compensatory leave, cashing in, permissions,
// your AI agent's deny and propose paths, the payroll contract and the cron.
//   reset; serve 3184; node tools/dev/seed_demo.mjs --port 3184 --app <app>; node tests/t02_flows.mjs
import { api, ok, eq, near, done, section, expectStatus } from './lib.mjs';

const SAM = 'sam@northwind.test';
const MEI = 'eng.lead@northwind.test';
const HR = 'hr@northwind.test';
const HARUTO = 'haruto@northwind.test';
const ANANYA = 'ananya@northwind.test';
const PAY = 'payroll@northwind.test';
const PIN = { pin: true };
const tr = async (fn, body) => {
  const res = await fetch(api.base + '/api/leave-test/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', 'X-A2App-Token': (await import('node:fs')).readFileSync(api.app + '/.agent-token', 'utf8').trim() }, body: JSON.stringify(body || {}) });
  const j = await res.json();
  if (res.status !== 200) throw new Error(fn + ': ' + JSON.stringify(j));
  return j.out;
};

const me = await api.op('auth.me', {}, { as: 'owner' });
const today = me.today;
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const wd = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
let mon = addDays(today, 30);
while (wd(mon) !== 1) mon = addDays(mon, 1);
console.log('today ' + today + ', test week from ' + mon);

const samEmp = (await api.op('people.get', { employee: 'E0005' }, { as: 'owner' })).primary_employment;
const harutoEmp = (await api.op('people.get', { employee: 'E0016' }, { as: 'owner' })).primary_employment;
const ananyaEmp = (await api.op('people.get', { employee: 'E0021' }, { as: 'owner' })).primary_employment;
const nurulEmp = (await api.op('people.get', { employee: 'E0006' }, { as: 'owner' })).primary_employment;
const bal = async (emp, type, as) => (await api.op('leave.balance', { employment: emp, type }, { as: as || 'owner' })).available;

section('everyone follows a policy from day one');
const assigned = await api.op('leave.assignments', { employment: 'E0005' }, { as: 'owner' });
ok(assigned.assignments.length === 1 && assigned.assignments[0].effective_from === '2023-02-01', 'Sam follows the SG default from his first day', assigned);
const samBefore = await bal(samEmp, 'annual');
near(samBefore, 14, 'Sam has 9 days for 2026 plus 5 carried over');
const ledgerSum = await tr('ledgerSum', { employment: samEmp, type: (await api.op('leave.balance', { employment: samEmp, type: 'annual' }, { as: 'owner' })).type_id, day: today });
near(ledgerSum.n, samBefore, 'the ledger rows sum to the balance (the hire wrote them)');

section('Sam requests four days; his manager approves');
const chk = await api.op('leave.check', { type: 'annual', start: mon, end: addDays(mon, 3) }, { as: SAM });
const hols = chk.holidays.filter((h) => !h.half).length;
eq(chk.days, 4 - hols, 'four working days less holidays');
near(chk.before, 14, 'before');
near(chk.after, 14 - chk.days, 'after');
ok(chk.can_submit === true, 'can submit', chk.warnings);
const req1 = await api.op('leave.request', { type: 'annual', start: mon, end: addDays(mon, 3), reason: 'Family visit' }, { as: SAM });
eq(req1.request.status, 'pending', 'pending');
ok(req1.approval && req1.approval.kind === 'leave_request', 'approval opened', req1.approval);
const meiInbox = await api.op('approvals.list', {}, { as: MEI });
const ap1 = meiInbox.approvals.find((a) => a.ref_id === req1.request.id);
ok(ap1 !== undefined, 'in the manager inbox');
const ctx1 = await api.op('leave.approval-context', { approval: ap1.id }, { as: MEI });
near(ctx1.balance.before, 14, 'context: before');
near(ctx1.balance.after, 14 - chk.days, 'context: after');
await expectStatus(api.call('approvals.decide', { approval: ap1.id, decision: 'approved' }, { as: SAM }), 403, 'Sam cannot approve his own');
await expectStatus(api.call('approvals.decide', { approval: ap1.id, decision: 'approved' }, { as: 'agent' }), 403, 'your AI agent cannot approve');
await api.op('approvals.decide', { approval: ap1.id, decision: 'approved', note: 'Enjoy' }, { as: MEI });
const got1 = await api.op('leave.get', { request: req1.request.id }, { as: SAM });
eq(got1.request.status, 'approved', 'approved');
near(await bal(samEmp, 'annual', SAM), 14 - chk.days, 'balance after approval');
const samB = await api.op('leave.balance', { employment: samEmp, type: 'annual' }, { as: SAM });
near(samB.booked, chk.days, 'booked future leave');
ok(samB.explain.length > 0, 'explanation lines', samB.explain);

section('overlap, half days, withdraw');
await expectStatus(api.call('leave.request', { type: 'annual', start: addDays(mon, 1), end: addDays(mon, 1) }, { as: SAM }), 409, 'overlap refused', 'overlap');
const half = await api.op('leave.request', { type: 'annual', start: addDays(mon, 7), start_half: 'pm' }, { as: SAM });
near(half.request.days, 0.5, 'half day');
const pm2 = await api.op('leave.check', { type: 'sick', start: addDays(mon, 7), start_half: 'am' }, { as: SAM });
ok(pm2.warnings.every((w) => w.code !== 'overlap'), 'the other half of the day is free', pm2.warnings);
const wd1 = await api.op('leave.withdraw', { request: half.request.id }, { as: SAM });
eq(wd1.request.status, 'withdrawn', 'withdrawn');
const apHalf = await api.op('approvals.get', { approval: half.request.approval }, { as: MEI });
eq(apHalf.approval.status, 'cancelled', 'its approval is cancelled');

section('balance, override, notice, locks');
// More working days than Sam has left whatever the day of the run: from next week up to the Monday of his
// four days (at least three weeks), all before them (the stretch to the year end shrinks as the year goes on).
const bigFrom = addDays(today, 7);
const bigTo = addDays(mon, -1);
const big = await api.call('leave.request', { type: 'annual', start: bigFrom, end: bigTo }, { as: SAM });
ok(big.status === 409 && big.body.code === 'balance', 'Sam cannot take more than he has', big.body);
ok(big.body.data.can_override === false, 'Sam cannot override');
const over = await api.call('leave.request', { employment: samEmp, type: 'annual', start: bigFrom, end: bigTo, override: true }, { as: MEI });
ok(over.status === 400 && over.body.code === 'missing_param', 'override needs a reason', over.body);
const over2 = await api.op('leave.request', { employment: samEmp, type: 'annual', start: bigFrom, end: bigTo, override: true, reason: 'Agreed advance from next year' }, { as: MEI });
ok(over2.request.warnings.some((w) => w.code === 'balance' && w.overridden), 'manager went past the balance with a reason', over2.request.warnings);
const overAp = await api.op('approvals.get', { approval: over2.request.approval }, { as: 'owner' });
ok(!overAp.approval.approvers.includes((await api.op('auth.me', {}, { as: MEI })).member.id), 'the manager who asked does not approve it', overAp.approval.approvers);
await api.op('leave.withdraw', { request: over2.request.id }, { as: MEI });
const annualType = (await api.op('leave.types', {}, { as: HR })).types.find((t) => t.code === 'annual' && t.country === 'SG');
await api.op('leave.types-save', { type: annualType.id, min_notice_days: 7 }, { as: HR });
// The first working day within the week (a weekend or holiday has nothing to take).
let late = null;
for (let k = 1; k <= 6 && (late === null || late.body.code === 'no_days'); k++) late = await api.call('leave.request', { type: 'annual', start: addDays(today, k), end: addDays(today, k) }, { as: SAM });
ok(late.status === 409 && late.body.code === 'notice', 'seven days notice', late.body);
await api.op('leave.types-save', { type: annualType.id, min_notice_days: 0 }, { as: HR });
const eng = (await api.op('departments.list', {}, { as: 'owner' })).departments.find((d) => d.code === 'ENG');
const blk = await api.op('leave.block-save', { department: eng.id, from: addDays(mon, 21), to: addDays(mon, 25), reason: 'Release week', allow: ['E0006'] }, { as: HR });
const locked = await api.call('leave.request', { type: 'annual', start: addDays(mon, 22), end: addDays(mon, 22) }, { as: SAM });
ok(locked.status === 409 && locked.body.code === 'locked', 'locked days', locked.body);
const allowed = await api.op('leave.check', { employment: nurulEmp, type: 'annual', start: addDays(mon, 22), end: addDays(mon, 22) }, { as: HR });
ok(allowed.warnings.every((w) => w.code !== 'locked'), 'Nurul is allowed through', allowed.warnings);
ok(allowed.clashes.length === 0 || allowed.clashes.every((c) => c.employment !== samEmp || c.start <= addDays(mon, 22)), 'clash list makes sense');
const clash = await api.op('leave.check', { employment: nurulEmp, type: 'annual', start: mon, end: mon }, { as: HR });
ok(clash.clashes.some((c) => c.employment === samEmp && c.type === 'annual'), 'HR sees that Sam is away, with the type', clash.clashes);
const peerView = await api.op('leave.calendar', { from: mon, to: addDays(mon, 6) }, { as: SAM });
eq(peerView.mode, 'peers', 'Sam sees his colleagues');
ok(peerView.bars.filter((b) => b.employment !== samEmp).every((b) => b.type === '' && b.away_only), 'colleagues show as away only');
const teamView = await api.op('leave.calendar', { from: mon, to: addDays(mon, 6) }, { as: MEI });
eq(teamView.mode, 'team', 'Mei Lin sees her team');
ok(teamView.bars.some((b) => b.employment === samEmp && b.type === 'annual'), 'managers see the type');
await api.op('leave.block-delete', { block: blk.block.id }, { as: HR });

section('cancel: before it starts, and after');
// Sam's last working day before a day (weekends and holidays move with the run date).
const workdayBefore = async (day) => {
  for (let d = addDays(day, -1), k = 0; k < 14; d = addDays(d, -1), k++) {
    const r = await api.call('leave.check', { employment: samEmp, type: 'annual', start: d, end: d }, { as: HR });
    if (r.status === 200 && r.body.days > 0) return d;
  }
  throw new Error('no working day in the two weeks before ' + day);
};
const pastDay = await workdayBefore(await workdayBefore(today));
const startedDay = await workdayBefore(today);
const c1 = await api.op('leave.cancel', { request: req1.request.id, reason: 'Plans changed' }, { as: SAM });
ok(c1.cancelled === true && c1.request.status === 'cancelled', 'future leave is cancelled at once', c1);
near(await bal(samEmp, 'annual'), 14, 'the days came back');
const past = await api.op('leave.request', { employment: samEmp, type: 'annual', start: pastDay, end: pastDay, record: true, reason: 'Recorded by HR' }, { as: HR });
eq(past.request.status, 'approved', 'HR recorded past leave');
const c2 = await api.op('leave.cancel', { request: past.request.id }, { as: SAM });
ok(c2.cancelled === true, 'recorded leave cancels at once');
const past2 = await api.op('leave.request', { type: 'annual', start: startedDay, end: addDays(today, 2), reason: 'Short break' }, { as: SAM });
const ap2 = (await api.op('approvals.list', {}, { as: MEI })).approvals.find((a) => a.ref_id === past2.request.id);
await api.op('approvals.decide', { approval: ap2.id, decision: 'approved' }, { as: MEI });
const c3 = await api.op('leave.cancel', { request: past2.request.id, from: today, reason: 'Back early' }, { as: SAM });
ok(c3.cancelled === false && c3.request.status === 'cancelling', 'started leave: the cancellation waits for approval', c3);
const ap3 = (await api.op('approvals.list', {}, { as: MEI })).approvals.find((a) => a.ref_id === past2.request.id && a.payload.action === 'cancel');
ok(ap3 !== undefined, 'the manager has the cancellation');
await api.op('approvals.decide', { approval: ap3.id, decision: 'approved' }, { as: MEI });
const after3 = await api.op('leave.get', { request: past2.request.id }, { as: SAM });
ok(after3.request.status === 'approved' && after3.request.end === addDays(today, -1), 'shortened to the day before', after3.request);

section('hours (Japan) and compensatory leave');
const hrs = await api.op('leave.check', { type: 'annual', start: mon, hours: 2 }, { as: HARUTO });
near(hrs.days, 0.25, 'two hours of an eight-hour day');
const hreq = await api.op('leave.request', { type: 'annual', start: mon, hours: 2 }, { as: HARUTO });
eq(hreq.request.unit, 'day', 'annual is in days');
const harutoMgr = (await api.op('approvals.list', {}, { as: MEI })).approvals.find((a) => a.ref_id === hreq.request.id);
ok(harutoMgr !== undefined, 'Haruto\'s manager has it');
await api.op('approvals.decide', { approval: harutoMgr.id, decision: 'approved' }, { as: MEI });
const ob = await api.op('leave.obligation', { employment: 'E0016' }, { as: HR });
const cur = ob.rows.find((r) => r.status !== 'missed');
near(cur.taken + cur.planned, 0, 'hours do not count toward the five-day rule');
const comp = await api.op('leave.comp-off-request', { worked_day: addDays(today, -1), days: 1, reason: 'Release night' }, { as: HARUTO });
eq(comp.comp_off.status, 'pending', 'compensatory leave waits');
const apc = (await api.op('approvals.list', {}, { as: MEI })).approvals.find((a) => a.ref_id === comp.comp_off.id);
const cctx = await api.op('leave.approval-context', { approval: apc.id }, { as: MEI });
ok(cctx.worked && cctx.worked.day === addDays(today, -1), 'context shows the day worked', cctx.worked);
await api.op('approvals.decide', { approval: apc.id, decision: 'approved' }, { as: MEI });
near(await bal(harutoEmp, 'comp_off', HARUTO), 1, 'one compensatory day');
const compB = await api.op('leave.balance', { employment: harutoEmp, type: 'comp_off' }, { as: HARUTO });
ok(compB.expiring.length === 1, 'it expires', compB.expiring);
await expectStatus(api.call('leave.comp-off-request', { worked_day: addDays(today, -1), days: 1 }, { as: HARUTO }), 409, 'one per day', 'duplicate');

section('cash in leave reaches payroll');
const enc = await api.op('leave.encash-request', { type: 'annual', days: 2, reason: 'Cash for the holidays' }, { as: SAM });
const ae = (await api.op('approvals.list', {}, { as: MEI })).approvals.find((a) => a.ref_id === enc.encash.id);
await api.op('approvals.decide', { approval: ae.id, decision: 'approved' }, { as: MEI });
const ae2 = (await api.op('approvals.list', {}, { as: HR })).approvals.find((a) => a.ref_id === enc.encash.id);
ok(ae2 !== undefined, 'second step: HR');
await api.op('approvals.decide', { approval: ae2.id, decision: 'approved' }, { as: HR });
const encs = await api.op('leave.encashments', { employment: samEmp }, { as: SAM });
eq(encs.encashments[0].status, 'approved', 'approved');
const payDay = encs.encashments[0].pay_on;
const pi = await tr('payInputs', { employment: samEmp, from: payDay.slice(0, 8) + '01', to: addDays(payDay, 40) });
ok(pi.encash.length === 1 && pi.encash[0].days === 2 && pi.encash[0].type === 'annual' && pi.encash[0].kind === 'voluntary', 'payInputs.encash (a voluntary cash-in)', pi);
near(await bal(samEmp, 'annual', SAM), 14 - 2 - after3.request.days, 'cashed-in days left the balance (and the leave kept before coming back early)');
await expectStatus(api.call('leave.encash-request', { type: 'sick', days: 1 }, { as: SAM }), 400, 'sick leave is not cashed in', 'not_encashable');
eq(await tr('markEncashPaid', { ids: [enc.encash.id], payrun: 'run123' }), 1, 'payroll marks it paid');

section('unpaid leave reaches payroll');
const up = await api.op('leave.request', { employment: ananyaEmp, type: 'unpaid', start: addDays(mon, 1), end: addDays(mon, 2), record: true, reason: 'Unpaid days agreed' }, { as: HR });
const pi2 = await tr('payInputs', { employment: ananyaEmp, from: mon.slice(0, 8) + '01', to: addDays(mon, 40) });
near(pi2.unpaid_days, up.request.days, 'unpaid_days');
const pend = await api.op('leave.request', { type: 'casual', start: addDays(mon, 3), end: addDays(mon, 3) }, { as: ANANYA });
const pi3 = await tr('payInputs', { employment: ananyaEmp, from: mon.slice(0, 8) + '01', to: addDays(mon, 40) });
ok(pi3.issues.some((i) => i.code === 'leave_pending' && i.severity === 'warning'), 'a waiting request is a payroll warning', pi3.issues);
const ananyaAp = await api.op('approvals.get', { approval: pend.request.approval }, { as: 'owner' });
ok(ananyaAp.approval.approver_role === 'admin', 'no member manager: administrators approve', ananyaAp.approval);
const contract = await tr('balance', { employment: ananyaEmp, type: 'casual', day: today });
ok(['type', 'unit', 'balance', 'taken', 'pending', 'granted', 'expiring'].every((k) => k in contract), 'balance contract fields', contract);
near(contract.pending, 1, 'pending in the contract');

section('permissions');
await expectStatus(api.call('leave.mine', { employment: harutoEmp }, { as: SAM }), 403, 'Sam cannot see Haruto', 'not_permitted');
await expectStatus(api.call('leave.adjust', { employment: samEmp, type: 'annual', amount: 3, reason: 'x' }, { as: SAM }), 403, 'Sam cannot adjust', 'not_permitted');
await expectStatus(api.call('leave.balances', {}, { as: SAM }), 403, 'Sam has no balance table');
await expectStatus(api.call('leave.request', { employment: harutoEmp, type: 'annual', start: mon }, { as: SAM }), 403, 'Sam cannot request for Haruto');
await expectStatus(api.call('leave.types-save', { type: annualType.id, name: 'x' }, { as: MEI }), 403, 'managers cannot change types');
await expectStatus(api.call('leave.register', {}, { as: SAM }), 403, 'Sam cannot read the register');
const payView = await api.call('leave.balances', {}, { as: PAY });
ok(payView.status === 200, 'payroll admin (leave view) reads balances', payView.status);
await expectStatus(api.call('leave.adjust', { employment: samEmp, type: 'annual', amount: 1, reason: 'x' }, { as: PAY }), 403, 'payroll admin cannot adjust (view only)');
for (const opn of ['leave.withdraw', 'leave.cancel', 'leave.encash-request', 'leave.attach', 'leave.register-export', 'leave.types-delete', 'leave.policy-delete', 'leave.block-delete', 'leave.assignment-delete', 'leave.comp-off-withdraw', 'leave.encash-withdraw']) {
  const r = await api.call(opn, { request: 'x', type: 'x', policy: 'x', block: 'x', assignment: 'x', comp_off: 'x', encash: 'x', days: 1 }, { as: 'agent' });
  ok(r.status === 403 && r.body.code === 'agent_not_permitted', 'agent denied ' + opn, r.body);
}

section('your AI agent proposes; HR accepts');
const prop = await api.op('leave.request', { employment: samEmp, type: 'sick', start: addDays(mon, 9), end: addDays(mon, 9), reason: 'Sam asked: dentist', why: 'Sam asked in the question box' }, { as: 'agent' });
ok(typeof prop.proposal === 'string', 'a proposal', prop);
const pv = await api.op('proposals.get', { proposal: prop.proposal }, { as: HR });
ok(pv.proposal.items[0].label.indexOf('Sam Wong') >= 0, 'preview names Sam', pv.proposal.items[0]);
await expectStatus(api.call('proposals.get', { proposal: prop.proposal }, { as: SAM }), 403, 'Sam does not see leave proposals');
const acc = await api.op('proposals.accept', { proposal: prop.proposal }, { as: HR });
ok(acc.proposal.items[0].state === 'applied', 'accepted and applied', acc.proposal.items[0]);
const samReqs = await api.op('leave.requests', { view: 'mine', status: 'pending' }, { as: SAM });
ok(samReqs.requests.some((r) => r.type === 'sick' && r.start === addDays(mon, 9)), 'Sam now has the request', samReqs.requests);
const adj = await api.op('leave.adjust', { employment: samEmp, type: 'annual', amount: 2, reason: 'Opening balance correction', why: 'HR asked' }, { as: 'agent' });
ok(typeof adj.proposal === 'string', 'adjust is a proposal');
const pa = await api.op('proposals.get', { proposal: adj.proposal }, { as: HR });
ok(pa.proposal.items[0].fields.some((f) => f.name.startsWith('balance')), 'adjust preview shows the balance', pa.proposal.items[0].fields);
await api.op('proposals.dismiss', { proposal: adj.proposal, note: 'not needed' }, { as: HR });

section('HR adjusts; the policy changes from next year');
const b0 = await bal(samEmp, 'annual');
const a1 = await api.op('leave.adjust', { employment: samEmp, type: 'annual', amount: 1.5, reason: 'Days from the old system' }, { as: HR });
near(a1.balance.available, b0 + 1.5, 'adjusted');
const pol = (await api.op('leave.policies', { entity: (await api.op('entities.list', {}, { as: HR })).entities[0].id }, { as: HR })).policies.find((p) => p.is_default);
const rules = pol.rules.map((r) => (r.type === 'annual' ? Object.assign({}, r, { tenure: [{ after: 0, amount: 14 }] }) : r));
const nextYear = String(+today.slice(0, 4) + 1) + '-01-01';
const saved = await api.op('leave.policy-save', { policy: pol.id, rules, effective_from: nextYear }, { as: HR });
eq(saved.rules_from, nextYear, 'rules from next year');
near(await bal(samEmp, 'annual'), b0 + 1.5, 'this year unchanged');
const proj = await api.op('leave.balance', { employment: samEmp, type: 'annual', project_to: nextYear }, { as: HR });
ok(proj.projection && proj.projection.balance >= 14, 'next year grants 14 (plus carry-over)', proj.projection);
const hist = await api.op('leave.policy', { policy: pol.id }, { as: HR });
eq(hist.policy.versions.length, 2, 'two versions');

section('bulk tools (leave control panel)');
const dry = await api.op('leave.grant-bulk', { type: 'annual', amount: 1, reason: 'Company anniversary', entity: (await api.op('entities.list', {}, { as: HR })).entities[0].id, dry_run: true }, { as: HR });
ok(dry.count >= 8, 'dry run lists the SG people', dry.count);
const real = await api.op('leave.grant-bulk', { type: 'annual', amount: 1, reason: 'Company anniversary', entity: (await api.op('entities.list', {}, { as: HR })).entities[0].id }, { as: HR });
eq(real.count, dry.count, 'granted to the same people');
near(await bal(samEmp, 'annual'), b0 + 2.5, 'one more day');

section('cron and the daily run');
const runs = await tr('cron', {});
ok(Array.isArray(runs), 'cron ran', runs);
const again = await tr('cron', {});
ok(again.length === 0, 'each entity runs once a local day', again);
const log = await api.op('leave.sync-log', {}, { as: HR });
ok(log.runs.length >= runs.length, 'runs are logged', log.runs.length);
const sum = await tr('ledgerSum', { employment: samEmp, type: annualType.id, day: today });
const balToday = (await api.op('leave.balance', { employment: samEmp, type: 'annual' }, { as: HR })).balance;
near(sum.n, balToday, 'ledger sum equals the balance after the run');

section('home, facts, register');
const home = await api.op('leave.attention', {}, { as: HR });
ok(home.attention.obligation.some((o) => o.number === 'E0016'), 'the five-day rule needs attention for Haruto', home.attention.obligation);
ok(home.attention.expiring.some((x) => x.number === 'E0005'), 'Sam has carried-over days expiring', home.attention.expiring);
const facts = await api.op('people.get', { employee: 'E0005' }, { as: MEI });
const lf = facts.facts.find((f) => f.module === 'leave');
ok(lf && Array.isArray(lf.facts) && lf.facts.some((f) => f.key === 'balance:annual' && f.kind === 'days' && typeof f.value === 'number'), 'profile facts carry the balances as typed days', lf);
const reg = await api.op('leave.register', { entity: (await api.op('entities.list', {}, { as: HR })).entities.find((e) => e.country === 'JP').id }, { as: HR });
ok(reg.rows.some((r) => r.number === 'E0016' && r.granted === 12), 'register: Haruto, 12 days granted in the current year', reg.rows.filter((r) => r.number === 'E0016'));
const csv = await api.op('leave.register-export', {}, { as: HR });
ok(csv.csv.indexOf('E0016') >= 0, 'CSV export has Haruto');
const outNext = await api.op('leave.out', { from: mon, to: addDays(mon, 6) }, { as: HR });
ok(Array.isArray(outNext.per_day) && outNext.per_day.length === 7, 'who is out next week');

done('t02 flows');
