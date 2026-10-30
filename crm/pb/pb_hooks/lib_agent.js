/// <reference path="../pb_data/types.d.ts" />
/**
 * Work handed to the AI agent, and how it always comes to an end.
 *
 *   asks      questions and jobs the person sends (research, a draft, an
 *             import from email, a brief, a report to explain)
 *             waiting -> working (asks.start) -> done (asks.answer) | failed
 *   research  people and companies to research: fill empty fields with
 *             sources, propose changes to the person's values
 *             waiting -> working (research.queue) -> done (research.done) | failed
 *   meetings  meetings and calls logged with notes: propose deal updates,
 *             add follow-up tasks, draft a follow-up email
 *             waiting -> working (meetings.queue) -> done (meetings.done)
 *   emails    emails the person sent from the CRM, for the agent to send
 *             queued -> sending (emails.start) -> sent | failed
 *
 * One trigger per queue drains everything waiting, so several items cost one
 * agent run. A fire refused by the trigger cooldown stays marked and the
 * minute cron asks again; in-memory flags keep the cron off the database
 * when nothing is pending. Work the agent took and left (its run ended) is
 * handed back after QUIET_MINUTES of silence or STALE_MINUTES.
 */

const QUIET_MINUTES = 4;
const STALE_MINUTES = 25;

const QUEUES = {
  asks: { parts: [{ c: 'asks', state: 'status', at: 'requested_at' }], trigger: 'agent_asked', waiting: 'waiting', busy: 'working', fail: 'failed', stopped: 'Your AI agent stopped before finishing. Ask again.' },
  research: {
    parts: [
      { c: 'people', state: 'agent_state', at: 'updated' },
      { c: 'companies', state: 'agent_state', at: 'updated' },
    ],
    trigger: 'research_requested',
    waiting: 'waiting',
    busy: 'working',
    fail: 'failed',
    stopped: 'Your AI agent stopped before finishing the research.',
  },
  meetings: { parts: [{ c: 'interactions', state: 'agent_state', at: 'updated' }], trigger: 'interaction_logged', waiting: 'waiting', busy: 'working', fail: 'failed', stopped: 'Your AI agent stopped before reviewing this.' },
  emails: { parts: [{ c: 'emails', state: 'status', at: 'queued_at' }], trigger: 'emails_queued', waiting: 'queued', busy: 'sending', fail: 'failed', stopped: 'Your AI agent stopped before sending this email.' },
};

function key(q, name) {
  return 'cr_q_' + q + '_' + name;
}

function markDirty(app, q) {
  app.store().set(key(q, 'dirty'), true);
}

function markBusy(app, q) {
  app.store().set(key(q, 'busy'), true);
}

function newestWaiting(app, def) {
  let newest = 0;
  for (const part of def.parts) {
    const rows = app.findRecordsByFilter(part.c, part.state + " = '" + def.waiting + "'", '-' + part.at, 1, 0);
    if (rows.length === 0) continue;
    const t = Date.parse(String(rows[0].getString(part.at) || rows[0].getString('updated')).replace(' ', 'T'));
    if (isFinite(t) && t > newest) newest = t;
    if (!isFinite(t)) newest = Math.max(newest, 1);
  }
  return newest;
}

/** Ask the AI agent about waiting work if anything was queued since the last ask. */
function fireIfNeeded(app, q) {
  const def = QUEUES[q];
  if (app.store().get(key(q, 'boot')) !== true) {
    app.store().set(key(q, 'boot'), true);
    app.store().set(key(q, 'dirty'), true);
  }
  if (app.store().get(key(q, 'dirty')) !== true) return { fired: false, reason: 'idle' };
  const newest = newestWaiting(app, def);
  if (newest === 0) {
    app.store().set(key(q, 'dirty'), false);
    return { fired: false, reason: 'nothing waiting' };
  }
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
    console.error('[crm] asking the AI agent failed:', q, err);
    return { fired: false, reason: 'error' };
  }
}

function partOf(def, rec) {
  return def.parts.find((p) => p.c === rec.collection().name) || def.parts[0];
}

/** The agent takes a waiting item. */
function start(app, q, rec) {
  const def = QUEUES[q];
  const part = partOf(def, rec);
  const state = rec.getString(part.state);
  if (state !== def.waiting && state !== def.busy) throw require(`${__hooks}/lib_util.js`).fail(409, 'This is not waiting for you (state: ' + (state || 'none') + ')');
  rec.set(part.state, def.busy);
  if (part.at !== 'updated') rec.set(part.at, new Date().toISOString());
  app.save(rec);
  markBusy(app, q);
}

function handBack(app, q, c, id) {
  const def = QUEUES[q];
  const part = def.parts.find((p) => p.c === c);
  let changed = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById(c, id);
    if (r.getString(part.state) !== def.busy) return;
    r.set(part.state, def.fail);
    if (c === 'asks') r.set('error', def.stopped);
    else if (c === 'emails') r.set('error', def.stopped);
    else r.set('agent_note', def.stopped);
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
  let n = 0;
  let total = 0;
  for (const part of def.parts) {
    const busy = app.findRecordsByFilter(part.c, part.state + " = '" + def.busy + "'", '', 0, 0);
    total += busy.length;
    for (const r of busy) {
      const taken = String(r.getString(part.at) || r.getString('updated')).replace('T', ' ');
      if ((taken < staleCut || (quiet && taken < quietCut)) && handBack(app, q, part.c, r.id)) n++;
    }
  }
  if (n === total) app.store().set(key(q, 'busy'), false);
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

/** Mark people or companies as waiting for research. Returns how many were queued. */
function queueResearch(app, collection, ids, note) {
  let n = 0;
  for (const id of ids) {
    let r = null;
    try {
      r = app.findRecordById(collection, id);
    } catch {
      continue;
    }
    if (r.getString('deleted') !== '') continue;
    const st = r.getString('agent_state');
    if (st === 'waiting' || st === 'working') continue;
    r.set('agent_state', 'waiting');
    r.set('agent_note', String(note || '').slice(0, 500));
    app.save(r);
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
  queueResearch: queueResearch,
};
