// Shared harness for the Venture OS markets tests (kernel-core's harness, markets ports).
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3191), VO_BRIDGE (mock bridge, default port + 100).
// The scratch app needs the markets stubs (stubs/pb_hooks: lib_intake.add, lib_portfolio.holdingsOf,
// diligence compare.* stand-ins and zzstub.* ops); see README.md.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3191);
export const BRIDGE = Number(process.env.VO_BRIDGE ?? PORT + 100);
export const FIXTURES = join(HERE, 'fixtures');
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again with the mock bridge. */
export function fresh() {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT), String(BRIDGE)], { stdio: 'pipe' });
}

/** First-run setup as the demo owner (USD, New York, Fund I). */
export async function setupFirm(api) {
  return api.op('setup.complete', { firm_name: 'Northwind Ventures', base_currency: 'USD', zone: 'America/New_York', fund_name: 'Fund I', fund_size: '50000000', fund_vintage: 2025, owner_name: 'Olivia Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin }, { as: 'anon' });
}

/** Invite a member with a role and sign them in (answers the email). */
export async function member(api, email, role, name) {
  const inv = await api.op('members.invite', { email, name: name || email.split('@')[0], role }, { as: 'owner', pin: true });
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  return email;
}

/** The firm with a partner and an analyst. */
export async function firm(api) {
  await setupFirm(api);
  await member(api, 'partner@venture.test', 'partner', 'Pat Partner');
  await member(api, 'analyst@venture.test', 'analyst', 'Ana Analyst');
  await member(api, 'scout@venture.test', 'scout', 'Sam Scout');
  return { owner: 'owner', partner: 'partner@venture.test', analyst: 'analyst@venture.test', scout: 'scout@venture.test', agent: 'agent' };
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
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 700) : ''));
  }
}

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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A thesis and its radar with registry sources only (no network). */
export async function thesisWithRadar(api, name, criteria, sources) {
  const t = await api.op('theses.save', { name, criteria: JSON.stringify(criteria || []) }, { as: 'owner' });
  const r = await api.op('radars.save', { thesis: t.thesis.id, sources: JSON.stringify(sources || ['companies_house']), schedule: 'weekly mon 08:00', query: 'payments' }, { as: 'owner' });
  return { thesis: t.thesis, radar: r.radar };
}
