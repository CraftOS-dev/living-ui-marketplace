/// <reference path="../pb_data/types.d.ts" />
/**
 * Detections (docs/SYSTEM-V2-PLAN.md §20.4): activity — a new program, a new
 * autostart entry, a changed system file — is an event to review ("expected"
 * / "looks wrong"), not a setting that is wrong. It lives in the Activity
 * inbox, not in "Needs you". A machine's first days are learned quietly.
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    app.save(new Collection({
      type: 'base',
      name: 'detections',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'dedupe_key', type: 'text', required: true, max: 400 },
        { name: 'rule_id', type: 'text', required: true, max: 60 },
        { name: 'asset', type: 'relation', collectionId: app.findCollectionByNameOrId('assets').id, maxSelect: 1, cascadeDelete: true },
        { name: 'subject', type: 'text', max: 255 },
        { name: 'summary', type: 'text', max: 300 },
        { name: 'severity', type: 'text', max: 20 },
        { name: 'evidence', type: 'json', maxSize: 50000 },
        { name: 'verdict', type: 'select', required: true, maxSelect: 1, values: ['unreviewed', 'expected', 'suspicious', 'learned', 'known_good'] },
        { name: 'verdict_by', type: 'text', max: 200 },
        { name: 'count', type: 'number', onlyInt: true, min: 0 },
        { name: 'first_at', type: 'date' },
        { name: 'last_at', type: 'date' },
        { name: 'finding', type: 'relation', collectionId: app.findCollectionByNameOrId('findings').id, maxSelect: 1, cascadeDelete: false },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_detections_key ON detections (dedupe_key)', 'CREATE INDEX idx_detections_verdict ON detections (verdict)'],
    }));
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('detections'));
  },
);
