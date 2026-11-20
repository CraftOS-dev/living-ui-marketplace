// Shared harness for the HR OS hiring tests (hiring builder).
// Env: HR_APP (scratch app dir, default ../app), HR_PORT (default 3187).
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.HR_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.HR_PORT ?? 3187);
export const FIXTURES = join(HERE, 'fixtures');
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again (with env for a fake bridge), seed when asked. */
export function fresh(opts = {}) {
  const env = Object.assign({}, process.env, opts.env || {});
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)], { stdio: 'pipe', env });
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
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : ''));
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

/** Invite a member with a role (and an employee), accept, set the PIN. */
export async function member(api, email, name, role, employee) {
  const inv = await api.op('members.invite', { email, name, role, employee }, { as: 'owner', pin: true });
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: email });
  return joined;
}

/** A sample value for a required read param, so a sweep reaches the handler. */
export function sample(k, ctx) {
  const map = {
    employee: ctx.employee || 'E0001',
    employment: ctx.employment || 'E0001',
    entity: ctx.entity || 'Northwind Pte Ltd',
    opening: ctx.opening || 'J0001',
    candidate: ctx.candidate || 'nope00000000000',
    application: ctx.application || 'nope00000000000',
    interview: ctx.interview || 'nope00000000000',
    offer: ctx.offer || 'OF0001',
    requisition: ctx.requisition || 'R0001',
    plan: ctx.plan || 'nope00000000000',
    approval: 'nope00000000000',
    proposal: 'nope00000000000',
    job: 'nope00000000000',
    member: 'owner@northwind.test',
    calendar: 'SG',
    country: 'SG',
    document: 'nope00000000000',
    identity_doc: 'nope00000000000',
    email: 'nobody@example.com',
    q: 'no',
    day: '2026-11-04',
  };
  return map[k] ?? 'x';
}
