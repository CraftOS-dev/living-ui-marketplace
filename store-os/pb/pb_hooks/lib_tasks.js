/// <reference path="../pb_data/types.d.ts" />
/**
 * Work handed to your AI agent.
 *
 * Every job (sync a shop, prepare listings, draft or send a reply, check
 * tracking, help with a setup step, answer your message) is a task row. The
 * app asks your AI agent with ONE trigger, work_requested, covering every
 * task waiting at that moment; your AI agent lists the tasks, does each by
 * the recipe for its kind (app.guide) and finishes it. Batching keeps within
 * the platform's limits (one fire per 10 seconds, 30 an hour): a task queued
 * while the trigger is cooling down waits, and the minute job asks again.
 *
 *   queued   waiting to be asked
 *   asked    in a request your AI agent has not started yet
 *   working  your AI agent started it
 *   done | failed | cancelled
 *
 * A task asked 30 minutes ago and never started goes back to the queue; one
 * started three hours ago and never finished is marked failed, so nothing
 * stays "in progress" forever.
 */

const KINDS = ['sync', 'publish', 'push_stock', 'setup_help', 'prepare_listing', 'draft_reply', 'send_reply', 'tracking', 'exception', 'chat'];
const OPEN = ['queued', 'asked', 'working'];
const ASK_AGAIN_MIN = 30;
const GIVE_UP_HOURS = 3;

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function view(r) {
  const U = L('lib_util');
  return {
    id: r.id,
    kind: r.getString('kind'),
    target: r.getString('target'),
    label: r.getString('label'),
    params: U.json(r, 'params', {}),
    state: r.getString('state'),
    request: r.getString('request'),
    note: r.getString('note'),
    by: r.getString('by'),
    asked_at: r.getString('asked_at'),
    started_at: r.getString('started_at'),
    done_at: r.getString('done_at'),
    created: r.getString('created'),
  };
}

/** The open task for a target (and kind), or null. */
function openFor(app, target, kind) {
  const U = L('lib_util');
  const filter = "target = {:t} && (state = 'queued' || state = 'asked' || state = 'working')" + (kind ? ' && kind = {:k}' : '');
  return U.findOne(app, 'tasks', filter, { t: target, k: kind || '' });
}

/** Open tasks by target, for list views: { 'shop:abc': {kind, state, id}, ... }. */
function openMap(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('tasks', "state = 'queued' || state = 'asked' || state = 'working'", 'created', 0, 0)) {
    out[r.getString('target')] = { id: r.id, kind: r.getString('kind'), state: r.getString('state'), label: r.getString('label') };
  }
  return out;
}

/**
 * Queue a task (the same open task for the same target and kind is reused,
 * with the newest parameters) and ask your AI agent when it can be asked.
 */
function queue(app, kind, target, label, params, by) {
  const U = L('lib_util');
  if (KINDS.indexOf(kind) < 0) throw new Error('unknown task kind ' + kind);
  let rec = openFor(app, target, kind);
  if (rec === null) {
    rec = U.newRecord(app, 'tasks');
    rec.set('kind', kind);
    rec.set('target', target);
    rec.set('state', 'queued');
    rec.set('by', by || 'person');
  }
  rec.set('label', U.clip(label, 300));
  rec.set('params', params || {});
  app.save(rec);
  ask(app);
  return view(U.byId(app, 'tasks', rec.id));
}

/** Ask your AI agent about every queued task, in one request. Quietly waits on a cooldown. */
function ask(app) {
  const U = L('lib_util');
  const waiting = app.findRecordsByFilter('tasks', "state = 'queued'", 'created', 0, 0);
  if (waiting.length === 0) return null;
  const trig = require(`${__hooks}/_triggers_lib.js`);
  const r = trig.fire(app, 'work_requested', { count: waiting.length }, 'hook');
  if (!r.ok) {
    if (r.code !== 'cooldown' && r.code !== 'rate_capped') console.log('[store] could not ask your AI agent: ' + (r.message || r.code));
    return null;
  }
  const now = U.now();
  for (const t of waiting) {
    t.set('state', 'asked');
    t.set('request', r.id);
    t.set('asked_at', now);
    app.save(t);
  }
  return r.id;
}

/** The minute job: ask again for waiting tasks, re-queue forgotten ones, close abandoned ones. */
function tick(app) {
  const U = L('lib_util');
  const askedBefore = new Date(Date.now() - ASK_AGAIN_MIN * 60000).toISOString();
  for (const t of app.findRecordsByFilter('tasks', "state = 'asked' && asked_at < {:t}", 'created', 0, 0, { t: askedBefore })) {
    t.set('state', 'queued');
    app.save(t);
  }
  const startedBefore = new Date(Date.now() - GIVE_UP_HOURS * 3600000).toISOString();
  for (const t of app.findRecordsByFilter('tasks', "state = 'working' && started_at < {:t}", 'created', 0, 0, { t: startedBefore })) {
    t.set('state', 'failed');
    t.set('note', 'Your AI agent stopped before finishing. Ask again.');
    t.set('done_at', U.now());
    app.save(t);
  }
  ask(app);
}

function ref(app, id) {
  const U = L('lib_util');
  const r = U.byId(app, 'tasks', String(id || ''));
  if (r === null) throw U.fail(404, 'No task ' + id + '. Run tasks.list.', 'not_found');
  return r;
}

/** Close the open task of `kind` on `target` (used when the work itself says it is done). */
function finishFor(app, target, kind, note, failed) {
  const U = L('lib_util');
  const r = openFor(app, target, kind);
  if (r === null) return;
  r.set('state', failed ? 'failed' : 'done');
  r.set('note', U.clip(note || '', 4000));
  r.set('done_at', U.now());
  app.save(r);
}

/* ------------------------------------------------------------------- ops */

function list(ctx, p) {
  const app = ctx.app;
  const states = p.state === 'all' ? null : p.state ? [p.state] : OPEN;
  const rows = app.findRecordsByFilter('tasks', states === null ? '1=1' : states.map((s) => "state = '" + s + "'").join(' || '), 'created', Math.min(Math.max(Math.round(p.limit || 50), 1), 200), 0).map(view);
  return { tasks: rows, recipes: 'app.guide gives the recipe for each kind; run tasks.start before and tasks.finish after each task.' };
}

function recent(ctx, p) {
  const rows = ctx.app.findRecordsByFilter('tasks', '1=1', '-created', Math.min(Math.max(Math.round(p.limit || 30), 1), 100), 0).map(view);
  return { tasks: rows };
}

function get(ctx, p) {
  return { task: view(ref(ctx.app, p.task)) };
}

function start(ctx, p) {
  const U = L('lib_util');
  const r = ref(ctx.app, p.task);
  if (OPEN.indexOf(r.getString('state')) < 0) throw U.fail(409, 'This task is already ' + r.getString('state') + '.', 'conflict');
  r.set('state', 'working');
  r.set('started_at', U.now());
  ctx.app.save(r);
  return { task: view(r) };
}

function finish(ctx, p) {
  const U = L('lib_util');
  const r = ref(ctx.app, p.task);
  if (OPEN.indexOf(r.getString('state')) < 0) throw U.fail(409, 'This task is already ' + r.getString('state') + '.', 'conflict');
  r.set('state', p.failed === true ? 'failed' : 'done');
  r.set('note', U.clip(p.note || '', 4000));
  r.set('done_at', U.now());
  ctx.app.save(r);
  L('lib_store').log(ctx.app, ctx.actor, (p.failed === true ? 'Could not finish: ' : 'Finished: ') + r.getString('label') + (p.note ? ' (' + U.clip(p.note, 160) + ')' : ''), r.getString('target'));
  return { task: view(r) };
}

function cancel(ctx, p) {
  const U = L('lib_util');
  const r = ref(ctx.app, p.task);
  if (OPEN.indexOf(r.getString('state')) < 0) return { task: view(r) };
  r.set('state', 'cancelled');
  r.set('done_at', U.now());
  ctx.app.save(r);
  return { task: view(r) };
}

/* ------------------------------------------------------------------ chats */

function chatView(r) {
  return { id: r.id, text: r.getString('text'), reply: r.getString('reply'), state: r.getString('state'), task: r.getString('task'), context: r.getString('context'), created: r.getString('created'), updated: r.getString('updated') };
}

function chats(ctx, p) {
  const limit = Math.min(Math.max(Math.round(p.limit || 30), 1), 200);
  const rows = ctx.app.findRecordsByFilter('chats', '1=1', '-created', limit, 0).map(chatView);
  rows.reverse();
  return { chats: rows };
}

function chatSend(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const text = String(p.text || '').trim();
  if (text === '') throw U.fail(400, 'Write what to tell your AI agent.', 'missing_param', { param: 'text' });
  const rec = U.newRecord(app, 'chats');
  rec.set('text', U.clip(text, 4000));
  rec.set('state', 'sent');
  rec.set('context', U.clip(p.context || '', 200));
  app.save(rec);
  const t = queue(app, 'chat', 'chat:' + rec.id, 'Answer: ' + U.clip(text, 120), { chat: rec.id, context: rec.getString('context') }, 'person');
  rec.set('task', t.id);
  app.save(rec);
  return { chat: chatView(rec) };
}

function chatReply(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const rec = U.byId(app, 'chats', String(p.chat || ''));
  if (rec === null) throw U.fail(404, 'No message ' + p.chat + '. Run chats.list.', 'not_found');
  rec.set('reply', U.clip(String(p.text || '').trim(), 6000));
  rec.set('state', 'answered');
  app.save(rec);
  finishFor(app, 'chat:' + rec.id, 'chat', 'Answered');
  return { chat: chatView(rec) };
}

module.exports = {
  KINDS: KINDS,
  OPEN: OPEN,
  view: view,
  openFor: openFor,
  openMap: openMap,
  queue: queue,
  ask: ask,
  tick: tick,
  finishFor: finishFor,
  list: list,
  recent: recent,
  get: get,
  start: start,
  finish: finish,
  cancel: cancel,
  chats: chats,
  chatSend: chatSend,
  chatReply: chatReply,
};
