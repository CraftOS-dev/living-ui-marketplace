/**
 * Rule (check) registry — a plain list. Adding a check = one entry in a
 * category file (or a new file listed here).
 *
 * Rule contract:
 *   id, version, title, category, severity, kind: 'state' | 'event',
 *   appliesTo: asset kinds, observes: observation kinds, params (defaults),
 *   rationale, remediation, references,
 *   evaluate(input) → [{ subject, title, evidence, severity? }]
 *
 * input: { asset, obs(kind) → [{subject, data, first_seen}], changes, baseline(kind), intel.get(cve),
 *          signals(kind, minutes), newSignals (signals in this report),
 *          params, firstRun, now }
 */
const ALL = [].concat(require('./host.js'), require('./network.js'), require('./cloud.js'), require('./web.js'));

const BY_ID = {};
for (const r of ALL) BY_ID[r.id] = r;

function get(id) {
  return BY_ID[id] || null;
}

/** Rules to evaluate after a collector refreshed `kinds` on an asset of `assetKind`. */
function affectedBy(assetKind, kinds) {
  return ALL.filter(
    (r) => r.appliesTo.indexOf(assetKind) >= 0 && r.observes.some((k) => kinds.indexOf(k) >= 0),
  );
}

module.exports = { ALL, get, affectedBy };
