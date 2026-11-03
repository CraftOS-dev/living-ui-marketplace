/// <reference path="../pb_data/types.d.ts" />
/**
 * Today's plan: a short list of timed blocks. The app's rules write one every
 * day from the sections' stages, the curriculum and the voice's health:
 *
 *   warm-up    always first, 5-8 minutes: a straw or lip-trill siren, then the
 *              level's gentle scale (5-10 minutes is enough; more does not help)
 *   reviews    mastered sections that are due: one Solo each (the cold check)
 *   focus      the weakest sections of the songs in progress: Echo while a
 *              section is new, Sing up the tempo ladder, Solo once it is at
 *              full tempo (steady needs a clean Solo)
 *   technique  the vocalise of the level furthest from its requirement
 *   new        a new song at the learner's level when nothing is in progress
 *   lesson     the next lesson; a drill for the weakest skill
 *   cool-down  always last, 3 minutes of descending hums or straw glides
 *
 * A light day (after a heavy day, pain or a bad voice check) keeps to gentle
 * work; a rest day has no singing at all (lessons and theory only). A plan
 * longer than the session cap is split into two sittings an hour apart.
 *
 * The coach may propose a plan instead (plan.set); the server checks it
 * against the same rules. A started plan stays as it is, so a coach plan
 * proposed after that goes to the next day.
 */

const SONG_MODES = ['listen', 'echo', 'sing', 'solo'];
const GENTLE = ['warmup', 'cooldown', 'lesson'];

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}
function C() {
  return require(`${__hooks}/lib_curriculum.js`);
}

/** Sung minutes of a block list (lessons and quiz drills are not singing). */
function sungMinutes(blocks) {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === 'lesson') continue;
    if (b.kind === 'drill') {
      const d = (C().SKILLS[b.skill] || {}).drill;
      if (d === 'quiz') continue;
    }
    if (b.kind === 'song' && b.mode === 'listen') continue;
    n += b.minutes;
  }
  return n;
}

/** Scale the middle blocks so the plan meets the goal; warm-up and cool-down keep their length. */
function scale(blocks, goal) {
  const fixed = blocks.filter((b) => b.kind === 'warmup' || b.kind === 'cooldown').reduce((a, b) => a + b.minutes, 0);
  const flex = blocks.filter((b) => b.kind !== 'warmup' && b.kind !== 'cooldown');
  const total = flex.reduce((a, b) => a + b.minutes, 0);
  if (total === 0) return blocks;
  const k = Math.max(0.4, (goal - fixed) / total);
  for (const b of flex) b.minutes = Math.max(2, Math.min(20, Math.round(b.minutes * k)));
  return blocks;
}

/** Split into two sittings when the singing runs past the session cap. */
function sittings(blocks, cap) {
  if (sungMinutes(blocks) <= cap) {
    for (const b of blocks) b.sitting = 1;
    return blocks;
  }
  let run = 0;
  let second = false;
  const out = [];
  for (const b of blocks) {
    if (!second && b.kind !== 'warmup' && b.kind !== 'cooldown' && run + b.minutes > cap - 3) {
      // Close the first sitting with a cool-down; the second opens with a short warm-up.
      out.push({ kind: 'cooldown', ex: 'desc5', minutes: 3, why: 'end of the first sitting', sitting: 1 });
      out.push({ kind: 'warmup', ex: 'sovt.siren', minutes: 3, why: 'second sitting, an hour or more later', sitting: 2 });
      second = true;
    }
    b.sitting = second ? 2 : 1;
    run += b.kind === 'lesson' ? 0 : b.minutes;
    out.push(b);
  }
  return out;
}

/** The level's warm-up scale. */
function warmScale(level) {
  return level <= 1 ? 'desc5' : level <= 3 ? 'five.maj' : level <= 6 ? 'five.min' : 'arp.maj';
}

/** The rules' plan for a day (not stored until it starts). */
function rules(app, day) {
  const m = M();
  const u = U();
  const c = C();
  const st = m.settings(app);
  const goal = st.getInt('daily_minutes') || 20;
  const level = st.getInt('level') || 1;
  const cap = m.sessionCap(app);
  const health = require(`${__hooks}/lib_health.js`).state(app);
  const L = require(`${__hooks}/lib_learn.js`);
  const lessons = L.lessonRows(app);
  const skills = L.skillRows(app);
  const levels = L.evaluate(app, { lessons: lessons, skills: skills });
  const nx = L.next(app, levels, lessons, level);
  const blocks = [];
  let note = '';

  if (health.rest) {
    note = (health.flags.find((f) => f.key === 'rest' || f.key === 'pain_today') || { text: 'A rest day for the voice.' }).text + ' Today: lessons, theory and listening.';
    if (nx.lesson !== null) blocks.push({ kind: 'lesson', lesson: nx.lesson.key, minutes: Math.max(5, nx.lesson.minutes), why: 'next on your path' });
    const quiz = Object.keys(c.SKILLS).filter((k) => c.SKILLS[k].drill === 'quiz' && (!skills[k] || skills[k].getFloat('mastery') < 0.9))[0];
    if (quiz) blocks.push({ kind: 'drill', skill: quiz, minutes: 5, why: 'theory, no singing' });
    return { day: day, source: 'rules', status: 'proposed', note: note, blocks: blocks, done: [] };
  }

  blocks.push({ kind: 'warmup', ex: 'sovt.siren', minutes: 3, why: 'first, always: straw or lip-trill sirens' });
  blocks.push({ kind: 'warmup', ex: warmScale(level), minutes: 3, why: 'warm-up scale; 5-10 minutes is enough' });

  if (health.light) {
    note = (health.flags.find((f) => f.key === 'heavy_yesterday' || f.key === 'pain_yesterday' || f.key === 'checkin') || { text: 'A light day.' }).text;
    if (nx.lesson !== null) blocks.push({ kind: 'lesson', lesson: nx.lesson.key, minutes: Math.max(5, nx.lesson.minutes), why: 'next on your path' });
    const quiz = Object.keys(c.SKILLS).filter((k) => c.SKILLS[k].drill === 'quiz' && (!skills[k] || skills[k].getFloat('mastery') < 0.9))[0];
    if (quiz) blocks.push({ kind: 'drill', skill: quiz, minutes: 4, why: 'ear and theory, gently' });
    blocks.push({ kind: 'cooldown', ex: 'desc5', minutes: 3, why: 'descending hums to finish' });
    for (const b of blocks) b.sitting = 1;
    return { day: day, source: 'rules', status: 'proposed', note: note, blocks: blocks, done: [] };
  }

  const progs = require(`${__hooks}/lib_songs.js`).progressMap(app);
  const songs = app.findRecordsByFilter('songs', 'archived = false', 'level,title', 0, 0);
  const items = songs.map((r) => {
    const secs = m.sectionsOf(r);
    const prog = progs[r.id] || null;
    return { rec: r, secs: secs, states: m.statesOf(prog, secs.length), last: prog === null ? 0 : u.ms(prog.getString('last_at')), runs: prog === null ? 0 : prog.getInt('runs') };
  });
  const firstBar = (it) => (it.secs.length > 0 ? it.secs[0].from : 1);
  const lastBar = (it) => (it.secs.length > 0 ? it.secs[it.secs.length - 1].to : it.rec.getInt('bars'));

  // Reviews that are due: one cold Solo each.
  const due = [];
  for (const it of items) {
    it.states.forEach((s, i) => {
      if (s.stage === 'mastered' && s.due !== '' && s.due <= day) due.push({ it: it, i: i, due: s.due });
    });
  }
  due.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  for (const d of due.slice(0, 2)) {
    const sec = d.it.secs[d.i];
    blocks.push({ kind: 'song', song: d.it.rec.id, from: sec.from, to: sec.to, mode: 'solo', tempo: 100, minutes: 2, why: 'review: one Solo, cold' });
  }

  // Focus: songs in progress, most recent first; the vocalises count as songs here.
  const current = items
    .filter((it) => it.runs > 0 && it.states.some((s) => s.stage !== 'mastered'))
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
      const s = x.s;
      let mode = 'sing';
      let why = 'climb the tempo';
      if (s.stage === 'new' || (s.best || 0) === 0) {
        mode = 'echo';
        why = 'learn it phrase by phrase';
      } else if (s.stage === 'steady') {
        mode = 'solo';
        why = 'steady: a cold Solo masters it';
      } else if ((s.best || 0) >= 100) {
        mode = s.clean_day === day && (s.cleans || 0) >= 2 ? 'solo' : 'sing';
        why = mode === 'solo' ? 'one clean Solo makes it steady' : 'three clean at full tempo, one of them Solo';
      }
      blocks.push({ kind: 'song', song: it.rec.id, from: sec.from, to: sec.to, mode: mode, tempo: mode === 'sing' ? m.nextTempo(s) : 100, minutes: 5, why: why });
    }
    const solid = it.states.filter((s) => s.stage === 'steady' || s.stage === 'mastered').length;
    if (it.states.length > 1 && solid >= Math.ceil(it.states.length / 2)) {
      blocks.push({ kind: 'song', song: it.rec.id, from: firstBar(it), to: lastBar(it), mode: 'sing', tempo: 100, minutes: 3, why: 'the whole song once' });
    }
  }

  // Nothing in progress: start the next song at the learner's level.
  if (current.length === 0) {
    const fresh = items
      .filter((it) => it.rec.getString('kind') !== 'vocalise' && it.runs === 0 && (it.rec.getInt('level') || 1) <= level)
      .sort((a, b) => (b.rec.getInt('level') || 1) - (a.rec.getInt('level') || 1) || a.rec.getString('title').localeCompare(b.rec.getString('title')))[0];
    if (fresh !== undefined && fresh.secs.length > 0) {
      const sec = fresh.secs[0];
      blocks.push({ kind: 'song', song: fresh.rec.id, from: sec.from, to: sec.to, mode: 'echo', tempo: 100, minutes: 6, why: 'a new song: learn it phrase by phrase' });
    }
  }

  // Technique: the level's vocalise furthest from its requirement.
  const cur = levels[level - 1];
  const tech = cur ? cur.items.filter((it) => it.kind === 'tech' && !it.ok).sort((a, b) => a.have / a.need - b.have / b.need)[0] : undefined;
  if (tech !== undefined) blocks.push({ kind: 'exercise', ex: tech.key, minutes: 4, why: 'technique for level ' + level });

  // The curriculum: the next lesson, and a drill for the weakest skill of the level.
  if (nx.lesson !== null) blocks.push({ kind: 'lesson', lesson: nx.lesson.key, minutes: Math.max(4, nx.lesson.minutes), why: 'next on your path' });
  if (nx.skill !== null && nx.skill.kind !== 'tech') blocks.push({ kind: 'drill', skill: nx.skill.key, minutes: 4, why: 'the weakest skill of your level' });

  blocks.push({ kind: 'cooldown', ex: 'desc5', minutes: 3, why: 'descending hums to finish' });
  const out = sittings(scale(blocks, goal), cap);
  if (out.some((b) => b.sitting === 2)) note = 'Today is split into two sittings: the singing is longer than your session cap of ' + cap + ' minutes, and spreading it out is easier on the voice.';
  return { day: day, source: 'rules', status: 'proposed', note: note, blocks: out, done: [] };
}

function stored(app, day) {
  const rows = app.findRecordsByFilter('plans', 'day = {:d}', '', 1, 0, { d: day });
  return rows.length > 0 ? rows[0] : null;
}

function fromRecord(r) {
  const u = U();
  return { day: r.getString('day'), source: r.getString('source'), status: r.getString('status'), note: r.getString('note'), blocks: u.getJson(r, 'blocks') || [], done: u.getJson(r, 'done') || [], id: r.id };
}

/** A plan with each block's song, lesson, skill or vocalise resolved for display. */
function resolve(app, plan) {
  const u = U();
  const m = M();
  const c = C();
  const cache = {};
  const blocks = [];
  plan.blocks.forEach((b, i) => {
    const base = { i: i, kind: b.kind || 'song', minutes: b.minutes, why: b.why || '', sitting: b.sitting || 1, done: plan.done.indexOf(i) >= 0 };
    if (b.kind === 'lesson') {
      const l = c.lesson(b.lesson);
      if (l === null) return;
      blocks.push(Object.assign(base, { lesson: b.lesson, title: l.title }));
      return;
    }
    if (b.kind === 'drill') {
      const s = c.SKILLS[b.skill];
      if (s === undefined) return;
      blocks.push(Object.assign(base, { skill: b.skill, title: s.title, drill: s.drill }));
      return;
    }
    if (b.kind === 'warmup' || b.kind === 'cooldown' || b.kind === 'exercise') {
      const ex = c.EXERCISES[b.ex];
      if (ex === undefined) return;
      blocks.push(Object.assign(base, { ex: b.ex, title: b.kind === 'cooldown' && b.ex === 'desc5' ? 'Descending hums' : ex.title, skill: ex.skill, vowel: b.vowel || '' }));
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
    blocks.push(
      Object.assign(base, {
        kind: 'song',
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
      }),
    );
  });
  const st = m.settings(app);
  return {
    day: plan.day,
    source: plan.source,
    status: plan.status,
    note: plan.note,
    blocks: blocks,
    minutes: blocks.reduce((a, b) => a + b.minutes, 0),
    sung: sungMinutes(blocks),
    goal: st.getInt('daily_minutes') || 20,
    cap: m.sessionCap(app),
    done: blocks.filter((b) => b.done).length,
  };
}

function today(app, p) {
  const u = U();
  const m = M();
  m.ensureSeeded(app);
  const day = u.str(p, 'day', '') || m.dayKey();
  if (!m.isDay(day)) throw u.fail(400, 'day must look like 2026-11-03');
  const r = stored(app, day);
  return { plan: resolve(app, r !== null ? fromRecord(r) : rules(app, day)) };
}

/** The person starts today's plan: it is kept as it is for the day. */
function start(app, e) {
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
    r.set('note', plan.note);
    r.set('done', []);
  }
  if (r.getString('status') !== 'done') r.set('status', 'active');
  app.save(r);
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
  if (i >= blocks.length) throw u.fail(400, 'No block ' + i + " in today's plan.");
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

/**
 * The coach proposes a plan (today if today's has not started, otherwise
 * tomorrow). Checked against the health rules: near the goal and within the
 * cap per sitting, a warm-up of 5 minutes or more first and a cool-down of 3
 * or more last, blocks of 2-20 minutes, songs that fit the voice, gentle work
 * only on a light day, and no singing on a rest day.
 */
function set(app, e, p) {
  const u = U();
  const m = M();
  const c = C();
  const agent = u.fromAgent(e);
  if (agent && !m.settings(app).getBool('coach_plans')) throw u.fail(403, 'The person turned off coach plans in Settings; do not propose plans.', 'coach_plans_off');
  const today0 = m.dayKey();
  let day = u.str(p, 'day', '');
  if (day === '') {
    const t = stored(app, today0);
    day = t !== null && t.getString('status') !== 'proposed' ? m.addDays(today0, 1) : today0;
  }
  if (!m.isDay(day)) throw u.fail(400, 'day must look like 2026-11-03');
  if (day < today0) throw u.fail(400, 'day is in the past');
  const existing = stored(app, day);
  if (existing !== null && existing.getString('status') !== 'proposed') throw u.fail(409, 'The plan for ' + day + ' has already started; propose one for ' + m.addDays(day, 1) + ' instead.', 'started');
  const raw = u.list(p, 'blocks', '[{"kind":"warmup","ex":"sovt.siren","minutes":5},{"song":"{id}","from":1,"to":8,"mode":"sing","tempo":90,"minutes":6},{"kind":"cooldown","ex":"desc5","minutes":3}]');
  if (raw === undefined || raw.length === 0) throw u.fail(400, 'blocks is required: a JSON list (see learn.state plan_blocks).');
  if (raw.length > 14) throw u.fail(400, 'At most 14 blocks.');
  const st = m.settings(app);
  const goal = st.getInt('daily_minutes') || 20;
  const cap = m.sessionCap(app);
  const V = require(`${__hooks}/lib_voice.js`);
  const voice = V.current(app);
  const H = require(`${__hooks}/lib_health.js`).state(app);
  // Tomorrow: a rest day by the calendar, or light after a heavy today.
  const isToday = day === today0;
  const restDay = st.getInt('rest_day');
  const rest = isToday ? H.rest : restDay >= 0 && m.weekday(day) === restDay;
  const light = isToday ? H.light : H.load.today_min > Math.max(15, H.load.mean_day_min * 1.5);
  const problems = [];
  const blocks = [];
  raw.forEach((b, i) => {
    const where = 'Block ' + (i + 1) + ': ';
    if (b === null || typeof b !== 'object') return problems.push(where + 'must be an object');
    const kind = b.kind === undefined ? 'song' : String(b.kind);
    const minutes = Number(b.minutes);
    if (!isFinite(minutes) || minutes < 2 || minutes > 20) return problems.push(where + 'minutes must be 2-20.');
    const why = String(b.why || '').slice(0, 80);
    if (kind === 'lesson') {
      if (c.lesson(String(b.lesson || '')) === null) return problems.push(where + 'no lesson "' + b.lesson + '" (learn.state lists them).');
      blocks.push({ kind: 'lesson', lesson: String(b.lesson), minutes: Math.round(minutes), why: why });
      return;
    }
    if (kind === 'drill') {
      const sk = c.SKILLS[String(b.skill || '')];
      if (sk === undefined) return problems.push(where + 'no skill "' + b.skill + '" (learn.state lists them).');
      if (sk.drill === 'exercise') return problems.push(where + 'skill ' + b.skill + ' is trained by vocalises: use {"kind":"exercise","ex":"<vocalise>"} (lib EXERCISES in app.guide).');
      blocks.push({ kind: 'drill', skill: String(b.skill), minutes: Math.round(minutes), why: why });
      return;
    }
    if (kind === 'warmup' || kind === 'cooldown' || kind === 'exercise') {
      const ex = c.EXERCISES[String(b.ex || '')];
      if (ex === undefined) return problems.push(where + 'no vocalise "' + b.ex + '" (app.guide lists them).');
      if (kind === 'exercise' && ex.level > (st.getInt('level') || 1) + 1) return problems.push(where + b.ex + ' opens at level ' + ex.level + '; the singer is at level ' + (st.getInt('level') || 1) + '.');
      blocks.push({ kind: kind, ex: String(b.ex), minutes: Math.round(minutes), why: why });
      return;
    }
    if (kind !== 'song') return problems.push(where + 'kind must be song, warmup, cooldown, exercise, lesson or drill.');
    const rec = u.byId(app, 'songs', String(b.song || ''));
    if (rec === null || rec.getBool('archived')) return problems.push(where + 'no song "' + b.song + '" (songs.list shows ids).');
    const model = m.modelOf(rec);
    const first = model.bars[0].n;
    const last = model.bars[model.bars.length - 1].n;
    const from = b.from === undefined ? first : Number(b.from);
    const to = b.to === undefined ? last : Number(b.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < first || to > last || from > to) return problems.push(where + 'bars must be within ' + first + '-' + last + ' (got ' + b.from + '-' + b.to + ').');
    const mode = String(b.mode || 'sing');
    if (SONG_MODES.indexOf(mode) < 0) return problems.push(where + 'mode must be listen, echo, sing or solo');
    const tempo = b.tempo === undefined ? 100 : Number(b.tempo);
    if (!isFinite(tempo) || tempo < 50 || tempo > 120) return problems.push(where + "tempo is a percent of the song's tempo, 50-120.");
    const fit = V.bestShift(voice, rec.getInt('low'), rec.getInt('high'), rec.getInt('median'));
    if (fit.over + fit.under > 2) return problems.push(where + '"' + rec.getString('title') + '" needs ' + (fit.over + fit.under) + ' semitones beyond the comfortable range even in its best key; choose another song.');
    blocks.push({ kind: 'song', song: rec.id, from: from, to: to, mode: mode, tempo: Math.round(tempo), minutes: Math.round(minutes), why: why });
  });
  if (problems.length > 0) throw u.fail(400, problems.join(' | '));
  const sung = sungMinutes(blocks);
  if (rest && sung > 0) throw u.fail(400, day + ' is a rest day for the voice (no singing): propose lessons and quiz drills only.', 'rest_day');
  if (light && blocks.some((b) => GENTLE.indexOf(b.kind) < 0 && !(b.kind === 'drill' && (c.SKILLS[b.skill] || {}).drill === 'quiz') && !(b.kind === 'song' && b.mode === 'listen'))) throw u.fail(400, day + ' is a light day (' + (H.flags.map((f) => f.key).join(', ') || 'yesterday was heavy') + '): only warm-up, cool-down, lessons, quiz drills and listening.', 'light_day');
  if (sung > 0) {
    const firstB = blocks[0];
    const lastB = blocks[blocks.length - 1];
    if (firstB.kind !== 'warmup' || blocks.filter((b, i) => b.kind === 'warmup' && i < 3).reduce((a, b) => a + b.minutes, 0) < 5) throw u.fail(400, 'Start with warm-up blocks of 5 minutes or more in total (e.g. {"kind":"warmup","ex":"sovt.siren","minutes":3}, {"kind":"warmup","ex":"five.maj","minutes":3}).', 'warmup');
    if (lastB.kind !== 'cooldown' || lastB.minutes < 3) throw u.fail(400, 'End with a cool-down of 3 minutes or more ({"kind":"cooldown","ex":"desc5","minutes":3}).', 'cooldown');
  }
  const total = blocks.reduce((a, b) => a + b.minutes, 0);
  if (total > Math.ceil(goal * 1.25)) throw u.fail(400, 'The blocks add up to ' + total + ' minutes; the goal is ' + goal + ' a day (at most ' + Math.ceil(goal * 1.25) + ').', 'too_long');
  const planned = sittings(blocks, cap);
  const r = existing !== null ? existing : new Record(app.findCollectionByNameOrId('plans'));
  r.set('day', day);
  r.set('source', agent ? 'coach' : 'rules');
  r.set('status', 'proposed');
  r.set('blocks', planned);
  r.set('note', u.str(p, 'note', '').slice(0, 2000));
  r.set('done', []);
  app.save(r);
  return { plan: resolve(app, fromRecord(r)), split: planned.some((b) => b.sitting === 2) };
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

module.exports = { today: today, start: start, done: done, set: set, reset: reset, rules: rules, resolve: resolve, sungMinutes: sungMinutes };
