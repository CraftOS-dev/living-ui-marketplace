# HR OS payroll engine and rule pack language

This is the reference for anyone who writes or reviews a rule pack (people, the packs builders, and your AI agent when it drafts a pack update), and for the payroll module that builds the engine input. Engine version 1.0.0.

The engine turns one payslip input and a set of rule packs into lines, totals, issues and an explanation of every figure. It is pure and deterministic: no database, no clock, no random numbers. The same input always gives byte-identical output, and `output.hash` fingerprints the figures. It runs unchanged in Node (tests) and in PocketBase's JavaScript engine (pay runs).

## 1. Files

| File | What it is |
|---|---|
| `pb/pb_hooks/lib_expr.js` | The formula language: tokenizer, parser, evaluator, rounding, table lookups, day arithmetic |
| `pb/pb_hooks/lib_engine.js` | `calculate`, `yearEnd`, `preview`, `completeInput`, `periodInfo`, `taxYearOf`, `basisDay`, `pickVersions`, `plan`, `fingerprint`, `hash`, `stableStringify`, `exponentOf`, `constants` |
| `pb/pb_hooks/lib_packcheck.js` | `validate(pack, others)`, `runVectors(pack, others)`, `checkSet(packs)`, `requiredPacks(pack, others)` |
| `pb/pb_hooks/packs/<code>.js` | Built-in packs, one version per file (`jp.js`, `jp-2027.js`). Files whose names start with `_` are helpers a pack may `require('./_name.js')`; they are not packs. Packs are plain data (no PocketBase globals, no functions). |
| `tools/packs/test.mjs` | The pack test runner (section 11) |
| `reference/tests/engine/` | The engine's own tests: `node reference/tests/engine/run.mjs` |

Inside hooks, require the engine inside a function body: `const engine = require(`${__hooks}/lib_engine.js`)`. The engine requires `lib_expr.js` from its own folder.

## 2. The pack object

```js
module.exports = {
  code: 'us-federal',              // lower case letters, digits, dashes; one code across versions
  country: 'US',                   // two letters; '' only for a template pack such as generic
  region: '',                      // '' for the whole country, else a region code
  name: 'United States federal (FIT, FICA, FUTA)',
  version: '2026.1',               // text
  effective_from: '2026-01-01',    // the pack applies from this day (by its date basis)
  effective_to: '2026-12-31',      // or '' for open ended
  currency: 'USD',                 // '' for any currency
  tax_year: { start: '01-01' },    // MM-DD, day 01 to 28 (GB '04-06', IN '04-01', AU '07-01')
  date_basis: 'pay_date',          // optional: pay_date (default), period_end or period_start
  requires: [],                    // pack codes that must run first (their order is lower)
  order: 10,                       // packs run from low to high order, then by code
  ship: 'active',                  // 'active' (verified, vectors pass) or 'draft' (a person completes it)
  sources: [{ title, url, retrieved: 'YYYY-MM-DD', note }],
  notes: 'what is and is not covered, plainly',
  profile_fields: [ ... ],         // section 2.1
  tags: [{ tag: 'fit_wages', label: 'Wages for federal income tax', help }],
  seed_components: [{ code: 'BASIC', name, kind, stage, calc, tags, taxable, sort }],
  tables: { ... },                 // section 5
  steps: [ ... ],                  // section 3
  year_end_steps: [ ... ],         // optional, section 3.4
  vectors: [ ... ],                // section 10
  min_wage: { hourly, monthly, note },
  filings: [{ code, name, frequency, due_rule, form }],
  documents: [{ code, name, year_end }]
};
```

`validate` refuses a pack whose shape is wrong, whose formulas do not parse or read unknown names, or that cannot be stored as JSON. An `active` country pack needs at least one source with a url and at least one vector; a warning asks for a vector from an official worked example.

### 2.1 Fields: profile (per person) and entity (per employer)

```js
{ key: 'filing_status', label: 'Filing status', type: 'enum', options: [{ value: 'single', label: 'Single' }, ...],
  default: 'single', required: false, help: '...', form: 'W-4 Step 1(c)' }
{ key: 'sui_rate', label: 'State unemployment rate', type: 'number', scope: 'entity', default: 0.034, min: 0, max: 1 }
```

- `type`: `enum` (text from options), `number`, `money` (major units), `boolean`, `text`, `date` (`YYYY-MM-DD`). `min` and `max` bound numbers.
- `scope`: `employee` (default) is read as `profile.<key>`; `entity` is read as `entity.<key>` (set once per employer for this pack: unemployment rates, levy flags, credit reductions).
- A missing value takes `default`; with no default it is "no value" (section 4.3). A `required` field still missing, or a value that does not fit its type or options, blocks the payslip (`profile_missing`, `profile_invalid`, `entity_missing`, `entity_invalid`, naming the field and its `form`), and the pack that declares it does not run.
- Two packs may declare the same key when the types agree (the lower order pack's default wins); different types block the payslip (`field_conflict`).

### 2.2 Tags and seed components

Tags connect pay components to packs. Payroll puts the tags of each component on its line (`BASIC` carries `['fit_wages', 'ss_wages', 'medicare_wages']`); a pack reads them with `sum("fit_wages")`. List the tags a pack reads in `tags` with a label, and give `seed_components` with the right tags so a new employer in that country starts correctly. Pack steps can emit lines with tags too, so later steps and later payslips read them.

## 3. Steps

Steps run in order, pack by pack (packs sorted by `order`, then `code`). There are three kinds.

### 3.1 var: a named value

```js
{ var: 'annual_wages', expr: 'sum("fit_wages") * periods()', when: 'optional condition', else: 'value when false', round: { mode, step }, explain: 'note' }
```

A var holds a number, text or true/false. Vars are local to their pack and must be set before they are read (a forward or self reference is a validation error). With `when` false the var takes `else`, or 0. Names are letters, digits and `_` (capitals allowed, so official notation such as `A` and `e_B` can be kept), and may not be a root name, a function name, `true` or `false`.

### 3.2 code: a payslip line

```js
{ code: 'US_FIT', name: 'Federal income tax', kind: 'deduction', stage: 'statutory',
  when: '!profile.exempt', amount: 'max(0, table("fit_" + profile.filing_status, annual) / periods())',
  qty: 'optional formula', rate: 'optional formula', base: 'optional formula',
  round: { mode: 'half_up', step: 0.01 }, tags: ['tax'], payee: 'IRS', filing: 'us_941',
  explain: 'Pub 15-T percentage method, Worksheet 1A', keep_zero: false }
```

- `code` is UPPER_SNAKE_CASE and unique across every pack and input line of the payslip.
- `kind`: `earning` (adds to gross), `deduction` (needs `stage`: `pre`, `statutory` or `post`), `employer` (employer cost, not paid to the person), `reimbursement` (added to net, not gross), `info` (shown and stored, never in totals: use it for trackers such as wages counted toward a ceiling).
- Amounts are signed as they stand on the payslip: a deduction of 30 is `30`; a refund of withheld tax is a negative deduction.
- With `when` false, or an amount of 0 without `keep_zero: true`, no line is emitted; `line(code)` then gives 0.
- `qty`, `rate` and `base` are stored on the line for the payslip and the explanation (for example base 6,000 and rate 0.2).

### 3.3 check: a pack-authored issue

```js
{ check: 'profile.w4_2020 || profile.filing_status != "hoh"', severity: 'blocker', issue: 'us_w4_pre2020_hoh',
  message: 'A pre-2020 Form W-4 has no Head of household status', when: 'optional' }
```

When the check formula is false, the payslip gets an issue with code `issue` (snake_case), the `severity` (`blocker` stops the pay run from being approved; `warning` asks a person to look) and the message, plus the pack and step. Use it for unsupported cases instead of guessing: a frequency the official formula does not cover, a premium month whose rates are not published, a missing declaration choice.

### 3.4 year_end_steps

When `run.year_end` is true, each pack runs its `steps` and then its `year_end_steps` in the same scope (they see the pack's vars and lines). `yearEnd(input, packs)` runs a year-end calculation with only the packs that have `year_end_steps` and the packs they require. Japan's 年末調整 and India's March true-up are written this way: compute the annual tax from `ytd(...)` plus this payslip, then emit the difference from `ytd_code(...)` as an adjustment line (negative for a refund).

### 3.5 Rounding

`round: { mode, step }` on a line or var. Modes:

| Mode | Meaning | Example (step 1) |
|---|---|---|
| `half_up` | nearest, halves away from zero | 2.5 to 3, -2.5 to -3 |
| `half_even` | nearest, halves to the even multiple | 2.5 to 2, 3.5 to 4 |
| `half_down` | nearest, halves toward zero (Japan's 50 sen rule for the employee share) | 2.5 to 2, 2.51 to 3 |
| `up` | away from zero | 2.01 to 3, -2.01 to -3 |
| `down` | toward zero (truncate) | 2.99 to 2, -2.99 to -2 |

`step` is any positive number: 0.01, 0.05, 1, 10, 100. Every line is rounded by its step's rule and then to the currency minor unit (half up), so payroll converts it to integer minor units exactly; without `round` a line is rounded to the minor unit, halves away from zero. A step finer than the currency unit is a validation warning.

Rounding is decimal-safe: values are snapped to 15 significant digits before every rounding, `floor`, `ceil`, comparison and table lookup, so binary noise never moves a figure (1.005 rounds to 1.01; 2250 x 0.0425 + 93.17 = 188.795 rounds half up to 188.80; `floor(0.29 * 100)` is 29).

## 4. Formulas

### 4.1 Literals and operators

- Numbers `12`, `0.062`, `1e3`, `.5`; text in double quotes `"single"` (escapes `\"`, `\\`, `\n`, `\t`, `\uXXXX`); `true`, `false`.
- Operators from strongest to weakest: `!` and unary `-`; `* / %`; `+ -` (`+` joins text when either side is text: `"fit_" + profile.status`); `< <= > >=`; `== !=`; `&&`; `||`; `cond ? a : b` (right associative). Parentheses group.
- `&&`, `||`, `? :` and `if()` evaluate lazily: the branch not taken never runs, so `x > 0 ? y / x : 0` is safe.
- Comparisons cannot be chained (`a < b < c` is a syntax error: write `a < b && b < c`). Days compare as text: `run.pay_date >= "2026-04-01"`.

### 4.2 Names

| Root | Keys |
|---|---|
| `run` | from payroll: `kind`, `period_start`, `period_end`, `pay_date`, `periods_per_year`, `frequency`, `days_in_period`, `working_days_in_period`, `worked_days`, `year_end`. Computed for each pack from its tax year and date basis: `basis_day`, `tax_year_start`, `tax_year_end`, `period_index` (1 based), `periods_remaining` (periods after this one, 0 in the last), `first_period_of_year`, `tax_week` (1 = the first 7 days of the tax year), `tax_month` (1 = the start day to the day before the same day next month, so 6 April to 5 May for a 04-06 year), `periods_paid` (earlier regular payslips in this tax year) |
| `employee` | `id`, `birth_date`, `age`, `hire_day`, `end_day`, `nationality`, `gender`, `years_of_service` |
| `employment` | `id`, `entity_country`, `entity_region`, `work_country`, `work_region`, `fte`, `employment_type` |
| `profile` | the employee fields declared by the packs in this calculation |
| `entity` | the entity fields (`scope: 'entity'`) declared by the packs in this calculation |
| `currency` | `code`, `exponent` |
| `context` | free data payroll passes; documented keys `min_wage_hourly`, `hours_worked`. Any other key may be absent: read it as `coalesce(context.x, 0)` |
| (no root) | a var set earlier in the same pack |

`run.period_index` by frequency: monthly is the tax month; semi_monthly counts two per tax month (days 0 to 14 of the tax month are the first); biweekly counts 14-day blocks from the tax year start; weekly is the tax week (a 53rd week exists).

### 4.3 Values and "no value"

Values are numbers, text, true/false, and "no value" for a declared field nobody filled and that has no default (also employee or context data payroll did not send). Arithmetic, ordering and functions that need a number refuse "no value" with an error that says to use `coalesce`. `==` and `!=` accept it (`profile.code == "A"` is false when the code has no value). Comparing different kinds (text with a number) is an error, as is a condition that is not true/false (`when: '1'`).

### 4.4 Functions

Arguments that are names of tables, columns, keys, tags and codes may be any text formula (`band("jp_monthly", a, "k" + deps)`).

| Function | What it gives |
|---|---|
| `min(a, b, ...)` | smallest of the numbers |
| `max(a, b, ...)` | largest of the numbers |
| `abs(x)` | absolute value |
| `floor(x)` | largest whole number not above x |
| `ceil(x)` | smallest whole number not below x |
| `round(x, dp)` | round to dp decimals (default 0, may be negative: -2 rounds to hundreds), halves away from zero |
| `round_even(x, dp)` | round to dp decimals, halves to the even digit |
| `round_up(x, step)` | away from zero to a multiple of step |
| `round_down(x, step)` | toward zero to a multiple of step |
| `round_to(x, step)` | nearest multiple of step, halves away from zero |
| `round_half_down(x, step)` | nearest multiple of step, halves toward zero |
| `clamp(x, lo, hi)` | x limited to lo to hi |
| `if(cond, a, b)` | a when cond is true, else b (only the chosen branch runs) |
| `coalesce(a, b, ...)` | the first argument that has a value |
| `in(x, a, b, ...)` | true when x equals one of the others |
| `sum(tag)` | sum of this payslip's lines with the tag so far (input lines and earlier steps of any pack) |
| `sum_code(code)` | sum of this payslip's lines with the code so far |
| `line(code)` | the result of an earlier step that emits the code (0 when its `when` was false). For input lines use `sum_code` |
| `total(group)` | running total so far: `gross`, `pre`, `statutory`, `post`, `deductions`, `employer`, `reimbursement`, `net` |
| `ytd(tag)` | earlier payslips' lines with the tag, inside this pack's tax year, before this run |
| `ytd_code(code)` | the same by code |
| `ytd_since(tag, day)` | earlier payslips' lines with the tag dated on or after day, in any tax year (fiscal year bonus caps) |
| `ytd_code_since(code, day)` | the same by code |
| `prev_regular(tag)` | the tag on the most recent earlier regular payslip (pay date on or before this run's), 0 when none |
| `prev_regular_code(code)` | the same by code |
| `has_prev_regular()` | true when there is such a payslip |
| `prev_regular_date()` | its pay date, or `""` |
| `regular_in_month(tag, day)` | the tag over earlier regular payslips dated in the calendar month of day |
| `regular_in_month_code(code, day)` | the same by code |
| `regular_count_in_month(day)` | how many earlier regular payslips are dated in that month |
| `table(name, x)` | a progressive brackets table applied to x (section 5.1) |
| `band(name, x, column)` | the value in the band row containing x (section 5.2); without column, the row's `value` |
| `map(name, key, column)` | the value under key (numbers and true/false become text keys: `map("t", 52)` reads `"52"`) |
| `days_between(a, b)` | days from a to b (b minus a) |
| `months_between(a, b)` | whole months from a to b (month end to month end counts as a month) |
| `add_days(day, n)` | the day n days later (n may be negative) |
| `add_months(day, n)` | the same day n months later, kept inside the month (`2026-01-31` plus 1 is `2026-02-28`) |
| `month_start(day)`, `month_end(day)` | first and last day of the month |
| `day(day)`, `month(day)`, `year(day)` | day of month, month 1 to 12, year |
| `age_on(day)` | the employee's age in whole years on day (a 29 February birthday counts from 1 March in other years) |
| `periods()` | `run.periods_per_year` |
| `prorate(x)` | x times `run.worked_days` / `run.working_days_in_period` |
| `len`, `upper`, `lower`, `trim` | text length, capitals, small letters, without outer spaces |
| `substr(text, start, count)` | part of the text from start (0 based), count characters (default to the end) |
| `starts_with`, `ends_with`, `contains` | true/false tests on text |
| `digits(text)` | only the digits, in order (`digits("SK475")` is `"475"`) |
| `is_number(text)` | true for a plain decimal such as `1257` or `-3.5` (not `1e3`, not `1,000`) |
| `num(text)` | the number in a plain decimal text (error otherwise) |
| `text(x)` | a number or true/false as text |

## 5. Tables

### 5.1 Brackets (progressive tax)

Rows go up by their lower bound. A table uses one bound key for every row: `over` (the row applies to amounts strictly over it, as in Japan's 別表 "162,500円以下" and most "over X but not over Y" tables) or `from` (the row applies from it, as in IRS "At least A but less than B").

| Rows have | `table(name, x)` gives |
|---|---|
| `{ over, rate }` | the sum over rows of (min(x, next bound) - bound) x rate |
| `{ from, rate, base }` | `base + (x - from) x rate` for the one row containing x (the official rounded column C is used as printed) |
| `{ over, rate, less }` | `x x rate - less` for the row containing x (quick deduction tables: Japan 別表第四, India, Korea) |

Mixing `base` and `less`, or rows with and without them, is an error. Below the first bound the result is 0. For "x times rate plus a constant" tables that are not taxes on bands (Japan 別表第一), use a band table with two columns and write the formula.

### 5.2 Bands (a row per range)

```js
{ type: 'bands', rows: [
  { to: 10, values: { ee: 0, er: 0 } },          // open below
  { over: 10, to: 20, values: { ee: 3, er: 3 } }, // over excludes, to includes
  { from: 63000, under: 73000, value: 68000 },     // from includes, under excludes
  { over: 20, values: { ee: 5, er: 6 } }           // open above
] }
```

Each row has one lower bound (`from` includes it, `over` excludes it; only the first row may have none) and one upper bound (`to` includes it, `under` excludes it; only the last row may have none), and a `value` or `values` columns (numbers, text or true/false). Rows must go up without overlapping. A value that falls in a gap between rows is an error (not a guess). Lookups use binary search, so official tables with thousands of rows are fine (limit 20,000 rows).

### 5.3 Maps

```js
{ type: 'map', rows: { '13': { health: 0.0985, care: 0.0162 }, '27': { health: 0.1013, care: 0.0162 } }, default: { ... } }
```

`map(name, key)` reads a number or text row; `map(name, key, column)` reads a column of an object row. A missing key uses `default` when the table has one, else it is an error.

### 5.4 What the checker can see

`validate` follows table names, columns and keys through literals, joins, both branches of conditions, enum field options, `run.kind`, `run.frequency` and earlier vars. A literal name that does not exist is an error. A value listed from options or `run.frequency` that a table lacks is a warning (a payslip with that value would stop with an error): add the row, a `default`, or a check step that refuses the case first.

## 6. Output

```js
{ engine: '1.0.0', phase: 'steps' | 'year_end',
  lines: [{ code, name, kind, stage, amount, qty, rate, base, tags, source: 'input'|'pack', pack, pack_version,
            step, phase: ''|'year_end', sort, payee, filing, explain, ref?, component? }],
  totals: { gross, pre, statutory, post, deductions, employer, reimbursement, net, employer_cost },
  issues: [{ severity: 'blocker'|'warning', code, message, pack?, version?, step?, field?, ... }],
  vars: { <packCode>: { <name>: value } },
  explain: { packs: [{ code, version, order, basis_day, tax_year_start, tax_year_end, period_index, periods_remaining, periods_paid, skipped }],
             vars: { <packCode>: { <name>: { expr, value, reads, tables?, when?, note? } } } },
  hash: '16 hex digits' }
```

- Input lines come first in their order, then pack lines in step order. `sort` is the input line's sort (or its index), and `order x 1000 + step index` for pack lines (+500 for year-end steps).
- `net = gross - (pre + statutory + post) + reimbursement`; `employer_cost = gross + employer + reimbursement`. Info lines are in no total. A deduction input line with an empty stage counts as `post`.
- Each pack line's `explain`: `{ expr, when?, value (before rounding), rounded: { mode, step }, reads: [{ name, value }], tables?: [...], note? }`. `reads` lists every name and function result the step read, in order, with its value (`profile.filing_status`, `sum("fit_wages")`, `ytd_code("US_SS")`, vars). `tables` lists each lookup: `{ fn: 'table', table, x, value, rows: [{ over|from, rate, part|base|less }] }`, `{ fn: 'band', table, x, column, value, row: { row, from|over, to|under } }`, `{ fn: 'map', table, key, column, value, default? }`. A var's explanation is under `explain.vars`, so the screen can open a figure into the values it came from.
- `hash` fingerprints the figures: every line (code, kind, stage, amounts, pack, version, step, tags, names), the totals, the issues and the vars. The explanations come from the same input and are not hashed. Identical in Node and PocketBase.

### 6.1 Issue codes

| Code | Severity | When |
|---|---|---|
| `input_invalid` | blocker | the input does not match section 9 (nothing runs) |
| `pack_invalid` | blocker | the pack's tables or formulas are broken (it does not run) |
| `pack_duplicate` | blocker | the same pack code given twice |
| `pack_missing` | blocker | a pack in `requires` is not in the calculation |
| `pack_not_in_force` | blocker | the pack's dates do not cover its basis day |
| `field_conflict` | blocker | two packs declare one field with different types |
| `profile_missing`, `entity_missing` | blocker | a required field has no value |
| `profile_invalid`, `entity_invalid` | blocker | a value does not fit the field |
| `history_short` | blocker | the history starts after a tax year start the pack reads |
| `step_error` | blocker | a step failed: `pack`, `version`, `step` (index), `phase`, `name`, `field` (`when`, `expr`, `else`, `amount`, `qty`, `rate`, `base`, `check`) and `error` (`expr_name`, `expr_type`, `expr_math`, `expr_table`, `expr_limit`); that pack stops, other packs go on |
| `negative_net` | blocker | net pay below zero |
| `zero_gross` | warning | gross is 0 (not for reimbursement runs or year-end runs) |
| `below_min_wage` | warning | a regular run where `context.hours_worked` is known and gross per hour is below the highest of `context.min_wage_hourly` and the packs' `min_wage.hourly` (never on bonus, off-cycle, termination, correction or reimbursement runs) |
| pack `issue` codes | as declared | check steps |

## 7. Patterns

Ceiling per period and per year, with a tracker line that later payslips read:

```js
{ var: 'capped', expr: 'min(sum("social_wages"), 6000)' },
{ var: 'room', expr: 'max(0, 60000 - ytd("social_counted"))' },
{ var: 'base', expr: 'min(capped, room)' },
{ code: 'XX_SOCIAL_BASE', name: 'Wages counted for social insurance', kind: 'info', amount: 'base', tags: ['social_counted'] },
{ code: 'XX_SOCIAL', name: 'Social insurance', kind: 'deduction', stage: 'statutory', amount: 'base * 0.05', base: 'base', rate: '0.05' }
```

Annualise with what is already withheld (India TDS, Malaysia PCB):

```js
{ var: 'projected', expr: 'ytd("taxable") + sum("taxable") * (run.periods_remaining + 1)' },
{ var: 'annual_tax', expr: 'table("slab_" + profile.regime, projected)' },
{ code: 'IN_TDS', name: 'Income tax (TDS)', kind: 'deduction', stage: 'statutory',
  amount: 'max(0, (annual_tax - ytd_code("IN_TDS")) / (run.periods_remaining + 1))', round: { mode: 'half_up', step: 1 } }
```

A different rule on bonus runs: `when: 'run.kind == "bonus"'` on one step and `when: 'run.kind != "bonus"'` on the other.

Age bands that change the month after a birthday: `band("cpf_rate", age_on(add_days(month_start(run.period_end), -1)), "ee")`.

Japan's employee share rounding: `round: { mode: 'half_down', step: 1 }`. Japan's withholding to the nearest 10 yen: `round: { mode: 'half_up', step: 10 }`.

An employer-wide rate: declare `{ key: 'sui_rate', scope: 'entity', type: 'number', ... }` and write `entity.sui_rate`.

Refuse what the pack does not cover: `{ check: 'run.frequency == "monthly"', severity: 'blocker', issue: 'jp_frequency_unsupported', message: 'The electronic withholding rule in this pack covers monthly pay only' }`.

A complete small pack is `packs/generic.js` (the "set by you" template): flat income tax and contributions with ceilings, ten vectors.

## 8. Limits and safety

- No `eval`, no `Function`, no loops, no clock, no access to anything outside the names above. Names may not contain `__proto__`, `prototype` or `constructor`; dotted names must start with a root.
- A formula is at most 4,000 characters, nested at most 40 levels, with at most 64 arguments per call; joined text at most 10,000 characters; a table at most 20,000 rows. Division or remainder by zero, overflow and NaN are `expr_math` errors.
- Formulas are parsed once per text and compiled to closures; a pack's tables are indexed once per pack object (the 1,000 payslips of a pay run share the work). Measured: 1,000 payslips with three packs in about 0.2 s in Node; 300 payslips in about 0.7 s in PocketBase.

## 9. How payroll builds the input

One input per payslip. Every field below is checked; a wrong input gives `input_invalid` and nothing runs.

```js
{
  run: {
    kind: 'regular',                 // regular | off_cycle | bonus | termination | correction | reimbursement
    period_start: '2026-06-01', period_end: '2026-06-30', pay_date: '2026-06-25',
    frequency: 'monthly',            // monthly | semi_monthly | biweekly | weekly
    periods_per_year: 12,            // whole number (12, 24, 26, 52; 53 or 27 when the year has them)
    days_in_period: 30, working_days_in_period: 22, worked_days: 22,   // numbers, 0 or more
    year_end: false                  // true on the run that carries the year-end adjustment
  },
  employee: { id, birth_date, age, hire_day, end_day, nationality, gender, years_of_service },
  employment: { id, entity_country, entity_region, work_country, work_region, fte, employment_type },
  profile: { <employee field key>: value },   // tax_profiles.fields as of the period (effective dated)
  entity: { <entity field key>: value },      // the employer's settings for its enabled packs
  currency: { code: 'JPY', exponent: 0 },     // lib_money.exponent(code)
  lines: [{ code, name, kind, stage, amount, qty, rate, base, tags: [...], sort, ref, component }],
  history: [{ id, kind, pay_date, period_start, period_end, by_tag: { tag: amount }, by_code: { code: amount } }],
  history_from: '2025-01-22',
  context: { min_wage_hourly, hours_worked, ...free data }
}
```

- `run`: do not send `period_index`, `periods_remaining`, `first_period_of_year` or any tax year field: the engine computes them for each pack from that pack's tax year and date basis. Use `engine.taxYearOf(pack, day)` and `engine.periodInfo(pack, run)` when a screen needs them.
- `lines`: everything the packs do not compute, in major units with signs as on the payslip: earnings (basic pay prorated by payroll or by a component formula, overtime from `lib_time.payInputs`, unpaid leave as a negative earning or a reduced basic), pre-tax and post-tax deductions (pension, loans, advances), reimbursements (`lib_expenses.payInputs`), recurring items and one-off pay inputs. Put each component's `tags` on its line; they are how packs find taxable and contributory pay. `ref` and `component` pass through to the output.
- `history`: every locked, not void payslip of this employment with a pay date in the `HISTORY_DAYS` (550) days before this run's pay date, all kinds, one entry each. `by_tag` sums the payslip's stored lines by every tag they carry (input and pack lines, so store `tags` on `payslip_lines`); `by_code` sums by code. Add a `kind: 'opening'` entry for balances carried in from before HR OS or from a previous employer (UK P45, Japan 前職分, US mid-year start) dated on the go-live day. Lines of a payslip in another currency do not belong in this employment's history.
- `history_from`: the later of (pay date minus 550 days) and the employment's start day. The engine raises `history_short` if a pack reads a tax year that starts before it while the person was already employed.
- `profile` and `entity`: send raw stored values; the engine applies each field's default and type. Send only the fields of the packs in the calculation (extra keys are ignored).
- Packs: load the active `rule_packs` rows for the entity's enabled codes, then `engine.pickVersions(rows, run)` keeps the version in force on each pack's basis day. The pack body is the stored JSON.

### 9.1 Storing the output

- Convert each line amount to minor units with `lib_money` (exact, the engine already rounded to the currency unit). Store `code, name, kind, stage, amount_minor, qty, rate, base_minor, pack, pack_version, step, explain, sort` and the line's `tags` on `payslip_lines`; store the payslip totals (`gross`, `deductions`, `employer`, `net`), `issues`, `hash` and the `explain` (packs and vars) on `payslips`.
- A run with any blocker issue cannot be approved. Warnings are shown and kept on the locked run.
- Locking keeps the hash; recalculating a locked payslip's stored input must give the same hash.
- For the pack editor and your AI agent's drafts, `engine.preview(pack, partialInput, others)` fills defaults like a vector.

### 9.2 Activating a pack

A pack row becomes `active` only when `lib_packcheck.validate(pack, others)` returns no `error` and `runVectors(pack, others)` passes every vector (store `vectors_passed`, `vectors_total`, `tested_at`). A person with the approval PIN activates it; your AI agent may draft (`source: 'agent'`) but never activates.

## 10. Vectors

```js
{ name: 'monthly single, 2026 Pub 15-T Worksheet 1A example', source: 'official', reference: 'Pub 15-T 2026 p. 7 example 1',
  input: { lines: [...], profile: {...}, entity: {...}, run: {...}, history: [...], currency: {...}, context: {...} },
  expect: { US_FIT: 123.45, US_SS: 310 },     // line codes (an absent line counts as 0)
  expect_vars: { annual_wages: 60000 },       // this pack's vars
  expect_totals: { net: 4321.09 },
  expect_issues: ['us_w4_pre2020_hoh'],       // codes that must appear; any other blocker fails the vector
  packs: ['us-federal'] }                     // extra packs for this vector (required packs are added anyway)
```

- `source`: `official` (a published worked example) or `derived` (worked out by hand from the official rules; say how in `reference`).
- Defaults (`engine.completeInput`): a regular monthly run for the first full month the pack is in force (pay date = period end, 21 working and worked days), currency from the pack (or USD for a template), no lines, empty history complete since 1900, employee born 1990-01-01 hired 2020-01-01. Give `run.period_start` and the rest moves with it unless you set them.
- Lines compare to the currency unit; vars compare exactly (to 1e-9).

## 11. The runner

```
node tools/packs/test.mjs                     every pack in pb/pb_hooks/packs
node tools/packs/test.mjs jp sg               only these codes; "us-*" matches a prefix
node tools/packs/test.mjs --hooks <dir>       packs from <dir>/packs
node tools/packs/test.mjs --engine <dir>      engine files from <dir>
node tools/packs/test.mjs --verbose           warnings and the lines of failing vectors
node tools/packs/test.mjs --json              the report as JSON
```

It validates each pack against all loaded packs, runs its vectors on a JSON copy (as payroll reads it), checks versions of one code do not overlap and every `requires` exists, and exits 1 on any error, failed vector or file that does not load.

## 12. Changes from BUILD_SPEC section 7

1. Input `ytd` is replaced by `history` (earlier payslips by tag and code) plus `history_from`; the engine derives year-to-date figures per pack tax year, so payroll and packs never disagree on tax years. `payslip_lines` needs a `tags` field.
2. `run.period_index`, `run.periods_remaining` and `run.first_period_of_year` are computed per pack; `periods_remaining` counts the periods after this one. Added `run.basis_day`, `tax_year_start`, `tax_year_end`, `tax_week`, `tax_month`, `periods_paid`, and the pack key `date_basis`.
3. Entity-level fields: `profile_fields` with `scope: 'entity'`, read as `entity.<key>` from `input.entity`.
4. A third step kind, `check`, for pack-authored blockers and warnings.
5. `year_end_steps` (pack key) and `run.year_end`; `yearEnd(input, packs)`.
6. Brackets rows use `over` or `from` and may carry `base` or `less`; bands use `from`/`over` and `to`/`under`; maps may have a `default`.
7. Rounding modes add `half_down` (Japan's 50 sen rule); there is no `half_down_50sen`.
8. The min wage warning compares gross per hour (not net) with the reference, on regular runs with known hours only.
9. Output adds `vars`, `explain.packs` and `explain.vars`; each line carries its own `explain`; totals add `employer_cost`; `hash` covers the figures.
10. Functions beyond 7.4: `round_half_down`, `total`, `ytd_since`, `ytd_code_since`, `prev_regular`, `prev_regular_code`, `has_prev_regular`, `prev_regular_date`, `regular_in_month`, `regular_in_month_code`, `regular_count_in_month`, `months_between`, `add_days`, `add_months`, `month_start`, `month_end`, `day`, and the text functions.

## 13. Functions added on request

| Date | Function or feature | Asked by | Why |
|---|---|---|---|
| 2026-11-04 | `from` brackets with `base` | packs-west W1 | IRS "at least" tables with printed column C |
| 2026-11-04 | `entity.<key>` fields | packs-west W2 | employer rates (SUI, FUTA credit reduction, levies) |
| 2026-11-04 | text functions | packs-west W3 | UK PAYE tax codes |
| 2026-11-04 | `run.tax_week`, `run.tax_month`, `day()` | packs-west W4 | UK cumulative PAYE periods |
| 2026-11-04 | `check` steps | packs-west W9, packs-asia A2 | refuse unsupported cases |
| 2026-11-04 | `ytd_since`, `ytd_code_since` | packs-asia A3 | Japan fiscal year bonus caps |
| 2026-11-04 | `prev_regular`, `prev_regular_code`, `has_prev_regular`, `prev_regular_date` | packs-asia A4 | Japan bonus withholding |
| 2026-11-04 | `month_start`, `month_end`, `add_months` | packs-asia A5 | CPF and nursing care month rules |
| 2026-11-04 | `year_end_steps`, `run.year_end` | packs-asia A7 | 年末調整, India March true-up |
| 2026-11-04 | `regular_in_month`, `regular_in_month_code`, `regular_count_in_month` | packs-asia A9 | Japan bonus withholding reads the previous calendar month's pay |
