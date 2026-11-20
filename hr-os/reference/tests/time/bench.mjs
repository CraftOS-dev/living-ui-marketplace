// payInputs timing over the demo seed (server side) and the equality proof:
// the old lib_time (before the speed work), the new payInputs and
// payInputsMany answer the same for every employment of the seed.
//   node bench.mjs [--fresh | --raw]
//   --fresh: new database, demo seed, auto attendance processed for
//            2026-09-01..2026-11-04, a month of long Japanese days with night work
//   --raw:   new database, demo seed only (no attendance saved: every past day is computed)
import { fresh, newApi } from './lib.mjs';
const raw = process.argv.includes('--raw');
if (process.argv.includes('--fresh') || raw) {
  fresh({ seed: true });
  const api0 = newApi();
  if (!raw) await api0.op('attendance.process', { from: '2026-09-01', to: '2026-11-04' }, { as: 'hr@northwind.test' });
  for (let d = 1; d <= 30; d++) {
    const day = '2026-10-' + String(d).padStart(2, '0');
    const wd = new Date(day + 'T00:00:00Z').getUTCDay();
    if (wd === 0 || wd === 6) continue;
    await api0.op('checkins.add', { employment: 'E0016', day, time: '09:00', kind: 'in', note: 'bench' }, { as: 'hr@northwind.test' });
    await api0.op('checkins.add', { employment: 'E0016', day, time: '23:00', kind: 'out', note: 'bench' }, { as: 'hr@northwind.test' });
  }
}
const api = newApi();
const periods = [
  ['2026-10-01', '2026-10-31'],
  ['2026-11-01', '2026-11-30'],
  ['2026-10-01', '2026-10-31'],
  ['2026-09-01', '2026-09-30'],
  ['2026-10-05', '2026-10-11'],
  ['2026-10-16', '2026-11-15'],
  ['2026-12-01', '2026-12-31'],
  ['2026-03-01', '2026-03-31'],
  ['2026-04-01', '2026-04-30'],
  ['2025-11-05', '2026-11-04'],
];
let bad = 0;
for (const [from, to] of periods) {
  const r = await api.op('zstub.pay-bench', { from, to }, { as: 'hr@northwind.test' });
  if (!r.same) bad++;
  console.log(from, to, JSON.stringify({ n: r.n, old: r.old_per_employee_ms, one_best: r.per_employee_ms, one_median: r.per_employee_median_ms, many_best: r.many_per_employee_ms, many_median: r.many_per_employee_median_ms, detail_best: r.detail_per_employee_ms, detail_many_best: r.detail_many_per_employee_ms, compared: r.compared, same: r.same }), r.mismatches.length > 0 ? JSON.stringify(r.mismatches).slice(0, 3000) : '');
}
console.log(bad === 0 ? 'ALL SAME' : bad + ' period(s) differ');
process.exitCode = bad === 0 ? 0 : 1;
