// India rule pack: EPF, EPS, EDLI under the Code on Social Security 2020, version 2026.3.
// Fix round 1 (packs-asia): contributions over the whole wage period across payslips.
// Verified by packs-verify against the Gazette of India notifications listed in `sources`.

module.exports = {
  code: "in-epf",
  country: "IN",
  region: "",
  name: "India EPF, EPS, EDLI and PF charges (Code on Social Security 2020)",
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
      title: "Gazette of India G.S.R. 525(E), 29 June 2026: Employees' Provident Funds Scheme, 2026 (Issue 473), paragraphs 9, 18, 19 and 29",
      url: "https://egazette.gov.in/WriteReadData/2026/273957.pdf",
      retrieved: "2026-11-04",
      note: "Para 18(2): employer 12 percent of wages, employee equal (10 percent for notified classes); 18(3): contributions limited to the wage ceiling, except the joint option of para 9(4) and (6); 18(5): each contribution to the nearest rupee, 50 paise or more counted as the next rupee; para 19: voluntary contributions; para 29: administrative charges at a percentage the Central Government fixes."
    },
    {
      title: "Gazette of India G.S.R. 703(E), 4 August 2026: corrigenda to the EPF Scheme, 2026",
      url: "https://egazette.gov.in/WriteReadData/2026/275186.pdf",
      retrieved: "2026-11-04",
      note: "Page 76 line 1: para 18(3) reads 'member other than international workers', so the wage ceiling does not limit an international worker's contributions."
    },
    {
      title: "Gazette of India G.S.R. 527(E), 29 June 2026: Employees' Pension Scheme, 2026 (Issue 475), paragraphs 4 and 7",
      url: "https://egazette.gov.in/WriteReadData/2026/273951.pdf",
      retrieved: "2026-11-04",
      note: "Para 4(1): 8.33 percent of wages up to the wage ceiling from the employer's contribution; 4(3): nearest rupee, 50 paise up; para 7: membership ends on attaining the age of superannuation."
    },
    {
      title: "Gazette of India G.S.R. 526(E), 29 June 2026: Employees' Deposit-Linked Insurance Scheme, 2026 (Issue 474), paragraph 5",
      url: "https://egazette.gov.in/WriteReadData/2026/273942.pdf",
      retrieved: "2026-11-04",
      note: "Contribution on Code wages subject to the wage ceiling, at the notified rate, to the nearest rupee with 50 paise up."
    },
    {
      title: "Gazette of India S.O. 3580(E), S.O. 3581(E) and S.O. 3582(E), 1 July 2026",
      url: "https://egazette.gov.in/WriteReadData/2026/274112.pdf",
      retrieved: "2026-11-04",
      note: "S.O. 3582(E) (this url): 12 percent for employer and employee, except establishments with an approved IBC resolution or repayment plan and the jute, beedi, brick, coir (other than spinning) and guar gum industries; deemed in force from 21 November 2025. S.O. 3580(E) (https://egazette.gov.in/WriteReadData/2026/274111.pdf): pension 8.33 percent from 29 June 2026. S.O. 3581(E) (https://egazette.gov.in/WriteReadData/2026/274104.pdf): EDLI one-half percent from 29 June 2026."
    },
    {
      title: "Gazette of India S.O. 2702(E), 29 May 2026, and S.O. 5109(E), 17 September 2026: wage ceiling for Chapter III",
      url: "https://egazette.gov.in/WriteReadData/2026/276299.pdf",
      retrieved: "2026-11-04",
      note: "S.O. 5109(E) (this url): 25,000 a month from its publication on 17 September 2026, superseding S.O. 2702(E) (https://egazette.gov.in/WriteReadData/2026/273002.pdf): 15,000 a month."
    },
    {
      title: "PIB, Ministry of Labour and Employment: EPFO Berhampore (Release 2313829) and EPFO Imphal (Release 2314111), 23 September 2026",
      url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2313829&reg=48&lang=2",
      retrieved: "2026-11-04",
      note: "Maximum employer pension contribution at 8.33 percent rises from 1,250 to 2,083 a month; contributions on 25,000 or the actual wages, whichever is lower."
    },
    {
      title: "The Code on Social Security, 2020 (Ministry of Labour and Employment copy), section 2(82), 2(88) and 2(89)",
      url: "https://www.labour.gov.in/static/uploads/2025/07/b0620548445580767b5c0d18c95c26f7.pdf",
      retrieved: "2026-11-04",
      note: "2(82): age of superannuation for Chapter III is fifty-eight years; 2(88): wages include basic pay, dearness and retaining allowance and exclude items (a) to (k); when (a) to (i) exceed one-half of all remuneration, the excess is added to wages; 2(89): wage ceiling as notified."
    }
  ],
  notes: "Covers PF, EPS, EDLI and an administrative charge line under the Code on Social Security 2020 and the 2026 schemes, for wage periods ending on or after 29 June 2026 (earlier periods fall under the 1952, 1995 and 1976 schemes, which this version does not cover: blocker). Wages: lines tagged in_remuneration less lines tagged in_code_excluded (section 2(88) items (a) to (i)), with the excess of those exclusions over half of the remuneration added back. Do not tag gratuity or retrenchment compensation (items (j) and (k)) as remuneration. Rates: 12 percent employer and employee, or 10 percent for an entity in the classes S.O. 3582(E) lists; EPS 8.33 percent of wages up to the ceiling from the employer share, the employer's PF the rest; EDLI 0.5 percent up to the ceiling; every contribution to the nearest rupee. Ceiling 15,000, and 25,000 for periods starting on or after 17 September 2026 (a period that spans that day is blocked). The ceiling does not apply to an international worker or to an employee on the joint option to contribute on full wages; EPS is still on wages up to the ceiling. EPS stops at 58 (section 2(82)); in the period of the 58th birthday the person enters the pension wages up to that day. Administrative charges: the rate is fixed by the Central Government (para 29) and was not readable from EPFO this session, so it is an entity field without a default and the line stays out until it is entered; the establishment minimum charge is not applied per employee. The wage period is computed as one: wages, the ceiling and the 50 percent rule apply to the period's total across payslips (regular, bonus, final and off-cycle), and each payslip carries the period's contribution less what earlier payslips of the period paid, so a bonus run never charges the ceiling twice. Not covered: higher pension at 9.49 percent on actual wages (para 4 proviso), pension Central Government share, inspection charges of exempted establishments, PF on arrears.",
  profile_fields: [
    { key: "in_pf_member", label: "PF member", type: "boolean", default: true },
    {
      key: "in_eps_member",
      label: "Pension scheme (EPS) member",
      type: "boolean",
      default: true,
      help: "Off for members outside EPS (for example joined above the wage ceiling)."
    },
    {
      key: "in_pf_full_wages",
      label: "PF on full wages (joint option above the ceiling)",
      type: "boolean",
      default: false,
      form: "EPF Scheme 2026 para 9(4)"
    },
    {
      key: "in_vpf_rate",
      label: "Voluntary PF rate",
      type: "number",
      default: 0,
      min: 0,
      max: 1,
      help: "Additional voluntary contribution as a rate of PF wages, for example 0.05 for 5 percent.",
      form: "EPF Scheme 2026 para 19"
    },
    {
      key: "in_international_worker",
      label: "International worker (no wage ceiling)",
      type: "boolean",
      default: false
    },
    {
      key: "in_eps_wages_58",
      label: "Pension wages in the period of the 58th birthday",
      type: "money",
      min: 0,
      help: "Wages up to the day before the employee reached 58, used for EPS in that period only."
    },
    {
      key: "in_pf_rate_class",
      scope: "entity",
      label: "PF contribution rate class",
      type: "enum",
      default: "standard",
      options: [
        { value: "standard", label: "12 percent" },
        { value: "reduced", label: "10 percent (IBC resolution or repayment plan; jute, beedi, brick, coir other than spinning, guar gum)" }
      ],
      form: "S.O. 3582(E)"
    },
    {
      key: "in_pf_admin_rate",
      scope: "entity",
      label: "PF administrative charges rate",
      type: "number",
      min: 0,
      max: 0.05,
      help: "The rate the Central Government fixed under EPF Scheme 2026 para 29, as a fraction of PF wages."
    }
  ],
  tags: [
    { tag: "in_remuneration", label: "Remuneration (Code wages)" },
    {
      tag: "in_code_excluded",
      label: "Excluded from Code wages",
      help: "HRA, conveyance, overtime, bonus, commission and the other exclusions (a) to (i) of section 2(88)."
    }
  ],
  seed_components: [],
  tables: {},
  steps: [
    {
      check: "run.period_end >= \"2026-06-29\"",
      issue: "in_pf_pre_2026_schemes",
      severity: "blocker",
      message: "Wage periods ending before 29 June 2026 fall under the EPF Scheme 1952, EPS 1995 and EDLI 1976, which this pack version does not cover. Enter PF by hand."
    },
    {
      var: "wage_month",
      expr: "month_start(run.period_end)",
      explain: "Contributions are due on the wages of the wage period (the month), across every payslip of the period."
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
      var: "wages",
      expr: "rem - excl + max(0, excl - 0.5 * rem)",
      explain: "Wages under the Code: when exclusions exceed half of the remuneration, the excess counts as wages."
    },
    {
      check: "!(run.period_start < \"2026-09-17\" && run.period_end >= \"2026-09-17\")",
      issue: "in_pf_ceiling_split",
      severity: "blocker",
      message: "This period spans 17 September 2026, when the EPF wage ceiling rose from 15,000 to 25,000 (S.O. 5109(E)). Split the period or enter PF by hand."
    },
    {
      var: "ceiling",
      expr: "run.period_start >= \"2026-09-17\" ? 25000 : 15000",
      explain: "S.O. 2702(E): 15,000; S.O. 5109(E): 25,000 from 17 September 2026."
    },
    {
      var: "rate",
      expr: "entity.in_pf_rate_class == \"reduced\" ? 0.1 : 0.12",
      explain: "S.O. 3582(E) and EPF Scheme 2026 para 18(2)."
    },
    { var: "pf_on", expr: "profile.in_pf_member" },
    {
      var: "pf_base",
      expr: "profile.in_pf_full_wages || profile.in_international_worker ? wages : min(wages, ceiling)"
    },
    {
      var: "turns_58",
      expr: "age_on(run.period_start) < 58 && age_on(run.period_end) >= 58",
      explain: "The 58th birthday falls inside this period."
    },
    {
      check: "!(pf_on && profile.in_eps_member && turns_58) || coalesce(profile.in_eps_wages_58, -1) >= 0",
      issue: "in_eps_turns_58",
      severity: "blocker",
      message: "The employee reaches 58 in this period and leaves the pension scheme on that day. Enter the pension wages up to that day on the tax profile."
    },
    {
      var: "eps_on",
      expr: "pf_on && profile.in_eps_member && age_on(run.period_start) < 58",
      explain: "Pension membership ends on attaining 58 (Code section 2(82), EPS 2026 para 7)."
    },
    {
      var: "eps_wages",
      expr: "turns_58 ? coalesce(profile.in_eps_wages_58, 0) : wages"
    },
    {
      code: "IN_PF_EE",
      name: "Provident fund (employee)",
      kind: "deduction",
      stage: "statutory",
      when: "pf_on",
      amount: "round(rate * pf_base, 0) - (ytd_code_since(\"IN_PF_EE\", wage_month) - ytd_code_since(\"IN_PF_EE\", next_month))",
      base: "pf_base",
      rate: "rate",
      round: { mode: "half_up", step: 1 },
      tags: ["in_pf_employee"],
      payee: "EPFO",
      filing: "in_ecr"
    },
    {
      code: "IN_VPF",
      name: "Voluntary provident fund",
      kind: "deduction",
      stage: "statutory",
      when: "pf_on && profile.in_vpf_rate > 0",
      amount: "round(profile.in_vpf_rate * pf_base, 0) - (ytd_code_since(\"IN_VPF\", wage_month) - ytd_code_since(\"IN_VPF\", next_month))",
      round: { mode: "half_up", step: 1 },
      tags: ["in_pf_employee"],
      payee: "EPFO",
      filing: "in_ecr"
    },
    {
      code: "IN_EPS_ER",
      name: "Pension scheme (employer 8.33%)",
      kind: "employer",
      when: "eps_on",
      amount: "round(0.0833 * min(eps_wages, ceiling), 0) - (ytd_code_since(\"IN_EPS_ER\", wage_month) - ytd_code_since(\"IN_EPS_ER\", next_month))",
      base: "min(eps_wages, ceiling)",
      rate: "0.0833",
      round: { mode: "half_up", step: 1 },
      payee: "EPFO",
      filing: "in_ecr"
    },
    {
      code: "IN_EPF_ER",
      name: "Provident fund (employer)",
      kind: "employer",
      when: "pf_on",
      amount: "round(rate * pf_base, 0) - (eps_on ? round(0.0833 * min(eps_wages, ceiling), 0) : 0) - (ytd_code_since(\"IN_EPF_ER\", wage_month) - ytd_code_since(\"IN_EPF_ER\", next_month))",
      round: { mode: "half_up", step: 1 },
      payee: "EPFO",
      filing: "in_ecr",
      explain: "Employer contribution less the pension share."
    },
    {
      code: "IN_EDLI_ER",
      name: "EDLI (employer 0.5%)",
      kind: "employer",
      when: "pf_on",
      amount: "round(0.005 * min(wages, ceiling), 0) - (ytd_code_since(\"IN_EDLI_ER\", wage_month) - ytd_code_since(\"IN_EDLI_ER\", next_month))",
      base: "min(wages, ceiling)",
      rate: "0.005",
      round: { mode: "half_up", step: 1 },
      payee: "EPFO",
      filing: "in_ecr"
    },
    {
      check: "!pf_on || coalesce(entity.in_pf_admin_rate, -1) >= 0",
      issue: "in_pf_admin_rate_missing",
      severity: "warning",
      message: "Enter the PF administrative charges rate on the entity; the charge is left out until then."
    },
    {
      code: "IN_PF_ADMIN_ER",
      name: "PF administrative charges",
      kind: "employer",
      when: "pf_on && coalesce(entity.in_pf_admin_rate, 0) > 0",
      amount: "entity.in_pf_admin_rate * pf_base - (ytd_code_since(\"IN_PF_ADMIN_ER\", wage_month) - ytd_code_since(\"IN_PF_ADMIN_ER\", next_month))",
      base: "pf_base",
      rate: "entity.in_pf_admin_rate",
      payee: "EPFO",
      filing: "in_ecr",
      explain: "Per employee share at the entity's rate; the establishment minimum is not applied here."
    }
  ],
  vectors: [
    {
      name: "Wages 40,000 in October 2026: EPS at the 2,083 maximum",
      source: "official",
      reference: "PIB Release 2313829: with the 25,000 ceiling the maximum employer pension contribution at 8.33% is 2,083 (8.33% x 25,000 = 2,082.50, 50 paise up). PF 12% of 25,000 = 3,000 each; employer PF 3,000 - 2,083 = 917; EDLI 0.5% = 125. Admin line at an entity rate entered as 0.005 for this test: 125.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 40000, tags: ["in_remuneration"] }]
      },
      expect: { IN_PF_EE: 3000, IN_EPS_ER: 2083, IN_EPF_ER: 917, IN_EDLI_ER: 125, IN_PF_ADMIN_ER: 125 }
    },
    {
      name: "Wages 40,000 in August 2026: EPS at the 1,250 maximum",
      source: "official",
      reference: "PIB Release 2313829: before the change the maximum was 1,250 (8.33% x 15,000 = 1,249.50, 50 paise up). PF 1,800 each; employer PF 550; EDLI 75. No admin rate entered: warning, no admin line.",
      input: {
        run: { period_start: "2026-08-01", period_end: "2026-08-31", pay_date: "2026-08-31" },
        employee: { birth_date: "1990-01-01" },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 40000, tags: ["in_remuneration"] }]
      },
      expect: { IN_PF_EE: 1800, IN_EPS_ER: 1250, IN_EPF_ER: 550, IN_EDLI_ER: 75, IN_PF_ADMIN_ER: 0 },
      expect_issues: ["in_pf_admin_rate_missing"]
    },
    {
      name: "Basic 20,000 and HRA 10,000 in October 2026",
      source: "derived",
      reference: "Code wages: 30,000 - 10,000 = 20,000 (exclusions are a third, under half). PF base 20,000: employee 2,400; EPS 8.33% = 1,666; employer PF 2,400 - 1,666 = 734; EDLI 100.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [
          { code: "IN_BASIC", kind: "earning", amount: 20000, tags: ["in_remuneration"] },
          { code: "IN_HRA", kind: "earning", amount: 10000, tags: ["in_remuneration", "in_code_excluded"] }
        ]
      },
      expect: { IN_PF_EE: 2400, IN_EPS_ER: 1666, IN_EPF_ER: 734, IN_EDLI_ER: 100 }
    },
    {
      name: "50 percent rule: basic 10,000 and HRA 30,000",
      source: "derived",
      reference: "Remuneration 40,000; exclusions 30,000 exceed half (20,000) by 10,000, so wages = 10,000 + 10,000 = 20,000 (section 2(88) proviso). Employee PF 12% = 2,400.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [
          { code: "IN_BASIC", kind: "earning", amount: 10000, tags: ["in_remuneration"] },
          { code: "IN_HRA", kind: "earning", amount: 30000, tags: ["in_remuneration", "in_code_excluded"] }
        ]
      },
      expect: { IN_PF_EE: 2400 },
      expect_vars: { wages: 20000 }
    },
    {
      name: "Reduced 10 percent class, wages 15,000 in July 2026",
      source: "derived",
      reference: "S.O. 3582(E) para 2 classes pay 10%: employee 1,500; EPS 1,250; employer PF 1,500 - 1,250 = 250; EDLI 75.",
      input: {
        run: { period_start: "2026-07-01", period_end: "2026-07-31", pay_date: "2026-07-31" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_rate_class: "reduced", in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 15000, tags: ["in_remuneration"] }]
      },
      expect: { IN_PF_EE: 1500, IN_EPS_ER: 1250, IN_EPF_ER: 250, IN_EDLI_ER: 75 }
    },
    {
      name: "International worker, wages 100,000 in November 2026",
      source: "derived",
      reference: "No ceiling for PF (para 18(3) as corrected by G.S.R. 703(E)): 12,000 each; EPS on wages up to the ceiling 2,083; employer PF 12,000 - 2,083 = 9,917; EDLI 125.",
      input: {
        run: { period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        employee: { birth_date: "1985-05-05" },
        profile: { in_international_worker: true },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 100000, tags: ["in_remuneration"] }]
      },
      expect: { IN_PF_EE: 12000, IN_EPS_ER: 2083, IN_EPF_ER: 9917, IN_EDLI_ER: 125 }
    },
    {
      name: "Age 59: no pension share",
      source: "derived",
      reference: "Past 58 (section 2(82)): EPS 0, employer PF the full 3,000 on 25,000.",
      input: {
        run: { period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        employee: { birth_date: "1967-03-10" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 30000, tags: ["in_remuneration"] }]
      },
      expect: { IN_PF_EE: 3000, IN_EPS_ER: 0, IN_EPF_ER: 3000 }
    },
    {
      name: "58th birthday in the period without pension wages: blocked",
      source: "derived",
      reference: "Born 15 October 1968: 58 on 15 October 2026, inside the October period.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { birth_date: "1968-10-15" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 30000, tags: ["in_remuneration"] }]
      },
      expect: {},
      expect_issues: ["in_eps_turns_58"]
    },
    {
      name: "58th birthday in the period with pension wages entered",
      source: "derived",
      reference: "Pension wages to 14 October entered as 13,548: EPS 8.33% = 1,128.55, 1,129; PF 3,000; employer PF 3,000 - 1,129 = 1,871.",
      input: {
        run: { period_start: "2026-10-01", period_end: "2026-10-31", pay_date: "2026-10-31" },
        employee: { birth_date: "1968-10-15" },
        profile: { in_eps_wages_58: 13548 },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 30000, tags: ["in_remuneration"] }]
      },
      expect: { IN_PF_EE: 3000, IN_EPS_ER: 1129, IN_EPF_ER: 1871 }
    },
    {
      name: "QA B-9: bonus run after the regular run of the same period",
      source: "derived",
      reference: "Regular pay 3,00,000 in November 2026 paid PF 3,000, EPS 2,083, employer PF 917 and EDLI 125 on the 25,000 ceiling. A 50,000 bonus (excluded under section 2(88)) in the same wage period: the period's wages stay 3,00,000 - 50,000 + 0 over the ceiling, so the period's contributions are unchanged and the bonus payslip carries 0 for each.",
      input: {
        run: { kind: "bonus", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BONUS", kind: "earning", amount: 50000, tags: ["in_remuneration", "in_code_excluded"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 300000, in_pf_employee: 3000 }, by_code: { IN_PF_EE: 3000, IN_EPS_ER: 2083, IN_EPF_ER: 917, IN_EDLI_ER: 125, IN_PF_ADMIN_ER: 125 } }]
      },
      expect: { IN_PF_EE: 0, IN_EPS_ER: 0, IN_EPF_ER: 0, IN_EDLI_ER: 0, IN_PF_ADMIN_ER: 0 }
    },
    {
      name: "Second payslip of a period below the ceiling: only the difference",
      source: "derived",
      reference: "Regular pay 20,000 in November 2026 paid PF 2,400, EPS 1,666, employer PF 734, EDLI 100. Arrears of basic 10,000 in the same period: wages 30,000, PF base 25,000: PF 3,000 - 2,400 = 600; EPS 2,083 - 1,666 = 417; employer PF (3,000 - 2,083) - 734 = 183; EDLI 125 - 100 = 25.",
      input: {
        run: { kind: "off_cycle", period_start: "2026-11-01", period_end: "2026-11-30", pay_date: "2026-11-30" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_ARREARS", kind: "earning", amount: 10000, tags: ["in_remuneration"] }],
        history: [{ pay_date: "2026-11-30", period_end: "2026-11-30", kind: "regular", by_tag: { in_remuneration: 20000, in_pf_employee: 2400 }, by_code: { IN_PF_EE: 2400, IN_EPS_ER: 1666, IN_EPF_ER: 734, IN_EDLI_ER: 100, IN_PF_ADMIN_ER: 100 } }]
      },
      expect: { IN_PF_EE: 600, IN_EPS_ER: 417, IN_EPF_ER: 183, IN_EDLI_ER: 25, IN_PF_ADMIN_ER: 25 }
    },
    {
      name: "A period spanning 17 September 2026 is blocked",
      source: "derived",
      reference: "September 2026 monthly period: the ceiling changed on the 17th.",
      input: {
        run: { period_start: "2026-09-01", period_end: "2026-09-30", pay_date: "2026-09-30" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 30000, tags: ["in_remuneration"] }]
      },
      expect: {},
      expect_issues: ["in_pf_ceiling_split"]
    },
    {
      name: "A period ending before 29 June 2026 is blocked",
      source: "derived",
      reference: "May 2026 falls under the pre-Code schemes.",
      input: {
        run: { period_start: "2026-05-01", period_end: "2026-05-31", pay_date: "2026-05-31" },
        employee: { birth_date: "1990-01-01" },
        entity: { in_pf_admin_rate: 0.005 },
        lines: [{ code: "IN_BASIC", kind: "earning", amount: 30000, tags: ["in_remuneration"] }]
      },
      expect: {},
      expect_issues: ["in_pf_pre_2026_schemes"]
    }
  ],
  filings: [
    {
      code: "in_ecr",
      name: "PF contributions and ECR",
      frequency: "monthly",
      due_rule: "within 15 days of the close of the month (EPF Scheme 2026 para 20)",
      form: "Electronic Challan cum Return"
    }
  ],
  documents: []
};
