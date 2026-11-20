/// <reference path="../pb_data/types.d.ts" />
/**
 * Live updates without exposing records. Every collection is closed to the
 * raw API, so screens cannot subscribe to records. A record hook (and
 * touch()) marks a collection as changed in memory; when an operation or a
 * background job ends, flush() sends ONE message on the realtime topic "vo"
 * naming the changed collections: {"c": ["deals", "stage_events"]}.
 * Screens reload what they show through operations, which check rights.
 *
 * Code that writes with raw SQL calls touch(collection) afterwards: it also
 * moves the data version, so cached Next lists are rebuilt.
 */

const PREFIX = 'vo_d_';
const ANY = 'vo_d__any';
const TOPIC = 'vo';

let _names = null;

/** Every collection name of the app (cached per runtime; collections change only with migrations). */
function names(app) {
  if (_names === null) {
    const u = require(`${__hooks}/lib_util.js`);
    _names = u.rows(app, "SELECT name FROM _collections WHERE name NOT LIKE '\\_%' ESCAPE '\\'", { name: '' }).map((r) => r.name);
  }
  return _names;
}

/** Mark a collection as changed (record hooks do this for every save and delete). */
function touch(collection) {
  const store = $app.store();
  store.set(PREFIX + collection, true);
  store.set(ANY, true);
  store.set('vo_data_version', String(Date.now()) + '.t' + collection);
}

/** Send one "vo" message naming every collection changed since the last flush. */
function flush(app) {
  const store = app.store();
  if (store.get(ANY) !== true) return;
  store.remove(ANY);
  const changed = [];
  for (const c of names(app)) {
    if (store.get(PREFIX + c) === true) {
      store.remove(PREFIX + c);
      changed.push(c);
    }
  }
  if (changed.length === 0) return;
  try {
    const msg = new SubscriptionMessage({ name: TOPIC, data: JSON.stringify({ c: changed }) });
    const clients = app.subscriptionsBroker().clients();
    for (const id in clients) {
      try {
        if (clients[id].hasSubscription(TOPIC)) clients[id].send(msg);
      } catch {
        /* a client that just left */
      }
    }
  } catch (err) {
    console.error('[vo] realtime flush failed:', err);
  }
}

module.exports = { PREFIX: PREFIX, ANY: ANY, TOPIC: TOPIC, touch: touch, flush: flush, names: names };
