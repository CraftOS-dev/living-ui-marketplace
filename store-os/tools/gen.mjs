/**
 * Generate the operation surface from the catalog (pb/pb_hooks/cat_*.js):
 *
 *   pb/pb_hooks/routes.pb.js         one routerAdd per operation
 *   operations.json                  what agents discover (agent-app ops)
 *   frontend/src/app/lib/ops.gen.ts  the op names and methods for the screens
 *
 * It checks the catalog on the way: names, methods, effects, parameter types,
 * and that every handler module exists and exports its function.
 *
 *   node tools/gen.mjs
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = join(root, 'pb', 'pb_hooks');
const require = createRequire(import.meta.url);

const catalogSrc = readFileSync(join(hooks, 'lib_catalog.js'), 'utf8');
const files = JSON.parse(catalogSrc.match(/const FILES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const EFFECTS = ['read', 'write', 'confirm'];
const AGENT = [undefined, 'allow', 'deny', 'propose'];
const KINDS = ['listings', 'prices', 'stock', 'replies', 'orders'];

const problems = [];
const ops = [];
const seen = new Set();

/** Handler modules use PocketBase globals only inside functions, so Node can load them to check exports. */
function exportsOf(mod) {
  const p = join(hooks, `${mod}.js`);
  if (!existsSync(p)) return null;
  const src = readFileSync(p, 'utf8');
  const m = src.match(/module\.exports = \{([^}]*)\}/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.split(':')[0].trim())
    .filter((s) => s !== '');
}

for (const f of files) {
  const path = join(hooks, `${f}.js`);
  if (!existsSync(path)) {
    problems.push(`${f}.js missing`);
    continue;
  }
  const list = require(path);
  for (const op of list) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(op.name ?? '')) problems.push(`bad name ${op.name} in ${f}`);
    if ((op.name.match(/\./g) ?? []).length !== 1) problems.push(`${op.name}: exactly one dot (group.verb)`);
    if (seen.has(op.name)) problems.push(`duplicate ${op.name}`);
    seen.add(op.name);
    if (op.method !== 'GET' && op.method !== 'POST') problems.push(`${op.name}: method must be GET or POST`);
    if (op.destructive && op.method === 'GET') problems.push(`${op.name}: destructive ops are POST`);
    if (typeof op.desc !== 'string' || op.desc.length === 0) problems.push(`${op.name}: desc required`);
    if (!EFFECTS.includes(op.effect)) problems.push(`${op.name}: effect must be one of ${EFFECTS.join(', ')}`);
    if (op.effect === 'read' && op.method !== 'GET') problems.push(`${op.name}: read ops are GET`);
    if (op.effect !== 'read' && op.method === 'GET') problems.push(`${op.name}: writes are POST`);
    if (op.effect === 'confirm' && op.agent !== 'deny') problems.push(`${op.name}: confirm ops are agent: 'deny'`);
    if (!AGENT.includes(op.agent)) problems.push(`${op.name}: agent must be allow, deny or propose`);
    if (op.agent === 'propose' && !KINDS.includes(op.kind)) problems.push(`${op.name}: propose ops need kind (${KINDS.join(', ')})`);
    if (op.agent === 'propose' && op.effect !== 'write') problems.push(`${op.name}: propose ops are writes`);
    if (op.diff && (typeof op.diff.collection !== 'string' || typeof op.diff.id !== 'string' || typeof op.diff.fields !== 'object')) problems.push(`${op.name}: diff needs collection, id and fields`);
    if (op.diff && !(op.diff.id in (op.params ?? {}))) problems.push(`${op.name}: diff.id must name a param`);
    if (!/^lib_[a-z_]+\.[A-Za-z]+$/.test(op.fn ?? '')) problems.push(`${op.name}: fn must be lib_x.fn`);
    for (const [k, d] of Object.entries(op.params ?? {})) {
      if (!['string', 'number', 'boolean'].includes(d.type)) problems.push(`${op.name}.${k}: type`);
      if (typeof d.desc !== 'string') problems.push(`${op.name}.${k}: desc`);
    }
    if (op.destructive && op.agent !== 'deny') {
      if ((op.params ?? {}).confirm !== undefined) problems.push(`${op.name}: "confirm" is reserved`);
      op.params = Object.assign({}, op.params, { confirm: { type: 'boolean', desc: 'Your AI agent: true once the seller asked for this deletion. Without it nothing is deleted and the answer says what would be.' } });
    }
    if (op.agent === 'propose') {
      if ((op.params ?? {}).why !== undefined) problems.push(`${op.name}: "why" is reserved`);
      op.params = Object.assign({}, op.params, { why: { type: 'string', desc: 'Your AI agent: one or two lines on why, shown to the seller with the proposal.' } });
    }
    const [mod, name] = op.fn.split('.');
    const names = exportsOf(mod);
    if (names === null) problems.push(`${op.name}: module ${mod}.js missing`);
    else if (!names.includes(name)) problems.push(`${op.name}: ${op.fn} is not exported`);
    ops.push(op);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const pathOf = (name) => '/api/ops/' + name.replace('.', '/');

const routeLines = [
  '/// <reference path="../pb_data/types.d.ts" />',
  '/**',
  ' * GENERATED by tools/gen.mjs from the catalog (cat_*.js). Do not edit.',
  ' *',
  ' * One route per operation; each runs through the dispatcher (lib_ops.js),',
  ' * which checks the caller and the parameters, runs the handler and answers JSON.',
  ' */',
  '',
];
for (const op of ops) {
  const limit = op.bodyLimit ? `, $apis.bodyLimit(${op.bodyLimit})` : '';
  routeLines.push(`routerAdd('${op.method}', '${pathOf(op.name)}', (e) => require(\`\${__hooks}/lib_ops.js\`).run(e, '${op.name}')${limit});`);
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
  let description = op.desc + (op.agent === 'deny' ? ' [The seller only.]' : op.agent === 'propose' ? ' [Becomes a proposal the seller approves, unless the seller set ' + op.kind + ' changes to automatic.]' : '');
  if (description.length > 500) description = description.slice(0, 497) + '...';
  const params = {};
  for (const [k, d] of Object.entries(op.params ?? {})) {
    const out = { type: d.type, description: d.desc };
    if (d.required) out.required = true;
    if (d.enum) out.enum = d.enum;
    params[k] = out;
  }
  const entry = { name: op.name, description, params, executor: { type: 'http', method: op.method, path: pathOf(op.name) } };
  if (op.destructive) entry.destructive = true;
  manifest.operations.push(entry);
}
writeFileSync(join(root, 'operations.json'), JSON.stringify(manifest, null, 2) + '\n');

const tsLines = ['/* GENERATED by tools/gen.mjs from the catalog. Do not edit. */', '', 'export const OPS = {', ...ops.map((op) => `  '${op.name}': '${op.method}',`), '} as const;', '', 'export type OpName = keyof typeof OPS;', ''];
writeFileSync(join(root, 'frontend', 'src', 'app', 'lib', 'ops.gen.ts'), tsLines.join('\n'));

const by = (eff) => ops.filter((o) => o.effect === eff).length;
console.log(`${ops.length} operations (${by('read')} read, ${by('write')} write, ${by('confirm')} confirm; ${ops.filter((o) => o.agent === 'deny').length} seller only, ${ops.filter((o) => o.agent === 'propose').length} proposed, ${ops.filter((o) => o.destructive).length} destructive)`);
