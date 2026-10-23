/// <reference path="../pb_data/types.d.ts" />
/**
 * The feature tree: loading it, resolving parameter expressions, hashing
 * what a build depends on, and the one transactional helper every edit goes
 * through (mutate). Every edit is journaled as a `changes` row in a batch
 * with before and after snapshots, so a batch reverts in one step.
 *
 * Inside mutate only the transaction handle is used (another app handle
 * inside a transaction deadlocks the process).
 */

/** Must match the engine's ENGINE_VERSION: a new engine rebuilds everything. */
const ENGINE_ID = 'cad-engine-1';

const PREFIX = {
  sketch: 's',
  extrude: 'ext',
  revolve: 'rev',
  hole: 'hole',
  fillet: 'fil',
  chamfer: 'cha',
  shell: 'shell',
  pattern_linear: 'lpat',
  pattern_circular: 'cpat',
  mirror: 'mir',
  boolean: 'comb',
  transform: 'move',
  import_step: 'imp',
  push_pull: 'pp',
};
const SHAPE_PREFIX = { box: 'box', cylinder: 'cyl', sphere: 'sph', cone: 'cone', torus: 'tor' };
const IDENT = /^[a-z][a-z0-9_]{0,31}$/;

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/* ----------------------------------------------------------------- reads */

/** A part by id or exact name (case-insensitive). */
function part(app, ref) {
  const util = u();
  const v = String(ref || '').trim();
  if (v === '') throw util.fail(400, 'part is required: its id or exact name');
  const byId = util.byId(app, 'parts', v);
  if (byId !== null) return byId;
  const hits = util.rows(app, 'SELECT id FROM {{parts}} WHERE LOWER([[name]]) = LOWER({:v}) LIMIT 2', { id: '' }, { v: v });
  if (hits.length === 1) return app.findRecordById('parts', hits[0].id);
  const names = app.findRecordsByFilter('parts', 'archived = false', '-updated', 12, 0).map((p) => p.getString('name'));
  throw util.fail(404, 'No part "' + v + '".' + (names.length ? ' Parts: ' + names.join(', ') + '.' : ' There are no parts yet; create one with parts.create.'));
}

function featureRecs(app, partId) {
  return app.findRecordsByFilter('features', 'part = {:p}', 'seq,created', 0, 0, { p: partId });
}

function paramRecs(app, partId) {
  return app.findRecordsByFilter('parameters', 'part = {:p}', 'sort,name', 0, 0, { p: partId });
}

/** A feature of a part by id or name. */
function feature(app, partId, ref) {
  const util = u();
  const v = String(ref || '').trim();
  if (v === '') throw util.fail(400, 'feature is required: its name (e.g. ext1) or id');
  const rec = util.findOne(app, 'features', 'part = {:p} && (name = {:v} || id = {:v})', { p: partId, v: v });
  if (rec === null) {
    const names = featureRecs(app, partId).map((f) => f.getString('name'));
    throw util.fail(404, 'This part has no feature "' + v + '".' + (names.length ? ' Features: ' + names.join(', ') + '.' : ''));
  }
  return rec;
}

function param(app, partId, name) {
  return u().findOne(app, 'parameters', 'part = {:p} && name = {:n}', { p: partId, n: name });
}

function settings(app) {
  const rows = app.findRecordsByFilter('settings', '', '', 1, 0);
  if (rows.length === 0) throw u().fail(500, 'The settings row is missing');
  return rows[0];
}

/** Density in g/cm3: the part's own, else its material's from settings, else null. */
function density(app, partRec) {
  const own = partRec.getFloat('density');
  if (own > 0) return own;
  const mat = partRec.getString('material');
  if (mat === '') return null;
  const list = u().getJson(settings(app), 'materials') || [];
  for (const m of list) if (m && m.name === mat && typeof m.density === 'number') return m.density;
  return null;
}

/* ------------------------------------------------------------ parameters */

/** Evaluate every parameter in dependency order: { values, errors }. */
function evalParams(recs) {
  const expr = require(`${__hooks}/lib_expr.js`);
  const deps = {};
  const text = {};
  const errors = {};
  for (const r of recs) {
    const n = r.getString('name');
    text[n] = r.getString('expr');
    try {
      deps[n] = expr.names(text[n]);
    } catch (err) {
      errors[n] = err.message;
      deps[n] = [];
    }
  }
  const values = {};
  const state = {};
  const visit = (n, stack) => {
    if (state[n] === 2) return;
    if (state[n] === 1) {
      const cycle = stack.slice(stack.indexOf(n)).concat([n]);
      for (const c of cycle) if (errors[c] === undefined) errors[c] = 'circular: ' + cycle.join(' -> ');
      return;
    }
    state[n] = 1;
    for (const d of deps[n]) {
      if (deps[d] === undefined) {
        if (errors[n] === undefined) errors[n] = 'uses "' + d + '", which is not a parameter of this part';
        continue;
      }
      visit(d, stack.concat([n]));
    }
    state[n] = 2;
    if (errors[n] !== undefined) return;
    for (const d of deps[n]) {
      if (errors[d] !== undefined) {
        errors[n] = 'depends on "' + d + '", which has an error';
        return;
      }
    }
    try {
      values[n] = expr.evaluate(text[n], values);
    } catch (err) {
      errors[n] = err.message;
    }
  };
  for (const r of recs) visit(r.getString('name'), []);
  return { values: values, errors: errors };
}

/** Params with every {"expr": ...} replaced by its number; an expression that
 * cannot be evaluated becomes text the engine refuses with the reason. */
function resolveValue(v, env) {
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, env));
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'expr' && typeof v.expr === 'string') {
      try {
        return require(`${__hooks}/lib_expr.js`).evaluate(v.expr, env);
      } catch (err) {
        return 'cannot evaluate "' + v.expr + '": ' + err.message;
      }
    }
    const out = {};
    for (const k of keys) out[k] = resolveValue(v[k], env);
    return out;
  }
  return v;
}

/* ------------------------------------------------------------ the tree */

/** The index the rollback marker stops at (features at and after it are rolled back), or null. */
function rollbackIndex(partRec, feats) {
  const at = partRec.getString('rollback_after');
  if (at === '') return null;
  if (at === 'start') return 0;
  for (let i = 0; i < feats.length; i++) if (feats[i].id === at) return i + 1;
  return null;
}

/** The tree as the engine gets it, plus what its hash covers. */
function engineTree(app, partRec, override) {
  const util = u();
  const feats = override && override.features ? override.features : featureRecs(app, partRec.id).map(snapFeature);
  const prs = paramRecs(app, partRec.id);
  const ev = evalParams(prs);
  const rollback = override && override.rollback !== undefined ? override.rollback : rollbackIndex(partRec, featureRecs(app, partRec.id));
  const features = feats.map((f) => ({ name: f.name, kind: f.kind, params: resolveValue(f.params || {}, ev.values), suppressed: f.suppressed === true }));
  const assets = {};
  const ids = [];
  for (const f of feats) if (f.kind === 'import_step' && f.params && typeof f.params.asset === 'string') ids.push(f.params.asset);
  for (const id of ids) {
    const a = util.byId(app, 'assets', id);
    if (a !== null) assets[id] = { path: util.filePath(app, a, 'file'), hash: a.getString('hash') };
  }
  return { tree: { features: features, rollback: rollback }, assets: assets, values: ev.values, errors: ev.errors };
}

function checkDefs(app, partId) {
  return app.findRecordsByFilter('checks', 'part = {:p}', 'sort,created', 0, 0, { p: partId }).map((c) => ({
    id: c.id,
    kind: c.getString('kind'),
    refs: u().getJson(c, 'refs'),
    op: c.getString('op') || 'eq',
    target: c.getFloat('target'),
    target_max: c.getFloat('target_max'),
    tolerance: c.getFloat('tolerance'),
    box: u().getJson(c, 'box'),
  }));
}

/** Everything a build depends on, hashed: engine, resolved tree, files, density, checks. */
function inputHash(t, dens, checks) {
  const util = u();
  const assetHashes = {};
  for (const k of Object.keys(t.assets)) assetHashes[k] = t.assets[k].hash;
  return $security.sha256(util.canonical({ engine: ENGINE_ID, tree: t.tree, assets: assetHashes, density: dens, checks: checks }));
}

/** The build input of a part as it is now. */
function buildInput(app, partRec) {
  const t = engineTree(app, partRec);
  const dens = density(app, partRec);
  const checks = checkDefs(app, partRec.id);
  return { tree: t.tree, assets: t.assets, density: dens, checks: checks, hash: inputHash(t, dens, checks), paramErrors: t.errors };
}

/* --------------------------------------------------------------- snapshots */

function snapFeature(rec) {
  const util = u();
  return {
    id: rec.id,
    name: rec.getString('name'),
    kind: rec.getString('kind'),
    params: util.getJson(rec, 'params') || {},
    suppressed: rec.getBool('suppressed'),
    seq: rec.getInt('seq'),
    author: rec.getString('author'),
    note: rec.getString('note'),
  };
}

function snapParam(rec) {
  return {
    id: rec.id,
    name: rec.getString('name'),
    kind: rec.getString('kind'),
    expr: rec.getString('expr'),
    bounds: u().getJson(rec, 'bounds'),
    comment: rec.getString('comment'),
    sort: rec.getInt('sort'),
    author: rec.getString('author'),
  };
}

/* ------------------------------------------------------- name rewriting */

function renameKey(key, from, to) {
  return String(key)
    .split('|')
    .map((part) => {
      const tilde = part.indexOf('~');
      const head = tilde < 0 ? part : part.slice(0, tilde);
      const tail = tilde < 0 ? '' : part.slice(tilde);
      const pieces = head.split('@').map((seg, i) => {
        const dot = seg.indexOf('.');
        const name = dot < 0 ? seg : seg.slice(0, dot);
        const rest = dot < 0 ? '' : seg.slice(dot);
        if (name === from && (i > 0 || dot >= 0 || seg === from)) return to + rest;
        return seg;
      });
      return pieces.join('@') + tail;
    })
    .join('|');
}

/**
 * Params with feature `from` renamed to `to` wherever a feature is named:
 * reference keys, created_by, sketch, source.features, and (when the
 * feature's body carries its name) body names.
 */
function renameInParams(v, from, to, bodyToo, key) {
  if (Array.isArray(v)) {
    if (key === 'keys' || key === 'not_keys') return v.map((k) => (typeof k === 'string' ? renameKey(k, from, to) : k));
    if (key === 'created_by' || key === 'features') return v.map((k) => (k === from ? to : k));
    if (bodyToo && (key === 'bodies' || key === 'tools' || key === 'target' || key === 'body')) return v.map((k) => (k === from ? to : k));
    return v.map((x) => renameInParams(x, from, to, bodyToo, key));
  }
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = renameInParams(v[k], from, to, bodyToo, k);
    return out;
  }
  if (typeof v === 'string') {
    if ((key === 'sketch' || key === 'created_by') && v === from) return to;
    if (bodyToo && (key === 'target' || key === 'body') && v === from) return to;
  }
  return v;
}

function renameParamInValue(v, from, to) {
  const expr = require(`${__hooks}/lib_expr.js`);
  if (Array.isArray(v)) return v.map((x) => renameParamInValue(x, from, to));
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'expr' && typeof v.expr === 'string') return { expr: expr.rename(v.expr, from, to) };
    const out = {};
    for (const k of keys) out[k] = renameParamInValue(v[k], from, to);
    return out;
  }
  return v;
}

/** True when a feature's params name another feature (references, sketch, source). */
function usesFeature(params, name) {
  const kinds = require(`${__hooks}/lib_kinds.js`);
  let hit = false;
  const walk = (v, key) => {
    if (hit) return;
    if (Array.isArray(v)) {
      if (key === 'keys' || key === 'not_keys') {
        for (const k of v) if (typeof k === 'string' && kinds.keyFeatures(k).indexOf(name) >= 0) hit = true;
        return;
      }
      if (key === 'created_by' || key === 'features') {
        if (v.indexOf(name) >= 0) hit = true;
        return;
      }
      for (const x of v) walk(x, key);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], k);
      return;
    }
    if (typeof v === 'string' && (key === 'sketch' || key === 'created_by') && v === name) hit = true;
  };
  walk(params, '');
  return hit;
}

function usesParam(v, name) {
  const expr = require(`${__hooks}/lib_expr.js`);
  if (Array.isArray(v)) return v.some((x) => usesParam(x, name));
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'expr' && typeof v.expr === 'string') {
      try {
        return expr.names(v.expr).indexOf(name) >= 0;
      } catch {
        return false;
      }
    }
    return keys.some((k) => usesParam(v[k], name));
  }
  return false;
}

/** Whether a feature makes a body that carries the feature's own name. */
function bodyNamedAfter(snap) {
  const p = snap.params || {};
  const op = p.operation || 'new';
  return ['extrude', 'revolve', 'primitive', 'import_step'].indexOf(snap.kind) >= 0 && op === 'new' && (p.body_name === undefined || p.body_name === null || p.body_name === '');
}

/* --------------------------------------------------------------- mutate */

/**
 * One journaled edit of a part's tree, in one transaction:
 *   mutate(app, partId, { actor, batch, note }, (ctx) => { ctx.addFeature(...) ... })
 * Returns { part, batch, changes: [ids], touched: [feature names], hash, created }.
 */
function mutate(app, partId, opts, fn) {
  const result = { batch: opts.batch, changes: [], touched: [], created: [], hash: '', partId: partId, input: null };
  try {
    transact(app, partId, opts, fn, result);
  } catch (err) {
    // A dry run fills result.input as its very last step and then throws to
    // roll the transaction back; any earlier error leaves input null.
    if (opts.dryRun && result.input !== null) return result;
    throw err;
  }
  return result;
}

function transact(app, partId, opts, fn, result) {
  const util = u();
  const kinds = require(`${__hooks}/lib_kinds.js`);
  app.runInTransaction((tx) => {
    const partRec = tx.findRecordById('parts', partId);
    const hashBefore = partRec.getString('tree_hash');
    let feats = featureRecs(tx, partId);
    let prs = paramRecs(tx, partId);
    const pending = [];
    const record = (action, target, targetId, before, after) => {
      pending.push({ action: action, target: target, target_id: targetId, before: before, after: after });
    };
    const names = () => feats.map((f) => f.getString('name'));
    const indexOf = (rec) => feats.findIndex((f) => f.id === rec.id);

    const validateAt = (idx, kind, params) => {
      const before = feats.slice(0, idx).map((f) => f.getString('name'));
      const all = names();
      const kindMap = {};
      for (const f of feats) kindMap[f.getString('name')] = f.getString('kind');
      const ctx = {
        before: before,
        all: all,
        kinds: kindMap,
        sketches: feats.slice(0, idx).filter((f) => f.getString('kind') === 'sketch').map((f) => f.getString('name')),
        params: prs.map((r) => r.getString('name')),
        assets: tx.findRecordsByFilter('assets', 'part = {:p}', '', 0, 0, { p: partId }).map((a) => a.id),
      };
      return kinds.normalize(kind, params, ctx);
    };

    const freshName = (kind, params) => {
      let prefix = PREFIX[kind] || kind;
      if (kind === 'primitive') prefix = SHAPE_PREFIX[params && params.shape] || 'prim';
      const taken = names();
      for (let n = 1; n < 10000; n++) if (taken.indexOf(prefix + n) < 0) return prefix + n;
      throw util.fail(400, 'Too many features');
    };

    /** Index to insert at: after a named feature, at 'start', or at the rollback marker (else the end). */
    const insertIndex = (after) => {
      if (after === 'start') return 0;
      if (after !== undefined && after !== null && after !== '') {
        const i = feats.findIndex((f) => f.getString('name') === after || f.id === after);
        if (i < 0) throw util.fail(400, 'after: no feature "' + after + '" (use a feature name, or "start")');
        return i + 1;
      }
      const rb = rollbackIndex(partRec, feats);
      return rb === null ? feats.length : rb;
    };

    const renumber = () => {
      feats.forEach((f, i) => {
        if (f.getInt('seq') !== i + 1) {
          f.set('seq', i + 1);
          tx.save(f);
        }
      });
    };

    const ctx = {
      tx: tx,
      part: partRec,
      features: () => feats.slice(),
      params: () => prs.slice(),
      record: record,
      /** Re-read features and parameters after writing them through ctx.tx directly. */
      reload: () => {
        feats = featureRecs(tx, partId);
        prs = paramRecs(tx, partId);
      },
      renumber: () => renumber(),
      touch: (name) => {
        if (result.touched.indexOf(name) < 0) result.touched.push(name);
      },

      addFeature: (spec) => {
        const kind = spec.kind;
        if (kinds.KIND_NAMES.indexOf(kind) < 0) throw util.fail(400, 'kind must be one of: ' + kinds.KIND_NAMES.join(', '));
        const name = spec.name && spec.name !== '' ? spec.name : freshName(kind, spec.params);
        if (!IDENT.test(name)) throw util.fail(400, 'name must be a short lower-case name like ext2 or base_plate (letters, digits, _)');
        if (names().indexOf(name) >= 0) throw util.fail(400, 'This part already has a feature named ' + name);
        const idx = insertIndex(spec.after);
        const params = validateAt(idx, kind, spec.params || {});
        const rec = new Record(tx.findCollectionByNameOrId('features'));
        rec.set('part', partId);
        rec.set('name', name);
        rec.set('kind', kind);
        rec.set('params', params);
        rec.set('suppressed', spec.suppressed === true);
        rec.set('author', opts.actor === 'agent' ? 'agent' : 'you');
        rec.set('status', 'pending');
        rec.set('note', spec.note || '');
        rec.set('seq', idx + 1);
        tx.save(rec);
        feats.splice(idx, 0, rec);
        renumber();
        // A feature added at the rollback marker moves the marker past it.
        const rb = partRec.getString('rollback_after');
        if (rb !== '' && (spec.after === undefined || spec.after === null || spec.after === '')) {
          const prev = rb;
          partRec.set('rollback_after', rec.id);
          record('roll_to', name, partRec.id, { rollback_after: prev }, { rollback_after: rec.id });
        }
        record('add_feature', name, rec.id, null, snapFeature(rec));
        ctx.touch(name);
        result.created.push(name);
        return rec;
      },

      updateFeature: (rec, spec) => {
        const before = snapFeature(rec);
        const idx = indexOf(rec);
        let name = before.name;
        if (spec.name !== undefined && spec.name !== null && spec.name !== '' && spec.name !== before.name) {
          if (!IDENT.test(spec.name)) throw util.fail(400, 'name must be a short lower-case name (letters, digits, _)');
          if (names().indexOf(spec.name) >= 0) throw util.fail(400, 'This part already has a feature named ' + spec.name);
          name = spec.name;
        }
        if (spec.params !== undefined) rec.set('params', validateAt(idx, before.kind, spec.params));
        if (spec.suppressed !== undefined) rec.set('suppressed', spec.suppressed === true);
        if (spec.note !== undefined) rec.set('note', spec.note);
        if (name !== before.name) {
          rec.set('name', name);
          const bodyToo = bodyNamedAfter(before);
          for (let j = 0; j < feats.length; j++) {
            if (j === idx) continue;
            const other = feats[j];
            const op = util.getJson(other, 'params') || {};
            const np = renameInParams(op, before.name, name, bodyToo, '');
            if (util.canonical(np) !== util.canonical(op)) {
              const ob = snapFeature(other);
              other.set('params', np);
              tx.save(other);
              record('update_feature', other.getString('name'), other.id, ob, snapFeature(other));
              ctx.touch(other.getString('name'));
            }
          }
        }
        rec.set('status', 'pending');
        tx.save(rec);
        const after = snapFeature(rec);
        if (util.canonical(after) !== util.canonical(before)) {
          record('update_feature', name, rec.id, before, after);
          ctx.touch(name);
        }
        return rec;
      },

      moveFeature: (rec, after) => {
        const from = indexOf(rec);
        const before = snapFeature(rec);
        feats.splice(from, 1);
        let to;
        if (after === 'start') to = 0;
        else {
          const i = feats.findIndex((f) => f.getString('name') === after || f.id === after);
          if (i < 0) {
            feats.splice(from, 0, rec);
            throw util.fail(400, 'after: no feature "' + after + '"');
          }
          to = i + 1;
        }
        feats.splice(to, 0, rec);
        // Every feature must still only use what comes before it.
        for (let j = 0; j < feats.length; j++) {
          const f = feats[j];
          try {
            validateAt(j, f.getString('kind'), util.getJson(f, 'params') || {});
          } catch (err) {
            feats.splice(to, 1);
            feats.splice(from, 0, rec);
            throw util.fail(400, 'Moving ' + before.name + ' there breaks ' + f.getString('name') + ': ' + err.message);
          }
        }
        renumber();
        record('move_feature', before.name, rec.id, { seq: from + 1 }, { seq: to + 1 });
        ctx.touch(before.name);
        return rec;
      },

      deleteFeature: (rec) => {
        const snap = snapFeature(rec);
        const users = feats.filter((f) => f.id !== rec.id && usesFeature(util.getJson(f, 'params') || {}, snap.name)).map((f) => f.getString('name'));
        if (users.length) {
          throw util.fail(400, snap.name + ' is used by ' + users.join(', ') + '. Delete or change those first (or delete them together).', { dependents: users });
        }
        if (partRec.getString('rollback_after') === rec.id) {
          const i = indexOf(rec);
          const prev = i > 0 ? feats[i - 1].id : 'start';
          record('roll_to', snap.name, partRec.id, { rollback_after: rec.id }, { rollback_after: prev });
          partRec.set('rollback_after', prev);
        }
        feats.splice(indexOf(rec), 1);
        // Delete a record read by id: deleting one from a filter query panics in PocketBase 0.39.
        tx.delete(tx.findRecordById('features', rec.id));
        renumber();
        record('delete_feature', snap.name, snap.id, snap, null);
        ctx.touch(snap.name);
      },

      setParam: (spec) => {
        const expr = require(`${__hooks}/lib_expr.js`);
        let rec = prs.find((r) => r.getString('name') === spec.name) || null;
        const before = rec === null ? null : snapParam(rec);
        if (rec === null) {
          if (!IDENT.test(spec.name || '')) throw util.fail(400, 'name must be a short lower-case name like wall or hole_d (letters, digits, _)');
          if (spec.expr === undefined || spec.expr === null || String(spec.expr).trim() === '') throw util.fail(400, 'value is required for a new parameter, e.g. value=3 or value="wall * 2"');
          rec = new Record(tx.findCollectionByNameOrId('parameters'));
          rec.set('part', partId);
          rec.set('name', spec.name);
          rec.set('kind', spec.kind || 'length');
          rec.set('sort', prs.length + 1);
          rec.set('author', opts.actor === 'agent' ? 'agent' : 'you');
          prs.push(rec);
        }
        if (spec.kind !== undefined && spec.kind !== null) rec.set('kind', spec.kind);
        if (spec.expr !== undefined && spec.expr !== null) {
          const text = String(spec.expr).trim();
          try {
            expr.parse(text);
          } catch (err) {
            throw util.fail(400, 'value "' + text + '" is not a valid number or expression: ' + err.message);
          }
          rec.set('expr', text);
        }
        if (spec.bounds !== undefined) rec.set('bounds', spec.bounds);
        if (spec.comment !== undefined) rec.set('comment', spec.comment);
        if (spec.rename !== undefined && spec.rename !== null && spec.rename !== '' && spec.rename !== rec.getString('name')) {
          const to = spec.rename;
          if (!IDENT.test(to)) throw util.fail(400, 'rename must be a short lower-case name');
          if (prs.some((r) => r.getString('name') === to)) throw util.fail(400, 'This part already has a parameter named ' + to);
          const from = rec.getString('name');
          rec.set('name', to);
          for (const other of prs) {
            if (other === rec) continue;
            const t = other.getString('expr');
            const nt = expr.rename(t, from, to);
            if (nt !== t) {
              const ob = snapParam(other);
              other.set('expr', nt);
              tx.save(other);
              record('set_parameter', other.getString('name'), other.id, ob, snapParam(other));
            }
          }
          for (const f of feats) {
            const fp = util.getJson(f, 'params') || {};
            const np = renameParamInValue(fp, from, to);
            if (util.canonical(np) !== util.canonical(fp)) {
              const ob = snapFeature(f);
              f.set('params', np);
              tx.save(f);
              record('update_feature', f.getString('name'), f.id, ob, snapFeature(f));
              ctx.touch(f.getString('name'));
            }
          }
        }
        // Values and errors for every parameter after this change.
        const ev = evalParams(prs);
        const own = rec.getString('name');
        if (ev.errors[own] !== undefined) throw util.fail(400, 'Parameter ' + own + ': ' + ev.errors[own] + '.');
        const b = util.getJson(rec, 'bounds');
        const val = ev.values[own];
        if (b && typeof b.min === 'number' && val < b.min - 1e-9) throw util.fail(400, own + ' = ' + util.fmt(val) + ' is below its minimum ' + util.fmt(b.min));
        if (b && typeof b.max === 'number' && val > b.max + 1e-9) throw util.fail(400, own + ' = ' + util.fmt(val) + ' is above its maximum ' + util.fmt(b.max));
        if (rec.getString('kind') === 'count' && Math.abs(val - Math.round(val)) > 1e-9) throw util.fail(400, own + ' is a count, so it must be a whole number (got ' + util.fmt(val) + ')');
        tx.save(rec);
        const after = snapParam(rec);
        if (before === null || util.canonical(after) !== util.canonical(before)) record('set_parameter', own, rec.id, before, after);
        return rec;
      },

      deleteParam: (rec) => {
        const snap = snapParam(rec);
        const expr = require(`${__hooks}/lib_expr.js`);
        const users = [];
        for (const other of prs) {
          if (other === rec) continue;
          try {
            if (expr.names(other.getString('expr')).indexOf(snap.name) >= 0) users.push('parameter ' + other.getString('name'));
          } catch {
            /* a broken expression uses nothing */
          }
        }
        for (const f of feats) if (usesParam(util.getJson(f, 'params') || {}, snap.name)) users.push(f.getString('name'));
        if (users.length) throw util.fail(400, snap.name + ' is used by ' + users.join(', ') + '. Change those first.', { dependents: users });
        prs = prs.filter((r) => r.id !== rec.id);
        tx.delete(tx.findRecordById('parameters', rec.id));
        record('delete_parameter', snap.name, snap.id, snap, null);
      },

      rollTo: (target) => {
        const prev = partRec.getString('rollback_after');
        let next = '';
        let label = 'end';
        if (target === 'start') {
          next = 'start';
          label = 'start';
        } else if (target !== null && target !== undefined && target !== 'end' && target !== '') {
          const rec = feats.find((f) => f.getString('name') === target || f.id === target);
          if (rec === undefined) throw util.fail(400, 'feature: no feature "' + target + '" (or use start / end)');
          next = feats.indexOf(rec) === feats.length - 1 ? '' : rec.id;
          label = rec.getString('name');
        }
        if (next === prev) return;
        partRec.set('rollback_after', next);
        record('roll_to', label, partRec.id, { rollback_after: prev }, { rollback_after: next });
      },
    };

    fn(ctx);

    // Fresh values for every parameter (any change may move them).
    const ev = evalParams(prs);
    for (const r of prs) {
      const n = r.getString('name');
      const v = ev.values[n];
      const err = ev.errors[n] || '';
      if ((v !== undefined && r.getFloat('value') !== v) || r.getString('error') !== err) {
        if (v !== undefined) r.set('value', v);
        r.set('error', err);
        tx.save(r);
      }
    }
    const input = buildInput(tx, partRec);
    result.hash = input.hash;
    if (opts.dryRun) {
      // Keep what the edit would build, then undo everything.
      result.input = input;
      result.features = featureRecs(tx, partId).map(snapFeature);
      result.pending = pending.length;
      throw new Error('dry run: roll back');
    }
    partRec.set('tree_hash', input.hash);
    if (feats.length === 0) partRec.set('status', 'empty');
    tx.save(partRec);
    const changesCol = tx.findCollectionByNameOrId('changes');
    // A monotonic order within and across batches (several rows share a millisecond).
    let ord = Date.now() * 100;
    const lastRow = tx.findRecordsByFilter('changes', 'part = {:p}', '-ord', 1, 0, { p: partId });
    if (lastRow.length > 0 && lastRow[0].getInt('ord') >= ord) ord = lastRow[0].getInt('ord') + 1;
    for (const c of opts.noJournal ? [] : pending) {
      const row = new Record(changesCol);
      row.set('part', partId);
      row.set('batch', opts.batch);
      row.set('actor', opts.actor);
      row.set('action', c.action);
      row.set('target', c.target);
      row.set('target_id', c.target_id);
      row.set('before', c.before);
      row.set('after', c.after);
      row.set('hash_before', hashBefore);
      row.set('hash_after', input.hash);
      row.set('note', opts.note || '');
      if (opts.reverts) row.set('reverts', opts.reverts);
      row.set('ord', ord++);
      tx.save(row);
      result.changes.push(row.id);
    }
    if (opts.afterJournal) opts.afterJournal(tx, result);
  });
}

/**
 * The batch an edit joins. The person's edits are one batch per action. The
 * agent's edits join its open batch on the part (its last change, within 15
 * minutes, with nobody else changing the part since), so one agent run
 * reverts in one step; `batch` names a batch explicitly.
 */
function batchFor(app, partId, actor, given, fresh) {
  const util = u();
  if (given !== undefined && given !== null && given !== '') {
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(given)) throw util.fail(400, 'batch must be 4 to 40 letters, digits, _ or -');
    return given;
  }
  if (actor !== 'agent' || fresh) return util.newId();
  const last = app.findRecordsByFilter('changes', 'part = {:p}', '-ord', 1, 0, { p: partId });
  if (last.length === 0) return util.newId();
  const c = last[0];
  const age = Date.now() - Date.parse(c.getString('created').replace(' ', 'T'));
  if (c.getString('actor') === 'agent' && c.getString('reverted_by') === '' && c.getString('reverts') === '' && age < 15 * 60 * 1000) return c.getString('batch');
  return util.newId();
}

module.exports = {
  ENGINE_ID: ENGINE_ID,
  part: part,
  feature: feature,
  param: param,
  featureRecs: featureRecs,
  paramRecs: paramRecs,
  settings: settings,
  density: density,
  evalParams: evalParams,
  resolveValue: resolveValue,
  rollbackIndex: rollbackIndex,
  engineTree: engineTree,
  buildInput: buildInput,
  inputHash: inputHash,
  checkDefs: checkDefs,
  snapFeature: snapFeature,
  snapParam: snapParam,
  usesFeature: usesFeature,
  usesParam: usesParam,
  mutate: mutate,
  batchFor: batchFor,
};
