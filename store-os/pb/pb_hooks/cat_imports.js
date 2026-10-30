/**
 * Catalog: file imports (seller-centre exports read in the page).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  { name: 'imports.orders', method: 'POST', fn: 'lib_imports.orders', effect: 'write', bodyLimit: 31457280, desc: "Import a shop's order export: rows already matched to Store OS fields (app.guide rows.order). Matched on order number, so importing the same file twice changes nothing; the import is kept with its results.", params: { shop: S('The shop (id or name)', { required: true }), items: S('JSON list of order rows', { required: true }), file_name: S('The file name') } },
  { name: 'imports.products', method: 'POST', fn: 'lib_imports.products', effect: 'write', bodyLimit: 31457280, desc: 'Import a product list (app.guide rows.product), matched on SKU; with --shop the listings on that shop are recorded too.', params: { items: S('JSON list of product rows', { required: true }), shop: S('The shop the export comes from'), file_name: S('The file name'), stock_mode: S('new_only (default) | set | ignore', { enum: ['new_only', 'set', 'ignore'] }) } },
  { name: 'imports.list', method: 'GET', fn: 'lib_imports.list', effect: 'read', desc: 'Past imports with what each created, updated and skipped, and why.', params: { limit: N('Rows (default 30)') } },
];
