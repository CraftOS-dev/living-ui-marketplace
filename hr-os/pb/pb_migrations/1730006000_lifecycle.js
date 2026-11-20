/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS lifecycle schema: onboarding and offboarding checklists (templates,
 * checklists, tasks), letters (templates and issued letters, stored as
 * documents of the person), separations with the exit interview, assets,
 * the employee handbook (pages, published versions, acknowledgements) and
 * grievances.
 *
 * Every collection is closed to the raw API (rules null): screens and your
 * AI agent use the lifecycle operations. Also seeds the default approval
 * flow of the `separation` kind (the manager, then HR), as the kernel seeds
 * the bank account flow; owners change it in Settings, Approvals.
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
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const day = (name, required) => ({ name: name, type: 'text', max: 10, pattern: DAY, required: required === true });
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const ACTOR = ['person', 'agent', 'system'];
    const LETTER_KINDS = ['offer', 'appointment', 'confirmation', 'experience', 'salary_certificate', 'warning', 'relieving', 'custom'];

    make(
      'checklist_templates',
      [
        sel('kind', ['onboarding', 'offboarding', 'custom'], true),
        req('name', 120),
        rel('entity', 'entities'),
        cc('country'),
        txt('description', 1000),
        json('tasks', 80000),
        bool('is_default'),
        bool('builtin'),
        bool('archived'),
        rel('created_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_cltpl_entity ON checklist_templates (entity, kind, archived)'],
    );

    make(
      'separations',
      [
        req('number', 20),
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        rel('entity', 'entities'),
        sel('kind', ['resignation', 'termination', 'retirement', 'end_of_contract', 'death', 'other'], true),
        day('notice_day'),
        day('last_day', true),
        txt('reason', 4000),
        sel('reason_code', ['better_opportunity', 'compensation', 'career_change', 'relocation', 'personal', 'health', 'study', 'performance', 'conduct', 'redundancy', 'restructuring', 'probation', 'contract_end', 'retirement', 'death', 'other']),
        sel('rehire_eligible', ['yes', 'no', 'unsure']),
        json('exit_interview', 40000),
        txt('settlement_payrun', 30),
        sel('status', ['pending', 'approved', 'rejected', 'withdrawn', 'completed'], true),
        txt('approval', 30),
        rel('requested_by', 'members'),
        sel('requested_actor', ACTOR),
        txt('decided_at', 40),
        txt('completed_at', 40),
        txt('hr_note', 4000),
        json('events', 8000),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_separations_number ON separations (number)',
        'CREATE INDEX idx_separations_employment ON separations (employment, status)',
        'CREATE INDEX idx_separations_last ON separations (status, last_day)',
      ],
    );

    make(
      'checklists',
      [
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        rel('entity', 'entities'),
        sel('kind', ['onboarding', 'offboarding', 'custom'], true),
        rel('template', 'checklist_templates'),
        req('name', 120),
        sel('status', ['open', 'done', 'cancelled'], true),
        day('anchor_day', true),
        rel('separation', 'separations'),
        json('first_day', 4000),
        rel('started_by', 'members'),
        sel('started_actor', ACTOR),
        txt('done_at', 40),
        txt('note', 2000),
      ].concat(stamps),
      ['CREATE INDEX idx_checklists_employment ON checklists (employment, kind, status)', 'CREATE INDEX idx_checklists_status ON checklists (status, anchor_day)'],
    );

    make(
      'tasks',
      [
        rel('checklist', 'checklists', { required: true, cascadeDelete: true }),
        rel('employment', 'employments', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        rel('entity', 'entities'),
        req('title', 200),
        txt('description', 2000),
        sel('assignee_kind', ['hr', 'manager', 'it', 'employee', 'member', 'agent'], true),
        rel('assignee_member', 'members'),
        day('due'),
        sel('status', ['open', 'done', 'skipped'], true),
        sel('kind', ['task', 'document', 'signature'], true),
        txt('document_category', 60),
        rel('document', 'documents'),
        txt('link', 300),
        int('sort'),
        txt('template_key', 40),
        txt('done_at', 40),
        rel('done_by', 'members'),
        sel('done_actor', ACTOR),
        txt('note', 2000),
        day('reminded_on'),
      ].concat(stamps),
      [
        'CREATE INDEX idx_tasks_checklist ON tasks (checklist, sort)',
        'CREATE INDEX idx_tasks_status_due ON tasks (status, due)',
        'CREATE INDEX idx_tasks_member ON tasks (assignee_member, status)',
        'CREATE INDEX idx_tasks_employee ON tasks (employee, status)',
      ],
    );

    make(
      'letter_templates',
      [
        sel('kind', LETTER_KINDS, true),
        req('name', 120),
        cc('country'),
        rel('entity', 'entities'),
        sel('language', ['en', 'ja']),
        txt('description', 400),
        txt('body', 30000, { required: true }),
        bool('needs_ack'),
        bool('builtin'),
        bool('archived'),
      ].concat(stamps),
      ['CREATE INDEX idx_lettpl_kind ON letter_templates (kind, country, archived)'],
    );

    make(
      'letters',
      [
        req('number', 20),
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        rel('employment', 'employments', { cascadeDelete: true }),
        rel('entity', 'entities'),
        rel('template', 'letter_templates'),
        sel('kind', LETTER_KINDS, true),
        req('title', 200),
        txt('body', 30000),
        txt('issued_body', 40000),
        day('letter_day'),
        sel('status', ['draft', 'issued', 'void'], true),
        rel('document', 'documents'),
        bool('needs_ack'),
        txt('issued_at', 40),
        rel('issued_by', 'members'),
        rel('drafted_by', 'members'),
        sel('drafted_actor', ACTOR),
        json('fields', 20000),
        txt('void_reason', 400),
        txt('note', 2000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_letters_number ON letters (number)', 'CREATE INDEX idx_letters_employee ON letters (employee, status)', 'CREATE INDEX idx_letters_status ON letters (status)'],
    );

    make(
      'exit_forms',
      [req('name', 120), rel('entity', 'entities'), json('questions', 20000), bool('is_default'), bool('builtin'), bool('archived')].concat(stamps),
    );

    make(
      'assets',
      [
        req('tag', 40),
        req('name', 160),
        sel('category', ['laptop', 'phone', 'tablet', 'monitor', 'peripheral', 'access_card', 'keys', 'vehicle', 'uniform', 'furniture', 'license', 'other'], true),
        txt('serial', 120),
        rel('entity', 'entities'),
        rel('employee', 'employees'),
        sel('status', ['in_stock', 'issued', 'retired'], true),
        sel('condition', ['new', 'good', 'fair', 'damaged', 'lost']),
        day('issued_day'),
        day('returned_day'),
        day('purchased_day'),
        int('value_minor', { min: 0 }),
        cur('currency'),
        txt('note', 2000),
        json('history', 60000),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_assets_tag ON assets (tag)', 'CREATE INDEX idx_assets_employee ON assets (employee, status)', 'CREATE INDEX idx_assets_status ON assets (status, category)'],
    );

    make(
      'handbook',
      [
        req('title', 200),
        txt('category', 60),
        rel('entity', 'entities'),
        txt('body', 100000),
        bool('needs_ack'),
        int('published_version', { min: 0 }),
        txt('published_at', 40),
        txt('published_title', 200),
        txt('published_body', 100000),
        int('sort'),
        bool('archived'),
        rel('updated_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_handbook_sort ON handbook (archived, sort)'],
    );

    make(
      'handbook_versions',
      [
        rel('page', 'handbook', { required: true, cascadeDelete: true }),
        int('version', { min: 1 }),
        req('title', 200),
        txt('body', 100000),
        bool('needs_ack'),
        rel('published_by', 'members'),
        txt('note', 400),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hbver_page ON handbook_versions (page, version)'],
    );

    make(
      'handbook_acks',
      [
        rel('page', 'handbook', { required: true, cascadeDelete: true }),
        int('version', { min: 1 }),
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        rel('member', 'members'),
        txt('acked_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hback_unique ON handbook_acks (page, version, employee)', 'CREATE INDEX idx_hback_employee ON handbook_acks (employee)'],
    );

    make(
      'grievance_types',
      [req('code', 40), req('name', 120), txt('description', 400), bool('confidential'), bool('archived'), int('sort')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_grvtype_code ON grievance_types (code)'],
    );

    make(
      'grievances',
      [
        req('number', 20),
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        rel('employment', 'employments'),
        rel('entity', 'entities'),
        rel('type', 'grievance_types'),
        req('subject', 200),
        txt('description', 10000),
        rel('against_employee', 'employees'),
        day('occurred_on'),
        bool('confidential'),
        bool('anonymous'),
        sel('status', ['open', 'investigating', 'resolved', 'closed', 'withdrawn'], true),
        txt('resolution', 4000),
        rel('assignee', 'members'),
        json('shared_with', 4000),
        bool('agent_shared'),
        json('notes', 100000),
        rel('reported_by', 'members'),
        txt('closed_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_grievances_number ON grievances (number)', 'CREATE INDEX idx_grievances_status ON grievances (status)', 'CREATE INDEX idx_grievances_employee ON grievances (employee)'],
    );

    const flow = new Record(app.findCollectionByNameOrId('approval_flows'));
    flow.set('kind', 'separation');
    flow.set('steps', [{ type: 'manager' }, { type: 'role', role: 'hr_admin' }]);
    flow.set('auto', {});
    flow.set('active', true);
    flow.set('note', 'Separations are approved by the manager, then HR.');
    app.save(flow);
  },
  (app) => {
    for (const r of app.findRecordsByFilter('approval_flows', "kind = 'separation'", '', 0, 0)) app.delete(r);
    for (const name of ['grievances', 'grievance_types', 'handbook_acks', 'handbook_versions', 'handbook', 'assets', 'exit_forms', 'letters', 'letter_templates', 'tasks', 'checklists', 'separations', 'checklist_templates']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
