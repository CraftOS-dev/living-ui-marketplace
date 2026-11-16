/**
 * A tiny test harness for the engine tests (no dependencies).
 *
 * The hooks folder is found by walking up from this file until a folder has
 * pb/pb_hooks/lib_expr.js (the app layout) or pb_hooks/lib_expr.js (the
 * engine scratch layout), or it is given as HR_HOOKS.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function findHooks() {
  if (process.env.HR_HOOKS) return resolve(process.env.HR_HOOKS);
  let dir = here;
  for (let i = 0; i < 8; i++) {
    for (const cand of [join(dir, 'pb', 'pb_hooks'), join(dir, 'pb_hooks')]) {
      if (existsSync(join(cand, 'lib_expr.js'))) return cand;
    }
    dir = dirname(dir);
  }
  throw new Error('cannot find pb_hooks with lib_expr.js above ' + here + ' (set HR_HOOKS)');
}

export const hooks = findHooks();
const req = createRequire(join(hooks, 'x.js'));
export function load(name) {
  return req(join(hooks, name));
}

const results = { pass: 0, fail: 0, failures: [] };
let currentFile = '';

export function file(name) {
  currentFile = name;
}

export function test(name, fn) {
  try {
    fn();
    results.pass++;
  } catch (err) {
    results.fail++;
    results.failures.push(currentFile + ' > ' + name + ': ' + (err && err.message ? err.message : String(err)));
  }
}

function show(v) {
  return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
}

export function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((what ? what + ': ' : '') + 'expected ' + e + ', got ' + a);
}

export function near(actual, expected, what, tol) {
  const t = tol === undefined ? 1e-9 : tol;
  if (typeof actual !== 'number' || Math.abs(actual - expected) > t * Math.max(1, Math.abs(expected))) {
    throw new Error((what ? what + ': ' : '') + 'expected ' + expected + ', got ' + show(actual));
  }
}

export function ok(cond, what) {
  if (!cond) throw new Error(what || 'expected true');
}

/** fn must throw; code (optional) must match err.code; part (optional) must be in the message. */
export function throws(fn, code, part) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error('expected an error' + (code ? ' ' + code : ''));
  if (code && err.code !== code) throw new Error('expected error code ' + code + ', got ' + err.code + ' (' + err.message + ')');
  if (part && String(err.message).indexOf(part) < 0) throw new Error('expected the message to mention ' + JSON.stringify(part) + ', got ' + JSON.stringify(err.message));
  return err;
}

export function report() {
  for (const f of results.failures) console.log('FAIL ' + f);
  console.log(results.pass + ' passed, ' + results.fail + ' failed');
  return results.fail;
}
