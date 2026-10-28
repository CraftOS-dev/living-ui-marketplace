/// <reference path="../pb_data/types.d.ts" />
/**
 * Yahoo Finance adapter (stocks, ETFs, indices, forex, futures; unofficial
 * public endpoints, delayed for most exchanges):
 *
 *   chart    /v8/finance/chart: OHLCV bars, instrument metadata, today's
 *            trading periods (pre, regular, post), dividends and splits
 *   spark    /v7/finance/spark: batched quotes for many symbols in one call
 *   search   /v1/finance/search: symbol search and related news
 *   screener /v1/finance/screener/predefined/saved: Yahoo's market lists
 *
 * Intraday history is limited by Yahoo: 1m bars reach back about 30 days
 * (7 per request); 2m to 30m about 60 days; 60m about 730 days.
 */

const BASE = 'https://query1.finance.yahoo.com';

/** App interval -> Yahoo interval; 4h is built from 60m bars (see lib_market). */
const INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '4h': '60m', '1D': '1d', '1W': '1wk', '1M': '1mo' };

/** How far back Yahoo serves each interval (seconds); 0 = no limit. */
const REACH = { '1m': 29 * 86400, '5m': 59 * 86400, '15m': 59 * 86400, '30m': 59 * 86400, '60m': 729 * 86400, '1d': 0, '1wk': 0, '1mo': 0 };

/** Largest span one request may cover (seconds). */
const SPAN = { '1m': 7 * 86400, '5m': 59 * 86400, '15m': 59 * 86400, '30m': 59 * 86400, '60m': 729 * 86400, '1d': 40 * 365 * 86400, '1wk': 60 * 365 * 86400, '1mo': 60 * 365 * 86400 };

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/** Trading periods of today as exchange-local minutes since midnight. */
function sessionsOf(meta) {
  const p = meta.currentTradingPeriod;
  const off = (meta.gmtoffset || 0) / 60;
  const mins = (t) => (((Math.floor(t / 60) + off) % 1440) + 1440) % 1440;
  if (!p || !p.regular) return null;
  const out = { regular: [mins(p.regular.start), mins(p.regular.end)] };
  if (p.pre && p.pre.start !== p.pre.end) out.pre = [mins(p.pre.start), mins(p.pre.end)];
  if (p.post && p.post.start !== p.post.end) out.post = [mins(p.post.start), mins(p.post.end)];
  return out;
}

function metaOf(meta, symbol) {
  return {
    symbol: symbol,
    provider: 'yahoo',
    name: meta.longName || meta.shortName || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    type: meta.instrumentType || '',
    currency: meta.currency || '',
    tz: meta.exchangeTimezoneName || 'UTC',
    price_hint: num(meta.priceHint) === null ? 2 : meta.priceHint,
    sessions: sessionsOf(meta),
    gmtoffset: meta.gmtoffset || 0,
    periods: meta.currentTradingPeriod || null,
    first_trade: num(meta.firstTradeDate),
    ext_hours: meta.hasPrePostMarketData === true,
  };
}

/**
 * Bars for one symbol between two unix times (seconds). Returns
 * { meta, bars: [{t,o,h,l,c,v}], dividends: [{t, amount}], splits: [{t, ratio}] }.
 */
function chart(app, symbol, yInterval, period1, period2, prepost) {
  const http = require(`${__hooks}/lib_http.js`);
  const url =
    BASE +
    '/v8/finance/chart/' +
    encodeURIComponent(symbol) +
    '?interval=' +
    yInterval +
    '&period1=' +
    Math.max(0, Math.floor(period1)) +
    '&period2=' +
    Math.floor(period2) +
    '&includePrePost=' +
    (prepost ? 'true' : 'false') +
    '&events=div%2Csplits';
  const json = http.getJson(app, 'yahoo', url, 15);
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result) {
    const desc = json && json.chart && json.chart.error ? json.chart.error.description : '';
    const err = new Error('No data for ' + symbol + (desc ? ': ' + desc : ''));
    err.status = 404;
    throw err;
  }
  const ts = result.timestamp || [];
  const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = num(q.open && q.open[i]);
    const h = num(q.high && q.high[i]);
    const l = num(q.low && q.low[i]);
    const c = num(q.close && q.close[i]);
    if (o === null || h === null || l === null || c === null) continue;
    bars.push({ t: ts[i], o: o, h: h, l: l, c: c, v: num(q.volume && q.volume[i]) || 0 });
  }
  const ev = result.events || {};
  const dividends = Object.keys(ev.dividends || {}).map((k) => ({ t: ev.dividends[k].date, amount: ev.dividends[k].amount }));
  const splits = Object.keys(ev.splits || {}).map((k) => ({ t: ev.splits[k].date, ratio: ev.splits[k].splitRatio || ev.splits[k].numerator + ':' + ev.splits[k].denominator }));
  return { meta: metaOf(result.meta || {}, symbol), raw: result.meta || {}, bars: bars, dividends: dividends, splits: splits };
}

/** Market state from today's trading periods. */
function marketState(meta, now) {
  const p = meta.currentTradingPeriod;
  if (!p || !p.regular) return 'unknown';
  if (now >= p.regular.start && now < p.regular.end) return 'open';
  if (p.pre && now >= p.pre.start && now < p.pre.end) return 'pre';
  if (p.post && now >= p.post.start && now < p.post.end) return 'post';
  return 'closed';
}

/**
 * Batched quotes (up to 20 symbols per request). With `prepost` the
 * sparkline holds today's extended-hours trades, so its last point is the
 * pre- or post-market price.
 */
function spark(app, symbols, prepost) {
  const http = require(`${__hooks}/lib_http.js`);
  const out = {};
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    const url = BASE + '/v7/finance/spark?symbols=' + chunk.map(encodeURIComponent).join(',') + '&range=1d&interval=5m&includePrePost=' + (prepost ? 'true' : 'false');
    const json = http.getJson(app, 'yahoo', url, 15);
    const results = (json && json.spark && json.spark.result) || [];
    for (const r of results) {
      const resp = r.response && r.response[0];
      if (!resp || !resp.meta) continue;
      const m = resp.meta;
      const price = num(m.regularMarketPrice);
      if (price === null) continue;
      const prev = num(m.chartPreviousClose) !== null ? m.chartPreviousClose : num(m.previousClose);
      const closes = ((resp.indicators && resp.indicators.quote && resp.indicators.quote[0] && resp.indicators.quote[0].close) || []).filter((x) => num(x) !== null);
      out[r.symbol] = {
        symbol: r.symbol,
        provider: 'yahoo',
        name: m.longName || m.shortName || r.symbol,
        price: price,
        prev_close: prev,
        change: prev !== null ? price - prev : null,
        change_pct: prev ? ((price - prev) / prev) * 100 : null,
        high: num(m.regularMarketDayHigh),
        low: num(m.regularMarketDayLow),
        volume: num(m.regularMarketVolume),
        high_52w: num(m.fiftyTwoWeekHigh),
        low_52w: num(m.fiftyTwoWeekLow),
        currency: m.currency || '',
        exchange: m.fullExchangeName || m.exchangeName || '',
        type: m.instrumentType || '',
        tz: m.exchangeTimezoneName || 'UTC',
        price_hint: num(m.priceHint) === null ? 2 : m.priceHint,
        state: marketState(m, now),
        time: num(m.regularMarketTime),
        ext_hours: m.hasPrePostMarketData === true,
        spark: closes.slice(-80),
      };
    }
  }
  return out;
}

function search(app, q, count) {
  const http = require(`${__hooks}/lib_http.js`);
  const json = http.getJson(app, 'yahoo', BASE + '/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=' + (count || 10) + '&newsCount=0&enableFuzzyQuery=true', 10);
  return (json.quotes || [])
    .filter((x) => x.symbol && x.quoteType !== 'OPTION')
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || '',
      provider: 'yahoo',
    }));
}

function news(app, q, count) {
  const http = require(`${__hooks}/lib_http.js`);
  const json = http.getJson(app, 'yahoo', BASE + '/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=0&newsCount=' + (count || 12), 10);
  return (json.news || [])
    .filter((n) => n.title && n.link)
    .map((n) => ({
      id: n.uuid || n.link,
      title: n.title,
      publisher: n.publisher || '',
      link: n.link,
      time: n.providerPublishTime || 0,
      tickers: n.relatedTickers || [],
      thumb: (n.thumbnail && n.thumbnail.resolutions && n.thumbnail.resolutions.length > 0 && n.thumbnail.resolutions[n.thumbnail.resolutions.length - 1].url) || '',
    }));
}

const LISTS = {
  day_gainers: 'Day gainers',
  day_losers: 'Day losers',
  most_actives: 'Most active',
  small_cap_gainers: 'Small caps with momentum',
  undervalued_large_caps: 'Undervalued large caps',
  undervalued_growth_stocks: 'Undervalued growth',
  growth_technology_stocks: 'Growth technology',
  aggressive_small_caps: 'Aggressive small caps',
  most_shorted_stocks: 'Most shorted',
};

function screener(app, id, count) {
  const http = require(`${__hooks}/lib_http.js`);
  const json = http.getJson(app, 'yahoo', BASE + '/v1/finance/screener/predefined/saved?scrIds=' + encodeURIComponent(id) + '&count=' + (count || 50), 15);
  const r = json && json.finance && json.finance.result && json.finance.result[0];
  if (!r) {
    const err = new Error('Yahoo returned no list "' + id + '"');
    err.status = 502;
    throw err;
  }
  return {
    title: LISTS[id] || r.title || id,
    description: r.description || '',
    rows: (r.quotes || []).map((x) => ({
      symbol: x.symbol,
      name: x.longName || x.shortName || x.displayName || x.symbol,
      price: num(x.regularMarketPrice),
      change_pct: num(x.regularMarketChangePercent),
      volume: num(x.regularMarketVolume),
      avg_volume: num(x.averageDailyVolume3Month),
      market_cap: num(x.marketCap),
      pe: num(x.trailingPE),
      forward_pe: num(x.forwardPE),
      change_52w: num(x.fiftyTwoWeekChangePercent),
      high_52w: num(x.fiftyTwoWeekHigh),
      low_52w: num(x.fiftyTwoWeekLow),
      earnings: num(x.earningsTimestamp),
      currency: x.currency || '',
      exchange: x.fullExchangeName || x.exchange || '',
    })),
  };
}

module.exports = { INTERVAL: INTERVAL, REACH: REACH, SPAN: SPAN, LISTS: LISTS, chart: chart, spark: spark, search: search, news: news, screener: screener, marketState: marketState, metaOf: metaOf };
