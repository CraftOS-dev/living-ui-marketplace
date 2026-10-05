/// <reference path="../pb_data/types.d.ts" />
/**
 * v3 M4 — backups NetSentry takes, restores and tests (docs/SYSTEM-V3-PLAN.md §11).
 *
 * backup_plans gains the method "netsentry": the machine's monitor copies the
 * app's settings and database to a folder on that machine (another disk, a NAS
 * share), keeps 7 daily / 4 weekly / 6 monthly copies, and tests a restore
 * every month. `backups_taken` lists each copy (never its contents).
 * Restoring is its own kind of change ("restore"): an admin confirms it.
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    const plans = app.findCollectionByNameOrId('backup_plans');
    const method = plans.fields.getByName('method');
    method.values = ['heartbeat', 'declared', 'detected', 'netsentry'];
    plans.fields.add(new NumberField({ name: 'keep_daily', onlyInt: true, min: 1, max: 60 }));
    plans.fields.add(new NumberField({ name: 'keep_weekly', onlyInt: true, min: 0, max: 52 }));
    plans.fields.add(new NumberField({ name: 'keep_monthly', onlyInt: true, min: 0, max: 36 }));
    plans.fields.add(new NumberField({ name: 'test_every_days', onlyInt: true, min: 7, max: 180 }));
    plans.fields.add(new DateField({ name: 'last_test' }));
    plans.fields.add(new TextField({ name: 'last_test_result', max: 300 }));
    app.save(plans);

    const rem = app.findCollectionByNameOrId('remediations');
    const purpose = rem.fields.getByName('purpose');
    purpose.values = ['fix', 'operate', 'update', 'backup', 'restore', 'install', 'os'];
    app.save(rem);

    const assets = app.findCollectionByNameOrId('assets');
    const apps = app.findCollectionByNameOrId('apps');
    app.save(new Collection({
      type: 'base',
      name: 'backups_taken',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'plan', type: 'relation', collectionId: plans.id, maxSelect: 1, cascadeDelete: true },
        { name: 'app', type: 'relation', collectionId: apps.id, maxSelect: 1, cascadeDelete: false },
        { name: 'asset', type: 'relation', collectionId: assets.id, maxSelect: 1, cascadeDelete: true },
        { name: 'archive', type: 'text', required: true, max: 200 },
        { name: 'size_bytes', type: 'number', onlyInt: true, min: 0 },
        { name: 'sha256', type: 'text', max: 64 },
        { name: 'taken_at', type: 'date' },
        { name: 'contents', type: 'text', max: 300 },
        { name: 'removed', type: 'bool' },
        { name: 'tested_at', type: 'date' },
        { name: 'test_result', type: 'text', max: 300 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: ['CREATE INDEX idx_backups_taken_app ON backups_taken (app, taken_at)'],
    }));
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('backups_taken'));
    } catch {
      /* gone */
    }
    const plans = app.findCollectionByNameOrId('backup_plans');
    for (const f of ['keep_daily', 'keep_weekly', 'keep_monthly', 'test_every_days', 'last_test', 'last_test_result']) plans.fields.removeByName(f);
    plans.fields.getByName('method').values = ['heartbeat', 'declared', 'detected'];
    app.save(plans);
  },
);
