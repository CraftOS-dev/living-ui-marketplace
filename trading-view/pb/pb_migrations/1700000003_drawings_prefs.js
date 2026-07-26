/// <reference path="../pb_data/types.d.ts" />
/**
 * Chart drawings (per symbol, stored in data coordinates so they survive
 * range/interval changes) and a single-row layout/preferences record.
 */
migrate(
  (app) => {
    const drawings = new Collection({
      type: 'base',
      name: 'drawings',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'symbol', type: 'text', required: true, max: 12 },
        { name: 'type', type: 'select', maxSelect: 1, values: ['trendline', 'hline'] },
        // [{t: unixSeconds, price: number}] — one point for hline, two for trendline
        { name: 'points', type: 'json', required: true },
        { name: 'color', type: 'text', max: 20 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
    });
    app.save(drawings);

    const prefs = new Collection({
      type: 'base',
      name: 'prefs',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'range', type: 'text', max: 8 },
        { name: 'sma20', type: 'bool' },
        { name: 'sma50', type: 'bool' },
        { name: 'rsi', type: 'bool' },
        { name: 'ema20', type: 'bool' },
        { name: 'bb', type: 'bool' },
        { name: 'vwap', type: 'bool' },
        { name: 'macd', type: 'bool' },
        { name: 'show_news', type: 'bool' },
        // Widget order on the symbol panel, e.g. ["details","chart","rsi","macd","news"]
        { name: 'layout', type: 'json' },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(prefs);

    const row = new Record(prefs);
    row.set('range', '6M');
    row.set('sma20', true);
    row.set('sma50', false);
    row.set('rsi', false);
    row.set('ema20', false);
    row.set('bb', false);
    row.set('vwap', false);
    row.set('macd', false);
    row.set('show_news', true);
    row.set('layout', ['details', 'chart', 'rsi', 'macd', 'news']);
    app.save(row);
  },
  (app) => {
    for (const name of ['prefs', 'drawings']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
