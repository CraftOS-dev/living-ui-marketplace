/// <reference path="../pb_data/types.d.ts" />
/**
 * Exchange rates for deals in other currencies.
 *
 * A rate is "home currency per 1 unit" on a date. Open deals are valued at
 * the latest rate; a deal's home value is frozen when it is won or lost, so
 * won revenue does not drift afterwards. Rates are typed in or fetched from
 * the European Central Bank reference rates (www.ecb.europa.eu, about 30
 * currencies, working days only). Amounts in different currencies are never
 * added up raw: a deal without a rate is left out of totals and counted.
 */

const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function home(app) {
  const rows = app.findRecordsByFilter('settings', 'id != ""', '', 1, 0);
  return rows.length > 0 ? rows[0].getString('home_currency') || 'USD' : 'USD';
}

function serialize(rec) {
  return { id: rec.id, date: rec.getString('date'), currency: rec.getString('currency'), rate: rec.getString('rate'), source: rec.getString('source') || 'manual' };
}

/** The latest rate on or before `date` (default: any), as a decimal string, or ''. */
function rateFor(app, currency, date) {
  const rows = app.findRecordsByFilter('fx_rates', 'currency = {:c} && date <= {:d}', '-date', 1, 0, { c: currency, d: date || '9999-12-31' });
  return rows.length > 0 ? rows[0].getString('rate') : '';
}

/** Rates as a map currency -> latest rate (decimal string), for valuing many deals at once. */
function latestMap(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('fx_rates', 'id != ""', '-date', 0, 0)) {
    const c = r.getString('currency');
    if (out[c] === undefined) out[c] = r.getString('rate');
  }
  return out;
}

/** Minor units of `ccy` in the home currency, or null when there is no rate. */
function toHome(minor, ccy, homeCcy, rate) {
  const money = require(`${__hooks}/lib_money.js`);
  if (!ccy || ccy === homeCcy) return minor;
  if (!rate) return null;
  return money.toHome(minor, ccy, homeCcy, rate);
}

function set(app, currency, date, rate, source) {
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const c = String(currency || '').toUpperCase();
  if (!money.known(c)) throw fail(400, 'Unknown currency ' + currency);
  if (c === home(app)) throw fail(400, c + ' is the home currency (its rate is always 1)');
  const d = dates.parse(date || dates.today(), 'date');
  const r = money.decimal(rate, 'rate');
  if (!(Number(r) > 0)) throw fail(400, 'rate must be above zero');
  const rows = app.findRecordsByFilter('fx_rates', 'currency = {:c} && date = {:d}', '', 1, 0, { c: c, d: d });
  const rec = rows.length > 0 ? rows[0] : new Record(app.findCollectionByNameOrId('fx_rates'));
  rec.set('currency', c);
  rec.set('date', d);
  rec.set('rate', r);
  rec.set('source', source || 'manual');
  app.save(rec);
  return rec;
}

function list(app, currency, limit) {
  const filter = currency ? 'currency = {:c}' : 'id != ""';
  return app.findRecordsByFilter('fx_rates', filter, '-date,currency', limit || 300, 0, { c: String(currency || '').toUpperCase() }).map(serialize);
}

/** Currencies used by deals and pipelines other than the home currency, with their latest rate. */
function inUse(app) {
  const h = home(app);
  const seen = {};
  for (const d of app.findRecordsByFilter('deals', "currency != '' && deleted = ''", '', 0, 0)) seen[d.getString('currency')] = true;
  for (const p of app.findRecordsByFilter('pipelines', "currency != ''", '', 0, 0)) seen[p.getString('currency')] = true;
  delete seen[h];
  return Object.keys(seen)
    .filter((c) => c !== '')
    .sort()
    .map((c) => ({ currency: c, latest: rateFor(app, c, ''), deals: app.countRecords('deals', $dbx.hashExp({ currency: c, deleted: '' })) }));
}

/** Parse ECB XML into [{ date, rates: { CCY: perEUR } }]. */
function parseEcb(xml) {
  const out = [];
  const re = /<Cube time=['"](\d{4}-\d{2}-\d{2})['"]>([\s\S]*?)<\/Cube>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const rates = { EUR: 1 };
    const r2 = /<Cube currency=['"]([A-Z]{3})['"] rate=['"]([\d.]+)['"]\s*\/>/g;
    let x;
    while ((x = r2.exec(m[2])) !== null) rates[x[1]] = Number(x[2]);
    out.push({ date: m[1], rates: rates });
  }
  return out;
}

/** Fetch today's ECB rates for the currencies in use (or given) and store them as home-per-unit. */
function fetchEcb(app, currencies) {
  const h = home(app);
  const want = (currencies && currencies.length > 0 ? currencies : inUse(app).map((x) => x.currency)).map((c) => String(c).toUpperCase());
  if (want.length === 0) return { stored: 0, dates: [], missing: [], note: 'No deals in other currencies' };
  let res;
  try {
    res = $http.send({ url: ECB_DAILY, method: 'GET', timeout: 20 });
  } catch (err) {
    throw fail(502, 'Could not reach the European Central Bank: ' + String((err && err.message) || err));
  }
  if (res.statusCode !== 200) throw fail(502, 'The European Central Bank answered ' + res.statusCode);
  const days = parseEcb(toString(res.body));
  if (days.length === 0) throw fail(502, 'No rates in the European Central Bank answer');
  const d = days[0];
  const homePerEur = d.rates[h];
  if (!homePerEur) throw fail(409, 'The European Central Bank does not publish ' + h + '; type rates in by hand');
  let stored = 0;
  const missing = [];
  for (const c of want) {
    const perEur = d.rates[c];
    if (!perEur) {
      missing.push(c);
      continue;
    }
    set(app, c, d.date, (homePerEur / perEur).toFixed(8).replace(/0+$/, '').replace(/\.$/, ''), 'ecb');
    stored++;
  }
  return { stored: stored, dates: [d.date], missing: missing };
}

module.exports = { home: home, serialize: serialize, rateFor: rateFor, latestMap: latestMap, toHome: toHome, set: set, list: list, inUse: inUse, fetchEcb: fetchEcb };
