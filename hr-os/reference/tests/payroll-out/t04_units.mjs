// Pure Node unit tests: the filings calendar across years, journal balance,
// year-end document totals and the pack diff. node tests/t04_units.mjs [hooks dir]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hooks = process.argv[2] || path.join(here, '..', 'app', 'pb', 'pb_hooks');
const require = createRequire(import.meta.url);
const C = require(path.join(hooks, 'lib_payroll_out_calendar.js'));
const J = require(path.join(hooks, 'lib_payroll_out_journal.js'));
const D = require(path.join(hooks, 'lib_payroll_docs.js'));
const P = require(path.join(hooks, 'lib_payroll_out_packs.js'));

let pass = 0;
let fail = 0;
const eq = (a, b, name) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else {
    fail++;
    console.log('FAIL', name, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b));
  }
};
const due = (code, prefs, freq, year, taxStart, period, holidays) => {
  const r = C.ruleFor(code, prefs || {}, freq);
  const p = C.periods(r, year, taxStart).find((x) => x.period === period);
  if (!p) return 'no period ' + period + ' in ' + C.periods(r, year, taxStart).map((x) => x.period).join(',');
  return C.dueDay(r, p, [0, 6], (d) => (holidays || []).indexOf(d) >= 0);
};

/* --- United States */
eq(due('us_941', {}, 'quarterly', 2026, '01-01', '2026-Q1'), '2026-04-30', '941 Q1 due 30 April 2026 (Thursday)');
eq(due('us_941', {}, 'quarterly', 2026, '01-01', '2026-Q2'), '2026-07-31', '941 Q2 due 31 July');
eq(due('us_941', {}, 'quarterly', 2026, '01-01', '2026-Q3'), '2026-11-02', '941 Q3: 31 October 2026 is a Saturday, next business day Monday 2 November');
eq(due('us_941', {}, 'quarterly', 2026, '01-01', '2026-Q4'), '2027-02-01', '941 Q4 of 2026 due in 2027: 31 January is a Sunday, so 1 February');
eq(due('us_941', {}, 'quarterly', 2027, '01-01', '2027-Q4'), '2028-01-31', '941 Q4 of 2027 due 31 January 2028 (Monday)');
eq(due('us_940', {}, 'annual', 2026, '01-01', '2026'), '2027-02-01', '940 for 2026 due 31 January 2027, moved to Monday');
eq(due('us_w2', {}, 'annual', 2027, '01-01', '2027'), '2028-01-31', 'W-2 for 2027 due 31 January 2028');
eq(due('us_nj_927', {}, 'quarterly', 2026, '01-01', '2026-Q1'), '2026-04-30', 'NJ-927 due the 30th day after the quarter');
eq(due('us_941', {}, 'quarterly', 2026, '01-01', '2026-Q1', ['2026-04-30']), '2026-05-01', 'a holiday on the due day moves it to the next business day');
eq(due('us_nc_5', { us_nc_5: 'quarterly' }, 'monthly_or_quarterly', 2026, '01-01', '2026-Q2'), '2026-07-31', 'NC-5 quarterly filer by preference');
eq(due('us_nc_5', {}, 'monthly_or_quarterly', 2026, '01-01', '2026-11'), '2026-12-15', 'NC-5 monthly by default');
eq(C.periods(C.ruleFor('us_941', {}, 'quarterly'), 2026, '01-01').map((p) => p.period), ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'], 'four quarters end in 2026');
eq(C.ruleFor('us_ca_de88', {}, 'per_pay_date').due, null, 'a deposit-schedule filing has no due rule (a person sets it)');

/* --- United Kingdom (tax year 6 April) */
const gbm = C.periods(C.ruleFor('gb_eps', {}, 'monthly'), 2026, '04-06');
eq(gbm.map((p) => p.period), ['2025-26 M09', '2025-26 M10', '2025-26 M11', '2025-26 M12', '2026-27 M01', '2026-27 M02', '2026-27 M03', '2026-27 M04', '2026-27 M05', '2026-27 M06', '2026-27 M07', '2026-27 M08'], 'tax months ending in 2026');
eq(gbm[4], { period: '2026-27 M01', start: '2026-04-06', end: '2026-05-05' }, 'tax month 1 runs 6 April to 5 May');
eq(due('gb_eps', {}, 'monthly', 2026, '04-06', '2026-27 M01'), '2026-05-19', 'EPS due the 19th after the tax month ends');
eq(due('gb_paye_payment', {}, 'monthly', 2026, '04-06', '2026-27 M05'), '2026-09-22', 'PAYE payment due 22nd (a Tuesday)');
eq(due('gb_paye_payment', {}, 'monthly', 2026, '04-06', '2026-27 M04'), '2026-08-21', 'PAYE due 22 August 2026 (Saturday) is paid by Friday 21');
eq(due('gb_paye_payment', { gb_paye_payment: 'quarterly' }, 'monthly', 2026, '04-06', '2026-27 Q1'), '2026-07-22', 'quarterly PAYE for small employers: 6 April to 5 July, due 22 July');
eq(due('gb_p60', {}, 'annual', 2027, '04-06', '2026-27'), '2027-05-31', 'P60 for 2026-27 due 31 May 2027');
eq(due('gb_p11d', {}, 'annual', 2027, '04-06', '2026-27'), '2027-07-06', 'P11D for 2026-27 due 6 July 2027');
eq(C.periods(C.ruleFor('gb_p60', {}, 'annual'), 2027, '04-06')[0], { period: '2026-27', start: '2026-04-06', end: '2027-04-05' }, 'the tax year that ends in 2027');

/* --- Australia (financial year 1 July) */
eq(due('au_bas_paygw', {}, 'monthly_or_quarterly', 2026, '07-01', '2026-27 Q2'), '2027-03-01', 'BAS for October to December due 28 February 2027 (Sunday), moved to 1 March');
eq(due('au_bas_paygw', {}, 'monthly_or_quarterly', 2026, '07-01', '2025-26 Q4'), '2026-07-28', 'BAS April to June due 28 July');
eq(due('au_bas_paygw', { au_bas: 'monthly' }, 'monthly_or_quarterly', 2026, '07-01', '2026-11'), '2026-12-21', 'monthly BAS due the 21st');
eq(due('au_stp_final', {}, 'annual', 2027, '07-01', '2026-27'), '2027-07-14', 'STP finalisation due 14 July');
eq(due('au_super', {}, 'quarterly', 2026, '07-01', '2026-27 Q1'), '2026-10-28', 'super (2025-26 pack, quarterly) due 28 October');
eq(C.dueDay(C.ruleFor('au_super', {}, 'per_pay_date'), { period: 'PR-1', start: '2026-07-01', end: '2026-07-14', payDate: '2026-07-15' }, [0, 6]), '2026-07-22', 'payday super (2026-27 pack): 7 days after the pay day');
const dep = (prefs, payDate) => C.dueDay(C.ruleFor('us_941_deposit', prefs, 'monthly'), { period: 'PR-1', start: payDate, end: payDate, payDate }, [0, 6]);
eq(due('us_941_deposit', {}, 'monthly', 2026, '01-01', '2026-11'), '2026-12-15', '941 deposit, monthly depositor: 15th of the next month');
eq(due('us_941_deposit', {}, 'monthly', 2026, '01-01', '2026-02'), '2026-03-16', '941 deposit for February: 15 March 2026 is a Sunday, so Monday');
eq(dep({ us_941_deposit: 'semiweekly' }, '2026-11-25'), '2026-12-02', 'semi-weekly: paid Wednesday, deposit the next Wednesday');
eq(dep({ us_941_deposit: 'semiweekly' }, '2026-11-27'), '2026-12-02', 'semi-weekly: paid Friday, deposit the next Wednesday');
eq(dep({ us_941_deposit: 'semiweekly' }, '2026-11-30'), '2026-12-04', 'semi-weekly: paid Monday, deposit the Friday');
eq(dep({ us_941_deposit: 'semiweekly' }, '2026-11-24'), '2026-11-27', 'semi-weekly: paid Tuesday, deposit the Friday');
eq(C.ruleFor('us_941_deposit', {}, 'monthly').amount, { filing: 'us_941' }, 'the deposit sums the lines filed under Form 941');
eq(C.declarations([], { code: 'US', filings: [] }, false).map((d) => d.code), ['us_941_deposit'], 'the US adds the 941 deposit next to the quarterly return');

/* --- Japan */
eq(due('jp_gensen', {}, 'monthly', 2026, '01-01', '2026-12', ['2027-01-11']), '2027-01-12', '源泉 for December due 10 January 2027 (a Sunday; 11 January is 成人の日), moved past the holiday', );
eq(due('jp_gensen', { jp_special_period: 'special' }, 'monthly', 2026, '01-01', '2026-H1'), '2026-07-10', '納期の特例: January to June due 10 July');
eq(due('jp_gensen', { jp_special_period: 'special' }, 'monthly', 2026, '01-01', '2026-H2'), '2027-01-20', '納期の特例: July to December due 20 January');
eq(due('jp_santei', {}, 'yearly', 2026, '01-01', '2026'), '2026-07-10', '算定基礎届 due 10 July');
eq(due('jp_hotei_chosho', {}, 'yearly', 2026, '01-01', '2026'), '2027-02-01', '源泉徴収票 and 給与支払報告書 for 2026: 31 January 2027 is a Sunday, so 1 February');
eq(due('jp_nencho', {}, 'yearly', 2027, '01-01', '2027'), '2028-01-31', '年末調整 records by 31 January');
eq(due('jp_shakai_hoken', {}, 'monthly', 2026, '01-01', '2026-02'), '2026-03-31', '社会保険料 due the end of the following month');
eq(C.dueDay(C.ruleFor('jp_shoyo_todoke', {}, 'per_bonus'), { period: 'PR-0009', start: '2026-12-01', end: '2026-12-31', payDate: '2026-12-10' }, [0, 6]), '2026-12-15', '賞与支払届 within 5 days of the bonus');

/* --- Singapore, India, Malaysia, Canada */
eq(due('sg_cpf', {}, 'monthly', 2026, '01-01', '2026-12'), '2027-01-14', 'CPF for December due 14 January');
eq(due('sg_ir8a', {}, 'yearly', 2026, '01-01', '2026'), '2027-03-01', 'IR8A for 2026 due 1 March 2027');
eq(due('in_tds_deposit', {}, 'monthly', 2026, '04-01', '2026-03'), '2026-04-30', 'TDS for March due 30 April');
eq(due('in_tds_deposit', {}, 'monthly', 2026, '04-01', '2026-04'), '2026-05-07', 'TDS for April due 7 May');
eq(due('in_24q', {}, 'quarterly', 2026, '04-01', '2026-27 Q1'), '2026-07-31', '24Q April to June due 31 July');
eq(due('in_24q', {}, 'quarterly', 2027, '04-01', '2026-27 Q4'), '2027-05-31', '24Q January to March due 31 May');
eq(due('in_24q', {}, 'quarterly', 2026, '04-01', '2026-27 Q3'), '2027-01-31', '24Q October to December due 31 January of the next year');
eq(due('in_form16', {}, 'yearly', 2027, '04-01', '2026-27'), '2027-06-15', 'Form 16 for FY 2026-27 due 15 June 2027');
eq(due('my_ea', {}, 'yearly', 2027, '01-01', '2027'), '2028-02-29', 'EA for 2027 due the end of February 2028 (a leap year)');
eq(due('my_ea', {}, 'yearly', 2026, '01-01', '2026'), '2027-02-28', 'EA for 2026 due 28 February 2027');
eq(due('my_form_e', {}, 'yearly', 2026, '01-01', '2026'), '2027-03-31', 'Form E due 31 March');
eq(due('my_epf', {}, 'monthly', 2026, '01-01', '2026-12'), '2027-01-15', 'EPF for December due 15 January');
eq(due('ca_t4', {}, 'annual', 2027, '01-01', '2027'), '2028-02-29', 'T4 due the last day of February (2028 leap year, a Tuesday)');
eq(C.ruleFor('ca_roe', {}, 'event').period, 'event', 'event filings make no periodic rows');
eq(C.ruleFor('zz_unknown', {}, 'quarterly'), { period: 'quarter', due: null, fallback: true }, 'an unknown code still gets periods, with no due day');

/* --- declarations merge */
const decl = C.declarations([{ code: 'us-federal', filings: [{ code: 'us_941', name: '941', frequency: 'quarterly' }] }, { code: 'us-ca', region: 'CA', filings: [{ code: 'us_ca_de9', name: 'DE 9' }] }], { code: 'US', filings: [{ code: 'us_941', name: 'dup' }, { code: 'us_state_quarterly', name: 'state' }, { code: 'us_w2', name: 'W-2' }] }, true);
eq(decl.map((d) => d.code + ':' + d.source), ['us_941:pack', 'us_ca_de9:pack', 'us_w2:country', 'us_941_deposit:builtin'], 'packs first, country rows added, the country-wide state row dropped when state packs are on, the 941 deposit added');
eq(C.declarations([], { code: 'JP', filings: [] }, false).map((d) => d.code), ['jp_nencho'], 'Japan adds 年末調整');

/* --- journal */
const slips = [
  { payslip: 'a', cost_center: 'CC1', department: 'ENG', net_minor: 7600, lines: [
    { code: 'BASIC', kind: 'earning', amount_minor: 10000, component: 'c1' }, { code: 'UNPAID', kind: 'earning', amount_minor: -500, component: '' },
    { code: 'TAX', kind: 'deduction', amount_minor: 1500, payee: 'IRS' }, { code: 'K401', kind: 'deduction', amount_minor: 500 },
    { code: 'ER', kind: 'employer', amount_minor: 765, payee: 'IRS' }, { code: 'TRACK', kind: 'info', amount_minor: 99999 },
    { code: 'REIMB', kind: 'reimbursement', amount_minor: 100 },
  ] },
  { payslip: 'b', cost_center: 'CC2', department: 'OPS', net_minor: 5000, lines: [{ code: 'BASIC', kind: 'earning', amount_minor: 6000 }, { code: 'TAX', kind: 'deduction', amount_minor: 1000, payee: 'IRS' }] },
];
const built = J.build({ slips, gl: { wages_expense: '6000', employer_expense: '6100', liabilities: '2100', net_pay: '1010', by_payee: { IRS: '2110' } }, components: { c1: { gl_account: '6010', liability_account: '' } } });
eq(built.balanced, true, 'journal balances');
eq(built.debit_minor, 10000 + 765 + 100 + 6000, 'debits = earnings + employer + reimbursement (the negative earning is a credit on its own account)');
eq(built.credit_minor, built.debit_minor, 'credits equal debits');
eq(built.unset, ['reimbursement_expense'].length ? built.unset : [], 'unset roles reported');
const groups = {};
for (const l of built.lines) groups[l.cost_center] = (groups[l.cost_center] || 0) + l.debit_minor - l.credit_minor;
eq(groups, { CC1: 0, CC2: 0 }, 'each cost centre balances');
eq(built.lines.some((l) => l.account === '6010' && l.debit_minor === 10000), true, 'the component gl_account wins');
eq(built.lines.some((l) => l.account === '6000' && l.credit_minor === 500), true, 'a negative earning becomes a credit');
eq(built.lines.some((l) => l.account === '2110' && l.credit_minor === 1500 + 765), true, 'IRS liabilities by payee, employee and employer');
eq(built.lines.some((l) => l.description.indexOf('TRACK') >= 0 || l.debit_minor === 99999), false, 'info lines stay out');
const unbalanced = J.build({ slips: [{ payslip: 'x', net_minor: 1, lines: [{ code: 'B', kind: 'earning', amount_minor: 5 }] }], gl: {} });
eq(unbalanced.balanced, false, 'a payslip whose net does not match its lines is refused');
const csv = J.csv('xero_csv', { number: 'PR-0001', pay_date: '2026-11-30', currency: 'USD' }, built, { country: 'US' });
eq(csv.split('\r\n')[1].split(',')[1], '11/30/2026', 'Xero date for a US entity');
eq(csv.split('\r\n').filter((l) => /,-\d/.test(l)).length > 0, true, 'Xero credits are negative amounts');

/* --- year-end documents */
const lines = [
  { employment: 'e1', code: 'US_SALARY', kind: 'earning', tags: ['us_fit_wages', 'us_fica_wages'], month: '2026-01', amount: 1000000 },
  { employment: 'e1', code: 'US_SALARY', kind: 'earning', tags: ['us_fit_wages', 'us_fica_wages'], month: '2026-02', amount: 1000000 },
  { employment: 'e1', code: 'US_401K', kind: 'deduction', tags: ['us_pretax_401k'], month: '2026-01', amount: 50000 },
  { employment: 'e1', code: 'US_HSA', kind: 'deduction', tags: ['us_pretax_hsa'], month: '2026-01', amount: 20000 },
  { employment: 'e1', code: 'US_FIT', kind: 'deduction', tags: ['us_tax'], month: '2026-01', amount: 150000 },
  { employment: 'e1', code: 'US_FIT', kind: 'deduction', tags: ['us_tax'], month: '2026-02', amount: 150000 },
  { employment: 'e1', code: 'US_SUPP_WAGES', kind: 'info', tags: ['us_supp_wages', 'us_fit_wages'], month: '2026-02', amount: 777 },
  { employment: 'e1', code: 'US_CA_SIT', kind: 'deduction', pack: 'us-ca', tags: ['us_state_tax'], month: '2026-02', amount: 40000 },
  { employment: 'e1', code: 'US_SS_EE', kind: 'deduction', pack: 'us-federal', tags: ['us_tax'], month: '2026-02', amount: 62000 },
  { employment: 'e1', code: 'US_CA_UI', kind: 'employer', pack: 'us-ca', tags: [], month: '2026-02', amount: 3400 },
  { employment: 'e2', code: 'US_SALARY', kind: 'earning', tags: ['us_fit_wages', 'us_fica_wages'], month: '2026-03', amount: 20000000 },
];
const agg = D.aggregate(lines);
const w2 = D.compute(D.def('w2'), agg, 2026);
const e1 = w2.rows.find((r) => r.employment === 'e1');
eq(e1.boxes['1'], 2000000 - 50000 - 20000, 'W-2 box 1: wages minus 401(k) and HSA (info lines ignored)');
eq(e1.boxes['2'], 300000, 'W-2 box 2 = the sum of the locked US_FIT lines');
eq(e1.boxes['3'], 2000000 - 20000, 'W-2 box 3: HSA through 125 is not FICA wages; 401(k) is');
eq(e1.state, { US_CA_SIT: 40000 }, 'W-2 state lines');
eq(w2.rows.find((r) => r.employment === 'e2').boxes['3'], 18450000, 'W-2 box 3 stops at the 2026 wage base');
eq(w2.totals['2'], 300000, 'totals add the rows');
const q = D.compute(D.def('in_24q'), D.aggregate([
  { employment: 'i1', code: 'IN_TDS', kind: 'deduction', tags: ['in_tds'], month: '2026-04', amount: 100 },
  { employment: 'i1', code: 'IN_TDS', kind: 'deduction', tags: ['in_tds'], month: '2026-07', amount: 200 },
  { employment: 'i1', code: 'IN_TDS', kind: 'deduction', tags: ['in_tds'], month: '2027-03', amount: 400 },
]), 2026);
eq(q.rows[0].quarters, { 1: { paid: 0, tds: 100 }, 2: { paid: 0, tds: 200 }, 4: { paid: 0, tds: 400 } }, '24Q quarters of the April financial year');
eq(D.yearRange(D.def('p60'), 2026), { start: '2026-04-06', end: '2027-04-05', label: '2026-27' }, 'P60 tax year');
eq(D.yearRange(D.def('au_payment_summary'), 2025), { start: '2025-07-01', end: '2026-06-30', label: '2025-26' }, 'Australian financial year');
eq(D.yearRange(D.def('w2'), 2026), { start: '2026-01-01', end: '2026-12-31', label: '2026' }, 'calendar year');
eq(D.defaultYear('2027-02-10', '01-01'), 2026, 'in February people work on last year\'s documents');
eq(D.defaultYear('2026-11-04', '01-01'), 2026, 'in November the current year');
eq(D.defaultYear('2027-05-01', '04-06'), 2026, 'UK in May: the 2026-27 P60s');
const sg = D.compute(D.def('sg_ir8a'), D.aggregate([{ employment: 's', code: 'SG_BASIC', kind: 'earning', tags: ['sg_ow'], month: '2026-01', amount: 500000 }, { employment: 's', code: 'SG_BONUS', kind: 'earning', tags: ['sg_aw'], month: '2026-12', amount: 100000 }]), 2026);
eq(sg.rows[0].boxes.total, 600000, 'IR8A total is salary plus bonus');
const jp = D.compute(D.def('jp_gensen_choshu_hyo'), D.aggregate([{ employment: 'j', code: 'JP_WHT', kind: 'deduction', tags: ['jp_wht'], month: '2026-01', amount: 9000 }, { employment: 'j', code: 'JP_YEA_REFUND', kind: 'reimbursement', tags: ['jp_wht_yea'], month: '2026-12', amount: 3000 }]), 2026);
eq(jp.rows[0].boxes.gensen, 6000, '源泉徴収税額 is withheld tax less the year-end refund');
eq(jp.rows[0].yea_done, true, 'year-end adjustment detected');

/* --- pack diff */
const a = { name: 'A', version: '1', tables: { t: { type: 'brackets', rows: [{ over: 0, rate: 0.1 }] }, gone: { type: 'map', rows: {} } }, steps: [{ var: 'x', expr: '1' }, { code: 'L', amount: 'x' }], profile_fields: [{ key: 'k', label: 'K' }], vectors: [{ name: 'v1' }] };
const b = { name: 'A', version: '2', tables: { t: { type: 'brackets', rows: [{ over: 0, rate: 0.12 }] }, new: { type: 'map', rows: { a: 1 } } }, steps: [{ var: 'x', expr: '2' }, { code: 'L', amount: 'x' }, { code: 'M', amount: '1' }], profile_fields: [{ key: 'k', label: 'K' }, { key: 'z', label: 'Z' }], vectors: [{ name: 'v1' }, { name: 'v2' }] };
const df = P.diff(a, b);
eq(df.meta, [{ field: 'version', before: '1', after: '2' }], 'diff: version changed');
eq(df.tables.map((t) => t.name + ':' + t.change), ['t:changed', 'gone:removed', 'new:added'], 'diff: tables');
eq(df.tables[0].changed_rows, [{ row: 0, before: { over: 0, rate: 0.1 }, after: { over: 0, rate: 0.12 } }], 'diff: the changed row');
eq(df.steps.map((s) => s.key + ':' + s.change), ['var x:changed', 'line M:added'], 'diff: steps');
eq(df.profile_fields.map((f) => f.key + ':' + f.change), ['z:added'], 'diff: profile fields');
eq(df.vectors.added, ['v2'], 'diff: vectors added');

console.log(`units: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
