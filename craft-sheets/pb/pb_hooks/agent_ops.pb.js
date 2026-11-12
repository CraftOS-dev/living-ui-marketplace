/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — what a person does in Craft Sheets, for an AI agent.
 *
 * Every route here has a matching entry in operations.json. Each one runs a
 * server-side port of the View's own code (see lib_agent.js), so an agent can do
 * and see exactly what a person can in the app — nothing more. The View itself
 * does not call these routes and is unchanged.
 *
 * Handlers run in isolated VMs: each handler require()s its modules inside itself.
 */

/* ------------------------------------------------------------------- app */

routerAdd('GET', '/api/ops/app/guide', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, () => A.guide());
});

/* ---------------------------------------------------------------- sheets */

routerAdd('GET', '/api/ops/sheets/list', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsList(app, p));
});

routerAdd('GET', '/api/ops/sheets/get', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsGet(app, p));
});

routerAdd('POST', '/api/ops/sheets/create', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsCreate(app, p));
});

routerAdd('POST', '/api/ops/sheets/rename', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsRename(app, p));
});

routerAdd('POST', '/api/ops/sheets/delete', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsDelete(app, p));
});

routerAdd('POST', '/api/ops/sheets/freeze', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsFreeze(app, p));
});

routerAdd('POST', '/api/ops/sheets/import-csv', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsImportCsv(app, p));
});

routerAdd('GET', '/api/ops/sheets/export-csv', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.sheetsExportCsv(app, p));
});

/* ----------------------------------------------------------------- cells */

routerAdd('GET', '/api/ops/cells/read', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsRead(app, p));
});

routerAdd('GET', '/api/ops/cells/find', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsFind(app, p));
});

routerAdd('POST', '/api/ops/cells/set', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsSet(app, p));
});

routerAdd('POST', '/api/ops/cells/paste', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsPaste(app, p));
});

routerAdd('POST', '/api/ops/cells/clear', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsClear(app, p));
});

routerAdd('POST', '/api/ops/cells/format', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsFormat(app, p));
});

routerAdd('POST', '/api/ops/cells/fill', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsFill(app, p));
});

routerAdd('POST', '/api/ops/cells/copy', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsCopy(app, p));
});

routerAdd('POST', '/api/ops/cells/replace', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.cellsReplace(app, p));
});

/* ------------------------------------------------------------------ rows */

routerAdd('POST', '/api/ops/rows/add', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.rowsAdd(app, p));
});

routerAdd('POST', '/api/ops/rows/insert', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.rowsInsert(app, p));
});

routerAdd('POST', '/api/ops/rows/delete', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.rowsDelete(app, p));
});

routerAdd('POST', '/api/ops/rows/resize', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.rowsResize(app, p));
});

/* --------------------------------------------------------------- columns */

routerAdd('POST', '/api/ops/columns/add', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.columnsAdd(app, p));
});

routerAdd('POST', '/api/ops/columns/insert', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.columnsInsert(app, p));
});

routerAdd('POST', '/api/ops/columns/delete', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.columnsDelete(app, p));
});

routerAdd('POST', '/api/ops/columns/update', (e) => {
  const A = require(`${__hooks}/lib_agent.js`);
  return A.handle(e, (p, app) => A.columnsUpdate(app, p));
});
