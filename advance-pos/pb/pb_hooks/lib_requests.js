/// <reference path="../pb_data/types.d.ts" />
/**
 * Requests to your AI agent: send a receipt to a customer, review a closed
 * shift, draft a restock list, answer a question about the business. Each
 * is a row the person follows in the app (sent, working, done, failed) and
 * a trigger that asks the agent; requests.get hands the agent everything it
 * needs (the receipt text, the Z report, the stock picture, the numbers).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

const TRIGGER = { receipt: 'receipt_requested', shift_review: 'shift_review_requested', restock: 'restock_requested', question: 'question_asked' };
const KINDS = Object.keys(TRIGGER);

function json(app, r) {
  const names = require(`${__hooks}/lib_audit.js`).staffNames(app);
  return {
    id: r.id,
    kind: r.getString('kind'),
    title: r.getString('title'),
    body: r.getString('body'),
    order: r.getString('order'),
    shift: r.getString('shift'),
    customer: r.getString('customer'),
    contact: r.getString('contact'),
    status: r.getString('status'),
    result: r.getString('result'),
    staff: names[r.getString('staff')] || '',
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

/** Save a request and fire its trigger (used by requests.create and by closing a shift). */
function fireFor(app, c, f) {
  let rec = null;
  app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('requests'));
    rec.set('kind', f.kind);
    rec.set('title', String(f.title || '').slice(0, 200));
    rec.set('body', String(f.body || '').slice(0, 4000));
    for (const k of ['order', 'shift', 'customer', 'contact']) if (f[k]) rec.set(k, f[k]);
    rec.set('status', 'sent');
    if (c && c.staffId) rec.set('staff', c.staffId);
    tx.save(rec);
  });
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, TRIGGER[f.kind], { request: rec.id }, 'hook');
  if (fired.ok) {
    rec.set('request_id', fired.id);
    app.save(rec);
  }
  return { request: json(app, rec), asked: fired.ok, message: fired.ok ? 'Sent to your AI agent.' : 'Saved, but your AI agent was not asked: ' + fired.message };
}

function create(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind === '') throw util.fail(400, 'kind is required: ' + KINDS.join(', '));
  if (c.actor === 'agent') throw util.fail(400, 'Requests are how the app asks your AI agent; the agent does the work directly');
  const f = { kind: kind, body: util.str(p, 'body', '') };
  if (kind === 'receipt') {
    const o = require(`${__hooks}/lib_orders.js`).orderRef(app, util.req(p, 'order', '<receipt number>'));
    if (o.getString('status') !== 'paid') throw util.fail(400, 'Only a paid sale has a receipt to send');
    let contact = util.str(p, 'contact', '');
    const cust = o.getString('customer') === '' ? null : util.byId(app, 'customers', o.getString('customer'));
    if (contact === '' && cust !== null) contact = cust.getString('email') || cust.getString('phone');
    if (contact === '') throw util.fail(400, 'contact is required: the email or phone to send the receipt to', { code: 'contact_needed' });
    if (contact.indexOf('@') >= 0) require(`${__hooks}/lib_customers.js`).cleanEmail(contact);
    else require(`${__hooks}/lib_customers.js`).cleanPhone(contact);
    f.order = o.id;
    f.contact = contact;
    if (cust !== null) f.customer = cust.id;
    f.title = 'Send receipt ' + o.getString('number') + ' to ' + contact;
  } else if (kind === 'shift_review') {
    const sh = util.byId(app, 'shifts', util.req(p, 'shift', '<shift id>'));
    if (sh === null) throw util.fail(404, 'No such drawer session');
    if (sh.getString('status') !== 'closed') throw util.fail(400, 'Close the drawer first; then it can be reviewed');
    f.shift = sh.id;
    f.title = 'Review drawer session ' + sh.getInt('number');
  } else if (kind === 'restock') {
    auth().need(app, c, 'manage_stock', p, { what: 'Asking for a restock list' });
    f.title = 'Draft a restock list';
  } else {
    auth().need(app, c, 'view_reports', p, { what: 'Asking about the business' });
    if (f.body.trim() === '') throw util.fail(400, 'body is required: the question');
    f.title = f.body.trim().split('\n')[0].slice(0, 120);
  }
  return fireFor(app, c, f);
}

function list(app, e, p) {
  const util = u();
  auth().context(app, e, p);
  const filters = [];
  const bind = {};
  const status = util.oneOf(p, 'status', ['sent', 'working', 'done', 'failed'], '');
  if (status !== '') {
    filters.push('status = {:s}');
    bind.s = status;
  }
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    filters.push('kind = {:k}');
    bind.k = kind;
  }
  const limit = util.int(p, 'limit', 50, 1, 200);
  const rows = app.findRecordsByFilter('requests', filters.join(' && '), '-created', limit + 1, 0, bind);
  return { requests: rows.slice(0, limit).map((r) => json(app, r)), more: rows.length > limit };
}

/** One request with what the agent needs to do it. */
function get(app, e, p) {
  const util = u();
  auth().context(app, e, p);
  const r = util.byId(app, 'requests', util.req(p, 'request', '<request id>'));
  if (r === null) throw util.fail(404, 'No such request');
  const out = { request: json(app, r) };
  const kind = r.getString('kind');
  if (kind === 'receipt' && r.getString('order') !== '') {
    out.receipt = require(`${__hooks}/lib_receipt.js`).build(app, { order: r.getString('order') }).receipt;
  }
  if (kind === 'shift_review' && r.getString('shift') !== '') {
    const sh = util.byId(app, 'shifts', r.getString('shift'));
    if (sh !== null) {
      out.shift = require(`${__hooks}/lib_shifts.js`).shiftJson(app, sh, true);
      const opened = sh.getString('opened_at');
      const closed = sh.getString('closed_at') || util.dbDate(new Date());
      out.events = app
        .findRecordsByFilter('events', 'register = {:r} && created >= {:a} && created <= {:b} && kind != "sign_in"', '-created', 300, 0, { r: sh.getString('register'), a: opened, b: closed })
        .map((x) => ({ kind: x.getString('kind'), detail: x.getString('detail'), amount: x.getInt('amount'), created: x.getString('created') }));
      const prev = app.findRecordsByFilter('shifts', "register = {:r} && status = 'closed' && closed_at < {:a}", '-closed_at', 5, 0, { r: sh.getString('register'), a: sh.getString('closed_at') });
      out.previous_shifts = prev.map((x) => ({ number: x.getInt('number'), difference: x.getInt('difference'), net_sales: ((util.getJson(x, 'report') || {}).summary || {}).net_sales || 0, closed_at: x.getString('closed_at') }));
    }
  }
  if (kind === 'restock') out.stock = restockPicture(app);
  if (kind === 'question') out.status = require(`${__hooks}/lib_settings.js`).status(app);
  return out;
}

/** Low and out of stock items with how fast each sold over the last 28 days. */
function restockPicture(app) {
  const util = u();
  const levels = require(`${__hooks}/lib_stock.js`).levels(app, { status: 'low' });
  const since = new Date();
  since.setDate(since.getDate() - 28);
  const sold = {};
  for (const x of util.rows(app, "SELECT l.variant AS v, COALESCE(SUM(l.qty), 0) AS q FROM order_lines l JOIN orders o ON o.id = l.\"order\" WHERE o.status = 'paid' AND o.paid_at >= {:a} AND l.variant != '' GROUP BY l.variant", { v: '', q: -0 }, { a: util.dbDate(since) })) sold[x.v] = x.q;
  return {
    items: levels.levels.map((x) => Object.assign(x, { sold_28d: sold[x.variant] || 0, per_day: Math.round(((sold[x.variant] || 0) / 28) * 100) / 100 })),
    stock_value: levels.value,
    stock_value_text: levels.value_text,
  };
}

function update(app, e, p) {
  const util = u();
  const r = util.byId(app, 'requests', util.req(p, 'request', '<request id>'));
  if (r === null) throw util.fail(404, 'No such request');
  const status = util.oneOf(p, 'status', ['working', 'done', 'failed'], '');
  const order = ['sent', 'working', 'done', 'failed'];
  if (status !== '') {
    const cur = r.getString('status');
    if (cur === 'done' || cur === 'failed') throw util.fail(400, 'This request is already ' + cur);
    if (order.indexOf(status) < order.indexOf(cur)) throw util.fail(400, 'Status only moves forward (now ' + cur + ')');
    r.set('status', status);
  }
  if (util.has(p, 'result')) r.set('result', util.str(p, 'result', '').slice(0, 20000));
  app.save(r);
  return { request: json(app, r) };
}

module.exports = { TRIGGER: TRIGGER, KINDS: KINDS, json: json, fireFor: fireFor, create: create, list: list, get: get, update: update, restockPicture: restockPicture };
