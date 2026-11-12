/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — everything a person does in the PDF Splitter, for agents.
 * Each route has a matching entry in operations.json (same method and path).
 * The logic is in lib_agent.js, which ports the browser code it mirrors.
 *
 * Handlers run in ISOLATED contexts: lib_agent.js is require()d inside each
 * handler, never at file scope.
 */

routerAdd('GET', '/api/ops/pdfs/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.pdfsList(app, p));
});

routerAdd('GET', '/api/ops/pdfs/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.pdfsGet(app, p));
});

routerAdd('POST', '/api/ops/pdfs/upload', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.pdfsUpload(app, p));
});

routerAdd('POST', '/api/ops/pdfs/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.pdfsDelete(app, p));
});

routerAdd('GET', '/api/ops/splits/preview', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.splitsPreview(app, p));
});

routerAdd('POST', '/api/ops/splits/create', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.splitsCreate(app, p));
});

routerAdd('GET', '/api/ops/splits/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.splitsGet(app, p));
});
