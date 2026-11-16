# Venture OS engines

Every number Venture OS shows comes from one of these engines or from a verified stored value. No model computes a figure. Each engine is a pure CommonJS file in `pb/pb_hooks/lib_eng_*.js` that loads unchanged in PocketBase's Goja and in Node, and each is pinned by golden vectors taken from the sources in REPORT Table 33.

Signatures and return shapes for callers: `reference/notes/engines.md`.

## Conventions (all engines)

| Item | Rule |
|---|---|
| Money | Integer minor units (`_minor`). Input: a whole Number or a string of digits (for values past 2^53). Output: Numbers, always safe integers. |
| Ownership, rates, probabilities | Millionths (`_ppm`): 7.5% is 75000. |
| Prices per share, FX rates, multiples | Scaled by 10^8 (`_e8`) of the major unit: $2.00 a share is 200000000, 3.9x is 390000000, EUR to USD 1.10 is 110000000 (to-units per one from-unit). |
| Days | `YYYY-MM-DD` (`_day`); instants are ISO or PocketBase date text (`2026-11-12 09:00:00.000Z`) or UTC milliseconds. |
| Arithmetic | BigInt for every product (built with `BigInt(x)`), exact fractions where a formula divides by a quantity that is itself solved for, one rounding at the end, half away from zero. The only floating-point steps are the strength decay, compound preferred return, CMGR and XIRR, each documented below. |
| Unknowns | `null` plus a `reason` code, never 0. |
| Bad input | Throws `Error` with `status` 400, a snake_case `code` and `extra` (the kernel's `fail` shape), so an op can answer it unchanged. |
| Purity | No PocketBase globals, no clock, no randomness, no I/O, no URL literals (the gate counts them as egress). `now` is always a parameter. Engines load `lib_eng_core.js` through `require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js')`, cached in a module variable. |
| Goja | No optional chaining, no nullish coalescing, no lookaround regex, no BigInt literal suffix, no `Intl`. Verified by loading every engine in PocketBase 0.39.6 (see Verification). |

## Relationship strength (`lib_eng_strength.js`)

Rule (CRM `lib_interactions.js` lines 8 to 37, ported):

- Weights: meeting 3, call 2, email received 1.5, email sent 1, message 1.
- Each touch decays by half every 60 days: `w x 0.5^(age_days / 60)`; touches older than 365 days drop out.
- Raw sum `s`; shown score `round(100 x (1 - e^(-s/3)))`, 0 to 100.
- Bands: strong 60 and up, good 30 to 59, weak 1 to 29, none 0.
- A touch dated after `now` does not count yet (the CRM clamped it to age 0; calendar capture makes future events common, so they wait until they happen).
- An email must say `in` or `out`; an unknown kind is refused (`invalid_touch`).
- A person's strength and a company's strength are the strongest member-to-person edge (company: over its people). Ties: most recent contact, then member id, then person id.

| Vector | Expected | Source |
|---|---|---|
| One meeting today | 63 | formula |
| One meeting 60 days ago | 39 | formula |
| Meeting today, call 30 days, email in 60 days, email out 120 days, a message 400 days ago and a meeting in 5 days | s = 5.414213562, score 84, 4 counted | `expected.py` |
| 300 random touch sets | equal to the CRM's own `strengthOf` | CRM lib_interactions.js |

## Intro paths (`lib_eng_paths.js`)

Rule (design inference from Affinity's ranked paths):

- Direct paths (member to target person) rank before every one-hop path (member to connector to target).
- Inside each group: the weakest edge, higher first; then the most recent contact, where a path's contact day is the oldest last contact along it (a path is as fresh as its stalest edge); then ids, for a stable order.
- Edges with score 0 are not relationships. Person-to-person links count in either direction; the strongest link between two people wins. Links between two targets are ignored.

Vector (three members m1 to m3, ten contacts p1 to p10, target company people p9 and p10; full fixture in `paths.test.mjs`):

| Rank | Path | Weakest |
|---|---|---|
| 1 | m2 to p10 (direct, contact 2026-11-01) | 45 |
| 2 | m1 to p9 (direct, contact 2026-10-01) | 45 |
| 3 | m3 to p9 (direct) | 20 |
| 4 | m2 to p2 to p10 (stalest contact 2026-10-15) | 70 |
| 5 | m1 to p1 to p9 (stalest contact 2026-09-01) | 70 |
| 6 | m3 to p7 to p10 | 55 |
| 7 | m3 to p3 to p9 | 30 |

Excluded on purpose: m1 to p4 to p5 (p5 is not a target), m2 to p6 (score 0), m1 to p8 (no link to a target).

## Thesis fit (`lib_eng_fit.js`)

Rule (tri-state as the YC app's `lib_checks.js`, where unknown never reads as no):

- Each criterion is `met`, `unmet` or `unknown`. A fact that is missing, `null` or graded `unknown` makes its criterion `unknown`, required or not. A fact recorded as empty (`''` or `[]`) is known to be empty.
- No total score. The summary counts statuses and gives the required criteria's state: `unmet` when any required criterion is unmet, else `unknown` when any required one is unknown, else `met`.
- Vocabulary: the 25 fact keys of SPEC 7.2, each typed (`FACT_TYPES`): text, money, int, num, bool. Operators by type: text `eq, in, exists`; money `eq, gte, lte, between, exists`; int `eq, in, gte, lte, between, exists`; num `eq, gte, lte, between, exists`; bool `bool, exists`.
- Text compares without case; a list-valued text fact meets `in` or `eq` when any element matches.
- Money criteria carry a currency. A fact in another currency converts through the caller's `fx(from, to, day) -> rate_e8`; without a rate the criterion is `unknown` (`no_rate`); without the deal's currency fact it is `unknown` (`currency_unknown`).
- A fact value of the wrong type is `unknown` (`bad_value`), never a crash; a malformed criterion is refused (`invalid_criterion`).

| Vector | Expected |
|---|---|
| stage in (pre_seed, seed) required, fact "Seed" | met |
| raise between 1.00M and 5.00M USD required, fact 3.00M USD | met |
| hq_country in (US, CA), no fact | unknown (missing) |
| technical_founder true required, fact graded unknown | unknown, and the required state is `unknown`, not `unmet` |
| arr gte 500,000.00 USD, fact 300,000.00 | unmet |
| lead_investor exists, fact `''` | unmet (empty) |
| Same deal with a raise of 8.00M | required state `unmet` |
| Raise 3.00M EUR, criterion in USD, rate 1.10 | met at 3.30M USD; without a rate unknown (`no_rate`) |

## Days, SLA and stalls (`lib_eng_days.js`)

Rule (REPORT Table 33; NextView on stage timing):

- Local day of an instant in an IANA zone. Goja has no `Intl`, so the engine carries a zone table: HR OS's table, with two fixes and 15 more zones (101 in all). Fixes: `Pacific/Chatham` switches at the same UTC instant as New Zealand (HR OS's rule was 30 minutes early); `Africa/Cairo` observes daylight time again since 2023 (last Friday of April to the end of the last Thursday of October; HR OS had none). Added: Jerusalem (its own rule), Istanbul, Luxembourg, Budapest, Bucharest, Tallinn, Riga, Vilnius, Qatar, Bahrain, Kuwait, Tbilisi, Buenos Aires, Accra, Kigali.
- Business days skip the weekend days (configurable list of weekdays, 0 Sunday to 6 Saturday; default Saturday and Sunday) and listed holidays.
- `addBusinessDays(day, n)`: the n-th business day after `day` (n = 0 is `day`; negative counts back).
- `businessDaysBetween(a, b)`: business days d with a < d <= b.
- Reply SLA: due day = `addBusinessDays(local day of receipt, sla_days)`. State: `open`, `due_today`, `overdue`, with business days left (negative when overdue).
- Stall: calendar days from the local day of entering the stage to the local day of now; stalled when they exceed `stall_days`; `stall_days` 0 never stalls. `stalls_on` is the first stalled day.

| Vector | Expected | Check |
|---|---|---|
| Every DST transition 2025 to 2027 of all 101 zones, one minute before and after, plus three samples per zone (891 checks) | offset and local day equal to the IANA database | Python `zoneinfo` |
| Received 2026-11-12T23:30Z, 5 business days, Asia/Tokyo | received 2026-11-13 (Friday), due 2026-11-20 | numpy `busday_offset` |
| Same instant, America/New_York | received 2026-11-12 (Thursday), due 2026-11-19 | numpy |
| Received Saturday 2026-11-14, 5 days | 2026-11-20 | numpy |
| Friday-Saturday weekend, 2026-11-12 plus 5 | 2026-11-19 | numpy weekmask |
| 2026-12-22 plus 5 with holidays 2026-12-25 and 2027-01-01 | 2026-12-30 | numpy |
| 2026-12-18 plus 10, same holidays | 2027-01-05 | numpy |
| Business days 2026-11-13 to 11-16; 11-01 to 11-30; 2026-12-20 to 2027-01-05 with holidays | 1; 21; 10 | numpy `busday_count` |
| Entered 2026-11-01T14:30Z, now 2026-11-08T15:30Z, stall_days 7 | UTC: 7 days, not stalled; Tokyo: 8 days, stalled, stalls on 2026-11-09 | zoneinfo |

## Post-money SAFEs and notes (`lib_eng_safe.js`)

Rule (Y Combinator post-money SAFE documents and user guide):

- At signing, a capped SAFE owns `investment / post-money cap` of the Company Capitalization. Discount-only and MFN SAFEs have no ownership until they convert (`set_at_conversion`).
- At a priced round with price P per share of the new preferred:
  - Company Capitalization C = pre_shares (common, options, promised options, unissued pool before the round; not the new money, not the pool increase) plus every converting security's shares.
  - Safe price = cap / C. Discount price = P x (1 - discount). Conversion price = the lowest of safe price, discount price and P. Shares = floor(amount / conversion price).
  - C contains the capped SAFEs' own shares, so it is solved exactly: C = (pre_shares + note shares + fixed-price SAFE shares) / (1 - sum of amount / cap over the SAFEs converting at their cap). The engine starts at the smallest C and grows the set of cap-binding SAFEs until it settles (it only grows, so it ends).
  - MFN: takes the complete terms (cap and discount together) of the later SAFE that gives it the lowest conversion price at this round; with no better later SAFE it converts at P. An MFN SAFE has no terms of its own.
  - Fractional shares round down.
- Notes: simple interest, actual days over 365, from the issue day to the conversion day: `principal x rate x days / 365`, rounded half away. Principal plus interest converts at the lowest of `cap / pre_shares` (a pre-money cap), `P x (1 - discount)` and P. Note shares count in C for the SAFEs.
- Prices are exact fractions of minor units per share and are reported in `_e8` of the major unit.
- Refused: capped SAFEs that would own all of C (`safes_exceed_capitalization`); notes without a closing day (`invalid_day`).

| Vector | Expected | Source |
|---|---|---|
| $500k on a $6.7M post-money cap | 74627 ppm (7.46%, "about 7.5%") | YC documents |
| $1M on the same cap | 149254 ppm ("about 15%") | YC documents |
| pre_shares 9,000,000; $1M SAFE at $10M cap; P $2.00; $5M new money | C 10,000,000; 1,000,000 shares at $1.00; new 2,500,000; post 12,500,000; 8.0% | `expected.py` (fractions) |
| Add a $500k 20% discount-only SAFE | capped: 1,034,722 shares at $0.96644295; discount: 312,500 at $1.60; C 10,347,222; post 12,847,222 | `expected.py` |
| $1M at a $30M cap, P $2.00 | converts at P: 500,000 shares | `expected.py` |
| MFN $250k (2025-01-01) with later $1M at $10M cap and $500k at 20% discount | MFN takes the cap terms: 266,071 shares at $0.93959732 | `expected.py` |
| Note $100,000 at 8%, 2025-01-01 to 2026-01-01, $8M pre-money cap, 20% discount, with the $1M SAFE | interest $8,000.00; 121,500 note shares; SAFE 1,013,500; post 12,635,000 | `expected.py` |
| Note $100,000 at 6%, 2024-01-01 to 2024-07-01 (182 days) | interest $2,991.78 | `expected.py` |
| Implied price at signing, $500k on $6.7M, pre_shares 9,000,000 | $0.68888889 | `expected.py` |

## Pro rata (`lib_eng_prorata.js`)

Rule (AngelList on pro rata rights): shares to keep ownership = ownership x post-round fully diluted shares; skipping a round that issues a fraction f of the post-round shares leaves `ownership x (1 - f)`; the pro rata amount in money is ownership x the round's new money; a major-investor right applies at or above a threshold.

| Vector | Expected | Source |
|---|---|---|
| 2.5% skips a round issuing 20% new shares | 2.0% (20000 ppm) | AngelList |
| 25,000 of 1,000,000 shares, round adds 250,000 at $2.00 | keep 31,250, buy 6,250, cost $12,500.00 | AngelList formula |
| 2.5% of a $10M round | $250,000.00 | formula |

## Runway (`lib_eng_runway.js`)

Rule (Visible's computed runway):

- Runway = verified cash / average monthly net burn of the last three verified months.
- Cash: the latest verified cash, at the end of month M. Window: months M-2, M-1, M, each covered exactly once by a verified net burn (monthly rows, or one quarterly row ending at M). Unverified rows are ignored.
- A window month without a verified burn: `unknown`, reason `missing_month`, with the missing months listed; never zero. No verified cash: `unknown`, `no_cash`.
- Average burn zero or below: `not_burning`. Cash at or below zero with a burn: 0 months (known).
- Months to one decimal; `zero_day` = M's last day plus `months x 365.25 / 12` days.

| Vector | Expected |
|---|---|
| Burns 100,000, 120,000, 110,000 (Jul to Sep 2026), cash 1,650,000 at Sep | 15.0 months, average 110,000, zero day 2027-12-31 |
| One quarterly row (Q3 burn 330,000) | 15.0 months |
| August unverified | unknown, `missing_month`, missing 2026-08 |
| Burns -10,000, 5,000, -20,000 | `not_burning` |
| No verified cash | unknown, `no_cash` |

## KPI periods, growth and currency (`lib_eng_kpi.js`)

Rule (Visible's fiscal year end; Visible and Standard Metrics on currency; the flow vs balance gap noted in REPORT Part 1):

- Fiscal year ends in month `fy_end_month` (12 = calendar year); a fiscal year is named by the calendar year it ends in; Q1 starts the month after the year end.
- Roll-ups: `flow` sums its months; `stock` takes the value at the period's last month; `ratio` averages its months, weighted by months covered. A flow or ratio period with a gap is `null` (`incomplete`); a stock period without its last month is `null` (`missing_end`); a point that straddles the period is `misaligned`.
- Growth = (current - prior) / |prior| in ppm, null without a prior (`missing`) or with a zero prior (`no_base`). CMGR = (last / first)^(1 / months) - 1.
- Currency: flows at the average of the period's daily rates (`avg`); stocks at the period's last day, or the latest rate up to 7 days before it (`end`); ratios do not convert. Rates come from the caller (the kernel's dated, cached rates).

| Vector | Expected |
|---|---|
| 2026-05-15, year ending March | FY2027, Q1 (2026-04-01 to 2026-06-30), month 2 |
| Revenue 100, 110, 120 (Apr to Jun), year ending March | Q1 330; Q2 with August missing: null (`incomplete`) |
| Cash 900, 800, 700 | Q1 700; Q2 without September: null (`missing_end`) |
| Fixture 1: EUR to USD fixed at 1.10 all quarter, EUR 300,000.00 | USD 330,000.00 in both modes |
| Fixture 2: 1.08 in January, 1.10 in February, 1.12 in March (daily) | Q1 average 1.10000000; Q1 revenue EUR 300,000.00 to USD 330,000.00; March cash EUR 1,000,000.00 to USD 1,120,000.00 (rate 1.12); February revenue EUR 100,000.00 to USD 110,000.00 |
| EUR 1,000.00 to JPY at 160 | JPY 160,000 (exponents 2 and 0) |
| 100 to 120; 100 to 200 over 12 months | growth 200000 ppm; CMGR 59463 ppm |

## Capital accounts, allocation and fees (`lib_eng_capital.js`)

Rules (ILPA 2025 sample cover letter; ILPA templates overview on fee-paying LPs; AngelList on management fees):

- Capital account, separate running totals: contributed (every call and recall), recalled (calls against recallable capital), unfunded = commitment - (contributed - recalled), distributed, recallable = recallable distributions - recalled, callable = unfunded + recallable. Over-calling shows a negative unfunded and the warning `over_commitment`; recalling more than is recallable warns `over_recall`. An opening balance must come first.
- Allocation: pro rata of commitments with largest-remainder rounding; ties go to the larger commitment, then the earlier line. The lines always sum to the total.
- Management fee: `rate x basis x months / 12`, where a full month counts 1 and a part month its days over the month's days; basis `committed` or `invested` per schedule step; steps start on a day; before the first step there is no fee; one rounding per LP and period; a waiver is a ppm of the fee.
- Call lines: investment and expenses pro rata of every LP's commitment; fee lines only to fee-paying LPs, each at its own schedule (or the fund's); an invested basis is the LP's pro rata share of the fund's invested capital.

| Vector | Expected | Source |
|---|---|---|
| Commitment 50,000,000; calls 18,250,000 then 1,750,000; 10,000,000 distributed, 5,000,000 recallable | contributed 20,000,000 = 40%; unfunded 30,000,000; distributed 10,000,000; recallable 5,000,000; callable 35,000,000 | ILPA sample letter |
| Commitment 100M; call 60M; distribution 20M (10M recallable); recall 4M | contributed 64M, recalled 4M, unfunded 40M, recallable 6M | rule |
| 2,000 random funds (1 to 60 LPs, totals up to 10^13 minor units, some negative) | lines sum to the total exactly; each line within one unit of its exact share | property test |
| 100.00 over three equal commitments | 33.34, 33.33, 33.33 | rule |
| 2% of 10,000,000.00 committed, calendar 2026 (and leap 2028) | 200,000.00 | AngelList |
| Q1 2026; 2026-02-15 to 2026-03-31 | 50,000.00; 25,000.00 | rule |
| 2% committed to 2026-06-30, then 1.5% of 6,000,000.00 invested | 145,000.00; half waived 72,500.00 | rule |
| 2026-03-10 to 2026-04-20, 2% then 1% from 2026-04-01 | 17,383.51 | `expected.py` |
| Call: 1,600,000.00 investment, 16,000.00 expenses, Q1 fees; LPs A 10M (2%), B 5M (own 1.5%), GP 1M (not fee-paying) | A 1,060,000.00 (fee 50,000.00); B 523,750.00 (fee 18,750.00); GP 101,000.00 (no fee) | rule |

## Waterfalls (`lib_eng_waterfall.js`)

Rule (AngelList on carried interest; iCapital's four-step European waterfall). Every output carries `estimate: true` until the fund administrator confirms it.

- Each distribution, in day order (contributions first on the same day), runs through: (1) return of capital to LPs; (2) preferred return to LPs, only with a hurdle, accrued on unreturned capital (and on unpaid pref when compounding) at the hurdle rate over actual days / 365; (3) catch-up, only with a catch-up rate: the GP takes that share of each unit until its total equals carry of all profit paid so far, i.e. the tier's volume reaches `carry x pref paid / (catch-up - carry)`; (4) split: carry to the GP, the rest to LPs.
- European: one machine over the whole fund. American: one machine per deal; the sum of deal carry is compared with the whole-fund carry over the same flows and any excess is the clawback.
- The GP part of each tier is rounded half away and the LP part is the rest, so tiers always sum to the distribution; a multi-tier result can differ from the exact share by one minor unit.
- Compound preferred return uses `(1 + h)^(days / 365) - 1` in floating point, rounded to the minor unit at each event; simple uses exact BigInt.
- Catch-up must exceed carry (`invalid_ppm`).

| Vector | Expected | Source |
|---|---|---|
| $5K invested, $100K returned, 20% carry, no hurdle | GP $19,000; LPs $81,000 | AngelList |
| $1,000,000 in, $1,500,000 out a year later, 8% hurdle compounding, 100% catch-up | ROC 1,000,000; pref 80,000; catch-up 20,000; split 80,000 / 320,000; GP 100,000 (20% of profit) | iCapital tiers |
| Same with an 80% catch-up | GP 100,000.01 (one minor unit of tier rounding); tiers sum exactly | rule |
| Same terms, $1,090,000 out | GP 10,000 (catch-up cut short) | rule |
| 8% hurdle, no catch-up | GP 84,000 | rule |
| $1,000,000 for two years (731 days), nothing above capital | unpaid pref 166,645.96 compounding; 160,219.18 simple | `expected.py` |
| 600,000 and 400,000 in; 500,000 and 1,200,000 out | GP 140,000.00 = 20% of 700,000 profit | `expected.py` |
| American: deal A 100 to 300, deal B 100 to 0 | deal carry 40.00; whole fund 20.00; clawback 20.00 | AngelList, iCapital |
| 300 random flow sets | GP plus LP equals every distribution | property test |

## Fund metrics (`lib_eng_metrics.js`)

Rule (AngelList on TVPI; spreadsheet XIRR; Advance Life OS `lib_portfolio.js` solver):

- DPI = distributions / paid-in; RVPI = NAV / paid-in; TVPI = DPI + RVPI, an identity by construction (each rounded in `_e8`, TVPI is their sum, within one `_e8` unit of the direct ratio).
- Net IRR = XIRR of LP flows (calls negative, distributions positive) with the ending NAV as a final inflow on the as-of day.
- Gross MOIC = (proceeds + holdings value) / invested and gross IRR = XIRR of fund-to-company flows with the value as a final inflow.
- XIRR: `sum(amount / (1 + r)^((day - first day) / 365)) = 0`, Newton from 10% with a bisection fallback; `irr_ppm` = round(r x 10^6). No sign change: `null` (`no_sign_change`).
- No paid-in: multiples `null` (`no_paid_in`); unknown NAV: RVPI, TVPI and net IRR `null` (`no_nav`); unknown value: gross `null` (`no_value`).

| Vector | Expected | Source |
|---|---|---|
| -10,000 (2008-01-01), 2,750 (2008-03-01), 4,250 (2008-10-30), 3,250 (2009-02-15), 2,750 (2009-04-01) | 37.3363% (the spreadsheet's documented 0.373362535); engine within 0.01 percentage points | Microsoft Excel XIRR help; scipy brentq |
| LP calls 1.0M, 2.0M, 1.5M; distributions 0.5M, 1.2M; NAV 6.0M on 2026-09-30 | DPI 0.37777778; RVPI 1.33333333; TVPI 1.71111111; net IRR 10.8577% | `expected.py` |
| Company flows -1.0M, -0.5M, +0.3M; value 4.0M | gross MOIC 2.86666667; gross IRR 19.2802% | `expected.py` |
| 2,000 random funds | TVPI = DPI + RVPI exactly, within one `_e8` unit of the direct ratio | property test |

## Reserves (`lib_eng_reserves.js`)

Rule (Tactyc as described by Kauffman Fellows: follow on to hold the target ownership for the set number of rounds until the reserve is met; Advance Life OS `unsourced_assumption`):

- Per holding and round k with assumed raise R, post-money V and optional pool increase p (ppm of the post-round): dilution f = R / V + p; ownership if skipped o x (1 - f); follow-on to hold the target t: A = (t - o x (1 - f)) x V, at least 0 and at most R; ownership after: o x (1 - f) + A / V.
- `needed` ignores the reserve; `plan` spends the holding's allocated reserve round by round, aiming back at the target each round, until it runs out.
- Fund totals: needed, allocated, budget, available = budget - allocated, shortfall = sum of max(0, needed - allocated).
- Every assumption row needs a non-empty source (a file, a link or the person whose judgment it is); otherwise `unsourced_assumption`, before anything is computed. A round without an assumption is `missing_assumption`; a raise not below its post-money, or dilution of 100% or more, is `invalid_assumption`.

| Vector | Expected | Source |
|---|---|---|
| 10% today, target 10%, round 1 $10M at $50M post, round 2 $30M at $150M post | needed $1,000,000 + $3,000,000 = $4,000,000; skipping round 1 leaves 8% | hand computation, `expected.py` |
| Same with $2,500,000 allocated | plan $1,000,000 then $1,500,000; ending ownership 9.0%; shortfall $1,500,000 | `expected.py` |
| Round 1 with a 5% pool increase | needed $1,250,000 | `expected.py` |
| Round 2's source blank | refused `unsourced_assumption` (holding and round in `extra`) | Advance Life OS rule |

## Memo scenarios (`lib_eng_scenarios.js`)

Rule (Bessemer's outcomes analysis): expected multiple = sum of probability x exit multiple; probabilities in ppm must sum to exactly 1,000,000, else `probabilities_not_100`; expected proceeds = check x expected multiple; an exit multiple can come from exit value x ownership / invested.

| Vector | Expected |
|---|---|
| 50% at 0x, 30% at 3x, 15% at 10x, 5% at 30x | 3.9x; on a $1,000,000 check $3,900,000 |
| Probabilities summing to 99% | refused `probabilities_not_100` |
| $500M exit, 5% ownership, $1M invested | 25x |

## Verification

- Tests: `node --test "tools/engine_tests/*.test.mjs"` from the app folder (66 tests). `tools/engine_tests/expected.py` (Python 3.11, numpy, scipy, zoneinfo) computes the expected values independently and writes `expected.json`, which the tests read; rerun it after changing the zone table.
- Goja: every engine was loaded inside PocketBase 0.39.6 (scratch copy, port 3199) and 45 vector checks (including all 891 zone checks and 300-case allocation sums) passed at boot and through a route in a pooled VM. The check hook stayed in the scratch copy.

## Sources

- CRM `WS/crm_9f859ca6/pb/pb_hooks/lib_interactions.js` lines 8 to 37 (strength).
- YC application snapshot `WS/_verify/e8bebd6c/snapshot/pb/pb_hooks/lib_checks.js` (tri-state checks).
- HR OS `WS/hr_os_37878b99/pb/pb_hooks/lib_util.js` lines 279 to 422 (zone table, corrected here) and `lib_money.js` (largest remainder, half away from zero).
- ERP snapshot `WS/_verify/9cc5cf11/snapshot/pb/pb_hooks/lib_money.js` (BigInt in Goja, exponents, conversion).
- Advance Life OS `WS/advance_life_os_694ab8fc/pb/pb_hooks/lib_portfolio.js` lines 1194 to 1259 (XIRR solver) and `lib_projection.js` line 239 (`unsourced_assumption`).
- Y Combinator, SAFE documents: https://www.ycombinator.com/documents
- AngelList Education: https://learn.angellist.com/pro-rata-rights, https://learn.angellist.com/carried-interest, https://learn.angellist.com/management-fees, https://learn.angellist.com/tvpi
- ILPA sample cover and description letter (2025): https://ilpa.org/wp-content/uploads/2025/10/ILPA-Sample-Cover-Description-Letter-2025.pdf
- ILPA combined overview of templates (2025): https://ilpa.org/wp-content/uploads/2025/09/Combined-Overview-ILPA-Templates.pdf
- iCapital on distribution waterfalls: https://icapital.com/insights/private-equity/understanding-private-market-fund-distribution-waterfalls/
- Kauffman Fellows on multi-stage portfolio construction: https://www.kauffmanfellows.org/journal/multi-stage-portfolio-construction-with-monte-carlo
- Visible, currency conversions: https://help.visible.vc/en/articles/9761729-how-to-set-up-metric-currency-conversions-for-your-portfolio-data
- Visible, fiscal year end: https://help.visible.vc/en/articles/15464208-how-to-set-a-fiscal-year-end-for-portfolio-companies
- NextView on seed fundraise timing: https://nextview.vc/blog/reading-the-tea-leaves-where-am-i-in-my-seed-fundraise-really/
- Microsoft, XIRR function (documented example 0.373362535).
- IANA time zone database (through Python `zoneinfo`).
