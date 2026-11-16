// Seeds the markets scratch app for screenshots: a firm, three theses with radars, live pulls (Form D,
// Show HN, GitHub when online), your AI agent screening some and adding its own candidates with sources,
// a market map with deals behind its tiles and two proposals waiting, a comparison grid.
// Then spreads candidate days over 12 weeks (scratch database only) so the sparklines draw real weeks.
// Usage: node ui_seed.mjs [--empty]   (--empty: setup only, for the empty-state screenshots)
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { APP, fresh, newApi, firm } from './lib.mjs';

fresh();
const api = newApi();
await firm(api);
if (process.argv.includes('--empty')) {
  console.log('empty firm ready');
  process.exit(0);
}
const P = 'partner@venture.test';
await api.op('settings.update', { modules: '{"markets":{"edgar_limit":25,"hn_limit":20,"github_limit":10}}' }, { as: 'owner' });

const theses = [
  { name: 'Fintech infra', criteria: [{ key: 'sector', op: 'in', values: ['fintech', 'infrastructure'] }, { key: 'stage', op: 'in', values: ['seed', 'series_a'] }, { key: 'hq_country', op: 'in', values: ['US', 'GB'] }], sources: ['edgar_form_d', 'hacker_news', 'companies_house'], query: 'payments ledger api', schedule: 'weekly mon 08:00' },
  { name: 'Developer tools', criteria: [{ key: 'sector', op: 'in', values: ['devtools', 'ai'] }, { key: 'stage', op: 'in', values: ['pre_seed', 'seed'] }], sources: ['github', 'hacker_news'], query: 'developer tools', schedule: 'daily 08:00' },
  { name: 'Climate software', criteria: [{ key: 'sector', op: 'in', values: ['climate', 'energy'] }], sources: ['edgar_form_d', 'jp_corporate'], query: 'carbon accounting', schedule: 'weekly wed 09:00' },
];
const ids = {};
for (const t of theses) {
  const r = await api.op('theses.save', { name: t.name, criteria: JSON.stringify(t.criteria) }, { as: P });
  const rad = await api.op('radars.save', { thesis: r.thesis.id, sources: JSON.stringify(t.sources), query: t.query, schedule: t.schedule }, { as: P });
  ids[t.name] = { thesis: r.thesis.id, radar: rad.radar.id };
}

// Live pulls (skipped quietly when offline: counts carry the error).
for (const name of Object.keys(ids)) {
  const run = await api.call('radars.run', { radar: ids[name].radar }, { as: P });
  console.log(name, run.status, JSON.stringify(run.body.counts ?? run.body.message));
}

// Your AI agent screens: keeps a few of each radar's new items, drops the rest.
for (const name of Object.keys(ids)) {
  const l = await api.op('signals.list', { radar: ids[name].radar, status: 'new', limit: 200 }, { as: 'agent' });
  const items = l.signals.map((s, i) => (i % 3 === 0 ? { id: s.id, keep: true, summary: s.source === 'edgar_form_d' ? 'New Form D raise in a thesis industry' : s.source === 'github' ? 'Fast-growing repo with a company behind it' : 'Launch with early traction on Show HN', name: s.name !== '' ? s.name : s.domain !== '' ? s.domain.split('.')[0].replace(/^./, (c) => c.toUpperCase()) : undefined } : { id: s.id, keep: false, reason: 'Outside the thesis' }));
  for (let i = 0; i < items.length; i += 100) if (items.slice(i, i + 100).length > 0) await api.op('signals.screen', { items: JSON.stringify(items.slice(i, i + 100)) }, { as: 'agent' });
}

// Your AI agent's own research.
const own = {
  'Fintech infra': [
    ['Ledgerline', 'ledgerline.io', 'Double-entry ledger API for marketplaces; seed round filed', 'funding', 'Ex-Stripe and Adyen engineers', 'Hiring 6 engineers'],
    ['Payrail', 'payrail.co', 'Instant payouts infra for gig platforms in the UK', 'incorporation', 'Second-time founders (prior exit to Wise)', ''],
    ['Clearbook', 'clearbook.dev', 'Reconciliation engine for B2B payments teams', 'product', 'Founder led payments ops at Monzo', 'Grew headcount from 4 to 11 this year'],
    ['Tallyfold', 'tallyfold.com', 'Treasury API for vertical SaaS', 'hiring', '', 'Six open engineering roles'],
  ],
  'Developer tools': [
    ['Shipyard Labs', 'shipyardlabs.dev', 'Preview environments for every pull request', 'repo', 'Former GitLab infra leads', ''],
    ['Tracecraft', 'tracecraft.io', 'Open-source tracing for LLM apps, 9k stars in 2 months', 'repo', '', 'First two hires in Berlin'],
    ['Cachet', 'cachet.build', 'Remote build cache for monorepos', 'launch', 'Ex-Vercel', ''],
  ],
  'Climate software': [
    ['Gridloom', 'gridloom.energy', 'Software for battery dispatch on community grids', 'funding', 'Founders from Tesla Energy', ''],
    ['Carbonplan Works', 'carbonworks.io', 'Scope 3 accounting for Japanese manufacturers', 'incorporation', '', 'Partnered with two trading houses'],
  ],
};
for (const [name, list] of Object.entries(own)) {
  for (const [n, d, line, kind, founders, hiring] of list) {
    const ctx = {};
    if (founders !== '') ctx.founders = founders;
    if (hiring !== '') ctx.hiring = hiring;
    await api.op('signals.add', { radar: ids[name].radar, name: n, domain: d, summary: line, source_url: `https://${d}/about`, kind, context: JSON.stringify(ctx), facts: JSON.stringify({ sector: name === 'Fintech infra' ? 'fintech' : name === 'Developer tools' ? 'devtools' : 'climate' }) }, { as: 'agent' });
  }
}

// A market map with deals behind some tiles.
const comp = [
  ['Stripe', 'stripe.com', 'acquiring', 'competitor'],
  ['Adyen', 'adyen.com', 'acquiring', 'competitor'],
  ['Northwind Pay', 'northwindpay.com', 'acquiring', 'tracked'],
  ['Modern Treasury', 'moderntreasury.com', 'ledgers', 'tracked'],
  ['Ledgerline', 'ledgerline.io', 'ledgers', 'tracked'],
  ['Fragment', 'fragment.dev', 'ledgers', 'tracked'],
  ['Tipalti', 'tipalti.com', 'payouts', 'tracked'],
  ['Payrail', 'payrail.co', 'payouts', 'tracked'],
  ['Routable', 'routable.com', 'payouts', 'tracked'],
  ['Clearbook', 'clearbook.dev', 'reconciliation', 'tracked'],
  ['Numeral', 'numeral.io', 'reconciliation', 'tracked'],
];
const map = await api.op('maps.save', { name: 'Payments stack', thesis: ids['Fintech infra'].thesis, segments: '["Acquiring","Ledgers","Payouts","Reconciliation"]' }, { as: P });
for (const [n, d, seg, role] of comp) {
  await api.op('companies.upsert', { name: n, domain: d }, { as: 'owner' });
  await api.op('maps.place', { map: map.map.id, company: d, segment: seg, role, source_url: `https://${d}` }, { as: P });
}
const inv = await api.op('deals.create', { company: 'northwindpay.com' }, { as: P });
await api.op('deals.status', { deal: inv.deal.id, status: 'invested' }, { as: P });
await api.op('deals.create', { company: 'ledgerline.io' }, { as: P });
await api.op('deals.create', { company: 'clearbook.dev' }, { as: P });
const pas = await api.op('deals.create', { company: 'routable.com' }, { as: P });
await api.op('deals.status', { deal: pas.deal.id, status: 'passed', reason: 'Market' }, { as: P });
await api.op('maps.propose', { map: map.map.id, company: 'Fernhill Payments', name: 'Fernhill Payments', website: 'fernhillpay.com', segment: 'payouts', role: 'tracked', source_url: 'https://fernhillpay.com', why: 'New UK payouts API, seed raise announced this week' }, { as: 'agent' });
await api.op('maps.propose', { map: map.map.id, company: 'numeral.io', segment: 'ledgers', source_url: 'https://numeral.io/product', why: 'Moved from reconciliation into ledgers with its new product' }, { as: 'agent' });
await api.op('maps.save', { name: 'Developer tools landscape', thesis: ids['Developer tools'].thesis, segments: '["Build","Test","Observe"]' }, { as: P });
await api.op('compare.save', { name: 'Ledgers compared', companies: JSON.stringify(['moderntreasury.com', 'ledgerline.io', 'fragment.dev'].map((x) => x)), origin: 'markets', market_ref: map.map.id }, { as: P });

// Spread the candidate days over 12 weeks (scratch database only) so the sparklines draw weeks.
const db = join(APP, 'pb', 'pb_data', 'data.db').replace(/\\/g, '/');
execFileSync('python', ['-c', `
import sqlite3, random, datetime
random.seed(7)
c = sqlite3.connect(r'${db}')
rows = c.execute("SELECT id FROM signals WHERE status IN ('candidate','added','dismissed')").fetchall()
now = datetime.datetime.utcnow()
for i, (sid,) in enumerate(rows):
    if i % 4 == 0: continue
    d = now - datetime.timedelta(days=random.randint(7, 83), hours=random.randint(0, 20))
    c.execute("UPDATE signals SET created = ? WHERE id = ?", (d.strftime('%Y-%m-%d %H:%M:%S.000Z'), sid))
c.commit()
print('backdated', len(rows))
`], { stdio: 'inherit' });

const s = await api.op('theses.summary', {}, { as: P });
for (const t of s.theses) console.log(t.name, 'net-new', t.net_new, 'weekly', t.weekly.join(','));
const n = await api.op('next.list', { kinds: 'candidate' }, { as: P });
console.log('next', n.items.map((i) => i.key + ' ' + i.title).join(' | '));
