// QA harness for HR OS (integration and backend QA).
// Env: QA_APP (scratch app dir), QA_PORT (3191 or 3192).
import { createRequire } from 'node:module';
import { readdirSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
// QA_APP is a scratch copy of APP (never the delivered folder); results land next to it in results/.
if (!process.env.QA_APP) throw new Error('set QA_APP to a scratch copy of the app (and QA_PORT to 3191 or 3192)');
export const APP = resolve(process.env.QA_APP);
if (/agent_file_system[\\/]workspace[\\/]agent_app[\\/]hr_os_37878b99$/.test(APP)) throw new Error('QA runs on a scratch copy, never on the delivered app folder');
export const QA = dirname(APP);
export const PORT = Number(process.env.QA_PORT ?? 3191);
if (PORT < 3191 || PORT > 3192) throw new Error('QA uses ports 3191 and 3192 only');
const { client, DEMO } = await import('file:///' + join(APP, 'tools', 'dev', 'api.mjs').replace(/\\/g, '/'));
export { DEMO };
const require = createRequire(import.meta.url);

export function newApi() {
  return client({ port: PORT, app: APP });
}

/** Every catalog entry (cat_*.js), as the generator sees it, plus the params it adds. */
export function catalog() {
  const hooks = join(APP, 'pb', 'pb_hooks');
  const out = [];
  for (const f of readdirSync(hooks).filter((n) => /^cat_[a-z0-9_]+\.js$/.test(n)).sort()) {
    for (const op0 of require(join(hooks, f))) {
      const op = Object.assign({ file: f }, op0);
      op.params = Object.assign({}, op0.params || {});
      if (op.effect === 'confirm') op.params.pin = { type: 'string', required: true, secret: true };
      if (op.destructive && op.agent !== 'deny') op.params.confirm = { type: 'boolean' };
      if (op.agent === 'propose') op.params.why = { type: 'string' };
      op.agent = op.agent || 'allow';
      out.push(op);
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** One call with wall time and the dispatcher's Server-Timing. Never throws. */
export async function timed(api, name, params, o) {
  const t0 = performance.now();
  let r;
  try {
    r = await api.call(name, params, o);
  } catch (err) {
    return { status: 0, body: String(err && err.message), ms: performance.now() - t0, server: null };
  }
  const ms = performance.now() - t0;
  let server = null;
  try {
    const st = r.headers.get('server-timing') || '';
    const m = /dur=([0-9.]+)/.exec(st);
    if (m) server = Number(m[1]);
  } catch {
    server = null;
  }
  return { status: r.status, body: r.body, ms, server };
}

const SEAL_KEYS = /(_sealed$|^pin_hash$|^password$|^passwordHash$|^tokenKey$|^recovery_hash$|^invite_hash$|^kiosk_pin_hash$)/;
/** Paths of sealed or secret keys and of known plain secrets inside an answer. */
export function sealedIn(body, plains = []) {
  const hits = [];
  const walk = (v, p) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      for (const s of plains) if (s && v.includes(s)) hits.push(p + ' contains a plain secret');
      return;
    }
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, p + '[' + i + ']'));
      return;
    }
    for (const k of Object.keys(v)) {
      if (SEAL_KEYS.test(k) && v[k] !== '' && v[k] !== null && v[k] !== false) hits.push(p + '.' + k);
      walk(v[k], p + '.' + k);
    }
  };
  walk(body, '');
  return hits;
}

/** A clean refusal: JSON with status, code and a message, and a 4xx status. */
export function cleanError(r) {
  return r.status >= 400 && r.status < 500 && r.body && typeof r.body === 'object' && typeof r.body.code === 'string' && typeof r.body.message === 'string' && r.body.message.length > 0;
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
    failures.push(current + ': ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : ''));
    console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 800) : ''));
  }
  return cond;
}
export function eq(a, b, msg) {
  return ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}
export function summary(name) {
  console.log(`\n${name}: ${passed} passed, ${failed} failed`);
  if (failed > 0) for (const f of failures) console.log('  - ' + f);
  return { passed, failed, failures };
}

/** Record a finding candidate (the FINDINGS.md file is written by hand from these). */
export function note(kind, data) {
  const dir = join(QA, 'results');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'notes.jsonl'), JSON.stringify(Object.assign({ at: new Date().toISOString(), kind }, data)) + '\n');
}

export function writeResult(name, data) {
  const dir = join(QA, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

/** Lines of the scratch server log that say an operation failed (5xx causes). */
export function serverErrors(sinceBytes = 0) {
  const p = join(APP, 'logs', 'scratch_' + PORT + '.log');
  if (!existsSync(p)) return { size: 0, lines: [] };
  const all = readFileSync(p, 'utf8');
  const tail = all.slice(sinceBytes);
  return { size: all.length, lines: tail.split('\n').filter((l) => /\[hr\].*failed|panic|RECOVERED|Error:/.test(l)) };
}

export function logSize() {
  const p = join(APP, 'logs', 'scratch_' + PORT + '.log');
  return existsSync(p) ? readFileSync(p, 'utf8').length : 0;
}

export function freshServer(opts = {}) {
  execFileSync('bash', [join(APP, 'tools', 'dev', 'stop.sh'), String(PORT)], { stdio: 'pipe' });
  if (opts.reset !== false) execFileSync('bash', [join(APP, 'tools', 'dev', 'reset.sh'), APP], { stdio: 'pipe' });
  const t0 = Date.now();
  const out = execFileSync('bash', [join(APP, 'tools', 'dev', 'serve.sh'), APP, String(PORT)], { stdio: 'pipe' }).toString();
  return { ms: Date.now() - t0, out };
}

export const O = { as: 'owner' };
export const AG = { as: 'agent' };
export const PIN = { as: 'owner', pin: true };

/** Members by role for a company, made through invites (PIN 123456, password demo-pass-1). */
export async function makeMember(api, email, name, role, employee) {
  const p = { email, name, role };
  if (employee) p.employee = employee;
  const inv = await api.op('members.invite', p, PIN);
  const joined = await api.op('auth.accept-invite', { email, code: inv.code, password: DEMO.password });
  api.setToken(email, joined.token);
  await api.op('pin.set', { password: DEMO.password, new_pin: DEMO.pin }, { as: email });
  return { member: inv.member || joined.member, email };
}

/** Fill required params with plausible dummies (ids that do not exist, the first enum value). */
export function dummyParams(op, sample = {}) {
  const p = {};
  for (const [k, d] of Object.entries(op.params || {})) {
    if (!d.required) continue;
    if (k === 'pin') continue;
    if (sample[k] !== undefined) p[k] = sample[k];
    else if (d.enum) p[k] = d.enum[0];
    else if (d.type === 'number') p[k] = 1;
    else if (d.type === 'boolean') p[k] = true;
    else if (/day|from|to|start|end|date|period/.test(k)) p[k] = '2026-11-02';
    else if (/^at$|_at$/.test(k)) p[k] = '2026-11-02T09:00:00Z';
    else if (/amount|_minor|rate|price/.test(k)) p[k] = '10.00';
    else if (/email/.test(k)) p[k] = 'nobody@example.test';
    else if (/^(fields|items|lines|rules|payload|data|answers|scores|steps|week|tasks|sections|key_results)$/.test(k)) p[k] = '{}';
    else p[k] = 'zzzzzzzzzzzzzzz';
  }
  return p;
}
