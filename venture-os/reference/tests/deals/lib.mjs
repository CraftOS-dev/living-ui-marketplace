// Shared harness for the deals module tests (Venture OS).
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3186), VO_BRIDGE (mock bridge, default port + 100).
// The scratch app carries scratch-only stand-ins (cat_zz_stub.js, lib_zz_stub.js): refs.log (diligence),
// intake.verdict (intake), briefs.list (network) and the test helpers zz.emit, zz.cron, zz.backdate.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3186);
export const BRIDGE = Number(process.env.VO_BRIDGE ?? PORT + 100);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

/** The mock bridge's recorded trigger fires. */
export const bridge = {
  async fires() {
    return (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/fires`)).json();
  },
};

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again with the mock bridge. */
export function fresh() {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT), String(BRIDGE)], { stdio: 'pipe' });
}

export async function setupFirm(api) {
  return api.op('setup.complete', { firm_name: 'Northwind Ventures', base_currency: 'USD', zone: 'America/New_York', fund_name: 'Fund I', fund_size: '50000000', fund_vintage: 2025, owner_name: 'Olivia Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
}

/** Invite a member with a role and sign them in. */
export async function member(api, email, role, name) {
  const inv = await api.op('members.invite', { email, name: name || email.split('@')[0], role }, { as: 'owner', pin: true });
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

export function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
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

/** Wait until fn() answers truthy (polls every 300 ms). */
export async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(300);
  }
}
