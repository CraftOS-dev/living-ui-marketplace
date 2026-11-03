/// <reference path="../pb_data/types.d.ts" />
/**
 * The store as a whole: settings, your AI agent's limits, where things stand,
 * search across everything, the activity trail and the buyer-data purge.
 *
 * Buyer data: addresses and phone numbers of orders delivered (or cancelled)
 * more than `pii_days` days ago are removed every night; names, emails and
 * the order itself stay. Marketplace rules (Amazon's is the strictest, 30
 * days) expect sellers to keep buyer contact details no longer than needed.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function settingsGet(ctx) {
  const S = L('lib_store');
  return { settings: S.settingsView(S.settings(ctx.app)) };
}

function settingsUpdate(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const P = L('lib_platforms');
  const app = ctx.app;
  const r = S.settings(app);
  const baseBefore = r.getString('base_currency');
  if (p.business_name !== undefined) r.set('business_name', U.clip(String(p.business_name).trim(), 120));
  if (p.owner_name !== undefined) r.set('owner_name', U.clip(String(p.owner_name).trim(), 80));
  if (p.country !== undefined) {
    if (p.country !== '' && P.country(p.country) === null) throw U.fail(400, 'country must be one of: ' + P.COUNTRIES.map((c) => c.code).join(', ') + '.', 'invalid_param', { param: 'country' });
    r.set('country', p.country);
  }
  if (p.base_currency !== undefined) {
    const cur = String(p.base_currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw U.fail(400, 'base_currency must be a 3-letter code such as MYR.', 'invalid_param', { param: 'base_currency' });
    if (baseBefore !== '' && cur !== baseBefore) {
      const priced = U.count(app, 'SELECT COUNT(*) AS n FROM variants WHERE price_minor > 0 OR cost_minor > 0', {});
      if (priced > 0) throw U.fail(409, 'Prices and costs are already in ' + baseBefore + '; the base currency cannot change once products have prices.', 'conflict');
    }
    r.set('base_currency', cur);
  }
  if (p.timezone !== undefined) r.set('timezone', U.clip(p.timezone, 60));
  if (p.utc_offset !== undefined) {
    const n = U.int(p.utc_offset, 'utc_offset');
    if (n < -840 || n > 840) throw U.fail(400, 'utc_offset is minutes east of UTC, from -840 to 840 (Malaysia is 480).', 'invalid_param', { param: 'utc_offset' });
    r.set('utc_offset', n);
  }
  if (p.pii_days !== undefined) {
    const n = U.int(p.pii_days, 'pii_days');
    if (n < 7 || n > 3650) throw U.fail(400, 'pii_days must be from 7 to 3650.', 'invalid_param', { param: 'pii_days' });
    r.set('pii_days', n);
  }
  if (p.low_stock !== undefined) {
    const n = U.int(p.low_stock, 'low_stock');
    if (n < 0) throw U.fail(400, 'low_stock cannot be negative.', 'invalid_param', { param: 'low_stock' });
    r.set('low_stock', n);
  }
  if (p.max_price_drop_pct !== undefined || p.min_margin_pct !== undefined) {
    const g = U.json(r, 'guards', {});
    if (p.max_price_drop_pct !== undefined) g.max_price_drop_pct = Math.max(0, Math.min(100, Number(p.max_price_drop_pct)));
    if (p.min_margin_pct !== undefined) g.min_margin_pct = Math.max(-100, Math.min(100, Number(p.min_margin_pct)));
    r.set('guards', g);
  }
  if (p.onboarded !== undefined) r.set('onboarded', p.onboarded === true);
  app.save(r);
  if (r.getString('base_currency') !== '' && r.getString('base_currency') !== baseBefore) {
    // A new base currency: the Direct shop sells in it, and rates follow it.
    const direct = U.findOne(app, 'shops', "platform = 'direct'", {});
    if (direct !== null && direct.getString('currency') === '') {
      direct.set('currency', r.getString('base_currency'));
      if (direct.getString('region') === '') direct.set('region', r.getString('country'));
      app.save(direct);
    }
    try {
      S.fxRefresh(app);
    } catch (err) {
      console.error('[store] fx refresh failed:', err);
    }
  }
  S.log(app, ctx.actor, 'Changed the settings: ' + Object.keys(p).join(', '), '');
  return settingsGet(ctx);
}

function autonomy(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const r = S.settings(app);
  const a = S.autonomyOf(r);
  for (const k of S.KINDS) if (p[k] !== undefined) a[k] = U.oneOf(p[k], ['ask', 'auto'], k);
  r.set('autonomy', a);
  app.save(r);
  S.log(app, 'person', 'Your AI agent\'s limits: ' + S.KINDS.map((k) => k + ' ' + (a[k] === 'auto' ? 'automatic' : 'ask me')).join(', '), '');
  return settingsGet(ctx);
}

function fxRefresh(ctx) {
  const S = L('lib_store');
  const out = S.fxRefresh(ctx.app);
  if (out === null) throw L('lib_util').fail(409, 'Set the base currency first.', 'not_set_up');
  return { fx: out };
}

/** Where the store stands, for your AI agent's first look. */
function status(ctx) {
  const S = L('lib_store');
  const app = ctx.app;
  const settings = S.settingsView(S.settings(app));
  const att = L('lib_reports').attention(ctx);
  const shops = L('lib_shops').list(ctx).shops.map((s) => ({ id: s.id, name: s.name, platform: s.platform, status: s.status, connection: s.connection, currency: s.currency, setup: s.setup, sync_at: s.sync_at, to_ship: s.to_ship, late: s.late, open_threads: s.open_threads, task: s.task }));
  const tasks = L('lib_tasks').list(ctx, {}).tasks;
  return {
    set_up: settings.base_currency !== '',
    business: settings.business_name,
    base_currency: settings.base_currency,
    autonomy: settings.autonomy,
    shops: shops,
    attention: att,
    open_tasks: tasks,
    next: settings.base_currency === '' ? 'The seller has not set up the store yet (settings.update --business_name --country --base_currency).' : tasks.length > 0 ? 'Work the open tasks (tasks.list).' : 'Nothing is waiting for you.',
  };
}

function activity(ctx, p) {
  const limit = Math.min(Math.max(Math.round(p.limit || 40), 1), 300);
  const filter = p.target ? 'target = {:t}' : '1=1';
  return { activity: ctx.app.findRecordsByFilter('activity', filter, '-created', limit, 0, { t: p.target || '' }).map((a) => ({ id: a.id, actor: a.getString('actor'), text: a.getString('text'), target: a.getString('target'), created: a.getString('created') })) };
}

/** Search orders, products, customers and conversations at once. */
function search(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const q = String(p.q || '').trim().replace(/^#/, '');
  if (q.length < 2) return { orders: [], products: [], customers: [], threads: [] };
  const shopName = {};
  for (const s of app.findRecordsByFilter('shops', '1=1', '', 0, 0)) shopName[s.id] = s.getString('name');
  const oids = {};
  for (const o of app.findRecordsByFilter('orders', 'number ~ {:q} || buyer_name ~ {:q} || buyer_email ~ {:q} || note ~ {:q}', '-placed_at', 6, 0, { q: q })) oids[o.id] = o;
  for (const r of U.rows(app, 'SELECT DISTINCT order_ref AS id FROM order_lines WHERE title LIKE {:like} OR sku LIKE {:like} LIMIT 6', { like: '%' + q + '%' }, { id: '' })) if (!oids[r.id] && Object.keys(oids).length < 10) oids[r.id] = app.findRecordById('orders', r.id);
  const orders = Object.keys(oids).map((id) => {
    const o = oids[id];
    return { id: o.id, number: o.getString('number'), buyer: o.getString('buyer_name'), status: o.getString('status'), shop: o.getString('shop'), shop_name: shopName[o.getString('shop')] || '' };
  });
  const pids = {};
  for (const r of U.rows(app, 'SELECT p.id AS id FROM products p LEFT JOIN variants v ON v.product = p.id WHERE p.title LIKE {:like} OR v.sku LIKE {:like} OR v.barcode = {:q} GROUP BY p.id LIMIT 6', { like: '%' + q + '%', q: q }, { id: '' })) pids[r.id] = true;
  const products = Object.keys(pids).map((id) => {
    const r = app.findRecordById('products', id);
    return { id: id, title: r.getString('title'), image: L('lib_stock').firstImage(r) };
  });
  const customers = app.findRecordsByFilter('customers', 'name ~ {:q} || email ~ {:q} || phone ~ {:q}', '-created', 6, 0, { q: q }).map((c) => ({ id: c.id, name: c.getString('name'), email: c.getString('email') }));
  const threads = app.findRecordsByFilter('threads', 'subject ~ {:q} || customer.name ~ {:q} || order_ref.number ~ {:q}', '-last_at', 6, 0, { q: q }).map((t) => ({ id: t.id, subject: t.getString('subject'), status: t.getString('status') }));
  return { orders: orders, products: products, customers: customers, threads: threads };
}

/** Remove buyer addresses and phone numbers from orders finished more than pii_days ago. */
function purge(app) {
  const U = L('lib_util');
  const days = L('lib_store').settings(app).getInt('pii_days') || 30;
  const before = U.addDays('', -days);
  let n = 0;
  for (const o of app.findRecordsByFilter('orders', "purged = false && ((status = 'delivered' && delivered_at != '' && delivered_at < {:t}) || (status = 'cancelled' && ((cancelled_at != '' && cancelled_at < {:t}) || (cancelled_at = '' && placed_at < {:t}))) || (status = 'returned' && placed_at < {:t}))", '', 0, 0, { t: before })) {
    o.set('address', {});
    o.set('buyer_phone', '');
    o.set('purged', true);
    app.save(o);
    n++;
  }
  if (n > 0) L('lib_store').log(app, 'system', 'Removed the addresses and phone numbers of ' + n + ' finished order' + (n === 1 ? '' : 's') + ' (kept for ' + days + ' days)', '');
  return n;
}

/** Everything in the store as one JSON document (your own backup or a move elsewhere). */
function exportAll(ctx) {
  const app = ctx.app;
  const out = { exported_at: L('lib_util').now() };
  for (const c of ['settings', 'shops', 'products', 'variants', 'stock_moves', 'listings', 'customers', 'orders', 'order_lines', 'shipments', 'threads', 'messages', 'proposals']) {
    out[c] = app.findRecordsByFilter(c, '1=1', 'created', 0, 0).map((r) => r.publicExport());
  }
  return out;
}

/** An amount in another currency at the store's rates (stored as 1 base = rate). */
function convert(ctx, p) {
  const U = L('lib_util');
  const t = L('lib_store').fxTable(ctx.app);
  const from = String(p.from || t.home).trim().toUpperCase();
  const to = String(p.to || '').trim().toUpperCase();
  const amount = Number(p.amount);
  if (!isFinite(amount)) throw U.fail(400, 'amount must be a number, e.g. 97.90.', 'invalid_param', { param: 'amount' });
  const rateOf = (c) => (c === t.home ? 1 : t.base === t.home ? t.rates[c] : undefined);
  for (const c of [from, to]) {
    if (!(rateOf(c) > 0)) throw U.fail(404, 'No exchange rate for ' + c + ' yet: run settings.fx-refresh, or check the code (ISO 4217, e.g. SGD).', 'not_found', { param: c === from ? 'from' : 'to' });
  }
  const rate = rateOf(to) / rateOf(from);
  return { amount: amount, from: from, to: to, result: Number((amount * rate).toFixed(U.exp(to))), rate: Number(rate.toPrecision(6)), date: t.date };
}

module.exports = { convert: convert, settingsGet: settingsGet, settingsUpdate: settingsUpdate, autonomy: autonomy, fxRefresh: fxRefresh, status: status, activity: activity, search: search, purge: purge, exportAll: exportAll };
