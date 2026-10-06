/**
 * Audit service — append to and verify the hash-chained audit log.
 */
const repo = require('../infra/repo.js');
const chain = require('../core/auditchain.js');

function sha256(s) {
  return $security.sha256(s);
}

/**
 * @param target { collection, id } | null
 */
function append(app, actor, action, target, summary, detail) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = repo.first(app, 'audit_log', 'id != ""', {}, '-seq');
    const entry = {
      seq: last ? last.getInt('seq') + 1 : 1,
      actor_type: actor.type,
      actor_label: actor.label || '',
      action,
      target_collection: target ? target.collection : '',
      target_id: target ? target.id : '',
      summary: String(summary || '').slice(0, 500),
      detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail)),
      at: repo.nowIso(),
    };
    const prev = last ? last.getString('hash') : '';
    try {
      return repo.create(app, 'audit_log', Object.assign({}, entry, { prev_hash: prev, hash: chain.hashEntry(sha256, prev, entry) }));
    } catch (err) {
      lastErr = err; // concurrent append took this seq — retry with the new tail
    }
  }
  throw lastErr;
}

function plain(r) {
  return {
    seq: r.getInt('seq'),
    actor_type: r.getString('actor_type'),
    actor_label: r.getString('actor_label'),
    action: r.getString('action'),
    target_collection: r.getString('target_collection'),
    target_id: r.getString('target_id'),
    summary: r.getString('summary'),
    detail: repo.jsonOf(r, 'detail'),
    at: r.getString('at'),
    prev_hash: r.getString('prev_hash'),
    hash: r.getString('hash'),
  };
}

function verify(app) {
  return chain.verifyChain(repo.find(app, 'audit_log', 'id != ""', {}, 'seq').map(plain), sha256);
}

/** The newest entry — a copy of this taken off the box proves nothing before it was changed. */
function head(app) {
  const last = repo.first(app, 'audit_log', 'id != ""', {}, '-seq');
  return last ? { seq: last.getInt('seq'), hash: last.getString('hash'), at: last.getString('at') } : null;
}

/** A page of entries for export, in chain order. */
function exportFrom(app, fromSeq, limit) {
  const from = Math.max(1, Math.floor(Number(fromSeq) || 1));
  const n = Math.min(5000, Math.max(1, Math.floor(Number(limit) || 2000)));
  const rows = repo.find(app, 'audit_log', 'seq >= {:s}', { s: from }, 'seq', n).map(plain);
  const last = rows.length ? rows[rows.length - 1].seq : from - 1;
  const h = head(app);
  return { ok: true, entries: rows, next_seq: h && last < h.seq ? last + 1 : null, head: h };
}

module.exports = { append, verify, head, exportFrom };
