/// <reference path="../pb_data/types.d.ts" />
/**
 * v2 P4 — keyless enrolment (plan §18.4, D11): the IAM roles whose EC2
 * instances may enrol a monitor by proving their identity to AWS (no key, no
 * token). Empty = nobody can enrol that way.
 */
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    c.fields.add(new JSONField({ name: 'cloud_enrol_roles', maxSize: 10000 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId('settings');
    c.fields.removeByName('cloud_enrol_roles');
    app.save(c);
  },
);
