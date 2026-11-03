/// <reference path="../pb_data/types.d.ts" />
/**
 * Record guards and the clock.
 *
 * App collections change only through the operations (they keep progress,
 * sessions, plans, the voice record and the coach's queue in step), so
 * direct API writes are refused with the operation to use. Hook code writes
 * through its own app handle and is not affected.
 */

const SC_COLLECTIONS = ['settings', 'voice', 'songs', 'progress', 'runs', 'tracks', 'sessions', 'checkins', 'messages', 'plans', 'lessons', 'skills', 'drills'];

onRecordCreateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...SC_COLLECTIONS);
onRecordUpdateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...SC_COLLECTIONS);
onRecordDeleteRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...SC_COLLECTIONS);

// Every minute: the starter library on a fresh install, quiet sessions
// closed, and the coach asked to review the ones worth reviewing.
cronAdd('sc_tick', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_model.js`).ensureSeeded($app);
    require(`${__hooks}/lib_runs.js`).tick($app);
  } catch (err) {
    console.error('[singing-coach] clock failed:', err);
  }
});
