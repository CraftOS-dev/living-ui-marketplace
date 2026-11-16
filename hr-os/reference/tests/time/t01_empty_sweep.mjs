// Empty database: every time read op answers without a server error, as
// nobody, the owner, an employee without an employee record, an employee
// with one, and your AI agent. The entity got its overtime rules and a shift type.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { APP, DEMO, eq, fresh, newApi, ok, refuses, section, serverErrors, summary } from './lib.mjs';

fresh();
const api = newApi();
const require = createRequire(import.meta.url);
const hooks = join(APP, 'pb', 'pb_hooks');
const mine = new Set();
for (const f of readdirSync(hooks).filter((n) => /^cat_time_.*\.js$/.test(n))) for (const o of require(join(hooks, f))) mine.add(o.name);
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => mine.has(o.name) && o.executor.method === 'GET');
ok(reads.length >= 25, 'time read ops found: ' + reads.length);

function sample(k, ctx) {
  const m = { employment: ctx.employment || 'E0001', employee: ctx.employee || 'E0001', entity: ctx.entity || 'Empty Co', country: 'JP', code: 'NOPE1234', days: '[{"day":"2026-11-02","kind":"work","worked":600}]' };
  return m[k] ?? 'x';
}

async function sweep(as, ctx, label) {
  const statuses = {};
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as });
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, label + ': ' + reads.length + ' reads, no 5xx ' + JSON.stringify(statuses), bad);
}

section('before setup');
await sweep('anon', {}, 'nobody signed in');

section('setup');
await api.op('setup.complete', { company_name: 'Empty Co', country: 'JP', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const rs = await api.op('overtime-rules.list', {}, { as: 'owner' });
eq(rs.rule_sets.length, 1, 'the first entity got its overtime rules on entity.created');
eq(rs.rule_sets[0].country, 'JP', 'Japanese defaults');
ok(rs.rule_sets[0].rules.some((r) => r.component === 'NIGHT25') && rs.rule_sets[0].caps.monthly_warn === 2700, 'night premium and the 36 agreement caps are there');
const st = await api.op('shift-types.list', {}, { as: 'owner' });
eq(st.shift_types.length, 1, 'a first shift type from the work week');

section('empty sweeps');
await sweep('owner', {}, 'owner');
const board = await api.op('attendance.board', {}, { as: 'owner' });
eq(board.people.length, 0, 'board empty');
const wk = await api.op('shifts.week', {}, { as: 'owner' });
ok(wk.people.length === 0 && wk.shift_types.length === 1, 'week grid empty, the shift type palette is offered');
const inv = await api.op('members.invite', { email: 'emp@northwind.test', name: 'Erin Employee', role: 'employee' }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: 'emp@northwind.test', code: inv.code, password: DEMO.password });
api.setToken('emp@northwind.test', joined.token);
await sweep('emp@northwind.test', {}, 'employee without an employee record');
await refuses(api, 'clock.punch', {}, { as: 'emp@northwind.test' }, 409, 'no_employee', 'no employee record: the clock says so');
await sweep('agent', {}, 'your AI agent');

section('one person, no punches yet');
const ent = (await api.op('entities.list', {}, { as: 'owner' })).entities[0];
const boss = await api.op('people.hire', { entity: ent.id, legal_name: 'Takahashi Kenji', family_name: 'Takahashi', given_name: 'Kenji', name_order: 'family_first', start_day: '2026-09-01', title: 'Lead', work_email: 'kenji@empty.test' }, { as: 'owner' });
const hired = await api.op('people.hire', { entity: ent.id, legal_name: 'Sato Haruto', family_name: 'Sato', given_name: 'Haruto', name_order: 'family_first', start_day: '2026-10-01', title: 'Engineer', work_email: 'haruto@empty.test', manager: boss.employee.id }, { as: 'owner' });
const invB = await api.op('members.invite', { email: 'kenji@empty.test', name: 'Kenji', role: 'manager', employee: boss.employee.id }, { as: 'owner', pin: true });
const jB = await api.op('auth.accept-invite', { email: 'kenji@empty.test', code: invB.code, password: DEMO.password });
api.setToken('kenji@empty.test', jB.token);
const inv2 = await api.op('members.invite', { email: 'haruto@empty.test', name: 'Haruto', role: 'employee', employee: hired.employee.id }, { as: 'owner', pin: true });
const j2 = await api.op('auth.accept-invite', { email: 'haruto@empty.test', code: inv2.code, password: DEMO.password });
api.setToken('haruto@empty.test', j2.token);
const ctx = { employment: hired.employment.number, employee: hired.employee.number, entity: ent.id };
await sweep('owner', ctx, 'owner with one person');
await sweep('haruto@empty.test', ctx, 'the person themself');
await sweep('kenji@empty.test', ctx, 'their manager');
const mb = await api.op('attendance.board', {}, { as: 'kenji@empty.test' });
ok(mb.people.some((p) => p.number === hired.employee.number), 'the manager sees the report on the board');
await sweep('agent', ctx, 'your AI agent with one person');
const cs = await api.op('clock.status', {}, { as: 'haruto@empty.test' });
ok(cs.state === 'out' && cs.next[0] === 'in', 'clock: out, next is clock in');
const pg = await api.op('people.get', { employee: hired.employee.number }, { as: 'owner' });
const tf = pg.facts.find((f) => f.module === 'time');
ok(tf && Array.isArray(tf.facts) && tf.facts.length > 0, 'the profile shows time facts', pg.facts);
const ts = await api.op('timesheets.mine', {}, { as: 'haruto@empty.test' });
ok(ts.timesheet.id === '' && ts.timesheet.status === 'draft', 'a timesheet is computed without writing anything');
const pi = await api.op('time.pay-inputs', { employment: ctx.employment, from: '2026-10-01', to: '2026-10-31' }, { as: 'owner' });
ok(pi.worked_minutes > 0 && pi.absent_days === 0, 'exception tracking: October counts as worked without punches, no absences', { worked: pi.worked_minutes, absent: pi.absent_days });
const errs = serverErrors();
ok(errs.length === 0, 'no server errors logged', errs.slice(0, 5));

const s = summary('t01_empty_sweep');
process.exitCode = s.failed > 0 ? 1 : 0;
