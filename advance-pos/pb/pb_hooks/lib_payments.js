/// <reference path="../pb_data/types.d.ts" />
/**
 * Taking payment. Each payment is a row on the sale; the sale finishes when
 * its balance reaches zero. Cash gives change and, when the store rounds
 * cash, rounds the last payment. Card payments come from the shop's own
 * terminal (the approval code or last 4 digits are recorded when asked).
 * Gift cards, store credit and points are taken from their balances in the
 * same transaction. A negative balance (a return) is refunded the same
 * ways. A payment taken by mistake is voided while the sale is still open.
 * A repeated submit with the same client_ref never charges twice.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function orders() {
  return require(`${__hooks}/lib_orders.js`);
}
function customers() {
  return require(`${__hooks}/lib_customers.js`);
}

const TENDERS = ['cash', 'card', 'gift_card', 'store_credit', 'points', 'other'];

/** The drawer session payments on this register go to (null when none is needed and none is open). */
function shiftFor(db, c, tender, need) {
  const util = u();
  if (c.registerId === '') {
    if (tender === 'cash') throw util.fail(400, 'Cash needs a register: give register', { code: 'register_needed' });
    return null;
  }
  const sh = util.findOne(db, 'shifts', "register = {:r} && status = 'open'", { r: c.registerId });
  if (sh === null && need && (tender === 'cash' || c.actor !== 'agent')) {
    throw util.fail(409, 'Open the drawer on ' + (c.register ? c.register.getString('name') : 'this register') + ' first', { code: 'shift_needed' });
  }
  return sh;
}

function roundTo(x, step) {
  if (!(step > 0)) return x;
  return require(`${__hooks}/lib_money.js`).round(x / step) * step;
}

function add(app, e, p) {
  const util = u();
  const A = auth();
  const O = orders();
  const C = customers();
  const c = A.context(app, e, p);
  A.need(app, c, 'sell', p, { what: 'Taking payment' });
  const s = c.settings;
  const money = require(`${__hooks}/lib_money.js`).of(s);
  const tender = util.oneOf(p, 'tender', TENDERS, '');
  if (tender === '') throw util.fail(400, 'tender is required: ' + TENDERS.join(', '));
  if (tender === 'cash') A.staffOnly(c, 'Taking cash');
  const ref = util.str(p, 'client_ref', '');
  if (ref !== '' && !/^[A-Za-z0-9_-]{8,64}$/.test(ref)) throw util.fail(400, 'client_ref must be 8 to 64 letters, digits, - or _');
  if (ref !== '') {
    const prior = util.findOne(app, 'payments', 'client_ref = {:r}', { r: ref });
    if (prior !== null) return { order: O.orderJson(app, app.findRecordById('orders', prior.getString('order'))), payment: prior.id, repeated: true, completed: app.findRecordById('orders', prior.getString('order')).getString('status') === 'paid', change: prior.getInt('change') };
  }
  let orderId = '';
  let payId = '';
  let change = 0;
  let completed = false;
  app.runInTransaction((tx) => {
    const o = O.openOrder(tx, util.req(p, 'order', '<order id>'));
    orderId = o.id;
    if (o.getString('register') === '' && c.registerId) o.set('register', c.registerId);
    O.reprice(tx, o);
    const balance = o.getInt('balance');
    if (balance === 0) throw util.fail(400, 'Nothing is left to pay on this sale', { code: 'nothing_due' });
    if (O.lineRecs(tx, o.id).length === 0) throw util.fail(400, 'This sale has nothing on it');
    const shift = shiftFor(tx, c, tender, s.getBool('require_shift'));
    const refund = balance < 0;
    let approver = null;
    if (refund) {
      approver = A.need(tx, c, 'return', p, { what: 'A refund' });
      if (tender === 'points') throw util.fail(400, 'Refund to cash, card, store credit, a gift card or another tender');
    }
    const due = Math.abs(balance);
    const asked = money.param(p, 'amount', { min: 1 });
    const pay = new Record(tx.findCollectionByNameOrId('payments'));
    pay.set('order', o.id);
    pay.set('tender', tender);
    pay.set('status', 'captured');
    pay.set('actor', c.actor);
    if (c.staffId) pay.set('staff', c.staffId);
    if (approver !== null) pay.set('approved_by', approver.id);
    if (shift !== null) pay.set('shift', shift.id);
    if (c.registerId) pay.set('register', c.registerId);
    if (ref !== '') pay.set('client_ref', ref);
    pay.set('change', 0);
    pay.set('tendered', 0);
    pay.set('points', 0);
    let amount = asked === null ? due : asked;

    if (tender === 'cash') {
      if (refund) {
        if (amount > due) throw util.fail(400, 'The refund is ' + money.text(due));
        if (amount === due && s.getInt('cash_round_to') > 0) {
          const r = roundTo(due, s.getInt('cash_round_to'));
          o.set('rounding', o.getInt('rounding') + (due - r));
          amount = r;
        }
      } else {
        const tendered = money.param(p, 'tendered', { min: 1 });
        const given = tendered === null ? amount : tendered;
        const step = s.getInt('cash_round_to');
        const dueCash = step > 0 ? roundTo(due, step) : due;
        if (given >= dueCash) {
          // The last of the balance in cash: round it, give change.
          if (dueCash !== due) o.set('rounding', o.getInt('rounding') + (dueCash - due));
          amount = dueCash;
          change = given - dueCash;
          pay.set('tendered', given);
          pay.set('change', change);
        } else if (given >= due) {
          // Enough for the exact balance but short of the rounded-up one: take it as exact.
          amount = due;
          change = given - due;
          pay.set('tendered', given);
          pay.set('change', change);
        } else {
          if (asked !== null && tendered !== null && asked !== tendered) throw util.fail(400, 'Give amount or tendered for cash, not both');
          amount = given;
          pay.set('tendered', given);
        }
      }
    } else {
      if (amount > due) throw util.fail(400, (refund ? 'The refund is ' : 'Only ') + money.text(due) + (refund ? '' : ' is left to pay'), { code: 'over_balance' });
      if (tender === 'card') {
        const reference = util.str(p, 'reference', '').slice(0, 80);
        if (s.getString('card_reference') === 'required' && reference === '' && !refund) throw util.fail(400, 'Enter the approval code or last 4 digits from the card terminal', { code: 'reference_needed' });
        pay.set('reference', s.getString('card_reference') === 'off' ? '' : reference);
      } else if (tender === 'other') {
        const lbl = util.req(p, 'label', 'Bank transfer');
        const t = require(`${__hooks}/lib_settings.js`).customTenders(s).find((x) => x.id === lbl || x.label.toLowerCase() === lbl.toLowerCase());
        if (!t) throw util.fail(400, 'No tender "' + lbl + '"; add it in Settings, Payments');
        pay.set('label', t.label);
        pay.set('reference', util.str(p, 'reference', '').slice(0, 80));
      } else if (tender === 'gift_card') {
        const code = C.normCode(util.str(p, 'gift_code', ''));
        let card = code === '' ? null : C.cardByCode(tx, code);
        if (!refund) {
          if (card === null) throw util.fail(404, code === '' ? 'Scan or type the gift card number' : 'No gift card with that number', { code: 'bad_card' });
          if (card.getString('status') !== 'active') throw util.fail(400, 'That gift card is disabled', { code: 'bad_card' });
          if (card.getInt('balance') <= 0) throw util.fail(400, 'That gift card is empty', { code: 'bad_card' });
          if (asked === null) amount = Math.min(due, card.getInt('balance'));
          if (amount > card.getInt('balance')) throw util.fail(400, 'The gift card has only ' + money.text(card.getInt('balance')), { code: 'bad_card' });
        } else if (card === null) {
          // Refund onto a new card.
          card = new Record(tx.findCollectionByNameOrId('gift_cards'));
          card.set('code', code === '' ? C.newCode(tx) : code);
          card.set('balance', 0);
          card.set('issued', 0);
          card.set('status', 'active');
          if (o.getString('customer') !== '') card.set('customer', o.getString('customer'));
          tx.save(card);
        } else if (card.getString('status') !== 'active') throw util.fail(400, 'That gift card is disabled');
        pay.set('gift_card', card.id);
        pay.set('reference', '•••• ' + card.getString('code').slice(-4));
      } else if (tender === 'store_credit' || tender === 'points') {
        if (o.getString('customer') === '') throw util.fail(400, 'Add the customer to the sale first', { code: 'customer_needed' });
        const cust = tx.findRecordById('customers', o.getString('customer'));
        pay.set('customer', cust.id);
        if (tender === 'store_credit' && !refund) {
          if (cust.getInt('credit') <= 0) throw util.fail(400, cust.getString('name') + ' has no store credit');
          if (asked === null) amount = Math.min(due, cust.getInt('credit'));
          if (amount > cust.getInt('credit')) throw util.fail(400, cust.getString('name') + ' has only ' + money.text(cust.getInt('credit')) + ' store credit');
        }
        if (tender === 'points') {
          if (!s.getBool('loyalty_enabled') || s.getInt('point_value') <= 0) throw util.fail(400, 'Points are turned off in Settings');
          const value = s.getInt('point_value');
          const have = cust.getInt('points');
          if (have < s.getInt('points_min_redeem')) throw util.fail(400, cust.getString('name') + ' has ' + have + ' points; at least ' + s.getInt('points_min_redeem') + ' are needed to pay with points');
          if (asked === null) amount = Math.min(due, have * value);
          const pts = Math.ceil(amount / value - 1e-9);
          if (pts > have) throw util.fail(400, cust.getString('name') + ' has only ' + have + ' points (worth ' + money.text(have * value) + ')');
          if (pts < s.getInt('points_min_redeem')) throw util.fail(400, 'At least ' + s.getInt('points_min_redeem') + ' points per payment');
          pay.set('points', pts);
        }
      }
    }
    if (amount <= 0) throw util.fail(400, 'The amount must be more than 0');
    pay.set('amount', refund ? -amount : amount);
    tx.save(pay);
    payId = pay.id;

    // Balances move with the payment.
    if (tender === 'gift_card') {
      C.moveBalance(tx, c, { account: 'gift_card', giftCard: pay.getString('gift_card'), delta: refund ? amount : -amount, reason: refund ? 'refund' : 'redeem', order: o.id, payment: pay.id, note: refund ? 'Refund' : 'Paid a sale' });
    } else if (tender === 'store_credit') {
      C.moveBalance(tx, c, { account: 'credit', customer: pay.getString('customer'), delta: refund ? amount : -amount, reason: refund ? 'refund' : 'redeem', order: o.id, payment: pay.id, note: refund ? 'Refund' : 'Paid a sale' });
    } else if (tender === 'points') {
      C.moveBalance(tx, c, { account: 'points', customer: pay.getString('customer'), delta: -pay.getInt('points'), reason: 'redeem', order: o.id, payment: pay.id, note: 'Paid ' + money.plain(amount) });
    }
    if (refund) require(`${__hooks}/lib_audit.js`).log(tx, 'return', c, { approver: approver, order: o.id, amount: -amount, detail: 'Refunded ' + money.plain(amount) + ' to ' + (pay.getString('label') || tender.replace('_', ' ')) });
    O.settle(tx, o);
    if (o.getInt('balance') === 0) {
      O.finalize(tx, c, o);
      completed = true;
    } else tx.save(o);
  });
  return { order: O.orderJson(app, app.findRecordById('orders', orderId)), payment: payId, change: change, completed: completed };
}

/** Void a payment on an open sale (taken by mistake): its balance moves back. */
function voidPayment(app, e, p) {
  const util = u();
  const A = auth();
  const O = orders();
  const C = customers();
  const c = A.context(app, e, p);
  const money = require(`${__hooks}/lib_money.js`).of(c.settings);
  const approver = A.need(app, c, 'void', p, { what: 'Voiding a payment' });
  let orderId = '';
  app.runInTransaction((tx) => {
    const pay = util.byId(tx, 'payments', util.req(p, 'payment', '<payment id>'));
    if (pay === null) throw util.fail(404, 'No such payment');
    if (pay.getString('status') !== 'captured') throw util.fail(400, 'That payment is already voided');
    const o = O.openOrder(tx, pay.getString('order'));
    orderId = o.id;
    const amount = pay.getInt('amount');
    const tender = pay.getString('tender');
    if (tender === 'cash') A.staffOnly(c, 'Giving cash back');
    if (tender === 'gift_card') C.moveBalance(tx, c, { account: 'gift_card', giftCard: pay.getString('gift_card'), delta: amount, reason: 'void', order: o.id, payment: pay.id, note: 'Payment voided' });
    if (tender === 'store_credit') C.moveBalance(tx, c, { account: 'credit', customer: pay.getString('customer'), delta: amount, reason: 'void', order: o.id, payment: pay.id, note: 'Payment voided' });
    if (tender === 'points') C.moveBalance(tx, c, { account: 'points', customer: pay.getString('customer'), delta: pay.getInt('points'), reason: 'void', order: o.id, payment: pay.id, note: 'Payment voided' });
    pay.set('status', 'voided');
    pay.set('voided_at', new Date().toISOString());
    tx.save(pay);
    require(`${__hooks}/lib_audit.js`).log(tx, 'payment_voided', c, { approver: approver, order: o.id, amount: amount, detail: 'Voided a ' + (pay.getString('label') || tender.replace('_', ' ')) + ' payment of ' + money.plain(amount) + (util.str(p, 'reason', '') ? ': ' + util.str(p, 'reason', '') : '') });
    O.settle(tx, o);
    tx.save(o);
  });
  return { order: O.orderJson(app, app.findRecordById('orders', orderId)) };
}

module.exports = { TENDERS: TENDERS, add: add, voidPayment: voidPayment, shiftFor: shiftFor, roundTo: roundTo };
