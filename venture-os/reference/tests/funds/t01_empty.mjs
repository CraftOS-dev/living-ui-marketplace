// Funds module, empty database: every funds read op as owner, partner, analyst, finance and your AI agent
// (no 5xx); people-only ops refuse your AI agent before params and PIN; empty answers are honest.
//   VO_APP=<scratch app> VO_PORT=3190 VO_BRIDGE=3290 node t01_empty.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, fresh, member, newApi, ok, refuses, section, setupFirm, summary } from './lib.mjs';

const GROUPS = ['funds', 'metrics', 'lps', 'commitments', 'bank', 'raise', 'lpq', 'calls', 'distributions', 'waterfall', 'payments', 'ledger', 'statements', 'marks', 'reserves', 'scenarios', 'quarters', 'reports', 'exports'];
const MINE = (n) => GROUPS.indexOf(n.split('.')[0]) >= 0 && n !== 'exports.all';

fresh();
const api = newApi();

section('before setup');
const pre = await api.call('funds.list', {}, { as: 'agent' });
ok(pre.status < 500, 'funds.list before setup answers without a 5xx', pre);

await setupFirm(api);
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
await member(api, 'analyst@venture.test', 'analyst', 'Ann Analyst');
await member(api, 'finance@venture.test', 'finance', 'Fiona Finance');

const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const mine = manifest.operations.filter((o) => !o.system && MINE(o.name));
ok(mine.length >= 60, 'the funds module has its ops (' + mine.length + ')');
const reads = mine.filter((o) => o.executor.method === 'GET');
const sample = (k) => ({ fund: 'Fund I', lp: 'nobody', event: 'CC-999', quarter: 'nope00000000000', holding: 'nope00000000000', statement: 'nope00000000000', amount: '1000.00', deal: 'D-9999', question: 'x', mark: 'nope', block: 'nope', entity: 'Fund I' })[k] ?? 'x';

section('empty sweep of every funds read');
for (const as of ['owner', 'partner@venture.test', 'analyst@venture.test', 'finance@venture.test', 'agent']) {
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k);
    const r = await api.call(o.name, params, { as });
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, as + ': ' + reads.length + ' reads, no 5xx', bad);
}

section('empty answers');
const O = { as: 'owner' };
const g = await api.op('funds.get', {}, O);
eq(g.metrics.tvpi_e8, null, 'TVPI is unknown with nothing paid in');
eq(g.metrics.reasons.tvpi, 'no_paid_in', 'with the reason, never zero');
eq(g.overview.commitment_minor, 0, 'no commitments yet');
ok(Array.isArray(g.jcurve) && g.jcurve.length >= 1, 'the J-curve has the current quarter', g.jcurve);
eq(g.quarter, null, 'no quarter yet');
eq((await api.op('lps.list', { fund: 'Fund I' }, O)).total, 0, 'no LPs');
eq((await api.op('calls.list', {}, O)).total, 0, 'no calls');
eq((await api.op('marks.list', {}, O)).holdings.length, 0, 'no holdings to mark');
const rv = await api.op('reserves.get', {}, O);
eq(rv.totals.needed_minor, 0, 'no reserves needed');
const nx = await api.op('next.list', {}, O);
eq(nx.errors.length, 0, 'Next has no module errors', nx.errors);

section('the analyst sees fund figures but no LP data');
eq((await api.call('funds.get', {}, { as: 'analyst@venture.test' })).status, 200, 'funds.get for the analyst');
await refuses(api, 'lps.list', {}, { as: 'analyst@venture.test' }, 403, 'not_permitted', 'LPs are closed to the analyst');

section('people-only ops refuse your AI agent first');
const deny = mine.filter((o) => o.description.indexOf('[People only.]') >= 0);
ok(deny.length >= 20, deny.length + ' people-only funds ops');
for (const o of deny) {
  const r = await api.call(o.name, {}, { as: 'agent' });
  ok(r.status === 403 && r.body && r.body.code === 'agent_not_permitted', o.name + ' -> 403 agent_not_permitted', r.body);
}

section('fund data switch');
await api.op('settings.update', { agent_sees_fund_data: false }, O);
await refuses(api, 'lps.list', {}, { as: 'agent' }, 403, 'fund_data_off', 'LP data is closed to your AI agent when switched off');
eq((await api.call('funds.get', {}, { as: 'agent' })).status, 200, 'fund figures stay readable');
await api.op('settings.update', { agent_sees_fund_data: true }, O);
eq((await api.call('lps.list', {}, { as: 'agent' })).status, 200, 'and LP data opens again');

const s = summary('t01_empty');
process.exitCode = s.failed > 0 ? 1 : 0;
