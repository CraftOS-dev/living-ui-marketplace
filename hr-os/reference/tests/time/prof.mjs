import { newApi } from './lib.mjs';
const api = newApi();
const periods = process.argv.slice(2).length ? [process.argv.slice(2)] : [['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30']];
for (const [from, to] of periods) {
  const r = await api.op('zstub.pay-profile', { from, to }, { as: 'hr@northwind.test' });
  console.log(from, to, 'n', r.n, JSON.stringify(r.best_per_employee_ms), JSON.stringify(r.micro), JSON.stringify(r.rules0));
}
