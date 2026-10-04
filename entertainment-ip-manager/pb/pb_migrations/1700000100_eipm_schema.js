/// <reference path="../pb_data/types.d.ts" />
/**
 * Entertainment IP Manager, full schema.
 *
 * Access model (multi-user): `users.role` drives every collection rule.
 *   Internal roles
 *   admin           everything, including settings, roles, office connections, the identity vault
 *   manager         edit everything, decide renewals and approvals, delete records
 *   rights          agreements, committees, trademarks, enforcement, deadlines
 *   licensing       products, approvals, seals, royalties, licensees
 *   talent_manager  talents, permissions, playbooks; the identity of talents they manage
 *   contributor     read, upload documents, propose Inbox items
 *   viewer          read only
 *   External roles (portals; they see only records whose portal_users include them)
 *   licensee          their own agreements, products, approvals, statements, seal orders
 *   committee_member  their committee's windows, statements and consent requests
 *   reviewer          approvals assigned to them (for example the original author's publisher)
 *
 * The first account ever created becomes admin (hook in eipm_system.pb.js);
 * later sign-ups get settings.default_signup_role. Nobody changes their own role.
 *
 * `portal_users` fields are derived by hooks (from counterparties, licensees,
 * committee members and assigned reviewers) and are the only door for
 * external accounts.
 *
 * Relation naming: a relation to `titles` is called `work` everywhere (the
 * text field `title` is taken), to `franchises` it is `franchise`, to
 * `enforcement_cases` it is `case_ref`.
 */
migrate(
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('items'));
    } catch {
      /* already absent */
    }

    const any = (roles) =>
      '(' +
      roles
        .map(function (r) {
          return '@request.auth.role = "' + r + '"';
        })
        .join(' || ') +
      ')';
    const AUTH = '@request.auth.id != ""';
    const INTERNAL =
      '(@request.auth.id != "" && @request.auth.role != "licensee" && @request.auth.role != "committee_member" && @request.auth.role != "reviewer" && @request.auth.role != "")';
    const EDITORS = any(['admin', 'manager', 'rights', 'licensing', 'talent_manager']);
    const CONTRIB = any(['admin', 'manager', 'rights', 'licensing', 'talent_manager', 'contributor']);
    const MANAGE = any(['admin', 'manager']);
    const ADMIN = '@request.auth.role = "admin"';
    const RIGHTS_EDIT = any(['admin', 'manager', 'rights']);
    const TALENT_EDIT = any(['admin', 'manager', 'talent_manager']);
    const PORTAL_READ = '(' + INTERNAL + ' || portal_users.id ?= @request.auth.id)';

    const RECORD_RULES = {
      listRule: INTERNAL,
      viewRule: INTERNAL,
      createRule: EDITORS,
      updateRule: EDITORS,
      deleteRule: MANAGE,
    };
    const PORTAL_RULES = {
      listRule: PORTAL_READ,
      viewRule: PORTAL_READ,
      createRule: EDITORS,
      updateRule: EDITORS,
      deleteRule: MANAGE,
    };
    const REFERENCE_RULES = { listRule: AUTH, viewRule: AUTH, createRule: MANAGE, updateRule: MANAGE, deleteRule: MANAGE };

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
    const PORTAL = () => REL('portal_users', 'users', false, true);

    function make(name, fields, rules, indexes) {
      const c = new Collection(
        Object.assign({ type: 'base', name: name, fields: fields.concat(TS) }, rules || RECORD_RULES),
      );
      if (indexes && indexes.length) c.indexes = indexes;
      app.save(c);
      return c;
    }
    function addRel(collName, fieldName, target, cascade, many) {
      const c = app.findCollectionByNameOrId(collName);
      const t = app.findCollectionByNameOrId(target);
      c.fields.add(
        new Field({
          name: fieldName,
          type: 'relation',
          maxSelect: many ? 999 : 1,
          collectionId: t.id,
          cascadeDelete: cascade === true,
        }),
      );
      app.save(c);
    }

    const ROLES = [
      'admin',
      'manager',
      'rights',
      'licensing',
      'talent_manager',
      'contributor',
      'viewer',
      'licensee',
      'committee_member',
      'reviewer',
    ];
    const DEADLINE_KINDS = ['hard', 'extendable', 'designated', 'internal', 'reminder'];
    const CATEGORIES = [
      'prosecution',
      'filing',
      'renewal',
      'opposition',
      'use',
      'term',
      'agreement',
      'copyright',
      'committee',
      'talent',
      'playbook',
      'licensing',
      'approval',
      'music',
      'content_id',
      'enforcement',
      'customs',
      'permission',
      'guideline',
      'other',
    ];
    const MATTER_STATUS = [
      'to_file',
      'filed',
      'published',
      'examination',
      'office_action',
      'allowed',
      'opposed',
      'registered',
      'in_grace',
      'lapsed',
      'abandoned',
      'withdrawn',
      'refused',
      'expired',
      'revoked',
      'cancelled',
      'transferred_out',
    ];
    const SOCIETIES = ['jasrac', 'nextone', 'self', 'other'];

    // --- users: role + profile -------------------------------------------
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(new Field({ type: 'select', name: 'role', maxSelect: 1, values: ROLES }));
    users.fields.add(new Field({ type: 'text', name: 'job_title', max: 120 }));
    users.fields.add(new Field({ type: 'bool', name: 'digest_opt_out' }));
    users.fields.add(new Field({ type: 'select', name: 'ui_language', maxSelect: 1, values: ['en', 'ja'] }));
    users.listRule = INTERNAL + ' || id = @request.auth.id';
    users.viewRule = INTERNAL + ' || id = @request.auth.id';
    users.updateRule = '(id = @request.auth.id && @request.body.role:isset = false) || ' + ADMIN;
    users.deleteRule = ADMIN;
    app.save(users);

    // --- organization settings (singleton) ---------------------------------
    make(
      'settings',
      [
        T('org_name', 160),
        J('profiles', 2000),
        J('modules', 5000),
        S('default_language', ['en', 'ja']),
        T('home_currency', 3),
        T('work_calendar', 3),
        N('target_buffer_days'),
        J('reminder_days', 5000),
        B('digest_enabled'),
        N('digest_hour'),
        S('digest_channel', ['in_app', 'email', 'slack']),
        T('slack_channel', 120),
        B('second_reviewer'),
        S('renewal_default', ['renew', 'lapse', 'decide']),
        S('default_signup_role', ['manager', 'rights', 'licensing', 'talent_manager', 'contributor', 'viewer']),
        J('jurisdictions', 20000),
        J('approval_stages', 20000),
        N('approval_sla_days'),
        N('leak_lag_days'),
        T('ref_prefix_trademark', 12),
        T('ref_prefix_design', 12),
        T('ref_prefix_agreement', 12),
        T('ref_prefix_product', 12),
        T('ref_prefix_case', 12),
        T('ref_prefix_permit', 12),
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
        S('office', ['uspto_tsdr', 'euipo', 'jpo'], true),
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

    // --- parties (people and companies) -----------------------------------
    make('parties', [
      TR('name', 200),
      T('name_kana', 200),
      S('kind', ['person', 'organization'], true),
      J('roles', 20000),
      // ["legal, pen, stage, character or trade name", ...] as plain strings
      J('aliases', 20000),
      T('email', 255),
      T('phone', 60),
      T('organization', 200),
      T('country', 3),
      T('address', 1000),
      T('external_ref', 120),
      T('ipi', 20),
      T('society', 40),
      T('notes', 4000),
      REL('user', 'users', false),
      PORTAL(),
    ]);

    // --- franchises (anime franchises, VTuber groups, character brands) -----
    make('franchises', [
      TR('name', 200),
      // [{ script: ja | kana | en | romaji | zh_hans | zh_hant | ko, value }]
      J('names', 20000),
      S('kind', [
        'anime_title',
        'original_character',
        'vtuber_agency',
        'vtuber_group',
        'virtual_singer',
        'game',
        'music_project',
        'mixed_media',
        'other',
      ]),
      S('ownership_model', ['committee', 'sole_owner', 'licensed_in', 'co_production', 'talent_owned']),
      S('status', ['development', 'active', 'dormant', 'retired']),
      T('description', 4000),
      F('image', 1, 10),
      // [{ territory, text }]
      J('copyright_lines', 20000),
      T('style_guide_version', 60),
      D('announcement_date'),
      J('tags', 20000),
    ]);
    addRel('franchises', 'parent', 'franchises', false, false);

    // --- titles (series, episodes, films, streams, books; a tree) ----------
    make('titles', [
      TR('title', 300),
      J('names', 20000),
      S(
        'title_type',
        [
          'series',
          'season',
          'episode',
          'film',
          'ova',
          'special',
          'short',
          'original_manga',
          'original_novel',
          'game',
          'stage_play',
          'event',
          'stream',
          'stream_archive',
          'music_video',
          'voice_product',
          'book',
          'illustration',
          'other',
        ],
        true,
      ),
      REL('franchise', 'franchises', false),
      S('rights_basis', ['owned', 'committee', 'acquired', 'licensed_in', 'mixed']),
      S('status', ['development', 'production', 'announced', 'released', 'archived']),
      T('description', 4000),
      D('creation_date'),
      D('publication_date'),
      T('publication_country', 3),
      N('episode_number'),
      // [{ type: eidr | isan | media_arts_db | streamer | jan | isbn | other, value, note }]
      J('external_ids', 20000),
      B('made_for_hire'),
      T('authors', 600),
      N('author_death_year'),
      S('author_kind', ['individual', 'joint', 'corporate', 'anonymous', 'film']),
      T('language', 40),
      F('image', 1, 10),
      D('announcement_date'),
      J('tags', 20000),
      T('notes', 4000),
    ]);
    addRel('titles', 'parent', 'titles', false, false);
    addRel('franchises', 'original_work', 'titles', false, false);

    // --- characters ------------------------------------------------------------
    make('characters', [
      TR('name', 200),
      J('names', 20000),
      REL('franchise', 'franchises', false),
      REL('appears_in', 'titles', false, true),
      S('kind', ['anime_character', 'vtuber_persona', 'virtual_singer', 'mascot', 'idol_member', 'game_character', 'other']),
      S('ownership_model', ['agency_owned', 'talent_owned', 'co_owned', 'licensed_in', 'committee_owned']),
      S('status', ['development', 'active', 'hiatus', 'retired', 'archived']),
      D('debut_date'),
      // "MM-DD"
      T('birthday', 5),
      E('profile'),
      F('image', 1, 10),
      // { training: no | yes, fan_ai_art: no | labelled | yes, voice_clone: no | yes }
      J('ai_policy', 5000),
      T('copyright_line', 300),
      D('announcement_date'),
      J('tags', 20000),
    ]);

    // --- talents and the identity vault -----------------------------------------
    make(
      'talents',
      [
        TR('stage_name', 200),
        J('names', 20000),
        S('talent_type', ['vtuber', 'voice_actor', 'singer', 'actor', 'producer', 'other']),
        S('affiliation', ['ours', 'external']),
        REL('agency', 'parties', false),
        REL('party', 'parties', false),
        S('lifecycle', [
          'audition',
          'pre_debut',
          'active',
          'hiatus',
          'suspended',
          'graduation_announced',
          'graduated',
          'terminated',
          'alumni',
        ]),
        D('debut_date'),
        D('graduation_date'),
        T('birthday', 5),
        REL('managers', 'users', false, true),
        // [{ category, talent_pct, agency_pct }]
        J('revenue_share', 20000),
        // [{ platform, url, handle }]
        J('channels', 20000),
        F('image', 1, 10),
        E('profile'),
        S('privacy_class', ['public', 'restricted']),
        T('notes', 4000),
      ],
      { listRule: INTERNAL, viewRule: INTERNAL, createRule: TALENT_EDIT, updateRule: TALENT_EDIT, deleteRule: MANAGE },
    );
    const VAULT = ADMIN + ' || talent.managers.id ?= @request.auth.id';
    make(
      'talent_identity',
      [
        REL('talent', 'talents', true),
        T('legal_name', 200),
        T('legal_name_kana', 200),
        D('birth_date'),
        T('email', 255),
        T('phone', 60),
        T('address', 1000),
        T('emergency_contact', 400),
        T('payment_note', 1000),
        T('notes', 4000),
      ],
      { listRule: VAULT, viewRule: VAULT, createRule: VAULT, updateRule: VAULT, deleteRule: ADMIN },
      ['CREATE UNIQUE INDEX idx_identity_talent ON talent_identity (talent)'],
    );
    make(
      'castings',
      [
        REL('character', 'characters', true),
        REL('talent', 'talents', true),
        S('role', ['voice', 'performer', 'motion', 'singing', 'voice_and_performer'], true),
        D('start_date'),
        D('end_date'),
        T('credit_name', 200),
        T('notes', 2000),
      ],
      RECORD_RULES,
      ['CREATE INDEX idx_castings_character ON castings (character)', 'CREATE INDEX idx_castings_talent ON castings (talent)'],
    );

    // --- production committees -----------------------------------------------------
    make(
      'committees',
      [
        TR('name', 300),
        REL('work', 'titles', false),
        REL('franchise', 'franchises', false),
        S('form', ['nin_i_kumiai', 'spc', 'llp', 'sole', 'co_production', 'other']),
        S('status', ['forming', 'formed', 'production', 'exploiting', 'term_review', 'dissolved', 'consolidated']),
        D('formed_date'),
        D('term_end'),
        D('review_date'),
        D('buyback_window_end'),
        // "MM-DD"
        T('fiscal_year_end', 5),
        N('distribution_due_days'),
        N('lead_fee_pct'),
        S('lead_fee_base', ['gross', 'net']),
        N('promo_fee_pct'),
        S('consent_default', ['unanimous', 'majority', 'lead_discretion', 'consult']),
        // ordered steps: [{ key, label, label_ja, kind: deduction | fee | success_fee, pct, base, cap_pct, amount, condition }]
        J('waterfall', 50000),
        T('currency', 3),
        T('copyright_line', 300),
        T('notes', 4000),
        PORTAL(),
      ],
      { listRule: PORTAL_READ, viewRule: PORTAL_READ, createRule: RIGHTS_EDIT, updateRule: RIGHTS_EDIT, deleteRule: MANAGE },
    );
    make(
      'committee_members',
      [
        REL('committee', 'committees', true),
        REL('party', 'parties', false),
        T('name', 200),
        N('investment'),
        T('currency', 3),
        N('share_pct'),
        N('copyright_share_pct'),
        // ["lead", "promotion_lead", "studio", "publisher", "label", "broadcaster", "streamer", "merchandiser", "member"]
        J('roles', 2000),
        B('in_kind'),
        T('in_kind_note', 600),
        S('status', ['active', 'transferred', 'insolvent', 'exited']),
        D('status_date'),
        T('notes', 2000),
      ],
      {
        listRule: INTERNAL + ' || committee.portal_users.id ?= @request.auth.id',
        viewRule: INTERNAL + ' || committee.portal_users.id ?= @request.auth.id',
        createRule: RIGHTS_EDIT,
        updateRule: RIGHTS_EDIT,
        deleteRule: MANAGE,
      },
      ['CREATE INDEX idx_members_committee ON committee_members (committee)'],
    );
    addRel('titles', 'committee', 'committees', false, false);
    addRel('franchises', 'committee', 'committees', false, false);

    // --- agreements ------------------------------------------------------------------
    make(
      'agreements',
      [
        T('ref', 40),
        TR('title', 300),
        S(
          'agreement_type',
          [
            'original_work_license',
            'committee',
            'production',
            'creator_commission',
            'talent',
            'voice_actor',
            'merchandise',
            'overseas',
            'streaming',
            'broadcast',
            'video',
            'game',
            'pachinko',
            'stage',
            'event_collab',
            'brand_tieup',
            'publishing',
            'music_publishing',
            'master_license',
            'master_assignment',
            'co_master',
            'tie_up',
            'sync',
            'karaoke',
            'distribution',
            'platform',
            'fan_permit',
            'assignment',
            'nda',
            'settlement',
            'coexistence',
            'other',
          ],
          true,
        ),
        S('direction', ['in', 'out', 'mutual', 'none'], true),
        S('status', ['draft', 'negotiating', 'active', 'expired', 'terminated', 'renewed', 'superseded'], true),
        REL('counterparty', 'parties', false),
        REL('agent', 'parties', false),
        T('our_entity', 200),
        REL('franchise', 'franchises', false),
        REL('work', 'titles', false),
        REL('committee', 'committees', false),
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
        S('royalty_basis', [
          'retail_x_manufactured',
          'retail_x_sold',
          'wholesale_net',
          'net_receipts',
          'per_unit',
          'per_seal',
          'flat_fee',
          'revenue_share',
          'none',
        ]),
        // [{ from_qty, rate }]
        J('rate_tiers', 20000),
        N('deduction_cap_pct'),
        N('flat_fee'),
        N('advance'),
        N('minimum_guarantee'),
        B('mg_recoupable'),
        B('cross_collateral'),
        // [{ date, amount, currency?, label }]
        J('payment_schedule', 50000),
        S('reporting_frequency', ['none', 'monthly', 'quarterly', 'semiannual', 'annual']),
        N('report_due_days'),
        N('late_interest_pct'),
        N('audit_threshold_pct'),
        D('option_period_end'),
        N('option_extension_fee'),
        D('reversion_date'),
        N('sell_off_days'),
        B('sell_off_on_expiry_only'),
        N('samples_owed'),
        N('approval_sla_days'),
        S('approval_timeout', ['none', 'deemed_refused', 'deemed_approved']),
        J('approval_stages', 20000),
        B('original_approval_required'),
        B('talent_approval_required'),
        T('copyright_notice', 400),
        T('style_guide_version', 60),
        B('sublicense_allowed'),
        // [{ date, item }]
        J('delivery_schedule', 50000),
        D('completion_deadline'),
        D('sequel_negotiation_end'),
        B('author_grant'),
        B('art27_28'),
        B('moral_rights_waiver'),
        N('payment_due_days'),
        B('non_compete'),
        S('stage_name_clause', ['agency_owns', 'talent_owns', 'shared', 'not_stated']),
        // { archives, merch_sell_off_days, music, voice, notes }
        J('post_term', 20000),
        // [{ category, talent_pct, agency_pct }]
        J('revenue_share', 20000),
        T('governing_law', 120),
        T('summary', 8000),
        E('notes'),
        J('tags', 20000),
        REL('responsible', 'users', false),
        B('ai_extracted'),
        PORTAL(),
      ],
      PORTAL_RULES,
      ['CREATE UNIQUE INDEX idx_agreements_ref ON agreements (ref) WHERE ref != ""'],
    );
    addRel('agreements', 'parent', 'agreements', false, false);
    addRel('committees', 'agreement', 'agreements', false, false);

    // --- character rights stack -------------------------------------------------------
    make(
      'character_assets',
      [
        REL('character', 'characters', true),
        S(
          'component',
          [
            'name',
            'logo',
            'design_sheet',
            'standing_art',
            'outfit',
            'live2d_model',
            'model_3d',
            'emote',
            'voice',
            'persona_lore',
            'jingle',
            'other',
          ],
          true,
        ),
        TR('label', 200),
        T('version', 40),
        REL('creator', 'parties', false),
        REL('agreement', 'agreements', false),
        S('acquisition', [
          'owned_original',
          'work_for_hire',
          'assignment',
          'exclusive_license',
          'nonexclusive_license',
          'unknown',
        ]),
        B('art27_28'),
        B('moral_rights_waiver'),
        T('credit_text', 300),
        S('portfolio_use', ['not_allowed', 'allowed', 'after_announcement', 'conditions']),
        T('portfolio_note', 600),
        D('delivered_date'),
        D('license_end'),
        T('territory_limit', 300),
        S('status', ['planned', 'commissioned', 'delivered', 'cleared', 'needs_attention']),
        // Freelance Act: written terms, inspection, payment within 60 days
        D('order_terms_date'),
        D('inspected_date'),
        D('payment_due'),
        D('paid_date'),
        N('fee'),
        T('currency', 3),
        // [{ date, description, paid }]
        J('rework', 20000),
        F('files', 10, 50),
        T('notes', 4000),
      ],
      RECORD_RULES,
      ['CREATE INDEX idx_assets_character ON character_assets (character)'],
    );
    addRel('character_assets', 'derived_from', 'character_assets', false, false);

    // --- music ---------------------------------------------------------------------
    make('songs', [
      TR('title', 300),
      J('names', 20000),
      T('iswc', 20),
      // [{ society, code }]
      J('work_codes', 20000),
      T('lyrics_language', 40),
      B('original'),
      REL('franchise', 'franchises', false),
      REL('work', 'titles', false),
      REL('characters', 'characters', false, true),
      S('tie_up_use', ['none', 'opening', 'ending', 'insert', 'theme', 'character_song', 'bgm', 'other']),
      D('first_publication'),
      T('copyright_line', 300),
      B('fan_cover_allowed'),
      T('fan_cover_note', 600),
      S('status', ['draft', 'splits_pending', 'registered', 'released', 'archived']),
      T('notes', 4000),
    ]);
    addRel('songs', 'parent', 'songs', false, false);
    make(
      'recordings',
      [
        TR('title', 300),
        REL('song', 'songs', false),
        REL('songs', 'songs', false, true),
        // [{ song, pct }] for medleys
        J('song_shares', 5000),
        T('isrc', 15),
        S('version_type', ['studio', 'tv_size', 'instrumental', 'a_cappella', 'live', 'remix', 'cover', 'music_video', 'other']),
        N('duration_sec'),
        D('recording_date'),
        T('p_line', 300),
        // [{ party, name, pct, type: owned | licence | assignment | co_owned }]
        J('master_owners', 20000),
        B('virtual_singer'),
        T('virtual_singer_note', 300),
        B('captured_in_av'),
        B('sound_only_consent'),
        T('consent_note', 600),
        REL('talents', 'talents', false, true),
        REL('characters', 'characters', false, true),
        S('status', ['draft', 'mixing', 'mastered', 'released', 'archived']),
        T('notes', 4000),
      ],
      RECORD_RULES,
      ['CREATE UNIQUE INDEX idx_recordings_isrc ON recordings (isrc) WHERE isrc != ""'],
    );
    addRel('recordings', 'parent', 'recordings', false, false);
    make('releases', [
      TR('title', 300),
      T('upc', 20),
      T('catalogue_no', 60),
      S('format', ['digital_single', 'digital_album', 'cd_single', 'cd_album', 'vinyl', 'bluray_bundle', 'other']),
      REL('label', 'parties', false),
      REL('distributor', 'parties', false),
      D('release_date'),
      // [{ code, date }]
      J('territories', 20000),
      // [{ recording, track_no, disc }]
      J('tracks', 50000),
      REL('recordings', 'recordings', false, true),
      S('status', ['planned', 'scheduled', 'released', 'withdrawn']),
      T('notes', 4000),
    ]);
    make('society_contracts', [
      S('society', SOCIETIES, true),
      S('model', ['trust_all', 'per_work']),
      T('member_no', 60),
      T('our_entity', 200),
      // [{ category, territory, status: managed | excluded | other_society }]
      J('scope', 50000),
      D('term_start'),
      D('term_end'),
      N('renewal_years'),
      B('auto_renew'),
      T('notes', 4000),
    ]);
    make(
      'society_registrations',
      [
        REL('song', 'songs', true),
        S('society', SOCIETIES, true),
        S('status', ['draft', 'submitted', 'code_issued', 'registered', 'disputed', 'withheld']),
        T('work_code', 40),
        D('submitted_date'),
        D('registered_date'),
        // [{ party, name, role, performance, mechanical, print, film, video, game, ad, broadcast, interactive }]
        J('shares', 50000),
        // [{ type: cm | film | game | broadcast, party, product, from, to, note }]
        J('reservations', 20000),
        T('notes', 4000),
      ],
      RECORD_RULES,
      ['CREATE UNIQUE INDEX idx_reg_song_society ON society_registrations (song, society)'],
    );
    make('content_id_assets', [
      REL('recording', 'recordings', false),
      REL('song', 'songs', false),
      T('asset_id', 80),
      S('asset_type', ['sound_recording', 'composition', 'music_video', 'art_track', 'web']),
      // [{ territory, pct }]
      J('ownership', 20000),
      S('policy', ['monetize', 'track', 'block']),
      T('administrator', 200),
      S('status', ['active', 'inactive', 'conflict']),
      T('notes', 2000),
    ]);
    make('content_id_claims', [
      S('direction', ['incoming', 'outgoing'], true),
      T('video_url', 600),
      T('video_title', 300),
      T('channel', 200),
      T('claimant', 200),
      REL('asset', 'content_id_assets', false),
      REL('recording', 'recordings', false),
      S('status', ['open', 'disputed', 'appealed', 'released', 'upheld', 'expired', 'resolved'], true),
      D('received_date'),
      D('dispute_received'),
      D('appeal_received'),
      T('reason', 2000),
      T('notes', 2000),
    ]);
    make('cid_allowlist', [
      TR('channel_id', 120),
      T('name', 200),
      T('reason', 600),
      D('added_date'),
      REL('talent', 'talents', false),
      T('notes', 1000),
    ]);

    // --- trademarks and designs -------------------------------------------------------
    make('families', [
      S('kind', ['design', 'trademark'], true),
      TR('title', 300),
      REL('franchise', 'franchises', false),
      REL('character', 'characters', false),
      REL('talent', 'talents', false),
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
      // [{ script, value }]
      J('name_variants', 20000),
      T('vienna_codes', 300),
      T('disclaimer', 1000),
      T('transliteration', 300),
      T('translation', 300),
      T('description', 4000),
      T('products', 1000),
      S('strategy', ['maintain', 'review', 'prune', 'abandoned']),
      T('strategy_note', 2000),
      T('owner_entity', 200),
      D('announcement_date'),
      J('tags', 20000),
    ]);
    make(
      'matters',
      [
        T('ref', 40),
        S('ip_type', ['trademark', 'design'], true),
        TR('title', 400),
        REL('family', 'families', false),
        REL('franchise', 'franchises', false),
        REL('character', 'characters', false),
        REL('talent', 'talents', false),
        REL('work', 'titles', false),
        TR('jurisdiction', 3),
        S('route', ['national', 'regional', 'madrid', 'hague', 'designation', 'other']),
        S('relation', ['none', 'priority', 'designation', 'divisional', 'conversion', 'related']),
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
        T('tm_basis', 20),
        S('tm_register', ['principal', 'supplemental', 'na']),
        T('owner_of_record', 300),
        T('applicants', 600),
        T('counsel', 200),
        T('client_ref', 80),
        T('cost_center', 80),
        REL('responsible', 'users', false),
        REL('docketer', 'users', false),
        S('sync_source', ['none', 'uspto_tsdr', 'euipo', 'jpo']),
        B('sync_enabled'),
        S('sync_state', ['not_connected', 'connected', 'error', 'not_found']),
        D('last_synced'),
        T('sync_error', 1000),
        J('official_data', 400000),
        D('next_deadline'),
        T('next_deadline_title', 300),
        T('next_deadline_title_ja', 300),
        B('private_owner'),
        D('announcement_date'),
        D('last_use_evidence'),
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
    addRel('matters', 'parent', 'matters', false, false);
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

    // --- grants (scope of agreements, and committee windows) ---------------------------
    make(
      'grants',
      [
        REL('agreement', 'agreements', true),
        S('direction', ['in', 'out'], true),
        S('kind', ['grant', 'holdback', 'restriction', 'reservation', 'window'], true),
        B('exclusive'),
        // window holders (committee members' parties); split for shared windows
        REL('holders', 'parties', false, true),
        // [{ party, pct }]
        J('holder_split', 5000),
        N('fee_pct'),
        S('fee_base', ['gross', 'net']),
        REL('franchises', 'franchises', false, true),
        REL('works', 'titles', false, true),
        REL('characters', 'characters', false, true),
        REL('songs', 'songs', false, true),
        REL('recordings', 'recordings', false, true),
        REL('matters', 'matters', false, true),
        J('dims', 200000),
        D('term_start'),
        D('term_end'),
        T('rights_text', 4000),
        T('override_reason', 2000),
        PORTAL(),
      ],
      PORTAL_RULES,
      ['CREATE INDEX idx_grants_agreement ON grants (agreement)', 'CREATE INDEX idx_grants_kind ON grants (kind)'],
    );

    make(
      'dimensions',
      [TR('key', 40), TR('label', 80), T('label_ja', 80), N('order'), B('enabled'), T('description', 400)],
      REFERENCE_RULES,
      ['CREATE UNIQUE INDEX idx_dimensions_key ON dimensions (key)'],
    );
    make(
      'dimension_values',
      [
        TR('dimension', 40),
        TR('code', 40),
        TR('label', 120),
        T('label_ja', 120),
        T('parent_code', 40),
        N('order'),
        // Nice classes a product category maps to (category dimension only)
        J('classes', 2000),
      ],
      REFERENCE_RULES,
      ['CREATE UNIQUE INDEX idx_dimval ON dimension_values (dimension, code)'],
    );

    // --- permissions (inbound) and guidelines (outbound) ---------------------------------
    make('permissions', [
      TR('title', 300),
      S(
        'permission_type',
        [
          'game_title',
          'music_work',
          'master',
          'backing_track',
          'arrangement',
          'platform_blanket',
          'brand_tieup',
          'cross_agency_collab',
          'venue',
          'other',
        ],
        true,
      ),
      REL('counterparty', 'parties', false),
      T('subject_name', 300),
      S('source', ['public_guideline', 'contract', 'application']),
      T('guideline_url', 600),
      D('guideline_revision'),
      T('approval_id', 120),
      REL('agreement', 'agreements', false),
      B('all_talents'),
      REL('talents', 'talents', false, true),
      REL('characters', 'characters', false, true),
      // ["youtube", "twitch", ...]
      J('platforms', 5000),
      // ["ads", "super_chat", "membership", "sponsored", "paid_download"]
      J('monetization', 5000),
      S('archive', ['yes', 'live_only', 'no']),
      T('content_limits', 4000),
      T('credit_line', 400),
      T('regions', 300),
      D('start_date'),
      D('end_date'),
      S('status', ['active', 'pending_application', 'expired', 'revoked', 'suspended'], true),
      N('recheck_days'),
      D('last_checked'),
      T('notes', 4000),
    ]);
    make('guidelines', [
      TR('title', 300),
      S('kind', ['fan_work', 'clip', 'cover_song', 'ai_use', 'doujin_event', 'corporate', 'other'], true),
      REL('franchise', 'franchises', false),
      REL('talent', 'talents', false),
      REL('characters', 'characters', false, true),
      T('version', 40),
      D('effective_date'),
      J('languages', 2000),
      E('body'),
      E('body_ja'),
      T('changelog', 8000),
      S('status', ['draft', 'published', 'superseded'], true),
      T('url', 600),
      B('template'),
    ]);
    addRel('guidelines', 'supersedes', 'guidelines', false, false);
    make('fan_registrations', [
      S('kind', ['clip_channel', 'fan_permit', 'event_permit', 'fan_game', 'other'], true),
      T('permission_no', 40),
      TR('applicant_name', 200),
      S('applicant_type', ['individual', 'group', 'corporate']),
      T('contact', 300),
      T('channel_url', 600),
      T('platform', 60),
      REL('guideline', 'guidelines', false),
      REL('franchise', 'franchises', false),
      REL('characters', 'characters', false, true),
      REL('talents', 'talents', false, true),
      T('event_name', 200),
      D('event_date'),
      // [{ name, price, quantity }]
      J('items', 50000),
      N('royalty_pct'),
      N('seals_issued'),
      N('seals_returned'),
      B('monetized'),
      N('monthly_revenue'),
      S('status', ['applied', 'approved', 'active', 'rejected', 'suspended', 'expired', 'revoked'], true),
      D('start_date'),
      D('end_date'),
      T('notes', 4000),
    ]);

    // --- licensing desk ----------------------------------------------------------------
    make(
      'products',
      [
        T('ref', 40),
        TR('name', 300),
        T('sku', 80),
        T('jan', 20),
        REL('agreement', 'agreements', false),
        REL('licensee', 'parties', false),
        REL('franchise', 'franchises', false),
        REL('work', 'titles', false),
        REL('characters', 'characters', false, true),
        REL('talents', 'talents', false, true),
        T('category', 40),
        T('channel', 40),
        S('occasion', ['regular', 'birthday', 'anniversary', 'graduation', 'event', 'collab', 'campaign']),
        D('sales_start'),
        D('sales_end'),
        T('timezone', 40),
        S('sales_model', ['stock', 'made_to_order', 'preorder', 'lottery', 'gacha', 'prize']),
        D('ship_by'),
        N('retail_price'),
        T('currency', 3),
        B('digital'),
        D('digital_end'),
        B('includes_voice'),
        T('regions', 300),
        S(
          'stage',
          [
            'proposal',
            'contract',
            'concept',
            'design',
            'prototype',
            'final_sample',
            'packaging',
            'mass_production',
            'on_sale',
            'sell_off',
            'ended',
            'cancelled',
          ],
          true,
        ),
        D('sell_off_end'),
        F('images', 10, 20),
        T('notes', 4000),
        PORTAL(),
      ],
      PORTAL_RULES,
      ['CREATE UNIQUE INDEX idx_products_ref ON products (ref) WHERE ref != ""'],
    );
    const STAGES = [
      'proposal',
      'concept',
      'design',
      'color_proof',
      'prototype',
      'pre_production_sample',
      'final_sample',
      'packaging',
      'advertising',
      'mass_production_check',
    ];
    const APPROVAL_STATUS = ['submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'withdrawn'];
    make('approvals', [
      REL('product', 'products', true),
      REL('agreement', 'agreements', false),
      S('stage', STAGES, true),
      S('status', APPROVAL_STATUS, true),
      N('round'),
      D('submitted_at'),
      D('due_date'),
      // [{ key, label, label_ja, kind: internal | committee | original | talent | reviewer, user, party, decision: pending | approved | changes | rejected, comment, decided_at }]
      J('reviewers', 50000),
      REL('assigned_reviewers', 'users', false, true),
      S('timeout_outcome', ['none', 'deemed_refused', 'deemed_approved']),
      F('images', 10, 20),
      S('copyright_check', ['unchecked', 'ok', 'wrong']),
      T('draft_comments', 8000),
      REL('decided_by', 'users', false),
      D('decided_at'),
      T('notes', 4000),
      PORTAL(),
    ], PORTAL_RULES, ['CREATE INDEX idx_approvals_product ON approvals (product)']);
    make(
      'approval_rounds',
      [
        REL('approval', 'approvals', true),
        N('round'),
        S('stage', STAGES),
        S('status', APPROVAL_STATUS),
        T('reviewer_key', 60),
        T('comment', 4000),
        // [{ image, x, y, note }]
        J('annotations', 50000),
        F('images', 10, 20),
        REL('decided_by', 'users', false),
        T('decided_by_name', 200),
      ],
      {
        listRule: INTERNAL + ' || approval.portal_users.id ?= @request.auth.id',
        viewRule: INTERNAL + ' || approval.portal_users.id ?= @request.auth.id',
        createRule: EDITORS,
        updateRule: EDITORS,
        deleteRule: MANAGE,
      },
    );
    make('seal_orders', [
      REL('agreement', 'agreements', false),
      REL('product', 'products', false),
      REL('licensee', 'parties', false),
      N('quantity'),
      T('serial_from', 40),
      T('serial_to', 40),
      N('unit_cost'),
      T('currency', 3),
      D('ordered_date'),
      D('issued_date'),
      N('used'),
      N('void'),
      N('returned'),
      S('status', ['requested', 'issued', 'reconciled', 'cancelled'], true),
      T('notes', 2000),
      PORTAL(),
    ], PORTAL_RULES);

    // --- enforcement ----------------------------------------------------------------------
    make(
      'enforcement_cases',
      [
        T('ref', 40),
        TR('title', 300),
        S(
          'case_type',
          [
            'counterfeit',
            'impersonation',
            'piracy',
            'unauthorized_derivative',
            'clip_violation',
            'defamation',
            'harassment',
            'leak',
            'ai_misuse',
            'trademark_conflict',
            'content_id',
            'other',
          ],
          true,
        ),
        S('forum', [
          'marketplace',
          'dmca',
          'jp_platform',
          'sender_disclosure',
          'customs',
          'criminal',
          'cease_desist',
          'litigation',
          'coda',
          'opposition',
          'cancellation',
          'invalidation',
          'platform_report',
          'other',
        ]),
        S('role', ['offense', 'defense']),
        T('platform', 120),
        J('urls', 50000),
        T('their_party', 300),
        REL('franchise', 'franchises', false),
        REL('characters', 'characters', false, true),
        REL('talents', 'talents', false, true),
        REL('works', 'titles', false, true),
        REL('matters', 'matters', false, true),
        S('status', [
          'new',
          'investigating',
          'notice_sent',
          'takedown_requested',
          'removed',
          'counter_noticed',
          'disclosure_requested',
          'complaint_filed',
          'litigation',
          'settled',
          'won',
          'lost',
          'closed',
          'monitoring',
        ], true),
        D('opened_date'),
        D('request_sent'),
        D('counter_notice_date'),
        // { terms, penalty_amount, currency, monitor_until }
        J('settlement', 20000),
        T('outcome', 4000),
        T('counsel', 200),
        REL('assignee', 'users', false),
        T('draft_notice', 20000),
        E('notes'),
      ],
      RECORD_RULES,
      ['CREATE UNIQUE INDEX idx_cases_ref ON enforcement_cases (ref) WHERE ref != ""'],
    );
    make(
      'evidence',
      [
        REL('case_ref', 'enforcement_cases', true),
        S('kind', ['screenshot', 'page_archive', 'test_purchase', 'listing', 'video', 'document', 'other']),
        T('url', 1000),
        T('captured_at', 40),
        F('file', 5, 50),
        T('sha256', 80),
        REL('captured_by', 'users', false),
        D('preserve_until'),
        T('chain_note', 2000),
        T('notes', 2000),
      ],
      { listRule: INTERNAL, viewRule: INTERNAL, createRule: CONTRIB, updateRule: EDITORS, deleteRule: ADMIN },
    );
    make('platform_enrollments', [
      S(
        'platform',
        [
          'amazon_brand_registry',
          'mercari',
          'alibaba_ipp',
          'aidc_ipp',
          'ebay_vero',
          'rakuten',
          'yahoo_auctions',
          'youtube',
          'x',
          'tiktok',
          'other',
        ],
        true,
      ),
      T('account_id', 120),
      S('status', ['not_enrolled', 'applying', 'active', 'suspended', 'expired'], true),
      D('enrolled_date'),
      D('documents_valid_until'),
      N('requests_sent'),
      N('success_rate'),
      N('counter_notice_rate'),
      T('notes', 2000),
    ]);
    make('customs_recordations', [
      S('jurisdiction', ['JP', 'US', 'CN', 'EU', 'KR', 'TW', 'other'], true),
      REL('matter', 'matters', false),
      T('right_desc', 400),
      T('application_no', 80),
      D('filed_date'),
      D('accepted_date'),
      D('valid_until'),
      S('status', ['preparing', 'filed', 'accepted', 'expired', 'withdrawn'], true),
      T('notes', 2000),
    ]);
    make('watch_hits', [
      S('kind', ['trademark', 'marketplace', 'impersonation', 'web']),
      REL('family', 'families', false),
      REL('matter', 'matters', false),
      REL('character', 'characters', false),
      REL('talent', 'talents', false),
      REL('case_ref', 'enforcement_cases', false),
      TR('their_mark', 300),
      T('their_owner', 300),
      T('url', 1000),
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

    // --- committee consent and distributions ---------------------------------------------
    make(
      'consent_requests',
      [
        REL('committee', 'committees', true),
        TR('subject', 400),
        // the Can we? query that raised it
        J('use', 50000),
        REL('agreement', 'agreements', false),
        REL('product', 'products', false),
        REL('requested_by', 'users', false),
        D('requested_date'),
        D('due_date'),
        // [{ member, party, name, answer: pending | approve | refuse | no_answer, reason, date }]
        J('answers', 50000),
        S('status', ['open', 'approved', 'refused', 'withdrawn', 'expired'], true),
        T('outcome_note', 2000),
        PORTAL(),
      ],
      { listRule: PORTAL_READ, viewRule: PORTAL_READ, createRule: RIGHTS_EDIT, updateRule: RIGHTS_EDIT, deleteRule: MANAGE },
    );
    make(
      'distributions',
      [
        REL('committee', 'committees', true),
        D('period_start'),
        D('period_end'),
        T('currency', 3),
        // [{ window, holder, gross, deductions: [{ label, amount }], window_fee, net }]
        J('receipts', 200000),
        N('gross_total'),
        N('deductions_total'),
        N('window_fees'),
        N('lead_fee'),
        N('promo_fee'),
        N('success_fee'),
        N('pool'),
        // [{ member, party, name, share_pct, amount }]
        J('members', 50000),
        S('status', ['draft', 'issued', 'paid'], true),
        D('issued_date'),
        D('due_date'),
        T('notes', 2000),
        PORTAL(),
      ],
      { listRule: PORTAL_READ, viewRule: PORTAL_READ, createRule: RIGHTS_EDIT, updateRule: RIGHTS_EDIT, deleteRule: MANAGE },
    );

    // --- documents ------------------------------------------------------------------------
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
          'contract',
          'style_guide',
          'model_sheet',
          'statement',
          'invoice',
          'evidence',
          'specimen',
          'chain_of_title',
          'guideline_snapshot',
          'customs',
          'platform_notice',
          'sample_photo',
          'report',
          'other',
        ]),
        D('doc_date'),
        REL('matter', 'matters', false),
        REL('family', 'families', false),
        REL('agreement', 'agreements', false),
        REL('work', 'titles', false),
        REL('franchise', 'franchises', false),
        REL('character', 'characters', false),
        REL('talent', 'talents', false),
        REL('product', 'products', false),
        REL('approval', 'approvals', false),
        REL('committee', 'committees', false),
        REL('song', 'songs', false),
        REL('recording', 'recordings', false),
        REL('permission', 'permissions', false),
        REL('guideline', 'guidelines', false),
        REL('case_ref', 'enforcement_cases', false),
        S('source', ['upload', 'office', 'email', 'agent', 'portal']),
        J('extracted', 200000),
        T('summary', 8000),
        REL('uploaded_by', 'users', false),
        PORTAL(),
      ],
      {
        listRule: PORTAL_READ,
        viewRule: PORTAL_READ,
        createRule: CONTRIB,
        updateRule: CONTRIB,
        deleteRule: MANAGE,
      },
    );
    addRel('permissions', 'snapshot', 'documents', false, false);

    make(
      'royalty_reports',
      [
        REL('agreement', 'agreements', true),
        D('period_start'),
        D('period_end'),
        D('due_date'),
        D('received_date'),
        N('gross_sales'),
        N('royalty_due'),
        N('paid_amount'),
        N('mg_credit'),
        N('late_interest'),
        T('currency', 3),
        S('status', ['expected', 'received', 'paid', 'disputed', 'waived'], true),
        REL('document', 'documents', false),
        T('notes', 2000),
        PORTAL(),
      ],
      PORTAL_RULES,
      ['CREATE INDEX idx_royalty_agreement ON royalty_reports (agreement)'],
    );
    make(
      'royalty_lines',
      [
        REL('report', 'royalty_reports', true),
        REL('product', 'products', false),
        T('description', 300),
        T('territory', 40),
        N('manufactured_qty'),
        N('sold_qty'),
        N('retail_price'),
        N('wholesale_price'),
        N('rate'),
        N('royalty'),
        T('currency', 3),
        T('notes', 1000),
      ],
      {
        listRule: INTERNAL + ' || report.portal_users.id ?= @request.auth.id',
        viewRule: INTERNAL + ' || report.portal_users.id ?= @request.auth.id',
        createRule: EDITORS,
        updateRule: EDITORS,
        deleteRule: EDITORS,
      },
      ['CREATE INDEX idx_lines_report ON royalty_lines (report)'],
    );

    make('clearances', [
      REL('work', 'titles', true),
      REL('character', 'characters', false),
      REL('franchise', 'franchises', false),
      S(
        'item_type',
        [
          'original_work_license',
          'script',
          'character_design',
          'music_sync',
          'music_master',
          'voice_cast',
          'performer_consent',
          'footage',
          'artwork',
          'trademark_search',
          'title_search',
          'chain_of_title',
          'committee_consent',
          'ratings',
          'other',
        ],
        true,
      ),
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

    // --- events (history) and rules -----------------------------------------------------------
    const SUBJECT_RELS = (cascade) => [
      REL('matter', 'matters', cascade),
      REL('agreement', 'agreements', cascade),
      REL('work', 'titles', cascade),
      REL('character', 'characters', cascade),
      REL('talent', 'talents', cascade),
      REL('product', 'products', cascade),
      REL('approval', 'approvals', cascade),
      REL('permission', 'permissions', cascade),
      REL('committee', 'committees', cascade),
      REL('case_ref', 'enforcement_cases', cascade),
      REL('registration', 'society_registrations', cascade),
      REL('claim', 'content_id_claims', cascade),
      REL('recordation', 'customs_recordations', cascade),
      REL('society_contract', 'society_contracts', cascade),
      REL('fan_registration', 'fan_registrations', cascade),
      REL('enrollment', 'platform_enrollments', cascade),
    ];
    make(
      'events',
      SUBJECT_RELS(true).concat([
        TR('code', 60),
        T('label', 300),
        T('label_ja', 300),
        D('date'),
        S('source', ['manual', 'office', 'inbox', 'rule', 'system', 'portal']),
        REL('document', 'documents', false),
        J('data', 100000),
        REL('created_by', 'users', false),
      ]),
      RECORD_RULES,
      ['CREATE INDEX idx_events_matter ON events (matter)', 'CREATE INDEX idx_events_code ON events (code)'],
    );

    make(
      'rules',
      [
        TR('code', 80),
        TR('name', 300),
        T('name_ja', 300),
        TR('subject_type', 30),
        TR('jurisdiction', 3),
        J('routes', 5000),
        TR('trigger_event', 60),
        J('conditions', 20000),
        S(
          'base',
          [
            'event_date',
            'filing_date',
            'priority_date',
            'publication_date',
            'registration_date',
            'expiry_date',
            'signed_date',
            'term_end',
            'graduation_date',
            'debut_date',
            'valid_until',
            'end_date',
            'documents_valid_until',
          ],
          true,
        ),
        N('offset_years'),
        N('offset_months'),
        N('offset_days'),
        S('offset_unit', ['calendar', 'business']),
        B('due_end_of_month'),
        S('kind', DEADLINE_KINDS, true),
        S('category', CATEGORIES),
        TR('title', 300),
        T('title_ja', 300),
        J('extensions', 20000),
        N('final_offset_months'),
        N('final_offset_days'),
        N('window_months'),
        N('grace_months'),
        T('grace_note', 300),
        N('recurring_years'),
        N('recurring_until_years'),
        N('recurring_first_cycle'),
        T('cycle_label', 60),
        T('roll_office', 3),
        T('citation', 600),
        T('summary', 1000),
        T('summary_ja', 1000),
        T('notes', 2000),
        D('effective_from'),
        D('effective_to'),
        N('version'),
        B('enabled'),
        B('system'),
        B('creates_renewal'),
        T('fee_kind', 40),
      ],
      { listRule: INTERNAL, viewRule: INTERNAL, createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN },
      ['CREATE UNIQUE INDEX idx_rules_code_version ON rules (code, version)', 'CREATE INDEX idx_rules_trigger ON rules (trigger_event)'],
    );

    make(
      'office_calendars',
      [TR('office', 3), D('date'), TR('name', 200), S('source', ['computed', 'official', 'manual']), B('working_day')],
      { listRule: INTERNAL, viewRule: INTERNAL, createRule: MANAGE, updateRule: MANAGE, deleteRule: MANAGE },
      ['CREATE INDEX idx_cal_office ON office_calendars (office)'],
    );
    make(
      'calendar_years',
      [TR('office', 3), N('year')],
      { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null },
      ['CREATE UNIQUE INDEX idx_cal_years ON calendar_years (office, year)'],
    );

    // --- deadlines -------------------------------------------------------------------------------
    make(
      'deadlines',
      SUBJECT_RELS(true).concat([
        TR('title', 400),
        T('title_ja', 400),
        REL('family', 'families', false),
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
        S('source', ['rule', 'office', 'inbox', 'manual', 'agreement', 'system', 'playbook']),
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
        T('subject_type', 30),
        T('ref', 60),
        T('subject_label', 300),
        T('citation', 600),
        J('reminders_sent', 20000),
        T('notes', 4000),
      ]),
      {
        listRule: INTERNAL,
        viewRule: INTERNAL,
        createRule: EDITORS,
        updateRule: EDITORS,
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
        N('cycle'),
        N('cycle_to'),
        S('entity', ['any', 'large', 'small', 'micro']),
        B('per_class'),
        N('amount'),
        N('per_claim_amount'),
        J('class_tiers', 5000),
        TR('currency', 3),
        N('grace_surcharge'),
        B('surcharge_percent'),
        D('effective_from'),
        T('source', 400),
        T('notes', 600),
      ],
      { listRule: INTERNAL, viewRule: INTERNAL, createRule: MANAGE, updateRule: MANAGE, deleteRule: MANAGE },
    );
    make(
      'fx_rates',
      [TR('code', 3), N('per_eur'), D('as_of'), S('source', ['ecb', 'manual'])],
      REFERENCE_RULES,
      ['CREATE UNIQUE INDEX idx_fx_code ON fx_rates (code)'],
    );

    // --- inbox (the only door for automated data) ---------------------------------------------
    make(
      'inbox_items',
      [
        S(
          'kind',
          [
            'office_change',
            'document',
            'agreement_draft',
            'royalty_statement',
            'permission',
            'watch_hit',
            'agent_proposal',
            'email',
          ],
          true,
        ),
        TR('title', 400),
        T('summary', 4000),
        S('status', ['new', 'accepted', 'partially_accepted', 'rejected', 'awaiting_second'], true),
        T('subject_type', 30),
        REL('matter', 'matters', true),
        REL('agreement', 'agreements', false),
        REL('work', 'titles', false),
        REL('character', 'characters', false),
        REL('talent', 'talents', false),
        REL('product', 'products', false),
        REL('permission', 'permissions', false),
        REL('committee', 'committees', false),
        REL('case_ref', 'enforcement_cases', false),
        REL('document', 'documents', false),
        T('office', 20),
        J('proposal', 400000),
        J('diffs', 200000),
        S('confidence', ['high', 'medium', 'low', 'none']),
        J('citations', 100000),
        S('source', ['office_sync', 'agent', 'email', 'user', 'portal']),
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
        listRule: INTERNAL,
        viewRule: INTERNAL,
        createRule: CONTRIB,
        updateRule: null,
        deleteRule: ADMIN,
      },
      ['CREATE INDEX idx_inbox_status ON inbox_items (status)', 'CREATE INDEX idx_inbox_fp ON inbox_items (fingerprint)'],
    );

    // --- involvements (who plays which role on what) ---------------------------------------------
    make(
      'involvements',
      [
        REL('party', 'parties', true),
        S(
          'role',
          [
            'original_author',
            'author',
            'illustrator',
            'modeler',
            'composer',
            'lyricist',
            'arranger',
            'publisher',
            'label',
            'producer',
            'director',
            'screenwriter',
            'voice_actor',
            'performer',
            'singer',
            'owner',
            'applicant',
            'licensee',
            'licensor',
            'agent',
            'committee_member',
            'counsel',
            'contributor',
            'other',
          ],
          true,
        ),
        REL('matter', 'matters', true),
        REL('agreement', 'agreements', true),
        REL('work', 'titles', true),
        REL('character', 'characters', true),
        REL('song', 'songs', true),
        REL('recording', 'recordings', true),
        REL('family', 'families', true),
        N('share'),
        // per right category for music: { performance, mechanical, ... } (percent)
        J('shares', 5000),
        T('credit_name', 200),
        B('featured'),
        T('note', 600),
      ],
      RECORD_RULES,
      [
        'CREATE INDEX idx_inv_party ON involvements (party)',
        'CREATE INDEX idx_inv_song ON involvements (song)',
        'CREATE INDEX idx_inv_work ON involvements (work)',
      ],
    );

    // --- views, audit, notifications, sync runs, calendar feed tokens -----------------------------
    make(
      'saved_views',
      [
        TR('name', 200),
        TR('page', 40),
        J('filters', 50000),
        J('columns', 20000),
        S('scope', ['private', 'shared'], true),
        REL('owner', 'users', true),
        S('schedule', ['none', 'daily', 'weekly', 'monthly']),
        D('last_sent'),
      ],
      {
        listRule: '@request.auth.id != "" && (owner = @request.auth.id || scope = "shared")',
        viewRule: '@request.auth.id != "" && (owner = @request.auth.id || scope = "shared")',
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
        updateRule: 'owner = @request.auth.id',
        deleteRule: 'owner = @request.auth.id',
      },
    );
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
      { listRule: EDITORS, viewRule: EDITORS, createRule: null, updateRule: null, deleteRule: null },
      ['CREATE INDEX idx_audit_record ON audit_log (record_id)'],
    );
    make(
      'notifications',
      [
        REL('user', 'users', true),
        S('kind', ['digest', 'escalation', 'inbox', 'sync', 'assignment', 'approval', 'consent', 'portal', 'info'], true),
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
      { listRule: INTERNAL, viewRule: INTERNAL, createRule: null, updateRule: null, deleteRule: null },
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
      'inbox_items',
      'fx_rates',
      'fee_schedule',
      'renewals',
      'deadlines',
      'calendar_years',
      'office_calendars',
      'rules',
      'events',
      'clearances',
      'royalty_lines',
      'royalty_reports',
      'documents',
      'distributions',
      'consent_requests',
      'watch_hits',
      'customs_recordations',
      'platform_enrollments',
      'evidence',
      'enforcement_cases',
      'seal_orders',
      'approval_rounds',
      'approvals',
      'products',
      'fan_registrations',
      'guidelines',
      'permissions',
      'dimension_values',
      'dimensions',
      'grants',
      'goods_services',
      'matters',
      'families',
      'cid_allowlist',
      'content_id_claims',
      'content_id_assets',
      'society_registrations',
      'society_contracts',
      'releases',
      'recordings',
      'songs',
      'character_assets',
      'agreements',
      'committee_members',
      'committees',
      'castings',
      'talent_identity',
      'talents',
      'characters',
      'titles',
      'franchises',
      'parties',
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
