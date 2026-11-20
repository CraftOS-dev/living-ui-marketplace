// payroll-core t05: bonus runs next to a locked regular run (QA M-1, B-5 to B-9).
// For US-CA, MY, IN and AU: lock November's regular run, then pay a bonus dated
// after it and one dated before it in the same period. The bonus payslip's
// history holds the locked regular payslip either way, so a capped base
// (FUTA, CA UI and ETT 7,000; MY SOCSO and EIS 6,000 a month; IN EPF wage
// ceiling; AU maximum contributions base) is not charged twice, and the
// before-dated one warns. A bonus calculated before the regular run locked goes
// back to draft when it locks (its history changed).
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
async function regularFor(entityId) {
  const home = await api.op('payroll.home', {}, O);
  const s = home.schedules.find((x) => x.entity === entityId || x.entity_id === entityId);
  return (await api.op('payruns.create', { schedule: s.schedule }, O)).payrun;
}
async function slipOf(runId, employmentId) {
  const got = await api.op('payruns.get', { payrun: runId }, O);
  const row = got.payslips.find((x) => x.employment === employmentId);
  return row ? (await api.op('payslips.get', { payslip: row.id }, O)).payslip : null;
}
async function approveAndLock(runId) {
  const iss = await api.op('payruns.issues', { payrun: runId }, O);
  const blockers = iss.issues.filter((i) => i.severity === 'blocker');
  if (blockers.length > 0) return { blocked: blockers.map((b) => b.code + ' ' + (b.message || '')) };
  if (iss.issues.length > 0) await api.op('payruns.acknowledge', { payrun: runId, reason: 'reviewed_ok' }, PAY);
  const sub = await api.op('payruns.submit', { payrun: runId }, PAY);
  await decideAny(api, sub.approval.id, 'approved');
  return api.op('payruns.lock', { payrun: runId }, PAYPIN);
}
async function bonusRun(ent, employmentId, payDate, amount, kind, role) {
  const comps = (await api.op('components.list', { entity: ent }, PAY)).components;
  const code = comps.find((c) => c.role === (role || 'bonus') && !c.archived).code;
  const b = (await api.op('payruns.create', { kind: kind || 'bonus', entity: ent, employments: [employmentId], pay_date: payDate, label: (kind || 'bonus') + ' ' + payDate }, PAY)).payrun;
  await api.op('pay-inputs.add', { employment: employmentId, component: code, amount: amount, payrun: b.id }, PAY);
  await calcRun(api, b.id, PAY);
  return b;
}
const issueCodes = (s) => (s.issues || []).map((i) => i.code);

/** Hire one person into a new entity of a country, with a bank account. */
async function newCountry(create, entityFields, hire, bank) {
  const ent = (await api.op('entities.add', create, O)).entity;
  await api.op('locations.add', { entity: ent.id, name: create.name + ' office' }, O);
  if (entityFields) await api.op('payroll.settings-save', { entity: ent.id, entity_fields: entityFields }, O);
  const eng = (await api.op('departments.list', {}, O)).departments.find((d) => d.code === 'ENG');
  const loc = (await api.op('locations.list', { entity: ent.id }, O)).locations[0];
  const h = await api.op('people.hire', Object.assign({ entity: ent.id, title: 'Engineer', department: eng.id, location: loc.id, pay_basis: 'salary', work_email: hire.legal_name.toLowerCase().replace(/[^a-z]+/g, '.') + '@' + create.country.toLowerCase() + '.northwind.test' }, hire), O);
  const add = await api.op('bank.add', Object.assign({ employee: h.employee.id, bank_name: 'Test Bank', holder: hire.legal_name }, bank), O);
  if (add.approval && add.approval.status === 'pending') await decideAll(add.approval.id);
  return { ent: ent, employment: h.employment.id, number: h.employee.number };
}

/** Activate a pack's latest draft when nothing of the code is active (scratch: MY SOCSO ships as a draft). */
async function activateDraft(code) {
  const list = await api.op('packs.list', {}, O);
  const rows = (list.packs || []).filter((p) => p.code === code);
  if (rows.some((p) => p.status === 'active')) return 'active';
  const d = rows.find((p) => p.status === 'draft' || p.status === 'tested');
  if (!d) return 'missing';
  const r = await api.call('packs.activate', { pack: d.id }, { as: 'owner', pin: true });
  return r.status < 400 ? 'activated' : 'refused ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 160);
}

/* ------------------------------------------------------------------ US-CA */
section('US-CA: FUTA, CA UI and ETT (7,000 a year) are not charged again by a bonus');
{
  const dir = (await api.op('people.directory', { status: 'current', limit: 500 }, O)).people;
  // The demo locked October; Grace (32.50 an hour) earned less than 7,000 in it, so November uses the rest.
  const emily = dir.find((x) => x.name === 'Grace Kim');
  const reg = await regularFor(emily.entity);
  await calcRun(api, reg.id);
  const r0 = byCode(await slipOf(reg.id, emily.employment));
  ok(r0.US_FUTA > 0 && r0.US_CA_UI > 0, 'November regular: FUTA ' + r0.US_FUTA / 100 + ', CA UI ' + r0.US_CA_UI / 100 + ', ETT ' + (r0.US_CA_ETT || 0) / 100 + ' (wages over 7,000 use the whole base)');
  // A bonus calculated while November is still open: November is not in its history yet.
  const early = await bonusRun(emily.entity, emily.employment, '2026-12-04', '2000.00');
  const e0 = byCode(await slipOf(early.id, emily.employment));
  ok(e0.US_FUTA > 0, 'a bonus calculated before November locks still has FUTA room (' + e0.US_FUTA / 100 + ')');
  const locked = await approveAndLock(reg.id);
  ok(locked.payrun && locked.payrun.status === 'locked', 'November regular locked', locked);
  const after = (await api.op('payruns.get', { payrun: early.id }, O)).payrun;
  eq(after.status, 'draft', 'locking November sends the calculated bonus back to draft (its year to date changed)');
  await calcRun(api, early.id, PAY);
  const e1 = byCode(await slipOf(early.id, emily.employment));
  // October (locked by the demo) and November used part of the 7,000 bases; the bonus pays on what is left, never past them.
  const oct = (await api.op('payslips.recent', { employment: emily.employment, limit: 5 }, O)).payslips.find((x) => x.period_start === '2026-10-01');
  const o0 = byCode((await api.op('payslips.get', { payslip: oct.id }, O)).payslip);
  const year = (k) => (o0[k] || 0) + (r0[k] || 0);
  eq([year('US_FUTA') + (e1.US_FUTA || 0), year('US_CA_UI') + (e1.US_CA_UI || 0), year('US_CA_ETT') + (e1.US_CA_ETT || 0)], [4200, 23800, 700], 'recalculated: October, November and the bonus dated 4 Dec together pay FUTA, CA UI and ETT on exactly 7,000');
  // Dated before November's pay day, in the same period (QA M-1: 27 Nov against a locked 30 Nov run).
  const before = await bonusRun(emily.entity, emily.employment, '2026-11-27', '1000.00');
  const bs = await slipOf(before.id, emily.employment);
  const b1 = byCode(bs);
  eq([year('US_FUTA') + (b1.US_FUTA || 0), year('US_CA_UI') + (b1.US_CA_UI || 0), year('US_CA_ETT') + (b1.US_CA_ETT || 0)], [4200, 23800, 700], 'bonus dated 27 Nov, before the locked 30 Nov run: the same, the November run counted');
  ok(issueCodes(bs).indexOf('paid_before_locked_run') >= 0, 'and it warns paid_before_locked_run', issueCodes(bs));
  ok(b1.US_SS_EE > 0 && b1.US_MED_EE > 0, 'Social Security and Medicare still apply (under their bases)');
  report.US = { regular: r0, bonus_after: e1, bonus_before: b1 };
}

/**
 * Lock November's regular run of an entity, then pay a bonus in the same month
 * after its pay day (on it when it is the month end) and one dated 3 days
 * before it. Returns both payslips with the regular one, and checks that each
 * bonus payslip's stored engine input has the locked regular payslip of the
 * period in its history.
 */
async function aroundRegular(entityId, employmentId, amount, label) {
  const reg = await regularFor(entityId);
  await calcRun(api, reg.id);
  const r0 = byCode(await slipOf(reg.id, employmentId));
  const locked = await approveAndLock(reg.id);
  ok(locked.payrun && locked.payrun.status === 'locked', label + ': November regular locked (pay day ' + reg.pay_date + ')', locked);
  const afterDay = reg.pay_date >= reg.period_end ? reg.pay_date : addDay(reg.pay_date, 1);
  const beforeDay = addDay(reg.pay_date, -3);
  const after = await bonusRun(entityId, employmentId, afterDay, amount);
  const before = await bonusRun(entityId, employmentId, beforeDay, amount);
  const as = await slipOf(after.id, employmentId);
  const bs = await slipOf(before.id, employmentId);
  for (const [run, name] of [[after, 'after (' + afterDay + ')'], [before, 'before (' + beforeDay + ')']]) {
    const hist = storedHistory(run.id, employmentId);
    ok(hist.some((h) => h.kind === 'regular' && h.period_start === reg.period_start && h.pay_date === reg.pay_date), label + ': the bonus ' + name + ' has the locked regular payslip of the period in its history', hist.map((h) => h.kind + ' ' + h.pay_date));
  }
  ok(issueCodes(bs).indexOf('paid_before_locked_run') >= 0 && issueCodes(as).indexOf('paid_before_locked_run') < 0, label + ': only the bonus dated before the locked run warns paid_before_locked_run', [issueCodes(as), issueCodes(bs)]);
  return { reg: reg, r0: r0, a1: byCode(as), b1: byCode(bs), aIssues: issueCodes(as), bIssues: issueCodes(bs) };
}
function addDay(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The engine input history stored on a payslip (scratch database, read only). */
function storedHistory(runId, employmentId) {
  const db = new DatabaseSync(join(APP, 'pb', 'pb_data', 'data.db'), { readOnly: true });
  const row = db.prepare('SELECT input FROM payslips WHERE payrun = ? AND employment = ?').get(runId, employmentId);
  db.close();
  return row ? JSON.parse(row.input).history || [] : [];
}
const zero = (o, codes) => codes.map((c) => o[c] || 0);

/* --------------------------------------------------------------------- IN */
section('IN: the EPF wage ceiling is not used twice in the month (B-9), and bonus TDS (B-6)');
{
  const dir = (await api.op('people.directory', { status: 'current', limit: 500 }, O)).people;
  const inds = dir.filter((x) => x.entity_name === 'Northwind India Pvt Ltd');
  const p = inds.find((x) => /Vikram/.test(x.name));
  await api.op('taxprofile.submit', { employment: p.employment, packs: ['in', 'in-epf'], fields: { in_regime: 'new', in_pf_member: true, in_eps_member: true } }, O);
  const x = await aroundRegular(p.entity, p.employment, '50000.00', 'IN');
  const PF = ['IN_PF_EE', 'IN_EPS_ER', 'IN_EPF_ER', 'IN_EDLI_ER'];
  ok(x.r0.IN_PF_EE > 0 && x.r0.IN_TDS > 0, 'regular: PF ' + zero(x.r0, PF).map((v) => v / 100).join(' / ') + ', TDS ' + x.r0.IN_TDS / 100);
  eq(zero(x.a1, PF), [0, 0, 0, 0], 'bonus after: no PF, EPS, EPF or EDLI again (the wage period ceiling was used)');
  eq(zero(x.b1, PF), [0, 0, 0, 0], 'bonus before: none either');
  ok(x.a1.IN_TDS > 0, 'bonus after: TDS on the extra tax the bonus adds (' + (x.a1.IN_TDS || 0) / 100 + ')', x.aIssues);
  report.IN = { regular: x.r0, bonus_after: x.a1, bonus_before: x.b1, before_issues: x.bIssues };
}

/* --------------------------------------------------------------------- MY */
section('MY: SOCSO and EIS (6,000 a month) are not charged again, and bonus PCB (B-5)');
{
  const act = await activateDraft('my-socso');
  ok(act === 'active' || act === 'activated', 'my-socso pack active (' + act + ')');
  const my = await newCountry(
    { name: 'Northwind Sdn Bhd', code: 'MY01', legal_name: 'Northwind Sdn. Bhd.', country: 'MY', region: '14' },
    { my_hrdf_rate: '1' },
    { legal_name: 'Aisyah binti Rahman', family_name: 'Rahman', given_name: 'Aisyah', name_order: 'given_first', birth_date: '1992-02-02', gender: 'female', nationality: 'MY', start_day: '2026-11-01', pay_amount: '25000.00', pay_per: 'month', tax_fields: { my_resident: true, my_pcb_category: '1', my_malaysian: true }, tax_packs: ['my', 'my-hrdf', 'my-socso'] },
    { bank_code: 'MBBEMYKL', swift: 'MBBEMYKL', number: '514012345670', account_type: 'savings' },
  );
  const x = await aroundRegular(my.ent.id, my.employment, '5000.00', 'MY');
  const SO = ['MY_SOCSO_EE', 'MY_SOCSO_ER', 'MY_EIS_EE', 'MY_EIS_ER'];
  ok(x.r0.MY_SOCSO_EE > 0 && x.r0.MY_PCB > 0, 'regular (25,000): SOCSO and EIS ' + zero(x.r0, SO).map((v) => v / 100).join(' / ') + ' (the 6,000 ceiling), PCB ' + x.r0.MY_PCB / 100);
  eq(zero(x.a1, SO), [0, 0, 0, 0], 'bonus after: no SOCSO or EIS again');
  eq(zero(x.b1, SO), [0, 0, 0, 0], 'bonus before: none either');
  eq([x.a1.MY_PCB || 0, x.b1.MY_PCB || 0], [30000, 30000], 'bonus PCB 300.00 either way (LHDN Step 4: the month with the locked regular pay, year tax 1,260 less 960)');
  // An allowance is SOCSO and EIS wages (a bonus is not): off-cycle in the same month, the 6,000 ceiling is already used.
  const allow = await bonusRun(my.ent.id, my.employment, addDay(x.reg.pay_date, -1), '500.00', 'off_cycle', 'allowance');
  const al = byCode(await slipOf(allow.id, my.employment));
  eq(zero(al, SO), [0, 0, 0, 0], 'an off-cycle allowance in November: no SOCSO or EIS past the month ceiling');
  report.MY = { regular: x.r0, bonus_after: x.a1, bonus_before: x.b1, allowance_off_cycle: al };
}

/* --------------------------------------------------------------------- AU */
section('AU: super stops at the maximum contributions base, and bonus PAYGW (B-7)');
{
  // Employed since July; 248,000 of qualifying earnings carried in (HR OS goes live in November).
  // Concessional cap 30,000: MCB 250,000 a year, so November counts 2,000 and the bonus nothing.
  const au = await newCountry(
    { name: 'Northwind Pty Ltd', code: 'AU01', legal_name: 'Northwind Pty Ltd', country: 'AU', region: 'NSW' },
    { au_concessional_cap: '30000' },
    { legal_name: 'Jack Wilson', family_name: 'Wilson', given_name: 'Jack', name_order: 'given_first', birth_date: '1994-09-09', gender: 'male', nationality: 'AU', start_day: '2026-07-01', pay_amount: '30000.00', pay_per: 'month', tax_fields: { au_tfn_provided: true, au_residency: 'resident', au_tax_free_threshold: true } },
    { bank_code: '062-010', number: '10203040', account_type: 'savings' },
  );
  await api.op('ytd.set', { employment: au.employment, day: '2026-10-31', by_tag: JSON.stringify({ au_super_qe: 248000, au_paygw_pay: 120000 }), by_code: JSON.stringify({ AU_SALARY: 120000 }), source: 'migration', note: 'July to October before HR OS' }, O);
  const x = await aroundRegular(au.ent.id, au.employment, '5000.00', 'AU');
  eq(x.r0.AU_SG, 24000, 'regular: super on the 2,000 left under the MCB = 240.00');
  eq([x.a1.AU_SG || 0, x.b1.AU_SG || 0], [0, 0], 'bonuses after and before: no super past the MCB');
  ok(x.a1.AU_PAYGW > 0, 'bonus after: PAYGW by Schedule 5 (' + (x.a1.AU_PAYGW || 0) / 100 + ')', x.aIssues);
  report.AU = { regular: x.r0, bonus_after: x.a1, bonus_before: x.b1, before_issues: x.bIssues };
}

console.log('\nLines: ' + JSON.stringify(report));
summary('t05_bonus_history');
