// Shared test harness for the HR OS expenses tests.
// Env: HR_APP (scratch app dir, default ../app), HR_PORT (scratch port, default 3185).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.HR_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.HR_PORT ?? 3185);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Stop the scratch server, wipe its database, start it again (and seed the demo when asked). */
export function fresh(opts = {}) {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)], { stdio: 'pipe' });
  if (opts.seed) execFileSync('node', [join(APP, 'tools', 'dev', 'seed_demo.mjs'), '--port', String(PORT), '--app', APP], { stdio: 'pipe', timeout: 600000 });
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

/** The expenses operations in operations.json. */
export function expensesOps() {
  const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
  return manifest.operations.filter((o) => /^(expenses|expense-categories|claims|claim-lines|advances|travel)\./.test(o.name));
}

/** A tiny PNG (1x1) so receipts upload as real images. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** POST a multipart op (files and fields) as a signed-in member. */
export async function upload(api, name, fields, files, as) {
  await api.op('auth.me', {}, { as });
  const email = as === 'owner' ? DEMO.owner : as;
  const token = api.tokens.get(email);
  const page = await fetch(api.base + '/', { redirect: 'manual' });
  await page.text();
  const set = typeof page.headers.getSetCookie === 'function' ? page.headers.getSetCookie() : [];
  const cookie = set.map((c) => String(c).split(';')[0]).filter((c) => c.startsWith('a2app_s_')).join('; ');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) if (v !== undefined && v !== null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const [k, f] of Object.entries(files || {})) fd.append(k, new Blob([f.data], { type: f.type }), f.name);
  let res;
  for (let i = 0; i < 10; i++) {
    res = await fetch(api.base + '/api/ops/' + name.replace('.', '/'), { method: 'POST', headers: Object.assign({ authorization: token, accept: 'application/json' }, cookie ? { cookie } : {}), body: fd });
    if (res.status !== 429) break;
    await res.text();
    await new Promise((r) => setTimeout(r, 600));
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** A sample value for a required read param, so a sweep reaches the handler. */
export function sample(k, ctx) {
  const map = {
    claim: ctx.claim || 'EXP-9999',
    line: ctx.line || 'nope00000000000',
    advance: ctx.advance || 'ADV-9999',
    travel: ctx.travel || 'TRV-9999',
    entity: ctx.entity || '',
    employee: ctx.employee || 'E0001',
    employment: ctx.employment || 'E0001',
  };
  return map[k] ?? 'x';
}

export const EMAILS = {
  hr: 'hr@northwind.test',
  payroll: 'payroll@northwind.test',
  eng: 'eng.lead@northwind.test',
  sales: 'sales.lead@northwind.test',
  sam: 'sam@northwind.test',
  haruto: 'haruto@northwind.test',
  ananya: 'ananya@northwind.test',
};
