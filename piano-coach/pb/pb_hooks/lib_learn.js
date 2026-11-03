/// <reference path="../pb_data/types.d.ts" />
/**
 * Learning: the curriculum's lessons, the skills the drills train, and the
 * path of ten levels.
 *
 *   learn.state   lessons done, every skill's mastery, each level's
 *                 requirements met or not, what to do next
 *   learn.lesson  a finished lesson (score, time)
 *   drills.save   one drill session: moves the skill's mastery (accuracy,
 *                 weighted by speed or tempo), the sight-reading level,
 *                 technique bests per key; counts as practice time
 *   drills.list   recent drill sessions
 *   abc.parse     notation to the practice model without saving (the app's
 *                 generated exercises: scales, arpeggios, progressions,
 *                 rhythm, sight-reading)
 *
 * A level is complete when every requirement is met; the learner's level
 * then moves up by itself.
 */

var ENGINE_DRILLS = ['rhythm', 'technique', 'prog', 'sight'];
var STAGE_RANK = { new: 0, learning: 1, steady: 2, mastered: 3 };

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}
function C() {
  return require(`${__hooks}/lib_curriculum.js`);
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}

function stars(m) {
  return m >= 0.92 ? 3 : m >= 0.8 ? 2 : m >= 0.6 ? 1 : 0;
}

function skillRows(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('skills', '', '', 0, 0)) out[r.getString('key')] = r;
  return out;
}

function lessonRows(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('lessons', '', '', 0, 0)) out[r.getString('key')] = r;
  return out;
}

function skillJson(key, r) {
  const u = U();
  const def = C().SKILLS[key] || { title: key, track: 'theory', drill: '' };
  const mastery = r === null || r === undefined ? 0 : r.getFloat('mastery');
  return {
    key: key,
    title: def.title,
    track: def.track,
    drill: def.drill,
    mastery: r3(mastery),
    stars: stars(mastery),
    attempts: r ? r.getInt('attempts') : 0,
    items: r ? r.getInt('items') : 0,
    avg_ms: r ? Math.round(r.getFloat('avg_ms')) : 0,
    level: r ? r.getInt('level') : 0,
    best_level: r ? r.getInt('best_level') : 0,
    last_at: r ? r.getString('last_at') : '',
    data: r ? u.getJson(r, 'data') || {} : {},
    history: r ? (u.getJson(r, 'history') || []).slice(-30) : [],
  };
}

/* ------------------------------------------------------------- the path */

/** Every level's requirements, met or not, from what has been done so far. */
function evaluate(app, rows) {
  const c = C();
  const m = M();
  const lessons = rows && rows.lessons ? rows.lessons : lessonRows(app);
  const skills = rows && rows.skills ? rows.skills : skillRows(app);
  // Songs: the lowest stage among a song's sections, and its length.
  const progs = require(`${__hooks}/lib_songs.js`).progressMap(app);
  const songs = [];
  for (const s of app.findRecordsByFilter('songs', 'archived = false', '', 0, 0)) {
    const secs = m.sectionsOf(s);
    const states = m.statesOf(progs[s.id] || null, secs.length);
    let low = 3;
    for (const st of states) low = Math.min(low, STAGE_RANK[st.stage] || 0);
    if (states.length === 0) low = 0;
    songs.push({ level: s.getInt('level') || 1, low: low, seconds: s.getInt('seconds') });
  }
  const scaleData = skills['tech.scales'] ? U().getJson(skills['tech.scales'], 'data') || {} : {};
  const sightLevel = skills['sight.read'] ? skills['sight.read'].getInt('best_level') : 0;
  const levels = [];
  for (const lv of c.PATH) {
    const items = [];
    for (const req of lv.reqs) {
      const track = c.trackOf(req);
      if (req.kind === 'lessons') {
        for (const k of req.keys) {
          const l = c.lesson(k);
          items.push({ track: track, kind: 'lesson', key: k, title: l ? l.title : k, ok: lessons[k] !== undefined });
        }
      } else if (req.kind === 'skill') {
        const rec = skills[req.key];
        const have = rec ? rec.getFloat('mastery') : 0;
        items.push({ track: track, kind: 'skill', key: req.key, title: (c.SKILLS[req.key] || {}).title || req.key, need: req.mastery, have: r3(have), ok: have >= req.mastery - 1e-9 });
      } else if (req.kind === 'scales') {
        let n = 0;
        for (const id of Object.keys(scaleData)) {
          const type = id.split(':')[0];
          if (req.types.indexOf(type) >= 0 && (scaleData[id].best || 0) >= req.tempo) n++;
        }
        const names = req.types.map((t) => (t === 'major' ? 'major' : t === 'hminor' ? 'harmonic minor' : t === 'mminor' ? 'melodic minor' : t)).join(' and ');
        items.push({ track: track, kind: 'scales', key: req.types.join(','), title: req.count + ' ' + names + ' scales clean at ' + req.tempo + '%', need: req.count, have: n, tempo: req.tempo, types: req.types, ok: n >= req.count });
      } else if (req.kind === 'sight') {
        items.push({ track: track, kind: 'sight', key: 'sight.read', title: 'Sight-reading level ' + req.level, need: req.level, have: sightLevel, ok: sightLevel >= req.level });
      } else if (req.kind === 'songs') {
        const rank = STAGE_RANK[req.stage] || 2;
        const n = songs.filter((s) => s.level >= req.level && s.low >= rank).length;
        items.push({ track: track, kind: 'songs', key: 'level' + req.level, level: req.level, title: req.count + ' pieces at level ' + req.level + ' or above, ' + req.stage, need: req.count, have: n, ok: n >= req.count });
      } else if (req.kind === 'program') {
        let secs = 0;
        for (const s of songs) if (s.low >= 3) secs += s.seconds;
        const mins = Math.floor(secs / 60);
        items.push({ track: track, kind: 'program', key: 'program', title: req.minutes + ' minutes of mastered pieces (a recital programme)', need: req.minutes, have: mins, ok: mins >= req.minutes });
      }
    }
    const tracks = {};
    for (const t of c.TRACKS) tracks[t.key] = { done: 0, total: 0 };
    for (const it of items) {
      tracks[it.track].total += 1;
      if (it.ok) tracks[it.track].done += 1;
    }
    const done = items.every((it) => it.ok);
    levels.push({ level: lv.level, name: lv.name, done: done, met: items.filter((i) => i.ok).length, total: items.length, tracks: tracks, items: items });
  }
  return levels;
}

/** Move the learner up while their current level is complete. Returns the new level or 0. */
function advance(app) {
  const m = M();
  const st = m.settings(app);
  let lvl = st.getInt('level') || 1;
  const start = lvl;
  const levels = evaluate(app);
  while (lvl < 10) {
    const cur = levels[lvl - 1];
    if (cur === undefined || !cur.done) break;
    lvl += 1;
  }
  if (lvl !== start) {
    st.set('level', lvl);
    app.save(st);
    return lvl;
  }
  return 0;
}

/**
 * What to do next: the first lesson the current level still asks for (then
 * any missed below it, then the next level's), and the unmet skill
 * requirement of the current level with the biggest gap.
 */
function next(app, levels, lessons, level) {
  const c = C();
  let lesson = null;
  const cur0 = levels[Math.max(0, Math.min(levels.length - 1, level - 1))];
  const wanted = cur0 ? cur0.items.filter((it) => it.kind === 'lesson' && !it.ok) : [];
  if (wanted.length > 0) lesson = c.lesson(wanted[0].key);
  if (lesson === null) {
    const order = c.LESSONS.slice().sort((a, b) => a.level - b.level);
    for (const l of order) {
      if (l.level > level + 1) break;
      if (lessons[l.key] === undefined) {
        lesson = l;
        break;
      }
    }
  }
  let skill = null;
  const cur = levels[Math.max(0, Math.min(levels.length - 1, level - 1))];
  if (cur !== undefined) {
    let worst = null;
    for (const it of cur.items) {
      if (it.ok || (it.kind !== 'skill' && it.kind !== 'sight' && it.kind !== 'scales')) continue;
      const gap = it.kind === 'skill' ? it.need - it.have : 1;
      if (worst === null || gap > worst.gap) worst = { it: it, gap: gap };
    }
    if (worst !== null) skill = { key: worst.it.kind === 'scales' ? 'tech.scales' : worst.it.key, title: worst.it.title, kind: worst.it.kind };
  }
  return { lesson: lesson, skill: skill };
}

function state(app, p, e) {
  const u = U();
  const c = C();
  const m = M();
  m.ensureSeeded(app);
  const agent = u.fromAgent(e);
  const lessons = lessonRows(app);
  const skills = skillRows(app);
  const levels = evaluate(app, { lessons: lessons, skills: skills });
  const level = m.settings(app).getInt('level') || 1;
  const nx = next(app, levels, lessons, level);
  if (agent) {
    const cur = levels[level - 1];
    // The lowest mastery among the skills drilled so far.
    let weakestSkill = null;
    for (const k of Object.keys(skills)) {
      const s = skillJson(k, skills[k]);
      if (s.attempts > 0 && (weakestSkill === null || s.mastery < weakestSkill.mastery)) weakestSkill = { key: k, title: s.title, mastery: s.mastery };
    }
    const label = (i) => {
      const have = i.need !== undefined ? ' (have ' + i.have + ', need ' + i.need + ')' : '';
      if (i.kind === 'lesson') return 'lesson ' + i.key + ': ' + i.title;
      if (i.kind === 'skill') return 'skill ' + i.key + ': ' + i.title + have;
      if (i.kind === 'scales') return 'technique tech.scales: ' + i.title + have;
      if (i.kind === 'sight') return 'skill sight.read: ' + i.title + have;
      return 'pieces: ' + i.title + have;
    };
    return {
      level: level,
      level_name: cur ? cur.name : '',
      lessons_done: Object.keys(lessons),
      lessons_total: c.LESSONS.length,
      next_lesson: nx.lesson,
      weakest_requirement: nx.skill,
      weakest_skill: weakestSkill,
      current_level_missing: cur ? cur.items.filter((i) => !i.ok).map(label) : [],
      plan_blocks: 'plan.set takes lesson and drill blocks next to song blocks, e.g. ' + JSON.stringify([{ kind: 'lesson', lesson: nx.lesson ? nx.lesson.key : 'rd-marks', minutes: 8 }, { kind: 'drill', skill: weakestSkill ? weakestSkill.key : 'read.grand', minutes: 4 }]),
      skills: Object.keys(c.SKILLS)
        .filter((k) => skills[k] !== undefined)
        .map((k) => {
          const s = skillJson(k, skills[k]);
          return { key: k, title: s.title, mastery: s.mastery, attempts: s.attempts, level: s.best_level || undefined, last: s.last_at.slice(0, 10) };
        }),
    };
  }
  return {
    level: level,
    tracks: c.TRACKS,
    units: c.UNITS,
    lessons: c.LESSONS.map((l) => {
      const r = lessons[l.key];
      return { key: l.key, unit: l.unit, level: l.level, title: l.title, minutes: l.minutes, done: r !== undefined, score: r ? r.getFloat('best') : 0, done_at: r ? r.getString('done_at') : '' };
    }),
    skills: Object.keys(c.SKILLS).map((k) => skillJson(k, skills[k] || null)),
    path: levels,
    next: nx,
  };
}

/* ------------------------------------------------------------- lessons */

function lessonDone(app, e, p) {
  const u = U();
  const c = C();
  const m = M();
  u.personOnly(e, 'finish lessons (the person takes them)');
  const key = u.req(p, 'lesson', 'kb-keys');
  const l = c.lesson(key);
  if (l === null) throw u.fail(404, 'No lesson ' + key + '. learn.state lists them.');
  const score = Math.max(0, Math.min(1, u.number(p, 'score', { min: 0, max: 1 }) === null ? 1 : u.number(p, 'score', { min: 0, max: 1 })));
  const ms = Math.min(3 * 3600000, Math.max(0, u.number(p, 'duration_ms', { min: 0 }) || 0));
  const rows = app.findRecordsByFilter('lessons', 'key = {:k}', '', 1, 0, { k: key });
  const rec = rows.length > 0 ? rows[0] : new Record(app.findCollectionByNameOrId('lessons'));
  const first = rows.length === 0;
  rec.set('key', key);
  rec.set('score', r3(score));
  rec.set('best', r3(Math.max(score, first ? 0 : rec.getFloat('best'))));
  rec.set('attempts', (first ? 0 : rec.getInt('attempts')) + 1);
  if (first) rec.set('done_at', u.now());
  app.save(rec);
  // The lesson's time is practice time: one activity row, like a drill.
  const sess = ms > 0 ? addTime(app, ms) : null;
  const d = new Record(app.findCollectionByNameOrId('drills'));
  d.set('drill', 'lesson');
  d.set('skill', 'lesson');
  if (sess !== null) d.set('session', sess.id);
  d.set('day', m.dayKey());
  d.set('accuracy', r3(score));
  d.set('score', r3(score));
  d.set('duration_ms', Math.round(ms));
  d.set('title', 'Lesson: ' + l.title);
  d.set('detail', { lesson: key });
  app.save(d);
  const up = advance(app);
  return { lesson: { key: key, title: l.title, score: rec.getFloat('score'), best: rec.getFloat('best'), attempts: rec.getInt('attempts') }, first: first, level_up: up };
}

/** Practice time from lessons and drills joins the open session. */
function addTime(app, ms) {
  const runs = require(`${__hooks}/lib_runs.js`);
  const m = M();
  const sess = runs.openSession(app, m.dayKey(), ms);
  sess.set('minutes', sess.getFloat('minutes') + ms / 60000);
  sess.set('last_at', U().now());
  app.save(sess);
  return sess;
}

/* -------------------------------------------------------------- drills */

function drillSave(app, e, p) {
  const u = U();
  const c = C();
  const m = M();
  u.personOnly(e, 'record drills (the person does them)');
  const drill = u.req(p, 'drill', 'notes');
  const key = u.req(p, 'skill', 'read.treble.1');
  const def = c.SKILLS[key];
  if (def === undefined) throw u.fail(400, 'No skill ' + key + '. learn.state lists the skills.');
  const items = u.int(p, 'items', 0, 0, 100000);
  const correct = u.int(p, 'correct', 0, 0, 100000);
  const avgMs = u.number(p, 'avg_ms', { min: 0 }) || 0;
  const ms = Math.min(3 * 3600000, Math.max(0, u.number(p, 'duration_ms', { min: 0 }) || 0));
  const tempo = u.number(p, 'tempo_pct', { min: 10, max: 200 });
  const given = u.number(p, 'accuracy', { min: 0, max: 1 });
  const lvl = u.int(p, 'level', 0, 0, 100);
  const detail = u.obj(p, 'detail', '{"id":"major:D","title":"D major scale"}') || {};
  const complete = u.bool(p, 'complete', true);
  // Learn mode waits for each note: it trains the notes, not the speed.
  const learning = u.str(p, 'mode', '') === 'learn';
  if (items === 0 && given === null) throw u.fail(400, 'items or accuracy is required');
  const acc = given !== null ? given : correct / Math.max(1, items);
  const engine = ENGINE_DRILLS.indexOf(drill) >= 0;
  let score;
  if (engine) score = acc * (tempo === null ? 1 : Math.min(1, tempo / 100));
  else {
    const target = def.target_ms || 2500;
    const speed = avgMs <= 0 ? 1 : Math.max(0, Math.min(1, (2 * target - avgMs) / target));
    score = acc * (0.8 + 0.2 * speed);
  }
  if (!complete) score = Math.min(score, acc * 0.5);
  if (learning) score = Math.min(score, acc * 0.6);

  const rows = app.findRecordsByFilter('skills', 'key = {:k}', '', 1, 0, { k: key });
  const rec = rows.length > 0 ? rows[0] : new Record(app.findCollectionByNameOrId('skills'));
  const first = rows.length === 0;
  const prev = first ? 0 : rec.getFloat('mastery');
  const alpha = engine ? 0.35 : Math.max(0.15, Math.min(0.6, items / 30));
  const mastery = first ? score * 0.85 : prev + (score - prev) * alpha;
  rec.set('key', key);
  rec.set('mastery', r3(Math.max(0, Math.min(1, mastery))));
  rec.set('attempts', (first ? 0 : rec.getInt('attempts')) + 1);
  const totItems = (first ? 0 : rec.getInt('items')) + items;
  rec.set('items', totItems);
  rec.set('correct', (first ? 0 : rec.getInt('correct')) + correct);
  if (avgMs > 0 && items > 0) rec.set('avg_ms', Math.round(((first ? 0 : rec.getFloat('avg_ms') * (totItems - items)) + avgMs * items) / Math.max(1, totItems)));
  // Sight-reading climbs one level after a strong pass and steps back after a weak one.
  let sightLevel = 0;
  if (key === 'sight.read' && complete && !learning) {
    const cur = Math.max(1, lvl || rec.getInt('level') || 1);
    const nextLvl = acc >= 0.85 ? Math.min(30, cur + 1) : acc < 0.6 ? Math.max(1, cur - 1) : cur;
    rec.set('level', nextLvl);
    if (acc >= 0.8) rec.set('best_level', Math.max(rec.getInt('best_level'), cur));
    sightLevel = nextLvl;
  } else if (lvl > 0) rec.set('level', lvl);
  // Technique keeps the best clean tempo per exercise (key and type).
  if ((key === 'tech.scales' || key === 'tech.arps' || key === 'tech.five') && typeof detail.id === 'string' && detail.id !== '') {
    const data = first ? {} : u.getJson(rec, 'data') || {};
    const cur = data[detail.id] || { best: 0 };
    const clean = complete && acc >= 0.9 && !learning;
    data[detail.id] = { best: Math.max(cur.best || 0, clean ? Math.round(tempo || 100) : 0), acc: r3(acc), title: String(detail.title || detail.id).slice(0, 80), last: m.dayKey() };
    rec.set('data', data);
  }
  const hist = first ? [] : u.getJson(rec, 'history') || [];
  hist.push({ d: m.dayKey(), s: r3(score), a: r3(acc) });
  rec.set('history', hist.slice(-60));
  rec.set('last_at', u.now());
  app.save(rec);

  const sess = ms > 0 ? addTime(app, ms) : null;
  const d = new Record(app.findCollectionByNameOrId('drills'));
  d.set('drill', drill);
  d.set('skill', key);
  if (sess !== null) d.set('session', sess.id);
  d.set('day', m.dayKey());
  d.set('items', items);
  d.set('correct', correct);
  d.set('accuracy', r3(acc));
  d.set('avg_ms', Math.round(avgMs));
  d.set('duration_ms', Math.round(ms));
  if (tempo !== null) d.set('tempo_pct', Math.round(tempo));
  d.set('level', lvl);
  d.set('score', r3(score));
  d.set('title', String(detail.title || def.title).slice(0, 160));
  d.set('detail', detail);
  app.save(d);
  const up = advance(app);
  return { skill: skillJson(key, rec), score: r3(score), sight_level: sightLevel, level_up: up };
}

function drillList(app, p) {
  const u = U();
  const m = M();
  const days = u.int(p, 'days', 7, 1, 400);
  const since = m.addDays(m.dayKey(), -(days - 1));
  const rows = app.findRecordsByFilter('drills', 'day >= {:d}', '-created', u.int(p, 'limit', 60, 1, 500), 0, { d: since });
  return {
    drills: rows.map((r) => ({ id: r.id, day: r.getString('day'), drill: r.getString('drill'), skill: r.getString('skill'), title: r.getString('title'), items: r.getInt('items'), correct: r.getInt('correct'), accuracy: r.getFloat('accuracy'), avg_ms: r.getFloat('avg_ms'), tempo_pct: r.getFloat('tempo_pct'), level: r.getInt('level'), minutes: Math.round(r.getInt('duration_ms') / 600) / 100, created: r.getString('created') })),
  };
}

/* ------------------------------------------------------------ notation */

function parse(app, p) {
  const u = U();
  const a = require(`${__hooks}/lib_abc.js`);
  const abc = u.req(p, 'abc', '"X:1\\nK:C\\nC D E F|"');
  const r = a.parse(abc);
  if (!r.ok) throw u.fail(400, 'The notation has problems: ' + r.errors.slice(0, 6).map((x) => (x.line ? 'line ' + x.line + ': ' : '') + x.message).join(' | '), { errors: r.errors });
  return { model: r.model, summary: r.summary, sections: a.defaultSections(r.model) };
}

module.exports = { state: state, lessonDone: lessonDone, drillSave: drillSave, drillList: drillList, parse: parse, evaluate: evaluate, advance: advance, next: next, skillRows: skillRows, lessonRows: lessonRows, skillJson: skillJson, addTime: addTime };
