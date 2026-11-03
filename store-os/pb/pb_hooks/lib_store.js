/// <reference path="../pb_data/types.d.ts" />
/**
 * The settings row, your AI agent's limits, the activity trail and money
 * across currencies.
 *
 * Exchange rates: one table of today's rates against the base currency,
 * fetched from two keyless sources (currency-api on jsDelivr, which covers
 * 200+ currencies, then the European Central Bank's rates through
 * Frankfurter) at boot and every six hours. Totals in another currency are
 * converted at that table; an amount whose currency has no rate is left out
 * of a total and counted, never guessed.
 */

const SETTINGS_ID = 'storesettings01';
const KINDS = ['listings', 'prices', 'stock', 'replies', 'orders'];
const CURRENCY_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/';
const FRANKFURTER = 'https://api.frankfurter.dev/v1/latest';

let _u = null;
function u() {
  if (_u === null) _u = require(`${__hooks}/lib_util.js`);
  return _u;
}

function settings(app) {
  return app.findRecordById('settings', SETTINGS_ID);
}

function autonomyOf(rec) {
  const a = u().json(rec, 'autonomy', {});
  const out = {};
  for (const k of KINDS) out[k] = a[k] === 'auto' ? 'auto' : 'ask';
  return out;
}

function settingsView(rec) {
  const U = u();
  const fx = U.json(rec, 'fx', {});
  const guards = U.json(rec, 'guards', {});
  return {
    business_name: rec.getString('business_name'),
    owner_name: rec.getString('owner_name'),
    country: rec.getString('country'),
    base_currency: rec.getString('base_currency'),
    timezone: rec.getString('timezone'),
    utc_offset: rec.getInt('utc_offset'),
    autonomy: autonomyOf(rec),
    guards: { max_price_drop_pct: typeof guards.max_price_drop_pct === 'number' ? guards.max_price_drop_pct : 30, min_margin_pct: typeof guards.min_margin_pct === 'number' ? guards.min_margin_pct : 0 },
    pii_days: rec.getInt('pii_days'),
    low_stock: rec.getInt('low_stock'),
    fx: { base: String(fx.base || ''), date: String(fx.date || ''), source: String(fx.source || ''), currencies: fx.rates ? Object.keys(fx.rates).length : 0, error: rec.getString('fx_error') },
    onboarded: rec.getBool('onboarded'),
  };
}

/** Your AI agent's change of this kind runs at once (the seller set it to automatic). */
function autoAllowed(app, kind) {
  if (KINDS.indexOf(kind) < 0) return false;
  return autonomyOf(settings(app))[kind] === 'auto';
}

/** The base currency, or a clear refusal when the store is not set up yet. */
function base(app) {
  const cur = settings(app).getString('base_currency');
  if (cur === '') throw u().fail(409, 'Set the store\'s base currency first (settings.update --base_currency MYR, or the first screen of the app).', 'not_set_up');
  return cur;
}

function baseOrEmpty(app) {
  return settings(app).getString('base_currency');
}

function log(app, actor, text, target) {
  try {
    const rec = u().newRecord(app, 'activity');
    rec.set('actor', actor);
    rec.set('text', u().clip(text, 600));
    rec.set('target', target || '');
    app.save(rec);
  } catch (err) {
    console.error('[store] activity log failed:', err);
  }
}

/* --------------------------------------------------------------- exchange */

/**
 * The rates table as { home, base, date, rates }: `home` is the store's base
 * currency, `base` the currency the rates are against (the same once
 * fetched), rates are units of a currency per 1 base, keys upper case. Read
 * it once per request and pass it to toBase.
 */
function fxTable(app) {
  const rec = settings(app);
  const stamp = rec.getString('fx_at') + '|' + rec.getString('base_currency');
  const memo = app.store().get('store_fx');
  if (memo && memo.stamp === stamp) return memo.table;
  const fx = u().json(rec, 'fx', {});
  const rates = {};
  for (const k of Object.keys(fx.rates || {})) rates[k.toUpperCase()] = Number(fx.rates[k]);
  const table = { home: rec.getString('base_currency'), base: String(fx.base || ''), date: String(fx.date || ''), rates: rates };
  app.store().set('store_fx', { stamp: stamp, table: table });
  return table;
}

/**
 * Minor units of `cur` as minor units of the base currency; null when there
 * is no rate for `cur` yet.
 */
function toBase(app, minor, cur, table) {
  const U = u();
  const t = table || fxTable(app);
  const b = t.home;
  if (!cur || cur === b) return Math.round(Number(minor || 0));
  if (t.base !== b) return null;
  const r = t.rates[String(cur).toUpperCase()];
  if (!(r > 0)) return null;
  const major = Number(minor || 0) / Math.pow(10, U.exp(cur));
  return Math.round((major / r) * Math.pow(10, U.exp(b)));
}

function getJson(url) {
  try {
    const res = $http.send({ url: url, method: 'GET', timeout: 8 });
    return { status: res.statusCode, json: res.json };
  } catch (err) {
    console.error('[store] fx request failed:', url, err);
    return null;
  }
}

/** Fetch today's rates against the base currency. Returns the settings view's fx block. */
function fxRefresh(app) {
  const rec = settings(app);
  const b = rec.getString('base_currency');
  if (b === '') return null;
  let table = null;
  let source = '';
  let date = '';
  const first = getJson(CURRENCY_API + b.toLowerCase() + '.json');
  if (first !== null && first.status === 200 && first.json && first.json[b.toLowerCase()]) {
    table = {};
    const raw = first.json[b.toLowerCase()];
    for (const k of Object.keys(raw)) if (typeof raw[k] === 'number' && raw[k] > 0) table[k.toUpperCase()] = raw[k];
    source = 'currency-api (' + String(first.json.date || '') + ')';
    date = String(first.json.date || u().today());
  }
  if (table === null) {
    const second = getJson(FRANKFURTER + '?base=' + b);
    if (second !== null && second.status === 200 && second.json && second.json.rates) {
      table = {};
      for (const k of Object.keys(second.json.rates)) table[k.toUpperCase()] = Number(second.json.rates[k]);
      source = 'European Central Bank via Frankfurter';
      date = String(second.json.date || u().today());
    }
  }
  if (table === null) {
    rec.set('fx_error', 'The exchange-rate services did not answer; totals use the last rates (' + (u().json(rec, 'fx', {}).date || 'none yet') + ').');
    app.save(rec);
    return settingsView(rec).fx;
  }
  rec.set('fx', { base: b, date: date, source: source, rates: table });
  rec.set('fx_at', u().now());
  rec.set('fx_error', '');
  app.save(rec);
  return settingsView(rec).fx;
}

module.exports = {
  SETTINGS_ID: SETTINGS_ID,
  KINDS: KINDS,
  settings: settings,
  settingsView: settingsView,
  autonomyOf: autonomyOf,
  autoAllowed: autoAllowed,
  base: base,
  baseOrEmpty: baseOrEmpty,
  log: log,
  fxTable: fxTable,
  toBase: toBase,
  fxRefresh: fxRefresh,
};
