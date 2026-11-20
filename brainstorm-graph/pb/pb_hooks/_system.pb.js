/// <reference path="../pb_data/types.d.ts" />
/**
 * COMPATIBILITY HOOKS (SYSTEM-OWNED — hash-locked; blueprint-pocketbase-kit).
 *
 * Registrations for `_compat_system.js`: what these apps' own code and UIs
 * relied on from CraftBot's system hooks. Loads after `_a2app.pb.js` (name
 * order), so the framework adapter's host, origin and credential checks have
 * already run. Handlers are one-liners because PocketBase runs each in an
 * isolated VM that cannot see this file's scope.
 */

routerUse((e) => require(`${__hooks}/_compat_system.js`).errorLog(e));
routerUse((e) => require(`${__hooks}/_compat_system.js`).middleware(e));

onRecordCreateRequest((e) => require(`${__hooks}/_compat_system.js`).viewBackstop(e, "create"));
onRecordUpdateRequest((e) => require(`${__hooks}/_compat_system.js`).viewBackstop(e, "update"));

onBootstrap((e) => require(`${__hooks}/_compat_system.js`).rateLimits(e));

routerAdd("POST", "/api/_console", (e) => require(`${__hooks}/_compat_system.js`).consoleRelay(e));
routerAdd("POST", "/api/_coverage", (e) => require(`${__hooks}/_compat_system.js`).coverage(e));
routerAdd("POST", "/api/_coverage/mark", (e) => require(`${__hooks}/_compat_system.js`).coverageMark(e));
