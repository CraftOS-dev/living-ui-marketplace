/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond plain collection CRUD live here (spec B3).
 * Every route added here MUST have a matching entry in operations.json (the
 * gate enforces it) so any agent can discover it via GET /api/_ops.
 *
 * Markdown Editor needs no custom server verbs: the whole workspace is a
 * virtual filesystem stored as plain collection records (`nodes` for
 * files/folders, `sessions` for the editor layout). Directory listing,
 * read/write, create/rename/delete, and upload are all reproduced CLIENT-SIDE
 * by the fetch adapter (src/app/services/apiAdapter.ts) against those
 * collections' REST CRUD. This file is intentionally route-free.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers must be
 * require()d inside each handler, never referenced from this file's scope.
 */
