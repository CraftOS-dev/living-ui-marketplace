/// <reference path="../pb_data/types.d.ts" />
/**
 * Receipts: photos or PDFs that the AI agent reads into expenses.
 *
 * Life cycle: waiting (uploaded, the AI agent asked) -> reading (the AI agent took
 * it) -> done (an expense exists, linked by expenses.receipt) or failed
 * (with a reason; the user can retry or type it in).
 *
 * Asking the AI agent: one `receipts_waiting` trigger drains every waiting
 * receipt, so a batch of uploads costs one agent run. The trigger has a
 * cooldown, so a fire refused for timing is retried by a minute cron; an
 * in-memory flag means the cron touches the database only when something
 * actually needs asking (never a blind poll).
 *
 * Settling: a receipt the AI agent took (reading) always ends done or
 * failed. The same minute cron fails one the agent left behind: once the
 * agent has not called the app for QUIET_MINUTES (its run is over, whatever
 * its last chat message said), or after STALE_MINUTES in any case. The app
 * never looks at the agent's request queue for this; that is the agent's
 * surface. A receipts.complete that arrives later still records it.
 */

const DIRTY = 'et_receipts_dirty';
const FIRED_AT = 'et_receipts_fired_at';
const READING = 'et_receipts_reading';
const QUIET_MINUTES = 3;
const STALE_MINUTES = 15;
const STOPPED_REASON = 'Your AI agent stopped without recording this receipt. Try again, or type it in.';

/** Absolute path of the stored file (the agent reads it from disk). */
function filePath(app, rec) {
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), rec.getString('file'));
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

function serialize(app, rec, expenseId) {
  return {
    id: rec.id,
    status: rec.getString('status'),
    error: rec.getString('error'),
    added_by: rec.getString('added_by') || 'app',
    file: rec.getString('file'),
    file_path: filePath(app, rec),
    url: '/api/files/receipts/' + rec.id + '/' + rec.getString('file'),
    expense_id: expenseId || null,
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

/** receipt id -> expense id, for the given receipts. */
function expenseLinks(app, receiptIds) {
  const out = {};
  for (let i = 0; i < receiptIds.length; i += 40) {
    const chunk = receiptIds.slice(i, i + 40);
    const params = {};
    const ors = chunk.map((id, j) => {
      params['r' + j] = id;
      return 'receipt = {:r' + j + '}';
    });
    if (ors.length === 0) continue;
    for (const ex of app.findRecordsByFilter('expenses', ors.join(' || '), '', 0, 0, params)) {
      out[ex.getString('receipt')] = ex.id;
    }
  }
  return out;
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'receipts', id);
  if (rec === null) throw u.fail(404, 'No receipt with id "' + id + '". List them with receipts.list.');
  return rec;
}

/** A local file for the receipts collection, checked before it is stored. */
function fileFromLocalPath(path) {
  const u = require(`${__hooks}/lib_util.js`);
  try {
    const info = $os.stat(path);
    if (info.isDir()) throw u.fail(400, 'path is a folder, not a file: ' + path);
  } catch (err) {
    if (err && err.status) throw err;
    throw u.fail(400, 'No file at path "' + path + '". Give the absolute path of the image or PDF.');
  }
  return $filesystem.fileFromPath(path);
}

/** Store a receipt file. status 'waiting' asks the AI agent to read it. */
function store(app, file, status, addedBy) {
  const rec = new Record(app.findCollectionByNameOrId('receipts'));
  rec.set('file', file);
  rec.set('status', status);
  rec.set('added_by', addedBy);
  rec.set('error', '');
  app.save(rec);
  return rec;
}

/** Note that a waiting receipt may need the AI agent (checked by fireIfNeeded). */
function markDirty(app) {
  app.store().set(DIRTY, true);
}

/**
 * Ask the AI agent to read waiting receipts if any arrived since the last
 * successful ask. Safe to call often: it does nothing unless marked dirty.
 */
function fireIfNeeded(app) {
  // First tick after a start: receipts left waiting before a restart may
  // have lost their ask (queued requests are not replayed), so check once.
  if (app.store().get('et_receipts_boot_checked') !== true) {
    app.store().set('et_receipts_boot_checked', true);
    app.store().set(DIRTY, true);
  }
  if (app.store().get(DIRTY) !== true) return { fired: false, reason: 'idle' };
  // `updated` moves when a receipt is (re)queued, so a retry counts as new.
  const waiting = app.findRecordsByFilter('receipts', 'status = "waiting"', '-updated', 1, 0);
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
  const trig = require(`${__hooks}/_triggers_lib.js`);
  const res = trig.fire(app, 'receipts_waiting', {}, 'hook');
  if (res && res.ok) {
    app.store().set(FIRED_AT, Date.now());
    app.store().set(DIRTY, false);
    return { fired: true };
  }
  // Refused (cooldown, hourly cap): the flag stays set and the cron retries.
  return { fired: false, reason: (res && res.message) || 'refused' };
}

/** Note that a receipt is being read (checked by settleStale). */
function markReading(app) {
  app.store().set(READING, true);
}

/** PocketBase datetime text, comparable with `created` / `updated` in filters. */
function pbTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/**
 * Fail a receipt that is still reading and has no expense. Checked inside
 * the transaction, so a receipts.complete that lands first always wins.
 */
function failIfReading(app, id, reason) {
  let changed = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('receipts', id);
    if (r.getString('status') !== 'reading') return;
    if (tx.findRecordsByFilter('expenses', 'receipt = {:r}', '', 1, 0, { r: id }).length > 0) return;
    r.set('status', 'failed');
    r.set('error', reason);
    tx.save(r);
    changed = true;
  });
  return changed;
}

/**
 * Fail receipts the AI agent left reading: taken at least QUIET_MINUTES ago
 * while the agent has not called the app since (its run ended without
 * recording them), or taken STALE_MINUTES ago whatever the agent is doing.
 * Safe to call every minute: it reads the database only while a receipt is
 * being read, and once after a start.
 */
function settleStale(app) {
  const u = require(`${__hooks}/lib_util.js`);
  if (app.store().get('et_receipts_reading_boot') !== true) {
    app.store().set('et_receipts_reading_boot', true);
    app.store().set(READING, true);
  }
  if (app.store().get(READING) !== true) return 0;
  const now = Date.now();
  const quiet = now - Number(app.store().get(u.AGENT_SEEN) || 0) >= QUIET_MINUTES * 60 * 1000;
  const quietCut = pbTime(now - QUIET_MINUTES * 60 * 1000);
  const staleCut = pbTime(now - STALE_MINUTES * 60 * 1000);
  const reading = app.findRecordsByFilter('receipts', "status = 'reading'", '', 0, 0);
  let n = 0;
  for (const r of reading) {
    const taken = r.getString('updated');
    if ((taken < staleCut || (quiet && taken < quietCut)) && failIfReading(app, r.id, STOPPED_REASON)) n++;
  }
  if (n === reading.length) app.store().set(READING, false);
  return n;
}

module.exports = {
  filePath: filePath,
  serialize: serialize,
  expenseLinks: expenseLinks,
  mustGet: mustGet,
  fileFromLocalPath: fileFromLocalPath,
  store: store,
  markDirty: markDirty,
  fireIfNeeded: fireIfNeeded,
  markReading: markReading,
  settleStale: settleStale,
};
