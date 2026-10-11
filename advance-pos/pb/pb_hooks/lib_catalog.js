/// <reference path="../pb_data/types.d.ts" />
/**
 * The catalog: categories, tax rates, modifier groups (options a product
 * can be sold with, like "Milk: oat +0.50") and products. Every product
 * sells as one or more variants (a product without options has exactly one);
 * each variant has its own SKU, barcode, price, cost and stock. Codes are
 * unique across the store, so a scan always finds one variant.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function audit() {
  return require(`${__hooks}/lib_audit.js`);
}
function moneyOf(s) {
  return require(`${__hooks}/lib_money.js`).of(s);
}

const COLORS = ['neutral', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'graphite'];

/* ------------------------------------------------------------- categories */

function categoryJson(r, counts) {
  return { id: r.id, name: r.getString('name'), color: r.getString('color') || 'neutral', sort: r.getInt('sort'), products: counts ? counts[r.id] || 0 : undefined };
}

function categoriesList(app) {
  const util = u();
  const counts = {};
  for (const row of util.rows(app, 'SELECT category AS c, COUNT(*) AS n FROM products WHERE archived = FALSE GROUP BY category', { c: '', n: 0 })) counts[row.c] = row.n;
  return { categories: app.findRecordsByFilter('categories', '', 'sort,name', 0, 0).map((r) => categoryJson(r, counts)) };
}

function categoriesSave(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_catalog', p, { what: 'Editing categories' });
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('categories')) : util.byId(tx, 'categories', id);
    if (r === null) throw util.fail(404, 'No category ' + id);
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', 'Drinks'));
      if (name.length > 60) throw util.fail(400, 'name can be at most 60 characters');
      if (util.findOne(tx, 'categories', 'name = {:n} && id != {:i}', { n: name, i: r.id || '' }) !== null) throw util.fail(400, 'There is already a category named ' + name);
      r.set('name', name);
    }
    if (util.has(p, 'color') || id === '') r.set('color', util.oneOf(p, 'color', COLORS, r.getString('color') || 'neutral'));
    if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, -100000, 100000));
    else if (id === '') r.set('sort', tx.countRecords('categories'));
    tx.save(r);
    audit().log(tx, 'catalog', c, { approver: approver, detail: (id === '' ? 'Category added: ' : 'Category changed: ') + r.getString('name') });
    out = r;
  });
  return { category: categoryJson(out) };
}

/* ------------------------------------------------------------------ taxes */

function taxJson(r) {
  return { id: r.id, name: r.getString('name'), rate: r.getFloat('rate'), is_default: r.getBool('is_default') };
}

function taxesList(app) {
  return { taxes: app.findRecordsByFilter('taxes', '', '-is_default,name', 0, 0).map(taxJson) };
}

function defaultTax(db) {
  return u().findOne(db, 'taxes', 'is_default = true', {});
}

function taxesSave(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_settings', p, { what: 'Editing tax rates' });
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('taxes')) : util.byId(tx, 'taxes', id);
    if (r === null) throw util.fail(404, 'No tax rate ' + id);
    const before = id === '' ? null : taxJson(r);
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', '"Sales tax"'));
      if (name.length > 60) throw util.fail(400, 'name can be at most 60 characters');
      if (util.findOne(tx, 'taxes', 'name = {:n} && id != {:i}', { n: name, i: r.id || '' }) !== null) throw util.fail(400, 'There is already a tax rate named ' + name);
      r.set('name', name);
    }
    if (id === '' || util.has(p, 'rate')) {
      const rate = util.number(p, 'rate', { required: true, min: 0, max: 100, example: '8.875' });
      if (Math.round(rate * 10000) / 10000 !== rate) throw util.fail(400, 'rate can have at most 4 decimals');
      r.set('rate', rate);
    }
    const makeDefault = util.bool(p, 'is_default', id === '' ? defaultTax(tx) === null : r.getBool('is_default'));
    if (makeDefault) {
      for (const other of tx.findRecordsByFilter('taxes', 'is_default = true && id != {:i}', '', 0, 0, { i: r.id || '' })) {
        other.set('is_default', false);
        tx.save(other);
      }
    }
    r.set('is_default', makeDefault);
    tx.save(r);
    audit().log(tx, 'settings', c, { approver: approver, detail: 'Tax rate ' + (before === null ? 'added: ' : 'changed: ') + r.getString('name') + ' ' + util.fmt(r.getFloat('rate')) + '%' + (before !== null && before.rate !== r.getFloat('rate') ? ' (was ' + util.fmt(before.rate) + '%)' : '') });
    out = r;
  });
  return { tax: taxJson(out) };
}

/* -------------------------------------------------------- modifier groups */

function groupJson(r, money) {
  const opts = u().getJson(r, 'options') || [];
  return {
    id: r.id,
    name: r.getString('name'),
    min: r.getInt('min'),
    max: r.getInt('max'),
    sort: r.getInt('sort'),
    options: opts.map((o) => ({ id: o.id, name: o.name, price: o.price, price_text: money.plain(o.price) })),
  };
}

function modifiersList(app) {
  const money = moneyOf(auth().settingsRow(app));
  return { modifier_groups: app.findRecordsByFilter('modifier_groups', '', 'sort,name', 0, 0).map((r) => groupJson(r, money)) };
}

function modifiersSave(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_catalog', p, { what: 'Editing options' });
  const money = moneyOf(c.settings);
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('modifier_groups')) : util.byId(tx, 'modifier_groups', id);
    if (r === null) throw util.fail(404, 'No option group ' + id);
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', 'Milk'));
      if (name.length > 60) throw util.fail(400, 'name can be at most 60 characters');
      if (util.findOne(tx, 'modifier_groups', 'name = {:n} && id != {:i}', { n: name, i: r.id || '' }) !== null) throw util.fail(400, 'There is already an option group named ' + name);
      r.set('name', name);
    }
    if (id === '' || util.has(p, 'options')) {
      const list = util.list(p, 'options', '[{"name": "Oat", "price": "0.50"}, {"name": "Whole", "price": "0"}]');
      if (!list || list.length === 0) throw util.fail(400, 'options needs at least one option');
      if (list.length > 60) throw util.fail(400, 'At most 60 options in a group');
      const old = util.getJson(r, 'options') || [];
      const seen = {};
      const opts = list.map((o, i) => {
        const name = util.squash(o && o.name);
        if (name === '' || name.length > 60) throw util.fail(400, 'options[' + i + '].name must be 1 to 60 characters');
        if (seen[name.toLowerCase()]) throw util.fail(400, 'Option "' + name + '" is listed twice');
        seen[name.toLowerCase()] = true;
        const price = o.price === undefined || o.price === null || o.price === '' ? 0 : money.toMinor(o.price, 'options[' + i + '].price');
        const keep = typeof o.id === 'string' && old.some((x) => x.id === o.id);
        return { id: keep ? o.id : 'm' + $security.randomStringWithAlphabet(9, 'abcdefghijklmnopqrstuvwxyz0123456789'), name: name, price: price };
      });
      r.set('options', opts);
    }
    const min = util.int(p, 'min', id === '' ? 0 : r.getInt('min'), 0, 50);
    const max = util.int(p, 'max', id === '' ? 1 : r.getInt('max'), 0, 50);
    if (max !== 0 && min > max) throw util.fail(400, 'min cannot be more than max (max 0 means any number)');
    const count = (util.getJson(r, 'options') || []).length;
    if (min > count) throw util.fail(400, 'min cannot be more than the number of options (' + count + ')');
    r.set('min', min);
    r.set('max', max);
    if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, -100000, 100000));
    tx.save(r);
    audit().log(tx, 'catalog', c, { approver: approver, detail: (id === '' ? 'Option group added: ' : 'Option group changed: ') + r.getString('name') });
    out = r;
  });
  return { modifier_group: groupJson(out, money) };
}

/* --------------------------------------------------------------- products */

function stockStatus(v, s) {
  if (!v.getBool('track_stock')) return 'untracked';
  const qty = v.getFloat('stock');
  const low = v.getFloat('low_at') > 0 ? v.getFloat('low_at') : s.getFloat('low_stock_default');
  if (qty <= 0) return 'out';
  if (qty <= low) return 'low';
  return 'in';
}

function variantJson(v, s, money) {
  return {
    id: v.id,
    title: v.getString('title'),
    options: u().getJson(v, 'options') || [],
    sku: v.getString('sku'),
    barcode: v.getString('barcode'),
    price: v.getInt('price'),
    price_text: money.plain(v.getInt('price')),
    cost: v.getFloat('cost'),
    cost_text: money.plain(Math.round(v.getFloat('cost'))),
    track_stock: v.getBool('track_stock'),
    stock: v.getFloat('stock'),
    low_at: v.getFloat('low_at'),
    status: stockStatus(v, s),
    archived: v.getBool('archived'),
  };
}

/** Lookups shared by product answers, read once per request. */
function lookups(app) {
  const s = auth().settingsRow(app);
  const money = moneyOf(s);
  const cats = {};
  for (const r of app.findRecordsByFilter('categories', '', '', 0, 0)) cats[r.id] = categoryJson(r);
  const taxes = {};
  let def = null;
  for (const r of app.findRecordsByFilter('taxes', '', '', 0, 0)) {
    taxes[r.id] = taxJson(r);
    if (r.getBool('is_default')) def = taxes[r.id];
  }
  const groups = {};
  for (const r of app.findRecordsByFilter('modifier_groups', '', '', 0, 0)) groups[r.id] = groupJson(r, money);
  return { s: s, money: money, cats: cats, taxes: taxes, defaultTax: def, groups: groups };
}

/** The tax a product sells with: exempt, its own rate, or the store default. */
function effectiveTax(prod, L) {
  if (prod.getBool('tax_exempt')) return null;
  const own = prod.getString('tax');
  if (own !== '' && L.taxes[own]) return L.taxes[own];
  return L.defaultTax;
}

function productJson(app, prod, L, variants) {
  const util = u();
  const vs = (variants || app.findRecordsByFilter('variants', 'product = {:p}', 'position', 0, 0, { p: prod.id })).map((v) => variantJson(v, L.s, L.money));
  const live = vs.filter((v) => !v.archived);
  const prices = live.map((v) => v.price);
  const image = prod.getString('image');
  const tax = effectiveTax(prod, L);
  return {
    id: prod.id,
    name: prod.getString('name'),
    category: prod.getString('category') === '' ? null : L.cats[prod.getString('category')] || null,
    description: prod.getString('description'),
    image: image === '' ? '' : util.fileUrl(prod, 'image'),
    color: prod.getString('color') || 'neutral',
    tax: tax,
    tax_own: prod.getString('tax'),
    tax_exempt: prod.getBool('tax_exempt'),
    modifier_groups: prod.getStringSlice('modifier_groups').map((id) => L.groups[id]).filter((g) => g !== undefined),
    option_names: util.getJson(prod, 'option_names') || [],
    sold_by: prod.getString('sold_by') || 'each',
    unit: prod.getString('unit'),
    favorite: prod.getBool('favorite'),
    sort: prod.getInt('sort'),
    archived: prod.getBool('archived'),
    variants: vs,
    price_min: prices.length ? Math.min.apply(null, prices) : 0,
    price_max: prices.length ? Math.max.apply(null, prices) : 0,
    stock: live.filter((v) => v.track_stock).reduce((a, v) => a + v.stock, 0),
    tracks_stock: live.some((v) => v.track_stock),
    status: worst(live.map((v) => v.status)),
    updated: prod.getString('updated'),
  };
}

function worst(list) {
  for (const k of ['out', 'low', 'in']) if (list.indexOf(k) >= 0) return k;
  return 'untracked';
}

function productsList(app, e, p) {
  const util = u();
  const L = lookups(app);
  const filters = [];
  const bind = {};
  const archived = util.bool(p, 'archived', false);
  filters.push('archived = {:ar}');
  bind.ar = archived;
  const q = util.str(p, 'q', '');
  if (q !== '') {
    const ids = util.rows(app, "SELECT DISTINCT product AS id FROM variants WHERE sku LIKE {:q} OR barcode = {:exact} OR title LIKE {:q}", { id: '' }, { q: '%' + q + '%', exact: q }).map((x) => x.id);
    const names = app.findRecordsByFilter('products', 'name ~ {:q}', '', 2000, 0, { q: q }).map((x) => x.id);
    const all = names.concat(ids.filter((x) => names.indexOf(x) < 0));
    if (all.length === 0) return { products: [], total: 0, more: false };
    filters.push('(' + all.slice(0, 500).map((x, i) => 'id = {:i' + i + '}').join(' || ') + ')');
    all.slice(0, 500).forEach((x, i) => (bind['i' + i] = x));
  }
  const cat = util.str(p, 'category', '');
  if (cat === 'none') filters.push("category = ''");
  else if (cat !== '') {
    filters.push('category = {:c}');
    bind.c = cat;
  }
  if (util.bool(p, 'favorites', false)) filters.push('favorite = true');
  const sort = util.oneOf(p, 'sort', ['name', 'updated', 'sort'], 'name');
  const order = sort === 'updated' ? '-updated' : sort === 'sort' ? 'sort,name' : 'name';
  const rows = app.findRecordsByFilter('products', filters.join(' && '), order, 5000, 0, bind);
  const vmap = {};
  if (rows.length > 0) {
    const vrows = app.findRecordsByFilter('variants', '', 'position', 0, 0);
    for (const v of vrows) {
      const k = v.getString('product');
      if (!vmap[k]) vmap[k] = [];
      vmap[k].push(v);
    }
  }
  let list = rows.map((r) => productJson(app, r, L, vmap[r.id] || []));
  const stock = util.oneOf(p, 'stock', ['low', 'out', 'tracked'], '');
  if (stock === 'low') list = list.filter((x) => x.status === 'low' || x.status === 'out');
  if (stock === 'out') list = list.filter((x) => x.status === 'out');
  if (stock === 'tracked') list = list.filter((x) => x.tracks_stock);
  const limit = util.int(p, 'limit', 200, 1, 5000);
  const page = util.int(p, 'page', 1, 1, 100000);
  return { products: list.slice((page - 1) * limit, page * limit), total: list.length, more: list.length > page * limit };
}

/** Everything the register needs to sell, in one answer. */
function registerCatalog(app) {
  const L = lookups(app);
  const vmap = {};
  for (const v of app.findRecordsByFilter('variants', 'archived = false', 'position', 0, 0)) {
    const k = v.getString('product');
    if (!vmap[k]) vmap[k] = [];
    vmap[k].push(v);
  }
  const products = app
    .findRecordsByFilter('products', 'archived = false', 'sort,name', 0, 0)
    .map((r) => productJson(app, r, L, vmap[r.id] || []))
    .filter((x) => x.variants.length > 0);
  return {
    categories: Object.keys(L.cats)
      .map((k) => L.cats[k])
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    products: products,
    modifier_groups: Object.keys(L.groups).map((k) => L.groups[k]),
    taxes: Object.keys(L.taxes).map((k) => L.taxes[k]),
  };
}

function productsGet(app, p) {
  const util = u();
  const prod = productRef(app, util.req(p, 'product', '<product id or exact name>'));
  return { product: productJson(app, prod, lookups(app)) };
}

function productRef(db, ref) {
  const util = u();
  let r = util.byId(db, 'products', ref);
  if (r === null) {
    const rows = db.findRecordsByFilter('products', 'name = {:n}', '', 2, 0, { n: ref });
    if (rows.length > 1) throw util.fail(400, 'More than one product is named "' + ref + '"; use its id');
    r = rows[0] || null;
  }
  if (r === null) throw util.fail(404, 'No product "' + ref + '" (see products.list)');
  return r;
}

/** The variant a scanned or typed code names: an exact SKU or barcode. */
function lookup(app, p) {
  const util = u();
  const code = util.req(p, 'code', '012345678905');
  const v = findCode(app, code);
  if (v === null) throw util.fail(404, 'No product has the code ' + code, { code: 'not_found' });
  const prod = app.findRecordById('products', v.getString('product'));
  const L = lookups(app);
  return { product: productJson(app, prod, L), variant: variantJson(v, L.s, L.money) };
}

function findCode(db, code) {
  const util = u();
  const c = String(code || '').trim();
  if (c === '') return null;
  return util.findOne(db, 'variants', 'archived = false && (barcode = {:c} || sku = {:c})', { c: c });
}

/** Refuse a code already used by another variant, as a SKU or a barcode. */
function checkCode(db, code, exceptId, what) {
  const util = u();
  if (code === '') return;
  if (code.length > 64) throw util.fail(400, what + ' can be at most 64 characters');
  if (/\s/.test(code)) throw util.fail(400, what + ' cannot contain spaces: "' + code + '"');
  const other = util.findOne(db, 'variants', '(barcode = {:c} || sku = {:c}) && id != {:i}', { c: code, i: exceptId || '' });
  if (other !== null) {
    const prod = util.byId(db, 'products', other.getString('product'));
    throw util.fail(400, 'The code ' + code + ' is already used by ' + (prod ? prod.getString('name') : 'another product') + (other.getString('title') ? ' (' + other.getString('title') + ')' : ''));
  }
}

function hasHistory(db, variantId) {
  return db.countRecords('order_lines', $dbx.exp('variant = {:v}', { v: variantId })) > 0 || db.countRecords('stock_moves', $dbx.exp('variant = {:v}', { v: variantId })) > 0;
}

/**
 * Create or change a product and its variants in one step. A product
 * without option_names has one variant (give price, sku, barcode, cost,
 * track_stock, low_at directly); with option_names, `variants` lists each
 * combination. Stock of new variants opens with `stock`; later stock moves
 * through stock.change.
 */
function productsSave(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_catalog', p, { what: 'Editing products' });
  const money = moneyOf(c.settings);
  const id = util.str(p, 'id', '');
  let saved = null;
  const notes = [];
  app.runInTransaction((tx) => {
    const prod = id === '' ? new Record(tx.findCollectionByNameOrId('products')) : util.byId(tx, 'products', id);
    if (prod === null) throw util.fail(404, 'No product ' + id);
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', '"Flat white"'));
      if (name.length > 120) throw util.fail(400, 'name can be at most 120 characters');
      prod.set('name', name);
    }
    if (util.has(p, 'category')) {
      const ref = util.str(p, 'category', '');
      if (ref === '') prod.set('category', '');
      else {
        let cat = util.byId(tx, 'categories', ref);
        if (cat === null) cat = util.findOne(tx, 'categories', 'name = {:n}', { n: util.squash(ref) });
        if (cat === null) {
          cat = new Record(tx.findCollectionByNameOrId('categories'));
          cat.set('name', util.squash(ref).slice(0, 60));
          cat.set('color', 'neutral');
          cat.set('sort', tx.countRecords('categories'));
          tx.save(cat);
          notes.push('category ' + cat.getString('name') + ' created');
        }
        prod.set('category', cat.id);
      }
    }
    if (util.has(p, 'description')) prod.set('description', util.str(p, 'description', '').slice(0, 2000));
    if (util.has(p, 'color') || id === '') prod.set('color', util.oneOf(p, 'color', COLORS, prod.getString('color') || 'neutral'));
    if (util.has(p, 'tax')) {
      const ref = util.str(p, 'tax', '');
      if (ref === '' || ref === 'default') prod.set('tax', '');
      else {
        let t = util.byId(tx, 'taxes', ref);
        if (t === null) t = util.findOne(tx, 'taxes', 'name = {:n}', { n: ref });
        if (t === null) throw util.fail(404, 'No tax rate "' + ref + '" (see taxes.list)');
        prod.set('tax', t.id);
      }
    }
    if (util.has(p, 'tax_exempt')) prod.set('tax_exempt', util.bool(p, 'tax_exempt', false));
    if (util.has(p, 'modifier_groups')) {
      const list = util.list(p, 'modifier_groups', '["<option group id>"]') || [];
      const ids = list.map((ref, i) => {
        let g = util.byId(tx, 'modifier_groups', String(ref));
        if (g === null) g = util.findOne(tx, 'modifier_groups', 'name = {:n}', { n: String(ref) });
        if (g === null) throw util.fail(404, 'modifier_groups[' + i + ']: no option group "' + ref + '"');
        return g.id;
      });
      prod.set('modifier_groups', ids.filter((x, i) => ids.indexOf(x) === i));
    }
    if (util.has(p, 'sold_by') || id === '') prod.set('sold_by', util.oneOf(p, 'sold_by', ['each', 'weight'], prod.getString('sold_by') || 'each'));
    if (util.has(p, 'unit')) prod.set('unit', util.squash(util.str(p, 'unit', '')).slice(0, 12));
    if (util.has(p, 'favorite')) prod.set('favorite', util.bool(p, 'favorite', false));
    if (util.has(p, 'sort')) prod.set('sort', util.int(p, 'sort', 0, -100000, 100000));
    if (util.has(p, 'archived')) prod.set('archived', util.bool(p, 'archived', false));
    const file = util.uploaded(e, 'image');
    if (file !== null) prod.set('image', file);
    if (util.bool(p, 'remove_image', false)) prod.set('image', null);

    // Options and variants.
    let optionNames = util.getJson(prod, 'option_names') || [];
    if (util.has(p, 'option_names')) {
      const list = util.list(p, 'option_names', '["Size", "Color"]') || [];
      if (list.length > 3) throw util.fail(400, 'At most 3 options (like Size, Color, Material)');
      optionNames = list.map((x, i) => {
        const n = util.squash(x);
        if (n === '' || n.length > 30) throw util.fail(400, 'option_names[' + i + '] must be 1 to 30 characters');
        return n;
      });
      if (optionNames.some((x, i) => optionNames.indexOf(x) !== i)) throw util.fail(400, 'An option is named twice');
      prod.set('option_names', optionNames);
    } else if (id === '') prod.set('option_names', []);
    tx.save(prod);

    const existing = tx.findRecordsByFilter('variants', 'product = {:p}', 'position', 0, 0, { p: prod.id });
    let incoming = null;
    if (util.has(p, 'variants')) incoming = util.list(p, 'variants', '[{"options": ["Large"], "price": "4.50", "sku": "LAT-L"}]');
    else if (optionNames.length === 0) {
      // A simple product: the variant fields come as top-level params.
      const keys = ['price', 'sku', 'barcode', 'cost', 'track_stock', 'low_at', 'stock'];
      if (id === '' || keys.some((k) => util.has(p, k))) {
        const one = existing.find((v) => !v.getBool('archived')) || null;
        const row = { id: one ? one.id : undefined };
        for (const k of keys) if (util.has(p, k)) row[k] = Array.isArray(p[k]) ? p[k][0] : p[k];
        incoming = [row];
      }
    }
    if (incoming !== null) saveVariants(tx, c, prod, optionNames, existing, incoming, money, id === '', notes);
    else if (util.has(p, 'option_names') && existing.filter((v) => !v.getBool('archived')).some((v) => (util.getJson(v, 'options') || []).length !== optionNames.length)) {
      throw util.fail(400, 'The options changed: give variants for the new options');
    }
    if (tx.countRecords('variants', $dbx.exp('product = {:p} AND archived = FALSE', { p: prod.id })) === 0 && !prod.getBool('archived')) {
      throw util.fail(400, 'A product needs at least one variant to sell (give price)');
    }
    audit().log(tx, 'catalog', c, { approver: approver, detail: (id === '' ? 'Product added: ' : 'Product changed: ') + prod.getString('name') + (notes.length ? ' (' + notes.join('; ') + ')' : '') });
    saved = prod;
  });
  return { product: productJson(app, app.findRecordById('products', saved.id), lookups(app)), notes: notes };
}

function saveVariants(tx, c, prod, optionNames, existing, incoming, money, isNew, notes) {
  const util = u();
  if (!Array.isArray(incoming) || incoming.length === 0) throw util.fail(400, 'variants needs at least one variant');
  if (incoming.length > 250) throw util.fail(400, 'At most 250 variants per product');
  if (optionNames.length === 0 && incoming.length !== 1) throw util.fail(400, 'A product without option_names has exactly one variant');
  const keep = {};
  const combos = {};
  const codes = {};
  incoming.forEach((row, i) => {
    const where = 'variants[' + i + ']';
    if (row === null || typeof row !== 'object') throw util.fail(400, where + ' must be an object');
    let v = null;
    if (row.id) {
      v = existing.find((x) => x.id === row.id) || null;
      if (v === null) throw util.fail(400, where + '.id is not a variant of this product');
    }
    const fresh = v === null;
    if (fresh) {
      v = new Record(tx.findCollectionByNameOrId('variants'));
      v.set('product', prod.id);
    }
    const opts = optionNames.length === 0 ? [] : Array.isArray(row.options) ? row.options.map((x) => util.squash(x)) : null;
    if (opts === null || opts.length !== optionNames.length || opts.some((x) => x === '' || x.length > 40)) {
      throw util.fail(400, where + '.options must list one value for each of: ' + optionNames.join(', '));
    }
    const combo = opts.join(' / ').toLowerCase();
    if (combos[combo]) throw util.fail(400, 'Two variants are ' + (opts.join(' / ') || 'the same'));
    combos[combo] = true;
    v.set('options', opts);
    v.set('title', opts.join(' / '));
    const priceGiven = row.price !== undefined && row.price !== null && row.price !== '';
    if (fresh && !priceGiven) throw util.fail(400, where + '.price is required, e.g. "4.50"');
    if (priceGiven) {
      const price = money.toMinor(row.price, where + '.price');
      if (price < 0) throw util.fail(400, where + '.price cannot be negative');
      if (!fresh && price !== v.getInt('price')) notes.push((v.getString('title') || 'price') + ' ' + money.plain(v.getInt('price')) + ' to ' + money.plain(price));
      v.set('price', price);
    }
    if (row.cost !== undefined && row.cost !== null && row.cost !== '') {
      const cost = money.toMinor(row.cost, where + '.cost');
      if (cost < 0) throw util.fail(400, where + '.cost cannot be negative');
      v.set('cost', cost);
    }
    for (const k of ['sku', 'barcode']) {
      if (row[k] === undefined || row[k] === null) continue;
      const code = String(row[k]).trim();
      if (code !== '') {
        if (codes[code.toLowerCase()]) throw util.fail(400, 'The code ' + code + ' is given twice');
        codes[code.toLowerCase()] = true;
      }
      checkCode(tx, code, v.id || '', where + '.' + k);
      v.set(k, code);
    }
    if (row.track_stock !== undefined) v.set('track_stock', row.track_stock === true || row.track_stock === 'true');
    else if (fresh) v.set('track_stock', row.stock !== undefined && row.stock !== '' && row.stock !== null);
    if (row.low_at !== undefined && row.low_at !== null && row.low_at !== '') {
      const n = Number(row.low_at);
      if (!isFinite(n) || n < 0) throw util.fail(400, where + '.low_at must be 0 or more');
      v.set('low_at', n);
    }
    v.set('position', i);
    v.set('archived', false);
    if (fresh) v.set('stock', 0);
    tx.save(v);
    keep[v.id] = true;
    if (row.stock !== undefined && row.stock !== null && row.stock !== '') {
      if (!fresh) throw util.fail(400, where + ': change the stock of an existing variant with stock.change (it keeps the history)');
      const qty = Number(row.stock);
      if (!isFinite(qty)) throw util.fail(400, where + '.stock must be a number');
      if (qty !== 0) {
        if (!v.getBool('track_stock')) {
          v.set('track_stock', true);
          tx.save(v);
        }
        require(`${__hooks}/lib_stock.js`).move(tx, c, v, qty, 'opening', { name: prod.getString('name'), unitCost: v.getFloat('cost'), note: 'Opening stock' });
      }
    }
  });
  for (const v of existing) {
    if (keep[v.id]) continue;
    if (hasHistory(tx, v.id)) {
      if (!v.getBool('archived')) {
        v.set('archived', true);
        tx.save(v);
        notes.push((v.getString('title') || 'variant') + ' archived (it has history)');
      }
    } else {
      tx.delete(tx.findRecordById('variants', v.id));
      if (!isNew) notes.push((v.getString('title') || 'variant') + ' removed');
    }
  }
}

module.exports = {
  COLORS: COLORS,
  categoryJson: categoryJson,
  categoriesList: categoriesList,
  categoriesSave: categoriesSave,
  taxJson: taxJson,
  taxesList: taxesList,
  taxesSave: taxesSave,
  defaultTax: defaultTax,
  groupJson: groupJson,
  modifiersList: modifiersList,
  modifiersSave: modifiersSave,
  stockStatus: stockStatus,
  variantJson: variantJson,
  lookups: lookups,
  effectiveTax: effectiveTax,
  productJson: productJson,
  productsList: productsList,
  registerCatalog: registerCatalog,
  productsGet: productsGet,
  productRef: productRef,
  lookup: lookup,
  findCode: findCode,
  checkCode: checkCode,
  hasHistory: hasHistory,
  productsSave: productsSave,
};
