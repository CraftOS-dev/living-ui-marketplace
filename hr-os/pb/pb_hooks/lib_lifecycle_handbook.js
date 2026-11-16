/// <reference path="../pb_data/types.d.ts" />
/**
 * The employee handbook: policy pages in markdown. HR edits a draft and
 * publishes it as a new version (kept in handbook_versions); people read
 * the published version and, when the page asks for it, acknowledge that
 * version (handbook_acks). A page for one entity shows only to its people.
 * handbook.text gives your AI agent the published text to answer people's
 * questions (question_asked) with the page and version it used.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function lc() {
  return L('lib_lifecycle');
}

function entitiesOfEmployee(app, employeeId) {
  return u()
    .rows(app, 'SELECT DISTINCT entity FROM employments WHERE employee = {:e}', { entity: '' }, { e: employeeId || '-' })
    .map((r) => r.entity);
}

function ackOf(app, pageId, version, employeeId) {
  if (!employeeId || version < 1) return null;
  return u().findOne(app, 'handbook_acks', 'page = {:p} && version = {:v} && employee = {:e}', { p: pageId, v: version, e: employeeId });
}

/** One page: mode 'hr' (draft and published) or 'reader' (published only). */
function pageView(app, r, mode, employeeId) {
  const util = u();
  const version = r.getInt('published_version');
  const ack = ackOf(app, r.id, version, employeeId);
  const v = {
    id: r.id,
    category: r.getString('category'),
    entity: r.getString('entity'),
    entity_name: lc().entityName(app, r.getString('entity')),
    needs_ack: r.getBool('needs_ack'),
    version: version,
    published: version > 0,
    published_at: r.getString('published_at'),
    title: version > 0 ? r.getString('published_title') : r.getString('title'),
    sort: r.getInt('sort'),
    acked_at: ack !== null ? ack.getString('acked_at') : '',
    to_ack: version > 0 && r.getBool('needs_ack') && !!employeeId && ack === null,
  };
  if (mode === 'reader') {
    v.body = r.getString('published_body');
    return v;
  }
  v.draft_title = r.getString('title');
  v.draft_body = r.getString('body');
  v.body = version > 0 ? r.getString('published_body') : '';
  v.changed = version === 0 || r.getString('title') !== r.getString('published_title') || r.getString('body') !== r.getString('published_body');
  v.archived = r.getBool('archived');
  v.updated = r.getString('updated');
  v.updated_by_name = lc().memberName(app, r.getString('updated_by'));
  return v;
}

function pageRef(app, ref) {
  return u().byIdOrName(app, 'handbook', ref, 'title', 'handbook.list');
}

/** May the caller read this published page? (entity pages: their people; HR and your AI agent: all). */
function canRead(ctx, r) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  if (lc().hrCan(ctx, r.getString('entity'), 'view')) return true;
  if (r.getInt('published_version') < 1 || r.getBool('archived')) return false;
  if (r.getString('entity') === '') return true;
  return entitiesOfEmployee(ctx.app, ctx.employeeId).indexOf(r.getString('entity')) >= 0;
}

function isEditor(ctx) {
  return ctx.isAgent || (lc().hrCan(ctx, '', 'edit') && ctx.actor === 'person');
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const editor = isEditor(ctx) && util.oneOf(p, 'view', ['edit', 'read'], 'edit') === 'edit';
  const rows = util.findMany(app, 'handbook', util.bool(p, 'archived', false) && editor ? '1=1' : 'archived = false', 'sort,title', 500).filter((r) => (editor ? r.getString('entity') === '' || L('lib_auth').inScope(ctx, r.getString('entity')) : canRead(ctx, r) && r.getInt('published_version') > 0));
  const self = L('lib_auth').selfEmployee(ctx);
  const pages = rows.map((r) => {
    const v = pageView(app, r, editor ? 'hr' : 'reader', self);
    if (!editor) delete v.body;
    else {
      delete v.draft_body;
      delete v.body;
    }
    return v;
  });
  const cats = [];
  for (const x of pages) if (x.category !== '' && cats.indexOf(x.category) < 0) cats.push(x.category);
  return { pages: pages, categories: cats, editor: editor, to_ack: pages.filter((x) => x.to_ack).length };
}

function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = pageRef(app, util.req(p, 'page'));
  if (!canRead(ctx, r)) throw util.fail(403, 'You cannot read this page.', 'not_permitted');
  const editor = isEditor(ctx) && (r.getString('entity') === '' || L('lib_auth').inScope(ctx, r.getString('entity')));
  const v = pageView(app, r, editor ? 'hr' : 'reader', L('lib_auth').selfEmployee(ctx));
  if (editor) {
    v.versions = util.findMany(app, 'handbook_versions', 'page = {:p}', '-version', 100, { p: r.id }).map((x) => ({ id: x.id, version: x.getInt('version'), title: x.getString('title'), published_by_name: lc().memberName(app, x.getString('published_by')), note: x.getString('note'), needs_ack: x.getBool('needs_ack'), created: x.getString('created'), acks: util.count(app, 'SELECT COUNT(*) AS n FROM handbook_acks WHERE page = {:p} AND version = {:v}', { p: r.id, v: x.getInt('version') }) }));
    const want = util.str(p, 'version', '');
    if (want !== '') {
      const ver = util.findOne(app, 'handbook_versions', 'page = {:p} && version = {:v}', { p: r.id, v: Number(want) });
      if (ver === null) throw util.fail(404, 'No version ' + want + ' of this page.', 'not_found');
      v.version_body = ver.getString('body');
      v.version_title = ver.getString('title');
      v.version_shown = ver.getInt('version');
    }
  }
  v.editor = editor;
  return { page: v };
}

/** handbook.save: add a page or change its draft (people read the published version until HR publishes). */
function save(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'page', '');
  const r = ref !== '' ? pageRef(app, ref) : util.newRecord(app, 'handbook');
  const before = ref !== '' ? { title: r.getString('title'), body: r.getString('body'), category: r.getString('category'), needs_ack: r.getBool('needs_ack') } : null;
  if (util.has(p, 'entity')) r.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  lc().needHr(ctx, r.getString('entity'), 'edit', 'edit the handbook');
  if (ref === '' || util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 200, ''));
    if (t === '') throw util.fail(400, 'title is required, e.g. --title "Working hours"', 'missing_param', { param: 'title' });
    r.set('title', t);
  }
  if (util.has(p, 'body')) r.set('body', util.text(p, 'body', 100000, ''));
  else if (ref === '') r.set('body', '');
  if (util.has(p, 'category')) r.set('category', util.squash(util.text(p, 'category', 60, '')));
  if (util.has(p, 'needs_ack')) r.set('needs_ack', util.bool(p, 'needs_ack', false));
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  if (util.has(p, 'sort')) r.set('sort', util.int(p, 'sort', 0, 0, 1000000));
  else if (ref === '') {
    const max = util.one(app, 'SELECT COALESCE(MAX(sort), 0) AS s FROM handbook', { s: 0 });
    r.set('sort', (max ? max.s : 0) + 10);
  }
  if (ref === '') r.set('published_version', 0);
  r.set('updated_by', ctx.memberId || '');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'handbook', record: r.id, summary: (ref === '' ? 'Added the handbook page ' : 'Changed the draft of ') + r.getString('title'), before: before, after: { title: r.getString('title'), body: util.clip(r.getString('body'), 2000), category: r.getString('category'), needs_ack: r.getBool('needs_ack') } });
  return get(ctx, { page: r.id });
}

/** handbook.publish: the draft becomes the next version people read. */
function publish(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = pageRef(app, util.req(p, 'page'));
  lc().needHr(ctx, r.getString('entity'), 'edit', 'publish handbook pages');
  if (r.getString('body').trim() === '') throw util.fail(409, 'This page has no text yet.', 'empty_page');
  if (r.getBool('archived')) throw util.fail(409, 'This page is archived.', 'conflict');
  const v = r.getInt('published_version') + 1;
  const note = util.text(p, 'note', 400, '');
  lc().inTx(app, (tx) => {
    const ver = util.newRecord(tx, 'handbook_versions');
    ver.set('page', r.id);
    ver.set('version', v);
    ver.set('title', r.getString('title'));
    ver.set('body', r.getString('body'));
    ver.set('needs_ack', r.getBool('needs_ack'));
    ver.set('published_by', ctx.memberId || '');
    ver.set('note', note);
    tx.save(ver);
    const fresh = tx.findRecordById('handbook', r.id);
    fresh.set('published_version', v);
    fresh.set('published_at', util.nowIso());
    fresh.set('published_title', r.getString('title'));
    fresh.set('published_body', r.getString('body'));
    tx.save(fresh);
  });
  let told = 0;
  if (r.getBool('needs_ack') && util.bool(p, 'notify', true)) {
    const bind = {};
    let sql = "SELECT DISTINCT e.member AS member FROM employees e JOIN employments m ON m.employee = e.id WHERE e.member != '' AND m.status != 'ended' AND e.archived = FALSE";
    if (r.getString('entity') !== '') {
      sql += ' AND m.entity = {:ent}';
      bind.ent = r.getString('entity');
    }
    const ids = util.rows(app, sql, { member: '' }, bind).map((x) => x.member);
    told = L('lib_notify').notify(app, ids, { kind: 'document', title: 'Please read: ' + r.getString('title') + (v > 1 ? ' (updated)' : ''), body: note, link: '#/lifecycle/handbook/' + r.id }).length;
  }
  L('lib_audit').note(ctx, { collection: 'handbook', record: r.id, summary: 'Published ' + r.getString('title') + ' version ' + v + (told > 0 ? ' (' + told + ' people asked to acknowledge)' : '') });
  const out = get(ctx, { page: r.id });
  out.notified = told;
  return out;
}

function unpublish(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = pageRef(app, util.req(p, 'page'));
  lc().needHr(ctx, r.getString('entity'), 'edit', 'unpublish handbook pages');
  r.set('archived', true);
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'handbook', record: r.id, summary: 'Took ' + r.getString('title') + ' out of the handbook' });
  return get(ctx, { page: r.id });
}

function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = pageRef(app, util.req(p, 'page'));
  lc().needHr(ctx, r.getString('entity'), 'full', 'delete handbook pages');
  if (r.getInt('published_version') > 0) throw util.fail(409, r.getString('title') + ' was published and acknowledged versions are kept; take it out of the handbook instead (handbook.unpublish).', 'has_history');
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'handbook', record: r.id, summary: 'Deleted the handbook draft ' + r.getString('title') });
  return { deleted: true };
}

function reorder(ctx, p) {
  const util = u();
  const app = ctx.app;
  lc().needHr(ctx, '', 'edit', 'reorder the handbook');
  const ids = util.list(p, 'pages') || [];
  lc().inTx(app, (tx) => {
    ids.forEach((id, i) => {
      const r = util.byId(tx, 'handbook', String(id));
      if (r === null) throw util.fail(404, 'No handbook page ' + id + '.', 'not_found');
      r.set('sort', (i + 1) * 10);
      tx.save(r);
    });
  });
  L('lib_audit').note(ctx, { collection: 'handbook', summary: 'Reordered ' + ids.length + ' handbook pages' });
  return list(ctx, {});
}

/** handbook.acknowledge: the signed-in person read the current version. */
function acknowledge(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = pageRef(app, util.req(p, 'page'));
  const self = L('lib_auth').selfEmployee(ctx);
  if (self === '') throw util.fail(409, 'Your account is not linked to an employee record.', 'not_linked');
  if (!canRead(ctx, r) || r.getInt('published_version') < 1) throw util.fail(403, 'You cannot read this page.', 'not_permitted');
  const v = r.getInt('published_version');
  if (ackOf(app, r.id, v, self) === null) {
    const a = util.newRecord(app, 'handbook_acks');
    a.set('page', r.id);
    a.set('version', v);
    a.set('employee', self);
    a.set('member', ctx.memberId);
    a.set('acked_at', util.nowIso());
    app.save(a);
  }
  L('lib_audit').note(ctx, { collection: 'handbook_acks', record: r.id, summary: 'Acknowledged ' + r.getString('published_title') + ' version ' + v });
  return get(ctx, { page: r.id });
}

/** handbook.acks: who acknowledged the current version of a page and who has not yet. */
function acks(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = pageRef(app, util.req(p, 'page'));
  lc().needHr(ctx, r.getString('entity'), 'view', 'see acknowledgements');
  const v = r.getInt('published_version');
  const bind = { p: r.id, v: v };
  let ent = '';
  if (r.getString('entity') !== '') {
    ent = ' AND m.entity = {:ent}';
    bind.ent = r.getString('entity');
  }
  const people = util.rows(
    app,
    "SELECT DISTINCT e.id AS id, e.number AS number, COALESCE((SELECT a.acked_at FROM handbook_acks a WHERE a.page = {:p} AND a.version = {:v} AND a.employee = e.id), '') AS acked_at FROM employees e JOIN employments m ON m.employee = e.id WHERE m.status != 'ended' AND e.archived = FALSE" + ent + ' AND ' + lc().scopeSql(ctx, 'm', bind) + ' ORDER BY e.number',
    { id: '', number: '', acked_at: '' },
    bind,
  );
  const rows = people.map((x) => ({ employee: x.id, number: x.number, name: lc().employeeName(app, x.id), acked_at: x.acked_at }));
  return { page: r.id, version: v, needs_ack: r.getBool('needs_ack'), people: rows, acked: rows.filter((x) => x.acked_at !== '').length, total: rows.length };
}

/** Pages the person still has to acknowledge (current versions). */
function pendingFor(app, employeeId) {
  const util = u();
  const ents = entitiesOfEmployee(app, employeeId);
  return util
    .findMany(app, 'handbook', 'archived = false && needs_ack = true && published_version > 0', 'sort,title', 200)
    .filter((r) => r.getString('entity') === '' || ents.indexOf(r.getString('entity')) >= 0)
    .filter((r) => ackOf(app, r.id, r.getInt('published_version'), employeeId) === null)
    .map((r) => ({ id: r.id, title: r.getString('published_title'), version: r.getInt('published_version'), category: r.getString('category') }));
}

/** handbook.text: the published handbook as text (for your AI agent's answers); --employee limits it to what that person reads. */
function text(ctx, p) {
  const util = u();
  const app = ctx.app;
  let ents = null;
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') ents = entitiesOfEmployee(app, L('lib_people').employeeRef(app, empRef).id);
  else if (!ctx.isAgent && !lc().hrCan(ctx, '', 'view')) ents = entitiesOfEmployee(app, ctx.employeeId);
  const q = util.str(p, 'q', '').toLowerCase();
  const pages = util
    .findMany(app, 'handbook', 'archived = false && published_version > 0', 'sort,title', 500)
    .filter((r) => ents === null || r.getString('entity') === '' || ents.indexOf(r.getString('entity')) >= 0)
    .map((r) => ({ page: r.id, title: r.getString('published_title'), category: r.getString('category'), entity: r.getString('entity'), entity_name: lc().entityName(app, r.getString('entity')), version: r.getInt('published_version'), published_at: r.getString('published_at'), body: r.getString('published_body') }))
    .filter((x) => q === '' || x.title.toLowerCase().indexOf(q) >= 0 || x.body.toLowerCase().indexOf(q) >= 0);
  return { pages: pages, total: pages.length, chars: pages.reduce((n, x) => n + x.body.length, 0) };
}

module.exports = {
  pageView: pageView,
  list: list,
  get: get,
  save: save,
  publish: publish,
  unpublish: unpublish,
  remove: remove,
  reorder: reorder,
  acknowledge: acknowledge,
  acks: acks,
  pendingFor: pendingFor,
  text: text,
};
