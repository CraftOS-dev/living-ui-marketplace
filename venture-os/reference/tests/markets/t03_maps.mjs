// t03: market maps end to end. Segments, tiles placed, moved and removed by people with a dated history
// (as_of), relations computed from deals and holdings (restricted deals hidden), your AI agent's
// proposals (kernel proposals, accepted one by one or all of a map, stale ones skipped, promoted to
// automatic), the map_refresh ask and its stamp, the weekly cron behind its switch, comparison grids from a selection.
import { fresh, newApi, firm, section, ok, eq, refuses, summary, sleep } from './lib.mjs';

fresh();
const api = newApi();
const who = await firm(api);
const t = await api.op('theses.save', { name: 'Fintech infra', criteria: '[]' }, { as: 'owner' });

section('a map with segments');
const m = await api.op('maps.save', { name: 'Payments stack', thesis: t.thesis.id, segments: '["Acquiring","Ledgers","Payouts"]' }, { as: who.partner });
eq(m.map.segments.map((s) => s.key), ['acquiring', 'ledgers', 'payouts'], 'segment keys from labels');
await refuses(api, 'maps.save', { name: 'payments STACK' }, { as: 'owner' }, 409, 'duplicate', 'map names are unique');
await refuses(api, 'maps.save', { name: 'X', segments: '[]' }, { as: 'owner' }, 400, undefined, 'a map needs a segment');

section('people place, move and remove tiles');
for (const [name, domain] of [['Adyen', 'adyen.com'], ['Modern Treasury', 'moderntreasury.com'], ['Tipalti', 'tipalti.com'], ['Ledgerly', 'ledgerly.io'], ['Secret Co', 'secret.co']]) await api.op('companies.upsert', { name, domain }, { as: 'owner' });
const p1 = await api.op('maps.place', { map: 'Payments stack', company: 'adyen.com', segment: 'Acquiring', role: 'competitor', source_url: 'https://example.org/adyen' }, { as: who.partner });
eq(p1.entry.relation, 'competitor', 'placed as competitor');
await api.op('maps.place', { map: m.map.id, company: 'moderntreasury.com', segment: 'ledgers' }, { as: who.partner });
await api.op('maps.place', { map: m.map.id, company: 'Tipalti', segment: 'payouts' }, { as: who.partner });
await api.op('maps.place', { map: m.map.id, company: 'ledgerly.io', segment: 'ledgers' }, { as: who.partner });
await api.op('maps.place', { map: m.map.id, company: 'secret.co', segment: 'payouts' }, { as: who.partner });
const newCo = await api.op('maps.place', { map: m.map.id, company: 'Brand New Pay', name: 'Brand New Pay', website: 'brandnewpay.com', segment: 'acquiring' }, { as: who.partner });
ok(newCo.entry.company && newCo.entry.company.domain === 'brandnewpay.com', 'a company not in the records is created from --name and --website');
await refuses(api, 'maps.place', { map: m.map.id, company: 'nobody.example', segment: 'acquiring' }, { as: who.partner }, 404, undefined, 'an unknown company without --name is refused');
await refuses(api, 'maps.place', { map: m.map.id, company: 'adyen.com', segment: 'Crypto' }, { as: who.partner }, 400, 'invalid_param', 'unknown segment is named');
const mv = await api.op('maps.place', { map: m.map.id, company: 'Tipalti', segment: 'Ledgers' }, { as: who.partner });
eq(mv.entry.segment, 'ledgers', 'drag to another segment');
ok(mv.entry.moves.length === 2 && mv.entry.moves[1].from === 'payouts' && mv.entry.moves[1].to === 'ledgers', 'the move is in the history');
await api.op('maps.place', { map: m.map.id, company: 'Brand New Pay', remove: true }, { as: who.partner });
await refuses(api, 'maps.save', { map: m.map.id, segments: '["Acquiring","Ledgers"]' }, { as: 'owner' }, 409, 'conflict', 'a segment with companies cannot be dropped');
const ren = await api.op('maps.save', { map: m.map.id, segments: '[{"key":"acquiring","label":"Acceptance"},{"key":"ledgers","label":"Ledgers"},{"key":"payouts","label":"Payouts"}]' }, { as: 'owner' });
eq(ren.map.segments[0], { key: 'acquiring', label: 'Acceptance' }, 'rename keeps the key');

section('relations from deals and holdings');
await api.op('deals.create', { company: 'moderntreasury.com' }, { as: who.partner });
const inv = await api.op('deals.create', { company: 'adyen.com' }, { as: who.partner });
await api.op('deals.status', { deal: inv.deal.id, status: 'invested' }, { as: who.partner });
const pas = await api.op('deals.create', { company: 'Tipalti' }, { as: who.partner });
await api.op('deals.status', { deal: pas.deal.id, status: 'passed', reason: 'Market' }, { as: who.partner });
const sec = await api.op('deals.create', { company: 'secret.co', restricted: true }, { as: who.partner });
const ledgerly = await api.op('companies.get', { company: 'ledgerly.io' }, { as: 'owner' });
// A holding without an invested deal (imported positions): portfolio through lib_portfolio.holdingsOf.
const imp = await api.op('imports.run', { target: 'holdings', csv: 'company,fund,instrument,amount,day,currency\nLedgerly,Fund I,safe_cap,500000,2026-06-01,USD' }, { as: 'owner' });
ok(imp && !(imp.errors && imp.errors.length), 'a holding imported for Ledgerly', imp);
const g1 = await api.op('maps.get', { map: m.map.id }, { as: who.partner });
const rel = {};
for (const e of g1.map.entries) rel[e.company.name] = e.relation;
eq(rel, { Adyen: 'portfolio', 'Modern Treasury': 'pipeline', Tipalti: 'passed', Ledgerly: 'portfolio', 'Secret Co': 'pipeline' }, 'relations: invested, open, passed, holding, restricted deal for its team');
eq(g1.map.counts, { portfolio: 2, pipeline: 2, passed: 1, tracked: 0, competitor: 0 }, 'counts by relation');
const ga = await api.op('maps.get', { map: m.map.id }, { as: who.analyst });
const secretForAnalyst = ga.map.entries.filter((e) => e.company.name === 'Secret Co')[0];
ok(secretForAnalyst.relation === 'tracked' && ga.map.hidden === 1, 'analyst outside the deal team: restricted deal hidden, counted');
ok(g1.map.history.length >= 6 && g1.map.history[0].at >= g1.map.history[g1.map.history.length - 1].at, 'history newest first');

// Fund scope: a partner limited to Fund II does not see Fund I's holding behind a tile (lib_portfolio.holdingsFor).
await api.op('entities.save', { kind: 'fund', name: 'Fund II', currency: 'USD', vintage: 2026 }, { as: 'owner' });
const f2 = (await api.op('entities.list', {}, { as: 'owner' })).entities.find((e) => e.name === 'Fund II');
await api.op('members.invite', { email: 'scoped@venture.test', name: 'Sol Scoped', role: 'partner', funds: JSON.stringify([f2.id]) }, { as: 'owner', pin: true }).then(async (inv) => {
  const joined = await api.op('auth.accept-invite', { email: 'scoped@venture.test', code: inv.code, password: 'demo-pass-1' });
  api.setToken('scoped@venture.test', joined.token);
});
const gs = await api.op('maps.get', { map: m.map.id }, { as: 'scoped@venture.test' });
const ledgerlyScoped = gs.map.entries.find((e) => e.company.name === 'Ledgerly');
eq(ledgerlyScoped.relation, 'tracked', 'outside Fund I, the holding does not make Ledgerly portfolio');

section('the map as it stood on a day');
const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const past = await api.op('maps.get', { map: m.map.id, as_of: yesterday }, { as: who.partner });
eq(past.map.entries.length, 0, 'two days ago the map was empty');
const today = new Date().toISOString().slice(0, 10);
const now = await api.op('maps.get', { map: m.map.id, as_of: '2099-01-01' }, { as: who.partner });
eq(now.map.entries.length, 5, 'a future day shows today\'s map (removed tile left out)');
ok(today.length === 10, 'day format');

section('your AI agent proposes tiles');
await refuses(api, 'maps.place', { map: m.map.id, company: 'adyen.com', segment: 'ledgers' }, { as: 'agent' }, 403, 'agent_not_permitted', 'agent cannot place directly');
await refuses(api, 'maps.propose', { map: m.map.id, company: 'adyen.com', segment: 'ledgers', why: 'x' }, { as: 'agent' }, 400, 'missing_param', 'agent needs a source link');
const pr1 = await api.op('maps.propose', { map: m.map.id, company: 'Stripe', name: 'Stripe', website: 'stripe.com', segment: 'acquiring', role: 'competitor', source_url: 'https://example.org/stripe', why: 'Largest acquirer for startups' }, { as: 'agent' });
ok(pr1.proposed === true, 'agent proposal stored');
const c0 = await api.call('companies.get', { company: 'stripe.com' }, { as: 'owner' });
eq(c0.status, 404, 'the dry run created nothing');
const pr2 = await api.op('maps.propose', { map: m.map.id, company: 'moderntreasury.com', segment: 'payouts', source_url: 'https://example.org/mt', why: 'Moved into payouts' }, { as: 'agent' });
const pr3 = await api.op('maps.propose', { map: 'Payments stack', company: 'Tipalti', remove: true, why: 'Out of scope' }, { as: 'agent' });
ok(pr2.proposed && pr3.proposed, 'move and removal proposed');
const g2 = await api.op('maps.get', { map: m.map.id }, { as: who.partner });
eq(g2.map.proposals.length, 3, 'map shows 3 proposals waiting');
ok(g2.map.proposals.some((x) => x.company.name === 'Stripe' && x.segment === 'acquiring' && x.source_url === 'https://example.org/stripe'), 'a ghost tile carries company, segment and source');
const nx = await api.op('next.list', { kinds: 'proposal' }, { as: who.partner });
ok(nx.items.filter((x) => x.chips.some((c) => c.label === 'Market map')).length === 3, 'each proposal is in Next');
const one = await api.op('proposals.accept', { proposal: pr1.proposal }, { as: who.partner });
eq(one.applied, 1, 'accept one from Next');
// A person moves the tile pr2 would move: the proposal is stale.
await api.op('maps.place', { map: m.map.id, company: 'moderntreasury.com', segment: 'acquiring' }, { as: who.partner });
const all = await api.op('maps.accept', { map: m.map.id }, { as: who.partner });
ok(all.applied === 1 && all.failed === 1, 'accept all: the removal applies, the stale move is skipped (' + all.applied + '/' + all.failed + ')');
const g3 = await api.op('maps.get', { map: m.map.id }, { as: who.partner });
ok(g3.map.entries.some((e) => e.company.name === 'Stripe' && e.relation === 'competitor'), 'Stripe on the map as competitor');
ok(!g3.map.entries.some((e) => e.company.name === 'Tipalti'), 'Tipalti removed');
eq(g3.map.proposals.length, 0, 'nothing waiting');
await refuses(api, 'maps.accept', { map: m.map.id }, { as: who.partner }, 404, 'not_found', 'nothing to accept');
await refuses(api, 'maps.accept', { map: m.map.id }, { as: who.analyst }, 403, undefined, 'analyst cannot accept');

section('promoted to automatic');
await api.op('settings.autonomy', { autonomy: '{"map_entries":"auto"}' }, { as: 'owner' });
const auto = await api.op('maps.propose', { map: m.map.id, company: 'Tipalti', segment: 'payouts', source_url: 'https://example.org/t', why: 'Back in scope' }, { as: 'agent' });
ok(auto.entry && auto.entry.segment === 'payouts' && auto.entry.actor === 'agent', 'promoted: your AI agent places directly');
await api.op('settings.autonomy', { autonomy: '{"map_entries":"ask"}' }, { as: 'owner' });

section('map_refresh: the weekly cron behind its switch, and Refresh now');
await api.op('zzstub.cron-maps', {}, { as: 'owner' });
ok(!((await api.op('maps.get', { map: m.map.id }, { as: who.partner })).map.refresh || {}).open, 'the switch is off: the weekly cron asks nothing');
await api.op('settings.update', { agent_policy: '{"map_refresh":true}' }, { as: 'owner' });
await api.op('zzstub.cron-maps', {}, { as: 'owner' });
ok(((await api.op('maps.get', { map: m.map.id }, { as: who.partner })).map.refresh || {}).open, 'switched on: the weekly cron asks map_refresh with the map');
await api.op('maps.propose', { map: m.map.id, company: 'Payhawk', segment: 'payouts', source_url: 'https://example.org/p', why: 'Weekly refresh' }, { as: 'agent' });
const l = await api.op('maps.list', {}, { as: who.partner });
ok(l.maps[0].last_refresh_at !== '', "your AI agent's proposal landed the refresh and stamps the map");
await api.op('settings.update', { agent_policy: '{"map_refresh":false}' }, { as: 'owner' });
await new Promise((r) => setTimeout(r, 1000));
const asked = await api.call('agent.ask', { trigger: 'map_refresh', record: m.map.id }, { as: who.partner });
ok(asked.status === 200 || (asked.status === 409 && asked.body.code === 'cooldown'), 'a partner can ask for a refresh now (or is told the 300 s cooldown is running)', asked.body);
const l2 = await api.op('maps.get', { map: m.map.id }, { as: who.partner });
ok(l2.map.refresh && l2.map.refresh.status !== '', 'the map shows the refresh waiting');

section('comparison grid from a selection');
const ids = g3.map.entries.slice(0, 3).map((e) => e.company.id);
const grid = await api.op('compare.save', { name: 'Ledgers compared', companies: JSON.stringify(ids), origin: 'markets', market_ref: m.map.id }, { as: who.partner });
const gl = await api.op('compare.list', {}, { as: who.partner });
ok(grid.grid && gl.grids[0].rows === 3 && gl.grids[0].origin === 'markets', 'compare.save (diligence stand-in) takes the selected companies');

section('search');
const s = await api.op('search.query', { q: 'Payments' }, { as: who.partner });
ok((s.results || s.items || []).some((h) => h.kind === 'map' && h.href === '#/markets/' + t.thesis.id + '/map'), 'search finds the map');
await sleep(10);

const res = summary('t03_maps');
process.exit(res.failed > 0 ? 1 : 0);
