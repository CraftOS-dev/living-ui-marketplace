/// <reference path="../pb_data/types.d.ts" />
/**
 * Exchange rates and revaluation.
 *
 * A rate is "home currency per 1 unit" on a date; the ledger uses the latest
 * rate on or before an entry's date. Rates are typed in, come from a
 * document, or are fetched from the European Central Bank reference rates
 * (www.ecb.europa.eu, about 30 currencies, working days only).
 *
 * Revaluation restates foreign-currency bank, card and cash accounts at a
 * period-end rate; the change in home value is an unrealized exchange gain
 * or loss.
 */

const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const ECB_90 = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function serialize(rec) {
  return { id: rec.id, date: rec.getString('date'), currency: rec.getString('currency'), rate: rec.getString('rate'), source: rec.getString('source') || 'manual' };
}

function set(app, currency, date, rate, source) {
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const c = String(currency || '').toUpperCase();
  if (!money.known(c)) throw fail(400, 'Unknown currency ' + currency);
  if (c === ledger.home(app)) throw fail(400, c + ' is the home currency (its rate is always 1)');
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

/** Currencies in use: accounts, contacts, documents, other than home. */
function inUse(app) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const home = ledger.home(app);
  const seen = {};
  for (const a of app.findRecordsByFilter('accounts', "currency != ''", '', 0, 0)) seen[a.getString('currency')] = true;
  for (const c of app.findRecordsByFilter('contacts', "currency != ''", '', 0, 0)) seen[c.getString('currency')] = true;
  for (const d of app.findRecordsByFilter('documents', "currency != ''", '', 500, 0)) seen[d.getString('currency')] = true;
  delete seen[home];
  return Object.keys(seen)
    .filter((c) => c !== '')
    .sort()
    .map((c) => ({ currency: c, latest: ledger.rateFor(app, c, '9999-12-31') }));
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

/**
 * Fetch ECB rates for the currencies in use (or given) and store them as
 * home-per-unit. days: 1 (latest) or up to 90.
 */
function fetchEcb(app, currencies, days) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const home = ledger.home(app);
  const want = (currencies && currencies.length > 0 ? currencies : inUse(app).map((x) => x.currency)).map((c) => String(c).toUpperCase());
  if (want.length === 0) return { stored: 0, dates: [], note: 'No foreign currencies in use' };
  let res;
  try {
    res = $http.send({ url: days > 1 ? ECB_90 : ECB_DAILY, method: 'GET', timeout: 20 });
  } catch (err) {
    throw fail(502, 'Could not reach the European Central Bank: ' + String((err && err.message) || err));
  }
  if (res.statusCode !== 200) throw fail(502, 'The European Central Bank answered ' + res.statusCode);
  const days2 = parseEcb(toString(res.body));
  if (days2.length === 0) throw fail(502, 'No rates in the European Central Bank answer');
  const keep = days > 1 ? days2.slice(0, Math.min(days, 90)) : days2.slice(0, 1);
  let stored = 0;
  const missing = {};
  for (const d of keep) {
    const homePerEur = d.rates[home];
    if (!homePerEur) throw fail(409, 'The European Central Bank does not publish ' + home + '; type rates in by hand');
    for (const c of want) {
      const perEur = d.rates[c];
      if (!perEur) {
        missing[c] = true;
        continue;
      }
      const rate = (homePerEur / perEur).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
      set(app, c, d.date, rate, 'ecb');
      stored++;
    }
  }
  return { stored: stored, dates: keep.map((d) => d.date), missing: Object.keys(missing) };
}

/**
 * Revalue foreign-currency bank, card and cash accounts at `date`, posting
 * the difference to exchange gains and losses. Returns the transaction or
 * null when nothing moved.
 */
function revalue(app, date, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const d = dates.parse(date, 'date');
  const home = ledger.home(app);
  const accs = app.findRecordsByFilter('accounts', "archived = false && currency != '' && currency != {:h} && (subtype = 'bank' || subtype = 'cash' || subtype = 'card')", 'code', 0, 0, { h: home });
  const rows = [];
  const detail = [];
  let total = 0;
  for (const a of accs) {
    const b = ledger.balanceOf(app, a.id, d);
    const ccy = a.getString('currency');
    const rate = ledger.rateFor(app, ccy, d);
    if (!rate) throw fail(409, 'No ' + ccy + ' rate on or before ' + d + '; add one first');
    const target = money.toHome(b.amount, ccy, home, rate);
    const diff = target - b.home;
    if (diff === 0) continue;
    rows.push({ account: a, amount: 0, currency: ccy, home_amount: diff, rate: rate, memo: 'Revaluation at ' + rate, keep_zero: true });
    total += diff;
    detail.push({ account: a.id, name: a.getString('name'), currency: ccy, balance: b.amount, before: b.home, after: target, diff: diff, rate: rate });
  }
  if (rows.length === 0) return { txn: null, detail: detail };
  rows.push({ account: ledger.sys(app, 'fx'), amount: -total, currency: home, home_amount: -total, memo: 'Unrealized exchange difference' });
  const r = ledger.create(app, { date: d, narration: 'Currency revaluation at ' + d, kind: 'fx', postings: rows, reason: detail.map((x) => x.name + ': ' + money.format(x.diff, home)).join('; ') }, who);
  return { txn: r.txn, detail: detail };
}

module.exports = { ECB_DAILY: ECB_DAILY, serialize: serialize, set: set, list: list, inUse: inUse, parseEcb: parseEcb, fetchEcb: fetchEcb, revalue: revalue };
