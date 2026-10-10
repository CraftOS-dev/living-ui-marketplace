/// <reference path="../pb_data/types.d.ts" />
/**
 * First-open data: the one settings row, a starter set of categories the
 * user can rename or delete, and one place to keep stock. No items, no
 * stock and no sample data.
 */
migrate(
  (app) => {
    const settings = new Record(app.findCollectionByNameOrId('settings'));
    settings.set('currency', 'USD');
    settings.set('currency_confirmed', false);
    settings.set('allow_negative', false);
    settings.set('auto_restock', false);
    settings.set('restock_sig', '');
    settings.set('restock_asked_on', '');
    app.save(settings);

    const starter = [
      ['General', 'package'],
      ['Supplies', 'box'],
      ['Tools', 'wrench'],
      ['Electronics', 'cpu'],
      ['Packaging', 'archive'],
      ['Cleaning', 'spray-can'],
      ['Office', 'printer'],
      ['Food and drink', 'coffee'],
    ];
    const categories = app.findCollectionByNameOrId('categories');
    starter.forEach((row, i) => {
      const rec = new Record(categories);
      rec.set('name', row[0]);
      rec.set('icon', row[1]);
      rec.set('sort', i + 1);
      app.save(rec);
    });

    const main = new Record(app.findCollectionByNameOrId('locations'));
    main.set('name', 'Main stockroom');
    main.set('code', 'LOC-001');
    main.set('kind', 'room');
    main.set('notes', '');
    main.set('sort', 1);
    app.save(main);
  },
  (app) => {
    for (const name of ['locations', 'categories', 'settings']) {
      for (const r of app.findRecordsByFilter(name, '', '', 0, 0)) app.delete(r);
    }
  },
);
