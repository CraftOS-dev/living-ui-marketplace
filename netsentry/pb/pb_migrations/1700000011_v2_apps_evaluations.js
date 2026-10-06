/// <reference path="../pb_data/types.d.ts" />
/**
 * v2 foundations (docs/SYSTEM-V2-PLAN.md §13.2).
 * - `apps`: the apps people run (recognised from containers, services, HTTP
 *   answers), the top of the product (D5).
 * - `intents`: "who should be able to reach this app?" per app (D6).
 * - `backup_plans`: what is backed up and how NetSentry knows (heartbeat URL,
 *   or declared). The heartbeat token is stored hashed only.
 * - `evaluations`: one row per (check × subject) with pass / fail /
 *   not_applicable / unknown — the coverage table (trust bar §6).
 * - `app_intel`: latest release + published security advisories per app type,
 *   fetched from each app's own upstream (never a CraftOS service, D9).
 * v1 `assets` stay the machine records for now; they become `resources` in the
 * release migration (plan §28).
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    const readOnly = { listRule: PEOPLE, viewRule: PEOPLE, createRule: null, updateRule: null, deleteRule: null };
    const assetsId = app.findCollectionByNameOrId('assets').id;
    const findingsId = app.findCollectionByNameOrId('findings').id;

    app.save(new Collection({
      type: 'base',
      name: 'apps',
      ...readOnly,
      fields: [
        { name: 'key', type: 'text', required: true, max: 300 },
        { name: 'app_type', type: 'text', required: true, max: 60 },
        { name: 'asset', type: 'relation', collectionId: assetsId, maxSelect: 1, cascadeDelete: true, required: true },
        { name: 'display_name', type: 'text', max: 120 },
        { name: 'label', type: 'text', max: 120 },
        { name: 'container', type: 'text', max: 200 },
        { name: 'compose_project', type: 'text', max: 120 },
        { name: 'compose_service', type: 'text', max: 120 },
        { name: 'version', type: 'text', max: 60 },
        { name: 'endpoints', type: 'json', maxSize: 20000 },
        { name: 'recognised_by', type: 'json', maxSize: 10000 },
        { name: 'importance', type: 'select', required: true, values: ['low', 'normal', 'critical'], maxSelect: 1 },
        { name: 'owner', type: 'text', max: 200 },
        { name: 'status', type: 'select', required: true, values: ['active', 'gone', 'ignored'], maxSelect: 1 },
        { name: 'first_seen', type: 'date' },
        { name: 'last_seen', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_apps_key ON apps (key)', 'CREATE INDEX idx_apps_asset ON apps (asset)'],
    }));
    const appsId = app.findCollectionByNameOrId('apps').id;

    app.save(new Collection({
      type: 'base',
      name: 'intents',
      ...readOnly,
      fields: [
        { name: 'app', type: 'relation', collectionId: appsId, maxSelect: 1, cascadeDelete: true, required: true },
        {
          name: 'reach',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['this_machine', 'local_network', 'local_plus_private_remote', 'specific_networks', 'internet'],
        },
        { name: 'specific', type: 'json', maxSize: 5000 },
        { name: 'sign_in_required', type: 'bool' },
        { name: 'source', type: 'select', required: true, values: ['default', 'template', 'person'], maxSelect: 1 },
        { name: 'set_by', type: 'text', max: 200 },
        { name: 'set_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_intents_app ON intents (app)'],
    }));

    app.save(new Collection({
      type: 'base',
      name: 'backup_plans',
      ...readOnly,
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'asset', type: 'relation', collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
        { name: 'apps', type: 'relation', collectionId: appsId, maxSelect: 50, cascadeDelete: false },
        { name: 'method', type: 'select', required: true, values: ['heartbeat', 'declared', 'detected'], maxSelect: 1 },
        { name: 'schedule_hours', type: 'number', onlyInt: true, min: 1, max: 24 * 31 },
        { name: 'grace_hours', type: 'number', onlyInt: true, min: 0, max: 24 * 7 },
        { name: 'destination', type: 'text', max: 200 },
        { name: 'token_hash', type: 'text', max: 128, hidden: true },
        { name: 'last_success', type: 'date' },
        { name: 'last_failure', type: 'date' },
        { name: 'last_note', type: 'text', max: 300 },
        { name: 'created_by', type: 'text', max: 200 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_backup_plans_token ON backup_plans (token_hash) WHERE token_hash != ""'],
    }));

    app.save(new Collection({
      type: 'base',
      name: 'evaluations',
      ...readOnly,
      fields: [
        { name: 'fingerprint', type: 'text', required: true, max: 400 },
        { name: 'control', type: 'text', required: true, max: 60 },
        { name: 'control_version', type: 'number', onlyInt: true },
        { name: 'outcome', type: 'text', max: 30 },
        { name: 'subject_type', type: 'select', required: true, values: ['app', 'machine', 'filesystem', 'backup_plan'], maxSelect: 1 },
        { name: 'subject_key', type: 'text', required: true, max: 300 },
        { name: 'asset', type: 'relation', collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
        { name: 'app', type: 'relation', collectionId: appsId, maxSelect: 1, cascadeDelete: true },
        { name: 'state', type: 'select', required: true, values: ['pass', 'fail', 'not_applicable', 'unknown', 'accepted'], maxSelect: 1 },
        { name: 'reason', type: 'text', max: 500 },
        { name: 'severity', type: 'text', max: 20 },
        { name: 'factors', type: 'json', maxSize: 5000 },
        { name: 'evidence', type: 'json', maxSize: 50000 },
        { name: 'sources', type: 'json', maxSize: 5000 },
        { name: 'plain_title', type: 'text', max: 200 },
        { name: 'finding', type: 'relation', collectionId: findingsId, maxSelect: 1, cascadeDelete: false },
        { name: 'first_failed', type: 'date' },
        { name: 'evaluated_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_evaluations_fp ON evaluations (fingerprint)',
        'CREATE INDEX idx_evaluations_asset ON evaluations (asset)',
        'CREATE INDEX idx_evaluations_app ON evaluations (app)',
      ],
    }));

    app.save(new Collection({
      type: 'base',
      name: 'app_intel',
      ...readOnly,
      fields: [
        { name: 'app_type', type: 'text', required: true, max: 60 },
        { name: 'latest_version', type: 'text', max: 60 },
        { name: 'latest_published', type: 'date' },
        { name: 'advisories', type: 'json', maxSize: 200000 },
        { name: 'advisory_source', type: 'text', max: 200 },
        { name: 'fetched_at', type: 'date' },
        { name: 'error', type: 'text', max: 500 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_app_intel_type ON app_intel (app_type)'],
    }));
  },
  (app) => {
    for (const name of ['app_intel', 'evaluations', 'backup_plans', 'intents', 'apps']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
  },
);
