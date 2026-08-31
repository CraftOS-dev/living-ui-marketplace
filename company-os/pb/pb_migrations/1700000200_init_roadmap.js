/// <reference path="../pb_data/types.d.ts" />
/**
 * Roadmap: a company-wide milestone canvas (the Strategy > Roadmap feature
 * from the Command Center, generalised). Two additive collections, no change
 * to any existing table so live data is untouched:
 *   - roadmap_items    the milestones (a DAG via the prerequisites id list)
 *   - roadmap_dividers the vertical time boundaries drawn across the canvas
 * Prerequisites are a plain id list (json), not a self-relation, so the
 * collection needs no second save to reference itself; cycle-safety lives in
 * the client, exactly as the Command Center does it.
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

    const teamId = app.findCollectionByNameOrId('team_members').id;

    const items = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'roadmap_items',
          fields: [
            { name: 'title', type: 'text', required: true, max: 300 },
            { name: 'description', type: 'text', max: 3000 },
            {
              name: 'status',
              type: 'select',
              maxSelect: 1,
              required: true,
              values: ['planned', 'in_progress', 'done', 'cut'],
            },
            { name: 'quarter', type: 'text', max: 20 },
            { name: 'target_date', type: 'date' },
            { name: 'owner', type: 'relation', maxSelect: 1, collectionId: teamId, cascadeDelete: false },
            { name: 'pos_x', type: 'number' },
            { name: 'pos_y', type: 'number' },
            { name: 'prerequisites', type: 'json', maxSize: 100000 }, // array of roadmap_items ids
          ].concat(TS),
        },
        RULES,
      ),
    );
    app.save(items);

    const dividers = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'roadmap_dividers',
          fields: [
            { name: 'label', type: 'text', required: true, max: 40 },
            { name: 'x', type: 'number' },
          ].concat(TS),
        },
        RULES,
      ),
    );
    app.save(dividers);
  },
  (app) => {
    for (const n of ['roadmap_items', 'roadmap_dividers']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* absent */
      }
    }
  },
);
