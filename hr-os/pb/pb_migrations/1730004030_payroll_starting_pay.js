/// <reference path="../pb_data/types.d.ts" />
/**
 * payroll-core (QA2 N5): a pay change can be a joiner's starting pay, reason
 * hire (the kernel's pay_records already use it).
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('comp_changes');
    const f = c.fields.getByName('reason');
    if (f.values.indexOf('hire') < 0) f.values = ['hire'].concat(f.values);
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('comp_changes');
    const f = c.fields.getByName('reason');
    f.values = f.values.filter((v) => v !== 'hire');
    app.save(c);
  },
);
