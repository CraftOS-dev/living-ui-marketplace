/// <reference path="../pb_data/types.d.ts" />
/**
 * The stock ledger. Every change to a quantity is a movement row; the
 * `stock` row for (item, location) holds the running balance and is written
 * in the same transaction as its movement, so the two can never disagree.
 * Nothing else writes `stock` or `movements` (hooks.pb.js refuses direct API
 * writes), so this file is the only place quantities change.
 *
 * One action (a receipt, a move, a scanned batch) shares one `batch` id.
 * Undo posts the opposite batch and keeps both in the history; deleting a
 * batch removes its rows (and its undo, if it has one) and takes the stock
 * back as if it had never been recorded. Order receipts and stock counts are
 * re-derived from the ledger afterwards, so they always match it.
 *
 * Average cost: a receipt with a unit cost moves the item's cost to the
 * moving average of what is on hand and what arrived.
 *
 * Every function that writes takes the transaction handle and only uses it.
 */

const KINDS = ['in', 'out', 'move', 'adjust', 'count'];

/** Reasons allowed for each kind of change (undo may reverse any of them). */
const REASONS = {
  in: ['received', 'returned', 'found', 'produced', 'opening'],
  out: ['sold', 'used', 'damaged', 'lost', 'expired', 'sample', 'returned'],
  adjust: ['correction', 'found', 'damaged', 'lost', 'expired'],
  count: ['count'],
  move: ['move'],
};

const REASON_LABELS = {
  received: 'Received',
  returned: 'Returned',
  found: 'Found',
  produced: 'Made',
  sold: 'Sold',
  used: 'Used',
  damaged: 'Damaged',
  lost: 'Lost or stolen',
  expired: 'Expired',
  sample: 'Sample or gift',
  correction: 'Correction',
  move: 'Moved',
  count: 'Stock count',
  opening: 'Opening stock',
  undo: 'Undo',
};

function checkReason(kind, reason) {
  const u = require(`${__hooks}/lib_util.js`);
  if (KINDS.indexOf(kind) < 0) throw u.fail(400, 'kind must be one of: ' + KINDS.join(', '));
  const ok = REASONS[kind];
  if (ok.indexOf(reason) < 0) throw u.fail(400, 'reason for ' + kind + ' must be one of: ' + ok.join(', ') + ' (got "' + reason + '")');
}

/** On-hand total of one item over every location. */
function itemTotal(tx, itemId) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.rows(tx, 'SELECT IFNULL(SUM(qty), 0) AS t FROM stock WHERE item = {:i}', { t: -0 }, { i: itemId });
  return r.length > 0 ? u.q3(r[0].t) : 0;
}

/** Balance of one item at one location. */
function balance(tx, itemId, locationId) {
  const u = require(`${__hooks}/lib_util.js`);
  const st = u.findOne(tx, 'stock', 'item = {:i} && location = {:l}', { i: itemId, l: locationId });
  return st === null ? 0 : u.q3(st.getFloat('qty'));
}

function idOf(x) {
  return typeof x === 'string' ? x : x.id;
}

/** The average cost after qty (signed) at `cost` joins or leaves `onHand` at `avg`. */
function blendCost(avg, onHand, qty, cost) {
  if (!(onHand + qty > 0)) return avg;
  return Math.max(0, Math.round((onHand * avg + qty * cost) / (onHand + qty)));
}

/**
 * Post a batch of changes. lines: [{ item, location, qty (signed), kind,
 * reason, unit_cost?, note?, po_line? }] where item and location are records
 * or ids. opts: { actor, batch?, ref_type?, ref?, reverses?, note?,
 * allowNegative? }. Returns { batch, movements }.
 */
function post(tx, lines, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const locs = require(`${__hooks}/lib_locations.js`);
  const o = opts || {};
  const batch = o.batch || u.batchId();
  const allowNeg = o.allowNegative !== undefined ? o.allowNegative : core.settings(tx).getBool('allow_negative');
  const movCol = tx.findCollectionByNameOrId('movements');
  const stockCol = tx.findCollectionByNameOrId('stock');
  let ix = null;
  const out = [];
  for (const line of lines) {
    const qty = u.q3(line.qty);
    if (qty === 0) continue;
    const item = tx.findRecordById('items', idOf(line.item));
    const loc = tx.findRecordById('locations', idOf(line.location));
    if (!item.getBool('fractional') && !Number.isInteger(qty)) {
      throw u.fail(400, '"' + item.getString('name') + '" is counted in whole units, so the quantity must be a whole number (got ' + qty + ')');
    }
    let st = u.findOne(tx, 'stock', 'item = {:i} && location = {:l}', { i: item.id, l: loc.id });
    const before = st === null ? 0 : u.q3(st.getFloat('qty'));
    const after = u.q3(before + qty);
    if (qty < 0 && after < 0 && !allowNeg) {
      if (ix === null) ix = locs.index(tx);
      const unit = item.getString('unit') || 'units';
      throw u.fail(
        400,
        'Only ' + u.fmtQty(before) + ' ' + unit + ' of "' + item.getString('name') + '" at ' + ix.path(loc.id) + ', so ' + u.fmtQty(-qty) + ' cannot be taken out.',
        'Use a smaller qty or another location (items.get --item "' + item.getString('sku') + '" shows where it is).',
      );
    }

    // A receipt with a price moves the average cost. An undo takes back what
    // the entry it reverses did to it, at that entry's cost (as if it never happened).
    let unitCost = item.getInt('unit_cost');
    if (line.cost_basis !== undefined) {
      if (line.kind !== 'move') {
        const next = blendCost(item.getInt('unit_cost'), Math.max(0, itemTotal(tx, item.id)), qty, line.cost_basis);
        if (next !== item.getInt('unit_cost')) {
          item.set('unit_cost', next);
          tx.save(item);
        }
      }
      unitCost = line.cost_basis;
    } else if (qty > 0 && line.unit_cost !== undefined && line.unit_cost !== null) {
      const onHand = Math.max(0, itemTotal(tx, item.id));
      const avg = item.getInt('unit_cost');
      const next = onHand + qty > 0 ? Math.round((onHand * avg + qty * line.unit_cost) / (onHand + qty)) : line.unit_cost;
      if (next !== avg) {
        item.set('unit_cost', next);
        tx.save(item);
      }
      unitCost = line.unit_cost;
    }

    if (st === null) {
      if (after !== 0) {
        st = new Record(stockCol);
        st.set('item', item.id);
        st.set('location', loc.id);
        st.set('qty', after);
        tx.save(st);
      }
    } else if (after === 0) {
      tx.delete(st);
    } else {
      st.set('qty', after);
      tx.save(st);
    }

    const m = new Record(movCol);
    m.set('item', item.id);
    m.set('location', loc.id);
    m.set('qty', qty);
    m.set('kind', line.kind);
    m.set('reason', line.reason);
    m.set('batch', batch);
    m.set('ref_type', o.ref_type || '');
    m.set('ref', o.ref || '');
    m.set('po_line', line.po_line || '');
    m.set('unit_cost', unitCost);
    m.set('balance', after);
    m.set('actor', o.actor || 'you');
    m.set('note', String(line.note !== undefined ? line.note : o.note || '').slice(0, 300));
    m.set('reverses', o.reverses || '');
    tx.save(m);
    out.push(m);
  }
  return { batch: batch, movements: out };
}

/* ------------------------------------------------------- single actions */

/** Move stock between two locations: one batch of two rows that sum to zero. */
function move(tx, item, from, to, qty, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = opts || {};
  if (idOf(from) === idOf(to)) throw u.fail(400, 'from and to are the same location');
  const n = Math.abs(qty);
  return post(
    tx,
    [
      { item: item, location: from, qty: -n, kind: 'move', reason: 'move', note: o.note },
      { item: item, location: to, qty: n, kind: 'move', reason: 'move', note: o.note },
    ],
    o,
  );
}

/** Set the quantity at a location to what is really there (a correction or a count). */
function setTo(tx, item, location, counted, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = opts || {};
  const now = balance(tx, idOf(item), idOf(location));
  const delta = u.q3(counted - now);
  const kind = o.kind || 'adjust';
  const reason = o.reason || (kind === 'count' ? 'count' : 'correction');
  checkReason(kind, reason);
  if (delta === 0) return { batch: o.batch || '', movements: [], unchanged: true, before: now };
  const r = post(tx, [{ item: item, location: location, qty: delta, kind: kind, reason: reason, note: o.note }], Object.assign({}, o, { allowNegative: true }));
  r.before = now;
  return r;
}

/* ------------------------------------------------------------ batches */

function batchRows(app, batch) {
  return app.findRecordsByFilter('movements', 'batch = {:b}', 'created', 0, 0, { b: batch });
}

/** The batch that undid `batch`, or ''. */
function undoneBy(app, batch) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.findOne(app, 'movements', 'reverses = {:b}', { b: batch });
  return r === null ? '' : r.getString('batch');
}

/** Re-derive what the ledger decides elsewhere: order receipts and count state. */
function resync(tx, refs) {
  const done = {};
  for (const r of refs) {
    const key = r.type + ':' + r.id;
    if (done[key] || r.id === '') continue;
    done[key] = true;
    if (r.type === 'order') require(`${__hooks}/lib_orders.js`).sync(tx, r.id);
    if (r.type === 'count') require(`${__hooks}/lib_counts.js`).sync(tx, r.id);
  }
}

function refsOf(rows) {
  return rows.filter((m) => m.getString('ref_type') === 'order' || m.getString('ref_type') === 'count').map((m) => ({ type: m.getString('ref_type'), id: m.getString('ref') }));
}

function checkBatch(app, batch, verb) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = batchRows(app, batch);
  if (rows.length === 0) throw u.fail(404, 'No history entry with batch "' + batch + '".', 'Find batches with movements.list.');
  if (rows[0].getString('ref_type') === 'import') {
    throw u.fail(400, 'This change came from a CSV import. To ' + verb + ' it, undo the whole import (import.undo).');
  }
  // A move is two entries that cancel out. When one went with a deleted place,
  // reversing the other would make stock appear or vanish.
  const moved = {};
  for (const m of rows) if (m.getString('kind') === 'move') moved[m.getString('item')] = u.q3((moved[m.getString('item')] || 0) + m.getFloat('qty'));
  if (Object.keys(moved).some((k) => moved[k] !== 0)) {
    throw u.fail(400, 'Part of this change was at a place that has since been deleted, so it cannot be ' + (verb === 'undo' ? 'undone' : 'deleted') + '. Record a correction (stock.set) instead.');
  }
  return rows;
}

/** Undo a batch: post the opposite changes, keeping both in the history. */
function undo(app, batch, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = checkBatch(app, batch, 'undo');
  if (rows[0].getString('reverses') !== '') throw u.fail(400, 'This entry is itself an undo. To change stock again, record a new change.');
  let result = null;
  app.runInTransaction((tx) => {
    // Checked inside the transaction, so a double click cannot undo twice.
    if (undoneBy(tx, batch) !== '') throw u.fail(400, 'This change was already undone.');
    // Last change first, so each step is undone from the state it left.
    const lines = rows.slice().reverse().map((m) => ({
      item: m.getString('item'),
      location: m.getString('location'),
      qty: -m.getFloat('qty'),
      kind: m.getString('kind'),
      reason: 'undo',
      po_line: m.getString('po_line'),
      cost_basis: m.getInt('unit_cost'),
      note: '',
    }));
    result = post(tx, lines, {
      actor: actor,
      reverses: batch,
      ref_type: rows[0].getString('ref_type'),
      ref: rows[0].getString('ref'),
    });
    resync(tx, refsOf(rows));
  });
  return { undone: batch, batch: result.batch, entries: result.movements.length };
}

/**
 * Delete a batch from the history: its rows (and the undo that reversed it,
 * if any) are removed and the stock goes back as if they had never happened.
 */
function removeBatch(app, batch, preview) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const rows = checkBatch(app, batch, 'delete');
  const batches = [batch];
  const by = undoneBy(app, batch);
  if (by !== '') batches.push(by);
  let all = rows.slice();
  if (by !== '') all = all.concat(batchRows(app, by));
  // Net effect per (item, location) of what is removed.
  const net = {};
  for (const m of all) {
    const key = m.getString('item') + '|' + m.getString('location');
    net[key] = u.q3((net[key] || 0) + m.getFloat('qty'));
  }
  const changes = [];
  for (const key of Object.keys(net)) {
    if (net[key] === 0) continue;
    const parts = key.split('|');
    changes.push({ item: parts[0], location: parts[1], change: -net[key] });
  }
  const summary = { batches: batches, entries: all.length, stock_changes: changes.length };
  if (preview) return summary;
  const allowNeg = core.settings(app).getBool('allow_negative');
  app.runInTransaction((tx) => {
    // The average cost goes back as if these entries never happened (newest first).
    const byItem = {};
    for (const m of all.slice().reverse()) (byItem[m.getString('item')] = byItem[m.getString('item')] || []).push(m);
    for (const itemId of Object.keys(byItem)) {
      const it = u.byId(tx, 'items', itemId);
      if (it === null) continue;
      let onHand = Math.max(0, itemTotal(tx, itemId));
      let avg = it.getInt('unit_cost');
      for (const m of byItem[itemId]) {
        const q = -u.q3(m.getFloat('qty'));
        if (m.getString('kind') !== 'move') avg = blendCost(avg, onHand, q, m.getInt('unit_cost'));
        onHand = Math.max(0, u.q3(onHand + q));
      }
      if (avg !== it.getInt('unit_cost')) {
        it.set('unit_cost', avg);
        tx.save(it);
      }
    }
    const stockCol = tx.findCollectionByNameOrId('stock');
    for (const c of changes) {
      let st = u.findOne(tx, 'stock', 'item = {:i} && location = {:l}', { i: c.item, l: c.location });
      const before = st === null ? 0 : u.q3(st.getFloat('qty'));
      const after = u.q3(before + c.change);
      if (after < 0 && !allowNeg) {
        const it = tx.findRecordById('items', c.item);
        throw u.fail(400, 'Deleting this would leave ' + u.fmtQty(after) + ' of "' + it.getString('name') + '" (stock was used since). Record a correction instead.');
      }
      if (st === null) {
        st = new Record(stockCol);
        st.set('item', c.item);
        st.set('location', c.location);
      }
      if (after === 0) {
        if (!st.isNew()) tx.delete(st);
      } else {
        st.set('qty', after);
        tx.save(st);
      }
    }
    for (const m of all) tx.delete(tx.findRecordById('movements', m.id));
    // Later history at the same places shows the stock as it now stands.
    const pairs = {};
    for (const m of all) pairs[m.getString('item') + '|' + m.getString('location')] = true;
    for (const key of Object.keys(pairs)) {
      const parts = key.split('|');
      let run = 0;
      for (const r of u.rows(tx, 'SELECT id, qty, balance FROM movements WHERE item = {:i} AND location = {:l} ORDER BY created, rowid', { id: '', qty: -0, balance: -0 }, { i: parts[0], l: parts[1] })) {
        run = u.q3(run + r.qty);
        if (u.q3(r.balance) !== run) {
          const rec = tx.findRecordById('movements', r.id);
          rec.set('balance', run);
          tx.save(rec);
        }
      }
    }
    resync(tx, refsOf(all));
  });
  return summary;
}

/* ------------------------------------------------------------- reading */

/** A movement as the API shows it. ctx: { items, locs (index), undone, refs, currency }. */
function serialize(m, ctx) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const it = ctx.items[m.getString('item')];
  const locId = m.getString('location');
  const batch = m.getString('batch');
  const refType = m.getString('ref_type');
  const ref = m.getString('ref');
  return {
    id: m.id,
    batch: batch,
    item: it !== undefined ? it : { id: m.getString('item'), name: '(deleted item)', sku: '', unit: '', photo: null, icon: 'package' },
    location: { id: locId, name: ctx.locs.byId[locId] ? ctx.locs.byId[locId].name : '', path: ctx.locs.path(locId) },
    qty: u.q3(m.getFloat('qty')),
    kind: m.getString('kind'),
    reason: m.getString('reason'),
    reason_label: REASON_LABELS[m.getString('reason')] || m.getString('reason'),
    balance: u.q3(m.getFloat('balance')),
    unit_cost: core.costText(m.getInt('unit_cost'), ctx.currency),
    value: Math.round(m.getFloat('qty') * m.getInt('unit_cost')),
    value_text: core.moneyText(Math.round(m.getFloat('qty') * m.getInt('unit_cost')), ctx.currency),
    actor: m.getString('actor'),
    note: m.getString('note'),
    ref_type: refType,
    ref: ref,
    ref_label: refType !== '' && ctx.refs[refType + ':' + ref] !== undefined ? ctx.refs[refType + ':' + ref] : '',
    reverses: m.getString('reverses'),
    undone_by: ctx.undone[batch] || '',
    created: m.getString('created'),
  };
}

/** Context for serializing many movements at once. */
function context(app, rows) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const locs = require(`${__hooks}/lib_locations.js`).index(app);
  const cur = core.currency(app);
  const itemIds = [];
  const batches = [];
  const refs = {};
  for (const m of rows) {
    if (itemIds.indexOf(m.getString('item')) < 0) itemIds.push(m.getString('item'));
    if (batches.indexOf(m.getString('batch')) < 0) batches.push(m.getString('batch'));
    const rt = m.getString('ref_type');
    if (rt !== '') refs[rt + ':' + m.getString('ref')] = '';
  }
  const cats = items.categoryMap(app);
  const itemMap = {};
  for (const id of itemIds) {
    const r = u.byId(app, 'items', id);
    if (r !== null) itemMap[id] = items.tiny(r, cats);
  }
  const undone = {};
  for (let i = 0; i < batches.length; i += 50) {
    const chunk = batches.slice(i, i + 50);
    const bind = {};
    const ins = chunk.map((b, j) => {
      bind['b' + j] = b;
      return '{:b' + j + '}';
    });
    const hits = u.rows(app, 'SELECT reverses, batch FROM movements WHERE reverses IN (' + ins.join(',') + ') GROUP BY reverses', { reverses: '', batch: '' }, bind);
    for (const h of hits) undone[h.reverses] = h.batch;
  }
  for (const key of Object.keys(refs)) {
    const parts = key.split(':');
    if (parts[0] === 'order') {
      const o = u.byId(app, 'orders', parts[1]);
      refs[key] = o !== null ? o.getString('number') : '';
    } else if (parts[0] === 'count') {
      const c = u.byId(app, 'counts', parts[1]);
      refs[key] = c !== null ? c.getString('number') : '';
    } else if (parts[0] === 'import') {
      const im = u.byId(app, 'imports', parts[1]);
      refs[key] = im !== null ? im.getString('filename') : '';
    }
  }
  return { items: itemMap, locs: locs, undone: undone, refs: refs, currency: cur };
}

/** History, newest first, with filters. */
function list(app, f) {
  const u = require(`${__hooks}/lib_util.js`);
  const parts = ["id != ''"];
  const bind = {};
  if (f.item) {
    parts.push('item = {:item}');
    bind.item = f.item;
  }
  if (f.locations && f.locations.length > 0) {
    parts.push('(' + f.locations.map((id, i) => {
      bind['l' + i] = id;
      return 'location = {:l' + i + '}';
    }).join(' || ') + ')');
  }
  if (f.kind) {
    parts.push('kind = {:kind}');
    bind.kind = f.kind;
  }
  if (f.reason) {
    parts.push('reason = {:reason}');
    bind.reason = f.reason;
  }
  if (f.actor) {
    parts.push('actor = {:actor}');
    bind.actor = f.actor;
  }
  if (f.batch) {
    parts.push('batch = {:batch}');
    bind.batch = f.batch;
  }
  if (f.ref_type) {
    parts.push('ref_type = {:rt}');
    bind.rt = f.ref_type;
  }
  if (f.ref) {
    parts.push('ref = {:ref}');
    bind.ref = f.ref;
  }
  if (f.from) {
    parts.push('created >= {:from}');
    bind.from = u.dayStartTs(f.from);
  }
  if (f.to) {
    parts.push('created < {:to}');
    bind.to = u.dayStartTs(u.addDays(f.to, 1));
  }
  if (f.q) {
    parts.push('(item.name ~ {:q} || item.sku ~ {:q} || note ~ {:q})');
    bind.q = f.q;
  }
  const filter = parts.join(' && ');
  const rows = app.findRecordsByFilter('movements', filter, '-created,-id', f.limit + 1, f.offset, bind);
  const more = rows.length > f.limit;
  const page = more ? rows.slice(0, f.limit) : rows;
  const ctx = context(app, page);
  return { movements: page.map((m) => serialize(m, ctx)), more: more, offset: f.offset, limit: f.limit };
}

module.exports = {
  KINDS: KINDS,
  REASONS: REASONS,
  REASON_LABELS: REASON_LABELS,
  checkReason: checkReason,
  itemTotal: itemTotal,
  balance: balance,
  post: post,
  move: move,
  setTo: setTo,
  batchRows: batchRows,
  undoneBy: undoneBy,
  undo: undo,
  removeBatch: removeBatch,
  serialize: serialize,
  context: context,
  list: list,
};
