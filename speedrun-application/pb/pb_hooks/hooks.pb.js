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
 * - Jobs: the reviewer runs every minute for 55 seconds, processing only
 *   explicitly requested review snapshots; messages that arrived while your
 *   AI agent was being asked are sent on once it is free.
 * - On the first request after a start and every hour, an application
 *   nobody has touched moves to the next speedrun cohort (lib_cohorts.js),
 *   so a new install never starts on a cohort whose deadline has passed.
 */

onBootstrap((e) => {
  e.next();
  e.app.store().set('sr_app', e.app);
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[speedrun] could not quiet ' + name + ': ' + err);
    }
  }
  try {
    if (!e.app.hasTable('settings') || !e.app.hasTable('answers')) return;
    const U = require(`${__hooks}/lib_util.js`);
    const s = U.byId(e.app, 'settings', 'srsettings00001');
    if (s === null) return;
    const job = U.json(s, 'review_request', null);
    const active = job && (job.status === 'queued' || job.status === 'running');
    if (active) {
      e.app.db().newQuery("UPDATE answers SET judge_state = 'queued' WHERE judge_state = 'running'").execute();
      s.set('review_state', 'queued');
    } else {
      // Discard the legacy auto-review queue, not any saved review or user data.
      e.app.db().newQuery("UPDATE answers SET judge_state = CASE WHEN judged_hash != '' THEN 'done' ELSE 'none' END WHERE judge_state IN ('queued', 'running', 'offline')").execute();
      if (['queued', 'running', 'offline'].indexOf(s.getString('review_state')) >= 0) s.set('review_state', s.getString('review_at') ? 'done' : 'none');
    }
    e.app.save(s);
    e.app.store().set('sr_judge_wake', !!active);
  } catch (err) {
    console.log('[speedrun] could not requeue reviews: ' + err);
  }
});

// On the first request after a start: the migrations have run by then (on a
// first start onBootstrap comes before them), and the first screen already
// shows the right cohort.
routerUse((e) => {
  const store = e.app.store();
  if (store.get('sr_cohort_checked') !== true) {
    store.set('sr_cohort_checked', true);
    try {
      require(`${__hooks}/lib_cohorts.js`).ensure(e.app);
    } catch (err) {
      console.log('[speedrun] could not set the cohort: ' + err);
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
  e.app.store().set('sr_d_' + e.record.collection().name, true);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('sr_d_' + e.record.collection().name, true);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('sr_d_' + e.record.collection().name, true);
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

cronAdd('sr_review', '* * * * *', () => {
  const app = $app.store().get('sr_app') || $app;
  try {
    require(`${__hooks}/lib_judge.js`).work(app, 55000);
  } catch (err) {
    console.error('[speedrun] reviewer failed:', err);
  }
});

cronAdd('sr_cohort', '17 * * * *', () => {
  const app = $app.store().get('sr_app') || $app;
  try {
    if (require(`${__hooks}/lib_cohorts.js`).ensure(app)) require(`${__hooks}/lib_bus.js`).flush(app);
  } catch (err) {
    console.error('[speedrun] cohort check failed:', err);
  }
});

cronAdd('sr_messages', '* * * * *', () => {
  const app = $app.store().get('sr_app') || $app;
  try {
    require(`${__hooks}/lib_agent.js`).refire(app);
    require(`${__hooks}/lib_bus.js`).flush(app);
  } catch (err) {
    console.error('[speedrun] message relay failed:', err);
  }
});
