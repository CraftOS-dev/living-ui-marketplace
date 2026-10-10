/// <reference path="../pb_data/types.d.ts" />
/**
 * Purchase orders: what was ordered from a supplier and how much of it has
 * arrived.
 *
 *   draft      being put together; lines can change freely
 *   ordered    sent to the supplier; its open quantities count as incoming
 *   partial    some of it has arrived
 *   received   all of it arrived, or it was closed short (the rest is not
 *              coming); nothing is incoming any more
 *   cancelled  called off before anything arrived
 *
 * A line's `received` and the order's status are derived from the ledger:
 * receiving posts movements tagged with the line (po_line), and sync()
 * recomputes both, so undoing or deleting a receipt in the history puts the
 * order back where it was.
 */

const STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'];
const OPEN = ['draft', 'ordered', 'partial'];

function lineRows(app, orderId) {
  return app.findRecordsByFilter('order_lines', 'po = {:o}', 'sort,created', 0, 0, { o: orderId });
}

/** Recompute every line's received quantity and the order's status from the ledger. */
function sync(tx, orderId) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(tx, 'orders', orderId);
  if (rec === null) return;
  const lines = lineRows(tx, orderId);
  let anyReceived = false;
  let allReceived = lines.length > 0;
  for (const l of lines) {
    const r = u.rows(tx, 'SELECT IFNULL(SUM(qty), 0) AS t FROM movements WHERE po_line = {:l}', { t: -0 }, { l: l.id });
    const received = Math.max(0, r.length > 0 ? u.q3(r[0].t) : 0);
    if (u.q3(l.getFloat('received')) !== received) {
      l.set('received', received);
      tx.save(l);
    }
    if (received > 0) anyReceived = true;
    if (received < u.q3(l.getFloat('qty'))) allReceived = false;
  }
  const st = rec.getString('status');
  if (st === 'draft' || st === 'cancelled') return;
  let next = 'ordered';
  if (allReceived || (rec.getBool('closed_short') && anyReceived)) next = 'received';
  else if (anyReceived) next = 'partial';
  if (rec.getBool('closed_short') && !anyReceived) {
    rec.set('closed_short', false);
  }
  rec.set('status', next);
  if (next === 'received') {
    if (rec.getString('received_on') === '') rec.set('received_on', u.today());
  } else {
    rec.set('received_on', '');
  }
  tx.save(rec);
}

function supplierOf(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = rec.getString('supplier') !== '' ? u.byId(app, 'suppliers', rec.getString('supplier')) : null;
  return s === null
    ? null
    : {
        id: s.id,
        name: s.getString('name'),
        email: s.getString('email'),
        phone: s.getString('phone'),
        contact: s.getString('contact'),
        lead_time_days: s.getInt('lead_time_days'),
      };
}

/** An order with its lines and totals. */
function serialize(app, rec, ctx) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const c = ctx || {};
  const cur = c.currency || core.currency(app);
  const ix = c.locs || require(`${__hooks}/lib_locations.js`).index(app);
  const cats = c.cats || items.categoryMap(app);
  const lines = lineRows(app, rec.id).map((l) => {
    const it = u.byId(app, 'items', l.getString('item'));
    const qty = u.q3(l.getFloat('qty'));
    const received = u.q3(l.getFloat('received'));
    const cost = l.getInt('unit_cost');
    return {
      id: l.id,
      item: it !== null ? items.tiny(it, cats) : { id: l.getString('item'), name: '(deleted item)', sku: '', unit: '', photo: null, icon: 'package' },
      qty: qty,
      received: received,
      remaining: Math.max(0, u.q3(qty - received)),
      unit_cost: core.costText(cost, cur),
      unit_cost_e4: cost,
      total: Math.round(qty * cost),
      total_text: core.moneyText(Math.round(qty * cost), cur),
    };
  });
  const value = lines.reduce((s, l) => s + l.total, 0);
  const qty = u.q3(lines.reduce((s, l) => s + l.qty, 0));
  const received = u.q3(lines.reduce((s, l) => s + Math.min(l.received, l.qty), 0));
  const loc = rec.getString('location');
  return {
    id: rec.id,
    number: rec.getString('number'),
    status: rec.getString('status'),
    supplier: supplierOf(app, rec),
    location: loc !== '' && ix.byId[loc] ? { id: loc, name: ix.byId[loc].name, path: ix.path(loc) } : null,
    expected_on: rec.getString('expected_on'),
    ordered_on: rec.getString('ordered_on'),
    received_on: rec.getString('received_on'),
    closed_short: rec.getBool('closed_short'),
    note: rec.getString('note'),
    agent_note: rec.getString('agent_note'),
    origin: rec.getString('origin') || 'you',
    lines: lines,
    line_count: lines.length,
    qty: qty,
    received: received,
    progress: qty > 0 ? Math.min(1, received / qty) : 0,
    value: value,
    value_text: core.moneyText(value, cur),
    currency: cur,
    late: OPEN.indexOf(rec.getString('status')) > 0 && rec.getString('expected_on') !== '' && rec.getString('expected_on') < u.today(),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function list(app, f) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const parts = ["id != ''"];
  const bind = {};
  if (f.status === 'open') parts.push("(status = 'draft' || status = 'ordered' || status = 'partial')");
  else if (f.status && f.status !== 'all') {
    parts.push('status = {:st}');
    bind.st = f.status;
  }
  if (f.supplier) {
    parts.push('supplier = {:sup}');
    bind.sup = f.supplier;
  }
  if (f.item) {
    const ids = u.rows(app, 'SELECT DISTINCT po FROM order_lines WHERE item = {:i}', { po: '' }, { i: f.item }).map((r) => r.po);
    if (ids.length === 0) return { orders: [], total: 0, currency: core.currency(app), counts: counts(app) };
    parts.push('(' + ids.map((id, i) => {
      bind['o' + i] = id;
      return 'id = {:o' + i + '}';
    }).join(' || ') + ')');
  }
  if (f.q) {
    parts.push('(number ~ {:q} || supplier.name ~ {:q} || note ~ {:q})');
    bind.q = f.q;
  }
  const recs = app.findRecordsByFilter('orders', parts.join(' && '), '-created', f.limit + 1, f.offset, bind);
  const more = recs.length > f.limit;
  const page = more ? recs.slice(0, f.limit) : recs;
  const ctx = {
    currency: core.currency(app),
    locs: require(`${__hooks}/lib_locations.js`).index(app),
    cats: require(`${__hooks}/lib_items.js`).categoryMap(app),
  };
  return { orders: page.map((r) => serialize(app, r, ctx)), more: more, currency: ctx.currency, counts: counts(app) };
}

function counts(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = { draft: 0, ordered: 0, partial: 0, received: 0, cancelled: 0, open: 0, late: 0 };
  for (const r of u.rows(app, 'SELECT status, COUNT(id) AS n FROM orders GROUP BY status', { status: '', n: 0 })) out[r.status] = r.n;
  out.open = out.draft + out.ordered + out.partial;
  const late = u.rows(app, "SELECT COUNT(id) AS n FROM orders WHERE status IN ('ordered', 'partial') AND expected_on != '' AND expected_on < {:t}", { n: 0 }, { t: u.today() });
  out.late = late.length > 0 ? late[0].n : 0;
  return out;
}

/** Where deliveries go when the caller does not say: the first top-level place. */
function defaultLocation(app) {
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  return ix.roots.length > 0 ? ix.roots[0] : '';
}

/** Lines given as JSON: [{ item, qty, unit_cost? }]. */
function readLines(app, raw, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {};
    const it = core.item(app, r.item, param + '[' + i + '].item');
    const qty = u.qtyOf(r.qty, param + '[' + i + '].qty', { required: true, positive: true, fractional: it.getBool('fractional'), label: '"' + it.getString('name') + '"' });
    const cost = u.costOf(r.unit_cost, param + '[' + i + '].unit_cost');
    out.push({ item: it, qty: qty, unit_cost: cost });
  }
  return out;
}

function nextSort(tx, orderId) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.rows(tx, 'SELECT IFNULL(MAX(sort), 0) AS m FROM order_lines WHERE po = {:o}', { m: 0 }, { o: orderId });
  return (r.length > 0 ? r[0].m : 0) + 1;
}

/** Add an item to an order, or raise its quantity when it is already on it. */
function putLine(tx, orderId, item, qty, unitCost, mode) {
  const u = require(`${__hooks}/lib_util.js`);
  const existing = u.findOne(tx, 'order_lines', 'po = {:o} && item = {:i}', { o: orderId, i: item.id });
  if (existing !== null) {
    const next = mode === 'set' ? qty : u.q3(existing.getFloat('qty') + qty);
    if (next < u.q3(existing.getFloat('received'))) throw u.fail(400, 'More of "' + item.getString('name') + '" already arrived than ' + next);
    existing.set('qty', next);
    if (unitCost !== null && unitCost !== undefined) existing.set('unit_cost', unitCost);
    tx.save(existing);
    return existing;
  }
  const line = new Record(tx.findCollectionByNameOrId('order_lines'));
  line.set('po', orderId);
  line.set('item', item.id);
  line.set('qty', qty);
  line.set('received', 0);
  line.set('unit_cost', unitCost !== null && unitCost !== undefined ? unitCost : item.getInt('unit_cost'));
  line.set('sort', nextSort(tx, orderId));
  tx.save(line);
  return line;
}

/** A new draft order (optionally with lines). */
function create(app, p, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const sup = u.str(p, 'supplier', '') !== '' ? core.supplier(app, u.str(p, 'supplier', '')) : null;
  const locName = u.str(p, 'location', '');
  const loc = locName !== '' ? core.location(app, locName).id : defaultLocation(app);
  const lines = readLines(app, u.list(p, 'lines') || [], 'lines');
  const origin = u.oneOf(p, 'origin', ['you', 'agent', 'reorder'], actor === 'agent' ? 'agent' : 'you');
  let id = '';
  app.runInTransaction((tx) => {
    const rec = new Record(tx.findCollectionByNameOrId('orders'));
    rec.set('number', core.nextNumber(tx, 'orders', 'number', 'PO-', 4));
    rec.set('supplier', sup !== null ? sup.id : '');
    rec.set('location', loc);
    rec.set('status', 'draft');
    rec.set('expected_on', u.day(p, 'expected_on', ''));
    rec.set('note', u.str(p, 'note', '').slice(0, 1000));
    rec.set('agent_note', u.str(p, 'agent_note', '').slice(0, 2000));
    rec.set('origin', origin);
    rec.set('closed_short', false);
    tx.save(rec);
    id = rec.id;
    for (const l of lines) putLine(tx, id, l.item, l.qty, l.unit_cost, 'add');
  });
  return serialize(app, app.findRecordById('orders', id));
}

function update(app, rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  if (u.has(p, 'supplier')) {
    const s = u.str(p, 'supplier', '');
    rec.set('supplier', s === '' ? '' : core.supplier(app, s).id);
  }
  if (u.has(p, 'location')) {
    const l = u.str(p, 'location', '');
    rec.set('location', l === '' ? defaultLocation(app) : core.location(app, l).id);
  }
  if (u.has(p, 'expected_on')) rec.set('expected_on', u.day(p, 'expected_on', ''));
  if (u.has(p, 'note')) rec.set('note', u.str(p, 'note', '').slice(0, 1000));
  if (u.has(p, 'agent_note')) rec.set('agent_note', u.str(p, 'agent_note', '').slice(0, 2000));
  app.save(rec);
  return serialize(app, rec);
}

function assertEditable(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const st = rec.getString('status');
  if (st === 'received' || st === 'cancelled') {
    throw u.fail(400, rec.getString('number') + ' is ' + st + '; reopen it before changing its lines (orders.reopen).');
  }
}

function addLine(app, rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  assertEditable(rec);
  const it = core.item(app, u.req(p, 'item', 'SKU-0001'));
  const qty = u.qty(p, 'qty', { required: true, positive: true, fractional: it.getBool('fractional'), label: '"' + it.getString('name') + '"' });
  const cost = u.cost(p, 'unit_cost');
  app.runInTransaction((tx) => {
    putLine(tx, rec.id, it, qty, cost, u.oneOf(p, 'mode', ['add', 'set'], 'add'));
    sync(tx, rec.id);
  });
  return serialize(app, app.findRecordById('orders', rec.id));
}

function lineOf(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const l = u.byId(app, 'order_lines', id);
  if (l === null) throw u.fail(404, 'No order line "' + id + '".', 'Line ids are in orders.get.');
  return l;
}

function updateLine(app, line, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = app.findRecordById('orders', line.getString('po'));
  assertEditable(rec);
  const it = app.findRecordById('items', line.getString('item'));
  const qty = u.qty(p, 'qty', { positive: true, fractional: it.getBool('fractional'), label: '"' + it.getString('name') + '"' });
  if (qty !== null) {
    if (qty < u.q3(line.getFloat('received'))) throw u.fail(400, u.fmtQty(line.getFloat('received')) + ' of "' + it.getString('name') + '" already arrived, so the line cannot be less than that');
    line.set('qty', qty);
  }
  const cost = u.cost(p, 'unit_cost');
  if (cost !== null) line.set('unit_cost', cost);
  app.runInTransaction((tx) => {
    tx.save(line);
    sync(tx, rec.id);
  });
  return serialize(app, app.findRecordById('orders', rec.id));
}

function removeLine(app, line) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = app.findRecordById('orders', line.getString('po'));
  assertEditable(rec);
  if (u.q3(line.getFloat('received')) > 0) throw u.fail(400, 'Part of this line already arrived, so it cannot be removed. Undo the receipt in the history first.');
  app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('order_lines', line.id));
    sync(tx, rec.id);
  });
  return serialize(app, app.findRecordById('orders', rec.id));
}

/** Draft -> ordered: its open quantities now count as incoming. */
function markOrdered(app, rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  if (rec.getString('status') !== 'draft') throw u.fail(400, rec.getString('number') + ' is already ' + rec.getString('status'));
  if (lineRows(app, rec.id).length === 0) throw u.fail(400, 'Add at least one line before ordering');
  const expected = u.day(p, 'expected_on', '');
  rec.set('status', 'ordered');
  rec.set('ordered_on', u.today());
  if (expected !== '') rec.set('expected_on', expected);
  else if (rec.getString('expected_on') === '') {
    const sup = supplierOf(app, rec);
    if (sup !== null && sup.lead_time_days > 0) rec.set('expected_on', u.addDays(u.today(), sup.lead_time_days));
  }
  app.save(rec);
  return serialize(app, rec);
}

/** Ordered -> draft again, while nothing has arrived. */
function backToDraft(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  if (rec.getString('status') !== 'ordered') throw u.fail(400, 'Only an ordered purchase order with nothing received can go back to draft');
  rec.set('status', 'draft');
  rec.set('ordered_on', '');
  app.save(rec);
  return serialize(app, rec);
}

/**
 * Record what arrived. lines: [{ line (id) or item, qty }]; all=true takes
 * everything still to come. Posts one batch tagged with the order.
 */
function receive(app, rec, p, actor, extra) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const st = rec.getString('status');
  if (st !== 'ordered' && st !== 'partial') {
    throw u.fail(400, rec.getString('number') + ' is ' + st + '. Only ordered purchase orders can be received' + (st === 'draft' ? ' (orders.mark-ordered first).' : '.'));
  }
  const lines = lineRows(app, rec.id);
  const locName = u.str(p, 'location', '');
  const loc = locName !== '' ? core.location(app, locName).id : rec.getString('location') || defaultLocation(app);
  if (loc === '') throw u.fail(400, 'Say where the delivery goes: location is required');
  const posts = [];
  if (u.bool(p, 'all', false)) {
    for (const l of lines) {
      const rem = u.q3(l.getFloat('qty') - l.getFloat('received'));
      if (rem > 0) posts.push({ line: l, qty: rem });
    }
  } else {
    const raw = u.list(p, 'lines');
    if (raw === undefined || raw.length === 0) throw u.fail(400, 'Give lines (JSON list of {"line":"<line id>","qty":5} or {"item":"<sku>","qty":5}) or all=true');
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] || {};
      let l = null;
      if (r.line) l = lines.filter((x) => x.id === String(r.line))[0] || null;
      else if (r.item) {
        const it = core.item(app, r.item, 'lines[' + i + '].item');
        l = lines.filter((x) => x.getString('item') === it.id)[0] || null;
        if (l === null) throw u.fail(400, '"' + it.getString('name') + '" is not on ' + rec.getString('number') + '. Add it first (orders.add-line) or receive it as plain stock (stock.in).');
      }
      if (l === null) throw u.fail(400, 'lines[' + i + '] does not match a line of ' + rec.getString('number'));
      const it = app.findRecordById('items', l.getString('item'));
      const qty = u.qtyOf(r.qty, 'lines[' + i + '].qty', { required: true, fractional: it.getBool('fractional'), label: '"' + it.getString('name') + '"' });
      if (qty > 0) posts.push({ line: l, qty: qty });
    }
  }
  if (posts.length === 0) throw u.fail(400, 'Nothing to receive: every line has already arrived');
  let batch = '';
  app.runInTransaction((tx) => {
    const r = ledger.post(
      tx,
      posts.map((x) => ({
        item: x.line.getString('item'),
        location: loc,
        qty: x.qty,
        kind: 'in',
        reason: 'received',
        unit_cost: x.line.getInt('unit_cost') > 0 ? x.line.getInt('unit_cost') : undefined,
        po_line: x.line.id,
      })),
      { actor: actor, ref_type: 'order', ref: rec.id, note: (extra && extra.note) || '' },
    );
    batch = r.batch;
    sync(tx, rec.id);
  });
  const out = serialize(app, app.findRecordById('orders', rec.id));
  out.batch = batch;
  return out;
}

/** Nothing more is coming: close what is left. */
function close(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  if (rec.getString('status') !== 'partial' && rec.getString('status') !== 'ordered') {
    throw u.fail(400, 'Only an ordered or partly received purchase order can be closed');
  }
  if (rec.getString('status') === 'ordered') throw u.fail(400, 'Nothing has arrived yet; cancel the order instead (orders.cancel).');
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('orders', rec.id);
    r.set('closed_short', true);
    tx.save(r);
    sync(tx, rec.id);
  });
  return serialize(app, app.findRecordById('orders', rec.id));
}

function cancel(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const st = rec.getString('status');
  if (st === 'cancelled') throw u.fail(400, rec.getString('number') + ' is already cancelled');
  if (st === 'partial' || st === 'received') throw u.fail(400, 'Part of ' + rec.getString('number') + ' already arrived; close it instead (orders.close).');
  rec.set('status', 'cancelled');
  app.save(rec);
  return serialize(app, rec);
}

/** Cancelled -> draft, or a closed-short order back to open. */
function reopen(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const st = rec.getString('status');
  if (st === 'cancelled') {
    rec.set('status', 'draft');
    rec.set('ordered_on', '');
    app.save(rec);
    return serialize(app, rec);
  }
  if (st === 'received' && rec.getBool('closed_short')) {
    app.runInTransaction((tx) => {
      const r = tx.findRecordById('orders', rec.id);
      r.set('closed_short', false);
      r.set('status', 'ordered');
      tx.save(r);
      sync(tx, rec.id);
    });
    return serialize(app, app.findRecordById('orders', rec.id));
  }
  throw u.fail(400, 'Only a cancelled or closed-short purchase order can be reopened');
}

function deletePreview(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.rows(app, "SELECT COUNT(id) AS n FROM movements WHERE ref_type = 'order' AND ref = {:o}", { n: 0 }, { o: rec.id });
  return {
    order: { id: rec.id, number: rec.getString('number'), status: rec.getString('status') },
    lines: lineRows(app, rec.id).length,
    receipts_kept_in_history: r.length > 0 ? r[0].n : 0,
  };
}

/** The order as plain text, ready to paste into an email to the supplier. */
function text(app, rec) {
  const o = serialize(app, rec);
  const out = [];
  out.push('Purchase order ' + o.number);
  if (o.supplier !== null) out.push('To: ' + o.supplier.name);
  if (o.location !== null) out.push('Deliver to: ' + o.location.path);
  if (o.expected_on !== '') out.push('Needed by: ' + o.expected_on);
  out.push('');
  for (const l of o.lines) {
    out.push('- ' + l.qty + ' ' + l.item.unit + '  ' + l.item.name + (l.item.sku !== '' ? ' (' + l.item.sku + ')' : '') + (l.unit_cost_e4 > 0 ? '  @ ' + l.unit_cost + ' ' + o.currency : ''));
  }
  if (o.value > 0) {
    out.push('');
    out.push('Total: ' + o.value_text + ' ' + o.currency);
  }
  if (o.note !== '') {
    out.push('');
    out.push(o.note);
  }
  return out.join('\n');
}

module.exports = {
  STATUSES: STATUSES,
  OPEN: OPEN,
  lineRows: lineRows,
  sync: sync,
  serialize: serialize,
  list: list,
  counts: counts,
  defaultLocation: defaultLocation,
  readLines: readLines,
  putLine: putLine,
  create: create,
  update: update,
  addLine: addLine,
  lineOf: lineOf,
  updateLine: updateLine,
  removeLine: removeLine,
  markOrdered: markOrdered,
  backToDraft: backToDraft,
  receive: receive,
  close: close,
  cancel: cancel,
  reopen: reopen,
  deletePreview: deletePreview,
  text: text,
};
