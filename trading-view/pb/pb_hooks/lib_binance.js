/// <reference path="../pb_data/types.d.ts" />
/**
 * Binance adapter for crypto spot pairs, through the public market-data
 * mirror (data-api.binance.vision: no key, no account, not geo-blocked).
 * Symbols are written "BINANCE:BTCUSDT" in the app.
 *
 *   klines   OHLCV bars, up to 1000 per request, full history by paging back
 *   tickers  24-hour rolling statistics for many pairs in one call
 *   pairs    every listed pair (cached for a day) for symbol search
 */

const BASE = 'https://data-api.binance.vision/api/v3/';
const INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1D': '1d', '1W': '1w', '1M': '1M' };
const QUOTES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'JPY', 'BRL', 'GBP', 'AUD', 'DAI'];

function f(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

/** "BTCUSDT" -> { base: "BTC", quote: "USDT" } */
function split(pair) {
  for (const q of QUOTES) if (pair.length > q.length && pair.slice(-q.length) === q) return { base: pair.slice(0, -q.length), quote: q };
  return { base: pair, quote: '' };
}

function meta(pair) {
  const s = split(pair);
  return {
    symbol: 'BINANCE:' + pair,
    provider: 'binance',
    name: s.base + ' / ' + s.quote,
    exchange: 'Binance',
    type: 'CRYPTO',
    currency: s.quote,
    tz: 'UTC',
    price_hint: 2,
    sessions: null,
    gmtoffset: 0,
  };
}

/** Bars [{t,o,h,l,c,v}] (t in seconds), oldest first. */
function klines(app, pair, interval, startSec, endSec, limit) {
  const http = require(`${__hooks}/lib_http.js`);
  let url = BASE + 'klines?symbol=' + encodeURIComponent(pair) + '&interval=' + INTERVAL[interval] + '&limit=' + (limit || 1000);
  if (startSec) url += '&startTime=' + Math.floor(startSec * 1000);
  if (endSec) url += '&endTime=' + Math.floor(endSec * 1000);
  const rows = http.getJson(app, 'binance', url, 15);
  if (!Array.isArray(rows)) {
    const err = new Error('Binance returned no bars for ' + pair);
    err.status = 502;
    throw err;
  }
  return rows.map((r) => ({ t: Math.floor(r[0] / 1000), o: f(r[1]), h: f(r[2]), l: f(r[3]), c: f(r[4]), v: f(r[5]) || 0 }));
}

/** 24h statistics for pairs, keyed by "BINANCE:PAIR". */
function tickers(app, pairs) {
  const http = require(`${__hooks}/lib_http.js`);
  const out = {};
  for (let i = 0; i < pairs.length; i += 50) {
    const chunk = pairs.slice(i, i + 50);
    const rows = http.getJson(app, 'binance', BASE + 'ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(chunk)), 15);
    for (const r of rows || []) {
      const m = meta(r.symbol);
      const price = f(r.lastPrice);
      const prev = f(r.openPrice);
      out[m.symbol] = {
        symbol: m.symbol,
        provider: 'binance',
        name: m.name,
        price: price,
        prev_close: prev,
        change: f(r.priceChange),
        change_pct: f(r.priceChangePercent),
        high: f(r.highPrice),
        low: f(r.lowPrice),
        volume: f(r.volume),
        quote_volume: f(r.quoteVolume),
        high_52w: null,
        low_52w: null,
        currency: m.currency,
        exchange: 'Binance',
        type: 'CRYPTO',
        tz: 'UTC',
        price_hint: price !== null && price < 1 ? 6 : price !== null && price < 100 ? 4 : 2,
        state: 'open',
        time: Math.floor((r.closeTime || Date.now()) / 1000),
        spark: [],
      };
    }
  }
  return out;
}

/** Every listed pair, cached for a day in memory. */
function pairs(app) {
  const http = require(`${__hooks}/lib_http.js`);
  const cached = app.store().get('tv_binance_pairs');
  if (cached && Date.now() - cached.at < 86400000) return cached.list;
  const rows = http.getJson(app, 'binance', BASE + 'ticker/price', 20);
  const list = (rows || []).map((r) => r.symbol).filter((s) => typeof s === 'string');
  app.store().set('tv_binance_pairs', { at: Date.now(), list: list });
  return list;
}

/** Pairs matching a query by base asset, USDT first. */
function search(app, q, count) {
  const needle = String(q || '')
    .toUpperCase()
    .replace(/^BINANCE:/, '')
    .replace(/[^A-Z0-9]/g, '');
  if (needle.length < 2) return [];
  const rank = (p) => {
    const s = split(p);
    const qi = QUOTES.indexOf(s.quote);
    return (s.base === needle ? 0 : p === needle ? 0 : s.base.indexOf(needle) === 0 ? 100 : p.indexOf(needle) === 0 ? 200 : 300) + (qi < 0 ? 50 : qi);
  };
  return pairs(app)
    .filter((p) => p.indexOf(needle) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, count || 8)
    .map((p) => {
      const m = meta(p);
      return { symbol: m.symbol, name: m.name, exchange: 'Binance', type: 'Crypto', provider: 'binance' };
    });
}

module.exports = { INTERVAL: INTERVAL, split: split, meta: meta, klines: klines, tickers: tickers, pairs: pairs, search: search };
