/// <reference path="../pb_data/types.d.ts" />
/**
 * leave_balances: each tracked type's balance per employment on the day of
 * the sync (taken, booked, granted, carried, what lapses), for the balances
 * table of many people; waiting requests are added when it is read. Derived
 * data: every change to a person's leave and the daily run replace an
 * employment's rows (next to leave_attention).
 */
migrate(
  (app) => {
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const b = new Collection({
      type: 'base',
      name: 'leave_balances',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'employment', type: 'relation', maxSelect: 1, collectionId: id('employments'), cascadeDelete: true, required: true },
        { name: 'type', type: 'relation', maxSelect: 1, collectionId: id('leave_types'), cascadeDelete: true, required: true },
        { name: 'computed', type: 'text', max: 10 },
        { name: 'balance', type: 'number' },
        { name: 'taken', type: 'number' },
        { name: 'booked', type: 'number' },
        { name: 'granted', type: 'number' },
        { name: 'carried', type: 'number' },
        { name: 'expiring', type: 'json', maxSize: 4000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_leave_balances_emp ON leave_balances (employment, type)'],
    });
    app.save(b);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('leave_balances'));
  },
);
