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
  const pending = app.findRecordsByFilter('messages', "role = 'you' && status = 'pending'", '', 0, 0).length;
  const fresh = app.findRecordsByFilter('songs', "archived = false && seen = false && source = 'agent'", '', 0, 0).length;
  return {
    settings: m.settingsJson(st),
    unread: require(`${__hooks}/lib_coach.js`).unread(app),
    pending: pending,
    new_songs: fresh,
    agent_active: Date.now() - Number(app.store().get('pc_agent_seen') || 0) < AGENT_ACTIVE_MS,
    today: { day: today, minutes: d[today] === undefined ? 0 : Math.round((d[today].ms / 60000) * 10) / 10, goal: st.getInt('daily_minutes') || 20 },
    session: open.length > 0 ? { id: open[0].id, minutes: Math.round(open[0].getFloat('minutes') * 10) / 10, runs: open[0].getInt('runs') } : null,
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
  if (u.has(p, 'daily_minutes')) set('daily_minutes', u.int(p, 'daily_minutes', 20, 5, 240));
  if (u.has(p, 'strictness')) set('strictness', u.oneOf(p, 'strictness', ['lenient', 'normal', 'strict'], 'normal'));
  if (u.has(p, 'input')) set('input', u.oneOf(p, 'input', ['midi', 'keyboard', 'screen', 'mic'], 'screen'));
  if (u.has(p, 'midi_device')) set('midi_device', u.str(p, 'midi_device', '').slice(0, 200));
  if (u.has(p, 'latency_ms')) set('latency_ms', u.number(p, 'latency_ms', { min: -300, max: 500 }) || 0);
  if (u.has(p, 'view')) set('view', u.oneOf(p, 'view', ['roll', 'sheet'], 'roll'));
  if (u.has(p, 'volume')) set('volume', u.int(p, 'volume', 80, 0, 100));
  if (u.has(p, 'click_volume')) set('click_volume', u.int(p, 'click_volume', 60, 0, 100));
  if (u.has(p, 'level')) set('level', u.int(p, 'level', 1, 1, 10));
  for (const k of ['other_hand', 'metronome', 'count_in', 'note_names', 'coach_reviews', 'coach_plans', 'onboarded']) {
    if (u.has(p, k)) set(k, u.bool(p, k, false));
  }
  if (changed.length > 0) app.save(st);
  return { settings: m.settingsJson(st), changed: changed };
}

/** The page tells where the person is (practice screen, song, bars, mode; the lesson or drill open). */
function ui(app, e, p) {
  const u = U();
  u.personOnly(e, 'report the screen');
  const view = u.oneOf(p, 'view', ['today', 'learn', 'train', 'library', 'reference', 'practice', 'exercise', 'coach', 'settings'], 'today');
  const info = { view: view, at: Date.now() };
  for (const k of ['song', 'mode', 'hands', 'lesson', 'skill']) if (u.has(p, k)) info[k] = u.str(p, k, '').slice(0, 40);
  if (u.has(p, 'title')) info.title = u.str(p, 'title', '').slice(0, 80);
  for (const k of ['from', 'to', 'tempo']) if (u.has(p, k)) info[k] = u.number(p, k, {});
  app.store().set('pc_ui', info);
  return { ok: true };
}

function context(app) {
  const u = U();
  const m = M();
  const info = app.store().get('pc_ui');
  if (info === null || info === undefined) return { view: null, note: 'The app has not been opened since it started.' };
  const out = { view: info.view, seconds_ago: Math.round((Date.now() - info.at) / 1000) };
  if (info.mode) out.mode = info.mode;
  if (info.hands) out.hands = info.hands;
  if (info.from !== undefined && info.from !== null) out.bars = info.from + '-' + info.to;
  if (info.tempo) out.tempo_pct = info.tempo;
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
    if (rec !== null) out.song = m.songJson(app, rec, {});
  }
  return out;
}

module.exports = { state: state, settingsGet: settingsGet, settingsUpdate: settingsUpdate, ui: ui, context: context };
