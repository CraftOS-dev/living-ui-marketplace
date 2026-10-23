/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot, transfer (caching, compression), live-update marks, write guards and
 * background jobs.
 *
 * - The SQL echo of PocketBase's dev mode (on by default in this build) is
 *   switched off at boot: an ERP's traffic would grow pocketbase.log by
 *   gigabytes.
 * - Every saved or deleted record marks its collection as changed; the
 *   dispatcher then tells open screens (lib_bus.js).
 * - Every collection changes only through the app's operations (they check
 *   rights, keep ledgers in step and write the audit trail). Direct API
 *   writes, even a superuser's (`agent-app data`), are refused.
 */

onBootstrap((e) => {
  e.next();
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[erp] could not quiet ' + name + ': ' + err);
    }
  }
  // Planner statistics: without them SQLite picks poor indexes once tables
  // grow (a customer list went from 4 s to 8 ms with them). Sampled, so it
  // stays quick on a large database; connections opened from now on use them.
  try {
    const db = $app.nonconcurrentDB();
    db.newQuery('PRAGMA analysis_limit=400').execute();
    db.newQuery('ANALYZE').execute();
  } catch (err) {
    console.log('[erp] could not gather planner statistics: ' + err);
  }
});

// Transfer: the built files under /assets/ carry a hash of their content in
// their names (a new build means new names, and the page itself is never
// cached), so browsers keep them for a year without asking again. Those files
// and operation answers go gzip-compressed (the main script shrinks about 3
// times, which matters through a share link or the tunnel); the realtime
// stream is left as it is.
routerUse((e) => {
  const path = String((e.request.url && e.request.url.path) || '');
  const asset = path.indexOf('/assets/') === 0;
  if (asset) e.response.header().set('Cache-Control', 'public, max-age=31536000, immutable');
  if (asset || path.indexOf('/api/ops/') === 0) return $apis.gzip().func(e);
  return e.next();
});

onRecordCreate((e) => {
  e.app.store().set('erp_d_' + e.record.collection().name, true);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('erp_d_' + e.record.collection().name, true);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('erp_d_' + e.record.collection().name, true);
  e.next();
});

// A deleted draft (document, journal, payment...) takes its waiting proposals with it, in the same transaction.
onRecordDelete(
  (e) => {
    require(`${__hooks}/lib_agent.js`).closeFor(e.app, e.record.collection().name, e.record.id);
    e.next();
  },
  'documents', 'journals', 'stock_changes', 'payments', 'builds', 'payroll_runs', 'expense_claims',
);

onRecordCreateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they check rights and keep the books in step). Run app.guide to see them.');
  },
  'settings', 'counters', 'roles', 'members', 'audit', 'notes', 'attachments', 'field_marks', 'departments', 'accounts', 'ledger_months', 'payment_terms', 'currencies', 'taxes',
  'parties', 'contacts', 'employees', 'projects', 'project_tasks', 'item_categories', 'warehouses', 'items', 'valuation', 'stock', 'journals', 'journal_lines', 'documents',
  'document_lines', 'stock_changes', 'stock_moves', 'banks', 'payments', 'allocations', 'imports', 'bank_lines', 'inbox', 'proposals', 'asks', 'leave_types', 'holidays',
  'leave_requests', 'leave_adjustments', 'expense_claims', 'claim_lines', 'pay_components', 'employee_components', 'payroll_runs', 'payslips', 'timesheets', 'boms', 'bom_lines',
  'builds', 'assets', 'budgets', 'users',
);

onRecordUpdateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they check rights and keep the books in step). Run app.guide to see them.');
  },
  'settings', 'counters', 'roles', 'members', 'audit', 'notes', 'attachments', 'field_marks', 'departments', 'accounts', 'ledger_months', 'payment_terms', 'currencies', 'taxes',
  'parties', 'contacts', 'employees', 'projects', 'project_tasks', 'item_categories', 'warehouses', 'items', 'valuation', 'stock', 'journals', 'journal_lines', 'documents',
  'document_lines', 'stock_changes', 'stock_moves', 'banks', 'payments', 'allocations', 'imports', 'bank_lines', 'inbox', 'proposals', 'asks', 'leave_types', 'holidays',
  'leave_requests', 'leave_adjustments', 'expense_claims', 'claim_lines', 'pay_components', 'employee_components', 'payroll_runs', 'payslips', 'timesheets', 'boms', 'bom_lines',
  'builds', 'assets', 'budgets', 'users',
);

onRecordDeleteRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (posted records are voided, never deleted). Run app.guide to see them.');
  },
  'settings', 'counters', 'roles', 'members', 'audit', 'notes', 'attachments', 'field_marks', 'departments', 'accounts', 'ledger_months', 'payment_terms', 'currencies', 'taxes',
  'parties', 'contacts', 'employees', 'projects', 'project_tasks', 'item_categories', 'warehouses', 'items', 'valuation', 'stock', 'journals', 'journal_lines', 'documents',
  'document_lines', 'stock_changes', 'stock_moves', 'banks', 'payments', 'allocations', 'imports', 'bank_lines', 'inbox', 'proposals', 'asks', 'leave_types', 'holidays',
  'leave_requests', 'leave_adjustments', 'expense_claims', 'claim_lines', 'pay_components', 'employee_components', 'payroll_runs', 'payslips', 'timesheets', 'boms', 'bom_lines',
  'builds', 'assets', 'budgets', 'users',
);

// Every minute: ask your AI agent about inbox files whose ask was refused
// (trigger cooldown) or lost to a restart. Idle unless something is marked.
// PocketBase points a hook runtime's $app at the open transaction while a
// record hook runs; a pooled runtime can carry that finished transaction
// into a job. A job that finds one skips this round (both are idempotent).
cronAdd('erp_inbox', '* * * * *', () => {
  if ($app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_agent.js`).fireIfNeeded($app);
  } catch (err) {
    console.error('[erp] inbox ask failed:', err);
  }
  try {
    require(`${__hooks}/lib_bus.js`).flush($app);
  } catch (err) {
    console.error('[erp] live update failed:', err);
  }
});

// Every hour: background work that keeps the books current (scheduled
// depreciation, reminders to your AI agent). Each job checks its own cursor.
cronAdd('erp_hourly', '13 * * * *', () => {
  if ($app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_jobs.js`).hourly($app);
  } catch (err) {
    console.error('[erp] hourly jobs failed:', err);
  }
  // Keep the planner statistics current as the books grow (cheap when nothing changed much).
  try {
    const db = $app.nonconcurrentDB();
    db.newQuery('PRAGMA analysis_limit=400').execute();
    db.newQuery('PRAGMA optimize').execute();
  } catch (err) {
    console.error('[erp] planner statistics failed:', err);
  }
  try {
    require(`${__hooks}/lib_bus.js`).flush($app);
  } catch (err) {
    console.error('[erp] live update failed:', err);
  }
});
