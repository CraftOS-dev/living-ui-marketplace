#!/usr/bin/env node
/**
 * The Agent App server (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * A sidecar in front of an app that already ships its own MCP server
 * (requirement_A2App §12.3, form 3). One process on the app's port:
 *
 *   /.well-known/a2app.json, /api/_a2app*, /api/ops/*, /api/collections/*
 *       → the A2App adapter (@a2app/adapter-core). Each declared operation is
 *         either one of the upstream app's own MCP tools (tools/call on
 *         loopback, same code path as every other agent of that app) or a
 *         sidecar operation from the app's hooks (a2app/app.mjs `ops`).
 *   everything else (the app's UI, its API, WebSockets, its own /mcp)
 *       → passed through to the upstream app, untouched.
 *
 * The upstream app runs on a private loopback port, started by the app's
 * `start` hook. Nothing here edits upstream code. The surface is operate-only:
 * no entities, so no record routes; the upstream app keeps its own data.
 */
import { createA2App, a2appMiddleware, OperationError } from "@a2app/adapter-core";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { APP_DIR, baseContext, freePort, guardPath, loadAppHooks, log } from "./context.mjs";
import { createMcpClient, McpError } from "./mcp.mjs";

export const ADAPTER_VERSION = "0.1.0";

const manifest = JSON.parse(readFileSync(join(APP_DIR, "manifest.json"), "utf8"));
const operations = JSON.parse(readFileSync(join(APP_DIR, "operations.json"), "utf8")).operations ?? [];
const toolsMap = JSON.parse(readFileSync(join(APP_DIR, "a2app", "tools.map.json"), "utf8")).operations ?? {};
const moduleOf = new Map(operations.map((o) => [o.name, o.module]));
const PORT = Number(process.env.PORT ?? manifest.port ?? 8090);
const HOST = process.env.A2APP_HOST ?? "127.0.0.1";
const TOKEN_FILE = join(APP_DIR, ".agent-token");

function logLine(level, evt, fields = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, evt, ...fields }) + "\n");
}

/* --------------------------------------------------------- arguments */

/** `anyOf` of constants is an enum of that type; `anyOf` of one type and
 *  null is that type. Anything else stays as the schema says. */
function normalize(s) {
  const alts = s.anyOf ?? s.oneOf;
  if (!alts) return s;
  const members = alts.filter((m) => m && m.type !== "null");
  if (members.length > 0 && members.every((m) => "const" in m)) {
    return { type: typeof members[0].const === "number" ? "number" : "string", enum: members.map((m) => m.const) };
  }
  if (members.length === 1) return members[0];
  return s;
}

/** Shape a value the way the upstream tool's JSON Schema expects. Agents and
 *  harness plugins often send lists and objects as text ("a, b" or JSON), and
 *  numbers or booleans as strings; the upstream tool would refuse those, so
 *  they are converted here by the tool's own schema. Nothing is invented: a
 *  value that does not convert is passed on as is, and the tool's own
 *  validation answers. */
function coerce(value, rawSchema) {
  if (value === undefined || value === null || !rawSchema || typeof rawSchema !== "object") return value;
  const schema = normalize(rawSchema);
  if (schema.anyOf || schema.oneOf) {
    if (typeof value === "string" && /^\s*[[{]/.test(value)) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "number" || type === "integer") {
    return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
  }
  if (type === "boolean") return value === "true" ? true : value === "false" ? false : value;
  if (type === "array") {
    let list = value;
    if (typeof list === "string") {
      const text = list.trim();
      if (text.startsWith("[")) {
        try {
          list = JSON.parse(text);
        } catch {
          /* keep text */
        }
      }
      if (typeof list === "string") list = text === "" ? [] : text.split(/\s*(?:\r?\n|,)\s*/).filter((s) => s !== "");
    }
    if (!Array.isArray(list)) list = [list];
    return list.map((item) => coerceItem(item, schema.items));
  }
  if (type === "object") {
    let obj = value;
    if (typeof obj === "string") {
      try {
        obj = JSON.parse(obj);
      } catch {
        return value;
      }
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj) && schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) if (k in obj) obj[k] = coerce(obj[k], sub);
    }
    return obj;
  }
  return value;
}

/** A plain string given where the schema wants an object with one required
 *  string field (e.g. a seed keyword) becomes that object. */
function coerceItem(item, schema) {
  if (typeof item === "string" && schema && schema.type === "object" && schema.properties) {
    const req = (schema.required ?? []).filter((k) => schema.properties[k]?.type === "string");
    if (req.length === 1) return coerce({ [req[0]]: item }, schema);
  }
  return coerce(item, schema);
}

function coerceArgs(args, inputSchema) {
  const out = {};
  const props = inputSchema?.properties ?? {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined) continue;
    out[k] = coerce(v, props[k]);
  }
  return out;
}

/* ------------------------------------------------------------- results */

let publicOrigin = `http://127.0.0.1:${PORT}`;
let internalOrigins = [];

/** Links the upstream built from a loopback origin point at the public port. */
function rewriteOrigins(value) {
  if (internalOrigins.length === 0) return value;
  let text = JSON.stringify(value);
  for (const o of internalOrigins) text = text.split(o).join(publicOrigin);
  return JSON.parse(text);
}

function textOf(result) {
  return (result?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n\n");
}

/** The `view` parameter every tool operation takes (declared by the app). */
const VIEWS = new Set(["text", "full", "data"]);

/** Cut text at a line boundary at or below `limit` characters. */
function cutText(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf("\n", limit);
  return text.slice(0, cut > limit * 0.5 ? cut : limit);
}

/**
 * The agent-facing answer for one tool result.
 *
 * Errors come first, and their whole recovery is in `message`: the CLI prints
 * only the message, and every 4xx other than 404/409 makes it also dump the
 * operation's parameter help, which costs tokens and, in some harnesses,
 * replaces the message. So:
 *   - the app's `explain` hook names setup problems (a missing key): 409;
 *   - the upstream's own input validation is `invalid_param`, 409, in its words;
 *   - an id the upstream does not know is `not_found`, 404;
 *   - any other refusal is `upstream_refused`, 409, in the upstream's words.
 *
 * Results are bounded (the protocol caps describe, never results; the app
 * must). `view`:
 *   text (default)  the upstream's own text for agents, cut at `textLimit`
 *                   characters with the cut reported, plus the ids and link
 *                   from its structured answer;
 *   full            the whole text (for `--out file.txt`);
 *   data            the structured answer as is (for `--field` / `--out file.json`).
 */
function shapeResult(result, { op, explain, view = "text", textLimit = 12_000 }) {
  const text = textOf(result);
  const structured = result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent) ? result.structuredContent : null;
  const explained = explain?.({ op, text, structured, isError: result?.isError === true });
  if (explained) throw new OperationError(explained.code, explained.message, explained.status ?? 409);
  if (result?.isError) {
    if (/input validation error|invalid arguments/i.test(text)) {
      throw new OperationError("invalid_param", `${text.replace(/^Input validation error:\s*/i, "")} (--help lists every parameter)`, 409);
    }
    if (/\bNOT_FOUND\b|\bnot found\b/i.test(text)) {
      throw new OperationError("not_found", `${text || "Not found."} Check the ids: list them first with the module's list or get operation.`, 404);
    }
    throw new OperationError("upstream_refused", text || "The tool failed.", 409);
  }
  if (view === "data" || (!text && structured)) return rewriteOrigins(structured ?? { text });
  const out = { text: view === "full" ? text : cutText(text, textLimit) };
  if (out.text.length < text.length) {
    out.truncated = {
      shownChars: out.text.length,
      totalChars: text.length,
      more: "Narrow the call (its limit, page or filter parameters), or save it all: --view full --out <file>.txt, or --view data --out <file>.json.",
    };
  }
  if (structured) {
    // Ids the text may only carry inside a link, and the page to show the person.
    // (Not projectId: the caller passed it.)
    const ids = Object.fromEntries(Object.entries(structured).filter(([k, v]) => /(^id$|Id$)/.test(k) && k !== "projectId" && (typeof v === "string" || typeof v === "number")));
    if (Object.keys(ids).length) out.ids = ids;
    const url = structured.meta?.url ?? structured.url;
    if (typeof url === "string") out.url = url;
  }
  return rewriteOrigins(out);
}

/* -------------------------------------------------------------- start */

async function main() {
  guardPath();
  const hooks = await loadAppHooks();
  if (!hooks.start) throw new Error("a2app/app.mjs exports no start(ctx) hook — nothing to run");

  let token;
  if (existsSync(TOKEN_FILE)) token = readFileSync(TOKEN_FILE, "utf8").trim();
  else {
    token = "a2app_" + randomBytes(24).toString("hex");
    writeFileSync(TOKEN_FILE, token + "\n", { mode: 0o600 });
  }

  const base = baseContext();
  const internalPort = await freePort();
  publicOrigin = `http://127.0.0.1:${PORT}`;
  internalOrigins = [`http://127.0.0.1:${internalPort}`, `http://localhost:${internalPort}`];
  const mcp = createMcpClient({ port: internalPort, path: base.pin.mcpPath ?? "/mcp", publicHost: `127.0.0.1:${PORT}` });

  let a2app = null;
  const ctx = {
    ...base,
    publicPort: PORT,
    publicOrigin,
    internalPort,
    internalOrigin: `http://127.0.0.1:${internalPort}`,
    mcp,
    OperationError,
    trigger: (input) => {
      if (!a2app) throw new Error("the agent surface is not up yet");
      return a2app.trigger(input);
    },
  };

  logLine("info", "upstream_starting", { app: base.pin.name, tag: base.pin.tag ?? null, internalPort });
  const upstream = await hooks.start(ctx);
  ctx.upstream = upstream;

  // Every mapped tool must exist upstream; drift is reported, never hidden.
  const tools = await mcp.tools();
  const missing = Object.entries(toolsMap)
    .filter(([, m]) => m.tool && !tools.has(m.tool))
    .map(([op]) => op);
  const mapped = new Set(Object.values(toolsMap).map((m) => m.tool).filter(Boolean));
  const unmapped = [...tools.keys()].filter((t) => !mapped.has(t));
  ctx.drift = { missing, unmapped };
  if (missing.length) logLine("warn", "tools_missing_upstream", { operations: missing });
  if (unmapped.length) logLine("info", "upstream_tools_not_mapped", { tools: unmapped });

  const binding = {
    appId: manifest.id,
    appName: manifest.name ?? null,
    adapterVersion: ADAPTER_VERSION,
    authMode: manifest.authMode === "multi-user" ? "multi-user" : "none",
    entities: () => ({}),
    listRecords: () => ({ items: [] }),
    getRecord: () => null,
    createRecord: () => {
      throw new OperationError("not_supported", "This app has no records an agent writes directly; use its operations.", 405);
    },
    updateRecord: () => null,
    deleteRecord: () => false,
    // The CLI shows an agent only an error's message, while agents are told to
    // branch on its code: so every message this app sends starts with the code.
    async runOperation(name, args, callCtx) {
      try {
        return await runMapped(name, args, callCtx);
      } catch (e) {
        if (e instanceof OperationError && !e.message.startsWith(`${e.code}:`)) {
          throw new OperationError(e.code, `${e.code}: ${e.message}`, e.httpStatus, e.extra);
        }
        throw e;
      }
    },
  };

  async function runMapped(name, args, callCtx) {
    const map = toolsMap[name];
    if (!map) throw new OperationError("unknown_operation", `No runner is mapped for ${name}.`, 404);
    if (map.sidecar) {
      const fn = hooks.ops?.[map.sidecar];
      if (typeof fn !== "function") throw new OperationError("unknown_operation", `The sidecar has no ${map.sidecar} operation.`, 404);
      return rewriteOrigins(await fn(args ?? {}, { ...ctx, call: callCtx }));
    }
    const tool = (await mcp.tools()).get(map.tool);
    if (!tool) {
      throw new OperationError("upstream_changed", `${base.pin.name} ${base.pin.tag ?? ""} no longer serves the tool ${map.tool}.`, 410);
    }
    const { view: rawView, ...toolArgs } = args ?? {};
    const view = VIEWS.has(String(rawView ?? "text")) ? String(rawView ?? "text") : "text";
    const call = { op: name, module: moduleOf.get(name), tool: map.tool, args: coerceArgs(toolArgs, tool.inputSchema) };
    // A setup problem the app can see before calling (e.g. an account that
    // is not configured) answers with its next step instead of a tool error.
    const blocked = hooks.before?.(call, ctx);
    if (blocked) throw new OperationError(blocked.code, blocked.message, blocked.status ?? 409);
    // Shown by the upstream app as who made the record. The local grant is
    // named "local", which means nothing to the person reading it.
    const named = callCtx?.agentName && callCtx.agentName !== "local" ? callCtx.agentName : "AI agent";
    const caller = `${named} via Agent App`;
    try {
      const result = await mcp.call(map.tool, call.args, { caller });
      return shapeResult(result, { op: name, explain: hooks.explain ? (r) => hooks.explain(r, ctx) : null, view, textLimit: hooks.textLimit });
    } catch (e) {
      if (e instanceof McpError) throw new OperationError(e.code, e.message, e.code === "invalid_param" ? 409 : 502);
      throw e;
    }
  }

  a2app = createA2App(binding, {
    credentials: [{ token, credentialId: "cred_local", agentName: "local", principal: "owner", scopes: ["*"] }],
    appVersion: () => `${manifest.appVersion ?? "0.1.0"}+${base.pin.tag ?? base.pin.sha256.slice(0, 12)}`,
    operations,
    events: hooks.events ?? [],
    modules: manifest.modules,
    conventions: hooks.conventions ?? {},
    allowedOrigins: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
    credentialHint: hooks.credentialHint ?? "Read the app's .agent-token file in the app folder.",
    env: base.env,
    storePath: join(base.dataDir, "a2app-state.json"),
  });

  /* ------------------------------------------------------------ routing */

  const adapter = a2appMiddleware(a2app);
  const notFound = (_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ a2app: true, ok: false, code: "not_found", message: "No such route." }));
  };
  const isAdapterPath = (path) =>
    path === "/.well-known/a2app.json" ||
    path === "/api/_a2app" ||
    path.startsWith("/api/_a2app/") ||
    path.startsWith("/api/ops/") ||
    path.startsWith("/api/collections/");

  function proxy(req, res) {
    const up = request(
      { host: "127.0.0.1", port: internalPort, method: req.method, path: req.url, headers: req.headers },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.statusMessage, ur.rawHeaders);
        ur.pipe(res);
      },
    );
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`${base.pin.name} is restarting or not running. Try again in a few seconds.`);
    });
    req.pipe(up);
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (isAdapterPath(path)) adapter(req, res, notFound);
    else proxy(req, res);
  });

  // WebSockets (and any other upgrade) go straight through.
  server.on("upgrade", (req, socket, head) => {
    const up = connect(internalPort, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });

  let nextRequestId = 0;
  server.on("request", (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (!isAdapterPath(path)) return;
    const id = ++nextRequestId;
    const started = Date.now();
    res.on("finish", () => logLine(res.statusCode >= 500 ? "error" : "info", "http", { id, method: req.method, path, status: res.statusCode, ms: Date.now() - started }));
  });

  server.listen(PORT, HOST, () => {
    logLine("info", "boot", { app: manifest.name ?? manifest.id, a2appId: manifest.id, url: `http://${HOST}:${PORT}`, upstream: `${base.pin.name} ${base.pin.tag ?? ""}`.trim() });
  });

  const watcher = hooks.watch ? await hooks.watch(ctx) : null;

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      watcher?.stop?.();
      await upstream?.stop?.();
    } finally {
      server.close();
      process.exit(0);
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, shutdown);
}

process.on("uncaughtException", (err) => {
  logLine("error", "crash", { message: err?.message, stack: err?.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logLine("error", "crash", { message: String(reason?.message ?? reason), stack: reason?.stack });
  process.exit(1);
});

main().catch((err) => {
  logLine("error", "boot_failed", { message: err?.message ?? String(err) });
  process.exit(1);
});
