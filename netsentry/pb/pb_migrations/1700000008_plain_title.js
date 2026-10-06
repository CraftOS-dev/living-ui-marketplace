/// <reference path="../pb_data/types.d.ts" />
/**
 * Every issue also carries an everyday-language title (the "Simple" view);
 * `title` stays the technical one. Filled from lib/rules/plain.js when the
 * issue is created or re-checked, and backfilled at boot for older issues.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('findings');
    c.fields.add(new TextField({ name: 'plain_title', max: 300 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('findings');
    c.fields.removeByName('plain_title');
    app.save(c);
  },
);
