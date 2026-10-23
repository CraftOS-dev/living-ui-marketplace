/// <reference path="../pb_data/types.d.ts" />
/**
 * ERP schema.
 *
 * Every collection is closed to the raw API (all rules null: superusers
 * only). People and the AI agent reach the data only through the app's
 * operations (pb_hooks/routes.pb.js -> lib_ops.js), which check the
 * caller's rights, keep ledgers and caches in step and write the audit
 * trail. Screens learn about changes from the custom realtime topic "erp",
 * which carries collection names only (lib_bus.js).
 *
 * Money: integers of the currency's minor unit. Unit prices and costs:
 * integers of ten-thousandths (e4). Tax rates: basis points. Exchange
 * rates: integers of 1e-8 (fx_e8). Quantities: numbers with at most 3
 * decimals. Days: 'YYYY-MM-DD' text. Months: 'YYYY-MM' text.
 *
 * The blueprint's starter `items` collection is removed first (its
 * migration stays: it is applied history) and a new `items` is created.
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    // PocketBase's default `users` collection is open for self-registration;
    // members sign in through the app's own `members` collection instead.
    const users = app.findCollectionByNameOrId('users');
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    users.passwordAuth.enabled = false;
    app.save(users);

    const closed ={ listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const MONTH = '^(\\d{4}-\\d{2})?$';
    const ACTORS = ['person', 'agent', 'system'];
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const created = [{ name: 'created', type: 'autodate', onCreate: true }];

    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const num = (name, extra) => Object.assign({ name: name, type: 'number' }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: DAY });
    const month = (name) => ({ name: name, type: 'text', max: 7, pattern: MONTH });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    // Protected files are served only through operations that check rights;
    // pictures (item and employee photos, the logo) use PocketBase's file URLs
    // with thumbnails (the name carries a random part).
    const file = (name, max, mimes, thumbs, open) => ({
      name: name,
      type: 'file',
      maxSelect: 1,
      maxSize: max,
      mimeTypes: mimes,
      thumbs: thumbs || [],
      protected: open !== true,
    });
    const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const DOCS = IMAGES.concat([
      'image/heic',
      'image/heif',
      'application/pdf',
      'text/csv',
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    const make = (name, fields, indexes, extra) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed, extra || {}));
      app.save(c);
      return c;
    };
    const addField = (collection, field, indexes) => {
      const c = app.findCollectionByNameOrId(collection);
      c.fields.add(new RelationField(field));
      for (const ix of indexes || []) c.addIndex(ix.name, ix.unique === true, ix.columns, ix.where || '');
      app.save(c);
    };

    /* ------------------------------------------------------------ system */

    make('settings', [
      txt('company_name', 120),
      txt('legal_name', 160),
      txt('tax_id', 60),
      txt('registration_no', 60),
      txt('address', 600),
      txt('email', 160),
      txt('phone', 40),
      txt('website', 160),
      file('logo', 5000000, IMAGES, ['200x200'], true),
      txt('country', 2),
      txt('base_currency', 3, { pattern: '^([A-Z]{3})?$' }),
      int('fiscal_start_month', { min: 1, max: 12 }),
      sel('business_type', ['services', 'trading', 'manufacturing', 'other']),
      json('modules', 2000),
      bool('setup_done'),
      bool('prices_include_tax'),
      bool('allow_negative_stock'),
      day('soft_lock_date'),
      day('hard_lock_date'),
      json('numbering', 4000),
      json('defaults', 8000),
      json('agent', 4000),
      json('jobs', 20000),
      txt('invoice_footer', 2000),
      txt('quote_terms', 2000),
      int('quote_validity_days', { min: 0, max: 365 }),
      json('working_days', 200),
    ].concat(stamps));

    make('counters', [req('key', 40), int('num', { min: 0 })].concat(stamps), ['CREATE UNIQUE INDEX idx_counters_key ON counters (key)']);

    make(
      'roles',
      [
        req('name', 60),
        txt('key', 30),
        json('levels', 2000),
        bool('admin'),
        int('approval_limit', { min: 0 }),
        txt('description', 300),
        bool('system'),
        int('sort'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_roles_name ON roles (name COLLATE NOCASE)', "CREATE UNIQUE INDEX idx_roles_key ON roles (key) WHERE key != ''"],
    );

    const members = new Collection({
      type: 'auth',
      name: 'members',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: null,
      manageRule: null,
      passwordAuth: { enabled: false, identityFields: ['email'] },
      authToken: { duration: 2592000 },
      fields: [
        req('name', 120),
        rel('role', 'roles'),
        sel('status', ['invited', 'active', 'disabled'], true),
        txt('title', 120),
        txt('invite_hash', 100),
        txt('invite_expires', 40),
        int('failed_logins', { min: 0 }),
        txt('locked_until', 40),
        txt('last_seen', 40),
        json('prefs', 4000),
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_members_status ON members (status)'],
    });
    app.save(members);

    make(
      'audit',
      [
        sel('actor', ACTORS, true),
        rel('member', 'members'),
        txt('kind', 40),
        txt('entity', 40),
        txt('ref', 30),
        txt('label', 80),
        txt('summary', 600),
        json('data', 50000),
      ].concat(created),
      ['CREATE INDEX idx_audit_ref ON audit (entity, ref)', 'CREATE INDEX idx_audit_created ON audit (created)', 'CREATE INDEX idx_audit_member ON audit (member)'],
    );

    make(
      'notes',
      [txt('entity', 40), txt('ref', 30), rel('member', 'members'), sel('actor', ACTORS, true), req('body', 4000)].concat(created),
      ['CREATE INDEX idx_notes_ref ON notes (entity, ref, created)'],
    );

    make(
      'attachments',
      [
        txt('entity', 40),
        txt('ref', 30),
        file('file', 25000000, DOCS, ['100x100']),
        txt('name', 200),
        int('size', { min: 0 }),
        txt('mime', 120),
        rel('member', 'members'),
        sel('actor', ACTORS, true),
      ].concat(created),
      ['CREATE INDEX idx_attachments_ref ON attachments (entity, ref)'],
    );

    make(
      'field_marks',
      [txt('entity', 40), txt('ref', 30), txt('field', 60), sel('confidence', ['high', 'check']), txt('reason', 500)].concat(created),
      ['CREATE INDEX idx_field_marks_ref ON field_marks (entity, ref)'],
    );

    /* ----------------------------------------------------- organization */

    make(
      'departments',
      [req('name', 80), txt('code', 20), bool('archived'), int('sort')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_departments_name ON departments (name COLLATE NOCASE)'],
    );
    addField('departments', { name: 'parent', type: 'relation', maxSelect: 1, collectionId: id('departments'), cascadeDelete: false });

    /* ------------------------------------------------------- accounting */

    make(
      'accounts',
      [
        req('code', 20),
        req('name', 120),
        sel('type', ['asset', 'liability', 'equity', 'income', 'expense'], true),
        sel('subtype', [
          'cash',
          'bank',
          'receivable',
          'inventory',
          'current_asset',
          'fixed_asset',
          'accumulated_depreciation',
          'tax_receivable',
          'other_asset',
          'payable',
          'current_liability',
          'tax_payable',
          'payroll_liability',
          'long_term_liability',
          'equity',
          'retained_earnings',
          'opening_balance',
          'revenue',
          'other_income',
          'cogs',
          'expense',
          'payroll_expense',
          'depreciation',
          'other_expense',
        ], true),
        txt('system_key', 40),
        bool('control'),
        txt('description', 500),
        bool('archived'),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_accounts_code ON accounts (code COLLATE NOCASE)',
        "CREATE UNIQUE INDEX idx_accounts_key ON accounts (system_key) WHERE system_key != ''",
        'CREATE INDEX idx_accounts_type ON accounts (type, subtype)',
      ],
    );
    addField('accounts', { name: 'parent', type: 'relation', maxSelect: 1, collectionId: id('accounts'), cascadeDelete: false });

    make('ledger_months', [rel('account', 'accounts'), month('month'), int('debit', { min: 0 }), int('credit', { min: 0 })], [
      'CREATE UNIQUE INDEX idx_ledger_months ON ledger_months (account, month)',
      'CREATE INDEX idx_ledger_months_month ON ledger_months (month)',
    ]);

    make('payment_terms', [req('name', 60), int('days', { min: 0, max: 3650 }), bool('end_of_month'), bool('archived'), int('sort')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_terms_name ON payment_terms (name COLLATE NOCASE)',
    ]);

    make('currencies', [req('code', 3), txt('name', 60), int('rate_e8', { min: 0 }), day('rate_date'), bool('archived')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_currencies_code ON currencies (code)',
    ]);

    make(
      'taxes',
      [
        req('name', 60),
        req('code', 20),
        int('rate_bp', { min: 0, max: 100000 }),
        sel('scope', ['sales', 'purchase', 'both'], true),
        bool('recoverable'),
        rel('sales_account', 'accounts'),
        rel('purchase_account', 'accounts'),
        txt('description', 300),
        bool('archived'),
        int('sort'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_taxes_code ON taxes (code COLLATE NOCASE)'],
    );

    /* ----------------------------------------------------------- parties */

    make(
      'parties',
      [
        txt('code', 20),
        req('name', 160),
        bool('is_customer'),
        bool('is_supplier'),
        txt('email', 160),
        txt('phone', 40),
        txt('website', 160),
        txt('tax_id', 60),
        txt('billing_address', 600),
        txt('shipping_address', 600),
        txt('contact_name', 120),
        rel('terms', 'payment_terms'),
        txt('currency', 3, { pattern: '^([A-Z]{3})?$' }),
        int('credit_limit', { min: 0 }),
        rel('sale_tax', 'taxes'),
        rel('purchase_tax', 'taxes'),
        txt('notes', 2000),
        bool('archived'),
      ].concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_parties_code ON parties (code) WHERE code != ''",
        'CREATE INDEX idx_parties_name ON parties (name COLLATE NOCASE)',
        'CREATE INDEX idx_parties_roles ON parties (is_customer, is_supplier, archived)',
      ],
    );

    make('contacts', [rel('party', 'parties', { cascadeDelete: true }), req('name', 120), txt('email', 160), txt('phone', 40), txt('title', 80), bool('primary')].concat(stamps), [
      'CREATE INDEX idx_contacts_party ON contacts (party)',
    ]);

    /* ------------------------------------------------------------ people */

    make(
      'employees',
      [
        txt('number', 20),
        req('name', 120),
        txt('email', 160),
        txt('phone', 40),
        txt('job_title', 120),
        rel('department', 'departments'),
        rel('member', 'members'),
        day('start_date'),
        day('end_date'),
        sel('status', ['active', 'on_leave', 'left'], true),
        sel('employment', ['full_time', 'part_time', 'contractor', 'intern', 'temporary']),
        int('pay_basic', { min: 0 }),
        sel('pay_frequency', ['monthly', 'semi_monthly', 'biweekly', 'weekly']),
        int('hourly_cost', { min: 0 }),
        txt('bank_details', 300),
        txt('national_id', 60),
        txt('tax_number', 60),
        txt('address', 600),
        day('birthday'),
        txt('emergency_contact', 300),
        txt('notes', 2000),
        file('photo', 5000000, IMAGES, ['96x96', '400x400'], true),
      ].concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_employees_number ON employees (number) WHERE number != ''",
        'CREATE INDEX idx_employees_name ON employees (name COLLATE NOCASE)',
        'CREATE INDEX idx_employees_department ON employees (department)',
        "CREATE UNIQUE INDEX idx_employees_member ON employees (member) WHERE member != ''",
        'CREATE INDEX idx_employees_status ON employees (status)',
      ],
    );
    addField('employees', { name: 'manager', type: 'relation', maxSelect: 1, collectionId: id('employees'), cascadeDelete: false }, [
      { name: 'idx_employees_manager', columns: 'manager' },
    ]);
    addField('members', { name: 'employee', type: 'relation', maxSelect: 1, collectionId: id('employees'), cascadeDelete: false });
    addField('departments', { name: 'manager', type: 'relation', maxSelect: 1, collectionId: id('employees'), cascadeDelete: false });

    /* ---------------------------------------------------------- projects */

    make(
      'projects',
      [
        req('code', 20),
        req('name', 160),
        rel('customer', 'parties'),
        rel('manager', 'employees'),
        sel('status', ['active', 'on_hold', 'done', 'cancelled'], true),
        day('start'),
        day('end'),
        int('budget', { min: 0 }),
        sel('billing', ['fixed', 'time_materials', 'non_billable'], true),
        int('rate', { min: 0 }),
        txt('description', 2000),
        int('color', { min: 0, max: 20 }),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_projects_code ON projects (code COLLATE NOCASE)', 'CREATE INDEX idx_projects_status ON projects (status)', 'CREATE INDEX idx_projects_customer ON projects (customer)'],
    );

    make(
      'project_tasks',
      [
        rel('project', 'projects', { cascadeDelete: true }),
        req('title', 200),
        sel('status', ['todo', 'doing', 'done'], true),
        rel('assignee', 'employees'),
        day('due'),
        num('estimate_hours', { min: 0 }),
        int('sort'),
        txt('notes', 2000),
      ].concat(stamps),
      ['CREATE INDEX idx_tasks_project ON project_tasks (project, status, sort)'],
    );

    /* ---------------------------------------------------------- catalog */

    make('item_categories', [req('name', 60), txt('icon', 40), rel('income_account', 'accounts'), rel('expense_account', 'accounts'), int('sort')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_item_categories_name ON item_categories (name COLLATE NOCASE)',
    ]);

    make('warehouses', [req('code', 20), req('name', 80), txt('address', 600), bool('archived'), int('sort')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_warehouses_code ON warehouses (code COLLATE NOCASE)',
      'CREATE UNIQUE INDEX idx_warehouses_name ON warehouses (name COLLATE NOCASE)',
    ]);

    make(
      'items',
      [
        req('sku', 40),
        req('name', 200),
        sel('kind', ['stock', 'service', 'non_stock'], true),
        rel('category', 'item_categories'),
        txt('unit', 20),
        bool('fractional'),
        txt('barcode', 60),
        txt('description', 2000),
        int('sale_price', { min: 0 }),
        int('purchase_price', { min: 0 }),
        rel('sale_tax', 'taxes'),
        rel('purchase_tax', 'taxes'),
        rel('income_account', 'accounts'),
        rel('expense_account', 'accounts'),
        num('min_qty', { min: 0 }),
        num('max_qty', { min: 0 }),
        int('lead_time_days', { min: 0, max: 3650 }),
        rel('supplier', 'parties'),
        file('photo', 10000000, IMAGES, ['96x96', '480x480'], true),
        bool('archived'),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_items_sku ON items (sku COLLATE NOCASE)',
        "CREATE UNIQUE INDEX idx_items_barcode ON items (barcode) WHERE barcode != ''",
        'CREATE INDEX idx_items_name ON items (name COLLATE NOCASE)',
        'CREATE INDEX idx_items_kind ON items (kind, archived)',
        'CREATE INDEX idx_items_category ON items (category)',
        'CREATE INDEX idx_items_supplier ON items (supplier)',
      ],
    );

    make('valuation', [rel('item', 'items'), num('qty'), int('value'), int('last_cost', { min: 0 })].concat(stamps), [
      'CREATE UNIQUE INDEX idx_valuation_item ON valuation (item)',
    ]);

    make('stock', [rel('item', 'items'), rel('warehouse', 'warehouses'), num('qty')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_stock_item_wh ON stock (item, warehouse)',
      'CREATE INDEX idx_stock_wh ON stock (warehouse)',
    ]);

    /* ---------------------------------------------------------- ledger */

    make(
      'journals',
      [
        txt('number', 30),
        day('date'),
        month('month'),
        sel('kind', [
          'manual',
          'invoice',
          'credit_note',
          'bill',
          'supplier_credit',
          'delivery',
          'goods_receipt',
          'payment_in',
          'payment_out',
          'allocation_fx',
          'stock_change',
          'build',
          'opening',
          'claim',
          'claim_payment',
          'payroll',
          'payroll_payment',
          'depreciation',
          'bank_entry',
          'transfer',
          'reversal',
        ], true),
        txt('memo', 500),
        txt('source_entity', 40),
        txt('source_id', 30),
        txt('source_label', 80),
        sel('state', ['posted', 'reversed'], true),
        int('total', { min: 0 }),
        sel('actor', ACTORS, true),
        rel('member', 'members'),
        rel('approved_by', 'members'),
      ].concat(created),
      [
        "CREATE UNIQUE INDEX idx_journals_number ON journals (number) WHERE number != ''",
        'CREATE INDEX idx_journals_date ON journals (date)',
        'CREATE INDEX idx_journals_source ON journals (source_entity, source_id)',
        'CREATE INDEX idx_journals_kind ON journals (kind, date)',
      ],
    );
    addField('journals', { name: 'reverses', type: 'relation', maxSelect: 1, collectionId: id('journals'), cascadeDelete: false });
    addField('journals', { name: 'reversed_by', type: 'relation', maxSelect: 1, collectionId: id('journals'), cascadeDelete: false });

    make(
      'journal_lines',
      [
        rel('journal', 'journals'),
        rel('account', 'accounts'),
        day('date'),
        month('month'),
        int('debit', { min: 0 }),
        int('credit', { min: 0 }),
        rel('party', 'parties'),
        rel('employee', 'employees'),
        rel('department', 'departments'),
        rel('project', 'projects'),
        txt('memo', 300),
        txt('currency', 3),
        int('amount_cur'),
        int('sort'),
      ],
      [
        'CREATE INDEX idx_jl_account_date ON journal_lines (account, date)',
        'CREATE INDEX idx_jl_journal ON journal_lines (journal)',
        'CREATE INDEX idx_jl_party ON journal_lines (party, account)',
        'CREATE INDEX idx_jl_project ON journal_lines (project)',
        'CREATE INDEX idx_jl_department ON journal_lines (department)',
        'CREATE INDEX idx_jl_employee ON journal_lines (employee)',
        'CREATE INDEX idx_jl_month ON journal_lines (month, account)',
      ],
    );

    /* -------------------------------------------------------- documents */

    make(
      'documents',
      [
        sel('type', ['quote', 'sales_order', 'delivery', 'invoice', 'credit_note', 'purchase_order', 'goods_receipt', 'bill', 'supplier_credit'], true),
        txt('number', 40),
        sel('state', ['draft', 'open', 'posted', 'void', 'closed', 'cancelled', 'accepted', 'declined'], true),
        rel('party', 'parties'),
        txt('attention', 120),
        day('date'),
        day('due_date'),
        day('valid_until'),
        day('expected_date'),
        txt('currency', 3),
        int('fx_e8', { min: 0 }),
        bool('prices_include_tax'),
        txt('reference', 120),
        rel('terms', 'payment_terms'),
        rel('warehouse', 'warehouses'),
        rel('project', 'projects'),
        rel('department', 'departments'),
        bool('moves_stock'),
        int('subtotal'),
        int('discount'),
        int('tax'),
        int('total'),
        int('total_base'),
        int('paid'),
        int('balance'),
        sel('fulfil_status', ['none', 'partial', 'full']),
        sel('bill_status', ['none', 'partial', 'full']),
        txt('notes', 4000),
        txt('internal_note', 4000),
        txt('agent_note', 2000),
        txt('billing_address', 600),
        txt('shipping_address', 600),
        rel('prepared_by', 'members'),
        sel('prepared_actor', ACTORS),
        rel('posted_by', 'members'),
        txt('posted_at', 40),
        rel('voided_by', 'members'),
        txt('voided_at', 40),
        txt('void_reason', 500),
        rel('journal', 'journals'),
        rel('void_journal', 'journals'),
        txt('sent_at', 40),
        int('lines_count', { min: 0 }),
      ].concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_documents_number ON documents (type, number) WHERE number != ''",
        'CREATE INDEX idx_documents_list ON documents (type, state, date)',
        'CREATE INDEX idx_documents_party ON documents (party, type)',
        'CREATE INDEX idx_documents_due ON documents (type, due_date)',
        'CREATE INDEX idx_documents_project ON documents (project)',
      ],
    );
    addField('documents', { name: 'source', type: 'relation', maxSelect: 1, collectionId: id('documents'), cascadeDelete: false }, [
      { name: 'idx_documents_source', columns: 'source' },
    ]);

    make(
      'document_lines',
      [
        rel('doc', 'documents', { cascadeDelete: true }),
        int('sort'),
        rel('item', 'items'),
        txt('description', 1000),
        num('qty'),
        txt('unit', 20),
        int('unit_price', { min: 0 }),
        int('discount_bp', { min: 0, max: 10000 }),
        rel('tax', 'taxes'),
        int('tax_rate_bp', { min: 0 }),
        rel('account', 'accounts'),
        int('net'),
        int('tax_amount'),
        int('total'),
        int('net_base'),
        int('tax_base'),
        num('qty_fulfilled'),
        num('qty_invoiced'),
        int('recv_value'),
        int('cleared_value'),
        int('unit_cost', { min: 0 }),
        int('cost_value'),
        rel('project', 'projects'),
        rel('department', 'departments'),
      ].concat(stamps),
      ['CREATE INDEX idx_dl_doc ON document_lines (doc, sort)', 'CREATE INDEX idx_dl_item ON document_lines (item)'],
    );
    addField('document_lines', { name: 'source_line', type: 'relation', maxSelect: 1, collectionId: id('document_lines'), cascadeDelete: false }, [
      { name: 'idx_dl_source', columns: 'source_line' },
    ]);
    addField('journal_lines', { name: 'doc', type: 'relation', maxSelect: 1, collectionId: id('documents'), cascadeDelete: false }, [
      { name: 'idx_jl_doc', columns: 'doc' },
    ]);

    /* ------------------------------------------------------------ stock */

    make(
      'stock_changes',
      [
        txt('number', 30),
        day('date'),
        sel('kind', ['adjust', 'transfer', 'count'], true),
        rel('warehouse', 'warehouses'),
        rel('to_warehouse', 'warehouses'),
        sel('reason', ['count', 'damage', 'loss', 'found', 'expiry', 'sample', 'correction', 'opening', 'other']),
        rel('account', 'accounts'),
        txt('note', 1000),
        sel('state', ['posted', 'void'], true),
        rel('journal', 'journals'),
        rel('void_journal', 'journals'),
        int('value'),
        int('lines_count', { min: 0 }),
        sel('actor', ACTORS, true),
        rel('member', 'members'),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_stock_changes_number ON stock_changes (number) WHERE number != ''", 'CREATE INDEX idx_stock_changes_date ON stock_changes (date)'],
    );

    make(
      'stock_moves',
      [
        rel('item', 'items'),
        rel('warehouse', 'warehouses'),
        day('date'),
        num('qty'),
        int('value'),
        int('unit_cost', { min: 0 }),
        sel('kind', ['receipt', 'delivery', 'adjust_in', 'adjust_out', 'count', 'transfer_in', 'transfer_out', 'build_in', 'build_out', 'opening', 'return_in', 'return_out'], true),
        txt('source_entity', 40),
        txt('source_id', 30),
        txt('source_label', 80),
        txt('source_line', 30),
        txt('batch', 30),
        num('balance'),
        sel('actor', ACTORS, true),
        rel('member', 'members'),
        txt('reverses', 30),
        rel('journal', 'journals'),
        txt('note', 300),
      ].concat(created),
      [
        'CREATE INDEX idx_moves_item ON stock_moves (item, date)',
        'CREATE INDEX idx_moves_wh ON stock_moves (warehouse, date)',
        'CREATE INDEX idx_moves_source ON stock_moves (source_entity, source_id)',
        'CREATE INDEX idx_moves_batch ON stock_moves (batch)',
        'CREATE INDEX idx_moves_date ON stock_moves (date)',
      ],
    );

    /* ------------------------------------------------------------ money */

    make(
      'banks',
      [
        req('name', 80),
        rel('account', 'accounts'),
        sel('kind', ['bank', 'cash', 'card'], true),
        txt('currency', 3),
        txt('bank_name', 80),
        txt('account_number', 40),
        int('color', { min: 0, max: 20 }),
        bool('archived'),
        int('sort'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_banks_account ON banks (account)', 'CREATE UNIQUE INDEX idx_banks_name ON banks (name COLLATE NOCASE)'],
    );

    make(
      'payments',
      [
        sel('direction', ['in', 'out'], true),
        txt('number', 30),
        sel('state', ['draft', 'posted', 'void'], true),
        rel('party', 'parties'),
        rel('bank', 'banks'),
        day('date'),
        txt('currency', 3),
        int('fx_e8', { min: 0 }),
        int('amount', { min: 0 }),
        int('amount_base', { min: 0 }),
        sel('method', ['bank_transfer', 'cash', 'card', 'cheque', 'online', 'other']),
        txt('reference', 120),
        txt('memo', 500),
        int('allocated', { min: 0 }),
        int('unallocated'),
        json('planned', 20000),
        rel('journal', 'journals'),
        rel('void_journal', 'journals'),
        rel('prepared_by', 'members'),
        sel('prepared_actor', ACTORS),
        rel('posted_by', 'members'),
        txt('posted_at', 40),
        rel('voided_by', 'members'),
        txt('voided_at', 40),
        txt('void_reason', 500),
        txt('agent_note', 2000),
      ].concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_payments_number ON payments (direction, number) WHERE number != ''",
        'CREATE INDEX idx_payments_list ON payments (direction, state, date)',
        'CREATE INDEX idx_payments_party ON payments (party)',
        'CREATE INDEX idx_payments_bank ON payments (bank, date)',
      ],
    );

    make(
      'allocations',
      [
        rel('payment', 'payments'),
        rel('credit', 'documents'),
        rel('document', 'documents'),
        rel('party', 'parties'),
        int('amount', { min: 0 }),
        txt('currency', 3),
        int('fx_diff'),
        rel('journal', 'journals'),
        day('date'),
        sel('state', ['active', 'void'], true),
        sel('actor', ACTORS, true),
        rel('member', 'members'),
      ].concat(created),
      ['CREATE INDEX idx_alloc_payment ON allocations (payment)', 'CREATE INDEX idx_alloc_credit ON allocations (credit)', 'CREATE INDEX idx_alloc_document ON allocations (document)'],
    );

    make(
      'imports',
      [
        sel('kind', ['bank', 'parties', 'items', 'accounts', 'opening_accounts', 'opening_documents', 'opening_stock', 'employees'], true),
        file('file', 20000000, ['text/csv', 'text/plain', 'application/vnd.ms-excel'], []),
        txt('filename', 200),
        sel('status', ['previewed', 'imported', 'undone'], true),
        int('rows', { min: 0 }),
        int('added', { min: 0 }),
        int('skipped', { min: 0 }),
        json('mapping', 20000),
        json('result', 2000000),
        txt('target', 30),
        sel('actor', ACTORS, true),
        rel('member', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_imports_kind ON imports (kind, created)'],
    );

    make(
      'bank_lines',
      [
        rel('bank', 'banks'),
        day('date'),
        txt('description', 500),
        txt('reference', 200),
        int('amount'),
        int('balance'),
        rel('import', 'imports'),
        sel('status', ['unmatched', 'matched', 'ignored'], true),
        rel('payment', 'payments'),
        rel('journal', 'journals'),
        txt('dedupe', 200),
        json('suggestion', 20000),
        rel('matched_by', 'members'),
        sel('matched_actor', ACTORS),
        txt('matched_at', 40),
      ].concat(created),
      ['CREATE INDEX idx_bank_lines_list ON bank_lines (bank, status, date)', "CREATE UNIQUE INDEX idx_bank_lines_dedupe ON bank_lines (bank, dedupe) WHERE dedupe != ''"],
    );

    /* ------------------------------------------------------------ agent */

    make(
      'inbox',
      [
        file('file', 25000000, DOCS, ['200x200']),
        txt('filename', 200),
        sel('kind', ['bill', 'receipt', 'statement', 'other'], true),
        sel('status', ['waiting', 'reading', 'done', 'failed'], true),
        txt('summary', 1000),
        txt('error', 500),
        txt('result_entity', 40),
        txt('result_id', 30),
        txt('result_label', 80),
        txt('note', 500),
        rel('added_by', 'members'),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE INDEX idx_inbox_status ON inbox (status, created)'],
    );

    make(
      'proposals',
      [
        req('op', 64),
        json('params', 200000),
        sel('kind', ['post', 'void', 'payment', 'journal', 'stock', 'payroll', 'claim', 'other'], true),
        txt('title', 200),
        txt('summary', 1000),
        json('preview', 200000),
        txt('reason', 2000),
        json('sources', 20000),
        sel('status', ['waiting', 'approved', 'rejected', 'failed'], true),
        txt('target_entity', 40),
        txt('target_id', 30),
        txt('target_label', 80),
        int('amount'),
        rel('decided_by', 'members'),
        txt('decided_at', 40),
        txt('decision_note', 500),
        json('result', 50000),
        txt('error', 1000),
      ].concat(stamps),
      ['CREATE INDEX idx_proposals_status ON proposals (status, created)', 'CREATE INDEX idx_proposals_target ON proposals (target_entity, target_id)'],
    );

    make(
      'asks',
      [req('question', 2000), rel('member', 'members'), sel('status', ['waiting', 'working', 'answered', 'failed'], true), txt('answer', 20000), txt('answered_at', 40)].concat(stamps),
      ['CREATE INDEX idx_asks_member ON asks (member, created)', 'CREATE INDEX idx_asks_status ON asks (status)'],
    );

    /* ------------------------------------------------------ leave, time */

    make(
      'leave_types',
      [req('name', 60), num('days_per_year', { min: 0, max: 366 }), bool('paid'), bool('needs_approval'), num('carry_over_max', { min: 0 }), txt('icon', 40), bool('archived'), int('sort')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_leave_types_name ON leave_types (name COLLATE NOCASE)'],
    );

    make('holidays', [day('date'), req('name', 120)].concat(stamps), ['CREATE UNIQUE INDEX idx_holidays_date ON holidays (date)']);

    make(
      'leave_requests',
      [
        rel('employee', 'employees'),
        rel('type', 'leave_types'),
        day('from'),
        day('to'),
        bool('half_day'),
        num('days', { min: 0 }),
        txt('reason', 1000),
        sel('status', ['submitted', 'approved', 'rejected', 'cancelled'], true),
        rel('decided_by', 'members'),
        txt('decided_at', 40),
        txt('decision_note', 500),
        rel('member', 'members'),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE INDEX idx_leave_emp ON leave_requests (employee, from)', 'CREATE INDEX idx_leave_status ON leave_requests (status, from)'],
    );

    make('leave_adjustments', [rel('employee', 'employees'), rel('type', 'leave_types'), int('year'), num('days'), txt('reason', 300), rel('member', 'members')].concat(created), [
      'CREATE INDEX idx_leave_adj ON leave_adjustments (employee, type, year)',
    ]);

    make(
      'expense_claims',
      [
        txt('number', 30),
        rel('employee', 'employees'),
        req('title', 160),
        day('date'),
        sel('status', ['draft', 'submitted', 'approved', 'rejected', 'posted', 'paid'], true),
        int('total', { min: 0 }),
        int('tax', { min: 0 }),
        rel('project', 'projects'),
        rel('decided_by', 'members'),
        txt('decided_at', 40),
        txt('decision_note', 500),
        rel('journal', 'journals'),
        rel('pay_journal', 'journals'),
        rel('bank', 'banks'),
        day('paid_on'),
        rel('member', 'members'),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_claims_number ON expense_claims (number) WHERE number != ''", 'CREATE INDEX idx_claims_emp ON expense_claims (employee, date)', 'CREATE INDEX idx_claims_status ON expense_claims (status)'],
    );

    make(
      'claim_lines',
      [
        rel('claim', 'expense_claims', { cascadeDelete: true }),
        day('date'),
        rel('account', 'accounts'),
        txt('description', 300),
        int('amount', { min: 0 }),
        rel('tax', 'taxes'),
        int('tax_amount', { min: 0 }),
        file('receipt', 15000000, DOCS, ['100x100']),
        rel('project', 'projects'),
        int('sort'),
      ].concat(stamps),
      ['CREATE INDEX idx_claim_lines ON claim_lines (claim, sort)'],
    );

    make(
      'pay_components',
      [
        req('name', 80),
        sel('kind', ['earning', 'deduction', 'employer'], true),
        sel('calc', ['fixed', 'percent'], true),
        int('amount', { min: 0 }),
        int('percent_bp', { min: 0, max: 100000 }),
        rel('account', 'accounts'),
        rel('liability_account', 'accounts'),
        sel('applies', ['all', 'selected'], true),
        bool('active'),
        int('sort'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_pay_components_name ON pay_components (name COLLATE NOCASE)'],
    );

    make('employee_components', [rel('employee', 'employees', { cascadeDelete: true }), rel('component', 'pay_components', { cascadeDelete: true }), int('amount'), int('percent_bp'), bool('override')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_emp_comp ON employee_components (employee, component)',
    ]);

    make(
      'payroll_runs',
      [
        txt('number', 30),
        month('month'),
        day('pay_date'),
        sel('status', ['draft', 'approved', 'posted', 'paid'], true),
        int('gross', { min: 0 }),
        int('deductions', { min: 0 }),
        int('employer', { min: 0 }),
        int('net'),
        int('count', { min: 0 }),
        rel('journal', 'journals'),
        rel('pay_journal', 'journals'),
        rel('bank', 'banks'),
        rel('approved_by', 'members'),
        rel('posted_by', 'members'),
        day('paid_on'),
        txt('note', 1000),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_payroll_number ON payroll_runs (number) WHERE number != ''", 'CREATE INDEX idx_payroll_month ON payroll_runs (month)'],
    );

    make(
      'payslips',
      [
        rel('run', 'payroll_runs', { cascadeDelete: true }),
        rel('employee', 'employees'),
        int('basic', { min: 0 }),
        int('gross', { min: 0 }),
        int('deductions', { min: 0 }),
        int('employer', { min: 0 }),
        int('net'),
        json('lines', 20000),
        txt('note', 500),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_payslips ON payslips (run, employee)', 'CREATE INDEX idx_payslips_emp ON payslips (employee)'],
    );

    make(
      'timesheets',
      [
        rel('employee', 'employees'),
        rel('project', 'projects'),
        rel('task', 'project_tasks'),
        day('date'),
        num('hours', { min: 0, max: 24 }),
        txt('description', 500),
        bool('billable'),
        sel('status', ['draft', 'submitted', 'approved', 'rejected', 'invoiced'], true),
        int('rate', { min: 0 }),
        int('cost', { min: 0 }),
        rel('invoice', 'documents'),
        rel('approved_by', 'members'),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE INDEX idx_ts_emp ON timesheets (employee, date)', 'CREATE INDEX idx_ts_project ON timesheets (project, status)', 'CREATE INDEX idx_ts_status ON timesheets (status, date)'],
    );

    /* ---------------------------------------------------- manufacturing */

    make('boms', [rel('item', 'items'), req('name', 120), num('output_qty', { min: 0 }), int('extra_cost', { min: 0 }), txt('notes', 1000), bool('active')].concat(stamps), [
      'CREATE INDEX idx_boms_item ON boms (item)',
    ]);

    make('bom_lines', [rel('bom', 'boms', { cascadeDelete: true }), rel('item', 'items'), num('qty', { min: 0 }), int('sort')].concat(stamps), ['CREATE INDEX idx_bom_lines ON bom_lines (bom, sort)']);

    make(
      'builds',
      [
        txt('number', 30),
        rel('bom', 'boms'),
        rel('item', 'items'),
        num('qty', { min: 0 }),
        rel('warehouse', 'warehouses'),
        day('date'),
        sel('status', ['draft', 'done', 'void'], true),
        int('cost'),
        int('extra'),
        rel('journal', 'journals'),
        rel('void_journal', 'journals'),
        txt('note', 1000),
        sel('actor', ACTORS, true),
        rel('member', 'members'),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_builds_number ON builds (number) WHERE number != ''", 'CREATE INDEX idx_builds_status ON builds (status, date)'],
    );

    /* --------------------------------------------------- assets, budgets */

    make(
      'assets',
      [
        txt('number', 30),
        req('name', 160),
        rel('asset_account', 'accounts'),
        rel('accumulated_account', 'accounts'),
        rel('expense_account', 'accounts'),
        int('cost', { min: 0 }),
        int('salvage', { min: 0 }),
        day('start'),
        int('life_months', { min: 1, max: 1200 }),
        sel('status', ['active', 'disposed'], true),
        int('depreciated', { min: 0 }),
        month('last_month'),
        day('disposed_on'),
        rel('department', 'departments'),
        txt('notes', 1000),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_assets_number ON assets (number) WHERE number != ''", 'CREATE INDEX idx_assets_status ON assets (status)'],
    );

    make('budgets', [rel('account', 'accounts'), month('month'), int('amount')].concat(stamps), ['CREATE UNIQUE INDEX idx_budgets ON budgets (account, month)']);
  },
  (app) => {
    const names = [
      'budgets', 'assets', 'builds', 'bom_lines', 'boms', 'timesheets', 'payslips', 'payroll_runs', 'employee_components', 'pay_components',
      'claim_lines', 'expense_claims', 'leave_adjustments', 'leave_requests', 'holidays', 'leave_types', 'asks', 'proposals', 'inbox',
      'bank_lines', 'imports', 'allocations', 'payments', 'banks', 'stock_moves', 'stock_changes', 'document_lines', 'documents',
      'journal_lines', 'journals', 'stock', 'valuation', 'items', 'warehouses', 'item_categories', 'project_tasks', 'projects',
      'employees', 'contacts', 'parties', 'taxes', 'currencies', 'payment_terms', 'ledger_months', 'accounts', 'departments',
      'field_marks', 'attachments', 'notes', 'audit', 'members', 'roles', 'counters', 'settings',
    ];
    for (const n of names) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
