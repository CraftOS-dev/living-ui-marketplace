/// <reference path="../pb_data/types.d.ts" />
/**
 * Screener and heatmap data.
 *
 * Universes: ready-made sets of instruments (US large caps by sector, ETFs,
 * world indices, currencies, futures, crypto pairs), any watchlist
 * ("watchlist:<id>") and Yahoo's daily market lists ("yahoo:day_gainers").
 * Quote fields come from batched quotes; technical fields (RSI,
 * performance, distance from moving averages...) are computed from daily
 * bars of the bar cache, so a repeat run is fast.
 */

const U = {
  us_mega: {
    name: 'US large caps',
    groups: {
      Technology: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'CSCO', 'ACN', 'INTU', 'QCOM', 'TXN', 'IBM', 'NOW', 'AMAT', 'MU'],
      Communication: ['GOOGL', 'META', 'NFLX', 'DIS', 'TMUS', 'VZ', 'T'],
      'Consumer cyclical': ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'BKNG'],
      'Consumer defensive': ['WMT', 'PG', 'COST', 'KO', 'PEP', 'PM'],
      Financials: ['BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP'],
      Healthcare: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'PFE', 'AMGN'],
      Energy: ['XOM', 'CVX', 'COP'],
      Industrials: ['GE', 'CAT', 'RTX', 'HON', 'UNP', 'BA', 'DE'],
      'Utilities, real estate, materials': ['NEE', 'PLD', 'LIN'],
    },
  },
  etfs: {
    name: 'ETFs',
    groups: {
      Broad: ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI'],
      Sectors: ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC'],
      Bonds: ['TLT', 'IEF', 'HYG', 'LQD'],
      Commodities: ['GLD', 'SLV', 'USO', 'UNG'],
      International: ['EEM', 'EFA', 'FXI', 'EWJ'],
      Themes: ['SMH', 'ARKK', 'XBI', 'KRE'],
    },
  },
  indices: {
    name: 'World indices',
    groups: {
      Americas: ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', '^GSPTSE', '^BVSP'],
      Europe: ['^FTSE', '^GDAXI', '^FCHI', '^STOXX50E'],
      'Asia Pacific': ['^N225', '^HSI', '000001.SS', '^BSESN', '^AXJO', '^KS11', '^TWII'],
    },
  },
  fx: {
    name: 'Currencies',
    groups: {
      Majors: ['EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'USDCHF=X', 'AUDUSD=X', 'USDCAD=X', 'NZDUSD=X'],
      Crosses: ['EURGBP=X', 'EURJPY=X', 'GBPJPY=X', 'AUDJPY=X', 'EURCHF=X'],
      'Emerging and index': ['USDCNY=X', 'USDINR=X', 'USDMXN=X', 'USDBRL=X', 'USDSGD=X', 'DX-Y.NYB'],
    },
  },
  futures: {
    name: 'Futures',
    groups: {
      Equity: ['ES=F', 'NQ=F', 'YM=F', 'RTY=F'],
      Energy: ['CL=F', 'BZ=F', 'NG=F'],
      Metals: ['GC=F', 'SI=F', 'HG=F', 'PL=F'],
      Rates: ['ZN=F', 'ZB=F'],
      Grains: ['ZC=F', 'ZW=F', 'ZS=F'],
    },
  },
  crypto: {
    name: 'Crypto (Binance)',
    groups: {
      Crypto: [
        'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'TRX', 'AVAX', 'LINK', 'DOT', 'TON', 'SHIB', 'LTC', 'BCH', 'NEAR', 'UNI', 'APT', 'ARB', 'OP', 'SUI', 'PEPE', 'FIL', 'ATOM', 'ETC', 'INJ', 'AAVE', 'XLM', 'HBAR', 'ICP',
      ].map((c) => 'BINANCE:' + c + 'USDT'),
    },
  },
};

/** Fields a screen can filter, sort or show. */
const FIELDS = [
  { key: 'price', label: 'Price', group: 'quote', unit: 'price' },
  { key: 'change_pct', label: 'Change %', group: 'quote', unit: '%' },
  { key: 'change', label: 'Change', group: 'quote', unit: 'price' },
  { key: 'volume', label: 'Volume', group: 'quote', unit: '' },
  { key: 'dollar_volume', label: 'Traded value', group: 'quote', unit: '' },
  { key: 'day_range_pos', label: 'Position in day range %', group: 'quote', unit: '%' },
  { key: 'from_high_52w', label: 'From 52w high %', group: 'quote', unit: '%' },
  { key: 'from_low_52w', label: 'From 52w low %', group: 'quote', unit: '%' },
  { key: 'rsi14', label: 'RSI 14', group: 'technical', unit: '' },
  { key: 'perf_1w', label: 'Perf 1W %', group: 'technical', unit: '%' },
  { key: 'perf_1m', label: 'Perf 1M %', group: 'technical', unit: '%' },
  { key: 'perf_3m', label: 'Perf 3M %', group: 'technical', unit: '%' },
  { key: 'perf_6m', label: 'Perf 6M %', group: 'technical', unit: '%' },
  { key: 'perf_ytd', label: 'Perf YTD %', group: 'technical', unit: '%' },
  { key: 'perf_1y', label: 'Perf 1Y %', group: 'technical', unit: '%' },
  { key: 'sma20_dist', label: 'vs SMA 20 %', group: 'technical', unit: '%' },
  { key: 'sma50_dist', label: 'vs SMA 50 %', group: 'technical', unit: '%' },
  { key: 'sma200_dist', label: 'vs SMA 200 %', group: 'technical', unit: '%' },
  { key: 'atr_pct', label: 'ATR 14 %', group: 'technical', unit: '%' },
  { key: 'hv20', label: 'Volatility 20d %', group: 'technical', unit: '%' },
  { key: 'rvol', label: 'Relative volume', group: 'technical', unit: 'x' },
  { key: 'gap_pct', label: 'Gap %', group: 'technical', unit: '%' },
  { key: 'adx14', label: 'ADX 14', group: 'technical', unit: '' },
  { key: 'macd_hist', label: 'MACD histogram', group: 'technical', unit: '' },
  { key: 'high_20', label: 'At 20-day high', group: 'technical', unit: 'flag' },
  { key: 'low_20', label: 'At 20-day low', group: 'technical', unit: 'flag' },
  { key: 'market_cap', label: 'Market cap', group: 'fundamental', unit: '' },
  { key: 'pe', label: 'P/E', group: 'fundamental', unit: '' },
  { key: 'forward_pe', label: 'Forward P/E', group: 'fundamental', unit: '' },
];
const FIELD = {};
for (const f of FIELDS) FIELD[f.key] = f;
const CMP = ['>', '>=', '<', '<=', 'between'];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function universes(app) {
  const out = Object.keys(U).map((k) => ({ id: k, name: U[k].name, count: Object.keys(U[k].groups).reduce((n, g) => n + U[k].groups[g].length, 0) }));
  const y = require(`${__hooks}/lib_yahoo.js`);
  for (const k of Object.keys(y.LISTS)) out.push({ id: 'yahoo:' + k, name: y.LISTS[k], count: 25 });
  for (const l of app.findRecordsByFilter('watchlists', 'id != ""', 'sort', 0, 0)) out.push({ id: 'watchlist:' + l.id, name: 'Watchlist: ' + l.getString('name'), count: null });
  return out;
}

/** Members of a universe: [{symbol, group, name?, base?}] (base: fields already known). */
function members(app, id) {
  if (U[id]) {
    const out = [];
    for (const g of Object.keys(U[id].groups)) for (const s of U[id].groups[g]) out.push({ symbol: s, group: g });
    return { name: U[id].name, rows: out };
  }
  if (id.indexOf('watchlist:') === 0) {
    const w = require(`${__hooks}/lib_watch.js`);
    const list = w.mustList(app, id.slice(10));
    let group = '';
    const out = [];
    for (const it of w.itemsOf(app, list.id)) {
      if (it.getString('kind') === 'section') group = it.getString('label');
      else out.push({ symbol: it.getString('symbol'), group: group });
    }
    return { name: list.getString('name'), rows: out };
  }
  if (id.indexOf('yahoo:') === 0) {
    const y = require(`${__hooks}/lib_yahoo.js`);
    const lid = id.slice(6);
    if (!y.LISTS[lid]) throw fail(400, 'Unknown Yahoo list "' + lid + '"; one of: ' + Object.keys(y.LISTS).join(', '));
    const ck = 'tv_ylist|' + lid;
    let r = null;
    const c = app.store().get(ck);
    if (c && Date.now() - c.at < 2 * 60 * 1000) r = c.r;
    else {
      r = y.screener(app, lid, 50);
      app.store().set(ck, { at: Date.now(), r: r });
    }
    return {
      name: r.title,
      rows: r.rows.map((x) => ({
        symbol: x.symbol,
        group: '',
        name: x.name,
        base: { price: x.price, change_pct: x.change_pct, volume: x.volume, market_cap: x.market_cap, pe: x.pe, forward_pe: x.forward_pe, high_52w: x.high_52w, low_52w: x.low_52w, currency: x.currency, exchange: x.exchange },
      })),
    };
  }
  throw fail(400, 'Unknown universe "' + id + '"; see screener.universes');
}

/** Technical fields from daily bars (oldest first). */
function technicals(bars) {
  const ta = require(`${__hooks}/lib_ta.js`);
  const n = bars.length;
  if (n < 2) return {};
  const c = bars.map((b) => b.c);
  const last = c[n - 1];
  const perf = (k) => (n > k && c[n - 1 - k] ? ((last - c[n - 1 - k]) / c[n - 1 - k]) * 100 : null);
  const dist = (len) => {
    const s = ta.lastOf(ta.sma(c, len));
    return n >= len && s ? ((last - s) / s) * 100 : null;
  };
  const year = new Date(bars[n - 1].t * 1000).getUTCFullYear();
  let ytdBase = null;
  for (let i = n - 1; i >= 0; i--) {
    if (new Date(bars[i].t * 1000).getUTCFullYear() < year) {
      ytdBase = c[i];
      break;
    }
  }
  const atr = ta.lastOf(ta.rma(ta.trueRange(bars), 14));
  const vol = bars.map((b) => b.v || 0);
  const avgV = n > 21 ? ta.sma(vol.slice(0, n - 1), 20) : null;
  const avgPrev = avgV ? ta.lastOf(avgV) : null;
  const macd = ta.compute('macd', bars, {}).outputs.hist;
  const adx = ta.compute('adx', bars, {}).outputs.adx;
  const hv = ta.compute('hv', bars, { length: 20 }).outputs.hv;
  let hi20 = -Infinity;
  let lo20 = Infinity;
  for (let i = Math.max(0, n - 20); i < n; i++) {
    hi20 = Math.max(hi20, bars[i].h);
    lo20 = Math.min(lo20, bars[i].l);
  }
  return {
    rsi14: ta.lastOf(ta.rsiOf(c, 14)),
    perf_1w: perf(5),
    perf_1m: perf(21),
    perf_3m: perf(63),
    perf_6m: perf(126),
    perf_ytd: ytdBase ? ((last - ytdBase) / ytdBase) * 100 : null,
    perf_1y: perf(252),
    sma20_dist: dist(20),
    sma50_dist: dist(50),
    sma200_dist: dist(200),
    atr_pct: atr && last ? (atr / last) * 100 : null,
    hv20: ta.lastOf(hv),
    rvol: avgPrev ? vol[n - 1] / avgPrev : null,
    gap_pct: c[n - 2] ? ((bars[n - 1].o - c[n - 2]) / c[n - 2]) * 100 : null,
    adx14: ta.lastOf(adx),
    macd_hist: ta.lastOf(macd),
    high_20: bars[n - 1].h >= hi20 ? 1 : 0,
    low_20: bars[n - 1].l <= lo20 ? 1 : 0,
  };
}

/** Validate criteria: [{field, op, value, value2?}] */
function cleanCriteria(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) throw fail(400, 'criteria must be a list like [{"field":"rsi14","op":"<","value":30}]');
  return raw.slice(0, 12).map((c) => {
    if (!c || !FIELD[c.field]) throw fail(400, 'Unknown field "' + (c && c.field) + '"; see screener.fields');
    if (CMP.indexOf(c.op) < 0) throw fail(400, 'op must be one of: ' + CMP.join(' '));
    const v = Number(c.value);
    if (!isFinite(v)) throw fail(400, 'value of ' + c.field + ' must be a number');
    const out = { field: c.field, op: c.op, value: v };
    if (c.op === 'between') {
      const v2 = Number(c.value2);
      if (!isFinite(v2)) throw fail(400, 'between needs value2');
      out.value2 = v2;
    }
    return out;
  });
}

function passes(row, crit) {
  for (const c of crit) {
    const v = row[c.field];
    if (v === null || v === undefined || !isFinite(v)) return false;
    if (c.op === '>' && !(v > c.value)) return false;
    if (c.op === '>=' && !(v >= c.value)) return false;
    if (c.op === '<' && !(v < c.value)) return false;
    if (c.op === '<=' && !(v <= c.value)) return false;
    if (c.op === 'between' && !(v >= Math.min(c.value, c.value2) && v <= Math.max(c.value, c.value2))) return false;
  }
  return true;
}

/**
 * Run a screen. opts: { universe, criteria, sort, desc, limit, technical }.
 * Technical fields are computed when a criterion, the sort or `technical`
 * asks for them (daily bars, up to 100 instruments).
 */
function run(app, opts) {
  const m = require(`${__hooks}/lib_market.js`);
  const uni = members(app, opts.universe || 'us_mega');
  const crit = cleanCriteria(opts.criteria);
  const sort = opts.sort && FIELD[opts.sort] ? opts.sort : 'change_pct';
  const needTech = opts.technical === true || FIELD[sort].group === 'technical' || crit.some((c) => FIELD[c.field].group === 'technical');
  const syms = uni.rows.map((r) => r.symbol);
  const q = m.quotes(app, syms);
  const rows = [];
  const errors = [];
  for (const r of uni.rows) {
    let sym = r.symbol;
    try {
      sym = m.normalize(r.symbol);
    } catch {
      continue;
    }
    const qu = q.quotes[sym];
    const base = r.base || {};
    const price = qu ? qu.price : base.price;
    if (price === undefined || price === null) continue;
    const row = {
      symbol: sym,
      name: (qu && qu.name) || r.name || sym,
      group: r.group,
      currency: (qu && qu.currency) || base.currency || '',
      price: price,
      change: qu ? qu.change : null,
      change_pct: qu ? qu.change_pct : base.change_pct,
      volume: qu ? qu.volume : base.volume,
      market_cap: base.market_cap === undefined ? null : base.market_cap,
      pe: base.pe === undefined ? null : base.pe,
      forward_pe: base.forward_pe === undefined ? null : base.forward_pe,
      spark: qu ? qu.spark : [],
      state: qu ? qu.state : '',
    };
    const vol = row.volume;
    row.dollar_volume = vol !== null && vol !== undefined ? vol * price : null;
    const hi = qu ? qu.high : null;
    const lo = qu ? qu.low : null;
    row.day_range_pos = hi !== null && lo !== null && hi > lo ? ((price - lo) / (hi - lo)) * 100 : null;
    const h52 = (qu && qu.high_52w) || base.high_52w || null;
    const l52 = (qu && qu.low_52w) || base.low_52w || null;
    row.from_high_52w = h52 ? ((price - h52) / h52) * 100 : null;
    row.from_low_52w = l52 ? ((price - l52) / l52) * 100 : null;
    rows.push(row);
  }
  if (needTech) {
    for (const row of rows.slice(0, 100)) {
      try {
        const s = m.series(app, row.symbol, '1D', { count: 260 });
        Object.assign(row, technicals(s.bars));
      } catch (err) {
        errors.push(row.symbol + ': ' + String((err && err.message) || err));
      }
    }
  }
  const hits = rows.filter((r) => passes(r, crit));
  const desc = opts.desc !== false;
  hits.sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return desc ? y - x : x - y;
  });
  const limit = Math.max(1, Math.min(200, opts.limit || 50));
  return { universe: { id: opts.universe || 'us_mega', name: uni.name }, criteria: crit, sort: sort, desc: desc, total: rows.length, count: Math.min(limit, hits.length), rows: hits.slice(0, limit), missing: q.missing, errors: errors.slice(0, 10) };
}

/** Heatmap tiles of a universe: change, traded value and group. */
function heatmap(app, universe) {
  const r = run(app, { universe: universe, sort: 'dollar_volume', desc: true, limit: 200 });
  return {
    universe: r.universe,
    tiles: r.rows.map((x) => ({ symbol: x.symbol, name: x.name, group: x.group, price: x.price, change_pct: x.change_pct, dollar_volume: x.dollar_volume, market_cap: x.market_cap, currency: x.currency })),
  };
}

function serializeScreen(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    name: rec.getString('name'),
    universe: rec.getString('universe'),
    criteria: u.json(rec, 'criteria', []) || [],
    sort: rec.getString('sort'),
    note: rec.getString('note'),
    added_by: rec.getString('added_by') || 'user',
    created: rec.getString('created'),
  };
}

module.exports = { serializeScreen: serializeScreen, UNIVERSES: U, FIELDS: FIELDS, universes: universes, members: members, technicals: technicals, cleanCriteria: cleanCriteria, run: run, heatmap: heatmap };
