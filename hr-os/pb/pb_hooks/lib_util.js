/// <reference path="../pb_data/types.d.ts" />
/**
 * Plumbing shared by every operation: errors with machine codes, typed
 * parameter readers, days and time zones, record helpers, raw SQL and CSV.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET,
 * JSON body for POST); the UI sends real JSON types and multipart forms.
 * Every reader accepts both and answers a 400 that names the param, so the
 * caller fixes the call in one step.
 *
 * Time zones: PocketBase's Go runtime has no time zone database on every
 * platform (on Windows `new Timezone(...)` is always UTC), so the offsets
 * and daylight saving rules of the zones HR OS supports live here (ZONES).
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

// Standard offset in minutes east of UTC, and the daylight saving rule:
// none | us (2nd Sun Mar to 1st Sun Nov, 02:00 local) | eu (last Sun Mar to
// last Sun Oct, 01:00 UTC) | au (1st Sun Oct to 1st Sun Apr, 02:00 standard)
// | nz (last Sun Sep to 1st Sun Apr, 02:00 standard).
const ZONES = {
  UTC: [0, 'none'],
  'Asia/Singapore': [480, 'none'],
  'Asia/Tokyo': [540, 'none'],
  'Asia/Kolkata': [330, 'none'],
  'Asia/Kuala_Lumpur': [480, 'none'],
  'Asia/Kuching': [480, 'none'],
  'Asia/Manila': [480, 'none'],
  'Asia/Jakarta': [420, 'none'],
  'Asia/Makassar': [480, 'none'],
  'Asia/Jayapura': [540, 'none'],
  'Asia/Bangkok': [420, 'none'],
  'Asia/Ho_Chi_Minh': [420, 'none'],
  'Asia/Hong_Kong': [480, 'none'],
  'Asia/Shanghai': [480, 'none'],
  'Asia/Seoul': [540, 'none'],
  'Asia/Taipei': [480, 'none'],
  'Asia/Dubai': [240, 'none'],
  'Asia/Riyadh': [180, 'none'],
  'Asia/Karachi': [300, 'none'],
  'Asia/Dhaka': [360, 'none'],
  'Asia/Kathmandu': [345, 'none'],
  'Asia/Colombo': [330, 'none'],
  'Africa/Johannesburg': [120, 'none'],
  'Africa/Lagos': [60, 'none'],
  'Africa/Nairobi': [180, 'none'],
  'Africa/Cairo': [120, 'none'],
  'America/Sao_Paulo': [-180, 'none'],
  'America/Manaus': [-240, 'none'],
  'America/Fortaleza': [-180, 'none'],
  'America/Noronha': [-120, 'none'],
  'America/Rio_Branco': [-300, 'none'],
  'America/Mexico_City': [-360, 'none'],
  'America/Monterrey': [-360, 'none'],
  'America/Chihuahua': [-360, 'none'],
  'America/Cancun': [-300, 'none'],
  'America/Hermosillo': [-420, 'none'],
  'America/Tijuana': [-480, 'us'],
  'America/Whitehorse': [-420, 'none'],
  'Atlantic/Canary': [0, 'eu'],
  'Pacific/Chatham': [765, 'nz'],
  'America/Bogota': [-300, 'none'],
  'America/Lima': [-300, 'none'],
  'America/Phoenix': [-420, 'none'],
  'America/Regina': [-360, 'none'],
  'Pacific/Honolulu': [-600, 'none'],
  'Australia/Brisbane': [600, 'none'],
  'Australia/Darwin': [570, 'none'],
  'Australia/Perth': [480, 'none'],
  'America/New_York': [-300, 'us'],
  'America/Detroit': [-300, 'us'],
  'America/Indiana/Indianapolis': [-300, 'us'],
  'America/Chicago': [-360, 'us'],
  'America/Denver': [-420, 'us'],
  'America/Boise': [-420, 'us'],
  'America/Los_Angeles': [-480, 'us'],
  'America/Anchorage': [-540, 'us'],
  'America/Toronto': [-300, 'us'],
  'America/Vancouver': [-480, 'us'],
  'America/Edmonton': [-420, 'us'],
  'America/Winnipeg': [-360, 'us'],
  'America/Halifax': [-240, 'us'],
  'America/St_Johns': [-210, 'us'],
  'Europe/London': [0, 'eu'],
  'Europe/Dublin': [0, 'eu'],
  'Europe/Lisbon': [0, 'eu'],
  'Europe/Berlin': [60, 'eu'],
  'Europe/Paris': [60, 'eu'],
  'Europe/Amsterdam': [60, 'eu'],
  'Europe/Brussels': [60, 'eu'],
  'Europe/Madrid': [60, 'eu'],
  'Europe/Rome': [60, 'eu'],
  'Europe/Vienna': [60, 'eu'],
  'Europe/Zurich': [60, 'eu'],
  'Europe/Stockholm': [60, 'eu'],
  'Europe/Oslo': [60, 'eu'],
  'Europe/Copenhagen': [60, 'eu'],
  'Europe/Warsaw': [60, 'eu'],
  'Europe/Prague': [60, 'eu'],
  'Europe/Athens': [120, 'eu'],
  'Europe/Helsinki': [120, 'eu'],
  'Australia/Sydney': [600, 'au'],
  'Australia/Melbourne': [600, 'au'],
  'Australia/Hobart': [600, 'au'],
  'Australia/Canberra': [600, 'au'],
  'Australia/Adelaide': [570, 'au'],
  'Pacific/Auckland': [720, 'nz'],
};

/** Day of month of the n-th (1-based) weekday `wd` in month `m` (0-based) of year y; n = -1 for the last. */
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lastWd = new Date(Date.UTC(y, m, lastDay)).getUTCDay();
  return lastDay - ((lastWd - wd + 7) % 7);
}

/** Minutes east of UTC for `zone` at instant `ms` (UTC milliseconds). */
function tzOffset(zone, ms) {
  const z = ZONES[zone];
  if (z === undefined) throw fail(400, 'Unknown time zone ' + zone + '. Use one of: ' + Object.keys(ZONES).join(', '), 'invalid_timezone');
  const std = z[0];
  const rule = z[1];
  if (rule === 'none') return std;
  const y = new Date(ms + std * 60000).getUTCFullYear();
  const at = (m, d, h, offMin) => Date.UTC(y, m, d, h, 0) - offMin * 60000;
  let dst = false;
  if (rule === 'us') dst = ms >= at(2, nthWeekday(y, 2, 0, 2), 2, std) && ms < at(10, nthWeekday(y, 10, 0, 1), 2, std + 60);
  else if (rule === 'eu') dst = ms >= Date.UTC(y, 2, nthWeekday(y, 2, 0, -1), 1, 0) && ms < Date.UTC(y, 9, nthWeekday(y, 9, 0, -1), 1, 0);
  else if (rule === 'au') dst = ms >= at(9, nthWeekday(y, 9, 0, 1), 2, std) || ms < at(3, nthWeekday(y, 3, 0, 1), 3, std + 60);
  else if (rule === 'nz') dst = ms >= at(8, nthWeekday(y, 8, 0, -1), 2, std) || ms < at(3, nthWeekday(y, 3, 0, 1), 3, std + 60);
  return dst ? std + 60 : std;
}

function isZone(zone) {
  return typeof zone === 'string' && ZONES[zone] !== undefined;
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

let _homeZone = null;
let _homeAt = 0;

/** The time zone of an entity, or (no entity) of the company's first entity; UTC before setup. */
function zoneOf(app, entityId) {
  if (entityId) {
    const r = one(app, 'SELECT timezone FROM entities WHERE id = {:id}', { timezone: '' }, { id: entityId });
    if (r !== null && r.timezone !== '') return r.timezone;
  }
  if (_homeZone !== null && Date.now() - _homeAt < 60000) return _homeZone;
  const r = one(app, "SELECT timezone FROM entities WHERE timezone != '' ORDER BY created LIMIT 1", { timezone: '' });
  _homeZone = r !== null ? r.timezone : 'UTC';
  _homeAt = Date.now();
  return _homeZone;
}

/** Today 'YYYY-MM-DD' in the entity's time zone (the company's first entity when none is given). */
function today(app, entityId) {
  if (!app) return fromUtc(Date.now());
  return localAt(zoneOf(app, entityId), Date.now()).day;
}

/** Local now in the entity's zone: { day, time, hour, minute, weekday, offset, zone }. */
function localNow(app, entityId) {
  return localAt(zoneOf(app, entityId), Date.now());
}

/**
 * Does a five-field cron expression (minute hour day month weekday, UTC)
 * match instant `ms`? Fields take *, n, a-b, lists and steps (*\/15, 1-5/2).
 */
function cronMatch(expr, ms) {
  const parts = String(expr || '')
    .trim()
    .split(/\s+/);
  if (parts.length !== 5) return false;
  const d = new Date(ms);
  const vals = [d.getUTCMinutes(), d.getUTCHours(), d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCDay()];
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  const field = (f, v, r) => {
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
      for (let x = lo; x <= hi; x += step) if (x === v || (r[1] === 7 && x === 7 && v === 0)) return true;
    }
    return false;
  };
  for (let i = 0; i < 5; i++) if (!field(parts[i], vals[i], ranges[i])) return false;
  return true;
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
    if (rows0.length > 1) throw fail(409, 'More than one ' + collection + ' is called "' + r + '". Use the id.', 'ambiguous');
    const close = closeNames(app, collection, nameField, r);
    if (close.length > 0) throw fail(404, 'No ' + collection + ' "' + r + '". Did you mean ' + close.map((x) => '"' + x + '"').join(' or ') + '?' + (listOp ? ' Run ' + listOp + ' to see them all.' : ''), 'not_found', { ref: r, matches: close });
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

/** Next number of a named counter (atomic within the caller's transaction). */
function nextNumber(app, key) {
  let rec = findOne(app, 'counters', 'key = {:k}', { k: key });
  if (rec === null) {
    rec = newRecord(app, 'counters');
    rec.set('key', key);
    rec.set('num', 0);
  }
  const n = rec.getInt('num') + 1;
  rec.set('num', n);
  app.save(rec);
  return n;
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
  const s = String(textValue || '').replace(/^﻿/, '');
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
  ZONES: ZONES,
  tzOffset: tzOffset,
  isZone: isZone,
  localAt: localAt,
  utcOf: utcOf,
  zoneOf: zoneOf,
  today: today,
  localNow: localNow,
  cronMatch: cronMatch,
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
};
