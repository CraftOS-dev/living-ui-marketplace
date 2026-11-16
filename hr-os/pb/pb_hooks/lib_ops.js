/// <reference path="../pb_data/types.d.ts" />
/**
 * The dispatcher every operation route goes through (routes.pb.js):
 *
 *   1. look the operation up in the catalog,
 *   2. work out who is calling (a signed-in member by token, your AI agent
 *      by X-A2App-Token against APP/.agent-token, or nobody) and check the
 *      declared permission,
 *   3. read the parameters against the declaration,
 *   4. for `effect: 'confirm'`, check the caller's approval PIN,
 *   5. for your AI agent on a `propose` op, store a proposal unless the
 *      owner set that kind to automatic,
 *   6. run the handler,
 *   7. write an audit row for every write (unless the handler wrote its own),
 *   8. answer JSON ({status, message, code, data} on errors), tell open
 *      screens which collections changed (lib_bus) and set Server-Timing.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** The request's parameters (query and body). */
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
function check(raw, spec, multipart) {
  const u = L('lib_util');
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
    if (v === '' && d.type === 'string') {
      if (d.required) throw u.fail(400, k + ' is required' + (d.example ? ', e.g. --' + k + ' ' + d.example : '') + '.', 'missing_param', { param: k });
      out[k] = '';
      continue;
    }
    if (v === undefined || v === null || v === '') {
      if (d.required) throw u.fail(400, k + ' is required' + (d.example ? ', e.g. --' + k + ' ' + d.example : '') + '.', 'missing_param', { param: k });
      continue;
    }
    if (d.type === 'boolean') {
      const s = typeof v === 'string' ? v.trim().toLowerCase() : v;
      if (s === true || s === 'true' || s === '1' || s === 'yes') v = true;
      else if (s === false || s === 'false' || s === '0' || s === 'no') v = false;
      else throw u.fail(400, k + ' must be true or false.', 'invalid_param', { param: k });
    } else if (d.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) throw u.fail(400, k + ' must be a number.', 'invalid_param', { param: k });
      v = n;
    } else if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      // Lists and objects arrive from the screens as real JSON; handlers read them with u.list / u.obj.
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
  const fn = L(parts[0])[parts[1]];
  if (typeof fn !== 'function') throw new Error('handler ' + spec.fn + ' is missing');
  return fn;
}

/** The params as the audit trail keeps them: secret params and files left out, long text clipped. */
function scrub(spec, params) {
  const decl = spec.params || {};
  const out = {};
  for (const k of Object.keys(params || {})) {
    if (decl[k] && decl[k].secret) continue;
    let v = params[k];
    if (typeof v === 'string' && v.length > 300) v = v.slice(0, 300) + '...';
    else if (v !== null && typeof v === 'object') {
      const s = JSON.stringify(v);
      v = s.length > 600 ? s.slice(0, 600) + '...' : v;
    }
    out[k] = v;
  }
  return out;
}

// How to read answers (money, days): told once in app.guide (conventions), not in every answer.
const UNITS =
  'Money fields ending _minor are integers of the currency named with them: USD 123456 is 1,234.56; JPY has no minor unit (123456 is 123,456 yen); KWD has three decimals. Money params you send are major units ("1250.50"). Days are YYYY-MM-DD, times HH:MM. A "total" next to a list is the number of rows.';

/**
 * Before your AI agent's call becomes a proposal, run it once inside a
 * transaction that is rolled back: a call that would fail (a missing or
 * impossible value, an unknown location, department, entity or employee)
 * is refused now with the handler's own message instead of failing when a
 * person accepts it.
 */
function dryRun(ctx, spec, params) {
  const u = L('lib_util');
  const given = Object.keys(params).filter((k) => k !== 'why' && params[k] !== '' && params[k] !== undefined && params[k] !== null);
  if (given.length === 0 && Object.keys(spec.params || {}).filter((k) => k !== 'why').length > 0) {
    throw u.fail(400, 'Nothing to propose: ' + spec.name + ' was called without any of its params (' + Object.keys(spec.params).filter((k) => k !== 'why').join(', ') + ').', 'empty_proposal', { op: spec.name });
  }
  const OK = '__hr_dry_run_ok__';
  const clean = Object.assign({}, params);
  delete clean.why;
  try {
    ctx.app.runInTransaction((tx) => {
      const c = Object.assign({}, ctx, { app: tx, audited: false, auditInfo: null, dryRun: true });
      handler(spec)(c, Object.assign({}, clean));
      throw new Error(OK);
    });
  } catch (err) {
    if (String((err && err.message) || err).indexOf(OK) >= 0) return;
    const status = u.statusOf(err);
    if (status >= 500) {
      console.error('[hr] dry run of ' + spec.name + ' failed:', err);
      throw u.fail(400, 'Not proposed: ' + spec.name + ' could not be checked with these params. Check them with the person.', 'proposal_invalid', { op: spec.name });
    }
    throw u.fail(status, 'Not proposed: ' + String((err && err.message) || err), (err && err.code) || 'proposal_invalid', Object.assign({ op: spec.name }, (err && err.extra) || {}));
  }
}

/** Run an operation for an HTTP request. */
function run(e, name) {
  const started = Date.now();
  const u = L('lib_util');
  let status = 200;
  let body;
  let ctx = null;
  let spec = null;
  try {
    spec = L('lib_catalog').get(name);
    const read = rawParams(e);
    ctx = L('lib_auth').context(e, spec);
    const params = check(read.raw, spec, read.multipart);
    if (spec.effect === 'confirm') {
      L('lib_auth').verifyPin(ctx, params.pin);
      delete params.pin;
    }
    if (spec.destructive && spec.params.confirm !== undefined) {
      const confirmed = params.confirm === true;
      delete params.confirm;
      if (ctx.isAgent && !confirmed) {
        const what = Object.keys(params)
          .filter((k) => params[k] !== '' && params[k] !== undefined)
          .map((k) => k + ' ' + JSON.stringify(params[k]))
          .join(', ');
        throw u.fail(409, 'Nothing was deleted. ' + spec.name + ' would: ' + String(spec.desc || '').split('. ')[0].replace(/\.$/, '') + (what !== '' ? ' (' + what + ')' : '') + '. If the person asked for this, run it again with --confirm true.', 'confirm_required', { op: spec.name });
      }
    }
    if (ctx.isAgent && spec.agent === 'propose' && !L('lib_settings').autoAllowed(e.app, spec.kind)) {
      dryRun(ctx, spec, params);
      body = L('lib_proposals').fromCall(ctx, spec, params);
      L('lib_audit').write(ctx, { op: spec.name, collection: 'proposals', record: body.proposal || '', summary: 'Your AI agent proposed: ' + (body.label || spec.name), data: { params: scrub(spec, params) } });
    } else {
      if (spec.agent === 'propose') delete params.why;
      body = handler(spec)(ctx, params);
      if (spec.effect !== 'read' && !ctx.audited) {
        const a = ctx.auditInfo || {};
        L('lib_audit').write(ctx, { op: spec.name, collection: a.collection || '', record: a.record || '', summary: a.summary || spec.name, before: a.before, after: a.after, data: { params: scrub(spec, params) } });
      }
    }
    if (ctx.isAgent && spec.effect !== 'read') {
      try {
        L('lib_agent').delivered(ctx, spec.name, params);
      } catch (err) {
        console.error('[hr] closing the ask of ' + spec.name + ' failed:', err);
      }
    }
    if (body && body.__streamed === true) {
      L('lib_bus').flush(e.app);
      return;
    }
    if (body === undefined || body === null) body = { ok: true };
  } catch (err) {
    status = u.statusOf(err);
    if (status >= 500) console.error('[hr] ' + name + ' failed:', err);
    let message = String((err && err.message) || err);
    if (status >= 500) message = message.indexOf('UNIQUE constraint failed') >= 0 ? 'That would duplicate an existing record.' : 'Something went wrong on the server; it has been logged. Try again, and tell an administrator if it keeps happening.';
    body = {
      status: status,
      message: message,
      code: (err && err.code) || (status === 409 ? 'conflict' : status >= 500 ? 'error' : 'invalid'),
      data: (err && err.extra) || {},
    };
  }
  L('lib_bus').flush(e.app);
  try {
    e.response.header().set('Server-Timing', 'op;dur=' + (Date.now() - started));
  } catch {
    /* timing is a courtesy */
  }
  return e.json(status, body);
}

/**
 * Run an operation as `ctx` outside a request (accepting a proposal): the
 * permission is checked for that person and the params again, then the
 * handler runs and the audit row is written as for a request.
 */
function runAs(ctx, name, params) {
  const spec = L('lib_catalog').get(name);
  const c = Object.assign({}, ctx, { op: spec.name, spec: spec, audited: false, auditInfo: null });
  L('lib_auth').checkPerm(c, spec);
  const clean = check(params || {}, spec, false);
  delete clean.why;
  delete clean.confirm;
  const out = handler(spec)(c, clean);
  if (spec.effect !== 'read' && !c.audited) {
    const a = c.auditInfo || {};
    L('lib_audit').write(c, { op: spec.name, collection: a.collection || '', record: a.record || '', summary: a.summary || spec.name, before: a.before, after: a.after, data: { params: scrub(spec, clean) } });
  }
  return out === undefined || out === null ? { ok: true } : out;
}

module.exports = { run: run, runAs: runAs, check: check, handler: handler, scrub: scrub, dryRun: dryRun, UNITS: UNITS };
