// A nearly empty company for the empty-database screenshot pass: setup, a manager and an employee with
// employee records, an HR and a payroll member without one. Nothing else.
import { DEMO, fresh, newApi, OWNER, PIN } from './lib.mjs';

fresh();
const api = newApi();
await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const ent = (await api.op('entities.list', {}, OWNER)).entities[0];
const boss = (await api.op('people.hire', { entity: ent.id, legal_name: 'Mona Manager', start_day: '2025-01-06', title: 'Team lead', work_email: 'eng.lead@northwind.test' }, OWNER)).employee;
const emp = (await api.op('people.hire', { entity: ent.id, legal_name: 'Sam Wong', start_day: '2025-03-03', title: 'Engineer', manager: boss.id, work_email: 'sam@northwind.test' }, OWNER)).employee;
for (const [email, name, role, id] of [
  ['eng.lead@northwind.test', 'Mona Manager', 'manager', boss.id],
  ['sam@northwind.test', 'Sam Wong', 'employee', emp.id],
  ['hr@northwind.test', 'Hana HR', 'hr_admin', ''],
  ['payroll@northwind.test', 'Pat Payroll', 'payroll_admin', ''],
]) {
  const inv = await api.op('members.invite', Object.assign({ email, name, role }, id !== '' ? { employee: id } : {}), PIN);
  await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
}
console.log('empty company ready');
