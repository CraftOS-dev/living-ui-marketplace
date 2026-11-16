/// <reference path="../pb_data/types.d.ts" />
/**
 * payroll-core fix: pay components get the role advance_payout (the ADVANCE
 * component Expenses pays advances with), next to advance (recovery).
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('pay_components');
    const f = c.fields.getByName('role');
    if (f.values.indexOf('advance_payout') < 0) f.values = f.values.concat(['advance_payout']);
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('pay_components');
    const f = c.fields.getByName('role');
    f.values = f.values.filter((v) => v !== 'advance_payout');
    app.save(c);
  },
);
