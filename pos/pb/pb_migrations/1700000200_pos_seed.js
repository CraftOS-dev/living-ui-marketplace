/// <reference path="../pb_data/types.d.ts" />
/**
 * First-open data: the settings row (not yet set up: the first screen asks
 * for the business, its country and the owner's PIN), one register with its
 * counters, the daily order counter, and the three ways most shops are paid.
 * No products, staff or sample data.
 *
 * Rate limits: the platform's defaults, with room for a busy counter on the
 * operations (every LAN register, kitchen screen and display reaches the app
 * through the relay's single address, so they share one allowance). Set
 * here, so the platform's bootstrap leaves them as they are.
 */
migrate(
  (app) => {
    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('setup_done', false);
    s.set('business_name', '');
    s.set('region', 'OTHER');
    s.set('currency', 'USD');
    s.set('price_mode', 'exclusive');
    s.set('tax_rounding', 'half_up');
    s.set('cash_rounding', 0);
    s.set('order_types', []);
    s.set('default_order_type', '');
    s.set('service_charge_bp', 0);
    s.set('service_charge_scope', 'dine_in');
    s.set('receipt_header', '');
    s.set('receipt_footer', 'Thank you');
    s.set('receipt_width', '80');
    s.set('receipt_barcode', true);
    s.set('after_sale', 'ask');
    s.set('kitchen_enabled', false);
    s.set('order_numbers', true);
    s.set('lock_minutes', 0);
    s.set('cashier_discount_bp', 1000);
    s.set('day_cutoff_hour', 0);
    app.save(s);

    const reg = new Record(app.findCollectionByNameOrId('registers'));
    reg.set('name', 'Register 1');
    reg.set('code', 'R1');
    reg.set('z_seq', 0);
    reg.set('archived', false);
    app.save(reg);

    const counters = app.findCollectionByNameOrId('counters');
    for (const key of ['receipt:' + reg.id, 'training:' + reg.id, 'hash:' + reg.id, 'order']) {
      const c = new Record(counters);
      c.set('key', key);
      c.set('num', 0);
      c.set('text', '');
      app.save(c);
    }

    const settings = app.settings();
    settings.rateLimits.enabled = true;
    settings.rateLimits.rules = [
      { label: '*:auth', maxRequests: 30, duration: 60 },
      { label: '/api/collections/', maxRequests: 1200, duration: 60 },
      { label: '/api/ops/', maxRequests: 1800, duration: 60 },
      { label: '/api/_console', maxRequests: 120, duration: 60 },
      { label: '/api/_coverage', maxRequests: 600, duration: 60 },
    ];
    app.save(settings);

    const tenders = app.findCollectionByNameOrId('tenders');
    [
      ['Cash', 'cash', false],
      ['Card', 'card', false],
      ['QR pay', 'qr', false],
    ].forEach((t, i) => {
      const rec = new Record(tenders);
      rec.set('name', t[0]);
      rec.set('kind', t[1]);
      rec.set('ask_reference', t[2]);
      rec.set('active', true);
      rec.set('sort', i + 1);
      app.save(rec);
    });
  },
  (app) => {
    for (const name of ['tenders', 'counters', 'registers', 'settings']) {
      for (const r of app.findRecordsByFilter(name, '', '', 0, 0)) app.delete(app.findRecordById(name, r.id));
    }
  },
);
