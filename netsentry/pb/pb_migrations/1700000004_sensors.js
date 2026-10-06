/// <reference path="../pb_data/types.d.ts" />
/**
 * Increment 3 — the Sensor.
 * - `sensors`: an AUTH collection. Each sensor is a real principal (revocable
 *   password-token), so it passes the platform's caller auth without special
 *   cases; roles.js limits it to the sensor operations.
 * - `signals`: pre-aggregated events from sensors (e.g. failed logins per
 *   source per minute), short retention.
 * - `host` asset kind, and a `sensor` link on sources (remote collectors are
 *   never run by the scheduler; their sensor reports them).
 * - Read access is narrowed to PEOPLE: now that sensors are principals too,
 *   "any signed-in record" would let a sensor read the whole workspace.
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    const assetsId = app.findCollectionByNameOrId('assets').id;

    const sensors = new Collection({
      type: 'auth',
      name: 'sensors',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      authRule: 'status != "revoked"',
      manageRule: null,
      passwordAuth: { enabled: true, identityFields: ['email'] },
      authToken: { duration: 86400 },
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        { name: 'status', type: 'select', required: true, values: ['pending', 'online', 'offline', 'revoked'], maxSelect: 1 },
        { name: 'hostname', type: 'text', max: 255 },
        { name: 'platform', type: 'text', max: 40 },
        { name: 'os', type: 'text', max: 200 },
        { name: 'version', type: 'text', max: 40 },
        { name: 'is_admin', type: 'bool' },
        { name: 'last_seen', type: 'date' },
        { name: 'environment', type: 'json', maxSize: 20000 },
        { name: 'capabilities', type: 'json', maxSize: 50000 },
        { name: 'config', type: 'json', maxSize: 20000 },
        { name: 'asset', type: 'relation', collectionId: assetsId, maxSelect: 1, cascadeDelete: false },
        { name: 'dropped', type: 'number', onlyInt: true, min: 0 },
        { name: 'registered_by', type: 'text', max: 200 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(sensors);
    const sensorsId = app.findCollectionByNameOrId('sensors').id;

    const assets = app.findCollectionByNameOrId('assets');
    const kind = assets.fields.getByName('kind');
    kind.values = ['domain', 'subdomain', 'ip', 'host'];
    app.save(assets);

    const sources = app.findCollectionByNameOrId('sources');
    sources.fields.add(new RelationField({ name: 'sensor', collectionId: sensorsId, maxSelect: 1, cascadeDelete: true }));
    app.save(sources);

    app.save(
      new Collection({
        type: 'base',
        name: 'signals',
        listRule: PEOPLE,
        viewRule: PEOPLE,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'asset', type: 'relation', required: true, collectionId: assetsId, maxSelect: 1, cascadeDelete: true },
          { name: 'sensor', type: 'relation', collectionId: sensorsId, maxSelect: 1, cascadeDelete: false },
          { name: 'kind', type: 'text', required: true, max: 60 },
          { name: 'key', type: 'text', max: 255 },
          { name: 'window_start', type: 'date', required: true },
          { name: 'count', type: 'number', onlyInt: true, min: 0 },
          { name: 'data', type: 'json', maxSize: 20000 },
        ],
        indexes: ['CREATE INDEX idx_signals_asset_kind_window ON signals (asset, kind, window_start)'],
      }),
    );

    // Narrow reads to people on every existing collection.
    for (const name of [
      'settings', 'audit_log', 'assets', 'sources', 'scan_runs', 'observations', 'changes', 'rules', 'baselines',
      'findings', 'suppressions', 'intel', 'indicators', 'incidents', 'incident_notes', 'notifiers', 'users',
    ]) {
      const c = app.findCollectionByNameOrId(name);
      c.listRule = PEOPLE;
      c.viewRule = PEOPLE;
      app.save(c);
    }
  },
  (app) => {
    const AUTHED = '@request.auth.id != ""';
    for (const name of [
      'settings', 'audit_log', 'assets', 'sources', 'scan_runs', 'observations', 'changes', 'rules', 'baselines',
      'findings', 'suppressions', 'intel', 'indicators', 'incidents', 'incident_notes', 'notifiers', 'users',
    ]) {
      const c = app.findCollectionByNameOrId(name);
      c.listRule = AUTHED;
      c.viewRule = AUTHED;
      app.save(c);
    }
    app.delete(app.findCollectionByNameOrId('signals'));
    const sources = app.findCollectionByNameOrId('sources');
    sources.fields.removeByName('sensor');
    app.save(sources);
    const assets = app.findCollectionByNameOrId('assets');
    assets.fields.getByName('kind').values = ['domain', 'subdomain', 'ip'];
    app.save(assets);
    app.delete(app.findCollectionByNameOrId('sensors'));
  },
);
