/// <reference path="../pb_data/types.d.ts" />
/**
 * Plumbing shared by every operation: errors with machine codes, typed
 * parameter readers, record helpers, raw SQL and local files.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET,
 * JSON body for POST); the UI sends real JSON types and multipart forms.
 * Every reader accepts both and answers a 400 that names the param and shows
 * a valid example, so the caller can fix the call in one step.
 */

/**
 * An error the dispatcher answers with: HTTP status, a message for people,
 * a machine `code` the UI acts on (never the wording), and optional data.
 */
function fail(status, message, code, extra) {
  const err = new Error(message);
  err.status = status;
  err.code = code || (status === 400 ? 'invalid' : status === 404 ? 'not_found' : status === 403 ? 'forbidden' : status === 409 ? 'conflict' : 'error');
  if (extra !== undefined) err.extra = extra;
  return err;
}

/** The HTTP status for an error: ours, or a PocketBase API error raised in a hook. */
function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  try {
    const v = err && err.value ? err.value : undefined;
    const s = v !== undefined ? v.status : undefined;
    if (typeof s === 'number' && s >= 400 && s < 500) return s;
    if (v !== undefined && typeof v.filter === 'function' && typeof v.marshalJSON === 'function') return 400;
  } catch {
    return 500;
  }
  const msg = String((err && err.message) || err || '');
  if (msg.indexOf('UNIQUE constraint failed') >= 0) return 409;
  return 500;
}

function has(p, name) {
  return p[name] !== undefined && p[name] !== null;
}

/** Multipart form values arrive as one-element lists; unwrap them. */
function scalar(v) {
  if (Array.isArray(v) && v.length === 1) return v[0];
  return v;
}

function str(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = scalar(p[name]);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v !== 'string') throw fail(400, name + ' must be text', 'invalid_param', { param: name });
  return v.trim();
}

/** Text with a maximum length (longer is refused, not cut). Keeps inner whitespace and line breaks. */
function text(p, name, max, dflt) {
  if (!has(p, name)) return dflt;
  const v0 = scalar(p[name]);
  const v = typeof v0 === 'number' || typeof v0 === 'boolean' ? String(v0) : v0;
  if (typeof v !== 'string') throw fail(400, name + ' must be text', 'invalid_param', { param: name });
  const t = v.replace(/\r\n/g, '\n').trim();
  if (t.length > max) throw fail(400, name + ' is too long (at most ' + max + ' characters)', 'invalid_param', { param: name });
  return t;
}

function req(p, name, example) {
  const v = str(p, name, '');
  if (v === '') throw fail(400, name + ' is required' + (example ? ', e.g. --' + name + ' ' + example : ''), 'missing_param', { param: name });
  return v;
}

function bool(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = scalar(p[name]);
  if (v === '') return dflt;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : v;
  if (s === true || s === 'true' || s === '1') return true;
  if (s === false || s === 'false' || s === '0') return false;
  throw fail(400, name + ' must be true or false', 'invalid_param', { param: name });
}

function int(p, name, dflt, min, max) {
  if (!has(p, name) || scalar(p[name]) === '') return dflt;
  const raw = scalar(p[name]);
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw fail(400, name + ' must be a whole number from ' + min + ' to ' + max, 'invalid_param', { param: name });
  }
  return n;
}

function num(p, name, dflt, min, max) {
  if (!has(p, name) || scalar(p[name]) === '') return dflt;
  const raw = scalar(p[name]);
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < min || n > max) throw fail(400, name + ' must be a number from ' + min + ' to ' + max, 'invalid_param', { param: name });
  return n;
}

function oneOf(p, name, values, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (values.indexOf(v) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '), 'invalid_param', { param: name });
  return v;
}

/**
 * A value inside a JSON parameter that must be one of a few: absent gives the
 * default, a wrong one is refused with the allowed values (never quietly
 * replaced, so a caller learns its mistake).
 */
function choice(value, values, dflt, where, param) {
  if (value === undefined || value === null || value === '') return dflt;
  const v = String(value);
  if (values.indexOf(v) < 0) throw fail(400, where + ' must be one of: ' + values.join(', ') + ' (not "' + v.slice(0, 40) + '").', 'invalid_param', { param: param });
  return v;
}

/** A list: a real array, or (from the CLI) a JSON array string. */
function list(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && (v[0].trim() === '' || v[0].trim().charAt(0) === '[')) v = v[0];
  if (typeof v === 'string') {
    if (v.trim() === '') return [];
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON list, e.g. ["id1","id2"]', 'invalid_param', { param: name });
    }
  }
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list', 'invalid_param', { param: name });
  return v;
}

/** A list of ids (strings): a JSON list, or one id. */
function ids(p, name, max) {
  if (!has(p, name)) return [];
  const raw = scalar(p[name]);
  let v;
  // One id, ids separated by commas or spaces (record ids never hold either), or a JSON list.
  if (typeof raw === 'string' && raw.trim().charAt(0) !== '[') v = raw.trim() === '' ? [] : raw.trim().split(/[\s,]+/);
  else v = list(p, name);
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string' || x.trim() === '') throw fail(400, name + ' must be a list of ids (text)', 'invalid_param', { param: name });
    if (out.indexOf(x.trim()) < 0) out.push(x.trim());
  }
  if (out.length > (max || 500)) throw fail(400, name + ' takes at most ' + (max || 500) + ' ids', 'invalid_param', { param: name });
  return out;
}

/**
 * The keys one item of a JSON list may carry. An unknown key is refused
 * (a misspelt key would otherwise be left out silently), with the closest
 * allowed key and the full list: `keysOnly(raw, ['page', 'lines'], 'Item 2')`.
 */
function keysOnly(raw, allowed, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw fail(400, where + ' must be an object with: ' + allowed.join(', '), 'invalid_param');
  for (const k of Object.keys(raw)) {
    if (allowed.indexOf(k) >= 0) continue;
    const near = nearest(k, allowed);
    throw fail(400, where + ': unknown key "' + k + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. It takes: ' + allowed.join(', ') + '.', 'unknown_key', { key: k });
  }
}

/** The allowed name closest to a mistyped one ("" when none is close). */
function nearest(name, allowed) {
  const n = String(name).toLowerCase();
  let best = '';
  let bestD = 3;
  for (const a of allowed) {
    const x = a.toLowerCase();
    if (n.length >= 3 && (x.indexOf(n) >= 0 || n.indexOf(x) >= 0)) return a;
    const d = editDistance(n, x);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

function editDistance(a, b) {
  const row = [];
  for (let j = 0; j <= b.length; j++) row.push(j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** An object: a real object, or (from the CLI) a JSON object string. */
function obj(p, name) {
  if (!has(p, name)) return undefined;
  let v = scalar(p[name]);
  if (typeof v === 'string') {
    if (v.trim() === '') return {};
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON object', 'invalid_param', { param: name });
    }
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw fail(400, name + ' must be a JSON object', 'invalid_param', { param: name });
  return v;
}

/* ------------------------------------------------------------- dates */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Today on this machine. */
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function nowIso() {
  return new Date().toISOString();
}

function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function day(p, name, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (!isDay(v)) throw fail(400, name + ' must be a real date written YYYY-MM-DD, e.g. ' + today(), 'invalid_param', { param: name });
  return v;
}

/** A PocketBase timestamp as milliseconds (NaN when empty). */
function ms(ts) {
  return Date.parse(String(ts || '').replace(' ', 'T'));
}

/* ------------------------------------------------------------ records */

function findOne(app, collection, filter, params) {
  const r = app.findRecordsByFilter(collection, filter, '', 1, 0, params || {});
  return r.length > 0 ? r[0] : null;
}

function byId(app, collection, id) {
  if (typeof id !== 'string' || id === '') return null;
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

function newRecord(app, collection) {
  return new Record(app.findCollectionByNameOrId(collection));
}

/** Rows of a raw SQL query. `shape` maps each column to its type: '' text, 0 int, -0 float, false bool. */
function rows(app, sql, shape, bind) {
  const out = arrayOf(new DynamicModel(shape));
  const q = app.db().newQuery(sql);
  if (bind) q.bind(bind);
  q.all(out);
  return out;
}

function one(app, sql, shape, bind) {
  const r = rows(app, sql, shape, bind);
  return r.length > 0 ? r[0] : null;
}

function count(app, sql, bind) {
  const r = one(app, sql, { n: 0 }, bind);
  return r === null ? 0 : r.n;
}

function exec(app, sql, bind) {
  const q = app.db().newQuery(sql);
  if (bind) q.bind(bind);
  return q.execute();
}

/** Plain objects from rows (host objects cannot take new fields). */
function plain(list) {
  const out = [];
  for (const r of list) out.push(JSON.parse(JSON.stringify(r)));
  return out;
}

/** Collapse whitespace and trim: how names are compared and stored. */
function squash(s) {
  return String(s || '')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

function token(n) {
  return $security.randomString(n || 32);
}

/** A json field's value as a JS value (null when empty). */
function jsonOf(rec, field) {
  const raw = rec.getString(field);
  if (raw === '' || raw === 'null') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The absolute path of a stored file (your AI agent reads it from disk). */
function filePath(app, rec, field) {
  const name = rec.getString(field);
  if (name === '') return '';
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), name);
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

/**
 * A file on this machine named by path. Only your AI agent may name one (it
 * attaches files from its own workspace or its downloads); people upload.
 * Inside the app's own folder only the uploaded files (pb_data/storage) are
 * read this way: the rest holds the database, the agent token and keys.
 */
function localFile(ctx, path, name) {
  if (!ctx || ctx.isAgent !== true) throw fail(403, name + ' is for your AI agent; upload the file instead.', 'not_permitted', { param: name });
  let real = '';
  try {
    real = $filepath.clean($filepath.isAbs(path) ? path : $filepath.join($os.getwd(), path));
  } catch {
    throw fail(400, 'Give the absolute path of the file in ' + name + '.', 'invalid_param', { param: name });
  }
  const appDir = $filepath.clean($filepath.join(__hooks, '..', '..'));
  const uploads = $filepath.clean($filepath.join(__hooks, '..', 'pb_data', 'storage'));
  const sep = $filepath.join('a', 'b').charAt(1);
  const under = (dir) => String(real).toLowerCase().indexOf(String(dir).toLowerCase() + sep) === 0;
  if ((under(appDir) || String(real).toLowerCase() === String(appDir).toLowerCase()) && !under(uploads)) {
    throw fail(403, "Files inside the app's own folder cannot be attached.", 'not_permitted', { param: name });
  }
  try {
    if ($os.stat(real).isDir()) throw fail(400, name + ' is a folder, not a file: ' + path, 'invalid_param', { param: name });
  } catch (err) {
    if (err && err.status) throw err;
    throw fail(400, 'No file at ' + name + ' "' + path + '". Give the absolute path of the file.', 'invalid_param', { param: name });
  }
  return { file: $filesystem.fileFromPath(real), path: real };
}

function uploadedAll(ev, field) {
  try {
    return ev.findUploadedFiles(field) || [];
  } catch {
    return [];
  }
}

/** Page window from limit/offset params. */
function page(p, dflt, max) {
  return { limit: int(p, 'limit', dflt || 50, 1, max || 500), offset: int(p, 'offset', 0, 0, 100000000) };
}

/** LIKE pattern for a search term (escaped with backslash). */
function like(q) {
  return '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

/** A stable 64-hex hash of text. */
function sha(textValue) {
  return $security.sha256(String(textValue));
}

module.exports = {
  fail: fail,
  statusOf: statusOf,
  has: has,
  scalar: scalar,
  str: str,
  text: text,
  req: req,
  bool: bool,
  int: int,
  num: num,
  oneOf: oneOf,
  choice: choice,
  list: list,
  ids: ids,
  keysOnly: keysOnly,
  nearest: nearest,
  editDistance: editDistance,
  obj: obj,
  pad: pad,
  today: today,
  nowIso: nowIso,
  isDay: isDay,
  day: day,
  ms: ms,
  findOne: findOne,
  byId: byId,
  newRecord: newRecord,
  rows: rows,
  one: one,
  count: count,
  exec: exec,
  plain: plain,
  squash: squash,
  token: token,
  jsonOf: jsonOf,
  filePath: filePath,
  localFile: localFile,
  uploadedAll: uploadedAll,
  page: page,
  like: like,
  sha: sha,
};
