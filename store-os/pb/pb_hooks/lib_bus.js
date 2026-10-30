/// <reference path="../pb_data/types.d.ts" />
/**
 * Live updates without exposing records. Collections are closed to the raw
 * API, so screens cannot subscribe to them. A record hook marks a collection
 * as changed (in memory) and, when an operation or a background job ends,
 * flush() sends ONE message on the realtime topic "store" naming the changed
 * collections. Screens then reload what they show through operations.
 */

const COLLECTIONS = ['settings', 'shops', 'products', 'variants', 'stock_moves', 'listings', 'customers', 'orders', 'order_lines', 'shipments', 'threads', 'messages', 'proposals', 'chats', 'imports', 'activity', 'tasks'];
const PREFIX = 'store_d_';

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
    const msg = new SubscriptionMessage({ name: 'store', data: JSON.stringify({ c: changed }) });
    const clients = app.subscriptionsBroker().clients();
    for (const id in clients) {
      try {
        if (clients[id].hasSubscription('store')) clients[id].send(msg);
      } catch {
        /* a client that just left */
      }
    }
  } catch (err) {
    console.error('[store] realtime flush failed:', err);
  }
}

module.exports = { COLLECTIONS: COLLECTIONS, PREFIX: PREFIX, mark: mark, flush: flush };
