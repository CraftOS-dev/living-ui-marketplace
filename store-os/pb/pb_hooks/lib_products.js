/// <reference path="../pb_data/types.d.ts" />
/**
 * The catalog: one product, many shops.
 *
 *   product   what you sell (title, brand, facts, pictures, description)
 *   variant   one SKU of it (option, price and cost in the base currency,
 *             on hand from the stock ledger)
 *   listing   the product on one shop: its own title, text and price (in the
 *             shop's currency), status (draft, ready, live, paused) and the
 *             issues the pre-flight check finds against that platform
 *
 * A live listing whose text or price changed after it was published shows
 * "changes not on the shop yet" until it is published again.
 */

const LISTING_STATUSES = ['draft', 'ready', 'live', 'paused'];
const FACT_SOURCES = ['you', 'agent', 'photo', 'supplier', 'web', 'import'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** A product by id, exact title (any case) or one of its SKUs. */
function ref(app, value) {
  const U = L('lib_util');
  const v = String(value || '').trim();
  if (v === '') throw U.fail(400, 'Name the product with --product <id, title or SKU>.', 'missing_param', { param: 'product' });
  const byId = U.byId(app, 'products', v);
  if (byId !== null) return byId;
  const t = U.rows(app, 'SELECT id AS id FROM products WHERE title = {:t} COLLATE NOCASE LIMIT 2', { t: v }, { id: '' });
  if (t.length === 1) return app.findRecordById('products', t[0].id);
  if (t.length > 1) throw U.fail(409, 'More than one product is called "' + v + '"; give its id (products.list --q "' + v + '").', 'ambiguous');
  const s = U.rows(app, 'SELECT product AS id FROM variants WHERE sku = {:s} COLLATE NOCASE LIMIT 1', { s: v }, { id: '' });
  if (s.length > 0) return app.findRecordById('products', s[0].id);
  throw U.fail(404, 'No product "' + v + '". Run products.list --q "' + v + '".', 'not_found');
}

function imagesOf(prod) {
  const names = prod.getStringSlice('images') || [];
  return names.map((n) => ({ name: n, url: '/api/files/products/' + prod.id + '/' + n, thumb: '/api/files/products/' + prod.id + '/' + n + '?thumb=400x400' }));
}

function factsOf(prod) {
  const raw = L('lib_util').json(prod, 'facts', {});
  const out = [];
  for (const k of Object.keys(raw)) {
    const f = raw[k];
    if (f && typeof f === 'object') out.push({ key: k, value: String(f.value || ''), source: String(f.source || 'you') });
    else out.push({ key: k, value: String(f), source: 'you' });
  }
  return out;
}

function variantsOf(app, productId) {
  return app.findRecordsByFilter('variants', 'product = {:p}', 'sort,created', 0, 0, { p: productId });
}

function variantView(app, v, reserved, base) {
  const U = L('lib_util');
  const st = L('lib_stock').variantStock(app, v, reserved);
  return Object.assign({ id: v.id, sku: v.getString('sku'), option: v.getString('option'), price: U.toMajor(v.getInt('price_minor'), base), cost: U.toMajor(v.getInt('cost_minor'), base), barcode: v.getString('barcode'), weight_g: v.getInt('weight_g'), cost_missing: v.getInt('cost_minor') <= 0 }, st);
}

/** What stops (blocking) or weakens (warning) a listing on its platform. */
function preflight(app, l, prod, variants, shop, reserved) {
  const U = L('lib_util');
  const S = L('lib_store');
  const plat = L('lib_platforms').get(shop.getString('platform'));
  const issues = [];
  const title = l.getString('title') || prod.getString('title');
  const max = plat ? plat.title_max : 0;
  if (title.trim() === '') issues.push({ level: 'blocking', field: 'title', text: 'No title' });
  else if (max > 0 && U.chars(title) > max) issues.push({ level: 'blocking', field: 'title', text: 'Title is ' + U.chars(title) + ' characters; ' + (plat ? plat.name : 'this shop') + ' allows ' + max });
  if (l.getInt('price_minor') <= 0) issues.push({ level: 'blocking', field: 'price', text: 'No price' });
  if ((prod.getStringSlice('images') || []).length === 0) issues.push({ level: 'blocking', field: 'images', text: 'No pictures' });
  if (variants.length === 0) issues.push({ level: 'blocking', field: 'variants', text: 'No SKU to sell' });
  const desc = l.getString('description') || prod.getString('description');
  if (U.chars(desc.trim()) < 80) issues.push({ level: 'warning', field: 'description', text: desc.trim() === '' ? 'No description' : 'Description is very short' });
  // Price against cost, both in the base currency.
  const cur = shop.getString('currency') || S.baseOrEmpty(app);
  const priceBase = S.toBase(app, l.getInt('price_minor'), cur);
  let maxCost = 0;
  for (const v of variants) maxCost = Math.max(maxCost, v.getInt('cost_minor'));
  if (priceBase !== null && l.getInt('price_minor') > 0 && maxCost > 0 && priceBase < maxCost) issues.push({ level: 'warning', field: 'price', text: 'Price is below cost' });
  if (l.getString('status') === 'live' && variants.length > 0) {
    let avail = 0;
    for (const v of variants) avail += v.getInt('on_hand') - ((reserved && reserved[v.id]) || 0);
    if (avail <= 0) issues.push({ level: 'warning', field: 'stock', text: 'Live with no stock available' });
  }
  return issues;
}

function listingView(app, l, prod, variants, shop, reserved) {
  const U = L('lib_util');
  const cur = shop.getString('currency') || L('lib_store').baseOrEmpty(app);
  const issues = preflight(app, l, prod, variants, shop, reserved);
  const changed = l.getString('changed_at');
  const published = l.getString('published_at');
  return {
    id: l.id,
    product: prod.id,
    shop: { id: shop.id, name: shop.getString('name'), platform: shop.getString('platform'), currency: cur },
    status: l.getString('status') || 'draft',
    title: l.getString('title'),
    description: l.getString('description'),
    price: U.toMajor(l.getInt('price_minor'), cur),
    currency: cur,
    keywords: U.json(l, 'keywords', []),
    external_id: l.getString('external_id'),
    url: l.getString('url'),
    source: l.getString('source'),
    pushed_at: l.getString('pushed_at'),
    published_at: published,
    needs_update: l.getString('status') === 'live' && changed !== '' && (published === '' || changed > published),
    issues: issues,
    blocking: issues.filter((i) => i.level === 'blocking').length,
    updated: l.getString('updated'),
  };
}

function shopsById(app) {
  const out = {};
  for (const s of app.findRecordsByFilter('shops', '1=1', 'sort,created', 0, 0)) out[s.id] = s;
  return out;
}

/* ------------------------------------------------------------------ reads */

function list(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').baseOrEmpty(app);
  const reserved = L('lib_stock').reservedMap(app);
  const shops = shopsById(app);
  const tasks = L('lib_tasks').openMap(app);
  const q = String(p.q || '').trim().toLowerCase();
  const status = p.status || 'active_draft';
  const shopFilter = p.shop ? L('lib_shops').ref(app, p.shop).id : '';
  const all = app.findRecordsByFilter('products', '1=1', '-created', 0, 0);
  const rows = [];
  const counts = { all: 0, issues: 0, unlisted: 0, low: 0, out: 0, missing_cost: 0, draft: 0, archived: 0 };
  for (const prod of all) {
    const st = prod.getString('status') || 'active';
    const variants = variantsOf(app, prod.id);
    const listings = app.findRecordsByFilter('listings', 'product = {:p}', '', 0, 0, { p: prod.id });
    if (q !== '') {
      const hay = (prod.getString('title') + ' ' + prod.getString('brand') + ' ' + prod.getString('category') + ' ' + variants.map((v) => v.getString('sku') + ' ' + v.getString('barcode')).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
    }
    if (shopFilter !== '' && !listings.some((l) => l.getString('shop') === shopFilter)) continue;
    let available = 0;
    let minPrice = null;
    let maxPrice = null;
    let costMissing = false;
    let low = false;
    for (const v of variants) {
      const s = L('lib_stock').variantStock(app, v, reserved[v.id] || 0);
      available += s.available;
      if (s.state !== 'ok') low = true;
      const pr = v.getInt('price_minor');
      minPrice = minPrice === null ? pr : Math.min(minPrice, pr);
      maxPrice = maxPrice === null ? pr : Math.max(maxPrice, pr);
      if (v.getInt('cost_minor') <= 0) costMissing = true;
    }
    const lv = listings.map((l) => {
      const shop = shops[l.getString('shop')];
      if (!shop) return null;
      const issues = preflight(app, l, prod, variants, shop, reserved);
      return { id: l.id, shop: shop.id, shop_name: shop.getString('name'), platform: shop.getString('platform'), status: l.getString('status') || 'draft', blocking: issues.filter((i) => i.level === 'blocking').length, warnings: issues.filter((i) => i.level === 'warning').length };
    }).filter((x) => x !== null);
    const hasIssues = lv.some((l) => l.blocking > 0);
    const outAll = variants.length > 0 && available <= 0;
    if (st !== 'archived') {
      counts.all++;
      if (hasIssues) counts.issues++;
      if (lv.length === 0) counts.unlisted++;
      if (low && !outAll) counts.low++;
      if (outAll) counts.out++;
      if (costMissing) counts.missing_cost++;
    }
    if (st === 'draft') counts.draft++;
    if (st === 'archived') counts.archived++;
    if (status === 'active_draft' && st === 'archived') continue;
    if (status !== 'active_draft' && status !== 'all' && st !== status) continue;
    if (p.filter === 'issues' && !hasIssues) continue;
    if (p.filter === 'unlisted' && lv.length > 0) continue;
    if (p.filter === 'low' && !(low && !outAll)) continue;
    if (p.filter === 'out' && !outAll) continue;
    if (p.filter === 'missing_cost' && !costMissing) continue;
    rows.push({
      id: prod.id,
      title: prod.getString('title'),
      brand: prod.getString('brand'),
      category: prod.getString('category'),
      status: st,
      image: L('lib_stock').firstImage(prod),
      variants: variants.length,
      skus: variants.slice(0, 3).map((v) => v.getString('sku')),
      price_min: minPrice === null ? 0 : U.toMajor(minPrice, base),
      price_max: maxPrice === null ? 0 : U.toMajor(maxPrice, base),
      available: available,
      stock_state: variants.length === 0 ? 'none' : outAll ? 'out' : low ? 'low' : 'ok',
      cost_missing: costMissing,
      listings: lv,
      task: tasks['product:' + prod.id] || null,
      created: prod.getString('created'),
    });
  }
  const limit = Math.min(Math.max(Math.round(p.limit || 100), 1), 500);
  const offset = Math.max(Math.round(p.offset || 0), 0);
  return { currency: base, total: rows.length, counts: counts, products: rows.slice(offset, offset + limit) };
}

function get(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').baseOrEmpty(app);
  const prod = ref(app, p.product);
  const reserved = L('lib_stock').reservedMap(app);
  const variants = variantsOf(app, prod.id);
  const shops = shopsById(app);
  const listings = [];
  for (const l of app.findRecordsByFilter('listings', 'product = {:p}', '', 0, 0, { p: prod.id })) {
    const shop = shops[l.getString('shop')];
    if (shop) listings.push(listingView(app, l, prod, variants, shop, reserved));
  }
  listings.sort((a, b) => (shops[a.shop.id].getInt('sort') - shops[b.shop.id].getInt('sort')));
  const sold = U.rows(app, "SELECT COALESCE(SUM(l.qty), 0) AS n FROM order_lines l JOIN orders o ON o.id = l.order_ref JOIN variants v ON v.id = l.variant WHERE v.product = {:p} AND o.status NOT IN ('cancelled', 'unpaid') AND o.placed_at >= {:since}", { p: prod.id, since: U.addDays('', -30) }, { n: 0 });
  const tasks = app.findRecordsByFilter('tasks', 'target = {:t}', '-created', 5, 0, { t: 'product:' + prod.id }).map((t) => L('lib_tasks').view(t));
  return {
    product: {
      id: prod.id,
      title: prod.getString('title'),
      brand: prod.getString('brand'),
      category: prod.getString('category'),
      description: prod.getString('description'),
      status: prod.getString('status') || 'active',
      note: prod.getString('note'),
      tags: U.json(prod, 'tags', []),
      facts: factsOf(prod),
      images: imagesOf(prod),
      image_paths: ctx.isAgent ? (prod.getStringSlice('images') || []).map((n) => $filepath.join(app.dataDir(), 'storage', prod.baseFilesPath(), n)) : undefined,
      variants: variants.map((v) => variantView(app, v, reserved[v.id] || 0, base)),
      listings: listings,
      not_listed_on: Object.keys(shops).filter((id) => !listings.some((l) => l.shop.id === id)).map((id) => ({ id: id, name: shops[id].getString('name'), platform: shops[id].getString('platform') })),
      sold_30d: sold.length > 0 ? sold[0].n : 0,
      task: tasks.filter((t) => L('lib_tasks').OPEN.indexOf(t.state) >= 0)[0] || null,
      tasks: tasks,
      currency: base,
      created: prod.getString('created'),
      updated: prod.getString('updated'),
    },
  };
}

/* ----------------------------------------------------------------- writes */

function newSku(app) {
  const U = L('lib_util');
  for (let i = 0; i < 20; i++) {
    const s = 'SKU-' + $security.randomStringWithAlphabet(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    if (U.rows(app, 'SELECT id AS id FROM variants WHERE sku = {:s} COLLATE NOCASE LIMIT 1', { s: s }, { id: '' }).length === 0) return s;
  }
  throw U.fail(500, 'Could not make a free SKU');
}

function assertFreeSku(app, sku, exceptId) {
  const U = L('lib_util');
  const rows = U.rows(app, 'SELECT id AS id FROM variants WHERE sku = {:s} COLLATE NOCASE LIMIT 1', { s: sku }, { id: '' });
  if (rows.length > 0 && rows[0].id !== exceptId) throw U.fail(409, 'SKU ' + sku + ' is already used by another item.', 'duplicate_sku', { sku: sku });
}

function setProductFields(r, p) {
  const U = L('lib_util');
  if (p.title !== undefined) {
    const t = String(p.title).trim();
    if (t === '') throw U.fail(400, 'A product needs a title.', 'invalid_param', { param: 'title' });
    r.set('title', U.clip(t, 300));
  }
  if (p.brand !== undefined) r.set('brand', U.clip(p.brand, 120));
  if (p.category !== undefined) r.set('category', U.clip(p.category, 200));
  if (p.description !== undefined) r.set('description', U.clip(p.description, 20000));
  if (p.status !== undefined) r.set('status', U.oneOf(p.status, ['active', 'draft', 'archived'], 'status'));
  if (p.note !== undefined) r.set('note', U.clip(p.note, 2000));
  if (p.tags !== undefined) r.set('tags', U.list(p.tags, 'tags').map((t) => U.clip(String(t), 60)).slice(0, 40));
}

function makeVariant(ctx, prod, p, sort) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').base(app);
  const sku = String(p.sku || '').trim() || newSku(app);
  assertFreeSku(app, sku, '');
  const v = U.newRecord(app, 'variants');
  v.set('product', prod.id);
  v.set('sku', U.clip(sku, 120));
  v.set('option', U.clip(p.option || '', 120));
  v.set('price_minor', U.toMinor(p.price, base, 'price'));
  v.set('cost_minor', U.toMinor(p.cost, base, 'cost'));
  v.set('barcode', U.clip(p.barcode || '', 60));
  v.set('weight_g', p.weight_g ? U.int(p.weight_g, 'weight_g') : 0);
  v.set('low_stock', p.low_stock ? U.int(p.low_stock, 'low_stock') : 0);
  v.set('on_hand', 0);
  v.set('sort', sort || 0);
  app.save(v);
  const stock = p.stock === undefined || p.stock === '' ? 0 : U.int(p.stock, 'stock');
  if (stock !== 0) L('lib_stock').move(app, v, stock, 'opening', '', 'Opening stock', ctx.actor);
  return v;
}

function add(ctx, p) {
  const app = ctx.app;
  L('lib_store').base(app);
  const U = L('lib_util');
  const prod = U.newRecord(app, 'products');
  setProductFields(prod, { title: p.title, brand: p.brand || '', category: p.category || '', description: p.description || '', status: p.status || 'active' });
  prod.set('facts', {});
  prod.set('tags', []);
  app.save(prod);
  makeVariant(ctx, prod, p, 0);
  L('lib_store').log(app, ctx.actor, 'Added the product ' + prod.getString('title'), 'product:' + prod.id);
  return get(ctx, { product: prod.id });
}

/**
 * Create a whole product at once: details, organisation, facts, every SKU
 * (with price, cost and opening stock) and a draft listing on each chosen
 * shop. Everything is checked first (title, at least one SKU, SKUs free and
 * not repeated, numbers), so a bad field creates nothing. Pictures follow with
 * products.add-images.
 */
function create(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').base(app);
  const title = String(p.title || '').trim();
  if (title === '') throw U.fail(400, 'A product needs a title.', 'missing_param', { param: 'title' });
  const variants = U.list(p.variants, 'variants');
  if (variants.length === 0) throw U.fail(400, 'Give at least one SKU in --variants, e.g. [{"sku":"MUG-BLU","price":29,"cost":9,"stock":40}].', 'missing_param', { param: 'variants' });
  if (variants.length > 100) throw U.fail(400, 'At most 100 SKUs per product.', 'too_many');
  const seen = {};
  variants.forEach((v, i) => {
    if (!v || typeof v !== 'object') throw U.fail(400, 'SKU ' + (i + 1) + ' is not an object.', 'invalid_param', { param: 'variants' });
    const sku = String(v.sku || '').trim();
    if (sku !== '') {
      if (seen[sku.toLowerCase()]) throw U.fail(400, 'SKU ' + sku + ' is in the list twice.', 'duplicate_sku', { sku: sku });
      seen[sku.toLowerCase()] = true;
      assertFreeSku(app, sku, '');
    }
    U.toMinor(v.price, base, 'price of SKU ' + (i + 1));
    U.toMinor(v.cost, base, 'cost of SKU ' + (i + 1));
    if (v.stock !== undefined && v.stock !== '') U.int(v.stock, 'stock of SKU ' + (i + 1));
  });
  const shopIds = U.list(p.shops, 'shops').map((s) => L('lib_shops').ref(app, s).id);
  const facts = p.facts !== undefined ? U.obj(p.facts, 'facts') : {};
  const prod = U.newRecord(app, 'products');
  setProductFields(prod, { title: title, brand: p.brand || '', category: p.category || '', description: p.description || '', status: p.status || 'active', tags: p.tags !== undefined ? p.tags : [] });
  prod.set('facts', {});
  app.save(prod);
  variants.forEach((v, i) => makeVariant(ctx, prod, { sku: v.sku, option: v.option || '', price: v.price, cost: v.cost, stock: v.stock, barcode: v.barcode || '', weight_g: v.weight_g, low_stock: v.low_stock }, i));
  if (Object.keys(facts).length > 0) L('lib_products').facts(ctx, { product: prod.id, facts: facts });
  for (const sid of shopIds) listingDraft(ctx, { product: prod.id, shop: sid, status: 'draft' });
  L('lib_store').log(app, ctx.actor, 'Added the product ' + title + ' (' + variants.length + ' SKU' + (variants.length === 1 ? '' : 's') + (shopIds.length > 0 ? ', drafts for ' + shopIds.length + ' shop' + (shopIds.length === 1 ? '' : 's') : '') + ')', 'product:' + prod.id);
  return get(ctx, { product: prod.id });
}

function update(ctx, p) {
  const app = ctx.app;
  const prod = ref(app, p.product);
  setProductFields(prod, p);
  app.save(prod);
  L('lib_store').log(app, ctx.actor, 'Edited ' + prod.getString('title'), 'product:' + prod.id);
  return get(ctx, { product: prod.id });
}

function facts(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const prod = ref(app, p.product);
  const given = U.obj(p.facts, 'facts');
  const cur = U.json(prod, 'facts', {});
  const defaultSource = ctx.isAgent ? 'agent' : 'you';
  for (const k of Object.keys(given)) {
    const key = U.clip(String(k).trim(), 60);
    if (key === '') continue;
    const g = given[k];
    const value = g && typeof g === 'object' ? String(g.value || '') : String(g === null || g === undefined ? '' : g);
    if (value.trim() === '') {
      delete cur[key];
      continue;
    }
    const source = g && typeof g === 'object' && g.source ? String(g.source) : defaultSource;
    if (FACT_SOURCES.indexOf(source) < 0) throw U.fail(400, 'A fact\'s source must be one of: ' + FACT_SOURCES.join(', ') + '.', 'invalid_param', { param: 'facts' });
    cur[key] = { value: U.clip(value, 1000), source: source };
  }
  prod.set('facts', cur);
  app.save(prod);
  return { facts: factsOf(prod) };
}

function addImages(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const prod = ref(app, p.product);
  const files = [];
  if (ctx.e) for (const f of U.uploaded(ctx.e, 'images')) files.push(f);
  for (const path of U.list(p.paths, 'paths')) files.push(U.localFile(ctx, String(path), 'paths'));
  if (files.length === 0) throw U.fail(400, 'Upload pictures in "images"' + (ctx.isAgent ? ', or give --paths \'["C:/photos/mug.jpg"]\'' : '') + '.', 'missing_param', { param: 'images' });
  const have = (prod.getStringSlice('images') || []).length;
  if (have + files.length > 12) throw U.fail(400, 'A product holds up to 12 pictures; it has ' + have + '.', 'too_many');
  prod.set('images+', files);
  app.save(prod);
  L('lib_store').log(app, ctx.actor, 'Added ' + files.length + ' picture' + (files.length === 1 ? '' : 's') + ' to ' + prod.getString('title'), 'product:' + prod.id);
  return { images: imagesOf(prod) };
}

function removeImage(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const prod = ref(app, p.product);
  const names = prod.getStringSlice('images') || [];
  if (names.indexOf(p.name) < 0) throw U.fail(404, 'No picture ' + p.name + ' on this product.', 'not_found');
  prod.set('images-', [p.name]);
  app.save(prod);
  return { images: imagesOf(prod) };
}

function moveImage(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const prod = ref(app, p.product);
  const names = (prod.getStringSlice('images') || []).slice();
  const i = names.indexOf(p.name);
  if (i < 0) throw U.fail(404, 'No picture ' + p.name + ' on this product.', 'not_found');
  names.splice(i, 1);
  names.unshift(p.name);
  prod.set('images', names);
  app.save(prod);
  return { images: imagesOf(prod) };
}

function lookupProduct(ctx, p) {
  return ref(ctx.app, p.product).getString('title');
}

function clearLineLinks(app, variantIds) {
  for (const id of variantIds) {
    for (const l of app.findRecordsByFilter('order_lines', 'variant = {:v}', '', 0, 0, { v: id })) {
      l.set('variant', '');
      app.save(l);
    }
  }
}

function remove(ctx, p) {
  const app = ctx.app;
  const prod = ref(app, p.product);
  const title = prod.getString('title');
  clearLineLinks(app, variantsOf(app, prod.id).map((v) => v.id));
  app.delete(prod);
  L('lib_store').log(app, ctx.actor, 'Deleted the product ' + title, '');
  return { removed: title };
}

/* --------------------------------------------------------------- variants */

function variantAdd(ctx, p) {
  const app = ctx.app;
  const prod = ref(app, p.product);
  const v = makeVariant(ctx, prod, p, variantsOf(app, prod.id).length);
  L('lib_store').log(app, ctx.actor, 'Added ' + v.getString('sku') + ' to ' + prod.getString('title'), 'product:' + prod.id);
  return get(ctx, { product: prod.id });
}

function variantUpdate(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').base(app);
  const v = L('lib_stock').variantRef(app, p.variant);
  if (p.sku !== undefined) {
    const sku = String(p.sku).trim();
    if (sku === '') throw U.fail(400, 'A SKU cannot be empty.', 'invalid_param', { param: 'sku' });
    assertFreeSku(app, sku, v.id);
    v.set('sku', U.clip(sku, 120));
  }
  if (p.option !== undefined) v.set('option', U.clip(p.option, 120));
  if (p.cost !== undefined) {
    v.set('cost_minor', U.toMinor(p.cost, base, 'cost'));
    L('lib_orders').recostVariant(app, v.id);
  }
  if (p.barcode !== undefined) v.set('barcode', U.clip(p.barcode, 60));
  if (p.weight_g !== undefined) v.set('weight_g', U.int(p.weight_g, 'weight_g'));
  if (p.low_stock !== undefined) v.set('low_stock', U.int(p.low_stock, 'low_stock'));
  app.save(v);
  return get(ctx, { product: v.getString('product') });
}

function setPrice(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').base(app);
  const v = L('lib_stock').variantRef(app, p.variant);
  const before = v.getInt('price_minor');
  v.set('price_minor', U.toMinor(p.price, base, 'price'));
  app.save(v);
  L('lib_store').log(app, ctx.actor, 'Price of ' + v.getString('sku') + ': ' + U.fmt(before, base) + ' to ' + U.fmt(v.getInt('price_minor'), base), 'product:' + v.getString('product'));
  return get(ctx, { product: v.getString('product') });
}

function lookupVariant(ctx, p) {
  return L('lib_stock').variantRef(ctx.app, p.variant).getString('sku');
}

function variantRemove(ctx, p) {
  const app = ctx.app;
  const v = L('lib_stock').variantRef(app, p.variant);
  const pid = v.getString('product');
  const sku = v.getString('sku');
  clearLineLinks(app, [v.id]);
  app.delete(v);
  L('lib_store').log(app, ctx.actor, 'Deleted the SKU ' + sku, 'product:' + pid);
  return { removed: sku };
}

/* --------------------------------------------------------------- listings */

function listingRef(app, p) {
  const U = L('lib_util');
  if (p.listing) {
    const l = U.byId(app, 'listings', String(p.listing));
    if (l === null) throw U.fail(404, 'No listing ' + p.listing + '. products.get shows a product\'s listings.', 'not_found');
    return l;
  }
  const prod = ref(app, p.product);
  const shop = L('lib_shops').ref(app, p.shop);
  return U.findOne(app, 'listings', 'product = {:p} && shop = {:s}', { p: prod.id, s: shop.id });
}

/** Create or change a listing's text and price. Your AI agent's drafts come here through Approvals. */
function listingDraft(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const prod = ref(app, p.product);
  const shop = L('lib_shops').ref(app, p.shop);
  let l = U.findOne(app, 'listings', 'product = {:p} && shop = {:s}', { p: prod.id, s: shop.id });
  const created = l === null;
  if (created) {
    l = U.newRecord(app, 'listings');
    l.set('product', prod.id);
    l.set('shop', shop.id);
    l.set('status', 'draft');
    l.set('pushed', {});
    l.set('keywords', []);
  }
  const cur = shop.getString('currency') || L('lib_store').base(app);
  let changed = false;
  if (p.title !== undefined && p.title !== l.getString('title')) {
    l.set('title', U.clip(p.title, 500));
    changed = true;
  }
  if (p.description !== undefined && p.description !== l.getString('description')) {
    l.set('description', U.clip(p.description, 20000));
    changed = true;
  }
  if (p.price !== undefined) {
    const m = U.toMinor(p.price, cur, 'price');
    if (m !== l.getInt('price_minor')) {
      l.set('price_minor', m);
      changed = true;
    }
  } else if (created) {
    // A new listing starts at the product's price, converted to the shop's currency.
    const vs = variantsOf(app, prod.id);
    if (vs.length > 0) {
      const baseMinor = vs[0].getInt('price_minor');
      const b = L('lib_store').baseOrEmpty(app);
      if (cur === b) l.set('price_minor', baseMinor);
      else {
        const t = L('lib_store').fxTable(app);
        const r = t.rates[cur];
        if (r > 0) l.set('price_minor', Math.round((baseMinor / Math.pow(10, U.exp(b))) * r * Math.pow(10, U.exp(cur))));
      }
    }
  }
  if (p.keywords !== undefined) l.set('keywords', U.list(p.keywords, 'keywords').map((k) => U.clip(String(k), 80)).slice(0, 40));
  if (p.status !== undefined) {
    const st = U.oneOf(p.status, ['draft', 'ready'], 'status');
    if (l.getString('status') !== 'live') l.set('status', st);
  }
  l.set('source', ctx.isAgent || ctx.approved ? 'agent' : 'you');
  if (changed) l.set('changed_at', U.now());
  app.save(l);
  L('lib_store').log(app, ctx.actor, (created ? 'Drafted a listing of ' : 'Edited the listing of ') + prod.getString('title') + ' on ' + shop.getString('name'), 'product:' + prod.id);
  if (ctx.isAgent || ctx.approved) L('lib_tasks').finishFor(app, 'product:' + prod.id, 'prepare_listing', 'Drafts ready');
  return { listing: listingView(app, l, prod, variantsOf(app, prod.id), shop, L('lib_stock').reservedMap(app)) };
}

/** Record that a product is on a shop (found while syncing or importing). */
function listingLink(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const prod = ref(app, p.product);
  const shop = L('lib_shops').ref(app, p.shop);
  let l = U.findOne(app, 'listings', 'product = {:p} && shop = {:s}', { p: prod.id, s: shop.id });
  if (l === null) {
    l = U.newRecord(app, 'listings');
    l.set('product', prod.id);
    l.set('shop', shop.id);
    l.set('pushed', {});
    l.set('keywords', []);
    l.set('source', 'import');
  }
  const cur = shop.getString('currency') || L('lib_store').base(app);
  if (p.title !== undefined) l.set('title', U.clip(p.title, 500));
  if (p.description !== undefined) l.set('description', U.clip(p.description, 20000));
  if (p.price !== undefined) l.set('price_minor', U.toMinor(p.price, cur, 'price'));
  if (p.external_id !== undefined) l.set('external_id', U.clip(p.external_id, 120));
  if (p.url !== undefined) l.set('url', U.clip(p.url, 500));
  const st = p.status ? U.oneOf(p.status, LISTING_STATUSES, 'status') : 'live';
  l.set('status', st);
  if (st === 'live' && l.getString('published_at') === '') l.set('published_at', U.now());
  if (p.stock !== undefined && p.stock !== '') {
    // The quantity the shop shows now, so the push plan knows where it starts.
    const pushed = U.json(l, 'pushed', {});
    for (const v of variantsOf(app, prod.id)) if (pushed[v.id] === undefined) pushed[v.id] = U.int(p.stock, 'stock');
    l.set('pushed', pushed);
  }
  app.save(l);
  return { listing: l.id, status: st };
}

function listingStatus(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const l = listingRef(app, p);
  if (l === null) throw U.fail(404, 'That product has no listing on that shop yet. Draft one with listings.draft.', 'not_found');
  const st = U.oneOf(p.status, LISTING_STATUSES, 'status');
  l.set('status', st);
  if (p.external_id !== undefined) l.set('external_id', U.clip(p.external_id, 120));
  if (p.url !== undefined) l.set('url', U.clip(p.url, 500));
  if (st === 'live') l.set('published_at', U.now());
  app.save(l);
  const prod = app.findRecordById('products', l.getString('product'));
  const shop = app.findRecordById('shops', l.getString('shop'));
  L('lib_store').log(app, ctx.actor, prod.getString('title') + ' on ' + shop.getString('name') + ': ' + st, 'product:' + prod.id);
  if (st === 'live') {
    const left = app.findRecordsByFilter('listings', "shop = {:s} && status = 'ready'", '', 1, 0, { s: shop.id }).length;
    if (left === 0) L('lib_tasks').finishFor(app, 'shop:' + shop.id, 'publish', 'Published');
  }
  return { listing: listingView(app, l, prod, variantsOf(app, prod.id), shop, L('lib_stock').reservedMap(app)) };
}

function lookupListing(ctx, p) {
  const l = listingRef(ctx.app, p);
  if (l === null) throw L('lib_util').fail(404, 'No such listing.', 'not_found');
  return ctx.app.findRecordById('shops', l.getString('shop')).getString('name') + ' listing';
}

function listingRemove(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const l = listingRef(app, p);
  if (l === null) throw U.fail(404, 'No such listing.', 'not_found');
  const pid = l.getString('product');
  app.delete(l);
  return get(ctx, { product: pid });
}

/* ------------------------------------------------- work for your AI agent */

function requestPrepare(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const prod = ref(app, p.product);
  let shopIds = U.list(p.shops, 'shops').map((s) => L('lib_shops').ref(app, s).id);
  if (shopIds.length === 0) shopIds = app.findRecordsByFilter('shops', "status != 'paused' && platform != 'direct'", 'sort', 0, 0).map((s) => s.id);
  if (shopIds.length === 0) throw U.fail(400, 'Add a shop first: listings are written for a shop.', 'no_shops');
  const names = shopIds.map((id) => app.findRecordById('shops', id).getString('name'));
  const t = L('lib_tasks').queue(app, 'prepare_listing', 'product:' + prod.id, 'Prepare listings of ' + prod.getString('title') + ' for ' + names.join(', '), { product: prod.id, shops: shopIds, note: U.clip(p.note || '', 1000) }, ctx.actor);
  return { task: t };
}

function requestPublish(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const shop = L('lib_shops').ref(app, p.shop);
  const ids = [];
  for (const l of app.findRecordsByFilter('listings', 'shop = {:s}', '', 0, 0, { s: shop.id })) {
    const st = l.getString('status');
    const changed = l.getString('changed_at');
    const pub = l.getString('published_at');
    if (st === 'ready' || (st === 'live' && changed !== '' && (pub === '' || changed > pub))) ids.push(l.id);
  }
  const given = U.list(p.listings, 'listings');
  const chosen = given.length > 0 ? given.map(String) : ids;
  if (chosen.length === 0) throw U.fail(400, 'Nothing to publish on ' + shop.getString('name') + ': mark listings Ready first.', 'nothing_ready');
  const t = L('lib_tasks').queue(app, 'publish', 'shop:' + shop.id, 'Publish ' + chosen.length + ' listing' + (chosen.length === 1 ? '' : 's') + ' on ' + shop.getString('name'), { shop: shop.id, listings: chosen }, ctx.actor);
  return { task: t };
}

/* ---------------------------------------------------------------- imports */

/**
 * Create or update products from rows (a product export, a supplier sheet or
 * your AI agent's sync). Rows sharing `group` (a parent SKU or the title)
 * become variants of one product. A row with `shop` also records the listing.
 */
function upsertMany(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const base = L('lib_store').base(app);
  const items = U.list(p.items, 'items');
  if (items.length === 0) throw U.fail(400, 'Give --items as a JSON list of products, e.g. [{"title":"Blue mug","sku":"MUG-BLU","price":29,"cost":9,"stock":40}].', 'missing_param', { param: 'items' });
  if (items.length > 2000) throw U.fail(400, 'Send at most 2000 rows at a time.', 'too_many');
  const shop = p.shop ? L('lib_shops').ref(app, p.shop) : null;
  const stockMode = p.stock_mode || 'new_only';
  const out = { created: 0, updated: 0, skipped: 0, listed: 0, problems: [] };
  const groups = {};
  items.forEach((it, i) => {
    const row = i + 1;
    if (!it || typeof it !== 'object') {
      out.skipped++;
      out.problems.push('Row ' + row + ': not an object');
      return;
    }
    try {
      const title = String(it.title || '').trim();
      const sku = String(it.sku || '').trim();
      if (title === '' && sku === '') throw U.fail(400, 'needs a title or a SKU');
      let v = null;
      if (sku !== '') {
        const r = U.rows(app, 'SELECT id AS id FROM variants WHERE sku = {:s} COLLATE NOCASE LIMIT 1', { s: sku }, { id: '' });
        if (r.length > 0) v = app.findRecordById('variants', r[0].id);
      }
      let prod;
      if (v !== null) {
        prod = app.findRecordById('products', v.getString('product'));
        if (it.price !== undefined && it.price !== '') v.set('price_minor', U.toMinor(it.price, base, 'price'));
        if (it.cost !== undefined && it.cost !== '') v.set('cost_minor', U.toMinor(it.cost, base, 'cost'));
        if (it.option !== undefined && it.option !== '') v.set('option', U.clip(it.option, 120));
        if (it.barcode !== undefined && it.barcode !== '') v.set('barcode', U.clip(it.barcode, 60));
        if (it.weight_g !== undefined && it.weight_g !== '') v.set('weight_g', U.int(it.weight_g, 'weight_g'));
        app.save(v);
        if (it.cost !== undefined && it.cost !== '') L('lib_orders').recostVariant(app, v.id);
        if (stockMode === 'set' && it.stock !== undefined && it.stock !== '') {
          const target = U.int(it.stock, 'stock');
          L('lib_stock').move(app, v, target - v.getInt('on_hand'), 'count', '', 'Imported count', ctx.actor);
        }
        out.updated++;
      } else {
        const key = String(it.group || title).trim().toLowerCase();
        prod = groups[key] || null;
        if (prod === null && key !== '') {
          const ex = U.rows(app, 'SELECT id AS id FROM products WHERE title = {:t} COLLATE NOCASE LIMIT 1', { t: String(it.group ? title || it.group : title) }, { id: '' });
          if (ex.length > 0) prod = app.findRecordById('products', ex[0].id);
        }
        if (prod === null) {
          prod = U.newRecord(app, 'products');
          setProductFields(prod, { title: title || sku, brand: it.brand || '', category: it.category || '', description: it.description || '', status: 'active' });
          prod.set('facts', {});
          prod.set('tags', []);
          app.save(prod);
        }
        groups[key] = prod;
        makeVariant(ctx, prod, { sku: sku, option: it.option || '', price: it.price, cost: it.cost, stock: stockMode === 'ignore' ? 0 : it.stock, barcode: it.barcode || '', weight_g: it.weight_g }, variantsOf(app, prod.id).length);
        out.created++;
      }
      if (shop !== null) {
        listingLink(ctx, { product: prod.id, shop: shop.id, title: it.listing_title !== undefined && it.listing_title !== '' ? it.listing_title : undefined, price: it.listing_price !== undefined && it.listing_price !== '' ? it.listing_price : undefined, external_id: it.external_id !== undefined ? String(it.external_id) : undefined, url: it.url, status: it.listing_status || 'live', stock: it.shop_stock });
        out.listed++;
      }
    } catch (err) {
      out.skipped++;
      out.problems.push('Row ' + row + ': ' + String((err && err.message) || err));
    }
  });
  L('lib_store').log(app, ctx.actor, 'Products in: ' + out.created + ' new, ' + out.updated + ' updated' + (out.skipped > 0 ? ', ' + out.skipped + ' skipped' : ''), shop ? 'shop:' + shop.id : '');
  return out;
}

module.exports = {
  LISTING_STATUSES: LISTING_STATUSES,
  ref: ref,
  variantsOf: variantsOf,
  listingRef: listingRef,
  preflight: preflight,
  listingView: listingView,
  imagesOf: imagesOf,
  list: list,
  get: get,
  add: add,
  create: create,
  update: update,
  facts: facts,
  addImages: addImages,
  removeImage: removeImage,
  moveImage: moveImage,
  lookupProduct: lookupProduct,
  remove: remove,
  variantAdd: variantAdd,
  variantUpdate: variantUpdate,
  setPrice: setPrice,
  lookupVariant: lookupVariant,
  variantRemove: variantRemove,
  listingDraft: listingDraft,
  listingLink: listingLink,
  listingStatus: listingStatus,
  lookupListing: lookupListing,
  listingRemove: listingRemove,
  requestPrepare: requestPrepare,
  requestPublish: requestPublish,
  upsertMany: upsertMany,
};
