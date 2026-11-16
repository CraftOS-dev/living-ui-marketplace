/**
 * Write triggers.json from the triggers of pb/pb_hooks/lib_agent.js (name,
 * description, the param naming the record, cooldown) and the instruction
 * each module gives its triggers in pb/pb_hooks/guide_*.js, so the guide and
 * the triggers never disagree.
 *
 * One trigger per piece of work that needs your AI agent's judgment, fired
 * from the action that needs it with the record's id; each instruction says
 * what to read, which ops to call and what done looks like, in under 1,000
 * characters (the full steps stay in app.guide --recipe <trigger>).
 *
 *   node tools/gen_triggers.mjs
 */
import { createRequire } from 'node:module';
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = join(root, 'pb', 'pb_hooks');
const require = createRequire(import.meta.url);

const { TRIGGERS } = require(join(hooks, 'lib_agent.js'));
const MAX = 1000;
const LEAD = 'HR OS asks you for one piece of work; its params name the record (an id). Run ops with `agent-app run <project> <op> --param value`. ';

const instructions = {};
const recipes = {};
const problems = [];
for (const f of readdirSync(hooks)
  .filter((n) => /^guide_[a-z0-9_]+\.js$/.test(n))
  .sort()) {
  const s = require(join(hooks, f));
  for (const [k, text] of Object.entries(s.triggers ?? {})) {
    if (TRIGGERS[k] === undefined) problems.push(`${f}: instruction for undeclared trigger ${k}`);
    if (instructions[k] !== undefined) problems.push(`${f}: trigger ${k} is also in another guide file`);
    if (typeof text !== 'string' || text.trim() === '') problems.push(`${f}: trigger ${k} needs an instruction`);
    instructions[k] = text;
  }
  for (const [k, steps] of Object.entries(s.recipes ?? {})) {
    if (TRIGGERS[k] === undefined) problems.push(`${f}: recipe for undeclared trigger ${k}`);
    if (!Array.isArray(steps) || steps.length === 0 || typeof steps[0] !== 'string') problems.push(`${f}: recipe ${k} must be a list of strings (summary first)`);
    recipes[k] = steps;
  }
}

const out = { triggers: {} };
for (const [name, t] of Object.entries(TRIGGERS)) {
  if (instructions[name] === undefined) problems.push(`trigger ${name}: no instruction in any guide_*.js`);
  if (recipes[name] === undefined) problems.push(`trigger ${name}: no recipe in any guide_*.js`);
  const instruction = LEAD + (instructions[name] ?? '');
  if (instruction.length >= MAX) problems.push(`trigger ${name}: instruction is ${instruction.length} characters (under ${MAX})`);
  out.triggers[name] = {
    description: t.description,
    instruction: instruction,
    params: { [t.param]: { type: 'string', required: true, description: 'The id of the ' + t.record } },
    cooldown_seconds: t.cooldown,
  };
}
if (/[\u2013\u2014]/.test(JSON.stringify(out))) problems.push('no en or em dashes in triggers.json');
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
writeFileSync(join(root, 'triggers.json'), JSON.stringify(out, null, 2) + '\n');
const lens = Object.entries(out.triggers).map(([k, v]) => k + ' ' + v.instruction.length);
console.log(Object.keys(out.triggers).length + ' triggers; instruction lengths: ' + lens.join(', '));
