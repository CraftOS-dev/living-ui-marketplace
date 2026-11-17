#!/usr/bin/env node
/**
 * Gate step: operations resolve (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * Every declared operation must have exactly one runner — an upstream MCP tool
 * named in a2app/tools.map.json, or a sidecar operation exported by
 * a2app/app.mjs — and every mapped entry must be declared. When the pinned
 * upstream is unpacked and upstream.json names `toolSources`, every mapped
 * tool name must also appear in that source, so an upstream rename fails here
 * rather than in front of an agent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, loadAppHooks } from "./context.mjs";
import { isCurrent, readPin, upstreamDir } from "./upstream.mjs";

const problems = [];
const manifest = JSON.parse(readFileSync(join(APP_DIR, "manifest.json"), "utf8"));
const ops = JSON.parse(readFileSync(join(APP_DIR, "operations.json"), "utf8")).operations ?? [];
const map = JSON.parse(readFileSync(join(APP_DIR, "a2app", "tools.map.json"), "utf8")).operations ?? {};
const modules = new Set((manifest.modules ?? []).map((m) => m.name));
const hooks = await loadAppHooks();

const declared = new Set();
for (const op of ops) {
  if (declared.has(op.name)) problems.push(`operation declared twice: ${op.name}`);
  declared.add(op.name);
  if (!modules.has(op.module)) problems.push(`${op.name}: module "${op.module}" is not in manifest.modules`);
  if (typeof op.destructive !== "boolean") problems.push(`${op.name}: "destructive" must be true or false`);
  if (!op.params || typeof op.params !== "object") problems.push(`${op.name}: "params" is required (use {} for none)`);
  const m = map[op.name];
  if (!m) problems.push(`${op.name}: declared with no runner in a2app/tools.map.json`);
  else if (!!m.tool === !!m.sidecar) problems.push(`${op.name}: map exactly one of "tool" or "sidecar"`);
  else if (m.sidecar && typeof hooks.ops?.[m.sidecar] !== "function") problems.push(`${op.name}: a2app/app.mjs exports no ops.${m.sidecar}`);
}
for (const name of Object.keys(map)) if (!declared.has(name)) problems.push(`${name}: mapped in a2app/tools.map.json but not declared in operations.json`);

const pin = readPin(APP_DIR);
let checkedSource = false;
if (Array.isArray(pin.toolSources) && isCurrent(APP_DIR, pin)) {
  const root = upstreamDir(APP_DIR, pin);
  let source = "";
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\./.test(name)) source += readFileSync(p, "utf8");
    }
  };
  for (const rel of pin.toolSources) if (existsSync(join(root, rel))) walk(join(root, rel));
  for (const [op, m] of Object.entries(map)) {
    if (m.tool && !source.includes(`"${m.tool}"`)) problems.push(`${op}: tool "${m.tool}" is not in ${pin.name} ${pin.tag ?? ""} (${pin.toolSources.join(", ")})`);
  }
  checkedSource = true;
}

if (problems.length) {
  process.stderr.write(problems.map((p) => `  - ${p}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`operations resolve ok (${ops.length} operations${checkedSource ? `, tools found in ${pin.name} ${pin.tag ?? ""}` : ""})\n`);
