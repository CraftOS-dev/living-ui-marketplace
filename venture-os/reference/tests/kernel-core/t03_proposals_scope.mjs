// Proposals (dry run, evidence, dedupe, supersede, accept as the accepting
// member, stale refusal, expiry, promoted kinds with the op's auto check)
// and deal scope (restricted deals, deal team, your AI agent's switch).
import { DEMO, eq, fresh, member, newApi, ok, refuses, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
await member(api, 'analyst@venture.test', 'analyst', 'Ann Analyst');
const PA = { as: 'partner@venture.test' };
const AN = { as: 'analyst@venture.test' };

section('your AI agent proposes');
const t1 = (await api.op('zz.make', { name: 'Alpha', value: 10 }, O)).thing;
await refuses(api, 'zz.save', { why: 'nothing' }, A, 400, 'missing_param', 'a call without its params is refused before any proposal');
await refuses(api, 'zz.save', { thing: t1.id, value: -5, why: 'x' }, A, 400, 'invalid_param', 'the dry run refuses an impossible value now');
await refuses(api, 'zz.save', { thing: 'nope000000000aa', value: 5 }, A, 404, 'not_found', 'the dry run refuses an unknown record');
await refuses(api, 'zz.save', { thing: t1.id, value: 5, confidence: 2 }, A, 400, 'invalid_param', 'confidence is 0 to 1');
const p1 = await api.op('zz.save', { thing: t1.id, value: 20, why: 'The deck says 20', evidence: 'Revenue grew to 20 units in October.', confidence: 0.8 }, A);
ok(p1.proposed === true && p1.proposal, 'stored as a proposal, nothing changed', p1);
eq((await api.op('zz.get', { thing: t1.id }, O)).thing.value, 10, 'the record is unchanged');
const g1 = (await api.op('proposals.get', { proposal: p1.proposal }, O)).proposal;
eq([g1.kind, g1.status, g1.confidence, g1.evidence.quote, g1.items[0].fields[0].before, g1.items[0].fields[0].after], ['note_fields', 'pending', 0.8, 'Revenue grew to 20 units in October.', '10', '20'], 'kind, evidence, confidence, before and after (as text people read)');
ok(Date.parse(g1.expires_at) - Date.now() > 13.9 * 86400000, 'expires in 14 days');
const dup = await api.op('zz.save', { thing: t1.id, value: 20, why: 'again' }, A);
eq([dup.duplicate_of, dup.proposal], [p1.proposal, p1.proposal], 'the same change proposed twice adds nothing');
const p2 = await api.op('zz.save', { thing: t1.id, value: 30, evidence: '{"quote":"30 units","page":4}' }, A);
ok(p2.proposal !== p1.proposal, 'a different value makes a new proposal');
eq((await api.op('proposals.get', { proposal: p1.proposal }, O)).proposal.status, 'withdrawn', 'and supersedes the older one');
eq((await api.op('proposals.get', { proposal: p2.proposal }, O)).proposal.evidence, { page: 4, quote: '30 units' }, 'JSON evidence kept');

section('who sees and accepts');
const anList = await api.op('proposals.list', {}, AN);
eq(anList.total, 0, 'an analyst (network view) does not see a network:edit proposal');
await refuses(api, 'proposals.get', { proposal: p2.proposal }, AN, 404, 'not_found', 'nor get it');
await refuses(api, 'proposals.accept', { proposal: p2.proposal }, A, 403, 'agent_not_permitted', 'your AI agent cannot accept');
const nxP = await api.op('next.list', { kinds: 'proposal' }, PA);
ok(nxP.items.some((i) => i.key === 'kernel:proposal:' + p2.proposal && i.actions[0].op === 'proposals.accept'), 'the proposal is in the partner Next with Accept', nxP.items);
const acc = await api.op('proposals.accept', { proposal: p2.proposal }, PA);
eq([acc.applied, acc.failed, acc.proposal.status, acc.proposal.decided_by_name], [1, 0, 'accepted', 'Paul Partner'], 'accepted by the partner');
eq((await api.op('zz.get', { thing: t1.id }, O)).thing.value, 30, 'the change ran');
const actRows = await api.op('activity.list', { op: 'zz.save' }, O);
ok(actRows.entries.length >= 1 && actRows.entries[0].actor === 'person' && actRows.entries[0].who === 'Paul Partner' && /^Accepted: /.test(actRows.entries[0].summary), 'the change is the accepting member\'s own undo unit', actRows.entries[0]);
ok(acc.activity.length === 1, 'accept answers the undo unit of each item');

section('stale and expiry');
const p3 = await api.op('zz.save', { thing: t1.id, value: 40 }, A);
await api.op('zz.save', { thing: t1.id, value: 35 }, PA);
const acc3 = await api.op('proposals.accept', { proposal: p3.proposal }, O);
eq([acc3.applied, acc3.proposal.items[0].state], [0, 'stale'], 'changed since it was proposed: skipped as stale');
eq((await api.op('zz.get', { thing: t1.id }, O)).thing.value, 35, 'the person value stays');
const t2 = (await api.op('zz.make', { name: 'Beta', value: 1 }, O)).thing;
const p4 = await api.op('zz.save', { thing: t2.id, value: 2 }, A);
const aged = await api.op('zz.age', { what: 'proposal', id: p4.proposal, minutes: 15 * 1440 }, O);
ok(aged.expired >= 1, 'a proposal older than 14 days expires');
eq((await api.op('proposals.get', { proposal: p4.proposal }, O)).proposal.status, 'expired', 'status expired');
const p5 = await api.op('zz.save', { thing: t2.id, value: 3 }, A);
const dis = await api.op('proposals.dismiss', { proposal: p5.proposal, note: 'Wrong source' }, O);
eq([dis.proposal.status, dis.proposal.note], ['dismissed', 'Wrong source'], 'dismissed with a note');

section('promoted kinds');
await refuses(api, 'settings.autonomy', { autonomy: '{"capital":"auto"}' }, O, 400, 'invalid_param', 'only REPORT Table 38 kinds can be promoted');
await api.op('settings.autonomy', { autonomy: '{"note_fields":"auto"}' }, O);
const direct = await api.op('zz.save', { thing: t2.id, value: 50, why: 'small' }, A);
ok(direct.thing && direct.thing.value === 50 && direct._activity, 'promoted: your AI agent ran it directly (an undo unit)', direct);
const big = await api.op('zz.save', { thing: t2.id, value: 500 }, A);
ok(big.proposed === true, "the op's auto check keeps a large value as a proposal", big);
await api.op('settings.autonomy', { autonomy: '{"note_fields":"ask"}' }, O);
const back = await api.op('zz.save', { thing: t2.id, value: 60 }, A);
ok(back.proposed === true, 'back to ask: a proposal again');

section('proposals.create (a set)');
const set = await api.op('proposals.create', { title: 'Two fixes', why: 'From the update', items: JSON.stringify([{ op: 'zz.save', params: { thing: t1.id, name: 'Alpha One' } }, { op: 'zz.save', params: { thing: t2.id, value: 70 } }]) }, A);
eq([set.proposal.items.length, set.proposal.kind], [2, 'note_fields'], 'one proposal with two items');
await refuses(api, 'proposals.create', { items: JSON.stringify([{ op: 'zz.make', params: { name: 'x' } }]) }, A, 400, 'invalid_param', 'only propose ops go in a set');
await refuses(api, 'proposals.create', { items: JSON.stringify([{ op: 'zz.save', params: { thing: t1.id, value: -1 } }]) }, A, 400, 'invalid_param', 'each item is dry-run');
const part = await api.op('proposals.accept', { proposal: set.proposal.id, items: '[0]' }, O);
eq([part.applied, part.proposal.status, part.proposal.items[1].state], [1, 'partial', 'dismissed'], 'accept the chosen items; the rest are dismissed');

section('deal scope');
const fund = (await api.op('entities.list', { kind: 'fund' }, O)).entities[0];
const open = (await api.op('zz.deal', { company: 'Open Co', fund: fund.id }, { as: 'owner' })).deal;
const secret = (await api.op('zz.deal', { company: 'Secret Co', fund: fund.id, restricted: true, team: JSON.stringify(['partner@venture.test']) }, O)).deal;
const allowed = (await api.op('zz.deal', { company: 'Allowed Co', restricted: true, agent_allowed: true }, O)).deal;
ok(/^D-\d{4}$/.test(open.display_id) && open.display_id !== secret.display_id, 'display ids D-0001 style, one sequence', [open.display_id, secret.display_id]);
const sOpen = (await api.op('zz.make', { name: 'On open', deal: open.id }, O)).thing;
const sSecret = (await api.op('zz.make', { name: 'On secret', deal: secret.id }, O)).thing;
const sAllowed = (await api.op('zz.make', { name: 'On allowed', deal: allowed.id }, O)).thing;
eq((await api.call('zz.get', { thing: sOpen.id }, AN)).status, 200, 'an open deal is visible to the analyst');
eq((await api.call('zz.get', { thing: sSecret.id }, AN)).status, 404, 'a restricted deal is hidden from the analyst');
eq((await api.call('zz.get', { thing: sSecret.id }, PA)).status, 200, 'and visible to its deal team (partner)');
eq((await api.call('zz.get', { thing: sSecret.id }, O)).status, 200, 'and to the owner');
eq((await api.call('zz.get', { thing: sSecret.id }, A)).status, 404, 'your AI agent is shut out of a restricted deal');
eq((await api.call('zz.get', { thing: sAllowed.id }, A)).status, 200, 'unless the deal team let it in (agent_allowed)');
const tk = await api.call('tasks.save', { title: 'Peek', ref_collection: 'deals', ref_id: secret.id }, AN);
eq(tk.status, 404, 'an analyst cannot attach a task to a restricted deal');
const com = await api.call('comments.add', { ref_collection: 'deals', ref_id: secret.id, body: 'hi' }, A);
eq(com.status, 404, 'your AI agent cannot comment on a restricted deal');
const out = await api.call('outbound.draft', { kind: 'request', module: 'intake', to: '["f@x.com"]', subject: 's', body: 'b', deal: secret.id }, A);
eq(out.status, 404, 'nor draft a message about it');
const anNext = await api.op('next.list', {}, AN);
ok(!anNext.items.some((i) => i.title === 'On secret') && anNext.items.some((i) => i.title === 'On open'), 'Next leaves out items of deals the person cannot see');

section('deals named by display id');
const team = (await api.op('zz.deal', { company: 'Team Co', restricted: true, agent_allowed: true, team: JSON.stringify(['partner@venture.test']) }, O)).deal;
const tThing = (await api.op('zz.make', { name: 'Team thing', value: 1 }, O)).thing;
const pd = await api.op('zz.save', { thing: tThing.id, value: 2, deal: team.display_id, why: 'From the deck' }, A);
eq((await api.op('proposals.get', { proposal: pd.proposal }, O)).proposal.deal, team.id, 'a proposal naming the deal by display id stores its id');
ok((await api.op('next.list', { kinds: 'proposal' }, PA)).items.some((i) => i.key === 'kernel:proposal:' + pd.proposal), 'it is in the deal team member Next');
ok(!(await api.op('proposals.list', {}, AN)).proposals.some((x) => x.id === pd.proposal), 'and hidden from someone off the restricted deal');
const jd = await api.op('zz.make', { name: 'Team job thing', deal: team.display_id, ask: true }, O);
ok(jd.request !== '', 'a person asks about a thing that names its deal by display id', jd);
eq([(await api.op('zz.nda', { deal: team.display_id }, O)).allowed, (await api.op('zz.nda', { deal: team.id }, O)).allowed], [true, true], 'ndaAllowed takes the display id or the id');
const tdt = await api.op('tasks.save', { title: 'Data room', ref_collection: 'deals', ref_id: team.display_id }, PA);
eq([tdt.task.ref_id, tdt.task.deal], [team.id, team.id], 'a task on a deal by display id');
eq((await api.op('tasks.list', { deal: team.display_id, view: 'all' }, PA)).total, 1, 'tasks.list filters by display id');
await refuses(api, 'tasks.save', { title: 'x', ref_collection: 'deals', ref_id: team.display_id }, AN, 404, 'not_found', 'the display id of a restricted deal stays closed');
const od = await api.op('outbound.draft', { kind: 'reply', module: 'intake', to: '["a@b.co"]', subject: 's', body: 'b', deal: team.display_id }, A);
eq(od.deal, team.id, 'an outbound draft by display id stores the deal id');
const cd = await api.op('comments.add', { ref_collection: 'deals', ref_id: team.display_id, body: 'note' }, PA);
eq(cd.comment.ref_id, team.id, 'a comment on a deal by display id');
eq((await api.op('comments.list', { ref_collection: 'deals', ref_id: team.display_id }, PA)).total, 1, 'listed by display id');
await refuses(api, 'outbound.draft', { kind: 'reply', module: 'intake', to: '["a@b.co"]', subject: 's', body: 'b', deal: 'D-9999' }, PA, 404, 'not_found', 'an unknown display id is refused');

section('fund scope on deals');
await api.op('entities.save', { kind: 'fund', name: 'Fund II', currency: 'USD' }, O);
await api.op('members.update', { member: 'analyst@venture.test', funds: '["Fund II"]' }, { as: 'owner', pin: true });
eq((await api.call('zz.get', { thing: sOpen.id }, AN)).status, 404, 'a deal of a fund out of scope is hidden');

const s = summary('t03_proposals_scope');
process.exitCode = s.failed > 0 ? 1 : 0;
