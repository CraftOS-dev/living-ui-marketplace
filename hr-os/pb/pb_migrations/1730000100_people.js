/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS people schema (kernel): employees and their employments, the
 * effective-dated records (job, pay, tax), bank accounts and identity
 * documents (numbers sealed with lib_seal: only a masked form is stored in
 * clear), documents with acknowledgement and skills.
 *
 * Effective dating: the row in effect on day D is the one with the greatest
 * effective_from <= D. One row per employment and day.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const CUR = '^([A-Z]{3})?$';
    const CC = '^([A-Z]{2})?$';
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
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
    const DOCS = IMAGES.concat(['image/heic', 'image/heif', 'application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
    const file = (name, max, mimes) => ({ name: name, type: 'file', maxSelect: 1, maxSize: max, mimeTypes: mimes, thumbs: [], protected: true });
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

    make(
      'employees',
      [
        req('number', 20),
        req('legal_name', 200),
        txt('preferred_name', 120),
        txt('family_name', 120),
        txt('given_name', 120),
        sel('name_order', ['family_first', 'given_first']),
        json('kana', 2000),
        file('photo', 5000000, IMAGES),
        day('birth_date'),
        txt('gender', 60),
        cc('nationality'),
        txt('personal_email', 160),
        txt('work_email', 160),
        txt('phone', 40),
        json('address', 4000),
        json('emergency', 20000),
        json('dependants', 20000),
        rel('member', 'members'),
        sel('status', ['pre_hire', 'active', 'on_leave', 'leaving', 'left'], true),
        bool('archived'),
        txt('notes', 4000),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_employees_number ON employees (number)',
        'CREATE INDEX idx_employees_status ON employees (status, archived)',
        "CREATE INDEX idx_employees_work_email ON employees (work_email) WHERE work_email != ''",
      ],
    );

    make(
      'employments',
      [
        rel('employee', 'employees', { required: true }),
        rel('entity', 'entities', { required: true }),
        req('number', 30),
        day('start_day', true),
        day('end_day'),
        day('notice_day'),
        day('probation_end'),
        sel('status', ['pre_hire', 'active', 'on_leave', 'notice', 'ended'], true),
        bool('primary'),
        txt('end_reason', 400),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_employments_number ON employments (number)',
        'CREATE INDEX idx_employments_employee ON employments (employee)',
        'CREATE INDEX idx_employments_entity ON employments (entity, status)',
        'CREATE INDEX idx_employments_days ON employments (start_day, end_day)',
      ],
    );

    make(
      'job_records',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('effective_from', true),
        txt('title', 160),
        rel('job_title', 'job_titles'),
        rel('department', 'departments'),
        rel('location', 'locations'),
        rel('manager', 'employees'),
        rel('grade', 'grades'),
        rel('employment_type', 'employment_types'),
        num('fte', { min: 0, max: 1.5 }),
        rel('schedule', 'work_schedules'),
        rel('calendar', 'holiday_calendars'),
        rel('cost_center', 'cost_centers'),
        sel('reason', ['hire', 'promotion', 'transfer', 'change', 'correction'], true),
        txt('note', 2000),
        rel('approved_by', 'members'),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_job_records_day ON job_records (employment, effective_from)',
        'CREATE INDEX idx_job_records_manager ON job_records (manager)',
        'CREATE INDEX idx_job_records_department ON job_records (department)',
      ],
    );

    make(
      'pay_records',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('effective_from', true),
        sel('basis', ['salary', 'hourly', 'daily'], true),
        int('amount_minor', { min: 0 }),
        cur('currency'),
        sel('per', ['year', 'month', 'week', 'day', 'hour'], true),
        txt('pay_schedule', 30),
        sel('reason', ['hire', 'raise', 'promotion', 'adjustment', 'correction', 'change'], true),
        txt('note', 2000),
        rel('approved_by', 'members'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_pay_records_day ON pay_records (employment, effective_from)'],
    );

    make(
      'tax_profiles',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        day('effective_from', true),
        cc('country'),
        json('packs', 4000),
        json('fields', 50000),
        txt('note', 2000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_tax_profiles_day ON tax_profiles (employment, effective_from)'],
    );

    make(
      'bank_accounts',
      [
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        txt('label', 80),
        cc('country'),
        cur('currency'),
        txt('bank_name', 160),
        txt('bank_code', 40),
        txt('branch_code', 40),
        txt('account_type', 40),
        txt('holder', 200),
        txt('number_sealed', 1000),
        txt('number_masked', 40),
        txt('iban_sealed', 1000),
        txt('iban_masked', 60),
        txt('swift', 20),
        json('split', 1000),
        sel('status', ['pending', 'active', 'retired', 'rejected'], true),
        rel('requested_by', 'members'),
        rel('approved_by', 'members'),
        txt('approved_at', 40),
        txt('approval', 30),
        int('sort'),
      ].concat(stamps),
      ['CREATE INDEX idx_bank_accounts_employee ON bank_accounts (employee, status)'],
    );

    make(
      'identity_docs',
      [
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        req('type', 40),
        cc('country'),
        txt('number_sealed', 1000),
        txt('number_masked', 40),
        day('issued'),
        day('expires'),
        file('file', 15000000, DOCS),
        txt('note', 1000),
      ].concat(stamps),
      ['CREATE INDEX idx_identity_docs_employee ON identity_docs (employee)', "CREATE INDEX idx_identity_docs_expires ON identity_docs (expires) WHERE expires != ''"],
    );

    make(
      'documents',
      [
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        rel('employment', 'employments'),
        txt('category', 60),
        req('title', 200),
        file('file', 25000000, DOCS),
        bool('visible_to_employee'),
        bool('needs_ack'),
        txt('acked_at', 40),
        day('expires'),
        sel('source', ['upload', 'letter', 'payslip', 'agent'], true),
        txt('note', 2000),
        rel('added_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_documents_employee ON documents (employee, category)', "CREATE INDEX idx_documents_expires ON documents (expires) WHERE expires != ''"],
    );

    make(
      'employee_skills',
      [
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        req('skill', 120),
        int('level', { min: 1, max: 5 }),
        rel('verified_by', 'members'),
        txt('note', 1000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_employee_skills ON employee_skills (employee, skill COLLATE NOCASE)'],
    );

    addFields('members', [rel('employee', 'employees')]);
    addFields('departments', [rel('head', 'employees'), rel('approver', 'employees')]);
    addFields('approvals', [rel('employment', 'employments')]);
  },
  (app) => {
    for (const [c, f] of [['members', 'employee'], ['departments', 'head'], ['departments', 'approver'], ['approvals', 'employment']]) {
      try {
        const col = app.findCollectionByNameOrId(c);
        col.fields.removeByName(f);
        app.save(col);
      } catch {
        /* already gone */
      }
    }
    for (const n of ['employee_skills', 'documents', 'identity_docs', 'bank_accounts', 'tax_profiles', 'pay_records', 'job_records', 'employments', 'employees']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
