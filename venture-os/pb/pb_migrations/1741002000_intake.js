/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS intake (SPEC 7.6): the inbox of inbound and sourced deals.
 *
 *   scouts        people who send the firm deals (a member with the scout role, or an outside contact)
 *   intake_items  one inbound deal: a deck, a link, an email or a sourced candidate, with its reply due day,
 *                 its triage step (received, reading, facts, ready) and the verdict (advanced, passed, held, merged)
 *   facts         what your AI agent (or a person) read from the deck: one row per fact key, each with a grade
 *                 and a page anchor
 *   passes        a pass: reason chip, criterion, revisit milestone or day, the pass email's state
 *
 * Every rule is null: people and your AI agent reach these rows only through the intake operations.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, required) => ({ name: name, type: 'text', max: max, required: required === true });
    const int = (name) => ({ name: name, type: 'number', onlyInt: true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max });
    const date = (name) => ({ name: name, type: 'date' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const rel = (name, target) => ({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false });
    const actor = () => sel('actor', ['person', 'agent', 'system'], true);
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields.concat(stamps), indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };

    const FACT_KEYS = ['sector', 'subsector', 'stage', 'round_type', 'raise_minor', 'pre_money_minor', 'post_money_minor', 'currency', 'hq_country', 'founded_year', 'team_size', 'founders', 'technical_founder', 'prior_exit', 'revenue_minor', 'arr_minor', 'growth_mom_ppm', 'gross_margin_ppm', 'burn_minor', 'runway_months', 'customers', 'business_model', 'product_live', 'lead_investor', 'use_of_funds'];
    const GRADES = ['artifact', 'founder_reported', 'public', 'unverifiable', 'unknown'];
    const REASONS = ['team', 'market', 'product', 'traction', 'valuation', 'thesis_fit', 'timing', 'other'];

    make(
      'scouts',
      [txt('name', 160, true), txt('email', 200), rel('person', 'people'), rel('account', 'members'), sel('status', ['active', 'paused'], true), txt('note', 1000), actor(), rel('member', 'members')],
      ["CREATE UNIQUE INDEX idx_scouts_email ON scouts (email) WHERE email != ''", 'CREATE INDEX idx_scouts_account ON scouts (account)'],
    );

    make(
      'intake_items',
      [
        txt('number', 20, true),
        sel('channel', ['email', 'upload', 'scout', 'csv', 'sourced'], true),
        sel('status', ['new', 'held', 'passed', 'advanced', 'merged'], true),
        sel('step', ['received', 'reading', 'facts', 'ready'], true),
        sel('triage_state', ['none', 'waiting', 'working', 'done', 'failed'], true),
        txt('triage_job', 30),
        txt('triage_note', 2000),
        txt('name', 200),
        txt('one_liner', 300),
        rel('company', 'companies'),
        txt('guess_domain', 120),
        txt('website', 300),
        rel('source_person', 'people'),
        rel('scout', 'scouts'),
        rel('submitted_by', 'members'),
        rel('thesis', 'theses'),
        txt('url', 1000),
        sel('link_kind', ['docsend', 'papermark', 'drive', 'website']),
        sel('licence', ['public', 'internal_only'], true),
        txt('text', 100000),
        txt('message_id', 200),
        txt('thread_id', 200),
        txt('email_from', 300),
        txt('email_subject', 300),
        date('received_at'),
        txt('reply_due_day', 10),
        json('files', 20000),
        json('people', 20000),
        json('missing', 4000),
        json('questions', 20000),
        txt('hold_until', 10),
        txt('revisit_day', 10),
        rel('decided_by', 'members'),
        date('decided_at'),
        rel('deal', 'deals'),
        txt('pass', 30),
        txt('merged_into', 30),
        txt('note', 2000),
        json('prov', 20000),
        txt('run', 30),
        actor(),
        rel('member', 'members'),
      ],
      [
        'CREATE UNIQUE INDEX idx_intake_number ON intake_items (number)',
        "CREATE UNIQUE INDEX idx_intake_message ON intake_items (message_id) WHERE message_id != ''",
        'CREATE INDEX idx_intake_status ON intake_items (status, received_at)',
        'CREATE INDEX idx_intake_company ON intake_items (company)',
        'CREATE INDEX idx_intake_submitted ON intake_items (submitted_by)',
        'CREATE INDEX idx_intake_deal ON intake_items (deal)',
        'CREATE INDEX idx_intake_guess ON intake_items (guess_domain)',
      ],
    );

    make(
      'facts',
      [
        { name: 'item', type: 'relation', maxSelect: 1, collectionId: id('intake_items'), cascadeDelete: false, required: true },
        sel('key', FACT_KEYS, true),
        json('value', 4000),
        txt('currency', 3),
        sel('grade', GRADES, true),
        sel('num_kind', ['quoted', 'computed', 'external', 'entered']),
        sel('status', ['agent_proposed', 'confirmed'], true),
        sel('source', ['deck', 'email', 'public', 'person'], true),
        rel('file', 'files'),
        int('page'),
        txt('quote', 2000),
        rel('anchor', 'anchors'),
        txt('url', 1000),
        txt('note', 600),
        txt('run', 30),
        actor(),
        rel('member', 'members'),
      ],
      ['CREATE UNIQUE INDEX idx_facts_item_key ON facts (item, key)', 'CREATE INDEX idx_facts_key ON facts (key)'],
    );

    make(
      'passes',
      [
        { name: 'item', type: 'relation', maxSelect: 1, collectionId: id('intake_items'), cascadeDelete: false, required: true },
        rel('company', 'companies'),
        sel('reason', REASONS, true),
        txt('criterion', 300),
        txt('revisit_milestone', 300),
        txt('revisit_day', 10),
        sel('revisit_state', ['none', 'open', 'reopened', 'kept'], true),
        txt('note', 2000),
        sel('email_state', ['none', 'waiting', 'draft', 'sent', 'failed', 'cancelled'], true),
        rel('outbound', 'outbound'),
        json('to', 4000),
        txt('job', 30),
        json('snapshot', 60000),
        date('decided_at'),
        actor(),
        rel('member', 'members'),
      ],
      ['CREATE INDEX idx_passes_item ON passes (item)', 'CREATE INDEX idx_passes_company ON passes (company)', 'CREATE INDEX idx_passes_reason ON passes (reason, decided_at)'],
    );
  },
  (app) => {
    for (const name of ['passes', 'facts', 'intake_items', 'scouts']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
