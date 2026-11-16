/// <reference path="../pb_data/types.d.ts" />
/**
 * Paying out unused leave on termination:
 * - leave_types.payout_on_exit: the balance left on the last day is paid out
 *   (seeded true where the law requires it, editable).
 * - leave_encash_requests.kind: voluntary (a person asked) | exit (made by the
 *   app when a separation is approved or its last day moves), and the
 *   separation it belongs to.
 */
migrate(
  (app) => {
    const t = app.findCollectionByNameOrId('leave_types');
    t.fields.add(new BoolField({ name: 'payout_on_exit' }));
    app.save(t);
    const e = app.findCollectionByNameOrId('leave_encash_requests');
    e.fields.add(new SelectField({ name: 'kind', maxSelect: 1, values: ['voluntary', 'exit'] }));
    e.fields.add(new TextField({ name: 'separation', max: 30 }));
    e.addIndex('idx_leave_encash_separation', false, 'separation, type', '');
    app.save(e);
  },
  (app) => {
    const t = app.findCollectionByNameOrId('leave_types');
    t.fields.removeByName('payout_on_exit');
    app.save(t);
    const e = app.findCollectionByNameOrId('leave_encash_requests');
    e.removeIndex('idx_leave_encash_separation');
    for (const n of ['kind', 'separation']) e.fields.removeByName(n);
    app.save(e);
  },
);
