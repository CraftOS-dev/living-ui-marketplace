// payroll-core t06 (QA2 N-1, N-9): a leaver's unused leave paid out on leaving.
// For SG, US-CA, IN, JP (seeded) and AU, GB, MY (made here): a separation is approved,
// leave makes the exit cash-in, the final pay run pays it on LEAVE_EXIT tagged
// exit_leave_payout and termination (never on the salary-like LEAVE_ENCASH),
// and the stored line carries the tags. One locked final pay shows the tags in
// a later payslip's engine history. Off-cycle runs (N-9) have the period's
// locked regular payslip in their history, like bonus runs.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { newApi, fresh, preparePayable, calcRun, section, ok, eq, summary, O, PAY, PAYPIN, byCode, decideAny, APP } from './lib.mjs';

const api = newApi();
fresh({ seed: true });
await preparePayable(api);
const report = {};

async function decideAll(id) {
  for (let i = 0; i < 4; i++) {
    const a = await api.op('approvals.get', { approval: id }, O);
    if (a.approval.status !== 'pending') return a.approval.status;
    await decideAny(api, id, 'approved');
  }
  return (await api.op('approvals.get', { approval: id }, O)).approval.status;
}
function db(sql, ...args) {
  const d = new DatabaseSync(join(APP, 'pb', 'pb_data', 'data.db'), { readOnly: true });
  const rows = d.prepare(sql).all(...args);
  d.close();
  return rows;
}
async function slipOf(runId, employmentId) {
  const got = await api.op('payruns.get', { payrun: runId }, O);
  const row = got.payslips.find((x) => x.employment === employmentId);
  return row ? (await api.op('payslips.get', { payslip: row.id }, O)).payslip : null;
}
async function approveAndLock(runId) {
  const iss = await api.op('payruns.issues', { payrun: runId }, O);
  const blockers = iss.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length > 0) return { blocked: blockers.map((b) => b.code) };
  if (iss.issues.length > 0) await api.op('payruns.acknowledge', { payrun: runId, reason: 'reviewed_ok' }, PAY);
  const sub = await api.op('payruns.submit', { payrun: runId }, PAY);
  await decideAny(api, sub.approval.id, 'approved');
  return api.op('payruns.lock', { payrun: runId }, PAYPIN);
}
async function newCountry(create, entityFields, hire, bank) {
  const ent = (await api.op('entities.add', create, O)).entity;
  await api.op('locations.add', { entity: ent.id, name: create.name + ' office' }, O);
  if (entityFields) await api.op('payroll.settings-save', { entity: ent.id, entity_fields: entityFields }, O);
  const eng = (await api.op('departments.list', {}, O)).departments.find((d) => d.code === 'ENG');
  const loc = (await api.op('locations.list', { entity: ent.id }, O)).locations[0];
  const h = await api.op('people.hire', Object.assign({ entity: ent.id, title: 'Engineer', department: eng.id, location: loc.id, pay_basis: 'salary', work_email: hire.legal_name.toLowerCase().replace(/[^a-z]+/g, '.') + '@' + create.country.toLowerCase() + '.northwind.test' }, hire), O);
  const add = await api.op('bank.add', Object.assign({ employee: h.employee.id, bank_name: 'Test Bank', holder: hire.legal_name }, bank), O);
  if (add.approval && add.approval.status === 'pending') await decideAll(add.approval.id);
  return { ent: ent, employment: h.employment.id, employee: h.employee.id, number: h.employee.number, name: hire.legal_name };
}

/** Approve a separation (last day 15 Dec) and calculate the final pay run it drafts. */
async function leave(cc, who) {
  const sep = await api.op('separations.request', { employment: who.employment, kind: 'resignation', last_day: '2026-12-15', reason: 'Moving on' }, O);
  eq(await decideAll(sep.separation.approval), 'approved', cc + ': ' + who.name + ' resigns, last day 15 Dec');
  let run = null;
  for (const r of (await api.op('payruns.list', { status: 'all', kind: 'termination', limit: 100 }, O)).payruns) {
    const g = (await api.op('payruns.get', { payrun: r.id }, O)).payrun;
    if ((g.scope.employments || []).indexOf(who.employment) >= 0 && g.status !== 'void') run = g;
  }
  ok(run !== null, cc + ': the final pay run is drafted');
  await calcRun(api, run.id);
  const s = await slipOf(run.id, who.employment);
  const exits = ((await api.op('leave.encashments', { employment: who.employment, status: 'all' }, O)).encashments || []).filter((x) => x.kind === 'exit' && x.status === 'approved');
  const lines = [];
  for (const g of s.groups) for (const l of g.lines) lines.push(l);
  const exitLine = lines.filter((l) => l.code === 'LEAVE_EXIT');
  ok(exits.length > 0, cc + ': leave made the exit cash-in (' + exits.map((x) => x.type + ' ' + x.days).join(', ') + ')');
  ok(exitLine.length === exits.length && exitLine.every((l) => l.amount_minor > 0 && l.kind === 'earning'), cc + ': paid on LEAVE_EXIT (' + exitLine.map((l) => l.name + ' ' + l.qty + ' x ' + l.rate + ' = ' + l.amount_minor).join('; ') + ')');
  ok(!lines.some((l) => l.code === 'LEAVE_ENCASH'), cc + ': not on the salary-like LEAVE_ENCASH');
  const stored = db("SELECT tags FROM payslip_lines WHERE payslip = ? AND code = 'LEAVE_EXIT'", s.id).map((r) => JSON.parse(r.tags || '[]'));
  ok(stored.length > 0 && stored.every((t) => t.indexOf('exit_leave_payout') >= 0 && t.indexOf('termination') >= 0), cc + ': the stored line carries exit_leave_payout and termination (' + JSON.stringify(stored[0] || []) + ')');
  const comp = (await api.op('components.list', { entity: run.entity }, O)).components.find((c) => c.code === 'LEAVE_EXIT');
  ok(comp !== undefined && comp.role === 'exit_leave' && stored.every((t) => t.length === comp.tags.length && comp.tags.every((x) => t.indexOf(x) >= 0)), cc + ': the line has LEAVE_EXIT\'s tags from the enabled packs (' + (comp ? comp.tags.join(' ') : 'none') + ')');
  const blockers = (s.issues || []).filter((i) => i.severity === 'blocker');
  ok(blockers.length === 0, cc + ': no blocker on the final pay' + (blockers.length ? ' (' + blockers.map((b) => b.code + ': ' + b.message).join('; ') + ')' : ''));
  report[cc] = { lines: byCode(s), issues: (s.issues || []).map((i) => i.code), tags: stored[0] || [] };
  return { run: run, slip: s, comp: comp };
}

const dir = (await api.op('people.directory', { status: 'current', limit: 500 }, O)).people;
const pick = (entity, re) => dir.find((x) => x.entity_name === entity && re.test(x.name));

section('SG: unused annual leave on leaving, and its tags in a later history');
{
  const who = pick('Northwind Pte Ltd', /Daniel|Hui Min|Nurul/);
  const x = await leave('SG', { employment: who.employment, name: who.name });
  const locked = await approveAndLock(x.run.id);
  ok(locked.payrun && locked.payrun.status === 'locked', 'SG: the final pay locks', locked);
  // A later payment to the leaver: its history has the final payslip's exit tags.
  const comps = (await api.op('components.list', { entity: who.entity }, PAY)).components;
  const code = comps.find((c) => c.role === 'allowance' && !c.archived).code;
  const oc = (await api.op('payruns.create', { kind: 'off_cycle', entity: who.entity, employments: [who.employment], pay_date: '2026-12-15', label: 'Late allowance' }, PAY)).payrun;
  await api.op('pay-inputs.add', { employment: who.employment, component: code, amount: '100.00', payrun: oc.id }, PAY);
  await calcRun(api, oc.id, PAY);
  const row = db('SELECT input FROM payslips WHERE payrun = ? AND employment = ?', oc.id, who.employment)[0];
  const hist = row ? JSON.parse(row.input).history || [] : [];
  ok(hist.some((h) => h.kind === 'termination' && (h.by_tag.exit_leave_payout || 0) > 0 && (h.by_tag.termination || 0) > 0 && (h.by_code.LEAVE_EXIT || 0) > 0), 'SG: a later payslip\'s engine history has the payout under exit_leave_payout and termination', hist.map((h) => h.kind + ' ' + JSON.stringify(h.by_tag)));
}

section('US-CA: unused PTO on leaving');
{
  const x = await leave('US', { employment: pick('Northwind Inc', /Jordan/).employment, name: 'Jordan Reyes' });
  const l = byCode(x.slip);
  ok(x.comp.tags.indexOf('us_supplemental') >= 0 && (l.US_FIT_SUPP || 0) > 0, 'US: the payout is supplemental wages (federal 22%: ' + (l.US_FIT_SUPP || 0) / 100 + ')');
}

section('IN: earned leave on leaving');
{
  const who = pick('Northwind India Pvt Ltd', /Vikram/);
  await leave('IN', { employment: who.employment, name: who.name });
}

section('AU: annual leave on leaving is not ordinary pay');
{
  const au = await newCountry(
    { name: 'Northwind Pty Ltd', code: 'AU01', legal_name: 'Northwind Pty Ltd', country: 'AU', region: 'NSW' },
    { au_concessional_cap: '30000' },
    { legal_name: 'Chloe Taylor', family_name: 'Taylor', given_name: 'Chloe', name_order: 'given_first', birth_date: '1989-12-12', gender: 'female', nationality: 'AU', start_day: '2026-01-05', pay_amount: '8000.00', pay_per: 'month', tax_fields: { au_tfn_provided: true, au_residency: 'resident', au_tax_free_threshold: true } },
    { bank_code: '062-011', number: '10203041', account_type: 'savings' },
  );
  // First pay in HR OS for this entity: nobody was paid earlier this tax year (t07 covers opening balances).
  await api.op('ytd.no-earlier-pay', { entity: au.ent.id, on: true }, O);
  const x = await leave('AU', au);
  const l = byCode(x.slip);
  const sal = l.AU_SALARY || 0;
  eq(l.AU_SG || 0, Math.round(sal * 0.12), 'AU: super is 12% of the salary only, not of the leave payout (' + sal / 100 + ')');
  ok(x.comp.tags.indexOf('au_unused_leave') >= 0 && (l.AU_PAYGW_LEAVE || 0) > 0, 'AU: Schedule 7 withholding on its own line AU_PAYGW_LEAVE (' + (l.AU_PAYGW_LEAVE || 0) / 100 + ')');
}

section('GB: holiday pay on leaving');
{
  const gb = await newCountry(
    { name: 'Northwind UK Ltd', code: 'GB01', legal_name: 'Northwind UK Limited', country: 'GB', region: 'ENG' },
    {},
    { legal_name: 'Oliver Smith', family_name: 'Smith', given_name: 'Oliver', name_order: 'given_first', birth_date: '1993-01-15', gender: 'male', nationality: 'GB', start_day: '2026-01-05', pay_amount: '3000.00', pay_per: 'month', tax_fields: { gb_tax_code: '1257L', gb_basis: 'cumulative', gb_ni_category: 'A', gb_pension_enrolled: true } },
    { bank_code: '200000', number: '12345670', account_type: 'current' },
  );
  // First pay in HR OS for this entity: nobody was paid earlier this tax year (t07 covers opening balances).
  await api.op('ytd.no-earlier-pay', { entity: gb.ent.id, on: true }, O);
  await leave('GB', gb);
}

section('JP: annual leave is not paid out on leaving');
{
  const who = pick('Northwind KK', /Ren|Aoi/);
  const sep = await api.op('separations.request', { employment: who.employment, kind: 'resignation', last_day: '2026-12-15', reason: 'Moving on' }, O);
  eq(await decideAll(sep.separation.approval), 'approved', 'JP: ' + who.name + ' resigns, last day 15 Dec');
  let run = null;
  for (const r of (await api.op('payruns.list', { status: 'all', kind: 'termination', limit: 100 }, O)).payruns) {
    const g = (await api.op('payruns.get', { payrun: r.id }, O)).payrun;
    if ((g.scope.employments || []).indexOf(who.employment) >= 0) run = g;
  }
  await calcRun(api, run.id);
  const sl = await slipOf(run.id, who.employment);
  const l = byCode(sl);
  ok(!l.LEAVE_EXIT && !l.LEAVE_ENCASH, 'JP: no leave payout line (Japan does not pay unused leave out)');
  const blockers = (sl.issues || []).filter((i) => i.severity === 'blocker');
  ok(blockers.length === 0, 'JP: no blocker on the final pay' + (blockers.length ? ' (' + blockers.map((b) => b.code).join(', ') + ')' : ''));
  report.JP = { lines: l, issues: (sl.issues || []).map((i) => i.code) };
}

section('MY: annual leave on leaving');
{
  const my = await newCountry(
    { name: 'Northwind Sdn Bhd', code: 'MY01', legal_name: 'Northwind Sdn. Bhd.', country: 'MY', region: '14' },
    { my_hrdf_rate: '1' },
    { legal_name: 'Lee Chong Wei', family_name: 'Lee', given_name: 'Chong Wei', name_order: 'family_first', birth_date: '1988-08-08', gender: 'male', nationality: 'MY', start_day: '2026-01-05', pay_amount: '8000.00', pay_per: 'month', tax_fields: { my_resident: true, my_pcb_category: '1', my_malaysian: true }, tax_packs: ['my', 'my-hrdf'] },
    { bank_code: 'MBBEMYKL', swift: 'MBBEMYKL', number: '514012345671', account_type: 'savings' },
  );
  // January to November 2026 at 8,000, PCB 577.50 a month, carried in as an opening balance (the year's earlier pay).
  await api.op('ytd.set', { employment: my.employment, day: '2026-11-30', by_tag: JSON.stringify({ my_pcb_normal: 88000 }), by_code: JSON.stringify({ MY_BASIC: 88000, MY_PCB: 6352.5 }), source: 'migration', note: 'January to November 2026' }, O);
  const x = await leave('MY', my);
  // LHDN Steps 1 to 5 on the month of leaving (packs-asia my 2026.4 vector): Step 1 0 (6,145.48 less 6,352.50 paid),
  // Step 2 P 85,178.66, Step 3 tax 6,583.94, Step 4 231.44 rounded up to 5 sen = 231.45.
  eq(byCode(x.slip).MY_PCB || 0, 23145, 'MY: PCB on the final pay is 231.45 with the year\'s earlier pay (LEAVE_EXIT is additional remuneration)');
}

section('N-9: off-cycle runs see the period\'s locked regular payslip, like bonus runs');
for (const [cc, entity, re] of [['US', 'Northwind Inc', /Emily/], ['SG', 'Northwind Pte Ltd', /Sam/]]) {
  const who = pick(entity, re);
  const home = await api.op('payroll.home', {}, O);
  const s = home.schedules.find((x) => x.entity_name === entity);
  const reg = (await api.op('payruns.create', { schedule: s.schedule }, O)).payrun;
  await calcRun(api, reg.id);
  const locked = await approveAndLock(reg.id);
  ok(locked.payrun && locked.payrun.status === 'locked', cc + ': November regular locked', locked);
  const comps = (await api.op('components.list', { entity: who.entity }, PAY)).components;
  const code = comps.find((c) => c.role === 'allowance' && !c.archived).code;
  const oc = (await api.op('payruns.create', { kind: 'off_cycle', entity: who.entity, employments: [who.employment], pay_date: reg.pay_date, label: 'Off-cycle allowance' }, PAY)).payrun;
  await api.op('pay-inputs.add', { employment: who.employment, component: code, amount: '500.00', payrun: oc.id }, PAY);
  await calcRun(api, oc.id, PAY);
  const row = db('SELECT input FROM payslips WHERE payrun = ? AND employment = ?', oc.id, who.employment)[0];
  const hist = row ? JSON.parse(row.input).history || [] : [];
  ok(hist.some((h) => h.kind === 'regular' && h.period_start === reg.period_start && h.pay_date === reg.pay_date), cc + ': the off-cycle payslip has the locked regular payslip of the period in its history', hist.map((h) => h.kind + ' ' + h.pay_date));
}

console.log('\nLines: ' + JSON.stringify(report));
summary('t06_leaver_exit');
