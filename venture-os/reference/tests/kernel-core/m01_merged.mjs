// Merged check: the kernel with kernel-records' real collections and ops
// (no test kit). Empty sweep as four principals, then deal scope, the
// tracked transaction and undo, proposals and Next across the two.
//   VO_APP=<scratch copy of APP> VO_PORT=3181 VO_BRIDGE=3281 node m01_merged.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, fresh, member, newApi, ok, refuses, sample, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
await member(api, 'analyst@venture.test', 'analyst', 'Ann Analyst');
const PA = { as: 'partner@venture.test' };
const AN = { as: 'analyst@venture.test' };

section('empty sweep of the merged catalog');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');
for (const as of ['owner', 'partner@venture.test', 'analyst@venture.test', 'agent']) {
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, {});
    const r = await api.call(o.name, params, { as });
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  }
  ok(bad.length === 0, as + ': ' + reads.length + ' reads, no 5xx', bad);
}

section('deals through the kernel');
const d1 = await api.op('deals.create', { company: 'Acme Robotics' }, PA);
const deal = d1.deal || d1;
ok(/^D-\d{4}$/.test(deal.number || ''), 'a deal with its display id from settings.seq', deal);
ok(typeof d1._activity === 'string' && d1._activity !== '', 'the create is one undo unit (_activity)', d1._activity);
const fund = (await api.op('entities.list', { kind: 'fund' }, O)).entities[0];
const d2 = await api.op('deals.create', { company: 'Secret Co', fund: fund.id, restricted: true }, O);
const secret = d2.deal || d2;
eq((await api.call('deals.get', { deal: secret.id }, AN)).status >= 400, true, 'a restricted deal is closed to the analyst');
eq((await api.call('deals.get', { deal: secret.id }, A)).status >= 400, true, 'and to your AI agent');
await api.op('deals.restrict', { deal: secret.id, restricted: true, agent_allowed: true }, O);
eq((await api.call('deals.get', { deal: secret.id }, A)).status, 200, 'agent_allowed lets your AI agent in (kernel dealVisible)');
const list = await api.op('deals.list', {}, AN);
ok(list.hidden >= 1, 'deals.list marks hidden rows', list.hidden);
const un = await api.op('activity.undo', { entry: d1._activity }, PA);
eq(un.undone, 1, 'undoing the create works on real collections');
eq((await api.call('deals.get', { deal: deal.id }, PA)).status >= 400, true, 'the deal is gone');

section('proposals across modules');
const c = await api.op('companies.upsert', { name: 'Lumen Health', domain: 'lumenhealth.io', sector: 'health' }, PA);
const comp = c.company || c;
const pr = await api.op('companies.update', { company: comp.id, sector: 'digital health', why: 'Their deck says digital health', evidence: 'AI triage for urgent care clinics' }, A);
ok(pr.proposed === true, 'your AI agent changing a person value is a proposal', pr);
const nx = await api.op('next.list', { kinds: 'proposal' }, PA);
ok(nx.items.some((i) => i.key === 'kernel:proposal:' + pr.proposal), 'it is in the partner Next');
const acc = await api.op('proposals.accept', { proposal: pr.proposal }, PA);
eq(acc.applied, 1, 'accepted and applied as the partner');
const d3 = await api.op('deals.create', { company: 'Display Co', restricted: true, agent_allowed: true }, PA);
const shown = d3.deal || d3;
const pd = await api.op('deals.update', { deal: shown.number, name: 'Display Co seed', why: 'From the deck' }, A);
ok(pd.proposed === true, 'your AI agent proposes a deal change by display id', pd);
eq((await api.op('proposals.get', { proposal: pd.proposal }, PA)).proposal.deal, shown.id, 'the proposal keeps the deal id (lib_deals.ref)');
ok((await api.op('next.list', { kinds: 'proposal' }, PA)).items.some((i) => i.key === 'kernel:proposal:' + pd.proposal), 'and is in the deal team Next');
ok(!(await api.op('next.list', { kinds: 'proposal' }, AN)).items.some((i) => i.key === 'kernel:proposal:' + pd.proposal), 'and hidden from someone off the restricted deal');
const g = await api.op('app.guide', {}, A);
ok(g.modules.some((m) => m.module === 'records'), 'app.guide lists the records module', g.modules.map((m) => m.module));
const sr = await api.op('search.query', { q: 'lumen' }, PA);
ok(sr.results.some((r) => r.module === 'records'), 'search reaches the records module', sr.results);

const s = summary('m01_merged');
process.exitCode = s.failed > 0 ? 1 : 0;
