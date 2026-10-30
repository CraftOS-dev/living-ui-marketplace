/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: app guide and context, settings, market data and chart
 * readings.
 *
 * Every route here is declared in operations.json, and the UI calls the same
 * routes, so the AI agent (agent-app CLI) can do everything the person can.
 * Routes run in isolated VMs: each handler requires its modules inside itself.
 */

/* --------------------------------------------------------------- app guide */

routerAdd('POST', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));

routerAdd('GET', '/api/ops/app/context', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).context(app)));

/* ---------------------------------------------------------------- settings */

routerAdd('GET', '/api/ops/settings/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ws = require(`${__hooks}/lib_workspace.js`);
    return ws.serializeSettings(ws.settingsRow(app));
  }),
);

routerAdd('POST', '/api/ops/settings/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ws = require(`${__hooks}/lib_workspace.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = ws.settingsRow(app);
    const names = ['palette', 'tz_mode', 'agent_markup', 'sound'].filter((k) => u.has(p, k));
    if (names.length === 0) throw u.fail(400, 'Nothing to change: give palette, tz_mode, agent_markup or sound');
    const before = act.pick(rec, names);
    if (u.has(p, 'palette')) rec.set('palette', u.oneOf(p, 'palette', ['green_red', 'blue_orange', 'red_green'], 'green_red'));
    if (u.has(p, 'tz_mode')) rec.set('tz_mode', u.oneOf(p, 'tz_mode', ['exchange', 'local', 'utc'], 'exchange'));
    if (u.has(p, 'agent_markup')) rec.set('agent_markup', u.bool(p, 'agent_markup', true));
    if (u.has(p, 'sound')) rec.set('sound', u.bool(p, 'sound', true));
    app.save(rec);
    act.record(app, { who: u.actor(e), op: 'settings.update', summary: 'Changed settings: ' + names.join(', ').replace(/_/g, ' '), type: 'settings', id: rec.id, undo: [{ do: 'restore', c: 'settings', id: rec.id, fields: before }], merge: true });
    return ws.serializeSettings(rec);
  }),
);

/* ------------------------------------------------------------------ market */

routerAdd('GET', '/api/ops/market/search', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const q = u.str(p, 'q', '');
    if (q === '') throw u.fail(400, 'q is required: a ticker, company or coin name, e.g. "apple", "EURUSD" or "sol"');
    return { results: require(`${__hooks}/lib_market.js`).search(app, q, u.int(p, 'limit', 12, 1, 30)) };
  }),
);

routerAdd('GET', '/api/ops/market/quotes', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const syms = u.list(p, 'symbols', true);
    if (!syms || syms.length === 0) throw u.fail(400, 'symbols is required: a JSON list or comma-separated, e.g. "AAPL, ^GSPC, BINANCE:BTCUSDT"');
    if (syms.length > 200) throw u.fail(400, 'At most 200 symbols per call');
    return require(`${__hooks}/lib_market.js`).quotes(app, syms);
  }),
);

routerAdd('GET', '/api/ops/market/bars', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const s = m.series(app, u.req(p, 'symbol'), u.str(p, 'interval', '1D'), {
      count: u.int(p, 'count', 300, 1, m.MAX_BARS),
      before: u.int(p, 'before', 0, 0, 4102444800),
      ext: u.bool(p, 'ext', false),
      force: u.bool(p, 'fresh', false),
    });
    const out = { symbol: s.symbol, interval: s.interval, ext: s.ext, meta: s.meta, count: s.bars.length, complete: s.complete, stale: s.stale, error: s.error };
    if (u.str(p, 'format', 'rows') === 'objects') out.bars = s.bars;
    else out.bars = m.rows(s.bars);
    return out;
  }),
);

routerAdd('GET', '/api/ops/market/info', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const meta = m.meta(app, u.req(p, 'symbol'));
    const q = m.quotes(app, [meta.symbol]).quotes[meta.symbol] || null;
    let stats = null;
    try {
      const d = m.series(app, meta.symbol, '1D', { count: 300 });
      const sc = require(`${__hooks}/lib_screener.js`);
      stats = sc.technicals(d.bars);
      const bars = d.bars;
      const n = bars.length;
      if (n > 0) {
        let vol = 0;
        let k = 0;
        for (let i = Math.max(0, n - 31); i < n - 1; i++) {
          vol += bars[i].v || 0;
          k++;
        }
        stats.avg_volume_30d = k > 0 ? vol / k : null;
        stats.open = bars[n - 1].o;
        stats.atr14 = stats.atr_pct !== null && bars[n - 1].c ? (stats.atr_pct * bars[n - 1].c) / 100 : null;
        let hi = -Infinity;
        let lo = Infinity;
        for (let i = Math.max(0, n - 252); i < n; i++) {
          hi = Math.max(hi, bars[i].h);
          lo = Math.min(lo, bars[i].l);
        }
        stats.high_52w = hi;
        stats.low_52w = lo;
      }
    } catch (err) {
      stats = { error: String((err && err.message) || err) };
    }
    let events = null;
    try {
      events = m.events(app, meta.symbol);
    } catch {
      events = null;
    }
    return { meta: meta, quote: q, stats: stats, events: events, live: m.isLive(meta, Math.floor(Date.now() / 1000)) };
  }),
);

routerAdd('GET', '/api/ops/market/news', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { news: require(`${__hooks}/lib_market.js`).news(app, u.str(p, 'symbol', ''), u.str(p, 'q', ''), u.int(p, 'limit', 12, 1, 30)) };
  }),
);

routerAdd('GET', '/api/ops/market/events', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_market.js`).events(app, u.req(p, 'symbol'));
  }),
);

routerAdd('GET', '/api/ops/market/health', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_market.js`).health(app)));

/**
 * One call per refresh tick of the open app: quotes for every visible
 * symbol, the newest bars of every visible chart, and alert news. Price
 * alerts of the quoted symbols are checked on the way.
 */
routerAdd('POST', '/api/ops/market/live', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const m = require(`${__hooks}/lib_market.js`);
    const syms = (u.list(p, 'symbols', true) || []).slice(0, 200);
    const series = (u.list(p, 'series', true) || []).slice(0, 40);
    const q = syms.length > 0 ? m.quotes(app, syms) : { quotes: {}, missing: [] };
    const tails = {};
    for (const key of series) {
      const parts = String(key).split('|');
      try {
        const s = m.series(app, parts[0], parts[1] || '1D', { count: 3, ext: parts[2] === 'x' });
        tails[key] = { bars: m.rows(s.bars), stale: s.stale, error: s.error };
      } catch (err) {
        tails[key] = { bars: [], stale: true, error: String((err && err.message) || err) };
      }
    }
    let fired = 0;
    try {
      fired = require(`${__hooks}/lib_alerts.js`).checkQuotes(app, q.quotes);
    } catch (err) {
      console.warn('[trading-view] alert check failed:', err);
    }
    return { quotes: q.quotes, missing: q.missing, tails: tails, health: m.health(app), fired: fired, at: Date.now() };
  }),
);

/* ---------------------------------------------------------- chart readings */

routerAdd('GET', '/api/ops/indicators/catalogue', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, () => ({ indicators: require(`${__hooks}/lib_ta.js`).CATALOGUE })),
);

routerAdd('GET', '/api/ops/chart/indicators', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_chart.js`).indicators(app, u.req(p, 'symbol'), u.str(p, 'interval', '1D'), p.indicators, u.int(p, 'tail', 20, 1, 500));
  }),
);

routerAdd('GET', '/api/ops/chart/levels', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_chart.js`).levels(app, u.req(p, 'symbol'), u.str(p, 'interval', '1D'), u.int(p, 'count', 400, 100, 2000));
  }),
);

routerAdd('GET', '/api/ops/chart/explain', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_chart.js`).explain(app, u.req(p, 'symbol'), u.str(p, 'interval', '1D'), { news: u.bool(p, 'news', true) });
  }),
);
