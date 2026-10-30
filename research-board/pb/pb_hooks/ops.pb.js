/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: app guide, settings, the Home summary and boards.
 *
 * Every route here is declared in operations.json, and the UI calls the same
 * routes, so the AI agent (agent-app CLI) can do everything the person can.
 * Routes run in isolated VMs: each handler requires its modules inside itself.
 */

/* ------------------------------------------------------------- app guide */

routerAdd('POST', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));

/* --------------------------------------------------------------- settings */

routerAdd('GET', '/api/ops/settings/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const s = require(`${__hooks}/lib_settings.js`);
    return s.serialize(s.row(app));
  }),
);

routerAdd('POST', '/api/ops/settings/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const s = require(`${__hooks}/lib_settings.js`);
    const rec = s.row(app);
    if (u.has(p, 'title')) {
      const t = u.squash(u.str(p, 'title', '')).slice(0, 120);
      if (t === '') throw u.fail(400, 'title cannot be empty');
      rec.set('title', t);
    }
    if (u.has(p, 'link_previews')) rec.set('link_previews', u.bool(p, 'link_previews', true));
    app.save(rec);
    return s.serialize(rec);
  }),
);

/* ---------------------------------------------------------------- summary */

routerAdd('GET', '/api/ops/summary/home', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const month = u.str(p, 'month', '');
    if (month !== '' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw u.fail(400, 'month must be written YYYY-MM, e.g. 2026-10');
    return require(`${__hooks}/lib_summary.js`).home(app, month);
  }),
);

/* ----------------------------------------------------------------- boards */

routerAdd('GET', '/api/ops/boards/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { boards: require(`${__hooks}/lib_boards.js`).list(app, u.bool(p, 'preview', false)) };
  }),
);

routerAdd('GET', '/api/ops/boards/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const b = require(`${__hooks}/lib_boards.js`);
    return b.full(app, b.mustGet(app, u.req(p, 'board')), { paths: u.bool(p, 'paths', false) });
  }),
);

routerAdd('POST', '/api/ops/boards/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const b = require(`${__hooks}/lib_boards.js`);
    u.req(p, 'name');
    const rec = new Record(app.findCollectionByNameOrId('boards'));
    rec.set('color', 'ink');
    b.applyFields(rec, p);
    rec.set('sort', b.nextSort(app));
    app.save(rec);
    return { board: b.serialize(rec, null, null) };
  }),
);

routerAdd('POST', '/api/ops/boards/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const b = require(`${__hooks}/lib_boards.js`);
    const rec = b.mustGet(app, u.req(p, 'board'));
    b.applyFields(rec, p);
    app.save(rec);
    return { board: b.serialize(rec, null, null) };
  }),
);

routerAdd('POST', '/api/ops/boards/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const b = require(`${__hooks}/lib_boards.js`);
    const rec = b.mustGet(app, u.req(p, 'board'));
    const name = rec.getString('name');
    app.delete(rec);
    return { deleted: true, message: 'Deleted the board "' + name + '" with its cards and links' };
  }),
);

routerAdd('POST', '/api/ops/boards/duplicate', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const b = require(`${__hooks}/lib_boards.js`);
    const src = b.mustGet(app, u.req(p, 'board'));
    const name = u.squash(u.str(p, 'name', '')).slice(0, 120) || (src.getString('name') + ' copy').slice(0, 120);
    let id = '';
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_boards.js`);
      const cards = require(`${__hooks}/lib_cards.js`);
      const add = require(`${__hooks}/lib_add.js`);
      const rec = new Record(tx.findCollectionByNameOrId('boards'));
      rec.set('name', name);
      rec.set('description', src.getString('description'));
      rec.set('color', src.getString('color'));
      rec.set('viewport', cards.jsonField(src, 'viewport', null));
      rec.set('sort', lib.nextSort(tx));
      tx.save(rec);
      add.copyCards(tx, cards.liveOnBoard(tx, src.id), rec.id, 0, 0);
      id = rec.id;
    });
    return b.full(app, b.mustGet(app, id), null);
  }),
);

routerAdd('GET', '/api/ops/boards/export', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_export.js`).markdown(app, u.req(p, 'board'));
  }),
);
