/// <reference path="../pb_data/types.d.ts" />
/**
 * Exchange rates for reports (payslips stay in the employment's currency).
 * Rates come from the European Central Bank through Frankfurter, then the
 * free currency-api on jsdelivr when Frankfurter does not answer or lacks a
 * currency; one row per day, base (the reporting currency) and quote in
 * fx_rates. A person can also set a rate by hand (fx.set).
 *
 *   rate(app, from, to, day)            -> number of `to` per one `from` (latest on or before day), or null
 *   convert(app, minor, from, to, day)  -> minor units of `to`, or null when no rate is known
 */

const FRANKFURTER = 'https://api.frankfurter.dev/v1/latest';
const CURRENCY_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/';

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function getJson(url) {
  try {
    const res = $http.send({ url: url, method: 'GET', timeout: 15, headers: { accept: 'application/json' } });
    return { status: res.statusCode, json: res.json };
  } catch (err) {
    console.log('[hr] rates fetch failed: ' + err);
    return null;
  }
}

/** The currencies the company uses (entities and the reporting currency). */
function currencies(app) {
  const u = L('lib_util');
  const out = {};
  for (const r of u.rows(app, "SELECT DISTINCT currency FROM entities WHERE currency != ''", { currency: '' })) out[r.currency] = true;
  const rep = L('lib_settings').row(app).getString('reporting_currency');
  if (rep !== '') out[rep] = true;
  return Object.keys(out).sort();
}

function store(app, day, base, quote, rate, source) {
  const u = L('lib_util');
  let r = u.findOne(app, 'fx_rates', 'day = {:d} && base = {:b} && quote = {:q}', { d: day, b: base, q: quote });
  if (r === null) {
    r = u.newRecord(app, 'fx_rates');
    r.set('day', day);
    r.set('base', base);
    r.set('quote', quote);
  }
  r.set('rate', rate);
  r.set('source', source);
  app.save(r);
}

/** Fetch today's rates for every currency in use (cron every six hours, and fx.refresh). */
function refresh(app) {
  const u = L('lib_util');
  const base = L('lib_settings').row(app).getString('reporting_currency');
  if (base === '') return { ok: false, message: 'Set the reporting currency first.' };
  const want = currencies(app).filter((c) => c !== base);
  if (want.length === 0) return { ok: true, stored: 0, message: 'Only one currency in use.' };
  const got = {};
  let date = u.today(app);
  const first = getJson(FRANKFURTER + '?base=' + base + '&symbols=' + want.join(','));
  if (first !== null && first.status === 200 && first.json && first.json.rates) {
    for (const k of Object.keys(first.json.rates)) got[k.toUpperCase()] = { rate: Number(first.json.rates[k]), source: 'ECB via Frankfurter' };
    if (first.json.date) date = String(first.json.date);
  }
  if (want.some((c) => got[c] === undefined)) {
    const second = getJson(CURRENCY_API + base.toLowerCase() + '.json');
    const table = second !== null && second.status === 200 && second.json ? second.json[base.toLowerCase()] : null;
    if (table) for (const c of want) if (got[c] === undefined && typeof table[c.toLowerCase()] === 'number') got[c] = { rate: table[c.toLowerCase()], source: 'currency-api (' + String(second.json.date || '') + ')' };
  }
  let n = 0;
  for (const c of Object.keys(got)) {
    if (!(got[c].rate > 0)) continue;
    store(app, date, base, c, got[c].rate, got[c].source);
    n++;
  }
  const missing = want.filter((c) => got[c] === undefined);
  return { ok: missing.length === 0, stored: n, day: date, missing: missing, message: missing.length > 0 ? 'No rate found for ' + missing.join(', ') + '; set one with fx.set.' : '' };
}

function direct(app, base, quote, day) {
  const u = L('lib_util');
  const r = u.one(app, 'SELECT rate FROM fx_rates WHERE base = {:b} AND quote = {:q} AND day <= {:d} ORDER BY day DESC LIMIT 1', { rate: -0 }, { b: base, q: quote, d: day });
  return r !== null && r.rate > 0 ? r.rate : null;
}

function rate(app, from, to, day) {
  if (from === to) return 1;
  const d = day || L('lib_util').today(app);
  const a = direct(app, from, to, d);
  if (a !== null) return a;
  const b = direct(app, to, from, d);
  if (b !== null) return 1 / b;
  const base = L('lib_settings').row(app).getString('reporting_currency');
  if (base === '' || base === from || base === to) return null;
  const f = rate(app, base, from, d);
  const t = rate(app, base, to, d);
  return f !== null && t !== null ? t / f : null;
}

function convert(app, minor, from, to, day) {
  const money = L('lib_money');
  const r = rate(app, from, to, day);
  if (r === null) return null;
  return money.majorToMinor(money.toMajor(minor, from) * r, to);
}

/* ------------------------------------------------------------------- ops */

function list(ctx, p) {
  const u = L('lib_util');
  const rows = u.findMany(ctx.app, 'fx_rates', '1=1', '-day,quote', u.int(p, 'limit', 60, 1, 500));
  return { rates: rows.map((r) => ({ id: r.id, day: r.getString('day'), base: r.getString('base'), quote: r.getString('quote'), rate: r.getFloat('rate'), source: r.getString('source') })), currencies: currencies(ctx.app), reporting_currency: L('lib_settings').row(ctx.app).getString('reporting_currency') };
}

function refreshOp(ctx) {
  const out = refresh(ctx.app);
  L('lib_audit').note(ctx, { collection: 'fx_rates', summary: 'Fetched exchange rates (' + (out.stored || 0) + ' stored)' });
  return out;
}

function setOp(ctx, p) {
  const u = L('lib_util');
  const base = u.req(p, 'base', 'USD').toUpperCase();
  const quote = u.req(p, 'quote', 'JPY').toUpperCase();
  const r = u.num(p, 'rate', { min: 0 });
  if (!(r > 0)) throw u.fail(400, 'rate must be more than 0 (how many ' + quote + ' one ' + base + ' buys).', 'invalid_param', { param: 'rate' });
  const day = u.day(p, 'day', u.today(ctx.app));
  store(ctx.app, day, base, quote, r, 'set by a person');
  L('lib_audit').note(ctx, { collection: 'fx_rates', summary: 'Set ' + base + '/' + quote + ' to ' + r + ' from ' + day });
  return { day: day, base: base, quote: quote, rate: r };
}

module.exports = { FRANKFURTER: FRANKFURTER, CURRENCY_API: CURRENCY_API, refresh: refresh, rate: rate, convert: convert, currencies: currencies, list: list, refreshOp: refreshOp, setOp: setOp };
