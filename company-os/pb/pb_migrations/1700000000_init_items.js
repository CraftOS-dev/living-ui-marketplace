/// <reference path="../pb_data/types.d.ts" />
/**
 * Starter collection. Agent-owned: extend or replace via new migrations.
 * Rules are set at scaffold time from the auth mode (spec B4/B6):
 *   none        → '' (open; acceptable only because the app binds loopback)
 *   multi-user  → '@request.auth.id != ""' (authenticated users only)
 */
migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'items',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.id != ""',
      deleteRule: '@request.auth.id != ""',
      fields: [
        { name: 'title', type: 'text', required: true, max: 200 },
        { name: 'done', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('items');
    app.delete(collection);
  },
);
