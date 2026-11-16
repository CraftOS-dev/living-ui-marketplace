// Refusals: your AI agent on every deny op, employees and managers on payroll
// ops, scope by entity, pay figures hidden from your AI agent when the company
// turns them off. Runs on the seeded database left by t02 (NO_FRESH=1) or seeds.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { APP, eq, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';
import { seedAll } from './fixtures.mjs';

if (!process.env.NO_FRESH) fresh({ seed: true });
const api = newApi();
if (!process.env.NO_FRESH) await seedAll(api);
const require = createRequire(import.meta.url);
const mine = [];
for (const f of readdirSync(join(APP, 'pb', 'pb_hooks')).filter((n) => /^cat_payroll_out_.*\.js$/.test(n))) for (const o of require(join(APP, 'pb', 'pb_hooks', f))) mine.push(o);

section('catalog rules');
for (const o of mine) if (o.effect === 'confirm') eq(o.agent, 'deny', o.name + ' (confirm) is people only');
for (const o of mine) if (/^(bankfiles\.(export|download|void)|payout\.(confirm-upload|mark-paid|settings-set)|packs\.(activate|retire)|yearend\.(issue|csv)|filings\.(submit|download)|journal\.(export|download))$/.test(o.name)) eq(o.agent, 'deny', o.name + ' is people only');
const deny = mine.filter((o) => o.agent === 'deny');
ok(deny.length >= 20, deny.length + ' payroll-out ops are people only');

section('your AI agent on people-only ops');
for (const o of deny) {
  const params = {};
  for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = k === 'payrun' ? 'PR-T0002' : k === 'entity' ? 'Northwind Inc' : k === 'doc' ? 'w2' : 'x';
  const r = await api.call(o.name, params, { as: 'agent' });
  ok(r.status === 403, o.name + ' refused for your AI agent (' + r.status + ')', r.body);
}

section('employees and managers');
const reads = ['payout.overview', 'filings.list', 'packs.list', 'payreports.cost', 'yearend.overview'];
for (const n of reads) await refuses(api, n, {}, { as: 'sam@northwind.test' }, 403, undefined, 'an employee cannot read ' + n);
for (const n of reads) await refuses(api, n, {}, { as: 'eng.lead@northwind.test' }, 403, undefined, 'a manager cannot read ' + n);
await refuses(api, 'payout.run', { payrun: 'PR-T0002' }, { as: 'haruto@northwind.test' }, 403, undefined, 'an employee cannot see a run pay-out');
await refuses(api, 'filings.submit', { filing: 'x', reference: 'r' }, { as: 'hr@northwind.test' }, 403, undefined, 'HR (payroll view) cannot submit filings');
const hrView = await api.call('filings.list', {}, { as: 'hr@northwind.test' });
eq(hrView.status, 200, 'HR (payroll view) reads the filings ledger');
const me = await api.call('yearend.mine', {}, { as: 'sam@northwind.test' });
eq(me.status, 200, 'an employee reads their own year-end documents');

section('agent reads and the pay switch');
const ar = await api.call('payout.overview', {}, { as: 'agent' });
eq(ar.status, 200, 'your AI agent reads pay-out when pay is visible');
const set = await api.call('settings.update', { agent_sees_pay: false }, { as: 'owner' });
ok(set.status === 200, 'owner turns pay off for your AI agent', set.body);
await refuses(api, 'payout.overview', {}, { as: 'agent' }, 403, 'pay_hidden', 'pay-out hidden from your AI agent');
await refuses(api, 'payreports.register', { payrun: 'PR-T0002' }, { as: 'agent' }, 403, 'pay_hidden', 'register hidden from your AI agent');
await refuses(api, 'filings.list', {}, { as: 'agent' }, 403, 'pay_hidden', 'filing amounts hidden from your AI agent');
const pk = await api.call('packs.list', {}, { as: 'agent' });
eq(pk.status, 200, 'rule packs stay readable (no pay figures)');
await api.call('settings.update', { agent_sees_pay: true }, { as: 'owner' });

section('proposals');
const anyFiling = (await api.op('filings.list', { show: 'all', limit: 1 }, { as: 'owner' })).filings[0];
const bad = await api.call('filings.set-due', { filing: 'x', due_day: '2026-12-01', why: 'state rule' }, { as: 'agent' });
eq(bad.status, 404, 'a proposal for a filing that does not exist is refused at once');
const p1 = await api.call('filings.set-due', { filing: anyFiling.id, due_day: '2026-12-01', why: 'state rule' }, { as: 'agent' });
ok(p1.status === 200 && p1.body.proposal, 'set-due by your AI agent becomes a proposal', p1.body);

const s = summary('t03_permissions');
process.exitCode = s.failed > 0 ? 1 : 0;
