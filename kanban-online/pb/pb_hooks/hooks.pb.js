/// <reference path="../pb_data/types.d.ts" />
/**
 * Record guards, sign-up and the clock.
 *
 * Every board collection changes only through the operations (they keep
 * versions, leases, the activity log and the agents' queues in step), so
 * direct API writes are refused with the operation to use. Hook code writes
 * through its own app handle and is not affected.
 *
 * Accounts: the sign-in page creates users directly. The first account runs
 * the workspace (admin); later ones join as members, let in at once or
 * after an admin approves them. Nobody sets their own role or status.
 */

const KB_COLLECTIONS = ['settings', 'agents', 'boards', 'columns', 'labels', 'cards', 'events', 'runs', 'rules'];

onRecordCreateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...KB_COLLECTIONS);
onRecordUpdateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...KB_COLLECTIONS);
onRecordDeleteRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...KB_COLLECTIONS);

onRecordCreateRequest((e) => {
  require(`${__hooks}/lib_team.js`).onSignup(e);
  e.next();
}, 'users');
onRecordAfterCreateSuccess((e) => {
  try {
    require(`${__hooks}/lib_team.js`).onJoined(e);
  } catch (err) {
    console.error('[kanban-online] join log failed:', err);
  }
  e.next();
}, 'users');
onRecordUpdateRequest((e) => {
  require(`${__hooks}/lib_team.js`).onSelfUpdate(e);
  e.next();
}, 'users');

// Every minute: leases that ran out go back to the queue (or to a person),
// and CraftBot is asked again about work still waiting.
cronAdd('kb_work', '* * * * *', () => {
  try {
    const W = require(`${__hooks}/lib_work.js`);
    W.expire($app);
    W.fireIfNeeded($app);
  } catch (err) {
    console.error('[kanban-online] work clock failed:', err);
  }
});

// Hourly: idle and due-soon rules.
cronAdd('kb_rules', '7 * * * *', () => {
  try {
    require(`${__hooks}/lib_auto.js`).sweep($app);
  } catch (err) {
    console.error('[kanban-online] rule sweep failed:', err);
  }
});

// Nightly: the activity log keeps a year.
cronAdd('kb_prune', '23 3 * * *', () => {
  try {
    const cut = new Date(Date.now() - 365 * 86400000).toISOString().replace('T', ' ');
    $app.db().newQuery('DELETE FROM events WHERE created < {:t}').bind({ t: cut }).execute();
  } catch (err) {
    console.error('[kanban-online] prune failed:', err);
  }
});
