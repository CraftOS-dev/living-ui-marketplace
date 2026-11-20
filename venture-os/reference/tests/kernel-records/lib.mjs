// Shared harness for the kernel-records tests.
// Env: VO_APP (scratch app dir, default ../app), VO_PORT (scratch port, default 3182).
// The scratch copy carries the scratch-only test kit (cat_standin_kernel.js
// testkit.* ops, events_testkit.js, lib_testkit.js) next to the kernel.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.VO_PORT ?? 3182);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export const PEOPLE = {
  partner: 'pat@northwind.test',
  analyst: 'ana@northwind.test',
  outsider: 'oz@northwind.test',
  finance: 'fin@northwind.test',
  scout: 'sky@northwind.test',
  scout2: 'sam.scout@northwind.test',
};

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again. */
export function fresh() {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)], { stdio: 'pipe' });
}

/** First run plus a partner, an analyst, a second partner (the outsider of restricted deals), finance and two scouts. */
export async function setupFirm(api) {
  const s = await api.op('setup.complete', { firm_name: 'Northwind Ventures', base_currency: 'USD', zone: 'UTC', fund_name: 'Fund I', fund_size: '50000000', fund_vintage: 2025, owner_name: 'Olivia Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
  api.setToken(DEMO.owner, s.token);
  const roles = { partner: 'partner', analyst: 'analyst', outsider: 'partner', finance: 'finance', scout: 'scout', scout2: 'scout' };
  for (const [k, email] of Object.entries(PEOPLE)) {
    const inv = await api.op('members.invite', { email, name: k.charAt(0).toUpperCase() + k.slice(1), role: roles[k] }, { as: 'owner', pin: true });
    const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
    api.setToken(email, joined.token);
  }
  const members = await api.op('members.list', {}, { as: 'owner' });
  const byEmail = {};
  for (const m of members.members) byEmail[m.email] = m.id;
  return { fund: s.fund.id, members: byEmail };
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
  process.exitCode = failed > 0 ? 1 : 0;
  return { passed, failed, failures };
}

/** Multipart upload as a person (the page's way): fields plus files [{ name, bytes }] in the `file` field. */
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

/** Poll files.get until the text step ended. */
export async function waitText(api, file, as, ms = 120000, extra = {}) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = await api.call('files.get', Object.assign({ file }, extra), { as });
    const st = last.body && last.body.file ? last.body.file.text_state : '';
    if (st !== 'waiting' && st !== 'extracting' && st !== '') return last.body;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last ? last.body : null;
}

export function readText(p) {
  return readFileSync(p, 'utf8');
}

export { basename };
