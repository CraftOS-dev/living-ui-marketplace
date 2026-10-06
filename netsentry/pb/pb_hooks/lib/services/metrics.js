/**
 * Metrics (v3 plan §7.1): the numbers a monitor sends every minute — CPU,
 * memory, load, temperature of the machine and of each container — kept so a
 * person can see "how has it been" and so checks can say "for 30 minutes".
 *
 * Tiers: minute rows for 2 days → 15-minute rows for 14 days → hourly rows
 * for 90 days. A rolled-up row keeps the average of every number and the peak
 * of CPU and memory (`cpu_max`, `mem_max`), so a spike doesn't vanish.
 */
const repo = require('../infra/repo.js');
const { OpError } = require('../core/util.js');

/** Signal kinds that are metrics, and the subject each one's key names. */
const KINDS = { 'health.sample': true, 'container.sample': true };

const TIERS = [
  { from: '1m', to: '15m', bucketMs: 15 * 60000, keepMs: 2 * 86400000 },
  { from: '15m', to: '1h', bucketMs: 3600000, keepMs: 14 * 86400000 },
];
const HOURLY_KEEP_MS = 90 * 86400000;
const BATCH = 20000;

function isMetric(kind) {
  return !!KINDS[kind];
}

/** One sample from a monitor report (inside the report's transaction). */
function record(tx, assetId, signal) {
  const v = {};
  const data = signal.data || {};
  for (const k of Object.keys(data)) {
    const n = data[k];
    if (typeof n === 'number' && isFinite(n)) v[k] = n;
    else if (typeof n === 'string' && n.length <= 40) v[k] = n; // e.g. a container's state
  }
  repo.create(tx, 'metrics', { asset: assetId, subject: String(signal.key || 'machine').slice(0, 200), tier: '1m', t: signal.window_start, v });
}

function bucketStart(iso, ms) {
  const t = Date.parse(iso);
  return new Date(t - (t % ms)).toISOString();
}

/** Average every number; keep the peak of cpu and mem (or the existing peaks of rolled-up rows). */
function combine(rows) {
  const sum = {};
  const cnt = {};
  const out = {};
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const n = r[k];
      if (typeof n !== 'number') {
        out[k] = n; // last text value (state) wins
        continue;
      }
      if (k === 'cpu_max' || k === 'mem_max') continue;
      sum[k] = (sum[k] || 0) + n;
      cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  for (const k of Object.keys(sum)) out[k] = Math.round((sum[k] / cnt[k]) * 10) / 10;
  for (const peak of ['cpu', 'mem']) {
    let max = null;
    for (const r of rows) {
      const n = typeof r[`${peak}_max`] === 'number' ? r[`${peak}_max`] : r[peak];
      if (typeof n === 'number' && (max === null || n > max)) max = n;
    }
    if (max !== null) out[`${peak}_max`] = max;
  }
  return out;
}

/** Roll old rows up a tier; drop hourly rows past 90 days. Bounded per run. Returns counts. */
function rollup(app, nowIso) {
  const now = Date.parse(nowIso || repo.nowIso());
  const done = { rolled: 0, written: 0, dropped: 0 };
  for (const tier of TIERS) {
    // Whole buckets only: everything before the start of the bucket the keep-window begins in.
    const cutoff = repo.pbDate(bucketStart(new Date(now - tier.keepMs).toISOString(), tier.bucketMs));
    app.runInTransaction((tx) => {
      const rows = repo.find(tx, 'metrics', 'tier = {:t} && t < {:c}', { t: tier.from, c: cutoff }, 't', BATCH);
      const groups = {};
      for (const r of rows) {
        const key = `${r.getString('asset')}|${r.getString('subject')}|${bucketStart(repo.isoOf(r, 't'), tier.bucketMs)}`;
        (groups[key] = groups[key] || []).push(r);
      }
      for (const key of Object.keys(groups)) {
        const parts = key.split('|');
        const recs = groups[key];
        repo.create(tx, 'metrics', { asset: parts[0], subject: parts[1], tier: tier.to, t: parts[2], v: combine(recs.map((r) => repo.jsonOf(r, 'v') || {})) });
        done.written++;
        for (const r of recs) {
          tx.delete(r);
          done.rolled++;
        }
      }
    });
  }
  app.runInTransaction((tx) => {
    const old = repo.pbDate(new Date(now - HOURLY_KEEP_MS).toISOString());
    for (const r of repo.find(tx, 'metrics', 'tier = "1h" && t < {:c}', { c: old }, 't', BATCH)) {
      tx.delete(r);
      done.dropped++;
    }
  });
  return done;
}

/** Recent minute samples of one machine, for checks: { [subject]: [{t, ...v}] } oldest first. */
function recent(app, assetId, minutes, nowIso) {
  const since = repo.pbDate(new Date(Date.parse(nowIso) - minutes * 60000).toISOString());
  const by = {};
  for (const r of repo.find(app, 'metrics', 'asset = {:a} && tier = "1m" && t >= {:s}', { a: assetId, s: since }, 't', 20000)) {
    const s = r.getString('subject');
    (by[s] = by[s] || []).push(Object.assign({ t: repo.isoOf(r, 't') }, repo.jsonOf(r, 'v') || {}));
  }
  return by;
}

const RANGES = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720, '90d': 2160 };
const MAX_POINTS = 240;

/** A chart's worth of one subject: the right tier for the range, thinned to ≤ 240 points. */
function series(app, p) {
  const asset = repo.byId(app, 'assets', String(p.asset_id || ''));
  if (!asset) throw new OpError(404, 'No such server.');
  const hours = RANGES[p.range || '24h'];
  if (!hours) throw new OpError(400, `range must be one of ${Object.keys(RANGES).join(', ')}.`);
  const subject = String(p.subject || 'machine').slice(0, 200);
  const now = Date.now();
  const since = new Date(now - hours * 3600000).toISOString();
  // The finest tier that still covers the range (older detail has been rolled up).
  const tiers = hours <= 48 ? ['1m', '15m'] : hours <= 14 * 24 ? ['15m', '1h'] : ['1h'];
  let points = [];
  for (const tier of tiers) {
    const rows = repo.find(app, 'metrics', 'asset = {:a} && subject = {:s} && tier = {:t} && t >= {:since}',
      { a: asset.id, s: subject, t: tier, since: repo.pbDate(since) }, 't', 20000);
    points = points.concat(rows.map((r) => Object.assign({ t: repo.isoOf(r, 't') }, repo.jsonOf(r, 'v') || {})));
  }
  points.sort((a, b) => (a.t < b.t ? -1 : 1));
  if (points.length > MAX_POINTS) {
    const per = Math.ceil(points.length / MAX_POINTS);
    const thin = [];
    for (let i = 0; i < points.length; i += per) {
      const chunk = points.slice(i, i + per);
      const c = combine(chunk);
      c.t = chunk[0].t;
      thin.push(c);
    }
    points = thin;
  }
  return { asset_id: asset.id, subject, range: p.range || '24h', points };
}

module.exports = { KINDS, isMetric, record, rollup, recent, series, combine };
