// Funds module: your AI agent's rules end to end (allow, propose, deny), proposals accepted by the right
// person, the LP importer through the kernel's import framework, search, and marks after a follow-on.
//   VO_APP=<scratch app> VO_PORT=3190 VO_BRIDGE=3290 node t04_agent.mjs
import { DEMO, eq, fresh, member, newApi, ok, refuses, section, setupFirm, summary, addHolding } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
const FIN = { as: 'finance@venture.test' };
const PA = { as: 'partner@venture.test' };
for (const [e, r, n] of [
  ['finance@venture.test', 'finance', 'Fiona Finance'],
  ['finance2@venture.test', 'finance', 'Fred Finance'],
  ['partner@venture.test', 'partner', 'Paul Partner'],
]) {
  await member(api, e, r, n);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: e });
}
await api.op('entities.save', { entity: 'Fund I', first_close_day: '2025-01-15', short_name: 'Fund I' }, O);
const fund = (await api.op('funds.get', {}, O)).fund;

section('the LP importer (kernel imports)');
const t = (await api.op('imports.targets', {}, FIN)).targets.find((x) => x.target === 'lp_commitments' || x.name === 'lp_commitments' || x.key === 'lp_commitments');
ok(t !== undefined, 'lp_commitments is an import target');
const csv = 'Investor Name,Type,Contact Email,Fund,Commitment,Fee paying\nAlpine Endowment,endowment,ana@alpine.example,Fund I,"30,000,000.00",yes\nBeacon Family Office,family office,ben@beacon.example,Fund I,15000000,yes\nGP Commit LLC,gp,gp@northwind.example,Fund I,5000000,no\n';
const pv = await api.op('imports.preview', { target: 'lp_commitments', csv }, FIN);
const counts = pv.counts || {};
ok((counts.created || 0) === 3 || (pv.rows || pv.results || []).filter((r) => r.action === 'created').length === 3, 'the preview creates three LPs', pv);
const run = await api.op('imports.run', { target: 'lp_commitments', csv }, FIN);
ok(run.import || run.id || run.counts, 'imported', run);
const lps = await api.op('lps.list', { fund: 'Fund I' }, FIN);
eq(lps.totals.commitment_minor, 5000000000, 'commitments 50,000,000.00');
eq(lps.lps.find((x) => x.name === 'GP Commit LLC').fee_paying, false, 'the GP is not fee-paying');
const imp = await api.op('imports.run', { target: 'lp_commitments', csv }, A);
ok(imp.proposed === true, "your AI agent's import is a proposal");

section('allow: previews, notes, marks drafts, explanations, letters');
const acme = await addHolding(api, 'Fund I', 'Acme Robotics', 100000);
const d = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'investment', amount: '2000000.00', holding: acme, notice_day: '2026-03-02' }, FIN)).event;
eq((await api.op('calls.preview', { event: d.id }, A)).event.status, 'previewed', 'your AI agent may preview');
eq((await api.op('calls.note', { event: d.id, note: 'Ready.' }, A)).event.note_by, 'agent', 'and write the review note');
const w = await api.op('waterfall.preview', { fund: 'Fund I', amount: '1000000.00' }, A);
eq(w.waterfall.estimate, true, 'waterfall estimates are readable');
const ms = await api.op('metrics.sources', { fund: 'Fund I' }, A);
ok(Array.isArray(ms.lp_flows) && ms.rules.net, 'metrics.sources gives the inputs and the rules');

section('propose: distributions, scenarios, payments');
await api.op('bank.change', { entity: 'Fund I', bank_name: 'Bank', account_number: '1234567890' }, { as: 'finance@venture.test', pin: true });
await api.op('bank.approve', { block: (await api.op('bank.list', {}, FIN)).blocks[0].id }, { as: 'finance2@venture.test', pin: true });
await api.op('calls.issue', { event: d.id }, { as: 'finance@venture.test', pin: true });
const dp = await api.op('distributions.draft', { fund: 'Fund I', amount: '500000.00', holding: acme, notice_day: '2026-06-01', why: 'Acme secondary sale proceeds received' }, A);
ok(dp.proposed === true, 'a distribution draft from your AI agent is a proposal');
await refuses(api, 'distributions.draft', { fund: 'Fund I', amount: '-5' }, A, 400, 'invalid_amount', 'an impossible proposal is refused at once (dry run)');
const accd = await api.op('proposals.accept', { proposal: dp.proposal }, FIN);
eq(accd.applied, 1, 'finance accepts: a draft distribution exists');
eq((await api.op('calls.list', { fund: 'Fund I', kind: 'distribution' }, FIN)).events[0].actor === undefined, true, 'listed');
const sp = await api.op('scenarios.save', { fund: 'Fund I', name: 'Downside', holdings: JSON.stringify([{ holding: acme, target: '8', rounds: 1, allocated: '1000000.00', assumptions: [{ round: 1, raise: '10000000.00', post_money: '40000000.00', source: 'Partner view' }] }]) }, A);
ok(sp.proposed === true, 'a scenario from your AI agent is a proposal');
await refuses(api, 'scenarios.save', { fund: 'Fund I', name: 'Bad', holdings: JSON.stringify([{ holding: acme, rounds: 1, assumptions: [{ round: 1, raise: '1.00', post_money: '10.00', source: '' }] }]) }, A, 400, 'unsourced_assumption', 'an unsourced scenario is refused');

section('marks after a follow-on are held at cost until the next mark');
const q = (await api.op('quarters.open', { fund: 'Fund I', period_end: '2026-03-31' }, FIN)).quarter;
await api.op('marks.draft', { quarter: q.id, holding: acme, method: 'calibrated_round', value: '3000000.00', rationale: 'Series A at 1.5x.', inputs: JSON.stringify([{ label: 'A price', value: '1.5', source: 'SPA' }]) }, FIN);
await api.op('marks.approve', { quarter: q.id }, { as: 'partner@venture.test', pin: true });
const d2 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'investment', amount: '1000000.00', holding: acme, notice_day: '2026-05-04' }, FIN)).event;
await api.op('calls.preview', { event: d2.id }, FIN);
await api.op('calls.issue', { event: d2.id }, { as: 'finance@venture.test', pin: true });
const mh = await api.op('metrics.holding', { fund: 'Fund I', holding: acme }, PA);
eq(mh.holding.value_minor, 400000000, 'value 3,000,000.00 mark plus 1,000,000.00 invested since');
eq(mh.holding.cost_minor, 300000000, 'cost 3,000,000.00');

section('search');
const sr = await api.op('search.query', { q: 'alpine' }, FIN);
ok((sr.results || []).some((r) => r.kind === 'lp'), 'LPs are found by Ctrl K', sr.results);
const sr2 = await api.op('search.query', { q: 'CC-00' }, PA);
ok((sr2.results || []).some((r) => r.kind === 'call'), 'calls are found by number', sr2.results);
const sr3 = await api.op('search.query', { q: 'alpine' }, { as: 'owner' });
ok((sr3.results || []).length > 0, 'the owner finds them too');

section('app.guide and the AI use inventory');
const g = await api.op('app.guide', { module: 'funds' }, A);
ok(JSON.stringify(g).indexOf('net (TVPI, DPI, net IRR) beside gross') >= 0, 'the funds section is in app.guide');
const inv = await api.op('ai.inventory', {}, O);
ok(['mark_notes', 'notice_review', 'reconcile', 'lp_letter', 'lp_answer'].every((t) => JSON.stringify(inv).indexOf(t) >= 0), 'the inventory lists the funds triggers');

const s = summary('t04_agent');
process.exitCode = s.failed > 0 ? 1 : 0;
