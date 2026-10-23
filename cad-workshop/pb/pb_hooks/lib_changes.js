/// <reference path="../pb_data/types.d.ts" />
/**
 * The change journal: every tree edit is a row with before and after
 * snapshots, grouped in batches (one action of the person, or one run of
 * the AI agent). A batch reverts in one step, as a new batch, so a revert
 * can itself be reverted.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function tree() {
  return require(`${__hooks}/lib_tree.js`);
}

function rowJson(r) {
  const util = u();
  return {
    id: r.id,
    batch: r.getString('batch'),
    actor: r.getString('actor'),
    action: r.getString('action'),
    target: r.getString('target'),
    before: util.getJson(r, 'before'),
    after: util.getJson(r, 'after'),
    note: r.getString('note'),
    reverted_by: r.getString('reverted_by'),
    reverts: r.getString('reverts'),
    created: r.getString('created'),
  };
}

/** Rows grouped by batch, newest batch first. */
function list(app, p) {
  const util = u();
  const where = [];
  const bind = {};
  if (util.str(p, 'part', '') !== '') {
    bind.p = tree().part(app, util.str(p, 'part')).id;
    where.push('[[part]] = {:p}');
  }
  if (util.str(p, 'batch', '') !== '') {
    bind.b = util.str(p, 'batch');
    where.push('[[batch]] = {:b}');
  }
  const actor = util.oneOf(p, 'actor', ['you', 'agent', 'system'], '');
  if (actor !== '') {
    bind.a = actor;
    where.push('[[actor]] = {:a}');
  }
  const limit = util.int(p, 'limit', 30, 1, 200);
  const page = util.int(p, 'page', 1, 1, 100000);
  // Pick the batches first (newest first), then all their rows.
  const batchRows = util.rows(
    app,
    'SELECT [[batch]] AS batch, MAX([[ord]]) AS last FROM {{changes}} ' +
      (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
      'GROUP BY [[batch]] ORDER BY last DESC LIMIT ' +
      (limit + 1) +
      ' OFFSET ' +
      (page - 1) * limit,
    { batch: '', last: 0 },
    bind,
  );
  const more = batchRows.length > limit;
  const batches = [];
  const partNames = {};
  for (const b of batchRows.slice(0, limit)) {
    const rows = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 0, 0, { b: b.batch });
    if (rows.length === 0) continue;
    const first = rows[0];
    const pid = first.getString('part');
    if (partNames[pid] === undefined) {
      const pr = util.byId(app, 'parts', pid);
      partNames[pid] = pr === null ? '' : pr.getString('name');
    }
    batches.push({
      batch: b.batch,
      part: { id: pid, name: partNames[pid] },
      actor: first.getString('actor'),
      note: first.getString('note'),
      created: rows[rows.length - 1].getString('created'),
      count: rows.length,
      reverted_by: first.getString('reverted_by'),
      reverts: first.getString('reverts'),
      kind: batchKind(app, first),
      hash_before: first.getString('hash_before'),
      hash_after: rows[rows.length - 1].getString('hash_after'),
      changes: rows.map(rowJson),
    });
  }
  return { batches: batches, more: more };
}

/** Undo rows (newest first) through ctx.tx; returns the inverse rows to journal. */
function undoRows(ctx, rows) {
  const util = u();
  const tx = ctx.tx;
  const partId = ctx.part.id;
  const inverse = [];
  const ordered = rows.slice().sort((a, b) => b.getInt('ord') - a.getInt('ord'));
  const placeAt = (rec, seq) => {
    const feats = tree()
      .featureRecs(tx, partId)
      .filter((f) => f.id !== rec.id);
    const idx = Math.max(0, Math.min(feats.length, seq - 1));
    feats.splice(idx, 0, rec);
    feats.forEach((f, i) => {
      if (f.getInt('seq') !== i + 1 || f.id === rec.id) {
        f.set('seq', i + 1);
        tx.save(f);
      }
    });
  };
  for (const r of ordered) {
    const action = r.getString('action');
    const before = util.getJson(r, 'before');
    const targetId = r.getString('target_id');
    const target = r.getString('target');
    if (action === 'add_feature') {
      const rec = util.byId(tx, 'features', targetId);
      if (rec !== null) {
        const snap = tree().snapFeature(rec);
        tx.delete(rec);
        inverse.push(['delete_feature', target, targetId, snap, null]);
      }
    } else if (action === 'delete_feature') {
      if (util.byId(tx, 'features', targetId) !== null) continue;
      const rec = new Record(tx.findCollectionByNameOrId('features'));
      rec.set('id', before.id);
      rec.set('part', partId);
      rec.set('name', before.name);
      rec.set('kind', before.kind);
      rec.set('params', before.params);
      rec.set('suppressed', before.suppressed === true);
      rec.set('author', before.author || 'you');
      rec.set('note', before.note || '');
      rec.set('status', 'pending');
      rec.set('seq', before.seq);
      tx.save(rec);
      placeAt(rec, before.seq);
      inverse.push(['add_feature', before.name, before.id, null, tree().snapFeature(rec)]);
    } else if (action === 'update_feature') {
      const rec = util.byId(tx, 'features', targetId);
      if (rec === null) continue;
      const now = tree().snapFeature(rec);
      rec.set('name', before.name);
      rec.set('params', before.params);
      rec.set('suppressed', before.suppressed === true);
      rec.set('note', before.note || '');
      rec.set('status', 'pending');
      tx.save(rec);
      inverse.push(['update_feature', before.name, targetId, now, tree().snapFeature(rec)]);
    } else if (action === 'move_feature') {
      const rec = util.byId(tx, 'features', targetId);
      if (rec === null) continue;
      const from = rec.getInt('seq');
      placeAt(rec, before.seq);
      inverse.push(['move_feature', target, targetId, { seq: from }, { seq: before.seq }]);
    } else if (action === 'set_parameter') {
      const rec = util.byId(tx, 'parameters', targetId);
      if (before === null) {
        if (rec !== null) {
          const snap = tree().snapParam(rec);
          tx.delete(rec);
          inverse.push(['delete_parameter', target, targetId, snap, null]);
        }
      } else if (rec !== null) {
        const now = tree().snapParam(rec);
        rec.set('name', before.name);
        rec.set('kind', before.kind);
        rec.set('expr', before.expr);
        rec.set('bounds', before.bounds);
        rec.set('comment', before.comment || '');
        rec.set('sort', before.sort);
        tx.save(rec);
        inverse.push(['set_parameter', before.name, targetId, now, tree().snapParam(rec)]);
      }
    } else if (action === 'delete_parameter') {
      if (util.byId(tx, 'parameters', targetId) !== null) continue;
      const rec = new Record(tx.findCollectionByNameOrId('parameters'));
      rec.set('id', before.id);
      rec.set('part', partId);
      rec.set('name', before.name);
      rec.set('kind', before.kind);
      rec.set('expr', before.expr);
      rec.set('bounds', before.bounds);
      rec.set('comment', before.comment || '');
      rec.set('sort', before.sort);
      rec.set('author', before.author || 'you');
      tx.save(rec);
      inverse.push(['set_parameter', before.name, before.id, null, tree().snapParam(rec)]);
    } else if (action === 'roll_to') {
      const now = ctx.part.getString('rollback_after');
      ctx.part.set('rollback_after', before.rollback_after);
      inverse.push(['roll_to', target, partId, { rollback_after: now }, { rollback_after: before.rollback_after }]);
    }
  }
  ctx.reload();
  return inverse;
}

/** Later batches (not reverted) that touched what this batch touched. */
function conflicts(app, rows) {
  if (rows.length === 0) return [];
  const partId = rows[0].getString('part');
  const batch = rows[0].getString('batch');
  const last = Math.max.apply(
    null,
    rows.map((r) => r.getInt('ord')),
  );
  const ids = {};
  for (const r of rows) ids[r.getString('target_id')] = true;
  const later = app.findRecordsByFilter('changes', "part = {:p} && ord > {:o} && batch != {:b} && reverted_by = ''", 'ord', 0, 0, { p: partId, o: last, b: batch });
  const out = {};
  for (const r of later) {
    if (ids[r.getString('target_id')] && r.getString('reverts') !== batch) out[r.getString('batch')] = (out[r.getString('batch')] || []).concat([r.getString('target')]);
  }
  return Object.keys(out).map((b) => ({ batch: b, targets: out[b] }));
}

/**
 * The note of a revert batch, named after the original batch: reverting a
 * batch undoes it, reverting that revert redoes it, and so on down the chain.
 */
function revertNote(app, rows) {
  const c = chain(app, rows[0]);
  const n = rows.length;
  const base = c.base.getString('note');
  return (c.hops % 2 === 0 ? 'Revert of ' : 'Redo of ') + n + ' change' + (n === 1 ? '' : 's') + (base ? ': ' + base : '');
}

/**
 * Follow a batch's `reverts` links back to the edit they started from.
 * hops 0: an edit; odd: it undoes that edit; even: it redoes it.
 */
function chain(app, first) {
  let base = first;
  let hops = 0;
  while (base.getString('reverts') !== '') {
    const prev = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 1, 0, { b: base.getString('reverts') });
    if (prev.length === 0) break;
    base = prev[0];
    hops++;
  }
  return { base: base, hops: hops };
}

function batchKind(app, first) {
  const hops = chain(app, first).hops;
  return hops === 0 ? 'edit' : hops % 2 === 1 ? 'undo' : 'redo';
}

/**
 * Revert a batch as a new batch. preview=true answers what it would do.
 * Refused when later changes touched the same features or parameters,
 * unless force=true.
 */
function revert(app, e, p) {
  const util = u();
  const batch = util.req(p, 'batch', '<batch id from changes.list>');
  const rows = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 0, 0, { b: batch });
  if (rows.length === 0) throw util.fail(404, 'No changes in batch ' + batch + '.');
  if (rows[0].getString('reverted_by') !== '') throw util.fail(400, 'Batch ' + batch + ' was already reverted by ' + rows[0].getString('reverted_by') + '. Revert that batch to redo it.');
  const partId = rows[0].getString('part');
  const clash = conflicts(app, rows);
  const preview = util.bool(p, 'preview', false);
  const force = util.bool(p, 'force', false);
  const summary = rows.map((r) => r.getString('action') + ' ' + r.getString('target'));
  if (preview) return { batch: batch, part: partId, would_undo: summary, conflicts: clash, needs_force: clash.length > 0 };
  if (clash.length > 0 && !force) {
    throw util.fail(409, 'Later changes touched the same features or parameters (' + clash.map((c) => c.batch + ': ' + c.targets.join(', ')).join('; ') + '). Revert those first, or pass force=true.', { code: 'conflict', conflicts: clash });
  }
  const actor = util.actor(e);
  const edit = require(`${__hooks}/lib_edit.js`);
  const partRec = app.findRecordById('parts', partId);
  return edit.apply(app, e, p, partRec, (ctx) => {
    const inverse = undoRows(ctx, rows);
    for (const inv of inverse) ctx.record(inv[0], inv[1], inv[2], inv[3], inv[4]);
  }, {
    note: revertNote(app, rows),
    reverts: batch,
    freshBatch: true,
    afterJournal: (tx, result) => {
      for (const r of tx.findRecordsByFilter('changes', 'batch = {:b}', '', 0, 0, { b: batch })) {
        r.set('reverted_by', result.batch);
        tx.save(r);
      }
    },
    actor: actor,
  });
}

/** Undo an op's own changes and drop their rows (a failed agent edit that is reverted). */
function discard(app, partId, changeIds) {
  if (changeIds.length === 0) return;
  const rows = changeIds.map((id) => app.findRecordById('changes', id));
  tree().mutate(app, partId, { actor: 'system', batch: 'discard', noJournal: true, afterJournal: (tx) => {
    for (const id of changeIds) {
      try {
        tx.delete(tx.findRecordById('changes', id));
      } catch {
        /* already gone */
      }
    }
  } }, (ctx) => {
    undoRows(ctx, rows);
  });
}

module.exports = { list: list, revert: revert, discard: discard, undoRows: undoRows, conflicts: conflicts };
