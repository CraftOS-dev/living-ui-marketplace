/// <reference path="../pb_data/types.d.ts" />
/**
 * v2 P3 — rollout (plan §4.2 S5, §10.2 step 9): a join token lets many new
 * monitors enrol themselves (Ansible, cloud-init, a copied command) instead of
 * one hand-made token per machine. It only creates monitors: each one swaps it
 * for its own credential on first start. Time-limited, capped, revocable; the
 * secret is stored as a SHA-256 hash only.
 */
migrate(
  (app) => {
    const PEOPLE = '@request.auth.collectionName = "users"';
    app.save(new Collection({
      type: 'base',
      name: 'join_tokens',
      listRule: PEOPLE,
      viewRule: PEOPLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'label', type: 'text', required: true, max: 120 },
        { name: 'token_hash', type: 'text', required: true, max: 128, hidden: true },
        { name: 'expires_at', type: 'date', required: true },
        { name: 'max_uses', type: 'number', onlyInt: true, min: 1, max: 1000 },
        { name: 'uses', type: 'number', onlyInt: true, min: 0 },
        { name: 'revoked', type: 'bool' },
        { name: 'created_by', type: 'text', max: 200 },
        { name: 'last_used', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_join_tokens_hash ON join_tokens (token_hash)'],
    }));
    const sensors = app.findCollectionByNameOrId('sensors');
    sensors.fields.add(new TextField({ name: 'joined_with', max: 300 }));
    app.save(sensors);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('join_tokens'));
    } catch (_) {
      /* gone */
    }
  },
);
