// t03: meetings and blind votes. Weekly agenda assembled from deals at IC; a deal reaching IC joins the next
// meeting; cooling-off; votes cast with the PIN and sealed; no read path shows a choice before the reveal (your
// AI agent included); the reveal lists juniors first and applies the rule; the decision is recorded from Next
// with outcome chips; bear case; agenda proposals; close.
import { inflateRawSync } from 'node:zlib';
import { newApi, fresh, team, deal, section, ok, eq, refuses, summary, leaksChoice, DEMO, O, A, PEOPLE, as } from './lib.mjs';

fresh();
const api = newApi();
await team(api);
const P1 = as('p1');
const P2 = as('p2');
const VP = as('vp');

const acme = await deal(api, 'acme.com', 'ic');
const lumen = await deal(api, 'lumen.health', 'diligence');

section('a deal at IC gets a meeting and joins its agenda');
const ml0 = await api.op('meetings.list', {}, O);
ok(ml0.next !== null && ml0.next.number === 'IC-001' && ml0.next.auto === true, 'moving a deal to IC created the next meeting', ml0.next);
const it0 = ml0.next.items.find((x) => x.deal && x.deal.number === acme.number);
ok(it0 && it0.kind === 'new_investment' && it0.champion && it0.champion.name === 'Paula Partner' && it0.source === 'stage', 'the deal is on the agenda with its point partner as champion', it0);
ok(it0 && it0.memo === null && it0.preread_at === '', 'no memo yet, so no pre-reads');
await refuses(api, 'votes.cast', { item: it0.id, choice: '4' }, { as: 'owner', pin: true }, 409, 'no_prereads', 'voting opens with the pre-reads');

section('meetings.create assembles the agenda (a manual meeting)');
await refuses(api, 'meetings.create', {}, A, 403, 'agent_not_permitted', 'your AI agent does not create meetings');
const mc = await api.op('meetings.create', { title: 'Weekly IC' }, P1);
ok(mc.meeting.number === 'IC-002' && mc.meeting.facilitator.name === 'Paula Partner' && mc.added === 0, 'IC-002 created by Paula (facilitator); Acme is already on IC-001', mc);
const ag = await api.op('meetings.agenda', { meeting: 'IC-002' }, A);
eq(ag.added.length, 0, 'meetings.agenda (your AI agent) adds nothing twice');
const meet = ml0.next;
ok(meet.facilitator && meet.facilitator.name === 'Olivia Owner', 'the owner facilitates an automatic meeting');
await refuses(api, 'meetings.save', { meeting: meet.id, facilitator: PEOPLE.p1 }, P2, 403, 'not_facilitator', 'only the facilitator or the owner changes a meeting');
const sv = await api.op('meetings.save', { meeting: meet.id, facilitator: PEOPLE.p1, time: '09:30' }, O);
ok(sv.meeting.facilitator.name === 'Paula Partner', 'the owner hands IC-001 to Paula');

section('the memo is submitted: pre-reads out, cooling-off');
const m = (await api.op('memos.open', { deal: acme.number }, P1)).memo;
await api.op('memos.block-save', { memo: m.id, section: 'summary', text: 'Acme builds warehouse robots.' }, P1);
const sub = await api.op('memos.submit', { memo: m.id }, P1);
ok(sub.agenda && sub.agenda.item === it0.id, 'submit points the agenda item at the memo');
let g = (await api.op('meetings.get', { meeting: meet.id }, P1)).meeting;
let it = g.items.find((x) => x.id === it0.id);
ok(it.memo && it.memo.version === 1 && it.memo.hash === sub.memo.hash && it.preread_at !== '' && it.cooling.state === 'cooling', 'the item carries memo v1, its hash, and the cooling-off runs', it);
ok(it.scale === 'no_three' && it.scale_choices.join(',') === '1,2,4,5', 'the default scale is 1 to 5 without 3');

section('votes are cast with the PIN and sealed');
await refuses(api, 'votes.cast', { item: it.id, choice: '3' }, { as: 'owner', pin: true }, 400, 'invalid_choice', 'a 3 is not on the scale');
await refuses(api, 'votes.cast', { item: it.id, choice: '4' }, { as: 'owner', pin: '000000' }, 403, 'wrong_pin', 'a wrong PIN is refused');
await refuses(api, 'votes.cast', { item: it.id, choice: '4' }, { as: PEOPLE.pr, pin: true }, 403, 'not_eligible', 'a principal does not vote');
await refuses(api, 'votes.cast', { item: it.id, choice: '4' }, { as: PEOPLE.an, pin: true }, 403, 'not_eligible', 'an analyst does not vote');
const nOwner = await api.op('next.list', { kinds: 'vote' }, O);
const voteCard = nOwner.items.find((x) => x.key === 'committee:vote:' + it.id);
ok(voteCard && voteCard.rank === 10 && voteCard.card === 'vote' && voteCard.actions[0].op === 'votes.cast' && voteCard.actions[0].pin === true && voteCard.actions[0].choose.options.map((o) => o.value).join(',') === '1,2,4,5', 'Next: my vote is due (rank 10), Vote opens the scale chips and the PIN', voteCard);
const c1 = await api.op('votes.cast', Object.assign({ item: it.id, rationale: 'Strong team, fair price', [voteCard.actions[0].choose.param]: '4' }, voteCard.actions[0].params), { as: 'owner', pin: true });
ok(c1.voted && leaksChoice(c1) === null, 'the answer carries no choice', c1);
await api.op('votes.cast', { item: it.id, choice: '2', rationale: 'Market too small', veto: false }, { as: PEOPLE.p2, pin: true });
await api.op('votes.cast', { item: it.id, choice: '5', rationale: 'Best robotics team I met', veto: false }, { as: PEOPLE.vp, pin: true });
await api.op('votes.cast', { item: it.id, choice: '1', rationale: 'changed below' }, { as: PEOPLE.vp, pin: true });
const c4 = await api.op('votes.cast', { item: it.id, choice: '5', rationale: 'Best robotics team I met' }, { as: PEOPLE.vp, pin: true });
ok(c4.changed === true, 'a voter may change the vote before the reveal');
ok(!(await api.op('next.list', { kinds: 'vote' }, O)).items.some((x) => x.key === 'committee:vote:' + it.id), 'my vote card is gone once I voted');

section('nobody reads a choice before the reveal');
for (const who of [O, P1, P2, VP, as('pr'), as('an'), A]) {
  const r1 = await api.call('meetings.get', { meeting: meet.id }, who);
  if (r1.status === 200) ok(leaksChoice(r1.body) === null, 'meetings.get as ' + who.as + ': no choice', leaksChoice(r1.body));
  const r2 = await api.call('votes.status', { item: it.id }, who);
  if (r2.status === 200) ok(leaksChoice(r2.body) === null && r2.body.items[0].voted === 3, 'votes.status as ' + who.as + ': counts only (3 voted)', r2.body);
  const r3 = await api.call('meetings.list', {}, who);
  if (r3.status === 200) ok(leaksChoice(r3.body) === null, 'meetings.list as ' + who.as + ': no choice');
  const r4 = await api.call('next.list', {}, who);
  if (r4.status === 200) ok(leaksChoice(r4.body) === null, 'next.list as ' + who.as + ': no choice');
  const r5 = await api.call('activity.list', {}, who);
  if (r5.status === 200) ok(leaksChoice(r5.body) === null && JSON.stringify(r5.body).indexOf('Strong team') < 0, 'activity.list as ' + who.as + ': no ballot', leaksChoice(r5.body));
}
const st = (await api.op('votes.status', { item: it.id }, A)).items[0];
ok(st.eligible === 4 && st.voted === 3 && st.members.filter((x) => x.voted).length === 3 && st.members.every((x) => Object.keys(x).join(',') === 'id,name,voted'), 'your AI agent sees 3 of 4 voted and who, never what', st);
const audit = await api.op('audit.list', { limit: 200 }, O);
ok(JSON.stringify(audit).indexOf('Strong team') < 0 && JSON.stringify(audit).indexOf('"choice"') < 0, 'the audit trail keeps no ballot');
const zipRes = await api.raw('exports.all', { pin: DEMO.pin }, { authorization: api.tokens.get(DEMO.owner) });
ok(zipRes.status === 200, 'export ran');
const zbuf = Buffer.from(typeof zipRes.body === 'string' ? zipRes.body : JSON.stringify(zipRes.body), 'latin1');
ok(zbuf.indexOf('ballot_sealed') < 0 && zbuf.indexOf('Strong team') < 0, 'the data export drops the sealed ballots');

section('cooling-off and the reveal');
const ins = (await api.op('next.list', { kinds: 'decision' }, P1)).items;
ok(!ins.some((x) => x.key === 'committee:reveal:' + it.id), 'no Reveal in Next while the cooling-off runs and Paula has not voted');
await refuses(api, 'votes.reveal', { item: it.id, close: true }, { as: PEOPLE.p1, pin: true }, 409, 'cooling_off', 'no reveal during the cooling-off');
await api.op('meetings.item-save', { item: it.id, cooling_hours: 0, skeptic: PEOPLE.p2 }, P1);
await refuses(api, 'votes.reveal', { item: it.id }, { as: PEOPLE.p1, pin: true }, 409, 'votes_missing', 'not everyone voted: refused without --close');
await refuses(api, 'votes.reveal', { item: it.id }, { as: PEOPLE.p2, pin: true }, 403, 'not_facilitator', 'only the facilitator reveals');
await api.op('votes.cast', { item: it.id, choice: '4', rationale: 'Champion' }, { as: PEOPLE.p1, pin: true });
const rv = (await api.op('next.list', { kinds: 'decision' }, P1)).items.find((x) => x.key === 'committee:reveal:' + it.id);
ok(rv && rv.actions[0].op === 'votes.reveal' && rv.actions[0].pin === true && rv.figures[0].value === '4 of 4', 'all voted: Next offers Reveal to the facilitator', rv);
const rev = await api.op(rv.actions[0].op, rv.actions[0].params, { as: PEOPLE.p1, pin: true });
const t = rev.item.tally;
ok(rev.item.revealed && t.for === 3 && t.against === 1 && t.voted === 4 && t.rule === 'consensus' && t.result === 'pass' && t.reason === 'not_unanimous', 'the tally: 3 for, 1 against; consensus says pass', t);
eq(t.votes.map((v) => v.name), ['Vera Venture', 'Peter Partner', 'Paula Partner', 'Olivia Owner'], 'juniors first: venture partner, partners (newest first), owner');
ok(rev.item.votes.members.find((x) => x.name === 'Peter Partner').rationale === 'Market too small', 'rationales shown after the reveal');
await refuses(api, 'votes.cast', { item: it.id, choice: '5' }, { as: PEOPLE.p2, pin: true }, 409, 'voting_over', 'no vote after the reveal');

section('record the decision from Next');
await refuses(api, 'meetings.close', { meeting: meet.id }, P1, 409, 'decision_pending', 'the meeting cannot close while a revealed item waits');
const dc = (await api.op('next.list', { kinds: 'decision' }, P1)).items.find((x) => x.key === 'committee:decide:' + it.id);
ok(dc && dc.card === 'decide' && dc.actions[0].op === 'decisions.record' && !dc.actions[0].choose && dc.actions[0].params.outcome === 'pass' && dc.actions[0].params.rule === 'consensus' && dc.data.outcome === 'pass' && dc.data.rule === 'consensus' && dc.data.tally.votes.length === 4, 'Next: Record decision with the rule answer and the fund rule preset (the Focus card shows outcome and rule chips)', dc);
const dec = await api.op('decisions.record', Object.assign({}, dc.actions[0].params, { outcome: 'invest', rule: 'majority', conditions: JSON.stringify([{ text: 'Reference call with the former CTO', owner: PEOPLE.p2 }, 'Pro rata secured']) }), { as: PEOPLE.p1, pin: true });
const D = dec.decision;
ok(D.outcome === 'invest' && D.rule === 'majority' && D.tally.result === 'invest' && D.memo.hash === sub.memo.hash && D.conditions.length === 2, 'invest by majority, with the memo hash and two conditions', D);
ok(D.snapshot && D.snapshot.deal.number === acme.number && D.snapshot.diligence && D.snapshot.memo.hash === sub.memo.hash, 'the snapshot keeps what the firm knew', D.snapshot);
eq(D.votes.map((v) => v.name)[0], 'Vera Venture', 'the decision keeps the votes junior first');
const memoNow = (await api.op('memos.get', { memo: m.id }, P1)).memo;
eq(memoNow.status, 'final', 'the memo is final');
const dg = await api.op('decisions.get', { deal: acme.number }, P2);
ok(dg.decision.id === D.id && dg.history.length === 1, 'decisions.get by deal');
const dl = await api.op('decisions.list', {}, A);
ok(dl.decisions.length === 1 && dl.decisions[0].tally.for === 3, 'decisions.list for your AI agent (after the reveal)');

section('bear case');
const m2 = (await api.op('memos.open', { deal: lumen.number }, P1)).memo;
await api.op('memos.block-save', { memo: m2.id, section: 'summary', text: 'Lumen does clinical scheduling.' }, P1);
await api.op('deals.move', { deal: lumen.number, stage: 'ic' }, O);
await api.op('memos.submit', { memo: m2.id }, P1);
g = (await api.op('meetings.get', { meeting: meet.id }, P1)).meeting;
const li = g.items.find((x) => x.deal && x.deal.number === lumen.number);
ok(li && li.memo && li.memo.version === 1, 'Lumen joined the same meeting when it reached IC');
const br = await api.op('bearcase.request', { item: li.id }, P1);
ok(br.request !== '' && br.item === li.id && br.ask.open, 'bear case asked: one fire with the agenda item', br);
await refuses(api, 'bearcase.request', { item: li.id }, P1, 409, 'pending', 'asking again while it waits is refused');
await refuses(api, 'bearcase.save', { item: li.id, points: JSON.stringify([{ kind: 'risk', text: 'x', recommendation: 'pass' }]) }, A, 400, 'unknown_key', 'a recommendation is not a field');
await refuses(api, 'bearcase.save', { item: li.id, points: JSON.stringify([{ kind: 'verdict', text: 'x' }]) }, A, 400, 'invalid_param', 'only risk and contrary points');
const bs = await api.op('bearcase.save', { item: li.id, points: JSON.stringify([{ kind: 'risk', text: 'Hospital sales cycles run 12 to 18 months [1].', citations: [{ kind: 'url', url: 'https://example.com/sales', source: 'Example Health' }] }, { kind: 'contrary', text: 'Two pilots ended without conversion.' }]) }, A);
ok(bs.bearcase.points.length === 2 && bs.bearcase.points[0].citations[0].ok, 'bear case saved with its citations');
const li2 = (await api.op('meetings.get', { meeting: meet.id }, P1)).meeting.items.find((x) => x.id === li.id);
ok(li2.bearcase_ask && !li2.bearcase_ask.open && li2.bearcase_ask.done_at !== '', 'the save landed the ask', li2.bearcase_ask);
ok(li2.bearcase && li2.bearcase_by === 'agent' && li2.bearcase.points[1].kind === 'contrary', 'the room shows the bear case');

section('agenda proposals, removal, close');
const prop = await api.op('meetings.add-item', { meeting: meet.id, title: 'Portfolio: Northwind bridge ask', kind: 'portfolio', why: 'Asked in the Q3 update' }, A);
ok(prop.proposed === true && prop.label.indexOf('IC-001') >= 0, 'your AI agent proposes an agenda item', prop);
await api.op('proposals.accept', { proposal: prop.proposal }, P1);
g = (await api.op('meetings.get', { meeting: meet.id }, P1)).meeting;
const pi = g.items.find((x) => x.title === 'Portfolio: Northwind bridge ask');
ok(pi && pi.kind === 'portfolio' && pi.preread_at !== '', 'accepted: a portfolio item on the agenda');
await api.op('votes.cast', { item: li.id, choice: '2' }, { as: 'owner', pin: true });
await refuses(api, 'meetings.remove-item', { item: li.id }, P1, 409, 'votes_cast', 'an item with votes cannot be removed');
const rm = await api.op('meetings.remove-item', { item: pi.id }, P1);
eq(rm.removed, pi.id, 'an item without votes is removed');
const st2 = await api.op('meetings.start', { meeting: meet.id }, P1);
ok(st2.meeting.status === 'live' && st2.meeting.current_item === li.id, 'the meeting starts on its first open item');
const cl = await api.op('meetings.close', { meeting: meet.id }, P1);
ok(cl.meeting.status === 'closed' && cl.skipped === 1, 'closed: the undecided item is skipped');
const after = (await api.op('meetings.get', { meeting: meet.id }, O)).meeting.items.find((x) => x.id === li.id);
ok(after.status === 'skipped' && !after.revealed && leaksChoice(after) === null, "a skipped item's votes are never opened");
const ag2 = await api.op('meetings.agenda', { meeting: 'IC-002' }, A);
ok(ag2.added.length === 1, 'the next agenda picks Lumen up again');

section('deal closed elsewhere leaves the agenda');
const third = await deal(api, 'gamma.io', 'ic');
let it3 = (await api.op('meetings.get', { meeting: 'IC-002' }, O)).meeting.items.find((x) => x.deal && x.deal.number === third.number);
ok(it3 && it3.status === 'waiting', 'Gamma joined IC-002');
await api.op('deals.status', { deal: third.number, status: 'passed', reason: 'Too early' }, O);
it3 = (await api.op('meetings.get', { meeting: 'IC-002' }, O)).meeting.items.find((x) => x.deal && x.deal.number === third.number);
eq(it3.status, 'skipped', 'passing the deal skips its item');

const s = summary('t03 meetings and votes');
process.exit(s.failed > 0 ? 1 : 0);
