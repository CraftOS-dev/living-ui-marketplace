# Engine builder notes

Built 2026-11-04. The full language reference and the payroll input contract are in `reference/ENGINE.md`; section 12 lists every change from BUILD_SPEC section 7.

## What is here

| File | Purpose |
|---|---|
| `pb/pb_hooks/lib_expr.js` | Formula language: character-scanning tokenizer (Goja's sticky regex flag does not work), Pratt parser, AST compiled to closures, 57 functions, decimal-safe rounding (5 modes, any step), brackets/bands/map tables, day arithmetic, limits |
| `pb/pb_hooks/lib_engine.js` | `calculate`, `yearEnd`, `preview`, `completeInput`, `periodInfo`, `taxYearOf`, `basisDay`, `pickVersions`, `plan`, `fingerprint`, `hash`, `stableStringify`, `exponentOf`, `constants` |
| `pb/pb_hooks/lib_packcheck.js` | `validate(pack, others)`, `runVectors(pack, others)`, `checkSet(packs)`, `requiredPacks` |
| `pb/pb_hooks/packs/generic.js` | The "set by you" template pack (flat income tax, flat contributions with period and yearly ceilings), 10 vectors, ships active |
| `tools/packs/test.mjs` | Pack runner: `node tools/packs/test.mjs [codes] [--hooks dir] [--engine dir] [--verbose] [--json]` |
| `reference/tests/engine/` | 76 test groups (`node reference/tests/engine/run.mjs`) and the benchmark (`node reference/tests/engine/bench.mjs`) |

No operations, migrations or UI: the engine is a library. Payroll owns the ops that call it (`payruns.calculate`, `packs.preview`, `packs.activate`).

## Decisions

- Formulas compile once per text into closures; tables are indexed once per pack object (WeakMap), so a pay run parses each pack once.
- Strict typing: arithmetic on "no value", text compared with numbers, and non-boolean conditions are errors, so pack mistakes surface in vectors instead of as quiet zeros.
- Every value is snapped to 15 significant digits before rounding, floor, ceil, comparisons and table lookups, so binary noise never changes a figure (1.005 rounds to 1.01; the NYC 188.795 example rounds to 188.80).
- A pack whose own fields are missing or invalid does not run; the field issue is the only message.
- On a step error the pack stops and other packs go on; the payslip is blocked.
- YTD comes from `input.history` (earlier payslips by tag and code) and is computed by the engine per pack tax year and date basis, so payroll never computes tax years itself.
- The output hash fingerprints the figures token by token with cached text hashes. Hashing the full stringified output cost 83% of the run time in Goja (about 1 microsecond per character there).

## Performance (measured)

- Node 24: 1,000 payslips with three packs (bands, maps, brackets, YTD annualisation, 12 lines each) in 0.15 to 0.2 s.
- PocketBase 0.39.6 (Goja), scratch hook on port 3197: 300 payslips in 0.66 to 0.92 s (2.2 to 3.1 ms each) over six runs with the shipped files; 1.4 to 2.2 s while the machine's CPU was at 100% from other work. The same 300 hashes as Node, so results are identical across runtimes. Before the hash and allocation work it was 7.2 s.
- Gate on a scratch copy of APP with these files: migrations, operations, triggers, hooks and egress steps pass (no hosts from engine files); the type and build steps could not run there because that copy has no frontend node_modules.
- `node tools/gen.mjs` in APP after copying: 154 operations from 6 catalog files, exit 0 (the engine adds no operations).

## Contract changes (see ENGINE.md section 12)

1. `ytd` input replaced by `history` + `history_from`; `payslip_lines` needs a `tags` field so payroll can build `history[].by_tag`.
2. `run.period_index`, `periods_remaining` (periods after this one), `first_period_of_year` are computed per pack; added `run.basis_day`, `tax_year_start`, `tax_year_end`, `tax_week`, `tax_month`, `periods_paid` and the pack key `date_basis`.
3. Entity fields: `profile_fields[].scope: 'entity'`, read as `entity.<key>` from `input.entity`.
4. `check` steps, `year_end_steps` with `run.year_end`, brackets `from`/`over` with `base`/`less`, bands `from`/`over`/`to`/`under`, map `default`, rounding mode `half_down` (no `half_down_50sen`).
5. The minimum wage warning compares gross (not net) per hour, on regular runs with known hours only (fixed 2026-11-04 after backend QA: it fired on bonus-only payslips).

## For the kernel (lib_countries.seedPacks), not changed by me

- It requires `problems.length === 0`, but `validate` also returns warnings: filter `level === 'error'`, or most packs (for example us-ca, gb, jp) are seeded as drafts.
- Call `validate(pack, packs)` with the other built-in packs: state packs read fields and lines of the packs they require, and without them `validate` reports unknown names.
- Skip files whose names start with `_` (pack helpers), as the runner does.

## For payroll

- Build the input exactly as ENGINE.md section 9; use `pickVersions` to choose pack versions, `preview` for the pack editor, `validate` errors plus `runVectors` for activation.
- Store line `tags` on `payslip_lines`, keep `hash`, and convert line amounts with `lib_money` (the engine has already rounded to the currency unit).

## Known gaps

- No sub-period splitting (mid-period pay changes): payroll passes prorated lines or two lines; the engine sums what it is given.
- `context` keys beyond `min_wage_hourly` and `hours_worked` are free data; the checker warns when a pack reads one.
