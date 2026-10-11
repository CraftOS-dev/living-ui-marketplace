/// <reference path="../pb_data/types.d.ts" />
/**
 * Menu and price-list imports read by the AI agent: a photo of a menu
 * board, a PDF price list or a supplier spreadsheet. The agent reads the
 * file and adds what it finds as products TO REVIEW (status draft): nothing
 * it imports is sold until a person approves it on the Products page.
 *
 * Life cycle: waiting (added, the agent asked) -> reading (the agent took it)
 * -> done (with a summary) or failed (with a reason; retry asks again).
 *
 * Asking the agent: one `menu_import_waiting` trigger drains every waiting
 * file. The trigger has a cooldown, so a fire refused for timing is retried
 * by a minute cron; an in-memory flag means the cron touches the database
 * only when something actually needs asking.
 */

const DIRTY = 'pos_imports_dirty';
const FIRED_AT = 'pos_imports_fired_at';
const BOOTED = 'pos_imports_boot_checked';

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function serialize(app, rec) {
  const util = u();
  const file = rec.getString('file');
  const lower = file.toLowerCase();
  const isImage = /\.(jpe?g|png|webp|gif)$/.test(lower);
  return {
    id: rec.id,
    status: rec.getString('status'),
    filename: rec.getString('filename'),
    file: file,
    file_path: util.filePath(app, rec, 'file'),
    url: '/api/files/imports/' + rec.id + '/' + file,
    thumb: isImage ? '/api/files/imports/' + rec.id + '/' + file + '?thumb=160x160' : '',
    kind: isImage ? 'image' : /\.pdf$/.test(lower) ? 'pdf' : 'sheet',
    summary: rec.getString('summary'),
    error: rec.getString('error'),
    created_count: rec.getInt('created_count'),
    to_review: util.scalarSql(app, "SELECT COUNT(id) AS v FROM products WHERE import_ref = {:r} AND status = 'draft' AND archived = false", { r: rec.id }),
    added_by: rec.getString('added_by'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function list(app, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['all', 'waiting', 'reading', 'done', 'failed'], 'all');
  const recs = app.findRecordsByFilter('imports', status === 'all' ? '' : 'status = {:s}', '-created', util.int(p, 'limit', 30, 1, 200), 0, { s: status });
  const counts = { waiting: 0, reading: 0, done: 0, failed: 0 };
  for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM imports GROUP BY status', { status: '', n: 0 })) counts[r.status] = r.n;
  return { imports: recs.map((r) => serialize(app, r)), counts: counts, drafts: util.scalarSql(app, "SELECT COUNT(id) AS v FROM products WHERE status = 'draft' AND archived = false") };
}

function mustGet(app, id) {
  const util = u();
  const rec = util.byId(app, 'imports', String(id || ''));
  if (rec === null) throw util.fail(404, 'No import "' + id + '". List them with imports.list.', 'not_found');
  return rec;
}

/** Store a file for the AI agent to read; it is asked at once. */
function add(e, app, p, ctx) {
  const util = u();
  let file = util.uploaded(e, 'file');
  let filename = file !== null ? String(file.originalName || file.name || '') : '';
  if (file === null) {
    const path = util.str(p, 'path', '');
    if (path === '') throw util.fail(400, 'Attach a file (photo, PDF or spreadsheet), or give path: the absolute path of one');
    file = util.localFile(path, 'path');
    filename = path.split(/[\\/]/).pop();
  }
  const rec = new Record(app.findCollectionByNameOrId('imports'));
  rec.set('file', file);
  rec.set('filename', filename.slice(0, 200));
  rec.set('status', 'waiting');
  rec.set('summary', '');
  rec.set('error', '');
  rec.set('created_count', 0);
  rec.set('added_by', ctx.actor === 'agent' ? 'agent' : 'staff');
  app.save(rec);
  markDirty(app);
  fireIfNeeded(app);
  return serialize(app, rec);
}

function start(app, rec) {
  const util = u();
  if (rec.getString('status') === 'done') throw util.fail(409, 'That import is already done.', 'import_done');
  rec.set('status', 'reading');
  rec.set('error', '');
  app.save(rec);
  return serialize(app, rec);
}

function complete(app, rec, summary) {
  const util = u();
  const s = util.squash(summary);
  if (s === '') throw util.fail(400, 'summary is required: what was added, e.g. "Added 24 products in 5 categories to review; skipped 2 lines without prices"');
  rec.set('status', 'done');
  rec.set('summary', s.slice(0, 1000));
  rec.set('error', '');
  rec.set('created_count', util.scalarSql(app, 'SELECT COUNT(id) AS v FROM products WHERE import_ref = {:r}', { r: rec.id }));
  app.save(rec);
  return serialize(app, rec);
}

function failImport(app, rec, reason) {
  const util = u();
  const r = util.squash(reason);
  if (r === '') throw util.fail(400, 'reason is required: why the file could not be imported, in words the user can act on');
  rec.set('status', 'failed');
  rec.set('error', r.slice(0, 300));
  app.save(rec);
  return serialize(app, rec);
}

function retry(app, rec) {
  rec.set('status', 'waiting');
  rec.set('error', '');
  app.save(rec);
  markDirty(app);
  fireIfNeeded(app);
  return serialize(app, rec);
}

/** Delete an import file; products it added stay (drafts are reviewed on Products). */
function remove(app, rec) {
  const name = rec.getString('filename');
  app.delete(app.findRecordById('imports', rec.id));
  return { deleted: name };
}

function markDirty(app) {
  app.store().set(DIRTY, true);
}

/** Ask the AI agent to read waiting files if any arrived since the last ask. */
function fireIfNeeded(app) {
  if (app.store().get(BOOTED) !== true) {
    app.store().set(BOOTED, true);
    app.store().set(DIRTY, true);
  }
  if (app.store().get(DIRTY) !== true) return { fired: false, reason: 'idle' };
  const waiting = app.findRecordsByFilter('imports', "status = 'waiting'", '-updated', 1, 0);
  if (waiting.length === 0) {
    app.store().set(DIRTY, false);
    return { fired: false, reason: 'nothing waiting' };
  }
  const newest = Date.parse(waiting[0].getString('updated').replace(' ', 'T'));
  const last = Number(app.store().get(FIRED_AT) || 0);
  if (last > 0 && newest <= last) {
    app.store().set(DIRTY, false);
    return { fired: false, reason: 'already asked' };
  }
  const res = require(`${__hooks}/_triggers_lib.js`).fire(app, 'menu_import_waiting', {}, 'hook');
  if (res && res.ok) {
    app.store().set(FIRED_AT, Date.now());
    app.store().set(DIRTY, false);
    return { fired: true };
  }
  return { fired: false, reason: (res && res.message) || 'refused' };
}

module.exports = { serialize: serialize, list: list, mustGet: mustGet, add: add, start: start, complete: complete, failImport: failImport, retry: retry, remove: remove, markDirty: markDirty, fireIfNeeded: fireIfNeeded };
