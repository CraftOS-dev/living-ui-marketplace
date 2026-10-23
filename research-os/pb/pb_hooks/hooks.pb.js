/// <reference path="../pb_data/types.d.ts" />
/**
 * Boot, transfer (caching, compression), live-update marks, write guards and
 * background jobs.
 *
 * - The SQL echo of PocketBase's dev mode is switched off at boot, and the
 *   planner gathers statistics (hourly afterwards).
 * - Files left half-read by a restart are queued again.
 * - Every saved or deleted record marks its collection as changed; the
 *   dispatcher then tells open screens (lib_bus.js).
 * - Every collection changes only through the app's operations. Direct API
 *   writes, even a superuser's (`agent-app data`), are refused.
 * - Jobs: the text worker and the resolver run every minute and then wait on
 *   an in-memory wake flag until the minute ends (no polling of the
 *   database); a minute job re-asks your AI agent about waiting work; an
 *   hourly job runs due saved-search alerts, re-checks retractions and keeps
 *   the planner statistics current.
 */

onBootstrap((e) => {
  e.next();
  for (const name of ['concurrentDB', 'nonconcurrentDB', 'auxConcurrentDB', 'auxNonconcurrentDB']) {
    try {
      const db = $app[name]();
      db.queryLogFunc = null;
      db.execLogFunc = null;
    } catch (err) {
      console.log('[ro] could not quiet ' + name + ': ' + err);
    }
  }
  try {
    const db = $app.nonconcurrentDB();
    db.newQuery('PRAGMA analysis_limit=400').execute();
    db.newQuery('ANALYZE').execute();
  } catch (err) {
    console.log('[ro] could not gather planner statistics: ' + err);
  }
  // Files left half-read by a restart are read again (a new database has none yet).
  try {
    if ($app.hasTable('files')) $app.db().newQuery("UPDATE files SET text_state = 'waiting' WHERE text_state = 'extracting'").execute();
    $app.store().set('ro_text_wake', true);
    $app.store().set('ro_resolve_wake', true);
  } catch (err) {
    console.log('[ro] could not requeue files: ' + err);
  }
});

// Built files under /assets/ carry a content hash in their names: cached for
// a year. They and operation answers go gzip-compressed (not PDFs, which are
// compressed already, and not the realtime stream).
routerUse((e) => {
  const path = String((e.request.url && e.request.url.path) || '');
  const asset = path.indexOf('/assets/') === 0;
  if (asset) e.response.header().set('Cache-Control', 'public, max-age=31536000, immutable');
  if (asset || (path.indexOf('/api/ops/') === 0 && path !== '/api/ops/files/content' && path !== '/api/ops/files/thumb')) return $apis.gzip().func(e);
  return e.next();
});

onRecordCreate((e) => {
  e.app.store().set('ro_d_' + e.record.collection().name, true);
  e.next();
});

onRecordUpdate((e) => {
  e.app.store().set('ro_d_' + e.record.collection().name, true);
  e.next();
});

onRecordDelete((e) => {
  e.app.store().set('ro_d_' + e.record.collection().name, true);
  e.next();
});

// A deleted page or file leaves the search index (cascades included).
onRecordDelete(
  (e) => {
    try {
      const S = require(`${__hooks}/lib_search.js`);
      if (e.record.collection().name === 'files') S.dropFile(e.app, e.record.id);
      else if (e.record.collection().name === 'notes') S.dropNote(e.app, e.record.id);
      else S.dropWork(e.app, e.record.id);
    } catch (err) {
      console.error('[ro] index cleanup failed:', err);
    }
    e.next();
  },
  'files',
  'notes',
  'works',
);

// A deleted record takes its waiting proposals with it.
onRecordDelete(
  (e) => {
    try {
      e.app.db().newQuery("UPDATE proposals SET status = 'stale' WHERE status = 'waiting' AND target_id = {:id}").bind({ id: e.record.id }).execute();
    } catch (err) {
      console.error('[ro] proposal cleanup failed:', err);
    }
    e.next();
  },
  'works',
  'files',
);

onRecordCreateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they keep passages, citations and the activity trail in step). Run app.guide to see them.');
  },
  'settings', 'import_batches', 'works', 'collections', 'collection_items', 'tags', 'work_tags', 'files', 'pages', 'anchors', 'annotations',
  'projects', 'project_works', 'notes', 'nodes', 'node_anchors', 'relations', 'boards', 'board_items', 'asks', 'proposals', 'field_marks',
  'activity', 'saved_views', 'searches', 'search_runs', 'candidates', 'oa_cache', 'work_refs',
  'manuscripts', 'ms_blocks', 'ms_changes', 'ms_snapshots', 'reviews_received', 'response_items', 'reviews', 'import_logs',
  'review_records', 'decisions', 'tasks', 'experiments', 'exp_runs', 'exp_log', 'exp_templates', 'repo_items', 'repo_versions', 'note_files', 'ms_builds', 'users',
);

onRecordUpdateRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations (they keep passages, citations and the activity trail in step). Run app.guide to see them.');
  },
  'settings', 'import_batches', 'works', 'collections', 'collection_items', 'tags', 'work_tags', 'files', 'pages', 'anchors', 'annotations',
  'projects', 'project_works', 'notes', 'nodes', 'node_anchors', 'relations', 'boards', 'board_items', 'asks', 'proposals', 'field_marks',
  'activity', 'saved_views', 'searches', 'search_runs', 'candidates', 'oa_cache', 'work_refs',
  'manuscripts', 'ms_blocks', 'ms_changes', 'ms_snapshots', 'reviews_received', 'response_items', 'reviews', 'import_logs',
  'review_records', 'decisions', 'tasks', 'experiments', 'exp_runs', 'exp_log', 'exp_templates', 'repo_items', 'repo_versions', 'note_files', 'ms_builds', 'users',
);

onRecordDeleteRequest(
  (e) => {
    throw new BadRequestError('"' + e.record.collection().name + '" changes only through the app\'s operations. Run app.guide to see them.');
  },
  'settings', 'import_batches', 'works', 'collections', 'collection_items', 'tags', 'work_tags', 'files', 'pages', 'anchors', 'annotations',
  'projects', 'project_works', 'notes', 'nodes', 'node_anchors', 'relations', 'boards', 'board_items', 'asks', 'proposals', 'field_marks',
  'activity', 'saved_views', 'searches', 'search_runs', 'candidates', 'oa_cache', 'work_refs',
  'manuscripts', 'ms_blocks', 'ms_changes', 'ms_snapshots', 'reviews_received', 'response_items', 'reviews', 'import_logs',
  'review_records', 'decisions', 'tasks', 'experiments', 'exp_runs', 'exp_log', 'exp_templates', 'repo_items', 'repo_versions', 'note_files', 'ms_builds', 'users',
);

// The text worker: reads waiting PDFs, then waits on the wake flag (set when
// a PDF arrives) until the minute is over.
cronAdd('ro_text', '* * * * *', () => {
  if ($app.isTransactional()) return;
  const until = Date.now() + 58500;
  const F = require(`${__hooks}/lib_files.js`);
  const run = () => {
    try {
      F.drain($app, until - Date.now());
    } catch (err) {
      console.error('[ro] text worker failed:', err);
    }
  };
  run();
  while (Date.now() < until) {
    $app.store().set('ro_text_alive', Date.now());
    if ($app.store().get('ro_text_wake') === true) {
      $app.store().remove('ro_text_wake');
      run();
    } else sleep(300);
  }
});

// The resolver: fills papers from their registries (and retries the
// unreachable ones whose time came), then waits on its wake flag.
cronAdd('ro_resolve', '* * * * *', () => {
  if ($app.isTransactional()) return;
  const until = Date.now() + 55000;
  const W = require(`${__hooks}/lib_works.js`);
  const run = () => {
    try {
      W.resolveDue($app, until - Date.now());
    } catch (err) {
      console.error('[ro] resolver failed:', err);
    }
    try {
      require(`${__hooks}/lib_files.js`).oaDue($app, until - Date.now());
    } catch (err) {
      console.error('[ro] open-access downloads failed:', err);
    }
    try {
      require(`${__hooks}/lib_bus.js`).flush($app);
    } catch (err) {
      console.error('[ro] live update failed:', err);
    }
  };
  run();
  while (Date.now() < until) {
    if ($app.store().get('ro_resolve_wake') === true) {
      $app.store().remove('ro_resolve_wake');
      run();
    } else sleep(400);
  }
});

// Every minute: ask your AI agent again about work whose ask was refused or
// lost, and take in PDF builds nobody is watching.
cronAdd('ro_jobs', '* * * * *', () => {
  if ($app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_agent.js`).reask($app);
  } catch (err) {
    console.error('[ro] re-ask failed:', err);
  }
  try {
    require(`${__hooks}/lib_ms.js`).settleAll($app);
  } catch (err) {
    console.error('[ro] PDF builds failed:', err);
  }
  try {
    require(`${__hooks}/lib_bus.js`).flush($app);
  } catch (err) {
    console.error('[ro] live update failed:', err);
  }
});

// Every hour: saved-search alerts that are due, retraction re-checks, old
// unsaved searches, left-over PDF build folders, planner statistics.
cronAdd('ro_hourly', '17 * * * *', () => {
  if ($app.isTransactional()) return;
  try {
    require(`${__hooks}/lib_discover.js`).feeds($app);
  } catch (err) {
    console.error('[ro] feeds failed:', err);
  }
  try {
    require(`${__hooks}/lib_works.js`).integrityDue($app, 40);
  } catch (err) {
    console.error('[ro] integrity re-check failed:', err);
  }
  try {
    require(`${__hooks}/lib_discover.js`).prune($app);
  } catch (err) {
    console.error('[ro] prune failed:', err);
  }
  try {
    require(`${__hooks}/lib_ms.js`).sweep($app);
  } catch (err) {
    console.error('[ro] PDF build folders failed:', err);
  }
  try {
    const db = $app.nonconcurrentDB();
    db.newQuery('PRAGMA analysis_limit=400').execute();
    db.newQuery('PRAGMA optimize').execute();
  } catch (err) {
    console.error('[ro] planner statistics failed:', err);
  }
  try {
    require(`${__hooks}/lib_bus.js`).flush($app);
  } catch (err) {
    console.error('[ro] live update failed:', err);
  }
});
