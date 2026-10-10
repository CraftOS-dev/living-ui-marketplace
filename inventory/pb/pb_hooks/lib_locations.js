/// <reference path="../pb_data/types.d.ts" />
/**
 * Locations: the places stock is kept, as a tree (a shelf in a room in a
 * site). A location is shown by its path, "Main stockroom / Shelf A".
 *
 * A location can only be deleted once nothing is stored in it; its places
 * inside move up to its own parent, and its history entries go with it.
 *
 * Places nest by size (HOLDS): a bigger place holds smaller ones, never the
 * other way round, so a vehicle never ends up inside a box. Any kind may
 * stand at the top level. The same rules are mirrored in the frontend
 * (lib/icons.tsx PLACE_HOLDS) to guide the place form.
 */

const KINDS = ['site', 'room', 'area', 'container', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'];
const MAX_DEPTH = 8;

const LABELS = {
  site: 'site',
  room: 'room',
  area: 'area',
  container: 'container',
  vehicle: 'vehicle',
  rack: 'pallet rack',
  shelf: 'shelf',
  cabinet: 'cabinet',
  fridge: 'fridge',
  drawer: 'drawer',
  pallet: 'pallet',
  bin: 'bin',
  box: 'box',
  other: 'other place',
};

const PLURALS = {
  site: 'sites',
  room: 'rooms',
  area: 'areas',
  container: 'containers',
  vehicle: 'vehicles',
  rack: 'pallet racks',
  shelf: 'shelves',
  cabinet: 'cabinets',
  fridge: 'fridges',
  drawer: 'drawers',
  pallet: 'pallets',
  bin: 'bins',
  box: 'boxes',
  other: 'other places',
};

/** What each kind of place can hold. */
const HOLDS = {
  site: ['room', 'area', 'container', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  room: ['area', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  area: ['container', 'vehicle', 'rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  container: ['rack', 'shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  vehicle: ['shelf', 'cabinet', 'fridge', 'drawer', 'pallet', 'bin', 'box', 'other'],
  rack: ['pallet', 'bin', 'box', 'other'],
  shelf: ['bin', 'box', 'other'],
  cabinet: ['shelf', 'drawer', 'bin', 'box', 'other'],
  fridge: ['shelf', 'drawer', 'bin', 'box', 'other'],
  drawer: ['bin', 'box', 'other'],
  pallet: ['bin', 'box', 'other'],
  bin: [],
  box: [],
  other: ['shelf', 'drawer', 'pallet', 'bin', 'box', 'other'],
};

const an = (word) => (/^[aeiou]/.test(word) ? 'an ' : 'a ') + word;

/** "A shelf holds bins, boxes and other places." / "A bin holds no other places." */
function holdsText(kind) {
  const list = (HOLDS[kind] || []).map((k) => PLURALS[k]);
  const head = an(LABELS[kind] || kind);
  if (list.length === 0) return head.charAt(0).toUpperCase() + head.slice(1) + ' holds no other places.';
  const tail = list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  return head.charAt(0).toUpperCase() + head.slice(1) + ' holds ' + tail + '.';
}

/** Can a place of this kind stand inside one of that kind? */
function fits(kind, parentKind) {
  return (HOLDS[parentKind] || []).indexOf(kind) >= 0;
}

/** Why a place of this kind cannot go inside that one. */
function nestError(kind, parentKind) {
  const what = an(LABELS[kind] || kind);
  return what.charAt(0).toUpperCase() + what.slice(1) + ' cannot go inside ' + an(LABELS[parentKind] || parentKind) + '. ' + holdsText(parentKind);
}

/**
 * Kinds for the missing levels of a path (an import creating "Room / Shelf / Bin"):
 * each level gets the first sensible kind its parent can hold. `parentKind` is
 * the kind of the existing place the new levels start under ('' for the top).
 * Returns { kinds } or { error } when a level cannot be created.
 */
function newPathKinds(parentKind, levels) {
  const kinds = [];
  let pk = parentKind;
  for (let i = 0; i < levels; i++) {
    const last = i === levels - 1;
    const prefer = last ? ['room', 'shelf', 'bin', 'box', 'other'] : ['room', 'area', 'shelf', 'cabinet', 'other'];
    let pick = null;
    for (const k of prefer) {
      if (pk !== '' && !fits(k, pk)) continue;
      if (!last && (HOLDS[k] || []).length === 0) continue;
      pick = k;
      break;
    }
    if (pick === null) return { error: holdsText(pk) };
    kinds.push(pick);
    pk = pick;
  }
  return { kinds: kinds };
}

/** The kind a new place inside `parentKind` gets when none is given. */
function defaultChildKind(parentKind) {
  if (parentKind === '') return 'room';
  for (const k of ['shelf', 'bin', 'box', 'pallet', 'drawer', 'other']) if (fits(k, parentKind)) return k;
  return null;
}

/** Every location in memory, with paths and the tree around each one. */
function index(app) {
  const recs = app.findRecordsByFilter('locations', '', 'sort,name', 0, 0);
  const list = recs.map((r) => ({
    id: r.id,
    name: r.getString('name'),
    code: r.getString('code'),
    kind: r.getString('kind') || 'other',
    parent: r.getString('parent'),
    notes: r.getString('notes'),
    sort: r.getInt('sort'),
  }));
  const byId = {};
  const children = {};
  for (const l of list) {
    byId[l.id] = l;
    children[l.id] = [];
  }
  const roots = [];
  for (const l of list) {
    if (l.parent !== '' && byId[l.parent] !== undefined) children[l.parent].push(l.id);
    else roots.push(l.id);
  }
  const pathCache = {};
  function path(id) {
    if (pathCache[id] !== undefined) return pathCache[id];
    const names = [];
    let cur = byId[id];
    let guard = 0;
    while (cur !== undefined && guard < 32) {
      names.unshift(cur.name);
      cur = cur.parent !== '' ? byId[cur.parent] : undefined;
      guard++;
    }
    pathCache[id] = names.join(' / ');
    return pathCache[id];
  }
  function descendants(id) {
    const out = [];
    const stack = (children[id] || []).slice();
    while (stack.length > 0) {
      const next = stack.pop();
      out.push(next);
      for (const c of children[next] || []) stack.push(c);
    }
    return out;
  }
  function depth(id) {
    let d = 0;
    let cur = byId[id];
    while (cur !== undefined && cur.parent !== '' && d < 32) {
      d++;
      cur = byId[cur.parent];
    }
    return d;
  }
  return { list: list, byId: byId, children: children, roots: roots, path: path, descendants: descendants, depth: depth };
}

/** Quantities, item counts and value per location (its own stock only). */
function totals(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.rows(
    app,
    'SELECT s.location AS id, COUNT(s.id) AS items, IFNULL(SUM(s.qty), 0) AS units, IFNULL(SUM(s.qty * i.unit_cost), 0) AS value ' +
      'FROM stock s JOIN items i ON i.id = s.item WHERE s.qty != 0 GROUP BY s.location',
    { id: '', items: 0, units: -0, value: -0 },
  );
  const out = {};
  for (const x of r) out[x.id] = { items: x.items, units: u.q3(x.units), value: Math.round(x.value) };
  return out;
}

/** The tree as nested nodes with totals rolled up from the places inside. */
function tree(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const ix = index(app);
  const own = totals(app);
  const cur = require(`${__hooks}/lib_core.js`).currency(app);
  function node(id) {
    const l = ix.byId[id];
    const kids = (ix.children[id] || []).map(node);
    const mine = own[id] || { items: 0, units: 0, value: 0 };
    const all = { items: mine.items, units: mine.units, value: mine.value };
    for (const k of kids) {
      all.items += k.total.items;
      all.units = u.q3(all.units + k.total.units);
      all.value += k.total.value;
    }
    return {
      id: l.id,
      name: l.name,
      code: l.code,
      kind: l.kind,
      notes: l.notes,
      parent: l.parent || null,
      path: ix.path(id),
      depth: ix.depth(id),
      own: { items: mine.items, units: mine.units, value: mine.value, value_text: require(`${__hooks}/lib_core.js`).moneyText(mine.value, cur) },
      total: all,
      children: kids,
    };
  }
  const roots = ix.roots.map(node);
  return { currency: cur, tree: roots, count: ix.list.length };
}

/** One location: where it sits, what is inside it, and what is stored in it. */
function get(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const ix = index(app);
  const cur = core.currency(app);
  const ids = [rec.id].concat(ix.descendants(rec.id));
  const bind = {};
  const inList = ids.map((id, i) => {
    bind['l' + i] = id;
    return '{:l' + i + '}';
  });
  const stock = u.rows(
    app,
    'SELECT s.item AS item, s.location AS location, s.qty AS qty FROM stock s WHERE s.qty != 0 AND s.location IN (' + inList.join(',') + ') ORDER BY s.location',
    { item: '', location: '', qty: -0 },
    bind,
  );
  const itemIds = [];
  for (const s of stock) if (itemIds.indexOf(s.item) < 0) itemIds.push(s.item);
  const ctx = items.context(app);
  const recs = {};
  for (const id of itemIds) {
    const it = u.byId(app, 'items', id);
    if (it !== null) recs[id] = it;
  }
  const rows = [];
  let units = 0;
  let value = 0;
  for (const s of stock) {
    const it = recs[s.item];
    if (it === undefined) continue;
    const brief = items.brief(app, it, ctx, cur);
    rows.push({ item: brief, location: { id: s.location, name: ix.byId[s.location].name, path: ix.path(s.location) }, qty: u.q3(s.qty) });
    units = u.q3(units + s.qty);
    value += Math.round(s.qty * it.getInt('unit_cost'));
  }
  rows.sort((a, b) => (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0));
  const l = ix.byId[rec.id];
  return {
    id: rec.id,
    name: l.name,
    code: l.code,
    kind: l.kind,
    notes: l.notes,
    parent: l.parent !== '' ? { id: l.parent, name: ix.byId[l.parent] ? ix.byId[l.parent].name : '', path: ix.path(l.parent) } : null,
    path: ix.path(rec.id),
    children: (ix.children[rec.id] || []).map((id) => ({ id: id, name: ix.byId[id].name, kind: ix.byId[id].kind, code: ix.byId[id].code })),
    currency: cur,
    stock: rows,
    units: units,
    value: value,
    value_text: core.moneyText(value, cur),
    item_count: itemIds.length,
  };
}

/** Check and fill a location record before it is saved (any writer). */
function checkRecord(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const name = u.squash(rec.getString('name'));
  if (name === '') throw new BadRequestError('A location needs a name');
  rec.set('name', name);
  let code = String(rec.getString('code') || '').trim();
  if (code === '') {
    code = core.nextNumber(app, 'locations', 'code', 'LOC-', 3);
  }
  if (/\s/.test(code)) throw new BadRequestError('A location code cannot contain spaces (got "' + code + '")');
  rec.set('code', code);
  const owner = core.codeOwner(app, code, '', rec.id);
  if (owner !== null) throw new BadRequestError('The code "' + code + '" is already used by ' + owner.label + '. Every scannable code must be unique.');
  if (KINDS.indexOf(rec.getString('kind')) < 0) rec.set('kind', 'other');
  const kind = rec.getString('kind');
  const parent = rec.getString('parent');
  const ix = index(app);
  if (parent !== '') {
    if (parent === rec.id) throw new BadRequestError('A location cannot sit inside itself');
    if (ix.byId[parent] === undefined) throw new BadRequestError('The parent location does not exist');
    if (rec.id !== '' && ix.descendants(rec.id).indexOf(parent) >= 0) {
      throw new BadRequestError('A location cannot sit inside a place that is inside it');
    }
    // Its own depth there plus the places nested inside it.
    const below = rec.id !== '' ? Math.max(0, ...ix.descendants(rec.id).map((d) => ix.depth(d) - ix.depth(rec.id))) : 0;
    if (ix.depth(parent) + 1 + below >= MAX_DEPTH) {
      throw new BadRequestError('Locations nest at most ' + MAX_DEPTH + ' levels deep' + (below > 0 ? ' (this place holds ' + below + ' more level' + (below === 1 ? '' : 's') + ' of places)' : ''));
    }
    // Places nest by size: a bigger place holds smaller ones.
    if (!fits(kind, ix.byId[parent].kind)) throw new BadRequestError(nestError(kind, ix.byId[parent].kind));
  }
  // A place that changes kind must still fit what is inside it.
  if (rec.id !== '') {
    for (const childId of ix.children[rec.id] || []) {
      const child = ix.byId[childId];
      if (fits(child.kind, kind)) continue;
      throw new BadRequestError(
        '"' + rec.getString('name') + '" holds "' + child.name + '" (' + an(LABELS[child.kind]) + '), which cannot go inside ' + an(LABELS[kind]) + '. Move it out first or choose another kind.',
      );
    }
  }
  // A map position is measured inside the parent; a new parent starts from the automatic layout.
  if (!rec.isNew() && rec.original().getString('parent') !== parent) rec.set('map', null);
  require(`${__hooks}/lib_map.js`).checkRecord(rec);
}

/**
 * Before a place is deleted (by any writer): the places inside it move up a
 * level. Each move is checked by checkRecord (it must fit there) and starts
 * from the automatic map layout.
 */
function liftChildren(app, rec) {
  const parent = rec.getString('parent');
  for (const child of app.findRecordsByFilter('locations', 'parent = {:id}', '', 0, 0, { id: rec.id })) {
    child.set('parent', parent);
    app.save(child);
  }
}

/** Stock still stored in a location, as a short description, or '' when empty. */
function stockIn(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = u.rows(app, 'SELECT COUNT(id) AS n, IFNULL(SUM(qty), 0) AS units FROM stock WHERE location = {:id} AND qty != 0', { n: 0, units: -0 }, { id: id });
  if (r.length === 0 || r[0].n === 0) return '';
  return r[0].n + (r[0].n === 1 ? ' item' : ' items') + ' (' + u.fmtQty(r[0].units) + ' units)';
}

/** What deleting a location does, for the confirmation. */
function deletePreview(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const ix = index(app);
  const holding = stockIn(app, rec.id);
  const hist = u.rows(app, 'SELECT COUNT(id) AS n FROM movements WHERE location = {:id}', { n: 0 }, { id: rec.id });
  const kids = (ix.children[rec.id] || []).map((id) => ix.byId[id].name);
  // The places inside move up to this place's parent: they must fit there.
  const parent = rec.getString('parent');
  const misfits =
    parent !== '' && ix.byId[parent] !== undefined
      ? (ix.children[rec.id] || []).map((id) => ix.byId[id]).filter((c) => !fits(c.kind, ix.byId[parent].kind))
      : [];
  const blocked =
    holding !== ''
      ? 'It still holds ' + holding + '. Move or remove that stock first.'
      : misfits.length > 0
        ? 'The places inside it would move up into "' + ix.byId[parent].name + '", but ' + misfits.map((c) => '"' + c.name + '" (' + an(LABELS[c.kind]) + ')').join(', ') + ' cannot go inside ' + an(LABELS[ix.byId[parent].kind]) + '. Move ' + (misfits.length === 1 ? 'it' : 'them') + ' first.'
        : null;
  return {
    location: { id: rec.id, name: rec.getString('name'), path: ix.path(rec.id) },
    blocked: blocked,
    moves_up: kids,
    moves_up_to: rec.getString('parent') !== '' ? ix.path(rec.getString('parent')) : 'the top level',
    history_entries_removed: hist.length > 0 ? hist[0].n : 0,
  };
}

/** Delete an empty location: its inner places move up a level first. */
function remove(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const preview = deletePreview(app, rec);
  if (preview.blocked !== null) throw u.fail(400, 'Cannot delete "' + rec.getString('name') + '". ' + preview.blocked);
  // The places inside it move up a level (liftChildren, run by the delete hook).
  app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('locations', rec.id));
  });
  return preview;
}

module.exports = {
  KINDS: KINDS,
  LABELS: LABELS,
  HOLDS: HOLDS,
  fits: fits,
  holdsText: holdsText,
  nestError: nestError,
  newPathKinds: newPathKinds,
  defaultChildKind: defaultChildKind,
  index: index,
  totals: totals,
  tree: tree,
  get: get,
  checkRecord: checkRecord,
  stockIn: stockIn,
  liftChildren: liftChildren,
  deletePreview: deletePreview,
  remove: remove,
};
