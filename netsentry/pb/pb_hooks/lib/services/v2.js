/**
 * v2 engine glue (docs/SYSTEM-V2-PLAN.md): loads one machine's state, runs
 * the pure engine (lib/v2/engine.js) and writes back:
 *   - apps (recognised), evaluations (one row per check × subject),
 *   - findings for failing checks (so today's Issues UI shows them, with the
 *     v1 lifecycle: reopen, mute, auto-resolve),
 *   - the monitor's next instructions (what to probe and read), and
 *   - upstream app intel (latest release + published advisories).
 * Writes happen only when something changed, so realtime stays quiet.
 */
const repo = require('../infra/repo.js');
const { createHttp } = require('../infra/http.js');
const engine = require('../v2/engine.js');
const catalogue = require('../v2/catalogue/index.js');
const controls = require('../v2/controls/index.js');
const upstream = require('../v2/upstream.js');
const { reconcile } = require('../core/lifecycle.js');

const INTEL_EVERY_MS = 12 * 3600 * 1000;
const INTEL_RETRY_MS = 3600 * 1000; // after an error: GitHub allows 60 unauthenticated calls an hour
const SIGNAL_DAYS = 7;

function obsByKind(app, assetId) {
  const by = {};
  for (const r of repo.find(app, 'observations', 'asset = {:a} && present = true', { a: assetId })) {
    const k = r.getString('kind');
    (by[k] = by[k] || []).push({ subject: r.getString('subject'), data: repo.jsonOf(r, 'data') || {} });
  }
  return by;
}

function snapshot(app, assetRec, now) {
  const by = obsByKind(app, assetRec.id);
  const since = repo.pbDate(new Date(Date.parse(now) - SIGNAL_DAYS * 86400000).toISOString());
  const signalsOf = (kind) =>
    repo
      .find(app, 'signals', 'asset = {:a} && kind = {:k} && window_start >= {:s}', { a: assetRec.id, k: kind, s: since }, 'window_start', 5000)
      .map((s) => ({ kind, key: s.getString('key'), window_start: repo.isoOf(s, 'window_start'), data: repo.jsonOf(s, 'data') || {} }));

  const appRecs = repo.find(app, 'apps', 'asset = {:a}', { a: assetRec.id });
  const keyOf = {};
  const appMeta = {};
  for (const a of appRecs) {
    keyOf[a.id] = a.getString('key');
    appMeta[a.getString('key')] = {
      label: a.getString('label'),
      importance: a.getString('importance') || 'normal',
      ignored: a.getString('status') === 'ignored',
      access: !!repo.first(app, 'app_access', 'app = {:a}', { a: a.id }),
    };
  }
  const intents = {};
  for (const i of repo.find(app, 'intents', 'app.asset = {:a}', { a: assetRec.id })) {
    const k = keyOf[i.getString('app')];
    if (k) intents[k] = { reach: i.getString('reach'), source: i.getString('source') };
  }
  const sensorRec =
    repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: assetRec.id }, '-last_seen') ||
    repo.first(app, 'sensors', 'asset = {:a}', { a: assetRec.id }, '-last_seen');
  const sensor = sensorRec
    ? {
        online: sensorRec.getString('status') === 'online',
        last_seen: repo.isoOf(sensorRec, 'last_seen'),
        revoked: sensorRec.getString('status') === 'revoked',
        first_seen: repo.isoOf(sensorRec, 'created'),
        is_admin: sensorRec.getBool('is_admin'),
        version: sensorRec.getString('version'),
        manage_on: !!((repo.jsonOf(sensorRec, 'capabilities') || {}).executor || {}).available,
        capabilities: repo.jsonOf(sensorRec, 'capabilities') || null,
      }
    : null;
  // What each collector last reported, for freshness (lib/v2/freshness.js).
  const collectors = require('../collectors/index.js');
  const sources = repo.find(app, 'sources', 'target = {:a}', { a: assetRec.id }).map((src) => {
    const c = collectors.get(src.getString('collector'));
    return { collector: src.getString('collector'), label: (c && c.title) || src.getString('collector'), interval: c && c.remote ? c.intervalSeconds : 0,
      last_run: repo.isoOf(src, 'last_run'), health: src.getString('health'), error: src.getString('last_error'), enabled: src.getBool('enabled') && !(sensorRec && ((repo.jsonOf(sensorRec, 'capabilities') || {})[src.getString('collector')] || {}).available === false) };
  });
  // NetSentry's own backups are judged per app (v4 walk-verify): one app's copy says nothing about another's.
  const copies = {};
  const failures = {};
  for (const t of repo.find(app, 'backups_taken', 'removed = false', {}, '-taken_at', 2000)) {
    const k = `${t.getString('plan')}|${keyOf[t.getString('app')] || ''}`;
    if (!copies[k]) copies[k] = repo.isoOf(t, 'taken_at');
  }
  for (const r of repo.find(app, 'remediations', 'asset = {:a} && purpose = "backup" && (status = "failed" || status = "rolled_back")', { a: assetRec.id }, '-updated', 500)) {
    const step = ((repo.jsonOf(r, 'plan') || {}).steps || [])[0] || {};
    if (step.action !== 'backup.run') continue;
    const k = `${(step.params || {}).plan_id || ''}|${keyOf[r.getString('app')] || ''}`;
    if (!failures[k]) failures[k] = { at: repo.isoOf(r, 'updated'), why: r.getString('failure_reason').replace(/^Step \d+ failed: /, '').slice(0, 200) };
  }
  const backupPlans = repo.find(app, 'backup_plans', 'asset = {:a}', { a: assetRec.id }).map((p) => {
    const slice = p.getStringSlice('apps') || [];
    const list = [];
    for (let i = 0; i < slice.length; i++) list.push(String(slice[i])); // a Go slice, not a JS array
    return {
      id: p.id,
      name: p.getString('name'),
      method: p.getString('method'),
      schedule_hours: p.getInt('schedule_hours') || 24,
      grace_hours: p.getInt('grace_hours'),
      last_success: repo.isoOf(p, 'last_success'),
      last_failure: repo.isoOf(p, 'last_failure'),
      last_note: p.getString('last_note'),
      last_test: repo.isoOf(p, 'last_test'),
      last_test_result: p.getString('last_test_result'),
      test_every_days: p.getInt('test_every_days') || 30,
      created: repo.isoOf(p, 'created'),
      app_keys: list.map((id) => keyOf[id]).filter(Boolean),
      whole_machine: list.length === 0,
      copyOf: (appKey) => copies[`${p.id}|${appKey}`] || '',
      failureOf: (appKey) => failures[`${p.id}|${appKey}`] || null,
    };
  });
  const intel = {};
  for (const r of repo.find(app, 'app_intel', 'id != ""')) {
    intel[r.getString('app_type')] = {
      latest_version: r.getString('latest_version'),
      latest_published: repo.isoOf(r, 'latest_published'),
      advisories: repo.jsonOf(r, 'advisories') || [],
      advisory_source: r.getString('advisory_source'),
      fetched_at: repo.isoOf(r, 'fetched_at'),
    };
  }
  return {
    asset: { id: assetRec.id, identifier: assetRec.getString('identifier'), label: assetRec.getString('label') },
    now,
    obs: (k) => by[k] || [],
    signals: signalsOf,
    intents,
    appMeta,
    sensor,
    sources,
    backupPlans,
    intel,
    // The last 30 minutes of minute numbers, per subject ('machine' or a container's name).
    metrics: require('./metrics.js').recent(app, assetRec.id, 30, now),
    consoleVersion: require('./enrol.js').sensorVersion(),
  };
}


function changed(rec, fields) {
  for (const k of Object.keys(fields)) {
    const cur = rec.get(k);
    const want = fields[k];
    const a = typeof want === 'object' && want !== null ? JSON.stringify(want) : String(want === undefined || want === null ? '' : want);
    const b = typeof want === 'object' && want !== null ? JSON.stringify(repo.jsonOf(rec, k)) : rec.getString(k);
    if (a !== b && !(cur === undefined && a === '')) return true;
  }
  return false;
}

function syncApps(app, assetRec, apps, now) {
  const recs = {};
  const seen = {};
  for (const a of apps) {
    seen[a.key] = true;
    const fields = {
      app_type: a.app_type,
      asset: assetRec.id,
      display_name: a.name,
      container: a.container,
      compose_project: a.compose_project,
      compose_service: a.compose_service,
      version: a.version,
      endpoints: a.endpoints.map((e) => ({ bind: e.bind, port: e.port, proto: e.proto, via: e.via, reach: a.reach.vantages })),
      recognised_by: a.recognised_by,
      status: 'active',
    };
    let rec = repo.first(app, 'apps', 'key = {:k}', { k: a.key });
    if (rec && rec.getString('status') === 'ignored') fields.status = 'ignored'; // a person's choice sticks
    if (!rec) {
      rec = repo.create(app, 'apps', Object.assign({ key: a.key, importance: 'normal', first_seen: now, last_seen: now }, fields));
      require('./installs.js').adopt(app, rec); // installed by NetSentry: who should reach it is already known
    } else if (changed(rec, fields)) {
      repo.update(app, rec, Object.assign({ last_seen: now }, fields));
    }
    recs[a.key] = rec;
  }
  for (const r of repo.find(app, 'apps', 'asset = {:a} && status = "active"', { a: assetRec.id })) {
    if (!seen[r.getString('key')]) repo.update(app, r, { status: 'gone', last_seen: now });
  }
  return recs;
}

function isSuppressed(app, fp, now) {
  const s = repo.first(app, 'suppressions', 'fingerprint = {:f}', { f: fp });
  if (!s) return false;
  const until = repo.isoOf(s, 'until');
  return !until || until > now;
}

/** The active acceptance of a failing check (a suppression without an end date, or ending later). */
function acceptanceOf(app, fp, now) {
  const s = repo.first(app, 'suppressions', 'fingerprint = {:f}', { f: fp });
  if (!s) return null;
  const until = repo.isoOf(s, 'until');
  if (until && until <= now) return null;
  return { by: s.getString('created_by') || 'someone', until, reason: s.getString('reason') };
}

/** A failing check is an issue in today's Issues UI; passing resolves it; "can't tell" leaves it alone. */
function bridgeFinding(app, assetRec, result, now, appId) {
  const fp = `v2|${result.control}|${result.subject_key}`;
  const ex = repo.first(app, 'findings', 'fingerprint = {:f}', { f: fp });
  if (result.state === 'unknown') return ex;
  const failing = result.state === 'fail';
  const decision = reconcile(ex ? { status: ex.getString('status') } : null, failing, { ruleKind: 'state', suppressed: failing && isSuppressed(app, fp, now) });
  const common = {
    title: result.text.title,
    plain_title: result.text.title,
    severity: result.severity || 'medium',
    evidence: { v2: true, app_id: appId || '', factors: result.factors, evidence: result.evidence, text: result.text },
  };
  if (decision.action === 'create') {
    return repo.create(app, 'findings', Object.assign(common, {
      fingerprint: fp, rule_id: result.control, asset: assetRec.id, subject: result.subject_key.slice(0, 255),
      category: result.outcome, status: decision.status, first_seen: now, last_seen: now, reopen_count: 0,
    }));
  }
  if (decision.action === 'reopen') {
    return repo.update(app, ex, Object.assign(common, {
      status: decision.status, resolved_at: '', last_seen: now, reopen_count: ex.getInt('reopen_count') + 1,
      status_note: 'Reopened: the check fails again.', status_by: 'scheduler',
    }));
  }
  if (decision.action === 'touch') {
    const fields = Object.assign({ status: decision.status }, common);
    if (changed(ex, fields)) repo.update(app, ex, Object.assign(fields, { last_seen: now }));
    return ex;
  }
  if (decision.action === 'resolve') {
    return repo.update(app, ex, { status: 'resolved', resolved_at: now, status_note: 'Resolved automatically: the check passes now.', status_by: 'scheduler' });
  }
  return ex;
}

function upsertEvaluation(app, assetRec, appRecs, result, finding, now) {
  const fp = `${result.control}|${result.subject_key}`;
  const fields = {
    control: result.control,
    control_version: result.control_version,
    outcome: result.outcome,
    subject_type: result.subject_type,
    subject_key: result.subject_key,
    asset: assetRec.id,
    app: result.app_key && appRecs[result.app_key] ? appRecs[result.app_key].id : '',
    state: result.state,
    reason: result.reason.slice(0, 500),
    severity: result.severity,
    factors: result.factors,
    evidence: result.evidence,
    plain_title: String(result.text.title || '').slice(0, 200),
    finding: finding ? finding.id : '',
  };
  const ex = repo.first(app, 'evaluations', 'fingerprint = {:f}', { f: fp });
  if (!ex) {
    return repo.create(app, 'evaluations', Object.assign({ fingerprint: fp, evaluated_at: now, first_failed: result.state === 'fail' ? now : '' }, fields));
  }
  if (!changed(ex, fields)) return ex;
  const wasFail = ex.getString('state') === 'fail';
  const extra = { evaluated_at: now };
  if (result.state === 'fail' && !wasFail) extra.first_failed = now;
  if (result.state !== 'fail') extra.first_failed = '';
  return repo.update(app, ex, Object.assign(extra, fields));
}

/** Tell the machine's monitor what to probe and read next (only when it changed). */
function syncInstructions(app, assetRec, instructions) {
  for (const s of repo.find(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: assetRec.id })) {
    const cfg = repo.jsonOf(s, 'config') || {};
    const next = Object.assign({}, cfg, { probe_targets: instructions.probe_targets, app_config: instructions.app_config });
    if (JSON.stringify(cfg.probe_targets || null) === JSON.stringify(next.probe_targets) && JSON.stringify(cfg.app_config || null) === JSON.stringify(next.app_config)) continue;
    repo.update(app, s, { config: next });
  }
}

/**
 * Evaluate every v2 check for one machine and write the results.
 * @returns { apps, results, failing } counts
 */
function evaluateAsset(app, assetRec, now) {
  if (!assetRec || assetRec.getString('kind') !== 'host' || assetRec.getString('status') !== 'active') return null;
  const at = now || repo.nowIso();
  const out = engine.evaluate(snapshot(app, assetRec, at));
  const appRecs = syncApps(app, assetRec, out.apps, at);
  const keep = {};
  let failing = 0;
  const urgent = [];
  for (const r of out.results) {
    keep[`${r.control}|${r.subject_key}`] = true;
    const finding = bridgeFinding(app, assetRec, r, at, r.app_key && appRecs[r.app_key] ? appRecs[r.app_key].id : '');
    // Accepted risk (P5): a person decided this failing check is fine — who, until when, why.
    const acc = r.state === 'fail' ? acceptanceOf(app, `v2|${r.control}|${r.subject_key}`, at) : null;
    if (acc) {
      r.state = 'accepted';
      r.reason = `Accepted by ${acc.by}${acc.until ? ` until ${acc.until.slice(0, 10)}` : ''}: ${acc.reason}`;
    }
    const ev = upsertEvaluation(app, assetRec, appRecs, r, finding, at);
    if (r.state === 'fail') {
      failing++;
      if (needsPush(ev, r, at)) {
        repo.update(app, ev, { alerted_at: at, alerted_severity: r.severity });
        urgent.push(pushOf(assetRec, r));
      }
    }
  }
  // Subjects that disappeared (an app removed, a disk unplugged): their checks no longer assert anything.
  for (const e of repo.find(app, 'evaluations', 'asset = {:a}', { a: assetRec.id })) {
    if (keep[e.getString('fingerprint')]) continue;
    const f = e.getString('finding') ? repo.byId(app, 'findings', e.getString('finding')) : null;
    if (f && ['open', 'acknowledged'].indexOf(f.getString('status')) >= 0) {
      repo.update(app, f, { status: 'resolved', resolved_at: at, status_note: 'Resolved: what this was about is gone.', status_by: 'scheduler' });
    }
    app.delete(e);
  }
  syncInstructions(app, assetRec, out.instructions);
  require('./fixjobs.js').verify(app, assetRec, out.results);
  return { apps: out.apps.length, results: out.results.length, failing, urgent };
}

const SEV = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const PUSH_AGAIN_MS = 24 * 3600 * 1000;

/** Urgent = critical or high; again only after a day, or at once if it got worse (plan §11). */
function needsPush(ev, r, now) {
  if (SEV[r.severity] < SEV.high) return false;
  const last = repo.isoOf(ev, 'alerted_at');
  if (!last) return true;
  if (SEV[r.severity] > SEV[ev.getString('alerted_severity')] ) return true;
  return Date.parse(now) - Date.parse(last) > PUSH_AGAIN_MS;
}

function pushOf(assetRec, r) {
  const t = r.text || {};
  return {
    app_key: r.app_key || '',
    kind: 'issue',
    severity: r.severity,
    title: t.title,
    text: `${(t.saw && t.saw[0]) || ''} Open NetSentry to see what to do.`.trim(),
    lines: (t.steps || []).slice(0, 3),
    machine: assetRec.getString('label') || assetRec.getString('identifier'),
  };
}

/** Evaluate in a transaction, then push urgent alerts after it committed (network calls never inside a transaction). */
function evaluateAndAlert(app, assetId, now) {
  let result = null;
  app.runInTransaction((tx) => {
    result = evaluateAsset(tx, repo.byId(tx, 'assets', assetId), now || repo.nowIso());
  });
  if (result && result.urgent && result.urgent.length) {
    const alerts = require('./alerts.js');
    for (const a of result.urgent) {
      try {
        alerts.dispatch(app, a);
      } catch (err) {
        console.error('[netsentry] alert failed:', err);
      }
      try {
        tellOwner(app, a);
      } catch (err) {
        console.error('[netsentry] owner alert failed:', err);
      }
    }
  }
  return result;
}

/** v3 §14: an app's owner (an email address on the app) hears about its urgent problems directly. */
function tellOwner(app, a) {
  if (!a.app_key) return;
  const rec = repo.first(app, 'apps', 'key = {:k}', { k: a.app_key });
  const owner = rec ? rec.getString('owner').trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(owner)) return;
  const smtp = app.settings().smtp;
  if (!smtp || !smtp.enabled) return;
  const meta = app.settings().meta;
  const html = `<p><strong>${esc(a.title)}</strong></p><p>${esc(a.text)}</p>${(a.lines || []).map((l) => `<p>• ${esc(l)}</p>`).join('')}<p>You get this because you are the owner of this app in NetSentry.</p>`;
  app.newMailClient().send(new MailerMessage({ from: { address: meta.senderAddress, name: meta.senderName || 'NetSentry' }, to: [{ address: owner }], subject: `[NetSentry] ${a.title}`, html }));
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Minute tick: time-based checks (uptime, backups, monitor silent) move without new reports. */
function tick(app) {
  const now = repo.nowIso();
  for (const a of repo.find(app, 'assets', 'kind = "host" && status = "active"')) {
    try {
      evaluateAndAlert(app, a.id, now);
    } catch (err) {
      console.error(`[netsentry] v2 evaluation failed for ${a.getString('identifier')}:`, err);
    }
  }
}

/** Latest release + advisories for every app type in use, from each app's own upstream (every 12 h). */
function refreshIntel(app, http) {
  const client = http || createHttp();
  const types = {};
  for (const a of repo.find(app, 'apps', 'status = "active"')) types[a.getString('app_type')] = true;
  let fetched = 0;
  for (const type of Object.keys(types)) {
    const entry = catalogue.get(type);
    const u = entry ? upstream.urls(entry) : null;
    if (!u) continue;
    let rec = repo.first(app, 'app_intel', 'app_type = {:t}', { t: type });
    const last = rec ? Date.parse(repo.isoOf(rec, 'fetched_at') || 0) : 0;
    if (rec && Date.now() - last < (rec.getString('error') ? INTEL_RETRY_MS : INTEL_EVERY_MS)) continue;
    try {
      const rel = client.getJson(u.release, { headers: { accept: 'application/vnd.github+json' } });
      const adv = client.getJson(u.advisories, { headers: { accept: 'application/vnd.github+json' } });
      if (rel.status !== 200 || adv.status !== 200) throw new Error(`GitHub answered ${rel.status}/${adv.status}`);
      const intel = upstream.intelFromGithub(entry, rel.json, adv.json);
      const fields = Object.assign(intel, { app_type: type, fetched_at: repo.nowIso(), error: '' });
      rec = rec ? repo.update(app, rec, fields) : repo.create(app, 'app_intel', fields);
      fetched++;
    } catch (err) {
      const fields = { app_type: type, error: String(err && err.message ? err.message : err).slice(0, 500), fetched_at: repo.nowIso() };
      if (rec) repo.update(app, rec, fields);
      else repo.create(app, 'app_intel', fields);
    }
  }
  return fetched;
}

/** v1 rules a v2 check replaces (plan §28): they stop asserting on machines the v2 engine covers. */
const SUPERSEDED = {
  'HOST-003': 'HST-SSH-PASSWORD', 'DEV-002': 'HST-FIREWALL-OFF', 'HOST-007': 'UPD-OS-SECURITY', 'RES-002': 'NS-MONITOR-SILENT',
  // P4: the cloud checks moved to v2 (provider network reachability, typed fix, dry-run scope check)
  'CLD-001': 'CLD-ADMIN-PORT-OPEN', 'CLD-005': 'CLD-VOLUME-UNENCRYPTED', 'CLD-006': 'CLD-IMDS-V1',
};

module.exports = { evaluateAsset, evaluateAndAlert, tick, refreshIntel, snapshot, SUPERSEDED, controls };
