// Malaysia pack generator: my (PCB / MTD 2026 with zakat), my-epf (draft),
// my-socso (SOCSO, EIS, LINDUNG 24 Jam; draft), my-hrdf (HRD Corp levy).
import { writeModule, RETRIEVED } from './emit.mjs';

const YEAR = { from: '2026-01-01', to: '2026-12-31' };

const PCB_TABLE = [
  { to: 5000, values: { m: 0, r: 0, b13: 0, b2: 0 } },
  { over: 5000, to: 20000, values: { m: 5000, r: 0.01, b13: -400, b2: -800 } },
  { over: 20000, to: 35000, values: { m: 20000, r: 0.03, b13: -250, b2: -650 } },
  { over: 35000, to: 50000, values: { m: 35000, r: 0.06, b13: 600, b2: 600 } },
  { over: 50000, to: 70000, values: { m: 50000, r: 0.11, b13: 1500, b2: 1500 } },
  { over: 70000, to: 100000, values: { m: 70000, r: 0.19, b13: 3700, b2: 3700 } },
  { over: 100000, to: 400000, values: { m: 100000, r: 0.25, b13: 9400, b2: 9400 } },
  { over: 400000, to: 600000, values: { m: 400000, r: 0.26, b13: 84400, b2: 84400 } },
  { over: 600000, to: 2000000, values: { m: 600000, r: 0.28, b13: 136400, b2: 136400 } },
  { over: 2000000, values: { m: 2000000, r: 0.3, b13: 528400, b2: 528400 } }
];

const PCB_SOURCE = { title: 'LHDN, Amendment to: Specification for Monthly Tax Deduction (MTD) Calculations Using Computerized Calculation for 2026 (updated 1 January 2026)', url: 'https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf', retrieved: RETRIEVED, note: 'Normal and additional remuneration formulas, Table 1 (P, M, R, B), reliefs D 9,000, S 4,000, child 2,000, disabled 7,000 and 6,000, EPF relief limit 4,000, terms: two decimals then round up to 5 sen, under 10 ringgit not deducted, zakat, non-resident 30 percent, Exhibit 5 worked examples.' };

function pcbPack() {
  // m(tag) and mc(code): earlier payslips paid in this calendar month (any run kind); the month is computed as one.
  const m = (t) => '(ytd_since("' + t + '", pay_m) - ytd_since("' + t + '", pay_next))';
  const mc = (c) => '(ytd_code_since("' + c + '", pay_m) - ytd_code_since("' + c + '", pay_next))';
  const steps = [
    { check: 'run.frequency == "monthly"', issue: 'my_monthly_only', severity: 'blocker', message: 'PCB (MTD) is computed for monthly pay. Other frequencies are not covered.' },
    { var: 'resident', expr: 'profile.my_resident' },
    { var: 'pay_m', expr: 'month_start(run.pay_date)' },
    { var: 'pay_next', expr: 'add_months(pay_m, 1)' },
    { var: 'n', expr: '12 - month(run.pay_date)', explain: 'Months left in the year after this one.' },
    { var: 'normal_here', expr: 'sum("my_pcb_normal")' },
    { var: 'extra_here', expr: 'sum("my_pcb_additional") + sum("exit_leave_payout")', explain: 'Additional remuneration on this payslip; unused leave paid on leaving (LEAVE_EXIT) counts here as a payment in addition to normal remuneration.' },
    { var: 'normal', expr: 'normal_here + ' + m('my_pcb_normal'), explain: 'Y1: gross normal remuneration of the month, earlier payslips of the month included.' },
    { var: 'extra', expr: 'extra_here + ' + m('my_pcb_additional') + ' + ' + m('exit_leave_payout'), explain: 'Yt: gross additional remuneration of the month (bonus, arrears, irregular allowances), earlier payslips of the month included.' },
    { var: 'still_employed', expr: 'coalesce(employee.end_day, "") == "" || employee.end_day >= pay_m' },
    { check: '!(normal_here == 0 && extra_here > 0 && regular_count_in_month(run.pay_date) == 0 && still_employed)', issue: 'my_pcb_month_pay_missing', severity: 'blocker', message: 'This payslip carries additional remuneration only, and no regular payslip of this month is locked yet. LHDN rule 8 needs this month\'s normal remuneration (Y1): lock the month\'s regular run first, or pay the bonus with it.' },
    { var: 'year_m', expr: 'month_start(run.tax_year_start)' },
    { var: 'hire_m', expr: 'coalesce(employee.hire_day, "") == "" ? pay_m : month_start(employee.hire_day)' },
    { var: 'first_m', expr: 'hire_m > year_m ? hire_m : year_m', explain: 'First month of this employment in the year.' },
    { var: 'paid_before', expr: 'run.periods_paid > 0 || ytd("my_pcb_normal") + ytd("my_pcb_additional") + ytd("exit_leave_payout") + ytd_code("MY_PCB") > 0', explain: 'The history holds pay from this employer earlier this year (a locked payslip or an opening balance).' },
    { check: '!resident || first_m >= pay_m || paid_before || profile.my_pcb_no_earlier_pay', issue: 'my_pcb_year_history_missing', severity: 'blocker', message: 'The employment ran before this month this year, but no payslip or opening balance of those months is in the history, so PCB would count this month alone (Y, K and X would be 0). Add the earlier payslips or an opening balance for this year, or confirm on the tax profile that nothing was paid earlier this year.' },
    { var: 'epf_month', expr: 'sum("my_epf_employee") + ' + m('my_epf_employee') },
    { var: 'epf_normal_month', expr: 'sum("my_epf_normal") + ' + m('my_epf_normal') },
    { check: '!(extra > 0 && epf_month > 0 && epf_normal_month == 0)', issue: 'my_epf_split_missing', severity: 'blocker', message: 'This month has additional remuneration, so PCB needs the EPF on normal remuneration (K1) apart from the EPF on the additional remuneration (Kt). Tag the EPF on normal pay my_epf_normal (the my-epf pack does this).' },
    { var: 'epf_normal_raw', expr: 'extra > 0 ? epf_normal_month : epf_month', explain: 'EPF on normal remuneration (K1); the rest of the month\'s EPF is on additional remuneration (Kt).' },
    { var: 'Y', expr: 'ytd("my_pcb_normal") + ytd("my_pcb_additional") + ytd("exit_leave_payout") - ' + m('my_pcb_normal') + ' - ' + m('my_pcb_additional') + ' - ' + m('exit_leave_payout') + ' + profile.my_tp3_gross', explain: 'Remuneration of earlier months this year, previous employer (TP3) included.' },
    { var: 'K', expr: 'min(4000, ytd("my_epf_employee") - ' + m('my_epf_employee') + ' + profile.my_tp3_epf)' },
    { var: 'K1', expr: 'min(epf_normal_raw, 4000 - K)' },
    { var: 'Kt', expr: 'min(max(0, epf_month - epf_normal_raw), 4000 - K - K1)' },
    { var: 'K2', expr: 'n <= 0 ? 0 : round_down(max(0, min(K1, (4000 - (K + K1)) / n)), 0.01)', explain: 'Estimated EPF for each later month: the lower of K1 and the unused 4,000 EPF relief spread over n.' },
    { var: 'cat', expr: 'profile.my_pcb_category' },
    { var: 'kids', expr: 'cat == "1" ? 0 : profile.my_children' },
    { var: 'reliefs', expr: '9000 + (cat == "2" ? 4000 : 0) + (profile.my_disabled ? 7000 : 0) + (cat == "2" && profile.my_spouse_disabled ? 6000 : 0) + 2000 * kids + ytd("my_tp1_relief") + profile.my_tp3_lp + sum("my_tp1_relief")', explain: 'D + S + DU + SU + QC + (LP + LP1): individual 9,000; spouse 4,000 (category 2); disabled 7,000; disabled spouse 6,000; 2,000 per qualifying child unit; TP1 deductions this year (earlier payslips of the month included) and on this payslip.' },
    { var: 'P', expr: 'round_down((Y - K) + (normal - K1) + (normal - K2) * n - reliefs, 0.01)', explain: 'Chargeable income for the year without this month\'s additional remuneration.' },
    { var: 'bcol', expr: 'cat == "2" ? "b2" : "b13"' },
    { var: 'Z', expr: 'ytd("my_zakat") - ' + m('my_zakat') + ' + profile.my_tp3_zakat', explain: 'Zakat paid in earlier months this year.' },
    { var: 'X', expr: 'ytd_code("MY_PCB") - ' + mc('MY_PCB') + ' + profile.my_tp3_pcb', explain: 'MTD paid in earlier months this year.' },
    { var: 'mtd_raw', expr: 'P <= 0 ? 0 : round_up(round_down(max(0, ((P - band("my_pcb_rates", P, "m")) * band("my_pcb_rates", P, "r") + band("my_pcb_rates", P, bcol) - (Z + X)) / (n + 1)), 0.01), 0.05)', explain: '[(P - M) R + B - (Z + X)] / (n + 1), two decimals, then up to the next 5 sen.' },
    { var: 'mtd_month', expr: 'mtd_raw < 10 ? 0 : mtd_raw', explain: 'Under 10 ringgit before zakat is not deducted.' },
    { var: 'zakat_now', expr: 'sum("my_zakat") + ' + m('my_zakat'), explain: 'Zakat deducted from salary this month.' },
    { var: 'net_mtd', expr: 'max(0, mtd_month - zakat_now)', explain: 'Zakat paid by salary deduction this month reduces MTD; net MTD under 10 is still deducted.' },
    { var: 'year_mtd', expr: 'X + mtd_raw * (n + 1)', explain: 'Step 1[E]: MTD for the year on normal remuneration.' },
    { var: 'K2b', expr: 'n <= 0 ? 0 : round_down(max(0, min(K1, (4000 - (K + K1 + Kt)) / n)), 0.01)' },
    { var: 'P2', expr: 'round_down((Y - K) + (normal - K1) + (normal - K2b) * n + (extra - Kt) - reliefs, 0.01)', explain: 'Step 2: chargeable income with this month\'s additional remuneration.' },
    { var: 'tax_year', expr: 'P2 <= 0 ? 0 : max(0, (P2 - band("my_pcb_rates", P2, "m")) * band("my_pcb_rates", P2, "r") + band("my_pcb_rates", P2, bcol))', explain: 'Step 3: (P - M) R + B.' },
    { var: 'add_raw', expr: 'extra <= 0 ? 0 : round_up(round_down(max(0, tax_year - (year_mtd + Z)), 0.01), 0.05)', explain: 'Step 4: tax for the year less MTD for the year and zakat paid.' },
    { var: 'mtd_add', expr: 'add_raw < 10 ? 0 : add_raw', explain: 'Additional remuneration MTD under 10 is not deducted.' },
    { var: 'month_mtd', expr: 'resident ? net_mtd + mtd_add : (normal + extra) * 0.3', explain: 'Step 5 for the month (residents); 30 percent of the month\'s remuneration for non-residents.' },
    { code: 'MY_PCB', name: 'PCB / MTD (income tax)', kind: 'deduction', stage: 'statutory', amount: 'max(0, month_mtd - ' + mc('MY_PCB') + ')', round: { mode: 'half_up', step: 0.01 }, tags: ['my_pcb'], payee: 'LHDN (Inland Revenue Board)', filing: 'my_cp39', explain: 'MTD for the month less MTD already deducted by earlier payslips of the month.' }
  ];
  const pay = (m) => ({ period_start: '2026-' + m + '-01', period_end: '2026-' + m + '-28', pay_date: '2026-' + m + '-28' });
  const ex = { my_pcb_category: '3', my_children: 3 };
  const normal = (amt, epf) => [{ code: 'MY_BASIC', name: 'Basic salary', kind: 'earning', amount: amt, tags: ['my_pcb_normal'] }, { code: 'EPF', name: 'EPF (employee)', kind: 'deduction', stage: 'statutory', amount: epf, tags: ['my_epf_employee'] }];
  const ref = 'LHDN MTD 2026 specification, Exhibit 5 (example of calculation, printed for 2025 with the unchanged 2026 formula): married, wife working (category 3), 3 children, normal remuneration 5,500, EPF 605. ';
  const vectors = [
    { name: 'LHDN Exhibit 5: January', source: 'official', reference: ref + 'K2 = (4,000 - 605) / 11 = 308.63; P = 4,895 + (5,500 - 308.63) x 11 - 15,000 = 47,000.07; MTD = [(47,000.07 - 35,000) x 6% + 600] / 12 = 110.00.', input: { run: pay('01'), profile: ex, lines: normal(5500, 605) }, expect: { MY_PCB: 110 }, expect_vars: { K2: 308.63, P: 47000.07 } },
    { name: 'LHDN Exhibit 5: February', source: 'official', reference: ref + 'K2 = (4,000 - 1,210) / 10 = 279.00; P = 47,000.00; MTD = (720 + 600 - 110) / 11 = 110.00.', input: { run: pay('02'), profile: ex, lines: normal(5500, 605), history: [{ pay_date: '2026-01-28', period_end: '2026-01-28', kind: 'regular', by_tag: { my_pcb_normal: 5500, my_epf_employee: 605 }, by_code: { MY_PCB: 110 } }] }, expect: { MY_PCB: 110 }, expect_vars: { K2: 279, P: 47000 } },
    { name: 'LHDN Exhibit 5: March with TP1 deductions of 300', source: 'official', reference: ref + 'Books 100 and parents\' medical 200 on TP1. K2 = 242.77; P = 62,000.07 - 15,300 = 46,700.07; MTD = (702.00 + 600 - 220) / 10 = 108.20.', input: { run: pay('03'), profile: ex, lines: normal(5500, 605).concat([{ code: 'TP1', name: 'TP1 deductions', kind: 'info', amount: 300, tags: ['my_tp1_relief'] }]), history: [{ pay_date: '2026-02-28', period_end: '2026-02-28', kind: 'regular', by_tag: { my_pcb_normal: 11000, my_epf_employee: 1210 }, by_code: { MY_PCB: 220 } }] }, expect: { MY_PCB: 108.2 }, expect_vars: { K2: 242.77, P: 46700.07 } },
    { name: 'LHDN Exhibit 5: April with a bonus of 8,250', source: 'official', reference: ref + 'TP1 300 in March and 300 in April; bonus 8,250 with EPF 908. Step 1: K2 = 197.50, P = 46,400, MTD = 106.20, MTD for the year 1,284.00. Step 2: K2 = 84.00, P = 54,650. Step 3: tax 2,011.50. Step 4: 727.50. Step 5: 106.20 + 727.50 = 833.70.', input: { run: pay('04'), profile: ex, lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 5500, tags: ['my_pcb_normal'] }, { code: 'MY_BONUS', kind: 'earning', amount: 8250, tags: ['my_pcb_additional'] }, { code: 'EPF', kind: 'deduction', stage: 'statutory', amount: 1513, tags: ['my_epf_employee'] }, { code: 'EPF_NORMAL', kind: 'info', amount: 605, tags: ['my_epf_normal'] }, { code: 'TP1', kind: 'info', amount: 300, tags: ['my_tp1_relief'] }], history: [{ pay_date: '2026-03-28', period_end: '2026-03-28', kind: 'regular', by_tag: { my_pcb_normal: 16500, my_epf_employee: 1815, my_tp1_relief: 300 }, by_code: { MY_PCB: 328.2 } }] }, expect: { MY_PCB: 833.7 }, expect_vars: { P: 46400, mtd_raw: 106.2, year_mtd: 1284, P2: 54650, tax_year: 2011.5, add_raw: 727.5 } },
    { name: 'Non-resident: 30 percent', source: 'official', reference: 'LHDN specification section D(a): 3,000 x 30% = 900.00.', input: { run: pay('05'), profile: { my_resident: false, my_pcb_category: '1' }, lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 3000, tags: ['my_pcb_normal'] }] }, expect: { MY_PCB: 900 } },
    { name: 'Zakat by salary deduction lowers MTD', source: 'derived', reference: 'Single (category 1), January, 5,000 with EPF 550: K2 = (4,000 - 550) / 11 = 313.63; P = 4,450 + 4,686.37 x 11 - 9,000 = 47,000.07; MTD = 1,320.00 / 12 = 110.00; zakat 50 this month: net 60.00.', input: { run: pay('01'), profile: { my_pcb_category: '1' }, lines: normal(5000, 550).concat([{ code: 'ZAKAT', name: 'Zakat', kind: 'deduction', stage: 'post', amount: 50, tags: ['my_zakat'] }]) }, expect: { MY_PCB: 60 } },
    { name: 'QA B-5: bonus paid in its own payslip after the month\'s regular pay', source: 'derived', reference: 'LHDN additional remuneration method (MTD 2026 specification, Steps 1 to 5) with the month\'s normal remuneration read from the locked November regular payslip (rule 8). Hired in November: 25,000 a month, category 1, no EPF; November PCB 480 = [(25,000 + 25,000 x 1 - 9,000 - 35,000) x 6% + 600] / 2. Bonus 5,000: Step 1 P = 41,000, MTD 480.00, MTD for the year 0 + 480 x 2 = 960; Step 2 P = 25,000 + 25,000 + 5,000 - 9,000 = 46,000; Step 3 tax (46,000 - 35,000) x 6% + 600 = 1,260; Step 4 1,260 - 960 = 300.00; the month\'s MTD 780 less 480 already deducted = 300.00.', input: { run: { kind: 'bonus', period_start: '2026-11-01', period_end: '2026-11-30', pay_date: '2026-11-30' }, employee: { hire_day: '2026-11-01' }, profile: { my_pcb_category: '1' }, lines: [{ code: 'MY_BONUS', kind: 'earning', amount: 5000, tags: ['my_pcb_additional'] }], history: [{ pay_date: '2026-11-30', period_end: '2026-11-30', kind: 'regular', by_tag: { my_pcb_normal: 25000 }, by_code: { MY_PCB: 480 } }] }, expect: { MY_PCB: 300 }, expect_vars: { P: 41000, P2: 46000, tax_year: 1260, year_mtd: 960 } },
    { name: 'Bonus payslip before the month\'s regular pay is locked: blocked', source: 'derived', reference: 'LHDN rule 8: additional remuneration paid before the monthly remuneration uses the remuneration that will be paid that month, which the history does not hold yet, so the payslip is blocked instead of taking it as 0.', input: { run: { kind: 'bonus', period_start: '2026-11-01', period_end: '2026-11-30', pay_date: '2026-11-15' }, profile: { my_pcb_category: '1' }, lines: [{ code: 'MY_BONUS', kind: 'earning', amount: 5000, tags: ['my_pcb_additional'] }], history: [{ pay_date: '2026-10-31', period_end: '2026-10-31', kind: 'regular', by_tag: { my_pcb_normal: 25000 }, by_code: { MY_PCB: 480 } }] }, expect: {}, expect_issues: ['my_pcb_month_pay_missing'] },
    { name: 'Final pay with unused leave (LEAVE_EXIT) as additional remuneration', source: 'derived', reference: 'Category 1, 10,000 a month, no EPF; January to November PCB 1,012.50 each (P = 111,000; tax 9,400 + 25% x 11,000 = 12,150; 11,137.50 paid). December final pay 10,000 plus LEAVE_EXIT 769.23: Step 1 MTD 12,150 - 11,137.50 = 1,012.50 (MTD for the year 12,150); Step 2 P = 111,769.23; Step 3 tax 9,400 + 25% x 11,769.23 = 12,342.31; Step 4 192.30; total 1,204.80.', input: { run: { kind: 'termination', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-31' }, employee: { end_day: '2026-12-31' }, profile: { my_pcb_category: '1' }, lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 10000, tags: ['my_pcb_normal'] }, { code: 'LEAVE_EXIT', kind: 'earning', amount: 769.23, tags: ['exit_leave_payout', 'termination'] }], history: [{ pay_date: '2026-11-30', period_end: '2026-11-30', kind: 'regular', by_tag: { my_pcb_normal: 110000 }, by_code: { MY_PCB: 11137.5 } }] }, expect: { MY_PCB: 1204.8 }, expect_vars: { mtd_raw: 1012.5, add_raw: 192.3 } },
    { name: 'Final pay with no earlier payslips of the year in the history: blocked, not 0', source: 'derived', reference: 'payroll-core t06: hired 5 January 2026, last day 15 December, final pay 3,870.97 and LEAVE_EXIT 2,307.69, and no payslip or opening balance for January to November. With Y = 0 the LHDN formula counts December alone (P = 3,870.97 - 9,000 < 0) and gives 0, so the payslip is blocked until the earlier pay is in the history or the profile confirms there was none.', input: { run: { kind: 'termination', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-15' }, employee: { hire_day: '2026-01-05', end_day: '2026-12-15' }, profile: { my_pcb_category: '1' }, lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 3870.97, tags: ['my_pcb_normal'] }, { code: 'LEAVE_EXIT', kind: 'earning', amount: 2307.69, tags: ['exit_leave_payout', 'termination'] }] }, expect: { MY_PCB: 0 }, expect_issues: ['my_pcb_year_history_missing'] },
    { name: 'Final pay in December with the year\'s payslips: PCB on the leave payment', source: 'derived', reference: 'The same leaver paid 8,000 a month January to November (88,000; PCB 577.50 a month = [(96,000 - 9,000 - 70,000) x 19% + 3,700] / 12, X = 6,352.50). December (n = 0): Step 1 P = 88,000 + 3,870.97 - 9,000 = 82,870.97, tax 3,700 + 19% x 12,870.97 = 6,145.48, less X: below 0, so 0; MTD for the year 6,352.50. Step 2 P = 85,178.66; Step 3 tax 3,700 + 19% x 15,178.66 = 6,583.94; Step 4 6,583.94 - 6,352.50 = 231.44, up to 5 sen 231.45.', input: { run: { kind: 'termination', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-15' }, employee: { hire_day: '2026-01-05', end_day: '2026-12-15' }, profile: { my_pcb_category: '1' }, lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 3870.97, tags: ['my_pcb_normal'] }, { code: 'LEAVE_EXIT', kind: 'earning', amount: 2307.69, tags: ['exit_leave_payout', 'termination'] }], history: [{ pay_date: '2026-11-30', period_end: '2026-11-30', kind: 'regular', by_tag: { my_pcb_normal: 88000 }, by_code: { MY_PCB: 6352.5 } }] }, expect: { MY_PCB: 231.45 }, expect_vars: { P: 82870.97, P2: 85178.66, mtd_raw: 0, add_raw: 231.45 } },
    { name: 'Final pay after a year without pay, confirmed on the profile', source: 'derived', reference: 'Same final pay with "No pay from this employer earlier this year" set: the year is December alone, P below 0, PCB 0 and no blocker.', input: { run: { kind: 'termination', period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-15' }, employee: { hire_day: '2026-01-05', end_day: '2026-12-15' }, profile: { my_pcb_category: '1', my_pcb_no_earlier_pay: true }, lines: [{ code: 'MY_BASIC', kind: 'earning', amount: 3870.97, tags: ['my_pcb_normal'] }, { code: 'LEAVE_EXIT', kind: 'earning', amount: 2307.69, tags: ['exit_leave_payout', 'termination'] }] }, expect: { MY_PCB: 0 } },
    { name: 'MTD under 10 ringgit is not deducted', source: 'derived', reference: 'Single, January, 3,500 with EPF 385: K2 = 328.63; P = 3,115 + 3,171.37 x 11 - 9,000 = 29,000.07; [(29,000.07 - 20,000) x 3% - 250] / 12 = 1.66, up to 1.70; under 10, so nil.', input: { run: pay('01'), profile: { my_pcb_category: '1' }, lines: normal(3500, 385) }, expect: { MY_PCB: 0 }, expect_vars: { mtd_raw: 1.7 } }
  ];
  const money = (key, label, help, form) => ({ key, label, type: 'money', default: 0, min: 0, help, form });
  return {
    code: 'my', country: 'MY', region: '', name: 'Malaysia 2026 monthly tax deduction (PCB / MTD) with zakat', version: '2026.4', effective_from: YEAR.from, effective_to: YEAR.to, currency: 'MYR', tax_year: { start: '01-01' }, date_basis: 'pay_date', requires: [], order: 30, ship: 'active',
    sources: [PCB_SOURCE, { title: 'LHDN, Taklimat pengurusan PCB (T2024 slides)', url: 'https://www.hasil.gov.my/wp-content/uploads/T2024_slaid-taklimat-pengurusan-pcb.pdf', retrieved: RETRIEVED, note: 'Payment by the 15th of the following month; zakat reduces PCB. Scanned slides, read through the research notes.' }],
    notes: 'Covers the LHDN computerised calculation for normal remuneration and for additional remuneration (Steps 1 to 5), residents by category 1, 2 or 3 with child relief units, disabled individual and spouse, the 4,000 EPF relief with the K2 estimate, TP1 optional deductions (input lines tagged my_tp1_relief), previous employment from TP3, zakat by salary deduction, the 10 ringgit rules and rounding up to 5 sen, and the 30 percent rate for non-residents. Each calendar month is computed as one: a bonus, final or off-cycle payslip adds to the month\'s remuneration from earlier payslips of the month (normal pay Y1 from the locked regular payslip, rule 8) and carries the month\'s MTD less MTD already deducted; a bonus-only payslip with no locked regular payslip of the month is blocked (my_pcb_month_pay_missing). A payslip whose employment ran in earlier months of the year with no payslip or opening balance of them in the history is blocked (my_pcb_year_history_missing) unless the profile confirms nothing was paid, because Y, K and X would silently be 0. The month of cessation uses the specification\'s formula unchanged (n is the months left in the year; a later employer continues from TP3). Unused leave paid on leaving (LEAVE_EXIT, tag exit_leave_payout) is additional remuneration (the specification\'s "any other payment in addition to normal remuneration"). EPF amounts come from lines tagged my_epf_employee (the my-epf pack or your own lines); when a month has additional remuneration, tag the EPF on normal pay my_epf_normal so K1 and Kt split as LHDN requires. Not covered: the Returning Expert Programme, knowledge workers in the specified region and C-suite formulas, CP38 instalments, departure levy, the PCB text file (payroll builds it), and Budget 2027 changes (new bands and 12,000 personal relief from YA2027 need a 2027 version).',
    profile_fields: [
      { key: 'my_resident', label: 'Tax resident in Malaysia', type: 'boolean', default: true, help: 'Non-residents pay 30 percent of remuneration.' },
      { key: 'my_pcb_category', label: 'PCB category', type: 'enum', default: '1', required: true, form: 'TP1 / TP3', options: [{ value: '1', label: 'Category 1: single' }, { value: '2', label: 'Category 2: married, spouse not working' }, { value: '3', label: 'Category 3: married with spouse working, divorced, widowed, or single with an adopted child' }] },
      { key: 'my_children', label: 'Qualifying child units', type: 'number', default: 0, min: 0, help: 'One per child under 18 or studying; 4 for a child 18 or over studying at diploma level or above (or a degree abroad) and for a disabled child; 8 for a disabled child studying at that level (LHDN table).' },
      { key: 'my_disabled', label: 'Employee is disabled', type: 'boolean', default: false },
      { key: 'my_spouse_disabled', label: 'Spouse is disabled (category 2)', type: 'boolean', default: false },
      { key: 'my_pcb_no_earlier_pay', label: 'No pay from this employer earlier this year', type: 'boolean', default: false, help: 'Confirms that months of this employment before the current one this year paid nothing (for example unpaid leave), so PCB may count from this month.' },
      money('my_tp3_gross', 'Previous employment this year: gross remuneration', '', 'TP3'),
      money('my_tp3_epf', 'Previous employment this year: EPF', '', 'TP3'),
      money('my_tp3_pcb', 'Previous employment this year: MTD paid', '', 'TP3'),
      money('my_tp3_zakat', 'Previous employment this year: zakat paid', '', 'TP3'),
      money('my_tp3_lp', 'Previous employment this year: other deductions claimed', '', 'TP3')
    ],
    tags: [
      { tag: 'my_pcb_normal', label: 'Normal remuneration (taxable)', help: 'Fixed monthly pay, commissions paid monthly; exclude exempt allowances.' },
      { tag: 'my_pcb_additional', label: 'Additional remuneration (taxable)', help: 'Bonus, arrears, irregular commissions and allowances, gratuity.' },
      { tag: 'my_epf_employee', label: 'EPF employee contribution' },
      { tag: 'my_epf_normal', label: 'EPF on normal remuneration only (info)' },
      { tag: 'my_tp1_relief', label: 'TP1 deductions approved this month (info)' },
      { tag: 'my_zakat', label: 'Zakat deducted from salary' },
      { tag: 'exit_leave_payout', label: 'Unused leave paid on leaving (LEAVE_EXIT)', help: 'Set by payroll; PCB treats it as additional remuneration. Do not also tag it my_pcb_additional.' }
    ],
    seed_components: [
      { code: 'MY_BASIC', name: 'Basic salary', kind: 'earning', stage: '', calc: 'fixed', tags: ['my_pcb_normal', 'my_epf_wages', 'my_socso_wages', 'my_hrdf_wages'], taxable: true, sort: 10 },
      { code: 'MY_FIXED_ALLOWANCE', name: 'Fixed allowance', kind: 'earning', stage: '', calc: 'fixed', tags: ['my_pcb_normal', 'my_epf_wages', 'my_socso_wages', 'my_hrdf_wages'], taxable: true, sort: 20 },
      { code: 'MY_OVERTIME', name: 'Overtime', kind: 'earning', stage: '', calc: 'input', tags: ['my_pcb_normal', 'my_socso_wages'], taxable: true, sort: 30 },
      { code: 'MY_BONUS', name: 'Bonus', kind: 'earning', stage: '', calc: 'input', tags: ['my_pcb_additional', 'my_epf_wages', 'my_epf_wages_add'], taxable: true, sort: 40 },
      { code: 'LEAVE_EXIT', name: 'Payment for unused annual leave on leaving', kind: 'earning', stage: '', calc: 'days', tags: [], taxable: true, sort: 45 },
      { code: 'MY_ZAKAT', name: 'Zakat (salary deduction)', kind: 'deduction', stage: 'post', calc: 'input', tags: ['my_zakat'], taxable: false, sort: 90 }
    ],
    tables: { my_pcb_rates: { type: 'bands', rows: PCB_TABLE } },
    steps,
    vectors,
    min_wage: { monthly: 1700, note: 'RM1,700 a month since 1 February 2025 (all employers from 1 August 2025); Budget 2027 proposes RM2,000 from June 2027 with an MSME exemption.' },
    filings: [
      { code: 'my_cp39', name: 'PCB payment and data (e-PCB Plus)', frequency: 'monthly', due_rule: '15th of the following month', form: 'e-PCB Plus (MyTax)' },
      { code: 'my_ea', name: 'Form EA to employees', frequency: 'yearly', due_rule: 'end of February', form: 'Form EA' },
      { code: 'my_form_e', name: 'Form E with CP8D', frequency: 'yearly', due_rule: '31 March', form: 'Form E / CP8D (e-Data Praisi)' }
    ],
    documents: [{ code: 'my_ea', name: 'Form EA data', year_end: true }, { code: 'my_cp8d', name: 'CP8D data', year_end: true }]
  };
}

const SECONDARY_MY = [
  { title: 'Swingvy, EPF contribution rate Malaysia (22 Oct 2026)', url: 'https://www.swingvy.com/blog-my/epf-contribution-rate-malaysia', retrieved: RETRIEVED, note: 'Secondary. Categories and rates; Third Schedule up to RM20,000; above, exact percent with the total rounded up to the ringgit.' },
  { title: 'The Star / Lockton on foreign worker EPF from October 2025 wages', url: 'https://global.lockton.com/us/en/news-insights/malaysia-introduces-mandatory-epf-contributions-for-foreign-employees', retrieved: RETRIEVED, note: 'Secondary. 2 percent employee and 2 percent employer; domestic workers excluded.' }
];

const KWSP_SOURCE = { title: 'KWSP, Third Schedule of the EPF Act 1991 (subsection 43(1)), Parts A to E, June 2022 edition (kwsp.gov.my PDF jadual-ketiga-bi-pdf-1, read from the web.archive.org copy of 28 July 2024)', url: 'https://www.kwsp.gov.my/documents/d/guest/jadual-ketiga-bi-pdf-1', retrieved: RETRIEVED, note: 'kwsp.gov.my answers 403; the archived copy of the official PDF was read. All 2,000 rows of Parts A to E (RM20 bands to 5,000, RM100 bands to 20,000) were checked by program: each share is the rate on the band\'s upper limit rounded up to the ringgit (Parts B and D: employer RM5). Above RM20,000 the exact rate, rounded up to the ringgit. Note to Part A and C: a bonus that takes a month over RM5,000 for an employee paid RM5,000 or less keeps the 13 (6.5) percent employer rate on the month\'s wages.' };

function epfPack() {
  const m = (t) => '(ytd_since("' + t + '", wage_month) - ytd_since("' + t + '", next_month))';
  const mc = (c) => '(ytd_code_since("' + c + '", wage_month) - ytd_code_since("' + c + '", next_month))';
  const base = (x) => '(' + x + ' <= 10 ? 0 : (' + x + ' > 20000 ? ' + x + ' : (' + x + ' <= 5000 ? ceil(' + x + ' / 20) * 20 : ceil(' + x + ' / 100) * 100)))';
  const steps = [
    { var: 'cat', expr: 'profile.my_epf_category' },
    { check: 'cat != "foreign"', issue: 'my_epf_foreign_unverified', severity: 'blocker', message: 'The Third Schedule part for foreign workers (2 percent and 2 percent from October 2025 wages) was not readable from KWSP, so this version does not compute it. Enter EPF by hand for this employee.' },
    { var: 'on', expr: 'cat != "none" && cat != "foreign"' },
    { check: 'sum("exit_leave_payout") <= 0', issue: 'my_epf_exit_leave_classify', severity: 'warning', message: 'Unused leave paid on leaving (LEAVE_EXIT) is not counted as EPF wages by this pack; whether KWSP treats it as wages was not confirmed. HR must classify it and enter EPF by hand if it is wages.' },
    { var: 'wage_month', expr: 'month_start(run.period_end)', explain: 'EPF is due on the wages for the month, across every payslip of the month.' },
    { var: 'next_month', expr: 'add_months(wage_month, 1)' },
    { var: 'age', expr: 'age_on(add_days(wage_month, -1))', explain: 'Age on the last day of the previous month: the 60-and-over parts apply from the month after the 60th birthday (assumed; the KWSP rule for the birthday month was not read).' },
    { var: 'over60', expr: 'age >= 60' },
    { var: 'part', expr: 'cat == "citizen" ? (over60 ? "E" : "A") : (cat == "elected_post1998" ? (over60 ? "D" : "B") : (over60 ? "C" : "A"))', explain: 'Third Schedule part: A citizens, PRs and pre-1998 electors under 60; B post-1998 electors under 60; C PRs and pre-1998 electors 60 and over; D post-1998 electors 60 and over; E citizens 60 and over.' },
    { var: 'w', expr: 'sum("my_epf_wages") + ' + m('my_epf_wages'), explain: 'Wages for the month, earlier payslips of the month included.' },
    { var: 'w_add', expr: 'sum("my_epf_wages_add") + ' + m('my_epf_wages_add') },
    { var: 'w_normal', expr: 'w - w_add' },
    { var: 'ee_rate', expr: 'profile.my_epf_employee_rate > 0 ? profile.my_epf_employee_rate : (part == "A" || part == "B" ? 0.11 : (part == "C" || part == "D" ? 0.055 : 0))' },
    { var: 'er_low', expr: 'part == "A" ? 0.13 : (part == "C" ? 0.065 : 0.04)' },
    { var: 'er_high', expr: 'part == "A" ? 0.12 : (part == "C" ? 0.06 : 0.04)' },
    { var: 'bonus_note', expr: '(part == "A" || part == "C") && w_normal <= 5000 && w > 5000', explain: 'Note to Parts A and C: a bonus month over RM5,000 for an employee paid RM5,000 or less keeps the lower-wage employer rate on the month\'s wages.' },
    { var: 'er_month', expr: 'w <= 10 ? 0 : (part == "B" || part == "D" ? 5 : (bonus_note ? ceil(er_low * w) : ceil((w <= 5000 ? er_low : er_high) * ' + base('w') + ')))', explain: 'Employer share for the month from the Third Schedule.' },
    { var: 'ee_month', expr: 'ceil(ee_rate * ' + base('w') + ')', explain: 'Employee share for the month from the Third Schedule.' },
    { var: 'ee_normal_month', expr: 'ceil(ee_rate * ' + base('w_normal') + ')', explain: 'Employee share on normal remuneration alone (K1 for PCB).' },
    { code: 'MY_EPF_EE', name: 'EPF (employee)', kind: 'deduction', stage: 'statutory', when: 'on', amount: 'ee_month - ' + mc('MY_EPF_EE'), round: { mode: 'half_up', step: 0.01 }, tags: ['my_epf_employee'], payee: 'KWSP (EPF)', filing: 'my_epf', explain: 'The month\'s employee share less what earlier payslips of the month deducted.' },
    { code: 'MY_EPF_EE_NORMAL', name: 'EPF on normal remuneration (for PCB)', kind: 'info', when: 'on', amount: 'ee_normal_month - ' + m('my_epf_normal'), round: { mode: 'half_up', step: 0.01 }, tags: ['my_epf_normal'] },
    { code: 'MY_EPF_ER', name: 'EPF (employer)', kind: 'employer', when: 'on', amount: 'er_month - ' + mc('MY_EPF_ER'), round: { mode: 'half_up', step: 0.01 }, payee: 'KWSP (EPF)', filing: 'my_epf', explain: 'The month\'s employer share less what earlier payslips of the month charged.' }
  ];
  const run = { period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30' };
  const wl = (amt) => [{ code: 'B', kind: 'earning', amount: amt, tags: ['my_epf_wages'] }];
  const ofc = 'KWSP Third Schedule (June 2022 edition) ';
  return {
    code: 'my-epf', country: 'MY', region: '', name: 'Malaysia EPF (KWSP) contributions', version: '2026.3', effective_from: YEAR.from, effective_to: YEAR.to, currency: 'MYR', tax_year: { start: '01-01' }, date_basis: 'period_end', requires: [], order: 10, ship: 'draft',
    sources: [KWSP_SOURCE].concat(SECONDARY_MY),
    notes: 'DRAFT (activation-ready, needs one check). The contribution amounts now follow the official KWSP Third Schedule Parts A to E: all 2,000 printed rows of the June 2022 edition match this pack by program (rates on the band\'s upper limit, rounded up to the ringgit; RM5 employer for post-1998 electors; exact rate above RM20,000; the bonus note to Parts A and C). Still to confirm before activating: that KWSP\'s current edition (published with the October 2025 foreign worker amendment, unreadable here because kwsp.gov.my answers 403) left Parts A to E unchanged, and the month the 60-and-over parts start (the pack starts them the month after the 60th birthday). Foreign workers (2 and 2 percent) are blocked (my_epf_foreign_unverified). The month is computed as one across payslips: each payslip carries the month\'s share less what earlier payslips of the month took, so a bonus payslip does not charge the band twice. The my pack reads MY_EPF_EE (tag my_epf_employee) and MY_EPF_EE_NORMAL (tag my_epf_normal) for PCB.',
    profile_fields: [
      { key: 'my_epf_category', label: 'EPF category', type: 'enum', default: 'citizen', options: [{ value: 'citizen', label: 'Malaysian citizen' }, { value: 'pr_pre1998', label: 'Permanent resident, or non-citizen who elected before 1 August 1998' }, { value: 'elected_post1998', label: 'Non-citizen who elected on or after 1 August 1998' }, { value: 'foreign', label: 'Foreign worker (2% and 2%, not computed in this version)' }, { value: 'none', label: 'Not liable (for example domestic workers)' }] },
      { key: 'my_epf_employee_rate', label: 'Employee EPF rate override', type: 'number', default: 0, min: 0, max: 1, help: 'A higher employee rate the employee elected (Form KWSP 17A), applied to the same band. 0 uses the statutory rate.' }
    ],
    tags: [{ tag: 'my_epf_wages', label: 'EPF wages' }, { tag: 'my_epf_wages_add', label: 'EPF wages that are additional remuneration' }, { tag: 'exit_leave_payout', label: 'Unused leave paid on leaving (LEAVE_EXIT)', help: 'Not counted by this pack; the payslip warns so HR classifies it.' }],
    seed_components: [],
    tables: {},
    steps,
    vectors: [
      { name: 'Part A, wages 5,500', source: 'official', reference: ofc + 'Part A row 5,400.01 to 5,500.00: employer 660.00, employee 605.00.', input: { run, employee: { birth_date: '1991-02-01' }, profile: { my_epf_category: 'citizen' }, lines: wl(5500) }, expect: { MY_EPF_EE: 605, MY_EPF_ER: 660 } },
      { name: 'Part A, wages 4,910', source: 'official', reference: ofc + 'Part A row 4,900.01 to 4,920.00: employer 640.00, employee 542.00.', input: { run, employee: { birth_date: '1991-02-01' }, profile: { my_epf_category: 'citizen' }, lines: wl(4910) }, expect: { MY_EPF_EE: 542, MY_EPF_ER: 640 } },
      { name: 'Part B, post-1998 elector, wages 230', source: 'official', reference: ofc + 'Part B row 220.01 to 240.00: employer 5.00, employee 27.00.', input: { run, employee: { birth_date: '1991-02-01' }, profile: { my_epf_category: 'elected_post1998' }, lines: wl(230) }, expect: { MY_EPF_EE: 27, MY_EPF_ER: 5 } },
      { name: 'Part C, permanent resident aged 62, wages 4,830', source: 'official', reference: ofc + 'Part C row 4,820.01 to 4,840.00: employer 315.00, employee 267.00.', input: { run, employee: { birth_date: '1964-01-10' }, profile: { my_epf_category: 'pr_pre1998' }, lines: wl(4830) }, expect: { MY_EPF_EE: 267, MY_EPF_ER: 315 } },
      { name: 'Part E, citizen aged 61, wages 3,000', source: 'official', reference: ofc + 'Part E row 2,980.01 to 3,000.00: employer 120.00, employee 0.00.', input: { run, employee: { birth_date: '1965-01-10' }, profile: { my_epf_category: 'citizen' }, lines: wl(3000) }, expect: { MY_EPF_EE: 0, MY_EPF_ER: 120 } },
      { name: 'Bonus in its own payslip: the month\'s wages, no second charge', source: 'derived', reference: 'Regular payslip 4,000 (Part A row 3,980.01 to 4,000.00: 520.00 and 440.00). Bonus 2,000 in the same month: month wages 6,000; employee from row 5,900.01 to 6,000.00 = 660, less 440 = 220; employer under the Part A note (paid 5,000 or less, bonus takes the month over) 13% x 6,000 = 780, less 520 = 260; EPF on normal pay stays 440 (0 more).', input: { run: { kind: 'bonus', period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30' }, employee: { birth_date: '1991-02-01' }, profile: { my_epf_category: 'citizen' }, lines: [{ code: 'MY_BONUS', kind: 'earning', amount: 2000, tags: ['my_epf_wages', 'my_epf_wages_add'] }], history: [{ pay_date: '2026-06-30', period_end: '2026-06-30', kind: 'regular', by_tag: { my_epf_wages: 4000, my_epf_normal: 440 }, by_code: { MY_EPF_EE: 440, MY_EPF_ER: 520 } }] }, expect: { MY_EPF_EE: 220, MY_EPF_ER: 260, MY_EPF_EE_NORMAL: 0 } },
      { name: 'Foreign worker: blocked in this version', source: 'derived', reference: 'The foreign worker part was not readable from KWSP.', input: { run, employee: { birth_date: '1991-02-01' }, profile: { my_epf_category: 'foreign' }, lines: wl(2000) }, expect: {}, expect_issues: ['my_epf_foreign_unverified'] }
    ],
    filings: [{ code: 'my_epf', name: 'EPF contribution (i-Akaun Majikan)', frequency: 'monthly', due_rule: '15th of the following month', form: 'Borang A / e-Caruman' }],
    documents: []
  };
}

function socsoPack() {
  const m = (t) => '(ytd_since("' + t + '", wage_month) - ytd_since("' + t + '", next_month))';
  const mc = (c) => '(ytd_code_since("' + c + '", wage_month) - ytd_code_since("' + c + '", next_month))';
  const steps = [
    { var: 'wage_month', expr: 'month_start(run.period_end)', explain: 'Contributions are due on the wages for the month, across every payslip of the month.' },
    { var: 'next_month', expr: 'add_months(wage_month, 1)' },
    { var: 'w', expr: 'min(sum("my_socso_wages") + ' + m('my_socso_wages') + ', 6000)', explain: 'Wages for the month up to the ceiling of RM6,000 (since 1 October 2024).' },
    { var: 'cat', expr: 'profile.my_socso_category' },
    { check: 'sum("exit_leave_payout") <= 0', issue: 'my_socso_exit_leave_classify', severity: 'warning', message: 'Unused leave paid on leaving (LEAVE_EXIT) is not counted as SOCSO, EIS or LINDUNG wages by this pack; PERKESO\'s treatment was not confirmed. HR must classify it.' },
    { var: 'up5', expr: '0.05' },
    { code: 'MY_SOCSO_EE', name: 'SOCSO (employee)', kind: 'deduction', stage: 'statutory', when: 'cat == "1"', amount: 'round_up(w * 0.005, up5) - ' + mc('MY_SOCSO_EE'), round: { mode: 'half_up', step: 0.01 }, tags: ['my_socso_employee'], payee: 'PERKESO', filing: 'my_perkeso' },
    { code: 'MY_SOCSO_ER', name: 'SOCSO (employer)', kind: 'employer', when: 'cat != "none"', amount: 'round_up(w * (cat == "1" ? 0.0175 : 0.0125), up5) - ' + mc('MY_SOCSO_ER'), round: { mode: 'half_up', step: 0.01 }, payee: 'PERKESO', filing: 'my_perkeso' },
    { code: 'MY_EIS_EE', name: 'EIS (employee)', kind: 'deduction', stage: 'statutory', when: 'profile.my_eis', amount: 'round_up(w * 0.002, up5) - ' + mc('MY_EIS_EE'), round: { mode: 'half_up', step: 0.01 }, tags: ['my_eis_employee'], payee: 'PERKESO', filing: 'my_perkeso' },
    { code: 'MY_EIS_ER', name: 'EIS (employer)', kind: 'employer', when: 'profile.my_eis', amount: 'round_up(w * 0.002, up5) - ' + mc('MY_EIS_ER'), round: { mode: 'half_up', step: 0.01 }, payee: 'PERKESO', filing: 'my_perkeso' },
    { code: 'MY_LINDUNG', name: 'LINDUNG 24 Jam (employee)', kind: 'deduction', stage: 'statutory', when: 'profile.my_lindung && run.period_end >= "2026-06-01"', amount: 'round_up(w * 0.0075, up5) - ' + mc('MY_LINDUNG'), round: { mode: 'half_up', step: 0.01 }, tags: ['my_lindung'], payee: 'PERKESO', filing: 'my_perkeso' }
  ];
  return {
    code: 'my-socso', country: 'MY', region: '', name: 'Malaysia SOCSO, EIS and LINDUNG 24 Jam', version: '2026.3', effective_from: YEAR.from, effective_to: YEAR.to, currency: 'MYR', tax_year: { start: '01-01' }, date_basis: 'period_end', requires: [], order: 10, ship: 'draft',
    sources: [
      { title: 'Swingvy SOCSO employer guide (10 Jul 2026); Info-Tech SOCSO and EIS tables (2026)', url: 'https://www.info-tech.com.my/blog/perkeso-socso-contribution-table-malaysia/', retrieved: RETRIEVED, note: 'Secondary. Category 1: 1.75 / 0.5 percent; category 2: 1.25 percent employer; EIS 0.2 / 0.2 percent; ceiling RM6,000; sample band amounts.' },
      { title: 'The Star (30 May 2026), RinggitPlus (19 Aug 2026), Conventus Law on LINDUNG 24 Jam', url: 'https://conventuslaw.com/report/malaysia-employment-and-industrial-relations-update-socso-reverses-position-on-lindung-24-jam-what-employers-need-to-know/', retrieved: RETRIEVED, note: 'Secondary. 0.75 percent employee-only from 1 June 2026 to RM6,000; voluntary for Malaysians from July 2026, mandatory for foreign workers; 1.00 percent from June 2028, 1.25 percent from June 2031.' }
    ],
    notes: 'DRAFT: perkeso.gov.my refused connections. PERKESO charges amounts from banded schedules, not a plain percentage; this draft applies the percentages to wages up to RM6,000 and rounds up to 5 sen, which does NOT reproduce every official band (for example the RM1,000 to RM1,100 band is RM18.35 employer in the published table, while the percentage gives a different figure). Import the official First and Second Schedules and the EIS and LINDUNG tables before activating. The month is computed as one across payslips (wages of the month to the RM6,000 ceiling, less what earlier payslips of the month took). Also unverified: foreign workers\' SOCSO shares, EIS exclusions (foreign workers, 60 and over, 57 and over with no prior contributions), and LINDUNG coverage rules.',
    profile_fields: [
      { key: 'my_socso_category', label: 'SOCSO category', type: 'enum', default: '1', options: [{ value: '1', label: 'First category (employment injury and invalidity)' }, { value: '2', label: 'Second category (employment injury only: 60 and over, or first covered at 55 or over)' }, { value: 'none', label: 'Not covered' }] },
      { key: 'my_eis', label: 'EIS covered', type: 'boolean', default: true, help: 'Off for foreign workers, people 60 and over, and those 57 or over with no earlier contributions.' },
      { key: 'my_lindung', label: 'LINDUNG 24 Jam', type: 'boolean', default: false, help: 'Mandatory for foreign workers; voluntary for Malaysians since July 2026.' }
    ],
    tags: [{ tag: 'my_socso_wages', label: 'SOCSO and EIS wages' }, { tag: 'exit_leave_payout', label: 'Unused leave paid on leaving (LEAVE_EXIT)', help: 'Not counted by this pack; the payslip warns so HR classifies it.' }],
    seed_components: [],
    tables: {},
    steps,
    vectors: [
      { name: 'Wages 3,000, category 1, EIS (percentage draft)', source: 'derived', reference: 'Draft method: employee 0.5% = 15.00; employer 1.75% = 52.50; EIS 0.2% = 6.00 each. Not the official table.', input: { run: { period_start: '2026-05-01', period_end: '2026-05-31', pay_date: '2026-05-31' }, lines: [{ code: 'B', kind: 'earning', amount: 3000, tags: ['my_socso_wages'] }] }, expect: { MY_SOCSO_EE: 15, MY_SOCSO_ER: 52.5, MY_EIS_EE: 6, MY_EIS_ER: 6 } },
      { name: 'LINDUNG 24 Jam on a foreign worker from June 2026', source: 'derived', reference: '0.75% of 2,000 = 15.00 (draft method).', input: { run: { period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-30' }, profile: { my_lindung: true, my_eis: false }, lines: [{ code: 'B', kind: 'earning', amount: 2000, tags: ['my_socso_wages'] }] }, expect: { MY_LINDUNG: 15 } }
    ],
    filings: [{ code: 'my_perkeso', name: 'SOCSO, EIS and LINDUNG contributions (ASSIST portal)', frequency: 'monthly', due_rule: '15th of the following month', form: 'PERKESO ASSIST' }],
    documents: []
  };
}

function hrdfPack() {
  return {
    code: 'my-hrdf', country: 'MY', region: '', name: 'Malaysia HRD Corp levy (employer)', version: '2026.1', effective_from: YEAR.from, effective_to: YEAR.to, currency: 'MYR', tax_year: { start: '01-01' }, date_basis: 'period_end', requires: [], order: 10, ship: 'active',
    sources: [
      { title: 'MIDA, Human Resources Development Fund', url: 'https://www.mida.gov.my/setting-up-content/human-resources-development-fund/', retrieved: RETRIEVED, note: 'Employers with 10 or more Malaysian employees in the 63 covered sub-sectors pay 1 percent; 5 to 9 Malaysian employees may register at 0.5 percent.' },
      { title: 'Kakitangan, HRDF contribution Malaysia (12 Apr 2024)', url: 'https://blog.kakitangan.com/hrdf-contribution-malaysia/', retrieved: RETRIEVED, note: 'Secondary: levy on basic salary plus fixed allowances.' }
    ],
    notes: 'Covers the employer levy at the entity\'s rate (1 percent, 0.5 percent or none) on lines tagged my_hrdf_wages for Malaysian employees. The levy base (basic salary plus fixed allowances) is set by which components carry the tag; that definition comes from a secondary source because hrdcorp.gov.my was not fetched. Cents are rounded half up per employee.',
    profile_fields: [
      { key: 'my_hrdf_rate', scope: 'entity', label: 'HRD Corp levy rate', type: 'enum', default: 'none', options: [{ value: 'none', label: 'Not registered' }, { value: '0.5', label: '0.5 percent (5 to 9 Malaysian employees, voluntary)' }, { value: '1', label: '1 percent (10 or more Malaysian employees)' }] },
      { key: 'my_malaysian', label: 'Malaysian employee (HRD Corp levy)', type: 'boolean', default: true }
    ],
    tags: [{ tag: 'my_hrdf_wages', label: 'HRD Corp levy wages', help: 'Basic salary and fixed allowances.' }],
    seed_components: [],
    tables: {},
    steps: [
      { code: 'MY_HRDF_ER', name: 'HRD Corp levy', kind: 'employer', when: 'entity.my_hrdf_rate != "none" && profile.my_malaysian', amount: 'sum("my_hrdf_wages") * num(entity.my_hrdf_rate) / 100', round: { mode: 'half_up', step: 0.01 }, payee: 'HRD Corp', filing: 'my_hrdf' }
    ],
    vectors: [
      { name: '1 percent of 4,200', source: 'derived', reference: 'MIDA rate 1%: 42.00.', input: { run: { period_start: '2026-05-01', period_end: '2026-05-31', pay_date: '2026-05-31' }, entity: { my_hrdf_rate: '1' }, lines: [{ code: 'B', kind: 'earning', amount: 4200, tags: ['my_hrdf_wages'] }] }, expect: { MY_HRDF_ER: 42 } },
      { name: '0.5 percent of 3,333', source: 'derived', reference: '0.5% x 3,333 = 16.665, half up 16.67.', input: { run: { period_start: '2026-05-01', period_end: '2026-05-31', pay_date: '2026-05-31' }, entity: { my_hrdf_rate: '0.5' }, lines: [{ code: 'B', kind: 'earning', amount: 3333, tags: ['my_hrdf_wages'] }] }, expect: { MY_HRDF_ER: 16.67 } }
    ],
    filings: [{ code: 'my_hrdf', name: 'HRD Corp levy (e-TRiS)', frequency: 'monthly', due_rule: '15th of the following month', form: 'e-TRiS' }],
    documents: []
  };
}

export function build() {
  return [
    writeModule('packs/my.js', 'Malaysia rule pack: PCB / MTD 2026 with zakat, version 2026.4.', pcbPack()),
    writeModule('packs/my-epf.js', 'Malaysia rule pack: EPF (draft), version 2026.3.', epfPack()),
    writeModule('packs/my-socso.js', 'Malaysia rule pack: SOCSO, EIS, LINDUNG 24 Jam (draft), version 2026.3.', socsoPack()),
    writeModule('packs/my-hrdf.js', 'Malaysia rule pack: HRD Corp levy, version 2026.1.', hrdfPack())
  ];
}
