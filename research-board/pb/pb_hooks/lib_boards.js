/// <reference path="../pb_data/types.d.ts" />
/**
 * Boards: a canvas of cards and links.
 *
 * A board remembers the last view (viewport: x, y, zoom) so it reopens where
 * the person left it, and carries the state of a review asked of the AI
 * agent (see lib_agent.js). Lists come with a small preview of each board:
 * every card's box and kind, and which cards are linked.
 */

const COLORS = ['ink', 'accent', 'amber', 'green', 'blue', 'violet', 'red', 'teal'];
const PREVIEW_CAP = 240;

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'boards', String(id || ''));
  if (rec === null) throw u.fail(404, 'No board with id "' + id + '". List boards with boards.list.');
  return rec;
}

/** Board fields only (no cards), plus counts when given. */
function serialize(rec, counts, preview) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = counts || { cards: 0, links: 0, proposed: 0, kinds: {}, tags: 0, last: '' };
  return {
    id: rec.id,
    name: rec.getString('name'),
    description: rec.getString('description'),
    color: rec.getString('color') || 'ink',
    viewport: u.json(rec, 'viewport', null),
    sort: rec.getFloat('sort'),
    cards: c.cards,
    links: c.links,
    proposed: c.proposed,
    kinds: c.kinds,
    review_state: rec.getString('review_state'),
    review_request: rec.getString('review_request'),
    review_note: rec.getString('review_note'),
    review_focus: rec.getString('review_focus'),
    review_at: rec.getString('review_at'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
    last_added: c.last,
    preview: preview || null,
  };
}

/**
 * Counts and previews for many boards from two queries (all live cards and
 * all links), grouped here: one pass, no query per board.
 */
function overview(app, boardIds, withPreview) {
  const cardsLib = require(`${__hooks}/lib_cards.js`);
  const kindIndex = {};
  cardsLib.KINDS.forEach((k, i) => (kindIndex[k] = i));
  const want = {};
  for (const id of boardIds) want[id] = { counts: { cards: 0, links: 0, proposed: 0, kinds: {}, last: '' }, boxes: [], index: {}, lines: [] };
  const live = app.findRecordsByFilter('cards', cardsLib.LIVE, 'z,created', 0, 0);
  for (const r of live) {
    const w = want[r.getString('board')];
    if (w === undefined) continue;
    const kind = r.getString('kind');
    if (kind !== 'section') {
      w.counts.cards++;
      w.counts.kinds[kind] = (w.counts.kinds[kind] || 0) + 1;
      const created = r.getString('created');
      if (created > w.counts.last) w.counts.last = created;
    }
    if (withPreview && w.boxes.length < PREVIEW_CAP) {
      w.index[r.id] = w.boxes.length;
      w.boxes.push([Math.round(r.getFloat('x')), Math.round(r.getFloat('y')), Math.round(r.getFloat('w')), Math.round(r.getFloat('h')), kindIndex[kind] === undefined ? 0 : kindIndex[kind], r.getString('color') || 'plain']);
    }
  }
  const liveIds = {};
  for (const r of live) liveIds[r.id] = true;
  const links = app.findRecordsByFilter('links', '', '', 0, 0);
  for (const l of links) {
    const w = want[l.getString('board')];
    if (w === undefined || !liveIds[l.getString('source')] || !liveIds[l.getString('target')]) continue;
    w.counts.links++;
    if (l.getString('status') === 'proposed') w.counts.proposed++;
    if (withPreview) {
      const a = w.index[l.getString('source')];
      const b = w.index[l.getString('target')];
      if (a !== undefined && b !== undefined) w.lines.push([a, b, l.getString('status') === 'proposed' ? 1 : 0]);
    }
  }
  const out = {};
  for (const id of boardIds) {
    const w = want[id];
    out[id] = { counts: w.counts, preview: withPreview ? { boxes: w.boxes, lines: w.lines } : null };
  }
  return out;
}

function list(app, withPreview) {
  const rows = app.findRecordsByFilter('boards', '', 'sort,created', 0, 0);
  const ov = overview(
    app,
    rows.map((r) => r.id),
    withPreview,
  );
  return rows.map((r) => serialize(r, ov[r.id].counts, ov[r.id].preview));
}

/** One board with its live cards and links. */
function full(app, rec, opts) {
  const cardsLib = require(`${__hooks}/lib_cards.js`);
  const linksLib = require(`${__hooks}/lib_links.js`);
  const cards = cardsLib.liveOnBoard(app, rec.id);
  const liveIds = {};
  for (const c of cards) liveIds[c.id] = true;
  const links = linksLib.liveOnBoard(app, rec.id, liveIds);
  const ov = overview(app, [rec.id], false);
  return {
    board: serialize(rec, ov[rec.id].counts, null),
    cards: cards.map((c) => cardsLib.serialize(app, c, opts)),
    links: links.map((l) => linksLib.serialize(l)),
  };
}

function nextSort(app) {
  const rows = app.findRecordsByFilter('boards', '', '-sort', 1, 0);
  return rows.length > 0 ? rows[0].getFloat('sort') + 1 : 1;
}

function applyFields(rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  if (u.has(p, 'name')) {
    const name = u.squash(u.str(p, 'name', '')).slice(0, 120);
    if (name === '') throw u.fail(400, 'name cannot be empty');
    rec.set('name', name);
  }
  if (u.has(p, 'description')) rec.set('description', u.text(p, 'description', '').slice(0, 2000));
  if (u.has(p, 'color')) rec.set('color', u.oneOf(p, 'color', COLORS, 'ink'));
  if (u.has(p, 'viewport')) {
    const v = u.obj(p, 'viewport');
    const x = Number(v.x);
    const y = Number(v.y);
    const zoom = Number(v.zoom);
    if (!isFinite(x) || !isFinite(y) || !isFinite(zoom) || zoom <= 0) throw u.fail(400, 'viewport must be {"x":0,"y":0,"zoom":1}');
    rec.set('viewport', { x: Math.round(x), y: Math.round(y), zoom: Math.round(Math.min(3, Math.max(0.1, zoom)) * 1000) / 1000 });
  }
}

module.exports = {
  COLORS: COLORS,
  mustGet: mustGet,
  serialize: serialize,
  overview: overview,
  list: list,
  full: full,
  nextSort: nextSort,
  applyFields: applyFields,
};
