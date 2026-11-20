/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS kernel schema: the firm's settings, sign-in (members, roles,
 * the PIN vault), the firm's entities (management company, funds, SPVs) and
 * the shared machinery every module uses: audit, activity (undo as a unit),
 * proposals, the agent job queue, tasks, comments, notifications, snoozes
 * of the Next queue, outbound messages, exchange rates, imports and saved
 * views.
 *
 * Every collection is closed to the raw API (all rules null). People and
 * your AI agent reach the data only through the app's operations
 * (pb_hooks/routes.pb.js -> lib_ops.js), which check rights and write the
 * audit trail. Screens learn about changes from the realtime topic "vo",
 * which carries collection names only (lib_bus.js).
 *
 * Units: money is integer minor units (_minor), rates and ownership are
 * millionths (_ppm), exchange rates and prices per share are scaled by 10^8
 * (_e8), local days are 'YYYY-MM-DD' text in the firm's zone (_day),
 * timestamps are UTC ISO text (_at) or PocketBase autodates.
 */
migrate(
  (app) => {
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
    const MMDD = '^((0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]))?$';
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
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: DAY });
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const actor = () => sel('actor', ['person', 'agent', 'system']);
    const make = (name, fields, indexes, extra) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed, extra || {}));
      app.save(c);
      return c;
    };

    /* ------------------------------------------------------------ firm */

    make('settings', [
      txt('firm_name', 160),
      cur('base_currency'),
      txt('zone', 60),
      sel('date_style', ['iso', 'dmy', 'mdy', 'ymd']),
      int('week_start', { min: 0, max: 6 }),
      json('autonomy', 4000),
      bool('agent_sees_fund_data'),
      json('mail', 4000),
      json('retention', 4000),
      json('modules', 200000),
      json('seq', 4000),
      json('cron', 20000),
      json('rate_limits', 2000),
      bool('setup_done'),
      json('extra', 20000),
    ].concat(stamps));

    make(
      'roles',
      [req('code', 40), req('name', 80), json('levels', 2000), bool('votes'), bool('own_items'), bool('system'), txt('description', 400), int('sort')].concat(stamps),
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
        json('funds', 4000),
        sel('status', ['invited', 'active', 'disabled'], true),
        txt('title', 120),
        txt('zone', 60),
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

    make(
      'entities',
      [
        sel('kind', ['management', 'fund', 'spv'], true),
        req('name', 160),
        txt('short_name', 40),
        txt('legal_name', 200),
        cur('currency'),
        int('vintage', { min: 0, max: 2200 }),
        int('size_minor', { min: 0 }),
        int('target_minor', { min: 0 }),
        sel('status', ['active', 'raising', 'investing', 'harvesting', 'closed']),
        { name: 'fiscal_year_end', type: 'text', max: 5, pattern: MMDD },
        day('first_close_day'),
        day('final_close_day'),
        json('lpa', 20000),
        json('settings', 50000),
        txt('deal', 30),
        txt('notes', 4000),
        bool('archived'),
        actor(),
        rel('member', 'members'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_entities_name ON entities (name COLLATE NOCASE)', 'CREATE INDEX idx_entities_kind ON entities (kind, archived)'],
    );
    const ents = app.findCollectionByNameOrId('entities');
    ents.fields.add(new RelationField({ name: 'parent', maxSelect: 1, collectionId: ents.id, cascadeDelete: false }));
    app.save(ents);

    /* ------------------------------------------------------- machinery */

    make(
      'audit',
      [
        sel('actor', ['person', 'agent', 'system'], true),
        rel('member', 'members'),
        txt('op', 80),
        txt('collection', 60),
        txt('record', 30),
        txt('summary', 600),
        txt('run', 40),
        json('before', 50000),
        json('after', 50000),
        json('data', 20000),
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      ['CREATE INDEX idx_audit_record ON audit (collection, record)', 'CREATE INDEX idx_audit_created ON audit (created)', 'CREATE INDEX idx_audit_member ON audit (member)', 'CREATE INDEX idx_audit_op ON audit (op)'],
    );

    make(
      'activity',
      [
        sel('actor', ['person', 'agent', 'system'], true),
        rel('member', 'members'),
        txt('run', 40),
        txt('job', 30),
        txt('op', 80),
        txt('summary', 600),
        txt('target_collection', 60),
        txt('target_id', 30),
        json('steps', 4000000),
        int('changes', { min: 0 }),
        bool('undone'),
        rel('undone_by', 'members'),
        txt('undone_at', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_activity_run ON activity (run, created)', 'CREATE INDEX idx_activity_target ON activity (target_collection, target_id)', 'CREATE INDEX idx_activity_created ON activity (created)'],
    );

    make(
      'proposals',
      [
        req('kind', 40),
        req('title', 300),
        txt('why', 4000),
        json('evidence', 20000),
        json('confidence', 100),
        sel('origin', ['agent', 'rule'], true),
        sel('status', ['pending', 'accepted', 'partial', 'dismissed', 'withdrawn', 'failed', 'expired'], true),
        sel('risk', ['low', 'medium', 'high']),
        json('items', 2000000),
        txt('target', 80),
        txt('deal', 30),
        txt('note', 2000),
        rel('decided_by', 'members'),
        txt('decided_at', 40),
        txt('run', 40),
        txt('job', 30),
      ].concat(stamps),
      ['CREATE INDEX idx_proposals_status ON proposals (status, created)'],
    );

    make(
      'agent_jobs',
      [
        req('kind', 40),
        txt('ref_collection', 60),
        txt('ref_id', 30),
        txt('deal', 30),
        bool('nda'),
        req('summary', 300),
        json('payload', 200000),
        sel('status', ['queued', 'asked', 'claimed', 'done', 'failed', 'cancelled', 'handed_over'], true),
        int('priority', { min: 0, max: 9 }),
        json('result', 100000),
        txt('error', 4000),
        txt('note', 1000),
        txt('handed_to', 200),
        txt('asked_at', 40),
        txt('claimed_at', 40),
        txt('done_at', 40),
        txt('request_id', 40),
        rel('requested_by', 'members'),
        int('attempts', { min: 0 }),
        txt('run', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_jobs_status ON agent_jobs (status, priority, created)', 'CREATE INDEX idx_jobs_ref ON agent_jobs (kind, ref_collection, ref_id)'],
    );

    make(
      'tasks',
      [
        req('title', 300),
        txt('ref_collection', 60),
        txt('ref_id', 30),
        txt('deal', 30),
        rel('assignee', 'members'),
        day('due_day'),
        sel('status', ['open', 'done', 'cancelled'], true),
        txt('done_at', 40),
        rel('done_by', 'members'),
        txt('note', 4000),
        sel('source', ['person', 'agent', 'system']),
        actor(),
        rel('member', 'members'),
        txt('job', 30),
      ].concat(stamps),
      ['CREATE INDEX idx_tasks_assignee ON tasks (assignee, status, due_day)', 'CREATE INDEX idx_tasks_ref ON tasks (ref_collection, ref_id)'],
    );

    make(
      'comments',
      [req('ref_collection', 60), req('ref_id', 30), txt('deal', 30), req('body', 10000), json('mentions', 4000), actor(), rel('member', 'members')].concat(stamps),
      ['CREATE INDEX idx_comments_ref ON comments (ref_collection, ref_id, created)'],
    );

    make(
      'notifications',
      [
        rel('member', 'members', { required: true, cascadeDelete: true }),
        txt('kind', 40),
        req('title', 200),
        txt('body', 2000),
        txt('link', 300),
        json('facts', 8000),
        txt('ref', 200),
        bool('read'),
      ].concat(stamps),
      ['CREATE INDEX idx_notifications_member ON notifications (member, read, created)'],
    );

    make(
      'snoozes',
      [rel('member', 'members', { required: true, cascadeDelete: true }), req('key', 200), req('until', 40)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_snoozes_key ON snoozes (member, key)'],
    );

    make(
      'outbound',
      [
        sel('kind', ['pass', 'intro', 'request', 'notice', 'lp_pack', 'digest', 'reply'], true),
        req('module', 40),
        json('to', 8000),
        req('subject', 300),
        txt('body', 100000),
        json('attachments', 8000),
        sel('status', ['draft', 'approved', 'sending', 'sent', 'failed', 'cancelled'], true),
        txt('ref_collection', 60),
        txt('ref_id', 30),
        txt('deal', 30),
        rel('approver', 'members'),
        rel('approved_by', 'members'),
        txt('approved_at', 40),
        txt('sent_at', 40),
        req('send_key', 60),
        txt('error', 2000),
        json('result', 20000),
        int('ai_chars', { min: 0 }),
        int('typed_chars', { min: 0 }),
        actor(),
        rel('member', 'members'),
        int('attempts', { min: 0 }),
        txt('job', 30),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_outbound_key ON outbound (send_key)', 'CREATE INDEX idx_outbound_status ON outbound (status, created)', 'CREATE INDEX idx_outbound_ref ON outbound (ref_collection, ref_id)'],
    );

    make(
      'fx_rates',
      [day('day'), cur('base'), cur('quote'), int('rate_e8', { min: 0 }), txt('source', 80)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_fx_day ON fx_rates (day, base, quote)'],
    );

    make(
      'imports',
      [
        req('target', 60),
        txt('file_name', 200),
        sel('status', ['running', 'done', 'failed'], true),
        int('rows', { min: 0 }),
        int('created_n', { min: 0 }),
        int('updated_n', { min: 0 }),
        int('skipped_n', { min: 0 }),
        int('error_n', { min: 0 }),
        int('batches', { min: 0 }),
        json('problems', 200000),
        json('mapping', 20000),
        actor(),
        rel('member', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_imports_target ON imports (target, created)'],
    );

    make(
      'saved_views',
      [rel('member', 'members', { required: true, cascadeDelete: true }), req('page', 80), req('name', 80), json('config', 20000), bool('shared'), int('sort')].concat(stamps),
      ['CREATE INDEX idx_views_page ON saved_views (page, member)'],
    );

    /* ------------------------------------------------------------ seed */

    const MODULES = ['network', 'intake', 'pipeline', 'diligence', 'committee', 'portfolio', 'funds', 'lps', 'markets', 'settings'];
    const lv = (map) => {
      const out = {};
      for (const m of MODULES) out[m] = map[m] || 'none';
      return out;
    };
    const ALL = {};
    for (const m of MODULES) ALL[m] = 'full';
    const seedRoles = [
      { code: 'owner', name: 'Owner', levels: ALL, votes: true, own: false, desc: 'Managing partner: everything, including members, roles, settings and exports.' },
      { code: 'partner', name: 'Partner', levels: { network: 'edit', intake: 'edit', pipeline: 'edit', diligence: 'edit', committee: 'edit', portfolio: 'edit', funds: 'view', lps: 'view', markets: 'edit', settings: 'view' }, votes: true, own: false, desc: 'Runs deals, diligence, committee and the portfolio; sees funds and LPs; votes.' },
      { code: 'principal', name: 'Principal', levels: { network: 'edit', intake: 'edit', pipeline: 'edit', diligence: 'edit', committee: 'view', portfolio: 'view', funds: 'view', markets: 'edit' }, votes: false, own: false, desc: 'Sources and works deals and diligence; sees committee and the portfolio.' },
      { code: 'analyst', name: 'Analyst', levels: { network: 'view', intake: 'edit', pipeline: 'view', diligence: 'edit', committee: 'view', portfolio: 'view', funds: 'view', markets: 'view' }, votes: false, own: false, desc: 'Screens the inbox and does diligence; sees the rest.' },
      { code: 'platform', name: 'Platform', levels: { network: 'edit', portfolio: 'edit' }, votes: false, own: false, desc: 'Works the network and portfolio asks.' },
      { code: 'finance', name: 'Finance', levels: { network: 'view', portfolio: 'view', funds: 'full', lps: 'full', settings: 'view' }, votes: false, own: false, desc: 'Runs funds, LPs, capital and marks; sees the portfolio.' },
      { code: 'venture_partner', name: 'Venture partner', levels: { network: 'view', pipeline: 'view', diligence: 'view', committee: 'edit' }, votes: true, own: false, desc: 'Sees the pipeline and votes in committee.' },
      { code: 'scout', name: 'Scout', levels: { intake: 'edit' }, votes: false, own: true, desc: 'Submits deals and sees their own submissions.' },
    ];
    const roles = app.findCollectionByNameOrId('roles');
    seedRoles.forEach((r, i) => {
      const rec = new Record(roles);
      rec.set('code', r.code);
      rec.set('name', r.name);
      rec.set('levels', lv(r.levels));
      rec.set('votes', r.votes);
      rec.set('own_items', r.own);
      rec.set('system', true);
      rec.set('description', r.desc);
      rec.set('sort', i + 1);
      app.save(rec);
    });

    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('firm_name', '');
    s.set('base_currency', '');
    s.set('zone', 'UTC');
    s.set('date_style', 'iso');
    s.set('week_start', 1);
    s.set('autonomy', { note_fields: 'ask', merges: 'ask', asks: 'ask', map_entries: 'ask', stage_moves: 'ask' });
    s.set('agent_sees_fund_data', true);
    s.set('mail', { deals_label: 'Venture OS/Deals', updates_label: 'Venture OS/Updates' });
    s.set('retention', { passed_deal_months: 12 });
    s.set('modules', {});
    s.set('seq', {});
    s.set('cron', {});
    s.set('rate_limits', { login_fails: 10, lock_minutes: 15, pin_fails: 5, pin_lock_minutes: 15 });
    s.set('setup_done', false);
    s.set('extra', {});
    app.save(s);
  },
  (app) => {
    const names = ['saved_views', 'imports', 'fx_rates', 'outbound', 'snoozes', 'notifications', 'comments', 'tasks', 'agent_jobs', 'proposals', 'activity', 'audit', 'entities', 'pin_vault', 'members', 'roles', 'settings'];
    for (const n of names) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
