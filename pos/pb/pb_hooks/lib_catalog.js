/// <reference path="../pb_data/types.d.ts" />
/**
 * The catalog: categories, products (with variants, barcodes and modifier
 * groups), modifier groups with their options, and preset discounts.
 *
 * History is never rewritten: a product or variant that was ever sold is
 * archived, not deleted (sale lines point at it); a sale line keeps its own
 * copy of the name, price, tax and category it was sold with.
 *
 * Scannable codes (product SKUs, variant SKUs and barcodes) are unique
 * together, so a scan always means one thing.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

function exp(app) {
  return core().exponent(core().settings(app).getString('currency'));
}

/* ------------------------------------------------------------ categories */

function serializeCategory(rec, count) {
  return {
    id: rec.id,
    name: rec.getString('name'),
    color: rec.getInt('color') || 1,
    icon: rec.getString('icon') || 'tag',
    sort: rec.getInt('sort'),
    kitchen: rec.getBool('kitchen'),
    products: count || 0,
  };
}

function listCategories(app) {
  const counts = {};
  for (const r of u().rows(app, "SELECT category, COUNT(id) AS n FROM products WHERE archived = false AND status = 'active' AND category != '' GROUP BY category", { category: '', n: 0 })) counts[r.category] = r.n;
  return {
    categories: app.findRecordsByFilter('categories', '', 'sort,name', 0, 0).map((r) => serializeCategory(r, counts[r.id])),
    icons: require(`${__hooks}/lib_icons.js`).ICONS,
  };
}

function saveCategory(app, rec, p, isNew, ctx) {
  const util = u();
  const icons = require(`${__hooks}/lib_icons.js`);
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"Coffee"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 40) throw util.fail(400, 'A category needs a name of at most 40 characters');
    const clash = util.idsNocase(app, 'categories', 'name', name, 2).filter((id) => id !== rec.id);
    if (clash.length > 0) throw util.fail(400, 'There is already a category called "' + name + '"');
    rec.set('name', name);
  }
  if (isNew || util.has(p, 'color')) {
    const dflt = (app.findRecordsByFilter('categories', '', '', 0, 0).length % 8) + 1;
    rec.set('color', util.int(p, 'color', isNew ? dflt : rec.getInt('color'), 1, 8));
  }
  if (isNew || util.has(p, 'icon')) {
    const icon = util.str(p, 'icon', '') || icons.DEFAULT_ICON;
    if (!icons.isIcon(icon)) throw util.fail(400, 'icon must be one of: ' + icons.ICONS.join(', '));
    rec.set('icon', icon);
  }
  if (isNew || util.has(p, 'kitchen')) rec.set('kitchen', util.bool(p, 'kitchen', isNew ? false : rec.getBool('kitchen')));
  if (isNew) rec.set('sort', util.scalarSql(app, 'SELECT IFNULL(MAX(sort), 0) + 1 AS v FROM categories'));
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: (isNew ? 'Added category ' : 'Changed category ') + rec.getString('name') });
  });
  return serializeCategory(rec, util.scalarSql(app, 'SELECT COUNT(id) AS v FROM products WHERE category = {:c} AND archived = false', { c: rec.id }));
}

/** Delete a category; its products stay, without a category. */
function deleteCategory(app, rec, ctx) {
  const util = u();
  const name = rec.getString('name');
  let moved = 0;
  app.runInTransaction((tx) => {
    for (const pr of tx.findRecordsByFilter('products', 'category = {:c}', '', 0, 0, { c: rec.id })) {
      pr.set('category', '');
      tx.save(pr);
      moved++;
    }
    tx.delete(tx.findRecordById('categories', rec.id));
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: name, summary: 'Deleted category ' + name + (moved > 0 ? ' (' + util.plural(moved, 'product') + ' now without a category)' : '') });
  });
  return { deleted: name, uncategorized: moved, message: util.squash('Deleted "' + name + '".' + (moved > 0 ? ' ' + util.plural(moved, 'product') + ' now without a category.' : '')) };
}

function reorderCategories(app, ids, ctx) {
  const util = u();
  app.runInTransaction((tx) => {
    ids.forEach((id, i) => {
      const rec = util.byId(tx, 'categories', String(id));
      if (rec === null) throw util.fail(404, 'No category "' + id + '"');
      rec.set('sort', i + 1);
      tx.save(rec);
    });
  });
  return listCategories(app);
}

/* -------------------------------------------------------------- products */

function stockMap(app, productIds) {
  const out = {};
  if (productIds.length === 0) return out;
  for (const r of u().rows(app, 'SELECT product, variant, qty FROM stock', { product: '', variant: '', qty: 0 })) {
    out[r.product + '|' + r.variant] = r.qty;
  }
  return out;
}

/** Serialize products with their variants, barcodes, groups and stock (batched). */
function serializeProducts(app, recs) {
  const util = u();
  const e = exp(app);
  const ids = recs.map((r) => r.id);
  const cats = {};
  for (const c of app.findRecordsByFilter('categories', '', '', 0, 0)) cats[c.id] = c;
  const taxes = {};
  for (const t of app.findRecordsByFilter('tax_classes', '', '', 0, 0)) taxes[t.id] = t;
  const variants = {};
  const codes = {};
  if (ids.length > 0) {
    for (const v of app.findRecordsByFilter('variants', 'archived = false', 'sort,created', 0, 0)) {
      const pid = v.getString('product');
      if (variants[pid] === undefined) variants[pid] = [];
      variants[pid].push(v);
    }
    for (const c of util.rows(app, 'SELECT code, product, variant FROM codes ORDER BY created', { code: '', product: '', variant: '' })) {
      if (codes[c.product] === undefined) codes[c.product] = [];
      codes[c.product].push({ code: c.code, variant: c.variant });
    }
  }
  const stock = stockMap(app, ids);
  return recs.map((r) => {
    const cat = cats[r.getString('category')];
    const tax = taxes[r.getString('tax_class')];
    const vs = (variants[r.id] || []).map((v) => ({
      id: v.id,
      name: v.getString('name'),
      price: v.getInt('price'),
      price_text: util.minorText(v.getInt('price'), e),
      sku: v.getString('sku'),
      cost: v.getInt('cost'),
      cost_text: util.minorText(v.getInt('cost'), e),
      sort: v.getInt('sort'),
      stock: r.getBool('track_stock') ? stock[r.id + '|' + v.id] || 0 : null,
    }));
    const tracked = r.getBool('track_stock');
    const onHand = tracked ? (vs.length > 0 ? vs.reduce((s, v) => s + (v.stock || 0), 0) : stock[r.id + '|'] || 0) : null;
    const photo = r.getString('photo');
    const low = r.getInt('low_stock');
    return {
      id: r.id,
      name: r.getString('name'),
      category: r.getString('category'),
      category_name: cat ? cat.getString('name') : '',
      price: r.getInt('price'),
      price_text: util.minorText(r.getInt('price'), e),
      open_price: r.getBool('open_price'),
      tax_class: r.getString('tax_class'),
      tax_name: tax ? tax.getString('name') : '',
      sku: r.getString('sku'),
      description: r.getString('description'),
      photo: photo,
      photo_url: photo !== '' ? '/api/files/products/' + r.id + '/' + photo : '',
      thumb_url: photo !== '' ? '/api/files/products/' + r.id + '/' + photo + '?thumb=160x160' : '',
      tile_url: photo !== '' ? '/api/files/products/' + r.id + '/' + photo + '?thumb=480x480' : '',
      color: r.getInt('color') || (cat ? cat.getInt('color') : 0) || 0,
      own_color: r.getInt('color'),
      icon: cat ? cat.getString('icon') || 'tag' : 'tag',
      kitchen: cat ? cat.getBool('kitchen') : false,
      cost: r.getInt('cost'),
      cost_text: util.minorText(r.getInt('cost'), e),
      available: r.getBool('available'),
      archived: r.getBool('archived'),
      status: r.getString('status'),
      track_stock: tracked,
      low_stock: low,
      stock: onHand,
      low: tracked && low > 0 && onHand !== null && onHand <= low,
      favorite: r.getBool('favorite'),
      sort: r.getInt('sort'),
      fav_sort: r.getInt('fav_sort'),
      modifier_groups: r.getStringSlice('modifier_groups'),
      variants: vs,
      barcodes: codes[r.id] || [],
      import_ref: r.getString('import_ref'),
      created: r.getString('created'),
      updated: r.getString('updated'),
    };
  });
}

function getProduct(app, rec) {
  const out = serializeProducts(app, [rec])[0];
  const util = u();
  const e = exp(app);
  const sold = util.rows(
    app,
    "SELECT IFNULL(SUM(l.qty), 0) AS qty, IFNULL(SUM(l.net), 0) AS net FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE l.product = {:p} AND s.training = false AND s.business_day >= {:d}",
    { qty: 0, net: 0 },
    { p: rec.id, d: util.addDays(util.today(), -29) },
  );
  out.sold_30d = { qty: sold[0].qty, net: sold[0].net, net_text: util.minorText(sold[0].net, e) };
  out.ever_sold = util.scalarSql(app, 'SELECT COUNT(id) AS v FROM sale_lines WHERE product = {:p}', { p: rec.id }) > 0;
  return out;
}

/**
 * Products for lists and the agent. q matches name, SKU, barcode or variant
 * SKU (any part, without case); `limit` 0 returns all.
 */
function listProducts(app, p) {
  const util = u();
  const q = util.str(p, 'q', '').toLowerCase();
  const category = util.str(p, 'category', '');
  const status = util.oneOf(p, 'status', ['active', 'draft', 'archived', 'all'], 'active');
  const availability = util.oneOf(p, 'availability', ['any', 'available', 'sold_out', 'low_stock'], 'any');
  const limit = util.int(p, 'limit', 0, 0, 5000);
  const filters = [];
  const bind = {};
  if (status === 'active') filters.push("status = 'active' && archived = false");
  else if (status === 'draft') filters.push("status = 'draft' && archived = false");
  else if (status === 'archived') filters.push('archived = true');
  if (category === 'none') filters.push("category = ''");
  else if (category !== '') {
    bind.c = core().category(app, category).id;
    filters.push('category = {:c}');
  }
  if (availability === 'available') filters.push('available = true');
  if (availability === 'sold_out') filters.push('available = false');
  let recs = app.findRecordsByFilter('products', filters.join(' && '), 'sort,name', 0, 0, bind);
  if (q !== '') {
    const codeHits = {};
    for (const r of util.rows(app, 'SELECT product FROM codes WHERE LOWER(code) LIKE {:q}', { product: '' }, { q: '%' + q + '%' })) codeHits[r.product] = true;
    for (const r of util.rows(app, 'SELECT product FROM variants WHERE LOWER(sku) LIKE {:q} OR LOWER(name) LIKE {:q}', { product: '' }, { q: '%' + q + '%' })) codeHits[r.product] = true;
    recs = recs.filter((r) => r.getString('name').toLowerCase().indexOf(q) >= 0 || r.getString('sku').toLowerCase().indexOf(q) >= 0 || codeHits[r.id] === true);
  }
  let out = serializeProducts(app, recs);
  if (availability === 'low_stock') out = out.filter((x) => x.low || (x.track_stock && x.stock !== null && x.stock <= 0));
  const total = out.length;
  if (limit > 0) out = out.slice(0, limit);
  const counts = {
    active: util.scalarSql(app, "SELECT COUNT(id) AS v FROM products WHERE status = 'active' AND archived = false"),
    draft: util.scalarSql(app, "SELECT COUNT(id) AS v FROM products WHERE status = 'draft' AND archived = false"),
    archived: util.scalarSql(app, 'SELECT COUNT(id) AS v FROM products WHERE archived = true'),
    sold_out: util.scalarSql(app, "SELECT COUNT(id) AS v FROM products WHERE status = 'active' AND archived = false AND available = false"),
  };
  return { products: out, total: total, counts: counts };
}

/** Everything the register needs to sell, in one call. */
function registerCatalog(app) {
  const util = u();
  const e = exp(app);
  const products = serializeProducts(app, app.findRecordsByFilter('products', "status = 'active' && archived = false", 'sort,name', 0, 0)).map((x) => ({
    id: x.id,
    name: x.name,
    category: x.category,
    price: x.price,
    open_price: x.open_price,
    tax_class: x.tax_class,
    sku: x.sku,
    thumb_url: x.thumb_url,
    tile_url: x.tile_url,
    color: x.color,
    icon: x.icon,
    kitchen: x.kitchen,
    available: x.available,
    favorite: x.favorite,
    sort: x.sort,
    fav_sort: x.fav_sort,
    modifier_groups: x.modifier_groups,
    track_stock: x.track_stock,
    stock: x.stock,
    low: x.low,
    variants: x.variants.map((v) => ({ id: v.id, name: v.name, price: v.price, sku: v.sku, stock: v.stock })),
    barcodes: x.barcodes,
  }));
  return {
    categories: listCategories(app).categories,
    products: products,
    groups: listGroups(app).groups,
    discounts: listDiscounts(app).discounts,
    currency_decimals: e,
    generated: util.nowIso(),
  };
}

/** A list of names or ids -> modifier group ids. */
function groupIds(app, values) {
  const out = [];
  for (const v of values) {
    const g = core().group(app, String(v));
    if (out.indexOf(g.id) < 0) out.push(g.id);
  }
  return out;
}

/** Barcodes from a param: a list of { code, variant? } or plain strings. */
function readBarcodes(p) {
  const raw = u().list(p, 'barcodes');
  if (raw === undefined) return undefined;
  return raw.map((b) => {
    if (typeof b === 'string') return { code: b.trim(), variant: '' };
    if (b && typeof b === 'object') return { code: String(b.code || '').trim(), variant: String(b.variant || b.variant_name || '') };
    throw u().fail(400, 'barcodes must be a list of codes, e.g. ["9555001234567"]');
  });
}

/**
 * Create or update a product. Variants given as a list replace the current
 * ones: entries with an id are updated, new ones created, and the rest
 * removed (archived if they were ever sold). Barcodes given replace too.
 */
function saveProduct(e, app, rec, p, isNew, ctx) {
  const util = u();
  const ex = exp(app);
  const changes = [];
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"Flat white"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 80) throw util.fail(400, 'A product needs a name of at most 80 characters');
    rec.set('name', name);
    changes.push('name');
  }
  if (util.has(p, 'category')) {
    const ref = util.str(p, 'category', '');
    rec.set('category', ref === '' ? '' : core().category(app, ref).id);
    changes.push('category');
  } else if (isNew) rec.set('category', '');
  if (isNew || util.has(p, 'price')) {
    const price = util.money(p, 'price', ex, {});
    rec.set('price', price === null ? 0 : price);
    if (!isNew) changes.push('price');
  }
  if (isNew || util.has(p, 'open_price')) rec.set('open_price', util.bool(p, 'open_price', isNew ? false : rec.getBool('open_price')));
  if (util.has(p, 'tax_class')) {
    const ref = util.str(p, 'tax_class', '');
    const t = ref === '' ? null : core().taxClass(app, ref);
    if (t !== null && t.getBool('archived')) throw util.fail(400, '"' + t.getString('name') + '" is archived');
    rec.set('tax_class', t === null ? '' : t.id);
    changes.push('tax class');
  } else if (isNew) {
    const d = util.findOne(app, 'tax_classes', 'is_default = true && archived = false', {});
    rec.set('tax_class', d === null ? '' : d.id);
  }
  if (isNew || util.has(p, 'sku')) {
    const sku = util.str(p, 'sku', '');
    if (sku.length > 40 || /\s/.test(sku)) throw util.fail(400, 'sku is up to 40 characters without spaces');
    if (sku !== '') {
      const owner = core().codeOwner(app, sku, rec.id || '');
      if (owner !== null) throw util.fail(400, 'The code "' + sku + '" is already used by ' + owner.label + '. Every scannable code must be unique.', 'code_taken');
    }
    rec.set('sku', sku);
  }
  if (isNew || util.has(p, 'description')) {
    const d = util.str(p, 'description', '');
    if (d.length > 500) throw util.fail(400, 'description can be at most 500 characters');
    rec.set('description', d);
  }
  if (isNew || util.has(p, 'color')) rec.set('color', util.int(p, 'color', isNew ? 0 : rec.getInt('color'), 0, 8));
  if (isNew || util.has(p, 'cost')) {
    // An empty cost clears it (0: unknown).
    const c = util.money(p, 'cost', ex, {});
    rec.set('cost', c === null ? 0 : c);
  }
  if (isNew || util.has(p, 'available')) rec.set('available', util.bool(p, 'available', isNew ? true : rec.getBool('available')));
  if (isNew || util.has(p, 'favorite')) {
    const fav = util.bool(p, 'favorite', isNew ? false : rec.getBool('favorite'));
    if (fav && !rec.getBool('favorite')) rec.set('fav_sort', util.scalarSql(app, 'SELECT IFNULL(MAX(fav_sort), 0) + 1 AS v FROM products'));
    rec.set('favorite', fav);
  }
  if (isNew || util.has(p, 'track_stock')) rec.set('track_stock', util.bool(p, 'track_stock', isNew ? false : rec.getBool('track_stock')));
  if (isNew || util.has(p, 'low_stock')) rec.set('low_stock', util.int(p, 'low_stock', isNew ? 0 : rec.getInt('low_stock'), 0, 1000000));
  if (util.has(p, 'modifier_groups')) {
    rec.set('modifier_groups', groupIds(app, util.list(p, 'modifier_groups') || []));
    changes.push('modifiers');
  } else if (isNew) rec.set('modifier_groups', []);
  if (isNew) {
    const st = util.oneOf(p, 'status', ['active', 'draft'], 'active');
    rec.set('status', st);
    rec.set('archived', false);
    rec.set('sort', util.scalarSql(app, 'SELECT IFNULL(MAX(sort), 0) + 1 AS v FROM products'));
    rec.set('import_ref', util.str(p, 'import_ref', '').slice(0, 20));
  }
  const photo = util.uploaded(e, 'photo');
  if (photo !== null) rec.set('photo', photo);
  else if (util.str(p, 'photo_path', '') !== '') rec.set('photo', util.localFile(util.str(p, 'photo_path', ''), 'photo_path'));
  else if (util.bool(p, 'clear_photo', false)) rec.set('photo', null);

  // Variants and barcodes, checked before anything is written.
  const variantsIn = util.list(p, 'variants');
  const barcodesIn = readBarcodes(p);
  if (variantsIn !== undefined) {
    const seen = {};
    variantsIn.forEach((v, i) => {
      if (!v || typeof v !== 'object') throw util.fail(400, 'variants must be a list like [{"name":"Large","price":"5.50"}]');
      const n = util.squash(String(v.name || ''));
      if (n === '' || n.length > 40) throw util.fail(400, 'Variant ' + (i + 1) + ' needs a name of at most 40 characters');
      if (seen[n.toLowerCase()]) throw util.fail(400, 'Two variants are called "' + n + '"');
      seen[n.toLowerCase()] = true;
      const price = util.toMinor(String(v.price === undefined || v.price === null ? '' : v.price), ex, false);
      if (price === null) throw util.fail(400, 'Variant "' + n + '" needs a price like ' + (ex === 0 ? '500' : '4.50'));
      const sku = String(v.sku || '').trim();
      if (sku !== '') {
        const owner = core().codeOwner(app, sku, rec.id || '');
        if (owner !== null) throw util.fail(400, 'The code "' + sku + '" is already used by ' + owner.label + '.', 'code_taken');
        if (sku.toLowerCase() === String(rec.getString('sku')).toLowerCase()) throw util.fail(400, 'Variant "' + n + '" cannot share the product SKU');
      }
    });
    if (variantsIn.length > 50) throw util.fail(400, 'A product can have at most 50 variants');
    changes.push('variants');
  }
  if (barcodesIn !== undefined) {
    const seen = {};
    for (const b of barcodesIn) {
      if (b.code === '' || b.code.length > 64) throw util.fail(400, 'A barcode is 1 to 64 characters');
      if (seen[b.code.toLowerCase()]) throw util.fail(400, 'The barcode "' + b.code + '" is listed twice');
      seen[b.code.toLowerCase()] = true;
      const owner = core().codeOwner(app, b.code, rec.id || '');
      if (owner !== null) throw util.fail(400, 'The barcode "' + b.code + '" is already used by ' + owner.label + '.', 'code_taken');
      if (b.code.toLowerCase() === String(rec.getString('sku')).toLowerCase()) throw util.fail(400, 'The barcode "' + b.code + '" is this product\'s SKU already');
    }
    changes.push('barcodes');
  }
  const opening = isNew && rec.getBool('track_stock') ? util.int(p, 'stock', 0, -1000000, 1000000) : 0;

  app.runInTransaction((tx) => {
    tx.save(rec);
    const variantIdByName = {};
    if (variantsIn !== undefined) {
      const existing = tx.findRecordsByFilter('variants', 'product = {:p} && archived = false', '', 0, 0, { p: rec.id });
      const keep = {};
      const vcoll = tx.findCollectionByNameOrId('variants');
      variantsIn.forEach((v, i) => {
        let vr = null;
        if (v.id) {
          vr = existing.filter((x) => x.id === String(v.id))[0] || null;
          if (vr === null) throw util.fail(400, 'Variant "' + v.id + '" is not a variant of this product');
        } else {
          const same = existing.filter((x) => x.getString('name').toLowerCase() === util.squash(String(v.name)).toLowerCase())[0];
          vr = same || new Record(vcoll);
          if (!same) {
            vr.set('product', rec.id);
            vr.set('archived', false);
          }
        }
        vr.set('name', util.squash(String(v.name)));
        vr.set('price', util.toMinor(String(v.price), ex, false));
        vr.set('sku', String(v.sku || '').trim());
        // Left out keeps the cost; empty clears it.
        const cost = v.cost === undefined || v.cost === null ? vr.getInt('cost') : String(v.cost).trim() === '' ? 0 : util.toMinor(String(v.cost), ex, false);
        if (cost === null) throw util.fail(400, 'Variant "' + v.name + '" has a cost that is not an amount');
        vr.set('cost', cost);
        vr.set('sort', i + 1);
        tx.save(vr);
        keep[vr.id] = true;
        variantIdByName[vr.getString('name').toLowerCase()] = vr.id;
      });
      for (const old of existing) {
        if (keep[old.id]) continue;
        const sold = u().scalarSql(tx, 'SELECT COUNT(id) AS v FROM sale_lines WHERE variant = {:v}', { v: old.id }) > 0;
        if (sold) {
          old.set('archived', true);
          tx.save(old);
        } else {
          tx.delete(tx.findRecordById('variants', old.id));
        }
      }
    } else {
      for (const v of tx.findRecordsByFilter('variants', 'product = {:p} && archived = false', '', 0, 0, { p: rec.id })) variantIdByName[v.getString('name').toLowerCase()] = v.id;
    }
    if (barcodesIn !== undefined) {
      for (const old of tx.findRecordsByFilter('codes', 'product = {:p}', '', 0, 0, { p: rec.id })) tx.delete(tx.findRecordById('codes', old.id));
      const ccoll = tx.findCollectionByNameOrId('codes');
      for (const b of barcodesIn) {
        const c = new Record(ccoll);
        c.set('code', b.code);
        c.set('product', rec.id);
        let vid = '';
        if (b.variant !== '') {
          vid = variantIdByName[b.variant.toLowerCase()] || (u().byId(tx, 'variants', b.variant) !== null ? b.variant : '');
          if (vid === '') throw util.fail(400, 'The barcode "' + b.code + '" names a variant this product does not have: "' + b.variant + '"');
        }
        c.set('variant', vid);
        tx.save(c);
      }
    }
    if (opening !== 0) {
      const vids = Object.keys(variantIdByName).map((k) => variantIdByName[k]);
      require(`${__hooks}/lib_stock.js`).post(tx, {
        product: rec.id,
        variant: vids.length > 0 ? vids[0] : '',
        qty: opening,
        kind: 'receive',
        reason: 'Opening stock',
        staff: ctx.staff ? ctx.staff.id : '',
        actor: ctx.actor,
      });
    }
    core().audit(tx, {
      kind: 'catalog_change',
      actor: ctx.actor,
      staff: ctx.staff ? ctx.staff.id : '',
      ref: rec.getString('name'),
      summary: isNew ? 'Added product ' + rec.getString('name') + (rec.getString('status') === 'draft' ? ' (to review)' : '') : 'Changed ' + rec.getString('name') + (changes.length > 0 ? ': ' + changes.join(', ') : ''),
    });
  });
  return getProduct(app, app.findRecordById('products', rec.id));
}

function setAvailable(app, rec, available, ctx) {
  rec.set('available', available);
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: rec.getString('name') + (available ? ' is back' : ' is sold out') });
  });
  return { id: rec.id, name: rec.getString('name'), available: available };
}

function setArchived(app, rec, archived, ctx) {
  rec.set('archived', archived);
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: (archived ? 'Archived ' : 'Restored ') + rec.getString('name') });
  });
  return { id: rec.id, name: rec.getString('name'), archived: archived };
}

/** Reorder products in a category (or favorites): ids in their new order. */
function reorderProducts(app, ids, favorites) {
  const util = u();
  app.runInTransaction((tx) => {
    ids.forEach((id, i) => {
      const rec = util.byId(tx, 'products', String(id));
      if (rec === null) throw util.fail(404, 'No product "' + id + '"');
      rec.set(favorites ? 'fav_sort' : 'sort', i + 1);
      tx.save(rec);
    });
  });
  return { ok: true, count: ids.length };
}

/** Products the AI agent imported, reviewed by a person: make them sellable, or throw them away. */
function reviewDrafts(app, ids, approve, ctx) {
  const util = u();
  let done = 0;
  const names = [];
  app.runInTransaction((tx) => {
    for (const id of ids) {
      const rec = util.byId(tx, 'products', String(id));
      if (rec === null) throw util.fail(404, 'No product "' + id + '"');
      if (rec.getString('status') !== 'draft') continue;
      names.push(rec.getString('name'));
      if (approve) {
        rec.set('status', 'active');
        tx.save(rec);
      } else {
        tx.delete(tx.findRecordById('products', rec.id));
      }
      done++;
    }
    if (done > 0) {
      core().audit(tx, {
        kind: 'catalog_change',
        actor: ctx.actor,
        staff: ctx.staff ? ctx.staff.id : '',
        ref: approve ? 'approve' : 'discard',
        summary: (approve ? 'Added ' : 'Discarded ') + done + ' imported product' + (done === 1 ? '' : 's') + ': ' + names.slice(0, 6).join(', ') + (names.length > 6 ? ', ...' : ''),
      });
    }
  });
  return { done: done, approved: approve };
}

/* ------------------------------------------------------ modifier groups */

function listGroups(app) {
  const util = u();
  const e = exp(app);
  const options = {};
  for (const m of app.findRecordsByFilter('modifiers', '', 'sort,created', 0, 0)) {
    const g = m.getString('modifier_group');
    if (options[g] === undefined) options[g] = [];
    options[g].push({
      id: m.id,
      name: m.getString('name'),
      price: m.getInt('price'),
      price_text: util.minorText(m.getInt('price'), e),
      is_default: m.getBool('is_default'),
      available: m.getBool('available'),
      sort: m.getInt('sort'),
    });
  }
  const used = {};
  for (const pr of app.findRecordsByFilter('products', 'archived = false', '', 0, 0)) {
    for (const g of pr.getStringSlice('modifier_groups')) used[g] = (used[g] || 0) + 1;
  }
  return {
    groups: app.findRecordsByFilter('modifier_groups', '', 'sort,name', 0, 0).map((g) => ({
      id: g.id,
      name: g.getString('name'),
      min: g.getInt('min'),
      max: g.getInt('max'),
      sort: g.getInt('sort'),
      options: options[g.id] || [],
      products: used[g.id] || 0,
    })),
  };
}

/**
 * Create or update a modifier group with its options. Options given replace
 * the current ones (by id, else by name); an option sold before stays
 * correct on old receipts because sale lines keep their own copy.
 */
function saveGroup(app, rec, p, isNew, ctx) {
  const util = u();
  const ex = exp(app);
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"Milk"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 40) throw util.fail(400, 'A modifier group needs a name of at most 40 characters');
    const clash = util.idsNocase(app, 'modifier_groups', 'name', name, 2).filter((id) => id !== rec.id);
    if (clash.length > 0) throw util.fail(400, 'There is already a modifier group called "' + name + '"');
    rec.set('name', name);
  }
  const min = util.int(p, 'min', isNew ? 0 : rec.getInt('min'), 0, 20);
  const max = util.int(p, 'max', isNew ? 1 : rec.getInt('max'), 0, 20);
  if (max !== 0 && min > max) throw util.fail(400, 'min (how many must be picked) cannot be more than max (how many may be picked; 0 for no limit)');
  rec.set('min', min);
  rec.set('max', max);
  if (isNew) rec.set('sort', util.scalarSql(app, 'SELECT IFNULL(MAX(sort), 0) + 1 AS v FROM modifier_groups'));
  const optsIn = util.list(p, 'options');
  if (isNew && (optsIn === undefined || optsIn.length === 0)) throw util.fail(400, 'options is required, e.g. [{"name":"Oat milk","price":"1.00"},{"name":"Soy milk","price":"1.00"}]');
  if (optsIn !== undefined) {
    if (optsIn.length === 0) throw util.fail(400, 'A modifier group needs at least one option');
    if (optsIn.length > 40) throw util.fail(400, 'A modifier group can have at most 40 options');
    const seen = {};
    let defaults = 0;
    optsIn.forEach((o, i) => {
      if (!o || typeof o !== 'object') throw util.fail(400, 'options must be a list like [{"name":"Oat milk","price":"1.00"}]');
      const n = util.squash(String(o.name || ''));
      if (n === '' || n.length > 40) throw util.fail(400, 'Option ' + (i + 1) + ' needs a name of at most 40 characters');
      if (seen[n.toLowerCase()]) throw util.fail(400, 'Two options are called "' + n + '"');
      seen[n.toLowerCase()] = true;
      const price = o.price === undefined || o.price === null || String(o.price) === '' ? 0 : util.toMinor(String(o.price), ex, true);
      if (price === null) throw util.fail(400, 'Option "' + n + '" has a price that is not an amount (it may be negative, e.g. -1.00)');
      if (o.is_default === true || o.is_default === 'true') defaults++;
    });
    if (max !== 0 && defaults > max) throw util.fail(400, 'More options are picked by default than may be picked (' + max + ')');
    if (min > optsIn.length) throw util.fail(400, 'min is more than the number of options');
  } else if (min > util.scalarSql(app, 'SELECT COUNT(id) AS v FROM modifiers WHERE modifier_group = {:g}', { g: rec.id })) {
    throw util.fail(400, 'min is more than the number of options');
  }
  app.runInTransaction((tx) => {
    tx.save(rec);
    if (optsIn !== undefined) {
      const existing = tx.findRecordsByFilter('modifiers', 'modifier_group = {:g}', '', 0, 0, { g: rec.id });
      const keep = {};
      const coll = tx.findCollectionByNameOrId('modifiers');
      optsIn.forEach((o, i) => {
        const name = util.squash(String(o.name));
        let m = o.id ? existing.filter((x) => x.id === String(o.id))[0] || null : existing.filter((x) => x.getString('name').toLowerCase() === name.toLowerCase())[0] || null;
        if (o.id && m === null) throw util.fail(400, 'Option "' + o.id + '" is not in this group');
        if (m === null) {
          m = new Record(coll);
          m.set('modifier_group', rec.id);
          m.set('available', true);
        }
        m.set('name', name);
        m.set('price', o.price === undefined || o.price === null || String(o.price) === '' ? 0 : util.toMinor(String(o.price), ex, true));
        m.set('is_default', o.is_default === true || o.is_default === 'true');
        if (o.available !== undefined) m.set('available', o.available === true || o.available === 'true');
        m.set('sort', i + 1);
        tx.save(m);
        keep[m.id] = true;
      });
      for (const old of existing) if (!keep[old.id]) tx.delete(tx.findRecordById('modifiers', old.id));
    }
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: (isNew ? 'Added modifier group ' : 'Changed modifier group ') + rec.getString('name') });
  });
  const out = listGroups(app).groups.filter((g) => g.id === rec.id)[0];
  return out;
}

function deleteGroup(app, rec, ctx) {
  const name = rec.getString('name');
  let detached = 0;
  app.runInTransaction((tx) => {
    for (const pr of tx.findRecordsByFilter('products', '', '', 0, 0)) {
      const gs = pr.getStringSlice('modifier_groups');
      if (gs.indexOf(rec.id) < 0) continue;
      pr.set('modifier_groups', gs.filter((g) => g !== rec.id));
      tx.save(pr);
      detached++;
    }
    for (const m of tx.findRecordsByFilter('modifiers', 'modifier_group = {:g}', '', 0, 0, { g: rec.id })) tx.delete(tx.findRecordById('modifiers', m.id));
    tx.delete(tx.findRecordById('modifier_groups', rec.id));
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: name, summary: 'Deleted modifier group ' + name + (detached > 0 ? ' (removed from ' + u().plural(detached, 'product') + ')' : '') });
  });
  return { deleted: name, products: detached };
}

function setOptionAvailable(app, rec, available, ctx) {
  rec.set('available', available);
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: rec.getString('name') + (available ? ' is back' : ' is sold out') });
  });
  return { id: rec.id, name: rec.getString('name'), available: available };
}

/* ------------------------------------------------------------ discounts */

function serializeDiscount(rec, e) {
  const util = u();
  const kind = rec.getString('kind');
  return {
    id: rec.id,
    name: rec.getString('name'),
    kind: kind,
    value: rec.getInt('value'),
    value_text: kind === 'percent' ? util.bpText(rec.getInt('value')) : util.minorText(rec.getInt('value'), e),
    scope: rec.getString('scope'),
    sort: rec.getInt('sort'),
  };
}

function listDiscounts(app) {
  const e = exp(app);
  return { discounts: app.findRecordsByFilter('discounts', '', 'sort,name', 0, 0).map((d) => serializeDiscount(d, e)) };
}

function saveDiscount(app, rec, p, isNew, ctx) {
  const util = u();
  const ex = exp(app);
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(isNew ? util.req(p, 'name', '"Staff 20%"') : util.str(p, 'name', ''));
    if (name === '' || name.length > 40) throw util.fail(400, 'A discount needs a name of at most 40 characters');
    rec.set('name', name);
  }
  const kind = util.oneOf(p, 'kind', ['percent', 'amount'], isNew ? '' : rec.getString('kind'));
  if (kind === '') throw util.fail(400, 'kind is required: percent or amount');
  rec.set('kind', kind);
  if (isNew || util.has(p, 'value') || util.has(p, 'kind')) {
    const value = kind === 'percent' ? util.percent(p, 'value', null, 10000) : util.money(p, 'value', ex, {});
    if (value === null || value <= 0) throw util.fail(400, 'value is required: a percentage like 10, or an amount like ' + (ex === 0 ? '100' : '2.00'));
    rec.set('value', value);
  }
  rec.set('scope', util.oneOf(p, 'scope', ['order', 'item'], isNew ? 'order' : rec.getString('scope')));
  if (isNew) rec.set('sort', util.scalarSql(app, 'SELECT IFNULL(MAX(sort), 0) + 1 AS v FROM discounts'));
  app.runInTransaction((tx) => {
    tx.save(rec);
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: (isNew ? 'Added discount ' : 'Changed discount ') + rec.getString('name') });
  });
  return serializeDiscount(rec, ex);
}

function deleteDiscount(app, rec, ctx) {
  const name = rec.getString('name');
  app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('discounts', rec.id));
    core().audit(tx, { kind: 'catalog_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: name, summary: 'Deleted discount ' + name });
  });
  return { deleted: name };
}

/* --------------------------------------------------------------- lookup */

/** What a scanned or typed code is: a product (and variant), a receipt, or nothing. */
function lookup(app, code) {
  const util = u();
  const c = String(code || '').trim();
  if (c === '') throw util.fail(400, 'code is required');
  const bc = util.rows(app, 'SELECT product, variant FROM codes WHERE LOWER(code) = LOWER({:c}) LIMIT 1', { product: '', variant: '' }, { c: c });
  let productId = '';
  let variantId = '';
  let via = '';
  if (bc.length > 0) {
    productId = bc[0].product;
    variantId = bc[0].variant;
    via = 'barcode';
  } else {
    const ps = util.rows(app, 'SELECT id FROM products WHERE LOWER(sku) = LOWER({:c}) LIMIT 1', { id: '' }, { c: c });
    if (ps.length > 0) {
      productId = ps[0].id;
      via = 'sku';
    } else {
      const vs = util.rows(app, 'SELECT id, product FROM variants WHERE LOWER(sku) = LOWER({:c}) AND archived = false LIMIT 1', { id: '', product: '' }, { c: c });
      if (vs.length > 0) {
        productId = vs[0].product;
        variantId = vs[0].id;
        via = 'variant sku';
      }
    }
  }
  if (productId !== '') {
    const rec = util.byId(app, 'products', productId);
    if (rec !== null) return { type: 'product', via: via, code: c, product: serializeProducts(app, [rec])[0], variant: variantId };
  }
  const sale = util.findOne(app, 'sales', 'number = {:n} || ref = {:n}', { n: c.toUpperCase() });
  if (sale !== null) return { type: 'sale', code: c, sale: { id: sale.id, number: sale.getString('number'), kind: sale.getString('kind') } };
  return { type: 'none', code: c, message: 'Nothing has the code "' + c + '". Give it to a product with products.update --product <id> --barcodes \'["' + c + '"]\'.' };
}

/* --------------------------------------------------------------- import */

/**
 * Many products at once (a spreadsheet the counter mapped, or a menu the AI
 * agent read). Rows: { name, category, price, sku, barcode, cost,
 * description, tax_class, variants: [{ name, price }], track_stock, stock }.
 * Categories named in the rows are created when missing. Nothing is saved
 * if any row is wrong; the error names the row.
 */
function importRows(e, app, rows, status, importRef, ctx) {
  const util = u();
  const ex = exp(app);
  if (!Array.isArray(rows) || rows.length === 0) throw util.fail(400, 'rows is required: a list like [{"name":"Latte","category":"Coffee","price":"4.50"}]');
  if (rows.length > 1000) throw util.fail(400, 'At most 1000 rows at a time');
  const taxDefault = util.findOne(app, 'tax_classes', 'is_default = true && archived = false', {});
  const seenCodes = {};
  const plan = rows.map((r, i) => {
    const at = 'Row ' + (i + 1) + ': ';
    if (!r || typeof r !== 'object') throw util.fail(400, at + 'must be an object');
    const name = util.squash(String(r.name || ''));
    if (name === '' || name.length > 80) throw util.fail(400, at + 'needs a name of at most 80 characters');
    const variants = Array.isArray(r.variants) ? r.variants : [];
    const priceText = r.price === undefined || r.price === null ? '' : String(r.price);
    const price = priceText.trim() === '' ? (variants.length > 0 ? 0 : null) : util.toMinor(priceText, ex, false);
    if (price === null) throw util.fail(400, at + '"' + name + '" needs a price like ' + (ex === 0 ? '500' : '4.50') + (priceText !== '' ? ' (got "' + priceText + '")' : ''));
    const cost = r.cost === undefined || r.cost === null || String(r.cost).trim() === '' ? 0 : util.toMinor(String(r.cost), ex, false);
    if (cost === null) throw util.fail(400, at + 'cost is not an amount');
    const vs = variants.map((v, k) => {
      const vn = util.squash(String((v && v.name) || ''));
      const vp = util.toMinor(String((v && v.price) === undefined ? '' : v.price), ex, false);
      if (vn === '' || vp === null) throw util.fail(400, at + 'variant ' + (k + 1) + ' needs a name and a price');
      return { name: vn, price: vp };
    });
    const codes = [];
    for (const key of ['sku', 'barcode']) {
      const c = String(r[key] || '').trim();
      if (c === '') continue;
      if (seenCodes[c.toLowerCase()]) throw util.fail(400, at + 'the code "' + c + '" appears twice in the rows');
      seenCodes[c.toLowerCase()] = true;
      const owner = core().codeOwner(app, c, '');
      if (owner !== null) throw util.fail(400, at + 'the code "' + c + '" is already used by ' + owner.label);
      codes.push(c);
    }
    let tax = taxDefault;
    const taxName = String(r.tax_class || '').trim();
    if (taxName !== '') tax = core().taxClass(app, taxName);
    const stock = r.stock === undefined || r.stock === null || String(r.stock).trim() === '' ? 0 : Number(r.stock);
    if (!Number.isInteger(stock)) throw util.fail(400, at + 'stock must be a whole number');
    return {
      name: name,
      category: util.squash(String(r.category || '')),
      price: price,
      cost: cost,
      sku: String(r.sku || '').trim(),
      barcode: String(r.barcode || '').trim(),
      description: String(r.description || '').slice(0, 500),
      tax: tax === null ? '' : tax.id,
      variants: vs,
      track: r.track_stock === true || r.track_stock === 'true' || stock !== 0,
      stock: stock,
    };
  });
  let created = 0;
  let categoriesCreated = 0;
  app.runInTransaction((tx) => {
    const cats = {};
    for (const c of tx.findRecordsByFilter('categories', '', '', 0, 0)) cats[c.getString('name').toLowerCase()] = c.id;
    const pcoll = tx.findCollectionByNameOrId('products');
    let sort = u().scalarSql(tx, 'SELECT IFNULL(MAX(sort), 0) AS v FROM products');
    let catSort = u().scalarSql(tx, 'SELECT IFNULL(MAX(sort), 0) AS v FROM categories');
    for (const row of plan) {
      let catId = '';
      if (row.category !== '') {
        catId = cats[row.category.toLowerCase()] || '';
        if (catId === '') {
          const c = new Record(tx.findCollectionByNameOrId('categories'));
          c.set('name', row.category.slice(0, 40));
          c.set('color', (Object.keys(cats).length % 8) + 1);
          c.set('icon', require(`${__hooks}/lib_icons.js`).DEFAULT_ICON);
          c.set('sort', ++catSort);
          c.set('kitchen', false);
          tx.save(c);
          cats[row.category.toLowerCase()] = c.id;
          catId = c.id;
          categoriesCreated++;
        }
      }
      const pr = new Record(pcoll);
      pr.set('name', row.name);
      pr.set('category', catId);
      pr.set('price', row.price);
      pr.set('open_price', false);
      pr.set('tax_class', row.tax);
      pr.set('sku', row.sku);
      pr.set('description', row.description);
      pr.set('color', 0);
      pr.set('cost', row.cost);
      pr.set('available', true);
      pr.set('archived', false);
      pr.set('status', status);
      pr.set('track_stock', row.track);
      pr.set('low_stock', 0);
      pr.set('favorite', false);
      pr.set('sort', ++sort);
      pr.set('fav_sort', 0);
      pr.set('modifier_groups', []);
      pr.set('import_ref', importRef || '');
      tx.save(pr);
      let firstVariant = '';
      row.variants.forEach((v, k) => {
        const vr = new Record(tx.findCollectionByNameOrId('variants'));
        vr.set('product', pr.id);
        vr.set('name', v.name);
        vr.set('price', v.price);
        vr.set('sku', '');
        vr.set('cost', 0);
        vr.set('sort', k + 1);
        vr.set('archived', false);
        tx.save(vr);
        if (firstVariant === '') firstVariant = vr.id;
      });
      if (row.barcode !== '') {
        const c = new Record(tx.findCollectionByNameOrId('codes'));
        c.set('code', row.barcode);
        c.set('product', pr.id);
        c.set('variant', '');
        tx.save(c);
      }
      if (row.stock !== 0) {
        require(`${__hooks}/lib_stock.js`).post(tx, { product: pr.id, variant: firstVariant, qty: row.stock, kind: 'receive', reason: 'Opening stock', staff: ctx.staff ? ctx.staff.id : '', actor: ctx.actor });
      }
      created++;
    }
    core().audit(tx, {
      kind: 'catalog_change',
      actor: ctx.actor,
      staff: ctx.staff ? ctx.staff.id : '',
      ref: importRef || 'import',
      summary: 'Imported ' + created + ' product' + (created === 1 ? '' : 's') + (status === 'draft' ? ' to review' : '') + (categoriesCreated > 0 ? ' and ' + categoriesCreated + ' categories' : ''),
    });
  });
  return { created: created, categories_created: categoriesCreated, status: status };
}

module.exports = {
  serializeCategory: serializeCategory,
  listCategories: listCategories,
  saveCategory: saveCategory,
  deleteCategory: deleteCategory,
  reorderCategories: reorderCategories,
  serializeProducts: serializeProducts,
  getProduct: getProduct,
  listProducts: listProducts,
  registerCatalog: registerCatalog,
  saveProduct: saveProduct,
  setAvailable: setAvailable,
  setArchived: setArchived,
  reorderProducts: reorderProducts,
  reviewDrafts: reviewDrafts,
  listGroups: listGroups,
  saveGroup: saveGroup,
  deleteGroup: deleteGroup,
  setOptionAvailable: setOptionAvailable,
  listDiscounts: listDiscounts,
  saveDiscount: saveDiscount,
  deleteDiscount: deleteDiscount,
  lookup: lookup,
  importRows: importRows,
};
