// India professional tax, Karnataka, version 2026.3 (draft).
// Updated by packs-gaps (gen/gen_in_pt.mjs); see `sources`, `ship` and `notes`.

module.exports = {
  code: "in-pt-ka",
  country: "IN",
  region: "KA",
  name: "India professional tax, Karnataka",
  version: "2026.3",
  effective_from: "2026-04-01",
  effective_to: "2027-03-31",
  currency: "INR",
  tax_year: { start: "04-01" },
  date_basis: "period_end",
  requires: [],
  order: 20,
  ship: "draft",
  sources: [
    {
      title: "Karnataka Gazette Extraordinary No. 232, 15 April 2025: Karnataka Act No. 33 of 2025, the Karnataka Tax on Profession, Trades, Callings and Employments (Amendment) Act, 2025 (DPAL 08 SHASANA 2025)",
      url: "https://taxguru.in/wp-content/uploads/2025/04/Karnataka-PT-Amendment-Act-2025_compressed-1-4.pdf",
      retrieved: "2026-11-10",
      note: "A reproduction of the Gazette pages on a tax news site (no official copy was reachable: dpal.karnataka.gov.in, pt.kar.nic.in and gst.kar.nic.in time out and the archive holds no copy). In force from 1 April 2025; in serial number 1, column (3) becomes \"Rs.200-00 per month (except for the month of February); Rs.300-00 for the month of February\"."
    },
    {
      title: "Karnataka Commercial Taxes PT portal: The Karnataka Tax on Profession, Trades, Callings and Employments (Amendment) Bill, 2023, substituted Schedule",
      url: "https://pt.kar.nic.in/ptemployer/documents/pt%20amendment%20bill.pdf",
      retrieved: "2026-11-10",
      note: "web.archive.org copy of 14 July 2024. Serial number 1: salary or wage earners whose salary or wage for a month is Rs. 25,000 and above. This is the Bill text; the enacted 2023 Act was not read."
    },
    {
      title: "Karnataka Tax on Profession, Trades, Callings and Employments (Amendment) Bill, 2026 (LA Bill No. 08 of 2026), PRS India copy",
      url: "https://prsindia.org/files/bills_acts/bills_states/karnataka/2026/Bill8of2026KA.pdf",
      retrieved: "2026-11-10",
      note: "Procedural only (deemed returns from 1 April 2026); no change to the Schedule."
    }
  ],
  notes: "DRAFT (activation-ready, needs one check): salary or wage earners with a month's salary of 25,000 and above pay 200 a month and 300 in February (Act 33 of 2025, in force from 1 April 2025); below 25,000 nil. The 2025 Act was read from a reproduction of the Karnataka Gazette and the 25,000 threshold from the 2023 Bill on the PT portal, not from the enacted texts on an official host, so a person must confirm both (Karnataka Gazette 15 April 2025; the 2023 amendment Act) and activate it in Settings. Regular and final pay carry the month's tax on the month's salary across payslips, less tax already deducted this month; bonus and off-cycle payslips carry none. Labour Welfare Fund is not included.",
  profile_fields: [],
  tags: [{ tag: "in_pt_wages", label: "Salary for professional tax", help: "Gross monthly salary." }],
  seed_components: [],
  tables: { pt_monthly: { type: "bands", rows: [{ under: 25000, value: 0 }, { from: 25000, value: 200 }] } },
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
    { var: "base_pt", expr: "band(\"pt_monthly\", w)" },
    {
      code: "IN_PT",
      name: "Professional tax (Karnataka)",
      kind: "deduction",
      stage: "statutory",
      when: "run.kind == \"regular\" || run.kind == \"termination\"",
      amount: "(month(run.period_end) == 2 && base_pt == 200 ? 300 : base_pt) - (ytd_code_since(\"IN_PT\", wage_month) - ytd_code_since(\"IN_PT\", next_month))",
      round: { mode: "half_up", step: 1 },
      tags: ["in_pt"],
      payee: "Karnataka Commercial Taxes Department",
      filing: "in_pt",
      explain: "Schedule serial 1: 200 a month (300 in February) at 25,000 and above, less tax already deducted this month."
    }
  ],
  vectors: [
    {
      name: "Karnataka: 25,000 a month",
      source: "derived",
      reference: "Serial 1: 25,000 and above: 200.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 25000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 200 }
    },
    {
      name: "Karnataka: 24,999 a month",
      source: "derived",
      reference: "Below 25,000: nil.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        lines: [{ code: "B", kind: "earning", amount: 24999, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 0 }
    },
    {
      name: "Karnataka: February",
      source: "derived",
      reference: "Act 33 of 2025: 300 for the month of February.",
      input: {
        run: { period_start: "2027-02-01", period_end: "2027-02-28", pay_date: "2027-02-28" },
        lines: [{ code: "B", kind: "earning", amount: 50000, tags: ["in_pt_wages"] }]
      },
      expect: { IN_PT: 300 }
    },
    {
      name: "Karnataka: final pay in a month already taxed",
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
      name: "Professional tax return and payment (Karnataka)",
      frequency: "monthly",
      due_rule: "per the state rules",
      form: "State professional tax return"
    }
  ],
  documents: []
};
