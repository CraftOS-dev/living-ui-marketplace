/// <reference path="../pb_data/types.d.ts" />
/**
 * The operation catalog: every operation the screens and your AI agent call.
 *
 * It is auto-discovered: every pb_hooks/cat_*.js file is plain data (a list
 * of operations, no PocketBase globals at top level), read here with
 * $os.readDir and by tools/gen.mjs with fs.readdirSync, which writes
 * routes.pb.js, operations.json and the frontend's op map from the same
 * source. Fields (SPEC 4.1):
 *
 *   name        'group.verb' (route METHOD /api/ops/group/verb)
 *   method      'GET' for reads, 'POST' for writes
 *   fn          'lib_x.fn', called as fn(ctx, params)
 *   perm        'public' | 'signed' | 'self' | '<module>:<level>' | 'admin' (alternatives with '|')
 *   agent       'allow' (default) | 'propose' | 'deny'
 *   kind        for 'propose': the proposal kind (lower case words with _)
 *   auto        for 'propose': optional 'lib_x.fn' (ctx, params) -> true when a
 *               promoted kind may run directly for these params
 *   effect      'read' | 'write' | 'confirm' (needs the caller's approval PIN)
 *   destructive true for deletes
 *   track       false: the write is not run inside the tracked transaction
 *               (ops that call the bridge or the network, or keep counters
 *               that must survive a refusal); default true for writes
 *   desc        what it does, for your AI agent (under 400 characters)
 *   params      { name: { type, required, enum, desc, example, secret } }
 *   files       multipart file fields
 *   diff        for 'propose': { collection, id: '<param>', fields: { <param>: '<field>' } }
 *   preview     for 'propose': 'lib_x.fn' -> { label, ref, target, fields, notes, risk }
 *   pinIf       'lib_x.fn' (ctx, params) -> true when this call needs the
 *               caller's approval PIN (a write that is not always a confirm op)
 *
 * Added here (tools/gen.mjs adds the same): `pin` on confirm ops (optional on
 * pinIf ops), `confirm`
 * on deletions your AI agent may run, `why`, `evidence` and `confidence` on
 * proposal ops.
 */

const PIN_PARAM = { type: 'string', required: true, secret: true, desc: 'Your six-digit approval PIN (people only; your AI agent never has one).' };
const PIN_IF_PARAM = { type: 'string', secret: true, desc: 'Your six-digit approval PIN, when this call needs one (people only; your AI agent never has one).' };
const CONFIRM_PARAM = { type: 'boolean', desc: 'true once the person asked for this deletion (without it nothing is deleted).' };
const WHY_PARAM = { type: 'string', desc: 'Why, in a line or two, for the person who decides.' };
const EVIDENCE_PARAM = { type: 'string', desc: 'The quote that supports it (text), or JSON {"quote","file","page","url"}.' };
const CONFIDENCE_PARAM = { type: 'number', desc: 'How sure you are, 0 to 1.' };
const PROPOSAL_PARAMS = ['why', 'evidence', 'confidence'];
const FULL_PARAM = { type: 'boolean', desc: 'Your AI agent: true answers every field as stored (provenance, long text unclipped).' };

/** The catalog files: cat_*.js in pb_hooks, sorted by name. */
function files() {
  const out = [];
  for (const f of $os.readDir(__hooks)) {
    const n = f.name();
    if (/^cat_[a-z0-9_]+\.js$/.test(n)) out.push(n.slice(0, -3));
  }
  out.sort();
  return out;
}

/** One operation with the kernel's added params. */
function complete(op) {
  const params = Object.assign({}, op.params || {});
  if (op.effect === 'confirm' && params.pin === undefined) params.pin = PIN_PARAM;
  if (op.pinIf && params.pin === undefined) params.pin = PIN_IF_PARAM;
  if (op.destructive && op.agent !== 'deny' && params.confirm === undefined) params.confirm = CONFIRM_PARAM;
  if (op.effect === 'read' && op.agent !== 'deny' && params.full === undefined) params.full = FULL_PARAM;
  if (op.agent === 'propose') {
    if (params.why === undefined) params.why = WHY_PARAM;
    if (params.evidence === undefined) params.evidence = EVIDENCE_PARAM;
    if (params.confidence === undefined) params.confidence = CONFIDENCE_PARAM;
  }
  return Object.assign({}, op, { params: params, agent: op.agent || 'allow' });
}

// Speed: requiring every cat_*.js file costs a cold runtime hundreds of ms,
// and PocketBase runs requests in a pool of runtimes. Boot (warm) stores the
// completed catalog in the app store, whole and one op per key; get() then
// parses only the op it needs.
const KEY_ALL = 'vo_catalog_v1';
const KEY_OP = 'vo_op_v1:';

let cache = null;
const ops = {};

function load() {
  const out = {};
  for (const f of files()) {
    const list = require(`${__hooks}/${f}.js`);
    for (const op of list) out[op.name] = complete(op);
  }
  return out;
}

/** Boot: the catalog into the app store (whole, and each op by name). */
function warm(app) {
  const u = require(`${__hooks}/lib_util.js`);
  u.sharedReset(app, KEY_ALL);
  const out = load();
  const store = app.store();
  store.set(KEY_ALL, JSON.stringify(out));
  for (const name of Object.keys(out)) store.set(KEY_OP + name, JSON.stringify(out[name]));
  cache = out;
  return Object.keys(out).length;
}

function all() {
  if (cache === null) cache = require(`${__hooks}/lib_util.js`).shared(KEY_ALL, load);
  return cache;
}

function get(name) {
  let op = cache !== null ? cache[name] : ops[name];
  if (op === undefined) {
    let raw = null;
    try {
      raw = $app.store().get(KEY_OP + name);
    } catch {
      raw = null;
    }
    op = typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : all()[name];
    if (op !== undefined) ops[name] = op;
  }
  if (op === undefined) throw require(`${__hooks}/lib_util.js`).fail(404, 'Unknown operation ' + name + '. Run app.guide to see them.', 'unknown_op');
  return op;
}

/** Does the catalog have this op? */
function has(name) {
  try {
    get(name);
    return true;
  } catch {
    return false;
  }
}

module.exports = { warm: warm, files: files, complete: complete, all: all, get: get, has: has, PIN_PARAM: PIN_PARAM, CONFIRM_PARAM: CONFIRM_PARAM, WHY_PARAM: WHY_PARAM, EVIDENCE_PARAM: EVIDENCE_PARAM, CONFIDENCE_PARAM: CONFIDENCE_PARAM, PROPOSAL_PARAMS: PROPOSAL_PARAMS, FULL_PARAM: FULL_PARAM };
