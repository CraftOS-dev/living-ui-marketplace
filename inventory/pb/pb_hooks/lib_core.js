/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared pieces: the settings row, money, document numbers, and resolving
 * what a caller names (an id, a SKU, a barcode, a code or an exact name)
 * into the record it means.
 *
 * Every scannable code in the app is unique across items and locations: an
 * item's SKU, an item's extra barcodes (`codes`) and a location's code can
 * never collide, so one scan always means one thing.
 */

/* -------------------------------------------------------------- settings */

function settings(app) {
  const rows = app.findRecordsByFilter('settings', '', 'created', 1, 0);
  if (rows.length === 0) throw new Error('The settings row is missing');
  return rows[0];
}

// Currencies whose minor unit is not 1/100 (ISO 4217). Everything else: 2.
const EXPONENT = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

function exponent(code) {
  const c = String(code || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(EXPONENT, c) ? EXPONENT[c] : 2;
}

function isCurrency(code) {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

function currency(app) {
  return settings(app).getString('currency');
}

/** A cost in ten-thousandths as plain major-unit text ("4.25", "0.034"). */
function costText(e4, code) {
  return require(`${__hooks}/lib_util.js`).e4ToText(e4, exponent(code));
}

/** An amount (stock value, a total) in ten-thousandths -> plain text in the currency's own decimals ("87.93"). */
function moneyText(e4, code) {
  const step = Math.pow(10, 4 - exponent(code));
  const minor = Math.sign(e4) * Math.round(Math.abs(e4) / step);
  return require(`${__hooks}/lib_util.js`).e4ToText(minor * step, exponent(code));
}

/* --------------------------------------------------------------- numbers */

/** The next free document number: PO-0001, C-0001, SKU-0001, LOC-001. */
function nextNumber(app, collection, field, prefix, width) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.rows(
    app,
    'SELECT IFNULL(MAX(CAST(SUBSTR([[' + field + ']], {:from}) AS INTEGER)), 0) AS n FROM {{' + collection + '}} WHERE [[' + field + ']] LIKE {:like}',
    { n: 0 },
    { from: prefix.length + 1, like: prefix + '%' },
  );
  const n = (r.length > 0 ? Number(r[0].n) || 0 : 0) + 1;
  return prefix + u.lpad(String(n), width, '0');
}

/* ----------------------------------------------------------------- codes */

/**
 * Who already uses `code` as a scannable code, ignoring the given item or
 * location. null when it is free. Compared without case.
 */
function codeOwner(app, code, exceptItem, exceptLocation) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = String(code || '').trim();
  if (c === '') return null;
  const hit = u.rows(
    app,
    "SELECT 'code' AS via, item AS id FROM codes WHERE LOWER(code) = LOWER({:c}) AND item != {:xi} " +
      "UNION ALL SELECT 'sku' AS via, id FROM items WHERE LOWER(sku) = LOWER({:c}) AND id != {:xi} " +
      "UNION ALL SELECT 'location' AS via, id FROM locations WHERE LOWER(code) = LOWER({:c}) AND id != {:xl} LIMIT 1",
    { via: '', id: '' },
    { c: c, xi: exceptItem || '', xl: exceptLocation || '' },
  );
  if (hit.length === 0) return null;
  const h = hit[0];
  if (h.via === 'location') {
    const loc = u.byId(app, 'locations', h.id);
    return { type: 'location', id: h.id, label: 'the location "' + (loc ? loc.getString('name') : h.id) + '"' };
  }
  const item = u.byId(app, 'items', h.id);
  return { type: 'item', id: h.id, label: 'the item "' + (item ? item.getString('name') : h.id) + '"' };
}

/** Throw a 400 when `code` already belongs to something else. */
function assertCodeFree(app, code, exceptItem, exceptLocation, what) {
  const owner = codeOwner(app, code, exceptItem, exceptLocation);
  if (owner !== null) {
    const u = require(`${__hooks}/lib_util.js`);
    throw u.fail(400, (what || 'The code') + ' "' + code + '" is already used by ' + owner.label + '. Every scannable code must be unique.');
  }
}

/** What a scanned or typed code points at: an item, a location, or null. */
function lookupCode(app, code) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = String(code || '').trim();
  if (c === '') return null;
  const viaCode = u.findOne(app, 'codes', 'code = {:c}', { c: c });
  if (viaCode !== null) {
    const item = u.byId(app, 'items', viaCode.getString('item'));
    if (item !== null) return { type: 'item', record: item, via: 'barcode' };
  }
  const hit = u.rows(
    app,
    "SELECT 'code' AS via, item AS id FROM codes WHERE LOWER(code) = LOWER({:c}) " +
      "UNION ALL SELECT 'sku' AS via, id FROM items WHERE LOWER(sku) = LOWER({:c}) " +
      "UNION ALL SELECT 'location' AS via, id FROM locations WHERE LOWER(code) = LOWER({:c}) LIMIT 1",
    { via: '', id: '' },
    { c: c },
  );
  if (hit.length === 0) return null;
  const h = hit[0];
  if (h.via === 'location') {
    const loc = u.byId(app, 'locations', h.id);
    return loc === null ? null : { type: 'location', record: loc, via: 'location code' };
  }
  const item = u.byId(app, 'items', h.id);
  return item === null ? null : { type: 'item', record: item, via: h.via === 'sku' ? 'sku' : 'barcode' };
}

/* ------------------------------------------------------------- resolving */

function looksLikeId(v) {
  return /^[a-z0-9]{15}$/.test(v);
}

/** An item from its id, SKU, barcode or exact name. */
function item(app, value, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const name = param || 'item';
  const v = String(value || '').trim();
  if (v === '') throw u.fail(400, name + ' is required (an item id, SKU, barcode or exact name)');
  if (looksLikeId(v)) {
    const byId = u.byId(app, 'items', v);
    if (byId !== null) return byId;
  }
  const bySku = u.idsNocase(app, 'items', 'sku', v, 1);
  if (bySku.length > 0) return u.byId(app, 'items', bySku[0]);
  const codeIds = u.idsNocase(app, 'codes', 'code', v, 1);
  const viaCode = codeIds.length > 0 ? u.byId(app, 'codes', codeIds[0]) : null;
  if (viaCode !== null) {
    const it = u.byId(app, 'items', viaCode.getString('item'));
    if (it !== null) return it;
  }
  const byName = u.idsNocase(app, 'items', 'name', u.squash(v), 3).map((id) => u.byId(app, 'items', id));
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw u.fail(400, 'More than one item is called "' + v + '"; use its SKU: ' + byName.map((r) => r.getString('sku')).join(', '));
  }
  throw u.fail(404, 'No item "' + v + '" (looked for an id, SKU, barcode and exact name).', 'Find it with items.list --q "' + v + '".');
}

/** A location from its id, code, exact name, or path ("Main stockroom / Shelf A"). */
function location(app, value, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const name = param || 'location';
  const v = String(value || '').trim();
  if (v === '') throw u.fail(400, name + ' is required (a location id, code or name)');
  if (looksLikeId(v)) {
    const byId = u.byId(app, 'locations', v);
    if (byId !== null) return byId;
  }
  const byCode = u.idsNocase(app, 'locations', 'code', v, 1);
  if (byCode.length > 0) return u.byId(app, 'locations', byCode[0]);
  const byName = u.idsNocase(app, 'locations', 'name', u.squash(v), 5).map((id) => u.byId(app, 'locations', id));
  if (byName.length === 1) return byName[0];
  const locs = require(`${__hooks}/lib_locations.js`);
  const all = locs.index(app);
  const wanted = u.squash(v).toLowerCase().split(/\s*\/\s*/).join(' / ');
  const byPath = all.list.filter((l) => all.path(l.id).toLowerCase() === wanted);
  if (byPath.length === 1) return u.byId(app, 'locations', byPath[0].id);
  if (byName.length > 1) {
    throw u.fail(
      400,
      'More than one location is called "' + v + '"; use its code or path: ' + byName.map((r) => r.getString('code') + ' (' + all.path(r.id) + ')').join(', '),
    );
  }
  throw u.fail(404, 'No location "' + v + '".', 'List them with locations.list.');
}

function category(app, value, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const v = String(value || '').trim();
  if (looksLikeId(v)) {
    const byId = u.byId(app, 'categories', v);
    if (byId !== null) return byId;
  }
  const byName = u.idsNocase(app, 'categories', 'name', u.squash(v), 1);
  if (byName.length > 0) return u.byId(app, 'categories', byName[0]);
  const names = app.findRecordsByFilter('categories', '', 'sort,name', 0, 0).map((r) => r.getString('name'));
  throw u.fail(400, 'No category "' + v + '" for ' + (param || 'category') + '. Categories: ' + names.join(', '));
}

function supplier(app, value, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const v = String(value || '').trim();
  if (looksLikeId(v)) {
    const byId = u.byId(app, 'suppliers', v);
    if (byId !== null) return byId;
  }
  const byName = u.idsNocase(app, 'suppliers', 'name', u.squash(v), 1);
  if (byName.length > 0) return u.byId(app, 'suppliers', byName[0]);
  throw u.fail(404, 'No supplier "' + v + '" for ' + (param || 'supplier') + '.', 'List them with suppliers.list, or add one with suppliers.add --name "' + v + '".');
}

function order(app, value, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const v = String(value || '').trim();
  if (v === '') throw u.fail(400, (param || 'order') + ' is required (an order id or number like PO-0001)');
  if (looksLikeId(v)) {
    const byId = u.byId(app, 'orders', v);
    if (byId !== null) return byId;
  }
  const byNumber = u.findOne(app, 'orders', 'number = {:v}', { v: v.toUpperCase() });
  if (byNumber !== null) return byNumber;
  throw u.fail(404, 'No purchase order "' + v + '".', 'List them with orders.list.');
}

function count(app, value, param) {
  const u = require(`${__hooks}/lib_util.js`);
  const v = String(value || '').trim();
  if (v === '') throw u.fail(400, (param || 'count') + ' is required (a count id or number like C-0001)');
  if (looksLikeId(v)) {
    const byId = u.byId(app, 'counts', v);
    if (byId !== null) return byId;
  }
  const byNumber = u.findOne(app, 'counts', 'number = {:v}', { v: v.toUpperCase() });
  if (byNumber !== null) return byNumber;
  throw u.fail(404, 'No stock count "' + v + '".', 'List them with counts.list.');
}

module.exports = {
  settings: settings,
  exponent: exponent,
  isCurrency: isCurrency,
  currency: currency,
  costText: costText,
  moneyText: moneyText,
  nextNumber: nextNumber,
  codeOwner: codeOwner,
  assertCodeFree: assertCodeFree,
  lookupCode: lookupCode,
  looksLikeId: looksLikeId,
  item: item,
  location: location,
  category: category,
  supplier: supplier,
  order: order,
  count: count,
};
