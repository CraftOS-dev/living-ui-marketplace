/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot, live-update marks, write guards and background jobs.
 *
 * - At boot the app keeps a handle for the jobs (a pooled VM can hold a
 *   committed transaction as $app), quiets the SQL echo, fetches exchange
 *   rates when they are missing or old and asks your AI agent about tasks
 *   that were waiting (sync on boot).
 * - Every saved or deleted record marks its collection as changed; the
 *   dispatcher then tells open screens (lib_bus.js).
 * - The collections change only through the app's operations. Direct API
 *   writes, even a superuser's (`agent-app data`), are refused: they would
 *   skip the stock ledger, the totals and the activity trail.
 * - Jobs: every minute the task queue (ask again, re-queue, give up); every
 *   six hours the exchange rates; every night the buyer-data purge and the
 *   expiry of old proposals.
 */

onBootstrap((e) => {
  e.next();
  e.app.store().set('store_app', e.app);
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[store] could not quiet ' + name + ': ' + err);
    }
  }
  try {
    if ($app.hasTable('settings')) {
      const S = require(`${__hooks}/lib_store.js`);
      const rec = S.settings($app);
      const at = rec.getString('fx_at');
      if (rec.getString('base_currency') !== '' && (at === '' || Date.now() - new Date(at).getTime() > 6 * 3600000)) S.fxRefresh($app);
    }
  } catch (err) {
    console.log('[store] boot rates: ' + err);
  }
  try {
    if ($app.hasTable('tasks')) require(`${__hooks}/lib_tasks.js`).tick($app);
  } catch (err) {
    console.log('[store] boot tasks: ' + err);
  }
});

// Built files under /assets/ carry a content hash in their names.
routerUse((e) => {
  const path = String((e.request.url && e.request.url.path) || '');
  if (path.indexOf('/assets/') === 0) e.response.header().set('Cache-Control', 'public, max-age=31536000, immutable');
  return e.next();
});

onRecordCreate((e) => {
  e.app.store().set('store_d_' + e.record.collection().name, true);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('store_d_' + e.record.collection().name, true);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('store_d_' + e.record.collection().name, true);
  e.next();
});

onRecordCreateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they keep the stock ledger, the totals and the activity trail in step). Run app.guide to see them.');
  },
  'settings',
  'shops',
  'products',
  'variants',
  'stock_moves',
  'listings',
  'customers',
  'orders',
  'order_lines',
  'shipments',
  'threads',
  'messages',
  'proposals',
  'chats',
  'imports',
  'activity',
  'tasks',
);

onRecordUpdateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
  },
  'settings',
  'shops',
  'products',
  'variants',
  'stock_moves',
  'listings',
  'customers',
  'orders',
  'order_lines',
  'shipments',
  'threads',
  'messages',
  'proposals',
  'chats',
  'imports',
  'activity',
  'tasks',
);

onRecordDeleteRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
  },
  'settings',
  'shops',
  'products',
  'variants',
  'stock_moves',
  'listings',
  'customers',
  'orders',
  'order_lines',
  'shipments',
  'threads',
  'messages',
  'proposals',
  'chats',
  'imports',
  'activity',
  'tasks',
);

cronAdd('store_tasks', '* * * * *', () => {
  const app = $app.store().get('store_app') || $app;
  try {
    require(`${__hooks}/lib_tasks.js`).tick(app);
    require(`${__hooks}/lib_bus.js`).flush(app);
  } catch (err) {
    console.error('[store] task job failed:', err);
  }
});

cronAdd('store_fx', '17 */6 * * *', () => {
  const app = $app.store().get('store_app') || $app;
  try {
    require(`${__hooks}/lib_store.js`).fxRefresh(app);
    require(`${__hooks}/lib_bus.js`).flush(app);
  } catch (err) {
    console.error('[store] rates job failed:', err);
  }
});

cronAdd('store_nightly', '23 3 * * *', () => {
  const app = $app.store().get('store_app') || $app;
  try {
    require(`${__hooks}/lib_app.js`).purge(app);
    require(`${__hooks}/lib_proposals.js`).expire(app);
    require(`${__hooks}/lib_bus.js`).flush(app);
  } catch (err) {
    console.error('[store] nightly job failed:', err);
  }
});
