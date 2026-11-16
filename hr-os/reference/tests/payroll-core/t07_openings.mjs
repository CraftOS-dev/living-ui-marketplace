// payroll-core t07: the first pay run in a tax year that began earlier (QA3 major) and payroll's
// personal fields (QA3 payslip drawer).
// New entities (US-CA, IN, SG, MY, AU) whose people were employed before HR OS this tax year:
// their first November run is blocked by ONE opening_balances_missing blocker per entity (the
// pack's own history_short and MY's year history blocker fold into it); ytd.sheet lists the
// people with the figures their packs read; a CSV dry run, the import and a single save fill
// them; then the run calculates with the year to date (US FUTA, CA UI and ETT not charged again,
// India's TDS spread over the rest of the year, Singapore's AW ceiling). The per-entity "nobody
// was paid earlier" switch is people only. payroll.person-set sets only the fields packs read.
// Env: HR_APP, HR_PORT; NO_FRESH=1 reuses a seeded server.
import { newApi, fresh, calcRun, section, ok, eq, refuses, summary, O, PAY, byCode, decideAny } from './lib.mjs';

const api = newApi();
if (process.env.NO_FRESH !== '1') fresh({ seed: true });
const AGENT = { as: 'agent' };
const HR = { as: 'hr@northwind.test' };
const report = {};

async function decideAll(id) {
  for (let i = 0; i < 4; i++) {
    const a = await api.op('approvals.get', { approval: id }, O);
    if (a.approval.status !== 'pending') return a.approval.status;
    await decideAny(api, id, 'approved');
  }
  return (await api.op('approvals.get', { approval: id }, O)).approval.status;
}
/** A new entity of a country with its packs' employer defaults, one location, and people hired into it. */
async function newEntity(create, people) {
  const ent = (await api.op('entities.add', create, O)).entity;
  await api.op('locations.add', { entity: ent.id, name: create.name + ' office' }, O);
  const ef = (await api.op('payroll.fields', { entity: ent.id, scope: 'entity' }, PAY)).fields || [];
  const values = {};
  for (const f of ef) if (f.default !== undefined && f.default !== null) values[f.key] = f.default;
  if (Object.keys(values).length > 0) await api.op('payroll.settings-save', { entity: ent.id, entity_fields: values }, PAY);
  const eng = (await api.op('departments.list', {}, O)).departments.find((d) => d.code === 'ENG');
  const loc = (await api.op('locations.list', { entity: ent.id }, O)).locations[0];
  const out = [];
  for (const p of people) {
    const h = await api.op('people.hire', Object.assign({ entity: ent.id, title: 'Engineer', department: eng.id, location: loc.id, pay_basis: 'salary', work_email: p.hire.legal_name.toLowerCase().replace(/[^a-z]+/g, '.') + '@' + create.country.toLowerCase() + '.northwind.test' }, p.hire), O);
    const add = await api.op('bank.add', Object.assign({ employee: h.employee.id, bank_name: 'Test Bank', holder: p.hire.legal_name }, p.bank), O);
    if (add.approval && add.approval.status === 'pending') await decideAll(add.approval.id);
    out.push({ employment: h.employment.id, number: h.employee.number, name: p.hire.legal_name });
  }
  return { ent, people: out };
}
async function novemberRun(entityId) {
  const home = await api.op('payroll.home', {}, O);
  const s = home.schedules.find((x) => x.entity === entityId);
  return (await api.op('payruns.create', { schedule: s.schedule, period_start: '2026-11-01' }, PAY)).payrun;
}
async function slipOf(runId, employmentId) {
  const got = await api.op('payruns.get', { payrun: runId }, O);
  const row = got.payslips.find((x) => x.employment === employmentId);
  return row ? (await api.op('payslips.get', { payslip: row.id }, O)).payslip : null;
}
const codes = (list) => list.map((i) => i.code);
async function blockers(runId) {
  return (await api.op('payruns.issues', { payrun: runId }, PAY)).issues.filter((i) => i.severity === 'blocker');
}

/* ------------------------------------------------------------------ US-CA */
section('US-CA: the first run is blocked until the year to date before HR OS is in');
let us;
let sg;
{
  us = await newEntity({ name: 'Northwind West Inc', code: 'US02', legal_name: 'Northwind West Inc.', country: 'US', region: 'CA' }, [
    { hire: { legal_name: 'Maya Brooks', family_name: 'Brooks', given_name: 'Maya', name_order: 'given_first', birth_date: '1990-03-03', gender: 'female', nationality: 'US', start_day: '2026-01-05', pay_amount: '8000.00', pay_per: 'month' }, bank: { bank_code: '021000021', number: '000123456789', account_type: 'checking' } },
    { hire: { legal_name: 'Leo Park', family_name: 'Park', given_name: 'Leo', name_order: 'given_first', birth_date: '1991-04-04', gender: 'male', nationality: 'US', start_day: '2026-11-09', pay_amount: '6000.00', pay_per: 'month' }, bank: { bank_code: '021000021', number: '000123456790', account_type: 'checking' } },
  ]);
  const [maya, leo] = us.people;
  const run = await novemberRun(us.ent.id);
  await calcRun(api, run.id, PAY);
  const bl = await blockers(run.id);
  eq(codes(bl), ['opening_balances_missing'], 'one blocker for the entity');
  eq(bl[0].people.map((p) => p.name), ['Maya Brooks'], 'it names Maya (employed since 5 Jan), not Leo (joined 9 Nov, after the first HR OS period started)');
  ok(bl[0].fix && bl[0].fix.link.indexOf('#/payroll/openings?entity=' + us.ent.id) === 0, 'its Fix opens the opening balances screen', bl[0].fix);
  const s0 = await slipOf(run.id, maya.employment);
  ok(codes(s0.issues).indexOf('opening_balances_missing') >= 0 && codes(s0.issues).indexOf('history_short') < 0, 'Maya\'s payslip carries it (no pack history_short)', codes(s0.issues));
  const b0 = byCode(s0);
  ok(b0.US_FUTA === 4200 && b0.US_CA_UI > 0, 'without them FUTA (' + b0.US_FUTA / 100 + ') and CA UI (' + b0.US_CA_UI / 100 + ') would be charged again');
  const sum = (await api.op('payruns.get', { payrun: run.id }, PAY)).payrun;
  eq(sum.blockers, 1, 'the run counts 1 blocker');
  await refuses(api, 'payruns.submit', { payrun: run.id }, PAY, 409, 'blockers', 'it cannot go for approval');

  const sh = await api.op('ytd.sheet', { payrun: run.id }, PAY);
  eq([sh.from, sh.opening_day, sh.required, sh.needed], ['2026-11-01', '2026-10-31', true, 1], 'ytd.sheet: HR OS starts 1 Nov, figures up to 31 Oct, 1 person needed');
  const keys = sh.columns.map((c) => c.key);
  for (const k of ['us_fica_wages', 'us_futa_wages', 'us_supp_wages', 'US_FIT', 'US_SS_EE', 'US_MED_EE', 'US_CA_SIT', 'US_CA_SDI']) ok(keys.indexOf(k) >= 0, 'column ' + k + ' (' + (sh.columns.find((c) => c.key === k) || {}).label + ')');
  eq(sh.people.map((p) => p.name), ['Maya Brooks'], 'the sheet lists Maya only');

  // Your AI agent: may check and propose, never confirm the switch.
  await refuses(api, 'ytd.no-earlier-pay', { entity: us.ent.id, on: true }, AGENT, 403, undefined, 'your AI agent cannot confirm that nobody was paid earlier');
  const csv = 'employee,us_fica_wages,us_futa_wages,US_FIT,US_SS_EE,US_MED_EE,US_CA_SIT,US_CA_SDI\n' + maya.number + ',"80,000.00",80000,9600,4960,1160,3100,1040\n';
  const bad = await api.op('ytd.import-check', { payrun: run.id, csv: 'employee,us_fica_wage\n' + maya.number + ',1\n' }, AGENT);
  ok(!bad.ok && bad.problems.length > 0, 'dry run: an unknown column is a problem (' + (bad.problems[0] || {}).message + ')');
  const chk = await api.op('ytd.import-check', { payrun: run.id, csv }, AGENT);
  ok(chk.ok && chk.would_save === 1 && chk.rows[0].values_minor.us_fica_wages === 8000000, 'dry run as your AI agent: 1 person ready, 80,000.00 read with a thousands separator', chk);
  const prop = await api.call('ytd.import', { payrun: run.id, csv, why: 'From the previous payroll export the owner gave me' }, AGENT);
  ok(prop.status === 200 && prop.body.proposed === true, 'your AI agent\'s import is a proposal', prop.body);
  const still = await api.op('ytd.sheet', { payrun: run.id }, PAY);
  eq(still.people[0].status, 'needed', 'nothing saved before a person accepts it');
  const imp = await api.op('ytd.import', { payrun: run.id, csv }, PAY);
  eq(imp.saved, 1, 'payroll imports it');
  eq((await api.op('payruns.get', { payrun: run.id }, PAY)).payrun.status, 'draft', 'the run goes back to draft');
  await calcRun(api, run.id, PAY);
  eq(codes(await blockers(run.id)), [], 'calculated again: no blockers');
  const s1 = byCode(await slipOf(run.id, maya.employment));
  eq([s1.US_FUTA || 0, s1.US_CA_UI || 0, s1.US_CA_ETT || 0], [0, 0, 0], 'FUTA, CA UI and ETT: the 7,000 bases were used before HR OS');
  eq([s1.US_SS_EE, s1.US_MED_EE], [49600, 11600], 'Social Security 6.2% and Medicare 1.45% of 8,000 (under the base)');
  const l1 = byCode(await slipOf(run.id, leo.employment));
  ok((l1.US_FUTA || 0) > 0, 'Leo, who joined with HR OS, still pays FUTA on his first wages (' + (l1.US_FUTA || 0) / 100 + ')');
  report.US = { before: b0, after: s1 };
}

/* --------------------------------------------------------------------- IN */
section('IN: TDS spreads the year\'s tax over the months left, with April to October in');
{
  const inn = await newEntity({ name: 'Northwind Labs India Pvt Ltd', code: 'IN02', legal_name: 'Northwind Labs India Private Limited', country: 'IN', region: 'GJ' }, [
    { hire: { legal_name: 'Ananya Rao', family_name: 'Rao', given_name: 'Ananya', name_order: 'given_first', birth_date: '1990-05-05', gender: 'female', nationality: 'IN', start_day: '2025-06-01', pay_amount: '200000.00', pay_per: 'month' }, bank: { bank_code: 'HDFC0000123', number: '50100012345678', account_type: 'savings' } },
  ]);
  const [ananya] = inn.people;
  await api.op('taxprofile.submit', { employment: ananya.employment, effective_from: '2025-06-01', packs: ['in'], fields: { in_regime: 'new' } }, PAY);
  const run = await novemberRun(inn.ent.id);
  await calcRun(api, run.id, PAY);
  eq(codes(await blockers(run.id)), ['opening_balances_missing'], 'blocked: employed since June 2025, India\'s tax year began 1 April');
  const b0 = byCode(await slipOf(run.id, ananya.employment));
  const sh = await api.op('ytd.sheet', { entity: inn.ent.id }, PAY);
  const keys = sh.columns.map((c) => c.key);
  for (const k of ['in_salary', 'in_basic_da', 'in_pf_employee', 'IN_TDS']) ok(keys.indexOf(k) >= 0, 'column ' + k + ' (' + (sh.columns.find((c) => c.key === k) || {}).label + ')');
  // One person: the single save (what the screen's cells call).
  await refuses(api, 'ytd.sheet-save', { employment: ananya.employment, values: JSON.stringify({ in_salary: 'abc' }) }, PAY, 400, 'invalid_param', 'a figure that is not an amount is refused');
  await api.op('ytd.sheet-save', { employment: ananya.employment, values: JSON.stringify({ in_salary: '1400000', in_basic_da: '1400000' }) }, PAY);
  await api.op('ytd.sheet-save', { employment: ananya.employment, values: JSON.stringify({ IN_TDS: '170625' }) }, PAY);
  const op = (await api.op('ytd.list', { employment: ananya.employment }, PAY)).openings;
  eq(op.map((o) => [o.day, o.by_tag.in_salary, o.by_code.IN_TDS]), [['2026-10-31', 1400000, 170625]], 'two saves, one opening balance dated 31 Oct');
  await calcRun(api, run.id, PAY);
  eq(codes(await blockers(run.id)), [], 'no blockers');
  const s1 = byCode(await slipOf(run.id, ananya.employment));
  // New regime FY 2026-27: 14,00,000 earlier + 2,00,000 x 5 (Nov to Mar) = 24,00,000, less 75,000 standard deduction = 23,25,000;
  // slab tax 20,000 + 40,000 + 60,000 + 80,000 + 25% of 3,25,000 = 2,81,250, plus 4% cess = 2,92,500;
  // less 1,70,625 already deducted, over the 5 months left = 24,375.
  eq(s1.IN_TDS, 2437500, 'November TDS 24,375 = (2,92,500 - 1,70,625) / 5');
  ok((b0.IN_TDS || 0) === 0, 'without the opening balance TDS would be ' + (b0.IN_TDS || 0) / 100 + ' (10,00,000 projected, under the rebate)');
  report.IN = { before: b0.IN_TDS || 0, after: s1.IN_TDS };
}

/* --------------------------------------------------------------------- SG */
section('SG: the AW ceiling counts the year\'s OW before HR OS');
{
  sg = await newEntity({ name: 'Northwind Asia Pte Ltd', code: 'SG03', legal_name: 'Northwind Asia Pte. Ltd.', country: 'SG' }, [
    { hire: { legal_name: 'Wei Ling Tan', family_name: 'Tan', given_name: 'Wei Ling', name_order: 'family_first', birth_date: '1990-06-06', gender: 'female', nationality: 'SG', start_day: '2026-01-05', pay_amount: '8000.00', pay_per: 'month' }, bank: { bank_code: '7171', branch_code: '001', number: '0123456789', account_type: 'savings' } },
  ]);
  const [wl] = sg.people;
  const run = await novemberRun(sg.ent.id);
  const comps = (await api.op('components.list', { entity: sg.ent.id }, PAY)).components;
  const bonus = comps.find((c) => c.role === 'bonus' && !c.archived).code;
  await api.op('pay-inputs.add', { employment: wl.employment, component: bonus, amount: '30000.00', payrun: run.id }, PAY);
  await calcRun(api, run.id, PAY);
  eq(codes(await blockers(run.id)), ['opening_balances_missing'], 'blocked');
  const b0 = byCode(await slipOf(run.id, wl.employment));
  const sh = await api.op('ytd.sheet', { payrun: run.id }, PAY);
  const keys = sh.columns.map((c) => c.key);
  for (const k of ['sg_cpf_ow', 'sg_cpf_aw', 'SG_CPF_EE']) ok(keys.indexOf(k) >= 0, 'column ' + k + ' (' + (sh.columns.find((c) => c.key === k) || {}).label + ')');
  await api.op('ytd.import', { payrun: run.id, csv: 'employee,OW subject to CPF,sg_cpf_aw,SG_CPF_EE\n' + wl.name + ',80000,0,16000\n' }, PAY);
  await calcRun(api, run.id, PAY);
  eq(codes(await blockers(run.id)), [], 'no blockers (columns may be named by their labels)');
  const s1 = byCode(await slipOf(run.id, wl.employment));
  // AW ceiling 102,000 - (80,000 + 8,000 x 2 for November and December) = 6,000; employee 20% of 8,000 + 6,000.
  eq([s1.SG_CPF_AW, s1.SG_CPF_EE, s1.SG_CPF_ER], [600000, 280000, 238000], 'AW subject to CPF 6,000; CPF employee 2,800, employer 2,380');
  ok(b0.SG_CPF_EE === 760000, 'without the OW before HR OS the whole 30,000 bonus would take CPF (employee ' + b0.SG_CPF_EE / 100 + ')');
  report.SG = { before: b0, after: s1 };
}

/* ---------------------------------------------------- MY and the switch */
section('MY: one blocker (not PCB\'s own), and the per-entity "nobody was paid earlier" switch');
{
  const my = await newEntity({ name: 'Northwind Digital Sdn Bhd', code: 'MY02', legal_name: 'Northwind Digital Sdn. Bhd.', country: 'MY', region: '14' }, [
    { hire: { legal_name: 'Farid bin Hassan', family_name: 'Hassan', given_name: 'Farid', name_order: 'given_first', birth_date: '1988-07-07', gender: 'male', nationality: 'MY', start_day: '2026-02-02', pay_amount: '9000.00', pay_per: 'month', tax_fields: { my_resident: true, my_pcb_category: '1', my_malaysian: true }, tax_packs: ['my', 'my-hrdf'] }, bank: { bank_code: 'MBBEMYKL', swift: 'MBBEMYKL', number: '514012345690', account_type: 'savings' } },
  ]);
  const [farid] = my.people;
  await api.op('taxprofile.submit', { employment: farid.employment, effective_from: '2026-02-02', packs: ['my', 'my-hrdf'], fields: { my_resident: true, my_pcb_category: '1', my_malaysian: true } }, PAY);
  const run = await novemberRun(my.ent.id);
  await calcRun(api, run.id, PAY);
  const s0 = await slipOf(run.id, farid.employment);
  ok(codes(s0.issues).indexOf('opening_balances_missing') >= 0 && codes(s0.issues).indexOf('my_pcb_year_history_missing') < 0, 'MY\'s year history blocker folds into the opening balances one', codes(s0.issues));
  await refuses(api, 'ytd.no-earlier-pay', { entity: my.ent.id, on: true }, { as: 'hr@northwind.test' }, 403, undefined, 'HR (payroll view) cannot confirm');
  const c = await api.op('ytd.no-earlier-pay', { entity: my.ent.id, on: true }, PAY);
  ok(c.confirmed.on === true && c.confirmed.by_name !== '' && c.confirmed.at !== '', 'payroll confirms: who and when are kept (' + c.confirmed.by_name + ')');
  await calcRun(api, run.id, PAY);
  eq(codes(await blockers(run.id)), [], 'confirmed: no blockers (PCB counts from November, as confirmed)');
  const st = (await api.op('payroll.settings', { entity: my.ent.id }, PAY)).settings;
  eq(st.no_earlier_pay, true, 'payroll.settings shows it');
  await api.op('ytd.no-earlier-pay', { entity: my.ent.id, on: false }, PAY);
  await calcRun(api, run.id, PAY);
  eq(codes(await blockers(run.id)), ['opening_balances_missing'], 'withdrawn: blocked again');
}

/* ------------------------------------------------- go-live day and AU */
section('AU: the first pay day in HR OS; a later run still asks while it is set');
{
  const au = await newEntity({ name: 'Northwind Oceania Pty Ltd', code: 'AU02', legal_name: 'Northwind Oceania Pty Ltd', country: 'AU', region: 'NSW' }, [
    { hire: { legal_name: 'Ruby Clarke', family_name: 'Clarke', given_name: 'Ruby', name_order: 'given_first', birth_date: '1992-08-08', gender: 'female', nationality: 'AU', start_day: '2026-03-02', pay_amount: '7000.00', pay_per: 'month', tax_fields: { au_tfn_provided: true, au_residency: 'resident', au_tax_free_threshold: true } }, bank: { bank_code: '062-012', number: '10203042', account_type: 'savings' } },
  ]);
  const home0 = await api.op('payroll.home', { entity: au.ent.id }, PAY);
  ok(home0.setup.some((x) => x.code === 'go_live_missing'), 'Payroll home asks for the first pay day in HR OS');
  const guide0 = (await api.op('app.home', {}, O)).setup || (await api.op('setup.progress', {}, O));
  const step = guide0 && guide0.steps ? guide0.steps.find((x) => x.key === 'payroll_start') : null;
  ok(step !== null && step !== undefined && step.done === false, 'the setup guide has the step "When HR OS starts paying", open', step);
  await api.op('payroll.settings-save', { entity: au.ent.id, go_live_day: '2026-11-30' }, PAY);
  const home1 = await api.op('payroll.home', { entity: au.ent.id }, PAY);
  ok(!home1.setup.some((x) => x.code === 'go_live_missing'), 'set: Payroll home stops asking');
  const run = await novemberRun(au.ent.id);
  await calcRun(api, run.id, PAY);
  const bl = await blockers(run.id);
  eq(codes(bl), ['opening_balances_missing'], 'blocked: employed since March, Australia\'s tax year began 1 July');
  const sh = await api.op('ytd.sheet', { entity: au.ent.id }, PAY);
  eq([sh.go_live_day, sh.from, sh.opening_day], ['2026-11-30', '2026-11-01', '2026-10-31'], 'the sheet: first pay day 30 Nov, its period from 1 Nov, figures up to 31 Oct');
  ok(sh.columns.some((c) => c.key === 'au_super_qe') && sh.columns.some((c) => c.key === 'AU_PAYGW'), 'AU columns: super earnings and PAYGW withheld', sh.columns.map((c) => c.key));
}

/* ------------------------------------------------ payroll.person-set (item 2) */
section('payroll.person-set: payroll fills only the personal fields packs read');
{
  // Singapore's CPF rates go by age: without a birth date the payslip cannot be worked out.
  const p = sg.people[0];
  await api.op('people.update', { employee: p.number, birth_date: '' }, HR);
  const run = (await api.op('payruns.list', { entity: sg.ent.id, status: 'open' }, PAY)).payruns[0];
  await calcRun(api, run.id, PAY);
  const s = await slipOf(run.id, p.employment);
  const dm = (s.issues || []).find((i) => i.code === 'data_missing' && i.scope === 'employee');
  ok(dm !== undefined && dm.field === 'birth_date' && dm.payroll_may_set === true, 'no birth date: data_missing on birth_date, payroll may set it', (s.issues || []).map((i) => [i.code, i.field, i.payroll_may_set]));
  await refuses(api, 'people.update', { employee: p.number, birth_date: '1990-03-03' }, PAY, 403, undefined, 'payroll cannot use people.update');
  await refuses(api, 'payroll.person-set', { employee: p.number, legal_name: 'Someone Else' }, PAY, 400, 'unknown_param', 'payroll cannot change a name (the op takes no such field)');
  await refuses(api, 'payroll.person-set', { employee: p.number, birth_date: '2999-01-01' }, PAY, 400, 'invalid_param', 'a birth date in the future is refused');
  await refuses(api, 'payroll.person-set', { employee: p.number, birth_date: '1990-03-03' }, { as: 'sam@northwind.test' }, 403, undefined, 'an employee cannot');
  const prop = await api.call('payroll.person-set', { employee: p.number, birth_date: '1990-06-06', why: 'From the NRIC the owner sent' }, AGENT);
  ok(prop.status === 200 && prop.body.proposed === true, 'your AI agent proposes it', prop.body);
  const r = await api.op('payroll.person-set', { employee: p.number, birth_date: '1990-06-06', nationality: 'sg' }, PAY);
  eq([r.employee.birth_date, r.employee.nationality], ['1990-06-06', 'SG'], 'payroll sets the birth date and nationality');
  const audit = await api.op('audit.list', { collection: 'employees', record: r.employee.id, limit: 5 }, O);
  ok((audit.entries || []).some((a) => /Payroll set birth date/.test(a.summary || '')), 'audited', (audit.entries || []).map((a) => a.summary));
  eq((await api.op('payruns.get', { payrun: run.id }, PAY)).payrun.status, 'draft', 'the run goes back to draft');
  await calcRun(api, run.id, PAY);
  const s2 = await slipOf(run.id, p.employment);
  ok(!(s2.issues || []).some((i) => i.code === 'data_missing'), 'calculated again: the issue is gone');
}

console.log('\nLines: ' + JSON.stringify(report));
summary('t07_openings');
