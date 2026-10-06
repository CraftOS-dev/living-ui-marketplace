/**
 * Backups (plan §16.3). A backup plan says what is backed up and how
 * NetSentry knows it ran:
 *   heartbeat — the backup job opens a private link when it finishes
 *               (…/hb/<token>; add ?status=fail&note=… on failure). Works with
 *               any backup tool. The token is shown once and stored hashed.
 *   declared  — the person says it is backed up; NetSentry cannot see it,
 *               so the app's backup check never turns green ("told, not seen").
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const { OpError } = require('../core/util.js');

const HB_PREFIX = '/api/netsentry/hb/';

function hash(token) {
  return $security.sha256(String(token));
}

function appIds(app, assetId, csv) {
  const ids = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    const a = repo.byId(app, 'apps', id);
    if (!a || a.getString('asset') !== assetId) throw new OpError(400, `App ${id} is not on this server.`);
  }
  return ids;
}

function createPlan(app, actor, p) {
  const asset = repo.byId(app, 'assets', String(p.asset_id || ''));
  if (!asset) throw new OpError(404, 'Server not found.');
  const name = String(p.name || '').trim().slice(0, 120);
  if (!name) throw new OpError(400, 'Give the backup a name, e.g. "Nightly to USB drive".');
  const method = p.method === 'declared' ? 'declared' : p.method === 'netsentry' ? 'netsentry' : 'heartbeat';
  if (method === 'netsentry') {
    if (!/^(\/|[A-Za-z]:\\)/.test(String(p.destination || ''))) throw new OpError(400, 'Give the full path of a folder on the server for the copies, e.g. /mnt/backups (another disk or a NAS share).');
    if (!String(p.app_ids || '').trim()) throw new OpError(400, 'Pick the app(s) NetSentry should back up.');
  }
  const schedule = Math.round(Number(p.schedule_hours || 24));
  if (!(schedule >= 1 && schedule <= 24 * 31)) throw new OpError(400, 'schedule_hours must be between 1 and 744.');
  const grace = Math.round(Number(p.grace_hours === undefined || p.grace_hours === '' ? Math.min(6, Math.ceil(schedule / 4)) : p.grace_hours));
  const token = method === 'heartbeat' ? $security.randomString(40) : '';
  const rec = repo.create(app, 'backup_plans', {
    name,
    asset: asset.id,
    apps: appIds(app, asset.id, p.app_ids),
    method,
    schedule_hours: schedule,
    grace_hours: Math.max(0, Math.min(168, grace)),
    destination: String(p.destination || '').slice(0, 200),
    token_hash: token ? hash(token) : '',
    created_by: actor.label || actor.type,
    keep_daily: Math.max(1, Math.min(60, Number(p.keep_daily) || 7)),
    keep_weekly: Math.max(0, Math.min(52, p.keep_weekly === undefined ? 4 : Number(p.keep_weekly))),
    keep_monthly: Math.max(0, Math.min(36, p.keep_monthly === undefined ? 6 : Number(p.keep_monthly))),
    test_every_days: Math.max(7, Math.min(180, Number(p.test_every_days) || 30)),
  });
  audit.append(app, actor, 'backup.plan_created', { collection: 'backup_plans', id: rec.id }, `Added backup "${name}" (${method})`, null);
  reevaluate(app, asset);
  return {
    ok: true,
    plan_id: rec.id,
    heartbeat_path: token ? HB_PREFIX + token : '',
    message: token
      ? 'Copy the link now — it is shown only once. Have your backup job open it when a backup finishes.'
      : method === 'netsentry'
        ? 'Saved. The first copy is made within the hour; NetSentry tests a restore every month.'
        : 'Saved. NetSentry cannot see this backup run, so it will show as "told, not seen".',
  };
}

function newLink(app, actor, p) {
  const rec = repo.byId(app, 'backup_plans', String(p.plan_id || ''));
  if (!rec) throw new OpError(404, 'Backup plan not found.');
  if (rec.getString('method') !== 'heartbeat') throw new OpError(409, 'Only heartbeat backups have a link.');
  const token = $security.randomString(40);
  repo.update(app, rec, { token_hash: hash(token) });
  audit.append(app, actor, 'backup.link_rotated', { collection: 'backup_plans', id: rec.id }, `New link for backup "${rec.getString('name')}"`, null);
  return { ok: true, heartbeat_path: HB_PREFIX + token, message: 'The old link stopped working. Put this one in your backup job.' };
}

function deletePlan(app, actor, p) {
  const rec = repo.byId(app, 'backup_plans', String(p.plan_id || ''));
  if (!rec) throw new OpError(404, 'Backup plan not found.');
  const name = rec.getString('name');
  app.delete(rec);
  audit.append(app, actor, 'backup.plan_deleted', { collection: 'backup_plans', id: p.plan_id }, `Removed backup "${name}"`, null);
  reevaluate(app, repo.byId(app, 'assets', rec.getString('asset')));
  return { ok: true };
}

/** Backups changed: the machine's checks follow at once. */
function reevaluate(app, asset) {
  if (!asset) return;
  try {
    require('./v2.js').evaluateAndAlert(app, asset.id);
  } catch (err) {
    console.error('[netsentry] backup re-evaluation failed:', err);
  }
}

/** The backup job checked in. Unknown tokens get the same answer (nothing to probe for). */
function heartbeat(app, token, status, note) {
  const rec = token && token.length >= 20 ? repo.first(app, 'backup_plans', 'token_hash = {:h}', { h: hash(token) }) : null;
  if (!rec) return { ok: false };
  const now = repo.nowIso();
  const clean = String(note || '').replace(/[^\x20-\x7E]/g, ' ').slice(0, 300);
  if (status === 'fail') repo.update(app, rec, { last_failure: now, last_note: clean });
  else repo.update(app, rec, { last_success: now, last_note: clean });
  reevaluate(app, repo.byId(app, 'assets', rec.getString('asset')));
  return { ok: true };
}

module.exports = { createPlan, newLink, deletePlan, heartbeat, HB_PREFIX };
