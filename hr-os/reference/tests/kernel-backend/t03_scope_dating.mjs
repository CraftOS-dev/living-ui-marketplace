// Seeded: roles and team scope, pay visibility, effective dating (past,
// today, future), Update vs Edit, the people and calendar contracts, and a
// read sweep as every role.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, fresh, newApi, ok, refuses, sample, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const MGR = { as: 'eng.lead@northwind.test' };
const SAM = { as: 'sam@northwind.test' };
const HR = { as: 'hr@northwind.test' };
const PAY = { as: 'payroll@northwind.test' };

const all = (await api.op('people.directory', { status: 'all', limit: 100 }, O)).people;
const byEmail = {};
for (const p of all) byEmail[p.work_email] = p;
const sam = byEmail['sam@northwind.test'];
const ceo = byEmail['owner@northwind.test'];
const sg6 = byEmail['nurul@northwind.test'];
const emily = byEmail['emily@northwind.test'];
const arjun = byEmail['arjun@northwind.test'];

section('team scope');
eq(all.length, 24, 'owner sees all 24 people');
eq((await api.op('people.directory', { limit: 100 }, HR)).total, 23, 'HR admin sees the 23 current people (one starts later)');
eq((await api.op('people.directory', { limit: 100 }, PAY)).total, 23, 'payroll admin (people view) sees them too');
const mine = await api.op('people.directory', { limit: 100 }, MGR);
eq(mine.total, 8, 'manager sees self and 7 direct and indirect reports');
ok(mine.people.every((p) => p.work_email !== 'emily@northwind.test'), 'manager does not see the sales team');
const own = await api.op('people.directory', {}, SAM);
eq(own.people.map((p) => p.work_email), ['sam@northwind.test'], 'employee sees only themself');
await refuses(api, 'people.get', { employee: emily.number }, MGR, 403, 'not_permitted', 'manager cannot open someone outside the team');
await refuses(api, 'people.get', { employee: ceo.number }, SAM, 403, 'not_permitted', 'employee cannot open someone else');
const teamView = await api.op('people.get', { employee: sam.number }, MGR);
eq(teamView.access, 'team', 'manager sees a report with team access');
ok(teamView.employee.birth_date === undefined && teamView.bank_accounts === undefined, 'team access hides personal details, bank and IDs');
ok(teamView.employments[0].pay === null && teamView.employments[0].pay_hidden === true, 'manager does not see team pay by default');
const selfView = await api.op('people.get', { employee: sam.number }, SAM);
eq(selfView.access, 'self', 'employee sees themself');
ok(selfView.employments[0].pay !== null && selfView.employments[0].pay.amount === '7800.00', 'employee sees their own pay', selfView.employments[0].pay);
await api.op('settings.update', { managers_see_pay: true }, O);
ok((await api.op('people.get', { employee: sam.number }, MGR)).employments[0].pay !== null, 'with managers_see_pay the manager sees team pay');
await api.op('settings.update', { managers_see_pay: false }, O);
await refuses(api, 'people.update', { employee: sam.number, legal_name: 'Samuel Wong' }, SAM, 403, 'not_permitted', 'employee cannot change their legal name');
const selfEdit = await api.op('people.update', { employee: sam.number, phone: '+65 8123 4567', emergency: [{ name: 'Wong Mei', relation: 'mother', phone: '+65 9111 2222' }] }, SAM);
eq(selfEdit.employee.phone, '+65 8123 4567', 'employee changes their own phone and emergency contacts');
await refuses(api, 'job.update', { employment: sam.employment, reason: 'change', title: 'CTO' }, SAM, 403, 'not_permitted', 'employee cannot change their job');
await refuses(api, 'pay.history', { employment: sam.employment }, MGR, 403, 'not_permitted', 'manager cannot read pay history');
const scoped = await api.op('members.invite', { email: 'jp.hr@northwind.test', name: 'Japan HR', role: 'hr_admin', entities: ['Northwind KK'] }, { as: 'owner', pin: true });
const jpJoin = await api.op('auth.accept-invite', { email: 'jp.hr@northwind.test', code: scoped.code, password: 'demo-pass-1' });
api.setToken('jp.hr@northwind.test', jpJoin.token);
const jpDir = await api.op('people.directory', { limit: 100 }, { as: 'jp.hr@northwind.test' });
ok(jpDir.total === 5 && jpDir.people.every((p) => p.entity_name === 'Northwind KK'), 'an HR admin limited to one entity sees only its 5 people', jpDir.people.map((p) => p.entity_name));
await refuses(api, 'people.get', { employee: sam.number }, { as: 'jp.hr@northwind.test' }, 403, 'not_permitted', 'and cannot open someone of another entity');

section('effective dating');
const before = await api.op('people.get', { employee: sam.number, as_of: '2026-11-04' }, O);
eq(before.employments[0].pay.amount, '7800.00', 'pay today');
eq(before.employments[0].upcoming.map((x) => x.kind + ' ' + x.effective_from), ['pay 2027-01-01'], 'the raise shows as scheduled');
const future = await api.op('people.get', { employee: sam.number, as_of: '2027-02-01' }, O);
eq(future.employments[0].pay.amount, '8400.00', 'pay as of a future day');
const past = await api.op('people.get', { employee: sg6.number, as_of: '2023-06-01' }, O);
eq(past.employments[0].job.reason, 'hire', 'job as of a past day is the hire record');
eq((await api.op('people.get', { employee: sg6.number }, O)).employments[0].job.reason, 'promotion', 'job today is the promotion');
const hist = await api.op('pay.history', { employment: sam.employment }, O);
eq(hist.records.map((r) => r.state), ['current', 'scheduled'], 'pay history states');
const dir2023 = await api.op('people.directory', { as_of: '2023-01-01', limit: 100 }, O);
ok(dir2023.total < 24 && dir2023.people.every((p) => p.start_day <= '2023-01-01'), 'directory as of 2023-01-01 shows who was employed then (' + dir2023.total + ')');
eq((await api.op('people.directory', { status: 'upcoming' }, O)).people.map((p) => p.work_email), ['arjun@northwind.test'], 'upcoming hires');
ok(arjun.status === 'pre_hire' && arjun.employment_status === 'pre_hire', 'a future hire is pre_hire');

section('Update vs Edit');
const up = await api.op('job.update', { employment: sam.employment, effective_from: '2026-12-01', reason: 'transfer', department: 'Operations', note: 'Moves to the operations team' }, HR);
eq(up.record.department_name, 'Operations', 'Update adds a dated row (transfer)');
eq(up.record.title, 'Software Engineer', 'fields not given carry over');
await refuses(api, 'job.update', { employment: sam.employment, effective_from: '2026-12-01', reason: 'change', title: 'X' }, HR, 409, 'exists', 'a second row on the same day is refused (edit it instead)');
await refuses(api, 'job.update', { employment: sam.employment, title: 'X' }, HR, 400, 'missing_param', 'Update needs a reason');
const jh = await api.op('job.history', { employment: sam.employment }, HR);
eq(jh.records.length, 2, 'two job rows (history kept)');
const hireRow = jh.records[0];
// The seed locks an October run: rows it used are refused; Arjun (starts in December) was in none.
await refuses(api, 'job.edit', { record: hireRow.id, title: 'Software Engineer II' }, HR, 409, 'locked', 'Edit of a row a locked run used is refused (Sam, October run)');
const arjunRow = (await api.op('job.history', { employment: arjun.employment }, HR)).records[0];
const edit = await api.op('job.edit', { record: arjunRow.id, title: 'Operations Lead' }, HR);
eq(edit.record.title, 'Operations Lead', 'Edit corrects the row in place');
const editAudit = await api.op('audit.list', { collection: 'job_records', record: arjunRow.id }, O);
ok(editAudit.entries.length > 0 && editAudit.entries[0].before.title === 'Operations Associate' && editAudit.entries[0].after.title === 'Operations Lead', 'the audit row has before and after');
const ceoJob = (await api.op('job.history', { employment: ceo.employment }, O)).records[0];
await refuses(api, 'job.edit', { record: ceoJob.id, title: 'Founder' }, O, 409, 'locked', 'Edit is refused when a module blocks it (used by a locked run)');
await refuses(api, 'job.delete', { record: hireRow.id }, HR, 409, 'not_scheduled', 'only scheduled rows can be removed');
eq((await api.op('job.delete', { record: up.record.id }, HR)).deleted, true, 'a scheduled row can be removed');
const payUp = await api.op('pay.update', { employment: emily.employment, effective_from: '2026-11-01', reason: 'raise', amount: '102000.00' }, PAY);
eq(payUp.record.amount_minor, 10200000, 'pay update in minor units (USD cents)');
await refuses(api, 'pay.update', { employment: emily.employment, effective_from: '2026-11-15', reason: 'raise', amount: '1.005' }, PAY, 400, 'invalid_amount', 'too many decimals refused');
await refuses(api, 'pay.update', { employment: emily.employment, reason: 'raise', amount: '100' }, HR, 403, 'not_permitted', 'HR admin (payroll view) cannot change pay');
const jpPay = await api.op('pay.history', { employment: byEmail['haruto@northwind.test'].employment }, O);
eq(jpPay.records[0].amount_minor, 520000, 'JPY has no minor unit');
const tax = await api.op('tax.update', { employment: sam.employment, fields: { test_field: 'x' }, effective_from: '2026-11-04' }, SAM);
eq(tax.record.fields.test_field, 'x', 'a person updates their own tax profile');

section('contracts');
const c = await api.op('testkit.contract', { employment: sam.employment, day: '2026-08-10', from: '2026-08-01', to: '2026-08-31' }, O);
eq(c.manager.name, 'Mei Lin Chua', 'managerOf');
eq(c.age, 30, 'ageOn');
eq(c.working.count, 20, 'workingDays in August 2026 (Singapore, National Day observed)');
ok(c.working.holidays.some((h) => h.day === '2026-08-10'), 'the observed holiday is listed');
eq(c.expected, 0, 'expectedMinutes on a holiday is 0');
ok(c.holiday && c.holiday.day === '2026-08-10', 'isHoliday');
eq(c.calendar.code, 'SG', 'calendarOf');
ok(c.schedule && c.schedule.hours_per_week === 40, 'scheduleOf (40 hours)', c.schedule);
ok(c.asOf.employee.id === sam.employee && c.asOf.entity.country === 'SG' && c.asOf.job && c.asOf.pay && c.asOf.tax, 'asOf returns employee, entity, job, pay, tax');
const c2 = await api.op('testkit.contract', { employment: sam.employment, day: '2026-08-11' }, O);
eq(c2.expected, 480, 'expectedMinutes on a working day (09:00 to 18:00, 60 min break)');
const mgr = await api.op('testkit.contract', { employment: byEmail['eng.lead@northwind.test'].employment, day: '2026-11-04' }, O);
eq(mgr.reports.length, 7, 'reportsOf deep');
const jp = await api.op('testkit.contract', { employment: byEmail['haruto@northwind.test'].employment, day: '2026-05-06', from: '2026-05-01', to: '2026-05-08' }, O);
eq(jp.working.count, 3, 'Golden Week in Tokyo: 3 working days from May 1 to 8');
ok(jp.localNow.zone === 'Asia/Tokyo' && jp.localNow.offset === 540, 'local time in the entity zone', jp.localNow);
const usc = await api.op('testkit.contract', { employment: emily.employment, day: '2026-07-01' }, O);
ok(usc.localNow.zone === 'America/Los_Angeles' && (usc.localNow.offset === -480 || usc.localNow.offset === -420), 'US entity local time with daylight saving', usc.localNow);

section('read sweep, seeded');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');
const ctx = { employee: sam.number, employment: sam.employment, entity: 'Northwind Pte Ltd', calendar: 'SG' };
for (const as of ['owner', 'eng.lead@northwind.test', 'sam@northwind.test', 'hr@northwind.test', 'agent']) {
  const bad = [];
  const st = {};
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as });
    st[r.status] = (st[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, as + ': no 5xx ' + JSON.stringify(st), bad);
}

const s = summary('t03_scope_dating');
process.exitCode = s.failed > 0 ? 1 : 0;
