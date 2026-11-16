// Scratch: every t('key') used in src/app exists in the English catalogs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(n)) files.push(p); } };
walk(root);
const cat = {};
for (const f of readdirSync(join(root, 'i18n'))) {
  const src = readFileSync(join(root, 'i18n', f), 'utf8');
  for (const m of src.matchAll(/^\s*'([^']+)':/gm)) { if (cat[m[1]]) console.log('DUP', f, m[1]); cat[m[1]] = true; }
}
const missing = new Set();
for (const f of files) {
  if (f.includes('i18n')) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\btn?\('([a-z0-9_.-]+)'/g)) {
    const k = m[1];
    if (!cat[k] && !cat[k + '.one'] && !cat[k + '.other']) missing.add(k + '  <- ' + f.split(/[\/]app[\/]/)[1]);
  }
}
console.log([...missing].sort().join('\n') || 'all keys present');
