// Seed a realistic committee for the screenshot pass (scratch only): a closed meeting with a decision and
// conditions, the next meeting with a revealed item, a cooling item and a fresh follow-on, memos with your AI
// agent's drafts and citations, a pass in the anti-portfolio with a later outcome. Writes seed.json beside it.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newApi, fresh, team, deal, upload, waitText, pdf, O, A, PEOPLE, as } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
fresh();
const api = newApi();
await team(api);
const P1 = as('p1');
const pinAs = (k) => ({ as: k === 'owner' ? 'owner' : PEOPLE[k], pin: true });

async function memoFor(d, opts = {}) {
  const m = (await api.op('memos.open', { deal: d.number }, P1)).memo;
  const up = await upload(api, { deal: d.number, folder: 'Pitch' }, [{ name: `${d.title} deck.pdf`, bytes: pdf(opts.lines ?? [d.title, 'ARR USD 1.2M growing 15 percent a month', 'Team of 12 led by two robotics PhDs', 'Gross margin 68 percent']) }], 'owner');
  const f = up.body.files[0];
  await waitText(api, f.id, O);
  const a1 = (await api.op('anchors.create', { file: f.id, quote: (opts.lines ?? [])[1] ?? 'ARR USD 1.2M growing 15 percent a month' }, A)).anchor;
  const a2 = (await api.op('anchors.create', { file: f.id, quote: (opts.lines ?? [])[2] ?? 'Team of 12 led by two robotics PhDs' }, A)).anchor;
  await api.op('memos.block-save', { memo: m.id, section: 'summary', text: opts.summary ?? `${d.title} sells warehouse picking robots to mid-size 3PLs on a per-robot subscription. Raising a seed round to expand from 4 to 12 sites.` }, P1);
  await api.op('memos.block-save', { memo: m.id, section: 'thesis', text: opts.thesis ?? 'Labour shortages make picking automation a must-have for 3PLs; a subscription model removes the capex barrier that slowed earlier robotics companies.' }, P1);
  await api.op('memos.block-save', { memo: m.id, section: 'recommendation', text: 'Invest USD 1M in the seed at the proposed terms.' }, P1);
  const ds = await api.op('memos.draft-sections', { memo: m.id, sections: JSON.stringify(['traction', 'team', 'market']) }, P1);
  // Fix 8: the fire named the memo and its sections; your AI agent drafts them.
  void ds;
  await api.op('memos.draft-block', { memo: m.id, section: 'traction', text: 'ARR is USD 1.2M, growing 15% a month over the last two quarters [1]. Gross margin is 68% [?].', citations: JSON.stringify([{ kind: 'anchor', anchor: a1.id }]) }, A);
  await api.op('memos.draft-block', { memo: m.id, section: 'team', text: 'A team of 12 led by two robotics PhDs [1]; the CTO shipped picking systems at a large retailer before.', citations: JSON.stringify([{ kind: 'anchor', anchor: a2.id }]) }, A);
  await api.op('memos.draft-block', { memo: m.id, section: 'market', text: 'Warehouse automation spend is forecast at USD 41B by 2027 [1], with mid-size 3PLs the least served segment.', citations: JSON.stringify([{ kind: 'url', url: 'https://example.com/warehouse-automation-2027', source: 'Example Research', title: 'Warehouse automation outlook' }]) }, A);
  if (opts.keep !== false) {
    await api.op('memos.keep', { memo: m.id, blocks: 'all' }, P1);
    await api.op('memos.block-save', { memo: m.id, section: 'scenarios', scenarios: JSON.stringify([{ label: 'Bear', probability: '50', multiple: '0' }, { label: 'Base', probability: '35', multiple: '3' }, { label: 'Bull', probability: '15', multiple: '25' }]) }, P1);
    await api.op('memos.block-save', { memo: m.id, section: 'risks', text: 'Hardware margins may compress as the fleet grows; two pilots are still unpaid.' }, P1);
  }
  if (opts.submit !== false && opts.keep !== false) await api.op('memos.submit', { memo: m.id }, P1);
  return m;
}

// 1) Gamma: decided invest in IC-001 (closed, last week), with conditions.
const gamma = await deal(api, 'gamma.io', 'ic', { round_type: 'series_a', raise: '12000000', post_money: '60000000', check: '4000000' });
const ic1 = (await api.op('meetings.list', {}, O)).next;
await api.op('meetings.save', { meeting: ic1.id, facilitator: PEOPLE.p1 }, O);
await memoFor(gamma, { lines: ['Gamma', 'ARR USD 6M growing 8 percent a month', 'Team of 40 across two offices'], summary: 'Gamma runs compliance automation for mid-market banks.' });
let g1 = (await api.op('meetings.get', { meeting: ic1.id }, P1)).meeting.items[0];
await api.op('meetings.item-save', { item: g1.id, cooling_hours: 0 }, P1);
for (const [k, c, why] of [['owner', '5', 'Clear market leader in its niche'], ['p1', '4', 'Strong retention'], ['p2', '4', 'Good team'], ['vp', '2', 'Sales cycle risk']]) await api.op('votes.cast', { item: g1.id, choice: c, rationale: why }, pinAs(k));
await api.op('votes.reveal', { item: g1.id }, pinAs('p1'));
const today = (await api.op('auth.me', {}, O)).today;
await api.op('decisions.record', { item: g1.id, outcome: 'invest', rule: 'majority', conditions: JSON.stringify([{ text: 'Reference call with the former CTO', owner: PEOPLE.p1, due_day: today }, { text: 'Pro rata rights in the term sheet', owner: PEOPLE.p2 }, { text: 'Board observer seat confirmed', owner: PEOPLE.p1 }]) }, pinAs('p1'));
const past = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
await api.op('meetings.save', { meeting: ic1.id, day: past }, P1);
await api.op('meetings.close', { meeting: ic1.id }, P1);
const dg = await api.op('decisions.get', { deal: gamma.number }, O);
await api.op('conditions.complete', { condition: dg.decision.conditions[1].id, proof: 'https://example.com/term-sheet' }, as('p2'));

// 2) The next meeting: Acme (revealed), Lumen (cooling, bear case), Northwind (follow-on, no votes yet).
const acme = await deal(api, 'acme.com', 'ic', { name: 'Acme Robotics' });
const ic2 = (await api.op('meetings.list', {}, O)).next;
await api.op('meetings.save', { meeting: ic2.id, facilitator: PEOPLE.p1 }, O);
await memoFor(acme);
const lumen = await deal(api, 'lumen.health', 'ic', { name: 'Lumen Health', round_type: 'pre_seed', raise: '1500000', post_money: '9000000', check: '500000' });
await memoFor(lumen, { lines: ['Lumen Health', 'ARR USD 400K growing 10 percent a month', 'Team of 6 with two clinicians'], summary: 'Lumen schedules clinical staff for small hospitals.' });
const north = await deal(api, 'northwind.io', null, { name: 'Northwind Analytics', round_type: 'series_a', raise: '15000000', post_money: '75000000', check: '2500000' });
await api.op('companies.update', { company: 'northwind.io', tags: JSON.stringify(['held']) }, O);
await api.op('deals.move', { deal: north.number, stage: 'ic' }, O);
await memoFor(north, { lines: ['Northwind Analytics', 'ARR USD 9M growing 6 percent a month', 'Team of 55'], summary: 'Northwind, a portfolio company, raises its Series A; we hold 8%.' });

let items = (await api.op('meetings.get', { meeting: ic2.id }, P1)).meeting.items;
const ai = items.find((x) => x.deal && x.deal.number === acme.number);
const li = items.find((x) => x.deal && x.deal.number === lumen.number);
await api.op('meetings.item-save', { item: ai.id, cooling_hours: 0, skeptic: PEOPLE.p2 }, P1);
for (const [k, c, why, veto] of [['owner', '4', 'Strong team, fair price', false], ['p1', '5', 'Best robotics team we met this year', false], ['p2', '2', 'Hardware margins worry me', false], ['vp', '4', 'Customers love it', false]]) await api.op('votes.cast', { item: ai.id, choice: c, rationale: why, veto }, pinAs(k));
await api.op('votes.reveal', { item: ai.id }, pinAs('p1'));
for (const [k, c] of [['owner', '4'], ['p2', '2']]) await api.op('votes.cast', { item: li.id, choice: c }, pinAs(k));
await api.op('bearcase.request', { item: li.id }, P1);
await api.op('bearcase.save', { item: li.id, points: JSON.stringify([{ kind: 'risk', text: 'Hospital sales cycles run 12 to 18 months [1].', citations: [{ kind: 'url', url: 'https://example.com/hospital-sales', source: 'Example Health' }] }, { kind: 'contrary', text: 'Two of five pilots ended without converting to paid contracts.' }, { kind: 'risk', text: 'One customer is 40% of ARR.' }]) }, A);
await api.op('meetings.start', { meeting: ic2.id, item: ai.id }, P1);

// 3) Beta: passed (valuation) outside a meeting, with a later outcome from your AI agent.
const beta = await deal(api, 'beta.ai', 'partner_meeting', { name: 'Beta AI', round_type: 'seed', raise: '4000000', post_money: '28000000', check: '1000000' });
const bd = (await api.op('decisions.record', { deal: beta.number, outcome: 'pass', rule: 'champion', reason: 'valuation', note: 'Price too high for the stage' }, pinAs('p1'))).decision;
await api.op('decisions.review-note', { decision: bd.id, event: 'raised', text: 'Raised a USD 20M Series A led by Example Capital', source_url: 'https://example.com/beta-series-a', source_name: 'Example News', day: '2026-10-01' }, A);
const kappa = await deal(api, 'kappa.so', 'first_meeting', { name: 'Kappa', round_type: 'seed', raise: '2000000', post_money: '12000000', check: '750000' });
await api.op('decisions.record', { deal: kappa.number, outcome: 'pass', rule: 'champion', reason: 'market' }, pinAs('p2'));

// 4) Delta: a draft memo with your AI agent's sections waiting (the Focus card).
const delta = await deal(api, 'delta.dev', 'diligence', { name: 'Delta Dev', round_type: 'seed', raise: '3500000', post_money: '20000000', check: '1000000' });
await memoFor(delta, { keep: false, submit: false, lines: ['Delta Dev', 'ARR USD 800K growing 12 percent a month', 'Team of 9 ex-GitHub engineers'], summary: 'Delta builds code review tooling for regulated teams.' });

writeFileSync(join(HERE, 'seed.json'), JSON.stringify({ ic1: ic1.id, ic2: ic2.id, acme: acme.number, lumen: lumen.number, north: north.number, gamma: gamma.number, beta: beta.number, delta: delta.number, acmeItem: ai.id, lumenItem: li.id, past }, null, 1));
console.log('seeded', { ic1: ic1.number, ic2: ic2.number });
