/// <reference path="../pb_data/types.d.ts" />
/**
 * v3 M2 — one pipeline for every change NetSentry makes (docs/SYSTEM-V3-PLAN.md §8.1).
 *
 * A fix for an issue, restarting an app, an update, a backup or an install
 * all travel the same road: a plan of typed actions, a person's confirmation
 * bound to the plan's hash, the machine's own monitor applying it (only where
 * someone switched that on at the machine), proof, undo, audit. `purpose`
 * says which kind it is; `app` links it to the app it was for (optional).
 * The collection keeps its v1 name; people see these as "changes".
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('remediations');
    c.fields.add(new SelectField({ name: 'purpose', maxSelect: 1, values: ['fix', 'operate', 'update', 'backup', 'install', 'os'] }));
    const apps = app.findCollectionByNameOrId('apps');
    c.fields.add(new RelationField({ name: 'app', collectionId: apps.id, maxSelect: 1, cascadeDelete: false }));
    c.addIndex('idx_remediations_asset_purpose', false, 'asset, purpose, status', '');
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('remediations');
    c.removeIndex('idx_remediations_asset_purpose');
    c.fields.removeByName('purpose');
    c.fields.removeByName('app');
    app.save(c);
  },
);
