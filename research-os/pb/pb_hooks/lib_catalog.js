/// <reference path="../pb_data/types.d.ts" />
/**
 * The operation catalog: every operation the screens and your AI agent call.
 *
 * Each cat_*.js file is plain data (no PocketBase globals), so tools/gen.mjs
 * can read it with Node and write operations.json, pb_hooks/routes.pb.js and
 * the frontend's op map from the same source. Fields of an operation:
 *
 *   name     'works.add' (route POST /api/ops/works/add)
 *   method   'GET' | 'POST'
 *   fn       'lib_works.add': the handler, called as fn(ctx, params)
 *   agent    'allow' (default) | 'deny' (people only) | 'propose' (your AI
 *            agent's call becomes a proposal a person approves)
 *   preview  for 'propose': 'lib_x.fn(ctx, params)' returning
 *            { kind, title, summary, preview, target: { collection, id } }.
 *   effect   'read' | 'capture' | 'judge' | 'confirm' | 'change' | 'admin'
 *   desc     what it does (shown to your AI agent).
 *   params   { name: { type: 'string'|'number'|'boolean', required, enum, desc, example } }
 *   files    multipart file fields the screens upload (the agent gives --path).
 *   destructive  true for deletes.
 */

const FILES = ['cat_core', 'cat_library', 'cat_reader', 'cat_projects', 'cat_agent', 'cat_discover', 'cat_write', 'cat_screen', 'cat_tasks', 'cat_exp', 'cat_repo'];

function load() {
  const out = {};
  for (const f of FILES) {
    const list = require(`${__hooks}/${f}.js`);
    for (const op of list) {
      if (op.agent === 'propose' && (op.params || {}).why === undefined) {
        op.params = Object.assign({}, op.params, { why: { type: 'string', desc: 'Your AI agent: why, in a sentence or two, for the person approving' } });
      }
      if (op.destructive && op.agent !== 'deny' && op.agent !== 'propose' && (op.params || {}).confirm === undefined) {
        op.params = Object.assign({}, op.params, { confirm: { type: 'boolean', desc: 'Your AI agent: true once the person asked for this deletion. Without it nothing is deleted and the answer says what would be.' } });
      }
      out[op.name] = op;
    }
  }
  return out;
}

let cache = null;

function get(name) {
  if (cache === null) cache = load();
  const op = cache[name];
  if (op === undefined) throw new Error('unknown operation ' + name);
  return op;
}

function all() {
  if (cache === null) cache = load();
  return cache;
}

module.exports = { FILES: FILES, get: get, all: all };
