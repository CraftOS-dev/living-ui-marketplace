/// <reference path="../pb_data/types.d.ts" />
/**
 * Workspace: member roles, the single settings row, and the hash-chained
 * audit log. Domain collections are read-only over REST for signed-in users;
 * every write goes through an operation (see pb_hooks/ops.pb.js), which is
 * where role checks and auditing live.
 */
migrate(
  (app) => {
    const AUTHED = '@request.auth.id != ""';

    // users: add role; creation stays open at the rule level because the
    // first-admin / closed-signup policy is enforced in bootstrap.pb.js.
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(
      new SelectField({ name: 'role', values: ['admin', 'analyst', 'viewer'], maxSelect: 1 }),
    );
    users.listRule = AUTHED;
    users.viewRule = AUTHED;
    users.createRule = '';
    users.updateRule = 'id = @request.auth.id';
    users.deleteRule = null;
    app.save(users);

    const settings = new Collection({
      type: 'base',
      name: 'settings',
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'workspace_name', type: 'text', required: true, max: 80 },
        { name: 'signup_open', type: 'bool' },
        { name: 'retention_days', type: 'number', onlyInt: true, min: 7, max: 3650 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(settings);

    const row = new Record(settings);
    row.set('workspace_name', 'NetSentry');
    row.set('signup_open', false);
    row.set('retention_days', 90);
    app.save(row);

    const audit = new Collection({
      type: 'base',
      name: 'audit_log',
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'seq', type: 'number', required: true, onlyInt: true, min: 1 },
        { name: 'actor_type', type: 'select', required: true, values: ['user', 'agent', 'system'], maxSelect: 1 },
        { name: 'actor_label', type: 'text', max: 200 },
        { name: 'action', type: 'text', required: true, max: 80 },
        { name: 'target_collection', type: 'text', max: 60 },
        { name: 'target_id', type: 'text', max: 60 },
        { name: 'summary', type: 'text', max: 500 },
        { name: 'detail', type: 'json', maxSize: 20000 },
        // ISO string, not a date field: the hash covers the exact stored text,
        // and PocketBase reformats date values on save.
        { name: 'at', type: 'text', required: true, max: 30 },
        { name: 'prev_hash', type: 'text', max: 64 },
        { name: 'hash', type: 'text', required: true, max: 64 },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_audit_seq ON audit_log (seq)'],
    });
    app.save(audit);
  },
  (app) => {
    for (const name of ['audit_log', 'settings']) {
      app.delete(app.findCollectionByNameOrId(name));
    }
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('role');
    app.save(users);
  },
);
