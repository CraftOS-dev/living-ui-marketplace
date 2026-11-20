/// <reference path="../pb_data/types.d.ts" />
/**
 * Work handed to your AI agent.
 *
 * Every kind of work has its own trigger (lib_guide.js JOBS, written to
 * triggers.json). The seller's click, or an automatic event they switched on
 * in Settings, fires that trigger once with the record it is about: one fire
 * is one piece of work, and the request row in the platform's queue is its
 * unit and audit trail (pending, claimed, done or rejected). A task row is
 * the app's side of it: which record, which request, and how it ended. Your
 * AI agent opens its work with tasks.start --request <id>; the operation
 * that does the work closes it (inbox.draft, shops.sync-finish...), or
 * tasks.finish does.
 *
 *   asked    the trigger fired (request set), or it could not be sent
 *            (request empty, note says why)
 *   working  your AI agent started it
 *   done | failed | cancelled
 *
 * Nothing asks again on its own. A record has at most one open task of a
 * kind, so a repeat click while one waits fires nothing. A task that was not
 * sent, not picked up within 24 hours, or started and left for 3 hours shows
 * a Retry, which fires the same trigger once for that record.
 */

const OPEN = ['asked', 'working'];
const PICKUP_HOURS = 24;
const GIVE_UP_HOURS = 3;

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** kind -> trigger name, from the job definitions. */
function triggers() {
  const jobs = L('lib_guide').JOBS;
  const out = {};
  for (const name of Object.keys(jobs)) out[jobs[name].kind] = name;
  return out;
}

function kinds() {
  return Object.keys(triggers());
}

function hoursSince(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity;
}

/** Why an open task may be asked again: not_sent, not_picked_up, stopped; '' while it is fine. */
function staleOf(r) {
  const st = r.getString('state');
  if (st === 'asked') {
    if (r.getString('request') === '') return 'not_sent';
    if (hoursSince(r.getString('asked_at')) >= PICKUP_HOURS) return 'not_picked_up';
  } else if (st === 'working' && hoursSince(r.getString('started_at')) >= GIVE_UP_HOURS) return 'stopped';
  return '';
}

function view(r) {
  const U = L('lib_util');
  return {
    id: r.id,
    kind: r.getString('kind'),
    trigger: r.getString('trigger'),
    target: r.getString('target'),
    label: r.getString('label'),
    params: U.json(r, 'params', {}),
    state: r.getString('state'),
    stale: staleOf(r),
    request: r.getString('request'),
    requests: U.json(r, 'requests', []),
    note: r.getString('note'),
    by: r.getString('by'),
    asked_at: r.getString('asked_at'),
    started_at: r.getString('started_at'),
    done_at: r.getString('done_at'),
    created: r.getString('created'),
  };
}

function brief(r) {
  return { id: r.id, kind: r.getString('kind'), state: r.getString('state'), label: r.getString('label'), stale: staleOf(r) };
}

const OPEN_FILTER = "(state = 'asked' || state = 'working')";

// Kinds where one record holds several pieces of work: the param that tells them apart.
const SAME = { setup_help: 'step', send_reply: 'message' };

/** The open tasks of `kind` on `target` (setup help: of the same step; a send: of the same message), newest first. */
function openAll(app, target, kind, params) {
  const U = L('lib_util');
  const rows = Array.from(app.findRecordsByFilter('tasks', 'target = {:t} && kind = {:k} && ' + OPEN_FILTER, '-created', 0, 0, { t: target, k: kind }));
  const key = SAME[kind];
  if (!key || !params) return rows;
  return rows.filter((r) => String(U.json(r, 'params', {})[key] || '') === String(params[key] || ''));
}

/** The open task for a target (and kind), or null. */
function openFor(app, target, kind) {
  const U = L('lib_util');
  return U.findOne(app, 'tasks', 'target = {:t} && ' + OPEN_FILTER + (kind ? ' && kind = {:k}' : ''), { t: target, k: kind || '' });
}

/** Open tasks by target, for list views: { 'shop:abc': {id, kind, state, label, stale}, ... }. */
function openMap(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('tasks', OPEN_FILTER, 'created', 0, 0)) out[r.getString('target')] = brief(r);
  return out;
}

/** The trigger's params for tasks of one kind asked together, from their stored params. */
function fireParams(app, kind, list) {
  const U = L('lib_util');
  const first = list[0] || {};
  const ids = (key, many) => {
    const out = [];
    for (const p of list) for (const v of Array.isArray(p[many]) ? p[many] : [p[key]]) if (v && out.indexOf(String(v)) < 0) out.push(String(v));
    return out.join(',');
  };
  let out;
  if (kind === 'sync' || kind === 'push_stock') out = { shop_id: first.shop };
  else if (kind === 'setup_help') out = { shop_id: first.shop, step: first.step, note: first.note };
  else if (kind === 'prepare_listing') out = { product_id: first.product, shop_ids: (first.shops || []).join(','), note: first.note };
  else if (kind === 'publish') out = { shop_id: first.shop, listing_ids: (first.listings || []).map((l) => (typeof l === 'string' ? l : l.id)).join(',') };
  else if (kind === 'draft_reply') out = { thread_ids: ids('thread'), note: list.length === 1 ? first.note : '' };
  else if (kind === 'send_reply') out = { thread_id: first.thread, message_id: first.message };
  else if (kind === 'tracking') out = { order_ids: ids('order', 'orders') };
  else if (kind === 'exception') out = { order_id: first.order, note: first.note };
  else if (kind === 'chat') {
    const c = U.byId(app, 'chats', String(first.chat || ''));
    out = { chat_id: first.chat, question: c !== null ? U.clip(c.getString('text'), 2000) : String(first.question || '') };
  } else throw new Error('unknown task kind ' + kind);
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null || (out[k] === '' && k === 'note')) delete out[k];
  for (const k of Object.keys(out)) out[k] = String(out[k]);
  return out;
}

function notSent(r) {
  const m = String((r && r.message) || '').match(/retry in (\d+)s/);
  if (r && r.code === 'cooldown') return 'Not sent: your AI agent was asked for this kind of work moments ago. Retry ' + (m ? 'in ' + m[1] + ' seconds' : 'shortly') + '.';
  if (r && r.code === 'rate_capped') return 'Not sent: your AI agent was asked for this kind of work 30 times in the last hour. Retry later.';
  return 'Not sent: the request was refused (' + ((r && r.code) || 'error') + '). Retry later.';
}

/** Fire the kind's trigger once for these tasks (params: each task's stored params) and record the outcome on them. */
function send(app, kind, recs, params) {
  const U = L('lib_util');
  const trigger = triggers()[kind];
  const r = require(`${__hooks}/_triggers_lib.js`).fire(app, trigger, fireParams(app, kind, params), 'hook');
  const now = U.now();
  for (const t of recs) {
    t.set('trigger', trigger);
    t.set('state', 'asked');
    t.set('started_at', '');
    if (r.ok) {
      const seen = U.json(t, 'requests', []);
      seen.push(r.id);
      t.set('requests', seen.slice(-20));
      t.set('request', r.id);
      t.set('asked_at', now);
      t.set('note', '');
    } else {
      t.set('request', '');
      t.set('asked_at', '');
      t.set('note', notSent(r));
    }
    app.save(t);
  }
  if (!r.ok && r.code !== 'cooldown' && r.code !== 'rate_capped') console.log('[store] could not ask your AI agent (' + trigger + '): ' + (r.message || r.code));
  return r;
}

/**
 * Ask your AI agent for work of one kind on one or more records (items:
 * [{target, label, params}], one task each), with ONE fire of the kind's
 * trigger. A record whose task of this kind is still waiting or being worked
 * on is left out, so a repeat fires nothing; one whose task is stale is asked
 * again on the same task. by: person, agent or auto.
 */
function ask(app, kind, items, by) {
  const U = L('lib_util');
  if (kinds().indexOf(kind) < 0) throw new Error('unknown task kind ' + kind);
  const fresh = [];
  const params = [];
  const waiting = [];
  for (const it of items) {
    let rec = openAll(app, it.target, kind, it.params)[0] || null;
    if (rec !== null && staleOf(rec) === '') {
      waiting.push(rec);
      continue;
    }
    if (rec === null) {
      rec = U.newRecord(app, 'tasks');
      rec.set('kind', kind);
      rec.set('target', it.target);
      rec.set('by', by || 'person');
      rec.set('requests', []);
    }
    rec.set('label', U.clip(it.label, 300));
    rec.set('params', it.params || {});
    fresh.push(rec);
    params.push(it.params || {});
  }
  if (fresh.length === 0) {
    const working = waiting.some((r) => r.getString('state') === 'working');
    return { task: waiting.length > 0 ? view(waiting[0]) : null, tasks: waiting.map(view), asked: false, already: true, message: working ? 'Your AI agent is already working on this.' : 'Your AI agent was already asked for this and has not picked it up yet.' };
  }
  const r = send(app, kind, fresh, params);
  const tasks = fresh.map((t) => view(U.byId(app, 'tasks', t.id)));
  return { task: tasks[0], tasks: tasks, asked: r.ok === true, already: false, skipped: waiting.length, message: r.ok ? '' : notSent(r) };
}

/** The automatic requests the seller switched on in Settings (all off by default). */
function autoOn(app, which) {
  return L('lib_store').automationOf(L('lib_store').settings(app))[which] === true;
}

function ref(app, id) {
  const U = L('lib_util');
  const r = U.byId(app, 'tasks', String(id || ''));
  if (r === null) throw U.fail(404, 'No task ' + id + '. Run tasks.list.', 'not_found');
  return r;
}

/** Close the open tasks of `kind` on `target` (used when the work itself says it is done); `params` narrows it like ask() does. */
function finishFor(app, target, kind, note, failed, params) {
  const U = L('lib_util');
  for (const r of openAll(app, target, kind, params || null)) {
    r.set('state', failed ? 'failed' : 'done');
    r.set('note', U.clip(note || '', 4000));
    r.set('done_at', U.now());
    app.save(r);
  }
}

/** Tasks a request was fired for (it stays in their history after a Retry). */
function ofRequest(app, id) {
  const U = L('lib_util');
  const rid = String(id || '').trim();
  if (!/^[a-z0-9]{15}$/.test(rid)) throw U.fail(400, 'request is the request id you were handed (15 letters and digits).', 'invalid_param', { param: 'request' });
  return Array.from(app.findRecordsByFilter('tasks', 'request = {:r} || requests ~ {:r}', 'created', 0, 0, { r: rid }));
}

function oneOf(ctx, p) {
  const U = L('lib_util');
  if (p.task) return [ref(ctx.app, p.task)];
  if (p.request) return null;
  throw U.fail(400, 'Give --request <the request id> (or --task <id>).', 'missing_param', { param: 'request' });
}

/* ------------------------------------------------------------------- ops */

function list(ctx, p) {
  const app = ctx.app;
  const states = p.state === 'all' ? null : p.state ? [p.state] : OPEN;
  const rows = app.findRecordsByFilter('tasks', states === null ? '1=1' : states.map((s) => "state = '" + s + "'").join(' || '), 'created', Math.min(Math.max(Math.round(p.limit || 50), 1), 200), 0).map(view);
  return { tasks: rows, note: 'Each request you are handed names its work; open it with tasks.start --request <the request id>.' };
}

function recent(ctx, p) {
  const rows = ctx.app.findRecordsByFilter('tasks', '1=1', '-created', Math.min(Math.max(Math.round(p.limit || 30), 1), 100), 0).map(view);
  return { tasks: rows };
}

function get(ctx, p) {
  return { task: view(ref(ctx.app, p.task)) };
}

/** Your AI agent opens its work: the open tasks of the request (or one task) become "working". */
function start(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const one = oneOf(ctx, p);
  if (one !== null) {
    const r = one[0];
    if (OPEN.indexOf(r.getString('state')) < 0) throw U.fail(409, 'This task is already ' + r.getString('state') + '.', 'conflict');
    r.set('state', 'working');
    r.set('started_at', U.now());
    app.save(r);
    return { task: view(r) };
  }
  const rid = String(p.request).trim();
  const rows = ofRequest(app, rid);
  if (rows.length === 0) throw U.fail(404, 'Store OS asked for nothing with request ' + rid + '. Report the request rejected.', 'not_found');
  const started = [];
  const elsewhere = [];
  for (const r of rows) {
    if (OPEN.indexOf(r.getString('state')) < 0) continue;
    if (r.getString('state') === 'working' && r.getString('request') !== rid && staleOf(r) === '') {
      elsewhere.push(r.getString('request'));
      continue;
    }
    r.set('state', 'working');
    r.set('request', rid);
    r.set('started_at', U.now());
    app.save(r);
    started.push(view(r));
  }
  if (started.length === 0) {
    const how = elsewhere.length > 0 ? 'it is being worked on under request ' + elsewhere[0] : 'it is ' + rows.map((r) => r.getString('state')).filter((s, i, a) => a.indexOf(s) === i).join(' or ');
    return { tasks: [], open: 0, message: 'Nothing is open for this request (' + how + '). Report the request done and stop.' };
  }
  return { tasks: started, open: started.length, message: '' };
}

/** Finish a task (or every open task of a request) with a note the seller reads. */
function finish(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const one = oneOf(ctx, p);
  let rows;
  if (one !== null) {
    if (OPEN.indexOf(one[0].getString('state')) < 0) throw U.fail(409, 'This task is already ' + one[0].getString('state') + '.', 'conflict');
    rows = one;
  } else {
    const all = ofRequest(app, p.request);
    if (all.length === 0) throw U.fail(404, 'Store OS asked for nothing with request ' + p.request + '.', 'not_found');
    rows = all.filter((r) => OPEN.indexOf(r.getString('state')) >= 0);
    if (rows.length === 0) return { tasks: [], message: 'Nothing was open for this request; nothing changed.' };
  }
  for (const r of rows) {
    r.set('state', p.failed === true ? 'failed' : 'done');
    r.set('note', U.clip(p.note || '', 4000));
    r.set('done_at', U.now());
    app.save(r);
    L('lib_store').log(app, ctx.actor, (p.failed === true ? 'Could not finish: ' : 'Finished: ') + r.getString('label') + (p.note ? ' (' + U.clip(p.note, 160) + ')' : ''), r.getString('target'));
  }
  return one !== null ? { task: view(rows[0]) } : { tasks: rows.map(view) };
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

/** The seller's Retry: fire the same trigger once more for a task that was not sent, not picked up in 24 hours, or left unfinished. */
function retry(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.task);
  if (OPEN.indexOf(r.getString('state')) < 0) throw U.fail(409, 'This task is ' + r.getString('state') + '. Ask again from its page.', 'conflict');
  const why = staleOf(r);
  if (why === '') {
    if (r.getString('state') === 'working') throw U.fail(409, 'Your AI agent is working on it.', 'too_soon');
    throw U.fail(409, 'Your AI agent was asked ' + Math.max(0, Math.floor(hoursSince(r.getString('asked_at')))) + ' hours ago. Retry opens when it has not picked this up within 24 hours.', 'too_soon');
  }
  const sent = send(app, r.getString('kind'), [r], [U.json(r, 'params', {})]);
  L('lib_store').log(app, ctx.actor, (sent.ok ? 'Asked your AI agent again: ' : 'Could not ask your AI agent again: ') + r.getString('label'), r.getString('target'));
  return { task: view(U.byId(app, 'tasks', r.id)), asked: sent.ok === true, message: sent.ok ? '' : notSent(sent) };
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
  const out = ask(app, 'chat', [{ target: 'chat:' + rec.id, label: 'Answer: ' + U.clip(text, 120), params: { chat: rec.id, context: rec.getString('context') } }], 'person');
  rec.set('task', out.task.id);
  app.save(rec);
  return { chat: chatView(rec), task: out.task, asked: out.asked, message: out.message };
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
  OPEN: OPEN,
  kinds: kinds,
  triggers: triggers,
  staleOf: staleOf,
  view: view,
  brief: brief,
  openFor: openFor,
  openMap: openMap,
  fireParams: fireParams,
  ask: ask,
  autoOn: autoOn,
  finishFor: finishFor,
  list: list,
  recent: recent,
  get: get,
  start: start,
  finish: finish,
  cancel: cancel,
  retry: retry,
  chats: chats,
  chatSend: chatSend,
  chatReply: chatReply,
};
