/**
 * Yahoo Finance proxy helpers. Loaded with require() from ops.pb.js
 * handlers — PocketBase runs each routerAdd handler in an isolated
 * context, so shared code must live in a required module.
 */
const YAHOO_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y'];
const YAHOO_INTERVALS = ['1m', '5m', '15m', '30m', '60m', '1d', '1wk', '1mo'];
const UA = { 'User-Agent': 'Mozilla/5.0 (CraftBot LivingUI)' };

function yahooGet(url) {
  const res = $http.send({ url: url, method: 'GET', headers: UA, timeout: 20 });
  if (res.statusCode !== 200) {
    throw new Error('Yahoo returned HTTP ' + res.statusCode);
  }
  return res.json;
}

function yahooChart(symbol, range, interval) {
  let json;
  try {
    json = yahooGet(
      'https://query1.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(symbol) +
        '?range=' +
        range +
        '&interval=' +
        interval,
    );
  } catch (err) {
    throw new Error(String(err.message || err) + ' for ' + symbol);
  }
  const result = json && json.chart && json.chart.result;
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
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    dayHigh: meta.regularMarketDayHigh != null ? meta.regularMarketDayHigh : null,
    dayLow: meta.regularMarketDayLow != null ? meta.regularMarketDayLow : null,
    volume: meta.regularMarketVolume != null ? meta.regularMarketVolume : null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh != null ? meta.fiftyTwoWeekHigh : null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow != null ? meta.fiftyTwoWeekLow : null,
  };
}

function searchSymbols(query, count) {
  const json = yahooGet(
    'https://query1.finance.yahoo.com/v1/finance/search?q=' +
      encodeURIComponent(query) +
      '&quotesCount=' +
      (count || 8) +
      '&newsCount=0',
  );
  return (json.quotes || [])
    .filter((quote) => quote.symbol)
    .map((quote) => ({
      symbol: quote.symbol,
      name: quote.shortname || quote.longname || quote.symbol,
      exchange: quote.exchDisp || quote.exchange || '',
      type: quote.quoteType || '',
    }));
}

function newsFor(query, count) {
  const json = yahooGet(
    'https://query1.finance.yahoo.com/v1/finance/search?q=' +
      encodeURIComponent(query) +
      '&quotesCount=0&newsCount=' +
      (count || 10),
  );
  return (json.news || []).map((item) => ({
    title: item.title,
    publisher: item.publisher || '',
    link: item.link || '',
    published: item.providerPublishTime || 0,
    tickers: item.relatedTickers || [],
  }));
}

module.exports = { YAHOO_RANGES, YAHOO_INTERVALS, yahooChart, quoteFor, searchSymbols, newsFor };
