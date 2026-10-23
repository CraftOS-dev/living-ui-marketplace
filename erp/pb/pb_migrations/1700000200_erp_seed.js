/// <reference path="../pb_data/types.d.ts" />
/**
 * ERP seed: the settings row, the built-in roles, payment terms, and the
 * platform settings an ERP needs (request logs kept to warnings, rate limits
 * per person behind the share relays, a stricter limit on sign-in).
 *
 * The chart of accounts, taxes, currency, warehouse, leave types and pay
 * components come from the setup operation (setup.complete), because they
 * depend on the country and business type chosen there. No sample data.
 */
migrate(
  (app) => {
    const MODULES = ['sales', 'purchasing', 'inventory', 'manufacturing', 'accounting', 'banking', 'people', 'payroll', 'projects', 'reports'];
    const all = (level) => {
      const out = {};
      for (const m of MODULES) out[m] = level;
      return out;
    };
    const levels = (base, over) => Object.assign(all(base), over);

    /* -------------------------------------------------------- settings */
    const settings = new Record(app.findCollectionByNameOrId('settings'));
    settings.set('company_name', '');
    settings.set('base_currency', '');
    settings.set('fiscal_start_month', 1);
    settings.set('business_type', 'services');
    settings.set('modules', {
      sales: true,
      purchasing: true,
      inventory: true,
      manufacturing: false,
      accounting: true,
      banking: true,
      people: true,
      payroll: false,
      projects: true,
    });
    settings.set('setup_done', false);
    settings.set('prices_include_tax', false);
    settings.set('allow_negative_stock', false);
    settings.set('numbering', {
      quote: { prefix: 'QT-', width: 5 },
      sales_order: { prefix: 'SO-', width: 5 },
      delivery: { prefix: 'DN-', width: 5 },
      invoice: { prefix: 'INV-', width: 5 },
      credit_note: { prefix: 'CN-', width: 5 },
      purchase_order: { prefix: 'PO-', width: 5 },
      goods_receipt: { prefix: 'GR-', width: 5 },
      bill: { prefix: 'BILL-', width: 5 },
      supplier_credit: { prefix: 'SC-', width: 5 },
      payment_in: { prefix: 'RCV-', width: 5 },
      payment_out: { prefix: 'PAY-', width: 5 },
      journal: { prefix: 'JE-', width: 5 },
      stock_change: { prefix: 'ADJ-', width: 5 },
      claim: { prefix: 'EXP-', width: 5 },
      payroll: { prefix: 'PR-', width: 4 },
      build: { prefix: 'MO-', width: 5 },
      asset: { prefix: 'FA-', width: 4 },
      employee: { prefix: 'EMP-', width: 4 },
      party: { prefix: 'P', width: 5 },
      project: { prefix: 'PRJ-', width: 4 },
      item: { prefix: 'SKU-', width: 5 },
    });
    settings.set('defaults', {});
    settings.set('agent', {
      auto: {
        invoice: false,
        credit_note: false,
        bill: false,
        supplier_credit: false,
        delivery: false,
        goods_receipt: false,
        journal: false,
        stock_change: false,
        build: false,
      },
      limit: 0,
      chase_overdue: false,
      auto_reorder: false,
    });
    settings.set('jobs', {});
    settings.set('invoice_footer', '');
    settings.set('quote_terms', '');
    settings.set('quote_validity_days', 30);
    settings.set('working_days', [1, 2, 3, 4, 5]);
    app.save(settings);

    /* ----------------------------------------------------------- roles */
    const roles = app.findCollectionByNameOrId('roles');
    const ROLES = [
      ['owner', 'Owner', levels('full', {}), true, 'Everything, including members, roles and lock dates. Cannot be changed.'],
      ['admin', 'Administrator', levels('full', {}), true, 'Everything, including members and settings.'],
      [
        'accountant',
        'Accountant',
        levels('view', { sales: 'full', purchasing: 'full', accounting: 'full', banking: 'full', payroll: 'full', reports: 'full' }),
        false,
        'Books, banking, invoices, bills, payments, payroll and reports.',
      ],
      ['sales', 'Sales', levels('none', { sales: 'edit', inventory: 'view', projects: 'view', reports: 'view' }), false, 'Customers, quotes, orders and invoices (drafts).'],
      ['purchasing', 'Purchasing', levels('none', { purchasing: 'edit', inventory: 'edit', reports: 'view' }), false, 'Suppliers, purchase orders, goods receipts and bills (drafts).'],
      ['warehouse', 'Warehouse', levels('none', { inventory: 'edit', manufacturing: 'edit', sales: 'view', purchasing: 'view' }), false, 'Stock, deliveries, goods receipts and builds.'],
      ['hr', 'HR', levels('none', { people: 'full', payroll: 'full', reports: 'view' }), false, 'Employees, leave, claims and payroll.'],
      ['manager', 'Manager', levels('view', { payroll: 'none', projects: 'edit' }), false, 'Sees the business and approves their team.'],
      ['employee', 'Employee', levels('none', {}), false, 'Their own leave, expense claims, time and payslips.'],
      ['viewer', 'Viewer', levels('view', { payroll: 'none' }), false, 'Reads everything except payroll.'],
    ];
    ROLES.forEach((r, i) => {
      const rec = new Record(roles);
      rec.set('key', r[0]);
      rec.set('name', r[1]);
      rec.set('levels', r[2]);
      rec.set('admin', r[3]);
      rec.set('description', r[4]);
      rec.set('approval_limit', 0);
      rec.set('system', true);
      rec.set('sort', i + 1);
      app.save(rec);
    });

    /* --------------------------------------------------- payment terms */
    const terms = app.findCollectionByNameOrId('payment_terms');
    [
      ['Due on receipt', 0, false],
      ['Net 7', 7, false],
      ['Net 14', 14, false],
      ['Net 30', 30, false],
      ['Net 60', 60, false],
      ['End of next month', 0, true],
    ].forEach((t, i) => {
      const rec = new Record(terms);
      rec.set('name', t[0]);
      rec.set('days', t[1]);
      rec.set('end_of_month', t[2]);
      rec.set('archived', false);
      rec.set('sort', i + 1);
      app.save(rec);
    });

    /* ------------------------------------------------- platform settings */
    const s = app.settings();
    // Request logs: warnings and errors only (an ERP's traffic would grow
    // auxiliary.db by gigabytes); the app keeps its own audit trail.
    s.logs.minLevel = 4;
    s.logs.maxDays = 14;
    // People reach the app through CraftBot's LAN relay or the tunnel, which
    // all arrive from loopback: rate-limit by the address they forward.
    s.trustedProxy.headers = ['Cf-Connecting-Ip', 'X-Forwarded-For'];
    s.trustedProxy.useLeftmostIP = true;
    s.rateLimits.enabled = true;
    s.rateLimits.rules = [
      // The agent-app CLI signs in as the machine superuser on each call.
      { label: '*:auth', maxRequests: 240, duration: 60 },
      { label: '/api/collections/', maxRequests: 1200, duration: 60 },
      { label: '/api/ops/auth/', maxRequests: 30, duration: 60 },
      { label: '/api/ops/', maxRequests: 1800, duration: 60 },
      { label: '/api/_console', maxRequests: 120, duration: 60 },
      { label: '/api/_coverage', maxRequests: 600, duration: 60 },
    ];
    app.save(s);
  },
  (app) => {
    for (const name of ['payment_terms', 'roles', 'settings']) {
      for (const r of app.findRecordsByFilter(name, '', '', 0, 0)) app.delete(app.findRecordById(name, r.id));
    }
  },
);
