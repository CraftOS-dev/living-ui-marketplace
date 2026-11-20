// t04: decisions outside a meeting, corrections (never edited), conditions with Next items and proposals,
// the anti-portfolio with review notes, per-fund scale and rule, the contract decisionOf through decisions.get,
// restricted deals and your AI agent's scope.
import { newApi, fresh, team, deal, section, ok, eq, refuses, summary, leaksChoice, O, A, PEOPLE, as } from './lib.mjs';

fresh();
const api = newApi();
await team(api);
const P1 = as('p1');
const P2 = as('p2');

const acme = await deal(api, 'acme.com', 'partner_meeting');
const beta = await deal(api, 'beta.ai', 'partner_meeting');

section('a decision outside a meeting, then a correction');
await refuses(api, 'decisions.record', { deal: acme.number, outcome: 'pass' }, P1, 400, undefined, 'the PIN is required');
const d1 = (await api.op('decisions.record', { deal: acme.number, outcome: 'pass', rule: 'champion', reason: 'valuation', note: 'Price too high for the stage' }, { as: PEOPLE.p1, pin: true })).decision;
ok(d1.outcome === 'pass' && d1.reason_label === 'Valuation' && d1.tally === null && d1.snapshot.facts === null, 'pass recorded without votes; the snapshot keeps the deal', d1);
await refuses(api, 'decisions.record', { deal: acme.number, outcome: 'invest', corrects: 'nope' }, { as: PEOPLE.p1, pin: true }, 404, 'not_found', 'a correction names a decision of the same deal');
const d2 = (await api.op('decisions.record', { deal: acme.number, outcome: 'more_diligence', corrects: d1.id, note: 'Wrong chip' }, { as: PEOPLE.p1, pin: true })).decision;
ok(d2.corrects === d1.id, 'the correction is a new record pointing at the first');
await refuses(api, 'decisions.record', { deal: acme.number, outcome: 'invest', corrects: d1.id }, { as: PEOPLE.p1, pin: true }, 409, 'already_corrected', 'a decision is corrected once; correct the newest');
const g1 = await api.op('decisions.get', { decision: d1.id }, O);
ok(g1.decision.corrected_by === d2.id && g1.decision.outcome === 'pass', 'the first decision is unchanged and knows its correction');
const g2 = await api.op('decisions.get', { deal: acme.number }, A);
ok(g2.decision.id === d2.id && g2.history.length === 2, 'the latest decision on the deal is the correction (decisionOf)');

section('the snapshot keeps confirmed diligence answers only');
await api.op('dd.template-apply', { deal: acme.number }, P1);
const qs = (await api.op('dd.get', { deal: acme.number }, P1)).questions ?? [];
ok(qs.length >= 2, 'the deal has a diligence checklist (' + qs.length + ' questions)');
const valueFor = (q) => (q.type === 'bool' || q.type === 'yes_no' ? 'yes' : ['number', 'int', 'money', 'percent', 'months', 'count'].indexOf(q.type) >= 0 ? '42' : 'A plain answer');
const pickQs = [qs.find((q) => q.type === 'text') ?? qs[0], qs.find((q, i) => i > 0 && q.type === 'text' && q !== qs.find((x) => x.type === 'text')) ?? qs[1]];
const da = await api.op('dd.answer', { answers: JSON.stringify(pickQs.map((q, i) => ({ question: q.id, value: valueFor(q), grade: 'public', num_kind: 'external', sources: ['https://example.com/' + i] }))) }, A);
ok(da.saved === 2, 'your AI agent proposed two answers', da);
const pend = (await api.op('dd.get', { deal: acme.number, state: 'proposed' }, P1)).questions ?? [];
const ids = pend.map((q) => (q.proposal ?? q.answer ?? {}).id).filter((x) => typeof x === 'string');
ok(ids.length === 2, 'both wait as proposed', pend.map((q) => q.proposal));
const confirmQ = pickQs[0].id;
await api.op('dd.confirm', { answer: ids[pend.findIndex((q) => q.id === confirmQ)] ?? ids[0] }, P1);
const ds = (await api.op('decisions.record', { deal: acme.number, outcome: 'hold', corrects: d2.id }, { as: PEOPLE.p1, pin: true })).decision;
const snapAnswers = (ds.snapshot.diligence ?? {}).answers ?? [];
ok(snapAnswers.length === 1 && snapAnswers[0].status === 'confirmed' && snapAnswers[0].question === confirmQ && (ds.snapshot.diligence.questions ?? []).length === 1, 'the decision snapshot holds the confirmed answer only', ds.snapshot.diligence);

section('anti-portfolio');
const d3 = (await api.op('decisions.record', { deal: beta.number, outcome: 'pass', reason: 'market' }, { as: PEOPLE.p1, pin: true })).decision;
const ap = await api.op('decisions.anti-portfolio', {}, A);
ok(ap.rows.length === 1 && ap.rows[0].decision === d3.id && ap.rows[0].reason_label === 'Market' && ap.rows[0].then.raise_minor === 300000000, 'passed companies (the corrected pass is not one) with the round then', ap.rows);
await refuses(api, 'decisions.review-note', { decision: d3.id, event: 'raised', text: 'Raised a Series A' }, A, 400, 'missing_param', 'your AI agent needs a source');
await refuses(api, 'decisions.review-note', { decision: d3.id, event: 'unicorn', text: 'x', source_url: 'https://e.com/a' }, A, 400, 'invalid_param', 'event is an enum');
const rn = await api.op('decisions.review-note', { decision: d3.id, event: 'raised', text: 'Raised a USD 20M Series A led by Example Capital', source_url: 'https://example.com/beta-series-a', source_name: 'Example News', day: '2026-10-01' }, A);
ok(rn.review.by === 'agent', 'your AI agent adds a later outcome with its source');
const ap2 = await api.op('decisions.anti-portfolio', {}, P1);
ok(ap2.rows[0].latest && ap2.rows[0].latest.event === 'raised', 'the anti-portfolio shows the later outcome beside the reason');
const apa = await api.op('agent.ask', { trigger: 'anti_portfolio' }, P1);
ok(apa.request !== '' && apa.trigger === 'anti_portfolio', 'a person asks for the anti-portfolio review on request (one fire)', apa);
const ap3 = await api.op('decisions.anti-portfolio', {}, P1);
ok(ap3.ask && ap3.ask.open && ap3.ask.request === apa.request, 'the anti-portfolio shows what it waits for', ap3.ask);

section('conditions');
const gamma = await deal(api, 'gamma.io', 'ic');
const today = (await api.op('auth.me', {}, O)).today;
const d4 = (await api.op('decisions.record', { deal: gamma.number, outcome: 'invest', conditions: JSON.stringify([{ text: 'Reference with the former CTO', owner: PEOPLE.p2, due_day: today }, { text: 'Pro rata secured' }]) }, { as: PEOPLE.p1, pin: true })).decision;
ok(d4.conditions.length === 2 && d4.conditions[1].owner.name === 'Paula Partner', 'conditions default to the point partner', d4.conditions);
const nx = (await api.op('next.list', { kinds: 'condition' }, P2)).items;
const cc = nx.find((x) => x.key === 'committee:condition:' + d4.conditions[0].id);
ok(cc && cc.rank === 10 && cc.chips[0].label === 'Due today' && cc.actions[0].op === 'conditions.complete', 'the owner sees the condition due today in Next', cc);
ok(!(await api.op('next.list', { kinds: 'condition' }, P1)).items.some((x) => x.key === 'committee:condition:' + d4.conditions[1].id), 'a condition due in 14 days is not in Next yet');
const pr = await api.op('conditions.complete', { condition: d4.conditions[0].id, proof: 'https://notes.example.com/ref-call', why: 'Reference call logged' }, A);
ok(pr.proposed === true && pr.label.indexOf('Reference with the former CTO') >= 0, 'your AI agent proposes the condition met', pr);
await refuses(api, 'conditions.complete', { condition: d4.conditions[1].id }, as('an'), 403, 'not_permitted', "an analyst cannot complete someone else's condition");
await api.op('proposals.accept', { proposal: pr.proposal }, P2);
const cl = await api.op('conditions.list', { deal: gamma.number, status: 'all' }, O);
ok(cl.conditions.find((c) => c.id === d4.conditions[0].id).status === 'done' && cl.conditions.find((c) => c.id === d4.conditions[0].id).evidence.indexOf('ref-call') > 0, 'accepted: done with its proof');
const ns = await api.op('conditions.save', { decision: d4.id, text: 'Board seat confirmed', owner: PEOPLE.p1, due_day: '2026-01-01' }, P1);
ok(ns.condition.overdue === true, 'a person adds a condition; past due shows overdue');
const wv = await api.op('conditions.save', { condition: ns.condition.id, status: 'waived' }, P1);
eq(wv.condition.status, 'waived', 'waived');
await refuses(api, 'conditions.save', { decision: d4.id, text: 'x' }, A, 403, 'agent_not_permitted', 'your AI agent does not set conditions');

section('per-fund scale and rule');
const funds = (await api.op('entities.list', {}, O)).entities.filter((e) => e.kind === 'fund');
await api.op('entities.save', { entity: funds[0].id, settings: JSON.stringify({ committee: { scale: 'yes_no', rule: 'majority' } }) }, O);
const delta = await deal(api, 'delta.dev', 'ic', { fund: funds[0].id });
const meet = (await api.op('meetings.list', {}, O)).next;
const di = meet.items.find((x) => x.deal && x.deal.number === delta.number);
ok(di && di.scale === 'yes_no' && di.scale_choices.join(',') === 'yes,no' && di.rule === 'majority', 'the fund votes yes or no by majority', di);
await api.op('settings.update', { modules: JSON.stringify({ committee: { cooling_hours: 0, voter_roles: ['owner', 'partner', 'venture_partner', 'principal'] } }) }, O);
const m = (await api.op('memos.open', { deal: delta.number }, P1)).memo;
await api.op('memos.block-save', { memo: m.id, section: 'summary', text: 'Delta builds developer tools.' }, P1);
await api.op('memos.submit', { memo: m.id }, P1);
const st = (await api.op('votes.status', { item: di.id }, O)).items[0];
eq(st.eligible, 5, 'the principal votes once the firm adds the role (5 eligible)');
await api.op('votes.cast', { item: di.id, choice: 'yes' }, { as: PEOPLE.pr, pin: true });

section('restricted deals');
const omega = await deal(api, 'omega.bio', 'ic');
await api.op('deals.team', { deal: omega.number, add: JSON.stringify([PEOPLE.p1]) }, O);
await api.op('deals.restrict', { deal: omega.number, restricted: true, agent_allowed: false }, O);
const mo = (await api.op('memos.open', { deal: omega.number }, P1)).memo;
await refuses(api, 'memos.get', { memo: mo.id }, P2, 403, 'restricted', 'a partner off the team cannot read its memo');
await refuses(api, 'memos.get', { memo: mo.id }, A, 403, 'restricted', 'your AI agent cannot read it without agent_allowed');
const mg = (await api.op('meetings.get', { meeting: meet.id }, P2)).meeting;
ok(mg.hidden === 1 && !mg.items.some((x) => x.deal && x.deal.number === omega.number), 'the agenda hides it from a partner off the team (hidden 1)');
const mgA = (await api.op('meetings.get', { meeting: meet.id }, A)).meeting;
ok(mgA.hidden === 1, 'and from your AI agent');
const meetO = (await api.op('meetings.get', { meeting: meet.id }, O)).meeting;
const oi = meetO.items.find((y) => y.deal && y.deal.number === omega.number);
ok(oi && meetO.hidden === 0, 'the owner sees the restricted item');
const vs = (await api.op('votes.status', { meeting: meet.id }, P1)).items.find((x) => oi && x.item === oi.id);
ok(vs && vs.eligible === 2, 'only the team member and the owner vote on a restricted deal', vs);
await refuses(api, 'memos.draft-sections', { memo: mo.id }, P2, 403, 'restricted', 'a partner off the team cannot ask for drafts');
const dl = await api.op('decisions.list', {}, A);
ok(leaksChoice(dl) === null, 'the decision log has no choices for deals without a reveal');

const s = summary('t04 decisions and conditions');
process.exit(s.failed > 0 ? 1 : 0);
