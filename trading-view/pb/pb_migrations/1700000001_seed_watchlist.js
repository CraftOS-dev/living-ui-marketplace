/// <reference path="../pb_data/types.d.ts" />
/** Seed a starter watchlist so the app shows real data on first launch. */
migrate(
  (app) => {
    const watchlist = app.findCollectionByNameOrId('watchlist');
    [
      ['AAPL', 'Apple Inc.'],
      ['MSFT', 'Microsoft Corporation'],
      ['GOOGL', 'Alphabet Inc.'],
      ['NVDA', 'NVIDIA Corporation'],
      ['TSLA', 'Tesla, Inc.'],
    ].forEach(([symbol, name], i) => {
      const record = new Record(watchlist);
      record.set('symbol', symbol);
      record.set('name', name);
      record.set('position', i);
      app.save(record);
    });
  },
  () => {
    // Seed data only — the schema down-migration removes the collection.
  },
);
