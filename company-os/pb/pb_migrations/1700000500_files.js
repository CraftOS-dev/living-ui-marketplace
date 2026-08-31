/// <reference path="../pb_data/types.d.ts" />
/**
 * Files: a local file repository. Each record holds ONE uploaded file plus
 * light metadata (original name, byte size, mime type) captured at upload so
 * the UI can list, preview, download and delete without re-reading the blob.
 * Files live on PocketBase's own disk storage — local, no external service.
 */
migrate(
  (app) => {
    const AUTH = '@request.auth.id != ""';
    const RULES = {
      listRule: AUTH,
      viewRule: AUTH,
      createRule: AUTH,
      updateRule: AUTH,
      deleteRule: AUTH,
    };
    const TS = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    const files = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'files',
          fields: [
            { name: 'title', type: 'text', required: true, max: 300 },
            { name: 'file', type: 'file', maxSelect: 1, maxSize: 52428800 }, // 50 MB
            { name: 'size', type: 'number' },
            { name: 'mime', type: 'text', max: 200 },
            { name: 'note', type: 'text', max: 2000 },
          ].concat(TS),
        },
        RULES,
      ),
    );
    app.save(files);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('files'));
    } catch {
      /* absent */
    }
  },
);
