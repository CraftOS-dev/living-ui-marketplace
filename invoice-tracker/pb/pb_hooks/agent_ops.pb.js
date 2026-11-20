/// <reference path="../pb_data/types.d.ts" />
/**
 * Agent operations for the Invoice & Subscription Tracker: routes.
 *
 * Each operation does exactly what a person can do (or see) on the app's own
 * screens — same collections, fields, formats, validation and feed rows. The
 * logic is in lib_agent.js; handlers require() it INSIDE the callback because
 * PocketBase JSVM handlers run in isolated VMs. Declared in operations.json.
 */

/* ------------------------------------------------------------- reads (GET) */

routerAdd('GET', '/api/ops/dashboard/overview', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.dashboardOverview(app, p));
});

routerAdd('GET', '/api/ops/subscriptions/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.subscriptionsList(app, p));
});

routerAdd('GET', '/api/ops/invoices/list', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.invoicesList(app, p));
});

routerAdd('GET', '/api/ops/invoices/get', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.invoicesGet(app, p));
});

routerAdd('GET', '/api/ops/reports/monthly', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.reportsMonthly(app, p));
});

routerAdd('GET', '/api/ops/reports/monthly-csv', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.reportsMonthlyCsv(app, p));
});

routerAdd('GET', '/api/ops/reports/yearly', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.reportsYearly(app, p));
});

/* ----------------------------------------------------------- writes (POST) */

routerAdd('POST', '/api/ops/invoices/add', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.invoicesAdd(app, p));
});

routerAdd('POST', '/api/ops/invoices/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.invoicesDelete(app, p));
});

routerAdd('POST', '/api/ops/subscriptions/add', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.subscriptionsAdd(app, p));
});

routerAdd('POST', '/api/ops/subscriptions/set-status', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.subscriptionsSetStatus(app, p));
});

routerAdd('POST', '/api/ops/subscriptions/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.subscriptionsDelete(app, p));
});

routerAdd('POST', '/api/ops/groups/add', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.groupsAdd(app, p));
});

routerAdd('POST', '/api/ops/groups/update', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.groupsUpdate(app, p));
});

routerAdd('POST', '/api/ops/groups/delete', (e) => {
  const lib = require(`${__hooks}/lib_agent.js`);
  return lib.handle(e, (p, app) => lib.groupsDelete(app, p));
});
