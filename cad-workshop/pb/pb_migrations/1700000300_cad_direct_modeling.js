/// <reference path="../pb_data/types.d.ts" />
/**
 * Direct modeling: the push_pull feature kind, and the CAD mouse default
 * (left click and drag select, right drag turns the view, middle drag pans).
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('features');
    const kind = c.fields.getByName('kind');
    kind.values = kind.values.concat(['push_pull']);
    app.save(c);
    for (const s of app.findRecordsByFilter('settings', "navigation = 'left_rotates'", '', 0, 0)) {
      s.set('navigation', 'right_rotates');
      app.save(s);
    }
  },
  (app) => {
    const c = app.findCollectionByNameOrId('features');
    const kind = c.fields.getByName('kind');
    kind.values = kind.values.filter((v) => v !== 'push_pull');
    app.save(c);
  },
);
