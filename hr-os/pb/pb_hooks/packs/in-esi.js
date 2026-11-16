// India rule pack: ESI under the Code on Social Security 2020, version 2026.3.
// Fix round 1 (packs-asia): coverage and contributions over the whole wage period across payslips.
// Verified by packs-verify against the Social Security (Central) Rules, 2026 and Ministry of Labour sources in `sources`.

module.exports = {
  code: "in-esi",
  country: "IN",
  region: "",
  name: "India Employees State Insurance (ESI)",
  version: "2026.3",
  effective_from: "2026-04-01",
  effective_to: "2027-03-31",
  currency: "INR",
  tax_year: { start: "04-01" },
  date_basis: "period_end",
  requires: [],
  order: 10,
  ship: "active",
  sources: [
    {
      title: "Gazette of India G.S.R. 344(E), 8 May 2026: Social Security (Central) Rules, 2026, rule 19 (Ministry of Labour and Employment copy)",
      url: "https://www.labour.gov.in/static/uploads/2026/05/49aa9b62c2125499c37399b90e969d67.pdf",
      retrieved: "2026-11-04",
      note: "Rule 1(2): in force on publication, 8 May 2026. Rule 19(1): employer three and one-fourth percent and employee three-fourth percent of the wages, each rounded to the next higher rupee; 19(2): no employer share for a person with disability for up to three years from the start of the contribution period (reimbursed by the Central Government). Rule 2(q): contribution period not exceeding six consecutive months as the regulations specify."
    },
    {
      title: "Ministry of Labour and Employment, Additional FAQs on Labour Codes (as on 16.03.2026), question 12",
      url: "https://www.labour.gov.in/static/uploads/2026/03/a4ccf4c6d97c4f1f36a6d83f8c64213d.pdf",
      retrieved: "2026-11-04",
      note: "From 21.11.2025 the Code wage definition applies to ESI; Rs 21,000 a month is the wages notified for ESI coverage."
    },
    {
      title: "The Code on Social Security, 2020 (Ministry of Labour and Employment copy), sections 2(88) and 29",
      url: "https://www.labour.gov.in/static/uploads/2025/07/b0620548445580767b5c0d18c95c26f7.pdf",
      retrieved: "2026-11-04",
      note: "2(88): wages with the one-half rule; 29(2): rates as prescribed; 29(4): contributions for a wage period fall due on its last day."
    }
  ],
  notes: "Covers employee and employer ESI on wages under the Code (lines tagged in_remuneration less lines tagged in_code_excluded, with the one-half rule), for wage periods ending on or after 8 May 2026, when the Social Security (Central) Rules 2026 came into force (contributions fall due on the last day of the wage period, Code section 29(4)); earlier periods were under the ESI (Central) Rules 1950 and are blocked here. Employee 0.75 percent and employer 3.25 percent, each rounded up to the next rupee (rule 19). Coverage on auto: wages up to 21,000 a month (Ministry FAQ of 16 March 2026). An employee covered at the start of a contribution period may stay covered after a rise: the contribution period rules are in the ESI regulations, which were not readable (esic.gov.in refused connections), so the pack warns when wages pass 21,000 after an ESI month and a person sets coverage to covered for the rest of the period. Persons with disability: the employer share can be switched off (rule 19(2)); their higher coverage limit is set by hand with coverage covered. Not covered: the low daily wage exemption from the employee share, implemented-area checks, part-period employment rules of the regulations.",
  profile_fields: [
    {
      key: "in_esi_status",
      label: "ESI coverage",
      type: "enum",
      default: "auto",
      options: [
        { value: "auto", label: "By wages this month (up to 21,000)" },
        { value: "covered", label: "Covered for this contribution period" },
        { value: "not_covered", label: "Not covered" }
      ]
    },
    {
      key: "in_esi_pwd_employer_exempt",
      label: "No employer ESI share (person with disability, first three years)",
      type: "boolean",
      default: false,
      form: "Social Security (Central) Rules 2026 rule 19(2)"
    }
  ],
  tags: [
    { tag: "in_remuneration", label: "Remuneration (Code wages)" },
    { tag: "in_code_excluded", label: "Excluded from Code wages" }
  ],
  seed_components: [],
  tables: {},
  steps: [
    {
      check: "run.period_end >= \"2026-05-08\"",
      issue: "in_esi_pre_2026_rules",
      severity: "blocker",
      message: "Wage periods ending before 8 May 2026 fall under the ESI (Central) Rules 1950, which this pack version does not cover. Enter ESI by hand."
    },
    {
      var: "wage_month",
      expr: "month_start(run.period_end)",
      explain: "ESI is due on the wages of the wage period (the month), across every payslip of the period."
    },
    { var: "next_month", expr: "add_months(wage_month, 1)" },
    {
      var: "rem",
      expr: "sum(\"in_remuneration\") + (ytd_since(\"in_remuneration\", wage_month) - ytd_since(\"in_remuneration\", next_month))",
      explain: "All remuneration in the wage period, earlier payslips of the period included (Code on Social Security 2020, section 2(88))."
    },
    {
      var: "excl",
      expr: "sum(\"in_code_excluded\") + (ytd_since(\"in_code_excluded\", wage_month) - ytd_since(\"in_code_excluded\", next_month))",
      explain: "Components the Code excludes from wages (items (a) to (i) of section 2(88)), earlier payslips of the period included."
    },
    {
      var: "ee_before",
      expr: "(ytd_code_since(\"IN_ESI_EE\", wage_month) - ytd_code_since(\"IN_ESI_EE\", next_month))",
      explain: "ESI already deducted by earlier payslips of this wage period."
    },
    {
      var: "wages",
      expr: "rem - excl + max(0, excl - 0.5 * rem)",
      explain: "Wages under the Code: when exclusions exceed half of the remuneration, the excess counts as wages."
    },
    {
      var: "covered",
      expr: "profile.in_esi_status == \"covered\" || (profile.in_esi_status == \"auto\" && wages > 0 && (wages <= 21000 || ee_before > 0))",
      explain: "Covered when the wage period's wages are within 21,000 (or an earlier payslip of the period already paid ESI), or when set as covered for the contribution period."
    },
    {
      check: "!(profile.in_esi_status == \"auto\" && wages > 21000 && prev_regular_code(\"IN_ESI_EE\") > 0)",
      issue: "in_esi_wages_rose",
      severity: "warning",
      message: "Wages are above 21,000 after a month with ESI. Check whether the contribution period continues coverage and set ESI coverage to covered for the rest of it."
    },
    {
      code: "IN_ESI_EE",
      name: "ESI (employee 0.75%)",
      kind: "deduction",
      stage: "statutory",
      when: "covered",
      amount: "round_up(0.0075 * wages, 1) - ee_before",
      base: "wages",
      rate: "0.0075",
      round: { mode: "up", step: 1 },
      tags: ["in_esi_employee"],
      payee: "ESIC",
      filing: "in_esic"
    },
    {
      code: "IN_ESI_ER",
      name: "ESI (employer 3.25%)",
      kind: "employer",
      when: "covered && !profile.in_esi_pwd_employer_exempt",
      amount: "round_up(0.0325 * wages, 1) - (ytd_code_since(\"IN_ESI_ER\", wage_month) - ytd_code_since(\"IN_ESI_ER\", next_month))",
      base: "wages",
      rate: "0.0325",
      round: { mode: "up", step: 1 },
      payee: "ESIC",
      filing: "in_esic"
    }
  ],
  vectors: [
    {
      name: "Wages 18,500: both shares rounded up",
      source: "derived",
      reference: "Rule 19(1): employee 0.75% x 18,500 = 138.75, next higher rupee 139; employer 3.25% = 601.25, 602.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 18500, tags: ["in_remuneration"] }]
      },
      expect: { IN_ESI_EE: 139, IN_ESI_ER: 602 }
    },
    {
      name: "Wages 21,000: at the limit",
      source: "derived",
      reference: "21,000 is within the notified wages: employee 157.50, 158; employer 682.50, 683.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 21000, tags: ["in_remuneration"] }]
      },
      expect: { IN_ESI_EE: 158, IN_ESI_ER: 683 }
    },
    {
      name: "Wages 25,000: not covered",
      source: "derived",
      reference: "Above 21,000 with coverage on auto: no ESI.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 25000, tags: ["in_remuneration"] }]
      },
      expect: { IN_ESI_EE: 0, IN_ESI_ER: 0 }
    },
    {
      name: "Wages rose above 21,000 after an ESI month: warning",
      source: "derived",
      reference: "September had ESI; October wages 22,000 on auto: no ESI and a warning to set coverage.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 22000, tags: ["in_remuneration"] }],
        history: [
          { pay_date: "2026-09-30", period_end: "2026-09-30", kind: "regular", by_tag: { in_remuneration: 20000 }, by_code: { IN_ESI_EE: 150 } }
        ]
      },
      expect: { IN_ESI_EE: 0 },
      expect_issues: ["in_esi_wages_rose"]
    },
    {
      name: "Covered for the period, wages 22,000",
      source: "derived",
      reference: "Coverage set to covered: employee 165; employer 715.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        profile: { in_esi_status: "covered" },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 22000, tags: ["in_remuneration"] }]
      },
      expect: { IN_ESI_EE: 165, IN_ESI_ER: 715 }
    },
    {
      name: "Person with disability: no employer share",
      source: "derived",
      reference: "Rule 19(2): employer share not payable; employee 0.75% x 16,000 = 120.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        profile: { in_esi_pwd_employer_exempt: true },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 16000, tags: ["in_remuneration"] }]
      },
      expect: { IN_ESI_EE: 120, IN_ESI_ER: 0 }
    },
    {
      name: "50 percent rule: basic 8,000 and allowances 12,000",
      source: "derived",
      reference: "Remuneration 20,000; exclusions 12,000 exceed half by 2,000: wages 10,000. Employee 75; employer 325.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [
          { code: "IN_BASIC", kind: "earning", amount: 8000, tags: ["in_remuneration"] },
          { code: "IN_HRA", kind: "earning", amount: 12000, tags: ["in_remuneration", "in_code_excluded"] }
        ]
      },
      expect: { IN_ESI_EE: 75, IN_ESI_ER: 325 },
      expect_vars: { wages: 10000 }
    },
    {
      name: "Bonus payslip for an employee above the limit: no ESI",
      source: "derived",
      reference: "Regular pay 30,000 in November 2026 (above 21,000, no ESI). A 5,000 bonus (excluded under section 2(88)) in the same period: the period's wages are 30,000, so no ESI on the bonus payslip.",
      input: {
        run: { kind: "bonus", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        lines: [{ code: "IN_BONUS", kind: "earning", amount: 5000, tags: ["in_remuneration", "in_code_excluded"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 30000 }, by_code: {} }]
      },
      expect: { IN_ESI_EE: 0, IN_ESI_ER: 0 }
    },
    {
      name: "Second payslip of a covered period: only the difference",
      source: "derived",
      reference: "Regular pay 18,000 in November 2026 paid ESI 135 and 585. Arrears 2,000 in the same period: wages 20,000; employee 0.75% = 150, less 135 = 15; employer 3.25% = 650, less 585 = 65.",
      input: {
        run: { kind: "off_cycle", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        lines: [{ code: "IN_ARREARS", kind: "earning", amount: 2000, tags: ["in_remuneration"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 18000 }, by_code: { IN_ESI_EE: 135, IN_ESI_ER: 585 } }]
      },
      expect: { IN_ESI_EE: 15, IN_ESI_ER: 65 }
    },
    {
      name: "A period ending before 8 May 2026 is blocked",
      source: "derived",
      reference: "April 2026 falls under the ESI (Central) Rules 1950.",
      input: {
        run: { period_start: "2026-04-01", period_end: "2026-04-30", pay_date: "2026-04-30" },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 18000, tags: ["in_remuneration"] }]
      },
      expect: {},
      expect_issues: ["in_esi_pre_2026_rules"]
    }
  ],
  filings: [
    {
      code: "in_esic",
      name: "ESI contribution",
      frequency: "monthly",
      due_rule: "as the ESI regulations specify (not read this session)",
      form: "ESIC portal challan"
    }
  ],
  documents: []
};
