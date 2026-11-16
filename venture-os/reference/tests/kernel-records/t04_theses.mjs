// Theses: FACT_KEYS from the fit engine, criteria validation, proposals, tri-state fit with exchange rates.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { newApi, fresh, setupFirm, section, ok, eq, refuses, summary, PEOPLE, APP } from './lib.mjs';

const require = createRequire(import.meta.url);
const hooks = join(APP, 'pb', 'pb_hooks');

section('FACT_KEYS is the fit engine\'s list (Node)');
const T = require(join(hooks, 'lib_theses.js'));
const E = require(join(hooks, 'lib_eng_fit.js'));
ok(T.FACT_KEYS === E.FACT_KEYS, 'lib_theses.FACT_KEYS is lib_eng_fit.FACT_KEYS (the same array)');
eq(T.FACT_KEYS, ['sector', 'subsector', 'stage', 'round_type', 'raise_minor', 'pre_money_minor', 'post_money_minor', 'currency', 'hq_country', 'founded_year', 'team_size', 'founders', 'technical_founder', 'prior_exit', 'revenue_minor', 'arr_minor', 'growth_mom_ppm', 'gross_margin_ppm', 'burn_minor', 'runway_months', 'customers', 'business_model', 'product_live', 'lead_investor', 'use_of_funds'], 'the 25 keys of SPEC 7.2 in order');

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };

section('theses.keys');
const keys = (await api.op('theses.keys', {}, O)).keys;
eq(keys.length, 25, '25 keys');
const rt = keys.filter((k) => k.key === 'round_type')[0];
ok(rt.type === 'text' && rt.values.indexOf('seed') >= 0 && rt.ops.indexOf('in') >= 0, 'round_type: text with its values and operators');

section('save and validate');
const crit = [
  { key: 'sector', op: 'in', values: ['fintech', 'insurtech'], required: true },
  { key: 'round_type', op: 'in', values: ['pre_seed', 'seed'], required: true },
  { key: 'raise_minor', op: 'between', min: 100000000, max: 500000000, currency: 'usd', required: true },
  { key: 'hq_country', op: 'in', values: ['gb', 'DE'] },
  { key: 'technical_founder', op: 'bool', value: true },
];
const t = (await api.op('theses.save', { name: 'European fintech seed', statement: 'Seed rounds of European fintech.', criteria: crit }, O)).thesis;
ok(t.id && t.status === 'active' && t.criteria.length === 5, 'a person saves a thesis');
eq(t.criteria[2].currency, 'USD', 'currency normalized');
eq(t.criteria[3].values, ['GB', 'DE'], 'country codes normalized');
eq(t.criteria[0].label, 'Sector', 'criteria carry labels');
await refuses(api, 'theses.save', { name: 'X', criteria: [{ key: 'sektor', op: 'in', values: ['a'] }] }, O, 400, 'invalid_criterion', 'an unknown key is refused (did you mean)');
const near = await api.call('theses.save', { name: 'X', criteria: [{ key: 'sektor', op: 'in', values: ['a'] }] }, O);
ok(near.body.message.indexOf('did you mean sector') >= 0, 'the closest key is named');
await refuses(api, 'theses.save', { name: 'X', criteria: [{ key: 'sector', op: 'gte', value: 3 }] }, O, 400, 'invalid_criterion', 'an operator the key does not take is refused');
await refuses(api, 'theses.save', { name: 'X', criteria: [{ key: 'raise_minor', op: 'gte', value: 100 }] }, O, 400, undefined, 'money without a currency is refused');
await refuses(api, 'theses.save', { name: 'X', criteria: [{ key: 'round_type', op: 'in', values: ['series_z'] }] }, O, 400, 'invalid_criterion', 'a round type outside its list is refused');
await refuses(api, 'theses.save', { name: 'X', criteria: [{ key: 'sector', op: 'in', values: ['a'], weight: 3 }] }, O, 400, 'unknown_key', 'an unknown field of a criterion is refused');
await refuses(api, 'theses.save', { name: 'X', criteria: '{not json' }, O, 400, 'invalid_param', 'criteria that are not JSON are refused');
await refuses(api, 'theses.save', { name: 'european FINTECH seed' }, O, 409, 'duplicate', 'names are unique (any case)');

section('your AI agent proposes');
const ap = await api.call('theses.save', { name: 'Climate', criteria: [{ key: 'sector', op: 'in', values: ['climate'] }], why: 'from the fund memo' }, A);
ok(ap.status === 200 && ap.body.proposed === true, 'a thesis from your AI agent is a proposal', ap.body);
const bad = await api.call('theses.save', { name: 'Bad', criteria: [{ key: 'nope', op: 'in', values: ['x'] }], why: 'x' }, A);
ok(bad.status === 400, 'an invalid proposal is refused at once (dry run)', bad.body);
eq((await api.op('theses.list', {}, O)).total, 1, 'nothing added yet');
await api.op('proposals.accept', { proposal: ap.body.proposal }, O);
eq((await api.op('theses.list', {}, O)).total, 2, 'accepted by a person');

section('fit: met, unmet, unknown; no score');
const f1 = await api.op('theses.fit', { thesis: t.id, facts: { sector: 'Fintech', round_type: 'seed', raise_minor: 300000000, currency: 'USD', hq_country: 'GB', technical_founder: true } }, O);
ok(f1.counts.met === 5 && f1.counts.unmet === 0 && f1.required.state === 'met', 'all met', f1);
ok(f1.score === undefined, 'no total score');
const f2 = await api.op('theses.fit', { thesis: t.id, facts: { sector: 'fintech', round_type: 'series_a' } }, O);
const by = {};
for (const c of f2.checks) by[c.key] = c.status;
ok(by.sector === 'met' && by.round_type === 'unmet' && by.raise_minor === 'unknown' && by.technical_founder === 'unknown', 'missing facts are unknown, never unmet', by);
eq(f2.required.state, 'unmet', 'a required unmet criterion makes the required state unmet');
await api.op('fx.set', { base: 'EUR', quote: 'USD', rate: '1.08' }, O);
const f3 = await api.op('theses.fit', { thesis: t.id, facts: { sector: 'fintech', round_type: 'seed', raise_minor: 300000000, currency: 'EUR' } }, O);
const r3 = f3.checks.filter((c) => c.key === 'raise_minor')[0];
ok(r3.status === 'met' && r3.value === 324000000, 'EUR 3M converts to USD 3.24M with the firm\'s rate', r3);
const f4 = await api.op('theses.fit', { thesis: t.id, facts: { raise_minor: 300000000, currency: 'ZZZ' } }, O);
eq(f4.checks.filter((c) => c.key === 'raise_minor')[0].reason, 'no_rate', 'no exchange rate: unknown (no_rate)');
const f5 = await api.op('theses.fit', { thesis: t.id, facts: { sector: { value: 'fintech', grade: 'unknown' } } }, O);
eq(f5.checks[0].status, 'unknown', 'a fact graded unknown stays unknown');
await refuses(api, 'theses.fit', { thesis: t.id, facts: { sektor: 'x' } }, O, 400, 'unknown_key', 'an unknown fact key is named');

section('rights');
await refuses(api, 'theses.save', { thesis: t.id, status: 'archived' }, { as: PEOPLE.analyst }, 403, 'not_permitted', 'an analyst (markets view) cannot change a thesis');
ok((await api.call('theses.list', {}, { as: PEOPLE.analyst })).status === 200, 'an analyst reads theses');
const arch = (await api.op('theses.save', { thesis: t.id, status: 'archived' }, O)).thesis;
eq(arch.status, 'archived', 'archived');
eq((await api.op('theses.list', {}, O)).total, 1, 'archived theses leave the active list');

summary('t04 theses');
