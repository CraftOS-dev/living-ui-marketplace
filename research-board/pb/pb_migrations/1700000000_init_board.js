/// <reference path="../pb_data/types.d.ts" />
/**
 * Research Board schema.
 *
 * Three collections:
 *   - `board_items`  one card on the canvas (type / title / x,y position /
 *                    content / url / file_path), mirroring BoardItem.to_dict().
 *   - `connections`  an edge between two items. V1 stored integer source_id /
 *                    target_id; here they hold the (string) board_items record
 *                    ids — the frontend uses item ids opaquely (=== matching,
 *                    Map keys), so strings pass through fine.
 *   - `uploads`      an uploaded media file (image/video/document). The file is
 *                    served open by PocketBase at
 *                    /api/files/uploads/<recordId>/<filename>; the creating
 *                    item's `url` points straight there (same-origin), so the
 *                    unchanged frontend's <img>/<video>/<iframe>/<a> load it
 *                    natively — no fetch-shim needed for media.
 *
 * The fetch adapter (src/app/services/apiAdapter.ts) reproduces the V1 REST
 * surface (items list w/ search+type filter, CRUD, connections dedup, upload,
 * state) client-side against these collections.
 *
 * Auth mode "none": open rules are acceptable because the app binds loopback
 * and the origin guard (_system.pb.js) refuses foreign-origin writes.
 */
migrate(
  (app) => {
    const items = new Collection({
      type: 'base',
      name: 'board_items',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'type', type: 'text', required: true, max: 50 },
        { name: 'title', type: 'text', required: true, max: 500 },
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'content', type: 'text', max: 100000 },
        { name: 'url', type: 'text', max: 5000 },
        { name: 'file_path', type: 'text', max: 5000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(items);

    const connections = new Collection({
      type: 'base',
      name: 'connections',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'source', type: 'text', required: true, max: 50 },
        { name: 'target', type: 'text', required: true, max: 50 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(connections);

    const uploads = new Collection({
      type: 'base',
      name: 'uploads',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'filename', type: 'text', max: 500 },
        { name: 'file', type: 'file', required: true, maxSelect: 1, maxSize: 104857600 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(uploads);
  },
  (app) => {
    for (const name of ['connections', 'uploads', 'board_items']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
