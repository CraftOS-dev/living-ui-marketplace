// Expenses demo data on top of tools/dev/seed_demo.mjs (run that first), only through operations:
//   node seed_expenses.mjs
// A finance member, Sam's draft with a receipt your AI agent read (waiting to be checked), submitted claims
// with flags, approved claims paid with payroll and by bank, a paid claim, a rejected one, a trip with an
// advance settled by its claims, and claims of Haruto (JPY) and Ananya (INR).
import { DEMO, EMAILS, newApi, upload } from './lib.mjs';
import { receipt } from './fixtures.mjs';

const IMG = { lunch: await receipt('lunch'), hotel: await receipt('hotel'), taxi: await receipt('taxi'), dinner: await receipt('dinner') };
const NAMES = ['hotel', 'lunch', 'dinner', 'taxi'];
let turn = 0;
const pic = (n) => ({ data: IMG[n ?? NAMES[turn++ % NAMES.length]], type: 'image/png', name: (n ?? 'receipt') + '.png' });

const api = newApi();
const O = { as: 'owner' };
const SAM = { as: EMAILS.sam };
const ENG = { as: EMAILS.eng };
const HR = { as: EMAILS.hr };
const AG = { as: 'agent' };

const dir = await api.op('people.directory', { status: 'all', limit: 100 }, O);
const who = (n) => dir.people.find((x) => x.name === n);
const sam = who('Sam Wong');
const finEmp = await api.op('people.hire', { entity: sam.entity, legal_name: 'Fiona Tan', start_day: '2025-01-06', work_email: 'fin@northwind.test', title: 'Finance Manager', department: (await api.op('departments.list', {}, O)).departments.find((d) => d.name === 'People and Finance').id }, O);
const inv = await api.op('members.invite', { email: 'fin@northwind.test', name: 'Fiona Tan', role: 'finance', employee: finEmp.employee.id }, { as: 'owner', pin: true });
api.setToken('fin@northwind.test', (await api.op('auth.accept-invite', { email: 'fin@northwind.test', code: inv.code, password: DEMO.password })).token);
await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: 'fin@northwind.test' });
const FIN = { as: 'fin@northwind.test' };

async function approveAll(id) {
  for (let i = 0; i < 4; i++) {
    const a = (await api.op('approvals.get', { approval: id }, O)).approval;
    if (a.status !== 'pending') return;
    for (const as of [ENG, FIN, { as: EMAILS.sales }, HR, O]) {
      const me = await api.op('auth.me', {}, as);
      if (a.approvers.includes(me.member.id)) {
        await api.op('approvals.decide', { approval: id, decision: 'approved' }, as);
        break;
      }
    }
  }
}
const withReceipt = async (line, as) => upload(api, 'claim-lines.update', { line, read: 'false' }, { receipt: pic() }, as);
async function claimFor(asEmail, title, lines, extra = {}) {
  const as = { as: asEmail };
  const c = (await api.op('claims.create', Object.assign({ title }, extra), as)).claim;
  for (const l of lines) {
    const r = await api.op('claim-lines.add', Object.assign({ claim: c.number }, l.p), as);
    if (l.receipt) await withReceipt(r.line.id, asEmail);
    if (l.reason) await api.op('claim-lines.update', { line: r.line.id, reason: l.reason }, as);
  }
  return c;
}

// 1. A trip and an advance for it, then the trip's claim settles the advance.
const trip = (await api.op('travel.save', { purpose: 'client_visit', details: 'Quarterly review with Tokyo clients', from_day: '2026-10-19', to_day: '2026-10-22', destinations: [{ city: 'Tokyo', country: 'JP' }], itinerary: [{ day: '2026-10-19', from: 'Singapore', to: 'Tokyo', mode: 'flight', note: 'SQ638' }, { day: '2026-10-22', from: 'Tokyo', to: 'Singapore', mode: 'flight', note: 'SQ637' }], costs: [{ category: 'lodging', amount: '900.00', note: '3 nights' }, { category: 'meals', amount: '240.00' }, { category: 'travel', amount: '1100.00', note: 'Flights' }] }, SAM)).trip;
const ts = await api.op('travel.submit', { travel: trip.number }, SAM);
await approveAll(ts.trip.approval);
const adv = (await api.op('advances.request', { amount: '500.00', purpose: 'Cash for the Tokyo trip', travel: trip.number, needed_by: '2026-10-16' }, SAM)).advance;
await approveAll(adv.approval);
await api.op('advances.mark-paid', { advance: adv.number, reference: 'DBS-TT-88120', day: '2026-10-15' }, FIN);
const tc = await claimFor(EMAILS.sam, 'Tokyo client visit', [
  { p: { category: 'lodging', amount: '96000', currency: 'JPY', fx_rate: 0.0089, day: '2026-10-19', merchant: 'Hotel Gracery Shinjuku' }, receipt: true },
  { p: { category: 'meals', amount: '4800', currency: 'JPY', fx_rate: 0.0089, day: '2026-10-20', merchant: 'Ichiran Shibuya' }, receipt: true },
  { p: { category: 'client_entertainment', amount: '28500', currency: 'JPY', fx_rate: 0.0089, day: '2026-10-21', merchant: 'Gonpachi Nishi-Azabu', attendees: 'Kenji Takahashi, two clients' }, receipt: true },
  { p: { category: 'travel', amount: '3250', currency: 'JPY', fx_rate: 0.0089, day: '2026-10-22', merchant: 'Narita Express' }, receipt: true },
], { travel: trip.number, advance: adv.number });
const tcs = await api.op('claims.submit', { claim: tc.number }, SAM);
await approveAll(tcs.approval.id);

// 2. A paid claim (payroll) and an approved one waiting for the run.
const p1 = await claimFor(EMAILS.sam, 'September client lunches', [
  { p: { category: 'meals', amount: '38.40', day: '2026-09-17', merchant: 'Tiong Bahru Bakery' }, receipt: true },
  { p: { category: 'mileage', distance: 42, day: '2026-09-18', description: 'Office to Jurong client and back' } },
]);
await approveAll((await api.op('claims.submit', { claim: p1.number }, SAM)).approval.id);
await api.op('testexp.mark-paid', { ids: JSON.stringify([p1.id]), payrun: 'RUN-2026-09' }, O);
const p2 = await claimFor(EMAILS.sam, 'Phone and internet, October', [{ p: { category: 'phone_internet', amount: '68.00', day: '2026-10-31', merchant: 'Singtel' }, receipt: true }]);
await approveAll((await api.op('claims.submit', { claim: p2.number }, SAM)).approval.id);

// 3. Submitted claims waiting, with flags (weekend, over limit, missing receipt, a duplicate the agent spotted).
const cats = await api.op('expense-categories.list', { entity: sam.entity }, HR);
await api.op('expense-categories.save', { category: cats.categories.find((c) => c.code === 'meals').id, limit: '60.00', per_day_limit: '90.00' }, HR);
const w1 = await claimFor(EMAILS.sam, 'Team offsite', [
  { p: { category: 'meals', amount: '84.20', day: '2026-11-01', merchant: 'Jumbo Seafood' }, receipt: true, reason: 'Team dinner after the Sunday release' },
  { p: { category: 'office_supplies', amount: '24.90', day: '2026-11-02', merchant: 'Popular Bookstore' } },
  { p: { category: 'travel', amount: '18.60', day: '2026-11-02', merchant: 'Grab' }, receipt: true },
]);
const w1s = await api.op('claims.submit', { claim: w1.number }, SAM);
const w1d = await api.op('claims.get', { claim: w1.number }, AG);
await api.op('claim-lines.flag', { line: w1d.claim.lines[2].id, code: 'possible_duplicate', note: 'Same Grab ride as on ' + p2.number + '?' }, AG);

// 4. A big claim (finance step) from another person, waiting.
const nurul = who('Nurul Huda');
const nurulEmail = 'nurul@northwind.test';
const ninv = await api.op('members.invite', { email: nurulEmail, name: 'Nurul Huda', role: 'employee', employee: nurul.employee }, { as: 'owner', pin: true });
api.setToken(nurulEmail, (await api.op('auth.accept-invite', { email: nurulEmail, code: ninv.code, password: DEMO.password })).token);
const big = await claimFor(nurulEmail, 'AWS re:Invent', [
  { p: { category: 'training', amount: '2099.00', currency: 'USD', fx_rate: 1.3, day: '2026-10-05', merchant: 'AWS re:Invent pass' }, receipt: true },
  { p: { category: 'lodging', amount: '1260.00', currency: 'USD', fx_rate: 1.3, day: '2026-10-08', merchant: 'Wynn Las Vegas' }, receipt: true },
]);
await api.op('claims.submit', { claim: big.number }, { as: nurulEmail });

// 5. A rejected claim.
const r1 = await claimFor(EMAILS.sam, 'Standing desk', [{ p: { category: 'other', amount: '459.00', day: '2026-10-12', merchant: 'IKEA Tampines' }, receipt: true }]);
const r1s = await api.op('claims.submit', { claim: r1.number }, SAM);
await api.op('approvals.decide', { approval: r1s.approval.id, decision: 'rejected', note: 'Home office equipment goes through the IT request form' }, ENG);

// 6. Sam's open draft: a typed line and a photo your AI agent read (waiting to be checked).
const d1 = await api.op('claim-lines.add', { category: 'travel', amount: '12.40', day: '2026-11-03', merchant: 'ComfortDelGro' }, SAM);
const ph = await upload(api, 'claim-lines.add', {}, { receipt: pic('lunch') }, EMAILS.sam);
await api.op('claim-lines.read-result', { line: ph.body.line.id, amount: '27.80', currency: 'SGD', day: '2026-11-03', merchant: 'Din Tai Fung Raffles City', category: 'meals', tax: '2.30', confidence: 'high' }, AG);
await upload(api, 'claim-lines.add', {}, { receipt: pic('taxi') }, EMAILS.sam);

// 7. Haruto (JPY) and Ananya (INR): one approved bank claim, one waiting.
const hc = await claimFor(EMAILS.haruto, 'Osaka meetup', [
  { p: { category: 'travel', amount: '27240', day: '2026-10-24', merchant: 'JR Central Shinkansen' }, receipt: true },
  { p: { category: 'meals', amount: '3200', day: '2026-10-24', merchant: 'Kushikatsu Daruma' }, receipt: true },
]);
await approveAll((await api.op('claims.submit', { claim: hc.number }, { as: EMAILS.haruto })).approval.id);
await api.op('claims.set-payment', { claim: hc.number, pay_via: 'bank' }, FIN);
const ac = await claimFor(EMAILS.ananya, 'Bengaluru conference', [
  { p: { category: 'training', amount: '7500.00', day: '2026-10-28', merchant: 'JSFoo 2026' }, receipt: true },
  { p: { category: 'mileage', distance: 64, day: '2026-10-28', description: 'Mumbai home to Pune venue' } },
]);
await api.op('claims.submit', { claim: ac.number }, { as: EMAILS.ananya });

// 8. An advance waiting for approval, and a trip coming up.
await api.op('advances.request', { amount: '300.00', purpose: 'Float for the Penang workshop', needed_by: '2026-11-20' }, { as: nurulEmail });
const t2 = (await api.op('travel.save', { purpose: 'conference', from_day: '2026-11-24', to_day: '2026-11-26', destinations: [{ city: 'Penang', country: 'MY' }], costs: [{ category: 'lodging', amount: '420.00' }, { category: 'travel', amount: '260.00' }] }, { as: nurulEmail })).trip;
await api.op('travel.submit', { travel: t2.number }, { as: nurulEmail });

console.log('expenses demo: trip ' + trip.number + ', advance ' + adv.number + ', claims ' + [tc.number, p1.number, p2.number, w1.number, big.number, r1.number, d1.claim.number, hc.number, ac.number].join(' ') + (w1s ? '' : ''));
