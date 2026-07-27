/// <reference path="../pb_data/types.d.ts" />
/**
 * Habit tracker schema: categories → habits → daily entries.
 * Auth mode "none": open rules are acceptable because the app binds loopback.
 */
migrate(
  (app) => {
    const categories = new Collection({
      type: 'base',
      name: 'categories',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'color', type: 'text', max: 20 },
        { name: 'order', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(categories);

    const habits = new Collection({
      type: 'base',
      name: 'habits',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        { name: 'description', type: 'text', max: 2000 },
        // binary: done/not done per day; quantity: numeric value vs target
        { name: 'type', type: 'select', maxSelect: 1, values: ['binary', 'quantity'] },
        { name: 'target', type: 'number' },
        { name: 'unit', type: 'text', max: 40 },
        { name: 'color', type: 'text', max: 20 },
        { name: 'icon', type: 'text', max: 8 },
        {
          name: 'category',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('categories').id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'order', type: 'number' },
        { name: 'archived', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(habits);

    const entries = new Collection({
      type: 'base',
      name: 'entries',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'habit',
          type: 'relation',
          required: true,
          collectionId: app.findCollectionByNameOrId('habits').id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        // Day key as plain text YYYY-MM-DD — avoids timezone drift entirely.
        { name: 'day', type: 'text', required: true, max: 10 },
        { name: 'value', type: 'number' },
        { name: 'note', type: 'text', max: 2000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_entries_habit_day ON entries (habit, day)'],
    });
    app.save(entries);
  },
  (app) => {
    for (const name of ['entries', 'habits', 'categories']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
