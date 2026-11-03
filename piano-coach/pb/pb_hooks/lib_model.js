/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared shapes and rules: settings, days, songs, sections and their
 * progress, and the first-run library.
 *
 * Section stages (the unit of progress, from the practice research: count
 * clean passes, judge learning by the next day's first attempt):
 *   new       never practised
 *   learning  practised; best clean tempo climbs toward the song's tempo
 *   steady    three clean passes at full tempo in one day
 *   mastered  clean at full tempo on the first attempt of a later day;
 *             then reviewed after 2, 4, 8 ... 64 days, and a failed review
 *             drops it back to steady
 */

const STAGES = ['new', 'learning', 'steady', 'mastered'];
const CLEAN = { lenient: 0.9, normal: 0.95, strict: 0.98 };

function U() {
  return require(`${__hooks}/lib_util.js`);
}

/* ------------------------------------------------------------------ days */

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

/** The local calendar day of a time (default now): "2026-11-01". */
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

function isDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

/* -------------------------------------------------------------- settings */

const DEFAULTS = {
  name: '',
  daily_minutes: 20,
  strictness: 'normal',
  input: '',
  midi_device: '',
  latency_ms: 0,
  other_hand: true,
  metronome: true,
  count_in: true,
  view: 'roll',
  note_names: true,
  volume: 80,
  click_volume: 60,
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
  return {
    name: rec.getString('name'),
    daily_minutes: rec.getInt('daily_minutes') || 20,
    strictness: rec.getString('strictness') || 'normal',
    input: rec.getString('input'),
    midi_device: rec.getString('midi_device'),
    latency_ms: rec.getFloat('latency_ms'),
    other_hand: rec.getBool('other_hand'),
    metronome: rec.getBool('metronome'),
    count_in: rec.getBool('count_in'),
    view: rec.getString('view') || 'roll',
    note_names: rec.getBool('note_names'),
    volume: rec.getInt('volume'),
    click_volume: rec.getInt('click_volume'),
    coach_reviews: rec.getBool('coach_reviews'),
    coach_plans: rec.getBool('coach_plans'),
    level: rec.getInt('level') || 1,
    onboarded: rec.getBool('onboarded'),
    last_song: rec.getString('last_song'),
    coach_seen: rec.getString('coach_seen'),
  };
}

function cleanThreshold(app) {
  return CLEAN[settings(app).getString('strictness')] || CLEAN.normal;
}

/* ----------------------------------------------------------------- songs */

function songOrNull(app, id) {
  const u = U();
  const rec = u.byId(app, 'songs', String(id || '').trim());
  return rec;
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
var MODEL_V = 2;

function modelOf(rec) {
  return U().getJson(rec, 'model');
}

/** The progress row of a song (created on first use). */
function progress(app, songId) {
  const rows = app.findRecordsByFilter('progress', 'song = {:s}', '', 1, 0, { s: songId });
  if (rows.length > 0) return rows[0];
  const rec = new Record(app.findCollectionByNameOrId('progress'));
  rec.set('song', songId);
  rec.set('sections', []);
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
  return { stage: 'new', best: 0, tries: 0, cleans: 0, clean_day: '', steady_day: '', last_day: '', play_day: '', acc: null, due: '', iv: 0 };
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
  if (best <= 0) return 60;
  if (best >= 100) return 100;
  if (best < 70) return Math.min(100, best + 10);
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
    level: rec.getInt('level') || 1,
    kind: rec.getString('kind') || 'piece',
    bars: rec.getInt('bars'),
    tempo: rec.getFloat('tempo'),
    seconds: rec.getInt('seconds'),
    key: rec.getString('key_name'),
    meter: rec.getString('meter'),
    hands: rec.getString('hands') || 'both',
    range: rec.getString('range'),
    notes: rec.getInt('notes_count'),
    source: rec.getString('source'),
    tags: u.getJson(rec, 'tags') || [],
    fav: rec.getBool('fav'),
    seen: rec.getBool('seen'),
    archived: rec.getBool('archived'),
    note: rec.getString('note'),
    note_at: rec.getString('note_at'),
    created: rec.getString('created'),
    status: songStatus(states, prog),
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
    })),
  };
  if (o.preview) out.preview = u.getJson(rec, 'preview');
  if (o.abc) out.abc = rec.getString('abc');
  if (o.model) out.model = modelOf(rec);
  if (o.request) out.request = rec.getString('request');
  return out;
}

/** A compact picture of the notes for library tiles: time and pitch, scaled. */
function preview(model) {
  const notes = model.notes || [];
  const total = model.total || 1;
  const step = Math.max(1, Math.ceil(notes.length / 360));
  const out = [];
  let lo = 127;
  let hi = 0;
  for (let i = 0; i < notes.length; i++) {
    lo = Math.min(lo, notes[i][2]);
    hi = Math.max(hi, notes[i][2]);
  }
  for (let i = 0; i < notes.length; i += step) {
    const n = notes[i];
    out.push([Math.round((n[0] / total) * 10000) / 10000, n[2], n[3], Math.round((Math.max(n[1], 0.25) / total) * 10000) / 10000]);
  }
  return { lo: lo, hi: hi, n: out };
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
  rec.set('hands', s.hands);
  rec.set('range', s.range);
  rec.set('notes_count', s.notes);
  rec.set('sections', sections);
}

/* -------------------------------------------------------------- seeding */

/** Notation without the markings a later version adds (pedal, chord symbols). */
function bare(abc) {
  return String(abc)
    .split('\n')
    .filter((l) => !/^%%pedal\b/i.test(l.trim()))
    .join('\n')
    .replace(/!ped(-up)?!/g, '')
    .replace(/"[A-G][^"]*"/g, '');
}

/** A starter song still exactly as shipped takes the shipped notation's new markings. */
function upgradeStarter(app, A, rec, it) {
  const have = rec.getString('abc');
  if (have === it.abc || bare(have) !== bare(it.abc)) return;
  const parsed = A.parse(it.abc);
  if (!parsed.ok) return;
  rec.set('abc', it.abc);
  rec.set('model', parsed.model);
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
  if (app.store().get('pc_seeded') === true) return;
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
      console.error('[piano-coach] starter song failed to parse:', it.key, JSON.stringify(parsed.errors));
      continue;
    }
    if (update && app.findRecordsByFilter('songs', 'title = {:t}', '', 1, 0, { t: parsed.summary.title }).length > 0) continue;
    const secs = A.parseSections(it.sections, parsed.model);
    const rec = new Record(col);
    rec.set('title', parsed.summary.title);
    rec.set('composer', parsed.summary.composer);
    rec.set('level', it.level);
    rec.set('kind', it.kind);
    rec.set('abc', it.abc);
    rec.set('tags', it.tags || []);
    rec.set('source', 'starter');
    rec.set('starter_key', it.key);
    rec.set('seen', !update);
    applyParsed(rec, parsed, secs.sections || A.defaultSections(parsed.model));
    app.save(rec);
  }
  if (!update) {
    s.set('seeded', true);
    app.save(s);
  }
  app.store().set('pc_seeded', true);
}

module.exports = {
  STAGES: STAGES,
  CLEAN: CLEAN,
  dayKey: dayKey,
  addDays: addDays,
  daysBetween: daysBetween,
  isDay: isDay,
  settings: settings,
  settingsJson: settingsJson,
  cleanThreshold: cleanThreshold,
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
