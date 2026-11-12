# Craft Sheets

> Per-project plan, context and index. Keep it current with every change.

## Plan

Craft Sheets is a small Excel-style spreadsheet that runs in the browser: one
workbook of named sheets (tabs along the bottom), each an editable grid of
cells holding text, numbers and live formulas (`=SUM(B2:B9)`). A toolbar on top
adds sheets, rows and columns, formats cells, finds and replaces, and imports or
exports CSV and Excel files; a formula bar shows the selected cell's raw content.
There are no accounts: everyone who opens the app works on the same workbook.

The screen is the unchanged V1 View. It talks to PocketBase through a fetch shim
(`frontend/src/app/services/apiAdapter.ts`) that stores each sheet as one record
of the `sheets` collection and computes every formula in the browser
(`services/formula.ts`, a port of the V1 Python engine — no spreadsheet
library). An AI agent works on the same workbook through the 26 operations
below. They run server-side ports of the View's own code, so an agent sees the
same values and stores exactly what the screen would store:
`pb/pb_hooks/lib_agent_formula.js` (formula.ts), `lib_agent_grid.js` (grid.ts and
the Find & Replace logic), `lib_agent_csv.js` (fileio.ts with SheetJS 0.18.5's CSV
reading and writing), glued by `lib_agent.js`; routes in `agent_ops.pb.js`.

The app asks the agent for nothing (`events.json` declares no tasks); the agent
acts when the person asks it to. `a2app <app> app app.guide` returns a short
version of this file.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `app` | 1 | — |
| `sheets` | 8 | — |
| `cells` | 9 | — |
| `rows` | 4 | — |
| `columns` | 4 | — |

## Entities

No collection is offered as a raw entity: `sheets` is hidden from `a2app <app>
data …`, and agents use the operations only. A raw write could store a cell in
a shape the screen cannot read (its Find dialog and row/column inserts crash on
it), and a list would return every sheet's whole cell map.

For orientation, each sheet tab is one `sheets` record:

| Field | Meaning |
|-------|---------|
| `sid` | The sheet's integer **id** (what every `sheet` param takes, alongside the name). Assigned as the highest id + 1. |
| `name` | Tab label, up to 255 characters. Names may repeat. |
| `columns` | Ordered list of `{name, type, width}`. Position gives the letter (A, B, … Z, AA). `name` is only the header label; `type` is `text`, `number`, `date` or `currency`; `width` is px (at least 64). |
| `num_rows` | Row count (at least 1). |
| `cells` | Map from an upper-case reference (`B3`) to `{raw}` or `{raw, format}`. |
| `row_heights` | Heights in px of resized rows (at least 20; default 28). |
| `frozen_rows`, `frozen_cols` | 0 or 1. |
| `position` | Tab order: the number of sheets when it was created. Nothing reorders tabs. |

Computed values are never stored: the screen and the operations both compute
them from `raw` on every read.

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs on the server in the app's own code: the handler its screens use where they call one, otherwise a server copy of exactly what the screens do.

### app

- `app.guide` *(read-only)* — How sheets, cells, formulas and ranges work in this app, the supported functions and error codes, and what the person sees.

### sheets

- `sheets.list` *(read-only)* — The sheet tabs in order, with their size and last change.
- `sheets.get` *(read-only)* — One sheet's structure: columns (name, type, width), rows, frozen panes, row heights, used range, counts. Params: `sheet` (string).
- `sheets.create` — Add a sheet tab of 12 empty text columns × 30 rows, as New / + Sheet does. Params: `name` (string).
- `sheets.rename` — Rename a sheet tab. Params: `sheet` (string), `name` (string, required), `if_updated` (string).
- `sheets.delete` *(destructive)* — Delete a sheet tab and all its cells. Deleting the last tab leaves a fresh empty "Sheet 1". Params: `sheet` (string), `if_updated` (string).
- `sheets.freeze` — Freeze or unfreeze the header row and/or the first column. Params: `sheet` (string), `first_row` (boolean), `first_column` (boolean), `if_updated` (string).
- `sheets.import-csv` — Create a new sheet from CSV text, as Import does for a .csv file (at most 5,000 rows × 256 columns; the rest is cut). Numbers, TRUE/FALSE and =formulas are read as the app reads them. Dates: only YYYY-MM-DD and YYYY-MM-DD HH:MM[:SS] become the app's date serial numbers (server time zone); every other date-like text stays text. Params: `csv` (string, required), `name` (string).
- `sheets.export-csv` *(read-only)* — A sheet as CSV values (not formulas), as the CSV button writes it; the app's file also starts with a UTF-8 byte-order mark. Params: `sheet` (string).

### cells

- `cells.read` *(read-only)* — What the grid shows for a range: raw text, computed value or error, display text, format. Params: `sheet` (string), `range` (string), `view` (cells|grid), `limit` (number), `offset` (number).
- `cells.find` *(read-only)* — Find cells whose raw text (formulas included) contains a string, as Find does. Params: `sheet` (string), `query` (string, required), `match_case` (boolean).
- `cells.set` — Type values or formulas into cells, as in a cell or the formula bar; an empty value clears a cell (its formatting stays). Params: `sheet` (string), `ref` (string), `raw` (string), `cells` (json), `if_updated` (string).
- `cells.paste` — Paste a block of values from a start cell, as pasting text does; the grid grows to fit and existing formatting stays. Params: `sheet` (string), `start` (string, required), `text` (string, required), `if_updated` (string).
- `cells.clear` — Clear the contents of cells and keep their formatting, as the Delete key does. Params: `sheet` (string), `range` (string, required), `if_updated` (string).
- `cells.format` — Set bold, italic, underline, alignment, fill colour or font colour on cells. Params: `sheet` (string), `range` (string, required), `bold` (boolean), `italic` (boolean), `underline` (boolean), `align` (left|center|right), `fill` (string), `font_color` (string), `if_updated` (string).
- `cells.fill` — Drag-fill down or right like the fill handle: number steps continue, formula references shift, text repeats. Params: `sheet` (string), `source` (string, required), `to` (string, required), `if_updated` (string).
- `cells.copy` — Copy cells (values, formulas as written, formatting) to another place or tab, like Ctrl+C then Ctrl+V; the grid grows to fit. Params: `sheet` (string), `from` (string, required), `to` (string, required), `to_sheet` (string), `if_updated` (string).
- `cells.replace` — Replace text inside cells' raw content, as Find & Replace does: one cell (ref) or all matches. Params: `sheet` (string), `find` (string, required), `replace_with` (string), `match_case` (boolean), `ref` (string), `if_updated` (string).

### rows

- `rows.add` — Add empty rows at the bottom. Params: `sheet` (string), `count` (number), `if_updated` (string).
- `rows.insert` — Insert empty rows above or below a row; cells, row heights and formula references shift. Params: `sheet` (string), `row` (number, required), `side` (above|below, required), `count` (number), `if_updated` (string).
- `rows.delete` *(destructive)* — Delete rows and their cells; formulas that pointed at them show #REF!. A sheet keeps at least one row. Params: `sheet` (string), `row` (number, required), `count` (number), `if_updated` (string).
- `rows.resize` — Set a row's height in pixels (at least 20). Params: `sheet` (string), `row` (number, required), `height` (number, required), `if_updated` (string).

### columns

- `columns.add` — Add empty text columns at the right. Params: `sheet` (string), `count` (number), `if_updated` (string).
- `columns.insert` — Insert empty columns left or right of a column; cells and formula references shift. Params: `sheet` (string), `column` (string, required), `side` (left|right, required), `count` (number), `if_updated` (string).
- `columns.delete` *(destructive)* — Delete columns and their cells; formulas that pointed at them show #REF!. A sheet keeps at least one column. Params: `sheet` (string), `column` (string, required), `count` (number), `if_updated` (string).
- `columns.update` — Rename a column header, change its type (display only) or its width in pixels (at least 64). Params: `sheet` (string), `column` (string, required), `name` (string), `type` (text|number|date|currency), `width` (number), `if_updated` (string).

### Addressing sheets, cells and ranges

- **`sheet`** takes the integer id from `sheets.list`, the 15-character record id, or the exact tab name (case-sensitive). A number is tried as an id first. Several tabs can share a name (the app names new tabs "Sheet N" by count), so an ambiguous name answers 409 with the candidate ids: use an id. With exactly one sheet in the workbook, `sheet` may be left out; otherwise leaving it out answers 400 with the list of tabs.
- **Cells** are A1 references: column letters by position, rows counted from 1. Lower case is accepted (`b3` → `B3`); `$` is refused. Rows in params (`row`) are those 1-based numbers; columns (`column`) are letters.
- **`range`** is a cell (`B3`), a rectangle (`A1:C5`, either corner first), or a comma list of them (`A1:C1,E5`), like a dragged selection plus Ctrl-clicked cells.
- **Bounds:** every reference must lie inside the grid (`sheets.get` gives its size). A person cannot select outside it either. To write past the edge, add rows or columns first, or use `cells.paste` / `cells.copy`, which grow the grid as a paste does.

### Reading what the person sees

- **Three layers per cell:**
  - `raw` is exactly what was typed and what the formula bar shows: `=B2*C2`, `1.50`, `Hello`;
  - `value` is the computed result (number, text or true/false), or `error` holds a code such as `#DIV/0!`;
  - `shown` is the text in the grid cell: the error code, or the value formatted by its column's type (number and currency columns group thousands; currency is US dollars, `$1,234.50`; booleans read TRUE/FALSE). **`shown` is rendered en-US**; the person's browser formats with its own locale, so trust `value` for numbers.
- `cells.read --view grid --range A1:F20` returns rows of `shown` text (the picture the person sees), plus maps of the `formulas`, `errors` and `formats` in that rectangle. It takes one rectangle of at most 5,000 cells.
- `cells.read` (the default `cells` view) lists every stored cell in the range row by row with `raw`, `value` or `error`, `shown` and `format`. Pages are `limit` (default 500, max 5,000) and `offset`; `total` and `truncated` tell you when there is more. With no `range` it reads the used range. Stored cells include format-only cells with empty `raw`.
- `sheets.get` gives the structure: columns with letter, name, type and width; row count; frozen panes; row heights (1-based rows); the used range; and the cell, formula and error counts.

### Doing the common jobs

- **Look around:** `a2app <app> sheets sheets.list`, then `a2app <app> sheets sheets.get --sheet 2` and `a2app <app> cells cells.read --sheet 2 --view grid --range A1:H30`.
- **Type values or formulas:**
  - one cell: `a2app <app> cells cells.set --sheet 2 --ref D2 --raw "=B2*C2"`;
  - several at once: `--cells '{"A1":"Item","B1":"Price","D9":"=SUM(D2:D8)"}'`.
  - Write values as JSON strings to keep them exactly as typed (`"1.50"`, `"007"`): a JSON number is converted to text (`1.50` → `1.5`).
  - An empty value clears a cell and keeps its formatting.
  - Line breaks are dropped, as in the cell editor.
  - The result lists each changed cell with `before`, `after`, and its new `value` or `error`. A formula is never refused; check `error` in the result.
- **Fill in a table:** `cells.paste --start A2 --text @rows.tsv`. The text is rows separated by line breaks and cells by tabs, exactly what a clipboard carries; trailing empty rows are dropped. The grid grows to fit, and existing formatting stays. Pass the block from a file with `--text @path`, or from standard input with `--text @-`; such values arrive verbatim, never converted to numbers.
- **Continue a series or a formula down a column:** `cells.fill --source D2 --to D20`.
  - It drags the fill handle, so only down or right from the source.
  - A single number counts up by 1; two or more numbers in one row or column continue their step.
  - Formulas shift their references cell by cell (`=B2*C2` → `=B3*C3`); a shift past column A or row 1 gives `#REF!`.
  - Anything else repeats. Formatting is copied.
- **Copy a block:** `cells.copy --from A1:D9 --to F1` (add `--to_sheet 3` for another tab). This is the app's own copy and paste:
  - values and formatting arrive unchanged;
  - **formulas are copied as written, not shifted**: use `cells.fill` when you want shifted references;
  - an empty source cell without formatting empties the target cell;
  - the target's formatting is replaced.
- **Format:** `cells.format --range A1:D1 --bold true --fill "#fff2cc"`.
  - Bold, italic and underline take true or false; `align` takes `left`, `center` or `right`.
  - `fill` and `font_color` take `#rrggbb` (stored lower case) or `none`.
  - Without an alignment, number and currency columns align right and others left.
  - A cell with a fill and no font colour shows dark text.
- **Columns:**
  - `columns.update --column B --name Price --type currency --width 140`. The type only changes how values display; it never validates input, and `date` has no date formatting.
  - `columns.add --count 2` appends text columns named by their letter. If another column already has that name (after a rename or a delete), the new column takes the next letter no column has, so names never repeat. Columns that `cells.paste` and `cells.copy` add to fit are named the same way.
- **Insert or delete rows and columns:**
  - `rows.insert --row 5 --side above --count 2` and `columns.insert --column C --side right`.
  - `rows.delete --row 7` and `columns.delete --column E` are destructive, so the person approves each call.
  - Cells move. Formula references are rewritten: references at or past an insertion shift; a reference to a deleted row or column becomes `#REF!` (`=SUM(B2:B9)` with row 9 deleted becomes `=SUM(B2:#REF!)`, which shows `#ERROR!`); later references shift.
  - An inserted column is named by its letter, as every new column is. Columns after it that are still named by their letter take their new letter, and the result lists them as `renamed`; if another column already has the inserted column's letter as its name, the new one takes the next letter no column has.
  - The result lists `rewritten` formulas (before and after) and, for deletes, the `removed` cells, so you can rebuild them.
- **Find and replace:**
  - `cells.find --query total` searches raw text, formulas included (`B2` matches `=B2*C2`), ignoring case unless `--match_case true`. It lists matches row by row.
  - `cells.replace --find Pear --replace_with Peach` replaces in every match (Replace All); add `--ref A3` to replace in one matching cell only. A cell left empty is cleared.
- **Import CSV:**
  - `sheets.import-csv --csv @data.csv --name "Sales"` (or `--csv @-`) creates a new tab, as Import does for a .csv file.
  - The separator (`,` `;` tab `|`) is detected, and a `sep=;` first line is honoured.
  - Values are read as the app reads them:
    - `TRUE`/`FALSE` become `true`/`false`;
    - numbers are normalised (`1,000` → 1000, `$5` → 5, `50%` → 0.5, `(3)` → -3, `007` → 7, `0x10` → 16);
    - `="text"` is text, and `=…` is a formula.
  - **Dates:** only `YYYY-MM-DD` and `YYYY-MM-DD HH:MM[:SS]` (with a space) become the date serial numbers the app produces for them, in the server's time zone. A date alone is midnight UTC, so it has a fraction of a day in other zones: `2024-01-05` becomes `45296.375` at UTC+9. Every other date-like text stays text. The app's own Import would turn some of those into numbers as well.
  - At most 5,000 rows × 256 columns are kept; `truncated` says what was cut.
  - Text that starts with `<` is refused (the app's importer reads it as XML or HTML).
  - The default name is "Imported".
- **Export CSV:** `sheets.export-csv --sheet 2` returns `filename` and `content`, exactly what the CSV button writes, without its leading byte-order mark:
  - computed values, not formulas; error cells export their code;
  - every row and column of the grid, trailing empty ones included;
  - numbers in spreadsheet "General" format.
- **Sheets:**
  - `sheets.create` makes "Sheet N", 12 text columns × 30 rows (`--name` to choose); `sheets.rename`; `sheets.freeze --first_row true --first_column false`.
  - `sheets.delete` is destructive. Deleting the last tab leaves a fresh empty "Sheet 1", as the screen does.

## Conventions

### Formula language

Text starting with `=` is a formula; anything else is shown as typed. A literal reads as true/false (any case), a number (`42`, ` 42 `, `1e3`, `-3.5`; also `inf` and `nan`, which show the value `#NUM!`), or text.

- **References:** `A1`, ranges `A1:B5` (either corner first, any case). There are no `$` absolute references, no other-sheet references (`Sheet2!A1`) and no named ranges: these give `#ERROR!` or `#NAME?`.
- **Operators**, loosest first:
  - comparison `= <> < <= > >=` (gives TRUE/FALSE);
  - `&` (join as text);
  - `+ -`;
  - `* /`;
  - a leading `+`/`-`;
  - `^` (right-associative, binding tighter than a leading minus).
- **Literals:**
  - numbers are `12`, `1.5` or `.5`; `1e3`, `5%` and `1.` inside a formula give `#ERROR!`;
  - text is in double quotes with backslash escapes (`"say \"hi\""`); Excel's doubled quote `""` gives `#ERROR!`;
  - `TRUE`/`FALSE` inside a formula are the numbers 1 and 0 (`=TRUE` shows 1).
- **Functions** (21 names, any case; anything else is `#NAME?`): SUM, AVERAGE (AVG), MIN, MAX, COUNT, COUNTA, PRODUCT, MEDIAN, ROUND, ABS, SQRT, POWER, MOD, LEN, CONCAT (CONCATENATE), IF, AND, OR, NOT. A wrong argument count gives `#VALUE!`.
- **Errors:**

  | Code | Meaning |
  |------|---------|
  | `#DIV/0!` | division or MOD by zero, AVERAGE of nothing, `0^-1` |
  | `#CIRC!` | circular reference: every cell in the loop and every cell using one |
  | `#NAME?` | unknown name or function |
  | `#VALUE!` | text in arithmetic, a range used as one value, wrong argument count |
  | `#REF!` | bad reference |
  | `#NUM!` | SQRT of a negative, overflow, MEDIAN of nothing |
  | `#ERROR!` | the formula cannot be read |

  An error flows on to every formula that uses the cell, including through a range in SUM or COUNT.
- **Differences from Excel:**
  - `=-2^2` is -4.
  - MOD takes the sign of the divisor (`MOD(-7,3)` = 2).
  - ROUND rounds halves toward +∞ (`ROUND(-2.5)` = -2) and drops a fractional digit count.
  - MIN, MAX and PRODUCT of nothing are 0; MEDIAN of nothing is `#NUM!`.
  - COUNT counts booleans; COUNTA over a range counts error cells too.
  - IF without an else gives FALSE; any non-empty text other than "false" counts as TRUE.
  - AND() is TRUE and OR() is FALSE; empty cells in their ranges are skipped.
  - Text comparison is case-sensitive (`"a"="A"` is FALSE); text that looks like a number compares as a number.
  - An empty cell is 0 in arithmetic and "" in text.
  - Results are rounded to 10 decimal places (`=0.1+0.2` is 0.3, and `=1/3` reads 0.3333333333).
  - A chain of more than 3,400 cells each referring to the next gives `#ERROR!`. The browser's own limit depends on the formula: about 3,400 for plain links, about 800 when each link goes through a function such as SUM.

### Rules the operations enforce

- **Growth cap:** no operation grows a sheet past 5,000 rows or 256 columns (the app's import limit). `rows.add`, `rows.insert`, `columns.add`, `columns.insert`, `cells.paste` and `cells.copy` refuse with 400; `sheets.import-csv` cuts and reports `truncated`.
- **Minimums:** at least one row and one column remain; columns are at least 64 px and rows at least 20 px (sizes are rounded).
- **Freeze** is 0 or 1 row and 0 or 1 column, as the toolbar toggles allow.
- **`if_updated`:** every write takes the optional `if_updated`, the sheet's `updated` value from an earlier result. The write then refuses with 409 if the sheet changed since (for `cells.copy`, the sheet pasted into). Every result carries the new `updated`, so a series of writes can chain it.
- **Destructive:** `sheets.delete`, `rows.delete`, `columns.delete`. Approval is required because you have no undo: the person's Undo lives in their browser tab and cannot undo your changes. Every write returns what it changed, before and after, so you can put things back with another operation.
- **Errors:** 400 for a bad or out-of-grid parameter (the message names it and the grid's size), 404 for an unknown sheet or a `ref` that does not match, 409 for an ambiguous sheet name or a stale `if_updated`.

### The person's open tab

The screen loads a sheet when it opens or when the person switches to its tab. After that it keeps its own copy and saves the **whole sheet** on every edit; it does not listen for changes. So:

- the person sees your changes only after switching to another tab and back, or reloading;
- their next edit (or their Undo) on a copy they had open before your change silently writes their older copy over yours;
- sheets you create appear in their tab strip after a reload (or when they add, delete or import a sheet themselves);
- if you delete the sheet they have open, their next edit fails with "Failed to save changes".

Every write result repeats this as `note`. Tell the person what you changed and to switch tabs or reload, and ask them not to edit that sheet while you work. Use `if_updated` to catch an edit made between your read and your write.

### Quirks of the app (the operations reproduce them on purpose)

- **Text rewriting of references.** Reference rewriting on insert or delete is a text rule over the formula: every letters-then-digits token shifts, including text inside quotes (`="Room B2"` becomes `="Room B3"` after a row is inserted above row 2). Shifted references come out upper case.
- **Column names.** Deleting a column keeps the other columns' names, so a header named "C" may sit in column B. Names are labels only; references always use the position letter.
- **Tab order and names.** New tabs are named "Sheet N" from the tab count, so names can repeat. Tab order is creation order; nothing reorders tabs.
- **Paste.** A plain-text paste (`cells.paste`) keeps empty cells it wrote as stored empty cells. With match case off, Replace interprets `$&`, `$1` and `$$` in the replacement text (`$&` inserts the match); with match case on, the replacement is literal.

### Gotchas (for whoever changes this app)

- `lib_agent_formula.js`, `lib_agent_grid.js` and `lib_agent_csv.js` are ports of `frontend/src/app/services/formula.ts`, `utils/grid.ts` with `components/FindReplace.tsx`, and `utils/fileio.ts` with SheetJS 0.18.5's CSV code. Any change to those frontend files must be mirrored, or agents will see different values than people. The ports were checked side by side with the frontend code, in Node and inside PocketBase. Matches were exact for formulas, grid edits, find and replace, display and CSV export. CSV import matched except the date forms listed above.
- `shown` cannot use `Intl` (the hooks runtime has none); `formatValue` in `lib_agent_grid.js` renders the en-US form the way `Intl.NumberFormat` does (shortest digits, half-away-from-zero rounding).
- Cells are read with `JSON.parse(rec.getString('cells'))` so key order follows the stored JSON, as in the browser. Writes go through `JSON.parse(JSON.stringify(…))` so no `undefined` reaches PocketBase as `null`; stored cells stay byte-identical to a screen save.
- Evaluation is whole-sheet, once per operation (as the browser does on every load): typical sheets answer in 30–50 ms, and a 5,000 × 10 sheet with 10,000 formulas takes 5–8 s.
- `require()` costs about a millisecond per call in the hooks runtime, so it is called once per handler and never inside per-cell helpers. Query results are copied with `Array.from` before sorting. Errors go back as `e.json(status, {status, message})`, never thrown out of a handler.
- Hooks do not hot-reload (`--hooksWatch=false`): restart the app after a hook change.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.

See `reference/requirements.md` (binding). Feature checklist:

- [x] One screen: toolbar, formula bar, grid, sheet tabs along the bottom; loading and "Backend unavailable" states; host themes
- [x] Sheet tabs: switch, add ("Sheet N", 12 × 30), rename by double-click, delete with confirmation (last one replaced by "Sheet 1"), last sheet remembered per browser
- [x] Grid: select (drag, Shift, Ctrl/Cmd), keyboard moves, inline and formula-bar editing, Delete clears, copy and paste (in-app with formats, text from outside), fill handle
- [x] Formula engine with 21 functions and seven error codes, computed in the browser
- [x] Formatting: bold, italic, underline, alignment, fill and font colours (palette, custom, none)
- [x] Rows and columns: add, insert (with reference shifting), delete (with #REF!), rename and type columns, resize, freeze first row and column
- [x] Find & Replace (raw text, match case, Find Next, Replace, Replace All)
- [x] Import CSV/XLSX/XLS as new sheets; export CSV (sheet) and Excel (workbook)
- [x] Undo and redo (50 steps, per open page)
- [x] Every person action except undo, Excel files and the selection has a CLI operation
