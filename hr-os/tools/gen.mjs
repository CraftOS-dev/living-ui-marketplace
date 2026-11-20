/**
 * Generate the operation surface from the catalog (pb/pb_hooks/cat_*.js,
 * auto-discovered: every cat_*.js file is a plain list of operations):
 *
 *   pb/pb_hooks/routes.pb.js         one routerAdd per operation
 *   tools/operations.catalog.json    the catalog's own operation listing (operations.json is generated from it by tools/agent-app-migrate)
 *   frontend/src/app/lib/ops.gen.ts  op names and methods for the screens
 *
 * It checks the catalog on the way (SPEC 3.1): names, methods, effects,
 * permissions, agent rules, proposal kinds, parameter types, and that every
 * handler (and preview) module loads and exports its function.
 *
 *   node tools/gen.mjs
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = join(root, 'pb', 'pb_hooks');
const require = createRequire(import.meta.url);

const MODULES = ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'reports', 'admin'];
const LEVELS = ['view', 'edit', 'full'];
const EFFECTS = ['read', 'write', 'confirm'];
const AGENT = [undefined, 'allow', 'deny', 'propose'];
const KINDS = ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'packs'];
const PIN_PARAM = { type: 'string', required: true, secret: true, desc: 'Your six-digit approval PIN (people only; your AI agent never has one).' };
const CONFIRM_PARAM = { type: 'boolean', desc: 'true once the person asked for this deletion (without it nothing is deleted).' };
const WHY_PARAM = { type: 'string', desc: 'Why, in a line or two, for the person who decides.' };

const files = readdirSync(hooks)
  .filter((n) => /^cat_[a-z0-9_]+\.js$/.test(n))
  .sort();
const problems = [];
const ops = [];
const seen = new Map();
const modCache = new Map();

/** Load a handler module in Node (helpers are required inside function bodies, so loading is safe). */
function moduleExports(mod) {
  if (modCache.has(mod)) return modCache.get(mod);
  const p = join(hooks, `${mod}.js`);
  let out = null;
  if (existsSync(p)) {
    try {
      out = require(p);
    } catch (err) {
      problems.push(`${mod}.js does not load in Node (top-level PocketBase globals?): ${err.message}`);
      out = {};
    }
  }
  modCache.set(mod, out);
  return out;
}

function checkFn(opName, field, ref) {
  if (!/^lib_[a-z0-9_]+\.[A-Za-z0-9_]+$/.test(ref ?? '')) {
    problems.push(`${opName}: ${field} must be lib_x.fn`);
    return;
  }
  const [mod, name] = ref.split('.');
  const ex = moduleExports(mod);
  if (ex === null) problems.push(`${opName}: module ${mod}.js missing`);
  else if (typeof ex[name] !== 'function') problems.push(`${opName}: ${ref} is not an exported function`);
}

function checkPerm(op) {
  const perm = op.perm;
  if (typeof perm !== 'string' || perm === '') return problems.push(`${op.name}: perm is required (public, signed, self, <module>:<level>, admin)`);
  for (const alt of perm.split('|')) {
    if (['public', 'signed', 'self', 'admin'].includes(alt)) continue;
    const [m, l] = alt.split(':');
    if (!MODULES.includes(m) || !LEVELS.includes(l)) problems.push(`${op.name}: bad perm "${alt}" (modules ${MODULES.join(', ')}; levels ${LEVELS.join(', ')})`);
  }
}

for (const f of files) {
  const list = require(join(hooks, f));
  if (!Array.isArray(list)) {
    problems.push(`${f}: must export a list of operations`);
    continue;
  }
  for (const op0 of list) {
    const op = Object.assign({}, op0);
    const name = op.name ?? '';
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(name)) problems.push(`${f}: bad name "${name}" (group.verb, exactly one dot, [a-z0-9-])`);
    if (seen.has(name)) problems.push(`${name}: duplicate (in ${seen.get(name)} and ${f})`);
    seen.set(name, f);
    if (op.method !== 'GET' && op.method !== 'POST') problems.push(`${name}: method must be GET or POST`);
    if (!EFFECTS.includes(op.effect)) problems.push(`${name}: effect must be one of ${EFFECTS.join(', ')}`);
    if (op.effect === 'read' && op.method !== 'GET') problems.push(`${name}: read ops are GET`);
    if (op.effect !== 'read' && op.method === 'GET') problems.push(`${name}: writes are POST`);
    if (op.destructive && op.method === 'GET') problems.push(`${name}: destructive ops are POST`);
    if (!AGENT.includes(op.agent)) problems.push(`${name}: agent must be allow, deny or propose`);
    if (op.effect === 'confirm' && op.agent !== 'deny') problems.push(`${name}: confirm ops are agent: 'deny'`);
    if (op.agent === 'propose' && !KINDS.includes(op.kind)) problems.push(`${name}: propose ops need kind (${KINDS.join(', ')})`);
    if (op.agent === 'propose' && op.effect !== 'write') problems.push(`${name}: propose ops are writes`);
    if (op.agent === 'propose' && op.destructive) problems.push(`${name}: a deletion is not a proposal; make it agent: 'deny' or 'allow'`);
    if (op.kind !== undefined && op.agent !== 'propose') problems.push(`${name}: kind is only for propose ops`);
    if (typeof op.desc !== 'string' || op.desc.length === 0) problems.push(`${name}: desc required`);
    else if (op.desc.length > 400) problems.push(`${name}: desc is ${op.desc.length} characters (at most 400)`);
    if (/[\u2013\u2014]/.test(JSON.stringify(op))) problems.push(`${name}: no en or em dashes`);
    checkPerm(op);
    checkFn(name, 'fn', op.fn);
    if (op.preview !== undefined) {
      if (op.agent !== 'propose') problems.push(`${name}: preview is only for propose ops`);
      checkFn(name, 'preview', op.preview);
    }
    if (op.diff !== undefined) {
      if (typeof op.diff.collection !== 'string' || typeof op.diff.id !== 'string' || typeof op.diff.fields !== 'object') problems.push(`${name}: diff needs collection, id and fields`);
      else if (!(op.diff.id in (op.params ?? {}))) problems.push(`${name}: diff.id must name a param`);
    }
    for (const fld of op.files ?? []) if (typeof fld !== 'string') problems.push(`${name}: files are field names`);
    for (const [k, d] of Object.entries(op.params ?? {})) {
      if (!/^[a-z][a-z0-9_]*$/.test(k)) problems.push(`${name}.${k}: param names are lower case with _`);
      if (!['string', 'number', 'boolean'].includes(d.type)) problems.push(`${name}.${k}: type must be string, number or boolean`);
      if (typeof d.desc !== 'string') problems.push(`${name}.${k}: desc`);
      if (d.enum !== undefined && !Array.isArray(d.enum)) problems.push(`${name}.${k}: enum must be a list`);
    }
    const params = Object.assign({}, op.params ?? {});
    if (op.effect === 'confirm') {
      if (params.pin !== undefined) problems.push(`${name}: "pin" is added for confirm ops`);
      params.pin = PIN_PARAM;
    }
    if (op.destructive && op.agent !== 'deny') {
      if (params.confirm !== undefined) problems.push(`${name}: "confirm" is reserved`);
      params.confirm = CONFIRM_PARAM;
    }
    if (op.agent === 'propose') {
      if (params.why !== undefined) problems.push(`${name}: "why" is reserved`);
      params.why = WHY_PARAM;
    }
    op.params = params;
    op.file = f;
    ops.push(op);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s); nothing written.`);
  process.exit(1);
}

ops.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const pathOf = (name) => '/api/ops/' + name.replace('.', '/');

const routeLines = [
  '/// <reference path="../pb_data/types.d.ts" />',
  '/**',
  ' * GENERATED by tools/gen.mjs from the catalog (cat_*.js). Do not edit.',
  ' *',
  ' * One route per operation; each runs through the dispatcher (lib_ops.js),',
  ' * which checks the caller, the permission, the parameters and the PIN,',
  ' * runs the handler (or stores a proposal for your AI agent) and answers JSON.',
  ' */',
  '',
];
for (const op of ops) {
  const limit = op.bodyLimit ? `, $apis.bodyLimit(${op.bodyLimit})` : '';
  // Go middlewares only (a JS one would hold a pooled runtime): answers gzip-compressed.
  routeLines.push(`routerAdd('${op.method}', '${pathOf(op.name)}', (e) => require(\`\${__hooks}/lib_ops.js\`).run(e, '${op.name}'), $apis.gzip()${limit});`);
}
writeFileSync(join(hooks, 'routes.pb.js'), routeLines.join('\n') + '\n');

const manifest = {
  opsVersion: 1,
  operations: [
    { name: 'health', description: 'Liveness check (PocketBase built-in).', system: true, params: {}, executor: { type: 'http', method: 'GET', path: '/api/health' } },
    { name: 'ops.list', description: 'Return this operations manifest.', system: true, params: {}, executor: { type: 'http', method: 'GET', path: '/api/_ops' } },
  ],
};
for (const op of ops) {
  // operations.json is what your AI agent's CLI reads: a people-only op shows no PIN param and
  // no required params, so the call reaches the server and gets its 403 with the hand-off.
  const mark = op.agent === 'deny' ? ' [People only: hand it over with inbox.route.]' : op.agent === 'propose' ? ' [Proposal (' + op.kind + ').]' : '';
  let description = op.desc + mark;
  if (description.length > 500) description = description.slice(0, 497) + '...';
  const params = {};
  for (const [k, d] of Object.entries(op.params)) {
    if (op.agent === 'deny' && k === 'pin') continue;
    const out = { type: d.type, description: d.desc };
    if (d.required && op.agent !== 'deny') out.required = true;
    if (d.enum) out.enum = d.enum;
    params[k] = out;
  }
  const entry = { name: op.name, description, params, executor: { type: 'http', method: op.method, path: pathOf(op.name) } };
  if (op.destructive) entry.destructive = true;
  manifest.operations.push(entry);
}
// operations.json is the Agent App Framework declaration now (module, typed
// params, destructive), produced from this catalog by the marketplace's
// tools/agent-app-migrate. The catalog's own listing goes beside this script.
writeFileSync(join(root, 'tools', 'operations.catalog.json'), JSON.stringify(manifest, null, 2) + '\n');

const tsDir = join(root, 'frontend', 'src', 'app', 'lib');
mkdirSync(tsDir, { recursive: true });
const tsLines = [
  '/* GENERATED by tools/gen.mjs from the catalog. Do not edit. */',
  '',
  'export const OPS = {',
  ...ops.map((op) => `  '${op.name}': { method: '${op.method}', effect: '${op.effect}', perm: '${op.perm}', agent: '${op.agent ?? 'allow'}'${op.destructive ? ', destructive: true' : ''} },`),
  '} as const;',
  '',
  'export type OpName = keyof typeof OPS;',
  '',
  '/** Ops that need the approval PIN (send it as the `pin` param). */',
  'export const PIN_OPS: ReadonlySet<OpName> = new Set<OpName>([' + ops.filter((o) => o.effect === 'confirm').map((o) => `'${o.name}'`).join(', ') + ']);',
  '',
];
writeFileSync(join(tsDir, 'ops.gen.ts'), tsLines.join('\n'));

const by = (eff) => ops.filter((o) => o.effect === eff).length;
console.log(`${ops.length} operations from ${files.length} catalog files (${by('read')} read, ${by('write')} write, ${by('confirm')} confirm; ${ops.filter((o) => o.agent === 'deny').length} people only, ${ops.filter((o) => o.agent === 'propose').length} proposed, ${ops.filter((o) => o.destructive).length} destructive)`);
