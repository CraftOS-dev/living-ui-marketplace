/// <reference path="../pb_data/types.d.ts" />
/**
 * Fixes also carry an everyday-language title for the Simple view
 * ("Fix: <the issue in plain words>"); `title` stays the technical one.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('remediations');
    c.fields.add(new TextField({ name: 'plain_title', max: 300 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('remediations');
    c.fields.removeByName('plain_title');
    app.save(c);
  },
);
