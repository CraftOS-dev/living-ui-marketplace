// Shared harness for the portfolio tests.
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (default 3189), VO_BRIDGE (mock bridge, default port + 100).
// The scratch copy needs the scratch-only stub lib_funds.js (markOf) next to the hooks until funds lands.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3189);
export const BRIDGE = Number(process.env.VO_BRIDGE ?? PORT + 100);
/** True while the copy carries the scratch stubs of lib_funds.markOf and lib_committee.decisionOf (sections that steer them run only then). */
export const STUBBED = readFileSync(join(APP, 'pb', 'pb_hooks', 'lib_committee.js'), 'utf8').indexOf('SCRATCH STUB') >= 0;
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export const PEOPLE = {
  partner: 'pat@northwind.test',
  analyst: 'ana@northwind.test',
  platform: 'plato@northwind.test',
  outsider: 'oz@northwind.test',
};

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again with the mock bridge (reset too). */
export async function fresh() {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT), String(BRIDGE)], { stdio: 'pipe' });
  await bridge.reset();
}

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

/** First run (USD, UTC, Fund I) plus a partner, an analyst, a platform lead and a second partner (outsider of restricted deals). */
export async function setupFirm(api) {
  const s = await api.op('setup.complete', { firm_name: 'Northwind Ventures', base_currency: 'USD', zone: 'UTC', fund_name: 'Fund I', fund_size: '50000000', owner_name: 'Olivia Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
  api.setToken(DEMO.owner, s.token);
  const roles = { partner: 'partner', analyst: 'analyst', platform: 'platform', outsider: 'partner' };
  for (const [k, email] of Object.entries(PEOPLE)) {
    const inv = await api.op('members.invite', { email, name: k.charAt(0).toUpperCase() + k.slice(1) + ' Member', role: roles[k] }, { as: 'owner', pin: true });
    const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
    api.setToken(email, joined.token);
  }
  const members = await api.op('members.list', {}, { as: 'owner' });
  const byEmail = {};
  for (const m of members.members) byEmail[m.email] = m.id;
  return { fund: s.fund, members: byEmail };
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
  process.exitCode = failed > 0 ? 1 : 0;
  return { passed, failed, failures };
}

/** Multipart upload as a person: fields plus files [{ name, bytes }] in the `file` field. */
export async function upload(api, opName, fields, files, as) {
  await api.op('auth.me', {}, { as });
  const email = as === 'owner' ? DEMO.owner : as;
  const token = api.tokens.get(email);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const f of files) form.append('file', new Blob([f.bytes]), f.name);
  const res = await fetch(api.base + '/api/ops/' + opName.replace('.', '/'), { method: 'POST', headers: { authorization: token, accept: 'application/json' }, body: form });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Poll a condition (async fn -> truthy) until it holds or ms pass; answers the last value. */
export async function until(fn, ms = 60000, every = 400) {
  const end = Date.now() + ms;
  let v = null;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return v;
}

export const FIXTURES = join(APP, 'tools', 'dev', 'fixtures');
export function fixture(rel) {
  return readFileSync(join(FIXTURES, rel));
}

/** A portfolio-ready deal: company with domain, founders, at Term sheet. */
export async function dealFor(api, domain, name, founders, terms = {}) {
  const people = founders.map((f) => ({ person: f.email, role: 'founder' }));
  await api.op('companies.upsert', { domain: domain, name: name }, { as: 'owner' });
  for (const f of founders) await api.op('people.upsert', { email: f.email, name: f.name, company: domain }, { as: 'owner' });
  const d = (await api.op('deals.create', Object.assign({ company: domain, name: name, people: JSON.stringify(people) }, terms), { as: 'owner' })).deal;
  return d;
}

/** Scratch stubs of other modules' contracts read these files in pb_data (lib_funds.markOf, lib_committee.decisionOf). */
export function stubFile(name, obj) {
  writeFileSync(join(APP, 'pb', 'pb_data', name), JSON.stringify(obj));
}
