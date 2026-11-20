/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot, live-update marks, write guards and the one minute job.
 *
 * Boot: keep the app handle for cron (a pooled runtime can carry a finished
 * transaction as $app into a cron job), quiet the SQL echo, make the seal
 * key when missing, build the caches every runtime reads from the app store
 * (catalog, events, guide: their warm()), refresh the planner statistics,
 * run once the daily cron jobs that were due while the app was down
 * (catchUp). Nothing asks your AI agent at boot: triggers fire only from
 * the op where a person asks, or from a switch the firm turned on
 * (lib_agent.js).
 *
 * Every saved or deleted record marks its collection as changed; the
 * dispatcher (or the minute job) then tells open screens (lib_bus).
 * Collections change only through the app's operations: raw API writes,
 * even a superuser's, are refused (the platform's trigger queue is its own).
 *
 * Cron: one minute job runs every entry of every pb_hooks/cron_*.js whose
 * schedule matches this minute in the firm's zone (lib_events.runDue): the
 * kernel's (fires the platform refused on a cooldown, queued sends,
 * proposal expiry, rates, statistics) and every module's.
 */

onBootstrap((e) => {
  e.next();
  e.app.store().set('vo_app', e.app);
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[vo] could not quiet ' + name + ': ' + err);
    }
  }
  try {
    if (require(`${__hooks}/lib_seal.js`).ensureKey()) console.log('[vo] made a new seal key (.seal-key)');
  } catch (err) {
    console.error('[vo] seal key:', err);
  }
  const t0 = Date.now();
  for (const lib of ['lib_catalog', 'lib_events', 'lib_guide']) {
    try {
      require(`${__hooks}/${lib}.js`).warm(e.app);
    } catch (err) {
      console.error('[vo] boot cache ' + lib + ':', err);
    }
  }
  // Load every library and module registration once here, so a broken file
  // is named at boot (the pool's runtimes load them again: warm-up below).
  require(`${__hooks}/lib_util.js`).warmRuntime();
  const t1 = Date.now();
  if (!e.app.hasTable('settings')) return;
  // `pocketbase migrate up` boots the hooks too: background work (catch-up) runs only when serving.
  let serving = false;
  try {
    for (const a of $os.args) if (String(a) === 'serve') serving = true;
  } catch {
    serving = true;
  }
  if (!serving) return;
  try {
    require(`${__hooks}/lib_util.js`).exec(e.app, 'ANALYZE');
  } catch (err) {
    console.log('[vo] ANALYZE failed: ' + err);
  }
  try {
    const ran = require(`${__hooks}/lib_events.js`).catchUp(e.app);
    if (ran.length > 0) console.log('[vo] caught up ' + ran.map((r) => r.name).join(', '));
  } catch (err) {
    console.error('[vo] cron catch-up failed:', err);
  }
  try {
    const n = require(`${__hooks}/lib_next.js`).warm(e.app);
    if (n > 0) console.log('[vo] Next ready for ' + n + ' members');
  } catch (err) {
    console.error('[vo] Next warm-up failed:', err);
  }
  console.log('[vo] boot: caches ' + (t1 - t0) + ' ms, catch-up ' + (Date.now() - t1) + ' ms');
});

// No app-wide routerUse here: a JS middleware holds one of PocketBase's pooled
// runtimes for the whole request. Operation answers are gzip-compressed by the
// Go middleware on each generated route (tools/gen.mjs).

onRecordCreate((e) => {
  e.app.store().set('vo_d_' + e.record.collection().name, true);
  e.app.store().set('vo_d__any', true);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('vo_d_' + e.record.collection().name, true);
  e.app.store().set('vo_d__any', true);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('vo_d_' + e.record.collection().name, true);
  e.app.store().set('vo_d__any', true);
  e.next();
});

// The data version (lib_next's cache) moves after a change is committed, so a
// list read while a transaction was still open is never kept as current.
onRecordAfterCreateSuccess((e) => {
  e.app.store().set('vo_data_version', String(Date.now()) + '.' + e.record.id);
  e.next();
});

onRecordAfterUpdateSuccess((e) => {
  e.app.store().set('vo_data_version', String(Date.now()) + '.' + e.record.id);
  e.next();
});

onRecordAfterDeleteSuccess((e) => {
  e.app.store().set('vo_data_version', String(Date.now()) + '.' + e.record.id);
  e.next();
});

onRecordCreateRequest((e) => {
  if (e.record.collection().name === require(`${__hooks}/_triggers_lib.js`).TRIGGER_COLLECTION) return e.next();
  throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they check rights, keep history and write the audit trail). Run app.guide to see them.');
});

onRecordUpdateRequest((e) => {
  if (e.record.collection().name === require(`${__hooks}/_triggers_lib.js`).TRIGGER_COLLECTION) return e.next();
  throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
});

onRecordDeleteRequest((e) => {
  if (e.record.collection().name === require(`${__hooks}/_triggers_lib.js`).TRIGGER_COLLECTION) return e.next();
  throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
});

onRecordsListRequest(
  (e) => {
    throw new ForbiddenError('This collection is not readable.');
  },
  'pin_vault',
);

onRecordViewRequest(
  (e) => {
    throw new ForbiddenError('This collection is not readable.');
  },
  'pin_vault',
);

cronAdd('vo_minute', '* * * * *', () => {
  const app = $app.store().get('vo_app') || $app;
  if (app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_events.js`).runDue(app, Date.now());
  } catch (err) {
    console.error('[vo] cron failed:', err);
  }
  require(`${__hooks}/lib_bus.js`).flush(app);
});
