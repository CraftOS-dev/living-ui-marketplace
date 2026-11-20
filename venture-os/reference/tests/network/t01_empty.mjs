// t01: an empty database. Every read op of the catalog as owner, partner,
// analyst and your AI agent (no 5xx), then network's reads answer their
// empty shapes, Next holds nothing of network's, imports know the targets,
// and the people-only ops refuse your AI agent before any param.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, firm, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';

// No bridge: an empty firm with nothing to read (a calendar run that lands during the test reads nothing).
await fresh({ noBridge: true });
const api = newApi();

section('before setup');
const pre = await api.call('capture.status', {}, { as: 'agent' });
ok(pre.status < 500, 'capture.status before setup answers without a 5xx', pre.status);

const { O, P, AN, A } = await firm(api);

section('empty sweep of every read op');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');
const sample = (k) => ({ person: 'nobody@example.com', company: 'nope.example', intro: 'nope00000000000', brief: 'nope00000000000', event: 'nope00000000000', q: 'acme', deal: 'D-9999', member: 'owner@venture.test', ask: 'nope00000000000', outbound: 'nope00000000000', entity: 'Fund I', proposal: 'nope00000000000', ref_collection: 'deals', ref_id: 'nope00000000000', page: 'network.people', amount: '100', from: 'USD', to: 'USD', day: '2026-11-04', target: 'people', anchors: '[]', file: 'nope00000000000', thesis: 'nope00000000000', facts: '{}' })[k] ?? 'x';
for (const as of ['owner', 'partner@venture.test', 'analyst@venture.test', 'agent']) {
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k);
    const r = await api.call(o.name, params, { as });
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, as + ': ' + reads.length + ' reads, no 5xx', bad);
}
const mine = reads.filter((o) => /^(capture|interactions|network|intros|briefs|calendar)\./.test(o.name));
for (const as of ['owner', 'partner@venture.test', 'analyst@venture.test', 'agent']) {
  const bad = [];
  for (const o of mine) {
    const r = await api.call(o.name, {}, { as });
    if (r.status >= 500) bad.push(o.name + ' ' + r.status);
  }
  ok(bad.length === 0, as + ': network reads without params, no 5xx', bad);
}

section('empty answers');
const st = await api.op('capture.status', {}, O);
eq(st.gmail, 'offline', 'outside CraftBot capture.status says offline (Connect Gmail in CraftBot)');
eq(st.members.length, 3, 'every active member is listed with their consent');
ok(st.members.every((m) => m.consent === false), 'capture is opt-in: nobody is captured yet');
ok(st.me && st.me.email === 'owner@venture.test', 'the caller is marked as me');
eq(st.labels, ['Venture OS/Deals', 'Venture OS/Updates'], 'the labels used are shown');
const cov = await api.op('network.coverage', {}, O);
eq([cov.total, cov.bands.strong, cov.bands.none], [0, 0, 0], 'coverage is empty');
const ppl = await api.op('network.people', {}, P);
eq([ppl.total, ppl.people.length], [0, 0], 'no people yet');
const cos = await api.op('network.companies', {}, AN);
eq(cos.total, 0, 'no companies yet');
const cal = await api.op('calendar.list', {}, O);
eq(cal.events.length, 0, 'no meetings yet');
ok(cal.calendar === 'never' || cal.calendar === 'offline', 'the calendar was never read (or offline outside CraftBot)', cal.calendar);
const fi = await api.op('network.find', { q: 'acme' }, O);
eq(fi.results.length, 0, 'Who knows finds nobody');
const bl = await api.op('briefs.list', {}, O);
eq(bl.briefs.length, 0, 'no briefs');
const il = await api.op('intros.list', {}, O);
eq(il.intros.length, 0, 'no intros');
const nx = await api.op('next.list', {}, O);
ok(!nx.items.some((i) => i.module === 'network'), 'Next holds nothing of network', nx.items.map((i) => i.key));
ok((nx.errors || []).length === 0, 'no needsYou errors', nx.errors);
const td = await api.op('app.today', {}, A);
ok(JSON.stringify(td).indexOf('meetings') >= 0, 'app.today carries the meetings block', Object.keys(td));
const tg = await api.op('imports.targets', {}, O);
ok(['people', 'companies'].every((t) => tg.targets.some((x) => x.target === t && x.module === 'network')), 'imports offers people and companies (network)', tg.targets.map((t) => t.target));
const g = await api.op('app.guide', { module: 'network' }, A);
ok(JSON.stringify(g).indexOf('network.paths') >= 0 && g.op_groups.includes('intros'), 'app.guide has the network section');
const rec = await api.op('app.guide', { recipe: 'meeting_brief' }, A);
ok(JSON.stringify(rec).indexOf('briefs.save') >= 0, 'the brief recipe is served', JSON.stringify(rec).slice(0, 200));

section('people-only ops refuse your AI agent before params');
for (const name of ['capture.consent', 'capture.configure', 'intros.outcome', 'intros.cancel', 'calendar.add-note', 'calendar.skip-note']) await refuses(api, name, {}, A, 403, 'agent_not_permitted', name);
// intros.request is a proposal for your AI agent (qa-cli RULING CLI-04): an empty call is checked first.
await refuses(api, 'intros.request', {}, A, 400, 'missing_param', 'intros.request needs its target, for your AI agent too');
await refuses(api, 'capture.configure', { firm_domains: '["x.com"]' }, P, 403, 'not_permitted', 'a partner cannot change the firm capture settings');
await refuses(api, 'interactions.log', { kind: 'call', people: '["a@b.com"]' }, AN, 403, 'not_permitted', 'an analyst (network view) cannot log touches');
await refuses(api, 'intros.request', { target: 'a@b.com', via: 'owner@venture.test' }, AN, 403, 'not_permitted', 'an analyst cannot ask for intros');

const s = summary('t01_empty');
process.exitCode = s.failed > 0 ? 1 : 0;
