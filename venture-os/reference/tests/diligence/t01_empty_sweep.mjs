// Empty database: every diligence read op as nobody, owner, partner, analyst, venture partner, finance and your AI agent (no 5xx),
// the seeded checklists, agent rules refused before params, and the catalog shape.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { APP, fresh, newApi, team, section, ok, eq, refuses, summary, PARTNER, ANALYST, VP, FINANCE } from './lib.mjs';

fresh();
const api = newApi();

section('before setup');
for (const name of ['dd.get', 'dd.templates', 'refs.list', 'compare.list']) {
  const r = await api.call(name, { deal: 'D-0001' }, { as: 'anon' });
  ok(r.status === 401 || r.status === 409, name + ' without a session is refused (no 5xx)', r);
}

await team(api);
const req = createRequire(import.meta.url);
const mine = ['cat_diligence_dd.js', 'cat_diligence_refs.js', 'cat_diligence_compare.js'].flatMap((f) => req(join(APP, 'pb', 'pb_hooks', f)));

section('catalog');
ok(mine.length === 20, '20 diligence operations', mine.map((o) => o.name));
const rule = (n) => {
  const o = mine.find((x) => x.name === n);
  return o ? o.agent || 'allow' : null;
};
for (const n of ['dd.confirm', 'dd.reject', 'dd.ask', 'refs.dismiss', 'refs.ask', 'compare.fill', 'compare.delete']) ok(rule(n) === 'deny', n + ' is people only');
for (const n of ['dd.questions-save', 'dd.template-save']) ok(rule(n) === 'propose', n + ' is a proposal for your AI agent');
for (const n of ['dd.answer', 'dd.template-apply', 'refs.log', 'refs.suggest', 'compare.save']) ok(rule(n) === 'allow', n + ' is allowed for your AI agent');

section('seeded checklists');
const t = await api.op('dd.templates', { full: true }, { as: 'owner' });
eq(t.templates.map((x) => x.key), ['seed', 'series_a'], 'seed and series_a');
for (const tpl of t.templates) {
  eq(tpl.areas.map((a) => a.label), ['Team', 'Market', 'Product', 'Traction', 'Financials', 'Legal', 'Technology', 'Customers'], tpl.name + ' has the eight areas');
  const per = {};
  tpl.questions.forEach((q) => (per[q.area] = (per[q.area] || 0) + 1));
  ok(Object.values(per).every((n) => n >= 6 && n <= 12), tpl.name + ': 6 to 12 questions per area', per);
  ok(tpl.questions.every((q) => ['text', 'number', 'yes_no', 'date'].includes(q.type)), tpl.name + ': every question has an answer type');
  ok(tpl.questions.filter((q) => q.type === 'number').every((q) => q.unit !== ''), tpl.name + ': every number has a unit');
}

section('empty read sweep');
const who = [
  ['owner', { as: 'owner' }],
  ['partner', { as: PARTNER }],
  ['analyst', { as: ANALYST }],
  ['venture partner', { as: VP }],
  ['finance', { as: FINANCE }],
  ['agent', { as: 'agent' }],
];
const params = { deal: 'D-0001', grid: 'nope00000000000' };
ok(mine.every((o) => o.desc.length <= 400 && !/[\u2013\u2014]/.test(JSON.stringify(o))), 'every desc under 400 characters, no en or em dashes');
for (const o of mine.filter((x) => x.effect === 'read')) {
  for (const [label, as] of who) {
    const p = {};
    for (const [k, d] of Object.entries(o.params || {})) if (d.required && params[k]) p[k] = params[k];
    if (o.name === 'dd.get' || o.name === 'refs.list' || o.name === 'refs.candidates') p.deal = 'D-0001';
    if (o.name === 'compare.get') p.grid = params.grid;
    const r = await api.call(o.name, p, as);
    ok(r.status < 500, o.name + ' as ' + label + ' -> ' + r.status, r.body);
  }
}
eq((await api.op('compare.list', {}, { as: 'owner' })).grids, [], 'no grids yet');
await refuses(api, 'dd.get', { deal: 'D-0001' }, { as: 'owner' }, 404, 'not_found', 'a missing deal');
await refuses(api, 'dd.get', { deal: 'D-0001' }, { as: FINANCE }, 403, 'not_permitted', 'finance has no diligence view');
await refuses(api, 'compare.list', {}, { as: FINANCE }, 403, undefined, 'finance has no grid view');

section('people-only ops refuse your AI agent before params');
for (const n of ['dd.confirm', 'dd.reject', 'dd.ask', 'refs.dismiss', 'refs.ask', 'compare.fill', 'compare.delete']) await refuses(api, n, {}, { as: 'agent' }, 403, 'agent_not_permitted', n);

section('write refusals on an empty database');
await refuses(api, 'dd.template-apply', { deal: 'D-0001' }, { as: 'owner' }, 404, 'not_found', 'apply to a missing deal');
await refuses(api, 'dd.answer', { answers: '[]' }, { as: 'owner' }, 400, 'missing_param', 'no answers');
await refuses(api, 'dd.answer', { answers: JSON.stringify([{ question: 'nope00000000000', value: 'x' }]) }, { as: 'agent' }, 400, undefined, 'an unknown question is named');
await refuses(api, 'dd.template-apply', { deal: 'D-0001' }, { as: VP }, 403, 'not_permitted', 'a venture partner cannot edit diligence');
await refuses(api, 'compare.save', { deals: '["D-0001"]' }, { as: 'owner' }, 404, 'not_found', 'a grid of a missing deal');

section('Next on an empty database');
for (const as of ['owner', PARTNER, ANALYST]) {
  const n = await api.op('next.list', {}, { as });
  ok(n.items.filter((i) => i.module === 'diligence').length === 0 && n.errors.filter((e) => e.module === 'diligence').length === 0, 'no diligence items or errors for ' + as, n.errors);
}

summary('t01 empty sweep');
