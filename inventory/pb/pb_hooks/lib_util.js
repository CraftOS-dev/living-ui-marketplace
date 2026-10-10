/// <reference path="../pb_data/types.d.ts" />
/**
 * Op plumbing: one handler shape, typed param readers, errors as JSON.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET, JSON
 * body for POST); the UI sends real JSON types and multipart forms. Every
 * reader accepts both and answers a 400 that names the param and shows a
 * valid example, so the caller can fix the call in one step.
 */

function fail(status, message, agentHint) {
  const err = new Error(message);
  err.status = status;
  if (agentHint !== undefined) err.agentHint = agentHint;
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
    if (status >= 500) console.error('[inventory] op failed:', err);
    // PocketBase's own error shape, so SDK clients surface the message. A hint
    // meant for agents (a CLI param to use) is added only for agent calls.
    let message = String((err && err.message) || err);
    if (err && typeof err.agentHint === 'string' && fromAgent(e)) message += ' ' + err.agentHint;
    return e.json(status, { status: status, message: message });
  }
}

/**
 * The HTTP status an error should answer with: our own fail() status, or the
 * status of a PocketBase API error raised inside a record hook (a rule a
 * save broke, e.g. BadRequestError from hooks.pb.js); anything else is 500.
 */
function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  try {
    const v = err && err.value ? err.value : undefined;
    const s = v !== undefined ? v.status : undefined;
    if (typeof s === 'number' && s >= 400 && s < 500) return s;
    // A field PocketBase refused (too long, wrong file type...): its validation
    // errors are a map of field errors with these methods.
    if (v !== undefined && typeof v.filter === 'function' && typeof v.marshalJSON === 'function') return 400;
  } catch {
    return 500;
  }
  return 500;
}

/** True when the call came through the agent-app CLI (the AI agent), not the UI. */
function fromAgent(e) {
  try {
    const h = e.requestInfo().headers || {};
    return String(h['x_a2app_agent'] || '') !== '';
  } catch {
    return false;
  }
}

/** Who is making this change: the AI agent (CLI) or the person in the app. */
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

function oneOf(p, name, values, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (values.indexOf(v) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '));
  return v;
}

/** A list: a real array, or (from the CLI) a JSON array string. */
function list(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  // A form field arrives as a one-element list holding the JSON text; a real
  // one-element list (["SKU-0001"]) stays a list.
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

/* --------------------------------------------------------------- numbers */

/** Round a quantity to 3 decimals (quantities are kept to the gram). */
function q3(x) {
  return Math.round(Number(x) * 1000) / 1000;
}

/** "12", "1.5", ".25" -> number; null when it is not a plain decimal. */
function decimal(text) {
  const s = String(text).trim();
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A quantity param. opts: required, plus the checkQty options. null when absent. */
function qty(p, name, opts) {
  const o = opts || {};
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) {
    if (o.required) throw fail(400, name + ' is required, e.g. ' + name + '=12');
    return null;
  }
  const n = typeof raw === 'number' ? raw : decimal(raw);
  if (n === null || !Number.isFinite(n)) {
    throw fail(400, name + ' must be a plain number with "." as the decimal point, e.g. 12 or 2.5 (got "' + raw + '")');
  }
  return checkQty(n, name, o);
}

/** A quantity given as a value (a list entry), named `name` in messages. */
function qtyOf(value, name, opts) {
  const p = {};
  p[name] = value === undefined || value === null ? '' : value;
  return qty(p, name, opts);
}

/** A unit cost given as a value (a list entry); null when empty. */
function costOf(value, name) {
  const p = {};
  p[name] = value === undefined || value === null ? '' : String(value);
  return cost(p, name);
}

/** opts: positive (must be > 0), allowNegative, fractional (false: whole units only), label. */
function checkQty(n, name, o) {
  const opts = o || {};
  if (Math.abs(n) > 1e9) throw fail(400, name + ' is too large');
  if (opts.positive && !(n > 0)) throw fail(400, name + ' must be more than 0');
  if (!opts.allowNegative && n < 0) throw fail(400, name + ' cannot be negative');
  if (opts.fractional === false && !Number.isInteger(n)) {
    throw fail(400, (opts.label || 'This item') + ' is counted in whole units, so ' + name + ' must be a whole number (got ' + n + ')');
  }
  if (Math.abs(q3(n) - n) > 1e-9) throw fail(400, name + ' can have at most 3 decimals');
  return q3(n);
}

/**
 * A unit cost in major units ("0.034", "12.5") -> integer ten-thousandths.
 * Parsed on the string, never through a float. null when absent.
 */
function cost(p, name) {
  const raw = str(p, name, '');
  if (raw === '') return null;
  // A currency sign in front is fine ("$4.25"); a minus is not.
  const lead = (raw.match(/^[^\d.]*/) || [''])[0];
  if (lead.indexOf('-') >= 0) throw fail(400, name + ' cannot be negative (got "' + raw + '")');
  const s = raw.slice(lead.length);
  const e4 = toE4(s);
  if (e4 === null) {
    throw fail(400, name + ' must be a plain positive number with "." as the decimal point, e.g. 4.25 or 0.034 (got "' + raw + '")');
  }
  return e4;
}

function toE4(text) {
  const s = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const parts = s.split('.');
  const whole = parts[0] === '' ? '0' : parts[0];
  let frac = parts.length > 1 ? parts[1] : '';
  let roundUp = false;
  if (frac.length > 4) {
    roundUp = Number(frac.charAt(4)) >= 5;
    frac = frac.slice(0, 4);
  }
  while (frac.length < 4) frac += '0';
  let n = Number(whole + frac);
  if (roundUp) n += 1;
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/** Ten-thousandths -> "12.5" style plain text with at least the currency's decimals. */
function e4ToText(e4, exp) {
  const neg = e4 < 0;
  const abs = lpad(String(Math.abs(Math.round(e4))), 5, '0');
  let whole = abs.slice(0, abs.length - 4);
  let frac = abs.slice(abs.length - 4);
  while (frac.length > exp && frac.charAt(frac.length - 1) === '0') frac = frac.slice(0, -1);
  if (whole === '') whole = '0';
  return (neg ? '-' : '') + whole + (frac !== '' ? '.' + frac : '');
}

/** Left-pad text to `width` with `ch`. */
function lpad(s, width, ch) {
  let out = String(s);
  while (out.length < width) out = ch + out;
  return out;
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

/** 1234.5 -> "1,234.5" (for human-readable op messages). */
function fmtQty(n) {
  const v = q3(n);
  const neg = v < 0;
  const parts = String(Math.abs(v)).split('.');
  return (neg ? '-' : '') + group(parts[0]) + (parts.length > 1 ? '.' + parts[1] : '');
}

/* ----------------------------------------------------------------- dates */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Today's date on this machine (the app runs where its user is). */
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
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

/** Whole days from a to b ('YYYY-MM-DD'). */
function daysBetween(a, b) {
  const ta = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const tb = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((tb - ta) / 86400000);
}

/** A PocketBase timestamp ('2026-10-07 01:59:15.344Z') as this machine's local day. */
function localDay(ts) {
  const t = Date.parse(String(ts).replace(' ', 'T'));
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** The UTC timestamp, PocketBase style, where local day `dayStr` starts. */
function dayStartTs(dayStr) {
  const d = new Date(Number(dayStr.slice(0, 4)), Number(dayStr.slice(5, 7)) - 1, Number(dayStr.slice(8, 10)));
  return d.toISOString().replace('T', ' ');
}

/* --------------------------------------------------------------- records */

/** Ids whose `column` equals `value` ignoring case (PocketBase "=" filters keep case). */
function idsNocase(app, table, column, value, limit) {
  const r = rows(
    app,
    'SELECT id FROM {{' + table + '}} WHERE LOWER([[' + column + ']]) = LOWER({:v}) LIMIT ' + (limit || 5),
    { id: '' },
    { v: String(value) },
  );
  return r.map((x) => x.id);
}

/** Find one record or null (PocketBase find helpers throw on no rows). */
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

/** A new batch id: the movements of one action share it. */
function batchId() {
  return $security.randomString(15);
}

/** Rows of a raw SQL query. `shape` maps each column to its type: '' text, 0 int, -0 float. */
function rows(app, sql, shape, bind) {
  const out = arrayOf(new DynamicModel(shape));
  const q = app.db().newQuery(sql);
  if (bind) q.bind(bind);
  q.all(out);
  return out;
}

/** The absolute path of a stored file (the agent reads it from disk). */
function filePath(app, rec, field) {
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), rec.getString(field));
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
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

/** The first uploaded file in a multipart field, or null. */
function uploaded(ev, field) {
  try {
    const files = ev.findUploadedFiles(field);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

/** Every uploaded file in a multipart field. */
function uploadedAll(ev, field) {
  try {
    return ev.findUploadedFiles(field) || [];
  } catch {
    return [];
  }
}

module.exports = {
  fail: fail,
  handle: handle,
  fromAgent: fromAgent,
  actor: actor,
  has: has,
  str: str,
  req: req,
  bool: bool,
  int: int,
  oneOf: oneOf,
  list: list,
  q3: q3,
  decimal: decimal,
  qty: qty,
  qtyOf: qtyOf,
  costOf: costOf,
  checkQty: checkQty,
  cost: cost,
  toE4: toE4,
  e4ToText: e4ToText,
  lpad: lpad,
  group: group,
  fmtQty: fmtQty,
  pad: pad,
  today: today,
  isDay: isDay,
  day: day,
  addDays: addDays,
  daysBetween: daysBetween,
  localDay: localDay,
  dayStartTs: dayStartTs,
  idsNocase: idsNocase,
  findOne: findOne,
  byId: byId,
  squash: squash,
  batchId: batchId,
  rows: rows,
  filePath: filePath,
  localFile: localFile,
  uploaded: uploaded,
  uploadedAll: uploadedAll,
};
