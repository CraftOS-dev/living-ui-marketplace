/// <reference path="../pb_data/types.d.ts" />
/**
 * The dispatcher every operation route goes through (routes.pb.js):
 *
 *   1. look the operation up in the catalog,
 *   2. work out who is calling (a signed-in member by token, your AI agent
 *      by X-A2App-Token against APP/.agent-token, or nobody) and check the
 *      declared permission; a people-only op called by your AI agent is
 *      refused with agent_not_permitted before any param or PIN check,
 *   3. read the parameters against the declaration,
 *   4. for `effect: 'confirm'` (and an op whose `pinIf` says so for these
 *      params), check the caller's approval PIN,
 *   5. for your AI agent on a `propose` op, dry-run it in a rolled-back
 *      transaction and store a proposal, unless the owner promoted that
 *      kind to automatic,
 *   6. run the handler; a write runs inside ONE transaction through the
 *      activity tracker (lib_activity), so the op is atomic and undoable as
 *      one unit (unless the op says `track: false`),
 *   7. write an audit row for every write (unless the handler wrote its own),
 *   8. answer JSON ({status, message, code, data} on errors; `_activity`
 *      names the undo unit of a write), tell open screens which collections
 *      changed (lib_bus) and set Server-Timing.
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

/* ------------------------------------------------ answers for your AI agent */

const CLIP = 600;
/** Reads whose long text your AI agent asked for in full (one record, a file's text, the guide): never clipped. */
const WHOLE_VERBS = ['get', 'text', 'guide', 'download', 'image', 'logo', 'status'];

/** The get op that reads one row of a list op in full, with its id param: { op, param } or null. */
function getOpFor(name) {
  const group = name.split('.')[0];
  const cat = L('lib_catalog');
  if (!cat.has(group + '.get')) return null;
  const g = cat.get(group + '.get');
  const req = Object.keys(g.params || {}).filter((k) => g.params[k].required);
  return req.length === 1 ? { op: g.name, param: req[0] } : null;
}

/**
 * Shape an answer for your AI agent (SPEC qa-cli RULING CLI-09): field
 * provenance (prov) is left out, and in list answers a text over 600
 * characters is clipped with a marker naming the op that reads it in full.
 * --full true answers everything as stored.
 */
function forAgent(spec, body, full) {
  if (full || body === null || typeof body !== 'object') return body;
  const verb = spec.name.split('.')[1] || '';
  const clip = spec.effect === 'read' && WHOLE_VERBS.indexOf(verb) < 0;
  const getOp = clip ? getOpFor(spec.name) : null;
  let clipped = 0;
  const walk = (v, rowId, depth) => {
    if (depth > 12) return v;
    if (typeof v === 'string') {
      if (!clip || v.length <= CLIP) return v;
      clipped++;
      return v.slice(0, CLIP) + ' [clipped ' + (v.length - CLIP) + ' more characters: ' + (getOp && rowId ? getOp.op + ' --' + getOp.param + ' ' + rowId : 'add --full true') + ']';
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, x && typeof x === 'object' && typeof x.id === 'string' && depth <= 2 ? x.id : rowId, depth + 1));
    if (v === null || typeof v !== 'object') return v;
    const o = {};
    for (const k of Object.keys(v)) {
      if (k === 'prov') continue;
      // Screens' logo fields say nothing when empty (most companies have no logo).
      if ((k === 'logo_url' || k === 'logo_domain') && v[k] === '') continue;
      o[k] = walk(v[k], rowId, depth + 1);
    }
    return o;
  };
  let out = walk(body, '', 0);
  if (clipped > 0 && !Array.isArray(out)) out._clipped = clipped + ' long text' + (clipped === 1 ? ' was' : 's were') + ' clipped at ' + CLIP + ' characters; each marker names the op that reads it in full (or add --full true).';
  if (spec.effect !== 'read' && WORK_OPS.indexOf(spec.name) < 0 && !Array.isArray(out)) {
    const size = JSON.stringify(out).length;
    if (size > WRITE_MAX) {
      out = compactWrite(out);
      const g = getOpFor(spec.name);
      out._compact = 'Shortened for your AI agent (' + size + ' characters): ids, numbers, states and what changed' + (g ? '; ' + g.op + ' reads the record in full' : '') + '.';
    }
  }
  return out;
}

/** Write answers over this size are shortened for your AI agent (SPEC qa-cli RULING CLI-11). */
const WRITE_MAX = 2000;
/** Writes whose answer is the work itself (the material to read): never shortened. */
const WORK_OPS = ['triage.start', 'briefs.request', 'imports.preview', 'proposals.create'];
/** Fields that say which record and in what state: kept in nested records of a shortened answer. */
const IDENT = ['id', 'number', 'name', 'title', 'label', 'key', 'status', 'state', 'kind', 'value', 'text', 'currency', 'grade', 'step', 'proposal', 'proposed', 'message', 'email', 'role', 'stage', 'deal', 'company', 'thesis', 'item', 'job', 'outbound', 'anchor', 'file', 'page', 'day', 'period_end', 'months', 'forecast', 'flags', 'text_state'];

function miniOf(o) {
  const m = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (IDENT.indexOf(k) < 0) continue;
    if (v === null || typeof v !== 'object') m[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + ' [clipped]' : v;
    else if (Array.isArray(v))
      m[k] = v.slice(0, 10).map((x) => {
        if (x === null || typeof x !== 'object') return x;
        const o = {};
        for (const f of ['code', 'key', 'id', 'name', 'label']) if (typeof x[f] === 'string' && x[f] !== '') o[f] = x[f];
        if (typeof x.note === 'string' && x.note !== '' && x.note.length <= 200) o.note = x.note;
        return o;
      });
    else if (typeof v.id === 'string' || typeof v.number === 'string') m[k] = v.number || v.name || v.title || v.id;
  }
  return m;
}

/** The record of a write answer: its own short fields; nested records as their ids, names and states; lists of them likewise (25 at most). */
function compactWrite(body) {
  const out = {};
  for (const k of Object.keys(body)) {
    const v = body[k];
    if (v === null || typeof v !== 'object') out[k] = typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + ' [clipped]' : v;
    else if (Array.isArray(v)) out[k] = listOf(v);
    else {
      const r = {};
      for (const f of Object.keys(v)) {
        const x = v[f];
        if (x === null || typeof x !== 'object') r[f] = typeof x === 'string' && x.length > 300 ? x.slice(0, 300) + ' [clipped]' : x;
        else if (Array.isArray(x)) r[f] = listOf(x);
        else {
          const m = miniOf(x);
          if (Object.keys(m).length > 0) r[f] = m;
        }
      }
      out[k] = r;
    }
  }
  return out;
}

function listOf(v) {
  if (v.length === 0) return v;
  if (v.every((x) => x === null || typeof x !== 'object')) return v.length <= 40 ? v : v.slice(0, 40).concat(['(' + (v.length - 40) + ' more)']);
  const rows = v.slice(0, 25).map((x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? miniOf(x) : x));
  return v.length > 25 ? rows.concat([{ more: v.length - 25 }]) : rows;
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

/** Drop the kernel's proposal params (why, evidence, confidence) before a handler runs. */
function stripProposal(params) {
  const out = Object.assign({}, params);
  for (const k of L('lib_catalog').PROPOSAL_PARAMS) delete out[k];
  return out;
}

/**
 * Before your AI agent's call becomes a proposal, run it once inside a
 * transaction that is rolled back: a call that would fail (a missing or
 * impossible value, an unknown record) is refused now with the handler's
 * own message instead of failing when a person accepts it.
 */
function dryRun(ctx, spec, params) {
  const u = L('lib_util');
  const own = Object.keys(spec.params || {}).filter((k) => L('lib_catalog').PROPOSAL_PARAMS.indexOf(k) < 0);
  const given = Object.keys(params).filter((k) => own.indexOf(k) >= 0 && params[k] !== '' && params[k] !== undefined && params[k] !== null);
  if (given.length === 0 && own.length > 0) {
    throw u.fail(400, 'Nothing to propose: ' + spec.name + ' was called without any of its params (' + own.join(', ') + ').', 'empty_proposal', { op: spec.name });
  }
  const OK = '__vo_dry_run_ok__';
  const clean = stripProposal(params);
  const app = ctx.app;
  // A dry run needs a transaction of its own to roll back; inside another one its writes would stay.
  if (app.isTransactional()) throw new Error('dry run of ' + spec.name + ' inside a transaction: the calling op needs track: false');
  try {
    app.runInTransaction((tx) => {
      const c = Object.assign({}, ctx, { app: tx, audited: false, auditInfo: null, dryRun: true });
      handler(spec)(c, Object.assign({}, clean));
      throw new Error(OK);
    });
  } catch (err) {
    if (String((err && err.message) || err).indexOf(OK) >= 0) return;
    const status = u.statusOf(err);
    if (status >= 500) {
      console.error('[vo] dry run of ' + spec.name + ' failed:', err);
      throw u.fail(400, 'Not proposed: ' + spec.name + ' could not be checked with these params. Check them with the person.', 'proposal_invalid', { op: spec.name });
    }
    throw u.fail(status, 'Not proposed: ' + String((err && err.message) || err), (err && err.code) || 'proposal_invalid', Object.assign({ op: spec.name }, (err && err.extra) || {}));
  }
}

/**
 * Does this call need the caller's approval PIN: a confirm op, or an op
 * whose `pinIf: 'lib_x.fn'` (ctx, params) answers true for these params
 * (an import into a target registered with pin: true, accepting a proposal
 * of one)?
 */
function needsPin(ctx, spec, params) {
  if (spec.effect === 'confirm') return true;
  if (!spec.pinIf) return false;
  const parts = spec.pinIf.split('.');
  return L(parts[0])[parts[1]](ctx, params) === true;
}

/** May your AI agent run this propose op directly (its kind promoted to automatic, and the op's `auto` check passes)? */
function automatic(ctx, spec, params) {
  if (!L('lib_settings').autoAllowed(ctx.app, spec.kind)) return false;
  if (!spec.auto) return true;
  const parts = spec.auto.split('.');
  return L(parts[0])[parts[1]](ctx, stripProposal(params)) === true;
}

function auditWrite(ctx, spec, params) {
  if (spec.effect === 'read' || ctx.audited) return;
  const a = ctx.auditInfo || {};
  L('lib_audit').write(ctx, { op: spec.name, collection: a.collection || '', record: a.record || '', summary: a.summary || spec.name, before: a.before, after: a.after, data: { params: scrub(spec, params) } });
}

/**
 * Run the handler. A write (not `track: false`) runs inside one
 * transaction through the activity tracker and leaves one activity row;
 * answers { out, activity } (activity = the unit's id or '').
 */
function execute(ctx, spec, params, opts) {
  const o = opts || {};
  if (spec.effect === 'read' || spec.track === false) {
    const out = handler(spec)(ctx, params);
    auditWrite(ctx, spec, params);
    return { out: out, activity: '' };
  }
  const app = ctx.app;
  let out;
  let entry = '';
  app.runInTransaction((tx) => {
    const act = L('lib_activity');
    const t = act.tracker(tx);
    const c = Object.assign({}, ctx, { app: t, audited: false, auditInfo: null });
    out = handler(spec)(c, params);
    auditWrite(c, spec, params);
    const a = c.auditInfo || {};
    entry = act.record(tx, c, { op: spec.name, summary: (o.prefix || '') + (a.summary || spec.name), target_collection: a.collection || '', target_id: a.record || '', steps: t.steps() });
  });
  return { out: out, activity: entry };
}

/** Run an operation for an HTTP request. */
function run(e, name) {
  const started = Date.now();
  const u = L('lib_util');
  let status = 200;
  let body;
  let ctx = null;
  let spec = null;
  const headers = {};
  try {
    spec = L('lib_catalog').get(name);
    const read = rawParams(e);
    ctx = L('lib_auth').context(e, spec);
    const params = check(read.raw, spec, read.multipart);
    const pinNeeded = needsPin(ctx, spec, params);
    // Your AI agent never holds a PIN: its call of a propose op that needs one always becomes a proposal.
    if (pinNeeded && !(ctx.isAgent && spec.agent === 'propose')) {
      if (spec.effect !== 'confirm' && (params.pin === undefined || params.pin === '')) throw u.fail(400, 'This needs your approval PIN.', 'missing_param', { param: 'pin' });
      L('lib_auth').verifyPin(ctx, params.pin);
      ctx.pinChecked = true;
    }
    if (spec.effect === 'confirm' || spec.pinIf) delete params.pin;
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
    if (ctx.isAgent && spec.effect !== 'read') ctx.run = L('lib_activity').agentRun(e.app);
    if (ctx.isAgent && spec.agent === 'propose' && (pinNeeded || !automatic(ctx, spec, params))) {
      dryRun(ctx, spec, params);
      body = L('lib_proposals').fromCall(ctx, spec, params);
      L('lib_audit').write(ctx, { op: spec.name, collection: 'proposals', record: body.proposal || '', summary: 'Your AI agent proposed: ' + (body.label || spec.name), data: { params: scrub(spec, params) } });
    } else {
      const clean = spec.agent === 'propose' ? stripProposal(params) : params;
      const r = execute(ctx, spec, clean);
      body = r.out;
      if (r.activity !== '') {
        headers['X-VO-Activity'] = r.activity;
        if (body !== null && typeof body === 'object' && !Array.isArray(body) && body.__streamed !== true) body._activity = r.activity;
      }
    }
    // Your AI agent's write that names a record a trigger asked about (a trigger's `lands`) answers that ask.
    if (ctx.isAgent && spec.effect !== 'read') L('lib_agent').landedByOp(e.app, spec.name, params);
    if (body && body.__streamed === true) {
      L('lib_bus').flush(e.app);
      return;
    }
    if (body === undefined || body === null) body = { ok: true };
    if (ctx.isAgent) body = forAgent(spec, body, params.full === true);
  } catch (err) {
    status = u.statusOf(err);
    if (status >= 500) console.error('[vo] ' + name + ' failed:', err);
    let message = String((err && err.message) || err);
    if (status >= 500) message = message.indexOf('UNIQUE constraint failed') >= 0 ? 'That would duplicate an existing record.' : 'Something went wrong on the server; it has been logged. Try again, and tell the owner if it keeps happening.';
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
    for (const k of Object.keys(headers)) e.response.header().set(k, headers[k]);
  } catch {
    /* headers are a courtesy */
  }
  // Your AI agent reads the answer as text: plain JSON, without the HTML escaping of < > & (<) that e.json adds.
  if (ctx !== null && ctx.isAgent) return e.blob(status, 'application/json; charset=utf-8', JSON.stringify(body));
  return e.json(status, body);
}

const BATCH_MAX = 12;

/**
 * app.batch: several reads in ONE request (a page's first load). Each call
 * is checked as on its own (catalog, permission, params) and answers
 * { op, status, data } or { op, status, message, code, data }; one failing
 * call does not stop the others. Only reads; a read that streams a file is
 * refused here (call it on its own). Why: every request also runs the
 * platform's middlewares in pooled runtimes, and a page that fires ten
 * reads at once outruns the pool and loads the app's code ten times over.
 */
function batch(ctx, p) {
  const u = L('lib_util');
  const calls = u.list(p, 'calls');
  if (calls === undefined || calls.length === 0) throw u.fail(400, 'calls is a JSON list, e.g. [{"op":"next.list","params":{"limit":20}}]', 'missing_param', { param: 'calls' });
  if (calls.length > BATCH_MAX) throw u.fail(400, 'At most ' + BATCH_MAX + ' calls in one batch.', 'invalid_param', { param: 'calls' });
  const e = ctx.e;
  const refuse = () => {
    throw u.fail(400, 'This read sends a file; call it on its own, not in a batch.', 'not_batchable');
  };
  const stub = {
    request: e ? e.request : null,
    auth: e ? e.auth : null,
    requestInfo: () => (e ? e.requestInfo() : { query: {}, body: {} }),
    findUploadedFiles: () => [],
    response: { header: refuse },
    stream: refuse,
    blob: refuse,
    json: refuse,
    string: refuse,
    html: refuse,
  };
  const results = calls.map((c) => {
    const opName = c && typeof c.op === 'string' ? c.op : '';
    try {
      const spec = L('lib_catalog').get(opName);
      if (spec.effect !== 'read' || spec.name === 'app.batch') throw u.fail(400, 'Only reads go in a batch (' + spec.name + ' is not one).', 'invalid_param', { op: spec.name });
      const sub = Object.assign({}, ctx, { e: stub, op: spec.name, spec: spec, audited: false, auditInfo: null });
      L('lib_auth').checkPerm(sub, spec);
      const params = check(c.params && typeof c.params === 'object' && !Array.isArray(c.params) ? c.params : {}, spec, false);
      const out = handler(spec)(sub, params);
      if (out && out.__streamed === true) refuse();
      const data = out === undefined || out === null ? { ok: true } : out;
      return { op: spec.name, status: 200, data: ctx.isAgent ? forAgent(spec, data, params.full === true) : data };
    } catch (err) {
      const status = u.statusOf(err);
      if (status >= 500) console.error('[vo] batch ' + opName + ' failed:', err);
      return { op: opName, status: status, message: status >= 500 ? 'Something went wrong on the server; it has been logged.' : String((err && err.message) || err), code: (err && err.code) || (status >= 500 ? 'error' : 'invalid'), data: (err && err.extra) || {} };
    }
  });
  return { results: results };
}

/**
 * Run an operation as `ctx` outside a request (accepting a proposal): the
 * permission is checked for that person and the params again, then the
 * handler runs (tracked as its own undo unit) and the audit row is written
 * as for a request.
 */
function runAs(ctx, name, params, opts) {
  const spec = L('lib_catalog').get(name);
  const c = Object.assign({}, ctx, { op: spec.name, spec: spec, audited: false, auditInfo: null });
  L('lib_auth').checkPerm(c, spec);
  const clean = stripProposal(check(params || {}, spec, false));
  delete clean.confirm;
  delete clean.pin;
  const r = execute(c, spec, clean, opts);
  const out = r.out === undefined || r.out === null ? { ok: true } : r.out;
  if (r.activity !== '' && typeof out === 'object' && !Array.isArray(out)) out._activity = r.activity;
  return out;
}

module.exports = { forAgent: forAgent, batch: batch, run: run, runAs: runAs, execute: execute, check: check, handler: handler, scrub: scrub, dryRun: dryRun, automatic: automatic, needsPin: needsPin, stripProposal: stripProposal };
