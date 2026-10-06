/// <reference path="../pb_data/types.d.ts" />
/** Scan runs can be triggered by a sensor report, not only the schedule or a person. */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('scan_runs');
    c.fields.getByName('trigger').values = ['schedule', 'manual', 'sensor'];
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('scan_runs');
    c.fields.getByName('trigger').values = ['schedule', 'manual'];
    app.save(c);
  },
);
