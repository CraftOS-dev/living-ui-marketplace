/// <reference path="../pb_data/types.d.ts" />
/**
 * Practice: every pass at the piano is a run. The practice screen judges the
 * playing as it happens (in the browser) and saves one run when a pass ends;
 * here the run moves each section it covered through its stages, extends the
 * open session and suggests the next tempo.
 *
 * Sessions are sittings: the first run opens one, twenty quiet minutes (or
 * the person's "End session") close it, and a closed session of three
 * minutes or more asks the coach for a review (session_review).
 */

const IDLE_MS = 20 * 60000;
const REVIEW_MIN_MINUTES = 3;

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}

/* --------------------------------------------------------------- sessions */

function openSession(app, day, durationMs) {
  const u = U();
  const now = Date.now();
  const open = app.findRecordsByFilter('sessions', "status = 'open'", '-last_at', 0, 0);
  let sess = null;
  for (const s of open) {
    const quiet = now - u.ms(s.getString('last_at'));
    if (sess === null && quiet < IDLE_MS && s.getString('day') === day) sess = s;
    else close(app, s);
  }
  if (sess === null) {
    sess = new Record(app.findCollectionByNameOrId('sessions'));
    sess.set('day', day);
    sess.set('started', u.pbTime(now - Math.max(0, durationMs)));
    sess.set('minutes', 0);
    sess.set('runs', 0);
    sess.set('songs', []);
    sess.set('status', 'open');
  }
  return sess;
}

function close(app, s) {
  s.set('status', 'closed');
  if (s.getString('ended') === '') s.set('ended', s.getString('last_at') || U().now());
  app.save(s);
}

function sessionJson(s, full) {
  const out = {
    id: s.id,
    day: s.getString('day'),
    started: s.getString('started'),
    ended: s.getString('ended'),
    last_at: s.getString('last_at'),
    minutes: Math.round(s.getFloat('minutes') * 10) / 10,
    runs: s.getInt('runs'),
    songs: U().getJson(s, 'songs') || [],
    status: s.getString('status'),
    review: s.getString('review'),
    review_at: s.getString('review_at'),
    review_asked: s.getBool('review_asked'),
  };
  if (!full && out.review.length > 400) out.review = out.review.slice(0, 400) + '…';
  return out;
}

/* ------------------------------------------------------------------- runs */

function save(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'record practice (runs come from the person playing)');
  const rec = m.song(app, u.req(p, 'song', '<song id>'));
  const model = m.modelOf(rec);
  if (model === null || !model.bars || model.bars.length === 0) throw u.fail(400, 'This song has no music to practise.');
  const first = model.bars[0].n;
  const last = model.bars[model.bars.length - 1].n;
  const mode = u.oneOf(p, 'mode', ['listen', 'learn', 'play'], '');
  if (mode === '') throw u.fail(400, 'mode is required: listen, learn or play');
  const from = u.int(p, 'from_bar', first, first, last);
  const to = u.int(p, 'to_bar', last, from, last);
  const hands = u.oneOf(p, 'hands', ['both', 'right', 'left'], 'both');
  const tempo = u.number(p, 'tempo_pct', { min: 10, max: 200 }) || 100;
  const durationMs = Math.min(3 * 3600000, Math.max(0, u.number(p, 'duration_ms', { min: 0 }) || 0));
  const expected = u.int(p, 'expected', 0, 0, 1000000);
  const hits = u.int(p, 'hits', 0, 0, 1000000);
  const wrong = u.int(p, 'wrong', 0, 0, 1000000);
  const missed = u.int(p, 'missed', 0, 0, 1000000);
  const mad = u.number(p, 'timing_mad', {});
  const bias = u.number(p, 'timing_bias', {});
  const complete = u.bool(p, 'complete', true);
  const perBar = u.list(p, 'per_bar', '[[1,8,7,1,1]]') || [];
  if (perBar.length > 4000) throw u.fail(400, 'per_bar is too long');
  const byBar = {};
  for (const row of perBar) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const n = Number(row[0]);
    const prev = byBar[n] || [0, 0, 0, 0];
    byBar[n] = [prev[0] + (Number(row[1]) || 0), prev[1] + (Number(row[2]) || 0), prev[2] + (Number(row[3]) || 0), prev[3] + (Number(row[4]) || 0)];
  }

  let accuracy = 0;
  if (mode === 'play' && expected + wrong > 0) accuracy = hits / (expected + wrong);
  if (mode === 'learn' && expected > 0) accuracy = hits / expected;
  accuracy = Math.max(0, Math.min(1, accuracy));
  const threshold = m.cleanThreshold(app);
  const clean = mode === 'play' && complete && expected > 0 && accuracy >= threshold;
  const day = m.dayKey();
  const songHands = rec.getString('hands') || 'both';
  const fullHands = hands === 'both' || hands === songHands;

  /* sections */
  const secs = m.sectionsOf(rec);
  const prog = m.progress(app, rec.id);
  const states = m.statesOf(prog, secs.length);
  const results = [];
  let anyCold = false;
  if (complete && mode !== 'listen') {
    for (let i = 0; i < secs.length; i++) {
      const sec = secs[i];
      if (sec.from < from || sec.to > to) continue;
      let exp = 0;
      let hit = 0;
      let wr = 0;
      let miss = 0;
      for (let b = sec.from; b <= sec.to; b++) {
        const v = byBar[b];
        if (v === undefined) continue;
        exp += v[0];
        hit += v[1];
        wr += v[2];
        miss += v[3];
      }
      const st = states[i];
      const before = st.stage;
      st.tries = (st.tries || 0) + 1;
      st.last_day = day;
      if (st.stage === 'new') st.stage = 'learning';
      let acc = null;
      let secClean = false;
      let cold = false;
      if (mode === 'play' && exp > 0) {
        acc = hit / (exp + wr);
        secClean = acc >= threshold;
        cold = st.play_day !== day;
        if (cold) anyCold = true;
        st.play_day = day;
        st.acc = r3(acc);
        if (secClean && fullHands) {
          st.best = Math.max(st.best || 0, Math.round(tempo));
          if (tempo >= 100) {
            if (st.stage === 'learning') {
              st.cleans = st.clean_day === day ? (st.cleans || 0) + 1 : 1;
              st.clean_day = day;
              if (st.cleans >= 3) {
                st.stage = 'steady';
                st.steady_day = day;
              }
            } else if (st.stage === 'steady') {
              if (cold && st.steady_day !== '' && st.steady_day < day) {
                st.stage = 'mastered';
                st.iv = 2;
                st.due = m.addDays(day, 2);
              }
            } else if (st.stage === 'mastered' && cold) {
              st.iv = Math.min(64, Math.max(2, (st.iv || 2) * 2));
              st.due = m.addDays(day, st.iv);
            }
          }
        } else if (!secClean && fullHands && cold && st.stage === 'mastered') {
          // A failed review: back to steady until it is clean cold again.
          st.stage = 'steady';
          st.steady_day = day;
          st.iv = 0;
          st.due = '';
        }
      }
      results.push({ i: i, name: sec.name, from: sec.from, to: sec.to, before: before, after: st.stage, acc: acc === null ? null : r3(acc), clean: secClean, cold: cold, best: st.best || 0, cleans: st.clean_day === day ? st.cleans || 0 : 0 });
    }
  }
  prog.set('sections', states);
  prog.set('runs', (prog.getInt('runs') || 0) + 1);
  prog.set('minutes', prog.getFloat('minutes') + durationMs / 60000);
  prog.set('last_at', u.now());
  app.save(prog);

  /* session */
  const sess = openSession(app, day, durationMs);
  sess.set('minutes', sess.getFloat('minutes') + durationMs / 60000);
  sess.set('runs', (sess.getInt('runs') || 0) + 1);
  sess.set('last_at', u.now());
  const songsIn = u.getJson(sess, 'songs') || [];
  let entry = null;
  for (const s of songsIn) if (s.song === rec.id) entry = s;
  if (entry === null) {
    entry = { song: rec.id, title: rec.getString('title'), minutes: 0, runs: 0 };
    songsIn.push(entry);
  }
  entry.minutes = Math.round((entry.minutes + durationMs / 60000) * 100) / 100;
  entry.runs += 1;
  sess.set('songs', songsIn);
  app.save(sess);

  const run = new Record(app.findCollectionByNameOrId('runs'));
  run.set('song', rec.id);
  run.set('session', sess.id);
  run.set('day', day);
  run.set('mode', mode);
  run.set('from_bar', from);
  run.set('to_bar', to);
  run.set('hands', hands);
  run.set('tempo_pct', Math.round(tempo));
  run.set('bpm', Math.round(rec.getFloat('tempo') * tempo) / 100);
  run.set('duration_ms', Math.round(durationMs));
  run.set('expected', expected);
  run.set('hits', hits);
  run.set('wrong', wrong);
  run.set('missed', missed);
  run.set('accuracy', r3(accuracy));
  if (mad !== null) run.set('timing_mad', Math.round(mad));
  if (bias !== null) run.set('timing_bias', Math.round(bias));
  run.set('clean', clean);
  run.set('cold', anyCold);
  run.set('complete', complete);
  run.set('per_bar', perBar.slice(0, 4000));
  run.set('results', results);
  app.save(run);

  /* the learner's level follows the songs they master */
  let levelUp = 0;
  if (results.some((r) => r.after === 'mastered' && r.before !== 'mastered') && states.length > 0 && states.every((s) => s.stage === 'mastered')) {
    const st = m.settings(app);
    const lvl = rec.getInt('level') || 1;
    if (lvl > (st.getInt('level') || 1)) {
      st.set('level', lvl);
      app.save(st);
      levelUp = lvl;
    }
  }

  const advanced = require(`${__hooks}/lib_learn.js`).advance(app);
  if (advanced > levelUp) levelUp = advanced;

  let suggestion = null;
  if (mode === 'play' && complete) {
    if (clean && tempo < 100) suggestion = { tempo: Math.min(100, Math.round(tempo + (tempo < 70 ? 10 : 5))), why: 'up' };
    else if (clean) suggestion = { tempo: Math.round(tempo), why: 'hold' };
    else if (accuracy < 0.8) suggestion = { tempo: Math.max(30, Math.round(tempo - 10)), why: 'down' };
    else suggestion = { tempo: Math.round(tempo), why: 'again' };
  }
  return {
    run: runJson(run),
    results: results,
    song: m.songJson(app, rec, { progress: prog }),
    session: sessionJson(sess, false),
    suggestion: suggestion,
    level_up: levelUp,
  };
}

function runJson(r) {
  return {
    id: r.id,
    song: r.getString('song'),
    session: r.getString('session'),
    day: r.getString('day'),
    mode: r.getString('mode'),
    from_bar: r.getInt('from_bar'),
    to_bar: r.getInt('to_bar'),
    hands: r.getString('hands'),
    tempo_pct: r.getFloat('tempo_pct'),
    bpm: r.getFloat('bpm'),
    duration_ms: r.getInt('duration_ms'),
    expected: r.getInt('expected'),
    hits: r.getInt('hits'),
    wrong: r.getInt('wrong'),
    missed: r.getInt('missed'),
    accuracy: r.getFloat('accuracy'),
    timing_mad: r.getFloat('timing_mad'),
    timing_bias: r.getFloat('timing_bias'),
    clean: r.getBool('clean'),
    cold: r.getBool('cold'),
    complete: r.getBool('complete'),
    created: r.getString('created'),
  };
}

function list(app, p) {
  const u = U();
  const m = M();
  const days = u.int(p, 'days', 7, 1, 400);
  const limit = u.int(p, 'limit', 50, 1, 500);
  const since = m.addDays(m.dayKey(), -(days - 1));
  const song = u.str(p, 'song', '');
  const filter = song !== '' ? 'day >= {:d} && song = {:s}' : 'day >= {:d}';
  const rows = app.findRecordsByFilter('runs', filter, '-created', limit, 0, { d: since, s: song });
  const titles = {};
  return {
    runs: rows.map((r) => {
      const j = runJson(r);
      const sid = j.song;
      if (titles[sid] === undefined) {
        const s = u.byId(app, 'songs', sid);
        titles[sid] = s === null ? '' : s.getString('title');
      }
      j.title = titles[sid];
      return j;
    }),
  };
}

/* ---------------------------------------------------- session operations */

function sessionsList(app, p) {
  const u = U();
  const limit = u.int(p, 'limit', 20, 1, 200);
  const rows = app.findRecordsByFilter('sessions', '', '-started', limit, 0);
  return { sessions: rows.map((s) => sessionJson(s, false)) };
}

function sessionGet(app, p) {
  const u = U();
  const s = u.byId(app, 'sessions', u.req(p, 'session', '<session id>'));
  if (s === null) throw u.fail(404, 'No session ' + p.session + '. sessions.list shows them.');
  const runs = app.findRecordsByFilter('runs', 'session = {:s}', 'created', 0, 0, { s: s.id });
  return { session: sessionJson(s, true), runs: runs.map(runJson) };
}

/** Ask the coach for a review of a closed session; true when the request went out. */
function askReview(app, s) {
  const m = M();
  if (s.getBool('review_asked') || s.getString('review') !== '') return { asked: false, reason: 'already asked' };
  if (s.getFloat('minutes') < REVIEW_MIN_MINUTES) return { asked: false, reason: 'shorter than ' + REVIEW_MIN_MINUTES + ' minutes' };
  if (!m.settings(app).getBool('coach_reviews')) return { asked: false, reason: 'session reviews are off in Settings' };
  const key = 'pc_review_tries_' + s.id;
  const tries = Number(app.store().get(key) || 0);
  if (tries >= 3) return { asked: false, reason: 'the coach could not be asked' };
  const res = require(`${__hooks}/_triggers_lib.js`).fire(app, 'session_review', { session: s.id }, 'hook');
  if (res && res.ok) {
    s.set('review_asked', true);
    app.save(s);
    return { asked: true, request: res.id };
  }
  app.store().set(key, tries + 1);
  return { asked: false, reason: (res && res.message) || 'refused' };
}

function end(app, e, p) {
  const u = U();
  u.personOnly(e, 'end practice sessions');
  const id = u.str(p, 'session', '');
  let s = null;
  if (id !== '') s = u.byId(app, 'sessions', id);
  else {
    const open = app.findRecordsByFilter('sessions', "status = 'open'", '-last_at', 1, 0);
    s = open.length > 0 ? open[0] : null;
  }
  if (s === null) return { session: null, asked: false, reason: 'no open session' };
  if (s.getString('status') === 'open') {
    s.set('status', 'closed');
    s.set('ended', u.now());
    app.save(s);
  }
  const r = askReview(app, s);
  return { session: sessionJson(s, false), asked: r.asked, reason: r.reason || '' };
}

function review(app, e, p) {
  const u = U();
  u.agentOnly(e, 'write session reviews');
  const s = u.byId(app, 'sessions', u.req(p, 'session', '<session id>'));
  if (s === null) throw u.fail(404, 'No session ' + p.session + '.');
  const text = u.req(p, 'text', '"Clean run of bars 1-8 at 90%..."');
  if (text.length > 6000) throw u.fail(400, 'text is longer than 6,000 characters; keep a review short.');
  const replaced = s.getString('review') !== '';
  s.set('review', text);
  s.set('review_at', u.now());
  app.save(s);
  // Reviewing the same session again corrects the review: one message in the chat, updated.
  const old = app.findRecordsByFilter('messages', "kind = 'review' && session = {:s}", '-created', 1, 0, { s: s.id });
  const msg = old.length > 0 ? old[0] : new Record(app.findCollectionByNameOrId('messages'));
  msg.set('role', 'coach');
  msg.set('kind', 'review');
  msg.set('text', text);
  msg.set('session', s.id);
  app.save(msg);
  return { ok: true, replaced: replaced, session: sessionJson(s, true), message: msg.id };
}

/** Every minute: close quiet sessions and ask for their reviews. */
function tick(app) {
  const u = U();
  const now = Date.now();
  for (const s of app.findRecordsByFilter('sessions', "status = 'open'", '', 0, 0)) {
    if (now - u.ms(s.getString('last_at')) >= IDLE_MS) close(app, s);
  }
  const since = u.pbTime(now - 12 * 3600000);
  for (const s of app.findRecordsByFilter('sessions', "status = 'closed' && review_asked = false && review = '' && ended >= {:t}", '-ended', 3, 0, { t: since })) askReview(app, s);
}

/* ------------------------------------------------------------ review pack */

/** What the coach needs to review a session, kept short. */
function pack(app, p) {
  const u = U();
  const m = M();
  let s = null;
  const id = u.str(p, 'session', '');
  if (id !== '') s = u.byId(app, 'sessions', id);
  else {
    const rows = app.findRecordsByFilter('sessions', '', '-started', 1, 0);
    s = rows.length > 0 ? rows[0] : null;
  }
  if (s === null) throw u.fail(404, id !== '' ? 'No session ' + id + '.' : 'No practice yet.');
  const st = m.settings(app);
  const runs = app.findRecordsByFilter('runs', 'session = {:s}', 'created', 0, 0, { s: s.id });
  const bySong = {};
  const order = [];
  for (const r of runs) {
    const sid = r.getString('song');
    if (bySong[sid] === undefined) {
      bySong[sid] = [];
      order.push(sid);
    }
    bySong[sid].push(r);
  }
  const songs = [];
  for (const sid of order) {
    const rec = u.byId(app, 'songs', sid);
    if (rec === null) continue;
    const j = m.songJson(app, rec, {});
    const rs = bySong[sid];
    const changes = [];
    const runOut = [];
    for (const r of rs) {
      for (const c of u.getJson(r, 'results') || []) if (c.before !== c.after) changes.push(c.name + ': ' + c.before + ' → ' + c.after);
      if (runOut.length >= 12) continue;
      const weak = (u.getJson(r, 'per_bar') || [])
        .filter((b) => (Number(b[3]) || 0) + (Number(b[4]) || 0) > 0)
        .sort((a, b) => Number(b[3]) + Number(b[4]) - (Number(a[3]) + Number(a[4])))
        .slice(0, 4)
        .map((b) => ({ bar: b[0], wrong: b[3], missed: b[4] }));
      const o = { mode: r.getString('mode'), bars: r.getInt('from_bar') + '-' + r.getInt('to_bar'), hands: r.getString('hands'), tempo: r.getFloat('tempo_pct'), seconds: Math.round(r.getInt('duration_ms') / 1000) };
      if (r.getString('mode') !== 'listen') {
        o.accuracy = r.getFloat('accuracy');
        o.wrong = r.getInt('wrong');
        o.missed = r.getInt('missed');
      }
      if (r.getString('mode') === 'play') {
        o.clean = r.getBool('clean');
        const mad = r.getFloat('timing_mad');
        const bias = r.getFloat('timing_bias');
        o.timing_ms = mad === 0 && bias === 0 ? null : { mean_abs: mad, bias: bias };
        if (weak.length > 0) o.weak_bars = weak;
      }
      runOut.push(o);
    }
    songs.push({
      id: j.id,
      title: j.title,
      level: j.level,
      bpm: j.tempo,
      sections: j.sections.map((x) => ({ name: x.name, bars: x.from + '-' + x.to, stage: x.stage, best_tempo: x.best, due: x.due })),
      runs: runOut,
      more_runs: Math.max(0, rs.length - runOut.length),
      stage_changes: changes,
      coach_note: j.note,
    });
  }
  const drills = app.findRecordsByFilter('drills', "session = {:s} && drill != 'lesson'", 'created', 40, 0, { s: s.id }).map((d) => ({
    drill: d.getString('drill'),
    skill: d.getString('skill'),
    title: d.getString('title'),
    items: d.getInt('items'),
    accuracy: d.getFloat('accuracy'),
    avg_ms: Math.round(d.getFloat('avg_ms')),
    tempo: d.getFloat('tempo_pct') || undefined,
    level: d.getInt('level') || undefined,
    minutes: Math.round(d.getFloat('duration_ms') / 6000) / 10,
  }));
  const lessonMinutes = {};
  for (const d of app.findRecordsByFilter('drills', "session = {:s} && drill = 'lesson'", 'created', 40, 0, { s: s.id })) {
    const key = (u.getJson(d, 'detail') || {}).lesson || '';
    lessonMinutes[key] = (lessonMinutes[key] || 0) + d.getFloat('duration_ms') / 60000;
  }
  const started = s.getString('started');
  const ended = s.getString('ended') || u.now();
  const lessonsDone = app.findRecordsByFilter('lessons', 'updated >= {:a} && updated <= {:b}', '', 20, 0, { a: started, b: ended }).map((l) => {
    const def = require(`${__hooks}/lib_curriculum.js`).lesson(l.getString('key'));
    return { lesson: l.getString('key'), title: def ? def.title : '', score: l.getFloat('score'), minutes: Math.round((lessonMinutes[l.getString('key')] || 0) * 10) / 10 };
  });
  const prev = app.findRecordsByFilter('sessions', "review != '' && started < {:t}", '-started', 1, 0, { t: s.getString('started') });
  const stats = require(`${__hooks}/lib_stats.js`);
  return {
    session: sessionJson(s, false),
    learner: { level: st.getInt('level') || 1, goal_minutes: st.getInt('daily_minutes') || 20, strictness: st.getString('strictness') || 'normal', streak_days: stats.streak(app) },
    songs: songs,
    drills: drills,
    lessons: lessonsDone,
    previous_review: prev.length > 0 ? prev[0].getString('review').slice(0, 600) : '',
    stages: 'new → learning (tempo climbs) → steady (3 clean passes at full tempo in a day) → mastered (clean at full tempo on the first try of a later day; reviewed after 2, 4, 8 … days)',
    units: 'tempo: percent of the song tempo; bpm: quarter notes per minute; accuracy: 0-1; timing_ms: mean distance from the beat and its bias (negative = early), null when not measured; wrong and missed notes are not split by hand (runs played with one hand say so in hands); session minutes include drills and lessons',
  };
}

module.exports = { save: save, list: list, sessionsList: sessionsList, sessionGet: sessionGet, end: end, review: review, tick: tick, pack: pack, runJson: runJson, openSession: openSession };
