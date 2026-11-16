// India professional tax, Gujarat, version 2026.2.
// Verified by packs-verify against the Gujarat State Tax Department rate schedule; see `sources`, `ship` and `notes`.

module.exports = {
  code: "in-pt-gj",
  country: "IN",
  region: "GJ",
  name: "India professional tax, Gujarat",
  version: "2026.2",
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
      title: "Gujarat Commercial Tax Department, Rate of Profession Tax under the Gujarat State Tax on Professions, Trades, Callings and Employments Act, 1976 (entry 1)",
      url: "https://commercialtax.gujarat.gov.in/vatwebsite/download/schedule/Rate_of_Profession_Tax.pdf",
      retrieved: "2026-11-04",
      note: "Salary and wage earners (government and others alike): monthly salary or wages up to 12,000: zero; more than 12,000: 200 a month; effective from 01/04/2022. Explanation I: pay for other periods is reckoned on the actual amount for a month; Explanation II: a person who stops being a salary earner before the month ends pays proportionately less for that month."
    }
  ],
  notes: "Monthly profession tax on lines tagged in_pt_wages (the month's salary or wages), emitting IN_PT (tag in_pt, read by the old tax regime): nil up to 12,000, 200 above 12,000, from the State Tax Department's rate schedule for Schedule I entry 1 of the Act (the department publishes it for areas where the State Government is the designated authority; the Act levies Schedule I on persons employed in the State; where a municipal corporation is the designated authority, check its notice). Monthly pay only (Explanation I reckons the salary for a month; other frequencies are blocked). The proportionate reduction for a person who leaves before the month ends (Explanation II) is not computed: the pack warns on a termination run. Labour Welfare Fund is not included.",
  profile_fields: [],
  tags: [{ tag: "in_pt_wages", label: "Salary for professional tax", help: "Monthly salary or wages." }],
  seed_components: [],
  tables: { pt_monthly: { type: "bands", rows: [{ to: 12000, value: 0 }, { over: 12000, value: 200 }] } },
  steps: [
    {
      check: "run.frequency == \"monthly\"",
      issue: "in_pt_gj_frequency",
      severity: "blocker",
      message: "Gujarat profession tax is reckoned on the salary for a month; this pack covers monthly pay only."
    },
    {
      check: "run.kind != \"termination\"",
      issue: "in_pt_gj_leaving",
      severity: "warning",
      message: "A person who stops being a salary earner before the month ends pays proportionately less profession tax for that month (Explanation II); check the amount."
    },
    { var: "w", expr: "sum(\"in_pt_wages\")" },
    {
      code: "IN_PT",
      name: "Professional tax (Gujarat)",
      kind: "deduction",
      stage: "statutory",
      when: "run.kind == \"regular\"",
      amount: "band(\"pt_monthly\", w)",
      round: { mode: "half_up", step: 1 },
      tags: ["in_pt"],
      payee: "Gujarat profession tax designated authority",
      filing: "in_pt"
    }
  ],
  vectors: [
    {
      name: "Gujarat: 50,000 a month",
      source: "official",
      reference: "Rate schedule entry 1: more than 12,000: 200 a month.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 50000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 200 }
    },
    {
      name: "Gujarat: exactly 12,000 a month",
      source: "official",
      reference: "Rate schedule entry 1: up to 12,000: zero.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 12000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 0 }
    },
    {
      name: "Gujarat: 12,001 a month",
      source: "official",
      reference: "Rate schedule entry 1: more than 12,000: 200.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 12001, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 200 }
    },
    {
      name: "Gujarat: weekly pay is refused",
      source: "derived",
      reference: "Explanation I reckons the salary for a month.",
      input: {
        run: { frequency: "weekly", periods_per_year: 52, period_start: "2026-10-05", period_end: "2026-10-11", pay_date: "2026-10-12" },
        lines: [{ code: "B", kind: "earning", amount: 5000, tags: ["in_pt_wages"] }]
      },
      expect: {},
      expect_issues: ["in_pt_gj_frequency"]
    }
  ],
  filings: [
    {
      code: "in_pt",
      name: "Professional tax return and payment (Gujarat)",
      frequency: "monthly",
      due_rule: "per the state rules",
      form: "State professional tax return"
    }
  ],
  documents: []
};
