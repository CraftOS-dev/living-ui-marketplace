/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot, live-update marks, write guards and background jobs.
 *
 * - At boot the app keeps a handle for the cron jobs (a pooled VM can hold a
 *   committed transaction as $app), quiets the SQL echo, and puts answers a
 *   restart left half-reviewed back in the queue.
 * - Every saved or deleted record marks its collection as changed; the
 *   dispatcher then tells open screens (lib_bus.js).
 * - The collections change only through the app's operations. Direct API
 *   writes, even a superuser's (`agent-app data`), are refused.
 * - Jobs: the reviewer runs every minute for 55 seconds, waking on an
 *   in-memory flag when an answer is saved; messages that arrived while your
 *   AI agent was being asked are sent on once it is free.
 * - On the first request after a start and every hour, an application
 *   nobody has touched moves to the next YC batch (lib_batches.js), so a new
 *   install never starts on a batch whose deadline has passed.
 */

onBootstrap((e) => {
  e.next();
  e.app.store().set('yc_app', e.app);
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[yc] could not quiet ' + name + ': ' + err);
    }
  }
  try {
    if ($app.hasTable('answers')) $app.db().newQuery("UPDATE answers SET judge_state = 'queued' WHERE judge_state = 'running'").execute();
    if ($app.hasTable('settings')) $app.db().newQuery("UPDATE settings SET review_state = 'none', review_hash = '' WHERE review_state = 'running'").execute();
    $app.store().set('yc_judge_wake', true);
  } catch (err) {
    console.log('[yc] could not requeue reviews: ' + err);
  }
});

// On the first request after a start: the migrations have run by then (on a
// first start onBootstrap comes before them), and the first screen already
// shows the right batch.
routerUse((e) => {
  const store = e.app.store();
  if (store.get('yc_batch_checked') !== true) {
    store.set('yc_batch_checked', true);
    try {
      require(`${__hooks}/lib_batches.js`).ensure(e.app);
    } catch (err) {
      console.log('[yc] could not set the batch: ' + err);
    }
  }
  return e.next();
});

// Built files under /assets/ carry a content hash in their names.
routerUse((e) => {
  const path = String((e.request.url && e.request.url.path) || '');
  if (path.indexOf('/assets/') === 0) e.response.header().set('Cache-Control', 'public, max-age=31536000, immutable');
  return e.next();
});

onRecordCreate((e) => {
  e.app.store().set('yc_d_' + e.record.collection().name, true);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('yc_d_' + e.record.collection().name, true);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('yc_d_' + e.record.collection().name, true);
  e.next();
});

onRecordCreateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they keep the checks and the review in step). Run app.guide to see them.');
  },
  'settings',
  'founders',
  'answers',
  'sources',
  'messages',
  'activity',
);

onRecordUpdateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
  },
  'settings',
  'founders',
  'answers',
  'sources',
  'messages',
  'activity',
);

onRecordDeleteRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
  },
  'settings',
  'founders',
  'answers',
  'sources',
  'messages',
  'activity',
);

cronAdd('yc_review', '* * * * *', () => {
  const app = $app.store().get('yc_app') || $app;
  try {
    require(`${__hooks}/lib_judge.js`).work(app, 55000);
  } catch (err) {
    console.error('[yc] reviewer failed:', err);
  }
});

cronAdd('yc_batch', '17 * * * *', () => {
  const app = $app.store().get('yc_app') || $app;
  try {
    if (require(`${__hooks}/lib_batches.js`).ensure(app)) require(`${__hooks}/lib_bus.js`).flush(app);
  } catch (err) {
    console.error('[yc] batch check failed:', err);
  }
});

cronAdd('yc_messages', '* * * * *', () => {
  const app = $app.store().get('yc_app') || $app;
  try {
    require(`${__hooks}/lib_agent.js`).refire(app);
    require(`${__hooks}/lib_bus.js`).flush(app);
  } catch (err) {
    console.error('[yc] message relay failed:', err);
  }
});
