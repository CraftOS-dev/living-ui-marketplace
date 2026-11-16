/**
 * Run every engine test file: node tests/run.mjs (exit code = failures).
 * HR_HOOKS=<pb_hooks dir> picks the engine files to test.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { report, hooks } from './_harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2] || '';
console.log('engine files: ' + hooks);
for (const f of readdirSync(here).sort()) {
  if (!f.endsWith('.test.mjs')) continue;
  if (only && f.indexOf(only) < 0) continue;
  await import(pathToFileURL(join(here, f)).href);
}
process.exit(report() > 0 ? 1 : 0);
