/// <reference path="../pb_data/types.d.ts" />
/**
 * v3 M1 — is it running well? (docs/SYSTEM-V3-PLAN.md §7)
 *
 * `metrics`: CPU, memory, load, temperature of each machine ('machine') and
 * each container (its name), one row per subject per minute. Kept at minute
 * detail for 2 days, then 15-minute averages for 14 days, then hourly ones
 * for 90 days (services/metrics.js rollup). `v` holds the numbers; a rolled-up
 * row also holds the peak (`cpu_max`, `mem_max`) so a short spike survives.
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    const assets = app.findCollectionByNameOrId('assets');
    app.save(new Collection({
      type: 'base',
      name: 'metrics',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'asset', type: 'relation', required: true, collectionId: assets.id, maxSelect: 1, cascadeDelete: true },
        { name: 'subject', type: 'text', required: true, max: 200 },
        { name: 'tier', type: 'select', required: true, maxSelect: 1, values: ['1m', '15m', '1h'] },
        { name: 't', type: 'date', required: true },
        { name: 'v', type: 'json', maxSize: 4000 },
      ],
      indexes: [
        'CREATE INDEX idx_metrics_subject ON metrics (asset, tier, subject, t)',
        'CREATE INDEX idx_metrics_tier_t ON metrics (tier, t)',
      ],
    }));
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('metrics'));
    } catch {
      /* already gone */
    }
  },
);
