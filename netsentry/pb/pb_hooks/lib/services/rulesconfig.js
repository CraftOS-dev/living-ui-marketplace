/**
 * Rule configuration — the code catalogue is the source of truth for what a
 * check is; the `rules` collection holds what the workspace chose (enabled,
 * severity override, parameter overrides). Synced at boot.
 */
const repo = require('../infra/repo.js');
const registry = require('../rules/index.js');
const { SEVERITIES } = require('../core/severity.js');
const { OpError } = require('../core/util.js');

function sync(app) {
  for (const rule of registry.ALL) {
    const fields = {
      title: rule.title,
      category: rule.category,
      severity_default: rule.severity,
      version: rule.version,
      rationale: rule.rationale,
    };
    const existing = repo.first(app, 'rules', 'rule_id = {:r}', { r: rule.id });
    if (existing) repo.update(app, existing, fields);
    else repo.create(app, 'rules', Object.assign({ rule_id: rule.id, enabled: true }, fields));
  }
  // A rule the code no longer has (v4 removed the outside-watching ones) is not listed or configurable any more.
  const known = {};
  for (const rule of registry.ALL) known[rule.id] = true;
  for (const r of repo.find(app, 'rules', 'id != ""')) if (!known[r.getString('rule_id')]) app.delete(r);
}

/** rule_id → { enabled, severity_override, params (defaults merged with overrides) } */
function load(app) {
  const out = {};
  const stored = {};
  for (const r of repo.find(app, 'rules', 'id != ""')) stored[r.getString('rule_id')] = r;
  for (const rule of registry.ALL) {
    const r = stored[rule.id];
    const overrides = r ? repo.jsonOf(r, 'params') : null;
    out[rule.id] = {
      enabled: r ? r.getBool('enabled') : true,
      severity_override: r ? r.getString('severity_override') : '',
      params: Object.assign({}, rule.params, overrides || {}),
    };
  }
  return out;
}

/**
 * Apply a configuration change. Returns { rule, fingerprintsToResolve, severityChanged }
 * so the caller can bring existing findings in line.
 */
function configure(app, p) {
  const rule = registry.get(String(p.rule_id || ''));
  if (!rule) throw new OpError(404, `No rule "${p.rule_id}".`, 'not_found');
  const rec = repo.first(app, 'rules', 'rule_id = {:r}', { r: rule.id });
  if (!rec) throw new OpError(409, 'Rule catalogue not synced yet — restart the app.', 'not_synced');
  const fields = {};
  if (p.enabled !== undefined && p.enabled !== null && p.enabled !== '') {
    fields.enabled = p.enabled === true || p.enabled === 'true';
  }
  if (p.severity_override !== undefined && p.severity_override !== null) {
    const s = String(p.severity_override);
    if (s !== '' && SEVERITIES.indexOf(s) < 0) throw new OpError(400, `Severity must be one of ${SEVERITIES.join(', ')} (or empty to clear).`);
    fields.severity_override = s;
  }
  if (p.params_json !== undefined && p.params_json !== null && p.params_json !== '') {
    let parsed;
    try {
      parsed = JSON.parse(String(p.params_json));
    } catch (_) {
      throw new OpError(400, 'params_json is not valid JSON.');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new OpError(400, 'params_json must be a JSON object.');
    for (const k of Object.keys(parsed)) {
      if (!(k in rule.params)) throw new OpError(400, `Unknown parameter "${k}" for ${rule.id}. Known: ${Object.keys(rule.params).join(', ') || 'none'}.`);
    }
    fields.params = parsed;
  }
  if (Object.keys(fields).length === 0) throw new OpError(400, 'Nothing to change — pass enabled, severity_override or params_json.');
  repo.update(app, rec, fields);
  return { rule, fields };
}

module.exports = { sync, load, configure };
