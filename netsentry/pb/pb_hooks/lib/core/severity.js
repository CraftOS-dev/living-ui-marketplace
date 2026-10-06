/**
 * PURE — severity ordering and the explainable posture score.
 */

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const WEIGHTS = { critical: 25, high: 10, medium: 3, low: 1, info: 0 };
const PER_ASSET_CAP = 40;
/** Statuses that still count against posture: the problem is present. */
const COUNTING = { open: true, acknowledged: true };

function rank(severity) {
  const i = SEVERITIES.indexOf(severity);
  return i < 0 ? 0 : i;
}

function maxSeverity(a, b) {
  return rank(a) >= rank(b) ? a : b;
}

/**
 * The severity a finding carries: an admin's override wins; otherwise the
 * check's per-result severity (e.g. RDP high vs SSH medium, KEV → critical);
 * otherwise the rule default.
 */
function effectiveSeverity(ruleDefault, override, draftedSeverity) {
  if (override && SEVERITIES.indexOf(override) >= 0) return override;
  if (draftedSeverity && SEVERITIES.indexOf(draftedSeverity) >= 0) return draftedSeverity;
  return ruleDefault;
}

/**
 * Posture 0–100 = 100 − Σ weights of present problems (per-asset cap), floored at 0.
 * @param findings [{ severity, status, asset, category }]
 */
function posture(findings) {
  const perAsset = {};
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory = {};
  for (const f of findings) {
    if (!COUNTING[f.status]) continue;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    const w = WEIGHTS[f.severity] || 0;
    perAsset[f.asset] = (perAsset[f.asset] || 0) + w;
    const cat = f.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + w;
  }
  let penalty = 0;
  for (const a of Object.keys(perAsset)) penalty += Math.min(PER_ASSET_CAP, perAsset[a]);
  const score = Math.max(0, 100 - penalty);
  return {
    score,
    penalty,
    bySeverity,
    byCategory,
    weights: WEIGHTS,
    perAssetCap: PER_ASSET_CAP,
    grade: score >= 90 ? 'good' : score >= 70 ? 'fair' : score >= 40 ? 'poor' : 'critical',
  };
}

module.exports = { SEVERITIES, WEIGHTS, rank, maxSeverity, effectiveSeverity, posture };
