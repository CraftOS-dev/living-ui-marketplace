# Craft Sheets

A small Excel-style spreadsheet you can use right in the browser — type values and formulas, save named sheets, and import/export CSV & Excel files.

## Overview

Craft Sheets is a lightweight spreadsheet app. It gives you an editable grid of cells where you can enter text, numbers, dates, currency, and **live formulas** (`=A1+B1`, `=SUM(A1:A10)`, `=AVERAGE(B1:B5)`, …). Formulas are evaluated by the backend, which is the source of truth for all data, so your sheets survive reloads. You can keep several named sheets in one workbook and switch between them with Excel-style tabs along the bottom. Sheets can be brought in and out via CSV and `.xlsx` import/export.

It's for anyone who wants a quick scratch spreadsheet — budgets, simple tables, quick calculations — without opening a full office suite.

## Requirements

Gathered in Phase 0 (two batches: data/features, then design/layout).

### Entities & Data Model

- **Sheet** — a named spreadsheet (a single grid). The workbook is the collection of all saved sheets. Each sheet owns:
  - **Columns** — an ordered list. Each column has a display **name** (header), a **type** (`text`, `number`, `date`, `currency`), and a pixel **width**. A column's position determines its spreadsheet letter (1st = `A`, 2nd = `B`, …).
  - **Rows** — addressed by 1-based number. The sheet stores how many rows it has (`numRows`).
  - **Cells** — keyed by A1-style reference (`A1`, `B3`, …). Each non-empty cell stores its **raw** content (a literal like `42`/`Hello` or a formula like `=A1*1.2`) and optional **format** (`bold`, `align`, `bg`).
- The backend evaluates every formula and returns the computed **values** and any **errors** alongside the raw sheet.

### Layout & Design

- **Tab bar at the bottom** (Excel-style): one tab per saved sheet; click to load it, `+` to add, double-click to rename, × to delete. The active tab is highlighted.
- **Top formula bar** (Excel-style): shows the selected cell's reference and its raw content; editing there commits to the cell. Cells are also editable inline (double-click / start typing).
- **Toolbar** above the grid: New / add row / add column, formatting (bold, alignment, background color), and Import / Export (CSV & Excel).
- **Clean modern** visual style, CraftBot orange (`#FF4F18`) accents, rounded corners, follows system light/dark. Responsive down to ~360 px (toolbar wraps, grid scrolls).

### Features

- Create, rename, and delete sheets; switch between them via bottom tabs.
- Editable grid: enter text/number/date/currency values and formulas.
- **Formula engine**: cell & range references (`A1`, `A1:B5`), arithmetic (`+ - * / ^`, parentheses), and functions `SUM, AVERAGE/AVG, MIN, MAX, COUNT, COUNTA, PRODUCT, ROUND, ABS, SQRT, POWER, MOD, MEDIAN, IF, AND, OR, NOT, CONCAT/CONCATENATE, LEN`. Errors surface per-cell (`#DIV/0!`, `#CIRC!`, `#NAME?`, `#VALUE!`, `#REF!`, `#ERROR!`).
- Add / delete rows and columns; rename a column and change its type.
- Cell formatting: bold, horizontal alignment (left/center/right), background color.
- Import a CSV or `.xlsx` file as a new sheet; export the active sheet as CSV or `.xlsx`.
- Keyboard: arrow keys / Tab / Enter to move, Enter/F2 to edit, Delete to clear.

### Assumptions

- Spreadsheet references are **positional** (A1 notation). Adding rows/columns at the end and deleting rows/columns is supported; formula **text** is not auto-rewritten when rows/columns in the middle are deleted (early-spreadsheet behavior) — references keep pointing at the same A1 address. Appending and typing formulas works as expected.
- CSV/Excel parsing and file generation happen **client-side** (SheetJS); the backend stays a clean JSON API and remains the persistence + formula source of truth. Imported cells that begin with `=` are treated as formulas.
- Single workbook, no authentication — all sheets are shared in one local database (matches "a small Excel app").
- A new sheet starts with 6 columns (A–F) and 20 rows.

## Data Model

### Backend Models (backend/models.py)

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `Sheet` | One named spreadsheet (grid) in the workbook | `id`, `name`, `columns` (JSON list of `{name,type,width}`), `num_rows`, `cells` (JSON map `ref → {raw, format}`), `position`, `created_at`, `updated_at` |
| `AppState` | Template-provided generic JSON state (unused by features, kept for agent API) | `id`, `data` |
| `UISnapshot` / `UIScreenshot` | Template-provided agent observation tables | — |

### Formula Engine (backend/formula.py)

Pure module (no DB). `evaluate_sheet(columns, num_rows, cells)` parses and evaluates every cell with memoization + circular-reference detection and returns `{ values, errors }`.

## API Endpoints

### Custom Routes (backend/routes.py)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sheets | List all sheets (id, name, size, timestamps), ordered by position |
| POST | /api/sheets | Create a sheet (name + optional columns / numRows / cells); returns it evaluated |
| GET | /api/sheets/{sheet_id} | Get one sheet with evaluated `values` and `errors` |
| PUT | /api/sheets/{sheet_id} | Replace a sheet's name / columns / numRows / cells; returns it evaluated |
| DELETE | /api/sheets/{sheet_id} | Delete a sheet (idempotent — 200 even if already absent) |

Template-provided routes (`/api/state`, `/api/action`, `/api/ui-snapshot`, `/api/ui-screenshot`) are retained for agent observation.

## Frontend Components

### Components (frontend/components/)

| Component | Purpose |
|-----------|---------|
| MainView.tsx | Layout: toolbar + formula bar + grid + bottom tab bar; owns selection & sheet state |
| Toolbar.tsx | New/add row/column, formatting controls, import/export buttons |
| FormulaBar.tsx | Shows selected cell ref + raw content; edits commit to the cell |
| Grid.tsx | The scrollable spreadsheet grid (headers, row numbers, editable cells) |
| SheetTabs.tsx | Excel-style bottom tabs: switch / add / rename / delete sheets |
| ColumnMenu.tsx | Per-column popover: rename, change type, delete column |

### Frontend Support Files

| File | Purpose |
|------|---------|
| frontend/types.ts | `Sheet`, `Column`, `Cell`, `CellFormat`, column-type & format unions |
| frontend/AppController.ts | Sheet API calls, grid mutations (add/delete row & column), import/export helpers |
| frontend/utils/grid.ts | A1 ref helpers (column letter ⟷ index, ref parsing), value formatting by column type |
| frontend/utils/fileio.ts | CSV / XLSX import & export via SheetJS |

## Key Files

| File | Purpose |
|------|---------|
| backend/models.py | `Sheet` SQLAlchemy model |
| backend/formula.py | Spreadsheet formula parser + evaluator |
| backend/routes.py | Sheet CRUD endpoints |
| backend/tests/test_sheets.py | API tests for sheet CRUD |
| backend/tests/test_formula.py | Formula engine unit tests |
| frontend/components/*.tsx | Grid, formula bar, tabs, toolbar, column menu |
| frontend/AppController.ts | State management + sheet API |

## State Flow

```
Cell edit / structural op → MainView → AppController → PUT /api/sheets/{id}
                                                            ↓
                                          backend evaluates formulas (formula.py)
                                                            ↓
                                   returns { sheet, values, errors } → grid re-renders
```

## Testing

1. Add a sheet, type `5` in A1, `10` in A2, and `=SUM(A1:A2)` in A3 → A3 shows `15`.
2. Reload the page → the sheet, values, and formula persist.
3. Add a second sheet from the bottom tabs, switch between tabs.
4. Export the active sheet as `.xlsx`, then re-import it → a new sheet appears with the same data.
5. Resize the window to ~360 px → toolbar wraps, grid scrolls, nothing clips.
