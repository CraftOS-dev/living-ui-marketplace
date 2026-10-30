/**
 * Catalog: the stock ledger and what each shop should show.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const VARIANT = S('The SKU (or variant id)', { required: true });

module.exports = [
  { name: 'stock.overview', method: 'GET', fn: 'lib_stock.overview', effect: 'read', desc: 'Every SKU with on hand, reserved (open orders), available, low-stock level, state (ok, low, out), unit cost and stock value; totals.', params: { q: S('Search SKU, option, title or barcode'), filter: S('all (default) | attention | low | out', { enum: ['all', 'attention', 'low', 'out'] }), limit: N('Rows (default 200)') } },
  { name: 'stock.moves', method: 'GET', fn: 'lib_stock.moves', effect: 'read', desc: "A SKU's stock ledger: every move with its reason, reference, who made it and the balance after.", params: { variant: VARIANT, limit: N('Rows (default 50)') } },
  { name: 'stock.adjust', method: 'POST', fn: 'lib_stock.adjust', effect: 'write', agent: 'propose', kind: 'stock', desc: 'Add or take away stock: +24 received, -2 damaged.', params: { variant: VARIANT, qty: N('Change, e.g. 24 or -2', { required: true }), reason: S('received | adjust | damage | return', { enum: ['received', 'adjust', 'damage', 'return'] }), ref: S('Reference, e.g. a supplier invoice'), note: S('Note') } },
  { name: 'stock.count', method: 'POST', fn: 'lib_stock.countSet', effect: 'write', agent: 'propose', kind: 'stock', desc: 'Set on hand to what you counted on the shelf (the ledger records the difference).', params: { variant: VARIANT, on_hand: N('Counted quantity', { required: true }), note: S('Note') } },
  { name: 'stock.plan', method: 'GET', fn: 'lib_stock.planOp', effect: 'read', desc: 'What each shop should show and does not yet: per live listing and SKU, the quantity (qty) from what is available and the shop\'s stock rule, and the last quantity set there (last, null when unknown); shop_count is how many shops need changes.', params: { shop: S('Only this shop'), sku: S('Only the product of this SKU') } },
  { name: 'stock.mark-pushed', method: 'POST', fn: 'lib_stock.markPushed', effect: 'write', desc: 'Record the quantities shops now show (after they were set on the platform), one call for any number of shops: items like [{"shop":"Shopee MY","sku":"MUG-BLU","qty":12}], or --all true with --shop (every stock.plan row of that shop) and/or --sku (that product on every shop).', params: { shop: S('The shop for items that name none, and for --all (id or name)'), items: S('JSON list like [{"shop":"Shopee MY","sku":"MUG-BLU","qty":12}]'), all: B('true: every stock.plan row for --shop and/or --sku, at its qty'), sku: S('With --all: only the product of this SKU') } },
  { name: 'stock.push', method: 'POST', fn: 'lib_stock.requestPush', effect: 'write', desc: 'Ask your AI agent to set the stock on a shop to stock.plan\'s numbers (a push_stock task).', params: { shop: S('The shop (id or name)', { required: true }) } },
];
