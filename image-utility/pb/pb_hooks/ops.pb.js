/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond plain collection CRUD live here (spec B3).
 * Every route added here MUST have a matching entry in operations.json (the
 * gate enforces it) so any agent can discover it via GET /api/_ops.
 *
 * Image Utility needs no custom server verbs: uploads are plain collection CRUD
 * (images), and ALL image processing (decode, crop, resize, format convert,
 * compress) runs CLIENT-SIDE in a <canvas> (PocketBase has no server-side
 * compute — V1 used Pillow). The uploaded source is a `file` field served open
 * at /api/files/images/<recordId>/<filename>; edited outputs are regenerated
 * client-side on download. This file is intentionally route-free.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers must be
 * require()d inside each handler, never referenced from this file's scope.
 */
