/// <reference path="../pb_data/types.d.ts" />
/**
 * The operations to use instead of writing a collection directly.
 */

const OPS_ONLY = {
  settings: 'settings.update, permissions.update or setup.complete',
  registers: 'registers.save or registers.focus',
  staff: 'staff.save (and records.delete --collection staff)',
  timeclock: 'staff.clock or timeclock.save',
  categories: 'categories.save',
  taxes: 'taxes.save',
  modifier_groups: 'modifiers.save',
  products: 'products.save or products.import',
  variants: 'products.save (variants are part of their product)',
  customers: 'customers.save, customers.adjust or customers.import',
  gift_cards: 'giftcards.save or giftcards.adjust (cards sold on a sale are issued when it is paid)',
  discounts: 'discounts.save',
  shifts: 'shifts.open, shifts.cash and shifts.close',
  cash_moves: 'shifts.cash',
  orders: 'orders.add, orders.line, orders.remove, orders.update, orders.return, orders.void and payments.add',
  order_lines: 'orders.add, orders.line and orders.remove',
  payments: 'payments.add and payments.void',
  stock_moves: 'stock.change (sales and returns move stock on their own)',
  account_moves: 'customers.adjust and giftcards.adjust (sales move balances on their own)',
  events: 'nothing: the audit log is written by the operations',
  requests: 'requests.create and requests.update',
};

/** Refuse a direct API write to a collection that changes only through operations. */
function refuse(rec) {
  const name = rec.collection().name;
  throw new BadRequestError('"' + name + '" records change only through the app\'s operations, which keep sales, money, stock and the audit log in step. Use ' + (OPS_ONLY[name] || 'the app operations') + ' (see app.guide).');
}

module.exports = { OPS_ONLY: OPS_ONLY, refuse: refuse };
