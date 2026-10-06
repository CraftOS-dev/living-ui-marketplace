/**
 * THE server (v4 plan §0.1): NetSentry looks after the one machine it runs on. Its record is the
 * host asset its monitor reports for (the data model keeps assets; nothing else is a machine).
 */
const repo = require('../infra/repo.js');

/** The server's asset record, or null before its monitor has reported. */
function theServer(app) {
  const s = repo.first(app, 'sensors', 'status != "revoked" && asset != ""', {}, '-last_seen');
  const a = s ? repo.byId(app, 'assets', s.getString('asset')) : null;
  return a || repo.first(app, 'assets', 'kind = "host" && status = "active"', {}, '-updated');
}

/** How the server is doing, in one look: monitor, CPU, memory, fullest disk, updates, restart, backups. */
function summary(app, a) {
  a = a || theServer(app);
  if (!a) return null;
  const since = repo.pbDate(new Date(Date.now() - 10 * 60000).toISOString());
  const sensor = repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: a.id }, '-last_seen');
  const caps = sensor ? repo.jsonOf(sensor, 'capabilities') || {} : {};
  const m = repo.first(app, 'metrics', 'asset = {:a} && subject = "machine" && tier = "1m" && t >= {:s}', { a: a.id, s: since }, '-t');
  const v = m ? repo.jsonOf(m, 'v') || {} : {};
  const apps = repo.find(app, 'apps', 'asset = {:a} && status = "active"', { a: a.id });
  const updates = apps.map((x) => repo.jsonOf(x, 'update') || {}).filter((u) => u.state === 'available');
  const pk = repo.first(app, 'observations', 'asset = {:a} && kind = "host.package_updates" && present = true', { a: a.id });
  const hh = repo.first(app, 'observations', 'asset = {:a} && kind = "host.health" && present = true', { a: a.id });
  const plans = repo.find(app, 'backup_plans', 'asset = {:a}', { a: a.id });
  let disk = 0;
  for (const e of repo.find(app, 'evaluations', 'asset = {:a} && control = "STO-FULL-SOON"', { a: a.id })) {
    const pct = (repo.jsonOf(e, 'evidence') || {}).latest || {};
    if (pct.total) disk = Math.max(disk, Math.round((100 * pct.used) / pct.total));
  }
  return {
    asset_id: a.id, name: a.getString('label') || a.getString('identifier'),
    monitor: sensor
      ? { status: sensor.getString('status'), last_seen: repo.isoOf(sensor, 'last_seen'), version: sensor.getString('version'), latest: require('./enrol.js').sensorVersion(), os: sensor.getString('os'), platform: sensor.getString('platform'), changes_on: !!(caps.executor && caps.executor.available) }
      : null,
    cpu: typeof v.cpu === 'number' ? v.cpu : null,
    mem_pct: v.mem_total ? Math.round((100 * v.mem_used) / v.mem_total) : null,
    disk_pct: disk || null,
    apps: apps.length,
    updates: { apps: updates.length, risky: updates.filter((u) => u.risk === 'high').length, os_security: pk ? (repo.jsonOf(pk, 'data') || {}).security || 0 : null },
    reboot_required: hh ? !!(repo.jsonOf(hh, 'data') || {}).reboot_required : null,
    backups: Object.assign({ plans: plans.length }, backupApps(app, a)),
  };
}

/** Backups counted per app, as BKP-NONE judges them: one app's copy says nothing about another's. */
function backupApps(app, a) {
  let failing = 0;
  let missing = 0;
  for (const e of repo.find(app, 'evaluations', 'asset = {:a} && control = "BKP-NONE" && state = "fail"', { a: a.id })) {
    if ((repo.jsonOf(e, 'factors') || []).some((x) => /fail|never worked|no backup made/.test(String(x)))) failing++;
    else missing++;
  }
  return { apps_failing: failing, apps_not_backed_up: missing };
}

module.exports = { theServer, summary };
