/**
 * NetSentry's own fixes, applied by a machine's monitor (docs/SYSTEM-V2-PLAN.md §23).
 *
 *   approved (typed plan) ──check-in──► monitor claims, runs each step, reports
 *        ──complete──► verifying ──fresh reports──► done           (check passes AND app still answers)
 *                                                └─► failed ──check-in──► monitor undoes its steps ──► rolled_back
 *
 * The monitor only ever gets jobs for its own machine, and only when fixing was
 * switched on at that machine (capabilities.executor). Everything is audited.
 */
const repo = require('../infra/repo.js');
const { OpError } = require('../core/util.js');
const actions = require('../v2/actions.js');

// Which reports prove a check again after a fix (verification waits for them).
const PROOF = {
  'REACH-BEYOND-INTENT': ['probe.router'],
  'HST-SSH-PASSWORD': ['host.ssh', 'host.listeners'],
  'APP-QBIT-AUTH-BYPASS': ['host.app_config', 'probe.apps'],
  'CLD-ADMIN-PORT-OPEN': ['host.cloud'],
};

function sensorOf(app, actor) {
  const s = repo.byId(app, 'sensors', actor.id);
  if (!s || s.getString('status') === 'revoked') throw new OpError(403, 'This monitor is not allowed to fix anything.');
  return s;
}

function executorOn(sensor) {
  const caps = repo.jsonOf(sensor, 'capabilities') || {};
  return !!(caps.executor && caps.executor.available);
}

/** An undo a person asked for (step -3), not yet carried out (step -2). */
function undoAsked(r) {
  const log = repo.jsonOf(r, 'steps_log') || [];
  return log.some((e) => e.step === -3) && !log.some((e) => e.step === -2);
}

/** Jobs for this monitor's machine: fixes to apply and fixes to undo. */
function jobsFor(app, sensor) {
  if (!executorOn(sensor)) return [];
  const asset = sensor.getString('asset');
  const jobs = [];
  for (const r of repo.find(app, 'remediations', 'asset = {:a} && (status = "approved" || status = "failed" || status = "done")', { a: asset }, '-updated', 300)) {
    const plan = repo.jsonOf(r, 'plan');
    if (!actions.isTyped(plan)) continue;
    if (r.getString('status') === 'approved' && r.getString('approved_plan_hash') === r.getString('plan_hash')) {
      jobs.push({ id: r.id, kind: 'apply', plan, plan_hash: r.getString('plan_hash') });
    } else if (r.getString('status') === 'done' && undoAsked(r)) {
      // v4 §7: a person asked to undo a change that worked
      const done = (repo.jsonOf(r, 'steps_log') || []).filter((e) => e.outcome === 'ok' && e.step >= 0).map((e) => e.step);
      if (done.length) jobs.push({ id: r.id, kind: 'rollback', plan, done_steps: done });
    } else if (r.getString('status') === 'failed') {
      const done = (repo.jsonOf(r, 'steps_log') || []).filter((e) => e.outcome === 'ok' && e.step >= 0).map((e) => e.step);
      if (done.length && !(repo.jsonOf(r, 'steps_log') || []).some((e) => e.step === -2)) jobs.push({ id: r.id, kind: 'rollback', plan, done_steps: done });
    }
  }
  return jobs.slice(0, 5);
}

/** One op for the monitor's reports: claim | step | complete | fail | rolled_back. */
function report(app, actor, p) {
  const sensor = sensorOf(app, actor);
  const rem = repo.byId(app, 'remediations', String(p.remediation_id || ''));
  if (!rem || rem.getString('asset') !== sensor.getString('asset')) throw new OpError(404, 'No such fix on this server.');
  if (!actions.isTyped(repo.jsonOf(rem, 'plan'))) throw new OpError(409, 'Only NetSentry\'s own fixes are applied by the monitor.');
  const R = require('./remediations.js');
  const who = { type: 'sensor', id: sensor.id, label: `monitor on ${sensor.getString('hostname') || sensor.getString('name')}` };
  switch (p.event) {
    case 'claim':
      return R.claim(app, who, { remediation_id: rem.id, backup_ref: 'the monitor keeps the previous values to undo each step' });
    case 'step':
      return R.reportStep(app, who, { remediation_id: rem.id, step_index: p.step_index, outcome: p.outcome, output_excerpt: p.output });
    case 'complete':
      return R.complete(app, who, { remediation_id: rem.id, executed_plan_hash: p.plan_hash });
    case 'fail':
      return R.fail(app, who, { remediation_id: rem.id, reason: p.reason || 'A step failed on the server.', rolled_back: p.rolled_back === true || p.rolled_back === 'true' });
    case 'rolled_back': {
      const asked = rem.getString('status') === 'done' && undoAsked(rem);
      if (rem.getString('status') !== 'failed' && !asked) throw new OpError(409, 'Only a failed change, or one a person asked to undo, is undone.');
      const log = repo.jsonOf(rem, 'steps_log') || [];
      log.push({ step: -2, outcome: 'ok', output: String(p.output || 'Undone on the server.').slice(0, 1000), at: repo.nowIso(), by: who.label });
      repo.update(app, rem, { steps_log: log });
      require('./audit.js').append(app, who, asked ? 'remediation.undone' : 'remediation.rolled_back', { collection: 'remediations', id: rem.id }, `Undone on the server: "${rem.getString('title')}"`, null);
      rem.set('status', asked ? 'undone' : 'rolled_back');
      app.save(rem);
      return { ok: true, status: asked ? 'undone' : 'rolled_back' };
    }
    default:
      throw new OpError(400, 'event must be claim, step, complete, fail or rolled_back.');
  }
}

/**
 * After a machine's v2 checks ran: settle NetSentry's own fixes that are being verified.
 * Done only when the check passes AND (for an app) it still answers; failing → undo.
 */
function verify(app, assetRec, results) {
  const byFp = {};
  for (const r of results) byFp[`v2|${r.control}|${r.subject_key}`] = r;
  for (const rem of repo.find(app, 'remediations', 'asset = {:a} && status = "verifying"', { a: assetRec.id })) {
    if (!actions.isTyped(repo.jsonOf(rem, 'plan'))) continue;
    const result = byFp[rem.getString('fingerprint')];
    const control = result ? result.control : rem.getString('fingerprint').split('|')[1];
    const completed = repo.isoOf(rem, 'completed_at');
    const needed = PROOF[control] || [];
    const fresh = needed.every((c) => {
      const src = repo.first(app, 'sources', 'target = {:a} && collector = {:c}', { a: assetRec.id, c });
      return src && repo.isoOf(src, 'last_run') > completed;
    });
    if (!fresh) continue; // wait for the reports that prove it
    const system = { type: 'system', label: 'verification' };
    const R = require('./remediations.js');
    const uptime = result && result.app_key ? results.find((x) => x.control === 'UP-APP-DOWN' && x.subject_key === result.subject_key) : null;
    const passes = !result || result.state === 'pass' || result.state === 'not_applicable';
    if (passes && !(uptime && uptime.state === 'fail')) {
      rem.set('status', 'done');
      rem.set('verify_result', { checked: true, rule: control, result: 'passed', at: repo.nowIso() });
      app.save(rem);
      require('./audit.js').append(app, system, 'remediation.verified', { collection: 'remediations', id: rem.id }, `Checked: "${rem.getString('title')}" worked`, null);
    } else {
      const reason = uptime && uptime.state === 'fail' ? 'The app stopped answering after the change — undoing it.' : 'Still failing after the change — undoing it.';
      rem.set('status', 'failed');
      rem.set('failure_reason', reason);
      rem.set('verify_result', { checked: true, rule: control, result: uptime && uptime.state === 'fail' ? 'app down' : 'still detected', at: repo.nowIso() });
      app.save(rem);
      require('./audit.js').append(app, system, 'remediation.verify_failed', { collection: 'remediations', id: rem.id }, `Verification failed: ${reason} "${rem.getString('title')}"`, null);
      try {
        R.alertPeople(app, rem, 'medium', 'Fix did not work — undoing it', reason);
      } catch (_) {
        /* alerts best effort */
      }
    }
  }
}

module.exports = { jobsFor, report, verify, PROOF };
