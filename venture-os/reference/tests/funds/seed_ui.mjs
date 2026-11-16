// Seeds a realistic fund for screenshots and manual review: Fund I (USD 50M, 2024) with six LPs, five
// holdings, quarterly calls since mid-2024, a distribution, marks every quarter, closed quarters, an open
// quarter with your AI agent's draft marks, a call ready to issue with its review note, a late payment,
// a statement with differences and a fund raise for Fund II.
//   VO_APP=<scratch app> VO_PORT=3190 VO_BRIDGE=3290 node seed_ui.mjs [--keep]
import { DEMO, fresh, member, newApi, setupFirm, addHolding } from './lib.mjs';

if (!process.argv.includes('--keep')) fresh();
const api = newApi();
await setupFirm(api, { fund_size: '50000000', fund_vintage: 2024 });
const O = { as: 'owner' };
const A = { as: 'agent' };
const FIN = { as: 'finance@venture.test' };
const PIN = { as: 'finance@venture.test', pin: true };
for (const [e, r, n] of [
  ['finance@venture.test', 'finance', 'Fiona Finance'],
  ['finance2@venture.test', 'finance', 'Fred Finance'],
  ['partner@venture.test', 'partner', 'Paul Partner'],
  ['analyst@venture.test', 'analyst', 'Ann Analyst'],
]) {
  await member(api, e, r, n);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: e });
}
await api.op('entities.save', { entity: 'Fund I', first_close_day: '2024-04-01', legal_name: 'Northwind Ventures Fund I, L.P.', short_name: 'Fund I', target: '60000000' }, O);
await api.op('entities.save', { kind: 'fund', name: 'Fund II', short_name: 'Fund II', currency: 'USD', vintage: 2026, target: '120000000', status: 'raising' }, O);
const fund = (await api.op('funds.get', { fund: 'Fund I' }, O)).fund;

const lps = [
  ['Alpine Endowment', 'endowment', 'ana@alpine.example', '15000000.00', true],
  ['Beacon Family Office', 'family_office', 'ben@beacon.example', '10000000.00', true],
  ['Cedar State Pension', 'pension', 'cara@cedar.example', '12000000.00', true],
  ['Delta Fund of Funds', 'fund_of_funds', 'dan@delta.example', '8000000.00', true],
  ['Elm Foundation', 'foundation', 'eve@elm.example', '4000000.00', true],
  ['Northwind GP Commit', 'gp', 'gp@northwind.example', '1000000.00', false],
  ['山田ホールディングス株式会社', 'corporate', 'ir@yamada.example.jp', '2000000.00', true],
];
const ids = {};
for (const [name, kind, email, amount, fee] of lps) {
  const lp = (await api.op('lps.upsert', { name, kind, contacts: JSON.stringify([{ name: name.split(' ')[0] + ' contact', email, primary: true }]), country: email.endsWith('.jp') ? 'JP' : 'US' }, FIN)).lp;
  ids[name] = lp.id;
  await api.op('commitments.save', { fund: 'Fund I', lp: lp.id, amount, fee_paying: fee, closing_day: '2024-04-01', side_letter: name === 'Cedar State Pension' ? '["mfn","reporting"]' : '[]' }, FIN);
}
await api.op('commitments.save', { fund: 'Fund I', lp: ids['Beacon Family Office'], waiver: '50' }, FIN);

const holdings = {};
for (const [name, own] of [
  ['Acme Robotics', 90000],
  ['Lumen Health', 70000],
  ['Orbit Labs', 110000],
  ['Kite Payments', 60000],
  ['Moss Energy', 50000],
]) holdings[name] = await addHolding(api, 'Fund I', name, own);

await api.op('bank.change', { entity: 'Fund I', bank_name: 'First Harbor Bank', account_name: 'Northwind Ventures Fund I, L.P.', account_number: '004417889201', routing: '026009593', swift: 'FHBKUS33', bank_address: '100 Harbor Street, Boston MA' }, PIN);
await api.op('bank.approve', { block: (await api.op('bank.list', {}, FIN)).blocks[0].id }, { as: 'finance2@venture.test', pin: true });

const call = async (notice, purposes) => {
  const e = (await api.op('calls.draft', { fund: 'Fund I', purposes: JSON.stringify(purposes), notice_day: notice }, FIN)).event;
  await api.op('calls.preview', { event: e.id }, FIN);
  await api.op('calls.issue', { event: e.id }, PIN);
  return (await api.op('calls.get', { event: e.id }, FIN)).event;
};
const payAll = async (e, day) => {
  for (const l of e.lines) await api.op('payments.record', { line: l.id, day }, FIN);
};
const fees = (from, to) => ({ type: 'fees', from_day: from, to_day: to });
const inv = (h, amt) => ({ type: 'investment', holding: holdings[h], amount: amt });
const plan = [
  ['2024-05-06', [inv('Acme Robotics', '2500000.00'), fees('2024-04-01', '2024-06-30')]],
  ['2024-08-05', [inv('Lumen Health', '2000000.00'), fees('2024-07-01', '2024-09-30')]],
  ['2024-11-04', [inv('Orbit Labs', '3000000.00'), fees('2024-10-01', '2024-12-31')]],
  ['2025-02-03', [inv('Kite Payments', '1500000.00'), fees('2025-01-01', '2025-03-31')]],
  ['2025-05-05', [inv('Acme Robotics', '1500000.00'), fees('2025-04-01', '2025-06-30')]],
  ['2025-08-04', [inv('Moss Energy', '2000000.00'), fees('2025-07-01', '2025-09-30')]],
  ['2025-11-03', [inv('Orbit Labs', '2000000.00'), fees('2025-10-01', '2025-12-31')]],
  ['2026-02-02', [inv('Lumen Health', '1500000.00'), fees('2026-01-01', '2026-03-31')]],
  ['2026-05-04', [fees('2026-04-01', '2026-06-30'), { type: 'expenses', amount: '60000.00', label: 'Annual audit' }]],
];
const issued = [];
for (const [day, purposes] of plan) issued.push(await call(day, purposes));
for (const e of issued) await payAll(e, e.due_day);

// Marks and closed quarters.
const marks = {
  '2024-12-31': { 'Acme Robotics': '2500000.00', 'Lumen Health': '2000000.00', 'Orbit Labs': '3000000.00' },
  '2025-06-30': { 'Acme Robotics': '5200000.00', 'Lumen Health': '2000000.00', 'Orbit Labs': '3600000.00', 'Kite Payments': '1500000.00' },
  '2025-12-31': { 'Acme Robotics': '7800000.00', 'Lumen Health': '1400000.00', 'Orbit Labs': '6500000.00', 'Kite Payments': '2100000.00', 'Moss Energy': '2000000.00' },
  '2026-06-30': { 'Acme Robotics': '9600000.00', 'Lumen Health': '3400000.00', 'Orbit Labs': '9800000.00', 'Kite Payments': '2600000.00', 'Moss Energy': '1200000.00' },
};
const method = (name, end) => (name === 'Lumen Health' && end === '2025-12-31' ? 'write_down' : name === 'Moss Energy' && end === '2026-06-30' ? 'write_down' : end === '2024-12-31' ? 'calibrated_round' : 'round_adjusted');
for (const end of Object.keys(marks)) {
  const q = (await api.op('quarters.open', { fund: 'Fund I', period_end: end }, FIN)).quarter;
  for (const [name, value] of Object.entries(marks[end])) await api.op('marks.draft', { quarter: q.id, holding: holdings[name], method: method(name, end), value, rationale: 'Calibrated to the latest priced round and verified ARR; comparables from public SaaS multiples.', inputs: JSON.stringify([{ label: 'Last round price', value: '1.85', source: 'Series A SPA, page 4' }]) }, FIN);
  await api.op('marks.approve', { quarter: q.id }, { as: 'partner@venture.test', pin: true });
  await api.op('quarters.freeze', { quarter: q.id }, PIN);
  await api.op('reports.letter-draft', { quarter: q.id, paragraphs: JSON.stringify(['The quarter closed with every holding reporting.', 'Net TVPI beside gross MOIC as frozen.']) }, A);
  await api.op('reports.finalize', { quarter: q.id }, { as: 'partner@venture.test', pin: true });
  await api.op('reports.send', { quarter: q.id }, FIN);
}

// A distribution from Orbit's partial sale.
const di = (await api.op('distributions.draft', { fund: 'Fund I', amount: '3000000.00', holding: holdings['Orbit Labs'], proceeds: '3000000.00', recallable: '500000.00', notice_day: '2026-07-06' }, FIN)).event;
await api.op('distributions.preview', { event: di.id }, FIN);
await api.op('distributions.issue', { event: di.id }, PIN);

// The open quarter: your AI agent's draft marks.
const q3 = (await api.op('quarters.open', { fund: 'Fund I', period_end: '2026-09-30' }, FIN)).quarter;
const q3v = { 'Acme Robotics': ['12500000.00', 'round_adjusted'], 'Lumen Health': ['3400000.00', 'calibrated_round'], 'Orbit Labs': ['8900000.00', 'multiples'], 'Kite Payments': ['2900000.00', 'round_adjusted'], 'Moss Energy': ['0', 'write_off'] };
for (const [name, hid] of Object.entries(holdings)) {
  const v = q3v[name];
  if (!v) continue;
  await api.op('marks.draft', { quarter: q3.id, holding: hid, method: v[1], value: v[0], rationale: 'Series B led by Harbor Capital at 2.4x the A price; ARR up 38% since the last mark on verified KPIs.', inputs: JSON.stringify([{ label: 'Series B price', value: '4.44', source: 'Term sheet, 2026-08-14' }, { label: 'ARR (verified)', value: '6.1M', source: 'Q3 update, page 2' }]) }, A);
}

// A call ready to issue, with your AI agent's review, and a late payment on a fee call.
const late = await call('2026-08-03', [fees('2026-07-01', '2026-09-30')]);
for (const l of late.lines.filter((x) => x.lp_name !== 'Delta Fund of Funds' && x.lp_name !== 'Elm Foundation')) await api.op('payments.record', { line: l.id, day: late.due_day }, FIN);
const next = (await api.op('calls.draft', { fund: 'Fund I', purposes: JSON.stringify([inv('Kite Payments', '1800000.00'), fees('2026-10-01', '2026-12-31')]), notice_day: '2026-11-12' }, FIN)).event;
await api.op('calls.preview', { event: next.id }, FIN);
{
  await api.op('calls.note', { event: next.id, note: 'Investment names Kite Payments (Series A extension). Fees for Q4 2026 at 2% of committed, fee-paying LPs only; Beacon at its 50% waiver. Lines sum to the total. Up from 260,000 last quarter by the Kite follow-on. Ready to issue.' }, A);
}

// Reserves for two holdings.
await api.op('reserves.plan-save', { fund: 'Fund I', holding: holdings['Acme Robotics'], target: '9', rounds: '2', allocated: '4000000.00', assumptions: JSON.stringify([{ round: 1, raise: '25000000.00', post_money: '125000000.00', source: 'Board deck Q3' }, { round: 2, raise: '60000000.00', post_money: '400000000.00', source: 'Partner view (Paul)' }]) }, FIN);
await api.op('reserves.plan-save', { fund: 'Fund I', holding: holdings['Orbit Labs'], target: '10', rounds: '1', allocated: '2500000.00', assumptions: JSON.stringify([{ round: 1, raise: '20000000.00', post_money: '100000000.00', source: 'Lead investor note' }]) }, FIN);
await api.op('reserves.plan-save', { fund: 'Fund I', holding: holdings['Kite Payments'], target: '6', rounds: '1', allocated: '1000000.00', assumptions: JSON.stringify([{ round: 1, raise: '15000000.00', post_money: '75000000.00', source: 'Term sheet draft' }]) }, FIN);

// A statement with differences explained by your AI agent.
const st = (await api.op('statements.import', { fund: 'Fund I', period_end: '2026-06-30', rows: JSON.stringify([{ LP: 'Alpine Endowment', Contributed: '5700000.00' }, { LP: 'Cedar State Pension', Contributed: '4400000.00' }]) }, FIN)).statement;
{
  await api.op('statements.explain', { statement: st.id, index: 0, explanation: 'The administrator has not booked the Q2 audit expense line yet.' }, A);
}

// Fund II raise.
for (const [co, target, stage, soft] of [
  ['Granite Pension', '30000000.00', 'meeting', null],
  ['Harbor Endowment', '20000000.00', 'diligence', null],
  ['Iris Family Office', '8000000.00', 'soft_circle', '6000000.00'],
  ['Juniper Insurance', '15000000.00', 'contacted', null],
  ['Alpine Endowment', '20000000.00', 'committed', '20000000.00'],
  ['Kestrel Foundation', '5000000.00', 'target', null],
]) {
  const d = (await api.op('raise.add', { fund: 'Fund II', company: co, target, stage }, FIN)).deal;
  if (soft) await api.op('raise.soft', { deal: d.id, amount: soft }, FIN);
}
console.log('seeded Fund I and Fund II');
