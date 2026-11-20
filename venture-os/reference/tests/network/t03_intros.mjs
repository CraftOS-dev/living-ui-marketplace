// t03: who knows whom and the intro flow, research, imports, merges,
// search and restricted deals. Paths come from the engine (direct before
// one hop, weakest edge); an intro is asked by a person, drafted by your AI
// agent (simulated through ops with the agent token), approved and sent by
// the person, and its outcome recorded; a bounced send fails the intro.
import { firesOf, bridge, eq, firm, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';

await fresh();
const api = newApi();
const { O, P, AN, A } = await firm(api);
await api.op('capture.consent', { consent: true }, O);
await api.op('capture.consent', { consent: true }, P);
await api.op('capture.sync', { what: 'mail' }, O);
await api.op('interactions.log', { kind: 'call', people: '["sara@foundry-capital.vc"]', subject: 'Fund news' }, P);
await api.op('network.recompute', {}, O);

section('paths');
const pl = await api.op('network.paths', { person: 'leo@orbitalfreight.com' }, P);
ok(pl.paths.length === 2, 'two paths to Leo', pl.paths.map((p) => p.kind + ':' + p.weakest));
const [direct, hop] = pl.paths;
ok(direct.kind === 'direct' && direct.nodes[0].name === 'Olivia Owner' && direct.nodes[1].name === 'Leo Okafor', 'direct first: the owner knows Leo', direct);
ok(hop.kind === 'one_hop' && hop.nodes.map((n) => n.name).join(' > ') === 'Paul Partner > Sara Kim > Leo Okafor', 'then one hop: the partner through Sara, seen with Leo in the firm\'s thread', hop.nodes);
ok(hop.weakest === Math.min(hop.edges[0].score, hop.edges[1].score) && hop.edges.every((e) => e.last_at), 'a path is as strong as its weakest edge, with last contact on each', hop.edges);
const pc = await api.op('network.paths', { company: 'orbitalfreight.com' }, P);
ok(pc.paths.length === 2 && pc.target.kind === 'company' && pc.people_total === 1, 'the company answers the same paths through its people', pc.target);
const contract = await api.op('network.paths', { person: 'leo@orbitalfreight.com' }, A);
ok(contract.paths[0].path[0].member && contract.paths[0].path[1].person, 'the SPEC 4.6 path shape: [{member}, {person}]');
const nobody = await api.op('network.paths', { company: 'acmerobotics.ai' }, AN);
ok(nobody.paths.length >= 1, 'an analyst (network view) reads paths too');
const fi = await api.op('network.find', { q: 'orbital' }, P);
ok(fi.results[0] && fi.results[0].kind === 'company' && fi.results[0].band !== 'none', 'Who knows: the company comes first with its band', fi.results);

section('an intro through a connector, end to end');
// Your AI agent proposes an intro a person asked for (qa-cli RULING CLI-04); the person who accepts asks. Withdrawn here so the flow below starts clean.
const agentAsk = await api.op('intros.request', { target: 'leo@orbitalfreight.com', via: 'owner@venture.test', why: 'Olivia asked who knows Leo', evidence: 'Chat ask' }, A);
ok(agentAsk.proposed === true && /Intro: Leo Okafor/.test(agentAsk.label), 'your AI agent proposes an intro (a person accepts it)', agentAsk);
await api.op('proposals.withdraw', { proposal: agentAsk.proposal }, A);
await refuses(api, 'intros.request', { target: 'leo@orbitalfreight.com', via: 'analyst@venture.test' }, P, 409, 'path_gone', 'a path the firm does not have is refused');
const ask = await api.op('intros.request', { target: 'leo@orbitalfreight.com', via: 'partner@venture.test', connector: 'sara@foundry-capital.vc', note: 'Series A next month' }, P);
ok(ask.status === 'requested' && ask.to_email === 'sara@foundry-capital.vc' && ask.steps.at === 0 && ask.steps.labels.join(',') === 'Asked,Drafted,Sent,Made', 'the ask goes to the connector; StepTrack at Asked', ask);
await refuses(api, 'intros.request', { target: 'leo@orbitalfreight.com', via: 'partner@venture.test', connector: 'sara@foundry-capital.vc' }, P, 409, 'already_asked', 'asking twice is refused');
const idf = await firesOf('intro_draft');
ok(idf.length === 1 && ask.agent.intro_draft && ask.agent.intro_draft.request === idf[0].request_id, 'the ask fired intro_draft once, kept on the intro', { idf, agent: ask.agent });
{
  const g = await api.op('intros.get', { intro: ask.id }, A);
  ok(g.intro.connector.name === 'Sara Kim' && g.intro.note === 'Series A next month', "your AI agent reads the intro the fire named and the asker's note");
  const d = await api.op('intros.draft', { intro: ask.id, subject: 'Intro to Leo Okafor?', body: 'Hi Sara, would you introduce me to Leo?\n\nPaul Partner at Northwind Ventures backs logistics software...' }, A);
  ok(d.status === 'drafted' && d.draft.kind === 'intro' && d.draft.to[0] === 'sara@foundry-capital.vc' && d.draft.status === 'draft', 'the draft is an outbound intro message, never sent by the agent', d.draft);
  ok(!(await api.op('intros.get', { intro: ask.id }, P)).intro.agent.intro_draft.pending, 'the draft landed the ask');
}
const nx = await api.op('next.list', { kinds: 'draft' }, P);
const item = nx.items.find((i) => i.data && i.data.kind === 'intro');
ok(item && item.agent === true && item.actions[0].op === 'outbound.approve', 'the draft waits in the asker\'s Next with Approve and send', nx.items);
const nxAn = await api.op('next.list', { kinds: 'draft' }, AN);
ok(!nxAn.items.some((i) => i.key === item.key), 'it waits for the asker (the approver), not for others');
await refuses(api, 'outbound.approve', { outbound: item.data.outbound }, A, 403, 'agent_not_permitted', 'your AI agent never sends');
await api.op('outbound.approve', { outbound: item.data.outbound }, P);
const sentLog = await bridge.sent();
ok(sentLog.sent.some((m) => m.to === 'sara@foundry-capital.vc' && m.subject === 'Intro to Leo Okafor?'), 'the ask left through Gmail (mock)');
const after = await api.op('intros.get', { intro: ask.id }, P);
eq([after.intro.status, after.intro.steps.at], ['sent', 2], 'the intro is Sent');
await refuses(api, 'intros.outcome', { intro: ask.id, outcome: 'made' }, A, 403, 'agent_not_permitted', 'your AI agent never records the outcome');
const made = await api.op('intros.outcome', { intro: ask.id, outcome: 'made' }, P);
eq([made.status, made.steps.at, made.steps.labels[3]], ['made', 3, 'Made'], 'the person records Made');
const tl = await api.op('records.timeline', { person: 'leo@orbitalfreight.com' }, O);
ok(tl.items.some((i) => i.kind === 'intro'), 'the intro is on Leo\'s timeline');
const paths2 = await api.op('network.paths', { person: 'leo@orbitalfreight.com' }, P);
ok(paths2.intros.length === 1 && paths2.intros[0].status === 'made', 'network.paths shows the intro already asked');

section('a direct reach-out, cancelled');
const own = await api.op('intros.request', { target: 'leo@orbitalfreight.com', via: 'owner@venture.test' }, O);
eq(own.to_email, 'leo@orbitalfreight.com', 'the owner knows Leo: the draft goes to Leo directly');
const cancelled = await api.op('intros.cancel', { intro: own.id }, O);
eq(cancelled.status, 'cancelled', 'cancelled before any draft');
ok(!(cancelled.agent && cancelled.agent.intro_draft && cancelled.agent.intro_draft.pending), 'and nothing waits on your AI agent for it', cancelled.agent);

section('a bounced ask fails the intro');
await api.op('interactions.log', { kind: 'meeting', people: '["bounce@example.com"]' }, P);
await api.op('network.recompute', { person: 'bounce@example.com' }, P);
const b = await api.op('intros.request', { target: 'bounce@example.com', via: 'partner@venture.test' }, P);
await api.op('intros.draft', { intro: b.id, subject: 'Hello again', body: 'Good to see you.' }, A);
const bi = await api.op('intros.get', { intro: b.id }, P);
await api.op('outbound.approve', { outbound: bi.intro.outbound.id }, P);
const bf = await api.op('intros.get', { intro: b.id }, P);
eq([bf.intro.status, bf.intro.steps.labels[2]], ['failed', 'Failed'], 'the 200-with-error send marks the intro Failed');

section('a person drafts by hand');
await api.op('interactions.log', { kind: 'call', people: '["hand@written.example"]' }, O);
await api.op('network.recompute', { person: 'hand@written.example' }, O);
const h = await api.op('intros.request', { target: 'hand@written.example', via: 'owner@venture.test' }, P);
eq(h.to_email, 'owner@venture.test', 'the owner knows them: the partner\'s ask goes to the owner');
const hd = await api.op('intros.draft', { intro: h.id, subject: 'Could you intro me?', body: 'You know them well.' }, P);
eq(hd.status, 'drafted', 'the partner can write the ask without waiting');
{ const ha = (await api.op('intros.get', { intro: h.id }, P)).intro.agent.intro_draft; ok(!(ha && ha.pending), "and nothing waits on your AI agent's draft", ha); }

section('research a person asks for (a stage move asks nothing by itself)');
const acme = (await api.op('companies.upsert', { name: 'Acme Robotics', domain: 'acmerobotics.ai' }, O)).company;
const deal = await api.op('deals.create', { company: acme.id }, P);
const dv = deal.deal || deal;
await api.op('deals.move', { deal: dv.id, stage: 'first_meeting' }, P);
eq((await firesOf('company_research')).length, 0, 'deal.moved to First meeting asks no research by itself');
const first = await api.op('agent.ask', { trigger: 'company_research', record: acme.id }, P);
const crf = await firesOf('company_research');
ok(first.request !== '' && crf.length === 1 && crf[0].request_id === first.request, 'Ask your AI agent to research: one fire of company_research with the company', { first, crf });
await refuses(api, 'agent.ask', { trigger: 'company_research', record: acme.id }, P, 409, 'pending', 'asking for research again while it waits is refused');
await (async (job) => {
  const e = await api.op('records.enrich', { company: job.ref_id, fields: JSON.stringify({ description: 'Mobile picking arms for warehouses', hq_country: 'NL' }), source_ref: 'https://acmerobotics.ai/about' }, A);
  ok((e.company || e).changed && (e.company || e).changed.length === 2, 'your AI agent fills empty fields with a source', e);
  const comp = await api.op('companies.upsert', { name: 'Pickwise', domain: 'pickwise.example', tags: '["competitor"]', source_ref: 'https://example.com/pickwise' }, A);
  return { filled: ['description', 'hq_country'], competitors: [(comp.company || comp).id] };
})({ ref_id: acme.id });
const ac = await api.op('companies.get', { company: acme.id }, O);
const acv = ac.company || ac;
ok(acv.description === 'Mobile picking arms for warehouses' && acv.prov.description.by === 'agent', 'the company page shows the filled fact and that your AI agent set it');

section('invested flag and holdings for the record pages');
const before = await api.op('network.record', { company: acme.id }, O);
eq([before.invested, before.holdings], [false, 0], 'not held yet: invested false, holdings 0');
const fund = (await api.op('entities.list', { kind: 'fund' }, O)).entities[0];
const held = await api.call('holdings.create-from-deal', { deal: dv.id, override: true, fund: fund.id, instrument: 'safe_cap', amount: '500000', currency: 'USD', day: (await api.op('auth.me', {}, O)).today, cap: '15000000' }, O);
ok(held.status === 200, 'Mark invested through portfolio', held.body);
const recC = await api.op('network.record', { company: acme.id }, O);
ok(recC.invested === true && recC.holdings === 1 && recC.invested_cost.length === 1 && recC.invested_cost[0].currency === 'USD', 'network.record: invested true, one holding, cost per currency', recC);
const recP = await api.op('network.record', { person: 'maya@acmerobotics.ai' }, O);
ok(recP.invested === true && recP.holdings === 1 && recP.invested_cost.length === 0, 'a person page carries their company holding (no cost figure)', recP);

section('imports');
const csv = 'Full name,Email address,Organization,Job title\nNina Park,nina@parkcap.example,Park Capital,Partner\nOmar Diaz,omar@diaz.example,,CEO\n';
const pv = await api.op('imports.preview', { target: 'people', csv }, O);
ok(pv.rows === 2 || (pv.counts && (pv.counts.created === 2 || pv.counts.create === 2)) || JSON.stringify(pv).indexOf('created') >= 0, 'the preview maps the columns by synonyms', pv);
const run = await api.op('imports.run', { target: 'people', csv }, O);
ok(JSON.stringify(run).indexOf('created') >= 0, 'two people imported', run);
const nina = await api.op('network.people', { q: 'Nina' }, O);
ok(nina.people.length === 1 && nina.people[0].company && nina.people[0].company.name === 'Park Capital', 'Nina came in with her company');
const csv2 = 'Company,Website,Industry\nBlue Harbor,https://www.blueharbor.example,Logistics\n';
await api.op('imports.run', { target: 'companies', csv: csv2 }, O);
const bh = await api.op('network.companies', { q: 'Blue Harbor' }, O);
ok(bh.companies.length === 1 && bh.companies[0].domain === 'blueharbor.example' && bh.companies[0].sector === 'Logistics', 'a company import takes the domain from the website', bh.companies);
const ai = await api.op('imports.run', { target: 'people', csv: 'Name,Email\nZed Agent,zed@agentimport.example\n' }, A);
ok(ai.proposed === true || ai.proposal, 'your AI agent\'s import becomes a proposal', ai);

section('merges re-point the network');
await api.op('interactions.log', { kind: 'email', direction: 'in', people: '["maya.chen@gmail.com"]', subject: 'From my personal address' }, O);
const dupe = (await api.op('network.people', { q: 'maya.chen' }, O)).people[0];
const maya = (await api.op('network.people', { q: 'maya@acmerobotics.ai' }, O)).people[0];
await api.op('people.merge', { keep: maya.id, drop: dupe.id }, O);
const mi = await api.op('interactions.list', { person: maya.id }, O);
ok(mi.interactions.some((i) => i.subject === 'From my personal address'), 'the dropped record\'s touches now belong to the kept person');
const sq = await api.op('search.query', { q: 'maya.chen@gmail' }, O);
ok(sq.results.some((r) => r.module === 'network' && r.id === maya.id), 'Ctrl-K finds a person by a second email (network\'s provider)', sq.results);

section('restricted deals stay hidden');
const lumen = (await api.op('companies.upsert', { name: 'Lumen Health', domain: 'lumenhealth.io' }, O)).company;
const secret = await api.op('deals.create', { company: lumen.id, restricted: true }, O);
const sv = secret.deal || secret;
await api.op('interactions.log', { kind: 'meeting', people: '["raj@lumenhealth.io"]', deal: sv.id, subject: 'Term talk' }, O);
const ri = await api.op('interactions.list', { person: 'raj@lumenhealth.io' }, P);
ok(ri.hidden === 1 && !ri.interactions.some((i) => i.subject === 'Term talk'), 'a partner off the deal team sees hidden: 1', ri);
const rt = await api.op('records.timeline', { person: 'raj@lumenhealth.io' }, P);
ok(rt.hidden >= 1, 'the timeline marks it hidden too', rt.hidden);
const ra = await api.op('interactions.list', { person: 'raj@lumenhealth.io' }, A);
ok(ra.hidden === 1, 'and your AI agent sees it hidden unless the team allows it');

const s = summary('t03_intros');
process.exitCode = s.failed > 0 ? 1 : 0;
