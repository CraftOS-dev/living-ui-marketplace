// Leave data on top of tools/dev/seed_demo.mjs, for screenshots and manual looks:
// approved and waiting requests this month and next, a locked week, a cash-in
// and compensatory leave waiting. Everything through operations.
import { api } from './lib.mjs';

const today = (await api.op('auth.me', {}, { as: 'owner' })).today;
const add = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const wd = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const next = (d, dow) => {
  let x = d;
  while (wd(x) !== dow) x = add(x, 1);
  return x;
};
const HR = { as: 'hr@northwind.test' };
const mon = next(add(today, 1), 1);
const emp = async (n) => (await api.op('people.get', { employee: n }, { as: 'owner' })).primary_employment;
const rec = async (n, type, start, end, extra) => api.op('leave.request', Object.assign({ employment: await emp(n), type, start, end, record: true, reason: 'Recorded for the demo' }, extra || {}), HR);
const ask = async (as, type, start, end, extra) => api.op('leave.request', Object.assign({ type, start, end }, extra || {}), { as });

// Out today and this week.
await rec('E0006', 'annual', add(today, -1), add(today, 2));
await rec('E0010', 'pto', today, add(today, 1));
await rec('E0017', 'annual', today, today);
await rec('E0022', 'sick', today, today);
await rec('E0008', 'sick', add(today, 1), add(today, 1), { start_half: 'am' });
// Coming weeks.
await rec('E0013', 'pto', mon, add(mon, 4));
await rec('E0019', 'annual', add(mon, 7), add(mon, 9));
await rec('E0004', 'annual', add(mon, 14), add(mon, 18));
// Waiting for decisions.
await ask('sam@northwind.test', 'annual', add(mon, 2), add(mon, 3), { reason: 'Moving house' });
await ask('haruto@northwind.test', 'annual', add(mon, 8), add(mon, 8), { start_half: 'pm' });
await ask('ananya@northwind.test', 'casual', add(mon, 1), add(mon, 1));
// A locked week for Engineering.
const eng = (await api.op('departments.list', {}, { as: 'owner' })).departments.find((d) => d.code === 'ENG');
await api.op('leave.block-save', { department: eng.id, from: add(mon, 21), to: add(mon, 25), reason: 'Release week' }, HR);
// Cash-in and compensatory leave waiting.
await api.op('leave.encash-request', { type: 'annual', days: 2, reason: 'Year-end' }, { as: 'sam@northwind.test' });
await api.op('leave.comp-off-request', { worked_day: add(today, -3), days: 1, reason: 'Weekend release' }, { as: 'haruto@northwind.test' });
console.log('leave demo data ready (week from ' + mon + ')');
