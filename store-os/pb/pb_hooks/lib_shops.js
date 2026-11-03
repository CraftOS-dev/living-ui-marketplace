/// <reference path="../pb_data/types.d.ts" />
/**
 * Shops: one per shop on one platform (two Shopee shops are two shops), plus
 * the Direct shop for orders taken in chat, on social media or in person.
 *
 * A shop carries what the rest of the app needs to treat it right: its
 * currency, the fees it charges (to estimate profit before the payout says),
 * how many days you have to ship, how fast buyers expect a reply, the stock
 * rule (what share of what you have to show on it), the policies your AI
 * agent quotes, the setup checklist and how its data comes in:
 *
 *   agent    your AI agent syncs it (the platform's integration or its seller
 *            centre in your AI agent's browser)
 *   files    you import the platform's order and product exports
 *   manual   you add orders yourself
 */

const CONNECTIONS = ['agent', 'files', 'manual'];
const STATUSES = ['setting_up', 'active', 'paused'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** A shop by id or by name (any case). */
function ref(app, value) {
  const U = L('lib_util');
  const v = String(value || '').trim();
  if (v === '') throw U.fail(400, 'Name the shop with --shop <id or name>. Run shops.list.', 'missing_param', { param: 'shop' });
  const byId = U.byId(app, 'shops', v);
  if (byId !== null) return byId;
  const all = app.findRecordsByFilter('shops', '1=1', 'sort,created', 0, 0);
  for (const s of all) if (s.getString('name').toLowerCase() === v.toLowerCase()) return s;
  throw U.fail(404, 'No shop "' + v + '". Shops: ' + all.map((s) => s.getString('name') + ' (' + s.id + ')').join(', ') + '.', 'not_found');
}

function policiesOf(r) {
  const p = L('lib_util').json(r, 'policies', {});
  return { returns: String(p.returns || ''), shipping: String(p.shipping || ''), faq: String(p.faq || ''), voice: String(p.voice || '') };
}

function stepsOf(r) {
  const P = L('lib_platforms');
  const done = L('lib_util').json(r, 'setup', {});
  return P.steps(r.getString('platform'), r.getString('region')).map((s) => Object.assign({}, s, { done: done[s.key] ? true : false, done_at: typeof done[s.key] === 'string' ? done[s.key] : '' }));
}

function brief(app, r) {
  return { id: r.id, name: r.getString('name'), platform: r.getString('platform'), currency: r.getString('currency') || L('lib_store').baseOrEmpty(app), region: r.getString('region') };
}

function view(app, r, counts, tasks) {
  const U = L('lib_util');
  const P = L('lib_platforms');
  const plat = P.get(r.getString('platform'));
  const cur = r.getString('currency') || L('lib_store').baseOrEmpty(app);
  const steps = stepsOf(r);
  const c = (counts && counts[r.id]) || {};
  const task = tasks ? tasks['shop:' + r.id] || null : null;
  return {
    id: r.id,
    name: r.getString('name'),
    platform: r.getString('platform'),
    platform_name: plat ? plat.name : r.getString('platform'),
    kind: plat ? plat.kind : 'store',
    chat: plat ? plat.chat : 'email',
    region: r.getString('region'),
    currency: cur,
    url: r.getString('url'),
    admin_url: r.getString('admin_url') || (plat ? P.linkOf(plat.admin, r.getString('region')) : ''),
    status: r.getString('status') || 'active',
    connection: r.getString('connection') || 'manual',
    commission_pct: r.getInt('commission_bps') / 100,
    payment_pct: r.getInt('payment_bps') / 100,
    fixed_fee: U.toMajor(r.getInt('fixed_fee_minor'), cur),
    ship_days: r.getInt('ship_days'),
    reply_hours: r.getInt('reply_hours'),
    stock_share: r.getInt('stock_share'),
    stock_buffer: r.getInt('stock_buffer'),
    stock_max: r.getInt('stock_max'),
    title_max: plat ? plat.title_max : 0,
    policies: policiesOf(r),
    setup: { done: steps.filter((s) => s.done).length, total: steps.length },
    sync_at: r.getString('sync_at'),
    sync_note: r.getString('sync_note'),
    to_ship: c.to_ship || 0,
    late: c.late || 0,
    open_threads: c.threads || 0,
    live_listings: c.live || 0,
    task: task,
    sort: r.getInt('sort'),
  };
}

/** Counts per shop for list views. */
function counts(app) {
  const out = {};
  const bump = (shop, k, n) => {
    if (!out[shop]) out[shop] = {};
    out[shop][k] = (out[shop][k] || 0) + n;
  };
  const U = L('lib_util');
  const now = new Date().toISOString();
  const rows = U.rows(app, "SELECT shop, COUNT(*) AS n, COALESCE(SUM(CASE WHEN ship_by != '' AND ship_by < {:now} THEN 1 ELSE 0 END), 0) AS late FROM orders WHERE status = 'to_ship' GROUP BY shop", { now: now }, { shop: '', n: 0, late: 0 });
  for (const r of rows) {
    bump(r.shop, 'to_ship', r.n);
    bump(r.shop, 'late', r.late);
  }
  for (const r of U.rows(app, "SELECT shop, COUNT(*) AS n FROM threads WHERE status = 'open' GROUP BY shop", {}, { shop: '', n: 0 })) bump(r.shop, 'threads', r.n);
  for (const r of U.rows(app, "SELECT shop, COUNT(*) AS n FROM listings WHERE status = 'live' GROUP BY shop", {}, { shop: '', n: 0 })) bump(r.shop, 'live', r.n);
  return out;
}

/* ------------------------------------------------------------------- ops */

function platforms() {
  return L('lib_platforms').catalog();
}

function list(ctx) {
  const app = ctx.app;
  const c = counts(app);
  const t = L('lib_tasks').openMap(app);
  return { shops: app.findRecordsByFilter('shops', '1=1', 'sort,created', 0, 0).map((r) => view(app, r, c, t)) };
}

function get(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.shop);
  const c = counts(app);
  const t = L('lib_tasks').openMap(app);
  const v = view(app, r, c, t);
  v.steps = stepsOf(r);
  v.imports = app.findRecordsByFilter('imports', 'shop = {:s}', '-created', 8, 0, { s: r.id }).map((i) => ({ id: i.id, kind: i.getString('kind'), file_name: i.getString('file_name'), rows: i.getInt('rows'), created_n: i.getInt('created_n'), updated_n: i.getInt('updated_n'), skipped_n: i.getInt('skipped_n'), problems: U.json(i, 'problems', []).length, created: i.getString('created') }));
  v.tasks = app.findRecordsByFilter('tasks', 'target = {:t}', '-created', 8, 0, { t: 'shop:' + r.id }).map((x) => L('lib_tasks').view(x));
  v.stock_plan = L('lib_stock').plan(app, r.id).length;
  v.orders = U.count(app, 'SELECT COUNT(*) AS n FROM orders WHERE shop = {:s}', { s: r.id });
  return { shop: v };
}

function nextSort(app) {
  return L('lib_util').count(app, 'SELECT COALESCE(MAX(sort), 0) AS n FROM shops', {}) + 1;
}

function applyFields(app, r, p) {
  const U = L('lib_util');
  const P = L('lib_platforms');
  if (p.name !== undefined) {
    const name = String(p.name).trim();
    if (name === '') throw U.fail(400, 'A shop needs a name.', 'invalid_param', { param: 'name' });
    for (const s of app.findRecordsByFilter('shops', 'id != {:id}', '', 0, 0, { id: r.id || '' })) if (s.getString('name').toLowerCase() === name.toLowerCase()) throw U.fail(409, 'You already have a shop called "' + name + '". Give this one another name, such as "' + name + ' 2".', 'conflict');
    r.set('name', U.clip(name, 80));
  }
  if (p.region !== undefined) {
    if (p.region !== '' && P.country(p.region) === null) throw U.fail(400, 'region must be a country code: ' + P.COUNTRIES.map((c) => c.code).join(', ') + '.', 'invalid_param', { param: 'region' });
    r.set('region', p.region);
  }
  if (p.currency !== undefined) {
    const cur = String(p.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw U.fail(400, 'currency must be a 3-letter code such as MYR.', 'invalid_param', { param: 'currency' });
    r.set('currency', cur);
  }
  if (p.url !== undefined) r.set('url', U.clip(p.url, 500));
  if (p.admin_url !== undefined) r.set('admin_url', U.clip(p.admin_url, 500));
  if (p.status !== undefined) r.set('status', U.oneOf(p.status, STATUSES, 'status'));
  if (p.connection !== undefined) r.set('connection', U.oneOf(p.connection, CONNECTIONS, 'connection'));
  const pct = (v, what) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw U.fail(400, what + ' must be a percentage from 0 to 100.', 'invalid_param');
    return Math.round(n * 100);
  };
  if (p.commission_pct !== undefined) r.set('commission_bps', pct(p.commission_pct, 'commission_pct'));
  if (p.payment_pct !== undefined) r.set('payment_bps', pct(p.payment_pct, 'payment_pct'));
  const cur = r.getString('currency') || L('lib_store').baseOrEmpty(app);
  if (p.fixed_fee !== undefined) r.set('fixed_fee_minor', U.toMinor(p.fixed_fee, cur, 'fixed_fee'));
  const whole = (v, what, max) => {
    const n = U.int(v, what);
    if (n < 0 || n > max) throw U.fail(400, what + ' must be from 0 to ' + max + '.', 'invalid_param');
    return n;
  };
  if (p.ship_days !== undefined) r.set('ship_days', whole(p.ship_days, 'ship_days', 60));
  if (p.reply_hours !== undefined) r.set('reply_hours', whole(p.reply_hours, 'reply_hours', 720));
  if (p.stock_share !== undefined) r.set('stock_share', whole(p.stock_share, 'stock_share', 100));
  if (p.stock_buffer !== undefined) r.set('stock_buffer', whole(p.stock_buffer, 'stock_buffer', 100000));
  if (p.stock_max !== undefined) r.set('stock_max', whole(p.stock_max, 'stock_max', 1000000));
}

function add(ctx, p) {
  const U = L('lib_util');
  const P = L('lib_platforms');
  const S = L('lib_store');
  const app = ctx.app;
  const plat = P.get(p.platform);
  if (plat === null) throw U.fail(400, 'platform must be one of: ' + P.ids().join(', ') + '.', 'invalid_param', { param: 'platform' });
  if (plat.id === 'direct' && app.findRecordsByFilter('shops', "platform = 'direct'", '', 1, 0).length > 0) throw U.fail(409, 'There is one Direct shop; add your chat and social orders there.', 'conflict');
  const r = U.newRecord(app, 'shops');
  r.set('platform', plat.id);
  // A shop you already run is set up; only a shop being opened gets the checklist.
  const done = {};
  if (p.opening !== true) for (const s of P.steps(plat.id, '')) done[s.key] = U.now();
  r.set('setup', done);
  r.set('policies', {});
  r.set('stock_share', 100);
  r.set('ship_days', plat.ship_days);
  r.set('reply_hours', 24);
  r.set('sort', nextSort(app));
  const region = p.region || S.settings(app).getString('country');
  const country = P.country(region);
  applyFields(app, r, {
    name: p.name || plat.name,
    region: region,
    currency: p.currency || (country ? country.currency : '') || S.base(app),
    url: p.url,
    admin_url: p.admin_url,
    connection: p.connection || (plat.id === 'direct' ? 'manual' : 'agent'),
    status: p.opening === true ? 'setting_up' : 'active',
  });
  app.save(r);
  S.log(app, ctx.actor, (p.opening === true ? 'Started opening ' : 'Added ') + r.getString('name') + ' (' + plat.name + ')', 'shop:' + r.id);
  return get(ctx, { shop: r.id });
}

function update(ctx, p) {
  const app = ctx.app;
  const r = ref(app, p.shop);
  const fields = Object.assign({}, p);
  delete fields.shop;
  applyFields(app, r, fields);
  app.save(r);
  if (fields.commission_pct !== undefined || fields.payment_pct !== undefined || fields.fixed_fee !== undefined) L('lib_orders').refeeShop(app, r.id);
  L('lib_store').log(app, ctx.actor, 'Changed ' + r.getString('name') + ': ' + Object.keys(fields).join(', '), 'shop:' + r.id);
  return get(ctx, { shop: r.id });
}

function policies(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.shop);
  const cur = policiesOf(r);
  for (const k of ['returns', 'shipping', 'faq', 'voice']) if (p[k] !== undefined) cur[k] = U.clip(String(p[k]), 8000);
  r.set('policies', cur);
  app.save(r);
  if ((cur.returns !== '' || cur.shipping !== '') && p.mark_step !== false) {
    const done = U.json(r, 'setup', {});
    if (!done.policies) {
      done.policies = U.now();
      r.set('setup', done);
      app.save(r);
    }
  }
  L('lib_store').log(app, ctx.actor, 'Updated the policies of ' + r.getString('name'), 'shop:' + r.id);
  return { policies: cur };
}

function step(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.shop);
  const keys = stepsOf(r).map((s) => s.key);
  if (keys.indexOf(p.step) < 0) throw U.fail(400, 'step must be one of: ' + keys.join(', ') + '.', 'invalid_param', { param: 'step' });
  const done = U.json(r, 'setup', {});
  if (p.done === false) delete done[p.step];
  else done[p.step] = U.now();
  r.set('setup', done);
  // The checklist done: the shop is open.
  if (keys.every((k) => done[k]) && r.getString('status') === 'setting_up') r.set('status', 'active');
  app.save(r);
  return get(ctx, { shop: r.id });
}

function lookupName(ctx, p) {
  return ref(ctx.app, p.shop).getString('name');
}

function remove(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.shop);
  if (r.getString('platform') === 'direct') throw U.fail(409, 'The Direct shop stays: it holds orders taken in chat and in person.', 'conflict');
  const name = r.getString('name');
  const orders = app.findRecordsByFilter('orders', 'shop = {:s}', '', 0, 0, { s: r.id }).length;
  app.delete(r);
  L('lib_store').log(app, ctx.actor, 'Removed the shop ' + name + (orders > 0 ? ' and its ' + orders + ' orders' : ''), '');
  return { removed: name, orders: orders };
}

/* ------------------------------------------------- work for your AI agent */

function requestSync(ctx, p) {
  const app = ctx.app;
  const r = ref(app, p.shop);
  const T = L('lib_tasks');
  const t = T.queue(app, 'sync', 'shop:' + r.id, 'Sync ' + r.getString('name') + ': new orders, messages and listings', { shop: r.id, platform: r.getString('platform'), since: r.getString('sync_at') }, ctx.actor);
  L('lib_store').log(app, ctx.actor, 'Asked your AI agent to sync ' + r.getString('name'), 'shop:' + r.id);
  return { task: t };
}

function requestHelp(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.shop);
  const s = stepsOf(r).filter((x) => x.key === p.step)[0];
  if (!s) throw U.fail(400, 'No step ' + p.step + ' on this shop.', 'invalid_param', { param: 'step' });
  const t = L('lib_tasks').queue(app, 'setup_help', 'shop:' + r.id, 'Help with "' + s.title + '" for ' + r.getString('name'), { shop: r.id, step: s.key, title: s.title, link: s.link, note: U.clip(p.note || '', 1000) }, ctx.actor);
  return { task: t };
}

function syncFinish(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const r = ref(app, p.shop);
  if (p.failed !== true) r.set('sync_at', U.now());
  r.set('sync_note', U.clip(p.note || '', 2000));
  app.save(r);
  L('lib_tasks').finishFor(app, 'shop:' + r.id, 'sync', p.note || '', p.failed === true);
  L('lib_store').log(app, ctx.actor, (p.failed === true ? 'Could not sync ' : 'Synced ') + r.getString('name') + (p.note ? ': ' + U.clip(p.note, 200) : ''), 'shop:' + r.id);
  return { shop: r.id, name: r.getString('name'), sync_at: r.getString('sync_at'), note: r.getString('sync_note'), task: p.failed === true ? 'failed' : 'done' };
}

module.exports = {
  CONNECTIONS: CONNECTIONS,
  ref: ref,
  view: view,
  brief: brief,
  policiesOf: policiesOf,
  stepsOf: stepsOf,
  counts: counts,
  platforms: platforms,
  list: list,
  get: get,
  add: add,
  update: update,
  policies: policies,
  step: step,
  lookupName: lookupName,
  remove: remove,
  requestSync: requestSync,
  requestHelp: requestHelp,
  syncFinish: syncFinish,
};
