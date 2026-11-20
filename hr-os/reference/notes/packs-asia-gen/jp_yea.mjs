// Japan year-end adjustment (年末調整) for tax year 2026: jp-yea (draft).
import { writeModule, RETRIEVED } from './emit.mjs';

const SOKUSAN = [{ over: 0, rate: 0.05, less: 0 }, { over: 1950000, rate: 0.1, less: 97500 }, { over: 3300000, rate: 0.2, less: 427500 }, { over: 6950000, rate: 0.23, less: 636000 }, { over: 9000000, rate: 0.33, less: 1536000 }, { over: 18000000, rate: 0.4, less: 2796000 }, { over: 40000000, rate: 0.45, less: 4796000 }];
const KISO_2026 = [{ to: 4890000, value: 1040000 }, { over: 4890000, to: 6550000, value: 670000 }, { over: 6550000, to: 23500000, value: 620000 }];

function pack() {
  const steps = [{ var: 'is_year_end', expr: 'run.year_end', explain: 'The adjustment runs only in a run marked as the year-end run.' }];
  const ye = [
    { var: 'salary', expr: 'ytd("jp_taxable") + sum("jp_taxable")', explain: 'Taxable salary and bonuses paid in the year, this run included.' },
    { check: 'salary <= 20000000', issue: 'jp_yea_over_20m', severity: 'warning', message: 'Salary over 20,000,000 yen is not year-end adjusted; the employee files a return.' },
    { var: 'on', expr: 'salary <= 20000000 && profile.jp_column == "ko"', explain: 'Only 甲 employees with salary up to 20,000,000 yen are adjusted.' },
    { var: 'q', expr: 'round_down(salary, 4000)' },
    { var: 'kyuyo_shotoku', expr: 'salary <= 2200000 ? max(0, salary - 740000) : (salary < 3600000 ? q * 0.7 - 80000 : (salary < 6600000 ? q * 0.8 - 440000 : (salary <= 8500000 ? round_down(salary * 0.9 - 1100000, 1) : salary - 1950000)))', explain: '給与所得控除後の給与等の金額: 74万 floor up to 220万 (令和8年分), the 4,000 yen steps below 660万, then the statutory formula.' },
    { var: 'total_income', expr: 'kyuyo_shotoku + profile.jp_yea_other_income', explain: '合計所得金額.' },
    { var: 'kiso', expr: 'total_income > 23500000 ? 0 : band("jp_kiso_2026", total_income)', explain: '基礎控除 令和8年分 by 合計所得金額 (NTA 2026kaisei p.1).' },
    { var: 'si', expr: 'ytd("jp_si_employee") + sum("jp_si_employee") + ytd("jp_si_other") + sum("jp_si_other") + profile.jp_yea_si_paid_directly', explain: '社会保険料控除 and 小規模企業共済等掛金控除: deducted from pay this year plus amounts the employee paid directly.' },
    { var: 'deductions', expr: 'si + kiso + profile.jp_yea_spouse_deduction + profile.jp_yea_dependant_deduction + profile.jp_yea_other_deductions' },
    { var: 'taxable', expr: 'round_down(max(0, total_income - deductions), 1000)', explain: '課税給与所得金額, 1,000 yen fractions dropped.' },
    { var: 'tax', expr: 'max(0, table("jp_sokusan", taxable) - profile.jp_yea_housing_credit)', explain: '算出所得税額 (速算表) less 住宅借入金等特別控除.' },
    { var: 'annual_tax', expr: 'round_down(tax * 1.021, 100)', explain: '年調年税額: times 102.1 percent, 100 yen fractions dropped.' },
    { var: 'withheld', expr: 'ytd_code("JP_WHT") + sum_code("JP_WHT")' },
    { var: 'diff', expr: 'on ? annual_tax - withheld : 0' },
    { code: 'JP_YEA_TAX', name: '年末調整 不足額', kind: 'deduction', stage: 'statutory', when: 'diff > 0', amount: 'diff', round: { mode: 'down', step: 1 }, tags: ['jp_wht_yea'], payee: '税務署', filing: 'jp_gensen' },
    { code: 'JP_YEA_REFUND', name: '年末調整 還付額', kind: 'reimbursement', when: 'diff < 0', amount: '-diff', round: { mode: 'down', step: 1 }, tags: ['jp_wht_yea'], payee: '税務署', filing: 'jp_gensen' }
  ];
  const money = (key, label, form, help) => ({ key, label, type: 'money', default: 0, min: 0, form, help });
  return {
    code: 'jp-yea', country: 'JP', region: '', name: 'Japan year-end adjustment 2026 (令和8年分 年末調整)', version: '2026.1', effective_from: '2026-01-01', effective_to: '2026-12-31', currency: 'JPY', tax_year: { start: '01-01' }, date_basis: 'pay_date', requires: [], order: 40, ship: 'draft',
    sources: [
      { title: 'NTA 源泉所得税の改正のあらまし 令和8年4月 (2026kaisei.pdf) p.1 to p.2', url: 'https://www.nta.go.jp/publication/pamph/gensen/2026kaisei.pdf', retrieved: RETRIEVED, note: '令和8年分 基礎控除 tiers (104万, 67万, 62万) and the 給与所得控除 floor of 74万 up to 220万; cited from the research notes.' },
      { title: 'NTA 令和8年分 p.18 (所得税の速算表 inside the 退職所得 table; 102.1 percent)', url: 'https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf', retrieved: RETRIEVED, note: 'Rates 5 to 45 percent with deductions 0 to 4,796,000 yen.' },
      { title: 'NTA 令和8年分 電算機計算の特例 別表第一 (monthly forms of 30%+8万, 20%+44万, 10%+110万, cap 195万)', url: 'https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf', retrieved: RETRIEVED, note: 'The annual 給与所得控除 bands above 220万 match the monthly bands times 12.' }
    ],
    notes: 'DRAFT. Runs as year_end_steps when the December run (or a year-end correction run) has run.year_end true: annual salary, 給与所得 (74万 floor to 220万, 4,000 yen steps below 660万, the statutory formula above), 基礎控除 by income, social insurance from the year\'s lines, deductions the employee declared (spouse, dependants and others as yen amounts from the 申告書), 速算表, housing loan credit, 102.1 percent, and the difference against tax withheld as a payment or a refund. Unverified: the 令和8年分 special table for salaries between 691,000 and 2,200,000 yen (the pack uses salary less 740,000), the 4,000 yen step rule (taken from the usual 別表第五 construction, not re-read), and the 30 November form-edition rule. Not covered: 所得金額調整控除, deduction amount tables (the employee\'s forms give the yen amounts), 特定親族特別控除 computation, salaries over 20,000,000 yen, employees who left mid-year. Check against the NTA 令和8年分 年末調整のしかた before activating.',
    profile_fields: [
      money('jp_yea_spouse_deduction', '年末調整: 配偶者控除 or 配偶者特別控除 (yen)', '配偶者控除等申告書', 'The amount the declaration computes.'),
      money('jp_yea_dependant_deduction', '年末調整: 扶養控除, 障害者控除 and other personal deductions (yen)', '扶養控除等申告書', 'Total of 扶養控除, 障害者控除, 寡婦 / ひとり親 / 勤労学生控除 and 特定親族特別控除.'),
      money('jp_yea_other_deductions', '年末調整: 生命保険料・地震保険料 and other deductions (yen)', '保険料控除申告書', 'Total of 生命保険料控除, 地震保険料控除 and other deductions not taken from pay.'),
      money('jp_yea_si_paid_directly', '年末調整: social insurance paid directly (yen)', '保険料控除申告書', 'National pension or 小規模企業共済 paid by the employee, not through payroll.'),
      money('jp_yea_housing_credit', '年末調整: 住宅借入金等特別控除 (yen)', '住宅借入金等特別控除申告書', 'The credit for the year.'),
      money('jp_yea_other_income', '年末調整: other income included (yen)', '基礎控除申告書', 'Other 合計所得金額 the employee declared for the basic deduction test.'),
      { key: 'jp_column', label: 'Withholding column', type: 'enum', default: 'ko', options: [{ value: 'ko', label: '甲' }, { value: 'otsu', label: '乙' }] }
    ],
    tags: [{ tag: 'jp_taxable', label: '課税支給額' }, { tag: 'jp_si_employee', label: 'Social insurance deducted from pay' }, { tag: 'jp_si_other', label: 'Other deductible premiums' }],
    seed_components: [],
    tables: { jp_sokusan: { type: 'brackets', rows: SOKUSAN }, jp_kiso_2026: { type: 'bands', rows: KISO_2026 } },
    steps,
    year_end_steps: ye,
    vectors: [
      { name: 'Salary 4,000,000, refund in December', source: 'derived', reference: '給与所得: 4,000,000 is a 4,000 multiple; x 80% - 440,000 = 2,760,000. 基礎控除 1,040,000; social insurance 620,000. Taxable 1,100,000; 5% = 55,000; x 102.1% = 56,155, 100 yen fractions dropped 56,100. Withheld 100,000, so a refund of 43,900.', input: { run: { period_start: '2026-12-01', period_end: '2026-12-31', pay_date: '2026-12-25', year_end: true }, profile: { jp_column: 'ko' }, lines: [{ code: 'JP_BASE', kind: 'earning', amount: 400000, tags: ['jp_taxable'] }, { code: 'SI', kind: 'deduction', stage: 'statutory', amount: 60000, tags: ['jp_si_employee'] }], history: [{ pay_date: '2026-11-25', period_end: '2026-11-30', kind: 'regular', by_tag: { jp_taxable: 3600000, jp_si_employee: 560000 }, by_code: { JP_WHT: 100000 } }] }, expect: { JP_YEA_REFUND: 43900 }, expect_vars: { kyuyo_shotoku: 2760000, taxable: 1100000, annual_tax: 56100 } }
    ],
    filings: [],
    documents: [{ code: 'jp_gensen_choshu_hyo', name: '給与所得の源泉徴収票 data', year_end: true }]
  };
}

export function build() {
  return [writeModule('packs/jp-yea.js', 'Japan year-end adjustment (令和8年分 年末調整), draft, version 2026.1.', pack())];
}
