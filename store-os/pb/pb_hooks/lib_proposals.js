/// <reference path="../pb_data/types.d.ts" />
/**
 * Approvals: changes your AI agent proposes, waiting for you.
 *
 * When your AI agent calls an operation marked "propose" (a listing's text or
 * price, a SKU's price, a stock change, cancelling or refunding an order) and
 * your limits say "ask me" for that kind of change, the call is stored here
 * instead of run. Each item shows what it changes, before and after. When you
 * approve, every item is checked again first: if what it changes moved since
 * it was proposed, that item is skipped as stale rather than applied over the
 * newer value. Approved changes run exactly as if you had made them.
 *
 * Undo: listing text and price, SKU prices and stock changes can be undone
 * after approval (stock by an opposite move, so the ledger keeps both).
 * Cancelling and refunding orders are marked "cannot be undone".
 */

const EXPIRE_DAYS = 14;
const IRREVERSIBLE = ['orders.cancel', 'orders.refund', 'orders.return'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function guards(app) {
  return L('lib_store').settingsView(L('lib_store').settings(app)).guards;
}

/** What an operation would change: { label, target, fields: [{name, before, after, money}], risk, notes }. */
function preview(app, op, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const base = S.baseOrEmpty(app);
  if (op === 'listings.draft') {
    const prod = L('lib_products').ref(app, p.product);
    const shop = L('lib_shops').ref(app, p.shop);
    const cur = shop.getString('currency') || base;
    const l = U.findOne(app, 'listings', 'product = {:p} && shop = {:s}', { p: prod.id, s: shop.id });
    const fields = [];
    const add = (name, before, after, money) => {
      if (after === undefined) return;
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      fields.push({ name: name, before: before, after: after, money: money ? cur : '' });
    };
    add('title', l ? l.getString('title') : '', p.title !== undefined ? String(p.title) : undefined);
    add('description', l ? l.getString('description') : '', p.description !== undefined ? String(p.description) : undefined);
    add('price', l ? U.toMajor(l.getInt('price_minor'), cur) : null, p.price !== undefined ? U.toMajor(U.toMinor(p.price, cur, 'price'), cur) : undefined, true);
    add('keywords', l ? U.json(l, 'keywords', []) : [], p.keywords !== undefined ? U.list(p.keywords, 'keywords').map(String) : undefined);
    add('status', l ? l.getString('status') : '', p.status !== undefined && (!l || l.getString('status') !== 'live') ? String(p.status) : undefined);
    let risk = 'low';
    const notes = [];
    if (l && l.getString('status') === 'live') {
      risk = 'medium';
      notes.push('This listing is live: the new text shows once it is published again.');
    }
    if (l && p.price !== undefined && l.getInt('price_minor') > 0) {
      const drop = ((l.getInt('price_minor') - U.toMinor(p.price, cur)) / l.getInt('price_minor')) * 100;
      if (drop > guards(app).max_price_drop_pct) {
        risk = 'high';
        notes.push('Price drops ' + Math.round(drop) + '%, more than your ' + guards(app).max_price_drop_pct + '% limit.');
      }
    }
    if (p.title !== undefined) {
      const plat = L('lib_platforms').get(shop.getString('platform'));
      if (plat && plat.title_max > 0 && U.chars(p.title) > plat.title_max) notes.push('Title is ' + U.chars(p.title) + ' characters; ' + plat.name + ' allows ' + plat.title_max + '.');
    }
    if ((prod.getStringSlice('images') || []).length === 0) notes.push('The product has no pictures yet: the listing cannot be published until it has some.');
    return { label: (l ? 'Change the listing of ' : 'New listing of ') + prod.getString('title') + ' on ' + shop.getString('name'), target: 'product:' + prod.id, fields: fields, risk: risk, notes: notes };
  }
  if (op === 'variants.set-price') {
    const v = L('lib_stock').variantRef(app, p.variant);
    const before = v.getInt('price_minor');
    const after = U.toMinor(p.price, base, 'price');
    let risk = 'medium';
    const notes = [];
    if (before > 0 && ((before - after) / before) * 100 > guards(app).max_price_drop_pct) {
      risk = 'high';
      notes.push('Price drops ' + Math.round(((before - after) / before) * 100) + '%, more than your ' + guards(app).max_price_drop_pct + '% limit.');
    }
    if (v.getInt('cost_minor') > 0 && after < v.getInt('cost_minor')) {
      risk = 'high';
      notes.push('New price is below cost.');
    }
    const live = [];
    for (const l of app.findRecordsByFilter('listings', "product = {:p} && status = 'live'", '', 0, 0, { p: v.getString('product') })) {
      const sh = U.byId(app, 'shops', l.getString('shop'));
      if (sh !== null) live.push(sh.getString('name') + ' ' + U.fmt(l.getInt('price_minor'), sh.getString('currency') || base));
    }
    if (live.length > 0) notes.push('Listings keep their own prices: ' + live.join(', ') + '. Change them with listings.draft if they should follow.');
    return { label: 'Price of ' + v.getString('sku'), target: 'product:' + v.getString('product'), fields: [{ name: 'price', before: U.toMajor(before, base), after: U.toMajor(after, base), money: base }], risk: risk, notes: notes };
  }
  if (op === 'stock.adjust' || op === 'stock.count') {
    const v = L('lib_stock').variantRef(app, p.variant);
    const before = v.getInt('on_hand');
    const after = op === 'stock.adjust' ? before + U.int(p.qty, 'qty') : U.int(p.on_hand, 'on_hand');
    return { label: (op === 'stock.count' ? 'Count of ' : 'Stock change of ') + v.getString('sku') + (p.reason ? ' (' + p.reason + ')' : ''), target: 'product:' + v.getString('product'), fields: [{ name: 'on hand', before: before, after: after, money: '' }], risk: Math.abs(after - before) > 50 ? 'medium' : 'low', notes: [] };
  }
  if (op === 'orders.cancel' || op === 'orders.refund' || op === 'orders.return') {
    const o = L('lib_orders').ref(app, p.order, p.shop);
    const cur = o.getString('currency');
    const fields = [];
    if (op === 'orders.cancel') fields.push({ name: 'status', before: o.getString('status'), after: 'cancelled', money: '' });
    if (op === 'orders.refund') fields.push({ name: 'refunded', before: U.toMajor(o.getInt('refund_minor'), cur), after: U.toMajor(o.getInt('refund_minor') + U.toMinor(p.amount, cur, 'amount'), cur), money: cur });
    if (op === 'orders.return') fields.push({ name: 'items back', before: 0, after: U.list(p.lines, 'lines').reduce((n, l) => n + Number(l.qty || 0), 0) || 'all', money: '' });
    const verb = op === 'orders.cancel' ? 'Cancel' : op === 'orders.refund' ? 'Record a refund on' : 'Record a return on';
    const paid = o.getString('payment') === 'paid' || o.getString('payment') === 'partial_refund';
    const extra = [];
    if (op === 'orders.cancel' && paid && o.getInt('total_minor') - o.getInt('refund_minor') > 0) extra.push('Paid ' + U.fmt(o.getInt('total_minor') - o.getInt('refund_minor'), cur) + ': record the refund with orders.refund when the money goes back.');
    return { label: verb + ' order ' + o.getString('number'), target: 'order:' + o.id, fields: fields, risk: 'high', notes: (p.reason ? ['Reason: ' + p.reason] : []).concat(extra).concat(op === 'orders.refund' ? ['Store OS records the refund; the money is returned on ' + app.findRecordById('shops', o.getString('shop')).getString('name') + '.'] : []) };
  }
  return { label: op, target: '', fields: [], risk: 'medium', notes: [] };
}

function view(app, r) {
  const U = L('lib_util');
  const items = U.json(r, 'items', []);
  return {
    id: r.id,
    kind: r.getString('kind'),
    title: r.getString('title'),
    why: r.getString('why'),
    origin: r.getString('origin'),
    status: r.getString('status'),
    risk: r.getString('risk'),
    target: r.getString('target'),
    note: r.getString('note'),
    items: items.map((it, i) => ({ index: i, op: it.op, label: it.label, fields: it.fields, notes: it.notes || [], risk: it.risk, state: it.state || 'pending', error: it.error || '', irreversible: IRREVERSIBLE.indexOf(it.op) >= 0, undoable: undoable(it) })),
    decided_at: r.getString('decided_at'),
    created: r.getString('created'),
  };
}

function undoable(it) {
  return it.state === 'applied' && ['listings.draft', 'variants.set-price', 'stock.adjust', 'stock.count'].indexOf(it.op) >= 0;
}

const RISK_ORDER = { low: 0, medium: 1, high: 2 };

function make(app, kind, title, why, origin, items) {
  const U = L('lib_util');
  const r = U.newRecord(app, 'proposals');
  let risk = 'low';
  for (const it of items) if (RISK_ORDER[it.risk] > RISK_ORDER[risk]) risk = it.risk;
  r.set('kind', kind);
  r.set('title', U.clip(title, 300));
  r.set('why', U.clip(why || '', 4000));
  r.set('origin', origin);
  r.set('status', 'pending');
  r.set('risk', risk);
  r.set('items', items);
  r.set('target', items.length > 0 ? items[0].target : '');
  r.set('result', {});
  r.set('undo', {});
  app.save(r);
  L('lib_store').log(app, origin === 'agent' ? 'agent' : 'system', 'Proposed: ' + title, 'proposal:' + r.id);
  return r;
}

function itemOf(app, op, params) {
  const pv = preview(app, op, params);
  return { op: op, params: params, key: keyOf(app, op, params), label: pv.label, target: pv.target, fields: pv.fields, notes: pv.notes, risk: pv.risk, state: 'pending' };
}

/** What an item changes, so two proposals of the same change can be told apart from two different ones. */
function keyOf(app, op, p) {
  try {
    if (op === 'listings.draft') return op + ':' + L('lib_products').ref(app, p.product).id + ':' + L('lib_shops').ref(app, p.shop).id;
    if (op === 'variants.set-price' || op === 'stock.count') return op + ':' + L('lib_stock').variantRef(app, p.variant).id;
    if (op === 'orders.cancel' || op === 'orders.refund' || op === 'orders.return') return op + ':' + L('lib_orders').ref(app, p.order, p.shop).id;
  } catch {
    return '';
  }
  return '';
}

function afterOf(it) {
  return JSON.stringify((it.fields || []).map((f) => [f.name, f.after]));
}

/**
 * Pending items that propose the same change as `items`: an identical one
 * makes the new item a duplicate (dropped); a different one is replaced by
 * the new item (the older proposal is withdrawn when nothing is left in it).
 * stock.adjust is never matched: two deliveries are two moves.
 */
function settleRepeats(app, items) {
  const keep = [];
  const dupOf = [];
  for (const it of items) {
    if (it.key === '' || it.op === 'stock.adjust') {
      keep.push(it);
      continue;
    }
    let dup = '';
    for (const r of app.findRecordsByFilter('proposals', "status = 'pending'", '', 0, 0)) {
      const old = L('lib_util').json(r, 'items', []);
      let changed = false;
      for (const o of old) {
        if (o.state !== 'pending' || o.key !== it.key) continue;
        if (afterOf(o) === afterOf(it)) dup = r.id;
        else {
          o.state = 'superseded';
          o.error = 'Replaced by a newer proposal.';
          changed = true;
        }
      }
      if (changed) {
        r.set('items', old);
        if (!old.some((o) => o.state === 'pending')) {
          r.set('status', 'withdrawn');
          r.set('decided_at', L('lib_util').now());
        }
        app.save(r);
      }
    }
    if (dup !== '') dupOf.push(dup);
    else keep.push(it);
  }
  return { keep: keep, duplicate_of: dupOf };
}

/** Your AI agent called a "propose" operation: store it for approval. */
function fromCall(ctx, spec, params) {
  const why = String(params.why || '');
  delete params.why;
  const item = itemOf(ctx.app, spec.name, params);
  const s = settleRepeats(ctx.app, [item]);
  if (s.keep.length === 0) return { proposed: true, proposal: s.duplicate_of[0], duplicate_of: s.duplicate_of[0], message: 'The same change is already waiting for the seller in proposal ' + s.duplicate_of[0] + '. Nothing new was added.' };
  const r = make(ctx.app, spec.kind, item.label, why, 'agent', [item]);
  return { proposed: true, proposal: r.id, message: 'Waiting for the seller\'s approval (Approvals). Nothing changed yet.', preview: { label: item.label, fields: item.fields, notes: item.notes, risk: item.risk } };
}

/* ------------------------------------------------------------------- ops */

function create(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const raw = U.list(p.items, 'items');
  if (raw.length === 0) throw U.fail(400, 'Give --items \'[{"op":"listings.draft","params":{"product":"...","shop":"...","title":"..."}}]\'.', 'missing_param', { param: 'items' });
  if (raw.length > 200) throw U.fail(400, 'At most 200 changes in one proposal.', 'too_many');
  const cat = L('lib_catalog');
  const items = [];
  const kinds = {};
  raw.forEach((it, i) => {
    const spec = (() => {
      try {
        return cat.get(String(it.op || ''));
      } catch {
        throw U.fail(400, 'Item ' + (i + 1) + ': unknown operation ' + it.op + '.', 'invalid_param');
      }
    })();
    if (spec.agent !== 'propose') throw U.fail(400, 'Item ' + (i + 1) + ': ' + spec.name + ' is not a change that needs approval; run it directly.', 'invalid_param');
    const params = L('lib_ops').check(it.params && typeof it.params === 'object' ? it.params : {}, spec, U, false);
    delete params.why;
    items.push(itemOf(app, spec.name, params));
    kinds[spec.kind] = true;
  });
  const ks = Object.keys(kinds);
  const s = settleRepeats(app, items);
  if (s.keep.length === 0) return { proposal: view(app, ref(app, s.duplicate_of[0])), duplicate_of: s.duplicate_of, message: 'Every change here is already waiting for the seller. Nothing new was added.' };
  const title = String(p.title || '').trim() || (s.keep.length === 1 ? s.keep[0].label : s.keep.length + ' changes');
  const r = make(app, ks.length === 1 ? ks[0] : 'mixed', title, p.why || '', ctx.isAgent ? 'agent' : 'rule', s.keep);
  const out = { proposal: view(app, r) };
  if (s.duplicate_of.length > 0) out.duplicate_of = s.duplicate_of;
  return out;
}

function list(ctx, p) {
  const app = ctx.app;
  const status = p.status || 'pending';
  const filter = status === 'pending' ? "status = 'pending'" : status === 'decided' ? "status != 'pending'" : '1=1';
  const rows = app.findRecordsByFilter('proposals', filter, status === 'pending' ? 'created' : '-created', Math.min(Math.max(Math.round(p.limit || 100), 1), 300), 0).map((r) => view(app, r));
  const pending = L('lib_util').count(app, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'", {});
  return { pending: pending, proposals: rows };
}

function ref(app, id) {
  const U = L('lib_util');
  const r = U.byId(app, 'proposals', String(id || ''));
  if (r === null) throw U.fail(404, 'No proposal ' + id + '. Run proposals.list.', 'not_found');
  return r;
}

function get(ctx, p) {
  return { proposal: view(ctx.app, ref(ctx.app, p.proposal)) };
}

function approve(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.proposal);
  if (r.getString('status') !== 'pending') throw U.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  const items = U.json(r, 'items', []);
  const chosen = U.list(p.items, 'items').map(Number);
  const pick = (i) => chosen.length === 0 || chosen.indexOf(i) >= 0;
  const approved = require(`${__hooks}/lib_auth.js`).approved(app);
  let applied = 0;
  let failed = 0;
  items.forEach((it, i) => {
    if (it.state !== 'pending') return;
    if (!pick(i)) {
      it.state = 'rejected';
      return;
    }
    // Check again: apply only over the values that were shown.
    let now;
    try {
      now = preview(app, it.op, Object.assign({}, it.params));
    } catch (err) {
      it.state = 'failed';
      it.error = String((err && err.message) || err);
      failed++;
      return;
    }
    // A field missing from the fresh preview already holds the proposed value.
    const stale = (it.fields || []).some((f) => {
      const cur = (now.fields || []).filter((x) => x.name === f.name)[0];
      return cur !== undefined && JSON.stringify(cur.before) !== JSON.stringify(f.before);
    });
    if (stale) {
      it.state = 'stale';
      it.error = 'Changed since it was proposed; not applied.';
      failed++;
      return;
    }
    try {
      L('lib_ops').call(approved, it.op, Object.assign({}, it.params));
      it.state = 'applied';
      applied++;
    } catch (err) {
      it.state = 'failed';
      it.error = String((err && err.message) || err);
      failed++;
    }
  });
  r.set('items', items);
  r.set('status', applied === 0 ? 'failed' : failed > 0 || items.some((x) => x.state === 'rejected') ? 'partial' : 'applied');
  r.set('decided_at', U.now());
  app.save(r);
  L('lib_store').log(app, 'person', 'Approved: ' + r.getString('title') + ' (' + applied + ' applied' + (failed > 0 ? ', ' + failed + ' not' : '') + ')', 'proposal:' + r.id);
  return { proposal: view(app, r), applied: applied, failed: failed };
}

function reject(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.proposal);
  if (r.getString('status') !== 'pending') throw U.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  const items = U.json(r, 'items', []);
  for (const it of items) if (it.state === 'pending') it.state = 'rejected';
  r.set('items', items);
  r.set('status', 'rejected');
  r.set('note', U.clip(p.note || '', 1000));
  r.set('decided_at', U.now());
  app.save(r);
  L('lib_store').log(app, 'person', 'Rejected: ' + r.getString('title') + (p.note ? ' (' + U.clip(p.note, 160) + ')' : ''), 'proposal:' + r.id);
  return { proposal: view(app, r) };
}

function withdraw(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.proposal);
  if (r.getString('status') !== 'pending') throw U.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'conflict');
  r.set('status', 'withdrawn');
  r.set('decided_at', U.now());
  app.save(r);
  return { proposal: view(app, r) };
}

/** Put back what approved items changed. */
function undo(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.proposal);
  const items = U.json(r, 'items', []);
  const approved = require(`${__hooks}/lib_auth.js`).approved(app);
  let undone = 0;
  for (const it of items) {
    if (!undoable(it)) continue;
    const before = {};
    for (const f of it.fields || []) before[f.name] = f.before;
    try {
      if (it.op === 'listings.draft') {
        const prod = L('lib_products').ref(app, it.params.product);
        const shop = L('lib_shops').ref(app, it.params.shop);
        const l = U.findOne(app, 'listings', 'product = {:p} && shop = {:s}', { p: prod.id, s: shop.id });
        if (l !== null) {
          const wasNew = (it.fields || []).some((f) => f.name === 'title' && f.before === '') && (it.fields || []).every((f) => f.before === '' || f.before === null || (Array.isArray(f.before) && f.before.length === 0));
          if (wasNew && l.getString('status') !== 'live') app.delete(l);
          else {
            const cur = shop.getString('currency') || L('lib_store').baseOrEmpty(app);
            if (before.title !== undefined) l.set('title', before.title);
            if (before.description !== undefined) l.set('description', before.description);
            if (before.price !== undefined && before.price !== null) l.set('price_minor', U.toMinor(before.price, cur));
            if (before.keywords !== undefined) l.set('keywords', before.keywords);
            if (before.status !== undefined && before.status !== '') l.set('status', before.status);
            l.set('changed_at', U.now());
            app.save(l);
          }
        }
      } else if (it.op === 'variants.set-price') {
        L('lib_ops').call(approved, 'variants.set-price', { variant: it.params.variant, price: before.price });
      } else {
        const v = L('lib_stock').variantRef(app, it.params.variant);
        const delta = Number(before['on hand']) - Number((it.fields[0] || {}).after);
        L('lib_stock').move(app, v, delta, 'adjust', '', 'Undo of an approved change', 'person');
      }
      it.state = 'undone';
      undone++;
    } catch (err) {
      it.error = 'Could not undo: ' + String((err && err.message) || err);
    }
  }
  if (undone === 0) throw U.fail(409, 'Nothing here can be undone.', 'conflict');
  r.set('items', items);
  if (items.every((x) => x.state !== 'applied')) r.set('status', 'undone');
  app.save(r);
  L('lib_store').log(app, 'person', 'Undid: ' + r.getString('title'), 'proposal:' + r.id);
  return { proposal: view(app, r), undone: undone };
}

/** Pending proposals older than two weeks close themselves rather than apply late. */
function expire(app) {
  const U = L('lib_util');
  const before = new Date(Date.now() - EXPIRE_DAYS * 86400000).toISOString().replace('T', ' ');
  for (const r of app.findRecordsByFilter('proposals', "status = 'pending' && created < {:t}", '', 0, 0, { t: before })) {
    r.set('status', 'expired');
    r.set('decided_at', U.now());
    app.save(r);
  }
}

module.exports = { IRREVERSIBLE: IRREVERSIBLE, preview: preview, fromCall: fromCall, create: create, list: list, get: get, approve: approve, reject: reject, withdraw: withdraw, undo: undo, expire: expire };
