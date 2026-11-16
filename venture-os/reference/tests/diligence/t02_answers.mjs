// The checklist and answers end to end: apply a checklist, a room file queues dd_answers, your AI agent answers through
// ops with citations (refusals: no citation, wrong unit, k/M amounts, out-of-scope anchors, NDA nobody asked about, a bad
// item refusing the batch), Next's verify card and its Confirm action, reject, re-proposal over a confirmed answer,
// answers by hand, stale confirms, undo, proposals for questions and checklists, auto-apply on entering Diligence,
// NDA quotes hidden from people off the team, restricted deals.
import { fresh, newApi, team, seedDeals, upload, waitText, pdf, DECK, section, ok, eq, refuses, summary, sleep, bridge, PARTNER, PARTNER2, ANALYST, VP } from './lib.mjs';

fresh();
const api = newApi();
await team(api);
const S = await seedDeals(api);
const P = { as: PARTNER };
const A = { as: 'agent' };
const acme = S.deals.acme;
const lumen = S.deals.lumen;

section('a deal without a checklist');
let g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.questions.length === 0 && g.suggested_template === 'seed', 'no questions; the seed checklist is suggested for a seed round', g.suggested_template);
eq(g.room, { files: 0, pages: 0, pages_read: 0, pages_ocr: 0, nda: 0, reading: 0 }, 'an empty room');
ok(g.ask === null, 'nothing asked yet');
eq((await api.op('dd.get', { deal: lumen.number }, { as: PARTNER2 })).suggested_template, 'series_a', 'series_a suggested for a series A round');

section('apply the checklist');
let ap = await api.op('dd.template-apply', { deal: acme.number }, P);
ok(ap.template === 'seed' && ap.added === 51 && ap.request === undefined, 'the seed checklist: 51 questions, nothing asked of your AI agent', ap);
ap = await api.op('dd.template-apply', { deal: acme.number }, P);
ok(ap.added === 0 && ap.kept === 51, 'applying again keeps every question', ap);
g = await api.op('dd.get', { deal: acme.number }, P);
eq(g.areas.map((a) => a.label), ['Team', 'Market', 'Product', 'Traction', 'Financials', 'Legal', 'Technology', 'Customers'], 'areas in checklist order');
ok(g.areas.every((a) => a.total >= 6 && a.answered === 0 && a.confirmed === 0), 'progress per area starts at zero');
ok(g.counts.open === 51, '51 open');
const qk = {};
g.questions.forEach((q) => (qk[q.key] = q));

section('a room file asks nothing by itself; Ask your AI agent fires one trigger for the deal');
const up = await upload(api, { deal: acme.id, folder: 'Deck' }, [{ name: 'acme_deck.pdf', bytes: pdf(DECK) }], PARTNER);
ok(up.status === 200, 'deck uploaded to the room', up.body);
const deckId = up.body.files ? up.body.files[0].id : up.body.file ? up.body.file.id : '';
const t1 = await waitText(api, deckId, PARTNER);
ok(t1 && t1.file.text_state === 'ready', 'the deck has a text layer', t1 && t1.file);
await sleep(300);
const ddFires = async () => (await bridge.fires()).fires.filter((f) => f.trigger === 'diligence_answers');
eq((await ddFires()).length, 0, 'the room file asked your AI agent nothing by itself');
const ask1 = await api.op('dd.ask', { deal: acme.number }, P);
await sleep(300);
const f1 = await ddFires();
ok(f1.length === 1 && f1[0].request_id === ask1.request, 'Ask your AI agent: one fire of diligence_answers for the deal (never one per question)', { f1, ask1 });
await refuses(api, 'dd.ask', { deal: acme.number }, P, 409, 'pending', 'asking again while it waits is refused');
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.room.files === 1 && g.room.pages === 4 && g.room.pages_read === 4, 'room strip: 1 file, 4 pages read', g.room);
ok(g.ask && g.ask.at === 0 && g.ask.open && g.ask.labels.join() === 'Queued,Reading,Answering,Ready', 'StepTrack at Queued', g.ask);

section('your AI agent works on the deal the fire named');
const open = await api.op('dd.get', { deal: acme.number, state: 'open' }, A);
ok(open.questions.length === 51, 'the agent lists the open questions');
const txt = await api.op('files.text', { file: deckId }, A);
ok(txt.pages.length === 4, 'the agent reads the deck as numbered lines');
const anchor = async (page, quote) => (await api.op('anchors.create', { file: deckId, page, quote }, A)).anchor.id;
const aArr = await anchor(2, 'ARR of 1,200,000 USD as of September 2026.');
const aCust = await anchor(2, 'Paying customers: 42');
const aGrowth = await anchor(2, 'Monthly growth 15 percent.');
const aTeam = await anchor(3, 'Full-time team of 14 people.');
const aCto = await anchor(3, 'CTO Dan Chen built the robotics stack.');
const aRaise = await anchor(4, 'Raising 3,000,000 USD on a SAFE.');
const aBurn = await anchor(4, 'Monthly net burn 180,000 USD.');
ok([aArr, aCust, aGrowth, aTeam, aCto, aRaise, aBurn].every((x) => typeof x === 'string' && x.length > 5), 'seven anchors on the deck');

section('refusals: every answer cites, types and units hold, one bad item refuses all');
const ans = (o) => JSON.stringify(o);
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.traction_arr.id, value: '1200000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported' }]) }, A, 400, 'citation_required', 'no citation');
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.traction_arr.id, value: '1.2M', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported', anchors: [aArr] }]) }, A, 400, undefined, 'no k or M amounts');
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.traction_arr.id, value: '1200000', unit: '%', num_kind: 'quoted', grade: 'founder_reported', anchors: [aArr] }]) }, A, 400, undefined, 'an amount question refuses a percent');
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.fin_runway.id, value: '16', unit: 'months', num_kind: 'computed', grade: 'founder_reported', anchors: [aBurn] }]) }, A, 400, undefined, 'a computed number is refused');
// SPEC 0 (qa-cli RULING CLI-08): your AI agent never computes a number, even with its formula.
const comp = await api.call('dd.answer', { answers: ans([{ question: qk.fin_runway.id, value: '16.7', unit: 'months', num_kind: 'computed', formula: '3000000 / 180000', grade: 'founder_reported', anchors: [aRaise, aBurn] }]) }, A);
ok(comp.status === 400 && comp.body.data.items[0].code === 'agent_no_compute', 'your AI agent never submits a computed number', comp.body);
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.market_tam.id, value: '5000000000', unit: 'USD', num_kind: 'external', grade: 'public' }]) }, A, 400, undefined, 'an external number needs its source');
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.team_size.id, value: '14', unit: 'USD', num_kind: 'quoted', grade: 'artifact', anchors: [aTeam] }]) }, A, 400, undefined, 'a people count refuses a currency');
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.team_technical.id, value: 'maybe', grade: 'founder_reported', anchors: [aCto] }]) }, A, 400, undefined, 'yes_no takes yes or no');
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.traction_arr.id, value: '1200000', unit: 'USD', num_kind: 'entered', grade: 'founder_reported', anchors: [aArr] }]) }, A, 400, undefined, 'entered is for people');
// An anchor in another deal's room is outside the citation scope.
await api.op('dd.template-apply', { deal: lumen.number }, { as: PARTNER2 });
const upL = await upload(api, { deal: lumen.id }, [{ name: 'lumen_memo.pdf', bytes: pdf([['Lumen Health', 'ARR of 9,000,000 USD.']]) }], PARTNER2);
const lumenFile = upL.body.files ? upL.body.files[0].id : upL.body.file.id;
await waitText(api, lumenFile, PARTNER2);
const foreign = (await api.op('anchors.create', { file: lumenFile, page: 1, quote: 'ARR of 9,000,000 USD.' }, A)).anchor.id;
await refuses(api, 'dd.answer', { answers: ans([{ question: qk.traction_arr.id, value: '9000000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported', anchors: [foreign] }]) }, A, 400, 'citation_scope', "another deal's file is out of scope");
const bad = await api.call('dd.answer', { answers: ans([{ question: qk.team_size.id, value: '14', num_kind: 'quoted', grade: 'artifact', anchors: [aTeam] }, { question: qk.traction_arr.id, value: '1200000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported' }]) }, A);
ok(bad.status === 400 && bad.body.data.items.length === 1 && bad.body.data.items[0].index === 1, 'a batch with one bad item is refused naming it', bad.body);
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.counts.open === 51, 'nothing was saved from the refused batch');

section('answers land as proposed');
const good = [
  { question: qk.traction_arr.id, value: '1200000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported', anchors: [aArr] },
  { question: qk.traction_customers.id, value: '42', num_kind: 'quoted', grade: 'artifact', anchors: [aCust] },
  { question: qk.traction_growth.id, value: '15', unit: '%', num_kind: 'quoted', grade: 'founder_reported', anchors: [aGrowth] },
  { question: qk.team_size.id, value: '14', num_kind: 'quoted', grade: 'artifact', anchors: [aTeam] },
  { question: qk.team_technical.id, value: 'yes', grade: 'artifact', anchors: [aCto] },
  { question: qk.fin_raise.id, value: '3000000', unit: 'USD', num_kind: 'quoted', grade: 'artifact', anchors: [aRaise] },
  { question: qk.fin_burn.id, value: '180000', unit: 'usd', num_kind: 'quoted', grade: 'founder_reported', anchors: [aBurn] },
  { question: qk.market_tam.id, value: '5000000000', unit: 'USD', num_kind: 'external', grade: 'public', sources: ['https://example.org/warehouse-robotics-market-2026'] },
  { question: qk.fin_runway.id, not_found: true, note: 'Not stated; inputs: raise USD 3,000,000 (p.7), net burn USD 180,000 a month' },
  { question: qk.legal_litigation.id, not_found: true, note: 'Not in the deck.' },
];
const saved = await api.op('dd.answer', { answers: ans(good) }, A);
ok(saved.saved === 8 && saved.checked === 2, '8 answers proposed, 2 questions checked', saved);
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.ask.at === 2 && g.ask.open, 'StepTrack at Answering while questions are still open', g.ask);
const byKey = {};
g.questions.forEach((q) => (byKey[q.key] = q));
eq(byKey.traction_arr.answer.value, 'USD 1,200,000.00', 'an amount shows in its currency');
eq(byKey.traction_growth.answer.value, '15%', 'a percent');
eq(byKey.team_size.answer.value, '14 people', 'a count with its unit');
eq(byKey.fin_burn.answer.unit, 'USD', 'a currency code is upper-cased');
ok(byKey.fin_runway.state === 'open' && /inputs/.test(byKey.fin_runway.check_note), 'a derived figure stays open with its inputs in the note', byKey.fin_runway);
eq(byKey.team_technical.answer.value, 'Yes', 'yes/no');
ok(byKey.traction_arr.answer.cites[0].quote === 'ARR of 1,200,000 USD as of September 2026.' && byKey.traction_arr.answer.cites[0].page === 2, 'the exact quote and page travel with the answer', byKey.traction_arr.answer.cites);
ok(byKey.market_tam.answer.sources[0].startsWith('https://'), 'a public source link');
ok(byKey.legal_litigation.state === 'open' && byKey.legal_litigation.check_note === 'Not in the deck.', 'a question not found stays open with the note');
ok(g.counts.proposed === 8 && g.areas.find((a) => a.key === 'traction').answered === 3, 'progress counts the proposed answers', g.counts);
const again = await api.op('dd.answer', { answers: ans([good[0]]) }, A);
ok(again.saved === 0 && again.same === 1, 'the same answer again changes nothing');
await api.op('dd.answer', { deal: acme.number, rest_not_found: 'Not in the deck or the room.', answers: '[]' }, A);
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.ask.at === 3 && !g.ask.open, 'the rest checked not found: StepTrack at Ready', g.ask);

section('Next: one verify card per deal for its point partner');
let n = await api.op('next.list', {}, P);
let card = n.items.find((i) => i.key === 'diligence:verify:' + acme.id);
ok(card && card.kind === 'verify' && card.card === 'answers' && card.rank === 40, 'the verify card is in Next', n.errors);
eq(card.figures, [{ label: 'To check', value: '8' }, { label: 'High grade', value: '5' }], 'figures: to check, high grade');
ok(card.actions.length === 1 && card.actions[0].op === 'dd.confirm' && card.actions[0].label === 'Confirm all' && card.actions[0].primary && card.actions[0].params.answers.length === 8, 'one primary action: Confirm all', card.actions);
eq(card.actions[0].choose, { param: 'grade', options: [{ value: 'high', label: 'High grade 5' }, { value: 'all', label: 'All 8' }] }, 'mixed grades: the chips ask High grade or All');
ok(card.data.answers.length === 8 && card.data.answers.every((a) => a.value !== '' && (a.quote !== '' || a.source !== '')), 'each answer with its value and quote or source');
ok(card.href === '#/deals/' + acme.number + '?tab=diligence', 'Review opens the Diligence tab');
ok(!(await api.op('next.list', {}, { as: PARTNER2 })).items.some((i) => i.key === card.key), 'not in Next of a partner off the deal');
ok(!(await api.op('next.list', {}, { as: ANALYST })).items.some((i) => i.key === card.key), 'not in Next of an analyst off the deal');
ok(!(await api.op('next.list', {}, { as: VP })).items.some((i) => i.key === card.key), 'not for a venture partner (no diligence edit)');

section('confirm from Next, reject, undo');
await refuses(api, 'dd.confirm', { answers: card.actions[0].params.answers }, A, 403, 'agent_not_permitted', 'your AI agent never confirms');
await refuses(api, 'dd.confirm', { answers: card.actions[0].params.answers }, { as: VP }, 403, 'not_permitted', 'a venture partner cannot confirm');
const conf = await api.op(card.actions[0].op, Object.assign({}, card.actions[0].params, { grade: 'high' }), P);
ok(conf.confirmed.length === 5 && conf.stale.length === 0, 'Confirm all, High grade chip: the 5 high-grade answers', conf);
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.counts.confirmed === 5 && g.counts.proposed === 3, '5 confirmed, 3 waiting', g.counts);
n = await api.op('next.list', {}, P);
card = n.items.find((i) => i.key === 'diligence:verify:' + acme.id);
eq(card.figures, [{ label: 'To check', value: '3' }, { label: 'High grade', value: '0' }], 'the card counts what is left');
ok(card.actions.length === 1 && card.actions[0].label === 'Confirm all' && card.actions[0].choose === null && card.actions[0].params.answers.length === 3, 'no high-grade answer left: Confirm all without chips', card.actions);
await refuses(api, 'dd.confirm', { answers: card.actions[0].params.answers, grade: 'high' }, P, 409, 'none_high', 'the High grade chip on low-grade answers confirms nothing');
const growthId = g.questions.find((q) => q.key === 'traction_growth').answer.id;
const rej = await api.op('dd.reject', { answer: growthId, reason: 'outdated' }, P);
ok(rej.rejected[0] === growthId, 'rejected with one click');
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.questions.find((q) => q.key === 'traction_growth').state === 'open', 'the question opens again');
await refuses(api, 'dd.confirm', { answer: growthId }, P, 409, 'stale', 'a rejected answer cannot be confirmed');
const arrId = g.questions.find((q) => q.key === 'traction_arr').answer.id;
const c1 = await api.op('dd.confirm', { answer: arrId }, P);
await refuses(api, 'dd.confirm', { answer: arrId }, P, 409, 'stale', 'confirming twice is stale');
const undone = await api.op('activity.undo', { entry: c1._activity }, P);
ok(undone && !undone.code, 'Undo of a confirm', undone);
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.questions.find((q) => q.key === 'traction_arr').state === 'proposed' && g.questions.find((q) => q.key === 'traction_arr').answer.status === 'agent_proposed', 'the answer waits again after Undo');
await api.op('dd.confirm', { answer: arrId }, P);

section('a person-rejected value is never proposed again; a new value over a confirmed answer waits beside it');
await sleep(10500); // the platform's 10 s cooldown of diligence_answers
const ask2 = await api.op('dd.ask', { deal: acme.number }, P);
ok(ask2.request !== '' && ask2.step.open, 'Ask your AI agent again: one more fire', ask2);
const re = await api.op('dd.answer', { answers: ans([{ question: qk.traction_growth.id, value: '15', unit: '%', num_kind: 'quoted', grade: 'founder_reported', anchors: [aGrowth] }]) }, A);
ok(re.saved === 0 && re.rejected_before[0] === qk.traction_growth.id, 'the rejected value is refused as rejected_before', re);
const aArr2 = (await api.op('anchors.create', { file: deckId, page: 2, quote: 'ARR of 1,200,000 USD' }, A)).anchor.id;
const newer = await api.op('dd.answer', { answers: ans([{ question: qk.traction_arr.id, value: '1250000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported', anchors: [aArr2], note: 'Updated figure' }]) }, A);
ok(newer.saved === 1, 'a newer ARR proposed');
g = await api.op('dd.get', { deal: acme.number }, P);
let arrQ = g.questions.find((q) => q.key === 'traction_arr');
ok(arrQ.state === 'confirmed' && arrQ.answer.value === 'USD 1,200,000.00' && arrQ.proposal && arrQ.proposal.value === 'USD 1,250,000.00', 'the confirmed answer stays; the new one waits beside it', arrQ);
await api.op('dd.confirm', { answer: arrQ.proposal.id }, P);
g = await api.op('dd.get', { deal: acme.number }, P);
arrQ = g.questions.find((q) => q.key === 'traction_arr');
ok(arrQ.answer.value === 'USD 1,250,000.00' && arrQ.proposal === null, 'confirming the new one replaces the old');

section('a person answers by hand');
const hand = await api.op('dd.answer', { answers: ans([{ question: qk.legal_jurisdiction.id, value: 'Delaware' }, { question: qk.fin_cash.id, value: '2500000', unit: 'USD' }]) }, P);
ok(hand.saved === 2, 'two answers typed by a partner');
g = await api.op('dd.get', { deal: acme.number }, P);
const jur = g.questions.find((q) => q.key === 'legal_jurisdiction');
ok(jur.state === 'confirmed' && jur.answer.grade === 'founder_reported' && jur.answer.actor === 'person', 'a person\'s answer is confirmed at once', jur.answer);
eq(g.questions.find((q) => q.key === 'fin_cash').answer.num_kind, 'entered', 'a typed number is entered');

section('questions: a proposal for your AI agent, direct for people');
// The deal by record id: kernel-core's proposals.dealOf keeps params.deal as given, and a display id (D-0001) makes the proposal invisible (reported).
const prop = await api.op('dd.questions-save', { deal: acme.id, questions: ans([{ area: 'customers', text: 'Logo churn in 2025', type: 'number', unit: '%' }]), why: 'The deck mentions churn' }, A);
ok(prop.proposed === true && prop.proposal, 'your AI agent proposes a question', prop);
n = await api.op('next.list', {}, P);
const pc = n.items.find((i) => i.key === 'kernel:proposal:' + prop.proposal);
ok(pc && pc.title.indexOf('Diligence questions for Acme Robotics') === 0, 'the proposal is in Next', pc && pc.title);
await api.op('proposals.accept', { proposal: prop.proposal }, P);
g = await api.op('dd.get', { deal: acme.number }, P);
const churn = g.questions.find((q) => q.text === 'Logo churn in 2025');
ok(churn && churn.area === 'customers' && churn.unit === '%', 'accepted: the question is on the checklist', churn);
const ch = await api.op('dd.questions-save', { deal: acme.number, questions: ans([{ question: g.questions.find((q) => q.key === 'team_size').id, type: 'text' }]) }, P);
ok(ch.changed === 1, 'a person changes a question type');
g = await api.op('dd.get', { deal: acme.number }, P);
ok(g.questions.find((q) => q.key === 'team_size').state === 'open', 'answers of another type are superseded');
await api.op('dd.questions-save', { deal: acme.number, remove: ans([churn.id]) }, P);
g = await api.op('dd.get', { deal: acme.number }, P);
ok(!g.questions.some((q) => q.id === churn.id), 'a removed question leaves the checklist');
await refuses(api, 'dd.questions-save', { deal: acme.number, questions: ans([{ text: 'x', type: 'colour' }]) }, P, 400, 'invalid_param', 'an unknown type is named');

section('checklists: a proposal for your AI agent, the owner edits');
const tp = await api.op('dd.template-save', { name: 'Growth', areas: ans([{ key: 'traction', label: 'Traction' }]), questions: ans([{ area: 'traction', text: 'Net revenue retention', type: 'number', unit: '%' }]) }, A);
ok(tp.proposed === true, 'your AI agent proposes a checklist');
await refuses(api, 'dd.template-save', { name: 'Growth' }, P, 403, 'not_permitted', 'a partner cannot change firm checklists');
const tpl = await api.op('dd.template-save', { name: 'Growth', areas: ans([{ key: 'traction', label: 'Traction' }]), questions: ans([{ area: 'traction', text: 'Net revenue retention', type: 'number', unit: '%' }]) }, { as: 'owner' });
ok(tpl.template.key === 'growth' && tpl.template.questions[0].key.startsWith('traction_'), 'the owner adds a checklist', tpl.template);
await refuses(api, 'dd.template-save', { template: 'growth', questions: ans([{ area: 'nope', text: 'x' }]) }, { as: 'owner' }, 400, 'invalid_param', 'a question in an unknown area is named');
eq((await api.op('dd.templates', {}, P)).templates.map((x) => x.key), ['seed', 'series_a', 'growth'], 'three checklists');

section('entering Diligence applies the checklist for the round');
const zeta = await api.op('deals.create', { company: S.companies.zeta.id, round_type: 'series_a', point: PARTNER }, P);
await api.op('deals.move', { deal: zeta.deal.number, stage: 'diligence' }, P);
g = await api.op('dd.get', { deal: zeta.deal.number }, P);
ok(g.questions.length === 68 && g.questions.every((q) => q.state === 'open'), 'the Series A checklist (68 questions) is applied on the move', g.questions.length);

section('NDA files: your AI agent only while a person asked about the deal; quotes hidden off the team');
const upN = await upload(api, { deal: acme.id, folder: 'Data room', nda: 'true' }, [{ name: 'bank_statement.pdf', bytes: pdf([['Statement', 'Closing balance 2,480,000 USD.']]) }], PARTNER);
const ndaFile = upN.body.files ? upN.body.files[0].id : upN.body.file.id;
await waitText(api, ndaFile, PARTNER);
await sleep(300);
// The earlier ask landed (rest checked); nobody asked about the deal now, so its NDA files stay closed.
await api.op('dd.answer', { deal: acme.number, rest_not_found: 'Not in the room.', answers: '[]' }, A);
await refuses(api, 'files.text', { file: ndaFile }, A, 403, 'nda_not_asked', 'no NDA text while nobody asked about the deal');
await sleep(10500); // the platform's 10 s cooldown of diligence_answers
const askN = await api.op('dd.ask', { deal: acme.number }, P);
ok(askN.request !== '', 'Ask your AI agent with an NDA file in the room: one fire for the deal', askN);
const aBank = (await api.op('anchors.create', { file: ndaFile, page: 1, quote: 'Closing balance 2,480,000 USD.' }, A)).anchor.id;
const nd = await api.op('dd.answer', { answers: ans([{ question: qk.fin_cash.id, value: '2480000', unit: 'USD', num_kind: 'quoted', grade: 'artifact', anchors: [aBank] }]) }, A);
ok(nd.saved === 1, 'while that ask waits, the NDA citation is saved', nd);
await api.op('dd.answer', { deal: acme.number, rest_not_found: 'Not in the room.', answers: '[]' }, A);
await refuses(api, 'files.text', { file: ndaFile }, A, 403, 'nda_not_asked', 'once the ask landed the NDA file closes again');
g = await api.op('dd.get', { deal: acme.number }, P);
const cashP = g.questions.find((q) => q.key === 'fin_cash').proposal;
ok(cashP && cashP.cites[0].quote === 'Closing balance 2,480,000 USD.' && cashP.cites[0].nda === true, 'the deal team reads the NDA quote', cashP);
const g2 = await api.op('dd.get', { deal: acme.number }, { as: PARTNER2 });
const cash2 = g2.questions.find((q) => q.key === 'fin_cash').proposal;
ok(cash2 && cash2.cites[0].quote === null && cash2.cites[0].hidden === true && g2.hidden_quotes >= 1, 'a partner off the team sees the answer, not the NDA quote', cash2 && cash2.cites);

section('restricted deals');
await api.op('deals.restrict', { deal: lumen.number, restricted: true }, { as: PARTNER2 });
await refuses(api, 'dd.get', { deal: lumen.number }, A, 403, 'restricted', 'your AI agent is shut out of a restricted deal');
await refuses(api, 'dd.get', { deal: lumen.number }, P, 403, 'restricted', 'a partner off the team is shut out');
await refuses(api, 'dd.ask', { deal: lumen.number }, { as: PARTNER2 }, 409, 'agent_off', 'Ask your AI agent says it is off for this deal');
ok((await api.op('dd.get', { deal: lumen.number }, { as: PARTNER2 })).questions.length === 68, 'the deal team still works the checklist');
await api.op('deals.restrict', { deal: lumen.number, restricted: true, agent_allowed: true }, { as: PARTNER2 });
ok((await api.op('dd.get', { deal: lumen.number }, A)).questions.length === 68, 'with agent_allowed your AI agent reads it');

summary('t02 answers');
