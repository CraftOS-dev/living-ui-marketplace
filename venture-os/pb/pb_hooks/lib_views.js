/// <reference path="../pb_data/types.d.ts" />
/**
 * Saved views: a person's filters, columns and sort for a list or board
 * (page keys such as 'deals.table', 'people.list'), private or shared with
 * the team. The config is the page's own JSON; the kernel keeps it whole.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function view(r, mine) {
  return { id: r.id, page: r.getString('page'), name: r.getString('name'), config: u().jsonOf(r, 'config', {}) || {}, shared: r.getBool('shared'), mine: mine, sort: r.getInt('sort'), member: r.getString('member'), updated: r.getString('updated') };
}

function pageOf(p) {
  const util = u();
  const page = util.req(p, 'page', 'deals.table');
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(page)) throw util.fail(400, 'page is a key such as deals.table (lower case, dots, dashes).', 'invalid_param', { param: 'page' });
  return page;
}

function list(ctx, p) {
  const util = u();
  const page = pageOf(p);
  const rows = util.findMany(ctx.app, 'saved_views', 'page = {:p} && (member = {:m} || shared = true)', 'sort,name', 200, { p: page, m: ctx.memberId || '-' });
  return { views: rows.map((r) => view(r, r.getString('member') === ctx.memberId)) };
}

function save(ctx, p) {
  const util = u();
  if (!ctx.memberId) throw util.fail(400, 'Only a signed-in person saves views.', 'invalid');
  const id = util.str(p, 'view', '');
  let r;
  if (id !== '') {
    r = util.byId(ctx.app, 'saved_views', id);
    if (r === null || r.getString('member') !== ctx.memberId) throw util.fail(404, 'No view ' + id + ' of yours.', 'not_found');
  } else {
    r = util.newRecord(ctx.app, 'saved_views');
    r.set('member', ctx.memberId);
    r.set('page', pageOf(p));
    r.set('sort', util.count(ctx.app, 'SELECT COUNT(*) AS n FROM saved_views WHERE member = {:m}', { m: ctx.memberId }) + 1);
  }
  if (id === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 80, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    r.set('name', n);
  }
  if (util.has(p, 'config')) {
    const c = util.obj(p, 'config');
    if (JSON.stringify(c).length > 19000) throw util.fail(400, 'The view is too large.', 'invalid_param', { param: 'config' });
    r.set('config', c);
  } else if (id === '') r.set('config', {});
  if (util.has(p, 'shared')) r.set('shared', util.bool(p, 'shared', false));
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 10000));
  ctx.app.save(r);
  ctx.auditInfo = { collection: 'saved_views', record: r.id, summary: 'Saved the view ' + r.getString('name') + ' (' + r.getString('page') + ')' };
  return { view: view(r, true) };
}

function remove(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'saved_views', util.req(p, 'view'));
  if (r === null || (r.getString('member') !== ctx.memberId && !ctx.owner)) throw util.fail(404, 'No view of yours with that id.', 'not_found');
  ctx.app.delete(r);
  ctx.auditInfo = { collection: 'saved_views', record: r.id, summary: 'Deleted the view ' + r.getString('name') };
  return { deleted: true };
}

module.exports = { list: list, save: save, remove: remove };
