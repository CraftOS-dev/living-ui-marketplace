/// <reference path="../pb_data/types.d.ts" />
/**
 * Links: an arrow from one card to another on the same board.
 *
 *   relates      the two belong together (no direction implied)
 *   supports     the source backs the target up
 *   contradicts  the source argues against the target
 *   leads        the source comes first / causes / leads to the target
 *
 * A link the AI agent proposes waits as `proposed` (drawn dashed) until the
 * person confirms it (it becomes `confirmed`) or rejects it (it is deleted).
 * Two cards share at most one link, whichever way it points.
 */

const KINDS = ['relates', 'supports', 'contradicts', 'leads'];
const LABEL = { relates: 'relates to', supports: 'supports', contradicts: 'contradicts', leads: 'leads to' };

function serialize(rec) {
  return {
    id: rec.id,
    board: rec.getString('board'),
    source: rec.getString('source'),
    target: rec.getString('target'),
    kind: rec.getString('kind'),
    label: rec.getString('label'),
    status: rec.getString('status'),
    added_by: rec.getString('added_by') || 'app',
    reason: rec.getString('reason'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'links', String(id || ''));
  if (rec === null) throw u.fail(404, 'No link with id "' + id + '". List a board\'s links with boards.get.');
  return rec;
}

/** The link between two cards, whichever way it points, or null. */
function between(app, a, b) {
  const rows = app.findRecordsByFilter('links', '(source = {:a} && target = {:b}) || (source = {:b} && target = {:a})', '', 1, 0, { a: a, b: b });
  return rows.length > 0 ? rows[0] : null;
}

/** Links on a board whose two cards are both live (not trashed). */
function liveOnBoard(app, boardId, liveIds) {
  return app.findRecordsByFilter('links', 'board = {:b}', 'created', 0, 0, { b: boardId }).filter((l) => liveIds[l.getString('source')] && liveIds[l.getString('target')]);
}

/**
 * Create a link after checking both cards. Returns { link, existed }: when
 * the two cards are already linked the existing link is returned untouched.
 */
function create(app, p, by) {
  const u = require(`${__hooks}/lib_util.js`);
  const cards = require(`${__hooks}/lib_cards.js`);
  const sourceId = u.req(p, 'source');
  const targetId = u.req(p, 'target');
  if (sourceId === targetId) throw u.fail(400, 'A card cannot link to itself');
  const a = cards.mustGet(app, sourceId);
  const b = cards.mustGet(app, targetId);
  if (a.getString('board') !== b.getString('board')) throw u.fail(400, 'Both cards must be on the same board');
  const kind = u.oneOf(p, 'kind', KINDS, 'relates');
  const label = u.squash(u.str(p, 'label', '')).slice(0, 200);
  const proposed = u.bool(p, 'proposed', false);
  const existing = between(app, sourceId, targetId);
  if (existing !== null) return { link: existing, existed: true };
  const rec = new Record(app.findCollectionByNameOrId('links'));
  rec.set('board', a.getString('board'));
  rec.set('source', sourceId);
  rec.set('target', targetId);
  rec.set('kind', kind);
  rec.set('label', label);
  rec.set('status', proposed ? 'proposed' : 'confirmed');
  rec.set('added_by', by);
  rec.set('reason', u.squash(u.str(p, 'reason', '')).slice(0, 1000));
  app.save(rec);
  return { link: rec, existed: false };
}

module.exports = {
  KINDS: KINDS,
  LABEL: LABEL,
  serialize: serialize,
  mustGet: mustGet,
  between: between,
  liveOnBoard: liveOnBoard,
  create: create,
};
