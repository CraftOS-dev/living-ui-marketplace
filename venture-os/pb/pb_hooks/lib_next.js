/// <reference path="../pb_data/types.d.ts" />
/**
 * Next: the one queue of everything that needs a person (SPEC 4.3). Every
 * module exports `needsYou: 'lib_x.fn'` in its events_*.js; fn(ctx) answers
 * NextItem[] for that person. list() merges them, applies the person's
 * snoozes, sorts by rank then time, and pages:
 *
 *   { key: 'intake:<id>',           // stable, unique across modules
 *     kind: 'verdict',              // see KINDS
 *     card: 'triage',               // optional custom renderer key; else the generic card
 *     title: 'Acme Robotics',
 *     figures: [{ label: 'Raise', value: 'USD 3M' }],    // at most 3, already formatted
 *     chips: [{ label: 'Seed', tone: 'neutral' }],       // tones: neutral, good, warn, bad, agent
 *     steps: { labels: ['Received','Reading','Facts','Ready'], at: 3 },   // optional StepTrack
 *     agent: true,                  // prepared by your AI agent
 *     rank: 20,                     // 10 decisions due today, 20 verdicts, 30 approvals, 40 verify, 50 alerts, 60 other
 *     at: '2026-11-12T09:00:00Z',
 *     href: '#/deals/D-0012',
 *     data: { ... },                // optional extra for a custom card
 *     actions: [{ label, op, params, primary, pin, confirm, choose: { param, options: [{ value, label }] } | null,
 *                 done: 'Passed',                  // optional: the text of the result toast
 *                 undo: { op, params },             // optional: the op that reverses it (the toast's Undo)
 *                 tone: 'neutral' }] }              // optional: neutral | good | warn | bad (the button's colour of meaning)
 *
 * Items with an unknown kind or without key, title or actions shape are
 * dropped and reported in `errors` (never a 5xx). Actions whose op the
 * person may not run are left out. A module whose needsYou throws is
 * reported in `errors` and the rest still answer.
 */

const KINDS = ['verdict', 'draft', 'proposal', 'vote', 'decision', 'verify', 'alert', 'condition', 'payment', 'mark', 'candidate', 'note', 'task', 'stall'];
const TONES = ['neutral', 'good', 'warn', 'bad', 'agent'];
const ACTION_TONES = ['neutral', 'good', 'warn', 'bad'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** Per call: does the op exist, is it a confirm op, may this person run it (one catalog lookup per op). */
function opCheck(ctx, memo, op) {
  if (memo[op] !== undefined) return memo[op];
  const cat = L('lib_catalog');
  let r = { exists: false, confirm: false, may: false };
  if (cat.has(op)) {
    const spec = cat.get(op);
    r = { exists: true, confirm: spec.effect === 'confirm', may: ctx.isAgent || L('lib_auth').passes(ctx, spec) };
  }
  memo[op] = r;
  return r;
}

function clean(ctx, module, it, errors, memo0) {
  const u = L('lib_util');
  const memo = memo0 || {};
  const bad = (why) => {
    errors.push({ module: module, key: it && it.key ? String(it.key) : '', error: why });
    return null;
  };
  if (it === null || typeof it !== 'object') return bad('item is not an object');
  if (typeof it.key !== 'string' || it.key === '') return bad('key is required');
  if (KINDS.indexOf(it.kind) < 0) return bad('kind must be one of: ' + KINDS.join(', '));
  if (typeof it.title !== 'string' || it.title === '') return bad('title is required');
  const actions = [];
  for (const a of Array.isArray(it.actions) ? it.actions : []) {
    if (!a || typeof a.label !== 'string' || typeof a.op !== 'string') return bad('an action needs label and op');
    const chk = opCheck(ctx, memo, a.op);
    if (!chk.exists) return bad('action op ' + a.op + ' is not in the catalog');
    if (!chk.may) continue;
    const out = { label: u.clip(a.label, 40), op: a.op, params: a.params && typeof a.params === 'object' ? a.params : {}, primary: a.primary === true, pin: a.pin === true || chk.confirm, confirm: a.confirm === true, choose: null };
    if (a.done !== undefined && a.done !== null) out.done = u.clip(String(a.done), 120);
    if (a.tone !== undefined && a.tone !== null) out.tone = ACTION_TONES.indexOf(a.tone) >= 0 ? a.tone : 'neutral';
    if (a.undo !== undefined && a.undo !== null) {
      if (typeof a.undo !== 'object' || typeof a.undo.op !== 'string') return bad('undo needs op (and params)');
      if (!opCheck(ctx, memo, a.undo.op).exists) return bad('undo op ' + a.undo.op + ' is not in the catalog');
      out.undo = { op: a.undo.op, params: a.undo.params && typeof a.undo.params === 'object' ? a.undo.params : {} };
    }
    if (a.choose) {
      if (typeof a.choose.param !== 'string' || !Array.isArray(a.choose.options)) return bad('choose needs param and options');
      out.choose = { param: a.choose.param, options: a.choose.options.slice(0, 20).map((o) => ({ value: String(o.value), label: u.clip(String(o.label === undefined ? o.value : o.label), 40) })) };
    }
    actions.push(out);
  }
  const figures = (Array.isArray(it.figures) ? it.figures : []).slice(0, 3).map((f) => ({ label: u.clip(String((f && f.label) || ''), 30), value: u.clip(String(f && f.value !== undefined && f.value !== null ? f.value : ''), 60) }));
  const chips = (Array.isArray(it.chips) ? it.chips : []).slice(0, 6).map((c) => ({ label: u.clip(String((c && c.label) || ''), 30), tone: TONES.indexOf(c && c.tone) >= 0 ? c.tone : 'neutral' }));
  let steps = null;
  if (it.steps && Array.isArray(it.steps.labels)) steps = { labels: it.steps.labels.slice(0, 5).map((l) => u.clip(String(l), 16)), at: Math.max(0, Math.min(4, Math.round(Number(it.steps.at) || 0))) };
  return {
    key: it.key,
    module: module,
    kind: it.kind,
    card: typeof it.card === 'string' ? it.card : '',
    title: u.clip(it.title, 200),
    figures: figures,
    chips: chips,
    steps: steps,
    agent: it.agent === true,
    rank: Number.isFinite(Number(it.rank)) ? Number(it.rank) : 60,
    at: typeof it.at === 'string' ? it.at : '',
    href: typeof it.href === 'string' ? it.href : '',
    data: it.data && typeof it.data === 'object' ? it.data : null,
    actions: actions,
  };
}

/** Active snoozes of the person: { key: until }. */
function snoozed(ctx) {
  const u = L('lib_util');
  const out = {};
  if (!ctx.memberId) return out;
  const now = new Date().toISOString();
  for (const r of u.rows(ctx.app, 'SELECT key, until FROM snoozes WHERE member = {:m} AND until > {:n}', { key: '', until: '' }, { m: ctx.memberId, n: now })) out[r.key] = r.until;
  return out;
}

const VERSION_KEY = 'vo_data_version';
const CACHE_PREFIX = 'vo_next:';
const CACHE_MAX_MS = 60000;

/** The data version: a new token after every committed record change (hooks.pb.js) and every lib_bus.touch. */
function version(app) {
  const v = app.store().get(VERSION_KEY);
  return v === undefined || v === null ? '' : String(v);
}

/** Mark the data as changed (cached Next lists are rebuilt on their next read). */
function bump(app) {
  app.store().set(VERSION_KEY, String(Date.now()) + '.' + $security.randomStringWithAlphabet(6, 'abcdefghijklmnopqrstuvwxyz0123456789'));
}

function cacheKey(ctx) {
  return CACHE_PREFIX + (ctx.isAgent ? 'agent' : ctx.memberId || '-');
}

/**
 * Every provider's items for ctx, cleaned (snoozes not applied). Kept in the
 * app store (shared by every runtime of the pool) per person, tagged with
 * the data version and the firm's day, for at most a minute: a runtime that
 * never ran the modules' code answers from it. A record change anywhere,
 * a new day or a minute makes it build again.
 */
function gather(ctx) {
  const u = L('lib_util');
  const app = ctx.app;
  const tx = app.isTransactional();
  const ver = version(app);
  const day = u.today(app);
  const key = cacheKey(ctx);
  if (!tx && ver !== '') {
    const raw = app.store().get(key);
    if (typeof raw === 'string' && raw !== '') {
      try {
        const c = JSON.parse(raw);
        if (c.v === ver && c.d === day && Date.now() - c.t < CACHE_MAX_MS) return { items: c.items, errors: c.errors };
      } catch {
        /* rebuild */
      }
    }
  }
  const built = build(ctx);
  if (!tx && ver !== '') app.store().set(key, JSON.stringify({ v: ver, d: day, t: Date.now(), items: built.items, errors: built.errors }));
  return built;
}

/** Call every module's needsYou and clean what they answer. */
function build(ctx) {
  const errors = [];
  const items = [];
  const seen = {};
  const memo = {};
  const ev = L('lib_events');
  for (const s of ev.needsYouFns()) {
    let got = [];
    try {
      got = ev.resolve(s.fn)(ctx) || [];
    } catch (err) {
      console.error('[vo] needsYou ' + s.fn + ' failed:', err);
      errors.push({ module: s.module, key: '', error: String((err && err.message) || err) });
      continue;
    }
    for (const raw of Array.isArray(got) ? got : []) {
      const it = clean(ctx, s.module, raw, errors, memo);
      if (it === null) continue;
      if (seen[it.key]) {
        errors.push({ module: s.module, key: it.key, error: 'duplicate key' });
        continue;
      }
      seen[it.key] = true;
      items.push(it);
    }
  }
  return { items: items, errors: errors };
}

/** What a chip's tone says, for text readers: a thesis chip in bad tone is unmet, in good tone met. */
const TONE_WORD = { good: ' (yes)', bad: ' (no)', warn: ' (warning)', agent: ' (your AI agent)', neutral: '' };

/** Items in a few fields each (what your AI agent reads about someone's Next): kind, title, figures as "label value", module, href. */
function brief(items, n, lean) {
  return (items || []).slice(0, n || 10).map((it) => {
    // lean (what chat.get gives your AI agent): what and why only, one line of figures.
    if (lean) {
      const figs = (it.figures || []).map((f) => f.label + ' ' + f.value).filter((x) => x.trim() !== '');
      const chips = (it.chips || []).filter((c) => c.tone && c.tone !== 'neutral').map((c) => c.label + TONE_WORD[c.tone]);
      return { kind: it.kind, title: it.title, info: figs.concat(chips).join(', ') };
    }
    const o = { key: it.key, kind: it.kind, module: it.module, title: it.title };
    const figs = (it.figures || []).map((f) => f.label + ' ' + f.value).filter((x) => x.trim() !== '');
    if (figs.length > 0) o.figures = figs;
    const chips = (it.chips || []).filter((c) => c.label).map((c) => c.label + (TONE_WORD[c.tone] || ''));
    if (chips.length > 0) o.chips = chips;
    if (it.agent) o.prepared_by_agent = true;
    if (it.href) o.href = it.href;
    o.at = it.at;
    return o;
  });
}

/** Every item for ctx, cleaned, snoozes applied, sorted. { items, errors, snoozed } */
function collect(ctx, kinds) {
  const g = gather(ctx);
  const items = g.items;
  const errors = g.errors.slice();
  const sn = snoozed(ctx);
  let hidden = 0;
  const out = items.filter((it) => {
    if (sn[it.key] !== undefined) {
      hidden++;
      return false;
    }
    return !kinds || kinds.length === 0 || kinds.indexOf(it.kind) >= 0;
  });
  out.sort((a, b) => a.rank - b.rank || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || (a.key < b.key ? -1 : 1));
  return { items: out, errors: errors, snoozed: hidden };
}

function kindsParam(p) {
  const u = L('lib_util');
  let list;
  if (p && Array.isArray(p.kinds)) list = p.kinds.map(String);
  else {
    const raw = u.str(p, 'kinds', '');
    if (raw === '') return [];
    list = raw.charAt(0) === '[' ? u.list(p, 'kinds') : raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
  }
  for (const k of list) if (KINDS.indexOf(k) < 0) throw u.fail(400, 'kinds takes: ' + KINDS.join(', '), 'invalid_param', { param: 'kinds' });
  return list;
}

/** next.list: the queue for the caller ({ items, total, next_cursor, counts, snoozed, errors }). */
/**
 * --member: your AI agent reads a member's Next (their view and rights)
 * only while a question that member asked waits for its answer
 * (lib_agent.asking); people always read their own.
 */
function whose(ctx, p) {
  const u = L('lib_util');
  const ref = u.str(p || {}, 'member', '');
  if (ref === '') return ctx;
  if (!ctx.isAgent) throw u.fail(400, 'member is for your AI agent; your Next is always your own.', 'invalid_param', { param: 'member' });
  const auth = L('lib_auth');
  const m = auth.memberRef(ctx.app, ref);
  if (!L('lib_agent').asking(ctx.app, m.id)) throw u.fail(403, 'You read ' + m.getString('name') + "'s Next only while a question they asked you waits for your answer (chat.get --ask <id>).", 'no_open_question', { member: m.id });
  return auth.contextFor(ctx.app, m);
}

function list(ctx0, p) {
  const u = L('lib_util');
  const ctx = whose(ctx0, p);
  const limit = u.int(p, 'limit', 50, 1, 200);
  const cursor = u.int(p, 'cursor', 0, 0, 100000);
  const c = collect(ctx, kindsParam(p));
  const counts = {};
  for (const it of c.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
  const page = c.items.slice(cursor, cursor + limit);
  // Your AI agent reads the items, not the buttons: short rows (the actions by label) unless --full true.
  // Times as the firm's local day and time too (the asker reads them so).
  const zone = u.zoneOf(ctx.app);
  const localOf = (at) => {
    const ms = Date.parse(String(at || '').replace(' ', 'T'));
    if (!Number.isFinite(ms)) return '';
    const x = u.localAt(zone, ms);
    return x.day + ' ' + x.time;
  };
  const rows = ctx0.isAgent && !u.bool(p, 'full', false) ? brief(page, page.length).map((b, i) => Object.assign(b, { local: localOf(page[i].at), actions: (page[i].actions || []).map((a) => a.label) })) : page;
  return { items: rows, total: c.items.length, next_cursor: cursor + limit < c.items.length ? String(cursor + limit) : '', counts: counts, snoozed: c.snoozed, errors: c.errors };
}

/** next.count: how many items wait, by kind. */
function count(ctx0, p) {
  const c = collect(whose(ctx0, p), []);
  const byKind = {};
  for (const it of c.items) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
  return { total: c.items.length, by_kind: byKind, snoozed: c.snoozed };
}

/** next.snooze: hide an item until a day (firm zone, start of day) or a number of hours; --until '' wakes it now. */
function snooze(ctx, p) {
  const u = L('lib_util');
  if (!ctx.memberId) throw u.fail(400, 'Only a signed-in person has a Next queue.', 'invalid');
  const key = u.req(p, 'key');
  if (key.length > 200) throw u.fail(400, 'key is too long.', 'invalid_param', { param: 'key' });
  const hours = u.num(p, 'hours', { min: 0.25, max: 24 * 90 });
  const day = u.day(p, 'until', '');
  let until = '';
  if (hours !== null) until = new Date(Date.now() + hours * 3600000).toISOString();
  else if (day !== '') until = u.atOf(ctx.app, day, '08:00');
  else if (u.has(p, 'until') && u.str(p, 'until', '') === '') until = '';
  else until = u.atOf(ctx.app, u.dayAdd(u.today(ctx.app), 1), '08:00');
  const r = u.findOne(ctx.app, 'snoozes', 'member = {:m} && key = {:k}', { m: ctx.memberId, k: key });
  bump(ctx.app);
  if (until === '') {
    if (r !== null) ctx.app.delete(r);
    ctx.audited = true;
    return { key: key, until: '' };
  }
  const rec = r !== null ? r : u.newRecord(ctx.app, 'snoozes');
  rec.set('member', ctx.memberId);
  rec.set('key', key);
  rec.set('until', until);
  ctx.app.save(rec);
  ctx.audited = true;
  return { key: key, until: until };
}

/** Boot: build the cached lists of members seen in the last 30 days (at most 40), so first calls answer from the cache. */
function warm(app) {
  const u = L('lib_util');
  if (version(app) === '') bump(app);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = u.findMany(app, 'members', "status = 'active' && last_seen >= {:s}", '-last_seen', 40, { s: since });
  let n = 0;
  for (const m of rows) {
    try {
      gather(L('lib_auth').contextFor(app, m));
      n++;
    } catch (err) {
      console.error('[vo] Next warm-up for ' + m.id + ' failed:', err);
    }
  }
  return n;
}

/** Nightly: drop snoozes that ended. */
function cleanup(app) {
  const u = L('lib_util');
  u.exec(app, 'DELETE FROM snoozes WHERE until <= {:n}', { n: new Date().toISOString() });
}

/** The kernel's own items: proposals, outbound drafts, tasks due. */
function kernelItems(ctx) {
  return L('lib_proposals').nextItems(ctx).concat(L('lib_outbound').nextItems(ctx), L('lib_tasks').nextItems(ctx));
}

module.exports = { brief: brief, version: version, bump: bump, warm: warm, gather: gather, KINDS: KINDS, TONES: TONES, ACTION_TONES: ACTION_TONES, clean: clean, collect: collect, list: list, count: count, snooze: snooze, cleanup: cleanup, kernelItems: kernelItems };
