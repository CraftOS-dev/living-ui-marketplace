/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS payroll schema (payroll-core): payroll settings per entity, pay
 * schedules, pay components, recurring items, one-off pay inputs, opening
 * year-to-date balances, compensation change requests, loans and their
 * repayments, benefit plans and enrolments, tax declarations (and tax
 * profile change requests), rule packs, pay runs, payslips and their lines,
 * salary holds and pay run notes.
 *
 * The other payroll collections (filings, bank_files, journal_exports) come
 * from payroll-out's migrations (1730004500 and up).
 *
 * Locked payslips and their lines never change: lib_payroll_runs refuses
 * every write to a payslip, line or input of a locked, paid or void run.
 * Every collection is closed to the raw API; people and your AI agent reach
 * the data through the app's operations only.
 *
 * Money: integers of the currency's minor unit. Days: 'YYYY-MM-DD' text.
 * Timestamps: PocketBase dates (UTC) or ISO text.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const MONTH = '^(\\d{4}-\\d{2})?$';
    const CUR = '^([A-Z]{3})?$';
    const CC = '^([A-Z]{2})?$';
    const CODE = '^[A-Z][A-Z0-9_]{0,39}$';
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
    const month = (name) => ({ name: name, type: 'text', max: 7, pattern: MONTH });
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const PROOFS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    const files = (name, maxSelect, max, mimes) => ({ name: name, type: 'file', maxSelect: maxSelect, maxSize: max, mimeTypes: mimes, thumbs: [], protected: true });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const addFields = (collection, fields) => {
      const c = app.findCollectionByNameOrId(collection);
      for (const f of fields) c.fields.add(new RelationField(f));
      app.save(c);
    };

    const KINDS = ['earning', 'deduction', 'employer', 'reimbursement', 'info'];
    const STAGES = ['pre', 'statutory', 'post'];
    const RUN_KINDS = ['regular', 'off_cycle', 'bonus', 'termination', 'correction', 'reimbursement'];
    const FREQ = ['monthly', 'semi_monthly', 'biweekly', 'weekly'];

    /* ----------------------------------------------------- set-up per entity */

    make(
      'payroll_settings',
      [
        rel('entity', 'entities', { required: true, cascadeDelete: true }),
        sel('proration', ['calendar_days', 'working_days', 'fixed_30'], true),
        sel('net_rounding', ['none', '0.05', '0.1', '1', '5', '10', '100'], true),
        sel('pay_method', ['bank', 'cash', 'cheque'], true),
        json('approver_steps', 4000),
        json('entity_fields', 50000),
        num('variance_pct', { min: 0, max: 1000 }),
        bool('require_approved_time'),
        bool('require_approved_leave'),
        int('bank_lead_days', { min: 0, max: 30 }),
        int('bank_changed_days', { min: 0, max: 90 }),
        day('go_live_day'),
        json('tax_approval_fields', 8000),
        sel('publish', ['scheduled', 'immediate', 'manual'], true),
        int('publish_hour', { min: 0, max: 23 }),
        bool('payslip_show_ytd'),
        bool('payslip_show_leave'),
        bool('email_payslips'),
        bool('warnings_need_ack'),
        txt('note', 2000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_payroll_settings_entity ON payroll_settings (entity)'],
    );

    make(
      'pay_schedules',
      [
        rel('entity', 'entities', { required: true, cascadeDelete: true }),
        req('name', 120),
        sel('frequency', FREQ, true),
        day('period_anchor', true),
        json('pay_day_rule', 2000),
        int('cutoff_days', { min: 0, max: 60 }),
        cur('currency'),
        bool('active'),
        json('reminder_days', 500),
        json('reminders', 20000),
        txt('note', 1000),
      ].concat(stamps),
      ['CREATE INDEX idx_pay_schedules_entity ON pay_schedules (entity, active)', 'CREATE UNIQUE INDEX idx_pay_schedules_name ON pay_schedules (entity, name COLLATE NOCASE)'],
    );

    make(
      'pay_components',
      [
        req('code', 40),
        req('name', 120),
        rel('entity', 'entities', { cascadeDelete: true }),
        cc('country'),
        sel('kind', KINDS, true),
        sel('stage', STAGES),
        sel('calc', ['fixed', 'percent', 'hours', 'days', 'formula', 'input', 'pack'], true),
        int('amount_minor'),
        num('percent'),
        txt('base', 80),
        txt('formula', 2000),
        num('multiplier', { min: 0, max: 100 }),
        json('tags', 4000),
        bool('taxable'),
        bool('recurring'),
        bool('prorate'),
        txt('gl_account', 60),
        txt('liability_account', 60),
        txt('payslip_group', 60),
        int('sort'),
        sel('role', ['basic', 'hourly', 'daily', 'overtime', 'unpaid', 'allowance', 'bonus', 'commission', 'reimbursement', 'advance', 'loan', 'arrears', 'encash', 'gratuity', 'notice', 'benefit', 'rounding', 'other']),
        txt('pack', 40),
        sel('source', ['builtin', 'pack', 'person', 'agent'], true),
        bool('archived'),
        txt('note', 1000),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_pay_components_code ON pay_components (entity, code)", 'CREATE INDEX idx_pay_components_role ON pay_components (entity, role)'],
    );

    /* --------------------------------------------------------- pay items */

    make(
      'recurring_items',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('component', 'pay_components', { required: true }),
        int('amount_minor'),
        num('percent'),
        cur('currency'),
        day('from_day', true),
        day('to_day'),
        txt('note', 1000),
        rel('created_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_recurring_items_employment ON recurring_items (employment, from_day)'],
    );

    make(
      'pay_inputs',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('component', 'pay_components', { required: true }),
        day('period_start', true),
        day('period_end', true),
        int('amount_minor'),
        num('qty'),
        int('rate_minor'),
        cur('currency'),
        sel('source', ['manual', 'time', 'leave', 'claims', 'agent', 'import', 'loan', 'advance', 'backpay', 'hold', 'correction'], true),
        txt('ref', 60),
        txt('note', 1000),
        txt('payrun', 30),
        sel('status', ['open', 'used', 'void'], true),
        json('detail', 20000),
        txt('batch', 30),
        rel('created_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_pay_inputs_employment ON pay_inputs (employment, status, period_start)', 'CREATE INDEX idx_pay_inputs_payrun ON pay_inputs (payrun)'],
    );

    make(
      'ytd_openings',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('day', true),
        cur('currency'),
        json('by_tag', 20000),
        json('by_code', 20000),
        sel('source', ['migration', 'previous_employer'], true),
        txt('note', 1000),
        rel('created_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_ytd_openings_employment ON ytd_openings (employment, day)'],
    );

    make(
      'comp_changes',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('effective_from', true),
        sel('basis', ['salary', 'hourly', 'daily'], true),
        int('amount_minor', { min: 0 }),
        cur('currency'),
        sel('per', ['year', 'month', 'week', 'day', 'hour'], true),
        txt('pay_schedule', 30),
        sel('reason', ['raise', 'promotion', 'adjustment', 'correction', 'change'], true),
        txt('note', 2000),
        sel('status', ['pending', 'approved', 'rejected', 'cancelled'], true),
        txt('approval', 30),
        txt('pay_record', 30),
        bool('retro'),
        sel('backpay', ['none', 'suggested', 'applied']),
        rel('requested_by', 'members'),
        txt('requested_actor', 10),
      ].concat(stamps),
      ['CREATE INDEX idx_comp_changes_employment ON comp_changes (employment, status)'],
    );

    make(
      'loans',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        sel('kind', ['salary_advance', 'personal', 'housing', 'vehicle', 'education', 'medical', 'other'], true),
        int('principal_minor', { min: 0 }),
        cur('currency'),
        num('interest_pct', { min: 0, max: 100 }),
        int('installments', { min: 1, max: 600 }),
        month('start_period'),
        int('installment_minor', { min: 0 }),
        int('balance_minor'),
        int('total_minor', { min: 0 }),
        sel('status', ['requested', 'active', 'closed', 'written_off', 'rejected', 'cancelled'], true),
        txt('approval', 30),
        txt('reason', 1000),
        txt('note', 2000),
        day('disbursed_day'),
        bool('paused'),
        rel('requested_by', 'members'),
        txt('requested_actor', 10),
      ].concat(stamps),
      ['CREATE INDEX idx_loans_employment ON loans (employment, status)'],
    );

    make(
      'benefit_plans',
      [
        rel('entity', 'entities', { required: true, cascadeDelete: true }),
        req('name', 120),
        sel('kind', ['health', 'dental', 'vision', 'life', 'retirement', 'transport', 'meal', 'wellness', 'other'], true),
        rel('employee_component', 'pay_components'),
        rel('employer_component', 'pay_components'),
        int('amount_minor', { min: 0 }),
        int('employer_amount_minor', { min: 0 }),
        num('percent', { min: 0, max: 100 }),
        num('employer_percent', { min: 0, max: 100 }),
        cur('currency'),
        bool('active'),
        txt('note', 1000),
      ].concat(stamps),
      ['CREATE INDEX idx_benefit_plans_entity ON benefit_plans (entity, active)'],
    );

    make(
      'benefit_enrollments',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('plan', 'benefit_plans', { required: true, cascadeDelete: true }),
        day('from_day', true),
        day('to_day'),
        int('amount_minor', { min: 0 }),
        int('employer_amount_minor', { min: 0 }),
        bool('override'),
        txt('coverage', 60),
        txt('note', 1000),
      ].concat(stamps),
      ['CREATE INDEX idx_benefit_enrollments_employment ON benefit_enrollments (employment, from_day)'],
    );

    make(
      'tax_declarations',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        sel('kind', ['investment', 'profile'], true),
        txt('fiscal_year', 9),
        cc('country'),
        txt('regime', 20),
        json('items', 50000),
        json('proofs', 50000),
        files('files', 20, 10000000, PROOFS),
        day('effective_from'),
        json('fields', 50000),
        json('packs', 4000),
        sel('status', ['draft', 'submitted', 'approved', 'rejected', 'cancelled'], true),
        txt('approval', 30),
        txt('note', 2000),
        txt('decided_note', 2000),
        txt('submitted_at', 40),
        txt('decided_at', 40),
        txt('tax_profile', 30),
        rel('created_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_tax_declarations_employment ON tax_declarations (employment, kind, fiscal_year)'],
    );

    make(
      'rule_packs',
      [
        req('code', 40),
        cc('country'),
        txt('region', 10),
        req('name', 200),
        req('version', 40),
        day('effective_from'),
        day('effective_to'),
        sel('status', ['draft', 'tested', 'active', 'retired'], true),
        json('body', 15000000),
        int('vectors_passed', { min: 0 }),
        int('vectors_total', { min: 0 }),
        txt('tested_at', 40),
        rel('activated_by', 'members'),
        txt('activated_at', 40),
        sel('source', ['builtin', 'agent', 'person'], true),
        txt('notes', 4000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_rule_packs_version ON rule_packs (code, version)', 'CREATE INDEX idx_rule_packs_status ON rule_packs (status, code)'],
    );

    /* ----------------------------------------------------------- pay runs */

    make(
      'payruns',
      [
        rel('entity', 'entities', { required: true }),
        rel('schedule', 'pay_schedules'),
        sel('kind', RUN_KINDS, true),
        req('number', 20),
        txt('label', 160),
        day('period_start', true),
        day('period_end', true),
        day('pay_date', true),
        day('cutoff_day'),
        sel('status', ['draft', 'calculating', 'calculated', 'approved', 'locked', 'paid', 'void'], true),
        int('employee_count', { min: 0 }),
        int('gross_minor'),
        int('deductions_minor'),
        int('employer_minor'),
        int('reimbursement_minor'),
        int('net_minor'),
        cur('currency'),
        json('issues', 200000),
        json('variance', 200000),
        txt('hash', 80),
        txt('input_hash', 80),
        rel('locked_by', 'members'),
        txt('locked_at', 40),
        txt('publish_at', 40),
        txt('published_at', 40),
        txt('note', 4000),
        txt('approval', 30),
        int('version', { min: 0 }),
        json('progress', 4000),
        json('scope', 200000),
        json('options', 4000),
        json('acknowledged', 200000),
        txt('paid_at', 40),
        rel('paid_by', 'members'),
        txt('void_reason', 1000),
        rel('voided_by', 'members'),
        txt('voided_at', 40),
        bool('year_end'),
        rel('created_by', 'members'),
        txt('created_actor', 10),
        int('calc_ms', { min: 0 }),
        txt('calculated_at', 40),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_payruns_number ON payruns (number)',
        'CREATE INDEX idx_payruns_entity ON payruns (entity, status, pay_date)',
        'CREATE INDEX idx_payruns_schedule ON payruns (schedule, period_start)',
      ],
    );
    addFields('payruns', [rel('corrects', 'payruns'), rel('replaces', 'payruns'), rel('replaced_by', 'payruns')]);

    make(
      'payslips',
      [
        rel('payrun', 'payruns', { required: true, cascadeDelete: true }),
        rel('employment', 'employments', { required: true }),
        rel('employee', 'employees', { required: true }),
        rel('entity', 'entities', { required: true }),
        sel('kind', RUN_KINDS, true),
        day('period_start', true),
        day('period_end', true),
        day('pay_date', true),
        cur('currency'),
        int('gross_minor'),
        int('pre_minor'),
        int('statutory_minor'),
        int('post_minor'),
        int('deductions_minor'),
        int('employer_minor'),
        int('reimbursement_minor'),
        int('net_minor'),
        json('ytd', 50000),
        sel('status', ['draft', 'calculated', 'locked', 'published', 'void'], true),
        txt('hash', 40),
        txt('input_hash', 80),
        json('issues', 50000),
        json('explain', 2000000),
        json('input', 2000000),
        json('packs', 4000),
        json('proration', 20000),
        json('variance', 20000),
        sel('pay_method', ['bank', 'cash', 'cheque'], true),
        json('bank_split', 20000),
        bool('held'),
        txt('published_at', 40),
        txt('viewed_at', 40),
        txt('notified_at', 40),
        int('calc_ms', { min: 0 }),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_payslips_run_employment ON payslips (payrun, employment)',
        'CREATE INDEX idx_payslips_employment ON payslips (employment, status, pay_date)',
        'CREATE INDEX idx_payslips_employee ON payslips (employee, status, pay_date)',
      ],
    );

    make(
      'payslip_lines',
      [
        rel('payslip', 'payslips', { required: true, cascadeDelete: true }),
        rel('payrun', 'payruns', { required: true, cascadeDelete: true }),
        rel('employment', 'employments', { required: true }),
        req('code', 40),
        txt('name', 200),
        sel('kind', KINDS, true),
        sel('stage', STAGES),
        int('amount_minor'),
        num('qty'),
        num('rate'),
        int('base_minor'),
        txt('pack', 40),
        txt('pack_version', 40),
        int('step'),
        txt('phase', 20),
        sel('source', ['input', 'pack'], true),
        json('explain', 200000),
        json('tags', 4000),
        txt('component', 30),
        txt('ref', 60),
        txt('ref_kind', 30),
        txt('payee', 80),
        txt('filing', 60),
        txt('payslip_group', 60),
        int('sort'),
      ].concat(stamps),
      ['CREATE INDEX idx_payslip_lines_payslip ON payslip_lines (payslip, sort)', 'CREATE INDEX idx_payslip_lines_run ON payslip_lines (payrun, code)', 'CREATE INDEX idx_payslip_lines_employment ON payslip_lines (employment, code)'],
    );

    make(
      'loan_repayments',
      [
        rel('loan', 'loans', { required: true, cascadeDelete: true }),
        rel('employment', 'employments', { required: true }),
        rel('payrun', 'payruns'),
        rel('payslip', 'payslips'),
        day('day', true),
        int('amount_minor'),
        sel('kind', ['payroll', 'manual', 'reversal', 'writeoff'], true),
        txt('note', 1000),
        rel('recorded_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_loan_repayments_loan ON loan_repayments (loan, day)'],
    );

    make(
      'salary_holds',
      [
        rel('employment', 'employments', { required: true }),
        rel('payrun', 'payruns', { required: true, cascadeDelete: true }),
        rel('payslip', 'payslips'),
        int('amount_minor'),
        cur('currency'),
        txt('reason', 1000),
        sel('status', ['held', 'released', 'cancelled'], true),
        rel('released_payrun', 'payruns'),
        txt('released_at', 40),
        rel('released_by', 'members'),
        sel('release_via', ['payrun', 'outside']),
        txt('note', 1000),
        rel('held_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_salary_holds_employment ON salary_holds (employment, status)', 'CREATE INDEX idx_salary_holds_payrun ON salary_holds (payrun)'],
    );

    make(
      'payrun_notes',
      [
        rel('payrun', 'payruns', { required: true, cascadeDelete: true }),
        rel('employment', 'employments'),
        sel('actor', ['person', 'agent', 'system'], true),
        rel('member', 'members'),
        sel('kind', ['note', 'review', 'flag'], true),
        sel('severity', ['info', 'warning', 'blocker']),
        txt('code', 60),
        txt('body', 20000),
        bool('resolved'),
        rel('resolved_by', 'members'),
        txt('job', 30),
      ].concat(stamps),
      ['CREATE INDEX idx_payrun_notes_run ON payrun_notes (payrun, created)'],
    );

    // Default approval flows of the payroll kinds (a person changes them in
    // Settings; a role step also reaches the owners, and nobody approves
    // their own request).
    const flows = app.findCollectionByNameOrId('approval_flows');
    for (const [kind, steps, note] of [
      ['payrun', [{ type: 'role', role: 'finance' }], 'Pay runs: finance (or an owner) approves; the preparer never approves their own run.'],
      ['pay_change', [{ type: 'role', role: 'payroll_admin' }], 'Pay changes: a payroll administrator (or an owner) approves.'],
      ['loan', [{ type: 'manager' }, { type: 'role', role: 'payroll_admin' }], 'Employee loans: the manager, then a payroll administrator.'],
      ['tax_declaration', [{ type: 'role', role: 'payroll_admin' }], 'Tax declarations and tax profile changes: a payroll administrator.'],
    ]) {
      const r = new Record(flows);
      r.set('kind', kind);
      r.set('entity', '');
      r.set('department', '');
      r.set('steps', steps);
      r.set('auto', {});
      r.set('active', true);
      r.set('note', note);
      app.save(r);
    }
  },
  (app) => {
    try {
      for (const r of app.findRecordsByFilter('approval_flows', "kind = 'payrun' || kind = 'pay_change' || kind = 'loan' || kind = 'tax_declaration'", '', 0, 0)) app.delete(r);
    } catch {
      /* already gone */
    }
    for (const n of ['payrun_notes', 'salary_holds', 'loan_repayments', 'payslip_lines', 'payslips']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
    try {
      const col = app.findCollectionByNameOrId('payruns');
      for (const f of ['corrects', 'replaces', 'replaced_by']) col.fields.removeByName(f);
      app.save(col);
    } catch {
      /* already gone */
    }
    for (const n of ['payruns', 'rule_packs', 'tax_declarations', 'benefit_enrollments', 'benefit_plans', 'loans', 'comp_changes', 'ytd_openings', 'pay_inputs', 'recurring_items', 'pay_components', 'pay_schedules', 'payroll_settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
