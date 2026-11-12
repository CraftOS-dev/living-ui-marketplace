/// <reference path="../pb_data/types.d.ts" />
/**
 * Who made each node, so the "Created by AI" mark survives a reload:
 * 'agent' for nodes the AI buttons or an agent's operations create, 'user'
 * (or empty, as on older rows and the seed) for the person's own.
 */
migrate(
  (app) => {
    const nodes = app.findCollectionByNameOrId('nodes');
    nodes.fields.add(
      new Field({
        name: 'created_by',
        type: 'select',
        maxSelect: 1,
        values: ['user', 'agent'],
      }),
    );
    app.save(nodes);
  },
  (app) => {
    const nodes = app.findCollectionByNameOrId('nodes');
    nodes.fields.removeByName('created_by');
    app.save(nodes);
  },
);
