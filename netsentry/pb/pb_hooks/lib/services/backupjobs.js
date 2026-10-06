/**
 * NetSentry's own backups (v3 plan §11): starting them on schedule, testing a
 * restore every month, restoring when a person asks, and writing down what
 * happened. Each one is a change applied by the machine's monitor, so it is
 * audited like any other; a plan a person set up is the standing confirmation
 * for its scheduled runs and tests (V3-D3) — a restore always needs an admin.
 */
const repo = require('../infra/repo.js');
const actions = require('../v2/actions.js');
const { OpError } = require('../core/util.js');

const ACTIVE = '(status = "planned" || status = "approved" || status = "executing")';

function planApps(plan) {
  const slice = plan.getStringSlice('apps') || [];
  const ids = [];
  for (let i = 0; i < slice.length; i++) ids.push(String(slice[i]));
  return ids;
}

function keepFor(app, a) {
  const o = repo.first(app, 'observations', 'asset = {:s} && kind = "container" && subject = {:c} && present = true', { s: a.getString('asset'), c: a.getString('container') });
  const mounts = ((o ? repo.jsonOf(o, 'data') || {} : {}).mounts || []).filter((m) => m.type === 'bind' || m.type === 'volume');
  // Settings and databases, not media libraries (those need a disk of their own, not a copy per day).
  return mounts.filter((m) => !/\/(media|movies|tv|music|downloads|data\/media|photos|library|books)(\/|$)/i.test(m.destination)).map((m) => ({ destination: m.destination }));
}

function params(app, plan, a) {
  return {
    plan_id: plan.id, app: a.getString('label') || a.getString('display_name') || a.getString('container'), container: a.getString('container'),
    dest: plan.getString('destination'), keep: keepFor(app, a),
    keep_daily: plan.getInt('keep_daily') || 7, keep_weekly: plan.getInt('keep_weekly'), keep_monthly: plan.getInt('keep_monthly'),
  };
}

function startChange(app, actor, a, action, p, purpose, approve) {
  const updates = require('./updates.js');
  const r = updates.createChange(app, actor, a, action, p, purpose);
  if (approve) {
    const rem = repo.byId(app, 'remediations', r.remediation_id);
    require('./remediations.js').approveInternal(app, rem, actor);
  }
  return r;
}

/** Hourly: start backups that are due and the monthly restore tests. One per app at a time. */
function tick(app, nowIso) {
  const now = Date.parse(nowIso || repo.nowIso());
  const started = [];
  for (const plan of repo.find(app, 'backup_plans', 'method = "netsentry"')) {
    const actor = { type: 'system', label: `backup plan "${plan.getString('name')}" (set up by ${plan.getString('created_by') || 'a person'})`, role: 'admin' };
    for (const id of planApps(plan)) {
      const a = repo.byId(app, 'apps', id);
      if (!a || a.getString('status') !== 'active' || !a.getString('container')) continue;
      if (!require('./remediations.js').executorReady(app, a.getString('asset'))) continue;
      if (repo.first(app, 'remediations', `app = {:a} && (purpose = "backup" || purpose = "restore" || purpose = "update") && ${ACTIVE}`, { a: a.id })) continue;
      const last = repo.first(app, 'backups_taken', 'app = {:a} && plan = {:p} && removed = false', { a: a.id, p: plan.id }, '-taken_at');
      const lastAt = last ? Date.parse(repo.isoOf(last, 'taken_at')) : 0;
      try {
        if (!last || now - lastAt >= (plan.getInt('schedule_hours') || 24) * 3600000 - 300000) {
          started.push(startChange(app, actor, a, 'backup.run', params(app, plan, a), 'backup', true).remediation_id);
          continue;
        }
        const tested = repo.isoOf(plan, 'last_test');
        if (!tested || now - Date.parse(tested) >= (plan.getInt('test_every_days') || 30) * 86400000) {
          const p = { app: a.getString('label') || a.getString('display_name') || a.getString('container'), container: a.getString('container'), dest: plan.getString('destination'), archive: last.getString('archive'), taken_id: last.id };
          started.push(startChange(app, actor, a, 'backup.test', p, 'backup', true).remediation_id);
        }
      } catch (err) {
        console.error('[netsentry] backup not started:', err);
      }
    }
  }
  return started;
}

/** The monitor reported (ok or not): copies, tests and restores are written down. */
function settle(app, rem, outputs, ok) {
  const step = ((repo.jsonOf(rem, 'plan') || {}).steps || [])[0] || {};
  const p = step.params || {};
  const plan = p.plan_id ? repo.byId(app, 'backup_plans', p.plan_id) : null;
  const now = repo.nowIso();
  let note = {};
  try {
    note = JSON.parse(String(outputs[outputs.length - 1] || '{}'));
  } catch {
    note = {};
  }
  const reason = String(outputs[outputs.length - 1] || '').slice(0, 280);
  if (step.action === 'backup.run') {
    if (!plan) return;
    if (ok && note.backup) {
      repo.create(app, 'backups_taken', {
        plan: plan.id, app: rem.getString('app'), asset: rem.getString('asset'), archive: note.backup, size_bytes: Math.round(note.size || 0),
        sha256: String(note.sha256 || '').slice(0, 64), taken_at: now, contents: String(note.contents || '').slice(0, 300), removed: false,
      });
      for (const gone of note.removed || []) {
        const r = repo.first(app, 'backups_taken', 'app = {:a} && archive = {:n}', { a: rem.getString('app'), n: String(gone) });
        if (r) repo.update(app, r, { removed: true });
      }
      repo.update(app, plan, { last_success: now, last_note: `copied: ${note.contents || ''}`.slice(0, 300) });
    } else {
      repo.update(app, plan, { last_failure: now, last_note: reason });
    }
  } else if (step.action === 'backup.test') {
    const taken = p.taken_id ? repo.byId(app, 'backups_taken', p.taken_id) : null;
    const planRec = taken ? repo.byId(app, 'backup_plans', taken.getString('plan')) : null;
    const result = ok ? `ok: ${note.result || 'restores cleanly'}` : `failed: ${reason}`;
    if (taken) repo.update(app, taken, { tested_at: now, test_result: result.slice(0, 300) });
    if (planRec) repo.update(app, planRec, { last_test: now, last_test_result: result.slice(0, 300) });
  }
  const asset = repo.byId(app, 'assets', rem.getString('asset'));
  if (asset) {
    try {
      require('./v2.js').evaluateAsset(app, asset, now);
    } catch (err) {
      console.error('[netsentry] backup re-evaluation failed:', err);
    }
  }
}

// ------------------------------------------------------------------ what people ask for

function appAndPlan(app, appId) {
  const a = repo.byId(app, 'apps', String(appId || ''));
  if (!a) throw new OpError(404, 'No such app.');
  const plan = repo.find(app, 'backup_plans', 'method = "netsentry"').find((pl) => planApps(pl).indexOf(a.id) >= 0);
  if (!plan) throw new OpError(409, "NetSentry doesn't back this app up yet — set it up under the app's Backups.");
  return { a, plan };
}

function runNow(app, actor, p) {
  const { a, plan } = appAndPlan(app, p.app_id);
  return startChange(app, actor, a, 'backup.run', params(app, plan, a), 'backup', false);
}

function testNow(app, actor, p) {
  const { a, plan } = appAndPlan(app, p.app_id);
  const taken = p.backup_id ? repo.byId(app, 'backups_taken', String(p.backup_id)) : repo.first(app, 'backups_taken', 'app = {:a} && removed = false', { a: a.id }, '-taken_at');
  if (!taken || taken.getString('app') !== a.id) throw new OpError(404, 'No backup of this app to test yet.');
  return startChange(app, actor, a, 'backup.test', { app: params(app, plan, a).app, container: a.getString('container'), dest: plan.getString('destination'), archive: taken.getString('archive'), taken_id: taken.id }, 'backup', false);
}

function restore(app, actor, p) {
  const { a, plan } = appAndPlan(app, p.app_id);
  const taken = repo.byId(app, 'backups_taken', String(p.backup_id || ''));
  if (!taken || taken.getString('app') !== a.id || taken.getBool('removed')) throw new OpError(404, 'That backup is not there any more.');
  const probe = (repo.jsonOf(a, 'endpoints') || [])[0] || null;
  return startChange(app, actor, a, 'backup.restore', { app: params(app, plan, a).app, container: a.getString('container'), dest: plan.getString('destination'), archive: taken.getString('archive'), probe }, 'restore', false);
}

module.exports = { tick, settle, runNow, testNow, restore, keepFor };
