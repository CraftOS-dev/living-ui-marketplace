/// <reference path="../pb_data/types.d.ts" />
/**
 * Op plumbing: one handler shape, typed param readers, errors as JSON.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET, JSON
 * body for POST); the UI sends real JSON types and multipart forms. Every
 * reader accepts both and answers a 400 that names the param and shows a
 * valid example, so the caller can fix the call in one step.
 */

/** app.store() key: when the AI agent last called an op (ms), see lib_receipts.settleStale. */
const AGENT_SEEN = 'et_agent_seen';

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
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
    if (fromAgent(e)) e.app.store().set(AGENT_SEEN, Date.now());
    const out = fn(params, e.app, e);
    return e.json(200, out === undefined ? { ok: true } : out);
  } catch (err) {
    const status = err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.error('[expenses] op failed:', err);
    // PocketBase's own error shape, so SDK clients surface the message. A hint
    // meant for agents (a CLI param to use) is added only for agent calls.
    let message = String((err && err.message) || err);
    if (err && typeof err.agentHint === 'string' && fromAgent(e)) message += ' ' + err.agentHint;
    return e.json(status, { status: status, message: message });
  }
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

function req(p, name) {
  const v = str(p, name, '');
  if (v === '') throw fail(400, name + ' is required');
  return v;
}

function bool(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = scalar(p[name]);
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
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

/**
 * A list: a real array, or (from the CLI) a JSON array string. Not scalar():
 * a one-item list ["id"] is a list, never the bare "id". Only a multipart
 * field holding one JSON array string is unwrapped.
 */
function list(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && v[0].trim().charAt(0) === '[') v = v[0];
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON list, e.g. ["id1","id2"]');
    }
  }
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list');
  return v;
}

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
  return d <= daysInMonth(y, m);
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function day(p, name, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (!isDay(v)) throw fail(400, name + ' must be a real date written YYYY-MM-DD, e.g. ' + today());
  return v;
}

function month(p, name, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (!/^\d{4}-\d{2}$/.test(v) || Number(v.slice(5, 7)) < 1 || Number(v.slice(5, 7)) > 12) {
    throw fail(400, name + ' must be a month written YYYY-MM, e.g. ' + today().slice(0, 7));
  }
  return v;
}

/** Day arithmetic on 'YYYY-MM-DD' strings (UTC math, no timezone drift). */
function addDays(dayStr, n) {
  const t = Date.UTC(Number(dayStr.slice(0, 4)), Number(dayStr.slice(5, 7)) - 1, Number(dayStr.slice(8, 10)));
  const d = new Date(t + n * 86400000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/** Shift a month 'YYYY-MM' by n months. */
function addMonths(monthStr, n) {
  const y = Number(monthStr.slice(0, 4));
  const m = Number(monthStr.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return yy + '-' + pad(mm + 1);
}

/** [first day, first day of next month) for a month 'YYYY-MM'. */
function monthRange(monthStr) {
  return { from: monthStr + '-01', to: addMonths(monthStr, 1) + '-01' };
}

/** Find one record or null (PocketBase find helpers throw on no rows). */
function findOne(app, collection, filter, params) {
  const rows = app.findRecordsByFilter(collection, filter, '', 1, 0, params || {});
  return rows.length > 0 ? rows[0] : null;
}

function byId(app, collection, id) {
  try {
    return app.findRecordById(collection, id);
  } catch {
    return null;
  }
}

/** Collapse whitespace and trim: how notes and names are compared. */
function squash(s) {
  return String(s || '')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

module.exports = {
  AGENT_SEEN: AGENT_SEEN,
  fail: fail,
  handle: handle,
  fromAgent: fromAgent,
  has: has,
  str: str,
  req: req,
  bool: bool,
  int: int,
  oneOf: oneOf,
  list: list,
  pad: pad,
  today: today,
  isDay: isDay,
  daysInMonth: daysInMonth,
  day: day,
  month: month,
  addDays: addDays,
  addMonths: addMonths,
  monthRange: monthRange,
  findOne: findOne,
  byId: byId,
  squash: squash,
};
