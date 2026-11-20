// Test harness for the HR OS home-reports module.
// Env: HR_APP (scratch app dir), HR_PORT (scratch port, default 3190).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The app copy under test: HR_APP, else ../app (the builder's scratch), else the app these tests ship in (reference/tests/home-reports). */
export const APP = process.env.HR_APP ?? (existsSync(join(HERE, '..', 'app', 'manifest.json')) ? join(HERE, '..', 'app') : join(HERE, '..', '..', '..'));
export const PORT = Number(process.env.HR_PORT ?? 3190);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export const OWNER = { as: 'owner' };
export const HR = { as: 'hr@northwind.test' };
export const PAYROLL = { as: 'payroll@northwind.test' };
export const ENG = { as: 'eng.lead@northwind.test' };
export const SALES = { as: 'sales.lead@northwind.test' };
export const SAM = { as: 'sam@northwind.test' };
export const HARUTO = { as: 'haruto@northwind.test' };
export const ANANYA = { as: 'ananya@northwind.test' };
export const AGENT = { as: 'agent' };
export const PIN = { as: 'owner', pin: true };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again (and seed the demo when asked). */
export function fresh(opts = {}) {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)], { stdio: 'pipe' });
  if (opts.seed) execFileSync('node', [join(APP, 'tools', 'dev', 'seed_demo.mjs'), '--port', String(PORT), '--app', APP], { stdio: 'pipe' });
}

let passed = 0;
let failed = 0;
const failures = [];
let current = '';

export function section(name) {
  current = name;
  console.log('\n## ' + name);
}

export function ok(cond, msg, extra) {
  if (cond) {
    passed++;
    console.log('  ok   ' + msg);
  } else {
    failed++;
    failures.push(current + ': ' + msg);
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 800) : ''));
  }
}

export function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

/** Expect an error answer with this status (and code). */
export async function refuses(api, name, params, o, status, code, msg) {
  const r = await api.call(name, params, o);
  ok(r.status === status && (code === undefined || (r.body && r.body.code === code)), msg + ' -> ' + status + (code ? ' ' + code : ''), { status: r.status, body: r.body });
  return r;
}

export function summary(name) {
  console.log(`\n${name}: ${passed} passed, ${failed} failed`);
  if (failed > 0) for (const f of failures) console.log('  - ' + f);
  return { passed, failed, failures };
}

/** Employee row by work email (as the owner). */
export async function emp(api, email) {
  const d = await api.op('people.directory', { q: email, status: 'all' }, OWNER);
  const x = d.people.find((p) => p.work_email === email);
  if (!x) throw new Error('no employee ' + email);
  return x;
}

/** Every read operation of this module. */
export const READS = [
  ['home.admin', {}],
  ['home.manager', {}],
  ['home.me', {}],
  ['home.me', { places: true }],
  ['reports.list', {}],
  ['reports.headcount', {}],
  ['reports.headcount', { group_by: 'department' }],
  ['reports.headcount', { group_by: 'location' }],
  ['reports.movement', {}],
  ['reports.tenure', {}],
  ['reports.span', {}],
  ['reports.diversity', { dimension: 'gender' }],
  ['reports.diversity', { dimension: 'age' }],
  ['reports.diversity', { dimension: 'nationality' }],
  ['reports.comp-bands', {}],
  ['reports.cost', {}],
  ['reports.leave-liability', {}],
  ['reports.leave-liability', { basis: 'paid' }],
  ['reports.absence', {}],
  ['reports.hiring', {}],
  ['reports.training', {}],
];
