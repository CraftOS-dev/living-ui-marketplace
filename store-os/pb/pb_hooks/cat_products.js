/**
 * Catalog: products, variants (SKUs), pictures and the listings on each shop.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const PRODUCT = S('The product (id, exact title or one of its SKUs)', { required: true });
const VARIANT = S('The SKU (or variant id)', { required: true });

module.exports = [
  {
    name: 'products.list',
    method: 'GET',
    fn: 'lib_products.list',
    effect: 'read',
    desc: 'The catalog: each product with its SKUs, price range (base currency), available stock, stock state, missing costs and its listing status on every shop (with blocking issues). counts gives the totals per filter.',
    params: {
      q: S('Search title, brand, category, SKU or barcode'),
      status: S('active_draft (default) | active | draft | archived | all', { enum: ['active_draft', 'active', 'draft', 'archived', 'all'] }),
      shop: S('Only products listed on this shop'),
      filter: S('issues | unlisted | low | out | missing_cost', { enum: ['issues', 'unlisted', 'low', 'out', 'missing_cost'] }),
      limit: N('Rows (default 100)'),
      offset: N('Skip this many'),
    },
  },
  { name: 'products.get', method: 'GET', fn: 'lib_products.get', effect: 'read', desc: 'One product: facts (with where each came from), pictures (image_paths on this machine for your AI agent), SKUs with price, cost and stock (on hand, reserved, available), every listing with its pre-flight issues, the shops it is not on, units sold in 30 days and tasks.', params: { product: PRODUCT } },
  {
    name: 'products.add',
    method: 'POST',
    fn: 'lib_products.add',
    effect: 'write',
    desc: 'Add a product with its first SKU (a SKU is made when none is given). Prices and costs are in the base currency; stock is the opening count.',
    params: { title: S('Product title', { required: true }), brand: S('Brand'), category: S('Category'), description: S('Description'), sku: S('SKU'), option: S('Option, e.g. "Blue / 350 ml"'), price: N('Selling price'), cost: N('Unit cost'), stock: N('Opening stock'), barcode: S('Barcode (EAN, UPC, JAN)'), status: S('active | draft', { enum: ['active', 'draft'] }) },
  },
  {
    name: 'products.create',
    method: 'POST',
    fn: 'lib_products.create',
    effect: 'write',
    desc: 'Create a whole product at once: details, organisation, facts, every SKU with its price, cost and opening stock (base currency), and a draft listing on each chosen shop. Checked first, so a bad field creates nothing. Add pictures after with products.add-images.',
    params: {
      title: S('Product title', { required: true }),
      description: S('Description'),
      brand: S('Brand'),
      category: S('Category'),
      status: S('active (default) | draft', { enum: ['active', 'draft'] }),
      tags: S('JSON list of tags'),
      facts: S('JSON object of facts, e.g. {"material":{"value":"stoneware","source":"you"}}'),
      variants: S('JSON list of SKUs: [{"option":"Blue / 350 ml","sku":"MUG-BLU","price":29,"cost":9,"stock":40,"barcode":"","weight_g":350,"low_stock":5}] (one entry for a product without options; a SKU is made when sku is empty)', { required: true }),
      shops: S('JSON list of shops (ids or names) to start a draft listing on'),
    },
  },
  { name: 'products.update', method: 'POST', fn: 'lib_products.update', effect: 'write', desc: "Change a product's title, brand, category, description, status, note or tags (the catalog copy; each shop's listing has its own text).", params: { product: PRODUCT, title: S('Title'), brand: S('Brand'), category: S('Category'), description: S('Description'), status: S('active | draft | archived', { enum: ['active', 'draft', 'archived'] }), note: S('Private note'), tags: S('JSON list of tags') } },
  { name: 'products.facts', method: 'POST', fn: 'lib_products.facts', effect: 'write', desc: 'Set product facts (material, size, care...) with where each came from; an empty value removes a fact.', params: { product: PRODUCT, facts: S('JSON object, e.g. {"material":{"value":"stoneware","source":"photo"}} (source: you, agent, photo, supplier, web, import)', { required: true }) } },
  { name: 'products.add-images', method: 'POST', fn: 'lib_products.addImages', effect: 'write', files: ['images'], bodyLimit: 62914560, desc: 'Add pictures to a product (up to 12). Screens upload them; your AI agent gives --paths.', params: { product: PRODUCT, paths: S('Your AI agent: JSON list of absolute file paths, e.g. ["C:/photos/mug.jpg"]') } },
  { name: 'products.remove-image', method: 'POST', fn: 'lib_products.removeImage', effect: 'write', desc: 'Remove one picture.', params: { product: PRODUCT, name: S('Picture file name from products.get images', { required: true }) } },
  { name: 'products.cover', method: 'POST', fn: 'lib_products.moveImage', effect: 'write', desc: 'Make a picture the first (cover) picture.', params: { product: PRODUCT, name: S('Picture file name', { required: true }) } },
  { name: 'products.remove', method: 'POST', fn: 'lib_products.remove', effect: 'write', destructive: true, lookup: 'lib_products.lookupProduct', desc: 'Delete a product with its SKUs, stock ledger and listings (past orders keep their lines).', params: { product: PRODUCT } },
  {
    name: 'products.upsert-many',
    method: 'POST',
    fn: 'lib_products.upsertMany',
    effect: 'write',
    desc: 'Create or update products from rows (a product export or your AI agent\'s sync), matched on SKU. Rows sharing "group" become SKUs of one product. With --shop the listing on that shop is recorded too. Row format: app.guide rows.product.',
    params: { items: S('JSON list of product rows', { required: true }), shop: S('The shop these rows come from'), stock_mode: S('new_only (default: stock counts only for new SKUs) | set (count every SKU to the given stock) | ignore', { enum: ['new_only', 'set', 'ignore'] }) },
  },
  { name: 'products.prepare', method: 'POST', fn: 'lib_products.requestPrepare', effect: 'write', desc: 'Ask your AI agent to write listings of a product for some shops (a prepare_listing task; its drafts come back through Approvals).', params: { product: PRODUCT, shops: S('JSON list of shops (ids or names); default every active shop'), note: S('What the seller wants, e.g. "stress gift-giving"') } },
  {
    name: 'variants.add',
    method: 'POST',
    fn: 'lib_products.variantAdd',
    effect: 'write',
    desc: 'Add a SKU to a product.',
    params: { product: PRODUCT, sku: S('SKU (made when empty)'), option: S('Option, e.g. "Red / M"'), price: N('Selling price (base currency)'), cost: N('Unit cost (base currency)'), stock: N('Opening stock'), barcode: S('Barcode'), weight_g: N('Weight in grams'), low_stock: N('Low-stock level (0: the store default)') },
  },
  { name: 'variants.update', method: 'POST', fn: 'lib_products.variantUpdate', effect: 'write', desc: "Change a SKU's code, option, cost, barcode, weight or low-stock level (prices change with variants.set-price). A new cost fills in orders that sold without one.", params: { variant: VARIANT, sku: S('New SKU'), option: S('Option'), cost: N('Unit cost (base currency)'), barcode: S('Barcode'), weight_g: N('Weight in grams'), low_stock: N('Low-stock level') } },
  { name: 'variants.set-price', method: 'POST', fn: 'lib_products.setPrice', effect: 'write', agent: 'propose', kind: 'prices', desc: "Change a SKU's selling price (base currency).", params: { variant: VARIANT, price: N('New price', { required: true }) } },
  { name: 'variants.remove', method: 'POST', fn: 'lib_products.variantRemove', effect: 'write', destructive: true, lookup: 'lib_products.lookupVariant', desc: 'Delete a SKU and its stock ledger (past orders keep their lines).', params: { variant: VARIANT } },
  {
    name: 'listings.draft',
    method: 'POST',
    fn: 'lib_products.listingDraft',
    effect: 'write',
    agent: 'propose',
    kind: 'listings',
    desc: "Write or change a product's listing on one shop: title, description, price in the shop's currency, keywords, and draft or ready. A live listing stays live and shows that its changes still need publishing.",
    params: { product: PRODUCT, shop: S('The shop (id or name)', { required: true }), title: S('Listing title'), description: S('Listing description'), price: N("Price in the shop's currency"), keywords: S('JSON list of search keywords'), status: S('draft | ready (ready to publish)', { enum: ['draft', 'ready'] }) },
  },
  {
    name: 'listings.link',
    method: 'POST',
    fn: 'lib_products.listingLink',
    effect: 'write',
    desc: 'Record that a product is on a shop (found while syncing or importing): its id there, link, status, price and the stock it shows now.',
    params: { product: PRODUCT, shop: S('The shop (id or name)', { required: true }), external_id: S("The platform's listing id"), url: S('Listing link'), status: S('live (default) | paused | draft | ready', { enum: ['draft', 'ready', 'live', 'paused'] }), title: S('Title on the shop'), description: S('Description on the shop'), price: N("Price on the shop (shop's currency)"), stock: N('Quantity the shop shows now') },
  },
  {
    name: 'listings.status',
    method: 'POST',
    fn: 'lib_products.listingStatus',
    effect: 'write',
    desc: 'Set a listing\'s status: live after it was published (with its id and link), paused, ready or draft. Name it by --listing, or --product and --shop.',
    params: { listing: S('Listing id'), product: S('The product (with --shop)'), shop: S('The shop (with --product)'), status: S('draft | ready | live | paused', { required: true, enum: ['draft', 'ready', 'live', 'paused'] }), external_id: S("The platform's listing id"), url: S('Listing link') },
  },
  { name: 'listings.remove', method: 'POST', fn: 'lib_products.listingRemove', effect: 'write', destructive: true, lookup: 'lib_products.lookupListing', desc: 'Remove a listing from Store OS (it is not taken off the platform).', params: { listing: S('Listing id'), product: S('The product (with --shop)'), shop: S('The shop (with --product)') } },
  { name: 'listings.publish', method: 'POST', fn: 'lib_products.requestPublish', effect: 'write', desc: 'Ask your AI agent to publish listings on a shop (default: every ready listing and every live one with unpublished changes).', params: { shop: S('The shop (id or name)', { required: true }), listings: S('JSON list of listing ids (default: all that are due)') } },
];
