/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations. Every route here is declared in operations.json, and the UI
 * calls the same routes, so the AI agent (agent-app CLI) can do everything
 * the person can. Routes run in isolated VMs: each handler requires its
 * modules inside itself.
 */

/* ------------------------------------------------------------------ app */

routerAdd('GET', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));

routerAdd('GET', '/api/ops/app/status', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).status(app)));

routerAdd('GET', '/api/ops/settings/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).settingsGet(app)));

routerAdd('POST', '/api/ops/settings/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).settingsUpdate(app, p)));

routerAdd('POST', '/api/ops/jobs/run', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).jobsRun(app, p)));

/* ---------------------------------------------------------------- parts */

routerAdd('GET', '/api/ops/parts/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_parts.js`).list(app, p)));

routerAdd('GET', '/api/ops/parts/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_parts.js`).get(app, p)));

routerAdd('POST', '/api/ops/parts/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_parts.js`).create(app, ev, p)));

routerAdd('POST', '/api/ops/parts/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_parts.js`).update(app, ev, p)));

routerAdd('POST', '/api/ops/parts/duplicate', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_parts.js`).duplicate(app, ev, p)));

/* ---------------------------------------------------- parameters, features */

routerAdd('POST', '/api/ops/params/set', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_edit.js`).paramsSet(app, ev, p)));

routerAdd('GET', '/api/ops/features/schema', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p) => {
    const u = require(`${__hooks}/lib_util.js`);
    const kinds = require(`${__hooks}/lib_kinds.js`);
    if (u.bool(p, 'full', false)) return kinds.full();
    return kinds.describe(u.str(p, 'kind', ''));
  }),
);

routerAdd('POST', '/api/ops/features/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_edit.js`).featuresAdd(app, ev, p)));

routerAdd('POST', '/api/ops/features/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_edit.js`).featuresUpdate(app, ev, p)));

routerAdd('POST', '/api/ops/features/move', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_edit.js`).featuresMove(app, ev, p)));

routerAdd('POST', '/api/ops/features/roll-to', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_edit.js`).featuresRollTo(app, ev, p)));

routerAdd('POST', '/api/ops/edits/batch', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_edit.js`).batchEdit(app, ev, p)));

/* --------------------------------------------------------------- builds */

routerAdd('GET', '/api/ops/builds/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const B = require(`${__hooks}/lib_builds.js`);
    const buildId = u.str(p, 'build', '');
    if (buildId !== '') {
      const b = u.byId(app, 'builds', buildId);
      if (b === null) throw u.fail(404, 'No build ' + buildId);
      return { build: B.describe(app, b) };
    }
    const part = require(`${__hooks}/lib_tree.js`).part(app, u.req(p, 'part', '<part id or name>'));
    const pending = app.findRecordsByFilter('builds', "part = {:p} && preview = false && (status = 'queued' || status = 'running')", '-created', 1, 0, { p: part.id });
    return {
      part: part.getString('name'),
      status: part.getString('status'),
      current: part.getString('current_build') !== '' && u.byId(app, 'builds', part.getString('current_build')).getString('input_hash') === part.getString('tree_hash'),
      build: B.describe(app, u.byId(app, 'builds', part.getString('current_build'))),
      pending: pending.length ? B.describe(app, pending[0]) : null,
    };
  }),
);

routerAdd('POST', '/api/ops/builds/run', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const B = require(`${__hooks}/lib_builds.js`);
    const part = require(`${__hooks}/lib_tree.js`).part(app, u.req(p, 'part', '<part id or name>'));
    require(`${__hooks}/lib_misc.js`).refreshHash(app, part.id);
    const b = B.enqueue(app, part.id, u.actor(ev), { force: u.bool(p, 'force', false) });
    if (b === null) return { part: part.getString('name'), build: null, note: 'The part has no features yet.' };
    const waitS = u.number(p, 'wait_s', { min: 0, max: 25 });
    const st = B.kick(app, b, (waitS === null ? (u.fromAgent(ev) ? 20 : 0) : waitS) * 1000);
    return { part: part.getString('name'), status: st === null ? 'queued' : st, build: B.describe(app, app.findRecordById('builds', b.id)) };
  }),
);

routerAdd('POST', '/api/ops/builds/cancel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const part = require(`${__hooks}/lib_tree.js`).part(app, u.req(p, 'part', '<part id or name>'));
    return require(`${__hooks}/lib_builds.js`).cancel(app, part.id);
  }),
);

/* ---------------------------------------------------------------- model */

routerAdd('GET', '/api/ops/model/describe', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_model.js`).describe(app, p)));

routerAdd('GET', '/api/ops/model/measure', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_model.js`).measure(app, p)));

routerAdd('GET', '/api/ops/model/properties', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_model.js`).properties(app, p)));

routerAdd('GET', '/api/ops/model/check', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_model.js`).check(app, p)));

routerAdd('GET', '/api/ops/refs/resolve', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_model.js`).resolve(app, p)));

routerAdd('POST', '/api/ops/views/render', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_model.js`).render(app, p)));

routerAdd('POST', '/api/ops/compare/builds', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_model.js`).compare(app, ev, p)));

/* -------------------------------------------------------------- exports */

routerAdd('POST', '/api/ops/exports/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_exports.js`).create(app, ev, p)));

routerAdd('GET', '/api/ops/exports/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_exports.js`).list(app, p)));

/* -------------------------------------------------------------- history */

routerAdd('GET', '/api/ops/changes/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_changes.js`).list(app, p)));

routerAdd('POST', '/api/ops/changes/revert', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_changes.js`).revert(app, ev, p)));

/* ------------------------------------------------------------ selection */

routerAdd('GET', '/api/ops/selection/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).selectionGet(app, p)));

routerAdd('POST', '/api/ops/selection/set', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_misc.js`).selectionSet(app, ev, p)));

/* ---------------------------------------------------------------- checks */

routerAdd('GET', '/api/ops/checks/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).checksList(app, p)));

routerAdd('POST', '/api/ops/checks/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_misc.js`).checksSave(app, ev, p)));

routerAdd('POST', '/api/ops/checks/run', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_misc.js`).checksRun(app, ev, p)));

/* ---------------------------------------------------------------- assets */

routerAdd('POST', '/api/ops/assets/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_misc.js`).assetsAdd(app, ev, p)));

routerAdd('GET', '/api/ops/assets/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).assetsList(app, p)));

/* ---------------------------------------------- requests to the AI agent */

routerAdd('POST', '/api/ops/requests/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_misc.js`).briefsCreate(app, ev, p)));

routerAdd('GET', '/api/ops/requests/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).briefsList(app, p)));

routerAdd('GET', '/api/ops/requests/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_misc.js`).briefsGet(app, p)));

routerAdd('POST', '/api/ops/requests/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_misc.js`).briefsUpdate(app, ev, p)));

/* --------------------------------------------------------------- delete */

routerAdd('POST', '/api/ops/records/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_delete.js`).del(app, ev, p)));
