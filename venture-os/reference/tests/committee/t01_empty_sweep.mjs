// t01: empty database. Every committee read op as nobody, owner, partner, analyst and your AI agent (no 5xx);
// people-only ops refuse your AI agent before params and PIN; the empty answers are honest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, fresh, team, section, ok, eq, refuses, summary, APP, O, A, PEOPLE, as } from './lib.mjs';

fresh();
const api = newApi();

section('before setup');
const ops = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8')).operations.filter((o) => /^(memos|meetings|bearcase|votes|decisions|conditions)\./.test(o.name));
ok(ops.length >= 30, 'the committee catalog has ' + ops.length + ' operations');
for (const o of ops) {
  const r = await api.call(o.name, {}, { as: 'anon' });
  ok(r.status === 401 || r.status === 409, o.name + ' refuses nobody (' + r.status + ')', r.body);
}

await team(api);

section('empty reads as owner, partner, analyst, your AI agent');
const reads = ops.filter((o) => o.executor.method === 'GET');
const samples = { deal: 'D-0001', memo: 'M-001', meeting: 'next', item: 'nope00000000000', decision: 'nope00000000000' };
for (const who of [O, as('p1'), as('an'), A]) {
  for (const o of reads) {
    const r0 = await api.call(o.name, {}, who);
    ok(r0.status < 500, o.name + ' as ' + who.as + ' without params: ' + r0.status, r0.body);
    const params = {};
    for (const k of Object.keys(o.params || {})) if (samples[k] !== undefined) params[k] = samples[k];
    const r1 = await api.call(o.name, params, who);
    ok(r1.status < 500, o.name + ' as ' + who.as + ' with sample params: ' + r1.status, r1.body);
  }
}

section('empty states');
const ml = await api.op('meetings.list', {}, as('p1'));
ok(ml.next === null && ml.meetings.length === 0 && ml.votes_due === 0, 'no meeting, no votes due');
ok(typeof ml.defaults.day === 'string' && ml.defaults.time === '10:00' && ml.defaults.cooling_hours === 24, 'defaults: the next meeting day at 10:00, 24 hours of cooling-off', ml.defaults);
eq((await api.op('decisions.list', {}, O)).decisions.length, 0, 'no decisions');
eq((await api.op('decisions.anti-portfolio', {}, O)).rows.length, 0, 'no anti-portfolio rows');
eq((await api.op('conditions.list', {}, O)).conditions.length, 0, 'no conditions');
eq((await api.op('memos.list', {}, O)).memos.length, 0, 'no memos');
const tpl = (await api.op('memos.templates', {}, A)).templates;
ok(tpl.length === 1 && tpl[0].is_default && tpl[0].sections.length === 13, 'the seeded template has the 13 report sections');
ok(tpl[0].sections.filter((s) => s.people_only).map((s) => s.key).join(',') === 'thesis,recommendation,scenarios', 'thesis, recommendation and scenarios are people only');
const next = await api.op('next.list', {}, as('p1'));
ok(!next.errors.some((e) => e.module === 'committee'), 'committee Next answers without errors', next.errors);

section('people only, refused for your AI agent before params');
for (const o of ops.filter((x) => String(x.description).indexOf('[People only.]') >= 0)) {
  const r = await api.call(o.name, {}, A);
  ok(r.status === 403 && r.body.code === 'agent_not_permitted', o.name + ' refuses your AI agent', r.body);
}
await refuses(api, 'votes.cast', { item: 'x', choice: '4' }, A, 403, 'agent_not_permitted', 'your AI agent never votes');
await refuses(api, 'votes.reveal', { item: 'x' }, A, 403, 'agent_not_permitted', 'your AI agent never reveals');
await refuses(api, 'decisions.record', { deal: 'D-0001', outcome: 'invest' }, A, 403, 'agent_not_permitted', 'your AI agent never records a decision');
await refuses(api, 'meetings.create', {}, as('an'), 403, 'not_permitted', 'an analyst (committee view) cannot create meetings');

const s = summary('t01 empty sweep');
process.exit(s.failed > 0 ? 1 : 0);
