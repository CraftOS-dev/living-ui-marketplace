// QA t05: cross-person reads on the t02 state (seeded demo plus the QA hires
// and locked runs): an employee and a manager must not read other people's
// pay, bank accounts, identity documents or claims; HR and payroll may.
//
//   QA_APP=<qa/app2> QA_PORT=3192 node t05_permissions.mjs
import { newApi, section, ok, summary, writeResult, O } from './lib.mjs';

const api = newApi();
const EMP = { as: 'sam@northwind.test' };
const MGR = { as: 'eng.lead@northwind.test' };
const HR = { as: 'hr@northwind.test' };
const PAY = { as: 'payroll@northwind.test' };
const dir = (await api.op('people.directory', { status: 'all', limit: 500 }, O)).people;
const lim = dir.find((p) => p.number === 'E0008'); // not Sam, not Mei Lin's report chain? (Rajesh's team)
const nurul = dir.find((p) => p.number === 'E0006'); // Mei Lin's direct report
const runs = (await api.op('payruns.list', { limit: 100 }, PAY)).payruns;
const sgRun = runs.find((r) => r.kind === 'regular' && r.currency === 'SGD');
const slips = (await api.op('payruns.get', { payrun: sgRun.id, limit: 100 }, PAY)).payslips;
const slipOf = (n) => slips.find((s) => s.number === n);
const rows = [];
async function expect(label, name, params, who, allowed) {
  const r = await api.call(name, params, who);
  const t = JSON.stringify(r.body || '');
  const leaked = r.status === 200 && /_minor":[1-9]/.test(t) && /net_minor|amount_minor|gross_minor/.test(t);
  rows.push({ label, name, who: who.as, status: r.status, code: r.body && r.body.code, leaked });
  if (allowed) ok(r.status === 200, label + ' (' + r.status + ')', r.body && r.body.message);
  else ok(r.status >= 400 || !leaked, label + ' refused or without pay (' + r.status + ' ' + ((r.body && r.body.code) || '') + ')', r.status === 200 ? t.slice(0, 300) : undefined);
  return r;
}

section('An employee (Sam, E0005) and other people');
await expect('employee reads another person\'s payslip', 'payslips.get', { payslip: slipOf('E0008').id }, EMP, false);
await expect('employee reads own payslip', 'payslips.get', { payslip: slipOf('E0005').id }, EMP, true);
await expect('employee reads another person\'s pay history', 'pay.history', { employment: lim.employment }, EMP, false);
await expect('employee reads another person\'s recent payslips', 'payslips.recent', { employment: lim.employment }, EMP, false);
await expect('employee lists another person\'s bank accounts', 'bank.list', { employee: lim.employee }, EMP, false);
await expect('employee lists another person\'s identity documents', 'ids.list', { employee: lim.employee }, EMP, false);
await expect('employee reads a payrun', 'payruns.get', { payrun: sgRun.id }, EMP, false);
await expect('employee reads the payroll register', 'payreports.register', { payrun: sgRun.id }, EMP, false);
await expect('employee reads another person\'s leave balance', 'leave.balance', { employment: lim.employment, type: 'annual' }, EMP, false);
await expect('employee reads another person\'s tax profile', 'taxprofile.get', { employment: lim.employment }, EMP, false);
await expect('employee reads cost report', 'reports.cost', {}, EMP, false);
const pg = await api.call('people.get', { employee: 'E0008' }, EMP);
ok(pg.status >= 400 || !/pay_records|"pay":\{|amount_minor/.test(JSON.stringify(pg.body)), 'employee people.get of a colleague shows no pay (' + pg.status + ')');

section('A manager (Mei Lin, E0004) and a direct report (Nurul, E0006)');
await expect('manager reads a report\'s payslip (managers see team pay is off by default)', 'payslips.get', { payslip: slipOf('E0006').id }, MGR, false);
await expect('manager reads a non-report\'s payslip', 'payslips.get', { payslip: slipOf('E0008').id }, MGR, false);
await expect('manager reads a report\'s pay history', 'pay.history', { employment: nurul.employment }, MGR, false);
await expect('manager lists a report\'s bank accounts', 'bank.list', { employee: nurul.employee }, MGR, false);
await expect('manager reads a report\'s leave balance', 'leave.balance', { employment: nurul.employment, type: 'annual' }, MGR, true);

section('HR and payroll');
await expect('payroll reads any payslip', 'payslips.get', { payslip: slipOf('E0008').id }, PAY, true);
await expect('HR (payroll view) reads a payslip', 'payslips.get', { payslip: slipOf('E0008').id }, HR, true);
const bl = await api.call('bank.list', { employee: lim.employee }, PAY);
ok(bl.status === 200 && !/0123010/.test(JSON.stringify(bl.body)), 'payroll sees bank accounts masked only', JSON.stringify(bl.body).slice(0, 200));
writeResult('t05_permissions.json', rows);
const s = summary('t05_permissions');
process.exitCode = s.failed > 0 ? 1 : 0;
