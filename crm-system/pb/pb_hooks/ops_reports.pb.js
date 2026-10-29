/// <reference path="../pb_data/types.d.ts" />
/**
 * Reports (amounts in the home currency, minor units). Periods: range =
 * this_month, last_month, this_quarter, last_quarter, ytd, this_year,
 * last_year, last_12_months, or custom with from and to.
 */

routerAdd('GET', '/api/ops/reports/pipeline', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).pipelineReport(app, u.str(p, 'pipeline', ''));
  }),
);

routerAdd('GET', '/api/ops/reports/funnel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rep = require(`${__hooks}/lib_reports.js`);
    const r = rep.resolveRange(app, p);
    return Object.assign(rep.funnel(app, u.str(p, 'pipeline', ''), r.from, r.to), { range: r });
  }),
);

routerAdd('GET', '/api/ops/reports/forecast', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reports.js`).forecast(app, u.str(p, 'pipeline', ''), u.int(p, 'months', 6, 1, 24));
  }),
);

routerAdd('GET', '/api/ops/reports/winloss', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rep = require(`${__hooks}/lib_reports.js`);
    const r = rep.resolveRange(app, p);
    const cur = rep.winloss(app, u.str(p, 'pipeline', ''), r.from, r.to);
    const prev = rep.winloss(app, u.str(p, 'pipeline', ''), r.prev_from, r.prev_to);
    return Object.assign(cur, { range: r, previous: prev.stats });
  }),
);

routerAdd('GET', '/api/ops/reports/stage_time', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rep = require(`${__hooks}/lib_reports.js`);
    const r = rep.resolveRange(app, p);
    return Object.assign(rep.stageTime(app, u.str(p, 'pipeline', ''), r.from, r.to), { range: r });
  }),
);

routerAdd('GET', '/api/ops/reports/sources', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rep = require(`${__hooks}/lib_reports.js`);
    const r = rep.resolveRange(app, p);
    return Object.assign(rep.sources(app, r.from, r.to, u.str(p, 'pipeline', '')), { range: r });
  }),
);

routerAdd('GET', '/api/ops/reports/activity', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const rep = require(`${__hooks}/lib_reports.js`);
    const r = rep.resolveRange(app, p);
    return Object.assign(rep.activity(app, r.from, r.to), { range: r });
  }),
);

routerAdd('GET', '/api/ops/reports/relationships', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_reports.js`).relationships(app)));
