// t01: empty database. Every markets read op as owner, partner, analyst, scout and your AI agent (no 5xx);
// people-only ops refuse your AI agent before params; view-only roles cannot write; Next and search hold
// no markets errors.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, fresh, newApi, firm, section, ok, refuses, summary } from './lib.mjs';

fresh();
const api = newApi();
const who = await firm(api);
const ops = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8')).operations;
const mine = ops.filter((o) => /^(theses\.summary|radars\.|signals\.|maps\.)/.test(o.name));

section('read sweep on an empty database');
const reads = mine.filter((o) => o.executor.method === 'GET');
ok(reads.length >= 7, 'markets has ' + reads.length + ' read ops');
const sample = { radar: 'nope00000000000', map: 'nope00000000000', thesis: 'nope00000000000' };
for (const as of [who.owner, who.partner, who.analyst, who.scout, who.agent]) {
  for (const o of reads) {
    const req = {};
    for (const [k, d] of Object.entries(o.params || {})) if (d.required) req[k] = sample[k] ?? 'x';
    const r = await api.call(o.name, req, { as });
    ok(r.status < 500, as + ' ' + o.name + ' -> ' + r.status, r.body);
  }
  const plain = await api.call('theses.summary', {}, { as });
  ok(plain.status === 200 || plain.status === 403, as + ' theses.summary answers ' + plain.status);
}
const s0 = await api.op('theses.summary', {}, { as: 'owner' });
ok(s0.total === 0 && Array.isArray(s0.theses), 'theses.summary is empty');
const l0 = await api.op('signals.list', {}, { as: 'owner' });
ok(l0.total === 0 && l0.signals.length === 0 && l0.next_offset === null, 'signals.list is empty');
const m0 = await api.op('maps.list', {}, { as: 'owner' });
ok(m0.total === 0, 'maps.list is empty');
const o0 = await api.op('radars.options', {}, { as: 'owner' });
ok(o0.sources.length === 5 && o0.sources.filter((s) => s.by === 'agent').length === 2, 'radars.options: 3 app sources and 2 registries for your AI agent');
ok(/Northwind Ventures owner@venture\.test/.test(o0.user_agent), 'EDGAR User-Agent names the firm and the owner (' + o0.user_agent + ')');

section('Next and search on an empty database');
for (const as of [who.owner, who.partner, who.analyst]) {
  const n = await api.op('next.list', {}, { as });
  ok(!(n.errors || []).some((e) => e.module === 'markets'), as + ': no markets errors in Next');
  const s = await api.op('search.query', { q: 'fin' }, { as });
  ok(Array.isArray(s.results || s.items || []), as + ': search answers');
}

section('your AI agent is refused people-only ops before params');
for (const name of ['signals.dismiss', 'signals.to-inbox', 'maps.place', 'maps.accept']) await refuses(api, name, {}, { as: 'agent' }, 403, 'agent_not_permitted', 'agent ' + name);

section('view-only roles cannot change markets');
await refuses(api, 'radars.save', { thesis: 'x' }, { as: who.analyst }, 403, undefined, 'analyst radars.save');
await refuses(api, 'maps.save', { name: 'x' }, { as: who.analyst }, 403, undefined, 'analyst maps.save');
await refuses(api, 'signals.add', { thesis: 'x', name: 'x' }, { as: who.analyst }, 403, undefined, 'analyst signals.add');
await refuses(api, 'theses.summary', {}, { as: who.scout }, 403, undefined, 'scout has no markets view');

section('bad params are named');
await refuses(api, 'radars.get', { radar: 'nope' }, { as: 'owner' }, 404, 'not_found', 'unknown radar');
await refuses(api, 'maps.get', { map: 'nope' }, { as: 'owner' }, 404, 'not_found', 'unknown map');
await refuses(api, 'signals.list', { status: 'weird' }, { as: 'owner' }, 400, 'invalid_param', 'unknown status');
await refuses(api, 'maps.get', { map: 'nope', as_of: '2026-13-01' }, { as: 'owner' }, 400, undefined, 'bad as_of');

const res = summary('t01_empty_sweep');
process.exit(res.failed > 0 ? 1 : 0);
