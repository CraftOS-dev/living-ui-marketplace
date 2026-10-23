/// <reference path="../pb_data/types.d.ts" />
/**
 * Tree edits: parameters and features. Every edit goes through apply(),
 * which journals it, queues the build, waits for it when asked, reverts a
 * failed edit of the AI agent, and answers one envelope:
 *
 *   { ok, status, part, change, build, delta, summary, features, warnings, error, hints }
 *
 * status: applied | failed | queued | reverted | unchanged | dry_run.
 * delta compares the build with the part's previous build.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function tree() {
  return require(`${__hooks}/lib_tree.js`);
}
function builds() {
  return require(`${__hooks}/lib_builds.js`);
}

const HINTS = {
  stale_reference: 'The reference no longer matches the model. error.candidates lists keys it found or that the same features made; model.describe lists every key (or refs.resolve tests a reference).',
  reference_order: 'A feature can only use sketches, features and faces made before it. Move it (features.move) or change the reference.',
  kernel_failed: 'The kernel could not build this. Try a smaller radius or distance, fewer edges, or look at the model with views.render.',
  no_effect: 'The feature does not touch the body. Compare its position with model.properties (bbox) or render views (views.render --highlight).',
  invalid_solid: 'The result is not a valid solid. Change a dimension slightly (walls too thin, or faces exactly tangent).',
  empty_result: 'Nothing would be left. Check the operation (cut vs add) and the size.',
  sketch_invalid: 'Fix the sketch: profiles must be closed and must not cross or touch.',
  param_invalid: 'A parameter of this feature is wrong; features.schema --kind <kind> shows every field.',
  import_failed: 'The file could not be used; check that it is a STEP file with closed solids.',
  engine_unavailable: 'The geometry engine is not running; app.status shows why.',
  engine_crashed: 'The engine stopped on this feature; change its dimensions and try again.',
  timeout: 'The model took too long to build; simplify the last change.',
};

function featureStatuses(app, partId) {
  const out = {};
  for (const f of tree().featureRecs(app, partId)) out[f.getString('name')] = f.getString('status');
  return out;
}

function envelope(app, partId, status, res, build, prevSummary, prevStatuses, extra) {
  const util = u();
  const B = builds();
  const part = app.findRecordById('parts', partId);
  const b = build === null ? null : util.byId(app, 'builds', build.id);
  const desc = b === null ? null : B.describe(app, b);
  const touched = res ? res.touched : [];
  const feats = [];
  const warnings = [];
  if (desc !== null) {
    for (const r of desc.features) {
      if (r.warnings) for (const w of r.warnings) warnings.push(r.name + ': ' + w);
      if (touched.indexOf(r.name) >= 0 || (prevStatuses && prevStatuses[r.name] !== r.status) || r.status === 'error') {
        const f = { name: r.name, status: r.status };
        if (r.error) f.error = r.error;
        if (r.warnings) f.warnings = r.warnings;
        if (r.faces !== undefined) f.faces = r.faces;
        feats.push(f);
      }
    }
  }
  const finished = desc !== null && ['ok', 'warning', 'failed'].indexOf(desc.status) >= 0;
  const error = desc !== null && desc.error ? desc.error : null;
  const out = {
    ok: status !== 'failed' && status !== 'reverted',
    status: status,
    part: { id: part.id, name: part.getString('name'), tree_hash: part.getString('tree_hash'), status: part.getString('status') },
    change: res ? { batch: res.batch, ids: res.changes, created: res.created } : null,
    build:
      desc === null
        ? null
        : { id: desc.id, status: desc.status, ms: desc.ms, cached_features: desc.cached_features, preview: desc.preview, view: desc.files.view },
    delta: finished && desc.summary ? B.delta(prevSummary, desc.summary) : null,
    summary: finished ? desc.summary : null,
    features: feats,
    warnings: warnings,
    error: error,
    hints: [],
  };
  if (error && HINTS[error.code]) out.hints.push(HINTS[error.code]);
  if (status === 'queued') {
    if (require(`${__hooks}/lib_setup.js`).waiting(app)) out.hints.push('The geometry engine is still being set up on this computer (a one-off download); the build runs by itself as soon as it is ready. app.status shows the progress (engine.setup), and builds.get --part ' + part.getString('name') + ' the result.');
    else out.hints.push('The build is still running; builds.get --part ' + part.getString('name') + ' shows the result when it is done.');
  }
  if (status === 'reverted') out.hints.push('The edit was undone because the build failed at ' + (error && error.feature ? error.feature : 'a feature') + '; the part is as it was. Fix the params and try again (on_fail=keep keeps a failed edit).');
  if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
  return out;
}

/**
 * Apply one edit: fn(ctx) uses ctx.addFeature, ctx.updateFeature,
 * ctx.setParam ... (lib_tree mutate). o: { note, reverts, afterJournal, freshBatch, actor }.
 */
function apply(app, e, p, partRec, fn, o) {
  const util = u();
  const T = tree();
  const B = builds();
  const opts = o || {};
  const actor = opts.actor || util.actor(e);
  const s = T.settings(app);
  const waitS = util.number(p, 'wait_s', { min: 0, max: 25 });
  const waitMs = (waitS === null ? (actor === 'agent' ? s.getFloat('agent_wait_s') : 0) : waitS) * 1000;
  const onFail = util.oneOf(p, 'on_fail', ['revert', 'keep'], actor === 'agent' ? 'revert' : 'keep');
  const expected = util.str(p, 'expected_hash', '');
  if (expected !== '' && expected !== partRec.getString('tree_hash')) {
    throw util.fail(409, 'The part changed since tree_hash ' + expected + '; it is now ' + partRec.getString('tree_hash') + '. Read it again with parts.get before editing.', { code: 'conflict', tree_hash: partRec.getString('tree_hash') });
  }
  const prevBuild = util.byId(app, 'builds', partRec.getString('current_build'));
  const prevSummary = prevBuild === null ? null : util.getJson(prevBuild, 'summary');
  const prevStatus = partRec.getString('status');
  const prevStatuses = featureStatuses(app, partRec.id);

  if (util.bool(p, 'dry_run', false)) {
    const res = T.mutate(app, partRec.id, { actor: actor, batch: 'dry-run', dryRun: true }, fn);
    const b = B.preview(app, partRec.id, res.input, actor);
    return envelope(app, partRec.id, 'dry_run', res, b, prevSummary, prevStatuses);
  }

  const batch = opts.freshBatch ? util.newId() : T.batchFor(app, partRec.id, actor, util.str(p, 'batch', ''), util.bool(p, 'new_batch', false));
  const note = opts.note !== undefined ? opts.note : util.str(p, 'note', '');
  const res = T.mutate(app, partRec.id, { actor: actor, batch: batch, note: note, reverts: opts.reverts, afterJournal: opts.afterJournal }, fn);
  if (res.changes.length === 0) {
    const cur = util.byId(app, 'builds', app.findRecordById('parts', partRec.id).getString('current_build'));
    return envelope(app, partRec.id, 'unchanged', res, cur, prevSummary, prevStatuses);
  }
  const build = B.enqueue(app, partRec.id, actor);
  const st = B.kick(app, build, waitMs);
  if (build === null) return envelope(app, partRec.id, 'applied', res, null, prevSummary, prevStatuses);
  if (st === 'failed' && onFail === 'revert') {
    const fb = app.findRecordById('builds', build.id);
    const err = util.getJson(fb, 'error') || {};
    const blame = prevStatus !== 'failed' || (err.feature !== undefined && res.touched.indexOf(err.feature) >= 0);
    if (blame) {
      require(`${__hooks}/lib_changes.js`).discard(app, partRec.id, res.changes);
      const again = B.enqueue(app, partRec.id, 'system');
      B.kick(app, again, waitMs);
      return envelope(app, partRec.id, 'reverted', res, fb, prevSummary, prevStatuses);
    }
  }
  const status = st === null ? 'queued' : st === 'failed' ? 'failed' : st === 'cancelled' ? 'queued' : 'applied';
  return envelope(app, partRec.id, status, res, build, prevSummary, prevStatuses);
}

/* ------------------------------------------------------------ parameters */

function paramsSet(app, e, p) {
  const util = u();
  const partRec = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const name = util.req(p, 'name', 'wall');
  const existing = tree().param(app, partRec.id, name);
  const spec = { name: name };
  if (util.has(p, 'value')) spec.expr = util.str(p, 'value');
  if (existing === null && spec.expr === undefined) throw util.fail(400, 'value is required for a new parameter, e.g. value=3 or value="wall * 2"');
  if (util.has(p, 'kind') && util.str(p, 'kind', '') !== '') spec.kind = util.oneOf(p, 'kind', ['length', 'angle', 'count', 'ratio']);
  const min = util.number(p, 'min');
  const max = util.number(p, 'max');
  if (util.bool(p, 'clear_bounds', false)) spec.bounds = null;
  else if (min !== null || max !== null) {
    const b = existing === null ? {} : util.getJson(existing, 'bounds') || {};
    if (min !== null) b.min = min;
    if (max !== null) b.max = max;
    if (typeof b.min === 'number' && typeof b.max === 'number' && b.min > b.max) throw util.fail(400, 'min must not be above max');
    spec.bounds = b;
  }
  if (util.has(p, 'comment')) spec.comment = util.str(p, 'comment');
  if (util.has(p, 'rename')) spec.rename = util.str(p, 'rename');
  return apply(app, e, p, partRec, (ctx) => {
    ctx.setParam(spec);
  });
}

function paramDelete(app, e, p, rec) {
  const partRec = app.findRecordById('parts', rec.getString('part'));
  return apply(app, e, p, partRec, (ctx) => {
    const r = ctx.params().find((x) => x.id === rec.id);
    if (r === undefined) throw u().fail(404, 'That parameter is already gone');
    ctx.deleteParam(r);
  });
}

/* --------------------------------------------------------------- features */

function featuresAdd(app, e, p) {
  const util = u();
  const partRec = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const kind = util.oneOf(p, 'kind', require(`${__hooks}/lib_kinds.js`).KIND_NAMES, '');
  if (kind === '') throw util.fail(400, 'kind is required: ' + require(`${__hooks}/lib_kinds.js`).KIND_NAMES.join(', '));
  const params = util.obj(p, 'params', '{"sketch": "s1", "extent": {"type": "distance", "distance": 10}}') || {};
  return apply(app, e, p, partRec, (ctx) => {
    ctx.addFeature({
      kind: kind,
      name: util.str(p, 'name', ''),
      params: params,
      after: util.str(p, 'after', ''),
      suppressed: util.bool(p, 'suppressed', false),
      note: util.str(p, 'feature_note', ''),
    });
  });
}

function featuresUpdate(app, e, p) {
  const util = u();
  const partRec = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const rec = tree().feature(app, partRec.id, util.req(p, 'feature', 'ext1'));
  const spec = {};
  const given = util.obj(p, 'params', '{"radius": 4}');
  const unset = util.list(p, 'unset', '["body_name"]') || [];
  if (given !== undefined || unset.length) {
    const merge = util.bool(p, 'merge', true);
    const base = merge ? util.getJson(rec, 'params') || {} : {};
    const next = {};
    for (const k of Object.keys(base)) next[k] = base[k];
    if (given !== undefined) for (const k of Object.keys(given)) next[k] = given[k];
    for (const k of unset) delete next[k];
    spec.params = next;
  }
  if (util.has(p, 'name')) spec.name = util.str(p, 'name');
  if (util.has(p, 'suppressed')) spec.suppressed = util.bool(p, 'suppressed', false);
  if (util.has(p, 'feature_note')) spec.note = util.str(p, 'feature_note');
  if (Object.keys(spec).length === 0) throw util.fail(400, 'Nothing to change: give params, name, suppressed or feature_note');
  return apply(app, e, p, partRec, (ctx) => {
    const r = ctx.features().find((f) => f.id === rec.id);
    ctx.updateFeature(r, spec);
  });
}

function featuresMove(app, e, p) {
  const util = u();
  const partRec = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const rec = tree().feature(app, partRec.id, util.req(p, 'feature', 'fil1'));
  const after = util.req(p, 'after', 'ext2 (or start)');
  return apply(app, e, p, partRec, (ctx) => {
    const r = ctx.features().find((f) => f.id === rec.id);
    ctx.moveFeature(r, after);
  });
}

function featuresRollTo(app, e, p) {
  const util = u();
  const partRec = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const to = util.req(p, 'to', 'ext2 (a feature name), start or end');
  return apply(app, e, p, partRec, (ctx) => {
    ctx.rollTo(to);
  });
}

function featureDelete(app, e, p, rec) {
  const partRec = app.findRecordById('parts', rec.getString('part'));
  return apply(app, e, p, partRec, (ctx) => {
    const r = ctx.features().find((f) => f.id === rec.id);
    if (r === undefined) throw u().fail(404, 'That feature is already gone');
    ctx.deleteFeature(r);
  });
}

/** Several edits as one batch: [{"op": "params.set", ...}, {"op": "features.add", ...}]. */
function batchEdit(app, e, p) {
  const util = u();
  const partRec = tree().part(app, util.req(p, 'part', '<part id or name>'));
  const steps = util.list(p, 'steps', '[{"op": "params.set", "name": "wall", "value": "3"}, {"op": "features.add", "kind": "fillet", "params": {...}}]');
  if (steps === undefined || steps.length === 0) throw util.fail(400, 'steps is required: a JSON list of edits');
  if (steps.length > 100) throw util.fail(400, 'at most 100 steps');
  return apply(app, e, p, partRec, (ctx) => {
    steps.forEach((s, i) => {
      const where = 'steps[' + i + ']';
      if (s === null || typeof s !== 'object') throw util.fail(400, where + ' must be an object with op');
      try {
        if (s.op === 'params.set') {
          const spec = { name: String(s.name || '') };
          if (s.value !== undefined) spec.expr = String(s.value);
          if (s.kind !== undefined) spec.kind = s.kind;
          if (s.comment !== undefined) spec.comment = String(s.comment);
          if (s.min !== undefined || s.max !== undefined) spec.bounds = { min: s.min, max: s.max };
          ctx.setParam(spec);
        } else if (s.op === 'features.add') {
          ctx.addFeature({ kind: s.kind, name: s.name || '', params: s.params || {}, after: s.after || '', suppressed: s.suppressed === true, note: s.feature_note || '' });
        } else if (s.op === 'features.update') {
          const r = ctx.features().find((f) => f.getString('name') === s.feature);
          if (r === undefined) throw util.fail(404, 'no feature ' + s.feature);
          const spec = {};
          if (s.params !== undefined) {
            const next = s.merge === false ? {} : util.getJson(r, 'params') || {};
            for (const k of Object.keys(s.params)) next[k] = s.params[k];
            spec.params = next;
          }
          if (s.name !== undefined) spec.name = s.name;
          if (s.suppressed !== undefined) spec.suppressed = s.suppressed === true;
          ctx.updateFeature(r, spec);
        } else if (s.op === 'features.delete') {
          const r = ctx.features().find((f) => f.getString('name') === s.feature);
          if (r === undefined) throw util.fail(404, 'no feature ' + s.feature);
          ctx.deleteFeature(r);
        } else if (s.op === 'features.move') {
          const r = ctx.features().find((f) => f.getString('name') === s.feature);
          if (r === undefined) throw util.fail(404, 'no feature ' + s.feature);
          ctx.moveFeature(r, s.after);
        } else {
          throw util.fail(400, 'op must be params.set, features.add, features.update, features.delete or features.move');
        }
      } catch (err) {
        throw util.fail(err.status || 400, where + ' (' + s.op + '): ' + err.message, err.extra);
      }
    });
  });
}

module.exports = {
  apply: apply,
  envelope: envelope,
  paramsSet: paramsSet,
  paramDelete: paramDelete,
  featuresAdd: featuresAdd,
  featuresUpdate: featuresUpdate,
  featuresMove: featuresMove,
  featuresRollTo: featuresRollTo,
  featureDelete: featureDelete,
  batchEdit: batchEdit,
  featureStatuses: featureStatuses,
};
