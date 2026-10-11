/// <reference path="../pb_data/types.d.ts" />
/**
 * Point of Sale schema (auth mode none: open read rules, loopback only;
 * secrets live in hidden fields that the API never returns).
 *
 * Money is whole minor units (cents) in number fields. Sales, payments,
 * shifts, the stock and balance ledgers and the audit log are append-only:
 * corrections are returns, voids of open sales and adjustments. Every
 * collection changes only through the app's operations (direct API writes
 * are refused in hooks.pb.js), so the register, the reports and the AI
 * agent always agree.
 *
 * The blueprint's starter `items` collection is removed first (its
 * migration stays: it is applied history).
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    const opsOnly = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const define = (def) => new Collection(Object.assign({ type: 'base' }, opsOnly, def));
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const MB = 1024 * 1024;
    const COLORS = ['neutral', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'graphite'];
    const ACTORS = ['staff', 'agent', 'system'];
    const idOf = (name) => app.findCollectionByNameOrId(name).id;
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: idOf(target), cascadeDelete: false }, extra || {});

    /* ---------------------------------------------------------- settings */
    const settings = define({
      name: 'settings',
      fields: [
        { name: 'setup_done', type: 'bool' },
        { name: 'business_name', type: 'text', max: 120 },
        { name: 'address', type: 'text', max: 600 },
        { name: 'phone', type: 'text', max: 60 },
        { name: 'email', type: 'text', max: 200 },
        { name: 'website', type: 'text', max: 200 },
        { name: 'tax_number', type: 'text', max: 80 },
        { name: 'receipt_header', type: 'text', max: 600 },
        { name: 'receipt_footer', type: 'text', max: 600 },
        { name: 'receipt_width', type: 'select', maxSelect: 1, values: ['58', '80'] },
        { name: 'logo', type: 'file', maxSelect: 1, maxSize: 2 * MB, mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] },
        { name: 'currency', type: 'text', max: 3 },
        { name: 'currency_digits', type: 'number', min: 0, max: 3, onlyInt: true },
        { name: 'prices_include_tax', type: 'bool' },
        { name: 'cash_round_to', type: 'number', min: 0, max: 100000, onlyInt: true },
        { name: 'denominations', type: 'json', maxSize: 4000 },
        { name: 'tips_enabled', type: 'bool' },
        { name: 'tip_presets', type: 'json', maxSize: 400 },
        { name: 'tip_basis', type: 'select', maxSelect: 1, values: ['before_tax', 'after_tax'] },
        { name: 'card_reference', type: 'select', maxSelect: 1, values: ['off', 'optional', 'required'] },
        { name: 'tenders', type: 'json', maxSize: 4000 },
        { name: 'loyalty_enabled', type: 'bool' },
        { name: 'points_per_unit', type: 'number', min: 0, max: 1000 },
        { name: 'point_value', type: 'number', min: 0, max: 1000000, onlyInt: true },
        { name: 'points_min_redeem', type: 'number', min: 0, max: 1000000, onlyInt: true },
        { name: 'receipt_prefix', type: 'text', max: 12 },
        { name: 'next_receipt', type: 'number', min: 1, max: 999999999, onlyInt: true },
        { name: 'require_shift', type: 'bool' },
        { name: 'allow_negative_stock', type: 'bool' },
        { name: 'low_stock_default', type: 'number', min: 0, max: 1000000 },
        { name: 'lock_idle_minutes', type: 'number', min: 0, max: 240, onlyInt: true },
        { name: 'lock_after_sale', type: 'bool' },
        { name: 'auto_shift_review', type: 'bool' },
        { name: 'permissions', type: 'json', maxSize: 20000 },
        { name: 'secret', type: 'text', max: 200, hidden: true },
      ].concat(stamps),
    });
    app.save(settings);

    /* ------------------------------------------------------------- people */
    app.save(
      define({
        name: 'registers',
        fields: [
          { name: 'name', type: 'text', required: true, max: 60 },
          { name: 'active', type: 'bool' },
          { name: 'current_order', type: 'text', max: 40 },
          { name: 'display_message', type: 'json', maxSize: 4000 },
        ].concat(stamps),
        indexes: ['CREATE UNIQUE INDEX idx_registers_name ON registers (name COLLATE NOCASE)'],
      }),
    );

    app.save(
      define({
        name: 'staff',
        fields: [
          { name: 'name', type: 'text', required: true, max: 80 },
          { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['owner', 'manager', 'cashier'] },
          { name: 'pin_hash', type: 'text', max: 128, hidden: true },
          { name: 'pin_salt', type: 'text', max: 64, hidden: true },
          { name: 'active', type: 'bool' },
          { name: 'color', type: 'select', maxSelect: 1, values: COLORS },
          { name: 'email', type: 'text', max: 200 },
          { name: 'phone', type: 'text', max: 60 },
          { name: 'last_signed_in', type: 'date' },
        ].concat(stamps),
        indexes: ['CREATE UNIQUE INDEX idx_staff_name ON staff (name COLLATE NOCASE)'],
      }),
    );

    app.save(
      define({
        name: 'timeclock',
        fields: [
          rel('staff', 'staff', { required: true, cascadeDelete: true }),
          { name: 'clock_in', type: 'date', required: true },
          { name: 'clock_out', type: 'date' },
          { name: 'note', type: 'text', max: 400 },
          rel('edited_by', 'staff'),
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_timeclock_staff ON timeclock (staff, clock_in)', "CREATE UNIQUE INDEX idx_timeclock_open ON timeclock (staff) WHERE clock_out = ''"],
      }),
    );

    /* ------------------------------------------------------------ catalog */
    app.save(
      define({
        name: 'categories',
        fields: [
          { name: 'name', type: 'text', required: true, max: 60 },
          { name: 'color', type: 'select', maxSelect: 1, values: COLORS },
          { name: 'sort', type: 'number', onlyInt: true },
        ].concat(stamps),
        indexes: ['CREATE UNIQUE INDEX idx_categories_name ON categories (name COLLATE NOCASE)'],
      }),
    );

    app.save(
      define({
        name: 'taxes',
        fields: [
          { name: 'name', type: 'text', required: true, max: 60 },
          { name: 'rate', type: 'number', min: 0, max: 100 },
          { name: 'is_default', type: 'bool' },
        ].concat(stamps),
        indexes: ['CREATE UNIQUE INDEX idx_taxes_name ON taxes (name COLLATE NOCASE)'],
      }),
    );

    app.save(
      define({
        name: 'modifier_groups',
        fields: [
          { name: 'name', type: 'text', required: true, max: 60 },
          { name: 'min', type: 'number', min: 0, max: 50, onlyInt: true },
          { name: 'max', type: 'number', min: 0, max: 50, onlyInt: true },
          { name: 'options', type: 'json', maxSize: 20000 },
          { name: 'sort', type: 'number', onlyInt: true },
        ].concat(stamps),
        indexes: ['CREATE UNIQUE INDEX idx_modifier_groups_name ON modifier_groups (name COLLATE NOCASE)'],
      }),
    );

    app.save(
      define({
        name: 'products',
        fields: [
          { name: 'name', type: 'text', required: true, max: 120 },
          rel('category', 'categories'),
          { name: 'description', type: 'text', max: 2000 },
          { name: 'image', type: 'file', maxSelect: 1, maxSize: 5 * MB, mimeTypes: ['image/png', 'image/jpeg', 'image/webp'], thumbs: ['160x160', '480x480'] },
          { name: 'color', type: 'select', maxSelect: 1, values: COLORS },
          rel('tax', 'taxes'),
          { name: 'tax_exempt', type: 'bool' },
          { name: 'modifier_groups', type: 'relation', maxSelect: 20, collectionId: idOf('modifier_groups'), cascadeDelete: false },
          { name: 'option_names', type: 'json', maxSize: 400 },
          { name: 'sold_by', type: 'select', maxSelect: 1, values: ['each', 'weight'] },
          { name: 'unit', type: 'text', max: 12 },
          { name: 'favorite', type: 'bool' },
          { name: 'sort', type: 'number', onlyInt: true },
          { name: 'archived', type: 'bool' },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_products_name ON products (name COLLATE NOCASE)', 'CREATE INDEX idx_products_category ON products (category)'],
      }),
    );

    app.save(
      define({
        name: 'variants',
        fields: [
          rel('product', 'products', { required: true, cascadeDelete: true }),
          { name: 'title', type: 'text', max: 120 },
          { name: 'options', type: 'json', maxSize: 400 },
          { name: 'sku', type: 'text', max: 64 },
          { name: 'barcode', type: 'text', max: 64 },
          { name: 'price', type: 'number', onlyInt: true, min: 0 },
          { name: 'cost', type: 'number', min: 0 },
          { name: 'track_stock', type: 'bool' },
          { name: 'stock', type: 'number' },
          { name: 'low_at', type: 'number', min: 0 },
          { name: 'position', type: 'number', onlyInt: true },
          { name: 'archived', type: 'bool' },
        ].concat(stamps),
        indexes: [
          'CREATE INDEX idx_variants_product ON variants (product, position)',
          "CREATE UNIQUE INDEX idx_variants_sku ON variants (sku COLLATE NOCASE) WHERE sku != ''",
          "CREATE UNIQUE INDEX idx_variants_barcode ON variants (barcode) WHERE barcode != ''",
        ],
      }),
    );

    /* ---------------------------------------------------------- customers */
    app.save(
      define({
        name: 'customers',
        fields: [
          { name: 'name', type: 'text', required: true, max: 120 },
          { name: 'phone', type: 'text', max: 60 },
          { name: 'email', type: 'text', max: 200 },
          { name: 'notes', type: 'text', max: 2000 },
          { name: 'tags', type: 'json', maxSize: 2000 },
          { name: 'tax_exempt', type: 'bool' },
          { name: 'marketing', type: 'bool' },
          { name: 'birthday', type: 'text', max: 10 },
          { name: 'points', type: 'number', onlyInt: true },
          { name: 'credit', type: 'number', onlyInt: true },
          { name: 'visits', type: 'number', onlyInt: true, min: 0 },
          { name: 'spent', type: 'number', onlyInt: true },
          { name: 'last_visit', type: 'date' },
        ].concat(stamps),
        indexes: [
          'CREATE INDEX idx_customers_name ON customers (name COLLATE NOCASE)',
          "CREATE UNIQUE INDEX idx_customers_email ON customers (email COLLATE NOCASE) WHERE email != ''",
          "CREATE UNIQUE INDEX idx_customers_phone ON customers (phone) WHERE phone != ''",
        ],
      }),
    );

    app.save(
      define({
        name: 'gift_cards',
        fields: [
          { name: 'code', type: 'text', required: true, max: 40 },
          { name: 'balance', type: 'number', onlyInt: true },
          { name: 'issued', type: 'number', onlyInt: true },
          { name: 'status', type: 'select', maxSelect: 1, values: ['active', 'disabled'] },
          rel('customer', 'customers'),
          { name: 'last_used', type: 'date' },
          { name: 'note', type: 'text', max: 400 },
        ].concat(stamps),
        indexes: ['CREATE UNIQUE INDEX idx_gift_cards_code ON gift_cards (code COLLATE NOCASE)'],
      }),
    );

    app.save(
      define({
        name: 'discounts',
        fields: [
          { name: 'name', type: 'text', required: true, max: 80 },
          { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['percent', 'amount', 'bogo'] },
          { name: 'value', type: 'number', min: 0 },
          { name: 'scope', type: 'select', required: true, maxSelect: 1, values: ['order', 'item'] },
          { name: 'applies', type: 'select', maxSelect: 1, values: ['all', 'categories', 'products'] },
          { name: 'categories', type: 'relation', maxSelect: 200, collectionId: idOf('categories'), cascadeDelete: false },
          { name: 'products', type: 'relation', maxSelect: 500, collectionId: idOf('products'), cascadeDelete: false },
          { name: 'mode', type: 'select', required: true, maxSelect: 1, values: ['manual', 'auto', 'code'] },
          { name: 'code', type: 'text', max: 40 },
          { name: 'min_subtotal', type: 'number', onlyInt: true, min: 0 },
          { name: 'min_qty', type: 'number', min: 0 },
          { name: 'buy_qty', type: 'number', onlyInt: true, min: 0 },
          { name: 'get_qty', type: 'number', onlyInt: true, min: 0 },
          { name: 'days', type: 'json', maxSize: 200 },
          { name: 'start_time', type: 'text', max: 5 },
          { name: 'end_time', type: 'text', max: 5 },
          { name: 'starts_on', type: 'text', max: 10 },
          { name: 'ends_on', type: 'text', max: 10 },
          { name: 'manager_only', type: 'bool' },
          { name: 'active', type: 'bool' },
          { name: 'uses', type: 'number', onlyInt: true, min: 0 },
        ].concat(stamps),
        indexes: ["CREATE UNIQUE INDEX idx_discounts_code ON discounts (code COLLATE NOCASE) WHERE code != ''"],
      }),
    );

    /* --------------------------------------------------------- the drawer */
    app.save(
      define({
        name: 'shifts',
        fields: [
          rel('register', 'registers', { required: true }),
          { name: 'number', type: 'number', onlyInt: true, min: 1 },
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'closed'] },
          rel('opened_by', 'staff'),
          { name: 'opened_at', type: 'date' },
          { name: 'opening_float', type: 'number', onlyInt: true, min: 0 },
          rel('closed_by', 'staff'),
          { name: 'closed_at', type: 'date' },
          { name: 'counted', type: 'number', onlyInt: true },
          { name: 'counts', type: 'json', maxSize: 4000 },
          { name: 'expected', type: 'number', onlyInt: true },
          { name: 'difference', type: 'number', onlyInt: true },
          { name: 'note', type: 'text', max: 2000 },
          { name: 'report', type: 'json', maxSize: 200000 },
          { name: 'actor', type: 'select', maxSelect: 1, values: ACTORS },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_shifts_register ON shifts (register, opened_at)', "CREATE UNIQUE INDEX idx_shifts_open ON shifts (register) WHERE status = 'open'"],
      }),
    );

    app.save(
      define({
        name: 'cash_moves',
        fields: [
          rel('shift', 'shifts', { required: true }),
          { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['pay_in', 'pay_out', 'no_sale'] },
          { name: 'amount', type: 'number', onlyInt: true, min: 0 },
          { name: 'reason', type: 'text', max: 200 },
          rel('staff', 'staff'),
          rel('approved_by', 'staff'),
          { name: 'actor', type: 'select', maxSelect: 1, values: ACTORS },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_cash_moves_shift ON cash_moves (shift, created)'],
      }),
    );

    /* -------------------------------------------------------------- sales */
    app.save(
      define({
        name: 'orders',
        fields: [
          { name: 'number', type: 'text', max: 24 },
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'paid', 'void'] },
          rel('register', 'registers'),
          rel('shift', 'shifts'),
          rel('opened_by', 'staff'),
          rel('closed_by', 'staff'),
          rel('customer', 'customers'),
          { name: 'label', type: 'text', max: 60 },
          { name: 'note', type: 'text', max: 1000 },
          { name: 'order_discount', type: 'json', maxSize: 4000 },
          { name: 'applied_discount', type: 'json', maxSize: 4000 },
          { name: 'tax_exempt', type: 'bool' },
          { name: 'items', type: 'number' },
          { name: 'subtotal', type: 'number', onlyInt: true },
          { name: 'discount_total', type: 'number', onlyInt: true },
          { name: 'tax_total', type: 'number', onlyInt: true },
          { name: 'total', type: 'number', onlyInt: true },
          { name: 'tip', type: 'number', onlyInt: true, min: 0 },
          { name: 'rounding', type: 'number', onlyInt: true },
          { name: 'paid_total', type: 'number', onlyInt: true },
          { name: 'change_total', type: 'number', onlyInt: true, min: 0 },
          { name: 'balance', type: 'number', onlyInt: true },
          { name: 'cost_total', type: 'number' },
          { name: 'taxes', type: 'json', maxSize: 8000 },
          { name: 'has_returns', type: 'bool' },
          { name: 'return_status', type: 'select', maxSelect: 1, values: ['none', 'partial', 'full'] },
          { name: 'points_earned', type: 'number', onlyInt: true },
          { name: 'paid_at', type: 'date' },
          { name: 'voided_at', type: 'date' },
          { name: 'void_reason', type: 'text', max: 400 },
          rel('voided_by', 'staff'),
          { name: 'actor', type: 'select', maxSelect: 1, values: ACTORS },
          { name: 'version', type: 'number', onlyInt: true, min: 0 },
        ].concat(stamps),
        indexes: [
          "CREATE UNIQUE INDEX idx_orders_number ON orders (number) WHERE number != ''",
          'CREATE INDEX idx_orders_status ON orders (status, paid_at)',
          'CREATE INDEX idx_orders_customer ON orders (customer, paid_at)',
          'CREATE INDEX idx_orders_shift ON orders (shift)',
        ],
      }),
    );

    app.save(
      define({
        name: 'order_lines',
        fields: [
          rel('order', 'orders', { required: true, cascadeDelete: true }),
          { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['item', 'gift_card', 'custom'] },
          { name: 'variant', type: 'text', max: 40 },
          { name: 'product', type: 'text', max: 40 },
          { name: 'category', type: 'text', max: 40 },
          { name: 'name', type: 'text', required: true, max: 160 },
          { name: 'variant_title', type: 'text', max: 120 },
          { name: 'sku', type: 'text', max: 64 },
          { name: 'qty', type: 'number' },
          { name: 'unit', type: 'text', max: 12 },
          { name: 'unit_price', type: 'number', onlyInt: true },
          { name: 'list_price', type: 'number', onlyInt: true },
          { name: 'refund_amount', type: 'number', onlyInt: true },
          { name: 'modifiers', type: 'json', maxSize: 8000 },
          { name: 'price_override', type: 'json', maxSize: 2000 },
          { name: 'line_discount', type: 'json', maxSize: 2000 },
          { name: 'auto_discount', type: 'json', maxSize: 2000 },
          { name: 'tax_id', type: 'text', max: 40 },
          { name: 'tax_name', type: 'text', max: 60 },
          { name: 'tax_rate', type: 'number' },
          { name: 'gross', type: 'number', onlyInt: true },
          { name: 'discount', type: 'number', onlyInt: true },
          { name: 'order_discount', type: 'number', onlyInt: true },
          { name: 'tax', type: 'number', onlyInt: true },
          { name: 'net', type: 'number', onlyInt: true },
          { name: 'total', type: 'number', onlyInt: true },
          { name: 'unit_cost', type: 'number' },
          { name: 'return_of', type: 'text', max: 40 },
          { name: 'returned_qty', type: 'number' },
          { name: 'restock', type: 'bool' },
          { name: 'gift_code', type: 'text', max: 40 },
          { name: 'note', type: 'text', max: 400 },
          { name: 'position', type: 'number', onlyInt: true },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_order_lines_order ON order_lines (order, position)', "CREATE INDEX idx_order_lines_return ON order_lines (return_of) WHERE return_of != ''", 'CREATE INDEX idx_order_lines_variant ON order_lines (variant)'],
      }),
    );

    app.save(
      define({
        name: 'payments',
        fields: [
          rel('order', 'orders', { required: true }),
          { name: 'tender', type: 'select', required: true, maxSelect: 1, values: ['cash', 'card', 'gift_card', 'store_credit', 'points', 'other'] },
          { name: 'label', type: 'text', max: 60 },
          { name: 'amount', type: 'number', onlyInt: true },
          { name: 'tendered', type: 'number', onlyInt: true },
          { name: 'change', type: 'number', onlyInt: true, min: 0 },
          { name: 'reference', type: 'text', max: 80 },
          rel('gift_card', 'gift_cards'),
          rel('customer', 'customers'),
          { name: 'points', type: 'number', onlyInt: true },
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['captured', 'voided'] },
          rel('shift', 'shifts'),
          rel('register', 'registers'),
          rel('staff', 'staff'),
          rel('approved_by', 'staff'),
          { name: 'actor', type: 'select', maxSelect: 1, values: ACTORS },
          { name: 'client_ref', type: 'text', max: 64 },
          { name: 'voided_at', type: 'date' },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_payments_order ON payments (order, created)', 'CREATE INDEX idx_payments_shift ON payments (shift, tender)', "CREATE UNIQUE INDEX idx_payments_client_ref ON payments (client_ref) WHERE client_ref != ''"],
      }),
    );

    /* ----------------------------------------------------------- ledgers */
    app.save(
      define({
        name: 'stock_moves',
        fields: [
          { name: 'variant', type: 'text', required: true, max: 40 },
          { name: 'product', type: 'text', max: 40 },
          { name: 'name', type: 'text', max: 300 },
          { name: 'reason', type: 'select', required: true, maxSelect: 1, values: ['sale', 'return', 'receive', 'adjust', 'count', 'damage', 'loss', 'opening'] },
          { name: 'delta', type: 'number' },
          { name: 'after', type: 'number' },
          { name: 'unit_cost', type: 'number' },
          { name: 'order', type: 'text', max: 40 },
          { name: 'batch', type: 'text', max: 40 },
          { name: 'note', type: 'text', max: 400 },
          rel('staff', 'staff'),
          { name: 'actor', type: 'select', maxSelect: 1, values: ACTORS },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_stock_moves_variant ON stock_moves (variant, created)', 'CREATE INDEX idx_stock_moves_created ON stock_moves (created)'],
      }),
    );

    app.save(
      define({
        name: 'account_moves',
        fields: [
          { name: 'account', type: 'select', required: true, maxSelect: 1, values: ['points', 'credit', 'gift_card'] },
          { name: 'customer', type: 'text', max: 40 },
          { name: 'gift_card', type: 'text', max: 40 },
          { name: 'reason', type: 'select', required: true, maxSelect: 1, values: ['earn', 'redeem', 'refund', 'issue', 'reload', 'adjust', 'void'] },
          { name: 'delta', type: 'number', onlyInt: true },
          { name: 'after', type: 'number', onlyInt: true },
          { name: 'order', type: 'text', max: 40 },
          { name: 'payment', type: 'text', max: 40 },
          { name: 'note', type: 'text', max: 400 },
          rel('staff', 'staff'),
          { name: 'actor', type: 'select', maxSelect: 1, values: ACTORS },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_account_moves_customer ON account_moves (customer, created)', 'CREATE INDEX idx_account_moves_card ON account_moves (gift_card, created)'],
      }),
    );

    app.save(
      define({
        name: 'events',
        fields: [
          { name: 'kind', type: 'text', required: true, max: 40 },
          rel('staff', 'staff'),
          rel('approved_by', 'staff'),
          { name: 'actor', type: 'select', maxSelect: 1, values: ACTORS },
          { name: 'register', type: 'text', max: 40 },
          { name: 'order', type: 'text', max: 40 },
          { name: 'amount', type: 'number', onlyInt: true },
          { name: 'detail', type: 'text', max: 600 },
          { name: 'data', type: 'json', maxSize: 20000 },
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_events_created ON events (created)', 'CREATE INDEX idx_events_kind ON events (kind, created)'],
      }),
    );

    app.save(
      define({
        name: 'requests',
        fields: [
          { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['receipt', 'shift_review', 'restock', 'question'] },
          { name: 'title', type: 'text', max: 200 },
          { name: 'body', type: 'text', max: 4000 },
          { name: 'order', type: 'text', max: 40 },
          { name: 'shift', type: 'text', max: 40 },
          { name: 'customer', type: 'text', max: 40 },
          { name: 'contact', type: 'text', max: 200 },
          { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['sent', 'working', 'done', 'failed'] },
          { name: 'result', type: 'text', max: 20000 },
          { name: 'request_id', type: 'text', max: 40 },
          rel('staff', 'staff'),
        ].concat(stamps),
        indexes: ['CREATE INDEX idx_requests_created ON requests (created)'],
      }),
    );

    /* ------------------------------------------------- the settings row */
    const row = new Record(app.findCollectionByNameOrId('settings'));
    row.set('setup_done', false);
    row.set('currency', 'USD');
    row.set('currency_digits', 2);
    row.set('prices_include_tax', false);
    row.set('cash_round_to', 0);
    row.set('denominations', []);
    row.set('tips_enabled', false);
    row.set('tip_presets', [10, 15, 20]);
    row.set('tip_basis', 'before_tax');
    row.set('card_reference', 'optional');
    row.set('tenders', []);
    row.set('loyalty_enabled', false);
    row.set('points_per_unit', 1);
    row.set('point_value', 1);
    row.set('points_min_redeem', 100);
    row.set('receipt_prefix', '');
    row.set('next_receipt', 1001);
    row.set('receipt_width', '80');
    row.set('require_shift', true);
    row.set('allow_negative_stock', true);
    row.set('low_stock_default', 5);
    row.set('lock_idle_minutes', 5);
    row.set('lock_after_sale', false);
    row.set('auto_shift_review', true);
    row.set('permissions', {});
    row.set('secret', $security.randomString(48));
    app.save(row);
  },
  (app) => {
    for (const name of ['requests', 'events', 'account_moves', 'stock_moves', 'payments', 'order_lines', 'orders', 'cash_moves', 'shifts', 'discounts', 'gift_cards', 'customers', 'variants', 'products', 'modifier_groups', 'taxes', 'categories', 'timeclock', 'staff', 'registers', 'settings']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
