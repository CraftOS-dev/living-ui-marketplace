/// <reference path="../pb_data/types.d.ts" />
/**
 * Stock: an append-only ledger per variant (sales, returns, receiving,
 * adjustments, counts, damage, loss, opening stock) with the balance kept on
 * the variant in the same transaction. Receiving at a cost updates the
 * moving average cost; nothing else changes the cost.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

const REASONS = ['sale', 'return', 'receive', 'adjust', 'count', 'damage', 'loss', 'opening'];

function q3(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * Move stock of a variant by `delta` (inside a transaction). Opts: name
 * (for the history), order, batch, note, unitCost (receiving: updates the
 * average cost), approver.
 */
function move(tx, c, variant, delta, reason, opts) {
  const o = opts || {};
  const v = tx.findRecordById('variants', variant.id);
  const before = v.getFloat('stock');
  const after = q3(before + delta);
  if (reason === 'receive' && o.unitCost !== undefined && o.unitCost !== null && delta > 0) {
    // Moving average: what was on hand at its cost, plus what came in at its cost.
    const onHand = Math.max(before, 0);
    const avg = onHand + delta > 0 ? (onHand * v.getFloat('cost') + delta * o.unitCost) / (onHand + delta) : o.unitCost;
    v.set('cost', Math.round(avg * 100) / 100);
  }
  v.set('stock', after);
  tx.save(v);
  const m = new Record(tx.findCollectionByNameOrId('stock_moves'));
  m.set('variant', v.id);
  m.set('product', v.getString('product'));
  m.set('name', String(o.name || '').slice(0, 300));
  m.set('reason', reason);
  m.set('delta', q3(delta));
  m.set('after', after);
  m.set('unit_cost', o.unitCost !== undefined && o.unitCost !== null ? o.unitCost : v.getFloat('cost'));
  if (o.order) m.set('order', o.order);
  if (o.batch) m.set('batch', o.batch);
  m.set('note', String(o.note || '').slice(0, 400));
  if (c && c.staffId) m.set('staff', c.staffId);
  m.set('actor', c ? c.actor : 'system');
  tx.save(m);
  return { before: before, after: after, move: m };
}

function label(prod, v) {
  return prod.getString('name') + (v.getString('title') ? ' (' + v.getString('title') + ')' : '');
}

/**
 * Receive, adjust, count or write off stock for several variants at once.
 * lines: [{variant (id or code), qty}] where qty is the change, or the
 * counted amount for reason=count; receive takes an optional cost each.
 */
function change(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_stock', p, { what: 'Changing stock' });
  const money = require(`${__hooks}/lib_money.js`).of(c.settings);
  const reason = util.oneOf(p, 'reason', ['receive', 'adjust', 'count', 'damage', 'loss'], '');
  if (reason === '') throw util.fail(400, 'reason is required: receive, adjust, count, damage or loss');
  const lines = util.list(p, 'lines', '[{"variant": "LAT-L", "qty": 12, "cost": "1.10"}]');
  if (!lines || lines.length === 0) throw util.fail(400, 'lines needs at least one line');
  if (lines.length > 500) throw util.fail(400, 'At most 500 lines at once');
  const note = util.str(p, 'note', '').slice(0, 400);
  const batch = util.newId();
  const out = [];
  app.runInTransaction((tx) => {
    const seen = {};
    lines.forEach((row, i) => {
      const where = 'lines[' + i + ']';
      if (row === null || typeof row !== 'object') throw util.fail(400, where + ' must be an object');
      const ref = String(row.variant || '').trim();
      if (ref === '') throw util.fail(400, where + '.variant is required (a variant id, SKU or barcode)');
      let v = util.byId(tx, 'variants', ref);
      if (v === null) v = require(`${__hooks}/lib_catalog.js`).findCode(tx, ref);
      if (v === null) throw util.fail(404, where + ': no variant "' + ref + '"');
      if (seen[v.id]) throw util.fail(400, where + ': the same variant is listed twice');
      seen[v.id] = true;
      const prod = tx.findRecordById('products', v.getString('product'));
      const qty = Number(row.qty);
      if (!isFinite(qty)) throw util.fail(400, where + '.qty must be a number');
      if (Math.round(qty * 1000) !== qty * 1000) throw util.fail(400, where + '.qty can have at most 3 decimals');
      let delta = qty;
      if (reason === 'count') {
        if (qty < 0) throw util.fail(400, where + ': a count cannot be negative');
        delta = q3(qty - v.getFloat('stock'));
      } else if (reason === 'receive') {
        if (qty <= 0) throw util.fail(400, where + ': receive a positive quantity');
      } else if (reason === 'damage' || reason === 'loss') {
        if (qty <= 0) throw util.fail(400, where + ': give the quantity damaged or lost as a positive number');
        delta = -qty;
      } else if (qty === 0) throw util.fail(400, where + '.qty cannot be 0');
      let unitCost = null;
      if (reason === 'receive' && row.cost !== undefined && row.cost !== null && row.cost !== '') {
        unitCost = money.toMinor(row.cost, where + '.cost');
        if (unitCost < 0) throw util.fail(400, where + '.cost cannot be negative');
      }
      if (!v.getBool('track_stock')) {
        v.set('track_stock', true);
        tx.save(v);
      }
      if (delta === 0) {
        out.push({ variant: v.id, name: label(prod, v), before: v.getFloat('stock'), after: v.getFloat('stock'), delta: 0 });
        return;
      }
      const r = move(tx, c, v, delta, reason, { name: label(prod, v), unitCost: unitCost, batch: batch, note: String(row.note || note).slice(0, 400) });
      out.push({ variant: v.id, name: label(prod, v), before: r.before, after: r.after, delta: q3(delta) });
    });
    require(`${__hooks}/lib_audit.js`).log(tx, 'stock', c, {
      approver: approver,
      detail: { receive: 'Received', adjust: 'Adjusted', count: 'Counted', damage: 'Wrote off damaged', loss: 'Wrote off lost' }[reason] + ' ' + util.plural(out.length, 'item') + (note ? ': ' + note : ''),
      data: { batch: batch, lines: out },
    });
  });
  return { reason: reason, batch: batch, lines: out };
}

/** Stock levels of tracked variants, with value at cost. */
function levels(app, p) {
  const util = u();
  const C = require(`${__hooks}/lib_catalog.js`);
  const L = C.lookups(app);
  const status = util.oneOf(p, 'status', ['low', 'out', 'all'], 'all');
  const q = util.str(p, 'q', '').toLowerCase();
  const prods = {};
  for (const r of app.findRecordsByFilter('products', 'archived = false', '', 0, 0)) prods[r.id] = r;
  const rows = [];
  let value = 0;
  let units = 0;
  for (const v of app.findRecordsByFilter('variants', 'track_stock = true && archived = false', '', 0, 0)) {
    const prod = prods[v.getString('product')];
    if (!prod) continue;
    const st = C.stockStatus(v, L.s);
    const qty = v.getFloat('stock');
    if (qty > 0) {
      value += qty * v.getFloat('cost');
      units += qty;
    }
    if (status === 'low' && st !== 'low' && st !== 'out') continue;
    if (status === 'out' && st !== 'out') continue;
    const name = label(prod, v);
    if (q !== '' && name.toLowerCase().indexOf(q) < 0 && v.getString('sku').toLowerCase().indexOf(q) < 0 && v.getString('barcode') !== q) continue;
    rows.push({
      variant: v.id,
      product: prod.id,
      name: name,
      category: prod.getString('category') === '' ? null : L.cats[prod.getString('category')] || null,
      sku: v.getString('sku'),
      barcode: v.getString('barcode'),
      stock: qty,
      low_at: v.getFloat('low_at') > 0 ? v.getFloat('low_at') : L.s.getFloat('low_stock_default'),
      cost: v.getFloat('cost'),
      price: v.getInt('price'),
      value: Math.round(Math.max(qty, 0) * v.getFloat('cost')),
      status: st,
      unit: prod.getString('unit'),
    });
  }
  const rank = { out: 0, low: 1, in: 2 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  return {
    levels: rows,
    value: Math.round(value),
    value_text: L.money.text(Math.round(value)),
    units: q3(units),
    low: rows.filter((r) => r.status === 'low').length,
    out: rows.filter((r) => r.status === 'out').length,
  };
}

/** The stock history: one variant, a batch, or everything in a date range. */
function moves(app, p) {
  const util = u();
  const filters = [];
  const bind = {};
  const variant = util.str(p, 'variant', '');
  if (variant !== '') {
    let v = util.byId(app, 'variants', variant);
    if (v === null) v = require(`${__hooks}/lib_catalog.js`).findCode(app, variant);
    if (v === null) throw util.fail(404, 'No variant "' + variant + '"');
    filters.push('variant = {:v}');
    bind.v = v.id;
  }
  const product = util.str(p, 'product', '');
  if (product !== '') {
    filters.push('product = {:p}');
    bind.p = product;
  }
  const reason = util.oneOf(p, 'reason', REASONS, '');
  if (reason !== '') {
    filters.push('reason = {:r}');
    bind.r = reason;
  }
  if (util.str(p, 'from', '') !== '' || util.str(p, 'to', '') !== '') {
    const r = util.range(p, 1);
    filters.push('created >= {:a} && created < {:b}');
    bind.a = util.dbDate(r.start);
    bind.b = util.dbDate(r.end);
  }
  const limit = util.int(p, 'limit', 50, 1, 1000);
  const page = util.int(p, 'page', 1, 1, 100000);
  const rows = app.findRecordsByFilter('stock_moves', filters.join(' && '), '-created', limit + 1, (page - 1) * limit, bind);
  const names = require(`${__hooks}/lib_audit.js`).staffNames(app);
  return {
    moves: rows.slice(0, limit).map((m) => ({
      id: m.id,
      variant: m.getString('variant'),
      product: m.getString('product'),
      name: m.getString('name'),
      reason: m.getString('reason'),
      delta: m.getFloat('delta'),
      after: m.getFloat('after'),
      unit_cost: m.getFloat('unit_cost'),
      order: m.getString('order'),
      note: m.getString('note'),
      by: m.getString('actor') === 'agent' ? 'Your AI agent' : names[m.getString('staff')] || '',
      created: m.getString('created'),
    })),
    more: rows.length > limit,
  };
}

module.exports = { REASONS: REASONS, move: move, change: change, levels: levels, moves: moves, label: label };
