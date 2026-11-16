// Seeded company for the home and reports tests and screenshots (scratch only):
//   node seed_reports.mjs            (HR_PORT 3190, HR_APP as lib.mjs)
// 1) fresh database with tools/dev/seed_demo.mjs (Northwind Global, 24 people)
// 2) the module builders' own demo seeds where present (leave, performance, expenses, hiring, lifecycle)
// 3) reports data: exchange rates, grade ranges, people who joined during the year, leavers with
//    separations, November pay runs locked in two entities, absences and overtime.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { APP, DEMO, emp, fresh, HR, newApi, OWNER, PIN, PORT } from './lib.mjs';

const SCR = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os';
const REF = join(APP, 'reference', 'tests');
const env = Object.assign({}, process.env, { HR_APP: APP, HR_PORT: String(PORT) });
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

fresh({ seed: true });
log('demo seeded');
const api = newApi();
const today = (await api.op('auth.me', {}, OWNER)).today;
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const SCR_LOGS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function runSeed(label, file, cwd) {
  if (!existsSync(file)) return log(label + ' seed not found');
  try {
    execFileSync('node', [file], { env, cwd: cwd || join(file, '..'), stdio: 'pipe', timeout: 600000 });
    log(label + ' seeded');
  } catch (e) {
    log(label + ' seed failed: ' + String(e.stderr || e.message).split('\n').slice(-6).join(' | '));
    writeFileSync(join(SCR_LOGS, 'seed_' + label + '.err'), String(e.stderr || e.message));
  }
}

/* ---------------------------------------------------- exchange rates */
for (const [q, r] of [['SGD', 1.29], ['JPY', 151.2], ['INR', 84.1], ['EUR', 0.92], ['GBP', 0.79]]) await api.op('fx.set', { base: 'USD', quote: q, rate: r, day: '2025-06-01' }, OWNER);
log('rates set');

/* ---------------------------------------------------- module seeds */
runSeed('leave', join(REF, 'leave', 'seed_leave.mjs'));
runSeed('performance', join(REF, 'performance', 'seed_perf.mjs'));
runSeed('expenses', existsSync(join(REF, 'expenses', 'seed_expenses.mjs')) ? join(REF, 'expenses', 'seed_expenses.mjs') : join(SCR, 'expenses', 'tests', 'seed_expenses.mjs'));
runSeed('hiring', existsSync(join(REF, 'hiring', 'seed_hiring.mjs')) ? join(REF, 'hiring', 'seed_hiring.mjs') : join(SCR, 'hiring', 'tests', 'seed_hiring.mjs'));
{
  const f = existsSync(join(REF, 'lifecycle', 'seed_lifecycle.mjs')) ? join(REF, 'lifecycle', 'seed_lifecycle.mjs') : join(SCR, 'lifecycle', 'tests', 'seed_lifecycle.mjs');
  try {
    process.env.HR_APP = APP;
    process.env.HR_PORT = String(PORT);
    const mod = await import('file:///' + f.replace(/\\/g, '/'));
    await mod.seedLifecycle(api);
    log('lifecycle seeded');
  } catch (e) {
    log('lifecycle seed failed: ' + String(e.message || e).slice(0, 300));
  }
}

/* ---------------------------------------------------- grades */
const ents = (await api.op('entities.list', {}, OWNER)).entities;
const ent = (n) => ents.find((e) => e.name === n);
const G = [
  ['SG-3', 'Professional', 'Northwind Pte Ltd', 'SGD', '60000', '100000'],
  ['SG-4', 'Senior professional', 'Northwind Pte Ltd', 'SGD', '95000', '150000'],
  ['SG-5', 'Lead', 'Northwind Pte Ltd', 'SGD', '140000', '230000'],
  ['US-3', 'Professional', 'Northwind Inc', 'USD', '80000', '120000'],
  ['US-4', 'Senior professional', 'Northwind Inc', 'USD', '115000', '190000'],
  ['JP-3', 'Professional', 'Northwind KK', 'JPY', '5000000', '7800000'],
  ['IN-3', 'Professional', 'Northwind India Pvt Ltd', 'INR', '1400000', '2600000'],
];
for (const [code, name, en, cur, lo, hi] of G) await api.op('grades.add', { code, name, entity: ent(en).id, currency: cur, pay_min: lo, pay_max: hi }, OWNER);
const grades = (await api.op('grades.list', {}, OWNER)).grades;
const gid = (c) => grades.find((g) => g.code === c).id;
const GRADE_OF = { 'sam@northwind.test': 'SG-3', 'nurul@northwind.test': 'SG-4', 'huimin@northwind.test': 'SG-3', 'rajesh@northwind.test': 'SG-4', 'eng.lead@northwind.test': 'SG-5', 'payroll@northwind.test': 'SG-3', 'hr@northwind.test': 'SG-4', 'emily@northwind.test': 'US-3', 'marcus@northwind.test': 'US-3', 'sofia@northwind.test': 'US-3', 'ethan@northwind.test': 'US-4', 'sales.lead@northwind.test': 'US-4', 'haruto@northwind.test': 'JP-3', 'yui@northwind.test': 'JP-3', 'aoi@northwind.test': 'JP-3', 'ananya@northwind.test': 'IN-3', 'rohan@northwind.test': 'IN-3', 'kavya@northwind.test': 'IN-3' };
for (const [email, code] of Object.entries(GRADE_OF)) {
  const x = await emp(api, email);
  const r = await api.call('job.update', { employment: x.employment, effective_from: '2026-01-01', reason: 'change', grade: gid(code), note: 'Grades introduced' }, OWNER);
  if (r.status >= 400) log('grade ' + email + ': ' + JSON.stringify(r.body).slice(0, 200));
}
log('grades assigned');

/* ---------------------------------------------------- joiners during the year */
const depts = (await api.op('departments.list', {}, OWNER)).departments;
const dep = (n) => depts.find((d) => d.name === n).id;
const mei = await emp(api, 'eng.lead@northwind.test');
const jordan = await emp(api, 'sales.lead@northwind.test');
const rajesh = await emp(api, 'rajesh@northwind.test');
const HIRES = [
  ['Northwind Pte Ltd', 'Tan Jia Hui', 'Software Engineer', 'Engineering', mei, '7400.00', 'month', '2026-01-12', '1998-03-02', 'female'],
  ['Northwind Inc', 'Liam Walker', 'Account Executive', 'Sales', jordan, '92000.00', 'year', '2026-03-02', '1995-06-21', 'male'],
  ['Northwind Pte Ltd', 'Farah Aziz', 'Operations Associate', 'Operations', rajesh, '4200.00', 'month', '2026-05-18', '2000-01-30', 'female'],
  ['Northwind Inc', 'Noah Bennett', 'Software Engineer', 'Engineering', mei, '128000.00', 'year', '2026-08-03', '1997-09-11', 'male'],
  ['Northwind Pte Ltd', 'Goh Wei Jie', 'Software Engineer', 'Engineering', mei, '7100.00', 'month', '2026-10-05', '1999-12-12', 'male'],
];
const hired = [];
for (const [en, name, title, dn, mgr, amount, per, start, birth, gender] of HIRES) {
  const out = await api.op('people.hire', { entity: ent(en).id, legal_name: name, start_day: start, title, job_title: title, department: dep(dn), manager: mgr.employee, pay_basis: 'salary', pay_amount: amount, pay_per: per, birth_date: birth, gender, nationality: en === 'Northwind Inc' ? 'US' : 'SG' }, OWNER);
  hired.push(out);
}
log('joiners hired');

/* ---------------------------------------------------- leavers with separations */
const LEAVERS = [
  ['marcus@northwind.test', 'resignation', '2026-04-30', 'better_opportunity'],
  ['grace@northwind.test', 'end_of_contract', '2026-07-31', 'contract_end'],
  ['huimin@northwind.test', 'resignation', '2026-09-15', 'relocation'],
];
for (const [email, kind, last, code] of LEAVERS) {
  const x = await emp(api, email);
  const r = await api.call('separations.request', { employment: x.employment, kind, last_day: last, notice_day: add(last, -30), reason: 'Demo leaver', reason_code: code, rehire_eligible: 'yes' }, HR);
  if (r.status >= 400) {
    log('separation ' + email + ': ' + JSON.stringify(r.body).slice(0, 300));
    continue;
  }
  const ap = r.body.approval || (r.body.separation && r.body.separation.approval_id) || null;
  for (let i = 0; i < 4; i++) {
    const pend = await api.op('approvals.list', { view: 'all', status: 'pending', kind: 'separation' }, OWNER);
    if (pend.approvals.length === 0) break;
    for (const a of pend.approvals) {
      for (const as of ['eng.lead@northwind.test', 'sales.lead@northwind.test', 'hr@northwind.test', 'owner']) {
        const d = await api.call('approvals.decide', { approval: a.id, decision: 'approved' }, { as, pin: true });
        if (d.status < 400) break;
      }
    }
  }
  void ap;
}
// One more leaver ended without a separation (counts as not recorded).
{
  const x = await emp(api, 'ren@northwind.test');
  const r = await api.call('employments.end', { employment: x.employment, end_day: '2026-06-30', reason: 'Moved abroad' }, OWNER);
  if (r.status >= 400) log('end ren: ' + JSON.stringify(r.body).slice(0, 200));
}
log('leavers recorded');

/* ---------------------------------------------------- pay runs (November, SG and US) */
try {
  process.env.HR_APP = APP;
  process.env.HR_PORT = String(PORT);
  const pl = await import('file:///' + join(SCR, 'payroll-core', 'tests', 'lib.mjs').replace(/\\/g, '/'));
  await pl.preparePayable(api, {});
  log('payable');
  const PAY = { as: 'payroll@northwind.test' };
  const home = await api.op('payroll.home', {}, OWNER);
  for (const en of ['Northwind Pte Ltd', 'Northwind Inc', 'Northwind KK']) {
    const s = home.schedules.find((x) => x.entity_name === en);
    if (!s) continue;
    const run = (await api.op('payruns.create', { schedule: s.schedule }, OWNER)).payrun;
    await pl.calcRun(api, run.id, OWNER);
    if (en === 'Northwind KK') {
      log('JP run left calculated (shows on Home)');
      continue;
    }
    const iss = await api.op('payruns.issues', { payrun: run.id }, OWNER);
    if (iss.issues.some((i) => i.severity === 'blocker')) {
      log(en + ' run has blockers: ' + iss.issues.filter((i) => i.severity === 'blocker').map((i) => i.code).join(','));
      continue;
    }
    if (iss.issues.length > 0) await api.op('payruns.acknowledge', { payrun: run.id, reason: 'reviewed_ok' }, PAY);
    const sub = await api.op('payruns.submit', { payrun: run.id }, PAY);
    await pl.decideAny(api, sub.approval.id, 'approved');
    await api.op('payruns.lock', { payrun: run.id }, { as: 'payroll@northwind.test', pin: true });
    log(en + ' run locked');
  }
} catch (e) {
  log('payroll seed failed: ' + String(e.message || e).slice(0, 400));
}

/* ---------------------------------------------------- absences and overtime */
try {
  const sam = await emp(api, 'sam@northwind.test');
  const nurul = await emp(api, 'nurul@northwind.test');
  const lastMonth = add(today.slice(0, 7) + '-01', -20).slice(0, 7);
  for (const [x, d] of [[sam, lastMonth + '-09'], [nurul, lastMonth + '-14'], [nurul, lastMonth + '-15']]) {
    const r = await api.call('attendance.mark', { employment: x.employment, day: d, status: 'absent', note: 'No show' }, HR);
    if (r.status >= 400) log('mark: ' + JSON.stringify(r.body).slice(0, 200));
  }
  log('absences marked');
} catch (e) {
  log('absence seed failed: ' + String(e.message || e).slice(0, 300));
}

/* ---------------------------------------------------- your AI agent did some work */
try {
  const q1 = await api.op('questions.ask', { question: 'How many days of annual leave do I have left?', context: 'me' }, { as: 'sam@northwind.test' });
  await api.op('questions.answer', { question: q1.question.id, answer: 'You have 9 days of annual leave available, and 2 more days are booked for December.' }, { as: 'agent' });
  await api.op('questions.ask', { question: 'Can I carry over leave into next year?', context: 'me' }, { as: 'sam@northwind.test' });
  log('agent answers');
} catch (e) {
  log('agent seed failed: ' + String(e.message || e).slice(0, 300));
}
log('done');
void DEMO;
