/// <reference path="../pb_data/types.d.ts" />
/**
 * Increment 5 — remediation: monitor → suggest → (agent) plan → (human)
 * approve → (agent) execute → (NetSentry) verify. Plus what the agent says it
 * can reach, and the workspace kill switch / auto-approve policy.
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    const readOnly = { listRule: PEOPLE, viewRule: PEOPLE, createRule: null, updateRule: null, deleteRule: null };
    const assetsId = app.findCollectionByNameOrId('assets').id;
    const findingsId = app.findCollectionByNameOrId('findings').id;
    const incidentsId = app.findCollectionByNameOrId('incidents').id;

    app.save(
      new Collection({
        type: 'base',
        name: 'remediations',
        ...readOnly,
        fields: [
          { name: 'finding', type: 'relation', collectionId: findingsId, maxSelect: 1, cascadeDelete: true },
          { name: 'fingerprint', type: 'text', max: 400 },
          { name: 'incident', type: 'relation', collectionId: incidentsId, maxSelect: 1, cascadeDelete: false },
          { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'playbook_id', type: 'text', required: true, max: 60 },
          { name: 'title', type: 'text', required: true, max: 300 },
          { name: 'risk_class', type: 'select', required: true, values: ['auto', 'approve', 'high', 'guided'], maxSelect: 1 },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['plan_requested', 'planned', 'approved', 'executing', 'verifying', 'done', 'failed', 'rolled_back', 'rejected', 'expired', 'cancelled'],
            maxSelect: 1,
          },
          { name: 'plan', type: 'json', maxSize: 100000 },
          { name: 'plan_hash', type: 'text', max: 64 },
          { name: 'approved_plan_hash', type: 'text', max: 64 },
          { name: 'executed_plan_hash', type: 'text', max: 64 },
          { name: 'preconditions', type: 'json', maxSize: 20000 },
          { name: 'blast_radius', type: 'text', max: 2000 },
          { name: 'downtime', type: 'text', max: 500 },
          { name: 'cost_note', type: 'text', max: 500 },
          { name: 'backup_ref', type: 'text', max: 500 },
          { name: 'steps_log', type: 'json', maxSize: 100000 },
          { name: 'verify_result', type: 'json', maxSize: 20000 },
          { name: 'requested_by', type: 'text', max: 200 },
          { name: 'planned_by', type: 'text', max: 200 },
          { name: 'approved_by', type: 'text', max: 200 },
          { name: 'executor', type: 'text', max: 200 },
          { name: 'approved_at', type: 'date' },
          { name: 'claimed_at', type: 'date' },
          { name: 'completed_at', type: 'date' },
          { name: 'deadline_at', type: 'date' },
          { name: 'failure_reason', type: 'text', max: 2000 },
          { name: 'agent_request', type: 'text', max: 40 },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_remediations_status ON remediations (status)',
          'CREATE INDEX idx_remediations_asset ON remediations (asset)',
        ],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'agent_access',
        ...readOnly,
        fields: [
          { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'can_execute', type: 'bool' },
          { name: 'method', type: 'text', max: 60 },
          { name: 'missing', type: 'text', max: 1000 },
          { name: 'reported_at', type: 'date' },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_agent_access_asset ON agent_access (asset)'],
      }),
    );

    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.add(new BoolField({ name: 'remediation_paused' }));
    settings.fields.add(new BoolField({ name: 'auto_approve_low_risk' }));
    app.save(settings);
  },
  (app) => {
    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.removeByName('remediation_paused');
    settings.fields.removeByName('auto_approve_low_risk');
    app.save(settings);
    app.delete(app.findCollectionByNameOrId('agent_access'));
    app.delete(app.findCollectionByNameOrId('remediations'));
  },
);
