// Investing: SAFE previews (engine vectors), Mark invested as a partner, closing documents read by
// your AI agent (proposals accepted by a person), a priced round converting SAFEs, pro rata,
// holding changes as proposals, restricted deals, the holdings CSV import.
import { newApi, fresh, setupFirm, section, ok, eq, refuses, summary, PEOPLE, upload, fixture, dealFor, stubFile, STUBBED, bridge } from './lib.mjs';

await fresh();
await bridge.mode('search_gmail', 'offline');
const api = newApi();
const firm = await setupFirm(api);

section('safe.preview: engine vectors (YC post-money SAFE)');
const p1 = await api.op('safe.preview', { instrument: 'safe_cap', amount: '500000', cap: '6700000' }, { as: PEOPLE.partner });
eq(p1.ownership_ppm, 74627, '$500k on a $6.7M cap');
const p2 = await api.op('safe.preview', { instrument: 'safe_cap', amount: '1000000', cap: '6700000' }, { as: PEOPLE.partner });
eq(p2.ownership_ppm, 149254, '$1M on a $6.7M cap');
const p3 = await api.op('safe.preview', { instrument: 'safe_cap', amount: '500000', cap: '6700000', pre_shares: 9000000 }, { as: PEOPLE.partner });
eq(p3.implied_price_e8, 68888889, 'implied price at signing with 9,000,000 shares: 0.68888889');
ok(p1.scenario && p1.scenario.notional === true && p1.converted && p1.converted.ownership_ppm > 0, 'a conversion scenario with a notional share count when shares are unknown', p1.scenario);
const p4 = await api.op('safe.preview', { instrument: 'priced', amount: '2000000', pre_money: '18000000', raise: '5000000', pre_shares: 9000000 }, { as: PEOPLE.partner });
eq(p4.price_e8, 200000000, 'priced: price derived from pre-money / pre-money shares (2.00)');
eq(p4.ownership_ppm, 86957, 'priced: 2M of a 23M post-money');
const p5 = await api.op('safe.preview', { instrument: 'safe_discount', amount: '250000', discount: '20' }, { as: PEOPLE.partner });
ok(p5.ownership_ppm === null && p5.reason === 'set_at_conversion', 'a discount SAFE owns nothing until it converts');
await refuses(api, 'safe.preview', { instrument: 'safe_cap', amount: '500000' }, { as: PEOPLE.partner }, 400, 'missing_param', 'a capped SAFE without a cap');

section('Mark invested (a partner) with closing documents');
const d = await dealFor(api, 'acmerobotics.ai', 'Acme Robotics', [{ email: 'maya@acmerobotics.ai', name: 'Maya Chen' }], { round_type: 'seed', raise: '3000000', post_money: '15000000', check: '500000', instrument: 'safe_cap' });
await refuses(api, 'holdings.create-from-deal', { deal: d.number }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot mark a deal invested');
await refuses(api, 'holdings.create-from-deal', { deal: d.number }, { as: PEOPLE.analyst }, 403, undefined, 'an analyst cannot');
const inv = await upload(api, 'holdings.create-from-deal', { deal: d.number, cap: '6700000', pro_rata: 'true', board_role: 'observer' }, [{ name: 'Acme SAFE.pdf', bytes: fixture('decks/acme_robotics_seed.pdf') }], PEOPLE.partner);
ok(inv.status === 200, 'invested -> 200', inv.body);
const h = inv.body.holding;
eq(h.ownership_ppm, 74627, 'ownership from the engine');
eq(h.cost_minor, 50000000, 'cost USD 500,000.00');
eq(h.value_basis, 'cost', 'no mark yet: held at cost');
eq(h.moic_e8, 100000000, 'MOIC 1.00x');
ok(h.pro_rata === true && h.board_role === 'observer', 'pro rata and board role kept');
ok(inv.body.files.length === 1 && inv.body.request !== '', 'the closing document is stored and your AI agent asked (closing_extract with the holding)', inv.body);
const deal = await api.op('deals.get', { deal: d.number }, { as: PEOPLE.partner });
eq(deal.deal ? deal.deal.status : deal.status, 'invested', 'the deal is invested');
await refuses(api, 'holdings.create-from-deal', { deal: d.number }, { as: PEOPLE.partner }, 409, 'not_open', 'marking it invested twice');

section('your AI agent reads the closing documents: proposals a person accepts');
const hga = await api.op('holdings.get', { holding: h.id }, { as: 'agent' });
const sec0 = (hga.holding.securities || [])[0] || {};
const job = { payload: { security: sec0.id, round: sec0.round && sec0.round.id ? sec0.round.id : sec0.round } };
ok(job.payload.security && job.payload.round, 'your AI agent opens the holding the fire named: its security and round', hga);
const sec = await api.call('securities.save', { security: job.payload.security, class: 'Post-money SAFE', anchors: '[]', why: 'The SAFE names the class', evidence: 'Post-money SAFE', confidence: 0.9 }, { as: 'agent' });
ok(sec.status === 200 && sec.body.proposal, 'securities.save from your AI agent is a proposal', sec.body);
const rnd = await api.call('rounds.save', { round: job.payload.round, cap_table: JSON.stringify([{ holder: 'Founders', class: 'Common', shares: 8000000 }, { holder: 'Pool', class: 'Options', shares: 1000000 }]), why: 'Summary cap table', confidence: 0.8 }, { as: 'agent' });
ok(rnd.status === 200 && rnd.body.proposal, 'rounds.save from your AI agent is a proposal', rnd.body);
const next = await api.op('next.list', {}, { as: PEOPLE.partner });
ok(next.items.some((i) => i.kind === 'proposal'), 'the proposals are in the partner\'s Next');
for (const pid of [sec.body.proposal, rnd.body.proposal]) {
  const a = await api.call('proposals.accept', { proposal: pid }, { as: PEOPLE.partner });
  ok(a.status === 200, 'proposal accepted', a.body);
}
const own = await api.op('ownership.get', { holding: 'acmerobotics.ai' }, { as: PEOPLE.analyst });
ok(own.rounds.length === 1 && own.rounds[0].cap_table.length === 2 && own.rounds[0].cap_table[0].ppm === 888889, 'the summary cap table with ppm per holder', own.rounds);
const hg = await api.op('holdings.get', { holding: 'acmerobotics.ai' }, { as: PEOPLE.analyst });
eq(hg.holding.securities[0].class, 'Post-money SAFE', 'the accepted security change');

section('a priced round converts the fund\'s SAFE (engine vector)');
const d2 = await dealFor(api, 'betalabs.io', 'Beta Labs', [{ email: 'bo@betalabs.io', name: 'Bo Lee' }], { round_type: 'seed', check: '1000000', instrument: 'safe_cap' });
const inv2 = await api.op('holdings.create-from-deal', { deal: d2.number, cap: '10000000', day: '2025-06-01' }, { as: PEOPLE.partner });
eq(inv2.ownership_ppm, 100000, '$1M at a $10M cap owns 10%');
const r2 = await api.op('rounds.save', { company: 'betalabs.io', type: 'series_a', day: '2026-09-01', pre_money: '18000000', pre_shares: 9000000, raise: '5000000' }, { as: PEOPLE.partner });
eq(r2.round.price_e8, 200000000, 'price derived: 18M / 9,000,000 = 2.00');
ok(r2.conversion && r2.conversion.capitalization_shares === 10000000 && r2.conversion.post_shares === 12500000, 'capitalization 10,000,000, post 12,500,000', r2.conversion);
const sb = r2.conversion.safes[0];
ok(sb.shares === 1000000 && sb.conversion_price_e8 === 100000000 && sb.basis === 'cap', '1,000,000 shares at $1.00 (cap)', sb);
const hb = await api.op('holdings.get', { holding: 'betalabs.io' }, { as: PEOPLE.partner });
eq(hb.holding.ownership_ppm, 80000, 'ownership after the round: 8.0%');
ok(hb.holding.securities.some((s) => s.status === 'converted') && hb.holding.securities.some((s) => s.kind === 'priced' && s.shares === 1000000), 'the SAFE is converted into priced shares');
ok(hb.holding.prorata.amount_minor === null || hb.holding.prorata.round, 'pro rata figure present');

section('pro rata (engine)');
const pr = await api.op('prorata.preview', { holding: 'betalabs.io', raise: '10000000', post_money: '50000000' }, { as: PEOPLE.analyst });
eq(pr.amount_minor, 80000000, '8% of a $10M round: $800,000');
eq(pr.ownership_if_skip_ppm, 64000, 'skipping a round that sells 20%: 6.4%');
const pr2 = await api.op('prorata.preview', { holding: 'betalabs.io', new_shares: 2500000, price: '4' }, { as: PEOPLE.analyst });
ok(pr2.shares_to_buy === 200000 && pr2.cost_minor === 80000000, 'shares to keep 8% through 2,500,000 new shares at $4: 200,000 for $800,000', pr2);

section('holding changes: a proposal from your AI agent');
const hu = await api.call('holdings.update', { holding: 'betalabs.io', report_currency: 'EUR', fy_end_month: 3, why: 'The update reports in EUR with a March year end' }, { as: 'agent' });
ok(hu.status === 200 && hu.body.proposal, 'holdings.update from your AI agent is a proposal', hu.body);
await api.op('proposals.accept', { proposal: hu.body.proposal }, { as: 'owner' });
const hb2 = await api.op('holdings.get', { holding: 'betalabs.io' }, { as: 'owner' });
ok(hb2.holding.report_currency === 'EUR' && hb2.holding.fy_end_month === 3, 'accepted: EUR, March year end');
const ex = await api.op('holdings.update', { holding: 'betalabs.io', status: 'exited', proceeds: '3000000', exit_day: '2026-10-15' }, { as: PEOPLE.partner });
eq(ex.holding.value_basis, 'exited', 'an exit values the holding at 0 with proceeds');
eq(ex.holding.moic_e8, 300000000, 'MOIC 3.00x on $1M in, $3M out');

section('the Portfolio page figures');
const L1 = await api.op('holdings.list', { status: 'all' }, { as: 'owner' });
eq(L1.figures.companies, 1, 'one active company');
eq(L1.figures.invested_minor, 150000000, 'invested $1.5M');
eq(L1.figures.value_minor, 50000000, 'value $500k (Acme held at cost; Beta exited)');
eq(L1.figures.moic_e8, 233333333, 'MOIC (3.0M + 0.5M) / 1.5M = 2.33x');
eq(L1.rows.length, 2, 'two rows with status all');
eq((await api.op('holdings.list', {}, { as: 'owner' })).rows.length, 1, 'active rows by default');

if (STUBBED) {
section('a mark from funds values the holding (lib_funds.markOf)');
stubFile('vo_test_marks.json', { [h.id]: 100000000 });
const hm = await api.op('holdings.get', { holding: 'acmerobotics.ai' }, { as: 'owner' });
ok(hm.holding.value_basis === 'mark' && hm.holding.value_minor === 100000000 && hm.holding.moic_e8 === 200000000, 'marked at $1M: MOIC 2.00x', hm.holding);
eq((await api.op('holdings.list', { status: 'all' }, { as: 'owner' })).figures.value_minor, 100000000, 'the figure strip value follows the mark');
stubFile('vo_test_marks.json', {});

section('Next: the committee decided to invest, Mark invested in one click');
const d4 = await dealFor(api, 'gammaworks.com', 'Gamma Works', [{ email: 'gia@gammaworks.com', name: 'Gia Gamma' }], { round_type: 'seed', check: '400000', instrument: 'safe_cap', post_money: '8000000' });
await api.op('deals.move', { deal: d4.number, stage: 'ic' }, { as: 'owner' });
stubFile('vo_test_decisions.json', { [d4.id]: 'invest' });
const nx4 = await api.op('next.list', {}, { as: PEOPLE.partner });
const mi = nx4.items.find((i) => i.key === 'portfolio:invest:' + d4.id);
ok(mi && mi.rank === 30 && mi.actions[0].op === 'holdings.create-from-deal' && mi.figures[0].value === 'USD 400K', 'a Mark invested item with the check', mi);
ok(!(await api.op('next.list', {}, { as: PEOPLE.analyst })).items.some((i) => i.key === 'portfolio:invest:' + d4.id), 'not for an analyst');
const done4 = await api.op(mi.actions[0].op, mi.actions[0].params, { as: PEOPLE.partner });
eq(done4.ownership_ppm, 50000, 'one click: $400k on an $8M cap owns 5%');
ok(!(await api.op('next.list', {}, { as: PEOPLE.partner })).items.some((i) => i.key === 'portfolio:invest:' + d4.id), 'the item left Next');
stubFile('vo_test_decisions.json', {});

section('the committee gate: a pass or open conditions block Mark invested, an owner or partner may override');
const d5 = await dealFor(api, 'deltaops.io', 'Delta Ops', [{ email: 'dee@deltaops.io', name: 'Dee Delta' }], { round_type: 'seed', check: '300000', instrument: 'safe_cap', post_money: '6000000' });
await api.op('deals.move', { deal: d5.number, stage: 'term_sheet' }, { as: 'owner' });
stubFile('vo_test_decisions.json', { [d5.id]: 'pass' });
const ic1 = await api.op('holdings.invest-check', { deal: d5.number }, { as: PEOPLE.partner });
ok(ic1.blocked === true && ic1.code === 'decision_not_invest' && ic1.may_override === true, 'invest-check: blocked by a pass, a partner may override', ic1);
await refuses(api, 'holdings.create-from-deal', { deal: d5.number }, { as: PEOPLE.partner }, 409, 'decision_not_invest', 'Mark invested after a pass');
stubFile('vo_test_decisions.json', { [d5.id]: { outcome: 'invest', open: 2 } });
const ic2 = await api.op('holdings.invest-check', { deal: d5.number }, { as: PEOPLE.partner });
ok(ic2.blocked === true && ic2.code === 'conditions_open' && ic2.decision.conditions_open === 2, 'invest-check: two open conditions', ic2);
await refuses(api, 'holdings.create-from-deal', { deal: d5.number }, { as: PEOPLE.partner }, 409, 'conditions_open', 'Mark invested with open conditions');
ok(!(await api.op('next.list', {}, { as: PEOPLE.partner })).items.some((i) => i.key === 'portfolio:invest:' + d5.id), 'no Mark invested item while conditions are open');
const over = await api.op('holdings.create-from-deal', { deal: d5.number, override: true }, { as: PEOPLE.partner });
ok(over.overrode === 'conditions_open' && over.ownership_ppm === 50000, 'a partner overrides: invested, 5%', over);
const aud = await api.op('audit.list', { limit: 20 }, { as: 'owner' });
ok(JSON.stringify(aud).indexOf('over the committee') >= 0, 'the override is in the audit trail');
stubFile('vo_test_decisions.json', {});

} else section('marks and committee decisions: skipped (real funds and committee modules; their own tests cover them)');

section('restricted deals: the holding is hidden from people off the deal team');
const d3 = await dealFor(api, 'secretco.com', 'Secret Co', [{ email: 'sam@secretco.com', name: 'Sam Secret' }], { round_type: 'seed', check: '250000', instrument: 'safe_cap', post_money: '10000000', restricted: true });
await api.op('holdings.create-from-deal', { deal: d3.number }, { as: 'owner' });
const lo = await api.op('holdings.list', {}, { as: PEOPLE.outsider });
ok(lo.hidden === 1 && !lo.rows.some((r) => r.company.domain === 'secretco.com'), 'an outsider partner sees hidden: 1', lo);
await refuses(api, 'holdings.get', { holding: 'secretco.com' }, { as: PEOPLE.outsider }, 404, 'not_found', 'and cannot open it');
ok((await api.op('holdings.list', {}, { as: 'owner' })).rows.some((r) => r.company.domain === 'secretco.com'), 'the owner sees it');

section('holdings CSV import (a person)');
const csv = 'Company,Fund,Instrument,Invested,Date,Post-money\nzeta.ai,Fund I,priced,750000,2024-03-01,15000000\nomega.dev,Fund I,safe_cap,250000,2025-02-10,5000000\n';
const pv = await api.op('imports.preview', { target: 'holdings', csv: csv }, { as: 'owner' });
ok(pv.counts && pv.counts.created === 2, 'preview: two holdings would be created', pv);
const run = await api.op('imports.run', { target: 'holdings', csv: csv }, { as: 'owner' });
ok(run.counts && run.counts.created === 2, 'run: two created', run);
const hz = await api.op('holdings.get', { holding: 'zeta.ai' }, { as: 'owner' });
eq(hz.holding.ownership_ppm, 50000, 'zeta.ai: 750k of 15M = 5%');
const again = await api.op('imports.run', { target: 'holdings', csv: csv }, { as: 'owner' });
ok(again.counts && again.counts.skipped === 2, 'the same file again is skipped', again);

summary('t02 invest');
