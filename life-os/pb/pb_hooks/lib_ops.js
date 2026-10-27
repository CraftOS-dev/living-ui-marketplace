/// <reference path="../pb_data/types.d.ts" />
/**
 * The dispatcher every operation route goes through (routes.pb.js):
 *
 *   1. look the operation up in the catalog,
 *   2. work out who is calling (the person, or your AI agent by its token)
 *      and refuse what the caller may not run,
 *   3. read the parameters against the declaration (unknown or missing
 *      parameters, enums, numbers and booleans) so a wrong call fails in
 *      one clear step,
 *   4. run the handler, or, for your AI agent on an operation that changes a
 *      person's own work, store a proposal a person approves,
 *   5. answer JSON (PocketBase's error shape plus a machine `code`), and
 *   6. tell open screens which collections changed (lib_bus).
 */

const MODS = {};
/** A module of this app, required once per VM (require is slow in the hooks' engine). */
function mod(name) {
  return MODS[name] || (MODS[name] = require(`${__hooks}/${name}.js`));
}

/** The request's parameters (query and body), read before anything else. */
function rawParams(e) {
  const info = e.requestInfo();
  const raw = {};
  const query = info.query || {};
  for (const k of Object.keys(query)) raw[k] = query[k];
  const body = info.body || {};
  for (const k of Object.keys(body)) raw[k] = body[k];
  let multipart = false;
  try {
    multipart = String(e.request.header.get('Content-Type') || '').indexOf('multipart/form-data') >= 0;
  } catch {
    multipart = false;
  }
  return { raw: raw, multipart: multipart };
}

/** Validate a params object against the declaration (also used for stored proposals). */
function check(raw, spec, u, multipart) {
  const decl = spec.params || {};
  const files = spec.files || [];
  const out = {};
  for (const k of Object.keys(raw)) {
    if (files.indexOf(k) >= 0) continue;
    if (decl[k] === undefined) {
      const names = Object.keys(decl);
      const near = u.nearest(k, names);
      throw u.fail(400, 'Unknown parameter "' + k + '" for ' + spec.name + (near !== '' ? ' (did you mean ' + near + '?)' : '') + '. It takes: ' + (names.length > 0 ? names.join(', ') : 'no parameters') + '.', 'unknown_param', { param: k });
    }
  }
  for (const k of Object.keys(decl)) {
    const d = decl[k];
    let v = raw[k];
    if (multipart && Array.isArray(v) && v.length === 1) v = v[0];
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (d.required) throw u.fail(400, k + ' is required' + (d.example ? ', e.g. --' + k + ' ' + d.example : '') + '.', 'missing_param', { param: k });
      // An explicit empty text clears a field (e.g. --note ""); absent stays absent.
      if (v === '' && (d.type === 'string' || d.type === undefined)) out[k] = '';
      continue;
    }
    if (d.type === 'boolean') {
      const s = typeof v === 'string' ? v.trim().toLowerCase() : v;
      if (s === true || s === 'true' || s === '1') v = true;
      else if (s === false || s === 'false' || s === '0') v = false;
      else throw u.fail(400, k + ' must be true or false.', 'invalid_param', { param: k });
    } else if (d.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) throw u.fail(400, k + ' must be a number.', 'invalid_param', { param: k });
      v = n;
    } else if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      // Lists and objects arrive from the UI as real JSON; handlers read them with u.list / u.obj.
      out[k] = v;
      continue;
    } else {
      v = String(v);
    }
    if (d.enum && d.enum.indexOf(String(v)) < 0) throw u.fail(400, k + ' must be one of: ' + d.enum.join(', ') + '.', 'invalid_param', { param: k });
    out[k] = v;
  }
  return out;
}

function handler(spec) {
  const parts = spec.fn.split('.');
  const fn = mod(parts[0])[parts[1]];
  if (typeof fn !== 'function') throw new Error('handler ' + spec.fn + ' is missing');
  return fn;
}

/** Run an operation for an HTTP request. */
function run(e, name) {
  const started = Date.now();
  const u = mod('lib_util');
  let status = 200;
  let body;
  let ctx = null;
  try {
    const spec = mod('lib_catalog').get(name);
    const read = rawParams(e);
    ctx = mod('lib_auth').context(e, spec);
    const params = check(read.raw, spec, u, read.multipart);
    // A deletion your AI agent runs itself: only with --confirm true; otherwise say what would go.
    if (spec.params && spec.params.confirm !== undefined && spec.destructive) {
      const confirmed = params.confirm === true;
      delete params.confirm;
      if (ctx.isAgent && !confirmed) {
        const what = Object.keys(params)
          .filter((k) => params[k] !== '' && params[k] !== undefined)
          .map((k) => k + ' ' + JSON.stringify(params[k]))
          .join(', ');
        throw u.fail(409, 'Nothing was deleted. ' + spec.name + ' would: ' + String(spec.desc || '').split('. ')[0].replace(/\.$/, '') + (what !== '' ? ' (' + what + ')' : '') + '. If the person asked for this, run the same command with --confirm true.', 'confirm_required', { op: spec.name });
      }
    }
    // Settings "propose everything": your AI agent's captures and plan changes wait for the person too.
    const proposeAll = ctx.isAgent && spec.agent !== 'propose' && (spec.effect === 'capture' || spec.effect === 'plan') && spec.method === 'POST' && spec.always !== true && mod('lib_core').settings(e.app).getString('agent_autonomy') === 'propose_all';
    if (ctx.isAgent && (spec.agent === 'propose' || proposeAll)) {
      body = mod('lib_agent').proposeOrRun(ctx, spec, params);
    } else {
      body = handler(spec)(ctx, params);
    }
    if (body && body.__streamed === true) {
      mod('lib_bus').flush(e.app);
      return;
    }
    if (body === undefined || body === null) body = { ok: true };
  } catch (err) {
    status = u.statusOf(err);
    if (status >= 500) console.error('[lo] ' + name + ' failed:', err);
    let message = String((err && err.message) || err);
    // A server fault is logged above in full; the caller gets no SQL or engine text.
    if (status >= 500) message = message.indexOf('UNIQUE constraint failed') >= 0 ? 'That would duplicate an existing record.' : 'Something went wrong on the server; it has been logged. Try again.';
    if (status === 409 && message.indexOf('UNIQUE constraint failed') >= 0) message = 'That would duplicate an existing record.';
    body = {
      status: status,
      message: message,
      code: (err && err.code) || (status === 409 ? 'conflict' : status >= 500 ? 'error' : 'invalid'),
      data: (err && err.extra) || {},
    };
  }
  mod('lib_bus').flush(e.app);
  try {
    e.response.header().set('Server-Timing', 'op;dur=' + (Date.now() - started));
  } catch {
    /* timing is a courtesy */
  }
  return e.json(status, body);
}

/**
 * Run a stored operation as `ctx` (approving a proposal). The params were
 * validated when the proposal was made and are checked again here.
 */
function runAs(ctx, name, params) {
  const u = mod('lib_util');
  const spec = mod('lib_catalog').get(name);
  return handler(spec)(ctx, check(params, spec, u, false));
}

module.exports = { run: run, runAs: runAs, check: check, handler: handler };
