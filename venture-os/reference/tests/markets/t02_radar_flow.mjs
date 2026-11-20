// t02: a thesis and its radar end to end without the network (registry sources only): radar proposals,
// schedule, a run and the radar_sweep it asks for, your AI agent screening and adding candidates (rules: known,
// thesis unmet, repeats), Next "candidate" items and their actions (Add to Inbox through lib_intake.add,
// Dismiss), undo, the contract lib_markets.candidatesFor, theses.summary, cron due runs, search, timeline.
import { fresh, newApi, firm, section, ok, eq, refuses, summary, thesisWithRadar } from './lib.mjs';

fresh();
const api = newApi();
const who = await firm(api);
const criteria = [
  { key: 'sector', op: 'in', values: ['fintech'] },
  { key: 'raise_minor', op: 'between', min: 50000000, max: 2000000000, currency: 'USD', required: true },
];

section('thesis and radar');
const { thesis, radar } = await thesisWithRadar(api, 'Fintech infra', criteria, ['companies_house', 'jp_corporate']);
ok(radar.thesis.id === thesis.id && radar.status === 'active', 'radar saved under its thesis');
eq(radar.schedule.label, 'Mon 08:00', 'schedule label');
ok(radar.next_run_at > new Date().toISOString(), 'next run is in the future (' + radar.next_run_at + ')');
const nr = new Date(radar.next_run_at);
ok(nr.getUTCDay() === 1 && (nr.getUTCHours() === 13 || nr.getUTCHours() === 12) && nr.getUTCMinutes() === 0, 'next run is Monday 08:00 New York');
const daily = await api.op('radars.save', { radar: radar.id, schedule: 'daily 07:30' }, { as: who.partner });
eq(daily.radar.schedule.label, 'Daily 07:30', 'partner changes the schedule');
ok(Date.parse(daily.radar.next_run_at) - Date.now() <= 86400000 + 60000, 'daily next run within a day');
await refuses(api, 'radars.save', { radar: radar.id, schedule: 'hourly' }, { as: 'owner' }, 400, 'invalid_param', 'bad schedule');
await refuses(api, 'radars.save', { radar: radar.id, sources: '["linkedin"]' }, { as: 'owner' }, 400, 'invalid_param', 'unknown source');
await refuses(api, 'radars.save', { radar: radar.id, filters: '{"edgar_form_d":{"industries":["Crypto"]}}' }, { as: 'owner' }, 400, 'invalid_param', 'unknown Form D industry');
await refuses(api, 'radars.save', { radar: radar.id, filters: '{"edgar_form_d":{"colour":1}}' }, { as: 'owner' }, 400, undefined, 'unknown filter key');
const f = await api.op('radars.save', { radar: radar.id, filters: '{"edgar_form_d":{"industries":["Other Technology"],"states":["ca","NY"],"min_raise_minor":50000000}}' }, { as: 'owner' });
eq(f.radar.filters.edgar_form_d.states, ['CA', 'NY'], 'states upper-cased');
eq(f.radar.filters.hacker_news.min_points, 10, 'other filters keep their defaults');

section('your AI agent proposes radar changes');
const prop = await api.op('radars.save', { radar: radar.id, query: 'payments infrastructure', why: 'Broaden GitHub search', evidence: 'Partner note' }, { as: 'agent' });
ok(prop.proposed === true && prop.proposal, 'agent radars.save becomes a proposal');
const before = await api.op('radars.get', { radar: radar.id }, { as: 'owner' });
eq(before.radar.query, 'payments', 'nothing changed before accept');
const acc = await api.op('proposals.accept', { proposal: prop.proposal }, { as: who.partner });
ok(acc.applied === 1, 'partner accepts');
const after = await api.op('radars.get', { radar: thesis.name }, { as: 'owner' });
eq(after.radar.query, 'payments infrastructure', 'query changed after accept (radar found by thesis name)');
await refuses(api, 'radars.save', { thesis: 'Nope thesis', why: 'x' }, { as: 'agent' }, 404, undefined, 'agent proposal for an unknown thesis is refused by the dry run');

section('a run with registry sources only');
const run1 = await api.op('radars.run', { radar: radar.id }, { as: who.partner });
eq(run1.run, 1, 'first run');
eq(run1.new, 0, 'no app source, nothing pulled');
eq(run1.counts.companies_house, { by: 'agent' }, 'Companies House is your AI agent\'s');
ok(typeof run1.request === 'string' && run1.request !== '', 'the run asked your AI agent (radar_sweep with the radar)');
ok(run1.radar.steps.at === 1 && run1.radar.steps.state === 'screening', 'StepTrack at Screen while the ask waits');
const rg = await api.op('radars.get', { radar: radar.id }, { as: 'agent' });
ok(rg.radar.thesis && rg.radar.thesis.name === 'Fintech infra', 'your AI agent opens the radar the fire named, with its thesis', rg.radar.thesis);
ok(JSON.stringify(rg.radar).indexOf('companies_house') >= 0 && JSON.stringify(rg.radar).indexOf('jp_corporate') >= 0, 'registries are named for your AI agent');

section('your AI agent adds candidates, by the rules');
await api.op('companies.upsert', { name: 'Known Payments Co', domain: 'knownpay.com' }, { as: 'owner' });
const a1 = await api.op('signals.add', { radar: radar.id, name: 'Ledgerly', domain: 'ledgerly.io', summary: 'API-first ledger for fintechs', source_url: 'https://find-and-update.company-information.service.gov.uk/company/01234567', source: 'companies_house', kind: 'incorporation', context: '{"founders":"Ex-Stripe engineers","links":["https://ledgerly.io/about"]}', facts: '{"raise_minor":300000000,"currency":"USD","hq_country":"GB"}' }, { as: 'agent' });
eq(a1.signal.status, 'candidate', 'net-new fitting candidate');
eq(a1.signal.fit.state, 'met', 'fit met by the engine');
const a2 = await api.op('signals.add', { radar: radar.id, name: 'Known Payments Co', domain: 'knownpay.com', summary: 'Payments', source_url: 'https://example.org/k' }, { as: 'agent' });
eq(a2.signal.status, 'known', 'a company in the records is known, not a candidate');
const a3 = await api.op('signals.add', { radar: radar.id, name: 'Megacorp Pay', domain: 'megapay.com', summary: 'Big', source_url: 'https://example.org/m', facts: '{"raise_minor":90000000000,"currency":"USD"}' }, { as: 'agent' });
eq(a3.signal.status, 'screened_out', 'a required criterion unmet by facts is screened out by rule');
const a4 = await api.op('signals.add', { radar: radar.id, name: 'Ledgerly Ltd', domain: 'ledgerly.io', summary: 'Repeat', source_url: 'https://example.org/l' }, { as: 'agent' });
ok(a4.duplicate === true && a4.signal.id === a1.signal.id, 'same domain answers the existing signal');
const a5 = await api.op('signals.add', { radar: radar.id, name: 'Quiet Rails', summary: 'Rails for B2B payouts', source_url: 'https://example.org/q', licence: 'internal_only', kind: 'funding' }, { as: 'agent' });
eq(a5.signal.licence, 'internal_only', 'licensed data tagged internal only');
eq(a5.signal.fit, null, 'no facts, no fit (unknown is not unmet)');
await refuses(api, 'signals.add', { radar: radar.id, name: 'No Source Inc', summary: 'x' }, { as: 'agent' }, 400, 'missing_param', 'agent needs source_url');
await refuses(api, 'signals.add', { radar: radar.id, name: 'No Line Inc', source_url: 'https://example.org/n' }, { as: 'agent' }, 400, 'missing_param', 'agent needs a one-line summary');
await refuses(api, 'signals.add', { radar: radar.id, name: 'Bad Facts', summary: 'x', source_url: 'https://example.org/b', facts: '{"revenue":1}' }, { as: 'agent' }, 400, 'invalid_param', 'unknown fact key named');

section('screening new signals');
// A person can also add a raw signal (source person); it stays new for screening when unscreened.
const p1 = await api.op('signals.add', { radar: radar.id, name: 'Coinflow Labs', domain: 'coinflow.dev', source_url: 'https://example.org/c' }, { as: who.partner });
eq(p1.signal.source, 'person', 'a person\'s add is marked as by hand');
eq(p1.signal.status, 'candidate', 'a person\'s add is a candidate');
const scr = await api.op('signals.screen', { items: JSON.stringify([{ id: a5.signal.id, keep: true, summary: 'B2B payouts, seed', context: { hiring: '4 engineers in a month' } }]) }, { as: 'agent' });
eq(scr.candidates, 1, 'screen keeps it');
await refuses(api, 'signals.screen', { items: JSON.stringify([{ id: a2.signal.id, keep: true, summary: 'x' }]) }, { as: 'agent' }, 409, 'conflict', 'a known signal is not open to screening');
await refuses(api, 'signals.screen', { items: JSON.stringify([{ id: a5.signal.id, keep: true }]) }, { as: 'agent' }, 400, 'missing_param', 'keeping needs a summary');
const g = await api.op('radars.get', { radar: radar.id }, { as: 'owner' });
ok(g.radar.steps.at === 2 && g.radar.steps.state === 'ready', 'StepTrack Ready once your AI agent added its candidates (the ask landed)');

section('Next: one candidate item per radar run');
const n1 = await api.op('next.list', { kinds: 'candidate' }, { as: who.partner });
const item = n1.items.filter((x) => x.module === 'markets')[0];
ok(item && item.kind === 'candidate' && item.card === 'candidates', 'candidate item with the candidates card');
ok(item && /^Fintech infra · \d+ new$/.test(item.title), 'title "Fintech infra · n new" (' + (item && item.title) + ')');
const ids = item ? item.data.candidates.map((c) => c.id) : [];
ok(ids.indexOf(a1.signal.id) >= 0 && ids.indexOf(a5.signal.id) >= 0 && ids.indexOf(a2.signal.id) < 0 && ids.indexOf(a3.signal.id) < 0, 'candidates only (known and screened out stay out)');
ok(item && item.actions.length === 2 && item.actions[0].op === 'signals.to-inbox' && item.actions[0].primary, 'Add all is the primary action');
ok(item && item.data.candidates[0].source_url !== '' && item.data.candidates[0].summary !== undefined, 'each candidate carries its line and source link');
const an = await api.op('next.list', { kinds: 'candidate' }, { as: who.analyst });
const ai = an.items.filter((x) => x.module === 'markets')[0];
ok(ai && ai.actions.length === 0, 'analyst sees the item without actions (no markets edit)');
const sc = await api.op('next.list', {}, { as: who.scout });
ok(!sc.items.some((x) => x.module === 'markets'), 'scout sees no markets items');

section('Add to Inbox and Dismiss, one click each');
const add = await api.op('signals.to-inbox', { signals: a1.signal.id }, { as: who.partner });
eq(add.added, 1, 'one added');
const l1 = await api.op('signals.list', { radar: radar.id, status: 'added' }, { as: 'owner' });
ok(l1.total === 1 && l1.signals[0].intake_item !== '', 'signal added with its intake item');
const got = await api.op('intake.get', { item: l1.signals[0].intake_item }, { as: 'owner' });
const it = got.item ?? got;
ok(it.channel === 'sourced' && it.thesis && it.thesis.id === thesis.id && it.company && it.company.name === 'Ledgerly' && /Sourced by the radar Fintech infra/.test(it.text) && /Ex-Stripe/.test(it.text), 'intake item: channel sourced, the company, the thesis and the context');
eq(it.licence, 'public', 'a public candidate is a public intake item');
ok(it.url === '' || !/company-information/.test(it.url), 'the source link is text, never the item url');
const comp = await api.op('companies.get', { company: 'ledgerly.io' }, { as: 'owner' });
ok(comp.company && comp.company.origin === 'markets', 'company record created with origin markets');
const undo = await api.op('activity.undo', { entry: add._activity }, { as: who.partner });
ok(undo && undo.undone === 1, 'partner undoes the add as one unit');
const l2 = await api.op('signals.list', { radar: radar.id, status: 'candidate' }, { as: 'owner' });
ok(l2.signals.some((s) => s.id === a1.signal.id), 'undo puts it back as a candidate');
await api.op('signals.to-inbox', { signals: JSON.stringify([a1.signal.id]) }, { as: who.partner });
const lic = await api.op('signals.add', { radar: radar.id, name: 'Vaultline', domain: 'vaultline.co', summary: 'Licensed-data find', source_url: 'https://example.org/v', licence: 'internal_only' }, { as: 'agent' });
const licAdd = await api.op('signals.to-inbox', { signals: lic.signal.id }, { as: who.partner });
const licItem = await api.op('intake.get', { item: licAdd.items[0].intake_item }, { as: 'owner' });
eq((licItem.item ?? licItem).licence, 'internal_only', 'an internal-only candidate becomes an internal-only intake item (intake licence field)');
ok(!/Licence/.test((licItem.item ?? licItem).text), 'the licence is a field, not a line of text');
const dis = await api.op('signals.dismiss', { signals: JSON.stringify([a5.signal.id]), reason: 'too_early' }, { as: who.partner });
eq(dis.dismissed, 1, 'dismissed with a reason chip');
await refuses(api, 'signals.dismiss', { signals: a5.signal.id, reason: 'boring' }, { as: who.partner }, 400, 'invalid_param', 'reason is a chip value');
await refuses(api, 'signals.to-inbox', { signals: a1.signal.id }, { as: who.analyst }, 403, undefined, 'analyst cannot add to the Inbox');
const n2 = await api.op('next.list', { kinds: 'candidate' }, { as: who.partner });
const left = n2.items.filter((x) => x.module === 'markets')[0];
ok(left && left.data.candidates.length === 1 && left.data.candidates[0].id === p1.signal.id, 'the item shrinks to what is left');
const act = left.actions.filter((a) => a.label === 'Dismiss all')[0];
await api.op(act.op, act.params, { as: who.partner });
const n3 = await api.op('next.list', { kinds: 'candidate' }, { as: who.partner });
ok(!n3.items.some((x) => x.module === 'markets'), 'the item leaves Next when every candidate is decided');

section('contract and summary');
const cf = await api.op('zzstub.candidates', { thesis: thesis.id }, { as: 'owner' });
eq(cf.signals.length, 0, 'candidatesFor: none left');
await api.op('signals.add', { radar: radar.id, name: 'Settlr', domain: 'settlr.co', summary: 'Settlement API', source_url: 'https://example.org/s' }, { as: 'agent' });
const cf2 = await api.op('zzstub.candidates', { thesis: 'Fintech infra' }, { as: 'owner' });
ok(cf2.signals.length === 1 && cf2.signals[0].name === 'Settlr', 'candidatesFor returns the open candidate');
const sum = await api.op('theses.summary', {}, { as: who.partner });
const tile = sum.theses[0];
ok(tile.net_new === 1 && tile.candidates === 1 && tile.added === 2, 'tile counts: 1 net-new, 2 added (' + JSON.stringify({ n: tile.net_new, c: tile.candidates, a: tile.added }) + ')');
ok(tile.weekly.length === 12 && tile.weekly[11] >= 3, 'weekly sparkline counts this week (' + tile.weekly.join(',') + ')');
ok(tile.radar && tile.radar.last_run_at !== '', 'tile has the radar and its last run');

section('cron runs a due radar once');
await api.op('zzstub.due', { radar: radar.id }, { as: 'owner' });
await api.op('zzstub.cron-radars', {}, { as: 'owner' });
const g2 = await api.op('radars.get', { radar: radar.id }, { as: 'owner' });
eq(g2.radar.runs, 2, 'second run by cron');
ok(g2.radar.next_run_at > new Date().toISOString(), 'next run moved to the future');
await api.op('zzstub.cron-radars', {}, { as: 'owner' });
const g3 = await api.op('radars.get', { radar: radar.id }, { as: 'owner' });
eq(g3.radar.runs, 2, 'not due again');
await api.op('radars.save', { radar: radar.id, status: 'paused' }, { as: 'owner' });
const g4 = await api.op('radars.get', { radar: radar.id }, { as: 'owner' });
ok(g4.radar.next_run_at === '' && g4.radar.status === 'paused', 'a paused radar has no next run');

section('search and timeline');
const s1 = await api.op('search.query', { q: 'Fintech' }, { as: who.partner });
const hits = s1.results || s1.items || [];
ok(hits.some((h) => h.kind === 'thesis' && h.href === '#/markets/' + thesis.id), 'search finds the thesis');
const tl = await api.op('companies.timeline', { company: 'ledgerly.io' }, { as: 'owner' });
ok((tl.items || []).some((i) => i.module === 'markets' && /Sourced by the radar Fintech infra/.test(i.title)), 'company timeline shows where markets found it');

const res = summary('t02_radar_flow');
process.exit(res.failed > 0 ? 1 : 0);
