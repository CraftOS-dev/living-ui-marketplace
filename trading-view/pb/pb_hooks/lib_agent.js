/// <reference path="../pb_data/types.d.ts" />
/**
 * Work handed to the AI agent, and how it always comes to an end.
 *
 *   analysis  the person asks for a read of a chart (optionally with a
 *             question) or a review of a whole watchlist. Life cycle on the
 *             analyses row: waiting -> working (the agent took it) -> done
 *             (summary, bias, key levels, chart markup) or failed (reason).
 *   alert     an alert set to notify the agent fired. Life cycle on the
 *             alert_events row: waiting -> done (the agent's note on what
 *             happened and what to watch) or failed.
 *
 * One trigger per queue drains everything waiting, so several asks cost one
 * agent run. A fire refused by the trigger cooldown stays marked and the
 * minute cron asks again; in-memory flags keep the cron off the database
 * when nothing is pending. Work the agent took and left (its run ended) is
 * failed with a reason after QUIET_MINUTES of silence or STALE_MINUTES.
 */

const QUIET_MINUTES = 4;
const STALE_MINUTES = 25;

const QUEUES = {
  analysis: {
    collection: 'analyses',
    trigger: 'analysis_requested',
    state: 'state',
    at: 'requested_at',
    busy: 'working',
    stopped: 'Your AI agent stopped before finishing this analysis. Ask again.',
  },
  alert: {
    collection: 'alert_events',
    trigger: 'alert_fired',
    state: 'agent_state',
    at: 'agent_at',
    busy: 'working',
    stopped: 'Your AI agent did not get to this alert.',
  },
};

function key(q, name) {
  return 'tv_q_' + q + '_' + name;
}

function markDirty(app, q) {
  app.store().set(key(q, 'dirty'), true);
}

function markBusy(app, q) {
  app.store().set(key(q, 'busy'), true);
}

/** Ask the AI agent about waiting work if anything was asked since the last fire. */
function fireIfNeeded(app, q) {
  const def = QUEUES[q];
  if (app.store().get(key(q, 'boot')) !== true) {
    app.store().set(key(q, 'boot'), true);
    app.store().set(key(q, 'dirty'), true);
  }
  if (app.store().get(key(q, 'dirty')) !== true) return { fired: false, reason: 'idle' };
  const waiting = app.findRecordsByFilter(def.collection, def.state + " = 'waiting'", '-' + def.at, 1, 0);
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

/** The agent takes a waiting item. */
function start(app, q, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const def = QUEUES[q];
  const state = rec.getString(def.state);
  if (state !== 'waiting' && state !== def.busy) throw u.fail(409, 'This is not waiting for you (state: ' + (state || 'none') + ')');
  rec.set(def.state, def.busy);
  rec.set(def.at, new Date().toISOString());
  app.save(rec);
  markBusy(app, q);
}

function failIfBusy(app, q, id, reason) {
  const def = QUEUES[q];
  let changed = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById(def.collection, id);
    const st = r.getString(def.state);
    if (st !== def.busy && !(q === 'alert' && st === 'waiting')) return;
    r.set(def.state, 'failed');
    if (q === 'analysis') r.set('error', reason);
    else r.set('agent_note', reason);
    tx.save(r);
    changed = true;
  });
  return changed;
}

/** Fail work the agent left behind (see the header). */
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
  // Alert reactions nobody picked up within a day are closed too.
  if (q === 'alert') {
    const old = app.findRecordsByFilter('alert_events', "agent_state = 'waiting' && agent_at < {:c}", '', 200, 0, { c: u.pbTime(now - 24 * 3600 * 1000) });
    for (const r of old) failIfBusy(app, q, r.id, 'No AI agent picked this alert up within a day.');
  }
  if (n === busy.length) app.store().set(key(q, 'busy'), false);
  return n;
}

/* ---------------------------------------------------------------- analyses */

function serializeAnalysis(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    kind: rec.getString('kind') || 'symbol',
    symbol: rec.getString('symbol'),
    watchlist: rec.getString('watchlist'),
    interval: rec.getString('interval'),
    state: rec.getString('state'),
    focus: rec.getString('focus'),
    summary: rec.getString('summary'),
    bias: rec.getString('bias'),
    levels: u.json(rec, 'levels', []) || [],
    facts: u.json(rec, 'facts', null),
    error: rec.getString('error'),
    requested_at: rec.getString('requested_at'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function mustAnalysis(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'analyses', id);
  if (!rec) throw u.fail(404, 'No analysis ' + id + '; see analyses.list');
  return rec;
}

/**
 * Ask for an analysis. A waiting ask for the same thing is reused (its
 * question updated) instead of queueing a second one.
 */
function requestAnalysis(app, a) {
  const kind = a.watchlist ? 'watchlist' : 'symbol';
  const filter = kind === 'watchlist' ? "state = 'waiting' && watchlist = {:w}" : "state = 'waiting' && symbol = {:s} && interval = {:i}";
  const same = app.findRecordsByFilter('analyses', filter, '', 1, 0, { w: a.watchlist || '', s: a.symbol || '', i: a.interval || '' });
  const rec = same.length > 0 ? same[0] : new Record(app.findCollectionByNameOrId('analyses'));
  rec.set('kind', kind);
  rec.set('symbol', a.symbol || '');
  rec.set('watchlist', a.watchlist || '');
  rec.set('interval', a.interval || '');
  rec.set('state', 'waiting');
  rec.set('focus', String(a.focus || '').slice(0, 1000));
  rec.set('error', '');
  rec.set('requested_at', new Date().toISOString());
  rec.set('added_by', a.actor || 'user');
  app.save(rec);
  markDirty(app, 'analysis');
  const fired = fireIfNeeded(app, 'analysis');
  return { analysis: serializeAnalysis(rec), asked: fired.fired === true || fired.reason === 'already asked', reason: fired.fired ? '' : fired.reason || '' };
}

module.exports = {
  QUEUES: QUEUES,
  markDirty: markDirty,
  fireIfNeeded: fireIfNeeded,
  start: start,
  settleStale: settleStale,
  serializeAnalysis: serializeAnalysis,
  mustAnalysis: mustAnalysis,
  requestAnalysis: requestAnalysis,
};
