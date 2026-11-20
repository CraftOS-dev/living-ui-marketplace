/// <reference path="../pb_data/types.d.ts" />
/**
 * The exchange rate of the day for an expense paid in another currency
 * (the Expenses tracker's sources, asked in turn):
 *
 *   1. Frankfurter: European Central Bank reference rates by day (a weekend
 *      or holiday answers the previous working day).
 *   2. currency-api on jsDelivr: daily rates for 200+ currencies.
 *   3. The company's stored rates (fx_rates, latest on or before the day).
 *
 * Answers are kept in memory per (from, to, day); a source that did not
 * answer is not asked again for ten minutes, so a dead network costs one
 * short wait, not one per line. Nothing is guessed: no rate means the line
 * waits for a person to type it.
 *
 *   rateOf(app, from, to, day) -> { rate, day, source } | null
 */

const FRANKFURTER = 'https://api.frankfurter.dev/v1/';
const CURRENCY_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@';
const TIMEOUT = 4;
const QUIET_MS = 10 * 60 * 1000;

function getJson(app, host, url) {
  const key = 'hr_exfx_down_' + host;
  const down = Number(app.store().get(key) || 0);
  if (down > 0 && Date.now() - down < QUIET_MS) return null;
  try {
    const res = $http.send({ url: url, method: 'GET', timeout: TIMEOUT, headers: { accept: 'application/json' } });
    if (res.statusCode >= 500) {
      app.store().set(key, Date.now());
      return null;
    }
    return { status: res.statusCode, json: res.json };
  } catch (err) {
    console.log('[hr] expenses rate lookup failed (' + host + '): ' + err);
    app.store().set(key, Date.now());
    return null;
  }
}

function frankfurter(app, from, to, day) {
  const res = getJson(app, 'frankfurter', FRANKFURTER + day + '?base=' + from + '&symbols=' + to);
  if (res === null || res.status !== 200 || !res.json || !res.json.rates) return null;
  const r = Number(res.json.rates[to]);
  return r > 0 ? { rate: r, day: String(res.json.date || day), source: 'European Central Bank (Frankfurter)' } : null;
}

function currencyApi(app, from, to, day, today) {
  const tag = day >= today ? 'latest' : day;
  const res = getJson(app, 'currency-api', CURRENCY_API + tag + '/v1/currencies/' + from.toLowerCase() + '.json');
  if (res === null || res.status !== 200 || !res.json) return null;
  const table = res.json[from.toLowerCase()];
  const r = table ? Number(table[to.toLowerCase()]) : 0;
  return r > 0 ? { rate: r, day: String(res.json.date || day), source: 'currency-api' } : null;
}

/** Units of `to` for one unit of `from` on `day`, or null when no source has it. */
function rateOf(app, from, to, day) {
  const u = require(`${__hooks}/lib_util.js`);
  const a = String(from || '').toUpperCase();
  const b = String(to || '').toUpperCase();
  if (a === b) return { rate: 1, day: day, source: 'same currency' };
  const today = u.today(app);
  const asked = day > today ? today : day;
  const key = 'hr_exfx_' + a + '_' + b + '_' + asked;
  const cached = app.store().get(key);
  if (cached) return cached;
  let got = frankfurter(app, a, b, asked);
  if (got === null) got = currencyApi(app, a, b, asked, today);
  if (got === null) {
    const stored = require(`${__hooks}/lib_fx.js`).rate(app, a, b, asked);
    if (stored !== null && stored > 0) got = { rate: stored, day: asked, source: 'company rates' };
  }
  if (got !== null) app.store().set(key, got);
  return got;
}

module.exports = { FRANKFURTER: FRANKFURTER, CURRENCY_API: CURRENCY_API, rateOf: rateOf };
