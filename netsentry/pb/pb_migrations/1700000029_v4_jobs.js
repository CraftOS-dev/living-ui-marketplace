/// <reference path="../pb_data/types.d.ts" />
/**
 * v4 N2–N4 (docs/SYSTEM-V4-PLAN.md §7, §6, §15): the everyday and server jobs, and the terminal.
 *
 *  - remediations.purpose gains the new kinds of change (files … command); a command's output and
 *    reason can be longer than one line.
 *  - file_transfers: a file on its way to or from the server (≤ 20 MB), deleted after use (N-B11).
 *  - terminal_sessions: who opened a terminal, when, why it closed, and its masked transcript (90 days).
 *  - terminal_io: the live output of an open session, followed by the admin who opened it only;
 *    deleted when the session ends (N-B20).
 */
migrate(
  (app) => {
    const rem = app.findCollectionByNameOrId('remediations');
    rem.fields.getByName('purpose').values = ['fix', 'operate', 'update', 'backup', 'restore', 'install', 'os',
      'files', 'settings', 'remove', 'cleanup', 'process', 'firewall', 'keys', 'schedule', 'remote', 'command'];
    rem.fields.getByName('failure_reason').max = 5000;
    app.save(rem);

    const ADMINS = '@request.auth.collectionName = "users" && @request.auth.role = "admin"';
    const MONITOR = '@request.auth.collectionName = "sensors" && @request.auth.status != "revoked" && asset = @request.auth.asset';
    const users = app.findCollectionByNameOrId('users');
    const assets = app.findCollectionByNameOrId('assets');

    app.save(new Collection({
      type: 'base',
      name: 'file_transfers',
      // The admin it is for, and the monitor of its server (which fetches uploads and sends downloads).
      listRule: `(${ADMINS} && created_by = @request.auth.id) || (${MONITOR})`,
      viewRule: `(${ADMINS} && created_by = @request.auth.id) || (${MONITOR})`,
      // An admin uploads a file here first (the change that saves it on the server names it);
      // the monitor sends a file a person asked to download.
      createRule: `(${ADMINS} && direction = "up" && created_by = @request.auth.id) || (${MONITOR} && direction = "down")`,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'asset', type: 'relation', collectionId: assets.id, maxSelect: 1, cascadeDelete: true },
        { name: 'direction', type: 'select', required: true, maxSelect: 1, values: ['up', 'down'] },
        { name: 'name', type: 'text', required: true, max: 255 },
        { name: 'size', type: 'number', onlyInt: true, min: 0 },
        { name: 'sha256', type: 'text', max: 64 },
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 21000000, protected: true },
        { name: 'created_by', type: 'text', required: true, max: 40 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      ],
      indexes: ['CREATE INDEX idx_file_transfers_created ON file_transfers (created)'],
    }));

    const sessions = new Collection({
      type: 'base',
      name: 'terminal_sessions',
      listRule: ADMINS,
      viewRule: ADMINS,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true },
        { name: 'user_email', type: 'text', max: 200 },
        { name: 'asset', type: 'relation', collectionId: assets.id, maxSelect: 1, cascadeDelete: true },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['requested', 'running', 'closed'] },
        { name: 'start_by', type: 'date' },
        { name: 'started_at', type: 'date' },
        { name: 'ended_at', type: 'date' },
        { name: 'reason', type: 'text', max: 200 },
        { name: 'run_as', type: 'text', max: 100 },
        { name: 'cols', type: 'number', onlyInt: true, min: 0 },
        { name: 'rows', type: 'number', onlyInt: true, min: 0 },
        { name: 'transcript', type: 'text', max: 2000000 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_terminal_sessions_status ON terminal_sessions (status, created)'],
    });
    app.save(sessions);

    app.save(new Collection({
      type: 'base',
      name: 'terminal_io',
      // Only the admin who opened the session follows its live output.
      listRule: '@request.auth.collectionName = "users" && session.user = @request.auth.id',
      viewRule: '@request.auth.collectionName = "users" && session.user = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'session', type: 'relation', collectionId: sessions.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: 'seq', type: 'number', onlyInt: true, min: 0 },
        { name: 'data', type: 'text', max: 100000 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      ],
      indexes: ['CREATE INDEX idx_terminal_io_session ON terminal_io (session, seq)'],
    }));
  },
  (app) => {
    for (const name of ['terminal_io', 'terminal_sessions', 'file_transfers']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
