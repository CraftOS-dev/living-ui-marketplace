/// <reference path="../pb_data/types.d.ts" />
/**
 * Increment 2 — response: incidents (correlated findings), their timeline,
 * alert notifiers, and the daily-digest setting. Additive only.
 */
migrate(
  (app) => {
    const AUTHED = '@request.auth.id != ""';
    const readOnly = { listRule: AUTHED, viewRule: AUTHED, createRule: null, updateRule: null, deleteRule: null };
    const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
    const assetsId = app.findCollectionByNameOrId('assets').id;
    const usersId = app.findCollectionByNameOrId('users').id;

    app.save(
      new Collection({
        type: 'base',
        name: 'incidents',
        ...readOnly,
        fields: [
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'severity', type: 'select', required: true, values: SEVERITIES, maxSelect: 1 },
          { name: 'status', type: 'select', required: true, values: ['new', 'investigating', 'mitigated', 'closed', 'false_positive'], maxSelect: 1 },
          { name: 'correlation_key', type: 'text', required: true, max: 200 },
          { name: 'root_asset', type: 'relation', collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'assignee', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
          { name: 'needs_triage', type: 'bool' },
          { name: 'summary', type: 'text', max: 8000 },
          { name: 'confidence', type: 'select', values: ['low', 'medium', 'high'], maxSelect: 1 },
          { name: 'triaged_by', type: 'text', max: 200 },
          { name: 'triaged_at', type: 'date' },
          { name: 'finding_count', type: 'number', onlyInt: true, min: 0 },
          { name: 'opened_at', type: 'date', required: true },
          { name: 'last_activity', type: 'date', required: true },
          { name: 'closed_at', type: 'date' },
          { name: 'agent_request', type: 'text', max: 40 },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_incidents_key ON incidents (correlation_key)',
          'CREATE INDEX idx_incidents_status ON incidents (status)',
        ],
      }),
    );
    const incidentsId = app.findCollectionByNameOrId('incidents').id;

    app.save(
      new Collection({
        type: 'base',
        name: 'incident_notes',
        ...readOnly,
        fields: [
          { name: 'incident', type: 'relation', required: true, collectionId: incidentsId, maxSelect: 1, cascadeDelete: true },
          { name: 'kind', type: 'select', required: true, values: ['note', 'event'], maxSelect: 1 },
          { name: 'body', type: 'text', required: true, max: 5000 },
          { name: 'actor_type', type: 'select', required: true, values: ['user', 'agent', 'system'], maxSelect: 1 },
          { name: 'actor_label', type: 'text', max: 200 },
          { name: 'created', type: 'autodate', onCreate: true },
        ],
        indexes: ['CREATE INDEX idx_incident_notes_incident ON incident_notes (incident)'],
      }),
    );

    const findings = app.findCollectionByNameOrId('findings');
    findings.fields.add(new RelationField({ name: 'incident', collectionId: incidentsId, maxSelect: 1, cascadeDelete: false }));
    app.save(findings);

    app.save(
      new Collection({
        type: 'base',
        name: 'notifiers',
        ...readOnly,
        fields: [
          { name: 'kind', type: 'select', required: true, values: ['webhook', 'heartbeat', 'craftbot_email'], maxSelect: 1 },
          { name: 'name', type: 'text', required: true, max: 80 },
          { name: 'format', type: 'select', values: ['slack', 'discord', 'ntfy', 'json'], maxSelect: 1 },
          // Secret: AES-256-GCM with a key kept in pb_data/.netsentry_key. Never returned by any op.
          { name: 'url_encrypted', type: 'text', max: 4000, hidden: true },
          { name: 'url_hint', type: 'text', max: 120 },
          { name: 'min_severity', type: 'select', values: SEVERITIES, maxSelect: 1 },
          { name: 'send_digest', type: 'bool' },
          { name: 'interval_minutes', type: 'number', onlyInt: true, min: 0, max: 1440 },
          { name: 'enabled', type: 'bool' },
          { name: 'last_sent', type: 'date' },
          { name: 'last_ok', type: 'bool' },
          { name: 'last_error', type: 'text', max: 1000 },
          { name: 'sent_count', type: 'number', onlyInt: true, min: 0 },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
      }),
    );

    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.add(new NumberField({ name: 'digest_hour', onlyInt: true, min: -1, max: 23 }));
    settings.fields.add(new TextField({ name: 'digest_last_sent', max: 10 }));
    app.save(settings);
    for (const row of app.findRecordsByFilter('settings', 'id != ""', '', 0, 0)) {
      row.set('digest_hour', 8);
      app.save(row);
    }
  },
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.removeByName('digest_hour');
    settings.fields.removeByName('digest_last_sent');
    app.save(settings);
    const findings = app.findCollectionByNameOrId('findings');
    findings.fields.removeByName('incident');
    app.save(findings);
    for (const name of ['notifiers', 'incident_notes', 'incidents']) app.delete(app.findCollectionByNameOrId(name));
  },
);
