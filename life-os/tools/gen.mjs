/**
 * Generate the operation surface from the catalog (pb/pb_hooks/cat_*.js):
 *
 *   pb/pb_hooks/routes.pb.js            one routerAdd per operation
 *   operations.json                     what agents discover (agent-app ops)
 *   frontend/src/app/lib/ops.gen.ts     the op names and methods for the UI
 *
 * It also checks the catalog: names, methods, effects, parameter types, and
 * that every handler module exists and exports its function.
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
// Modules build their handlers when loaded (lib_rec.crud), requiring their neighbours by __hooks as in PocketBase.
globalThis.__hooks = hooks;

const catalogSrc = readFileSync(join(hooks, 'lib_catalog.js'), 'utf8');
const files = JSON.parse(catalogSrc.match(/const FILES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const EFFECTS = ['read', 'capture', 'plan', 'shape', 'reflect', 'confirm', 'admin'];

const problems = [];
const ops = [];
const seen = new Set();
for (const f of files) {
  const path = join(hooks, `${f}.js`);
  if (!existsSync(path)) {
    problems.push(`${f}.js missing`);
    continue;
  }
  const list = require(path);
  if (!Array.isArray(list)) problems.push(`${f}.js does not export a list`);
  for (const op of list) {
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(op.name ?? '')) problems.push(`bad name ${op.name} in ${f}`);
    if ((op.name.match(/\./g) ?? []).length !== 1) problems.push(`${op.name}: exactly one dot (group.verb)`);
    if (seen.has(op.name)) problems.push(`duplicate ${op.name}`);
    seen.add(op.name);
    if (op.method !== 'GET' && op.method !== 'POST') problems.push(`${op.name}: method must be GET or POST`);
    if (op.destructive && op.method === 'GET') problems.push(`${op.name}: destructive ops are POST`);
    if (typeof op.desc !== 'string' || op.desc.length === 0) problems.push(`${op.name}: desc required`);
    if (!EFFECTS.includes(op.effect)) problems.push(`${op.name}: effect must be one of ${EFFECTS.join(', ')}`);
    if (op.effect === 'read' && op.method !== 'GET' && !op.postRead) problems.push(`${op.name}: read ops are GET`);
    if (op.effect !== 'read' && op.method === 'GET') problems.push(`${op.name}: writes are POST`);
    if ((op.effect === 'confirm' || op.effect === 'admin' || op.effect === 'reflect') && op.agent !== 'deny') problems.push(`${op.name}: ${op.effect} ops are agent: 'deny'`);
    if (op.effect === 'shape' && op.agent !== 'propose' && op.agent !== 'deny' && !op.agentOk) problems.push(`${op.name}: shape ops are agent: 'propose' (or 'deny', or agentOk with a reason)`);
    if (op.pick !== undefined && op.agent !== 'propose') problems.push(`${op.name}: pick is for proposals`);
    if (!/^lib_[a-z_]+\.[A-Za-z]+$/.test(op.fn ?? '')) problems.push(`${op.name}: fn must be lib_x.fn`);
    for (const [k, d] of Object.entries(op.params ?? {})) {
      if (!['string', 'number', 'boolean'].includes(d.type)) problems.push(`${op.name}.${k}: type`);
      if (typeof d.desc !== 'string') problems.push(`${op.name}.${k}: desc`);
    }
    if (op.agent === 'propose') {
      if (typeof op.preview !== 'string') problems.push(`${op.name}: propose needs preview`);
      if ((op.params ?? {}).why !== undefined) problems.push(`${op.name}: "why" is reserved for your AI agent's explanation on proposals`);
      op.params = Object.assign({}, op.params, { why: { type: 'string', desc: 'Your AI agent: why, in a sentence or two, for the person approving' } });
    }
    if (op.destructive && op.agent !== 'deny' && op.agent !== 'propose') {
      if ((op.params ?? {}).confirm !== undefined) problems.push(`${op.name}: "confirm" is reserved for your AI agent's confirmation of a deletion`);
      op.params = Object.assign({}, op.params, { confirm: { type: 'boolean', desc: 'Your AI agent: true once the person asked for this deletion. Without it nothing is deleted and the answer says what would be.' } });
    }
    for (const fn of [op.fn, op.preview, op.pick].filter(Boolean)) {
      const [mod, name] = fn.split('.');
      const p = join(hooks, `${mod}.js`);
      if (!existsSync(p)) {
        problems.push(`${op.name}: module ${mod}.js missing`);
        continue;
      }
      try {
        const m = require(p);
        if (typeof m[name] !== 'function') problems.push(`${op.name}: ${fn} is not exported`);
      } catch (err) {
        problems.push(`${op.name}: ${mod}.js failed to load: ${err.message}`);
      }
    }
    ops.push(op);
  }
}

const strict = !process.argv.includes('--loose');
if (problems.length > 0) {
  console.error(problems.join('\n'));
  if (strict) process.exit(1);
}

const pathOf = (name) => '/api/ops/' + name.replace('.', '/');

/* routes.pb.js */
const routeLines = [
  '/// <reference path="../pb_data/types.d.ts" />',
  '/**',
  ' * GENERATED by tools/gen.mjs from the catalog (cat_*.js). Do not edit.',
  ' *',
  ' * One route per operation; every route runs through the dispatcher',
  ' * (lib_ops.js), which checks the caller and the parameters, runs the',
  ' * handler (or stores a proposal for your AI agent) and answers JSON.',
  ' */',
  '',
];
for (const op of ops) {
  const limit = op.bodyLimit ? `, $apis.bodyLimit(${op.bodyLimit})` : '';
  routeLines.push(`routerAdd('${op.method}', '${pathOf(op.name)}', (e) => require(\`\${__hooks}/lib_ops.js\`).run(e, '${op.name}')${limit});`);
}
writeFileSync(join(hooks, 'routes.pb.js'), routeLines.join('\n') + '\n');

/* operations.json */
const permText = (op) => {
  if (op.agent === 'propose') return ' [Proposal: a person approves.]';
  if (op.agent === 'deny') return ' [People only.]';
  return '';
};
const manifest = {
  opsVersion: 1,
  operations: [
    { name: 'health', description: 'Liveness check (PocketBase built-in).', system: true, params: {}, executor: { type: 'http', method: 'GET', path: '/api/health' } },
    { name: 'ops.list', description: 'Return this operations manifest.', system: true, params: {}, executor: { type: 'http', method: 'GET', path: '/api/_ops' } },
  ],
};
for (const op of ops) {
  let description = op.desc + permText(op);
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

/* ops.gen.ts */
const tsLines = [
  '/* GENERATED by tools/gen.mjs from the catalog. Do not edit. */',
  '',
  'export const OPS = {',
  ...ops.map((op) => `  '${op.name}': '${op.method}',`),
  '} as const;',
  '',
  'export type OpName = keyof typeof OPS;',
  '',
];
const tsPath = join(root, 'frontend', 'src', 'app', 'lib', 'ops.gen.ts');
if (existsSync(dirname(tsPath))) writeFileSync(tsPath, tsLines.join('\n'));

const by = (eff) => ops.filter((o) => o.effect === eff).length;
console.log(`${ops.length} operations (${by('read')} read, ${by('capture')} capture, ${by('plan')} plan, ${by('shape')} shape, ${by('reflect')} reflect, ${by('confirm')} confirm, ${by('admin')} admin; ${ops.filter((o) => o.agent === 'propose').length} proposals, ${ops.filter((o) => o.destructive).length} destructive)${problems.length > 0 ? `; ${problems.length} problems` : ''}`);
