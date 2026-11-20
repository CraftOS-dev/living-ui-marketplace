/// <reference path="../pb_data/types.d.ts" />
/**
 * A2App adapter — PocketBase hook REGISTRATIONS (SYSTEM-OWNED — hash-locked).
 *
 * PocketBase serializes each hook handler and runs it in an ISOLATED runtime, so
 * a handler cannot reference anything declared at this file's scope. Every
 * handler below is therefore a self-contained one-liner that `require()`s the
 * implementation (`_a2app_impl.js`) inside its own body.
 *
 * This file loads before the app's own hooks (PocketBase loads `*.pb.js` in
 * name order), so the front-face middleware sees every request first.
 *
 * Runtime: PocketBase JSVM (goja) on the 0.39 hook API; `pb-serve.mjs` pins the
 * binary series. `node --check` validates syntax in the gate.
 */

/* ------------------------------------------------------------- front face */

// Host check, framing policy, and the check chain for agent and program calls
// to records and declared operations.
routerUse((e) => require(`${__hooks}/_a2app_impl.js`).middleware(e));

/* --------------------------------------------------------------- identity */

routerAdd("GET", "/api/_a2app", (e) => require(`${__hooks}/_a2app_impl.js`).identity(e));
routerAdd("GET", "/.well-known/a2app.json", (e) => require(`${__hooks}/_a2app_impl.js`).identity(e));
routerAdd("GET", "/api/_a2app/whoami", (e) => require(`${__hooks}/_a2app_impl.js`).whoami(e));
routerAdd("GET", "/api/_a2app/context", (e) => require(`${__hooks}/_a2app_impl.js`).context(e));
routerAdd("GET", "/api/_a2app/viewers", (e) => require(`${__hooks}/_a2app_impl.js`).viewers(e));

/* --------------------------------------------------------------- describe */

routerAdd("GET", "/api/_a2app/describe", (e) => require(`${__hooks}/_a2app_impl.js`).describe(e, []));
routerAdd("GET", "/api/_a2app/describe/{p1}", (e) =>
  require(`${__hooks}/_a2app_impl.js`).describe(e, [e.request.pathValue("p1")]),
);
routerAdd("GET", "/api/_a2app/describe/{p1}/{p2}", (e) =>
  require(`${__hooks}/_a2app_impl.js`).describe(e, [e.request.pathValue("p1"), e.request.pathValue("p2")]),
);
routerAdd("GET", "/api/_a2app/describe/{p1}/{p2}/{p3}", (e) =>
  require(`${__hooks}/_a2app_impl.js`).describe(e, [e.request.pathValue("p1"), e.request.pathValue("p2"), e.request.pathValue("p3")]),
);
routerAdd("GET", "/api/_a2app/describe/{p1}/{p2}/{p3}/{p4}", (e) =>
  require(`${__hooks}/_a2app_impl.js`).describe(e, [
    e.request.pathValue("p1"),
    e.request.pathValue("p2"),
    e.request.pathValue("p3"),
    e.request.pathValue("p4"),
  ]),
);
routerAdd("GET", "/api/_a2app/describe/{p1}/{p2}/{p3}/{p4}/{rest...}", (e) =>
  e.json(404, { a2app: true, ok: false, code: "usage", message: "describe goes at most four levels deep: {module}/{entity}/{id}/{relation}." }),
);

/* ---------------------------------------------------------- tasks, events */

routerAdd("GET", "/api/_a2app/events", (e) => require(`${__hooks}/_a2app_impl.js`).events(e));
routerAdd("GET", "/api/_a2app/tasks", (e) => require(`${__hooks}/_a2app_impl.js`).tasks(e));
routerAdd("GET", "/api/_a2app/tasks/{id}", (e) => require(`${__hooks}/_a2app_impl.js`).tasks(e));
routerAdd("POST", "/api/_a2app/tasks/{id}/{action}", (e) => require(`${__hooks}/_a2app_impl.js`).tasks(e));

/* ------------------------------------------------------------- operations */

// A declared operation is served by the app's own route at the exact path
// `/api/ops/<name>`, which is more specific than this one and wins. This answers
// only for a name with no route: undeclared (404) or declared but unimplemented
// (501), always in the protocol's envelope.
routerAdd("POST", "/api/ops/{name}", (e) => require(`${__hooks}/_a2app_impl.js`).opFallback(e));

/* ---------------------------------------------------------------- records */

// Idempotency bookkeeping and the read-back audit for agent writes, after
// PocketBase stores them. The guard itself runs in the middleware above, on the
// raw request body, before PocketBase coerces anything.
onRecordCreateRequest((e) => require(`${__hooks}/_a2app_impl.js`).afterWrite(e));
onRecordUpdateRequest((e) => require(`${__hooks}/_a2app_impl.js`).afterWrite(e));

// An agent delete answers the protocol's envelope; every other delete is
// PocketBase's own.
onRecordDeleteRequest((e) => require(`${__hooks}/_a2app_impl.js`).deleteHook(e));

// dataVersion moves on any stored change, whoever made it.
onRecordAfterCreateSuccess((e) => require(`${__hooks}/_a2app_impl.js`).noteChange(e));
onRecordAfterUpdateSuccess((e) => require(`${__hooks}/_a2app_impl.js`).noteChange(e));
onRecordAfterDeleteSuccess((e) => require(`${__hooks}/_a2app_impl.js`).noteChange(e));

/* -------------------------------------------------------------- lifecycle */

onBootstrap((e) => require(`${__hooks}/_a2app_impl.js`).bootstrap(e));
cronAdd("a2app_housekeeping", "* * * * *", () => require(`${__hooks}/_a2app_impl.js`).housekeeping());
