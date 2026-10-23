/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: the catalog (categories, products, modifier groups,
 * discounts), code lookup, stock and menu imports.
 *
 * Staff need the `catalog` permission (managers and owners) to change
 * products; anyone signed in may mark a product or an option sold out. The
 * AI agent may run all of these.
 */

routerAdd('GET', '/api/ops/catalog/register', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_catalog.js`).registerCatalog(app)));

/* ------------------------------------------------------------ categories */

routerAdd('GET', '/api/ops/categories/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_catalog.js`).listCategories(app)));

routerAdd('POST', '/api/ops/categories/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    return require(`${__hooks}/lib_catalog.js`).saveCategory(app, new Record(app.findCollectionByNameOrId('categories')), p, true, ctx);
  }),
);

routerAdd('POST', '/api/ops/categories/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).category(app, u.req(p, 'category', '"Coffee"'));
    return require(`${__hooks}/lib_catalog.js`).saveCategory(app, rec, p, false, ctx);
  }),
);

routerAdd('POST', '/api/ops/categories/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).category(app, u.req(p, 'category', '"Coffee"'));
    return require(`${__hooks}/lib_catalog.js`).deleteCategory(app, rec, ctx);
  }),
);

routerAdd('POST', '/api/ops/categories/reorder', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const ids = (u.list(p, 'categories') || []).map((x) => require(`${__hooks}/lib_core.js`).category(app, String(x)).id);
    return require(`${__hooks}/lib_catalog.js`).reorderCategories(app, ids, ctx);
  }),
);

/* ------------------------------------------------------------ products */

routerAdd('GET', '/api/ops/products/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_catalog.js`).listProducts(app, p)));

routerAdd('GET', '/api/ops/products/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_catalog.js`).getProduct(app, require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"')));
  }),
);

routerAdd('POST', '/api/ops/products/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    return require(`${__hooks}/lib_catalog.js`).saveProduct(e, app, new Record(app.findCollectionByNameOrId('products')), p, true, ctx);
  }),
);

routerAdd('POST', '/api/ops/products/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"'));
    return require(`${__hooks}/lib_catalog.js`).saveProduct(e, app, rec, p, false, ctx);
  }),
);

routerAdd('POST', '/api/ops/products/set-available', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'sell', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"'));
    return require(`${__hooks}/lib_catalog.js`).setAvailable(app, rec, u.bool(p, 'available', true), ctx);
  }),
);

routerAdd('POST', '/api/ops/products/archive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"'));
    return require(`${__hooks}/lib_catalog.js`).setArchived(app, rec, true, ctx);
  }),
);

routerAdd('POST', '/api/ops/products/restore', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '<id>'));
    return require(`${__hooks}/lib_catalog.js`).setArchived(app, rec, false, ctx);
  }),
);

routerAdd('POST', '/api/ops/products/reorder', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const ids = (u.list(p, 'products') || []).map((x) => require(`${__hooks}/lib_core.js`).product(app, String(x)).id);
    return require(`${__hooks}/lib_catalog.js`).reorderProducts(app, ids, u.bool(p, 'favorites', false));
  }),
);

routerAdd('POST', '/api/ops/products/approve', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    if (u.isAgent(e)) throw u.fail(403, 'Imported products are approved by a person on the Products page.', 'agent_not_permitted');
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, null);
    return require(`${__hooks}/lib_catalog.js`).reviewDrafts(app, (u.list(p, 'products') || []).map(String), true, ctx);
  }),
);

routerAdd('POST', '/api/ops/products/discard', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    return require(`${__hooks}/lib_catalog.js`).reviewDrafts(app, (u.list(p, 'products') || []).map(String), false, ctx);
  }),
);

routerAdd('POST', '/api/ops/products/import', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    // What the AI agent imports waits for a person's review; a person's own import is sold at once.
    const status = ctx.actor === 'agent' ? 'draft' : u.oneOf(p, 'status', ['active', 'draft'], 'active');
    const importRef = u.str(p, 'import', '');
    if (importRef !== '') require(`${__hooks}/lib_imports.js`).mustGet(app, importRef);
    return require(`${__hooks}/lib_catalog.js`).importRows(e, app, u.list(p, 'rows'), status, importRef, ctx);
  }),
);

/* ------------------------------------------------------------ modifiers */

routerAdd('GET', '/api/ops/modifiers/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_catalog.js`).listGroups(app)));

routerAdd('POST', '/api/ops/modifiers/add-group', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    return require(`${__hooks}/lib_catalog.js`).saveGroup(app, new Record(app.findCollectionByNameOrId('modifier_groups')), p, true, ctx);
  }),
);

routerAdd('POST', '/api/ops/modifiers/update-group', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).group(app, u.req(p, 'group', '"Milk"'));
    return require(`${__hooks}/lib_catalog.js`).saveGroup(app, rec, p, false, ctx);
  }),
);

routerAdd('POST', '/api/ops/modifiers/delete-group', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).group(app, u.req(p, 'group', '"Milk"'));
    return require(`${__hooks}/lib_catalog.js`).deleteGroup(app, rec, ctx);
  }),
);

routerAdd('POST', '/api/ops/modifiers/set-available', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'sell', p, 'catalog');
    const ref = u.req(p, 'option', '<option id>');
    let rec = u.byId(app, 'modifiers', ref);
    if (rec === null) {
      const groupRef = u.str(p, 'group', '');
      if (groupRef === '') throw u.fail(400, 'Give the option id, or its name with group=<group name>');
      const g = require(`${__hooks}/lib_core.js`).group(app, groupRef);
      rec = app.findRecordsByFilter('modifiers', 'modifier_group = {:g}', '', 0, 0, { g: g.id }).filter((m) => m.getString('name').toLowerCase() === ref.toLowerCase())[0] || null;
      if (rec === null) throw u.fail(404, 'No option "' + ref + '" in ' + g.getString('name'), 'not_found');
    }
    return require(`${__hooks}/lib_catalog.js`).setOptionAvailable(app, rec, u.bool(p, 'available', true), ctx);
  }),
);

/* ------------------------------------------------------------ discounts */

routerAdd('GET', '/api/ops/discounts/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_catalog.js`).listDiscounts(app)));

routerAdd('POST', '/api/ops/discounts/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    return require(`${__hooks}/lib_catalog.js`).saveDiscount(app, new Record(app.findCollectionByNameOrId('discounts')), p, true, ctx);
  }),
);

routerAdd('POST', '/api/ops/discounts/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).discount(app, u.req(p, 'discount', '"Staff"'));
    return require(`${__hooks}/lib_catalog.js`).saveDiscount(app, rec, p, false, ctx);
  }),
);

routerAdd('POST', '/api/ops/discounts/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'catalog', p, 'catalog');
    const rec = require(`${__hooks}/lib_core.js`).discount(app, u.req(p, 'discount', '"Staff"'));
    return require(`${__hooks}/lib_catalog.js`).deleteDiscount(app, rec, ctx);
  }),
);

/* ------------------------------------------------------------ lookup */

routerAdd('GET', '/api/ops/lookup/code', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_catalog.js`).lookup(app, require(`${__hooks}/lib_util.js`).req(p, 'code', '9555001234567'))),
);

/* ------------------------------------------------------------ stock */

routerAdd('GET', '/api/ops/stock/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_stock.js`).list(app, p)));

routerAdd('GET', '/api/ops/stock/history', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"'));
    return require(`${__hooks}/lib_stock.js`).history(app, rec, u.int(p, 'limit', 50, 1, 500));
  }),
);

routerAdd('POST', '/api/ops/stock/receive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'stock', p, 'stock');
    const stock = require(`${__hooks}/lib_stock.js`);
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"'));
    const qty = u.int(p, 'qty', null, 1, 1000000);
    if (qty === null) throw u.fail(400, 'qty is required: how many came in, e.g. qty=24');
    return stock.change(app, rec, stock.variantFor(app, rec, u.str(p, 'variant', '')), qty, 'receive', u.str(p, 'reason', 'Delivery').slice(0, 200), ctx);
  }),
);

routerAdd('POST', '/api/ops/stock/adjust', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'stock', p, 'stock');
    const stock = require(`${__hooks}/lib_stock.js`);
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"'));
    const qty = u.int(p, 'qty', null, -1000000, 1000000);
    if (qty === null || qty === 0) throw u.fail(400, 'qty is required: the change, e.g. qty=-2 for two broken');
    const reason = u.squash(u.req(p, 'reason', '"Damaged"'));
    return stock.change(app, rec, stock.variantFor(app, rec, u.str(p, 'variant', '')), qty, 'adjust', reason, ctx);
  }),
);

routerAdd('POST', '/api/ops/stock/count', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'stock', p, 'stock');
    const stock = require(`${__hooks}/lib_stock.js`);
    const rec = require(`${__hooks}/lib_core.js`).product(app, u.req(p, 'product', '"Latte"'));
    const counted = u.int(p, 'counted', null, -1000000, 1000000);
    if (counted === null) throw u.fail(400, 'counted is required: how many are there, e.g. counted=18');
    return stock.count(app, rec, stock.variantFor(app, rec, u.str(p, 'variant', '')), counted, u.str(p, 'reason', '').slice(0, 200), ctx);
  }),
);

/* ------------------------------------------------------------ imports */

routerAdd('GET', '/api/ops/imports/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_imports.js`).list(app, p)));

routerAdd('POST', '/api/ops/imports/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'imports', p, 'imports');
    return require(`${__hooks}/lib_imports.js`).add(e, app, p, ctx);
  }),
);

routerAdd('POST', '/api/ops/imports/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'imports', p, 'imports');
    const imp = require(`${__hooks}/lib_imports.js`);
    return imp.start(app, imp.mustGet(app, u.req(p, 'import', '<import id>')));
  }),
);

routerAdd('POST', '/api/ops/imports/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'imports', p, 'imports');
    const imp = require(`${__hooks}/lib_imports.js`);
    return imp.complete(app, imp.mustGet(app, u.req(p, 'import', '<import id>')), u.str(p, 'summary', ''));
  }),
);

routerAdd('POST', '/api/ops/imports/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'imports', p, 'imports');
    const imp = require(`${__hooks}/lib_imports.js`);
    return imp.failImport(app, imp.mustGet(app, u.req(p, 'import', '<import id>')), u.str(p, 'reason', ''));
  }),
);

routerAdd('POST', '/api/ops/imports/retry', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'imports', p, 'imports');
    const imp = require(`${__hooks}/lib_imports.js`);
    return imp.retry(app, imp.mustGet(app, u.req(p, 'import', '<import id>')));
  }),
);

routerAdd('POST', '/api/ops/imports/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'imports', p, 'imports');
    const imp = require(`${__hooks}/lib_imports.js`);
    return imp.remove(app, imp.mustGet(app, u.req(p, 'import', '<import id>')));
  }),
);
