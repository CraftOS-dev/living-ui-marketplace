/// <reference path="../pb_data/types.d.ts" />
/**
 * Ledgerflow schema (one person, auth mode none, loopback only).
 *
 * Money is an integer count of the currency's minor unit (cents); rates and
 * quantities are decimal strings. Dates are text YYYY-MM-DD (a book date, not
 * a moment). Ledger collections can be read by the UI (live updates) but are
 * written only through the operations, which validate every change.
 *
 *   settings          one row: the business, home currency, tax region,
 *                     lock dates, numbering, the AI agent's posting policy
 *   accounts          chart of accounts (tree), with system roles
 *   tax_codes         rates and where tax posts; return groups
 *   contacts          customers, vendors and others
 *   transactions      proposed, posted or voided; who made them and why
 *   postings          the debit (+) and credit (-) lines of a transaction
 *   documents         invoices, bills, credit notes, vendor credits;
 *                     doc_lines their lines; allocations the payments,
 *                     credits and write-offs applied to them
 *   files             receipts and documents waiting to be read or linked
 *   statement_imports bank statement files imported; statement_lines their
 *                     lines, staged in the inbox until posted or matched
 *   csv_profiles      remembered column mappings per bank account
 *   reconciliations   statement sessions per account
 *   rules             categorization rules
 *   recurring         templates for repeating transactions and documents
 *   budgets           per account per year (12 months)
 *   periods           month-end close checklists
 *   fx_rates          exchange rates to the home currency
 *   asks              questions and jobs for the AI agent
 *   activity          every change with its undo
 */
migrate(
  (app) => {
    const read = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const stamp = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const save = (def) => {
      const c = new Collection(Object.assign({ type: 'base' }, read, def, { fields: def.fields.concat(stamp) }));
      app.save(c);
      return c;
    };
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: '^$|^\\d{4}-\\d{2}-\\d{2}$' });

    save({
      name: 'settings',
      fields: [
        { name: 'business_name', type: 'text', max: 120 },
        { name: 'entity', type: 'select', maxSelect: 1, values: ['business', 'personal', 'both'] },
        { name: 'home_currency', type: 'text', max: 3 },
        { name: 'fiscal_year_start', type: 'number' },
        { name: 'region', type: 'text', max: 20 },
        { name: 'rounding', type: 'select', maxSelect: 1, values: ['line', 'document'] },
        day('lock_date'),
        day('agent_lock_date'),
        day('tax_lock_date'),
        { name: 'invoice_prefix', type: 'text', max: 12 },
        { name: 'invoice_next', type: 'number' },
        { name: 'credit_prefix', type: 'text', max: 12 },
        { name: 'credit_next', type: 'number' },
        { name: 'payment_terms', type: 'number' },
        { name: 'business_address', type: 'text', max: 500 },
        { name: 'business_email', type: 'text', max: 200 },
        { name: 'business_tax_id', type: 'text', max: 60 },
        { name: 'invoice_footer', type: 'text', max: 1000 },
        { name: 'policy', type: 'json', maxSize: 20000 },
        { name: 'ui', type: 'json', maxSize: 20000 },
        { name: 'agent_categorize', type: 'bool' },
        { name: 'setup_done', type: 'bool' },
      ],
    });

    const accounts = save({
      name: 'accounts',
      fields: [
        { name: 'code', type: 'text', required: true, max: 20 },
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['asset', 'liability', 'equity', 'income', 'expense'] },
        { name: 'subtype', type: 'text', max: 30 },
        { name: 'currency', type: 'text', max: 3 },
        { name: 'description', type: 'text', max: 500 },
        { name: 'system', type: 'text', max: 30 },
        { name: 'cashflow', type: 'select', maxSelect: 1, values: ['cash', 'operating', 'investing', 'financing'] },
        { name: 'archived', type: 'bool' },
        { name: 'sort', type: 'number' },
        { name: 'bank_name', type: 'text', max: 80 },
        { name: 'bank_number', type: 'text', max: 40 },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_accounts_code ON accounts (code)'],
    });
    accounts.fields.add(new RelationField({ name: 'parent', collectionId: accounts.id, maxSelect: 1 }));
    app.save(accounts);

    const taxes = save({
      name: 'tax_codes',
      fields: [
        { name: 'code', type: 'text', required: true, max: 20 },
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'rate', type: 'text', max: 12 },
        { name: 'scope', type: 'select', maxSelect: 1, values: ['sales', 'purchases', 'both'] },
        { name: 'group', type: 'select', maxSelect: 1, values: ['standard', 'reduced', 'zero', 'exempt', 'reverse', 'outside'] },
        { name: 'account', type: 'relation', collectionId: accounts.id, maxSelect: 1 },
        { name: 'description', type: 'text', max: 300 },
        { name: 'archived', type: 'bool' },
        { name: 'sort', type: 'number' },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_tax_codes_code ON tax_codes (code)'],
    });

    const contacts = save({
      name: 'contacts',
      fields: [
        { name: 'name', type: 'text', required: true, max: 160 },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['customer', 'vendor', 'both', 'other'] },
        { name: 'email', type: 'text', max: 200 },
        { name: 'phone', type: 'text', max: 60 },
        { name: 'address', type: 'text', max: 500 },
        { name: 'tax_id', type: 'text', max: 60 },
        { name: 'currency', type: 'text', max: 3 },
        { name: 'terms', type: 'number' },
        { name: 'default_account', type: 'relation', collectionId: accounts.id, maxSelect: 1 },
        { name: 'default_tax', type: 'relation', collectionId: taxes.id, maxSelect: 1 },
        { name: 'aliases', type: 'json', maxSize: 4000 },
        { name: 'notes', type: 'text', max: 2000 },
        { name: 'archived', type: 'bool' },
      ],
      indexes: ['CREATE INDEX idx_contacts_name ON contacts (name)'],
    });

    const txns = save({
      name: 'transactions',
      fields: [
        day('date'),
        { name: 'narration', type: 'text', max: 500 },
        { name: 'contact', type: 'relation', collectionId: contacts.id, maxSelect: 1 },
        {
          name: 'kind',
          type: 'select',
          maxSelect: 1,
          values: ['expense', 'income', 'transfer', 'journal', 'invoice', 'bill', 'credit_note', 'vendor_credit', 'payment', 'opening', 'adjustment', 'reconciliation', 'fx', 'writeoff', 'reversal'],
        },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['proposed', 'posted', 'voided'] },
        { name: 'reference', type: 'text', max: 80 },
        { name: 'tags', type: 'json', maxSize: 2000 },
        { name: 'document', type: 'text', max: 20 },
        { name: 'source_line', type: 'text', max: 20 },
        { name: 'reverses', type: 'text', max: 20 },
        { name: 'recurring', type: 'text', max: 20 },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent', 'rule', 'import', 'recurring', 'system'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'method', type: 'select', maxSelect: 1, values: ['manual', 'rule', 'match', 'memory', 'agent', 'transfer', 'recurring', 'document'] },
        { name: 'confidence', type: 'select', maxSelect: 1, values: ['high', 'medium', 'low'] },
        { name: 'reason', type: 'text', max: 1000 },
        { name: 'evidence', type: 'json', maxSize: 20000 },
        { name: 'void_reason', type: 'text', max: 500 },
        { name: 'version', type: 'number' },
      ],
      indexes: ['CREATE INDEX idx_txn_date ON transactions (date)', 'CREATE INDEX idx_txn_status ON transactions (status)', 'CREATE INDEX idx_txn_document ON transactions (document)'],
    });

    save({
      name: 'postings',
      fields: [
        { name: 'txn', type: 'relation', required: true, collectionId: txns.id, cascadeDelete: true, maxSelect: 1 },
        day('date'),
        { name: 'status', type: 'select', maxSelect: 1, values: ['proposed', 'posted', 'voided'] },
        { name: 'account', type: 'relation', required: true, collectionId: accounts.id, maxSelect: 1 },
        { name: 'amount', type: 'number' },
        { name: 'currency', type: 'text', max: 3 },
        { name: 'home_amount', type: 'number' },
        { name: 'rate', type: 'text', max: 24 },
        { name: 'contact', type: 'relation', collectionId: contacts.id, maxSelect: 1 },
        { name: 'tax_code', type: 'relation', collectionId: taxes.id, maxSelect: 1 },
        { name: 'tax_role', type: 'select', maxSelect: 1, values: ['base', 'tax'] },
        { name: 'memo', type: 'text', max: 300 },
        { name: 'recon_state', type: 'select', maxSelect: 1, values: ['cleared', 'reconciled'] },
        { name: 'reconciliation', type: 'text', max: 20 },
        { name: 'statement_line', type: 'text', max: 20 },
        { name: 'line', type: 'number' },
      ],
      indexes: ['CREATE INDEX idx_post_account_date ON postings (account, date)', 'CREATE INDEX idx_post_txn ON postings (txn)', 'CREATE INDEX idx_post_status ON postings (status)'],
    });

    const docs = save({
      name: 'documents',
      fields: [
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['invoice', 'bill', 'credit_note', 'vendor_credit'] },
        { name: 'number', type: 'text', max: 40 },
        { name: 'contact', type: 'relation', collectionId: contacts.id, maxSelect: 1 },
        day('issue_date'),
        day('due_date'),
        { name: 'currency', type: 'text', max: 3 },
        { name: 'rate', type: 'text', max: 24 },
        { name: 'inclusive', type: 'bool' },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'approved', 'void'] },
        { name: 'subtotal', type: 'number' },
        { name: 'tax_total', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'home_total', type: 'number' },
        { name: 'allocated', type: 'number' },
        { name: 'notes', type: 'text', max: 2000 },
        { name: 'terms', type: 'text', max: 1000 },
        { name: 'reference', type: 'text', max: 80 },
        { name: 'txn', type: 'text', max: 20 },
        { name: 'file', type: 'text', max: 20 },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent', 'recurring', 'system'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'reminder', type: 'text', max: 4000 },
        day('reminded_at'),
        day('sent_at'),
        { name: 'recurring', type: 'text', max: 20 },
        { name: 'void_reason', type: 'text', max: 500 },
      ],
      indexes: ['CREATE INDEX idx_docs_kind ON documents (kind, status)', 'CREATE INDEX idx_docs_contact ON documents (contact)'],
    });

    save({
      name: 'doc_lines',
      fields: [
        { name: 'document', type: 'relation', required: true, collectionId: docs.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'description', type: 'text', max: 500 },
        { name: 'quantity', type: 'text', max: 24 },
        { name: 'unit_price', type: 'number' },
        { name: 'account', type: 'relation', collectionId: accounts.id, maxSelect: 1 },
        { name: 'tax_code', type: 'relation', collectionId: taxes.id, maxSelect: 1 },
        { name: 'subtotal', type: 'number' },
        { name: 'tax', type: 'number' },
        { name: 'total', type: 'number' },
        { name: 'sort', type: 'number' },
      ],
      indexes: ['CREATE INDEX idx_doc_lines_doc ON doc_lines (document)'],
    });

    save({
      name: 'allocations',
      fields: [
        { name: 'payment', type: 'text', max: 20 },
        { name: 'document', type: 'relation', required: true, collectionId: docs.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'credit_doc', type: 'text', max: 20 },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['payment', 'credit', 'writeoff'] },
        { name: 'amount', type: 'number' },
        { name: 'home_amount', type: 'number' },
        { name: 'fx_diff', type: 'number' },
        day('date'),
      ],
      indexes: ['CREATE INDEX idx_alloc_doc ON allocations (document)', 'CREATE INDEX idx_alloc_payment ON allocations (payment)'],
    });

    save({
      name: 'files',
      fields: [
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 26214400 },
        { name: 'name', type: 'text', max: 255 },
        { name: 'mime', type: 'text', max: 120 },
        { name: 'size', type: 'number' },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['receipt', 'invoice', 'statement', 'other'] },
        { name: 'status', type: 'select', maxSelect: 1, values: ['inbox', 'reading', 'linked', 'archived'] },
        { name: 'extracted', type: 'json', maxSize: 40000 },
        { name: 'linked_type', type: 'text', max: 20 },
        { name: 'linked_id', type: 'text', max: 20 },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'note', type: 'text', max: 1000 },
        { name: 'agent_state', type: 'select', maxSelect: 1, values: ['waiting', 'working', 'done', 'failed'] },
        { name: 'agent_at', type: 'text', max: 40 },
      ],
      indexes: ['CREATE INDEX idx_files_status ON files (status)'],
    });

    const imports = save({
      name: 'statement_imports',
      fields: [
        { name: 'account', type: 'relation', required: true, collectionId: accounts.id, maxSelect: 1 },
        { name: 'file_name', type: 'text', max: 255 },
        { name: 'file_hash', type: 'text', max: 80 },
        { name: 'format', type: 'select', maxSelect: 1, values: ['ofx', 'qif', 'csv', 'camt', 'mt940'] },
        day('period_from'),
        day('period_to'),
        { name: 'balances', type: 'json', maxSize: 2000 },
        { name: 'line_count', type: 'number' },
        { name: 'new_count', type: 'number' },
        { name: 'dup_count', type: 'number' },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['done', 'undone'] },
      ],
    });

    save({
      name: 'statement_lines',
      fields: [
        { name: 'account', type: 'relation', required: true, collectionId: accounts.id, maxSelect: 1 },
        { name: 'import', type: 'relation', collectionId: imports.id, cascadeDelete: true, maxSelect: 1 },
        day('date'),
        { name: 'amount', type: 'number' },
        { name: 'currency', type: 'text', max: 3 },
        { name: 'description', type: 'text', max: 500 },
        { name: 'payee', type: 'text', max: 160 },
        { name: 'bank_id', type: 'text', max: 120 },
        { name: 'fingerprint', type: 'text', max: 160 },
        { name: 'raw', type: 'text', max: 4000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['new', 'proposed', 'posted', 'matched', 'excluded'] },
        { name: 'txn', type: 'text', max: 20 },
        { name: 'suggestion', type: 'json', maxSize: 20000 },
        { name: 'note', type: 'text', max: 1000 },
        { name: 'agent_state', type: 'select', maxSelect: 1, values: ['waiting', 'working', 'done'] },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_lines_fp ON statement_lines (account, fingerprint)',
        'CREATE INDEX idx_lines_status ON statement_lines (status)',
        'CREATE INDEX idx_lines_date ON statement_lines (account, date)',
      ],
    });

    save({
      name: 'csv_profiles',
      fields: [
        { name: 'name', type: 'text', max: 80 },
        { name: 'account', type: 'relation', collectionId: accounts.id, maxSelect: 1 },
        { name: 'signature', type: 'text', max: 400 },
        { name: 'mapping', type: 'json', maxSize: 4000 },
      ],
    });

    save({
      name: 'reconciliations',
      fields: [
        { name: 'account', type: 'relation', required: true, collectionId: accounts.id, maxSelect: 1 },
        day('statement_date'),
        { name: 'statement_balance', type: 'number' },
        { name: 'opening_balance', type: 'number' },
        { name: 'status', type: 'select', maxSelect: 1, values: ['open', 'finished', 'undone'] },
        { name: 'finished_at', type: 'text', max: 40 },
        { name: 'cleared_count', type: 'number' },
        { name: 'adjustment', type: 'text', max: 20 },
        { name: 'note', type: 'text', max: 1000 },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
      ],
      indexes: ['CREATE INDEX idx_recon_account ON reconciliations (account, status)'],
    });

    save({
      name: 'rules',
      fields: [
        { name: 'name', type: 'text', max: 120 },
        { name: 'sort', type: 'number' },
        { name: 'status', type: 'select', maxSelect: 1, values: ['active', 'proposed', 'disabled'] },
        { name: 'match', type: 'select', maxSelect: 1, values: ['all', 'any'] },
        { name: 'conditions', type: 'json', maxSize: 8000 },
        { name: 'actions', type: 'json', maxSize: 8000 },
        { name: 'auto_post', type: 'bool' },
        { name: 'one_time', type: 'bool' },
        { name: 'hits', type: 'number' },
        day('last_hit'),
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'note', type: 'text', max: 1000 },
      ],
    });

    save({
      name: 'recurring',
      fields: [
        { name: 'name', type: 'text', max: 120 },
        { name: 'kind', type: 'select', maxSelect: 1, values: ['transaction', 'invoice', 'bill'] },
        { name: 'template', type: 'json', maxSize: 40000 },
        { name: 'frequency', type: 'select', maxSelect: 1, values: ['weekly', 'monthly', 'quarterly', 'yearly'] },
        { name: 'interval', type: 'number' },
        day('next_date'),
        day('end_date'),
        { name: 'auto', type: 'bool' },
        { name: 'active', type: 'bool' },
        day('last_run'),
        { name: 'count', type: 'number' },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['user', 'agent'] },
      ],
    });

    save({
      name: 'budgets',
      fields: [
        { name: 'account', type: 'relation', required: true, collectionId: accounts.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'year', type: 'number' },
        { name: 'months', type: 'json', maxSize: 2000 },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_budgets ON budgets (account, year)'],
    });

    save({
      name: 'periods',
      fields: [
        { name: 'period', type: 'text', required: true, max: 7 },
        { name: 'checklist', type: 'json', maxSize: 20000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['open', 'closed'] },
        { name: 'signed_off_at', type: 'text', max: 40 },
        { name: 'notes', type: 'text', max: 4000 },
        { name: 'agent_state', type: 'select', maxSelect: 1, values: ['waiting', 'working', 'done', 'failed'] },
        { name: 'agent_note', type: 'text', max: 8000 },
        { name: 'agent_at', type: 'text', max: 40 },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_periods ON periods (period)'],
    });

    save({
      name: 'fx_rates',
      fields: [
        day('date'),
        { name: 'currency', type: 'text', required: true, max: 3 },
        { name: 'rate', type: 'text', required: true, max: 24 },
        { name: 'source', type: 'select', maxSelect: 1, values: ['manual', 'ecb', 'document'] },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_fx ON fx_rates (date, currency)'],
    });

    save({
      name: 'asks',
      fields: [
        { name: 'kind', type: 'select', maxSelect: 1, values: ['question', 'explain', 'reminder', 'review', 'categorize'] },
        { name: 'status', type: 'select', maxSelect: 1, values: ['waiting', 'working', 'done', 'failed'] },
        { name: 'question', type: 'text', max: 4000 },
        { name: 'context', type: 'json', maxSize: 40000 },
        { name: 'answer', type: 'text', max: 20000 },
        { name: 'links', type: 'json', maxSize: 20000 },
        { name: 'error', type: 'text', max: 1000 },
        { name: 'requested_at', type: 'text', max: 40 },
        { name: 'run', type: 'text', max: 40 },
      ],
      indexes: ['CREATE INDEX idx_asks_status ON asks (status)'],
    });

    save({
      name: 'activity',
      fields: [
        { name: 'actor', type: 'select', required: true, maxSelect: 1, values: ['user', 'agent', 'rule', 'import', 'recurring', 'system'] },
        { name: 'run', type: 'text', max: 40 },
        { name: 'op', type: 'text', max: 60 },
        { name: 'summary', type: 'text', max: 500 },
        { name: 'target_type', type: 'text', max: 30 },
        { name: 'target_id', type: 'text', max: 40 },
        { name: 'changes', type: 'json', maxSize: 40000 },
        { name: 'undo', type: 'json', maxSize: 800000 },
        { name: 'redo', type: 'json', maxSize: 800000 },
        { name: 'undone', type: 'bool' },
      ],
      indexes: ['CREATE INDEX idx_activity_run ON activity (run)', 'CREATE INDEX idx_activity_target ON activity (target_id)'],
    });

    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('business_name', '');
    s.set('entity', 'both');
    s.set('home_currency', 'USD');
    s.set('fiscal_year_start', 1);
    s.set('region', 'none');
    s.set('rounding', 'line');
    s.set('invoice_prefix', 'INV-');
    s.set('invoice_next', 1001);
    s.set('credit_prefix', 'CN-');
    s.set('credit_next', 1);
    s.set('payment_terms', 14);
    s.set('policy', { agent_auto_post: false, ceiling: '', auto_methods: [], house_rules: '' });
    s.set('agent_categorize', true);
    s.set('setup_done', false);
    app.save(s);
  },
  (app) => {
    for (const name of [
      'activity',
      'asks',
      'fx_rates',
      'periods',
      'budgets',
      'recurring',
      'rules',
      'reconciliations',
      'csv_profiles',
      'statement_lines',
      'statement_imports',
      'files',
      'allocations',
      'doc_lines',
      'documents',
      'postings',
      'transactions',
      'contacts',
      'tax_codes',
      'accounts',
      'settings',
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
