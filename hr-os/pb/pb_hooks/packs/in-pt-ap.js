// India professional tax, Andhra Pradesh, version 2026.3.
// Verified by packs-gaps against the Andhra Pradesh Commercial Taxes Department schedule (gen/gen_in_pt.mjs); see `sources`, `ship` and `notes`.

module.exports = {
  code: "in-pt-ap",
  country: "IN",
  region: "AP",
  name: "India professional tax, Andhra Pradesh",
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
      title: "Andhra Pradesh Commercial Taxes Department, APPT Schedule: First Schedule to the Andhra Pradesh Tax on Professions, Trades, Callings and Employments Act, 1987 (as amended up to date), entry 1",
      url: "https://apct.gov.in/apportal/AllActs/APPT/APPTSchedule.aspx",
      retrieved: "2026-11-10",
      note: "apct.gov.in refuses connections here; read from the web.archive.org copy of 23 June 2022. Salary and wage earners whose monthly salaries or wages are up to 15,000: nil; from 15,001 to 20,000: 150 a month; above 20,000: 200 a month."
    },
    {
      title: "Andhra Pradesh Commercial Taxes Department, APPT rates and tariffs (appt_rates_tarrifs.pdf)",
      url: "https://apct.gov.in/GSTPortal/GST_Portal/Help_docs/appt_rates_tarrifs.pdf",
      retrieved: "2026-11-10",
      note: "web.archive.org copy of 26 June 2022: entry 1 (a) 0, (b) 150, (c) 200, the same \"up to 2019-2020\" and \"from 2020-2021\"."
    },
    {
      title: "HROne, Professional tax slab rates 2026-27 (updated 9 Jun 2026)",
      url: "https://hrone.cloud/blog/professional-tax-slab-rates-2026-27/",
      retrieved: "2026-11-04",
      note: "Secondary: the same three slabs for 2026-27, so no amendment after the 2022 official copy is known."
    }
  ],
  notes: "Monthly profession tax under entry 1 of the First Schedule on lines tagged in_pt_wages (the month's salary or wages across every payslip of the month), emitting IN_PT (tag in_pt, read by the old tax regime): nil up to 15,000, 150 from 15,001 to 20,000, 200 above 20,000. The official schedule was read in its June 2022 copy (the state site is unreachable); 2026-27 summaries show the same slabs. Regular and final pay carry the month's tax less tax already deducted this month; bonus and off-cycle payslips carry none. Labour Welfare Fund is not included.",
  profile_fields: [],
  tags: [{ tag: "in_pt_wages", label: "Salary for professional tax", help: "Gross monthly salary." }],
  seed_components: [],
  tables: {
    pt_monthly: {
      type: "bands",
      rows: [{ to: 15000, value: 0 }, { over: 15000, to: 20000, value: 150 }, { over: 20000, value: 200 }]
    }
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
    {
      code: "IN_PT",
      name: "Professional tax (Andhra Pradesh)",
      kind: "deduction",
      stage: "statutory",
      when: "run.kind == \"regular\" || run.kind == \"termination\"",
      amount: "band(\"pt_monthly\", w) - (ytd_code_since(\"IN_PT\", wage_month) - ytd_code_since(\"IN_PT\", next_month))",
      round: { mode: "half_up", step: 1 },
      tags: ["in_pt"],
      payee: "Andhra Pradesh professional tax authority",
      filing: "in_pt"
    }
  ],
  vectors: [
    {
      name: "Andhra Pradesh: 15,000 a month",
      source: "official",
      reference: "First Schedule entry 1(i): up to 15,000: nil.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 15000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 0 }
    },
    {
      name: "Andhra Pradesh: 15,001 a month",
      source: "official",
      reference: "Entry 1(ii): from 15,001 to 20,000: 150 a month.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 15001, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 150 }
    },
    {
      name: "Andhra Pradesh: 20,000 a month",
      source: "official",
      reference: "Entry 1(ii): 150 a month.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 20000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 150 }
    },
    {
      name: "Andhra Pradesh: 20,001 a month",
      source: "official",
      reference: "Entry 1(iii): above 20,000: 200 a month.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 20001, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 200 }
    },
    {
      name: "Andhra Pradesh: final pay in a month already taxed",
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
    }
  ],
  filings: [
    {
      code: "in_pt",
      name: "Professional tax return and payment (Andhra Pradesh)",
      frequency: "monthly",
      due_rule: "per the state rules",
      form: "State professional tax return"
    }
  ],
  documents: []
};
