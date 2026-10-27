/// <reference path="../pb_data/types.d.ts" />
/**
 * Sources: the links and files your AI agent reads to fill the application
 * (the website, each founder's LinkedIn and GitHub, a deck, notes). A founder
 * pastes a link or drops a file; your AI agent reads it, says what kind it is
 * and what it learned, and fills answers from it.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const KINDS = ['link', 'file', 'website', 'linkedin', 'github', 'x', 'deck', 'doc', 'video', 'metrics', 'other'];
const STATES = ['new', 'reading', 'read', 'failed'];

function view(app, r) {
  const U = L('lib_util');
  return {
    id: r.id,
    kind: r.getString('kind'),
    url: r.getString('url'),
    file: r.getString('file'),
    disk_path: r.getString('file') !== '' ? U.filePath(app, r, 'file') : '',
    title: r.getString('title'),
    founder: r.getString('founder'),
    state: r.getString('state') || 'new',
    summary: r.getString('summary'),
    error: r.getString('error'),
    origin: r.getString('origin'),
    created: r.getString('created'),
  };
}

function list(ctx, p) {
  const app = ctx.app;
  let rows = app.findRecordsByFilter('sources', '1=1', 'created', 0, 0).map((r) => view(app, r));
  if (p.state) rows = rows.filter((s) => s.state === p.state);
  return { sources: rows };
}

/** A source by its id, its link, or its title. */
function resolve(app, ref) {
  const U = L('lib_util');
  const want = String(ref || '').trim();
  const byId = U.byId(app, 'sources', want);
  if (byId !== null) return byId;
  const all = app.findRecordsByFilter('sources', '1=1', 'created', 0, 0);
  const lower = want.toLowerCase();
  for (const r of all) if (r.getString('url') !== '' && (r.getString('url').toLowerCase() === lower || r.getString('url').toLowerCase() === 'https://' + lower)) return r;
  for (const r of all) if (r.getString('title').trim().toLowerCase() === lower) return r;
  const names = all.map((r) => (r.getString('title') || r.getString('url')) + ' (' + r.id + ')');
  throw U.fail(404, 'No source "' + want + '". Sources: ' + (names.length > 0 ? names.join(', ') : 'none yet') + '.', 'not_found');
}

/** For the delete prompt: the source exists, and what to call it. */
function lookup(ctx, p) {
  const r = resolve(ctx.app, p.source);
  return '"' + (r.getString('title') || r.getString('url')) + '"';
}

const TEXT_TYPES = ['md', 'markdown', 'txt', 'csv', 'json', 'html', 'htm'];

function get(ctx, p) {
  const r = resolve(ctx.app, p.source);
  const out = view(ctx.app, r);
  const name = r.getString('file');
  const ext = name.indexOf('.') >= 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (name !== '' && TEXT_TYPES.indexOf(ext) >= 0) {
    try {
      out.text = toString($os.readFile(out.disk_path), 200000);
    } catch (err) {
      out.text_error = 'Could not read the file: ' + String((err && err.message) || err);
    }
  } else if (name !== '') out.text_note = 'Not a text file: read it at disk_path with your file tools.';
  return { source: out };
}

/** A link as typed, made into a full URL. */
function cleanUrl(raw) {
  const U = L('lib_util');
  const s = String(raw || '').trim();
  if (s === '' || /\s/.test(s)) throw U.fail(400, 'Give one link, for example --url https://acme.com', 'invalid_param', { param: 'url' });
  if (/^https?:\/\/[^/]+\.[^/]+/i.test(s) || /^https?:\/\/localhost/i.test(s)) return s;
  if (/^[^/]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return 'https://' + s;
  throw U.fail(400, '"' + s + '" is not a link. Give a full address such as https://acme.com', 'invalid_param', { param: 'url' });
}

function founderOrEmpty(app, ref) {
  if (ref === undefined || ref === '') return '';
  return L('lib_team').resolve(app, ref).id;
}

function add(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  S.assertPreparing(app);
  const url = cleanUrl(p.url);
  if (U.chars(url) > 1000) throw U.fail(400, 'url is ' + U.chars(url) + ' characters; it takes at most 1000.', 'too_long', { param: 'url', max: 1000 });
  const dup = U.findOne(app, 'sources', 'url = {:u}', { u: url });
  if (dup !== null) return { source: view(app, dup), duplicate: true };
  const rec = U.newRecord(app, 'sources');
  rec.set('url', url);
  rec.set('kind', p.kind || 'link');
  rec.set('title', U.clip(p.title || '', 300));
  rec.set('founder', founderOrEmpty(app, p.founder));
  rec.set('state', 'new');
  rec.set('origin', ctx.isAgent ? 'agent' : 'person');
  app.save(rec);
  if (!ctx.isAgent) S.log(app, 'person', 'Added ' + url, rec.id);
  return { source: view(app, rec) };
}

/** A file: uploaded by a founder (multipart "file") or named by your AI agent (--path). */
function upload(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  S.assertPreparing(app);
  let file = null;
  if (p.path) file = U.localFile(ctx, p.path, 'path');
  else {
    const files = ctx.e ? U.uploaded(ctx.e, 'file') : [];
    if (files.length === 0) throw U.fail(400, 'Attach a file (or, as your AI agent, give --path).', 'missing_file');
    file = files[0];
  }
  const rec = U.newRecord(app, 'sources');
  rec.set('file', file);
  rec.set('kind', p.kind || 'file');
  rec.set('title', U.clip(p.title || String(file.originalName || file.name || 'File'), 300));
  rec.set('founder', founderOrEmpty(app, p.founder));
  rec.set('state', 'new');
  rec.set('origin', ctx.isAgent ? 'agent' : 'person');
  app.save(rec);
  S.log(app, ctx.actor, 'Added the file ' + rec.getString('title'), rec.id);
  return { source: view(app, rec) };
}

function update(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const rec = resolve(app, p.source);
  if (p.kind !== undefined) rec.set('kind', p.kind);
  if (p.title !== undefined) rec.set('title', U.clip(p.title, 300));
  if (p.state !== undefined) rec.set('state', p.state);
  if (p.summary !== undefined) rec.set('summary', U.clip(p.summary, 8000));
  if (p.error !== undefined) rec.set('error', U.clip(p.error, 600));
  if (p.founder !== undefined) rec.set('founder', founderOrEmpty(app, p.founder));
  if (p.state === 'read') rec.set('error', '');
  app.save(rec);
  return { source: view(app, rec) };
}

function remove(ctx, p) {
  const app = ctx.app;
  L('lib_store').assertPreparing(app);
  const rec = resolve(app, p.source);
  const label = rec.getString('title') || rec.getString('url');
  const url = rec.getString('url').toLowerCase();
  app.delete(rec);
  L('lib_store').log(app, ctx.actor, 'Removed ' + label, '');
  const out = { removed: rec.id, label: label };
  if (url !== '') {
    const still = L('lib_answers')
      .all(app)
      .filter((a) => a.value.toLowerCase().indexOf(url.replace(/^https?:\/\//, '')) >= 0)
      .map((a) => a.key);
    if (still.length > 0) out.still_in_answers = still;
  }
  return out;
}

module.exports = { KINDS: KINDS, STATES: STATES, resolve: resolve, lookup: lookup, list: list, get: get, add: add, upload: upload, update: update, remove: remove };
