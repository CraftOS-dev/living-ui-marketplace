/// <reference path="../pb_data/types.d.ts" />
/**
 * Company OS, full schema. Multi-user mode: every collection requires an
 * authenticated user. Enums are PB select fields (typed, never free text);
 * cross-record links are real PB relations (parents saved before children so
 * collectionId is available). The starter `items` collection is dropped , 
 * this app never uses it.
 */
migrate(
  (app) => {
    // Drop the scaffold starter collection (new migration, never an edit).
    try {
      app.delete(app.findCollectionByNameOrId('items'));
    } catch {
      /* already absent */
    }

    const AUTH = '@request.auth.id != ""';
    const RULES = {
      listRule: AUTH,
      viewRule: AUTH,
      createRule: AUTH,
      updateRule: AUTH,
      deleteRule: AUTH,
    };
    const TS = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const T = (name, max) => ({ name: name, type: 'text', max: max || 0 });
    const TR = (name, max) => ({ name: name, type: 'text', required: true, max: max || 0 });
    const N = (name) => ({ name: name, type: 'number' });
    const B = (name) => ({ name: name, type: 'bool' });
    const D = (name) => ({ name: name, type: 'date' });
    const J = (name) => ({ name: name, type: 'json', maxSize: 250000 });
    const S = (name, values, required) => ({
      name: name,
      type: 'select',
      maxSelect: 1,
      values: values,
      required: required === true,
    });
    const REL = (name, target, cascade) => ({
      name: name,
      type: 'relation',
      maxSelect: 1,
      collectionId: app.findCollectionByNameOrId(target).id,
      cascadeDelete: cascade === true,
    });

    function make(name, fields, indexes) {
      const c = new Collection(
        Object.assign({ type: 'base', name: name, fields: fields.concat(TS) }, RULES),
      );
      if (indexes && indexes.length) c.indexes = indexes;
      app.save(c);
    }

    // --- Core: company singleton + modules + journey + suggestions -------
    make('company', [
      TR('name', 160),
      T('what_it_does', 2000),
      S('company_type', ['services', 'retail_ecommerce', 'food_hospitality', 'software_digital', 'other'], true),
      S('stage', ['validate', 'setup', 'first_customers', 'grow', 'scale'], true),
      S('team_size', ['solo', 'two_five', 'six_fifteen', 'sixteen_fifty', 'fifty_plus']),
      J('focus'), // wizard multi-select of focus areas
      J('vocab'), // vocabulary pack derived from company_type
      B('onboarding_done'),
      REL('owner', 'users', false),
      // One-page plan (Company Profile)
      T('mission', 2000),
      T('who_we_serve', 2000),
      T('offer', 2000),
      T('how_money', 2000),
      J('values_list'),
      T('three_year_picture', 3000),
      T('year_goals', 3000),
      N('cash_on_hand'),
    ]);

    make(
      'modules',
      [
        S('key', ['customers', 'money', 'projects', 'goals', 'team', 'meetings', 'processes', 'marketing'], true),
        B('active'),
        B('suggested'),
        D('activated_at'),
      ],
      ['CREATE UNIQUE INDEX idx_modules_key ON modules (key)'],
    );

    make(
      'journey_steps',
      [
        S('stage', ['validate', 'setup', 'first_customers', 'grow', 'scale'], true),
        N('order'),
        TR('title', 200),
        T('why', 500),
        S('kind', ['module', 'attest', 'form'], true),
        T('module_key', 40), // sidebar target when kind=module
        T('auto_rule', 60), // code key for journey.autocheck; empty = manual
        S('status', ['open', 'done'], true),
        D('done_at'),
        B('auto_done'), // set when auto-detected (vs manual attest)
      ],
      ['CREATE INDEX idx_journey_stage ON journey_steps (stage)'],
    );

    make('suggestions', [
      S('kind', ['stage_advance', 'module_unlock', 'follow_up', 'runway', 'info'], true),
      TR('title', 200),
      T('body', 1000),
      J('payload'),
      S('status', ['open', 'accepted', 'dismissed'], true),
    ]);

    // --- Records: parents first (relation targets) -----------------------
    make('team_members', [
      TR('name', 120),
      T('email', 255),
      T('note', 1000),
      B('active'),
    ]);

    make('customers', [
      TR('name', 160),
      B('is_org'),
      T('pipeline_stage', 40), // values come from the company vocab pack
      T('email', 255),
      T('phone', 60),
      N('value'),
      D('follow_up'),
      T('note', 3000),
    ]);

    make('projects', [
      TR('name', 160),
      S('status', ['active', 'done', 'archived'], true),
      D('due'),
      T('note', 2000),
    ]);

    make('meetings', [
      TR('name', 120),
      S('cadence', ['weekly', 'monthly', 'quarterly', 'yearly'], true),
      J('agenda'), // list of agenda point strings
    ]);

    make('metrics', [
      TR('name', 120),
      REL('owner_member', 'team_members', false),
      N('goal'),
      T('unit', 30),
      S('direction', ['up', 'down'], true), // which way is good
      N('order'),
      B('active'),
    ]);

    make('channels', [
      TR('name', 120),
      N('monthly_cost'),
      T('note', 1000),
      B('active'),
    ]);

    // --- Children (relations) -------------------------------------------
    make('invoices', [
      TR('number', 60),
      REL('customer', 'customers', false),
      N('amount'),
      S('status', ['draft', 'sent', 'paid'], true),
      D('issued'),
      D('due'),
      B('recorded'), // money-in entry created from this invoice
      T('note', 1000),
    ]);

    make(
      'tasks',
      [
        REL('project', 'projects', true),
        TR('title', 300),
        S('status', ['todo', 'doing', 'done'], true),
        T('owner', 120),
        D('due'),
        N('order'),
      ],
      ['CREATE INDEX idx_tasks_project ON tasks (project)'],
    );

    make('seats', [
      TR('name', 120),
      J('responsibilities'), // up to 5 strings
      REL('accountable', 'team_members', false),
    ]);

    make('candidates', [
      TR('name', 120),
      T('seat', 120),
      S('stage', ['applied', 'screening', 'interview', 'offer', 'hired', 'passed'], true),
      T('note', 2000),
    ]);

    make('priorities', [
      TR('title', 200),
      T('quarter', 20), // e.g. 2026-Q3
      REL('owner_member', 'team_members', false),
      S('status', ['on_track', 'at_risk', 'done'], true),
      T('note', 1000),
    ]);

    make('goals', [
      TR('title', 200),
      N('year'),
      T('measure', 300), // advanced, optional
      S('status', ['active', 'reached', 'dropped'], true),
    ]);

    make(
      'metric_entries',
      [
        REL('metric', 'metrics', true),
        D('week_start'),
        N('value'),
      ],
      ['CREATE UNIQUE INDEX idx_metric_week ON metric_entries (metric, week_start)'],
    );

    make('processes', [
      TR('name', 160),
      T('category', 80),
      REL('owner_member', 'team_members', false),
      J('steps'), // list of step strings
    ]);

    make(
      'meeting_notes',
      [REL('meeting', 'meetings', true), D('date'), T('notes', 8000), T('decisions', 3000)],
      ['CREATE INDEX idx_meeting_notes ON meeting_notes (meeting)'],
    );

    make('issues', [
      TR('title', 300),
      T('detail', 3000),
      S('status', ['open', 'solved'], true),
      T('solution', 2000),
    ]);

    make('promos', [
      TR('title', 200),
      REL('channel', 'channels', false),
      D('date'),
      S('status', ['idea', 'planned', 'done'], true),
      T('note', 1000),
    ]);

    make('money_entries', [
      S('kind', ['in', 'out'], true),
      N('amount'),
      T('category', 80),
      T('note', 500),
      D('date'),
    ]);

    make('notes', [
      TR('title', 200),
      T('category', 80),
      T('body', 30000),
      B('pinned'),
    ]);

    make('workflow_runs', [
      S('workflow', ['weekly_digest', 'journey_autocheck', 'stage_check', 'attention_sweep'], true),
      S('status', ['ok', 'error'], true),
      T('summary', 3000),
      D('finished'),
    ]);
  },
  (app) => {
    const names = [
      'workflow_runs', 'notes', 'money_entries', 'promos', 'issues', 'meeting_notes',
      'processes', 'metric_entries', 'goals', 'priorities', 'candidates', 'seats',
      'tasks', 'invoices', 'channels', 'metrics', 'meetings', 'projects', 'customers',
      'team_members', 'suggestions', 'journey_steps', 'modules', 'company',
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
