/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS committee: investment memos (templates, versions, blocks with
 * tracked changes and citations), IC meetings with their agenda, blind
 * votes, decisions (never edited; corrections are new records) and the
 * conditions a decision sets.
 *
 * Blind votes: a vote's choice, rationale and veto are stored sealed
 * (`ballot_sealed`, AES-GCM with the app's seal key) until the facilitator
 * reveals the item; only then are the plain fields filled. Every collection
 * is closed to the raw API (rules null); people and your AI agent reach
 * these records only through the committee ops.
 *
 * Seeds the default memo template (the report's section list).
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

    make('memo_templates', [req('name', 80), json('sections', 20000), bool('is_default'), bool('archived')].concat(written()).concat(stamps), ['CREATE INDEX idx_memo_templates_default ON memo_templates (is_default)']);

    make(
      'memos',
      [
        txt('number', 12),
        rel('deal', 'deals', { required: true }),
        rel('company', 'companies'),
        rel('template', 'memo_templates'),
        int('version', { min: 1 }),
        sel('status', ['draft', 'submitted', 'final'], true),
        txt('hash', 64),
        json('snapshot', 20000),
        json('frozen', 400000),
        txt('prev', 20),
        rel('author', 'members'),
        txt('submitted_at', 40),
        rel('submitted_by', 'members'),
        int('typed_chars', { min: 0 }),
        int('pasted_chars', { min: 0 }),
        int('agent_chars', { min: 0 }),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_memos_deal_version ON memos (deal, version)', 'CREATE INDEX idx_memos_status ON memos (status)'],
    );

    make(
      'memo_blocks',
      [
        rel('memo', 'memos', { required: true, cascadeDelete: true }),
        req('section', 40),
        sel('state', ['kept', 'proposed', 'discarded', 'superseded'], true),
        txt('content', 40000),
        json('citations', 60000),
        json('data', 20000),
        int('uncited', { min: 0 }),
        txt('base', 20),
        txt('base_updated', 40),
        int('typed_chars', { min: 0 }),
        int('pasted_chars', { min: 0 }),
        int('agent_chars', { min: 0 }),
        txt('job', 20),
        rel('decided_by', 'members'),
        txt('decided_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_memo_blocks_memo ON memo_blocks (memo, section, state)', 'CREATE INDEX idx_memo_blocks_state ON memo_blocks (state)'],
    );

    make(
      'ic_meetings',
      [
        txt('number', 12),
        txt('title', 120),
        rel('fund', 'entities'),
        req('starts_at', 40),
        txt('day', 10),
        sel('status', ['planned', 'live', 'closed'], true),
        rel('facilitator', 'members'),
        txt('current_item', 20),
        txt('started_at', 40),
        txt('closed_at', 40),
        bool('auto'),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_ic_meetings_number ON ic_meetings (number) WHERE number != ''", 'CREATE INDEX idx_ic_meetings_starts ON ic_meetings (status, starts_at)'],
    );

    make(
      'agenda_items',
      [
        rel('meeting', 'ic_meetings', { required: true, cascadeDelete: true }),
        sel('kind', ['new_investment', 'follow_on', 'portfolio', 'other'], true),
        rel('deal', 'deals'),
        rel('company', 'companies'),
        txt('title', 200),
        int('sort'),
        rel('memo', 'memos'),
        int('memo_version', { min: 0 }),
        txt('memo_hash', 64),
        rel('champion', 'members'),
        rel('skeptic', 'members'),
        rel('fund', 'entities'),
        txt('preread_at', 40),
        txt('cooling_end_at', 40),
        sel('voting', ['open', 'closed'], true),
        txt('voting_closed_at', 40),
        rel('voting_closed_by', 'members'),
        txt('scale', 20),
        txt('rule', 20),
        json('eligible', 20000),
        txt('revealed_at', 40),
        rel('revealed_by', 'members'),
        json('tally', 40000),
        sel('status', ['waiting', 'voting', 'revealed', 'decided', 'skipped'], true),
        json('bearcase', 60000),
        txt('bearcase_at', 40),
        txt('bearcase_by', 10),
        txt('bearcase_job', 20),
        txt('decision', 20),
        sel('source', ['stage', 'memo', 'manual', 'proposal', 'module']),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_agenda_items_meeting ON agenda_items (meeting, sort)', 'CREATE INDEX idx_agenda_items_deal ON agenda_items (deal, status)'],
    );

    make(
      'votes',
      [
        rel('item', 'agenda_items', { required: true, cascadeDelete: true }),
        rel('meeting', 'ic_meetings'),
        rel('member', 'members', { required: true }),
        txt('ballot_sealed', 4000),
        txt('choice', 10),
        txt('rationale', 300),
        bool('veto'),
        bool('revealed'),
        txt('scale', 20),
        int('seniority'),
        txt('cast_at', 40),
        sel('actor', ['person', 'agent', 'system'], true),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_votes_item_member ON votes (item, member)'],
    );

    make(
      'decisions',
      [
        rel('deal', 'deals', { required: true }),
        rel('company', 'companies'),
        rel('item', 'agenda_items'),
        rel('meeting', 'ic_meetings'),
        rel('fund', 'entities'),
        sel('outcome', ['invest', 'pass', 'more_diligence', 'hold'], true),
        sel('rule', ['consensus', 'champion', 'majority'], true),
        txt('rule_result', 20),
        txt('reason', 40),
        txt('note', 1000),
        json('tally', 40000),
        rel('memo', 'memos'),
        int('memo_version', { min: 0 }),
        txt('memo_hash', 64),
        json('snapshot', 400000),
        rel('decided_by', 'members'),
        req('decided_at', 40),
        txt('corrects', 20),
        json('reviews', 60000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_decisions_deal ON decisions (deal, decided_at)', 'CREATE INDEX idx_decisions_outcome ON decisions (outcome, decided_at)'],
    );

    make(
      'conditions',
      [
        rel('decision', 'decisions'),
        rel('deal', 'deals', { required: true }),
        req('text', 300),
        rel('owner', 'members'),
        txt('due_day', 10),
        sel('status', ['open', 'done', 'waived'], true),
        txt('evidence', 1000),
        txt('completed_at', 40),
        rel('completed_by', 'members'),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_conditions_status ON conditions (status, due_day)', 'CREATE INDEX idx_conditions_deal ON conditions (deal)', 'CREATE INDEX idx_conditions_owner ON conditions (owner, status)'],
    );

    const t = new Record(app.findCollectionByNameOrId('memo_templates'));
    t.set('name', 'Investment memo');
    t.set('sections', [
      { key: 'summary', label: 'Summary', people_only: false },
      { key: 'company', label: 'Company', people_only: false },
      { key: 'team', label: 'Team', people_only: false },
      { key: 'market', label: 'Market', people_only: false },
      { key: 'product', label: 'Product', people_only: false },
      { key: 'traction', label: 'Traction', people_only: false },
      { key: 'business_model', label: 'Business model', people_only: false },
      { key: 'competition', label: 'Competition', people_only: false },
      { key: 'round_terms', label: 'Round and terms', people_only: false },
      { key: 'risks', label: 'Risks', people_only: false },
      { key: 'thesis', label: 'Thesis', people_only: true },
      { key: 'recommendation', label: 'Recommendation', people_only: true },
      { key: 'scenarios', label: 'Scenarios', people_only: true },
    ]);
    t.set('is_default', true);
    t.set('archived', false);
    t.set('actor', 'system');
    app.save(t);
  },
  (app) => {
    for (const n of ['conditions', 'decisions', 'votes', 'agenda_items', 'ic_meetings', 'memo_blocks', 'memos', 'memo_templates']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
