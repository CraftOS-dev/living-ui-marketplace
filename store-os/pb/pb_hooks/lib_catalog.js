/// <reference path="../pb_data/types.d.ts" />
/**
 * The operation catalog: every operation the screens and your AI agent call.
 * Each cat_*.js file is plain data, so tools/gen.mjs reads it with Node and
 * writes routes.pb.js, operations.json and the frontend's op map from the
 * same source. Fields of an operation:
 *
 *   name     'orders.ship' (route POST /api/ops/orders/ship)
 *   method   'GET' | 'POST'
 *   fn       'lib_orders.ship': the handler, called as fn(ctx, params)
 *   agent    'allow' (default) | 'deny' (the seller only) | 'propose' (your
 *            AI agent's call becomes a proposal unless the seller set this
 *            kind of change to automatic)
 *   kind     for 'propose': listings | prices | stock | replies | orders
 *   diff     for 'propose': { collection, id: '<param naming the record>', fields: { param: field } }
 *            so a proposal shows before and after
 *   effect   'read' | 'write' | 'confirm'
 *   desc     what it does (shown to your AI agent)
 *   params   { name: { type: 'string'|'number'|'boolean', required, enum, desc, example } }
 *   files    multipart file fields the screens upload (your AI agent gives --paths)
 *   destructive  true for deletes
 */

const FILES = ['cat_app', 'cat_shops', 'cat_products', 'cat_stock', 'cat_orders', 'cat_inbox', 'cat_customers', 'cat_proposals', 'cat_tasks', 'cat_reports', 'cat_imports'];

let cache = null;

function load() {
  const out = {};
  for (const f of FILES) {
    const list = require(`${__hooks}/${f}.js`);
    for (const op of list) {
      if (op.destructive && op.agent !== 'deny' && (op.params || {}).confirm === undefined) {
        op.params = Object.assign({}, op.params, { confirm: { type: 'boolean', desc: 'Your AI agent: true once the seller asked for this deletion. Without it nothing is deleted and the answer says what would be.' } });
      }
      if (op.agent === 'propose' && (op.params || {}).why === undefined) {
        op.params = Object.assign({}, op.params, { why: { type: 'string', desc: 'Your AI agent: one or two lines on why, shown to the seller with the proposal.' } });
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
