/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS expenses schema: categories and the policy per legal entity, travel
 * requests, employee advances with their settlements, expense claims and
 * their lines (each with an optional receipt your AI agent can read).
 *
 * Money is integer minor units of the currency named with it. A line keeps
 * its own amount and currency, the rate of the day to the claim currency
 * and the converted base amount; the claim currency is the pay currency of
 * the employment's entity. Mileage rates are minor units per km or mile and
 * may carry a fraction of a minor unit (72.5 US cents a mile); every amount
 * computed from them is rounded to whole minor units.
 *
 * Every collection is closed to the raw API (rules null): screens and your
 * AI agent use the operations (cat_expenses_*.js).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const CUR = '^([A-Z]{3})?$';
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const num = (name, extra) => Object.assign({ name: name, type: 'number' }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const day = (name, required) => ({ name: name, type: 'text', max: 10, pattern: DAY, required: required === true });
    const cur = (name, required) => ({ name: name, type: 'text', max: 3, pattern: CUR, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const RECEIPTS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    const file = (name, max, mimes) => ({ name: name, type: 'file', maxSelect: 1, maxSize: max, mimeTypes: mimes, thumbs: [], protected: true });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };

    make(
      'expense_categories',
      [
        rel('entity', 'entities', { required: true, cascadeDelete: true }),
        req('code', 40),
        req('name', 120),
        txt('description', 400),
        txt('icon', 40),
        sel('kind', ['standard', 'mileage'], true),
        int('limit_minor', { min: 0 }),
        int('per_day_limit_minor', { min: 0 }),
        sel('receipt_rule', ['always', 'over', 'never'], true),
        int('receipt_over_minor', { min: 0 }),
        num('mileage_rate_minor', { min: 0 }),
        sel('unit', ['km', 'mile']),
        bool('taxable'),
        txt('component', 30),
        txt('gl_account', 60),
        int('sort', { min: 0 }),
        bool('archived'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_expense_categories_code ON expense_categories (entity, code)'],
    );

    make(
      'expense_policies',
      [
        rel('entity', 'entities', { required: true, cascadeDelete: true }),
        int('finance_over_minor', { min: 0 }),
        int('max_age_days', { min: 0, max: 3650 }),
        bool('flag_weekends'),
        sel('pay_via', ['payroll', 'bank'], true),
        sel('advance_pay_via', ['payroll', 'bank'], true),
        sel('advance_recover_via', ['payroll', 'claim'], true),
        int('recover_after_days', { min: 0, max: 730 }),
        txt('note', 2000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_expense_policies_entity ON expense_policies (entity)'],
    );

    make(
      'travel_requests',
      [
        req('number', 20),
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true }),
        rel('entity', 'entities', { required: true }),
        sel('purpose', ['client_visit', 'conference', 'training', 'internal_meeting', 'sales', 'relocation', 'other'], true),
        txt('details', 2000),
        day('from_day', true),
        day('to_day', true),
        json('destinations', 8000),
        json('itinerary', 30000),
        json('costs', 10000),
        int('estimate_minor', { min: 0 }),
        cur('currency', true),
        sel('status', ['draft', 'requested', 'approved', 'rejected', 'cancelled'], true),
        rel('approval', 'approvals'),
        txt('submitted_at', 40),
        txt('decided_at', 40),
        txt('decided_note', 2000),
        rel('created_by', 'members'),
        sel('actor', ['person', 'agent', 'system']),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_travel_requests_number ON travel_requests (number)',
        'CREATE INDEX idx_travel_requests_employment ON travel_requests (employment, status)',
        'CREATE INDEX idx_travel_requests_entity ON travel_requests (entity, status)',
      ],
    );

    make(
      'advances',
      [
        req('number', 20),
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true }),
        rel('entity', 'entities', { required: true }),
        rel('travel', 'travel_requests'),
        req('purpose', 600),
        cur('currency', true),
        int('amount_minor', { min: 0 }),
        int('balance_minor', { min: 0 }),
        sel('status', ['requested', 'approved', 'paid', 'settled', 'rejected', 'cancelled'], true),
        rel('approval', 'approvals'),
        sel('pay_via', ['payroll', 'bank'], true),
        sel('recover_via', ['payroll', 'claim'], true),
        day('recover_from'),
        day('needed_by'),
        day('approved_day'),
        txt('decided_at', 40),
        txt('decided_note', 2000),
        txt('paid_at', 40),
        day('paid_day'),
        txt('paid_reference', 120),
        rel('paid_by', 'members'),
        txt('payrun', 30),
        rel('requested_by', 'members'),
        sel('actor', ['person', 'agent', 'system']),
        txt('note', 2000),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_advances_number ON advances (number)',
        'CREATE INDEX idx_advances_employment ON advances (employment, status)',
        'CREATE INDEX idx_advances_entity ON advances (entity, status)',
      ],
    );

    make(
      'claims',
      [
        req('number', 20),
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true }),
        rel('entity', 'entities', { required: true }),
        txt('title', 160),
        cur('currency', true),
        int('total_minor', { min: 0 }),
        int('approved_minor', { min: 0 }),
        int('advance_applied_minor', { min: 0 }),
        sel('status', ['draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled'], true),
        sel('pay_via', ['payroll', 'bank'], true),
        txt('payrun', 30),
        sel('paid_via', ['payroll', 'bank', 'advance']),
        txt('paid_reference', 120),
        rel('paid_by', 'members'),
        txt('paid_at', 40),
        day('paid_day'),
        rel('advance', 'advances'),
        rel('travel', 'travel_requests'),
        rel('approval', 'approvals'),
        txt('submitted_at', 40),
        txt('decided_at', 40),
        day('approved_day'),
        txt('decided_note', 2000),
        json('flags', 4000),
        int('flag_count', { min: 0 }),
        int('line_count', { min: 0 }),
        txt('note', 2000),
        rel('created_by', 'members'),
        sel('actor', ['person', 'agent', 'system']),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_claims_number ON claims (number)',
        'CREATE INDEX idx_claims_employment ON claims (employment, status)',
        'CREATE INDEX idx_claims_entity ON claims (entity, status)',
        'CREATE INDEX idx_claims_status ON claims (status, approved_day)',
      ],
    );

    make(
      'claim_lines',
      [
        rel('claim', 'claims', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true }),
        rel('entity', 'entities', { required: true }),
        day('day', true),
        rel('category', 'expense_categories'),
        txt('merchant', 160),
        txt('description', 1000),
        txt('attendees', 600),
        int('amount_minor', { min: 0 }),
        cur('currency', true),
        num('fx_rate', { min: 0 }),
        day('fx_day'),
        txt('fx_source', 80),
        int('base_minor', { min: 0 }),
        int('tax_minor', { min: 0 }),
        file('receipt', 10000000, RECEIPTS),
        sel('receipt_status', ['none', 'waiting', 'reading', 'read', 'failed'], true),
        num('distance', { min: 0 }),
        sel('unit', ['km', 'mile']),
        num('rate_minor', { min: 0 }),
        json('flags', 8000),
        int('flag_count', { min: 0 }),
        txt('reason', 1000),
        json('agent_read', 8000),
        json('agent_flags', 8000),
        json('edited', 2000),
        sel('status', ['included', 'rejected'], true),
        txt('reject_reason', 1000),
        rel('rejected_by', 'members'),
        int('sort', { min: 0 }),
      ].concat(stamps),
      [
        'CREATE INDEX idx_claim_lines_claim ON claim_lines (claim, sort)',
        'CREATE INDEX idx_claim_lines_employee_day ON claim_lines (employee, day)',
        'CREATE INDEX idx_claim_lines_receipt ON claim_lines (receipt_status)',
      ],
    );

    make(
      'advance_settlements',
      [
        rel('advance', 'advances', { required: true, cascadeDelete: true }),
        rel('claim', 'claims'),
        sel('kind', ['claim', 'payroll', 'repayment'], true),
        int('amount_minor', { min: 0 }),
        day('day', true),
        txt('payrun', 30),
        txt('reference', 120),
        txt('note', 1000),
        rel('by', 'members'),
        sel('actor', ['person', 'agent', 'system']),
      ].concat(stamps),
      ['CREATE INDEX idx_advance_settlements_advance ON advance_settlements (advance)', 'CREATE INDEX idx_advance_settlements_payrun ON advance_settlements (payrun)'],
    );

    // The default approval flows of the expenses kinds (people change them in Settings).
    const flows = [
      ['claim', [{ type: 'manager' }], 'The manager approves; finance also approves a claim at or above the finance amount of its entity (Expenses settings).'],
      ['advance', [{ type: 'manager' }, { type: 'role', role: 'finance' }], 'The manager, then finance: an advance is money paid before it is spent.'],
      ['travel', [{ type: 'manager' }], 'The manager approves the trip and its estimate.'],
    ];
    for (const [kind, steps, note] of flows) {
      const f = new Record(app.findCollectionByNameOrId('approval_flows'));
      f.set('kind', kind);
      f.set('steps', steps);
      f.set('auto', {});
      f.set('active', true);
      f.set('note', note);
      app.save(f);
    }
  },
  (app) => {
    try {
      for (const f of app.findRecordsByFilter('approval_flows', "kind = 'claim' || kind = 'advance' || kind = 'travel'", '', 0, 0)) app.delete(f);
    } catch {
      /* the kernel tables are gone already */
    }
    for (const name of ['advance_settlements', 'claim_lines', 'claims', 'advances', 'travel_requests', 'expense_policies', 'expense_categories']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
