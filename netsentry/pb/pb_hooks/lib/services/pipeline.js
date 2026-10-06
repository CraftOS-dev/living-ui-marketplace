/**
 * Pipeline — runs one source end to end:
 *   collect (network, outside any transaction)
 *   → snapshot diff → changes → discovered assets → intel
 *   → rule evaluation → findings            (one transaction)
 *   → source health + scan_run record.
 * The scheduler tick and manual "scan now" both come through runSource.
 */
const repo = require('../infra/repo.js');
const { createHttp } = require('../infra/http.js');
const collectors = require('../collectors/index.js');
const { diffSnapshot } = require('../core/snapshot.js');
const { nextRunAt, healthFor } = require('../core/schedule.js');
const { createIntel, applyKev, applyEpss, replaceIndicators } = require('./intel.js');
const findings = require('./findings.js');
const assets = require('./assets.js');
const incidents = require('./incidents.js');
const alerts = require('./alerts.js');
const bell = require('./agentbell.js');

const LOCK_MS = 5 * 60 * 1000;

function lock(app, sourceId) {
  const key = 'netsentry-run-' + sourceId;
  const held = app.store().get(key);
  if (held && Date.now() - Number(held) < LOCK_MS) return false;
  app.store().set(key, String(Date.now()));
  return true;
}

function unlock(app, sourceId) {
  app.store().remove('netsentry-run-' + sourceId);
}

function writeObservations(tx, assetRec, sourceId, collector, observations, now, partial) {
  const asset = { id: assetRec.id, kind: assetRec.getString('kind'), ownership: assetRec.getString('ownership') };
  const kinds = collector.kinds(asset);
  const previous = repo.find(tx, 'observations', 'asset = {:a}', { a: asset.id }).map((r) => ({
    rec: r,
    key: r.getString('key'),
    kind: r.getString('kind'),
    subject: r.getString('subject'),
    data: repo.jsonOf(r, 'data'),
    present: r.getBool('present'),
  }));
  const byKey = {};
  for (const p of previous) byKey[p.key] = p.rec;

  const { upserts, changes } = diffSnapshot(previous, observations, kinds, asset.id, { partial });
  for (const u of upserts) {
    if (u.isNew) {
      repo.create(tx, 'observations', {
        asset: asset.id, source: sourceId, kind: u.kind, subject: u.subject, key: u.key,
        data: u.data, present: true, first_seen: now, last_seen: now,
      });
    } else if (u.present) {
      const fields = { last_seen: now, present: true, source: sourceId };
      if (!u.unchanged) fields.data = u.data;
      repo.update(tx, byKey[u.key], fields);
    } else {
      repo.update(tx, byKey[u.key], { present: false });
    }
  }
  for (const c of changes) {
    repo.create(tx, 'changes', {
      asset: asset.id, kind: c.kind, subject: c.subject, change: c.change,
      before: c.before, after: c.after, at: now,
    });
  }
  return { kinds, changes };
}

/**
 * @returns { status: 'ok' | 'error' | 'skipped', observations, changes, opened, resolved, note, error }
 */
function runSource(app, sourceRec, trigger) {
  const collector = collectors.get(sourceRec.getString('collector'));
  const sourceId = sourceRec.id;
  if (!collector) return { status: 'skipped', note: 'unknown collector ' + sourceRec.getString('collector') };
  if (collector.remote) return { status: 'skipped', note: 'reported by its sensor' };

  const assetId = sourceRec.getString('target');
  const assetRec = assetId ? repo.byId(app, 'assets', assetId) : null;
  if (assetId && (!assetRec || assetRec.getString('status') !== 'active')) {
    return { status: 'skipped', note: 'target asset is retired or missing' };
  }
  if (!lock(app, sourceId)) return { status: 'skipped', note: 'already running' };

  const started = Date.now();
  const now = new Date(started).toISOString();
  const targetLabel = assetRec ? assetRec.getString('identifier') : 'global';
  const deps = { http: createHttp(), now, intel: createIntel(app), sensors: require('./sensors.js').lookup(app) };

  try {
    let result;
    try {
      const asset = assetRec
        ? { id: assetRec.id, kind: assetRec.getString('kind'), identifier: assetRec.getString('identifier'), ownership: assetRec.getString('ownership') }
        : null;
      result = collector.collect({ asset }, deps) || {};
    } catch (err) {
      return recordFailure(app, sourceRec, collector, targetLabel, trigger, started, String(err && err.message ? err.message : err));
    }
    return applyResult(app, sourceRec, collector, assetRec, result, trigger, started);
  } finally {
    unlock(app, sourceId);
  }
}

/**
 * Apply one collector result — from a local collect() or a sensor report —
 * to the database in one transaction, then alert/ring after commit.
 * result: { observations?, signals?, partial?, discovered?, baselineIfMissing?, intel?, indicators?, note?, partialError? }
 */
function applyResult(app, sourceRec, collector, assetRec, result, trigger, started) {
  const sourceId = sourceRec.id;
  const now = new Date(started).toISOString();
  const firstRun = sourceRec.getInt('run_count') === 0;
  const targetLabel = assetRec ? assetRec.getString('identifier') : 'global';
  const summary = { observations: 0, changes: 0, opened: 0, resolved: 0 };
  let incidentOutcome = { created: [], joined: [], escalated: [], reopened: [] };
  app.runInTransaction((tx) => {
    const txSource = repo.byId(tx, 'sources', sourceId);
    const txAsset = assetRec ? repo.byId(tx, 'assets', assetRec.id) : null;

    const newSignals = [];
    const metrics = require('./metrics.js');
    if (txAsset && result.signals && result.signals.length) {
      for (const s of result.signals) {
        // Minute numbers (CPU, memory…) are metrics, kept and rolled up on their own (v3 §7.1).
        if (metrics.isMetric(s.kind)) {
          metrics.record(tx, txAsset.id, s);
          summary.observations++;
          continue;
        }
        repo.create(tx, 'signals', {
          asset: txAsset.id, sensor: sourceRec.getString('sensor'), kind: s.kind, key: s.key,
          window_start: s.window_start, count: s.count, data: s.data || {},
        });
        newSignals.push(s);
      }
    }
    if (txAsset && (result.observations || newSignals.length)) {
      const written = result.observations
        ? writeObservations(tx, txAsset, sourceId, collector, result.observations, now, !!result.partial)
        : { kinds: [], changes: [] };
      const changes = written.changes;
      const kinds = written.kinds.concat(newSignals.map((s) => s.kind).filter((k, i, a) => a.indexOf(k) === i));
      summary.observations += (result.observations || []).length + newSignals.length;
      summary.changes = changes.length;
      if (!result.baselineIfMissing && collector.baseline && result.observations) {
        result.baselineIfMissing = collector.baseline(result.observations);
      }

      if (result.baselineIfMissing) {
        const b = result.baselineIfMissing;
        if (!repo.first(tx, 'baselines', 'asset = {:a} && kind = {:k}', { a: txAsset.id, k: b.kind })) {
          repo.create(tx, 'baselines', { asset: txAsset.id, kind: b.kind, accepted: b.accepted, accepted_by: 'first scan', at: now });
        }
      }
      const ev = findings.evaluateAsset(tx, txAsset, kinds, changes, firstRun, now, newSignals);
      summary.opened = ev.opened;
      summary.resolved = ev.resolved;
      incidentOutcome = incidents.afterScan(tx, txAsset, ev.openedRecs, ev.resolvedRecs, now, ev.escalatedRecs);
      // Settle fixes waiting for this re-check (passive sources cannot prove a fix failed).
      require('./remediations.js').verifyAfterScan(tx, txAsset.id, ev.evaluatedRuleIds, !!collector.passive);
      repo.update(tx, txAsset, { last_seen: now });
    }

    if (result.intel && result.intel.kev) applyKev(tx, result.intel.kev, now);
    if (result.intel && result.intel.epss) applyEpss(tx, result.intel.epss, now);
    if (result.indicators) replaceIndicators(tx, result.indicators, now);

    const partial = result.partialError || '';
    repo.update(tx, txSource, {
      consecutive_failures: 0,
      health: partial ? 'degraded' : 'ok',
      last_run: now,
      last_error: partial,
      run_count: txSource.getInt('run_count') + 1,
      next_run: nextRunAt(started, txSource.getInt('schedule_minutes'), 0),
    });
    repo.create(tx, 'scan_runs', {
      source: sourceId, collector: collector.id, target_label: targetLabel, trigger,
      status: 'ok', observations: summary.observations, changes: summary.changes,
      findings_opened: summary.opened, findings_resolved: summary.resolved,
      duration_ms: Date.now() - started, error: partial, note: String(result.note || '').slice(0, 500),
      started: now,
    });
  });
  afterCommit(app, incidentOutcome);
  // v2 checks for machines (apps, reach vs intent, updates, backups, uptime, disks) — after the
  // report is saved and in their own transaction, so a check can never make a report fail.
  if (assetRec && assetRec.getString('kind') === 'host') {
    try {
      require('./accounts.js').afterReport(app, collector.id, assetRec.id, now);
    } catch (err) {
      console.error(`[netsentry] accounts update failed for ${targetLabel}:`, err);
    }
    try {
      require('./v2.js').evaluateAndAlert(app, assetRec.id, now);
    } catch (err) {
      console.error(`[netsentry] v2 checks failed for ${targetLabel}:`, err);
    }
  }
  return Object.assign({ status: 'ok', note: result.note || '', incidents_opened: incidentOutcome.created.length }, summary);
}

/**
 * Network side effects happen only after the scan's transaction committed:
 * alert people directly, then ring the agent and record the request on each
 * incident so its page can show the agent's progress.
 * @param outcome { created, joined, escalated } incident records from incidents.afterScan
 */
function afterCommit(app, outcome) {
  try {
    const ids = (list) => (list || []).map((r) => r.id);
    const fetch = (id) => repo.byId(app, 'incidents', id);
    for (const id of ids(outcome.created)) {
      const inc = fetch(id);
      if (inc) alerts.dispatch(app, alerts.incidentAlert(app, inc, 'created'));
    }
    for (const id of ids(outcome.escalated)) {
      const inc = fetch(id);
      if (inc) alerts.dispatch(app, alerts.incidentAlert(app, inc, 'escalated'));
    }
    for (const id of ids(outcome.reopened)) {
      const inc = fetch(id);
      if (inc) alerts.dispatch(app, alerts.incidentAlert(app, inc, 'reopened'));
    }
    for (const id of ids(outcome.joined)) {
      const inc = fetch(id);
      if (inc && inc.getString('severity') === 'critical' && ids(outcome.escalated).indexOf(id) < 0) {
        alerts.dispatch(app, alerts.incidentAlert(app, inc, 'joined'));
      }
    }
    const all = ids(outcome.created).concat(ids(outcome.joined), ids(outcome.escalated), ids(outcome.reopened));
    if (all.length) {
      const r = bell.ring(app, 'triage_queue_ready', {});
      if (r.ok) for (const id of all) {
        const inc = fetch(id);
        if (inc) repo.update(app, inc, { agent_request: r.id });
      }
    }
  } catch (err) {
    console.error('[netsentry] post-scan alerting failed:', err);
  }
}

function recordFailure(app, sourceRec, collector, targetLabel, trigger, started, message) {
  const failures = sourceRec.getInt('consecutive_failures') + 1;
  const now = new Date(started).toISOString();
  console.error(`[netsentry] ${collector.id} on ${targetLabel} failed: ${message}`);
  repo.update(app, sourceRec, {
    consecutive_failures: failures,
    health: healthFor(failures),
    last_run: now,
    last_error: message.slice(0, 1000),
    next_run: nextRunAt(started, sourceRec.getInt('schedule_minutes'), failures),
  });
  repo.create(app, 'scan_runs', {
    source: sourceRec.id, collector: collector.id, target_label: targetLabel, trigger,
    status: 'error', observations: 0, changes: 0, findings_opened: 0, findings_resolved: 0,
    duration_ms: Date.now() - started, error: message.slice(0, 1000), started: now,
  });
  if (failures === 3) {
    // Crossing into "failing": tell people directly, and ring the agent to diagnose.
    try {
      alerts.dispatch(app, alerts.sourceAlert(app, sourceRec, message));
      bell.ring(app, 'source_unhealthy', { source_id: sourceRec.id });
    } catch (err) {
      console.error('[netsentry] source-failure alerting failed:', err);
    }
  }
  return { status: 'error', error: message };
}

/** Run due sources until the time budget is spent; the rest wait for the next tick. */
function runDue(app, filter, params, trigger, budgetMs) {
  const deadline = Date.now() + budgetMs;
  const due = repo.find(app, 'sources', filter, params, 'next_run', 100);
  let ran = 0;
  let failed = 0;
  let left = 0;
  for (const s of due) {
    if (Date.now() >= deadline) {
      left++;
      continue;
    }
    const r = runSource(app, s, trigger);
    if (r.status === 'ok') ran++;
    if (r.status === 'error') failed++;
  }
  return { ran, failed, queued: left };
}

function tick(app, budgetMs) {
  // Sensor-linked sources are reported by their sensor, never scheduled here.
  return runDue(app, 'enabled = true && sensor = "" && next_run <= {:now}', { now: repo.pbDate(repo.nowIso()) }, 'schedule', budgetMs);
}

/** Scan one asset now: every enabled source runs within the budget; leftovers are due immediately. */
function scanAsset(app, assetId, budgetMs) {
  const now = repo.pbDate(repo.nowIso());
  for (const s of repo.find(app, 'sources', 'target = {:a} && enabled = true && sensor = ""', { a: assetId })) {
    repo.update(app, s, { next_run: now });
  }
  return runDue(app, 'target = {:a} && enabled = true && sensor = ""', { a: assetId }, 'manual', budgetMs);
}

module.exports = { runSource, applyResult, recordFailure, lock, unlock, tick, scanAsset, afterCommit };
