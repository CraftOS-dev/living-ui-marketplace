/// <reference path="../pb_data/types.d.ts" />
/**
 * Plumbing shared by every operation: errors with machine codes, typed
 * parameter readers, dates, record helpers and raw SQL.
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

/** Text with a maximum length (longer is refused, not cut). */
function text(p, name, max, dflt) {
  const v = str(p, name, dflt);
  if (v === undefined) return v;
  if (v.length > max) throw fail(400, name + ' is too long (at most ' + max + ' characters)', 'invalid_param', { param: name });
  return v;
}

function req(p, name, example) {
  const v = str(p, name, '');
  if (v === '') throw fail(400, name + ' is required' + (example ? ', e.g. ' + name + '=' + example : ''), 'missing_param', { param: name });
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

function oneOf(p, name, values, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (values.indexOf(v) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '), 'invalid_param', { param: name });
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
      throw fail(400, name + ' must be a JSON list, e.g. [{"item":"SKU-00001","qty":2}]', 'invalid_param', { param: name });
    }
  }
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list', 'invalid_param', { param: name });
  return v;
}

/**
 * The keys one item of a JSON list may carry. An unknown key is refused
 * (a misspelt "price" would otherwise leave the price out silently), with the
 * closest allowed key and the full list: `keysOnly(raw, ['item', 'qty'], 'Line 2')`.
 */
function keysOnly(raw, allowed, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
  for (const k of Object.keys(raw)) {
    if (allowed.indexOf(k) >= 0) continue;
    const near = nearest(k, allowed);
    throw fail(400, where + ': unknown key "' + k + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. It takes: ' + allowed.join(', ') + '.', 'unknown_key', { key: k });
  }
}

/** The allowed name closest to a mistyped one ("" when none is close): contains it, or is a short edit away. */
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

/* ------------------------------------------------------------ numbers */

/** A money amount in `currency` -> minor units (null when absent). */
function money(p, name, currency, opts) {
  const o = opts || {};
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) {
    if (o.required) throw fail(400, name + ' is required, e.g. ' + name + '=1250.00', 'missing_param', { param: name });
    return null;
  }
  const m = require(`${__hooks}/lib_money.js`);
  const v = m.toMinor(typeof raw === 'number' ? String(raw) : raw, currency, o.allowNegative === true);
  if (v === null) {
    const code = m.codeOf(raw);
    if (code !== '' && code !== String(currency).toUpperCase()) {
      throw fail(400, name + ' is in ' + currency + ', but "' + raw + '" names ' + code + '. Give the amount in ' + currency + ', e.g. 1250.00.', 'invalid_amount', { param: name });
    }
    throw fail(
      400,
      name + ' must be an amount in ' + currency + ' with "." as the decimal point and up to ' + m.exp(currency) + ' decimals, e.g. 1250.00 (got "' + raw + '")',
      'invalid_amount',
      { param: name },
    );
  }
  if (o.positive && v <= 0) throw fail(400, name + ' must be more than 0', 'invalid_amount', { param: name });
  return v;
}

/** A unit price or cost -> e4 (null when absent). */
function price(p, name, opts) {
  const o = opts || {};
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) {
    if (o.required) throw fail(400, name + ' is required, e.g. ' + name + '=12.50', 'missing_param', { param: name });
    return null;
  }
  const v = require(`${__hooks}/lib_money.js`).toE4(typeof raw === 'number' ? String(raw) : raw, false);
  if (v === null) throw fail(400, name + ' must be a plain positive number with up to 4 decimals, e.g. 12.50 or 0.034 (got "' + raw + '")', 'invalid_amount', { param: name });
  return v;
}

/** An exchange rate -> e8 (null when absent). */
function rate(p, name) {
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) return null;
  const v = require(`${__hooks}/lib_money.js`).toE8(typeof raw === 'number' ? String(raw) : raw);
  if (v === null) throw fail(400, name + ' must be a positive number, e.g. 4.4567 (base units for one unit of the currency)', 'invalid_param', { param: name });
  return v;
}

/** A percentage -> basis points (null when absent). */
function percent(p, name, max) {
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) return null;
  const v = require(`${__hooks}/lib_money.js`).percentToBp(typeof raw === 'number' ? String(raw) : raw);
  if (v === null || v > (max === undefined ? 10000 : max)) throw fail(400, name + ' must be a percentage like 6 or 6.5', 'invalid_param', { param: name });
  return v;
}

function q3(x) {
  return Math.round(Number(x) * 1000) / 1000;
}

/** "12", "1.5", ".25", "-3" -> number; null when it is not a plain decimal. */
function decimal(textValue) {
  const s = String(textValue).trim().replace(/,/g, '');
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A quantity param. opts: required, positive, allowNegative, whole, label. null when absent. */
function qty(p, name, opts) {
  const o = opts || {};
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined || raw === null) {
    if (o.required) throw fail(400, name + ' is required, e.g. ' + name + '=12', 'missing_param', { param: name });
    return null;
  }
  const n = typeof raw === 'number' ? raw : decimal(raw);
  if (n === null || !Number.isFinite(n)) throw fail(400, name + ' must be a plain number with "." as the decimal point, e.g. 12 or 2.5 (got "' + raw + '")', 'invalid_param', { param: name });
  return checkQty(n, name, o);
}

function qtyOf(value, name, opts) {
  const p = {};
  p[name] = value === undefined || value === null ? '' : value;
  return qty(p, name, opts);
}

function checkQty(n, name, o) {
  const opts = o || {};
  if (Math.abs(n) > 1e9) throw fail(400, name + ' is too large', 'invalid_param', { param: name });
  if (opts.positive && !(n > 0)) throw fail(400, name + ' must be more than 0', 'invalid_param', { param: name });
  if (!opts.allowNegative && n < 0) throw fail(400, name + ' cannot be negative', 'invalid_param', { param: name });
  if (opts.whole && !Number.isInteger(n)) throw fail(400, (opts.label || 'This item') + ' is counted in whole units, so ' + name + ' must be a whole number (got ' + n + ')', 'invalid_param', { param: name });
  if (Math.abs(q3(n) - n) > 1e-9) throw fail(400, name + ' can have at most 3 decimals', 'invalid_param', { param: name });
  return q3(n);
}

/** 1234.5 -> "1,234.5" (for messages). */
function fmtQty(n) {
  const v = q3(n);
  const neg = v < 0;
  const parts = String(Math.abs(v)).split('.');
  return (neg ? '-' : '') + require(`${__hooks}/lib_money.js`).group(parts[0]) + (parts.length > 1 ? '.' + parts[1] : '');
}

/* ------------------------------------------------------------- dates */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Today on this machine (the app runs where its people are). */
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

function isMonth(v) {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

function monthParam(p, name, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (!isMonth(v)) throw fail(400, name + ' must be a month written YYYY-MM, e.g. ' + today().slice(0, 7), 'invalid_param', { param: name });
  return v;
}

function utc(dayStr) {
  return Date.UTC(Number(dayStr.slice(0, 4)), Number(dayStr.slice(5, 7)) - 1, Number(dayStr.slice(8, 10)));
}

function fromUtc(t) {
  const d = new Date(t);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function addDays(dayStr, n) {
  return fromUtc(utc(dayStr) + n * 86400000);
}

function daysBetween(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/** Day of week, 1 = Monday ... 7 = Sunday. */
function weekday(dayStr) {
  const w = new Date(utc(dayStr)).getUTCDay();
  return w === 0 ? 7 : w;
}

function monthOf(dayStr) {
  return dayStr.slice(0, 7);
}

function monthStart(m) {
  return m + '-01';
}

function monthEnd(m) {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return m + '-' + pad(new Date(Date.UTC(y, mo, 0)).getUTCDate());
}

function addMonths(m, n) {
  let y = Number(m.slice(0, 4));
  let mo = Number(m.slice(5, 7)) - 1 + n;
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  return y + '-' + pad(mo + 1);
}

/** Months from a to b inclusive ('YYYY-MM'). */
function monthsBetween(a, b) {
  const out = [];
  let m = a;
  let guard = 0;
  while (m <= b && guard < 1200) {
    out.push(m);
    m = addMonths(m, 1);
    guard++;
  }
  return out;
}

/** A PocketBase timestamp as this machine's local day. */
function localDay(ts) {
  const t = Date.parse(String(ts).replace(' ', 'T'));
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** The UTC timestamp (PocketBase style) where local day `dayStr` starts. */
function dayStartTs(dayStr) {
  const d = new Date(Number(dayStr.slice(0, 4)), Number(dayStr.slice(5, 7)) - 1, Number(dayStr.slice(8, 10)));
  return d.toISOString().replace('T', ' ');
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

/** True when another record has `value` in `column`, ignoring case. */
function idsNocaseFind(app, table, column, value, exceptId) {
  const r = rows(app, 'SELECT id FROM ' + table + ' WHERE LOWER([[' + column + ']]) = LOWER({:v}) AND id != {:x} LIMIT 1', { id: '' }, { v: String(value), x: exceptId || '' });
  return r.length > 0;
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

function exec(app, sql, bind) {
  const q = app.db().newQuery(sql);
  if (bind) q.bind(bind);
  return q.execute();
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

function sha(textValue) {
  return $security.sha256(String(textValue));
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

/** The absolute path of a stored file (the agent reads it from disk). */
function filePath(app, rec, field) {
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), rec.getString(field));
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

/** A local file the agent named, checked before it is stored. */
/**
 * A file on this machine named by path. Only your AI agent may name one (it
 * attaches files from its own workspace, or a file people dropped in the
 * Inbox); people upload. Inside the app's own folder only the uploaded files
 * (pb_data/storage) are read this way: the rest holds the database, the
 * agent token and the server's keys.
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
  return $filesystem.fileFromPath(real);
}

function uploaded(ev, field) {
  try {
    const files = ev.findUploadedFiles(field);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

function uploadedAll(ev, field) {
  try {
    return ev.findUploadedFiles(field) || [];
  } catch {
    return [];
  }
}

/** A file from an upload field or a local --path the agent gives. */
function fileParam(ctx, p, field, pathParam) {
  const f = ctx.e ? uploaded(ctx.e, field) : null;
  if (f !== null) return f;
  const path = str(p, pathParam || 'path', '');
  if (path !== '') return localFile(ctx, path, pathParam || 'path');
  return null;
}

/** Page window from limit/offset params. */
function page(p, dflt, max) {
  return { limit: int(p, 'limit', dflt || 50, 1, max || 500), offset: int(p, 'offset', 0, 0, 100000000) };
}

/** LIKE pattern for a search term (escaped). */
function like(q) {
  return '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

module.exports = {
  fail: fail,
  keysOnly: keysOnly,
  nearest: nearest,
  editDistance: editDistance,
  statusOf: statusOf,
  has: has,
  scalar: scalar,
  str: str,
  text: text,
  req: req,
  bool: bool,
  int: int,
  oneOf: oneOf,
  list: list,
  obj: obj,
  money: money,
  price: price,
  rate: rate,
  percent: percent,
  q3: q3,
  decimal: decimal,
  qty: qty,
  qtyOf: qtyOf,
  checkQty: checkQty,
  fmtQty: fmtQty,
  pad: pad,
  today: today,
  nowIso: nowIso,
  isDay: isDay,
  day: day,
  isMonth: isMonth,
  monthParam: monthParam,
  addDays: addDays,
  daysBetween: daysBetween,
  weekday: weekday,
  monthOf: monthOf,
  monthStart: monthStart,
  monthEnd: monthEnd,
  addMonths: addMonths,
  monthsBetween: monthsBetween,
  localDay: localDay,
  dayStartTs: dayStartTs,
  findOne: findOne,
  byId: byId,
  idsNocaseFind: idsNocaseFind,
  newRecord: newRecord,
  rows: rows,
  one: one,
  exec: exec,
  squash: squash,
  token: token,
  sha: sha,
  jsonOf: jsonOf,
  filePath: filePath,
  localFile: localFile,
  uploaded: uploaded,
  uploadedAll: uploadedAll,
  fileParam: fileParam,
  page: page,
  like: like,
};
