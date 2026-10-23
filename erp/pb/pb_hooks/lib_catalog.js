/// <reference path="../pb_data/types.d.ts" />
/**
 * The operation catalog: every operation the screens and the AI agent call.
 *
 * Each cat_*.js file is plain data (no PocketBase globals), so tools/gen.mjs
 * can read it with Node and write operations.json, pb_hooks/routes.pb.js and
 * the frontend's op map from the same source. Fields of an operation:
 *
 *   name     'docs.post' (route POST /api/ops/docs/post)
 *   method   'GET' | 'POST'
 *   fn       'lib_docs.post': the handler, called as fn(ctx, params)
 *   perm     'public' | 'self' | 'admin' | '<module>:<level>' | 'doc:<level>'
 *            | 'pay:<level>' (level: view, edit, full). 'self' means any
 *            signed-in member (and the agent); handlers then check records.
 *   agent    'allow' (default) | 'deny' | 'propose': a proposal a person
 *            approves, unless the agent's autonomy settings allow this kind.
 *   preview  for 'propose': 'lib_x.fn(ctx, params)' returning
 *            { kind, auto, amount, title, summary, lines, target }.
 *   desc     what it does (shown to the agent).
 *   params   { name: { type: 'string'|'number'|'boolean', required, enum, desc } }
 *   files    multipart file fields the screens upload (the agent gives --path).
 *   destructive  true for deletes.
 */

const FILES = ['cat_system', 'cat_sales', 'cat_stock', 'cat_money', 'cat_books', 'cat_people', 'cat_work', 'cat_agent'];

/** Whether your AI agent runs an op itself (lib_auth.checkPerm): not denied, not admin, and full rights only when allowed. */
function agentRunsAlone(op) {
  if (op.agent === 'deny' || op.agent === 'propose' || op.perm === 'admin') return false;
  const levels = String(op.perm || '').split('|').map((p) => p.split(':')[1] || '');
  return !(levels.indexOf('full') >= 0 && op.agent !== 'allow');
}

function load() {
  const out = {};
  for (const f of FILES) {
    const list = require(`${__hooks}/${f}.js`);
    for (const op of list) {
      // Proposal operations take your AI agent's why (tools/gen.mjs declares it too).
      if (op.agent === 'propose' && (op.params || {}).why === undefined) {
        op.params = Object.assign({}, op.params, { why: { type: 'string', desc: 'Your AI agent: why, in a sentence or two, for the person approving' } });
      }
      // Deletions your AI agent may run itself wait for its --confirm true (tools/gen.mjs declares it too).
      if (op.destructive && agentRunsAlone(op) && (op.params || {}).confirm === undefined) {
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
