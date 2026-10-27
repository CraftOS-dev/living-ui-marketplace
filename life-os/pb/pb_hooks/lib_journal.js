/// <reference path="../pb_data/types.d.ts" />
/**
 * The journal: free writing. An entry is a day, the text, how the day felt
 * (a mood sticker), the weather that day (filled in by itself), the areas
 * it touches and maybe a photo. The page saves as the person types
 * (journal.write creates the entry the first time and updates it after).
 * Entries are private by default: your AI agent reads one only when the
 * person shares it, and nothing when Settings say never.
 *
 * The week's recap fills itself from the numbers; your AI agent may add its
 * own paragraph (recaps), which is its writing, never the person's.
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

function agentMay(app) {
  return core().prefs(app).reflections_to_agent !== 'never';
}

function out(j) {
  const util = u();
  const body = j.getString('body');
  return {
    id: j.id,
    date: j.getString('date'),
    body: body,
    words: body.trim() === '' ? 0 : body.trim().split(/\s+/).length,
    mood: j.getInt('mood'),
    weather: util.jsonOf(j, 'weather'),
    tags: util.jsonOf(j, 'tags') || [],
    has_photo: j.getString('photo') !== '',
    photo_key: j.getString('photo'),
    privacy: j.getString('privacy') || 'private',
    created: j.getString('created'),
    updated: j.getString('updated'),
  };
}

function need(ctx, id) {
  const util = u();
  const j = core().need(ctx.app, 'journal_entries', id, 'journal entry');
  if (ctx.isAgent && (j.getString('privacy') !== 'shared_with_agent' || !agentMay(ctx.app))) throw util.fail(403, 'This entry is private: only the person reads it.', 'private_record');
  return j;
}

/** journal.list: entries, newest first (your AI agent sees only shared ones). */
function list(ctx, p) {
  const util = u();
  const C = core();
  const where = [];
  const bind = {};
  if (ctx.isAgent) {
    if (!agentMay(ctx.app)) return { entries: [], hidden: true, more: false };
    where.push("privacy = 'shared_with_agent'");
  }
  const from = util.day(p, 'from', '');
  const to = util.day(p, 'to', '');
  if (from !== '') {
    where.push('date >= {:f}');
    bind.f = from;
  }
  if (to !== '') {
    where.push('date <= {:t}');
    bind.t = to;
  }
  const tag = C.kind(p, 'tag', false) || '';
  if (tag !== '') {
    where.push('tags ~ {:tag}');
    bind.tag = '"' + tag + '"';
  }
  if (util.bool(p, 'photos', false)) where.push("photo != ''");
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push('body ~ {:q}');
    bind.q = q;
  }
  const pg = util.page(p, 40, 500);
  const recs = ctx.app.findRecordsByFilter('journal_entries', where.join(' && '), '-date,-created', pg.limit + 1, pg.offset, bind);
  const res = { entries: recs.slice(0, pg.limit).map(out), more: recs.length > pg.limit };
  if (ctx.isAgent) {
    // Your AI agent may know a private page exists (the day only, never a word of it).
    const pw = ["privacy != 'shared_with_agent'"];
    if (from !== '') pw.push('date >= {:f}');
    if (to !== '') pw.push('date <= {:t}');
    res.private_days = ctx.app.findRecordsByFilter('journal_entries', pw.join(' && '), '-date', 60, 0, bind).map((r) => r.getString('date')).filter((d, i, a) => a.indexOf(d) === i);
  }
  return res;
}

/** journal.get */
function get(ctx, p) {
  return { entry: out(need(ctx, u().req(p, 'entry'))) };
}

/** journal.write: write (the first save makes the entry; later saves update it). */
function write(ctx, p) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const id = util.str(p, 'entry', '');
  const files = ctx.e ? util.uploadedAll(ctx.e, 'photo') : [];
  let outId = '';
  app.runInTransaction((tx) => {
    let j;
    const creating = id === '';
    if (creating) {
      j = util.newRecord(tx, 'journal_entries');
      j.set('date', util.day(p, 'date', C.today(tx)));
      j.set('privacy', 'private');
      j.set('tags', []);
      j.set('actor', ctx.actor);
      if (j.getString('date') === C.today(tx)) {
        const w = require(`${__hooks}/lib_world.js`).brief(tx);
        if (w !== null) j.set('weather', w);
      }
    } else {
      j = C.need(tx, 'journal_entries', id, 'journal entry');
    }
    if (!creating && util.has(p, 'date')) j.set('date', util.day(p, 'date', j.getString('date')));
    if (util.has(p, 'body')) j.set('body', util.text(p, 'body', 40000, ''));
    if (util.has(p, 'mood')) j.set('mood', util.int(p, 'mood', 0, 0, 5));
    if (util.has(p, 'tags')) {
      const tags = (util.list(p, 'tags') || []).map(String);
      tags.forEach((t) => {
        if (C.KINDS.indexOf(t) < 0) throw util.fail(400, 'tags are areas: ' + C.KINDS.join(', '), 'invalid_param', { param: 'tags' });
      });
      j.set('tags', tags.filter((t, i, a) => a.indexOf(t) === i));
    }
    if (util.has(p, 'privacy')) j.set('privacy', util.oneOf(p, 'privacy', ['private', 'shared_with_agent'], 'private'));
    if (files.length > 0) j.set('photo', files[0]);
    if (util.bool(p, 'remove_photo', false)) j.set('photo', null);
    if (creating && j.getString('body').trim() === '' && files.length === 0 && j.getInt('mood') === 0) throw util.fail(400, 'An entry needs some words, a mood or a photo.', 'missing_param', { param: 'body' });
    tx.save(j);
    if (creating) act().write(tx, ctx, { label: 'Wrote in the journal (' + C.words(tx, j.getString('date')) + ')', target: 'journal_entries', record: j.id });
    // The day's mood follows the newest entry that has one.
    if (util.has(p, 'mood') && j.getInt('mood') > 0) {
      const D = require(`${__hooks}/lib_days.js`);
      const d = D.ensure(tx, j.getString('date'));
      d.set('mood', j.getInt('mood'));
      tx.save(d);
    }
    outId = j.id;
  });
  return { entry: out(app.findRecordById('journal_entries', outId)) };
}

/** journal.delete */
function remove(ctx, p) {
  const util = u();
  const j = core().need(ctx.app, 'journal_entries', util.req(p, 'entry'), 'journal entry');
  ctx.app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('journal_entries', j.id));
    act().write(tx, ctx, { label: 'Deleted a journal entry (' + core().words(tx, j.getString('date')) + ')', target: 'journal_entries', record: j.id });
  });
  return { deleted: true };
}

/** journal.photo: the picture (your AI agent gets where it is on disk, for shared entries). */
function photo(ctx, p) {
  const util = u();
  const j = need(ctx, util.req(p, 'entry'));
  const name = j.getString('photo');
  if (name === '') throw util.fail(404, 'This entry has no photo.', 'not_found');
  if (ctx.isAgent) return { entry: j.id, photo_path: util.filePath(ctx.app, j, 'photo') };
  const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : 'image/jpeg';
  const key = j.baseFilesPath() + '/' + name;
  const fsys = ctx.app.newFilesystem();
  try {
    const reader = fsys.getReader(key);
    try {
      ctx.e.response.header().set('Cache-Control', 'private, max-age=31536000, immutable');
      ctx.e.response.header().set('X-Content-Type-Options', 'nosniff');
      ctx.e.stream(200, mime, reader);
    } finally {
      reader.close();
    }
  } finally {
    fsys.close();
  }
  return { __streamed: true };
}

/** journal.memories: entries from this day in earlier months and years. */
function memories(ctx, p) {
  const util = u();
  const C = core();
  if (ctx.isAgent) return { entries: [] };
  const t0 = util.day(p, 'date', C.today(ctx.app));
  const bind = {};
  const ors = [];
  let i = 0;
  for (let m = 1; m <= 12; m++) {
    bind['d' + i] = C.addMonths(t0, -m);
    ors.push('date = {:d' + i++ + '}');
  }
  for (let y = 2; y <= 10; y++) {
    bind['d' + i] = C.addMonths(t0, -12 * y);
    ors.push('date = {:d' + i++ + '}');
  }
  return { entries: ctx.app.findRecordsByFilter('journal_entries', ors.join(' || '), '-date', 12, 0, bind).map(out) };
}

/** journal.heat: how much was written on each day of the last year. */
function heat(ctx, p) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  const span = util.int(p || {}, 'days', 365, 7, 365);
  const from = C.addDays(today, -(span - 1));
  const by = {};
  util.rows(ctx.app, 'SELECT date AS d, COUNT(*) AS n, MAX(mood) AS mood FROM journal_entries WHERE date >= {:f} AND date <= {:t} GROUP BY date', { d: '', n: 0, mood: 0 }, { f: from, t: today }).forEach((r) => (by[r.d] = r));
  const days = [];
  for (let i = 0; i < span; i++) {
    const d = C.addDays(from, i);
    days.push({ date: d, n: by[d] ? by[d].n : 0, mood: by[d] ? by[d].mood : 0 });
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].n > 0) streak += 1;
    else if (i === days.length - 1) continue;
    else break;
  }
  return { from: from, to: today, days: days, entries: days.reduce((a, d) => a + d.n, 0), streak: streak };
}

/* --------------------------------------------------------------- recap */

/** recap.week: the week in numbers, with your AI agent's paragraph when it wrote one. */
function recap(ctx, p) {
  const util = u();
  const C = core();
  const app = ctx.app;
  const today = C.today(app);
  const start = C.weekStart(app, util.day(p, 'date', today));
  const end = C.addDays(start, 6);
  const bind = { s: start, e: end };
  const n = (sql) => util.count(app, sql, bind);
  const tasks = n("SELECT COUNT(*) AS n FROM tasks WHERE state = 'done' AND done_date >= {:s} AND done_date <= {:e}");
  const habitDays = n("SELECT COUNT(*) AS n FROM habit_logs WHERE state = 'done' AND date >= {:s} AND date <= {:e}");
  const workouts = n('SELECT IFNULL(SUM(minutes), 0) AS n FROM workouts WHERE date >= {:s} AND date <= {:e}');
  const focus = n('SELECT IFNULL(SUM(minutes), 0) AS n FROM focus_sessions WHERE date >= {:s} AND date <= {:e}');
  const spent = n("SELECT IFNULL(SUM(amount), 0) AS n FROM money_entries WHERE kind = 'spend' AND date >= {:s} AND date <= {:e}");
  const touches = n('SELECT COUNT(DISTINCT person) AS n FROM interactions WHERE date >= {:s} AND date <= {:e}');
  const entries = n('SELECT COUNT(*) AS n FROM journal_entries WHERE date >= {:s} AND date <= {:e}');
  const pages = util.one(app, "SELECT COUNT(*) AS n FROM books WHERE status = 'done' AND finished_on >= {:s} AND finished_on <= {:e}", { n: 0 }, bind);
  const moods = util.rows(app, 'SELECT date AS d, mood FROM days WHERE date >= {:s} AND date <= {:e} AND mood > 0', { d: '', mood: 0 }, bind);
  const best = moods.length > 0 ? moods.reduce((a, b) => (b.mood > a.mood ? b : a)) : null;
  const wins = app.findRecordsByFilter('wins', 'date >= {:s} && date <= {:e}', 'date', 20, 0, bind).map((w) => w.getString('text'));
  const goals = app.findRecordsByFilter('goals', "state = 'active' && last_activity >= {:s}", 'rank', 10, 0, bind).map((g) => ({ id: g.id, title: g.getString('title'), progress: g.getFloat('progress'), area: g.getString('area') }));
  const r = util.findOne(app, 'recaps', 'week_start = {:s}', { s: start });
  return {
    week_start: start,
    week_end: end,
    numbers: { tasks_done: tasks, habit_days: habitDays, workout_min: workouts, focus_min: focus, spent: spent, people: touches, journal: entries, books_finished: pages === null ? 0 : pages.n },
    mood: moods.map((m) => ({ date: m.d, mood: m.mood })),
    best_day: best === null ? '' : best.d,
    wins: wins,
    goals_moved: goals,
    agent_text: r === null ? '' : r.getString('text'),
    agent_written_at: r === null ? '' : r.getString('written_at'),
  };
}

/** recap.write: your AI agent's paragraph for a week (empty text clears it). */
function recapWrite(ctx, p) {
  const util = u();
  const C = core();
  const start = C.weekStart(ctx.app, util.day(p, 'date', C.today(ctx.app)));
  const text = util.text(p, 'text', 12000, '');
  if (C.hasEmoji(text)) throw util.fail(400, 'No emoji, please.', 'emoji_not_allowed', { param: 'text' });
  ctx.app.runInTransaction((tx) => {
    const r = util.findOne(tx, 'recaps', 'week_start = {:s}', { s: start }) || util.newRecord(tx, 'recaps');
    r.set('week_start', start);
    r.set('text', text);
    r.set('written_at', text === '' ? '' : util.nowIso());
    tx.save(r);
    act().write(tx, ctx, { label: (text === '' ? 'Cleared' : 'Wrote') + ' the recap of the week of ' + C.words(tx, start), target: 'recaps', record: r.id });
  });
  return recap(ctx, { date: start });
}

module.exports = { out: out, list: list, get: get, write: write, remove: remove, photo: photo, memories: memories, heat: heat, recap: recap, recapWrite: recapWrite };
