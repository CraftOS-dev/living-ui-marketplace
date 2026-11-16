/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS markets: sourcing radars under a thesis, the signals they pull
 * (and your AI agent adds), market maps and their entries.
 *
 * radars       one per thesis: keyless public sources the app pulls itself
 *              (SEC EDGAR Form D, Hacker News, GitHub search) plus registry
 *              sources your AI agent searches with its own access (UK
 *              Companies House, Japan corporate numbers), structured filters,
 *              a schedule (daily or weekly at HH:MM in the firm's zone), the
 *              last run and its counts, and per-source cursors (how far the
 *              between-run pulls have read).
 * signals      one candidate company per row (run 0: pulled between runs,
 *              delivered with the next run): where it came from (source,
 *              ext_id, source_url), structured facts and the engine's thesis
 *              fit, your AI agent's one line and context, a licence tag
 *              (public | internal_only), and its state: new (pulled, not
 *              screened), candidate (net-new, screened in), screened_out,
 *              known (already in the firm's records), dismissed, added (sent
 *              to the Inbox).
 * maps         a market landscape: segments as columns.
 * map_entries  a company on a map: segment, stored role (tracked |
 *              competitor; portfolio, pipeline and passed are computed from
 *              deals and holdings), source, and a dated history of moves so a
 *              map can be shown as it was on any day.
 *
 * Timestamps are ISO text (UTC); days are YYYY-MM-DD in the firm's zone.
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
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const written = () => [sel('actor', ['person', 'agent', 'system'], true), rel('member', 'members')];
    const SOURCES = ['edgar_form_d', 'hacker_news', 'github', 'companies_house', 'jp_corporate', 'agent', 'person'];

    make(
      'radars',
      [
        rel('thesis', 'theses', { required: true }),
        txt('name', 160),
        json('sources', 2000),
        json('filters', 20000),
        txt('query', 300),
        json('schedule', 2000),
        sel('status', ['active', 'paused'], true),
        txt('next_run_at', 40),
        txt('last_run_at', 40),
        int('runs', { min: 0 }),
        json('last_counts', 20000),
        json('cursors', 2000),
        txt('last_job', 20),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_radars_thesis ON radars (thesis)', 'CREATE INDEX idx_radars_due ON radars (status, next_run_at)'],
    );

    const radars = app.findCollectionByNameOrId('radars');
    make(
      'signals',
      [
        { name: 'radar', type: 'relation', maxSelect: 1, collectionId: radars.id, cascadeDelete: true, required: true },
        rel('thesis', 'theses', { required: true }),
        int('run', { min: 0 }),
        sel('source', SOURCES, true),
        sel('kind', ['raise_filed', 'launch', 'repo', 'incorporation', 'funding', 'hiring', 'founder_move', 'product', 'news', 'other'], true),
        txt('ext_id', 120),
        txt('name', 200),
        txt('domain', 200),
        txt('website', 500),
        rel('company', 'companies'),
        txt('title', 300),
        txt('summary', 240),
        txt('source_url', 1000),
        json('payload', 60000),
        json('facts', 10000),
        json('fit', 20000),
        json('context', 20000),
        sel('licence', ['public', 'internal_only'], true),
        sel('status', ['new', 'candidate', 'screened_out', 'known', 'dismissed', 'added'], true),
        txt('reason', 300),
        txt('known_as', 80),
        txt('intake_item', 30),
        txt('screened_at', 40),
        txt('decided_at', 40),
        rel('decided_by', 'members'),
        txt('run_at', 40),
      ]
        .concat(written())
        .concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_signals_ext ON signals (radar, source, ext_id) WHERE ext_id != ''",
        'CREATE INDEX idx_signals_queue ON signals (thesis, status, created)',
        'CREATE INDEX idx_signals_run ON signals (radar, run, status)',
        "CREATE INDEX idx_signals_domain ON signals (radar, domain) WHERE domain != ''",
      ],
    );

    make(
      'maps',
      [
        { name: 'name', type: 'text', required: true, max: 160 },
        rel('thesis', 'theses'),
        json('segments', 20000),
        sel('status', ['active', 'archived'], true),
        int('sort'),
        txt('last_refresh_at', 40),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE INDEX idx_maps_thesis ON maps (thesis, status)'],
    );

    const maps = app.findCollectionByNameOrId('maps');
    make(
      'map_entries',
      [
        { name: 'map', type: 'relation', maxSelect: 1, collectionId: maps.id, cascadeDelete: true, required: true },
        rel('company', 'companies', { required: true }),
        { name: 'segment', type: 'text', required: true, max: 60 },
        sel('role', ['tracked', 'competitor'], true),
        txt('note', 240),
        txt('source_url', 1000),
        txt('source_ref', 300),
        sel('licence', ['public', 'internal_only'], true),
        sel('status', ['active', 'removed'], true),
        txt('added_day', 10),
        txt('removed_day', 10),
        json('moves', 60000),
        json('prov', 20000),
      ]
        .concat(written())
        .concat(stamps),
      ['CREATE UNIQUE INDEX idx_map_entries_company ON map_entries (map, company)', 'CREATE INDEX idx_map_entries_map ON map_entries (map, status)'],
    );
  },
  (app) => {
    for (const name of ['map_entries', 'maps', 'signals', 'radars']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
