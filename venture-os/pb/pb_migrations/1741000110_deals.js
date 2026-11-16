/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS deals (kernel-records): pipelines with their stages (JSON with
 * stall days), deals, the people and members on a deal, and the
 * append-only stage events.
 *
 * Money is integer minor units of the deal's `currency` (`check_minor`, and
 * `raise_minor`, `pre_money_minor`, `post_money_minor` inside `round`). A
 * deal's display id is `number` (D-0001, from settings.seq). A `restricted`
 * deal is visible only to its deal team (deal_people with team = true; the
 * team member is `member`, who added the row is `added_by`) and the owner; your AI agent sees it only when `agent_allowed` is true.
 *
 * Seeds the `deal_flow` pipeline (Sourced, Screen, First meeting,
 * Diligence, Partner meeting, IC, Term sheet, Closed); the spv, lp_raise
 * and program pipelines are created on first use (lib_deals.pipelineOf).
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const CUR = '^([A-Z]{3})?$';
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
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members')];

    make(
      'pipelines',
      [req('key', 40), req('name', 80), sel('kind', ['deal_flow', 'spv', 'lp_raise', 'program'], true), json('stages', 20000), bool('archived'), int('sort')].concat(written()).concat(stamps),
      ['CREATE UNIQUE INDEX idx_pipelines_key ON pipelines (key)'],
    );

    make(
      'deals',
      [
        txt('number', 12),
        txt('name', 200),
        rel('company', 'companies', { required: true }),
        rel('pipeline', 'pipelines', { required: true }),
        req('stage', 40),
        txt('stage_entered_at', 40),
        sel('status', ['open', 'invested', 'passed', 'lost', 'hold'], true),
        txt('status_reason', 600),
        txt('status_at', 40),
        rel('point', 'members'),
        sel('source', ['inbound', 'referral', 'outbound', 'scout', 'event', 'sourced', 'co_investor', 'portfolio', 'other']),
        rel('source_person', 'people'),
        json('round', 4000),
        txt('currency', 3, { pattern: CUR }),
        int('check_minor', { min: 0 }),
        sel('instrument', ['safe_cap', 'safe_discount', 'safe_mfn', 'note', 'priced', 'other']),
        rel('fund', 'entities'),
        bool('restricted'),
        bool('agent_allowed'),
        json('tags', 4000),
        txt('intake_item', 20),
        json('prov', 20000),
        txt('last_activity_at', 40),
        txt('deleted_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_deals_number ON deals (number) WHERE number != ''",
        'CREATE INDEX idx_deals_board ON deals (pipeline, status, stage)',
        'CREATE INDEX idx_deals_company ON deals (company)',
        'CREATE INDEX idx_deals_point ON deals (point)',
      ],
    );

    make(
      'deal_people',
      [
        rel('deal', 'deals', { required: true, cascadeDelete: true }),
        rel('member', 'members'),
        rel('person', 'people'),
        sel('role', ['point', 'team', 'founder', 'contact', 'co_investor', 'advisor', 'referrer'], true),
        bool('team'),
        sel('actor', ['person', 'agent', 'system'], true),
        rel('added_by', 'members'),
      ].concat(stamps),
      ["CREATE UNIQUE INDEX idx_deal_people_member ON deal_people (deal, member) WHERE member != ''", "CREATE UNIQUE INDEX idx_deal_people_person ON deal_people (deal, person) WHERE person != ''", 'CREATE INDEX idx_deal_people_team ON deal_people (member, team)'],
    );

    make(
      'stage_events',
      [
        rel('deal', 'deals', { required: true, cascadeDelete: true }),
        rel('pipeline', 'pipelines'),
        sel('kind', ['created', 'moved', 'status'], true),
        txt('from_stage', 40),
        txt('to_stage', 40),
        txt('from_status', 20),
        txt('to_status', 20),
        int('days_in_from', { min: 0 }),
        txt('note', 1000),
        req('at', 40),
        txt('run', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_stage_events_deal ON stage_events (deal, at)', 'CREATE INDEX idx_stage_events_at ON stage_events (at)'],
    );

    const pl = new Record(app.findCollectionByNameOrId('pipelines'));
    pl.set('key', 'deal_flow');
    pl.set('name', 'Deal flow');
    pl.set('kind', 'deal_flow');
    pl.set('stages', [
      { key: 'sourced', label: 'Sourced', stall_days: 7 },
      { key: 'screen', label: 'Screen', stall_days: 7 },
      { key: 'first_meeting', label: 'First meeting', stall_days: 7 },
      { key: 'diligence', label: 'Diligence', stall_days: 21 },
      { key: 'partner_meeting', label: 'Partner meeting', stall_days: 14 },
      { key: 'ic', label: 'IC', stall_days: 7 },
      { key: 'term_sheet', label: 'Term sheet', stall_days: 21 },
      { key: 'closed', label: 'Closed', stall_days: 0 },
    ]);
    pl.set('archived', false);
    pl.set('sort', 1);
    pl.set('actor', 'system');
    app.save(pl);
  },
  (app) => {
    for (const n of ['stage_events', 'deal_people', 'deals', 'pipelines']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
