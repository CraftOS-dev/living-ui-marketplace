/**
 * Rule pack test runner: loads every pack, checks it and runs its vectors.
 *
 *   node tools/packs/test.mjs                    every pack of this app
 *   node tools/packs/test.mjs us-federal gb      only these codes ("us-*" matches a prefix)
 *   node tools/packs/test.mjs --hooks <dir>      packs from <dir>/packs/*.js
 *   node tools/packs/test.mjs --engine <dir>     engine files (lib_engine.js, lib_expr.js, lib_packcheck.js) from <dir>
 *   --verbose   print warnings and the explanation of failing lines
 *   --json      print the report as JSON
 *
 * The hooks folder defaults to the app's pb/pb_hooks. The engine files come
 * from --engine, else from the hooks folder when it has them, else from the
 * pb_hooks folder next to this tool. A pack file exports one pack (one
 * version: a new version is a new file); files whose names start with "_"
 * are helpers a pack may require.
 * Vectors run on a JSON copy of each pack, as payroll reads it from the database.
 * Exit code 0 when every pack is valid and every vector passes, 1 otherwise.
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const args = process.argv.slice(2);
const opts = { hooks: '', engine: '', verbose: false, json: false, codes: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--hooks') opts.hooks = args[++i] || '';
  else if (a === '--engine') opts.engine = args[++i] || '';
  else if (a === '--verbose' || a === '-v') opts.verbose = true;
  else if (a === '--json') opts.json = true;
  else if (a === '--help' || a === '-h') {
    console.log('node tools/packs/test.mjs [--hooks <pb_hooks dir>] [--engine <dir>] [--verbose] [--json] [packCode ...]');
    process.exit(0);
  } else opts.codes.push(a);
}

function firstWith(dirs, file) {
  for (const d of dirs) if (d && existsSync(join(d, file))) return d;
  return '';
}

const hooksDir = resolve(opts.hooks || firstWith([join(root, 'pb', 'pb_hooks'), join(root, 'pb_hooks')], 'packs') || join(root, 'pb', 'pb_hooks'));
const engineDir = resolve(opts.engine || firstWith([hooksDir, join(root, 'pb', 'pb_hooks'), join(root, 'pb_hooks')], 'lib_engine.js') || hooksDir);
for (const f of ['lib_expr.js', 'lib_engine.js', 'lib_packcheck.js']) {
  if (!existsSync(join(engineDir, f))) {
    console.error('missing ' + join(engineDir, f) + ' (give --engine <dir>)');
    process.exit(2);
  }
}
const packsDir = join(hooksDir, 'packs');
if (!existsSync(packsDir)) {
  console.error('no packs folder at ' + packsDir + ' (give --hooks <pb_hooks dir>)');
  process.exit(2);
}

const req = createRequire(join(engineDir, 'x.js'));
const checker = req(join(engineDir, 'lib_packcheck.js'));
const engine = req(join(engineDir, 'lib_engine.js'));

// ---- load packs
const loaded = [];
const loadErrors = [];
for (const f of readdirSync(packsDir).sort()) {
  if (!f.endsWith('.js') || f.startsWith('_')) continue;
  try {
    const p = req(join(packsDir, f));
    if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.code !== 'string' || typeof p.version !== 'string') loadErrors.push({ file: f, message: 'does not export one pack with a code and a version' });
    else loaded.push({ file: f, pack: p });
  } catch (err) {
    loadErrors.push({ file: f, message: String(err && err.message ? err.message : err).split('\n')[0] });
  }
}
const allPacks = loaded.map((l) => l.pack);
// Payroll reads packs back from rule_packs.body (JSON), so vectors run on JSON copies.
function stored(p) {
  try {
    return JSON.parse(JSON.stringify(p));
  } catch (err) {
    return p;
  }
}
const storedPacks = allPacks.map(stored);

function wanted(code) {
  if (opts.codes.length === 0) return true;
  return opts.codes.some((c) => (c.endsWith('*') ? code.startsWith(c.slice(0, -1)) : code === c));
}

// ---- check and run
const report = { engine: engine.constants.VERSION, hooks: hooksDir, engineDir: engineDir, packs: [], set: [], loadErrors: loadErrors, ok: true };
for (const it of loaded) {
  const p = it.pack;
  if (!wanted(p.code)) continue;
  const t0 = process.hrtime.bigint();
  const problems = checker.validate(p, allPacks);
  const errors = problems.filter((x) => x.level === 'error');
  const warnings = problems.filter((x) => x.level === 'warning');
  const vec = checker.runVectors(storedPacks[allPacks.indexOf(p)], storedPacks);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const ok = errors.length === 0 && vec.failures.length === 0;
  if (!ok) report.ok = false;
  report.packs.push({ file: it.file, code: p.code, version: p.version, ship: p.ship, ok: ok, errors: errors, warnings: warnings, vectors: vec, ms: Math.round(ms) });
}
report.set = checker.checkSet(allPacks.filter((p) => wanted(p.code)));
if (report.set.some((x) => x.level === 'error') || loadErrors.length > 0) report.ok = false;
if (report.packs.length === 0 && loadErrors.length === 0) {
  report.ok = false;
  report.set.push({ level: 'error', code: 'no_packs', path: '', message: opts.codes.length ? 'no pack matches ' + opts.codes.join(', ') : 'no packs in ' + packsDir });
}

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

// ---- print
const out = [];
out.push('rule packs in ' + packsDir + ' (engine ' + report.engine + ' from ' + engineDir + ')');
for (const e of loadErrors) out.push('LOAD FAIL ' + e.file + ': ' + e.message);
let vPass = 0, vTotal = 0;
for (const r of report.packs) {
  vPass += r.vectors.passed;
  vTotal += r.vectors.total;
  out.push((r.ok ? 'PASS ' : 'FAIL ') + r.code + ' ' + r.version + ' [' + r.ship + '] ' + r.file + ': vectors ' + r.vectors.passed + '/' + r.vectors.total + (r.errors.length ? ', ' + r.errors.length + ' error' + (r.errors.length > 1 ? 's' : '') : '') + (r.warnings.length ? ', ' + r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') : '') + ' (' + r.ms + ' ms)');
  for (const e of r.errors) out.push('    error   ' + e.path + ': ' + e.message);
  if (opts.verbose) for (const w of r.warnings) out.push('    warning ' + w.path + ': ' + w.message);
  for (const f of r.vectors.failures) {
    out.push('    vector "' + f.name + '" failed:');
    for (const pr of f.problems) {
      if (pr.what === 'line' || pr.what === 'var' || pr.what === 'total') out.push('      ' + pr.what + ' ' + pr.code + ': expected ' + pr.expected + ', got ' + pr.actual);
      else out.push('      ' + pr.what + (pr.code ? ' ' + pr.code : '') + ': ' + pr.message);
    }
    if (opts.verbose) {
      out.push('      lines: ' + f.lines.map((l) => l.code + '=' + l.amount).join(', '));
      for (const iss of f.issues) if (iss.severity !== 'blocker') out.push('      ' + iss.severity + ' ' + iss.code + ': ' + iss.message);
    }
  }
}
for (const s of report.set) out.push((s.level === 'error' ? 'SET FAIL ' : 'set warning ') + s.path + ': ' + s.message);
out.push((report.ok ? 'OK' : 'FAILED') + ': ' + report.packs.filter((r) => r.ok).length + '/' + report.packs.length + ' packs pass, vectors ' + vPass + '/' + vTotal);
console.log(out.join('\n'));
process.exit(report.ok ? 0 : 1);
