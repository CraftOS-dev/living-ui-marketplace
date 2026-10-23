/// <reference path="../pb_data/types.d.ts" />
/**
 * Live updates without exposing data.
 *
 * Every collection is closed to the raw API, so screens cannot subscribe to
 * records. Instead a record hook marks the collection as changed (in memory)
 * and, when an operation or job finishes, flush() sends ONE message on the
 * custom realtime topic "erp" listing the collections that changed. Screens
 * reload the views that read those collections through operations, which
 * check the caller's rights as always. The message carries names only.
 */

const COLLECTIONS = [
  'settings', 'counters', 'roles', 'members', 'audit', 'notes', 'attachments', 'field_marks', 'departments', 'accounts',
  'ledger_months', 'payment_terms', 'currencies', 'taxes', 'parties', 'contacts', 'employees', 'projects', 'project_tasks',
  'item_categories', 'warehouses', 'items', 'valuation', 'stock', 'journals', 'journal_lines', 'documents', 'document_lines',
  'stock_changes', 'stock_moves', 'banks', 'payments', 'allocations', 'imports', 'bank_lines', 'inbox', 'proposals', 'asks',
  'leave_types', 'holidays', 'leave_requests', 'leave_adjustments', 'expense_claims', 'claim_lines', 'pay_components',
  'employee_components', 'payroll_runs', 'payslips', 'timesheets', 'boms', 'bom_lines', 'builds', 'assets', 'budgets',
];

const PREFIX = 'erp_d_';

function mark(app, name) {
  app.store().set(PREFIX + name, true);
}

/** Send one "erp" message naming every collection changed since the last flush. */
function flush(app) {
  const store = app.store();
  const changed = [];
  for (const c of COLLECTIONS) {
    if (store.get(PREFIX + c) === true) {
      store.remove(PREFIX + c);
      changed.push(c);
    }
  }
  if (changed.length === 0) return;
  try {
    const msg = new SubscriptionMessage({ name: 'erp', data: JSON.stringify({ c: changed }) });
    const clients = app.subscriptionsBroker().clients();
    for (const id in clients) {
      try {
        if (clients[id].hasSubscription('erp')) clients[id].send(msg);
      } catch {
        /* a client that just left */
      }
    }
  } catch (err) {
    console.error('[erp] realtime flush failed:', err);
  }
}

module.exports = { COLLECTIONS: COLLECTIONS, mark: mark, flush: flush };
