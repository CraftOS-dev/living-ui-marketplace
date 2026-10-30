/// <reference path="../pb_data/types.d.ts" />
/**
 * Buyers across every shop. One buyer is recognised by email, else by phone
 * number, else by name within one shop (marketplaces often hide emails), so
 * the same person buying on Shopee and on your Shopify store is one customer
 * when either gives the same email or phone.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function keyOf(email, phone, name, shopId) {
  const e = String(email || '').trim().toLowerCase();
  if (e !== '' && e.indexOf('@') > 0 && e.indexOf('*') < 0) return 'e:' + e;
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (digits.length >= 7 && String(phone).indexOf('*') < 0) return 'p:' + digits.slice(-10);
  const n = String(name || '').trim().toLowerCase();
  if (n !== '') return 'n:' + (shopId || '') + ':' + n;
  return '';
}

/** The customer for these buyer details, created when new; null when there is nothing to know them by. */
function match(app, d) {
  const U = L('lib_util');
  const key = keyOf(d.email, d.phone, d.name, d.shop);
  if (key === '') return null;
  let c = U.findOne(app, 'customers', 'key = {:k}', { k: key });
  if (c === null) {
    c = U.newRecord(app, 'customers');
    c.set('key', key);
    c.set('tags', []);
  }
  if (d.name && c.getString('name') === '') c.set('name', U.clip(d.name, 200));
  if (d.email && c.getString('email') === '' && String(d.email).indexOf('*') < 0) c.set('email', U.clip(d.email, 200));
  if (d.phone && c.getString('phone') === '' && String(d.phone).indexOf('*') < 0) c.set('phone', U.clip(d.phone, 60));
  app.save(c);
  return c;
}

function ref(app, value) {
  const U = L('lib_util');
  const v = String(value || '').trim();
  const byId = U.byId(app, 'customers', v);
  if (byId !== null) return byId;
  const k = keyOf(v, v, '', '');
  if (k !== '') {
    const c = U.findOne(app, 'customers', 'key = {:k}', { k: k });
    if (c !== null) return c;
  }
  // By name: one match is that customer; several are listed so the right one can be named by id.
  const named = v === '' ? [] : app.findRecordsByFilter('customers', 'name = {:n}', '-created', 0, 0, { n: v });
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    const st = stats(app);
    const shops = shopsOf(app);
    const matches = named.map((c) => ({ id: c.id, email: c.getString('email'), phone: c.getString('phone'), shops: shops[c.id] || [], orders: (st[c.id] || { orders: 0 }).orders }));
    throw U.fail(409, named.length + ' customers are named "' + v + '" (one per shop when there is no email or phone). Name one by id.', 'ambiguous', { matches: matches });
  }
  throw U.fail(404, 'No customer "' + v + '". Run customers.list --q "' + v + '".', 'not_found');
}

/** The names of the shops each customer bought from. */
function shopsOf(app) {
  const U = L('lib_util');
  const out = {};
  for (const r of U.rows(app, "SELECT DISTINCT o.customer AS id, s.name AS name FROM orders o JOIN shops s ON s.id = o.shop WHERE o.customer != ''", {}, { id: '', name: '' })) {
    if (!out[r.id]) out[r.id] = [];
    out[r.id].push(r.name);
  }
  return out;
}

function stats(app) {
  const U = L('lib_util');
  const out = {};
  for (const r of U.rows(app, "SELECT customer AS id, COUNT(*) AS n, MAX(placed_at) AS last FROM orders WHERE customer != '' AND status != 'cancelled' GROUP BY customer", {}, { id: '', n: 0, last: '' })) out[r.id] = { orders: r.n, last: r.last };
  return out;
}

function spentOf(app, customerId) {
  const S = L('lib_store');
  const t = S.fxTable(app);
  let total = 0;
  for (const o of app.findRecordsByFilter('orders', "customer = {:c} && status != 'cancelled' && status != 'unpaid'", '', 0, 0, { c: customerId })) {
    const v = S.toBase(app, o.getInt('total_minor') - o.getInt('refund_minor'), o.getString('currency'), t);
    if (v !== null) total += v;
  }
  return total;
}

function view(app, c, st, shops) {
  const U = L('lib_util');
  const base = L('lib_store').baseOrEmpty(app);
  const s = (st && st[c.id]) || { orders: 0, last: '' };
  return { id: c.id, name: c.getString('name'), email: c.getString('email'), phone: c.getString('phone'), note: c.getString('note'), tags: U.json(c, 'tags', []), shops: (shops && shops[c.id]) || [], orders: s.orders, last_order: s.last, spent: U.toMajor(spentOf(app, c.id), base), currency: base };
}

/* ------------------------------------------------------------------- ops */

function list(ctx, p) {
  const app = ctx.app;
  const q = String(p.q || '').trim();
  const st = stats(app);
  const shops = shopsOf(app);
  const filter = q === '' ? '1=1' : 'name ~ {:q} || email ~ {:q} || phone ~ {:q}';
  let rows = app.findRecordsByFilter('customers', filter, '-created', 0, 0, { q: q }).map((c) => view(app, c, st, shops));
  if (p.filter === 'repeat') rows = rows.filter((r) => r.orders > 1);
  rows.sort((a, b) => (b.last_order > a.last_order ? 1 : b.last_order < a.last_order ? -1 : 0));
  const limit = Math.min(Math.max(Math.round(p.limit || 100), 1), 500);
  const offset = Math.max(Math.round(p.offset || 0), 0);
  return { total: rows.length, repeat: rows.filter((r) => r.orders > 1).length, customers: rows.slice(offset, offset + limit) };
}

function get(ctx, p) {
  const app = ctx.app;
  const c = ref(app, p.customer);
  const v = view(app, c, stats(app), shopsOf(app));
  const O = L('lib_orders');
  v.order_list = app.findRecordsByFilter('orders', 'customer = {:c}', '-placed_at', 50, 0, { c: c.id }).map((o) => O.rowView(app, o, null, null));
  v.threads = app.findRecordsByFilter('threads', 'customer = {:c}', '-last_at', 20, 0, { c: c.id }).map((t) => ({ id: t.id, subject: t.getString('subject'), status: t.getString('status'), last_at: t.getString('last_at') }));
  return { customer: v };
}

function update(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const c = ref(app, p.customer);
  if (p.name !== undefined) c.set('name', U.clip(p.name, 200));
  if (p.email !== undefined) c.set('email', U.clip(p.email, 200));
  if (p.phone !== undefined) c.set('phone', U.clip(p.phone, 60));
  if (p.note !== undefined) c.set('note', U.clip(p.note, 2000));
  if (p.tags !== undefined) c.set('tags', U.list(p.tags, 'tags').map((t) => U.clip(String(t), 40)).slice(0, 20));
  app.save(c);
  return get(ctx, { customer: c.id });
}

module.exports = { keyOf: keyOf, match: match, ref: ref, list: list, get: get, update: update };
