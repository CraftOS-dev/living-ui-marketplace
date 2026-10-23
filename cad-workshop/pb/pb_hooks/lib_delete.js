/// <reference path="../pb_data/types.d.ts" />
/**
 * records.delete: the one delete path for every kind of record, with a
 * preview of everything it takes along. Features and parameters are deleted
 * as journaled tree edits (so they revert like any edit); a part takes its
 * whole history and files with it.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

const COLLECTIONS = ['parts', 'features', 'parameters', 'builds', 'exports', 'changes', 'checks', 'assets', 'briefs', 'compares', 'selections'];

function count(app, collection, filter, bind) {
  return app.findRecordsByFilter(collection, filter, '', 0, 0, bind).length;
}

function find(app, collection, id) {
  const util = u();
  const rec = util.byId(app, collection, id);
  if (rec === null) throw util.fail(404, 'No ' + collection + ' record ' + id);
  return rec;
}

function del(app, e, p) {
  const util = u();
  const collection = util.oneOf(p, 'collection', COLLECTIONS, '');
  if (collection === '') throw util.fail(400, 'collection is required: ' + COLLECTIONS.join(', '));
  const id = util.req(p, 'id', '<record id>');
  const preview = util.bool(p, 'preview', false);
  const reason = util.str(p, 'reason', '');
  const actor = util.actor(e);
  const log = (what) => console.log('[cad-workshop] deleted ' + what + ' (by ' + actor + (reason ? ': ' + reason : '') + ')');

  if (collection === 'parts') {
    const part = require(`${__hooks}/lib_tree.js`).part(app, id);
    const bind = { p: part.id };
    const takes = {
      features: count(app, 'features', 'part = {:p}', bind),
      parameters: count(app, 'parameters', 'part = {:p}', bind),
      builds: count(app, 'builds', 'part = {:p}', bind),
      exports: count(app, 'exports', 'part = {:p}', bind),
      changes: count(app, 'changes', 'part = {:p}', bind),
      checks: count(app, 'checks', 'part = {:p}', bind),
      files_for_import: count(app, 'assets', 'part = {:p}', bind),
      requests: count(app, 'briefs', 'part = {:p}', bind),
    };
    if (preview) return { preview: true, collection: collection, id: part.id, name: part.getString('name'), removes: takes, note: 'Deleting a part removes its whole history and its exported files. It cannot be undone.' };
    require(`${__hooks}/lib_builds.js`).cancel(app, part.id);
    app.runInTransaction((tx) => {
      const r = tx.findRecordById('parts', part.id);
      r.set('current_build', '');
      tx.save(r);
      tx.delete(r);
    });
    try {
      $os.removeAll($filepath.join(app.dataDir(), 'cad-renders', part.id));
    } catch {
      /* none */
    }
    log('part ' + part.getString('name'));
    return { deleted: true, collection: collection, id: part.id, removed: takes };
  }

  if (collection === 'features') {
    const rec = find(app, 'features', id);
    const T = require(`${__hooks}/lib_tree.js`);
    const users = T.featureRecs(app, rec.getString('part'))
      .filter((f) => f.id !== rec.id && T.usesFeature(util.getJson(f, 'params') || {}, rec.getString('name')))
      .map((f) => f.getString('name'));
    if (preview) {
      return {
        preview: true,
        collection: collection,
        id: rec.id,
        name: rec.getString('name'),
        blocked_by: users,
        note: users.length ? 'Used by ' + users.join(', ') + '; delete or change those first.' : 'Deleting a feature is a tree edit: it rebuilds the part and can be reverted from Changes.',
      };
    }
    const out = require(`${__hooks}/lib_edit.js`).featureDelete(app, e, p, rec);
    log('feature ' + rec.getString('name'));
    return out;
  }

  if (collection === 'parameters') {
    const rec = find(app, 'parameters', id);
    const T = require(`${__hooks}/lib_tree.js`);
    const expr = require(`${__hooks}/lib_expr.js`);
    const name = rec.getString('name');
    const users = [];
    for (const o of T.paramRecs(app, rec.getString('part'))) {
      if (o.id === rec.id) continue;
      try {
        if (expr.names(o.getString('expr')).indexOf(name) >= 0) users.push('parameter ' + o.getString('name'));
      } catch {
        /* a broken expression uses nothing */
      }
    }
    for (const f of T.featureRecs(app, rec.getString('part'))) if (T.usesParam(util.getJson(f, 'params') || {}, name)) users.push(f.getString('name'));
    if (preview) return { preview: true, collection: collection, id: rec.id, name: name, blocked_by: users, note: users.length ? 'Used by ' + users.join(', ') + '.' : 'Deleting a parameter is a tree edit and can be reverted.' };
    const out = require(`${__hooks}/lib_edit.js`).paramDelete(app, e, p, rec);
    log('parameter ' + name);
    return out;
  }

  if (collection === 'builds') {
    const rec = find(app, 'builds', id);
    const part = util.byId(app, 'parts', rec.getString('part'));
    if (part !== null && part.getString('current_build') === rec.id) throw util.fail(400, 'This is the part\'s current model; it is replaced on the next build and pruned after a day.');
    if (['queued', 'running'].indexOf(rec.getString('status')) >= 0) throw util.fail(400, 'This build has not finished; cancel it with builds.cancel.');
    const takes = { exports_keep_their_files: count(app, 'exports', 'build = {:b}', { b: rec.id }), checks_lose_their_link: count(app, 'checks', 'build = {:b}', { b: rec.id }) };
    if (preview) return { preview: true, collection: collection, id: rec.id, removes: takes };
    app.delete(rec);
    log('build ' + rec.id);
    return { deleted: true, collection: collection, id: rec.id };
  }

  if (collection === 'changes') {
    const row = find(app, 'changes', id);
    const batch = row.getString('batch');
    const rows = app.findRecordsByFilter('changes', 'batch = {:b}', '', 0, 0, { b: batch });
    if (preview) return { preview: true, collection: collection, id: id, batch: batch, removes: { changes: rows.length }, note: 'Removes this batch from the history; the model stays as it is, but the batch can no longer be reverted.' };
    app.runInTransaction((tx) => {
      for (const r of tx.findRecordsByFilter('changes', 'batch = {:b}', '', 0, 0, { b: batch })) tx.delete(tx.findRecordById('changes', r.id));
    });
    log('change batch ' + batch);
    return { deleted: true, collection: collection, batch: batch, removed: rows.length };
  }

  if (collection === 'checks') {
    const rec = find(app, 'checks', id);
    if (actor === 'agent' && rec.getString('author') === 'you') throw util.fail(403, 'This check was written by the person; the AI agent may not delete it.');
    if (preview) return { preview: true, collection: collection, id: rec.id, name: rec.getString('name') };
    const partId = rec.getString('part');
    app.delete(rec);
    require(`${__hooks}/lib_misc.js`).refreshHash(app, partId);
    const B = require(`${__hooks}/lib_builds.js`);
    B.kick(app, B.enqueue(app, partId, actor), 0);
    log('check ' + rec.getString('name'));
    return { deleted: true, collection: collection, id: rec.id };
  }

  if (collection === 'assets') {
    const rec = find(app, 'assets', id);
    const users = require(`${__hooks}/lib_tree.js`)
      .featureRecs(app, rec.getString('part'))
      .filter((f) => f.getString('kind') === 'import_step' && (util.getJson(f, 'params') || {}).asset === rec.id)
      .map((f) => f.getString('name'));
    if (preview) return { preview: true, collection: collection, id: rec.id, name: rec.getString('name'), blocked_by: users };
    if (users.length) throw util.fail(400, rec.getString('name') + ' is imported by ' + users.join(', ') + '; delete those features first.', { dependents: users });
    app.delete(rec);
    log('file ' + rec.getString('name'));
    return { deleted: true, collection: collection, id: rec.id };
  }

  // exports, briefs, compares, selections: no dependents.
  const rec = find(app, collection, id);
  if (preview) return { preview: true, collection: collection, id: rec.id, note: collection === 'exports' ? 'Removes the stored file.' : collection === 'selections' ? 'Clears the selection.' : '' };
  app.delete(rec);
  log(collection + ' ' + rec.id);
  return { deleted: true, collection: collection, id: rec.id };
}

module.exports = { del: del, COLLECTIONS: COLLECTIONS };
