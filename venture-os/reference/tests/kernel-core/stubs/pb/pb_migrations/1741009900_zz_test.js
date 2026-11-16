/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY (kernel-core tests): stand-ins for kernel-records'
 * collections the kernel touches (deals, deal_people, files) and a fake
 * module's collection (zz_things). Never shipped.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const make = (name, fields) => app.save(new Collection(Object.assign({ type: 'base', name: name, fields: fields.concat(stamps) }, closed)));
    make('deals', [
      { name: 'number', type: 'text', max: 20 },
      { name: 'deleted_at', type: 'text', max: 40 },
      { name: 'company_name', type: 'text', max: 200 },
      { name: 'fund', type: 'text', max: 30 },
      { name: 'restricted', type: 'bool' },
      { name: 'agent_allowed', type: 'bool' },
      { name: 'agent', type: 'json', maxSize: 20000 },
    ]);
    make('deal_people', [
      { name: 'deal', type: 'text', max: 30 },
      { name: 'member', type: 'text', max: 30 },
      { name: 'team', type: 'bool' },
    ]);
    make('files', [
      { name: 'name', type: 'text', max: 200 },
      { name: 'deal', type: 'text', max: 30 },
      { name: 'file', type: 'file', maxSelect: 1, maxSize: 20000000, protected: true },
    ]);
    make('zz_things', [
      { name: 'name', type: 'text', max: 200 },
      { name: 'value', type: 'number' },
      { name: 'note', type: 'text', max: 2000 },
      { name: 'deal', type: 'text', max: 30 },
      { name: 'agent', type: 'json', maxSize: 20000 },
    ]);
  },
  (app) => {
    for (const n of ['zz_things', 'files', 'deal_people', 'deals']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* gone */
      }
    }
  },
);
