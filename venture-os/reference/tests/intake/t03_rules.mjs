// Next actions run exactly as Focus mode runs them (the action's op and params, plus the chosen chip),
// restricted deals in the intake views, proposal dry runs, the agent's limits, and speed with a full Inbox.
import { newApi, fresh, setupFirm, section, ok, eq, summary, PEOPLE, upload, deck, refuses, bridge, DEMO } from './lib.mjs';

const P = PEOPLE.partner;

fresh();
await bridge.reset();
await bridge.mode('search_gmail', 'offline');
const api = newApi();
await setupFirm(api);
await api.op('settings.update', { modules: { intake: { sweep: false } } }, { as: 'owner' });
const inv = await api.op('members.invite', { email: 'out@northwind.test', name: 'Otto Outsider', role: 'partner' }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: 'out@northwind.test', code: inv.code, password: DEMO.password });
api.setToken('out@northwind.test', joined.token);

/** Add an item and walk it to Ready as your AI agent would. */
async function readyItem(name, extra = {}) {
  const it = await api.op('intake.add', Object.assign({ company: name, text: name + ' raised a seed round.' }, extra), { as: P });
  // Fix 8: your AI agent works on the item the fire named (no queue to claim from).
  await api.op('triage.start', { item: it.id }, { as: 'agent' });
  await api.op('triage.facts-save', { item: it.id, facts: [{ key: 'round_type', value: 'seed', grade: 'founder_reported', quote: name + ' raised a seed round.' }] }, { as: 'agent' });
  return it;
}

/** Run a Next action as Focus does: its op with its params, plus the chosen value. */
async function act(item, label, chosen, as) {
  const a = item.actions.find((x) => x.label === label);
  const params = Object.assign({}, a.params);
  if (a.choose) params[a.choose.param] = chosen;
  return api.op(a.op, params, { as: as || P });
}

section('Next actions as Focus mode runs them');
const a = await readyItem('Alpha Freight');
const b = await readyItem('Beta Bio');
const c = await readyItem('Gamma Grid');
let next = await api.op('next.list', { kinds: 'verdict' }, { as: P });
const ia = next.items.find((x) => x.key === 'intake:' + a.id);
const ib = next.items.find((x) => x.key === 'intake:' + b.id);
const ic = next.items.find((x) => x.key === 'intake:' + c.id);
ok(ia && ib && ic, 'three verdicts wait', next.items.map((x) => x.title));
ok(ia.data.one_liner !== undefined && ia.data.number === a.number, 'the custom card gets its data', ia.data);
const r1 = await act(ia, 'Advance');
ok(r1.deal && r1.deal.number, 'A: Advance opened ' + (r1.deal && r1.deal.number));
const r2 = await act(ib, 'Pass', 'timing');
ok(r2.item.status === 'passed' && r2.pass.reason === 'timing', 'P: Pass with the chosen chip', r2.pass && r2.pass.reason);
const r3 = await act(ic, 'Hold', '30');
ok(r3.item.status === 'held' && r3.item.hold_until > r3.item.due.day, 'H: Hold for a month', r3.item.hold_until);
next = await api.op('next.list', { kinds: 'verdict' }, { as: P });
ok(!next.items.some((x) => [a.id, b.id, c.id].some((id) => x.key === 'intake:' + id)), 'all three left Next (All clear)');
const cnt = await api.op('next.count', {}, { as: P });
ok(typeof cnt.total === 'number', 'next.count answers', cnt);

section('restricted deals');
await api.op('deals.restrict', { deal: r1.deal.number, restricted: true }, { as: P });
await refuses(api, 'intake.verdict', { deal: r1.deal.number }, { as: 'out@northwind.test' }, 403, undefined, 'an outsider cannot read the intake view of a restricted deal');
await refuses(api, 'intake.verdict', { deal: r1.deal.number }, { as: 'agent' }, 403, undefined, 'nor your AI agent unless the team allows it');
const own = await api.op('intake.verdict', { deal: r1.deal.number }, { as: P });
ok(own.item && own.item.number === a.number, 'the deal team reads it');
const a2 = await api.op('intake.add', { company: 'Alpha Freight' }, { as: P });
const h = await api.op('intake.get', { item: a2.id }, { as: 'out@northwind.test' });
ok(h.history.hidden === 1 && !h.history.prior.some((x) => x.kind === 'deal'), 'history hides the restricted deal and says so (hidden: 1)', h.history);
const h2 = await api.op('intake.get', { item: a2.id }, { as: P });
ok(h2.history.prior.some((x) => x.kind === 'deal' && x.label === r1.deal.number), 'its team sees the deal in the history', h2.history);

section('proposals are checked before they are stored');
await refuses(api, 'intake.merge', { item: a2.id, into: a2.id }, { as: 'agent' }, 400, undefined, 'a merge into itself is refused at once, not stored');
await refuses(api, 'intake.merge', { item: a2.id, into: a.id }, { as: 'agent' }, 409, 'not_open', 'a merge into an advanced item is refused at once');
const pr = await api.op('proposals.list', {}, { as: 'owner' });
ok(pr.proposals.length === 0, 'nothing was stored', pr.proposals);

section('your AI agent adds, reads and drafts; nothing else');
await refuses(api, 'intake.update', { item: a2.id, name: 'X' }, { as: 'agent' }, 403, 'agent_not_permitted', 'intake.update is people only');
await refuses(api, 'intake.hold', { item: a2.id }, { as: 'agent' }, 403, 'agent_not_permitted', 'hold is people only');
await refuses(api, 'passes.write', { item: b.id }, { as: 'agent' }, 403, 'agent_not_permitted', 'writing from the template is people only');
await refuses(api, 'intake.add', { company: 'Path Co', paths: ['C:/Windows/win.ini'] }, { as: P }, 403, 'not_permitted', 'paths are for your AI agent only');
await refuses(api, 'triage.facts-save', { item: a2.id, facts: [{ key: 'raise_minor', value: '100', currency: 'USD', grade: 'artifact', source: 'person' }] }, { as: 'agent' }, 400, 'invalid_fact', 'your AI agent cannot claim a person as the source');
await refuses(api, 'triage.facts-save', { item: a2.id, facts: [{ key: 'raise_minor', value: '100', grade: 'artifact', quote: 'x' }] }, { as: 'agent' }, 400, 'invalid_fact', 'money needs its currency');
await refuses(api, 'triage.facts-save', { item: a2.id, facts: [{ key: 'stage', value: 'unicorn', grade: 'artifact', url: 'https://example.com' }] }, { as: 'agent' }, 400, 'invalid_fact', 'coded values only (stage)');
const pub = await api.op('triage.facts-save', { item: a2.id, facts: [{ key: 'hq_country', value: 'US', grade: 'public', url: 'https://example.com/about' }] }, { as: 'agent' });
ok(pub.item.facts.find((x) => x.key === 'hq_country').num_kind === 'external' || pub.item.facts.find((x) => x.key === 'hq_country').source === 'public', 'a public fact keeps its url', pub.item.facts);
const corr = await api.op('triage.facts-save', { item: a2.id, facts: [{ key: 'raise_minor', value: '2500000', currency: 'USD', grade: 'founder_reported' }] }, { as: P });
const rf = corr.item.facts.find((x) => x.key === 'raise_minor');
ok(rf.status === 'confirmed' && rf.source === 'person' && rf.num_kind === 'entered', 'a person\'s correction is confirmed and marked entered', rf);

section('an email from a scout is a scout submission');
const ms = await api.op('scouts.save', { name: 'Maya the Scout', email: 'maya@acmerobotics.ai' }, { as: P });
await bridge.mode('search_gmail', 'ok');
const sw = await api.op('intake.sweep', {}, { as: P });
ok(sw.added === 3, 'the sweep filed three messages', sw);
const acme = (await api.op('intake.list', { q: 'Acme' }, { as: P })).items[0];
ok(acme && acme.channel === 'scout' && acme.source.kind === 'scout' && acme.source.label === 'Maya the Scout', 'the Acme email came from an active scout', acme && acme.source);
const sl = await api.op('scouts.list', {}, { as: P });
ok(sl.scouts.find((x) => x.id === ms.id).items === 1, 'the scout\'s count went up');

section('company merges re-point intake rows');
const x1 = await api.op('intake.add', { company: 'Merge Me Inc' }, { as: P });
const x2 = await api.op('intake.add', { company: 'mergeme.io' }, { as: P });
await api.op('companies.merge', { keep: x2.company.id, drop: x1.company.id }, { as: P });
const x1b = await api.op('intake.get', { item: x1.id }, { as: P });
ok(x1b.company.id === x2.company.id, 'the item follows the company it merged into', x1b.company);

section('speed with a full Inbox');
for (let i = 0; i < 120; i++) await api.op('intake.add', { company: 'Bulk ' + i, received_at: new Date(Date.now() - (i % 20) * 86400000).toISOString() }, { as: P });
let t0 = Date.now();
const big = await api.op('intake.list', {}, { as: P });
const tList = Date.now() - t0;
ok(big.items.length === 50 && big.next_offset === 50, 'pages of 50 with a next offset (scroll pagination)', { n: big.items.length, next: big.next_offset });
t0 = Date.now();
const nb = await api.op('next.list', {}, { as: P });
const tNext = Date.now() - t0;
t0 = Date.now();
await api.op('next.count', {}, { as: P });
const tCount = Date.now() - t0;
ok(tList < 1500 && tNext < 2500 && tCount < 2500, 'intake.list ' + tList + ' ms, next.list ' + tNext + ' ms, next.count ' + tCount + ' ms with ' + big.counts.new + ' new items', nb.total);
ok(nb.items.filter((x) => x.kind === 'stall').length > 0 && nb.items[0].kind === 'stall', 'overdue items lead Next as stalls');

summary('t03 rules');
