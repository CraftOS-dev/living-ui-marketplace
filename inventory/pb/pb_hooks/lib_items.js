/// <reference path="../pb_data/types.d.ts" />
/**
 * Items: what is stocked. An item never stores its quantity; on hand is the
 * sum of its stock rows, incoming is what open purchase orders still owe,
 * and its status follows from those and its reorder point and target level:
 *
 *   out      nothing on hand
 *   low      on hand at or below the reorder point (min_qty > 0)
 *   over     on hand above the target level (max_qty > 0)
 *   ok       anything else
 *
 * It needs reordering when on hand plus incoming is at or below the reorder
 * point; the suggested quantity fills it back up to the target level (twice
 * the reorder point when no target is set).
 *
 * Usage is what went out (sold, used, damaged...) over the last 30 days;
 * days left is on hand divided by usage per day.
 */

const USAGE_DAYS = 30;

function photoUrl(rec, thumb) {
  const f = rec.getString('photo');
  if (f === '') return null;
  return '/api/files/items/' + rec.id + '/' + f + (thumb ? '?thumb=' + thumb : '');
}

function categoryMap(app) {
  const out = {};
  for (const c of app.findRecordsByFilter('categories', '', 'sort,name', 0, 0)) {
    out[c.id] = { id: c.id, name: c.getString('name'), icon: c.getString('icon') || 'package' };
  }
  return out;
}

/** The smallest description of an item (for history rows and lines). */
function tiny(rec, cats) {
  const cat = cats !== undefined ? cats[rec.getString('category')] : undefined;
  return {
    id: rec.id,
    name: rec.getString('name'),
    sku: rec.getString('sku'),
    unit: rec.getString('unit') || 'pcs',
    fractional: rec.getBool('fractional'),
    photo: photoUrl(rec, '96x96'),
    icon: cat !== undefined ? cat.icon : 'package',
    archived: rec.getBool('archived'),
  };
}

function status(onHand, min, max, archived) {
  if (archived) return 'archived';
  if (onHand <= 0) return 'out';
  if (min > 0 && onHand <= min) return 'low';
  // A target level at or below the reorder point is not a target (reorders fill to twice the reorder point).
  if (max > min && onHand > max) return 'over';
  return 'ok';
}

/** How much to order to get back to the target level, or 0 when not needed. */
function suggestion(onHand, incoming, min, max, fractional) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!(min > 0)) return 0;
  const position = u.q3(onHand + incoming);
  if (position > min) return 0;
  const target = max > min ? max : min * 2;
  let qty = u.q3(target - position);
  if (!fractional) qty = Math.ceil(qty);
  return qty > 0 ? qty : fractional ? 0.001 : 1;
}

/** Totals, incoming and usage for many items at once. */
function context(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const totals = {};
  for (const r of u.rows(app, 'SELECT item, IFNULL(SUM(qty), 0) AS t, COUNT(id) AS n FROM stock WHERE qty != 0 GROUP BY item', { item: '', t: -0, n: 0 })) {
    totals[r.item] = { qty: u.q3(r.t), places: r.n };
  }
  const incoming = {};
  for (const r of u.rows(
    app,
    "SELECT l.item AS item, IFNULL(SUM(MAX(l.qty - l.received, 0)), 0) AS t FROM order_lines l JOIN orders o ON o.id = l.po WHERE o.status IN ('ordered', 'partial') GROUP BY l.item",
    { item: '', t: -0 },
  )) {
    incoming[r.item] = u.q3(r.t);
  }
  const since = u.dayStartTs(u.addDays(u.today(), -USAGE_DAYS));
  const usage = {};
  for (const r of u.rows(app, "SELECT item, IFNULL(SUM(-qty), 0) AS t FROM movements WHERE kind = 'out' AND created >= {:since} GROUP BY item", { item: '', t: -0 }, { since: since })) {
    usage[r.item] = Math.max(0, u.q3(r.t));
  }
  const suppliers = {};
  for (const s of app.findRecordsByFilter('suppliers', '', 'name', 0, 0)) suppliers[s.id] = { id: s.id, name: s.getString('name'), email: s.getString('email'), lead_time_days: s.getInt('lead_time_days') };
  return { totals: totals, incoming: incoming, usage: usage, cats: categoryMap(app), suppliers: suppliers };
}

/** An item as lists show it: quantities, status, value and reorder figures. */
function brief(app, rec, ctx, cur) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const t = ctx.totals[rec.id] || { qty: 0, places: 0 };
  const incoming = ctx.incoming[rec.id] || 0;
  const min = u.q3(rec.getFloat('min_qty'));
  const max = u.q3(rec.getFloat('max_qty'));
  const used = ctx.usage[rec.id] || 0;
  const perDay = used / USAGE_DAYS;
  const cost = rec.getInt('unit_cost');
  const value = Math.round(Math.max(0, t.qty) * cost);
  const cat = ctx.cats[rec.getString('category')];
  const sup = ctx.suppliers[rec.getString('supplier')];
  const fractional = rec.getBool('fractional');
  return {
    id: rec.id,
    name: rec.getString('name'),
    sku: rec.getString('sku'),
    unit: rec.getString('unit') || 'pcs',
    fractional: fractional,
    photo: photoUrl(rec, '96x96'),
    photo_large: photoUrl(rec, '480x480'),
    category: cat !== undefined ? cat : null,
    icon: cat !== undefined ? cat.icon : 'package',
    on_hand: t.qty,
    places: t.places,
    incoming: incoming,
    min_qty: min,
    max_qty: max,
    status: status(t.qty, min, max, rec.getBool('archived')),
    unit_cost: core.costText(cost, cur),
    unit_cost_e4: cost,
    value: value,
    value_text: core.moneyText(value, cur),
    usage_30d: used,
    usage_per_day: Math.round(perDay * 1000) / 1000,
    days_left: perDay > 0 ? Math.floor(Math.max(0, t.qty) / perDay) : null,
    reorder_qty: rec.getBool('archived') ? 0 : suggestion(t.qty, incoming, min, max, fractional),
    supplier: sup !== undefined ? { id: sup.id, name: sup.name } : null,
    lead_time_days: rec.getInt('lead_time_days') || (sup !== undefined ? sup.lead_time_days : 0),
    archived: rec.getBool('archived'),
    updated: rec.getString('updated'),
  };
}

/** Items that match filters, with the counts per status for the filter chips. */
function list(app, f) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const cur = core.currency(app);
  const ctx = context(app);
  let recs = app.findRecordsByFilter('items', '', 'name', 0, 0);

  if (f.q) {
    const q = f.q.toLowerCase();
    const codeHits = {};
    for (const c of u.rows(app, 'SELECT item FROM codes WHERE LOWER(code) LIKE {:q}', { item: '' }, { q: '%' + q + '%' })) codeHits[c.item] = true;
    recs = recs.filter(
      (r) =>
        r.getString('name').toLowerCase().indexOf(q) >= 0 ||
        r.getString('sku').toLowerCase().indexOf(q) >= 0 ||
        r.getString('description').toLowerCase().indexOf(q) >= 0 ||
        codeHits[r.id] === true,
    );
  }
  if (f.category) recs = recs.filter((r) => (f.category === 'none' ? r.getString('category') === '' : r.getString('category') === f.category));
  if (f.supplier) recs = recs.filter((r) => (f.supplier === 'none' ? r.getString('supplier') === '' : r.getString('supplier') === f.supplier));
  if (f.locations) {
    const inPlace = {};
    if (f.locations.length > 0) {
      const bind = {};
      const ins = f.locations.map((id, i) => {
        bind['l' + i] = id;
        return '{:l' + i + '}';
      });
      for (const s of u.rows(app, 'SELECT DISTINCT item FROM stock WHERE qty != 0 AND location IN (' + ins.join(',') + ')', { item: '' }, bind)) inPlace[s.item] = true;
    }
    recs = recs.filter((r) => inPlace[r.id] === true);
  }
  const archived = f.archived || 'active';
  if (archived === 'active') recs = recs.filter((r) => !r.getBool('archived'));
  if (archived === 'archived') recs = recs.filter((r) => r.getBool('archived'));

  let rows = recs.map((r) => brief(app, r, ctx, cur));
  const counts = { all: rows.length, ok: 0, low: 0, out: 0, over: 0, reorder: 0 };
  for (const r of rows) {
    if (counts[r.status] !== undefined) counts[r.status] += 1;
    if (r.reorder_qty > 0) counts.reorder += 1;
  }
  if (f.status === 'reorder') rows = rows.filter((r) => r.reorder_qty > 0);
  else if (f.status) rows = rows.filter((r) => r.status === f.status);

  const dir = f.desc ? -1 : 1;
  const rank = { out: 0, low: 1, over: 2, ok: 3, archived: 4 };
  const by = {
    name: (a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0),
    qty: (a, b) => a.on_hand - b.on_hand,
    value: (a, b) => a.value - b.value,
    updated: (a, b) => (a.updated < b.updated ? -1 : a.updated > b.updated ? 1 : 0),
    status: (a, b) => rank[a.status] - rank[b.status],
    days_left: (a, b) => (a.days_left === null ? 1e12 : a.days_left) - (b.days_left === null ? 1e12 : b.days_left),
  };
  const cmp = by[f.sort] || by.name;
  rows.sort((a, b) => dir * cmp(a, b) || by.name(a, b));

  const total = rows.length;
  const value = rows.reduce((s, r) => s + r.value, 0);
  const page = rows.slice(f.offset, f.offset + f.limit);
  return {
    currency: cur,
    items: page,
    total: total,
    offset: f.offset,
    limit: f.limit,
    counts: counts,
    value: value,
    value_text: core.moneyText(value, cur),
  };
}

/** On hand at the end of each of the last `days` days (oldest first). */
function series(app, itemId, onHand, days) {
  const u = require(`${__hooks}/lib_util.js`);
  const t = u.today();
  const start = u.addDays(t, -(days - 1));
  const rows = app.findRecordsByFilter('movements', 'item = {:i} && created >= {:s}', '-created', 0, 0, { i: itemId, s: u.dayStartTs(start) });
  const perDay = {};
  for (const m of rows) {
    const d = u.localDay(m.getString('created'));
    perDay[d] = u.q3((perDay[d] || 0) + m.getFloat('qty'));
  }
  const out = [];
  let level = onHand;
  for (let i = 0; i < days; i++) {
    const d = u.addDays(t, -i);
    out.push({ day: d, qty: u.q3(level) });
    level = u.q3(level - (perDay[d] || 0));
  }
  out.reverse();
  return out;
}

/** How many days its chart covers: since its first change, 14 to 90 days. */
function seriesDays(app, itemId) {
  const u = require(`${__hooks}/lib_util.js`);
  const first = app.findRecordsByFilter('movements', 'item = {:i}', 'created', 1, 0, { i: itemId });
  if (first.length === 0) return 14;
  const days = u.daysBetween(u.localDay(first[0].getString('created')), u.today()) + 1;
  return Math.max(14, Math.min(90, days));
}

/** Everything about one item. */
function get(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const cur = core.currency(app);
  const ctx = context(app);
  const b = brief(app, rec, ctx, cur);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);

  const stock = app.findRecordsByFilter('stock', 'item = {:i} && qty != 0', '-qty', 0, 0, { i: rec.id }).map((s) => ({
    location: {
      id: s.getString('location'),
      name: ix.byId[s.getString('location')] ? ix.byId[s.getString('location')].name : '',
      code: ix.byId[s.getString('location')] ? ix.byId[s.getString('location')].code : '',
      kind: ix.byId[s.getString('location')] ? ix.byId[s.getString('location')].kind : 'other',
      path: ix.path(s.getString('location')),
    },
    qty: u.q3(s.getFloat('qty')),
  }));

  const codes = app.findRecordsByFilter('codes', 'item = {:i}', 'created', 0, 0, { i: rec.id }).map((c) => ({ id: c.id, code: c.getString('code') }));

  const lines = u.rows(
    app,
    "SELECT l.id AS id, l.qty AS qty, l.received AS received, o.id AS po, o.number AS number, o.status AS status, o.expected_on AS expected_on " +
      "FROM order_lines l JOIN orders o ON o.id = l.po WHERE l.item = {:i} AND o.status IN ('draft', 'ordered', 'partial') ORDER BY o.created DESC",
    { id: '', qty: -0, received: -0, po: '', number: '', status: '', expected_on: '' },
    { i: rec.id },
  ).map((l) => ({
    id: l.id,
    order: { id: l.po, number: l.number, status: l.status, expected_on: l.expected_on },
    qty: u.q3(l.qty),
    received: u.q3(l.received),
    remaining: Math.max(0, u.q3(l.qty - l.received)),
  }));

  const recentRows = app.findRecordsByFilter('movements', 'item = {:i}', '-created,-id', 25, 0, { i: rec.id });
  const lctx = ledger.context(app, recentRows);
  const recent = recentRows.map((m) => ledger.serialize(m, lctx));
  const sums = u.rows(
    app,
    "SELECT IFNULL(SUM(CASE WHEN qty > 0 AND kind != 'move' THEN qty ELSE 0 END), 0) AS inq, IFNULL(SUM(CASE WHEN qty < 0 AND kind != 'move' THEN -qty ELSE 0 END), 0) AS outq, COUNT(id) AS n FROM movements WHERE item = {:i} AND created >= {:s} AND reverses = '' AND batch NOT IN (SELECT reverses FROM movements WHERE reverses != '')",
    { inq: -0, outq: -0, n: 0 },
    { i: rec.id, s: u.dayStartTs(u.addDays(u.today(), -USAGE_DAYS)) },
  );
  const lastCountRows = app.findRecordsByFilter('movements', "item = {:i} && kind = 'count'", '-created', 1, 0, { i: rec.id });
  const defLoc = rec.getString('default_location');
  const sup = rec.getString('supplier') !== '' ? u.byId(app, 'suppliers', rec.getString('supplier')) : null;
  return Object.assign(b, {
    description: rec.getString('description'),
    codes: codes,
    stock: stock,
    open_lines: lines,
    recent: recent,
    series: series(app, rec.id, b.on_hand, seriesDays(app, rec.id)),
    in_30d: sums.length > 0 ? u.q3(sums[0].inq) : 0,
    out_30d: sums.length > 0 ? u.q3(sums[0].outq) : 0,
    last_counted: lastCountRows.length > 0 ? lastCountRows[0].getString('created') : null,
    default_location: defLoc !== '' && ix.byId[defLoc] ? { id: defLoc, name: ix.byId[defLoc].name, path: ix.path(defLoc) } : null,
    supplier: sup !== null ? { id: sup.id, name: sup.getString('name'), email: sup.getString('email'), phone: sup.getString('phone') } : null,
    item_lead_time_days: rec.getInt('lead_time_days'),
    created: rec.getString('created'),
    currency: cur,
  });
}

/* ------------------------------------------------------------- writing */

/** Check and fill an item record before it is saved (any writer). */
function checkRecord(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const name = u.squash(rec.getString('name'));
  if (name === '') throw new BadRequestError('An item needs a name');
  rec.set('name', name);
  let sku = String(rec.getString('sku') || '').trim();
  if (sku === '') sku = core.nextNumber(app, 'items', 'sku', 'SKU-', 4);
  if (/\s/.test(sku)) throw new BadRequestError('A SKU cannot contain spaces (got "' + sku + '")');
  rec.set('sku', sku);
  const owner = core.codeOwner(app, sku, rec.id, '');
  if (owner !== null) throw new BadRequestError('The SKU "' + sku + '" is already used by ' + owner.label + '. Every scannable code must be unique.');
  const unit = u.squash(rec.getString('unit'));
  rec.set('unit', unit === '' ? 'pcs' : unit.slice(0, 16));
  const fractional = rec.getBool('fractional');
  const min = u.q3(rec.getFloat('min_qty'));
  const max = u.q3(rec.getFloat('max_qty'));
  if (min < 0 || max < 0) throw new BadRequestError('Reorder point and target level cannot be negative');
  if (!fractional && (!Number.isInteger(min) || !Number.isInteger(max))) {
    throw new BadRequestError('"' + name + '" is counted in whole units, so its reorder point and target level must be whole numbers');
  }
  if (max > 0 && max < min) throw new BadRequestError('The target level (' + max + ') must be at least the reorder point (' + min + ')');
  rec.set('min_qty', min);
  rec.set('max_qty', max);
  if (!fractional && rec.id !== '') {
    const odd = u.rows(app, 'SELECT COUNT(id) AS n FROM stock WHERE item = {:i} AND qty != CAST(qty AS INTEGER)', { n: 0 }, { i: rec.id });
    if (odd.length > 0 && odd[0].n > 0) {
      throw new BadRequestError('"' + name + '" has stock in part units, so it must stay countable in decimals');
    }
  }
}

/** Read the shared item fields from params onto a record. Returns the barcodes to add. */
function applyParams(app, rec, p, creating) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  if (creating || u.has(p, 'name')) rec.set('name', creating ? u.req(p, 'name', '"Packing tape"') : u.str(p, 'name', ''));
  if (u.has(p, 'sku')) rec.set('sku', u.str(p, 'sku', ''));
  if (u.has(p, 'category')) {
    const c = u.str(p, 'category', '');
    rec.set('category', c === '' ? '' : core.category(app, c).id);
  }
  if (u.has(p, 'unit')) rec.set('unit', u.str(p, 'unit', ''));
  if (u.has(p, 'fractional')) rec.set('fractional', u.bool(p, 'fractional', false));
  if (u.has(p, 'description')) rec.set('description', u.str(p, 'description', '').slice(0, 2000));
  const fractional = rec.getBool('fractional');
  const label = '"' + (rec.getString('name') || 'This item') + '"';
  if (u.has(p, 'min_qty')) {
    const v = u.qty(p, 'min_qty', { fractional: fractional, label: label });
    rec.set('min_qty', v === null ? 0 : v);
  }
  if (u.has(p, 'max_qty')) {
    const v = u.qty(p, 'max_qty', { fractional: fractional, label: label });
    rec.set('max_qty', v === null ? 0 : v);
  }
  if (u.has(p, 'unit_cost')) {
    const c = u.cost(p, 'unit_cost');
    rec.set('unit_cost', c === null ? 0 : c);
  }
  if (u.has(p, 'supplier')) {
    const s = u.str(p, 'supplier', '');
    rec.set('supplier', s === '' ? '' : core.supplier(app, s).id);
  }
  if (u.has(p, 'lead_time_days')) rec.set('lead_time_days', u.int(p, 'lead_time_days', 0, 0, 365));
  if (u.has(p, 'default_location')) {
    const l = u.str(p, 'default_location', '');
    rec.set('default_location', l === '' ? '' : core.location(app, l, 'default_location').id);
  }
  if (u.has(p, 'archived')) rec.set('archived', u.bool(p, 'archived', false));
  const barcodes = [];
  const raw = u.has(p, 'barcodes') ? u.list(p, 'barcodes') : u.has(p, 'barcode') && u.str(p, 'barcode', '') !== '' ? [u.str(p, 'barcode', '')] : [];
  for (const b of raw || []) {
    const code = String(b).trim();
    if (code !== '' && barcodes.indexOf(code) < 0) barcodes.push(code);
  }
  return barcodes;
}

function photoFrom(p, ev) {
  const u = require(`${__hooks}/lib_util.js`);
  const up = u.uploaded(ev, 'photo');
  if (up !== null) return up;
  const path = u.str(p, 'photo_path', '');
  if (path !== '') return u.localFile(path, 'photo_path');
  return null;
}

function addCodes(tx, itemId, codes) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const col = tx.findCollectionByNameOrId('codes');
  const done = {};
  for (const code of codes) {
    // A code the item already has (or one given twice) is already there.
    if (done[code.toLowerCase()] || u.rows(tx, 'SELECT id FROM codes WHERE item = {:i} AND lower(code) = lower({:c})', { id: '' }, { i: itemId, c: code }).length > 0) continue;
    done[code.toLowerCase()] = true;
    core.assertCodeFree(tx, code, itemId, '', 'The barcode');
    const c = new Record(col);
    c.set('code', code);
    c.set('item', itemId);
    tx.save(c);
  }
}

/** Create an item, its barcodes and its opening stock in one go. */
function create(app, p, ev, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const rec = new Record(app.findCollectionByNameOrId('items'));
  rec.set('unit', 'pcs');
  rec.set('fractional', false);
  rec.set('min_qty', 0);
  rec.set('max_qty', 0);
  rec.set('unit_cost', 0);
  rec.set('lead_time_days', 0);
  rec.set('archived', false);
  const barcodes = applyParams(app, rec, p, true);
  const photo = photoFrom(p, ev);
  if (photo !== null) rec.set('photo', photo);
  const fractional = rec.getBool('fractional');
  const opening = u.qty(p, 'qty', { fractional: fractional, label: '"' + rec.getString('name') + '"' });
  let where = null;
  if (opening !== null && opening > 0) {
    const l = u.str(p, 'location', '') || rec.getString('default_location');
    if (l === '') throw u.fail(400, 'Say where the opening stock is: location is required when qty is given', 'Add --location "<location name or code>" (locations.list).');
    where = core.location(app, l);
  }
  if (rec.getString('default_location') === '' && where !== null) rec.set('default_location', where.id);
  const openingCost = rec.getInt('unit_cost');
  let id = '';
  app.runInTransaction((tx) => {
    tx.save(rec);
    id = rec.id;
    addCodes(tx, id, barcodes);
    if (where !== null) {
      ledger.post(tx, [{ item: id, location: where.id, qty: opening, kind: 'in', reason: 'opening', unit_cost: openingCost > 0 ? openingCost : undefined }], { actor: actor });
    }
  });
  return get(app, app.findRecordById('items', id));
}

/** Change an item's details (quantities change only through stock operations). */
function update(app, rec, p, ev) {
  const u = require(`${__hooks}/lib_util.js`);
  const barcodes = applyParams(app, rec, p, false);
  const photo = photoFrom(p, ev);
  if (photo !== null) rec.set('photo', photo);
  else if (u.bool(p, 'remove_photo', false)) rec.set('photo', '');
  app.runInTransaction((tx) => {
    tx.save(rec);
    addCodes(tx, rec.id, barcodes);
  });
  return get(app, app.findRecordById('items', rec.id));
}

/** What deleting an item removes, for the confirmation. */
function deletePreview(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const one = (sql) => {
    const r = u.rows(app, sql, { n: -0 }, { i: rec.id });
    return r.length > 0 ? u.q3(r[0].n) : 0;
  };
  return {
    item: { id: rec.id, name: rec.getString('name'), sku: rec.getString('sku') },
    on_hand: one('SELECT IFNULL(SUM(qty), 0) AS n FROM stock WHERE item = {:i}'),
    places: one('SELECT COUNT(id) AS n FROM stock WHERE item = {:i} AND qty != 0'),
    history_entries: one('SELECT COUNT(id) AS n FROM movements WHERE item = {:i}'),
    order_lines: one('SELECT COUNT(id) AS n FROM order_lines WHERE item = {:i}'),
    barcodes: one('SELECT COUNT(id) AS n FROM codes WHERE item = {:i}'),
  };
}

module.exports = {
  USAGE_DAYS: USAGE_DAYS,
  photoUrl: photoUrl,
  categoryMap: categoryMap,
  tiny: tiny,
  status: status,
  suggestion: suggestion,
  context: context,
  brief: brief,
  list: list,
  series: series,
  get: get,
  checkRecord: checkRecord,
  applyParams: applyParams,
  addCodes: addCodes,
  create: create,
  update: update,
  deletePreview: deletePreview,
};
