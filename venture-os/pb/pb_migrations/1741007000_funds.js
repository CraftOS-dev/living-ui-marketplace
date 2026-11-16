/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS funds module: LPs and their commitments, the firm's sealed wire
 * details, capital calls and distributions with one line per LP, payments,
 * the append-only ledger, NAV snapshots, marks, reserves, reserve
 * scenarios, quarter closes, LP reports and imported administrator or bank
 * statements.
 *
 * Money is integer minor units of the fund's currency; rates and ownership
 * in millionths (_ppm); days are YYYY-MM-DD text in the firm's zone.
 * Holdings belong to the portfolio module: they are referenced by id as
 * text and checked in code (lib_portfolio.holdingsOf). Every collection is
 * closed to the raw API; people and your AI agent reach it through ops.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const CUR = '^([A-Z]{3})?$';
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const day = (name, required) => ({ name: name, type: 'text', max: 10, pattern: DAY, required: required === true });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const file = (name, mimes) => ({ name: name, type: 'file', maxSelect: 1, maxSize: 20971520, protected: true, mimeTypes: mimes || [] });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members')];

    make(
      'lps',
      [
        req('name', 200),
        sel('kind', ['individual', 'family_office', 'fund_of_funds', 'endowment', 'foundation', 'pension', 'sovereign', 'corporate', 'insurer', 'bank', 'gp', 'other'], true),
        rel('company', 'companies'),
        rel('person', 'people'),
        json('contacts', 20000),
        txt('country', 2),
        txt('tax_id_sealed', 2000),
        txt('tax_id_mask', 40),
        txt('notes', 4000),
        json('prov', 20000),
        txt('deleted_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_lps_name ON lps (name)', "CREATE INDEX idx_lps_company ON lps (company) WHERE company != ''"],
    );

    make(
      'commitments',
      [
        rel('fund', 'entities', { required: true }),
        rel('lp', 'lps', { required: true }),
        sel('status', ['soft', 'signed'], true),
        int('amount_minor', { min: 0 }),
        txt('currency', 3, { pattern: CUR }),
        bool('fee_paying'),
        bool('fee_override'),
        int('fee_rate_ppm', { min: 0, max: 100000 }),
        int('waiver_ppm', { min: 0, max: 1000000 }),
        json('side_letter', 4000),
        day('closing_day'),
        txt('deal', 30),
        txt('notes', 2000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_commitments_fund_lp ON commitments (fund, lp)', "CREATE INDEX idx_commitments_deal ON commitments (deal) WHERE deal != ''"],
    );

    make(
      'bank_blocks',
      [
        rel('entity', 'entities', { required: true }),
        sel('status', ['pending', 'active', 'replaced', 'rejected'], true),
        txt('bank_name', 200),
        txt('details_sealed', 8000),
        txt('last4', 12),
        txt('currency', 3, { pattern: CUR }),
        rel('changed_by', 'members'),
        rel('approved_by', 'members'),
        txt('approved_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_bank_blocks_entity ON bank_blocks (entity, status)'],
    );

    make(
      'capital_events',
      [
        rel('fund', 'entities', { required: true }),
        sel('kind', ['call', 'distribution'], true),
        txt('number', 12),
        sel('status', ['draft', 'previewed', 'issued', 'settled', 'void'], true),
        day('notice_day', true),
        day('due_day', true),
        txt('currency', 3, { pattern: CUR }),
        json('purposes', 20000),
        int('total_minor'),
        int('carry_minor'),
        json('preview', 200000),
        txt('note', 8000),
        sel('note_by', ['', 'person', 'agent']),
        txt('note_at', 40),
        txt('narrative', 4000),
        txt('hash', 80),
        txt('issued_at', 40),
        rel('issued_by', 'members'),
        txt('voided_at', 40),
        rel('voided_by', 'members'),
        txt('void_reason', 600),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_capital_events_number ON capital_events (number) WHERE number != ''", 'CREATE INDEX idx_capital_events_fund ON capital_events (fund, kind, status)'],
    );

    make(
      'capital_lines',
      [
        rel('event', 'capital_events', { required: true, cascadeDelete: true }),
        rel('lp', 'lps', { required: true }),
        rel('commitment', 'commitments'),
        json('amounts', 4000),
        int('total_minor'),
        json('balances', 4000),
        file('notice', ['application/pdf']),
        file('notice_csv', ['text/csv', 'text/plain']),
        txt('outbound', 30),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_capital_lines_event_lp ON capital_lines (event, lp)', 'CREATE INDEX idx_capital_lines_lp ON capital_lines (lp)'],
    );

    make(
      'payments',
      [
        rel('event', 'capital_events', { required: true }),
        rel('line', 'capital_lines', { required: true }),
        rel('lp', 'lps', { required: true }),
        int('amount_minor', { min: 0 }),
        day('day', true),
        txt('reference', 200),
        sel('source', ['manual', 'statement', 'reconcile'], true),
        txt('statement', 30),
        txt('voided_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_payments_line ON payments (line)', 'CREATE INDEX idx_payments_event ON payments (event)'],
    );

    make(
      'ledger',
      [
        rel('fund', 'entities', { required: true }),
        rel('lp', 'lps'),
        txt('holding', 30),
        rel('event', 'capital_events'),
        day('day', true),
        sel(
          'type',
          ['call_investment', 'call_fees', 'call_expenses', 'call_other', 'call_recall', 'call_subline', 'dist_capital', 'dist_gain', 'opening_contributed', 'opening_distributed', 'opening_recallable', 'opening_recalled', 'opening_cash', 'investment', 'proceeds', 'carry'],
          true,
        ),
        int('amount_minor'),
        int('recallable_minor'),
        txt('currency', 3, { pattern: CUR }),
        sel('origin', ['call', 'distribution', 'opening', 'void', 'manual'], true),
        txt('reverses', 30),
        txt('note', 600),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_ledger_fund_day ON ledger (fund, day)', "CREATE INDEX idx_ledger_lp ON ledger (lp) WHERE lp != ''", "CREATE INDEX idx_ledger_holding ON ledger (holding) WHERE holding != ''", "CREATE INDEX idx_ledger_event ON ledger (event) WHERE event != ''"],
    );

    make(
      'quarters',
      [
        rel('fund', 'entities', { required: true }),
        day('period_end', true),
        txt('label', 20),
        sel('status', ['open', 'frozen', 'final', 'sent'], true),
        txt('opened_at', 40),
        txt('frozen_at', 40),
        rel('frozen_by', 'members'),
        txt('hash', 80),
        json('snapshot', 600000),
        txt('finalized_at', 40),
        rel('finalized_by', 'members'),
        txt('sent_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_quarters_fund_end ON quarters (fund, period_end)'],
    );

    make(
      'nav',
      [
        rel('fund', 'entities', { required: true }),
        rel('quarter', 'quarters'),
        day('period_end', true),
        int('nav_minor'),
        int('holdings_value_minor'),
        int('cash_minor'),
        txt('currency', 3, { pattern: CUR }),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_nav_fund_end ON nav (fund, period_end)'],
    );

    make(
      'marks',
      [
        rel('fund', 'entities', { required: true }),
        req('holding', 30),
        rel('quarter', 'quarters'),
        day('as_of_day', true),
        int('value_minor', { min: 0 }),
        int('prior_minor'),
        txt('currency', 3, { pattern: CUR }),
        sel('method', ['calibrated_round', 'round_adjusted', 'multiples', 'write_down', 'write_off'], true),
        txt('rationale', 8000),
        json('inputs', 40000),
        sel('status', ['draft', 'approved', 'superseded'], true),
        rel('approved_by', 'members'),
        txt('approved_at', 40),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_marks_holding ON marks (holding, status, as_of_day)', 'CREATE INDEX idx_marks_quarter ON marks (quarter)'],
    );

    make(
      'reserves',
      [
        rel('fund', 'entities', { required: true }),
        req('holding', 30),
        int('target_ppm', { min: 0, max: 1000000 }),
        int('rounds', { min: 0, max: 8 }),
        json('assumptions', 20000),
        int('allocated_minor', { min: 0 }),
        txt('notes', 2000),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_reserves_fund_holding ON reserves (fund, holding)'],
    );

    make(
      'scenarios',
      [rel('fund', 'entities', { required: true }), req('name', 120), int('budget_minor', { min: 0 }), json('holdings', 100000), txt('notes', 2000), json('prov', 20000)].concat(written()).concat(stamps),
      ['CREATE UNIQUE INDEX idx_scenarios_fund_name ON scenarios (fund, name)'],
    );

    make(
      'reports',
      [
        rel('quarter', 'quarters', { required: true, cascadeDelete: true }),
        rel('fund', 'entities', { required: true }),
        sel('kind', ['letter', 'pack'], true),
        rel('lp', 'lps'),
        json('paragraphs', 200000),
        sel('status', ['draft', 'final', 'sent', 'failed'], true),
        file('file', ['application/pdf']),
        txt('outbound', 30),
        int('ai_chars', { min: 0 }),
        int('typed_chars', { min: 0 }),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_reports_quarter ON reports (quarter, kind)'],
    );

    make(
      'statements',
      [
        rel('fund', 'entities', { required: true }),
        sel('source', ['administrator', 'bank'], true),
        day('period_end'),
        txt('file', 30),
        txt('name', 200),
        json('rows', 400000),
        json('differences', 200000),
        sel('status', ['imported', 'reconciled'], true),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_statements_fund ON statements (fund, period_end)'],
    );
  },
  (app) => {
    for (const n of ['statements', 'reports', 'scenarios', 'reserves', 'marks', 'nav', 'quarters', 'ledger', 'payments', 'capital_lines', 'capital_events', 'bank_blocks', 'commitments', 'lps']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
