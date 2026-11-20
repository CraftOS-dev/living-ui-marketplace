/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS network: relationship capture, strength, intro paths, intros,
 * the calendar and meeting briefs (SPEC 7.5).
 *
 *   capture_state  one row per source (mail_owner, mail_firm, calendar) with
 *                  its last run and error; one row per member with their
 *                  capture consent (opt-in) and excluded domains; one firm
 *                  row with the capture address, firm domains and firm-wide
 *                  exclusions.
 *   cal_events     the owner's calendar, one row per event (Google id),
 *                  attendees with member and person ids, external flag,
 *                  company and deal, meeting.ended and note state.
 *   interactions   one touch of one member with people (email, meeting,
 *                  call, message); ext_id makes a captured touch count once;
 *                  headers only (body_kept is always false).
 *   strengths      member-to-person edges and each person's and company's
 *                  best edge, from the strength engine (nightly and after
 *                  each capture).
 *   intros         an ask through a path (member, connector, target) with
 *                  its outbound draft and outcome.
 *   briefs         a meeting brief your AI agent prepares (sections JSON).
 *
 * Every collection is closed to the raw API (rules null).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const num = (name) => ({ name: name, type: 'number' });
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members'), txt('run', 40)];

    make(
      'capture_state',
      [
        sel('kind', ['firm', 'member', 'source'], true),
        rel('who', 'members', { cascadeDelete: true }),
        txt('source', 40),
        bool('consent'),
        txt('consent_at', 40),
        json('exclude_domains', 20000),
        json('config', 20000),
        sel('state', ['never', 'ok', 'partial', 'offline', 'error']),
        txt('error', 600),
        txt('last_try_at', 40),
        txt('last_ok_at', 40),
        json('cursor', 200000),
        json('counts', 4000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_capture_state_key ON capture_state (kind, who, source)'],
    );

    make(
      'cal_events',
      [
        req('ext_id', 300),
        txt('calendar', 200),
        rel('owner', 'members'),
        txt('title', 300),
        txt('location', 300),
        txt('meet', 500),
        txt('link', 1000),
        req('start_at', 40),
        req('end_at', 40),
        bool('all_day'),
        json('attendees', 40000),
        bool('external'),
        rel('company', 'companies'),
        rel('deal', 'deals'),
        sel('status', ['confirmed', 'tentative', 'cancelled', 'gone'], true),
        txt('ended_at', 40),
        sel('note_state', ['none', 'opened', 'skipped', 'noted']),
        txt('synced_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_cal_events_ext ON cal_events (ext_id)', 'CREATE INDEX idx_cal_events_start ON cal_events (start_at)', 'CREATE INDEX idx_cal_events_end ON cal_events (end_at, ended_at)', 'CREATE INDEX idx_cal_events_company ON cal_events (company)', 'CREATE INDEX idx_cal_events_deal ON cal_events (deal)'],
    );

    make(
      'interactions',
      [
        sel('kind', ['meeting', 'call', 'email', 'message'], true),
        sel('direction', ['in', 'out']),
        req('at', 40),
        rel('who', 'members', { required: true, cascadeDelete: true }),
        { name: 'people', type: 'relation', maxSelect: 50, collectionId: id('people'), cascadeDelete: false },
        rel('company', 'companies'),
        rel('deal', 'deals'),
        rel('cal_event', 'cal_events'),
        txt('subject', 300),
        sel('source', ['gmail', 'capture_mailbox', 'calendar', 'manual', 'agent', 'import'], true),
        txt('ext_id', 300),
        bool('body_kept'),
      ]
        .concat(written())
        .concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_interactions_ext ON interactions (ext_id) WHERE ext_id != ''",
        'CREATE INDEX idx_interactions_who ON interactions (who, at)',
        'CREATE INDEX idx_interactions_at ON interactions (at)',
        'CREATE INDEX idx_interactions_company ON interactions (company)',
        'CREATE INDEX idx_interactions_deal ON interactions (deal)',
      ],
    );

    make(
      'strengths',
      [
        sel('kind', ['edge', 'person', 'company'], true),
        rel('who', 'members', { cascadeDelete: true }),
        rel('person', 'people', { cascadeDelete: true }),
        rel('company', 'companies', { cascadeDelete: true }),
        int('score', { min: 0, max: 100 }),
        sel('band', ['strong', 'good', 'weak', 'none'], true),
        num('s'),
        int('counted', { min: 0 }),
        txt('last_at', 40),
        int('people_known', { min: 0 }),
        txt('computed_at', 40),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_strengths_key ON strengths (kind, who, person, company)',
        'CREATE INDEX idx_strengths_person ON strengths (person, kind)',
        'CREATE INDEX idx_strengths_company ON strengths (company, kind)',
        'CREATE INDEX idx_strengths_score ON strengths (kind, score)',
      ],
    );

    make(
      'intros',
      [
        rel('target', 'people', { required: true }),
        rel('target_company', 'companies'),
        rel('via', 'members', { required: true }),
        rel('connector', 'people'),
        sel('path_kind', ['direct', 'one_hop'], true),
        json('path', 20000),
        rel('requested_by', 'members'),
        rel('deal', 'deals'),
        txt('note', 2000),
        sel('status', ['requested', 'drafted', 'sent', 'failed', 'made', 'declined', 'no_answer', 'cancelled'], true),
        rel('outbound', 'outbound'),
        txt('job', 30),
        txt('to_email', 254),
        txt('drafted_at', 40),
        txt('sent_at', 40),
        txt('outcome_at', 40),
        rel('outcome_by', 'members'),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_intros_target ON intros (target, status)', 'CREATE INDEX idx_intros_company ON intros (target_company)', 'CREATE INDEX idx_intros_status ON intros (status)', 'CREATE INDEX idx_intros_outbound ON intros (outbound)'],
    );

    make(
      'briefs',
      [
        rel('cal_event', 'cal_events', { cascadeDelete: true }),
        rel('company', 'companies'),
        rel('deal', 'deals'),
        rel('person', 'people'),
        sel('state', ['queued', 'reading', 'ready', 'failed'], true),
        txt('job', 30),
        txt('error', 600),
        json('sections', 200000),
        rel('requested_by', 'members'),
        txt('prepared_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_briefs_event ON briefs (cal_event) WHERE cal_event != ''", 'CREATE INDEX idx_briefs_company ON briefs (company)', 'CREATE INDEX idx_briefs_state ON briefs (state)'],
    );
  },
  (app) => {
    for (const n of ['briefs', 'intros', 'strengths', 'interactions', 'cal_events', 'capture_state']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
