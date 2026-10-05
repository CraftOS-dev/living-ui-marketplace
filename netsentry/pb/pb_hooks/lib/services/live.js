/**
 * Live numbers while someone looks (v4 plan §16, N-B24).
 *
 * When a person has the server on screen (the watch the pages keep, 60 s), the monitor's check-in
 * config says `live: true`; the monitor then samples every 2 s on its own thread and sends the
 * latest sample with each check-in. The console keeps exactly one `live_status` record per server
 * (each sample replaces the last — no history) and pages follow it in realtime. Everything the
 * monitor sends is re-shaped here: only these fields, numbers as numbers, names clipped.
 */
const repo = require('../infra/repo.js');

const MAX_APPS = 100;
const STATES = ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'];

function num(v, lo, hi) {
  const n = Number(v);
  return typeof v === 'number' && isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null;
}

/** A live sample from the monitor → the shape pages read, or null if it isn't one. */
function shape(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const apps = [];
  for (const c of Array.isArray(raw.apps) ? raw.apps.slice(0, MAX_APPS) : []) {
    if (!c || typeof c !== 'object' || typeof c.container !== 'string' || !c.container) continue;
    const state = STATES.indexOf(c.state) >= 0 ? c.state : 'exited';
    apps.push({
      container: c.container.slice(0, 200),
      state,
      running: state === 'running',
      health: typeof c.health === 'string' ? c.health.slice(0, 20) : '',
      cpu: num(c.cpu, 0, 100000),
      mem: num(c.mem, 0, 1e15),
    });
  }
  return {
    cpu: num(raw.cpu, 0, 100),
    mem_pct: num(raw.mem_pct, 0, 100),
    mem_used: num(raw.mem_used, 0, 1e15),
    mem_total: num(raw.mem_total, 0, 1e15),
    disk_pct: num(raw.disk_pct, 0, 100),
    disk_free: num(raw.disk_free, 0, 1e18),
    disk_mount: typeof raw.disk_mount === 'string' ? raw.disk_mount.slice(0, 200) : '',
    uptime_s: num(raw.uptime_s, 0, 1e10),
    apps,
  };
}

/** Keep the latest sample for this server (one record, replaced each time). */
function store(app, assetId, raw) {
  const data = shape(raw);
  if (!data) return false;
  let rec = repo.first(app, 'live_status', 'asset = {:a}', { a: assetId });
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId('live_status'));
    rec.set('asset', assetId);
  }
  rec.set('at', repo.nowIso());
  rec.set('data', data);
  app.save(rec);
  return true;
}

module.exports = { shape, store };
