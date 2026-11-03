/// <reference path="../pb_data/types.d.ts" />
/**
 * Practice: every take of a song is a run. The practice screen judges the
 * singing as it happens (in the browser) and saves one run when a take ends;
 * here the run moves each section it covered through its stages, extends the
 * open session (time, voiced time, vocal dose) and suggests the next tempo.
 *
 * Sessions are sittings: the first run, drill or lesson opens one, twenty
 * quiet minutes (or the person's "End session") close it, and a closed
 * session of three minutes or more asks the coach for a review
 * (session_review), unless the agent is busy right now.
 */

const IDLE_MS = 20 * 60000;
const REVIEW_MIN_MINUTES = 3;
const AGENT_BUSY_MS = 90000;

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}
function r1(x) {
  return Math.round(x * 10) / 10;
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
    sess.set('voiced_s', 0);
    sess.set('cycles', 0);
    sess.set('runs', 0);
    sess.set('songs', []);
    sess.set('warmup_s', 0);
    sess.set('cooldown_s', 0);
    sess.set('status', 'open');
  }
  return sess;
}

/** Add time and voice use to the open session (runs, drills and lessons all count). */
function addToSession(app, day, p) {
  const u = U();
  const sess = openSession(app, day, p.ms || 0);
  sess.set('minutes', sess.getFloat('minutes') + (p.ms || 0) / 60000);
  sess.set('voiced_s', sess.getFloat('voiced_s') + (p.voiced_ms || 0) / 1000);
  sess.set('cycles', sess.getFloat('cycles') + (p.cycles || 0));
  if (p.warmup_ms) sess.set('warmup_s', sess.getFloat('warmup_s') + p.warmup_ms / 1000);
  if (p.cooldown_ms) sess.set('cooldown_s', sess.getFloat('cooldown_s') + p.cooldown_ms / 1000);
  if (p.run) sess.set('runs', (sess.getInt('runs') || 0) + 1);
  if (p.pain) sess.set('pain', true);
  sess.set('last_at', u.now());
  if (p.song) {
    const songsIn = u.getJson(sess, 'songs') || [];
    let entry = null;
    for (const s of songsIn) if (s.song === p.song.id) entry = s;
    if (entry === null) {
      entry = { song: p.song.id, title: p.song.getString('title'), minutes: 0, runs: 0 };
      songsIn.push(entry);
    }
    entry.minutes = Math.round((entry.minutes + (p.ms || 0) / 60000) * 100) / 100;
    entry.runs += 1;
    sess.set('songs', songsIn);
  }
  app.save(sess);
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
    minutes: r1(s.getFloat('minutes')),
    voiced_min: r1(s.getFloat('voiced_s') / 60),
    cycles_k: Math.round(s.getFloat('cycles') / 1000),
    runs: s.getInt('runs'),
    songs: U().getJson(s, 'songs') || [],
    warmup_min: r1(s.getFloat('warmup_s') / 60),
    cooldown_min: r1(s.getFloat('cooldown_s') / 60),
    pain: s.getBool('pain'),
    status: s.getString('status'),
    review: s.getString('review'),
    review_at: s.getString('review_at'),
    review_asked: s.getBool('review_asked'),
  };
  if (!full && out.review.length > 400) out.review = out.review.slice(0, 400) + '…';
  return out;
}

/* ------------------------------------------------------------------- runs */

/**
 * Move each section a complete take covered: learning on any sung take; the
 * best tempo and the day's clean count on clean Sing or Solo takes; steady
 * after three clean takes at full tempo in a day with one of them Solo;
 * mastered on a clean Solo at full tempo that is the section's first Solo of
 * a later day (the cold check); a failed cold check drops mastered to steady.
 */
function applySections(m, states, secs, opt) {
  const results = [];
  const T = opt.thresholds;
  let anyCold = false;
  for (let i = 0; i < secs.length; i++) {
    const sec = secs[i];
    if (sec.from < opt.from || sec.to > opt.to) continue;
    let exp = 0;
    let on = 0;
    let close = 0;
    let onset = 0;
    const weak = [];
    for (let b = sec.from; b <= sec.to; b++) {
      const v = opt.byBar[b];
      if (v === undefined) continue;
      exp += v[0];
      on += v[1];
      close += v[2];
      onset += v[5];
      const errs = v[0] - v[1] - v[2];
      if (errs > 0) weak.push([b, errs]);
    }
    const st = states[i];
    const before = st.stage;
    st.tries = (st.tries || 0) + 1;
    st.last_day = opt.day;
    if (st.stage === 'new') st.stage = 'learning';
    let acc = null;
    let secClean = false;
    let cold = false;
    if ((opt.mode === 'sing' || opt.mode === 'solo') && exp > 0) {
      acc = (on + close) / exp;
      secClean = acc >= T.pitch && on / exp >= T.on && onset / exp >= T.onset;
      if (opt.mode === 'solo') {
        cold = st.solo_day !== opt.day;
        st.solo_day = opt.day;
        if (cold) anyCold = true;
      }
      st.acc = r3(acc);
      weak.sort((a, b) => b[1] - a[1]);
      st.weak = weak.slice(0, 3).map((w) => w[0]);
      if (secClean) {
        st.best = Math.max(st.best || 0, Math.round(opt.tempo));
        if (opt.mode === 'solo') {
          st.solo_cleans = (st.solo_cleans || 0) + 1;
          if (opt.memory) st.memory = true;
        }
        if (opt.tempo >= 100) {
          if (st.stage === 'learning') {
            if (st.clean_day !== opt.day) {
              st.cleans = 0;
              st.solo_today = false;
            }
            st.cleans = (st.cleans || 0) + 1;
            st.clean_day = opt.day;
            if (opt.mode === 'solo') st.solo_today = true;
            if (st.cleans >= 3 && st.solo_today) {
              st.stage = 'steady';
              st.steady_day = opt.day;
            }
          } else if (st.stage === 'steady') {
            if (cold && st.steady_day !== '' && st.steady_day < opt.day) {
              st.stage = 'mastered';
              st.iv = 2;
              st.due = m.addDays(opt.day, 2);
            }
          } else if (st.stage === 'mastered' && cold) {
            st.iv = Math.min(64, Math.max(2, (st.iv || 2) * 2));
            st.due = m.addDays(opt.day, st.iv);
          }
        }
      } else if (cold && st.stage === 'mastered' && opt.tempo >= 100) {
        // A failed review: back to steady until it is clean cold again.
        st.stage = 'steady';
        st.steady_day = opt.day;
        st.iv = 0;
        st.due = '';
      }
    }
    results.push({ i: i, name: sec.name, from: sec.from, to: sec.to, before: before, after: st.stage, acc: acc === null ? null : r3(acc), clean: secClean, cold: cold, best: st.best || 0, cleans: st.clean_day === opt.day ? st.cleans || 0 : 0, solo_today: st.clean_day === opt.day && st.solo_today === true });
  }
  return { results: results, anyCold: anyCold };
}

/** Switch a song's progress to another key: stages above learning do not carry over. */
function switchKey(progRec, shift, count) {
  const u = U();
  const m = M();
  const old = progRec.getInt('key_shift');
  if (old === shift) return;
  const byKey = u.getJson(progRec, 'by_key') || {};
  byKey[String(old)] = u.getJson(progRec, 'sections') || [];
  let next = byKey[String(shift)];
  if (!Array.isArray(next)) {
    next = m.statesOf(progRec, count).map((s) => {
      const c = Object.assign({}, s);
      if (c.stage === 'steady' || c.stage === 'mastered') {
        c.stage = 'learning';
        c.cleans = 0;
        c.clean_day = '';
        c.steady_day = '';
        c.due = '';
        c.iv = 0;
      }
      return c;
    });
  }
  progRec.set('by_key', byKey);
  progRec.set('sections', next);
  progRec.set('key_shift', shift);
}

function num(u, p, name, lo, hi) {
  const v = u.number(p, name, {});
  if (v === null) return null;
  return Math.max(lo, Math.min(hi, v));
}

function save(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'record practice (takes come from the person singing)');
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  const model = m.modelOf(rec);
  if (model === null || !model.bars || model.bars.length === 0) throw u.fail(400, 'This song has no music to practise.');
  const first = model.bars[0].n;
  const last = model.bars[model.bars.length - 1].n;
  const mode = u.oneOf(p, 'mode', ['listen', 'echo', 'sing', 'solo'], '');
  if (mode === '') throw u.fail(400, 'mode is required: listen, echo, sing or solo');
  const from = u.int(p, 'from_bar', first, first, last);
  const to = u.int(p, 'to_bar', last, from, last);
  const tempo = u.number(p, 'tempo_pct', { min: 10, max: 200 }) || 100;
  const keyShift = u.int(p, 'key_shift', 0, -12, 12);
  const durationMs = Math.min(3 * 3600000, Math.max(0, u.number(p, 'duration_ms', { min: 0 }) || 0));
  const voicedMs = Math.min(durationMs + 1000, Math.max(0, u.number(p, 'voiced_ms', { min: 0 }) || 0));
  const cycles = Math.max(0, u.number(p, 'cycles', { min: 0 }) || 0);
  const expected = u.int(p, 'expected', 0, 0, 100000);
  const onN = u.int(p, 'on_n', 0, 0, 100000);
  const closeN = u.int(p, 'close_n', 0, 0, 100000);
  const offN = u.int(p, 'off_n', 0, 0, 100000);
  const missed = u.int(p, 'missed', 0, 0, 100000);
  const complete = u.bool(p, 'complete', true);
  const memory = u.bool(p, 'memory', false) && mode === 'solo';
  const perBar = u.list(p, 'per_bar', '[[1,8,5,2,1,0,7]]') || [];
  if (perBar.length > 4000) throw u.fail(400, 'per_bar is too long');
  const byBar = {};
  for (const row of perBar) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const n = Number(row[0]);
    const prev = byBar[n] || [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 6; k++) prev[k] += Number(row[k + 1]) || 0;
    byBar[n] = prev;
  }
  const scored = mode === 'sing' || mode === 'solo' || mode === 'echo';
  const pitchPct = expected > 0 ? (onN + closeN) / expected : 0;
  const onPct = expected > 0 ? onN / expected : 0;
  const onsetPct = num(u, p, 'onset_pct', 0, 1);
  const strict = m.strictnessOf(app);
  const T = m.CLEAN[strict];
  const clean = (mode === 'sing' || mode === 'solo') && complete && expected > 0 && pitchPct >= T.pitch && onPct >= T.on && (onsetPct === null || onsetPct >= T.onset);
  const day = m.dayKey();

  /* sections */
  const secs = m.sectionsOf(rec);
  const prog = m.progress(app, rec.id);
  switchKey(prog, keyShift, secs.length);
  const states = m.statesOf(prog, secs.length);
  let results = [];
  let anyCold = false;
  if (complete && scored) {
    const r = applySections(m, states, secs, { from: from, to: to, day: day, mode: mode, tempo: tempo, memory: memory, thresholds: T, byBar: byBar });
    results = r.results;
    anyCold = r.anyCold;
  }
  prog.set('sections', states);
  prog.set('runs', (prog.getInt('runs') || 0) + 1);
  prog.set('minutes', prog.getFloat('minutes') + durationMs / 60000);
  prog.set('last_at', u.now());
  app.save(prog);

  /* session */
  const sess = addToSession(app, day, { ms: durationMs, voiced_ms: voicedMs, cycles: cycles, run: true, song: rec });

  const run = new Record(app.findCollectionByNameOrId('runs'));
  run.set('song', rec.id);
  run.set('session', sess.id);
  run.set('day', day);
  run.set('mode', mode);
  run.set('from_bar', from);
  run.set('to_bar', to);
  run.set('verse', u.int(p, 'verse', 1, 1, 20));
  run.set('key_shift', keyShift);
  run.set('tempo_pct', Math.round(tempo));
  run.set('bpm', Math.round(rec.getFloat('tempo') * tempo) / 100);
  run.set('guide', u.oneOf(p, 'guide', ['voice', 'piano', 'start', 'off'], 'voice'));
  run.set('feedback', u.oneOf(p, 'feedback', ['full', 'fade', 'after'], 'full'));
  run.set('memory', memory);
  run.set('strictness', strict);
  run.set('duration_ms', Math.round(durationMs));
  run.set('voiced_ms', Math.round(voicedMs));
  run.set('cycles', Math.round(cycles));
  run.set('expected', expected);
  run.set('on_n', onN);
  run.set('close_n', closeN);
  run.set('off_n', offN);
  run.set('missed', missed);
  run.set('pitch_pct', r3(pitchPct));
  run.set('on_pct', r3(onPct));
  if (onsetPct !== null) run.set('onset_pct', r3(onsetPct));
  const nums = { bias_c: [-1200, 1200], mad_c: [0, 1200], timing_mad: [0, 5000], timing_bias: [-5000, 5000], hold_sd: [0, 600], vib_rate: [0, 20], vib_extent: [0, 600], vib_share: [0, 1], drift_c: [-1200, 1200], offset_c: [-1200, 1200] };
  for (const k of Object.keys(nums)) {
    const v = num(u, p, k, nums[k][0], nums[k][1]);
    if (v !== null) run.set(k, Math.round(v * 10) / 10);
  }
  run.set('scoops', u.int(p, 'scoops', 0, 0, 10000));
  run.set('falls', u.int(p, 'falls', 0, 0, 10000));
  run.set('octave', u.int(p, 'octave', 0, -3, 3));
  run.set('clean', clean);
  run.set('cold', anyCold);
  run.set('complete', complete);
  run.set('per_bar', perBar.slice(0, 4000));
  run.set('per_phrase', (u.list(p, 'per_phrase', '[]') || []).slice(0, 400));
  run.set('per_note', (u.list(p, 'per_note', '[]') || []).slice(0, 6000));
  run.set('map', (u.list(p, 'map', '[]') || []).slice(0, 2000));
  run.set('self_estimate', u.oneOf(p, 'self_estimate', ['on', 'close', 'off', ''], ''));
  run.set('disputed', []);
  run.set('results', results);
  app.save(run);

  const st = m.settings(app);
  if (st.getString('last_song') !== rec.id) {
    st.set('last_song', rec.id);
    app.save(st);
  }
  const levelUp = require(`${__hooks}/lib_learn.js`).advance(app);

  let suggestion = null;
  if ((mode === 'sing' || mode === 'solo') && complete) {
    if (clean && tempo < 100) suggestion = { tempo: Math.min(100, Math.round(tempo + (tempo < 85 ? 10 : 5))), why: 'up' };
    else if (clean) suggestion = { tempo: Math.round(tempo), why: 'hold' };
    else if (pitchPct < 0.7 && tempo > 70) suggestion = { tempo: Math.max(70, Math.round(tempo - 10)), why: 'down' };
    else suggestion = { tempo: Math.round(tempo), why: 'again' };
  }
  return {
    run: runJson(run, false),
    results: results,
    song: m.songJson(app, rec, { progress: prog }),
    session: sessionJson(sess, false),
    suggestion: suggestion,
    level_up: levelUp,
    health: require(`${__hooks}/lib_health.js`).nudge(app),
  };
}

/** The pitch track (and audio, when the person keeps recordings) of a take. */
function track(app, e, p) {
  const u = U();
  u.personOnly(e, 'store recordings');
  const run = u.byId(app, 'runs', u.req(p, 'run', '{run id}'));
  if (run === null) throw u.fail(404, 'No run ' + p.run + '.');
  const frames = u.str(p, 'frames', '');
  if (frames.length > 6000000) throw u.fail(400, 'frames are longer than 6 MB.');
  const old = app.findRecordsByFilter('tracks', 'run = {:r}', '', 1, 0, { r: run.id });
  const rec = old.length > 0 ? old[0] : new Record(app.findCollectionByNameOrId('tracks'));
  rec.set('run', run.id);
  rec.set('rate', u.number(p, 'rate', { min: 1, max: 1000 }) || 100);
  rec.set('frames', frames);
  const keep = M().settings(app).getBool('keep_recordings');
  if (keep) {
    const audio = u.uploaded(e, 'audio');
    if (audio !== null) rec.set('audio', audio);
  }
  app.save(rec);
  return { ok: true, track: rec.id, audio: keep && rec.getString('audio') !== '' };
}

/** Delete every stored recording (audio); pitch tracks stay. */
function forgetAudio(app, e) {
  const u = U();
  u.personOnly(e, 'delete recordings');
  let n = 0;
  for (const t of app.findRecordsByFilter('tracks', "audio != ''", '', 0, 0)) {
    t.set('audio', null);
    app.save(t);
    n += 1;
  }
  return { ok: true, deleted: n };
}

function runJson(r, full) {
  const u = U();
  const out = {
    id: r.id,
    song: r.getString('song'),
    session: r.getString('session'),
    day: r.getString('day'),
    mode: r.getString('mode'),
    from_bar: r.getInt('from_bar'),
    to_bar: r.getInt('to_bar'),
    verse: r.getInt('verse'),
    key_shift: r.getInt('key_shift'),
    tempo_pct: r.getFloat('tempo_pct'),
    bpm: r.getFloat('bpm'),
    guide: r.getString('guide'),
    feedback: r.getString('feedback'),
    memory: r.getBool('memory'),
    duration_ms: r.getInt('duration_ms'),
    voiced_ms: r.getInt('voiced_ms'),
    expected: r.getInt('expected'),
    on: r.getInt('on_n'),
    close: r.getInt('close_n'),
    off: r.getInt('off_n'),
    missed: r.getInt('missed'),
    pitch_pct: r.getFloat('pitch_pct'),
    on_pct: r.getFloat('on_pct'),
    onset_pct: r.getFloat('onset_pct'),
    bias_c: r.getFloat('bias_c'),
    mad_c: r.getFloat('mad_c'),
    timing_mad: r.getFloat('timing_mad'),
    timing_bias: r.getFloat('timing_bias'),
    hold_sd: r.getFloat('hold_sd'),
    vib_rate: r.getFloat('vib_rate'),
    vib_extent: r.getFloat('vib_extent'),
    vib_share: r.getFloat('vib_share'),
    scoops: r.getInt('scoops'),
    falls: r.getInt('falls'),
    drift_c: r.getFloat('drift_c'),
    octave: r.getInt('octave'),
    offset_c: r.getFloat('offset_c'),
    clean: r.getBool('clean'),
    cold: r.getBool('cold'),
    complete: r.getBool('complete'),
    self_estimate: r.getString('self_estimate'),
    disputed: (u.getJson(r, 'disputed') || []).length,
    created: r.getString('created'),
  };
  if (full) {
    out.per_phrase = u.getJson(r, 'per_phrase') || [];
    out.per_note = u.getJson(r, 'per_note') || [];
    out.per_note_cols = ['melody note index', 'status (0 missed, 1 on, 2 close, 3 off, 4 not scored)', 'cents (negative flat; null unmeasured)', 'onset ms (negative early)', 'flags (1 scoop, 2 fall, 4 vibrato)', 'bar'];
    out.per_bar = u.getJson(r, 'per_bar') || [];
    out.per_bar_cols = ['bar', 'notes expected', 'on', 'close', 'off', 'missed', 'onsets in time'];
    if (r.getInt('voiced_ms') < 300 && r.getString('mode') !== 'listen') out.silent = 'The microphone heard no voice in this take: its numbers say nothing about the singing.';
    out.disputed_notes = u.getJson(r, 'disputed') || [];
    out.results = u.getJson(r, 'results') || [];
  }
  return out;
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
      const j = runJson(r, false);
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

function get(app, p) {
  const u = U();
  const r = u.byId(app, 'runs', u.req(p, 'run', '{run id}'));
  if (r === null) throw u.fail(404, 'No run ' + p.run + '. runs.list shows them.');
  const out = { run: runJson(r, true) };
  if (u.bool(p, 'track', false)) {
    const t = app.findRecordsByFilter('tracks', 'run = {:r}', '', 1, 0, { r: r.id });
    if (t.length > 0) out.track = { rate: t[0].getFloat('rate'), frames: t[0].getString('frames'), audio: t[0].getString('audio') === '' ? '' : u.fileUrl(t[0], 'audio') };
  }
  return out;
}

/**
 * The person disputes a judged note (the trace shows they sang it): the take
 * is scored again without that note. When that makes the latest take of the
 * song clean, its sections get the clean take they earned.
 */
function dispute(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'dispute a judged note');
  const r = u.byId(app, 'runs', u.req(p, 'run', '{run id}'));
  if (r === null) throw u.fail(404, 'No run ' + p.run + '.');
  const idx = u.int(p, 'note', -1, 0, 100000);
  const notes = u.getJson(r, 'per_note') || [];
  // per_note rows: [melody index, status (0 missed, 1 on, 2 close, 3 off, 4 unscored), cents, onset ms, flags, bar]
  const row = notes.find((x) => x[0] === idx);
  if (row === undefined) throw u.fail(404, 'Note ' + idx + ' was not judged in this take.');
  if (row[1] === 1 || row[1] === 4) throw u.fail(400, 'That note was already counted as on pitch (or not scored).');
  const disputed = u.getJson(r, 'disputed') || [];
  if (disputed.indexOf(idx) >= 0) return { run: runJson(r, true), changed: false };
  disputed.push(idx);
  r.set('disputed', disputed);
  const wasClean = r.getBool('clean');
  const expected = Math.max(0, r.getInt('expected') - 1);
  if (row[1] === 0) r.set('missed', Math.max(0, r.getInt('missed') - 1));
  if (row[1] === 2) r.set('close_n', Math.max(0, r.getInt('close_n') - 1));
  if (row[1] === 3) r.set('off_n', Math.max(0, r.getInt('off_n') - 1));
  r.set('expected', expected);
  const pitchPct = expected > 0 ? (r.getInt('on_n') + r.getInt('close_n')) / expected : 0;
  const onPct = expected > 0 ? r.getInt('on_n') / expected : 0;
  r.set('pitch_pct', r3(pitchPct));
  r.set('on_pct', r3(onPct));
  const T = m.CLEAN[r.getString('strictness')] || m.CLEAN.normal;
  const mode = r.getString('mode');
  const onset = r.getFloat('onset_pct');
  const clean = (mode === 'sing' || mode === 'solo') && r.getBool('complete') && expected > 0 && pitchPct >= T.pitch && onPct >= T.on && (onset === 0 || onset >= T.onset);
  r.set('clean', clean);
  // The bar's counts lose the disputed note too.
  const bars = u.getJson(r, 'per_bar') || [];
  const bar = row[5];
  for (const b of bars) {
    if (Number(b[0]) !== bar) continue;
    b[1] = Math.max(0, Number(b[1]) - 1);
    if (row[1] === 2) b[3] = Math.max(0, Number(b[3]) - 1);
    if (row[1] === 3) b[4] = Math.max(0, Number(b[4]) - 1);
    if (row[1] === 0) b[5] = Math.max(0, Number(b[5]) - 1);
  }
  r.set('per_bar', bars);
  let credited = false;
  if (clean && !wasClean) {
    const latest = app.findRecordsByFilter('runs', 'song = {:s}', '-created', 1, 0, { s: r.getString('song') });
    if (latest.length > 0 && latest[0].id === r.id && r.getString('day') === m.dayKey()) {
      const rec = m.song(app, r.getString('song'));
      const secs = m.sectionsOf(rec);
      const prog = m.progress(app, rec.id);
      const states = m.statesOf(prog, secs.length);
      const byBar = {};
      for (const b of bars) byBar[Number(b[0])] = [Number(b[1]) || 0, Number(b[2]) || 0, Number(b[3]) || 0, Number(b[4]) || 0, Number(b[5]) || 0, Number(b[6]) || 0];
      // Undo the try this take already counted, then count it again as clean.
      for (const res of u.getJson(r, 'results') || []) if (states[res.i]) states[res.i].tries = Math.max(0, (states[res.i].tries || 1) - 1);
      const again = applySections(m, states, secs, { from: r.getInt('from_bar'), to: r.getInt('to_bar'), day: r.getString('day'), mode: mode, tempo: r.getFloat('tempo_pct'), memory: r.getBool('memory'), thresholds: T, byBar: byBar });
      prog.set('sections', states);
      app.save(prog);
      r.set('results', again.results);
      credited = true;
    }
  }
  app.save(r);
  return { run: runJson(r, true), changed: true, clean: clean, credited: credited, note: credited ? 'The take is clean without that note; its sections counted it.' : clean ? 'The take is clean without that note. Stages move on takes of the day, so sing it again to count.' : 'Scored again without that note.' };
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
  const s = u.byId(app, 'sessions', u.req(p, 'session', '{session id}'));
  if (s === null) throw u.fail(404, 'No session ' + p.session + '. sessions.list shows them.');
  const runs = app.findRecordsByFilter('runs', 'session = {:s}', 'created', 0, 0, { s: s.id });
  return { session: sessionJson(s, true), runs: runs.map((r) => runJson(r, false)) };
}

/** Ask the coach for a review of a closed session; true when the request went out. */
function askReview(app, s) {
  const m = M();
  if (s.getBool('review_asked') || s.getString('review') !== '') return { asked: false, reason: 'already asked' };
  if (s.getFloat('minutes') < REVIEW_MIN_MINUTES) return { asked: false, reason: 'shorter than ' + REVIEW_MIN_MINUTES + ' minutes' };
  if (!m.settings(app).getBool('coach_reviews')) return { asked: false, reason: 'session reviews are off in Settings' };
  const key = 'sc_review_tries_' + s.id;
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
  if (u.bool(p, 'pain', false)) s.set('pain', true);
  if (s.getString('status') === 'open') {
    s.set('status', 'closed');
    s.set('ended', u.now());
  }
  app.save(s);
  const r = askReview(app, s);
  return { session: sessionJson(s, false), asked: r.asked, reason: r.reason || '' };
}

function review(app, e, p) {
  const u = U();
  u.agentOnly(e, 'write session reviews');
  const s = u.byId(app, 'sessions', u.req(p, 'session', '{session id}'));
  if (s === null) throw u.fail(404, 'No session ' + p.session + '.');
  const text = u.req(p, 'text', '"Clean Solo of bars 1-8; bar 5 still 30 cents flat..."');
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

/** Every minute: close quiet sessions and ask for their reviews (not while the agent is busy). */
function tick(app) {
  const u = U();
  const now = Date.now();
  for (const s of app.findRecordsByFilter('sessions', "status = 'open'", '', 0, 0)) {
    if (now - u.ms(s.getString('last_at')) >= IDLE_MS) close(app, s);
  }
  if (now - Number(app.store().get('sc_agent_seen') || 0) < AGENT_BUSY_MS) return;
  const since = u.pbTime(now - 12 * 3600000);
  for (const s of app.findRecordsByFilter('sessions', "status = 'closed' && review_asked = false && review = '' && ended >= {:t}", '-ended', 3, 0, { t: since })) askReview(app, s);
}

/* ------------------------------------------------------------ review pack */

function cut(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** What the coach needs to review a session, kept under about 6,000 characters. */
function pack(app, p) {
  const u = U();
  const m = M();
  const V = require(`${__hooks}/lib_voice.js`);
  let s = null;
  const id = u.str(p, 'session', '');
  if (id !== '') s = u.byId(app, 'sessions', id);
  else {
    const rows = app.findRecordsByFilter('sessions', '', '-started', 1, 0);
    s = rows.length > 0 ? rows[0] : null;
  }
  if (s === null) throw u.fail(404, id !== '' ? 'No session ' + id + '.' : 'No practice yet.');
  const st = m.settings(app);
  const voice = V.current(app);
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
  let silent = 0;
  let sung = 0;
  for (const sid of order.slice(0, 6)) {
    const rec = u.byId(app, 'songs', sid);
    if (rec === null) continue;
    const j = m.songJson(app, rec, {});
    const model = m.modelOf(rec) || {};
    const lyr = (model.lyrics && model.lyrics[0]) || [];
    const rs = bySong[sid];
    const changes = [];
    const runOut = [];
    for (const r of rs) {
      for (const c of u.getJson(r, 'results') || []) if (c.before !== c.after) changes.push(c.name + ': ' + c.before + ' → ' + c.after);
      if (runOut.length >= 8) continue;
      const o = { mode: r.getString('mode'), bars: r.getInt('from_bar') + '-' + r.getInt('to_bar'), key: r.getInt('key_shift'), tempo: r.getFloat('tempo_pct'), s: Math.round(r.getInt('duration_ms') / 1000) };
      // A take in which the microphone heard no voice has no numbers to judge (not "0 cents").
      if (r.getString('mode') !== 'listen') sung++;
      if (r.getString('mode') !== 'listen' && r.getInt('voiced_ms') < 300) {
        silent++;
        o.silent = true;
        o.note = 'the microphone heard no voice in this take';
        runOut.push(o);
        continue;
      }
      if (r.getString('mode') !== 'listen') {
        o.pitch = r.getFloat('pitch_pct');
        o.in_tune = r.getFloat('on_pct');
        o.bias_c = r.getFloat('bias_c');
        o.clean = r.getBool('clean');
        if (r.getFloat('hold_sd') > 0) o.hold_c = r.getFloat('hold_sd');
        if (r.getFloat('vib_rate') > 0) o.vibrato = r.getFloat('vib_rate') + ' Hz ±' + Math.round(r.getFloat('vib_extent')) + 'c';
        if (r.getInt('scoops') + r.getInt('falls') > 0) o.scoops_falls = r.getInt('scoops') + '/' + r.getInt('falls');
        if (r.getFloat('timing_mad') > 0) o.timing_ms = { mean_abs: r.getFloat('timing_mad'), bias: r.getFloat('timing_bias') };
        if (r.getInt('octave') !== 0) o.octave = r.getInt('octave');
        if (r.getString('mode') === 'solo') o.offset_c = r.getFloat('offset_c');
        if (r.getString('self_estimate') !== '') o.self_estimate = r.getString('self_estimate');
        // The weakest phrase: its bar, words and cents.
        const ph = (u.getJson(r, 'per_phrase') || []).filter((x) => x && x.n > 0).sort((a, b) => a.on_close / a.n - b.on_close / b.n)[0];
        if (ph && ph.on_close < ph.n) o.weakest = { bars: ph.from_bar + '-' + ph.to_bar, share: r3(ph.on_close / ph.n), worst: ph.worst ? { bar: ph.worst.bar, word: cut(lyr[ph.worst.i] || '', 16).replace(/-$/, ''), cents: ph.worst.cents } : undefined };
      }
      runOut.push(o);
    }
    songs.push({
      id: j.id,
      title: j.title,
      level: j.level,
      key_shift: j.key_shift,
      sung_range: V.noteName(j.low + j.key_shift) + '–' + V.noteName(j.high + j.key_shift),
      sections: j.sections.map((x) => ({ name: x.name, bars: x.from + '-' + x.to, stage: x.stage, best_tempo: x.best, due: x.due || undefined })),
      runs: runOut,
      more_runs: Math.max(0, rs.length - runOut.length),
      stage_changes: changes.slice(0, 10),
      coach_note: cut(j.note, 200),
    });
  }
  const drills = app.findRecordsByFilter('drills', "session = {:s} && drill != 'lesson'", 'created', 20, 0, { s: s.id }).map((d) => ({
    skill: d.getString('skill'),
    title: cut(d.getString('title'), 50),
    items: d.getInt('items'),
    accuracy: d.getFloat('accuracy'),
    level: d.getInt('level') || undefined,
    minutes: Math.round(d.getFloat('duration_ms') / 6000) / 10,
  }));
  const started = s.getString('started');
  const ended = s.getString('ended') || u.now();
  const lessonsDone = app.findRecordsByFilter('lessons', 'updated >= {:a} && updated <= {:b}', '', 10, 0, { a: started, b: ended }).map((l) => {
    const def = require(`${__hooks}/lib_curriculum.js`).lesson(l.getString('key'));
    return { lesson: l.getString('key'), title: def ? def.title : '', score: l.getFloat('score') };
  });
  const checks = app.findRecordsByFilter('checkins', 'day = {:d}', '-created', 3, 0, { d: s.getString('day') }).map((c) => ({ when: c.getString('when'), hoarse: c.getInt('hoarse'), effort: c.getInt('effort'), discomfort: c.getInt('discomfort'), high_loss: c.getInt('high_loss'), clearing: c.getInt('clearing'), pain: c.getBool('pain') }));
  const health = require(`${__hooks}/lib_health.js`).summary(app);
  const prev = app.findRecordsByFilter('sessions', "review != '' && started < {:t}", '-started', 1, 0, { t: s.getString('started') });
  const stats = require(`${__hooks}/lib_stats.js`);
  return {
    session: { id: s.id, day: s.getString('day'), minutes: r1(s.getFloat('minutes')), voiced_min: r1(s.getFloat('voiced_s') / 60), cycles_k: Math.round(s.getFloat('cycles') / 1000), warmup_min: r1(s.getFloat('warmup_s') / 60), cooldown_min: r1(s.getFloat('cooldown_s') / 60), pain: s.getBool('pain'), status: s.getString('status') },
    learner: { level: st.getInt('level') || 1, goal_minutes: st.getInt('daily_minutes') || 20, strictness: st.getString('strictness') || 'normal', streak_days: stats.streak(app), under18: st.getBool('under18'), voice: V.describe(voice) },
    health: health,
    checkins: checks,
    heard: silent > 0 ? 'The microphone heard no voice in ' + silent + ' of ' + sung + ' sung takes: those have no numbers. Do not judge them; ask the person to check the microphone (Settings → Microphone) if it keeps happening.' : undefined,
    songs: songs,
    drills: drills,
    lessons: lessonsDone,
    previous_review: cut(prev.length > 0 ? prev[0].getString('review') : '', 400),
    stages: 'new → learning (tempo climbs) → steady (3 clean takes at full tempo in a day, one of them Solo) → mastered (a clean Solo at full tempo on the first try of a later day; reviewed after 2, 4, 8 … days)',
    units: 'pitch: share of notes on pitch or close; in_tune: share exactly on (±' + m.BANDS[m.strictnessOf(app)].on + ' cents at this strictness); bias_c: average cents, negative = flat; hold_c: steadiness of long notes (cents, lower is steadier); vibrato: rate and extent, never a fault; scoops_falls: notes slid into / dropping off; timing_ms: onset error (negative = early); octave: the singer sang an octave away (fine); offset_c (Solo): how far from the written key the singer settled, which is not penalised; key: semitones the song is transposed; tempo: percent of the song tempo; self_estimate: what the singer guessed before seeing results',
    unmeasurable: 'The microphone measures pitch, timing, steadiness, vibrato, loudness and voiced time. It cannot hear tone quality, breathiness, tension, breath support or larynx position: never claim to. Suggest self-checks or a teacher for those.',
  };
}

module.exports = { switchKey: switchKey, applySections: applySections, save: save, track: track, forgetAudio: forgetAudio, list: list, get: get, dispute: dispute, sessionsList: sessionsList, sessionGet: sessionGet, end: end, review: review, tick: tick, pack: pack, runJson: runJson, openSession: openSession, addToSession: addToSession, sessionJson: sessionJson };
