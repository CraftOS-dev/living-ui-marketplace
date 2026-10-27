/// <reference path="../pb_data/types.d.ts" />
/**
 * Working with your AI agent.
 *
 * - Asking it for work: agent.request (a person asks from a screen) and
 *   ask() (the app asks: routines). Both fire a declared
 *   trigger (triggers.json) through the platform queue; a fire the cooldown
 *   refused is remembered and retried by the minute job. Hooks never read
 *   the queue itself (the platform owns it); screens follow a request there.
 * - Questions (asks): a person asks; your AI agent answers from the app's
 *   operations.
 * - Proposals: an operation your AI agent may not run on a person's own
 *   records (goals, projects, a plan for the day, deletions) is stored with a
 *   preview; a person approves it (all of it, or the items they tick),
 *   returns it with a note, or rejects it. Approving refuses when the target
 *   changed since the proposal (stale).
 * - Suggestions: one field of one record (link this task to that goal), shown
 *   as a dashed chip the person keeps or dismisses.
 * - The brief: today in one read, for your AI agent's first call.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}
let act_ = null;
function act() {
  return act_ || (act_ = require(`${__hooks}/lib_activity.js`));
}

/* --------------------------------------------------------------- asking */

/** Fire a trigger from the app. Returns {ok, id, code}. */
function ask(app, trigger, params) {
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, trigger, params || {}, 'hook');
  if (fired && fired.ok === true) return { ok: true, id: fired.id, code: '' };
  if (fired) console.error('[lo] could not ask your AI agent (' + trigger + '): ' + fired.code + ' ' + fired.message);
  return { ok: false, id: '', code: fired ? fired.code : 'not_sent' };
}

/** What a person may ask your AI agent for from a screen, the trigger and its params. */
const KINDS = {
  day_plan: { trigger: 'day_plan_requested', label: 'plan the day' },
  inbox: { trigger: 'inbox_sort_requested', label: 'sort the inbox' },
  breakdown: { trigger: 'breakdown_requested', label: 'break a goal down' },
  habit_help: { trigger: 'habit_help_requested', label: 'help with a habit' },
  recap: { trigger: 'recap_requested', label: 'write the week' },
};

/** agent.request: a person asks your AI agent for one piece of work. */
function request(ctx, p) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const kind = util.oneOf(p, 'kind', Object.keys(KINDS), '');
  if (kind === '') throw util.fail(400, 'kind is one of ' + Object.keys(KINDS).join(', '), 'missing_param');
  const params = {};
  const t0 = C.today(app);
  if (kind === 'day_plan') params.date = util.day(p, 'date', t0);
  if (kind === 'recap') params.week_start = C.weekStart(app, util.day(p, 'date', t0));
  if (kind === 'breakdown') params.goal_id = C.need(app, 'goals', util.req(p, 'goal'), 'goal').id;
  if (kind === 'habit_help') params.habit_id = C.need(app, 'habits', util.req(p, 'habit'), 'habit').id;
  if (util.has(p, 'brief')) {
    const b = util.text(p, 'brief', 1000, '');
    if (b !== '') params.brief = b;
  }
  const spec = KINDS[kind];
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, spec.trigger, params, 'hook');
  if (!fired || fired.ok !== true) {
    const code = fired && fired.code ? fired.code : 'not_sent';
    throw util.fail(409, code === 'cooldown' ? 'Your AI agent was asked for this a moment ago. Try again shortly.' : 'Your AI agent could not be asked right now' + (fired && fired.message ? ': ' + fired.message : '.'), code);
  }
  act().write(app, ctx, { label: 'Asked your AI agent to ' + spec.label, target: 'agent', record: fired.id, data: { detail: { kind: kind, params: params } } });
  return { request: fired.id, kind: kind, trigger: spec.trigger };
}

/* ------------------------------------------------------------ questions */

function askOut(a) {
  return { id: a.id, question: a.getString('question'), about: a.getString('about'), target: a.getString('target'), status: a.getString('status'), answer: a.getString('answer'), failure: a.getString('failure'), request: a.getString('request'), created: a.getString('created'), updated: a.getString('updated') };
}

/** asks.create: a person's question to your AI agent (about their life, an area, a goal, a habit or a person). */
function askCreate(ctx, p) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const q = util.text(p, 'question', 4000, '');
  if (q === '') throw util.fail(400, 'question is required', 'missing_param', { param: 'question' });
  const about = util.oneOf(p, 'about', ['life', 'area', 'goal', 'habit', 'person'], 'life');
  const a = util.newRecord(app, 'asks');
  a.set('question', q);
  a.set('about', about);
  if (about === 'goal') a.set('target', C.need(app, 'goals', util.req(p, 'target'), 'goal').id);
  if (about === 'area') a.set('target', C.kind(p, 'target', true));
  if (about === 'habit') a.set('target', C.need(app, 'habits', util.req(p, 'target'), 'habit').id);
  if (about === 'person') a.set('target', C.need(app, 'people', util.req(p, 'target'), 'person').id);
  a.set('status', 'waiting');
  app.save(a);
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, 'question_asked', { ask_id: a.id }, 'hook');
  if (fired && fired.ok === true) {
    a.set('request', fired.id);
    app.save(a);
  }
  return { ask: askOut(a), asked: !!(fired && fired.ok), code: fired && !fired.ok ? fired.code : '' };
}

function askList(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['waiting', 'working', 'answered', 'failed'], '');
  const recs = ctx.app.findRecordsByFilter('asks', status === '' ? '' : 'status = {:s}', '-created', util.int(p, 'limit', 50, 1, 200), 0, { s: status });
  return { asks: recs.map(askOut) };
}

function askGet(ctx, p) {
  return { ask: askOut(core().need(ctx.app, 'asks', u().req(p, 'ask'), 'question')) };
}

function askWorking(ctx, p) {
  const a = core().need(ctx.app, 'asks', u().req(p, 'ask'), 'question');
  a.set('status', 'working');
  ctx.app.save(a);
  return { ask: askOut(a) };
}

/** asks.answer: the answer (plain text; numbers should come from the app's operations). */
function askAnswer(ctx, p) {
  const util = u();
  const a = core().need(ctx.app, 'asks', util.req(p, 'ask'), 'question');
  const text = util.text(p, 'answer', 20000, '');
  if (text === '') throw util.fail(400, 'answer is required', 'missing_param', { param: 'answer' });
  a.set('answer', text);
  a.set('status', 'answered');
  ctx.app.save(a);
  return { ask: askOut(a) };
}

function askFail(ctx, p) {
  const util = u();
  const a = core().need(ctx.app, 'asks', util.req(p, 'ask'), 'question');
  a.set('status', 'failed');
  a.set('failure', util.text(p, 'reason', 2000, ''));
  ctx.app.save(a);
  return { ask: askOut(a) };
}

function askDelete(ctx, p) {
  const a = core().need(ctx.app, 'asks', u().req(p, 'ask'), 'question');
  ctx.app.delete(a);
  return { deleted: true };
}

/* ------------------------------------------------------------ proposals */

function proposalOut(app, r) {
  const util = u();
  return {
    id: r.id,
    op: r.getString('op'),
    kind: r.getString('kind'),
    title: r.getString('title'),
    summary: r.getString('summary'),
    preview: util.jsonOf(r, 'preview'),
    why: r.getString('why'),
    target_collection: r.getString('target_collection'),
    target_id: r.getString('target_id'),
    status: r.getString('status'),
    decision_note: r.getString('decision_note'),
    decided_at: r.getString('decided_at'),
    result: util.jsonOf(r, 'result'),
    created: r.getString('created'),
  };
}

/** A preview for operations without their own (Settings: "propose everything"). */
function genericPreview(ctx, spec, params) {
  const shown = Object.keys(params)
    .filter((k) => params[k] !== '' && params[k] !== undefined)
    .map((k) => k + ': ' + (typeof params[k] === 'object' ? JSON.stringify(params[k]) : String(params[k])).slice(0, 120));
  return { kind: spec.name.split('.')[0], title: String(spec.desc || spec.name).split('. ')[0].replace(/\.$/, ''), summary: shown.join('; ').slice(0, 1000), preview: { op: spec.name, params: params } };
}

/** Your AI agent's call to a 'propose' operation: store it with its preview for a person. */
function proposeOrRun(ctx, spec, params) {
  const util = u();
  const app = ctx.app;
  const why = String(params.why || '');
  delete params.why;
  let pv;
  if (spec.preview) {
    const parts = spec.preview.split('.');
    pv = require(`${__hooks}/${parts[0]}.js`)[parts[1]](Object.assign({}, ctx, { op: spec.name }), params);
  } else pv = genericPreview(ctx, spec, params);
  const tgt = pv.target || null;
  // A retry of the same proposal returns the one already waiting.
  const same = app.findRecordsByFilter('proposals', "status = 'waiting' && op = {:op}", '-created', 50, 0, { op: spec.name }).find((x) => JSON.stringify(util.jsonOf(x, 'params')) === JSON.stringify(params));
  if (same) return { proposal: proposalOut(app, same), already_waiting: true, message: 'This proposal is already waiting for the person.' };
  const r = util.newRecord(app, 'proposals');
  r.set('op', spec.name);
  r.set('params', params);
  r.set('kind', pv.kind || spec.name);
  r.set('title', String(pv.title || spec.desc).slice(0, 400));
  r.set('summary', String(pv.summary || '').slice(0, 4000));
  r.set('preview', pv.preview || {});
  r.set('why', why.slice(0, 8000));
  if (tgt) {
    r.set('target_collection', tgt.collection);
    r.set('target_id', tgt.id);
    const t = util.byId(app, tgt.collection, tgt.id);
    if (t !== null) r.set('target_updated', t.getString('updated'));
  }
  r.set('status', 'waiting');
  app.save(r);
  act().write(app, ctx, { label: 'Proposed: ' + r.getString('title'), target: 'proposals', record: r.id });
  return { proposal: proposalOut(app, r), message: 'Stored as a proposal; the person approves it in the app (Agent page and where it applies).' };
}

/** proposals.list */
function proposals(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['waiting', 'approved', 'partly_approved', 'rejected', 'returned', 'withdrawn', 'stale', 'all'], 'waiting');
  const kind = util.str(p, 'kind', '');
  const where = [];
  const bind = {};
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  const recs = ctx.app.findRecordsByFilter('proposals', where.join(' && '), '-created', util.int(p, 'limit', 100, 1, 500), 0, bind);
  return { proposals: recs.map((r) => proposalOut(ctx.app, r)) };
}

/** proposals.approve: run the proposal as the person (all of it, or only --items, the keys they ticked). */
function approve(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = core().need(app, 'proposals', util.req(p, 'proposal'), 'proposal');
  if (r.getString('status') !== 'waiting') throw util.fail(409, 'This proposal was already ' + r.getString('status') + '.', 'invalid_state');
  if (r.getString('target_collection') !== '') {
    const t = util.byId(app, r.getString('target_collection'), r.getString('target_id'));
    if (t === null || t.getString('updated') !== r.getString('target_updated')) {
      r.set('status', 'stale');
      r.set('decided_at', util.nowIso());
      app.save(r);
      throw util.fail(409, 'What this proposal changes was edited after it was made. Ask your AI agent to look again.', 'stale_proposal');
    }
  }
  const spec = require(`${__hooks}/lib_catalog.js`).get(r.getString('op'));
  let params = util.jsonOf(r, 'params') || {};
  let partly = false;
  if (util.has(p, 'items')) {
    const keys = util.ids(p, 'items', 500);
    const all = ((util.jsonOf(r, 'preview') || {}).items || []).map((it) => it.key);
    if (!spec.pick) throw util.fail(400, 'This proposal is approved whole (it has no items to pick).', 'invalid_param', { param: 'items' });
    if (keys.length === 0) throw util.fail(400, 'Tick at least one item, or reject the proposal.', 'invalid_param', { param: 'items' });
    keys.forEach((k) => {
      if (all.indexOf(k) < 0) throw util.fail(400, 'Unknown item "' + k + '"; the preview lists the keys.', 'invalid_param', { param: 'items' });
    });
    const parts = spec.pick.split('.');
    params = require(`${__hooks}/${parts[0]}.js`)[parts[1]](params, keys);
    partly = keys.length < all.length;
  }
  const result = require(`${__hooks}/lib_ops.js`).runAs(Object.assign({}, ctx, { op: r.getString('op') }), r.getString('op'), params);
  r.set('status', partly ? 'partly_approved' : 'approved');
  r.set('decided_at', util.nowIso());
  r.set('result', { ok: true, batch: result && result.batch ? result.batch : '' });
  app.save(r);
  act().write(app, ctx, { label: (partly ? 'Kept part of: ' : 'Approved: ') + r.getString('title'), target: 'proposals', record: r.id });
  return { proposal: proposalOut(app, r), result: result };
}

function decide(ctx, p, status) {
  const util = u();
  const app = ctx.app;
  const r = core().need(app, 'proposals', util.req(p, 'proposal'), 'proposal');
  if (r.getString('status') !== 'waiting') throw util.fail(409, 'This proposal was already ' + r.getString('status') + '.', 'invalid_state');
  r.set('status', status);
  r.set('decision_note', util.text(p, 'note', 4000, ''));
  r.set('decided_at', util.nowIso());
  app.save(r);
  if (status === 'returned') ask(app, 'proposal_returned', { proposal_id: r.id });
  act().write(app, ctx, { label: (status === 'returned' ? 'Sent back: ' : status === 'withdrawn' ? 'Withdrew: ' : 'Declined: ') + r.getString('title'), target: 'proposals', record: r.id });
  return { proposal: proposalOut(app, r) };
}

function reject(ctx, p) {
  return decide(ctx, p, 'rejected');
}

function returnBack(ctx, p) {
  if (u().text(p, 'note', 4000, '') === '') throw u().fail(400, 'Say what to change in --note.', 'missing_param', { param: 'note' });
  return decide(ctx, p, 'returned');
}

function withdraw(ctx, p) {
  return decide(ctx, p, 'withdrawn');
}

/* ----------------------------------------------------------- suggestions */

/** What each kind of record lets your AI agent suggest, and the operation that applies it. */
const SUGGESTABLE = {
  tasks: { fields: { goal: 'goals', area: 'kind', project: 'projects', person: 'people', do_date: 'date', due_date: 'date', duration_min: 'number' }, label: 'task' },
  habits: { fields: { goal: 'goals', area: 'kind', cue: 'text', time_of_day: ['morning', 'afternoon', 'evening', 'anytime'] }, label: 'habit' },
  goals: { fields: { area: 'kind', deadline: 'date', purpose: 'text' }, label: 'goal' },
};

function suggestionOut(app, s) {
  const util = u();
  const target = util.byId(app, s.getString('target_kind'), s.getString('target_id'));
  const value = util.jsonOf(s, 'value');
  let shown = value;
  const spec = (SUGGESTABLE[s.getString('target_kind')] || { fields: {} }).fields[s.getString('field')];
  if (typeof spec === 'string' && ['goals', 'projects', 'people'].indexOf(spec) >= 0 && typeof value === 'string') {
    const r = util.byId(app, spec, value);
    shown = r === null ? value : r.getString(spec === 'people' ? 'name' : 'title');
  }
  if (spec === 'kind' && typeof value === 'string') shown = core().KIND_NAMES[value] || value;
  return {
    id: s.id,
    target_kind: s.getString('target_kind'),
    target_id: s.getString('target_id'),
    target_title: target === null ? '' : target.getString(s.getString('target_kind') === 'habits' ? 'name' : 'title'),
    field: s.getString('field'),
    value: value,
    shown: shown,
    why: s.getString('why'),
    status: s.getString('status'),
    created: s.getString('created'),
  };
}

/** suggestions.list */
function suggestionList(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['open', 'accepted', 'dismissed', 'stale', 'all'], 'open');
  const where = [];
  const bind = {};
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const kind = util.oneOf(p, 'target_kind', Object.keys(SUGGESTABLE), '');
  if (kind !== '') {
    where.push('target_kind = {:k}');
    bind.k = kind;
  }
  const id = util.str(p, 'target_id', '');
  if (id !== '') {
    where.push('target_id = {:i}');
    bind.i = id;
  }
  return { suggestions: ctx.app.findRecordsByFilter('suggestions', where.join(' && '), '-created', util.int(p, 'limit', 200, 1, 1000), 0, bind).map((s) => suggestionOut(ctx.app, s)) };
}

function readSuggestion(app, raw, where) {
  const util = u();
  const C = core();
  util.keysOnly(raw, ['target_kind', 'target_id', 'field', 'value', 'why'], where);
  const kind = util.choice(raw.target_kind, Object.keys(SUGGESTABLE), '', where + ' target_kind', 'target_kind');
  if (kind === '') throw util.fail(400, where + ' needs target_kind: ' + Object.keys(SUGGESTABLE).join(', '), 'missing_param');
  const target = C.need(app, kind, String(raw.target_id || ''), SUGGESTABLE[kind].label);
  const fields = SUGGESTABLE[kind].fields;
  const field = util.choice(raw.field, Object.keys(fields), '', where + ' field', 'field');
  if (field === '') throw util.fail(400, where + ' needs field: ' + Object.keys(fields).join(', '), 'missing_param');
  const spec = fields[field];
  let value = raw.value;
  if (typeof value === 'string' && value.length > 0 && (value.charAt(0) === '"' || value.charAt(0) === '[' || value.charAt(0) === '{')) {
    try {
      value = JSON.parse(value);
    } catch {
      /* plain text */
    }
  }
  if (Array.isArray(spec)) value = util.choice(value, spec, '', where + ' value', 'value');
  else if (spec === 'date') {
    if (!util.isDay(String(value))) throw util.fail(400, where + ' value is a date YYYY-MM-DD', 'invalid_param', { param: 'value' });
    value = String(value);
  } else if (spec === 'number') {
    value = Number(value);
    if (!Number.isFinite(value)) throw util.fail(400, where + ' value is a number', 'invalid_param', { param: 'value' });
  } else if (spec === 'text') value = String(value || '').slice(0, 1000);
  else if (spec === 'kind') value = util.choice(value, C.KINDS, '', where + ' value', 'value');
  else value = C.need(app, spec, String(value || ''), spec === 'people' ? 'person' : spec.replace(/s$/, '')).id;
  return { kind: kind, target: target, field: field, value: value, why: String(raw.why || '').slice(0, 1000) };
}

/** suggestions.create: your AI agent suggests one field of one record (or many with --items). */
function suggestionCreate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const raws = util.has(p, 'items') ? util.list(p, 'items') : [{ target_kind: util.scalar(p.target_kind), target_id: util.scalar(p.target_id), field: util.scalar(p.field), value: util.scalar(p.value), why: util.scalar(p.why) }];
  if (raws.length === 0) throw util.fail(400, 'Give --target_kind --target_id --field --value, or --items as a JSON list of those.', 'missing_param');
  const made = [];
  app.runInTransaction((tx) => {
    raws.slice(0, 200).forEach((raw0, i) => {
      const raw = {};
      for (const k of Object.keys(raw0 || {})) if (raw0[k] !== undefined) raw[k] = raw0[k];
      const s0 = readSuggestion(tx, raw, raws.length > 1 ? 'Item ' + (i + 1) : 'Suggestion');
      // One open suggestion per record and field: a new one replaces the old.
      tx.findRecordsByFilter('suggestions', "target_kind = {:k} && target_id = {:i} && field = {:f} && status = 'open'", '', 0, 0, { k: s0.kind, i: s0.target.id, f: s0.field }).forEach((old) => {
        old.set('status', 'stale');
        tx.save(old);
      });
      const s = util.newRecord(tx, 'suggestions');
      s.set('target_kind', s0.kind);
      s.set('target_id', s0.target.id);
      s.set('field', s0.field);
      s.set('value', s0.value);
      s.set('why', s0.why);
      s.set('status', 'open');
      s.set('actor', ctx.actor);
      tx.save(s);
      made.push(s.id);
    });
  });
  return { suggestions: made.map((id) => suggestionOut(app, app.findRecordById('suggestions', id))) };
}

/** suggestions.accept: apply it through the record's own operation (as the person). */
function suggestionAccept(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = util.ids(p, 'suggestion', 200);
  if (ids.length === 0) throw util.fail(400, 'suggestion is required (one id or a list)', 'missing_param', { param: 'suggestion' });
  const ops = { tasks: ['tasks.update', 'task'], habits: ['habits.update', 'habit'], goals: ['goals.update', 'goal'] };
  const batch = 'sg_' + util.token(8);
  const done = [];
  app.runInTransaction((tx) => {
    const bctx = Object.assign({}, ctx, { app: tx, batch: batch });
    ids.forEach((id) => {
      const s = core().need(tx, 'suggestions', id, 'suggestion');
      if (s.getString('status') !== 'open') throw util.fail(409, 'This suggestion was already ' + s.getString('status') + '.', 'invalid_state');
      const [op, key] = ops[s.getString('target_kind')];
      const params = {};
      params[key] = s.getString('target_id');
      const v = util.jsonOf(s, 'value');
      params[s.getString('field')] = typeof v === 'object' ? JSON.stringify(v) : v;
      require(`${__hooks}/lib_ops.js`).runAs(Object.assign({}, bctx, { op: op }), op, params);
      s.set('status', 'accepted');
      tx.save(s);
      done.push(id);
    });
  });
  return { accepted: done.length, batch: batch };
}

/** suggestions.dismiss */
function suggestionDismiss(ctx, p) {
  const util = u();
  const ids = util.ids(p, 'suggestion', 200);
  ctx.app.runInTransaction((tx) => {
    ids.forEach((id) => {
      const s = core().need(tx, 'suggestions', id, 'suggestion');
      if (s.getString('status') === 'open') {
        s.set('status', 'dismissed');
        tx.save(s);
      }
    });
  });
  return { dismissed: ids.length };
}

/* ------------------------------------------------------------------ brief */

/** agent.brief: the person's life in one read: today's cards, the inbox, habits, the body, money, people, what is coming, goals, the weather. */
function on(h, kind) {
  return h.areas.indexOf(kind) >= 0;
}

function brief(ctx) {
  const C = core();
  const app = ctx.app;
  const h = require(`${__hooks}/lib_dash.js`).summary(ctx);
  const slim = (x) => ({ id: x.id, title: x.title, state: x.state, area: x.area, do_date: x.do_date, due_date: x.due_date, start_time: x.start_time, top: x.top, goal: x.goal ? x.goal.title : '', person: x.person ? x.person.name : '' });
  const inbox = require(`${__hooks}/lib_tasks.js`).list(ctx, { column: 'inbox', limit: 50 }).tasks.map(slim);
  const coming = require(`${__hooks}/lib_tasks.js`)
    .list(ctx, { column: 'coming', limit: 50 })
    .tasks.map(slim)
    .sort((a, b) => (a.do_date || '9999').localeCompare(b.do_date || '9999'));
  const chores = on(h, 'home') ? require(`${__hooks}/lib_house.js`).choreList(ctx).chores.filter((c) => c.due_in <= 0).map((c) => ({ id: c.id, name: c.name, room: c.room, due_in: c.due_in })) : [];
  return {
    date: h.date,
    now: h.now,
    owner_name: h.owner_name,
    place: h.place,
    weather: require(`${__hooks}/lib_world.js`).brief(app),
    areas_on: h.areas,
    agent_note: h.day.agent_note,
    nudges: h.nudges.map((n) => Object.assign({ kind: n.kind, text: n.text }, n.person ? { person: n.person.id } : {}, n.ref ? { ref: n.ref } : {})),
    today: h.tasks.filter((t) => t.state === 'open').map(slim),
    done_today: h.tasks.filter((t) => t.state === 'done').length,
    top_cap: h.top_cap,
    inbox: inbox,
    coming_up_cards: coming,
    habits: h.habits.map((x) => ({ id: x.id, name: x.name, source: x.source, due: x.today.due, done: x.today.done, value: x.today.value, target: x.target, unit: x.unit, streak: x.streak, rate30: x.rate30 === null ? null : Math.round(x.rate30 * 100) })),
    health: h.health,
    money: h.money === null ? null : Object.assign({}, h.money, { spent_text: C.money(app, h.money.spent), left_text: h.money.left === null ? null : C.money(app, h.money.left) }),
    people_to_reach: h.people.due.map((p) => ({ id: p.id, name: p.name, circle: p.circle, days_since: p.days_since, keep_in_touch_days: p.keep_in_touch_days })),
    birthdays: h.people.birthdays.map((p) => ({ id: p.id, name: p.name, date: p.next_birthday.date, in_days: p.next_birthday.in_days })),
    coming_up: h.coming,
    chores_due: chores,
    goals: h.goals.map((g) => ({ id: g.id, title: g.title, area: g.area, measure: g.measure, progress: Math.round(g.progress * 100), pace_state: g.pace_state, deadline: g.deadline })),
    waiting: h.counts,
  };
}

/** agent.status: counts the screens badge (proposals, suggestions, answers). */
function status(ctx) {
  const util = u();
  const r = util.one(
    ctx.app,
    "SELECT (SELECT COUNT(*) FROM proposals WHERE status = 'waiting') AS proposals, (SELECT COUNT(*) FROM suggestions WHERE status = 'open') AS suggestions, (SELECT COUNT(*) FROM asks WHERE status IN ('waiting', 'working')) AS asks_open, (SELECT COUNT(*) FROM asks WHERE status = 'answered') AS asks_answered",
    { proposals: 0, suggestions: 0, asks_open: 0, asks_answered: 0 },
    {},
  );
  return util.plain([r])[0];
}

module.exports = {
  ask: ask,
  KINDS: KINDS,
  request: request,
  askOut: askOut,
  askCreate: askCreate,
  askList: askList,
  askGet: askGet,
  askWorking: askWorking,
  askAnswer: askAnswer,
  askFail: askFail,
  askDelete: askDelete,
  proposalOut: proposalOut,
  genericPreview: genericPreview,
  proposeOrRun: proposeOrRun,
  proposals: proposals,
  approve: approve,
  reject: reject,
  returnBack: returnBack,
  withdraw: withdraw,
  SUGGESTABLE: SUGGESTABLE,
  suggestionOut: suggestionOut,
  suggestionList: suggestionList,
  suggestionCreate: suggestionCreate,
  suggestionAccept: suggestionAccept,
  suggestionDismiss: suggestionDismiss,
  brief: brief,
  status: status,
};
