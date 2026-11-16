/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot, live-update marks, write guards and background jobs.
 *
 * Boot: keep the app handle for the jobs (a pooled runtime can carry a
 * finished transaction as $app into a cron job), quiet the SQL echo, make
 * the seal key when missing, build the caches every runtime reads from the
 * app store (catalog, events, guide, country and pack indexes: their
 * warm()), seed the built-in rule packs and the
 * new years of country holidays. Nothing asks your AI agent at boot.
 *
 * Every saved or deleted record marks its collection as changed; the
 * dispatcher then tells open screens (lib_bus). Collections change only
 * through the app's operations: raw API writes, even a superuser's, are
 * refused (the platform's trigger queue is its own).
 *
 * Jobs: one minute job runs the kernel's work (asks of your AI agent the
 * cooldown held back, sent once: lib_agent.sendDeferred; queued
 * notification emails) and every module cron job of pb_hooks/cron_*.js
 * whose schedule matches (lib_events.runDue); hourly the employment
 * statuses; nightly the proposal expiry; every six hours the rates.
 */

onBootstrap((e) => {
  e.next();
  e.app.store().set('hr_app', e.app);
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[hr] could not quiet ' + name + ': ' + err);
    }
  }
  try {
    if (require(`${__hooks}/lib_seal.js`).ensureKey()) console.log('[hr] made a new seal key (.seal-key)');
  } catch (err) {
    console.error('[hr] seal key:', err);
  }
  const t0 = Date.now();
  for (const lib of ['lib_catalog', 'lib_events', 'lib_guide', 'lib_countries']) {
    try {
      require(`${__hooks}/${lib}.js`).warm(e.app);
    } catch (err) {
      console.error('[hr] boot cache ' + lib + ':', err);
    }
  }
  // Load the kernel libraries once here, so the pool's runtimes reuse their compiled code.
  for (const lib of ['lib_util', 'lib_money', 'lib_auth', 'lib_ops', 'lib_bus', 'lib_audit', 'lib_settings', 'lib_org', 'lib_calendar', 'lib_people', 'lib_seal', 'lib_approvals', 'lib_proposals', 'lib_agent', 'lib_notify', 'lib_search', 'lib_files', 'lib_fx']) {
    try {
      require(`${__hooks}/${lib}.js`);
    } catch (err) {
      console.error('[hr] boot load ' + lib + ':', err);
    }
  }
  const t1 = Date.now();
  if (!e.app.hasTable('settings')) return;
  try {
    const r = require(`${__hooks}/lib_countries.js`).seedPacks(e.app);
    if (r.inserted > 0) console.log('[hr] seeded ' + r.inserted + ' rule pack versions (' + r.active + ' active)');
  } catch (err) {
    console.error('[hr] rule pack seeding failed:', err);
  }
  try {
    const n = require(`${__hooks}/lib_calendar.js`).seedAll(e.app);
    if (n > 0) console.log('[hr] added ' + n + ' holidays from new country data');
  } catch (err) {
    console.error('[hr] holiday seeding failed:', err);
  }
  console.log('[hr] boot: caches ' + (t1 - t0) + ' ms, seeding ' + (Date.now() - t1) + ' ms');
});

// No app-wide routerUse here: a JS middleware holds one of PocketBase's pooled
// runtimes for the whole request (the platform's own middlewares hold several
// already). Operation answers are gzip-compressed by the Go middleware on each
// generated route (tools/gen.mjs).

onRecordCreate((e) => {
  e.app.store().set('hr_d_' + e.record.collection().name, true);
  e.app.store().set('hr_d__any', true);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('hr_d_' + e.record.collection().name, true);
  e.app.store().set('hr_d__any', true);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('hr_d_' + e.record.collection().name, true);
  e.app.store().set('hr_d__any', true);
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

cronAdd('hr_minute', '* * * * *', () => {
  const app = $app.store().get('hr_app') || $app;
  if (app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_agent.js`).sendDeferred(app);
  } catch (err) {
    console.error('[hr] asking your AI agent failed:', err);
  }
  try {
    require(`${__hooks}/lib_notify.js`).sendPending(app);
  } catch (err) {
    console.error('[hr] notification emails failed:', err);
  }
  try {
    require(`${__hooks}/lib_events.js`).runDue(app, Date.now());
  } catch (err) {
    console.error('[hr] module cron failed:', err);
  }
  require(`${__hooks}/lib_bus.js`).flush(app);
});

cronAdd('hr_hourly', '7 * * * *', () => {
  const app = $app.store().get('hr_app') || $app;
  if (app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_people.js`).refreshStatuses(app);
  } catch (err) {
    console.error('[hr] employment statuses failed:', err);
  }
  require(`${__hooks}/lib_bus.js`).flush(app);
});

cronAdd('hr_nightly', '23 3 * * *', () => {
  const app = $app.store().get('hr_app') || $app;
  if (app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_proposals.js`).expire(app);
  } catch (err) {
    console.error('[hr] proposal expiry failed:', err);
  }
  require(`${__hooks}/lib_bus.js`).flush(app);
});

cronAdd('hr_rates', '17 */6 * * *', () => {
  const app = $app.store().get('hr_app') || $app;
  if (app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_fx.js`).refresh(app);
  } catch (err) {
    console.error('[hr] exchange rates failed:', err);
  }
  require(`${__hooks}/lib_bus.js`).flush(app);
});
