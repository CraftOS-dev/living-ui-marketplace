/// <reference path="../pb_data/types.d.ts" />
/**
 * Workspaces (the tabs), their widgets and link channels, and settings.
 *
 * The grid is 24 columns by 36 rows sized to the window, so a layout fills
 * the screen at any size; widgets placed below row 36 scroll.
 *
 * Link channels "1".."6" each hold a symbol and an interval. A widget on a
 * channel follows it: picking a row in a linked watchlist shows that symbol
 * in every chart, details and news widget of the channel. A widget with no
 * channel keeps its own symbol in its config.
 */

const COLS = 24;
const ROWS = 36;
const CHANNELS = ['1', '2', '3', '4', '5', '6'];
const TYPES = ['chart', 'watchlist', 'details', 'news', 'alerts', 'screener', 'heatmap', 'ticker', 'analyst', 'activity', 'chartgrid'];
const CHART_TYPES = ['candles', 'hollow', 'bars', 'line', 'area', 'baseline', 'heikin'];
const SCALES = ['normal', 'log', 'percent', 'indexed'];

/** Default size and config of each widget type. */
const WIDGETS = {
  chart: { w: 16, h: 22, minW: 6, minH: 8, config: { interval: '1D', type: 'candles', scale: 'normal', indicators: [{ id: 'volume', params: {} }], compare: [], ext: false } },
  chartgrid: { w: 16, h: 24, minW: 8, minH: 10, config: { intervals: ['1D', '4h', '1h', '15m'], layout: '2x2', type: 'candles' } },
  watchlist: { w: 7, h: 16, minW: 4, minH: 6, config: { list: '', columns: ['last', 'chg', 'chg_pct'] } },
  details: { w: 7, h: 16, minW: 4, minH: 8, config: {} },
  news: { w: 8, h: 12, minW: 4, minH: 5, config: { scope: 'symbol' } },
  alerts: { w: 8, h: 12, minW: 5, minH: 5, config: { tab: 'active' } },
  screener: { w: 14, h: 14, minW: 8, minH: 6, config: { universe: 'us_mega', list: '', criteria: [], sort: 'change_pct', desc: true } },
  heatmap: { w: 10, h: 14, minW: 5, minH: 6, config: { universe: 'us_mega', size: 'equal', group: true } },
  ticker: { w: 24, h: 2, minW: 6, minH: 2, config: { symbols: ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', '^TNX', 'EURUSD=X', 'USDJPY=X', 'GC=F', 'CL=F', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT'] } },
  analyst: { w: 8, h: 14, minW: 5, minH: 8, config: {} },
  activity: { w: 8, h: 12, minW: 5, minH: 5, config: { actor: '' } },
};

/** Ready-made workspaces: name, channel symbols and widgets. */
const TEMPLATES = {
  markets: {
    name: 'Markets',
    links: { 1: { symbol: '^GSPC', interval: '1D' }, 2: { symbol: 'AAPL', interval: '1h' } },
    widgets: [
      { type: 'ticker', link: '', x: 0, y: 0, w: 24, h: 2 },
      { type: 'chart', link: '1', x: 0, y: 2, w: 17, h: 23 },
      { type: 'watchlist', link: '1', x: 17, y: 2, w: 7, h: 15, config: { list: '@Core' } },
      { type: 'details', link: '1', x: 17, y: 17, w: 7, h: 19 },
      { type: 'news', link: '1', x: 0, y: 25, w: 9, h: 11 },
      { type: 'analyst', link: '1', x: 9, y: 25, w: 8, h: 11 },
    ],
  },
  crypto: {
    name: 'Crypto',
    links: { 1: { symbol: 'BINANCE:BTCUSDT', interval: '1h' } },
    widgets: [
      { type: 'ticker', link: '', x: 0, y: 0, w: 24, h: 2, config: { symbols: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:BNBUSDT', 'BINANCE:XRPUSDT', 'BINANCE:DOGEUSDT', 'BINANCE:ADAUSDT', 'BINANCE:AVAXUSDT', 'BINANCE:LINKUSDT', 'BINANCE:ETHBTC'] } },
      { type: 'chart', link: '1', x: 0, y: 2, w: 16, h: 22, config: { interval: '1h', indicators: [{ id: 'volume', params: {} }, { id: 'ema', params: { length: 21 } }, { id: 'ema', params: { length: 55 } }, { id: 'rsi', params: {} }] } },
      { type: 'watchlist', link: '1', x: 16, y: 2, w: 8, h: 14, config: { list: '@Crypto' } },
      { type: 'heatmap', link: '1', x: 16, y: 16, w: 8, h: 20, config: { universe: 'crypto', size: 'volume', group: false } },
      { type: 'chart', link: '1', x: 0, y: 24, w: 8, h: 12, config: { interval: '15m', interval_own: true, indicators: [] } },
      { type: 'news', link: '1', x: 8, y: 24, w: 8, h: 12 },
    ],
  },
  multi: {
    name: 'Multi-timeframe',
    links: { 1: { symbol: 'NVDA', interval: '1D' } },
    widgets: [
      { type: 'chartgrid', link: '1', x: 0, y: 0, w: 18, h: 36 },
      { type: 'watchlist', link: '1', x: 18, y: 0, w: 6, h: 18, config: { list: '@Core' } },
      { type: 'details', link: '1', x: 18, y: 18, w: 6, h: 18 },
    ],
  },
  research: {
    name: 'Research',
    links: { 1: { symbol: 'MSFT', interval: '1D' } },
    widgets: [
      { type: 'chart', link: '1', x: 0, y: 0, w: 14, h: 22, config: { indicators: [{ id: 'volume', params: {} }, { id: 'sma', params: { length: 50 } }, { id: 'sma', params: { length: 200 } }, { id: 'macd', params: {} }] } },
      { type: 'analyst', link: '1', x: 14, y: 0, w: 10, h: 22 },
      { type: 'screener', link: '1', x: 0, y: 22, w: 14, h: 14 },
      { type: 'heatmap', link: '1', x: 14, y: 22, w: 10, h: 14 },
    ],
  },
  blank: { name: 'Workspace', links: { 1: { symbol: 'AAPL', interval: '1D' } }, widgets: [{ type: 'chart', link: '1', x: 0, y: 0, w: 24, h: 36 }] },
};

const DEFAULT_LISTS = [
  {
    name: 'Core',
    items: [
      { section: 'Indices' },
      '^GSPC',
      '^IXIC',
      '^DJI',
      '^RUT',
      '^VIX',
      { section: 'Mega caps' },
      'AAPL',
      'MSFT',
      'NVDA',
      'AMZN',
      'GOOGL',
      'META',
      'TSLA',
      { section: 'Rates, FX and commodities' },
      '^TNX',
      'EURUSD=X',
      'USDJPY=X',
      'GC=F',
      'CL=F',
    ],
  },
  {
    name: 'Crypto',
    items: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:BNBUSDT', 'BINANCE:XRPUSDT', 'BINANCE:DOGEUSDT', 'BINANCE:ADAUSDT', 'BINANCE:AVAXUSDT', 'BINANCE:LINKUSDT', 'BINANCE:ETHBTC'],
  },
];

/* --------------------------------------------------------------- settings */

function settingsRow(app) {
  const rows = app.findRecordsByFilter('settings', 'id != ""', 'created', 1, 0);
  if (rows.length > 0) return rows[0];
  const rec = new Record(app.findCollectionByNameOrId('settings'));
  rec.set('palette', 'green_red');
  rec.set('tz_mode', 'exchange');
  rec.set('agent_markup', true);
  rec.set('sound', true);
  app.save(rec);
  return rec;
}

function serializeSettings(rec) {
  return {
    id: rec.id,
    palette: rec.getString('palette') || 'green_red',
    tz_mode: rec.getString('tz_mode') || 'exchange',
    active_workspace: rec.getString('active_workspace'),
    agent_markup: rec.getBool('agent_markup'),
    sound: rec.getBool('sound'),
  };
}

/* -------------------------------------------------------------- serialize */

function serializeWidget(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    workspace: rec.getString('workspace'),
    type: rec.getString('type'),
    link: rec.getString('link'),
    x: rec.getInt('x'),
    y: rec.getInt('y'),
    w: rec.getInt('w'),
    h: rec.getInt('h'),
    config: u.json(rec, 'config', {}) || {},
  };
}

function serializeWorkspace(rec, widgets) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = {
    id: rec.id,
    name: rec.getString('name'),
    sort: rec.getInt('sort'),
    links: u.json(rec, 'links', {}) || {},
    locked: rec.getBool('locked'),
  };
  if (widgets) out.widgets = widgets.map(serializeWidget);
  return out;
}

function widgetsOf(app, wsId) {
  return app.findRecordsByFilter('widgets', 'workspace = {:w}', 'y,x', 0, 0, { w: wsId });
}

/* ----------------------------------------------------------------- seeding */

/**
 * Default watchlists and workspaces on first use (only when there are none).
 * The UI's first requests arrive together, so the emptiness check runs inside
 * the write transaction: writes are serialized, and a second caller sees the
 * first one's rows.
 */
function ensureSeed(app) {
  if (app.store().get('tv_seeded') === true) return;
  app.runInTransaction((tx) => {
    const lib = require(`${__hooks}/lib_workspace.js`);
    const spaces = tx.findRecordsByFilter('workspaces', 'id != ""', '', 1, 0);
    if (spaces.length > 0) return;
    // Default lists are added next to any the person already has (an upgrade
    // from the first Trading View brings "My watchlist").
    const ids = Object.assign(lib.listIds(tx), lib.seedLists(tx));
    let first = '';
    let sort = 0;
    for (const key of ['markets', 'crypto', 'multi', 'research']) {
      const ws = lib.fromTemplate(tx, key, null, sort++, ids);
      if (first === '') first = ws.id;
    }
    const s = lib.settingsRow(tx);
    s.set('active_workspace', first);
    tx.save(s);
  });
  app.store().set('tv_seeded', true);
}

/** The default watchlists that do not exist yet (by name); returns {'@Name': id}. */
function seedLists(app) {
  const ids = {};
  let sort = 0;
  for (const l of app.findRecordsByFilter('watchlists', 'id != ""', '', 0, 0)) sort = Math.max(sort, l.getInt('sort') + 1);
  for (const def of DEFAULT_LISTS) {
    if (app.findRecordsByFilter('watchlists', 'name = {:n}', '', 1, 0, { n: def.name }).length > 0) continue;
    const l = new Record(app.findCollectionByNameOrId('watchlists'));
    l.set('name', def.name);
    l.set('sort', sort++);
    l.set('columns', ['last', 'chg', 'chg_pct']);
    app.save(l);
    ids['@' + def.name] = l.id;
    let n = 0;
    for (const it of def.items) {
      const r = new Record(app.findCollectionByNameOrId('watch_items'));
      r.set('list', l.id);
      if (typeof it === 'string') {
        r.set('kind', 'symbol');
        r.set('symbol', it);
      } else {
        r.set('kind', 'section');
        r.set('label', it.section);
      }
      r.set('sort', n++);
      app.save(r);
    }
  }
  return ids;
}

function listIds(app) {
  const ids = {};
  for (const l of app.findRecordsByFilter('watchlists', 'id != ""', 'sort', 0, 0)) ids['@' + l.getString('name')] = l.id;
  return ids;
}

/** Create a workspace from a template; `@Name` list references resolve to watchlist ids. */
function fromTemplate(app, key, name, sort, ids) {
  const t = TEMPLATES[key] || TEMPLATES.blank;
  const ws = new Record(app.findCollectionByNameOrId('workspaces'));
  ws.set('name', name || t.name);
  ws.set('sort', sort);
  ws.set('links', t.links);
  ws.set('locked', false);
  app.save(ws);
  for (const w of t.widgets) {
    const r = new Record(app.findCollectionByNameOrId('widgets'));
    const config = Object.assign({}, WIDGETS[w.type].config, w.config || {});
    if (config.list && config.list.charAt(0) === '@') config.list = (ids && ids[config.list]) || '';
    r.set('workspace', ws.id);
    r.set('type', w.type);
    r.set('link', w.link);
    r.set('x', w.x);
    r.set('y', w.y);
    r.set('w', w.w);
    r.set('h', w.h);
    r.set('config', config);
    app.save(r);
  }
  return ws;
}

/* ------------------------------------------------------------------ lookup */

function mustWorkspace(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!id) {
    const active = settingsRow(app).getString('active_workspace');
    const rec = active ? u.byId(app, 'workspaces', active) : null;
    if (rec) return rec;
    const rows = app.findRecordsByFilter('workspaces', 'id != ""', 'sort', 1, 0);
    if (rows.length > 0) return rows[0];
    throw u.fail(404, 'There is no workspace yet; create one with workspaces.create');
  }
  const rec = u.byId(app, 'workspaces', id);
  if (rec) return rec;
  const byName = app.findRecordsByFilter('workspaces', 'name = {:n}', 'sort', 1, 0, { n: id });
  if (byName.length > 0) return byName[0];
  throw u.fail(404, 'No workspace "' + id + '"; see workspaces.list');
}

function mustWidget(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'widgets', id);
  if (!rec) throw u.fail(404, 'No widget ' + id + '; see workspaces.get for the widgets of a workspace');
  return rec;
}

/**
 * The chart widget an agent means: the given id, else the first chart of
 * the workspace (the active one by default), preferring channel 1.
 */
function chartWidget(app, widgetId, wsId) {
  const u = require(`${__hooks}/lib_util.js`);
  if (widgetId) {
    const w = mustWidget(app, widgetId);
    if (w.getString('type') !== 'chart' && w.getString('type') !== 'chartgrid') throw u.fail(400, 'Widget ' + widgetId + ' is a ' + w.getString('type') + ', not a chart');
    return w;
  }
  const ws = mustWorkspace(app, wsId);
  const charts = app.findRecordsByFilter('widgets', "workspace = {:w} && type = 'chart'", 'y,x', 0, 0, { w: ws.id });
  if (charts.length === 0) throw u.fail(404, 'The workspace "' + ws.getString('name') + '" has no chart; add one with widgets.add --type chart');
  for (const c of charts) if (c.getString('link') === '1') return c;
  return charts[0];
}

/** The symbol and interval a widget shows (its channel's, or its own). */
function resolve(app, widget, ws) {
  const u = require(`${__hooks}/lib_util.js`);
  const config = u.json(widget, 'config', {}) || {};
  const link = widget.getString('link');
  if (link) {
    const wsRec = ws || u.byId(app, 'workspaces', widget.getString('workspace'));
    const links = (wsRec && u.json(wsRec, 'links', {})) || {};
    const ch = links[link] || {};
    return { symbol: ch.symbol || config.symbol || 'AAPL', interval: config.interval_own ? config.interval || '1D' : ch.interval || config.interval || '1D', link: link };
  }
  return { symbol: config.symbol || 'AAPL', interval: config.interval || '1D', link: '' };
}

/** Clamp a grid box to the 24 columns. */
function box(type, x, y, w, h) {
  const d = WIDGETS[type];
  const ww = Math.max(d.minW, Math.min(COLS, Math.round(w || d.w)));
  const hh = Math.max(d.minH, Math.min(200, Math.round(h || d.h)));
  const xx = Math.max(0, Math.min(COLS - ww, Math.round(x || 0)));
  const yy = Math.max(0, Math.min(1000, Math.round(y || 0)));
  return { x: xx, y: yy, w: ww, h: hh };
}

/** Lowest free row: new widgets go below everything else. */
function bottom(app, wsId) {
  let y = 0;
  for (const w of widgetsOf(app, wsId)) y = Math.max(y, w.getInt('y') + w.getInt('h'));
  return y;
}

/* ------------------------------------------------------------ chart config */

/** Validate and normalize a chart widget config patch. */
function chartPatch(app, patch) {
  const u = require(`${__hooks}/lib_util.js`);
  const m = require(`${__hooks}/lib_market.js`);
  const ta = require(`${__hooks}/lib_ta.js`);
  const out = {};
  if (patch.symbol !== undefined) out.symbol = patch.symbol === '' ? '' : m.normalize(patch.symbol);
  if (patch.interval !== undefined) out.interval = m.interval(patch.interval);
  if (patch.type !== undefined) {
    if (CHART_TYPES.indexOf(patch.type) < 0) throw u.fail(400, 'type must be one of: ' + CHART_TYPES.join(', '));
    out.type = patch.type;
  }
  if (patch.scale !== undefined) {
    if (SCALES.indexOf(patch.scale) < 0) throw u.fail(400, 'scale must be one of: ' + SCALES.join(', '));
    out.scale = patch.scale;
  }
  if (patch.ext !== undefined) out.ext = patch.ext === true || patch.ext === 'true';
  if (patch.compare !== undefined) {
    if (!Array.isArray(patch.compare)) throw u.fail(400, 'compare must be a list of symbols');
    out.compare = patch.compare.slice(0, 5).map((s) => m.normalize(s));
  }
  if (patch.indicators !== undefined) {
    if (!Array.isArray(patch.indicators)) throw u.fail(400, 'indicators must be a list like [{"id":"rsi","params":{"length":14}}]');
    out.indicators = patch.indicators.slice(0, 16).map((x) => {
      const id = typeof x === 'string' ? x : x && x.id;
      try {
        return { id: id, params: ta.params(id, (x && x.params) || {}), hidden: !!(x && x.hidden), color: (x && x.color) || '' };
      } catch (err) {
        throw u.fail(400, String(err.message || err));
      }
    });
  }
  if (patch.intervals !== undefined) {
    if (!Array.isArray(patch.intervals) || patch.intervals.length === 0) throw u.fail(400, 'intervals must be a list like ["1D","1h"]');
    out.intervals = patch.intervals.slice(0, 6).map((x) => m.interval(x));
  }
  if (patch.layout !== undefined) {
    if (['1x2', '2x1', '2x2', '1x3', '3x1', '2x3'].indexOf(patch.layout) < 0) throw u.fail(400, 'layout must be one of 1x2, 2x1, 2x2, 1x3, 3x1, 2x3');
    out.layout = patch.layout;
  }
  return out;
}

module.exports = {
  COLS: COLS,
  ROWS: ROWS,
  CHANNELS: CHANNELS,
  TYPES: TYPES,
  CHART_TYPES: CHART_TYPES,
  SCALES: SCALES,
  WIDGETS: WIDGETS,
  TEMPLATES: TEMPLATES,
  settingsRow: settingsRow,
  serializeSettings: serializeSettings,
  serializeWidget: serializeWidget,
  serializeWorkspace: serializeWorkspace,
  widgetsOf: widgetsOf,
  ensureSeed: ensureSeed,
  seedLists: seedLists,
  listIds: listIds,
  fromTemplate: fromTemplate,
  mustWorkspace: mustWorkspace,
  mustWidget: mustWidget,
  chartWidget: chartWidget,
  resolve: resolve,
  box: box,
  bottom: bottom,
  chartPatch: chartPatch,
};
