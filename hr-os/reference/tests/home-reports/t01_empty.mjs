// Empty database: every home and report read as nobody, the owner (before and after one employee),
// an employee and your AI agent; no 5xx, empty answers, the CSV export of each report.
import { AGENT, DEMO, fresh, newApi, ok, OWNER, READS, refuses, section, summary } from './lib.mjs';

fresh();
const api = newApi();

section('signed out');
for (const [name, params] of READS) await refuses(api, name, params, { as: 'anon' }, 401, undefined, name + ' needs a sign-in');

await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });

async function sweep(label, who) {
  section('empty sweep as ' + label);
  for (const [name, params] of READS) {
    const r = await api.call(name, params, who);
    ok(r.status < 500, `${name} ${JSON.stringify(params)} -> ${r.status}`, r.status >= 500 ? r.body : undefined);
  }
}

await sweep('owner (no people)', OWNER);
await sweep('your AI agent', AGENT);

section('owner answers on an empty company');
const h = await api.op('home.admin', {}, OWNER);
ok(h.readouts.headcount === 0 && h.series.length === 12, 'headcount 0 with 12 months', h.readouts);
ok(Array.isArray(h.attention), 'attention is a list');
ok(h.agent.open === 0 && h.agent.jobs.length === 0, 'agent idle');
const hc = await api.op('reports.headcount', {}, OWNER);
ok(hc.total.every((n) => n === 0) && hc.months.length === 12, 'headcount report all zero');
const dv = await api.op('reports.diversity', {}, OWNER);
ok(dv.total === null && dv.groups.length === 0, 'diversity hides an empty total', dv);
const cost = await api.op('reports.cost', {}, OWNER);
ok(cost.readouts.total_cost_minor === 0, 'no payroll cost yet');
for (const rep of ['headcount', 'movement', 'tenure', 'span', 'diversity', 'comp-bands', 'cost', 'leave-liability', 'absence', 'hiring', 'training']) {
  const r = await api.call('reports.export', { report: rep }, OWNER);
  ok(r.status === 200 && typeof r.body.csv === 'string' && r.body.csv.length > 0, 'export ' + rep, r.status !== 200 ? r.body : undefined);
}
await refuses(api, 'reports.export', { report: 'headcount' }, AGENT, 403, undefined, 'your AI agent cannot export CSV');

section('one employee');
const ent = (await api.op('entities.list', {}, OWNER)).entities[0];
const boss = (await api.op('people.hire', { entity: ent.id, legal_name: 'Mona Manager', start_day: '2025-01-06', title: 'Team lead', work_email: 'eng.lead@northwind.test' }, OWNER)).employee;
const emp = (await api.op('people.hire', { entity: ent.id, legal_name: 'Sam Wong', start_day: '2025-03-03', title: 'Engineer', manager: boss.id, work_email: 'sam@northwind.test' }, OWNER)).employee;
for (const [email, name, role, id] of [
  ['eng.lead@northwind.test', 'Mona Manager', 'manager', boss.id],
  ['sam@northwind.test', 'Sam Wong', 'employee', emp.id],
]) {
  const inv = await api.op('members.invite', { email, name, role, employee: id }, { as: 'owner', pin: true });
  await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
}
await sweep('owner', OWNER);
await sweep('employee', { as: 'sam@northwind.test' });
await sweep('manager', { as: 'eng.lead@northwind.test' });

section('employee and manager homes');
const me = await api.op('home.me', {}, { as: 'sam@northwind.test' });
ok(me.employee !== null && me.employee.name === 'Sam Wong', 'home.me knows the person', me.employee);
ok(me.employments.length === 1 && me.employments[0].manager !== null && me.employments[0].manager.name === 'Mona Manager', 'employment with the manager', me.employments);
ok(Array.isArray(me.facts), 'module facts are a list');
const mg = await api.op('home.manager', {}, { as: 'eng.lead@northwind.test' });
ok(mg.manager === true && mg.team === 1 && mg.direct === 1, 'manager team of one', mg);
const mgSam = await api.op('home.manager', {}, { as: 'sam@northwind.test' });
ok(mgSam.manager === false && mgSam.people.length === 0, 'no team for an employee');
await refuses(api, 'home.admin', {}, { as: 'sam@northwind.test' }, 403, undefined, 'employee cannot open the admin home');
await refuses(api, 'reports.headcount', {}, { as: 'sam@northwind.test' }, 403, undefined, 'employee cannot run reports');
await refuses(api, 'reports.cost', {}, { as: 'eng.lead@northwind.test' }, 403, undefined, 'manager cannot see payroll cost');
const h2 = await api.op('home.admin', {}, OWNER);
ok(h2.readouts.headcount === 2, 'owner home counts 2 people', h2.readouts);
const sp = await api.op('reports.span', {}, OWNER);
ok(sp.readouts.managers === 1 && sp.table.rows[0].direct === 1, 'span: one manager with one report', sp.readouts);
const dv2 = await api.op('reports.diversity', {}, OWNER);
ok(dv2.total === null && dv2.groups.every((g) => g.count === null), 'two people: every group hidden', dv2.groups);

const s = summary('t01_empty');
process.exit(s.failed === 0 ? 0 : 1);
