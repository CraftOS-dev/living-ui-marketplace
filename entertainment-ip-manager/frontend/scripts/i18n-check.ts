/**
 * Language and copy check. Run from frontend/:  node scripts/i18n-check.ts
 *
 * Fails when:
 *  - a literal passed to t() or tn() has no Japanese entry
 *  - a select label (lib/enums.ts) has no Japanese entry
 *  - two dictionary files give the same key different translations
 *  - an em dash appears in the app's source, hooks, migrations or manifests
 * Warns about Japanese entries nothing uses (dynamic keys are fine).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JA, JA_PARTS } from '../src/app/locales/ja/index.ts';
import { ENUM_LABEL } from '../src/app/lib/enums.ts';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FRONT = join(here, '..');
const APP = join(FRONT, '..');
const SRC = join(FRONT, 'src', 'app');

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === 'pb_data' || name === 'pb_public') continue;
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const problems: string[] = [];
const used = new Set<string>();

// 1. t('...') and tn(n, '...', '...') literals.
const LIT = String.raw`(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|\x60((?:\\.|[^\x60\\$])*)\x60)`;
const T_RE = new RegExp(String.raw`(?<![\w.])t\(\s*` + LIT, 'g');
const TN_RE = new RegExp(String.raw`(?<![\w.])tn\(\s*[^,]+,\s*` + LIT + String.raw`\s*,\s*` + LIT, 'g');
const unescape = (s: string): string => s.replace(/\\(['"\\`])/g, '$1').replace(/\\n/g, '\n');

for (const file of walk(SRC, ['.ts', '.tsx'])) {
  if (file.includes(join('app', 'locales'))) continue;
  // Comments hold examples, not UI text.
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rel = relative(FRONT, file);
  for (const m of src.matchAll(T_RE)) {
    const key = unescape(m[1] ?? m[2] ?? m[3] ?? '');
    used.add(key);
    if (JA[key] === undefined) problems.push(`${rel}: t(${JSON.stringify(key)}) has no Japanese entry`);
  }
  for (const m of src.matchAll(TN_RE)) {
    const other = unescape(m[4] ?? m[5] ?? m[6] ?? '');
    const one = unescape(m[1] ?? m[2] ?? m[3] ?? '');
    used.add(other);
    used.add(one);
    if (JA[other] === undefined) problems.push(`${rel}: tn(..., ${JSON.stringify(other)}) has no Japanese entry`);
  }
}

// 2. Select labels.
for (const [field, values] of Object.entries(ENUM_LABEL)) {
  for (const label of Object.values(values)) {
    used.add(label);
    if (JA[label] === undefined) problems.push(`enums ${field}: label ${JSON.stringify(label)} has no Japanese entry`);
  }
}

// 3. Conflicting duplicates across dictionary files.
const seen = new Map<string, [string, string]>();
for (const [part, dict] of Object.entries(JA_PARTS)) {
  for (const [k, v] of Object.entries(dict)) {
    const prev = seen.get(k);
    if (prev !== undefined && prev[1] !== v) problems.push(`dictionary conflict for ${JSON.stringify(k)}: ${prev[0]} says ${JSON.stringify(prev[1])}, ${part} says ${JSON.stringify(v)}`);
    else seen.set(k, [part, v]);
  }
}

// 4. No em dashes anywhere the user (or an agent) reads.
const EM = '\u2014';
const copyFiles = [
  ...walk(SRC, ['.ts', '.tsx', '.css']),
  ...walk(join(APP, 'pb', 'pb_hooks'), ['.js']).filter((f) => !/[\\/]_[^\\/]*$/.test(f)),
  ...walk(join(APP, 'pb', 'pb_migrations'), ['.js']),
  join(APP, 'operations.json'),
  join(APP, 'triggers.json'),
];
for (const file of copyFiles) {
  let src = '';
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  src.split('\n').forEach((line, i) => {
    if (line.includes(EM)) problems.push(`${relative(APP, file)}:${i + 1}: em dash`);
  });
}

const unused = Object.keys(JA).filter((k) => !used.has(k));
if (unused.length) console.log(`note: ${unused.length} Japanese entries are not referenced literally (fine for dynamic keys)`);

if (problems.length) {
  for (const p of problems) console.log(`x ${p}`);
  console.log(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`ok: ${used.size} keys checked, ${Object.keys(JA).length} Japanese entries`);
