/// <reference path="../pb_data/types.d.ts" />
/**
 * Small helpers every module uses: errors with a machine code, parameter
 * parsing, text measures and a cached require.
 */

const cache = {};

/** require() a hooks module once per VM (a fresh require costs about 2 ms). */
function lib(name) {
  let m = cache[name];
  if (m === undefined) {
    m = require(`${__hooks}/${name}.js`);
    cache[name] = m;
  }
  return m;
}

/** An error the dispatcher turns into { status, message, code, data }. */
function fail(status, message, code, extra) {
  const err = new Error(message);
  err.status = status;
  err.code = code || (status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'invalid');
  err.extra = extra || {};
  return err;
}

function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  const msg = String((err && err.message) || err);
  if (msg.indexOf('sql: no rows') >= 0) return 404;
  return 500;
}

function now() {
  return new Date().toISOString();
}

/** Levenshtein distance, for "did you mean" on unknown names. */
function distance(a, b) {
  const m = a.length;
  const n = b.length;
  const row = [];
  for (let j = 0; j <= n; j++) row.push(j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

function nearest(name, names) {
  let best = '';
  let bestD = 99;
  for (const n of names) {
    const d = distance(String(name), String(n));
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return bestD <= Math.max(2, Math.floor(String(name).length / 3)) ? best : '';
}

/** A short stable hash (djb2) to tell whether text changed since it was judged. */
function hash(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** A JSON list parameter (the CLI sends text, the screens send real lists). */
function list(v, what) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(String(v));
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* falls through */
  }
  throw fail(400, (what || 'This parameter') + ' must be a JSON list, for example ["a","b"].', 'invalid_param');
}

/** A JSON object parameter. */
function obj(v, what) {
  if (v === undefined || v === null || v === '') return {};
  if (typeof v === 'object' && !Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(String(v));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* falls through */
  }
  throw fail(400, (what || 'This parameter') + ' must be a JSON object, for example {"2026-09":1200}.', 'invalid_param');
}

/** Characters as a person counts them (code points, not UTF-16 units). */
function chars(s) {
  return Array.from(String(s || '')).length;
}

function words(s) {
  const t = String(s || '').trim();
  if (t === '') return 0;
  return t.split(/\s+/).length;
}

/** How many em dash characters (U+2014) a text holds: a count, like its length. */
function emDashes(s) {
  const t = String(s || '');
  let n = 0;
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 0x2014) n++;
  return n;
}

function clip(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** A json field's value as a plain JS value (`fallback` when empty). */
function json(record, field, fallback) {
  const raw = record.getString(field);
  if (raw === '' || raw === 'null') return fallback;
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function byId(app, collection, id) {
  if (typeof id !== 'string' || id === '') return null;
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

function findOne(app, collection, filter, params) {
  const r = app.findRecordsByFilter(collection, filter, '', 1, 0, params || {});
  return r.length > 0 ? r[0] : null;
}

function newRecord(app, collection) {
  return new Record(app.findCollectionByNameOrId(collection));
}

/** The absolute path of a stored file, for your AI agent to read from disk. */
function filePath(app, rec, field) {
  const name = rec.getString(field);
  if (name === '') return '';
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), name);
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

/**
 * A file on this machine named by path. Only your AI agent names files this
 * way (people upload); nothing inside the app's own folder except uploaded
 * files can be read, because that folder holds the database and the token.
 */
function localFile(ctx, path, name) {
  if (!ctx || ctx.isAgent !== true) throw fail(403, name + ' is for your AI agent; upload the file instead.', 'not_permitted', { param: name });
  let real = '';
  try {
    real = $filepath.clean($filepath.isAbs(path) ? path : $filepath.join($os.getwd(), path));
  } catch {
    throw fail(400, 'Give the absolute path of the file in --' + name + '.', 'invalid_param', { param: name });
  }
  const appDir = $filepath.clean($filepath.join(__hooks, '..', '..'));
  const uploads = $filepath.clean($filepath.join(__hooks, '..', 'pb_data', 'storage'));
  const sep = $filepath.join('a', 'b').charAt(1);
  const lower = String(real).toLowerCase();
  const under = (dir) => lower.indexOf(String(dir).toLowerCase() + sep) === 0;
  if ((under(appDir) || lower === String(appDir).toLowerCase()) && !under(uploads)) {
    throw fail(403, "Files inside the app's own folder cannot be attached.", 'not_permitted', { param: name });
  }
  try {
    if ($os.stat(real).isDir()) throw fail(400, '--' + name + ' is a folder, not a file: ' + path, 'invalid_param', { param: name });
  } catch (err) {
    if (err && err.status) throw err;
    throw fail(400, 'No file at --' + name + ' "' + path + '". Give the absolute path of the file.', 'invalid_param', { param: name });
  }
  return $filesystem.fileFromPath(real);
}

function uploaded(e, field) {
  try {
    return e.findUploadedFiles(field) || [];
  } catch {
    return [];
  }
}

/** Whole number with thousands separators (no lookahead regex: Goja mangles those). */
function thousands(n) {
  const neg = n < 0;
  const s = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (neg ? '-' : '') + out;
}

module.exports = {
  lib: lib,
  fail: fail,
  statusOf: statusOf,
  now: now,
  nearest: nearest,
  hash: hash,
  list: list,
  obj: obj,
  chars: chars,
  words: words,
  emDashes: emDashes,
  clip: clip,
  json: json,
  byId: byId,
  findOne: findOne,
  newRecord: newRecord,
  filePath: filePath,
  localFile: localFile,
  uploaded: uploaded,
  thousands: thousands,
};
