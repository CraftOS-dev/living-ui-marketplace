/**
 * A tiny Node client for HR OS operations, used by every builder's tests.
 *
 *   import { client } from '<APP>/tools/dev/api.mjs';
 *   const api = client({ port: 3181, app: '<scratch app dir>' });
 *   await api.op('people.directory', { status: 'all' }, { as: 'owner' });
 *   await api.op('questions.list', {}, { as: 'agent' });
 *   await api.op('members.invite', { ... }, { as: 'owner', pin: true });   // adds the demo PIN
 *   const r = await api.call('people.get', { employee: 'E0001' }, { as: 'hr@northwind.test' });  // { status, body } without throwing
 *
 * `as`: 'owner' | 'agent' | 'anon' | an email (members sign in through
 * auth.login with the demo password, tokens cached) | { email, password }.
 * GET ops send params as the query string, POST ops as a JSON body; the
 * method comes from the app's operations.json. op() throws on an error
 * answer (err.status, err.code, err.body); call() never throws.
 *
 * CLI: node tools/dev/api.mjs <op> [--param value ...] [--as owner|agent|<email>] [--port 3181] [--app <dir>]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO = {
  owner: 'owner@northwind.test',
  password: 'demo-pass-1',
  pin: '123456',
};

export function client(opts = {}) {
  const port = Number(opts.port ?? process.env.HR_PORT ?? 3181);
  const app = opts.app ?? process.env.HR_APP ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const base = `http://127.0.0.1:${port}`;
  const ownerEmail = opts.owner ?? process.env.HR_OWNER ?? DEMO.owner;
  const password = opts.password ?? DEMO.password;
  const tokens = new Map();
  let methods = null;
  let cookie = null;

  /** The page's session cookie, as a browser gets it when it loads the app (writes need it, or a token). */
  const sessionCookie = async () => {
    if (cookie !== null) return cookie;
    const res = await fetch(base + '/', { redirect: 'manual' });
    await res.text();
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
    cookie = set
      .map((c) => String(c).split(';')[0])
      .filter((c) => c.startsWith('a2app_s_'))
      .join('; ');
    return cookie;
  };

  const methodOf = (name) => {
    if (methods === null) {
      methods = new Map();
      const manifest = JSON.parse(readFileSync(join(app, 'operations.json'), 'utf8'));
      for (const o of manifest.operations) methods.set(o.name, o.executor.method);
    }
    const m = methods.get(name);
    if (m === undefined) throw new Error(`unknown operation ${name} (not in ${join(app, 'operations.json')})`);
    return m;
  };

  const agentToken = () => readFileSync(join(app, '.agent-token'), 'utf8').trim();

  async function raw(name, params = {}, headers = {}) {
    const method = methodOf(name);
    const path = '/api/ops/' + name.replace('.', '/');
    let url = base + path;
    const c = await sessionCookie();
    const init = { method, headers: Object.assign({ accept: 'application/json' }, c !== '' ? { cookie: c } : {}, headers) };
    if (method === 'GET') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      const s = qs.toString();
      if (s !== '') url += '?' + s;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(params);
    }
    let res = await fetch(url, init);
    // PocketBase rate limits bursts (429): wait and try again, as a person would.
    for (let i = 0; i < 20 && res.status === 429; i++) {
      await res.text();
      await new Promise((r) => setTimeout(r, 500 + i * 250));
      res = await fetch(url, init);
    }
    const text = await res.text();
    let body;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  }

  async function login(email, pw) {
    const r = await raw('auth.login', { email, password: pw ?? password });
    if (r.status !== 200) {
      const err = new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
      err.status = r.status;
      err.body = r.body;
      throw err;
    }
    tokens.set(email, r.body.token);
    return r.body;
  }

  async function headersFor(as) {
    if (as === undefined || as === 'anon') return {};
    if (as === 'agent') return { 'X-A2App-Token': agentToken() };
    const who = typeof as === 'object' ? as : { email: as === 'owner' ? ownerEmail : as };
    if (!tokens.has(who.email)) await login(who.email, who.password);
    return { authorization: tokens.get(who.email) };
  }

  /** { status, body } of one op; never throws on an error answer. */
  async function call(name, params = {}, o = {}) {
    const p = Object.assign({}, params);
    if (o.pin === true) p.pin = DEMO.pin;
    else if (typeof o.pin === 'string') p.pin = o.pin;
    const r = await raw(name, p, await headersFor(o.as));
    if (r.status === 401 && o.as !== 'agent' && o.as !== 'anon' && o.as !== undefined && !o.retried) {
      const who = typeof o.as === 'object' ? o.as.email : o.as === 'owner' ? ownerEmail : o.as;
      tokens.delete(who);
      if (r.body && r.body.code === 'session_required') return call(name, params, Object.assign({}, o, { retried: true }));
    }
    return r;
  }

  /** The answer body of one op; throws an Error with status, code and body on an error answer. */
  async function op(name, params = {}, o = {}) {
    const r = await call(name, params, o);
    if (r.status >= 400) {
      const err = new Error(`${name} -> ${r.status} ${r.body && r.body.code ? r.body.code + ': ' : ''}${r.body && r.body.message ? r.body.message : JSON.stringify(r.body)}`);
      err.status = r.status;
      err.code = r.body && r.body.code;
      err.body = r.body;
      throw err;
    }
    return r.body;
  }

  return { base, port, app, op, call, raw, login, tokens, setToken: (email, t) => tokens.set(email, t), forget: (email) => tokens.delete(email) };
}

/* ------------------------------------------------------------------- CLI */

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/tools/dev/api.mjs')) {
  const args = process.argv.slice(2);
  const name = args.shift();
  if (!name) {
    console.error('usage: node tools/dev/api.mjs <op> [--param value ...] [--as owner|agent|<email>] [--port 3181] [--app <dir>] [--pin]');
    process.exit(2);
  }
  const params = {};
  const o = {};
  let port;
  let app;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    if (k === 'as') o.as = v;
    else if (k === 'port') port = Number(v);
    else if (k === 'app') app = v;
    else if (k === 'pin' && v === 'true') o.pin = true;
    else params[k] = v;
  }
  const api = client({ port, app });
  const r = await api.call(name, params, o);
  console.log(JSON.stringify(r.body, null, 2));
  process.exitCode = r.status >= 400 ? 1 : 0;
}
