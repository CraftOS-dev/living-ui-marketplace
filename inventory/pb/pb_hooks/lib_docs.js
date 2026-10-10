/// <reference path="../pb_data/types.d.ts" />
/**
 * Documents: packing slips, delivery notes and supplier invoices that the
 * AI agent reads and records as received stock.
 *
 * Life cycle: waiting (uploaded, the AI agent asked) -> reading (the AI agent
 * took it) -> done (stock recorded, with a short summary) or failed (with a
 * reason the user can act on; retry asks again).
 *
 * Asking the AI agent: one `documents_waiting` trigger drains every waiting
 * document, so a pile of uploads costs one agent run. The trigger has a
 * cooldown, so a fire refused for timing is retried by a minute cron; an
 * in-memory flag means the cron touches the database only when something
 * actually needs asking (never a blind poll).
 */

const DIRTY = 'inv_docs_dirty';
const FIRED_AT = 'inv_docs_fired_at';
const BOOTED = 'inv_docs_boot_checked';

function serialize(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const po = rec.getString('po') !== '' ? u.byId(app, 'orders', rec.getString('po')) : null;
  return {
    id: rec.id,
    status: rec.getString('status'),
    summary: rec.getString('summary'),
    error: rec.getString('error'),
    file: rec.getString('file'),
    file_path: u.filePath(app, rec, 'file'),
    url: '/api/files/documents/' + rec.id + '/' + rec.getString('file'),
    thumb: /\.pdf$/i.test(rec.getString('file')) ? null : '/api/files/documents/' + rec.id + '/' + rec.getString('file') + '?thumb=240x320',
    is_pdf: /\.pdf$/i.test(rec.getString('file')),
    order: po !== null ? { id: po.id, number: po.getString('number') } : null,
    batch: rec.getString('batch'),
    added_by: rec.getString('added_by') || 'you',
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function list(app, status, limit) {
  const filter = status ? 'status = {:s}' : '';
  const recs = app.findRecordsByFilter('documents', filter, '-created', limit, 0, { s: status || '' });
  const counts = { waiting: 0, reading: 0, done: 0, failed: 0 };
  const u = require(`${__hooks}/lib_util.js`);
  for (const r of u.rows(app, 'SELECT status, COUNT(id) AS n FROM documents GROUP BY status', { status: '', n: 0 })) counts[r.status] = r.n;
  return { documents: recs.map((r) => serialize(app, r)), counts: counts };
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'documents', id);
  if (rec === null) throw u.fail(404, 'No document "' + id + '".', 'List them with documents.list.');
  return rec;
}

/** Store one document; status 'waiting' asks the AI agent to read it. */
function store(app, file, addedBy) {
  const rec = new Record(app.findCollectionByNameOrId('documents'));
  rec.set('file', file);
  rec.set('status', 'waiting');
  rec.set('summary', '');
  rec.set('error', '');
  rec.set('batch', '');
  rec.set('added_by', addedBy);
  app.save(rec);
  return rec;
}

function markDirty(app) {
  app.store().set(DIRTY, true);
}

/**
 * Ask the AI agent to read waiting documents if any arrived since the last
 * successful ask. Safe to call often: it does nothing unless marked dirty.
 */
function fireIfNeeded(app) {
  // First tick after a start: documents left waiting before a restart may
  // have lost their ask (queued requests are not replayed), so check once.
  if (app.store().get(BOOTED) !== true) {
    app.store().set(BOOTED, true);
    app.store().set(DIRTY, true);
  }
  if (app.store().get(DIRTY) !== true) return { fired: false, reason: 'idle' };
  const waiting = app.findRecordsByFilter('documents', "status = 'waiting'", '-updated', 1, 0);
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
  const res = require(`${__hooks}/_triggers_lib.js`).fire(app, 'documents_waiting', {}, 'hook');
  if (res && res.ok) {
    app.store().set(FIRED_AT, Date.now());
    app.store().set(DIRTY, false);
    return { fired: true };
  }
  // Refused (cooldown, hourly cap): the flag stays set and the cron retries.
  return { fired: false, reason: (res && res.message) || 'refused' };
}

module.exports = {
  serialize: serialize,
  list: list,
  mustGet: mustGet,
  store: store,
  markDirty: markDirty,
  fireIfNeeded: fireIfNeeded,
};
