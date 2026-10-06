/// <reference path="../pb_data/types.d.ts" />
/** When a failing check last pushed an alert (plan §11: at most one push per issue per day unless it gets worse). */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('evaluations');
    c.fields.add(new DateField({ name: 'alerted_at' }));
    c.fields.add(new TextField({ name: 'alerted_severity', max: 20 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('evaluations');
    c.fields.removeByName('alerted_at');
    c.fields.removeByName('alerted_severity');
    app.save(c);
  },
);
