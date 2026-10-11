/// <reference path="../pb_data/types.d.ts" />
/**
 * The kitchen screen: a ticket per paid order with what the kitchen makes
 * (products in categories marked for the kitchen). A ticket moves new ->
 * ready (the order is called) -> done (collected); recall moves it one step
 * back. The order board shows customers the numbers being made and ready.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function serialize(rec) {
  return {
    id: rec.id,
    sale: rec.getString('sale'),
    number: rec.getString('number'),
    order_no: rec.getInt('order_no'),
    name: rec.getString('name'),
    order_type: rec.getString('order_type'),
    items: u().jsonOf(rec, 'items', []),
    note: rec.getString('note'),
    status: rec.getString('status'),
    ready_at: rec.getString('ready_at'),
    done_at: rec.getString('done_at'),
    training: rec.getBool('training'),
    created: rec.getString('created'),
  };
}

function list(app, p) {
  const util = u();
  const view = util.oneOf(p, 'view', ['active', 'done'], 'active');
  const recs =
    view === 'active'
      ? app.findRecordsByFilter('tickets', "status = 'new' || status = 'ready'", 'created', 200, 0)
      : app.findRecordsByFilter('tickets', "status = 'done'", '-done_at', util.int(p, 'limit', 30, 1, 200), 0);
  const counts = {
    new: util.scalarSql(app, "SELECT COUNT(id) AS v FROM tickets WHERE status = 'new'"),
    ready: util.scalarSql(app, "SELECT COUNT(id) AS v FROM tickets WHERE status = 'ready'"),
  };
  // Items across the open tickets, to batch-cook (the "all day" count).
  const allDay = {};
  for (const t of app.findRecordsByFilter('tickets', "status = 'new'", '', 0, 0)) {
    for (const it of util.jsonOf(t, 'items', [])) {
      const key = it.name + (it.variant ? ' ' + it.variant : '');
      allDay[key] = (allDay[key] || 0) + (it.qty || 0);
    }
  }
  return {
    tickets: recs.map(serialize),
    counts: counts,
    all_day: Object.keys(allDay)
      .map((k) => ({ name: k, qty: allDay[k] }))
      .sort((a, b) => b.qty - a.qty),
  };
}

/** The customer-facing board: order numbers being made and ready (no items). */
function board(app) {
  const recs = app.findRecordsByFilter('tickets', "(status = 'new' || status = 'ready') && training = false", 'created', 100, 0);
  return {
    preparing: recs.filter((r) => r.getString('status') === 'new').map((r) => ({ id: r.id, order_no: r.getInt('order_no'), name: r.getString('name') })),
    ready: recs
      .filter((r) => r.getString('status') === 'ready')
      .sort((a, b) => (a.getString('ready_at') < b.getString('ready_at') ? 1 : -1))
      .map((r) => ({ id: r.id, order_no: r.getInt('order_no'), name: r.getString('name') })),
  };
}

function mustGet(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.byId(app, 'tickets', r) || util.findOne(app, 'tickets', 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null) throw util.fail(404, 'No kitchen ticket "' + r + '". List them with kitchen.list.', 'not_found');
  return rec;
}

/** Move a ticket on: new -> ready -> done. */
function bump(app, rec) {
  const util = u();
  const st = rec.getString('status');
  if (st === 'new') {
    rec.set('status', 'ready');
    rec.set('ready_at', util.nowIso());
  } else if (st === 'ready') {
    rec.set('status', 'done');
    rec.set('done_at', util.nowIso());
  } else throw util.fail(409, 'That order was already collected.', 'ticket_done');
  app.save(rec);
  return serialize(rec);
}

/** Move a ticket back one step: ready -> new, done -> ready. */
function recall(app, rec) {
  const util = u();
  const st = rec.getString('status');
  if (st === 'ready') {
    rec.set('status', 'new');
    rec.set('ready_at', '');
  } else if (st === 'done') {
    rec.set('status', 'ready');
    rec.set('done_at', '');
  } else throw util.fail(409, 'That order is already in the kitchen.', 'ticket_new');
  app.save(rec);
  return serialize(rec);
}

module.exports = { serialize: serialize, list: list, board: board, mustGet: mustGet, bump: bump, recall: recall };
