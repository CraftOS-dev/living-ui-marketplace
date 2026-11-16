// Empty database: every expenses read op answers without a server error as
// the owner, an employee and your AI agent; a new entity gets its standard
// categories and policy (entity.created).
import { DEMO, eq, expensesOps, fresh, newApi, ok, refuses, sample, section, summary } from './lib.mjs';

fresh();
const api = newApi();
const reads = expensesOps().filter((o) => o.executor.method === 'GET');

async function sweep(as, ctx, label) {
  const statuses = {};
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as });
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, label + ': ' + reads.length + ' reads, no 5xx ' + JSON.stringify(statuses), bad);
  return statuses;
}

section('before setup');
const anon = await sweep('anon', {}, 'nobody signed in');
eq(anon['401'] || 0, reads.length, 'every expenses read needs sign-in');

section('setup seeds the first entity');
await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const ent = (await api.op('entities.list', {}, { as: 'owner' })).entities[0];
const cats = await api.op('expense-categories.list', { entity: ent.id }, { as: 'owner' });
eq(cats.categories.map((c) => c.code), ['meals', 'travel', 'lodging', 'mileage', 'phone_internet', 'training', 'office_supplies', 'client_entertainment', 'other'], 'nine standard categories');
const mileage = cats.categories.find((c) => c.code === 'mileage');
ok(mileage.kind === 'mileage' && mileage.mileage_rate_minor === 60 && mileage.unit === 'km' && mileage.receipt_rule === 'never', 'SG mileage: 0.60 a km, no receipt', mileage);
ok(cats.categories.every((c) => c.component === 'REIMB' && c.taxable === false), 'pay component REIMB, not taxable');
const pol = await api.op('expenses.policy', { entity: ent.id }, { as: 'owner' });
ok(pol.policy.stored === true && pol.policy.finance_over_minor === 100000 && pol.policy.pay_via === 'payroll', 'policy stored: finance from SGD 1,000, paid with payroll', pol.policy);
const flows = await api.op('approval-flows.list', {}, { as: 'owner' });
for (const k of ['claim', 'advance', 'travel']) ok(flows.kinds.includes(k) && flows.flows.some((f) => f.kind === k), 'approval kind and default flow: ' + k);
ok(flows.flows.find((f) => f.kind === 'advance').steps.length === 2, 'advance flow: manager then finance');

section('sweep as owner and your AI agent');
const ctx = { entity: ent.id };
const owner = await sweep('owner', ctx, 'owner');
const agent = await sweep('agent', ctx, 'your AI agent');
ok((owner['200'] || 0) >= 9, 'owner reads answer', owner);
ok((agent['200'] || 0) >= 8, 'agent reads answer', agent);
const home = await api.op('expenses.home', {}, { as: 'owner' });
ok(home.waiting.total === 0 && home.approved_unpaid.total === 0 && home.spend_by_category.groups.length === 0 && home.spend_by_category.currency === 'SGD', 'empty home: nothing waiting, no spend, SGD', home.spend_by_category);
const me = await api.op('expenses.me', {}, { as: 'owner' });
ok(me.employee === null, 'owner without an employee: expenses.me answers empty');
await refuses(api, 'claim-lines.add', { amount: '10.00', category: 'meals' }, { as: 'owner' }, 403, 'no_employee', 'no employee linked: nothing to add expenses to');

section('an employee on an empty expenses database');
const hired = await api.op('people.hire', { entity: ent.id, legal_name: 'Eve Employee', start_day: '2026-01-05', work_email: 'eve@empty.test' }, { as: 'owner' });
const inv = await api.op('members.invite', { email: 'eve@empty.test', name: 'Eve Employee', role: 'employee', employee: hired.employee.id }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: 'eve@empty.test', code: inv.code, password: DEMO.password });
api.setToken('eve@empty.test', joined.token);
const emp = await sweep('eve@empty.test', { entity: ent.id }, 'employee');
ok((emp['403'] || 0) >= 1, 'employee is refused the HR reads', emp);
const mine = await api.op('expenses.me', {}, { as: 'eve@empty.test' });
ok(mine.employee !== null && mine.employments.length === 1 && mine.employments[0].categories.length === 9 && mine.drafts.length === 0 && mine.recent.length === 0, 'employee view: one employment, nine categories, nothing yet', mine);
await refuses(api, 'expenses.home', {}, { as: 'eve@empty.test' }, 403, 'not_permitted', 'employee: no HR home');
await refuses(api, 'claims.list', { view: 'all' }, { as: 'eve@empty.test' }, 403, 'not_permitted', 'employee: cannot list everyone');
const own = await api.op('claims.list', {}, { as: 'eve@empty.test' });
ok(own.view === 'mine' && own.total === 0, 'employee: own list, empty');

section('a manager with no employee record');
const minv = await api.op('members.invite', { email: 'mgr@empty.test', name: 'Mo Manager', role: 'manager' }, { as: 'owner', pin: true });
api.setToken('mgr@empty.test', (await api.op('auth.accept-invite', { email: 'mgr@empty.test', code: minv.code, password: DEMO.password })).token);
const mh = await api.call('expenses.home', {}, { as: 'mgr@empty.test' });
ok(mh.status === 200 && mh.body.scope === 'team' && mh.body.waiting.total === 0, 'expenses.home answers an empty team (no 403)', mh.body);

section('a new entity in another country');
const us = (await api.op('entities.add', { name: 'Empty Inc', country: 'US', region: 'CA', timezone: 'America/Los_Angeles' }, { as: 'owner' })).entity;
const usCats = await api.op('expense-categories.list', { entity: us.id }, { as: 'owner' });
const usMiles = usCats.categories.find((c) => c.code === 'mileage');
ok(usMiles.mileage_rate_minor === 72.5 && usMiles.unit === 'mile', 'US mileage: 72.5 cents a mile', usMiles);
const usMeals = usCats.categories.find((c) => c.code === 'meals');
ok(usMeals.receipt_rule === 'over' && usMeals.receipt_over_minor === 7500, 'US receipts from USD 75', usMeals);
ok(usCats.categories.find((c) => c.code === 'lodging').receipt_rule === 'always', 'US lodging: always a receipt');
const seedAgain = await api.op('expense-categories.seed', { entity: us.id }, { as: 'owner' });
eq(seedAgain.added, [], 'seeding again adds nothing');

summary('t01_empty');
