// Funds module, seeded: the quarter close (open, marks by your AI agent through mark_note, Approve all with
// the PIN from Next, freeze with a hash, the letter by lp_letter, edit, finalise, send packs), reserves with
// sourced assumptions, scenarios, the fund raise board and LP questions.
//   VO_APP=<scratch app> VO_PORT=3190 VO_BRIDGE=3290 node t03_close.mjs
import { DEMO, bridge, eq, fresh, member, newApi, ok, refuses, section, setupFirm, sleep, summary, addHolding, fileBytes, pdfText } from './lib.mjs';

fresh();
await bridge.reset();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
const FIN = { as: 'finance@venture.test' };
const PA = { as: 'partner@venture.test' };
const AN = { as: 'analyst@venture.test' };
const PL = { as: 'platform@venture.test' };
for (const [e, r, n] of [
  ['finance@venture.test', 'finance', 'Fiona Finance'],
  ['finance2@venture.test', 'finance', 'Fred Finance'],
  ['partner@venture.test', 'partner', 'Paul Partner'],
  ['analyst@venture.test', 'analyst', 'Ann Analyst'],
  ['platform@venture.test', 'platform', 'Pia Platform'],
]) {
  await member(api, e, r, n);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: e });
}
await api.op('entities.save', { entity: 'Fund I', first_close_day: '2025-01-15', legal_name: 'Northwind Ventures Fund I, L.P.', short_name: 'Fund I' }, O);
const fund = (await api.op('funds.get', {}, O)).fund;
const alpine = (await api.op('lps.upsert', { name: 'Alpine Endowment', kind: 'endowment', contacts: JSON.stringify([{ name: 'Ana Alp', email: 'ana@alpine.example', primary: true }]) }, FIN)).lp;
const beacon = (await api.op('lps.upsert', { name: 'Beacon Family Office', kind: 'family_office', contacts: JSON.stringify([{ name: 'Ben Bea', email: 'ben@beacon.example' }]) }, FIN)).lp;
await api.op('commitments.save', { fund: 'Fund I', lp: alpine.id, amount: '30000000.00' }, FIN);
await api.op('commitments.save', { fund: 'Fund I', lp: beacon.id, amount: '20000000.00' }, FIN);
const acme = await addHolding(api, 'Fund I', 'Acme Robotics', 100000);
const lumen = await addHolding(api, 'Fund I', 'Lumen Health', 80000);
await api.op('bank.change', { entity: 'Fund I', bank_name: 'First Trust', account_number: '000123456789' }, { as: 'finance@venture.test', pin: true });
await api.op('bank.approve', { block: (await api.op('bank.list', {}, FIN)).blocks[0].id }, { as: 'finance2@venture.test', pin: true });
const c1 = (await api.op('calls.draft', { fund: 'Fund I', purposes: JSON.stringify([{ type: 'investment', amount: '3000000.00', holding: acme }, { type: 'investment', amount: '2000000.00', holding: lumen }]), notice_day: '2026-02-02' }, FIN)).event;
await api.op('calls.preview', { event: c1.id }, FIN);
await api.op('calls.issue', { event: c1.id }, { as: 'finance@venture.test', pin: true });

section('open the quarter; Ask your AI agent for the marks (one trigger for the quarter)');
await refuses(api, 'quarters.open', { fund: 'Fund I', period_end: '2026-03-30' }, FIN, 400, 'invalid_param', 'a quarter end only');
const qo = await api.op('quarters.open', { fund: 'Fund I', period_end: '2026-03-31' }, FIN);
eq(qo.quarter.label, 'Q1 2026', 'Q1 2026 open');
eq(qo.holdings_without_mark.length, 2, 'both holdings have no mark yet');
eq(qo.quarter.steps.at, 0, 'StepTrack at Open');
const q = qo.quarter;
eq(Object.keys(q.agent || {}).length, 0, 'opening asks your AI agent nothing by itself');
const mk = await api.op('agent.ask', { trigger: 'mark_notes', record: q.id }, FIN);
ok(mk.request !== '' && mk.record === q.id, 'Ask your AI agent for marks: ONE fire for the quarter (never one per holding)', mk);
await refuses(api, 'marks.draft', { quarter: q.id, holding: acme, method: 'calibrated_round', value: '4500000.00', rationale: 'Series A at 2x' }, A, 400, 'unsourced_assumption', 'a mark from your AI agent needs sourced inputs');
for (const h of qo.holdings_without_mark) {
  const hid = h.holding ?? h.id;
  const v = hid === acme ? '4500000.00' : '1500000.00';
  const method = hid === acme ? 'calibrated_round' : 'write_down';
  await api.op('marks.draft', { quarter: q.id, holding: hid, method, value: v, rationale: 'Calibrated to the latest round and verified ARR.', inputs: JSON.stringify([{ label: 'Series A price', value: '2.00', source: 'Series A SPA, page 3' }]) }, A);
}
const ml = await api.op('marks.list', { fund: 'Fund I' }, PA);
eq(ml.totals.drafts, 2, 'two draft marks');
eq(ml.totals.change_minor, 100000000, 'change +1,000,000.00 (4.5M + 1.5M over 5M at cost)');
eq(ml.holdings.find((h) => h.holding === acme).quarter_mark.method, 'calibrated_round', 'method chip data');
eq(ml.quarter.steps.at, 1, 'StepTrack at Marks');

section('Approve all from Next (PIN; finance or a partner)');
const nxp = await api.op('next.list', { kinds: 'mark' }, PA);
const card = nxp.items.find((i) => i.key === 'funds:marks:' + q.id);
ok(card && card.card === 'marks' && card.agent === true, 'the partner has the marks card prepared by your AI agent', nxp.items);
eq(card.actions[0].label + ' ' + card.actions[0].pin, 'Approve all true', 'Approve all with the PIN');
eq((await api.op('next.list', { kinds: 'mark' }, AN)).items.length, 0, 'not the analyst');
eq((await api.op('next.list', { kinds: 'mark' }, PL)).items.length, 0, 'not the platform lead');
await refuses(api, 'marks.approve', { quarter: q.id }, { as: 'analyst@venture.test', pin: true }, 403, 'not_permitted', 'the analyst cannot approve marks');
await refuses(api, 'marks.approve', { quarter: q.id }, A, 403, 'agent_not_permitted', 'nor your AI agent');
const appr = await api.op(card.actions[0].op, card.actions[0].params, { as: 'partner@venture.test', pin: true });
eq(appr.approved.length, 2, 'both approved');
const m = (await api.op('metrics.fund', { fund: 'Fund I', day: '2026-03-31' }, PA)).metrics;
eq(m.nav_minor, 600000000, 'NAV 6,000,000.00 at the approved marks');
eq(m.gross_moic_e8, 120000000, 'gross MOIC 1.20x');
eq(m.tvpi_e8, 120000000, 'TVPI 1.20x (no fees called)');
const mo = await api.op('metrics.holding', { fund: 'Fund I', holding: acme, day: '2026-03-31' }, PA);
eq(mo.holding.value_minor + ' ' + mo.holding.method, '450000000 calibrated_round', 'the holding at its mark');

section('freeze with the PIN');
await refuses(api, 'quarters.freeze', { quarter: q.id }, PA, 403, 'not_permitted', 'a partner does not freeze (finance)');
const fr = await api.op('quarters.freeze', { quarter: q.id }, { as: 'finance@venture.test', pin: true });
ok(/^[0-9a-f]{64}$/.test(fr.hash), 'snapshot hash');
eq(fr.quarter.status, 'frozen', 'frozen');
eq(fr.quarter.steps.at, 2, 'StepTrack at Frozen');
await refuses(api, 'marks.draft', { quarter: q.id, holding: acme, method: 'multiples', value: '1.00', rationale: 'x' }, FIN, 409, 'quarter_closed', 'marks no longer change');
const qg = await api.op('quarters.get', { quarter: q.id }, FIN);
eq(qg.lps.length, 2, 'two LP statements frozen');
eq(qg.lps.find((x) => x.lp_name === 'Alpine Endowment').nav_share_minor, 360000000, 'Alpine NAV share 3,600,000.00 (60%)');

section('the letter by your AI agent, edited by a person');
eq(Object.keys(fr.quarter.agent || {}).filter((k) => k === 'lp_letter').length, 0, 'freezing asks nothing by itself');
const lk = await api.op('agent.ask', { trigger: 'lp_letter', record: q.id }, FIN);
ok(lk.request !== '', 'Ask your AI agent for the letter: one fire of lp_letter for the quarter', lk);
await api.op('reports.letter-draft', { quarter: q.id, paragraphs: JSON.stringify([{ text: 'The fund called 5,000,000.00 for Acme Robotics and Lumen Health.', cites: ['calls.list'] }, { text: 'Net TVPI 1.20x beside gross MOIC 1.20x.', cites: ['quarters.get'] }, 'Acme raised its Series A.']) }, A);
const qg2 = await api.op('quarters.get', { quarter: q.id }, PA);
eq(qg2.letter.paragraphs.length, 3, 'three proposed paragraphs');
ok(qg2.letter.paragraphs.every((x) => x.by === 'agent' && x.state === 'proposed'), 'marked as written by your AI agent');
eq(qg2.quarter.steps.at, 3, 'StepTrack at Letter');
ok(qg2.quarter.agent.lp_letter && !qg2.quarter.agent.lp_letter.pending, 'the draft landed the ask', qg2.quarter.agent);
const nxl = await api.op('next.list', { kinds: 'draft' }, PA);
ok(nxl.items.some((i) => i.key === 'funds:letter:' + q.id && i.actions[0].op === 'reports.finalize'), 'Next: the letter with Finalize (PIN)');
const paras = qg2.letter.paragraphs.slice(0, 2).map((x) => ({ id: x.id, text: x.text }));
paras[1].text = 'Net TVPI 1.20x beside gross MOIC 1.20x, at equal prominence.';
const ls = await api.op('reports.letter-save', { quarter: q.id, paragraphs: JSON.stringify(paras) }, PA);
eq(ls.letter.paragraphs.length, 2, 'the partner removed one and edited one');
ok(ls.letter.typed_chars > 0 && ls.letter.ai_chars > 0, 'AI-use counts: typed and agent-written', ls.letter);
await refuses(api, 'reports.letter-save', { quarter: q.id, paragraphs: '[]' }, AN, 403, 'not_permitted', 'the analyst does not edit the letter');

section('finalise (PIN) and send the packs');
const fz = await api.op('reports.finalize', { quarter: q.id }, { as: 'partner@venture.test', pin: true });
eq(fz.packs, 2, 'two LP packs rendered');
const qg3 = await api.op('quarters.get', { quarter: q.id }, FIN);
const pk = await fileBytes(api, 'reports.pack', { report: qg3.packs[0].id }, 'finance@venture.test');
const pktext = await pdfText(pk.bytes);
ok(pktext.indexOf('Capital account statement') >= 0 && pktext.indexOf('Net TVPI 1.20x beside gross MOIC 1.20x') >= 0, 'the pack PDF has the letter and the statement');
const st = await api.op('reports.statement-preview', { quarter: q.id, lp: alpine.id }, FIN);
eq(st.lp.account.contributed_minor, 300000000, 'statement: Alpine contributed 3,000,000.00');
await refuses(api, 'reports.send', { quarter: q.id }, PA, 403, 'not_permitted', 'the partner finalises; finance sends');
const sd = await api.op('reports.send', { quarter: q.id }, FIN);
eq(sd.queued, 2, 'two packs handed to the sender');
let sent = [];
for (let i = 0; i < 40; i++) {
  sent = (await bridge.sent()).sent.filter((x) => String(x.subject).indexOf('Q1 2026 report') === 0);
  if (sent.length >= 2) break;
  await sleep(2500);
}
eq(sent.length, 2, 'both packs sent by Gmail');
ok(sent[0].attachments.length >= 2, 'the pack and the notice of the quarter attached', sent[0].attachments);
let qs = null;
for (let i = 0; i < 10; i++) {
  qs = (await api.op('quarters.get', { quarter: q.id }, FIN)).quarter;
  if (qs.status === 'sent') break;
  await sleep(1000);
}
eq(qs.status, 'sent', 'the quarter is Sent once every pack left');
eq(qs.steps.done, true, 'StepTrack complete');

section('reserves with sourced assumptions');
await refuses(api, 'reserves.plan-save', { fund: 'Fund I', holding: acme, target: '10', rounds: '2', allocated: '2500000.00', assumptions: JSON.stringify([{ round: 1, raise: '10000000.00', post_money: '50000000.00', source: 'Board deck Q1' }, { round: 2, raise: '30000000.00', post_money: '150000000.00', source: '' }]) }, FIN, 400, 'unsourced_assumption', 'an unsourced assumption is refused');
const rp = await api.op('reserves.plan-save', { fund: 'Fund I', holding: acme, target: '10', rounds: '2', allocated: '2500000.00', assumptions: JSON.stringify([{ round: 1, raise: '10000000.00', post_money: '50000000.00', source: 'Board deck Q1' }, { round: 2, raise: '30000000.00', post_money: '150000000.00', source: 'Partner view (Paul)' }]) }, A);
ok(rp.proposed === true, "your AI agent's plan is a proposal");
await api.op('proposals.accept', { proposal: rp.proposal }, FIN);
const rv = await api.op('reserves.get', { fund: 'Fund I' }, PA);
const ra = rv.holdings.find((h) => h.holding === acme);
eq(ra.needed_minor, 400000000, 'needed 4,000,000.00 to hold 10% over two rounds (engine vector)');
eq(ra.shortfall_minor, 150000000, 'shortfall 1,500,000.00 against 2,500,000.00 allocated');
eq(rv.totals.budget_minor, 4500000000, 'budget: callable capital 45,000,000.00');
const pv = await api.op('reserves.preview', { fund: 'Fund I', holdings: JSON.stringify([{ holding: acme, allocated: '4000000.00' }]) }, PA);
eq(pv.holdings.find((h) => h.holding === acme).shortfall_minor, 0, 'the preview with 4,000,000.00 allocated has no shortfall');
await api.op('scenarios.save', { fund: 'Fund I', name: 'Bigger A', holdings: JSON.stringify([{ holding: acme, allocated: '4000000.00' }]) }, FIN);
const sc = await api.op('scenarios.compare', { fund: 'Fund I' }, PA);
eq(sc.scenarios.map((x) => x.name), ['Current plan', 'Bigger A'], 'the current plan beside the scenario');
eq(sc.scenarios[1].totals.shortfall_minor, 0, 'the scenario closes the shortfall');

section('the fund raise board');
const ad = await api.op('raise.add', { fund: 'Fund I', company: 'Cedar Pension', target: '25000000.00' }, FIN);
ok(ad.deal && /^D-/.test(ad.deal.number), 'a prospect on the lp_raise pipeline', ad);
await api.op('raise.move', { deal: ad.deal.id, stage: 'soft_circle' }, FIN);
const ss = await api.op('raise.soft', { deal: ad.deal.id, amount: '20000000.00', kind: 'pension' }, FIN);
eq(ss.commitment.status, 'soft', 'a soft commitment');
const bd = await api.op('raise.board', { fund: 'Fund I' }, FIN);
const col = bd.stages.find((s) => s.key === 'soft_circle');
eq(col.prospects.length + ' ' + col.target_minor + ' ' + col.soft_minor, '1 2500000000 2000000000', 'the soft circle column: target 25M, soft 20M');
eq(bd.totals.signed_minor + ' ' + bd.totals.soft_minor, '5000000000 2000000000', 'signed 50M and soft 20M against the target');
const call2 = (await api.op('calls.draft', { fund: 'Fund I', purpose: 'other', amount: '100000.00', notice_day: '2026-08-03' }, FIN)).event;
const p2 = (await api.op('calls.preview', { event: call2.id }, FIN)).event;
eq(p2.preview.lines.length, 2, 'a soft commitment is not called');
await refuses(api, 'raise.board', { fund: 'Fund I' }, AN, 403, 'not_permitted', 'the raise is LP data');

section('LP questions');
const lq = await api.op('lpq.log', { lp: alpine.id, fund: 'Fund I', question: 'What was our NAV at the end of Q1?' }, FIN);
ok(lq.request !== '' && lq.question.agent.lp_answer.pending, 'logging it asked your AI agent (lp_answer with the question)', lq);
const pl = (await api.op('lpq.list', { lp: alpine.id }, A)).questions.find((x) => x.id === lq.question.id);
eq(pl.to, ['ana@alpine.example'], 'your AI agent reads the question with the LP notice contacts');
await api.op('outbound.draft', { kind: 'reply', module: 'lps', to: JSON.stringify(pl.to), subject: 'Re: NAV at Q1', body: 'Your share of NAV at 31 March 2026 was 3,600,000.00 (Q1 2026 statement).', ref_collection: 'lp_questions', ref_id: pl.id }, A);
const lql = await api.op('lpq.list', {}, FIN);
eq(lql.questions[0].drafts.length, 1, 'the drafted answer is listed');
ok((await api.op('next.list', { kinds: 'draft' }, FIN)).items.some((i) => i.title === 'Re: NAV at Q1'), 'and waits in Next for a person to send');

section('undo and audit');
const d = await api.op('calls.draft', { fund: 'Fund I', purpose: 'expenses', amount: '5000.00' }, FIN);
const un = await api.op('activity.undo', { entry: d._activity }, FIN);
eq(un.undone, 1, 'a draft is one undoable unit');
const au = await api.op('audit.list', { collection: 'capital_events' }, O);
ok(au.rows === undefined ? au.entries.length > 0 : au.rows.length > 0, 'capital writes are audited');

const s = summary('t03_close');
process.exitCode = s.failed > 0 ? 1 : 0;
