/// <reference path="../pb_data/types.d.ts" />
/**
 * payroll-core (QA3 major): an entity's first pay run in a tax year that
 * began earlier needs the year to date figures of people paid before HR OS
 * (opening balances), or a person's confirmation that nobody was paid earlier
 * this tax year. The confirmation is per entity, with who gave it and when.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('payroll_settings');
    c.fields.add(new BoolField({ name: 'no_earlier_pay' }));
    c.fields.add(new RelationField({ name: 'no_earlier_pay_by', maxSelect: 1, collectionId: app.findCollectionByNameOrId('members').id, cascadeDelete: false }));
    c.fields.add(new TextField({ name: 'no_earlier_pay_at', max: 40 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('payroll_settings');
    for (const n of ['no_earlier_pay', 'no_earlier_pay_by', 'no_earlier_pay_at']) c.fields.removeByName(n);
    app.save(c);
  },
);
