/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot, transfer (caching, compression), live-update marks, write guards and
 * the minute tick.
 *
 * - The SQL echo of PocketBase's dev mode is switched off at boot.
 * - Every saved or deleted record marks its collection as changed; the
 *   dispatcher (and the tick) then tells open screens (lib_bus.js).
 * - Every collection changes only through the app's operations. Direct API
 *   writes, even a superuser's (`agent-app data`), are refused.
 * - The tick (every minute, local time read inside): the day job once per
 *   person-day, due routines, the calendar mirror, the weather kept warm.
 *   It also runs once at boot, so a day that started while the app was
 *   closed is caught up and routines more than two hours late are missed.
 */

onBootstrap((e) => {
  e.next();
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[lo] could not quiet ' + name + ': ' + err);
    }
  }
  try {
    if ($app.hasTable('settings')) {
      require(`${__hooks}/lib_routines.js`).tick($app);
      require(`${__hooks}/lib_bus.js`).flush($app);
    }
  } catch (err) {
    console.error('[lo] boot catch-up failed:', err);
  }
});

// Built files under /assets/ carry a content hash in their names: cached for
// a year. They and operation answers go gzip-compressed (not photos).
routerUse((e) => {
  const path = String((e.request.url && e.request.url.path) || '');
  const asset = path.indexOf('/assets/') === 0;
  if (asset) e.response.header().set('Cache-Control', 'public, max-age=31536000, immutable');
  if (asset || (path.indexOf('/api/ops/') === 0 && path !== '/api/ops/journal/photo')) return $apis.gzip().func(e);
  return e.next();
});

// Every write marks its collection changed (for open screens) and bumps the
// version that keeps memoized lookups honest (lib_core.memo).
onRecordCreate((e) => {
  e.app.store().set('lo_d_' + e.record.collection().name, true);
  e.app.store().set('lo_v', (e.app.store().get('lo_v') || 0) + 1);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('lo_d_' + e.record.collection().name, true);
  e.app.store().set('lo_v', (e.app.store().get('lo_v') || 0) + 1);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('lo_d_' + e.record.collection().name, true);
  e.app.store().set('lo_v', (e.app.store().get('lo_v') || 0) + 1);
  e.next();
});

// A deleted record takes its waiting proposals and open suggestions with it.
onRecordDelete(
  (e) => {
    try {
      e.app.db().newQuery("UPDATE proposals SET status = 'stale' WHERE status = 'waiting' AND target_id = {:id}").bind({ id: e.record.id }).execute();
      e.app.db().newQuery("UPDATE suggestions SET status = 'stale' WHERE status = 'open' AND target_id = {:id}").bind({ id: e.record.id }).execute();
    } catch (err) {
      console.error('[lo] proposal cleanup failed:', err);
    }
    e.next();
  },
  'goals',
  'habits',
  'tasks',
  'projects',
);

onRecordCreateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they keep progress, pace and the activity trail in step). Run app.guide to see them.');
  },
  'settings', 'areas', 'money_pots', 'goals', 'goal_checkins', 'people', 'interactions', 'events', 'projects', 'tasks', 'focus_sessions',
  'wins', 'habits', 'habit_logs', 'days', 'health_logs', 'workouts', 'money_entries', 'bills', 'books', 'learning', 'bucket_items',
  'trips', 'chores', 'shopping_items', 'journal_entries', 'recaps', 'routines', 'routine_runs', 'suggestions', 'proposals', 'asks', 'activity',
  'calendar_events', 'users',
);

onRecordUpdateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they keep progress, pace and the activity trail in step). Run app.guide to see them.');
  },
  'settings', 'areas', 'money_pots', 'goals', 'goal_checkins', 'people', 'interactions', 'events', 'projects', 'tasks', 'focus_sessions',
  'wins', 'habits', 'habit_logs', 'days', 'health_logs', 'workouts', 'money_entries', 'bills', 'books', 'learning', 'bucket_items',
  'trips', 'chores', 'shopping_items', 'journal_entries', 'recaps', 'routines', 'routine_runs', 'suggestions', 'proposals', 'asks', 'activity',
  'calendar_events', 'users',
);

onRecordDeleteRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
  },
  'settings', 'areas', 'money_pots', 'goals', 'goal_checkins', 'people', 'interactions', 'events', 'projects', 'tasks', 'focus_sessions',
  'wins', 'habits', 'habit_logs', 'days', 'health_logs', 'workouts', 'money_entries', 'bills', 'books', 'learning', 'bucket_items',
  'trips', 'chores', 'shopping_items', 'journal_entries', 'recaps', 'routines', 'routine_runs', 'suggestions', 'proposals', 'asks', 'activity',
  'calendar_events', 'users',
);

// The minute tick: the day job, routines, the calendar and the weather.
// PocketBase's cron runs in UTC, so the local times are read inside.
cronAdd('lo_tick', '* * * * *', () => {
  if ($app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_routines.js`).tick($app);
  } catch (err) {
    console.error('[lo] tick failed:', err);
  }
  try {
    require(`${__hooks}/lib_bus.js`).flush($app);
  } catch (err) {
    console.error('[lo] live update failed:', err);
  }
});
