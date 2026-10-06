/// <reference path="../pb_data/types.d.ts" />
/**
 * v4 N-B11: files on their way to or from the server are written only by operations
 * (files.stage-upload, sensors.transfer-put) — like every other write. Nothing creates them directly.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('file_transfers');
    c.createRule = null;
    app.save(c);
  },
  () => {
    // Direct creates stay closed (bootstrap.pb.js refuses them anyway).
  },
);
