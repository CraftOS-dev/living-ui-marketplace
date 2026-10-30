/// <reference path="../pb_data/types.d.ts" />
/**
 * One inbox for buyers on every shop.
 *
 * A thread is one buyer conversation; each buyer message starts the shop's
 * reply clock (its "reply within" hours) and each answer stops it. Your AI
 * agent drafts replies (with the reasons and the order facts it used); you
 * edit and send. Store OS cannot post into a marketplace's chat itself, so a
 * reply goes out one of two honest ways:
 *
 *   copied   you paste it into the seller centre (the app copies it and opens
 *            the shop's seller centre), and it is recorded as sent
 *   agent    your AI agent sends it (seller centre in its browser, or email
 *            and chat apps it is connected to) and confirms; until then the
 *            message shows "sending"
 *
 * Your AI agent sends on its own only when you set replies to automatic.
 */

const VIEWS = ['due', 'to_draft', 'drafted', 'waiting', 'open', 'closed', 'all'];
const INTENTS = ['where_is_order', 'return', 'refund', 'cancel', 'change_address', 'product_question', 'complaint', 'other'];
const CHANNELS = ['chat', 'email', 'whatsapp', 'phone', 'social', 'other'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

function ref(app, value) {
  const U = L('lib_util');
  const t = U.byId(app, 'threads', String(value || '').trim());
  if (t === null) throw U.fail(404, 'No conversation ' + value + '. Run inbox.list.', 'not_found');
  return t;
}

/**
 * Warnings about a reply before it goes out (marketplaces penalise contact
 * details and links). A phone number is a run of digits written the way
 * phones are (starting with + or 0, 9 to 13 digits); the shop's own order
 * and tracking numbers in `known` never count.
 */
function lint(text, chat, known) {
  const out = [];
  const t = String(text || '');
  if (t.trim() === '') return out;
  if (chat === 'marketplace') {
    if (/(https?:\/\/|www\.)\S+/i.test(t)) out.push('Has a link: marketplaces penalise links that take buyers off the platform.');
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t)) out.push('Has an email address: marketplaces penalise contact details in buyer messages.');
    const own = {};
    for (const k of known || []) own[String(k).replace(/[^0-9]/g, '')] = true;
    const runs = t.match(/\+?\d[\d\s-]{7,}\d/g) || [];
    const phone = runs.some((m) => {
      const digits = m.replace(/[^0-9]/g, '');
      if (own[digits]) return false;
      return digits.length >= 9 && digits.length <= 13 && (m.charAt(0) === '+' || digits.charAt(0) === '0');
    });
    if (phone) out.push('Has what looks like a phone number: marketplaces penalise contact details in buyer messages.');
  }
  if (t.length > 2000) out.push('Long reply: buyers read short answers.');
  return out;
}

/** The order and tracking numbers a conversation may quote. */
function knownNumbers(app, t) {
  const out = [];
  const ids = [];
  if (t.getString('order_ref')) ids.push(t.getString('order_ref'));
  if (t.getString('customer')) for (const o of app.findRecordsByFilter('orders', 'customer = {:c}', '-placed_at', 20, 0, { c: t.getString('customer') })) ids.push(o.id);
  for (const id of ids) {
    const o = L('lib_util').byId(app, 'orders', id);
    if (o === null) continue;
    out.push(o.getString('number'));
    for (const s of app.findRecordsByFilter('shipments', 'order_ref = {:o}', '', 0, 0, { o: id })) out.push(s.getString('tracking'));
  }
  return out;
}

function msgView(m) {
  return { id: m.id, direction: m.getString('direction'), author: m.getString('author'), body: m.getString('body'), via: m.getString('via'), state: m.getString('state') || 'sent', error: m.getString('error'), at: m.getString('at') || m.getString('created').replace(' ', 'T') };
}

function threadRow(app, t, shopsMap, tasks) {
  const U = L('lib_util');
  const shop = t.getString('shop') ? (shopsMap && shopsMap[t.getString('shop')]) || U.byId(app, 'shops', t.getString('shop')) : null;
  const cust = t.getString('customer') ? U.byId(app, 'customers', t.getString('customer')) : null;
  const order = t.getString('order_ref') ? U.byId(app, 'orders', t.getString('order_ref')) : null;
  const last = app.findRecordsByFilter('messages', "thread = {:t} && direction != 'note'", '-at', 1, 0, { t: t.id });
  const lm = last.length > 0 ? last[0] : null;
  return {
    id: t.id,
    shop: shop ? { id: shop.id, name: shop.getString('name'), platform: shop.getString('platform') } : null,
    customer: cust ? { id: cust.id, name: cust.getString('name') } : null,
    buyer: cust ? cust.getString('name') : '',
    order: order ? { id: order.id, number: order.getString('number'), status: order.getString('status') } : null,
    subject: t.getString('subject'),
    channel: t.getString('channel') || 'chat',
    status: t.getString('status') || 'open',
    intent: t.getString('intent'),
    due_at: t.getString('due_at'),
    hours_left: t.getString('status') === 'open' ? U.hoursUntil(t.getString('due_at')) : null,
    last_at: t.getString('last_at'),
    unread: t.getBool('unread'),
    snippet: lm ? U.clip(lm.getString('body'), 140) : '',
    last_from: lm ? lm.getString('author') : '',
    has_draft: t.getString('draft').trim() !== '',
    draft_by: t.getString('draft_by'),
    task: tasks ? tasks['thread:' + t.id] || null : null,
  };
}

function shopsMapOf(app) {
  const out = {};
  for (const s of app.findRecordsByFilter('shops', '1=1', '', 0, 0)) out[s.id] = s;
  return out;
}

/* ------------------------------------------------------------------ reads */

function list(ctx, p) {
  const app = ctx.app;
  const view = p.view || 'due';
  const shopId = p.shop ? L('lib_shops').ref(app, p.shop).id : '';
  const q = String(p.q || '').trim().toLowerCase();
  const shops = shopsMapOf(app);
  const tasks = L('lib_tasks').openMap(app);
  const all = app.findRecordsByFilter('threads', shopId !== '' ? 'shop = {:s}' : '1=1', '-last_at', 0, 0, { s: shopId }).map((t) => threadRow(app, t, shops, tasks));
  const counts = {};
  for (const v of VIEWS) counts[v] = 0;
  const picked = [];
  for (const r of all) {
    if (q !== '' && (r.subject + ' ' + r.buyer + ' ' + r.snippet + ' ' + (r.order ? r.order.number : '')).toLowerCase().indexOf(q) < 0) continue;
    const inView = { due: r.status === 'open', to_draft: r.status === 'open' && !r.has_draft, drafted: r.status === 'open' && r.has_draft, waiting: r.status === 'waiting', open: r.status === 'open', closed: r.status === 'closed', all: true };
    for (const v of VIEWS) if (inView[v]) counts[v]++;
    if (inView[view]) picked.push(r);
  }
  if (view === 'due' || view === 'to_draft' || view === 'drafted' || view === 'open') picked.sort((a, b) => (a.due_at || '9') < (b.due_at || '9') ? -1 : 1);
  const limit = Math.min(Math.max(Math.round(p.limit || 100), 1), 500);
  return { view: view, total: picked.length, counts: counts, threads: picked.slice(0, limit) };
}

function get(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const t = ref(app, p.thread);
  if (!ctx.isAgent && t.getBool('unread')) {
    t.set('unread', false);
    app.save(t);
  }
  const row = threadRow(app, t, null, L('lib_tasks').openMap(app));
  const shop = t.getString('shop') ? U.byId(app, 'shops', t.getString('shop')) : null;
  const sv = shop ? L('lib_shops').view(app, shop, null, null) : null;
  const O = L('lib_orders');
  const order = t.getString('order_ref') ? U.byId(app, 'orders', t.getString('order_ref')) : null;
  // The buyer's other orders (the linked one is order_detail already).
  const custOrders = t.getString('customer') ? app.findRecordsByFilter('orders', 'customer = {:c} && id != {:o}', '-placed_at', 8, 0, { c: t.getString('customer'), o: t.getString('order_ref') }).map((o) => O.rowView(app, o, null, null, null)) : [];
  const cust = t.getString('customer') ? U.byId(app, 'customers', t.getString('customer')) : null;
  return {
    thread: Object.assign(row, {
      messages: app.findRecordsByFilter('messages', 'thread = {:t}', 'at,created', 0, 0, { t: t.id }).map(msgView),
      draft: t.getString('draft'),
      draft_why: t.getString('draft_why'),
      draft_at: t.getString('draft_at'),
      draft_lint: lint(t.getString('draft'), sv ? sv.chat : '', knownNumbers(app, t)),
      suggested_orders: order === null ? suggest(app, t, custOrders) : [],
      external_id: t.getString('external_id'),
      customer_detail: cust ? { id: cust.id, name: cust.getString('name'), email: cust.getString('email'), phone: cust.getString('phone'), note: cust.getString('note') } : null,
      order_detail: order ? O.detail(app, order, ctx.isAgent) : null,
      customer_orders: custOrders,
      shop_detail: sv ? { id: sv.id, name: sv.name, platform: sv.platform, platform_name: sv.platform_name, chat: sv.chat, admin_url: sv.admin_url, reply_hours: sv.reply_hours, policies: sv.policies } : null,
    }),
  };
}

/**
 * More orders a conversation with no linked order may be about, beyond the
 * buyer's own (customer_orders): same-name buyers on the same shop, newest first.
 */
function suggest(app, t, custOrders) {
  const O = L('lib_orders');
  const c = t.getString('customer') ? L('lib_util').byId(app, 'customers', t.getString('customer')) : null;
  if (c === null || c.getString('name') === '' || t.getString('shop') === '') return [];
  const seen = {};
  for (const r of custOrders) seen[r.id] = true;
  return app
    .findRecordsByFilter('orders', 'buyer_name = {:n} && shop = {:s}', '-placed_at', 10, 0, { n: c.getString('name'), s: t.getString('shop') })
    .filter((o) => !seen[o.id])
    .slice(0, 5)
    .map((o) => O.rowView(app, o, null, null, null));
}

/* ----------------------------------------------------------------- writes */

function touchIn(app, t, at, reopen) {
  const U = L('lib_util');
  const shop = t.getString('shop') ? U.byId(app, 'shops', t.getString('shop')) : null;
  const hours = shop && shop.getInt('reply_hours') > 0 ? shop.getInt('reply_hours') : 24;
  if (!t.getString('last_at') || at >= t.getString('last_at')) {
    t.set('last_at', at);
    t.set('due_at', new Date(new Date(at).getTime() + hours * 3600000).toISOString());
    if (reopen !== false) t.set('status', 'open');
    t.set('unread', true);
  }
}

function touchOut(t, at) {
  if (!t.getString('last_at') || at >= t.getString('last_at')) {
    t.set('last_at', at);
    t.set('due_at', '');
    if (t.getString('status') !== 'closed') t.set('status', 'waiting');
    t.set('unread', false);
  }
}

function newMessage(app, t, direction, author, body, via, state, at, externalId) {
  const U = L('lib_util');
  const m = U.newRecord(app, 'messages');
  m.set('thread', t.id);
  m.set('direction', direction);
  m.set('author', author);
  m.set('body', U.clip(body, 20000));
  m.set('via', via);
  m.set('state', state);
  m.set('at', at);
  m.set('external_id', U.clip(externalId || '', 120));
  app.save(m);
  return m;
}

function orderFor(app, value, shopId) {
  if (!value) return null;
  try {
    return L('lib_orders').ref(app, value, shopId || '');
  } catch {
    return null;
  }
}

/** Log a buyer message (one you got by email, chat or phone), starting a conversation or adding to one. */
function add(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const text = String(p.text || '').trim();
  if (text === '') throw U.fail(400, 'Give the buyer\'s message in --text.', 'missing_param', { param: 'text' });
  const at = p.at ? U.isoDate(p.at, 'at') : U.now();
  let t;
  if (p.thread) t = ref(app, p.thread);
  else {
    const shop = p.shop ? L('lib_shops').ref(app, p.shop) : U.findOne(app, 'shops', "platform = 'direct'", {});
    t = U.newRecord(app, 'threads');
    t.set('shop', shop ? shop.id : '');
    t.set('channel', p.channel ? U.oneOf(p.channel, CHANNELS, 'channel') : shop && shop.getString('platform') === 'direct' ? 'whatsapp' : 'chat');
    t.set('subject', U.clip(p.subject || text.split('\n')[0], 300));
    t.set('status', 'open');
    const c = L('lib_customers').match(app, { name: p.buyer_name, email: p.buyer_email, phone: p.buyer_phone, shop: shop ? shop.id : '' });
    if (c !== null) t.set('customer', c.id);
    const o = orderFor(app, p.order, shop ? shop.id : '');
    if (o !== null) {
      t.set('order_ref', o.id);
      if (t.getString('customer') === '' && o.getString('customer') !== '') t.set('customer', o.getString('customer'));
    }
    if (p.intent) t.set('intent', U.oneOf(p.intent, INTENTS, 'intent'));
    app.save(t);
  }
  const dir = p.direction === 'out' ? 'out' : 'in';
  newMessage(app, t, dir, dir === 'in' ? 'buyer' : 'you', text, 'manual', 'sent', at, '');
  if (dir === 'in') touchIn(app, t, at);
  else touchOut(t, at);
  app.save(t);
  return get(ctx, { thread: t.id });
}

/**
 * Conversations from a sync: [{thread, buyer_name, buyer_email, buyer_phone,
 * order, subject, channel, messages: [{id, direction: in|out, text, at}]}].
 * Threads match on the shop's conversation id, messages on their own id, so
 * a replayed batch adds nothing twice.
 */
function addMany(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const shop = L('lib_shops').ref(app, p.shop);
  const items = U.list(p.items, 'items');
  if (items.length === 0) throw U.fail(400, 'Give --items as a JSON list of conversations (see app.guide, "conversation rows").', 'missing_param', { param: 'items' });
  const out = { threads_new: 0, messages_new: 0, skipped: 0, problems: [], new_threads: [] };
  items.forEach((it, i) => {
    try {
      const ext = String(it.thread || it.id || '').trim();
      let t = ext !== '' ? U.findOne(app, 'threads', 'shop = {:s} && external_id = {:x}', { s: shop.id, x: ext }) : null;
      const msgs = U.list(it.messages, 'messages');
      if (t === null) {
        t = U.newRecord(app, 'threads');
        t.set('shop', shop.id);
        t.set('external_id', U.clip(ext, 120));
        t.set('channel', it.channel ? U.oneOf(it.channel, CHANNELS, 'channel') : 'chat');
        t.set('subject', U.clip(it.subject || (msgs.length > 0 ? String(msgs[0].text || '').split('\n')[0] : 'Conversation'), 300));
        t.set('status', 'open');
        const c = L('lib_customers').match(app, { name: it.buyer_name, email: it.buyer_email, phone: it.buyer_phone, shop: shop.id });
        if (c !== null) t.set('customer', c.id);
        app.save(t);
        out.threads_new++;
        out.new_threads.push(t.id);
      }
      const o = orderFor(app, it.order, shop.id);
      if (o !== null && t.getString('order_ref') === '') {
        t.set('order_ref', o.id);
        if (t.getString('customer') === '' && o.getString('customer') !== '') t.set('customer', o.getString('customer'));
      }
      for (const m of msgs) {
        const mid = String(m.id || '').trim();
        const at = m.at ? U.isoDate(m.at, 'at') : U.now();
        const body = String(m.text || '').trim();
        if (body === '') continue;
        if (mid !== '' && U.findOne(app, 'messages', 'thread = {:t} && external_id = {:x}', { t: t.id, x: mid }) !== null) continue;
        if (mid === '' && U.findOne(app, 'messages', 'thread = {:t} && at = {:a} && body = {:b}', { t: t.id, a: at, b: body }) !== null) continue;
        const dir = m.direction === 'out' ? 'out' : 'in';
        newMessage(app, t, dir, dir === 'in' ? 'buyer' : 'you', body, 'import', 'sent', at, mid);
        if (dir === 'in') touchIn(app, t, at);
        else touchOut(t, at);
        out.messages_new++;
      }
      app.save(t);
    } catch (err) {
      out.skipped++;
      out.problems.push('Item ' + (i + 1) + ': ' + String((err && err.message) || err));
    }
  });
  if (out.messages_new > 0) L('lib_store').log(app, ctx.actor, out.messages_new + ' buyer message' + (out.messages_new === 1 ? '' : 's') + ' from ' + shop.getString('name'), 'shop:' + shop.id);
  return out;
}

function draft(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const t = ref(app, p.thread);
  t.set('draft', U.clip(String(p.text || ''), 10000));
  t.set('draft_by', ctx.isAgent ? 'agent' : 'you');
  t.set('draft_why', U.clip(p.why || '', 2000));
  t.set('draft_at', U.now());
  if (p.intent) t.set('intent', U.oneOf(p.intent, INTENTS, 'intent'));
  app.save(t);
  if (ctx.isAgent) L('lib_tasks').finishFor(app, 'thread:' + t.id, 'draft_reply', 'Draft ready');
  const sv = t.getString('shop') ? L('lib_shops').view(app, app.findRecordById('shops', t.getString('shop')), null, null) : null;
  return { thread: t.id, draft: t.getString('draft'), lint: lint(t.getString('draft'), sv ? sv.chat : '', knownNumbers(app, t)) };
}

/** You send a reply: recorded as sent (pasted into the seller centre), or handed to your AI agent to send. */
function reply(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const t = ref(app, p.thread);
  const text = String(p.text || '').trim();
  if (text === '') throw U.fail(400, 'Write the reply in --text.', 'missing_param', { param: 'text' });
  const mode = U.oneOf(p.mode || 'copied', ['copied', 'agent', 'manual'], 'mode');
  const at = U.now();
  const m = newMessage(app, t, 'out', 'you', text, mode, mode === 'agent' ? 'sending' : 'sent', at, '');
  touchOut(t, at);
  t.set('draft', '');
  t.set('draft_why', '');
  t.set('draft_by', '');
  if (p.close === true) t.set('status', 'closed');
  app.save(t);
  let task = null;
  if (mode === 'agent') task = L('lib_tasks').queue(app, 'send_reply', 'thread:' + t.id, 'Send a reply to ' + (threadRow(app, t, null, null).buyer || 'a buyer') + ': ' + U.clip(text, 80), { thread: t.id, message: m.id }, ctx.actor);
  L('lib_store').log(app, ctx.actor, (mode === 'agent' ? 'Asked your AI agent to send a reply in "' : 'Replied in "') + U.clip(t.getString('subject'), 80) + '"', 'thread:' + t.id);
  return { message: msgView(m), task: task };
}

/** Your AI agent sent a message: confirm a reply you handed it, or (replies set to automatic) record its own. */
function sent(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  if (p.message) {
    const m = U.byId(app, 'messages', String(p.message));
    if (m === null) throw U.fail(404, 'No message ' + p.message + '.', 'not_found');
    m.set('state', 'sent');
    m.set('error', '');
    app.save(m);
    L('lib_tasks').finishFor(app, 'thread:' + m.getString('thread'), 'send_reply', 'Sent');
    return { message: msgView(m) };
  }
  const t = ref(app, p.thread);
  if (!L('lib_store').autoAllowed(app, 'replies')) throw U.fail(403, 'Replies are set to "ask me": write the reply with inbox.draft and the seller sends it.', 'agent_not_permitted');
  const text = String(p.text || '').trim();
  if (text === '') throw U.fail(400, 'Give the text you sent in --text.', 'missing_param', { param: 'text' });
  const at = p.at ? U.isoDate(p.at, 'at') : U.now();
  const m = newMessage(app, t, 'out', 'agent', text, 'agent', 'sent', at, '');
  touchOut(t, at);
  t.set('draft', '');
  t.set('draft_why', '');
  app.save(t);
  L('lib_store').log(app, 'agent', 'Your AI agent replied in "' + U.clip(t.getString('subject'), 80) + '"', 'thread:' + t.id);
  return { message: msgView(m) };
}

function sendFailed(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const m = U.byId(app, 'messages', String(p.message || ''));
  if (m === null) throw U.fail(404, 'No message ' + p.message + '.', 'not_found');
  m.set('state', 'failed');
  m.set('error', U.clip(p.error || '', 500));
  app.save(m);
  const t = app.findRecordById('threads', m.getString('thread'));
  t.set('status', 'open');
  app.save(t);
  L('lib_tasks').finishFor(app, 'thread:' + t.id, 'send_reply', p.error || 'Could not send', true);
  return { message: msgView(m) };
}

function note(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const t = ref(app, p.thread);
  const text = String(p.text || '').trim();
  if (text === '') throw U.fail(400, 'Write the note in --text.', 'missing_param', { param: 'text' });
  const m = newMessage(app, t, 'note', ctx.isAgent ? 'agent' : 'you', text, 'app', 'sent', U.now(), '');
  return { message: msgView(m) };
}

function update(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const t = ref(app, p.thread);
  if (p.status !== undefined) {
    t.set('status', U.oneOf(p.status, ['open', 'waiting', 'closed'], 'status'));
    if (p.status !== 'open') t.set('due_at', '');
  }
  if (p.intent !== undefined) t.set('intent', p.intent === '' ? '' : U.oneOf(p.intent, INTENTS, 'intent'));
  if (p.subject !== undefined) t.set('subject', U.clip(p.subject, 300));
  if (p.order !== undefined) {
    const o = p.order === '' ? null : L('lib_orders').ref(app, p.order, t.getString('shop'));
    t.set('order_ref', o ? o.id : '');
  }
  app.save(t);
  return get(ctx, { thread: t.id });
}

function requestDraft(ctx, p) {
  const U = L('lib_util');
  const app = ctx.app;
  const t = ref(app, p.thread);
  const row = threadRow(app, t, null, null);
  const task = L('lib_tasks').queue(app, 'draft_reply', 'thread:' + t.id, 'Draft a reply to ' + (row.buyer || 'a buyer') + ': ' + U.clip(t.getString('subject'), 80), { thread: t.id, note: U.clip(p.note || '', 1000) }, ctx.actor);
  return { task: task };
}

function requestDraftAll(ctx) {
  const app = ctx.app;
  let n = 0;
  for (const t of app.findRecordsByFilter('threads', "status = 'open' && draft = ''", 'due_at', 50, 0)) {
    requestDraft(ctx, { thread: t.id });
    n++;
  }
  return { asked: n };
}

module.exports = {
  VIEWS: VIEWS,
  INTENTS: INTENTS,
  CHANNELS: CHANNELS,
  lint: lint,
  list: list,
  get: get,
  add: add,
  addMany: addMany,
  draft: draft,
  reply: reply,
  sent: sent,
  sendFailed: sendFailed,
  note: note,
  update: update,
  requestDraft: requestDraft,
  requestDraftAll: requestDraftAll,
};
