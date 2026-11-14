/**
 * Write triggers.json from the jobs your AI agent reads in app.guide
 * (pb/pb_hooks/lib_guide.js JOBS), so a trigger's instruction and the guide
 * never disagree.
 *
 * One trigger per kind of work, each with its own instruction, params (the
 * record it is about) and cooldown. The seller's click, or an automatic
 * request they switched on in Settings, fires it once (lib_tasks.js); no job
 * fires one on a timer. Checks: every instruction under 1,000 characters, no
 * em or en dashes, every job a known task kind.
 *
 *   node tools/gen_triggers.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { JOBS } = require(join(root, 'pb', 'pb_hooks', 'lib_guide.js'));

const KINDS = ['sync', 'publish', 'push_stock', 'setup_help', 'prepare_listing', 'draft_reply', 'send_reply', 'tracking', 'exception', 'chat'];
const problems = [];
const triggers = {};
const seen = new Set();
for (const [name, job] of Object.entries(JOBS)) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) problems.push(`${name}: bad trigger name`);
  if (!KINDS.includes(job.kind)) problems.push(`${name}: unknown kind ${job.kind}`);
  if (seen.has(job.kind)) problems.push(`${name}: kind ${job.kind} has two triggers`);
  seen.add(job.kind);
  if (job.instruction.length >= 1000) problems.push(`${name}: instruction is ${job.instruction.length} characters (under 1,000)`);
  if (/[\u2013\u2014]/.test(JSON.stringify(job))) problems.push(`${name}: em or en dash`);
  if (!(job.cooldown_seconds >= 10)) problems.push(`${name}: cooldown below the 10 s floor`);
  if (Object.keys(job.params).includes('request')) problems.push(`${name}: "request" is the queue's own param`);
  triggers[name] = { description: job.description, instruction: job.instruction, params: job.params, cooldown_seconds: job.cooldown_seconds };
}
for (const k of KINDS) if (!seen.has(k)) problems.push(`kind ${k} has no trigger`);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
writeFileSync(join(root, 'triggers.json'), JSON.stringify({ triggers }, null, 2) + '\n');
for (const [name, t] of Object.entries(triggers)) console.log(`${name.padEnd(28)} ${String(t.instruction.length).padStart(4)} chars  cooldown ${t.cooldown_seconds}s  params ${Object.keys(t.params).join(', ')}`);
console.log(Object.keys(triggers).length + ' triggers');
