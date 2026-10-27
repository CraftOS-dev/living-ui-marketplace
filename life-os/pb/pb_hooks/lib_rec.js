/// <reference path="../pb_data/types.d.ts" />
/**
 * Plain records with an activity trail: create, change and delete a record
 * of any of the simple collections (people, books, pots, chores...) in one
 * transaction with an activity row that can undo it.
 *
 * `crud(cfg)` builds the list / create / update / remove handlers of a
 * collection from a small config:
 *
 *   collection  'books'
 *   param       the id parameter's name ('book')
 *   noun        how labels name a record: (rec) => 'the book "Dune"'
 *   fields      the fields a snapshot keeps (for undo)
 *   json        which of them are json fields
 *   read        (ctx, p, rec, creating) => applies params to rec (validates)
 *   out         (app, rec) => the record as the screens and the agent see it
 *   sort        list order ('rank,created')
 *   where       (ctx, p) => { filter, bind } for list
 *   after       (app, rec, ids) => keeps derived numbers in step (optional)
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let act_ = null;
function act() {
  return act_ || (act_ = require(`${__hooks}/lib_activity.js`));
}

/** Run fn with a transaction (or the one already open). */
function tx(app, fn) {
  if (app.isTransactional()) return fn(app);
  let out;
  app.runInTransaction((t) => {
    out = fn(t);
  });
  return out;
}

function snapshot(rec, fields, json) {
  const util = u();
  const o = {};
  for (const f of fields) o[f] = (json || []).indexOf(f) >= 0 ? util.jsonOf(rec, f) : rec.get(f);
  return JSON.parse(JSON.stringify(o));
}

/** Undo of a create: the record goes. */
function undoCreate(ctx, args) {
  const r = u().byId(ctx.app, args.collection, args.id);
  if (r !== null) ctx.app.delete(r);
  afterHook(ctx.app, args);
}

/** Undo of a change: the fields go back. */
function undoUpdate(ctx, args) {
  const r = u().byId(ctx.app, args.collection, args.id);
  if (r === null) return;
  for (const k of Object.keys(args.fields)) r.set(k, args.fields[k]);
  ctx.app.save(r);
  afterHook(ctx.app, args);
}

/** Undo of a delete: the record comes back with its id. */
function undoRemove(ctx, args) {
  const util = u();
  if (util.byId(ctx.app, args.collection, args.id) !== null) return;
  const r = util.newRecord(ctx.app, args.collection);
  r.set('id', args.id);
  for (const k of Object.keys(args.fields)) r.set(k, args.fields[k]);
  ctx.app.save(r);
  afterHook(ctx.app, args);
}

/** After an undo, the module named in args.after keeps its derived numbers in step. */
function afterHook(app, args) {
  if (!args.after) return;
  const parts = args.after.split('.');
  const fn = require(`${__hooks}/${parts[0]}.js`)[parts[1]];
  if (typeof fn === 'function') fn(app, args.refs || {});
}

function crud(cfg) {
  const label = (rec) => cfg.noun(rec);

  function list(ctx, p) {
    const w = cfg.where ? cfg.where(ctx, p) : { filter: '', bind: {} };
    const recs = ctx.app.findRecordsByFilter(cfg.collection, w.filter, cfg.sort || '-created', w.limit || 0, 0, w.bind || {});
    const out = {};
    out[cfg.listKey || cfg.collection] = recs.map((r) => cfg.out(ctx.app, r));
    return out;
  }

  function create(ctx, p) {
    const util = u();
    const id = tx(ctx.app, (t) => {
      const tctx = Object.assign({}, ctx, { app: t });
      const r = util.newRecord(t, cfg.collection);
      cfg.read(tctx, p, r, true);
      if (cfg.actor !== false) r.set('actor', ctx.actor);
      t.save(r);
      const refs = cfg.refs ? cfg.refs(r) : {};
      if (cfg.after) cfg.after(t, refs);
      act().write(t, ctx, { label: 'Added ' + label(r), target: cfg.collection, record: r.id, undo: { fn: 'lib_rec.undoCreate', args: { collection: cfg.collection, id: r.id, after: cfg.afterName, refs: refs } } });
      return r.id;
    });
    const out = {};
    out[cfg.one] = cfg.out(ctx.app, ctx.app.findRecordById(cfg.collection, id));
    return out;
  }

  function update(ctx, p) {
    const util = u();
    const C = require(`${__hooks}/lib_core.js`);
    const id = util.req(p, cfg.param);
    tx(ctx.app, (t) => {
      const tctx = Object.assign({}, ctx, { app: t });
      const r = C.need(t, cfg.collection, id, cfg.one);
      const before = snapshot(r, cfg.fields, cfg.json);
      const refsBefore = cfg.refs ? cfg.refs(r) : {};
      cfg.read(tctx, p, r, false);
      t.save(r);
      const refs = Object.assign({}, cfg.refs ? cfg.refs(r) : {}, { before: refsBefore });
      if (cfg.after) cfg.after(t, refs);
      act().write(t, ctx, { label: 'Changed ' + label(r), target: cfg.collection, record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: cfg.collection, id: r.id, fields: before, after: cfg.afterName, refs: refs } } });
    });
    const out = {};
    out[cfg.one] = cfg.out(ctx.app, ctx.app.findRecordById(cfg.collection, id));
    return out;
  }

  function remove(ctx, p) {
    const util = u();
    const C = require(`${__hooks}/lib_core.js`);
    const id = util.req(p, cfg.param);
    tx(ctx.app, (t) => {
      const r = C.need(t, cfg.collection, id, cfg.one);
      const fields = snapshot(r, cfg.fields.concat(cfg.actor !== false ? ['actor'] : []), cfg.json);
      const refs = cfg.refs ? cfg.refs(r) : {};
      const name = label(r);
      t.delete(r);
      if (cfg.after) cfg.after(t, refs);
      act().write(t, ctx, { label: 'Deleted ' + name, target: cfg.collection, record: id, undo: { fn: 'lib_rec.undoRemove', args: { collection: cfg.collection, id: id, fields: fields, after: cfg.afterName, refs: refs } } });
    });
    return { deleted: true };
  }

  return { list: list, create: create, update: update, remove: remove };
}

module.exports = { tx: tx, snapshot: snapshot, crud: crud, undoCreate: undoCreate, undoUpdate: undoUpdate, undoRemove: undoRemove };
