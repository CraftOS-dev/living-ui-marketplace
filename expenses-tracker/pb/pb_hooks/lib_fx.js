/// <reference path="../pb_data/types.d.ts" />
/**
 * Exchange rates for expenses paid in another currency.
 *
 * Two keyless sources, asked in turn until one has the rate:
 *   1. Frankfurter: European Central Bank reference rates (about 30
 *      currencies, history back to 1999; a weekend or holiday answers the
 *      previous working day).
 *   2. currency-api on jsDelivr: daily rates for 200+ currencies (TWD, VND
 *      and others the ECB does not publish), history from March 2024.
 * Either can be slow or briefly unreachable, so a source that does not
 * answer is skipped and Frankfurter is asked once more at the end. Rates are
 * cached in memory per (from, to, date). When no rate exists the caller gets
 * a clear error (an agent may pass an explicit `rate`); nothing is guessed.
 */

const FRANKFURTER = 'https://api.frankfurter.dev/v1/';
const CURRENCY_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@';

const TIMEOUT = 6;

/** GET a JSON document: { status, json } or null when the host did not answer. */
function getJson(url) {
  try {
    const res = $http.send({ url: url, method: 'GET', timeout: TIMEOUT });
    return { status: res.statusCode, json: res.json };
  } catch (err) {
    console.error('[expenses] fx request failed:', url, err);
    return null;
  }
}

/** Frankfurter: { rate, rate_date } | 'none' (answered, no rate) | null (no answer). */
function fromFrankfurter(from, to, day) {
  const res = getJson(FRANKFURTER + day + '?from=' + from + '&to=' + to);
  if (res === null || res.status >= 500) return null;
  const r = res.status === 200 && res.json && res.json.rates ? res.json.rates[to] : undefined;
  if (typeof r !== 'number' || !(r > 0)) return 'none';
  return { rate: r, rate_date: String(res.json.date || day), source: 'European Central Bank (Frankfurter)' };
}

/** currency-api: same answer shape. Its dated releases start 2024-03-02. */
function fromCurrencyApi(from, to, day, today) {
  const tag = day >= today ? 'latest' : day;
  const res = getJson(CURRENCY_API + tag + '/v1/currencies/' + from.toLowerCase() + '.json');
  if (res === null || res.status >= 500) return null;
  const table = res.status === 200 && res.json ? res.json[from.toLowerCase()] : undefined;
  const r = table ? table[to.toLowerCase()] : undefined;
  if (typeof r !== 'number' || !(r > 0)) return 'none';
  return { rate: r, rate_date: String(res.json.date || day), source: 'currency-api' };
}

/** Units of `to` for one unit of `from` on `day` (YYYY-MM-DD). */
function rate(app, from, to, day) {
  const u = require(`${__hooks}/lib_util.js`);
  if (from === to) return { rate: 1, rate_date: day, source: 'same currency' };
  const key = 'et_fx:' + from + ':' + to + ':' + day;
  const cached = app.store().get(key);
  if (cached) return cached;
  const today = u.today();
  // No source has rates for future days; ask for today's instead.
  const asked = day > today ? today : day;

  // Frankfurter, then currency-api, then Frankfurter once more if it did not answer.
  const first = fromFrankfurter(from, to, asked);
  const second = first !== null && first !== 'none' ? first : fromCurrencyApi(from, to, asked, today);
  const third = second !== null && second !== 'none' ? second : first === null ? fromFrankfurter(from, to, asked) : first;
  for (const got of [first, second, third]) {
    if (got !== null && got !== 'none') {
      app.store().set(key, got);
      return got;
    }
  }
  if (first === null && second === null && third === null) {
    const err = u.fail(502, 'Could not get the ' + from + ' to ' + to + ' exchange rate right now: the rate services did not answer. Try again in a moment.');
    err.agentHint = 'Or pass rate=<' + to + ' per 1 ' + from + '> to convert without them.';
    throw err;
  }
  const err = u.fail(422, 'No exchange rate from ' + from + ' to ' + to + ' for ' + day + '.');
  err.agentHint = 'Pass rate=<' + to + ' per 1 ' + from + '> to convert it.';
  throw err;
}

/**
 * Convert minor units of `from` into minor units of `to`.
 * `explicitRate` (to per 1 from) skips the lookup when given.
 */
function convert(app, minor, from, to, day, explicitRate) {
  const money = require(`${__hooks}/lib_money.js`);
  const r = explicitRate !== null && explicitRate !== undefined ? { rate: explicitRate, rate_date: day, source: 'given' } : rate(app, from, to, day);
  const major = minor / Math.pow(10, money.exponent(from));
  const converted = Math.round(major * r.rate * Math.pow(10, money.exponent(to)));
  return { minor: converted, rate: r.rate, rate_date: r.rate_date };
}

module.exports = { rate: rate, convert: convert };
