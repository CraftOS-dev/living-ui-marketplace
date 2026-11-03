/// <reference path="../pb_data/types.d.ts" />
/**
 * The conversation with the coach (the AI agent).
 *
 * The person writes a message (a question, or a request for a song); the app
 * asks the agent with the `coach_message` trigger. The agent reads it
 * (coach.get), does the work (songs.add for a requested song, plan.set for a
 * plan) and answers with coach.reply, which closes the message. Session
 * reviews arrive here too (sessions.review).
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function messageJson(r) {
  const u = U();
  return {
    id: r.id,
    role: r.getString('role'),
    kind: r.getString('kind') || 'chat',
    text: r.getString('text'),
    song: r.getString('song'),
    session: r.getString('session'),
    reply_to: r.getString('reply_to'),
    status: r.getString('status'),
    request_id: r.getString('request_id'),
    error: r.getString('error'),
    context: u.getJson(r, 'context'),
    created: r.getString('created'),
    edited: u.ms(r.getString('updated')) - u.ms(r.getString('created')) > 2000 && r.getString('kind') === 'review' ? r.getString('updated') : '',
  };
}

function fire(app, msg) {
  const res = require(`${__hooks}/_triggers_lib.js`).fire(app, 'coach_message', { message: msg.id }, 'hook');
  if (res && res.ok) {
    msg.set('request_id', res.id);
    msg.set('error', '');
    msg.set('status', 'pending');
    app.save(msg);
    return { asked: true, reason: '' };
  }
  const reason = (res && res.message) || 'The coach could not be asked.';
  msg.set('error', String(reason).slice(0, 1000));
  app.save(msg);
  return { asked: false, reason: reason };
}

function send(app, e, p) {
  const u = U();
  u.personOnly(e, 'write messages as the person');
  const text = u.req(p, 'text', '"Can you add Danny Boy?"');
  if (text.length > 4000) throw u.fail(400, 'Keep a message under 4,000 characters.');
  const kind = u.oneOf(p, 'kind', ['chat', 'request'], 'chat');
  const song = u.str(p, 'song', '');
  if (song !== '' && u.byId(app, 'songs', song) === null) throw u.fail(404, 'No song ' + song);
  const ctx = u.obj(p, 'context', '{"view":"practice","bars":"9-16"}');
  const msg = new Record(app.findCollectionByNameOrId('messages'));
  msg.set('role', 'you');
  msg.set('kind', kind);
  msg.set('text', text);
  msg.set('song', song);
  msg.set('status', 'pending');
  if (ctx !== undefined) msg.set('context', ctx);
  app.save(msg);
  const r = fire(app, msg);
  seen(app);
  return { message: messageJson(msg), asked: r.asked, reason: r.reason };
}

function retry(app, e, p) {
  const u = U();
  u.personOnly(e, 'resend messages');
  const msg = u.byId(app, 'messages', u.req(p, 'message', '{message id}'));
  if (msg === null || msg.getString('role') !== 'you') throw u.fail(404, 'No message of yours with that id.');
  if (msg.getString('status') === 'answered') return { message: messageJson(msg), asked: false, reason: 'already answered' };
  const r = fire(app, msg);
  return { message: messageJson(msg), asked: r.asked, reason: r.reason };
}

/** The person's message, what they were looking at, and the conversation before it. */
function get(app, p) {
  const u = U();
  const m = M();
  const msg = u.byId(app, 'messages', u.req(p, 'message', '{message id}'));
  if (msg === null) throw u.fail(404, 'No message ' + p.message + '.');
  const before = app.findRecordsByFilter('messages', 'created < {:t}', '-created', 6, 0, { t: msg.getString('created') });
  const out = { message: messageJson(msg), earlier: Array.from(before).reverse().map((r) => ({ role: r.getString('role'), kind: r.getString('kind'), text: r.getString('text').slice(0, 500), created: r.getString('created') })) };
  if (msg.getString('song') !== '') {
    const rec = u.byId(app, 'songs', msg.getString('song'));
    if (rec !== null) out.song = m.songJson(app, rec, {});
  }
  const st = m.settings(app);
  const V = require(`${__hooks}/lib_voice.js`);
  const H = require(`${__hooks}/lib_health.js`).summary(app);
  out.learner = { level: st.getInt('level') || 1, goal_minutes: st.getInt('daily_minutes') || 20, name: st.getString('name'), under18: st.getBool('under18'), voice: V.describe(V.current(app)), song_span_cap: require(`${__hooks}/lib_songs.js`).SPAN_CAP[st.getInt('level') || 1] };
  out.health = H;
  return out;
}

function reply(app, e, p) {
  const u = U();
  u.agentOnly(e, 'reply as the coach');
  const text = u.req(p, 'text', '"Added it at level 3. Start with Echo on bars 1-4."');
  if (text.length > 8000) throw u.fail(400, 'Keep a reply under 8,000 characters.');
  const to = u.str(p, 'message', '');
  if (to === '' && !u.bool(p, 'new', false)) throw u.fail(400, 'message is required: the id of the message you answer (coach.list shows the pending ones). To write to the person unasked (a plan, a nudge), pass --new true.');
  let orig = null;
  if (to !== '') {
    orig = u.byId(app, 'messages', to);
    if (orig === null) throw u.fail(404, 'No message ' + to + '.');
  }
  const song = u.str(p, 'song', '');
  if (song !== '' && u.byId(app, 'songs', song) === null) throw u.fail(404, 'No song ' + song);
  const msg = new Record(app.findCollectionByNameOrId('messages'));
  msg.set('role', 'coach');
  msg.set('kind', u.oneOf(p, 'kind', ['chat', 'plan'], 'chat'));
  msg.set('text', text);
  msg.set('song', song);
  msg.set('reply_to', to);
  app.save(msg);
  if (orig !== null && orig.getString('role') === 'you') {
    orig.set('status', u.bool(p, 'failed', false) ? 'failed' : 'answered');
    app.save(orig);
  }
  // Songs added with songs.add --message show under this reply by themselves.
  const shown = orig === null ? [] : Array.from(app.findRecordsByFilter('songs', 'request = {:r}', 'created', 20, 0, { r: orig.id })).map((s) => ({ id: s.id, title: s.getString('title') }));
  return { message: messageJson(msg), question: orig === null ? null : { id: orig.id, status: orig.getString('status') }, songs_shown: shown };
}

/**
 * The coach takes back one of its own messages (a mistake, a wrong bar):
 * within 30 minutes and before the person has read it. The question it
 * answered is waiting again.
 */
function unsend(app, e, p) {
  const u = U();
  u.agentOnly(e, "take back the coach's messages");
  const id = u.req(p, 'message', '{id of the coach message}');
  const msg = u.byId(app, 'messages', id);
  if (msg === null) throw u.fail(404, 'No message ' + id + '. coach.list shows the conversation with ids.');
  if (msg.getString('role') !== 'coach') throw u.fail(400, 'Message ' + id + " is the person's; only the coach's own messages can be taken back.");
  if (Date.now() - u.ms(msg.getString('created')) > 30 * 60000) throw u.fail(400, 'Message ' + id + ' was sent more than 30 minutes ago; send a correction instead (coach.reply --message <their message> --text "…").');
  const seenTo = M().settings(app).getString('coach_seen');
  if (seenTo !== '' && msg.getString('created') <= seenTo) throw u.fail(400, 'The person has read message ' + id + '; send a correction instead.');
  const to = msg.getString('reply_to');
  app.delete(msg);
  if (to !== '') {
    const orig = u.byId(app, 'messages', to);
    if (orig !== null && orig.getString('role') === 'you') {
      const others = app.findRecordsByFilter('messages', "role = 'coach' && reply_to = {:r}", '', 1, 0, { r: to });
      if (others.length === 0) {
        orig.set('status', 'pending');
        app.save(orig);
      }
    }
  }
  return { removed: id, question: to !== '' ? { id: to, status: 'pending' } : null };
}

function list(app, p, e) {
  const u = U();
  const m = M();
  // The agent gets the songs without their melody previews (lean).
  const agent = e !== undefined && u.fromAgent(e);
  const limit = u.int(p, 'limit', 80, 1, 300);
  const rows = Array.from(app.findRecordsByFilter('messages', '', '-created', limit, 0)).reverse();
  const ids = rows.filter((r) => r.getString('role') === 'you').map((r) => r.id);
  // Songs the coach added for a message, shown under its answer.
  const added = {};
  if (ids.length > 0) {
    const songs = app.findRecordsByFilter('songs', "request != ''", '-created', 200, 0);
    for (const s of songs) {
      const req = s.getString('request');
      if (ids.indexOf(req) < 0) continue;
      (added[req] = added[req] || []).push(agent ? { id: s.id, title: s.getString('title'), level: s.getInt('level') } : m.songJson(app, s, { preview: true }));
    }
  }
  const st = m.settings(app);
  const replied = {};
  for (const r of rows) if (r.getString('role') === 'coach' && r.getString('reply_to') !== '') replied[r.getString('reply_to')] = true;
  return {
    messages: rows.map((r) => {
      const j = messageJson(r);
      // Under the coach's answer; under the question while the answer is still coming.
      if (j.role === 'you' && !replied[j.id] && added[j.id] !== undefined) j.songs = added[j.id];
      if (j.role === 'coach' && j.reply_to !== '' && added[j.reply_to] !== undefined) j.songs = added[j.reply_to];
      return j;
    }),
    seen: st.getString('coach_seen'),
  };
}

function seen(app) {
  const s = M().settings(app);
  s.set('coach_seen', U().now());
  app.save(s);
  return { ok: true };
}

function read(app, e) {
  U().personOnly(e, 'mark messages read');
  return seen(app);
}

function unread(app) {
  const st = M().settings(app);
  const since = st.getString('coach_seen');
  const filter = since === '' ? "role = 'coach'" : "role = 'coach' && created > {:t}";
  return app.findRecordsByFilter('messages', filter, '', 0, 0, { t: since }).length;
}

module.exports = { send: send, retry: retry, get: get, reply: reply, unsend: unsend, list: list, read: read, unread: unread, messageJson: messageJson };
