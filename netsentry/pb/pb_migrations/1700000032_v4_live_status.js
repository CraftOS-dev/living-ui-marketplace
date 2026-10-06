/// <reference path="../pb_data/types.d.ts" />
/**
 * v4 N6 (plan §16, N-B24): live_status — one record per server with the monitor's latest live
 * sample (processor, memory, fullest disk, every container's state and numbers), sent every 2 s
 * while a person has the server on screen. No history: each sample replaces the last. People read
 * it (pages follow it in realtime); only the console writes it, from the monitor's check-in.
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    const assets = app.findCollectionByNameOrId('assets');
    app.save(new Collection({
      type: 'base',
      name: 'live_status',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'asset', type: 'relation', collectionId: assets.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: 'at', type: 'date' },
        { name: 'data', type: 'json', maxSize: 65536 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_live_status_asset ON live_status (asset)'],
    }));
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('live_status'));
  },
);
