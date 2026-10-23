/// <reference path="../pb_data/types.d.ts" />
/**
 * Boards: an infinite canvas per project where claims, evidence, passages,
 * papers and notes are placed (never copied), with text cards and sections
 * to group them. Removing a card from a board never deletes the record.
 * Connecting two nodes on a board makes a real relation (lib_graph).
 */

const REF_KINDS = ['node', 'anchor', 'work', 'note', 'text', 'section'];
const COLORS = ['plain', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'teal'];

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

function boardOf(ctx, id) {
  const b = core().need(ctx.app, 'boards', id, 'board');
  core().guardProjectId(ctx, b.getString('project'));
  return b;
}

function boardOut(app, b) {
  return { id: b.id, project: b.getString('project'), name: b.getString('name'), viewport: u().jsonOf(b, 'viewport'), items: u().count(app, 'SELECT COUNT(*) AS n FROM board_items WHERE board = {:b}', { b: b.id }), updated: b.getString('updated') };
}

function list(ctx, p) {
  const pr = core().project(ctx.app, u().req(p, 'project'));
  core().guardProject(ctx, pr);
  return { boards: ctx.app.findRecordsByFilter('boards', 'project = {:p}', 'sort,created', 0, 0, { p: pr.id }).map((b) => boardOut(ctx.app, b)) };
}

function create(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const b = util.newRecord(ctx.app, 'boards');
  b.set('project', pr.id);
  b.set('name', util.squash(util.text(p, 'name', 200, '')) || 'Board ' + (util.count(ctx.app, 'SELECT COUNT(*) AS n FROM boards WHERE project = {:p}', { p: pr.id }) + 1));
  b.set('sort', util.count(ctx.app, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM boards WHERE project = {:p}', { p: pr.id }));
  ctx.app.save(b);
  require(`${__hooks}/lib_activity.js`).write(ctx.app, ctx, { label: 'Made the board ' + b.getString('name'), target: 'boards', record: b.id, project: pr.id });
  return { board: boardOut(ctx.app, b) };
}

function update(ctx, p) {
  const util = u();
  const b = boardOf(ctx, util.req(p, 'board'));
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 200, ''));
    if (n === '') throw util.fail(400, 'A board needs a name.', 'invalid_param');
    b.set('name', n);
  }
  if (util.has(p, 'viewport')) {
    const v = util.obj(p, 'viewport');
    util.keysOnly(v, ['x', 'y', 'zoom'], 'viewport');
    b.set('viewport', { x: Number(v.x) || 0, y: Number(v.y) || 0, zoom: Math.min(4, Math.max(0.1, Number(v.zoom) || 1)) });
  }
  ctx.app.save(b);
  return { board: boardOut(ctx.app, b) };
}

function remove(ctx, p) {
  const b = boardOf(ctx, u().req(p, 'board'));
  ctx.app.delete(b);
  require(`${__hooks}/lib_activity.js`).write(ctx.app, ctx, { label: 'Removed the board ' + b.getString('name'), target: 'boards', record: b.id, project: b.getString('project') });
  return { deleted: true };
}

/** One card as the board draws it, with what it shows. */
function itemOut(app, it, cache) {
  const util = u();
  const kind = it.getString('ref_kind');
  const o = { id: it.id, ref_kind: kind, x: it.getFloat('x'), y: it.getFloat('y'), w: it.getFloat('w'), h: it.getFloat('h'), z: it.getInt('z'), color: it.getString('color') || 'plain', text: it.getString('text'), ref: null };
  if (kind === 'node') {
    const n = util.byId(app, 'nodes', it.getString('node'));
    if (n !== null) o.ref = Object.assign(require(`${__hooks}/lib_graph.js`).nodeOut(app, n, false), { passage: cache.quotes[n.id] || null });
  } else if (kind === 'anchor') {
    const a = util.byId(app, 'anchors', it.getString('anchor'));
    if (a !== null) o.ref = require(`${__hooks}/lib_text.js`).anchorOut(app, a);
  } else if (kind === 'work') {
    const w = util.byId(app, 'works', it.getString('work'));
    if (w !== null) o.ref = require(`${__hooks}/lib_works.js`).rowsFor(app, [w.id])[0] || null;
  } else if (kind === 'note') {
    const n = util.byId(app, 'notes', it.getString('note'));
    if (n !== null) o.ref = { id: n.id, title: n.getString('title'), snippet: n.getString('text').slice(0, 280), kind: n.getString('kind') };
  }
  return o;
}

/** boards.get: a board with every card. */
function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = boardOf(ctx, util.req(p, 'board'));
  const items = app.findRecordsByFilter('board_items', 'board = {:b}', 'z,created', 0, 0, { b: b.id });
  const quotes = {};
  for (const r of util.rows(app, 'SELECT na.node AS node, a.quote AS quote, a.page_no AS page FROM node_anchors na JOIN anchors a ON a.id = na.anchor WHERE na.node IN (SELECT node FROM board_items WHERE board = {:b} AND ref_kind = \'node\') ORDER BY na.sort', { node: '', quote: '', page: 0 }, { b: b.id })) {
    if (!quotes[r.node]) quotes[r.node] = { quote: r.quote.slice(0, 300), page: r.page };
  }
  const nodeIds = items.filter((i) => i.getString('ref_kind') === 'node').map((i) => i.getString('node'));
  const rels = nodeIds.length > 0 ? app.findRecordsByFilter('relations', "project = {:p} && status != 'researcher_rejected'", '', 0, 0, { p: b.getString('project') }).filter((r) => nodeIds.indexOf(r.getString('from_node')) >= 0 && nodeIds.indexOf(r.getString('to_node')) >= 0) : [];
  return { board: boardOut(app, b), items: items.map((it) => itemOut(app, it, { quotes: quotes })).filter((o) => o.ref !== null || o.ref_kind === 'text' || o.ref_kind === 'section'), relations: rels.map(require(`${__hooks}/lib_graph.js`).relOut) };
}

const SIZES = { node: [260, 120], anchor: [280, 140], work: [260, 110], note: [260, 150], text: [220, 100], section: [520, 360] };

/** boards.place: put records on a board (one already there moves instead). */
function place(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = boardOf(ctx, util.req(p, 'board'));
  const items = util.list(p, 'items') || [];
  if (items.length === 0) throw util.fail(400, 'items is a JSON list of {ref_kind, id, x, y}.', 'missing_param');
  if (items.length > 300) throw util.fail(400, 'At most 300 cards at once.', 'too_many');
  const out = [];
  app.runInTransaction((tx) => {
    let z = util.count(tx, 'SELECT COALESCE(MAX(z), 0) AS n FROM board_items WHERE board = {:b}', { b: b.id });
    items.forEach((it, i) => {
      util.keysOnly(it, ['ref_kind', 'id', 'x', 'y', 'w', 'h', 'text', 'color'], 'Card ' + (i + 1));
      const kind = String(it.ref_kind || '');
      if (REF_KINDS.indexOf(kind) < 0) throw util.fail(400, 'Card ' + (i + 1) + ': ref_kind is one of ' + REF_KINDS.join(', '), 'invalid_param');
      let rec = null;
      if (kind !== 'text' && kind !== 'section') {
        const col = { node: 'nodes', anchor: 'anchors', work: 'works', note: 'notes' }[kind];
        const target = core().need(tx, col, String(it.id || ''), kind);
        if (kind === 'node' && target.getString('project') !== b.getString('project')) throw util.fail(400, 'Card ' + (i + 1) + ': that node belongs to another project.', 'invalid_param');
        if (kind === 'work' || kind === 'anchor') core().guardWork(ctx, kind === 'work' ? target : core().need(tx, 'works', target.getString('work'), 'paper'));
        rec = util.findOne(tx, 'board_items', 'board = {:b} && ' + kind + ' = {:id}', { b: b.id, id: target.id });
        if (rec === null) {
          rec = util.newRecord(tx, 'board_items');
          rec.set('board', b.id);
          rec.set('ref_kind', kind);
          rec.set(kind, target.id);
        }
      } else {
        rec = util.newRecord(tx, 'board_items');
        rec.set('board', b.id);
        rec.set('ref_kind', kind);
        rec.set('text', String(it.text || (kind === 'section' ? 'Section' : '')).slice(0, 8000));
      }
      const size = SIZES[kind];
      rec.set('x', Number(it.x) || 0);
      rec.set('y', Number(it.y) || 0);
      rec.set('w', Number(it.w) > 0 ? Number(it.w) : rec.getFloat('w') > 0 ? rec.getFloat('w') : size[0]);
      rec.set('h', Number(it.h) > 0 ? Number(it.h) : rec.getFloat('h') > 0 ? rec.getFloat('h') : size[1]);
      if (it.color !== undefined) rec.set('color', util.choice(it.color, COLORS, 'plain', 'Card ' + (i + 1) + ' color', 'items'));
      rec.set('z', kind === 'section' ? 0 : ++z);
      tx.save(rec);
      out.push(rec.id);
    });
    const bb = tx.findRecordById('boards', b.id);
    tx.save(bb);
  });
  return { placed: out };
}

/** boards.update-item: a card's text, color, place or size. */
function updateItem(ctx, p) {
  const util = u();
  const it = core().need(ctx.app, 'board_items', util.req(p, 'item'), 'card');
  boardOf(ctx, it.getString('board'));
  if (util.has(p, 'text')) it.set('text', util.text(p, 'text', 8000, ''));
  if (util.has(p, 'color')) it.set('color', util.oneOf(p, 'color', COLORS, 'plain'));
  for (const k of ['x', 'y']) if (util.has(p, k)) it.set(k, util.num(p, k, 0, -1e7, 1e7));
  for (const k of ['w', 'h']) if (util.has(p, k)) it.set(k, util.num(p, k, 40, 40, 20000));
  ctx.app.save(it);
  return { ok: true };
}

/** boards.move: new places (and sizes) for many cards at once. */
function move(ctx, p) {
  const util = u();
  const b = boardOf(ctx, util.req(p, 'board'));
  const list = util.list(p, 'positions') || [];
  ctx.app.runInTransaction((tx) => {
    list.slice(0, 2000).forEach((x, i) => {
      util.keysOnly(x, ['item', 'x', 'y', 'w', 'h'], 'Position ' + (i + 1));
      const it = core().need(tx, 'board_items', String(x.item), 'card');
      if (it.getString('board') !== b.id) return;
      it.set('x', Number(x.x) || 0);
      it.set('y', Number(x.y) || 0);
      if (Number(x.w) >= 40) it.set('w', Number(x.w));
      if (Number(x.h) >= 40) it.set('h', Number(x.h));
      tx.save(it);
    });
  });
  return { moved: list.length };
}

/** boards.remove-items: take cards off the board (the records stay). */
function removeItems(ctx, p) {
  const util = u();
  const b = boardOf(ctx, util.req(p, 'board'));
  const ids = util.ids(p, 'items', 2000);
  ctx.app.runInTransaction((tx) => {
    for (const id of ids) {
      const it = util.byId(tx, 'board_items', id);
      if (it !== null && it.getString('board') === b.id) tx.delete(it);
    }
  });
  return { removed: ids.length };
}

module.exports = { list: list, create: create, update: update, remove: remove, get: get, place: place, updateItem: updateItem, move: move, removeItems: removeItems };
