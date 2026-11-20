// Shared harness for the Venture OS kernel-core tests.
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3181), VO_BRIDGE (mock bridge, default 3281).
// The scratch app needs the scratch-only test kit (tests/sync_stubs.sh): a fake module zz_test and
// stand-ins for kernel-records' deals, deal_people, files and lib_files.pathOf.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3181);
export const BRIDGE = Number(process.env.VO_BRIDGE ?? PORT + 100);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again with the mock bridge. */
export function fresh(opts = {}) {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)].concat(opts.noBridge ? [] : [String(BRIDGE)]), { stdio: 'pipe' });
}

/** Restart the server on the same database (boot work runs again). */
export function restart(opts = {}) {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)].concat(opts.noBridge ? [] : [String(BRIDGE)]), { stdio: 'pipe' });
}

/** The mock bridge's control endpoints. */
export const bridge = {
  async reset() {
    return (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/reset`, { method: 'POST' })).json();
  },
  async mode(action, mode, message) {
    return (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, mode, message }) })).json();
  },
  async sent() {
    return (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/sent`)).json();
  },
  async fires() {
    return (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/fires`)).json();
  },
};

/** First-run setup as the demo owner (USD, New York, Fund I of USD 50M). */
export async function setupFirm(api, extra = {}) {
  return api.op('setup.complete', Object.assign({ firm_name: 'Northwind Ventures', base_currency: 'USD', zone: 'America/New_York', fund_name: 'Fund I', fund_size: '50000000', fund_vintage: 2025, owner_name: 'Olivia Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin }, extra));
}

/** Invite a member with a role and sign them in (answers the email). */
export async function member(api, email, role, name, extra = {}) {
  const inv = await api.op('members.invite', Object.assign({ email, name: name || email.split('@')[0], role }, extra), { as: 'owner', pin: true });
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
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 500) : ''));
  }
}

/** JSON with object keys sorted (answers come back with sorted keys). */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

export function eq(a, b, msg) {
  ok(canon(a) === canon(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
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

/** A sample value for a required read param, so a sweep reaches the handler. */
export function sample(k, ctx) {
  const map = {
    entity: ctx.entity || 'Fund I',
    proposal: ctx.proposal || 'nope00000000000',
    ask: ctx.ask || 'nope00000000000',
    trigger: 'question_asked',
    member: ctx.member || DEMO.owner,
    outbound: ctx.outbound || 'nope00000000000',
    thing: ctx.thing || 'nope00000000000',
    deal: ctx.deal || 'nope00000000000',
    ref_collection: 'deals',
    ref_id: ctx.deal || 'nope00000000000',
    page: 'deals.table',
    q: 'no',
    amount: '100',
    from: 'USD',
    to: 'USD',
    day: '2026-11-04',
  };
  return map[k] ?? 'x';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
