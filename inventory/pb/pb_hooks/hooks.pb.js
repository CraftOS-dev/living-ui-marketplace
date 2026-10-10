/// <reference path="../pb_data/types.d.ts" />
/**
 * Record rules and background jobs.
 *
 * The rules live on the RECORD, not only in the ops, so they hold for every
 * writer: the UI, the agent's ops, and raw `agent-app data` writes.
 *
 * Quantities, orders, counts, documents and imports change only through the
 * app's operations (they keep the ledger and everything derived from it in
 * step), so direct API writes to those collections are refused with a
 * pointer to the operation to use. Items, barcodes, categories, locations
 * and suppliers may be written directly; their rules below still apply.
 */

/* ----------------------------------------------------- record rules */

onRecordCreate((e) => {
  require(`${__hooks}/lib_items.js`).checkRecord(e.app, e.record);
  e.next();
}, 'items');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_items.js`).checkRecord(e.app, e.record);
  e.next();
}, 'items');

onRecordCreate((e) => {
  require(`${__hooks}/lib_locations.js`).checkRecord(e.app, e.record);
  e.next();
}, 'locations');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_locations.js`).checkRecord(e.app, e.record);
  e.next();
}, 'locations');

// A place that still holds stock cannot disappear (its stock would vanish with it).
onRecordDelete((e) => {
  const held = require(`${__hooks}/lib_locations.js`).stockIn(e.app, e.record.id);
  if (held !== '') {
    throw new BadRequestError('"' + e.record.getString('name') + '" still holds ' + held + '. Move or remove that stock before deleting it.');
  }
  // Whoever deletes it, the places inside it move up a level (not to the top).
  require(`${__hooks}/lib_locations.js`).liftChildren(e.app, e.record);
  e.next();
}, 'locations');

onRecordCreate((e) => {
  require(`${__hooks}/lib_rules.js`).checkCode(e.app, e.record);
  e.next();
}, 'codes');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_rules.js`).checkCode(e.app, e.record);
  e.next();
}, 'codes');

onRecordCreate((e) => {
  require(`${__hooks}/lib_rules.js`).checkCategory(e.record);
  e.next();
}, 'categories');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_rules.js`).checkCategory(e.record);
  e.next();
}, 'categories');

onRecordCreate((e) => {
  require(`${__hooks}/lib_rules.js`).checkSupplier(e.record);
  e.next();
}, 'suppliers');

onRecordUpdate((e) => {
  require(`${__hooks}/lib_rules.js`).checkSupplier(e.record);
  e.next();
}, 'suppliers');

/* ------------------------------------------- operations-only writes */

onRecordCreateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), 'stock', 'movements', 'orders', 'order_lines', 'counts', 'count_lines', 'documents', 'imports', 'settings');
onRecordUpdateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), 'stock', 'movements', 'orders', 'order_lines', 'counts', 'count_lines', 'documents', 'imports', 'settings');
onRecordDeleteRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), 'stock', 'movements', 'orders', 'order_lines', 'counts', 'count_lines', 'documents', 'imports', 'settings');

/* --------------------------------------------- asking the AI agent */

// A document waiting to be read asks the AI agent (one ask drains them all).
onRecordAfterCreateSuccess((e) => {
  try {
    if (e.record.getString('status') === 'waiting') {
      const docs = require(`${__hooks}/lib_docs.js`);
      docs.markDirty(e.app);
      docs.fireIfNeeded(e.app);
    }
  } catch (err) {
    console.error('[inventory] asking the AI agent about a document failed:', err);
  }
  e.next();
}, 'documents');

// Any stock change, a new item with a reorder point, or an order that no
// longer brings stock may make an item need reordering: note it for the
// restock check.
onRecordAfterCreateSuccess((e) => {
  e.app.store().set('inv_restock_dirty', true);
  e.next();
}, 'movements', 'items');

onRecordAfterUpdateSuccess((e) => {
  e.app.store().set('inv_restock_dirty', true);
  e.next();
}, 'items', 'settings', 'orders', 'order_lines');

onRecordAfterDeleteSuccess((e) => {
  e.app.store().set('inv_restock_dirty', true);
  e.next();
}, 'orders', 'order_lines');

// Deleting an item removes its order lines: the orders they were on re-derive
// their status (a partial order whose last open line went is received).
onRecordDelete((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const pos = u.rows(e.app, 'SELECT DISTINCT po FROM order_lines WHERE item = {:i}', { po: '' }, { i: e.record.id }).map((r) => r.po);
  e.next();
  for (const po of pos) require(`${__hooks}/lib_orders.js`).sync(e.app, po);
}, 'items');

// Every minute: re-ask about documents whose ask was refused (trigger
// cooldown) or lost to a restart. Touches the database only when needed.
cronAdd('inv_documents', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_docs.js`).fireIfNeeded($app);
  } catch (err) {
    console.error('[inventory] document ask failed:', err);
  }
});

// Every minute, only after stock or settings changed (and once after a
// start): ask the AI agent to draft orders for items that newly run low,
// when auto restock is on.
cronAdd('inv_restock', '* * * * *', () => {
  const store = $app.store();
  const booted = store.get('inv_restock_booted') === true;
  if (booted && store.get('inv_restock_dirty') !== true) return;
  store.set('inv_restock_booted', true);
  store.set('inv_restock_dirty', false);
  require(`${__hooks}/lib_reorder.js`).maybeAsk($app);
});
