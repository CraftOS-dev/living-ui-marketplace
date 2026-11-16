/// <reference path="../pb_data/types.d.ts" />
/**
 * Exchange rates, dated and cached by day (Expenses lib_fx.js, adapted).
 *
 * Two keyless sources, asked in turn until one has the rate:
 *   1. Frankfurter: European Central Bank reference rates (about 30
 *      currencies, history back to 1999; a weekend or holiday answers the
 *      previous working day), also as a time series for averages.
 *   2. currency-api on jsDelivr: daily rates for 200+ currencies, history
 *      from March 2024.
 * Every rate fetched or set by a person is kept in fx_rates (day, base,
 * quote, rate_e8 = units of quote for one base, scaled by 10^8), so a day
 * is asked for once. Nothing is guessed: no rate answers null. The period
 * rate (avg or end) is the engines' lib_eng_kpi.rateFor and the conversion
 * lib_eng_core.convertMinor: one implementation for the app.
 *
 *   rate(app, from, to, day) -> { rate_e8, day, source } | null
 *       the rate on `day` (or the latest stored within 7 days before it;
 *       the inverse or a cross through the base currency count too)
 *   avg(app, from, to, fromDay, toDay) -> { rate_e8, days, from_day, to_day, source } | null
 *       the mean of the daily rates of the period (for flows)
 *   convert(app, minor, from, to, day, mode, fromDay)
 *       -> { minor, rate_e8, mode, day, from_day, source } | { minor: null, reason, message }
 *       mode 'end' (default): the rate on `day` (balances: cash, NAV);
 *       mode 'avg': the period's average rate (flows: revenue, burn);
 *       the period runs from `fromDay` (default the first day of the
 *       month of `day`) to `day`.
 */

const FRANKFURTER = 'https://api.frankfurter.dev/v1/';
const CURRENCY_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@';
const TIMEOUT = 8;
const E8 = 100000000;

let _kpi = null;
function KPI() {
  if (_kpi === null) _kpi = require(`${__hooks}/lib_eng_kpi.js`);
  return _kpi;
}
let _core = null;
function CORE() {
  if (_core === null) _core = require(`${__hooks}/lib_eng_core.js`);
  return _core;
}

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function toE8(rate) {
  return Math.round(Number(rate) * E8);
}

/** GET a JSON document: { status, json } or null when the host did not answer. */
function getJson(url) {
  try {
    const res = $http.send({ url: url, method: 'GET', timeout: TIMEOUT, headers: { accept: 'application/json' } });
    return { status: res.statusCode, json: res.json };
  } catch (err) {
    console.log('[vo] fx request failed: ' + url + ' ' + err);
    return null;
  }
}

function store(app, day, base, quote, rateE8, source) {
  const u = L('lib_util');
  if (!(rateE8 > 0)) return;
  let r = u.findOne(app, 'fx_rates', 'day = {:d} && base = {:b} && quote = {:q}', { d: day, b: base, q: quote });
  if (r === null) {
    r = u.newRecord(app, 'fx_rates');
    r.set('day', day);
    r.set('base', base);
    r.set('quote', quote);
  } else if (r.getString('source') === 'set by a person' && source !== 'set by a person') return;
  r.set('rate_e8', rateE8);
  r.set('source', u.clip(source, 80));
  app.save(r);
}

/**
 * Stored daily rates of a pair over [fromDay, toDay]: [{ day, rate_e8, source }].
 * The pair as stored; else its inverse; else a cross through the base
 * currency (days where both legs are stored).
 */
function series(app, from, to, fromDay, toDay) {
  const u = L('lib_util');
  const q = (b, c) => u.rows(app, 'SELECT day, rate_e8, source FROM fx_rates WHERE base = {:b} AND quote = {:q} AND day >= {:f} AND day <= {:t} AND rate_e8 > 0 ORDER BY day', { day: '', rate_e8: 0, source: '' }, { b: b, q: c, f: fromDay, t: toDay });
  const direct = q(from, to);
  if (direct.length > 0) return direct;
  const inv = q(to, from);
  if (inv.length > 0) return inv.map((r) => ({ day: r.day, rate_e8: Math.round((E8 * E8) / r.rate_e8), source: r.source + ' (inverse)' }));
  const base = L('lib_settings').row(app).getString('base_currency');
  if (base === '' || base === from || base === to) return [];
  const legA = {};
  for (const r of q(base, from)) legA[r.day] = r.rate_e8;
  const out = [];
  for (const r of q(base, to)) if (legA[r.day] > 0) out.push({ day: r.day, rate_e8: Math.round((r.rate_e8 * E8) / legA[r.day]), source: 'cross through ' + base });
  return out;
}

/** The engines' period rate over stored rates: { rate_e8|null, days, day (the last day used), source }. */
function pick(app, from, to, mode, fromDay, toDay) {
  const rates = series(app, from, to, mode === 'end' ? L('lib_util').dayAdd(toDay, -7) : fromDay, toDay);
  if (rates.length === 0) return { rate_e8: null, days: 0, day: '', source: '' };
  const r = KPI().rateFor({ rates: rates.map((x) => ({ day: x.day, rate_e8: x.rate_e8 })), mode: mode, start_day: mode === 'end' ? L('lib_util').dayAdd(toDay, -7) : fromDay, end_day: toDay });
  const last = rates[rates.length - 1];
  return { rate_e8: r.rate_e8, days: r.days, day: last.day, source: mode === 'avg' ? 'average of ' + r.days + ' daily rates' : last.source };
}

/** Ask the sources for one day and keep what they answer. */
function fetchDay(app, from, to, day) {
  const u = L('lib_util');
  const today = u.today(app);
  const asked = day > today ? today : day;
  const f = getJson(FRANKFURTER + asked + '?from=' + from + '&to=' + to);
  if (f !== null && f.status === 200 && f.json && f.json.rates && typeof f.json.rates[to] === 'number' && f.json.rates[to] > 0) {
    const d = String(f.json.date || asked);
    store(app, d, from, to, toE8(f.json.rates[to]), 'European Central Bank (Frankfurter)');
    return { rate_e8: toE8(f.json.rates[to]), day: d, source: 'European Central Bank (Frankfurter)' };
  }
  const tag = asked >= today ? 'latest' : asked;
  const c = getJson(CURRENCY_API + tag + '/v1/currencies/' + from.toLowerCase() + '.json');
  const table = c !== null && c.status === 200 && c.json ? c.json[from.toLowerCase()] : null;
  const r = table ? table[to.toLowerCase()] : undefined;
  if (typeof r === 'number' && r > 0) {
    const d = String((c.json && c.json.date) || asked);
    store(app, d, from, to, toE8(r), 'currency-api');
    return { rate_e8: toE8(r), day: d, source: 'currency-api' };
  }
  return null;
}

/** The rate on `day` (the latest stored within 7 days, else fetched): { rate_e8, day, source } | null. */
function rate(app, from, to, day) {
  const u = L('lib_util');
  const f = String(from || '').toUpperCase();
  const t = String(to || '').toUpperCase();
  const d = day || u.today(app);
  if (f === t) return { rate_e8: E8, day: d, source: 'same currency' };
  let r = pick(app, f, t, 'end', d, d);
  if (r.rate_e8 === null) {
    fetchDay(app, f, t, d);
    r = pick(app, f, t, 'end', d, d);
  }
  return r.rate_e8 === null ? null : { rate_e8: r.rate_e8, day: r.day, source: r.source };
}

/** Fetch a period's daily rates (Frankfurter time series) and keep them. */
function fetchSeries(app, from, to, fromDay, toDay) {
  const f = getJson(FRANKFURTER + fromDay + '..' + toDay + '?from=' + from + '&to=' + to);
  if (f === null || f.status !== 200 || !f.json || !f.json.rates) return 0;
  let n = 0;
  for (const d of Object.keys(f.json.rates)) {
    const v = f.json.rates[d] ? f.json.rates[d][to] : undefined;
    if (typeof v === 'number' && v > 0) {
      store(app, d, from, to, toE8(v), 'European Central Bank (Frankfurter)');
      n++;
    }
  }
  return n;
}

/** The mean of the period's daily rates (stored; the period fetched once when too few days are stored): { rate_e8, days, from_day, to_day, source } | null. */
function avg(app, from, to, fromDay, toDay) {
  const u = L('lib_util');
  const f = String(from || '').toUpperCase();
  const t = String(to || '').toUpperCase();
  if (f === t) return { rate_e8: E8, days: 1, from_day: fromDay, to_day: toDay, source: 'same currency' };
  const span = Math.max(1, u.daysBetween(fromDay, toDay) + 1);
  let r = pick(app, f, t, 'avg', fromDay, toDay);
  if ((r.rate_e8 === null || r.days < Math.max(1, Math.floor((span * 5) / 7 / 2))) && toDay <= u.today(app)) {
    fetchSeries(app, f, t, fromDay, toDay);
    r = pick(app, f, t, 'avg', fromDay, toDay);
  }
  return r.rate_e8 === null ? null : { rate_e8: r.rate_e8, days: r.days, from_day: fromDay, to_day: toDay, source: r.source };
}

/** Minor units of `from` in `to` (see the header). Unknown rate: { minor: null, reason }. */
function convert(app, minor, from, to, day, mode, fromDay) {
  const u = L('lib_util');
  const m = mode === 'avg' ? 'avg' : 'end';
  const d = day || u.today(app);
  const f = String(from || '').toUpperCase();
  const t = String(to || '').toUpperCase();
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return { minor: null, reason: 'no_amount', message: 'No amount to convert.' };
  const start = fromDay || d.slice(0, 8) + '01';
  const r = m === 'avg' ? avg(app, f, t, start, d) : rate(app, f, t, d);
  if (r === null) return { minor: null, reason: 'no_rate', message: 'No ' + f + ' to ' + t + ' rate for ' + d + '. Set one with fx.set.' };
  return { minor: CORE().convertMinor(Math.round(Number(minor)), f, t, r.rate_e8), rate_e8: r.rate_e8, mode: m, day: m === 'avg' ? d : r.day, from_day: m === 'avg' ? start : '', source: r.source };
}

/** The currencies in use: the base currency and the entities'. */
function currencies(app) {
  const u = L('lib_util');
  const out = {};
  for (const r of u.rows(app, "SELECT DISTINCT currency FROM entities WHERE currency != ''", { currency: '' })) out[r.currency] = true;
  const base = L('lib_settings').row(app).getString('base_currency');
  if (base !== '') out[base] = true;
  return Object.keys(out).sort();
}

/** Daily: today's rates from the base currency to every currency in use. */
function refresh(app) {
  const u = L('lib_util');
  const base = L('lib_settings').row(app).getString('base_currency');
  if (base === '') return { ok: false, stored: 0, message: 'Set the base currency first.' };
  const want = currencies(app).filter((c) => c !== base);
  if (want.length === 0) return { ok: true, stored: 0, missing: [], message: 'Only one currency in use.' };
  const got = {};
  let date = u.today(app);
  const first = getJson(FRANKFURTER + 'latest?from=' + base + '&to=' + want.join(','));
  if (first !== null && first.status === 200 && first.json && first.json.rates) {
    for (const k of Object.keys(first.json.rates)) got[k.toUpperCase()] = { rate: Number(first.json.rates[k]), source: 'European Central Bank (Frankfurter)' };
    if (first.json.date) date = String(first.json.date);
  }
  if (want.some((c) => got[c] === undefined)) {
    const second = getJson(CURRENCY_API + 'latest/v1/currencies/' + base.toLowerCase() + '.json');
    const table = second !== null && second.status === 200 && second.json ? second.json[base.toLowerCase()] : null;
    if (table) for (const c of want) if (got[c] === undefined && typeof table[c.toLowerCase()] === 'number') got[c] = { rate: table[c.toLowerCase()], source: 'currency-api' };
  }
  let n = 0;
  for (const c of Object.keys(got)) {
    if (!(got[c].rate > 0)) continue;
    store(app, date, base, c, toE8(got[c].rate), got[c].source);
    n++;
  }
  const missing = want.filter((c) => got[c] === undefined);
  return { ok: missing.length === 0, stored: n, day: date, missing: missing, message: missing.length > 0 ? 'No rate found for ' + missing.join(', ') + '; set one with fx.set.' : '' };
}

/* ------------------------------------------------------------------- ops */

function list(ctx, p) {
  const u = L('lib_util');
  const where = [];
  const bind = {};
  const base = u.str(p, 'base', '').toUpperCase();
  if (base !== '') {
    where.push('base = {:b}');
    bind.b = base;
  }
  const quote = u.str(p, 'quote', '').toUpperCase();
  if (quote !== '') {
    where.push('quote = {:q}');
    bind.q = quote;
  }
  const rows = u.findMany(ctx.app, 'fx_rates', where.length > 0 ? where.join(' && ') : '1=1', '-day,quote', u.int(p, 'limit', 60, 1, 1000), bind);
  return { rates: rows.map((r) => ({ id: r.id, day: r.getString('day'), base: r.getString('base'), quote: r.getString('quote'), rate_e8: r.getInt('rate_e8'), rate: L('lib_money').e8Text(r.getInt('rate_e8')), source: r.getString('source') })), currencies: currencies(ctx.app), base_currency: L('lib_settings').row(ctx.app).getString('base_currency') };
}

function refreshOp(ctx) {
  const out = refresh(ctx.app);
  L('lib_audit').note(ctx, { collection: 'fx_rates', summary: 'Fetched exchange rates (' + (out.stored || 0) + ' stored)' });
  return out;
}

function setOp(ctx, p) {
  const u = L('lib_util');
  const base = u.req(p, 'base', 'USD').toUpperCase();
  const quote = u.req(p, 'quote', 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote) || base === quote) throw u.fail(400, 'base and quote are two different three-letter codes.', 'invalid_param', { param: 'quote' });
  const r = u.e8(p, 'rate', { positive: true });
  if (r === null) throw u.fail(400, 'rate is required: how many ' + quote + ' one ' + base + ' buys, e.g. 0.92', 'missing_param', { param: 'rate' });
  const day = u.day(p, 'day', u.today(ctx.app));
  store(ctx.app, day, base, quote, r, 'set by a person');
  L('lib_audit').note(ctx, { collection: 'fx_rates', summary: 'Set ' + base + '/' + quote + ' to ' + L('lib_money').e8Text(r) + ' on ' + day });
  return { day: day, base: base, quote: quote, rate_e8: r, rate: L('lib_money').e8Text(r) };
}

/** fx.convert: what an amount is worth in another currency (for screens and your AI agent). */
function convertOp(ctx, p) {
  const u = L('lib_util');
  const from = u.req(p, 'from', 'USD').toUpperCase();
  const to = u.req(p, 'to', 'EUR').toUpperCase();
  const minor = u.money(p, 'amount', from, { required: true, allowNegative: true });
  const out = convert(ctx.app, minor, from, to, u.day(p, 'day', ''), u.oneOf(p, 'mode', ['end', 'avg'], 'end'), u.day(p, 'from_day', ''));
  return Object.assign({ from: from, to: to, amount_minor: minor }, out);
}

module.exports = { FRANKFURTER: FRANKFURTER, CURRENCY_API: CURRENCY_API, rate: rate, avg: avg, convert: convert, currencies: currencies, refresh: refresh, list: list, refreshOp: refreshOp, setOp: setOp, convertOp: convertOp };
