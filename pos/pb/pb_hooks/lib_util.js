/// <reference path="../pb_data/types.d.ts" />
/**
 * Op plumbing: one handler shape, typed param readers, money and dates.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET, JSON
 * body for POST); the UI sends real JSON types and multipart forms. Every
 * reader accepts both and answers a 400 that names the param and shows a
 * valid example, so the caller can fix the call in one step.
 *
 * Errors carry a machine `code` next to the message (approval_required,
 * session_required, agent_not_permitted, total_changed...), so the UI acts
 * on the code and never on the wording.
 */

function fail(status, message, code, extra) {
  const err = new Error(message);
  err.status = status;
  if (code !== undefined) err.code = code;
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
    if (status >= 500) console.error('[pos] op failed:', err);
    const payload = { status: status, message: String((err && err.message) || err) };
    if (err && typeof err.code === 'string') payload.code = err.code;
    if (err && err.extra) for (const k of Object.keys(err.extra)) payload[k] = err.extra[k];
    return e.json(status, payload);
  }
}

/**
 * The HTTP status an error should answer with: our own fail() status, or the
 * status of a PocketBase API error raised inside a record hook; anything
 * else is 500.
 */
function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  try {
    const v = err && err.value ? err.value : undefined;
    const s = v !== undefined ? v.status : undefined;
    if (typeof s === 'number' && s >= 400 && s < 500) return s;
    // A field PocketBase refused (too long, wrong file type...): its
    // validation errors are a map of field errors with these methods.
    if (v !== undefined && typeof v.filter === 'function' && typeof v.marshalJSON === 'function') return 400;
  } catch {
    return 500;
  }
  return 500;
}

/* ------------------------------------------------------------ who calls */

function header(e, name) {
  try {
    return String(e.request.header.get(name) || '');
  } catch {
    return '';
  }
}

/**
 * True when the AI agent makes the call: it presents the app's agent token
 * (the agent-app CLI sends it as X-A2App-Token). The app's own pages never
 * see that token; they hold a session cookie instead, so a page cannot pass
 * itself off as the agent.
 */
function isAgent(e) {
  const presented = header(e, 'X-A2App-Token').trim();
  if (presented === '') return false;
  let token = '';
  try {
    token = toString($os.readFile($filepath.join(__hooks, '..', '..', '.agent-token'))).trim();
  } catch {
    return false;
  }
  return token !== '' && $security.equal(presented, token);
}

/* --------------------------------------------------------------- params */

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

function oneOf(p, name, values, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (values.indexOf(v) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '));
  return v;
}

/** JSON from the CLI (a string) or the UI (a real value). */
function parsed(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  // A multipart form field arrives as a one-element list holding the JSON
  // text; a real one-element list (one payment, one line) stays a list.
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string') {
    const t = v[0].trim();
    if (t === '' || t.charAt(0) === '[' || t.charAt(0) === '{') v = v[0];
  }
  if (typeof v === 'string') {
    if (v.trim() === '') return undefined;
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be valid JSON');
    }
  }
  return v;
}

/** A list: a real array, or (from the CLI) a JSON array string. */
function list(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  // A form field arrives as a one-element list holding the JSON text.
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && (v[0].trim() === '' || v[0].trim().charAt(0) === '[')) v = v[0];
  if (typeof v === 'string') {
    if (v.trim() === '') return [];
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON list, e.g. ["id1","id2"]');
    }
  }
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list');
  return v;
}

/** An object: a real object, or (from the CLI) a JSON object string. */
function obj(p, name) {
  const v = parsed(p, name);
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw fail(400, name + ' must be a JSON object');
  return v;
}

/* ---------------------------------------------------------------- money */

/**
 * Money arrives as text in the shop currency ("4.50", "1,234.50", "RM 4.50")
 * and is kept as an integer of minor units (cents, sen, yen). Parsed on the
 * string, never through a float. "," only separates thousands; "." is the
 * decimal point. More decimals than the currency has are refused.
 */
function toMinor(text, exp, allowNegative) {
  let s = String(text).trim().replace(/\s+/g, '');
  let neg = false;
  if (s.charAt(0) === '-' || s.charAt(0) === '−') {
    neg = true;
    s = s.slice(1);
  }
  // A currency sign or code in front is fine ("$4.25", "RM4.25", "¥500").
  s = s.replace(/^[^\d.]+/, '');
  if (s.charAt(0) === '-' || s.charAt(0) === '−') {
    neg = true;
    s = s.slice(1);
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(s) || s === '' || s === '.') return null;
  const parts = s.replace(/,/g, '').split('.');
  const whole = parts[0] === '' ? '0' : parts[0];
  let frac = parts.length > 1 ? parts[1] : '';
  if (frac.length > exp) return null;
  while (frac.length < exp) frac += '0';
  const n = Number(whole + frac);
  if (!Number.isSafeInteger(n)) return null;
  if (neg && !allowNegative) return null;
  return neg ? -n : n;
}

/** A money param in major units -> minor units; null when absent. */
function money(p, name, exp, opts) {
  const o = opts || {};
  const raw = str(p, name, '');
  if (raw === '') {
    if (o.required) throw fail(400, name + ' is required, e.g. ' + name + '=' + (exp === 0 ? '500' : '4.50'));
    return null;
  }
  const n = toMinor(raw, exp, o.allowNegative === true);
  if (n === null) {
    throw fail(
      400,
      name + ' must be an amount like ' + (exp === 0 ? '500' : '4.50') + ' with "." as the decimal point and at most ' + exp + ' decimals' + (o.allowNegative ? '' : ', not negative') + ' (got "' + raw + '")',
    );
  }
  if (Math.abs(n) > (o.max || 1000000000)) throw fail(400, name + ' is too large');
  return n;
}

/** Minor units -> plain text in major units ("4.50", "-1.20", "500"). */
function minorText(n, exp) {
  const neg = n < 0;
  let digits = String(Math.abs(Math.round(n)));
  if (exp === 0) return (neg ? '-' : '') + digits;
  while (digits.length <= exp) digits = '0' + digits;
  return (neg ? '-' : '') + digits.slice(0, digits.length - exp) + '.' + digits.slice(digits.length - exp);
}

/** "1,234.50" for messages. */
function moneyText(n, exp, currency) {
  const t = minorText(n, exp);
  const neg = t.charAt(0) === '-';
  const body = neg ? t.slice(1) : t;
  const parts = body.split('.');
  return (neg ? '-' : '') + (currency ? currency + ' ' : '') + group(parts[0]) + (parts.length > 1 ? '.' + parts[1] : '');
}

/** A percentage param ("10", "12.5") -> basis points (1000, 1250). */
function percent(p, name, dflt, max) {
  const raw = str(p, name, '');
  if (raw === '') return dflt;
  const s = raw.replace(/%$/, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw fail(400, name + ' must be a percentage like 10 or 12.5 (got "' + raw + '")');
  const parts = s.split('.');
  let frac = parts.length > 1 ? parts[1] : '';
  while (frac.length < 2) frac += '0';
  const bp = Number(parts[0]) * 100 + Number(frac);
  if (bp > (max === undefined ? 10000 : max)) throw fail(400, name + ' cannot be more than ' + (max === undefined ? 100 : max / 100) + '%');
  return bp;
}

/** Basis points -> "12.5". */
function bpText(bp) {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return whole + '.' + (frac < 10 ? '0' + frac : String(frac)).replace(/0$/, '');
}

/** Thousands grouping by hand (Goja mishandles the lookahead regex). */
function group(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/* ---------------------------------------------------------------- dates */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function dayOf(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Today's date on this machine (the app runs where the shop is). */
function today() {
  return dayOf(new Date());
}

/**
 * The trading day a moment belongs to: local time, minus the cutoff hour
 * (a bar open until 2 am with a 4 am cutoff keeps its late sales on the
 * evening they started).
 */
function businessDay(cutoffHour, when) {
  const d = when ? new Date(when.getTime()) : new Date();
  d.setHours(d.getHours() - (cutoffHour || 0));
  return dayOf(d);
}

function nowIso() {
  return new Date().toISOString();
}

/** A real calendar day 'YYYY-MM-DD' (rejects 2026-02-30). */
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
  if (!isDay(v)) throw fail(400, name + ' must be a real date written YYYY-MM-DD, e.g. ' + today());
  return v;
}

/** Day arithmetic on 'YYYY-MM-DD' strings (UTC math, no timezone drift). */
function addDays(dayStr, n) {
  const t = Date.UTC(Number(dayStr.slice(0, 4)), Number(dayStr.slice(5, 7)) - 1, Number(dayStr.slice(8, 10)));
  const d = new Date(t + n * 86400000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function daysBetween(a, b) {
  const ta = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const tb = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((tb - ta) / 86400000);
}

/** A PocketBase timestamp ('2026-10-07 01:59:15.344Z') as a Date. */
function parseTs(ts) {
  const t = Date.parse(String(ts).replace(' ', 'T'));
  return Number.isNaN(t) ? null : new Date(t);
}

/** Local hour (0-23) of a PocketBase timestamp. */
function localHour(ts) {
  const d = parseTs(ts);
  return d === null ? 0 : d.getHours();
}

/* -------------------------------------------------------------- records */

/** Find one record or null (PocketBase find helpers throw on no rows). */
function findOne(app, collection, filter, params) {
  const found = app.findRecordsByFilter(collection, filter, '', 1, 0, params || {});
  return found.length > 0 ? found[0] : null;
}

function byId(app, collection, id) {
  if (typeof id !== 'string' || id === '') return null;
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

/** Ids whose `column` equals `value` ignoring case (PocketBase "=" filters keep case). */
function idsNocase(app, table, column, value, limit) {
  return rows(app, 'SELECT id FROM {{' + table + '}} WHERE LOWER([[' + column + ']]) = LOWER({:v}) LIMIT ' + (limit || 5), { id: '' }, { v: String(value) }).map((x) => x.id);
}

/** Collapse whitespace and trim: how names are compared and stored. */
/** "1 product", "3 products" (or the given plural). */
function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many || one + 's');
}

function squash(s) {
  return String(s || '')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

/** Rows of a raw SQL query. `shape` maps each column to its type: '' text, 0 int, -0 float. */
function rows(app, sql, shape, bind) {
  const out = arrayOf(new DynamicModel(shape));
  const q = app.db().newQuery(sql);
  if (bind) q.bind(bind);
  q.all(out);
  return out;
}

/** One number from a SQL aggregate (wrap aggregates in IFNULL(..., 0)). */
function scalarSql(app, sql, bind) {
  const r = rows(app, sql, { v: 0 }, bind);
  return r.length > 0 ? r[0].v : 0;
}

/** A JSON field as a plain value (getString hands back the stored JSON text). */
function jsonOf(rec, field, dflt) {
  try {
    const text = rec.getString(field);
    if (text === '' || text === 'null') return dflt;
    return JSON.parse(text);
  } catch {
    return dflt;
  }
}

/** The first uploaded file in a multipart field, or null. */
function uploaded(ev, field) {
  try {
    const files = ev.findUploadedFiles(field);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
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

/** The absolute path of a stored file (the agent reads it from disk). */
function filePath(app, rec, field) {
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), rec.getString(field));
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

function lpad(s, width, ch) {
  let out = String(s);
  while (out.length < width) out = ch + out;
  return out;
}

/** A random opaque token (sessions, approvals, refs). */
function token(n) {
  return $security.randomString(n || 32);
}

function sha(text) {
  return $security.sha256(String(text));
}

module.exports = {
  fail: fail,
  handle: handle,
  header: header,
  isAgent: isAgent,
  has: has,
  str: str,
  req: req,
  bool: bool,
  int: int,
  oneOf: oneOf,
  parsed: parsed,
  list: list,
  obj: obj,
  toMinor: toMinor,
  money: money,
  minorText: minorText,
  moneyText: moneyText,
  percent: percent,
  bpText: bpText,
  group: group,
  pad: pad,
  dayOf: dayOf,
  today: today,
  businessDay: businessDay,
  nowIso: nowIso,
  isDay: isDay,
  day: day,
  addDays: addDays,
  daysBetween: daysBetween,
  parseTs: parseTs,
  localHour: localHour,
  findOne: findOne,
  byId: byId,
  idsNocase: idsNocase,
  plural: plural,
  squash: squash,
  rows: rows,
  scalarSql: scalarSql,
  jsonOf: jsonOf,
  uploaded: uploaded,
  localFile: localFile,
  filePath: filePath,
  lpad: lpad,
  token: token,
  sha: sha,
};
