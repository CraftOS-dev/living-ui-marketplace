# Engines builder notes

What was built: 13 engines of REPORT Table 33 plus one shared core, all pure CommonJS in `pb/pb_hooks/lib_eng_*.js`; 66 Node tests in `tools/engine_tests/` with independently computed expectations; `reference/ENGINES.md` with every formula, unit, edge rule, vector and source. Ops: none (engines are libraries; modules wrap them in their own ops).

## How to call an engine from a hook

```js
let _safe = null;
function SAFE() {
  if (_safe === null) _safe = require(`${__hooks}/lib_eng_safe.js`);
  return _safe;
}
```

Require inside a function and cache it (Goja `require` costs about 2 ms). Never require inside a loop. Engines take plain objects and return plain objects (Numbers, strings, booleans, null, arrays); no BigInt ever leaves an engine.

Units: `_minor` integer minor units, `_ppm` millionths, `_e8` x 10^8 of the major unit, `_day` `YYYY-MM-DD`. Amounts may be passed as whole Numbers or digit strings.

Errors: bad input throws `Error` with `status: 400`, `code`, `extra` (same shape as the kernel's `fail`), so an op can let it propagate. Unknown data never throws: fields come back `null` with a `reason`. Show the reason (for example "Runway unknown: August not verified"), never 0.

## Exports (exact signatures and return shapes)

### lib_eng_core.js (shared; other modules may use it)
- Constants `E6, E8, DAY_MS, B0, B1, BE6, BE8`.
- `fail(status, message, code, extra) -> Error`; `isNil(x)`.
- `big(x, field) -> BigInt`, `bigPos(x, field)`, `num(bigint, field) -> Number` (safe or throws `out_of_range`), `divRound(n, d)`, `divFloor(n, d)`, `mulDiv(a, b, c) -> Number` (half away from zero), `bpow10(n)`, `gcd`.
- Exact fractions `rat(n, d)`, `radd, rsub, rmul, rdiv, rcmp, rmin, rfloor, rround, rnum`.
- `largestRemainder(totalBig, weightsBig[]) -> BigInt[]` (sums exactly).
- `exponent(currency) -> 0|2|3`, `convertMinor(minor, from, to, rate_e8) -> minor`.
- Days: `isDay, dayNum, dayText, addDays(day, n), diffDays(a, b), weekday(day) (0 Sun), daysInMonth(y, m1), monthStart, monthEnd, monthEndAfter(day, n), monthIndex, instant(x) -> ms, ppmCheck`.

### lib_eng_strength.js (network)
- `WEIGHT`, `HALF_LIFE_DAYS` 60, `WINDOW_DAYS` 365.
- `score(touches, now) -> { score 0..100, band: strong|good|weak|none, s, counted, last_at|null }`; touches `[{ kind: meeting|call|email|message, direction: in|out (required for email), at }]`.
- `edges(interactions, now) -> [{ member, person, score, band, s, counted, last_at }]` sorted strongest first; interactions `[{ member, people: [personId], kind, direction, at }]`.
- `best(edges) -> { score, band, member|null, person|null, last_at|null }` (person strength over its edges; company strength over the edges to its people). Maps to `lib_network.strengthOf` as `{ score, last_at, best_member: member }`.
- `weightOf, decayed, display(s), band(score), compareEdges`.

### lib_eng_paths.js (network)
- `rank({ targets: [personId], member_edges: [{ member, person, score, last_at }], links: [{ a, b, score, last_at }], limit: 20 }) -> [{ kind: direct|one_hop, member, connector|null, target, path: [{ member }, { person }, ...], edges: [{ from, to, score, last_at }], weakest, last_at }]`. `links` are person-to-person ties (co-attendance, shared threads, known colleagues); network decides what counts.

### lib_eng_fit.js (kernel-records `lib_theses`, intake)
- `FACT_TYPES` (25 keys of SPEC 7.2 in SPEC order, each `text|money|int|num|bool`), `FACT_KEYS`, `OPS`, `OPS_BY_TYPE`.
- `validate(criteria) -> normalized criteria` (throws `invalid_criterion` or `invalid_currency`); use it on `theses.save`.
- `fit(criteria, facts, { fx?(from, to, day) -> rate_e8|null, day? }) -> { checks: [{ key, op, required, status: met|unmet|unknown, reason: missing|empty|bad_value|currency_unknown|no_rate|null, value }], counts: { met, unmet, unknown }, required: { met, unmet, unknown, state } }`.
- Criterion `{ key, op, value? | values? | min?, max?, required?: true, currency? (money keys) }`. Facts `{ [key]: { value, grade } }` (grade `unknown` or a null value = unknown).

### lib_eng_days.js (intake SLA, deals stalls, funds due days, cron "today")
- `ZONES` (101), `DEFAULT_WEEKEND` [0, 6], `isZone(zone)`.
- `offsetMinutes(zone, at)`, `localDay(zone, at) -> day`, `today(zone, now) -> day`.
- Calendar options `{ weekend?: [0..6], holidays?: [day] }` on every business-day call.
- `isBusinessDay(day, cal)`, `addBusinessDays(day, n, cal) -> day` (funds: notice due = `addBusinessDays(notice_day, 10, cal)`), `businessDaysBetween(a, b, cal) -> int` (a < d <= b).
- `slaDue({ received_at, zone, days, weekend?, holidays? }) -> { received_day, due_day, days }`.
- `slaState({ due_day, today, weekend?, holidays? }) -> { state: open|due_today|overdue, business_days_left }`.
- `daysInStage({ entered_at, now, zone }) -> int`; `stall({ entered_at, now, zone, stall_days }) -> { days_in_stage, stall_days, stalled, stalls_on|null }`.

### lib_eng_safe.js (portfolio)
- `INSTRUMENTS` `safe_cap, safe_discount, safe_mfn, note, priced`.
- `ownership({ amount_minor, cap_minor }) -> { ownership_ppm }`.
- `stack([{ id, amount_minor, cap_minor|null }]) -> { safes: [{ id, ownership_ppm|null, reason }], capped_ppm }`.
- `interest({ principal_minor, rate_ppm, from_day, to_day }) -> { days, interest_minor, amount_minor }`.
- `convert({ currency, price_e8, pre_shares, new_money_minor | new_shares, pool_increase_shares?, day?, safes: [{ id, amount_minor, cap_minor?, discount_ppm?, mfn?, issued_day? }], notes: [{ id, principal_minor, rate_ppm, issued_day, cap_minor?, discount_ppm? }] }) -> { currency, price_e8, pre_shares, capitalization_shares, safes: [{ id, amount_minor, basis: cap|discount|round, terms_from, conversion_price_e8, shares, capitalization_ppm, ownership_ppm }], notes: [{ id, principal_minor, days, interest_minor, amount_minor, basis, conversion_price_e8, shares, ownership_ppm }], new_shares, pool_increase_shares, post_shares }`.
- `preview({ instrument, currency, amount_minor, cap_minor?, discount_ppm?, rate_ppm?, issued_day?, post_money_minor? | pre_money_minor? + raise_minor?, price_e8?, post_shares?, pre_shares?, scenario?: { price_e8, pre_shares, new_money_minor, day?, pool_increase_shares? } }) -> { instrument, ownership_ppm|null, reason: set_at_conversion|null, implied_price_e8|null, conversion|null }` (the Mark invested preview).

### lib_eng_prorata.js (portfolio)
- `afterSkip({ ownership_ppm, new_ppm }) -> { ownership_ppm }`.
- `toMaintain({ held_shares, pre_shares, new_shares, price_e8?, currency? }) -> { ownership_before_ppm, ownership_if_skip_ppm, shares_to_keep, shares_to_buy, cost_minor|null, post_shares }`.
- `amount({ ownership_ppm, round_minor }) -> { amount_minor }`; `isMajor({ value, threshold }) -> { major }`.

### lib_eng_runway.js (portfolio, `lib_portfolio.runway`)
- `runway({ rows: [{ period_end (month end), months: 1|3, cash_minor|null, net_burn_minor|null, verified }] }) -> { state: known|not_burning|unknown, months|null (1 decimal), reason: no_cash|missing_month|overlapping_rows|not_burning|null, cash_minor, avg_burn_minor, as_of_day, window: ['YYYY-MM'], missing: ['YYYY-MM'], zero_day }`. Net burn is positive when burning. Pass verified and unverified rows; the engine ignores the unverified.

### lib_eng_kpi.js (portfolio KPI charts, kernel `lib_fx`)
- `KINDS` `flow, stock, ratio`; `modeFor(kind) -> avg|end|null`.
- `fiscalOf(day, fy_end_month) -> { fy, q, month, fy_start, fy_end, q_start, q_end }`.
- `rollup({ points: [{ period_end, months: 1|3|12, value|null }], kind, fy_end_month, to: quarter|year }) -> [{ fy, q|null, start, end, value|null, reason: incomplete|missing_end|misaligned|overlapping_points|null }]`.
- `growth(current, prior) -> { growth_ppm|null, reason }`; `growthSeries(points, lag) -> [{ period_end, growth_ppm, reason }]`; `cmgr(first, last, months) -> { cmgr_ppm|null, reason }`.
- `rateFor({ rates: [{ day, rate_e8 }], mode: avg|end, start_day, end_day }) -> { rate_e8|null, reason, days }`.
- `convertSeries({ points, kind, from, to, rates }) -> [{ period_end, value|null, rate_e8|null, mode, reason }]`.
- Suggested kinds for the seeded `kpi_defs`: revenue flow, net_burn flow, arr stock, mrr stock, cash stock, headcount stock, customers stock, gross_margin ratio, nrr ratio, runway from `lib_eng_runway`.

### lib_eng_capital.js (funds)
- `EVENT_TYPES` `opening, call, recall, distribution`.
- `account({ commitment_minor, events: [{ day, type, amount_minor, recallable_minor? (distribution), contributed_minor?, distributed_minor?, recallable_minor?, recalled_minor? (opening) }] }) -> { commitment_minor, contributed_minor, contributed_ppm, recalled_minor, unfunded_minor, distributed_minor, recallable_minor, callable_minor, warnings: [over_commitment|over_recall], rows: [{ day, type, amount_minor, ...running totals }] }`. Pass called amounts (the notice), not receipts; payment tracking is separate.
- `allocate({ total_minor, lps: [{ lp, commitment_minor }] }) -> [{ lp, amount_minor }]` (sums exactly; any weight works, for example contributed capital for a distribution).
- `fee({ from_day, to_day (inclusive), schedule: [{ from_day, rate_ppm, basis: committed|invested }], committed_minor?, invested_minor?, waiver_ppm? }) -> { gross_minor, waiver_minor, fee_minor, months_e6, segments: [{ from_day, to_day, days, month_days, rate_ppm, basis, basis_minor }] }`.
- `callLines({ investment_minor?, expenses_minor?, fees?: { from_day, to_day, schedule, fund_invested_minor? }, lps: [{ lp, commitment_minor, fee_paying, schedule?, waiver_ppm? }] }) -> { lines: [{ lp, investment_minor, expenses_minor, fee_minor, fee_gross_minor, fee_waiver_minor, total_minor }], totals: { investment_minor, expenses_minor, fee_minor, total_minor } }`.

### lib_eng_waterfall.js (funds `waterfall.preview`)
- `european({ events: [{ day, type: contribution|distribution, amount_minor }], carry_ppm, hurdle_ppm?, compounding?: compound|simple, catchup_ppm?, as_of_day? }) -> { estimate: true, gp_minor, lp_minor, contributed_minor, distributed_minor, profit_minor, unreturned_minor, pref_owed_minor, tiers: { roc_minor, pref_minor, catchup_gp_minor, catchup_lp_minor, split_gp_minor, split_lp_minor }, rows: [per distribution: { day, amount_minor, roc_minor, pref_minor, catchup_gp_minor, catchup_lp_minor, split_gp_minor, split_lp_minor, gp_minor, lp_minor }] }`.
- `american({ deals: [{ id, events }], carry_ppm, hurdle_ppm?, compounding?, catchup_ppm? }) -> { estimate: true, deals: [{ id, gp_minor, lp_minor, contributed_minor, distributed_minor }], deal_carry_minor, fund_carry_minor, clawback_minor, carry_after_clawback_minor }`.
- Carry on a new distribution = cumulative GP carry including it minus carry already paid; run the machine over all flows to date.

### lib_eng_metrics.js (funds, `lib_funds.metrics`)
- `multiples({ paid_in_minor, distributed_minor, nav_minor|null }) -> { dpi_e8, rvpi_e8, tvpi_e8, reasons: { dpi, rvpi, tvpi } }`.
- `xirr([{ day, amount_minor (signed) }]) -> { rate|null, irr_ppm|null, reason }`.
- `netIrr({ lp_flows, nav_minor|null, as_of_day }) -> { irr_ppm|null, rate|null, reason }`.
- `gross({ company_flows, value_minor|null, as_of_day }) -> { invested_minor, proceeds_minor, value_minor, moic_e8|null, irr_ppm|null, rate|null, reasons: { moic, irr } }`.
- `fund({ currency, as_of_day, lp_flows, nav_minor|null, company_flows, holdings_value_minor|null }) -> { currency, as_of_day, paid_in_minor, distributed_minor, nav_minor, dpi_e8, rvpi_e8, tvpi_e8, net_irr_ppm, gross_moic_e8, gross_irr_ppm, reasons: { dpi, rvpi, tvpi, net_irr, gross_moic, gross_irr } }`: exactly the `lib_funds.metrics` contract plus `as_of_day` and `reasons`. LP flows: calls negative, distributions positive.

### lib_eng_reserves.js (funds)
- `MAX_ROUNDS` 8.
- `validate(holdings) -> true` (throws `unsourced_assumption`, `missing_assumption`, `invalid_assumption`; call it on save).
- `plan({ holdings: [{ id, ownership_ppm, target_ppm?, rounds, allocated_minor, assumptions: [{ round, raise_minor, post_money_minor, pool_ppm?, source }] }], reserve_budget_minor }) -> { holdings: [{ id, target_ppm, needed_minor, allocated_minor, shortfall_minor, surplus_minor, ownership_end_ppm, ownership_end_plan_ppm, rounds: [{ round, raise_minor, post_money_minor, pool_ppm, dilution_ppm, ownership_if_skip_ppm, needed_minor, ownership_after_ppm, plan_minor, ownership_after_plan_ppm, source }] }], totals: { needed_minor, allocated_minor, budget_minor, available_minor, shortfall_minor } }`.

### lib_eng_scenarios.js (committee)
- `expected({ scenarios: [{ label, probability_ppm, multiple_e8 }], check_minor? }) -> { expected_multiple_e8, expected_proceeds_minor|null, rows: [{ label, probability_ppm, multiple_e8, weighted_e8 }] }` (throws `probabilities_not_100` with `extra.sum_ppm`).
- `multipleFromExit({ exit_value_minor, ownership_ppm, invested_minor }) -> { multiple_e8 }`.

## Decisions

- One shared `lib_eng_core.js` (in my glob) instead of copying BigInt helpers into every engine; engines find it through `__hooks` in Goja and `__dirname` in Node.
- Strength: a touch after `now` does not count (the CRM clamped it to now). Everything else is the CRM's formula, and a test proves equality with the CRM's own function on 300 random sets.
- Paths: a one-hop path's contact day is its stalest edge, so ties prefer paths fresh end to end.
- Fit: `exists` is unknown when the fact is missing and unmet only when it is known to be empty; facts of the wrong type are unknown (`bad_value`), not errors.
- Days: stall days are calendar days; SLA days are business days. Weekend default Saturday and Sunday.
- SAFE: the round price is an input (term sheets state it); conversion is exact (fractions), so share counts never drift by a float floor; notes use a pre-money cap.
- Fees by month fractions, so a year is exactly the annual rate in leap years too and a quarter is exactly a quarter.
- Capital account follows the ILPA sample: unfunded excludes recallable capital, which is tracked separately (callable = unfunded + recallable); a recall draws on recallable, not unfunded.
- Waterfall default compounding is `compound` (annual on actual/365); the LPA parameters of SPEC 7.1 do not name compounding, so funds should pass it explicitly when the LPA says simple.
- Runway: the three-month window must be complete; a gap gives unknown rather than averaging older months.

## Gaps (deliberate)

- SAFE conversion takes the price per share as given; deriving the price from a pre-money valuation that includes the SAFEs (a second circularity) is not modelled. Pre-money SAFEs, note maturity events and option pool shuffles are out of scope.
- American waterfall is per deal with clawback against the whole fund; it does not net unrealized write-downs into a deal's return of capital, and does not model escrow.
- Recycling caps and windows (LPA) are not an engine; funds marks distributions recallable and the account engine tracks them.
- Reserves are deterministic (no Monte Carlo, no graduation probabilities).
- The zone table covers 101 zones; a firm zone outside it is refused with `invalid_timezone`.

## For other builders (contract notes)

- kernel-records: SPEC 4.5 names the engine `lib_fit.js`; it is `lib_eng_fit.js`. `lib_theses.FACT_KEYS` should equal `lib_eng_fit.FACT_KEYS` (same 25 keys, same order); `theses.save` can call `lib_eng_fit.validate`. Facts go in as `{ [key]: { value, grade } }`.
- kernel-core: HR OS's zone table (`lib_util.js`) has two bugs the IANA check found: `Africa/Cairo` has no daylight time (Egypt restored it in 2023) and `Pacific/Chatham` switches 30 minutes early. If the kernel copies HR OS's `lib_util`, validate the firm's zone with `lib_eng_days.isZone` and compute local days with `lib_eng_days.localDay`, or copy the corrected table. `lib_fx.convert(..., mode)` can delegate to `lib_eng_kpi.rateFor` and `lib_eng_core.convertMinor` so there is one avg/end implementation.
- funds: notice due days via `lib_eng_days.addBusinessDays`; previews via `lib_eng_capital.callLines`; `lib_funds.metrics` is `lib_eng_metrics.fund`.
- `node tools/gen.mjs` could not run in APP at hand-back: `tools/gen.mjs` (kernel-core) was not in APP yet. Engines add no ops, so the catalog is unaffected.
- No npm dependencies. Tests need only Node 24; regenerating `expected.json` needs Python 3.11 with numpy and scipy.

## Results

- `node --test "tools/engine_tests/*.test.mjs"`: 66 tests, 66 pass.
- Goja: all 14 files loaded in PocketBase 0.39.6 (scratch port 3199); 45 vector checks (including 891 zone checks and 300 random allocations) passed at boot and through a route; the check hook was not shipped.
- Gate on the scratch copy: all steps passed, no external hosts.
