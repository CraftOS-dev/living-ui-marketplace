// Every call the time module's files make into a library (its own, the kernel's or
// another module's) must name a function that library exports. Loads the libs in Node.
//   node xcalls.mjs <pb_hooks dir>
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const dir = process.argv[2];
const require = createRequire(import.meta.url);
const mine = readdirSync(dir).filter((f) => /^(lib_time|cat_time_|events_time|cron_time|guide_time)/.test(f));
const calls = new Map();
const add = (lib, fn, where) => {
  const k = lib + '.' + fn;
  if (!calls.has(k)) calls.set(k, where);
};
for (const f of mine) {
  const s = readFileSync(join(dir, f), 'utf8');
  for (const m of s.matchAll(/L\('(lib_[a-z_]+)'\)\.([A-Za-z_]+)/g)) add(m[1], m[2], f);
  for (const m of s.matchAll(/require\(`\$\{__hooks\}\/(lib_[a-z_]+)\.js`\)\.([A-Za-z_]+)/g)) add(m[1], m[2], f);
  for (const m of s.matchAll(/'(lib_[a-z_]+)\.([A-Za-z_]+)'/g)) add(m[1], m[2], f);
  for (const m of s.matchAll(/\bT\(\)\.([A-Za-z_]+)/g)) add('lib_time', m[1], f);
  for (const m of s.matchAll(/\b(?:u\(\)|util)\.([A-Za-z_]+)/g)) add('lib_util', m[1], f);
  // aliases: const people = L('lib_people'); people.fn(
  for (const a of s.matchAll(/const ([a-zA-Z]+) = L\('(lib_[a-z_]+)'\);/g)) {
    const re = new RegExp('\\b' + a[1] + '\\.([A-Za-z_]+)\\b', 'g');
    for (const m of s.matchAll(re)) add(a[2], m[1], f);
  }
  // helpers returning a lib: function T() { return L('lib_time'); } handled above
}
let bad = 0;
const per = {};
for (const [k, where] of [...calls.entries()].sort()) {
  const [lib, fn] = k.split('.');
  let ex;
  try {
    ex = require(join(dir, lib + '.js'));
  } catch (e) {
    console.log('LOAD FAIL', lib, e.message);
    bad++;
    continue;
  }
  if (ex[fn] === undefined) {
    console.log('MISSING', k, 'called in', where);
    bad++;
  }
  per[lib] = (per[lib] || 0) + 1;
}
console.log(JSON.stringify(per));
console.log(calls.size + ' calls checked, ' + bad + ' missing');
process.exit(bad === 0 ? 0 : 1);
