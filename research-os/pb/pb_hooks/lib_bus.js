/// <reference path="../pb_data/types.d.ts" />
/**
 * Live updates without exposing data.
 *
 * Every collection is closed to the raw API, so screens cannot subscribe to
 * records. Instead a record hook marks the collection as changed (in memory)
 * and, when an operation or job finishes, flush() sends ONE message on the
 * custom realtime topic "ro" listing the collections that changed. Screens
 * reload the views that read those collections through operations. The
 * message carries names only.
 */

const COLLECTIONS = [
  'settings', 'import_batches', 'works', 'collections', 'collection_items', 'tags', 'work_tags', 'files', 'pages', 'anchors',
  'annotations', 'projects', 'project_works', 'notes', 'nodes', 'node_anchors', 'relations', 'boards', 'board_items', 'asks',
  'proposals', 'field_marks', 'activity', 'saved_views', 'searches', 'search_runs', 'candidates', 'oa_cache', 'work_refs',
  'manuscripts', 'ms_blocks', 'ms_changes', 'ms_snapshots', 'reviews_received',
  'response_items', 'reviews', 'import_logs', 'review_records', 'decisions', 'tasks', 'experiments', 'exp_runs', 'exp_log', 'exp_templates', 'repo_items', 'repo_versions', 'note_files', 'ms_builds',
];

const PREFIX = 'ro_d_';

function mark(app, name) {
  app.store().set(PREFIX + name, true);
}

/** Send one "ro" message naming every collection changed since the last flush. */
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
    const msg = new SubscriptionMessage({ name: 'ro', data: JSON.stringify({ c: changed }) });
    const clients = app.subscriptionsBroker().clients();
    for (const id in clients) {
      try {
        if (clients[id].hasSubscription('ro')) clients[id].send(msg);
      } catch {
        /* a client that just left */
      }
    }
  } catch (err) {
    console.error('[ro] realtime flush failed:', err);
  }
}

module.exports = { COLLECTIONS: COLLECTIONS, mark: mark, flush: flush };
