// Japan year-end adjustment (令和8年分 年末調整), version 2026.2.
// Verified by packs-verify against the NTA 令和8年分 年末調整のしかた; see `sources`, `ship` and `notes`.

module.exports = {
  code: "jp-yea",
  country: "JP",
  region: "",
  name: "Japan year-end adjustment 2026 (令和8年分 年末調整)",
  version: "2026.2",
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
  currency: "JPY",
  tax_year: { start: "01-01" },
  date_basis: "pay_date",
  requires: [],
  order: 40,
  ship: "active",
  sources: [
    {
      title: "国税庁 令和8年分 年末調整のしかた: Ⅰ 昨年と比べて変わった点 (p.3 to p.4)",
      url: "https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/102.pdf",
      retrieved: "2026-11-04",
      note: "令和8年度税制改正 (in force 1 December 2026, applies to 令和8年分): 基礎控除 104万 / 67万 / 62万 by 合計所得金額; 給与所得控除 minimum 74万; for 令和8・9年分 salaries 691,000 to under 2,200,000 the 給与所得 is nil below 741,000, salary less 740,000 below 2,191,000, then 1,451,000 / 1,453,000 / 1,456,000 for 2,191,000 / 2,193,000 / 2,196,000 to the next step."
    },
    {
      title: "国税庁 令和8年分 年末調整のしかた: 3 年税額の計算 (p.35 to p.39)",
      url: "https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/109.pdf",
      retrieved: "2026-11-04",
      note: "給与所得控除後の給与等の金額 from the table (nil below 741,000; above 6,600,000 by formula, yen fractions dropped); 所得金額調整控除 = (salary, at most 10,000,000, less 8,500,000) x 10 percent rounded up; 課税給与所得金額 = 給与所得 (調整控除後) less the sum of deductions, 1,000 yen fractions dropped; 速算表; less 住宅借入金等特別控除; x 102.1 percent, 100 yen fractions dropped."
    },
    {
      title: "国税庁 令和8年分の年末調整等のための給与所得控除後の給与等の金額の表 (p.47 to p.54)",
      url: "https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/114.pdf",
      retrieved: "2026-11-04",
      note: "All 1,100 rows from 2,200,000 to 6,600,000 were parsed by program and match floor(salary / 4,000) x 4,000 x 70 percent less 80,000 below 3,600,000 and x 80 percent less 440,000 from 3,600,000; 6,600,000 to 8,500,000: x 90 percent less 1,100,000; 8,500,000 to 20,000,000: less 1,950,000."
    },
    {
      title: "国税庁 令和8年分の年末調整のための算出所得税額の速算表 and 令和8年分の基礎控除額の表 (p.55 to p.56)",
      url: "https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/115.pdf",
      retrieved: "2026-11-04",
      note: "速算表 5 / 10 / 20 / 23 / 33 / 40 percent less 0 / 97,500 / 427,500 / 636,000 / 1,536,000 / 2,796,000 to 18,050,000 (over that, no 年末調整). 基礎控除: up to 489万 1,040,000; to 655万 670,000; to 2,350万 620,000; to 2,400万 480,000; to 2,450万 320,000; to 2,500万 160,000; over 2,500万 none."
    },
    {
      title: "国税庁 令和8年分 年末調整のしかた: 設例 (p.57 to p.61) and 過不足額の精算の設例",
      url: "https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/110rei.pdf",
      retrieved: "2026-11-04",
      note: "Worked examples used as official vectors: salary 8,970,000 with 所得金額調整控除 and housing credit (超過額 115,270), and salary 4,390,000 (https://www.nta.go.jp/publication/pamph/gensen/nencho2026/pdf/203.pdf, 超過額 25,745)."
    }
  ],
  notes: "Runs as year_end_steps when the December run (or a year-end correction run) has run.year_end true, for 甲 employees whose salary for the year is at most 20,000,000 yen: annual salary from the year's lines, 給与所得控除後の給与等の金額 by the 令和8年分 table (verified row by row), 所得金額調整控除 when the employee filed the 所得金額調整控除申告書, 基礎控除 by 合計所得金額 (給与所得 after the adjustment plus other income the employee declared), social insurance from the year's lines plus amounts paid directly, the deductions the employee's declarations compute (spouse, 特定親族, dependants and disability, insurance premiums) entered in yen, 課税給与所得金額 with 1,000 yen fractions dropped, the 令和8年分 速算表, housing loan credit, 102.1 percent with 100 yen fractions dropped, then the difference against the tax withheld in the year as a payment or a refund. Not computed by the pack: the deduction amounts themselves (the 申告書 give the yen figures), the carry of an excess refund across later pay, re-adjustment after the year-end run, employees who left mid-year, and salaries over 20,000,000 yen (warning, no adjustment).",
  profile_fields: [
    {
      key: "jp_yea_spouse_deduction",
      label: "年末調整: 配偶者控除 or 配偶者特別控除 (yen)",
      type: "money",
      default: 0,
      min: 0,
      form: "配偶者控除等申告書",
      help: "The amount the declaration computes."
    },
    {
      key: "jp_yea_dependant_deduction",
      label: "年末調整: 扶養控除, 障害者控除, 特定親族特別控除 and other personal deductions (yen)",
      type: "money",
      default: 0,
      min: 0,
      form: "扶養控除等申告書",
      help: "Total of 扶養控除, 障害者控除, 寡婦 / ひとり親 / 勤労学生控除 and 特定親族特別控除."
    },
    {
      key: "jp_yea_other_deductions",
      label: "年末調整: 生命保険料・地震保険料 and other deductions (yen)",
      type: "money",
      default: 0,
      min: 0,
      form: "保険料控除申告書",
      help: "Total of 生命保険料控除, 地震保険料控除 and other deductions not taken from pay."
    },
    {
      key: "jp_yea_si_paid_directly",
      label: "年末調整: social insurance paid directly (yen)",
      type: "money",
      default: 0,
      min: 0,
      form: "保険料控除申告書",
      help: "National pension or 小規模企業共済 paid by the employee, not through payroll."
    },
    {
      key: "jp_yea_housing_credit",
      label: "年末調整: 住宅借入金等特別控除 (yen)",
      type: "money",
      default: 0,
      min: 0,
      form: "住宅借入金等特別控除申告書",
      help: "The credit for the year."
    },
    {
      key: "jp_yea_other_income",
      label: "年末調整: other income included (yen)",
      type: "money",
      default: 0,
      min: 0,
      form: "基礎控除申告書",
      help: "Other 合計所得金額 the employee declared for the basic deduction test. It does not enter the taxable salary."
    },
    {
      key: "jp_yea_income_adjustment",
      label: "年末調整: 所得金額調整控除 applies",
      type: "boolean",
      default: false,
      form: "所得金額調整控除申告書",
      help: "On when the employee filed the 所得金額調整控除申告書 (salary over 8,500,000 yen and a special disability or a dependant under 23 in the household)."
    },
    {
      key: "jp_column",
      label: "Withholding column",
      type: "enum",
      default: "ko",
      options: [{ value: "ko", label: "甲" }, { value: "otsu", label: "乙" }]
    }
  ],
  tags: [
    { tag: "jp_taxable", label: "課税支給額" },
    { tag: "jp_si_employee", label: "Social insurance deducted from pay" },
    { tag: "jp_si_other", label: "Other deductible premiums" }
  ],
  seed_components: [],
  tables: {
    jp_sokusan: {
      type: "brackets",
      rows: [
        { over: 0, rate: 0.05, less: 0 },
        { over: 1950000, rate: 0.1, less: 97500 },
        { over: 3300000, rate: 0.2, less: 427500 },
        { over: 6950000, rate: 0.23, less: 636000 },
        { over: 9000000, rate: 0.33, less: 1536000 },
        { over: 18000000, rate: 0.4, less: 2796000 }
      ]
    },
    jp_kiso_2026: {
      type: "bands",
      rows: [
        { to: 4890000, value: 1040000 },
        { over: 4890000, to: 6550000, value: 670000 },
        { over: 6550000, to: 23500000, value: 620000 },
        { over: 23500000, to: 24000000, value: 480000 },
        { over: 24000000, to: 24500000, value: 320000 },
        { over: 24500000, to: 25000000, value: 160000 },
        { over: 25000000, value: 0 }
      ]
    }
  },
  steps: [
    {
      var: "is_year_end",
      expr: "run.year_end",
      explain: "The adjustment runs only in a run marked as the year-end run."
    }
  ],
  year_end_steps: [
    {
      var: "salary",
      expr: "ytd(\"jp_taxable\") + sum(\"jp_taxable\")",
      explain: "Taxable salary and bonuses paid in the year, this run included."
    },
    {
      check: "salary <= 20000000",
      issue: "jp_yea_over_20m",
      severity: "warning",
      message: "Salary over 20,000,000 yen is not year-end adjusted; the employee files a return."
    },
    {
      var: "on",
      expr: "salary <= 20000000 && profile.jp_column == \"ko\"",
      explain: "Only 甲 employees with salary up to 20,000,000 yen are adjusted."
    },
    { var: "q", expr: "round_down(salary, 4000)", explain: "The 4,000 yen step of the table rows from 2,200,000 to 6,600,000." },
    {
      var: "kyuyo_shotoku",
      expr: "salary < 741000 ? 0 : (salary < 2191000 ? salary - 740000 : (salary < 2193000 ? 1451000 : (salary < 2196000 ? 1453000 : (salary < 2200000 ? 1456000 : (salary < 3600000 ? q * 0.7 - 80000 : (salary < 6600000 ? q * 0.8 - 440000 : (salary < 8500000 ? round_down(salary * 0.9 - 1100000, 1) : salary - 1950000)))))))",
      explain: "給与所得控除後の給与等の金額 by the 令和8年分 table (p.47 to p.54)."
    },
    {
      var: "adjustment",
      expr: "profile.jp_yea_income_adjustment && salary > 8500000 ? ceil((min(salary, 10000000) - 8500000) * 0.1) : 0",
      explain: "所得金額調整控除: (salary, at most 10,000,000, less 8,500,000) x 10 percent, yen fractions rounded up (p.37)."
    },
    {
      var: "kyuyo_adjusted",
      expr: "max(0, kyuyo_shotoku - adjustment)",
      explain: "給与所得控除後の給与等の金額 (調整控除後)."
    },
    {
      var: "total_income",
      expr: "kyuyo_adjusted + profile.jp_yea_other_income",
      explain: "合計所得金額, used only for the basic deduction test."
    },
    {
      var: "kiso",
      expr: "band(\"jp_kiso_2026\", total_income)",
      explain: "基礎控除 令和8年分 by 合計所得金額 (p.56)."
    },
    {
      var: "si",
      expr: "ytd(\"jp_si_employee\") + sum(\"jp_si_employee\") + ytd(\"jp_si_other\") + sum(\"jp_si_other\") + profile.jp_yea_si_paid_directly",
      explain: "社会保険料控除 and 小規模企業共済等掛金控除: deducted from pay this year plus amounts the employee paid directly."
    },
    {
      var: "deductions",
      expr: "si + kiso + profile.jp_yea_spouse_deduction + profile.jp_yea_dependant_deduction + profile.jp_yea_other_deductions",
      explain: "所得控除額の合計額."
    },
    {
      var: "taxable",
      expr: "round_down(max(0, kyuyo_adjusted - deductions), 1000)",
      explain: "差引課税給与所得金額: 給与所得 (調整控除後) less the deductions, 1,000 yen fractions dropped."
    },
    {
      var: "tax",
      expr: "max(0, table(\"jp_sokusan\", taxable) - profile.jp_yea_housing_credit)",
      explain: "算出所得税額 (速算表) less 住宅借入金等特別控除 = 年調所得税額."
    },
    {
      var: "annual_tax",
      expr: "round_down(tax * 1.021, 100)",
      explain: "年調年税額: times 102.1 percent, 100 yen fractions dropped."
    },
    { var: "withheld", expr: "ytd_code(\"JP_WHT\") + sum_code(\"JP_WHT\")", explain: "Tax withheld in the year, this run included." },
    { var: "diff", expr: "on ? annual_tax - withheld : 0" },
    {
      code: "JP_YEA_TAX",
      name: "年末調整 不足額",
      kind: "deduction",
      stage: "statutory",
      when: "diff > 0",
      amount: "diff",
      round: { mode: "down", step: 1 },
      tags: ["jp_wht_yea"],
      payee: "税務署",
      filing: "jp_gensen"
    },
    {
      code: "JP_YEA_REFUND",
      name: "年末調整 還付額",
      kind: "reimbursement",
      when: "diff < 0",
      amount: "-diff",
      round: { mode: "down", step: 1 },
      tags: ["jp_wht_yea"],
      payee: "税務署",
      filing: "jp_gensen"
    }
  ],
  vectors: [
    {
      name: "NTA 設例: salary 8,970,000 with 所得金額調整控除 and housing credit",
      source: "official",
      reference: "令和8年分 年末調整のしかた p.57 to p.61: 給与所得 7,020,000; 所得金額調整控除 47,000; 6,973,000; deductions 4,826,102 (social insurance 1,386,102, life 120,000, earthquake 50,000, spouse 380,000, 特定親族 410,000, dependants 1,860,000, basic 620,000); taxable 2,146,000; 117,100 less housing 76,500 = 40,600; x 102.1% = 41,400; withheld 156,670; 超過額 115,270.",
      input: {
        run: { period_start: "2026-12-01", period_end: "2026-12-31", pay_date: "2026-12-25", year_end: true },
        profile: {
          jp_column: "ko",
          jp_yea_income_adjustment: true,
          jp_yea_spouse_deduction: 380000,
          jp_yea_dependant_deduction: 2270000,
          jp_yea_other_deductions: 170000,
          jp_yea_housing_credit: 76500
        },
        lines: [
          { code: "JP_BASE", kind: "earning", amount: 520000, tags: ["jp_taxable"] },
          { code: "SI", kind: "deduction", stage: "statutory", amount: 78000, tags: ["jp_si_employee"] }
        ],
        history: [
          {
            pay_date: "2026-11-25",
            period_end: "2026-11-30",
            kind: "regular",
            by_tag: { jp_taxable: 8450000, jp_si_employee: 1308102 },
            by_code: { JP_WHT: 156670 }
          }
        ]
      },
      expect: { JP_YEA_REFUND: 115270, JP_YEA_TAX: 0 },
      expect_vars: { kyuyo_shotoku: 7020000, adjustment: 47000, kyuyo_adjusted: 6973000, kiso: 620000, deductions: 4826102, taxable: 2146000, annual_tax: 41400 }
    },
    {
      name: "NTA 過不足額の精算の設例: salary 4,390,000, December tax computed",
      source: "official",
      reference: "令和8年分 年末調整 過不足額の精算の設例 (203.pdf): 給与所得 3,070,400; deductions 2,558,075 (social insurance 641,525, life 71,550, earthquake 45,000, spouse 380,000, dependant 380,000, basic 1,040,000); taxable 512,000; 25,600; x 102.1% = 26,100; withheld 51,845 including the December 6,963; 超過額 25,745.",
      input: {
        run: { period_start: "2026-12-01", period_end: "2026-12-31", pay_date: "2026-12-25", year_end: true },
        profile: {
          jp_column: "ko",
          jp_yea_spouse_deduction: 380000,
          jp_yea_dependant_deduction: 380000,
          jp_yea_other_deductions: 116550
        },
        lines: [
          { code: "JP_BASE", kind: "earning", amount: 340000, tags: ["jp_taxable"] },
          { code: "SI", kind: "deduction", stage: "statutory", amount: 52000, tags: ["jp_si_employee"] },
          { code: "JP_WHT", kind: "deduction", stage: "statutory", amount: 6963 }
        ],
        history: [
          {
            pay_date: "2026-11-25",
            period_end: "2026-11-30",
            kind: "regular",
            by_tag: { jp_taxable: 4050000, jp_si_employee: 589525 },
            by_code: { JP_WHT: 44882 }
          }
        ]
      },
      expect: { JP_YEA_REFUND: 25745, JP_YEA_TAX: 0 },
      expect_vars: { kyuyo_shotoku: 3070400, kiso: 1040000, deductions: 2558075, taxable: 512000, annual_tax: 26100 }
    },
    {
      name: "Salary 4,000,000, refund in December",
      source: "derived",
      reference: "給与所得: 4,000,000 is a 4,000 multiple; x 80% - 440,000 = 2,760,000 (table row 4,000,000 to 4,004,000). 基礎控除 1,040,000; social insurance 620,000. Taxable 1,100,000; 5% = 55,000; x 102.1% = 56,155, 100 yen fractions dropped 56,100. Withheld 100,000, so a refund of 43,900.",
      input: {
        run: { period_start: "2026-12-01", period_end: "2026-12-31", pay_date: "2026-12-25", year_end: true },
        profile: { jp_column: "ko" },
        lines: [
          { code: "JP_BASE", kind: "earning", amount: 400000, tags: ["jp_taxable"] },
          { code: "SI", kind: "deduction", stage: "statutory", amount: 60000, tags: ["jp_si_employee"] }
        ],
        history: [
          {
            pay_date: "2026-11-25",
            period_end: "2026-11-30",
            kind: "regular",
            by_tag: { jp_taxable: 3600000, jp_si_employee: 560000 },
            by_code: { JP_WHT: 100000 }
          }
        ]
      },
      expect: { JP_YEA_REFUND: 43900 },
      expect_vars: { kyuyo_shotoku: 2760000, taxable: 1100000, annual_tax: 56100 }
    },
    {
      name: "Salary 2,195,000: the 令和8年分 special row",
      source: "derived",
      reference: "Table row 2,193,000 to under 2,196,000: 給与所得 1,453,000 (p.47). Basic 1,040,000; taxable 413,000; 5% = 20,650; x 102.1% = 21,083.65, 21,000. Withheld 30,000: refund 9,000.",
      input: {
        run: { period_start: "2026-12-01", period_end: "2026-12-31", pay_date: "2026-12-25", year_end: true },
        profile: { jp_column: "ko" },
        lines: [{ code: "JP_BASE", kind: "earning", amount: 195000, tags: ["jp_taxable"] }],
        history: [
          {
            pay_date: "2026-11-25",
            period_end: "2026-11-30",
            kind: "regular",
            by_tag: { jp_taxable: 2000000 },
            by_code: { JP_WHT: 30000 }
          }
        ]
      },
      expect: { JP_YEA_REFUND: 9000 },
      expect_vars: { kyuyo_shotoku: 1453000, taxable: 413000, annual_tax: 21000 }
    },
    {
      name: "Salary 740,500: nil below 741,000",
      source: "derived",
      reference: "Table: under 741,000 the 給与所得 is 0 (p.36 note 1, p.47). Tax 0; withheld 2,000 is refunded.",
      input: {
        run: { period_start: "2026-12-01", period_end: "2026-12-31", pay_date: "2026-12-25", year_end: true },
        profile: { jp_column: "ko" },
        lines: [{ code: "JP_BASE", kind: "earning", amount: 60500, tags: ["jp_taxable"] }],
        history: [
          {
            pay_date: "2026-11-25",
            period_end: "2026-11-30",
            kind: "regular",
            by_tag: { jp_taxable: 680000 },
            by_code: { JP_WHT: 2000 }
          }
        ]
      },
      expect: { JP_YEA_REFUND: 2000 },
      expect_vars: { kyuyo_shotoku: 0, taxable: 0, annual_tax: 0 }
    },
    {
      name: "Other income lowers the basic deduction but is not taxed in the adjustment",
      source: "derived",
      reference: "Salary 6,000,000: q x 80% - 440,000 = 4,360,000. Other income 600,000 gives 合計所得金額 4,960,000, over 489万: basic 670,000 (p.56). Social insurance 900,000. Taxable 4,360,000 - 1,570,000 = 2,790,000; x 10% - 97,500 = 181,500; x 102.1% = 185,311.5, 185,300. Withheld 185,300: no difference.",
      input: {
        run: { period_start: "2026-12-01", period_end: "2026-12-31", pay_date: "2026-12-25", year_end: true },
        profile: { jp_column: "ko", jp_yea_other_income: 600000 },
        lines: [
          { code: "JP_BASE", kind: "earning", amount: 500000, tags: ["jp_taxable"] },
          { code: "SI", kind: "deduction", stage: "statutory", amount: 75000, tags: ["jp_si_employee"] }
        ],
        history: [
          {
            pay_date: "2026-11-25",
            period_end: "2026-11-30",
            kind: "regular",
            by_tag: { jp_taxable: 5500000, jp_si_employee: 825000 },
            by_code: { JP_WHT: 185300 }
          }
        ]
      },
      expect: { JP_YEA_REFUND: 0, JP_YEA_TAX: 0 },
      expect_vars: { kyuyo_shotoku: 4360000, kiso: 670000, taxable: 2790000, annual_tax: 185300 }
    }
  ],
  filings: [],
  documents: [{ code: "jp_gensen_choshu_hyo", name: "給与所得の源泉徴収票 data", year_end: true }]
};
