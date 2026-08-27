/// <reference path="../pb_data/types.d.ts" />
/**
 * Custom agent operations for Invoice & Subscription Tracker.
 */

// invoices.simulate-bill — simulate incoming email bill
routerAdd('POST', '/api/ops/invoices/simulate-bill', (e) => {
  const body = e.requestInfo().body || {};
  const preset = body.preset || 'aws';

  const presetsMap = {
    aws: {
      vendor: 'Amazon Web Services',
      amount: 248.5,
      currency: 'USD',
      payment_type: 'subscription',
      billing_frequency: 'monthly',
      category: 'Cloud Infrastructure',
      purpose: 'Monthly AWS compute cluster & storage bill',
      pdf_filename: 'AWS_Tax_Invoice_Aug2026.pdf',
    },
    openai: {
      vendor: 'OpenAI',
      amount: 42.0,
      currency: 'USD',
      payment_type: 'subscription',
      billing_frequency: 'monthly',
      category: 'AI & Developer Tools',
      purpose: 'ChatGPT Plus & GPT-4o API developer credit tier',
      pdf_filename: 'OpenAI_Invoice_Aug2026.pdf',
    },
    figma: {
      vendor: 'Figma',
      amount: 15.0,
      currency: 'USD',
      payment_type: 'subscription',
      billing_frequency: 'monthly',
      category: 'Design & Creative',
      purpose: 'Figma Pro design seat renewal',
      pdf_filename: 'Figma_Receipt_Aug2026.pdf',
    },
  };

  const p = presetsMap[preset] || presetsMap.aws;
  const nowStr = new Date().toISOString();

  const invsColl = e.app.findCollectionByNameOrId('invoices');
  const subsColl = e.app.findCollectionByNameOrId('subscriptions');
  const actsColl = e.app.findCollectionByNameOrId('activities');

  const inv = new Record(invsColl, {
    vendor: p.vendor,
    amount: p.amount,
    currency: p.currency,
    payment_type: p.payment_type,
    billing_frequency: p.billing_frequency,
    category: p.category,
    purpose: p.purpose,
    invoice_date: nowStr,
    invoice_number: 'INV-' + p.vendor.slice(0, 3).toUpperCase() + '-' + Date.now().toString().slice(-6),
    has_pdf_attachment: true,
    pdf_filename: p.pdf_filename,
    pdf_text_preview: 'RECEIPT / INVOICE\nVendor: ' + p.vendor + '\nAmount: $' + p.amount.toFixed(2) + ' USD\nDate: ' + nowStr + '\nStatus: Paid',
    confidence_score: 0.99,
    is_verified: true,
    line_items: [
      { description: p.purpose, quantity: 1, unitPrice: p.amount, amount: p.amount },
    ],
    notes: 'Simulated automated scan ingestion.',
  });
  e.app.save(inv);

  let subId = '';
  if (p.payment_type === 'subscription') {
    const existingSubs = e.app.findRecordsByFilter('subscriptions', 'vendor ~ {:v}', '', 1, 0, { v: p.vendor });
    if (existingSubs.length > 0) {
      subId = existingSubs[0].id;
    } else {
      const sub = new Record(subsColl, {
        name: p.vendor,
        vendor: p.vendor,
        amount: p.amount,
        currency: p.currency,
        billing_frequency: p.billing_frequency,
        category: p.category,
        purpose: p.purpose,
        status: 'active',
        last_billed_date: nowStr,
        auto_renew: true,
        icon_name: 'CreditCard',
      });
      e.app.save(sub);
      subId = sub.id;
    }
    inv.set('subscription_id', subId);
    e.app.save(inv);
  }

  const act = new Record(actsColl, {
    event_type: 'bill_simulated',
    title: 'Simulated Bill: ' + p.vendor,
    description: 'Simulated email bill received from ' + p.vendor + ' for $' + p.amount.toFixed(2),
    amount: p.amount,
    currency: p.currency,
    vendor: p.vendor,
  });
  e.app.save(act);

  return e.json(200, {
    success: true,
    invoice: inv,
    subscription_id: subId,
  });
});
