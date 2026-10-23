/// <reference path="../pb_data/types.d.ts" />
/**
 * Each project's research repository: its folders and files, as a tree.
 *
 * A project starts with a small repository (`ensure`): a README and the
 * folders research-practice guidance agrees on (Wilson et al. 2017, Cookiecutter
 * Data Science, TIER, rrtools): raw data kept apart from processed data, code,
 * results and documents. People upload files and whole folders (the structure
 * is kept), download, rename, move and delete; text files are edited in place.
 * Uploading a file with a name that is already in the folder, or saving an
 * edit, makes a new version and keeps the one before (repo_versions), as OSF,
 * Drive, Dropbox and GitHub do: nothing is overwritten.
 *
 * Your AI agent lists, reads text files, uploads files from this machine
 * (--paths), writes text files and makes folders; deleting is a proposal a
 * person approves. Confidential projects keep it out of their repository.
 *
 * Files are served by repo.file: pictures, PDFs, sound and video in the page;
 * text and code as plain text in a sandbox (never run as a page); anything
 * else, or with --download, as a download.
 */

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_FILES = 100;
const BAD = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

// The starter folders, in order (a folder comes before what is inside it).
const STARTER = ['data', 'data/raw', 'data/processed', 'code', 'results', 'docs'];

// What a file is shown as, by its extension.
const SHOWN = {};
for (const x of ['txt', 'text', 'rst', 'json', 'jsonl', 'ndjson', 'geojson', 'yml', 'yaml', 'xml', 'toml', 'ini', 'cfg', 'conf', 'log', 'ipynb', 'py', 'r', 'rmd', 'qmd', 'jl', 'm', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'pl', 'php', 'swift', 'scala', 'lua', 'tex', 'bib', 'bst', 'cls', 'sty', 'html', 'htm', 'css', 'scss', 'do', 'sps', 'sas', 'stan', 'smk', 'nf', 'wdl', 'gitignore', 'gitattributes', 'editorconfig', 'env', 'dockerignore', 'fasta', 'fa', 'fastq', 'gff', 'vcf', 'bed', 'sam', 'pdb', 'srt', 'vtt'])
  SHOWN[x] = 'text';
for (const x of ['md', 'markdown']) SHOWN[x] = 'markdown';
for (const x of ['csv', 'tsv']) SHOWN[x] = 'table';
for (const x of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']) SHOWN[x] = 'image';
SHOWN.svg = 'svg';
SHOWN.pdf = 'pdf';
for (const x of ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac']) SHOWN[x] = 'audio';
for (const x of ['mp4', 'webm', 'mov', 'm4v', 'ogv']) SHOWN[x] = 'video';
// Files people name without an extension that are text.
const TEXT_NAMES = ['readme', 'license', 'licence', 'makefile', 'dockerfile', 'citation', 'changelog', 'notice', 'authors', 'contributing', 'snakefile', 'procfile'];

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', md: 'text/markdown', txt: 'text/plain', html: 'text/html', htm: 'text/html', xml: 'application/xml',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}

/* --------------------------------------------------------------- names */

function extOf(name) {
  const n = String(name || '');
  const dot = n.lastIndexOf('.');
  return dot < 0 ? '' : n.slice(dot + 1).toLowerCase();
}

/** How the app shows a file: text, markdown, table, image, svg, pdf, audio, video, or none. */
function shownAs(name) {
  const ext = extOf(name);
  if (SHOWN[ext]) return SHOWN[ext];
  return TEXT_NAMES.indexOf(String(name).toLowerCase().split('.')[0]) >= 0 ? 'text' : 'none';
}

function isText(name) {
  const s = shownAs(name);
  return s === 'text' || s === 'markdown' || s === 'table' || s === 'svg';
}

/** A name a person typed: refused when it would break on some computers. */
function cleanName(util, raw, param) {
  const name = util.squash(String(raw === undefined || raw === null ? '' : raw));
  if (name === '') throw util.fail(400, 'Give a name.', 'missing_param', { param: param });
  if (name.length > 255) throw util.fail(400, 'A name is at most 255 characters.', 'invalid_param', { param: param });
  if (name === '.' || name === '..') throw util.fail(400, '"' + name + '" cannot be a name.', 'invalid_param', { param: param });
  if (BAD.test(name)) throw util.fail(400, 'A name cannot hold / \\ : * ? " < > | (they break on some computers).', 'invalid_param', { param: param });
  if (/\.$/.test(name)) throw util.fail(400, 'A name cannot end with a dot.', 'invalid_param', { param: param });
  return name;
}

/** A name that came with a file (an upload, a folder upload's path): made safe instead of refused. */
function safeName(raw) {
  let name = u().squash(String(raw || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')).replace(/\.+$/, '');
  if (name === '' || name === '.' || name === '..') name = 'file';
  if (name.length > 255) {
    const ext = extOf(name);
    name = ext !== '' && ext.length < 20 ? name.slice(0, 254 - ext.length) + '.' + ext : name.slice(0, 255);
  }
  return name;
}

/** Path parts of a folder path ("data/raw"), each a valid name. */
function partsOf(util, path, param, safe) {
  return String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((x) => x.trim())
    .filter((x) => x !== '' && x !== '.')
    .map((x) => (safe ? safeName(x) : cleanName(util, x, param)));
}

function utf8Length(s) {
  return unescape(encodeURIComponent(s)).length;
}

/* ---------------------------------------------------------------- tree */

const ROW = { id: '', parent: '', kind: '', name: '', file: '', bytes: 0, version: 0, actor: '', created: '', updated: '' };

/** Every item of a project with its path, in one query. */
function tree(app, projectId) {
  const rows = u().plain(u().rows(app, 'SELECT id, parent, kind, name, file, bytes, version, actor, created, updated FROM repo_items WHERE project = {:p}', ROW, { p: projectId }));
  const by = {};
  for (const r of rows) by[r.id] = r;
  const pathOf = (r, depth) => {
    if (r.path !== undefined) return r.path;
    const up = r.parent !== '' ? by[r.parent] : undefined;
    r.path = up === undefined || depth > 64 ? r.name : pathOf(up, depth + 1) + '/' + r.name;
    return r.path;
  };
  for (const r of rows) pathOf(r, 0);
  return { rows: rows, by: by };
}

function pathOf(app, rec) {
  const names = [rec.getString('name')];
  let parent = rec.getString('parent');
  for (let i = 0; parent !== '' && i < 64; i++) {
    const up = u().byId(app, 'repo_items', parent);
    if (up === null) break;
    names.unshift(up.getString('name'));
    parent = up.getString('parent');
  }
  return names.join('/');
}

function diskPath(app, id, stored) {
  if (stored === '') return '';
  const p = $filepath.join(app.dataDir(), 'storage', app.findCollectionByNameOrId('repo_items').id, id, stored);
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

/** An item as callers see it (`r` is a row of `tree` or a record; `app` is the transaction a record was changed in). */
function out(ctx, r, app) {
  const rec = typeof r.getString === 'function';
  const get = (k) => (rec ? (k === 'bytes' || k === 'version' ? r.getInt(k) : r.getString(k)) : r[k]);
  const kind = get('kind');
  const name = get('name');
  const o = {
    id: r.id,
    parent: get('parent'),
    kind: kind,
    name: name,
    path: rec ? pathOf(app || ctx.app, r) : r.path,
    bytes: kind === 'file' ? get('bytes') : 0,
    version: kind === 'file' ? Math.max(1, get('version')) : 0,
    shown_as: kind === 'file' ? shownAs(name) : '',
    actor: get('actor'),
    created: get('created'),
    updated: get('updated'),
  };
  if (ctx.isAgent && kind === 'file') o.disk_path = diskPath(ctx.app, o.id, get('file'));
  return o;
}

/** Sort as a file browser does: folders first, then names, ignoring case. */
function byName(a, b) {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
}

/* -------------------------------------------------------------- lookups */

function projectOf(ctx, ref) {
  const pr = core().project(ctx.app, ref);
  core().guardProject(ctx, pr);
  return pr;
}

function itemOf(ctx, id) {
  const r = core().need(ctx.app, 'repo_items', id, 'item');
  core().guardProjectId(ctx, r.getString('project'));
  return r;
}

/** The item called `name` in a folder (`parent` '' is the top), ignoring case, or null. */
function child(app, projectId, parent, name) {
  const r = u().one(app, 'SELECT id FROM repo_items WHERE project = {:p} AND parent = {:par} AND name = {:n} COLLATE NOCASE LIMIT 1', { id: '' }, { p: projectId, par: parent, n: name });
  return r === null ? null : app.findRecordById('repo_items', r.id);
}

/** A folder named by id or by path ("data/raw"); '' or "/" is the top (null). */
function folderOf(app, util, projectId, ref, param) {
  const s = String(ref || '').trim();
  if (s === '' || s === '/') return null;
  const byId = util.byId(app, 'repo_items', s);
  if (byId !== null && byId.getString('project') === projectId) {
    if (byId.getString('kind') !== 'folder') throw util.fail(400, '"' + byId.getString('name') + '" is a file, not a folder.', 'invalid_param', { param: param });
    return byId;
  }
  let at = null;
  for (const part of partsOf(util, s, param, false)) {
    const next = child(app, projectId, at === null ? '' : at.id, part);
    if (next === null) throw util.fail(404, 'No folder "' + s + '" in the repository. repo.list shows what is there.', 'not_found', { param: param });
    if (next.getString('kind') !== 'folder') throw util.fail(400, '"' + part + '" is a file, not a folder.', 'invalid_param', { param: param });
    at = next;
  }
  return at;
}

/** Make the folders of `parts` under `parentId` where missing; returns the last one's id and the ids made. */
function mkdirp(app, ctx, util, projectId, parentId, parts) {
  let at = parentId;
  const made = [];
  for (const part of parts) {
    const there = child(app, projectId, at, part);
    if (there !== null) {
      if (there.getString('kind') !== 'folder') throw util.fail(409, 'There is a file called "' + there.getString('name') + '" where a folder would go.', 'exists', { item: there.id });
      at = there.id;
      continue;
    }
    const f = util.newRecord(app, 'repo_items');
    f.set('project', projectId);
    f.set('parent', at);
    f.set('kind', 'folder');
    f.set('name', part);
    f.set('actor', ctx.actor);
    app.save(f);
    made.push(f.id);
    at = f.id;
  }
  return { id: at, made: made };
}

/* -------------------------------------------------------------- starter */

function readme(pr) {
  const question = pr.getString('question').trim();
  return [
    '# ' + pr.getString('name'),
    '',
    question !== '' ? question : 'What this project asks, in a sentence or two.',
    '',
    '## What is where',
    '',
    '- `data/raw/` Data as you received or recorded it. Never edit these files; work on copies.',
    '- `data/processed/` Cleaned or derived data, made from the raw data by the code.',
    '- `code/` Scripts, notebooks and analysis code.',
    '- `results/` Figures, tables and other outputs the code makes.',
    '- `docs/` Protocols, notes, drafts and other documents.',
    '',
    '## People',
    '',
    'Who works on this project and how to reach them.',
    '',
    '## How to reproduce',
    '',
    'The software and versions needed, then the steps from the raw data to the results.',
    '',
    '## Data',
    '',
    'Where the data came from and when, its licence or consent terms, and what a reader must know about it.',
    '',
    '## How to cite',
    '',
    'How to cite this work.',
    '',
    '## Changes',
    '',
    '- ' + u().today() + ': repository started.',
    '',
  ].join('\n');
}

/**
 * Make the project's starter repository once (a project made before
 * repositories existed gets it the first time it is opened). Read again in a
 * transaction, so two screens opening it at once make it once.
 */
function ensure(app, projectId) {
  const util = u();
  let made = false;
  app.runInTransaction((tx) => {
    const pr = tx.findRecordById('projects', projectId);
    if (pr.getBool('repo_ready')) return;
    const sys = { actor: 'system' };
    const ids = {};
    for (const path of STARTER) {
      const parts = path.split('/');
      const parent = parts.length > 1 ? ids[parts.slice(0, -1).join('/')] || '' : '';
      ids[path] = mkdirp(tx, sys, util, projectId, parent, [parts[parts.length - 1]]).id;
    }
    if (child(tx, projectId, '', 'README.md') === null) {
      const text = readme(pr);
      const f = util.newRecord(tx, 'repo_items');
      f.set('project', projectId);
      f.set('parent', '');
      f.set('kind', 'file');
      f.set('name', 'README.md');
      f.set('file', $filesystem.fileFromBytes(text, 'README.md'));
      f.set('bytes', utf8Length(text));
      f.set('version', 1);
      f.set('actor', 'system');
      tx.save(f);
    }
    pr.set('repo_ready', true);
    tx.save(pr);
    made = true;
  });
  return made;
}

/* ------------------------------------------------------------- versions */

/** Put `file` in an item as its next version, keeping the one before in repo_versions (`file` null: the item is now empty). */
function newVersion(app, ctx, util, item, file, bytes) {
  const stored = item.getString('file');
  const n = Math.max(1, item.getInt('version'));
  if (stored !== '') {
    const v = util.newRecord(app, 'repo_versions');
    v.set('item', item.id);
    v.set('number', n);
    // A copy of the bytes as they are now (the item's own copy goes once it takes the new file).
    v.set('file', $filesystem.fileFromPath(diskPath(app, item.id, stored)));
    v.set('bytes', item.getInt('bytes'));
    v.set('actor', item.getString('actor'));
    v.set('made_at', item.getString('updated'));
    app.save(v);
  }
  item.set('file', file === null ? '' : file);
  item.set('bytes', bytes);
  item.set('version', stored !== '' ? n + 1 : n);
  item.set('actor', ctx.actor);
  app.save(item);
}

/** Change items inside one transaction, read afresh there; our own errors keep their status and code. */
function locked(app, fn) {
  let res;
  let failure = null;
  try {
    app.runInTransaction((tx) => {
      try {
        res = fn(tx);
      } catch (e) {
        failure = e;
        throw e;
      }
    });
  } catch (e) {
    throw failure !== null ? failure : e;
  }
  return res;
}

/* ---------------------------------------------------------------- reads */

/** repo.list: the whole repository of a project, with paths. */
function list(ctx, p) {
  const util = u();
  const pr = projectOf(ctx, util.req(p, 'project'));
  const t = tree(ctx.app, pr.id);
  const items = t.rows.map((r) => out(ctx, r));
  items.sort((a, b) => {
    const pa = a.path.toLowerCase();
    const pb = b.path.toLowerCase();
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  const files = items.filter((x) => x.kind === 'file');
  return { ready: pr.getBool('repo_ready'), items: items, files: files.length, folders: items.length - files.length, bytes: files.reduce((n, x) => n + x.bytes, 0) };
}

/** repo.get: one item; a folder with what is directly inside it, a file with its versions. */
function get(ctx, p) {
  const util = u();
  const r = itemOf(ctx, util.req(p, 'item'));
  const item = out(ctx, r);
  if (r.getString('kind') === 'folder') {
    const t = tree(ctx.app, r.getString('project'));
    const inside = t.rows.filter((x) => x.parent === r.id).map((x) => out(ctx, x));
    inside.sort(byName);
    return { item: item, inside: inside };
  }
  return { item: item, versions: versionsOf(ctx, r) };
}

function versionsOf(ctx, r) {
  const list = ctx.app.findRecordsByFilter('repo_versions', 'item = {:i}', '-number', 0, 0, { i: r.id }).map((v) => ({ number: v.getInt('number'), bytes: v.getInt('bytes'), actor: v.getString('actor'), made_at: v.getString('made_at'), current: false }));
  return [{ number: Math.max(1, r.getInt('version')), bytes: r.getInt('bytes'), actor: r.getString('actor'), made_at: r.getString('updated'), current: true }].concat(list);
}

/** repo.versions: a file's versions, newest first. */
function versions(ctx, p) {
  const r = itemOf(ctx, u().req(p, 'item'));
  if (r.getString('kind') !== 'file') throw u().fail(400, 'A folder has no versions.', 'invalid_param', { param: 'item' });
  return { item: out(ctx, r), versions: versionsOf(ctx, r) };
}

/** repo.read: a text file's content (your AI agent reads files this way). */
function read(ctx, p) {
  const util = u();
  const r = itemOf(ctx, util.req(p, 'item'));
  if (r.getString('kind') !== 'file') throw util.fail(400, 'That is a folder; repo.get lists what is inside it.', 'invalid_param', { param: 'item' });
  const item = out(ctx, r);
  if (!isText(r.getString('name'))) throw util.fail(409, '"' + r.getString('name') + '" is not a text file.' + (ctx.isAgent ? ' Read it from disk: ' + item.disk_path : ' Download it instead.'), 'not_text', { disk_path: item.disk_path || '' });
  if (r.getInt('bytes') > MAX_TEXT) throw util.fail(409, '"' + r.getString('name') + '" is larger than 2 MB.' + (ctx.isAgent ? ' Read it from disk: ' + item.disk_path : ' Download it instead.'), 'too_large', { disk_path: item.disk_path || '' });
  return { item: item, text: readText(ctx.app, r.id, r.getString('file')) };
}

function readText(app, id, stored) {
  if (stored === '') return '';
  const fsys = app.newFilesystem();
  try {
    const reader = fsys.getReader(app.findCollectionByNameOrId('repo_items').id + '/' + id + '/' + stored);
    try {
      return toString(reader, MAX_TEXT);
    } finally {
      reader.close();
    }
  } finally {
    fsys.close();
  }
}

/**
 * repo.file: the file itself (a version with --version). Pictures, PDFs,
 * sound and video show in the page; text as plain text in a sandbox; the rest
 * downloads. Your AI agent gets where the file is on this machine instead.
 */
function file(ctx, p) {
  const util = u();
  const r = itemOf(ctx, util.req(p, 'item'));
  if (r.getString('kind') !== 'file') throw util.fail(400, 'A folder downloads as a zip from the page.', 'invalid_param', { param: 'item' });
  const current = Math.max(1, r.getInt('version'));
  const want = util.has(p, 'version') ? util.int(p, 'version', current, 1, 1000000) : current;
  let rec = r;
  let stored = r.getString('file');
  if (want !== current) {
    const v = ctx.app.findRecordsByFilter('repo_versions', 'item = {:i} && number = {:n}', '', 1, 0, { i: r.id, n: want })[0];
    if (v === undefined) throw util.fail(404, '"' + r.getString('name') + '" has no version ' + want + '.', 'not_found', { param: 'version' });
    rec = v;
    stored = v.getString('file');
  }
  if (ctx.isAgent) return { item: out(ctx, r), version: want, disk_path: stored === '' ? '' : $filepath.join(ctx.app.dataDir(), 'storage', rec.baseFilesPath(), stored) };
  const name = r.getString('name');
  const ext = extOf(name);
  const shown = shownAs(name);
  const download = util.bool(p, 'download', false);
  const label = want === current ? name : name.replace(/(\.[^.]*)?$/, (m) => ' (version ' + want + ')' + m);
  if (stored === '') {
    // An empty file: nothing stored, so nothing to stream.
    ctx.e.response.header().set('Content-Disposition', (download ? 'attachment' : 'inline') + '; filename="' + label.replace(/["\\\r\n]/g, '_') + '"');
    ctx.e.response.header().set('X-Content-Type-Options', 'nosniff');
    ctx.e.response.header().set('Content-Security-Policy', 'sandbox');
    ctx.e.string(200, '');
    return { __streamed: true };
  }
  // The address names the version, so what it serves never changes.
  const cache = util.has(p, 'version') ? 'private, max-age=31536000, immutable' : 'private, no-cache';
  if (!download && (shown === 'image' || shown === 'pdf' || shown === 'audio' || shown === 'video')) return require(`${__hooks}/lib_files.js`).streamName(ctx, rec, stored, MIME[ext], label, cache, true);
  if (!download && isText(name)) {
    ctx.e.response.header().set('Content-Security-Policy', 'sandbox');
    return require(`${__hooks}/lib_files.js`).streamName(ctx, rec, stored, 'text/plain; charset=utf-8', label, cache, true);
  }
  return require(`${__hooks}/lib_files.js`).streamName(ctx, rec, stored, MIME[ext] || 'application/octet-stream', label, cache, false);
}

/* --------------------------------------------------------------- writes */

/** repo.init: make the project's starter repository if it was never made. */
function init(ctx, p) {
  const pr = projectOf(ctx, u().req(p, 'project'));
  const made = ensure(ctx.app, pr.id);
  return { made: made, ready: true };
}

/** repo.mkdir: a folder (a path such as "data/raw/2026" makes each missing one). */
function mkdir(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = projectOf(ctx, util.req(p, 'project'));
  const parts = partsOf(util, util.req(p, 'name'), 'name', false);
  if (parts.length === 0) throw util.fail(400, 'Give the folder a name.', 'missing_param', { param: 'name' });
  ensure(app, pr.id);
  const res = locked(app, (tx) => {
    const parent = folderOf(tx, util, pr.id, util.str(p, 'folder', ''), 'folder');
    const m = mkdirp(tx, ctx, util, pr.id, parent === null ? '' : parent.id, parts);
    const f = tx.findRecordById('repo_items', m.id);
    if (m.made.length > 0) act().write(tx, ctx, { label: 'Made the folder ' + pathOf(tx, f) + ' in ' + pr.getString('name'), target: 'repo_items', record: f.id, project: pr.id, undo: { fn: 'lib_repo.undoMake', args: { items: m.made } } });
    return { folder: out(ctx, f, tx), made: m.made.length };
  });
  return res;
}

/** repo.upload: files into a folder (`path` makes subfolders, as a folder upload does). Same names make new versions. */
function upload(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = projectOf(ctx, util.req(p, 'project'));
  const files = ctx.e ? util.uploadedAll(ctx.e, 'files') : [];
  const paths = util.has(p, 'paths') ? util.list(p, 'paths') || [] : [];
  for (const path of paths) files.push(util.localFile(ctx, String(path), 'paths').file);
  if (files.length === 0) throw util.fail(400, 'Choose files to upload' + (ctx.isAgent ? ' (--paths, a JSON list of absolute paths).' : '.'), 'missing_param', { param: 'files' });
  if (files.length > MAX_FILES) throw util.fail(400, 'At most ' + MAX_FILES + ' files in one upload.', 'too_many');
  const under = partsOf(util, util.str(p, 'path', ''), 'path', true);
  ensure(app, pr.id);
  const res = locked(app, (tx) => {
    const parent = folderOf(tx, util, pr.id, util.str(p, 'folder', ''), 'folder');
    const m = mkdirp(tx, ctx, util, pr.id, parent === null ? '' : parent.id, under);
    const done = [];
    for (const f of files) {
      const name = safeName(f.originalName);
      const there = child(tx, pr.id, m.id, name);
      if (there !== null && there.getString('kind') === 'folder') throw util.fail(409, 'There is a folder called "' + there.getString('name') + '" here; a file cannot take its name.', 'exists', { item: there.id });
      if (there !== null) {
        newVersion(tx, ctx, util, there, f, Number(f.size || 0));
        done.push({ id: there.id, name: there.getString('name'), version: there.getInt('version'), new_version: true });
        continue;
      }
      const r = util.newRecord(tx, 'repo_items');
      r.set('project', pr.id);
      r.set('parent', m.id);
      r.set('kind', 'file');
      r.set('name', name);
      r.set('file', f);
      r.set('bytes', Number(f.size || 0));
      r.set('version', 1);
      r.set('actor', ctx.actor);
      tx.save(r);
      done.push({ id: r.id, name: name, version: 1, new_version: false });
    }
    const where = m.id === '' ? 'the top of the repository' : pathOf(tx, tx.findRecordById('repo_items', m.id));
    const fresh = done.filter((x) => !x.new_version).map((x) => x.id);
    act().write(tx, ctx, {
      label: (done.length === 1 ? (done[0].new_version ? 'Uploaded version ' + done[0].version + ' of ' : 'Uploaded ') + done[0].name : 'Uploaded ' + done.length + ' files') + ' to ' + where + ' in ' + pr.getString('name'),
      target: 'repo_items',
      record: done[0].id,
      project: pr.id,
      // Undo takes back new files and folders only; a new version stays (the one before is in its history).
      undo: fresh.length === done.length ? { fn: 'lib_repo.undoMake', args: { items: fresh.concat(m.made) } } : undefined,
    });
    return { uploaded: done.map((x) => ({ item: out(ctx, tx.findRecordById('repo_items', x.id), tx), new_version: x.new_version })), folder: where };
  });
  return res;
}

/** repo.write: a text file's content, new (--folder, --name) or a new version of one (--item). */
function write(ctx, p) {
  const util = u();
  const app = ctx.app;
  const raw = p.content;
  if (typeof raw !== 'string') throw util.fail(400, 'content is the text of the file.', 'missing_param', { param: 'content' });
  const content = raw.replace(/\r\n/g, '\n');
  const bytes = utf8Length(content);
  if (bytes > MAX_TEXT) throw util.fail(400, 'A text file written here is at most 2 MB; upload larger files.', 'too_large', { param: 'content' });
  if (util.has(p, 'item')) {
    const id = itemOf(ctx, util.req(p, 'item')).id;
    return locked(app, (tx) => {
      const r = tx.findRecordById('repo_items', id);
      if (r.getString('kind') !== 'file' || !isText(r.getString('name'))) throw util.fail(400, 'Only text files are written here; upload other files.', 'not_text', { param: 'item' });
      newVersion(tx, ctx, util, r, bytes > 0 ? $filesystem.fileFromBytes(content, r.getString('name')) : null, bytes);
      act().write(tx, ctx, { label: 'Saved version ' + r.getInt('version') + ' of ' + pathOf(tx, r), target: 'repo_items', record: r.id, project: r.getString('project') });
      return { item: out(ctx, r, tx) };
    });
  }
  const pr = projectOf(ctx, util.req(p, 'project'));
  const name = cleanName(util, util.req(p, 'name'), 'name');
  if (!isText(name)) throw util.fail(400, '"' + name + '" is not a text file name (for example notes.md, analysis.py, data.csv); upload other files.', 'not_text', { param: 'name' });
  ensure(app, pr.id);
  return locked(app, (tx) => {
    const parent = folderOf(tx, util, pr.id, util.str(p, 'folder', ''), 'folder');
    const pid = parent === null ? '' : parent.id;
    const there = child(tx, pr.id, pid, name);
    if (there !== null && there.getString('kind') === 'folder') throw util.fail(409, 'There is a folder called "' + there.getString('name') + '" here.', 'exists', { item: there.id });
    if (there !== null) {
      newVersion(tx, ctx, util, there, bytes > 0 ? $filesystem.fileFromBytes(content, name) : null, bytes);
      act().write(tx, ctx, { label: 'Saved version ' + there.getInt('version') + ' of ' + pathOf(tx, there), target: 'repo_items', record: there.id, project: pr.id });
      return { item: out(ctx, there, tx), new_version: true };
    }
    const r = util.newRecord(tx, 'repo_items');
    r.set('project', pr.id);
    r.set('parent', pid);
    r.set('kind', 'file');
    r.set('name', name);
    // An empty file keeps no bytes (none can be stored).
    if (bytes > 0) r.set('file', $filesystem.fileFromBytes(content, name));
    r.set('bytes', bytes);
    r.set('version', 1);
    r.set('actor', ctx.actor);
    tx.save(r);
    act().write(tx, ctx, { label: 'Made the file ' + pathOf(tx, r) + ' in ' + pr.getString('name'), target: 'repo_items', record: r.id, project: pr.id, undo: { fn: 'lib_repo.undoMake', args: { items: [r.id] } } });
    return { item: out(ctx, r, tx), new_version: false };
  });
}

/** repo.rename: a file or folder's name (in the same folder). */
function rename(ctx, p) {
  const util = u();
  const id = itemOf(ctx, util.req(p, 'item')).id;
  const name = cleanName(util, util.req(p, 'name'), 'name');
  return locked(ctx.app, (tx) => {
    const r = tx.findRecordById('repo_items', id);
    const before = r.getString('name');
    if (before === name) return { item: out(ctx, r, tx) };
    const there = child(tx, r.getString('project'), r.getString('parent'), name);
    if (there !== null && there.id !== r.id) throw util.fail(409, 'There is already "' + there.getString('name') + '" in this folder.', 'exists', { item: there.id });
    r.set('name', name);
    tx.save(r);
    act().write(tx, ctx, { label: 'Renamed ' + before + ' to ' + name, target: 'repo_items', record: r.id, project: r.getString('project'), undo: { fn: 'lib_repo.undoRename', args: { item: r.id, name: before } } });
    return { item: out(ctx, r, tx) };
  });
}

/** repo.move: files and folders into another folder (--to; "" is the top). */
function move(ctx, p) {
  const util = u();
  const list = util.ids(p, 'items', 1000);
  if (list.length === 0) throw util.fail(400, 'Name the items to move.', 'missing_param', { param: 'items' });
  const first = itemOf(ctx, list[0]);
  const projectId = first.getString('project');
  return locked(ctx.app, (tx) => {
    const dest = folderOf(tx, util, projectId, util.str(p, 'to', ''), 'to');
    const destId = dest === null ? '' : dest.id;
    // The destination and every folder above it: a folder cannot go into itself.
    const above = {};
    for (let at = dest, i = 0; at !== null && i < 64; i++) {
      above[at.id] = true;
      at = at.getString('parent') !== '' ? tx.findRecordById('repo_items', at.getString('parent')) : null;
    }
    const recs = list.map((id) => {
      const r = util.byId(tx, 'repo_items', id);
      if (r === null) throw util.fail(404, 'No item ' + id + '.', 'not_found', { param: 'items' });
      if (r.getString('project') !== projectId) throw util.fail(400, 'Items move within one project.', 'invalid_param', { param: 'items' });
      if (above[r.id]) throw util.fail(400, '"' + r.getString('name') + '" cannot go inside itself.', 'invalid_param', { param: 'to' });
      return r;
    });
    const moving = recs.filter((r) => r.getString('parent') !== destId);
    const names = {};
    const clash = [];
    for (const r of moving) {
      const key = r.getString('name').toLowerCase();
      const there = child(tx, projectId, destId, r.getString('name'));
      if ((there !== null && there.id !== r.id) || names[key]) clash.push(r.getString('name'));
      names[key] = true;
    }
    if (clash.length > 0) throw util.fail(409, (clash.length === 1 ? '"' + clash[0] + '" is' : clash.length + ' names are') + ' already in that folder: rename first.', 'exists', { names: clash });
    const back = moving.map((r) => ({ item: r.id, parent: r.getString('parent') }));
    for (const r of moving) {
      r.set('parent', destId);
      tx.save(r);
    }
    const where = dest === null ? 'the top of the repository' : pathOf(tx, dest);
    if (moving.length > 0) act().write(tx, ctx, { label: 'Moved ' + (moving.length === 1 ? moving[0].getString('name') : moving.length + ' items') + ' to ' + where, target: 'repo_items', record: moving[0].id, project: projectId, undo: { fn: 'lib_repo.undoMove', args: { moves: back } } });
    return { moved: moving.length, to: where };
  });
}

/** What a deletion takes: the items named (inner ones of a named folder are already counted) and everything inside. */
function takes(ctx, util, p) {
  const list = util.ids(p, 'items', 1000);
  if (list.length === 0) throw util.fail(400, 'Name the items to delete.', 'missing_param', { param: 'items' });
  const first = itemOf(ctx, list[0]);
  const projectId = first.getString('project');
  const t = tree(ctx.app, projectId);
  const chosen = {};
  for (const id of list) {
    if (t.by[id] === undefined) throw util.fail(404, 'No item ' + id + ' in that project.', 'not_found', { param: 'items' });
    chosen[id] = true;
  }
  // True when a folder above `r` is in `set`.
  const insideOf = (r, set) => {
    for (let up = t.by[r.parent], i = 0; up !== undefined && i < 64; up = t.by[up.parent], i++) if (set[up.id]) return true;
    return false;
  };
  const top = Object.keys(chosen)
    .map((id) => t.by[id])
    .filter((r) => !insideOf(r, chosen));
  const tops = {};
  for (const r of top) tops[r.id] = true;
  const all = t.rows.filter((r) => tops[r.id] || insideOf(r, tops));
  const files = all.filter((r) => r.kind === 'file');
  return { projectId: projectId, top: top, n: { files: files.length, folders: all.length - files.length, bytes: files.reduce((n, r) => n + r.bytes, 0), paths: top.map((r) => r.path) } };
}

/** repo.delete: files and folders, with everything inside them and every version. */
function remove(ctx, p) {
  const util = u();
  const k = takes(ctx, util, p);
  if (util.bool(p, 'preview', false)) return { preview: true, takes: k.n };
  const pr = ctx.app.findRecordById('projects', k.projectId);
  ctx.app.runInTransaction((tx) => {
    // Re-read by id: deleting a record that came from a filter query can fail in this engine.
    for (const r of k.top) {
      const rec = util.byId(tx, 'repo_items', r.id);
      if (rec !== null) tx.delete(rec);
    }
    act().write(tx, ctx, { label: 'Deleted ' + (k.top.length === 1 ? k.top[0].path : k.top.length + ' items') + ' from the repository of ' + pr.getString('name') + ' (' + k.n.files + ' files)', target: 'repo_items', record: k.top[0].id, project: k.projectId, data: { detail: k.n } });
  });
  return { deleted: true, took: k.n };
}

function removePreview(ctx, p) {
  const util = u();
  const k = takes(ctx, util, p);
  const pr = ctx.app.findRecordById('projects', k.projectId);
  return {
    kind: 'delete_repo_items',
    title: 'Delete ' + (k.top.length === 1 ? k.top[0].path : k.top.length + ' items') + ' from the repository of ' + pr.getString('name'),
    summary: 'Deletes ' + k.n.files + (k.n.files === 1 ? ' file' : ' files') + (k.n.folders > 0 ? ' and ' + k.n.folders + (k.n.folders === 1 ? ' folder' : ' folders') : '') + ', with every earlier version: ' + k.n.paths.slice(0, 10).join(', ') + (k.n.paths.length > 10 ? ' and more' : '') + '.',
    preview: { takes: k.n },
    project: k.projectId,
    target: { collection: 'repo_items', id: k.top[0].id },
  };
}

/** repo.restore: make an earlier version the current one (the current one is kept as a version too). */
function restore(ctx, p) {
  const util = u();
  const id = itemOf(ctx, util.req(p, 'item')).id;
  const want = util.int(p, 'version', 0, 1, 1000000);
  return locked(ctx.app, (tx) => {
    const r = tx.findRecordById('repo_items', id);
    const v = tx.findRecordsByFilter('repo_versions', 'item = {:i} && number = {:n}', '', 1, 0, { i: r.id, n: want })[0];
    if (v === undefined) throw util.fail(404, '"' + r.getString('name') + '" has no earlier version ' + want + '.', 'not_found', { param: 'version' });
    const stored = v.getString('file');
    const file = stored === '' ? null : $filesystem.fileFromPath($filepath.join(tx.dataDir(), 'storage', v.baseFilesPath(), stored));
    newVersion(tx, ctx, util, r, file, v.getInt('bytes'));
    act().write(tx, ctx, { label: 'Restored version ' + want + ' of ' + pathOf(tx, r) + ' (now version ' + r.getInt('version') + ')', target: 'repo_items', record: r.id, project: r.getString('project') });
    return { item: out(ctx, r, tx) };
  });
}

/* ----------------------------------------------------------------- undo */

function undoMake(ctx, args) {
  ctx.app.runInTransaction((tx) => {
    for (const id of (args.items || []).slice().reverse()) {
      const r = u().byId(tx, 'repo_items', id);
      if (r === null) continue;
      // A folder that has gained something since stays.
      if (r.getString('kind') === 'folder' && u().count(tx, 'SELECT COUNT(*) AS n FROM repo_items WHERE parent = {:p}', { p: r.id }) > 0) continue;
      tx.delete(r);
    }
  });
}

function undoRename(ctx, args) {
  const r = u().byId(ctx.app, 'repo_items', args.item);
  if (r === null) return;
  if (child(ctx.app, r.getString('project'), r.getString('parent'), args.name) !== null) throw u().fail(409, 'Something called "' + args.name + '" is in that folder now.', 'exists');
  r.set('name', args.name);
  ctx.app.save(r);
}

function undoMove(ctx, args) {
  ctx.app.runInTransaction((tx) => {
    for (const m of args.moves || []) {
      const r = u().byId(tx, 'repo_items', m.item);
      if (r === null) continue;
      if (m.parent !== '' && u().byId(tx, 'repo_items', m.parent) === null) continue;
      if (child(tx, r.getString('project'), m.parent, r.getString('name')) !== null) continue;
      r.set('parent', m.parent);
      tx.save(r);
    }
  });
}

/** A project's file count (project stats). */
function count(app, projectId) {
  return u().count(app, "SELECT COUNT(*) AS n FROM repo_items WHERE project = {:p} AND kind = 'file'", { p: projectId });
}

module.exports = {
  STARTER: STARTER,
  shownAs: shownAs,
  tree: tree,
  pathOf: pathOf,
  diskPath: diskPath,
  ensure: ensure,
  count: count,
  list: list,
  get: get,
  versions: versions,
  read: read,
  file: file,
  init: init,
  mkdir: mkdir,
  upload: upload,
  write: write,
  rename: rename,
  move: move,
  remove: remove,
  removePreview: removePreview,
  restore: restore,
  undoMake: undoMake,
  undoRename: undoRename,
  undoMove: undoMove,
};
