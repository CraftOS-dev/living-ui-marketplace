/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: reordering, purchase orders and documents (packing slips and
 * invoices for the AI agent to read).
 *
 * Every route is declared in operations.json and is what the UI calls too.
 */

/* ---------------------------------------------------------------- reorder */

routerAdd('GET', '/api/ops/reorder/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_reorder.js`).list(app)),
);

routerAdd('POST', '/api/ops/reorder/create-orders', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_reorder.js`).createOrders(app, u.list(p, 'items'), u.actor(ev), u.str(p, 'note', ''));
  }),
);

/* ----------------------------------------------------------------- orders */

routerAdd('GET', '/api/ops/orders/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const orders = require(`${__hooks}/lib_orders.js`);
    const f = {
      status: u.oneOf(p, 'status', ['open', 'all'].concat(orders.STATUSES), 'open'),
      q: u.str(p, 'q', ''),
      limit: u.int(p, 'limit', 100, 1, 500),
      offset: u.int(p, 'offset', 0, 0, 1000000),
    };
    const sup = u.str(p, 'supplier', '');
    if (sup !== '') f.supplier = core.supplier(app, sup).id;
    const it = u.str(p, 'item', '');
    if (it !== '') f.item = core.item(app, it).id;
    return orders.list(app, f);
  }),
);

routerAdd('GET', '/api/ops/orders/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const orders = require(`${__hooks}/lib_orders.js`);
    const rec = core.order(app, u.req(p, 'order', 'PO-0001'));
    const out = orders.serialize(app, rec);
    out.documents = app.findRecordsByFilter('documents', 'po = {:o}', '-created', 20, 0, { o: rec.id }).map((d) => require(`${__hooks}/lib_docs.js`).serialize(app, d));
    out.receipts = require(`${__hooks}/lib_ledger.js`).list(app, { ref_type: 'order', ref: rec.id, limit: 200, offset: 0 }).movements;
    return out;
  }),
);

routerAdd('GET', '/api/ops/orders/text', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const orders = require(`${__hooks}/lib_orders.js`);
    const rec = core.order(app, u.req(p, 'order', 'PO-0001'));
    const sup = rec.getString('supplier') !== '' ? u.byId(app, 'suppliers', rec.getString('supplier')) : null;
    return {
      number: rec.getString('number'),
      to: sup !== null ? sup.getString('email') : '',
      subject: 'Purchase order ' + rec.getString('number'),
      text: orders.text(app, rec),
    };
  }),
);

routerAdd('POST', '/api/ops/orders/create', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_orders.js`).create(app, p, u.actor(ev));
  }),
);

routerAdd('POST', '/api/ops/orders/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).update(app, core.order(app, u.req(p, 'order', 'PO-0001')), p);
  }),
);

routerAdd('POST', '/api/ops/orders/add-line', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).addLine(app, core.order(app, u.req(p, 'order', 'PO-0001')), p);
  }),
);

routerAdd('POST', '/api/ops/orders/update-line', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const orders = require(`${__hooks}/lib_orders.js`);
    return orders.updateLine(app, orders.lineOf(app, u.req(p, 'line', '<line id from orders.get>')), p);
  }),
);

routerAdd('POST', '/api/ops/orders/remove-line', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const orders = require(`${__hooks}/lib_orders.js`);
    return orders.removeLine(app, orders.lineOf(app, u.req(p, 'line', '<line id from orders.get>')));
  }),
);

routerAdd('POST', '/api/ops/orders/mark-ordered', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).markOrdered(app, core.order(app, u.req(p, 'order', 'PO-0001')), p);
  }),
);

routerAdd('POST', '/api/ops/orders/back-to-draft', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).backToDraft(app, core.order(app, u.req(p, 'order', 'PO-0001')));
  }),
);

routerAdd('POST', '/api/ops/orders/receive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).receive(app, core.order(app, u.req(p, 'order', 'PO-0001')), p, u.actor(ev), { note: u.str(p, 'note', '') });
  }),
);

routerAdd('POST', '/api/ops/orders/close', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).close(app, core.order(app, u.req(p, 'order', 'PO-0001')));
  }),
);

routerAdd('POST', '/api/ops/orders/cancel', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).cancel(app, core.order(app, u.req(p, 'order', 'PO-0001')));
  }),
);

routerAdd('POST', '/api/ops/orders/reopen', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    return require(`${__hooks}/lib_orders.js`).reopen(app, core.order(app, u.req(p, 'order', 'PO-0001')));
  }),
);

routerAdd('POST', '/api/ops/orders/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const orders = require(`${__hooks}/lib_orders.js`);
    const rec = core.order(app, u.req(p, 'order', 'PO-0001'));
    const out = orders.deletePreview(app, rec);
    if (u.bool(p, 'preview', false)) return out;
    app.runInTransaction((tx) => {
      for (const d of tx.findRecordsByFilter('documents', 'po = {:o}', '', 0, 0, { o: rec.id })) {
        d.set('po', '');
        tx.save(d);
      }
      tx.delete(tx.findRecordById('orders', rec.id));
    });
    out.deleted = true;
    return out;
  }),
);

/* -------------------------------------------------------------- documents */

routerAdd('GET', '/api/ops/documents/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    return require(`${__hooks}/lib_docs.js`).list(app, u.oneOf(p, 'status', ['waiting', 'reading', 'done', 'failed'], ''), u.int(p, 'limit', 50, 1, 500));
  }),
);

routerAdd('POST', '/api/ops/documents/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const files = u.uploadedAll(ev, 'file');
    const path = u.str(p, 'path', '');
    if (path !== '') files.push(u.localFile(path, 'path'));
    if (files.length === 0) throw u.fail(400, 'Give path (the absolute path of a photo or PDF) or upload a file');
    if (files.length > 20) throw u.fail(400, 'At most 20 documents at a time');
    const by = u.actor(ev) === 'agent' ? 'agent' : 'you';
    const made = [];
    app.runInTransaction((tx) => {
      for (const f of files) made.push(docs.store(tx, f, by).id);
    });
    return { documents: made.map((id) => docs.serialize(app, app.findRecordById('documents', id))) };
  }),
);

routerAdd('POST', '/api/ops/documents/start', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const rec = docs.mustGet(app, u.req(p, 'document', '<document id>'));
    if (rec.getString('status') === 'done') throw u.fail(400, 'This document was already recorded');
    rec.set('status', 'reading');
    rec.set('error', '');
    app.save(rec);
    return docs.serialize(app, rec);
  }),
);

routerAdd('POST', '/api/ops/documents/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const rec = docs.mustGet(app, u.req(p, 'document', '<document id>'));
    rec.set('summary', u.req(p, 'summary', '"Received 3 lines on PO-0004"').slice(0, 2000));
    const o = u.str(p, 'order', '');
    rec.set('po', o === '' ? '' : core.order(app, o).id);
    const batch = u.str(p, 'batch', '');
    if (batch !== '' && require(`${__hooks}/lib_ledger.js`).batchRows(app, batch).length === 0) throw u.fail(400, 'No history entry with batch "' + batch + '"');
    rec.set('batch', batch);
    rec.set('status', 'done');
    rec.set('error', '');
    app.save(rec);
    return docs.serialize(app, rec);
  }),
);

routerAdd('POST', '/api/ops/documents/fail', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const rec = docs.mustGet(app, u.req(p, 'document', '<document id>'));
    rec.set('status', 'failed');
    rec.set('error', u.req(p, 'reason', '"The quantities are not readable"').slice(0, 500));
    app.save(rec);
    return docs.serialize(app, rec);
  }),
);

routerAdd('POST', '/api/ops/documents/retry', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const rec = docs.mustGet(app, u.req(p, 'document', '<document id>'));
    if (rec.getString('status') === 'done') throw u.fail(400, 'This document was already recorded');
    rec.set('status', 'waiting');
    rec.set('error', '');
    app.save(rec);
    docs.markDirty(app);
    const asked = docs.fireIfNeeded(app);
    const out = docs.serialize(app, rec);
    out.asked_agent = asked.fired === true;
    return out;
  }),
);

routerAdd('POST', '/api/ops/documents/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const docs = require(`${__hooks}/lib_docs.js`);
    const rec = docs.mustGet(app, u.req(p, 'document', '<document id>'));
    app.delete(rec);
    return { deleted: true, id: rec.id, stock_kept: rec.getString('batch') !== '' };
  }),
);
