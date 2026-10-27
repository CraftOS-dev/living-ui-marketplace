/// <reference path="../pb_data/types.d.ts" />
/**
 * The operation catalog: every operation the screens and your AI agent call.
 * Each cat_*.js file is plain data, so tools/gen.mjs reads it with Node and
 * writes routes.pb.js, operations.json and the frontend's op map from the
 * same source. Fields of an operation:
 *
 *   name     'answers.set' (route POST /api/ops/answers/set)
 *   method   'GET' | 'POST'
 *   fn       'lib_answers.set': the handler, called as fn(ctx, params)
 *   agent    'allow' (default) | 'deny' (founders only)
 *   effect   'read' | 'write' | 'judge' | 'confirm'
 *   desc     what it does (shown to your AI agent)
 *   params   { name: { type: 'string'|'number'|'boolean', required, enum, desc, example } }
 *   files    multipart file fields the screens upload (your AI agent gives --path)
 *   destructive  true for deletes
 */

const FILES = ['cat_app', 'cat_answers', 'cat_team', 'cat_sources', 'cat_review', 'cat_agent', 'cat_submit'];

let cache = null;

function load() {
  const out = {};
  for (const f of FILES) {
    const list = require(`${__hooks}/${f}.js`);
    for (const op of list) {
      if (op.destructive && op.agent !== 'deny' && (op.params || {}).confirm === undefined) {
        op.params = Object.assign({}, op.params, { confirm: { type: 'boolean', desc: 'Your AI agent: true once a founder asked for this deletion. Without it nothing is deleted and the answer says what would be.' } });
      }
      out[op.name] = op;
    }
  }
  return out;
}

function all() {
  if (cache === null) cache = load();
  return cache;
}

function get(name) {
  const op = all()[name];
  if (op === undefined) throw new Error('unknown operation ' + name);
  return op;
}

module.exports = { FILES: FILES, get: get, all: all };
