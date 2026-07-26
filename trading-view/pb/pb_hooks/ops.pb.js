/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT HOOKS — custom verbs beyond CRUD live here (spec B3/D4).
 * Every route here must have a matching entry in operations.json (the gate
 * enforces it) so any agent can discover it via GET /api/_ops.
 *
 * Market data is proxied live from Yahoo Finance and never stored. Rows
 * with missing OHLC values are dropped server-side, and one bad symbol
 * never breaks the others (both were fatal flaws of the V1 app).
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts — shared helpers must
 * be require()d inside each handler (see yahoo.js), never top-level.
 */

// READING A REQUEST BODY — the ONLY correct way in PB hooks:
//   const data = e.requestInfo().body;   // pre-parsed object
// NEVER use e.request.body / toString(e.request.body): that is a Go stream
// and reads as EMPTY, so your param checks will 400 on every request.

// quotes — batch quotes for comma-separated symbols. Per-symbol failures
// come back as { symbol, error } entries instead of failing the request.
routerAdd('GET', '/api/ops/quotes', (e) => {
  const { quoteFor } = require(`${__hooks}/yahoo.js`);
  const raw = (e.requestInfo().query.symbols || '').toUpperCase();
  const symbols = raw.split(',').map((s) => s.trim()).filter((s) => s !== '').slice(0, 30);
  if (symbols.length === 0) {
    return e.json(400, { error: 'symbols query param required (comma-separated)' });
  }
  const quotes = symbols.map((symbol) => {
    try {
      return quoteFor(symbol);
    } catch (err) {
      return { symbol: symbol, error: String(err && err.message ? err.message : err) };
    }
  });
  return e.json(200, { quotes: quotes });
});

// candles — OHLCV series for one symbol. Bars with missing OHLC are
// dropped (Yahoo serves the in-progress bar with nulls at times).
routerAdd('GET', '/api/ops/candles', (e) => {
  const { YAHOO_RANGES, YAHOO_INTERVALS, yahooChart } = require(`${__hooks}/yahoo.js`);
  const query = e.requestInfo().query;
  const symbol = (query.symbol || '').toUpperCase().trim();
  const range = YAHOO_RANGES.includes(query.range) ? query.range : '6mo';
  const interval = YAHOO_INTERVALS.includes(query.interval) ? query.interval : '1d';
  if (symbol === '') {
    return e.json(400, { error: 'symbol query param required' });
  }
  try {
    const chart = yahooChart(symbol, range, interval);
    const times = chart.timestamp || [];
    const quote = ((chart.indicators || {}).quote || [])[0] || {};
    const open = quote.open || [];
    const high = quote.high || [];
    const low = quote.low || [];
    const close = quote.close || [];
    const volume = quote.volume || [];
    const candles = [];
    for (let i = 0; i < times.length; i++) {
      if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
      candles.push({
        t: times[i],
        o: open[i],
        h: high[i],
        l: low[i],
        c: close[i],
        v: volume[i] == null ? 0 : volume[i],
      });
    }
    return e.json(200, {
      symbol: symbol,
      range: range,
      interval: interval,
      currency: (chart.meta || {}).currency || 'USD',
      candles: candles,
    });
  } catch (err) {
    return e.json(502, { error: String(err && err.message ? err.message : err) });
  }
});
