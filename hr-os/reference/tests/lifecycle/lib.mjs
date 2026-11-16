/**
 * Lifecycle test helpers: a fresh scratch server (reset, serve, optionally
 * the demo seed), an API client and small assertions that count and keep
 * going, then report.
 *
 *   import { fresh, api, ok, eq, refused, done } from './lib.mjs';
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PORT = Number(process.env.HR_PORT || 3188);
/** The app copy under test: HR_APP, else ../app (the builder's scratch), else the app these tests ship in (reference/tests/lifecycle). */
export const APP = process.env.HR_APP || (existsSync(join(HERE, '..', 'app', 'manifest.json')) ? join(HERE, '..', 'app') : join(HERE, '..', '..', '..'));
const devApi = await import(pathToFileURL(join(APP, 'tools', 'dev', 'api.mjs')).href);
export const client = devApi.client;
export const DEMO = devApi.DEMO;

/** True when an operation is in the app's catalog (other modules merged or not). */
export function hasOp(name) {
  return readFileSync(join(APP, 'operations.json'), 'utf8').indexOf('"' + name + '"') >= 0;
}

/** True when the scratch-only stub ops of other modules are installed (stubs.add, stubs.cron). */
export function hasStubs() {
  return readFileSync(join(APP, 'operations.json'), 'utf8').indexOf('"stubs.add"') >= 0;
}
const BASH = process.env.BASH || 'bash';

export function sh(script, args) {
  return execFileSync(BASH, [join(APP, 'tools', 'dev', script)].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Stop, wipe, serve; seed the demo company when asked. Returns a fresh client. */
export function fresh(opts = {}) {
  try {
    sh('stop.sh', [String(PORT)]);
  } catch {
    /* not running */
  }
  sh('reset.sh', [APP]);
  sh('serve.sh', [APP, String(PORT)]);
  if (opts.seed) execFileSync('node', [join(APP, 'tools', 'dev', 'seed_demo.mjs'), '--port', String(PORT), '--app', APP], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return client({ port: PORT, app: APP });
}

export function connect() {
  return client({ port: PORT, app: APP });
}

let passed = 0;
const failures = [];

export function ok(cond, what, extra) {
  if (cond) passed++;
  else {
    failures.push(what + (extra !== undefined ? ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 600)) : ''));
    console.log('  FAIL ' + what + (extra !== undefined ? ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 600)) : ''));
  }
  return cond;
}

export function eq(a, b, what) {
  return ok(JSON.stringify(a) === JSON.stringify(b), what, { got: a, want: b });
}

/** An answer that is a refusal with this status (and code when given). */
export function refused(r, status, code, what) {
  return ok(r.status === status && (code === undefined || (r.body && r.body.code === code)), what, { status: r.status, body: r.body });
}

export function no5xx(r, what) {
  return ok(r.status < 500, what + ' (no 5xx)', { status: r.status, body: r.body });
}

export function section(name) {
  console.log('- ' + name);
}

export function done(name) {
  console.log(name + ': ' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length > 0) process.exitCode = 1;
  return { passed, failed: failures.length, failures };
}

/** The lifecycle operations of operations.json: [{ name, method, params }]. */
export async function lifecycleOps() {
  const m = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
  const groups = ['lifecycle', 'checklist-templates', 'checklists', 'tasks', 'letter-templates', 'letters', 'separations', 'exit-forms', 'assets', 'handbook', 'grievance-types', 'grievances'];
  return m.operations.filter((o) => groups.indexOf(o.name.split('.')[0]) >= 0).map((o) => ({ name: o.name, method: o.executor.method, params: o.params, description: o.description }));
}
