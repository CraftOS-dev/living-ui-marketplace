/// <reference path="../pb_data/types.d.ts" />
/**
 * Sensors act (connect, report) — record them as their own actor type in the
 * audit log and incident timelines.
 */
migrate(
  (app) => {
    for (const name of ['audit_log', 'incident_notes']) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.getByName('actor_type').values = ['user', 'agent', 'system', 'sensor'];
      app.save(c);
    }
  },
  (app) => {
    for (const name of ['audit_log', 'incident_notes']) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.getByName('actor_type').values = ['user', 'agent', 'system'];
      app.save(c);
    }
  },
);
