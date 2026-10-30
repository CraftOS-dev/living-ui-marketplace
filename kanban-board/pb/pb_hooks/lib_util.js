/// <reference path="../pb_data/types.d.ts" />
/**
 * Op plumbing: one handler shape, typed param readers, errors as JSON.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET, JSON
 * body for POST); the UI sends real JSON types and multipart forms. Every
 * reader accepts both and answers a 400 that names the param and shows a
 * valid example, so the caller can fix the call in one step.
 */

function fail(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra !== undefined) err.extra = extra;
  return err;
}

/** Run fn(params, app, e) and answer JSON; thrown {status} errors keep their code. */
function handle(e, fn) {
  try {
    const info = e.requestInfo();
    const params = {};
    const query = info.query || {};
    for (const k of Object.keys(query)) params[k] = query[k];
    const body = info.body || {};
    for (const k of Object.keys(body)) params[k] = body[k];
    const out = fn(params, e.app, e);
    return e.json(200, out === undefined ? { ok: true } : out);
  } catch (err) {
    const status = statusOf(err);
    if (status >= 500) console.error('[kanban-board] op failed:', err);
    // PocketBase's own error shape, so SDK clients surface the message; the
    // typed details ride along in `data` for callers that read them.
    const message = String((err && err.message) || err);
    const out = { status: status, message: message };
    if (err && err.extra !== undefined) out.data = err.extra;
    return e.json(status, out);
  }
}

/**
 * The HTTP status an error should answer with: our own fail() status, or the
 * status of a PocketBase API error raised inside a record hook; anything else
 * is 500.
 */
function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  try {
    const s = err && err.value ? err.value.status : undefined;
    if (typeof s === 'number' && s >= 400 && s < 500) return s;
  } catch {
    return 500;
  }
  return 500;
}

/** The agent name the agent-app CLI sends (X-A2App-Agent), or '' from the UI. */
function agentHeader(e) {
  try {
    const h = e.requestInfo().headers || {};
    return String(h['x_a2app_agent'] || '').trim();
  } catch {
    return '';
  }
}

/** True when the call came through the agent-app CLI (an AI agent), not the UI. */
function fromAgent(e) {
  return agentHeader(e) !== '';
}

/** Who is making this change: an AI agent (CLI) or the person in the app. */
function actor(e) {
  return fromAgent(e) ? 'agent' : 'you';
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
  if (typeof v !== 'string') throw fail(400, name + ' must be text');
  return v.trim();
}

function req(p, name, example) {
  const v = str(p, name, '');
  if (v === '') throw fail(400, name + ' is required' + (example ? ', e.g. ' + name + '=' + example : ''));
  return v;
}

function bool(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = scalar(p[name]);
  if (v === '') return dflt;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : v;
  if (s === true || s === 'true' || s === '1') return true;
  if (s === false || s === 'false' || s === '0') return false;
  throw fail(400, name + ' must be true or false');
}

function int(p, name, dflt, min, max) {
  if (!has(p, name) || scalar(p[name]) === '') return dflt;
  const raw = scalar(p[name]);
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw fail(400, name + ' must be a whole number from ' + min + ' to ' + max);
  }
  return n;
}

/** A plain number ("12", "2.5", "-3"); null when absent. */
function number(p, name, opts) {
  const o = opts || {};
  if (!has(p, name) || scalar(p[name]) === '') {
    if (o.required) throw fail(400, name + ' is required, e.g. ' + name + '=' + (o.example || '10'));
    return null;
  }
  const raw = scalar(p[name]);
  const n = typeof raw === 'number' ? raw : decimal(raw);
  if (n === null || !isFinite(n)) throw fail(400, name + ' must be a plain number with "." as the decimal point (got "' + raw + '")');
  if (o.min !== undefined && n < o.min) throw fail(400, name + ' must be at least ' + o.min);
  if (o.max !== undefined && n > o.max) throw fail(400, name + ' must be at most ' + o.max);
  return n;
}

function decimal(text) {
  const s = String(text).trim();
  if (!/^-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function oneOf(p, name, values, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (values.indexOf(v) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '));
  return v;
}

/** A JSON value: a real object/array, or (from the CLI) a JSON string. */
function json(p, name, example) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  // A multipart form field is a one-element list of the JSON text; a JSON
  // body's one-element list (["trim"]) is already the value.
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && /^\s*[[{]/.test(v[0])) v = v[0];
  if (typeof v === 'string') {
    if (v.trim() === '') return undefined;
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be JSON' + (example ? ', e.g. ' + name + "='" + example + "'" : ''));
    }
  }
  return v;
}

function obj(p, name, example) {
  const v = json(p, name, example);
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw fail(400, name + ' must be a JSON object' + (example ? ", e.g. '" + example + "'" : ''));
  return v;
}

function list(p, name, example) {
  const v = json(p, name, example);
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw fail(400, name + ' must be a JSON list' + (example ? ", e.g. '" + example + "'" : ''));
  return v;
}

/** A JSON field of a record as a value (null when empty). */
function getJson(rec, field) {
  const raw = rec.getString(field);
  if (raw === '' || raw === 'null') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- records */

function findOne(app, collection, filter, params) {
  const rows = app.findRecordsByFilter(collection, filter, '', 1, 0, params || {});
  return rows.length > 0 ? rows[0] : null;
}

function byId(app, collection, id) {
  if (typeof id !== 'string' || id === '') return null;
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

/** Collapse whitespace and trim: how names are compared and stored. */
function squash(s) {
  return String(s || '')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

/** A record id in PocketBase's own pattern (15 lowercase letters and digits). */
function newId() {
  return $security.randomStringWithAlphabet(15, 'abcdefghijklmnopqrstuvwxyz0123456789');
}

/** Rows of a raw SQL query. `shape` maps each column to its type: '' text, 0 int, -0 float. */
function rows(app, sql, shape, bind) {
  const out = arrayOf(new DynamicModel(shape));
  const q = app.db().newQuery(sql);
  if (bind) q.bind(bind);
  q.all(out);
  return out;
}

/** A path made absolute against the app's working folder. */
function absPath(p) {
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

/** The absolute path of a stored file (the agent reads it from disk). */
function filePath(app, rec, field) {
  const name = rec.getString(field);
  if (name === '') return '';
  return absPath($filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), name));
}

/** The URL the app serves a stored file at. */
function fileUrl(rec, field) {
  const name = rec.getString(field);
  if (name === '') return '';
  return '/api/files/' + rec.collection().name + '/' + rec.id + '/' + name;
}

/** A local file the agent named, checked before it is stored. */
function localFile(path, name) {
  try {
    if ($os.stat(path).isDir()) throw fail(400, name + ' is a folder, not a file: ' + path);
  } catch (err) {
    if (err && err.status) throw err;
    throw fail(400, 'No file at ' + name + ' "' + path + '". Give the absolute path of the file.');
  }
  return $filesystem.fileFromPath(path);
}

function uploaded(ev, field) {
  try {
    const files = ev.findUploadedFiles(field);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

function exists(path) {
  try {
    $os.stat(path);
    return true;
  } catch {
    return false;
  }
}

function readText(path) {
  try {
    return toString($os.readFile(path));
  } catch {
    return '';
  }
}

function now() {
  return new Date().toISOString();
}

/** A time as PocketBase stores dates ("2026-10-30 09:15:00.000Z"), for filters and fields. */
function pbTime(ms) {
  return new Date(ms === undefined ? Date.now() : ms).toISOString().replace('T', ' ');
}

/** Milliseconds of a stored date ('' and bad values are 0). */
function ms(v) {
  const s = String(v || '');
  if (s === '') return 0;
  const t = Date.parse(s.replace(' ', 'T'));
  return isFinite(t) ? t : 0;
}

/** A number as a person reads it: up to 4 decimals, no trailing zeros. */
function fmt(x) {
  if (x === null || x === undefined || !isFinite(x)) return String(x);
  let s = (Math.round(Number(x) * 10000) / 10000).toFixed(4);
  s = s.replace(/0+$/, '');
  if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
  return s === '-0' ? '0' : s;
}

/** Canonical JSON: object keys sorted, so equal values always hash equal. */
function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) {
      if (v[k] === undefined) continue;
      parts.push(JSON.stringify(k) + ':' + canonical(v[k]));
    }
    return '{' + parts.join(',') + '}';
  }
  if (typeof v === 'number') return isFinite(v) ? JSON.stringify(v) : 'null';
  return JSON.stringify(v);
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

module.exports = {
  fail: fail,
  handle: handle,
  agentHeader: agentHeader,
  fromAgent: fromAgent,
  pbTime: pbTime,
  ms: ms,
  actor: actor,
  has: has,
  str: str,
  req: req,
  bool: bool,
  int: int,
  number: number,
  decimal: decimal,
  oneOf: oneOf,
  json: json,
  obj: obj,
  list: list,
  getJson: getJson,
  findOne: findOne,
  byId: byId,
  squash: squash,
  newId: newId,
  rows: rows,
  absPath: absPath,
  filePath: filePath,
  fileUrl: fileUrl,
  localFile: localFile,
  uploaded: uploaded,
  exists: exists,
  readText: readText,
  now: now,
  fmt: fmt,
  canonical: canonical,
  plural: plural,
};
