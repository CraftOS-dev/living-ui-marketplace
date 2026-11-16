// India professional tax, Maharashtra, version 2026.3.
// Verified by packs-gaps against the Maharashtra GST Department rate schedule (gen/gen_in_pt.mjs); see `sources`, `ship` and `notes`.

module.exports = {
  code: "in-pt-mh",
  country: "IN",
  region: "MH",
  name: "India professional tax, Maharashtra",
  version: "2026.3",
  effective_from: "2026-04-01",
  effective_to: "2027-03-31",
  currency: "INR",
  tax_year: { start: "04-01" },
  date_basis: "period_end",
  requires: [],
  order: 20,
  ship: "active",
  sources: [
    {
      title: "Maharashtra Goods and Services Tax Department, Rate Schedules under the Profession Tax Act, 1975: Schedule I (see section 3), entry 1, salary and wage earners, \"1/4/2023 onwards\" (as on 31.03.2025; posted again on the Profession Tax rate schedule page on 07/02/2026)",
      url: "https://www.mahagst.gov.in/public/uploads/menufiles/PT%20Rate%20Schedule%20updated%20upto%2031.03.2025%20(1)%20(1).pdf",
      retrieved: "2026-11-10",
      note: "mahagst.gov.in refuses connections here; read from the web.archive.org copies (22 December 2025; the 2026 posting \"Rate Schedules under the Professions Tax Act, 1975\" captured 12 March 2026 has the same entry). Men: monthly salary or wages up to 7,500 nil; over 7,500 to 10,000: 175 a month; over 10,000: 2,500 a year, paid as 200 a month except February and 300 for February. Women: up to 25,000 nil; over 25,000: 2,500 a year, 200 a month except February and 300 for February."
    },
    {
      title: "Maharashtra GST Department, Profession Tax and Other Rate Schedule page (list of rate schedules, 07/02/2026)",
      url: "https://www.mahagst.gov.in/en/profession-tax-and-other-rate-schedule",
      retrieved: "2026-11-10",
      note: "web.archive.org copy of 7 February 2026. The Maharashtra State Tax on Professions (Amendment) Rules, 2026 (28 February 2026) changed Rule 11(3) payment dates, not Schedule I."
    }
  ],
  notes: "Monthly profession tax under Schedule I entry 1 on lines tagged in_pt_wages (the month's salary or wages across every payslip of the month), emitting IN_PT (tag in_pt, read by the old tax regime). Men: nil to 7,500, 175 over 7,500 to 10,000, 200 over 10,000 and 300 in February. Women: nil to 25,000, 200 over 25,000 and 300 in February. The women's slab follows the profile switch, else the employee's recorded gender (anything other than female uses the men's slab). Regular and final pay carry the month's tax less tax already deducted this month; bonus and off-cycle payslips carry none. Not covered: Labour Welfare Fund, entries 2 onwards (professions, traders, employers' own enrolment).",
  profile_fields: [
    {
      key: "in_pt_women",
      label: "Maharashtra women's slab applies",
      type: "boolean",
      help: "Women earning up to 25,000 a month are exempt. Leave empty to use the employee's recorded gender."
    }
  ],
  tags: [{ tag: "in_pt_wages", label: "Salary for professional tax", help: "Gross monthly salary." }],
  seed_components: [],
  tables: {
    pt_men: {
      type: "bands",
      rows: [{ to: 7500, value: 0 }, { over: 7500, to: 10000, value: 175 }, { over: 10000, value: 200 }]
    },
    pt_women: { type: "bands", rows: [{ to: 25000, value: 0 }, { over: 25000, value: 200 }] }
  },
  steps: [
    {
      var: "wage_month",
      expr: "month_start(run.period_end)",
      explain: "Professional tax is due on the month's salary, across every salary payslip of the month."
    },
    { var: "next_month", expr: "add_months(wage_month, 1)" },
    {
      var: "w",
      expr: "sum(\"in_pt_wages\") + (ytd_since(\"in_pt_wages\", wage_month) - ytd_since(\"in_pt_wages\", next_month))"
    },
    { var: "women", expr: "coalesce(profile.in_pt_women, employee.gender == \"female\")" },
    { var: "base_pt", expr: "women ? band(\"pt_women\", w) : band(\"pt_men\", w)" },
    {
      code: "IN_PT",
      name: "Professional tax (Maharashtra)",
      kind: "deduction",
      stage: "statutory",
      when: "run.kind == \"regular\" || run.kind == \"termination\"",
      amount: "(month(run.period_end) == 2 && base_pt == 200 ? 300 : base_pt) - (ytd_code_since(\"IN_PT\", wage_month) - ytd_code_since(\"IN_PT\", next_month))",
      round: { mode: "half_up", step: 1 },
      tags: ["in_pt"],
      payee: "Maharashtra GST Department",
      filing: "in_pt",
      explain: "Schedule I entry 1: the month's slab (300 in February for the 2,500 a year slab) less tax already deducted this month."
    }
  ],
  vectors: [
    {
      name: "Man earning 7,500",
      source: "official",
      reference: "Schedule I entry 1(i)(a): does not exceed 7,500: nil.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "male" },
        lines: [{ code: "B", kind: "earning", amount: 7500, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 0 }
    },
    {
      name: "Man earning 7,501",
      source: "official",
      reference: "Entry 1(i)(b): exceeds 7,500 but not 10,000: 175 a month.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "male" },
        lines: [{ code: "B", kind: "earning", amount: 7501, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 175 }
    },
    {
      name: "Man earning 10,000",
      source: "official",
      reference: "Entry 1(i)(b): 175 a month.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "male" },
        lines: [{ code: "B", kind: "earning", amount: 10000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 175 }
    },
    {
      name: "Man earning 10,001 in October",
      source: "official",
      reference: "Entry 1(i)(c): exceeds 10,000: 200 a month except February.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "male" },
        lines: [{ code: "B", kind: "earning", amount: 10001, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 200 }
    },
    {
      name: "Man earning 50,000 in February",
      source: "official",
      reference: "Entry 1(i)(c): 300 for the month of February.",
      input: {
        run: { period_start: "2027-02-01", period_end: "2027-02-28", pay_date: "2027-02-28" },
        employee: { gender: "male" },
        lines: [{ code: "B", kind: "earning", amount: 50000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 300 }
    },
    {
      name: "Woman earning 25,000",
      source: "official",
      reference: "Entry 1(ii)(a): does not exceed 25,000: nil.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "female" },
        lines: [{ code: "B", kind: "earning", amount: 25000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 0 }
    },
    {
      name: "Woman earning 25,001 in October",
      source: "official",
      reference: "Entry 1(ii)(b): exceeds 25,000: 200 a month except February.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "female" },
        lines: [{ code: "B", kind: "earning", amount: 25001, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 200 }
    },
    {
      name: "Woman earning 30,000 in February",
      source: "official",
      reference: "Entry 1(ii)(b): 300 for February.",
      input: {
        run: { period_start: "2027-02-01", period_end: "2027-02-28", pay_date: "2027-02-28" },
        employee: { gender: "female" },
        lines: [{ code: "B", kind: "earning", amount: 30000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 300 }
    },
    {
      name: "Women's slab by the profile switch",
      source: "derived",
      reference: "Switch on, gender not recorded: 20,000 is within the women's nil slab.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        profile: { in_pt_women: true },
        lines: [{ code: "B", kind: "earning", amount: 20000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 0 }
    },
    {
      name: "Maharashtra: final pay in a month already taxed",
      source: "derived",
      reference: "A regular payslip of October already paid 200 on 50,000; a final pay in the same month carries 0 more.",
      input: {
        run: { kind: "termination", period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "male" },
        lines: [{ code: "B", kind: "earning", amount: 20000, tags: ["in_pt_wages"] }],
        history: [
          {
            pay_date: "2026-10-31",
            period_end: "2026-10-31",
            kind: "regular",
            by_tag: { in_pt_wages: 50000 },
            by_code: { IN_PT: 200 }
          }
        ]
      },
      expect: { IN_PT: 0 }
    },
    {
      name: "Bonus payslip: no tax",
      source: "derived",
      reference: "Profession tax is on the month's salary on regular and final pay only.",
      input: {
        run: { kind: "bonus", period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { gender: "male" },
        lines: [{ code: "B", kind: "earning", amount: 30000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 0 }
    }
  ],
  filings: [
    {
      code: "in_pt",
      name: "Profession tax (PTRC) return and payment (Maharashtra)",
      frequency: "monthly",
      due_rule: "per Rule 11 of the Maharashtra Profession Tax Rules (amended 28 February 2026)",
      form: "PTRC return"
    }
  ],
  documents: []
};
