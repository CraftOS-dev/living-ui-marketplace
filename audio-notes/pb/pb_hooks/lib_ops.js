/// <reference path="../pb_data/types.d.ts" />
/**
 * Op plumbing: one handler shape, typed params, errors as JSON.
 *
 * The agent-app CLI sends every param as a STRING (query string for GET,
 * JSON body for POST); the UI sends real JSON types. The readers below accept
 * both, and anything else is a 400 that names the param. Errors answer
 * { status, message }.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Run fn(params) and answer JSON; thrown {status} errors keep their code. */
function handle(e, fn) {
  try {
    const info = e.requestInfo();
    const params = {};
    const query = info.query || {};
    for (const k of Object.keys(query)) params[k] = query[k];
    const body = info.body || {};
    for (const k of Object.keys(body)) params[k] = body[k];
    return e.json(200, fn(params, e.app, e));
  } catch (err) {
    const status = err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.error('[audio-notes] op failed:', err);
    // PocketBase's own error shape, so SDK clients surface the message.
    return e.json(status, { status: status, message: String((err && err.message) || err) });
  }
}

function has(p, name) {
  return p[name] !== undefined && p[name] !== null;
}

function str(p, name, dflt) {
  if (!has(p, name)) return dflt;
  const v = p[name];
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
  const v = p[name];
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  throw fail(400, name + ' must be true or false');
}

function int(p, name, dflt, min, max) {
  if (!has(p, name)) return dflt;
  const n = typeof p[name] === 'number' ? p[name] : Number(String(p[name]).trim());
  if (!Number.isInteger(n) || n < min || n > max) throw fail(400, name + ' must be a whole number from ' + min + ' to ' + max);
  return n;
}

/** A list of strings: a real array, or (from the CLI) a JSON array string. */
function strings(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON list of strings, e.g. ["Sarah Chen","Marcus Lee"]');
    }
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw fail(400, name + ' must be a list of strings, e.g. ["Sarah Chen","Marcus Lee"]');
  }
  return v.map((x) => x.trim()).filter((x) => x !== '');
}

/** A list of objects: a real array, or (from the CLI) a JSON array string. */
function jsonList(p, name) {
  if (!has(p, name)) return undefined;
  let v = p[name];
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw fail(400, name + ' must be a JSON list');
    }
  }
  if (!Array.isArray(v)) throw fail(400, name + ' must be a list');
  return v;
}

/** Today's date on this machine (the app runs where its user is). */
function today() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function day(p, name, dflt) {
  const v = str(p, name, '');
  if (v === '') return dflt;
  if (!require(`${__hooks}/lib_notes.js`).isDay(v)) throw fail(400, name + ' must be a date YYYY-MM-DD');
  return v;
}

/** Whisper language: 'auto' or a lowercase ISO 639-1 code. */
function language(p, name, dflt) {
  const v = str(p, name, '').toLowerCase();
  if (v === '') return dflt;
  if (v !== 'auto' && !/^[a-z]{2,3}$/.test(v)) throw fail(400, name + " must be 'auto' or a language code such as en, ja, zh");
  return v;
}

module.exports = {
  fail: fail,
  handle: handle,
  str: str,
  req: req,
  bool: bool,
  int: int,
  strings: strings,
  jsonList: jsonList,
  today: today,
  day: day,
  language: language,
};
