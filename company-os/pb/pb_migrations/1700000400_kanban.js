/// <reference path="../pb_data/types.d.ts" />
/**
 * Kanban board replaces the thin Projects/Tasks pair. The module key
 * `projects` becomes `kanban`, and a single richer collection `kanban_cards`
 * carries everything a task needs: a status (the board column), a due date,
 * a person in charge, a note, a checklist, and file attachments.
 *
 *   - RENAME module key  projects -> kanban (enum + any existing rows)
 *   - DROP   projects, tasks
 *   - NEW    kanban_cards
 */
migrate(
  (app) => {
    // --- 1. modules.key enum: projects -> kanban --------------------------
    const modules = app.findCollectionByNameOrId('modules');
    const keyField = modules.fields.getByName('key');
    // widen to both so existing rows stay valid while we migrate them
    keyField.values = ['customers', 'money', 'projects', 'kanban', 'goals', 'team', 'meetings', 'processes', 'marketing'];
    app.save(modules);
    for (const row of app.findRecordsByFilter('modules', "key = 'projects'", '', 0, 0)) {
      row.set('key', 'kanban');
      app.save(row);
    }
    keyField.values = ['customers', 'money', 'kanban', 'goals', 'team', 'meetings', 'processes', 'marketing'];
    app.save(modules);

    // --- 2. drop projects + tasks (children first) ------------------------
    for (const name of ['tasks', 'projects']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already absent */
      }
    }

    // --- 3. create kanban_cards ------------------------------------------
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
    const teamId = app.findCollectionByNameOrId('team_members').id;

    const cards = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'kanban_cards',
          fields: [
            { name: 'title', type: 'text', required: true, max: 300 },
            { name: 'status', type: 'select', maxSelect: 1, required: true, values: ['todo', 'doing', 'done'] },
            { name: 'due', type: 'date' },
            { name: 'note', type: 'text', max: 5000 },
            { name: 'owner', type: 'relation', maxSelect: 1, collectionId: teamId, cascadeDelete: false },
            { name: 'checklist', type: 'json', maxSize: 100000 }, // array of { text, done }
            { name: 'attachments', type: 'file', maxSelect: 10, maxSize: 10485760 },
            { name: 'order', type: 'number' },
          ].concat(TS),
        },
        RULES,
      ),
    );
    app.save(cards);
  },
  (app) => {
    // Down: drop kanban_cards, restore projects/tasks minimally, key back.
    try {
      app.delete(app.findCollectionByNameOrId('kanban_cards'));
    } catch {
      /* absent */
    }
    try {
      const modules = app.findCollectionByNameOrId('modules');
      const keyField = modules.fields.getByName('key');
      keyField.values = ['customers', 'money', 'projects', 'kanban', 'goals', 'team', 'meetings', 'processes', 'marketing'];
      app.save(modules);
      for (const row of app.findRecordsByFilter('modules', "key = 'kanban'", '', 0, 0)) {
        row.set('key', 'projects');
        app.save(row);
      }
      keyField.values = ['customers', 'money', 'projects', 'goals', 'team', 'meetings', 'processes', 'marketing'];
      app.save(modules);
    } catch {
      /* best-effort */
    }
  },
);
