/// <reference path="../pb_data/types.d.ts" />
/**
 * POS schema (auth mode none: open read rules, loopback only).
 *
 * Money is integer minor units of the shop currency (cents, sen, yen).
 * Rates are basis points (8% = 800). Quantities on sale lines are whole
 * units; a return line has a negative quantity and points at the line it
 * returns.
 *
 * Every collection changes only through the app's operations: create,
 * update and delete rules are null, and hooks.pb.js refuses API writes even
 * from a superuser (the agent's `data` command), so every change goes
 * through the same checks, history and audit as the counter. The ledger
 * (sales, sale_lines, payments, cash_moves, stock_moves, audit) is append
 * only: nothing in the app updates or deletes those rows.
 *
 * PIN hashes, sessions, approvals and the hot counters (receipt and order
 * sequences, each register's hash chain) are readable by superusers only:
 * a sale updates its counters, never the settings or the register, so other
 * devices are not told to reload them on every sale.
 *
 * The blueprint's starter `items` collection is removed first (its
 * migration stays: it is applied history).
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    const readOnly = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const hidden = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const make = (rules, def) => {
      const c = new Collection(Object.assign({ type: 'base' }, rules, def, { fields: def.fields.concat(stamps) }));
      app.save(c);
      return app.findCollectionByNameOrId(def.name);
    };
    const rel = (name, target, opts) =>
      Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: target.id, cascadeDelete: false }, opts || {});
    const int = (name, min, max) => {
      const f = { name: name, type: 'number', onlyInt: true };
      if (min !== undefined && min !== null) f.min = min;
      if (max !== undefined && max !== null) f.max = max;
      return f;
    };
    const text = (name, max, opts) => Object.assign({ name: name, type: 'text', max: max }, opts || {});
    const sel = (name, values, opts) => Object.assign({ name: name, type: 'select', maxSelect: 1, values: values }, opts || {});
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max });
    const bool = (name) => ({ name: name, type: 'bool' });
    const image = (name) => ({
      name: name,
      type: 'file',
      maxSelect: 1,
      maxSize: 8 * 1024 * 1024,
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      thumbs: ['160x160', '480x480'],
    });
    const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'];

    /* ------------------------------------------------------------ setup */

    const taxClasses = make(readOnly, {
      name: 'tax_classes',
      fields: [
        text('name', 40, { required: true }),
        int('rate_bp', 0, 10000),
        // A different rate when eaten in (Japan: food 8% to take away, 10% eaten in). -1: the same rate.
        int('dine_in_rate_bp', -1, 10000),
        text('mark', 4),
        int('sort', 0),
        bool('is_default'),
        bool('archived'),
      ],
      indexes: ['CREATE UNIQUE INDEX idx_tax_classes_name ON tax_classes (name COLLATE NOCASE)'],
    });

    make(readOnly, {
      name: 'settings',
      fields: [
        bool('setup_done'),
        text('business_name', 80),
        text('address', 300),
        text('phone', 40),
        text('email', 120),
        text('website', 200),
        text('tax_reg_label', 40),
        text('tax_reg_no', 40),
        text('company_reg_no', 40),
        sel('region', ['MY', 'SG', 'JP', 'AU', 'NZ', 'GB', 'US', 'OTHER'], { required: true }),
        text('currency', 3, { required: true, min: 3, pattern: '^[A-Z]{3}$' }),
        sel('price_mode', ['inclusive', 'exclusive'], { required: true }),
        sel('tax_rounding', ['half_up', 'floor', 'ceil'], { required: true }),
        int('cash_rounding', 0, 100000),
        { name: 'order_types', type: 'select', maxSelect: 3, values: ORDER_TYPES },
        sel('default_order_type', ORDER_TYPES),
        int('service_charge_bp', 0, 5000),
        sel('service_charge_scope', ['dine_in', 'all']),
        rel('service_charge_tax', taxClasses),
        text('receipt_header', 500),
        text('receipt_footer', 500),
        sel('receipt_width', ['80', '58'], { required: true }),
        bool('receipt_barcode'),
        sel('after_sale', ['ask', 'print', 'none'], { required: true }),
        image('logo'),
        bool('kitchen_enabled'),
        bool('order_numbers'),
        int('lock_minutes', 0, 240),
        int('cashier_discount_bp', 0, 10000),
        int('day_cutoff_hour', 0, 12),
      ],
    });

    const registers = make(readOnly, {
      name: 'registers',
      fields: [
        text('name', 40, { required: true }),
        text('code', 8, { required: true, pattern: '^[A-Z0-9]{1,8}$' }),
        int('z_seq', 0),
        bool('archived'),
      ],
      indexes: ['CREATE UNIQUE INDEX idx_registers_code ON registers (code)'],
    });

    // receipt:<register>, training:<register>, hash:<register> (text: the last
    // hash), order (text: the trading day, num: the last order number).
    make(hidden, {
      name: 'counters',
      fields: [text('key', 80, { required: true }), int('num', 0), text('text', 80)],
      indexes: ['CREATE UNIQUE INDEX idx_counters_key ON counters (key)'],
    });

    const tenders = make(readOnly, {
      name: 'tenders',
      fields: [
        text('name', 30, { required: true }),
        sel('kind', ['cash', 'card', 'qr', 'other'], { required: true }),
        image('qr'),
        bool('ask_reference'),
        bool('active'),
        int('sort', 0),
      ],
    });

    /* ------------------------------------------------------------ people */

    const staff = make(readOnly, {
      name: 'staff',
      fields: [
        text('name', 40, { required: true }),
        sel('role', ['owner', 'manager', 'cashier'], { required: true }),
        int('color', 1, 8),
        bool('active'),
        bool('training'),
        bool('pin_set'),
        int('failed', 0),
        text('locked_until', 40),
      ],
    });

    make(hidden, {
      name: 'staff_pins',
      fields: [rel('staff', staff, { required: true, cascadeDelete: true }), text('salt', 64), text('hash', 64)],
      indexes: ['CREATE UNIQUE INDEX idx_staff_pins_staff ON staff_pins (staff)'],
    });

    make(hidden, {
      name: 'sessions',
      fields: [
        rel('staff', staff, { required: true, cascadeDelete: true }),
        rel('register', registers),
        text('token_hash', 64, { required: true }),
        text('expires', 40),
        bool('ended'),
      ],
      indexes: ['CREATE UNIQUE INDEX idx_sessions_token ON sessions (token_hash)'],
    });

    make(hidden, {
      name: 'approvals',
      fields: [
        sel('action', ['discount_over', 'price_override', 'refund', 'refund_blind', 'void_ticket', 'cash_move', 'reprint'], { required: true }),
        rel('approver', staff, { required: true, cascadeDelete: true }),
        rel('for_staff', staff, { cascadeDelete: true }),
        text('scope', 80),
        text('token_hash', 64, { required: true }),
        text('expires', 40),
        bool('used'),
      ],
      indexes: ['CREATE UNIQUE INDEX idx_approvals_token ON approvals (token_hash)'],
    });

    const customers = make(readOnly, {
      name: 'customers',
      fields: [text('name', 80, { required: true }), text('phone', 40), text('email', 120), text('notes', 1000), bool('marketing'), bool('archived')],
      indexes: ['CREATE INDEX idx_customers_phone ON customers (phone)', 'CREATE INDEX idx_customers_email ON customers (email COLLATE NOCASE)'],
    });

    /* ------------------------------------------------------------ catalog */

    const categories = make(readOnly, {
      name: 'categories',
      fields: [text('name', 40, { required: true }), int('color', 1, 8), text('icon', 40), int('sort', 0), bool('kitchen')],
      indexes: ['CREATE UNIQUE INDEX idx_categories_name ON categories (name COLLATE NOCASE)'],
    });

    const groups = make(readOnly, {
      name: 'modifier_groups',
      fields: [text('name', 40, { required: true }), int('min', 0, 20), int('max', 0, 20), int('sort', 0)],
    });

    make(readOnly, {
      name: 'modifiers',
      fields: [
        rel("modifier_group", groups, { required: true, cascadeDelete: true }),
        text('name', 40, { required: true }),
        int('price', -100000000, 100000000),
        bool('is_default'),
        bool('available'),
        int('sort', 0),
      ],
      indexes: ['CREATE INDEX idx_modifiers_group ON modifiers (modifier_group)'],
    });

    const products = make(readOnly, {
      name: 'products',
      fields: [
        text('name', 80, { required: true }),
        rel('category', categories),
        int('price', 0, 1000000000),
        bool('open_price'),
        rel('tax_class', taxClasses),
        text('sku', 40),
        text('description', 500),
        image('photo'),
        int('color', 0, 8),
        int('cost', 0, 1000000000),
        bool('available'),
        bool('archived'),
        sel('status', ['active', 'draft'], { required: true }),
        bool('track_stock'),
        int('low_stock', 0, 1000000),
        bool('favorite'),
        int('sort', 0),
        int('fav_sort', 0),
        { name: 'modifier_groups', type: 'relation', maxSelect: 20, collectionId: groups.id, cascadeDelete: false },
        text('import_ref', 20),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_products_sku ON products (sku COLLATE NOCASE) WHERE sku != ''",
        'CREATE INDEX idx_products_category ON products (category)',
        'CREATE INDEX idx_products_status ON products (status, archived)',
      ],
    });

    const variants = make(readOnly, {
      name: 'variants',
      fields: [
        rel('product', products, { required: true, cascadeDelete: true }),
        text('name', 40, { required: true }),
        int('price', 0, 1000000000),
        text('sku', 40),
        int('cost', 0, 1000000000),
        int('sort', 0),
        bool('archived'),
      ],
      indexes: ['CREATE INDEX idx_variants_product ON variants (product)', "CREATE UNIQUE INDEX idx_variants_sku ON variants (sku COLLATE NOCASE) WHERE sku != ''"],
    });

    make(readOnly, {
      name: 'codes',
      fields: [
        text('code', 64, { required: true }),
        rel('product', products, { required: true, cascadeDelete: true }),
        rel('variant', variants, { cascadeDelete: true }),
      ],
      indexes: ['CREATE UNIQUE INDEX idx_codes_code ON codes (code COLLATE NOCASE)', 'CREATE INDEX idx_codes_product ON codes (product)'],
    });

    make(readOnly, {
      name: 'discounts',
      fields: [
        text('name', 40, { required: true }),
        sel('kind', ['percent', 'amount'], { required: true }),
        int('value', 0, 1000000000),
        sel('scope', ['order', 'item'], { required: true }),
        int('sort', 0),
      ],
    });

    /* ------------------------------------------------------------ selling */

    const shifts = make(readOnly, {
      name: 'shifts',
      fields: [
        rel('register', registers, { required: true }),
        int('number', 0),
        sel('status', ['open', 'closed'], { required: true }),
        rel('opened_by', staff),
        int('opening_float', 0),
        json('opening_counts', 20000),
        rel('closed_by', staff),
        text('closed_at', 40),
        int('counted_cash'),
        json('closing_counts', 20000),
        int('expected_cash'),
        int('variance'),
        text('note', 300),
        json('summary', 400000),
      ],
      indexes: ['CREATE INDEX idx_shifts_register ON shifts (register, status)'],
    });

    const sales = make(readOnly, {
      name: 'sales',
      fields: [
        text('ref', 64, { required: true }),
        text('body_hash', 64),
        text('number', 24, { required: true }),
        int('seq', 0),
        rel('register', registers, { required: true }),
        rel('shift', shifts),
        rel('staff', staff),
        rel('customer', customers),
        sel('order_type', ORDER_TYPES),
        int('order_no', 0),
        text('name', 40),
        sel('kind', ['sale', 'refund', 'exchange'], { required: true }),
        bool('training'),
        text('currency', 3),
        sel('price_mode', ['inclusive', 'exclusive']),
        int('item_count'),
        int('subtotal'),
        int('discount_total'),
        int('service_charge'),
        int('tax_total'),
        json('taxes', 20000),
        int('rounding'),
        int('total'),
        int('paid'),
        int('change'),
        text('business_day', 10),
        text('note', 300),
        json('header', 20000),
        json('approvals', 20000),
        text('prev_hash', 64),
        text('hash', 64),
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_sales_ref ON sales (ref)',
        'CREATE UNIQUE INDEX idx_sales_number ON sales (number)',
        'CREATE INDEX idx_sales_day ON sales (business_day)',
        'CREATE INDEX idx_sales_shift ON sales (shift)',
        'CREATE INDEX idx_sales_customer ON sales (customer)',
      ],
    });

    const lines = make(readOnly, {
      name: 'sale_lines',
      fields: [
        rel('sale', sales, { required: true }),
        int('line_no', 1),
        rel('product', products),
        rel('variant', variants),
        text('name', 120, { required: true }),
        text('variant_name', 40),
        text('sku', 40),
        text('category', 40),
        text('category_id', 20),
        int('qty'),
        int('unit'),
        json('modifiers', 20000),
        int('gross'),
        int('line_discount'),
        int('order_discount'),
        text('discount_name', 40),
        int('net'),
        text('tax_class', 20),
        text('tax_name', 40),
        int('rate_bp', 0, 10000),
        text('mark', 4),
        int('tax'),
        int('cost'),
        bool('kitchen'),
        text('note', 200),
        bool('restock'),
        bool('price_changed'),
      ],
      indexes: ['CREATE INDEX idx_sale_lines_sale ON sale_lines (sale)', 'CREATE INDEX idx_sale_lines_product ON sale_lines (product)'],
    });
    // A return line points at the line it returns.
    lines.fields.add(new RelationField({ name: 'origin', collectionId: lines.id, maxSelect: 1, cascadeDelete: false }));
    lines.addIndex('idx_sale_lines_origin', false, 'origin', '');
    app.save(lines);

    make(readOnly, {
      name: 'payments',
      fields: [
        rel('sale', sales, { required: true }),
        rel('tender', tenders),
        sel('kind', ['cash', 'card', 'qr', 'other'], { required: true }),
        text('name', 30),
        int('amount'),
        int('tendered'),
        int('change', 0),
        text('reference', 60),
        rel('register', registers),
        rel('shift', shifts),
        rel('staff', staff),
        bool('training'),
        text('business_day', 10),
      ],
      indexes: ['CREATE INDEX idx_payments_sale ON payments (sale)', 'CREATE INDEX idx_payments_shift ON payments (shift)'],
    });

    make(readOnly, {
      name: 'carts',
      fields: [
        text('ref', 64, { required: true }),
        rel('register', registers),
        rel('staff', staff),
        sel('status', ['parked', 'resumed', 'done', 'void'], { required: true }),
        sel('source', ['counter', 'agent'], { required: true }),
        text('name', 40),
        sel('order_type', ORDER_TYPES),
        rel('customer', customers),
        json('lines', 400000),
        json('discount', 2000),
        text('note', 300),
        int('total'),
        int('items', 0),
        rel('sale', sales),
        text('void_reason', 200),
        rel('voided_by', staff),
      ],
      indexes: ['CREATE UNIQUE INDEX idx_carts_ref ON carts (ref)', 'CREATE INDEX idx_carts_status ON carts (status)'],
    });

    make(readOnly, {
      name: 'cash_moves',
      fields: [
        rel('shift', shifts, { required: true }),
        rel('register', registers),
        sel('kind', ['pay_in', 'pay_out', 'drop'], { required: true }),
        int('amount', 0),
        text('reason', 200),
        rel('staff', staff),
        rel('approver', staff),
      ],
      indexes: ['CREATE INDEX idx_cash_moves_shift ON cash_moves (shift)'],
    });

    /* ------------------------------------------------------------ stock */

    make(readOnly, {
      name: 'stock',
      fields: [rel('product', products, { required: true, cascadeDelete: true }), rel('variant', variants, { cascadeDelete: true }), int('qty')],
      indexes: ["CREATE UNIQUE INDEX idx_stock_key ON stock (product, variant)"],
    });

    make(readOnly, {
      name: 'stock_moves',
      fields: [
        rel('product', products, { required: true, cascadeDelete: true }),
        rel('variant', variants, { cascadeDelete: true }),
        int('qty'),
        sel('kind', ['sale', 'refund', 'receive', 'adjust', 'count'], { required: true }),
        text('reason', 200),
        rel('sale', sales),
        int('balance'),
        rel('staff', staff),
        sel('actor', ['staff', 'agent'], { required: true }),
      ],
      indexes: ['CREATE INDEX idx_stock_moves_product ON stock_moves (product, variant)'],
    });

    /* ------------------------------------------------------------ kitchen */

    make(readOnly, {
      name: 'tickets',
      fields: [
        rel('sale', sales, { required: true }),
        rel('register', registers),
        int('order_no', 0),
        text('number', 24),
        text('name', 40),
        sel('order_type', ORDER_TYPES),
        json('items', 100000),
        text('note', 300),
        sel('status', ['new', 'ready', 'done'], { required: true }),
        text('ready_at', 40),
        text('done_at', 40),
        bool('training'),
      ],
      indexes: ['CREATE INDEX idx_tickets_status ON tickets (status)', 'CREATE UNIQUE INDEX idx_tickets_sale ON tickets (sale)'],
    });

    /* ------------------------------------------------------------ the AI agent, history */

    make(readOnly, {
      name: 'imports',
      fields: [
        {
          name: 'file',
          type: 'file',
          maxSelect: 1,
          maxSize: 20 * 1024 * 1024,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        },
        text('filename', 200),
        sel('status', ['waiting', 'reading', 'done', 'failed'], { required: true }),
        text('summary', 1000),
        text('error', 300),
        int('created_count', 0),
        sel('added_by', ['staff', 'agent'], { required: true }),
      ],
      indexes: ['CREATE INDEX idx_imports_status ON imports (status)'],
    });

    make(readOnly, {
      name: 'audit',
      fields: [
        sel('kind', [
          'sale', 'refund', 'exchange', 'override', 'ticket_void', 'shift_open', 'shift_close', 'cash_move',
          'login_failed', 'pin_locked', 'staff_change', 'settings_change', 'catalog_change', 'stock_change',
          'customer_change', 'approval', 'reprint', 'receipt_email', 'ticket_draft', 'import',
        ], { required: true }),
        sel('actor', ['staff', 'agent', 'system'], { required: true }),
        rel('staff', staff),
        rel('approver', staff),
        rel('register', registers),
        text('ref', 80),
        text('summary', 300),
        json('data', 20000),
      ],
      indexes: ['CREATE INDEX idx_audit_kind ON audit (kind)', 'CREATE INDEX idx_audit_created ON audit (created)'],
    });
  },
  (app) => {
    const names = [
      'audit', 'imports', 'tickets', 'stock_moves', 'stock', 'cash_moves', 'carts', 'payments', 'sale_lines', 'sales', 'shifts',
      'discounts', 'codes', 'variants', 'products', 'modifiers', 'modifier_groups', 'categories', 'customers', 'approvals',
      'sessions', 'staff_pins', 'staff', 'tenders', 'counters', 'registers', 'settings', 'tax_classes',
    ];
    for (const n of names) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* not there */
      }
    }
  },
);
