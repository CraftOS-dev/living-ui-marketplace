/// <reference path="../pb_data/types.d.ts" />
/**
 * Invoice & Subscription Tracker Schema
 * Collections: groups, subscriptions, invoices, activities
 */
migrate(
  (app) => {
    // 1. Workspace Groups
    const groups = new Collection({
      type: 'base',
      name: 'groups',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        { name: 'description', type: 'text', max: 1000 },
        { name: 'color', type: 'text', max: 50 },
        { name: 'icon', type: 'text', max: 50 },
        { name: 'currency', type: 'text', max: 10 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(groups);

    // 2. Subscriptions
    const subscriptions = new Collection({
      type: 'base',
      name: 'subscriptions',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        { name: 'vendor', type: 'text', required: true, max: 200 },
        { name: 'amount', type: 'number', required: true },
        { name: 'currency', type: 'text', max: 10 },
        { name: 'billing_frequency', type: 'select', maxSelect: 1, values: ['monthly', 'yearly', 'weekly', 'quarterly'] },
        { name: 'category', type: 'text', max: 100 },
        { name: 'purpose', type: 'text', max: 1000 },
        { name: 'status', type: 'select', maxSelect: 1, values: ['active', 'paused'] },
        { name: 'group_id', type: 'text', max: 50 },
        { name: 'last_billed_date', type: 'text', max: 50 },
        { name: 'next_renewal_date', type: 'text', max: 50 },
        { name: 'auto_renew', type: 'bool' },
        { name: 'icon_name', type: 'text', max: 50 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(subscriptions);

    // 3. Invoices & Receipts
    const invoices = new Collection({
      type: 'base',
      name: 'invoices',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'vendor', type: 'text', required: true, max: 200 },
        { name: 'amount', type: 'number', required: true },
        { name: 'currency', type: 'text', max: 10 },
        { name: 'payment_type', type: 'select', maxSelect: 1, values: ['one_time', 'subscription'] },
        { name: 'billing_frequency', type: 'text', max: 50 },
        { name: 'category', type: 'text', max: 100 },
        { name: 'purpose', type: 'text', max: 1000 },
        { name: 'invoice_date', type: 'text', max: 50 },
        { name: 'invoice_number', type: 'text', max: 100 },
        { name: 'group_id', type: 'text', max: 50 },
        { name: 'has_pdf_attachment', type: 'bool' },
        { name: 'pdf_filename', type: 'text', max: 255 },
        { name: 'pdf_text_preview', type: 'text', max: 5000 },
        { name: 'pdf_data_base64', type: 'text', max: 500000 },
        { name: 'line_items', type: 'json' },
        { name: 'notes', type: 'text', max: 2000 },
        { name: 'subscription_id', type: 'text', max: 50 },
        { name: 'confidence_score', type: 'number' },
        { name: 'is_verified', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(invoices);

    // 4. Activity Logs
    const activities = new Collection({
      type: 'base',
      name: 'activities',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'event_type', type: 'text', required: true, max: 100 },
        { name: 'title', type: 'text', required: true, max: 200 },
        { name: 'description', type: 'text', max: 1000 },
        { name: 'amount', type: 'number' },
        { name: 'currency', type: 'text', max: 10 },
        { name: 'vendor', type: 'text', max: 200 },
        { name: 'group_id', type: 'text', max: 50 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(activities);
  },
  (app) => {
    ['activities', 'invoices', 'subscriptions', 'groups'].forEach((name) => {
      try {
        const c = app.findCollectionByNameOrId(name);
        if (c) app.delete(c);
      } catch (e) {
        // ignore
      }
    });
  },
);
