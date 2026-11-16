// A 300-person company for the time module's scale checks (as QA t04 builds
// it, only through operations): one Singapore entity, 5 departments, 300
// hires with managers, HR, manager and employee members, a week of auto
// attendance and today's punches for a third of the people. Then the database
// is kept in SCR/time/snap300 so later runs start from it (--restore).
//   node scale_seed.mjs [--restore]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { APP, PORT, DEMO, newApi, dayAdd } from './lib.mjs';

const SNAP = join(APP, '..', 'snap300');
const DATA = join(APP, 'pb', 'pb_data');
const dev = (s, ...a) => execFileSync('bash', [join(APP, 'tools', 'dev', s), ...a], { stdio: 'pipe' }).toString();

if (process.argv.includes('--restore')) {
  if (!existsSync(SNAP)) throw new Error('no snapshot at ' + SNAP);
  dev('stop.sh', String(PORT));
  dev('reset.sh', APP);
  cpSync(SNAP, DATA, { recursive: true });
  dev('serve.sh', APP, String(PORT));
  console.log('restored the 300-person database');
  process.exit(0);
}

dev('stop.sh', String(PORT));
dev('reset.sh', APP);
dev('serve.sh', APP, String(PORT));
const api = newApi();
const O = { as: 'owner' };
const PIN = { as: 'owner', pin: true };
const N = Number(process.env.SCALE_N || 300);
const t0 = Date.now();
await api.op('setup.complete', { company_name: 'Scale Co', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const ent = (await api.op('entities.list', {}, O)).entities[0];
const loc = (await api.op('locations.add', { entity: ent.id, name: 'HQ', lat: 1.284, lng: 103.851, radius_m: 150 }, O)).location;
const depts = [];
for (const [n, c] of [['Engineering', 'ENG'], ['Sales', 'SAL'], ['Operations', 'OPS'], ['Finance', 'FIN'], ['People', 'PPL']]) depts.push((await api.op('departments.add', { name: n, code: c }, O)).department);
const hired = [];
for (let i = 0; i < N; i++) {
  const mgr = i < 10 ? (i === 0 ? '' : hired[0].employee.id) : hired[i % 10].employee.id;
  const out = await api.op(
    'people.hire',
    {
      entity: ent.id, legal_name: 'Person ' + String(i + 1).padStart(3, '0') + ' Scale', family_name: 'Scale', given_name: 'Person ' + (i + 1), name_order: 'given_first',
      birth_date: String(1970 + (i % 35)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9), gender: i % 2 ? 'female' : 'male', nationality: 'SG', start_day: '2024-0' + (1 + (i % 9)) + '-01',
      title: 'Staff', department: depts[i % 5].id, location: loc.id, manager: mgr, pay_basis: 'salary', pay_amount: String(3000 + ((i * 37) % 12000)) + '.00', pay_per: 'month',
      tax_fields: { sg_residency: 'sc', sg_shg: i % 4 === 0 ? 'cdac' : 'none' }, work_email: 'p' + i + '@scale.test',
    },
    O,
  );
  hired.push(out);
  if ((i + 1) % 50 === 0) console.log('hired ' + (i + 1) + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
}
async function member(email, name, role, employee) {
  const p = { email, name, role };
  if (employee) p.employee = employee;
  const inv = await api.op('members.invite', p, PIN);
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: email });
}
await member('hr@scale.test', 'Hana HR', 'hr_admin');
await member('mgr@scale.test', 'Mia Manager', 'manager', hired[1].employee.id);
await member('emp@scale.test', 'Eli Employee', 'employee', hired[42].employee.id);
// Punch tracking (so the board has states), a week of auto attendance, today's punches for a third.
const HR = { as: 'hr@scale.test' };
const rs = (await api.op('overtime-rules.list', { entity: ent.id }, HR)).rule_sets || [];
if (rs[0]) await api.call('overtime-rules.save', { rule_set: rs[0].id, settings: Object.assign({}, rs[0].settings, { tracking: 'punch' }) }, HR);
const today = (await api.op('attendance.board', {}, HR)).today;
for (let i = 0; i < N; i += 3) {
  const e = hired[i].employment.id;
  await api.call('checkins.add', { employment: e, day: today, time: i % 9 === 0 ? '09:40' : '08:55', kind: 'in', note: 'scale' }, HR);
  if (i % 6 === 0) await api.call('checkins.add', { employment: e, day: today, time: '12:30', kind: 'break_start', note: 'scale' }, HR);
}
await api.op('attendance.process', { from: dayAdd(today, -7), to: today }, HR);
console.log('seeded ' + N + ' people in ' + Math.round((Date.now() - t0) / 1000) + ' s');
dev('stop.sh', String(PORT));
if (existsSync(SNAP)) rmSync(SNAP, { recursive: true, force: true });
mkdirSync(SNAP, { recursive: true });
cpSync(DATA, SNAP, { recursive: true });
dev('serve.sh', APP, String(PORT));
console.log('kept ' + SNAP);
