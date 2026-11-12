# Tasks: Craft Sheets

Every task cites what it implements. These features already exist in the published app `craft-sheets` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-APP-1, F-APP-6): one full-height screen: wrapping toolbar, formula bar, scrolling grid and the sideways-scrolling tab strip (`components/MainView.tsx`, `Toolbar.tsx`, `FormulaBar.tsx`, `Grid.tsx`, `SheetTabs.tsx`).
- [x] T-2 (F-APP-2, F-APP-3): first load: "Loading Craft Sheets…", the last opened sheet from `localStorage` (or the first tab), "Sheet 1" created for an empty workbook. "Backend unavailable" with Retry when the health check fails (`MainView.tsx`, `AppController.ts`).
- [x] T-3 (F-APP-4): theme presets and the host's theme and mode messages applied to the document (`theme/themes.ts`, `App.tsx`).
- [x] T-4 (F-APP-5): toasts at the top right for results and failures (react-toastify in `App.tsx`, messages in `MainView.tsx`).
- [x] T-5 (F-TAB-1, F-TAB-2): tab strip in creation order with the open tab highlighted. Clicking loads the sheet and remembers it in this browser (`SheetTabs.tsx`, `switchSheet`).
- [x] T-6 (F-TAB-3): New and "+ Sheet" create "Sheet N" with 12 text columns × 30 rows, the next `sid` and the next position (`addSheet`, `apiAdapter.ts` handleCreateSheet).
- [x] T-7 (F-TAB-4): double-click rename with trim, empty ignored and Escape to cancel (`SheetTabs.tsx`, `renameSheet`).
- [x] T-8 (F-TAB-5): delete with the "Delete sheet?" dialog. The last sheet is replaced by a fresh "Sheet 1" (`doDeleteSheet`).
- [x] T-9 (F-TAB-6): freeze toggles for the first row and first column, with sticky frozen cells (`setFreezePanes`, precomputed offsets in `Grid.tsx`).
- [x] T-10 (F-GRID-1): headers with name and letter, row numbers, values formatted by column type, and error codes in red (`displayCell`, `formatValue` in `utils/grid.ts`).
- [x] T-11 (F-GRID-2, F-GRID-3): selection by click, drag, Shift-click, Shift+arrows and Ctrl/Cmd-click, and keyboard moves with arrows, Enter, Tab and Shift+Tab (`Grid.tsx`).
- [x] T-12 (F-GRID-4, F-GRID-5): inline editing (type, double-click, F2; Enter, Tab, Escape, blur) and the formula bar showing and editing raw content (`Grid.tsx`, `FormulaBar.tsx`, `setCellRaw`).
- [x] T-13 (F-GRID-6): Delete and Backspace clear the selection's contents and keep formatting (`handleClearSelection`).
- [x] T-14 (F-GRID-7, F-GRID-8): in-app copy and paste with formats through the `application/x-craft-sheets` clipboard (`pasteRangeFull`), and plain tab-separated paste (`pasteRange`). Both grow the grid.
- [x] T-15 (F-GRID-9): fill handle with numeric steps, relative formula shifts, pattern repeat and copied formats (`autofill`, `shiftFormulaByDelta`).
- [x] T-16 (F-FX-1, F-FX-2, F-FX-3, F-FX-4, F-FX-5): the formula engine: tokenizer, recursive-descent parser, 21 functions, memoized evaluation with cycle detection and the seven error codes. It runs on every read and write (`services/formula.ts`, `apiAdapter.ts` withValues).
- [x] T-17 (F-FMT-1, F-FMT-2, F-FMT-4): bold, italic and underline toggles and shortcuts, left/centre/right alignment with the column-type default, and toolbar state from the selected cell (`setRangeFormat`, `Toolbar.tsx`).
- [x] T-18 (F-FMT-3): fill and font colour pickers: 40 swatches, None, and custom colours remembered in this browser (`ColorPicker.tsx`, `Toolbar.tsx`).
- [x] T-19 (F-RC-1, F-RC-3): toolbar add row and column, and delete of the selected cell's row or column. Formula references to a deleted row or column become `#REF!` (`addRow`, `addColumn`, `deleteRow`, `deleteColumn`, `rewriteFormulaRefs`).
- [x] T-20 (F-RC-2): row-number menu (insert above or below, delete) and column-header menu (insert left or right, delete), with references shifted on insert (`RowMenu.tsx`, `ColumnMenu.tsx`, `insertRow`, `insertColumn`).
- [x] T-21 (F-RC-4): column name and type in the column-header menu (`renameColumn`, `setColumnType`).
- [x] T-22 (F-RC-5): column and row resizing by dragging the header edges, with live preview and minimum sizes (`setColumnWidth`, `setRowHeight`).
- [x] T-23 (F-FND-1, F-FND-2, F-FND-3): Find & Replace over raw content with Match case, "n of m", Find Next, Replace and Replace All (`FindReplace.tsx`).
- [x] T-24 (F-IO-1): import of CSV, XLSX and XLS as one new sheet per worksheet, with formulas kept and 5,000 × 256 limits (`importWorkbook`, `worksheetToSheetInput` in `utils/fileio.ts`).
- [x] T-25 (F-IO-2): CSV export of the open sheet's values and Excel export of the whole workbook with formulas, values and column widths (`exportSheet`, `exportWorkbook`).
- [x] T-26 (F-UND-1): undo and redo of whole-sheet snapshots, 50 deep, from the toolbar and keyboard (`MainView.tsx`).
- [x] T-27 (F-AGT-1, F-AGT-9): the 26 operations in `operations.json` (`agent_ops.pb.js`, served to agents by `a2app_routes.pb.js`), with `app.guide` for the conventions.
- [x] T-28 (F-AGT-2): `cells.read` and `sheets.get` on a server port of the formula engine (`lib_agent_formula.js`) and of the display formatting, rendered en-US (`lib_agent_grid.js`). Values were checked equal to `formula.ts` on 1,729 test sheets.
- [x] T-29 (F-AGT-3): every write runs the port of the matching `grid.ts` or `FindReplace.tsx` function in one transaction. It stores the sheet as the adapter would, and returns before and after (`lib_agent.js`, `lib_agent_grid.js`).
- [x] T-30 (F-AGT-4): `sheets.import-csv` and `sheets.export-csv` on a port of `fileio.ts` with SheetJS 0.18.5's CSV reading and writing. On import, only ISO-like dates become date numbers (`lib_agent_csv.js`).
- [x] T-31 (F-AGT-5, F-AGT-6): the 5,000-row × 256-column growth cap on every operation that grows a sheet, and the optional `if_updated` guard on every write (`lib_agent.js`).
- [x] T-32 (F-AGT-7): `sheets.delete`, `rows.delete` and `columns.delete` declared destructive, so the adapter asks for the person's approval.
- [x] T-33 (F-AGT-8): the `sheets` collection is kept out of the agent's raw data surface; agents use the operations.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 26 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
