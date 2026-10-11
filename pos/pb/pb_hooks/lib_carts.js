/// <reference path="../pb_data/types.d.ts" />
/**
 * Open tickets: carts saved to finish later (a table's tab, an order to
 * collect, a phone order your AI agent took). The cart being rung up lives
 * on the counter's screen; a ticket is saved here when it is parked, opened
 * again on any register, and closed by the sale that pays it (or voided).
 *
 * Status: parked (waiting), resumed (open on a register), done (paid),
 * void (cancelled, with a reason).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

function sales() {
  return require(`${__hooks}/lib_sales.js`);
}

/** Labels to show a ticket's lines without the catalog (names at the time it was saved). */
function labelLines(app, lines) {
  const util = u();
  return lines.map((l) => {
    let label = l.name || '';
    if (l.return_of !== '') {
      const o = util.byId(app, 'sale_lines', l.return_of);
      label = (o ? o.getString('name') : 'Returned item') + ' (return)';
    } else if (l.product !== '') {
      const pr = util.byId(app, 'products', l.product);
      const v = l.variant !== '' ? util.byId(app, 'variants', l.variant) : null;
      label = (pr ? pr.getString('name') : 'Removed product') + (v ? ' ' + v.getString('name') : '');
    } else if (label === '') label = 'Custom amount';
    return Object.assign({}, l, { label: label });
  });
}

function serialize(app, rec) {
  const util = u();
  const s = core().shop(app);
  const staff = rec.getString('staff') !== '' ? util.byId(app, 'staff', rec.getString('staff')) : null;
  const cust = rec.getString('customer') !== '' ? util.byId(app, 'customers', rec.getString('customer')) : null;
  const reg = rec.getString('register') !== '' ? util.byId(app, 'registers', rec.getString('register')) : null;
  return {
    id: rec.id,
    ref: rec.getString('ref'),
    status: rec.getString('status'),
    source: rec.getString('source'),
    name: rec.getString('name'),
    order_type: rec.getString('order_type'),
    customer: rec.getString('customer'),
    customer_name: cust ? cust.getString('name') : '',
    staff: rec.getString('staff'),
    staff_name: staff ? staff.getString('name') : '',
    register: rec.getString('register'),
    register_code: reg ? reg.getString('code') : '',
    lines: util.jsonOf(rec, 'lines', []),
    discount: util.jsonOf(rec, 'discount', null),
    note: rec.getString('note'),
    total: rec.getInt('total'),
    total_text: util.moneyText(rec.getInt('total'), s.exp, s.currency),
    items: rec.getInt('items'),
    sale: rec.getString('sale'),
    void_reason: rec.getString('void_reason'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function list(app, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['open', 'done', 'void', 'all'], 'open');
  const filter = status === 'open' ? "status = 'parked' || status = 'resumed'" : status === 'all' ? '' : 'status = {:s}';
  const recs = app.findRecordsByFilter('carts', filter, '-updated', util.int(p, 'limit', 100, 1, 500), 0, { s: status });
  return { tickets: recs.map((r) => serialize(app, r)), open: util.scalarSql(app, "SELECT COUNT(id) AS v FROM carts WHERE status IN ('parked', 'resumed')") };
}

function mustGet(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.byId(app, 'carts', r) || util.findOne(app, 'carts', 'ref = {:r}', { r: r });
  if (rec === null) throw util.fail(404, 'No ticket "' + r + '". List them with tickets.list.', 'not_found');
  return rec;
}

/** The total of a cart for the ticket list (0 when it no longer prices, e.g. an item sold out since). */
function totalOf(app, lines, discount, orderType) {
  try {
    const s = core().shop(app);
    const priced = sales().price(app, s, { lines: lines, discount: discount, order_type: orderType, training: false });
    return priced.totals.total;
  } catch {
    return 0;
  }
}

/** Save the counter's cart as a ticket (or update the ticket it came from). */
function park(e, app, p, ctx) {
  const util = u();
  const ref = util.req(p, 'ref', '"T-k3j2h1g0-0001"');
  if (!sales().REF_PATTERN.test(ref)) throw util.fail(400, 'ref is 8 to 64 letters, digits, - or _');
  const lines = sales().readLines(util.parsed(p, 'lines') || []);
  if (lines.length === 0) throw util.fail(400, 'An empty cart is not saved as a ticket', 'empty');
  const discount = sales().readDiscount(util.parsed(p, 'discount'), 'Order');
  const s = core().shop(app);
  const orderType = util.str(p, 'order_type', '');
  if (orderType !== '' && s.order_types.indexOf(orderType) < 0) throw util.fail(400, 'order_type must be one of: ' + (s.order_types.join(', ') || 'none'));
  const customer = util.str(p, 'customer', '');
  if (customer !== '' && util.byId(app, 'customers', customer) === null) throw util.fail(404, 'No customer "' + customer + '"', 'not_found');
  const register = util.str(p, 'register', '');
  const reg = register !== '' ? core().register(app, register) : null;
  let rec = util.findOne(app, 'carts', 'ref = {:r}', { r: ref });
  if (rec !== null && (rec.getString('status') === 'done' || rec.getString('status') === 'void')) {
    throw util.fail(409, 'That ticket was already ' + (rec.getString('status') === 'done' ? 'paid' : 'voided') + '. Start a new one.', 'ticket_closed');
  }
  const isNew = rec === null;
  if (isNew) {
    rec = new Record(app.findCollectionByNameOrId('carts'));
    rec.set('ref', ref);
    rec.set('source', 'counter');
  }
  rec.set('status', 'parked');
  rec.set('register', reg ? reg.id : '');
  rec.set('staff', ctx.staff ? ctx.staff.id : '');
  rec.set('name', util.squash(util.str(p, 'name', '')).slice(0, 40));
  rec.set('order_type', orderType);
  rec.set('customer', customer);
  rec.set('lines', labelLines(app, lines));
  rec.set('discount', discount);
  rec.set('note', util.str(p, 'note', '').slice(0, 300));
  rec.set('total', totalOf(app, lines, discount, orderType));
  rec.set('items', lines.reduce((sum, l) => sum + l.qty, 0));
  app.save(rec);
  return serialize(app, rec);
}

/** Open a ticket on a register (it shows as in use on the others). */
function resume(app, rec, registerRef, ctx) {
  const util = u();
  const st = rec.getString('status');
  if (st !== 'parked' && st !== 'resumed') throw util.fail(409, 'That ticket was already ' + (st === 'done' ? 'paid' : 'voided') + '.', 'ticket_closed');
  const reg = registerRef !== '' ? core().register(app, registerRef) : null;
  rec.set('status', 'resumed');
  rec.set('register', reg ? reg.id : rec.getString('register'));
  if (ctx.staff) rec.set('staff', ctx.staff.id);
  app.save(rec);
  return serialize(app, rec);
}

/** Put a ticket back to waiting without changes (the cashier backed out of it). */
function release(app, rec) {
  if (rec.getString('status') === 'resumed') {
    rec.set('status', 'parked');
    app.save(rec);
  }
  return serialize(app, rec);
}

function voidTicket(app, rec, reason, ctx) {
  const util = u();
  const st = rec.getString('status');
  if (st !== 'parked' && st !== 'resumed') throw util.fail(409, 'That ticket was already ' + (st === 'done' ? 'paid' : 'voided') + '.', 'ticket_closed');
  const why = util.squash(reason);
  if (why === '') throw util.fail(400, 'reason is required (why the ticket is voided)');
  app.runInTransaction((tx) => {
    const fresh = tx.findRecordById('carts', rec.id);
    fresh.set('status', 'void');
    fresh.set('void_reason', why.slice(0, 200));
    fresh.set('voided_by', ctx.staff ? ctx.staff.id : '');
    tx.save(fresh);
    if (ctx.approval) require(`${__hooks}/lib_auth.js`).consume(tx, ctx.approval);
    core().audit(tx, {
      kind: 'ticket_void',
      actor: 'staff',
      staff: ctx.staff ? ctx.staff.id : '',
      approver: ctx.approval ? ctx.approval.getString('approver') : '',
      register: fresh.getString('register'),
      ref: fresh.getString('name') || fresh.getString('ref'),
      summary: 'Voided ticket ' + (fresh.getString('name') || fresh.getString('ref')) + ' (' + util.moneyText(fresh.getInt('total'), core().shop(tx).exp, '') + '): ' + why,
    });
  });
  return serialize(app, app.findRecordById('carts', rec.id));
}

/**
 * An order your AI agent took (a phone or chat order): products by id, SKU,
 * barcode or exact name, a variant and options by name. It waits as a
 * ticket for staff to check, take payment and send to the kitchen.
 */
/**
 * Lines as your AI agent writes them, resolved for pricing: a product by id,
 * SKU, barcode or exact name; its size and options by id or name; a group
 * with no option named gets its default options (as at the counter).
 */
function resolveLines(app, p) {
  const util = u();
  const raw = util.list(p, 'lines');
  if (raw === undefined || raw.length === 0) throw util.fail(400, 'lines is required, e.g. [{"product":"Latte","variant":"Large","qty":2,"modifiers":["Oat milk"]}]');
  if (raw.length > 200) throw util.fail(400, 'At most 200 lines');
  return raw.map((l, i) => {
    const at = 'Line ' + (i + 1) + ': ';
    if (!l || typeof l !== 'object') throw util.fail(400, at + 'must be an object');
    // A return line (the id of a sold line) is read as the counter sends it.
    if (l.return_of) return sales().readLine(l, i);
    const pr = core().product(app, String(l.product || ''));
    if (pr.getBool('archived') || pr.getString('status') !== 'active') throw util.fail(400, at + pr.getString('name') + ' is not for sale');
    const vs = app.findRecordsByFilter('variants', 'product = {:p} && archived = false', 'sort', 0, 0, { p: pr.id });
    let variant = '';
    if (vs.length > 0) {
      const want = String(l.variant || '').trim().toLowerCase();
      const hit = vs.filter((v) => v.id === l.variant || v.getString('name').toLowerCase() === want)[0];
      if (!hit) throw util.fail(400, at + pr.getString('name') + ' comes as: ' + vs.map((v) => v.getString('name')).join(', ') + '. Give variant.');
      variant = hit.id;
    }
    const groups = pr.getStringSlice('modifier_groups');
    const mods = [];
    for (const m of Array.isArray(l.modifiers) ? l.modifiers : []) {
      const want = String(m).trim().toLowerCase();
      const opts = groups.length === 0 ? [] : app.findRecordsByFilter('modifiers', groups.map((g, k) => 'modifier_group = {:g' + k + '}').join(' || '), 'sort', 0, 0, groups.reduce((b, g, k) => {
        b['g' + k] = g;
        return b;
      }, {}));
      const hit = opts.filter((o) => o.id === m || o.getString('name').toLowerCase() === want)[0];
      if (!hit) throw util.fail(400, at + '"' + m + '" is not an option of ' + pr.getString('name') + (opts.length > 0 ? ' (options: ' + opts.map((o) => o.getString('name')).join(', ') + ')' : ' (it has no options)'));
      mods.push(hit.id);
    }
    // Default options apply when the agent names none in a group.
    for (const g of groups) {
      const inGroup = app.findRecordsByFilter('modifiers', 'modifier_group = {:g}', 'sort', 0, 0, { g: g });
      const picked = inGroup.filter((o) => mods.indexOf(o.id) >= 0);
      if (picked.length === 0) for (const o of inGroup) if (o.getBool('is_default') && o.getBool('available')) mods.push(o.id);
    }
    const qty = Number(l.qty === undefined ? 1 : l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw util.fail(400, at + 'qty must be a whole number from 1 to 999');
    return { product: pr.id, variant: variant, qty: qty, modifiers: mods, price: null, discount: null, note: String(l.note || '').slice(0, 200), name: '', tax_class: '', return_of: '', restock: true, blind: false };
  });
}

function draft(app, p) {
  const util = u();
  const lines = resolveLines(app, p);
  const name = util.squash(util.req(p, 'name', '"Phone order: Sam"')).slice(0, 40);
  const s = core().shop(app);
  const orderType = util.oneOf(p, 'order_type', s.order_types, s.default_order_type || '');
  const customerRef = util.str(p, 'customer', '');
  const customer = customerRef !== '' ? core().customer(app, customerRef) : null;
  // The cart must price (options within each group's rules) before staff see it.
  const priced = sales().price(app, s, { lines: lines, discount: null, order_type: orderType, training: false });
  const rec = new Record(app.findCollectionByNameOrId('carts'));
  rec.set('ref', 'A-' + util.token(20));
  rec.set('source', 'agent');
  rec.set('status', 'parked');
  rec.set('register', '');
  rec.set('staff', '');
  rec.set('name', name);
  rec.set('order_type', orderType);
  rec.set('customer', customer ? customer.id : '');
  rec.set('lines', labelLines(app, lines));
  rec.set('discount', null);
  rec.set('note', util.str(p, 'note', '').slice(0, 300));
  rec.set('total', priced.totals.total);
  rec.set('items', lines.reduce((sum, l) => sum + l.qty, 0));
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'ticket_draft', actor: 'agent', ref: name, summary: 'Your AI agent saved ticket "' + name + '" (' + util.moneyText(priced.totals.total, s.exp, s.currency) + ')' });
  });
  return serialize(app, rec);
}

module.exports = { serialize: serialize, list: list, mustGet: mustGet, park: park, resume: resume, release: release, voidTicket: voidTicket, resolveLines: resolveLines, draft: draft };
