/**
 * Live numbers for the "it is working" feeling: how much NetSentry checked
 * today, how much it is watching, what it saw — for everything or one item.
 * Counts use the database directly (no records loaded).
 */
const repo = require('../infra/repo.js');

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return repo.pbDate(d.toISOString());
}

function count(app, collection, where, params) {
  return app.countRecords(collection, $dbx.exp(where, params || {}));
}

function stats(app, p) {
  const assetId = String((p && p.asset_id) || '');
  const today = startOfToday();
  const assetIds = assetId ? [assetId] : repo.find(app, 'assets', 'status = "active"').map((a) => a.id);
  const sources = repo.find(app, 'sources', assetId ? 'target = {:a}' : 'id != ""', { a: assetId });
  const sourceIds = sources.map((s) => s.id);
  let lastCheck = '';
  for (const s of sources) {
    const t = repo.isoOf(s, 'last_run');
    if (t > lastCheck) lastCheck = t;
  }
  const inList = (col, ids) => (ids.length ? `${col} IN (${ids.map((_, i) => `{:v${i}}`).join(',')})` : '1=0');
  const idParams = (ids) => Object.fromEntries(ids.map((id, i) => ['v' + i, id]));
  return {
    ok: true,
    checks_today: count(app, 'scan_runs', `started >= {:t} AND ${inList('source', sourceIds)}`, Object.assign({ t: today }, idParams(sourceIds))),
    watched: count(app, 'observations', `present = 1 AND ${inList('asset', assetIds)}`, idParams(assetIds)),
    connections_today: count(app, 'signals', `kind = 'net.conn' AND window_start >= {:t} AND ${inList('asset', assetIds)}`, Object.assign({ t: today }, idParams(assetIds))),
    problems: count(app, 'findings', `status = 'open' AND ${inList('asset', assetIds)}`, idParams(assetIds)),
    last_check: lastCheck,
  };
}

module.exports = { stats };
