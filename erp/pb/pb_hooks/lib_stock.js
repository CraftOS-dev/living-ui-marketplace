/// <reference path="../pb_data/types.d.ts" />
/**
 * Stock: the only writer of stock moves, stock balances and valuation.
 *
 * - `stock_moves` is the ledger (signed quantity and value per item and
 *   warehouse); `stock` keeps the quantity per item and warehouse, written
 *   in the same transaction.
 * - Valuation is moving average per item across all warehouses, kept as
 *   running totals in `valuation` (quantity and value). Stock going out takes
 *   its exact share of the value; stock coming in adds its value. So the
 *   inventory account always equals the sum of item values.
 * - When an item's quantity reaches zero with value left over (a void after
 *   prices moved), the residue is returned so the caller writes it off
 *   against the stock adjustments account in the same journal.
 *
 * Every function that writes takes the transaction handle and uses only it.
 */

/*
 * Modules are looked up once per module instance: each require() resolves
 * the file again (milliseconds per call), and these helpers run in loops.
 */
const loaded = {};
function mod(name) {
  return loaded[name] || (loaded[name] = require(`${__hooks}/${name}.js`));
}
function u() {
  return mod('lib_util');
}

function m() {
  return mod('lib_money');
}

function valuationRow(tx, itemId) {
  const util = u();
  let v = util.findOne(tx, 'valuation', 'item = {:i}', { i: itemId });
  if (v === null) {
    v = util.newRecord(tx, 'valuation');
    v.set('item', itemId);
    v.set('qty', 0);
    v.set('value', 0);
    v.set('last_cost', 0);
  }
  return v;
}

function stockRow(tx, itemId, whId) {
  const util = u();
  let s = util.findOne(tx, 'stock', 'item = {:i} && warehouse = {:w}', { i: itemId, w: whId });
  if (s === null) {
    s = util.newRecord(tx, 'stock');
    s.set('item', itemId);
    s.set('warehouse', whId);
    s.set('qty', 0);
  }
  return s;
}

/** On hand of an item in one warehouse (or everywhere when whId is empty). */
function onHand(app, itemId, whId) {
  const util = u();
  if (whId) {
    const r = util.one(app, 'SELECT IFNULL(SUM(qty), 0) AS q FROM stock WHERE item = {:i} AND warehouse = {:w}', { q: -0 }, { i: itemId, w: whId });
    return util.q3(r.q);
  }
  const r = util.one(app, 'SELECT IFNULL(SUM(qty), 0) AS q FROM stock WHERE item = {:i}', { q: -0 }, { i: itemId });
  return util.q3(r.q);
}

/** The item's average unit cost (e4) now. */
function avgCost(app, itemId) {
  const util = u();
  const v = util.findOne(app, 'valuation', 'item = {:i}', { i: itemId });
  if (v === null) return 0;
  const q = v.getFloat('qty');
  const cur = mod('lib_core').currency(app);
  if (q > 0) return m().unitCostE4(v.getInt('value'), q, cur);
  return v.getInt('last_cost');
}

/**
 * The value a quantity going out would take now (positive minor units),
 * without writing. For previews.
 */
function outValue(app, itemId, qty) {
  const util = u();
  const cur = mod('lib_core').currency(app);
  const v = util.findOne(app, 'valuation', 'item = {:i}', { i: itemId });
  if (v === null) return 0;
  return takeValue(v.getFloat('qty'), v.getInt('value'), v.getInt('last_cost'), qty, cur);
}

/** The share of value `qty` units take from a pool of (poolQty, poolValue). */
function takeValue(poolQty, poolValue, lastCost, qty, cur) {
  const money = m();
  if (poolQty <= 0) return money.stockValue(qty, lastCost, cur);
  if (qty >= poolQty) {
    const rest = u().q3(qty - poolQty);
    return poolValue + (rest > 0 ? money.stockValue(rest, lastCost, cur) : 0);
  }
  return money.share(poolValue, qty, poolQty);
}

/**
 * Record one move.
 *   o: { item (record), warehouse (id), qty (signed), kind, date,
 *        unitCost (e4, for stock coming in), value (exact signed value; for
 *        reversals and transfers), source {entity, id, label, line}, batch,
 *        note, reverses, allowNegative }
 * Returns { move, value (signed minor), residual (minor written off) }.
 */
function move(tx, ctx, o) {
  const util = u();
  const money = m();
  const core = mod('lib_core');
  const item = o.item;
  if (item.getString('kind') !== 'stock') throw util.fail(400, item.getString('name') + ' is not a stock item, so it has no stock.', 'not_stock');
  const qty = util.q3(o.qty);
  if (qty === 0) return { move: null, value: 0, residual: 0 };
  if (!item.getBool('fractional') && !Number.isInteger(qty)) {
    throw util.fail(400, item.getString('name') + ' is counted in whole ' + (item.getString('unit') || 'units') + ', so the quantity must be a whole number (got ' + qty + ').', 'whole_units');
  }
  const cur = core.currency(tx);
  const s = stockRow(tx, item.id, o.warehouse);
  const before = s.getFloat('qty');
  const after = util.q3(before + qty);
  const allowNegative = o.allowNegative === true || core.settings(tx).getBool('allow_negative_stock');
  if (qty < 0 && after < 0 && !allowNegative) {
    const wh = util.byId(tx, 'warehouses', o.warehouse);
    throw util.fail(
      409,
      'Only ' + util.fmtQty(before) + ' ' + (item.getString('unit') || '') + ' of ' + item.getString('name') + ' in ' + (wh ? wh.getString('name') : 'the warehouse') + ' (needs ' + util.fmtQty(-qty) + ').',
      'insufficient_stock',
      { item: item.id, warehouse: o.warehouse, on_hand: before, needed: -qty },
    );
  }
  const v = valuationRow(tx, item.id);
  const vq = v.getFloat('qty');
  const vv = v.getInt('value');
  const last = v.getInt('last_cost');
  let value;
  if (o.value !== undefined && o.value !== null) {
    value = Math.round(o.value);
    if ((qty > 0 && value < 0) || (qty < 0 && value > 0)) throw util.fail(500, 'A stock move value has the wrong sign.', 'error');
  } else if (qty > 0) {
    const cost = o.unitCost !== undefined && o.unitCost !== null ? o.unitCost : vq > 0 ? money.unitCostE4(vv, vq, cur) : last;
    value = money.stockValue(qty, cost, cur);
  } else {
    value = -takeValue(vq, vv, last, -qty, cur);
  }
  let nq = util.q3(vq + qty);
  let nv = vv + value;
  let residual = 0;
  if (nq === 0 && nv !== 0) {
    residual = nv;
    nv = 0;
  }
  v.set('qty', nq);
  v.set('value', nv);
  if (qty > 0) v.set('last_cost', money.unitCostE4(value, qty, cur));
  tx.save(v);
  s.set('qty', after);
  tx.save(s);
  const src = o.source || {};
  const mv = util.newRecord(tx, 'stock_moves');
  mv.set('item', item.id);
  mv.set('warehouse', o.warehouse);
  mv.set('date', o.date);
  mv.set('qty', qty);
  mv.set('value', value);
  mv.set('unit_cost', money.unitCostE4(Math.abs(value), Math.abs(qty), cur));
  mv.set('kind', o.kind);
  mv.set('source_entity', src.entity || '');
  mv.set('source_id', src.id || '');
  mv.set('source_label', String(src.label || '').slice(0, 80));
  mv.set('source_line', src.line || '');
  mv.set('batch', o.batch || '');
  mv.set('balance', after);
  mv.set('actor', ctx.actor === 'agent' ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  mv.set('member', ctx.memberId || '');
  mv.set('reverses', o.reverses || '');
  mv.set('note', String(o.note || '').slice(0, 300));
  tx.save(mv);
  return { move: mv, value: value, residual: residual };
}

/** Link moves to the journal that carries their value. */
function linkJournal(tx, moves, journalId) {
  for (const mv of moves) {
    if (mv === null) continue;
    const r = tx.findRecordById('stock_moves', mv.id);
    r.set('journal', journalId);
    tx.save(r);
  }
}

/**
 * Reverse every move of a source (a document, a stock change, a build) with
 * its exact value, last first. Returns { moves, value (signed sum), residual }.
 */
function reverseSource(tx, ctx, entity, id, date, label) {
  const util = u();
  const rows = tx.findRecordsByFilter('stock_moves', "source_entity = {:e} && source_id = {:i} && reverses = ''", '-created', 0, 0, { e: entity, i: id });
  const done = {};
  for (const r of tx.findRecordsByFilter('stock_moves', "source_entity = {:e} && source_id = {:i} && reverses != ''", '', 0, 0, { e: entity, i: id })) done[r.getString('reverses')] = true;
  const out = { moves: [], value: 0, residual: 0, items: [] };
  const batch = util.token(15);
  for (const r of rows) {
    if (done[r.id]) continue;
    const item = tx.findRecordById('items', r.getString('item'));
    const res = move(tx, ctx, {
      item: item,
      warehouse: r.getString('warehouse'),
      qty: -r.getFloat('qty'),
      value: -r.getInt('value'),
      kind: r.getString('kind'),
      date: date,
      source: { entity: entity, id: id, label: label, line: r.getString('source_line') },
      batch: batch,
      reverses: r.id,
      note: 'Reverses ' + (r.getString('source_label') || ''),
      allowNegative: false,
    });
    out.moves.push(res.move);
    out.value += res.value;
    out.residual += res.residual;
    out.items.push({ item: item, value: res.value, residual: res.residual });
  }
  return out;
}

/** Journal lines writing off residual value (positive: value left on zero stock). */
function residualLines(app, residual, memo) {
  if (residual === 0) return [];
  const core = mod('lib_core');
  const inv = core.systemAccount(app, 'inventory').id;
  const adj = core.systemAccount(app, 'stock_adjustment').id;
  if (residual > 0) {
    return [
      { account: adj, debit: residual, credit: 0, memo: memo || 'Stock value left on zero quantity' },
      { account: inv, debit: 0, credit: residual, memo: memo || 'Stock value left on zero quantity' },
    ];
  }
  return [
    { account: inv, debit: -residual, credit: 0, memo: memo || 'Stock value left on zero quantity' },
    { account: adj, debit: 0, credit: -residual, memo: memo || 'Stock value left on zero quantity' },
  ];
}

module.exports = {
  onHand: onHand,
  avgCost: avgCost,
  outValue: outValue,
  takeValue: takeValue,
  move: move,
  linkJournal: linkJournal,
  reverseSource: reverseSource,
  residualLines: residualLines,
};
