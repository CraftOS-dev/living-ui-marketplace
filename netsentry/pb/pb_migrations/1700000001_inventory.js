/// <reference path="../pb_data/types.d.ts" />
/**
 * Inventory: assets (what we watch), sources (collector × target × schedule)
 * and scan_runs (one row per collection run). Global intel sources have no
 * target and are seeded here so a fresh install refreshes intel on its first tick.
 */
migrate(
  (app) => {
    const AUTHED = '@request.auth.id != ""';
    const readOnly = {
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };

    const assets = new Collection({
      type: 'base',
      name: 'assets',
      ...readOnly,
      fields: [
        { name: 'kind', type: 'select', required: true, values: ['domain', 'subdomain', 'ip'], maxSelect: 1 },
        { name: 'identifier', type: 'text', required: true, max: 255 },
        { name: 'label', type: 'text', max: 120 },
        { name: 'ownership', type: 'select', required: true, values: ['unverified', 'verified', 'discovered'], maxSelect: 1 },
        { name: 'verify_token', type: 'text', max: 64 },
        { name: 'status', type: 'select', required: true, values: ['active', 'retired'], maxSelect: 1 },
        { name: 'added_by', type: 'text', max: 200 },
        { name: 'first_seen', type: 'date' },
        { name: 'last_seen', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_assets_kind_identifier ON assets (kind, identifier)'],
    });
    app.save(assets);

    // Self-relation needs the saved collection's id.
    const saved = app.findCollectionByNameOrId('assets');
    saved.fields.add(
      new RelationField({ name: 'parent', collectionId: saved.id, maxSelect: 1, cascadeDelete: false }),
    );
    app.save(saved);

    const sources = new Collection({
      type: 'base',
      name: 'sources',
      ...readOnly,
      fields: [
        { name: 'collector', type: 'text', required: true, max: 60 },
        { name: 'target', type: 'relation', collectionId: saved.id, maxSelect: 1, cascadeDelete: true },
        { name: 'schedule_minutes', type: 'number', required: true, onlyInt: true, min: 5, max: 10080 },
        { name: 'next_run', type: 'date' },
        { name: 'enabled', type: 'bool' },
        { name: 'health', type: 'select', required: true, values: ['unknown', 'ok', 'degraded', 'failing'], maxSelect: 1 },
        { name: 'last_run', type: 'date' },
        { name: 'last_error', type: 'text', max: 1000 },
        { name: 'consecutive_failures', type: 'number', onlyInt: true, min: 0 },
        { name: 'run_count', type: 'number', onlyInt: true, min: 0 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_sources_next_run ON sources (next_run)',
        'CREATE UNIQUE INDEX idx_sources_collector_target ON sources (collector, target)',
      ],
    });
    app.save(sources);

    const runs = new Collection({
      type: 'base',
      name: 'scan_runs',
      ...readOnly,
      fields: [
        {
          name: 'source',
          type: 'relation',
          collectionId: app.findCollectionByNameOrId('sources').id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: 'collector', type: 'text', max: 60 },
        { name: 'target_label', type: 'text', max: 255 },
        { name: 'trigger', type: 'select', values: ['schedule', 'manual'], maxSelect: 1 },
        { name: 'status', type: 'select', required: true, values: ['ok', 'error'], maxSelect: 1 },
        { name: 'observations', type: 'number', onlyInt: true, min: 0 },
        { name: 'changes', type: 'number', onlyInt: true, min: 0 },
        { name: 'findings_opened', type: 'number', onlyInt: true, min: 0 },
        { name: 'findings_resolved', type: 'number', onlyInt: true, min: 0 },
        { name: 'duration_ms', type: 'number', onlyInt: true, min: 0 },
        { name: 'error', type: 'text', max: 1000 },
        { name: 'note', type: 'text', max: 500 },
        { name: 'started', type: 'date', required: true },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_scan_runs_started ON scan_runs (started)'],
    });
    app.save(runs);

    // Global intel sources (no target) — refreshed daily, first run on the first tick.
    const sourcesCol = app.findCollectionByNameOrId('sources');
    for (const collector of ['intel.kev', 'intel.epss', 'intel.blocklists']) {
      const src = new Record(sourcesCol);
      src.set('collector', collector);
      src.set('schedule_minutes', 1440);
      src.set('next_run', new Date().toISOString());
      src.set('enabled', true);
      src.set('health', 'unknown');
      src.set('consecutive_failures', 0);
      src.set('run_count', 0);
      app.save(src);
    }
  },
  (app) => {
    for (const name of ['scan_runs', 'sources', 'assets']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
