/**
 * PURE — observation keys and snapshot diffing (the "state path").
 *
 * A collector returns the COMPLETE current set of observations for the kinds
 * it covers on one asset. Anything previously present in those kinds and now
 * missing is "removed"; anything new is "added"; same key with different data
 * is "modified". Kinds the collector does not cover are never touched.
 *
 * A PARTIAL snapshot (a fallback source that sees only part of the data) can
 * only add: it never removes or modifies what a complete snapshot recorded,
 * because absence or a different value there means "not seen", not "changed".
 */
const { sameJson } = require('./util.js');

function observationKey(assetId, kind, subject) {
  return assetId + '|' + kind + '|' + subject;
}

function findingFingerprint(ruleId, assetId, subject) {
  return ruleId + '|' + assetId + '|' + (subject || '');
}

/**
 * @param previous  [{ key, kind, subject, data, present }]  existing rows for this asset
 * @param current   [{ kind, subject, data }]                  what the collector saw now
 * @param kinds     string[]                                   kinds the collector covers
 * @param assetId   string
 * @param opts      { partial?: boolean }
 * @returns { upserts: [{key, kind, subject, data, present, isNew}], changes: [{kind, subject, change, before, after}] }
 */
function diffSnapshot(previous, current, kinds, assetId, opts) {
  const partial = !!(opts && opts.partial);
  const covered = {};
  for (const k of kinds) covered[k] = true;

  const prevByKey = {};
  for (const p of previous) if (covered[p.kind]) prevByKey[p.key] = p;

  const upserts = [];
  const changes = [];
  const seen = {};

  for (const c of current) {
    const key = observationKey(assetId, c.kind, c.subject);
    if (seen[key]) continue; // collector duplicates: first wins
    seen[key] = true;
    const prev = prevByKey[key];
    if (!prev) {
      upserts.push({ key, kind: c.kind, subject: c.subject, data: c.data, present: true, isNew: true });
      changes.push({ kind: c.kind, subject: c.subject, change: 'added', before: null, after: c.data });
    } else if (!prev.present) {
      upserts.push({ key, kind: c.kind, subject: c.subject, data: c.data, present: true, isNew: false });
      changes.push({ kind: c.kind, subject: c.subject, change: 'added', before: null, after: c.data });
    } else if (partial) {
      upserts.push({ key, kind: c.kind, subject: c.subject, data: prev.data, present: true, isNew: false, unchanged: true });
    } else if (!sameJson(prev.data, c.data)) {
      upserts.push({ key, kind: c.kind, subject: c.subject, data: c.data, present: true, isNew: false });
      changes.push({ kind: c.kind, subject: c.subject, change: 'modified', before: prev.data, after: c.data });
    } else {
      upserts.push({ key, kind: c.kind, subject: c.subject, data: c.data, present: true, isNew: false, unchanged: true });
    }
  }

  for (const key of Object.keys(prevByKey)) {
    if (partial) break;
    const prev = prevByKey[key];
    if (seen[key] || !prev.present) continue;
    upserts.push({ key, kind: prev.kind, subject: prev.subject, data: prev.data, present: false, isNew: false });
    changes.push({ kind: prev.kind, subject: prev.subject, change: 'removed', before: prev.data, after: null });
  }

  return { upserts, changes };
}

module.exports = { observationKey, findingFingerprint, diffSnapshot };
