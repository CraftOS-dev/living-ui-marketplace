/// <reference path="../pb_data/types.d.ts" />
/**
 * leave_attention: what needs HR's attention per employment and type, written
 * by the sync (every change to a person's leave and the daily run), so the
 * Leave home and the daily notices read rows instead of walking every
 * balance: days that lapse within 61 days (an expiry or the year close over
 * the carry-over limit), a balance below zero, the Japanese five-day rule at
 * risk or missed. Derived data: the sync replaces an employment's rows.
 */
migrate(
  (app) => {
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const c = new Collection({
      type: 'base',
      name: 'leave_attention',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'employment', type: 'relation', maxSelect: 1, collectionId: id('employments'), cascadeDelete: true, required: true },
        { name: 'entity', type: 'relation', maxSelect: 1, collectionId: id('entities'), cascadeDelete: true },
        { name: 'type', type: 'relation', maxSelect: 1, collectionId: id('leave_types'), cascadeDelete: true, required: true },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['expiring', 'negative', 'obligation'], required: true },
        { name: 'day', type: 'text', max: 10 },
        { name: 'amount', type: 'number' },
        { name: 'detail', type: 'json', maxSize: 4000 },
        { name: 'computed', type: 'text', max: 10 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_leave_attention_emp ON leave_attention (employment)', 'CREATE INDEX idx_leave_attention_entity ON leave_attention (entity, kind)'],
    });
    app.save(c);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('leave_attention'));
  },
);
