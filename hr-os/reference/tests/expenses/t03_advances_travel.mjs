// Travel requests and advances end to end: a trip with its estimate and
// approval, an advance (manager then finance), paid by finance, settled by
// the claims of the trip, recovery through payroll (advanceRecovery and
// markPaid with partial amounts), payout through payroll, repayment.
import { DEMO, EMAILS, PNG, eq, fresh, newApi, ok, refuses, section, summary, upload } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const SAM = { as: EMAILS.sam };
const ENG = { as: EMAILS.eng };
const HR = { as: EMAILS.hr };
const AG = { as: 'agent' };

const dir = await api.op('people.directory', { status: 'all', limit: 100 }, O);
const sam = dir.people.find((x) => x.name === 'Sam Wong');
const haruto = dir.people.find((x) => x.name === 'Haruto Sato');
const finEmp = await api.op('people.hire', { entity: sam.entity, legal_name: 'Fiona Tan', start_day: '2025-01-06', work_email: 'fin@northwind.test' }, O);
const inv = await api.op('members.invite', { email: 'fin@northwind.test', name: 'Fiona Tan', role: 'finance', employee: finEmp.employee.id }, { as: 'owner', pin: true });
api.setToken('fin@northwind.test', (await api.op('auth.accept-invite', { email: 'fin@northwind.test', code: inv.code, password: DEMO.password })).token);
const FIN = { as: 'fin@northwind.test' };

async function approveAll(approvalId) {
  for (let i = 0; i < 4; i++) {
    const a = (await api.op('approvals.get', { approval: approvalId }, O)).approval;
    if (a.status !== 'pending') return a;
    const who = a.approvers.length > 0 ? a.approvers : [];
    let done = false;
    for (const as of [ENG, FIN, O]) {
      const me = await api.op('auth.me', {}, as);
      if (who.includes(me.member.id)) {
        await api.op('approvals.decide', { approval: approvalId, decision: 'approved' }, as);
        done = true;
        break;
      }
    }
    if (!done) throw new Error('no approver found for ' + approvalId + ' ' + JSON.stringify(who));
  }
  return (await api.op('approvals.get', { approval: approvalId }, O)).approval;
}

section('a trip');
const t0 = await api.op('travel.save', { purpose: 'client_visit', details: 'Quarterly review with Tokyo clients', from_day: '2026-11-20', to_day: '2026-11-23', destinations: [{ city: 'Tokyo', country: 'JP' }], itinerary: [{ day: '2026-11-20', from: 'Singapore', to: 'Tokyo', mode: 'flight', note: 'SQ638' }, { day: '2026-11-23', from: 'Tokyo', to: 'Singapore', mode: 'flight' }], costs: [{ category: 'lodging', amount: '900.00', note: '3 nights' }, { category: 'meals', amount: '200.00' }] }, SAM);
const trip = t0.trip;
ok(/^TRV-\d{4}$/.test(trip.number) && trip.status === 'draft' && trip.estimate_minor === 110000 && trip.days === 4 && trip.label.indexOf('Tokyo') === 0, 'draft trip with a SGD 1,100 estimate over 4 days', trip);
await refuses(api, 'travel.save', { purpose: 'other', from_day: '2026-11-20', to_day: '2026-11-19' }, SAM, 400, 'invalid_param', 'a trip cannot end before it starts');
await refuses(api, 'travel.save', { from_day: '2026-11-20', itinerary: [{ mode: 'rocket' }] }, SAM, 400, 'invalid_param', 'unknown travel mode');
await refuses(api, 'travel.submit', { travel: trip.number }, AG, 403, 'agent_not_permitted', 'your AI agent cannot submit a trip');
const ts = await api.op('travel.submit', { travel: trip.number }, SAM);
eq(ts.trip.status, 'requested', 'trip requested');
const tAp = (await api.op('approvals.list', { kind: 'travel' }, ENG)).approvals[0];
ok(tAp && tAp.ref_id === trip.id && tAp.payload.days === 4, 'the manager has the trip in the Inbox', tAp);
await api.op('approvals.decide', { approval: tAp.id, decision: 'approved' }, ENG);
eq((await api.op('travel.get', { travel: trip.number }, SAM)).trip.status, 'approved', 'trip approved');
const draftByAgent = await api.op('travel.save', { employment: sam.employment, purpose: 'conference', from_day: '2026-12-01', to_day: '2026-12-02', destinations: [{ city: 'Kuala Lumpur', country: 'MY' }] }, AG);
ok(draftByAgent.trip.status === 'draft' && draftByAgent.trip.created_by_name === 'Your AI agent', 'your AI agent can draft a trip for someone');
await api.op('travel.cancel', { travel: draftByAgent.trip.number }, SAM);

section('an advance for the trip');
await refuses(api, 'advances.request', { amount: '500.00', purpose: 'Tokyo trip cash' }, AG, 403, 'agent_not_permitted', 'your AI agent cannot ask for an advance');
await refuses(api, 'advances.request', { amount: '500.00', purpose: 'x', pay_via: 'payroll' }, SAM, 403, 'not_permitted', 'the employee cannot choose how it is paid');
const ar = await api.op('advances.request', { amount: '500.00', purpose: 'Tokyo trip cash', travel: trip.number, needed_by: '2026-11-18' }, SAM);
const adv = ar.advance;
ok(/^ADV-\d{4}$/.test(adv.number) && adv.status === 'requested' && adv.pay_via === 'bank' && adv.recover_via === 'claim' && adv.recover_from === '2026-12-23', 'requested: paid by bank, settled by claims, recovery from 30 days after the trip', adv);
const advAp = await approveAll(adv.approval);
eq(advAp.steps.length, 2, 'two steps: manager then finance');
let av = (await api.op('advances.get', { advance: adv.number }, SAM)).advance;
eq(av.status, 'approved', 'advance approved');
eq((await api.op('testexp.pay-inputs', { employment: sam.employment, up_to: '2026-11-30' }, O)).items.length, 0, 'a bank advance is not paid by payroll');
await refuses(api, 'advances.mark-paid', { advance: adv.number, reference: 'x' }, SAM, 403, 'not_permitted', 'the employee cannot mark it paid');
await refuses(api, 'advances.mark-paid', { advance: adv.number, reference: 'x' }, AG, 403, 'agent_not_permitted', 'your AI agent cannot mark it paid');
av = (await api.op('advances.mark-paid', { advance: adv.number, reference: 'DBS-ADV-7', day: '2026-11-17' }, FIN)).advance;
ok(av.status === 'paid' && av.balance_minor === 50000 && av.paid_reference === 'DBS-ADV-7', 'finance pays it: balance SGD 500', av);

section('claims of the trip settle the advance');
const c1 = await api.op('claims.create', { title: 'Tokyo client visit', travel: trip.number, advance: adv.number }, SAM);
for (const [cat, amt, day] of [['lodging', '300.00', '2026-11-03'], ['meals', '20.00', '2026-11-03']]) {
  const l = await api.op('claim-lines.add', { claim: c1.claim.number, category: cat, amount: amt, day: day, merchant: cat + ' place' }, SAM);
  await upload(api, 'claim-lines.update', { line: l.line.id, read: 'false' }, { receipt: { data: PNG, type: 'image/png', name: 'r.png' } }, EMAILS.sam);
}
const s1 = await api.op('claims.submit', { claim: c1.claim.number }, SAM);
await approveAll(s1.approval.id);
let cv = (await api.op('claims.get', { claim: c1.claim.number }, SAM)).claim;
ok(cv.status === 'paid' && cv.paid_via === 'advance' && cv.advance_applied_minor === 32000 && cv.payable_minor === 0 && cv.settlements.length === 1, 'SGD 320 claim settled in full against the advance', cv);
av = (await api.op('advances.get', { advance: adv.number }, SAM)).advance;
ok(av.balance_minor === 18000 && av.settlements.length === 1 && av.settlements[0].kind === 'claim', 'SGD 180 left on the advance', av);
const c2 = await api.op('claim-lines.add', { category: 'travel', amount: '250.00', day: '2026-11-03', merchant: 'Narita Express' }, SAM);
await upload(api, 'claim-lines.update', { line: c2.line.id, read: 'false' }, { receipt: { data: PNG, type: 'image/png', name: 'r.png' } }, EMAILS.sam);
await api.op('claims.update', { claim: c2.claim.number, travel: trip.number }, SAM);
const s2 = await api.op('claims.submit', { claim: c2.claim.number }, SAM);
await approveAll(s2.approval.id);
cv = (await api.op('claims.get', { claim: c2.claim.number }, SAM)).claim;
ok(cv.status === 'approved' && cv.advance_applied_minor === 18000 && cv.payable_minor === 7000, 'the next claim uses the rest: SGD 70 still to pay', cv);
eq((await api.op('advances.get', { advance: adv.number }, SAM)).advance.status, 'settled', 'advance settled');
const pi = await api.op('testexp.pay-inputs', { employment: sam.employment, up_to: '2026-11-30' }, O);
ok(pi.items.length === 1 && pi.items[0].amount_minor === 7000 && pi.items[0].claim === cv.id, 'payInputs pays the SGD 70 left', pi.items);
const tg = (await api.op('travel.get', { travel: trip.number }, SAM)).trip;
ok(tg.claims === 2 && tg.spent_minor === 57000 && tg.advances.length === 1 && tg.claims_list.length === 2, 'the trip shows SGD 570 spent of its 1,100 estimate', { claims: tg.claims, spent: tg.spent_minor });

section('recovery through payroll');
const a2 = await api.op('advances.request', { employment: sam.employment, amount: '300.00', purpose: 'Float for the office move', recover_via: 'payroll', recover_from: '2026-11-25' }, HR);
await approveAll(a2.advance.approval);
await api.op('advances.mark-paid', { advance: a2.advance.number, reference: 'DBS-ADV-8' }, FIN);
eq((await api.op('testexp.recovery', { employment: sam.employment, up_to: '2026-11-20' }, O)).items.length, 0, 'nothing to recover before the recovery day');
let rec = await api.op('testexp.recovery', { employment: sam.employment, up_to: '2026-11-30' }, O);
ok(rec.items.length === 1 && rec.items[0].advance === a2.advance.id && rec.items[0].amount_minor === 30000 && rec.items[0].currency === 'SGD', 'advanceRecovery: SGD 300 from the November run', rec.items);
let mp = await api.op('testexp.mark-paid', { ids: JSON.stringify([{ advance: a2.advance.id, amount_minor: 10000 }]), payrun: 'RUN-NOV' }, O);
eq(mp.result.recovered, 1, 'payroll recovered part of it (net pay was short)');
rec = await api.op('testexp.recovery', { employment: sam.employment, up_to: '2026-12-31' }, O);
eq(rec.items[0].amount_minor, 20000, 'SGD 200 left to recover');
mp = await api.op('testexp.mark-paid', { ids: JSON.stringify([{ advance: a2.advance.id, amount_minor: 10000 }]), payrun: 'RUN-NOV' }, O);
eq(mp.result.recovered, 0, 'the same run does not recover twice');
mp = await api.op('testexp.mark-paid', { ids: JSON.stringify([a2.advance.id]), payrun: 'RUN-DEC' }, O);
eq(mp.result.recovered, 1, 'the next run recovers the rest');
av = (await api.op('advances.get', { advance: a2.advance.number }, HR)).advance;
ok(av.status === 'settled' && av.balance_minor === 0 && av.settlements.filter((s) => s.kind === 'payroll').length === 2, 'settled through payroll', av.settlements);
const un = await api.op('testexp.unmark-paid', { payrun: 'RUN-DEC' }, O);
eq(un.result.recoveries, 1, 'a voided run gives the recovery back');
av = (await api.op('advances.get', { advance: a2.advance.number }, HR)).advance;
ok(av.status === 'paid' && av.balance_minor === 20000, 'balance back to SGD 200');
const rp = await api.op('advances.settle', { advance: a2.advance.number, kind: 'repayment', amount: '200.00', reference: 'PayNow 88123' }, FIN);
ok(rp.advance.status === 'settled' && rp.advance.balance_minor === 0, 'the person paid back the rest');
await refuses(api, 'advances.settle', { advance: a2.advance.number, amount: '1.00', reference: 'x' }, FIN, 409, 'conflict', 'a settled advance takes nothing more');

section('payout through payroll, and a leaver');
const a3 = await api.op('advances.request', { employment: haruto.employment, amount: '50000', purpose: 'Osaka conference', pay_via: 'payroll' }, HR);
ok(a3.advance.currency === 'JPY' && a3.advance.amount_minor === 50000, 'JPY advance for Haruto', a3.advance);
await approveAll(a3.advance.approval);
const hp = await api.op('testexp.pay-inputs', { employment: haruto.employment, up_to: '2026-11-30', currency: 'JPY' }, O);
ok(hp.items.length === 1 && hp.items[0].kind === 'advance' && hp.items[0].advance === a3.advance.id && hp.items[0].component === 'ADVANCE' && hp.items[0].amount_minor === 50000, 'payInputs pays out the advance with the run', hp.items);
mp = await api.op('testexp.mark-paid', { ids: JSON.stringify([hp.items[0].ref]), payrun: 'JP-NOV' }, O);
eq(mp.result.advances_paid, 1, 'markPaid opens its balance');
av = (await api.op('advances.get', { advance: a3.advance.number }, HR)).advance;
ok(av.status === 'paid' && av.balance_minor === 50000 && av.payrun === 'JP-NOV', 'paid by payroll', av);
eq((await api.op('testexp.recovery', { employment: haruto.employment, up_to: '2026-11-30' }, O)).items.length, 0, 'settled by claims: no recovery yet');
await api.op('employments.end', { employment: haruto.employment, end_day: '2026-11-28', reason: 'resignation' }, O);
const leaver = await api.op('testexp.recovery', { employment: haruto.employment, up_to: '2026-11-30' }, O);
ok(leaver.items.length === 1 && leaver.items[0].reason === 'leaving', 'a leaver: the whole balance is recovered from the final pay', leaver.items);
const os = await api.op('testexp.outstanding', { employment: haruto.employment }, O);
eq(os.result.advance_balance_minor, 50000, 'outstanding for the final settlement');

section('cancel and lists');
const a4 = await api.op('advances.request', { amount: '80.00', purpose: 'Taxi float' }, SAM);
await refuses(api, 'advances.cancel', { advance: a4.advance.number }, { as: EMAILS.haruto }, 403, 'not_permitted', 'someone else cannot cancel it');
const cx = await api.op('advances.cancel', { advance: a4.advance.number, note: 'Not needed' }, SAM);
eq(cx.advance.status, 'cancelled', 'cancelled while waiting');
const al = await api.op('advances.list', { status: 'any' }, HR);
ok(al.view === 'all' && al.total >= 4 && al.totals.length >= 1, 'HR lists every advance', al.totals);
const mine = await api.op('advances.list', {}, SAM);
ok(mine.view === 'mine' && mine.advances.every((x) => x.employee_name === 'Sam Wong'), 'Sam sees his own');
const tl = await api.op('travel.list', { status: 'any' }, ENG);
ok(tl.view === 'team' && tl.trips.some((t) => t.id === trip.id), 'the manager sees the team trips');
const me = await api.op('expenses.me', {}, SAM);
ok(me.trips.some((t) => t.id === trip.id) && me.advances.length >= 1 && me.awaiting.some((x) => x.amount_minor === 7000), 'the employee view: trip, advances, SGD 70 awaiting', { awaiting: me.awaiting });

summary('t03_advances_travel');
