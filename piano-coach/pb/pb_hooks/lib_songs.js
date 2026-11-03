/// <reference path="../pb_data/types.d.ts" />
/**
 * The library: songs written in ABC notation.
 *
 *   songs.check   parse notation without saving (every problem, by bar)
 *   songs.add     add a song (the agent does this when asked for one)
 *   songs.update  change details, sections, the coach's note or the notation
 *   songs.list / songs.get   lean reads; the practice screen asks for the model
 *   songs.open / remove / restore / reset   the person's own actions
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}
function A() {
  return require(`${__hooks}/lib_abc.js`);
}

/** All progress rows, by song id: one query for a whole list. */
function progressMap(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('progress', '', '', 0, 0)) out[r.getString('song')] = r;
  return out;
}

function list(app, p, e) {
  const u = U();
  const m = M();
  m.ensureSeeded(app);
  const agent = u.fromAgent(e);
  const archived = u.bool(p, 'archived', false);
  const level = u.int(p, 'level', 0, 0, 10);
  const kind = u.oneOf(p, 'kind', ['piece', 'exercise'], '');
  const status = u.oneOf(p, 'status', ['new', 'learning', 'mastered'], '');
  const q = u.str(p, 'q', '').toLowerCase();
  const withPreview = u.bool(p, 'preview', false) && !agent;
  const progs = progressMap(app);
  const rows = app.findRecordsByFilter('songs', 'archived = {:a}', 'level,title', 0, 0, { a: archived });
  const songs = [];
  for (const r of rows) {
    if (level > 0 && r.getInt('level') !== level) continue;
    if (kind !== '' && r.getString('kind') !== kind) continue;
    if (q !== '' && (r.getString('title') + ' ' + r.getString('composer')).toLowerCase().indexOf(q) < 0) continue;
    const j = m.songJson(app, r, { progress: progs[r.id] || null, preview: withPreview });
    if (status !== '' && j.status !== status) continue;
    if (agent) {
      // Lean for the agent: what it needs to pick, plan and avoid duplicates.
      songs.push({
        id: j.id,
        title: j.title,
        composer: j.composer,
        level: j.level,
        kind: j.kind,
        key: j.key,
        meter: j.meter,
        bars: j.bars,
        status: j.status,
        done: Math.round(j.progress.pct * 100) + '%',
        last: j.progress.last_at === '' ? '' : j.progress.last_at.slice(0, 10),
        sections: j.sections.map((x) => x.name + ' ' + x.from + '-' + x.to + ' ' + x.stage + (x.best > 0 ? ' ' + x.best + '%' : '')).join('; '),
      });
      continue;
    }
    songs.push(j);
  }
  return { songs: songs, count: songs.length };
}

function get(app, p, e) {
  const u = U();
  const m = M();
  const rec = m.song(app, u.req(p, 'song', '<song id>'));
  const agent = u.fromAgent(e);
  const out = m.songJson(app, rec, { abc: u.bool(p, 'abc', false), model: u.bool(p, 'model', false) && !agent, preview: !agent && u.bool(p, 'preview', false), request: true });
  const runs = app.findRecordsByFilter('runs', 'song = {:s}', '-created', 8, 0, { s: rec.id });
  out.recent = runs.map((r) => ({
    day: r.getString('day'),
    mode: r.getString('mode'),
    bars: r.getInt('from_bar') + '-' + r.getInt('to_bar'),
    hands: r.getString('hands'),
    tempo: r.getFloat('tempo_pct'),
    accuracy: Math.round(r.getFloat('accuracy') * 1000) / 1000,
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

function parseOrFail(abc, sectionsInput) {
  const u = U();
  const a = A();
  const parsed = a.parse(abc);
  if (!parsed.ok) throw u.fail(400, 'The notation has ' + u.plural(parsed.errors.length, 'problem') + ': ' + problemText(parsed.errors), { errors: parsed.errors, warnings: parsed.warnings });
  const secs = a.parseSections(sectionsInput, parsed.model);
  if (secs.error) throw u.fail(400, secs.error, { errors: [{ line: 0, message: secs.error }] });
  return { parsed: parsed, sections: secs.sections };
}

function check(app, p) {
  const u = U();
  const a = A();
  const abc = u.str(p, 'abc', '');
  const parsed = a.parse(abc);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  const sectionsIn = u.has(p, 'sections') ? (Array.isArray(p.sections) ? p.sections : u.str(p, 'sections', '')) : '';
  const secs = a.parseSections(sectionsIn, parsed.model);
  if (secs.error) return { ok: false, errors: [{ line: 0, message: secs.error }], warnings: parsed.warnings, summary: parsed.summary };
  return { ok: true, errors: [], warnings: parsed.warnings, suggested_level: parsed.summary.level, summary: parsed.summary, sections: secs.sections, bars: parsed.model.bars.map((b) => b.n) };
}

function tagsOf(p) {
  const u = U();
  if (!u.has(p, 'tags')) return undefined;
  let v = p.tags;
  if (typeof v === 'string') {
    const t = v.trim();
    v = t.charAt(0) === '[' ? u.list(p, 'tags', '["scale","warm-up"]') : t.split(',');
  }
  if (!Array.isArray(v)) throw u.fail(400, 'tags must be a list, e.g. tags="romantic, waltz"');
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
  const abc = u.req(p, 'abc', '"X:1\\nT:Title\\nM:4/4\\nL:1/4\\nK:C\\nC D E F|G4|]"');
  const res = parseOrFail(abc, sectionsParam(p));
  const parsed = res.parsed;
  const title = u.squash(u.str(p, 'title', '') || parsed.summary.title).slice(0, 160);
  if (title === '') throw u.fail(400, 'title is required: pass --title or put a T: line in the notation.');
  const composer = u.squash(u.str(p, 'composer', '') || parsed.summary.composer).slice(0, 160);
  const dup = app.findRecordsByFilter('songs', 'archived = false && title = {:t}', '', 1, 0, { t: title });
  if (dup.length > 0 && !u.bool(p, 'duplicate', false)) {
    throw u.fail(409, '"' + title + '" is already in the library (song ' + dup[0].id + '). Use songs.update --song ' + dup[0].id + ' to change it, or pass --duplicate true to add another version.', { song: dup[0].id, code: 'exists' });
  }
  const level = u.int(p, 'level', parsed.summary.level, 1, 10);
  const kind = u.oneOf(p, 'kind', ['piece', 'exercise'], 'piece');
  const rec = new Record(app.findCollectionByNameOrId('songs'));
  rec.set('title', title);
  rec.set('composer', composer);
  rec.set('level', level);
  rec.set('kind', kind);
  rec.set('abc', abc);
  rec.set('tags', tagsOf(p) || []);
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
  app.save(rec);
  return { song: m.songJson(app, rec, {}), linked_message: rec.getString('request') || null, summary: parsed.summary, warnings: parsed.warnings };
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
  app.save(prog);
}

function update(app, e, p) {
  const u = U();
  const m = M();
  const agent = u.fromAgent(e);
  const rec = m.song(app, u.req(p, 'song', '<song id>'));
  const oldSecs = m.sectionsOf(rec);
  let changed = [];
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
    rec.set('kind', u.oneOf(p, 'kind', ['piece', 'exercise'], 'piece'));
    changed.push('kind');
  }
  const tags = tagsOf(p);
  if (tags !== undefined) {
    rec.set('tags', tags);
    changed.push('tags');
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
    rec.set('abc', abc);
    // Without new sections, keep the old ones when they still fit the bars.
    let secs = res.sections;
    if (!u.has(p, 'sections') && oldSecs.length > 0) {
      const again = A().parseSections(oldSecs, res.parsed.model);
      if (!again.error) secs = again.sections;
    }
    m.applyParsed(rec, res.parsed, secs);
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
  void agent;
  return { song: m.songJson(app, rec, {}), changed: changed };
}

/** The person opens a song to practise: the model, and the song is no longer new to them. */
function open(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'open songs');
  const rec = m.song(app, u.req(p, 'song', '<song id>'));
  let dirty = false;
  if (!rec.getBool('seen')) {
    rec.set('seen', true);
    dirty = true;
  }
  // A model from an older parser is parsed again (it gains the pedal and chord symbols).
  const model = m.modelOf(rec);
  if (model === null || (model.v || 1) < m.MODEL_V) {
    const parsed = require(`${__hooks}/lib_abc.js`).parse(rec.getString('abc'));
    if (parsed.ok) {
      rec.set('model', parsed.model);
      dirty = true;
    }
  }
  if (dirty) app.save(rec);
  const s = m.settings(app);
  if (s.getString('last_song') !== rec.id) {
    s.set('last_song', rec.id);
    app.save(s);
  }
  return { song: m.songJson(app, rec, { model: true, abc: true, request: true }) };
}

function setArchived(app, e, p, value) {
  const u = U();
  const m = M();
  u.personOnly(e, value ? 'remove songs' : 'restore songs');
  const rec = m.song(app, u.req(p, 'song', '<song id>'));
  rec.set('archived', value);
  app.save(rec);
  return { song: m.songJson(app, rec, {}) };
}

function reset(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'reset progress');
  const rec = m.song(app, u.req(p, 'song', '<song id>'));
  const prog = m.progressOrNull(app, rec.id);
  if (prog !== null) {
    prog.set('sections', []);
    app.save(prog);
  }
  return { song: m.songJson(app, rec, {}) };
}

module.exports = { list: list, get: get, check: check, add: add, update: update, open: open, setArchived: setArchived, reset: reset, progressMap: progressMap };
