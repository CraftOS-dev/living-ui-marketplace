/// <reference path="../pb_data/types.d.ts" />
/**
 * Record guards and the clock.
 *
 * Every collection changes only through the operations (they keep versions,
 * leases, the activity log and the agent's queue in step), so direct API
 * writes are refused with the operation to use. Hook code writes through its
 * own app handle and is not affected.
 */

const KB_COLLECTIONS = ['settings', 'boards', 'columns', 'labels', 'cards', 'events', 'runs', 'rules'];

onRecordCreateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...KB_COLLECTIONS);
onRecordUpdateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...KB_COLLECTIONS);
onRecordDeleteRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...KB_COLLECTIONS);

// Every minute: leases that ran out go back to the queue (or to you), and
// the agent is asked again about work still waiting.
cronAdd('kb_work', '* * * * *', () => {
  try {
    const W = require(`${__hooks}/lib_work.js`);
    W.expire($app);
    W.fireIfNeeded($app);
  } catch (err) {
    console.error('[kanban-board] work clock failed:', err);
  }
});

// Hourly: idle and due-soon rules.
cronAdd('kb_rules', '7 * * * *', () => {
  try {
    require(`${__hooks}/lib_auto.js`).sweep($app);
  } catch (err) {
    console.error('[kanban-board] rule sweep failed:', err);
  }
});

// Nightly: the activity log keeps a year.
cronAdd('kb_prune', '23 3 * * *', () => {
  try {
    const cut = new Date(Date.now() - 365 * 86400000).toISOString().replace('T', ' ');
    $app.db().newQuery('DELETE FROM events WHERE created < {:t}').bind({ t: cut }).execute();
  } catch (err) {
    console.error('[kanban-board] prune failed:', err);
  }
});
