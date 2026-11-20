/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS: what a person can do and see in the app, for AI agents.
 *
 * The app's own screens never call these routes (they go through the browser
 * shim frontend/src/app/services/apiAdapter.ts). Each route here does what one
 * screen action does, with the same records, formats and checks; the logic is
 * ported from that shim into lib_agent.js.
 *
 * Every route here has a matching entry in operations.json (the gate enforces
 * it). Reads are GET, writes POST; params come from the query string or the
 * JSON body. Errors answer e.json(status, { error }) like ops.pb.js.
 *
 * NOTE: routerAdd handlers run in ISOLATED contexts, so each handler
 * require()s lib_agent.js itself.
 */

/* ------------------------------------------------------------------ app */

// app.guide: what the app is, its objects, rules and recipes.
routerAdd('GET', '/api/ops/app/guide', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.guide(app, p));
});

// app.state: the main screen (dashboard, category chips, habit list).
routerAdd('GET', '/api/ops/app/state', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.state(app, p));
});

/* --------------------------------------------------------------- habits */

// habits.get: one habit's detail panel (settings, streaks, 30-day rate and trend).
routerAdd('GET', '/api/ops/habits/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.habitGet(app, p));
});

// habits.history: one habit's heatmap, day by day.
routerAdd('GET', '/api/ops/habits/history', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.habitHistory(app, p));
});

// habits.create: the New habit form.
routerAdd('POST', '/api/ops/habits/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.habitCreate(app, p));
});

// habits.update: the Edit habit form.
routerAdd('POST', '/api/ops/habits/update', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.habitUpdate(app, p));
});

// habits.archive: the form's Archive / Unarchive button.
routerAdd('POST', '/api/ops/habits/archive', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.habitArchive(app, p));
});

// habits.reorder: dragging rows in the list.
routerAdd('POST', '/api/ops/habits/reorder', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.habitReorder(app, p));
});

// habits.delete: the form's Delete button (the habit and all its entries).
routerAdd('POST', '/api/ops/habits/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.habitDelete(app, p));
});

/* -------------------------------------------------------------- entries */

// entries.set: the day editor (value and/or note for one day).
routerAdd('POST', '/api/ops/entries/set', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.entrySet(app, p));
});

// entries.mark: the check button / Mark done / Mark not done.
routerAdd('POST', '/api/ops/entries/mark', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.entryMark(app, p));
});

// entries.add: the row's + / - buttons on a count habit.
routerAdd('POST', '/api/ops/entries/add', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.entryAdd(app, p));
});

/* ----------------------------------------------------------- categories */

// categories.create: the category manager's Add category.
routerAdd('POST', '/api/ops/categories/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.categoryCreate(app, p));
});

// categories.delete: the category manager's Delete (its habits become Uncategorized).
routerAdd('POST', '/api/ops/categories/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.categoryDelete(app, p));
});
