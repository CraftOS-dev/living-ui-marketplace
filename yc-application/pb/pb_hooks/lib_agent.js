/// <reference path="../pb_data/types.d.ts" />
/**
 * Work handed to your AI agent through triggers (triggers.json):
 *
 *   gather_requested     read the founders' links and files and fill the
 *                        application (Gather on the pipeline)
 *   message_sent         a founder told your AI agent something
 *   fill_form_requested  type the application into YC's form, never submit
 *
 * The app keeps the id of each fired request; the screens follow that
 * request themselves (the queue belongs to the agent that reacts, never to
 * the app's hooks) to say honestly whether your AI agent picked it up.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function fire(app, name, params) {
  const U = L('lib_util');
  const trig = require(`${__hooks}/_triggers_lib.js`);
  const r = trig.fire(app, name, params || {}, 'hook');
  if (!r.ok) {
    const wait = r.code === 'cooldown' || r.code === 'rate_capped';
    throw U.fail(wait ? 429 : 503, wait ? 'Your AI agent was just asked; try again in a few seconds.' : 'Could not reach your AI agent: ' + (r.message || r.code), r.code || 'fire_failed');
  }
  return r.id;
}

/* ------------------------------------------------------------------ gather */

function gatherStart(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  if (s.getString('status') !== 'preparing') throw U.fail(409, 'The application was submitted.', 'submitted_locked');
  const sources = app.findRecordsByFilter('sources', '1=1', '', 1, 0).length;
  const founders = S.founderRecords(app).length;
  if (sources === 0 && founders === 0) throw U.fail(400, 'Add a link or a file first: your website, a founder\'s LinkedIn or GitHub, or your pitch deck.', 'no_sources');
  const id = fire(app, 'gather_requested', { focus: U.clip(p.focus || '', 500) });
  s.set('gather_state', 'requested');
  s.set('gather_request', id);
  s.set('gather_at', U.now());
  app.save(s);
  S.log(app, 'person', 'Asked your AI agent to gather and fill', '');
  return { request: id };
}

function gatherBegin(ctx) {
  const S = L('lib_store');
  const s = S.settings(ctx.app);
  s.set('gather_state', 'working');
  ctx.app.save(s);
  S.log(ctx.app, 'agent', 'Started reading your sources', '');
  return { gather_state: 'working' };
}

function gatherFinish(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const s = S.settings(ctx.app);
  s.set('gather_state', p.failed === true ? 'failed' : 'done');
  s.set('gather_summary', U.clip(p.summary || '', 4000));
  s.set('gather_at', U.now());
  ctx.app.save(s);
  S.log(ctx.app, 'agent', p.failed === true ? 'Could not finish gathering: ' + U.clip(p.summary || '', 200) : 'Finished gathering: ' + U.clip(p.summary || '', 200), '');
  return { gather_state: s.getString('gather_state') };
}

/* ---------------------------------------------------------------- messages */

function messageView(app, r) {
  return {
    id: r.id,
    role: r.getString('role'),
    text: r.getString('text'),
    state: r.getString('state'),
    request: r.getString('request'),
    reply_to: r.getString('reply_to'),
    created: r.getString('created'),
  };
}

function messages(ctx, p) {
  const app = ctx.app;
  const limit = Math.min(Math.max(Math.round(p.limit || 30), 1), 200);
  const rows = app.findRecordsByFilter('messages', '1=1', '-created', limit, 0).map((r) => messageView(app, r));
  rows.reverse();
  return { messages: rows };
}

function send(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const text = String(p.text || '').trim();
  if (text === '') throw U.fail(400, 'Write what to tell your AI agent.', 'missing_param', { param: 'text' });
  const rec = U.newRecord(app, 'messages');
  rec.set('role', 'person');
  rec.set('text', U.clip(text, 8000));
  rec.set('state', 'sent');
  app.save(rec);
  try {
    rec.set('request', fire(app, 'message_sent', { message_id: rec.id }));
  } catch (err) {
    // Asked a moment ago: the message waits, and the minute job asks again
    // (your AI agent answers every unanswered message in one run).
    if (err.status !== 429) {
      rec.set('state', 'failed');
      app.save(rec);
      throw err;
    }
    rec.set('state', 'queued');
  }
  app.save(rec);
  return { message: messageView(app, rec) };
}

/** Ask your AI agent again about messages that were waiting for a free moment. */
function refire(app) {
  const waiting = app.findRecordsByFilter('messages', "state = 'queued'", 'created', 0, 0);
  if (waiting.length === 0) return;
  // One request for every waiting message: your AI agent answers them all in one run.
  const trig = require(`${__hooks}/_triggers_lib.js`);
  const r = trig.fire(app, 'message_sent', { message_id: waiting[0].id }, 'hook');
  if (!r.ok) return;
  for (const m of waiting) {
    const rec = app.findRecordById('messages', m.id);
    rec.set('state', 'sent');
    rec.set('request', r.id);
    app.save(rec);
  }
}

function reply(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const text = String(p.text || '').trim();
  if (text === '') throw U.fail(400, 'Give --text.', 'missing_param', { param: 'text' });
  let to = null;
  if (p.message) {
    to = U.byId(app, 'messages', p.message);
    if (to === null) throw U.fail(404, 'No message ' + p.message + '. Run messages.list.', 'not_found');
  }
  const rec = U.newRecord(app, 'messages');
  rec.set('role', 'agent');
  rec.set('text', U.clip(text, 8000));
  rec.set('state', 'answered');
  rec.set('reply_to', to !== null ? to.id : '');
  app.save(rec);
  if (to !== null) {
    to.set('state', 'answered');
    app.save(to);
  }
  return { message: messageView(app, rec) };
}

module.exports = { fire: fire, gatherStart: gatherStart, gatherBegin: gatherBegin, gatherFinish: gatherFinish, messages: messages, send: send, reply: reply, refire: refire };
