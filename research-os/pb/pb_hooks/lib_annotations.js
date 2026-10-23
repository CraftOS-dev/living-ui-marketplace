/// <reference path="../pb_data/types.d.ts" />
/**
 * Highlights, underlines, comments and area boxes: the researcher's own
 * reading marks. Each one sits on an anchor (lib_text.js). The color slot's
 * meaning is copied onto the mark when it is made, so renaming a meaning
 * later does not rewrite what a mark meant when it was made.
 *
 * Reading marks are a person's; your AI agent marks passages as evidence
 * instead (nodes.create), which a person confirms.
 */

const KINDS = ['highlight', 'underline', 'note', 'area'];

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

function out(app, a, anchor) {
  const t = require(`${__hooks}/lib_text.js`);
  const an = anchor || u().byId(app, 'anchors', a.getString('anchor'));
  return {
    id: a.id,
    kind: a.getString('kind'),
    color_slot: a.getInt('color_slot'),
    meaning: a.getString('meaning'),
    comment: a.getString('comment'),
    actor: a.getString('actor'),
    work: a.getString('work'),
    file: a.getString('file'),
    page: a.getInt('page_no'),
    anchor: an !== null ? t.anchorOut(app, an) : null,
    created: a.getString('created'),
    updated: a.getString('updated'),
  };
}

function meaningOf(app, slot) {
  const s = core().slots(app).find((x) => x.slot === slot);
  return s ? s.meaning : '';
}

/** annotations.create: mark a passage (selection offsets or an area box). */
function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const kind = util.oneOf(p, 'kind', KINDS, 'highlight');
  const slot = util.int(p, 'color_slot', 1, 1, 8);
  const spec = {};
  for (const k of ['file', 'work', 'page', 'start', 'end', 'lines', 'from_char', 'to_char', 'area']) if (p[k] !== undefined) spec[k] = p[k];
  if (kind === 'area' && spec.area === undefined) throw util.fail(400, 'An area mark needs --area "[x, y, width, height]".', 'missing_param', { param: 'area' });
  const r = require(`${__hooks}/lib_text.js`).resolveSpec(ctx, spec);
  let a = null;
  let anchor = null;
  app.runInTransaction((tx) => {
    anchor = require(`${__hooks}/lib_text.js`).createAnchor(tx, ctx, r);
    a = util.newRecord(tx, 'annotations');
    a.set('anchor', anchor.id);
    a.set('work', anchor.getString('work'));
    a.set('file', anchor.getString('file'));
    a.set('kind', kind);
    a.set('color_slot', slot);
    a.set('meaning', meaningOf(tx, slot));
    a.set('comment', util.text(p, 'comment', 20000, ''));
    a.set('actor', ctx.actor);
    a.set('page_no', anchor.getInt('page_no'));
    a.set('start', anchor.getInt('start'));
    tx.save(a);
    require(`${__hooks}/lib_activity.js`).write(tx, ctx, {
      label: (kind === 'highlight' ? 'Highlighted' : kind === 'underline' ? 'Underlined' : kind === 'area' ? 'Marked an area' : 'Commented') + ' on page ' + anchor.getInt('page_no'),
      target: 'annotations',
      record: a.id,
      undo: { fn: 'lib_annotations.undoCreate', args: { annotation: a.id } },
    });
  });
  touchWork(app, a.getString('work'));
  return { annotation: out(app, a, anchor) };
}

function touchWork(app, workId) {
  const w = u().byId(app, 'works', workId);
  if (w !== null && w.getString('read_state') === 'unread') {
    w.set('read_state', 'reading');
    app.save(w);
  }
}

function undoCreate(ctx, args) {
  const a = u().byId(ctx.app, 'annotations', args.annotation);
  if (a === null) return;
  deleteMark(ctx.app, a);
}

/** Delete a mark and its anchor when nothing else uses the anchor. */
function deleteMark(app, a) {
  app.runInTransaction((tx) => {
    const anchorId = a.getString('anchor');
    tx.delete(tx.findRecordById('annotations', a.id));
    const used = u().count(tx, 'SELECT (SELECT COUNT(*) FROM annotations WHERE anchor = {:a}) + (SELECT COUNT(*) FROM node_anchors WHERE anchor = {:a}) + (SELECT COUNT(*) FROM board_items WHERE anchor = {:a}) AS n', { a: anchorId });
    if (used === 0) {
      const an = u().byId(tx, 'anchors', anchorId);
      if (an !== null) tx.delete(an);
    }
  });
}

/** annotations.update: color, kind or comment. */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = core().need(app, 'annotations', util.req(p, 'annotation'), 'highlight');
  const before = { kind: a.getString('kind'), color_slot: a.getInt('color_slot'), meaning: a.getString('meaning'), comment: a.getString('comment') };
  if (util.has(p, 'kind')) a.set('kind', util.oneOf(p, 'kind', KINDS.filter((k) => k !== 'area'), a.getString('kind')));
  if (util.has(p, 'color_slot')) {
    const s = util.int(p, 'color_slot', 1, 1, 8);
    a.set('color_slot', s);
    a.set('meaning', meaningOf(app, s));
  }
  if (util.has(p, 'comment')) a.set('comment', util.text(p, 'comment', 20000, ''));
  app.save(a);
  require(`${__hooks}/lib_activity.js`).write(app, ctx, { label: 'Changed a highlight on page ' + a.getInt('page_no'), target: 'annotations', record: a.id, undo: { fn: 'lib_annotations.undoUpdate', args: { annotation: a.id, before: before } } });
  return { annotation: out(app, a) };
}

function undoUpdate(ctx, args) {
  const a = u().byId(ctx.app, 'annotations', args.annotation);
  if (a === null) return;
  for (const k of Object.keys(args.before || {})) a.set(k, args.before[k]);
  ctx.app.save(a);
}

/** annotations.delete: remove a mark (Undo brings it back). */
function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = core().need(app, 'annotations', util.req(p, 'annotation'), 'highlight');
  const an = core().need(app, 'anchors', a.getString('anchor'), 'passage');
  const saved = {
    file: an.getString('file'),
    page: an.getInt('page_no'),
    start: an.getInt('start'),
    end: an.getInt('end'),
    area: util.jsonOf(an, 'area'),
    kind: a.getString('kind'),
    color_slot: a.getInt('color_slot'),
    comment: a.getString('comment'),
  };
  deleteMark(app, a);
  require(`${__hooks}/lib_activity.js`).write(app, ctx, { label: 'Removed a highlight on page ' + saved.page, target: 'annotations', record: a.id, undo: { fn: 'lib_annotations.undoDelete', args: saved } });
  return { deleted: true };
}

function undoDelete(ctx, args) {
  const p = { file: args.file, page: args.page, kind: args.kind, color_slot: args.color_slot, comment: args.comment };
  if (args.kind === 'area' && args.area) p.area = args.area;
  else {
    p.start = args.start;
    p.end = args.end;
  }
  create(ctx, p);
}

/** annotations.list: marks on a paper or file, filtered by color, kind or who. */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const fileRef = util.str(p, 'file', '');
  const workRef = util.str(p, 'work', '');
  if (fileRef !== '') {
    const f = core().need(app, 'files', fileRef, 'file');
    core().guardWork(ctx, core().need(app, 'works', f.getString('work'), 'paper'));
    where.push('file = {:f}');
    bind.f = f.id;
  } else if (workRef !== '') {
    const w = core().work(app, workRef);
    core().guardWork(ctx, w);
    where.push('work = {:w}');
    bind.w = w.id;
  } else if (util.str(p, 'project', '') !== '') {
    // Every mark in the papers of a project's reading list, newest first.
    const pr = core().project(app, util.str(p, 'project', ''));
    core().guardProject(ctx, pr);
    where.push('work.project_works_via_work.project ?= {:p}');
    bind.p = pr.id;
  } else throw util.fail(400, 'Give --work, --file or --project.', 'missing_param');
  const slot = util.int(p, 'color_slot', 0, 0, 8);
  if (slot > 0) {
    where.push('color_slot = {:s}');
    bind.s = slot;
  }
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  const recs = app.findRecordsByFilter('annotations', where.join(' && '), bind.p !== undefined ? '-created' : 'page_no,start', 2000, 0, bind);
  const anchorIds = recs.map((r) => r.getString('anchor'));
  const anchors = {};
  for (const an of anchorIds.length > 0 ? app.findRecordsByIds('anchors', anchorIds) : []) anchors[an.id] = an;
  return { annotations: recs.map((r) => out(app, r, anchors[r.getString('anchor')] || null)) };
}

module.exports = { KINDS: KINDS, out: out, create: create, undoCreate: undoCreate, update: update, undoUpdate: undoUpdate, remove: remove, undoDelete: undoDelete, list: list, deleteMark: deleteMark };
