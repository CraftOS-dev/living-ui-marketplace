/// <reference path="../pb_data/types.d.ts" />
/**
 * Brainstorm graph schema: sessions → nodes (self-referencing tree).
 * Auth mode "none": open rules are acceptable because the app binds loopback.
 */
migrate(
  (app) => {
    const sessions = new Collection({
      type: 'base',
      name: 'sessions',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'title', type: 'text', required: true, max: 255 },
        { name: 'topic', type: 'text', max: 2000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(sessions);

    const nodes = new Collection({
      type: 'base',
      name: 'nodes',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'session',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('sessions').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'content', type: 'text', required: true, max: 2000 },
        {
          name: 'kind',
          type: 'select',
          maxSelect: 1,
          values: ['idea', 'question', 'insight', 'task'],
        },
        // Free canvas position (0/0 = not manually placed → auto layout).
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(nodes);

    // Self-relation must be added AFTER the collection exists (its own id
    // is needed as the relation target). Empty parent = the root node.
    const saved = app.findCollectionByNameOrId('nodes');
    saved.fields.add(
      new Field({
        name: 'parent',
        type: 'relation',
        collectionId: saved.id,
        cascadeDelete: true,
        maxSelect: 1,
      }),
    );
    app.save(saved);
  },
  (app) => {
    for (const name of ['nodes', 'sessions']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
