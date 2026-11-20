// Shared loader for the engine tests: the engines are CommonJS files in
// pb/pb_hooks (the same files PocketBase's Goja loads); expected.json holds
// the values expected.py computed independently.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const HOOKS = fileURLToPath(new URL('../../pb/pb_hooks/', import.meta.url));

export function eng(name) {
  return require(HOOKS + name + '.js');
}

export const expected = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));

export function engineFiles() {
  return readdirSync(HOOKS).filter((f) => /^lib_eng_[a-z]+\.js$/.test(f));
}

/** Seeded PRNG (mulberry32) for the property tests. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** assert.throws matcher on the kernel error code. */
export function code(c) {
  return (err) => err && err.code === c && err.status === 400;
}
