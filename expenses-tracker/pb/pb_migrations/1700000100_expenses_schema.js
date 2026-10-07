/// <reference path="../pb_data/types.d.ts" />
/**
 * Expenses tracker schema (personal, auth mode none: open rules, loopback only).
 *
 * Money is an INTEGER count of the currency's minor unit (cents for USD, yen
 * for JPY), never a float. The settings currency decides the exponent;
 * lib_money.js holds the ISO 4217 exponent table. Dates are plain
 * 'YYYY-MM-DD' text: a day, never an instant, so no timezone can shift them.
 *
 * The blueprint's starter `items` collection is removed here (its migration
 * stays: it is applied history).
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    const settings = new Collection({
      type: 'base',
      name: 'settings',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: null,
      fields: [
        { name: 'currency', type: 'text', required: true, min: 3, max: 3, pattern: '^[A-Z]{3}$' },
        { name: 'currency_confirmed', type: 'bool' },
        { name: 'monthly_budget', type: 'number', onlyInt: true, min: 0 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(settings);

    const categories = new Collection({
      type: 'base',
      name: 'categories',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 40 },
        { name: 'emoji', type: 'text', max: 16 },
        { name: 'budget', type: 'number', onlyInt: true, min: 0 },
        { name: 'sort', type: 'number', onlyInt: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_categories_name ON categories (name COLLATE NOCASE)'],
    });
    app.save(categories);

    const imports = new Collection({
      type: 'base',
      name: 'imports',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: null,
      fields: [
        {
          name: 'file',
          type: 'file',
          maxSelect: 1,
          maxSize: 20 * 1024 * 1024,
        },
        { name: 'filename', type: 'text', max: 255 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['previewed', 'imported', 'undone'] },
        { name: 'rows', type: 'number', onlyInt: true },
        { name: 'added', type: 'number', onlyInt: true },
        { name: 'skipped', type: 'number', onlyInt: true },
        { name: 'mapping', type: 'json', maxSize: 20000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(imports);

    const receipts = new Collection({
      type: 'base',
      name: 'receipts',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        {
          name: 'file',
          type: 'file',
          required: true,
          maxSelect: 1,
          maxSize: 15 * 1024 * 1024,
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
        { name: 'error', type: 'text', max: 500 },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['app', 'craftbot'] },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_receipts_status ON receipts (status)'],
    });
    app.save(receipts);

    const recurring = new Collection({
      type: 'base',
      name: 'recurring',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'note', type: 'text', required: true, max: 200 },
        { name: 'amount', type: 'number', onlyInt: true, min: 0 },
        {
          name: 'category',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('categories').id,
          cascadeDelete: false,
        },
        { name: 'cadence', type: 'select', required: true, maxSelect: 1, values: ['weekly', 'monthly', 'yearly'] },
        { name: 'start_date', type: 'text', required: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { name: 'next_date', type: 'text', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { name: 'count_added', type: 'number', onlyInt: true, min: 0 },
        { name: 'active', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(recurring);

    const expenses = new Collection({
      type: 'base',
      name: 'expenses',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'amount', type: 'number', onlyInt: true },
        { name: 'date', type: 'text', required: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { name: 'note', type: 'text', max: 200 },
        {
          name: 'category',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('categories').id,
          cascadeDelete: false,
        },
        {
          name: 'source',
          type: 'select',
          maxSelect: 1,
          values: ['app', 'craftbot', 'receipt', 'csv', 'recurring'],
        },
        {
          name: 'receipt',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('receipts').id,
          cascadeDelete: false,
        },
        {
          name: 'import',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('imports').id,
          cascadeDelete: false,
        },
        {
          name: 'recurring',
          type: 'relation',
          maxSelect: 1,
          collectionId: app.findCollectionByNameOrId('recurring').id,
          cascadeDelete: false,
        },
        { name: 'original_amount', type: 'number', onlyInt: true },
        { name: 'original_currency', type: 'text', max: 3 },
        { name: 'fx_rate', type: 'number' },
        { name: 'dedupe_key', type: 'text', max: 300 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_expenses_date ON expenses (date)',
        'CREATE INDEX idx_expenses_category ON expenses (category)',
        'CREATE INDEX idx_expenses_dedupe ON expenses (dedupe_key)',
      ],
    });
    app.save(expenses);
  },
  (app) => {
    for (const name of ['expenses', 'recurring', 'receipts', 'imports', 'categories', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (err) {
        console.log('rollback: ' + name + ' already gone: ' + err);
      }
    }
  },
);
