/// <reference path="../pb_data/types.d.ts" />
/**
 * Sales: the ledger. A sale is written once, by finalize, and never changed.
 *
 * finalize takes the cart as the counter built it, re-prices every line from
 * the catalog (a page cannot set its own prices), re-computes the totals
 * with lib_calc and refuses the sale when the total differs from the one the
 * cashier showed (total_changed), so what was charged is what is recorded.
 *
 * - Idempotent: the counter names each sale with a ref before paying; the
 *   same ref and the same cart return the sale already written (a double
 *   tap or a retry after a lost answer never charges twice), and the same
 *   ref with a different cart is refused (ref_conflict).
 * - Gapless receipt numbers per register (R1-000123), assigned inside the
 *   transaction from the register's counter: a sale that fails takes no
 *   number. Training sales have
 *   their own series (TR1-000001) and stay out of reports, stock and cash.
 * - Returns are lines pointing at the line they return, bounded by what is
 *   left to return, and refund that line's share of what was paid. A sale,
 *   a refund and an exchange are the same document; the kind follows the
 *   lines.
 * - Each register's sales are chained: hash = sha256(previous hash + this
 *   sale), so a removed or altered sale shows.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

function calc() {
  return require(`${__hooks}/lib_calc.js`);
}

const REF_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/* --------------------------------------------------------------- input */

function intOf(v, name, min, max) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw u().fail(400, name + ' must be a whole number from ' + min + ' to ' + max);
  return n;
}

function readDiscount(d, where) {
  if (d === null || d === undefined || d === '') return null;
  if (typeof d !== 'object') throw u().fail(400, where + ' discount must be {"kind":"percent"|"amount","value":<n>}');
  const kind = d.kind === 'percent' ? 'percent' : d.kind === 'amount' ? 'amount' : '';
  if (kind === '') throw u().fail(400, where + ' discount kind must be percent or amount');
  const value = intOf(d.value, where + ' discount value', 1, kind === 'percent' ? 10000 : 1000000000);
  return { kind: kind, value: value, name: String(d.name || '').slice(0, 40) };
}

/** The cart lines as typed objects (what the counter sends and parked tickets store). */
/** One cart line as the counter sends it (i: its index, for messages). */
function readLine(l, i) {
  const util = u();
  const at = 'Line ' + (i + 1);
  if (!l || typeof l !== 'object') throw util.fail(400, at + ' must be an object');
  const out = {
    product: String(l.product || ''),
    variant: String(l.variant || ''),
    qty: intOf(l.qty, at + ' qty', 1, 9999),
    modifiers: Array.isArray(l.modifiers) ? l.modifiers.map(String) : [],
    price: l.price === null || l.price === undefined || l.price === '' ? null : intOf(l.price, at + ' price', 0, 1000000000),
    discount: readDiscount(l.discount, at),
    note: String(l.note || '').slice(0, 200),
    name: util.squash(String(l.name || '')).slice(0, 120),
    tax_class: String(l.tax_class || ''),
    return_of: String(l.return_of || ''),
    restock: l.restock !== false,
    blind: l.blind === true,
  };
  if (out.modifiers.length > 60) throw util.fail(400, at + ' has too many modifiers');
  return out;
}

function readLines(raw) {
  const util = u();
  if (!Array.isArray(raw)) throw util.fail(400, 'lines must be a list');
  if (raw.length > 300) throw util.fail(400, 'A sale can have at most 300 lines');
  return raw.map(readLine);
}

/* ------------------------------------------------------------- pricing */

/**
 * Turn typed cart lines into priced lines and the totals, reading the
 * catalog through `h` (the transaction handle at finalize). Returns
 * { lines: [...priced with snapshots], totals, needs: { action: [reasons] } }.
 */
function price(h, s, input) {
  const util = u();
  const lines = input.lines;
  const orderType = input.order_type;
  const taxes = {};
  for (const t of h.findRecordsByFilter('tax_classes', '', '', 0, 0)) {
    taxes[t.id] = { id: t.id, name: t.getString('name'), rate_bp: t.getInt('rate_bp'), dine_in_rate_bp: t.getInt('dine_in_rate_bp'), mark: t.getString('mark') };
  }
  const needs = {};
  const need = (action, why) => {
    if (needs[action] === undefined) needs[action] = [];
    if (needs[action].indexOf(why) < 0) needs[action].push(why);
  };
  const limit = s.cashier_discount_bp;
  const priced = [];
  const calcLines = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const at = 'Line ' + (i + 1);
    if (l.return_of !== '') {
      const origin = util.byId(h, 'sale_lines', l.return_of);
      if (origin === null) throw util.fail(404, at + ': the line it returns does not exist', 'not_found');
      if (origin.getInt('qty') <= 0) throw util.fail(400, at + ': a return cannot be returned');
      const originSale = h.findRecordById('sales', origin.getString('sale'));
      if (originSale.getBool('training') !== input.training) {
        throw util.fail(400, at + ': ' + (originSale.getBool('training') ? 'a training sale can only be returned in training mode' : 'a real sale cannot be returned in training mode'), 'training_mismatch');
      }
      const prev = util.rows(
        h,
        'SELECT IFNULL(SUM(-qty), 0) AS q, IFNULL(SUM(-gross), 0) AS g, IFNULL(SUM(-line_discount), 0) AS ld, IFNULL(SUM(-order_discount), 0) AS od, IFNULL(SUM(-net), 0) AS n, IFNULL(SUM(-tax), 0) AS t FROM sale_lines WHERE origin = {:o}',
        { q: 0, g: 0, ld: 0, od: 0, n: 0, t: 0 },
        { o: origin.id },
      )[0];
      const oq = origin.getInt('qty');
      const left = oq - prev.q;
      if (l.qty > left) {
        throw util.fail(409, at + ': only ' + left + ' of "' + origin.getString('name') + '" ' + (left === 1 ? 'is' : 'are') + ' left to return on ' + originSale.getString('number'), 'over_return');
      }
      const share = (field, prevAmt) => -calc().returnShare(origin.getInt(field), oq, l.qty, prev.q, prevAmt);
      const fixed = {
        gross: share('gross', prev.g),
        line_discount: share('line_discount', prev.ld),
        order_discount: share('order_discount', prev.od),
        net: share('net', prev.n),
        tax: share('tax', prev.t),
        rate_bp: origin.getInt('rate_bp'),
        tax_id: origin.getString('tax_class'),
        tax_name: origin.getString('tax_name'),
        mark: origin.getString('mark'),
      };
      need('refund', 'return items on ' + originSale.getString('number'));
      calcLines.push({ qty: -l.qty, fixed: fixed });
      priced.push({
        input: l,
        product: origin.getString('product'),
        variant: origin.getString('variant'),
        name: origin.getString('name'),
        variant_name: origin.getString('variant_name'),
        sku: origin.getString('sku'),
        category: origin.getString('category'),
        category_id: origin.getString('category_id'),
        qty: -l.qty,
        unit: origin.getInt('unit'),
        modifiers: util.jsonOf(origin, 'modifiers', []),
        cost: origin.getInt('cost'),
        kitchen: false,
        note: l.note,
        origin: origin.id,
        origin_sale: originSale.id,
        restock: l.restock,
        price_changed: false,
        discount_name: origin.getString('discount_name'),
        track: false,
      });
      continue;
    }

    // A custom amount (the keypad): a name, a price and a tax class.
    if (l.product === '') {
      if (l.price === null || l.price <= 0) throw util.fail(400, at + ': a custom amount needs a price above 0');
      const tax = l.tax_class !== '' ? taxes[l.tax_class] : null;
      if (l.tax_class !== '' && tax === undefined) throw util.fail(400, at + ': no tax class "' + l.tax_class + '"');
      const dflt = h.findRecordsByFilter('tax_classes', 'is_default = true && archived = false', '', 1, 0);
      const t = tax || (dflt.length > 0 ? taxes[dflt[0].id] : null);
      if (l.blind) throw util.fail(400, at + ': a return without a receipt needs a product');
      if (l.discount !== null) need('discount', 'discount a custom amount');
      calcLines.push({ qty: l.qty, unit: l.price, tax: t, discount: l.discount });
      priced.push({
        input: l,
        product: '',
        variant: '',
        name: l.name || 'Custom amount',
        variant_name: '',
        sku: '',
        category: '',
        category_id: '',
        qty: l.qty,
        unit: l.price,
        modifiers: [],
        cost: 0,
        kitchen: false,
        note: l.note,
        origin: '',
        restock: false,
        price_changed: false,
        discount_name: l.discount ? l.discount.name : '',
        track: false,
      });
      continue;
    }

    const pr = util.byId(h, 'products', l.product);
    if (pr === null || pr.getBool('archived') || pr.getString('status') !== 'active') throw util.fail(404, at + ': that product is no longer for sale', 'not_found');
    const name = pr.getString('name');
    if (!l.blind && !pr.getBool('available')) throw util.fail(409, at + ': ' + name + ' is sold out', 'unavailable');
    const vs = h.findRecordsByFilter('variants', 'product = {:p} && archived = false', 'sort', 0, 0, { p: pr.id });
    let variant = null;
    if (vs.length > 0) {
      variant = vs.filter((v) => v.id === l.variant)[0] || null;
      if (variant === null) throw util.fail(400, at + ': pick a variant of ' + name + ' (' + vs.map((v) => v.getString('name')).join(', ') + ')');
    } else if (l.variant !== '') throw util.fail(400, at + ': ' + name + ' has no variants');
    const base = variant !== null ? variant.getInt('price') : pr.getInt('price');
    let unitBase = base;
    let changed = false;
    if (pr.getBool('open_price')) {
      if (l.price === null) throw util.fail(400, at + ': ' + name + ' needs its price entered');
      unitBase = l.price;
    } else if (l.price !== null && l.price !== base) {
      unitBase = l.price;
      changed = true;
      need('price_override', 'change the price of ' + name);
    }
    // Modifiers: from the product's groups, available, within each group's rules.
    const groups = pr.getStringSlice('modifier_groups');
    const mods = [];
    const perGroup = {};
    for (const mid of l.modifiers) {
      const m = util.byId(h, 'modifiers', mid);
      if (m === null || groups.indexOf(m.getString('modifier_group')) < 0) throw util.fail(400, at + ': that option is not offered with ' + name, 'bad_modifier');
      if (!l.blind && !m.getBool('available')) throw util.fail(409, at + ': ' + m.getString('name') + ' is sold out', 'unavailable');
      perGroup[m.getString('modifier_group')] = (perGroup[m.getString('modifier_group')] || 0) + 1;
      mods.push({ id: m.id, name: m.getString('name'), price: m.getInt('price') });
    }
    if (!l.blind) {
      for (const gid of groups) {
        const g = util.byId(h, 'modifier_groups', gid);
        if (g === null) continue;
        const n = perGroup[gid] || 0;
        if (n < g.getInt('min')) throw util.fail(400, at + ': ' + name + ' needs ' + g.getInt('min') + ' ' + g.getString('name') + ' choice' + (g.getInt('min') === 1 ? '' : 's'), 'modifier_required');
        if (g.getInt('max') > 0 && n > g.getInt('max')) throw util.fail(400, at + ': at most ' + g.getInt('max') + ' ' + g.getString('name') + ' choice' + (g.getInt('max') === 1 ? '' : 's'), 'modifier_max');
      }
    }
    const unit = unitBase + mods.reduce((sum, m) => sum + m.price, 0);
    if (unit < 0) throw util.fail(400, at + ': the options take ' + name + ' below zero');
    const cat = pr.getString('category') !== '' ? util.byId(h, 'categories', pr.getString('category')) : null;
    const taxRef = pr.getString('tax_class');
    const tax = taxRef !== '' ? taxes[taxRef] || null : null;
    const cost = variant !== null && variant.getInt('cost') > 0 ? variant.getInt('cost') : pr.getInt('cost');
    if (l.blind) {
      // A return without a receipt: today's price, its own tax, no options.
      need('refund_blind', 'refund ' + name + ' without a receipt');
      const gross = -(unitBase * l.qty);
      const rate = calc().rateFor(tax, input.order_type);
      const taxAmt = rate === 0 ? 0 : -(s.price_mode === 'inclusive' ? calc().roundDiv(-gross * rate, 10000 + rate, s.tax_rounding) : calc().roundDiv(-gross * rate, 10000, s.tax_rounding));
      calcLines.push({ qty: -l.qty, fixed: { gross: gross, line_discount: 0, order_discount: 0, net: gross, tax: taxAmt, rate_bp: rate, tax_id: tax ? tax.id : '', tax_name: tax ? tax.name : '', mark: tax ? tax.mark : '' } });
      priced.push({
        input: l,
        product: pr.id,
        variant: variant ? variant.id : '',
        name: name,
        variant_name: variant ? variant.getString('name') : '',
        sku: variant && variant.getString('sku') !== '' ? variant.getString('sku') : pr.getString('sku'),
        category: cat ? cat.getString('name') : '',
        category_id: cat ? cat.id : '',
        qty: -l.qty,
        unit: unitBase,
        modifiers: [],
        cost: cost,
        kitchen: false,
        note: l.note,
        origin: '',
        restock: l.restock,
        price_changed: false,
        discount_name: '',
        track: pr.getBool('track_stock'),
      });
      continue;
    }
    if (l.discount !== null) {
      const gross = unit * l.qty;
      const over = l.discount.kind === 'percent' ? l.discount.value > limit : gross > 0 && l.discount.value * 10000 > limit * gross;
      if (over) need('discount_over', 'discount ' + name + ' by more than ' + u().bpText(limit) + '%');
    }
    calcLines.push({ qty: l.qty, unit: unit, tax: tax, discount: l.discount });
    priced.push({
      input: l,
      product: pr.id,
      variant: variant ? variant.id : '',
      name: name,
      variant_name: variant ? variant.getString('name') : '',
      sku: variant && variant.getString('sku') !== '' ? variant.getString('sku') : pr.getString('sku'),
      category: cat ? cat.getString('name') : '',
      category_id: cat ? cat.id : '',
      qty: l.qty,
      unit: unit,
      modifiers: mods.map((m) => ({ name: m.name, price: m.price })),
      cost: cost,
      kitchen: cat ? cat.getBool('kitchen') : false,
      note: l.note,
      origin: '',
      restock: false,
      price_changed: changed,
      discount_name: l.discount ? l.discount.name : '',
      track: pr.getBool('track_stock'),
    });
  }
  // The order discount, checked against the cashier limit on what it applies to.
  if (input.discount !== null) {
    const base = calcLines.filter((c) => c.qty > 0).reduce((sum, c) => sum + c.unit * c.qty - calc().discountOn(c.unit * c.qty, c.discount), 0);
    const over = input.discount.kind === 'percent' ? input.discount.value > limit : base > 0 && input.discount.value * 10000 > limit * base;
    if (over) need('discount_over', 'discount the order by more than ' + u().bpText(limit) + '%');
  }
  let serviceTax = null;
  if (s.service_charge_bp > 0 && s.service_charge_tax !== '') serviceTax = taxes[s.service_charge_tax] || null;
  const totals = calc().compute({
    price_mode: s.price_mode,
    tax_rounding: s.tax_rounding,
    order_type: orderType,
    service: s.service_charge_bp > 0 ? { bp: s.service_charge_bp, scope: s.service_charge_scope, tax: serviceTax } : null,
    discount: input.discount,
    lines: calcLines,
  });
  return { lines: priced, totals: totals, needs: needs };
}

/* ----------------------------------------------------------- finalize */

function bodyHash(input) {
  return u().sha(
    JSON.stringify({
      register: input.register,
      lines: input.lines,
      discount: input.discount,
      payments: input.payments,
      order_type: input.order_type,
      customer: input.customer,
      name: input.name,
      note: input.note,
    }),
  );
}

function readPayments(raw) {
  const util = u();
  if (!Array.isArray(raw)) throw util.fail(400, 'payments must be a list');
  if (raw.length > 20) throw util.fail(400, 'At most 20 payments on one sale');
  return raw.map((p, i) => {
    const at = 'Payment ' + (i + 1);
    if (!p || typeof p !== 'object') throw util.fail(400, at + ' must be an object');
    const amount = intOf(p.amount, at + ' amount', -1000000000, 1000000000);
    const tendered = p.tendered === undefined || p.tendered === null ? amount : intOf(p.tendered, at + ' tendered', -1000000000, 1000000000);
    return { tender: String(p.tender || ''), amount: amount, tendered: tendered, reference: String(p.reference || '').slice(0, 60) };
  });
}

/** The marker thrown inside a transaction when the sale already exists (a replay). */
function Replay(saleId) {
  this.replay = saleId;
}

function finalize(e, app, p) {
  const util = u();
  const auth = require(`${__hooks}/lib_auth.js`);
  const ctx = auth.gate(e, app, 'sell', p, null);
  const s = core().shop(app);
  if (!s.setup_done) throw util.fail(409, 'Set up the register first.', 'setup_required');
  const staff = ctx.staff;
  const training = staff.getBool('training');
  const reg = core().register(app, util.req(p, 'register', 'R1'));
  if (reg.getBool('archived')) throw util.fail(409, 'Register ' + reg.getString('code') + ' is archived', 'register_archived');
  const ref = util.req(p, 'ref', '"R1-k3j2h1g0-0001"');
  if (!REF_PATTERN.test(ref)) throw util.fail(400, 'ref is 8 to 64 letters, digits, - or _ (one per sale, reused on retries)');
  const input = {
    register: reg.id,
    lines: readLines(util.parsed(p, 'lines') || []),
    discount: readDiscount(util.parsed(p, 'discount'), 'Order'),
    payments: readPayments(util.parsed(p, 'payments') || []),
    order_type: util.str(p, 'order_type', ''),
    customer: util.str(p, 'customer', ''),
    name: util.squash(util.str(p, 'name', '')).slice(0, 40),
    note: util.str(p, 'note', '').slice(0, 300),
    training: training,
  };
  if (input.lines.length === 0) throw util.fail(400, 'The sale has no lines', 'empty');
  if (input.order_type !== '' && s.order_types.indexOf(input.order_type) < 0) throw util.fail(400, 'order_type must be one of: ' + (s.order_types.join(', ') || 'none (order types are off)'));
  if (input.order_type === '' && s.order_types.length > 0) input.order_type = s.default_order_type || s.order_types[0];
  const hash = bodyHash(input);
  const existing = util.findOne(app, 'sales', 'ref = {:r}', { r: ref });
  if (existing !== null) {
    if (existing.getString('body_hash') !== hash) throw util.fail(409, 'This sale was already recorded with different items. Start a new sale.', 'ref_conflict');
    return Object.assign(get(app, existing), { replayed: true });
  }
  const expected = util.has(p, 'expected_total') ? intOf(util.str(p, 'expected_total', ''), 'expected_total', -1000000000, 1000000000) : null;
  const approvalTokens = (util.list(p, 'approvals') || []).map(String);
  const cartRef = util.str(p, 'cart', '');
  const day = util.businessDay(s.day_cutoff_hour);

  let saleId = '';
  try {
    app.runInTransaction((tx) => {
      // The first write takes the lock, so two registers never get one number.
      const seq = core().bump(tx, (training ? 'training:' : 'receipt:') + reg.id).getInt('num');
      const dup = util.findOne(tx, 'sales', 'ref = {:r}', { r: ref });
      if (dup !== null) {
        if (dup.getString('body_hash') !== hash) throw util.fail(409, 'This sale was already recorded with different items. Start a new sale.', 'ref_conflict');
        throw new Replay(dup.id);
      }
      const register = reg;
      const shift = util.findOne(tx, 'shifts', 'register = {:r} && status = "open"', { r: reg.id });
      if (shift === null) throw util.fail(409, 'Open the register before selling.', 'shift_closed');
      let customer = null;
      if (input.customer !== '') {
        customer = util.byId(tx, 'customers', input.customer);
        if (customer === null || customer.getBool('archived')) throw util.fail(404, 'That customer is no longer on file', 'not_found');
      }

      const pricedOut = price(tx, s, input);
      const totals = pricedOut.totals;
      if (expected !== null && expected !== totals.total) {
        throw util.fail(409, 'The total changed to ' + util.moneyText(totals.total, s.exp, s.currency) + '. Check the sale and take payment again.', 'total_changed', { total: totals.total });
      }

      // Permissions the cart needs beyond selling: by role, or by a manager's approval.
      const role = staff.getString('role');
      const used = [];
      const missing = [];
      for (const action of Object.keys(pricedOut.needs)) {
        if (action === 'discount') continue;
        if (auth.can(role, action)) continue;
        let ap = null;
        for (const t of approvalTokens) {
          ap = auth.approvalFor(tx, t, action);
          if (ap !== null) break;
        }
        if (ap === null) missing.push(action);
        else used.push({ action: action, approval: ap, why: pricedOut.needs[action] });
      }
      if (missing.length > 0) throw util.fail(403, 'A manager needs to approve this sale.', 'approval_required', { action: missing[0], actions: missing });

      // Payments: the tenders, the cash rounding and the balance.
      const total = totals.total;
      const pays = [];
      let nonCash = 0;
      let hasCash = false;
      for (const py of input.payments) {
        const t = util.byId(tx, 'tenders', py.tender);
        if (t === null) throw util.fail(404, 'No payment method "' + py.tender + '"', 'not_found');
        if (!t.getBool('active')) throw util.fail(409, t.getString('name') + ' is turned off', 'tender_off');
        const kind = t.getString('kind');
        if (py.amount === 0) throw util.fail(400, 'A payment of 0 is not a payment');
        if (total >= 0 && py.amount < 0) throw util.fail(400, 'A sale is paid with positive amounts');
        if (total < 0 && py.amount > 0) throw util.fail(400, 'A refund is paid out with negative amounts');
        let tendered = py.amount;
        if (kind === 'cash') {
          hasCash = true;
          tendered = py.tendered;
          if (py.amount > 0 && tendered < py.amount) throw util.fail(400, 'Cash given (' + util.minorText(tendered, s.exp) + ') is less than the amount it pays');
          if (py.amount < 0 && tendered !== py.amount) throw util.fail(400, 'Cash paid out is exactly the refund');
        } else {
          nonCash += py.amount;
          if (py.tendered !== py.amount) throw util.fail(400, t.getString('name') + ' takes the exact amount (no change)');
        }
        pays.push({ rec: t, kind: kind, amount: py.amount, tendered: tendered, change: kind === 'cash' && py.amount > 0 ? tendered - py.amount : 0, reference: py.reference });
      }
      const rounding = hasCash ? calc().cashDue(total, nonCash, s.cash_rounding).rounding : 0;
      const paid = pays.reduce((sum, x) => sum + x.amount, 0);
      if (paid !== total + rounding) {
        throw util.fail(
          409,
          'The payments (' + util.moneyText(paid, s.exp, s.currency) + ') do not match what is due (' + util.moneyText(total + rounding, s.exp, s.currency) + ').',
          'balance_mismatch',
          { due: total + rounding },
        );
      }
      if (total >= 0 && Math.abs(nonCash) > Math.abs(total)) throw util.fail(400, 'Card and other payments cannot be more than the total');

      // Numbers: the receipt (gapless per register) and the order number (daily).
      const number = (training ? 'T' : '') + register.getString('code') + '-' + util.lpad(seq, 6, '0');
      const hasSaleLines = pricedOut.lines.some((l) => l.qty > 0);
      const hasReturns = pricedOut.lines.some((l) => l.qty < 0);
      const kind = hasReturns && hasSaleLines ? 'exchange' : hasReturns ? 'refund' : 'sale';
      let orderNo = 0;
      if (s.order_numbers && hasSaleLines) {
        let oc = core().counter(tx, 'order');
        if (oc === null) {
          oc = new Record(tx.findCollectionByNameOrId('counters'));
          oc.set('key', 'order');
          oc.set('num', 0);
          oc.set('text', '');
        }
        orderNo = oc.getString('text') === day ? (oc.getInt('num') % 9999) + 1 : 1;
        oc.set('text', day);
        oc.set('num', orderNo);
        tx.save(oc);
      }
      const now = util.nowIso();
      let prevHash = '';
      let saleHash = '';
      if (!training) {
        let hc = core().counter(tx, 'hash:' + reg.id);
        if (hc === null) {
          hc = new Record(tx.findCollectionByNameOrId('counters'));
          hc.set('key', 'hash:' + reg.id);
          hc.set('num', 0);
        }
        prevHash = hc.getString('text');
        saleHash = util.sha([prevHash, number, ref, day, total, totals.tax_total, rounding, now, staff.id].join('|'));
        hc.set('text', saleHash);
        hc.set('num', seq);
        tx.save(hc);
      }

      const sale = new Record(tx.findCollectionByNameOrId('sales'));
      sale.set('ref', ref);
      sale.set('body_hash', hash);
      sale.set('number', number);
      sale.set('seq', seq);
      sale.set('register', register.id);
      sale.set('shift', shift.id);
      sale.set('staff', staff.id);
      sale.set('customer', customer ? customer.id : '');
      sale.set('order_type', input.order_type);
      sale.set('order_no', orderNo);
      sale.set('name', input.name);
      sale.set('kind', kind);
      sale.set('training', training);
      sale.set('currency', s.currency);
      sale.set('price_mode', s.price_mode);
      sale.set('item_count', pricedOut.lines.reduce((sum, l) => sum + Math.abs(l.qty), 0));
      sale.set('subtotal', totals.subtotal);
      sale.set('discount_total', totals.discount_total);
      sale.set('service_charge', totals.service_charge);
      sale.set('tax_total', totals.tax_total);
      sale.set('taxes', totals.taxes);
      sale.set('rounding', rounding);
      sale.set('total', total);
      sale.set('paid', paid + pays.reduce((sum, x) => sum + x.change, 0));
      sale.set('change', pays.reduce((sum, x) => sum + x.change, 0));
      sale.set('business_day', day);
      sale.set('note', input.note);
      sale.set('header', headerSnapshot(tx, register, staff, customer));
      sale.set('approvals', used.map((x) => ({ action: x.action, approver: x.approval.getString('approver'), why: x.why })));
      sale.set('prev_hash', prevHash);
      sale.set('hash', saleHash);
      tx.save(sale);
      saleId = sale.id;

      const lcoll = tx.findCollectionByNameOrId('sale_lines');
      pricedOut.lines.forEach((l, i) => {
        const c = totals.lines[i];
        const rec = new Record(lcoll);
        rec.set('sale', sale.id);
        rec.set('line_no', i + 1);
        rec.set('product', l.product);
        rec.set('variant', l.variant);
        rec.set('name', l.name);
        rec.set('variant_name', l.variant_name);
        rec.set('sku', l.sku);
        rec.set('category', l.category);
        rec.set('category_id', l.category_id);
        rec.set('qty', l.qty);
        rec.set('unit', l.unit);
        rec.set('modifiers', l.modifiers);
        rec.set('gross', c.gross);
        rec.set('line_discount', c.line_discount);
        rec.set('order_discount', c.order_discount);
        rec.set('discount_name', l.discount_name || (input.discount && c.order_discount !== 0 ? input.discount.name : ''));
        rec.set('net', c.net);
        rec.set('tax_class', c.tax_id);
        rec.set('tax_name', c.tax_name);
        rec.set('rate_bp', c.rate_bp);
        rec.set('mark', c.mark);
        rec.set('tax', c.tax);
        rec.set('cost', l.cost);
        rec.set('kitchen', l.kitchen);
        rec.set('note', l.note);
        rec.set('origin', l.origin);
        rec.set('restock', l.restock);
        rec.set('price_changed', l.price_changed);
        tx.save(rec);
        // Stock follows the sale (not in training): sold out, or back in when restocked.
        if (!training && l.product !== '') {
          const pr = util.byId(tx, 'products', l.product);
          if (pr !== null && pr.getBool('track_stock') && (l.qty > 0 || l.restock)) {
            require(`${__hooks}/lib_stock.js`).post(tx, {
              product: l.product,
              variant: l.variant,
              qty: -l.qty,
              kind: l.qty > 0 ? 'sale' : 'refund',
              reason: number,
              sale: sale.id,
              staff: staff.id,
              actor: 'staff',
            });
          }
        }
      });

      const pcoll = tx.findCollectionByNameOrId('payments');
      for (const x of pays) {
        const rec = new Record(pcoll);
        rec.set('sale', sale.id);
        rec.set('tender', x.rec.id);
        rec.set('kind', x.kind);
        rec.set('name', x.rec.getString('name'));
        rec.set('amount', x.amount);
        rec.set('tendered', x.tendered);
        rec.set('change', x.change);
        rec.set('reference', x.reference);
        rec.set('register', register.id);
        rec.set('shift', shift.id);
        rec.set('staff', staff.id);
        rec.set('training', training);
        rec.set('business_day', day);
        tx.save(rec);
      }

      // The kitchen gets what it makes.
      if (s.kitchen_enabled && hasSaleLines) {
        const items = pricedOut.lines
          .filter((l) => l.qty > 0 && l.kitchen)
          .map((l) => ({ name: l.name, variant: l.variant_name, qty: l.qty, modifiers: l.modifiers.map((m) => m.name), note: l.note }));
        if (items.length > 0) {
          const t = new Record(tx.findCollectionByNameOrId('tickets'));
          t.set('sale', sale.id);
          t.set('register', register.id);
          t.set('order_no', orderNo);
          t.set('number', number);
          t.set('name', input.name !== '' ? input.name : customer ? customer.getString('name') : '');
          t.set('order_type', input.order_type);
          t.set('items', items);
          t.set('note', input.note);
          t.set('status', 'new');
          t.set('ready_at', '');
          t.set('done_at', '');
          t.set('training', training);
          tx.save(t);
        }
      }

      if (cartRef !== '') {
        const cart = util.findOne(tx, 'carts', 'ref = {:r}', { r: cartRef });
        if (cart !== null && (cart.getString('status') === 'parked' || cart.getString('status') === 'resumed')) {
          cart.set('status', 'done');
          cart.set('sale', sale.id);
          tx.save(cart);
        }
      }

      for (const x of used) auth.consume(tx, x.approval);
      const summary =
        (training ? 'Training ' : '') +
        (kind === 'sale' ? 'Sale ' : kind === 'refund' ? 'Refund ' : 'Exchange ') +
        number +
        ' ' +
        util.moneyText(total, s.exp, s.currency) +
        (pays.length > 0 ? ' (' + pays.map((x) => x.rec.getString('name')).join(', ') + ')' : '');
      core().audit(tx, { kind: kind, actor: 'staff', staff: staff.id, register: register.id, ref: number, summary: summary, data: { sale: sale.id } });
      for (const x of used) {
        core().audit(tx, {
          kind: 'override',
          actor: 'staff',
          staff: staff.id,
          approver: x.approval.getString('approver'),
          register: register.id,
          ref: number,
          summary: 'Approved on ' + number + ': ' + x.why.join('; '),
          data: { sale: sale.id, action: x.action },
        });
      }
    });
  } catch (err) {
    if (err instanceof Replay) return Object.assign(get(app, app.findRecordById('sales', err.replay)), { replayed: true });
    throw err;
  }
  return Object.assign(get(app, app.findRecordById('sales', saleId)), { replayed: false });
}

/** What a receipt prints at the top, as it was at the time of the sale. */
function headerSnapshot(h, register, staff, customer) {
  const st = core().settings(h);
  const logo = st.getString('logo');
  return {
    business_name: st.getString('business_name'),
    address: st.getString('address'),
    phone: st.getString('phone'),
    email: st.getString('email'),
    website: st.getString('website'),
    tax_reg_label: st.getString('tax_reg_label'),
    tax_reg_no: st.getString('tax_reg_no'),
    company_reg_no: st.getString('company_reg_no'),
    receipt_header: st.getString('receipt_header'),
    receipt_footer: st.getString('receipt_footer'),
    logo_url: logo !== '' ? '/api/files/settings/' + st.id + '/' + logo : '',
    register: register.getString('name'),
    register_code: register.getString('code'),
    staff: staff.getString('name'),
    customer: customer ? customer.getString('name') : '',
    customer_phone: customer ? customer.getString('phone') : '',
  };
}

/* ------------------------------------------------------------ previews */

/** The totals of a cart without saving anything (the AI agent's quote, a parked ticket's total). */
function preview(app, p) {
  const util = u();
  const s = core().shop(app);
  const input = {
    // Read like tickets.draft, so a quote matches the ticket it becomes.
    lines: require(`${__hooks}/lib_carts.js`).resolveLines(app, p),
    discount: readDiscount(util.parsed(p, 'discount'), 'Order'),
    order_type: util.str(p, 'order_type', s.default_order_type),
    training: false,
  };
  const out = price(app, s, input);
  return {
    currency: s.currency,
    lines: out.lines.map((l, i) => ({ name: l.name, variant: l.variant_name, qty: l.qty, unit: l.unit, net: out.totals.lines[i].net, tax: out.totals.lines[i].tax })),
    subtotal: out.totals.subtotal,
    discount_total: out.totals.discount_total,
    service_charge: out.totals.service_charge,
    tax_total: out.totals.tax_total,
    taxes: out.totals.taxes,
    total: out.totals.total,
    total_text: util.moneyText(out.totals.total, s.exp, s.currency),
    needs: Object.keys(out.needs),
  };
}

/* --------------------------------------------------------------- reads */

function serializeLine(rec) {
  return {
    id: rec.id,
    line_no: rec.getInt('line_no'),
    product: rec.getString('product'),
    variant: rec.getString('variant'),
    name: rec.getString('name'),
    variant_name: rec.getString('variant_name'),
    sku: rec.getString('sku'),
    category: rec.getString('category'),
    qty: rec.getInt('qty'),
    unit: rec.getInt('unit'),
    modifiers: u().jsonOf(rec, 'modifiers', []),
    gross: rec.getInt('gross'),
    line_discount: rec.getInt('line_discount'),
    order_discount: rec.getInt('order_discount'),
    discount_name: rec.getString('discount_name'),
    net: rec.getInt('net'),
    tax_class: rec.getString('tax_class'),
    tax_name: rec.getString('tax_name'),
    rate_bp: rec.getInt('rate_bp'),
    mark: rec.getString('mark'),
    tax: rec.getInt('tax'),
    note: rec.getString('note'),
    origin: rec.getString('origin'),
    restock: rec.getBool('restock'),
    price_changed: rec.getBool('price_changed'),
    kitchen: rec.getBool('kitchen'),
  };
}

/** A sale with its lines, payments, returns against it and the sale it returns from. */
function get(app, sale) {
  const util = u();
  const exp = core().exponent(sale.getString('currency'));
  const lines = app.findRecordsByFilter('sale_lines', 'sale = {:s}', 'line_no', 0, 0, { s: sale.id }).map(serializeLine);
  const payments = app.findRecordsByFilter('payments', 'sale = {:s}', 'created', 0, 0, { s: sale.id }).map((x) => ({
    id: x.id,
    tender: x.getString('tender'),
    kind: x.getString('kind'),
    name: x.getString('name'),
    amount: x.getInt('amount'),
    tendered: x.getInt('tendered'),
    change: x.getInt('change'),
    reference: x.getString('reference'),
  }));
  const lineIds = lines.filter((l) => l.qty > 0).map((l) => l.id);
  const returns = [];
  const returned = {};
  if (lineIds.length > 0) {
    const byOrigin = util.rows(
      app,
      'SELECT l.origin AS origin, -SUM(l.qty) AS q FROM sale_lines l WHERE l.origin IN (' + lineIds.map((id, i) => '{:o' + i + '}').join(',') + ') GROUP BY l.origin',
      { origin: '', q: 0 },
      lineIds.reduce((b, id, i) => {
        b['o' + i] = id;
        return b;
      }, {}),
    );
    for (const r of byOrigin) returned[r.origin] = r.q;
    const sales = util.rows(
      app,
      'SELECT DISTINCT s.id AS id, s.number AS number, s.kind AS kind, s.created AS created FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE l.origin IN (' + lineIds.map((id, i) => '{:o' + i + '}').join(',') + ') ORDER BY s.created',
      { id: '', number: '', kind: '', created: '' },
      lineIds.reduce((b, id, i) => {
        b['o' + i] = id;
        return b;
      }, {}),
    );
    for (const r of sales) returns.push(r);
  }
  const origins = [];
  for (const l of lines) {
    if (l.origin === '') continue;
    const o = util.byId(app, 'sale_lines', l.origin);
    if (o === null) continue;
    const os = util.byId(app, 'sales', o.getString('sale'));
    if (os !== null && origins.filter((x) => x.id === os.id).length === 0) origins.push({ id: os.id, number: os.getString('number') });
  }
  for (const l of lines) l.returned = returned[l.id] || 0;
  const staffRec = util.byId(app, 'staff', sale.getString('staff'));
  const ticket = util.findOne(app, 'tickets', 'sale = {:s}', { s: sale.id });
  return {
    id: sale.id,
    ref: sale.getString('ref'),
    number: sale.getString('number'),
    register: sale.getString('register'),
    shift: sale.getString('shift'),
    staff: sale.getString('staff'),
    staff_name: staffRec ? staffRec.getString('name') : '',
    customer: sale.getString('customer'),
    order_type: sale.getString('order_type'),
    order_no: sale.getInt('order_no'),
    name: sale.getString('name'),
    kind: sale.getString('kind'),
    training: sale.getBool('training'),
    currency: sale.getString('currency'),
    currency_decimals: exp,
    price_mode: sale.getString('price_mode'),
    item_count: sale.getInt('item_count'),
    subtotal: sale.getInt('subtotal'),
    discount_total: sale.getInt('discount_total'),
    service_charge: sale.getInt('service_charge'),
    tax_total: sale.getInt('tax_total'),
    taxes: util.jsonOf(sale, 'taxes', []),
    rounding: sale.getInt('rounding'),
    total: sale.getInt('total'),
    total_text: util.moneyText(sale.getInt('total'), exp, sale.getString('currency')),
    paid: sale.getInt('paid'),
    change: sale.getInt('change'),
    business_day: sale.getString('business_day'),
    note: sale.getString('note'),
    header: util.jsonOf(sale, 'header', {}),
    approvals: util.jsonOf(sale, 'approvals', []),
    hash: sale.getString('hash'),
    created: sale.getString('created'),
    lines: lines,
    payments: payments,
    returns: returns,
    returns_from: origins,
    ticket: ticket === null ? null : { id: ticket.id, status: ticket.getString('status') },
  };
}

/** What can still be returned from a sale, line by line, with the amounts already refunded. */
function refundable(app, sale) {
  const util = u();
  const detail = get(app, sale);
  const lines = [];
  for (const l of detail.lines) {
    if (l.qty <= 0) continue;
    const prev = util.rows(
      app,
      'SELECT IFNULL(SUM(-qty), 0) AS q, IFNULL(SUM(-gross), 0) AS g, IFNULL(SUM(-line_discount), 0) AS ld, IFNULL(SUM(-order_discount), 0) AS od, IFNULL(SUM(-net), 0) AS n, IFNULL(SUM(-tax), 0) AS t FROM sale_lines WHERE origin = {:o}',
      { q: 0, g: 0, ld: 0, od: 0, n: 0, t: 0 },
      { o: l.id },
    )[0];
    lines.push(
      Object.assign({}, l, {
        left: l.qty - prev.q,
        returned_amounts: { qty: prev.q, gross: prev.g, line_discount: prev.ld, order_discount: prev.od, net: prev.n, tax: prev.t },
      }),
    );
  }
  return { sale: { id: detail.id, number: detail.number, created: detail.created, training: detail.training, customer: detail.customer, order_type: detail.order_type, payments: detail.payments, total: detail.total, price_mode: detail.price_mode }, lines: lines };
}

function find(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'sale is required (its id, receipt number like R1-000123, or ref)');
  const hit = util.byId(app, 'sales', r) || util.findOne(app, 'sales', 'number = {:n} || ref = {:n}', { n: r.toUpperCase() }) || util.findOne(app, 'sales', 'ref = {:n}', { n: r });
  if (hit === null) throw util.fail(404, 'No sale "' + r + '". List them with sales.list.', 'not_found');
  return hit;
}

/** Sales for the list and the AI agent: newest first, filtered. */
function list(app, p) {
  const util = u();
  const from = util.day(p, 'from', '');
  const to = util.day(p, 'to', '');
  const kind = util.oneOf(p, 'kind', ['all', 'sale', 'refund', 'exchange'], 'all');
  const q = util.str(p, 'q', '');
  const limit = util.int(p, 'limit', 50, 1, 500);
  const offset = util.int(p, 'offset', 0, 0, 1000000);
  const training = util.bool(p, 'training', false);
  const where = ['s.training = {:tr}'];
  const bind = { tr: training };
  if (from !== '') {
    where.push('s.business_day >= {:from}');
    bind.from = from;
  }
  if (to !== '') {
    where.push('s.business_day <= {:to}');
    bind.to = to;
  }
  if (kind !== 'all') {
    where.push('s.kind = {:kind}');
    bind.kind = kind;
  }
  const reg = util.str(p, 'register', '');
  if (reg !== '') {
    where.push('s.register = {:reg}');
    bind.reg = core().register(app, reg).id;
  }
  const staff = util.str(p, 'staff', '');
  if (staff !== '') {
    where.push('s.staff = {:st}');
    bind.st = core().staff(app, staff).id;
  }
  const cust = util.str(p, 'customer', '');
  if (cust !== '') {
    where.push('s.customer = {:cu}');
    bind.cu = core().customer(app, cust).id;
  }
  const tender = util.oneOf(p, 'tender_kind', ['', 'cash', 'card', 'qr', 'other'], '');
  if (tender !== '') {
    where.push('EXISTS (SELECT 1 FROM payments py WHERE py.sale = s.id AND py.kind = {:tk})');
    bind.tk = tender;
  }
  if (q !== '') {
    where.push("(LOWER(s.number) LIKE {:q} OR LOWER(s.name) LIKE {:q} OR LOWER(IFNULL(c.name, '')) LIKE {:q} OR LOWER(IFNULL(c.phone, '')) LIKE {:q} OR CAST(s.order_no AS TEXT) = {:qn})");
    bind.q = '%' + q.toLowerCase() + '%';
    bind.qn = q.replace(/^#/, '');
  }
  const sql =
    'SELECT s.id AS id, s.number AS number, s.kind AS kind, s.total AS total, s.rounding AS rounding, s.item_count AS items, s.order_no AS order_no, s.order_type AS order_type, s.name AS name, s.business_day AS day, s.created AS created, s.currency AS currency, s.training AS training, ' +
    "IFNULL(st.name, '') AS staff_name, IFNULL(c.name, '') AS customer_name, " +
    "IFNULL((SELECT GROUP_CONCAT(DISTINCT py.name) FROM payments py WHERE py.sale = s.id), '') AS tenders " +
    'FROM sales s LEFT JOIN staff st ON st.id = s.staff LEFT JOIN customers c ON c.id = s.customer WHERE ' +
    where.join(' AND ');
  const count = util.scalarSql(app, 'SELECT COUNT(*) AS v FROM (' + sql + ')', bind);
  const rowsOut = util.rows(
    app,
    sql + ' ORDER BY s.created DESC LIMIT ' + limit + ' OFFSET ' + offset,
    { id: '', number: '', kind: '', total: 0, rounding: 0, items: 0, order_no: 0, order_type: '', name: '', day: '', created: '', currency: '', training: 0, staff_name: '', customer_name: '', tenders: '' },
    bind,
  );
  return {
    sales: rowsOut.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      total: r.total,
      collected: r.total + r.rounding,
      total_text: util.moneyText(r.total + r.rounding, core().exponent(r.currency), r.currency),
      items: r.items,
      order_no: r.order_no,
      order_type: r.order_type,
      name: r.name,
      business_day: r.day,
      created: r.created,
      staff_name: r.staff_name,
      customer_name: r.customer_name,
      tenders: r.tenders === '' ? [] : r.tenders.split(','),
      training: r.training !== 0,
    })),
    total: count,
    offset: offset,
  };
}

module.exports = {
  REF_PATTERN: REF_PATTERN,
  readLine: readLine,
  readLines: readLines,
  readDiscount: readDiscount,
  price: price,
  finalize: finalize,
  preview: preview,
  get: get,
  refundable: refundable,
  find: find,
  list: list,
};
