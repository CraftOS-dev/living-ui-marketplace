// QA2 probe: a 5,000 allowance in an off-cycle run (30 Nov) next to the locked
// November regular run, US-CA and AU, calculated only (the run is deleted after).
import { newApi } from './lib.mjs';
const api = newApi();
const PAY = { as: 'payroll@northwind.test' };
const dir = (await api.op('people.directory', { status: 'all', limit: 500 }, { as: 'owner' })).people;
for (const [cc, num, kind] of [['US', 'E0026', 'off_cycle'], ['US', 'E0026', 'bonus'], ['AU', 'E0033', 'off_cycle'], ['AU', 'E0033', 'bonus']]) {
  const p = dir.find((x) => x.number === num);
  const comps = (await api.op('components.list', { entity: p.entity }, PAY)).components;
  const c = kind === 'bonus' ? comps.find((x) => x.role === 'bonus') : comps.find((x) => x.role === 'allowance');
  const run = (await api.op('payruns.create', { kind, entity: p.entity, employments: [p.employment], pay_date: '2026-11-30', label: 'QA2 probe' }, PAY)).payrun;
  await api.op('pay-inputs.add', { employment: p.employment, component: c.code, amount: '5000.00', payrun: run.id }, PAY);
  let r = await api.op('payruns.calculate', { payrun: run.id }, PAY);
  for (let i = 0; i < 20 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: run.id, continue: true }, PAY);
  const g = await api.op('payruns.get', { payrun: run.id }, PAY);
  const slip = (await api.op('payslips.get', { payslip: g.payslips[0].id }, PAY)).payslip;
  const lines = {};
  for (const gr of slip.groups) for (const l of gr.lines) lines[l.code] = (lines[l.code] || 0) + l.amount_minor;
  const iss = (await api.op('payruns.issues', { payrun: run.id }, PAY)).issues.map((i) => i.severity + ':' + i.code);
  console.log(cc, kind, c.code, JSON.stringify(lines), JSON.stringify(iss));
  await api.call('payruns.delete', { payrun: run.id }, { as: 'owner' });
}
