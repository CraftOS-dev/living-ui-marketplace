/// <reference path="../pb_data/types.d.ts" />
/**
 * Sales. A sale is an order: open while it is being rung up (a cart, or a
 * named ticket parked for later), paid when its balance reaches zero, void
 * when it is abandoned. Lines snapshot what was sold (name, price, tax);
 * every change reprices the whole order through lib_pricing. A return is a
 * line with a negative quantity, linked to the line it returns, at the
 * price that was paid; returns and new items can share one order (an
 * exchange). Paying the last of the balance finishes the sale: a receipt
 * number, stock, gift cards, points and the customer's history.
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
function catalog() {
  return require(`${__hooks}/lib_catalog.js`);
}
function customers() {
  return require(`${__hooks}/lib_customers.js`);
}

const MAX_QTY = 99999;

function q3(x) {
  return Math.round(x * 1000) / 1000;
}

/* ---------------------------------------------------------------- reading */

function lineRecs(db, orderId) {
  return db.findRecordsByFilter('order_lines', 'order = {:o}', 'position,created', 0, 0, { o: orderId });
}

function paymentRecs(db, orderId) {
  return db.findRecordsByFilter('payments', 'order = {:o}', 'created', 0, 0, { o: orderId });
}

function orderRef(db, ref) {
  const util = u();
  const v = String(ref || '').trim();
  if (v === '') throw util.fail(400, 'order is required (an order id or receipt number)');
  let o = util.byId(db, 'orders', v);
  if (o === null) o = util.findOne(db, 'orders', 'number = {:n}', { n: v });
  if (o === null) throw util.fail(404, 'No sale "' + v + '"');
  return o;
}

function openOrder(db, ref) {
  const o = orderRef(db, ref);
  if (o.getString('status') !== 'open') throw u().fail(409, 'Sale ' + (o.getString('number') || '') + ' is ' + (o.getString('status') === 'paid' ? 'already paid' : 'void') + ' and cannot change', { code: 'not_open' });
  return o;
}

function lineJson(l, money) {
  const util = u();
  return {
    id: l.id,
    kind: l.getString('kind'),
    variant: l.getString('variant'),
    product: l.getString('product'),
    category: l.getString('category'),
    name: l.getString('name'),
    variant_title: l.getString('variant_title'),
    sku: l.getString('sku'),
    qty: l.getFloat('qty'),
    unit: l.getString('unit'),
    unit_price: l.getInt('unit_price'),
    list_price: l.getInt('list_price'),
    modifiers: util.getJson(l, 'modifiers') || [],
    price_override: util.getJson(l, 'price_override'),
    line_discount: util.getJson(l, 'line_discount'),
    auto_discount: util.getJson(l, 'auto_discount'),
    tax_name: l.getString('tax_name'),
    tax_rate: l.getFloat('tax_rate'),
    gross: l.getInt('gross'),
    discount: l.getInt('discount'),
    tax: l.getInt('tax'),
    net: l.getInt('net'),
    total: l.getInt('total'),
    total_text: money.plain(l.getInt('total')),
    return_of: l.getString('return_of'),
    returned_qty: l.getFloat('returned_qty'),
    restock: l.getBool('restock'),
    gift_code: l.getString('gift_code'),
    note: l.getString('note'),
  };
}

function paymentJson(pay, money, names) {
  return {
    id: pay.id,
    tender: pay.getString('tender'),
    label: pay.getString('label'),
    amount: pay.getInt('amount'),
    amount_text: money.plain(pay.getInt('amount')),
    tendered: pay.getInt('tendered'),
    change: pay.getInt('change'),
    reference: pay.getString('reference'),
    gift_card: pay.getString('gift_card'),
    points: pay.getInt('points'),
    status: pay.getString('status'),
    staff: names[pay.getString('staff')] || (pay.getString('actor') === 'agent' ? 'Your AI agent' : ''),
    approved_by: pay.getString('approved_by') === '' ? '' : names[pay.getString('approved_by')] || '',
    created: pay.getString('created'),
  };
}

/** A sale as the register, the receipt and the agent read it. */
function orderJson(db, o) {
  const util = u();
  const s = auth().settingsRow(db);
  const money = moneyOf(s);
  const names = audit().staffNames(db);
  const lines = lineRecs(db, o.id).map((l) => lineJson(l, money));
  const pays = paymentRecs(db, o.id).map((p) => paymentJson(p, money, names));
  const cust = o.getString('customer') === '' ? null : util.byId(db, 'customers', o.getString('customer'));
  const reg = o.getString('register') === '' ? null : util.byId(db, 'registers', o.getString('register'));
  const due = o.getInt('total') + o.getInt('tip') + o.getInt('rounding');
  // Where returned lines came from (their receipt numbers).
  const sources = {};
  for (const l of lines) {
    if (l.return_of === '' || sources[l.return_of]) continue;
    const src = util.byId(db, 'order_lines', l.return_of);
    if (src !== null) {
      const so = util.byId(db, 'orders', src.getString('order'));
      sources[l.return_of] = { order: so ? so.id : '', number: so ? so.getString('number') : '' };
    }
  }
  return {
    id: o.id,
    number: o.getString('number'),
    status: o.getString('status'),
    label: o.getString('label'),
    note: o.getString('note'),
    register: reg === null ? null : { id: reg.id, name: reg.getString('name') },
    shift: o.getString('shift'),
    opened_by: o.getString('opened_by') === '' ? (o.getString('actor') === 'agent' ? 'Your AI agent' : '') : names[o.getString('opened_by')] || '',
    closed_by: o.getString('closed_by') === '' ? (o.getString('status') === 'paid' && o.getString('actor') === 'agent' ? 'Your AI agent' : '') : names[o.getString('closed_by')] || '',
    customer:
      cust === null
        ? null
        : { id: cust.id, name: cust.getString('name'), phone: cust.getString('phone'), email: cust.getString('email'), points: cust.getInt('points'), credit: cust.getInt('credit'), tax_exempt: cust.getBool('tax_exempt') },
    order_discount: util.getJson(o, 'order_discount'),
    applied_discount: util.getJson(o, 'applied_discount'),
    tax_exempt: o.getBool('tax_exempt'),
    items: o.getFloat('items'),
    subtotal: o.getInt('subtotal'),
    discount_total: o.getInt('discount_total'),
    tax_total: o.getInt('tax_total'),
    total: o.getInt('total'),
    tip: o.getInt('tip'),
    rounding: o.getInt('rounding'),
    due: due,
    paid_total: o.getInt('paid_total'),
    change_total: o.getInt('change_total'),
    balance: o.getInt('balance'),
    total_text: money.text(o.getInt('total')),
    due_text: money.text(due),
    balance_text: money.text(o.getInt('balance')),
    taxes: util.getJson(o, 'taxes') || [],
    has_returns: o.getBool('has_returns'),
    return_status: o.getString('return_status') || 'none',
    points_earned: o.getInt('points_earned'),
    lines: lines,
    sources: sources,
    payments: pays,
    paid_at: o.getString('paid_at'),
    voided_at: o.getString('voided_at'),
    void_reason: o.getString('void_reason'),
    version: o.getInt('version'),
    created: o.getString('created'),
    updated: o.getString('updated'),
  };
}

/* ---------------------------------------------------------------- pricing */

/** Reprice an open order and save the results on its lines and on it (inside a transaction). */
function reprice(tx, o) {
  const util = u();
  const s = auth().settingsRow(tx);
  const lines = lineRecs(tx, o.id);
  const cust = o.getString('customer') === '' ? null : util.byId(tx, 'customers', o.getString('customer'));
  const def = util.getJson(o, 'order_discount');
  let orderDiscount = null;
  const promos = require(`${__hooks}/lib_discounts.js`).autoNow(tx, new Date());
  if (def && def.source === 'code') {
    const d = util.byId(tx, 'discounts', def.id);
    const pd = d === null ? null : require(`${__hooks}/lib_discounts.js`).plain(d);
    if (pd !== null && require(`${__hooks}/lib_discounts.js`).isLive(pd, new Date())) {
      if (pd.scope === 'order') orderDiscount = { id: pd.id, name: pd.name, kind: pd.kind, value: pd.value, source: 'code', min_subtotal: pd.min_subtotal };
      else promos.push(pd);
    }
  } else if (def && def.source === 'manual') {
    orderDiscount = { id: def.id || '', name: def.name || 'Discount', kind: def.kind, value: def.value, source: 'manual', reason: def.reason || '' };
  }
  const input = {
    includeTax: s.getBool('prices_include_tax'),
    taxExempt: o.getBool('tax_exempt') || (cust !== null && cust.getBool('tax_exempt')),
    orderDiscount: orderDiscount,
    promotions: promos,
    lines: lines.map((l) => {
      const mods = util.getJson(l, 'modifiers') || [];
      const ld = util.getJson(l, 'line_discount');
      const isReturn = l.getFloat('qty') < 0;
      return {
        id: l.id,
        kind: l.getString('kind'),
        qty: l.getFloat('qty'),
        unitPrice: l.getInt('unit_price'),
        modifiersEach: mods.reduce((a, m) => a + (m.price || 0), 0),
        fixedGross: l.getString('return_of') !== '' ? -l.getInt('refund_amount') : undefined,
        product: l.getString('product'),
        category: l.getString('category'),
        taxId: l.getString('tax_id'),
        taxName: l.getString('tax_name'),
        taxRate: l.getString('kind') === 'gift_card' || (l.getFloat('tax_rate') === 0 && l.getString('tax_id') === '') ? null : l.getFloat('tax_rate'),
        lineDiscount: ld ? { kind: ld.kind, value: ld.value, reason: ld.reason } : null,
        isReturn: isReturn,
      };
    }),
  };
  const r = require(`${__hooks}/lib_pricing.js`).price(input);
  let items = 0;
  let cost = 0;
  let hasReturns = false;
  lines.forEach((l, i) => {
    const x = r.lines[i];
    l.set('gross', x.gross);
    l.set('discount', x.discount);
    l.set('order_discount', x.order_discount);
    l.set('tax', x.tax);
    l.set('net', x.net);
    l.set('total', x.total);
    l.set('auto_discount', x.auto);
    if (x.manual !== null) {
      const ld = util.getJson(l, 'line_discount') || {};
      ld.amount = x.manual.amount;
      l.set('line_discount', ld);
    }
    tx.save(l);
    if (l.getString('kind') !== 'gift_card' && l.getFloat('qty') > 0) items += l.getFloat('qty');
    if (l.getFloat('qty') < 0) hasReturns = true;
    if (l.getString('kind') === 'item') cost += l.getFloat('unit_cost') * l.getFloat('qty');
  });
  o.set('subtotal', r.subtotal);
  o.set('discount_total', r.discount_total);
  o.set('tax_total', r.tax_total);
  o.set('total', r.total);
  o.set('taxes', r.taxes);
  o.set('applied_discount', r.order_discount);
  o.set('items', q3(items));
  o.set('cost_total', Math.round(cost * 100) / 100);
  o.set('has_returns', hasReturns);
  if (r.total <= 0 && o.getInt('tip') > 0) o.set('tip', 0);
  settle(tx, o);
  o.set('version', o.getInt('version') + 1);
  tx.save(o);
  return r;
}

/** Recompute what was paid and what is left (inside a transaction; the caller saves). */
function settle(tx, o) {
  let paid = 0;
  let change = 0;
  for (const p of paymentRecs(tx, o.id)) {
    if (p.getString('status') !== 'captured') continue;
    paid += p.getInt('amount');
    change += p.getInt('change');
  }
  o.set('paid_total', paid);
  o.set('change_total', change);
  o.set('balance', o.getInt('total') + o.getInt('tip') + o.getInt('rounding') - paid);
}

/* --------------------------------------------------------------- creating */

function nextPosition(tx, orderId) {
  const rows = tx.findRecordsByFilter('order_lines', 'order = {:o}', '-position', 1, 0, { o: orderId });
  return rows.length ? rows[0].getInt('position') + 1 : 0;
}

/** A new open sale on the actor's register (inside a transaction). */
function create(tx, c, fields) {
  const o = new Record(tx.findCollectionByNameOrId('orders'));
  o.set('status', 'open');
  if (c.registerId) o.set('register', c.registerId);
  if (c.staffId) o.set('opened_by', c.staffId);
  o.set('actor', c.actor);
  o.set('label', (fields && fields.label) || '');
  o.set('return_status', 'none');
  for (const k of ['subtotal', 'discount_total', 'tax_total', 'total', 'tip', 'rounding', 'paid_total', 'change_total', 'balance', 'version', 'points_earned']) o.set(k, 0);
  if (fields && fields.customer) o.set('customer', fields.customer);
  tx.save(o);
  return o;
}

function checkVersion(o, p) {
  const util = u();
  const v = util.int(p, 'expected_version', -1, -1, 1e9);
  if (v >= 0 && v !== o.getInt('version')) throw util.fail(409, 'This sale changed on another screen; it was reloaded', { code: 'stale', version: o.getInt('version') });
}

/** The open sale named by `order`, or a new one when none is named. */
function target(tx, c, p) {
  const util = u();
  const ref = util.str(p, 'order', '');
  if (ref === '') return create(tx, c, {});
  const o = openOrder(tx, ref);
  checkVersion(o, p);
  return o;
}

/** Read modifier choices: option ids, or {group, option} names; validated against the product's groups. */
function readModifiers(L, prod, raw) {
  const util = u();
  const groups = prod.getStringSlice('modifier_groups').map((id) => L.groups[id]).filter((g) => g !== undefined);
  const chosen = [];
  const list = raw === undefined || raw === null ? [] : raw;
  if (!Array.isArray(list)) throw util.fail(400, 'modifiers must be a JSON list of option ids');
  for (const item of list) {
    let found = null;
    for (const g of groups) {
      for (const opt of g.options) {
        const hit = typeof item === 'string' ? opt.id === item || (opt.name.toLowerCase() === item.toLowerCase() && groups.length === 1) : item && String(item.group || '').toLowerCase() === g.name.toLowerCase() && String(item.option || '').toLowerCase() === opt.name.toLowerCase();
        if (hit) found = { group: g.id, group_name: g.name, id: opt.id, name: opt.name, price: opt.price };
      }
    }
    if (found === null) throw util.fail(400, 'No option ' + JSON.stringify(item) + ' for ' + prod.getString('name') + (groups.length ? ' (options: ' + groups.map((g) => g.name + ': ' + g.options.map((x) => x.name).join(', ')).join('; ') + ')' : ' (it has no options)'));
    if (chosen.some((x) => x.id === found.id)) throw util.fail(400, found.name + ' is chosen twice');
    chosen.push(found);
  }
  for (const g of groups) {
    const n = chosen.filter((x) => x.group === g.id).length;
    if (n < g.min) throw util.fail(400, prod.getString('name') + ' needs ' + (g.min === 1 ? 'a ' : g.min + ' choices of ') + g.name, { code: 'options_needed', group: g.id });
    if (g.max > 0 && n > g.max) throw util.fail(400, 'Choose at most ' + g.max + ' of ' + g.name);
  }
  return chosen;
}

function sameModifiers(a, b) {
  const ka = a.map((x) => x.id).sort().join(',');
  const kb = b.map((x) => x.id).sort().join(',');
  return ka === kb;
}

function readQty(p, prod, dflt) {
  const util = u();
  const qty = util.number(p, 'qty', {});
  const q = qty === null ? dflt : qty;
  if (q === 0) throw util.fail(400, 'qty cannot be 0');
  if (Math.abs(q) > MAX_QTY) throw util.fail(400, 'qty can be at most ' + MAX_QTY);
  if (Math.round(q * 1000) !== q * 1000) throw util.fail(400, 'qty can have at most 3 decimals');
  if (prod !== null && (prod.getString('sold_by') || 'each') === 'each' && !Number.isInteger(q)) throw util.fail(400, prod.getString('name') + ' is sold by the piece: give a whole quantity');
  return q;
}

/**
 * Add to a sale: a product variant (variant id, a scanned code, or a
 * product with one variant), a custom amount, or a gift card. Opens a new
 * sale when `order` is not given. A negative qty is a return without a
 * receipt (needs the return permission).
 */
function add(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  A.need(app, c, 'sell', p, { what: 'Selling' });
  const s = c.settings;
  const money = moneyOf(s);
  const kind = util.oneOf(p, 'kind', ['item', 'custom', 'gift_card'], 'item');
  let orderId = '';
  let approver = null;
  let merged = false;
  app.runInTransaction((tx) => {
    const o = target(tx, c, p);
    orderId = o.id;
    const line = new Record(tx.findCollectionByNameOrId('order_lines'));
    line.set('order', o.id);
    line.set('kind', kind);
    line.set('restock', true);
    line.set('note', util.str(p, 'note', '').slice(0, 400));
    if (kind === 'item') {
      const L = catalog().lookups(tx);
      let v = null;
      const vref = util.str(p, 'variant', '');
      const code = util.str(p, 'code', '');
      const pref = util.str(p, 'product', '');
      if (vref !== '') v = util.byId(tx, 'variants', vref);
      else if (code !== '') v = catalog().findCode(tx, code);
      else if (pref !== '') {
        const prod0 = catalog().productRef(tx, pref);
        const vs = tx.findRecordsByFilter('variants', 'product = {:p} && archived = false', 'position', 0, 0, { p: prod0.id });
        if (vs.length !== 1) throw util.fail(400, prod0.getString('name') + ' has ' + vs.length + ' variants; give variant (one of: ' + vs.map((x) => x.id + ' ' + x.getString('title')).join(', ') + ')', { code: 'choose_variant' });
        v = vs[0];
      } else throw util.fail(400, 'Give variant, code or product');
      if (v === null) throw util.fail(404, code !== '' ? 'No product has the code ' + code : 'No such variant', { code: 'not_found' });
      if (v.getBool('archived')) throw util.fail(400, 'That variant is no longer sold');
      const prod = tx.findRecordById('products', v.getString('product'));
      if (prod.getBool('archived')) throw util.fail(400, prod.getString('name') + ' is archived; restore it in Products to sell it');
      const qty = readQty(p, prod, 1);
      const mods = readModifiers(L, prod, util.json(p, 'modifiers', '["<option id>"]'));
      const priceGiven = util.has(p, 'price') && util.str(p, 'price', '') !== '';
      if (qty < 0) approver = A.need(tx, c, 'return', p, { what: 'A return without a receipt' });
      if (qty > 0 && v.getBool('track_stock') && !s.getBool('allow_negative_stock')) {
        const inCart = tx.findRecordsByFilter('order_lines', 'order = {:o} && variant = {:v}', '', 0, 0, { o: o.id, v: v.id }).reduce((a, x) => a + x.getFloat('qty'), 0);
        if (v.getFloat('stock') - inCart - qty < 0) throw util.fail(400, 'Only ' + util.fmt(Math.max(v.getFloat('stock') - inCart, 0)) + ' of ' + prod.getString('name') + ' in stock', { code: 'out_of_stock' });
      }
      // The same thing again joins its line (Square and Shopify stack identical items).
      if (!priceGiven && qty > 0 && line.getString('note') === '') {
        const same = tx
          .findRecordsByFilter('order_lines', "order = {:o} && variant = {:v} && return_of = '' && note = ''", '', 0, 0, { o: o.id, v: v.id })
          .find((x) => x.getFloat('qty') > 0 && util.getJson(x, 'price_override') === null && util.getJson(x, 'line_discount') === null && sameModifiers(util.getJson(x, 'modifiers') || [], mods));
        if (same !== undefined) {
          const nq = q3(same.getFloat('qty') + qty);
          if (nq > MAX_QTY) throw util.fail(400, 'qty can be at most ' + MAX_QTY);
          same.set('qty', nq);
          tx.save(same);
          merged = true;
        }
      }
      if (!merged) {
        const tax = catalog().effectiveTax(prod, L);
        line.set('variant', v.id);
        line.set('product', prod.id);
        line.set('category', prod.getString('category'));
        line.set('name', prod.getString('name'));
        line.set('variant_title', v.getString('title'));
        line.set('sku', v.getString('sku'));
        line.set('qty', qty);
        line.set('unit', prod.getString('unit'));
        line.set('list_price', v.getInt('price'));
        line.set('unit_price', v.getInt('price'));
        line.set('modifiers', mods);
        line.set('unit_cost', v.getFloat('cost'));
        line.set('tax_id', tax === null ? '' : tax.id);
        line.set('tax_name', tax === null ? '' : tax.name);
        line.set('tax_rate', tax === null ? 0 : tax.rate);
        if (priceGiven) {
          const price = money.param(p, 'price', { min: 0 });
          if (price !== v.getInt('price')) {
            const ok = A.need(tx, c, 'price_override', p, { what: 'Changing the price' });
            line.set('unit_price', price);
            line.set('price_override', { from: v.getInt('price'), to: price, reason: util.str(p, 'reason', '').slice(0, 200), approved_by: ok === null ? '' : ok.getString('name') });
            approver = ok || approver;
          }
        }
      }
    } else {
      const amount = money.param(p, 'amount', { required: true, min: 1, example: '25.00' });
      line.set('qty', 1);
      line.set('list_price', amount);
      line.set('unit_price', amount);
      line.set('modifiers', []);
      line.set('unit_cost', 0);
      if (kind === 'gift_card') {
        const C = customers();
        const codeIn = C.normCode(util.str(p, 'gift_code', ''));
        if (codeIn !== '') {
          if (!/^[A-Z0-9]{6,40}$/.test(codeIn)) throw util.fail(400, 'gift_code must be 6 to 40 letters or digits');
          const card = C.cardByCode(tx, codeIn);
          if (card !== null && card.getString('status') !== 'active') throw util.fail(400, 'That gift card is disabled');
          const dup = tx.findRecordsByFilter('order_lines', "order = {:o} && gift_code = {:g} && kind = 'gift_card'", '', 1, 0, { o: o.id, g: codeIn });
          if (dup.length) throw util.fail(400, 'That gift card is already on this sale');
        }
        line.set('name', codeIn !== '' && C.cardByCode(tx, codeIn) !== null ? 'Gift card top-up' : 'Gift card');
        line.set('gift_code', codeIn);
        line.set('tax_id', '');
        line.set('tax_rate', 0);
      } else {
        line.set('name', util.squash(util.str(p, 'name', '')) || 'Custom amount');
        const taxRef = util.str(p, 'tax', 'default');
        let tax = null;
        if (taxRef === 'default') tax = catalog().defaultTax(tx);
        else if (taxRef !== 'none' && taxRef !== '') {
          tax = util.byId(tx, 'taxes', taxRef) || util.findOne(tx, 'taxes', 'name = {:n}', { n: taxRef });
          if (tax === null) throw util.fail(404, 'No tax rate "' + taxRef + '"');
        }
        line.set('tax_id', tax === null ? '' : tax.id);
        line.set('tax_name', tax === null ? '' : tax.getString('name'));
        line.set('tax_rate', tax === null ? 0 : tax.getFloat('rate'));
      }
    }
    if (!merged) {
      line.set('position', nextPosition(tx, o.id));
      tx.save(line);
    }
    if (approver !== null && kind === 'item' && line.getFloat('qty') < 0) audit().log(tx, 'return', c, { approver: approver, order: o.id, detail: 'Return without a receipt: ' + line.getString('name') });
    else if (approver !== null) audit().log(tx, 'price_override', c, { approver: approver, order: o.id, detail: line.getString('name') + ' sold at ' + money.plain(line.getInt('unit_price')) + ' instead of ' + money.plain(line.getInt('list_price')) });
    reprice(tx, o);
  });
  return orderJson(app, app.findRecordById('orders', orderId));
}

/** Change a line: qty, price, discount, note, restock (returns), options. */
function updateLine(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  A.need(app, c, 'sell', p, { what: 'Selling' });
  const money = moneyOf(c.settings);
  const lineId = util.req(p, 'line', '<line id>');
  let orderId = '';
  app.runInTransaction((tx) => {
    const l = util.byId(tx, 'order_lines', lineId);
    if (l === null) throw util.fail(404, 'No line ' + lineId);
    const o = openOrder(tx, l.getString('order'));
    checkVersion(o, p);
    orderId = o.id;
    const isReturn = l.getString('return_of') !== '' || l.getFloat('qty') < 0;
    const prod = l.getString('product') === '' ? null : util.byId(tx, 'products', l.getString('product'));
    if (util.has(p, 'qty')) {
      if (l.getString('kind') === 'gift_card') throw util.fail(400, 'A gift card line has a quantity of 1');
      if (l.getString('return_of') !== '') {
        const q = readQty(p, null, l.getFloat('qty'));
        if (q >= 0) throw util.fail(400, 'A returned line has a negative quantity');
        const src = tx.findRecordById('order_lines', l.getString('return_of'));
        const left = returnable(tx, src, l.id);
        if (-q > left + 1e-9) throw util.fail(400, 'Only ' + util.fmt(left) + ' of ' + src.getString('name') + ' can still be returned');
        l.set('qty', q);
        l.set('refund_amount', refundFor(tx, src, -q, l.id));
      } else {
        const q = readQty(p, prod, l.getFloat('qty'));
        if ((q < 0) !== (l.getFloat('qty') < 0)) {
          if (q < 0) A.need(tx, c, 'return', p, { what: 'A return without a receipt' });
        }
        if (q > 0 && l.getString('variant') !== '' && !c.settings.getBool('allow_negative_stock')) {
          const v = util.byId(tx, 'variants', l.getString('variant'));
          if (v !== null && v.getBool('track_stock')) {
            const others = tx.findRecordsByFilter('order_lines', 'order = {:o} && variant = {:v} && id != {:l}', '', 0, 0, { o: o.id, v: v.id, l: l.id }).reduce((a, x) => a + x.getFloat('qty'), 0);
            if (v.getFloat('stock') - others - q < 0) throw util.fail(400, 'Only ' + util.fmt(Math.max(v.getFloat('stock') - others, 0)) + ' in stock', { code: 'out_of_stock' });
          }
        }
        l.set('qty', q);
      }
    }
    if (util.has(p, 'price')) {
      if (isReturn) throw util.fail(400, 'A returned line keeps the price that was paid');
      if (l.getString('kind') === 'gift_card') throw util.fail(400, 'Change a gift card amount by removing it and adding it again');
      const price = money.param(p, 'price', { required: true, min: 0 });
      const from = l.getInt('list_price');
      if (price === from) {
        l.set('unit_price', from);
        l.set('price_override', null);
      } else if (l.getString('kind') === 'custom') {
        l.set('unit_price', price);
        l.set('list_price', price);
      } else {
        const ok = A.need(tx, c, 'price_override', p, { what: 'Changing the price' });
        l.set('unit_price', price);
        l.set('price_override', { from: from, to: price, reason: util.str(p, 'reason', '').slice(0, 200), approved_by: ok === null ? '' : ok.getString('name') });
        audit().log(tx, 'price_override', c, { approver: ok, order: o.id, detail: l.getString('name') + ' sold at ' + money.plain(price) + ' instead of ' + money.plain(from) + (util.str(p, 'reason', '') ? ' (' + util.str(p, 'reason', '') + ')' : '') });
      }
    }
    if (util.has(p, 'discount')) {
      if (isReturn || l.getString('kind') === 'gift_card') throw util.fail(400, 'This line cannot be discounted');
      const d = util.json(p, 'discount', '{"kind": "percent", "value": 10, "reason": "Damaged box"}');
      if (d === null || d === undefined || d === '') l.set('line_discount', null);
      else {
        if (typeof d !== 'object' || (d.kind !== 'percent' && d.kind !== 'amount')) throw util.fail(400, 'discount is {"kind": "percent" or "amount", "value": ..., "reason": "..."} or null');
        const gross = Math.round((l.getInt('unit_price') + (util.getJson(l, 'modifiers') || []).reduce((a, m) => a + m.price, 0)) * l.getFloat('qty'));
        let value;
        let pct;
        if (d.kind === 'percent') {
          value = Number(d.value);
          if (!isFinite(value) || value <= 0 || value > 100) throw util.fail(400, 'A percent discount is more than 0 and at most 100');
          pct = value;
        } else {
          value = money.toMinor(d.value, 'discount.value');
          if (value <= 0) throw util.fail(400, 'A discount amount must be more than 0');
          if (value > gross) throw util.fail(400, 'The discount is more than the line (' + money.plain(gross) + ')');
          pct = gross > 0 ? (value * 100) / gross : 100;
        }
        const ok = A.needDiscount(tx, c, pct, p);
        const reason = String(d.reason || '').slice(0, 200);
        l.set('line_discount', { kind: d.kind, value: value, reason: reason, approved_by: ok === null ? '' : ok.getString('name') });
        audit().log(tx, 'discount', c, { approver: ok, order: o.id, detail: l.getString('name') + ': ' + (d.kind === 'percent' ? util.fmt(value) + '%' : money.plain(value)) + ' off' + (reason ? ' (' + reason + ')' : '') });
      }
    }
    if (util.has(p, 'modifiers')) {
      if (prod === null || isReturn) throw util.fail(400, 'This line has no options to change');
      l.set('modifiers', readModifiers(catalog().lookups(tx), prod, util.json(p, 'modifiers', '["<option id>"]')));
    }
    if (util.has(p, 'note')) l.set('note', util.str(p, 'note', '').slice(0, 400));
    if (util.has(p, 'restock')) {
      if (!isReturn) throw util.fail(400, 'restock applies to returned lines');
      l.set('restock', util.bool(p, 'restock', true));
    }
    if (util.has(p, 'name') && l.getString('kind') === 'custom') l.set('name', util.squash(util.str(p, 'name', '')) || 'Custom amount');
    tx.save(l);
    reprice(tx, o);
  });
  return orderJson(app, app.findRecordById('orders', orderId));
}

function removeLine(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  auth().need(app, c, 'sell', p, { what: 'Selling' });
  const money = moneyOf(c.settings);
  const lineId = util.req(p, 'line', '<line id>');
  let orderId = '';
  app.runInTransaction((tx) => {
    const l = util.byId(tx, 'order_lines', lineId);
    if (l === null) throw util.fail(404, 'No line ' + lineId);
    const o = openOrder(tx, l.getString('order'));
    checkVersion(o, p);
    orderId = o.id;
    audit().log(tx, 'line_removed', c, { order: o.id, amount: l.getInt('total'), detail: 'Removed ' + util.fmt(l.getFloat('qty')) + ' x ' + l.getString('name') + (l.getString('variant_title') ? ' (' + l.getString('variant_title') + ')' : '') + ' ' + money.plain(l.getInt('total')) });
    tx.delete(tx.findRecordById('order_lines', l.id));
    reprice(tx, o);
  });
  return orderJson(app, app.findRecordById('orders', orderId));
}

/**
 * Change the sale itself: customer, ticket name, note, order discount
 * (by hand, a promotion, or a coupon code), tax exemption and tip.
 */
function update(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  A.need(app, c, 'sell', p, { what: 'Selling' });
  const money = moneyOf(c.settings);
  let orderId = '';
  app.runInTransaction((tx) => {
    const o = target(tx, c, p);
    orderId = o.id;
    if (util.has(p, 'customer')) {
      const ref = util.str(p, 'customer', '');
      if (ref === '') o.set('customer', '');
      else o.set('customer', customers().customerRef(tx, ref).id);
    }
    if (util.has(p, 'label')) o.set('label', util.squash(util.str(p, 'label', '')).slice(0, 60));
    if (util.has(p, 'note')) o.set('note', util.str(p, 'note', '').slice(0, 1000));
    if (util.has(p, 'tax_exempt')) {
      const v = util.bool(p, 'tax_exempt', false);
      if (v && !o.getBool('tax_exempt')) {
        const ok = A.need(tx, c, 'tax_exempt', p, { what: 'Removing tax' });
        audit().log(tx, 'tax_exempt', c, { approver: ok, order: o.id, detail: 'Sale made tax exempt' + (util.str(p, 'reason', '') ? ': ' + util.str(p, 'reason', '') : '') });
      }
      o.set('tax_exempt', v);
    }
    const code = util.str(p, 'code', '');
    if (code !== '') {
      const D = require(`${__hooks}/lib_discounts.js`);
      const d = D.byCode(tx, code.toUpperCase());
      if (d === null) throw util.fail(404, 'No promotion has the code ' + code.toUpperCase(), { code: 'bad_code' });
      const pd = D.plain(d);
      if (!D.isLive(pd, new Date())) throw util.fail(400, 'The code ' + pd.code + ' is not valid right now', { code: 'bad_code' });
      if (pd.manager_only) A.need(tx, c, 'discount', p, { what: 'This promotion', check: (m) => m.discount === true && m.max_discount >= 100 });
      o.set('order_discount', { source: 'code', id: pd.id, code: pd.code, name: pd.name });
    }
    if (util.has(p, 'discount')) {
      const d = util.json(p, 'discount', '{"kind": "percent", "value": 10, "reason": "Regular"} or {"promotion": "<id>"}');
      if (d === null || d === undefined || d === '') o.set('order_discount', null);
      else {
        if (typeof d !== 'object') throw util.fail(400, 'discount must be a JSON object or null');
        let kind = d.kind;
        let value = d.value;
        let name = 'Discount';
        let promoId = '';
        if (d.promotion) {
          const D = require(`${__hooks}/lib_discounts.js`);
          const rec = util.byId(tx, 'discounts', String(d.promotion));
          if (rec === null) throw util.fail(404, 'No promotion ' + d.promotion);
          const pd = D.plain(rec);
          if (pd.mode !== 'manual' || pd.scope !== 'order') throw util.fail(400, pd.name + ' is not a manual order discount');
          if (!pd.active) throw util.fail(400, pd.name + ' is turned off');
          kind = pd.kind;
          value = pd.value;
          name = pd.name;
          promoId = pd.id;
          if (pd.manager_only) A.need(tx, c, 'discount', p, { what: name, check: (m) => m.discount === true && m.max_discount >= 100 });
        }
        if (kind !== 'percent' && kind !== 'amount') throw util.fail(400, 'discount.kind is percent or amount');
        let pct;
        if (kind === 'percent') {
          value = Number(value);
          if (!isFinite(value) || value <= 0 || value > 100) throw util.fail(400, 'A percent discount is more than 0 and at most 100');
          pct = value;
        } else {
          value = promoId !== '' ? Number(value) : money.toMinor(value, 'discount.value');
          if (!(value > 0)) throw util.fail(400, 'A discount amount must be more than 0');
          const base = o.getInt('subtotal') - o.getInt('discount_total');
          pct = base > 0 ? (value * 100) / base : 100;
        }
        const ok = A.needDiscount(tx, c, Math.min(pct, 100), p);
        const reason = String(d.reason || '').slice(0, 200);
        o.set('order_discount', { source: 'manual', id: promoId, name: name, kind: kind, value: value, reason: reason, approved_by: ok === null ? '' : ok.getString('name') });
        audit().log(tx, 'discount', c, { approver: ok, order: o.id, detail: 'Order discount ' + (kind === 'percent' ? util.fmt(value) + '%' : money.plain(value)) + (name !== 'Discount' ? ' (' + name + ')' : '') + (reason ? ': ' + reason : '') });
      }
    }
    if (util.has(p, 'tip') || util.has(p, 'tip_percent')) {
      if (!c.settings.getBool('tips_enabled') && (util.str(p, 'tip', '0') !== '0' || util.has(p, 'tip_percent'))) throw util.fail(400, 'Tips are turned off in Settings');
      let tip = 0;
      if (util.has(p, 'tip_percent')) {
        const pct = util.number(p, 'tip_percent', { min: 0, max: 100 });
        // The total always includes tax; before_tax tips on the total less tax.
        const base = c.settings.getString('tip_basis') === 'after_tax' ? o.getInt('total') : o.getInt('total') - o.getInt('tax_total');
        tip = require(`${__hooks}/lib_money.js`).round((Math.max(base, 0) * pct) / 100);
      } else tip = money.param(p, 'tip', { min: 0 }) || 0;
      if (tip > 0 && o.getInt('total') <= 0) throw util.fail(400, 'A tip needs a sale with something to pay');
      o.set('tip', tip);
    }
    reprice(tx, o);
  });
  return orderJson(app, app.findRecordById('orders', orderId));
}

/* ---------------------------------------------------------------- returns */

/** How much of a sold line can still come back (not counting `exceptLine`). */
function returnable(tx, src, exceptLine) {
  let back = 0;
  for (const l of tx.findRecordsByFilter('order_lines', 'return_of = {:s}', '', 0, 0, { s: src.id })) {
    if (exceptLine && l.id === exceptLine) continue;
    const o = tx.findRecordById('orders', l.getString('order'));
    if (o.getString('status') === 'void') continue;
    back += -l.getFloat('qty');
  }
  return q3(src.getFloat('qty') - back);
}

/**
 * What returning `qty` of a sold line refunds: its share of what was paid,
 * counted cumulatively so returning everything refunds exactly the line.
 * Prices with tax included refund the total; prices without tax refund the
 * net (tax is added back by the pricing).
 */
function refundFor(tx, src, qty, exceptLine) {
  const round = require(`${__hooks}/lib_money.js`).round;
  const s = auth().settingsRow(tx);
  const paid = s.getBool('prices_include_tax') ? src.getInt('total') : src.getInt('net');
  const done = q3(src.getFloat('qty') - returnable(tx, src, exceptLine));
  const all = src.getFloat('qty');
  return round((paid * (done + qty)) / all) - round((paid * done) / all);
}

/**
 * Bring items back from a paid sale into an open sale (a new one unless
 * `order` names one, which makes it an exchange). lines: [{line, qty,
 * restock}] or all=true.
 */
function startReturn(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  const approver = A.need(app, c, 'return', p, { what: 'A return' });
  const src = orderRef(app, util.req(p, 'from', '<receipt number or sale id>'));
  if (src.getString('status') !== 'paid') throw util.fail(400, 'Only a paid sale can be returned');
  const wantAll = util.bool(p, 'all', false);
  const list = util.list(p, 'lines', '[{"line": "<line id>", "qty": 1, "restock": true}]');
  if (!wantAll && (!list || list.length === 0)) throw util.fail(400, 'lines is required (or all=true)');
  let orderId = '';
  let count = 0;
  app.runInTransaction((tx) => {
    const o = target(tx, c, p);
    orderId = o.id;
    if (o.getString('customer') === '' && src.getString('customer') !== '') o.set('customer', src.getString('customer'));
    const srcLines = lineRecs(tx, src.id).filter((l) => l.getFloat('qty') > 0 && l.getString('return_of') === '');
    const wanted = wantAll
      ? srcLines.filter((l) => l.getString('kind') !== 'gift_card').map((l) => ({ line: l.id, qty: returnable(tx, l), restock: true })).filter((x) => x.qty > 0)
      : list.map((x, i) => {
          if (!x || typeof x !== 'object') throw util.fail(400, 'lines[' + i + '] must be an object');
          return { line: String(x.line || ''), qty: Number(x.qty), restock: x.restock !== false && x.restock !== 'false' };
        });
    if (wanted.length === 0) throw util.fail(400, 'Everything on that sale was already returned');
    wanted.forEach((w, i) => {
      const sl = srcLines.find((l) => l.id === w.line);
      if (!sl) throw util.fail(400, 'lines[' + i + '].line is not a sold line of sale ' + src.getString('number'));
      if (sl.getString('kind') === 'gift_card') throw util.fail(400, 'Gift cards cannot be returned (their balance may be spent)');
      if (!isFinite(w.qty) || w.qty <= 0) throw util.fail(400, 'lines[' + i + '].qty must be more than 0');
      const prod = sl.getString('product') === '' ? null : util.byId(tx, 'products', sl.getString('product'));
      if (prod !== null && (prod.getString('sold_by') || 'each') === 'each' && !Number.isInteger(w.qty)) throw util.fail(400, sl.getString('name') + ' is returned in whole pieces');
      const left = returnable(tx, sl);
      if (w.qty > left + 1e-9) throw util.fail(400, 'Only ' + util.fmt(left) + ' of ' + sl.getString('name') + ' can still be returned');
      // Already returning this line on this sale: add to it.
      const pending = tx.findRecordsByFilter('order_lines', 'order = {:o} && return_of = {:s}', '', 1, 0, { o: o.id, s: sl.id });
      const l = pending.length ? pending[0] : new Record(tx.findCollectionByNameOrId('order_lines'));
      const qty = q3((pending.length ? -l.getFloat('qty') : 0) + w.qty);
      if (pending.length && qty > returnable(tx, sl, l.id) + 1e-9) throw util.fail(400, 'Only ' + util.fmt(returnable(tx, sl, l.id)) + ' of ' + sl.getString('name') + ' can still be returned');
      if (!pending.length) {
        for (const k of ['kind', 'variant', 'product', 'category', 'name', 'variant_title', 'sku', 'unit', 'tax_id', 'tax_name']) l.set(k, sl.getString(k));
        l.set('order', o.id);
        l.set('tax_rate', sl.getFloat('tax_rate'));
        l.set('list_price', sl.getInt('list_price'));
        l.set('modifiers', util.getJson(sl, 'modifiers') || []);
        l.set('unit_cost', sl.getFloat('unit_cost'));
        l.set('return_of', sl.id);
        l.set('position', nextPosition(tx, o.id));
      }
      l.set('qty', -qty);
      l.set('refund_amount', refundFor(tx, sl, qty, pending.length ? l.id : ''));
      l.set('unit_price', Math.round(l.getInt('refund_amount') / qty));
      l.set('restock', w.restock);
      tx.save(l);
      count += 1;
    });
    audit().log(tx, 'return', c, { approver: approver, order: o.id, detail: util.plural(count, 'line') + ' from sale ' + src.getString('number') });
    reprice(tx, o);
  });
  return orderJson(app, app.findRecordById('orders', orderId));
}

/* ------------------------------------------------------------ voiding etc */

/** Abandon an open sale. A sale with payments taken needs them voided first. */
function voidOrder(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  auth().need(app, c, 'sell', p, { what: 'Selling' });
  const money = moneyOf(c.settings);
  const reason = util.str(p, 'reason', '').slice(0, 400);
  let gone = false;
  let id = '';
  app.runInTransaction((tx) => {
    const o = openOrder(tx, util.req(p, 'order', '<order id>'));
    id = o.id;
    const captured = paymentRecs(tx, o.id).filter((x) => x.getString('status') === 'captured');
    if (captured.length) throw util.fail(400, 'Void the ' + util.plural(captured.length, 'payment') + ' taken on this sale first (or finish it)', { code: 'has_payments' });
    const lines = lineRecs(tx, o.id);
    if (lines.length === 0 && o.getString('label') === '') {
      tx.delete(tx.findRecordById('orders', o.id));
      gone = true;
      return;
    }
    o.set('status', 'void');
    o.set('voided_at', new Date().toISOString());
    o.set('void_reason', reason);
    if (c.staffId) o.set('voided_by', c.staffId);
    tx.save(o);
    audit().log(tx, 'order_voided', c, {
      order: o.id,
      amount: o.getInt('total'),
      detail: 'Cleared ' + util.plural(lines.length, 'line') + ' (' + money.plain(o.getInt('total')) + ')' + (o.getString('label') ? ' on ticket ' + o.getString('label') : '') + (reason ? ': ' + reason : ''),
      data: { lines: lines.map((l) => util.fmt(l.getFloat('qty')) + ' x ' + l.getString('name')) },
    });
  });
  return gone ? { deleted: true, id: id } : orderJson(app, app.findRecordById('orders', id));
}

/** Finish an open sale whose balance is zero (an even exchange, or a sale paid in full). */
function complete(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  auth().need(app, c, 'sell', p, { what: 'Selling' });
  let id = '';
  app.runInTransaction((tx) => {
    const o = openOrder(tx, util.req(p, 'order', '<order id>'));
    id = o.id;
    reprice(tx, o);
    if (o.getInt('balance') !== 0) throw util.fail(400, 'This sale still has ' + moneyOf(c.settings).text(o.getInt('balance')) + (o.getInt('balance') > 0 ? ' to pay' : ' to refund'), { code: 'balance_left' });
    finalize(tx, c, o);
  });
  return orderJson(app, app.findRecordById('orders', id));
}

/* --------------------------------------------------------------- finishing */

/** Finish a sale whose balance reached zero (inside a transaction). */
function finalize(tx, c, o) {
  const util = u();
  const s = auth().settingsRow(tx);
  const money = moneyOf(s);
  const C = customers();
  const stock = require(`${__hooks}/lib_stock.js`);
  const lines = lineRecs(tx, o.id);
  if (lines.length === 0) throw util.fail(400, 'This sale has nothing on it');
  const n = s.getInt('next_receipt');
  s.set('next_receipt', n + 1);
  tx.save(s);
  o.set('number', s.getString('receipt_prefix') + n);
  o.set('status', 'paid');
  o.set('paid_at', new Date().toISOString());
  if (c.staffId) o.set('closed_by', c.staffId);
  if (o.getString('register') === '' && c.registerId) o.set('register', c.registerId);
  if (o.getString('register') !== '') {
    const sh = util.findOne(tx, 'shifts', "register = {:r} && status = 'open'", { r: o.getString('register') });
    if (sh !== null) o.set('shift', sh.id);
  }
  const used = {};
  const sources = {};
  for (const l of lines) {
    const kind = l.getString('kind');
    const qty = l.getFloat('qty');
    if (kind === 'item' && l.getString('variant') !== '') {
      const v = util.byId(tx, 'variants', l.getString('variant'));
      if (v !== null && v.getBool('track_stock')) {
        const name = l.getString('name') + (l.getString('variant_title') ? ' (' + l.getString('variant_title') + ')' : '');
        if (qty > 0) stock.move(tx, c, v, -qty, 'sale', { name: name, order: o.id });
        else if (l.getBool('restock')) stock.move(tx, c, v, -qty, 'return', { name: name, order: o.id });
      }
    }
    if (kind === 'gift_card') {
      let code = l.getString('gift_code');
      let card = code === '' ? null : C.cardByCode(tx, code);
      if (card === null) {
        card = new Record(tx.findCollectionByNameOrId('gift_cards'));
        card.set('code', code === '' ? C.newCode(tx) : code);
        card.set('balance', 0);
        card.set('issued', 0);
        card.set('status', 'active');
        if (o.getString('customer') !== '') card.set('customer', o.getString('customer'));
        tx.save(card);
        code = card.getString('code');
        l.set('gift_code', code);
        tx.save(l);
        C.moveBalance(tx, c, { account: 'gift_card', giftCard: card.id, delta: l.getInt('total'), reason: 'issue', order: o.id, note: 'Sold on receipt ' + o.getString('number') });
      } else {
        if (card.getString('status') !== 'active') throw util.fail(400, 'Gift card •••• ' + code.slice(-4) + ' is disabled');
        C.moveBalance(tx, c, { account: 'gift_card', giftCard: card.id, delta: l.getInt('total'), reason: 'reload', order: o.id, note: 'Topped up on receipt ' + o.getString('number') });
      }
    }
    if (l.getString('return_of') !== '') {
      const src = util.byId(tx, 'order_lines', l.getString('return_of'));
      if (src !== null) {
        src.set('returned_qty', q3(src.getFloat('returned_qty') - qty));
        tx.save(src);
        sources[src.getString('order')] = true;
      }
    }
    const auto = util.getJson(l, 'auto_discount');
    if (auto && auto.id) used[auto.id] = true;
  }
  const applied = util.getJson(o, 'applied_discount');
  if (applied && applied.id) used[applied.id] = true;
  for (const id of Object.keys(used)) {
    const d = util.byId(tx, 'discounts', id);
    if (d !== null) {
      d.set('uses', d.getInt('uses') + 1);
      tx.save(d);
    }
  }
  for (const sid of Object.keys(sources)) {
    const so = util.byId(tx, 'orders', sid);
    if (so === null) continue;
    const sl = lineRecs(tx, so.id).filter((x) => x.getFloat('qty') > 0 && x.getString('kind') !== 'gift_card');
    const all = sl.every((x) => x.getFloat('returned_qty') >= x.getFloat('qty') - 1e-9);
    const any = sl.some((x) => x.getFloat('returned_qty') > 0);
    so.set('return_status', all ? 'full' : any ? 'partial' : 'none');
    tx.save(so);
  }
  // The customer: a visit, what they spent, and points.
  if (o.getString('customer') !== '') {
    const cust = util.byId(tx, 'customers', o.getString('customer'));
    if (cust !== null) {
      cust.set('visits', cust.getInt('visits') + 1);
      cust.set('spent', cust.getInt('spent') + o.getInt('total'));
      cust.set('last_visit', new Date().toISOString());
      tx.save(cust);
      if (s.getBool('loyalty_enabled') && s.getFloat('points_per_unit') > 0) {
        const eligible = lines.filter((l) => l.getString('kind') !== 'gift_card').reduce((a, l) => a + l.getInt('net'), 0);
        let pts = eligible >= 0 ? Math.floor((eligible / money.unit) * s.getFloat('points_per_unit') + 1e-9) : -Math.floor((-eligible / money.unit) * s.getFloat('points_per_unit') + 1e-9);
        if (pts < 0) pts = Math.max(pts, -tx.findRecordById('customers', cust.id).getInt('points'));
        if (pts !== 0) {
          C.moveBalance(tx, c, { account: 'points', customer: cust.id, delta: pts, reason: pts > 0 ? 'earn' : 'refund', order: o.id, note: 'Receipt ' + o.getString('number') });
          o.set('points_earned', pts);
        }
      }
    }
  }
  tx.save(o);
  if (o.getBool('has_returns')) {
    audit().log(tx, 'return', c, { order: o.id, amount: o.getInt('total'), detail: 'Receipt ' + o.getString('number') + ' with returns, ' + (o.getInt('total') < 0 ? 'refunded ' + money.plain(-o.getInt('total')) : 'total ' + money.plain(o.getInt('total'))) });
  }
  return o;
}

/* ------------------------------------------------------------------ lists */

function summaryJson(o, money, names, cust) {
  return {
    id: o.id,
    number: o.getString('number'),
    status: o.getString('status'),
    label: o.getString('label'),
    customer: cust ? { id: cust.id, name: cust.getString('name') } : null,
    items: o.getFloat('items'),
    total: o.getInt('total'),
    total_text: money.plain(o.getInt('total')),
    tip: o.getInt('tip'),
    balance: o.getInt('balance'),
    paid_total: o.getInt('paid_total'),
    has_returns: o.getBool('has_returns'),
    return_status: o.getString('return_status') || 'none',
    register: o.getString('register'),
    staff: names[o.getString('closed_by')] || names[o.getString('opened_by')] || (o.getString('actor') === 'agent' ? 'Your AI agent' : ''),
    paid_at: o.getString('paid_at'),
    created: o.getString('created'),
    updated: o.getString('updated'),
  };
}

/** Sales: open tickets, or paid and void sales in a date range, newest first. */
function list(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const status = util.oneOf(p, 'status', ['open', 'paid', 'void', 'all'], 'paid');
  if (status !== 'open' && !c.can('view_reports')) {
    // Without reports, staff see the sales of their own register today.
    if (c.registerId === '') throw util.fail(403, 'Seeing past sales needs the reports permission', { code: 'forbidden' });
  }
  const money = moneyOf(c.settings);
  const filters = [];
  const bind = {};
  if (status !== 'all') {
    filters.push('status = {:st}');
    bind.st = status;
  }
  if (status !== 'open') {
    const r = c.can('view_reports') ? util.range(p, 30) : util.range({}, 1);
    filters.push(status === 'paid' ? 'paid_at >= {:a} && paid_at < {:b}' : 'created >= {:a} && created < {:b}');
    bind.a = util.dbDate(r.start);
    bind.b = util.dbDate(r.end);
    if (!c.can('view_reports')) {
      filters.push('register = {:myreg}');
      bind.myreg = c.registerId;
    }
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    const custIds = app.findRecordsByFilter('customers', 'name ~ {:q} || phone ~ {:q} || email ~ {:q}', '', 50, 0, { q: q }).map((x) => x.id);
    const parts = ['number ~ {:q}', 'label ~ {:q}'];
    custIds.forEach((id, i) => {
      parts.push('customer = {:c' + i + '}');
      bind['c' + i] = id;
    });
    filters.push('(' + parts.join(' || ') + ')');
    bind.q = q;
  }
  for (const k of ['register', 'customer']) {
    const v = util.str(p, k, '');
    if (v !== '') {
      filters.push(k + ' = {:' + k + '}');
      bind[k] = v;
    }
  }
  const staff = util.str(p, 'staff', '');
  if (staff !== '') {
    filters.push('(closed_by = {:sf} || opened_by = {:sf})');
    bind.sf = staff;
  }
  if (util.bool(p, 'returns', false)) filters.push('has_returns = true');
  const limit = util.int(p, 'limit', 50, 1, 500);
  const page = util.int(p, 'page', 1, 1, 100000);
  const sort = status === 'paid' ? '-paid_at' : '-updated';
  const rows = app.findRecordsByFilter('orders', filters.join(' && '), sort, limit + 1, (page - 1) * limit, bind);
  const names = audit().staffNames(app);
  const custs = {};
  for (const o of rows) {
    const id = o.getString('customer');
    if (id !== '' && custs[id] === undefined) custs[id] = util.byId(app, 'customers', id);
  }
  return { orders: rows.slice(0, limit).map((o) => summaryJson(o, money, names, custs[o.getString('customer')] || null)), more: rows.length > limit };
}

function get(app, e, p) {
  const util = u();
  auth().context(app, e, p);
  const o = orderRef(app, util.req(p, 'order', '<order id or receipt number>'));
  const out = orderJson(app, o);
  if (o.getString('status') === 'paid') {
    // What can still come back, per line.
    out.returnable = {};
    for (const l of lineRecs(app, o.id)) if (l.getFloat('qty') > 0 && l.getString('kind') !== 'gift_card' && l.getString('return_of') === '') out.returnable[l.id] = returnable(app, l);
    out.returns = util
      .rows(app, "SELECT DISTINCT o.id AS id, o.number AS number, o.status AS status FROM order_lines l JOIN orders o ON o.id = l.\"order\" WHERE l.return_of IN (SELECT id FROM order_lines WHERE \"order\" = {:o}) AND o.status != 'void'", { id: '', number: '', status: '' }, { o: o.id })
      .map((x) => ({ id: x.id, number: x.number, status: x.status }));
  }
  return { order: out };
}

module.exports = {
  lineRecs: lineRecs,
  paymentRecs: paymentRecs,
  orderRef: orderRef,
  openOrder: openOrder,
  orderJson: orderJson,
  reprice: reprice,
  settle: settle,
  create: create,
  add: add,
  updateLine: updateLine,
  removeLine: removeLine,
  update: update,
  startReturn: startReturn,
  returnable: returnable,
  voidOrder: voidOrder,
  complete: complete,
  finalize: finalize,
  list: list,
  get: get,
};
