/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS performance schema: goals and OKRs with key results and check-ins,
 * review templates and cycles (participants, reviews per reviewer kind,
 * calibration history, your AI agent's neutral summaries), continuous
 * feedback and praise, the skills library, training programs, sessions,
 * attendance and required trainings, and the module settings (company
 * values, HR sign-off per entity).
 *
 * Every collection is closed to the raw API (rules null); people and your
 * AI agent use the performance operations. Days are 'YYYY-MM-DD' text,
 * money integer minor units, ratings whole numbers on the cycle's scale.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const HHMM = '^(([01]\\d|2[0-3]):[0-5]\\d)?$';
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
    const day = (name, required) => ({ name: name, type: 'text', max: 10, pattern: DAY, required: required === true });
    const hhmm = (name) => ({ name: name, type: 'text', max: 5, pattern: HHMM });
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const selfRel = (collection, name) => {
      const c = app.findCollectionByNameOrId(collection);
      c.fields.add(new RelationField({ name: name, maxSelect: 1, collectionId: c.id, cascadeDelete: false }));
      app.save(c);
    };
    const KINDS = ['self', 'manager', 'peer', 'upward'];

    /* ----------------------------------------------------------- settings */

    make(
      'perf_settings',
      [rel('entity', 'entities'), json('values', 20000), bool('signoff'), bool('praise_wall'), int('checkin_days', { min: 1, max: 365 }), int('reminder_days', { min: 0, max: 60 }), json('extra', 20000)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_perf_settings_entity ON perf_settings (entity)'],
    );

    /* -------------------------------------------------------------- goals */

    make(
      'review_templates',
      [req('name', 120), txt('description', 1000), rel('entity', 'entities'), json('scale', 4000), json('sections', 60000), json('overall_kinds', 1000), bool('builtin'), bool('archived'), int('sort')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_review_templates_name ON review_templates (name COLLATE NOCASE)'],
    );

    make(
      'review_cycles',
      [
        req('name', 160),
        rel('entity', 'entities'),
        sel('kind', ['annual', 'half_year', 'quarterly', 'probation', 'project'], true),
        day('period_start', true),
        day('period_end', true),
        sel('status', ['draft', 'active', 'closed'], true),
        rel('template', 'review_templates'),
        json('template_snapshot', 80000),
        json('participants', 200000),
        json('phases', 4000),
        txt('launched_at', 40),
        rel('launched_by', 'members'),
        txt('closed_at', 40),
        rel('closed_by', 'members'),
        rel('created_by', 'members'),
        txt('note', 2000),
      ].concat(stamps),
      ['CREATE INDEX idx_review_cycles_status ON review_cycles (status, period_end)'],
    );

    make(
      'goals',
      [
        rel('employee', 'employees'),
        rel('department', 'departments'),
        rel('entity', 'entities'),
        rel('cycle', 'review_cycles'),
        req('title', 200),
        txt('description', 4000),
        sel('kind', ['goal', 'kra', 'okr'], true),
        json('key_results', 20000),
        int('weight', { min: 0, max: 100 }),
        int('progress', { min: 0, max: 100 }),
        sel('status', ['on_track', 'at_risk', 'off_track', 'done', 'dropped'], true),
        day('start_day'),
        day('due'),
        txt('last_checkin', 40),
        rel('created_by', 'members'),
        sel('origin', ['person', 'agent']),
        int('sort'),
      ].concat(stamps),
      [
        'CREATE INDEX idx_goals_employee ON goals (employee, status)',
        'CREATE INDEX idx_goals_department ON goals (department, status)',
        'CREATE INDEX idx_goals_cycle ON goals (cycle)',
        'CREATE INDEX idx_goals_due ON goals (due)',
      ],
    );
    selfRel('goals', 'parent');
    {
      const g = app.findCollectionByNameOrId('goals');
      g.indexes.push('CREATE INDEX idx_goals_parent ON goals (parent)');
      app.save(g);
    }

    make(
      'goal_checkins',
      [
        rel('goal', 'goals', { required: true, cascadeDelete: true }),
        rel('member', 'members'),
        rel('employee', 'employees'),
        sel('actor', ['person', 'agent', 'system'], true),
        txt('note', 2000),
        int('progress_before', { min: 0, max: 100 }),
        int('progress_after', { min: 0, max: 100 }),
        txt('status_before', 20),
        txt('status_after', 20),
        json('key_results', 20000),
      ].concat(stamps),
      ['CREATE INDEX idx_goal_checkins_goal ON goal_checkins (goal, created)'],
    );

    /* ------------------------------------------------------------ reviews */

    make(
      'review_participants',
      [
        rel('cycle', 'review_cycles', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true }),
        rel('employment', 'employments', { required: true }),
        rel('entity', 'entities'),
        rel('department', 'departments'),
        rel('manager', 'employees'),
        txt('title', 160),
        sel('stage', ['open', 'submitted', 'shared', 'acknowledged', 'signoff', 'signed', 'removed'], true),
        num('score'),
        int('overall', { min: 0, max: 10 }),
        int('final', { min: 0, max: 10 }),
        txt('final_reason', 2000),
        json('calibration', 20000),
        rel('calibrated_by', 'members'),
        txt('calibrated_at', 40),
        txt('shared_at', 40),
        rel('shared_by', 'members'),
        txt('acknowledged_at', 40),
        txt('ack_comment', 2000),
        txt('signoff', 30),
        txt('signed_at', 40),
        txt('returned_note', 2000),
        txt('note', 2000),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_review_participants ON review_participants (cycle, employment)',
        'CREATE INDEX idx_review_participants_employee ON review_participants (employee)',
        'CREATE INDEX idx_review_participants_manager ON review_participants (manager)',
      ],
    );

    make(
      'reviews',
      [
        rel('cycle', 'review_cycles', { required: true, cascadeDelete: true }),
        rel('participant', 'review_participants', { required: true, cascadeDelete: true }),
        rel('employee', 'employees', { required: true }),
        rel('reviewer', 'employees'),
        sel('kind', KINDS, true),
        sel('status', ['draft', 'submitted', 'declined'], true),
        json('answers', 200000),
        json('ratings', 20000),
        int('overall', { min: 0, max: 10 }),
        num('score'),
        txt('started_at', 40),
        txt('saved_at', 40),
        txt('submitted_at', 40),
        txt('declined_reason', 1000),
        rel('added_by', 'members'),
        day('reminded_on'),
      ].concat(stamps),
      [
        'CREATE INDEX idx_reviews_participant ON reviews (participant, kind)',
        'CREATE INDEX idx_reviews_reviewer ON reviews (reviewer, status)',
        'CREATE INDEX idx_reviews_cycle ON reviews (cycle, kind, status)',
      ],
    );

    make(
      'review_summaries',
      [
        rel('review', 'reviews', { required: true, cascadeDelete: true }),
        rel('participant', 'review_participants', { cascadeDelete: true }),
        rel('employee', 'employees'),
        rel('requested_by', 'members'),
        txt('job', 30),
        sel('status', ['requested', 'ready', 'used', 'dismissed', 'failed'], true),
        txt('text', 8000),
        json('sources', 20000),
        txt('error', 2000),
      ].concat(stamps),
      ['CREATE INDEX idx_review_summaries_review ON review_summaries (review, created)'],
    );

    /* ----------------------------------------------------------- feedback */

    make(
      'feedback',
      [
        rel('from_employee', 'employees'),
        rel('from_member', 'members'),
        sel('from_actor', ['person', 'agent', 'system']),
        rel('to_employee', 'employees', { required: true }),
        rel('about_employee', 'employees'),
        sel('kind', ['praise', 'feedback', 'request'], true),
        txt('text', 4000),
        json('values', 2000),
        sel('visibility', ['private', 'manager', 'public'], true),
        sel('status', ['open', 'answered', 'declined']),
        day('due'),
        rel('cycle', 'review_cycles'),
        rel('entity', 'entities'),
        txt('declined_reason', 1000),
      ].concat(stamps),
      [
        'CREATE INDEX idx_feedback_to ON feedback (to_employee, kind, created)',
        'CREATE INDEX idx_feedback_from ON feedback (from_employee, kind, created)',
        'CREATE INDEX idx_feedback_about ON feedback (about_employee, kind)',
        'CREATE INDEX idx_feedback_wall ON feedback (visibility, kind, created)',
      ],
    );
    selfRel('feedback', 'request');

    /* ------------------------------------------------------------- skills */

    make(
      'skills',
      [req('name', 120), txt('category', 80), txt('description', 1000), json('levels', 4000), json('expected', 20000), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_skills_name ON skills (name COLLATE NOCASE)', 'CREATE INDEX idx_skills_category ON skills (category)'],
    );

    /* ----------------------------------------------------------- training */

    const TKINDS = ['course', 'workshop', 'certification'];
    make(
      'training_programs',
      [req('name', 160), sel('kind', TKINDS, true), txt('provider', 160), txt('description', 4000), num('duration_hours', { min: 0, max: 10000 }), int('valid_months', { min: 0, max: 240 }), txt('link', 500), rel('entity', 'entities'), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_training_programs_name ON training_programs (name COLLATE NOCASE)'],
    );

    make(
      'trainings',
      [
        rel('program', 'training_programs', { required: true }),
        req('title', 200),
        sel('kind', TKINDS, true),
        txt('provider', 160),
        rel('entity', 'entities'),
        day('start', true),
        day('end'),
        hhmm('start_time'),
        hhmm('end_time'),
        txt('location', 200),
        txt('link', 500),
        int('capacity', { min: 0, max: 100000 }),
        sel('status', ['planned', 'open', 'done', 'cancelled'], true),
        int('cost_minor', { min: 0 }),
        cur('currency'),
        txt('trainer', 160),
        txt('description', 4000),
        rel('created_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_trainings_start ON trainings (start, status)', 'CREATE INDEX idx_trainings_program ON trainings (program)'],
    );

    const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
    make(
      'training_attendees',
      [
        rel('program', 'training_programs', { required: true }),
        rel('training', 'trainings', { cascadeDelete: true }),
        rel('employee', 'employees', { required: true, cascadeDelete: true }),
        sel('status', ['invited', 'enrolled', 'attended', 'completed', 'no_show', 'cancelled'], true),
        num('score', { min: 0, max: 100000 }),
        sel('result', ['pass', 'fail']),
        day('completed_on'),
        day('expires_on'),
        txt('feedback', 4000),
        int('rating', { min: 0, max: 5 }),
        { name: 'certificate', type: 'file', maxSelect: 1, maxSize: 15000000, mimeTypes: IMAGES.concat(['application/pdf']), thumbs: [], protected: true },
        rel('verified_by', 'members'),
        sel('source', ['session', 'external'], true),
        txt('note', 2000),
        rel('enrolled_by', 'members'),
      ].concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_training_attendees_session ON training_attendees (training, employee) WHERE training != ''",
        'CREATE INDEX idx_training_attendees_employee ON training_attendees (employee, program, status)',
      ],
    );

    make(
      'training_requirements',
      [
        rel('program', 'training_programs', { required: true, cascadeDelete: true }),
        rel('entity', 'entities'),
        rel('department', 'departments'),
        rel('job_title', 'job_titles'),
        int('due_days', { min: 0, max: 3650 }),
        day('due_day'),
        bool('active'),
        txt('note', 1000),
      ].concat(stamps),
      ['CREATE INDEX idx_training_requirements_program ON training_requirements (program, active)'],
    );

    make('perf_nudges', [req('key', 200), day('day')].concat(stamps), ['CREATE UNIQUE INDEX idx_perf_nudges_key ON perf_nudges (key)']);

    /* --------------------------------------------------------------- seed */

    const st = new Record(app.findCollectionByNameOrId('perf_settings'));
    st.set('entity', '');
    st.set('values', []);
    st.set('signoff', false);
    st.set('praise_wall', true);
    st.set('checkin_days', 14);
    st.set('reminder_days', 3);
    st.set('extra', {});
    app.save(st);

    const five = { points: 5, labels: ['Below expectations', 'Partly meets', 'Meets expectations', 'Exceeds', 'Outstanding'] };
    const comps = [
      { key: 'quality', name: 'Quality of work', description: 'Accurate, thorough work that others can rely on.' },
      { key: 'delivery', name: 'Delivery', description: 'Plans, prioritises and finishes what was agreed, on time.' },
      { key: 'collaboration', name: 'Collaboration', description: 'Works well with others, shares knowledge and helps the team succeed.' },
      { key: 'communication', name: 'Communication', description: 'Clear, timely and respectful in writing and in person.' },
      { key: 'growth', name: 'Growth', description: 'Learns, takes feedback and improves.' },
    ];
    const templates = [
      {
        name: 'Annual review',
        description: 'Goals, five core competencies and three questions, on a five-point scale.',
        scale: five,
        sections: [
          { key: 'goals', kind: 'goals', title: 'Goals', weight: 50, kinds: ['self', 'manager'] },
          { key: 'competencies', kind: 'competencies', title: 'Competencies', weight: 50, kinds: KINDS, items: comps },
          {
            key: 'questions',
            kind: 'questions',
            title: 'Questions',
            kinds: KINDS,
            items: [
              { key: 'went_well', text: 'What went well in this period?', required: true },
              { key: 'improve', text: 'What could be better next period?', required: true },
              { key: 'support', text: 'What support would help?', required: false },
            ],
          },
        ],
        overall_kinds: ['self', 'manager'],
      },
      {
        name: 'Probation review',
        description: 'The manager confirms whether the probation is passed, with three questions.',
        scale: { points: 3, labels: ['Not yet', 'Meets', 'Exceeds'] },
        sections: [
          { key: 'competencies', kind: 'competencies', title: 'Fit for the role', weight: 100, kinds: ['manager'], items: comps.slice(0, 3) },
          {
            key: 'questions',
            kind: 'questions',
            title: 'Questions',
            kinds: ['self', 'manager'],
            items: [
              { key: 'strengths', text: 'Strengths shown so far', required: true },
              { key: 'concerns', text: 'Concerns or gaps', required: false },
              { key: 'recommendation', text: 'Recommendation and next steps', required: true },
            ],
          },
        ],
        overall_kinds: ['manager'],
      },
      {
        name: 'Quarterly check-in',
        description: 'A short conversation on goals and priorities, without ratings.',
        scale: five,
        sections: [
          { key: 'goals', kind: 'goals', title: 'Goals', weight: 0, kinds: ['self', 'manager'], rate: false },
          {
            key: 'questions',
            kind: 'questions',
            title: 'Questions',
            kinds: ['self', 'manager'],
            items: [
              { key: 'progress', text: 'Progress since the last check-in', required: true },
              { key: 'priorities', text: 'Priorities for next quarter', required: true },
              { key: 'blockers', text: 'Anything in the way?', required: false },
            ],
          },
        ],
        overall_kinds: [],
      },
    ];
    templates.forEach((t, i) => {
      const r = new Record(app.findCollectionByNameOrId('review_templates'));
      r.set('name', t.name);
      r.set('description', t.description);
      r.set('scale', t.scale);
      r.set('sections', t.sections);
      r.set('overall_kinds', t.overall_kinds);
      r.set('builtin', true);
      r.set('archived', false);
      r.set('sort', i + 1);
      app.save(r);
    });

    // HR signs off reviews where an entity requires it (admins may change the flow).
    const flow = new Record(app.findCollectionByNameOrId('approval_flows'));
    flow.set('kind', 'review_signoff');
    flow.set('steps', [{ type: 'role', role: 'hr_admin' }]);
    flow.set('auto', {});
    flow.set('active', true);
    flow.set('note', 'Reviews are signed off by an HR administrator after the employee acknowledges them.');
    app.save(flow);
  },
  (app) => {
    try {
      for (const r of app.findRecordsByFilter('approval_flows', "kind = 'review_signoff'", '', 0, 0)) app.delete(app.findRecordById('approval_flows', r.id));
    } catch {
      /* already gone */
    }
    for (const n of ['perf_nudges', 'training_requirements', 'training_attendees', 'trainings', 'training_programs', 'skills', 'feedback', 'review_summaries', 'reviews', 'review_participants', 'goal_checkins', 'goals', 'review_cycles', 'review_templates', 'perf_settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
