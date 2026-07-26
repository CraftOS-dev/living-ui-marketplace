/// <reference path="../pb_data/types.d.ts" />
/**
 * Kanban schema: boards → lists → cards, plus board-scoped labels.
 * Auth mode "none": open rules are acceptable because the app binds loopback.
 */
migrate(
  (app) => {
    const boards = new Collection({
      type: 'base',
      name: 'boards',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 255 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(boards);

    const labels = new Collection({
      type: 'base',
      name: 'labels',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'board',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('boards').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'name', type: 'text', required: true, max: 100 },
        { name: 'color', type: 'text', required: true, max: 7 },
      ],
    });
    app.save(labels);

    const lists = new Collection({
      type: 'base',
      name: 'lists',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'board',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('boards').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'title', type: 'text', required: true, max: 255 },
        { name: 'position', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(lists);

    const cards = new Collection({
      type: 'base',
      name: 'cards',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'list',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('lists').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'title', type: 'text', required: true, max: 255 },
        { name: 'description', type: 'text', max: 10000 },
        {
          name: 'priority',
          type: 'select',
          maxSelect: 1,
          values: ['none', 'low', 'medium', 'high', 'urgent'],
        },
        { name: 'due_date', type: 'date' },
        { name: 'position', type: 'number' },
        { name: 'archived', type: 'bool' },
        {
          name: 'labels',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('labels').id,
          cascadeDelete: false,
          maxSelect: 99,
        },
        // [{ text: string, done: boolean }] — small per-card list, no
        // cross-card queries needed, so JSON beats a fifth collection.
        { name: 'checklist', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(cards);
  },
  (app) => {
    for (const name of ['cards', 'lists', 'labels', 'boards']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
