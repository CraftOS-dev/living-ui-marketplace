// Funds module, seeded: LPs and commitments, sealed wire details with a second approval, a capital call in
// three steps (draft, preview with exact lines and your AI agent's review, issue with the PIN), notices and
// their sending, payments (a proposal from your AI agent, Next items for late ones), a distribution with the
// waterfall estimate, voids, opening balances, statements and reconciliation, ILPA and XLSX exports.
//   VO_APP=<scratch app> VO_PORT=3190 VO_BRIDGE=3290 node t02_capital.mjs
import { DEMO, bridge, eq, fresh, member, newApi, ok, refuses, section, setupFirm, sleep, summary, addHolding, fileBytes, pdfText } from './lib.mjs';

fresh();
await bridge.reset();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
const FIN = { as: 'finance@venture.test' };
const FIN2 = { as: 'finance2@venture.test' };
const PA = { as: 'partner@venture.test' };
const AN = { as: 'analyst@venture.test' };
for (const [e, r, n] of [
  ['finance@venture.test', 'finance', 'Fiona Finance'],
  ['finance2@venture.test', 'finance', 'Fred Finance'],
  ['partner@venture.test', 'partner', 'Paul Partner'],
  ['analyst@venture.test', 'analyst', 'Ann Analyst'],
]) {
  await member(api, e, r, n);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: e });
}
await api.op('entities.save', { entity: 'Fund I', first_close_day: '2025-01-15', legal_name: 'Northwind Ventures Fund I, L.P.', short_name: 'Fund I' }, O);
const fund = (await api.op('funds.get', {}, O)).fund;

section('LPs and commitments');
const alpine = (await api.op('lps.upsert', { name: 'Alpine Endowment', kind: 'endowment', contacts: JSON.stringify([{ name: 'Ana Alp', email: 'ana@alpine.example', primary: true }]), country: 'US' }, FIN)).lp;
const beacon = (await api.op('lps.upsert', { name: 'Beacon Family Office', kind: 'family_office', contacts: JSON.stringify([{ name: 'Ben Bea', email: 'ben@beacon.example' }]) }, FIN)).lp;
const pr = await api.op('lps.upsert', { name: 'GP Commit LLC', kind: 'gp', contacts: JSON.stringify([{ name: 'Gail', email: 'gail@northwind.example' }]), why: 'The GP commitment entity from the LPA' }, A);
ok(pr.proposed === true, 'your AI agent adding an LP is a proposal', pr);
const acc = await api.op('proposals.accept', { proposal: pr.proposal }, FIN);
eq(acc.applied, 1, 'finance accepts it');
const gp = (await api.op('lps.get', { lp: 'GP Commit LLC' }, FIN)).lp;
await refuses(api, 'lps.upsert', { lp: alpine.id, tax_id: '12-3456789' }, A, 403, 'agent_not_permitted', 'tax ids are people only (the proposal is refused at once)');
await api.op('lps.upsert', { lp: alpine.id, tax_id: '12-3456789' }, FIN);
eq((await api.op('lps.get', { lp: alpine.id }, FIN)).lp.tax_id, '•••• 6789', 'the tax id is sealed, last four shown');
await api.op('commitments.save', { fund: 'Fund I', lp: alpine.id, amount: '30000000.00' }, FIN);
await api.op('commitments.save', { fund: 'Fund I', lp: beacon.id, amount: '15000000.00', side_letter: '["mfn","reporting"]' }, FIN);
await api.op('commitments.save', { fund: 'Fund I', lp: gp.id, amount: '5000000.00', fee_paying: false }, FIN);
await refuses(api, 'commitments.save', { fund: 'Fund I', lp: alpine.id, amount: '1.00' }, A, 403, 'agent_not_permitted', 'commitments are people only');
const lps0 = await api.op('lps.list', { fund: 'Fund I' }, FIN);
eq(lps0.totals.commitment_minor, 5000000000, 'USD 50,000,000.00 committed');
eq(lps0.lps.find((x) => x.name === 'Beacon Family Office').side_letter, ['mfn', 'reporting'], 'side-letter flags kept');

section('holdings (portfolio stand-in)');
const acme = await addHolding(api, 'Fund I', 'Acme Robotics', 100000);
const lumen = await addHolding(api, 'Fund I', 'Lumen Health', 80000);

section('capital call step 1: draft');
const d1 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'investment', amount: '5000000.00', holding: acme, fees: true, notice_day: '2026-01-05' }, FIN)).event;
eq(d1.number, 'CC-001', 'display id CC-001');
eq(d1.due_day, '2026-01-19', 'due 10 business days after the notice');
eq(d1.purposes.map((x) => x.type), ['investment', 'fees'], 'investment and fees');
eq(d1.purposes[1].from_day + ' ' + d1.purposes[1].to_day, '2026-01-01 2026-03-31', 'fee period: the notice quarter');
eq(d1.steps.at, 0, 'StepTrack at Draft');
const ap = await api.op('calls.draft', { fund: 'Fund I', purpose: 'expenses', amount: '20000.00', why: 'Audit fee invoice' }, A);
ok(ap.proposed === true, "your AI agent's draft is a proposal", ap);

section('step 2: preview, exact to the minor unit');
const p1 = (await api.op('calls.preview', { event: d1.id }, FIN)).event;
const pv = p1.preview;
eq(pv.totals, { call_investment: 500000000, call_fees: 22500000, call_expenses: 0, call_other: 0, call_recall: 0, call_subline: 0, total_minor: 522500000 }, 'totals: 5,000,000.00 investment and 225,000.00 fees');
eq(pv.lines.reduce((s, l) => s + l.total_minor, 0), pv.totals.total_minor, 'the lines sum to the total exactly');
const lineOf = (lps, name) => lps.find((l) => l.lp_name === name);
eq(lineOf(pv.lines, 'Alpine Endowment').amounts, { call_investment: 300000000, call_fees: 15000000, call_expenses: 0, call_other: 0, call_recall: 0, call_subline: 0 }, 'Alpine: 3,000,000.00 and 150,000.00 fees (2% of 30M for a quarter)');
eq(lineOf(pv.lines, 'GP Commit LLC').amounts.call_fees, 0, 'no fee line for the GP (not fee-paying)');
eq(lineOf(pv.lines, 'Alpine Endowment').balances.contributed_ppm, 105000, 'Alpine has contributed 10.5% after the notice');
eq(lineOf(pv.lines, 'Alpine Endowment').balances.unfunded_minor, 2685000000, 'and 26,850,000.00 is unfunded');
eq(p1.status, 'previewed', 'status previewed');
eq((await api.op('calls.get', { event: d1.id }, AN)).event.preview.lines, [], 'the analyst sees totals, not LP lines');

section('your AI agent reviews the notice');
eq(Object.keys((await api.op('calls.get', { event: d1.id }, FIN)).event.agent || {}).length, 0, 'a preview asks your AI agent nothing by itself');
const nr = await api.op('agent.ask', { trigger: 'notice_review', record: d1.id }, FIN);
ok(nr.request !== '' && nr.record === d1.id, 'Ask your AI agent to review: one fire of notice_review for CC-001', nr);
await refuses(api, 'agent.ask', { trigger: 'notice_review', record: d1.id }, FIN, 409, 'pending', 'asking again while it waits is refused');
await api.op('calls.note', { event: d1.id, note: 'Investment names Acme Robotics; fees for Q1 2026 at 2% of committed, fee-paying LPs only. Lines sum. Ready.' }, A);
ok(!(await api.op('calls.get', { event: d1.id }, FIN)).event.agent.notice_review.pending, 'the note landed the ask');
const p1b = (await api.op('calls.get', { event: d1.id }, FIN)).event;
eq(p1b.note_by, 'agent', 'the note is marked as your AI agent\'s');
const nx0 = await api.op('next.list', {}, FIN);
ok(nx0.items.some((i) => i.key === 'funds:issue:' + d1.id && i.actions[0].op === 'calls.issue' && i.actions[0].pin === true), 'Next: "Call CC-001 ready" with Issue (PIN)', nx0.items.map((i) => i.key));

section('step 3: issue with the PIN');
await refuses(api, 'calls.issue', { event: d1.id }, A, 403, 'agent_not_permitted', 'your AI agent never issues');
await refuses(api, 'calls.issue', { event: d1.id }, { as: 'finance@venture.test', pin: true }, 409, 'no_wire', 'no wire details yet');
await api.op('bank.change', { entity: 'Fund I', bank_name: 'First Republic Trust', account_name: 'Northwind Ventures Fund I', account_number: '000123456789', routing: '021000021', swift: 'FRTCUS33', bank_address: '1 Market St, San Francisco' }, { as: 'finance@venture.test', pin: true });
const blocks = (await api.op('bank.list', {}, FIN)).blocks;
eq(blocks[0].status + ' ' + blocks[0].last4, 'pending ' + '•••• 6789', 'pending, last four shown');
await refuses(api, 'bank.approve', { block: blocks[0].id }, { as: 'finance@venture.test', pin: true }, 403, 'second_member_required', 'the changer cannot approve');
const nxb = await api.op('next.list', {}, FIN2);
ok(nxb.items.some((i) => i.key === 'funds:bank:' + blocks[0].id), 'the second member sees it in Next');
await api.op('bank.approve', { block: blocks[0].id }, { as: 'finance2@venture.test', pin: true });
await refuses(api, 'bank.view', { entity: 'Fund I' }, A, 403, 'agent_not_permitted', 'your AI agent never sees wire details');
const rev = await api.op('bank.view', { entity: 'Fund I' }, { as: 'finance@venture.test', pin: true });
eq(rev.details.account_number, '000123456789', 'revealed with the PIN');
eq(rev.minutes, 5, 'for five minutes');
await refuses(api, 'calls.issue', { event: d1.id }, { as: 'finance@venture.test', pin: '000000' }, 403, undefined, 'a wrong PIN is refused');
const iss = (await api.op('calls.issue', { event: d1.id }, { as: 'finance@venture.test', pin: true })).event;
eq(iss.status, 'issued', 'issued');
eq(iss.queued, 3, 'three notices approved for sending');
eq(iss.lines.length, 3, 'three lines');
ok(iss.lines.every((l) => l.has_notice && l.sent === 'approved'), 'each with its notice, approved', iss.lines);
ok(/^[0-9a-f]{64}$/.test(iss.hash), 'frozen with a hash');
const pdf = await fileBytes(api, 'calls.notice', { line: iss.lines[0].id }, 'finance@venture.test');
ok(Buffer.from(pdf.bytes.slice(0, 5)).toString() === '%PDF-', 'the notice is a PDF');
const ptext = await pdfText(pdf.bytes);
ok(ptext.indexOf('000123456789') >= 0 && ptext.indexOf('confirm these wire instructions by phone') >= 0, 'with the wire block and the phone check');
const csv = await api.call('calls.notice', { line: iss.lines[0].id, format: 'csv' }, FIN);
ok(String(csv.body).startsWith('Fund,Limited partner,Notice'), 'and its ILPA CSV', String(csv.body).slice(0, 80));
await refuses(api, 'calls.notice', { line: iss.lines[0].id }, A, 403, 'agent_not_permitted', 'your AI agent cannot open a notice (wire details)');
const led = await api.op('ledger.list', { fund: 'Fund I' }, FIN);
eq(led.total, 6, 'ledger: five LP rows and the investment in Acme');
await refuses(api, 'calls.preview', { event: d1.id }, FIN, 409, 'conflict', 'an issued call does not change');

section('metrics after the call (net beside gross)');
const m1 = (await api.op('metrics.fund', { fund: 'Fund I', day: '2026-01-31' }, PA)).metrics;
eq(m1.paid_in_minor, 522500000, 'paid-in 5,225,000.00');
eq(m1.nav_minor, 500000000, 'NAV: Acme at cost (no mark), cash nets to zero');
eq(m1.tvpi_e8, 95693780, 'TVPI 0.95693780 = NAV over paid-in');
eq(m1.dpi_e8 + m1.rvpi_e8, m1.tvpi_e8, 'TVPI = DPI + RVPI');
eq(m1.gross_moic_e8, 100000000, 'gross MOIC 1.00x at cost');

section('payments');
const alLine = iss.lines.find((l) => l.lp_name === 'Alpine Endowment');
const pp = await api.op('payments.record', { line: alLine.id, reference: 'ALP-0119', why: 'Bank credit 3,150,000.00 from Alpine on 2026-01-18', evidence: 'ALPINE ENDOWMENT 3150000.00' }, A);
ok(pp.proposed === true, 'your AI agent matching a receipt is a proposal', pp);
await api.op('proposals.accept', { proposal: pp.proposal }, FIN);
for (const l of iss.lines.filter((x) => x.lp_name !== 'Alpine Endowment')) await api.op('payments.record', { line: l.id, day: '2026-01-19' }, FIN);
const after = (await api.op('calls.get', { event: d1.id }, FIN)).event;
eq(after.status + ' ' + after.paid_ppm, 'settled 1000000', 'every line paid: settled, Paid 100%');
await refuses(api, 'payments.record', { line: alLine.id, amount: '1.00' }, FIN, 409, 'already_paid', 'no payment beyond the line');

section('a late call: Next items with Record received and Remind');
const d2 = (await api.op('calls.draft', { fund: 'Fund I', fees: true, notice_day: '2026-04-01' }, FIN)).event;
eq(d2.purposes[0].from_day + ' ' + d2.purposes[0].to_day, '2026-04-01 2026-06-30', 'the next fee period follows the last one');
const p2 = (await api.op('calls.preview', { event: d2.id }, FIN)).event;
eq(p2.preview.lines.length, 2, 'fees only: no line for the GP');
eq(p2.preview.totals.total_minor, 22500000, '225,000.00 of fees');
const i2 = (await api.op('calls.issue', { event: d2.id }, { as: 'finance@venture.test', pin: true })).event;
const nx = await api.op('next.list', { kinds: 'payment' }, FIN);
eq(nx.items.length, 2, 'two overdue payments in Next');
const it = nx.items.find((x) => x.title === 'Beacon Family Office');
eq(it.figures[0].value, 'USD 75,000.00', 'with the amount due');
eq(it.actions.map((a) => a.op), ['payments.record', 'payments.remind'], 'Record received and Remind');
const rem = await api.op('payments.remind', it.actions[1].params, FIN);
eq(rem.message.status, 'approved', 'the reminder goes out (within a minute)');
await api.op(it.actions[0].op, it.actions[0].params, FIN);
eq((await api.op('next.list', { kinds: 'payment' }, FIN)).items.length, 1, 'one left after Record received');
eq((await api.op('next.list', { kinds: 'payment' }, AN)).items.length, 0, 'the analyst has no payment items');

section('distribution with the waterfall estimate');
const wf = (await api.op('waterfall.preview', { fund: 'Fund I', amount: '20000000.00', day: '2026-07-01' }, PA)).waterfall;
eq(wf.carry_minor, 291000000, 'European, no hurdle: 20% of the 14,550,000.00 above the 5,450,000.00 paid in = 2,910,000.00 carry');
eq(wf.estimate, true, 'labelled an estimate');
const dd = (await api.op('distributions.draft', { fund: 'Fund I', amount: '1000000.00', holding: lumen, proceeds: '1200000.00', notice_day: '2026-06-15' }, FIN)).event;
eq(dd.number, 'DI-001', 'DI-001');
const dp = (await api.op('distributions.preview', { event: dd.id }, FIN)).event;
eq(dp.preview.waterfall.carry_minor, 0, 'all return of capital: no carry yet');
eq(dp.preview.totals.dist_capital, 100000000, '1,000,000.00 return of capital');
eq(dp.preview.lines.reduce((s, l) => s + l.total_minor, 0), 100000000, 'lines sum exactly');
eq(lineOf(dp.preview.lines, 'Alpine Endowment').total_minor, 60550459, 'Alpine pro rata of contributed capital (330/545)');
const di = (await api.op('distributions.issue', { event: dd.id }, { as: 'finance@venture.test', pin: true })).event;
eq(di.status, 'issued', 'issued');
const m2 = (await api.op('metrics.fund', { fund: 'Fund I', day: '2026-07-01' }, PA)).metrics;
eq(m2.distributed_minor, 100000000, 'distributed 1,000,000.00');
eq(m2.dpi_e8, 18348624, 'DPI 0.18348624 (1.0M over 5.45M)');
ok(m2.gross_moic_e8 > 100000000, 'gross MOIC above 1x with the proceeds', m2.gross_moic_e8);

section('voids');
const d3 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'other', amount: '10000.00', label: 'Legal', notice_day: '2026-07-01' }, FIN)).event;
await api.op('calls.preview', { event: d3.id }, FIN);
await api.op('calls.issue', { event: d3.id }, { as: 'finance@venture.test', pin: true });
const before = (await api.op('metrics.fund', { fund: 'Fund I', day: '2026-12-31' }, PA)).metrics.paid_in_minor;
await api.op('calls.void', { event: d3.id, reason: 'Sent in error' }, { as: 'finance@venture.test', pin: true });
const afterV = (await api.op('metrics.fund', { fund: 'Fund I', day: '2026-12-31' }, PA)).metrics.paid_in_minor;
eq(before - afterV, 1000000, 'the void reverses the call in the ledger (rows are never edited)');
eq((await api.op('ledger.list', { fund: 'Fund I', type: 'call_other' }, FIN)).total, 6, 'three rows and their three reversals');
await refuses(api, 'calls.void', { event: i2.id }, { as: 'finance@venture.test', pin: true }, 409, 'payments_recorded', 'a call with payments is not voided');

section('opening balances for a fund moving in');
await api.op('entities.save', { kind: 'fund', name: 'Fund II', short_name: 'Fund II', currency: 'USD', vintage: 2020, first_close_day: '2020-03-01' }, O);
await api.op('commitments.save', { fund: 'Fund II', lp: alpine.id, amount: '20000000.00' }, FIN);
const fund2 = (await api.op('funds.get', { fund: 'Fund II' }, O)).fund;
const old = await addHolding(api, 'Fund II', 'Orbit Labs', 50000);
const op = await api.op('ledger.opening', { fund: 'Fund II', day: '2025-12-31', lps: JSON.stringify([{ lp: alpine.id, contributed: '12000000.00', distributed: '3000000.00', recallable: '1000000.00' }]), holdings: JSON.stringify([{ holding: old, cost: '9000000.00', day: '2021-05-01' }]), cash: '500000.00' }, { as: 'finance@venture.test', pin: true });
eq(op.metrics.paid_in_minor, 1200000000, 'paid-in 12,000,000.00 from the opening');
eq(op.metrics.nav_minor, 950000000, 'NAV: Orbit at cost 9,000,000.00 plus cash 500,000.00');
const acct = (await api.op('metrics.lp', { fund: 'Fund II', lp: alpine.id }, FIN)).account;
eq([acct.contributed_minor, acct.unfunded_minor, acct.recallable_minor, acct.callable_minor], [1200000000, 800000000, 100000000, 900000000], 'the capital account: unfunded 8M, recallable 1M, callable 9M');
await refuses(api, 'ledger.opening', { fund: 'Fund II', day: '2025-12-31', cash: '1.00' }, { as: 'finance@venture.test', pin: true }, 409, 'opening_exists', 'opening balances come first, once');

section('statements and reconciliation');
const st = (await api.op('statements.import', { fund: 'Fund I', period_end: '2026-06-30', rows: JSON.stringify([{ 'Investor Name': 'Alpine Endowment', 'Paid-in': '3,300,000.00' }, { 'Investor Name': 'Beacon Family Office', 'Paid-in': '1650000.00' }, { 'Investor Name': 'GP Commit LLC', 'Paid-in': '600000.00' }]) }, FIN)).statement;
eq(st.diffs.length, 1, 'one difference: the GP paid-in');
eq(st.diffs[0].diff_minor, 10000000, 'theirs is 100,000.00 more');
eq(Object.keys(st.agent || {}).length, 0, 'an import asks your AI agent nothing by itself');
const rq = await api.op('agent.ask', { trigger: 'reconcile', record: st.id }, FIN);
ok(rq.request !== '' && rq.record === st.id, 'Ask your AI agent: one fire of reconcile with the statement', rq);
await api.op('statements.explain', { statement: st.id, index: 0, explanation: 'The administrator booked the July legal call (CC-003) that was voided.' }, A);
const nxs = await api.op('next.list', { kinds: 'verify' }, FIN);
ok(nxs.items.some((i) => i.key === 'funds:stmt:' + st.id && i.agent === true), 'Next: the statement with your AI agent\'s explanation');
await refuses(api, 'statements.resolve', { statement: st.id, all: true }, A, 403, 'agent_not_permitted', 'people resolve differences');
eq((await api.op('statements.resolve', { statement: st.id, all: true }, FIN)).statement.status, 'reconciled', 'Accept all: reconciled');
const bank = await api.op('statements.import', { fund: 'Fund I', source: 'bank', csv: 'Date,Amount,Reference,Payer\n2026-04-20,"150,000.00",CAP CALL Q2,ALPINE ENDOWMENT\n' }, A);
ok(bank.proposed === true, "your AI agent's statement import is a proposal");
const bacc = await api.op('proposals.accept', { proposal: bank.proposal }, FIN);
eq(bacc.applied, 1, 'accepted');
const bst = (await api.op('statements.list', { fund: 'Fund I' }, FIN)).statements.find((s) => s.source === 'bank');
const bget = (await api.op('statements.get', { statement: bst.id }, FIN)).statement;
eq(bget.diffs[0].match && bget.diffs[0].match.lp_name, 'Alpine Endowment', 'the receipt matches the one line still due of that amount');

section('exports');
await refuses(api, 'exports.ilpa', { fund: 'Fund I' }, FIN, 400, 'missing_param', 'the ILPA export needs the PIN');
const ilpa = await api.call('exports.ilpa', { fund: 'Fund I' }, { as: 'finance@venture.test', pin: true });
ok(ilpa.status === 200 && String(ilpa.body).startsWith('Fund,Notice,Kind'), 'ILPA capital call and distribution CSV', String(ilpa.body).slice(0, 80));
ok(String(ilpa.body).indexOf('Capital call: management fees') > 0, 'with ILPA transaction types');
const perf = await api.call('exports.ilpa', { fund: 'Fund I', template: 'performance' }, { as: 'finance@venture.test', pin: true });
ok(String(perf.body).indexOf('Net asset value') > 0 && String(perf.body).indexOf('Fund (gross)') > 0, 'Performance Template cash flows, net and gross');
const x = await api.call('exports.xlsx', { fund: 'Fund I', table: 'lps' }, FIN);
ok(x.status === 200 && String(x.body).startsWith('PK'), 'XLSX of the LP table', x.status);

section('sending (the minute job)');
let sent = [];
for (let i = 0; i < 40; i++) {
  sent = (await bridge.sent()).sent;
  if (sent.length >= 5) break;
  await sleep(2500);
}
ok(sent.length >= 5, 'notices left by Gmail (' + sent.length + ')', sent.map((s) => s.subject));
const n1 = sent.find((s) => String(s.subject).indexOf('CC-001') >= 0);
ok(n1 && Array.isArray(n1.attachments) && n1.attachments.length === 2, 'each with the PDF and the CSV attached', n1);

const s = summary('t02_capital');
process.exitCode = s.failed > 0 ? 1 : 0;
