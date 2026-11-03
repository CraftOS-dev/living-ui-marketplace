/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared shapes and rules: settings, days, songs, sections and their
 * progress, and the first-run library.
 *
 * Section stages (the unit of progress; from the practice research: count
 * clean takes, judge learning by the next day's first attempt without help):
 *   new       never sung
 *   learning  sung; the best clean tempo climbs toward the song's tempo
 *   steady    three clean takes at full tempo in one day, one of them Solo
 *             (no guide melody)
 *   mastered  a clean Solo at full tempo on the first try of a later day
 *             (the cold check); then reviewed after 2, 4, 8 … 64 days, and a
 *             failed review drops it back to steady
 *
 * A clean take (Sing or Solo, the whole section): at the person's
 * strictness, enough notes on pitch or close, enough exactly on pitch and
 * enough onsets in time (CLEAN below). Stages are kept per key: singing a
 * song in another key starts its sections at learning again (their best
 * tempo stays), and going back to a key restores what it had.
 */

const STAGES = ['new', 'learning', 'steady', 'mastered'];

/** Clean take thresholds: notes on or close, notes on, onsets in their window. */
const CLEAN = {
  lenient: { pitch: 0.85, on: 0.5, onset: 0.7 },
  normal: { pitch: 0.9, on: 0.65, onset: 0.75 },
  strict: { pitch: 0.95, on: 0.8, onset: 0.85 },
};

/** Pitch bands in cents (on, close) and onset windows in ms per strictness. */
const BANDS = {
  lenient: { on: 35, close: 75, onset: 150 },
  normal: { on: 25, close: 50, onset: 100 },
  strict: { on: 15, close: 35, onset: 50 },
};

function U() {
  return require(`${__hooks}/lib_util.js`);
}

/* ------------------------------------------------------------------ days */

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

/** The local calendar day of a time (default now): "2026-11-03". */
function dayKey(ms) {
  const d = new Date(ms === undefined ? Date.now() : ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** A day n days after (or before) another. */
function addDays(day, n) {
  const p = String(day).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n, 12, 0, 0);
  return dayKey(d.getTime());
}

/** Whole days from a to b (b later = positive). */
function daysBetween(a, b) {
  const pa = String(a).split('-');
  const pb = String(b).split('-');
  const ta = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  const tb = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((tb - ta) / 86400000);
}

/** Day of the week of a day key, 0 = Sunday. */
function weekday(day) {
  const p = String(day).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0).getDay();
}

function isDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

/* -------------------------------------------------------------- settings */

const DEFAULTS = {
  name: '',
  daily_minutes: 20,
  session_cap: 0,
  strictness: 'normal',
  feedback: 'auto',
  syllables: 'movable',
  minor_do: 'la',
  clef: 'auto',
  guide: 'voice',
  vowel: 'oo',
  volume: 80,
  guide_volume: 70,
  accomp_volume: 55,
  click_volume: 50,
  drone: false,
  metronome: false,
  count_in: true,
  view: 'lane',
  output: 'wired',
  latency_ms: 0,
  noise_db: -70,
  input_device: '',
  under18: false,
  checkins: true,
  keep_recordings: false,
  rest_day: -1,
  coach_reviews: true,
  coach_plans: true,
  level: 1,
  onboarded: false,
  seeded: false,
  last_song: '',
};

/** The one settings row (created on first use). */
function settings(app) {
  const rows = app.findRecordsByFilter('settings', '', 'created', 1, 0);
  if (rows.length > 0) return rows[0];
  const rec = new Record(app.findCollectionByNameOrId('settings'));
  for (const k of Object.keys(DEFAULTS)) rec.set(k, DEFAULTS[k]);
  app.save(rec);
  return rec;
}

function settingsJson(rec) {
  const g = (k) => rec.getString(k) || DEFAULTS[k];
  return {
    name: rec.getString('name'),
    daily_minutes: rec.getInt('daily_minutes') || 20,
    session_cap: rec.getInt('session_cap'),
    strictness: g('strictness'),
    feedback: g('feedback'),
    syllables: g('syllables'),
    minor_do: g('minor_do'),
    clef: g('clef'),
    guide: g('guide'),
    vowel: g('vowel'),
    volume: rec.getInt('volume'),
    guide_volume: rec.getInt('guide_volume'),
    accomp_volume: rec.getInt('accomp_volume'),
    click_volume: rec.getInt('click_volume'),
    drone: rec.getBool('drone'),
    metronome: rec.getBool('metronome'),
    count_in: rec.getBool('count_in'),
    view: g('view'),
    output: g('output'),
    latency_ms: rec.getFloat('latency_ms'),
    noise_db: rec.getFloat('noise_db') || -70,
    input_device: rec.getString('input_device'),
    under18: rec.getBool('under18'),
    checkins: rec.getBool('checkins'),
    keep_recordings: rec.getBool('keep_recordings'),
    rest_day: rec.getInt('rest_day'),
    coach_reviews: rec.getBool('coach_reviews'),
    coach_plans: rec.getBool('coach_plans'),
    level: rec.getInt('level') || 1,
    onboarded: rec.getBool('onboarded'),
    last_song: rec.getString('last_song'),
    coach_seen: rec.getString('coach_seen'),
  };
}

function strictnessOf(app) {
  const s = settings(app).getString('strictness');
  return CLEAN[s] ? s : 'normal';
}

/** The level's session cap in minutes (the person's own cap wins when set). */
function levelCap(level, under18) {
  if (under18 || level <= 3) return 20;
  if (level <= 6) return 30;
  return 60;
}

function sessionCap(app) {
  const s = settings(app);
  // A shorter cap of the person's own; never longer than the level's.
  const own = s.getInt('session_cap');
  const cap = levelCap(s.getInt('level') || 1, s.getBool('under18'));
  return own > 0 ? Math.min(own, cap) : cap;
}

/* ----------------------------------------------------------------- songs */

function songOrNull(app, id) {
  return U().byId(app, 'songs', String(id || '').trim());
}

function song(app, id) {
  const rec = songOrNull(app, id);
  if (rec === null) throw U().fail(404, 'No song ' + JSON.stringify(String(id || '')) + '. songs.list shows every song with its id.', 'not_found');
  return rec;
}

function sectionsOf(rec) {
  const s = U().getJson(rec, 'sections');
  return Array.isArray(s) ? s : [];
}

/** The parser's model version (lib_abc.js model.v); older stored models are parsed again on open. */
var MODEL_V = 3;

function modelOf(rec) {
  return U().getJson(rec, 'model');
}

/** The progress row of a song (created on first use). */
function progress(app, songId) {
  const rows = app.findRecordsByFilter('progress', 'song = {:s}', '', 1, 0, { s: songId });
  if (rows.length > 0) return rows[0];
  const rec = new Record(app.findCollectionByNameOrId('progress'));
  rec.set('song', songId);
  rec.set('key_shift', 0);
  rec.set('sections', []);
  rec.set('by_key', {});
  rec.set('minutes', 0);
  rec.set('runs', 0);
  app.save(rec);
  return rec;
}

function progressOrNull(app, songId) {
  const rows = app.findRecordsByFilter('progress', 'song = {:s}', '', 1, 0, { s: songId });
  return rows.length > 0 ? rows[0] : null;
}

function blankState() {
  return { stage: 'new', best: 0, tries: 0, cleans: 0, solo_cleans: 0, clean_day: '', steady_day: '', last_day: '', solo_day: '', acc: null, due: '', iv: 0, weak: [] };
}

/** One state per section, in section order (a missing state is new). */
function statesOf(progRec, count) {
  const raw = progRec === null ? [] : U().getJson(progRec, 'sections') || [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = raw[i];
    out.push(s && typeof s === 'object' ? Object.assign(blankState(), s) : blankState());
  }
  return out;
}

const WEIGHT = { new: 0, steady: 0.8, mastered: 1 };

/** How far along a song is, 0..1, from its sections. */
function percent(states) {
  if (states.length === 0) return 0;
  let sum = 0;
  for (const s of states) {
    if (s.stage === 'learning') sum += 0.12 + 0.48 * Math.min(1, (s.best || 0) / 100);
    else sum += WEIGHT[s.stage] || 0;
  }
  return Math.round((sum / states.length) * 1000) / 1000;
}

/** The next rung of the tempo ladder for a section (percent of the song's tempo). */
function nextTempo(state) {
  const best = state.best || 0;
  if (best <= 0) return 80;
  if (best >= 100) return 100;
  if (best < 85) return Math.min(100, best + 10);
  return Math.min(100, best + 5);
}

function songStatus(states, prog) {
  if (states.length === 0 || prog === null || (prog.getInt('runs') || 0) === 0) return 'new';
  if (states.every((s) => s.stage === 'mastered')) return 'mastered';
  return 'learning';
}

/** A song as lists show it: lean, with its sections' progress. */
function songJson(app, rec, opts) {
  const o = opts || {};
  const u = U();
  const secs = sectionsOf(rec);
  const prog = o.progress !== undefined ? o.progress : progressOrNull(app, rec.id);
  const states = statesOf(prog, secs.length);
  const today = dayKey();
  const out = {
    id: rec.id,
    title: rec.getString('title'),
    composer: rec.getString('composer'),
    kind: rec.getString('kind') || 'song',
    level: rec.getInt('level') || 1,
    bars: rec.getInt('bars'),
    tempo: rec.getFloat('tempo'),
    seconds: rec.getInt('seconds'),
    key: rec.getString('key_name'),
    meter: rec.getString('meter'),
    low: rec.getInt('low'),
    high: rec.getInt('high'),
    span: rec.getInt('span'),
    median: rec.getInt('median'),
    tessitura: rec.getString('tessitura'),
    phrases: rec.getInt('phrases'),
    longest_phrase_s: rec.getFloat('longest_phrase_s'),
    syllables: rec.getInt('syllables'),
    verses: rec.getInt('verses'),
    first_words: rec.getString('first_words'),
    language: rec.getString('language'),
    licence: rec.getString('licence'),
    source_note: rec.getString('source_note'),
    voicing: rec.getString('voicing') || 'any',
    accompanied: rec.getBool('accompanied'),
    // A recording to sing with (songs made from a recording), with its voice and music when separated; the map only when asked for.
    backing:
      rec.getString('backing') !== ''
        ? {
            url: u.fileUrl(rec, 'backing'),
            map: o.backingMap === true ? u.getJson(rec, 'backing_map') : null,
            voice: rec.getString('backing_voice') !== '' ? u.fileUrl(rec, 'backing_voice') : null,
            music: rec.getString('backing_music') !== '' ? u.fileUrl(rec, 'backing_music') : null,
          }
        : null,
    source: rec.getString('source'),
    tags: u.getJson(rec, 'tags') || [],
    fav: rec.getBool('fav'),
    seen: rec.getBool('seen'),
    archived: rec.getBool('archived'),
    note: rec.getString('note'),
    note_at: rec.getString('note_at'),
    created: rec.getString('created'),
    status: songStatus(states, prog),
    key_shift: prog === null ? 0 : prog.getInt('key_shift'),
    progress: {
      pct: percent(states),
      last_at: prog === null ? '' : prog.getString('last_at'),
      runs: prog === null ? 0 : prog.getInt('runs'),
      minutes: prog === null ? 0 : Math.round(prog.getFloat('minutes') * 10) / 10,
      counts: {
        new: states.filter((s) => s.stage === 'new').length,
        learning: states.filter((s) => s.stage === 'learning').length,
        steady: states.filter((s) => s.stage === 'steady').length,
        mastered: states.filter((s) => s.stage === 'mastered').length,
      },
      due: states.filter((s) => s.stage === 'mastered' && s.due !== '' && s.due <= today).length,
      solo: states.some((s) => (s.solo_cleans || 0) > 0),
      memory: states.length > 0 && states.every((s) => s.memory === true),
    },
    sections: secs.map((s, i) => ({
      i: i,
      name: s.name,
      from: s.from,
      to: s.to,
      stage: states[i].stage,
      best: states[i].best || 0,
      next: nextTempo(states[i]),
      acc: states[i].acc,
      due: states[i].due,
      last: states[i].last_day,
      tries: states[i].tries || 0,
      weak: states[i].weak || [],
    })),
  };
  if (o.preview) out.preview = u.getJson(rec, 'preview');
  if (o.abc) out.abc = rec.getString('abc');
  if (o.model) out.model = modelOf(rec);
  if (o.gloss) out.gloss = rec.getString('gloss');
  if (o.request) out.request = rec.getString('request');
  return out;
}

/** A compact picture of the melody for library tiles: [start, length, midi], times 0..1. */
function preview(model) {
  const mel = model.melody || [];
  const total = model.total || 1;
  const step = Math.max(1, Math.ceil(mel.length / 240));
  const out = [];
  for (let i = 0; i < mel.length; i += step) {
    const n = mel[i];
    out.push([Math.round((n[0] / total) * 10000) / 10000, Math.round((Math.max(n[1], 0.25) / total) * 10000) / 10000, n[2]]);
  }
  const r = model.mrange || { lo: 60, hi: 72 };
  return { lo: r.lo, hi: r.hi, n: out };
}

/** Store a parsed song's model and its derived fields on a record. */
function applyParsed(rec, parsed, sections) {
  const m = parsed.model;
  const s = parsed.summary;
  rec.set('model', m);
  rec.set('preview', preview(m));
  rec.set('tempo', m.tempo);
  rec.set('bars', s.bars);
  rec.set('seconds', s.seconds);
  rec.set('key_name', s.key);
  rec.set('meter', s.meter);
  rec.set('low', s.low);
  rec.set('high', s.high);
  rec.set('span', s.span);
  rec.set('median', s.median);
  rec.set('tessitura', s.tessitura);
  rec.set('phrases', s.phrases);
  rec.set('longest_phrase_s', s.longest_phrase_s);
  rec.set('syllables', s.syllables);
  rec.set('verses', s.verses);
  rec.set('first_words', String(s.first_words || '').slice(0, 200));
  rec.set('accompanied', !!s.accompaniment);
  rec.set('language', s.language || '');
  if (s.licence) rec.set('licence', s.licence);
  if (s.source) rec.set('source_note', String(s.source).slice(0, 400));
  rec.set('voicing', s.voicing || 'any');
  rec.set('sections', sections);
}

/* -------------------------------------------------------------- seeding */

/**
 * A starter song nobody edited (editing its notation makes it the person's
 * own, source "you") takes the notation shipped by a newer version. Its
 * sections stay when the bars did not change, so progress is kept.
 */
function upgradeStarter(app, A, rec, it) {
  if (rec.getString('abc') === it.abc || rec.getString('source') !== 'starter') return;
  const parsed = A.parse(it.abc);
  if (!parsed.ok) return;
  const old = sectionsOf(rec);
  const sameBars = old.length > 0 && rec.getInt('bars') === parsed.summary.bars;
  rec.set('abc', it.abc);
  applyParsed(rec, parsed, sameBars ? old : A.parseSections(it.sections, parsed.model).sections || A.defaultSections(parsed.model));
  rec.set('gloss', it.gloss || '');
  app.save(rec);
}

/**
 * Once per start: the settings row and the starter library. A fresh install
 * gets every starter song; an update adds the starter songs that are new
 * since (marked unseen, so the library shows them as new). A starter song the
 * person removed stays archived and is never added again; one whose title the
 * library already has is skipped.
 */
function ensureSeeded(app) {
  if (app.store().get('sc_seeded') === true) return;
  const s = settings(app);
  const update = s.getBool('seeded');
  const A = require(`${__hooks}/lib_abc.js`);
  const starter = require(`${__hooks}/lib_starter.js`).STARTER;
  const col = app.findCollectionByNameOrId('songs');
  for (const it of starter) {
    const exists = app.findRecordsByFilter('songs', 'starter_key = {:k}', '', 1, 0, { k: it.key });
    if (exists.length > 0) {
      upgradeStarter(app, A, exists[0], it);
      continue;
    }
    const parsed = A.parse(it.abc);
    if (!parsed.ok) {
      console.error('[singing-coach] starter song failed to parse:', it.key, JSON.stringify(parsed.errors));
      continue;
    }
    if (update && app.findRecordsByFilter('songs', 'title = {:t}', '', 1, 0, { t: parsed.summary.title }).length > 0) continue;
    const secs = A.parseSections(it.sections, parsed.model);
    const rec = new Record(col);
    rec.set('title', parsed.summary.title);
    rec.set('composer', parsed.summary.composer);
    rec.set('level', it.level);
    rec.set('kind', it.kind === 'vocalise' ? 'vocalise' : 'song');
    rec.set('abc', it.abc);
    rec.set('tags', it.tags || []);
    rec.set('gloss', it.gloss || '');
    rec.set('source', 'starter');
    rec.set('starter_key', it.key);
    rec.set('seen', !update);
    applyParsed(rec, parsed, secs.sections || A.defaultSections(parsed.model));
    if (!rec.getString('licence')) rec.set('licence', it.kind === 'vocalise' ? 'own' : 'trad');
    app.save(rec);
  }
  if (!update) {
    s.set('seeded', true);
    app.save(s);
  }
  app.store().set('sc_seeded', true);
}

module.exports = {
  STAGES: STAGES,
  CLEAN: CLEAN,
  BANDS: BANDS,
  DEFAULTS: DEFAULTS,
  dayKey: dayKey,
  addDays: addDays,
  daysBetween: daysBetween,
  weekday: weekday,
  isDay: isDay,
  settings: settings,
  settingsJson: settingsJson,
  strictnessOf: strictnessOf,
  levelCap: levelCap,
  sessionCap: sessionCap,
  song: song,
  songOrNull: songOrNull,
  sectionsOf: sectionsOf,
  modelOf: modelOf,
  MODEL_V: MODEL_V,
  progress: progress,
  progressOrNull: progressOrNull,
  statesOf: statesOf,
  blankState: blankState,
  percent: percent,
  nextTempo: nextTempo,
  songJson: songJson,
  preview: preview,
  applyParsed: applyParsed,
  ensureSeeded: ensureSeeded,
};
