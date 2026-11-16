/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS theses (kernel-records): the firm's investment theses, each
 * with criteria over the shared fact keys (lib_theses.FACT_KEYS), checked
 * tri-state (met, unmet, unknown) by the fit engine.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const rel = (name, target) => ({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false });
    const c = new Collection(
      Object.assign(
        {
          type: 'base',
          name: 'theses',
          fields: [
            { name: 'name', type: 'text', required: true, max: 160 },
            { name: 'statement', type: 'text', max: 4000 },
            { name: 'criteria', type: 'json', maxSize: 50000 },
            sel('status', ['active', 'archived'], true),
            rel('fund', 'entities'),
            rel('owner', 'members'),
            { name: 'sort', type: 'number', onlyInt: true },
            { name: 'prov', type: 'json', maxSize: 20000 },
            sel('actor', ['person', 'agent', 'system'], true),
            rel('member', 'members'),
          ].concat(stamps),
          indexes: ['CREATE UNIQUE INDEX idx_theses_name ON theses (name COLLATE NOCASE)', 'CREATE INDEX idx_theses_status ON theses (status)'],
        },
        closed,
      ),
    );
    app.save(c);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('theses'));
    } catch {
      /* already gone */
    }
  },
);
