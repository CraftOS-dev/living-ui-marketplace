/// <reference path="../pb_data/types.d.ts" />
/**
 * A2App adapter for PocketBase — IMPLEMENTATION (SYSTEM-OWNED — hash-locked).
 *
 * The served surface of the A2App protocol, in-process, as PocketBase JS hooks.
 * It is a port of the reference adapter's server (`@a2app/adapter-core`
 * server.ts) onto PocketBase, and it runs the reference's own rules and describe
 * code (bundled into `_a2app_rules.js`), so every stack answers the same way.
 *
 *   identity      GET  /api/_a2app, /.well-known/a2app.json
 *   describe      GET  /api/_a2app/describe[/{module}[/{entity}[/{id}[/{relation}]]]]
 *   whoami        GET  /api/_a2app/whoami
 *   context       GET  /api/_a2app/context      (the View publishes it: setContext)
 *   viewers       GET  /api/_a2app/viewers
 *   events        GET  /api/_a2app/events?since=
 *   tasks         GET  /api/_a2app/tasks[?status=], /tasks/{id}
 *                 POST /api/_a2app/tasks/{id}/claim|progress|complete|cancel
 *   records       /api/collections/{entity}/records[/{id}]   (PocketBase serves;
 *                 the adapter runs the check chain in front of it)
 *   operations    POST /api/ops/{name}     (the chain runs in middleware; the
 *                 app's own route runs the work through `op()`)
 *
 * The check chain for every agent or program call is the reference's, in order:
 * host → origin → credential → scope → guard → backend → read-back. The app's
 * own View (same-origin browser requests) is trusted and reaches PocketBase
 * unchanged after the host and origin checks; its writes are validated by the
 * backend's own schema, exactly as before the adapter was installed.
 *
 * Adapter-owned state (grants, idempotency keys, approvals, tasks, events, the
 * audit log) lives in `_a2app_*` collections this file creates at boot. They are
 * underscore-prefixed, so describe never publishes them as entities.
 *
 * Runtime: PocketBase JSVM (goja) on the 0.39 hook API. Every hook handler is a
 * one-liner in `_a2app.pb.js` that require()s this module — handlers cannot see
 * file scope (PocketBase runs each in an isolated VM).
 */

var ADAPTER_VERSION = "0.2.0";
var PROTOCOL_VERSION = "0.1";

var TASK_TIMEOUT_MS = 60000;
var TASK_MAX_DELIVERIES = 5;
var APPROVAL_TTL_MS = 10 * 60 * 1000;
var IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
var EVENT_RETENTION = 5000;
var AUDIT_RETENTION = 5000;
var VIEWER_TTL_MS = 60000;
var REFERENCE_SCAN_LIMIT = 10;

var C_KV = "_a2app_kv";
var C_TASKS = "_a2app_tasks";
var C_EVENTS = "_a2app_events";
var C_AUDIT = "_a2app_audit";

/** Keys an auth collection accepts besides its schema fields. */
var AUTH_WRITE_ALLOW = ["password", "passwordConfirm", "oldPassword", "email", "emailVisibility", "verified"];

var RECORDS_PATH = /^\/api\/collections\/([^\/]+)\/records(?:\/([^\/]+))?\/?$/;
var OPS_PATH = /^\/api\/ops\/([^\/]+)\/?$/;

function C() {
  return require(`${__hooks}/_a2app_rules.js`);
}

/* =================================================================== files */

function appRoot() {
  return $filepath.join(__hooks, "..", "..");
}

function readText(rel) {
  try {
    return toString($os.readFile($filepath.join(appRoot(), rel)));
  } catch (_e) {
    return null;
  }
}

function fileKey(rel) {
  try {
    var st = $os.stat($filepath.join(appRoot(), rel));
    return String(st.size()) + ":" + String(st.modTime().unixMilli());
  } catch (_e) {
    return "-";
  }
}

/**
 * The app part's declarations: manifest (identity, modules, entity→module map,
 * authMode), operations.json, events.json, and the local credential. Read from
 * disk and cached in the app store keyed by each file's size and mtime, so an
 * edit is picked up on the next request (dev) without re-parsing on every call.
 */
function decl() {
  var key = [fileKey("manifest.json"), fileKey("operations.json"), fileKey("events.json"), fileKey(".agent-token"), fileKey(".superuser")].join("|");
  var store = $app.store();
  var cached = store.get("a2app.decl");
  if (cached && cached.key === key) return cached;

  var d = { key: key, problems: [] };
  var manifest = null;
  try {
    manifest = JSON.parse(readText("manifest.json"));
  } catch (_e) {
    manifest = null;
  }
  if (manifest === null || typeof manifest.id !== "string" || manifest.id === "") {
    d.problems.push("manifest.json is unreadable or has no id");
    manifest = { id: "", name: null, modules: [] };
  }
  d.appId = manifest.id;
  d.appName = typeof manifest.name === "string" ? manifest.name : null;
  d.authMode = manifest.authMode === "multi-user" ? "multi-user" : "none";
  d.modules = [];
  d.entityModule = {};
  d.entityOrder = [];
  var mods = Array.isArray(manifest.modules) ? manifest.modules : [];
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i] || {};
    if (typeof m.name !== "string") continue;
    var row = { name: m.name };
    if (typeof m.summary === "string" && m.summary !== "") row.summary = m.summary;
    d.modules.push(row);
    var owned = Array.isArray(m.entities) ? m.entities : [];
    for (var j = 0; j < owned.length; j++) {
      if (typeof owned[j] === "string" && d.entityModule[owned[j]] === undefined) {
        d.entityModule[owned[j]] = m.name;
        d.entityOrder.push(owned[j]);
      }
    }
  }

  var opsDoc = null;
  var opsText = readText("operations.json");
  if (opsText !== null) {
    try {
      opsDoc = JSON.parse(opsText);
    } catch (_e) {
      d.problems.push("operations.json is not valid JSON");
    }
  }
  d.operations = [];
  var rawOps = opsDoc && Array.isArray(opsDoc.operations) ? opsDoc.operations : [];
  for (var k = 0; k < rawOps.length; k++) {
    var o = rawOps[k] || {};
    var op = {
      name: o.name,
      destructive: o.destructive === true,
      module: o.module,
      params: o.params && typeof o.params === "object" && !Array.isArray(o.params) ? o.params : {},
    };
    if (typeof o.description === "string" && o.description !== "") op.description = o.description;
    if (o.readOnly === true) op.readOnly = true;
    if (o.idempotent === true) op.idempotent = true;
    if (typeof o.entity === "string" && o.entity !== "") op.entity = o.entity;
    if (o.appliesWhen !== undefined) op.appliesWhen = o.appliesWhen;
    if (o.system === true) op.system = true;
    d.operations.push(op);
  }

  var evDoc = null;
  var evText = readText("events.json");
  if (evText !== null) {
    try {
      evDoc = JSON.parse(evText);
    } catch (_e) {
      d.problems.push("events.json is not valid JSON");
    }
  }
  d.events = [];
  d.capabilities = [];
  var rawEvents = evDoc && Array.isArray(evDoc.events) ? evDoc.events : [];
  for (var n = 0; n < rawEvents.length; n++) {
    var ev = rawEvents[n] || {};
    if (typeof ev.type !== "string" || ev.type === "") continue;
    var oneEvent = { type: ev.type, payload: ev.payload && typeof ev.payload === "object" ? ev.payload : {} };
    if (typeof ev.capability === "string" && ev.capability !== "") {
      oneEvent.capability = ev.capability;
      if (d.capabilities.indexOf(ev.capability) < 0) d.capabilities.push(ev.capability);
    }
    d.events.push(oneEvent);
  }
  d.conventions = {};
  if (evDoc && evDoc.conventions && typeof evDoc.conventions === "object") {
    var core = C();
    var keys = Object.keys(evDoc.conventions);
    for (var q = 0; q < keys.length && q < 4; q++) {
      var bounded = core.boundAppText(evDoc.conventions[keys[q]]);
      if (bounded !== undefined) d.conventions[keys[q]] = bounded;
    }
  }

  var tokenText = readText(".agent-token");
  d.localToken = tokenText !== null ? tokenText.trim() : "";
  var su = null;
  try {
    su = JSON.parse(readText(".superuser") || "null");
  } catch (_e) {
    su = null;
  }
  d.superuserEmail = su && typeof su.email === "string" ? su.email : "";

  store.set("a2app.decl", d);
  return d;
}

/* ================================================================= binding */

var DAY_KEY_NAME = /^(due|day|date)$|_(date|day)$/i;

/**
 * The live model, mapped to protocol types: every collection the manifest lists
 * under a module, in declaration order. Collections no module lists are the
 * app's internals — PocketBase still serves them to the View, but they are not
 * entities, so an agent cannot see or write them through the protocol.
 */
function entities(d) {
  var out = {};
  for (var i = 0; i < d.entityOrder.length; i++) {
    var name = d.entityOrder[i];
    var col = null;
    try {
      col = $app.findCollectionByNameOrId(name);
    } catch (_e) {
      col = null;
    }
    if (!col || col.name !== name) continue;
    var def = { fields: mapFields(col), module: d.entityModule[name] };
    var allow = ["id"];
    if (col.type === "auth") {
      def.auth = true;
      allow = allow.concat(AUTH_WRITE_ALLOW);
    }
    if (col.type === "view") {
      for (var f = 0; f < def.fields.length; f++) def.fields[f].readOnly = true;
    }
    def.writeAllow = allow;
    out[name] = def;
  }
  return out;
}

function mapFields(col) {
  var out = [];
  var names = col.fields.fieldNames();
  for (var i = 0; i < names.length; i++) {
    var f = col.fields.getByName(names[i]);
    if (!f || f.name === "id") continue;
    var t = f.type();
    var nf = { name: f.name, type: protocolType(f, t) };
    if (t === "password" || f.hidden) nf.writeOnly = true;
    if (t === "autodate") nf.readOnly = true;
    if (f.required && t !== "autodate") nf.required = true;
    if (t === "text" && f.max > 0) nf.max = f.max;
    if (t === "select" && f.values) nf.values = Array.from(f.values);
    if (t === "relation" && f.collectionId) {
      try {
        nf.entity = $app.findCollectionByNameOrId(f.collectionId).name;
      } catch (_e) {
        /* unresolved target: left without an entity */
      }
      // PocketBase deletes referencing rows itself when the relation cascades,
      // so the adapter must not refuse that delete; every other relation keeps
      // the protocol default and blocks a delete that would orphan it.
      if (f.cascadeDelete) nf.onDelete = "ignore";
    }
    if (t === "text" && f.max > 0 && f.max <= 12 && DAY_KEY_NAME.test(f.name)) nf.dayKey = true;
    out.push(nf);
  }
  return out;
}

function protocolType(f, t) {
  switch (t) {
    case "number":
      return "number";
    case "bool":
      return "boolean";
    case "date":
    case "autodate":
      return "datetime";
    case "json":
    case "geoPoint":
      return "json";
    case "file":
      return "binary";
    case "select":
      return f.maxSelect > 1 ? "list<enum>" : "enum";
    case "relation":
      return f.maxSelect > 1 ? "list<ref>" : "ref";
    default:
      return "string";
  }
}

function plain(record) {
  try {
    return record.publicExport();
  } catch (_e) {
    return { id: record.id };
  }
}

function makeBinding(d) {
  var cache = null;
  return {
    appId: d.appId,
    appName: d.appName,
    adapterVersion: ADAPTER_VERSION,
    authMode: d.authMode,
    entities: function () {
      if (cache === null) cache = entities(d);
      return cache;
    },
    getRecord: function (entity, id) {
      try {
        return plain($app.findRecordById(entity, id));
      } catch (_e) {
        return null;
      }
    },
  };
}

function describeDeps(d, binding) {
  return {
    binding: binding,
    operations: d.operations,
    modules: d.modules,
    conventions: function () {
      return conventionsOf(d);
    },
  };
}

function conventionsOf(d) {
  var out = {
    writes: "Prefer a declared operation over a raw write where one exists.",
    labels: "Resolve a label to an id by a filtered read on the entity's label field; on multi-match, ask or fail — never pick.",
    dates: "Relative words (\"tomorrow\") are rejected by the app; resolve them to ISO 8601 client-side.",
    honesty: "If the app cannot express what was asked, say so instead of approximating into a wrong field.",
  };
  var keys = Object.keys(d.conventions || {});
  for (var i = 0; i < keys.length; i++) out[keys[i]] = d.conventions[keys[i]];
  return out;
}

/* ================================================================ envelopes */

function reply(status, json) {
  return { status: status, json: json };
}

function err(status, code, message, extra) {
  var body = { a2app: true, ok: false, code: code, message: message };
  if (extra) {
    var keys = Object.keys(extra);
    for (var i = 0; i < keys.length; i++) body[keys[i]] = extra[keys[i]];
  }
  return reply(status, body);
}

function send(e, r) {
  return e.json(r.status, r.json);
}

function guardEnvelope(violations, serverNow) {
  var core = C();
  var first = violations[0];
  return reply(400, {
    a2app: true,
    ok: false,
    code: first.code,
    field: first.field,
    expected: first.expected,
    got: first.got,
    message: core.describeViolation(first, serverNow),
    violations: violations.map(function (v) {
      return { code: v.code, field: v.field, expected: v.expected, got: v.got };
    }),
  });
}

/* ================================================================== request */

function requestOf(e) {
  return e.request || (e.requestEvent && e.requestEvent.request) || null;
}

function headerOf(e, name) {
  try {
    var req = requestOf(e);
    return req ? String(req.header.get(name) || "") : "";
  } catch (_e) {
    return "";
  }
}

function pathOf(e) {
  try {
    return String(requestOf(e).url.path || "");
  } catch (_e) {
    return "";
  }
}

function methodOf(e) {
  try {
    return String(requestOf(e).method || "").toUpperCase();
  } catch (_e) {
    return "";
  }
}

function hostOf(e) {
  try {
    return String(requestOf(e).host || "");
  } catch (_e) {
    return "";
  }
}

function queryOf(e) {
  try {
    return e.requestInfo().query || {};
  } catch (_e) {
    return {};
  }
}

function bodyOf(e) {
  try {
    var b = e.requestInfo().body;
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch (_e) {
    return {};
  }
}

function envList(name) {
  var raw = "";
  try {
    raw = String($os.getenv(name) || "");
  } catch (_e) {
    raw = "";
  }
  return raw
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(function (s) {
      return s !== "";
    });
}

/**
 * Is this request addressed to the loopback interface by name? A page on
 * evil.com whose DNS rebinds to 127.0.0.1 is same-origin with this server as far
 * as the browser is concerned, but it still carries `evil.com` in Host.
 */
function isAllowedHost(raw) {
  var host = String(raw || "").toLowerCase();
  if (host === "") return true;
  var extra = envList("A2APP_ALLOWED_HOSTS").map(function (h) {
    return h.toLowerCase();
  });
  if (extra.indexOf(host) >= 0) return true;
  var name = host.indexOf("[") === 0 ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (name === "localhost" || name === "[::1]" || name === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

function ownOrigins(e) {
  var host = hostOf(e);
  return ["http://" + host, "https://" + host].concat(envList("A2APP_ALLOWED_ORIGINS"));
}

/**
 * The app's own View. A browser marks every request it makes: `Origin` on
 * writes, and `Sec-Fetch-Site` on everything, including the same-origin GETs
 * that carry no Origin. A program (the CLI, an agent's HTTP client) sends
 * neither, so it is never mistaken for the View.
 */
function isView(e) {
  var origin = headerOf(e, "Origin");
  if (origin !== "") return ownOrigins(e).indexOf(origin) >= 0;
  return headerOf(e, "Sec-Fetch-Site") === "same-origin";
}

function isForeignOrigin(e) {
  var origin = headerOf(e, "Origin");
  if (origin === "") return headerOf(e, "Sec-Fetch-Site") === "cross-site";
  return ownOrigins(e).indexOf(origin) < 0;
}

/* ===================================================================== state */

function collectionOr(name) {
  try {
    return $app.findCollectionByNameOrId(name);
  } catch (_e) {
    return null;
  }
}

/** Create the adapter's state collections on a database that lacks them. */
function ensureState(app) {
  var a = app || $app;
  var idField = function () {
    return { name: "id", type: "text", primaryKey: true, required: true, system: true, min: 1, max: 64, pattern: "^[a-z0-9_]+$", autogeneratePattern: "[a-z0-9]{15}" };
  };
  var specs = [
    {
      name: C_KV,
      fields: [
        { name: "kind", type: "text", required: true, max: 32 },
        { name: "key", type: "text", required: true, max: 200 },
        { name: "value", type: "json", maxSize: 1000000 },
        { name: "expires", type: "number" },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_a2app_kv_kind_key ON _a2app_kv (kind, key)"],
    },
    {
      name: C_TASKS,
      fields: [
        idField(),
        { name: "event", type: "text", max: 64 },
        { name: "status", type: "text", required: true, max: 32 },
        { name: "capability", type: "text", required: true, max: 120 },
        { name: "payload", type: "json", maxSize: 1000000 },
        { name: "claim", type: "json", maxSize: 10000 },
        { name: "progress", type: "json", maxSize: 10000 },
        { name: "result", type: "json", maxSize: 1000000 },
        { name: "reason", type: "text", max: 200 },
        { name: "ask", type: "json", maxSize: 100000 },
        { name: "dedup", type: "text", max: 200 },
        { name: "deliveries", type: "number" },
        { name: "created_at", type: "text", max: 40 },
        { name: "updated_at", type: "text", max: 40 },
        { name: "updated_ms", type: "number" },
      ],
      indexes: ["CREATE INDEX idx_a2app_tasks_status ON _a2app_tasks (status)", "CREATE INDEX idx_a2app_tasks_dedup ON _a2app_tasks (dedup)"],
    },
    {
      name: C_EVENTS,
      fields: [
        idField(),
        { name: "seq", type: "number", required: true },
        { name: "type", type: "text", required: true, max: 120 },
        { name: "payload", type: "json", maxSize: 1000000 },
        { name: "created_at", type: "text", max: 40 },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_a2app_events_seq ON _a2app_events (seq)"],
    },
    {
      name: C_AUDIT,
      fields: [
        { name: "at", type: "text", max: 40 },
        { name: "credential", type: "text", max: 120 },
        { name: "agent", type: "text", max: 120 },
        { name: "principal", type: "text", max: 120 },
        { name: "target", type: "text", max: 200 },
        { name: "record", type: "text", max: 120 },
        { name: "outcome", type: "text", max: 20 },
        { name: "code", type: "text", max: 80 },
      ],
      indexes: [],
    },
  ];
  for (var i = 0; i < specs.length; i++) {
    var s = specs[i];
    var existing = null;
    try {
      existing = a.findCollectionByNameOrId(s.name);
    } catch (_e) {
      existing = null;
    }
    if (existing) continue;
    a.save(
      new Collection({
        type: "base",
        name: s.name,
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: s.fields,
        indexes: s.indexes,
      }),
    );
  }
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return prefix + "_" + $security.randomStringWithAlphabet(16, "abcdefghijklmnopqrstuvwxyz0123456789");
}

/* ---- key/value (grants, idempotency keys, approvals) ---- */

function kvGet(kind, key) {
  try {
    var r = $app.findFirstRecordByFilter(C_KV, "kind = {:k} && key = {:key}", { k: kind, key: key });
    var exp = r.getFloat("expires");
    if (exp > 0 && exp < Date.now()) return null;
    return { record: r, value: JSON.parse(r.getString("value") || "null") };
  } catch (_e) {
    return null;
  }
}

function kvPut(kind, key, value, ttlMs) {
  var col = collectionOr(C_KV);
  if (!col) return;
  var r = null;
  try {
    r = $app.findFirstRecordByFilter(C_KV, "kind = {:k} && key = {:key}", { k: kind, key: key });
  } catch (_e) {
    r = new Record(col);
    r.set("kind", kind);
    r.set("key", key);
  }
  r.set("value", value);
  r.set("expires", ttlMs ? Date.now() + ttlMs : 0);
  $app.save(r);
}

function kvDelete(kind, key) {
  try {
    $app.delete($app.findFirstRecordByFilter(C_KV, "kind = {:k} && key = {:key}", { k: kind, key: key }));
    return true;
  } catch (_e) {
    return false;
  }
}

/* ---- grants ---- */

/**
 * The credential behind a token. The local grant comes from the app's
 * `.agent-token` (minted by `agent-app scaffold`/`import`): full scopes, as the
 * owner. A host may add narrower grants with `putGrant`; they are stored by the
 * SHA-256 of their token, never the token itself.
 */
function grantByToken(d, token) {
  if (!token) return null;
  // A grant a host registered for this token wins: it names the credential.
  var hit = kvGet("grant", $security.sha256(token));
  if (hit && hit.value) {
    var g = hit.value;
    return { credentialId: g.credentialId, agentName: g.agentName || null, principal: g.principal || "owner", scopes: Array.isArray(g.scopes) ? Array.from(g.scopes) : [] };
  }
  if (d.localToken !== "" && $security.equal(token, d.localToken)) {
    return { credentialId: "cred_local", agentName: null, principal: "owner", scopes: ["*"] };
  }
  return null;
}

function putGrant(grant) {
  if (!grant || typeof grant.token !== "string" || grant.token === "") throw new Error("putGrant: a token is required");
  ensureState($app);
  kvPut("grant", $security.sha256(grant.token), {
    credentialId: String(grant.credentialId || "cred_" + $security.sha256(grant.token).slice(0, 8)),
    agentName: grant.agentName ? String(grant.agentName) : null,
    principal: String(grant.principal || "owner"),
    scopes: Array.isArray(grant.scopes) ? grant.scopes.map(String) : ["*"],
  });
}

function presentedToken(e) {
  return headerOf(e, "X-A2App-Token") || headerOf(e, "X-LUI-Token");
}

/* ---- audit ---- */

function writeAudit(ctx, target, recordId, outcome, code) {
  try {
    var col = collectionOr(C_AUDIT);
    if (!col) return;
    var r = new Record(col);
    r.set("at", nowIso());
    r.set("credential", ctx && ctx.credentialId ? String(ctx.credentialId).slice(0, 120) : "");
    r.set("agent", ctx && ctx.agentName ? String(ctx.agentName).slice(0, 120) : "");
    r.set("principal", ctx && ctx.principal ? String(ctx.principal).slice(0, 120) : "");
    r.set("target", String(target).slice(0, 200));
    r.set("record", recordId ? String(recordId).slice(0, 120) : "");
    r.set("outcome", outcome);
    r.set("code", code ? String(code).slice(0, 80) : "");
    $app.save(r);
  } catch (_e) {
    /* the audit log never blocks the request it records */
  }
}

/* ---- data version + viewers ---- */

function bootMark() {
  var store = $app.store();
  var mark = store.get("a2app.boot");
  if (!mark) {
    mark = Date.now().toString(36);
    store.set("a2app.boot", mark);
  }
  return mark;
}

function markDataChanged() {
  var store = $app.store();
  store.set("a2app.writes", (Number(store.get("a2app.writes")) || 0) + 1);
}

function dataVersion() {
  return bootMark() + "." + String(Number($app.store().get("a2app.writes")) || 0);
}

function noteViewer(e) {
  var q = queryOf(e);
  var id = headerOf(e, "X-A2App-Viewer") || String(q["viewer"] || "");
  if (id === "" || id.length > 64) return;
  var store = $app.store();
  var viewers = store.get("a2app.viewers") || {};
  if (headerOf(e, "X-A2App-Viewer-Leaving") !== "" || q["leaving"] !== undefined) {
    delete viewers[id];
  } else {
    viewers[id] = Date.now();
  }
  store.set("a2app.viewers", viewers);
}

function countViewers() {
  var store = $app.store();
  var viewers = store.get("a2app.viewers") || {};
  var cutoff = Date.now() - VIEWER_TTL_MS;
  var live = 0;
  var kept = {};
  var keys = Object.keys(viewers);
  for (var i = 0; i < keys.length; i++) {
    if (viewers[keys[i]] >= cutoff) {
      kept[keys[i]] = viewers[keys[i]];
      live++;
    }
  }
  store.set("a2app.viewers", kept);
  return live;
}

/* ---- rate limits ---- */

function rateGate(e, cls) {
  var limits = C().DEFAULT_RATE_LIMITS;
  var limit = cls === "ops" ? limits.ops : limits.data;
  var token = presentedToken(e);
  var origin = headerOf(e, "Origin");
  var caller = token ? "t:" + $security.sha256(token).slice(0, 16) : origin ? "o:" + origin : "anon";
  var store = $app.store();
  var key = "a2app.rate." + cls;
  var now = Date.now();
  var state = store.get(key);
  if (!state || now - state.window >= limits.windowMs) state = { window: now, counts: {} };
  var used = (Number(state.counts[caller]) || 0) + 1;
  state.counts[caller] = used;
  store.set(key, state);
  if (used <= limit) return null;
  var retry = Math.max(1, Math.ceil((state.window + limits.windowMs - now) / 1000));
  writeAudit({ credentialId: caller, agentName: null, principal: null }, "rate:" + cls, null, "rejected", "rate_limited");
  return err(429, "rate_limited", "Rate limit exceeded (" + limit + " per window). Slow down and retry.", { retryAfterSeconds: retry });
}

/* ================================================================= identity */

function identityDoc(d) {
  var core = C();
  var binding = makeBinding(d);
  var doc = {
    a2app: true,
    protocol: PROTOCOL_VERSION,
    adapterVersion: ADAPTER_VERSION,
    app: { id: d.appId, name: d.appName },
    schemaVersion: schemaVersion(core, d, binding),
    dataVersion: dataVersion(),
    serverNow: nowIso(),
    serverTzOffsetMinutes: -new Date().getTimezoneOffset(),
  };
  var env = "";
  try {
    env = String($os.getenv("A2APP_ENV") || "");
  } catch (_e) {
    env = "";
  }
  if (env !== "") doc.env = env;
  var view = viewVersion();
  if (view !== "") doc.appVersion = view;
  return doc;
}

function schemaVersion(core, d, binding) {
  var defs = binding.entities();
  var prints = {};
  var names = Object.keys(defs);
  for (var i = 0; i < names.length; i++) {
    var def = defs[names[i]];
    prints[names[i]] = { fields: def.fields, module: def.module };
    if (def.auth) prints[names[i]].auth = true;
  }
  return core.schemaFingerprint(prints, d.operations);
}

/**
 * A fingerprint of the View the server is serving (its `index.html`, which
 * names every content-hashed asset), so an update watcher can tell a code change
 * from a data change. `pb-serve.mjs` passes the served directory.
 */
function viewVersion() {
  var dir = "";
  try {
    dir = String($os.getenv("A2APP_PUBLIC_DIR") || "");
  } catch (_e) {
    dir = "";
  }
  if (dir === "") dir = $filepath.join(appRoot(), "pb", "pb_public");
  var file = $filepath.join(dir, "index.html");
  var key = "";
  try {
    var st = $os.stat(file);
    key = file + ":" + String(st.size()) + ":" + String(st.modTime().unixMilli());
  } catch (_e) {
    return "";
  }
  var store = $app.store();
  var cached = store.get("a2app.view");
  if (cached && cached.key === key) return cached.version;
  var version = "";
  try {
    version = "av_" + $security.sha256(toString($os.readFile(file))).slice(0, 16);
  } catch (_e) {
    version = "";
  }
  store.set("a2app.view", { key: key, version: version });
  return version;
}

/* ====================================================================== IAM */

function expandScopes(grant, binding, d) {
  if (grant.scopes.indexOf("*") < 0) return grant.scopes.slice();
  var scopes = [];
  var names = Object.keys(binding.entities());
  for (var i = 0; i < names.length; i++) {
    scopes.push("data:" + names[i] + ":read");
    scopes.push("data:" + names[i] + ":write");
  }
  for (var j = 0; j < d.operations.length; j++) scopes.push("op:" + d.operations[j].name);
  return scopes;
}

/** A PocketBase principal the backend already authenticated (a signed-in user
 *  of a multi-user app, or a superuser): the backend's own rules govern it. */
function pbPrincipal(e) {
  try {
    if (!e.auth) return null;
    return { credentialId: "pb:" + e.auth.collection().name + ":" + e.auth.id, agentName: null, principal: e.auth.id };
  } catch (_e) {
    return null;
  }
}

/**
 * The fixed chain: origin → credential → scope. Returns `{ ctx }` or `{ reply }`.
 * Mirrors the reference `authorize`, plus PocketBase's own principals.
 */
function authorize(e, d, binding, opts) {
  var core = C();
  if (isForeignOrigin(e)) return { reply: err(403, "forbidden_origin", "Refused: request Origin is not this app's own.") };
  if (isView(e)) return { ctx: { credentialId: "ui", agentName: null, principal: "owner" } };
  var grant = grantByToken(d, presentedToken(e));
  if (!grant) {
    var pb = pbPrincipal(e);
    if (pb) return { ctx: pb };
    var credentialRequired = opts.isWrite || d.authMode === "multi-user";
    if (credentialRequired) {
      return {
        reply: err(401, core.ERROR_CODES.AGENT_TOKEN_REQUIRED, "This call requires an agent credential.", {
          how: core.AGENT_TEXT.credentialHint,
        }),
      };
    }
    return { ctx: { credentialId: "anonymous", agentName: null, principal: "owner" } };
  }
  if (opts.scope) {
    var held = expandScopes(grant, binding, d);
    if (held.indexOf(opts.scope) < 0) {
      return {
        reply: err(403, core.ERROR_CODES.INSUFFICIENT_SCOPE, "This credential does not hold " + opts.scope + ".", { required: opts.scope }),
      };
    }
  }
  var agent = headerOf(e, "X-A2App-Agent") || headerOf(e, "X-LUI-Agent");
  return { ctx: { credentialId: grant.credentialId, agentName: agent ? agent.slice(0, 120) : grant.agentName, principal: grant.principal } };
}

function anonymousAccess(d) {
  return {
    canRead: function () {
      return true;
    },
    canWrite: function () {
      return false;
    },
    canRun: function (operation) {
      for (var i = 0; i < d.operations.length; i++) if (d.operations[i].name === operation) return d.operations[i].readOnly === true;
      return false;
    },
  };
}

function accessFor(e, d, binding) {
  var core = C();
  if (isView(e)) return core.FULL_ACCESS;
  var grant = grantByToken(d, presentedToken(e));
  if (!grant) {
    if (pbPrincipal(e)) return core.FULL_ACCESS;
    return d.authMode === "multi-user" ? core.NO_ACCESS : anonymousAccess(d);
  }
  var held = expandScopes(grant, binding, d);
  return {
    canRead: function (entity) {
      return held.indexOf("data:" + entity + ":read") >= 0;
    },
    canWrite: function (entity) {
      return held.indexOf("data:" + entity + ":write") >= 0;
    },
    canRun: function (operation) {
      return held.indexOf("op:" + operation) >= 0;
    },
  };
}

function reachAsScopes(access, binding, d) {
  var scopes = [];
  var names = Object.keys(binding.entities());
  for (var i = 0; i < names.length; i++) {
    if (access.canRead(names[i])) scopes.push("data:" + names[i] + ":read");
    if (access.canWrite(names[i])) scopes.push("data:" + names[i] + ":write");
  }
  for (var j = 0; j < d.operations.length; j++) if (access.canRun(d.operations[j].name)) scopes.push("op:" + d.operations[j].name);
  return scopes;
}

/**
 * Act as the app's superuser for a request carrying a valid agent credential, so
 * PocketBase's collection rules treat the agent as the app's operator — the same
 * standing an agent has always had on these apps.
 */
function actAsOperator(e, d) {
  try {
    if (e.auth) return;
    var su = null;
    if (d.superuserEmail !== "") {
      try {
        su = $app.findAuthRecordByEmail("_superusers", d.superuserEmail);
      } catch (_e) {
        su = null;
      }
    }
    if (!su) {
      var rows = $app.findRecordsByFilter("_superusers", "", "created", 1, 0);
      su = rows && rows.length ? rows[0] : null;
    }
    if (su) e.auth = su;
  } catch (_e) {
    /* no superuser: PocketBase's rules apply as for any caller */
  }
}

/* =============================================================== middleware */

/**
 * The front face. Registered with routerUse, so it sees every request first:
 * host check, framing policy, then the A2App chain for record and operation
 * calls from agents and programs. Everything else continues to the app.
 */
function middleware(e) {
  var path = pathOf(e);
  if (!isAllowedHost(hostOf(e))) {
    return e.json(403, {
      a2app: true,
      ok: false,
      code: "forbidden_host",
      message: 'Refused: this app answers only on its own host, not "' + hostOf(e) + '".',
    });
  }

  // Framing: harnesses embed apps (iframe panels on their own local port), and
  // PocketBase's default X-Frame-Options: SAMEORIGIN would blank those panels.
  // Name who may frame the app instead. Headers must be set before e.next().
  try {
    var headers = e.response.header();
    headers.del("X-Frame-Options");
    headers.set("Content-Security-Policy", "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*");
  } catch (_e) {
    /* header plumbing unavailable — nothing to change */
  }

  var rec = RECORDS_PATH.exec(path);
  if (rec) return recordsChain(e, decodeURIComponent(rec[1]), rec[2] ? decodeURIComponent(rec[2]) : null);

  var opm = OPS_PATH.exec(path);
  if (opm && methodOf(e) === "POST") {
    var d = decl();
    var name = decodeURIComponent(opm[1]);
    for (var i = 0; i < d.operations.length; i++) {
      if (d.operations[i].name === name) return opsChain(e, d, d.operations[i]);
    }
  }

  // A credentialled agent call to any other path (the app's own routes, files,
  // realtime) acts as the app's operator, as it does on the protocol paths.
  var token = presentedToken(e);
  if (token !== "") {
    var d2 = decl();
    if (grantByToken(d2, token)) actAsOperator(e, d2);
  }
  return e.next();
}

/* ================================================================== records */

function recordsChain(e, entity, recordId) {
  if (isForeignOrigin(e)) {
    return e.json(403, { a2app: true, ok: false, code: "forbidden_origin", message: "Refused: request Origin is not this app's own." });
  }
  // The app's own View talks to PocketBase as it always has.
  if (isView(e)) return e.next();

  var core = C();
  var d = decl();
  var binding = makeBinding(d);
  var method = methodOf(e);
  var limited = rateGate(e, "data");
  if (limited) return send(e, limited);

  var defs = binding.entities();
  var def = defs[entity];
  if (!def) return send(e, err(404, "unknown_entity", 'No such entity "' + entity + '".'));

  if (method === "GET" || method === "HEAD") {
    var r = authorize(e, d, binding, { scope: "data:" + entity + ":read", isWrite: false });
    if (r.reply) return send(e, r.reply);
    if (grantByToken(d, presentedToken(e))) actAsOperator(e, d);
    if (recordId !== null) {
      // PocketBase's own 404 carries no machine code.
      try {
        $app.findRecordById(entity, recordId);
      } catch (_e) {
        return send(e, err(404, "record_not_found", "No " + entity + ' record "' + recordId + '".'));
      }
    }
    return e.next();
  }

  var authz = authorize(e, d, binding, { scope: "data:" + entity + ":write", isWrite: true });
  if (authz.reply) {
    writeAudit(null, "data:" + entity, recordId, "rejected", authz.reply.json.code);
    return send(e, authz.reply);
  }
  var ctx = authz.ctx;
  if (grantByToken(d, presentedToken(e))) actAsOperator(e, d);

  if (method === "DELETE") {
    if (recordId === null) return send(e, err(400, "usage", "DELETE requires a record id."));
    var target = null;
    try {
      target = $app.findRecordById(entity, recordId);
    } catch (_e) {
      target = null;
    }
    if (!target) return send(e, err(404, "record_not_found", "No " + entity + ' record "' + recordId + '".'));
    var blockers = referencesTo(defs, entity, recordId);
    if (blockers.length > 0) {
      var total = 0;
      for (var b = 0; b < blockers.length; b++) total += blockers[b].ids.length;
      var where = blockers
        .map(function (x) {
          return x.entity + "." + x.field;
        })
        .join(", ");
      writeAudit(ctx, "data:" + entity, recordId, "rejected", core.ERROR_CODES.RECORD_REFERENCED);
      return send(
        e,
        err(
          409,
          core.ERROR_CODES.RECORD_REFERENCED,
          "Cannot delete " + entity + ' "' + recordId + '": ' + (total === 1 ? "a record still references" : total + " records still reference") + " it (" + where + ").",
          {
            referencedBy: blockers,
            resolution:
              "Remove or repoint the referencing records first, or run an operation the app provides for this. " +
              'An app that intends references to outlive the record declares `onDelete: "ignore"` on the ref.',
          },
        ),
      );
    }
    // The delete hook answers the protocol's envelope instead of PocketBase's 204.
    e.set("a2app.delete", { entity: entity, id: recordId, ctx: ctx });
    return e.next();
  }

  if (method !== "POST" && method !== "PATCH") return send(e, err(405, "usage", method + " not allowed on records."));
  if (method === "PATCH" && recordId === null) return send(e, err(400, "usage", "PATCH requires a record id."));

  var body = bodyOf(e);
  var idemKey = headerOf(e, "Idempotency-Key");
  var idemScope = method === "PATCH" ? entity + "#" + recordId : entity;
  if (idemKey !== "") {
    var prior = kvGet("idem", idemScope + "|" + idemKey);
    if (prior && prior.value) {
      return send(e, err(409, core.ERROR_CODES.DUPLICATE_REQUEST, "This idempotency key was already applied.", { id: prior.value.recordId }));
    }
  }

  var allow = Object.create(null);
  var wa = def.writeAllow || [];
  for (var w = 0; w < wa.length; w++) allow[wa[w]] = true;
  var violations = core.validate(def.fields, body, { allow: allow, requireRequired: method === "POST" });
  if (violations.length) {
    writeAudit(ctx, "data:" + entity, recordId, "rejected", violations[0].code);
    return send(e, guardEnvelope(violations, nowIso()));
  }
  e.set("a2app.write", { entity: entity, body: body, idemKey: idemKey, idemScope: idemScope, ctx: ctx });
  return e.next();
}

/**
 * Who still points at this record — every `ref`/`list<ref>` in the model that
 * targets it with the default `restrict` policy, up to a few example ids each.
 */
function referencesTo(defs, entity, id) {
  var core = C();
  var blockers = [];
  var names = Object.keys(defs);
  for (var i = 0; i < names.length; i++) {
    var fields = defs[names[i]].fields;
    for (var j = 0; j < fields.length; j++) {
      var f = fields[j];
      if ((f.type !== "ref" && f.type !== "list<ref>") || f.entity !== entity || core.onDeleteOf(f) !== "restrict") continue;
      var rows = [];
      try {
        rows = $app.findRecordsByFilter(names[i], f.type === "ref" ? f.name + " = {:id}" : f.name + " ?= {:id}", "", REFERENCE_SCAN_LIMIT, 0, { id: id });
      } catch (_e) {
        rows = [];
      }
      if (rows && rows.length) {
        blockers.push({
          entity: names[i],
          field: f.name,
          ids: Array.from(rows).map(function (x) {
            return x.id;
          }),
        });
      }
    }
  }
  return blockers;
}

/** onRecordCreateRequest / onRecordUpdateRequest: record what landed. */
function afterWrite(e) {
  var stash = null;
  try {
    stash = e.requestEvent ? e.requestEvent.get("a2app.write") : null;
  } catch (_e) {
    stash = null;
  }
  e.next();
  if (!stash) return;
  try {
    var core = C();
    var d = decl();
    var def = makeBinding(d).entities()[stash.entity];
    var stored = plain(e.record);
    if (def) {
      var lost = core.divergences(def.fields, stash.body, function (name) {
        return stored[name];
      });
      if (lost.length) writeAudit(stash.ctx, "data:" + stash.entity, e.record.id, "rejected", core.ERROR_CODES.NOT_STORED);
    }
    if (stash.idemKey) kvPut("idem", stash.idemScope + "|" + stash.idemKey, { recordId: e.record.id }, IDEMPOTENCY_TTL_MS);
    writeAudit(stash.ctx, "data:" + stash.entity, e.record.id, "ok");
  } catch (_e) {
    /* bookkeeping after a stored write never turns it into a failure */
  }
}

/** onRecordDeleteRequest: answer an agent delete with the protocol envelope. */
function deleteHook(e) {
  var stash = null;
  try {
    stash = e.requestEvent ? e.requestEvent.get("a2app.delete") : null;
  } catch (_e) {
    stash = null;
  }
  if (!stash) return e.next();
  var id = e.record.id;
  e.app.delete(e.record);
  writeAudit(stash.ctx, "data:" + stash.entity, id, "ok");
  return e.json(200, { a2app: true, ok: true, deleted: id });
}

/* =============================================================== operations */

function paramFields(op) {
  var out = [];
  var params = op.params || {};
  var names = Object.keys(params);
  for (var i = 0; i < names.length; i++) {
    var p = params[names[i]] || {};
    var f = { name: names[i], type: p.type };
    if (p.required !== undefined) f.required = p.required;
    if (p.max !== undefined) f.max = p.max;
    if (p.values !== undefined) f.values = p.values;
    if (p.entity !== undefined) f.entity = p.entity;
    out.push(f);
  }
  return out;
}

/**
 * Everything before the work: rate, credential + scope, the argument guard,
 * idempotency, approval. Returns `{ reply }` to refuse, or `{ state }`.
 */
function preflight(e, d, op) {
  var core = C();
  var binding = makeBinding(d);
  var limited = rateGate(e, "ops");
  if (limited) return { reply: limited };
  var authz = authorize(e, d, binding, { scope: "op:" + op.name, isWrite: op.readOnly !== true });
  if (authz.reply) return { reply: authz.reply };
  var ctx = authz.ctx;
  var args = bodyOf(e);

  var violations = core.validate(paramFields(op), args, { requireRequired: true });
  if (violations.length) {
    writeAudit(ctx, "op:" + op.name, null, "rejected", violations[0].code);
    return { reply: guardEnvelope(violations, nowIso()) };
  }

  var idemKey = headerOf(e, "Idempotency-Key");
  if (idemKey !== "") {
    var prior = kvGet("idem", "op:" + op.name + "|" + idemKey);
    if (prior && prior.value) {
      return { reply: err(409, core.ERROR_CODES.DUPLICATE_REQUEST, "This idempotency key already ran this operation.", { operation: op.name }) };
    }
  }

  if (op.destructive) {
    var key = core.approvalKey(op.name, args);
    var provided = headerOf(e, "X-A2App-Approval") || headerOf(e, "X-LUI-Approval");
    if (provided === "") {
      kvPut("approval", key, { operation: op.name }, APPROVAL_TTL_MS);
      return { reply: err(428, core.ERROR_CODES.APPROVAL_REQUIRED, 'Operation "' + op.name + '" is destructive and requires approval.', { approvalKey: key }) };
    }
    var issued = provided === key ? kvGet("approval", key) : null;
    if (!issued) {
      return { reply: err(428, core.ERROR_CODES.APPROVAL_REQUIRED, "Approval key does not match this exact call (or has expired).", { approvalKey: key }) };
    }
    kvDelete("approval", key);
  }
  if (grantByToken(d, presentedToken(e))) actAsOperator(e, d);
  return { state: { name: op.name, args: args, ctx: ctx, idemKey: idemKey, readOnly: op.readOnly === true } };
}

function opsChain(e, d, op) {
  var pre = preflight(e, d, op);
  if (pre.reply) return send(e, pre.reply);
  e.set("a2app.op", pre.state);
  return e.next();
}

function statusOfError(thrown) {
  if (thrown && typeof thrown.status === "number") return thrown.status;
  try {
    var s = thrown && thrown.value ? thrown.value.status : undefined;
    if (typeof s === "number" && s >= 400 && s < 600) return s;
  } catch (_e) {
    return 500;
  }
  return 500;
}

function codeForStatus(status) {
  if (status === 404) return "not_found";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "operation_failed";
  return "rejected";
}

/**
 * A handler written for the app's own GET route reads its input from the query
 * string, but through POST /api/ops/<name> the call's parameters arrive in the
 * body. Copy each scalar argument into the request's (cached) query map where
 * the query does not already carry it, so a query-reading handler sees the
 * same input it would have been sent directly. Handlers that read the body, or
 * merge both, are unaffected.
 */
function mirrorArgsToQuery(e, args) {
  if (!args || typeof args !== "object") return;
  try {
    var info = e.requestInfo();
    if (!info || !info.query) return;
    for (var k in args) {
      if (!Object.prototype.hasOwnProperty.call(args, k)) continue;
      var v = args[k];
      if (v === null || v === undefined || typeof v === "object") continue;
      var have = info.query[k];
      if (have === undefined || have === null || have === "") info.query[k] = String(v);
    }
  } catch (_e) {
    /* best effort: the handler still has the body */
  }
}
/**
 * Run a declared operation's work and answer with the protocol envelope.
 *
 *   routerAdd("POST", "/api/ops/<name>", (e) =>
 *     require(`${__hooks}/_a2app_impl.js`).op(e, "<name>", (ev, args, ctx) => ({ ...result })))
 *
 * `fn(ev, args, ctx)` either RETURNS the result, or answers through
 * `ev.json(status, body)` the way any PocketBase route handler does — which is
 * how an existing handler is reused unchanged: its 2xx body becomes `result`,
 * its error body becomes the refusal. A non-JSON answer (a file download) is
 * passed through as the handler wrote it.
 */
function op(e, name, fn) {
  var state = null;
  try {
    state = e.get("a2app.op");
  } catch (_e) {
    state = null;
  }
  if (!state || state.name !== name) {
    var d = decl();
    var declared = null;
    for (var i = 0; i < d.operations.length; i++) if (d.operations[i].name === name) declared = d.operations[i];
    if (!declared) return send(e, err(404, "unknown_operation", 'No declared operation "' + name + '".'));
    var pre = preflight(e, d, declared);
    if (pre.reply) return send(e, pre.reply);
    state = pre.state;
  }

  var captured = null;
  var passthrough = false;
  var shim = Object.create(e);
  shim.json = function (status, body) {
    captured = { status: status, body: body };
    return null;
  };
  var writers = ["string", "html", "blob", "noContent", "redirect", "stream", "file", "fileFS", "xml"];
  for (var w = 0; w < writers.length; w++) {
    (function (m) {
      var real = null;
      try {
        real = e[m];
      } catch (_e) {
        real = null;
      }
      if (typeof real !== "function") return;
      shim[m] = function () {
        passthrough = true;
        return real.apply(e, arguments);
      };
    })(writers[w]);
  }

  mirrorArgsToQuery(e, state.args);

  var returned;
  try {
    returned = fn(shim, state.args, state.ctx);
  } catch (thrown) {
    var status = statusOfError(thrown);
    var data = thrown && thrown.extra !== undefined ? thrown.extra : undefined;
    var message = String((thrown && thrown.message) || thrown);
    var code = status >= 500 ? "operation_failed" : data && typeof data.code === "string" ? data.code : codeForStatus(status);
    writeAudit(state.ctx, "op:" + name, null, "rejected", code);
    if (status >= 500) console.error("[a2app] operation " + name + " failed: " + message);
    var extra = { operation: name };
    if (data !== undefined) extra.data = data;
    return send(e, err(status, code, status >= 500 ? 'Operation "' + name + '" failed: ' + message : message, extra));
  }
  if (passthrough) {
    if (!state.readOnly) markDataChanged();
    writeAudit(state.ctx, "op:" + name, null, "ok");
    return returned;
  }
  if (captured === null) captured = { status: 200, body: returned === undefined ? null : returned };

  var st = Number(captured.status) || 200;
  if (st >= 200 && st < 300) {
    if (state.idemKey) kvPut("idem", "op:" + name + "|" + state.idemKey, { recordId: name }, IDEMPOTENCY_TTL_MS);
    if (!state.readOnly) markDataChanged();
    writeAudit(state.ctx, "op:" + name, null, "ok");
    return e.json(200, { a2app: true, ok: true, operation: name, result: captured.body === undefined ? null : captured.body });
  }
  var b = captured.body && typeof captured.body === "object" ? captured.body : {};
  var refusal = typeof b.code === "string" ? b.code : b.data && typeof b.data.code === "string" ? b.data.code : codeForStatus(st);
  var msg = typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : 'Operation "' + name + '" was refused.';
  var out = { a2app: true, ok: false, code: refusal, message: msg, operation: name };
  if (b.data !== undefined) out.data = b.data;
  writeAudit(state.ctx, "op:" + name, null, "rejected", refusal);
  return e.json(st, out);
}

/** The catch-all `POST /api/ops/{name}`: an app route that is more specific wins. */
function opFallback(e) {
  var name = "";
  try {
    name = String(e.request.pathValue("name") || "");
  } catch (_e) {
    name = "";
  }
  var d = decl();
  for (var i = 0; i < d.operations.length; i++) {
    if (d.operations[i].name === name) {
      return send(e, err(501, "not_implemented", 'This app declares "' + name + '" but implements no route for it.'));
    }
  }
  return send(e, err(404, "unknown_operation", 'No declared operation "' + name + '".'));
}

/* ================================================================= describe */

function describe(e, segments) {
  var core = C();
  var d = decl();
  var binding = makeBinding(d);
  if (isForeignOrigin(e)) return send(e, err(403, "forbidden_origin", "Refused: request Origin is not this app's own."));
  var deps = describeDeps(d, binding);
  var problems = d.problems.concat(core.modelProblems(deps));
  if (problems.length) {
    return send(e, err(500, "inconsistent_app_part", "The app's declarations are inconsistent and cannot be served.", { problems: problems }));
  }
  var access = accessFor(e, d, binding);
  var q = queryOf(e);
  var all = q["all"] === "true";

  if (q["find"] !== undefined && segments.length === 0) {
    if (q["find"] === "") return send(e, err(400, "usage", "find needs a term: describe?find={term}"));
    return e.json(200, core.buildFind(deps, String(q["find"]), access));
  }
  if (segments.length === 0) return e.json(200, core.buildRoot(deps, access, { all: all }));

  var moduleName = segments[0];
  var entityName = segments[1];
  var recordId = segments[2];
  var relationName = segments[3];
  var module = null;
  for (var i = 0; i < d.modules.length; i++) if (d.modules[i].name === moduleName) module = d.modules[i];
  if (!module) {
    return send(
      e,
      err(404, "unknown_module", 'No module "' + moduleName + '".', {
        modules: d.modules.map(function (m) {
          return m.name;
        }),
      }),
    );
  }
  if (entityName === undefined) return e.json(200, core.buildModule(deps, module, access, { all: all }));

  var defs = binding.entities();
  var def = defs[entityName];
  if (!def) return send(e, err(404, "unknown_entity", 'No such entity "' + entityName + '".'));
  if (def.module !== moduleName) {
    return send(e, err(404, "unknown_entity", 'Entity "' + entityName + '" is in module "' + def.module + '", not "' + moduleName + '".'));
  }
  if (recordId === undefined) {
    if (!access.canRead(entityName)) {
      return send(e, err(403, core.ERROR_CODES.INSUFFICIENT_SCOPE, "This credential does not hold data:" + entityName + ":read.", { required: "data:" + entityName + ":read" }));
    }
    return e.json(200, core.buildEntity(deps, moduleName, entityName, def, access, { all: all }));
  }

  var limited = rateGate(e, "data");
  if (limited) return send(e, limited);
  var authz = authorize(e, d, binding, { scope: "data:" + entityName + ":read", isWrite: false });
  if (authz.reply) return send(e, authz.reply);

  var record = readableRecord(e, d, entityName, recordId);
  if (!record) return send(e, err(404, "record_not_found", "No " + entityName + ' record "' + recordId + '".'));
  if (relationName === undefined) return e.json(200, core.buildRecord(deps, moduleName, entityName, def, record, access));

  var relationField = null;
  for (var r = 0; r < def.fields.length; r++) {
    var f = def.fields[r];
    if (f.name === relationName && f.type === "list<ref>" && f.entity !== undefined && !f.writeOnly) relationField = f;
  }
  if (!relationField) {
    return send(
      e,
      err(404, "unknown_relation", '"' + relationName + '" is not a sub-resource of ' + entityName + ".", {
        relations: def.fields
          .filter(function (x) {
            return x.type === "list<ref>" && !x.writeOnly;
          })
          .map(function (x) {
            return x.name;
          }),
      }),
    );
  }
  var target = relationField.entity;
  if (!access.canRead(target)) {
    return send(e, err(403, core.ERROR_CODES.INSUFFICIENT_SCOPE, "This credential does not hold data:" + target + ":read.", { required: "data:" + target + ":read" }));
  }
  var targetDef = defs[target];
  var targetLabel = targetDef ? core.labelFieldOf(targetDef.fields) : null;
  var ids = record[relationName];
  var rows = [];
  var list = Array.isArray(ids) ? ids : [];
  for (var k = 0; k < list.length; k++) {
    var referenced = readableRecord(e, d, target, String(list[k]));
    var label = referenced && targetLabel !== null ? referenced[targetLabel] : null;
    rows.push({ id: String(list[k]), label: typeof label === "string" ? label : label == null ? null : String(label) });
  }
  return e.json(200, core.buildRelation(moduleName, entityName, recordId, relationName, target, rows));
}

/**
 * A stored record, as this caller may read it. Describe's record and relation
 * levels publish record values, so they honour the collection's view rule
 * exactly as the records API would — except for the app's operator (a valid
 * agent credential) and the app's own View, which read as they always could.
 */
function readableRecord(e, d, entity, id) {
  var rec = null;
  try {
    rec = $app.findRecordById(entity, id);
  } catch (_e) {
    return null;
  }
  if (!isView(e) && !grantByToken(d, presentedToken(e))) {
    try {
      var rule = rec.collection().viewRule;
      var isSuper = e.auth && e.auth.isSuperuser();
      if (!isSuper && (rule === null || !$app.canAccessRecord(rec, e.requestInfo(), rule))) return null;
    } catch (_e) {
      return null;
    }
  }
  return plain(rec);
}

/* ========================================================== identity routes */

function identity(e) {
  noteViewer(e);
  return e.json(200, identityDoc(decl()));
}

function whoami(e) {
  var d = decl();
  var binding = makeBinding(d);
  var authz = authorize(e, d, binding, { scope: null, isWrite: false });
  if (authz.reply) return send(e, authz.reply);
  var grant = grantByToken(d, presentedToken(e));
  var scopes = grant ? expandScopes(grant, binding, d) : reachAsScopes(accessFor(e, d, binding), binding, d);
  scopes.sort();
  return e.json(200, {
    a2app: true,
    credentialId: authz.ctx.credentialId,
    agentName: authz.ctx.agentName,
    principal: authz.ctx.principal,
    scopes: scopes,
  });
}

function viewers(e) {
  var d = decl();
  var authz = authorize(e, d, makeBinding(d), { scope: null, isWrite: false });
  if (authz.reply) return send(e, authz.reply);
  return e.json(200, { a2app: true, viewers: countViewers(), ttlMs: VIEWER_TTL_MS });
}

/**
 * What the person is looking at, as ids. The View publishes it (an app route
 * calls `setContext`); the agent reads it at /api/_a2app/context.
 */
function setContext(view, selected) {
  var sel = [];
  var list = Array.isArray(selected) ? selected : [];
  for (var i = 0; i < list.length && i < 50; i++) {
    var s = list[i] || {};
    if (typeof s.entity === "string" && s.id !== undefined && s.id !== null && s.id !== "") sel.push({ entity: s.entity, id: String(s.id) });
  }
  $app.store().set("a2app.context", { view: typeof view === "string" && view !== "" ? view.slice(0, 120) : null, selected: sel, at: Date.now() });
}

function context(e) {
  var d = decl();
  var authz = authorize(e, d, makeBinding(d), { scope: null, isWrite: false });
  if (authz.reply) return send(e, authz.reply);
  var c = $app.store().get("a2app.context") || { view: null, selected: [] };
  return e.json(200, { a2app: true, view: c.view === undefined ? null : c.view, selected: Array.isArray(c.selected) ? Array.from(c.selected) : [] });
}

/* ============================================================ tasks / events */

function taskOf(r, appId) {
  function js(name, fallback) {
    try {
      var s = r.getString(name);
      return s === "" || s === "null" ? fallback : JSON.parse(s);
    } catch (_e) {
      return fallback;
    }
  }
  var payload = js("payload", null);
  var request = { capability: r.getString("capability") };
  if (payload !== null) request.payload = payload;
  var reason = r.getString("reason");
  return {
    id: r.id,
    app: appId,
    event: r.getString("event") || null,
    status: r.getString("status"),
    request: request,
    claim: js("claim", null),
    progress: js("progress", { step: null, percent: 0 }),
    result: js("result", null),
    reason: reason === "" ? null : reason,
    ask: js("ask", null),
    createdAt: r.getString("created_at"),
    updatedAt: r.getString("updated_at"),
  };
}

function taskWire(t) {
  var out = {
    id: t.id,
    app: t.app,
    event: t.event,
    status: t.status,
    request: t.request,
    claim: t.claim,
    progress: t.progress,
    result: t.result,
    reason: t.reason,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    pollAfterMs: 2000,
  };
  if (t.status === "input-required" && t.ask !== null) out.ask = t.ask;
  return out;
}

function touch(r) {
  var now = new Date();
  r.set("updated_at", now.toISOString());
  r.set("updated_ms", now.getTime());
}

/** Return a silent claim to the queue; fail it after too many deliveries. */
function sweep(app) {
  var a = app || $app;
  var cutoff = Date.now() - TASK_TIMEOUT_MS;
  var stale = [];
  try {
    stale = a.findRecordsByFilter(C_TASKS, "status = 'working' && updated_ms < {:cutoff}", "", 200, 0, { cutoff: cutoff });
  } catch (_e) {
    stale = [];
  }
  for (var i = 0; i < stale.length; i++) {
    var r = stale[i];
    if (r.getInt("deliveries") >= TASK_MAX_DELIVERIES) {
      r.set("status", "failed");
      r.set("reason", "redelivery_exhausted");
    } else {
      r.set("status", "submitted");
      r.set("claim", null);
      r.set("deliveries", r.getInt("deliveries") + 1);
    }
    touch(r);
    try {
      a.save(r);
    } catch (_e) {
      /* a concurrent writer moved it first */
    }
  }
}

function tasks(e) {
  var core = C();
  var d = decl();
  var binding = makeBinding(d);
  var limited = rateGate(e, "data");
  if (limited) return send(e, limited);
  var method = methodOf(e);
  var authz = authorize(e, d, binding, { scope: null, isWrite: method !== "GET" });
  if (authz.reply) return send(e, authz.reply);
  var ctx = authz.ctx;
  sweep($app);

  var rest = pathOf(e)
    .replace(/\/+$/, "")
    .slice("/api/_a2app/tasks".length)
    .split("/")
    .filter(function (s) {
      return s !== "";
    });
  if (rest.length === 0 && method === "GET") {
    var status = queryOf(e)["status"];
    var rows = [];
    try {
      rows = status
        ? $app.findRecordsByFilter(C_TASKS, "status = {:s}", "created_at", 500, 0, { s: String(status) })
        : $app.findRecordsByFilter(C_TASKS, "", "created_at", 500, 0);
    } catch (_e) {
      rows = [];
    }
    return e.json(200, {
      a2app: true,
      tasks: Array.from(rows).map(function (x) {
        return taskWire(taskOf(x, d.appId));
      }),
      pollAfterMs: 2000,
    });
  }
  var taskId = rest[0];
  if (!taskId) return send(e, err(400, "usage", "Task id required."));
  var action = rest[1];
  var found = null;
  try {
    found = $app.findRecordById(C_TASKS, taskId);
  } catch (_e) {
    found = null;
  }
  if (!found) return send(e, err(404, core.ERROR_CODES.TASK_NOT_FOUND, 'No task "' + taskId + '".'));
  if (action === undefined && method === "GET") return e.json(200, taskWire(taskOf(found, d.appId)));
  if (method !== "POST") return send(e, err(405, "usage", method + " not allowed here."));

  var body = bodyOf(e);
  var outcome = null;
  $app.runInTransaction(function (tx) {
    var r = tx.findRecordById(C_TASKS, taskId);
    var t = taskOf(r, d.appId);
    switch (action) {
      case "claim": {
        if (t.status !== "submitted") {
          outcome = err(409, core.ERROR_CODES.TASK_NOT_CLAIMABLE, "Task " + taskId + " is " + t.status + ", not claimable.");
          return;
        }
        var requested = typeof body.agent === "string" && body.agent ? body.agent : null;
        if (requested && requested !== ctx.credentialId && requested !== ctx.agentName) {
          outcome = err(403, "principal_mismatch", "Cannot claim task " + taskId + ' as "' + requested + '": the credential presented is ' + ctx.credentialId + ".", {
            requested: requested,
            actual: ctx.credentialId,
          });
          return;
        }
        r.set("status", "working");
        r.set("claim", { credentialId: ctx.credentialId, principal: ctx.principal, claimedAt: nowIso() });
        break;
      }
      case "progress": {
        if (t.status === "canceled") {
          outcome = err(409, core.ERROR_CODES.TASK_CANCELED, "Task " + taskId + " was canceled.");
          return;
        }
        if (t.status !== "working" && t.status !== "input-required") {
          outcome = err(409, core.ERROR_CODES.TASK_NOT_CLAIMABLE, "Task " + taskId + " is " + t.status + ".");
          return;
        }
        var progress = t.progress || { step: null, percent: 0 };
        if (typeof body.step === "string") progress.step = body.step;
        if (typeof body.percent === "number") progress.percent = body.percent;
        r.set("progress", progress);
        if (body.ask !== undefined) {
          r.set("ask", body.ask);
          r.set("status", "input-required");
        } else if (t.status === "input-required") {
          r.set("status", "working");
        }
        break;
      }
      case "complete": {
        if (t.status === "canceled") {
          outcome = err(409, core.ERROR_CODES.TASK_CANCELED, "Task " + taskId + " was canceled.");
          return;
        }
        if (t.status !== "working" && t.status !== "input-required") {
          outcome = err(409, core.ERROR_CODES.TASK_NOT_CLAIMABLE, "Task " + taskId + " is " + t.status + ", not in progress.");
          return;
        }
        if (body.status === "completed") {
          r.set("status", "completed");
          r.set("result", body.result && typeof body.result === "object" ? body.result : {});
        } else if (body.status === "failed") {
          r.set("status", "failed");
          r.set("reason", typeof body.reason === "string" ? body.reason.slice(0, 200) : "unspecified");
        } else {
          outcome = err(400, "usage", 'complete requires status "completed" or "failed".');
          return;
        }
        break;
      }
      case "cancel": {
        if (t.status === "completed" || t.status === "failed" || t.status === "canceled") {
          outcome = err(409, core.ERROR_CODES.TASK_NOT_CLAIMABLE, "Task " + taskId + " already reached " + t.status + ".");
          return;
        }
        r.set("status", "canceled");
        break;
      }
      default:
        outcome = err(404, "usage", 'Unknown task action "' + action + '".');
        return;
    }
    touch(r);
    tx.save(r);
    outcome = reply(200, taskWire(taskOf(r, d.appId)));
  });
  writeAudit(ctx, "task:" + action, taskId, outcome && outcome.status === 200 ? "ok" : "rejected", outcome && outcome.json ? outcome.json.code : undefined);
  return send(e, outcome);
}

function events(e) {
  var d = decl();
  var limited = rateGate(e, "data");
  if (limited) return send(e, limited);
  var authz = authorize(e, d, makeBinding(d), { scope: null, isWrite: false });
  if (authz.reply) return send(e, authz.reply);
  var since = Number(queryOf(e)["since"] || 0) || 0;
  var rows = [];
  try {
    rows = $app.findRecordsByFilter(C_EVENTS, "seq > {:s}", "seq", 500, 0, { s: since });
  } catch (_e) {
    rows = [];
  }
  var list = Array.from(rows).map(function (x) {
    var payload = {};
    try {
      payload = JSON.parse(x.getString("payload") || "{}");
    } catch (_e) {
      payload = {};
    }
    return { seq: x.getInt("seq"), id: x.id, app: d.appId, type: x.getString("type"), payload: payload, createdAt: x.getString("created_at") };
  });
  var next = list.length ? list[list.length - 1].seq : since;
  return e.json(200, {
    a2app: true,
    events: list.map(function (x) {
      return { id: x.id, app: x.app, type: x.type, payload: x.payload, createdAt: x.createdAt };
    }),
    nextCursor: String(next),
    pollAfterMs: 3000,
  });
}

/**
 * The app asks for agent work. Emits a typed event and, with a capability,
 * queues a task for an agent to claim. Called from the app's own hooks:
 *
 *   require(`${__hooks}/_a2app_impl.js`).trigger(e.app, { type, payload, capability, dedupKey })
 *
 * When `events.json` declares event types, an undeclared type, a capability
 * outside the declared vocabulary, or a payload that does not match its declared
 * fields is refused — the set of things the app may ask for is fixed by the
 * app's own declaration. The same trigger firing twice makes one task.
 */
function trigger(app, input) {
  var core = C();
  var a = app || $app;
  var d = decl();
  var type = input && typeof input.type === "string" ? input.type : "";
  var payload = input && input.payload && typeof input.payload === "object" ? input.payload : {};
  var capability = input && typeof input.capability === "string" && input.capability !== "" ? input.capability : null;
  if (type === "") throw new Error("trigger: an event type is required");
  if (d.events.length > 0) {
    var declared = null;
    for (var i = 0; i < d.events.length; i++) if (d.events[i].type === type) declared = d.events[i];
    if (!declared) throw new Error('trigger: event type "' + type + '" is not declared in events.json');
    if (capability !== null && d.capabilities.indexOf(capability) < 0) {
      throw new Error('trigger: capability "' + capability + '" is outside the vocabulary declared in events.json');
    }
    var violations = core.validate(paramFields({ params: declared.payload }), payload, { requireRequired: true });
    if (violations.length) throw new Error("trigger: payload rejected (" + violations[0].code + " " + violations[0].field + ")");
  }
  ensureState(a);
  var eventId = newId("evt");
  var taskId = null;
  a.runInTransaction(function (tx) {
    var last = 0;
    try {
      var top = tx.findRecordsByFilter(C_EVENTS, "", "-seq", 1, 0);
      last = top && top.length ? top[0].getInt("seq") : 0;
    } catch (_e) {
      last = 0;
    }
    var ev = new Record(tx.findCollectionByNameOrId(C_EVENTS));
    ev.set("id", eventId);
    ev.set("seq", last + 1);
    ev.set("type", type);
    ev.set("payload", payload);
    ev.set("created_at", nowIso());
    tx.save(ev);

    if (capability === null) return;
    var dedup =
      input && typeof input.dedupKey === "string" && input.dedupKey !== ""
        ? input.dedupKey
        : core.sha256Prefixed(core.canonicalize({ type: type, capability: capability, payload: payload }));
    var existing = null;
    try {
      existing = tx.findFirstRecordByFilter(C_TASKS, "dedup = {:k}", { k: dedup });
    } catch (_e) {
      existing = null;
    }
    if (existing) {
      taskId = existing.id;
      return;
    }
    var t = new Record(tx.findCollectionByNameOrId(C_TASKS));
    taskId = newId("tsk");
    t.set("id", taskId);
    t.set("event", eventId);
    t.set("status", "submitted");
    t.set("capability", capability);
    t.set("payload", payload);
    t.set("progress", { step: null, percent: 0 });
    t.set("dedup", dedup);
    t.set("deliveries", 1);
    t.set("created_at", nowIso());
    touch(t);
    tx.save(t);
  });
  return { eventId: eventId, taskId: taskId };
}

/* =============================================================== lifecycle */

/** onBootstrap: state collections exist before the first request. */
function bootstrap(e) {
  e.next();
  try {
    ensureState(e.app);
  } catch (thrown) {
    console.error("[a2app] could not create the adapter's state collections: " + thrown);
  }
}

/** Minute cron: redeliver silent claims, drop expired keys, bound the logs. */
function housekeeping() {
  try {
    sweep($app);
  } catch (_e) {
    /* next tick */
  }
  try {
    $app.db().newQuery("DELETE FROM " + C_KV + " WHERE expires > 0 AND expires < {:now}").bind({ now: Date.now() }).execute();
    $app.db().newQuery("DELETE FROM " + C_EVENTS + " WHERE seq <= (SELECT MAX(seq) - " + EVENT_RETENTION + " FROM " + C_EVENTS + ")").execute();
    $app.db().newQuery("DELETE FROM " + C_AUDIT + " WHERE rowid <= (SELECT MAX(rowid) - " + AUDIT_RETENTION + " FROM " + C_AUDIT + ")").execute();
  } catch (_e) {
    /* next tick */
  }
}

/** Any stored change moves dataVersion (the View's "re-read" signal). */
function noteChange(e) {
  try {
    var name = e.record ? e.record.collection().name : "";
    if (name.indexOf("_a2app_") !== 0) markDataChanged();
  } catch (_e) {
    /* not a record change */
  }
  return e.next();
}

/**
 * Who is calling, as the adapter classifies it — for an app's own hooks that
 * need the same answer (e.g. "is this the View, or an agent?"). Works in route
 * handlers, middleware and record hooks alike.
 */
function callerOf(e) {
  var d = decl();
  var grant = grantByToken(d, presentedToken(e));
  var auth = null;
  try {
    auth = e.auth || (e.requestEvent && e.requestEvent.auth) || null;
  } catch (_e) {
    auth = null;
  }
  return {
    view: isView(e),
    foreign: isForeignOrigin(e),
    agent: grant !== null,
    credentialId: grant ? grant.credentialId : null,
    agentName: grant ? headerOf(e, "X-A2App-Agent") || headerOf(e, "X-LUI-Agent") || grant.agentName : null,
    authenticated: auth !== null,
    authMode: d.authMode,
  };
}

module.exports = {
  ADAPTER_VERSION: ADAPTER_VERSION,
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  callerOf: callerOf,
  middleware: middleware,
  identity: identity,
  describe: describe,
  whoami: whoami,
  viewers: viewers,
  context: context,
  setContext: setContext,
  tasks: tasks,
  events: events,
  trigger: trigger,
  op: op,
  opFallback: opFallback,
  afterWrite: afterWrite,
  deleteHook: deleteHook,
  bootstrap: bootstrap,
  housekeeping: housekeeping,
  noteChange: noteChange,
  putGrant: putGrant,
  ensureState: ensureState,
  decl: decl,
};
