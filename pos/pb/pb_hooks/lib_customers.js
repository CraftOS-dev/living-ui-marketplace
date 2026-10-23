/// <reference path="../pb_data/types.d.ts" />
/**
 * Customers: who bought, so a receipt can be found again and a regular is
 * recognised. A customer with sales is archived, never deleted (their sales
 * point at them).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stats(app, ids) {
  const out = {};
  if (ids.length === 0) return out;
  const util = u();
  const bind = {};
  const ph = ids.map((id, i) => {
    bind['c' + i] = id;
    return '{:c' + i + '}';
  });
  for (const r of util.rows(
    app,
    "SELECT customer, COUNT(CASE WHEN kind != 'refund' THEN 1 END) AS visits, IFNULL(SUM(total), 0) AS spent, MAX(created) AS last FROM sales WHERE training = false AND customer IN (" + ph.join(',') + ') GROUP BY customer',
    { customer: '', visits: 0, spent: 0, last: '' },
    bind,
  )) {
    out[r.customer] = { visits: r.visits, spent: r.spent, last: r.last };
  }
  return out;
}

function serialize(rec, st, exp, currency) {
  const util = u();
  const x = st || { visits: 0, spent: 0, last: '' };
  return {
    id: rec.id,
    name: rec.getString('name'),
    phone: rec.getString('phone'),
    email: rec.getString('email'),
    notes: rec.getString('notes'),
    marketing: rec.getBool('marketing'),
    archived: rec.getBool('archived'),
    visits: x.visits,
    spent: x.spent,
    spent_text: util.moneyText(x.spent, exp, currency),
    last_visit: x.last,
    created: rec.getString('created'),
  };
}

function list(app, p) {
  const util = u();
  const s = core().shop(app);
  const q = util.str(p, 'q', '').toLowerCase();
  const limit = util.int(p, 'limit', 50, 1, 1000);
  const archived = util.bool(p, 'archived', false);
  const bind = { a: archived };
  let filter = 'archived = {:a}';
  if (q !== '') {
    filter += ' && (name ~ {:q} || phone ~ {:q} || email ~ {:q})';
    bind.q = q;
  }
  const recs = app.findRecordsByFilter('customers', filter, 'name', limit, 0, bind);
  const st = stats(app, recs.map((r) => r.id));
  return {
    customers: recs.map((r) => serialize(r, st[r.id], s.exp, s.currency)),
    total: util.scalarSql(app, 'SELECT COUNT(id) AS v FROM customers WHERE archived = {:a}', { a: archived }),
  };
}

function get(app, rec) {
  const s = core().shop(app);
  const st = stats(app, [rec.id]);
  const out = serialize(rec, st[rec.id], s.exp, s.currency);
  out.recent = require(`${__hooks}/lib_sales.js`).list(app, { customer: rec.id, limit: '20' }).sales;
  const util = u();
  out.favorites = util.rows(
    app,
    'SELECT l.name AS name, SUM(l.qty) AS qty FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.customer = {:c} AND s.training = false AND l.qty > 0 GROUP BY l.name ORDER BY qty DESC LIMIT 5',
    { name: '', qty: 0 },
    { c: rec.id },
  );
  return out;
}

function save(app, rec, p, isNew, ctx) {
  const util = u();
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"Sam Lee"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 80) throw util.fail(400, 'A customer needs a name of at most 80 characters');
    rec.set('name', name);
  }
  if (isNew || util.has(p, 'phone')) {
    const phone = util.str(p, 'phone', '');
    if (phone.length > 40 || (phone !== '' && !/^[+\d][\d\s().-]{3,}$/.test(phone))) throw util.fail(400, 'phone must be a phone number (digits, spaces, + ( ) - .)');
    rec.set('phone', phone);
  }
  if (isNew || util.has(p, 'email')) {
    const email = util.str(p, 'email', '');
    if (email !== '' && (!EMAIL.test(email) || email.length > 120)) throw util.fail(400, 'email must be an email address');
    rec.set('email', email);
  }
  if (isNew || util.has(p, 'notes')) {
    const notes = util.str(p, 'notes', '');
    if (notes.length > 1000) throw util.fail(400, 'notes can be at most 1000 characters');
    rec.set('notes', notes);
  }
  if (isNew || util.has(p, 'marketing')) rec.set('marketing', util.bool(p, 'marketing', isNew ? false : rec.getBool('marketing')));
  if (isNew) rec.set('archived', false);
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'customer_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: (isNew ? 'Added customer ' : 'Changed customer ') + rec.getString('name') });
  });
  return get(app, rec);
}

function setArchived(app, rec, archived, ctx) {
  rec.set('archived', archived);
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'customer_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: (archived ? 'Archived customer ' : 'Restored customer ') + rec.getString('name') });
  });
  return { id: rec.id, name: rec.getString('name'), archived: archived };
}

module.exports = { EMAIL: EMAIL, list: list, get: get, save: save, setArchived: setArchived };
