/// <reference path="../pb_data/types.d.ts" />
/**
 * v3 M3 — safe updates (docs/SYSTEM-V3-PLAN.md §10).
 *
 * `image_intel`: what each image's registry says (newer tags, the digest a
 *   floating tag like "latest" points at now), checked every 6 hours.
 * `apps.update`: the update waiting for an app, with its risk — written only
 *   when it changes, so every page can show it without asking.
 * `apps.update_policy`: tell me (default) · update small ones in my window ·
 *   pinned (never). A person's standing confirmation, per app (V3-D3).
 * `maintenance_windows`: when NetSentry may apply what a policy allows —
 *   weekly, in the console's own time (offset stored with it).
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    app.save(new Collection({
      type: 'base',
      name: 'image_intel',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'registry', type: 'text', required: true, max: 120 },
        { name: 'repo', type: 'text', required: true, max: 200 },
        { name: 'tag', type: 'text', required: true, max: 128 },
        { name: 'digest', type: 'text', max: 100 },
        { name: 'newer_patch_minor', type: 'text', max: 128 },
        { name: 'newer_major', type: 'text', max: 128 },
        { name: 'checked_at', type: 'date' },
        { name: 'error', type: 'text', max: 300 },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_image_intel_ref ON image_intel (registry, repo, tag)'],
    }));
    const apps = app.findCollectionByNameOrId('apps');
    apps.fields.add(new JSONField({ name: 'update', maxSize: 4000 }));
    apps.fields.add(new SelectField({ name: 'update_policy', maxSelect: 1, values: ['notify', 'auto', 'pinned'] }));
    app.save(apps);
    const assets = app.findCollectionByNameOrId('assets');
    app.save(new Collection({
      type: 'base',
      name: 'maintenance_windows',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'name', type: 'text', required: true, max: 80 },
        // empty = every machine
        { name: 'assets', type: 'relation', collectionId: assets.id, maxSelect: 500, cascadeDelete: false },
        // 0 = Sunday … 6 = Saturday, in the console's time (utc_offset_minutes)
        { name: 'weekdays', type: 'json', maxSize: 100 },
        { name: 'start_minute', type: 'number', onlyInt: true, min: 0, max: 1439 },
        { name: 'duration_minutes', type: 'number', onlyInt: true, min: 15, max: 720 },
        { name: 'utc_offset_minutes', type: 'number', onlyInt: true, min: -840, max: 840 },
        { name: 'enabled', type: 'bool' },
        { name: 'last_run', type: 'date' },
        { name: 'created_by', type: 'text', max: 200 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    }));
  },
  (app) => {
    for (const n of ['image_intel', 'maintenance_windows']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* gone */
      }
    }
    const apps = app.findCollectionByNameOrId('apps');
    apps.fields.removeByName('update');
    apps.fields.removeByName('update_policy');
    app.save(apps);
  },
);
