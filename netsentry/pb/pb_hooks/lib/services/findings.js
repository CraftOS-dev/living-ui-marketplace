/**
 * Findings service — turns rule results into findings (the automatic
 * lifecycle) and applies manual transitions (acknowledge / resolve / suppress).
 */
const plain = require('../rules/plain.js');
const repo = require('../infra/repo.js');
const rules = require('../rules/index.js');
const rulesConfig = require('./rulesconfig.js');
const { createIntel } = require('./intel.js');
const audit = require('./audit.js');
const { findingFingerprint } = require('../core/snapshot.js');
const { reconcile, manualTransition } = require('../core/lifecycle.js');
const { effectiveSeverity, rank } = require('../core/severity.js');
const { OpError } = require('../core/util.js');

function plainAsset(rec) {
  return { id: rec.id, kind: rec.getString('kind'), identifier: rec.getString('identifier'), label: rec.getString('label') };
}

function isSuppressed(app, fingerprint, now) {
  const s = repo.first(app, 'suppressions', 'fingerprint = {:f}', { f: fingerprint });
  if (!s) return false;
  const until = repo.isoOf(s, 'until');
  return !until || until > now;
}

/**
 * Evaluate every enabled rule that watches `kinds` on this asset and reconcile findings.
 * @returns { opened, resolved }
 */
function evaluateAsset(app, assetRec, kinds, changes, firstRun, now, newSignals) {
  const asset = plainAsset(assetRec);
  let appNames = null; // container → app name, read once when a title is made
  let appIds = null; // container → app record id, so a problem about a container shows on its app
  const affected = rules.affectedBy(asset.kind, kinds);
  if (affected.length === 0) return { opened: 0, resolved: 0, openedRecs: [], resolvedRecs: [], escalatedRecs: [], evaluatedRuleIds: [] };

  const byKind = {};
  for (const r of repo.find(app, 'observations', 'asset = {:a} && present = true', { a: asset.id })) {
    const k = r.getString('kind');
    (byKind[k] = byKind[k] || []).push({ subject: r.getString('subject'), data: repo.jsonOf(r, 'data') || {}, first_seen: repo.isoOf(r, 'first_seen') });
  }
  const baselines = {};
  for (const b of repo.find(app, 'baselines', 'asset = {:a}', { a: asset.id })) baselines[b.getString('kind')] = repo.jsonOf(b, 'accepted');
  const config = rulesConfig.load(app);
  const intel = createIntel(app);
  const signalsOf = (kind, minutes) =>
    repo
      .find(app, 'signals', 'asset = {:a} && kind = {:k} && window_start >= {:s}', {
        a: asset.id,
        k: kind,
        s: repo.pbDate(new Date(Date.parse(now) - minutes * 60000).toISOString()),
      }, '-window_start', 2000)
      .map((s) => ({ kind, key: s.getString('key'), count: s.getInt('count'), window_start: repo.isoOf(s, 'window_start'), data: repo.jsonOf(s, 'data') || {} }));

  let opened = 0;
  let resolved = 0;
  const openedRecs = [];
  const resolvedRecs = [];
  const escalatedRecs = [];
  // v1 rules a v2 check replaced step aside on machines (services/v2.js SUPERSEDED).
  const superseded = asset.kind === 'host' ? require('./v2.js').SUPERSEDED : {};
  for (const rule of affected) {
    const cfg = superseded[rule.id] ? Object.assign({}, config[rule.id], { enabled: false, replacedBy: superseded[rule.id] }) : config[rule.id];
    const existing = {};
    for (const f of repo.find(app, 'findings', 'rule_id = {:r} && asset = {:a}', { r: rule.id, a: asset.id })) {
      existing[f.getString('fingerprint')] = f;
    }

    let results = [];
    if (cfg.enabled) {
      try {
        results = rule.evaluate({
          asset,
          obs: (kind) => byKind[kind] || [],
          changes,
          baseline: (kind) => (kind in baselines ? baselines[kind] : null),
          intel,
          signals: signalsOf,
          newSignals: newSignals || [],
          params: cfg.params,
          firstRun,
          now,
        });
      } catch (err) {
        console.error(`[netsentry] rule ${rule.id} failed on ${asset.identifier}:`, err);
        continue; // a broken rule must not resolve findings it could not evaluate
      }
    }

    // Activity rules: results go to the Activity inbox; their old issues move there too
    // (issues a person raised with "looks wrong" — det|… — stay).
    if (rule.detection) {
      const detections = require('./detections.js');
      for (const res of results) detections.record(app, assetRec, rule, res, now);
      for (const fp of Object.keys(existing)) {
        const ex = existing[fp];
        if (fp.indexOf('det|') === 0 || ['open', 'acknowledged'].indexOf(ex.getString('status')) < 0) continue;
        repo.update(app, ex, { status: 'resolved', resolved_at: now, status_note: 'Moved to Activity: it is something that happened, to review there.', status_by: 'scheduler' });
        resolvedRecs.push(ex);
        resolved++;
      }
      continue;
    }

    const failing = {};
    // Titles name the app a container runs ("Jellyfin"), not Docker's name for it ("joe-jellyfin-1").
    if (!appNames) {
      appNames = {};
      appIds = {};
      for (const a of repo.find(app, 'apps', 'asset = {:a} && status = "active"', { a: asset.id })) {
        if (!a.getString('container')) continue;
        appNames[a.getString('container')] = a.getString('label') || a.getString('display_name');
        appIds[a.getString('container')] = a.id;
      }
    }
    for (const res of results) {
      const fp = findingFingerprint(rule.id, asset.id, res.subject);
      if (failing[fp]) continue;
      failing[fp] = true;
      const ex = existing[fp] || null;
      const decision = reconcile(ex ? { status: ex.getString('status') } : null, true, {
        ruleKind: rule.kind,
        suppressed: isSuppressed(app, fp, now),
      });
      const common = {
        title: res.title,
        plain_title: plain.titleFor(rule.id, { subject: res.subject || '', evidence: res.evidence || {}, on: asset.label || asset.identifier, apps: appNames }) || res.title,
        severity: effectiveSeverity(rule.severity, cfg.severity_override, res.severity),
        evidence: withApp(res.evidence || {}, appIds),
        last_seen: now,
      };
      if (decision.action === 'create') {
        openedRecs.push(repo.create(app, 'findings', Object.assign(common, {
          fingerprint: fp,
          rule_id: rule.id,
          asset: asset.id,
          subject: res.subject || '',
          category: rule.category,
          status: decision.status,
          first_seen: now,
          reopen_count: 0,
        })));
        opened++;
      } else if (decision.action === 'reopen') {
        repo.update(app, ex, Object.assign(common, {
          status: decision.status,
          resolved_at: '',
          reopen_count: ex.getInt('reopen_count') + 1,
          status_note: 'Reopened: detected again by a scan.',
          status_by: 'scheduler',
        }));
        openedRecs.push(ex);
        opened++;
      } else if (decision.action === 'touch') {
        const before = ex.getString('severity');
        repo.update(app, ex, Object.assign(common, { status: decision.status }));
        // Escalated into incident territory (override, KEV listing): treat like newly opened.
        if (!ex.getString('incident') && rank(common.severity) >= rank('high') && rank(before) < rank('high') && decision.status !== 'suppressed') {
          openedRecs.push(ex);
        }
        // Every scan re-checks the incident of a still-present finding: severity follows
        // it up or down, and a mitigated incident whose problem is back reopens (self-healing).
        if (ex.getString('incident')) escalatedRecs.push(ex);
      }
    }

    for (const fp of Object.keys(existing)) {
      if (failing[fp]) continue;
      const ex = existing[fp];
      // A disabled rule stops asserting anything: close its open findings.
      const decision = cfg.enabled
        ? reconcile({ status: ex.getString('status') }, false, { ruleKind: rule.kind, suppressed: false })
        : ex.getString('status') === 'resolved'
          ? { action: 'none' }
          : { action: 'resolve' };
      if (decision.action === 'resolve') {
        repo.update(app, ex, {
          status: 'resolved',
          resolved_at: now,
          status_note: cfg.enabled ? 'Resolved automatically: no longer observed.' : cfg.replacedBy ? `Replaced by the newer check ${cfg.replacedBy}.` : 'Resolved: the rule was disabled.',
          status_by: 'scheduler',
        });
        resolvedRecs.push(ex);
        resolved++;
      }
    }
  }
  return { opened, resolved, openedRecs, resolvedRecs, escalatedRecs, evaluatedRuleIds: affected.filter((r) => config[r.id].enabled && !superseded[r.id]).map((r) => r.id) };
}

/** Re-evaluate an asset's rules for kinds without collecting (after a baseline or rule change). */
function reevaluate(app, assetRec, kinds) {
  const now = repo.nowIso();
  const ev = evaluateAsset(app, assetRec, kinds, [], false, now);
  const inc = require('./incidents.js').afterScan(app, assetRec, ev.openedRecs, ev.resolvedRecs, now, ev.escalatedRecs);
  require('./remediations.js').verifyAfterScan(app, assetRec.id, ev.evaluatedRuleIds, false);
  require('./pipeline.js').afterCommit(app, inc);
  return ev;
}

/** Findings leaving the "present" state may complete (mitigate) their incident. */
function refreshIncidents(app, findingRecs) {
  const seen = {};
  const outcome = { created: [], joined: [], escalated: [], reopened: [] };
  for (const f of findingRecs) {
    const id = f.getString('incident');
    if (id && !seen[id]) {
      seen[id] = true;
      const r = require('./incidents.js').refresh(app, id);
      if (r.reopened) outcome.reopened.push(r.inc);
    }
  }
  if (outcome.reopened.length) require('./pipeline.js').afterCommit(app, outcome);
}

function requireFinding(app, id) {
  const f = repo.byId(app, 'findings', id);
  if (!f) throw new OpError(404, 'Finding not found.', 'not_found');
  return f;
}

function transition(app, actor, action, p) {
  const f = requireFinding(app, p.finding_id);
  const from = f.getString('status');
  const t = manualTransition(from, action);
  if (t.error) throw new OpError(409, t.error, 'invalid_transition');
  const note = String(p.note || p.reason || '').trim();
  if (action === 'resolve' && !note) throw new OpError(400, 'Add a note saying how it was resolved.');
  if (action === 'suppress' && !note) throw new OpError(400, 'A reason is required to suppress a finding.');

  const fp = f.getString('fingerprint');
  let until = '';
  if (action === 'suppress') {
    if (p.until && Date.parse(String(p.until)) - Date.now() > 366 * 86400000) throw new OpError(400, 'Accept a risk for at most a year, then look at it again.');
    if (p.until) {
      const t2 = Date.parse(String(p.until));
      if (isNaN(t2)) throw new OpError(400, '"until" must be a date (YYYY-MM-DD).');
      if (t2 <= Date.now()) throw new OpError(400, '"until" must be in the future.');
      until = new Date(t2).toISOString();
    }
    const existing = repo.first(app, 'suppressions', 'fingerprint = {:f}', { f: fp });
    const fields = { fingerprint: fp, reason: note, until, created_by: actor.label };
    if (existing) repo.update(app, existing, fields);
    else repo.create(app, 'suppressions', fields);
  }
  if (action === 'unsuppress') {
    const s = repo.first(app, 'suppressions', 'fingerprint = {:f}', { f: fp });
    if (s) app.delete(s);
  }

  repo.update(app, f, {
    status: t.status,
    status_note: note,
    status_by: actor.label,
    resolved_at: t.status === 'resolved' ? repo.nowIso() : '',
  });
  refreshIncidents(app, [f]);
  const WORD = { open: 'needs attention', acknowledged: 'being handled', suppressed: 'muted', resolved: 'fixed' };
  audit.append(app, actor, 'finding.' + action, { collection: 'findings', id: f.id },
    `Issue "${f.getString('title')}": ${WORD[from] || from} → ${WORD[t.status] || t.status}`,
    { note, until: until || null });
  return { ok: true, finding_id: f.id, status: t.status };
}

/** container → the app's name, so plain words say "Jellyfin", not "joe-jellyfin-1". */
function containerNames(app) {
  const out = {};
  for (const a of repo.find(app, 'apps', 'status = "active" && container != ""')) out[a.getString('container')] = a.getString('label') || a.getString('display_name');
  return out;
}

/** Evidence naming a container gets that app's id (app_id), unless the check already set one. */
function withApp(evidence, appIds) {
  const c = evidence && evidence.container;
  if (!c || evidence.app_id || !appIds || !appIds[c]) return evidence;
  return Object.assign({}, evidence, { app_id: appIds[c] });
}

function explain(app, p) {
  const f = requireFinding(app, p.finding_id);
  const rule = rules.get(f.getString('rule_id'));
  const asset = repo.byId(app, 'assets', f.getString('asset'));
  const s = repo.first(app, 'suppressions', 'fingerprint = {:f}', { f: f.getString('fingerprint') });
  return {
    ok: true,
    suppression: s ? { reason: s.getString('reason'), until: repo.isoOf(s, 'until'), created_by: s.getString('created_by') } : null,
    finding: {
      id: f.id,
      rule_id: f.getString('rule_id'),
      title: f.getString('title'),
      plain_title: f.getString('plain_title') || f.getString('title'),
      severity: f.getString('severity'),
      status: f.getString('status'),
      subject: f.getString('subject'),
      first_seen: repo.isoOf(f, 'first_seen'),
      last_seen: repo.isoOf(f, 'last_seen'),
      status_note: f.getString('status_note'),
      evidence: repo.jsonOf(f, 'evidence'),
    },
    asset: asset ? { id: asset.id, kind: asset.getString('kind'), identifier: asset.getString('identifier'), label: asset.getString('label') } : null,
    rule: rule
      ? { id: rule.id, title: rule.title, category: rule.category, rationale: rule.rationale, remediation: rule.remediation, references: rule.references, ask_expected: !!rule.askExpected, plain: plain.explain(rule.id, { subject: f.getString('subject'), evidence: repo.jsonOf(f, 'evidence') || {}, on: asset ? asset.getString('label') || asset.getString('identifier') : '', apps: containerNames(app) }) }
      : v2Rule(f),
  };
}

/** A v2 check's issue explains itself with the text it was rendered with (docs/SYSTEM-V2-PLAN.md §22). */
function v2Rule(f) {
  const control = require('../v2/controls/index.js').get(f.getString('rule_id'));
  const ev = repo.jsonOf(f, 'evidence') || {};
  const t = ev.text || {};
  if (!control) return null;
  const steps = t.steps || [];
  return {
    id: control.id,
    title: control.title,
    category: control.outcome,
    rationale: t.means || '',
    remediation: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    references: control.references || [],
    ask_expected: false,
    v2: true,
    plain: { means: t.means || '', steps, saw: t.saw || [], verify: t.verify || '', factors: ev.factors || [] },
  };
}

/** Issues created before plain titles existed get one (boot, idempotent). */
function backfillPlainTitles(app) {
  const names = {};
  for (const a of repo.find(app, 'assets', 'id != ""')) names[a.id] = a.getString('label') || a.getString('identifier');
  let n = 0;
  for (const f of repo.find(app, 'findings', 'plain_title = ""')) {
    const t = plain.titleFor(f.getString('rule_id'), { subject: f.getString('subject'), evidence: repo.jsonOf(f, 'evidence') || {}, on: names[f.getString('asset')] || '' });
    repo.update(app, f, { plain_title: t || f.getString('title') });
    n++;
  }
  // after the issues, so a fix copies its issue's plain title
  for (const r of repo.find(app, 'remediations', 'plain_title = ""')) {
    const f = repo.byId(app, 'findings', r.getString('finding'));
    repo.update(app, r, { plain_title: `Fix: ${f ? f.getString('plain_title') || f.getString('title') : r.getString('title')}`.slice(0, 300) });
    n++;
  }
  return n;
}

module.exports = { evaluateAsset, reevaluate, refreshIncidents, transition, explain, backfillPlainTitles };
