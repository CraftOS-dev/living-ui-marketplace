/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS diligence: checklist templates, a deal's questions and the
 * answers your AI agent proposes and people confirm, comparison grids
 * (companies by questions) and the reference log.
 *
 *   dd_templates    checklists by key (seeded: seed, series_a): areas and
 *                   questions (key, area, text, type text|number|yes_no|date,
 *                   unit: '' | 'money' (a currency) | '%' | a word)
 *   dd_questions    one row per question on a deal; `state` open | proposed |
 *                   confirmed and `answer` (the answer shown) kept by the app
 *   dd_answers      a value typed by the question's type: value_text,
 *                   value_minor (unit is a currency), value_ppm (unit '%'),
 *                   value_e6 (any other unit, x 10^6), value_bool, value_day;
 *                   num_kind, grade, anchors (ids) and their quotes (cites),
 *                   public sources; status agent_proposed | confirmed |
 *                   rejected | superseded. A grid cell of a company without
 *                   a deal room is an answer on (grid, company, col_key).
 *   compare_grids   rows (companies, with their deal when they have a room)
 *                   and columns (questions by key)
 *   references      reference calls on a deal: kind, signal, a short note;
 *                   suggested by your AI agent, logged by people
 *
 * Every rule is null: people and your AI agent reach these only through
 * the app's operations.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max) => ({ name: name, type: 'text', max: max || 200 });
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members')];
    const TYPES = ['text', 'number', 'yes_no', 'date'];
    const GRADES = ['artifact', 'founder_reported', 'public', 'unverifiable', 'unknown'];

    make(
      'dd_templates',
      [req('key', 40), req('name', 80), json('areas', 20000), json('questions', 200000), bool('archived'), int('sort')].concat(written()).concat(stamps),
      ['CREATE UNIQUE INDEX idx_dd_templates_key ON dd_templates (`key`)'],
    );

    make(
      'compare_grids',
      [req('name', 120), json('rows', 50000), json('columns', 50000), sel('origin', ['deals', 'markets', 'manual'], true), txt('market_ref', 40), txt('deleted_at', 40), txt('run', 40)].concat(written()).concat(stamps),
      ['CREATE INDEX idx_compare_grids_member ON compare_grids (member)'],
    );

    make(
      'dd_questions',
      [
        rel('deal', 'deals', { required: true, cascadeDelete: true }),
        txt('key', 60),
        txt('template', 40),
        req('area', 40),
        txt('area_label', 60),
        req('text', 300),
        sel('type', TYPES, true),
        txt('unit', 20),
        int('sort'),
        sel('source', ['template', 'person', 'agent', 'grid'], true),
        sel('state', ['open', 'proposed', 'confirmed'], true),
        txt('checked_at', 40),
        txt('check_note', 600),
        txt('deleted_at', 40),
        txt('run', 40),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_dd_questions_key ON dd_questions (deal, `key`) WHERE `key` != ''", 'CREATE INDEX idx_dd_questions_deal ON dd_questions (deal, state)'],
    );

    make(
      'dd_answers',
      [
        rel('question', 'dd_questions', { cascadeDelete: true }),
        rel('deal', 'deals', { cascadeDelete: true }),
        rel('grid', 'compare_grids', { cascadeDelete: true }),
        rel('company', 'companies'),
        txt('col_key', 60),
        sel('type', TYPES, true),
        txt('value_text', 4000),
        int('value_minor'),
        int('value_ppm'),
        int('value_e6'),
        bool('value_bool'),
        txt('value_day', 10),
        txt('unit', 20),
        sel('num_kind', ['quoted', 'computed', 'external', 'entered']),
        txt('formula', 300),
        sel('grade', GRADES, true),
        json('anchors', 20000),
        json('cites', 200000),
        json('sources', 20000),
        txt('note', 600),
        sel('status', ['agent_proposed', 'confirmed', 'rejected', 'superseded'], true),
        txt('job', 20),
        txt('run', 40),
        rel('confirmed_by', 'members'),
        txt('confirmed_at', 40),
        rel('rejected_by', 'members'),
        txt('rejected_at', 40),
        sel('reason', ['wrong', 'unsupported', 'outdated', 'other']),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_dd_answers_question ON dd_answers (question, status)', 'CREATE INDEX idx_dd_answers_deal ON dd_answers (deal, status)', 'CREATE INDEX idx_dd_answers_grid ON dd_answers (grid, company, col_key)'],
    );

    const q = app.findCollectionByNameOrId('dd_questions');
    q.fields.add(new RelationField({ name: 'answer', maxSelect: 1, collectionId: id('dd_answers'), cascadeDelete: false }));
    app.save(q);

    make(
      'references',
      [
        rel('deal', 'deals', { required: true, cascadeDelete: true }),
        rel('person', 'people'),
        txt('name', 120),
        txt('title', 120),
        rel('company', 'companies'),
        rel('founder', 'people'),
        sel('kind', ['provided', 'backchannel', 'customer', 'expert'], true),
        sel('signal', ['positive', 'neutral', 'negative']),
        txt('note', 600),
        sel('status', ['suggested', 'logged', 'dismissed'], true),
        json('why', 4000),
        txt('day', 10),
        rel('called_by', 'members'),
        txt('job', 20),
        txt('run', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_references_deal ON `references` (deal, status)', 'CREATE INDEX idx_references_person ON `references` (person)'],
    );

    // The two seeded checklists. unit: 'money' = a currency the answer names, '%' = percent, else the unit word.
    const AREAS = [
      ['team', 'Team'],
      ['market', 'Market'],
      ['product', 'Product'],
      ['traction', 'Traction'],
      ['financials', 'Financials'],
      ['legal', 'Legal'],
      ['technology', 'Technology'],
      ['customers', 'Customers'],
    ].map((a) => ({ key: a[0], label: a[1] }));
    const Q = (key, area, text, type, unit) => ({ key: key, area: area, text: text, type: type, unit: unit || '' });
    const SEED = [
      Q('team_fulltime', 'team', 'Are all founders full time?', 'yes_no'),
      Q('team_size', 'team', 'Full-time team size', 'number', 'people'),
      Q('team_technical', 'team', 'Is there a technical founder?', 'yes_no'),
      Q('team_market_years', 'team', 'Founders\' years in this market', 'number', 'years'),
      Q('team_prior', 'team', 'Founders\' prior startups', 'text'),
      Q('team_vesting', 'team', 'Do founder shares vest?', 'yes_no'),
      Q('team_hires', 'team', 'Key hires planned this year', 'text'),
      Q('market_tam', 'market', 'Total addressable market', 'number', 'money'),
      Q('market_sam', 'market', 'Serviceable market', 'number', 'money'),
      Q('market_growth', 'market', 'Market growth per year', 'number', '%'),
      Q('market_competitors', 'market', 'Main competitors', 'text'),
      Q('market_why_now', 'market', 'Why now', 'text'),
      Q('market_regulated', 'market', 'Regulated market?', 'yes_no'),
      Q('product_live', 'product', 'Is the product live?', 'yes_no'),
      Q('product_launch', 'product', 'Launch date', 'date'),
      Q('product_stage', 'product', 'Product stage', 'text'),
      Q('product_edge', 'product', 'Main differentiation', 'text'),
      Q('product_roadmap', 'product', 'Roadmap for the next 12 months', 'text'),
      Q('product_patents', 'product', 'Patents filed', 'number', 'patents'),
      Q('traction_revenue', 'traction', 'Revenue, last 12 months', 'number', 'money'),
      Q('traction_arr', 'traction', 'Current ARR', 'number', 'money'),
      Q('traction_growth', 'traction', 'Month on month growth', 'number', '%'),
      Q('traction_customers', 'traction', 'Paying customers', 'number', 'customers'),
      Q('traction_pilots', 'traction', 'Active pilots', 'number', 'pilots'),
      Q('traction_churn', 'traction', 'Monthly churn', 'number', '%'),
      Q('traction_pipeline', 'traction', 'Sales pipeline value', 'number', 'money'),
      Q('fin_raise', 'financials', 'Amount raised in this round', 'number', 'money'),
      Q('fin_valuation', 'financials', 'Pre-money valuation or cap', 'number', 'money'),
      Q('fin_burn', 'financials', 'Monthly net burn', 'number', 'money'),
      Q('fin_cash', 'financials', 'Cash in bank', 'number', 'money'),
      Q('fin_runway', 'financials', 'Runway', 'number', 'months'),
      Q('fin_raised_total', 'financials', 'Total raised to date', 'number', 'money'),
      Q('fin_use_of_funds', 'financials', 'Use of funds', 'text'),
      Q('legal_jurisdiction', 'legal', 'Company jurisdiction', 'text'),
      Q('legal_ip_assigned', 'legal', 'IP assigned to the company?', 'yes_no'),
      Q('legal_clean_cap', 'legal', 'Cap table without dead equity?', 'yes_no'),
      Q('legal_litigation', 'legal', 'Pending litigation?', 'yes_no'),
      Q('legal_instrument', 'legal', 'Round instrument', 'text'),
      Q('legal_incorporated', 'legal', 'Incorporation date', 'date'),
      Q('tech_core', 'technology', 'Core technology', 'text'),
      Q('tech_proprietary', 'technology', 'Proprietary technology?', 'yes_no'),
      Q('tech_engineers', 'technology', 'Engineers on the team', 'number', 'people'),
      Q('tech_security', 'technology', 'Security certifications', 'text'),
      Q('tech_dependencies', 'technology', 'Critical third-party dependencies', 'text'),
      Q('tech_risk', 'technology', 'Main technical risk', 'text'),
      Q('cust_top_share', 'customers', 'Revenue share of the top customer', 'number', '%'),
      Q('cust_acv', 'customers', 'Average contract value', 'number', 'money'),
      Q('cust_cac', 'customers', 'Customer acquisition cost', 'number', 'money'),
      Q('cust_payback', 'customers', 'CAC payback', 'number', 'months'),
      Q('cust_segment', 'customers', 'Target customer segment', 'text'),
      Q('cust_references', 'customers', 'Customer references offered', 'number', 'references'),
    ];
    const SERIES_A = [
      Q('team_fulltime', 'team', 'Are all founders full time?', 'yes_no'),
      Q('team_size', 'team', 'Full-time team size', 'number', 'people'),
      Q('team_leadership', 'team', 'Leadership team in place', 'text'),
      Q('team_open_roles', 'team', 'Key open roles', 'text'),
      Q('team_attrition', 'team', 'Staff attrition, last 12 months', 'number', '%'),
      Q('team_vesting', 'team', 'Do founder shares vest?', 'yes_no'),
      Q('team_board', 'team', 'Board composition', 'text'),
      Q('team_pool', 'team', 'Unallocated option pool', 'number', '%'),
      Q('market_tam', 'market', 'Total addressable market', 'number', 'money'),
      Q('market_sam', 'market', 'Serviceable market', 'number', 'money'),
      Q('market_growth', 'market', 'Market growth per year', 'number', '%'),
      Q('market_share', 'market', 'Share of the target segment', 'number', '%'),
      Q('market_competitors', 'market', 'Main competitors', 'text'),
      Q('market_why_now', 'market', 'Why now', 'text'),
      Q('market_regulated', 'market', 'Regulated market?', 'yes_no'),
      Q('market_next', 'market', 'Next markets or regions', 'text'),
      Q('product_live', 'product', 'Is the product live?', 'yes_no'),
      Q('product_launch', 'product', 'Launch date', 'date'),
      Q('product_edge', 'product', 'Main differentiation', 'text'),
      Q('product_roadmap', 'product', 'Roadmap for the next 12 months', 'text'),
      Q('product_wau', 'product', 'Weekly active users', 'number', 'users'),
      Q('product_retention', 'product', 'Logo retention, 12 months', 'number', '%'),
      Q('product_nps', 'product', 'Net promoter score', 'number', 'points'),
      Q('product_patents', 'product', 'Patents filed', 'number', 'patents'),
      Q('traction_revenue', 'traction', 'Revenue, last 12 months', 'number', 'money'),
      Q('traction_arr', 'traction', 'Current ARR', 'number', 'money'),
      Q('traction_growth', 'traction', 'Month on month growth', 'number', '%'),
      Q('traction_yoy', 'traction', 'ARR growth, year on year', 'number', '%'),
      Q('traction_customers', 'traction', 'Paying customers', 'number', 'customers'),
      Q('traction_nrr', 'traction', 'Net revenue retention', 'number', '%'),
      Q('traction_churn', 'traction', 'Monthly churn', 'number', '%'),
      Q('traction_pipeline', 'traction', 'Sales pipeline value', 'number', 'money'),
      Q('traction_cycle', 'traction', 'Average sales cycle', 'number', 'days'),
      Q('traction_ltv_cac', 'traction', 'LTV to CAC', 'number', 'x'),
      Q('fin_raise', 'financials', 'Amount raised in this round', 'number', 'money'),
      Q('fin_valuation', 'financials', 'Pre-money valuation', 'number', 'money'),
      Q('fin_gross_margin', 'financials', 'Gross margin', 'number', '%'),
      Q('fin_burn', 'financials', 'Monthly net burn', 'number', 'money'),
      Q('fin_cash', 'financials', 'Cash in bank', 'number', 'money'),
      Q('fin_runway', 'financials', 'Runway', 'number', 'months'),
      Q('fin_burn_multiple', 'financials', 'Burn multiple', 'number', 'x'),
      Q('fin_raised_total', 'financials', 'Total raised to date', 'number', 'money'),
      Q('fin_audited', 'financials', 'Audited accounts?', 'yes_no'),
      Q('fin_use_of_funds', 'financials', 'Use of funds', 'text'),
      Q('legal_jurisdiction', 'legal', 'Company jurisdiction', 'text'),
      Q('legal_ip_assigned', 'legal', 'IP assigned to the company?', 'yes_no'),
      Q('legal_clean_cap', 'legal', 'Cap table without dead equity?', 'yes_no'),
      Q('legal_litigation', 'legal', 'Pending litigation?', 'yes_no'),
      Q('legal_prior_terms', 'legal', 'Prior round terms', 'text'),
      Q('legal_contracts', 'legal', 'Material contracts', 'text'),
      Q('legal_privacy', 'legal', 'Data protection compliant?', 'yes_no'),
      Q('legal_incorporated', 'legal', 'Incorporation date', 'date'),
      Q('tech_core', 'technology', 'Core technology', 'text'),
      Q('tech_proprietary', 'technology', 'Proprietary technology?', 'yes_no'),
      Q('tech_engineers', 'technology', 'Engineers on the team', 'number', 'people'),
      Q('tech_security', 'technology', 'Security certifications', 'text'),
      Q('tech_uptime', 'technology', 'Uptime, last 12 months', 'number', '%'),
      Q('tech_debt', 'technology', 'Main technical debt', 'text'),
      Q('tech_dependencies', 'technology', 'Critical third-party dependencies', 'text'),
      Q('tech_risk', 'technology', 'Main technical risk', 'text'),
      Q('cust_top_share', 'customers', 'Revenue share of the top customer', 'number', '%'),
      Q('cust_top10_share', 'customers', 'Revenue share of the top 10 customers', 'number', '%'),
      Q('cust_acv', 'customers', 'Average contract value', 'number', 'money'),
      Q('cust_cac', 'customers', 'Customer acquisition cost', 'number', 'money'),
      Q('cust_payback', 'customers', 'CAC payback', 'number', 'months'),
      Q('cust_references', 'customers', 'Customer references offered', 'number', 'references'),
      Q('cust_segment', 'customers', 'Target customer segment', 'text'),
      Q('cust_logos', 'customers', 'Notable customers', 'text'),
    ];
    const tpl = app.findCollectionByNameOrId('dd_templates');
    [
      ['seed', 'Seed', SEED, 1],
      ['series_a', 'Series A', SERIES_A, 2],
    ].forEach((t) => {
      const r = new Record(tpl);
      r.set('key', t[0]);
      r.set('name', t[1]);
      r.set('areas', AREAS);
      r.set('questions', t[2]);
      r.set('archived', false);
      r.set('sort', t[3]);
      r.set('actor', 'system');
      app.save(r);
    });
  },
  (app) => {
    try {
      const q = app.findCollectionByNameOrId('dd_questions');
      q.fields.removeByName('answer');
      app.save(q);
    } catch {
      /* already gone */
    }
    for (const n of ['references', 'dd_answers', 'dd_questions', 'compare_grids', 'dd_templates']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
