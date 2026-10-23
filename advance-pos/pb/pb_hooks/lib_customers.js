/// <reference path="../pb_data/types.d.ts" />
/**
 * Customers, their loyalty points and store credit, and gift cards. Every
 * balance is kept on its record and explained by an append-only ledger
 * (account_moves) written in the same transaction.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function audit() {
  return require(`${__hooks}/lib_audit.js`);
}
function moneyOf(s) {
  return require(`${__hooks}/lib_money.js`).of(s);
}

/* ---------------------------------------------------------------- ledgers */

/**
 * Move a balance (inside a transaction): account points|credit on a
 * customer, gift_card on a card. Balances never go below zero.
 */
function moveBalance(tx, c, f) {
  const util = u();
  const coll = f.account === 'gift_card' ? 'gift_cards' : 'customers';
  const field = f.account === 'points' ? 'points' : f.account === 'credit' ? 'credit' : 'balance';
  const rec = tx.findRecordById(coll, f.account === 'gift_card' ? f.giftCard : f.customer);
  const after = rec.getInt(field) + Math.round(f.delta);
  if (after < 0) {
    const money = moneyOf(auth().settingsRow(tx));
    const have = f.account === 'points' ? rec.getInt(field) + ' points' : money.text(rec.getInt(field));
    throw util.fail(400, (f.account === 'gift_card' ? 'Gift card ' + rec.getString('code') : rec.getString('name')) + ' has only ' + have);
  }
  rec.set(field, after);
  if (f.account === 'gift_card') {
    if (f.reason === 'redeem' || f.reason === 'reload' || f.reason === 'issue') rec.set('last_used', new Date().toISOString());
    if (f.reason === 'issue' || f.reason === 'reload') rec.set('issued', rec.getInt('issued') + Math.max(0, Math.round(f.delta)));
  }
  tx.save(rec);
  const m = new Record(tx.findCollectionByNameOrId('account_moves'));
  m.set('account', f.account);
  if (f.account === 'gift_card') {
    m.set('gift_card', rec.id);
    if (rec.getString('customer') !== '') m.set('customer', rec.getString('customer'));
  } else m.set('customer', rec.id);
  m.set('reason', f.reason);
  m.set('delta', Math.round(f.delta));
  m.set('after', after);
  if (f.order) m.set('order', f.order);
  if (f.payment) m.set('payment', f.payment);
  m.set('note', String(f.note || '').slice(0, 400));
  if (c && c.staffId) m.set('staff', c.staffId);
  m.set('actor', c ? c.actor : 'system');
  tx.save(m);
  return { before: after - Math.round(f.delta), after: after };
}

function moveJson(m, names) {
  return {
    id: m.id,
    account: m.getString('account'),
    reason: m.getString('reason'),
    delta: m.getInt('delta'),
    after: m.getInt('after'),
    order: m.getString('order'),
    note: m.getString('note'),
    by: m.getString('actor') === 'agent' ? 'Your AI agent' : names[m.getString('staff')] || (m.getString('actor') === 'system' ? 'The app' : ''),
    created: m.getString('created'),
  };
}

/* -------------------------------------------------------------- customers */

function customerJson(r, money) {
  return {
    id: r.id,
    name: r.getString('name'),
    phone: r.getString('phone'),
    email: r.getString('email'),
    notes: r.getString('notes'),
    tags: u().getJson(r, 'tags') || [],
    tax_exempt: r.getBool('tax_exempt'),
    marketing: r.getBool('marketing'),
    birthday: r.getString('birthday'),
    points: r.getInt('points'),
    credit: r.getInt('credit'),
    credit_text: money.text(r.getInt('credit')),
    visits: r.getInt('visits'),
    spent: r.getInt('spent'),
    spent_text: money.text(r.getInt('spent')),
    last_visit: r.getString('last_visit'),
    created: r.getString('created'),
  };
}

function customerRef(db, ref) {
  const util = u();
  const v = String(ref || '').trim();
  let r = util.byId(db, 'customers', v);
  if (r === null && v !== '') r = util.findOne(db, 'customers', 'email = {:v} || phone = {:v}', { v: v });
  if (r === null && v !== '') {
    const rows = db.findRecordsByFilter('customers', 'name = {:v}', '', 2, 0, { v: v });
    if (rows.length > 1) throw util.fail(400, 'More than one customer is named "' + v + '"; use the id, phone or email');
    r = rows[0] || null;
  }
  if (r === null) throw util.fail(404, 'No customer "' + v + '" (see customers.list)');
  return r;
}

function list(app, p) {
  const util = u();
  const money = moneyOf(auth().settingsRow(app));
  const filters = [];
  const bind = {};
  const q = util.str(p, 'q', '');
  if (q !== '') {
    filters.push('(name ~ {:q} || phone ~ {:q} || email ~ {:q})');
    bind.q = q;
  }
  const sort = util.oneOf(p, 'sort', ['name', 'recent', 'spent', 'points'], 'name');
  const order = { name: 'name', recent: '-last_visit,name', spent: '-spent', points: '-points' }[sort];
  const limit = util.int(p, 'limit', 50, 1, 1000);
  const page = util.int(p, 'page', 1, 1, 100000);
  const rows = app.findRecordsByFilter('customers', filters.join(' && '), order, limit + 1, (page - 1) * limit, bind);
  return { customers: rows.slice(0, limit).map((r) => customerJson(r, money)), more: rows.length > limit, total: app.countRecords('customers') };
}

function get(app, p) {
  const util = u();
  const r = customerRef(app, util.req(p, 'customer', '<customer id, phone, email or exact name>'));
  const money = moneyOf(auth().settingsRow(app));
  const names = audit().staffNames(app);
  const orders = app.findRecordsByFilter('orders', "customer = {:c} && status = 'paid'", '-paid_at', 30, 0, { c: r.id }).map((o) => ({
    id: o.id,
    number: o.getString('number'),
    total: o.getInt('total'),
    total_text: money.text(o.getInt('total')),
    items: o.getFloat('items'),
    paid_at: o.getString('paid_at'),
    return_status: o.getString('return_status') || 'none',
  }));
  const moves = app.findRecordsByFilter('account_moves', "customer = {:c} && account != 'gift_card'", '-created', 40, 0, { c: r.id }).map((m) => moveJson(m, names));
  const cards = app.findRecordsByFilter('gift_cards', 'customer = {:c}', '-created', 20, 0, { c: r.id }).map((g) => cardJson(g, money));
  return { customer: customerJson(r, money), orders: orders, moves: moves, gift_cards: cards };
}

function cleanEmail(v) {
  const util = u();
  const s = String(v || '').trim();
  if (s !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw util.fail(400, 'email does not look like an email address: ' + s);
  return s.toLowerCase();
}

function cleanPhone(v) {
  const util = u();
  const s = String(v || '').trim();
  if (s !== '' && !/^[+0-9 ()\-.]{4,30}$/.test(s)) throw util.fail(400, 'phone may hold digits, spaces, + ( ) - . only: ' + s);
  return s;
}

function save(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_customers', p, { what: 'Editing customers' });
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('customers')) : util.byId(tx, 'customers', id);
    if (r === null) throw util.fail(404, 'No customer ' + id);
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', '"Jordan Park"'));
      if (name.length > 120) throw util.fail(400, 'name can be at most 120 characters');
      r.set('name', name);
    }
    if (util.has(p, 'email')) {
      const em = cleanEmail(util.str(p, 'email', ''));
      if (em !== '' && util.findOne(tx, 'customers', 'email = {:e} && id != {:i}', { e: em, i: r.id || '' }) !== null) throw util.fail(400, 'Another customer has the email ' + em);
      r.set('email', em);
    }
    if (util.has(p, 'phone')) {
      const ph = cleanPhone(util.str(p, 'phone', ''));
      if (ph !== '' && util.findOne(tx, 'customers', 'phone = {:p} && id != {:i}', { p: ph, i: r.id || '' }) !== null) throw util.fail(400, 'Another customer has the phone ' + ph);
      r.set('phone', ph);
    }
    if (util.has(p, 'notes')) r.set('notes', util.str(p, 'notes', '').slice(0, 2000));
    if (util.has(p, 'tags')) {
      const tags = (util.list(p, 'tags', '["regular", "wholesale"]') || []).map((t) => util.squash(t).toLowerCase()).filter((t) => t !== '');
      if (tags.length > 20 || tags.some((t) => t.length > 30)) throw util.fail(400, 'Up to 20 tags of at most 30 characters');
      r.set('tags', tags.filter((t, i) => tags.indexOf(t) === i));
    }
    let exemptApprover = null;
    let exemptChanged = false;
    if (util.has(p, 'tax_exempt')) {
      const v = util.bool(p, 'tax_exempt', false);
      if (v !== r.getBool('tax_exempt')) {
        exemptApprover = auth().need(tx, c, 'tax_exempt', p, { what: 'Making a customer tax exempt' });
        exemptChanged = true;
      }
      r.set('tax_exempt', v);
    }
    if (util.has(p, 'marketing')) r.set('marketing', util.bool(p, 'marketing', false));
    if (util.has(p, 'birthday')) {
      const b = util.str(p, 'birthday', '');
      if (b !== '' && !/^(\d{4}-)?\d{2}-\d{2}$/.test(b)) throw util.fail(400, 'birthday is like 1990-04-12 or 04-12');
      r.set('birthday', b);
    }
    if (id === '') {
      r.set('points', 0);
      r.set('credit', 0);
      r.set('visits', 0);
      r.set('spent', 0);
    }
    tx.save(r);
    if (exemptChanged) audit().log(tx, 'tax_exempt', c, { approver: exemptApprover || approver, detail: r.getString('name') + (r.getBool('tax_exempt') ? ' is now tax exempt' : ' pays tax again') });
    out = r;
  });
  return { customer: customerJson(out, moneyOf(c.settings)) };
}

/** Adjust a customer's points or store credit by hand (with a reason). */
function adjust(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'adjust_balances', p, { what: 'Adjusting a balance' });
  const money = moneyOf(c.settings);
  const r = customerRef(app, util.req(p, 'customer', '<customer id>'));
  const account = util.oneOf(p, 'account', ['points', 'credit'], '');
  if (account === '') throw util.fail(400, 'account is required: points or credit');
  const delta = account === 'points' ? util.int(p, 'delta', 0, -100000000, 100000000) : money.param(p, 'delta', { required: true, example: '10.00' });
  if (delta === 0) throw util.fail(400, 'delta cannot be 0');
  const note = util.req(p, 'note', '"Goodwill for a late order"');
  let res = null;
  app.runInTransaction((tx) => {
    res = moveBalance(tx, c, { account: account, customer: r.id, delta: delta, reason: 'adjust', note: note });
    audit().log(tx, 'balance', c, {
      approver: approver,
      amount: account === 'credit' ? delta : undefined,
      detail: r.getString('name') + ': ' + (account === 'points' ? (delta > 0 ? '+' : '') + delta + ' points' : (delta > 0 ? '+' : '') + money.plain(delta) + ' store credit') + ' (' + note + ')',
    });
  });
  return { customer: customerJson(app.findRecordById('customers', r.id), money), before: res.before, after: res.after };
}

/* ------------------------------------------------------------- gift cards */

function normCode(v) {
  return String(v || '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

/** A new card number: 16 digits that no card has yet. */
function newCode(db) {
  for (let i = 0; i < 20; i++) {
    const code = $security.randomStringWithAlphabet(16, '0123456789');
    if (code.charAt(0) === '0') continue;
    if (u().findOne(db, 'gift_cards', 'code = {:c}', { c: code }) === null) return code;
  }
  throw u().fail(500, 'Could not make a unique gift card number');
}

function cardJson(g, money) {
  const code = g.getString('code');
  return {
    id: g.id,
    code: code,
    masked: code.length > 4 ? '•••• ' + code.slice(-4) : code,
    balance: g.getInt('balance'),
    balance_text: money.text(g.getInt('balance')),
    issued: g.getInt('issued'),
    status: g.getString('status') || 'active',
    customer: g.getString('customer'),
    last_used: g.getString('last_used'),
    note: g.getString('note'),
    created: g.getString('created'),
  };
}

function cardByCode(db, code) {
  const c = normCode(code);
  if (c === '') return null;
  return u().findOne(db, 'gift_cards', 'code = {:c}', { c: c });
}

function cardsList(app, p) {
  const util = u();
  const money = moneyOf(auth().settingsRow(app));
  const filters = [];
  const bind = {};
  const q = normCode(util.str(p, 'q', ''));
  if (q !== '') {
    filters.push('code ~ {:q}');
    bind.q = q;
  }
  const status = util.oneOf(p, 'status', ['active', 'disabled', 'with_balance'], '');
  if (status === 'with_balance') filters.push("balance > 0 && status = 'active'");
  else if (status !== '') {
    filters.push('status = {:s}');
    bind.s = status;
  }
  const limit = util.int(p, 'limit', 50, 1, 1000);
  const rows = app.findRecordsByFilter('gift_cards', filters.join(' && '), '-updated', limit + 1, 0, bind);
  const out = util.rows(app, "SELECT COALESCE(SUM(balance), 0) AS b, COUNT(*) AS n FROM gift_cards WHERE status = 'active'", { b: 0, n: 0 })[0];
  return { gift_cards: rows.slice(0, limit).map((g) => cardJson(g, money)), more: rows.length > limit, outstanding: out.b, outstanding_text: money.text(out.b), active: out.n };
}

function cardsGet(app, p) {
  const util = u();
  const money = moneyOf(auth().settingsRow(app));
  const ref = util.req(p, 'code', '6011000990139424');
  let g = cardByCode(app, ref);
  if (g === null) g = util.byId(app, 'gift_cards', ref);
  if (g === null) throw util.fail(404, 'No gift card ' + ref, { code: 'not_found' });
  const names = audit().staffNames(app);
  const moves = app.findRecordsByFilter('account_moves', 'gift_card = {:g}', '-created', 50, 0, { g: g.id }).map((m) => moveJson(m, names));
  const cust = g.getString('customer') === '' ? null : util.byId(app, 'customers', g.getString('customer'));
  return { gift_card: cardJson(g, money), customer: cust === null ? null : { id: cust.id, name: cust.getString('name') }, moves: moves };
}

/** Issue a card without a sale (a promotion or replacement), or change a card's status, owner or note. */
function cardsSave(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'adjust_balances', p, { what: 'Issuing or changing gift cards' });
  const money = moneyOf(c.settings);
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    let g = id === '' ? null : util.byId(tx, 'gift_cards', id);
    if (id !== '' && g === null) throw util.fail(404, 'No gift card ' + id);
    const fresh = g === null;
    if (fresh) {
      g = new Record(tx.findCollectionByNameOrId('gift_cards'));
      const code = normCode(util.str(p, 'code', ''));
      if (code !== '' && !/^[A-Z0-9]{6,40}$/.test(code)) throw util.fail(400, 'code must be 6 to 40 letters or digits');
      if (code !== '' && cardByCode(tx, code) !== null) throw util.fail(400, 'A gift card with that number already exists');
      g.set('code', code === '' ? newCode(tx) : code);
      g.set('balance', 0);
      g.set('issued', 0);
      g.set('status', 'active');
    }
    if (util.has(p, 'status')) g.set('status', util.oneOf(p, 'status', ['active', 'disabled'], 'active'));
    if (util.has(p, 'customer')) {
      const ref = util.str(p, 'customer', '');
      g.set('customer', ref === '' ? '' : customerRef(tx, ref).id);
    }
    if (util.has(p, 'note')) g.set('note', util.str(p, 'note', '').slice(0, 400));
    tx.save(g);
    const amount = fresh ? money.param(p, 'amount', { min: 0 }) : null;
    if (amount !== null && amount > 0) {
      moveBalance(tx, c, { account: 'gift_card', giftCard: g.id, delta: amount, reason: 'issue', note: util.str(p, 'note', '') || 'Issued without a sale' });
    }
    audit().log(tx, 'balance', c, { approver: approver, amount: amount || undefined, detail: (fresh ? 'Gift card issued ' : 'Gift card changed ') + '•••• ' + g.getString('code').slice(-4) + (amount ? ' with ' + money.plain(amount) : '') });
    out = g;
  });
  return { gift_card: cardJson(app.findRecordById('gift_cards', out.id), money) };
}

function cardsAdjust(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'adjust_balances', p, { what: 'Adjusting a gift card' });
  const money = moneyOf(c.settings);
  const g = cardByCode(app, util.req(p, 'code', '6011000990139424'));
  if (g === null) throw util.fail(404, 'No gift card with that number');
  const delta = money.param(p, 'delta', { required: true, example: '-5.00' });
  if (delta === 0) throw util.fail(400, 'delta cannot be 0');
  const note = util.req(p, 'note', '"Card damaged, balance moved"');
  app.runInTransaction((tx) => {
    moveBalance(tx, c, { account: 'gift_card', giftCard: g.id, delta: delta, reason: 'adjust', note: note });
    audit().log(tx, 'balance', c, { approver: approver, amount: delta, detail: 'Gift card •••• ' + g.getString('code').slice(-4) + ': ' + (delta > 0 ? '+' : '') + money.plain(delta) + ' (' + note + ')' });
  });
  return { gift_card: cardJson(app.findRecordById('gift_cards', g.id), money) };
}

module.exports = {
  moveBalance: moveBalance,
  customerJson: customerJson,
  customerRef: customerRef,
  list: list,
  get: get,
  save: save,
  adjust: adjust,
  normCode: normCode,
  newCode: newCode,
  cardJson: cardJson,
  cardByCode: cardByCode,
  cardsList: cardsList,
  cardsGet: cardsGet,
  cardsSave: cardsSave,
  cardsAdjust: cardsAdjust,
  cleanEmail: cleanEmail,
  cleanPhone: cleanPhone,
};
