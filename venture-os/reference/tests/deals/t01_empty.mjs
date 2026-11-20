// Deals module, empty database: every read op of the whole catalog as owner, partner, analyst and
// your AI agent answers without a 5xx; the deals module's own reads answer their empty shapes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, newApi, fresh, setupFirm, member, section, ok, eq, refuses, summary } from './lib.mjs';

fresh();
const api = newApi();

section('Before setup');
{
  const r = await api.call('notes.templates', {}, { as: 'anon' });
  ok(r.status === 401, 'notes.templates needs a session (' + r.status + ')');
}

await setupFirm(api);
const partner = await member(api, 'partner@venture.test', 'partner', 'Pat Partner');
const analyst = await member(api, 'analyst@venture.test', 'analyst', 'Ana Analyst');
const scout = await member(api, 'scout@venture.test', 'scout', 'Sam Scout');

section('Empty sweep of every read op');
const ops = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8')).operations;
const reads = ops.filter((o) => o.executor.method === 'GET');
const sample = (k) => ({ deal: 'D-0001', note: 'nope00000000000', page: 'deals.table', entity: 'Fund I', ref_collection: 'deals', ref_id: 'nope00000000000', member: 'owner@venture.test', kind: 'note_review' })[k] ?? 'x';
let fives = 0;
const bad = [];
for (const as of ['owner', partner, analyst, scout, 'agent']) {
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params ?? o.inputSchema?.properties ?? {})) if (d.required) params[k] = sample(k);
    for (const k of o.inputSchema?.required ?? []) params[k] = sample(k);
    const r = await api.call(o.name, params, { as });
    if (r.status >= 500) {
      fives++;
      bad.push(o.name + ' as ' + as + ': ' + JSON.stringify(r.body).slice(0, 200));
    }
  }
}
ok(fives === 0, 'no 5xx across ' + reads.length + ' read ops x 5 callers', bad.slice(0, 10));

section('The deals module reads on an empty database');
for (const as of ['owner', partner, analyst, 'agent']) {
  const f = await api.op('deals.funnel', {}, { as });
  ok(f.stages.length === 9 && f.stages[0].key === 'inbound' && f.cohort === 0 && f.stages.every((s) => s.count === 0 && s.conversion_ppm === null && s.median_days === null), 'deals.funnel empty for ' + as + ' (Inbound and 8 stages)');
  ok(/^\d{4}-Q[1-4]$/.test(f.quarter.key) && f.open === 0 && f.hidden === 0, 'quarter ' + f.quarter.key + ', nothing open, nothing hidden (' + as + ')');
  const s = await api.op('deals.stalls', {}, { as });
  eq([s.deals.length, s.total, s.hidden], [0, 0, 0], 'deals.stalls empty (' + as + ')');
  const t = await api.op('notes.templates', {}, { as });
  eq(t.templates.map((x) => x.key), ['first_call', 'partner_meeting', 'reference', 'board', 'free'], 'five seeded templates (' + as + ')');
}
{
  const t = await api.op('notes.templates', {}, { as: 'owner' });
  eq(t.templates[0].sections.map((s) => s.label), ['Team', 'Product', 'Market', 'Traction', 'Round', 'Next steps'], 'First call sections');
  eq(t.templates[0].stages, ['sourced', 'screen', 'first_meeting'], 'First call opens at the early stages');
  const mm = await api.op('deals.members', {}, { as: partner });
  ok(mm.members[0].email === partner && mm.members.some((m) => m.email === 'owner@venture.test') && !mm.members.some((m) => m.email === scout), 'deals.members: me first, pipeline members only');
  const l = await api.op('notes.list', {}, { as: 'owner' });
  eq([l.notes.length, l.total, l.hidden], [0, 0, 0], 'notes.list empty');
  await refuses(api, 'notes.get', { note: 'nope00000000000' }, { as: 'owner' }, 404, 'not_found', 'notes.get of nothing');
  await refuses(api, 'notes.list', { deal: 'D-0001' }, { as: 'owner' }, 404, 'not_found', 'notes.list of a deal that is not there');
  await refuses(api, 'deals.funnel', { quarter: '2026-Q5' }, { as: 'owner' }, 400, 'invalid_param', 'a bad quarter');
  const n = await api.op('next.list', {}, { as: partner });
  ok(n.errors.length === 0 && n.items.filter((i) => i.module === 'deals').length === 0, 'Next has no deals items and no errors');
  const st = await api.op('app.status', {}, { as: 'owner' });
  ok(JSON.stringify(st).indexOf('note_review') >= 0, 'app.status names the note_review trigger');
  const g = await api.op('app.guide', {}, { as: 'agent' });
  ok(JSON.stringify(g).indexOf('Deals, the pipeline and meeting notes') >= 0, 'app.guide carries the deals section');
}

section('People-only and agent rules on an empty database');
await refuses(api, 'notes.review', { note: 'nope00000000000' }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot run notes.review');
await refuses(api, 'notes.delete', { note: 'nope00000000000' }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot delete a note');
await refuses(api, 'notes.create', { deal: 'D-0001' }, { as: scout }, 403, 'not_permitted', 'a scout cannot write notes');
await refuses(api, 'notes.template-save', { name: 'Customer call', sections: '["Who","What"]' }, { as: partner }, 403, 'not_permitted', 'a partner cannot change templates (settings)');

summary('t01_empty');
