/**
 * Yahoo Finance proxy helpers. Loaded with require() from ops.pb.js
 * handlers — PocketBase runs each routerAdd handler in an isolated
 * context, so shared code must live in a required module.
 */
const YAHOO_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'];
const YAHOO_INTERVALS = ['1m', '5m', '15m', '30m', '60m', '1d', '1wk', '1mo'];

function yahooChart(symbol, range, interval) {
  const res = $http.send({
    url:
      'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) +
      '?range=' +
      range +
      '&interval=' +
      interval,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (CraftBot LivingUI)' },
    timeout: 20,
  });
  if (res.statusCode !== 200) {
    throw new Error('Yahoo returned HTTP ' + res.statusCode + ' for ' + symbol);
  }
  const result = res.json && res.json.chart && res.json.chart.result;
  if (!result || !result[0]) {
    throw new Error('No chart data for ' + symbol);
  }
  return result[0];
}

function quoteFor(symbol) {
  const chart = yahooChart(symbol, '5d', '1d');
  const meta = chart.meta || {};
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose;
  if (price == null) throw new Error('No price for ' + symbol);
  return {
    symbol: symbol,
    name: meta.shortName || meta.longName || symbol,
    price: price,
    previousClose: prev != null ? prev : price,
    currency: meta.currency || 'USD',
    marketState: meta.marketState || '',
  };
}

module.exports = { YAHOO_RANGES, YAHOO_INTERVALS, yahooChart, quoteFor };
