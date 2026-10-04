/// <reference path="../pb_data/types.d.ts" />
/**
 * IP Manager, full schema.
 *
 * Access model (multi-user): `users.role` drives every collection rule.
 *   admin       everything, including rules, office connections, roles
 *   manager     create/edit all records, decide renewals, accept inbox items
 *   counsel     same editing rights as manager; second reviewer for statutory items
 *   contributor read the portfolio, upload documents, propose inbox items
 *   inventor    submit and read their own invention disclosures only
 *   viewer      read only
 * The first account ever created becomes admin (hook in ip_system.pb.js);
 * later sign-ups get settings.default_signup_role. Nobody can change their
 * own role (users.updateRule).
 *
 * Enums are select fields. Cross-record links are real relations, parents
 * created before children. Self-relations are added after the collection
 * exists (they need its own id).
 */
migrate(
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('items'));
    } catch {
      /* already absent */
    }

    const AUTH = '@request.auth.id != ""';
    const READ = '@request.auth.id != "" && @request.auth.role != "inventor"';
    const EDIT_ROLES = '(@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "counsel")';
    const CONTRIB_ROLES =
      '(@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "counsel" || @request.auth.role = "contributor")';
    const MANAGE_ROLES = '(@request.auth.role = "admin" || @request.auth.role = "manager")';
    const ADMIN = '@request.auth.role = "admin"';

    const RECORD_RULES = {
      listRule: READ,
      viewRule: READ,
      createRule: EDIT_ROLES,
      updateRule: EDIT_ROLES,
      deleteRule: MANAGE_ROLES,
    };

    const TS = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const T = (name, max) => ({ name: name, type: 'text', max: max || 0 });
    const TR = (name, max) => ({ name: name, type: 'text', required: true, max: max || 0 });
    const TH = (name, max) => ({ name: name, type: 'text', max: max || 0, hidden: true });
    const E = (name) => ({ name: name, type: 'editor', maxSize: 200000 });
    const N = (name) => ({ name: name, type: 'number' });
    const B = (name) => ({ name: name, type: 'bool' });
    const D = (name) => ({ name: name, type: 'date' });
    const J = (name, size) => ({ name: name, type: 'json', maxSize: size || 500000 });
    const S = (name, values, required) => ({
      name: name,
      type: 'select',
      maxSelect: 1,
      values: values,
      required: required === true,
    });
    const F = (name, maxSelect, maxSizeMb) => ({
      name: name,
      type: 'file',
      maxSelect: maxSelect || 1,
      maxSize: (maxSizeMb || 50) * 1024 * 1024,
      thumbs: ['100x100', '400x0'],
    });
    const REL = (name, target, cascade, many) => ({
      name: name,
      type: 'relation',
      maxSelect: many ? 999 : 1,
      collectionId: app.findCollectionByNameOrId(target).id,
      cascadeDelete: cascade === true,
    });

    function make(name, fields, rules, indexes) {
      const c = new Collection(
        Object.assign({ type: 'base', name: name, fields: fields.concat(TS) }, rules || RECORD_RULES),
      );
      if (indexes && indexes.length) c.indexes = indexes;
      app.save(c);
      return c;
    }
    function selfRel(collName, fieldName) {
      const c = app.findCollectionByNameOrId(collName);
      c.fields.add(
        new Field({ name: fieldName, type: 'relation', maxSelect: 1, collectionId: c.id, cascadeDelete: false }),
      );
      app.save(c);
    }

    const IP_TYPES = ['patent', 'utility_model', 'design', 'trademark', 'copyright', 'domain'];
    const MATTER_STATUS = [
      'to_file',
      'filed',
      'published',
      'examination',
      'office_action',
      'allowed',
      'opposed',
      'granted',
      'registered',
      'in_grace',
      'lapsed',
      'abandoned',
      'withdrawn',
      'refused',
      'expired',
      'revoked',
      'transferred_out',
    ];
    const DEADLINE_KINDS = ['hard', 'extendable', 'designated', 'internal', 'reminder'];
    const CATEGORIES = [
      'prosecution',
      'filing',
      'maintenance',
      'renewal',
      'opposition',
      'use',
      'term',
      'agreement',
      'copyright',
      'clearance',
      'dispute',
      'invention',
      'other',
    ];
    const ROLES = ['admin', 'manager', 'counsel', 'contributor', 'inventor', 'viewer'];

    // --- users: role + profile -------------------------------------------
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(new Field({ type: 'select', name: 'role', maxSelect: 1, values: ROLES }));
    users.fields.add(new Field({ type: 'text', name: 'job_title', max: 120 }));
    users.fields.add(new Field({ type: 'bool', name: 'digest_opt_out' }));
    users.listRule = AUTH;
    users.viewRule = AUTH;
    users.updateRule = '(id = @request.auth.id && @request.body.role:isset = false) || ' + ADMIN;
    users.deleteRule = ADMIN;
    app.save(users);

    // --- organization settings (singleton) ---------------------------------
    make(
      'settings',
      [
        T('org_name', 160),
        S('vocab_pack', ['general', 'entertainment', 'technology', 'consumer']),
        T('home_currency', 3),
        N('target_buffer_days'),
        J('reminder_days', 5000),
        B('digest_enabled'),
        N('digest_hour'),
        S('digest_channel', ['in_app', 'email', 'slack']),
        T('slack_channel', 120),
        B('second_reviewer'),
        S('renewal_default', ['renew', 'lapse', 'decide']),
        S('default_signup_role', ['manager', 'counsel', 'contributor', 'viewer']),
        J('jurisdictions', 20000),
        T('ref_prefix_patent', 12),
        T('ref_prefix_trademark', 12),
        T('ref_prefix_design', 12),
        T('ref_prefix_copyright', 12),
        T('ref_prefix_agreement', 12),
        T('ref_prefix_invention', 12),
        B('onboarding_done'),
        B('fx_auto'),
        D('fx_updated'),
        B('sync_enabled'),
        N('sync_hour'),
        D('last_digest'),
        D('last_sweep'),
      ],
      { listRule: AUTH, viewRule: AUTH, createRule: ADMIN, updateRule: ADMIN, deleteRule: null },
    );

    // --- office connections (admin only; secrets hidden) ------------------
    make(
      'office_connections',
      [
        S('office', ['uspto_odp', 'uspto_tsdr', 'epo_ops', 'euipo', 'jpo'], true),
        B('enabled'),
        B('sandbox'),
        TH('api_key', 400),
        T('client_id', 400),
        TH('client_secret', 400),
        T('username', 200),
        TH('password', 400),
        TH('token', 4000),
        D('token_expires'),
        B('has_secret'),
        S('status', ['not_configured', 'connected', 'error', 'paused']),
        D('last_check'),
        T('last_error', 2000),
        N('calls_today'),
        T('calls_date', 10),
        N('remaining_calls'),
        D('last_sync'),
        T('notes', 1000),
      ],
      { listRule: ADMIN, viewRule: ADMIN, createRule: ADMIN, updateRule: ADMIN, deleteRule: null },
      ['CREATE UNIQUE INDEX idx_office_conn ON office_connections (office)'],
    );

    // --- properties (franchises, brands, product lines) --------------------
    make('properties', [
      TR('name', 200),
      S('kind', ['franchise', 'brand', 'product_line', 'technology', 'portfolio', 'other']),
      S('rights_basis', ['owned', 'acquired', 'mixed']),
      T('description', 4000),
      F('image', 1, 10),
      T('business_unit', 120),
      S('status', ['active', 'dormant', 'retired']),
      J('tags', 20000),
    ]);
    selfRel('properties', 'parent');

    // --- parties (people and organizations) -------------------------------
    make('parties', [
      TR('name', 200),
      S('kind', ['person', 'organization'], true),
      J('roles', 20000),
      T('email', 255),
      T('phone', 60),
      T('organization', 200),
      T('country', 3),
      T('address', 1000),
      T('external_ref', 120),
      T('notes', 4000),
      REL('user', 'users', false),
    ]);

    // --- works (creative works and elements, a tree) -----------------------
    make('works', [
      TR('title', 300),
      S(
        'work_type',
        [
          'feature_film',
          'series',
          'season',
          'episode',
          'short',
          'game',
          'book',
          'comic',
          'music_composition',
          'sound_recording',
          'album',
          'character',
          'logo',
          'artwork',
          'photograph',
          'software',
          'website',
          'format',
          'script',
          'documentation',
          'marketing_asset',
          'other',
        ],
        true,
      ),
      REL('property', 'properties', false),
      S('rights_basis', ['owned', 'acquired', 'mixed']),
      S('status', ['development', 'production', 'released', 'archived']),
      T('description', 4000),
      D('creation_date'),
      D('publication_date'),
      T('publication_country', 3),
      T('eidr', 60),
      T('isrc', 20),
      T('iswc', 20),
      T('isbn', 20),
      T('other_ids', 400),
      B('made_for_hire'),
      T('authors', 600),
      N('author_death_year'),
      S('author_kind', ['individual', 'joint', 'corporate', 'anonymous']),
      T('language', 40),
      F('image', 1, 10),
      J('tags', 20000),
      T('notes', 4000),
    ]);
    selfRel('works', 'parent');

    // --- families (patent/design families, trademark marks) ----------------
    make('families', [
      S('kind', ['patent', 'design', 'trademark'], true),
      TR('title', 300),
      REL('property', 'properties', false),
      S('mark_type', [
        'word',
        'figurative',
        'combined',
        'three_d',
        'colour',
        'sound',
        'motion',
        'position',
        'pattern',
        'hologram',
        'multimedia',
        'other',
      ]),
      F('mark_image', 1, 10),
      T('word_element', 300),
      T('vienna_codes', 300),
      T('disclaimer', 1000),
      T('transliteration', 300),
      T('translation', 300),
      T('description', 4000),
      J('technology_tags', 20000),
      T('products', 1000),
      S('strategy', ['maintain', 'review', 'prune', 'abandoned']),
      T('strategy_note', 2000),
      T('business_unit', 120),
      T('owner_entity', 200),
      J('tags', 20000),
    ]);

    // --- matters (one right in one jurisdiction) ---------------------------
    make(
      'matters',
      [
        T('ref', 40),
        S('ip_type', IP_TYPES, true),
        TR('title', 400),
        REL('family', 'families', false),
        REL('property', 'properties', false),
        REL('work', 'works', false),
        TR('jurisdiction', 3),
        S('route', ['national', 'regional', 'provisional', 'pct', 'ep', 'unitary', 'madrid', 'hague', 'designation', 'validation', 'other']),
        S('relation', [
          'none',
          'priority',
          'continuation',
          'continuation_in_part',
          'divisional',
          'national_phase',
          'validation',
          'designation',
          'conversion',
          'reissue',
          'related',
        ]),
        T('application_no', 80),
        D('filing_date'),
        T('publication_no', 80),
        D('publication_date'),
        T('registration_no', 80),
        D('registration_date'),
        D('expiry_date'),
        B('expiry_override'),
        J('priority_claims', 50000),
        S('status', MATTER_STATUS, true),
        S('status_group', ['pre_filing', 'pending', 'live', 'dead']),
        T('office_status', 400),
        D('status_date'),
        S('entity_size', ['large', 'small', 'micro', 'na']),
        T('tm_basis', 20),
        S('tm_register', ['principal', 'supplemental', 'na']),
        T('owner_of_record', 300),
        T('applicants', 600),
        T('counsel', 200),
        T('client_ref', 80),
        T('cost_center', 80),
        REL('responsible', 'users', false),
        REL('docketer', 'users', false),
        S('sync_source', ['none', 'uspto_odp', 'uspto_tsdr', 'epo_ops', 'euipo', 'jpo']),
        B('sync_enabled'),
        S('sync_state', ['not_connected', 'connected', 'error', 'not_found']),
        D('last_synced'),
        T('sync_error', 1000),
        J('official_data', 400000),
        D('next_deadline'),
        T('next_deadline_title', 300),
        T('abstract', 8000),
        N('claims_count'),
        N('independent_claims'),
        N('pta_days'),
        J('options', 20000),
        J('tags', 20000),
        E('notes'),
      ],
      RECORD_RULES,
      [
        'CREATE UNIQUE INDEX idx_matters_ref ON matters (ref) WHERE ref != ""',
        'CREATE INDEX idx_matters_type ON matters (ip_type)',
        'CREATE INDEX idx_matters_family ON matters (family)',
        'CREATE INDEX idx_matters_next ON matters (next_deadline)',
      ],
    );
    selfRel('matters', 'parent');

    make(
      'goods_services',
      [
        REL('matter', 'matters', true),
        N('nice_class'),
        T('spec', 20000),
        S('class_status', ['pending', 'registered', 'refused', 'partially_refused', 'deleted', 'cancelled']),
        D('first_use'),
        D('first_use_commerce'),
        B('in_use'),
        F('use_evidence', 5, 20),
        T('evidence_note', 2000),
        D('last_reviewed'),
      ],
      RECORD_RULES,
      ['CREATE INDEX idx_gs_matter ON goods_services (matter)'],
    );

    // --- agreements and their rights scope ---------------------------------
    make(
      'agreements',
      [
        T('ref', 40),
        TR('title', 300),
        S(
          'agreement_type',
          [
            'option',
            'acquisition',
            'assignment',
            'license_in',
            'license_out',
            'talent',
            'services',
            'distribution',
            'merchandise',
            'sync',
            'master_use',
            'co_production',
            'coexistence',
            'settlement',
            'nda',
            'rnd',
            'employment_ip',
            'other',
          ],
          true,
        ),
        S('direction', ['in', 'out', 'mutual', 'none'], true),
        S('status', ['draft', 'negotiating', 'active', 'expired', 'terminated', 'renewed', 'superseded'], true),
        REL('counterparty', 'parties', false),
        T('our_entity', 200),
        REL('property', 'properties', false),
        D('signed_date'),
        D('effective_date'),
        D('term_start'),
        D('term_end'),
        B('perpetual'),
        B('auto_renew'),
        N('renewal_notice_days'),
        S('exclusivity', ['exclusive', 'non_exclusive', 'sole', 'mixed']),
        T('territory_summary', 600),
        T('currency', 3),
        N('royalty_rate'),
        T('royalty_basis', 200),
        N('flat_fee'),
        N('advance'),
        N('minimum_guarantee'),
        J('payment_schedule', 50000),
        S('reporting_frequency', ['none', 'monthly', 'quarterly', 'semiannual', 'annual']),
        N('report_due_days'),
        D('option_period_end'),
        N('option_extension_fee'),
        D('reversion_date'),
        N('sell_off_days'),
        B('author_grant'),
        B('covers_publication'),
        T('governing_law', 120),
        T('summary', 8000),
        E('notes'),
        J('tags', 20000),
        REL('responsible', 'users', false),
        B('ai_extracted'),
      ],
      RECORD_RULES,
      ['CREATE UNIQUE INDEX idx_agreements_ref ON agreements (ref) WHERE ref != ""'],
    );

    make(
      'grants',
      [
        REL('agreement', 'agreements', true),
        S('direction', ['in', 'out'], true),
        S('kind', ['grant', 'holdback', 'restriction', 'reservation'], true),
        B('exclusive'),
        REL('properties', 'properties', false, true),
        REL('works', 'works', false, true),
        REL('matters', 'matters', false, true),
        J('dims', 200000),
        D('term_start'),
        D('term_end'),
        T('rights_text', 4000),
        T('override_reason', 2000),
      ],
      RECORD_RULES,
      ['CREATE INDEX idx_grants_agreement ON grants (agreement)'],
    );

    make(
      'dimensions',
      [TR('key', 40), TR('label', 80), N('order'), B('enabled'), T('description', 400)],
      { listRule: READ, viewRule: READ, createRule: MANAGE_ROLES, updateRule: MANAGE_ROLES, deleteRule: MANAGE_ROLES },
      ['CREATE UNIQUE INDEX idx_dimensions_key ON dimensions (key)'],
    );
    make(
      'dimension_values',
      [TR('dimension', 40), TR('code', 40), TR('label', 120), T('parent_code', 40), N('order')],
      { listRule: READ, viewRule: READ, createRule: MANAGE_ROLES, updateRule: MANAGE_ROLES, deleteRule: MANAGE_ROLES },
      ['CREATE UNIQUE INDEX idx_dimval ON dimension_values (dimension, code)'],
    );

    // --- inventions ---------------------------------------------------------
    // Inventors see what they submitted and what they are named on (inventor_users
    // is kept in sync by ip_system.pb.js from involvements whose party links an account).
    const INV_VIEW = '@request.auth.id != "" && (@request.auth.role != "inventor" || submitted_by = @request.auth.id || inventor_users.id ?= @request.auth.id)';
    const INV_CHILD_VIEW =
      '@request.auth.id != "" && (@request.auth.role != "inventor" || disclosure.submitted_by = @request.auth.id || disclosure.inventor_users.id ?= @request.auth.id)';
    make(
      'disclosures',
      [
        T('ref', 40),
        TR('title', 300),
        T('summary', 4000),
        T('problem', 8000),
        T('solution', 20000),
        T('novelty', 8000),
        T('advantages', 8000),
        T('uses', 4000),
        S('stage', ['draft', 'submitted', 'search', 'review', 'approved', 'drafting', 'filed', 'rejected', 'on_hold', 'merged', 'archived'], true),
        REL('submitted_by', 'users', false),
        D('submitted_at'),
        REL('property', 'properties', false),
        T('products', 600),
        J('tech_tags', 20000),
        D('public_disclosure_date'),
        D('on_sale_date'),
        D('nda_date'),
        J('answers', 100000),
        N('score'),
        N('review_count'),
        T('decision', 4000),
        D('decision_at'),
        REL('family', 'families', false),
        REL('matter', 'matters', false),
        T('inventor_names', 600),
        REL('inventor_users', 'users', false, true),
      ],
      {
        listRule: INV_VIEW,
        viewRule: INV_VIEW,
        createRule: '@request.auth.id != "" && (@request.body.submitted_by = @request.auth.id || ' + EDIT_ROLES + ')',
        updateRule: EDIT_ROLES + ' || (submitted_by = @request.auth.id && stage = "draft")',
        deleteRule: MANAGE_ROLES + ' || (submitted_by = @request.auth.id && stage = "draft")',
      },
    );
    make(
      'disclosure_reviews',
      [
        REL('disclosure', 'disclosures', true),
        REL('reviewer', 'users', false),
        J('scores', 20000),
        N('total'),
        T('comment', 4000),
        S('recommendation', ['file', 'hold', 'reject', 'more_info']),
      ],
      {
        listRule: EDIT_ROLES,
        viewRule: EDIT_ROLES,
        createRule: EDIT_ROLES,
        updateRule: 'reviewer = @request.auth.id',
        deleteRule: ADMIN,
      },
    );
    make(
      'scoring_criteria',
      [TR('key', 40), TR('label', 120), T('description', 600), N('weight'), N('order'), J('levels', 20000), B('enabled')],
      { listRule: AUTH, viewRule: AUTH, createRule: MANAGE_ROLES, updateRule: MANAGE_ROLES, deleteRule: MANAGE_ROLES },
    );

    // --- disputes -------------------------------------------------------------
    make('disputes', [
      TR('title', 300),
      S('dispute_type', [
        'opposition',
        'cancellation',
        'invalidation',
        'non_use',
        'appeal',
        'litigation',
        'udrp',
        'cease_and_desist',
        'takedown',
        'ttab',
        'other',
      ], true),
      S('role', ['offense', 'defense'], true),
      REL('matter', 'matters', false),
      REL('family', 'families', false),
      T('other_party', 300),
      T('their_mark', 300),
      T('forum', 200),
      T('proceeding_no', 80),
      S('status', ['monitoring', 'pending', 'active', 'settled', 'won', 'lost', 'withdrawn', 'closed'], true),
      D('filed_date'),
      T('outcome', 4000),
      T('counsel', 200),
      E('notes'),
    ]);

    // --- documents ----------------------------------------------------------
    make(
      'documents',
      [
        TR('title', 300),
        F('file', 1, 50),
        S('doc_type', [
          'office_action',
          'filing',
          'receipt',
          'certificate',
          'correspondence',
          'agreement',
          'evidence',
          'specimen',
          'chain_of_title',
          'clearance',
          'report',
          'invoice',
          'drawing',
          'disclosure',
          'other',
        ]),
        D('doc_date'),
        REL('matter', 'matters', false),
        REL('agreement', 'agreements', false),
        REL('work', 'works', false),
        REL('disclosure', 'disclosures', false),
        REL('family', 'families', false),
        REL('property', 'properties', false),
        REL('dispute', 'disputes', false),
        S('source', ['upload', 'office', 'email', 'agent']),
        J('extracted', 200000),
        T('summary', 8000),
        REL('uploaded_by', 'users', false),
      ],
      {
        listRule: INV_CHILD_VIEW,
        viewRule: INV_CHILD_VIEW,
        // Inventors attach files to their own disclosures only (checked in ip_system.pb.js).
        createRule: CONTRIB_ROLES + ' || (@request.auth.role = "inventor" && @request.body.disclosure != "")',
        updateRule: CONTRIB_ROLES,
        deleteRule: MANAGE_ROLES,
      },
    );

    // --- events (history) -----------------------------------------------------
    make(
      'events',
      [
        REL('matter', 'matters', true),
        REL('agreement', 'agreements', true),
        REL('work', 'works', true),
        TR('code', 60),
        T('label', 300),
        D('date'),
        T('st27', 10),
        S('source', ['manual', 'office', 'inbox', 'rule', 'system']),
        REL('document', 'documents', false),
        J('data', 100000),
        REL('created_by', 'users', false),
      ],
      RECORD_RULES,
      ['CREATE INDEX idx_events_matter ON events (matter)'],
    );

    // --- rules ------------------------------------------------------------------
    make(
      'rules',
      [
        TR('code', 80),
        TR('name', 300),
        TR('ip_type', 20),
        TR('jurisdiction', 3),
        J('routes', 5000),
        TR('trigger_event', 60),
        J('conditions', 20000),
        S('base', [
          'event_date',
          'filing_date',
          'priority_date',
          'publication_date',
          'registration_date',
          'expiry_date',
          'signed_date',
          'term_end',
        ], true),
        N('offset_years'),
        N('offset_months'),
        N('offset_days'),
        B('due_end_of_month'),
        S('kind', DEADLINE_KINDS, true),
        S('category', CATEGORIES),
        TR('title', 300),
        J('extensions', 20000),
        N('final_offset_months'),
        N('window_months'),
        N('grace_months'),
        T('grace_note', 300),
        N('recurring_years'),
        N('recurring_until_years'),
        N('recurring_first_cycle'),
        T('cycle_label', 60),
        T('roll_office', 3),
        T('citation', 600),
        T('notes', 2000),
        D('effective_from'),
        D('effective_to'),
        N('version'),
        B('enabled'),
        B('system'),
        B('creates_renewal'),
        T('fee_kind', 40),
      ],
      { listRule: READ, viewRule: READ, createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN },
      ['CREATE UNIQUE INDEX idx_rules_code_version ON rules (code, version)', 'CREATE INDEX idx_rules_trigger ON rules (trigger_event)'],
    );

    make(
      'office_calendars',
      [TR('office', 3), D('date'), TR('name', 200), S('source', ['computed', 'official', 'manual'])],
      { listRule: READ, viewRule: READ, createRule: MANAGE_ROLES, updateRule: MANAGE_ROLES, deleteRule: MANAGE_ROLES },
      ['CREATE INDEX idx_cal_office ON office_calendars (office)'],
    );
    make(
      'calendar_years',
      [TR('office', 3), N('year')],
      { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null },
      ['CREATE UNIQUE INDEX idx_cal_years ON calendar_years (office, year)'],
    );

    // --- deadlines ---------------------------------------------------------------
    make(
      'deadlines',
      [
        TR('title', 400),
        REL('matter', 'matters', true),
        REL('agreement', 'agreements', true),
        REL('work', 'works', true),
        REL('disclosure', 'disclosures', true),
        REL('family', 'families', false),
        REL('dispute', 'disputes', true),
        S('kind', DEADLINE_KINDS, true),
        S('category', CATEGORIES),
        S('status', ['open', 'done', 'not_needed', 'extended', 'missed', 'transferred', 'cancelled'], true),
        D('target_date'),
        D('due_date'),
        D('final_date'),
        D('window_opens'),
        D('grace_end'),
        D('nominal_date'),
        D('closed_at'),
        REL('closed_by', 'users', false),
        T('close_reason', 2000),
        REL('assignee', 'users', false),
        S('source', ['rule', 'office', 'inbox', 'manual', 'agreement', 'system']),
        REL('rule', 'rules', false),
        T('rule_code', 80),
        REL('base_event', 'events', false),
        D('base_date'),
        J('calculation', 100000),
        B('locked'),
        N('extension_level'),
        N('cycle'),
        T('key', 200),
        T('jurisdiction', 3),
        T('ip_type', 20),
        T('ref', 40),
        T('citation', 600),
        J('reminders_sent', 20000),
        T('notes', 4000),
      ],
      {
        listRule: READ,
        viewRule: READ,
        createRule: EDIT_ROLES,
        updateRule: EDIT_ROLES,
        deleteRule: ADMIN,
      },
      [
        'CREATE INDEX idx_deadlines_status_due ON deadlines (status, due_date)',
        'CREATE INDEX idx_deadlines_matter ON deadlines (matter)',
        'CREATE INDEX idx_deadlines_key ON deadlines (key)',
      ],
    );

    make(
      'renewals',
      [
        REL('deadline', 'deadlines', true),
        REL('matter', 'matters', true),
        T('cycle_label', 80),
        N('cycle'),
        D('due_date'),
        D('grace_end'),
        D('window_opens'),
        N('official_fee'),
        N('other_fee'),
        T('currency', 3),
        N('home_amount'),
        T('home_currency', 3),
        B('fee_known'),
        T('fee_note', 400),
        S('decision', ['pending', 'renew', 'renew_partial', 'lapse', 'defer'], true),
        REL('decided_by', 'users', false),
        D('decided_at'),
        T('rationale', 2000),
        J('classes_keep', 5000),
        S('instruction_status', ['not_instructed', 'instructed', 'paid', 'confirmed', 'lapsed']),
        D('instructed_at'),
        T('provider', 200),
        T('po_number', 80),
        D('paid_date'),
        N('paid_amount'),
        F('receipt', 1, 20),
      ],
      RECORD_RULES,
      ['CREATE UNIQUE INDEX idx_renewals_deadline ON renewals (deadline)'],
    );

    make(
      'fee_schedule',
      [
        TR('office', 3),
        TR('ip_type', 20),
        TR('fee_kind', 40),
        // cycle 0 = any cycle; cycle_to > 0 makes the row cover cycle..cycle_to (JP years 4 to 6).
        N('cycle'),
        N('cycle_to'),
        S('entity', ['any', 'large', 'small', 'micro']),
        B('per_class'),
        N('amount'),
        // Added once per claim (JP patent annuities are base + per claim).
        N('per_claim_amount'),
        // Class pricing beyond the base: [{ from: 2, amount: 50 }, { from: 3, amount: 150 }]
        // charges class 2 at 50 and every class from 3 on at 150 (EUIPO); Madrid is [{ from: 4, amount: 100 }].
        J('class_tiers', 5000),
        TR('currency', 3),
        N('grace_surcharge'),
        B('surcharge_percent'),
        D('effective_from'),
        T('source', 400),
        T('notes', 600),
      ],
      { listRule: READ, viewRule: READ, createRule: MANAGE_ROLES, updateRule: MANAGE_ROLES, deleteRule: MANAGE_ROLES },
    );
    make(
      'fx_rates',
      [TR('code', 3), N('per_eur'), D('as_of'), S('source', ['ecb', 'manual'])],
      { listRule: READ, viewRule: READ, createRule: MANAGE_ROLES, updateRule: MANAGE_ROLES, deleteRule: MANAGE_ROLES },
      ['CREATE UNIQUE INDEX idx_fx_code ON fx_rates (code)'],
    );

    // --- inbox (the only door for automated data) -------------------------------
    make(
      'inbox_items',
      [
        S('kind', ['office_change', 'document', 'agreement_draft', 'agent_proposal', 'email', 'watch_hit'], true),
        TR('title', 400),
        T('summary', 4000),
        S('status', ['new', 'accepted', 'partially_accepted', 'rejected', 'awaiting_second'], true),
        REL('matter', 'matters', true),
        REL('agreement', 'agreements', false),
        REL('document', 'documents', false),
        T('office', 20),
        J('proposal', 400000),
        J('diffs', 200000),
        S('confidence', ['high', 'medium', 'low', 'none']),
        J('citations', 100000),
        S('source', ['office_sync', 'agent', 'email', 'user']),
        T('proposed_by', 200),
        REL('decided_by', 'users', false),
        D('decided_at'),
        REL('first_approver', 'users', false),
        D('first_approved_at'),
        B('requires_second'),
        T('note', 2000),
        T('fingerprint', 200),
      ],
      {
        listRule: READ,
        viewRule: READ,
        createRule: CONTRIB_ROLES,
        updateRule: null,
        deleteRule: ADMIN,
      },
      ['CREATE INDEX idx_inbox_status ON inbox_items (status)', 'CREATE INDEX idx_inbox_fp ON inbox_items (fingerprint)'],
    );

    // --- clearances, approvals, royalty reports, watch ---------------------------
    make('clearances', [
      REL('work', 'works', true),
      REL('property', 'properties', false),
      S('item_type', [
        'title_report',
        'copyright_report',
        'script_clearance',
        'music_sync',
        'music_master',
        'talent_release',
        'location_release',
        'footage_license',
        'artwork_clearance',
        'trademark_search',
        'eo_insurance',
        'chain_of_title',
        'fto_opinion',
        'open_source_review',
        'other',
      ], true),
      TR('title', 300),
      S('status', ['not_started', 'requested', 'in_progress', 'cleared', 'cleared_with_risk', 'not_cleared', 'not_applicable'], true),
      T('provider', 200),
      D('due_date'),
      D('cleared_date'),
      D('expires'),
      REL('document', 'documents', false),
      REL('responsible', 'users', false),
      T('notes', 4000),
    ]);

    make('approvals', [
      REL('agreement', 'agreements', true),
      REL('property', 'properties', false),
      REL('licensee', 'parties', false),
      TR('product_name', 300),
      T('sku', 80),
      T('category', 120),
      S('stage', ['concept', 'pre_production', 'production_sample', 'packaging', 'final'], true),
      S('status', ['submitted', 'in_review', 'approved', 'approved_with_changes', 'resubmit', 'rejected'], true),
      D('due_date'),
      F('images', 10, 20),
      N('revision'),
      REL('decided_by', 'users', false),
      D('decided_at'),
      T('notes', 4000),
    ]);
    make('approval_rounds', [
      REL('approval', 'approvals', true),
      N('revision'),
      S('stage', ['concept', 'pre_production', 'production_sample', 'packaging', 'final']),
      S('status', ['submitted', 'in_review', 'approved', 'approved_with_changes', 'resubmit', 'rejected']),
      T('comment', 4000),
      F('images', 10, 20),
      REL('decided_by', 'users', false),
    ]);

    make('royalty_reports', [
      REL('agreement', 'agreements', true),
      D('period_start'),
      D('period_end'),
      D('due_date'),
      D('received_date'),
      N('gross_sales'),
      N('royalty_due'),
      N('paid_amount'),
      T('currency', 3),
      S('status', ['expected', 'received', 'paid', 'disputed', 'waived'], true),
      REL('document', 'documents', false),
      T('notes', 2000),
    ]);

    make('watch_hits', [
      REL('family', 'families', false),
      REL('matter', 'matters', false),
      TR('their_mark', 300),
      T('their_owner', 300),
      T('jurisdiction', 3),
      T('application_no', 80),
      T('classes', 200),
      T('goods', 4000),
      D('publication_date'),
      D('opposition_deadline'),
      N('score'),
      S('status', ['new', 'reviewing', 'dismissed', 'monitor', 'escalated', 'actioned'], true),
      T('action', 300),
      T('source', 120),
      REL('reviewer', 'users', false),
      D('decided_at'),
      T('notes', 4000),
    ]);

    // --- involvements (who plays which role on what) -----------------------------
    make(
      'involvements',
      [
        REL('party', 'parties', true),
        S('role', [
          'inventor',
          'author',
          'applicant',
          'owner',
          'assignee',
          'licensee',
          'licensor',
          'counsel',
          'agent',
          'talent',
          'contributor',
          'claimant',
          'other',
        ], true),
        REL('matter', 'matters', true),
        REL('agreement', 'agreements', true),
        REL('work', 'works', true),
        REL('disclosure', 'disclosures', true),
        REL('family', 'families', true),
        N('share'),
        T('note', 600),
      ],
      {
        listRule: INV_CHILD_VIEW,
        viewRule: INV_CHILD_VIEW,
        // Submitters (any role) manage the inventors on their own draft disclosure;
        // ip_system.pb.js checks the disclosure really is theirs and still a draft.
        createRule: EDIT_ROLES + ' || (@request.auth.id != "" && @request.body.disclosure != "")',
        updateRule: EDIT_ROLES + ' || (disclosure.submitted_by = @request.auth.id && disclosure.stage = "draft")',
        deleteRule: EDIT_ROLES + ' || (disclosure.submitted_by = @request.auth.id && disclosure.stage = "draft")',
      },
    );

    // --- views, audit, notifications, sync runs, calendar feed tokens ------------
    make('saved_views', [
      TR('name', 200),
      TR('page', 40),
      J('filters', 50000),
      J('columns', 20000),
      S('scope', ['private', 'shared'], true),
      REL('owner', 'users', true),
      S('schedule', ['none', 'daily', 'weekly', 'monthly']),
      D('last_sent'),
    ], {
      listRule: '@request.auth.id != "" && (owner = @request.auth.id || scope = "shared")',
      viewRule: '@request.auth.id != "" && (owner = @request.auth.id || scope = "shared")',
      createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
      updateRule: 'owner = @request.auth.id',
      deleteRule: 'owner = @request.auth.id',
    });

    make(
      'audit_log',
      [
        REL('actor', 'users', false),
        T('actor_name', 200),
        TR('action', 40),
        T('collection', 60),
        T('record_id', 40),
        T('record_label', 400),
        J('changes', 200000),
        T('reason', 2000),
      ],
      { listRule: EDIT_ROLES, viewRule: EDIT_ROLES, createRule: null, updateRule: null, deleteRule: null },
      ['CREATE INDEX idx_audit_record ON audit_log (record_id)'],
    );

    make(
      'notifications',
      [
        REL('user', 'users', true),
        S('kind', ['digest', 'escalation', 'inbox', 'sync', 'assignment', 'info'], true),
        TR('title', 300),
        T('body', 20000),
        T('link', 400),
        B('read'),
        J('data', 50000),
      ],
      {
        listRule: 'user = @request.auth.id',
        viewRule: 'user = @request.auth.id',
        createRule: null,
        updateRule: 'user = @request.auth.id',
        deleteRule: 'user = @request.auth.id',
      },
      ['CREATE INDEX idx_notif_user ON notifications (user, read)'],
    );

    make(
      'sync_runs',
      [
        TR('office', 20),
        S('trigger', ['scheduled', 'manual', 'import']),
        S('status', ['running', 'ok', 'partial', 'error', 'skipped'], true),
        N('checked'),
        N('changes'),
        N('errors'),
        T('message', 4000),
        D('finished'),
      ],
      { listRule: READ, viewRule: READ, createRule: null, updateRule: null, deleteRule: null },
    );

    make(
      'ics_tokens',
      [REL('user', 'users', true), TR('token', 80), S('scope', ['mine', 'all'])],
      { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null },
      ['CREATE UNIQUE INDEX idx_ics_user ON ics_tokens (user)', 'CREATE UNIQUE INDEX idx_ics_token ON ics_tokens (token)'],
    );
  },
  (app) => {
    const names = [
      'ics_tokens',
      'sync_runs',
      'notifications',
      'audit_log',
      'saved_views',
      'involvements',
      'watch_hits',
      'royalty_reports',
      'approval_rounds',
      'approvals',
      'clearances',
      'inbox_items',
      'fx_rates',
      'fee_schedule',
      'renewals',
      'deadlines',
      'calendar_years',
      'office_calendars',
      'rules',
      'events',
      'documents',
      'disputes',
      'scoring_criteria',
      'disclosure_reviews',
      'disclosures',
      'dimension_values',
      'dimensions',
      'grants',
      'agreements',
      'goods_services',
      'matters',
      'families',
      'works',
      'parties',
      'properties',
      'office_connections',
      'settings',
    ];
    for (const n of names) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* absent */
      }
    }
  },
);
