/// <reference path="../pb_data/types.d.ts" />
/**
 * Live updates without exposing records. Collections are closed to the raw
 * API, so screens cannot subscribe to them. A record hook marks a collection
 * as changed (in memory) and, when an operation or a background job ends,
 * flush() sends ONE message on the realtime topic "yc" naming the changed
 * collections. Screens then reload what they show through operations.
 */

const COLLECTIONS = ['settings', 'founders', 'answers', 'sources', 'messages', 'activity'];
const PREFIX = 'yc_d_';

function mark(app, name) {
  app.store().set(PREFIX + name, true);
}

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
    const msg = new SubscriptionMessage({ name: 'yc', data: JSON.stringify({ c: changed }) });
    const clients = app.subscriptionsBroker().clients();
    for (const id in clients) {
      try {
        if (clients[id].hasSubscription('yc')) clients[id].send(msg);
      } catch {
        /* a client that just left */
      }
    }
  } catch (err) {
    console.error('[yc] realtime flush failed:', err);
  }
}

module.exports = { COLLECTIONS: COLLECTIONS, mark: mark, flush: flush };
