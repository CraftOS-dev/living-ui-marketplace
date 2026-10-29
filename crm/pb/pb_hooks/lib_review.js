/// <reference path="../pb_data/types.d.ts" />
/**
 * Proposals: changes the AI agent may only propose (see lib_setup policy).
 *
 * A proposal holds what would change (field, from, to), the exact operation
 * to apply (payload), and why: an evidence quote, a source, a reason and a
 * confidence. The person accepts it (as is or edited) or rejects it; an
 * accepted proposal is applied as the person's own change, so undoing it
 * puts the proposal back in the queue. Acceptance rates per kind tell the
 * person when a kind of change could be made automatic.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

const KIND_LABEL = {
  update: 'Field changes',
  deal_value: 'Deal value and dates',
  stage: 'Stage moves',
  close: 'Won, lost and reopened',
  merge: 'Merges',
  delete: 'Deletes',
  email: 'Emails to send',
};

/** The why of an agent call: --evidence "quote" --source "where" --reason ".." --confidence high|medium|low. */
function metaOf(p) {
  const u = U();
  return {
    evidence: u.text(p, 'evidence', '').slice(0, 2000),
    source: u.str(p, 'source', '').slice(0, 500),
    reason: u.text(p, 'reason', '').slice(0, 1000),
    confidence: u.oneOf(p, 'confidence', ['high', 'medium', 'low'], ''),
  };
}

function create(app, who, a) {
  const u = U();
  const meta = a.meta || {};
  // The same proposal again (the agent repeating itself) refreshes the first.
  const dup = app
    .findRecordsByFilter('proposals', "status = 'pending' && target = {:t} && kind = {:k}", '-created', 20, 0, { t: a.target || '', k: a.kind })
    .find((r) => JSON.stringify(u.json(r, 'payload', null)) === JSON.stringify(a.payload));
  const rec = dup || new Record(app.findCollectionByNameOrId('proposals'));
  rec.set('kind', a.kind);
  rec.set('object', a.object || '');
  rec.set('target', a.target || '');
  rec.set('title', String(a.title || '').slice(0, 300));
  rec.set('changes', a.changes || []);
  rec.set('payload', a.payload);
  rec.set('evidence', meta.evidence || '');
  rec.set('source', meta.source || '');
  rec.set('reason', meta.reason || '');
  rec.set('confidence', meta.confidence || '');
  rec.set('status', 'pending');
  rec.set('run', (who && who.run) || '');
  app.save(rec);
  return rec;
}

function targetName(app, object, id) {
  if (!id) return '';
  const c = { people: 'people', companies: 'companies', deals: 'deals', emails: 'emails' }[object];
  if (!c) return '';
  const r = U().byId(app, c, id);
  if (!r) return '';
  if (object === 'emails') return r.getString('subject');
  return require(`${__hooks}/lib_records.js`).nameOf(object, r);
}

function serialize(app, rec) {
  const u = U();
  const object = rec.getString('object');
  const payload = u.json(rec, 'payload', null) || {};
  const out = {
    id: rec.id,
    kind: rec.getString('kind'),
    kind_label: KIND_LABEL[rec.getString('kind')] || rec.getString('kind'),
    object: object,
    target: rec.getString('target'),
    target_name: targetName(app, object, rec.getString('target')),
    title: rec.getString('title'),
    changes: u.json(rec, 'changes', []) || [],
    payload: payload,
    evidence: rec.getString('evidence'),
    source: rec.getString('source'),
    reason: rec.getString('reason'),
    confidence: rec.getString('confidence'),
    status: rec.getString('status'),
    decided_at: rec.getString('decided_at'),
    applied: u.json(rec, 'applied', null),
    run: rec.getString('run'),
    created: rec.getString('created'),
  };
  if (payload.op === 'emails.send' && payload.email) {
    const m = u.byId(app, 'emails', payload.email);
    if (m) out.email = require(`${__hooks}/lib_work.js`).serializeEmail(app, m);
  }
  return out;
}

function list(app, f) {
  const parts = [];
  const prm = {};
  if (f.status) {
    parts.push('status = {:s}');
    prm.s = f.status;
  }
  if (f.target) {
    parts.push('target = {:t}');
    prm.t = f.target;
  }
  if (f.kind) {
    parts.push('kind = {:k}');
    prm.k = f.kind;
  }
  const rows = app.findRecordsByFilter('proposals', parts.join(' && ') || 'id != ""', f.status === 'pending' ? 'created' : '-updated', f.limit || 200, 0, prm);
  return rows.map((r) => serialize(app, r));
}

function pendingCounts(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('proposals', "status = 'pending'", '', 0, 0)) {
    const t = r.getString('target');
    if (t) out[t] = (out[t] || 0) + 1;
  }
  return out;
}

/** Apply a payload as `who` (the person accepting). Returns a short result. */
function applyPayload(app, who, payload) {
  const u = U();
  const recs = require(`${__hooks}/lib_records.js`);
  const deals = require(`${__hooks}/lib_deals.js`);
  const meta = { source: 'proposal' };
  switch (payload.op) {
    case 'records.update': {
      const rec = recs.resolve(app, payload.object, payload.id);
      const r = recs.update(app, who, payload.object, rec, payload.values || {}, meta);
      return { changes: r.changes };
    }
    case 'deals.move': {
      const d = recs.resolve(app, 'deals', payload.deal);
      deals.setStage(app, who, d, deals.stageByRef(app, d, payload.stage), { lost_reason: payload.lost_reason });
      return { deal: d.id, stage: payload.stage };
    }
    case 'deals.close': {
      const d = recs.resolve(app, 'deals', payload.deal);
      deals.setStage(app, who, d, deals.outcomeStage(app, d.getString('pipeline'), payload.outcome), { lost_reason: payload.lost_reason });
      return { deal: d.id, outcome: payload.outcome };
    }
    case 'deals.reopen': {
      const d = recs.resolve(app, 'deals', payload.deal);
      deals.setStage(app, who, d, deals.reopenStage(app, d, payload.stage), {});
      return { deal: d.id };
    }
    case 'records.delete': {
      const rec = recs.resolve(app, payload.object, payload.id);
      recs.softDelete(app, payload.object, rec);
      return { deleted: rec.id };
    }
    case 'records.merge': {
      const a = recs.resolve(app, payload.object, payload.primary);
      const b = recs.resolve(app, payload.object, payload.secondary);
      return recs.merge(app, payload.object, a, b);
    }
    case 'emails.send': {
      const m = u.byId(app, 'emails', payload.email);
      if (!m) throw u.fail(404, 'The email is gone');
      require(`${__hooks}/lib_work.js`).queueEmail(app, m);
      return { email: m.id };
    }
    default:
      throw u.fail(400, 'Unknown proposal operation ' + payload.op);
  }
}

/**
 * Decide a proposal (the person only). edits: for records.update the values
 * to apply instead; for emails.send {subject, body, to}.
 */
function decide(app, who, rec, decision, edits) {
  const u = U();
  if (rec.getString('status') !== 'pending') throw u.fail(409, 'Already decided (' + rec.getString('status') + ')');
  let applied = null;
  let status = decision === 'accept' ? 'accepted' : 'rejected';
  if (decision === 'accept') {
    const payload = u.json(rec, 'payload', null) || {};
    if (edits && Object.keys(edits).length > 0) {
      if (payload.op === 'records.update') {
        const before = JSON.stringify(payload.values);
        payload.values = Object.assign({}, payload.values, edits);
        if (JSON.stringify(payload.values) !== before) status = 'edited';
      } else if (payload.op === 'emails.send') {
        const m = u.byId(app, 'emails', payload.email);
        if (m) {
          let changed = false;
          for (const k of ['to', 'cc', 'subject', 'body']) {
            if (edits[k] !== undefined && String(edits[k]) !== m.getString(k)) {
              m.set(k, String(edits[k]));
              changed = true;
            }
          }
          if (changed) {
            app.save(m);
            status = 'edited';
          }
        }
      } else if (payload.op === 'deals.move' && edits.stage) {
        if (edits.stage !== payload.stage) status = 'edited';
        payload.stage = edits.stage;
      }
    }
    applied = applyPayload(app, who, payload);
  }
  rec.set('status', status);
  rec.set('decided_at', new Date().toISOString());
  rec.set('applied', applied);
  app.save(rec);
  return rec;
}

/** Acceptance per kind over the last 90 days: when a kind is rarely overridden it could be automatic. */
function stats(app) {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().replace('T', ' ');
  const out = {};
  for (const k of Object.keys(KIND_LABEL)) out[k] = { kind: k, label: KIND_LABEL[k], accepted: 0, edited: 0, rejected: 0, pending: 0, rate: null };
  for (const r of app.findRecordsByFilter('proposals', "created >= {:s} || status = 'pending'", '', 0, 0, { s: since })) {
    const k = r.getString('kind');
    if (!out[k]) continue;
    const st = r.getString('status');
    if (out[k][st] !== undefined) out[k][st]++;
  }
  for (const k of Object.keys(out)) {
    const x = out[k];
    const decided = x.accepted + x.edited + x.rejected;
    x.rate = decided > 0 ? Math.round((x.accepted / decided) * 100) : null;
  }
  return Object.keys(out).map((k) => out[k]);
}

module.exports = { KIND_LABEL: KIND_LABEL, metaOf: metaOf, create: create, serialize: serialize, list: list, pendingCounts: pendingCounts, applyPayload: applyPayload, decide: decide, stats: stats };
