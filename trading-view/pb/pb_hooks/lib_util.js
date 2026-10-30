/// <reference path="../pb_data/types.d.ts" />
/**
 * Op plumbing: one handler shape, typed param readers, errors as JSON.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET, JSON
 * body for POST); the UI sends real JSON types and multipart forms. Every
 * reader accepts both and answers a 400 that names the param and shows a
 * valid example, so the caller can fix the call in one step.
 */

/** app.store() key: when the AI agent last called an op (ms), see lib_agent.settleStale. */
const AGENT_SEEN = 'tv_agent_seen';

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
    if (status >= 500) console.error('[trading-view] op failed:', err);
    // PocketBase's own error shape, so SDK clients surface the message.
    return e.json(status, { status: status, message: String((err && err.message) || err) });
  }
}

/**
 * Who is calling: { actor: 'agent' | 'user', run }. Calls from the AI agent
 * are grouped into runs: a run continues while the agent keeps calling (gaps
 * under RUN_GAP_MINUTES), so a whole job can be reviewed and reverted at once.
 */
const RUN_GAP_MINUTES = 10;

function actor(e) {
  if (!fromAgent(e)) return { actor: 'user', run: '' };
  const store = e.app.store();
  const now = Date.now();
  let r = store.get('tv_run');
  if (!r || now - r.last > RUN_GAP_MINUTES * 60 * 1000) r = { id: 'run' + $security.randomStringWithAlphabet(12, 'abcdefghijklmnopqrstuvwxyz0123456789'), started: now, last: now };
  r.last = now;
  store.set('tv_run', r);
  return { actor: 'agent', run: r.id };
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

/** Text kept as written (inner line breaks and spacing), only trimmed at the ends. */
function text(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = scalar(p[name]);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v !== 'string') throw fail(400, name + ' must be text');
  return v.replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '');
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

function num(p, name, dflt, min, max) {
  if (!has(p, name) || scalar(p[name]) === '') return dflt;
  const raw = scalar(p[name]);
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!isFinite(n) || n < min || n > max) throw fail(400, name + ' must be a number from ' + min + ' to ' + max);
  return n;
}

function int(p, name, dflt, min, max) {
  const n = num(p, name, dflt, min, max);
  if (n !== dflt && !Number.isInteger(n)) throw fail(400, name + ' must be a whole number from ' + min + ' to ' + max);
  return n;
}

function oneOf(p, name, values, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (values.indexOf(v) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '));
  return v;
}

/**
 * A list: a real array, or (from the CLI) a JSON array string. A one-item
 * list ["id"] stays a list. A plain comma-separated string is accepted when
 * `commas` is set (tags written as "a, b").
 */
function list(p, name, commas) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && v[0].trim().charAt(0) === '[') v = v[0];
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return [];
    if (t.charAt(0) === '[') {
      try {
        v = JSON.parse(t);
      } catch {
        throw fail(400, name + ' must be a JSON list, e.g. ["a","b"]');
      }
    } else if (commas) {
      v = t.split(',');
    } else {
      v = [t];
    }
  }
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list');
  return v;
}

/** A JSON object param: a real object, or (from the CLI) a JSON object string. */
function obj(p, name) {
  if (!has(p, name)) return undefined;
  let v = scalar(p[name]);
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON object');
    }
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw fail(400, name + ' must be a JSON object');
  return v;
}

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

/** Collapse whitespace and trim. */
function squash(s) {
  return String(s || '')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

/** PocketBase datetime text for a moment in ms, comparable with stored dates in filters. */
function pbTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/** A record's JSON field as a plain value (PocketBase hands json fields over as raw bytes). */
function json(rec, field, dflt) {
  try {
    const raw = rec.getString(field);
    if (raw === '' || raw === 'null') return dflt;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? dflt : v;
  } catch {
    return dflt;
  }
}

module.exports = {
  AGENT_SEEN: AGENT_SEEN,
  fail: fail,
  actor: actor,
  handle: handle,
  fromAgent: fromAgent,
  has: has,
  str: str,
  text: text,
  req: req,
  bool: bool,
  num: num,
  int: int,
  oneOf: oneOf,
  list: list,
  obj: obj,
  findOne: findOne,
  byId: byId,
  squash: squash,
  pbTime: pbTime,
  json: json,
};
