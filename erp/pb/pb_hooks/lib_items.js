/// <reference path="../pb_data/types.d.ts" />
/**
 * The catalog (items, categories, warehouses), stock levels and history,
 * stock changes (adjust, count, transfer) and reorder suggestions.
 *
 * Quantities never change by editing a record: every change is a stock
 * move (lib_stock.js), and a change that alters value posts its journal
 * entry in the same transaction.
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
function core() {
  return mod('lib_core');
}
function money() {
  return mod('lib_money');
}
function auth() {
  return mod('lib_auth');
}

const ICONS = [
  'package', 'box', 'boxes', 'briefcase', 'shirt', 'coffee', 'utensils', 'apple', 'wrench', 'hammer', 'cpu', 'monitor', 'smartphone',
  'cable', 'plug', 'lightbulb', 'paintbrush', 'scissors', 'book', 'pencil', 'printer', 'sofa', 'car', 'truck', 'bike', 'pill',
  'heart-pulse', 'flask-conical', 'leaf', 'flower', 'gem', 'watch', 'camera', 'headphones', 'gamepad', 'gift', 'shopping-bag',
  'tag', 'tags', 'layers', 'cog', 'droplet', 'flame', 'snowflake', 'sparkles', 'shield', 'graduation-cap', 'music', 'baby', 'dog',
];

function canSeeItems(ctx) {
  return ctx.isAgent || auth().can(ctx, 'inventory', 'view') || auth().can(ctx, 'sales', 'view') || auth().can(ctx, 'purchasing', 'view') || auth().can(ctx, 'manufacturing', 'view');
}

function needSee(ctx) {
  if (!canSeeItems(ctx)) throw u().fail(403, 'Your role cannot see items (needs Inventory, Sales or Purchasing).', 'not_permitted');
}

function needCatalog(ctx) {
  if (ctx.isAgent) return;
  if (auth().can(ctx, 'inventory', 'edit') || auth().can(ctx, 'sales', 'edit') || auth().can(ctx, 'purchasing', 'edit') || auth().can(ctx, 'manufacturing', 'edit')) return;
  throw u().fail(403, 'Your role cannot change items (needs edit access to Inventory, Sales or Purchasing).', 'not_permitted');
}

/* =============================================================== items */

/**
 * What open purchase orders bring in and open sales orders take out, per
 * item, in one pass over the OPEN orders only (closed history is never read).
 */
const OPEN_ORDERS_SQL =
  "SELECT dl.item AS item, SUM(CASE WHEN d.type = 'purchase_order' THEN dl.qty - dl.qty_fulfilled ELSE 0 END) AS incoming, SUM(CASE WHEN d.type = 'sales_order' THEN dl.qty - dl.qty_fulfilled ELSE 0 END) AS committed " +
  "FROM documents d JOIN document_lines dl ON dl.doc = d.id WHERE d.state = 'open' AND d.type IN ('purchase_order', 'sales_order') AND dl.item != '' GROUP BY dl.item";

const ITEM_SQL =
  "SELECT i.id AS id, i.sku AS sku, i.name AS name, i.kind AS kind, i.unit AS unit, i.fractional AS fractional, i.barcode AS barcode, i.sale_price AS sale_price, i.purchase_price AS purchase_price, i.min_qty AS min_qty, i.max_qty AS max_qty, i.archived AS archived, i.photo AS photo, i.category AS category, IFNULL(c.name, '') AS category_name, IFNULL(c.icon, '') AS icon, i.supplier AS supplier, IFNULL(sp.name, '') AS supplier_name, " +
  'IFNULL(v.qty, 0) AS on_hand, IFNULL(v.value, 0) AS value, IFNULL(v.last_cost, 0) AS last_cost, IFNULL(oo.incoming, 0) AS incoming, IFNULL(oo.committed, 0) AS committed ' +
  'FROM items i LEFT JOIN item_categories c ON c.id = i.category LEFT JOIN parties sp ON sp.id = i.supplier LEFT JOIN valuation v ON v.item = i.id LEFT JOIN (' +
  OPEN_ORDERS_SQL +
  ') oo ON oo.item = i.id';

/** Status counts over active stock items, in one aggregate (the same rules as statusOf). */
const STATUS_COUNTS_SQL =
  'SELECT COUNT(*) AS n, ' +
  'IFNULL(SUM(CASE WHEN x.on_hand <= 0 THEN 1 ELSE 0 END), 0) AS out_n, ' +
  'IFNULL(SUM(CASE WHEN x.on_hand > 0 AND x.min_qty > 0 AND x.on_hand <= x.min_qty THEN 1 ELSE 0 END), 0) AS low_n, ' +
  'IFNULL(SUM(CASE WHEN x.on_hand > 0 AND NOT (x.min_qty > 0 AND x.on_hand <= x.min_qty) AND x.max_qty > 0 AND x.max_qty > x.min_qty AND x.on_hand > x.max_qty THEN 1 ELSE 0 END), 0) AS over_n, ' +
  'IFNULL(SUM(CASE WHEN x.min_qty > 0 AND (x.on_hand + x.incoming - x.committed) <= x.min_qty THEN 1 ELSE 0 END), 0) AS reorder_n ' +
  'FROM (SELECT i.min_qty AS min_qty, i.max_qty AS max_qty, IFNULL(v.qty, 0) AS on_hand, IFNULL(oo.incoming, 0) AS incoming, IFNULL(oo.committed, 0) AS committed FROM items i LEFT JOIN valuation v ON v.item = i.id LEFT JOIN (' +
  OPEN_ORDERS_SQL +
  ") oo ON oo.item = i.id WHERE i.archived = FALSE AND i.kind = 'stock') x";

const ITEM_SHAPE = {
  id: '', sku: '', name: '', kind: '', unit: '', fractional: false, barcode: '', sale_price: 0, purchase_price: 0, min_qty: -0, max_qty: -0, archived: false, photo: '', category: '', category_name: '', icon: '', supplier: '', supplier_name: '',
  on_hand: -0, value: 0, last_cost: 0, incoming: -0, committed: -0,
};

function statusOf(r) {
  if (r.kind !== 'stock') return 'na';
  if (r.on_hand <= 0) return 'out';
  if (r.min_qty > 0 && r.on_hand <= r.min_qty) return 'low';
  if (r.max_qty > 0 && r.max_qty > r.min_qty && r.on_hand > r.max_qty) return 'over';
  return 'ok';
}

function rowOut(r, cur) {
  const util = u();
  const m = money();
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    kind: r.kind,
    unit: r.unit,
    fractional: r.fractional,
    barcode: r.barcode,
    sale_price: m.e4Text(r.sale_price, cur),
    sale_price_e4: r.sale_price,
    purchase_price: m.e4Text(r.purchase_price, cur),
    purchase_price_e4: r.purchase_price,
    min_qty: util.q3(r.min_qty),
    max_qty: util.q3(r.max_qty),
    archived: r.archived,
    photo: r.photo !== '' ? '/api/files/items/' + r.id + '/' + r.photo : '',
    category: r.category !== '' ? { id: r.category, name: r.category_name, icon: r.icon || 'package' } : null,
    supplier: r.supplier !== '' ? { id: r.supplier, name: r.supplier_name } : null,
    on_hand: util.q3(r.on_hand),
    value: r.value,
    avg_cost: r.on_hand > 0 ? m.e4Text(m.unitCostE4(r.value, r.on_hand, cur), cur) : m.e4Text(r.last_cost, cur),
    incoming: util.q3(r.incoming),
    committed: util.q3(r.committed),
    available: util.q3(r.on_hand - r.committed),
    status: statusOf(r),
  };
}

function list(ctx, p) {
  const util = u();
  needSee(ctx);
  const app = ctx.app;
  const cur = core().currency(app);
  const pg = util.page(p, 60, 1000);
  const where = ['1 = 1'];
  const bind = {};
  const kind = util.oneOf(p, 'kind', ['stock', 'service', 'non_stock'], '');
  if (kind !== '') {
    where.push('i.kind = {:kind}');
    bind.kind = kind;
  }
  const archived = util.oneOf(p, 'archived', ['active', 'archived', 'all'], 'active');
  if (archived === 'active') where.push('i.archived = FALSE');
  if (archived === 'archived') where.push('i.archived = TRUE');
  const cat = util.str(p, 'category', '');
  if (cat !== '') {
    where.push('i.category = {:cat}');
    bind.cat = core().resolve(app, 'item_categories', cat).id;
  }
  const sup = util.str(p, 'supplier', '');
  if (sup !== '') {
    where.push('i.supplier = {:sup}');
    bind.sup = core().resolve(app, 'parties', sup).id;
  }
  const wh = util.str(p, 'warehouse', '');
  if (wh !== '') {
    where.push('i.id IN (SELECT item FROM stock WHERE warehouse = {:wh} AND qty != 0)');
    bind.wh = core().resolve(app, 'warehouses', wh).id;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(i.name LIKE {:q} ESCAPE '\\' OR i.sku LIKE {:q} ESCAPE '\\' OR i.barcode = {:raw} OR i.description LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
    bind.raw = q;
  }
  const status = util.oneOf(p, 'status', ['ok', 'low', 'out', 'over', 'reorder'], '');
  const outer = [];
  if (status === 'out') outer.push("x.kind = 'stock' AND x.on_hand <= 0");
  if (status === 'low') outer.push("x.kind = 'stock' AND x.on_hand > 0 AND x.min_qty > 0 AND x.on_hand <= x.min_qty");
  if (status === 'over') outer.push("x.kind = 'stock' AND x.max_qty > 0 AND x.max_qty > x.min_qty AND x.on_hand > x.max_qty");
  if (status === 'ok') outer.push("x.kind = 'stock' AND x.on_hand > 0 AND NOT (x.min_qty > 0 AND x.on_hand <= x.min_qty) AND NOT (x.max_qty > 0 AND x.max_qty > x.min_qty AND x.on_hand > x.max_qty)");
  if (status === 'reorder') outer.push("x.kind = 'stock' AND x.min_qty > 0 AND (x.on_hand + x.incoming - x.committed) <= x.min_qty");
  const sorts = { name: 'x.name COLLATE NOCASE', sku: 'x.sku', on_hand: 'x.on_hand', value: 'x.value', price: 'x.sale_price', updated: 'x.id' };
  const sortKey = util.oneOf(p, 'sort', Object.keys(sorts), 'name');
  const desc = util.bool(p, 'desc', sortKey === 'value' || sortKey === 'on_hand');
  const inner = ITEM_SQL + ' WHERE ' + where.join(' AND ');
  const wrap = 'SELECT * FROM (' + inner + ') x' + (outer.length > 0 ? ' WHERE ' + outer.join(' AND ') : '');
  const total = util.one(app, 'SELECT COUNT(*) AS n, IFNULL(SUM(value), 0) AS v FROM (' + wrap + ')', { n: 0, v: 0 }, bind);
  const rows = util.rows(app, wrap + ' ORDER BY ' + sorts[sortKey] + (desc ? ' DESC' : ' ASC') + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, ITEM_SHAPE, bind);
  // Status counts over active stock items, in one aggregate.
  const sc = util.one(app, STATUS_COUNTS_SQL, { n: 0, out_n: 0, low_n: 0, over_n: 0, reorder_n: 0 }, {});
  const counts = { all: sc.n, ok: sc.n - sc.out_n - sc.low_n - sc.over_n, low: sc.low_n, out: sc.out_n, over: sc.over_n, reorder: sc.reorder_n };
  return { items: rows.map((r) => rowOut(r, cur)), total: total.n, value: total.v, counts: counts, currency: cur };
}

function itemRow(app, id) {
  const r = u().rows(app, ITEM_SQL + ' WHERE i.id = {:id}', ITEM_SHAPE, { id: id });
  return r.length > 0 ? r[0] : null;
}

function get(ctx, p) {
  const util = u();
  needSee(ctx);
  const app = ctx.app;
  const cur = core().currency(app);
  const item = core().resolve(app, 'items', util.req(p, 'item'));
  const out = rowOut(itemRow(app, item.id), cur);
  const acc = (id) => {
    const a = util.byId(app, 'accounts', id);
    return a === null ? null : { id: a.id, code: a.getString('code'), name: a.getString('name') };
  };
  const tax = (id) => {
    const t = util.byId(app, 'taxes', id);
    return t === null ? null : { id: t.id, code: t.getString('code'), name: t.getString('name') };
  };
  out.description = item.getString('description');
  out.lead_time_days = item.getInt('lead_time_days');
  out.sale_tax = tax(item.getString('sale_tax'));
  out.purchase_tax = tax(item.getString('purchase_tax'));
  out.income_account = acc(item.getString('income_account'));
  out.expense_account = acc(item.getString('expense_account'));
  out.created = item.getString('created');
  out.stock = util.rows(app, 'SELECT s.warehouse AS id, w.code AS code, w.name AS name, s.qty AS qty FROM stock s JOIN warehouses w ON w.id = s.warehouse WHERE s.item = {:i} AND s.qty != 0 ORDER BY w.sort, w.name', { id: '', code: '', name: '', qty: -0 }, { i: item.id }).map((r) => ({ id: r.id, code: r.code, name: r.name, qty: util.q3(r.qty) }));
  out.moves = util
    .rows(app, 'SELECT m.id AS id, m.date AS date, m.kind AS kind, m.qty AS qty, m.value AS value, m.balance AS balance, m.source_entity AS entity, m.source_id AS source, m.source_label AS label, m.actor AS actor, IFNULL(w.name, \'\') AS warehouse FROM stock_moves m LEFT JOIN warehouses w ON w.id = m.warehouse WHERE m.item = {:i} ORDER BY m.date DESC, m.created DESC LIMIT 30', { id: '', date: '', kind: '', qty: -0, value: 0, balance: -0, entity: '', source: '', label: '', actor: '', warehouse: '' }, { i: item.id })
    .map((r) => Object.assign(r, { qty: util.q3(r.qty), balance: util.q3(r.balance) }));
  out.open_lines = util.rows(app, "SELECT d.id AS id, d.type AS type, d.number AS number, d.date AS date, d.expected_date AS expected, (dl.qty - dl.qty_fulfilled) AS open, IFNULL(pa.name, \'\') AS party FROM document_lines dl JOIN documents d ON d.id = dl.doc LEFT JOIN parties pa ON pa.id = d.party WHERE dl.item = {:i} AND d.type IN ('sales_order', 'purchase_order') AND d.state = 'open' AND dl.qty > dl.qty_fulfilled ORDER BY d.date LIMIT 20", { id: '', type: '', number: '', date: '', expected: '', open: -0, party: '' }, { i: item.id });
  // 90 days of on-hand, for the chart.
  const today = util.today();
  const from = util.addDays(today, -89);
  const moves = util.rows(app, 'SELECT date, SUM(qty) AS q FROM stock_moves WHERE item = {:i} AND date > {:f} GROUP BY date', { date: '', q: -0 }, { i: item.id, f: from });
  const byDay = {};
  for (const r of moves) byDay[r.date] = r.q;
  let level = out.on_hand;
  const series = [];
  for (let i = 0; i < 90; i++) {
    const d = util.addDays(today, -i);
    series.push({ date: d, qty: util.q3(level) });
    level -= byDay[d] || 0;
  }
  out.history = series.reverse();
  const used = util.one(app, "SELECT IFNULL(SUM(-qty), 0) AS q FROM stock_moves WHERE item = {:i} AND qty < 0 AND kind IN ('delivery', 'build_out') AND date > {:f}", { q: -0 }, { i: item.id, f: util.addDays(today, -30) }).q;
  out.used_30d = util.q3(used);
  out.days_left = used > 0 ? Math.floor(out.on_hand / (used / 30)) : null;
  out.bom = util.findOne(app, 'boms', 'item = {:i} && active = true', { i: item.id }) !== null;
  out.can = { edit: ctx.isAgent || auth().can(ctx, 'inventory', 'edit') || auth().can(ctx, 'sales', 'edit') || auth().can(ctx, 'purchasing', 'edit'), adjust: ctx.isAgent || auth().can(ctx, 'inventory', 'edit') };
  return out;
}

function readItem(ctx, app, r, p, isNew) {
  const util = u();
  const c = core();
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 200, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    r.set('name', n);
  }
  if (isNew && r.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.has(p, 'kind')) {
    const k = util.oneOf(p, 'kind', ['stock', 'service', 'non_stock'], 'stock');
    if (!isNew && r.getString('kind') === 'stock' && k !== 'stock') {
      const moved = util.one(app, 'SELECT COUNT(id) AS n FROM stock_moves WHERE item = {:i}', { n: 0 }, { i: r.id }).n;
      if (moved > 0) throw util.fail(409, r.getString('name') + ' has stock history; it stays a stock item. Archive it and add a new item instead.', 'has_history');
    }
    r.set('kind', k);
  } else if (isNew) r.set('kind', 'stock');
  if (util.has(p, 'sku')) {
    const s = util.text(p, 'sku', 40, '');
    if (s !== '') {
      if (!/^[A-Za-z0-9._\-/]+$/.test(s)) throw util.fail(400, 'sku may use letters, digits and . _ - / only', 'invalid_param');
      const other = util.idsNocaseFind(app, 'items', 'sku', s, r.id);
      if (other) throw util.fail(409, 'The SKU ' + s + ' is taken.', 'duplicate');
      r.set('sku', s);
    }
  }
  if (util.has(p, 'barcode')) {
    const b = util.text(p, 'barcode', 60, '');
    if (b !== '') {
      const other = util.findOne(app, 'items', 'barcode = {:b} && id != {:i}', { b: b, i: r.id || '' });
      if (other !== null) throw util.fail(409, 'The barcode ' + b + ' belongs to ' + other.getString('name') + '.', 'duplicate');
    }
    r.set('barcode', b);
  }
  if (util.has(p, 'category')) {
    const cat = c.resolveOpt(app, 'item_categories', util.str(p, 'category', ''));
    r.set('category', cat !== null ? cat.id : '');
  }
  if (util.has(p, 'unit')) r.set('unit', util.text(p, 'unit', 20, ''));
  else if (isNew) r.set('unit', 'pcs');
  if (util.has(p, 'fractional')) r.set('fractional', util.bool(p, 'fractional', false));
  if (util.has(p, 'description')) r.set('description', util.text(p, 'description', 2000, ''));
  if (util.has(p, 'sale_price')) r.set('sale_price', util.price(p, 'sale_price') || 0);
  if (util.has(p, 'purchase_price')) r.set('purchase_price', util.price(p, 'purchase_price') || 0);
  for (const f of ['sale_tax', 'purchase_tax']) {
    if (!util.has(p, f)) continue;
    const ref = util.str(p, f, '');
    if (ref === '' || ref.toLowerCase() === 'none') {
      r.set(f, '');
      continue;
    }
    r.set(f, c.resolve(app, 'taxes', ref).id);
  }
  for (const f of ['income_account', 'expense_account']) {
    if (!util.has(p, f)) continue;
    const a = c.resolveOpt(app, 'accounts', util.str(p, f, ''));
    if (a !== null && a.getBool('control')) throw util.fail(400, f + ' cannot be a control account', 'control_account');
    r.set(f, a !== null ? a.id : '');
  }
  if (util.has(p, 'min_qty')) r.set('min_qty', util.qty(p, 'min_qty') || 0);
  if (util.has(p, 'max_qty')) r.set('max_qty', util.qty(p, 'max_qty') || 0);
  if (util.has(p, 'lead_time_days')) r.set('lead_time_days', util.int(p, 'lead_time_days', 0, 0, 3650));
  if (util.has(p, 'supplier')) {
    const s = c.resolveOpt(app, 'parties', util.str(p, 'supplier', ''));
    r.set('supplier', s !== null ? s.id : '');
  }
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  if (ctx.e) {
    const photo = util.uploaded(ctx.e, 'photo');
    if (photo !== null) r.set('photo', photo);
  }
  if (util.bool(p, 'remove_photo', false)) r.set('photo', null);
}

function add(ctx, p) {
  const util = u();
  needCatalog(ctx);
  const app = ctx.app;
  let id = '';
  const openingQty = util.qty(p, 'opening_qty', { positive: true });
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'items');
    r.set('archived', false);
    readItem(ctx, tx, r, p, true);
    if (r.getString('sku') === '') {
      let sku = core().nextNumber(tx, 'item');
      let guard = 0;
      while (util.findOne(tx, 'items', 'sku = {:s}', { s: sku }) !== null && guard < 50) {
        sku = core().nextNumber(tx, 'item');
        guard++;
      }
      r.set('sku', sku);
    }
    tx.save(r);
    mod('lib_audit').write(tx, ctx, { kind: 'create', entity: 'items', ref: r.id, label: r.getString('sku'), summary: 'Added the item ' + r.getString('name') });
    id = r.id;
    if (openingQty !== null && openingQty > 0) {
      if (r.getString('kind') !== 'stock') throw util.fail(400, 'Only stock items have opening stock.', 'invalid_param');
      const whRef = util.str(p, 'warehouse', '') || core().defaults(tx).warehouse || '';
      const wh = core().resolve(tx, 'warehouses', whRef);
      postChange(tx, ctx, {
        kind: 'adjust',
        reason: 'opening',
        date: util.day(p, 'opening_date', util.today()),
        warehouse: wh.id,
        account: core().systemAccount(tx, 'opening_balance').id,
        note: 'Opening stock of ' + r.getString('name'),
        lines: [{ item: r, qty: openingQty, unitCost: util.price(p, 'opening_cost') || r.getInt('purchase_price') }],
      });
    }
  });
  return get(ctx, { item: id });
}

function update(ctx, p) {
  const util = u();
  needCatalog(ctx);
  const app = ctx.app;
  const item = core().resolve(app, 'items', util.req(p, 'item'));
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('items', item.id);
    readItem(ctx, tx, r, p, false);
    tx.save(r);
    mod('lib_audit').write(tx, ctx, { kind: 'update', entity: 'items', ref: r.id, label: r.getString('sku'), summary: 'Changed the item ' + r.getString('name') });
  });
  return get(ctx, { item: item.id });
}

function remove(ctx, p) {
  const util = u();
  needCatalog(ctx);
  const app = ctx.app;
  const item = core().resolve(app, 'items', util.req(p, 'item'));
  const lines = util.one(app, 'SELECT COUNT(id) AS n FROM document_lines WHERE item = {:i}', { n: 0 }, { i: item.id }).n;
  const moves = util.one(app, 'SELECT COUNT(id) AS n FROM stock_moves WHERE item = {:i}', { n: 0 }, { i: item.id }).n;
  const boms = util.one(app, 'SELECT COUNT(id) AS n FROM bom_lines WHERE item = {:i}', { n: 0 }, { i: item.id }).n + util.one(app, 'SELECT COUNT(id) AS n FROM boms WHERE item = {:i}', { n: 0 }, { i: item.id }).n;
  if (lines + moves + boms > 0) throw util.fail(409, item.getString('name') + ' is on ' + lines + ' document lines and has ' + moves + ' stock moves. Archive it instead, so history keeps its name.', 'has_history');
  if (util.bool(p, 'preview', false)) return { preview: true, name: item.getString('name') };
  app.runInTransaction((tx) => {
    const v = util.findOne(tx, 'valuation', 'item = {:i}', { i: item.id });
    if (v !== null) tx.delete(tx.findRecordById('valuation', v.id));
    tx.delete(tx.findRecordById('items', item.id));
    mod('lib_audit').write(tx, ctx, { kind: 'delete', entity: 'items', ref: item.id, label: item.getString('sku'), summary: 'Deleted the item ' + item.getString('name') });
  });
  return { deleted: true };
}

function setArchived(ctx, p) {
  const util = u();
  needCatalog(ctx);
  const ids = util.list(p, 'items') || [];
  const archived = util.bool(p, 'archived', true);
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    for (const ref of ids) {
      const r = core().resolve(tx, 'items', String(ref));
      r.set('archived', archived);
      tx.save(r);
      n++;
    }
  });
  return { updated: n };
}

/** An item's photo: its URL (with thumbnails) for screens, its file path for your AI agent. */
function photo(ctx, p) {
  const util = u();
  needSee(ctx);
  const item = core().resolve(ctx.app, 'items', util.req(p, 'item'));
  if (item.getString('photo') === '') throw util.fail(404, 'No photo.', 'not_found');
  return { url: photoUrl(item), file_path: util.filePath(ctx.app, item, 'photo') };
}

function photoUrl(item) {
  return item.getString('photo') === '' ? '' : '/api/files/items/' + item.id + '/' + item.getString('photo');
}

/* ========================================================== categories */

function listCategories(ctx) {
  const util = u();
  needSee(ctx);
  const app = ctx.app;
  const counts = {};
  for (const r of util.rows(app, 'SELECT category, COUNT(id) AS n FROM items WHERE archived = FALSE GROUP BY category', { category: '', n: 0 })) counts[r.category] = r.n;
  return {
    categories: app.findRecordsByFilter('item_categories', '', 'sort,name', 0, 0).map((c) => ({
      id: c.id,
      name: c.getString('name'),
      icon: c.getString('icon') || 'package',
      income_account: c.getString('income_account'),
      expense_account: c.getString('expense_account'),
      items: counts[c.id] || 0,
    })),
    icons: ICONS,
  };
}

function saveCategory(ctx, p, r) {
  const util = u();
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 60, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    if (util.idsNocaseFind(ctx.app, 'item_categories', 'name', n, r.id || '')) throw util.fail(409, 'There is already a category called ' + n + '.', 'duplicate');
    r.set('name', n);
  }
  if (util.has(p, 'icon')) {
    const i = util.str(p, 'icon', 'package');
    if (ICONS.indexOf(i) < 0) throw util.fail(400, 'icon must be one of: ' + ICONS.join(', '), 'invalid_param');
    r.set('icon', i);
  }
  for (const f of ['income_account', 'expense_account']) {
    if (!util.has(p, f)) continue;
    const a = core().resolveOpt(ctx.app, 'accounts', util.str(p, f, ''));
    r.set(f, a !== null ? a.id : '');
  }
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 10000));
  ctx.app.save(r);
  return { id: r.id, name: r.getString('name') };
}

function addCategory(ctx, p) {
  needCatalog(ctx);
  const util = u();
  util.req(p, 'name', 'Packaging');
  const r = util.newRecord(ctx.app, 'item_categories');
  r.set('icon', 'package');
  r.set('sort', 100);
  return saveCategory(ctx, p, r);
}

function updateCategory(ctx, p) {
  needCatalog(ctx);
  const r = core().resolve(ctx.app, 'item_categories', u().req(p, 'category'));
  return saveCategory(ctx, p, r);
}

function deleteCategory(ctx, p) {
  needCatalog(ctx);
  const util = u();
  const r = core().resolve(ctx.app, 'item_categories', util.req(p, 'category'));
  const n = util.one(ctx.app, 'SELECT COUNT(id) AS n FROM items WHERE category = {:c}', { n: 0 }, { c: r.id }).n;
  if (util.bool(p, 'preview', false)) return { preview: true, items_uncategorized: n };
  ctx.app.runInTransaction((tx) => {
    for (const it of tx.findRecordsByFilter('items', 'category = {:c}', '', 0, 0, { c: r.id })) {
      const x = tx.findRecordById('items', it.id);
      x.set('category', '');
      tx.save(x);
    }
    tx.delete(tx.findRecordById('item_categories', r.id));
  });
  return { deleted: true, items_uncategorized: n };
}

/* ========================================================== warehouses */

function listWarehouses(ctx) {
  const util = u();
  needSee(ctx);
  const app = ctx.app;
  const val = {};
  for (const r of util.rows(app, 'SELECT s.warehouse AS w, COUNT(DISTINCT s.item) AS items, SUM(s.qty) AS units FROM stock s WHERE s.qty != 0 GROUP BY s.warehouse', { w: '', items: 0, units: -0 })) val[r.w] = r;
  // Value per warehouse at each item's average cost.
  const value = {};
  for (const r of util.rows(app, 'SELECT s.warehouse AS w, SUM(CASE WHEN v.qty > 0 THEN s.qty * 1.0 * v.value / v.qty ELSE 0 END) AS value FROM stock s JOIN valuation v ON v.item = s.item WHERE s.qty != 0 GROUP BY s.warehouse', { w: '', value: -0 })) value[r.w] = Math.round(r.value);
  return {
    warehouses: app.findRecordsByFilter('warehouses', '', 'sort,name', 0, 0).map((w) => ({
      id: w.id,
      code: w.getString('code'),
      name: w.getString('name'),
      address: w.getString('address'),
      archived: w.getBool('archived'),
      items: val[w.id] ? val[w.id].items : 0,
      units: val[w.id] ? util.q3(val[w.id].units) : 0,
      value: value[w.id] || 0,
    })),
    currency: core().currency(app),
  };
}

function saveWarehouse(ctx, p, r, isNew) {
  const util = u();
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 80, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    if (util.idsNocaseFind(ctx.app, 'warehouses', 'name', n, r.id || '')) throw util.fail(409, 'There is already a warehouse called ' + n + '.', 'duplicate');
    r.set('name', n);
  }
  if (isNew && r.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.has(p, 'code')) {
    const code = util.text(p, 'code', 20, '').toUpperCase();
    if (code !== '' && util.idsNocaseFind(ctx.app, 'warehouses', 'code', code, r.id || '')) throw util.fail(409, 'The warehouse code ' + code + ' is taken.', 'duplicate');
    r.set('code', code);
  }
  if (r.getString('code') === '') {
    let n = util.one(ctx.app, 'SELECT COUNT(id) AS n FROM warehouses', { n: 0 }).n + 1;
    while (util.idsNocaseFind(ctx.app, 'warehouses', 'code', 'WH' + n, r.id || '')) n++;
    r.set('code', 'WH' + n);
  }
  if (util.has(p, 'address')) r.set('address', util.text(p, 'address', 600, ''));
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  ctx.app.save(r);
  return { id: r.id, code: r.getString('code'), name: r.getString('name') };
}

function needWarehouses(ctx) {
  if (ctx.isAgent) return;
  auth().need(ctx, 'inventory', 'full', 'change warehouses');
}

function addWarehouse(ctx, p) {
  needWarehouses(ctx);
  const r = u().newRecord(ctx.app, 'warehouses');
  r.set('archived', false);
  r.set('sort', 100);
  return saveWarehouse(ctx, p, r, true);
}

function updateWarehouse(ctx, p) {
  needWarehouses(ctx);
  const r = core().resolve(ctx.app, 'warehouses', u().req(p, 'warehouse'));
  return saveWarehouse(ctx, p, r, false);
}

function deleteWarehouse(ctx, p) {
  needWarehouses(ctx);
  const util = u();
  const r = core().resolve(ctx.app, 'warehouses', util.req(p, 'warehouse'));
  const held = util.one(ctx.app, 'SELECT COUNT(id) AS n FROM stock WHERE warehouse = {:w} AND qty != 0', { n: 0 }, { w: r.id }).n;
  if (held > 0) throw util.fail(409, r.getString('name') + ' still holds stock. Transfer it first.', 'has_stock');
  const used = util.one(ctx.app, 'SELECT COUNT(id) AS n FROM stock_moves WHERE warehouse = {:w}', { n: 0 }, { w: r.id }).n;
  if (used > 0) throw util.fail(409, r.getString('name') + ' has stock history. Archive it instead.', 'has_history');
  if (util.bool(p, 'preview', false)) return { preview: true };
  ctx.app.runInTransaction((tx) => {
    for (const s of tx.findRecordsByFilter('stock', 'warehouse = {:w}', '', 0, 0, { w: r.id })) tx.delete(tx.findRecordById('stock', s.id));
    tx.delete(tx.findRecordById('warehouses', r.id));
  });
  return { deleted: true };
}

/* ============================================================== levels */

function levels(ctx, p) {
  const util = u();
  needSee(ctx);
  const app = ctx.app;
  const cur = core().currency(app);
  const pg = util.page(p, 100, 1000);
  const where = ['s.qty != 0'];
  const bind = {};
  const wh = util.str(p, 'warehouse', '');
  if (wh !== '') {
    where.push('s.warehouse = {:w}');
    bind.w = core().resolve(app, 'warehouses', wh).id;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(i.name LIKE {:q} ESCAPE '\\' OR i.sku LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const sql = ' FROM stock s JOIN items i ON i.id = s.item JOIN warehouses w ON w.id = s.warehouse LEFT JOIN valuation v ON v.item = s.item WHERE ' + where.join(' AND ');
  const total = util.one(app, 'SELECT COUNT(s.id) AS n, IFNULL(SUM(CASE WHEN v.qty > 0 THEN s.qty * 1.0 * v.value / v.qty ELSE 0 END), 0) AS value' + sql, { n: 0, value: -0 }, bind);
  const rows = util.rows(app, 'SELECT i.id AS item, i.sku AS sku, i.name AS name, i.unit AS unit, w.id AS warehouse, w.name AS warehouse_name, s.qty AS qty, IFNULL(v.qty, 0) AS vq, IFNULL(v.value, 0) AS vv' + sql + ' ORDER BY i.name COLLATE NOCASE, w.sort LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { item: '', sku: '', name: '', unit: '', warehouse: '', warehouse_name: '', qty: -0, vq: -0, vv: 0 }, bind);
  return {
    levels: rows.map((r) => ({ item: { id: r.item, sku: r.sku, name: r.name, unit: r.unit }, warehouse: { id: r.warehouse, name: r.warehouse_name }, qty: util.q3(r.qty), value: r.vq > 0 ? Math.round((r.qty * r.vv) / r.vq) : 0 })),
    total: total.n,
    value: Math.round(total.value),
    currency: cur,
  };
}

function moves(ctx, p) {
  const util = u();
  needSee(ctx);
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  const item = util.str(p, 'item', '');
  if (item !== '') {
    where.push('m.item = {:i}');
    bind.i = core().resolve(app, 'items', item).id;
  }
  const wh = util.str(p, 'warehouse', '');
  if (wh !== '') {
    where.push('m.warehouse = {:w}');
    bind.w = core().resolve(app, 'warehouses', wh).id;
  }
  const kind = util.str(p, 'kind', '');
  if (kind !== '') {
    where.push('m.kind = {:k}');
    bind.k = kind;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('m.date >= {:f}');
    bind.f = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('m.date <= {:t}');
    bind.t = to;
  }
  const sql = ' FROM stock_moves m JOIN items i ON i.id = m.item LEFT JOIN warehouses w ON w.id = m.warehouse WHERE ' + where.join(' AND ');
  const total = util.one(app, 'SELECT COUNT(m.id) AS n' + sql, { n: 0 }, bind).n;
  const rows = util.rows(app, 'SELECT m.id AS id, m.date AS date, m.kind AS kind, m.qty AS qty, m.value AS value, m.balance AS balance, m.source_entity AS entity, m.source_id AS source, m.source_label AS label, m.actor AS actor, m.note AS note, i.id AS item, i.sku AS sku, i.name AS name, i.unit AS unit, IFNULL(w.name, \'\') AS warehouse' + sql + ' ORDER BY m.date DESC, m.created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '', date: '', kind: '', qty: -0, value: 0, balance: -0, entity: '', source: '', label: '', actor: '', note: '', item: '', sku: '', name: '', unit: '', warehouse: '' }, bind);
  return { moves: rows.map((r) => Object.assign(r, { qty: util.q3(r.qty), balance: util.q3(r.balance) })), total: total, currency: core().currency(app) };
}

/* ======================================================== stock changes */

function changeLabel(r) {
  return 'Stock change ' + r.getString('number');
}

/**
 * Post a stock change in the caller's transaction.
 *   o: { kind, reason, date, warehouse, to_warehouse, account, note,
 *        lines: [{ item (record), qty (signed for adjust), unitCost }] }
 */
function postChange(tx, ctx, o) {
  const util = u();
  const c = core();
  const stock = mod('lib_stock');
  const number = c.nextNumber(tx, 'stock_change');
  const rec = util.newRecord(tx, 'stock_changes');
  rec.set('number', number);
  rec.set('date', o.date);
  rec.set('kind', o.kind);
  rec.set('warehouse', o.warehouse);
  rec.set('to_warehouse', o.to_warehouse || '');
  rec.set('reason', o.reason || 'correction');
  rec.set('account', o.account || '');
  rec.set('note', String(o.note || '').slice(0, 1000));
  rec.set('state', 'posted');
  rec.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  rec.set('member', ctx.memberId || '');
  rec.set('lines_count', o.lines.length);
  tx.save(rec);
  const label = changeLabel(rec);
  const batch = util.token(15);
  const inv = c.systemAccount(tx, 'inventory').id;
  const offset = o.account || c.systemAccount(tx, 'stock_adjustment').id;
  const jl = [];
  const movesDone = [];
  let total = 0;
  let residual = 0;
  for (const l of o.lines) {
    const item = l.item;
    if (o.kind === 'transfer') {
      const out = stock.move(tx, ctx, { item: item, warehouse: o.warehouse, qty: -l.qty, kind: 'transfer_out', date: o.date, source: { entity: 'stock_changes', id: rec.id, label: label }, batch: batch, note: o.note });
      const into = stock.move(tx, ctx, { item: item, warehouse: o.to_warehouse, qty: l.qty, value: -out.value, kind: 'transfer_in', date: o.date, source: { entity: 'stock_changes', id: rec.id, label: label }, batch: batch, note: o.note });
      movesDone.push(out.move, into.move);
      residual += out.residual + into.residual;
      continue;
    }
    if (l.qty === 0) continue;
    const kind = o.kind === 'count' ? 'count' : l.qty > 0 ? (o.reason === 'opening' ? 'opening' : 'adjust_in') : 'adjust_out';
    const mv = { item: item, warehouse: o.warehouse, qty: l.qty, kind: kind, date: o.date, source: { entity: 'stock_changes', id: rec.id, label: label }, batch: batch, note: o.note };
    if (l.qty > 0 && l.unitCost !== null && l.unitCost !== undefined && l.unitCost > 0) mv.unitCost = l.unitCost;
    const r = stock.move(tx, ctx, mv);
    movesDone.push(r.move);
    residual += r.residual;
    total += r.value;
    if (r.value > 0) {
      jl.push({ account: inv, debit: r.value, credit: 0, memo: item.getString('name') });
      jl.push({ account: offset, debit: 0, credit: r.value, memo: item.getString('name') });
    } else if (r.value < 0) {
      jl.push({ account: offset, debit: -r.value, credit: 0, memo: item.getString('name') });
      jl.push({ account: inv, debit: 0, credit: -r.value, memo: item.getString('name') });
    }
  }
  for (const l of stock.residualLines(tx, residual)) jl.push(l);
  let j = null;
  if (jl.length > 0) j = mod('lib_ledger').post(tx, ctx, { kind: o.reason === 'opening' ? 'opening' : 'stock_change', date: o.date, memo: label + (o.note ? ': ' + o.note : ''), source: { entity: 'stock_changes', id: rec.id, label: label }, lines: jl }, { allowControl: true });
  if (j !== null) stock.linkJournal(tx, movesDone, j.id);
  const fresh = tx.findRecordById('stock_changes', rec.id);
  fresh.set('journal', j !== null ? j.id : '');
  fresh.set('value', total);
  tx.save(fresh);
  mod('lib_audit').write(tx, ctx, { kind: 'post', entity: 'stock_changes', ref: rec.id, label: label, summary: label + ': ' + o.kind + ' of ' + o.lines.length + (o.lines.length === 1 ? ' item' : ' items') + (o.note ? ' (' + o.note + ')' : '') });
  return fresh;
}

/** Read stock change params into the shape postChange takes (no writes). */
function readChange(ctx, app, p) {
  const util = u();
  const c = core();
  const kind = util.oneOf(p, 'kind', ['adjust', 'count', 'transfer'], 'adjust');
  const date = util.day(p, 'date', util.today());
  const whRef = util.str(p, 'warehouse', '') || c.defaults(app).warehouse || '';
  if (whRef === '') throw util.fail(400, 'warehouse is required', 'missing_param');
  const wh = c.resolve(app, 'warehouses', whRef);
  let to = null;
  if (kind === 'transfer') {
    to = c.resolve(app, 'warehouses', util.req(p, 'to_warehouse'));
    if (to.id === wh.id) throw util.fail(400, 'Transfer to a different warehouse.', 'invalid_param');
  }
  const reason = util.oneOf(p, 'reason', ['count', 'damage', 'loss', 'found', 'expiry', 'sample', 'correction', 'opening', 'other'], kind === 'count' ? 'count' : 'correction');
  let account = '';
  const accRef = util.str(p, 'account', '');
  if (accRef !== '') {
    const a = c.resolve(app, 'accounts', accRef);
    if (a.getBool('control')) throw util.fail(400, 'The offset account cannot be a control account.', 'control_account');
    account = a.id;
  } else if (reason === 'opening') account = c.systemAccount(app, 'opening_balance').id;
  const input = util.list(p, 'lines') || [];
  if (input.length === 0) throw util.fail(400, 'lines is required, e.g. [{"item":"SKU-00001","qty":5}]', 'missing_param');
  if (input.length > 1000) throw util.fail(400, 'At most 1000 lines per change.', 'invalid_param');
  const stock = mod('lib_stock');
  const lines = input.map((raw, i) => {
    util.keysOnly(raw, ['item', 'qty', 'counted', 'unit_cost'], 'Line ' + (i + 1));
    if (!raw || !raw.item) throw util.fail(400, 'Line ' + (i + 1) + ' needs an item.', 'invalid_param');
    const item = c.resolve(app, 'items', String(raw.item));
    if (item.getString('kind') !== 'stock') throw util.fail(400, item.getString('name') + ' is not a stock item.', 'not_stock');
    const whole = !item.getBool('fractional');
    let qty;
    if (kind === 'count') {
      const counted = util.qtyOf(raw.counted !== undefined ? raw.counted : raw.qty, 'counted', { required: true, whole: whole, label: item.getString('name') });
      qty = util.q3(counted - stock.onHand(app, item.id, wh.id));
    } else if (kind === 'transfer') {
      qty = util.qtyOf(raw.qty, 'qty', { required: true, positive: true, whole: whole, label: item.getString('name') });
    } else {
      qty = util.qtyOf(raw.qty, 'qty', { required: true, allowNegative: true, whole: whole, label: item.getString('name') });
      if (qty === 0) throw util.fail(400, 'Line ' + (i + 1) + ': qty cannot be 0 (use a minus for stock going out).', 'invalid_param');
    }
    let unitCost = null;
    if (raw.unit_cost !== undefined && raw.unit_cost !== null && raw.unit_cost !== '') {
      unitCost = money().toE4(String(raw.unit_cost), false);
      if (unitCost === null) throw util.fail(400, 'Line ' + (i + 1) + ': unit_cost must be like 2.35', 'invalid_amount');
    }
    return { item: item, qty: qty, unitCost: unitCost };
  });
  const note = util.text(p, 'note', 1000, '');
  return { kind: kind, reason: reason, date: date, warehouse: wh.id, to_warehouse: to !== null ? to.id : '', account: account, note: note, lines: lines };
}

function change(ctx, p) {
  const util = u();
  if (!ctx.isAgent) auth().need(ctx, 'inventory', 'edit', 'change stock');
  const app = ctx.app;
  const o = readChange(ctx, app, p);
  mod('lib_ledger').checkDate(app, ctx, o.date);
  let id = '';
  app.runInTransaction((tx) => {
    const lines = o.lines.map((l) => Object.assign({}, l, { item: tx.findRecordById('items', l.item.id) }));
    id = postChange(tx, ctx, Object.assign({}, o, { lines: lines })).id;
  });
  return getChange(ctx, { change: id });
}

function previewChange(ctx, p) {
  const util = u();
  const app = ctx.app;
  const o = readChange(ctx, app, p);
  const stock = mod('lib_stock');
  const c = core();
  const inv = c.systemAccount(app, 'inventory').id;
  const offset = o.account || c.systemAccount(app, 'stock_adjustment').id;
  const lines = [];
  let amount = 0;
  for (const l of o.lines) {
    if (o.kind === 'transfer') continue;
    const v = l.qty > 0 ? money().stockValue(l.qty, l.unitCost || stock.avgCost(app, l.item.id), c.currency(app)) : -stock.outValue(app, l.item.id, -l.qty);
    amount += Math.abs(v);
    if (v > 0) lines.push({ account: inv, debit: v, credit: 0, memo: l.item.getString('name') }, { account: offset, debit: 0, credit: v, memo: l.item.getString('name') });
    if (v < 0) lines.push({ account: offset, debit: -v, credit: 0, memo: l.item.getString('name') }, { account: inv, debit: 0, credit: -v, memo: l.item.getString('name') });
  }
  const wh = app.findRecordById('warehouses', o.warehouse);
  return {
    kind: 'stock_change',
    auto: 'stock_change',
    amount: amount,
    title: (o.kind === 'transfer' ? 'Transfer ' : o.kind === 'count' ? 'Count ' : 'Adjust ') + o.lines.length + (o.lines.length === 1 ? ' item' : ' items') + ' in ' + wh.getString('name'),
    summary: o.lines.map((l) => l.item.getString('name') + ' ' + (l.qty > 0 ? '+' : '') + util.fmtQty(l.qty)).join(', ').slice(0, 900),
    lines: mod('lib_ledger').describeLines(app, lines),
    currency: c.currency(app),
    target: { entity: 'warehouses', id: wh.id, label: wh.getString('name') },
  };
}

function changeOut(app, r, withMoves) {
  const util = u();
  const wh = util.byId(app, 'warehouses', r.getString('warehouse'));
  const to = util.byId(app, 'warehouses', r.getString('to_warehouse'));
  const j = util.byId(app, 'journals', r.getString('journal'));
  const out = {
    id: r.id,
    number: r.getString('number'),
    date: r.getString('date'),
    kind: r.getString('kind'),
    reason: r.getString('reason'),
    warehouse: wh !== null ? { id: wh.id, name: wh.getString('name') } : null,
    to_warehouse: to !== null ? { id: to.id, name: to.getString('name') } : null,
    note: r.getString('note'),
    state: r.getString('state'),
    value: r.getInt('value'),
    lines_count: r.getInt('lines_count'),
    actor: r.getString('actor'),
    who: r.getString('actor') === 'agent' ? 'Your AI agent' : mod('lib_audit').memberName(app, r.getString('member'), {}),
    journal: j !== null ? { id: j.id, number: j.getString('number') } : null,
    created: r.getString('created'),
  };
  if (withMoves) {
    out.moves = util.rows(app, "SELECT m.id AS id, m.qty AS qty, m.value AS value, m.kind AS kind, i.id AS item, i.sku AS sku, i.name AS name, i.unit AS unit, IFNULL(w.name, \'\') AS warehouse FROM stock_moves m JOIN items i ON i.id = m.item LEFT JOIN warehouses w ON w.id = m.warehouse WHERE m.source_entity = 'stock_changes' AND m.source_id = {:s} ORDER BY m.created", { id: '', qty: -0, value: 0, kind: '', item: '', sku: '', name: '', unit: '', warehouse: '' }, { s: r.id }).map((x) => Object.assign(x, { qty: util.q3(x.qty) }));
  }
  return out;
}

function getChange(ctx, p) {
  needSee(ctx);
  const r = core().resolve(ctx.app, 'stock_changes', u().req(p, 'change'));
  const out = changeOut(ctx.app, r, true);
  out.can = { void: r.getString('state') === 'posted' && (ctx.isAgent || auth().can(ctx, 'inventory', 'full')) };
  out.currency = core().currency(ctx.app);
  return out;
}

function listChanges(ctx, p) {
  const util = u();
  needSee(ctx);
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const filters = [];
  const bind = {};
  const kind = util.oneOf(p, 'kind', ['adjust', 'count', 'transfer'], '');
  if (kind !== '') {
    filters.push('kind = {:k}');
    bind.k = kind;
  }
  const recs = app.findRecordsByFilter('stock_changes', filters.join(' && '), '-date,-created', pg.limit, pg.offset, bind);
  const total = util.one(app, 'SELECT COUNT(id) AS n FROM stock_changes' + (kind !== '' ? ' WHERE kind = {:k}' : ''), { n: 0 }, bind).n;
  return { changes: recs.map((r) => changeOut(app, r, false)), total: total, currency: core().currency(app) };
}

function voidChange(ctx, p) {
  const util = u();
  if (!ctx.isAgent) auth().need(ctx, 'inventory', 'full', 'void stock changes');
  const app = ctx.app;
  const r = core().resolve(app, 'stock_changes', util.req(p, 'change'));
  if (r.getString('state') !== 'posted') throw util.fail(409, changeLabel(r) + ' is already void.', 'invalid_state');
  app.runInTransaction((tx) => {
    const ledger = mod('lib_ledger');
    const date = ledger.firstOpenDate(tx, ctx, r.getString('date'));
    const back = mod('lib_stock').reverseSource(tx, ctx, 'stock_changes', r.id, date, 'Void ' + changeLabel(r));
    let rev = null;
    if (r.getString('journal') !== '') rev = ledger.reverse(tx, ctx, r.getString('journal'), { date: date, memo: 'Void ' + changeLabel(r) });
    if (back.residual !== 0) ledger.post(tx, ctx, { kind: 'reversal', date: date, memo: 'Stock value left after voiding ' + changeLabel(r), source: { entity: 'stock_changes', id: r.id, label: changeLabel(r) }, lines: mod('lib_stock').residualLines(tx, back.residual) }, { allowControl: true });
    const x = tx.findRecordById('stock_changes', r.id);
    x.set('state', 'void');
    x.set('void_journal', rev !== null ? rev.id : '');
    tx.save(x);
    mod('lib_audit').write(tx, ctx, { kind: 'void', entity: 'stock_changes', ref: r.id, label: changeLabel(r), summary: 'Voided ' + changeLabel(r) });
  });
  return getChange(ctx, { change: r.id });
}

function previewVoidChange(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = core().resolve(app, 'stock_changes', util.req(p, 'change'));
  if (r.getString('state') !== 'posted') throw util.fail(409, changeLabel(r) + ' is already void.', 'invalid_state');
  const ledger = mod('lib_ledger');
  const lines = r.getString('journal') !== '' ? ledger.linesOf(app, r.getString('journal')).map((l) => Object.assign({}, l, { debit: l.credit, credit: l.debit })) : [];
  return {
    kind: 'void',
    auto: '',
    amount: Math.abs(r.getInt('value')),
    title: 'Void ' + changeLabel(r),
    summary: 'Reverses ' + changeLabel(r) + ' (' + r.getString('kind') + ', ' + r.getInt('lines_count') + ' lines).',
    lines: ledger.describeLines(app, lines),
    currency: core().currency(app),
    target: { entity: 'stock_changes', id: r.id, label: changeLabel(r) },
  };
}

/* ============================================================== reorder */

function reorderList(ctx, p) {
  const util = u();
  if (!ctx.isAgent && !auth().can(ctx, 'purchasing', 'view') && !auth().can(ctx, 'inventory', 'view')) throw util.fail(403, 'Your role cannot see reorder suggestions.', 'not_permitted');
  void p;
  const app = ctx.app;
  const cur = core().currency(app);
  const rows = util.rows(app, 'SELECT * FROM (' + ITEM_SQL + " WHERE i.archived = FALSE AND i.kind = 'stock' AND i.min_qty > 0) x WHERE (x.on_hand + x.incoming - x.committed) <= x.min_qty ORDER BY x.supplier_name, x.name", ITEM_SHAPE, {});
  const groups = {};
  const drafts = {};
  for (const d of util.rows(app, "SELECT d.id AS id, d.number AS number, d.party AS party FROM documents d WHERE d.type = 'purchase_order' AND d.state = 'draft'", { id: '', number: '', party: '' })) drafts[d.party] = { id: d.id, number: d.number };
  for (const r of rows) {
    const projected = util.q3(r.on_hand + r.incoming - r.committed);
    const target = r.max_qty > r.min_qty ? r.max_qty : r.min_qty * 2;
    const qty = Math.max(r.fractional ? util.q3(target - projected) : Math.ceil(target - projected), r.fractional ? 0.001 : 1);
    const key = r.supplier || '';
    const g = groups[key] || { supplier: r.supplier !== '' ? { id: r.supplier, name: r.supplier_name } : null, items: [], value: 0, draft: drafts[r.supplier] || null };
    const lineValue = money().stockValue(qty, r.purchase_price, cur);
    g.items.push({
      item: { id: r.id, sku: r.sku, name: r.name, unit: r.unit, icon: r.icon || 'package' },
      on_hand: util.q3(r.on_hand),
      incoming: util.q3(r.incoming),
      committed: util.q3(r.committed),
      min_qty: util.q3(r.min_qty),
      target: util.q3(target),
      qty: qty,
      unit_price: money().e4Text(r.purchase_price, cur),
      value: lineValue,
      why: util.fmtQty(r.on_hand) + ' on hand' + (r.incoming > 0 ? ', ' + util.fmtQty(r.incoming) + ' coming' : '') + (r.committed > 0 ? ', ' + util.fmtQty(r.committed) + ' promised to customers' : '') + ': at or below the reorder point of ' + util.fmtQty(r.min_qty) + '. Ordering ' + util.fmtQty(qty) + ' brings it to ' + util.fmtQty(target) + '.',
    });
    g.value += lineValue;
    groups[key] = g;
  }
  const list = Object.keys(groups).map((k) => groups[k]);
  return { groups: list, count: rows.length, currency: cur };
}

/**
 * Draft purchase orders from the suggestions: ONE draft per supplier (an
 * existing draft gets the lines), so it is safe to repeat.
 */
function reorderCreate(ctx, p) {
  const util = u();
  auth().needDoc(ctx, 'purchase_order', 'edit');
  const app = ctx.app;
  const docs = mod('lib_docs');
  const sugg = reorderList(ctx, {});
  const pick = util.list(p, 'items');
  const wanted = {};
  if (pick !== undefined) {
    for (const x of pick) {
      const it = core().resolve(app, 'items', String(x.item));
      wanted[it.id] = x.qty === undefined || x.qty === null || x.qty === '' ? null : util.qtyOf(x.qty, 'qty', { positive: true });
    }
  }
  const note = util.text(p, 'note', 2000, '');
  const created = [];
  for (const g of sugg.groups) {
    if (g.supplier === null) continue;
    const lines = g.items.filter((x) => pick === undefined || wanted[x.item.id] !== undefined).map((x) => ({ item: x.item.id, qty: wanted[x.item.id] !== undefined && wanted[x.item.id] !== null ? wanted[x.item.id] : x.qty }));
    if (lines.length === 0) continue;
    if (g.draft !== null) {
      const d = docs.get(ctx, { doc: g.draft.id });
      const existing = d.lines.map((l) => ({ id: l.id, item: l.item ? l.item.id : '', description: l.description, qty: l.qty, unit_price_e4: l.unit_price_e4, discount_bp: l.discount_bp, tax: l.tax ? l.tax.id : 'none', account: l.account ? l.account.id : '' }));
      for (const l of lines) {
        const same = existing.find((e) => e.item === l.item);
        if (same !== undefined) same.qty = l.qty;
        else existing.push(l);
      }
      const updated = docs.update(ctx, { doc: g.draft.id, lines: existing, agent_note: ctx.isAgent && note !== '' ? note : d.agent_note });
      created.push({ id: updated.id, number: updated.number, supplier: g.supplier.name, lines: updated.lines.length, total: updated.total, updated: true });
    } else {
      const made = docs.create(ctx, { type: 'purchase_order', party: g.supplier.id, lines: lines, agent_note: ctx.isAgent ? note : '', internal_note: ctx.isAgent ? '' : note });
      created.push({ id: made.id, number: made.number, supplier: g.supplier.name, lines: made.lines.length, total: made.total, updated: false });
    }
  }
  const skipped = (sugg.groups.find((g) => g.supplier === null) || { items: [] }).items.map((x) => x.item.name);
  return { orders: created, without_supplier: skipped };
}

module.exports = {
  ICONS: ICONS,
  list: list,
  get: get,
  add: add,
  update: update,
  remove: remove,
  setArchived: setArchived,
  photo: photo,
  photoUrl: photoUrl,
  listCategories: listCategories,
  addCategory: addCategory,
  updateCategory: updateCategory,
  deleteCategory: deleteCategory,
  listWarehouses: listWarehouses,
  addWarehouse: addWarehouse,
  updateWarehouse: updateWarehouse,
  deleteWarehouse: deleteWarehouse,
  levels: levels,
  moves: moves,
  postChange: postChange,
  change: change,
  previewChange: previewChange,
  getChange: getChange,
  listChanges: listChanges,
  voidChange: voidChange,
  previewVoidChange: previewVoidChange,
  reorderList: reorderList,
  reorderCreate: reorderCreate,
};
