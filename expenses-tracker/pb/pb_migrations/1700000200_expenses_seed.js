/// <reference path="../pb_data/types.d.ts" />
/**
 * First-open data: the one settings row and a starter set of categories the
 * user can rename, re-emoji or delete. No expenses are seeded.
 */
migrate(
  (app) => {
    const settings = new Record(app.findCollectionByNameOrId('settings'));
    settings.set('currency', 'USD');
    settings.set('currency_confirmed', false);
    settings.set('monthly_budget', 0);
    app.save(settings);

    const starter = [
      ['Food and drink', '🍜'],
      ['Groceries', '🛒'],
      ['Transport', '🚌'],
      ['Shopping', '🛍️'],
      ['Bills', '💡'],
      ['Home', '🏠'],
      ['Health', '💊'],
      ['Fun', '🎬'],
      ['Travel', '✈️'],
      ['Subscriptions', '🔁'],
      ['Gifts', '🎁'],
      ['Other', '📦'],
    ];
    const categories = app.findCollectionByNameOrId('categories');
    starter.forEach(([name, emoji], i) => {
      const rec = new Record(categories);
      rec.set('name', name);
      rec.set('emoji', emoji);
      rec.set('budget', 0);
      rec.set('sort', i + 1);
      app.save(rec);
    });
  },
  (app) => {
    for (const name of ['settings', 'categories']) {
      const rows = app.findRecordsByFilter(name, '', '', 0, 0);
      for (const r of rows) app.delete(r);
    }
  },
);
