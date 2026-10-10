/// <reference path="../pb_data/types.d.ts" />
/**
 * Inventory schema (auth mode none: open read rules, loopback only).
 *
 * Quantities are never typed into a record. The `movements` ledger is the
 * truth: every stock change is a movement row, and `stock` keeps the balance
 * per item and location, written in the same transaction as the movement.
 * Both are written only by the app's operations (lib_ledger.js); direct API
 * writes to them are refused in hooks.pb.js.
 *
 * Unit costs are integers of 1/10000 of the currency unit, so a screw at
 * $0.034 keeps its price. Quantities are numbers rounded to 3 decimals.
 * Days are plain 'YYYY-MM-DD' text in the user's calendar.
 *
 * The blueprint's starter `items` collection is removed first (its
 * migration stays: it is applied history) and a new `items` is created.
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    const open = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' };
    const ledgerOnly = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const define = (rules, def) => new Collection(Object.assign({ type: 'base' }, rules, def));
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const day = '^(\\d{4}-\\d{2}-\\d{2})?$';

    const settings = new Collection({
      type: 'base',
      name: 'settings',
      listRule: '',
      viewRule: '',
      createRule: null,
      updateRule: '',
      deleteRule: null,
      fields: [
        { name: 'currency', type: 'text', required: true, min: 3, max: 3, pattern: '^[A-Z]{3}$' },
        { name: 'currency_confirmed', type: 'bool' },
        { name: 'allow_negative', type: 'bool' },
        { name: 'auto_restock', type: 'bool' },
        { name: 'restock_sig', type: 'text', max: 4000 },
        { name: 'restock_asked_on', type: 'text', max: 10, pattern: day },
      ].concat(stamps),
    });
    app.save(settings);

    const categories = define(open, {
      name: 'categories',
      fields: [
        { name: 'name', type: 'text', required: true, max: 40 },
        { name: 'icon', type: 'text', max: 40 },
        { name: 'sort', type: 'number', onlyInt: true },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_categories_name ON categories (name COLLATE NOCASE)'],
    });
    app.save(categories);

    const locations = define(open, {
      name: 'locations',
      fields: [
        { name: 'name', type: 'text', required: true, max: 60 },
        { name: 'code', type: 'text', max: 32 },
        {
          name: 'kind',
          type: 'select',
          maxSelect: 1,
          values: ['site', 'room', 'area', 'shelf', 'bin', 'box', 'vehicle', 'other'],
        },
        { name: 'notes', type: 'text', max: 500 },
        { name: 'sort', type: 'number', onlyInt: true },
      ].concat(stamps),
      indexes: ["CREATE UNIQUE INDEX idx_locations_code ON locations (code COLLATE NOCASE) WHERE code != ''"],
    });
    app.save(locations);
    // A place sits inside another place (a shelf in a room in a site).
    const locs = app.findCollectionByNameOrId('locations');
    locs.fields.add(
      new RelationField({ name: 'parent', collectionId: locs.id, maxSelect: 1, cascadeDelete: false }),
    );
    locs.addIndex('idx_locations_parent', false, 'parent', '');
    app.save(locs);

    const suppliers = define(open, {
      name: 'suppliers',
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'contact', type: 'text', max: 80 },
        { name: 'email', type: 'text', max: 120 },
        { name: 'phone', type: 'text', max: 40 },
        { name: 'website', type: 'text', max: 200 },
        { name: 'lead_time_days', type: 'number', onlyInt: true, min: 0, max: 365 },
        { name: 'notes', type: 'text', max: 1000 },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_suppliers_name ON suppliers (name COLLATE NOCASE)'],
    });
    app.save(suppliers);

    const items = define(open, {
      name: 'items',
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'sku', type: 'text', max: 40 },
        {
          name: 'category',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('categories').id,
          cascadeDelete: false,
        },
        { name: 'unit', type: 'text', max: 16 },
        { name: 'fractional', type: 'bool' },
        {
          name: 'photo',
          type: 'file',
          maxSelect: 1,
          maxSize: 10 * 1024 * 1024,
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          thumbs: ['96x96', '480x480'],
        },
        { name: 'description', type: 'text', max: 2000 },
        { name: 'min_qty', type: 'number', min: 0 },
        { name: 'max_qty', type: 'number', min: 0 },
        { name: 'unit_cost', type: 'number', onlyInt: true, min: 0 },
        {
          name: 'supplier',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('suppliers').id,
          cascadeDelete: false,
        },
        { name: 'lead_time_days', type: 'number', onlyInt: true, min: 0, max: 365 },
        {
          name: 'default_location',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('locations').id,
          cascadeDelete: false,
        },
        { name: 'archived', type: 'bool' },
      ].concat(stamps),
      indexes: [
        "CREATE UNIQUE INDEX idx_items_sku ON items (sku COLLATE NOCASE) WHERE sku != ''",
        'CREATE INDEX idx_items_name ON items (name COLLATE NOCASE)',
        'CREATE INDEX idx_items_category ON items (category)',
      ],
    });
    app.save(items);

    const itemsId = app.findCollectionByNameOrId('items').id;
    const locationsId = app.findCollectionByNameOrId('locations').id;

    const codes = define(open, {
      name: 'codes',
      fields: [
        { name: 'code', type: 'text', required: true, max: 128 },
        { name: 'item', type: 'relation', required: true, maxSelect: 1, collectionId: itemsId, cascadeDelete: true },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_codes_code ON codes (code)', 'CREATE INDEX idx_codes_item ON codes (item)'],
    });
    app.save(codes);

    const stock = define(ledgerOnly, {
      name: 'stock',
      fields: [
        { name: 'item', type: 'relation', required: true, maxSelect: 1, collectionId: itemsId, cascadeDelete: true },
        {
          name: 'location',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: locationsId,
          cascadeDelete: true,
        },
        { name: 'qty', type: 'number' },
      ].concat(stamps),
      indexes: [
        'CREATE UNIQUE INDEX idx_stock_item_location ON stock (item, location)',
        'CREATE INDEX idx_stock_location ON stock (location)',
      ],
    });
    app.save(stock);

    const orders = define(open, {
      name: 'orders',
      fields: [
        { name: 'number', type: 'text', required: true, max: 20 },
        {
          name: 'supplier',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('suppliers').id,
          cascadeDelete: false,
        },
        { name: 'location', type: 'relation', maxSelect: 1, collectionId: locationsId, cascadeDelete: false },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft', 'ordered', 'partial', 'received', 'cancelled'],
        },
        { name: 'expected_on', type: 'text', max: 10, pattern: day },
        { name: 'ordered_on', type: 'text', max: 10, pattern: day },
        { name: 'received_on', type: 'text', max: 10, pattern: day },
        { name: 'closed_short', type: 'bool' },
        { name: 'note', type: 'text', max: 1000 },
        { name: 'origin', type: 'select', maxSelect: 1, values: ['you', 'agent', 'reorder'] },
        { name: 'agent_note', type: 'text', max: 2000 },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_orders_number ON orders (number)', 'CREATE INDEX idx_orders_status ON orders (status)'],
    });
    app.save(orders);

    const orderLines = define(open, {
      name: 'order_lines',
      fields: [
        {
          name: 'po',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('orders').id,
          cascadeDelete: true,
        },
        { name: 'item', type: 'relation', required: true, maxSelect: 1, collectionId: itemsId, cascadeDelete: true },
        { name: 'qty', type: 'number', min: 0 },
        { name: 'received', type: 'number', min: 0 },
        { name: 'unit_cost', type: 'number', onlyInt: true, min: 0 },
        { name: 'sort', type: 'number', onlyInt: true },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_order_lines_po ON order_lines (po)', 'CREATE INDEX idx_order_lines_item ON order_lines (item)'],
    });
    app.save(orderLines);

    const counts = define(open, {
      name: 'counts',
      fields: [
        { name: 'number', type: 'text', required: true, max: 20 },
        { name: 'location', type: 'relation', maxSelect: 1, collectionId: locationsId, cascadeDelete: false },
        { name: 'include_sub', type: 'bool' },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['counting', 'completed', 'cancelled'] },
        { name: 'blind', type: 'bool' },
        { name: 'note', type: 'text', max: 500 },
        { name: 'completed_on', type: 'text', max: 10, pattern: day },
        { name: 'batch', type: 'text', max: 24 },
        { name: 'summary', type: 'json', maxSize: 20000 },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_counts_number ON counts (number)', 'CREATE INDEX idx_counts_status ON counts (status)'],
    });
    app.save(counts);

    const countLines = define(open, {
      name: 'count_lines',
      fields: [
        {
          name: 'session',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('counts').id,
          cascadeDelete: true,
        },
        { name: 'item', type: 'relation', required: true, maxSelect: 1, collectionId: itemsId, cascadeDelete: true },
        {
          name: 'location',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: locationsId,
          cascadeDelete: true,
        },
        { name: 'expected', type: 'number' },
        { name: 'counted', type: 'number' },
        { name: 'counted_set', type: 'bool' },
      ].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_count_lines_key ON count_lines (session, item, location)'],
    });
    app.save(countLines);

    const documents = define(open, {
      name: 'documents',
      fields: [
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 20 * 1024 * 1024,
          mimeTypes: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'image/heic',
            'image/heif',
            'application/pdf',
          ],
          thumbs: ['240x320'],
        },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['waiting', 'reading', 'done', 'failed'] },
        { name: 'summary', type: 'text', max: 2000 },
        { name: 'error', type: 'text', max: 500 },
        {
          name: 'po',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('orders').id,
          cascadeDelete: false,
        },
        { name: 'batch', type: 'text', max: 24 },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['you', 'agent'] },
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_documents_status ON documents (status)'],
    });
    app.save(documents);

    const imports = define(open, {
      name: 'imports',
      fields: [
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 20 * 1024 * 1024 },
        { name: 'filename', type: 'text', max: 255 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['previewed', 'imported', 'undone'] },
        { name: 'rows', type: 'number', onlyInt: true },
        { name: 'added', type: 'number', onlyInt: true },
        { name: 'changed', type: 'number', onlyInt: true },
        { name: 'skipped', type: 'number', onlyInt: true },
        { name: 'mapping', type: 'json', maxSize: 20000 },
        { name: 'result', type: 'json', maxSize: 2000000 },
      ].concat(stamps),
    });
    app.save(imports);

    const movements = define(ledgerOnly, {
      name: 'movements',
      fields: [
        { name: 'item', type: 'relation', required: true, maxSelect: 1, collectionId: itemsId, cascadeDelete: true },
        {
          name: 'location',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: locationsId,
          cascadeDelete: true,
        },
        { name: 'qty', type: 'number' },
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['in', 'out', 'move', 'adjust', 'count'] },
        {
          name: 'reason',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'received',
            'returned',
            'found',
            'produced',
            'sold',
            'used',
            'damaged',
            'lost',
            'expired',
            'sample',
            'correction',
            'move',
            'count',
            'opening',
            'undo',
          ],
        },
        { name: 'batch', type: 'text', required: true, max: 24 },
        { name: 'ref_type', type: 'select', maxSelect: 1, values: ['order', 'count', 'import', 'document'] },
        { name: 'ref', type: 'text', max: 24 },
        { name: 'po_line', type: 'text', max: 24 },
        { name: 'unit_cost', type: 'number', onlyInt: true, min: 0 },
        { name: 'balance', type: 'number' },
        { name: 'actor', type: 'select', required: true, maxSelect: 1, values: ['you', 'agent', 'system'] },
        { name: 'note', type: 'text', max: 300 },
        { name: 'reverses', type: 'text', max: 24 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: [
        'CREATE INDEX idx_movements_item ON movements (item, created)',
        'CREATE INDEX idx_movements_batch ON movements (batch)',
        'CREATE INDEX idx_movements_created ON movements (created)',
        'CREATE INDEX idx_movements_location ON movements (location)',
        'CREATE INDEX idx_movements_reverses ON movements (reverses)',
      ],
    });
    app.save(movements);
  },
  (app) => {
    for (const name of [
      'movements',
      'imports',
      'documents',
      'count_lines',
      'counts',
      'order_lines',
      'orders',
      'stock',
      'codes',
      'items',
      'suppliers',
      'locations',
      'categories',
      'settings',
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (err) {
        console.log('rollback: ' + name + ' already gone: ' + err);
      }
    }
  },
);
