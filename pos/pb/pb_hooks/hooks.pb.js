/// <reference path="../pb_data/types.d.ts" />
/**
 * Record guards and background jobs.
 *
 * Every collection of the app changes only through its operations, which
 * check permissions, keep the ledger and stock in step and write the audit
 * trail. Direct API writes (even a superuser's, e.g. the agent-app `data`
 * command) are refused with a pointer to the operations. The app's own
 * operations write through the app handle, which never passes these
 * request hooks.
 */

onRecordCreateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they check permissions and keep sales, stock and the audit trail in step). Run app.guide to see them.');
  },
  'settings', 'tax_classes', 'registers', 'counters', 'tenders', 'staff', 'staff_pins', 'sessions', 'approvals', 'customers', 'categories',
  'modifier_groups', 'modifiers', 'products', 'variants', 'codes', 'discounts', 'shifts', 'sales', 'sale_lines', 'payments',
  'carts', 'cash_moves', 'stock', 'stock_moves', 'tickets', 'imports', 'audit',
);

onRecordUpdateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they check permissions and keep sales, stock and the audit trail in step). Run app.guide to see them.');
  },
  'settings', 'tax_classes', 'registers', 'counters', 'tenders', 'staff', 'staff_pins', 'sessions', 'approvals', 'customers', 'categories',
  'modifier_groups', 'modifiers', 'products', 'variants', 'codes', 'discounts', 'shifts', 'sales', 'sale_lines', 'payments',
  'carts', 'cash_moves', 'stock', 'stock_moves', 'tickets', 'imports', 'audit',
);

onRecordDeleteRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (sales, payments and the audit trail are never deleted). Run app.guide to see them.');
  },
  'settings', 'tax_classes', 'registers', 'counters', 'tenders', 'staff', 'staff_pins', 'sessions', 'approvals', 'customers', 'categories',
  'modifier_groups', 'modifiers', 'products', 'variants', 'codes', 'discounts', 'shifts', 'sales', 'sale_lines', 'payments',
  'carts', 'cash_moves', 'stock', 'stock_moves', 'tickets', 'imports', 'audit',
);

// Every minute: re-ask your AI agent about menu files whose ask was refused
// (trigger cooldown) or lost to a restart. Touches the database only when needed.
cronAdd('pos_imports', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_imports.js`).fireIfNeeded($app);
  } catch (err) {
    console.error('[pos] asking about imports failed:', err);
  }
});

// Hourly: end expired sessions and drop approvals that were used or ran out.
cronAdd('pos_cleanup', '17 * * * *', () => {
  try {
    const now = new Date().toISOString();
    for (const s of $app.findRecordsByFilter('sessions', 'ended = false && expires < {:n}', '', 500, 0, { n: now })) {
      s.set('ended', true);
      $app.save(s);
    }
    const old = new Date(Date.now() - 24 * 3600000).toISOString();
    for (const a of $app.findRecordsByFilter('approvals', '(used = true || expires < {:n})', '', 500, 0, { n: old })) {
      $app.delete($app.findRecordById('approvals', a.id));
    }
    const stale = new Date(Date.now() - 30 * 24 * 3600000).toISOString().replace('T', ' ');
    for (const s of $app.findRecordsByFilter('sessions', 'ended = true && updated < {:n}', '', 500, 0, { n: stale })) {
      $app.delete($app.findRecordById('sessions', s.id));
    }
  } catch (err) {
    console.error('[pos] cleanup failed:', err);
  }
});
