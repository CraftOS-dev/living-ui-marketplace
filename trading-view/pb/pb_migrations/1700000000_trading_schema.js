/// <reference path="../pb_data/types.d.ts" />
/**
 * Trading View schema (one person, auth mode none: open rules, loopback only).
 *
 *   settings      one row: up/down palette, time zone mode, the active workspace
 *   workspaces    named layouts (tabs) with their link channels: each channel
 *                 (1..6) holds the symbol and interval its widgets follow
 *   widgets       the drag-and-resize tiles of a workspace: type, grid box,
 *                 link channel and per-widget config (a chart's symbol,
 *                 interval, type, scale, indicators, compares...)
 *   symbols       cached instrument metadata (name, exchange, currency, time
 *                 zone, sessions, price precision)
 *   bars          the persistent OHLCV cache, one row per (symbol|interval, t)
 *   watchlists    named lists; watch_items their rows (symbols and section headers)
 *   drawings      chart drawings per symbol in price/time coordinates, so they
 *                 survive interval changes and appear on every chart of it
 *   alerts        server-evaluated conditions; alert_events their log
 *   analyses      chart analyses written by the AI agent on request
 *   screens       saved custom screener definitions
 *   activity      every change by the person or the AI agent, with the data
 *                 to undo it; agent changes are grouped into runs
 */
migrate(
  (app) => {
    // An install of the first Trading View has its own collections, two of
    // them with names this schema uses (alerts, drawings). Keep what has a
    // clear meaning (the watchlist symbols, price alerts), then retire them.
    const legacy = { watchlist: [], alerts: [] };
    const old = (name) => {
      try {
        return app.findCollectionByNameOrId(name);
      } catch {
        return null;
      }
    };
    const oldWatch = old('watchlist');
    if (oldWatch) {
      for (const r of app.findRecordsByFilter(oldWatch, 'id != ""', 'position', 0, 0)) {
        const sym = String(r.getString('symbol') || '').trim().toUpperCase();
        if (sym !== '' && legacy.watchlist.indexOf(sym) < 0) legacy.watchlist.push(sym);
      }
    }
    const oldAlerts = old('alerts');
    if (oldAlerts && oldAlerts.fields.getByName('price')) {
      for (const r of app.findRecordsByFilter(oldAlerts, 'id != ""', 'created', 0, 0)) {
        const op = r.getString('condition');
        const price = r.getFloat('price');
        if ((op === 'above' || op === 'below') && price > 0) legacy.alerts.push({ symbol: r.getString('symbol').trim().toUpperCase(), op: op, price: price, triggered: r.getBool('triggered') });
      }
    }
    for (const name of ['watchlist', 'alerts', 'drawings', 'prefs']) {
      const c = old(name);
      if (c) app.delete(c);
    }

    const open = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' };
    const stamp = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const save = (def) => {
      const c = new Collection(Object.assign({ type: 'base' }, open, def, { fields: def.fields.concat(stamp) }));
      app.save(c);
      return c;
    };

    save({
      name: 'settings',
      createRule: null,
      deleteRule: null,
      fields: [
        { name: 'palette', type: 'select', maxSelect: 1, values: ['green_red', 'blue_orange', 'red_green'] },
        { name: 'tz_mode', type: 'select', maxSelect: 1, values: ['exchange', 'local', 'utc'] },
        { name: 'active_workspace', type: 'text', max: 40 },
        { name: 'agent_markup', type: 'bool' },
        { name: 'sound', type: 'bool' },
      ],
    });

    const workspaces = save({
      name: 'workspaces',
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'sort', type: 'number' },
        { name: 'links', type: 'json', maxSize: 20000 },
        { name: 'locked', type: 'bool' },
      ],
    });

    save({
      name: 'widgets',
      fields: [
        { name: 'workspace', type: 'relation', required: true, collectionId: workspaces.id, cascadeDelete: true, maxSelect: 1 },
        {
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['chart', 'watchlist', 'details', 'news', 'alerts', 'screener', 'heatmap', 'ticker', 'analyst', 'activity', 'chartgrid'],
        },
        { name: 'link', type: 'text', max: 2 },
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'w', type: 'number' },
        { name: 'h', type: 'number' },
        { name: 'config', type: 'json', maxSize: 200000 },
      ],
      indexes: ['CREATE INDEX idx_widgets_ws ON widgets (workspace)'],
    });

    save({
      name: 'symbols',
      fields: [
        { name: 'symbol', type: 'text', required: true, max: 60 },
        { name: 'provider', type: 'select', maxSelect: 1, values: ['yahoo', 'binance'] },
        { name: 'name', type: 'text', max: 200 },
        { name: 'exchange', type: 'text', max: 80 },
        { name: 'type', type: 'text', max: 30 },
        { name: 'currency', type: 'text', max: 12 },
        { name: 'tz', type: 'text', max: 60 },
        { name: 'price_hint', type: 'number' },
        { name: 'sessions', type: 'json', maxSize: 4000 },
        { name: 'fetched', type: 'date' },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_symbols_symbol ON symbols (symbol)'],
    });

    save({
      name: 'bars',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'key', type: 'text', required: true, max: 80 },
        { name: 't', type: 'number', required: true },
        { name: 'o', type: 'number' },
        { name: 'h', type: 'number' },
        { name: 'l', type: 'number' },
        { name: 'c', type: 'number' },
        { name: 'v', type: 'number' },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_bars_key_t ON bars (key, t)'],
    });

    const watchlists = save({
      name: 'watchlists',
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'sort', type: 'number' },
        { name: 'columns', type: 'json', maxSize: 4000 },
      ],
    });

    save({
      name: 'watch_items',
      fields: [
        { name: 'list', type: 'relation', required: true, collectionId: watchlists.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['symbol', 'section'] },
        { name: 'symbol', type: 'text', max: 60 },
        { name: 'label', type: 'text', max: 80 },
        { name: 'flag', type: 'text', max: 12 },
        { name: 'note', type: 'text', max: 2000 },
        { name: 'sort', type: 'number' },
      ],
      indexes: ['CREATE INDEX idx_watch_items_list ON watch_items (list)'],
    });

    save({
      name: 'drawings',
      fields: [
        { name: 'symbol', type: 'text', required: true, max: 60 },
        {
          name: 'tool',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['trend', 'ray', 'extended', 'hline', 'hray', 'vline', 'rect', 'channel', 'fib', 'long', 'short', 'measure', 'text', 'arrow_up', 'arrow_down'],
        },
        { name: 'points', type: 'json', maxSize: 4000 },
        { name: 'style', type: 'json', maxSize: 2000 },
        { name: 'text', type: 'text', max: 500 },
        { name: 'locked', type: 'bool' },
        { name: 'hidden', type: 'bool' },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'note', type: 'text', max: 1000 },
      ],
      indexes: ['CREATE INDEX idx_drawings_symbol ON drawings (symbol)'],
    });

    const alerts = save({
      name: 'alerts',
      fields: [
        { name: 'symbol', type: 'text', required: true, max: 60 },
        { name: 'interval', type: 'text', max: 8 },
        { name: 'condition', type: 'json', maxSize: 4000 },
        { name: 'frequency', type: 'select', maxSelect: 1, values: ['once', 'once_per_bar', 'every'] },
        { name: 'expires', type: 'date' },
        { name: 'status', type: 'select', maxSelect: 1, values: ['active', 'paused', 'triggered', 'expired'] },
        { name: 'message', type: 'text', max: 500 },
        { name: 'notify_agent', type: 'bool' },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'last_value', type: 'number' },
        { name: 'last_bar', type: 'number' },
        { name: 'last_checked', type: 'date' },
        { name: 'last_fired', type: 'date' },
        { name: 'fired_count', type: 'number' },
        { name: 'error', type: 'text', max: 500 },
      ],
      indexes: ['CREATE INDEX idx_alerts_status ON alerts (status)'],
    });

    save({
      name: 'alert_events',
      fields: [
        { name: 'alert', type: 'relation', collectionId: alerts.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'symbol', type: 'text', max: 60 },
        { name: 'price', type: 'number' },
        { name: 'value', type: 'number' },
        { name: 'detail', type: 'text', max: 1000 },
        { name: 'seen', type: 'bool' },
        { name: 'agent_state', type: 'select', maxSelect: 1, values: ['waiting', 'working', 'done', 'failed'] },
        { name: 'agent_note', type: 'text', max: 4000 },
        { name: 'agent_at', type: 'date' },
      ],
      indexes: ['CREATE INDEX idx_alert_events_agent ON alert_events (agent_state)'],
    });

    save({
      name: 'analyses',
      fields: [
        { name: 'kind', type: 'select', maxSelect: 1, values: ['symbol', 'watchlist'] },
        { name: 'symbol', type: 'text', max: 60 },
        { name: 'watchlist', type: 'text', max: 40 },
        { name: 'interval', type: 'text', max: 8 },
        { name: 'state', type: 'select', maxSelect: 1, values: ['waiting', 'working', 'done', 'failed'] },
        { name: 'focus', type: 'text', max: 1000 },
        { name: 'summary', type: 'text', max: 20000 },
        { name: 'bias', type: 'select', maxSelect: 1, values: ['bullish', 'bearish', 'neutral', 'mixed'] },
        { name: 'levels', type: 'json', maxSize: 8000 },
        { name: 'facts', type: 'json', maxSize: 40000 },
        { name: 'error', type: 'text', max: 1000 },
        { name: 'requested_at', type: 'date' },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
        { name: 'run', type: 'text', max: 40 },
      ],
      indexes: ['CREATE INDEX idx_analyses_symbol ON analyses (symbol)'],
    });

    save({
      name: 'screens',
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'universe', type: 'text', max: 80 },
        { name: 'criteria', type: 'json', maxSize: 8000 },
        { name: 'sort', type: 'text', max: 40 },
        { name: 'note', type: 'text', max: 2000 },
        { name: 'run', type: 'text', max: 40 },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
      ],
    });

    save({
      name: 'activity',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'actor', type: 'select', required: true, maxSelect: 1, values: ['user', 'agent'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'op', type: 'text', max: 60 },
        { name: 'summary', type: 'text', max: 500 },
        { name: 'target_type', type: 'text', max: 30 },
        { name: 'target_id', type: 'text', max: 40 },
        { name: 'symbol', type: 'text', max: 60 },
        { name: 'undo', type: 'json', maxSize: 400000 },
        { name: 'redo', type: 'json', maxSize: 400000 },
        { name: 'undone', type: 'bool' },
      ],
      indexes: ['CREATE INDEX idx_activity_run ON activity (run)'],
    });

    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('palette', 'green_red');
    s.set('tz_mode', 'exchange');
    s.set('agent_markup', true);
    s.set('sound', true);
    app.save(s);

    if (legacy.watchlist.length > 0) {
      const list = new Record(app.findCollectionByNameOrId('watchlists'));
      list.set('name', 'My watchlist');
      list.set('sort', 0);
      list.set('columns', ['last', 'chg', 'chg_pct']);
      app.save(list);
      legacy.watchlist.forEach((sym, i) => {
        const it = new Record(app.findCollectionByNameOrId('watch_items'));
        it.set('list', list.id);
        it.set('kind', 'symbol');
        it.set('symbol', sym);
        it.set('sort', i);
        app.save(it);
      });
    }
    for (const a of legacy.alerts) {
      const r = new Record(app.findCollectionByNameOrId('alerts'));
      r.set('symbol', a.symbol);
      r.set('interval', '1D');
      r.set('condition', { left: { type: 'price' }, op: a.op, right: { type: 'value', value: a.price } });
      r.set('frequency', 'once');
      r.set('status', a.triggered ? 'triggered' : 'active');
      r.set('added_by', 'user');
      r.set('fired_count', a.triggered ? 1 : 0);
      app.save(r);
    }
  },
  (app) => {
    for (const name of ['activity', 'screens', 'analyses', 'alert_events', 'alerts', 'drawings', 'watch_items', 'watchlists', 'bars', 'symbols', 'widgets', 'workspaces', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
