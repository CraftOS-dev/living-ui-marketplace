/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS kernel schema: settings, sign-in (members, roles, the PIN vault),
 * organisation (entities, locations, departments, job titles, grades, cost
 * centres, employment types, holiday calendars, work schedules) and the
 * shared machinery (audit, approvals and flows, proposals, the agent job
 * queue, notifications, exchange rates, imports, counters).
 *
 * Every collection is closed to the raw API (all rules null). People and
 * your AI agent reach the data only through the app's operations
 * (pb_hooks/routes.pb.js -> lib_ops.js), which check rights and write the
 * audit trail. Screens learn about changes from the realtime topic "hr",
 * which carries collection names only (lib_bus.js).
 *
 * Money: integers of the currency's minor unit. Days: 'YYYY-MM-DD' text.
 * Times of day: 'HH:MM' text. Timestamps: PocketBase dates (UTC).
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    // PocketBase's default `users` collection is open for self-registration;
    // people sign in through the app's own `members` collection instead.
    const users = app.findCollectionByNameOrId('users');
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    users.passwordAuth.enabled = false;
    app.save(users);

    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const HHMM = '^(([01]\\d|2[0-3]):[0-5]\\d)?$';
    const MMDD = '^((0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]))?$';
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
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: DAY });
    const hhmm = (name) => ({ name: name, type: 'text', max: 5, pattern: HHMM });
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes, extra) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed, extra || {}));
      app.save(c);
      return c;
    };
    // Relations added after both ends exist (a collection cannot point at one saved later).
    const addFields = (collection, fields) => {
      const c = app.findCollectionByNameOrId(collection);
      for (const f of fields) c.fields.add(new RelationField(f));
      app.save(c);
    };

    /* ------------------------------------------------------------ system */

    make('settings', [
      txt('company_name', 160),
      cur('reporting_currency'),
      sel('date_style', ['entity', 'iso', 'dmy', 'mdy', 'ymd']),
      json('autonomy', 2000),
      bool('agent_sees_pay'),
      bool('managers_see_pay'),
      bool('email_notifications'),
      json('setup', 4000),
      bool('setup_done'),
      int('payslip_publish_hour', { min: 0, max: 23 }),
      json('rate_limits', 2000),
      json('extra', 20000),
    ].concat(stamps));

    make('counters', [req('key', 60), int('num', { min: 0 })].concat(stamps), ['CREATE UNIQUE INDEX idx_counters_key ON counters (key)']);

    make(
      'roles',
      [req('code', 40), req('name', 80), json('levels', 2000), bool('team_scope'), bool('system'), txt('description', 400), int('sort')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_roles_code ON roles (code)', 'CREATE UNIQUE INDEX idx_roles_name ON roles (name COLLATE NOCASE)'],
    );

    const members = new Collection({
      type: 'auth',
      name: 'members',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: null,
      manageRule: null,
      passwordAuth: { enabled: false, identityFields: ['email'] },
      authToken: { duration: 2592000 },
      fields: [
        req('name', 120),
        rel('role', 'roles'),
        json('entities', 4000),
        sel('status', ['invited', 'active', 'disabled'], true),
        txt('title', 120),
        txt('invite_hash', 100),
        txt('invite_expires', 40),
        int('fails', { min: 0 }),
        txt('locked_until', 40),
        txt('last_seen', 40),
        txt('pin_set_at', 40),
        int('pin_fails', { min: 0 }),
        txt('pin_locked_until', 40),
        txt('recovery_hash', 100),
        txt('recovery_set_at', 40),
        json('prefs', 4000),
      ].concat(stamps),
      indexes: ['CREATE INDEX idx_members_status ON members (status)'],
    });
    app.save(members);

    // The approval PINs, hashed with bcrypt by PocketBase's own password
    // hashing: one hidden auth record per member, never signed in to.
    const vault = new Collection({
      type: 'auth',
      name: 'pin_vault',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: null,
      manageRule: null,
      passwordAuth: { enabled: false, identityFields: ['email'] },
      fields: [rel('member', 'members', { required: true, cascadeDelete: true })].concat(stamps),
      indexes: ['CREATE UNIQUE INDEX idx_pin_vault_member ON pin_vault (member)'],
    });
    app.save(vault);

    /* ----------------------------------------------------- organisation */

    make(
      'entities',
      [
        req('name', 160),
        txt('code', 20),
        txt('legal_name', 200),
        cc('country'),
        txt('region', 10),
        cur('currency'),
        txt('timezone', 60),
        { name: 'fiscal_year_start', type: 'text', max: 5, pattern: MMDD },
        int('week_start', { min: 0, max: 6 }),
        json('tax_ids', 4000),
        json('address', 4000),
        json('registration', 4000),
        txt('default_pay_schedule', 30),
        txt('default_leave_policy', 30),
        txt('default_onboarding_template', 30),
        json('packs', 4000),
        json('bank', 4000),
        bool('active'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_entities_name ON entities (name COLLATE NOCASE)'],
    );

    make(
      'holiday_calendars',
      [req('code', 40), req('name', 120), cc('country'), txt('region', 10), rel('entity', 'entities'), json('seeded_years', 400), bool('builtin'), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_calendars_code ON holiday_calendars (code COLLATE NOCASE)'],
    );

    make(
      'holidays',
      [
        rel('calendar', 'holiday_calendars', { required: true, cascadeDelete: true }),
        day('day'),
        req('name', 160),
        sel('kind', ['public', 'company', 'optional', 'observed'], true),
        bool('half'),
        sel('source', ['builtin', 'person', 'import', 'agent']),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_holidays_day ON holidays (calendar, day, name)', 'CREATE INDEX idx_holidays_range ON holidays (calendar, day)'],
    );

    make(
      'work_schedules',
      [
        req('name', 120),
        rel('entity', 'entities'),
        json('week', 4000),
        num('hours_per_week', { min: 0, max: 168 }),
        bool('flexible'),
        int('grace_min', { min: 0, max: 240 }),
        hhmm('night_from'),
        hhmm('night_to'),
        bool('archived'),
      ].concat(stamps),
      ['CREATE INDEX idx_schedules_entity ON work_schedules (entity)'],
    );

    addFields('entities', [rel('default_calendar', 'holiday_calendars'), rel('default_schedule', 'work_schedules')]);

    make(
      'cost_centers',
      [req('code', 40), req('name', 120), rel('entity', 'entities'), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_cost_centers_code ON cost_centers (code COLLATE NOCASE)'],
    );

    make(
      'locations',
      [
        rel('entity', 'entities', { required: true }),
        req('name', 120),
        json('address', 4000),
        cc('country'),
        txt('region', 10),
        txt('timezone', 60),
        num('lat', { min: -90, max: 90 }),
        num('lng', { min: -180, max: 180 }),
        int('radius_m', { min: 0, max: 100000 }),
        rel('calendar', 'holiday_calendars'),
        txt('kiosk_code', 20),
        bool('archived'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_locations_name ON locations (entity, name COLLATE NOCASE)', "CREATE UNIQUE INDEX idx_locations_kiosk ON locations (kiosk_code) WHERE kiosk_code != ''"],
    );

    make(
      'departments',
      [req('name', 120), txt('code', 40), rel('entity', 'entities'), rel('cost_center', 'cost_centers'), bool('archived')].concat(stamps),
      ['CREATE INDEX idx_departments_entity ON departments (entity)'],
    );
    addFields('departments', [rel('parent', 'departments')]);

    make(
      'grades',
      [req('code', 40), req('name', 120), rel('entity', 'entities'), cur('currency'), int('pay_min_minor', { min: 0 }), int('pay_max_minor', { min: 0 }), int('sort'), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_grades_code ON grades (code COLLATE NOCASE)'],
    );

    make(
      'job_titles',
      [req('name', 160), txt('family', 120), rel('grade', 'grades'), txt('description', 4000), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_job_titles_name ON job_titles (name COLLATE NOCASE)'],
    );

    make(
      'employment_types',
      [req('code', 40), req('name', 120), json('statutory', 8000), bool('archived'), int('sort')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_employment_types_code ON employment_types (code)'],
    );

    /* --------------------------------------------------------- machinery */

    make(
      'audit',
      [
        sel('actor', ['person', 'agent', 'system'], true),
        rel('member', 'members'),
        txt('op', 80),
        txt('collection', 60),
        txt('record', 30),
        txt('summary', 600),
        json('before', 50000),
        json('after', 50000),
        json('data', 20000),
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      ['CREATE INDEX idx_audit_record ON audit (collection, record)', 'CREATE INDEX idx_audit_created ON audit (created)', 'CREATE INDEX idx_audit_member ON audit (member)', 'CREATE INDEX idx_audit_op ON audit (op)'],
    );

    make(
      'approval_flows',
      [req('kind', 40), rel('entity', 'entities'), rel('department', 'departments'), json('steps', 4000), json('auto', 2000), bool('active'), txt('note', 400)].concat(stamps),
      ['CREATE INDEX idx_flows_kind ON approval_flows (kind)'],
    );

    make(
      'approvals',
      [
        req('kind', 40),
        txt('ref_collection', 60),
        txt('ref_id', 30),
        rel('entity', 'entities'),
        rel('requester', 'members'),
        sel('requester_actor', ['person', 'agent', 'system']),
        json('steps', 8000),
        int('step', { min: 0 }),
        json('approvers', 8000),
        rel('approver_member', 'members'),
        txt('approver_role', 40),
        sel('status', ['pending', 'approved', 'rejected', 'cancelled'], true),
        rel('decided_by', 'members'),
        txt('decided_at', 40),
        txt('note', 2000),
        txt('summary', 600),
        int('amount_minor'),
        cur('currency'),
        json('payload', 50000),
        json('history', 20000),
        txt('due', 40),
        bool('needs_pin'),
      ].concat(stamps),
      ['CREATE INDEX idx_approvals_status ON approvals (status, kind)', 'CREATE INDEX idx_approvals_ref ON approvals (ref_collection, ref_id)', 'CREATE INDEX idx_approvals_requester ON approvals (requester)'],
    );

    make(
      'proposals',
      [
        sel('kind', ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'packs', 'mixed'], true),
        req('title', 300),
        txt('why', 4000),
        sel('origin', ['agent', 'rule'], true),
        sel('status', ['pending', 'accepted', 'partial', 'dismissed', 'withdrawn', 'failed', 'expired'], true),
        sel('risk', ['low', 'medium', 'high']),
        json('items', 200000),
        txt('target', 80),
        txt('note', 2000),
        rel('decided_by', 'members'),
        txt('decided_at', 40),
        rel('entity', 'entities'),
      ].concat(stamps),
      ['CREATE INDEX idx_proposals_status ON proposals (status, created)'],
    );

    make(
      'agent_jobs',
      [
        sel(
          'kind',
          ['read_receipt', 'review_payrun', 'explain_variance', 'check_rule_updates', 'draft_pack_update', 'answer_question', 'draft_letter', 'draft_job_post', 'summarize_interview', 'review_timesheets', 'draft_review_summary', 'onboarding_help', 'import_help'],
          true,
        ),
        txt('ref_collection', 60),
        txt('ref_id', 30),
        req('summary', 300),
        json('payload', 50000),
        sel('status', ['queued', 'asked', 'claimed', 'done', 'failed', 'cancelled'], true),
        int('priority', { min: 0, max: 9 }),
        json('result', 100000),
        txt('error', 4000),
        txt('asked_at', 40),
        txt('claimed_at', 40),
        txt('done_at', 40),
        txt('request_id', 40),
        rel('requested_by', 'members'),
        int('attempts', { min: 0 }),
      ].concat(stamps),
      ['CREATE INDEX idx_jobs_status ON agent_jobs (status, priority, created)', 'CREATE INDEX idx_jobs_ref ON agent_jobs (kind, ref_collection, ref_id)'],
    );

    make(
      'notifications',
      [
        rel('member', 'members', { required: true, cascadeDelete: true }),
        txt('kind', 40),
        req('title', 200),
        txt('body', 2000),
        txt('link', 300),
        bool('read'),
        sel('email', ['none', 'pending', 'sent', 'failed']),
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      ['CREATE INDEX idx_notifications_member ON notifications (member, read, created)', "CREATE INDEX idx_notifications_email ON notifications (email) WHERE email = 'pending'"],
    );

    make(
      'fx_rates',
      [day('day'), cur('base'), cur('quote'), num('rate', { min: 0 }), txt('source', 40)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_fx_day ON fx_rates (day, base, quote)'],
    );

    make(
      'imports',
      [
        req('kind', 40),
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 20000000, mimeTypes: ['text/csv', 'text/plain', 'application/vnd.ms-excel'], protected: true },
        sel('status', ['dry_run', 'committed', 'failed'], true),
        json('report', 200000),
        int('rows', { min: 0 }),
        rel('member', 'members'),
        sel('actor', ['person', 'agent', 'system']),
      ].concat(stamps),
      ['CREATE INDEX idx_imports_kind ON imports (kind, created)'],
    );

    /* -------------------------------------------------------------- seed */

    const roles = app.findCollectionByNameOrId('roles');
    const MODULES = ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'reports', 'admin'];
    const lv = (map) => {
      const out = {};
      for (const m of MODULES) out[m] = map[m] || 'none';
      return out;
    };
    const ALL = {};
    for (const m of MODULES) ALL[m] = 'full';
    const seedRoles = [
      { code: 'owner', name: 'Owner', levels: ALL, team: false, desc: 'Everything, including roles, members, settings and the approval PIN rules.' },
      { code: 'hr_admin', name: 'HR administrator', levels: { people: 'full', time: 'full', leave: 'full', expenses: 'full', payroll: 'view', hiring: 'full', performance: 'full', reports: 'full', admin: 'edit' }, team: false, desc: 'Runs people, time, leave, hiring and performance; sees payroll; invites members.' },
      { code: 'payroll_admin', name: 'Payroll administrator', levels: { payroll: 'full', people: 'view', time: 'view', leave: 'view', expenses: 'full', reports: 'full', admin: 'view' }, team: false, desc: 'Runs payroll and expenses; sees people, time and leave.' },
      { code: 'finance', name: 'Finance', levels: { expenses: 'full', payroll: 'view', reports: 'view' }, team: false, desc: 'Pays expenses and sees payroll and reports.' },
      { code: 'manager', name: 'Manager', levels: { hiring: 'edit' }, team: true, desc: 'Sees and approves for their direct and indirect reports; interviews candidates.' },
      { code: 'recruiter', name: 'Recruiter', levels: { hiring: 'full' }, team: false, desc: 'Runs hiring.' },
      { code: 'employee', name: 'Employee', levels: {}, team: false, desc: 'Their own profile, time, leave, expenses and payslips.' },
    ];
    seedRoles.forEach((r, i) => {
      const rec = new Record(roles);
      rec.set('code', r.code);
      rec.set('name', r.name);
      rec.set('levels', lv(r.levels));
      rec.set('team_scope', r.team);
      rec.set('system', true);
      rec.set('description', r.desc);
      rec.set('sort', i + 1);
      app.save(rec);
    });

    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('company_name', '');
    s.set('reporting_currency', '');
    s.set('date_style', 'entity');
    s.set('autonomy', { people: 'ask', time: 'ask', leave: 'ask', expenses: 'ask', payroll: 'ask', hiring: 'ask', performance: 'ask', packs: 'ask' });
    s.set('agent_sees_pay', true);
    s.set('managers_see_pay', false);
    s.set('email_notifications', false);
    s.set('setup', {});
    s.set('setup_done', false);
    s.set('payslip_publish_hour', 9);
    s.set('rate_limits', { login_fails: 10, lock_minutes: 15, pin_fails: 5, pin_lock_minutes: 15 });
    s.set('extra', {});
    app.save(s);

    const flow = new Record(app.findCollectionByNameOrId('approval_flows'));
    flow.set('kind', 'bank_account');
    flow.set('steps', [{ type: 'role', role: 'payroll_admin' }]);
    flow.set('auto', {});
    flow.set('active', true);
    flow.set('note', 'Bank details are approved by a payroll administrator with their approval PIN.');
    app.save(flow);
  },
  (app) => {
    const names = [
      'imports', 'fx_rates', 'notifications', 'agent_jobs', 'proposals', 'approvals', 'approval_flows', 'audit', 'employment_types', 'job_titles',
      'grades', 'departments', 'locations', 'cost_centers', 'work_schedules', 'holidays', 'holiday_calendars', 'entities', 'pin_vault', 'members',
      'roles', 'counters', 'settings',
    ];
    for (const n of names) {
      try {
        const c = app.findCollectionByNameOrId(n);
        app.delete(c);
      } catch {
        /* already gone */
      }
    }
  },
);
