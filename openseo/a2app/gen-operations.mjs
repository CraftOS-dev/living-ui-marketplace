#!/usr/bin/env node
/**
 * Writes operations.json from OpenSEO's live tool list and a2app/tools.map.json.
 *
 *   node a2app/gen-operations.mjs --url http://127.0.0.1:<port>   (a running install)
 *   node a2app/gen-operations.mjs --from tools.json                (a saved tools/list)
 *
 * Parameters come from each tool's own input schema, so they cannot drift from
 * what OpenSEO accepts. The map adds only what OpenSEO does not say: the module,
 * a short summary, and whether the person approves the call. Run it after every
 * OpenSEO update, then `node sidecar/check.mjs`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function liveTools(base) {
  const res = await fetch(`${base.replace(/\/$/, "")}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await res.text();
  const json = text.trimStart().startsWith("{") ? JSON.parse(text) : JSON.parse(text.split(/\r?\n/).find((l) => l.startsWith("data:")).slice(5));
  return json.result.tools;
}

const short = (text, max) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const first = t.split(/(?<=\.)\s/)[0];
  return first.length <= max ? first : t.slice(0, max - 1).trimEnd() + "…";
};

/** `anyOf` of constants is an enum; `anyOf` of one type and null is that type. */
function normalize(s) {
  const alts = s?.anyOf ?? s?.oneOf;
  if (!alts) return s ?? {};
  const members = alts.filter((m) => m && m.type !== "null");
  if (members.length > 0 && members.every((m) => "const" in m)) {
    return { description: s.description, type: typeof members[0].const === "number" ? "number" : "string", enum: members.map((m) => m.const) };
  }
  if (members.length === 1) return { ...members[0], description: s.description ?? members[0].description };
  return s;
}

const typeName = (s) => (Array.isArray(s?.type) ? s.type.find((t) => t !== "null") : s?.type);

/** A compact picture of a JSON parameter's shape, from its schema, so an agent
 *  can build the value right the first time: [{op: "set"|"delete", section: text}]. */
function shapeOf(raw, depth = 0) {
  const s = normalize(raw);
  if ("const" in s) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) return s.enum.slice(0, 8).map((v) => JSON.stringify(v)).join("|") + (s.enum.length > 8 ? "|…" : "");
  const alts = s.anyOf ?? s.oneOf;
  if (alts) return alts.filter((m) => m && m.type !== "null").slice(0, 4).map((m) => shapeOf(m, depth)).join(" | ");
  const t = typeName(s);
  if (t === "array") return `[${shapeOf(s.items ?? {}, depth)}]`;
  if (t === "object" || s.properties) {
    if (depth >= 2) return "{…}";
    const req = new Set(s.required ?? []);
    const keys = Object.entries(s.properties ?? {});
    const parts = keys.slice(0, 10).map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${shapeOf(v, depth + 1)}`);
    return `{${parts.join(", ")}${keys.length > 10 ? ", …" : ""}}`;
  }
  if (t === "integer" || t === "number") return "number";
  if (t === "boolean") return "true|false";
  return "text";
}

/** OpenSEO's own limits, so they show in --help rather than only in a refusal. */
function limitsOf(s) {
  const out = [];
  if (s.minimum !== undefined && s.maximum !== undefined) out.push(`${s.minimum}-${s.maximum}`);
  else if (s.minimum !== undefined) out.push(`min ${s.minimum}`);
  else if (s.maximum !== undefined) out.push(`max ${s.maximum}`);
  if (s.minItems !== undefined || s.maxItems !== undefined) out.push(`${s.minItems ?? 0}-${s.maxItems ?? "any"} items`);
  if (s.maxLength !== undefined) out.push(`max ${s.maxLength} characters`);
  return out.length ? ` (${out.join("; ")})` : "";
}

/** One A2App parameter from one JSON Schema property. Descriptions are
 *  OpenSEO's own, whole: `--help` is not part of any describe budget. */
function paramOf(schema, required) {
  const s = normalize(schema);
  const type = typeName(s);
  const p = {};
  let hint = "";
  if (Array.isArray(s.enum) && s.enum.length) {
    p.type = "enum";
    p.values = s.enum.map(String);
  } else if (type === "string") p.type = s.format === "date-time" ? "datetime" : "string";
  else if (type === "integer" || type === "number") p.type = "number";
  else if (type === "boolean") p.type = "boolean";
  else if (type === "array" && Array.isArray(s.items?.enum)) {
    p.type = "list<enum>";
    p.values = s.items.enum.map(String);
    hint = " Give several as a JSON array or comma-separated text.";
  } else {
    p.type = "json";
    if (type === "array") {
      const item = normalize(s.items ?? {});
      const one = typeName(item) === "object" ? (item.required ?? []).filter((k) => typeName(item.properties?.[k]) === "string") : [];
      const scalar = ["string", "number", "integer"].includes(typeName(item)) && !item.anyOf && !item.oneOf;
      hint = one.length === 1
        ? ` A JSON array, or comma-separated text where each item becomes {${one[0]}: …}.`
        : scalar ? " A JSON array or comma-separated text." : " A JSON array.";
    }
    hint += ` Shape: ${shapeOf(s)}`;
  }
  if (required) p.required = true;
  const desc = `${String(s.description ?? "").replace(/\s+/g, " ").trim()}${limitsOf(s)}${hint}`.trim();
  if (desc) p.description = desc;
  return p;
}

const manifest = JSON.parse(readFileSync(join(APP, "manifest.json"), "utf8"));
const map = JSON.parse(readFileSync(join(APP, "a2app", "tools.map.json"), "utf8")).operations;
const tools = arg("from") ? JSON.parse(readFileSync(arg("from"), "utf8")) : await liveTools(arg("url") ?? "http://127.0.0.1:3001");
const byName = new Map(tools.map((t) => [t.name, t]));

const moduleOrder = manifest.modules.map((m) => m.name);
const out = [];
const problems = [];
for (const [name, m] of Object.entries(map)) {
  if (!moduleOrder.includes(m.module)) problems.push(`${name}: unknown module ${m.module}`);
  const op = { name, module: m.module, description: m.summary, destructive: m.destructive === true };
  if (m.tool) {
    const tool = byName.get(m.tool);
    if (!tool) {
      problems.push(`${name}: OpenSEO serves no tool ${m.tool}`);
      continue;
    }
    if (!op.description) op.description = short(tool.description, 80);
    const a = tool.annotations ?? {};
    if (a.readOnlyHint === true) op.readOnly = true;
    if (a.idempotentHint === true) op.idempotent = true;
    const req = new Set(tool.inputSchema?.required ?? []);
    op.params = {};
    for (const [k, s] of Object.entries(tool.inputSchema?.properties ?? {})) op.params[k] = paramOf(s, req.has(k));
    if (op.params.view) problems.push(`${name}: OpenSEO now has its own "view" parameter; rename the sidecar's`);
    // Every --help repeats these two; app guide explains them once.
    if (op.params.projectId) op.params.projectId.description = "The project's id (projects list_projects).";
    // The sidecar's answer shape (sidecar/serve.mjs shapeResult), on every tool.
    op.params.view = { type: "enum", values: ["text", "full", "data"], description: "Answer shape; text by default (see app guide)." };
    // The module screen lists only names and summaries: name the required
    // parameters there so most calls need no --help first.
    const needs = Object.entries(op.params).filter(([k, p]) => p.required && k !== "projectId").map(([k]) => `--${k}`);
    if (needs.length) op.description = `${op.description}. Needs ${needs.join(" ")}`;
  } else {
    if (m.readOnly) op.readOnly = true;
    op.params = m.params ?? {};
  }
  if ((m.summary ?? "").length > 80) problems.push(`${name}: summary is ${m.summary.length} characters (80 max)`);
  out.push(op);
}
out.sort((a, b) => moduleOrder.indexOf(a.module) - moduleOrder.indexOf(b.module));

const mapped = new Set(Object.values(map).map((m) => m.tool).filter(Boolean));
const unmapped = tools.map((t) => t.name).filter((n) => !mapped.has(n));
if (unmapped.length) problems.push(`OpenSEO tools with no operation yet: ${unmapped.join(", ")}`);

writeFileSync(join(APP, "operations.json"), JSON.stringify({ operations: out }, null, 2) + "\n");

// AGENT_APP.md's operation list carries each tool's FULL description, in the
// OpenSEO team's own words; `a2app <app> <module> <op> --help` shows it.
const BEGIN = "<!-- operations: generated by a2app/gen-operations.mjs from OpenSEO's own tool descriptions -->";
const END = "<!-- end of generated operations -->";
const doc = join(APP, "AGENT_APP.md");
try {
  const src = readFileSync(doc, "utf8");
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a >= 0 && b > a) {
    const lines = [];
    for (const mod of manifest.modules) {
      lines.push("", `### ${mod.name} — ${mod.summary}`, "");
      for (const op of out.filter((o) => o.module === mod.name)) {
        const m = map[op.name];
        const full = m.tool ? byName.get(m.tool)?.description : m.summary;
        const text = String(full ?? op.description).replace(/\s+/g, " ").trim();
        const params = Object.entries(op.params).map(([k, p]) => `${k}${p.required ? "" : "?"}`).join(", ");
        const approval = op.destructive ? " **Needs the person's approval.**" : "";
        lines.push(`- \`${op.name}\` — ${text}${approval} Params: ${params || "none"}`);
      }
    }
    writeFileSync(doc, src.slice(0, a + BEGIN.length) + "\n" + lines.join("\n") + "\n\n" + src.slice(b));
    console.log("updated the operation list in AGENT_APP.md");
  }
} catch {
  /* no AGENT_APP.md yet */
}

// Module screens list name + destructive + summary per operation; estimate
// each against the 2,000-character describe budget.
for (const mod of moduleOrder) {
  const ops = out.filter((o) => o.module === mod);
  const size = JSON.stringify({ level: "module", path: mod, operations: ops.map((o) => ({ name: o.name, destructive: o.destructive, summary: o.description })) }).length;
  console.log(`${mod.padEnd(15)} ${String(ops.length).padStart(2)} ops  ~${size} chars`);
}
console.log(`wrote operations.json: ${out.length} operations from ${tools.length} OpenSEO tools`);
if (problems.length) {
  console.error(problems.map((p) => `  - ${p}`).join("\n"));
  process.exitCode = 1;
}
