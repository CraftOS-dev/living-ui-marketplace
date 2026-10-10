/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: stock counts, CSV import and export.
 *
 * Every route is declared in operations.json and is what the UI calls too.
 */

/* ----------------------------------------------------------------- counts */

routerAdd('GET', '/api/ops/counts/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_counts.js`).list(app, {
      status: u.oneOf(p, 'status', ['counting', 'completed', 'cancelled'], ''),
      limit: u.int(p, 'limit', 50, 1, 500),
      offset: u.int(p, 'offset', 0, 0, 1000000),
    });
  }),
);

routerAdd('GET', '/api/ops/counts/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_counts.js`).serialize(app, core.count(app, u.req(p, 'count', 'C-0001')), u.bool(p, 'reveal', false));
  }),
);

routerAdd('POST', '/api/ops/counts/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_counts.js`).start(app, p)),
);

routerAdd('POST', '/api/ops/counts/set-line', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const counts = require(`${__hooks}/lib_counts.js`);
    return counts.setLine(app, counts.lineOf(app, u.req(p, 'line', '<line id from counts.get>')), p);
  }),
);

routerAdd('POST', '/api/ops/counts/scan', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_counts.js`).scan(app, core.count(app, u.req(p, 'count', 'C-0001')), p);
  }),
);

routerAdd('POST', '/api/ops/counts/add-item', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_counts.js`).addItem(app, core.count(app, u.req(p, 'count', 'C-0001')), p);
  }),
);

routerAdd('POST', '/api/ops/counts/remove-line', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const counts = require(`${__hooks}/lib_counts.js`);
    return counts.removeLine(app, counts.lineOf(app, u.req(p, 'line', '<line id from counts.get>')));
  }),
);

routerAdd('POST', '/api/ops/counts/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_counts.js`).complete(app, core.count(app, u.req(p, 'count', 'C-0001')), p, u.actor(ev));
  }),
);

routerAdd('POST', '/api/ops/counts/cancel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_counts.js`).cancel(app, core.count(app, u.req(p, 'count', 'C-0001')));
  }),
);

routerAdd('POST', '/api/ops/counts/reopen', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_counts.js`).reopen(app, core.count(app, u.req(p, 'count', 'C-0001')), u.actor(ev));
  }),
);

routerAdd('POST', '/api/ops/counts/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const rec = core.count(app, u.req(p, 'count', 'C-0001'));
    const lines = require(`${__hooks}/lib_counts.js`).lines(app, rec.id).length;
    const out = { count: { id: rec.id, number: rec.getString('number'), status: rec.getString('status') }, lines: lines, adjustments_kept_in_history: rec.getString('batch') !== '' };
    if (u.bool(p, 'preview', false)) return out;
    app.delete(rec);
    out.deleted = true;
    return out;
  }),
);

/* ---------------------------------------------------------------- import */

routerAdd('POST', '/api/ops/import/preview', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const im = require(`${__hooks}/lib_import.js`);
    const imp = im.source(app, p, ev);
    const opts = im.options(app, imp, p);
    const pl = im.plan(app, opts);
    imp.set('rows', pl.counts.rows);
    if (imp.getString('status') === 'previewed') imp.set('mapping', im.savedMapping(pl));
    app.save(imp);
    return im.previewOut(imp, pl, u.int(p, 'show', 50, 1, 500));
  }),
);

routerAdd('POST', '/api/ops/import/run', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const im = require(`${__hooks}/lib_import.js`);
    const imp = im.source(app, p, ev);
    return im.run(app, imp, im.options(app, imp, p), u.actor(ev));
  }),
);

routerAdd('GET', '/api/ops/import/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_import.js`).list(app, u.int(p, 'limit', 50, 1, 500));
  }),
);

routerAdd('POST', '/api/ops/import/undo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const imp = u.byId(app, 'imports', u.req(p, 'import_id', '<id from import.list>'));
    if (imp === null) throw u.fail(404, 'No import with that id.', 'List them with import.list.');
    return require(`${__hooks}/lib_import.js`).undo(app, imp, u.actor(ev));
  }),
);

routerAdd('POST', '/api/ops/import/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const imp = u.byId(app, 'imports', u.req(p, 'import_id', '<id from import.list>'));
    if (imp === null) throw u.fail(404, 'No import with that id.', 'List them with import.list.');
    if (imp.getString('status') === 'imported') throw u.fail(400, 'Undo this import first (import.undo); deleting its record would leave nothing to undo it with.');
    app.delete(imp);
    return { deleted: true };
  }),
);

/* ---------------------------------------------------------------- export */

routerAdd('GET', '/api/ops/export/items', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_export.js`).items(app)),
);

routerAdd('GET', '/api/ops/export/stock', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_export.js`).stock(app)),
);

routerAdd('GET', '/api/ops/export/movements', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const to = u.day(p, 'to', u.today());
    const from = u.day(p, 'from', u.addDays(to, -29));
    if (from > to) throw u.fail(400, 'from must be on or before to');
    return require(`${__hooks}/lib_export.js`).movements(app, from, to);
  }),
);

routerAdd('GET', '/api/ops/export/template', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, () => require(`${__hooks}/lib_export.js`).template()),
);
