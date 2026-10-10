/// <reference path="../pb_data/types.d.ts" />
/**
 * Reordering: which items need buying, how many, and turning that into
 * draft purchase orders (one per supplier).
 *
 * The figures are plain arithmetic (lib_items.suggestion): an item needs
 * reordering when what is on hand plus what is already coming is at or
 * below its reorder point, and the suggestion fills it back up to its target
 * level. Creating orders is idempotent: an item already on a draft order for
 * the same supplier has that line set to the new quantity, never doubled.
 *
 * With auto restock on, the app asks the AI agent (trigger restock_review)
 * whenever an item newly needs reordering.
 */

/** Items that need reordering, grouped by supplier. */
function list(app) {
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const cur = core.currency(app);
  const ctx = items.context(app);
  const recs = app.findRecordsByFilter('items', 'archived = false', 'name', 0, 0);
  const drafts = {};
  for (const r of u.rows(
    app,
    "SELECT l.item AS item, l.qty AS qty, o.id AS po, o.number AS number FROM order_lines l JOIN orders o ON o.id = l.po WHERE o.status = 'draft'",
    { item: '', qty: -0, po: '', number: '' },
  )) {
    if (drafts[r.item] === undefined) drafts[r.item] = [];
    drafts[r.item].push({ id: r.po, number: r.number, qty: u.q3(r.qty) });
  }
  const groups = {};
  const order = [];
  let total = 0;
  let count = 0;
  for (const r of recs) {
    const b = items.brief(app, r, ctx, cur);
    if (b.reorder_qty <= 0) continue;
    const key = b.supplier !== null ? b.supplier.id : '';
    if (groups[key] === undefined) {
      const sup = key !== '' ? ctx.suppliers[key] : null;
      groups[key] = { supplier: sup !== null && sup !== undefined ? { id: sup.id, name: sup.name, email: sup.email, lead_time_days: sup.lead_time_days } : null, items: [], value: 0 };
      order.push(key);
    }
    const line = Object.assign(b, {
      suggested: b.reorder_qty,
      suggested_value: Math.round(b.reorder_qty * b.unit_cost_e4),
      suggested_value_text: core.moneyText(Math.round(b.reorder_qty * b.unit_cost_e4), cur),
      in_drafts: drafts[r.id] || [],
      why: why(b),
    });
    groups[key].items.push(line);
    groups[key].value += line.suggested_value;
    total += line.suggested_value;
    count += 1;
  }
  // Suppliers by name, items without a supplier last.
  order.sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return groups[a].supplier.name.toLowerCase() < groups[b].supplier.name.toLowerCase() ? -1 : 1;
  });
  const out = order.map((k) => Object.assign(groups[k], { value_text: core.moneyText(groups[k].value, cur) }));
  return { currency: cur, groups: out, count: count, value: total, value_text: core.moneyText(total, cur), auto_restock: core.settings(app).getBool('auto_restock') };
}

/** The suggestion in words, so anyone can check it. */
function why(b) {
  const u = require(`${__hooks}/lib_util.js`);
  const target = b.max_qty > b.min_qty ? b.max_qty : b.min_qty * 2;
  const parts = [];
  parts.push(u.fmtQty(b.on_hand) + ' on hand' + (b.incoming > 0 ? ' + ' + u.fmtQty(b.incoming) + ' coming' : '') + ' is at or below the reorder point of ' + u.fmtQty(b.min_qty) + '.');
  parts.push(
    'Ordering ' + u.fmtQty(b.reorder_qty) + ' brings it to ' + u.fmtQty(u.q3(b.on_hand + b.incoming + b.reorder_qty)) + (b.max_qty > b.min_qty ? ' (target level ' + u.fmtQty(target) + ').' : ' (twice the reorder point; set a target level to change this).'),
  );
  if (b.usage_per_day > 0) parts.push('About ' + u.fmtQty(b.usage_per_day) + ' ' + b.unit + ' a day went out over the last 30 days' + (b.days_left !== null ? ', so it lasts about ' + b.days_left + ' more days.' : '.'));
  return parts.join(' ');
}

/**
 * Put picks on draft orders, one per supplier. picks: [{ item, qty?, supplier? }]
 * (qty defaults to the suggestion). With no picks, every suggestion is used.
 */
function createOrders(app, picksRaw, actor, note) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const orders = require(`${__hooks}/lib_orders.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const ctx = items.context(app);
  const cur = core.currency(app);
  let picks = [];
  if (picksRaw === undefined || picksRaw.length === 0) {
    for (const g of list(app).groups) for (const it of g.items) picks.push({ item: u.byId(app, 'items', it.id), qty: it.suggested, supplier: g.supplier !== null ? g.supplier.id : '' });
  } else {
    picks = picksRaw.map((r, i) => {
      const it = core.item(app, (r || {}).item, 'items[' + i + '].item');
      const b = items.brief(app, it, ctx, cur);
      const qty = r.qty !== undefined && r.qty !== null && String(r.qty) !== ''
        ? u.qtyOf(r.qty, 'items[' + i + '].qty', { required: true, positive: true, fractional: it.getBool('fractional'), label: '"' + it.getString('name') + '"' })
        : b.reorder_qty;
      if (!(qty > 0)) throw u.fail(400, '"' + it.getString('name') + '" does not need reordering now; give qty to order it anyway');
      const sup = r.supplier ? core.supplier(app, r.supplier, 'items[' + i + '].supplier').id : it.getString('supplier');
      return { item: it, qty: qty, supplier: sup };
    });
  }
  if (picks.length === 0) throw u.fail(400, 'Nothing needs reordering right now');
  const bySupplier = {};
  for (const pk of picks) {
    if (bySupplier[pk.supplier] === undefined) bySupplier[pk.supplier] = [];
    bySupplier[pk.supplier].push(pk);
  }
  const touched = [];
  app.runInTransaction((tx) => {
    for (const sup of Object.keys(bySupplier)) {
      let draft = u.findOne(tx, 'orders', "status = 'draft' && supplier = {:s}", { s: sup });
      if (draft === null) {
        draft = new Record(tx.findCollectionByNameOrId('orders'));
        draft.set('number', core.nextNumber(tx, 'orders', 'number', 'PO-', 4));
        draft.set('supplier', sup);
        draft.set('location', orders.defaultLocation(tx));
        draft.set('status', 'draft');
        draft.set('origin', actor === 'agent' ? 'agent' : 'reorder');
        draft.set('closed_short', false);
        draft.set('note', '');
        draft.set('agent_note', actor === 'agent' ? String(note || '').slice(0, 2000) : '');
        tx.save(draft);
      } else if (actor === 'agent' && note) {
        draft.set('agent_note', String(note).slice(0, 2000));
        tx.save(draft);
      }
      for (const pk of bySupplier[sup]) orders.putLine(tx, draft.id, pk.item, pk.qty, null, 'set');
      touched.push(draft.id);
    }
  });
  return { orders: touched.map((id) => orders.serialize(app, app.findRecordById('orders', id))) };
}

/** Ids of the items that need reordering now, sorted. */
function lowIds(app) {
  const ids = [];
  for (const g of list(app).groups) for (const it of g.items) ids.push(it.id);
  ids.sort();
  return ids;
}

/**
 * Auto restock: ask the AI agent to draft orders when an item newly needs
 * reordering (one that was not in the set it was last asked about). Items
 * that stop needing it drop out of the remembered set, so they ask again
 * the next time they run low. Never throws.
 */
function maybeAsk(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  try {
    const s = core.settings(app);
    if (!s.getBool('auto_restock')) return { asked: false, reason: 'off' };
    const now = lowIds(app);
    const before = s.getString('restock_sig') === '' ? [] : s.getString('restock_sig').split(',');
    const fresh = now.filter((id) => before.indexOf(id) < 0);
    if (fresh.length === 0) {
      const kept = now.join(',');
      if (kept !== s.getString('restock_sig')) {
        s.set('restock_sig', kept);
        app.save(s);
      }
      return { asked: false, reason: now.length === 0 ? 'nothing to reorder' : 'already asked about these' };
    }
    const res = require(`${__hooks}/_triggers_lib.js`).fire(app, 'restock_review', {}, 'hook');
    if (res && res.ok) {
      s.set('restock_sig', now.join(','));
      s.set('restock_asked_on', u.today());
      app.save(s);
      return { asked: true, items: fresh.length };
    }
    // Refused (the trigger is cooling down): ask again on the next check.
    app.store().set('inv_restock_dirty', true);
    return { asked: false, reason: (res && res.message) || 'refused' };
  } catch (err) {
    console.error('[inventory] auto restock check failed:', err);
    return { asked: false, reason: 'error' };
  }
}

module.exports = { list: list, why: why, createOrders: createOrders, lowIds: lowIds, maybeAsk: maybeAsk };
