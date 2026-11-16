/// <reference path="../pb_data/types.d.ts" />
/**
 * Plumbing shared by every operation: errors with machine codes, typed
 * parameter readers, days and time zones, record helpers, raw SQL, CSV,
 * display ids and file inputs.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET,
 * JSON body for POST); the UI sends real JSON types and multipart forms.
 * Every reader accepts both and answers a 400 that names the param, so the
 * caller fixes the call in one step.
 *
 * Time zones: PocketBase's Go runtime has no time zone database on every
 * platform (on Windows `new Timezone(...)` is always UTC), so the offsets
 * and daylight saving rules of the zones Venture OS supports live here
 * (lib_eng_days, the engines' table). Local days are in the firm's zone
 * (settings.zone).
 */

/* ------------------------------------------------------------- errors */

/** An error the dispatcher answers with: HTTP status, a message for people, a machine `code`, optional data. */
function fail(status, message, code, extra) {
  const err = new Error(message);
  err.status = status;
  err.code = code || (status === 400 ? 'invalid' : status === 404 ? 'not_found' : status === 403 ? 'not_permitted' : status === 409 ? 'conflict' : 'error');
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

/** The allowed name closest to a mistyped one ("" when none is close). */
function nearest(name, allowed) {
  const n = String(name).toLowerCase();
  let best = '';
  let bestD = 3;
  for (const a of allowed) {
    const x = String(a).toLowerCase();
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
      const c = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = c;
    }
  }
  return row[b.length];
}

/** Refuse unknown keys in one item of a JSON list, naming the closest allowed key. */
function keysOnly(raw, allowed, where) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
  for (const k of Object.keys(raw)) {
    if (allowed.indexOf(k) >= 0) continue;
    const near = nearest(k, allowed);
    throw fail(400, where + ': unknown key "' + k + '"' + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. It takes: ' + allowed.join(', ') + '.', 'unknown_key', { key: k });
  }
}

/* ------------------------------------------------------------- params */

function has(p, name) {
  return p !== null && p !== undefined && p[name] !== undefined && p[name] !== null;
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
  if (v === '') throw fail(400, name + ' is required' + (example ? ', e.g. --' + name + ' ' + example : ''), 'missing_param', { param: name });
  return v;
}

function bool(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = scalar(p[name]);
  if (v === '') return dflt;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : v;
  if (s === true || s === 'true' || s === '1' || s === 'yes') return true;
  if (s === false || s === 'false' || s === '0' || s === 'no') return false;
  throw fail(400, name + ' must be true or false', 'invalid_param', { param: name });
}

/** A number param (null when absent). opts: min, max, whole. */
function num(p, name, opts) {
  const o = opts || {};
  if (!has(p, name) || scalar(p[name]) === '') return o.dflt === undefined ? null : o.dflt;
  const raw = scalar(p[name]);
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) throw fail(400, name + ' must be a number', 'invalid_param', { param: name });
  if (o.whole && !Number.isInteger(n)) throw fail(400, name + ' must be a whole number', 'invalid_param', { param: name });
  if (o.min !== undefined && n < o.min) throw fail(400, name + ' must be at least ' + o.min, 'invalid_param', { param: name });
  if (o.max !== undefined && n > o.max) throw fail(400, name + ' must be at most ' + o.max, 'invalid_param', { param: name });
  return n;
}

function int(p, name, dflt, min, max) {
  const v = num(p, name, { whole: true, min: min, max: max });
  return v === null ? dflt : v;
}

function oneOf(p, name, values, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (values.indexOf(v) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '), 'invalid_param', { param: name });
  return v;
}

/** A list: a real array, or (from the CLI) a JSON array string. undefined when absent. */
function list(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && (v[0].trim() === '' || v[0].trim().charAt(0) === '[')) v = v[0];
  if (typeof v === 'string') {
    if (v.trim() === '') return [];
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON list, e.g. ["a","b"]', 'invalid_param', { param: name });
    }
  }
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list', 'invalid_param', { param: name });
  return v;
}

/** An object: a real object, or (from the CLI) a JSON object string. undefined when absent. */
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

/** A money amount param in `currency` (major units text such as "1250.50") -> minor units, null when absent. */
function money(p, name, currency, opts) {
  const o = opts || {};
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) {
    if (o.required) throw fail(400, name + ' is required, e.g. --' + name + ' 1250.00', 'missing_param', { param: name });
    return null;
  }
  const m = L('lib_money');
  const v = m.toMinor(typeof raw === 'number' ? String(raw) : raw, currency, o.allowNegative === true);
  if (v === null) {
    throw fail(400, name + ' must be an amount in ' + currency + ' with "." as the decimal point and at most ' + m.exponent(currency) + ' decimals, e.g. 1250' + (m.exponent(currency) > 0 ? '.' + '0'.repeat(m.exponent(currency)) : '') + ' (got "' + raw + '")', 'invalid_amount', { param: name });
  }
  if (o.positive && v <= 0) throw fail(400, name + ' must be more than 0', 'invalid_amount', { param: name });
  return v;
}

/** A percent param ("2.5" = 2.5%) -> millionths (25000), null when absent. opts: min, max (in ppm). */
function ppm(p, name, opts) {
  const o = opts || {};
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) return null;
  const v = L('lib_money').parseScaled(typeof raw === 'number' ? String(raw) : String(raw).replace(/%$/, ''), 4, o.allowNegative === true);
  if (v === null) throw fail(400, name + ' must be a percent such as 2.5 (at most 4 decimals)', 'invalid_param', { param: name });
  if (o.min !== undefined && v < o.min) throw fail(400, name + ' must be at least ' + o.min / 10000 + '%', 'invalid_param', { param: name });
  if (o.max !== undefined && v > o.max) throw fail(400, name + ' must be at most ' + o.max / 10000 + '%', 'invalid_param', { param: name });
  return v;
}

/** A decimal param scaled by 10^8 (exchange rates, prices per share): "151.2345" -> 15123450000, null when absent. */
function e8(p, name, opts) {
  const o = opts || {};
  const raw = has(p, name) ? scalar(p[name]) : '';
  if (raw === '' || raw === undefined) return null;
  const v = L('lib_money').parseScaled(typeof raw === 'number' ? String(raw) : String(raw), 8, false);
  if (v === null) throw fail(400, name + ' must be a plain decimal number such as 151.2345 (at most 8 decimals)', 'invalid_param', { param: name });
  if (o.positive && v <= 0) throw fail(400, name + ' must be more than 0', 'invalid_param', { param: name });
  return v;
}

/** Page window from limit/offset params: { limit, offset }. */
function page(p, dflt, max) {
  return { limit: int(p, 'limit', dflt || 50, 1, max || 500), offset: int(p, 'offset', 0, 0, 100000000) };
}

/* --------------------------------------------------------------- days */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isTime(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** A day param 'YYYY-MM-DD' (dflt when absent). */
function day(p, name, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (!isDay(v)) throw fail(400, name + ' must be a real date written YYYY-MM-DD, e.g. 2026-11-04', 'invalid_param', { param: name });
  return v;
}

function utc(d) {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

function fromUtc(t) {
  const x = new Date(t);
  return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
}

function dayAdd(d, n) {
  return fromUtc(utc(d) + n * 86400000);
}

/** Whole days from a to b (b - a). */
function daysBetween(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/** Day of week, 0 = Sunday ... 6 = Saturday. */
function weekday(d) {
  return new Date(utc(d)).getUTCDay();
}

function monthEnd(d) {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return d.slice(0, 7) + '-' + pad(new Date(Date.UTC(y, m, 0)).getUTCDate());
}

/** Add months to a day, clamped to the month's end. */
function addMonths(d, n) {
  let y = Number(d.slice(0, 4));
  let m = Number(d.slice(5, 7)) - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return y + '-' + pad(m + 1) + '-' + pad(Math.min(Number(d.slice(8, 10)), last));
}

function nowIso() {
  return new Date().toISOString();
}

/* --------------------------------------------------------- time zones */

// Zones and their daylight saving rules live in the engines' lib_eng_days.js
// (checked against the IANA database): one implementation for the kernel and
// every module.
let _days = null;
function DAYS() {
  if (_days === null) _days = require(`${__hooks}/lib_eng_days.js`);
  return _days;
}

/** The zone names Venture OS knows. */
function zoneNames() {
  return Object.keys(DAYS().ZONES);
}

/** Minutes east of UTC for `zone` at instant `ms` (UTC milliseconds); 400 invalid_timezone for an unknown zone. */
function tzOffset(zone, ms) {
  if (!isZone(zone)) throw fail(400, 'Unknown time zone ' + zone + '. Use one of: ' + zoneNames().join(', '), 'invalid_timezone');
  return DAYS().offsetMinutes(zone, ms);
}

function isZone(zone) {
  return DAYS().isZone(zone);
}

/** Local wall time of instant `ms` in `zone`: { day, time, hour, minute, weekday, offset }. */
function localAt(zone, ms) {
  const off = tzOffset(zone, ms);
  const x = new Date(ms + off * 60000);
  const dayText = x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
  return { day: dayText, time: pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes()), hour: x.getUTCHours(), minute: x.getUTCMinutes(), weekday: x.getUTCDay(), offset: off, zone: zone };
}

/** The UTC instant (ms) of local wall time `dayText` `hhmm` in `zone`. */
function utcOf(zone, dayText, hhmm) {
  const h = hhmm ? Number(hhmm.slice(0, 2)) : 0;
  const mi = hhmm ? Number(hhmm.slice(3, 5)) : 0;
  const wall = Date.UTC(Number(dayText.slice(0, 4)), Number(dayText.slice(5, 7)) - 1, Number(dayText.slice(8, 10)), h, mi);
  let guess = wall - tzOffset(zone, wall) * 60000;
  guess = wall - tzOffset(zone, guess) * 60000;
  return guess;
}

let _firmZone = null;
let _firmAt = 0;

/** The firm's time zone (settings.zone; UTC before setup). Cached for ten seconds per runtime. */
function zoneOf(app) {
  if (_firmZone !== null && Date.now() - _firmAt < 10000) return _firmZone;
  let z = 'UTC';
  try {
    const r = one(app, 'SELECT zone FROM settings ORDER BY created LIMIT 1', { zone: '' });
    if (r !== null && isZone(r.zone)) z = r.zone;
  } catch {
    z = 'UTC';
  }
  _firmZone = z;
  _firmAt = Date.now();
  return z;
}

/** Forget the cached zone (settings.update calls it). */
function zoneReset() {
  _firmZone = null;
}

/** Today 'YYYY-MM-DD' in the firm's zone (a zone name instead of an app gives that zone's day). */
function today(app) {
  if (!app) return fromUtc(Date.now());
  if (typeof app === 'string') return localAt(isZone(app) ? app : 'UTC', Date.now()).day;
  return localAt(zoneOf(app), Date.now()).day;
}

/** Local now in the firm's zone: { day, time, hour, minute, weekday, offset, zone }. */
function localNow(app) {
  return localAt(zoneOf(app), Date.now());
}

/** The firm's local day of a UTC instant (ISO text or ms). */
function dayOf(app, at) {
  const ms = typeof at === 'number' ? at : Date.parse(String(at || '').replace(' ', 'T'));
  if (!Number.isFinite(ms)) return '';
  return localAt(zoneOf(app), ms).day;
}

/** The UTC ISO instant where a firm-local day (and optional HH:MM) starts. */
function atOf(app, dayText, hhmm) {
  return new Date(utcOf(zoneOf(app), dayText, hhmm || '00:00')).toISOString();
}

const CRON_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

let _cronCache = {};
/**
 * A five-field cron expression (minute hour day month weekday) as five
 * lookup tables (null when the expression is not five fields). Fields take
 * *, n, a-b, lists and steps (*\/15, 1-5/2); weekday 7 is Sunday too.
 */
function cronParse(expr) {
  const key = String(expr || '').trim();
  if (_cronCache[key] !== undefined) return _cronCache[key];
  const parts = key.split(/\s+/);
  if (parts.length !== 5) {
    _cronCache[key] = null;
    return null;
  }
  const out = parts.map((f, i) => {
    const r = CRON_RANGES[i];
    const ok = {};
    for (const item of f.split(',')) {
      const st = item.split('/');
      const step = st.length > 1 ? Number(st[1]) : 1;
      let lo = r[0];
      let hi = r[1];
      if (st[0] !== '*') {
        const ab = st[0].split('-');
        lo = Number(ab[0]);
        hi = ab.length > 1 ? Number(ab[1]) : st.length > 1 ? r[1] : lo;
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(step > 0)) continue;
      for (let x = lo; x <= hi; x += step) ok[i === 4 && x === 7 ? 0 : x] = true;
    }
    return ok;
  });
  _cronCache[key] = out;
  return out;
}

/** Does a parsed expression match the wall time of a Date read in UTC fields? */
function cronHit(parsed, d) {
  if (parsed === null) return false;
  return parsed[0][d.getUTCMinutes()] === true && parsed[1][d.getUTCHours()] === true && parsed[2][d.getUTCDate()] === true && parsed[3][d.getUTCMonth() + 1] === true && parsed[4][d.getUTCDay()] === true;
}

/**
 * Does a five-field cron expression match instant `ms`? With `zone` the
 * fields are read as that zone's wall time (module cron runs in the firm's
 * zone), else UTC.
 */
function cronMatch(expr, ms, zone) {
  const parsed = cronParse(expr);
  if (parsed === null) return false;
  return cronHit(parsed, new Date(zone && isZone(zone) ? ms + tzOffset(zone, ms) * 60000 : ms));
}

/* ------------------------------------------------------------ records */

let _shared = {};

/**
 * A plain-data value built once per server and kept in the app store as
 * JSON (the store is shared by every runtime of PocketBase's pool); each
 * runtime parses it once. Boot rebuilds it (sharedReset) so new files count.
 */
function shared(key, build) {
  if (_shared[key] !== undefined) return _shared[key];
  let raw = null;
  try {
    raw = $app.store().get(key);
  } catch {
    raw = null;
  }
  let value;
  if (typeof raw === 'string' && raw !== '') value = JSON.parse(raw);
  else {
    value = build();
    try {
      $app.store().set(key, JSON.stringify(value));
    } catch {
      /* outside PocketBase (Node tools) there is no store */
    }
  }
  _shared[key] = value;
  return value;
}

/** Forget a shared value (boot calls it before building again). */
function sharedReset(app, key) {
  app.store().remove(key);
  delete _shared[key];
}

let _m = {};
/** A kernel or module library, loaded once per runtime (require costs about 2 ms a call). */
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function findOne(app, collection, filter, params) {
  const r = app.findRecordsByFilter(collection, filter, '', 1, 0, params || {});
  return r.length > 0 ? r[0] : null;
}

function findMany(app, collection, filter, sort, limit, params) {
  return app.findRecordsByFilter(collection, filter || '1=1', sort || '', limit || 0, 0, params || {});
}

function byId(app, collection, id) {
  if (typeof id !== 'string' || id === '') return null;
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

/** A record by id, or by `nameField` (case-insensitive); 404 naming the list op when none. */
function byIdOrName(app, collection, ref, nameField, listOp) {
  const r = String(ref || '').trim();
  if (r === '') throw fail(400, 'Give the ' + collection + ' id or ' + (nameField || 'name') + '.', 'missing_param');
  const rec = byId(app, collection, r);
  if (rec !== null) return rec;
  if (nameField) {
    const rows0 = rows(app, 'SELECT id FROM ' + collection + ' WHERE LOWER([[' + nameField + ']]) = LOWER({:v}) LIMIT 2', { id: '' }, { v: r });
    if (rows0.length === 1) return app.findRecordById(collection, rows0[0].id);
    const one = collection.replace(/_/g, ' ').replace(/ies$/, 'y').replace(/s$/, '');
    if (rows0.length > 1) throw L('lib_refs').ambiguous(collection.replace(/_/g, ' '), r, rows0.map((x) => ({ id: x.id, name: r })), 'Use the id.');
    throw L('lib_refs').notFound(one, r, L('lib_refs').matches(app, collection, nameField, r), listOp || '');
  }
  throw fail(404, 'No ' + collection + ' "' + r + '".' + (listOp ? ' Run ' + listOp + ' to see them.' : ''), 'not_found', { ref: r });
}

/** Names in a column that contain the text or are a short edit away (for "did you mean"). */
function closeNames(app, collection, nameField, text) {
  const t = String(text || '').trim();
  if (t === '') return [];
  const out = rows(app, 'SELECT [[' + nameField + ']] AS n FROM ' + collection + " WHERE [[" + nameField + "]] LIKE {:q} ESCAPE '\\' LIMIT 3", { n: '' }, { q: like(t) }).map((x) => x.n);
  if (out.length > 0) return out;
  const all = rows(app, 'SELECT [[' + nameField + ']] AS n FROM ' + collection + ' LIMIT 500', { n: '' }).map((x) => x.n);
  const near = nearest(t, all);
  return near !== '' ? [near] : [];
}

const FACT_TYPES = ['day', 'range', 'money', 'state', 'number', 'text'];

/**
 * Check a list of structured facts (approvals, notifications, search):
 * [{ type: 'day', value } | { type: 'range', from, to } | { type: 'money',
 * amount_minor, currency } | { type: 'state', value } | { type: 'number',
 * value, unit } | { type: 'text', value }], each with an optional key and
 * label. Screens format them; the plain summary is only for the CLI.
 */
function facts(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw fail(400, 'facts must be a list', 'invalid_param');
  return list.slice(0, 20).map((f, i) => {
    if (!f || FACT_TYPES.indexOf(f.type) < 0) throw fail(400, 'fact ' + (i + 1) + ': type is one of ' + FACT_TYPES.join(', '), 'invalid_param');
    const out = { type: f.type };
    if (f.key) out.key = clip(f.key, 40);
    if (f.label) out.label = clip(f.label, 80);
    if (f.type === 'day') {
      if (!isDay(String(f.value || ''))) throw fail(400, 'fact ' + (i + 1) + ': a day is YYYY-MM-DD', 'invalid_param');
      out.value = f.value;
    } else if (f.type === 'range') {
      if (!isDay(String(f.from || '')) || !isDay(String(f.to || ''))) throw fail(400, 'fact ' + (i + 1) + ': from and to are YYYY-MM-DD', 'invalid_param');
      out.from = f.from;
      out.to = f.to;
    } else if (f.type === 'money') {
      if (!Number.isInteger(Number(f.amount_minor)) || !/^[A-Z]{3}$/.test(String(f.currency || ''))) throw fail(400, 'fact ' + (i + 1) + ': money needs amount_minor (integer) and currency', 'invalid_param');
      out.amount_minor = Number(f.amount_minor);
      out.currency = f.currency;
    } else if (f.type === 'number') {
      if (!Number.isFinite(Number(f.value))) throw fail(400, 'fact ' + (i + 1) + ': a number', 'invalid_param');
      out.value = Number(f.value);
      if (f.unit) out.unit = clip(f.unit, 20);
    } else out.value = clip(f.value === undefined || f.value === null ? '' : String(f.value), 300);
    return out;
  });
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

/** COUNT(*) of a query written as "SELECT COUNT(*) AS n FROM ...". */
function count(app, sql, bind) {
  const r = one(app, sql, { n: 0 }, bind);
  return r === null ? 0 : r.n;
}

/**
 * Next number of a named sequence in settings.seq (display ids: D, IN, CC,
 * DI, M, IC). Raw SQL inside a transaction (PocketBase serializes write
 * transactions), so two callers never get the same number and an undo of
 * the record that took it never rewinds the sequence.
 */
function nextNumber(app, key) {
  const step = (a) => {
    const r = one(a, 'SELECT id, seq FROM settings ORDER BY created LIMIT 1', { id: '', seq: '' });
    if (r === null) throw fail(409, 'Venture OS is not set up yet.', 'not_set_up');
    let seq = {};
    try {
      seq = JSON.parse(r.seq || '{}') || {};
    } catch {
      seq = {};
    }
    const n = (Number(seq[key]) || 0) + 1;
    seq[key] = n;
    exec(a, 'UPDATE settings SET seq = {:s} WHERE id = {:id}', { s: JSON.stringify(seq), id: r.id });
    return n;
  };
  if (app.isTransactional()) return step(app);
  let out = 0;
  app.runInTransaction((tx) => {
    out = step(tx);
  });
  return out;
}

/** The next display id of a kind: nextId(app, 'D', 4) -> 'D-0001'; nextId(app, 'CC', 3) -> 'CC-001'. */
function nextId(app, prefix, width) {
  let n = String(nextNumber(app, prefix));
  while (n.length < (width || 4)) n = '0' + n;
  return prefix + '-' + n;
}

/** A json field's value as a JS value (dflt when empty). */
function jsonOf(rec, field, dflt) {
  const raw = rec.getString(field);
  if (raw === '' || raw === 'null') return dflt === undefined ? null : dflt;
  try {
    return JSON.parse(raw);
  } catch {
    return dflt === undefined ? null : dflt;
  }
}

/** Collapse whitespace and trim. */
function squash(s) {
  return String(s === undefined || s === null ? '' : s)
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

function clip(s, n) {
  const t = String(s === undefined || s === null ? '' : s);
  return t.length > n ? t.slice(0, n) : t;
}

/** 'Northwind Pte Ltd' -> 'northwind-pte-ltd'. */
function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function token(n) {
  return $security.randomString(n || 32);
}

function sha(textValue) {
  return $security.sha256(String(textValue));
}

/** LIKE pattern for a search term (escaped; use with ESCAPE '\'). */
function like(q) {
  return '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

/** Thousands grouping by hand (Goja mishandles lookahead regexes). */
function group(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/* ---------------------------------------------------------------- CSV */

/** Parse CSV text (RFC 4180: quotes, doubled quotes, CRLF) into rows of cells. */
function csvParse(textValue) {
  const s = String(textValue || '').replace(/^\uFEFF/, '');
  const out = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') out.push(row);
  }
  return out;
}

/** CSV rows -> objects keyed by the (trimmed, lower-cased) header row. */
function csvObjects(textValue) {
  const rowsIn = csvParse(textValue);
  if (rowsIn.length === 0) return { header: [], items: [] };
  const header = rowsIn[0].map((h) => String(h).trim().toLowerCase());
  const items = [];
  for (let i = 1; i < rowsIn.length; i++) {
    const o = {};
    header.forEach((h, j) => {
      o[h] = rowsIn[i][j] === undefined ? '' : String(rowsIn[i][j]).trim();
    });
    items.push(o);
  }
  return { header: header, items: items };
}

/** One CSV cell, quoted when needed; text that a spreadsheet would run as a formula gets a leading apostrophe. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Rows of cells (first row the header) -> CSV text with CRLF line ends. */
function csvText(rowsOut) {
  return rowsOut.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* -------------------------------------------------------------- files */

/**
 * File inputs. People upload in multipart forms; your AI agent names a
 * local file by path (it attaches files from its own workspace). Inside the
 * app's own folder only uploaded files (pb_data/storage) can be named: the
 * rest holds the database, the agent token and the seal key.
 */
function uploaded(e, field) {
  try {
    const files = e.findUploadedFiles(field);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

/** The checked absolute path of a local file your AI agent named (403 inside the app folder). */
function agentPath(ctx, path, name) {
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
  const low = String(real).toLowerCase();
  const under = (dir) => low.indexOf(String(dir).toLowerCase() + sep) === 0;
  if ((under(appDir) || low === String(appDir).toLowerCase()) && !under(uploads)) throw fail(403, "Files inside the app's own folder cannot be attached.", 'not_permitted', { param: name });
  let isDir = false;
  try {
    isDir = $os.stat(real).isDir();
  } catch {
    throw fail(400, 'No file at ' + name + ' "' + path + '". Give the absolute path of the file.', 'invalid_param', { param: name });
  }
  if (isDir) throw fail(400, name + ' is a folder, not a file: ' + path, 'invalid_param', { param: name });
  return real;
}

/** An uploaded file (multipart field) or a file your AI agent names by path, as a file to set on a record; null when neither. */
function fileParam(ctx, p, field, pathParam) {
  const f = ctx.e ? uploaded(ctx.e, field) : null;
  if (f !== null) return f;
  const path = str(p, pathParam || 'path', '');
  if (path !== '') return $filesystem.fileFromPath(agentPath(ctx, path, pathParam || 'path'));
  return null;
}

/** Text from an uploaded file field, a path your AI agent gives, or a text param ('' when none). max: characters. */
function textInput(ctx, p, fileField, textParam, pathParam, max) {
  const limit = max || 5000000;
  const f = ctx.e ? uploaded(ctx.e, fileField) : null;
  let t = '';
  if (f !== null) {
    const reader = f.reader.open();
    try {
      t = toString(reader);
    } finally {
      reader.close();
    }
  } else if (str(p, pathParam || 'path', '') !== '') {
    t = toString($os.readFile(agentPath(ctx, str(p, pathParam || 'path', ''), pathParam || 'path')));
  } else {
    const v = has(p, textParam) ? scalar(p[textParam]) : '';
    t = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  }
  if (t.length > limit) throw fail(400, 'The text is too large (' + Math.round(limit / 1000000) + ' MB at most).', 'invalid_param', { param: textParam });
  return t;
}

let _warmList = null;
/**
 * Load every library (lib_*.js) and every module registration (cat_*.js,
 * events_*.js, guide_*.js, cron_*.js) into the runtime that runs this, so a
 * request served by it later requires nothing. The file list is read once
 * per server and kept in the app store. Answers how many files were loaded.
 */
function warmRuntime() {
  if (_warmList === null) {
    _warmList = shared('vo_warm_files_v1', () => {
      const out = [];
      for (const f of $os.readDir(__hooks)) {
        const n = f.name();
        if (/^(lib|cat|events|guide|cron)_[a-z0-9_]+\.js$/.test(n)) out.push(n);
      }
      out.sort();
      return out;
    });
  }
  let n = 0;
  for (const name of _warmList) {
    try {
      require(`${__hooks}/${name}`);
      n++;
    } catch (err) {
      console.error('[vo] warm load ' + name + ':', err);
    }
  }
  return n;
}

/** Hourly: keep the query planner's statistics fresh (lists stay fast as tables grow). */
function optimize(app) {
  try {
    exec(app, 'PRAGMA optimize');
  } catch (err) {
    console.log('[vo] PRAGMA optimize failed: ' + err);
  }
}

module.exports = {
  fail: fail,
  statusOf: statusOf,
  nearest: nearest,
  editDistance: editDistance,
  keysOnly: keysOnly,
  has: has,
  scalar: scalar,
  str: str,
  text: text,
  req: req,
  bool: bool,
  num: num,
  int: int,
  oneOf: oneOf,
  list: list,
  obj: obj,
  money: money,
  ppm: ppm,
  e8: e8,
  page: page,
  pad: pad,
  isDay: isDay,
  isTime: isTime,
  day: day,
  dayAdd: dayAdd,
  daysBetween: daysBetween,
  weekday: weekday,
  monthEnd: monthEnd,
  addMonths: addMonths,
  nowIso: nowIso,
  zoneNames: zoneNames,
  tzOffset: tzOffset,
  isZone: isZone,
  localAt: localAt,
  utcOf: utcOf,
  zoneOf: zoneOf,
  zoneReset: zoneReset,
  today: today,
  localNow: localNow,
  dayOf: dayOf,
  atOf: atOf,
  cronMatch: cronMatch,
  cronParse: cronParse,
  cronHit: cronHit,
  shared: shared,
  sharedReset: sharedReset,
  L: L,
  findOne: findOne,
  findMany: findMany,
  byId: byId,
  byIdOrName: byIdOrName,
  closeNames: closeNames,
  facts: facts,
  FACT_TYPES: FACT_TYPES,
  newRecord: newRecord,
  rows: rows,
  one: one,
  exec: exec,
  count: count,
  nextNumber: nextNumber,
  nextId: nextId,
  jsonOf: jsonOf,
  squash: squash,
  clip: clip,
  slug: slug,
  token: token,
  sha: sha,
  like: like,
  group: group,
  csvParse: csvParse,
  csvObjects: csvObjects,
  csvCell: csvCell,
  csvText: csvText,
  uploaded: uploaded,
  agentPath: agentPath,
  fileParam: fileParam,
  textInput: textInput,
  optimize: optimize,
  warmRuntime: warmRuntime,
};
