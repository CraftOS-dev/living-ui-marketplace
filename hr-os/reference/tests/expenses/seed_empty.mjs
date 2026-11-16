// An empty company for the empty-database screens: the owner, a manager and an employee, no expenses.
//   node seed_empty.mjs   (on a freshly reset scratch server)
import { DEMO, newApi } from './lib.mjs';

const api = newApi();
const O = { as: 'owner' };
await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const ent = (await api.op('entities.list', {}, O)).entities[0];
const boss = await api.op('people.hire', { entity: ent.id, legal_name: 'Bo Manager', start_day: '2025-01-06', work_email: 'boss@empty.test' }, O);
const eve = await api.op('people.hire', { entity: ent.id, legal_name: 'Eve Employee', start_day: '2026-01-05', work_email: 'eve@empty.test', manager: boss.employee.id }, O);
for (const [email, name, role, emp] of [['boss@empty.test', 'Bo Manager', 'manager', boss], ['eve@empty.test', 'Eve Employee', 'employee', eve]]) {
  const inv = await api.op('members.invite', { email, name, role, employee: emp.employee.id }, { as: 'owner', pin: true });
  await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
}
console.log('empty company ready');
