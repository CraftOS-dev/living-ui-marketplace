/// <reference path="../pb_data/types.d.ts" />
/**
 * Work handed to the AI agent, and how it always comes to an end.
 *
 *   Digests  a card (link, document, video, image, quote, note) the person
 *            wants summarized. Life cycle on the card: waiting (asked) ->
 *            reading (the AI agent took it) -> done (digest written) or
 *            failed (with a reason the person can act on).
 *   Reviews  a board the person wants reviewed: the AI agent reads every
 *            card, adds what is missing as notes, proposes links (dashed
 *            until confirmed) and leaves a short review. Life cycle on the
 *            board: waiting -> working -> done or failed.
 *
 * One trigger per queue (`digests_waiting`, `reviews_waiting`) drains every
 * waiting item, so several asks cost one agent run. Triggers have a
 * cooldown: a fire refused for timing stays marked and the minute cron asks
 * again; an in-memory flag keeps the cron off the database when nothing is
 * pending (never a blind poll).
 *
 * Settling: an item the AI agent took always ends done or failed. The same
 * cron fails one the agent left behind once the agent has not called the
 * app for QUIET_MINUTES (its run is over), or after STALE_MINUTES in any
 * case. The app never reads the agent's request queue: that is the agent's
 * surface. A completion that arrives later still records the work.
 */

const QUIET_MINUTES = 4;
const STALE_MINUTES = 20;

const QUEUES = {
  digest: {
    collection: 'cards',
    trigger: 'digests_waiting',
    state: 'digest_state',
    at: 'digest_at',
    busy: 'reading',
    extra: " && trashed = ''",
    stopped: 'Your AI agent stopped before writing the summary. Ask again.',
  },
  review: {
    collection: 'boards',
    trigger: 'reviews_waiting',
    state: 'review_state',
    at: 'review_at',
    busy: 'working',
    extra: '',
    stopped: 'Your AI agent stopped before finishing the review. Ask again.',
  },
};

function key(q, name) {
  return 'rb_' + q + '_' + name;
}

function markDirty(app, q) {
  app.store().set(key(q, 'dirty'), true);
}

function markBusy(app, q) {
  app.store().set(key(q, 'busy'), true);
}

/**
 * Ask the AI agent about waiting items if any were asked since the last
 * successful fire. Safe to call often: it does nothing unless marked dirty.
 */
function fireIfNeeded(app, q) {
  const def = QUEUES[q];
  if (app.store().get(key(q, 'boot')) !== true) {
    // First tick after a start: an ask may have been lost with the restart.
    app.store().set(key(q, 'boot'), true);
    app.store().set(key(q, 'dirty'), true);
  }
  if (app.store().get(key(q, 'dirty')) !== true) return { fired: false, reason: 'idle' };
  const waiting = app.findRecordsByFilter(def.collection, def.state + " = 'waiting'" + def.extra, '-' + def.at, 1, 0);
  if (waiting.length === 0) {
    app.store().set(key(q, 'dirty'), false);
    return { fired: false, reason: 'nothing waiting' };
  }
  const newest = Date.parse(waiting[0].getString(def.at).replace(' ', 'T'));
  const last = Number(app.store().get(key(q, 'fired_at')) || 0);
  if (last > 0 && newest <= last) {
    app.store().set(key(q, 'dirty'), false);
    return { fired: false, reason: 'already asked', request: String(app.store().get(key(q, 'request')) || '') };
  }
  const trig = require(`${__hooks}/_triggers_lib.js`);
  const res = trig.fire(app, def.trigger, {}, 'hook');
  if (res && res.ok) {
    app.store().set(key(q, 'fired_at'), Date.now());
    app.store().set(key(q, 'request'), res.id);
    app.store().set(key(q, 'dirty'), false);
    return { fired: true, request: res.id };
  }
  return { fired: false, reason: (res && res.message) || 'refused' };
}

/** Put a card or board in the queue and ask the AI agent. Returns the record after saving. */
function request(app, q, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const def = QUEUES[q];
  if (rec.getString(def.state) === def.busy) throw u.fail(409, 'Your AI agent is already working on this');
  rec.set(def.state, 'waiting');
  rec.set(def.at, new Date().toISOString());
  if (q === 'digest') rec.set('digest_error', '');
  else rec.set('review_note', '');
  app.save(rec);
  markDirty(app, q);
  const fired = fireIfNeeded(app, q);
  if (q === 'review' && fired.request) {
    rec.set('review_request', fired.request);
    app.save(rec);
  }
  return { asked: fired.fired === true || fired.reason === 'already asked', request: fired.request || '' };
}

/** The AI agent takes an item. */
function start(app, q, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const def = QUEUES[q];
  const state = rec.getString(def.state);
  if (state !== 'waiting' && state !== def.busy) {
    throw u.fail(409, 'Nothing is waiting for this ' + (q === 'digest' ? 'card; see digests.list' : 'board; see reviews.list'));
  }
  rec.set(def.state, def.busy);
  rec.set(def.at, new Date().toISOString());
  app.save(rec);
  markBusy(app, q);
}

/** Cancel a waiting ask (the person changed their mind). */
function cancel(app, q, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const def = QUEUES[q];
  if (rec.getString(def.state) !== 'waiting') throw u.fail(409, 'Only a waiting ask can be cancelled');
  rec.set(def.state, q === 'digest' && rec.getString('digest') !== '' ? 'done' : '');
  app.save(rec);
}

function failIfBusy(app, q, id, reason) {
  const def = QUEUES[q];
  let changed = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById(def.collection, id);
    if (r.getString(def.state) !== def.busy) return;
    r.set(def.state, 'failed');
    if (q === 'digest') r.set('digest_error', reason);
    else r.set('review_note', reason);
    tx.save(r);
    changed = true;
  });
  return changed;
}

/** Fail items the AI agent left busy (see the header). Cheap when nothing is busy. */
function settleStale(app, q) {
  const u = require(`${__hooks}/lib_util.js`);
  const def = QUEUES[q];
  if (app.store().get(key(q, 'busy_boot')) !== true) {
    app.store().set(key(q, 'busy_boot'), true);
    app.store().set(key(q, 'busy'), true);
  }
  if (app.store().get(key(q, 'busy')) !== true) return 0;
  const now = Date.now();
  const quiet = now - Number(app.store().get(u.AGENT_SEEN) || 0) >= QUIET_MINUTES * 60 * 1000;
  const quietCut = u.pbTime(now - QUIET_MINUTES * 60 * 1000);
  const staleCut = u.pbTime(now - STALE_MINUTES * 60 * 1000);
  const busy = app.findRecordsByFilter(def.collection, def.state + " = '" + def.busy + "'", '', 0, 0);
  let n = 0;
  for (const r of busy) {
    const taken = r.getString(def.at);
    if ((taken < staleCut || (quiet && taken < quietCut)) && failIfBusy(app, q, r.id, def.stopped)) n++;
  }
  if (n === busy.length) app.store().set(key(q, 'busy'), false);
  return n;
}

module.exports = {
  QUEUES: QUEUES,
  markDirty: markDirty,
  fireIfNeeded: fireIfNeeded,
  request: request,
  start: start,
  cancel: cancel,
  settleStale: settleStale,
};
