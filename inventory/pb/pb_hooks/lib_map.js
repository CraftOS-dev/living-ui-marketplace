/// <reference path="../pb_data/types.d.ts" />
/**
 * The stockroom map on Home: every place with where it stands and its own
 * figures, the items stored anywhere (and the ones out of stock that have a
 * home place, shown there as empty slots), and stock by place. The browser
 * lays the 3D model out from this; the AI agent reads the same picture.
 *
 * Every place can have a position and a size on the map, so the picture can
 * match the real space: { x, z } is the centre of its footprint (a top-level
 * place: on the map floor; a place inside another: measured from the far
 * corner, min x and min z, of the place it stands in) and { w, d } its width
 * and depth. Map units are about a metre, kept to the centimetre. Empty means
 * the automatic layout; a missing size means the size its contents need.
 * A place moved into another place loses its position (it meant the old one).
 *
 * place and arrange refuse what the map could not draw as asked: a place
 * inside furniture (drawn as part of it), two places with a size that would
 * overlap in the same space, and a place outside a space whose size is set.
 */

const LIMIT = 200;
const MIN_SIZE = 0.5;
const EPS = 0.01;
const SPACES = ['site', 'room', 'area', 'container', 'vehicle'];

/** Within the map, to the centimetre. */
function snap(v, lo, hi) {
  return Math.round(Math.max(lo, Math.min(hi, v)) * 100) / 100;
}

/** A stored layout as { x, z, w, d } (w and d null when automatic), or null for the automatic layout. */
function parsePosition(raw) {
  if (raw === '' || raw === 'null') return null;
  let m = null;
  try {
    m = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  return normalize(m);
}

/** { x, z[, w, d] } made safe, or null when it is not a position. */
function normalize(m) {
  if (m === null || typeof m !== 'object') return null;
  const x = Number(m.x);
  const z = Number(m.z);
  if (!isFinite(x) || !isFinite(z)) return null;
  const w = m.w === undefined || m.w === null ? NaN : Number(m.w);
  const d = m.d === undefined || m.d === null ? NaN : Number(m.d);
  return {
    x: snap(x, -LIMIT, LIMIT),
    z: snap(z, -LIMIT, LIMIT),
    w: isFinite(w) ? snap(w, MIN_SIZE, LIMIT) : null,
    d: isFinite(d) ? snap(d, MIN_SIZE, LIMIT) : null,
  };
}

/** Record rule (locations): a position is { x, z } with an optional { w, d }. */
function checkRecord(rec) {
  const raw = rec.getString('map');
  if (raw === '' || raw === 'null') return;
  const pos = parsePosition(raw);
  if (pos === null) throw new BadRequestError('A map position is {"x": number, "z": number} with an optional "w" and "d" (size)');
  rec.set('map', pos);
}

/** Everything the map draws. */
function get(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const locs = require(`${__hooks}/lib_locations.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const cur = core.currency(app);
  const ix = locs.index(app);
  const own = locs.totals(app);
  const positions = {};
  for (const r of u.rows(app, "SELECT id, IFNULL(map, '') AS map FROM locations", { id: '', map: '' })) positions[r.id] = parsePosition(r.map);

  const places = ix.list.map((l) => {
    const mine = own[l.id] || { items: 0, units: 0, value: 0 };
    return {
      id: l.id,
      name: l.name,
      code: l.code,
      kind: l.kind,
      parent: l.parent !== '' && ix.byId[l.parent] !== undefined ? l.parent : null,
      depth: ix.depth(l.id),
      path: ix.path(l.id),
      sort: l.sort,
      map: positions[l.id] || null,
      items: mine.items,
      units: mine.units,
      value: mine.value,
      value_text: core.moneyText(mine.value, cur),
    };
  });

  const stock = u
    .rows(app, 'SELECT item, location, qty FROM stock WHERE qty != 0 ORDER BY location, item', { item: '', location: '', qty: -0 })
    .filter((r) => ix.byId[r.location] !== undefined)
    .map((r) => ({ item: r.item, location: r.location, qty: u.q3(r.qty) }));
  const held = {};
  for (const s of stock) held[s.item] = true;

  const ctx = items.context(app);
  const counts = { ok: 0, low: 0, out: 0, over: 0 };
  const list = [];
  let units = 0;
  let value = 0;
  for (const rec of app.findRecordsByFilter('items', 'archived = false', 'name', 0, 0)) {
    const b = items.brief(app, rec, ctx, cur);
    if (counts[b.status] !== undefined) counts[b.status]++;
    const home = rec.getString('default_location');
    const homeKnown = home !== '' && ix.byId[home] !== undefined;
    if (held[rec.id] !== true && !(b.status === 'out' && homeKnown)) continue;
    units = u.q3(units + Math.max(0, b.on_hand));
    value += b.value;
    list.push({
      id: b.id,
      name: b.name,
      sku: b.sku,
      unit: b.unit,
      fractional: b.fractional,
      icon: b.icon,
      photo: b.photo,
      category: b.category !== null ? b.category.name : null,
      status: b.status,
      on_hand: b.on_hand,
      min_qty: b.min_qty,
      max_qty: b.max_qty,
      unit_cost_e4: b.unit_cost_e4,
      value_text: b.value_text,
      home: homeKnown ? home : null,
    });
  }

  return {
    currency: cur,
    places: places,
    items: list,
    stock: stock,
    counts: counts,
    totals: { places: places.length, items: list.length, units: units, value: value, value_text: core.moneyText(value, cur) },
  };
}

/** The new layout for one place from { x, z, w, d, reset } (size kept when not given), or null to reset. */
function layoutFrom(u, rec, p, prefix) {
  if (u.bool(p, 'reset', false)) return null;
  const x = Number(u.req(p, 'x', '4'));
  const z = Number(u.req(p, 'z', '-2.5'));
  if (!isFinite(x) || !isFinite(z)) throw u.fail(400, prefix + 'x and z are plain numbers, like 4 or -2.5');
  const before = parsePosition(rec.getString('map'));
  const size = (key) => {
    if (!u.has(p, key)) return before !== null ? before[key] : null;
    const raw = u.str(p, key, '');
    if (raw === '') return null;
    const v = Number(raw);
    if (!isFinite(v) || v < MIN_SIZE) throw u.fail(400, prefix + key + ' is a size in map units, at least ' + MIN_SIZE + ' (empty: automatic)');
    return v;
  };
  return normalize({ x: x, z: z, w: size('w'), d: size('d') });
}

/** The floor a place takes from its layout (furniture standing on its own: its plinth), or null without a size. */
function footprint(l, m) {
  if (m === null || m === undefined || m.w === null || m.d === null) return null;
  let w = m.w;
  let d = m.d;
  if (l.parent === '' && SPACES.indexOf(l.kind) < 0) {
    w = Math.ceil(Math.max(1.5, w + 0.7) - 1e-6);
    d = Math.ceil(Math.max(1.5, d + 0.7) - 1e-6);
  }
  return { x0: m.x - w / 2, x1: m.x + w / 2, z0: m.z - d / 2, z1: m.z + d / 2 };
}

function spanText(f) {
  const r = (v) => Math.round(v * 100) / 100;
  return 'x ' + r(f.x0) + ' to ' + r(f.x1) + ', z ' + r(f.z0) + ' to ' + r(f.z1);
}

/**
 * Refuse a layout the map could not draw as asked. plan: [{ id, map }] (map
 * null: automatic). Only what the plan touches is checked, so an old overlap
 * elsewhere never blocks a change.
 */
function validate(app, plan) {
  const u = require(`${__hooks}/lib_util.js`);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  const maps = {};
  for (const r of u.rows(app, "SELECT id, IFNULL(map, '') AS map FROM locations", { id: '', map: '' })) maps[r.id] = parsePosition(r.map);
  const changed = {};
  for (const item of plan) {
    maps[item.id] = item.map;
    changed[item.id] = true;
  }
  const parentOf = (l) => (l.parent !== '' && ix.byId[l.parent] !== undefined ? l.parent : '');
  const spaces = {};
  for (const item of plan) {
    const l = ix.byId[item.id];
    if (l === undefined) continue;
    if (item.map !== null) {
      for (let pid = parentOf(l), n = 0; pid !== '' && n < 32; pid = parentOf(ix.byId[pid]), n++) {
        const host = ix.byId[pid];
        if (SPACES.indexOf(host.kind) < 0) {
          throw u.fail(400, '"' + l.name + '" is drawn as part of "' + host.name + '" on the map (what is inside furniture has no map position of its own). Place "' + host.name + '" instead.');
        }
      }
    }
    spaces[parentOf(l)] = true;
    if (SPACES.indexOf(l.kind) >= 0) spaces[l.id] = true;
  }
  for (const sid of Object.keys(spaces)) {
    const host = sid !== '' ? ix.byId[sid] : null;
    const inside = ix.list.filter((l) => parentOf(l) === sid && maps[l.id] !== null && maps[l.id] !== undefined);
    const where = host !== null ? '"' + host.name + '"' : 'the map';
    for (let i = 0; i < inside.length; i++) {
      const fa = footprint(inside[i], maps[inside[i].id]);
      if (fa === null) continue;
      for (let j = i + 1; j < inside.length; j++) {
        if (!changed[inside[i].id] && !changed[inside[j].id]) continue;
        const fb = footprint(inside[j], maps[inside[j].id]);
        if (fb === null) continue;
        if (fa.x0 < fb.x1 - EPS && fb.x0 < fa.x1 - EPS && fa.z0 < fb.z1 - EPS && fb.z0 < fa.z1 - EPS) {
          throw u.fail(
            400,
            '"' + inside[i].name + '" (' + spanText(fa) + ') and "' + inside[j].name + '" (' + spanText(fb) + ') would overlap in ' + where + '. Move one or make it smaller (map.get shows every layout).',
          );
        }
      }
    }
    const hm = host !== null ? maps[host.id] : null;
    if (host === null || hm === null || hm === undefined || hm.w === null || hm.d === null) continue;
    for (const l of inside) {
      if (!changed[l.id] && !changed[host.id]) continue;
      const m = maps[l.id];
      const f = footprint(l, m) || { x0: m.x, x1: m.x, z0: m.z, z1: m.z };
      if (f.x0 < -EPS || f.z0 < -EPS || f.x1 > hm.w + EPS || f.z1 > hm.d + EPS) {
        throw u.fail(
          400,
          '"' + l.name + '" (' + spanText(f) + ') would stand outside "' + host.name + '", which is ' + hm.w + ' by ' + hm.d + ' (x 0 to ' + hm.w + ', z 0 to ' + hm.d + '). Move it in or make "' + host.name + '" bigger.',
        );
      }
    }
  }
}

/** Set where a place stands on the map and how big it is, or clear it (reset) for the automatic layout. */
function place(app, rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const layout = layoutFrom(u, rec, p, '');
  validate(app, [{ id: rec.id, map: layout }]);
  rec.set('map', layout);
  app.save(rec);
  return { location: { id: rec.id, name: rec.getString('name'), code: rec.getString('code') }, map: parsePosition(rec.getString('map')) };
}

/**
 * Several places at once, all or nothing: [{ location, x, z, w?, d? }, { location, reset: true }].
 * Saving every place in a space together keeps the others where they are when one moves.
 */
function arrange(app, list) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  if (list.length === 0) throw u.fail(400, 'positions is empty: give [{"location": "LOC-001", "x": 4, "z": 2, "w": 6, "d": 4}]');
  if (list.length > 500) throw u.fail(400, 'At most 500 places at a time');
  const plan = list.map((entry, i) => {
    if (entry === null || typeof entry !== 'object') throw u.fail(400, 'positions[' + i + '] must be an object');
    const p = {};
    for (const k of Object.keys(entry)) p[k] = entry[k] === null || entry[k] === undefined ? '' : String(entry[k]);
    const rec = core.location(app, u.req(p, 'location', 'LOC-001'));
    return { id: rec.id, map: layoutFrom(u, rec, p, 'positions[' + i + ']: ') };
  });
  validate(app, plan);
  app.runInTransaction((tx) => {
    for (const item of plan) {
      const rec = tx.findRecordById('locations', item.id);
      rec.set('map', item.map);
      tx.save(rec);
    }
  });
  return { saved: plan.length };
}

/** Clear every position: the whole map goes back to the automatic layout. */
function resetAll(app) {
  let n = 0;
  app.runInTransaction((tx) => {
    for (const rec of tx.findRecordsByFilter('locations', '', '', 0, 0)) {
      if (parsePosition(rec.getString('map')) === null) continue;
      rec.set('map', null);
      tx.save(rec);
      n++;
    }
  });
  return { reset: n };
}

module.exports = {
  LIMIT: LIMIT,
  parsePosition: parsePosition,
  checkRecord: checkRecord,
  get: get,
  place: place,
  arrange: arrange,
  resetAll: resetAll,
};
