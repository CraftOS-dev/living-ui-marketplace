/// <reference path="../pb_data/types.d.ts" />
/**
 * Structured facts on approvals and notifications: the days, amounts and
 * states a screen formats itself (the entity's date style, the currency's
 * digits) instead of reading them out of a pre-written summary. The plain
 * `summary` / `title` stays for the CLI.
 *
 *   facts: [{ type: 'day', value }, { type: 'range', from, to },
 *           { type: 'money', amount_minor, currency }, { type: 'state', value },
 *           { type: 'number', value, unit }, { type: 'text', value }]
 *   (each may carry `key` and `label`)
 */
migrate(
  (app) => {
    for (const name of ['approvals', 'notifications']) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.add(new JSONField({ name: 'facts', maxSize: 20000 }));
      app.save(c);
    }
  },
  (app) => {
    for (const name of ['approvals', 'notifications']) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.removeByName('facts');
      app.save(c);
    }
  },
);
