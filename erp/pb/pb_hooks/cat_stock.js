/**
 * Catalog: items, categories, warehouses, stock levels and changes,
 * reorder, bills of materials and builds.
 */
const s = (desc, x) => Object.assign({ type: 'string', desc: desc }, x || {});
const r = (desc, example) => ({ type: 'string', required: true, desc: desc, example: example });
const b = (desc) => ({ type: 'boolean', desc: desc });
const n = (desc) => ({ type: 'number', desc: desc });
const e = (desc, values) => ({ type: 'string', desc: desc, enum: values });
const page = { limit: n('How many to return (default 50)'), offset: n('Skip this many (paging)') };

const ITEM = 'Item: SKU, barcode, exact name or id';
const itemFields = {
  name: s('Name'),
  sku: s('SKU (automatic when empty)'),
  kind: e('stock (counted), service, or non_stock (goods not counted)', ['stock', 'service', 'non_stock']),
  category: s('Category'),
  unit: s('Unit (pcs, kg, hour, ...)'),
  fractional: b('Counted in fractions (kg, m)'),
  barcode: s('Barcode'),
  description: s('Description'),
  sale_price: s('Sale price, e.g. 12.50'),
  purchase_price: s('Purchase price, e.g. 7.20'),
  sale_tax: s('Sales tax (code, or none)'),
  purchase_tax: s('Purchase tax (code, or none)'),
  income_account: s('Income account (default from the category)'),
  expense_account: s('Expense or cost of goods account'),
  min_qty: s('Reorder point'),
  max_qty: s('Target level when reordering'),
  lead_time_days: n('Days the supplier takes'),
  supplier: s('Preferred supplier'),
  archived: b('Archived'),
  remove_photo: b('Remove the photo'),
};
const CHANGE_LINES = 'JSON list. adjust: [{"item":"SKU-00001","qty":5,"unit_cost":"2.10"}] (minus for out); count: [{"item":"SKU-00001","counted":18}]; transfer: [{"item":"SKU-00001","qty":5}]';

module.exports = [
  { name: 'items.list', method: 'GET', fn: 'lib_items.list', perm: 'self', desc: 'Items with on hand, value, incoming, committed and status (ok, low, out, over).', params: Object.assign({ q: s('Search name, SKU, barcode, description'), kind: e('Kind', ['stock', 'service', 'non_stock']), category: s('Category'), supplier: s('Supplier'), warehouse: s('Only items stocked there'), status: e('Status', ['ok', 'low', 'out', 'over', 'reorder']), archived: e('active, archived or all', ['active', 'archived', 'all']), sort: e('Sort', ['name', 'sku', 'on_hand', 'value', 'price', 'updated']), desc: b('Descending') }, page) },
  { name: 'items.get', method: 'GET', fn: 'lib_items.get', perm: 'self', desc: 'One item: stock per warehouse, value, 90 days of on hand, usage, open orders, history.', params: { item: r(ITEM) } },
  { name: 'items.add', method: 'POST', fn: 'lib_items.add', perm: 'self', files: ['photo'], desc: 'Add an item (opening_qty records the stock you start with).', params: Object.assign({}, itemFields, { name: r('Name'), opening_qty: s('Opening stock'), opening_cost: s('Cost per unit of the opening stock'), opening_date: s('Date of the opening stock'), warehouse: s('Warehouse of the opening stock') }) },
  { name: 'items.update', method: 'POST', fn: 'lib_items.update', perm: 'self', files: ['photo'], desc: 'Change an item.', params: Object.assign({ item: r(ITEM) }, itemFields) },
  { name: 'items.archive', method: 'POST', fn: 'lib_items.setArchived', perm: 'self', desc: 'Archive (or restore) items.', params: { items: r('JSON list of items', '\'["SKU-00001"]\''), archived: b('true archives, false restores') } },
  { name: 'items.delete', method: 'POST', fn: 'lib_items.remove', perm: 'self', destructive: true, desc: 'Delete an item with no history (archive the others).', params: { item: r(ITEM), preview: b('Only say what would happen') } },
  { name: 'items.photo', method: 'GET', fn: 'lib_items.photo', perm: 'self', desc: "An item's photo URL and file path.", params: { item: r(ITEM) } },
  { name: 'categories.list', method: 'GET', fn: 'lib_items.listCategories', perm: 'self', desc: 'Item categories and the line icons they can wear.', params: {} },
  { name: 'categories.add', method: 'POST', fn: 'lib_items.addCategory', perm: 'self', desc: 'Add a category.', params: { name: r('Name'), icon: s('Line icon name'), income_account: s('Income account'), expense_account: s('Expense or cost account'), sort: n('Order') } },
  { name: 'categories.update', method: 'POST', fn: 'lib_items.updateCategory', perm: 'self', desc: 'Change a category.', params: { category: r('Category'), name: s('Name'), icon: s('Line icon name'), income_account: s('Income account'), expense_account: s('Expense account'), sort: n('Order') } },
  { name: 'categories.delete', method: 'POST', fn: 'lib_items.deleteCategory', perm: 'self', destructive: true, desc: 'Delete a category (its items keep no category).', params: { category: r('Category'), preview: b('Only say what would happen') } },
  { name: 'warehouses.list', method: 'GET', fn: 'lib_items.listWarehouses', perm: 'self', desc: 'Warehouses with items, units and value.', params: {} },
  { name: 'warehouses.add', method: 'POST', fn: 'lib_items.addWarehouse', perm: 'self', desc: 'Add a warehouse.', params: { name: r('Name'), code: s('Code'), address: s('Address') } },
  { name: 'warehouses.update', method: 'POST', fn: 'lib_items.updateWarehouse', perm: 'self', desc: 'Change a warehouse.', params: { warehouse: r('Warehouse'), name: s('Name'), code: s('Code'), address: s('Address'), archived: b('Archived') } },
  { name: 'warehouses.delete', method: 'POST', fn: 'lib_items.deleteWarehouse', perm: 'self', destructive: true, desc: 'Delete an empty warehouse with no history.', params: { warehouse: r('Warehouse'), preview: b('Only say what would happen') } },
  { name: 'stock.levels', method: 'GET', fn: 'lib_items.levels', perm: 'self', desc: 'On hand and value per item and warehouse.', params: Object.assign({ warehouse: s('Warehouse'), q: s('Search item') }, page) },
  { name: 'stock.moves', method: 'GET', fn: 'lib_items.moves', perm: 'self', desc: 'Stock history: every move with its value and source.', params: Object.assign({ item: s(ITEM), warehouse: s('Warehouse'), kind: s('Kind of move'), from: s('From YYYY-MM-DD'), to: s('To YYYY-MM-DD') }, page) },
  {
    name: 'stock.change',
    method: 'POST',
    fn: 'lib_items.change',
    perm: 'inventory:edit',
    agent: 'propose',
    preview: 'lib_items.previewChange',
    desc: 'Adjust stock up or down, set counted quantities, or transfer between warehouses, as one numbered change with its journal entry. From your AI agent this is a proposal unless stock changes may post on their own.',
    params: { kind: e('adjust, count or transfer', ['adjust', 'count', 'transfer']), warehouse: s('Warehouse (default the main one)'), to_warehouse: s('Transfers: where it goes'), reason: e('Why', ['count', 'damage', 'loss', 'found', 'expiry', 'sample', 'correction', 'opening', 'other']), account: s('Offset account (default Stock adjustments)'), date: s('Date (default today)'), note: s('Note'), lines: r(CHANGE_LINES) },
  },
  { name: 'stock.preview-change', method: 'POST', fn: 'lib_items.previewChange', perm: 'self', desc: 'What a stock change would post, without posting.', params: { kind: e('adjust, count or transfer', ['adjust', 'count', 'transfer']), warehouse: s('Warehouse'), to_warehouse: s('Transfers: where it goes'), reason: s('Why'), account: s('Offset account'), date: s('Date'), note: s('Note'), lines: r(CHANGE_LINES) } },
  { name: 'stock.changes', method: 'GET', fn: 'lib_items.listChanges', perm: 'self', desc: 'Stock changes (adjustments, counts, transfers).', params: Object.assign({ kind: e('Kind', ['adjust', 'count', 'transfer']) }, page) },
  { name: 'stock.change-get', method: 'GET', fn: 'lib_items.getChange', perm: 'self', desc: 'One stock change with its moves.', params: { change: r('Change number (ADJ-00001) or id') } },
  {
    name: 'stock.void-change',
    method: 'POST',
    fn: 'lib_items.voidChange',
    perm: 'inventory:full',
    agent: 'propose',
    preview: 'lib_items.previewVoidChange',
    desc: 'Void a stock change (its moves and entry are reversed).',
    params: { change: r('Change number or id') },
  },
  { name: 'stock.preview-void', method: 'GET', fn: 'lib_items.previewVoidChange', perm: 'inventory:full', desc: 'What voiding a stock change would reverse (the journal lines), without voiding.', params: { change: r('Change number or id') } },
  { name: 'reorder.list', method: 'GET', fn: 'lib_items.reorderList', perm: 'self', desc: 'What to reorder, grouped by supplier, with a plain-words reason for each.', params: {} },
  { name: 'reorder.create-orders', method: 'POST', fn: 'lib_items.reorderCreate', perm: 'self', desc: 'Draft purchase orders for the suggestions: one draft per supplier (safe to repeat). Never sends them.', params: { items: s('JSON list [{"item":"SKU-00001","qty":30}] (default: all suggestions)'), note: s('Why these quantities (shown on the drafts)') } },

  /* manufacturing */
  { name: 'boms.list', method: 'GET', fn: 'lib_mfg.listBoms', perm: 'manufacturing:view', desc: 'Bills of materials.', params: { q: s('Search'), item: s('Finished item') } },
  { name: 'boms.get', method: 'GET', fn: 'lib_mfg.getBom', perm: 'manufacturing:view', desc: 'One bill of materials with component costs and what can be built now.', params: { bom: r('Name or id') } },
  { name: 'boms.add', method: 'POST', fn: 'lib_mfg.addBom', perm: 'manufacturing:edit', desc: 'Add a bill of materials.', params: { item: r('Finished item'), name: s('Name'), output_qty: s('Quantity it makes (default 1)'), extra_cost: s('Labor and overhead per unit made'), notes: s('Notes'), lines: r('JSON list [{"item":"SKU-00002","qty":2}]') } },
  { name: 'boms.update', method: 'POST', fn: 'lib_mfg.updateBom', perm: 'manufacturing:edit', desc: 'Change a bill of materials.', params: { bom: r('Bill of materials'), name: s('Name'), output_qty: s('Quantity it makes'), extra_cost: s('Labor and overhead per unit'), notes: s('Notes'), active: b('In use'), lines: s('JSON list of components (replaces all)') } },
  { name: 'boms.delete', method: 'POST', fn: 'lib_mfg.deleteBom', perm: 'manufacturing:edit', destructive: true, desc: 'Delete a bill of materials no build used.', params: { bom: r('Bill of materials'), preview: b('Only say what would happen') } },
  { name: 'builds.list', method: 'GET', fn: 'lib_mfg.listBuilds', perm: 'manufacturing:view', desc: 'Builds (production orders).', params: Object.assign({ status: e('Status', ['draft', 'done', 'void']) }, page) },
  { name: 'builds.get', method: 'GET', fn: 'lib_mfg.getBuild', perm: 'manufacturing:view', desc: 'One build: components needed and available, cost.', params: { build: r('Build number (MO-00001) or id') } },
  { name: 'builds.create', method: 'POST', fn: 'lib_mfg.createBuild', perm: 'manufacturing:edit', desc: 'Plan a build (a draft).', params: { bom: r('Bill of materials'), qty: r('How many to make', '10'), warehouse: s('Warehouse'), date: s('Date'), note: s('Note') } },
  { name: 'builds.update', method: 'POST', fn: 'lib_mfg.updateBuild', perm: 'manufacturing:edit', desc: 'Change a draft build.', params: { build: r('Build'), qty: s('How many'), warehouse: s('Warehouse'), date: s('Date'), note: s('Note') } },
  {
    name: 'builds.complete',
    method: 'POST',
    fn: 'lib_mfg.completeBuild',
    perm: 'manufacturing:full',
    agent: 'propose',
    preview: 'lib_mfg.previewComplete',
    desc: 'Complete a build: components go out at average cost, the finished item comes in at their cost plus labor and overhead.',
    params: { build: r('Build'), date: s('Date') },
  },
  { name: 'builds.preview-complete', method: 'GET', fn: 'lib_mfg.previewComplete', perm: 'manufacturing:full', desc: 'What completing a build would post (components out, finished goods in, the journal lines) and any shortfall, without posting.', params: { build: r('Build'), date: s('Date') } },
  { name: 'builds.void', method: 'POST', fn: 'lib_mfg.voidBuild', perm: 'manufacturing:full', agent: 'propose', preview: 'lib_mfg.previewVoid', desc: 'Void a completed build (reverses its moves and entry).', params: { build: r('Build'), reason: s('Why') } },
  { name: 'builds.preview-void', method: 'GET', fn: 'lib_mfg.previewVoid', perm: 'manufacturing:full', desc: 'What voiding a completed build would reverse, without voiding.', params: { build: r('Build'), reason: s('Why') } },
  { name: 'builds.delete', method: 'POST', fn: 'lib_mfg.deleteBuild', perm: 'manufacturing:edit', destructive: true, desc: 'Delete a draft build.', params: { build: r('Build'), preview: b('Only say what would happen') } },
];
