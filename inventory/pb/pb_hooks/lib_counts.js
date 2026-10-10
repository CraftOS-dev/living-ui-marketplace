/// <reference path="../pb_data/types.d.ts" />
/**
 * Stock counts: walk a place, count what is really there, review the
 * differences, then complete the count to set the stock to what was counted.
 *
 * Starting a count takes a snapshot of what the app expects in each place
 * (one line per item and location). Counting fills `counted`; scanning a
 * code adds one. A blind count hides the expected numbers until review, so
 * the count is not nudged by them. Completing posts one batch that sets each
 * counted line to its counted quantity (from the stock as it is at that
 * moment, so anything moved during the count is respected). Lines nobody
 * counted are left alone unless asked to set them to zero.
 *
 * The count's state follows the ledger (sync): undoing its batch in the
 * history reopens it.
 */

function lines(app, countId) {
  return app.findRecordsByFilter('count_lines', 'session = {:c}', 'created', 0, 0, { c: countId });
}

/** completed while its batch stands in the history, otherwise counting again. */
function sync(tx, countId) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(tx, 'counts', countId);
  if (rec === null || rec.getString('status') === 'cancelled') return;
  const batches = u.rows(
    tx,
    "SELECT DISTINCT batch FROM movements WHERE ref_type = 'count' AND ref = {:c} AND reverses = '' AND batch NOT IN (SELECT reverses FROM movements WHERE reverses != '')",
    { batch: '' },
    { c: countId },
  );
  if (batches.length > 0) {
    rec.set('status', 'completed');
    rec.set('batch', batches[0].batch);
    if (rec.getString('completed_on') === '') rec.set('completed_on', u.today());
  } else if (rec.getString('status') === 'completed') {
    rec.set('status', 'counting');
    rec.set('batch', '');
    rec.set('completed_on', '');
  }
  tx.save(rec);
}

function serialize(app, rec, reveal) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const items = require(`${__hooks}/lib_items.js`);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  const cats = items.categoryMap(app);
  const cur = core.currency(app);
  const counting = rec.getString('status') === 'counting';
  const hide = counting && rec.getBool('blind') && !reveal;
  const out = [];
  let counted = 0;
  let diffLines = 0;
  let unitsDiff = 0;
  let valueDiff = 0;
  for (const l of lines(app, rec.id)) {
    const it = u.byId(app, 'items', l.getString('item'));
    if (it === null) continue;
    const expected = u.q3(l.getFloat('expected'));
    const isSet = l.getBool('counted_set');
    const c = isSet ? u.q3(l.getFloat('counted')) : null;
    const diff = c !== null ? u.q3(c - expected) : null;
    if (isSet) counted += 1;
    if (diff !== null && diff !== 0) {
      diffLines += 1;
      unitsDiff = u.q3(unitsDiff + diff);
      valueDiff += Math.round(diff * it.getInt('unit_cost'));
    }
    const locId = l.getString('location');
    out.push({
      id: l.id,
      item: items.tiny(it, cats),
      location: { id: locId, name: ix.byId[locId] ? ix.byId[locId].name : '', path: ix.path(locId) },
      expected: hide ? null : expected,
      counted: c,
      counted_set: isSet,
      difference: hide ? null : diff,
      value_difference: hide || diff === null ? null : core.moneyText(Math.round(diff * it.getInt('unit_cost')), cur),
      updated: l.getString('updated'),
    });
  }
  out.sort((a, b) => (a.location.path < b.location.path ? -1 : a.location.path > b.location.path ? 1 : a.item.name.toLowerCase() < b.item.name.toLowerCase() ? -1 : 1));
  const loc = rec.getString('location');
  let summary = null;
  const raw = rec.getString('summary');
  if (raw !== '' && raw !== 'null') {
    try {
      summary = JSON.parse(raw);
    } catch {
      summary = null;
    }
  }
  return {
    id: rec.id,
    number: rec.getString('number'),
    status: rec.getString('status'),
    blind: rec.getBool('blind'),
    hidden: hide,
    location: loc !== '' && ix.byId[loc] ? { id: loc, name: ix.byId[loc].name, path: ix.path(loc) } : null,
    include_sub: rec.getBool('include_sub'),
    note: rec.getString('note'),
    lines: out,
    line_count: out.length,
    counted: counted,
    progress: out.length > 0 ? counted / out.length : 0,
    differences: hide ? null : { lines: diffLines, units: unitsDiff, value: valueDiff, value_text: core.moneyText(valueDiff, cur) },
    summary: summary,
    batch: rec.getString('batch'),
    completed_on: rec.getString('completed_on'),
    currency: cur,
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function list(app, f) {
  const u = require(`${__hooks}/lib_util.js`);
  const ix = require(`${__hooks}/lib_locations.js`).index(app);
  const filter = f.status ? 'status = {:s}' : '';
  const recs = app.findRecordsByFilter('counts', filter, '-created', f.limit, f.offset, { s: f.status || '' });
  return {
    counts: recs.map((r) => {
      const stats = u.rows(app, 'SELECT COUNT(id) AS n, IFNULL(SUM(CASE WHEN counted_set THEN 1 ELSE 0 END), 0) AS c FROM count_lines WHERE session = {:c}', { n: 0, c: 0 }, { c: r.id });
      const loc = r.getString('location');
      let summary = null;
      try {
        summary = r.getString('summary') !== '' && r.getString('summary') !== 'null' ? JSON.parse(r.getString('summary')) : null;
      } catch {
        summary = null;
      }
      return {
        id: r.id,
        number: r.getString('number'),
        status: r.getString('status'),
        blind: r.getBool('blind'),
        location: loc !== '' && ix.byId[loc] ? { id: loc, name: ix.byId[loc].name, path: ix.path(loc) } : null,
        note: r.getString('note'),
        line_count: stats.length > 0 ? stats[0].n : 0,
        counted: stats.length > 0 ? stats[0].c : 0,
        summary: summary,
        completed_on: r.getString('completed_on'),
        created: r.getString('created'),
      };
    }),
  };
}

/** Start a count of a place (and the places inside it), or of everything. */
function start(app, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const ixLib = require(`${__hooks}/lib_locations.js`);
  const locName = u.str(p, 'location', '');
  const loc = locName !== '' ? core.location(app, locName) : null;
  const includeSub = u.bool(p, 'include_sub', true);
  const onlyRaw = u.list(p, 'items');
  const only = onlyRaw !== undefined && onlyRaw.length > 0 ? onlyRaw.map((x, i) => core.item(app, x, 'items[' + i + ']').id) : null;
  let scope = null;
  if (loc !== null) {
    const ix = ixLib.index(app);
    scope = [loc.id].concat(includeSub ? ix.descendants(loc.id) : []);
  }
  const bind = {};
  let where = 'qty != 0';
  if (scope !== null) {
    where += ' AND location IN (' + scope.map((id, i) => {
      bind['l' + i] = id;
      return '{:l' + i + '}';
    }).join(',') + ')';
  }
  const stock = u.rows(app, 'SELECT item, location, qty FROM stock WHERE ' + where, { item: '', location: '', qty: -0 }, bind);
  let id = '';
  app.runInTransaction((tx) => {
    const rec = new Record(tx.findCollectionByNameOrId('counts'));
    rec.set('number', core.nextNumber(tx, 'counts', 'number', 'C-', 4));
    rec.set('location', loc !== null ? loc.id : '');
    rec.set('include_sub', includeSub);
    rec.set('status', 'counting');
    rec.set('blind', u.bool(p, 'blind', false));
    rec.set('note', u.str(p, 'note', '').slice(0, 500));
    rec.set('completed_on', '');
    rec.set('batch', '');
    tx.save(rec);
    id = rec.id;
    const col = tx.findCollectionByNameOrId('count_lines');
    for (const s of stock) {
      if (only !== null && only.indexOf(s.item) < 0) continue;
      const it = u.byId(tx, 'items', s.item);
      // Archived items are left out, unless the count asks for them by name.
      if (it === null || (it.getBool('archived') && only === null)) continue;
      const l = new Record(col);
      l.set('session', id);
      l.set('item', s.item);
      l.set('location', s.location);
      l.set('expected', u.q3(s.qty));
      l.set('counted', 0);
      l.set('counted_set', false);
      tx.save(l);
    }
    // Items asked for that have no stock here yet still get a line to count.
    if (only !== null) {
      const where2 = loc !== null ? loc.id : '';
      for (const itemId of only) {
        const exists = u.findOne(tx, 'count_lines', 'session = {:c} && item = {:i}', { c: id, i: itemId });
        if (exists !== null) continue;
        const it = tx.findRecordById('items', itemId);
        const place = where2 !== '' ? where2 : it.getString('default_location');
        if (place === '') continue;
        const l = new Record(col);
        l.set('session', id);
        l.set('item', itemId);
        l.set('location', place);
        l.set('expected', 0);
        l.set('counted', 0);
        l.set('counted_set', false);
        tx.save(l);
      }
    }
  });
  return serialize(app, app.findRecordById('counts', id), false);
}

function assertCounting(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  if (rec.getString('status') !== 'counting') {
    throw u.fail(400, rec.getString('number') + ' is ' + rec.getString('status') + (rec.getString('status') === 'completed' ? '; reopen it to count again (counts.reopen).' : '.'));
  }
}

function lineOf(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const l = u.byId(app, 'count_lines', id);
  if (l === null) throw u.fail(404, 'No count line "' + id + '".', 'Line ids are in counts.get.');
  return l;
}

/** Record a counted quantity on a line: counted (the total) or add (one more scan). */
function setLine(app, line, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = app.findRecordById('counts', line.getString('session'));
  assertCounting(rec);
  const it = app.findRecordById('items', line.getString('item'));
  const label = '"' + it.getString('name') + '"';
  if (u.bool(p, 'clear', false)) {
    line.set('counted', 0);
    line.set('counted_set', false);
  } else if (u.has(p, 'add') && u.str(p, 'add', '') !== '') {
    const add = u.qty(p, 'add', { allowNegative: true, fractional: it.getBool('fractional'), label: label });
    const next = u.q3((line.getBool('counted_set') ? line.getFloat('counted') : 0) + add);
    line.set('counted', Math.max(0, next));
    line.set('counted_set', true);
  } else {
    const c = u.qty(p, 'counted', { required: true, fractional: it.getBool('fractional'), label: label });
    line.set('counted', c);
    line.set('counted_set', true);
  }
  app.save(line);
  return serialize(app, rec, false);
}

/** Add a line for an item at a location (it was found where it was not expected). */
function addLine(tx, rec, item, locationId) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const existing = u.findOne(tx, 'count_lines', 'session = {:c} && item = {:i} && location = {:l}', { c: rec.id, i: item.id, l: locationId });
  if (existing !== null) return existing;
  const l = new Record(tx.findCollectionByNameOrId('count_lines'));
  l.set('session', rec.id);
  l.set('item', item.id);
  l.set('location', locationId);
  l.set('expected', ledger.balance(tx, item.id, locationId));
  l.set('counted', 0);
  l.set('counted_set', false);
  tx.save(l);
  return l;
}

/** The place a scan or an added item counts at when the caller does not say. */
function placeFor(app, rec, item, p) {
  const core = require(`${__hooks}/lib_core.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const given = u.str(p, 'location', '');
  if (given !== '') return core.location(app, given).id;
  if (rec.getString('location') !== '') return rec.getString('location');
  if (item.getString('default_location') !== '') return item.getString('default_location');
  throw u.fail(400, 'Say where "' + item.getString('name') + '" was counted: location is required');
}

function addItem(app, rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  assertCounting(rec);
  const it = core.item(app, u.req(p, 'item', 'SKU-0001'));
  const place = placeFor(app, rec, it, p);
  app.runInTransaction((tx) => {
    addLine(tx, rec, it, place);
  });
  return serialize(app, rec, false);
}

/** A scanned code counts one more of its item (or `qty` more). */
function scan(app, rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  assertCounting(rec);
  const code = u.req(p, 'code', '0123456789012');
  const hit = core.lookupCode(app, code);
  if (hit === null) throw u.fail(404, 'Nothing has the code "' + code + '". Add it to an item first.');
  if (hit.type !== 'item') throw u.fail(400, '"' + code + '" is the location ' + hit.record.getString('name') + ', not an item');
  const it = hit.record;
  const add = u.qty(p, 'qty', { positive: true, fractional: it.getBool('fractional'), label: '"' + it.getString('name') + '"' });
  const given = u.str(p, 'location', '');
  let lineId = '';
  app.runInTransaction((tx) => {
    let line = null;
    if (given === '') {
      const mine = tx.findRecordsByFilter('count_lines', 'session = {:c} && item = {:i}', 'created', 1, 0, { c: rec.id, i: it.id });
      if (mine.length > 0) line = mine[0];
    }
    if (line === null) line = addLine(tx, rec, it, placeFor(tx, rec, it, p));
    line.set('counted', u.q3((line.getBool('counted_set') ? line.getFloat('counted') : 0) + (add === null ? 1 : add)));
    line.set('counted_set', true);
    tx.save(line);
    lineId = line.id;
  });
  const out = serialize(app, rec, false);
  out.scanned = { line: lineId, item: { id: it.id, name: it.getString('name'), sku: it.getString('sku') } };
  return out;
}

function removeLine(app, line) {
  const rec = app.findRecordById('counts', line.getString('session'));
  assertCounting(rec);
  app.delete(line);
  return serialize(app, rec, false);
}

/** Finish: set every counted line's stock to what was counted, in one batch. */
function complete(app, rec, p, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  assertCounting(rec);
  const uncounted = u.oneOf(p, 'uncounted', ['keep', 'zero'], 'keep');
  const all = lines(app, rec.id);
  const todo = all.filter((l) => l.getBool('counted_set') || uncounted === 'zero');
  if (todo.length === 0) throw u.fail(400, 'Nothing was counted yet. Count at least one line, or complete with uncounted=zero.');
  const cur = core.currency(app);
  let batch = u.batchId();
  let changed = 0;
  let unitsDiff = 0;
  let valueDiff = 0;
  let missing = 0;
  let surplus = 0;
  app.runInTransaction((tx) => {
    for (const l of todo) {
      const target = l.getBool('counted_set') ? u.q3(l.getFloat('counted')) : 0;
      const r = ledger.setTo(tx, l.getString('item'), l.getString('location'), target, { kind: 'count', reason: 'count', actor: actor, batch: batch, ref_type: 'count', ref: rec.id });
      if (!r.unchanged) {
        const diff = u.q3(target - r.before);
        const it = tx.findRecordById('items', l.getString('item'));
        changed += 1;
        unitsDiff = u.q3(unitsDiff + diff);
        valueDiff += Math.round(diff * it.getInt('unit_cost'));
        if (diff < 0) missing += 1;
        else surplus += 1;
      }
    }
    const c = tx.findRecordById('counts', rec.id);
    c.set('summary', {
      lines: all.length,
      counted: all.filter((l) => l.getBool('counted_set')).length,
      changed: changed,
      missing: missing,
      surplus: surplus,
      units: unitsDiff,
      value: valueDiff,
      value_text: core.moneyText(valueDiff, cur),
      uncounted: uncounted,
    });
    c.set('status', 'completed');
    c.set('completed_on', u.today());
    c.set('batch', changed > 0 ? batch : '');
    tx.save(c);
  });
  return serialize(app, app.findRecordById('counts', rec.id), true);
}

function cancel(app, rec) {
  assertCounting(rec);
  rec.set('status', 'cancelled');
  app.save(rec);
  return serialize(app, rec, true);
}

/** A completed count back to counting: its adjustments are undone first. */
function reopen(app, rec, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const st = rec.getString('status');
  if (st === 'cancelled') {
    rec.set('status', 'counting');
    app.save(rec);
    return serialize(app, rec, false);
  }
  if (st !== 'completed') throw u.fail(400, rec.getString('number') + ' is still being counted');
  if (rec.getString('batch') !== '') {
    ledger.undo(app, rec.getString('batch'), actor);
  } else {
    rec.set('status', 'counting');
    rec.set('completed_on', '');
    app.save(rec);
  }
  return serialize(app, app.findRecordById('counts', rec.id), false);
}

module.exports = {
  lines: lines,
  sync: sync,
  serialize: serialize,
  list: list,
  start: start,
  lineOf: lineOf,
  setLine: setLine,
  addItem: addItem,
  scan: scan,
  removeLine: removeLine,
  complete: complete,
  cancel: cancel,
  reopen: reopen,
};
