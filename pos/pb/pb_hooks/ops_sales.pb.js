/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: open tickets, sales and receipts, shifts and cash, the
 * kitchen, customers, reports and the audit trail.
 *
 * Money moves only at the counter: finalize, shifts, cash and voids need a
 * signed-in person (the AI agent is refused). The agent reads everything,
 * saves tickets for orders it took, emails receipts and runs reports.
 */

/* ------------------------------------------------------------ tickets */

routerAdd('GET', '/api/ops/tickets/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_carts.js`).list(app, p)));

routerAdd('GET', '/api/ops/tickets/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const carts = require(`${__hooks}/lib_carts.js`);
    return carts.serialize(app, carts.mustGet(app, require(`${__hooks}/lib_util.js`).req(p, 'ticket', '<ticket id or ref>')));
  }),
);

routerAdd('POST', '/api/ops/tickets/park', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'park', p, null);
    return require(`${__hooks}/lib_carts.js`).park(e, app, p, ctx);
  }),
);

routerAdd('POST', '/api/ops/tickets/resume', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'park', p, null);
    const carts = require(`${__hooks}/lib_carts.js`);
    return carts.resume(app, carts.mustGet(app, u.req(p, 'ticket', '<ticket id or ref>')), u.str(p, 'register', ''), ctx);
  }),
);

routerAdd('POST', '/api/ops/tickets/release', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'park', p, null);
    const carts = require(`${__hooks}/lib_carts.js`);
    return carts.release(app, carts.mustGet(app, u.req(p, 'ticket', '<ticket id or ref>')));
  }),
);

routerAdd('POST', '/api/ops/tickets/void', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'void_ticket', p, null);
    const carts = require(`${__hooks}/lib_carts.js`);
    return carts.voidTicket(app, carts.mustGet(app, u.req(p, 'ticket', '<ticket id or ref>')), u.str(p, 'reason', ''), ctx);
  }),
);

routerAdd('POST', '/api/ops/tickets/draft', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'park', p, 'draft');
    return require(`${__hooks}/lib_carts.js`).draft(app, p);
  }),
);

/* ------------------------------------------------------------ sales */

routerAdd('POST', '/api/ops/sales/finalize', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_sales.js`).finalize(e, app, p)));

routerAdd('POST', '/api/ops/sales/preview', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_sales.js`).preview(app, p)));

routerAdd('GET', '/api/ops/sales/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_sales.js`).list(app, p)));

routerAdd('GET', '/api/ops/sales/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const sales = require(`${__hooks}/lib_sales.js`);
    return sales.get(app, sales.find(app, require(`${__hooks}/lib_util.js`).req(p, 'sale', 'R1-000123')));
  }),
);

routerAdd('GET', '/api/ops/sales/refundable', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const sales = require(`${__hooks}/lib_sales.js`);
    return sales.refundable(app, sales.find(app, require(`${__hooks}/lib_util.js`).req(p, 'sale', 'R1-000123')));
  }),
);

routerAdd('GET', '/api/ops/sales/receipt-text', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const sales = require(`${__hooks}/lib_sales.js`);
    const sale = sales.get(app, sales.find(app, require(`${__hooks}/lib_util.js`).req(p, 'sale', 'R1-000123')));
    const h = sale.header || {};
    return {
      number: sale.number,
      subject: (sale.kind === 'refund' ? 'Refund ' : 'Receipt ') + sale.number + (h.business_name ? ' from ' + h.business_name : ''),
      text: require(`${__hooks}/lib_receipt.js`).text(sale),
    };
  }),
);

/* ------------------------------------------------------------ receipts */

routerAdd('POST', '/api/ops/receipts/email', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'reprint', p, 'receipts');
    const sales = require(`${__hooks}/lib_sales.js`);
    const sale = sales.find(app, u.req(p, 'sale', 'R1-000123'));
    const email = u.req(p, 'email', 'sam@example.com');
    if (!require(`${__hooks}/lib_customers.js`).EMAIL.test(email) || email.length > 120) throw u.fail(400, 'email must be an email address');
    if (sale.getBool('training')) throw u.fail(409, 'A training sale has no receipt to send.', 'training');
    const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, 'receipt_email_requested', { sale_id: sale.id, email: email }, ctx.actor === 'agent' ? 'cli' : 'ui');
    require(`${__hooks}/lib_core.js`).audit(app, {
      kind: 'receipt_email',
      actor: ctx.actor,
      staff: ctx.staff ? ctx.staff.id : '',
      register: sale.getString('register'),
      ref: sale.getString('number'),
      summary: 'Receipt ' + sale.getString('number') + ' to ' + email + (fired && fired.ok ? '' : ' (not sent: ' + (fired ? fired.message : 'no answer') + ')'),
    });
    if (!fired || !fired.ok) throw u.fail(409, 'Your AI agent could not be asked to send it: ' + (fired ? fired.message : 'no answer'), (fired && fired.code) || 'trigger_refused');
    return { request: fired.id, sale: sale.getString('number'), email: email };
  }),
);

routerAdd('POST', '/api/ops/receipts/reprint', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'reprint', p, null);
    const sales = require(`${__hooks}/lib_sales.js`);
    const sale = sales.find(app, u.req(p, 'sale', 'R1-000123'));
    require(`${__hooks}/lib_core.js`).audit(app, { kind: 'reprint', actor: 'staff', staff: ctx.staff.id, register: sale.getString('register'), ref: sale.getString('number'), summary: 'Reprinted ' + sale.getString('number') });
    return sales.get(app, sale);
  }),
);

/* ------------------------------------------------------------ shifts and cash */

routerAdd('GET', '/api/ops/shifts/current', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const reg = require(`${__hooks}/lib_core.js`).register(app, require(`${__hooks}/lib_util.js`).req(p, 'register', 'R1'));
    return require(`${__hooks}/lib_shifts.js`).current(app, reg);
  }),
);

routerAdd('GET', '/api/ops/shifts/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_shifts.js`).list(app, p)));

routerAdd('GET', '/api/ops/shifts/report', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ref = u.req(p, 'shift', '<shift id>');
    const rec = u.byId(app, 'shifts', ref);
    if (rec === null) throw u.fail(404, 'No shift "' + ref + '". List them with shifts.list.', 'not_found');
    return require(`${__hooks}/lib_shifts.js`).report(app, rec);
  }),
);

routerAdd('POST', '/api/ops/shifts/open', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'shift', p, null);
    const reg = require(`${__hooks}/lib_core.js`).register(app, require(`${__hooks}/lib_util.js`).req(p, 'register', 'R1'));
    return require(`${__hooks}/lib_shifts.js`).open(app, reg, p, ctx);
  }),
);

routerAdd('POST', '/api/ops/shifts/close', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'shift', p, null);
    const reg = require(`${__hooks}/lib_core.js`).register(app, require(`${__hooks}/lib_util.js`).req(p, 'register', 'R1'));
    return require(`${__hooks}/lib_shifts.js`).close(app, reg, p, ctx);
  }),
);

routerAdd('POST', '/api/ops/cash/move', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'cash_move', p, null);
    const reg = require(`${__hooks}/lib_core.js`).register(app, require(`${__hooks}/lib_util.js`).req(p, 'register', 'R1'));
    return require(`${__hooks}/lib_shifts.js`).cashMove(app, reg, p, ctx);
  }),
);

/* ------------------------------------------------------------ kitchen */

routerAdd('GET', '/api/ops/kitchen/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_kitchen.js`).list(app, p)));

routerAdd('GET', '/api/ops/kitchen/board', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_kitchen.js`).board(app)));

routerAdd('POST', '/api/ops/kitchen/bump', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'kitchen', p, null);
    const k = require(`${__hooks}/lib_kitchen.js`);
    return k.bump(app, k.mustGet(app, require(`${__hooks}/lib_util.js`).req(p, 'ticket', '<ticket id>')));
  }),
);

routerAdd('POST', '/api/ops/kitchen/recall', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'kitchen', p, null);
    const k = require(`${__hooks}/lib_kitchen.js`);
    return k.recall(app, k.mustGet(app, require(`${__hooks}/lib_util.js`).req(p, 'ticket', '<ticket id>')));
  }),
);

/* ------------------------------------------------------------ customers */

routerAdd('GET', '/api/ops/customers/list', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_customers.js`).list(app, p)));

routerAdd('GET', '/api/ops/customers/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) =>
    require(`${__hooks}/lib_customers.js`).get(app, require(`${__hooks}/lib_core.js`).customer(app, require(`${__hooks}/lib_util.js`).req(p, 'customer', '"Sam Lee"'))),
  ),
);

routerAdd('POST', '/api/ops/customers/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'customers', p, 'customers');
    return require(`${__hooks}/lib_customers.js`).save(app, new Record(app.findCollectionByNameOrId('customers')), p, true, ctx);
  }),
);

routerAdd('POST', '/api/ops/customers/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'customers', p, 'customers');
    const rec = require(`${__hooks}/lib_core.js`).customer(app, require(`${__hooks}/lib_util.js`).req(p, 'customer', '<customer id>'));
    return require(`${__hooks}/lib_customers.js`).save(app, rec, p, false, ctx);
  }),
);

routerAdd('POST', '/api/ops/customers/archive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'customers_admin', p, 'customers_admin');
    const rec = require(`${__hooks}/lib_core.js`).customer(app, u.req(p, 'customer', '<customer id>'));
    return require(`${__hooks}/lib_customers.js`).setArchived(app, rec, u.bool(p, 'archived', true), ctx);
  }),
);

/* ------------------------------------------------------------ reports */

routerAdd('GET', '/api/ops/reports/summary', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'reports', p, 'reports');
    return require(`${__hooks}/lib_reports.js`).summary(app, p);
  }),
);

routerAdd('GET', '/api/ops/reports/export', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'reports', p, 'reports');
    return require(`${__hooks}/lib_reports.js`).exportCsv(app, p);
  }),
);

routerAdd('GET', '/api/ops/audit/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'reports', p, 'reports');
    return require(`${__hooks}/lib_audit.js`).list(app, p);
  }),
);
