/// <reference path="../pb_data/types.d.ts" />
/**
 * Record guards.
 *
 * Every collection changes only through the app's operations (they keep
 * sales, payments, the drawer, stock, balances and the audit log in step),
 * so direct API writes are refused with a pointer to the operation to use.
 * Hook code writes through its own app handle and is not affected.
 */

const POS_COLLECTIONS = ['settings', 'registers', 'staff', 'timeclock', 'categories', 'taxes', 'modifier_groups', 'products', 'variants', 'customers', 'gift_cards', 'discounts', 'shifts', 'cash_moves', 'orders', 'order_lines', 'payments', 'stock_moves', 'account_moves', 'events', 'requests'];

onRecordCreateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...POS_COLLECTIONS);
onRecordUpdateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...POS_COLLECTIONS);
onRecordDeleteRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...POS_COLLECTIONS);
