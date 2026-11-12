/// <reference path="../pb_data/types.d.ts" />
/**
 * COMPATIBILITY MODULE (SYSTEM-OWNED — hash-locked; blueprint-pocketbase-kit).
 *
 * What the marketplace apps' own code and UIs relied on from CraftBot's system
 * hooks (adapter 1.9.0), now that the A2App surface itself is the framework's
 * adapter (`_a2app_impl.js`). Registered by `_system.pb.js`, which loads after
 * `_a2app.pb.js`, so the framework's checks run first on every request.
 *
 *   spaHeaders     the SPA entry is never cached (assets stay cacheable)
 *   viewGuard      the app's own View writes keep the 1.9.0 write guard
 *   viewBackstop   ... and its "did it land" backstop + attribution log
 *   legacyAuth     the app's own operation routes (/api/ops/<group>/<verb>)
 *                  still require a caller: the View, an agent credential, or a
 *                  signed-in principal — exactly what 1.9.0 required
 *   multiUserOps   on a multi-user app every operation needs a principal
 *   rateLimits     PocketBase's built-in limits, as the apps were tuned for
 *   console/coverage  the UI kit's relays (diagnostics, dev builds)
 */

var ALLOWED_LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
var RECORD_PATH = /^\/api\/collections\/[^\/]+\/records(\/[^\/?]+)?$/;

function adapter() {
  return require(`${__hooks}/_a2app_impl.js`);
}

function pathOf(e) {
  try {
    return String((e.request.url && e.request.url.path) || "");
  } catch (_e) {
    return "";
  }
}

function methodOf(e) {
  try {
    return String(e.request.method || "").toUpperCase();
  } catch (_e) {
    return "";
  }
}

function isMutation(method) {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

/** The SPA entry must never be cached: index.html names content-hashed assets
 *  that change on every build, and a heuristically cached entry keeps showing
 *  the previous build. Headers must be set before e.next(). */
function spaHeaders(e) {
  var path = pathOf(e);
  if (
    path.indexOf("/api/") !== 0 &&
    path.indexOf("/assets/") !== 0 &&
    path.indexOf("/_/") !== 0 &&
    (path === "/" || path.indexOf(".") === -1 || /\.html?$/i.test(path))
  ) {
    try {
      e.response.header().set("Cache-Control", "no-store");
    } catch (_e) {
      /* no header plumbing */
    }
  }
}

/** A View write to the records API — the requests the 1.9.0 guard covers. */
function isViewRecordWrite(e) {
  var method = methodOf(e);
  if (method !== "POST" && method !== "PATCH" && method !== "PUT") return false;
  if (!RECORD_PATH.test(pathOf(e))) return false;
  return adapter().callerOf(e).view;
}

/** The 1.9.0 record backstop + attribution log, for View writes only. */
function viewBackstop(e, op) {
  var view = false;
  try {
    view = adapter().callerOf(e).view;
  } catch (_e) {
    view = false;
  }
  if (!view) return e.next();
  return require(`${__hooks}/_compat_lib.js`).guardRecord(e, op);
}

/**
 * The app's own operation routes are not protocol paths, so the adapter's chain
 * does not cover them; 1.9.0 required a caller on every mutation there. A
 * declared protocol operation (`/api/ops/<name>`) was already authorized by the
 * adapter and passes here too.
 */
function legacyAuth(e) {
  var path = pathOf(e);
  if (path.indexOf("/api/ops/") !== 0 || !isMutation(methodOf(e))) return false;
  var caller = adapter().callerOf(e);
  if (caller.view || caller.agent || caller.authenticated) return false;
  e.json(401, {
    a2app: true,
    ok: false,
    code: "agent_token_required",
    message: "This call requires an agent credential.",
    how: "Read the app's .agent-token file (mode 0600) in the project directory and send it as X-A2App-Token.",
  });
  return true;
}

function readManifest() {
  try {
    return JSON.parse(toString($os.readFile($filepath.join(__hooks, "..", "..", "manifest.json"))));
  } catch (_e) {
    return {};
  }
}

/** On a multi-user app every operation needs a principal (an agent credential
 *  acts as the app's operator, so it has one). */
function multiUserOps(e) {
  if (pathOf(e).indexOf("/api/ops/") !== 0) return false;
  if (String(readManifest().authMode || "none") !== "multi-user") return false;
  var authed = false;
  try {
    authed = !!e.auth;
  } catch (_e) {
    authed = false;
  }
  if (!authed) {
    try {
      var info = e.requestInfo();
      authed = !!(info && info.auth);
    } catch (_e) {
      authed = false;
    }
  }
  if (!authed) {
    // A valid agent credential is a principal: the adapter acts for it as the
    // app's operator before any handler runs. Checked here too because the order
    // PocketBase runs the two front-face middlewares in is not guaranteed.
    try {
      authed = adapter().callerOf(e).agent === true;
    } catch (_e) {
      authed = false;
    }
  }
  if (authed) return false;
  e.json(401, {
    ok: false,
    error: "authentication required",
    hint: "This app is multi-user; operations require a signed-in principal.",
  });
  return true;
}

/** The front-face compatibility chain, in 1.9.0's order. */
function middleware(e) {
  spaHeaders(e);
  // Each check returns true once it has written its refusal: stop there (e.json
  // returns nothing in the JSVM, so the reply itself cannot be the signal).
  if (multiUserOps(e) || legacyAuth(e)) return;
  // The 1.9.0 write guard for the app's own View (it calls e.next() itself
  // when the write is acceptable).
  if (isViewRecordWrite(e)) return require(`${__hooks}/_compat_lib.js`).guardRequest(e);
  return e.next();
}

/** Handler exceptions are otherwise invisible: PocketBase turns an uncaught
 *  throw into a generic 4xx/5xx with no log line. Log, rethrow unchanged. */
function errorLog(e) {
  try {
    return e.next();
  } catch (err) {
    try {
      var path = pathOf(e);
      if (path.indexOf("/api/collections/") !== 0 && path.indexOf("/api/realtime") !== 0) {
        console.log("[handler-error] " + methodOf(e) + " " + path + ": " + String((err && err.message) || err));
      }
    } catch (_e) {
      /* logging never masks the error */
    }
    throw err;
  }
}

function rateLimits(e) {
  e.next();
  try {
    var settings = $app.settings();
    if (settings.rateLimits.enabled) return;
    settings.rateLimits.enabled = true;
    settings.rateLimits.rules = [
      { label: "*:auth", maxRequests: 30, duration: 60 },
      { label: "/api/collections/", maxRequests: 1200, duration: 60 },
      { label: "/api/ops/", maxRequests: 300, duration: 60 },
      { label: "/api/_console", maxRequests: 120, duration: 60 },
      { label: "/api/_coverage", maxRequests: 600, duration: 60 },
    ];
    $app.save(settings);
  } catch (err) {
    console.log("[system] could not enable rate limits: " + err);
  }
}

function originAllowed(e) {
  var origin = "";
  try {
    origin = String(e.request.header.get("Origin") || "");
  } catch (_e) {
    origin = "";
  }
  return origin === "" || ALLOWED_LOOPBACK_ORIGIN.test(origin);
}

function appendCapped(file, text, cap, keep) {
  var existing = "";
  try {
    existing = toString($os.readFile(file));
  } catch (_e) {
    existing = "";
  }
  if (existing.length > cap) existing = existing.slice(-keep);
  $os.writeFile(file, existing + text, 0o644);
}

function logsDir() {
  var dir = $filepath.join(__hooks, "..", "..", "logs");
  $os.mkdirAll(dir, 0o755);
  return dir;
}

/** POST /api/_console — the UI kit's console relay (capped, rate-limited). */
function consoleRelay(e) {
  if (!originAllowed(e)) return e.json(403, { ok: false, error: "forbidden origin" });
  var body = e.requestInfo().body;
  var entries = body && Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) return e.json(200, { ok: true });
  var lines = entries
    .slice(0, 50)
    .map(function (x) {
      return JSON.stringify({ ts: x.ts, level: x.level, message: String(x.message).slice(0, 4000) });
    })
    .join("\n");
  appendCapped($filepath.join(logsDir(), "frontend_console.log"), lines + "\n", 2 * 1024 * 1024, 1024 * 1024);
  return e.json(200, { ok: true });
}

/** POST /api/_coverage — dev builds' coverage deltas (loopback only). */
function coverage(e) {
  if (!originAllowed(e)) return e.json(403, { ok: false, error: "forbidden origin" });
  var body = e.requestInfo().body;
  var counters = body && typeof body.counters === "object" && body.counters ? body.counters : null;
  if (!counters) return e.json(200, { ok: true });
  var line = JSON.stringify({ ts: Date.now(), counters: counters }).slice(0, 512 * 1024);
  appendCapped($filepath.join(logsDir(), "coverage.jsonl"), line + "\n", 4 * 1024 * 1024, 2 * 1024 * 1024);
  return e.json(200, { ok: true });
}

/** POST /api/_coverage/mark — a verifier's feature boundary on that timeline. */
function coverageMark(e) {
  if (!originAllowed(e)) return e.json(403, { ok: false, error: "forbidden origin" });
  var body = e.requestInfo().body;
  var feature = String((body && body.feature) || "").slice(0, 200);
  if (!feature) return e.json(400, { ok: false, error: "feature is required" });
  appendCapped($filepath.join(logsDir(), "coverage.jsonl"), JSON.stringify({ ts: Date.now(), mark: feature }) + "\n", 4 * 1024 * 1024, 2 * 1024 * 1024);
  return e.json(200, { ok: true, feature: feature });
}

module.exports = {
  middleware: middleware,
  errorLog: errorLog,
  viewBackstop: viewBackstop,
  rateLimits: rateLimits,
  consoleRelay: consoleRelay,
  coverage: coverage,
  coverageMark: coverageMark,
};
