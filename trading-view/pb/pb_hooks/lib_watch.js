/// <reference path="../pb_data/types.d.ts" />
/**
 * Watchlists: named lists of symbols with optional section headers, a flag
 * color and a note per row. A symbol appears at most once per list.
 */

const FLAGS = ['', 'red', 'amber', 'green', 'blue', 'violet'];
const COLUMNS = ['last', 'chg', 'chg_pct', 'ext', 'volume', 'high', 'low', 'range', 'spark', 'high_52w', 'low_52w'];

function serializeList(rec, count) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = { id: rec.id, name: rec.getString('name'), sort: rec.getInt('sort'), columns: u.json(rec, 'columns', ['last', 'chg', 'chg_pct']) || ['last', 'chg', 'chg_pct'] };
  if (count !== undefined) out.count = count;
  return out;
}

function serializeItem(rec) {
  return {
    id: rec.id,
    list: rec.getString('list'),
    kind: rec.getString('kind'),
    symbol: rec.getString('symbol'),
    label: rec.getString('label'),
    flag: rec.getString('flag'),
    note: rec.getString('note'),
    sort: rec.getInt('sort'),
  };
}

function itemsOf(app, listId) {
  return app.findRecordsByFilter('watch_items', 'list = {:l}', 'sort,created', 0, 0, { l: listId });
}

function lists(app) {
  const rows = app.findRecordsByFilter('watchlists', 'id != ""', 'sort,created', 0, 0);
  const counts = {};
  const items = app.findRecordsByFilter('watch_items', "kind = 'symbol'", '', 0, 0);
  for (const it of items) counts[it.getString('list')] = (counts[it.getString('list')] || 0) + 1;
  return rows.map((r) => serializeList(r, counts[r.id] || 0));
}

function mustList(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!id) throw u.fail(400, 'list is required (a watchlist id or name; see watchlists.list)');
  const rec = u.byId(app, 'watchlists', id);
  if (rec) return rec;
  const byName = app.findRecordsByFilter('watchlists', 'name = {:n}', '', 1, 0, { n: id });
  if (byName.length > 0) return byName[0];
  throw u.fail(404, 'No watchlist "' + id + '"; see watchlists.list');
}

function mustItem(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'watch_items', id);
  if (!rec) throw u.fail(404, 'No watchlist row ' + id);
  return rec;
}

/** A list with its rows, and quotes for its symbols when asked. */
function full(app, rec, withQuotes) {
  const rows = itemsOf(app, rec.id).map(serializeItem);
  const out = serializeList(rec, rows.filter((r) => r.kind === 'symbol').length);
  out.items = rows;
  if (withQuotes) {
    const m = require(`${__hooks}/lib_market.js`);
    const q = m.quotes(
      app,
      rows.filter((r) => r.kind === 'symbol').map((r) => r.symbol),
    );
    out.quotes = q.quotes;
    out.missing = q.missing;
  }
  return out;
}

function nextSort(app, listId) {
  let max = -1;
  for (const r of itemsOf(app, listId)) max = Math.max(max, r.getInt('sort'));
  return max + 1;
}

/** Renumber rows 0..n in their current order, with `moved` placed at `index`. */
function reorder(app, listId, moved, index) {
  const rows = itemsOf(app, listId).filter((r) => !moved || r.id !== moved.id);
  if (moved) rows.splice(Math.max(0, Math.min(rows.length, index)), 0, moved);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].getInt('sort') !== i || (moved && rows[i].id === moved.id)) {
      rows[i].set('sort', i);
      app.save(rows[i]);
    }
  }
}

module.exports = {
  FLAGS: FLAGS,
  COLUMNS: COLUMNS,
  serializeList: serializeList,
  serializeItem: serializeItem,
  itemsOf: itemsOf,
  lists: lists,
  mustList: mustList,
  mustItem: mustItem,
  full: full,
  nextSort: nextSort,
  reorder: reorder,
};
