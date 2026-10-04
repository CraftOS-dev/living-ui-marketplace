/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared helpers for IP Manager hooks. Pure functions plus thin record
 * helpers. Require inside handlers: const u = require(`${__hooks}/lib_util.js`).
 *
 * Dates: the app stores calendar dates as PocketBase date strings
 * ("YYYY-MM-DD 00:00:00.000Z"). All arithmetic works on the 10-character
 * ISO day ("YYYY-MM-DD") with UTC Date math, so no timezone ever shifts a
 * deadline by a day.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Any date-ish value to "YYYY-MM-DD" ('' when empty/invalid). */
function d10(v) {
  if (v === null || v === undefined) return '';
  let s = '';
  if (typeof v === 'string') s = v;
  else if (typeof v === 'object' && typeof v.string === 'function') s = v.string();
  else if (v instanceof Date) s = v.toISOString();
  else s = String(v);
  s = s.trim();
  if (s.length < 10) return '';
  const head = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
}

function toPb(day) {
  const d = d10(day);
  return d === '' ? '' : d + ' 00:00:00.000Z';
}

function parts(day) {
  const d = d10(day);
  return { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) };
}

function fromUTC(ms) {
  const x = new Date(ms);
  return x.getUTCFullYear() + '-' + pad2(x.getUTCMonth() + 1) + '-' + pad2(x.getUTCDate());
}

function utcMs(day) {
  const p = parts(day);
  return Date.UTC(p.y, p.m - 1, p.d);
}

function daysInMonth(y, m) {
  // m is 1-based
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isLastDayOfMonth(day) {
  const p = parts(day);
  return p.d === daysInMonth(p.y, p.m);
}

function endOfMonth(day) {
  const p = parts(day);
  return p.y + '-' + pad2(p.m) + '-' + pad2(daysInMonth(p.y, p.m));
}

/**
 * Calendar arithmetic: years and months move the calendar date (clamped to
 * the month's last day, e.g. 31 Jan + 1 month = 28/29 Feb), days add after.
 * Three months is never 90 days.
 */
function addYMD(day, years, months, days) {
  const d = d10(day);
  if (d === '') return '';
  const p = parts(d);
  const total = p.y * 12 + (p.m - 1) + (years || 0) * 12 + (months || 0);
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  const nd = Math.min(p.d, daysInMonth(ny, nm));
  let ms = Date.UTC(ny, nm - 1, nd);
  if (days) ms += days * 86400000;
  return fromUTC(ms);
}

function addDays(day, n) {
  const d = d10(day);
  if (d === '') return '';
  return fromUTC(utcMs(d) + n * 86400000);
}

function diffDays(a, b) {
  // b - a in days
  const x = d10(a);
  const y = d10(b);
  if (x === '' || y === '') return 0;
  return Math.round((utcMs(y) - utcMs(x)) / 86400000);
}

function weekday(day) {
  return new Date(utcMs(day)).getUTCDay();
}

function weekdayName(day) {
  return WEEKDAYS[weekday(day)];
}

/** Local (server machine) calendar day: the user's "today". */
function today() {
  const n = new Date();
  return n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate());
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ');
}

function human(day) {
  const d = d10(day);
  if (d === '') return '';
  const p = parts(d);
  return pad2(p.d) + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
}

function cmpDay(a, b) {
  const x = d10(a);
  const y = d10(b);
  if (x === y) return 0;
  if (x === '') return 1;
  if (y === '') return -1;
  return x < y ? -1 : 1;
}

function minDay(list) {
  let best = '';
  for (const v of list) {
    const d = d10(v);
    if (d !== '' && (best === '' || d < best)) best = d;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* JSON / record helpers                                               */
/* ------------------------------------------------------------------ */

/** Read a json field as a plain JS value. */
function j(record, field, fallback) {
  // JSON fields come back from record.get() as raw bytes (types.JSONRaw);
  // getString() returns the JSON text, toString() is the byte fallback.
  let s = '';
  try {
    s = record.getString(field) || '';
  } catch {
    s = '';
  }
  if (s === '') {
    try {
      const raw = record.get(field);
      if (raw === null || raw === undefined) return fallback;
      s = typeof raw === 'string' ? raw : toString(raw);
    } catch {
      return fallback;
    }
  }
  if (s === '' || s === 'null') return fallback;
  try {
    const v = JSON.parse(s);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Plain object snapshot of a record (field -> value) for diffs and audit. */
function plain(record) {
  try {
    return JSON.parse(JSON.stringify(record));
  } catch {
    return {};
  }
}

function str(record, field) {
  try {
    return record.getString(field) || '';
  } catch {
    return '';
  }
}

function num(record, field) {
  try {
    const v = record.getFloat(field);
    return typeof v === 'number' && !isNaN(v) ? v : 0;
  } catch {
    return 0;
  }
}

function bool(record, field) {
  try {
    return record.getBool(field) === true;
  } catch {
    return false;
  }
}

function findOne(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params || {});
  } catch {
    return null;
  }
}

function findMany(app, collection, filter, sort, limit, params) {
  try {
    return app.findRecordsByFilter(collection, filter || '', sort || '', limit || 0, 0, params || {});
  } catch {
    return [];
  }
}

function byId(app, collection, id) {
  if (!id) return null;
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

function newRecord(app, collection, data) {
  const col = app.findCollectionByNameOrId(collection);
  const rec = new Record(col);
  if (data) {
    for (const k of Object.keys(data)) {
      if (data[k] !== undefined) rec.set(k, data[k]);
    }
  }
  return rec;
}

/** Recursively find the first value under any of the given keys (structural, for office JSON). */
function findKey(obj, keys, depth) {
  const d = depth || 0;
  if (obj === null || obj === undefined || d > 12) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = findKey(item, keys, d + 1);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  if (typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== null && obj[k] !== undefined && obj[k] !== '') {
      return obj[k];
    }
  }
  for (const k of Object.keys(obj)) {
    const v = findKey(obj[k], keys, d + 1);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Collect every value under a key, anywhere in a JSON tree. */
function findAll(obj, key, out, depth) {
  const acc = out || [];
  const d = depth || 0;
  if (obj === null || obj === undefined || d > 14) return acc;
  if (Array.isArray(obj)) {
    for (const item of obj) findAll(item, key, acc, d + 1);
    return acc;
  }
  if (typeof obj !== 'object') return acc;
  for (const k of Object.keys(obj)) {
    if (k === key) acc.push(obj[k]);
    findAll(obj[k], key, acc, d + 1);
  }
  return acc;
}

/** OPS JSON wraps text in {"$": "..."}; unwrap one level. */
function txt(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '$')) return String(v['$']);
  if (Array.isArray(v)) return v.length ? txt(v[0]) : '';
  return String(v);
}

/** Normalize an office date ("20260922", "2026-09-22", "2026/09/22", ISO) to YYYY-MM-DD. */
/** A real calendar day (YYYY-MM-DD) or '' (rejects 2025-13-40 and 2026-02-30). */
function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return '';
  return day;
}

function officeDate(v) {
  const s = txt(v).trim();
  if (s === '') return '';
  if (/^\d{8}$/.test(s)) return validDay(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8));
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return validDay(m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3])));
  return validDay(d10(s));
}

/* ------------------------------------------------------------------ */
/* Organization settings, roles, audit                                 */
/* ------------------------------------------------------------------ */

function settings(app) {
  const rows = findMany(app, 'settings', '', 'created', 1);
  return rows.length ? rows[0] : null;
}

function setting(app, field, fallback) {
  const s = settings(app);
  if (s === null) return fallback;
  const raw = s.get(field);
  if (raw === null || raw === undefined || raw === '') return fallback;
  return raw;
}

function roleOf(auth) {
  if (!auth) return '';
  try {
    // The machine superuser (CraftBot's CLI) acts with admin rights.
    if (auth.collection().name === '_superusers') return 'admin';
  } catch {
    /* not a record with a collection */
  }
  try {
    return auth.getString('role') || '';
  } catch {
    return '';
  }
}

/** Actor id for audit (empty for the machine superuser). */
function actorId(e) {
  if (!e || !e.auth) return '';
  try {
    if (e.auth.collection().name === '_superusers') return '';
  } catch {
    return '';
  }
  return e.auth.id;
}

/**
 * Route guard. level: 'read' | 'contribute' | 'edit' | 'manage' | 'admin' | 'auth'.
 * Sends the 401/403 and returns true when refused (the caller must stop),
 * null when allowed. e.json() returns nothing on success, so its result can
 * never be the "denied" signal: that let refused calls run on.
 */
function deny(e, level) {
  if (!e.auth) {
    e.json(401, { error: 'Sign in required.' });
    return true;
  }
  const r = roleOf(e.auth);
  const ok =
    level === 'auth'
      ? true
      : level === 'read'
        ? r !== '' && r !== 'inventor'
        : level === 'contribute'
          ? ['admin', 'manager', 'counsel', 'contributor'].indexOf(r) >= 0
          : level === 'edit'
            ? ['admin', 'manager', 'counsel'].indexOf(r) >= 0
            : level === 'manage'
              ? r === 'admin' || r === 'manager'
              : level === 'admin'
                ? r === 'admin'
                : false;
  if (ok) return null;
  e.json(403, { error: 'Your role (' + (r || 'none') + ') cannot do this. Ask an admin to change your role.' });
  return true;
}

function fail(e, err, status) {
  const msg = err && err.message ? err.message : String(err);
  console.error('op failed:', msg);
  return e.json(status || 400, { error: msg });
}

const EDIT_ROLES = ['admin', 'manager', 'counsel'];
function canEdit(auth) {
  return EDIT_ROLES.indexOf(roleOf(auth)) >= 0;
}
function canManage(auth) {
  const r = roleOf(auth);
  return r === 'admin' || r === 'manager';
}
function isAdmin(auth) {
  return roleOf(auth) === 'admin';
}
function canContribute(auth) {
  const r = roleOf(auth);
  return EDIT_ROLES.indexOf(r) >= 0 || r === 'contributor';
}
function canRead(auth) {
  const r = roleOf(auth);
  return r !== '' && r !== 'inventor';
}

/** Keep disclosures.inventor_users in step with the inventors whose party links an account. */
function refreshInventorUsers(app, disclosureId) {
  if (!disclosureId) return;
  const d = byId(app, 'disclosures', disclosureId);
  if (d === null) return;
  const ids = [];
  for (const inv of findMany(app, 'involvements', 'disclosure = {:d} && role = "inventor"', '', 0, { d: disclosureId })) {
    const p = byId(app, 'parties', inv.getString('party'));
    const uid = p !== null ? p.getString('user') : '';
    if (uid && ids.indexOf(uid) < 0) ids.push(uid);
  }
  const raw = d.getStringSlice('inventor_users') || [];
  const current = [];
  for (let i = 0; i < raw.length; i++) current.push(String(raw[i]));
  if (current.sort().join(',') === ids.slice().sort().join(',')) return;
  d.set('inventor_users', ids);
  app.save(d);
}

function userLabel(app, id) {
  if (!id) return 'System';
  const u = byId(app, 'users', id);
  if (u === null) return 'Unknown user';
  return str(u, 'name') || str(u, 'email') || 'User';
}

function audit(app, actorId, action, collection, recordId, label, changes, reason) {
  try {
    const rec = newRecord(app, 'audit_log', {
      actor: actorId || '',
      actor_name: userLabel(app, actorId),
      action: action,
      collection: collection || '',
      record_id: recordId || '',
      record_label: (label || '').slice(0, 400),
      changes: changes || {},
      reason: (reason || '').slice(0, 2000),
    });
    app.save(rec);
  } catch (err) {
    console.error('audit write failed:', err);
  }
}

function notify(app, userId, kind, title, body, link, data) {
  if (!userId) return;
  try {
    const rec = newRecord(app, 'notifications', {
      user: userId,
      kind: kind,
      title: (title || '').slice(0, 300),
      body: (body || '').slice(0, 20000),
      link: link || '',
      read: false,
      data: data || {},
    });
    app.save(rec);
  } catch (err) {
    console.error('notification write failed:', err);
  }
}

/** Users holding any of the given roles. */
function usersWithRoles(app, roles) {
  const parts2 = roles.map(function (r) {
    return 'role = "' + r + '"';
  });
  return findMany(app, 'users', parts2.join(' || '), 'created', 0);
}

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */

function prefixFor(app, kind) {
  const map = {
    patent: 'ref_prefix_patent',
    utility_model: 'ref_prefix_patent',
    trademark: 'ref_prefix_trademark',
    design: 'ref_prefix_design',
    copyright: 'ref_prefix_copyright',
    domain: 'ref_prefix_trademark',
    agreement: 'ref_prefix_agreement',
    invention: 'ref_prefix_invention',
  };
  const fallback = {
    patent: 'P',
    utility_model: 'P',
    trademark: 'TM',
    design: 'D',
    copyright: 'CR',
    domain: 'DN',
    agreement: 'AG',
    invention: 'INV',
  };
  const v = String(setting(app, map[kind] || '', '') || '').trim();
  return v !== '' ? v.toUpperCase() : fallback[kind] || 'X';
}

function maxSeq(app, collection, prefix) {
  let max = 0;
  const rows = findMany(app, collection, 'ref ~ {:p}', '', 0, { p: prefix + '-' });
  for (const r of rows) {
    const ref = str(r, 'ref');
    if (ref.indexOf(prefix + '-') !== 0) continue;
    const n = parseInt(ref.slice(prefix.length + 1).split('-')[0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

function seq4(n) {
  const s = String(n);
  return s.length >= 4 ? s : ('0000' + s).slice(-4);
}

/** Matter reference: PREFIX-NNNN-CC. Family members share NNNN. */
function matterRef(app, ipType, jurisdiction, familyId, excludeId) {
  const prefix = prefixFor(app, ipType);
  const cc = (jurisdiction || 'XX').toUpperCase();
  let seq = '';
  if (familyId) {
    const members = findMany(app, 'matters', 'family = {:f} && ref != ""', 'created', 0, { f: familyId });
    for (const m of members) {
      const ref = str(m, 'ref');
      if (ref.indexOf(prefix + '-') === 0) {
        seq = ref.slice(prefix.length + 1).split('-')[0];
        break;
      }
    }
  }
  if (seq === '') seq = seq4(maxSeq(app, 'matters', prefix) + 1);
  let ref = prefix + '-' + seq + '-' + cc;
  let n = 1;
  for (;;) {
    const clash = findOne(app, 'matters', 'ref = {:r}', { r: ref });
    if (clash === null || (excludeId && clash.id === excludeId)) break;
    n += 1;
    ref = prefix + '-' + seq + '-' + cc + '-' + n;
  }
  return ref;
}

function simpleRef(app, collection, kind) {
  const prefix = prefixFor(app, kind);
  return prefix + '-' + seq4(maxSeq(app, collection, prefix) + 1);
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

function body(e) {
  try {
    return e.requestInfo().body || {};
  } catch {
    return {};
  }
}

function asArray(v) {
  if (v === null || v === undefined || v === '') return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [p];
    } catch {
      return [v];
    }
  }
  return [v];
}

function asObject(v) {
  if (v === null || v === undefined || v === '') return {};
  if (typeof v === 'object') return v;
  try {
    const p = JSON.parse(String(v));
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function randomToken(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  try {
    return $security.randomStringWithAlphabet(len || 40, chars);
  } catch {
    for (let i = 0; i < (len || 40); i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(input) {
  const s = unescape(encodeURIComponent(String(input)));
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i);
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) : NaN;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) : NaN;
    const n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    out += isNaN(b) ? '=' : B64.charAt((n >> 6) & 63);
    out += isNaN(c) ? '=' : B64.charAt(n & 63);
  }
  return out;
}

function formEncode(obj) {
  return Object.keys(obj)
    .map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
    })
    .join('&');
}

function money(n, currency) {
  if (n === null || n === undefined || isNaN(n)) return '';
  const fixed = Math.round(n * 100) / 100;
  const text = Math.abs(fixed).toFixed(fixed % 1 === 0 ? 0 : 2);
  const dot = text.indexOf('.');
  const whole = dot < 0 ? text : text.slice(0, dot);
  const frac = dot < 0 ? '' : text.slice(dot);
  // Group thousands by hand (Goja's regex engine mishandles the usual lookahead).
  let grouped = '';
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ',';
    grouped += whole.charAt(i);
  }
  return (currency ? currency + ' ' : '') + (fixed < 0 ? '-' : '') + grouped + frac;
}

module.exports = {
  pad2: pad2,
  d10: d10,
  toPb: toPb,
  parts: parts,
  addYMD: addYMD,
  addDays: addDays,
  diffDays: diffDays,
  weekday: weekday,
  weekdayName: weekdayName,
  endOfMonth: endOfMonth,
  isLastDayOfMonth: isLastDayOfMonth,
  daysInMonth: daysInMonth,
  today: today,
  nowIso: nowIso,
  human: human,
  cmpDay: cmpDay,
  minDay: minDay,
  j: j,
  plain: plain,
  str: str,
  num: num,
  bool: bool,
  findOne: findOne,
  findMany: findMany,
  byId: byId,
  newRecord: newRecord,
  findKey: findKey,
  findAll: findAll,
  txt: txt,
  officeDate: officeDate,
  validDay: validDay,
  settings: settings,
  setting: setting,
  roleOf: roleOf,
  actorId: actorId,
  deny: deny,
  fail: fail,
  canEdit: canEdit,
  canManage: canManage,
  isAdmin: isAdmin,
  canContribute: canContribute,
  canRead: canRead,
  userLabel: userLabel,
  refreshInventorUsers: refreshInventorUsers,
  audit: audit,
  notify: notify,
  usersWithRoles: usersWithRoles,
  prefixFor: prefixFor,
  matterRef: matterRef,
  simpleRef: simpleRef,
  body: body,
  asArray: asArray,
  asObject: asObject,
  randomToken: randomToken,
  base64: base64,
  formEncode: formEncode,
  money: money,
};
