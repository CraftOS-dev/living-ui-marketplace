/// <reference path="../pb_data/types.d.ts" />
/**
 * Collections (a tree of folders a paper can be in many of) and tags
 * (colored labels). Removing a collection removes memberships only, never
 * papers.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}

/* ---------------------------------------------------------- collections */

/** collections.list: the tree with paper counts (direct and including sub-collections). */
function list(ctx) {
  const util = u();
  const rows = util.plain(util.rows(ctx.app, "SELECT c.id, c.name, COALESCE(c.parent, '') AS parent, c.sort, (SELECT COUNT(*) FROM collection_items ci JOIN works w ON w.id = ci.work WHERE ci.collection = c.id AND w.trashed = FALSE" + core().hiddenSql(ctx, 'w') + ') AS n FROM collections c ORDER BY c.sort, c.name COLLATE NOCASE', { id: '', name: '', parent: '', sort: 0, n: 0 }));
  return { collections: rows };
}

function wouldLoop(app, id, parentId) {
  let cur = parentId;
  for (let i = 0; i < 64 && cur !== ''; i++) {
    if (cur === id) return true;
    const c = u().byId(app, 'collections', cur);
    cur = c === null ? '' : c.getString('parent');
  }
  return false;
}

function create(ctx, p) {
  const util = u();
  const name = util.squash(util.text(p, 'name', 200, ''));
  if (name === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
  const parent = util.str(p, 'parent', '');
  if (parent !== '') core().need(ctx.app, 'collections', parent, 'collection');
  const c = util.newRecord(ctx.app, 'collections');
  c.set('name', name);
  c.set('parent', parent);
  c.set('sort', util.count(ctx.app, "SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM collections WHERE COALESCE(parent, '') = {:p}", { p: parent }));
  ctx.app.save(c);
  act().write(ctx.app, ctx, { label: 'Made the collection ' + name, target: 'collections', record: c.id });
  return { collection: { id: c.id, name: name, parent: parent } };
}

function update(ctx, p) {
  const util = u();
  const c = core().need(ctx.app, 'collections', util.req(p, 'collection'), 'collection');
  if (util.has(p, 'name')) {
    const name = util.squash(util.text(p, 'name', 200, ''));
    if (name === '') throw util.fail(400, 'A collection needs a name.', 'invalid_param');
    c.set('name', name);
  }
  if (util.has(p, 'parent')) {
    const parent = util.str(p, 'parent', '');
    if (parent !== '') {
      core().need(ctx.app, 'collections', parent, 'collection');
      if (wouldLoop(ctx.app, c.id, parent)) throw util.fail(409, 'A collection cannot go inside itself.', 'loop');
    }
    c.set('parent', parent);
  }
  if (util.has(p, 'sort')) c.set('sort', util.int(p, 'sort', 0, -100000, 100000));
  ctx.app.save(c);
  return { collection: { id: c.id, name: c.getString('name'), parent: c.getString('parent') } };
}

/** collections.delete: the collection and its sub-collections go; the papers stay. */
function remove(ctx, p) {
  const util = u();
  const c = core().need(ctx.app, 'collections', util.req(p, 'collection'), 'collection');
  const subs = util.count(ctx.app, 'WITH RECURSIVE sub(id) AS (SELECT {:c} UNION ALL SELECT x.id FROM collections x JOIN sub ON x.parent = sub.id) SELECT COUNT(*) - 1 AS n FROM sub', { c: c.id });
  if (util.bool(p, 'preview', false)) return { preview: true, sub_collections: subs, papers: util.count(ctx.app, 'SELECT COUNT(*) AS n FROM collection_items WHERE collection = {:c}', { c: c.id }) };
  ctx.app.delete(c);
  act().write(ctx.app, ctx, { label: 'Removed the collection ' + c.getString('name') + (subs > 0 ? ' and ' + subs + ' inside it' : ''), target: 'collections', record: c.id });
  return { deleted: true };
}

/** collections.add: put papers in a collection (moving them out of another with --from). */
function addItems(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = core().need(app, 'collections', util.req(p, 'collection'), 'collection');
  const works = util.ids(p, 'works', 2000);
  if (works.length === 0) throw util.fail(400, 'Give --works.', 'missing_param');
  const from = util.str(p, 'from', '');
  let added = 0;
  app.runInTransaction((tx) => {
    for (const id of works) {
      const w = core().need(tx, 'works', id, 'paper');
      core().guardWork(ctx, w);
      if (util.findOne(tx, 'collection_items', 'collection = {:c} && work = {:w}', { c: c.id, w: id }) === null) {
        const ci = util.newRecord(tx, 'collection_items');
        ci.set('collection', c.id);
        ci.set('work', id);
        tx.save(ci);
        added++;
      }
      if (from !== '' && from !== c.id) {
        const old = util.findOne(tx, 'collection_items', 'collection = {:c} && work = {:w}', { c: from, w: id });
        if (old !== null) tx.delete(old);
      }
    }
    act().write(tx, ctx, { label: (from !== '' ? 'Moved ' : 'Added ') + (works.length === 1 ? 'a paper' : works.length + ' papers') + ' to ' + c.getString('name'), target: 'collections', record: c.id, undo: from === '' ? { fn: 'lib_collections.undoAdd', args: { collection: c.id, works: works } } : undefined });
  });
  return { added: added };
}

function undoAdd(ctx, args) {
  removeFrom(ctx.app, args.collection, args.works || []);
}

function removeFrom(app, collectionId, works) {
  app.runInTransaction((tx) => {
    for (const id of works) {
      const ci = u().findOne(tx, 'collection_items', 'collection = {:c} && work = {:w}', { c: collectionId, w: id });
      if (ci !== null) tx.delete(ci);
    }
  });
}

/** collections.remove: take papers out of a collection (they stay in the library). */
function removeItems(ctx, p) {
  const util = u();
  const c = core().need(ctx.app, 'collections', util.req(p, 'collection'), 'collection');
  const works = util.ids(p, 'works', 2000);
  removeFrom(ctx.app, c.id, works);
  act().write(ctx.app, ctx, { label: 'Took ' + (works.length === 1 ? 'a paper' : works.length + ' papers') + ' out of ' + c.getString('name'), target: 'collections', record: c.id });
  return { removed: works.length };
}

/* ----------------------------------------------------------------- tags */

function tagList(ctx) {
  const util = u();
  return { tags: util.plain(util.rows(ctx.app, 'SELECT t.id, t.name, t.color_slot, (SELECT COUNT(*) FROM work_tags wt JOIN works w ON w.id = wt.work WHERE wt.tag = t.id AND w.trashed = FALSE) AS n FROM tags t ORDER BY t.color_slot = 0, t.color_slot, t.name COLLATE NOCASE', { id: '', name: '', color_slot: 0, n: 0 })) };
}

function tagByName(app, name) {
  return u().one(app, 'SELECT id FROM tags WHERE LOWER(name) = LOWER({:n}) LIMIT 1', { id: '' }, { n: name });
}

function tagCreate(ctx, p) {
  const util = u();
  const name = util.squash(util.text(p, 'name', 80, ''));
  if (name === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
  const hit = tagByName(ctx.app, name);
  if (hit !== null) return { tag: { id: hit.id, name: name }, existed: true };
  const t = util.newRecord(ctx.app, 'tags');
  t.set('name', name);
  t.set('color_slot', util.int(p, 'color_slot', 0, 0, 8));
  ctx.app.save(t);
  return { tag: { id: t.id, name: name, color_slot: t.getInt('color_slot') } };
}

function tagUpdate(ctx, p) {
  const util = u();
  const t = core().need(ctx.app, 'tags', util.req(p, 'tag'), 'tag');
  if (util.has(p, 'name')) {
    const name = util.squash(util.text(p, 'name', 80, ''));
    const hit = tagByName(ctx.app, name);
    if (hit !== null && hit.id !== t.id) throw util.fail(409, 'There is already a tag called ' + name + '.', 'already_exists');
    t.set('name', name);
  }
  if (util.has(p, 'color_slot')) t.set('color_slot', util.int(p, 'color_slot', 0, 0, 8));
  ctx.app.save(t);
  return { tag: { id: t.id, name: t.getString('name'), color_slot: t.getInt('color_slot') } };
}

function tagDelete(ctx, p) {
  const util = u();
  const t = core().need(ctx.app, 'tags', util.req(p, 'tag'), 'tag');
  ctx.app.delete(t);
  act().write(ctx.app, ctx, { label: 'Removed the tag ' + t.getString('name'), target: 'tags', record: t.id });
  return { deleted: true };
}

/** tags.apply: tag papers (by tag id, or a name that is made when new); --remove true takes it off. */
function apply(ctx, p) {
  const util = u();
  const app = ctx.app;
  const works = util.ids(p, 'works', 2000);
  if (works.length === 0) throw util.fail(400, 'Give --works.', 'missing_param');
  let tagId = util.str(p, 'tag', '');
  if (tagId === '') {
    const name = util.squash(util.text(p, 'name', 80, ''));
    if (name === '') throw util.fail(400, 'Give --tag <id> or --name <tag name>.', 'missing_param');
    tagId = tagCreate(ctx, { name: name }).tag.id;
  } else core().need(app, 'tags', tagId, 'tag');
  const removing = util.bool(p, 'remove', false);
  let n = 0;
  app.runInTransaction((tx) => {
    for (const id of works) {
      const w = core().need(tx, 'works', id, 'paper');
      core().guardWork(ctx, w);
      const hit = util.findOne(tx, 'work_tags', 'work = {:w} && tag = {:t}', { w: id, t: tagId });
      if (removing && hit !== null) {
        tx.delete(hit);
        n++;
      } else if (!removing && hit === null) {
        const wt = util.newRecord(tx, 'work_tags');
        wt.set('work', id);
        wt.set('tag', tagId);
        tx.save(wt);
        n++;
      }
    }
  });
  return { changed: n, tag: tagId };
}

module.exports = { list: list, create: create, update: update, remove: remove, addItems: addItems, undoAdd: undoAdd, removeItems: removeItems, tagList: tagList, tagCreate: tagCreate, tagUpdate: tagUpdate, tagDelete: tagDelete, apply: apply };
