// Michigan (income tax withholding, UI) for 2026, version 2026.2.
// Verified by packs-gaps against Michigan Treasury Form 446 (2026) (gen/gen_us_mi.mjs); plain data for lib_engine.

module.exports = {
  code: "us-mi",
  country: "US",
  region: "MI",
  name: "Michigan (income tax withholding, UI)",
  version: "2026.2",
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
  currency: "USD",
  tax_year: { start: "01-01" },
  date_basis: "pay_date",
  requires: [],
  order: 20,
  ship: "active",
  tags: [
    { tag: "us_fit_wages", label: "Income tax wages" },
    { tag: "us_fica_wages", label: "FICA wages", help: "Start of UI wages." },
    { tag: "us_pretax_401k", label: "Pre-tax retirement deferral" },
    { tag: "us_pretax_125", label: "Section 125 plan" },
    { tag: "us_pretax_hsa", label: "HSA" }
  ],
  seed_components: [],
  min_wage: {
    hourly: null,
    monthly: null,
    note: "Enter the state or local minimum wage reference in context.min_wage_hourly."
  },
  documents: [],
  sources: [
    {
      title: "Michigan Department of Treasury, Form 446 (Rev. 02-26), 2026 Michigan Income Tax Withholding Guide",
      url: "https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2026/446_Withholding-Guide_2026.pdf",
      retrieved: "2026-11-10",
      note: "michigan.gov answers 403 here; read from the web.archive.org copy of 18 October 2026 (linked from the archived 2026 Withholding Tax Forms page). Withholding rate 4.25%, personal exemption amount $5,900. \"The withholding rate is 4.25 percent of compensation after deducting the personal and dependency exemption allowance\" (direct percentage computation). Compensation as in IRS Publication 15 \"Taxable Wages\". Bonuses and other payments made separately from regular payroll: payment x 4.25%, no adjustment for exemptions. No valid MI-W4: withhold on zero exemptions."
    },
    {
      title: "USDA National Finance Center bulletin, Michigan State Income Tax Withholding (July 15, 2026)",
      url: "https://help.nfc.usda.gov/bulletins/2026/1781704387.htm",
      retrieved: "2026-11-04",
      note: "Secondary, kept for reference: the same 4.25% and $5,900. The NFC applied the $5,900 from its pay period 12; Form 446 (2026) states $5,900 for the 2026 tax year, so this pack uses it for every 2026 pay date."
    }
  ],
  notes: "Form 446 (2026) direct percentage computation: wages for the period (federal taxable wages: less 401(k), section 125 and HSA deferrals) less the $5,900 exemption allowance per MI-W4 exemption prorated over the pay periods of the year, times 4.25%, plus the MI-W4 additional amount; exempt employees have none withheld. Bonuses and other payments made separately from regular payroll (bonus, correction and off-cycle runs): 4.25% of the payment with no exemption allowance. Without a valid MI-W4 the default of zero exemptions applies. Employer UI: rate and 2026 taxable wage base are entity fields from the Michigan Unemployment Insurance Agency notice (no default base is shipped; the US Department of Labor summary answered 502); the base counts FICA wages less section 125 plans. Not covered: city income taxes (Detroit and the other cities that levy one), pension withholding on MI W-4P, Form 446's calculator rounding (amounts are kept to the cent).",
  profile_fields: [
    {
      key: "mi_exemptions",
      label: "Michigan exemptions",
      type: "number",
      default: 0,
      min: 0,
      form: "MI-W4 line 6"
    },
    {
      key: "mi_extra",
      label: "Additional Michigan withholding each pay period",
      type: "money",
      default: 0,
      min: 0,
      form: "MI-W4 line 7"
    },
    {
      key: "mi_exempt",
      label: "Exempt from Michigan withholding",
      type: "boolean",
      default: false,
      form: "MI-W4 line 8"
    },
    {
      key: "mi_ui_rate",
      scope: "entity",
      label: "Michigan UI rate",
      type: "number",
      default: 0,
      min: 0,
      max: 0.2,
      help: "From the employer's Michigan Unemployment Insurance Agency rate notice."
    },
    {
      key: "mi_ui_wage_base",
      scope: "entity",
      label: "Michigan UI taxable wage base for 2026",
      type: "money",
      min: 0,
      help: "From Michigan Unemployment Insurance Agency. Needed when the UI rate is above zero."
    }
  ],
  tables: {},
  steps: [
    {
      var: "wages",
      expr: "max(0, sum(\"us_fit_wages\") - sum(\"us_pretax_401k\") - sum(\"us_pretax_125\") - sum(\"us_pretax_hsa\"))"
    },
    { var: "n", expr: "periods()" },
    {
      code: "US_MI_SIT",
      name: "Michigan income tax",
      kind: "deduction",
      stage: "statutory",
      when: "!profile.mi_exempt",
      amount: "in(run.kind, \"bonus\", \"correction\", \"off_cycle\") ? wages * 0.0425 : max(0, wages * n - 5900 * profile.mi_exemptions) * 0.0425 / n + profile.mi_extra",
      round: { mode: "half_up", step: 0.01 },
      tags: ["us_tax", "us_state_tax"],
      payee: "Michigan Treasury",
      filing: "us_mi_5080"
    },
    {
      check: "entity.mi_ui_rate == 0 || coalesce(entity.mi_ui_wage_base, 0) > 0",
      issue: "us_mi_ui_base_missing",
      severity: "warning",
      message: "Enter the Michigan UI wage base on the entity; UI is not calculated without it."
    },
    { var: "ui_this", expr: "max(0, sum(\"us_fica_wages\") - sum(\"us_pretax_125\"))" },
    { var: "ui_ytd", expr: "max(0, ytd(\"us_fica_wages\") - ytd(\"us_pretax_125\"))" },
    { var: "ui_wages", expr: "min(ui_this, max(0, coalesce(entity.mi_ui_wage_base, 0) - ui_ytd))" },
    {
      code: "US_MI_UI",
      name: "Michigan UI (employer)",
      kind: "employer",
      amount: "ui_wages * entity.mi_ui_rate",
      round: { mode: "half_up", step: 0.01 },
      tags: ["us_employer_tax"],
      payee: "Michigan Unemployment Insurance Agency",
      filing: "us_mi_ui"
    }
  ],
  vectors: [
    {
      name: "Biweekly $2,000, 2 exemptions",
      source: "derived",
      reference: "Form 446 (2026): 4.25% after the exemption allowance. (2,000 x 26 - 2 x 5,900) x 4.25% / 26 = (52,000 - 11,800) x 0.0425 / 26 = 65.71.",
      input: {
        run: {
          frequency: "biweekly",
          periods_per_year: 26,
          period_start: "2026-09-07",
          period_end: "2026-09-20",
          pay_date: "2026-09-25"
        },
        profile: { mi_exemptions: 2 },
        lines: [
          {
            code: "US_SALARY",
            kind: "earning",
            amount: 2000,
            tags: ["us_fit_wages", "us_fica_wages", "us_futa_wages"]
          }
        ]
      },
      expect: { US_MI_SIT: 65.71 }
    },
    {
      name: "Weekly $900, 1 exemption, $10 additional",
      source: "derived",
      reference: "Allowance 5,900 / 52 = 113.4615; (900 - 113.4615) x 4.25% = 33.43; plus MI-W4 line 7 $10 = 43.43.",
      input: {
        run: {
          frequency: "weekly",
          periods_per_year: 52,
          period_start: "2026-09-07",
          period_end: "2026-09-13",
          pay_date: "2026-09-18"
        },
        profile: { mi_exemptions: 1, mi_extra: 10 },
        lines: [
          {
            code: "US_SALARY",
            kind: "earning",
            amount: 900,
            tags: ["us_fit_wages", "us_fica_wages", "us_futa_wages"]
          }
        ]
      },
      expect: { US_MI_SIT: 43.43 }
    },
    {
      name: "Monthly $5,000 with a $300 401(k) deferral, no MI-W4",
      source: "derived",
      reference: "Zero exemptions without a valid MI-W4. Taxable wages 5,000 - 300 = 4,700 x 4.25% = 199.75.",
      input: {
        run: {
          frequency: "monthly",
          periods_per_year: 12,
          period_start: "2026-09-01",
          period_end: "2026-09-30",
          pay_date: "2026-09-30"
        },
        lines: [
          {
            code: "US_SALARY",
            kind: "earning",
            amount: 5000,
            tags: ["us_fit_wages", "us_fica_wages", "us_futa_wages"]
          },
          { code: "US_401K", kind: "deduction", stage: "pre", amount: 300, tags: ["us_pretax_401k"] }
        ]
      },
      expect: { US_MI_SIT: 199.75 }
    },
    {
      name: "Bonus paid separately: 4.25% with no exemptions",
      source: "derived",
      reference: "Form 446: payment x 4.25%, no adjustment for exemptions. 3,000 x 0.0425 = 127.50.",
      input: {
        run: {
          kind: "bonus",
          frequency: "biweekly",
          periods_per_year: 26,
          period_start: "2026-09-07",
          period_end: "2026-09-20",
          pay_date: "2026-09-25"
        },
        profile: { mi_exemptions: 3 },
        lines: [
          {
            code: "US_SALARY",
            kind: "earning",
            amount: 3000,
            tags: ["us_fit_wages", "us_fica_wages", "us_futa_wages", "us_supplemental"]
          }
        ]
      },
      expect: { US_MI_SIT: 127.5 }
    },
    {
      name: "Wages below the allowance: nothing withheld",
      source: "derived",
      reference: "Biweekly 400 with 2 exemptions: 10,400 a year is less than 11,800, so 0.",
      input: {
        run: {
          frequency: "biweekly",
          periods_per_year: 26,
          period_start: "2026-09-07",
          period_end: "2026-09-20",
          pay_date: "2026-09-25"
        },
        profile: { mi_exemptions: 2 },
        lines: [
          {
            code: "US_SALARY",
            kind: "earning",
            amount: 400,
            tags: ["us_fit_wages", "us_fica_wages", "us_futa_wages"]
          }
        ]
      },
      expect: { US_MI_SIT: 0 }
    },
    {
      name: "Exempt on the MI-W4",
      source: "derived",
      reference: "MI-W4 line 8: no withholding.",
      input: {
        run: {
          frequency: "biweekly",
          periods_per_year: 26,
          period_start: "2026-09-07",
          period_end: "2026-09-20",
          pay_date: "2026-09-25"
        },
        profile: { mi_exempt: true },
        lines: [
          {
            code: "US_SALARY",
            kind: "earning",
            amount: 2000,
            tags: ["us_fit_wages", "us_fica_wages", "us_futa_wages"]
          }
        ]
      },
      expect: { US_MI_SIT: 0 }
    },
    {
      name: "Employer UI to the entered wage base",
      source: "derived",
      reference: "Entity rate 2.7% and base 9,500 entered by the employer; 8,000 already paid this year, so 1,500 of this 2,000 is taxable: 40.50.",
      input: {
        run: {
          frequency: "biweekly",
          periods_per_year: 26,
          period_start: "2026-09-07",
          period_end: "2026-09-20",
          pay_date: "2026-09-25"
        },
        entity: { mi_ui_rate: 0.027, mi_ui_wage_base: 9500 },
        lines: [
          {
            code: "US_SALARY",
            kind: "earning",
            amount: 2000,
            tags: ["us_fit_wages", "us_fica_wages", "us_futa_wages"]
          }
        ],
        history: [
          {
            kind: "regular",
            pay_date: "2026-09-11",
            period_start: "2026-08-24",
            period_end: "2026-09-06",
            by_tag: { us_fica_wages: 8000, us_fit_wages: 8000 },
            by_code: {}
          }
        ]
      },
      expect: { US_MI_UI: 40.5 }
    }
  ],
  filings: [
    {
      code: "us_mi_5080",
      name: "Form 5080 Sales, Use and Withholding Monthly/Quarterly Return",
      frequency: "monthly_or_quarterly",
      due_rule: "20th of the month after the period",
      form: "5080"
    },
    {
      code: "us_mi_ui",
      name: "UIA quarterly wage and tax report",
      frequency: "quarterly",
      due_rule: "25th of the month after the quarter",
      form: "UIA 1028"
    }
  ]
};
