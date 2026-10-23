/// <reference path="../pb_data/types.d.ts" />
/**
 * Document types, line resolution and totals (shared by lib_docs.js).
 *
 * A line is { item, description, qty, unit, unit_price (e4, document
 * currency), discount_bp, tax, account, project, department, source_line }.
 * Amounts are computed exactly (lib_money.line) in the document currency and
 * converted to the base currency per line, so a journal built from the
 * lines always balances.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

const TYPES = {
  quote: { side: 'sales', series: 'quote', numberAt: 'create', label: 'Quote', priced: true, posts: false },
  sales_order: { side: 'sales', series: 'sales_order', numberAt: 'create', label: 'Sales order', priced: true, posts: false },
  delivery: { side: 'sales', series: 'delivery', numberAt: 'create', label: 'Delivery', priced: false, posts: true },
  invoice: { side: 'sales', series: 'invoice', numberAt: 'post', label: 'Invoice', priced: true, posts: true, money: true },
  credit_note: { side: 'sales', series: 'credit_note', numberAt: 'post', label: 'Credit note', priced: true, posts: true, money: true },
  purchase_order: { side: 'purchase', series: 'purchase_order', numberAt: 'create', label: 'Purchase order', priced: true, posts: false },
  goods_receipt: { side: 'purchase', series: 'goods_receipt', numberAt: 'create', label: 'Goods receipt', priced: true, posts: true },
  bill: { side: 'purchase', series: 'bill', numberAt: 'post', label: 'Bill', priced: true, posts: true, money: true },
  supplier_credit: { side: 'purchase', series: 'supplier_credit', numberAt: 'post', label: 'Supplier credit', priced: true, posts: true, money: true },
};

const TYPE_NAMES = Object.keys(TYPES);

/** What each type may become (docs.convert). */
const CONVERT = {
  quote: ['sales_order', 'invoice'],
  sales_order: ['delivery', 'invoice'],
  delivery: ['invoice'],
  invoice: ['credit_note'],
  credit_note: [],
  purchase_order: ['goods_receipt', 'bill'],
  goods_receipt: ['bill'],
  bill: ['supplier_credit'],
  supplier_credit: [],
};

function type(name) {
  const t = TYPES[name];
  if (t === undefined) throw u().fail(400, 'type must be one of: ' + TYPE_NAMES.join(', '), 'invalid_param');
  return t;
}

/* ------------------------------------------------------------ helpers */

function itemCache() {
  return {};
}

function itemOf(app, id, cache) {
  if (!id) return null;
  if (cache && cache[id] !== undefined) return cache[id];
  const rec = u().byId(app, 'items', id);
  if (cache) cache[id] = rec;
  return rec;
}

function taxOf(app, id, cache) {
  if (!id) return null;
  const key = 'tax:' + id;
  if (cache && cache[key] !== undefined) return cache[key];
  const rec = u().byId(app, 'taxes', id);
  if (cache) cache[key] = rec;
  return rec;
}

/** The default tax for a line: item, then party, then settings. '' when none. */
function defaultTax(app, side, item, party) {
  const core = require(`${__hooks}/lib_core.js`);
  const field = side === 'sales' ? 'sale_tax' : 'purchase_tax';
  if (item !== null && item.getString(field) !== '') return item.getString(field);
  if (party !== null && party.getString(field) !== '') return party.getString(field);
  const d = core.defaults(app);
  const key = side === 'sales' ? 'sale_tax' : 'purchase_tax';
  return typeof d[key] === 'string' ? d[key] : '';
}

/** Resolve the tax a line names: '' default, 'none' no tax, else a tax ref. */
function resolveTax(app, side, ref, item, party) {
  const util = u();
  const core = require(`${__hooks}/lib_core.js`);
  const r = String(ref === undefined || ref === null ? '' : ref).trim();
  if (r.toLowerCase() === 'none') return null;
  const id = r === '' ? defaultTax(app, side, item, party) : core.resolve(app, 'taxes', r).id;
  if (id === '') return null;
  const t = util.byId(app, 'taxes', id);
  if (t === null) return null;
  const scope = t.getString('scope');
  if (scope !== 'both' && scope !== side) {
    if (r === '') return null; // a default of the wrong side is simply not applied
    throw util.fail(400, 'The tax ' + t.getString('name') + ' is for ' + scope + ', not ' + side + '.', 'invalid_tax');
  }
  if (t.getBool('archived') && r === '') return null;
  return t;
}

/** The account a line posts to (income for sales, expense or asset for purchases). */
function lineAccount(app, side, line, item) {
  const core = require(`${__hooks}/lib_core.js`);
  const util = u();
  if (line.account) return line.account;
  if (item !== null) {
    const field = side === 'sales' ? 'income_account' : 'expense_account';
    if (item.getString(field) !== '') return item.getString(field);
    const cat = util.byId(app, 'item_categories', item.getString('category'));
    if (cat !== null && cat.getString(field) !== '') return cat.getString(field);
    if (side === 'sales') return core.systemAccount(app, item.getString('kind') === 'service' ? 'service_revenue' : 'sales').id;
    if (item.getString('kind') === 'stock') return core.systemAccount(app, 'inventory').id;
    return core.systemAccount(app, 'general_expense').id;
  }
  return core.systemAccount(app, side === 'sales' ? 'sales' : 'general_expense').id;
}

/** Cost of goods sold account of a stock item. */
function cogsAccount(app, item) {
  const util = u();
  if (item.getString('expense_account') !== '') {
    const acc = util.byId(app, 'accounts', item.getString('expense_account'));
    if (acc !== null && acc.getString('type') === 'expense') return acc.id;
  }
  const cat = util.byId(app, 'item_categories', item.getString('category'));
  if (cat !== null && cat.getString('expense_account') !== '') {
    const acc = util.byId(app, 'accounts', cat.getString('expense_account'));
    if (acc !== null && acc.getString('type') === 'expense') return acc.id;
  }
  return require(`${__hooks}/lib_core.js`).systemAccount(app, 'cogs').id;
}

/* -------------------------------------------------- reading line input */

/**
 * Turn one line of input into the stored shape (no amounts yet).
 *   raw: { id, item, description, qty, unit, unit_price, discount, tax,
 *          account, project, department, source_line }
 */
const LINE_KEYS = ['id', 'item', 'description', 'qty', 'unit', 'unit_price', 'unit_price_e4', 'discount', 'discount_bp', 'tax', 'account', 'project', 'department', 'source_line'];

function readLine(app, docType, raw, party, idx, cache) {
  const util = u();
  if (raw === null || typeof raw !== 'object') throw util.fail(400, 'Line ' + (idx + 1) + ' must be an object like {"item":"SKU-00001","qty":2}', 'invalid_param');
  util.keysOnly(raw, LINE_KEYS, 'Line ' + (idx + 1));
  try {
    return readLineChecked(app, docType, raw, party, idx, cache);
  } catch (err) {
    // Every error names its line ("Line 2: No item ..."), whichever helper raised it.
    if (err && typeof err.message === 'string' && err.message.indexOf('Line ') !== 0 && util.statusOf(err) < 500) {
      try {
        err.message = 'Line ' + (idx + 1) + ': ' + err.message;
      } catch {
        /* an engine error keeps its own text */
      }
    }
    throw err;
  }
}

function readLineChecked(app, docType, raw, party, idx, cache) {
  const util = u();
  const core = require(`${__hooks}/lib_core.js`);
  const t = type(docType);
  const where = 'Line ' + (idx + 1) + ': ';
  let item = null;
  const itemRef = raw.item === undefined || raw.item === null ? '' : String(raw.item).trim();
  if (itemRef !== '') {
    item = core.resolve(app, 'items', itemRef);
    if (cache) cache[item.id] = item;
  }
  if (!t.priced || docType === 'goods_receipt' || docType === 'delivery') {
    if (item === null && (docType === 'delivery' || docType === 'goods_receipt')) throw util.fail(400, where + 'a ' + t.label.toLowerCase() + ' line needs an item.', 'invalid_param');
    if (item !== null && item.getString('kind') === 'service' && (docType === 'delivery' || docType === 'goods_receipt')) {
      throw util.fail(400, where + item.getString('name') + ' is a service; services are not delivered or received.', 'invalid_param');
    }
  }
  const qty = util.qtyOf(raw.qty, 'qty', { required: true, positive: true, whole: item !== null && item.getString('kind') === 'stock' && !item.getBool('fractional'), label: item ? item.getString('name') : undefined });
  let description = raw.description === undefined || raw.description === null ? '' : String(raw.description).trim();
  if (description.length > 1000) throw util.fail(400, where + 'the description is too long.', 'invalid_param');
  if (description === '') description = item !== null ? item.getString('name') : '';
  if (description === '' && item === null) throw util.fail(400, where + 'give an item or a description.', 'invalid_param');
  let unitPrice = 0;
  const priceRaw = raw.unit_price === undefined || raw.unit_price === null ? '' : String(raw.unit_price).trim();
  if (priceRaw !== '') {
    const v = require(`${__hooks}/lib_money.js`).toE4(priceRaw, false);
    if (v === null) throw util.fail(400, where + 'unit_price must be a plain positive number like 12.50 (got "' + priceRaw + '")', 'invalid_amount');
    unitPrice = v;
  } else if (item !== null) {
    unitPrice = t.side === 'sales' ? item.getInt('sale_price') : item.getInt('purchase_price');
  }
  let discountBp = 0;
  const discRaw = raw.discount === undefined || raw.discount === null ? '' : String(raw.discount).trim();
  if (discRaw !== '') {
    const v = require(`${__hooks}/lib_money.js`).percentToBp(discRaw);
    if (v === null || v > 10000) throw util.fail(400, where + 'discount must be a percentage from 0 to 100, e.g. 10', 'invalid_param');
    discountBp = v;
  }
  if (raw.discount_bp !== undefined && raw.discount_bp !== null && raw.discount_bp !== '') discountBp = Math.max(0, Math.min(10000, Math.round(Number(raw.discount_bp))));
  if (raw.unit_price_e4 !== undefined && raw.unit_price_e4 !== null && raw.unit_price_e4 !== '' && priceRaw === '') unitPrice = Math.max(0, Math.round(Number(raw.unit_price_e4)));
  const tax = t.priced && docType !== 'goods_receipt' ? resolveTax(app, t.side, raw.tax, item, party) : null;
  let account = '';
  const accRef = raw.account === undefined || raw.account === null ? '' : String(raw.account).trim();
  if (accRef !== '') {
    const acc = core.resolve(app, 'accounts', accRef);
    if (acc.getBool('control')) throw util.fail(400, where + acc.getString('name') + ' is a control account; choose an income or expense account.', 'control_account');
    const okTypes = t.side === 'sales' ? ['income'] : ['expense', 'asset'];
    if (okTypes.indexOf(acc.getString('type')) < 0) throw util.fail(400, where + acc.getString('code') + ' ' + acc.getString('name') + ' is a ' + acc.getString('type') + ' account; use ' + okTypes.join(' or ') + ' accounts here.', 'invalid_account');
    account = acc.id;
  }
  const project = core.resolveOpt(app, 'projects', raw.project);
  const department = core.resolveOpt(app, 'departments', raw.department);
  const unit = raw.unit !== undefined && raw.unit !== null && String(raw.unit).trim() !== '' ? String(raw.unit).trim().slice(0, 20) : item !== null ? item.getString('unit') : '';
  return {
    id: raw.id ? String(raw.id) : '',
    item: item !== null ? item.id : '',
    description: description,
    qty: qty,
    unit: unit,
    unit_price: unitPrice,
    discount_bp: discountBp,
    tax: tax !== null ? tax.id : '',
    tax_rate_bp: tax !== null ? tax.getInt('rate_bp') : 0,
    account: account,
    project: project !== null ? project.id : '',
    department: department !== null ? department.id : '',
    source_line: raw.source_line ? String(raw.source_line) : '',
  };
}

/** Amounts of a stored-shape line in the document currency and in base. */
function amounts(line, doc, base) {
  const money = require(`${__hooks}/lib_money.js`);
  const cur = doc.getString('currency') || base;
  const fx = doc.getInt('fx_e8') || money.E8;
  const r = money.line(line.qty, line.unit_price, line.discount_bp, line.tax_rate_bp, doc.getBool('prices_include_tax'), cur);
  const netBase = money.convert(r.net, cur, base, fx);
  const taxBase = money.convert(r.tax, cur, base, fx);
  return { gross: r.gross, discount: r.discount, net: r.net, tax: r.tax, total: r.total, net_base: netBase, tax_base: taxBase };
}

/** Write amounts onto a line record and return them. */
function priceLine(rec, doc, base) {
  const line = {
    qty: rec.getFloat('qty'),
    unit_price: rec.getInt('unit_price'),
    discount_bp: rec.getInt('discount_bp'),
    tax_rate_bp: rec.getInt('tax_rate_bp'),
  };
  const a = amounts(line, doc, base);
  rec.set('net', a.net);
  rec.set('tax_amount', a.tax);
  rec.set('total', a.total);
  rec.set('net_base', a.net_base);
  rec.set('tax_base', a.tax_base);
  return a;
}

/** Recompute a document's totals from its lines (in the caller's handle). */
function retotal(tx, doc) {
  const core = require(`${__hooks}/lib_core.js`);
  const base = core.currency(tx);
  const lines = tx.findRecordsByFilter('document_lines', 'doc = {:d}', 'sort', 0, 0, { d: doc.id });
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  let totalBase = 0;
  for (const l of lines) {
    const a = priceLine(l, doc, base);
    tx.save(l);
    subtotal += a.net;
    discount += a.discount;
    tax += a.tax;
    total += a.total;
    totalBase += a.net_base + a.tax_base;
  }
  doc.set('subtotal', subtotal);
  doc.set('discount', discount);
  doc.set('tax', tax);
  doc.set('total', total);
  doc.set('total_base', totalBase);
  doc.set('lines_count', lines.length);
  if (doc.getString('state') === 'draft' || !TYPES[doc.getString('type')].money) {
    doc.set('balance', TYPES[doc.getString('type')].money ? total - doc.getInt('paid') : 0);
  }
  return lines;
}

/** Store a line (create or update) from the read shape. */
function saveLine(tx, doc, shape, sort, existing) {
  const util = u();
  const rec = existing || util.newRecord(tx, 'document_lines');
  rec.set('doc', doc.id);
  rec.set('sort', sort);
  rec.set('item', shape.item);
  rec.set('description', shape.description);
  rec.set('qty', shape.qty);
  rec.set('unit', shape.unit);
  rec.set('unit_price', shape.unit_price);
  rec.set('discount_bp', shape.discount_bp);
  rec.set('tax', shape.tax);
  rec.set('tax_rate_bp', shape.tax_rate_bp);
  rec.set('account', shape.account);
  rec.set('project', shape.project);
  rec.set('department', shape.department);
  if (existing === undefined || existing === null) {
    rec.set('source_line', shape.source_line);
    rec.set('qty_fulfilled', 0);
    rec.set('qty_invoiced', 0);
    rec.set('recv_value', 0);
    rec.set('cleared_value', 0);
    rec.set('cost_value', 0);
    rec.set('unit_cost', 0);
  }
  tx.save(rec);
  return rec;
}

module.exports = {
  TYPES: TYPES,
  TYPE_NAMES: TYPE_NAMES,
  CONVERT: CONVERT,
  type: type,
  itemCache: itemCache,
  itemOf: itemOf,
  taxOf: taxOf,
  defaultTax: defaultTax,
  resolveTax: resolveTax,
  lineAccount: lineAccount,
  cogsAccount: cogsAccount,
  readLine: readLine,
  amounts: amounts,
  priceLine: priceLine,
  retotal: retotal,
  saveLine: saveLine,
};
