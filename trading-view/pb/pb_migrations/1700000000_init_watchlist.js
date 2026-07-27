/// <reference path="../pb_data/types.d.ts" />
/**
 * Trading View schema. Market data (quotes, candles) is proxied live from
 * Yahoo Finance by pb_hooks/ops.pb.js and never stored — only the user's
 * watchlist persists. Auth mode "none": open rules are acceptable because
 * the app binds loopback.
 */
migrate(
  (app) => {
    const watchlist = new Collection({
      type: 'base',
      name: 'watchlist',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'symbol', type: 'text', required: true, max: 12 },
        { name: 'name', type: 'text', max: 120 },
        { name: 'position', type: 'number' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_watchlist_symbol ON watchlist (symbol)'],
    });
    app.save(watchlist);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('watchlist'));
  },
);
