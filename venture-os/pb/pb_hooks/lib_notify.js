/// <reference path="../pb_data/types.d.ts" />
/**
 * In-app notifications per member (the bell). Things a person must decide
 * belong in Next (lib_next); a notification only tells.
 *
 *   notify(app, memberIds, { kind, title, body, link, facts, ref })   -> ids
 *       (facts: lib_util.facts shape; with `ref`, an unread notification
 *        with the same ref for the same person is not repeated)
 *   toRole(app, roleCode, { ... })            every active member with the role
 *   toLevel(app, module, level, { ... })      every active member with that level (owners too)
 *
 * Titles never carry amounts or founders' private details: a title may be
 * shown on a phone's lock screen by the platform.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/** A link is an in-app route only: '#/' and path characters, never a scheme or a host. */
function safeLink(text) {
  const t = String(text || '').trim();
  if (t === '') return '';
  if (!/^#\/[A-Za-z0-9\-._~\/?=&%]*$/.test(t) || t.indexOf('//') >= 0) return '';
  return t;
}

function notify(app, memberIds, n) {
  const util = u();
  const out = [];
  const seen = {};
  for (const id of memberIds || []) {
    if (!id || seen[id]) continue;
    seen[id] = true;
    const m = util.byId(app, 'members', id);
    if (m === null || m.getString('status') !== 'active') continue;
    if (n.ref && util.findOne(app, 'notifications', 'member = {:m} && ref = {:r} && read = false', { m: id, r: String(n.ref) }) !== null) continue;
    const r = util.newRecord(app, 'notifications');
    r.set('member', id);
    r.set('kind', util.clip(n.kind || 'info', 40));
    r.set('title', util.clip(n.title || '', 200));
    r.set('body', util.clip(n.body || '', 2000));
    r.set('link', safeLink(n.link));
    r.set('facts', util.facts(n.facts));
    r.set('ref', util.clip(n.ref || '', 200));
    r.set('read', false);
    app.save(r);
    out.push(r.id);
  }
  return out;
}

function toRole(app, roleCode, n) {
  const role = require(`${__hooks}/lib_auth.js`).roleByCode(app, roleCode);
  if (role === null) return [];
  return notify(
    app,
    u()
      .findMany(app, 'members', "role = {:r} && status = 'active'", '', 0, { r: role.id })
      .map((m) => m.id),
    n,
  );
}

function toLevel(app, module, level, n) {
  return notify(app, require(`${__hooks}/lib_auth.js`).membersWith(app, module, level), n);
}

function view(r) {
  return { id: r.id, kind: r.getString('kind'), title: r.getString('title'), body: r.getString('body'), link: r.getString('link'), facts: u().jsonOf(r, 'facts', []) || [], read: r.getBool('read'), created: r.getString('created') };
}

function list(ctx, p) {
  const util = u();
  if (ctx.member === null) return { notifications: [], unread: 0, total: 0 };
  const pg = util.page(p, 30, 200);
  const unreadOnly = util.bool(p, 'unread', false);
  const where = 'member = {:m}' + (unreadOnly ? ' && read = false' : '');
  const rows = util.findMany(ctx.app, 'notifications', where, '-created', pg.limit + pg.offset, { m: ctx.memberId }).slice(pg.offset);
  return {
    notifications: rows.map(view),
    unread: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m} AND read = FALSE', { m: ctx.memberId }),
    total: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m}', { m: ctx.memberId }),
  };
}

function read(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'notifications', util.req(p, 'notification'));
  if (r === null || r.getString('member') !== ctx.memberId) throw util.fail(404, 'No such notification.', 'not_found');
  r.set('read', util.bool(p, 'read', true));
  ctx.app.save(r);
  ctx.audited = true;
  return { notification: view(r) };
}

function readAll(ctx) {
  if (ctx.member === null) return { updated: 0 };
  const util = u();
  const n = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m} AND read = FALSE', { m: ctx.memberId });
  util.exec(ctx.app, 'UPDATE notifications SET read = TRUE WHERE member = {:m} AND read = FALSE', { m: ctx.memberId });
  require(`${__hooks}/lib_bus.js`).touch('notifications');
  ctx.audited = true;
  return { updated: n };
}

module.exports = { notify: notify, toRole: toRole, toLevel: toLevel, safeLink: safeLink, view: view, list: list, read: read, readAll: readAll };
