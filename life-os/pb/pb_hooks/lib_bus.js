/// <reference path="../pb_data/types.d.ts" />
/**
 * Live updates without exposing data.
 *
 * Every collection is closed to the raw API, so screens cannot subscribe to
 * records. Instead a record hook marks the collection as changed (in memory)
 * and, when an operation or job finishes, flush() sends ONE message on the
 * custom realtime topic "lo" listing the collections that changed. Screens
 * reload the views that read those collections through operations. The
 * message carries names only.
 */

const COLLECTIONS = [
  'settings', 'areas', 'money_pots', 'goals', 'goal_checkins', 'people', 'interactions', 'events', 'projects', 'tasks', 'focus_sessions',
  'wins', 'habits', 'habit_logs', 'days', 'health_logs', 'workouts', 'money_entries', 'bills', 'books', 'learning', 'bucket_items',
  'trips', 'chores', 'shopping_items', 'journal_entries', 'recaps', 'routines', 'routine_runs', 'suggestions', 'proposals', 'asks', 'activity',
  'calendar_events',
];

const PREFIX = 'lo_d_';

function mark(app, name) {
  app.store().set(PREFIX + name, true);
}

/** Send one "lo" message naming every collection changed since the last flush. */
function flush(app) {
  const store = app.store();
  const changed = [];
  for (const c of COLLECTIONS) {
    if (store.get(PREFIX + c) === true) {
      store.remove(PREFIX + c);
      changed.push(c);
    }
  }
  if (changed.length === 0) return;
  try {
    const msg = new SubscriptionMessage({ name: 'lo', data: JSON.stringify({ c: changed }) });
    const clients = app.subscriptionsBroker().clients();
    for (const id in clients) {
      try {
        if (clients[id].hasSubscription('lo')) clients[id].send(msg);
      } catch {
        /* a client that just left */
      }
    }
  } catch (err) {
    console.error('[lo] realtime flush failed:', err);
  }
}

module.exports = { COLLECTIONS: COLLECTIONS, mark: mark, flush: flush };
