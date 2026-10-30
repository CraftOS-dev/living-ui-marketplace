/// <reference path="../pb_data/types.d.ts" />
/**
 * CRM schema (one person and their AI agent, auth mode none,
 * loopback only).
 *
 * Money is an integer count of the currency's minor unit (cents). Dates are
 * text YYYY-MM-DD; moments (last interaction, stage entered) are ISO text.
 * Collections can be read by the UI (live updates) and are written only
 * through the operations, which validate every change, decide what the AI
 * agent may write and what it may only propose, and log every change with
 * its undo.
 *
 *   settings      one row: the workspace, your name, home currency, the AI
 *                 agent's policy (autonomy per kind of change, house rules)
 *   companies     organizations, keyed on their root domain
 *   people        contacts, keyed on their email addresses
 *   employments   job history (person, company, title, from, to)
 *   pipelines     sales, fundraising, hiring, partnerships ...; stages
 *                 their columns (probability, won/lost, rotting, target)
 *   deals         opportunities in a pipeline; deal_people who is on a deal
 *                 and in what role; stage_events every stage change
 *   lists         lighter processes over people or companies; list_entries
 *   fields        custom fields per object (values live in record.custom)
 *   notes, interactions, tasks, emails   the work on a record
 *   proposals     changes the AI agent proposed for the person to decide
 *   views         saved filters, sorts and columns
 *   aliases       merged record ids -> the surviving record
 *   dupe_ignores  pairs the person said are not duplicates
 *   fx_rates      exchange rates to the home currency
 *   asks          questions and jobs for the AI agent
 *   activity      every change with who made it and its undo
 */
migrate(
  (app) => {
    /* ----------------------------------------------------------- the schema */
    const read = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const stamp = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const save = (def) => {
      const c = new Collection(Object.assign({ type: 'base' }, read, def, { fields: def.fields.concat(stamp) }));
      app.save(c);
      return c;
    };
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: '^$|^\\d{4}-\\d{2}-\\d{2}$' });
    const text = (name, max) => ({ name: name, type: 'text', max: max });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 200000 });
    const rel = (name, c, cascade, max) => ({ name: name, type: 'relation', collectionId: c.id, maxSelect: max || 1, cascadeDelete: !!cascade });
    const sel = (name, values) => ({ name: name, type: 'select', maxSelect: 1, values: values });
    const agentState = sel('agent_state', ['waiting', 'working', 'done', 'failed']);

    save({
      name: 'settings',
      fields: [text('workspace', 120), text('owner_name', 80), text('home_currency', 3), { name: 'keep_in_touch_default', type: 'number' }, json('policy', 40000), json('ui', 20000), day('brief_last'), { name: 'setup_done', type: 'bool' }],
    });

    const companies = save({
      name: 'companies',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        json('domains', 20000),
        text('primary_domain', 253),
        text('industry', 80),
        text('size', 20),
        text('location', 160),
        text('description', 2000),
        text('linkedin', 300),
        text('source', 80),
        json('tags', 20000),
        text('last_interaction', 30),
        { name: 'strength', type: 'number' },
        json('custom', 100000),
        json('prov', 40000),
        agentState,
        text('agent_note', 500),
        text('deleted', 30),
        text('merged_into', 15),
      ],
      indexes: ['CREATE INDEX idx_companies_domain ON companies (primary_domain)', 'CREATE INDEX idx_companies_deleted ON companies (deleted)'],
    });

    const people = save({
      name: 'people',
      fields: [
        text('first_name', 80),
        text('last_name', 80),
        json('emails', 20000),
        text('primary_email', 254),
        json('phones', 20000),
        text('title', 160),
        rel('company', companies, false),
        text('linkedin', 300),
        text('location', 160),
        text('birthday', 10),
        text('how_met', 500),
        text('source', 80),
        json('tags', 20000),
        { name: 'keep_in_touch', type: 'number' },
        text('last_interaction', 30),
        day('next_touch'),
        { name: 'strength', type: 'number' },
        { name: 'touches', type: 'number' },
        json('custom', 100000),
        json('prov', 40000),
        agentState,
        text('agent_note', 500),
        text('deleted', 30),
        text('merged_into', 15),
      ],
      indexes: ['CREATE INDEX idx_people_email ON people (primary_email)', 'CREATE INDEX idx_people_company ON people (company)', 'CREATE INDEX idx_people_deleted ON people (deleted)'],
    });

    save({
      name: 'employments',
      fields: [rel('person', people, true), rel('company', companies, true), text('title', 160), day('start'), day('end'), { name: 'current', type: 'bool' }],
      indexes: ['CREATE INDEX idx_employments_person ON employments (person)', 'CREATE INDEX idx_employments_company ON employments (company)'],
    });

    const pipelines = save({
      name: 'pipelines',
      fields: [{ name: 'name', type: 'text', required: true, max: 80 }, sel('kind', ['sales', 'fundraising', 'hiring', 'partnerships', 'other']), text('currency', 3), { name: 'target', type: 'number' }, { name: 'position', type: 'number' }, { name: 'archived', type: 'bool' }],
    });

    const stages = save({
      name: 'stages',
      fields: [
        rel('pipeline', pipelines, true),
        { name: 'name', type: 'text', required: true, max: 60 },
        { name: 'position', type: 'number' },
        sel('kind', ['open', 'won', 'lost']),
        { name: 'probability', type: 'number' },
        { name: 'rot_days', type: 'number' },
        { name: 'target_days', type: 'number' },
        text('color', 20),
      ],
      indexes: ['CREATE INDEX idx_stages_pipeline ON stages (pipeline)'],
    });

    const deals = save({
      name: 'deals',
      fields: [
        { name: 'name', type: 'text', required: true, max: 200 },
        rel('pipeline', pipelines, false),
        rel('stage', stages, false),
        sel('status', ['open', 'won', 'lost']),
        { name: 'value', type: 'number' },
        text('currency', 3),
        { name: 'home_value', type: 'number' },
        { name: 'prob_override', type: 'number' },
        day('expected_close'),
        day('closed_at'),
        text('lost_reason', 300),
        rel('company', companies, false),
        text('source', 80),
        text('next_step', 300),
        day('next_step_date'),
        text('stage_entered', 30),
        text('last_activity', 30),
        { name: 'position', type: 'number' },
        json('tags', 20000),
        json('custom', 100000),
        json('prov', 40000),
        text('deleted', 30),
        text('merged_into', 15),
      ],
      indexes: ['CREATE INDEX idx_deals_pipeline ON deals (pipeline, stage)', 'CREATE INDEX idx_deals_company ON deals (company)', 'CREATE INDEX idx_deals_deleted ON deals (deleted)'],
    });

    save({
      name: 'deal_people',
      fields: [rel('deal', deals, true), rel('person', people, true), text('role', 60)],
      indexes: ['CREATE UNIQUE INDEX idx_deal_people ON deal_people (deal, person)', 'CREATE INDEX idx_deal_people_person ON deal_people (person)'],
    });

    save({
      name: 'stage_events',
      fields: [rel('deal', deals, true), text('pipeline', 15), text('from_stage', 15), text('to_stage', 15), text('at', 30), text('actor', 12), text('run', 24)],
      indexes: ['CREATE INDEX idx_stage_events_deal ON stage_events (deal)', 'CREATE INDEX idx_stage_events_at ON stage_events (at)'],
    });

    const lists = save({
      name: 'lists',
      fields: [{ name: 'name', type: 'text', required: true, max: 80 }, sel('object', ['people', 'companies']), text('color', 20), { name: 'position', type: 'number' }, text('description', 300)],
    });

    save({
      name: 'list_entries',
      fields: [rel('list', lists, true), rel('person', people, true), rel('company', companies, true), text('note', 300)],
      indexes: ['CREATE INDEX idx_list_entries_list ON list_entries (list)', 'CREATE INDEX idx_list_entries_person ON list_entries (person)', 'CREATE INDEX idx_list_entries_company ON list_entries (company)'],
    });

    save({
      name: 'fields',
      fields: [
        sel('object', ['people', 'companies', 'deals']),
        { name: 'key', type: 'text', required: true, max: 40 },
        { name: 'label', type: 'text', required: true, max: 60 },
        sel('type', ['text', 'number', 'currency', 'date', 'select', 'multi_select', 'checkbox', 'url', 'rating']),
        json('options', 20000),
        text('ai_prompt', 1000),
        { name: 'position', type: 'number' },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_fields_key ON fields (object, key)'],
    });

    const notes = save({
      name: 'notes',
      fields: [{ name: 'body', type: 'text', required: true, max: 20000 }, rel('person', people, true), rel('company', companies, true), rel('deal', deals, true), { name: 'pinned', type: 'bool' }, text('by', 12), text('run', 24)],
      indexes: ['CREATE INDEX idx_notes_person ON notes (person)', 'CREATE INDEX idx_notes_company ON notes (company)', 'CREATE INDEX idx_notes_deal ON notes (deal)'],
    });

    const interactions = save({
      name: 'interactions',
      fields: [
        sel('kind', ['email', 'call', 'meeting', 'message']),
        sel('direction', ['in', 'out']),
        text('at', 30),
        text('subject', 200),
        text('summary', 8000),
        rel('people', people, true, 50),
        rel('company', companies, true),
        rel('deal', deals, true),
        text('source', 40),
        text('ext_id', 200),
        text('by', 12),
        text('run', 24),
        agentState,
        text('agent_note', 500),
      ],
      indexes: ['CREATE INDEX idx_interactions_at ON interactions (at)', 'CREATE INDEX idx_interactions_ext ON interactions (ext_id)', 'CREATE INDEX idx_interactions_company ON interactions (company)', 'CREATE INDEX idx_interactions_deal ON interactions (deal)'],
    });

    const tasks = save({
      name: 'tasks',
      fields: [
        { name: 'title', type: 'text', required: true, max: 300 },
        text('notes', 4000),
        day('due'),
        text('done_at', 30),
        day('snoozed_until'),
        sel('kind', ['todo', 'call', 'email', 'meeting', 'follow_up']),
        rel('person', people, true),
        rel('company', companies, true),
        rel('deal', deals, true),
        text('by', 12),
        text('run', 24),
      ],
      indexes: ['CREATE INDEX idx_tasks_due ON tasks (done_at, due)', 'CREATE INDEX idx_tasks_deal ON tasks (deal)', 'CREATE INDEX idx_tasks_person ON tasks (person)'],
    });

    save({
      name: 'emails',
      fields: [
        text('to', 500),
        text('cc', 500),
        text('subject', 300),
        text('body', 20000),
        sel('status', ['draft', 'queued', 'sending', 'sent', 'failed']),
        rel('person', people, true),
        rel('deal', deals, true),
        text('by', 12),
        text('run', 24),
        text('queued_at', 30),
        text('sent_at', 30),
        text('error', 1000),
      ],
      indexes: ['CREATE INDEX idx_emails_status ON emails (status)', 'CREATE INDEX idx_emails_person ON emails (person)'],
    });

    save({
      name: 'proposals',
      fields: [
        text('kind', 20),
        text('object', 20),
        text('target', 15),
        text('title', 300),
        json('changes', 100000),
        json('payload', 200000),
        text('evidence', 2000),
        text('source', 500),
        text('reason', 1000),
        sel('confidence', ['high', 'medium', 'low']),
        sel('status', ['pending', 'accepted', 'edited', 'rejected']),
        text('decided_at', 30),
        json('applied', 100000),
        text('run', 24),
      ],
      indexes: ['CREATE INDEX idx_proposals_status ON proposals (status)', 'CREATE INDEX idx_proposals_target ON proposals (target)'],
    });

    save({
      name: 'views',
      fields: [
        sel('object', ['people', 'companies', 'deals']),
        { name: 'name', type: 'text', required: true, max: 80 },
        json('filters', 40000),
        sel('match', ['all', 'any']),
        text('sort', 40),
        sel('dir', ['asc', 'desc']),
        json('columns', 20000),
        sel('mode', ['table', 'board']),
        text('pipeline', 15),
        { name: 'position', type: 'number' },
      ],
    });

    save({
      name: 'aliases',
      fields: [text('object', 20), text('old_id', 15), text('new_id', 15)],
      indexes: ['CREATE INDEX idx_aliases_old ON aliases (old_id)'],
    });

    save({ name: 'dupe_ignores', fields: [text('object', 20), text('a', 15), text('b', 15)] });

    save({
      name: 'fx_rates',
      fields: [text('currency', 3), day('date'), text('rate', 24), text('source', 20)],
      indexes: ['CREATE UNIQUE INDEX idx_fx_rates ON fx_rates (currency, date)'],
    });

    save({
      name: 'asks',
      fields: [
        sel('kind', ['question', 'job', 'explain', 'brief']),
        sel('status', ['waiting', 'working', 'done', 'failed']),
        text('question', 4000),
        json('context', 100000),
        text('answer', 20000),
        json('links', 20000),
        text('error', 1000),
        text('requested_at', 30),
        text('run', 24),
      ],
    });

    save({
      name: 'activity',
      fields: [
        text('actor', 12),
        text('run', 24),
        text('op', 40),
        text('summary', 500),
        text('target_type', 20),
        text('target_id', 15),
        json('undo', 8000000),
        json('redo', 8000000),
        json('changes', 200000),
        { name: 'undone', type: 'bool' },
      ],
      indexes: ['CREATE INDEX idx_activity_run ON activity (run)', 'CREATE INDEX idx_activity_target ON activity (target_id)', 'CREATE INDEX idx_activity_created ON activity (created)'],
    });

    /* -------------------------------------------------------- default rows */
    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('home_currency', 'USD');
    s.set('keep_in_touch_default', 0);
    s.set('policy', {
      autonomy: { update: 'propose', stage: 'propose', close: 'propose', deal_value: 'propose', merge: 'propose', delete: 'propose', email: 'propose' },
      auto_research: false,
      meeting_review: true,
      daily_brief: false,
      brief_hour: 8,
      house_rules: '',
    });
    s.set('setup_done', false);
    app.save(s);

  },
  (app) => {
    for (const name of ['activity', 'asks', 'fx_rates', 'dupe_ignores', 'aliases', 'views', 'proposals', 'emails', 'tasks', 'interactions', 'notes', 'fields', 'list_entries', 'lists', 'stage_events', 'deal_people', 'deals', 'stages', 'pipelines', 'employments', 'people', 'companies', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
