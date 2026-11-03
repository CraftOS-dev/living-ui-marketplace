/**
 * The Agent App server (SYSTEM-OWNED — hash-locked in the ownership canon).
 *
 * A single Node process: a Hono app served by `@hono/node-server`, with the
 * A2App adapter (`@a2app/adapter-core`) mounted as embedded middleware and the
 * built React View (`dist/`, produced by `vite build`) served behind it.
 * Records live in SQLite (`data/db.sqlite`, via better-sqlite3). The agent
 * evolves the app by editing `a2app.schema.mjs` (Model + operations) and
 * `src/` (the React View) — never this file. Because describe and
 * `schemaVersion` are derived from the live schema, an agent always sees the
 * true model.
 */
import { createA2App, createStaticView, UnsupportedFilterError } from "@a2app/adapter-core";
import { serve } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { schema } from "./a2app.schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The launch contract (`serve` and `dev` both set these; defaults cover a
// direct `node server.mjs`):
//   A2APP_DATA_DIR  where records live. `serve` passes the toolkit's declared
//                   lifecycle dataDir ("data" — what backup/restore/promote
//                   protect); `dev` passes a fresh per-boot directory, which is
//                   how a dev instance runs against a disposable database.
//   A2APP_ENV       "live" or "dev" — decides how the static View is served.
const ENV = process.env.A2APP_ENV ?? "live";
const DATA_DIR = process.env.A2APP_DATA_DIR ? resolve(process.env.A2APP_DATA_DIR) : join(HERE, "data");
const DB_FILE = join(DATA_DIR, "db.sqlite");
const TOKEN_FILE = join(HERE, ".agent-token");
// The React View is served BUILT: `vite build` (the pipeline `build` step)
// compiles `index.html` + `src/` into `dist/`. Source is never served.
const DIST_DIR = join(HERE, "dist");

const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
// The CLI reaches a running app at manifest.port; bind the same port so the two
// always agree. PORT env overrides (`serve` passes manifest.port; `dev` a
// hidden port), then manifest.port.
const PORT = Number(process.env.PORT ?? manifest.port ?? 8091);

/* ----------------------------------------------------------- persistence */

/** Coerce a validated raw value into its stored form. The guard already
 *  accepted it; this only normalizes string→number/boolean. */
function coerce(field, value) {
  if (value === null || value === "") return value;
  if (field.type === "number" && typeof value === "string") return Number(value);
  if (field.type === "boolean" && typeof value === "string") return value === "true";
  return value;
}

/** Build a stored record from a raw body: assign an id, fill server-managed
 *  read-only `created`, drop blanks. */
function materialize(fields, body) {
  const id = typeof body.id === "string" && body.id ? body.id : "rec_" + randomBytes(8).toString("hex");
  const rec = { id };
  for (const f of fields) {
    if (f.name in body && body[f.name] !== undefined && body[f.name] !== null && body[f.name] !== "") {
      rec[f.name] = coerce(f, body[f.name]);
    } else if (f.readOnly && f.name === "created") {
      rec[f.name] = new Date().toISOString();
    }
  }
  return rec;
}

// One generic table maps every entity onto SQLite: rows are the protocol's
// JSON records, keyed (entity, id). The schema stays declarative and additive
// (a new field simply appears in the JSON), while the DATABASE is a real
// on-disk SQLite file inside the toolkit's declared lifecycle dataDir — which
// is what backup/restore/promote protect. WAL keeps a reader (the View) and a
// writer (the agent) from blocking each other.
mkdirSync(DATA_DIR, { recursive: true });
const freshDb = !existsSync(DB_FILE);
const sqlite = new Database(DB_FILE);
sqlite.pragma("journal_mode = WAL");
sqlite.exec(
  "CREATE TABLE IF NOT EXISTS records (entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (entity, id))",
);

const stmt = {
  list: sqlite.prepare("SELECT data FROM records WHERE entity = ?"),
  get: sqlite.prepare("SELECT data FROM records WHERE entity = ? AND id = ?"),
  put: sqlite.prepare(
    "INSERT INTO records (entity, id, data) VALUES (?, ?, ?) ON CONFLICT (entity, id) DO UPDATE SET data = excluded.data",
  ),
  del: sqlite.prepare("DELETE FROM records WHERE entity = ? AND id = ?"),
};

/** The store operation runners receive: entity-level reads and writes over the
 *  SQLite table. Writes are durable when the call returns — there is no
 *  separate persist() step on this stack. */
const store = {
  list: (entity) => stmt.list.all(entity).map((row) => JSON.parse(row.data)),
  get: (entity, id) => {
    const row = stmt.get.get(entity, id);
    return row === undefined ? null : JSON.parse(row.data);
  },
  put: (entity, rec) => {
    stmt.put.run(entity, rec.id, JSON.stringify(rec));
    return rec;
  },
  remove: (entity, id) => stmt.del.run(entity, id).changes > 0,
};

// Seed exactly once, when this boot CREATED the database file — first live
// boot. (`dev` prepares its own freshly seeded database via
// scripts/dev-prepare.mjs before the server starts.)
if (freshDb) {
  const seedAll = sqlite.transaction(() => {
    for (const [entity, def] of Object.entries(schema.entities)) {
      for (const seed of def.seed ?? []) store.put(entity, materialize(def.fields, seed));
    }
  });
  seedAll();
}

/* --------------------------------------------------------------- binding */

function cmp(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return String(a) < String(b) ? -1 : 1;
}

/** The single-clause grammar this backend implements — `field = "value"`,
 *  `field != "value"`, or `field ~ "value"` (contains), optionally wrapped in one
 *  pair of parentheses. Enough for label→id resolution; a richer backend exposes
 *  its own query language.
 *
 *  Anything outside it is REFUSED, never ignored: an adapter that accepts
 *  `filter` and returns unfiltered rows answers 200 with the wrong records, which
 *  turns every label lookup into a false multi-match. */
const FILTER_CLAUSE =
  /^\s*\(?\s*([A-Za-z_]\w*)\s*(=|!=|~)\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'()]+))\s*\)?\s*$/;

function matchFilter(expr) {
  const m = FILTER_CLAUSE.exec(expr);
  if (!m) throw new UnsupportedFilterError(expr);
  const [, field, op, quoted, singleQuoted, bare] = m;
  // Only the double-quoted form carries escapes; unescape exactly what the
  // escaping side wrote (`\x` -> `x`).
  const val = quoted !== undefined ? quoted.replace(/\\(.)/g, "$1") : (singleQuoted ?? bare ?? "");
  return (r) => {
    const cur = r[field];
    const s = cur === undefined || cur === null ? "" : String(cur);
    if (op === "=") return s === val;
    if (op === "!=") return s !== val;
    return s.includes(val);
  };
}

/** The back face: maps the SQLite store onto protocol types. The served surface
 *  and the pure rules are shared verbatim from `@a2app/adapter-core`. */
const binding = {
  appId: manifest.id,
  appName: manifest.name ?? null,
  adapterVersion: manifest.adapterVersion ?? "0.1.0",
  authMode: manifest.authMode === "multi-user" ? "multi-user" : "none",

  entities() {
    const out = {};
    for (const [name, def] of Object.entries(schema.entities)) {
      // module + summary travel with the entity: describe groups by module, so
      // an entity that dropped them here would have no screen to appear on.
      out[name] = { fields: def.fields, module: def.module, ...(def.summary ? { summary: def.summary } : {}) };
    }
    return out;
  },

  listRecords(entity, query) {
    let items = store.list(entity);
    if (query.filter) items = items.filter(matchFilter(query.filter));
    if (query.sort) {
      const desc = query.sort.startsWith("-");
      const key = desc ? query.sort.slice(1) : query.sort;
      items = [...items].sort((a, b) => cmp(a[key], b[key]) * (desc ? -1 : 1));
    }
    const totalItems = items.length;
    const perPage = query.perPage ?? totalItems;
    const page = query.page ?? 1;
    const start = (page - 1) * perPage;
    return { items: items.slice(start, start + perPage), page, perPage, totalItems };
  },

  getRecord(entity, id) {
    return store.get(entity, id);
  },

  createRecord(entity, body) {
    const def = schema.entities[entity];
    return store.put(entity, materialize(def.fields, body));
  },

  updateRecord(entity, id, body) {
    const rec = store.get(entity, id);
    if (!rec) return null;
    for (const f of schema.entities[entity].fields) {
      if (f.readOnly || !(f.name in body)) continue;
      const v = body[f.name];
      if (v === null || v === "") delete rec[f.name];
      else rec[f.name] = coerce(f, v);
    }
    return store.put(entity, rec);
  },

  deleteRecord(entity, id) {
    return store.remove(entity, id);
  },

  runOperation(name, args, ctx) {
    const runner = schema.operationRunners?.[name];
    if (!runner) throw new Error(`no runner for operation "${name}"`);
    // `trigger` is the app→agent seam. This file is system-owned, so without it
    // an author whose only seam is `a2app.schema.mjs` could never enqueue agent
    // work: the adapter handle that can do so lives here and nowhere they may
    // edit. `a2app` is declared further down and read at call time, which is
    // always after boot.
    return runner(args, ctx, {
      store,
      /** Emit a declared event, and enqueue a task when `capability` is given. */
      trigger: (type, payload, capability) => a2app.trigger({ type, payload: payload ?? {}, ...(capability ? { capability } : {}) }),
    });
  },
};

/* ------------------------------------------------------------ credential */

let token;
if (existsSync(TOKEN_FILE)) {
  token = readFileSync(TOKEN_FILE, "utf8").trim();
} else {
  token = "a2app_" + randomBytes(24).toString("hex");
  writeFileSync(TOKEN_FILE, token + "\n", { mode: 0o600 });
}

/* ------------------------------------------------------------ static View */

/**
 * The View, served BUILT and with real cache validators.
 *
 * "Live loads code at boot": in the live environment the View is served from a
 * SNAPSHOT of `dist/` taken at this boot (`.a2app/public`), matching how the
 * rest of the code is fixed at process start. Without it, a rebuild mid-
 * iteration would reach live users on their next refresh — before any gate or
 * verify has seen it. The dev instance serves `dist/` directly (rebuild →
 * refresh); for tight View iteration `npm run dev:ui` runs Vite's dev server
 * with `/api` proxied here.
 *
 * `createStaticView` is the framework's static handler, not a per-app one: it
 * answers every asset with `ETag`, `Last-Modified` and `Cache-Control: no-cache`
 * and honours conditional requests, so a plain reload always re-checks and an
 * unchanged file costs a bodyless 304. This file is system-owned and hash-locked
 * precisely so an app author never has to fix cache correctness themselves.
 *
 * `view.version()` fingerprints the bytes it serves. That is published below as
 * identity's `appVersion`, and it is the ONLY signal that moves for a View-only
 * change — `schemaVersion` covers entities and operations, so a new component,
 * a CSS tweak or reworded copy leaves it byte-identical. `a2app.schema.mjs` is
 * folded in as well: an operation's description is not in `schemaVersion` either,
 * yet it changes what the app tells an agent.
 */
/** Recursive copy without fs.cpSync — cpSync silently crashes on Windows when
 *  the source path contains non-ASCII characters (exit 0xC0000409; the
 *  framework's fsx.ts documents the same finding). */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

if (!existsSync(DIST_DIR)) {
  // Refuse to serve an app with no View rather than 404-ing every human who
  // opens it: the build step is part of the pipeline, so a missing dist/ means
  // the pipeline has not run, not that this app is API-only.
  process.stderr.write("dist/ not found — the View is not built. Run the pipeline build (npm run build) first.\n");
  process.exit(1);
}

let servedPublicDir = DIST_DIR;
if (ENV === "live") {
  const snapshot = join(HERE, ".a2app", "public");
  rmSync(snapshot, { recursive: true, force: true });
  copyDir(DIST_DIR, snapshot);
  servedPublicDir = snapshot;
}

const view = createStaticView(servedPublicDir, {
  // The update watcher lives at the project root, not inside the View build: it
  // is system-owned, and the View is the agent's to rewrite entirely.
  aliases: { "/_a2app/update.js": join(HERE, "a2app-update.js") },
  fingerprintPaths: [join(HERE, "a2app.schema.mjs")],
  // An author who wants to move the marker by hand can bump manifest.appVersion.
  versionSalt: manifest.appVersion ?? "",
});

const a2app = createA2App(binding, {
  credentials: [{ token, credentialId: "cred_local", agentName: "local", principal: "owner", scopes: ["*"] }],
  // Re-derived per request, so it stays true for a server whose files changed
  // under it — the same "derive, do not declare" rule schemaVersion follows.
  appVersion: () => view.version(),
  operations: schema.operations ?? [],
  // The event types this app may emit. Declaring them is what keeps the
  // app→agent queue from being an open channel: `trigger` refuses a type that
  // is not here, so the set of things this app can ever ask an agent to react
  // to is fixed by its author, in code they own, rather than by whatever a
  // caller passes at the moment of firing.
  events: schema.events ?? [],
  // Modules are declared in the manifest and are what describe's root level
  // lists; every entity and operation names one.
  modules: manifest.modules,
  allowedOrigins: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
  credentialHint: "Read the app's .agent-token file (mode 0600) in the project directory.",
  // Adapter-owned state (idempotency keys, tasks, events, grants, audit) lives
  // beside the records, inside the toolkit's declared lifecycle dataDir. The
  // idempotency table MUST survive a restart: a restart is exactly when a
  // retried write arrives, so an in-memory table would return a duplicate
  // record instead of the 409 the protocol promises.
  storePath: join(DATA_DIR, "a2app-state.json"),
});

/* ------------------------------------------------------- structured log */

/** One JSON line per event on stdout (the log `agent-app serve` captures):
 *  a single schema — ts, level, evt, then event fields — so diagnosis filters
 *  by field instead of parsing prose. Never log record contents or secrets. */
function logLine(level, evt, fields = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, evt, ...fields }) + "\n");
}

/* ------------------------------------------------------------- Hono app */

// Route ownership, in order: (1) the A2App adapter answers every path it owns
// (identity, describe, records, operations, tasks/events) and declines the
// rest; (2) anything else falls through to the static View. The adapter is
// mounted as middleware — embedded-middleware form — so the app keeps Hono for
// its own routes without ever standing in front of the protocol.
const hono = new Hono();

// A protocol write is tiny; anything larger is a mistake or an attack, and
// buffering it whole would let a hostile client OOM the app. Same cap and
// envelope as @a2app/adapter-core's own Node transport (http.ts).
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;
hono.use(
  "*",
  bodyLimit({
    maxSize: MAX_REQUEST_BODY_BYTES,
    onError: (c) =>
      c.json(
        {
          a2app: true,
          ok: false,
          code: "payload_too_large",
          message: `Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit.`,
          limitBytes: MAX_REQUEST_BODY_BYTES,
        },
        413,
        { connection: "close" },
      ),
  }),
);

/** Adapt a Hono request into the framework-agnostic A2AppRequest the adapter
 *  routes: method, path, query, lower-cased headers, parsed JSON body. A body
 *  that is not JSON is handed to the guard as `__unparsed__` so it is rejected
 *  by the adapter's own rules rather than 500-ing here. */
async function toA2AppRequest(c) {
  const url = new URL(c.req.url);
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  const headers = {};
  for (const [k, v] of c.req.raw.headers) headers[k.toLowerCase()] = v;
  const req = { method: c.req.method.toUpperCase(), path: url.pathname, query, headers };
  if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
    const text = await c.req.text();
    if (text.trim() !== "") {
      try {
        req.body = JSON.parse(text);
      } catch {
        req.body = { __unparsed__: text };
      }
    }
  }
  return req;
}

hono.use("*", async (c, next) => {
  let reply;
  try {
    reply = await a2app.handle(await toA2AppRequest(c));
  } catch (e) {
    // Fail open internally: an adapter bug never 500s the whole app silently —
    // it answers with a machine-readable adapter error.
    return c.json({ a2app: true, ok: false, code: "adapter_error", message: String(e?.message ?? e) }, 500);
  }
  if (reply === null) return next(); // not the adapter's route — the View's
  return c.json(reply.json, reply.status, reply.headers ?? {});
});

// Any path the adapter does not own is the View's. `view.handler` (the
// framework's system-owned static handler) speaks Node req/res, which
// @hono/node-server exposes as the environment bindings.
hono.all("*", (c) => {
  view.handler(c.env.incoming, c.env.outgoing);
  return RESPONSE_ALREADY_SENT;
});

/* ---------------------------------------------------------------- listen */

// Fail fast and loudly: a structured last line beats a silent wedge, and the
// launch contract's supervisor is what restarts the process, not the process.
process.on("uncaughtException", (err) => {
  logLine("error", "crash", { message: err?.message, stack: err?.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logLine("error", "crash", { message: String(reason?.message ?? reason), stack: reason?.stack });
  process.exit(1);
});

// Bind loopback explicitly. Binding every interface would make the app
// reachable from the network while its own log line said localhost — and a
// same-origin request is trusted as the owner without a credential, which
// would make a scaffolded Agent App remotely writable by anyone who could
// reach the port. Exposing it must be a deliberate act, hence the env var.
const HOST = process.env.A2APP_HOST ?? "127.0.0.1";
const server = serve({ fetch: hono.fetch, port: PORT, hostname: HOST }, () => {
  logLine("info", "boot", { app: manifest.name ?? manifest.id, a2appId: manifest.id, url: `http://${HOST}:${PORT}` });
});

// Observe (never handle) every request for the log: id, method, path, status,
// duration. Paths only — query strings can carry filters over user data.
let nextRequestId = 0;
server.on("request", (req, res) => {
  const id = ++nextRequestId;
  const started = Date.now();
  res.on("finish", () => {
    logLine(res.statusCode >= 500 ? "error" : "info", "http", {
      id,
      method: req.method,
      path: (req.url ?? "/").split("?")[0],
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
});
