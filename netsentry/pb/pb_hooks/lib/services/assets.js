/**
 * Assets service — what NetSentry watches, and the sources that watch it.
 */
const repo = require('../infra/repo.js');
const { createHttp } = require('../infra/http.js');
const collectors = require('../collectors/index.js');
const audit = require('./audit.js');
const { classifyTarget, isPublicIPv4 } = require('../core/targets.js');
const { OpError } = require('../core/util.js');

const MAX_ASSETS = 500;
const { DOH } = require('../../external_hosts.js');

function countAssets(app) {
  return repo.find(app, 'assets', 'id != ""').length;
}

function createSources(app, asset, sensorId) {
  const now = repo.nowIso();
  for (const c of collectors.forAssetKind(asset.getString('kind'))) {
    if (repo.first(app, 'sources', 'collector = {:c} && target = {:t}', { c: c.id, t: asset.id })) continue;
    repo.create(app, 'sources', {
      sensor: c.remote ? sensorId || '' : '',
      collector: c.id,
      target: asset.id,
      schedule_minutes: c.scheduleMinutes,
      next_run: now,
      enabled: true,
      health: 'unknown',
      consecutive_failures: 0,
      run_count: 0,
    });
  }
}

/**
 * Give every active asset the sources its kind has today. Collectors added in a
 * new release reach existing assets this way (idempotent; runs at boot).
 */
function backfillSources(app) {
  let added = 0;
  for (const a of repo.find(app, 'assets', 'status = "active"')) {
    const before = repo.find(app, 'sources', 'target = {:t}', { t: a.id }).length;
    // A re-added machine keeps its old, revoked monitor record: bind to the live one.
    const sensor = a.getString('kind') === 'host' ? repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: a.id }, '-last_seen') : null;
    if (a.getString('kind') === 'host' && !sensor) continue;
    createSources(app, a, sensor ? sensor.id : '');
    added += repo.find(app, 'sources', 'target = {:t}', { t: a.id }).length - before;
  }
  return added;
}

function requireAsset(app, id) {
  const a = repo.byId(app, 'assets', id);
  if (!a) throw new OpError(404, 'Asset not found.', 'not_found');
  return a;
}

function setStatus(app, actor, p, status) {
  const a = requireAsset(app, p.asset_id);
  if (a.getString('status') === status) throw new OpError(409, `${a.getString('identifier')} is already ${status}.`);
  repo.update(app, a, { status });
  for (const s of repo.find(app, 'sources', 'target = {:a}', { a: a.id })) {
    repo.update(app, s, { enabled: status === 'active', next_run: repo.nowIso() });
  }
  let closed = 0;
  if (status === 'retired') {
    const done = [];
    for (const f of repo.find(app, 'findings', 'asset = {:a} && status != "resolved"', { a: a.id })) {
      repo.update(app, f, { status: 'resolved', resolved_at: repo.nowIso(), status_note: 'Resolved: asset retired.', status_by: actor.label });
      done.push(f);
      closed++;
    }
    require('./findings.js').refreshIncidents(app, done);
  }
  audit.append(app, actor, status === 'retired' ? 'asset.retired' : 'asset.reactivated', { collection: 'assets', id: a.id },
    `${status === 'retired' ? 'Retired' : 'Reactivated'} ${a.getString('identifier')}`, { reason: String(p.reason || ''), findings_closed: closed });
  return { ok: true, asset_id: a.id, status, findings_closed: closed };
}

function descendants(app, id) {
  const out = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const c of repo.find(app, 'assets', 'parent = {:p} && ownership = "discovered"', { p: cur })) {
      out.push(c);
      queue.push(c.id);
    }
  }
  return out;
}

function remove(app, actor, p) {
  const a = requireAsset(app, p.asset_id);
  const children = descendants(app, a.id);
  const all = children.concat([a]);
  const label = a.getString('identifier');
  // A machine's monitor goes with it — otherwise a monitor that is still running
  // simply reports again and the machine reappears.
  const ids = all.map((r) => r.id);
  for (const s of repo.find(app, 'sensors', 'status != "revoked"')) {
    if (ids.indexOf(s.getString('asset')) >= 0) require('./sensors.js').revoke(app, actor, { sensor_id: s.id });
  }
  app.runInTransaction((tx) => {
    for (const rec of all) {
      for (const s of repo.find(tx, 'suppressions', 'fingerprint ~ {:id}', { id: '|' + rec.id + '|' })) tx.delete(s);
      // Detach any non-discovered children so the parent can go.
      for (const c of repo.find(tx, 'assets', 'parent = {:p}', { p: rec.id })) repo.update(tx, c, { parent: '' });
    }
    for (const rec of children.reverse()) tx.delete(repo.byId(tx, 'assets', rec.id));
    tx.delete(repo.byId(tx, 'assets', a.id));
  });
  audit.append(app, actor, 'asset.deleted', { collection: 'assets', id: a.id }, `Deleted ${label} and ${children.length} discovered asset(s)`,
    { removed: all.map((r) => r.getString('identifier')) });
  return { ok: true, deleted: all.length };
}

function impact(app, p) {
  const a = requireAsset(app, p.asset_id);
  return { ok: true, identifier: a.getString('identifier'), discovered_children: descendants(app, a.id).map((c) => c.getString('identifier')) };
}

function timeline(app, p) {
  const hours = Math.min(Math.max(Number(p.hours) || 168, 1), 24 * 90);
  const since = repo.pbDate(new Date(Date.now() - hours * 3600000).toISOString());
  const filter = p.asset_id ? 'asset = {:a} && at >= {:s}' : 'at >= {:s}';
  const rows = repo.find(app, 'changes', filter, { a: String(p.asset_id || ''), s: since }, '-at', 200);
  const names = {};
  return {
    ok: true,
    hours,
    changes: rows.map((c) => {
      const aid = c.getString('asset');
      if (!(aid in names)) {
        const ar = repo.byId(app, 'assets', aid);
        names[aid] = ar ? ar.getString('identifier') : '';
      }
      return {
        at: repo.isoOf(c, 'at'),
        asset: names[aid],
        kind: c.getString('kind'),
        subject: c.getString('subject'),
        change: c.getString('change'),
        before: repo.jsonOf(c, 'before'),
        after: repo.jsonOf(c, 'after'),
      };
    }),
  };
}

module.exports = { createSources, backfillSources, setStatus, remove, impact, timeline, requireAsset };
