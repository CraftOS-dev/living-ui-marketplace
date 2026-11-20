# packs-west: rule packs and country data (US, GB, AU, CA, metadata countries)

Built 2026-11-04. 18 pack files (17 pack codes, AU has two versions) in `pb/pb_hooks/packs/` and 18 country files in `pb/pb_hooks/data/countries/`. All 464 vectors pass on the engine runner (`node SCR/engine/tools/packs/test.mjs --hooks APP/pb/pb_hooks`: 19/19 packs including the engine's `generic`, 474/474 vectors). Generators (not shipped) live in `SCR/packs-west/src/` (`gen_*.cjs`, `parse_au.py`) with the downloaded official texts.

## Packs

| Pack | Version | Ship | In force | Vectors (official) |
|---|---|---|---|---|
| us-federal | 2026.1 | active | 2026-01-01 to 2026-12-31 | 15 (2) |
| us-ca | 2026.1 | active | 2026 | 8 (4) |
| us-ny | 2026.1 | active | 2026 | 21 (16) |
| us-nj | 2026.1 | active | 2026 | 6 (3) |
| us-il | 2026.1 | active | 2026 | 2 (1) |
| us-pa | 2026.1 | active | 2026 | 1 (0) |
| us-ma | 2026.1 | active (requires us-federal) | 2026 | 4 (1) |
| us-ga | 2026.2 | active | 2026-05-11 to 2026-12-31 | 2 (2) |
| us-nc | 2026.1 | active | 2026 | 2 (1) |
| us-oh | 2026.2 | active | 2026-08-01 to 2026-12-31 | 3 (0) |
| us-va | 2026.1 | active | 2026 | 2 (1) |
| us-co | 2026.1 | active | 2026 | 2 (0) |
| us-az | 2026.1 | active | 2026 | 2 (0) |
| us-mi | 2026.1 | DRAFT | 2026 | 1 (0) |
| us-no-income-tax | 2026.1 | active | 2026 | 3 (0) |
| gb | 2026.1 | active | 2026-04-06 to 2027-04-05 | 19 (2) |
| au (au.js) | 2026.1 | active | 2026-07-01 to 2027-06-30 | 190 (186) |
| au (au-2025-26.js) | 2025.1 | active | 2025-07-01 to 2026-06-30 | 181 (180) |

Not shipped (next): `ca-federal` and `ca-on` (T4127 January 2026 page downloaded, formulas not built), the other 28 states and DC, US local taxes beyond NYC, Yonkers and PA EIT/LST.

### us-federal 2026.1 (active)
Covers Publication 15-T 2026 Worksheet 1A percentage method for automated payroll (2020+ W-4: filing status, Step 2 checkbox tables, Step 3, 4(a), 4(b), 4(c), exempt; 2019 and earlier W-4: allowances at $4,300, Married uses the MFJ table), nonresident alien additions (Tables 1 and 2), supplemental flat 22% and mandatory 37% over $1,000,000 YTD (bonus runs, or lines tagged `us_supplemental`), social security 6.2% to $184,500 (employee and employer), Medicare 1.45% each, Additional Medicare 0.9% over $200,000, FUTA 0.6% to $7,000 with credit reduction and exemption as entity fields, optional whole-dollar rounding. Tables use `from` rows (IRS "at least"). Not covered: wage bracket method, W-4P, territories, aggregate method for bonus runs, lock-in letters beyond entering their values. Sources: Pub 15-T (2026), Pub 15 (2026) (IRS PDFs). Official vectors: Pub 15 $1,000 FICA example, Pub 15 section 7 Example 3 (22% of $1,000).

### us-ca 2026.1 (active)
DE 44 (Rev. 52, 4-26) Method B per-period tables (weekly, biweekly, semimonthly, monthly), low income exemption, estimated deduction and exemption credit tables, 1% mental health surtax bracket, bonus runs at 10.23%, SDI 1.3% uncapped, UI (entity rate, default new employer 3.4%) and ETT 0.1% to $7,000. Wage rules from DE 231TP (HSA taxable in CA, 401(k) subject to SDI/UI). Official vectors: DE 44 Examples A to D. Not covered: Method A, annual method (Examples E and F differ by cents), 6.6% non-bonus supplemental, other periods.

### us-ny 2026.1 (active)
NYS-50-T-NYS, -NYC, -Y (1/26): NYS Method II exact calculation plus Method III top rates, NYC resident (profile switch), Yonkers resident 16.75% and nonresident Method VIII, bonus supplemental rates (11.70%, 4.25%, 1.95975%, 0.50%), DBL 0.5% to $0.60 a week (WCL 209), PFL 0.432% to $411.91 (paidfamilyleave.ny.gov), employer UI with rate and wage base as entity fields. Two NYS examples carry one-cent slips in the publication; vectors use exact arithmetic (noted). Not covered: Method I, daily pay, 414(h) add-backs, MCTMT, RSF.

### us-nj 2026.1 (active)
NJ percentage method Rates A to E (tables for wages paid on and after October 1, 2020; NJ-WT September 2025), allowance values, rate selection by NJ-W4, bonus runs without allowances. 401(k) excluded; section 125 only with the entity switch; HSA taxable. Employee UI/WF, TDI and FLI rates and wage bases are entity fields without defaults (NJ DOL 2026 pages not reachable), so those lines stay zero until entered (warning issue). Official vectors: NJ-WT examples A1, A2, B1 (the other three were printed with the pre-2020 table and differ by 1 to 2 cents).

### us-il, us-pa, us-nc, us-co, us-az, us-va, us-ga, us-oh, us-ma (active)
- IL: IL-700-T (R-12/25) automated formula 4.95% after $2,925 and $1,000 allowances (official Alice example).
- PA: 3.07% (pa.gov); 401(k) taxable, section 125 excluded (PA PIT guide); HSA switch; local EIT rate and LST annual amount per employee; employee UC rate as an entity field.
- NC: NC-30 (2026) annualized method, 4.09%, $12,750 / $19,125, $2,500 allowance, whole dollars (official example).
- CO: DR 1098 (10/21/25), 4.40%, $11,000 / $5,500 or DR 0004 Line 2.
- AZ: Form A-4 (2026) elected 0.5% to 3.5%, default 2.0% (form text read from a university copy; azdor.gov blocked).
- VA: Virginia guide (Rev. 10/26) formula with $8,750, $930, $800, annual tax in whole dollars as in the official example.
- GA: guide revised September 2026, 4.99% from May 11, 2026 (HB 463), Table E per-period deductions (both official examples). Pay dates before May 11, 2026 not covered.
- OH: Optional Computer Formula effective August 1, 2026. Earlier 2026 pay dates not covered; no school district or municipal tax.
- MA: Circular M (Rev. 12/25) percentage method with the $2,000 FICA deduction (reads us-federal lines), exemption factors, 9% surtax above $1,107,750, section G supplemental (official example, needs `context.ma_annual_regular_wages` in bonus runs), PFML 2026 split (0.18% + 0.28% employee, 0.42% employer for 25+), capped at $184,500. Assumption flagged: MA wage definition follows federal for 401(k)/125/HSA.
Employer UI for all of these is an entity rate plus an entity 2026 wage base (no defaults: the DOL summary at oui.doleta.gov returned 502).

### us-mi 2026.1 (DRAFT)
4.25% after $5,900 per exemption, taken from a USDA National Finance Center bulletin (secondary). michigan.gov (Form 446) blocked automated fetches. A person must check Form 446 and activate.

### us-no-income-tax 2026.1 (active)
AK, FL, NV, NH, SD, TN, TX, WA, WY (employment.work_region): employer SUI (entity rate and base), optional employee SUI rate (Alaska), WA PFML 1.13% split 71.43% / 28.57% (50+ employees) to the social security maximum (ESD release, RCW 50A.10.030), WA Cares 0.58% uncapped with exemption switch.

### gb 2026.1 (active)
HMRC PAYE tax table routines v24.0 (Feb 2026) implemented step for step: tax code parsing (suffix L/M/N/T, 0T, K, BR, D0/D1, NT, S prefix with six Scottish bands and SD0 to SD3, C prefix), cumulative by tax week or month of the pay date, week 1/month 1 by field or W1/M1/X marker, week 53, the 50% regulatory limit with carry, refunds; Class 1 NI exact percentage method for categories A, B, C, D, E, F, H, I, J, K, L, M, N, S, V, Z with 2026-27 thresholds (half pennies rounded down, CWG2); student loan Plans 1, 2, 4, 5 and postgraduate loan (whole pounds; official GOV.UK examples £16 and £50); auto-enrolment pension on qualifying earnings (net pay or relief at source). Weekly, two-weekly, monthly only. Assumption: qualifying earnings upper limit per period uses the Class 1 UEL per period. P45 figures enter as a history payslip (`gb_paye_taxable`, `GB_PAYE`). Not covered: 4-weekly, directors' annual method, Employment Allowance, Apprenticeship Levy, salary sacrifice.

### au 2026.1 and 2025.1 (active)
Read from the Federal Register of Legislation (ato.gov.au blocked): Withholding Schedules Instrument 2026 (Schedule 1 and 8 updated 1 July 2026) and 2025 (Schedule 1 of 1 July 2024, Schedule 8 of 24 September 2025). Scales 1 to 6 coefficients, x = whole dollars + 99 cents, fortnightly and monthly conversions (33 cents rule), dollar rounding, tax offsets, Medicare levy adjustment, STSL marginal component, SG 12%: 2026-27 per QE day with the annual maximum contributions base from the entered concessional cap (SGAA s 10A(5), compilation of 1 July 2026); 2025-26 quarterly base entered by a person. Vectors: every fourth official sample row for each scale and frequency, the general examples and the three STSL examples. Not covered: quarterly and twice-monthly pay, Schedules 2 to 15, 53-pay extras, payroll tax.

## Country data (`data/countries/`)
- us, gb, au, ca: full metadata (regions, time zones, ID types with patterns and masks, default packs and region packs, bank formats, schedule, employment types, leave types, minimum wage where verified, filings calendar entries, holidays 2026 and 2027).
  - US: 5 U.S.C. 6103 federal holidays with observed days (incl. New Year 2028 observed 2027-12-31), FMLA 12 workweeks (DOL), $7.25.
  - GB: GOV.UK bank holiday feed by nation (ENG, WLS, SCT incl. the 2026 World Cup bank holiday, NIR), 28 days / 5.6 weeks, NLW £12.71.
  - AU: Fair Work Act s 115 national days only (no King's Birthday or State days: fairwork.gov.au timed out), annual leave 4 weeks (s 87), personal/carer's 10 days (s 96).
  - CA: CRA 2026 list, 2027 by the same rules, Family Day (ON), Saint-Jean-Baptiste (QC); non-ESA days marked optional; ON vacation 2 or 3 weeks. No pack yet (`packs: []`). CPA 005 noted, generic CSV used.
- ae, sa, de, fr, nl, ie, es, it, nz, br, mx, za, ng, ke: metadata only (currency, time zone, date format, week start, weekend, ID types, bank formats, the `generic` pack), no leave minimums or holidays.

## Contracts and notes for other builders
- Tags payroll must put on components: US `us_fit_wages`, `us_fica_wages`, `us_futa_wages`, `us_supplemental`, `us_pretax_401k`, `us_pretax_125`, `us_pretax_hsa`; GB `gb_paye_pay`, `gb_ni_pay`, `gb_pensionable`, `gb_pbik`, `gb_pretax_paye`; AU `au_paygw_pay`, `au_super_qe`. Each pack lists them in `seed_components`.
- History: payroll must pass earlier payslips with `by_tag` and `by_code` (pack tracker lines `US_SUPP_WAGES`, `GB_PAYE_PAY` are info lines with tags).
- Context read: `context.ma_annual_regular_wages` (MA bonus runs).
- Entity fields: state UI rates and wage bases, FUTA credit reduction, CA UI/ETT, NJ contributions, MA PFML split, GB pension rates, AU concessional cap / quarterly base.
- Runner note for the engine builder: `tools/packs/test.mjs` rejects a file exporting a list of versions (PACK_FEEDBACK says it is allowed), so AU ships as two files (`au.js`, `au-2025-26.js`), which the kernel seeder accepts.
- Blocked or unreachable official sources: ssa.gov (403), opm.gov (403), michigan.gov (403), azdor.gov (403), ato.gov.au (403), fairwork.gov.au (timeout), oui.doleta.gov (502), wcb.ny.gov (TLS chain not trusted here; not bypassed), NJ DOL rate pages (404), canada.ca federal vacation page (404). WebSearch: 16 of 16 calls used.


## Verification round (packs-verify, 2026-11-04)

us-mi 2026.1: still DRAFT, file unchanged. michigan.gov answered 403 to every path (the withholding page and the 2026 Form 446 PDF) through both the fetch tool and the Windows system curl, with default user agents; legislature.mi.gov refused connections, so neither Form 446 (2026) nor MCL 206.30 and 206.51 could be read. The 4.25 percent rate and the 5,900 dollar exemption (and whether it applies from January 1) still come only from the USDA National Finance Center bulletin. No web search was spent on Michigan (no reachable official host). APP runner after this round: 38/38 packs, 592/592 vectors.

## Fix round 1 (2026-11-04, QA B-4, B-7, B-8)

Runner over APP after the fixes: 38/38 packs, 608/608 vectors (packs-west: 18 files, 485 vectors, 24 new).

- B-4 (gb): NI, student and postgraduate loans, the pension qualifying earnings band and week 1 / month 1 PAYE now work on the whole earnings period (tax month for monthly pay, tax week for weekly, pair of tax weeks for two-weekly). The pack adds the NI pay, pensionable pay and PAYE pay of other payslips in that period from `history` (`ytd_since` over the period window, so payslips dated after this one in the same period count too) and subtracts what they already deducted (CWG2; the GOV.UK student loan change of pay interval example). New vectors: the QA case (bonus 1,000 after 3,000: NI 80.00 and 150.00, pension 50.00 and 30.00), regular pay after an earlier bonus in the month (with Plan 2), a month 1 code with two payments, and payments in different tax months staying apart. Assumption: the two-weekly earnings period is the pair of tax weeks (1 and 2, 3 and 4, ...).
- B-7 (au, both versions): Schedule 5 is read from the same Federal Register instruments and implemented as Method A for bonus and correction runs and for lines tagged `au_additional` in regular runs. Normal earnings come from the most recent regular payslip in a bonus run (warning `au_additional_no_normal_earnings` when there is none). The payment is divided by 52, 26 or 12, the Schedule 1 difference is multiplied back, capped at 47%, cents ignored; STSL uses the same method inside the same cap; no TFN takes 47% (45% foreign). Entity field `au_bonus_method = single_period` adds the payment to the period instead (Schedule 5's rule for a bonus for one pay period). QA case: Method A gives 312; the single period method gives the QA figure 321 (both vectors). Off-cycle runs are normal pay. Termination runs carrying `au_unused_leave` or `au_etp` lines stop with blocker `au_termination_payment` (Schedules 7 and 11 not built). Method B is not built (Schedule 5 accepts Method A for all additional payments).
- B-8 (country data): AU now has State rows with every additional or substitute day for NSW, QLD and WA (State government lists) and TAS (Statutory Holidays Act 2000 s 4), including Monday 28 December 2026 and 27 and 28 December 2027. VIC, SA, ACT and NT lists answered 403, so they have no State rows yet (noted in au.js). CA lists the next working day as kind observed when New Year's Day, Canada Day, Christmas or Boxing Day falls on a weekend (28 December 2026; 27 and 28 December 2027). US federal observed days (3 July 2026; 18 June, 5 July, 24 December and 31 December 2027) and the GB substitute days from the GOV.UK feed were already present and were checked.
- Same-pattern review of the US packs:
  - federal: correction runs (back pay) are now supplemental wages at the flat 22% (Publication 15 section 7).
  - NY: DBL's weekly cap is shared with the regular payslip of the same pay period on bonus and other extra runs.
  - OH: extra runs use the aggregate method with the most recent regular payslip instead of annualising the bonus.
  - MI (draft): extra runs at 4.25% of the payment.
  - Every SUI, SDI, PFL, PFML, FICA, FUTA and $1,000,000 test already reads locked history through `ytd`, so they are correct once payroll passes every locked run of the tax year. New vectors cover a bonus dated before a later locked run (US federal and CA).
- Needs from payroll-core: `history` with every locked payslip of the tax year and of the same earnings period, including ones dated after the run being calculated (the GB windows and the AU and OH "most recent regular payslip" read it).

## Fix round 2 (2026-11-05, QA2 N-1, N-3, N-9)

Runner over APP after the fixes: 38/38 packs, 655/655 vectors (packs-west: 18 files, 494 vectors, 15 new).

- N-1, leave paid out on leaving (`LEAVE_EXIT`, tags `exit_leave_payout` and `termination` from payroll):
  - **AU:** Schedule 7 is read from the Federal Register instruments (2026 and 2025, same rules) and implemented on its own line `AU_PAYGW_LEAVE`.
    - Post-17 August 1993 leave from a normal termination uses the marginal rate method. The payment is divided by 52, 26 or 12 and added to the last full period's normal earnings, and the Schedule 1 difference is multiplied back.
    - 32% applies to leave accrued before 18 August 1993 (tag `au_unused_leave_pre93`) and to any leave on genuine redundancy, invalidity or early retirement (profile `au_termination_reason`). 5% of pre-16 August 1978 long service leave (`au_lsl_pre78`) is taxed at marginal rates.
    - Payments under $300 take the lesser of the table amount and 32%. No TFN means 47% (45% for a foreign resident). No STSL is withheld.
    - The AU seed `LEAVE_EXIT` carries only `au_unused_leave`, so it is neither withholding earnings for Schedule 1 nor qualifying earnings for super.
    - A `LEAVE_EXIT` line without an AU unused leave tag blocks (`au_exit_leave_untagged`). Employment termination payments still block (`au_termination_payment`, Schedule 11 not built).
    - Vectors: the official Schedule 7 example (Norman: 188 on normal pay and 6,786 on leave), the QA final pay (leave 312, super on salary only), redundancy at 32%, and both blockers.
  - **US federal:** seed `LEAVE_EXIT` with `us_fit_wages`, `us_fica_wages`, `us_futa_wages` and `us_supplemental`. A lump sum for unused vacation is a supplemental wage (Pub 15 section 7), so it is taxed at the flat 22% (or aggregated) and is subject to FICA and FUTA. The states read the same wage tags: CA and NY combine it with the final wages as their rules require. `us_exit_leave_untagged` blocks a `LEAVE_EXIT` line without `us_supplemental`.
  - **GB:** seed `LEAVE_EXIT` with the pay tags. Holiday pay on leaving is a standard payment for PAYE and NI (CWG2 1.14). `gb_exit_leave_untagged` blocks a line without the NI tag. Assumption: it counts as qualifying earnings for the pension.
- N-3 (AU): a bonus, correction or off-cycle payment dated before a later locked payslip now blocks with `au_paid_before_locked_run`. With no regular payslip locked before it, it blocks with `au_additional_no_normal_earnings`. Both used to be warnings that left PAYGW at 0.
- N-9, off-cycle runs are supplemental payments:
  - **US federal:** 22% flat; when the entity chooses `us_supp_method = aggregate`, the Worksheet runs on the most recent regular payslip's wages plus the payment, less the Worksheet on the regular wages alone. Vectors: 5,000 gives 1,100.00, 200 gives 44.00, aggregate gives 1,045.83.
  - **States with supplemental rules** treat bonus, correction and off-cycle runs alike:
    - CA: 10.23% for bonuses, 6.6% for other supplemental (QA: 330.00).
    - NY: state, NYC and Yonkers supplemental rates.
    - IL, NC, CO, GA, VA: flat supplemental rate or no allowances.
    - NJ: the rate table on the payment without allowances.
    - MA: section G.
    - OH: aggregate (termination runs no longer use it).
    - MI (draft): 4.25%.
  - **AU:** off-cycle runs are Schedule 5 additional payments (QA: 1,620 on 5,000 after a 4,914 month). The AU allowance seed now carries `au_super_qe` (allowances for ordinary hours are ordinary time earnings; drop the tag for expense allowances expected to be fully spent).
- Payroll note: entities seeded before these `LEAVE_EXIT` seeds need their `LEAVE_EXIT` component reseeded with the pack tags. A line that lacks them now blocks instead of going untaxed.


## Gaps round (packs-gaps, 2026-11-10)

Runner over STAGE after the copy: 42/42 packs, 723/723 vectors. Generators, sources and the Canada cross-check are in `SCR/packs-gaps` (`gen/gen_us_mi.mjs`, `gen/gen_ca.mjs`, `gen/gen_au_holidays.mjs`, `src/`, `tests/crosscheck_ca.mjs`). Web searches for the whole round (this file and packs-asia): 5 of 40.

| Pack or file | Version | Result |
|---|---|---|
| us-mi | 2026.2 | PROMOTED to active |
| ca-federal | 2026.1 | NEW, active |
| ca-on, ca-ab, ca-bc | 2026.1 | NEW, active (require ca-federal) |
| ca-qc | | not built (next) |
| data/countries/ca.js | | `packs: ['ca-federal']`, `region_packs` ON, AB, BC; notes |
| data/countries/au.js | | VIC, SA, ACT and NT rows for 2026 and 2027 |

### us-mi 2026.2: promoted
Read Michigan Treasury Form 446 (Rev. 02-26), the 2026 Michigan Income Tax Withholding Guide, from the web.archive.org copy of 18 October 2026 (linked from the archived 2026 Withholding Tax Forms page; michigan.gov answers 403): rate 4.25 percent, personal exemption $5,900, "4.25 percent of compensation after deducting the personal and dependency exemption allowance", bonuses paid separately at 4.25 percent with no exemption adjustment, zero exemptions without a valid MI-W4. The pack's formula already matched; $5,900 applies to every 2026 pay date (the guide states it for the year; the NFC bulletin's pay-period-12 date was the NFC's own change). Vectors: 7 derived (the guide has no worked example). Not covered: city income taxes, MI W-4P pensions.

### ca-federal 2026.1: new, active
CRA T4127 122nd edition (January 2026) with the 123rd (July 2026), which changes only BC, NL and PE ("no change for Alberta, ... Ontario"), read from canada.ca with the Chapter 8 CSV files. Option 1: federal brackets 14, 20.5, 26, 29 and 33 percent with K; TD1 claim or the BPAF formula; K2 from the CPP base share and EI (the annual maximum once reached, as the guide recommends); K3; the Canada employment amount; prescribed zone (HD) and CRA-authorized deductions (F1); additional tax (L); claim code E. CPP 5.95 percent above $3,500/P (third decimal dropped) to $4,230.45, prorated by PM from the month after the 18th birthday to the month of the 70th; CPP2 4 percent between $74,600 and $85,000 to $416 with W; F5, F5A and F5B; EI 1.63 percent to $1,123.07, employer 1.4 times (entity multiplier `ca_ei_er_factor` for the premium reduction program). Non-periodic payments (tag `ca_nonperiodic`: bonus, retroactive pay, vacation pay not taken) use the regular bonus method with earlier non-periodic payments (B1, F5BYTD via the info line `CA_F5B`), 15 percent when A with the payment is $5,000 or less, and on a payslip with only non-periodic pay the most recent regular pay.
Vectors (12): official T4127 Appendix 1 CPP2 scenarios 1 (periods 18, 19, 21) and 3 (periods 14 and 22, PM 9) and the Chapter 4 bonus example (C 204.25, F5 34.33, F5A 9.81, F5B 24.52, A 55,450.76 and 52,975.28, TB 323.54); derived cases checked independently in Python.
Cross-check: every monthly row of the 2026 T4032 tables (federal and provincial, Ontario and Alberta January, BC July) for claim codes 0 to 10 up to the YMPE agrees with the packs within 0.12 (8,353 entries; the tables round to 5 cents and use mid-point credits). Above the YMPE the tables annualise CPP2 and cap the first additional contribution in F5, while Option 1 uses the pay period's actual C and C2, so they differ by design.
Judgments: the bonus method's CPP and EI credits are built as in the T4127 example (annualised regular contributions plus the actual contributions on this and earlier non-periodic payments); a mid-year CPT30 election does not reprorate PM; payroll must put the province of employment in `employment.work_region` (else the entity's region is used).
Not covered (blocked, never guessed): Quebec (QPP, QPIP, Revenu Quebec withholding: `ca_quebec_unsupported`), provinces other than ON, AB, BC (`ca_province_unsupported`), commission employees on TD1X, Option 2, labour-sponsored funds credits, alimony garnishment (F2), Quebec transfers. A bonus or correction run with periodic lines (`ca_periodic_on_bonus_run`) and a LEAVE_EXIT line without the Canada tags (`ca_exit_leave_untagged`) are blocked; a missing birth date blocks (`ca_birth_date_missing`).

### ca-on, ca-ab, ca-bc 2026.1: new, active
Same income and credit bases as ca-federal (CPP, CPP2 and EI read from its lines), the same bonus method, a line only for employees whose province of employment is the pack's.
- ON: 5.05 to 13.16 percent with KP; TD1ON claim or $12,989; surtax V1 (20 percent over $5,818, 36 percent over $7,446); Ontario Health Premium V2 (also under claim code E); tax reduction S ($300 plus $554 per dependant under 19 or disabled, profile `ca_on_dependants`).
- AB: 8 to 15 percent; TD1AB claim or $22,769; supplemental credit K5P (25 percent of K1P + K2P above $4,896).
- BC: pay dates to 30 June 2026 at the January rates (5.06 percent, reduction $575 to $41,722); from 1 July 2026 the prorated July rates (6.14 percent, July KP, reduction $805 cut off at $44,952); TD1BC claim or $13,216. Conflict noted in the pack: the BC July T4032 tables keep phasing the reduction out to $48,182, while T4127 cuts it at $44,952 ("the legislated maximum"); the pack follows T4127 (up to about $9.50 a month more tax than the tables in that band; 88 table entries set apart in the cross-check).
Vectors: derived, each with the matching T4032 row quoted (ON 248.48 against the table's 248.50 at the same mid-point).

### ca-qc: next
Quebec needs Revenu Quebec's own withholding formulas (TP-1015.F), QPP 6.30 percent and QPIP; none of them was read this round, so Quebec employees are blocked by ca-federal.

### data/countries/au.js: VIC, SA, ACT and NT holidays
From the Business Victoria 2026 and 2027 pages (archive copies of 13 October and 26 April 2026), SafeWork SA (Public Holidays Act 2023, read directly), the ACT Government page (archive copy of 11 December 2025) and NT.GOV.AU (archive copy of 8 October 2026): 76 rows. Notable: VIC has no Anzac Day substitute and its 2027 Friday before the AFL Grand Final is not listed ("subject to AFL schedule"); Melbourne Cup applies unless a non-metropolitan council arranged another day; SA and NT Christmas Eve and New Year's Eve from 7pm are `half: true`; SA's 26 December is Proclamation Day (the national Boxing Day row covers the date) with the additional days on 28 December 2026 and 27 and 28 December 2027; the ACT moves Anzac Day to Monday 27 April 2026 and 26 April 2027 (the ACT list shows only the Monday, but the national 25 April row still applies to every region in this data model); NT regional show days are kind `optional`.

### For other builders
- Canada tags payroll must put on components (seeded by ca-federal): `ca_taxable` (periodic pay), `ca_nonperiodic` (bonus, retro pay, vacation pay not taken, LEAVE_EXIT), `ca_pensionable`, `ca_insurable`, `ca_rpp` (RPP, RRSP, PRPP deducted at source), `ca_union_dues`. Info line `CA_F5B` (tag `ca_f5b`) is read by later payslips through `history`.
- Fields: ca-federal `ca_td1_claim` (no default: the BPAF formula), `ca_tax_exempt`, `ca_extra_tax`, `ca_hd`, `ca_f1`, `ca_k3`, `ca_cpp_exempt`, `ca_ei_exempt`, entity `ca_ei_er_factor`; provinces `ca_on_td1_claim`, `ca_on_dependants`, `ca_ab_td1_claim`, `ca_bc_td1_claim`.
- Filing codes `ca_pd7a` and `ca_t4` have no structured due rule in `lib_payroll_out_calendar.js` yet, so their ledger rows carry the pack's words and no due day until the payroll-out builder adds rules.
- Unreachable this round: michigan.gov, business.vic.gov.au, cmtedd.act.gov.au, nt.gov.au (403; archive copies used); safework.sa.gov.au and canada.ca were readable.
