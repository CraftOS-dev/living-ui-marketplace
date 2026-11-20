// Shared harness for the payroll-out tests. Env: HR_APP (scratch app), HR_PORT (default 3192).
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP = process.env.HR_APP ?? join(HERE, '..', 'app');
export const PORT = Number(process.env.HR_PORT ?? 3192);
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };

export function newApi() {
  return client({ port: PORT, app: APP });
}

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
    if (!process.env.QUIET) console.log('  ok   ' + msg);
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

/** Raw bytes of a streamed download (a GET op answered with a file). */
export async function bytesOf(api, name, params, as) {
  const r = await api.call(name, params, { as });
  return r;
}

export async function download(api, name, params, as) {
  const h = {};
  if (as === 'agent') h['X-A2App-Token'] = (await import('node:fs')).readFileSync(join(APP, '.agent-token'), 'utf8').trim();
  else {
    const email = as === 'owner' ? DEMO.owner : as;
    if (!api.tokens.has(email)) await api.login(email);
    h.authorization = api.tokens.get(email);
  }
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(api.base + '/api/ops/' + name.replace('.', '/') + '?' + qs, { headers: h });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '' };
}
