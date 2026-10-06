/// <reference path="../pb_data/types.d.ts" />
/**
 * Detection: observations (latest snapshot per asset/kind/subject), changes
 * (append-only diff log), rules (check catalogue + user overrides, synced from
 * code at boot), baselines, findings, suppressions, and threat intel
 * (CVE facts + blocklist indicators).
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
    const assetsId = app.findCollectionByNameOrId('assets').id;
    const sourcesId = app.findCollectionByNameOrId('sources').id;
    const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];

    app.save(
      new Collection({
        type: 'base',
        name: 'observations',
        ...readOnly,
        fields: [
          { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'source', type: 'relation', collectionId: sourcesId, maxSelect: 1, cascadeDelete: false },
          { name: 'kind', type: 'text', required: true, max: 60 },
          { name: 'subject', type: 'text', required: true, max: 255 },
          { name: 'key', type: 'text', required: true, max: 400 },
          { name: 'data', type: 'json', maxSize: 200000 },
          { name: 'present', type: 'bool' },
          { name: 'first_seen', type: 'date' },
          { name: 'last_seen', type: 'date' },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_observations_key ON observations (key)',
          'CREATE INDEX idx_observations_asset_kind ON observations (asset, kind)',
        ],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'changes',
        ...readOnly,
        fields: [
          { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'kind', type: 'text', required: true, max: 60 },
          { name: 'subject', type: 'text', required: true, max: 255 },
          { name: 'change', type: 'select', required: true, values: ['added', 'removed', 'modified'], maxSelect: 1 },
          { name: 'before', type: 'json', maxSize: 50000 },
          { name: 'after', type: 'json', maxSize: 50000 },
          { name: 'at', type: 'date', required: true },
        ],
        indexes: ['CREATE INDEX idx_changes_asset_at ON changes (asset, at)', 'CREATE INDEX idx_changes_at ON changes (at)'],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'rules',
        ...readOnly,
        fields: [
          { name: 'rule_id', type: 'text', required: true, max: 20 },
          { name: 'title', type: 'text', required: true, max: 200 },
          { name: 'category', type: 'text', required: true, max: 40 },
          { name: 'severity_default', type: 'select', required: true, values: SEVERITIES, maxSelect: 1 },
          { name: 'severity_override', type: 'select', values: SEVERITIES, maxSelect: 1 },
          { name: 'enabled', type: 'bool' },
          { name: 'version', type: 'number', onlyInt: true, min: 1 },
          { name: 'rationale', type: 'text', max: 4000 },
          { name: 'params', type: 'json', maxSize: 20000 },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_rules_rule_id ON rules (rule_id)'],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'baselines',
        ...readOnly,
        fields: [
          { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'kind', type: 'text', required: true, max: 60 },
          { name: 'accepted', type: 'json', maxSize: 50000 },
          { name: 'accepted_by', type: 'text', max: 200 },
          { name: 'at', type: 'date', required: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_baselines_asset_kind ON baselines (asset, kind)'],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'findings',
        ...readOnly,
        fields: [
          { name: 'fingerprint', type: 'text', required: true, max: 400 },
          { name: 'rule_id', type: 'text', required: true, max: 20 },
          { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'subject', type: 'text', max: 255 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'category', type: 'text', max: 40 },
          { name: 'severity', type: 'select', required: true, values: SEVERITIES, maxSelect: 1 },
          { name: 'status', type: 'select', required: true, values: ['open', 'acknowledged', 'resolved', 'suppressed'], maxSelect: 1 },
          { name: 'evidence', type: 'json', maxSize: 50000 },
          { name: 'first_seen', type: 'date', required: true },
          { name: 'last_seen', type: 'date', required: true },
          { name: 'resolved_at', type: 'date' },
          { name: 'reopen_count', type: 'number', onlyInt: true, min: 0 },
          { name: 'status_note', type: 'text', max: 1000 },
          { name: 'status_by', type: 'text', max: 200 },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_findings_fingerprint ON findings (fingerprint)',
          'CREATE INDEX idx_findings_status_severity ON findings (status, severity)',
          'CREATE INDEX idx_findings_asset ON findings (asset)',
        ],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'suppressions',
        ...readOnly,
        fields: [
          { name: 'fingerprint', type: 'text', required: true, max: 400 },
          { name: 'reason', type: 'text', required: true, max: 500 },
          { name: 'until', type: 'date' },
          { name: 'created_by', type: 'text', max: 200 },
          { name: 'created', type: 'autodate', onCreate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_suppressions_fingerprint ON suppressions (fingerprint)'],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'intel',
        ...readOnly,
        fields: [
          { name: 'cve', type: 'text', required: true, max: 30 },
          { name: 'kev', type: 'bool' },
          { name: 'kev_name', type: 'text', max: 300 },
          { name: 'kev_added', type: 'text', max: 10 },
          { name: 'epss', type: 'number', min: 0, max: 1 },
          { name: 'epss_percentile', type: 'number', min: 0, max: 1 },
          { name: 'refreshed_at', type: 'date' },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_intel_cve ON intel (cve)'],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'indicators',
        ...readOnly,
        fields: [
          { name: 'type', type: 'select', required: true, values: ['cidr', 'ip', 'domain'], maxSelect: 1 },
          { name: 'value', type: 'text', required: true, max: 255 },
          { name: 'source', type: 'text', required: true, max: 40 },
          { name: 'refreshed_at', type: 'date' },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_indicators_unique ON indicators (type, value, source)',
          'CREATE INDEX idx_indicators_value ON indicators (value)',
        ],
      }),
    );
  },
  (app) => {
    for (const name of ['indicators', 'intel', 'suppressions', 'findings', 'baselines', 'rules', 'changes', 'observations']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
