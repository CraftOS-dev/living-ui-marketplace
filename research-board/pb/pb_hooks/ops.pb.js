/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond plain collection CRUD live here (spec B3).
 * Every route added here MUST have a matching entry in operations.json (the
 * gate enforces it) so any agent can discover it via GET /api/_ops.
 *
 * Research Board is plain collection CRUD (board_items, connections) plus file
 * uploads. Uploaded media is stored in an `uploads` file collection and served
 * open by PocketBase at /api/files/uploads/<recordId>/<filename> — the item's
 * url points straight there (same-origin), so <img>/<video>/<iframe> load it
 * natively. The fetch adapter (src/app/services/apiAdapter.ts) reproduces the
 * V1 REST surface (items/connections/upload/state) client-side. This file is
 * intentionally route-free.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers must be
 * require()d inside each handler, never referenced from this file's scope.
 */
