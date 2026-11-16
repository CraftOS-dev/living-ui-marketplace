// Rights: every people-only time op is refused for your AI agent, every
// proposal op becomes a proposal, team scope for managers, view-only roles,
// employees limited to themselves.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { APP, eq, fresh, newApi, ok, refuses, section, serverErrors, summary } from './lib.mjs';

if (process.env.NO_SEED !== '1') fresh({ seed: true });
const api = newApi();
const require = createRequire(import.meta.url);
const hooks = join(APP, 'pb', 'pb_hooks');
const ops = [];
for (const f of readdirSync(hooks).filter((n) => /^cat_time_.*\.js$/.test(n))) for (const o of require(join(hooks, f))) ops.push(o);
const AGENT = { as: 'agent' };
const MON = '2026-11-02';

section('your AI agent: people-only ops');
const deny = ops.filter((o) => o.agent === 'deny');
ok(deny.length >= 15, deny.length + ' time ops are people only');
let refused = 0;
for (const o of deny) {
  const params = {};
  for (const [k, d] of Object.entries(o.params || {})) if (d.required) params[k] = k === 'days' ? '[]' : 'x';
  const r = await api.call(o.name, params, AGENT);
  if (r.status === 403 && r.body.code === 'agent_not_permitted') refused++;
  else ok(false, o.name + ' was not refused for your AI agent', { status: r.status, body: r.body });
}
eq(refused, deny.length, 'all refused with agent_not_permitted');
for (const n of ['clock.punch', 'timesheets.submit', 'attendance-requests.add', 'kiosk.punch', 'kiosk.start', 'kiosk.pin-set', 'overtime-rules.delete', 'attendance.export']) ok(deny.some((o) => o.name === n), n + ' is people only');
for (const o of ops.filter((x) => x.effect === 'confirm')) ok(o.agent === 'deny', o.name + ': confirm ops are people only');

section('your AI agent: proposals');
const propose = ops.filter((o) => o.agent === 'propose');
ok(propose.length >= 10, propose.length + ' time ops become proposals');
const samples = {
  'checkins.add': { employment: 'E0005', day: MON, time: '18:00', kind: 'out', note: 'Sam said he left at six' },
  'attendance.mark': { employment: 'E0006', day: MON, status: 'present', note: 'Client visit' },
  'attendance.mark-bulk': { employments: '["E0007"]', day: MON, status: 'on_duty', note: 'Fair' },
  'attendance.reset': { employment: 'E0006', day: MON },
  'timesheets.save-entries': { employment: 'E0005', week: MON, entries: '[{"day":"2026-11-02","kind":"regular","minutes":480,"project":"Web"}]' },
  'shifts.publish': { week: '2026-11-09' },
  'overtime-rules.save': { entity: 'Northwind Pte Ltd', name: 'Hourly', rules: '[]' },
  'overtime-rules.reset': { entity: 'Northwind Pte Ltd' },
  'shift-types.add': { entity: 'Northwind Pte Ltd', name: 'Night', start: '22:00', end: '06:00' },
  'shift-patterns.save': { entity: 'Northwind Pte Ltd', name: 'P', days: '[""]' },
};
for (const o of propose) {
  const p = samples[o.name];
  if (p === undefined) continue;
  const r = await api.call(o.name, Object.assign({ why: 'test' }, p), AGENT);
  ok(r.status === 200 && typeof r.body.proposal === 'string', o.name + ' became a proposal', r.body);
}
const pl = await api.op('proposals.list', {}, { as: 'hr@northwind.test' });
ok(pl.proposals.length >= 8, 'HR sees the proposals in the Inbox (' + pl.proposals.length + ')');
const day = await api.op('attendance.get', { employment: 'E0006', day: MON }, { as: 'hr@northwind.test' });
ok(day.attendance === null || day.attendance.source !== 'manual', 'nothing was applied');

section('team scope and roles');
const SALES = { as: 'sales.lead@northwind.test' };
await refuses(api, 'attendance.mark', { employment: 'E0005', day: MON, status: 'present', note: 'x' }, SALES, 403, 'not_permitted', 'a manager cannot mark someone outside their team');
const salesBoard = await api.op('attendance.board', {}, SALES);
ok(salesBoard.people.every((p) => ['E0009', 'E0010', 'E0011', 'E0012'].indexOf(p.number) >= 0), 'the sales manager sees the sales team only', salesBoard.people.map((p) => p.number));
await api.op('attendance.mark', { employment: 'E0010', day: MON, status: 'present', note: 'At a client' }, SALES);
ok(true, 'a manager marks their report');
const PAY = { as: 'payroll@northwind.test' };
const pb = await api.op('attendance.board', {}, PAY);
ok(pb.people.length > 20, 'payroll (time view) sees everyone');
await refuses(api, 'attendance.process', {}, PAY, 403, 'not_permitted', 'time view cannot process');
await refuses(api, 'overtime-rules.save', { entity: 'Northwind Pte Ltd', name: 'X' }, PAY, 403, 'not_permitted', 'time view cannot change overtime rules');
await refuses(api, 'kiosk.start', { location: 'Singapore HQ' }, PAY, 403, 'not_permitted', 'time view cannot start a kiosk');
const pc = await api.op('time.payroll-check', { entity: 'Northwind Pte Ltd', from: '2026-10-01', to: '2026-10-31' }, PAY);
ok(pc.people.length >= 8, 'payroll reads hours for payroll');
const SAM = { as: 'sam@northwind.test' };
await refuses(api, 'time.payroll-check', { entity: 'Northwind Pte Ltd' }, SAM, 403, 'not_permitted', 'an employee cannot read payroll hours');
await refuses(api, 'checkins.list', { employment: 'E0006' }, SAM, 403, 'not_permitted', 'an employee cannot list a colleague\'s punches');
await refuses(api, 'shifts.of', { employment: 'E0006' }, SAM, 403, 'not_permitted', 'an employee cannot see a colleague\'s schedule');
const wk = await api.op('shifts.week', {}, SAM);
ok(wk.people.length === 1 && wk.people[0].editable === false && wk.can.edit === false, 'an employee sees only their own row, read only');
const tl = await api.op('timesheets.list', {}, SAM);
ok(tl.timesheets.length === 1, 'an employee lists only their own timesheet');
await refuses(api, 'timesheets.reopen', { employment: 'E0005', week: MON }, { as: 'eng.lead@northwind.test' }, 403, 'not_permitted', 'a manager cannot reopen an approved timesheet (HR does)');
await refuses(api, 'timesheets.submit', { week: MON }, { as: 'owner' }, 403, 'not_permitted', 'nobody submits someone else\'s timesheet');

section('who may ask your AI agent to check timesheets');
await refuses(api, 'timesheets.review-ask', { week: MON }, SAM, 403, 'not_permitted', 'an employee cannot queue a timesheet check');
await refuses(api, 'timesheets.review-ask', { week: MON }, PAY, 403, 'not_permitted', 'time view without a team cannot queue a check');
const mAsk = await api.op('timesheets.review-ask', { week: MON }, SALES);
const teamIds = mAsk.job.payload.people.split(',').filter((x) => x !== '');
const salesIds = salesBoard.people.map((p) => p.employment);
ok(mAsk.job.ref_collection === 'employees' && mAsk.job.payload.team === true && mAsk.job.payload.entity === '', 'a manager\'s ask is a team job', mAsk.job);
ok(teamIds.length >= 2 && teamIds.every((id) => salesIds.indexOf(id) >= 0), 'it names only the manager\'s team (' + teamIds.length + ' people)', { teamIds, salesIds });
const hAsk = await api.op('timesheets.review-ask', { week: MON, entity: 'Northwind Pte Ltd' }, { as: 'hr@northwind.test' });
ok(hAsk.job.ref_collection === 'entities' && hAsk.job.payload.people === '' && hAsk.job.id !== mAsk.job.id, 'HR asks for the entity, a separate job');
const rvTeam = await api.op('time.review', { from: MON, to: '2026-11-08', people: teamIds.join(',') }, AGENT);
ok(rvTeam.people.every((p) => teamIds.indexOf(p.employment) >= 0), 'time.review --people keeps your AI agent to that team');

const errs = serverErrors();
ok(errs.length === 0, 'no server errors logged', errs.slice(0, 8));
const s = summary('t03_permissions');
process.exitCode = s.failed > 0 ? 1 : 0;
