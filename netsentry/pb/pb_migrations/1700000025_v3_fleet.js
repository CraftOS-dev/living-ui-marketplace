/// <reference path="../pb_data/types.d.ts" />
/**
 * v3 M6 — many machines (docs/SYSTEM-V3-PLAN.md §14): changes made to several
 * apps or machines at once run one at a time, in order, and stop at the first
 * failure. `batch` groups them; `batch_order` is their place in the line.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('remediations');
    c.fields.add(new TextField({ name: 'batch', max: 40 }));
    c.fields.add(new NumberField({ name: 'batch_order', onlyInt: true, min: 0, max: 10000 }));
    c.addIndex('idx_remediations_batch', false, 'batch, batch_order', '');
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('remediations');
    c.removeIndex('idx_remediations_batch');
    c.fields.removeByName('batch');
    c.fields.removeByName('batch_order');
    app.save(c);
  },
);
