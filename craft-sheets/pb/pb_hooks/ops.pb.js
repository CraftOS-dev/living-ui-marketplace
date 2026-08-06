/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond plain collection CRUD live here (spec B3).
 * Every route added here MUST have a matching entry in operations.json (the
 * gate enforces it) so any agent can discover it via GET /api/_ops.
 *
 * Craft Sheets needs no custom server verbs: the workbook is plain `sheets`
 * collection CRUD, and the formula engine + CSV/XLSX import-export all run
 * CLIENT-SIDE (the fetch adapter ports backend/formula.py to TS; SheetJS does
 * file I/O in the browser). This file is intentionally route-free.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers must be
 * require()d inside each handler, never referenced from this file's scope.
 */
