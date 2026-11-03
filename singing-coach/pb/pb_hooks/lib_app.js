/// <reference path="../pb_data/types.d.ts" />
/**
 * The shell: one call that feeds the whole app (app.state), settings, and
 * what the person is looking at right now (app.ui from the page,
 * app.context for the agent).
 */

const AGENT_ACTIVE_MS = 90000;

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function state(app) {
  const m = M();
  m.ensureSeeded(app);
  const st = m.settings(app);
  const stats = require(`${__hooks}/lib_stats.js`);
  const today = m.dayKey();
  const d = stats.daily(app, today);
  const open = app.findRecordsByFilter('sessions', "status = 'open'", '-last_at', 1, 0);
  const waiting = app.findRecordsByFilter('messages', "role = 'you' && status = 'pending'", 'created', 0, 0);
  const pending = waiting.length;
  const fresh = app.findRecordsByFilter('songs', "archived = false && seen = false && source = 'agent'", '', 0, 0).length;
  const V = require(`${__hooks}/lib_voice.js`);
  const H = require(`${__hooks}/lib_health.js`).state(app);
  const t = d[today];
  return {
    settings: m.settingsJson(st),
    voice: V.current(app),
    health: { light: H.light, rest: H.rest, flags: H.flags, load: H.load, checkin: H.checkin },
    unread: require(`${__hooks}/lib_coach.js`).unread(app),
    pending: pending,
    pending_messages: waiting.slice(0, 10).map((r) => ({ id: r.id, kind: r.getString('kind'), text: r.getString('text').slice(0, 120) })),
    new_songs: fresh,
    agent_active: Date.now() - Number(app.store().get('sc_agent_seen') || 0) < AGENT_ACTIVE_MS,
    today: { day: today, minutes: t === undefined ? 0 : Math.round((t.ms / 60000) * 10) / 10, voiced: t === undefined ? 0 : Math.round((t.voiced / 60000) * 10) / 10, goal: st.getInt('daily_minutes') || 20, cap: m.sessionCap(app) },
    session: open.length > 0 ? { id: open[0].id, minutes: Math.round(open[0].getFloat('minutes') * 10) / 10, voiced_min: Math.round((open[0].getFloat('voiced_s') / 60) * 10) / 10, runs: open[0].getInt('runs'), warmup_min: Math.round((open[0].getFloat('warmup_s') / 60) * 10) / 10 } : null,
  };
}

function settingsGet(app) {
  const m = M();
  return { settings: m.settingsJson(m.settings(app)) };
}

function settingsUpdate(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'change settings');
  const st = m.settings(app);
  const changed = [];
  const set = (k, v) => {
    st.set(k, v);
    changed.push(k);
  };
  if (u.has(p, 'name')) set('name', u.squash(u.str(p, 'name', '')).slice(0, 80));
  if (u.has(p, 'daily_minutes')) set('daily_minutes', u.int(p, 'daily_minutes', 20, 5, 180));
  if (u.has(p, 'session_cap')) set('session_cap', u.int(p, 'session_cap', 0, 0, 120));
  if (u.has(p, 'strictness')) set('strictness', u.oneOf(p, 'strictness', ['lenient', 'normal', 'strict'], 'normal'));
  if (u.has(p, 'feedback')) set('feedback', u.oneOf(p, 'feedback', ['auto', 'full', 'after'], 'auto'));
  if (u.has(p, 'syllables')) set('syllables', u.oneOf(p, 'syllables', ['movable', 'fixed', 'numbers', 'letters', 'neutral'], 'movable'));
  if (u.has(p, 'minor_do')) set('minor_do', u.oneOf(p, 'minor_do', ['la', 'do'], 'la'));
  if (u.has(p, 'clef')) set('clef', u.oneOf(p, 'clef', ['auto', 'treble', 'treble8', 'bass'], 'auto'));
  if (u.has(p, 'guide')) set('guide', u.oneOf(p, 'guide', ['voice', 'piano', 'start', 'off'], 'voice'));
  if (u.has(p, 'vowel')) set('vowel', u.oneOf(p, 'vowel', ['oo', 'ah'], 'oo'));
  if (u.has(p, 'view')) set('view', u.oneOf(p, 'view', ['lane', 'sheet'], 'lane'));
  if (u.has(p, 'output')) set('output', u.oneOf(p, 'output', ['wired', 'bluetooth', 'speakers'], 'wired'));
  if (u.has(p, 'latency_ms')) set('latency_ms', u.number(p, 'latency_ms', { min: -200, max: 600 }) || 0);
  if (u.has(p, 'noise_db')) set('noise_db', u.number(p, 'noise_db', { min: -120, max: 0 }) || -70);
  if (u.has(p, 'input_device')) set('input_device', u.str(p, 'input_device', '').slice(0, 200));
  for (const k of ['volume', 'guide_volume', 'accomp_volume', 'click_volume']) if (u.has(p, k)) set(k, u.int(p, k, 70, 0, 100));
  if (u.has(p, 'rest_day')) set('rest_day', u.int(p, 'rest_day', -1, -1, 6));
  if (u.has(p, 'level')) set('level', u.int(p, 'level', 1, 1, 10));
  for (const k of ['drone', 'metronome', 'count_in', 'under18', 'checkins', 'keep_recordings', 'coach_reviews', 'coach_plans', 'onboarded']) {
    if (u.has(p, k)) set(k, u.bool(p, k, false));
  }
  if (changed.length > 0) app.save(st);
  return { settings: m.settingsJson(st), changed: changed };
}

/** The page tells where the person is (practice screen, song, bars, mode, key; the lesson or drill open). */
function ui(app, e, p) {
  const u = U();
  u.personOnly(e, 'report the screen');
  const view = u.oneOf(p, 'view', ['today', 'learn', 'train', 'library', 'reference', 'practice', 'exercise', 'edit', 'coach', 'settings'], 'today');
  const info = { view: view, at: Date.now() };
  for (const k of ['song', 'mode', 'lesson', 'skill']) if (u.has(p, k)) info[k] = u.str(p, k, '').slice(0, 40);
  if (u.has(p, 'title')) info.title = u.str(p, 'title', '').slice(0, 80);
  for (const k of ['from', 'to', 'tempo', 'key']) if (u.has(p, k)) info[k] = u.number(p, k, {});
  app.store().set('sc_ui', info);
  return { ok: true };
}

function context(app) {
  const u = U();
  const m = M();
  const info = app.store().get('sc_ui');
  const V = require(`${__hooks}/lib_voice.js`);
  const voice = V.describe(V.current(app));
  if (info === null || info === undefined) return { view: null, voice: voice, note: 'The app has not been opened since it started.' };
  const out = { view: info.view, seconds_ago: Math.round((Date.now() - info.at) / 1000), voice: voice };
  if (info.mode) out.mode = info.mode;
  if (info.from !== undefined && info.from !== null) out.bars = info.from + '-' + info.to;
  if (info.tempo) out.tempo_pct = info.tempo;
  if (info.key) out.key_shift = info.key;
  if (info.title) out.exercise = info.title;
  if (info.lesson) {
    const l = require(`${__hooks}/lib_curriculum.js`).lesson(info.lesson);
    if (l !== null) out.lesson = { key: l.key, title: l.title, level: l.level };
  }
  if (info.skill) {
    const sk = require(`${__hooks}/lib_curriculum.js`).SKILLS[info.skill];
    if (sk !== undefined) out.skill = { key: info.skill, title: sk.title };
  }
  if (info.song) {
    const rec = u.byId(app, 'songs', info.song);
    if (rec !== null) {
      const j = m.songJson(app, rec, {});
      out.song = { id: j.id, title: j.title, level: j.level, key: j.key, key_shift: j.key_shift, range: V.noteName(j.low) + '-' + V.noteName(j.high), sections: j.sections.map((x) => x.name + ' ' + x.from + '-' + x.to + ' ' + x.stage).join('; '), note: j.note };
    }
  }
  return out;
}

module.exports = { state: state, settingsGet: settingsGet, settingsUpdate: settingsUpdate, ui: ui, context: context };
