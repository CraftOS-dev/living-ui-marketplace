/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: screener, heatmap, saved screens and the activity log
 * (undo, redo, reverting an AI agent run).
 */

/* ---------------------------------------------------------------- screener */

routerAdd('GET', '/api/ops/screener/universes', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => ({ universes: require(`${__hooks}/lib_screener.js`).universes(app) })));

routerAdd('GET', '/api/ops/screener/fields', (e) => require(`${__hooks}/lib_util.js`).handle(e, () => ({ fields: require(`${__hooks}/lib_screener.js`).FIELDS, ops: ['>', '>=', '<', '<=', 'between'] })));

routerAdd('POST', '/api/ops/screener/run', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const sc = require(`${__hooks}/lib_screener.js`);
    let opts = { universe: u.str(p, 'universe', 'us_mega'), criteria: u.list(p, 'criteria', false), sort: u.str(p, 'sort', ''), desc: u.bool(p, 'desc', true), limit: u.int(p, 'limit', 50, 1, 200), technical: u.bool(p, 'technical', false) };
    if (u.has(p, 'screen')) {
      const s = u.byId(app, 'screens', u.str(p, 'screen', ''));
      if (!s) throw u.fail(404, 'No saved screen ' + u.str(p, 'screen', '') + '; see screens.list');
      opts = Object.assign(opts, { universe: s.getString('universe'), criteria: u.json(s, 'criteria', []), sort: s.getString('sort') || opts.sort });
    }
    return sc.run(app, opts);
  }),
);

routerAdd('GET', '/api/ops/screener/heatmap', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_screener.js`).heatmap(app, u.str(p, 'universe', 'us_mega'));
  }),
);

routerAdd('GET', '/api/ops/screens/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    return {
      screens: app.findRecordsByFilter('screens', 'id != ""', 'name', 0, 0).map(require(`${__hooks}/lib_screener.js`).serializeScreen),
    };
  }),
);

routerAdd('POST', '/api/ops/screens/save', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const sc = require(`${__hooks}/lib_screener.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const who = u.actor(e);
    let rec = null;
    let undo = null;
    if (u.has(p, 'screen')) {
      rec = u.byId(app, 'screens', u.str(p, 'screen', ''));
      if (!rec) throw u.fail(404, 'No saved screen ' + u.str(p, 'screen', ''));
      undo = [{ do: 'restore', c: 'screens', id: rec.id, fields: act.pick(rec, ['name', 'universe', 'criteria', 'sort', 'note']) }];
    } else {
      rec = new Record(app.findCollectionByNameOrId('screens'));
      rec.set('added_by', who.actor);
      rec.set('run', who.run);
    }
    if (u.has(p, 'name') || !u.has(p, 'screen')) {
      const name = u.squash(u.req(p, 'name')).slice(0, 80);
      rec.set('name', name);
    }
    if (u.has(p, 'universe') || !u.has(p, 'screen')) {
      const uni = u.str(p, 'universe', 'us_mega');
      sc.members(app, uni);
      rec.set('universe', uni);
    }
    if (u.has(p, 'criteria')) rec.set('criteria', sc.cleanCriteria(u.list(p, 'criteria', false)));
    if (u.has(p, 'sort')) rec.set('sort', u.str(p, 'sort', '').slice(0, 40));
    if (u.has(p, 'note')) rec.set('note', u.text(p, 'note', '').slice(0, 2000));
    app.save(rec);
    if (!undo) undo = [{ do: 'delete', c: 'screens', id: rec.id }];
    act.record(app, { who: who, op: 'screens.save', summary: 'Saved the screen "' + rec.getString('name') + '"', type: 'screen', id: rec.id, undo: undo, merge: true });
    return { screen: sc.serializeScreen(rec) };
  }),
);

routerAdd('POST', '/api/ops/screens/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    const rec = u.byId(app, 'screens', u.req(p, 'screen'));
    if (!rec) throw u.fail(404, 'No saved screen ' + u.str(p, 'screen', ''));
    const snap = act.snapshot(rec);
    app.delete(rec);
    act.record(app, { who: u.actor(e), op: 'screens.delete', summary: 'Deleted the screen "' + snap.name + '"', type: 'screen', id: rec.id, undo: [{ do: 'recreate', c: 'screens', data: snap }] });
    return { deleted: true };
  }),
);

/* ---------------------------------------------------------------- activity */

routerAdd('GET', '/api/ops/activity/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    return {
      activity: act.list(app, {
        actor: u.oneOf(p, 'actor', ['user', 'agent'], ''),
        run: u.str(p, 'run', ''),
        symbol: u.str(p, 'symbol', ''),
        limit: u.int(p, 'limit', 100, 1, 500),
        offset: u.int(p, 'offset', 0, 0, 100000),
      }),
    };
  }),
);

routerAdd('POST', '/api/ops/activity/undo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    let rec = null;
    if (u.has(p, 'entry')) rec = act.mustGet(app, u.str(p, 'entry', ''));
    else {
      rec = act.latest(app, u.oneOf(p, 'actor', ['user', 'agent'], u.fromAgent(e) ? 'agent' : 'user'), false);
      if (!rec) throw u.fail(404, 'Nothing to undo');
    }
    return { entry: act.undo(app, rec) };
  }),
);

routerAdd('POST', '/api/ops/activity/redo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const act = require(`${__hooks}/lib_activity.js`);
    let rec = null;
    if (u.has(p, 'entry')) rec = act.mustGet(app, u.str(p, 'entry', ''));
    else {
      rec = act.latest(app, u.oneOf(p, 'actor', ['user', 'agent'], u.fromAgent(e) ? 'agent' : 'user'), true);
      if (!rec) throw u.fail(404, 'Nothing to redo');
    }
    return { entry: act.redo(app, rec) };
  }),
);

routerAdd('GET', '/api/ops/activity/runs', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { runs: require(`${__hooks}/lib_activity.js`).runs(app, u.int(p, 'limit', 20, 1, 100)) };
  }),
);

routerAdd('POST', '/api/ops/activity/revert_run', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_activity.js`).revertRun(app, u.req(p, 'run'));
  }),
);
