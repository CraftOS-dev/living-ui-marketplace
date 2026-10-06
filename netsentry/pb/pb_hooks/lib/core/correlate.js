/**
 * PURE — deterministic correlation of findings into incidents.
 *
 * Only high and critical findings open incidents; medium and below stay in the
 * findings queue and the digest. Findings on the same ROOT asset (a domain and
 * everything discovered from it) within the window join one incident, so
 * "RDP exposed on 3 IPs of example.com" is one incident, not three.
 */
const { rank } = require('./severity.js');

const WINDOW_MINUTES = 60;
const MIN_SEVERITY = 'high';

function correlationKey(rootAssetId) {
  return 'root:' + rootAssetId;
}

/**
 * @param findings   [{ id, severity, root, incident }]  findings opened or reopened this run
 * @param open       [{ id, correlation_key, status, last_activity }]  incidents not closed
 * @param nowIso
 * @returns { joins: [{ findingId, incidentId }], creates: [{ key, root, findingIds, severity }] }
 */
function correlate(findings, open, nowIso, windowMinutes) {
  const windowMs = (windowMinutes || WINDOW_MINUTES) * 60000;
  const now = Date.parse(nowIso);
  const liveByKey = {};
  for (const inc of open) {
    if (inc.status === 'closed' || inc.status === 'false_positive') continue;
    // Mitigated incidents are still "the same story" for the window after their last activity.
    if (now - Date.parse(inc.last_activity) > windowMs && inc.status === 'mitigated') continue;
    const prev = liveByKey[inc.correlation_key];
    if (!prev || Date.parse(inc.last_activity) > Date.parse(prev.last_activity)) liveByKey[inc.correlation_key] = inc;
  }
  const joins = [];
  const creates = {};
  for (const f of findings) {
    if (rank(f.severity) < rank(MIN_SEVERITY)) continue;
    const key = correlationKey(f.root);
    const live = liveByKey[key];
    if (f.incident && live && f.incident === live.id) continue; // already part of it
    if (live && (live.status !== 'mitigated' || now - Date.parse(live.last_activity) <= windowMs)) {
      joins.push({ findingId: f.id, incidentId: live.id });
      continue;
    }
    const c = creates[key] || (creates[key] = { key, root: f.root, findingIds: [], severity: f.severity });
    c.findingIds.push(f.id);
    if (rank(f.severity) > rank(c.severity)) c.severity = f.severity;
  }
  return { joins, creates: Object.keys(creates).map((k) => creates[k]) };
}

module.exports = { correlate, correlationKey, WINDOW_MINUTES, MIN_SEVERITY };
