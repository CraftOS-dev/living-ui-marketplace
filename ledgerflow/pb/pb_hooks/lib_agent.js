/// <reference path="../pb_data/types.d.ts" />
/**
 * Work handed to the AI agent, and how it always comes to an end.
 *
 *   lines   imported bank lines with no confident suggestion: the agent
 *           proposes a category, a match or a transfer with its reason.
 *           waiting -> working (inbox.queue) -> done (inbox.propose)
 *   files   receipts and documents dropped in: the agent reads them, links
 *           them to entries or drafts bills. waiting -> working -> done | failed
 *   asks    questions, report explanations and reviews the person sends.
 *           waiting -> working -> done (answer) | failed (reason)
 *   close   a month the person asked the agent to prepare for close.
 *           waiting -> working -> done (agent_note) | failed
 *
 * One trigger per queue drains everything waiting, so several asks cost one
 * agent run. A fire refused by the trigger cooldown stays marked and the
 * minute cron asks again; in-memory flags keep the cron off the database
 * when nothing is pending. Work the agent took and left (its run ended) is
 * handed back after QUIET_MINUTES of silence or STALE_MINUTES.
 */

const QUIET_MINUTES = 4;
const STALE_MINUTES = 25;

const QUEUES = {
  lines: { collection: 'statement_lines', trigger: 'lines_imported', state: 'agent_state', at: 'updated', busy: 'working', fail: '' },
  files: { collection: 'files', trigger: 'documents_received', state: 'agent_state', at: 'agent_at', busy: 'working', fail: 'failed', stopped: 'Your AI agent stopped before reading this file.' },
  asks: { collection: 'asks', trigger: 'agent_asked', state: 'status', at: 'requested_at', busy: 'working', fail: 'failed', stopped: 'Your AI agent stopped before answering. Ask again.' },
  close: { collection: 'periods', trigger: 'close_requested', state: 'agent_state', at: 'agent_at', busy: 'working', fail: 'failed', stopped: 'Your AI agent stopped before finishing the close review. Ask again.' },
};

function key(q, name) {
  return 'lf_q_' + q + '_' + name;
}

function markDirty(app, q) {
  app.store().set(key(q, 'dirty'), true);
}

function markBusy(app, q) {
  app.store().set(key(q, 'busy'), true);
}

/** Ask the AI agent about waiting work if anything was queued since the last ask. */
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
  const newest = Date.parse(String(waiting[0].getString(def.at) || waiting[0].getString('updated')).replace(' ', 'T'));
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

/** Queue work and ask now (outside any transaction). */
function nudge(app, q) {
  markDirty(app, q);
  try {
    return fireIfNeeded(app, q);
  } catch (err) {
    console.error('[ledgerflow] asking the AI agent failed:', q, err);
    return { fired: false, reason: 'error' };
  }
}

/** The agent takes a waiting item. */
function start(app, q, rec) {
  const def = QUEUES[q];
  const state = rec.getString(def.state);
  if (state !== 'waiting' && state !== def.busy) throw require(`${__hooks}/lib_util.js`).fail(409, 'This is not waiting for you (state: ' + (state || 'none') + ')');
  rec.set(def.state, def.busy);
  if (def.at !== 'updated') rec.set(def.at, new Date().toISOString());
  app.save(rec);
  markBusy(app, q);
}

function handBack(app, q, id) {
  const def = QUEUES[q];
  let changed = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById(def.collection, id);
    if (r.getString(def.state) !== def.busy) return;
    r.set(def.state, def.fail);
    if (q === 'asks') r.set('error', def.stopped);
    if (q === 'files') r.set('note', def.stopped);
    if (q === 'close') r.set('agent_note', def.stopped);
    tx.save(r);
    changed = true;
  });
  return changed;
}

/** Hand back work the agent left behind (see the header). */
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
    const taken = String(r.getString(def.at) || r.getString('updated')).replace('T', ' ');
    if ((taken < staleCut || (quiet && taken < quietCut)) && handBack(app, q, r.id)) n++;
  }
  if (n === busy.length) app.store().set(key(q, 'busy'), false);
  return n;
}

/* -------------------------------------------------------------------- asks */

function serializeAsk(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    kind: rec.getString('kind') || 'question',
    status: rec.getString('status'),
    question: rec.getString('question'),
    context: u.json(rec, 'context', null),
    answer: rec.getString('answer'),
    links: u.json(rec, 'links', []) || [],
    error: rec.getString('error'),
    requested_at: rec.getString('requested_at'),
    run: rec.getString('run'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function mustAsk(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'asks', id);
  if (!rec) throw u.fail(404, 'No ask ' + id + '; see asks.list');
  return rec;
}

function ask(app, kind, question, context) {
  const rec = new Record(app.findCollectionByNameOrId('asks'));
  rec.set('kind', kind);
  rec.set('status', 'waiting');
  rec.set('question', String(question || '').slice(0, 4000));
  rec.set('context', context || null);
  rec.set('requested_at', new Date().toISOString());
  app.save(rec);
  return rec;
}

/** Mark imported lines without a confident suggestion as waiting for the agent. */
function queueLines(app, lines) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  if (!s.getBool('agent_categorize')) return 0;
  let n = 0;
  for (const l of lines) {
    let line = l;
    try {
      line = app.findRecordById('statement_lines', l.id);
    } catch {
      continue;
    }
    const st = line.getString('status');
    if (st !== 'new' && st !== 'proposed') continue;
    const sug = u.json(line, 'suggestion', null);
    if (sug && (sug.confidence === 'high' || sug.by === 'user' || sug.by === 'agent' || sug.method === 'rule')) continue;
    if (line.getString('agent_state') === 'waiting' || line.getString('agent_state') === 'working') continue;
    line.set('agent_state', 'waiting');
    app.save(line);
    n++;
  }
  return n;
}

module.exports = {
  QUEUES: QUEUES,
  markDirty: markDirty,
  fireIfNeeded: fireIfNeeded,
  nudge: nudge,
  start: start,
  settleStale: settleStale,
  serializeAsk: serializeAsk,
  mustAsk: mustAsk,
  ask: ask,
  queueLines: queueLines,
};
