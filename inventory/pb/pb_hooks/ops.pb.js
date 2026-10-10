/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: app guide, settings, the Home overview and stockroom map,
 * code lookup, categories, locations and suppliers.
 *
 * Every route here is declared in operations.json, and the UI calls the same
 * routes, so the AI agent (agent-app CLI) can do everything the user can.
 * Routes run in isolated VMs: each handler requires its modules inside
 * itself. Inside runInTransaction only the transaction handle (tx) is used.
 */

/* ------------------------------------------------------------- app guide */

routerAdd('POST', '/api/ops/app/guide', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)),
);

/* --------------------------------------------------------------- settings */

routerAdd('GET', '/api/ops/settings/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).get(app)),
);

routerAdd('POST', '/api/ops/settings/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).update(app, p)),
);

/* --------------------------------------------------------------- overview */

routerAdd('GET', '/api/ops/dashboard/summary', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_dashboard.js`).summary(app)),
);

routerAdd('GET', '/api/ops/map/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_map.js`).get(app)),
);

routerAdd('GET', '/api/ops/lookup/code', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const code = u.req(p, 'code', '0123456789012');
    const hit = core.lookupCode(app, code);
    if (hit === null) {
      return {
        type: 'none',
        code: code,
        message: 'Nothing has the code "' + code + '" yet. Give it to an item with items.add-barcode --item <sku> --code "' + code + '", or create the item with items.add --barcode "' + code + '".',
      };
    }
    if (hit.type === 'location') {
      const ix = require(`${__hooks}/lib_locations.js`).index(app);
      const l = ix.byId[hit.record.id];
      return { type: 'location', via: hit.via, location: { id: l.id, name: l.name, code: l.code, kind: l.kind, path: ix.path(l.id) } };
    }
    return { type: 'item', via: hit.via, item: require(`${__hooks}/lib_items.js`).get(app, hit.record) };
  }),
);

/* ------------------------------------------------------------- categories */

routerAdd('GET', '/api/ops/categories/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const counts = {};
    for (const r of u.rows(app, "SELECT category, COUNT(id) AS n FROM items WHERE archived = false AND category != '' GROUP BY category", { category: '', n: 0 })) counts[r.category] = r.n;
    return {
      categories: app.findRecordsByFilter('categories', '', 'sort,name', 0, 0).map((c) => ({
        id: c.id,
        name: c.getString('name'),
        icon: c.getString('icon') || 'package',
        sort: c.getInt('sort'),
        items: counts[c.id] || 0,
      })),
      icons: require(`${__hooks}/lib_icons.js`).ICONS,
    };
  }),
);

routerAdd('POST', '/api/ops/categories/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const name = u.squash(u.req(p, 'name', '"Packaging"'));
    if (u.idsNocase(app, 'categories', 'name', name, 1).length > 0) throw u.fail(400, 'There is already a category called "' + name + '"');
    const max = u.rows(app, 'SELECT IFNULL(MAX(sort), 0) AS m FROM categories', { m: 0 });
    const rec = new Record(app.findCollectionByNameOrId('categories'));
    rec.set('name', name);
    rec.set('icon', u.str(p, 'icon', ''));
    rec.set('sort', (max.length > 0 ? max[0].m : 0) + 1);
    app.save(rec);
    return { category: { id: rec.id, name: rec.getString('name'), icon: rec.getString('icon'), sort: rec.getInt('sort'), items: 0 } };
  }),
);

routerAdd('POST', '/api/ops/categories/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const rec = core.category(app, u.req(p, 'category', '"Packaging"'));
    if (u.has(p, 'name')) {
      const name = u.squash(u.str(p, 'name', ''));
      const clash = u.idsNocase(app, 'categories', 'name', name, 2).filter((id) => id !== rec.id);
      if (clash.length > 0) throw u.fail(400, 'There is already a category called "' + name + '"');
      rec.set('name', name);
    }
    if (u.has(p, 'icon')) rec.set('icon', u.str(p, 'icon', ''));
    if (u.has(p, 'sort')) rec.set('sort', u.int(p, 'sort', rec.getInt('sort'), 0, 100000));
    app.save(rec);
    return { category: { id: rec.id, name: rec.getString('name'), icon: rec.getString('icon'), sort: rec.getInt('sort') } };
  }),
);

routerAdd('POST', '/api/ops/categories/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const rec = core.category(app, u.req(p, 'category', '"Packaging"'));
    const n = u.rows(app, 'SELECT COUNT(id) AS n FROM items WHERE category = {:c}', { n: 0 }, { c: rec.id });
    const affected = n.length > 0 ? n[0].n : 0;
    const out = { category: { id: rec.id, name: rec.getString('name') }, items_uncategorized: affected };
    if (u.bool(p, 'preview', false)) return out;
    app.runInTransaction((tx) => {
      for (const it of tx.findRecordsByFilter('items', 'category = {:c}', '', 0, 0, { c: rec.id })) {
        it.set('category', '');
        tx.save(it);
      }
      tx.delete(tx.findRecordById('categories', rec.id));
    });
    out.deleted = true;
    return out;
  }),
);

/* -------------------------------------------------------------- locations */

routerAdd('GET', '/api/ops/locations/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_locations.js`).tree(app)),
);

routerAdd('GET', '/api/ops/locations/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_locations.js`).get(app, core.location(app, u.req(p, 'location', 'LOC-001')));
  }),
);

routerAdd('POST', '/api/ops/locations/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const locs = require(`${__hooks}/lib_locations.js`);
    const rec = new Record(app.findCollectionByNameOrId('locations'));
    rec.set('name', u.req(p, 'name', '"Shelf A"'));
    const parent = u.str(p, 'parent', '');
    const parentRec = parent === '' ? null : core.location(app, parent, 'parent');
    rec.set('parent', parentRec === null ? '' : parentRec.id);
    const fallback = locs.defaultChildKind(parentRec === null ? '' : parentRec.getString('kind'));
    if (fallback === null && !u.has(p, 'kind')) throw u.fail(400, locs.holdsText(parentRec.getString('kind')));
    rec.set('kind', u.oneOf(p, 'kind', locs.KINDS, fallback === null ? 'other' : fallback));
    rec.set('code', u.str(p, 'code', ''));
    rec.set('notes', u.str(p, 'notes', '').slice(0, 500));
    const max = u.rows(app, 'SELECT IFNULL(MAX(sort), 0) AS m FROM locations', { m: 0 });
    rec.set('sort', (max.length > 0 ? max[0].m : 0) + 1);
    app.save(rec);
    return locs.get(app, rec);
  }),
);

routerAdd('POST', '/api/ops/locations/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const locs = require(`${__hooks}/lib_locations.js`);
    const rec = core.location(app, u.req(p, 'location', 'LOC-001'));
    if (u.has(p, 'name')) rec.set('name', u.str(p, 'name', ''));
    if (u.has(p, 'parent')) {
      const parent = u.str(p, 'parent', '');
      rec.set('parent', parent === '' ? '' : core.location(app, parent, 'parent').id);
    }
    if (u.has(p, 'kind')) rec.set('kind', u.oneOf(p, 'kind', locs.KINDS, rec.getString('kind')));
    if (u.has(p, 'code')) rec.set('code', u.str(p, 'code', ''));
    if (u.has(p, 'notes')) rec.set('notes', u.str(p, 'notes', '').slice(0, 500));
    app.save(rec);
    return locs.get(app, rec);
  }),
);

routerAdd('POST', '/api/ops/locations/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const locs = require(`${__hooks}/lib_locations.js`);
    const rec = core.location(app, u.req(p, 'location', 'LOC-001'));
    if (u.bool(p, 'preview', false)) return locs.deletePreview(app, rec);
    const out = locs.remove(app, rec);
    out.deleted = true;
    return out;
  }),
);

routerAdd('POST', '/api/ops/locations/place', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const map = require(`${__hooks}/lib_map.js`);
    if (u.bool(p, 'all', false)) {
      if (!u.bool(p, 'reset', false)) throw u.fail(400, 'all=true only goes with reset=true (every place back to the automatic layout)');
      return map.resetAll(app);
    }
    return map.place(app, core.location(app, u.req(p, 'location', 'LOC-001')), p);
  }),
);

routerAdd('POST', '/api/ops/locations/arrange', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const list = u.list(p, 'positions');
    if (list === undefined) throw u.fail(400, 'positions is required: [{"location": "LOC-001", "x": 4, "z": 2, "w": 6, "d": 4}]');
    return require(`${__hooks}/lib_map.js`).arrange(app, list);
  }),
);

/* -------------------------------------------------------------- suppliers */

routerAdd('GET', '/api/ops/suppliers/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_suppliers.js`).list(app)),
);

routerAdd('GET', '/api/ops/suppliers/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_suppliers.js`).get(app, core.supplier(app, u.req(p, 'supplier', '"Acme Supply"')));
  }),
);

routerAdd('POST', '/api/ops/suppliers/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const sup = require(`${__hooks}/lib_suppliers.js`);
    const name = u.squash(u.req(p, 'name', '"Acme Supply"'));
    if (u.idsNocase(app, 'suppliers', 'name', name, 1).length > 0) throw u.fail(400, 'There is already a supplier called "' + name + '"');
    const rec = new Record(app.findCollectionByNameOrId('suppliers'));
    rec.set('lead_time_days', 0);
    sup.apply(rec, p);
    rec.set('name', name);
    app.save(rec);
    return sup.get(app, rec);
  }),
);

routerAdd('POST', '/api/ops/suppliers/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const sup = require(`${__hooks}/lib_suppliers.js`);
    const rec = core.supplier(app, u.req(p, 'supplier', '"Acme Supply"'));
    if (u.has(p, 'name')) {
      const name = u.squash(u.str(p, 'name', ''));
      const clash = u.idsNocase(app, 'suppliers', 'name', name, 2).filter((id) => id !== rec.id);
      if (clash.length > 0) throw u.fail(400, 'There is already a supplier called "' + name + '"');
    }
    sup.apply(rec, p);
    app.save(rec);
    return sup.get(app, rec);
  }),
);

routerAdd('POST', '/api/ops/suppliers/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const sup = require(`${__hooks}/lib_suppliers.js`);
    const rec = core.supplier(app, u.req(p, 'supplier', '"Acme Supply"'));
    if (u.bool(p, 'preview', false)) return sup.deletePreview(app, rec);
    return sup.remove(app, rec);
  }),
);
