/// <reference path="../pb_data/types.d.ts" />
/**
 * Today's plan: a short list of timed blocks (a song, its bars, a mode and a
 * tempo). The app's rules write one every day from the sections' stages:
 *
 *   warm-up   the exercise practised least recently
 *   review    mastered sections that are due, played once at full tempo
 *   focus     the weakest sections of the songs in progress, at the next
 *             rung of their tempo ladder (Learn mode while a section is new)
 *   run       the whole song, once most of it is steady
 *   new       a new piece at the learner's level when nothing is in progress
 *
 * The coach may propose a plan instead (plan.set); a started plan stays as
 * it is, so a coach plan proposed after that goes to the next day.
 */

const MODES = ['listen', 'learn', 'play'];

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function scale(blocks, goal) {
  const total = blocks.reduce((a, b) => a + b.minutes, 0);
  if (total === 0) return blocks;
  const k = goal / total;
  for (const b of blocks) b.minutes = Math.max(2, Math.round(b.minutes * k));
  return blocks;
}

/** The rules' plan for a day (not stored until it starts). */
function rules(app, day) {
  const m = M();
  const u = U();
  const st = m.settings(app);
  const goal = st.getInt('daily_minutes') || 20;
  const level = st.getInt('level') || 1;
  const progs = require(`${__hooks}/lib_songs.js`).progressMap(app);
  const songs = app.findRecordsByFilter('songs', 'archived = false', 'level,title', 0, 0);
  const items = songs.map((r) => {
    const secs = m.sectionsOf(r);
    const prog = progs[r.id] || null;
    return { rec: r, secs: secs, states: m.statesOf(prog, secs.length), last: prog === null ? 0 : u.ms(prog.getString('last_at')), runs: prog === null ? 0 : prog.getInt('runs') };
  });
  const blocks = [];
  const lastBar = (it) => it.secs.length > 0 ? it.secs[it.secs.length - 1].to : it.rec.getInt('bars');
  const firstBar = (it) => (it.secs.length > 0 ? it.secs[0].from : 1);

  // Warm-up: the exercise at or below the learner's level practised least recently.
  const ex = items.filter((it) => it.rec.getString('kind') === 'exercise' && (it.rec.getInt('level') || 1) <= level + 1).sort((a, b) => a.last - b.last)[0];
  if (ex !== undefined) {
    const best = ex.states.length > 0 ? Math.min.apply(null, ex.states.map((s) => s.best || 0)) : 0;
    blocks.push({ song: ex.rec.id, from: firstBar(ex), to: lastBar(ex), mode: best > 0 ? 'play' : 'learn', tempo: best > 0 ? m.nextTempo({ best: best }) : 100, minutes: 3, why: 'warm-up' });
  }

  // Reviews that are due: one pass each, first thing.
  const due = [];
  for (const it of items) {
    it.states.forEach((s, i) => {
      if (s.stage === 'mastered' && s.due !== '' && s.due <= day) due.push({ it: it, i: i, due: s.due });
    });
  }
  due.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  for (const d of due.slice(0, 3)) {
    const sec = d.it.secs[d.i];
    blocks.push({ song: d.it.rec.id, from: sec.from, to: sec.to, mode: 'play', tempo: 100, minutes: 2, why: 'review' });
  }

  // Focus: songs in progress, most recent first.
  const current = items
    .filter((it) => it.rec.getString('kind') !== 'exercise' && it.runs > 0 && it.states.some((s) => s.stage !== 'mastered'))
    .sort((a, b) => b.last - a.last)
    .slice(0, 2);
  const order = { learning: 0, new: 1, steady: 2, mastered: 3 };
  for (const it of current) {
    const picks = it.states
      .map((s, i) => ({ s: s, i: i }))
      .filter((x) => x.s.stage !== 'mastered')
      .sort((a, b) => order[a.s.stage] - order[b.s.stage] || (a.s.best || 0) - (b.s.best || 0) || a.i - b.i)
      .slice(0, 2)
      .sort((a, b) => a.i - b.i);
    for (const x of picks) {
      const sec = it.secs[x.i];
      const learn = x.s.stage === 'new' || (x.s.best || 0) === 0;
      blocks.push({ song: it.rec.id, from: sec.from, to: sec.to, mode: learn ? 'learn' : 'play', tempo: learn ? 100 : m.nextTempo(x.s), minutes: 5, why: learn ? 'new' : x.s.stage === 'steady' ? 'polish' : 'climb' });
    }
    const solid = it.states.filter((s) => s.stage === 'steady' || s.stage === 'mastered').length;
    if (it.states.length > 1 && solid >= Math.ceil(it.states.length / 2)) {
      const low = Math.min.apply(null, it.states.map((s) => s.best || 60));
      blocks.push({ song: it.rec.id, from: firstBar(it), to: lastBar(it), mode: 'play', tempo: Math.max(60, Math.min(100, low)), minutes: 3, why: 'run' });
    }
  }

  // Nothing in progress: start the next piece at the learner's level.
  if (current.length === 0) {
    const fresh = items
      .filter((it) => it.rec.getString('kind') !== 'exercise' && it.runs === 0 && (it.rec.getInt('level') || 1) <= level + 1)
      .sort((a, b) => (a.rec.getInt('level') || 1) - (b.rec.getInt('level') || 1))[0];
    if (fresh !== undefined && fresh.secs.length > 0) {
      const sec = fresh.secs[0];
      blocks.push({ song: fresh.rec.id, from: sec.from, to: sec.to, mode: 'learn', tempo: 100, minutes: 6, why: 'new' });
    }
  }
  // The curriculum: the next lesson, and a drill for the weakest skill of the level.
  const L = require(`${__hooks}/lib_learn.js`);
  const lessons = L.lessonRows(app);
  const nx = L.next(app, L.evaluate(app, { lessons: lessons, skills: L.skillRows(app) }), lessons, level);
  if (nx.lesson !== null) blocks.push({ kind: 'lesson', lesson: nx.lesson.key, minutes: Math.max(4, nx.lesson.minutes), why: 'lesson' });
  if (nx.skill !== null) blocks.push({ kind: 'drill', skill: nx.skill.key, minutes: 4, why: 'skill' });
  return { day: day, source: 'rules', status: 'proposed', note: '', blocks: scale(blocks, goal), done: [] };
}

function stored(app, day) {
  const rows = app.findRecordsByFilter('plans', 'day = {:d}', '', 1, 0, { d: day });
  return rows.length > 0 ? rows[0] : null;
}

function fromRecord(r) {
  const u = U();
  return { day: r.getString('day'), source: r.getString('source'), status: r.getString('status'), note: r.getString('note'), blocks: u.getJson(r, 'blocks') || [], done: u.getJson(r, 'done') || [], id: r.id };
}

/** A plan with each block's song and section resolved for display. */
function resolve(app, plan) {
  const u = U();
  const m = M();
  const cache = {};
  const blocks = [];
  const cur = require(`${__hooks}/lib_curriculum.js`);
  plan.blocks.forEach((b, i) => {
    if (b.kind === 'lesson' || b.kind === 'drill') {
      const title = b.kind === 'lesson' ? (cur.lesson(b.lesson) || {}).title : (cur.SKILLS[b.skill] || {}).title;
      if (!title) return;
      const blk = { i: i, kind: b.kind, title: title, minutes: b.minutes, why: b.why || '', done: plan.done.indexOf(i) >= 0 };
      if (b.kind === 'lesson') blk.lesson = b.lesson || '';
      else blk.skill = b.skill || '';
      blocks.push(blk);
      return;
    }
    let rec = cache[b.song];
    if (rec === undefined) {
      rec = u.byId(app, 'songs', b.song);
      cache[b.song] = rec;
    }
    if (rec === null || rec.getBool('archived')) return;
    const secs = m.sectionsOf(rec);
    const sec = secs.filter((s) => s.from === b.from && s.to === b.to)[0];
    const whole = secs.length > 0 && b.from === secs[0].from && b.to === secs[secs.length - 1].to;
    blocks.push({
      i: i,
      kind: 'song',
      lesson: '',
      skill: '',
      song: b.song,
      title: rec.getString('title'),
      composer: rec.getString('composer'),
      song_kind: rec.getString('kind'),
      from: b.from,
      to: b.to,
      section: sec !== undefined ? sec.name : whole ? '' : null,
      whole: whole,
      mode: b.mode,
      tempo: b.tempo,
      bpm: Math.round((rec.getFloat('tempo') * b.tempo) / 100),
      hands: b.hands || 'both',
      minutes: b.minutes,
      why: b.why || '',
      done: plan.done.indexOf(i) >= 0,
    });
  });
  const st = m.settings(app);
  return {
    day: plan.day,
    source: plan.source,
    status: plan.status,
    note: plan.note,
    blocks: blocks,
    minutes: blocks.reduce((a, b) => a + b.minutes, 0),
    goal: st.getInt('daily_minutes') || 20,
    done: blocks.filter((b) => b.done).length,
  };
}

function today(app, p) {
  const u = U();
  const m = M();
  m.ensureSeeded(app);
  const day = u.str(p, 'day', '') || m.dayKey();
  if (!m.isDay(day)) throw u.fail(400, 'day must look like 2026-11-01');
  const r = stored(app, day);
  return { plan: resolve(app, r !== null ? fromRecord(r) : rules(app, day)) };
}

/** The person starts today's plan: it is kept as it is for the day. */
function start(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'start the plan');
  const day = m.dayKey();
  let r = stored(app, day);
  if (r === null) {
    const plan = rules(app, day);
    r = new Record(app.findCollectionByNameOrId('plans'));
    r.set('day', day);
    r.set('source', 'rules');
    r.set('blocks', plan.blocks);
    r.set('note', '');
    r.set('done', []);
  }
  if (r.getString('status') !== 'done') r.set('status', 'active');
  app.save(r);
  void p;
  return { plan: resolve(app, fromRecord(r)) };
}

function done(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'tick plan blocks');
  const day = m.dayKey();
  const r = stored(app, day);
  if (r === null) throw u.fail(409, 'Start the plan first (plan.start).');
  const i = u.int(p, 'block', -1, 0, 100);
  const blocks = u.getJson(r, 'blocks') || [];
  if (i >= blocks.length) throw u.fail(400, 'No block ' + i + ' in today\'s plan.');
  const list = u.getJson(r, 'done') || [];
  const undo = u.bool(p, 'undo', false);
  const pos = list.indexOf(i);
  if (!undo && pos < 0) list.push(i);
  if (undo && pos >= 0) list.splice(pos, 1);
  r.set('done', list);
  r.set('status', list.length >= blocks.length ? 'done' : 'active');
  app.save(r);
  return { plan: resolve(app, fromRecord(r)) };
}

/** The coach proposes a plan (today if today's has not started, otherwise tomorrow). */
function set(app, e, p) {
  const u = U();
  const m = M();
  const agent = u.fromAgent(e);
  if (agent && !m.settings(app).getBool('coach_plans')) throw u.fail(403, 'The person turned off coach plans in Settings; do not propose plans.', 'coach_plans_off');
  const today = m.dayKey();
  let day = u.str(p, 'day', '');
  if (day === '') {
    const t = stored(app, today);
    day = t !== null && t.getString('status') !== 'proposed' ? m.addDays(today, 1) : today;
  }
  if (!m.isDay(day)) throw u.fail(400, 'day must look like 2026-11-01');
  if (day < today) throw u.fail(400, 'day is in the past');
  const existing = stored(app, day);
  if (existing !== null && existing.getString('status') !== 'proposed') throw u.fail(409, 'The plan for ' + day + ' has already started; propose one for ' + m.addDays(day, 1) + ' instead.', 'started');
  const raw = u.list(p, 'blocks', '[{"song":"<id>","from":1,"to":8,"mode":"play","tempo":80,"minutes":5,"why":"climb"},{"kind":"lesson","lesson":"ch-triads","minutes":8},{"kind":"drill","skill":"read.bass.2","minutes":4}]');
  if (raw === undefined || raw.length === 0) throw u.fail(400, 'blocks is required: a JSON list of {song, from, to, mode, tempo, minutes, why}, {kind:"lesson", lesson, minutes} or {kind:"drill", skill, minutes}.');
  if (raw.length > 12) throw u.fail(400, 'At most 12 blocks.');
  const goal = m.settings(app).getInt('daily_minutes') || 20;
  const blocks = [];
  let total = 0;
  const cur = require(`${__hooks}/lib_curriculum.js`);
  raw.forEach((b, i) => {
    const where = 'Block ' + (i + 1) + ': ';
    if (b === null || typeof b !== 'object') throw u.fail(400, where + 'must be an object');
    if (b.kind === 'lesson' || b.kind === 'drill') {
      const minutes = Number(b.minutes);
      if (!isFinite(minutes) || minutes < 1 || minutes > 30) throw u.fail(400, where + 'minutes must be 1-30.');
      if (b.kind === 'lesson' && cur.lesson(String(b.lesson || '')) === null) throw u.fail(400, where + 'no lesson "' + b.lesson + '" (learn.state lists them).');
      if (b.kind === 'drill' && cur.SKILLS[String(b.skill || '')] === undefined) throw u.fail(400, where + 'no skill "' + b.skill + '" (learn.state lists them).');
      total += minutes;
      blocks.push(b.kind === 'lesson' ? { kind: 'lesson', lesson: String(b.lesson), minutes: Math.round(minutes), why: String(b.why || '').slice(0, 80) } : { kind: 'drill', skill: String(b.skill), minutes: Math.round(minutes), why: String(b.why || '').slice(0, 80) });
      return;
    }
    const rec = u.byId(app, 'songs', String(b.song || ''));
    if (rec === null || rec.getBool('archived')) throw u.fail(400, where + 'no song "' + b.song + '" (songs.list shows ids).');
    const model = m.modelOf(rec);
    const first = model.bars[0].n;
    const last = model.bars[model.bars.length - 1].n;
    const from = b.from === undefined ? first : Number(b.from);
    const to = b.to === undefined ? last : Number(b.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < first || to > last || from > to) throw u.fail(400, where + 'bars must be within ' + first + '-' + last + ' (got ' + b.from + '-' + b.to + ').');
    const mode = String(b.mode || 'play');
    if (MODES.indexOf(mode) < 0) throw u.fail(400, where + 'mode must be listen, learn or play');
    const tempo = b.tempo === undefined ? 100 : Number(b.tempo);
    if (!isFinite(tempo) || tempo < 30 || tempo > 150) throw u.fail(400, where + 'tempo is a percent of the song\'s tempo, 30-150.');
    const minutes = Number(b.minutes);
    if (!isFinite(minutes) || minutes < 1 || minutes > 30) throw u.fail(400, where + 'minutes must be 1-30.');
    const hands = b.hands === undefined ? 'both' : String(b.hands);
    if (['both', 'right', 'left'].indexOf(hands) < 0) throw u.fail(400, where + 'hands must be both, right or left');
    total += minutes;
    blocks.push({ song: rec.id, from: from, to: to, mode: mode, tempo: Math.round(tempo), minutes: Math.round(minutes), hands: hands, why: String(b.why || '').slice(0, 80) });
  });
  if (total > Math.max(goal * 2, goal + 20)) throw u.fail(400, 'The blocks add up to ' + total + ' minutes; the person\'s goal is ' + goal + ' a day. Keep the plan near the goal.');
  const r = existing !== null ? existing : new Record(app.findCollectionByNameOrId('plans'));
  r.set('day', day);
  r.set('source', agent ? 'coach' : 'rules');
  r.set('status', 'proposed');
  r.set('blocks', blocks);
  r.set('note', u.str(p, 'note', '').slice(0, 2000));
  r.set('done', []);
  app.save(r);
  return { plan: resolve(app, fromRecord(r)) };
}

/** The person goes back to the app's own plan for today. */
function reset(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'reset the plan');
  const r = stored(app, m.dayKey());
  if (r !== null) app.delete(r);
  return today(app, p);
}

module.exports = { today: today, start: start, done: done, set: set, reset: reset, rules: rules, resolve: resolve };
