/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: items, barcodes, stock changes and the history.
 *
 * Every route is declared in operations.json and is what the UI calls too.
 * Stock changes all go through lib_ledger.js; params are read and checked
 * before anything is written.
 */

/* ------------------------------------------------------------------ items */

routerAdd('GET', '/api/ops/items/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const f = {
      q: u.str(p, 'q', ''),
      status: u.oneOf(p, 'status', ['ok', 'low', 'out', 'over', 'reorder'], ''),
      archived: u.oneOf(p, 'archived', ['active', 'archived', 'all'], 'active'),
      sort: u.oneOf(p, 'sort', ['name', 'qty', 'value', 'updated', 'status', 'days_left'], 'name'),
      desc: u.bool(p, 'desc', false),
      limit: u.int(p, 'limit', 100, 1, 1000),
      offset: u.int(p, 'offset', 0, 0, 1000000),
    };
    const cat = u.str(p, 'category', '');
    if (cat !== '') f.category = cat === 'none' ? 'none' : core.category(app, cat).id;
    const sup = u.str(p, 'supplier', '');
    if (sup !== '') f.supplier = sup === 'none' ? 'none' : core.supplier(app, sup).id;
    const loc = u.str(p, 'location', '');
    if (loc !== '') {
      const rec = core.location(app, loc);
      const ix = require(`${__hooks}/lib_locations.js`).index(app);
      f.locations = [rec.id].concat(u.bool(p, 'include_sub', true) ? ix.descendants(rec.id) : []);
    }
    return require(`${__hooks}/lib_items.js`).list(app, f);
  }),
);

routerAdd('GET', '/api/ops/items/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_items.js`).get(app, core.item(app, u.req(p, 'item', 'SKU-0001')));
  }),
);

routerAdd('POST', '/api/ops/items/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    return { item: require(`${__hooks}/lib_items.js`).create(app, p, ev, u.actor(ev)) };
  }),
);

routerAdd('POST', '/api/ops/items/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const rec = core.item(app, u.req(p, 'item', 'SKU-0001'));
    return { item: require(`${__hooks}/lib_items.js`).update(app, rec, p, ev) };
  }),
);

routerAdd('POST', '/api/ops/items/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const items = require(`${__hooks}/lib_items.js`);
    const rec = core.item(app, u.req(p, 'item', 'SKU-0001'));
    const out = items.deletePreview(app, rec);
    if (u.bool(p, 'preview', false)) return out;
    app.delete(rec);
    out.deleted = true;
    return out;
  }),
);

routerAdd('POST', '/api/ops/items/delete-many', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const ids = u.list(p, 'ids') || [];
    if (ids.length === 0) throw u.fail(400, 'ids is required: a JSON list of item ids or SKUs');
    const recs = ids.map((id, i) => core.item(app, id, 'ids[' + i + ']'));
    app.runInTransaction((tx) => {
      for (const r of recs) tx.delete(tx.findRecordById('items', r.id));
    });
    return { deleted: recs.length };
  }),
);

routerAdd('POST', '/api/ops/items/set-category', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const ids = u.list(p, 'ids') || [];
    if (ids.length === 0) throw u.fail(400, 'ids is required: a JSON list of item ids or SKUs');
    const recs = ids.map((id, i) => core.item(app, id, 'ids[' + i + ']'));
    const c = u.str(p, 'category', '');
    const cat = c === '' ? '' : core.category(app, c).id;
    app.runInTransaction((tx) => {
      for (const r of recs) {
        const it = tx.findRecordById('items', r.id);
        it.set('category', cat);
        tx.save(it);
      }
    });
    return { updated: recs.length };
  }),
);

routerAdd('POST', '/api/ops/items/set-archived', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const ids = u.list(p, 'ids') || [];
    if (ids.length === 0) throw u.fail(400, 'ids is required: a JSON list of item ids or SKUs');
    const recs = ids.map((id, i) => core.item(app, id, 'ids[' + i + ']'));
    const archived = u.bool(p, 'archived', true);
    app.runInTransaction((tx) => {
      for (const r of recs) {
        const it = tx.findRecordById('items', r.id);
        it.set('archived', archived);
        tx.save(it);
      }
    });
    return { updated: recs.length, archived: archived };
  }),
);

routerAdd('POST', '/api/ops/items/add-barcode', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const items = require(`${__hooks}/lib_items.js`);
    const rec = core.item(app, u.req(p, 'item', 'SKU-0001'));
    const code = u.req(p, 'code', '0123456789012');
    if (u.findOne(app, 'codes', 'code = {:c} && item = {:i}', { c: code, i: rec.id }) === null) {
      app.runInTransaction((tx) => items.addCodes(tx, rec.id, [code]));
    }
    return { item: items.get(app, rec) };
  }),
);

routerAdd('POST', '/api/ops/items/remove-barcode', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const rec = core.item(app, u.req(p, 'item', 'SKU-0001'));
    const code = u.req(p, 'code', '0123456789012');
    const c = u.findOne(app, 'codes', 'code = {:c} && item = {:i}', { c: code, i: rec.id });
    if (c === null) throw u.fail(404, '"' + rec.getString('name') + '" has no barcode "' + code + '"');
    app.delete(c);
    return { item: require(`${__hooks}/lib_items.js`).get(app, rec) };
  }),
);

/* ------------------------------------------------------------------ stock */

routerAdd('POST', '/api/ops/stock/in', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_stockops.js`).single(app, p, 'in', require(`${__hooks}/lib_util.js`).actor(ev))),
);

routerAdd('POST', '/api/ops/stock/out', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_stockops.js`).single(app, p, 'out', require(`${__hooks}/lib_util.js`).actor(ev))),
);

routerAdd('POST', '/api/ops/stock/move', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_stockops.js`).single(app, p, 'move', require(`${__hooks}/lib_util.js`).actor(ev))),
);

routerAdd('POST', '/api/ops/stock/set', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_stockops.js`).single(app, p, 'set', require(`${__hooks}/lib_util.js`).actor(ev))),
);

routerAdd('POST', '/api/ops/stock/batch', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_stockops.js`).batch(app, p, require(`${__hooks}/lib_util.js`).actor(ev))),
);

/* ---------------------------------------------------------------- history */

routerAdd('GET', '/api/ops/movements/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const f = {
      kind: u.oneOf(p, 'kind', ledger.KINDS, ''),
      reason: u.oneOf(p, 'reason', Object.keys(ledger.REASON_LABELS), ''),
      actor: u.oneOf(p, 'actor', ['you', 'agent', 'system'], ''),
      batch: u.str(p, 'batch', ''),
      ref_type: u.oneOf(p, 'ref_type', ['order', 'count', 'import'], ''),
      ref: u.str(p, 'ref', ''),
      from: u.day(p, 'from', ''),
      to: u.day(p, 'to', ''),
      q: u.str(p, 'q', ''),
      limit: u.int(p, 'limit', 25, 1, 500),
      offset: u.int(p, 'offset', 0, 0, 10000000),
    };
    const it = u.str(p, 'item', '');
    if (it !== '') f.item = core.item(app, it).id;
    const loc = u.str(p, 'location', '');
    if (loc !== '') {
      const rec = core.location(app, loc);
      const ix = require(`${__hooks}/lib_locations.js`).index(app);
      f.locations = [rec.id].concat(u.bool(p, 'include_sub', true) ? ix.descendants(rec.id) : []);
    }
    return ledger.list(app, f);
  }),
);

routerAdd('POST', '/api/ops/movements/undo', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_ledger.js`).undo(app, u.req(p, 'batch', '<batch id from movements.list>'), u.actor(ev));
  }),
);

routerAdd('POST', '/api/ops/movements/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const out = require(`${__hooks}/lib_ledger.js`).removeBatch(app, u.req(p, 'batch', '<batch id from movements.list>'), u.bool(p, 'preview', false));
    if (!u.bool(p, 'preview', false)) out.deleted = true;
    return out;
  }),
);
