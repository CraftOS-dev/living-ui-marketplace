/// <reference path="../pb_data/types.d.ts" />
/**
 * Seed initial workspace groups, subscriptions, invoices, and activity logs.
 */
migrate(
  (app) => {
    const groupsColl = app.findCollectionByNameOrId('groups');
    const subsColl = app.findCollectionByNameOrId('subscriptions');
    const invsColl = app.findCollectionByNameOrId('invoices');
    const actsColl = app.findCollectionByNameOrId('activities');

    // 1. Seed Workspace Group
    const grp = new Record(groupsColl, {
      name: 'Engineering & Cloud Stack',
      description: 'Infrastructure, AI APIs, hosting, and dev tools',
      color: '#3B82F6',
      icon: 'Server',
      currency: 'USD',
    });
    app.save(grp);

    // 2. Seed Subscriptions
    const subRecord1 = new Record(subsColl, {
      name: 'sub',
      vendor: 'sub',
      amount: 240.0,
      currency: 'USD',
      billing_frequency: 'monthly',
      category: 'Software & SaaS',
      purpose: 'Core cloud dev environment',
      status: 'active',
      group_id: grp.id,
      last_billed_date: '2026-08-01T00:00:00.000Z',
      next_renewal_date: '2026-09-01T00:00:00.000Z',
      auto_renew: true,
      icon_name: 'CreditCard',
    });
    app.save(subRecord1);

    const subRecord2 = new Record(subsColl, {
      name: 'sub1',
      vendor: 'sub1',
      amount: 598.0,
      currency: 'USD',
      billing_frequency: 'monthly',
      category: 'Software & SaaS',
      purpose: 'Enterprise AI & API throughput tier',
      status: 'active',
      group_id: grp.id,
      last_billed_date: '2026-08-01T00:00:00.000Z',
      next_renewal_date: '2026-09-01T00:00:00.000Z',
      auto_renew: true,
      icon_name: 'CreditCard',
    });
    app.save(subRecord2);

    // 3. Seed Invoices & Receipts
    const invoicesData = [
      { vendor: 'test', amount: 23.0, category: 'Software & SaaS', num: 'INV-TEST-001', purpose: 'Utility tool license' },
      { vendor: 'test1', amount: 45.0, category: 'Software & SaaS', num: 'INV-TEST-002', purpose: 'Database backup add-on' },
      { vendor: 'test2', amount: 354.0, category: 'Software & SaaS', num: 'INV-TEST-003', purpose: 'Compute cluster scale' },
      { vendor: 'test3', amount: 12.0, category: 'Software & SaaS', num: 'INV-TEST-004', purpose: 'Domain and DNS service' },
      { vendor: 'test4', amount: 254.0, category: 'Software & SaaS', num: 'INV-TEST-005', purpose: 'Security scan & SSL bundle' },
    ];

    invoicesData.forEach((item) => {
      const inv = new Record(invsColl, {
        vendor: item.vendor,
        amount: item.amount,
        currency: 'USD',
        payment_type: 'one_time',
        billing_frequency: 'none',
        category: item.category,
        purpose: item.purpose,
        invoice_date: '2026-08-15T12:00:00.000Z',
        invoice_number: item.num,
        group_id: grp.id,
        has_pdf_attachment: true,
        pdf_filename: `${item.vendor}_Receipt_Aug2026.pdf`,
        pdf_text_preview: `RECEIPT / INVOICE\nVendor: ${item.vendor}\nAmount: $${item.amount.toFixed(2)} USD\nDate: Aug 15, 2026\nStatus: Paid`,
        confidence_score: 0.99,
        is_verified: true,
        line_items: [
          { description: `${item.purpose} - Tier Standard`, quantity: 1, unitPrice: item.amount, amount: item.amount },
        ],
        notes: 'Reconciled automatically.',
      });
      app.save(inv);
    });

    // 4. Seed Activity Logs
    const activities = [
      { event_type: 'subscription_created', title: 'New Subscription: sub1', description: 'Created recurring subscription of USD 598.00/monthly.', amount: 598.0, vendor: 'sub1' },
      { event_type: 'subscription_created', title: 'New Subscription: sub', description: 'Created recurring subscription of USD 240.00/monthly.', amount: 240.0, vendor: 'sub' },
      { event_type: 'invoice_created', title: 'Invoice Added: test2', description: 'Recorded $354.00 invoice for Compute cluster scale.', amount: 354.0, vendor: 'test2' },
    ];

    activities.forEach((act) => {
      const actRecord = new Record(actsColl, {
        event_type: act.event_type,
        title: act.title,
        description: act.description,
        amount: act.amount,
        currency: 'USD',
        vendor: act.vendor,
        group_id: grp.id,
      });
      app.save(actRecord);
    });
  },
  (app) => {
    // Revert seeds if rolled back
  },
);
