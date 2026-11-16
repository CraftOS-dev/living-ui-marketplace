/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS hiring: staffing plans, requisitions, job openings with their own
 * pipeline stages, candidates (protected resume, consent, retention day),
 * applications on a board, interviews with kits and scorecards, offers with
 * terms and a letter template, referrals, and the settings rows (rejection
 * reasons, offer terms, letter templates, retention by country).
 *
 * Every collection is closed to the raw API (rules null); screens and your
 * AI agent use the hiring operations (cat_hiring_*.js -> lib_hiring*.js).
 * Your AI agent drafts job posts and neutral interview summaries; it never
 * scores, ranks, screens out, rejects or hires a candidate.
 *
 * Money: integers of the currency's minor unit. Days: 'YYYY-MM-DD' text.
 * Times of day: 'HH:MM'. Instants: ISO text in UTC.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const HHMM = '^(([01]\\d|2[0-3]):[0-5]\\d)?$';
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
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: DAY });
    const hhmm = (name) => ({ name: name, type: 'text', max: 5, pattern: HHMM });
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const addFields = (collection, fields) => {
      const c = app.findCollectionByNameOrId(collection);
      for (const f of fields) c.fields.add(new RelationField(f));
      app.save(c);
    };
    const ACTOR = ['person', 'agent', 'system'];
    const PER = ['year', 'month', 'week', 'day', 'hour'];
    const REMOTE = ['onsite', 'hybrid', 'remote'];

    /* ---------------------------------------------------------- settings */

    make('hiring_config', [json('default_stages', 8000), json('retention', 8000), int('retention_default', { min: 1, max: 3650 }), int('consent_days', { min: 1, max: 3650 }), bool('email_candidates'), json('extra', 20000)].concat(stamps));

    make(
      'rejection_reasons',
      [req('name', 120), sel('kind', ['company', 'candidate'], true), txt('subject', 200), txt('message', 8000), int('sort'), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hir_rejection_reasons_name ON rejection_reasons (name COLLATE NOCASE)'],
    );

    make('offer_terms', [req('title', 160), txt('text', 8000), txt('category', 60), int('sort'), bool('archived')].concat(stamps), ['CREATE UNIQUE INDEX idx_hir_offer_terms_title ON offer_terms (title COLLATE NOCASE)']);

    make(
      'offer_templates',
      [req('name', 120), rel('entity', 'entities'), txt('body', 40000), bool('is_default'), bool('archived')].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hir_offer_templates_name ON offer_templates (name COLLATE NOCASE)'],
    );

    /* ---------------------------------------------------------- planning */

    make(
      'staffing_plans',
      [rel('entity', 'entities', { required: true }), req('name', 160), day('from_day'), day('to_day'), cur('currency'), sel('status', ['draft', 'active', 'closed'], true), txt('note', 2000)].concat(stamps),
      ['CREATE INDEX idx_hir_staffing_plans_entity ON staffing_plans (entity, status)'],
    );

    make(
      'staffing_plan_lines',
      [
        rel('plan', 'staffing_plans', { required: true, cascadeDelete: true }),
        rel('department', 'departments'),
        rel('job_title', 'job_titles'),
        txt('title', 160),
        int('planned', { min: 0, max: 100000 }),
        int('budget_minor', { min: 0 }),
        txt('note', 1000),
        int('sort'),
      ].concat(stamps),
      ['CREATE INDEX idx_hir_staffing_lines_plan ON staffing_plan_lines (plan)'],
    );

    make(
      'requisitions',
      [
        txt('number', 20),
        rel('entity', 'entities', { required: true }),
        rel('department', 'departments'),
        rel('plan_line', 'staffing_plan_lines'),
        req('title', 160),
        rel('job_title', 'job_titles'),
        int('headcount', { min: 1, max: 1000 }),
        sel('reason', ['new_role', 'replacement', 'growth'], true),
        rel('replaces', 'employees'),
        rel('employment_type', 'employment_types'),
        rel('location', 'locations'),
        sel('remote', REMOTE),
        cur('currency'),
        int('budget_minor', { min: 0 }),
        int('pay_min_minor', { min: 0 }),
        int('pay_max_minor', { min: 0 }),
        sel('pay_per', PER),
        rel('hiring_manager', 'members'),
        day('target_start_day'),
        txt('justification', 4000),
        sel('status', ['draft', 'pending', 'approved', 'rejected', 'filled', 'closed'], true),
        txt('approval', 30),
        rel('requested_by', 'members'),
        sel('requested_actor', ACTOR),
        txt('decided_note', 2000),
        txt('closed_reason', 400),
        txt('closed_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hir_requisitions_number ON requisitions (number) WHERE number != \'\'', 'CREATE INDEX idx_hir_requisitions_status ON requisitions (status, entity)'],
    );

    /* -------------------------------------------------------------- openings */

    make(
      'openings',
      [
        txt('number', 20),
        rel('requisition', 'requisitions'),
        rel('entity', 'entities', { required: true }),
        rel('department', 'departments'),
        req('title', 160),
        rel('job_title', 'job_titles'),
        txt('description', 60000),
        rel('location', 'locations'),
        txt('location_text', 160),
        cc('country'),
        txt('region', 10),
        sel('remote', REMOTE, true),
        rel('employment_type', 'employment_types'),
        cur('currency'),
        int('salary_min_minor', { min: 0 }),
        int('salary_max_minor', { min: 0 }),
        sel('pay_per', PER),
        bool('show_pay'),
        json('stages', 8000),
        sel('status', ['draft', 'open', 'on_hold', 'closed'], true),
        int('positions', { min: 1, max: 1000 }),
        txt('opened_at', 40),
        txt('closed_at', 40),
        sel('close_reason', ['filled', 'cancelled', 'other']),
        rel('hiring_manager', 'members'),
        json('team', 4000),
        rel('owner', 'members'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hir_openings_number ON openings (number) WHERE number != \'\'', 'CREATE INDEX idx_hir_openings_status ON openings (status, entity)', 'CREATE INDEX idx_hir_openings_requisition ON openings (requisition)'],
    );

    make(
      'interview_kits',
      [req('name', 120), rel('opening', 'openings', { cascadeDelete: true }), sel('kind', ['phone', 'video', 'onsite', 'technical', 'panel', 'other']), int('duration_min', { min: 0, max: 600 }), json('criteria', 20000), json('questions', 40000), bool('archived')].concat(stamps),
      ['CREATE INDEX idx_hir_kits_job ON interview_kits (opening)'],
    );

    /* -------------------------------------------------------- candidates */

    make(
      'candidates',
      [
        req('name', 160),
        txt('email', 160),
        txt('phone', 60),
        txt('location', 160),
        txt('current_title', 160),
        txt('current_company', 160),
        sel('source', ['applied', 'referral', 'sourced', 'agency', 'job_board', 'career_site', 'event', 'internal', 'import', 'other'], true),
        txt('source_detail', 160),
        { name: 'resume', type: 'file', maxSelect: 1, maxSize: 15000000, mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/rtf', 'application/vnd.oasis.opendocument.text', 'image/png', 'image/jpeg'], thumbs: [], protected: true },
        txt('resume_name', 200),
        json('links', 4000),
        json('tags', 2000),
        bool('consent'),
        txt('consent_at', 40),
        cc('country'),
        day('retain_until'),
        day('retention_flagged'),
        txt('notes', 8000),
        rel('owner', 'members'),
        rel('employee', 'employees'),
        sel('created_actor', ACTOR),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_hir_candidates_email ON candidates (email COLLATE NOCASE) WHERE email != ''", 'CREATE INDEX idx_hir_candidates_name ON candidates (name)', 'CREATE INDEX idx_hir_candidates_retain ON candidates (retain_until)'],
    );

    make(
      'applications',
      [
        rel('opening', 'openings', { required: true, cascadeDelete: true }),
        rel('candidate', 'candidates', { required: true, cascadeDelete: true }),
        txt('stage', 40),
        txt('stage_since', 40),
        sel('status', ['active', 'hired', 'rejected', 'withdrawn'], true),
        rel('rejected_reason', 'rejection_reasons'),
        txt('closed_note', 2000),
        txt('closed_at', 40),
        rel('closed_by', 'members'),
        rel('owner', 'members'),
        day('applied_at'),
        txt('source', 40),
        rel('hired_employment', 'employments'),
        txt('hired_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hir_applications_pair ON applications (opening, candidate)', 'CREATE INDEX idx_hir_applications_job ON applications (opening, status, stage)', 'CREATE INDEX idx_hir_applications_candidate ON applications (candidate)'],
    );

    make(
      'hiring_events',
      [
        rel('candidate', 'candidates', { required: true, cascadeDelete: true }),
        rel('application', 'applications', { cascadeDelete: true }),
        sel('kind', ['applied', 'moved', 'rejected', 'withdrawn', 'reopened', 'note', 'message', 'interview', 'feedback', 'offer', 'hired', 'referral', 'edited', 'imported'], true),
        txt('from_stage', 40),
        txt('to_stage', 40),
        txt('subject', 200),
        txt('text', 20000),
        sel('actor', ACTOR, true),
        rel('member', 'members'),
        sel('delivery', ['none', 'pending', 'sent', 'failed']),
        txt('to_email', 160),
        txt('ref', 30),
        txt('day', 10),
        txt('start', 5),
        txt('zone', 64),
      ].concat(stamps),
      ['CREATE INDEX idx_hir_hev_candidate ON hiring_events (candidate, created)', "CREATE INDEX idx_hir_hev_delivery ON hiring_events (delivery) WHERE delivery = 'pending'"],
    );

    /* -------------------------------------------------------- interviews */

    make(
      'interviews',
      [
        rel('application', 'applications', { required: true, cascadeDelete: true }),
        rel('opening', 'openings'),
        rel('candidate', 'candidates'),
        txt('stage', 40),
        sel('kind', ['phone', 'video', 'onsite', 'technical', 'panel', 'other'], true),
        txt('title', 160),
        rel('kit', 'interview_kits'),
        day('day'),
        hhmm('start'),
        txt('timezone', 60),
        txt('at', 40),
        txt('end_at', 40),
        int('duration_min', { min: 5, max: 600 }),
        json('interviewers', 4000),
        txt('location', 300),
        txt('link', 500),
        sel('status', ['scheduled', 'done', 'cancelled', 'no_show'], true),
        txt('note', 4000),
        txt('calendar_event', 300),
        txt('calendar_link', 500),
        txt('summary', 20000),
        txt('summary_at', 40),
        sel('summary_actor', ACTOR),
        rel('scheduled_by', 'members'),
      ].concat(stamps),
      ['CREATE INDEX idx_hir_interviews_at ON interviews (at)', 'CREATE INDEX idx_hir_interviews_application ON interviews (application)', 'CREATE INDEX idx_hir_interviews_job ON interviews (opening)'],
    );

    make(
      'interview_feedback',
      [
        rel('interview', 'interviews', { required: true, cascadeDelete: true }),
        rel('application', 'applications', { cascadeDelete: true }),
        rel('interviewer', 'members', { required: true }),
        sel('recommendation', ['strong_no', 'no', 'yes', 'strong_yes']),
        json('scores', 8000),
        txt('notes', 20000),
        sel('status', ['pending', 'draft', 'submitted'], true),
        txt('submitted_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_hir_feedback_pair ON interview_feedback (interview, interviewer)', 'CREATE INDEX idx_hir_feedback_interviewer ON interview_feedback (interviewer, status)'],
    );

    /* ------------------------------------------------------------ offers */

    make(
      'offers',
      [
        txt('number', 20),
        rel('application', 'applications', { required: true, cascadeDelete: true }),
        rel('opening', 'openings'),
        rel('candidate', 'candidates'),
        rel('entity', 'entities'),
        req('title', 160),
        rel('department', 'departments'),
        rel('location', 'locations'),
        rel('employment_type', 'employment_types'),
        day('start_day'),
        sel('pay_basis', ['salary', 'hourly', 'daily'], true),
        int('amount_minor', { min: 0 }),
        sel('pay_per', PER, true),
        cur('currency'),
        json('components', 8000),
        json('terms', 40000),
        rel('template', 'offer_templates'),
        txt('letter', 60000),
        sel('status', ['draft', 'pending', 'approved', 'sent', 'accepted', 'declined', 'withdrawn'], true),
        txt('approval', 30),
        day('expires_day'),
        txt('sent_at', 40),
        txt('responded_at', 40),
        txt('decline_reason', 2000),
        txt('note', 4000),
        rel('employment', 'employments'),
        rel('created_by', 'members'),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_hir_offers_number ON offers (number) WHERE number != ''", 'CREATE INDEX idx_hir_offers_application ON offers (application)', 'CREATE INDEX idx_hir_offers_status ON offers (status)'],
    );

    /* --------------------------------------------------------- referrals */

    make(
      'referrals',
      [
        rel('opening', 'openings', { required: true, cascadeDelete: true }),
        rel('candidate', 'candidates', { cascadeDelete: true }),
        rel('application', 'applications'),
        rel('referrer', 'employees'),
        rel('referrer_member', 'members'),
        req('name', 160),
        txt('email', 160),
        txt('phone', 60),
        txt('relationship', 200),
        txt('note', 4000),
        sel('status', ['submitted', 'withdrawn'], true),
      ].concat(stamps),
      ['CREATE INDEX idx_hir_referrals_member ON referrals (referrer_member)', 'CREATE INDEX idx_hir_referrals_job ON referrals (opening)'],
    );

    addFields('applications', [rel('referral', 'referrals')]);

    /* -------------------------------------------------------------- seed */

    const cfg = new Record(app.findCollectionByNameOrId('hiring_config'));
    cfg.set('default_stages', [
      { key: 'applied', name: 'Applied', kind: 'applied' },
      { key: 'screen', name: 'Screen', kind: 'screen' },
      { key: 'interview', name: 'Interview', kind: 'interview' },
      { key: 'offer', name: 'Offer', kind: 'offer' },
      { key: 'hired', name: 'Hired', kind: 'hired' },
    ]);
    // Days to keep a candidate's data after their last application closes, by
    // the country of the job's entity. Suggested defaults the owner reviews
    // with counsel (Hiring settings); consent_days applies when the candidate
    // agreed to be kept on file for future roles.
    cfg.set('retention', { US: 365, CA: 365, GB: 180, IE: 365, DE: 180, FR: 730, NL: 28, ES: 365, IT: 365, AU: 365, NZ: 365, SG: 180, MY: 180, JP: 180, IN: 180, PH: 180, ID: 180, TH: 180, VN: 180, HK: 730 });
    cfg.set('retention_default', 365);
    cfg.set('consent_days', 730);
    cfg.set('email_candidates', false);
    cfg.set('extra', {});
    app.save(cfg);

    const reasons = app.findCollectionByNameOrId('rejection_reasons');
    const MSG = 'Dear {{candidate_name}},\n\nThank you for your interest in the {{job_title}} role at {{company}} and for the time you gave us. We have decided not to move forward with your application.\n\nWe wish you every success.\n\n{{sender_name}}';
    [
      ['Another candidate was a closer match', 'company', MSG],
      ['Role filled', 'company', 'Dear {{candidate_name}},\n\nThank you for applying for the {{job_title}} role at {{company}}. The role has now been filled, so we are closing your application.\n\nWe wish you every success.\n\n{{sender_name}}'],
      ['Role closed or put on hold', 'company', 'Dear {{candidate_name}},\n\nThank you for applying for the {{job_title}} role at {{company}}. We are no longer hiring for this role, so we are closing your application.\n\n{{sender_name}}'],
      ['Requirements of the role not met', 'company', MSG],
      ['Did not respond', 'company', ''],
      ['Candidate withdrew', 'candidate', ''],
      ['Accepted another offer', 'candidate', ''],
      ['Pay or terms did not work out', 'candidate', ''],
    ].forEach((x, i) => {
      const r = new Record(reasons);
      r.set('name', x[0]);
      r.set('kind', x[1]);
      r.set('subject', x[2] !== '' ? 'Your application for {{job_title}}' : '');
      r.set('message', x[2]);
      r.set('sort', i + 1);
      r.set('archived', false);
      app.save(r);
    });

    const terms = app.findCollectionByNameOrId('offer_terms');
    [
      ['Probation', 'Your employment starts with a probation period of three months. During it either side may end the employment with one week of written notice.', 'employment'],
      ['Notice period', 'After probation, either side may end the employment with one month of written notice, or the notice the law of {{country}} requires if that is longer.', 'employment'],
      ['Working hours', 'Your normal working hours follow the work schedule of {{entity}}, with breaks as the law requires.', 'employment'],
      ['Confidentiality', 'You agree to keep confidential the information of {{company}} and its clients during and after your employment.', 'legal'],
      ['Right to work and checks', 'This offer depends on proof of your right to work in {{country}} and on any checks described to you before you accept.', 'legal'],
    ].forEach((x, i) => {
      const r = new Record(terms);
      r.set('title', x[0]);
      r.set('text', x[1]);
      r.set('category', x[2]);
      r.set('sort', i + 1);
      r.set('archived', false);
      app.save(r);
    });

    const tpl = new Record(app.findCollectionByNameOrId('offer_templates'));
    tpl.set('name', 'Standard offer letter');
    tpl.set(
      'body',
      [
        '{{today}}',
        '',
        '**{{candidate_name}}**',
        '',
        'Dear {{candidate_name}},',
        '',
        'We are delighted to offer you the role of **{{title}}** at **{{entity_legal_name}}**{{department_line}}.',
        '',
        '| | |',
        '|---|---|',
        '| Start day | {{start_day}} |',
        '| Pay | {{pay}} |',
        '| Employment type | {{employment_type}} |',
        '| Location | {{location}} |',
        '',
        '{{components}}',
        '',
        '{{terms}}',
        '',
        'Please confirm your acceptance by {{expires_day}}.',
        '',
        'Yours sincerely,',
        '',
        '{{sender_name}}',
        '{{company}}',
      ].join('\n'),
    );
    tpl.set('is_default', true);
    tpl.set('archived', false);
    app.save(tpl);

    const kits = app.findCollectionByNameOrId('interview_kits');
    const kit = (name, kind, minutes, criteria, questions) => {
      const r = new Record(kits);
      r.set('name', name);
      r.set('kind', kind);
      r.set('duration_min', minutes);
      r.set('criteria', criteria);
      r.set('questions', questions);
      r.set('archived', false);
      app.save(r);
    };
    kit(
      'Phone screen',
      'phone',
      30,
      [
        { key: 'role_fit', name: 'Understanding of the role', description: 'Knows what the role involves and why it interests them.' },
        { key: 'communication', name: 'Communication', description: 'Explains clearly and listens.' },
        { key: 'logistics', name: 'Practical fit', description: 'Start date, location and working arrangements work for both sides.' },
      ],
      [
        { key: 'q1', text: 'Walk me through your current or most recent role.', criterion: 'role_fit' },
        { key: 'q2', text: 'What interests you about this role?', criterion: 'role_fit' },
        { key: 'q3', text: 'When could you start, and how would you like to work (onsite, hybrid, remote)?', criterion: 'logistics' },
      ],
    );
    kit(
      'Skills interview',
      'video',
      60,
      [
        { key: 'skills', name: 'Skills for the role', description: 'Shows the skills the role needs, with examples.' },
        { key: 'problem_solving', name: 'Problem solving', description: 'Works through a problem in a structured way.' },
        { key: 'collaboration', name: 'Working with others', description: 'Gives examples of working well with a team.' },
      ],
      [
        { key: 'q1', text: 'Tell me about a piece of work you are proud of. What was your part in it?', criterion: 'skills' },
        { key: 'q2', text: 'Here is a problem we faced recently. How would you approach it?', criterion: 'problem_solving' },
        { key: 'q3', text: 'Tell me about a disagreement with a colleague and how you resolved it.', criterion: 'collaboration' },
      ],
    );

    const flows = app.findCollectionByNameOrId('approval_flows');
    [
      ['requisition', 'A new role (requisition) is approved by an HR administrator or the owner.'],
      ['offer', 'An offer is approved by an HR administrator or the owner before it is sent.'],
    ].forEach((x) => {
      const f = new Record(flows);
      f.set('kind', x[0]);
      f.set('steps', [{ type: 'role', role: 'hr_admin' }]);
      f.set('auto', {});
      f.set('active', true);
      f.set('note', x[1]);
      app.save(f);
    });
  },
  (app) => {
    for (const k of ['requisition', 'offer']) {
      for (const r of app.findRecordsByFilter('approval_flows', 'kind = {:k}', '', 0, 0, { k: k })) app.delete(r);
    }
    try {
      const a = app.findCollectionByNameOrId('applications');
      a.fields.removeByName('referral');
      app.save(a);
    } catch {
      /* already gone */
    }
    const names = ['referrals', 'offers', 'interview_feedback', 'interviews', 'hiring_events', 'applications', 'candidates', 'interview_kits', 'openings', 'requisitions', 'staffing_plan_lines', 'staffing_plans', 'offer_templates', 'offer_terms', 'rejection_reasons', 'hiring_config'];
    for (const n of names) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
