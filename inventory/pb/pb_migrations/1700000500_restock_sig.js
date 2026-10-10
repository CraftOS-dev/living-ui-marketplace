/// <reference path="../pb_data/types.d.ts" />
// The auto-restock memory (the ids of the items last asked about) holds any
// realistic number of items: 4000 characters stopped at 250 items.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('settings');
    col.fields.getByName('restock_sig').max = 200000;
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('settings');
    col.fields.getByName('restock_sig').max = 4000;
    app.save(col);
  },
);
