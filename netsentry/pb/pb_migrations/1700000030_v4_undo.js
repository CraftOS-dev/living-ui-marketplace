/// <reference path="../pb_data/types.d.ts" />
/**
 * v4 §7 "Undo": a change that worked can be undone afterwards (a deleted file back from the bin, an
 * edit's previous copy, settings as they were, a firewall rule or key reversed) — by the monitor,
 * from what IT recorded when it made the change. Such a change ends as "undone".
 */
migrate(
  (app) => {
    const rem = app.findCollectionByNameOrId('remediations');
    const status = rem.fields.getByName('status');
    if (status.values.indexOf('undone') < 0) status.values = status.values.concat(['undone']);
    app.save(rem);
  },
  (app) => {
    const rem = app.findCollectionByNameOrId('remediations');
    for (const r of app.findRecordsByFilter('remediations', 'status = "undone"', '', 0, 0)) {
      r.set('status', 'done');
      app.save(r);
    }
    const status = rem.fields.getByName('status');
    status.values = status.values.filter((v) => v !== 'undone');
    app.save(rem);
  },
);
