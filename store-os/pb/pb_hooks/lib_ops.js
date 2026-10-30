/// <reference path="../pb_data/types.d.ts" />
/**
 * The dispatcher every operation route goes through (routes.pb.js):
 *
 *   1. look the operation up in the catalog,
 *   2. work out who is calling (you, or your AI agent by its token) and
 *      refuse what the caller may not run,
 *   3. read the parameters against the declaration (unknown or missing
 *      parameters, enums, numbers, booleans) so a wrong call fails in one
 *      clear step,
 *   4. when your AI agent calls an operation marked agent 'propose' and your
 *      limits say "ask me" for that kind of change, store it as a proposal
 *      for you to approve instead of running it,
 *   5. run the handler,
 *   6. answer JSON (PocketBase's error shape plus a machine `code`), and
 *   7. tell open screens which collections changed (lib_bus).
 */

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
    // An explicit empty text is a value (--value "" clears a field); absent stays absent.
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
      const n = typeof v === 'number' ? v : Number(String(v).trim().split(',').join(''));
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

/** Run a handler by its catalog name with a context of your choosing (approvals, tasks). */
function call(ctx, name, params) {
  const spec = require(`${__hooks}/lib_catalog.js`).get(name);
  const parts = spec.fn.split('.');
  const fn = require(`${__hooks}/${parts[0]}.js`)[parts[1]];
  if (typeof fn !== 'function') throw new Error('handler ' + spec.fn + ' is missing');
  const out = fn(ctx, params || {});
  return out === undefined || out === null ? { ok: true } : out;
}

function run(e, name) {
  const started = Date.now();
  const u = require(`${__hooks}/lib_util.js`);
  let status = 200;
  let body;
  try {
    const spec = require(`${__hooks}/lib_catalog.js`).get(name);
    const read = rawParams(e);
    const ctx = require(`${__hooks}/lib_auth.js`).context(e, spec);
    const params = check(read.raw, spec, u, read.multipart);
    if (spec.destructive && spec.params && spec.params.confirm !== undefined) {
      const confirmed = params.confirm === true;
      delete params.confirm;
      // A wrong reference fails now, not after the seller confirmed.
      let named = '';
      if (spec.lookup) {
        const lp = spec.lookup.split('.');
        named = String(require(`${__hooks}/${lp[0]}.js`)[lp[1]](ctx, params) || '');
      }
      if (ctx.isAgent && !confirmed) {
        const what =
          named !== ''
            ? named
            : Object.keys(params)
                .filter((k) => params[k] !== '' && params[k] !== undefined)
                .map((k) => k + ' ' + JSON.stringify(params[k]))
                .join(', ');
        throw u.fail(409, 'Nothing was deleted. ' + spec.name + ' would ' + String(spec.desc || '').split('. ')[0].replace(/\.$/, '').toLowerCase() + (what !== '' ? ' (' + what + ')' : '') + '. If the seller asked for this, run it again with --confirm true.', 'confirm_required', { op: spec.name });
      }
    }
    if (ctx.isAgent && spec.agent === 'propose' && !require(`${__hooks}/lib_store.js`).autoAllowed(e.app, spec.kind)) {
      body = require(`${__hooks}/lib_proposals.js`).fromCall(ctx, spec, params);
    } else {
      if (spec.agent === 'propose') delete params.why;
      const parts = spec.fn.split('.');
      const fn = require(`${__hooks}/${parts[0]}.js`)[parts[1]];
      if (typeof fn !== 'function') throw new Error('handler ' + spec.fn + ' is missing');
      body = fn(ctx, params);
    }
    if (body === undefined || body === null) body = { ok: true };
  } catch (err) {
    status = u.statusOf(err);
    if (status >= 500) console.error('[store] ' + name + ' failed:', err);
    let message = String((err && err.message) || err);
    if (status >= 500) message = message.indexOf('UNIQUE constraint failed') >= 0 ? 'That would duplicate an existing record.' : 'Something went wrong on the server; it has been logged. Try again.';
    body = {
      status: status,
      message: message,
      code: (err && err.code) || (status >= 500 ? 'error' : 'invalid'),
      data: (err && err.extra) || {},
    };
  }
  require(`${__hooks}/lib_bus.js`).flush(e.app);
  try {
    e.response.header().set('Server-Timing', 'op;dur=' + (Date.now() - started));
  } catch {
    /* timing is a courtesy */
  }
  return e.json(status, body);
}

module.exports = { run: run, check: check, call: call };
