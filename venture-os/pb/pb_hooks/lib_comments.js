/// <reference path="../pb_data/types.d.ts" />
/**
 * Comments on any record (a deal, a memo block, a holding...), with
 * @mentions of members (a notification each). Visible to whoever may see
 * the record's deal. Your AI agent may read and add comments (marked as
 * its own); deleting is people only (the author or the owner).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function view(app, r, names) {
  const util = u();
  const mid = r.getString('member');
  if (mid !== '' && names[mid] === undefined) {
    const m = util.byId(app, 'members', mid);
    names[mid] = m === null ? 'Former member' : m.getString('name');
  }
  return {
    id: r.id,
    ref_collection: r.getString('ref_collection'),
    ref_id: r.getString('ref_id'),
    body: r.getString('body'),
    mentions: util.jsonOf(r, 'mentions', []) || [],
    actor: r.getString('actor'),
    member: mid,
    who: r.getString('actor') === 'agent' ? 'Your AI agent' : names[mid] || '',
    created: r.getString('created'),
  };
}

function needRecord(ctx, p) {
  const util = u();
  const rc = util.req(p, 'ref_collection', 'deals');
  let ri = util.req(p, 'ref_id');
  if (rc === 'deals') ri = L('lib_auth').dealId(ctx.app, ri) || ri;
  if (!/^[a-z][a-z0-9_]*$/.test(rc) || rc.charAt(0) === '_' || !ctx.app.hasTable(rc)) throw util.fail(400, 'ref_collection must be a collection of the app, e.g. deals.', 'invalid_param', { param: 'ref_collection' });
  if (!L('lib_auth').recordVisible(ctx, rc, ri)) throw util.fail(404, 'No ' + rc + ' record ' + ri + ' you can see.', 'not_found');
  return { rc: rc, ri: ri };
}

function list(ctx, p) {
  const util = u();
  const t = needRecord(ctx, p);
  const pg = util.page(p, 100, 500);
  const rows = util.findMany(ctx.app, 'comments', 'ref_collection = {:c} && ref_id = {:r}', 'created', pg.offset + pg.limit, { c: t.rc, r: t.ri }).slice(pg.offset);
  const names = {};
  return { comments: rows.map((r) => view(ctx.app, r, names)), total: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM comments WHERE ref_collection = {:c} AND ref_id = {:r}', { c: t.rc, r: t.ri }) };
}

function add(ctx, p) {
  const util = u();
  const t = needRecord(ctx, p);
  const body = util.text(p, 'body', 10000, '');
  if (body.trim() === '') throw util.fail(400, 'Write the comment.', 'missing_param', { param: 'body' });
  const mentions = [];
  for (const ref of util.list(p, 'mentions') || []) {
    const m = L('lib_auth').memberRef(ctx.app, String(ref));
    if (mentions.indexOf(m.id) < 0) mentions.push(m.id);
  }
  const r = util.newRecord(ctx.app, 'comments');
  r.set('ref_collection', t.rc);
  r.set('ref_id', t.ri);
  r.set('deal', t.rc === 'deals' ? t.ri : '');
  r.set('body', body);
  r.set('mentions', mentions);
  r.set('actor', ctx.isAgent ? 'agent' : 'person');
  r.set('member', ctx.memberId || '');
  ctx.app.save(r);
  const others = mentions.filter((id) => id !== ctx.memberId);
  if (others.length > 0) L('lib_notify').notify(ctx.app, others, { kind: 'mention', title: (ctx.isAgent ? 'Your AI agent' : ctx.name) + ' mentioned you', body: util.clip(body, 300), link: '', ref: 'comments:' + r.id });
  L('lib_audit').note(ctx, { collection: 'comments', record: r.id, summary: 'Commented on ' + t.rc + ' ' + t.ri });
  return { comment: view(ctx.app, r, {}) };
}

function remove(ctx, p) {
  const util = u();
  const r = util.byId(ctx.app, 'comments', util.req(p, 'comment'));
  if (r === null || !L('lib_auth').recordVisible(ctx, r.getString('ref_collection'), r.getString('ref_id'))) throw util.fail(404, 'No such comment.', 'not_found');
  if (r.getString('member') !== ctx.memberId && !ctx.owner) throw util.fail(403, 'Only the author or the owner can delete a comment.', 'not_permitted');
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'comments', record: r.id, summary: 'Deleted a comment on ' + r.getString('ref_collection') + ' ' + r.getString('ref_id') });
  return { deleted: true };
}

module.exports = { list: list, add: add, remove: remove, view: view };
