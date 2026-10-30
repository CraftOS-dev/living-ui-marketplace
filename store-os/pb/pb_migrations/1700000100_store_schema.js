/// <reference path="../pb_data/types.d.ts" />
/**
 * The Store OS schema.
 *
 *   settings     one row: the business, base currency, your AI agent's limits,
 *                the exchange rates and the data rules
 *   shops        every shop on every platform (and the Direct shop for chat
 *                and social sales): setup checklist, how data gets in, fees,
 *                ship-by days, stock rule, the policies your AI agent quotes
 *   products     the catalog: one product, many shops
 *   variants     the sellable units (one SKU each) with price, cost and the
 *                on-hand count the stock ledger keeps
 *   stock_moves  the stock ledger: every change to on hand, with its reason
 *   listings     one product on one shop: its own title, text, price, status
 *   customers    buyers across every shop
 *   orders       every order from every shop, amounts in minor units of the
 *                order's currency (cost of goods in the base currency)
 *   order_lines  what was bought (kind item: a catalog SKU; extra: not a
 *                product, e.g. a gift card or gift wrap, with its own cost)
 *   shipments    parcels with a carrier, tracking and a normalised status
 *   threads      buyer conversations, one per buyer question
 *   messages     the messages of a thread (in, out, private notes)
 *   proposals    changes waiting for your approval (your AI agent proposes)
 *   chats        what you told your AI agent in the app, and its replies
 *   tasks        work handed to your AI agent (sync a shop, prepare listings,
 *                draft or send a reply, check tracking...), asked in batches
 *   imports      file imports (seller-centre exports) and what they changed
 *   activity     who changed what
 *
 * Every collection is closed to the raw API (rules null): screens and your AI
 * agent read and write through the operations in pb_hooks (cat_*.js), which
 * keep the ledger, the totals and the activity trail in step.
 */
migrate(
  (app) => {
    const created = { name: 'created', type: 'autodate', onCreate: true };
    const updated = { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true };
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const T = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max }, extra || {});
    const N = (name, extra) => Object.assign({ name: name, type: 'number' }, extra || {});
    const B = (name) => ({ name: name, type: 'bool' });
    const J = (name, maxSize) => ({ name: name, type: 'json', maxSize: maxSize || 200000 });
    const R = (name, target, cascade, required) => ({ name: name, type: 'relation', collectionId: app.findCollectionByNameOrId(target).id, cascadeDelete: cascade === true, maxSelect: 1, required: required === true });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({}, closed, { type: 'base', name: name, fields: fields.concat([created, updated]), indexes: indexes || [] }));
      app.save(c);
      return c;
    };

    make('settings', [
      T('business_name', 120),
      T('owner_name', 80),
      T('country', 4),
      T('base_currency', 3),
      T('timezone', 60),
      J('autonomy', 4000),
      J('guards', 4000),
      N('pii_days', { onlyInt: true }),
      N('low_stock', { onlyInt: true }),
      J('fx', 20000),
      T('fx_at', 40),
      T('fx_error', 300),
      N('utc_offset', { onlyInt: true }),
      J('extras', 40000),
      B('onboarded'),
    ]);

    make(
      'shops',
      [
        T('name', 80, { required: true }),
        T('platform', 30, { required: true }),
        T('region', 4),
        T('currency', 3),
        T('url', 500),
        T('admin_url', 500),
        T('status', 20),
        T('connection', 20),
        J('setup', 20000),
        N('commission_bps', { onlyInt: true }),
        N('payment_bps', { onlyInt: true }),
        N('fixed_fee_minor', { onlyInt: true }),
        N('ship_days', { onlyInt: true }),
        N('reply_hours', { onlyInt: true }),
        N('stock_share', { onlyInt: true }),
        N('stock_buffer', { onlyInt: true }),
        N('stock_max', { onlyInt: true }),
        J('policies', 40000),
        T('sync_at', 40),
        T('sync_note', 2000),
        N('sort', { onlyInt: true }),
      ],
      ['CREATE INDEX idx_shops_sort ON shops (sort)'],
    );

    make('products', [
      T('title', 300, { required: true }),
      T('brand', 120),
      T('category', 200),
      T('description', 20000),
      T('status', 20),
      { name: 'images', type: 'file', maxSelect: 12, maxSize: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'], thumbs: ['200x200', '400x400', '800x0'] },
      J('facts', 40000),
      J('tags', 4000),
      T('note', 2000),
    ]);

    make(
      'variants',
      [
        R('product', 'products', true, true),
        T('sku', 120, { required: true }),
        T('option', 120),
        N('price_minor', { onlyInt: true }),
        N('cost_minor', { onlyInt: true }),
        T('barcode', 60),
        N('weight_g', { onlyInt: true }),
        N('low_stock', { onlyInt: true }),
        N('on_hand', { onlyInt: true }),
        N('sort', { onlyInt: true }),
      ],
      ['CREATE UNIQUE INDEX idx_variants_sku ON variants (sku COLLATE NOCASE)', 'CREATE INDEX idx_variants_product ON variants (product)'],
    );

    make(
      'stock_moves',
      [R('variant', 'variants', true, true), N('qty', { onlyInt: true }), T('reason', 20), T('ref', 120), T('note', 300), T('actor', 10), N('balance', { onlyInt: true })],
      ['CREATE INDEX idx_moves_variant ON stock_moves (variant, created)'],
    );

    make(
      'listings',
      [
        R('product', 'products', true, true),
        R('shop', 'shops', true, true),
        T('status', 20),
        T('title', 500),
        T('description', 20000),
        N('price_minor', { onlyInt: true }),
        J('keywords', 4000),
        T('external_id', 120),
        T('url', 500),
        T('source', 10),
        J('pushed', 20000),
        T('pushed_at', 40),
        T('published_at', 40),
        T('changed_at', 40),
      ],
      ['CREATE UNIQUE INDEX idx_listings_pair ON listings (product, shop)', 'CREATE INDEX idx_listings_shop ON listings (shop)'],
    );

    make('customers', [T('name', 200), T('email', 200), T('phone', 60), T('key', 200), T('note', 2000), J('tags', 4000)], ['CREATE INDEX idx_customers_key ON customers (key)']);

    make(
      'orders',
      [
        R('shop', 'shops', true, true),
        T('number', 120, { required: true }),
        T('placed_at', 40),
        T('currency', 3),
        R('customer', 'customers', false, false),
        T('buyer_name', 200),
        T('buyer_email', 200),
        T('buyer_phone', 60),
        J('address', 4000),
        B('purged'),
        T('status', 20),
        T('payment', 20),
        T('ship_by', 40),
        N('subtotal_minor', { onlyInt: true }),
        N('shipping_minor', { onlyInt: true }),
        N('discount_minor', { onlyInt: true }),
        N('tax_minor', { onlyInt: true }),
        N('total_minor', { onlyInt: true }),
        N('fees_minor', { onlyInt: true }),
        B('fees_estimated'),
        N('ship_cost_minor', { onlyInt: true }),
        N('refund_minor', { onlyInt: true }),
        N('cogs_minor', { onlyInt: true }),
        B('cost_missing'),
        T('note', 2000),
        T('source', 10),
        T('import_id', 40),
        T('shipped_at', 40),
        T('delivered_at', 40),
        T('cancelled_at', 40),
        T('cancel_reason', 300),
      ],
      ['CREATE UNIQUE INDEX idx_orders_number ON orders (shop, number)', 'CREATE INDEX idx_orders_placed ON orders (placed_at)', 'CREATE INDEX idx_orders_status ON orders (status)', 'CREATE INDEX idx_orders_customer ON orders (customer)'],
    );

    make(
      'order_lines',
      [
        R('order_ref', 'orders', true, true),
        R('variant', 'variants', false, false),
        T('sku', 120),
        T('title', 300),
        T('option', 120),
        N('qty', { onlyInt: true }),
        N('price_minor', { onlyInt: true }),
        N('cost_minor', { onlyInt: true }),
        N('qty_shipped', { onlyInt: true }),
        N('qty_returned', { onlyInt: true }),
        T('kind', 10),
        N('sort', { onlyInt: true }),
      ],
      ['CREATE INDEX idx_lines_order ON order_lines (order_ref)', 'CREATE INDEX idx_lines_variant ON order_lines (variant)'],
    );

    make(
      'shipments',
      [
        R('order_ref', 'orders', true, true),
        T('carrier', 80),
        T('tracking', 120),
        T('url', 500),
        T('status', 30),
        T('last_event', 500),
        T('last_event_at', 40),
        T('shipped_at', 40),
        T('delivered_at', 40),
        T('eta', 40),
        J('events', 100000),
        T('checked_at', 40),
      ],
      ['CREATE INDEX idx_shipments_order ON shipments (order_ref)'],
    );

    make(
      'threads',
      [
        R('shop', 'shops', true, false),
        R('customer', 'customers', false, false),
        R('order_ref', 'orders', false, false),
        T('subject', 300),
        T('channel', 20),
        T('status', 20),
        T('intent', 30),
        T('due_at', 40),
        T('last_at', 40),
        B('unread'),
        T('draft', 10000),
        T('draft_by', 10),
        T('draft_why', 2000),
        T('draft_at', 40),
        T('external_id', 120),
      ],
      ['CREATE INDEX idx_threads_status ON threads (status, due_at)'],
    );

    make(
      'messages',
      [R('thread', 'threads', true, true), T('direction', 10), T('author', 10), T('body', 20000), T('via', 20), T('state', 20), T('error', 500), T('at', 40), T('external_id', 120)],
      ['CREATE INDEX idx_messages_thread ON messages (thread, at)'],
    );

    make(
      'proposals',
      [
        T('kind', 20),
        T('title', 300),
        T('why', 4000),
        T('origin', 10),
        T('status', 20),
        T('risk', 10),
        J('items', 400000),
        J('result', 100000),
        J('undo', 400000),
        T('target', 120),
        T('decided_at', 40),
        T('note', 1000),
      ],
      ['CREATE INDEX idx_proposals_status ON proposals (status)'],
    );

    make('chats', [T('text', 4000), T('reply', 6000), T('state', 20), T('task', 40), T('context', 200)]);

    make(
      'tasks',
      [T('kind', 30), T('target', 120), T('label', 300), J('params', 20000), T('state', 20), T('request', 40), T('note', 4000), T('asked_at', 40), T('started_at', 40), T('done_at', 40), T('by', 10)],
      ['CREATE INDEX idx_tasks_state ON tasks (state, created)', 'CREATE INDEX idx_tasks_target ON tasks (target)'],
    );

    make('imports', [T('kind', 20), R('shop', 'shops', true, false), T('file_name', 200), N('rows', { onlyInt: true }), N('created_n', { onlyInt: true }), N('updated_n', { onlyInt: true }), N('skipped_n', { onlyInt: true }), J('problems', 100000), T('by', 10)]);

    make('activity', [T('actor', 10), T('text', 600), T('target', 120)], ['CREATE INDEX idx_activity_created ON activity (created)']);

    // The one settings row, with the defaults a new store starts from.
    const settings = new Record(app.findCollectionByNameOrId('settings'));
    settings.set('id', 'storesettings01');
    settings.set('business_name', '');
    settings.set('owner_name', '');
    settings.set('country', '');
    settings.set('base_currency', '');
    settings.set('timezone', '');
    settings.set('autonomy', { listings: 'ask', prices: 'ask', stock: 'ask', replies: 'ask', orders: 'ask' });
    settings.set('guards', { max_price_drop_pct: 30, min_margin_pct: 0 });
    settings.set('pii_days', 30);
    settings.set('low_stock', 5);
    settings.set('fx', {});
    settings.set('extras', {});
    settings.set('utc_offset', 0);
    settings.set('onboarded', false);
    app.save(settings);

    // The Direct shop: orders taken in chat, on social media or in person.
    const direct = new Record(app.findCollectionByNameOrId('shops'));
    direct.set('name', 'Direct');
    direct.set('platform', 'direct');
    direct.set('status', 'active');
    direct.set('connection', 'manual');
    direct.set('setup', {});
    direct.set('policies', {});
    direct.set('ship_days', 2);
    direct.set('reply_hours', 24);
    direct.set('stock_share', 100);
    direct.set('sort', 0);
    app.save(direct);
  },
  (app) => {
    for (const name of ['activity', 'tasks', 'imports', 'chats', 'proposals', 'messages', 'threads', 'shipments', 'order_lines', 'orders', 'customers', 'listings', 'stock_moves', 'variants', 'products', 'shops', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
