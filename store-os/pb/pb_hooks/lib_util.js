/// <reference path="../pb_data/types.d.ts" />
/**
 * Small helpers every module uses: errors with a machine code, parameter
 * parsing, text measures, money in minor units, dates and a cached require.
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


/* -------------------------------------------------------------------- sql */

/**
 * Rows of a raw query as plain objects. `shape` names each column with an
 * example value ('' text, 0 whole number, -0 decimal, false yes/no); wrap
 * SUM/MIN/MAX in COALESCE so an empty table never scans NULL into a number.
 */
function rows(app, query, params, shape) {
  const result = arrayOf(new DynamicModel(shape));
  app.db().newQuery(query).bind(params || {}).all(result);
  const keys = Object.keys(shape);
  const out = [];
  for (let i = 0; i < result.length; i++) {
    const o = {};
    for (const k of keys) o[k] = result[i][k];
    out.push(o);
  }
  return out;
}

/** A single number from a query that selects one column named n. */
function count(app, query, params) {
  const r = rows(app, query, params, { n: 0 });
  return r.length > 0 ? Number(r[0].n || 0) : 0;
}

/* ------------------------------------------------------------------ money */

/** Decimal places of a currency (ISO 4217); 2 unless listed. */
const EXP = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0, PYG: 0, XAF: 0, XOF: 0, KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3 };

function exp(cur) {
  const e = EXP[String(cur || '').toUpperCase()];
  return e === undefined ? 2 : e;
}

/** A major-unit amount (59.9, "1,299.00") as an integer of minor units of `cur`. */
function toMinor(v, cur, what) {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim().split(',').join(''));
  if (!Number.isFinite(n)) throw fail(400, (what || 'The amount') + ' must be a number, for example 59.90.', 'invalid_param');
  return Math.round(n * Math.pow(10, exp(cur)));
}

/** Minor units as a major-unit number (exact to the currency's decimals). */
function toMajor(minor, cur) {
  const e = exp(cur);
  return Number((Number(minor || 0) / Math.pow(10, e)).toFixed(e));
}

/** "MYR 1,299.00" for messages and activity lines. */
function fmt(minor, cur) {
  const e = exp(cur);
  const neg = Number(minor) < 0;
  const abs = Math.abs(Number(minor || 0));
  const whole = Math.floor(abs / Math.pow(10, e));
  const frac = abs - whole * Math.pow(10, e);
  let s = thousands(whole);
  if (e > 0) s += '.' + String(frac).padStart(e, '0');
  return (neg ? '-' : '') + (cur ? String(cur).toUpperCase() + ' ' : '') + s;
}

/** A whole number parameter (counts, stock). */
function int(v, what) {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim().split(',').join(''));
  if (!Number.isFinite(n) || Math.round(n) !== n) throw fail(400, (what || 'This value') + ' must be a whole number.', 'invalid_param');
  return n;
}

/* ------------------------------------------------------------------ dates */

/** Today as YYYY-MM-DD (UTC). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A date or date-time parameter as ISO text ('' when empty). Accepts ISO,
 * "YYYY-MM-DD", "YYYY-MM-DD HH:MM", "DD/MM/YYYY" and "DD/MM/YYYY HH:MM"
 * (seller-centre exports write days first).
 */
function isoDate(v, what) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s.indexOf(' ') > 0 && s.indexOf('T') < 0 ? s.replace(' ', 'T') : s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw fail(400, (what || 'The date') + ' must be a date, for example 2026-10-30 or 2026-10-30T14:05:00Z.', 'invalid_param');
}

/** ISO time `days` days after `iso` (now when empty). */
function addDays(iso, days) {
  const base = iso ? new Date(iso) : new Date();
  return new Date(base.getTime() + days * 86400000).toISOString();
}

/** Hours from now until `iso` (negative when past); null when empty. */
function hoursUntil(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (t - Date.now()) / 3600000;
}

/** One value from a list of allowed ones, or a clear refusal. */
function oneOf(v, allowed, what) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (allowed.indexOf(s) < 0) throw fail(400, (what || 'This value') + ' must be one of: ' + allowed.join(', ') + '.', 'invalid_param');
  return s;
}

/** Plain digits and letters of a SKU or code, for matching across shops. */
function skuKey(s) {
  return String(s || '').trim().toLowerCase();
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
  rows: rows,
  count: count,
  exp: exp,
  toMinor: toMinor,
  toMajor: toMajor,
  fmt: fmt,
  int: int,
  today: today,
  isoDate: isoDate,
  addDays: addDays,
  hoursUntil: hoursUntil,
  oneOf: oneOf,
  skuKey: skuKey,
};
