/// <reference path="../pb_data/types.d.ts" />
/**
 * Every operation of the app: what the register calls and what your AI
 * agent runs through the agent-app CLI. Each route has a matching entry in
 * operations.json. Logic lives in the lib_*.js modules, required inside
 * each handler (Goja: file scope is invisible to route callbacks).
 */

// One wrapper: params from query and body, JSON answers, errors with their status.
// (Each callback requires its module itself; nothing from file scope reaches it.)

/* ------------------------------------------------------------- the store */
routerAdd('GET', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));
routerAdd('GET', '/api/ops/app/status', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).status(app)));
routerAdd('GET', '/api/ops/setup/status', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).setupStatus(app)));
routerAdd('POST', '/api/ops/setup/complete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_settings.js`).setupComplete(app, ev, p)));
routerAdd('POST', '/api/ops/auth/unlock', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_auth.js`).unlock(app, p)));
routerAdd('GET', '/api/ops/auth/session', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const A = require(`${__hooks}/lib_auth.js`);
    const c = A.context(app, ev, p);
    return { actor: c.actor, staff: c.staff === null ? null : A.staffJson(c.staff), register: c.register === null ? null : { id: c.register.id, name: c.register.getString('name') }, role: c.role, permissions: c.perms };
  }),
);
routerAdd('GET', '/api/ops/settings/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_settings.js`).get(app);
  }),
);
routerAdd('POST', '/api/ops/settings/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_settings.js`).update(app, ev, p)));
routerAdd('POST', '/api/ops/permissions/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const A = require(`${__hooks}/lib_auth.js`);
    return A.saveMatrix(app, A.context(app, ev, p), p);
  }),
);

/* ------------------------------------------------------ registers, staff */
routerAdd('GET', '/api/ops/registers/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_people.js`).registersList(app);
  }),
);
routerAdd('POST', '/api/ops/registers/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_people.js`).registersSave(app, ev, p)));
routerAdd('POST', '/api/ops/registers/focus', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_people.js`).registersFocus(app, ev, p)));
routerAdd('GET', '/api/ops/display/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_people.js`).display(app, p)));
routerAdd('GET', '/api/ops/staff/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_people.js`).staffList(app, ev, p)));
routerAdd('POST', '/api/ops/staff/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_people.js`).staffSave(app, ev, p)));
routerAdd('POST', '/api/ops/staff/clock', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_people.js`).clock(app, ev, p)));
routerAdd('GET', '/api/ops/timeclock/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_people.js`).timeclockList(app, ev, p)));
routerAdd('POST', '/api/ops/timeclock/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_people.js`).timeclockSave(app, ev, p)));

/* ---------------------------------------------------------------- catalog */
routerAdd('GET', '/api/ops/catalog/register', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_catalog.js`).registerCatalog(app);
  }),
);
routerAdd('GET', '/api/ops/categories/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_catalog.js`).categoriesList(app);
  }),
);
routerAdd('POST', '/api/ops/categories/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_catalog.js`).categoriesSave(app, ev, p)));
routerAdd('GET', '/api/ops/taxes/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_catalog.js`).taxesList(app);
  }),
);
routerAdd('POST', '/api/ops/taxes/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_catalog.js`).taxesSave(app, ev, p)));
routerAdd('GET', '/api/ops/modifiers/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_catalog.js`).modifiersList(app);
  }),
);
routerAdd('POST', '/api/ops/modifiers/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_catalog.js`).modifiersSave(app, ev, p)));
routerAdd('GET', '/api/ops/products/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_catalog.js`).productsList(app, ev, p);
  }),
);
routerAdd('GET', '/api/ops/products/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_catalog.js`).productsGet(app, p);
  }),
);
routerAdd('GET', '/api/ops/products/lookup', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_catalog.js`).lookup(app, p);
  }),
);
routerAdd('POST', '/api/ops/products/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_catalog.js`).productsSave(app, ev, p)));
routerAdd('POST', '/api/ops/products/import', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_csv.js`).importProducts(app, ev, p)));
routerAdd('GET', '/api/ops/products/export', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_csv.js`).exportProducts(app, ev, p)));

/* ------------------------------------------------------------------ stock */
routerAdd('GET', '/api/ops/stock/levels', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_stock.js`).levels(app, p);
  }),
);
routerAdd('POST', '/api/ops/stock/change', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_stock.js`).change(app, ev, p)));
routerAdd('GET', '/api/ops/stock/moves', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_stock.js`).moves(app, p);
  }),
);

/* ------------------------------------------------------------- customers */
routerAdd('GET', '/api/ops/customers/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_customers.js`).list(app, p);
  }),
);
routerAdd('GET', '/api/ops/customers/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_customers.js`).get(app, p);
  }),
);
routerAdd('POST', '/api/ops/customers/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_customers.js`).save(app, ev, p)));
routerAdd('POST', '/api/ops/customers/adjust', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_customers.js`).adjust(app, ev, p)));
routerAdd('POST', '/api/ops/customers/import', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_csv.js`).importCustomers(app, ev, p)));
routerAdd('GET', '/api/ops/customers/export', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_csv.js`).exportCustomers(app, ev, p)));
routerAdd('GET', '/api/ops/giftcards/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_customers.js`).cardsList(app, p);
  }),
);
routerAdd('GET', '/api/ops/giftcards/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_customers.js`).cardsGet(app, p);
  }),
);
routerAdd('POST', '/api/ops/giftcards/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_customers.js`).cardsSave(app, ev, p)));
routerAdd('POST', '/api/ops/giftcards/adjust', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_customers.js`).cardsAdjust(app, ev, p)));

/* ------------------------------------------------------------ promotions */
routerAdd('GET', '/api/ops/discounts/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_discounts.js`).list(app, p);
  }),
);
routerAdd('POST', '/api/ops/discounts/save', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_discounts.js`).save(app, ev, p)));

/* ------------------------------------------------------------------ sales */
routerAdd('GET', '/api/ops/orders/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).list(app, ev, p)));
routerAdd('GET', '/api/ops/orders/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).get(app, ev, p)));
routerAdd('POST', '/api/ops/orders/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).add(app, ev, p)));
routerAdd('POST', '/api/ops/orders/line', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).updateLine(app, ev, p)));
routerAdd('POST', '/api/ops/orders/remove', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).removeLine(app, ev, p)));
routerAdd('POST', '/api/ops/orders/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).update(app, ev, p)));
routerAdd('POST', '/api/ops/orders/return', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).startReturn(app, ev, p)));
routerAdd('POST', '/api/ops/orders/void', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).voidOrder(app, ev, p)));
routerAdd('POST', '/api/ops/orders/complete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_orders.js`).complete(app, ev, p)));
routerAdd('GET', '/api/ops/orders/receipt', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    require(`${__hooks}/lib_auth.js`).context(app, ev, p);
    return require(`${__hooks}/lib_receipt.js`).build(app, p);
  }),
);
routerAdd('POST', '/api/ops/payments/add', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_payments.js`).add(app, ev, p)));
routerAdd('POST', '/api/ops/payments/void', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_payments.js`).voidPayment(app, ev, p)));

/* ------------------------------------------------------------- the drawer */
routerAdd('GET', '/api/ops/shifts/current', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_shifts.js`).current(app, ev, p)));
routerAdd('POST', '/api/ops/shifts/open', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_shifts.js`).open(app, ev, p)));
routerAdd('POST', '/api/ops/shifts/cash', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_shifts.js`).cash(app, ev, p)));
routerAdd('POST', '/api/ops/shifts/close', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_shifts.js`).close(app, ev, p)));
routerAdd('GET', '/api/ops/shifts/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_shifts.js`).list(app, ev, p)));
routerAdd('GET', '/api/ops/shifts/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_shifts.js`).get(app, ev, p)));

/* ---------------------------------------------------------------- reports */
routerAdd('GET', '/api/ops/reports/summary', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_reports.js`).summary(app, ev, p)));
routerAdd('GET', '/api/ops/reports/breakdown', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_reports.js`).breakdown(app, ev, p)));
routerAdd('GET', '/api/ops/reports/export', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_reports.js`).exportCsv(app, ev, p)));
routerAdd('GET', '/api/ops/events/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const A = require(`${__hooks}/lib_auth.js`);
    const c = A.context(app, ev, p);
    A.need(app, c, 'view_reports', p, { what: 'The audit log' });
    return require(`${__hooks}/lib_audit.js`).list(app, p);
  }),
);

/* ------------------------------------------------------ your AI agent etc */
routerAdd('POST', '/api/ops/requests/create', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_requests.js`).create(app, ev, p)));
routerAdd('GET', '/api/ops/requests/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_requests.js`).list(app, ev, p)));
routerAdd('GET', '/api/ops/requests/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_requests.js`).get(app, ev, p)));
routerAdd('POST', '/api/ops/requests/update', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_requests.js`).update(app, ev, p)));
routerAdd('POST', '/api/ops/records/delete', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => require(`${__hooks}/lib_delete.js`).del(app, ev, p)));
