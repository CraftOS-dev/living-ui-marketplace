/// <reference path="../pb_data/types.d.ts" />
/**
 * "Check now" for a machine: the console cannot run the checks itself (they
 * run on the machine), so it leaves a request the monitor picks up at its next
 * check-in and then runs every check straight away.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('sensors');
    c.fields.add(new DateField({ name: 'run_requested' }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('sensors');
    c.fields.removeByName('run_requested');
    app.save(c);
  },
);
