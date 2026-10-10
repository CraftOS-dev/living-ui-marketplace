/// <reference path="../pb_data/types.d.ts" />
/**
 * The stock operations behind stock.in, stock.out, stock.move, stock.set
 * and stock.batch: read and check the params, work out the location when
 * the caller leaves it out and there is only one sensible answer, then post
 * through the ledger.
 *
 * Location when not given:
 *   in   the item's home location, else the first top-level place
 *   out, move (from), set
 *        the only place that holds the item, else its home location if it
 *        holds the item there; otherwise the caller must say which.
 */

function places(app, itemId) {
  return app.findRecordsByFilter('stock', 'item = {:i} && qty != 0', '-qty', 0, 0, { i: itemId });
}

function whereFrom(app, item, given, param, need) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  if (given !== '') return core.location(app, given, param);
  const here = places(app, item.id);
  if (here.length === 1) return app.findRecordById('locations', here[0].getString('location'));
  const home = item.getString('default_location');
  if (home !== '') {
    const atHome = here.filter((s) => s.getString('location') === home);
    if (atHome.length > 0 || (here.length === 0 && need === 'set')) return app.findRecordById('locations', home);
  }
  if (here.length === 0) {
    if (need === 'set') {
      const def = require(`${__hooks}/lib_orders.js`).defaultLocation(app);
      if (def !== '') return app.findRecordById('locations', def);
    }
    throw u.fail(400, '"' + item.getString('name') + '" is not stocked anywhere yet, so there is nothing to take out.');
  }
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  throw u.fail(
    400,
    '"' + item.getString('name') + '" is in ' + here.length + ' places; say which with ' + param + ': ' + here.map((s) => ix.path(s.getString('location')) + ' (' + u.fmtQty(s.getFloat('qty')) + ')').join(', '),
  );
}

function whereTo(app, item, given, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  if (given !== '') return core.location(app, given, param);
  if (item.getString('default_location') !== '') return app.findRecordById('locations', item.getString('default_location'));
  const def = require(`${__hooks}/lib_orders.js`).defaultLocation(app);
  if (def === '') throw u.fail(400, 'Add a location first (locations.add)');
  return app.findRecordById('locations', def);
}

/** One line, checked and resolved. raw: { item, location, to, qty, reason, unit_cost, note } */
function readLine(app, raw, kind, prefix) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const r = raw || {};
  const item = core.item(app, r.item, prefix + 'item');
  const label = '"' + item.getString('name') + '"';
  const fractional = item.getBool('fractional');
  const loc = String(r.location === undefined || r.location === null ? '' : r.location).trim();
  const line = { kind: kind, item: item, note: String(r.note || '').slice(0, 300) };
  if (kind === 'in') {
    line.qty = u.qtyOf(r.qty, prefix + 'qty', { required: true, positive: true, fractional: fractional, label: label });
    line.location = whereTo(app, item, loc, prefix + 'location');
    line.reason = r.reason ? String(r.reason) : 'received';
    ledger.checkReason('in', line.reason);
    line.unit_cost = u.costOf(r.unit_cost, prefix + 'unit_cost');
  } else if (kind === 'out') {
    line.qty = u.qtyOf(r.qty, prefix + 'qty', { required: true, positive: true, fractional: fractional, label: label });
    line.location = whereFrom(app, item, loc, prefix + 'location', 'out');
    line.reason = r.reason ? String(r.reason) : 'used';
    ledger.checkReason('out', line.reason);
  } else if (kind === 'move') {
    line.qty = u.qtyOf(r.qty, prefix + 'qty', { required: true, positive: true, fractional: fractional, label: label });
    const from = String(r.from === undefined || r.from === null ? loc : r.from).trim();
    line.location = whereFrom(app, item, from, prefix + 'from', 'move');
    const to = String(r.to || '').trim();
    if (to === '') throw u.fail(400, prefix + 'to is required: where the stock goes');
    line.to = core.location(app, to, prefix + 'to');
    if (line.to.id === line.location.id) throw u.fail(400, 'from and to are the same place');
  } else if (kind === 'set') {
    line.qty = u.qtyOf(r.qty, prefix + 'qty', { required: true, fractional: fractional, label: label });
    line.location = whereFrom(app, item, loc, prefix + 'location', 'set');
    line.reason = r.reason ? String(r.reason) : 'correction';
    ledger.checkReason('adjust', line.reason);
  } else {
    throw u.fail(400, prefix + 'kind must be one of: in, out, move, set');
  }
  return line;
}

/** Post resolved lines as one batch, in order. */
function postLines(tx, lines, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const batch = opts.batch || u.batchId();
  const o = Object.assign({}, opts, { batch: batch });
  let entries = 0;
  for (const l of lines) {
    let r = null;
    if (l.kind === 'in') r = ledger.post(tx, [{ item: l.item.id, location: l.location.id, qty: l.qty, kind: 'in', reason: l.reason, unit_cost: l.unit_cost !== null ? l.unit_cost : undefined, note: l.note || o.note }], o);
    else if (l.kind === 'out') r = ledger.post(tx, [{ item: l.item.id, location: l.location.id, qty: -l.qty, kind: 'out', reason: l.reason, note: l.note || o.note }], o);
    else if (l.kind === 'move') r = ledger.move(tx, l.item.id, l.location.id, l.to.id, l.qty, Object.assign({}, o, { note: l.note || o.note }));
    else if (l.kind === 'set') r = ledger.setTo(tx, l.item.id, l.location.id, l.qty, Object.assign({}, o, { kind: 'adjust', reason: l.reason, note: l.note || o.note }));
    entries += r.movements.length;
  }
  return { batch: entries > 0 ? batch : '', entries: entries };
}

function onHand(app, itemId) {
  return require(`${__hooks}/lib_ledger.js`).itemTotal(app, itemId);
}

const VERB = { in: 'Added', out: 'Took out', move: 'Moved', set: 'Set' };

/** stock.in / out / move / set: one change. */
function single(app, p, kind, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const raw = {
    item: u.req(p, 'item', 'SKU-0001'),
    location: u.str(p, kind === 'move' ? 'from' : 'location', ''),
    to: u.str(p, 'to', ''),
    qty: u.has(p, 'qty') ? (Array.isArray(p.qty) ? p.qty[0] : p.qty) : '',
    reason: u.str(p, 'reason', ''),
    unit_cost: u.str(p, 'unit_cost', ''),
    note: u.str(p, 'note', ''),
  };
  if (kind === 'move') raw.from = raw.location;
  const line = readLine(app, raw, kind, '');
  let res = null;
  app.runInTransaction((tx) => {
    res = postLines(tx, [line], { actor: actor, note: raw.note });
  });
  const it = app.findRecordById('items', line.item.id);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  const unit = it.getString('unit') || 'pcs';
  const total = onHand(app, it.id);
  let message = '';
  if (res.entries === 0) message = 'No change: ' + ix.path(line.location.id) + ' already has ' + u.fmtQty(line.qty) + ' ' + unit + ' of "' + it.getString('name') + '".';
  else if (kind === 'move') message = 'Moved ' + u.fmtQty(line.qty) + ' ' + unit + ' of "' + it.getString('name') + '" from ' + ix.path(line.location.id) + ' to ' + ix.path(line.to.id) + '.';
  else if (kind === 'set') message = 'Set "' + it.getString('name') + '" at ' + ix.path(line.location.id) + ' to ' + u.fmtQty(line.qty) + ' ' + unit + '. On hand: ' + u.fmtQty(total) + '.';
  else message = VERB[kind] + ' ' + u.fmtQty(line.qty) + ' ' + unit + ' of "' + it.getString('name') + '" ' + (kind === 'in' ? 'to ' : 'from ') + ix.path(line.location.id) + '. On hand: ' + u.fmtQty(total) + '.';
  const ctx = items.context(app);
  return { batch: res.batch, entries: res.entries, message: message, item: items.brief(app, it, ctx, core.currency(app)) };
}

/** stock.batch: many changes as one action (one undo). */
function batch(app, p, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const raw = u.list(p, 'lines');
  if (raw === undefined || raw.length === 0) {
    throw u.fail(400, 'lines is required: a JSON list like [{"kind":"in","item":"SKU-0001","qty":5,"location":"LOC-001"}]');
  }
  if (raw.length > 500) throw u.fail(400, 'At most 500 lines at a time');
  const note = u.str(p, 'note', '').slice(0, 300);
  const lines = raw.map((r, i) => {
    const kind = String((r || {}).kind || '').trim();
    return readLine(app, r, kind, 'lines[' + i + '].');
  });
  let res = null;
  app.runInTransaction((tx) => {
    res = postLines(tx, lines, { actor: actor, note: note });
  });
  const seen = {};
  const out = [];
  for (const l of lines) {
    if (seen[l.item.id]) continue;
    seen[l.item.id] = true;
    const it = app.findRecordById('items', l.item.id);
    out.push({ id: it.id, name: it.getString('name'), sku: it.getString('sku'), unit: it.getString('unit') || 'pcs', on_hand: onHand(app, it.id) });
  }
  return {
    batch: res.batch,
    entries: res.entries,
    items: out,
    message: res.entries === 0 ? 'No change' : 'Recorded ' + lines.length + (lines.length === 1 ? ' change' : ' changes') + ' for ' + out.length + (out.length === 1 ? ' item' : ' items') + '.',
  };
}

module.exports = { readLine: readLine, postLines: postLines, single: single, batch: batch };
