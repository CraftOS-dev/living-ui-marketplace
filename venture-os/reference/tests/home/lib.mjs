// Shared harness for the home builder's tests.
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3192), VO_BRIDGE (mock bridge, default port + 100).
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3192);
export const BRIDGE = Number(process.env.VO_BRIDGE ?? PORT + 100);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server and its mock bridge, wipe the database, start both again (kernel fixtures). */
export function fresh() {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(BRIDGE)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT), String(BRIDGE)], { stdio: 'pipe' });
}

/** The demo firm through tools/dev/seed_demo.mjs (fresh database, demo calendar on the mock bridge). */
export function seedDemo() {
  execFileSync('node', [join(APP, 'tools', 'dev', 'seed_demo.mjs'), APP, String(PORT), String(BRIDGE), '--fresh'], { stdio: 'inherit' });
}

export async function setupFirm(api, extra = {}) {
  return api.op('setup.complete', Object.assign({ firm_name: 'Larkspur Ventures', base_currency: 'USD', zone: 'America/New_York', fund_name: 'Fund I', fund_size: '50000000', fund_vintage: 2024, owner_name: 'Olivia Hart', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin }, extra));
}

/** Invite a member with a role and sign them in. */
export async function member(api, email, role, name) {
  const inv = await api.op('members.invite', { email, name, role }, { as: 'owner', pin: true });
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  return email;
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
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''));
  }
}

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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
