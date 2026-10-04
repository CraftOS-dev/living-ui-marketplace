/// <reference path="../pb_data/types.d.ts" />
/**
 * Currency conversion. Rates are stored as units per 1 EUR (the ECB's
 * reference convention). Any currency the ECB does not publish can be
 * entered by hand in Settings (source "manual").
 */

function rateMap(app) {
  const map = { EUR: 1 };
  try {
    const rows = app.findRecordsByFilter('fx_rates', '', '', 0, 0, {});
    for (const r of rows) {
      const v = r.getFloat('per_eur');
      if (v > 0) map[r.getString('code').toUpperCase()] = v;
    }
  } catch {
    /* none */
  }
  return map;
}

/** Convert an amount; returns null when either rate is unknown. */
function convert(app, amount, from, to, rates) {
  if (amount === null || amount === undefined || isNaN(amount)) return null;
  const f = String(from || '').toUpperCase();
  const t = String(to || '').toUpperCase();
  if (f === '' || t === '') return null;
  if (f === t) return amount;
  const map = rates || rateMap(app);
  if (!map[f] || !map[t]) return null;
  return Math.round((amount / map[f]) * map[t] * 100) / 100;
}

/** Fetch the ECB daily reference rates and upsert them. */
function refreshEcb(app) {
  const res = $http.send({
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    method: 'GET',
    timeout: 30,
  });
  if (res.statusCode !== 200) throw new Error('ECB reference rates returned HTTP ' + res.statusCode);
  let xml = '';
  try {
    xml = toString(res.body);
  } catch {
    xml = String(res.body || '');
  }
  const timeMatch = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml);
  const asOf = timeMatch ? timeMatch[1] + ' 00:00:00.000Z' : new Date().toISOString();
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  const col = app.findCollectionByNameOrId('fx_rates');
  let count = 0;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const code = m[1];
    const rate = parseFloat(m[2]);
    if (!(rate > 0)) continue;
    let rec = null;
    try {
      rec = app.findFirstRecordByFilter('fx_rates', 'code = {:c}', { c: code });
    } catch {
      rec = null;
    }
    if (rec !== null && rec.getString('source') === 'manual') continue;
    if (rec === null) {
      rec = new Record(col);
      rec.set('code', code);
    }
    rec.set('per_eur', rate);
    rec.set('as_of', asOf);
    rec.set('source', 'ecb');
    app.save(rec);
    count += 1;
  }
  if (count === 0) throw new Error('ECB response contained no rates');
  try {
    const s = app.findRecordsByFilter('settings', '', 'created', 1, 0, {})[0];
    if (s) {
      s.set('fx_updated', new Date().toISOString());
      app.save(s);
    }
  } catch {
    /* settings missing */
  }
  return { updated: count, as_of: asOf.slice(0, 10) };
}

module.exports = { rateMap: rateMap, convert: convert, refreshEcb: refreshEcb };
