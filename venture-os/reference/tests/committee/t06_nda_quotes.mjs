// t06: NDA quotes in the committee (the rule of anchors.resolve, intake M5). The decision snapshot keeps the
// intake facts and confirmed diligence answers whole; every read (decisions.record, decisions.get, decisions.list,
// the anti-portfolio) withholds the verbatim quotes of a deck marked NDA from your AI agent while nobody asked it
// about the deal and from members outside the deal team (quote '', hidden true, hidden_reason); the deal team, and
// your AI agent while a person's NDA ask about the deal waits (fix 8), read them. Memo block citations follow the same rule.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, DEMO, newApi, fresh, team, section, ok, summary, waitText, sleep, O, A, PEOPLE, as } from './lib.mjs';

fresh();
const api = newApi();
await team(api);
const P1 = as('p1');
const P2 = as('p2');

const Q_ROUND = 'Seed round, November 2026';
const Q_RAISE = 'Raising USD 3,000,000 on a post-money SAFE';
const Q_CAP = 'Valuation cap: USD 15,000,000 post-money';
const has = (body, q) => JSON.stringify(body).includes(q);
const noQuote = (body) => !has(body, Q_ROUND) && !has(body, Q_RAISE) && !has(body, Q_CAP);

async function dropDeck(name, bytes) {
  await api.op('auth.me', {}, O);
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const res = await fetch(api.base + '/api/ops/intake/add', { method: 'POST', headers: { authorization: api.tokens.get(DEMO.owner), accept: 'application/json' }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}


section('a deck read at intake becomes a deal with quoted facts');
const deck = readFileSync(join(APP, 'tools', 'dev', 'fixtures', 'decks', 'acme_robotics_seed.pdf'));
const up = await dropDeck('Acme Robotics seed.pdf', deck);
ok(up.status === 200 && up.body && up.body.id, 'the deck is dropped into intake', up);
const item = up.body.id;
ok(up.body.triage_state === 'waiting', 'dropping it asked your AI agent to read it (deck_triage)', up.body.triage_state);
const wk = await api.op('triage.start', { item }, A);
const fileId = wk.files[0].id;
const ft = await waitText(api, fileId, A);
ok(ft && ft.file && ft.file.text_state === 'ready', 'the deck text is ready', ft && ft.file);
const fs1 = await api.call('triage.facts-save', {
  item,
  company: { name: 'Acme Robotics', domain: 'acmerobotics.ai' },
  one_liner: 'Mobile picking arms for mid-size warehouses',
  facts: [
    { key: 'round_type', value: 'seed', grade: 'founder_reported', file: fileId, page: 1, quote: Q_ROUND },
    { key: 'raise_minor', value: '3000000', currency: 'USD', grade: 'founder_reported', file: fileId, page: 7, quote: Q_RAISE },
    { key: 'currency', value: 'USD', grade: 'founder_reported', file: fileId, page: 7 },
  ],
}, A);
ok(fs1.status === 200, 'the facts are saved with their quotes', fs1.body);
const adv = await api.op('intake.advance', { item, point: PEOPLE.p1 }, O);
const D = adv.deal.number;
await api.op('deals.team', { deal: D, add: JSON.stringify([PEOPLE.p1]) }, O);
const dg = (await api.op('deals.get', { deal: D }, O)).deal;
const teamIds = (dg.team || []).map((t) => t.id);
const p2id = ((await api.op('members.list', {}, O)).members || []).find((m) => m.email === PEOPLE.p2).id;
ok(!teamIds.includes(p2id), 'Peter (partner) is outside the deal team; Paula is on it', dg.team);

section('a confirmed diligence answer and a memo cite the deck');
const anc = (await api.op('anchors.create', { file: fileId, page: 7, quote: Q_CAP }, P1)).anchor;
ok(anc && anc.id, 'Paula anchors a passage of the deck', anc);
await api.op('dd.template-apply', { deal: D }, P1);
const qs = (await api.op('dd.get', { deal: D }, P1)).questions ?? [];
const qText = qs.find((q) => q.type === 'text') ?? qs[0];
const da = await api.call('dd.answer', { answers: JSON.stringify([{ question: qText.id, value: qText.type === 'text' ? 'Post-money SAFE with a USD 15M cap' : 'yes', grade: 'artifact', anchors: [anc.id] }]) }, P1);
ok(da.status === 200, 'Paula answers a diligence question citing the deck (confirmed)', da.body);
const m = (await api.op('memos.open', { deal: D }, P1)).memo;
const bs = await api.call('memos.block-save', { memo: m.id, section: 'summary', text: 'The round is a post-money SAFE [1].', citations: JSON.stringify([{ kind: 'anchor', anchor: anc.id }]) }, P1);
ok(bs.status === 200 && has(bs.body, Q_CAP), 'the memo cites the passage (Paula reads it)', bs.body);

section('the deck is marked NDA; a partner outside the team records the decision');
const nda = await api.call('files.set-nda', { file: fileId, nda: true }, O);
ok(nda.status === 200, 'the deck is marked NDA', nda.body);
const rec = await api.call('decisions.record', { deal: D, outcome: 'pass', reason: 'market', note: 'Too early' }, { as: PEOPLE.p2, pin: true });
ok(rec.status === 200, 'Peter records a pass', rec.body);
const decision = rec.body.decision;
ok(noQuote(rec.body), 'decisions.record answers Peter without an NDA quote');
const rf = (decision.snapshot.facts || []).find((f) => f.key === 'raise_minor');
ok(rf && rf.hidden === true && rf.quote === '' && rf.hidden_reason === 'nda' && rf.page === 7 && rf.value !== undefined, 'the fact keeps value and page, quote withheld (nda)', rf);

section('decisions.get: your AI agent nobody asked about the deal, and a partner outside the team');
const ga = await api.op('decisions.get', { decision: decision.id }, A);
ok(noQuote(ga), 'your AI agent nobody asked about the deal reads no NDA quote', ga.decision.snapshot);
const fa = ga.decision.snapshot.facts.find((f) => f.key === 'round_type');
ok(fa.hidden === true && fa.quote === '' && fa.hidden_reason === 'nda_not_asked', 'the fact is hidden (nda_not_asked)', fa);
const ca = ga.decision.snapshot.diligence.answers[0].cites[0];
ok(ca && ca.hidden === true && ca.quote === '' && ca.hidden_reason === 'nda_not_asked' && ca.anchor === anc.id && ca.page === 7, 'the diligence citation is hidden (nda_not_asked), anchor and page stay', ca);
const gp = await api.op('decisions.get', { decision: decision.id }, P2);
ok(noQuote(gp), 'Peter (outside the team) reads no NDA quote');
ok(gp.decision.snapshot.facts.find((f) => f.key === 'raise_minor').hidden_reason === 'nda' && gp.decision.snapshot.diligence.answers[0].cites[0].hidden_reason === 'nda', 'facts and diligence citations say nda');
const gl = await api.op('decisions.list', {}, A);
const glp = await api.op('decisions.list', {}, P2);
const apA = await api.op('decisions.anti-portfolio', {}, A);
const apP = await api.op('decisions.anti-portfolio', {}, P2);
ok(apA.rows.some((r) => r.decision === decision.id) && noQuote(gl) && noQuote(glp) && noQuote(apA) && noQuote(apP), 'the decision log and the anti-portfolio carry no NDA quote');

section('decisions.get: the deal team, and your AI agent while a person asked about the deal');
const gt = await api.op('decisions.get', { decision: decision.id }, P1);
const ft1 = gt.decision.snapshot.facts.find((f) => f.key === 'raise_minor');
ok(ft1.quote === Q_RAISE && ft1.hidden !== true, 'Paula (deal team) reads the fact quote as before', ft1);
ok(gt.decision.snapshot.diligence.answers[0].cites[0].quote.includes(Q_CAP), 'and the diligence citation quote');
const ds = await api.op('memos.draft-sections', { memo: m.id, sections: JSON.stringify(['market']) }, P1);
ok(ds.request !== '', 'Paula asks your AI agent to draft a memo section (memo_sections, an NDA trigger for the deal)', ds);
const gaj = await api.op('decisions.get', { decision: decision.id }, A);
ok(has(gaj, Q_RAISE) && has(gaj, Q_ROUND) && has(gaj, Q_CAP), 'while that ask waits your AI agent reads them');

section('memo citations follow the same rule');
const maj = await api.op('memos.get', { memo: m.id }, A);
ok(maj.memo.sections.find((s) => s.key === 'summary').block.citations[0].quote.includes(Q_CAP), 'while the ask waits your AI agent reads the quote');
await api.op('agent.cannot', { trigger: 'memo_sections', record: m.id, reason: 'Test: nothing to add.' }, A);
const ma = await api.op('memos.get', { memo: m.id }, A);
const cA = ma.memo.sections.find((s) => s.key === 'summary').block.citations[0];
ok(noQuote(ma) && cA.hidden === true && cA.quote === '' && cA.hidden_reason === 'nda_not_asked' && cA.ok === true && cA.page === 7, 'once answered: the citation stands, its quote withheld', cA);
const mp = await api.op('memos.get', { memo: m.id }, P2);
const cP = mp.memo.sections.find((s) => s.key === 'summary').block.citations[0];
ok(noQuote(mp) && cP.hidden === true && cP.hidden_reason === 'nda', 'Peter: quote withheld (nda)', cP);
const mt = await api.op('memos.get', { memo: m.id }, P1);
const cT = mt.memo.sections.find((s) => s.key === 'summary').block.citations[0];
ok(cT.quote.includes(Q_CAP) && cT.hidden !== true, 'Paula reads it as before', cT);

await api.call('files.set-nda', { file: fileId, nda: false }, O);
const s = summary('t06 NDA quotes');
process.exit(s.failed > 0 ? 1 : 0);
