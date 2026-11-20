/// <reference path="../pb_data/types.d.ts" />
/**
 * Company OS agent operations: routes only (logic in lib_agent.js). Each route
 * has a matching operations.json entry. They let an agent do and see what a
 * person can in the app, with the same records and side effects as the UI.
 *
 * GOJA RULE (as ops.pb.js): every handler runs in an isolated VM, so each one
 * require()s INSIDE the callback and never references file-scope helpers.
 * GET = read-only, POST = changes data. lib_agent.handle() checks the caller
 * (signed in and approved, or the app's operator) and answers errors as
 * `{ error, code }`.
 */

// ---- read-only ---------------------------------------------------------------
routerAdd('GET', '/api/ops/company-overview', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).companyOverview(app, p, ctx)));
routerAdd('GET', '/api/ops/journey-status', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).journeyStatus(app, p, ctx)));
routerAdd('GET', '/api/ops/customers-pipeline', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).customersPipeline(app, p, ctx)));
routerAdd('GET', '/api/ops/money-summary', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).moneySummary(app, p, ctx)));
routerAdd('GET', '/api/ops/goals-scorecard', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).goalsScorecard(app, p, ctx)));
routerAdd('GET', '/api/ops/marketing-dashboard', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).marketingDashboard(app, p, ctx)));
routerAdd('GET', '/api/ops/team-list', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).teamList(app, p, ctx)));
routerAdd('GET', '/api/ops/files-download', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).filesDownload(app, p, ctx)));

// ---- writes ------------------------------------------------------------------
routerAdd('POST', '/api/ops/company-update', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).companyUpdate(app, p, ctx)));
routerAdd('POST', '/api/ops/journey-set-step', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).journeySetStep(app, p, ctx)));
routerAdd('POST', '/api/ops/customers-save', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).customersSave(app, p, ctx)));
routerAdd('POST', '/api/ops/money-record-invoice-income', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).moneyRecordInvoiceIncome(app, p, ctx)));
routerAdd('POST', '/api/ops/marketing-record-spend', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).marketingRecordSpend(app, p, ctx)));
routerAdd('POST', '/api/ops/goals-set-number', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).goalsSetNumber(app, p, ctx)));
routerAdd('POST', '/api/ops/roadmap-link', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).roadmapLink(app, p, ctx)));
routerAdd('POST', '/api/ops/processes-use-template', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).processesUseTemplate(app, p, ctx)));
routerAdd('POST', '/api/ops/files-upload', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).filesUpload(app, p, ctx)));
routerAdd('POST', '/api/ops/kanban-attach', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).kanbanAttach(app, p, ctx)));

// ---- destructive -------------------------------------------------------------
routerAdd('POST', '/api/ops/kanban-detach', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).kanbanDetach(app, p, ctx)));
routerAdd('POST', '/api/ops/roadmap-auto-layout', (e) => require(`${__hooks}/lib_agent.js`).handle(e, (p, app, ctx) => require(`${__hooks}/lib_agent.js`).roadmapAutoLayout(app, p, ctx)));
