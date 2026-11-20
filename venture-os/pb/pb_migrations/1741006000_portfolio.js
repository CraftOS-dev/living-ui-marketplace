/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS portfolio: positions and monitoring.
 *
 * Positions: `holdings` (a fund's position in a company: status, pro rata
 * right, board role, fiscal year end and reporting currency), `rounds` (a
 * company's financing rounds with the summary cap table), `securities`
 * (what the fund holds: SAFEs, notes, priced shares; converted SAFEs point
 * at the shares they became) and `ownership` (dated fully diluted
 * ownership in ppm, one row per change).
 *
 * Monitoring: `kpi_defs` (seeded: revenue, arr, mrr, gross_margin,
 * net_burn, cash, runway (computed), headcount, customers, nrr),
 * `kpi_values` (one value per company, metric and period; staged by your
 * AI agent or an import, verified or rejected by a person; forecasts kept
 * apart), `requests` (each company's founder request schedule, off by
 * default), `updates` (founder updates filed from Gmail or dropped files),
 * `alerts` (fired once per breach), `asks` (founder asks as tracked work)
 * and `board_meetings` (with the board brief).
 *
 * Units: money `_minor` in the record's currency; KPI `value` is minor
 * units for money metrics, ppm for percent metrics and a plain count
 * otherwise; ownership and rates `_ppm`; prices `_e8`; days `YYYY-MM-DD`
 * in the firm's zone; timestamps `_at`. Every rule is null: people and
 * your AI agent reach these through operations only.
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
    const day = (name) => ({ name: name, type: 'text', max: 10, pattern: DAY });
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
    const ROUND_TYPES = ['pre_seed', 'seed', 'seed_extension', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'other'];

    make(
      'holdings',
      [
        rel('company', 'companies', { required: true }),
        rel('fund', 'entities'),
        rel('deal', 'deals'),
        sel('status', ['active', 'exited', 'written_off'], true),
        txt('currency', 3, { pattern: CUR }),
        bool('pro_rata'),
        bool('major_investor'),
        sel('board_role', ['none', 'observer', 'seat']),
        day('first_day'),
        day('exit_day'),
        int('proceeds_minor', { min: 0 }),
        int('fy_end_month', { min: 1, max: 12 }),
        txt('report_currency', 3, { pattern: CUR }),
        rel('lead', 'members'),
        txt('note', 2000),
        json('prov', 20000),
        txt('deleted_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_holdings_company_fund ON holdings (company, fund) WHERE deleted_at = ''", 'CREATE INDEX idx_holdings_fund ON holdings (fund, status)', 'CREATE INDEX idx_holdings_deal ON holdings (deal)'],
    );

    make(
      'rounds',
      [
        rel('company', 'companies', { required: true }),
        rel('holding', 'holdings'),
        day('day'),
        sel('type', ROUND_TYPES),
        txt('label', 80),
        txt('currency', 3, { pattern: CUR }),
        int('pre_money_minor', { min: 0 }),
        int('post_money_minor', { min: 0 }),
        int('raised_minor', { min: 0 }),
        int('price_e8', { min: 0 }),
        int('pre_shares', { min: 0 }),
        int('post_shares', { min: 0 }),
        int('pool_increase_shares', { min: 0 }),
        json('cap_table', 100000),
        json('anchors', 20000),
        json('conversion', 100000),
        txt('note', 2000),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_rounds_company ON rounds (company, day)'],
    );

    make(
      'securities',
      [
        rel('holding', 'holdings', { required: true, cascadeDelete: true }),
        rel('round', 'rounds'),
        sel('kind', ['safe_cap', 'safe_discount', 'safe_mfn', 'note', 'priced', 'common'], true),
        txt('class', 80),
        day('day'),
        int('shares', { min: 0 }),
        int('cost_minor', { min: 0 }),
        int('cap_minor', { min: 0 }),
        int('discount_ppm', { min: 0, max: 1000000 }),
        int('rate_ppm', { min: 0, max: 1000000 }),
        int('liq_pref_e8', { min: 0 }),
        bool('participating'),
        sel('status', ['outstanding', 'converted'], true),
        txt('converted_into', 20),
        day('converted_day'),
        json('anchors', 20000),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_securities_holding ON securities (holding, status)'],
    );

    make(
      'ownership',
      [
        rel('holding', 'holdings', { required: true, cascadeDelete: true }),
        req('day', 10),
        int('ppm', { min: 0, max: 1000000 }),
        int('shares', { min: 0 }),
        int('fd_shares', { min: 0 }),
        sel('basis', ['cap', 'priced', 'converted', 'round', 'import', 'manual'], true),
        rel('round', 'rounds'),
        rel('security', 'securities'),
        txt('note', 300),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_ownership_holding ON ownership (holding, day)'],
    );

    make(
      'kpi_defs',
      [req('key', 40), req('label', 60), sel('kind', ['flow', 'stock', 'ratio', 'computed'], true), sel('unit', ['money', 'count', 'percent', 'months'], true), int('sort'), bool('active'), bool('seeded')].concat(written()).concat(stamps),
      ['CREATE UNIQUE INDEX idx_kpi_defs_key ON kpi_defs (key)'],
    );

    make(
      'updates',
      [
        rel('company', 'companies'),
        rel('holding', 'holdings'),
        sel('source', ['email', 'upload', 'manual'], true),
        txt('from_email', 200),
        txt('from_name', 200),
        txt('subject', 400),
        txt('body', 100000),
        txt('message_id', 200),
        txt('thread_id', 200),
        txt('received_at', 40),
        json('files', 4000),
        day('period_end'),
        sel('status', ['received', 'staged', 'verified', 'dismissed'], true),
        txt('note', 1000),
      ]
        .concat(written())
        .concat(stamps),
      ["CREATE UNIQUE INDEX idx_updates_message ON updates (message_id) WHERE message_id != ''", 'CREATE INDEX idx_updates_company ON updates (company, received_at)', 'CREATE INDEX idx_updates_status ON updates (status)'],
    );

    make(
      'kpi_values',
      [
        rel('company', 'companies', { required: true }),
        rel('holding', 'holdings'),
        req('key', 40),
        rel('def', 'kpi_defs'),
        day('period_start'),
        req('period_end', 10),
        int('months', { min: 1, max: 12 }),
        int('value'),
        txt('currency', 3, { pattern: CUR }),
        bool('forecast'),
        sel('status', ['staged', 'verified', 'rejected', 'superseded'], true),
        sel('source', ['update', 'import', 'manual'], true),
        rel('update', 'updates'),
        txt('anchor', 20),
        txt('quote', 1000),
        json('flags', 4000),
        txt('note', 600),
        rel('verified_by', 'members'),
        txt('verified_at', 40),
        txt('run', 40),
        json('prov', 4000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_kpi_values_series ON kpi_values (company, key, period_end)', 'CREATE INDEX idx_kpi_values_update ON kpi_values (update, status)', 'CREATE INDEX idx_kpi_values_status ON kpi_values (status)'],
    );

    make(
      'requests',
      [
        rel('company', 'companies', { required: true }),
        rel('holding', 'holdings'),
        bool('enabled'),
        sel('cadence', ['monthly', 'quarterly'], true),
        json('metrics', 2000),
        json('to', 4000),
        day('period_end'),
        txt('sent_at', 40),
        int('reminders', { min: 0, max: 2 }),
        txt('reminded_at', 40),
        txt('received_at', 40),
        txt('outbound', 20),
        txt('error', 600),
        rel('enabled_by', 'members'),
        txt('enabled_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_requests_company ON requests (company)'],
    );

    make(
      'alerts',
      [
        rel('company', 'companies', { required: true }),
        rel('holding', 'holdings'),
        sel('rule', ['runway_low', 'missed_update', 'burn_up', 'cash_low'], true),
        sel('level', ['warn', 'bad'], true),
        req('breach', 40),
        req('title', 200),
        json('figure', 20000),
        req('fired_at', 40),
        sel('status', ['open', 'acked', 'resolved'], true),
        rel('acked_by', 'members'),
        txt('acked_at', 40),
        txt('resolved_at', 40),
        txt('note', 600),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_alerts_breach ON alerts (company, rule, breach)', 'CREATE INDEX idx_alerts_status ON alerts (status, fired_at)'],
    );

    make(
      'asks',
      [
        rel('company', 'companies', { required: true }),
        rel('holding', 'holdings'),
        rel('update', 'updates'),
        sel('kind', ['intro', 'hire', 'customer', 'fundraising', 'advice', 'other'], true),
        req('title', 300),
        txt('detail', 2000),
        rel('owner', 'members'),
        sel('status', ['open', 'in_progress', 'done'], true),
        txt('outcome', 1000),
        txt('intro', 20),
        day('due_day'),
        txt('anchor', 20),
        txt('quote', 1000),
        txt('done_at', 40),
        json('prov', 4000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_asks_company ON asks (company, status)', 'CREATE INDEX idx_asks_owner ON asks (owner, status)'],
    );

    make(
      'board_meetings',
      [
        rel('company', 'companies', { required: true }),
        rel('holding', 'holdings'),
        req('day', 10),
        txt('time', 5),
        txt('title', 200),
        txt('note', 20000),
        json('brief', 100000),
        txt('brief_at', 40),
        txt('deck', 20),
        json('prov', 4000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_board_company ON board_meetings (company, day)', 'CREATE INDEX idx_board_day ON board_meetings (day)'],
    );

    const defs = [
      ['revenue', 'Revenue', 'flow', 'money'],
      ['arr', 'ARR', 'stock', 'money'],
      ['mrr', 'MRR', 'stock', 'money'],
      ['gross_margin', 'Gross margin', 'ratio', 'percent'],
      ['net_burn', 'Net burn', 'flow', 'money'],
      ['cash', 'Cash', 'stock', 'money'],
      ['runway', 'Runway', 'computed', 'months'],
      ['headcount', 'Headcount', 'stock', 'count'],
      ['customers', 'Customers', 'stock', 'count'],
      ['nrr', 'NRR', 'ratio', 'percent'],
    ];
    const col = app.findCollectionByNameOrId('kpi_defs');
    defs.forEach((d, i) => {
      const r = new Record(col);
      r.set('key', d[0]);
      r.set('label', d[1]);
      r.set('kind', d[2]);
      r.set('unit', d[3]);
      r.set('sort', (i + 1) * 10);
      r.set('active', true);
      r.set('seeded', true);
      r.set('actor', 'system');
      app.save(r);
    });
  },
  (app) => {
    for (const n of ['board_meetings', 'asks', 'alerts', 'requests', 'kpi_values', 'updates', 'kpi_defs', 'ownership', 'securities', 'rounds', 'holdings']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
