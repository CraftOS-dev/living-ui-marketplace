/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond plain collection CRUD live here (spec B3).
 * Every route added here MUST have a matching entry in operations.json (the
 * gate enforces it) so any agent can discover it via GET /api/_ops.
 *
 * PDF Splitter needs no custom server verbs: uploads/history are plain
 * collection CRUD (pdfs, split_jobs), and all PDF processing runs client-side
 * (PocketBase has no server-side compute — see the init migration). This file
 * is intentionally route-free.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers must be
 * require()d inside each handler, never referenced from this file's scope.
 */
