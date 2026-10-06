/**
 * Workspace service — members, settings, retention, baselines, source
 * controls and the posture overview. Small operations that each touch one thing.
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const findings = require('./findings.js');
const rulesConfig = require('./rulesconfig.js');
const { requireAsset } = require('./assets.js');
const { posture } = require('../core/severity.js');
const { OpError } = require('../core/util.js');

const ROLES = ['admin', 'analyst', 'viewer', 'auditor'];

function settingsRow(app) {
  const s = repo.first(app, 'settings', 'id != ""');
  if (!s) throw new OpError(500, 'Settings row missing — the database was not migrated.');
  return s;
}

function setRole(app, actor, p) {
  const role = String(p.role || '');
  if (ROLES.indexOf(role) < 0) throw new OpError(400, `Role must be one of ${ROLES.join(', ')}.`);
  const u = repo.byId(app, 'users', p.user_id);
  if (!u) throw new OpError(404, 'Member not found.', 'not_found');
  const from = u.getString('role') || 'viewer';
  if (from === role) return { ok: true, user_id: u.id, role };
  if (from === 'admin') {
    const admins = repo.find(app, 'users', 'role = "admin"').length;
    if (admins <= 1) throw new OpError(409, 'This is the only admin. Make someone else admin first.', 'last_admin');
  }
  repo.update(app, u, { role });
  audit.append(app, actor, 'member.role_changed', { collection: 'users', id: u.id }, `${u.getString('email')}: ${from} → ${role}`, { from, to: role });
  return { ok: true, user_id: u.id, role };
}

function updateSettings(app, actor, p) {
  const s = settingsRow(app);
  const fields = {};
  if (p.workspace_name !== undefined && p.workspace_name !== null && p.workspace_name !== '') {
    const name = String(p.workspace_name).trim();
    if (name.length < 1 || name.length > 80) throw new OpError(400, 'Workspace name must be 1–80 characters.');
    fields.workspace_name = name;
  }
  if (p.signup_open !== undefined && p.signup_open !== null && p.signup_open !== '') {
    fields.signup_open = p.signup_open === true || p.signup_open === 'true';
  }
  if (p.retention_days !== undefined && p.retention_days !== null && p.retention_days !== '') {
    const d = Number(p.retention_days);
    if (!(d >= 7 && d <= 3650) || Math.floor(d) !== d) throw new OpError(400, 'Retention must be a whole number of days between 7 and 3650.');
    fields.retention_days = d;
  }
  if (p.digest_hour !== undefined && p.digest_hour !== null && p.digest_hour !== '') {
    const h = Number(p.digest_hour);
    if (!(h >= -1 && h <= 23) || Math.floor(h) !== h) throw new OpError(400, 'Digest hour must be 0–23 (UTC), or -1 to turn the digest off.');
    fields.digest_hour = h;
  }
  if (p.console_url !== undefined && p.console_url !== null && p.console_url !== '') {
    const u = String(p.console_url).trim().replace(/\/+$/, '');
    const m = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:\d{1,5})?$/.exec(u);
    if (!m) throw new OpError(400, 'console_url must look like https://netsentry.example.com');
    const loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(m[2]);
    if (m[1] === 'http' && !loopback) throw new OpError(400, 'Servers only talk to NetSentry over https (plain http only on this server itself).');
    fields.console_url = u;
  }
  if (p.access_review_days !== undefined && p.access_review_days !== null && p.access_review_days !== '') {
    const d = Number(p.access_review_days);
    if (!Number.isInteger(d) || d < 30 || d > 366) throw new OpError(400, 'access_review_days must be 30–366.');
    fields.access_review_days = d;
  }
  for (const flag of ['remediation_paused']) {
    if (p[flag] !== undefined && p[flag] !== null && p[flag] !== '') fields[flag] = p[flag] === true || p[flag] === 'true';
  }
  if (Object.keys(fields).length === 0) throw new OpError(400, 'Nothing to change.');
  const before = {
    workspace_name: s.getString('workspace_name'),
    signup_open: s.getBool('signup_open'),
    retention_days: s.getInt('retention_days'),
    digest_hour: s.getInt('digest_hour'),
    remediation_paused: s.getBool('remediation_paused'),
  };
  repo.update(app, s, fields);
  const said = [];
  if ('workspace_name' in fields && fields.workspace_name !== before.workspace_name) said.push(`renamed workspace to "${fields.workspace_name}"`);
  if ('signup_open' in fields && fields.signup_open !== before.signup_open) said.push(fields.signup_open ? 'opened sign-up' : 'closed sign-up');
  if ('retention_days' in fields && fields.retention_days !== before.retention_days) said.push(`set retention to ${fields.retention_days} days`);
  if ('digest_hour' in fields && fields.digest_hour !== before.digest_hour) {
    said.push(fields.digest_hour < 0 ? 'turned the daily digest off' : `set the daily digest to ${fields.digest_hour}:00 UTC`);
  }
  if ('remediation_paused' in fields && fields.remediation_paused !== before.remediation_paused) {
    said.push(fields.remediation_paused ? 'PAUSED all remediation' : 'resumed remediation');
  }
  const summary = said.length ? said.join('; ').replace(/^./, (c) => c.toUpperCase()) : 'Settings saved (no change)';
  audit.append(app, actor, 'settings.updated', { collection: 'settings', id: s.id }, summary, { before, after: fields });
  return { ok: true, settings: Object.assign(before, fields) };
}

function configureRule(app, actor, p) {
  const { rule, fields } = rulesConfig.configure(app, p);
  // Bring existing findings in line: re-evaluate every asset that has this rule's findings or data.
  const assetIds = {};
  for (const f of repo.find(app, 'findings', 'rule_id = {:r}', { r: rule.id })) assetIds[f.getString('asset')] = true;
  if (fields.enabled === true) {
    for (const a of repo.find(app, 'assets', 'status = "active"')) if (rule.appliesTo.indexOf(a.getString('kind')) >= 0) assetIds[a.id] = true;
  }
  for (const id of Object.keys(assetIds)) {
    const a = repo.byId(app, 'assets', id);
    if (a && a.getString('status') === 'active') findings.reevaluate(app, a, rule.observes);
  }
  audit.append(app, actor, 'rule.configured', { collection: 'rules', id: rule.id }, `${rule.id} configuration changed`, fields);
  return { ok: true, rule_id: rule.id, changed: fields };
}

function acceptBaseline(app, actor, p) {
  const a = requireAsset(app, p.asset_id);
  if (a.getString('kind') !== 'ip') throw new OpError(400, 'Port baselines apply to IP assets.');
  const ports = repo
    .find(app, 'observations', 'asset = {:a} && kind = "port.open" && present = true', { a: a.id })
    .map((o) => Number(o.getString('subject')))
    .sort((x, y) => x - y);
  const now = repo.nowIso();
  const existing = repo.first(app, 'baselines', 'asset = {:a} && kind = "ports"', { a: a.id });
  const before = existing ? repo.jsonOf(existing, 'accepted') : null;
  if (existing) repo.update(app, existing, { accepted: ports, accepted_by: actor.label, at: now });
  else repo.create(app, 'baselines', { asset: a.id, kind: 'ports', accepted: ports, accepted_by: actor.label, at: now });
  const ev = findings.reevaluate(app, a, ['port.open']);
  audit.append(app, actor, 'baseline.accepted', { collection: 'assets', id: a.id }, `Accepted ports [${ports.join(', ')}] on ${a.getString('identifier')}`, { before, after: ports });
  return { ok: true, asset_id: a.id, accepted: ports, findings_resolved: ev.resolved };
}

function acceptListeners(app, actor, p) {
  const a = requireAsset(app, p.asset_id);
  if (a.getString('kind') !== 'host') throw new OpError(400, 'Listener baselines apply to hosts with a sensor.');
  const accepted = repo
    .find(app, 'observations', 'asset = {:a} && kind = "host.listener" && present = true', { a: a.id })
    .filter((o) => (repo.jsonOf(o, 'data') || {}).exposure === 'all')
    .map((o) => o.getString('subject'))
    .sort();
  const now = repo.nowIso();
  const existing = repo.first(app, 'baselines', 'asset = {:a} && kind = "listeners"', { a: a.id });
  if (existing) repo.update(app, existing, { accepted, accepted_by: actor.label, at: now });
  else repo.create(app, 'baselines', { asset: a.id, kind: 'listeners', accepted, accepted_by: actor.label, at: now });
  const ev = findings.reevaluate(app, a, ['host.listener']);
  audit.append(app, actor, 'baseline.accepted', { collection: 'assets', id: a.id }, `Accepted ${accepted.length} listener(s) on ${a.getString('identifier')}`, { accepted });
  return { ok: true, asset_id: a.id, accepted, findings_resolved: ev.resolved };
}

function setSourceEnabled(app, actor, p) {
  const s = repo.byId(app, 'sources', p.source_id);
  if (!s) throw new OpError(404, 'Source not found.', 'not_found');
  const enabled = p.enabled === true || p.enabled === 'true';
  repo.update(app, s, { enabled, next_run: repo.nowIso() });
  audit.append(app, actor, enabled ? 'source.enabled' : 'source.disabled', { collection: 'sources', id: s.id }, `${s.getString('collector')} ${enabled ? 'enabled' : 'disabled'}`, null);
  return { ok: true, source_id: s.id, enabled };
}

function prune(app, actor) {
  const days = settingsRow(app).getInt('retention_days') || 90;
  const changesBefore = repo.pbDate(new Date(Date.now() - days * 86400000).toISOString());
  const runsBefore = repo.pbDate(new Date(Date.now() - 14 * 86400000).toISOString());
  let changes = 0;
  let runs = 0;
  app.runInTransaction((tx) => {
    for (const c of repo.find(tx, 'changes', 'at < {:t}', { t: changesBefore })) {
      tx.delete(c);
      changes++;
    }
    for (const r of repo.find(tx, 'scan_runs', 'started < {:t}', { t: runsBefore })) {
      tx.delete(r);
      runs++;
    }
    for (const s of repo.find(tx, 'signals', 'window_start < {:t}', { t: repo.pbDate(new Date(Date.now() - 7 * 86400000).toISOString()) })) tx.delete(s);
  });
  if (changes || runs || actor.type !== 'system') {
    audit.append(app, actor, 'retention.pruned', null, `Pruned ${changes} change(s) older than ${days} days and ${runs} scan run(s) older than 14 days`, { changes, runs, days });
  }
  return { ok: true, changes_deleted: changes, scan_runs_deleted: runs, retention_days: days };
}

function overview(app) {
  const open = repo.find(app, 'findings', 'status = "open" || status = "acknowledged"').map((f) => ({
    id: f.id,
    severity: f.getString('severity'),
    status: f.getString('status'),
    asset: f.getString('asset'),
    category: f.getString('category'),
    title: f.getString('title'),
    rule_id: f.getString('rule_id'),
  }));
  const p = posture(open);
  const health = { ok: 0, degraded: 0, failing: 0, unknown: 0 };
  const intel = [];
  for (const s of repo.find(app, 'sources', 'enabled = true')) {
    const h = s.getString('health');
    health[h] = (health[h] || 0) + 1;
    if (!s.getString('target')) {
      intel.push({ collector: s.getString('collector'), health: h, last_run: repo.isoOf(s, 'last_run'), last_error: s.getString('last_error') });
    }
  }
  const since = repo.pbDate(new Date(Date.now() - 86400000).toISOString());
  const order = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  return {
    ok: true,
    posture: p,
    open_findings: open.length,
    top: open.sort((a, b) => order[b.severity] - order[a.severity]).slice(0, 5),
    assets: {
      active: repo.find(app, 'assets', 'status = "active"').length,
      retired: repo.find(app, 'assets', 'status = "retired"').length,
    },
    changes_24h: repo.find(app, 'changes', 'at >= {:s}', { s: since }).length,
    source_health: health,
    intel,
  };
}

module.exports = { setRole, updateSettings, configureRule, acceptBaseline, acceptListeners, setSourceEnabled, prune, overview, settingsRow };
