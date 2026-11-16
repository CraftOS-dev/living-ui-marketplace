// QA t02b: off-cycle bonus paid the SAME day as the locked regular run (Nov 30):
// does the engine aggregate the month or period (SG SDL and SHG, US FUTA, GB NI)?
// Runs on the state t02 leaves (needs its new hires E0025 SG, E0026 US, E0031 GB, E0029 MY, E0033 AU, E0028 IN).
import { newApi, ok, summary, writeResult } from './lib.mjs';
const api = newApi();
const PAY = { as: 'payroll@northwind.test' };
const out = {};
const people = (await api.op('people.directory', { status: 'all', limit: 500 }, { as: 'owner' })).people;
for (const [cc, num, amount] of [['SG', 'E0025', '1000.00'], ['US', 'E0026', '1000.00'], ['GB', 'E0031', '1000.00'], ['MY', 'E0029', '5000.00'], ['AU', 'E0033', '1000.00'], ['IN', 'E0028', '50000.00']]) {
  const p = people.find((x) => x.number === num);
  const comps = (await api.op('components.list', { entity: p.entity }, PAY)).components;
  const code = comps.find((c) => c.role === 'bonus').code;
  const b = (await api.op('payruns.create', { kind: 'bonus', entity: p.entity, employments: [p.employment], pay_date: '2026-11-30', label: 'QA same-day bonus' }, PAY)).payrun;
  await api.op('pay-inputs.add', { employment: p.employment, component: code, amount, payrun: b.id }, PAY);
  let r = await api.op('payruns.calculate', { payrun: b.id }, PAY);
  for (let i = 0; i < 20 && !r.done; i++) r = await api.op('payruns.calculate', { payrun: b.id, continue: true }, PAY);
  const g = await api.op('payruns.get', { payrun: b.id }, PAY);
  const s = (await api.op('payslips.get', { payslip: g.payslips[0].id }, PAY)).payslip;
  const lines = {};
  for (const gr of s.groups) for (const l of gr.lines) lines[l.code] = l.amount_minor;
  out[cc] = { run: b.number, lines, issues: (s.issues || []).map((i) => i.code) };
  console.log(cc, b.number, JSON.stringify(lines), JSON.stringify(out[cc].issues));
}
writeResult('t02b_bonus_same_day.json', out);
ok(true, 'recorded');
summary('t02b');
