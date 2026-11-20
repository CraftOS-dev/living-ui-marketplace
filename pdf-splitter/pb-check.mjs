#!/usr/bin/env node
/**
 * PocketBase blueprint gate checks (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 *   node pb-check.mjs
 *
 * Two things `validate` cannot see on its own for this stack:
 *
 *   1. Operations resolve. Every operation declared in operations.json must be
 *      served by an app route registered at exactly `POST /api/ops/<name>`. The
 *      adapter's catch-all answers 501 for a declared name with no route, which
 *      a describe walk would only discover by calling it.
 *   2. Events are declared well. events.json (optional) lists the event types
 *      the app may emit and the capability each asks an agent for; a malformed
 *      file would make every trigger fail closed at runtime.
 *
 * Prints every problem found and exits 1 if there are any.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const problems = [];

function readJson(rel) {
  const file = join(here, rel);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    problems.push(`${rel} is not valid JSON: ${err.message}`);
    return null;
  }
}

function hookSources(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...hookSources(full));
    else if (name.endsWith(".js") && !name.startsWith("_a2app")) out.push(readFileSync(full, "utf8"));
  }
  return out;
}

const ops = readJson("operations.json");
if (ops && Array.isArray(ops.operations)) {
  const sources = hookSources(join(here, "pb", "pb_hooks")).join("\n");
  const routes = new Set();
  const re = /routerAdd\(\s*["'`]POST["'`]\s*,\s*["'`]\/api\/ops\/([^"'`/]+)["'`]/g;
  for (let m = re.exec(sources); m !== null; m = re.exec(sources)) routes.add(m[1]);
  for (const op of ops.operations) {
    if (op && typeof op.name === "string" && !routes.has(op.name)) {
      problems.push(`operation "${op.name}" is declared but no hook registers routerAdd("POST", "/api/ops/${op.name}", …)`);
    }
  }
}

const events = readJson("events.json");
if (events !== undefined && events !== null) {
  if (!Array.isArray(events.events)) problems.push('events.json must be { "events": [ { "type", "capability"?, "payload"? } ] }');
  else {
    const seen = new Set();
    const NAME = /^[a-z][a-z0-9._-]{0,119}$/;
    const TYPES = new Set(["string", "number", "boolean", "datetime", "enum", "ref", "list<enum>", "list<ref>", "json", "binary"]);
    for (const ev of events.events) {
      if (!ev || typeof ev.type !== "string" || !NAME.test(ev.type)) {
        problems.push(`events.json: event type ${JSON.stringify(ev && ev.type)} must match ${NAME}`);
        continue;
      }
      if (seen.has(ev.type)) problems.push(`events.json: duplicate event type "${ev.type}"`);
      seen.add(ev.type);
      if (ev.capability !== undefined && (typeof ev.capability !== "string" || !NAME.test(ev.capability))) {
        problems.push(`events.json: "${ev.type}" capability must match ${NAME}`);
      }
      const payload = ev.payload ?? {};
      if (typeof payload !== "object" || Array.isArray(payload)) {
        problems.push(`events.json: "${ev.type}" payload must be an object of typed fields`);
        continue;
      }
      for (const [field, spec] of Object.entries(payload)) {
        if (!spec || !TYPES.has(spec.type)) problems.push(`events.json: "${ev.type}".payload.${field} needs a protocol type (${[...TYPES].join(", ")})`);
      }
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log("✓ every declared operation has a route; events.json is well formed");
