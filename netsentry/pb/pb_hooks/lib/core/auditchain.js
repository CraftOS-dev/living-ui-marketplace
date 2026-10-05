/**
 * PURE — tamper-evident audit chain. Each entry's hash covers its content and
 * the previous entry's hash, so editing or deleting any row breaks every hash
 * after it. The hash function is injected ($security.sha256 in PocketBase,
 * node:crypto in tests).
 */
const { stableStringify } = require('./util.js');

function digestInput(entry) {
  return stableStringify({
    seq: entry.seq,
    actor_type: entry.actor_type,
    actor_label: entry.actor_label || '',
    action: entry.action,
    target_collection: entry.target_collection || '',
    target_id: entry.target_id || '',
    summary: entry.summary || '',
    detail: entry.detail === undefined ? null : entry.detail,
    at: entry.at,
  });
}

function hashEntry(sha256, prevHash, entry) {
  return sha256((prevHash || '') + '|' + digestInput(entry));
}

/**
 * @param rows  entries sorted by seq ascending, each with prev_hash + hash
 * @returns { ok, checked, brokenAt: seq | null, reason }
 */
function verifyChain(rows, sha256) {
  let prev = '';
  let expectedSeq = rows.length ? rows[0].seq : 1;
  for (const r of rows) {
    if (r.seq !== expectedSeq) {
      return { ok: false, checked: rows.length, brokenAt: expectedSeq, reason: `entry ${expectedSeq} is missing` };
    }
    if ((r.prev_hash || '') !== prev) {
      return { ok: false, checked: rows.length, brokenAt: r.seq, reason: 'link to the previous entry does not match' };
    }
    if (hashEntry(sha256, prev, r) !== r.hash) {
      return { ok: false, checked: rows.length, brokenAt: r.seq, reason: 'entry content was modified' };
    }
    prev = r.hash;
    expectedSeq += 1;
  }
  return { ok: true, checked: rows.length, brokenAt: null, reason: '' };
}

module.exports = { hashEntry, verifyChain, digestInput };
