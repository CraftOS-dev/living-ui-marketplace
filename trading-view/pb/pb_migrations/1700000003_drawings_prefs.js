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
        // Dashboard grid: react-grid-layout Layouts {lg,md,sm} (V1 parity)
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
    row.set('layout', {
      lg: [
        { i: 'chart', x: 0, y: 0, w: 8, h: 12, minW: 4, minH: 6 },
        { i: 'watchlist', x: 8, y: 0, w: 4, h: 8, minW: 3, minH: 4 },
        { i: 'details', x: 8, y: 8, w: 4, h: 4, minW: 3, minH: 3 },
        { i: 'news', x: 0, y: 12, w: 6, h: 6, minW: 3, minH: 3 },
        { i: 'screener', x: 6, y: 12, w: 6, h: 6, minW: 4, minH: 4 },
      ],
      md: [
        { i: 'chart', x: 0, y: 0, w: 6, h: 10, minW: 4, minH: 6 },
        { i: 'watchlist', x: 6, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
        { i: 'details', x: 6, y: 6, w: 4, h: 4, minW: 3, minH: 3 },
        { i: 'news', x: 0, y: 10, w: 5, h: 5, minW: 3, minH: 3 },
        { i: 'screener', x: 5, y: 10, w: 5, h: 5, minW: 4, minH: 4 },
      ],
      sm: [
        { i: 'chart', x: 0, y: 0, w: 4, h: 8, minW: 4, minH: 6 },
        { i: 'watchlist', x: 0, y: 8, w: 4, h: 6, minW: 3, minH: 4 },
        { i: 'details', x: 0, y: 14, w: 4, h: 4, minW: 3, minH: 3 },
        { i: 'news', x: 0, y: 18, w: 4, h: 5, minW: 3, minH: 3 },
        { i: 'screener', x: 0, y: 23, w: 4, h: 5, minW: 4, minH: 4 },
      ],
    });
    app.save(row);
  },
  (app) => {
    for (const name of ['prefs', 'drawings']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
