// payroll-core t01: read sweep of every payroll-core operation on an EMPTY
// database (after setup) as the owner and your AI agent, then on the demo seed
// as every role. No answer may be a 5xx.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, fresh, section, ok, summary, APP, DEMO } from './lib.mjs';

const MINE = ['payroll', 'pay-schedules', 'components', 'recurring', 'pay-inputs', 'ytd', 'comp', 'backpay', 'loans', 'benefits', 'declarations', 'taxprofile', 'payruns', 'payslips', 'holds'];
const ops = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8')).operations.filter((o) => MINE.indexOf(o.name.split('.')[0]) >= 0);
const reads = ops.filter((o) => o.executor.method === 'GET');
console.log(ops.length + ' payroll-core operations, ' + reads.length + ' reads');

function sample(k, ctx) {
  const m = { employment: ctx.employment || 'E0001', entity: ctx.entity || '', payrun: ctx.payrun || 'PR-0001', schedule: ctx.schedule || 'nope00000000000', payslip: ctx.payslip || 'nope00000000000', line: 'nope00000000000', loan: 'nope00000000000', declaration: 'nope00000000000', from_day: '2026-11-01', file: 'x.pdf', country: 'IN' };
  return m[k] !== undefined ? m[k] : 'x';
}

async function sweep(api, who, ctx) {
  let bad = 0;
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params || {})) if (d.required && k !== 'pin') params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as: who });
    if (r.status >= 500) {
      bad++;
      ok(false, who + ' ' + o.name + ' -> ' + r.status, r.body);
    }
  }
  ok(bad === 0, who + ': ' + reads.length + ' reads, no 5xx');
}

const api = newApi();

section('Empty database (setup only)');
fresh({ seed: false });
await api.op('setup.complete', { company_name: 'Empty Co', entity_name: 'Empty Pte Ltd', legal_name: 'Empty Pte. Ltd.', country: 'SG', reporting_currency: 'SGD', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
{
  const ents = (await api.op('entities.list', {}, { as: 'owner' })).entities;
  const home = await api.op('payroll.home', {}, { as: 'owner' });
  ok(home.schedules.length === 1 && home.in_progress.length === 0, 'Payroll home on an empty company: one default schedule, no runs');
  const comps = await api.op('components.list', { entity: ents[0].id }, { as: 'owner' });
  ok(comps.components.some((c) => c.role === 'basic' && c.code === 'SG_BASIC'), 'components seeded from the SG pack when the entity was created');
  const st = await api.op('payroll.settings', { entity: ents[0].id }, { as: 'owner' });
  ok(st.settings.proration === 'working_days' && st.settings.publish === 'scheduled', 'payroll settings defaults for Singapore');
  const run = await api.call('payruns.create', { schedule: home.schedules[0].schedule }, { as: 'owner' });
  ok(run.status === 200, 'a run can be started with nobody to pay');
  const calc = await api.call('payruns.calculate', { payrun: run.body.payrun.id }, { as: 'owner' });
  ok(calc.status === 200 && calc.body.done && calc.body.payrun.employee_count === 0, 'and calculates to an empty run');
  const sub = await api.call('payruns.submit', { payrun: run.body.payrun.id }, { as: 'owner' });
  ok(sub.status === 409 && sub.body.code === 'empty_run', 'an empty run is not sent for approval');
  await sweep(api, 'owner', { entity: ents[0].id, payrun: run.body.payrun.id, schedule: home.schedules[0].schedule });
  await sweep(api, 'agent', { entity: ents[0].id, payrun: run.body.payrun.id, schedule: home.schedules[0].schedule });
}

section('Demo seed, every role');
fresh({ seed: true });
{
  const home = await api.op('payroll.home', {}, { as: 'owner' });
  const run = (await api.op('payruns.create', { schedule: home.schedules[0].schedule }, { as: 'owner' })).payrun;
  await api.op('payruns.calculate', { payrun: run.id }, { as: 'owner' });
  const got = await api.op('payruns.get', { payrun: run.id }, { as: 'owner' });
  const ctx = { payrun: run.id, schedule: home.schedules[0].schedule, payslip: got.payslips[0] ? got.payslips[0].id : '', employment: 'E0005' };
  for (const who of ['owner', 'hr@northwind.test', 'payroll@northwind.test', 'eng.lead@northwind.test', 'sales.lead@northwind.test', 'sam@northwind.test', 'haruto@northwind.test', 'ananya@northwind.test', 'agent']) await sweep(api, who, ctx);
}

const s = summary('t01_sweep');
process.exitCode = s.failed > 0 ? 1 : 0;
