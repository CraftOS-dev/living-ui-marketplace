/// <reference path="../pb_data/types.d.ts" />
/** Setup mode (plan §10): home ("my home server") or organisation ("my organisation's apps"). */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    c.fields.add(new SelectField({ name: 'setup_mode', values: ['home', 'organisation'], maxSelect: 1 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    c.fields.removeByName('setup_mode');
    app.save(c);
  },
);
