/// <reference path="../pb_data/types.d.ts" />
/**
 * The library: songs and vocalises written in ABC notation with their words.
 *
 *   songs.check      parse notation without saving: every problem by line,
 *                    voice and bar, the singing checks for a level, and the
 *                    key that fits this singer best
 *   songs.add        add a song (the coach does this when asked for one)
 *   songs.update     change details, sections, the coach's note or the notation
 *   songs.list / get lean reads; the practice screen asks for the model
 *   songs.open / transpose / remove / restore / reset   the person's own actions
 *
 * Singing checks (report: "Library and the song format"):
 *   span     the melody's span fits the level (L1 9 semitones, L2 10, L3 12,
 *            L4-5 14, L6-7 16, L8+ 19): refused for the coach's songs,
 *            a warning for the person's own
 *   fit      the song can be moved into the singer's comfortable range
 *   breath   no phrase longer than the level's sustain target without a rest
 *            or a !breath! mark (a warning)
 *   source   songs the coach adds carry C:, %%licence pd or trad, and %%source
 */

const SPAN_CAP = [0, 9, 10, 12, 14, 14, 16, 16, 19, 19, 19];
const SUSTAIN = [0, 10, 12, 15, 15, 18, 18, 20, 20, 22, 24];

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}
function A() {
  return require(`${__hooks}/lib_abc.js`);
}
function V() {
  return require(`${__hooks}/lib_voice.js`);
}

/** All progress rows, by song id: one query for a whole list. */
function progressMap(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('progress', '', '', 0, 0)) out[r.getString('song')] = r;
  return out;
}

/** Where a song sits for this voice: the key to sing it in and whether it fits. */
function fitFor(voice, j) {
  if (!(j.high > 0)) return null;
  const b = V().bestShift(voice, j.low, j.high, j.median || Math.round((j.low + j.high) / 2));
  return { best_shift: b.shift, fits: b.fits, over: b.over, under: b.under };
}

function list(app, p, e) {
  const u = U();
  const m = M();
  m.ensureSeeded(app);
  const agent = u.fromAgent(e);
  const archived = u.bool(p, 'archived', false);
  const level = u.int(p, 'level', 0, 0, 10);
  const kind = u.oneOf(p, 'kind', ['song', 'vocalise'], '');
  const status = u.oneOf(p, 'status', ['new', 'learning', 'mastered'], '');
  const lang = u.str(p, 'language', '').toLowerCase();
  const q = u.str(p, 'q', '').toLowerCase();
  const withPreview = u.bool(p, 'preview', false) && !agent;
  const voice = V().current(app);
  const progs = progressMap(app);
  const rows = app.findRecordsByFilter('songs', 'archived = {:a}', 'level,title', 0, 0, { a: archived });
  const songs = [];
  for (const r of rows) {
    if (level > 0 && r.getInt('level') !== level) continue;
    if (kind !== '' && r.getString('kind') !== kind) continue;
    if (lang !== '' && r.getString('language') !== lang) continue;
    if (q !== '' && (r.getString('title') + ' ' + r.getString('composer') + ' ' + r.getString('first_words')).toLowerCase().indexOf(q) < 0) continue;
    const j = m.songJson(app, r, { progress: progs[r.id] || null, preview: withPreview });
    if (status !== '' && j.status !== status) continue;
    const fit = fitFor(voice, j);
    if (agent) {
      // Lean for the agent: what it needs to pick, plan and avoid duplicates.
      songs.push({
        id: j.id,
        title: j.title,
        composer: j.composer,
        kind: j.kind,
        level: j.level,
        language: j.language || undefined,
        key: j.key,
        range: V().noteName(j.low) + '-' + V().noteName(j.high) + ' (' + j.span + ' st)',
        bars: j.bars,
        status: j.status,
        key_shift: j.key_shift,
        done: Math.round(j.progress.pct * 100) + '%',
        last: j.progress.last_at === '' ? '' : j.progress.last_at.slice(0, 10),
        sections: j.sections.map((x) => x.name + ' ' + x.from + '-' + x.to + ' ' + x.stage + (x.best > 0 ? ' ' + x.best + '%' : '')).join('; '),
      });
      continue;
    }
    j.fit = fit;
    songs.push(j);
  }
  return { songs: songs, count: songs.length, voice: { comf_low: voice.comf_low, comf_high: voice.comf_high, tested: voice.tested } };
}

function get(app, p, e) {
  const u = U();
  const m = M();
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  const agent = u.fromAgent(e);
  const out = m.songJson(app, rec, { abc: u.bool(p, 'abc', false), model: u.bool(p, 'model', false) && !agent, preview: !agent && u.bool(p, 'preview', false), request: true, gloss: true, backingMap: !agent });
  out.fit = fitFor(V().current(app), out);
  const runs = app.findRecordsByFilter('runs', 'song = {:s}', '-created', 8, 0, { s: rec.id });
  out.recent = runs.map((r) => ({
    id: r.id,
    day: r.getString('day'),
    mode: r.getString('mode'),
    bars: r.getInt('from_bar') + '-' + r.getInt('to_bar'),
    key: r.getInt('key_shift'),
    tempo: r.getFloat('tempo_pct'),
    pitch: Math.round(r.getFloat('pitch_pct') * 1000) / 1000,
    in_tune: Math.round(r.getFloat('on_pct') * 1000) / 1000,
    bias_c: r.getFloat('bias_c'),
    clean: r.getBool('clean'),
  }));
  if (agent) {
    const model = m.modelOf(rec);
    out.bar_list = model ? model.bars.map((b) => b.n) : [];
  }
  return { song: out };
}

/** Problems as one message the CLI shows in full. */
function problemText(errors) {
  const parts = errors.slice(0, 10).map((x) => (x.line ? 'line ' + x.line + ': ' : '') + x.message);
  return parts.join(' | ') + (errors.length > 10 ? ' | ... and ' + (errors.length - 10) + ' more' : '');
}

/**
 * The singing checks on a parsed song: problems (refusals) and warnings.
 * `strict` (songs the coach adds) refuses an over-wide span and a missing source.
 */
function singingChecks(parsed, level, voice, strict) {
  const s = parsed.summary;
  const problems = [];
  const warnings = [];
  const cap = SPAN_CAP[level] || 19;
  if (s.span > cap) (strict ? problems : warnings).push({ line: 0, message: 'The melody spans ' + s.span + ' semitones (' + s.sung_range + '); level ' + level + ' allows ' + cap + '. Choose a narrower song, an excerpt, or a higher level.' });
  if (strict) {
    if (s.composer === '') problems.push({ line: 0, message: 'Add a C: line (the composer, or "Trad. (English)" for a traditional song).' });
    if (s.licence !== 'pd' && s.licence !== 'trad') problems.push({ line: 0, message: 'Songs the coach adds must be public domain or traditional: add %%licence pd or %%licence trad (and only for songs that are).' });
    if (s.source === '') problems.push({ line: 0, message: 'Add %%source naming the public-domain edition or collection you checked the melody and words against.' });
    if (!s.words && s.vowel === '') warnings.push({ line: 0, message: 'There are no words (w: lines). For a vocalise add %%vowel a (or la, ah, oo).' });
  }
  const sustain = SUSTAIN[level] || 20;
  if (s.longest_phrase_s > sustain) warnings.push({ line: 0, message: 'The longest phrase lasts ' + s.longest_phrase_s + ' s with no rest or !breath! mark; level ' + level + ' singers sustain about ' + sustain + ' s. Mark where to breathe with !breath! before a note.' });
  let fit = null;
  if (voice !== null) {
    const b = V().bestShift(voice, s.low, s.high, s.median);
    fit = { best_shift: b.shift, fits: b.fits, over: b.over, under: b.under, voice_tested: voice.tested };
    if (!b.fits) warnings.push({ line: 0, message: 'Even in its best key (' + (b.shift > 0 ? '+' : '') + b.shift + ') the song needs ' + (b.over + b.under) + ' semitone' + (b.over + b.under === 1 ? '' : 's') + ' more than the comfortable range ' + V().noteName(voice.comf_low) + '–' + V().noteName(voice.comf_high) + '.' });
  }
  return { problems: problems, warnings: warnings, fit: fit };
}

/**
 * The rules a change to an existing song's notation meets: the add-time rules
 * for songs (public domain, source, span cap) bind the coach only on songs
 * the coach added; the person's own and imported songs, and the starter
 * songs, need notation that parses and words that line up. A song with a
 * recording keeps its timing: the metre, the pickup, the tempo and every bar
 * where they were (the recording plays along by its bars).
 */
function editRules(app, rec, parsed, level, agent) {
  const strict = agent && rec.getString('source') === 'agent';
  const sc = singingChecks(parsed, level, V().current(app), strict);
  if (rec.getString('backing') !== '') {
    const was = M().modelOf(rec);
    const now = parsed.model;
    if (was !== null) {
      const bars = (x) => x.bars.map((b) => b.t + '/' + b.len).join(' ');
      const why = [];
      if (was.meter.label !== now.meter.label) why.push('the metre (' + was.meter.label + ' → ' + now.meter.label + ')');
      if (Math.round(was.tempo) !== Math.round(now.tempo)) why.push('the tempo (' + Math.round(was.tempo) + ' → ' + Math.round(now.tempo) + ')');
      if (was.pickup !== now.pickup) why.push('the pickup');
      if (why.length === 0 && bars(was) !== bars(now)) why.push('where the bars fall (' + was.bars.length + ' → ' + now.bars.length + ' bars)');
      if (why.length > 0) sc.problems.push({ line: 0, message: 'This song plays with the recording it was made from, by its bars: keep ' + why.join(' and ') + (why.length > 1 ? ' as they were' : ' as it was') + '. Change notes and words within the bars.' });
    }
  }
  return sc;
}

/** What a new notation changes in an existing song: sung notes and syllables (per verse). */
function changesOf(rec, parsed) {
  const was = M().modelOf(rec);
  if (was === null) return null;
  const a = was.melody || [];
  const b = parsed.model.melody || [];
  let notes = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) notes++;
  const syl = [];
  const nv = Math.max((was.lyrics || []).length, (parsed.model.lyrics || []).length);
  for (let v = 0; v < nv; v++) {
    const x = (was.lyrics || [])[v] || [];
    const y = (parsed.model.lyrics || [])[v] || [];
    let c = 0;
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || '').replace(/^_$/, '') !== (y[i] || '').replace(/^_$/, '')) c++;
    syl.push(c);
  }
  return { notes_changed: notes, syllables_changed_by_verse: syl, bars: was.bars.length + ' → ' + parsed.model.bars.length };
}

function parseOrFail(abc, sectionsInput) {
  const u = U();
  const a = A();
  const parsed = a.parse(abc);
  if (!parsed.ok) throw u.fail(400, 'The notation has ' + u.plural(parsed.errors.length, 'problem') + ': ' + problemText(parsed.errors), { errors: parsed.errors, warnings: parsed.warnings });
  const secs = a.parseSections(sectionsInput, parsed.model);
  if (secs.error) throw u.fail(400, secs.error, { errors: [{ line: 0, message: secs.error }] });
  return { parsed: parsed, sections: secs.sections };
}

function check(app, p, e) {
  const u = U();
  const a = A();
  const abc = u.str(p, 'abc', '');
  const parsed = a.parse(abc);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  const sectionsIn = sectionsParam(p);
  const secs = a.parseSections(sectionsIn, parsed.model);
  if (secs.error) return { ok: false, errors: [{ line: 0, message: secs.error }], warnings: parsed.warnings, summary: parsed.summary };
  // With --song: checked as a change to that song (the rules songs.update applies), with what it changes.
  const rec = u.has(p, 'song') ? M().song(app, u.str(p, 'song', '')) : null;
  const level = u.int(p, 'level', rec !== null ? rec.getInt('level') || parsed.summary.level : parsed.summary.level, 1, 10);
  const sc = rec !== null ? editRules(app, rec, parsed, level, u.fromAgent(e)) : singingChecks(parsed, level, V().current(app), u.fromAgent(e));
  const warnings = parsed.warnings.concat(sc.warnings);
  const changes = rec !== null ? changesOf(rec, parsed) : undefined;
  if (sc.problems.length > 0) return { ok: false, errors: sc.problems, warnings: warnings, summary: parsed.summary, fit: sc.fit, changes: changes };
  return { ok: true, errors: [], warnings: warnings, suggested_level: parsed.summary.level, level: level, summary: parsed.summary, sections: secs.sections, bars: parsed.model.bars.map((b) => b.n), fit: sc.fit, changes: changes };
}

function tagsOf(p) {
  const u = U();
  if (!u.has(p, 'tags')) return undefined;
  let v = p.tags;
  if (typeof v === 'string') {
    const t = v.trim();
    v = t.charAt(0) === '[' ? u.list(p, 'tags', '["trad","lullaby"]') : t.split(',');
  }
  if (!Array.isArray(v)) throw u.fail(400, 'tags must be a list, e.g. tags="trad, lullaby"');
  const out = [];
  for (const x of v) {
    const s = u.squash(String(x)).toLowerCase().slice(0, 24);
    if (s !== '' && out.indexOf(s) < 0) out.push(s);
  }
  return out.slice(0, 8);
}

function sectionsParam(p) {
  const u = U();
  if (!u.has(p, 'sections')) return '';
  if (Array.isArray(p.sections)) return p.sections;
  return u.str(p, 'sections', '');
}

function add(app, e, p) {
  const u = U();
  const m = M();
  m.ensureSeeded(app);
  const agent = u.fromAgent(e);
  const abc = u.req(p, 'abc', '"$(cat song.abc)"');
  const res = parseOrFail(abc, sectionsParam(p));
  const parsed = res.parsed;
  const level = u.int(p, 'level', parsed.summary.level, 1, 10);
  const sc = singingChecks(parsed, level, V().current(app), agent);
  if (sc.problems.length > 0) throw u.fail(400, 'The song cannot be added: ' + problemText(sc.problems), { errors: sc.problems, warnings: sc.warnings });
  const title = u.squash(u.str(p, 'title', '') || parsed.summary.title).slice(0, 160);
  if (title === '') throw u.fail(400, 'title is required: pass --title or put a T: line in the notation.');
  const composer = u.squash(u.str(p, 'composer', '') || parsed.summary.composer).slice(0, 160);
  const dup = app.findRecordsByFilter('songs', 'archived = false && title = {:t}', '', 1, 0, { t: title });
  if (dup.length > 0 && !u.bool(p, 'duplicate', false)) {
    throw u.fail(409, '"' + title + '" is already in the library (song ' + dup[0].id + '). Use songs.update --song ' + dup[0].id + ' to change it, or pass --duplicate true to add another version.', { song: dup[0].id, code: 'exists' });
  }
  const kind = u.oneOf(p, 'kind', ['song', 'vocalise'], parsed.summary.words ? 'song' : 'vocalise');
  const rec = new Record(app.findCollectionByNameOrId('songs'));
  rec.set('title', title);
  rec.set('composer', composer);
  rec.set('level', level);
  rec.set('kind', kind);
  rec.set('abc', abc);
  rec.set('tags', tagsOf(p) || []);
  rec.set('gloss', u.str(p, 'gloss', '').slice(0, 6000));
  rec.set('source', agent ? 'agent' : u.oneOf(p, 'source', ['you', 'import'], 'you'));
  rec.set('seen', !agent);
  const note = u.str(p, 'note', '');
  if (note !== '') {
    rec.set('note', note.slice(0, 2000));
    rec.set('note_at', u.now());
  }
  const msg = u.str(p, 'message', '');
  if (msg !== '') {
    if (u.byId(app, 'messages', msg) === null) throw u.fail(404, 'No message ' + msg + ' (pass the id of the message that asked for this song).');
    rec.set('request', msg);
  }
  m.applyParsed(rec, parsed, res.sections);
  if (!rec.getString('licence')) rec.set('licence', agent ? 'pd' : u.oneOf(p, 'source', ['you', 'import'], 'you') === 'import' ? 'import' : 'own');
  app.save(rec);
  return { song: m.songJson(app, rec, {}), linked_message: rec.getString('request') || null, summary: parsed.summary, fit: sc.fit, warnings: parsed.warnings.concat(sc.warnings) };
}

/** Keep the progress of sections whose bars did not change. */
function remapProgress(app, songId, oldSecs, newSecs) {
  const m = M();
  const prog = m.progressOrNull(app, songId);
  if (prog === null) return;
  const old = m.statesOf(prog, oldSecs.length);
  const byRange = {};
  oldSecs.forEach((s, i) => {
    byRange[s.from + '-' + s.to] = old[i];
  });
  const next = newSecs.map((s) => byRange[s.from + '-' + s.to] || m.blankState());
  prog.set('sections', next);
  prog.set('by_key', {});
  app.save(prog);
}

function update(app, e, p) {
  const u = U();
  const m = M();
  const agent = u.fromAgent(e);
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  const oldSecs = m.sectionsOf(rec);
  const changed = [];
  if (u.has(p, 'title')) {
    const t = u.squash(u.str(p, 'title', '')).slice(0, 160);
    if (t === '') throw u.fail(400, 'title cannot be empty');
    rec.set('title', t);
    changed.push('title');
  }
  if (u.has(p, 'composer')) {
    rec.set('composer', u.squash(u.str(p, 'composer', '')).slice(0, 160));
    changed.push('composer');
  }
  if (u.has(p, 'level')) {
    rec.set('level', u.int(p, 'level', 1, 1, 10));
    changed.push('level');
  }
  if (u.has(p, 'kind')) {
    rec.set('kind', u.oneOf(p, 'kind', ['song', 'vocalise'], 'song'));
    changed.push('kind');
  }
  const tags = tagsOf(p);
  if (tags !== undefined) {
    rec.set('tags', tags);
    changed.push('tags');
  }
  if (u.has(p, 'gloss')) {
    rec.set('gloss', u.str(p, 'gloss', '').slice(0, 6000));
    changed.push('gloss');
  }
  if (u.has(p, 'note')) {
    rec.set('note', u.str(p, 'note', '').slice(0, 2000));
    rec.set('note_at', u.now());
    changed.push('note');
  }
  if (u.has(p, 'fav')) {
    u.personOnly(e, 'change favourites');
    rec.set('fav', u.bool(p, 'fav', false));
    changed.push('fav');
  }
  let newSecs = null;
  if (u.has(p, 'abc') && u.str(p, 'abc', '') !== rec.getString('abc')) {
    const abc = u.str(p, 'abc', '');
    const res = parseOrFail(abc, sectionsParam(p));
    const level = u.int(p, 'level', rec.getInt('level') || res.parsed.summary.level, 1, 10);
    const sc = editRules(app, rec, res.parsed, level, agent);
    if (sc.problems.length > 0) throw u.fail(400, 'The notation cannot be used: ' + problemText(sc.problems), { errors: sc.problems });
    rec.set('abc', abc);
    // Without new sections, keep the old ones when they still fit the bars.
    let secs = res.sections;
    if (!u.has(p, 'sections') && oldSecs.length > 0) {
      const again = A().parseSections(oldSecs, res.parsed.model);
      if (!again.error) secs = again.sections;
    }
    m.applyParsed(rec, res.parsed, secs);
    // A starter song the person edits becomes their own (updates no longer replace it).
    if (!agent && rec.getString('source') === 'starter') rec.set('source', 'you');
    newSecs = secs;
    changed.push('notation');
  } else if (u.has(p, 'sections')) {
    const model = m.modelOf(rec);
    const secs = A().parseSections(sectionsParam(p), model);
    if (secs.error) throw u.fail(400, secs.error);
    rec.set('sections', secs.sections);
    newSecs = secs.sections;
    changed.push('sections');
  }
  if (changed.length === 0) return { song: m.songJson(app, rec, {}), changed: [] };
  app.save(rec);
  if (newSecs !== null) remapProgress(app, rec.id, oldSecs, newSecs);
  return { song: m.songJson(app, rec, {}), changed: changed };
}

/** The person opens a song to practise: the model, the key for this voice, and it is no longer new. */
function open(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'open songs');
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  let dirty = false;
  if (!rec.getBool('seen')) {
    rec.set('seen', true);
    dirty = true;
  }
  // A model from an older parser is parsed again.
  const model = m.modelOf(rec);
  if (model === null || (model.v || 1) < m.MODEL_V) {
    const parsed = A().parse(rec.getString('abc'));
    if (parsed.ok) {
      m.applyParsed(rec, parsed, m.sectionsOf(rec));
      dirty = true;
    }
  }
  if (dirty) app.save(rec);
  const s = m.settings(app);
  if (s.getString('last_song') !== rec.id) {
    s.set('last_song', rec.id);
    app.save(s);
  }
  const out = m.songJson(app, rec, { model: true, abc: true, request: true, gloss: true, backingMap: true });
  out.fit = fitFor(V().current(app), out);
  return { song: out };
}

/** Sing a song in another key (semitones from the written key); stages are kept per key. */
function transpose(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'change the key a song is sung in');
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  const shift = u.int(p, 'shift', 0, -12, 12);
  const prog = m.progress(app, rec.id);
  require(`${__hooks}/lib_runs.js`).switchKey(prog, shift, m.sectionsOf(rec).length);
  app.save(prog);
  return { song: m.songJson(app, rec, { progress: prog }) };
}

const BACKING_EXT = /\.(mp3|wav|wave|m4a|aac|mp4|ogg|oga|opus|flac|webm)$/i;

const STEM_EXT = /\.(ogg|opus|wav|webm)$/i;

/**
 * The recording a song was made from, kept as its backing track (the person
 * uploads it after adding the song): the file and where the song sits in it
 * (the beats found, which beat is bar 1). part=voice or part=music adds the
 * voice or the music separated from it (after the recording). remove=true
 * takes all of them off.
 */
function backing(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'attach recordings');
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  if (u.bool(p, 'remove', false)) {
    rec.set('backing', null);
    rec.set('backing_map', null);
    rec.set('backing_voice', null);
    rec.set('backing_music', null);
    app.save(rec);
    return { song: m.songJson(app, rec, { backingMap: true }) };
  }
  const part = String(p.part || 'recording');
  if (part !== 'recording' && part !== 'voice' && part !== 'music') throw u.fail(400, 'part must be recording, voice or music.');
  if (part !== 'recording') {
    if (rec.getString('backing') === '') throw u.fail(400, 'Attach the recording first: the ' + part + ' is separated from it.');
    const stem = u.uploaded(e, 'file');
    if (stem === null) throw u.fail(400, 'file is required: the ' + part + ' (ogg, opus, wav or webm).');
    if (!STEM_EXT.test(String(stem.originalName || stem.name || ''))) throw u.fail(400, 'The ' + part + ' must be an ogg, opus, wav or webm file.');
    rec.set('backing_' + part, stem);
    app.save(rec);
    return { song: m.songJson(app, rec, { backingMap: true }) };
  }
  const file = u.uploaded(e, 'file');
  if (file === null) throw u.fail(400, 'file is required: the recording (mp3, wav, m4a, ogg, flac or webm).');
  if (!BACKING_EXT.test(String(file.originalName || file.name || ''))) throw u.fail(400, 'The recording must be an mp3, wav, m4a, ogg, flac or webm file.');
  let map = p.map;
  if (typeof map === 'string') {
    try {
      map = JSON.parse(map);
    } catch {
      throw u.fail(400, 'map is not valid JSON.');
    }
  }
  if (map === null || typeof map !== 'object') throw u.fail(400, 'map is required: {bpm, beats, downbeat, beat_q, bar1_q, duration}.');
  const beats = Array.isArray(map.beats) ? map.beats.filter((x) => typeof x === 'number' && isFinite(x) && x >= 0).slice(0, 20000) : [];
  const bpm = Number(map.bpm);
  if (!(bpm >= 20 && bpm <= 400)) throw u.fail(400, 'map.bpm must be between 20 and 400.');
  if (beats.length < 2) throw u.fail(400, 'map.beats needs at least two beat times (seconds).');
  const clean = {
    bpm: Math.round(bpm * 1000) / 1000,
    beats: beats.map((x) => Math.round(x * 10000) / 10000),
    downbeat: Math.max(0, Math.min(beats.length - 1, Math.round(Number(map.downbeat) || 0))),
    beat_q: Number(map.beat_q) > 0 ? Number(map.beat_q) : 1,
    bar1_q: Number(map.bar1_q) >= 0 ? Number(map.bar1_q) : 0,
    duration: Number(map.duration) > 0 ? Number(map.duration) : 0,
    channels: Math.max(1, Math.min(2, Math.round(Number(map.channels) || 1))),
    source: map.source === 'voice' ? 'voice' : 'mix',
  };
  rec.set('backing', file);
  rec.set('backing_map', clean);
  // A new recording: what was separated from the old one no longer fits.
  rec.set('backing_voice', null);
  rec.set('backing_music', null);
  app.save(rec);
  return { song: m.songJson(app, rec, { backingMap: true }) };
}

function setArchived(app, e, p, value) {
  const u = U();
  const m = M();
  u.personOnly(e, value ? 'remove songs' : 'restore songs');
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  rec.set('archived', value);
  app.save(rec);
  return { song: m.songJson(app, rec, {}) };
}

function reset(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'reset progress');
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  const prog = m.progressOrNull(app, rec.id);
  if (prog !== null) {
    prog.set('sections', []);
    prog.set('by_key', {});
    app.save(prog);
  }
  return { song: m.songJson(app, rec, {}) };
}

module.exports = { SPAN_CAP: SPAN_CAP, SUSTAIN: SUSTAIN, list: list, get: get, check: check, add: add, update: update, open: open, transpose: transpose, backing: backing, setArchived: setArchived, reset: reset, progressMap: progressMap, singingChecks: singingChecks };
