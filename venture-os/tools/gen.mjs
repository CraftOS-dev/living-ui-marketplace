/**
 * Generate the operation surface from the catalog (pb/pb_hooks/cat_*.js,
 * auto-discovered: every cat_*.js file is a plain list of operations):
 *
 *   pb/pb_hooks/routes.pb.js         one routerAdd per operation
 *   tools/operations.catalog.json    the catalog's own operation listing (operations.json is generated from it by tools/agent-app-migrate)
 *   frontend/src/app/lib/ops.gen.ts  op names, methods and rules for the screens
 *
 * It checks the catalog on the way (SPEC 4.1): names, methods, effects,
 * permissions, agent rules, proposal kinds, parameter types, that every
 * handler (and preview, auto) module loads and exports its function, and
 * that the module registrations (events_*.js, guide_*.js, cron_*.js) are
 * well formed: every trigger (events_*.js `triggers`) names its record,
 * param and functions and has its recipe in a guide_*.js, and every recipe
 * is a trigger's.
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

const MODULES = ['network', 'intake', 'pipeline', 'diligence', 'committee', 'portfolio', 'funds', 'lps', 'markets', 'settings'];
const LEVELS = ['view', 'edit', 'full'];
const EFFECTS = ['read', 'write', 'confirm'];
const AGENT = [undefined, 'allow', 'deny', 'propose'];
const KIND_RE = /^[a-z][a-z_]{1,39}$/;
const OP_KEYS = ['name', 'method', 'fn', 'perm', 'agent', 'kind', 'auto', 'effect', 'destructive', 'track', 'desc', 'params', 'files', 'diff', 'preview', 'pinIf', 'what', 'bodyLimit'];
const PIN_PARAM = { type: 'string', required: true, secret: true, desc: 'Your six-digit approval PIN (people only; your AI agent never has one).' };
const PIN_IF_PARAM = { type: 'string', secret: true, desc: 'Your six-digit approval PIN, when this call needs one (people only; your AI agent never has one).' };
const CONFIRM_PARAM = { type: 'boolean', desc: 'true once the person asked for this deletion (without it nothing is deleted).' };
const PROPOSAL_PARAMS = {
  why: { type: 'string', desc: 'Why, in a line or two, for the person who decides.' },
  evidence: { type: 'string', desc: 'The quote that supports it (text), or JSON {"quote","file","page","url"}.' },
  confidence: { type: 'number', desc: 'How sure you are, 0 to 1.' },
};
const FULL_PARAM = { type: 'boolean', desc: 'Your AI agent: true answers every field as stored (provenance, long text unclipped).' };
const EVENT_KEYS = ['on', 'approvals', 'needsYou', 'triggers', 'search', 'settingsKeys', 'imports', 'timeline', 'today'];
const TRIGGER_KEYS = ['record', 'param', 'perm', 'ask', 'label', 'description', 'fires', 'cooldown', 'policy', 'deal', 'nda', 'check', 'asked', 'ended', 'params', 'lands', 'instruction'];
const IMPORT_TYPES = ['text', 'number', 'int', 'money', 'percent', 'day', 'email', 'url', 'bool', 'list'];
const DASH = /[\u2013\u2014]/;

const listFiles = (prefix) =>
  readdirSync(hooks)
    .filter((n) => new RegExp('^' + prefix + '_[a-z0-9_]+\\.js$').test(n))
    .sort();
const files = listFiles('cat');
const problems = [];
const ops = [];
const seen = new Map();
const modCache = new Map();

/** Load a module in Node (helpers are required inside function bodies, so loading is safe). */
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

function checkFn(where, field, ref) {
  if (!/^lib_[a-z0-9_]+\.[A-Za-z0-9_]+$/.test(ref ?? '')) {
    problems.push(`${where}: ${field} must be lib_x.fn`);
    return;
  }
  const [mod, name] = ref.split('.');
  const ex = moduleExports(mod);
  if (ex === null) problems.push(`${where}: module ${mod}.js missing`);
  else if (typeof ex[name] !== 'function') problems.push(`${where}: ${ref} is not an exported function`);
}

function checkPerm(where, perm) {
  if (typeof perm !== 'string' || perm === '') return problems.push(`${where}: perm is required (public, signed, self, <module>:<level>, admin)`);
  for (const alt of perm.split('|')) {
    if (['public', 'signed', 'self', 'admin'].includes(alt)) continue;
    const [m, l] = alt.split(':');
    if (!MODULES.includes(m) || !LEVELS.includes(l)) problems.push(`${where}: bad perm "${alt}" (modules ${MODULES.join(', ')}; levels ${LEVELS.join(', ')})`);
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
    for (const k of Object.keys(op)) if (!OP_KEYS.includes(k)) problems.push(`${name}: unknown field "${k}" (fields: ${OP_KEYS.join(', ')})`);
    if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(name)) problems.push(`${f}: bad name "${name}" (group.verb, exactly one dot, [a-z0-9-])`);
    if (seen.has(name)) problems.push(`${name}: duplicate (in ${seen.get(name)} and ${f})`);
    seen.set(name, f);
    if (op.method !== 'GET' && op.method !== 'POST') problems.push(`${name}: method must be GET or POST`);
    if (!EFFECTS.includes(op.effect)) problems.push(`${name}: effect must be one of ${EFFECTS.join(', ')}`);
    if (op.effect === 'read' && op.method !== 'GET') problems.push(`${name}: read ops are GET`);
    if (op.effect !== 'read' && op.method === 'GET') problems.push(`${name}: writes are POST`);
    if (op.destructive && op.method === 'GET') problems.push(`${name}: destructive ops are POST`);
    if (op.track !== undefined && typeof op.track !== 'boolean') problems.push(`${name}: track is true or false`);
    if (op.track !== undefined && op.effect === 'read') problems.push(`${name}: track is for writes`);
    if (!AGENT.includes(op.agent)) problems.push(`${name}: agent must be allow, deny or propose`);
    if (op.effect === 'confirm' && op.agent !== 'deny') problems.push(`${name}: confirm ops are agent: 'deny'`);
    if (op.agent === 'propose' && !KIND_RE.test(op.kind ?? '')) problems.push(`${name}: propose ops need kind (lower case words with _)`);
    if (op.agent === 'propose' && op.effect !== 'write') problems.push(`${name}: propose ops are writes`);
    if (op.agent === 'propose' && op.destructive) problems.push(`${name}: a deletion is not a proposal; make it agent: 'deny' or 'allow'`);
    if (op.kind !== undefined && op.agent !== 'propose') problems.push(`${name}: kind is only for propose ops`);
    if (op.auto !== undefined) {
      if (op.agent !== 'propose') problems.push(`${name}: auto is only for propose ops`);
      checkFn(name, 'auto', op.auto);
    }
    if (typeof op.desc !== 'string' || op.desc.length === 0) problems.push(`${name}: desc required`);
    else if (op.desc.length > 400) problems.push(`${name}: desc is ${op.desc.length} characters (at most 400)`);
    if (DASH.test(JSON.stringify(op))) problems.push(`${name}: no en or em dashes`);
    checkPerm(name, op.perm);
    checkFn(name, 'fn', op.fn);
    if (op.preview !== undefined) {
      if (op.agent !== 'propose') problems.push(`${name}: preview is only for propose ops`);
      checkFn(name, 'preview', op.preview);
    }
    if (op.pinIf !== undefined) checkFn(name, 'pinIf', op.pinIf);
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
    if (op.pinIf !== undefined) {
      if (op.effect === 'confirm') problems.push(`${name}: a confirm op always needs the PIN; pinIf is for writes`);
      if (params.pin !== undefined) problems.push(`${name}: "pin" is added for pinIf ops`);
      params.pin = PIN_IF_PARAM;
    }
    if (op.destructive && op.agent !== 'deny') {
      if (params.confirm !== undefined) problems.push(`${name}: "confirm" is reserved`);
      params.confirm = CONFIRM_PARAM;
    }
    if (op.effect === 'read' && op.agent !== 'deny' && params.full === undefined) params.full = FULL_PARAM;
    if (op.agent === 'propose') {
      for (const k of Object.keys(PROPOSAL_PARAMS)) {
        if (params[k] !== undefined) problems.push(`${name}: "${k}" is reserved for proposals`);
        params[k] = PROPOSAL_PARAMS[k];
      }
    }
    op.params = params;
    op.file = f;
    ops.push(op);
  }
}

/* ------------------------------------------------- module registrations */

const triggers = {};
for (const f of listFiles('events')) {
  let mod;
  try {
    mod = require(join(hooks, f));
  } catch (err) {
    problems.push(`${f} does not load in Node: ${err.message}`);
    continue;
  }
  for (const k of Object.keys(mod)) if (!EVENT_KEYS.includes(k)) problems.push(`${f}: unknown key "${k}" (keys: ${EVENT_KEYS.join(', ')})`);
  for (const [ev, fns] of Object.entries(mod.on ?? {})) for (const fn of Array.isArray(fns) ? fns : [fns]) checkFn(`${f} on ${ev}`, 'fn', fn);
  for (const k of ['needsYou', 'search', 'timeline', 'today']) if (mod[k] !== undefined) checkFn(`${f} ${k}`, k, mod[k]);
  // triggers: one per task, its params naming the record (lib_agent.js); tools/gen_triggers.mjs writes triggers.json from them.
  for (const [name, t] of Object.entries(mod.triggers ?? {})) {
    if (!KIND_RE.test(name)) problems.push(`${f}: trigger "${name}" must be lower case words with _`);
    if (triggers[name] !== undefined) problems.push(`${f}: trigger ${name} is also declared in ${triggers[name].file}`);
    for (const k of Object.keys(t)) if (!TRIGGER_KEYS.includes(k)) problems.push(`${f}: triggers.${name} has an unknown key "${k}"`);
    if (typeof t.record !== 'string' || (t.record !== '' && !/^[a-z][a-z_]*$/.test(t.record))) problems.push(`${f}: triggers.${name}.record is a collection name ('' for a firm task)`);
    if ((t.record === '') !== (t.param === '' || t.param === undefined)) problems.push(`${f}: triggers.${name}.param names the record id param exactly when record is set`);
    for (const k of ['label', 'description', 'fires', 'instruction']) if (typeof t[k] !== 'string' || t[k] === '') problems.push(`${f}: triggers.${name}.${k} is required`);
    if (t.cooldown !== undefined && !(Number.isInteger(t.cooldown) && t.cooldown >= 10)) problems.push(`${f}: triggers.${name}.cooldown is whole seconds, at least 10`);
    if (t.perm !== undefined && t.perm !== 'signed') for (const alt of String(t.perm).split('|')) checkPerm(`${f} triggers.${name}`, alt);
    if (t.policy !== undefined && (typeof t.policy.key !== 'string' || typeof t.policy.label !== 'string' || typeof t.policy.tip !== 'string')) problems.push(`${f}: triggers.${name}.policy is { key, label, tip }`);
    for (const k of ['deal', 'check', 'asked', 'ended']) if (t[k] !== undefined) checkFn(`${f} triggers.${name}.${k}`, k, t[k]);
    if (t.nda === true && t.deal === undefined) problems.push(`${f}: triggers.${name}.nda needs deal (whose NDA files open)`);
    triggers[name] = { file: f, module: f.slice('events_'.length, -3) };
  }
  for (const [key, v] of Object.entries(mod.settingsKeys ?? {})) if (v === null || typeof v !== 'object' || Array.isArray(v)) problems.push(`${f}: settingsKeys.${key} must be an object of defaults`);
  for (const [t, def] of Object.entries(mod.imports ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(t)) problems.push(`${f}: import target "${t}" must be lower case`);
    if (typeof def.label !== 'string') problems.push(`${f}: imports.${t}.label`);
    if (def.perm !== undefined) checkPerm(`${f} imports.${t}`, def.perm);
    if (def.pin !== undefined && typeof def.pin !== 'boolean') problems.push(`${f}: imports.${t}.pin must be true or false`);
    checkFn(`${f} imports.${t}`, 'row', def.row);
    if (!Array.isArray(def.fields) || def.fields.length === 0) problems.push(`${f}: imports.${t}.fields must be a list`);
    for (const fd of def.fields ?? []) {
      if (!/^[a-z][a-z0-9_]*$/.test(fd.key ?? '')) problems.push(`${f}: imports.${t} field key "${fd.key}"`);
      if (fd.type !== undefined && !IMPORT_TYPES.includes(fd.type)) problems.push(`${f}: imports.${t}.${fd.key} type must be one of ${IMPORT_TYPES.join(', ')}`);
      if (fd.synonyms !== undefined && !Array.isArray(fd.synonyms)) problems.push(`${f}: imports.${t}.${fd.key} synonyms must be a list`);
    }
  }
  if (DASH.test(JSON.stringify(mod))) problems.push(`${f}: no en or em dashes`);
}

const recipes = {};
for (const f of listFiles('guide')) {
  let g;
  try {
    g = require(join(hooks, f));
  } catch (err) {
    problems.push(`${f} does not load in Node: ${err.message}`);
    continue;
  }
  const mod = f.slice(0, -3);
  for (const [k, v] of Object.entries(g)) {
    if (['title', 'section', 'events'].includes(k)) continue;
    const steps = Array.isArray(v) ? v : [v];
    if (steps.length === 0 || steps.some((s) => typeof s !== 'string' || s === '')) problems.push(`${f}: recipe ${k} must be a non-empty string or list of strings`);
    recipes[mod + '.' + k] = k;
  }
  if (DASH.test(JSON.stringify(g))) problems.push(`${f}: no en or em dashes`);
}
for (const [name, t] of Object.entries(triggers)) if (recipes['guide_' + t.module + '.' + name] === undefined) problems.push(`${t.file}: trigger ${name} has no recipe ${name} in guide_${t.module}.js`);
for (const ref of Object.keys(recipes)) if (triggers[ref.split('.')[1]] === undefined) problems.push(`${ref.split('.')[0]}.js: recipe ${ref.split('.')[1]} is no trigger's (events_*.js triggers)`);

for (const f of listFiles('cron')) {
  let list;
  try {
    list = require(join(hooks, f));
  } catch (err) {
    problems.push(`${f} does not load in Node: ${err.message}`);
    continue;
  }
  if (!Array.isArray(list)) {
    problems.push(`${f}: must export a list of { name, schedule, fn, catchUp }`);
    continue;
  }
  for (const j of list) {
    if (typeof j.name !== 'string' || j.name === '') problems.push(`${f}: a job needs a name`);
    if (typeof j.schedule !== 'string' || j.schedule.trim().split(/\s+/).length !== 5) problems.push(`${f} ${j.name}: schedule has five fields`);
    checkFn(`${f} ${j.name}`, 'fn', j.fn);
    if (j.catchUp !== undefined && typeof j.catchUp !== 'boolean') problems.push(`${f} ${j.name}: catchUp is true or false`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s); nothing written.`);
  process.exit(1);
}

/* ---------------------------------------------------------------- write */

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
  const mark = op.agent === 'deny' ? ' [People only.]' : op.agent === 'propose' ? ' [Proposal (' + op.kind + ').]' : '';
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
  ...ops.map((op) => `  '${op.name}': { method: '${op.method}', effect: '${op.effect}', perm: '${op.perm}', agent: '${op.agent ?? 'allow'}'${op.kind ? `, kind: '${op.kind}'` : ''}${op.destructive ? ', destructive: true' : ''} },`),
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
console.log(`${ops.length} operations from ${files.length} catalog files (${by('read')} read, ${by('write')} write, ${by('confirm')} confirm; ${ops.filter((o) => o.agent === 'deny').length} people only, ${ops.filter((o) => o.agent === 'propose').length} proposed, ${ops.filter((o) => o.destructive).length} destructive); ${Object.keys(triggers).length} triggers`);
