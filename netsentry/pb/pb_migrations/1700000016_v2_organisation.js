/// <reference path="../pb_data/types.d.ts" />
/**
 * v2 P3 — organisations (docs/SYSTEM-V2-PLAN.md §4.2, §9.6, §12).
 * - `networks`: the networks NetSentry may look at. Proposed from what the
 *   monitors see; scanned only once a person confirms each one (scan scope).
 * - `devices`: what discovery found on confirmed networks (one row per device).
 * - `app_access`: opt-in read-only app keys for account checks (D12,
 *   organisation mode only). The key is a hidden field: never returned by the
 *   API, only handed to the monitor on the NetSentry machine that uses it.
 * - `access_reviews`: "who has admin in X" reviewed, by whom, when.
 * - `reports`: the monthly one-pager, kept as data + the rendered page.
 * - users.role gains `auditor` (reads reports and evidence, changes nothing).
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    const readOnly = { listRule: PEOPLE, viewRule: PEOPLE, createRule: null, updateRule: null, deleteRule: null };
    const assetsId = app.findCollectionByNameOrId('assets').id;
    const appsId = app.findCollectionByNameOrId('apps').id;

    app.save(new Collection({
      type: 'base',
      name: 'networks',
      ...readOnly,
      fields: [
        { name: 'cidr', type: 'text', required: true, max: 50 },
        { name: 'name', type: 'text', max: 120 },
        { name: 'purpose', type: 'select', values: ['office', 'servers', 'vpn', 'guest', 'home', 'other'], maxSelect: 1 },
        { name: 'source', type: 'select', required: true, values: ['detected', 'person'], maxSelect: 1 },
        { name: 'state', type: 'select', required: true, values: ['proposed', 'confirmed', 'ignored'], maxSelect: 1 },
        { name: 'gateway', type: 'text', max: 50 },
        { name: 'seen_by', type: 'relation', collectionId: assetsId, maxSelect: 1, cascadeDelete: false },
        { name: 'confirmed_by', type: 'text', max: 200 },
        { name: 'confirmed_at', type: 'date' },
        { name: 'last_scan', type: 'date' },
        { name: 'device_count', type: 'number', onlyInt: true },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_networks_cidr ON networks (cidr)'],
    }));
    const networksId = app.findCollectionByNameOrId('networks').id;

    app.save(new Collection({
      type: 'base',
      name: 'devices',
      ...readOnly,
      fields: [
        { name: 'key', type: 'text', required: true, max: 100 },
        { name: 'network', type: 'relation', collectionId: networksId, maxSelect: 1, cascadeDelete: true },
        { name: 'ip', type: 'text', required: true, max: 50 },
        { name: 'mac', type: 'text', max: 30 },
        { name: 'hostname', type: 'text', max: 200 },
        { name: 'kind', type: 'select', required: true, values: ['server', 'pc', 'printer', 'network', 'phone', 'other', 'unknown'], maxSelect: 1 },
        { name: 'label', type: 'text', max: 120 },
        { name: 'owner', type: 'text', max: 200 },
        { name: 'open_ports', type: 'json', maxSize: 5000 },
        { name: 'web', type: 'json', maxSize: 20000 },
        { name: 'apps', type: 'json', maxSize: 5000 },
        { name: 'monitored_by', type: 'relation', collectionId: assetsId, maxSelect: 1, cascadeDelete: false },
        { name: 'status', type: 'select', required: true, values: ['new', 'known', 'ignored', 'gone'], maxSelect: 1 },
        { name: 'first_seen', type: 'date' },
        { name: 'last_seen', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_devices_key ON devices (key)', 'CREATE INDEX idx_devices_ip ON devices (ip)'],
    }));

    app.save(new Collection({
      type: 'base',
      name: 'app_access',
      ...readOnly,
      fields: [
        { name: 'app', type: 'relation', collectionId: appsId, maxSelect: 1, cascadeDelete: true, required: true },
        { name: 'secret', type: 'text', max: 500, hidden: true },
        { name: 'hint', type: 'text', max: 20 },
        { name: 'added_by', type: 'text', max: 200 },
        { name: 'added_at', type: 'date' },
        { name: 'last_ok', type: 'date' },
        { name: 'last_error', type: 'text', max: 300 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_app_access_app ON app_access (app)'],
    }));

    app.save(new Collection({
      type: 'base',
      name: 'access_reviews',
      ...readOnly,
      fields: [
        { name: 'app', type: 'relation', collectionId: appsId, maxSelect: 1, cascadeDelete: true, required: true },
        { name: 'reviewer', type: 'text', max: 200 },
        { name: 'reviewed_at', type: 'date' },
        { name: 'note', type: 'text', max: 1000 },
        { name: 'accounts', type: 'json', maxSize: 50000 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_access_reviews_app ON access_reviews (app)'],
    }));

    app.save(new Collection({
      type: 'base',
      name: 'reports',
      ...readOnly,
      fields: [
        { name: 'period', type: 'text', required: true, max: 20 },
        { name: 'kind', type: 'select', required: true, values: ['monthly'], maxSelect: 1 },
        { name: 'generated_at', type: 'date' },
        { name: 'generated_by', type: 'text', max: 200 },
        { name: 'data', type: 'json', maxSize: 500000 },
        { name: 'sent_to', type: 'json', maxSize: 5000 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_reports_period ON reports (kind, period)'],
    }));

    const settings = app.findCollectionByNameOrId('settings');
    settings.fields.add(new JSONField({ name: 'report_recipients', maxSize: 5000 }));
    settings.fields.add(new NumberField({ name: 'access_review_days', onlyInt: true, min: 0, max: 366 }));
    app.save(settings);

    const users = app.findCollectionByNameOrId('users');
    const role = users.fields.getByName('role');
    role.values = ['admin', 'analyst', 'viewer', 'auditor'];
    app.save(users);
  },
  (app) => {
    for (const name of ['reports', 'access_reviews', 'app_access', 'devices', 'networks']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
  },
);
