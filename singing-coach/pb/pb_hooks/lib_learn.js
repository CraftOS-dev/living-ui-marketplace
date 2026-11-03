/// <reference path="../pb_data/types.d.ts" />
/**
 * Learning: the curriculum's lessons, the skills the drills train, and the
 * path of ten levels.
 *
 *   learn.state   lessons done, every skill's mastery, each level's
 *                 requirements met or not, what to do next
 *   learn.lesson  a finished lesson (score, time)
 *   drills.save   one drill run: moves the skill's mastery (accuracy weighted
 *                 by speed, or by tempo for sung exercises), adaptive levels,
 *                 technique bests per vocalise and starting note, sustain and
 *                 steadiness records; counts as practice time and voice use
 *   drills.list   recent drill runs
 *   abc.parse     notation to the practice model without saving (generated
 *                 vocalises, sight-singing, lesson examples)
 *
 * A level is complete when every requirement is met; the learner's level
 * then moves up by itself.
 */

var TEMPO_DRILLS = ['exercise', 'sight', 'speak'];
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
  return m >= 0.9 ? 3 : m >= 0.75 ? 2 : m >= 0.6 ? 1 : 0;
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
    levels: def.levels || 0,
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

function dataOf(skills, key) {
  return skills[key] ? U().getJson(skills[key], 'data') || {} : {};
}

/* ------------------------------------------------------------- the path */

/** Measured voice facts the path asks about. */
function voiceFacts(app, skills) {
  const V = require(`${__hooks}/lib_voice.js`);
  const m = M();
  const v = V.current(app);
  const sus = dataOf(skills, 'breath.sustain');
  const hold = dataOf(skills, 'pitch.hold');
  const messa = dataOf(skills, 'tech.messa');
  let swell = 0;
  for (const k of Object.keys(messa)) swell = Math.max(swell, Number(messa[k].swell) || 0);
  const holds = {};
  for (const k of Object.keys(hold)) {
    const mm = /^hold@(\d+)$/.exec(k);
    if (mm !== null) holds[Number(mm[1])] = hold[k].sd;
  }
  return {
    span: v.tested ? Math.round(v.comf_high - v.comf_low) : 0,
    sustain: Math.max(v.sustain_s || 0, Number(sus.best) || 0),
    holds: holds,
    swell: swell,
    tested_days: v.tested ? m.daysBetween(String(v.created).slice(0, 10), m.dayKey()) : 9999,
  };
}

/** The best (lowest) steadiness held for at least `secs` seconds. */
function bestHold(holds, secs) {
  let best = null;
  for (const k of Object.keys(holds)) if (Number(k) >= secs && (best === null || holds[k] < best)) best = holds[k];
  return best;
}

/** Every level's requirements, met or not, from what has been done so far. */
function evaluate(app, rows) {
  const c = C();
  const m = M();
  const lessons = rows && rows.lessons ? rows.lessons : lessonRows(app);
  const skills = rows && rows.skills ? rows.skills : skillRows(app);
  const progs = require(`${__hooks}/lib_songs.js`).progressMap(app);
  const songs = [];
  for (const s of app.findRecordsByFilter('songs', 'archived = false', '', 0, 0)) {
    const secs = m.sectionsOf(s);
    const states = m.statesOf(progs[s.id] || null, secs.length);
    let low = 3;
    for (const st of states) low = Math.min(low, STAGE_RANK[st.stage] || 0);
    if (states.length === 0) low = 0;
    songs.push({
      level: s.getInt('level') || 1,
      low: low,
      seconds: s.getInt('seconds'),
      kind: s.getString('kind') || 'song',
      lang: s.getString('language') || '',
      tags: U().getJson(s, 'tags') || [],
      solo: states.some((x) => (x.solo_cleans || 0) > 0),
      memory: states.length > 0 && states.every((x) => x.memory === true),
    });
  }
  const vf = voiceFacts(app, skills);
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
      } else if (req.kind === 'level') {
        const rec = skills[req.key];
        const have = rec ? rec.getInt('best_level') : 0;
        items.push({ track: track, kind: 'level', key: req.key, title: ((c.SKILLS[req.key] || {}).title || req.key) + ', level ' + req.level, need: req.level, have: have, level: req.level, ok: have >= req.level });
      } else if (req.kind === 'tech') {
        for (const ex of req.keys) {
          const def = c.EXERCISES[ex] || { title: ex, skill: 'tech.scales' };
          const data = dataOf(skills, def.skill);
          let n = 0;
          for (const id of Object.keys(data)) {
            if (id.split('@')[0] !== ex) continue;
            const d = data[id];
            if (d.clean && (req.bpm === undefined || (d.bpm || 0) >= req.bpm)) n++;
          }
          items.push({ track: track, kind: 'tech', key: ex, skill: def.skill, title: def.title + ': clean from ' + req.count + ' starting notes' + (req.bpm ? ' at ' + req.bpm + ' bpm' : ''), need: req.count, have: n, bpm: req.bpm, ok: n >= req.count });
        }
      } else if (req.kind === 'voice') {
        let it;
        if (req.metric === 'span') it = { title: 'A comfortable range of ' + req.min + ' semitones', need: req.min, have: vf.span, ok: vf.span >= req.min };
        else if (req.metric === 'sustain') it = { title: 'Sustain ' + req.min + ' s on one breath', need: req.min, have: Math.round(vf.sustain * 10) / 10, ok: vf.sustain >= req.min };
        else if (req.metric === 'hold') {
          const b = bestHold(vf.holds, req.secs);
          it = { title: 'Hold a note ' + req.secs + ' s within ±' + req.sd + '¢', need: req.sd, have: b === null ? null : Math.round(b * 10) / 10, ok: b !== null && b <= req.sd, secs: req.secs };
        } else if (req.metric === 'swell') it = { title: 'A messa di voce swelling ' + req.db + ' dB on pitch', need: req.db, have: Math.round(vf.swell * 10) / 10, ok: vf.swell >= req.db };
        else it = { title: 'A range test in the last ' + req.days + ' days', need: req.days, have: vf.tested_days > 999 ? null : vf.tested_days, ok: vf.tested_days <= req.days };
        it.track = track;
        it.kind = 'voice';
        it.key = req.metric;
        items.push(it);
      } else if (req.kind === 'songs') {
        const rank = STAGE_RANK[req.stage] || 2;
        const pool = songs.filter((s) => s.level >= req.level && s.low >= rank && (req.type === undefined || s.kind === req.type) && (req.tag === undefined || s.tags.indexOf(req.tag) >= 0) && (req.lang === undefined || s.lang === req.lang));
        const solo = pool.filter((s) => s.solo).length;
        const memory = pool.filter((s) => s.memory).length;
        const langs = {};
        for (const s of pool) if (s.lang !== '') langs[s.lang] = true;
        const nl = Object.keys(langs).length;
        let ok = pool.length >= req.count;
        if (req.solo) ok = ok && solo >= req.solo;
        if (req.memory) ok = ok && memory >= req.memory;
        if (req.langs) ok = ok && nl >= req.langs;
        const what = req.type === 'vocalise' ? (req.count === 1 ? 'vocalise' : 'vocalises') : req.tag === 'trad' ? 'traditional ' + (req.count === 1 ? 'song' : 'songs') : req.tag === 'art' ? (req.count === 1 ? 'art song' : 'art songs') : req.lang === 'it' ? 'Italian ' + (req.count === 1 ? 'song' : 'songs') : req.count === 1 ? 'song' : 'songs';
        let title = req.count + ' ' + what + ' at level ' + req.level + ' or above, ' + req.stage;
        if (req.memory) title += ', ' + (req.memory === req.count ? 'all' : req.memory) + ' from memory';
        else if (req.solo) title += ', ' + req.solo + ' clean in Solo';
        if (req.langs) title += ', in ' + req.langs + ' languages';
        items.push({ track: track, kind: 'songs', key: 'songs' + req.level + (req.tag || req.type || req.lang || ''), level: req.level, title: title, need: req.count, have: pool.length, ok: ok });
      } else if (req.kind === 'program') {
        let secs = 0;
        for (const s of songs) if (s.low >= 3) secs += s.seconds;
        const mins = Math.floor(secs / 60);
        items.push({ track: track, kind: 'program', key: 'program', title: req.minutes + ' minutes of mastered songs (a recital programme)', need: req.minutes, have: mins, ok: mins >= req.minutes });
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
 * any missed below it, then the next level's), and the unmet trainable
 * requirement of the current level with the biggest gap.
 */
function next(app, levels, lessons, level) {
  const c = C();
  let lesson = null;
  const cur = levels[Math.max(0, Math.min(levels.length - 1, level - 1))];
  const wanted = cur ? cur.items.filter((it) => it.kind === 'lesson' && !it.ok) : [];
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
  if (cur !== undefined) {
    let worst = null;
    for (const it of cur.items) {
      if (it.ok || (it.kind !== 'skill' && it.kind !== 'level' && it.kind !== 'tech')) continue;
      const gap = it.kind === 'skill' ? it.need - it.have : it.kind === 'level' ? (it.need - it.have) / 3 : (it.need - it.have) / Math.max(1, it.need);
      if (worst === null || gap > worst.gap) worst = { it: it, gap: gap };
    }
    if (worst !== null) {
      const it = worst.it;
      skill = it.kind === 'tech' ? { key: it.skill, title: it.title, kind: 'tech', ex: it.key } : { key: it.key, title: it.title, kind: it.kind };
    }
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
      if (i.kind === 'skill' || i.kind === 'level') return 'skill ' + i.key + ': ' + i.title + have;
      if (i.kind === 'tech') return 'vocalise ' + i.key + ' (skill ' + i.skill + '): ' + i.title + have;
      if (i.kind === 'voice') return 'voice ' + i.key + ': ' + i.title + have;
      return 'songs: ' + i.title + have;
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
      plan_blocks: 'plan.set takes these blocks: ' + JSON.stringify([{ kind: 'warmup', ex: 'sovt.siren', minutes: 5 }, { song: '{id}', from: 1, to: 8, mode: 'sing', tempo: 90, minutes: 6, why: 'climb' }, { kind: 'lesson', lesson: nx.lesson ? nx.lesson.key : 'pi-cents', minutes: 7 }, { kind: 'drill', skill: weakestSkill ? weakestSkill.key : 'int.sing', minutes: 4 }, { kind: 'exercise', ex: 'five.min', minutes: 4 }, { kind: 'cooldown', ex: 'desc5', minutes: 3 }]),
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
    exercises: c.EXERCISES,
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
  const key = u.req(p, 'lesson', 'vo-instrument');
  const l = c.lesson(key);
  if (l === null) throw u.fail(404, 'No lesson ' + key + '. learn.state lists them.');
  const sc = u.number(p, 'score', { min: 0, max: 1 });
  const score = sc === null ? 1 : sc;
  const ms = Math.min(3 * 3600000, Math.max(0, u.number(p, 'duration_ms', { min: 0 }) || 0));
  const voicedMs = Math.max(0, u.number(p, 'voiced_ms', { min: 0 }) || 0);
  const cycles = Math.max(0, u.number(p, 'cycles', { min: 0 }) || 0);
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
  const sess = ms > 0 ? require(`${__hooks}/lib_runs.js`).addToSession(app, m.dayKey(), { ms: ms, voiced_ms: voicedMs, cycles: cycles }) : null;
  const d = new Record(app.findCollectionByNameOrId('drills'));
  d.set('drill', 'lesson');
  d.set('skill', 'lesson');
  if (sess !== null) d.set('session', sess.id);
  d.set('day', m.dayKey());
  d.set('accuracy', r3(score));
  d.set('score', r3(score));
  d.set('duration_ms', Math.round(ms));
  d.set('voiced_ms', Math.round(voicedMs));
  d.set('cycles', Math.round(cycles));
  d.set('title', 'Lesson: ' + l.title);
  d.set('detail', { lesson: key });
  app.save(d);
  const up = advance(app);
  return { lesson: { key: key, title: l.title, score: rec.getFloat('score'), best: rec.getFloat('best'), attempts: rec.getInt('attempts') }, first: first, level_up: up };
}

/* -------------------------------------------------------------- drills */

function drillSave(app, e, p) {
  const u = U();
  const c = C();
  const m = M();
  u.personOnly(e, 'record drills (the person does them)');
  const drill = u.req(p, 'drill', 'quiz');
  const key = u.req(p, 'skill', 'int.hear');
  const def = c.SKILLS[key];
  if (def === undefined) throw u.fail(400, 'No skill ' + key + '. learn.state lists the skills.');
  const items = u.int(p, 'items', 0, 0, 100000);
  const correct = u.int(p, 'correct', 0, 0, 100000);
  const avgMs = u.number(p, 'avg_ms', { min: 0 }) || 0;
  const ms = Math.min(3 * 3600000, Math.max(0, u.number(p, 'duration_ms', { min: 0 }) || 0));
  const voicedMs = Math.max(0, u.number(p, 'voiced_ms', { min: 0 }) || 0);
  const cycles = Math.max(0, u.number(p, 'cycles', { min: 0 }) || 0);
  const tempo = u.number(p, 'tempo_pct', { min: 10, max: 200 });
  const given = u.number(p, 'accuracy', { min: 0, max: 1 });
  const lvl = u.int(p, 'level', 0, 0, 100);
  const detail = u.obj(p, 'detail', '{"ex":"five.maj","start":"D4","bpm":90,"clean":true}') || {};
  const complete = u.bool(p, 'complete', true);
  if (items === 0 && given === null) throw u.fail(400, 'items or accuracy is required');
  const acc = given !== null ? given : correct / Math.max(1, items);
  const tempoDrill = TEMPO_DRILLS.indexOf(drill) >= 0;
  let score;
  if (tempoDrill) score = acc * (tempo === null ? 1 : Math.min(1, tempo / 100));
  else {
    const target = def.target_ms || 2500;
    const speed = avgMs <= 0 ? 1 : Math.max(0, Math.min(1, (2 * target - avgMs) / target));
    score = acc * (0.8 + 0.2 * speed);
  }
  if (!complete) score = Math.min(score, acc * 0.5);
  const rows = app.findRecordsByFilter('skills', 'key = {:k}', '', 1, 0, { k: key });
  const rec = rows.length > 0 ? rows[0] : new Record(app.findCollectionByNameOrId('skills'));
  const first = rows.length === 0;
  const prev = first ? 0 : rec.getFloat('mastery');
  const alpha = tempoDrill ? 0.35 : Math.max(0.15, Math.min(0.6, items / 30));
  const mastery = first ? score * 0.85 : prev + (score - prev) * alpha;
  rec.set('key', key);
  rec.set('mastery', r3(Math.max(0, Math.min(1, mastery))));
  rec.set('attempts', (first ? 0 : rec.getInt('attempts')) + 1);
  const totItems = (first ? 0 : rec.getInt('items')) + items;
  rec.set('items', totItems);
  rec.set('correct', (first ? 0 : rec.getInt('correct')) + correct);
  if (avgMs > 0 && items > 0) rec.set('avg_ms', Math.round(((first ? 0 : rec.getFloat('avg_ms') * (totItems - items)) + avgMs * items) / Math.max(1, totItems)));
  // Adaptive skills climb one level after a strong run and step back after a weak one.
  let newLevel = 0;
  if (def.levels && complete) {
    const cur = Math.max(1, lvl || rec.getInt('level') || 1);
    const nextLvl = acc >= 0.85 ? Math.min(def.levels, cur + 1) : acc < 0.6 ? Math.max(1, cur - 1) : cur;
    rec.set('level', nextLvl);
    if (acc >= 0.8) rec.set('best_level', Math.max(rec.getInt('best_level'), cur));
    newLevel = nextLvl;
  } else if (lvl > 0) rec.set('level', lvl);
  // Records kept per exercise: technique per vocalise and starting note; sustain; steadiness.
  const data = first ? {} : u.getJson(rec, 'data') || {};
  let dataChanged = false;
  // One vocalise run is sung from several starting notes: each rep counts on its own.
  const reps = Array.isArray(detail.reps) ? detail.reps.slice(0, 40) : typeof detail.start === 'string' && detail.start !== '' ? [{ start: detail.start, clean: detail.clean === true, acc: acc, swell: detail.swell }] : [];
  if (typeof detail.ex === 'string' && detail.ex !== '' && c.EXERCISES[detail.ex] !== undefined) {
    for (const rp of reps) {
      if (rp === null || typeof rp !== 'object' || typeof rp.start !== 'string' || !/^[A-G][#b]?\d$/.test(rp.start)) continue;
      const id = detail.ex + '@' + rp.start;
      const old = data[id] || { bpm: 0, clean: false };
      const rAcc = typeof rp.acc === 'number' ? rp.acc : acc;
      const clean = rp.clean === true && rAcc >= 0.85;
      data[id] = {
        clean: old.clean === true || clean,
        bpm: Math.max(old.bpm || 0, clean ? Math.round(Number(detail.bpm) || 0) : 0),
        acc: r3(rAcc),
        swell: Math.max(Number(old.swell) || 0, clean ? Number(rp.swell) || 0 : 0),
        title: String((c.EXERCISES[detail.ex] || {}).title || detail.ex).slice(0, 80),
        last: m.dayKey(),
      };
      dataChanged = true;
    }
  }
  if (key === 'breath.sustain' && Number(detail.seconds) > 0) {
    data.best = Math.max(Number(data.best) || 0, Math.round(Number(detail.seconds) * 10) / 10);
    require(`${__hooks}/lib_voice.js`).noteSustain(app, Number(detail.seconds));
    dataChanged = true;
  }
  if (key === 'pitch.hold' && Array.isArray(detail.holds)) {
    for (const h of detail.holds.slice(0, 20)) {
      const secs = Math.floor(Number(h.secs) || 0);
      const sd = Number(h.sd);
      if (secs < 1 || !isFinite(sd)) continue;
      const k = 'hold@' + Math.min(30, secs);
      const old = data[k];
      if (old === undefined || sd < old.sd) data[k] = { sd: Math.round(sd * 10) / 10, last: m.dayKey() };
    }
    dataChanged = true;
  }
  if (dataChanged) rec.set('data', data);
  const hist = first ? [] : u.getJson(rec, 'history') || [];
  hist.push({ d: m.dayKey(), s: r3(score), a: r3(acc) });
  rec.set('history', hist.slice(-60));
  rec.set('last_at', u.now());
  app.save(rec);
  const phase = detail.phase === 'warmup' || detail.phase === 'cooldown' ? detail.phase : '';
  const sess = ms > 0 ? require(`${__hooks}/lib_runs.js`).addToSession(app, m.dayKey(), { ms: ms, voiced_ms: voicedMs, cycles: cycles, warmup_ms: phase === 'warmup' ? ms : 0, cooldown_ms: phase === 'cooldown' ? ms : 0 }) : null;
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
  d.set('voiced_ms', Math.round(voicedMs));
  d.set('cycles', Math.round(cycles));
  if (tempo !== null) d.set('tempo_pct', Math.round(tempo));
  d.set('level', lvl);
  d.set('score', r3(score));
  d.set('title', String(detail.title || def.title).slice(0, 160));
  d.set('detail', detail);
  app.save(d);
  const up = advance(app);
  return { skill: skillJson(key, rec), score: r3(score), level: newLevel, level_up: up, health: require(`${__hooks}/lib_health.js`).nudge(app) };
}

function drillList(app, p) {
  const u = U();
  const m = M();
  const days = u.int(p, 'days', 7, 1, 400);
  const since = m.addDays(m.dayKey(), -(days - 1));
  const rows = app.findRecordsByFilter('drills', 'day >= {:d}', '-created', u.int(p, 'limit', 60, 1, 500), 0, { d: since });
  return {
    drills: rows.map((r) => ({ id: r.id, day: r.getString('day'), drill: r.getString('drill'), skill: r.getString('skill'), title: r.getString('title'), items: r.getInt('items'), correct: r.getInt('correct'), accuracy: r.getFloat('accuracy'), avg_ms: r.getFloat('avg_ms'), tempo_pct: r.getFloat('tempo_pct'), level: r.getInt('level'), minutes: Math.round(r.getInt('duration_ms') / 600) / 100, voiced_min: Math.round(r.getInt('voiced_ms') / 600) / 100, created: r.getString('created') })),
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

module.exports = { state: state, lessonDone: lessonDone, drillSave: drillSave, drillList: drillList, parse: parse, evaluate: evaluate, advance: advance, next: next, skillRows: skillRows, lessonRows: lessonRows, skillJson: skillJson };
