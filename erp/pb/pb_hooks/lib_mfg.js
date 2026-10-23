/// <reference path="../pb_data/types.d.ts" />
/**
 * Manufacturing: bills of materials and builds (production orders).
 *
 * - A bill of materials (BOM) says which stock items, and how much of each,
 *   make `output_qty` of a finished stock item, plus labor and overhead per
 *   unit made (`extra_cost`, e4).
 * - A build is planned as a draft (numbered when created, series 'build'),
 *   then completed in ONE transaction: the components go out of the build's
 *   warehouse at average cost, the finished item comes in at their value
 *   plus labor and overhead, and one journal entry (kind 'build') carries
 *   the value: inventory down for the components, inventory up for the
 *   finished goods, applied labor and overhead credited for the extra. The
 *   inventory lines net to the extra, so the ledger keeps agreeing with the
 *   stock valuation.
 * - A draft reads what it will use from its BOM; a completed build's record
 *   of what it used is its stock moves. Voiding a completed build reverses
 *   those moves at their exact values and its journal entry. Drafts are
 *   deleted, never voided.
 * - Whole units: when the finished item or a component is counted in whole
 *   units, the build quantity must keep every quantity whole (a BOM that
 *   makes 4 from 1 egg builds multiples of 4).
 */

/*
 * Modules are looked up once per module instance: each require() resolves
 * the file again (milliseconds per call), and these helpers run in loops.
 */
const loaded = {};
function mod(name) {
  return loaded[name] || (loaded[name] = require(`${__hooks}/${name}.js`));
}
function u() {
  return mod('lib_util');
}
function core() {
  return mod('lib_core');
}
function money() {
  return mod('lib_money');
}
function auth() {
  return mod('lib_auth');
}
function stock() {
  return mod('lib_stock');
}
function ledger() {
  return mod('lib_ledger');
}
function audit() {
  return mod('lib_audit');
}

/* ========================================================== permissions */

function need(ctx, level, what) {
  auth().need(ctx, 'manufacturing', level, what);
}

function can(ctx, level) {
  if (!auth().moduleOn(ctx.app, 'manufacturing')) return false;
  return ctx.isAgent || auth().can(ctx, 'manufacturing', level);
}

function canSeeBooks(ctx) {
  return ctx.isAgent || auth().can(ctx, 'accounting', 'view');
}

/* ============================================================== helpers */

function itemBrief(it) {
  if (it === null || it === undefined) return null;
  return { id: it.id, sku: it.getString('sku'), name: it.getString('name'), unit: it.getString('unit'), kind: it.getString('kind'), fractional: it.getBool('fractional') };
}

function unitOf(it) {
  return it !== null && it !== undefined && it.getString('unit') !== '' ? it.getString('unit') + ' ' : '';
}

function bomLines(app, bomId) {
  return app.findRecordsByFilter('bom_lines', 'bom = {:b}', 'sort', 0, 0, { b: bomId });
}

function outputQty(bom) {
  const q = u().q3(bom.getFloat('output_qty'));
  return q > 0 ? q : 1;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** What a build of `qty` needs of a component listed at `per` for `outQty` made (3 decimals, exact rounding). */
function needOf(qty, per, outQty) {
  const m = money();
  return u().q3(m.mulDiv(m.milli(qty), m.milli(per), m.milli(outQty)) / 1000);
}

/** True when that need is a whole number exactly. */
function wholeNeed(qty, per, outQty) {
  const m = money();
  return (BigInt(m.milli(qty)) * BigInt(m.milli(per))) % BigInt(1000 * m.milli(outQty)) === BigInt(0);
}

/**
 * The step (in thousandths) every build quantity must be a multiple of, so
 * the finished item and every whole-unit component move in whole units.
 */
function stepMilli(finished, outQty, comps) {
  const m = money();
  let k = finished !== null && finished.getBool('fractional') ? 1 : 1000;
  const den = 1000 * m.milli(outQty);
  for (const c of comps) {
    if (c.item.getBool('fractional')) continue;
    const l = m.milli(c.per);
    if (l <= 0) continue;
    // need = k * l / den is whole when k is a multiple of den / gcd(l, den).
    const s = den / gcd(l, den);
    k = (k / gcd(k, s)) * s;
    if (k > 1e12) return k;
  }
  return k;
}

function isMultiple(qty, k) {
  return BigInt(money().milli(qty)) % BigInt(Math.round(k)) === BigInt(0);
}

/**
 * What building `qty` from `bom` in warehouse `whId` takes, read with `app`
 * (pass the transaction handle inside one). Never throws for the BOM's
 * state: problems are listed, assertPlan() refuses them.
 */
function plan(app, bom, qty, whId) {
  const util = u();
  const st = stock();
  const problems = [];
  const name = bom.getString('name');
  const finished = util.byId(app, 'items', bom.getString('item'));
  const outQty = outputQty(bom);
  if (finished === null) problems.push({ status: 409, code: 'not_found', message: 'The finished item of ' + name + ' no longer exists.' });
  else if (finished.getString('kind') !== 'stock') problems.push({ status: 409, code: 'not_stock', message: finished.getString('name') + ' is no longer a stock item, so it cannot be built.' });
  const comps = [];
  for (const l of bomLines(app, bom.id)) {
    const it = util.byId(app, 'items', l.getString('item'));
    if (it === null) {
      problems.push({ status: 409, code: 'not_found', message: 'A component of ' + name + ' no longer exists. Update the bill of materials.' });
      continue;
    }
    if (it.getString('kind') !== 'stock') problems.push({ status: 409, code: 'not_stock', message: it.getString('name') + ' in ' + name + ' is no longer a stock item. Update the bill of materials.' });
    const per = util.q3(l.getFloat('qty'));
    const needQty = needOf(qty, per, outQty);
    const onHand = whId ? st.onHand(app, it.id, whId) : 0;
    comps.push({ line: l.id, item: it, per: per, need: needQty, on_hand: onHand, shortfall: Math.max(0, util.q3(needQty - onHand)) });
  }
  if (comps.length === 0 && problems.length === 0) problems.push({ status: 409, code: 'no_components', message: name + ' has no components. Add them with boms.update --lines.' });
  const k = stepMilli(finished, outQty, comps);
  if (qty > 0 && !isMultiple(qty, k)) {
    const off = comps.find((c) => !c.item.getBool('fractional') && !wholeNeed(qty, c.per, outQty));
    const fin = finished !== null ? finished.getString('name') : name;
    problems.push({
      status: 400,
      code: 'whole_units',
      message:
        (off !== undefined
          ? 'Building ' + util.fmtQty(qty) + ' ' + unitOf(finished) + 'of ' + fin + ' uses ' + util.fmtQty(off.need) + ' ' + unitOf(off.item) + 'of ' + off.item.getString('name') + ', which is counted in whole units. '
          : '') +
        'Build a multiple of ' + util.fmtQty(k / 1000) + ' (' + name + ' makes ' + util.fmtQty(outQty) + ' at a time).',
    });
  }
  return { finished: finished, outQty: outQty, comps: comps, step: util.q3(k / 1000), stepMilli: k, problems: problems };
}

function assertPlan(pl) {
  if (pl.problems.length > 0) {
    const pr = pl.problems[0];
    throw u().fail(pr.status, pr.message, pr.code);
  }
}

/** A BOM by name or id; else the one BOM in use for a finished item named by SKU or name. */
function bomRef(app, ref) {
  const util = u();
  const c = core();
  try {
    return c.resolve(app, 'boms', ref);
  } catch (err) {
    if (!err || err.code !== 'not_found') throw err;
    let item = null;
    try {
      item = c.resolve(app, 'items', ref);
    } catch {
      item = null;
    }
    if (item === null) throw err;
    const inUse = app.findRecordsByFilter('boms', 'item = {:i} && active = true', 'name', 6, 0, { i: item.id });
    if (inUse.length === 1) return inUse[0];
    if (inUse.length > 1) {
      throw util.fail(409, item.getString('name') + ' has ' + inUse.length + ' bills of materials in use: ' + inUse.map((b) => b.getString('name')).join('; ') + '. Name one.', 'ambiguous', { candidates: inUse.map((b) => b.id) });
    }
    throw util.fail(404, item.getString('name') + ' has no bill of materials in use. Add one with boms.add.', 'not_found');
  }
}

function buildRef(app, ref) {
  return core().resolve(app, 'builds', ref);
}

function buildLabel(r) {
  return 'Build ' + (r.getString('number') || r.id);
}

function warehouseParam(app, p) {
  const util = u();
  const ref = util.str(p, 'warehouse', '') || core().defaults(app).warehouse || '';
  if (ref === '') throw util.fail(400, 'warehouse is required (no default warehouse is set)', 'missing_param', { param: 'warehouse' });
  const wh = core().resolve(app, 'warehouses', ref);
  if (wh.getBool('archived')) throw util.fail(409, wh.getString('name') + ' is archived. Build in another warehouse.', 'archived');
  return wh;
}

function journalBrief(app, id, withLines) {
  const j = u().byId(app, 'journals', id);
  if (j === null) return null;
  if (!withLines) return { id: j.id, number: j.getString('number') };
  const out = ledger().journalOut(app, j, true);
  return { id: j.id, number: out.number, date: out.date, state: out.state, total: out.total, total_text: out.total_text, lines: out.lines };
}

/**
 * The lines of a build's journal entry: inventory up for the finished
 * value, inventory down for the components, applied labor and overhead
 * credited for the extra. Signed amounts land on the right side.
 */
function buildJournalLines(app, components, finishedValue, extra, finishedName, label) {
  const lines = [];
  const add = (account, amount, memo) => {
    if (amount > 0) lines.push({ account: account, debit: amount, credit: 0, memo: memo });
    else if (amount < 0) lines.push({ account: account, debit: 0, credit: -amount, memo: memo });
  };
  const inv = core().systemAccount(app, 'inventory').id;
  add(inv, finishedValue, 'Finished ' + finishedName + ' (' + label + ')');
  add(inv, -components, 'Components used by ' + label);
  if (extra !== 0) add(core().systemAccount(app, 'applied_overhead').id, -extra, 'Labor and overhead applied (' + label + ')');
  return lines;
}

/* ================================================== bills of materials */

/** Read and check the components list (no writes). */
function readLines(app, p, finished) {
  const util = u();
  const c = core();
  const input = util.list(p, 'lines');
  if (input === undefined || input.length === 0) throw util.fail(400, 'lines needs at least one component, e.g. [{"item":"SKU-00002","qty":2}]', 'missing_param', { param: 'lines' });
  if (input.length > 200) throw util.fail(400, 'At most 200 components per bill of materials.', 'invalid_param', { param: 'lines' });
  const seen = {};
  return input.map((raw, i) => {
    const n = i + 1;
    if (raw === null || typeof raw !== 'object' || raw.item === undefined || raw.item === null || String(raw.item).trim() === '') {
      throw util.fail(400, 'Component ' + n + ' needs an item, e.g. {"item":"SKU-00002","qty":2}', 'invalid_param', { param: 'lines' });
    }
    util.keysOnly(raw, ['item', 'qty'], 'Component ' + n);
    const it = c.resolve(app, 'items', String(raw.item));
    if (it.id === finished.id) throw util.fail(400, it.getString('name') + ' is the item this makes, so it cannot be its own component.', 'invalid_param', { param: 'lines' });
    if (it.getString('kind') !== 'stock') {
      throw util.fail(400, it.getString('name') + ' is ' + (it.getString('kind') === 'service' ? 'a service' : 'not counted in stock') + '. Components are stock items; put labor and overhead in extra_cost.', 'not_stock', { param: 'lines' });
    }
    if (it.getBool('archived')) throw util.fail(409, it.getString('name') + ' is archived. Restore it or use another item.', 'archived', { param: 'lines' });
    if (seen[it.id]) throw util.fail(400, it.getString('name') + ' is listed twice. Put its total on one line.', 'duplicate', { param: 'lines' });
    seen[it.id] = true;
    let qty;
    try {
      qty = util.qtyOf(raw.qty, 'qty', { required: true, positive: true });
    } catch (err) {
      throw util.fail(400, 'Component ' + n + ' (' + it.getString('name') + '): ' + err.message, 'invalid_param', { param: 'lines' });
    }
    return { item: it, qty: qty };
  });
}

/** A BOM name: given, or the finished item's name made unique. */
function readName(app, p, finished, exceptId) {
  const util = u();
  if (util.has(p, 'name') && util.str(p, 'name', '') !== '') {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (util.idsNocaseFind(app, 'boms', 'name', n, exceptId)) throw util.fail(409, 'A bill of materials is already called ' + n + '. Pick another name.', 'duplicate', { param: 'name' });
    return n;
  }
  const base = finished.getString('name').slice(0, 110);
  let n = base;
  let i = 2;
  while (util.idsNocaseFind(app, 'boms', 'name', n, exceptId) && i < 1000) {
    n = base + ' (' + i + ')';
    i++;
  }
  return n;
}

function readOutputQty(p, finished) {
  return u().qty(p, 'output_qty', { positive: true, whole: !finished.getBool('fractional'), label: finished.getString('name') });
}

function writeLines(tx, bomId, lines) {
  const util = u();
  lines.forEach((l, i) => {
    const r = util.newRecord(tx, 'bom_lines');
    r.set('bom', bomId);
    r.set('item', l.item.id);
    r.set('qty', l.qty);
    r.set('sort', i + 1);
    tx.save(r);
  });
}

/** Which finished quantity the stock on hand allows in each warehouse (the default first). */
function buildable(app, pl) {
  const util = u();
  const m = money();
  const def = core().defaults(app).warehouse || '';
  const all = app.findRecordsByFilter('warehouses', 'archived = false', 'sort,name', 0, 0);
  const ordered = all.filter((w) => w.id === def).concat(all.filter((w) => w.id !== def));
  const held = {};
  for (const c of pl.comps) {
    for (const s of app.findRecordsByFilter('stock', 'item = {:i}', '', 0, 0, { i: c.item.id })) held[c.item.id + '|' + s.getString('warehouse')] = s.getFloat('qty');
  }
  const blocked = pl.problems.some((x) => x.code !== 'whole_units');
  const o = BigInt(m.milli(pl.outQty));
  return ordered.map((w) => {
    let best = null;
    let limit = null;
    for (const c of pl.comps) {
      const per = m.milli(c.per);
      if (per <= 0) continue;
      const avail = held[c.item.id + '|' + w.id] || 0;
      const most = avail <= 0 ? 0 : Number((BigInt(m.milli(avail)) * o) / BigInt(per));
      if (best === null || most < best) {
        best = most;
        limit = c.item;
      }
    }
    let q = best === null || blocked ? 0 : best - (best % pl.stepMilli);
    if (q < 0) q = 0;
    return {
      warehouse: { id: w.id, code: w.getString('code'), name: w.getString('name') },
      default: w.id === def,
      qty: util.q3(q / 1000),
      limited_by: limit !== null ? { id: limit.id, sku: limit.getString('sku'), name: limit.getString('name') } : null,
    };
  });
}

function bomOut(ctx, app, b, detail) {
  const util = u();
  const m = money();
  const st = stock();
  const cur = core().currency(app);
  const item = util.byId(app, 'items', b.getString('item'));
  const outQty = outputQty(b);
  const extraE4 = b.getInt('extra_cost');
  const lines = bomLines(app, b.id);
  const avg = {};
  let exact = BigInt(0);
  let batch = 0;
  const comps = lines.map((l) => {
    const it = util.byId(app, 'items', l.getString('item'));
    const per = util.q3(l.getFloat('qty'));
    let cost = 0;
    if (it !== null) {
      if (avg[it.id] === undefined) avg[it.id] = st.avgCost(app, it.id);
      cost = avg[it.id];
    }
    const lineCost = m.stockValue(per, cost, cur);
    exact += BigInt(m.milli(per)) * BigInt(cost);
    batch += lineCost;
    return {
      line: l.id,
      item: itemBrief(it),
      qty: per,
      per_unit: util.q3(per / outQty),
      avg_cost: m.e4Text(cost, cur),
      avg_cost_e4: cost,
      line_cost: lineCost,
      line_cost_text: m.minorText(lineCost, cur),
      on_hand: it !== null ? st.onHand(app, it.id, '') : 0,
    };
  });
  // Exact cost of one finished unit: sum of (qty x average cost) over what one batch makes.
  const compUnit = m.mulDiv(exact, 1, m.milli(outQty));
  const out = {
    id: b.id,
    name: b.getString('name'),
    item: itemBrief(item),
    output_qty: outQty,
    extra_cost: m.e4Text(extraE4, cur),
    extra_cost_e4: extraE4,
    notes: b.getString('notes'),
    active: b.getBool('active'),
    lines_count: lines.length,
    components_cost: batch,
    components_cost_text: m.minorText(batch, cur),
    component_unit_cost: m.e4Text(compUnit, cur),
    component_unit_cost_e4: compUnit,
    unit_cost: m.e4Text(compUnit + extraE4, cur),
    unit_cost_e4: compUnit + extraE4,
    created: b.getString('created'),
    updated: b.getString('updated'),
    currency: cur,
  };
  if (detail) {
    const pl = plan(app, b, 0, '');
    out.components = comps;
    out.step = pl.step;
    out.problems = pl.problems.filter((x) => x.code !== 'whole_units').map((x) => x.message);
    out.can_build = buildable(app, pl);
    const counts = { draft: 0, done: 0, void: 0 };
    for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM builds WHERE bom = {:b} GROUP BY status', { status: '', n: 0 }, { b: b.id })) counts[r.status] = r.n;
    out.builds = counts;
    out.recent_builds = app.findRecordsByFilter('builds', 'bom = {:b}', '-date,-number', 5, 0, { b: b.id }).map((r) => ({ id: r.id, number: r.getString('number'), status: r.getString('status'), date: r.getString('date'), qty: util.q3(r.getFloat('qty')) }));
    out.can = { edit: can(ctx, 'edit'), build: can(ctx, 'edit') && b.getBool('active') && out.problems.length === 0, delete: can(ctx, 'edit') && counts.draft + counts.done + counts.void === 0 };
  }
  return out;
}

function listBoms(ctx, p) {
  const util = u();
  need(ctx, 'view', 'see bills of materials');
  const app = ctx.app;
  const where = ['1 = 1'];
  const bind = {};
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(b.name LIKE {:q} ESCAPE '\\' OR IFNULL(i.name, '') LIKE {:q} ESCAPE '\\' OR IFNULL(i.sku, '') LIKE {:q} ESCAPE '\\' OR b.notes LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const itemRef = util.str(p, 'item', '');
  if (itemRef !== '') {
    where.push('b.item = {:item}');
    bind.item = core().resolve(app, 'items', itemRef).id;
  }
  const sql = ' FROM boms b LEFT JOIN items i ON i.id = b.item WHERE ' + where.join(' AND ');
  const ids = util.rows(app, "SELECT b.id AS id, IFNULL(i.name, '') AS item_name" + sql + ' ORDER BY item_name COLLATE NOCASE, b.active DESC, b.name COLLATE NOCASE LIMIT 1000', { id: '', item_name: '' }, bind);
  const counts = util.one(app, 'SELECT COUNT(id) AS n, IFNULL(SUM(CASE WHEN active THEN 1 ELSE 0 END), 0) AS active FROM boms', { n: 0, active: 0 });
  return {
    boms: ids.map((r) => bomOut(ctx, app, app.findRecordById('boms', r.id), false)),
    total: ids.length,
    counts: { all: counts.n, active: counts.active, inactive: counts.n - counts.active },
    currency: core().currency(app),
    can: { add: can(ctx, 'edit') },
  };
}

function getBom(ctx, p) {
  need(ctx, 'view', 'see bills of materials');
  const b = bomRef(ctx.app, u().req(p, 'bom'));
  return bomOut(ctx, ctx.app, b, true);
}

function addBom(ctx, p) {
  const util = u();
  need(ctx, 'edit', 'change bills of materials');
  const app = ctx.app;
  const item = core().resolve(app, 'items', util.req(p, 'item', 'SKU-00001'));
  if (item.getString('kind') !== 'stock') throw util.fail(400, item.getString('name') + ' is not a stock item. Only stock items are built.', 'not_stock', { param: 'item' });
  if (item.getBool('archived')) throw util.fail(409, item.getString('name') + ' is archived. Restore it first.', 'archived', { param: 'item' });
  const name = readName(app, p, item, '');
  const outQty = readOutputQty(p, item);
  const extra = util.price(p, 'extra_cost');
  const notes = util.text(p, 'notes', 1000, '');
  const lines = readLines(app, p, item);
  let id = '';
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'boms');
    r.set('item', item.id);
    r.set('name', name);
    r.set('output_qty', outQty !== null ? outQty : 1);
    r.set('extra_cost', extra !== null ? extra : 0);
    r.set('notes', notes);
    r.set('active', true);
    tx.save(r);
    writeLines(tx, r.id, lines);
    audit().write(tx, ctx, {
      kind: 'create',
      entity: 'boms',
      ref: r.id,
      label: name,
      summary: 'Added the bill of materials ' + name + ' for ' + item.getString('name') + ' (' + lines.length + (lines.length === 1 ? ' component)' : ' components)'),
      data: { output_qty: r.getFloat('output_qty'), extra_cost: r.getInt('extra_cost'), lines: lines.map((l) => ({ item: l.item.getString('sku'), qty: l.qty })) },
    });
    id = r.id;
  });
  return getBom(ctx, { bom: id });
}

function updateBom(ctx, p) {
  const util = u();
  need(ctx, 'edit', 'change bills of materials');
  const app = ctx.app;
  const b = bomRef(app, util.req(p, 'bom'));
  const item = app.findRecordById('items', b.getString('item'));
  const name = util.str(p, 'name', '') !== '' ? readName(app, p, item, b.id) : null;
  const outQty = readOutputQty(p, item);
  const extra = util.price(p, 'extra_cost');
  const notes = util.has(p, 'notes') ? util.text(p, 'notes', 1000, '') : null;
  const active = util.bool(p, 'active', null);
  const lines = util.has(p, 'lines') ? readLines(app, p, item) : null;
  const changed = [];
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('boms', b.id);
    if (name !== null && name !== r.getString('name')) {
      r.set('name', name);
      changed.push('name');
    }
    if (outQty !== null) {
      r.set('output_qty', outQty);
      changed.push('output_qty');
    }
    if (extra !== null) {
      r.set('extra_cost', extra);
      changed.push('extra_cost');
    }
    if (notes !== null) {
      r.set('notes', notes);
      changed.push('notes');
    }
    if (active !== null) {
      r.set('active', active);
      changed.push('active');
    }
    tx.save(r);
    if (lines !== null) {
      for (const old of bomLines(tx, r.id)) tx.delete(tx.findRecordById('bom_lines', old.id));
      writeLines(tx, r.id, lines);
      changed.push('lines');
    }
    audit().write(tx, ctx, {
      kind: 'update',
      entity: 'boms',
      ref: r.id,
      label: r.getString('name'),
      summary: 'Changed the bill of materials ' + r.getString('name') + (changed.length > 0 ? ' (' + changed.join(', ') + ')' : ''),
      data: lines !== null ? { lines: lines.map((l) => ({ item: l.item.getString('sku'), qty: l.qty })) } : undefined,
    });
  });
  return getBom(ctx, { bom: b.id });
}

function deleteBom(ctx, p) {
  const util = u();
  need(ctx, 'edit', 'delete bills of materials');
  const app = ctx.app;
  const b = bomRef(app, util.req(p, 'bom'));
  const used = util.rows(app, 'SELECT number, status FROM builds WHERE bom = {:b} ORDER BY number LIMIT 5', { number: '', status: '' }, { b: b.id });
  if (used.length > 0) {
    const n = util.one(app, 'SELECT COUNT(id) AS n FROM builds WHERE bom = {:b}', { n: 0 }, { b: b.id }).n;
    throw util.fail(
      409,
      b.getString('name') + ' is used by ' + n + (n === 1 ? ' build' : ' builds') + ' (' + used.map((x) => x.number + ' ' + x.status).join(', ') + '). Set it not in use (boms.update --active false) instead, so history keeps it.',
      'in_use',
    );
  }
  const lines = bomLines(app, b.id).length;
  if (util.bool(p, 'preview', false)) return { preview: true, id: b.id, name: b.getString('name'), lines: lines, summary: 'Deletes the bill of materials ' + b.getString('name') + ' and its ' + lines + (lines === 1 ? ' component.' : ' components.') };
  app.runInTransaction((tx) => {
    for (const l of bomLines(tx, b.id)) tx.delete(tx.findRecordById('bom_lines', l.id));
    for (const f of tx.findRecordsByFilter('field_marks', "entity = 'boms' && ref = {:r}", '', 0, 0, { r: b.id })) tx.delete(tx.findRecordById('field_marks', f.id));
    tx.delete(tx.findRecordById('boms', b.id));
    audit().write(tx, ctx, { kind: 'delete', entity: 'boms', ref: b.id, label: b.getString('name'), summary: 'Deleted the bill of materials ' + b.getString('name') });
  });
  return { deleted: true, id: b.id, name: b.getString('name') };
}

/* =============================================================== builds */

function buildOut(ctx, app, r, cache) {
  const util = u();
  const m = money();
  const cur = core().currency(app);
  const item = util.byId(app, 'items', r.getString('item'));
  const bom = util.byId(app, 'boms', r.getString('bom'));
  const wh = util.byId(app, 'warehouses', r.getString('warehouse'));
  const qty = util.q3(r.getFloat('qty'));
  const status = r.getString('status');
  const cost = r.getInt('cost');
  const extra = r.getInt('extra');
  return {
    id: r.id,
    number: r.getString('number'),
    label: buildLabel(r),
    status: status,
    date: r.getString('date'),
    qty: qty,
    item: itemBrief(item),
    bom: bom !== null ? { id: bom.id, name: bom.getString('name') } : null,
    warehouse: wh !== null ? { id: wh.id, code: wh.getString('code'), name: wh.getString('name') } : null,
    cost: cost,
    cost_text: m.minorText(cost, cur),
    extra: extra,
    extra_text: m.minorText(extra, cur),
    unit_cost: status !== 'draft' && qty > 0 ? m.e4Text(m.unitCostE4(cost, qty, cur), cur) : '',
    note: r.getString('note'),
    actor: r.getString('actor'),
    who: r.getString('actor') === 'agent' ? 'Your AI agent' : audit().memberName(app, r.getString('member'), cache || {}),
    journal: r.getString('journal') !== '' ? journalBrief(app, r.getString('journal'), false) : null,
    void_journal: r.getString('void_journal') !== '' ? journalBrief(app, r.getString('void_journal'), false) : null,
    created: r.getString('created'),
    updated: r.getString('updated'),
    currency: cur,
  };
}

function listBuilds(ctx, p) {
  const util = u();
  need(ctx, 'view', 'see builds');
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const status = util.oneOf(p, 'status', ['draft', 'done', 'void'], '');
  const filter = status !== '' ? 'status = {:s}' : '';
  const recs = app.findRecordsByFilter('builds', filter, '-date,-number', pg.limit, pg.offset, { s: status });
  const counts = { draft: 0, done: 0, void: 0 };
  let all = 0;
  for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM builds GROUP BY status', { status: '', n: 0 })) {
    counts[r.status] = r.n;
    all += r.n;
  }
  const cache = {};
  return {
    builds: recs.map((r) => buildOut(ctx, app, r, cache)),
    total: status !== '' ? counts[status] || 0 : all,
    counts: counts,
    currency: core().currency(app),
    can: { create: can(ctx, 'edit') },
  };
}

function getBuild(ctx, p) {
  const util = u();
  need(ctx, 'view', 'see builds');
  const app = ctx.app;
  const m = money();
  const st = stock();
  const cur = core().currency(app);
  const r = buildRef(app, util.req(p, 'build', 'MO-00001'));
  const out = buildOut(ctx, app, r, {});
  const status = r.getString('status');
  const bom = util.byId(app, 'boms', r.getString('bom'));
  if (bom !== null) out.bom = { id: bom.id, name: bom.getString('name'), output_qty: outputQty(bom), extra_cost: m.e4Text(bom.getInt('extra_cost'), cur), active: bom.getBool('active') };
  if (status === 'draft') {
    // What it will take now, from its bill of materials.
    const pl = bom !== null ? plan(app, bom, out.qty, r.getString('warehouse')) : { comps: [], problems: [{ message: 'Its bill of materials no longer exists.' }], step: 1 };
    let comp = 0;
    out.components = pl.comps.map((c) => {
      const value = c.need > 0 ? st.outValue(app, c.item.id, c.need) : 0;
      comp += value;
      return {
        line: c.line,
        item: itemBrief(c.item),
        per_batch: c.per,
        need: c.need,
        on_hand: c.on_hand,
        shortfall: c.shortfall,
        avg_cost: m.e4Text(st.avgCost(app, c.item.id), cur),
        value: value,
        value_text: m.minorText(value, cur),
      };
    });
    const extra = bom !== null ? m.stockValue(out.qty, bom.getInt('extra_cost'), cur) : 0;
    out.estimated = true;
    out.components_value = comp;
    out.components_value_text = m.minorText(comp, cur);
    out.extra = extra;
    out.extra_text = m.minorText(extra, cur);
    out.cost = comp + extra;
    out.cost_text = m.minorText(comp + extra, cur);
    out.unit_cost = out.qty > 0 ? m.e4Text(m.unitCostE4(comp + extra, out.qty, cur), cur) : '';
    out.step = pl.step;
    out.problems = pl.problems.map((x) => x.message);
    out.shortfalls = out.components.filter((c) => c.shortfall > 0).length;
    out.allow_negative_stock = core().settings(app).getBool('allow_negative_stock');
    out.ready = out.problems.length === 0 && (out.shortfalls === 0 || out.allow_negative_stock);
  } else {
    // What it took: its stock moves.
    const moves = util.rows(
      app,
      "SELECT m.id AS id, m.date AS date, m.kind AS kind, m.qty AS qty, m.value AS value, m.reverses AS reverses, m.source_line AS line, i.id AS item, i.sku AS sku, i.name AS name, i.unit AS unit, IFNULL(w.name, '') AS warehouse FROM stock_moves m JOIN items i ON i.id = m.item LEFT JOIN warehouses w ON w.id = m.warehouse WHERE m.source_entity = 'builds' AND m.source_id = {:b} ORDER BY m.created, m.id",
      { id: '', date: '', kind: '', qty: -0, value: 0, reverses: '', line: '', item: '', sku: '', name: '', unit: '', warehouse: '' },
      { b: r.id },
    );
    let comp = 0;
    out.components = moves
      .filter((x) => x.kind === 'build_out' && x.reverses === '')
      .map((x) => {
        comp += -x.value;
        return { line: x.line, item: { id: x.item, sku: x.sku, name: x.name, unit: x.unit }, used: util.q3(-x.qty), value: -x.value, value_text: m.minorText(-x.value, cur) };
      });
    out.estimated = false;
    out.components_value = comp;
    out.components_value_text = m.minorText(comp, cur);
    out.moves = moves.map((x) => ({ id: x.id, date: x.date, kind: x.kind, item: { id: x.item, sku: x.sku, name: x.name, unit: x.unit }, warehouse: x.warehouse, qty: util.q3(x.qty), value: x.value, reversal: x.reverses !== '' }));
    if (canSeeBooks(ctx)) {
      if (r.getString('journal') !== '') out.journal = journalBrief(app, r.getString('journal'), true);
      if (r.getString('void_journal') !== '') out.void_journal = journalBrief(app, r.getString('void_journal'), true);
    }
  }
  out.can = {
    edit: status === 'draft' && can(ctx, 'edit'),
    complete: status === 'draft' && can(ctx, 'full'),
    void: status === 'done' && can(ctx, 'full'),
    delete: status === 'draft' && can(ctx, 'edit'),
  };
  return out;
}

function createBuild(ctx, p) {
  const util = u();
  need(ctx, 'edit', 'plan builds');
  const app = ctx.app;
  const bom = bomRef(app, util.req(p, 'bom'));
  if (!bom.getBool('active')) throw util.fail(409, bom.getString('name') + ' is not in use. Turn it back on (boms.update --active true) or pick another bill of materials.', 'bom_inactive');
  const finished = util.byId(app, 'items', bom.getString('item'));
  const qty = util.qty(p, 'qty', { required: true, positive: true, whole: finished !== null && !finished.getBool('fractional'), label: finished !== null ? finished.getString('name') : 'This item' });
  const wh = warehouseParam(app, p);
  const date = util.day(p, 'date', util.today());
  const note = util.text(p, 'note', 1000, '');
  assertPlan(plan(app, bom, qty, wh.id));
  let id = '';
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'builds');
    r.set('number', core().nextNumber(tx, 'build'));
    r.set('bom', bom.id);
    r.set('item', bom.getString('item'));
    r.set('qty', qty);
    r.set('warehouse', wh.id);
    r.set('date', date);
    r.set('status', 'draft');
    r.set('cost', 0);
    r.set('extra', 0);
    r.set('note', note);
    r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
    r.set('member', ctx.memberId || '');
    tx.save(r);
    audit().write(tx, ctx, {
      kind: 'create',
      entity: 'builds',
      ref: r.id,
      label: buildLabel(r),
      summary: 'Planned ' + buildLabel(r) + ': ' + util.fmtQty(qty) + ' ' + unitOf(finished) + 'of ' + (finished !== null ? finished.getString('name') : '') + ' in ' + wh.getString('name'),
    });
    id = r.id;
  });
  return getBuild(ctx, { build: id });
}

function draftOnly(r, verb) {
  const st = r.getString('status');
  if (st === 'draft') return;
  throw u().fail(409, buildLabel(r) + ' is ' + st + '; only a draft build can be ' + verb + '.', 'invalid_state', { status: st });
}

function updateBuild(ctx, p) {
  const util = u();
  need(ctx, 'edit', 'change builds');
  const app = ctx.app;
  const b = buildRef(app, util.req(p, 'build'));
  draftOnly(b, 'changed');
  const bom = util.byId(app, 'boms', b.getString('bom'));
  if (bom === null) throw util.fail(409, 'The bill of materials of ' + buildLabel(b) + ' no longer exists. Delete the draft.', 'not_found');
  const finished = util.byId(app, 'items', b.getString('item'));
  const qty = util.qty(p, 'qty', { positive: true, whole: finished !== null && !finished.getBool('fractional'), label: finished !== null ? finished.getString('name') : 'This item' });
  const wh = util.has(p, 'warehouse') && util.str(p, 'warehouse', '') !== '' ? warehouseParam(app, p) : null;
  const date = util.day(p, 'date', '');
  const note = util.has(p, 'note') ? util.text(p, 'note', 1000, '') : null;
  const newQty = qty !== null ? qty : util.q3(b.getFloat('qty'));
  assertPlan(plan(app, bom, newQty, wh !== null ? wh.id : b.getString('warehouse')));
  const changed = [];
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('builds', b.id);
    draftOnly(r, 'changed');
    if (qty !== null && qty !== util.q3(r.getFloat('qty'))) {
      r.set('qty', qty);
      changed.push('quantity ' + util.fmtQty(qty));
    }
    if (wh !== null && wh.id !== r.getString('warehouse')) {
      r.set('warehouse', wh.id);
      changed.push('warehouse ' + wh.getString('name'));
    }
    if (date !== '' && date !== r.getString('date')) {
      r.set('date', date);
      changed.push('date ' + date);
    }
    if (note !== null && note !== r.getString('note')) {
      r.set('note', note);
      changed.push('note');
    }
    tx.save(r);
    audit().write(tx, ctx, { kind: 'update', entity: 'builds', ref: r.id, label: buildLabel(r), summary: 'Changed ' + buildLabel(r) + (changed.length > 0 ? ': ' + changed.join(', ') : '') });
  });
  return getBuild(ctx, { build: b.id });
}

/** The parts of a completion every caller checks first (no writes). */
function readCompletion(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = buildRef(app, util.req(p, 'build', 'MO-00001'));
  draftOnly(b, 'completed');
  const date = util.day(p, 'date', b.getString('date') || util.today());
  const bom = util.byId(app, 'boms', b.getString('bom'));
  if (bom === null) throw util.fail(409, 'The bill of materials of ' + buildLabel(b) + ' no longer exists. Delete the draft.', 'not_found');
  const qty = util.q3(b.getFloat('qty'));
  const pl = plan(app, bom, qty, b.getString('warehouse'));
  assertPlan(pl);
  return { build: b, bom: bom, date: date, qty: qty, plan: pl };
}

function completeBuild(ctx, p) {
  const util = u();
  need(ctx, 'full', 'complete builds');
  const app = ctx.app;
  const o = readCompletion(ctx, p);
  ledger().checkDate(app, ctx, o.date);
  const cur = core().currency(app);
  app.runInTransaction((tx) => {
    const m = money();
    const st = stock();
    const r = tx.findRecordById('builds', o.build.id);
    draftOnly(r, 'completed');
    const bom = tx.findRecordById('boms', r.getString('bom'));
    const qty = util.q3(r.getFloat('qty'));
    const wh = r.getString('warehouse');
    const pl = plan(tx, bom, qty, wh);
    assertPlan(pl);
    const label = buildLabel(r);
    const src = { entity: 'builds', id: r.id, label: label };
    const batch = util.token(15);
    const moves = [];
    let components = 0;
    let residual = 0;
    for (const c of pl.comps) {
      if (c.need <= 0) continue;
      const res = st.move(tx, ctx, {
        item: tx.findRecordById('items', c.item.id),
        warehouse: wh,
        qty: -c.need,
        kind: 'build_out',
        date: o.date,
        source: Object.assign({}, src, { line: c.line }),
        batch: batch,
        note: label,
      });
      moves.push(res.move);
      components += -res.value;
      residual += res.residual;
    }
    const extra = m.stockValue(qty, bom.getInt('extra_cost'), cur);
    const finishedValue = components + extra;
    const fin = st.move(tx, ctx, {
      item: tx.findRecordById('items', pl.finished.id),
      warehouse: wh,
      qty: qty,
      value: finishedValue,
      kind: 'build_in',
      date: o.date,
      source: src,
      batch: batch,
      note: label,
    });
    moves.push(fin.move);
    residual += fin.residual;
    const lines = buildJournalLines(tx, components, finishedValue, extra, pl.finished.getString('name'), label);
    for (const l of st.residualLines(tx, residual)) lines.push(l);
    const j = ledger().post(
      tx,
      ctx,
      { kind: 'build', date: o.date, memo: label + ': ' + util.fmtQty(qty) + ' ' + unitOf(pl.finished) + 'of ' + pl.finished.getString('name'), source: src, lines: lines },
      { allowControl: true },
    );
    if (j !== null) st.linkJournal(tx, moves, j.id);
    const fresh = tx.findRecordById('builds', r.id);
    fresh.set('status', 'done');
    fresh.set('date', o.date);
    fresh.set('cost', finishedValue);
    fresh.set('extra', extra);
    fresh.set('journal', j !== null ? j.id : '');
    tx.save(fresh);
    audit().write(tx, ctx, {
      kind: 'post',
      entity: 'builds',
      ref: r.id,
      label: label,
      summary:
        'Completed ' + label + ': ' + util.fmtQty(qty) + ' ' + unitOf(pl.finished) + 'of ' + pl.finished.getString('name') + ' at ' + m.fmt(finishedValue, cur) + (ctx.approving ? ' (proposed by your AI agent)' : ''),
      data: { journal: j !== null ? j.getString('number') : '', components: components, extra: extra, cost: finishedValue, currency: cur },
    });
  });
  return getBuild(ctx, { build: o.build.id });
}

function previewComplete(ctx, p) {
  const util = u();
  need(ctx, 'full', 'complete builds');
  const app = ctx.app;
  const m = money();
  const st = stock();
  const o = readCompletion(ctx, p);
  const cur = core().currency(app);
  const label = buildLabel(o.build);
  let components = 0;
  const short = [];
  for (const c of o.plan.comps) {
    if (c.need <= 0) continue;
    components += st.outValue(app, c.item.id, c.need);
    if (c.shortfall > 0) short.push(util.fmtQty(c.shortfall) + ' ' + unitOf(c.item) + 'of ' + c.item.getString('name'));
  }
  const extra = m.stockValue(o.qty, o.bom.getInt('extra_cost'), cur);
  const finishedValue = components + extra;
  const lines = buildJournalLines(app, components, finishedValue, extra, o.plan.finished.getString('name'), label);
  const wh = util.byId(app, 'warehouses', o.build.getString('warehouse'));
  const warnings = [];
  if (short.length > 0) {
    warnings.push((core().settings(app).getBool('allow_negative_stock') ? 'Stock goes negative: short ' : 'Short now, so approval fails unless stock arrives: ') + short.join(', ') + ' in ' + (wh !== null ? wh.getString('name') : 'the warehouse') + '.');
  }
  try {
    ledger().checkDate(app, ctx, o.date);
  } catch (err) {
    warnings.push(String((err && err.message) || err));
  }
  const fin = o.plan.finished;
  return {
    kind: 'build',
    auto: 'build',
    amount: finishedValue,
    title: 'Complete build ' + o.build.getString('number') + ': ' + util.fmtQty(o.qty) + ' ' + unitOf(fin) + 'of ' + fin.getString('name'),
    summary:
      'Uses components worth about ' + m.fmt(components, cur) + ' from ' + (wh !== null ? wh.getString('name') : 'the warehouse') + ' and adds ' + m.fmt(extra, cur) + ' of labor and overhead: ' +
      util.fmtQty(o.qty) + ' ' + unitOf(fin) + 'of ' + fin.getString('name') + ' at ' + m.fmt(finishedValue, cur) + ', dated ' + o.date + '.',
    lines: ledger().describeLines(app, lines),
    currency: cur,
    warning: warnings.join(' '),
    target: { entity: 'builds', id: o.build.id, label: label },
  };
}

function doneOnly(r) {
  const st = r.getString('status');
  if (st === 'done') return;
  throw u().fail(409, buildLabel(r) + ' is ' + st + (st === 'draft' ? '; a draft is deleted, not voided.' : '; only a completed build can be voided.'), 'invalid_state', { status: st });
}

function voidBuild(ctx, p) {
  const util = u();
  need(ctx, 'full', 'void builds');
  const app = ctx.app;
  const b = buildRef(app, util.req(p, 'build', 'MO-00001'));
  doneOnly(b);
  const reason = util.text(p, 'reason', 500, '');
  app.runInTransaction((tx) => {
    const st = stock();
    const L = ledger();
    const r = tx.findRecordById('builds', b.id);
    doneOnly(r);
    const label = buildLabel(r);
    const src = { entity: 'builds', id: r.id, label: label };
    const date = L.firstOpenDate(tx, ctx, r.getString('date'));
    // The finished goods go back out and the components come back, at exactly the values they moved with.
    const back = st.reverseSource(tx, ctx, 'builds', r.id, date, 'Void ' + label);
    let rev = null;
    if (r.getString('journal') !== '') rev = L.reverse(tx, ctx, r.getString('journal'), { date: date, memo: 'Void ' + label + (reason !== '' ? ': ' + reason : ''), source: src });
    if (back.residual !== 0) {
      L.post(tx, ctx, { kind: 'reversal', date: date, memo: 'Stock value left after voiding ' + label, source: src, lines: st.residualLines(tx, back.residual) }, { allowControl: true });
    }
    if (rev !== null) st.linkJournal(tx, back.moves, rev.id);
    const fresh = tx.findRecordById('builds', r.id);
    fresh.set('status', 'void');
    fresh.set('void_journal', rev !== null ? rev.id : '');
    tx.save(fresh);
    audit().write(tx, ctx, {
      kind: 'void',
      entity: 'builds',
      ref: r.id,
      label: label,
      summary: 'Voided ' + label + (reason !== '' ? ': ' + reason : '') + (ctx.approving ? ' (proposed by your AI agent)' : ''),
      data: { journal: rev !== null ? rev.getString('number') : '', date: date },
    });
  });
  return getBuild(ctx, { build: b.id });
}

function previewVoid(ctx, p) {
  const util = u();
  need(ctx, 'full', 'void builds');
  const app = ctx.app;
  const m = money();
  const b = buildRef(app, util.req(p, 'build', 'MO-00001'));
  doneOnly(b);
  const cur = core().currency(app);
  const label = buildLabel(b);
  const L = ledger();
  const lines = b.getString('journal') !== '' ? L.linesOf(app, b.getString('journal')).map((l) => Object.assign({}, l, { debit: l.credit, credit: l.debit })) : [];
  const item = util.byId(app, 'items', b.getString('item'));
  const wh = util.byId(app, 'warehouses', b.getString('warehouse'));
  const qty = util.q3(b.getFloat('qty'));
  let warning = '';
  if (item !== null && !core().settings(app).getBool('allow_negative_stock')) {
    const have = stock().onHand(app, item.id, b.getString('warehouse'));
    if (have < qty) warning = 'Only ' + util.fmtQty(have) + ' ' + unitOf(item) + 'of ' + item.getString('name') + ' is left in ' + (wh !== null ? wh.getString('name') : 'the warehouse') + ', so the void is refused until ' + util.fmtQty(qty) + ' are there.';
  }
  const reason = util.str(p, 'reason', '');
  return {
    kind: 'void',
    auto: '',
    amount: b.getInt('cost'),
    title: 'Void build ' + b.getString('number'),
    summary:
      'Reverses ' + label + ': takes ' + util.fmtQty(qty) + ' ' + unitOf(item) + 'of ' + (item !== null ? item.getString('name') : 'the finished item') + ' (' + m.fmt(b.getInt('cost'), cur) + ') out of ' +
      (wh !== null ? wh.getString('name') : 'the warehouse') + ' and returns its components' + (reason !== '' ? ': ' + reason : '') + '.',
    lines: L.describeLines(app, lines),
    currency: cur,
    warning: warning,
    target: { entity: 'builds', id: b.id, label: label },
  };
}

function deleteBuild(ctx, p) {
  const util = u();
  need(ctx, 'edit', 'delete builds');
  const app = ctx.app;
  const b = buildRef(app, util.req(p, 'build', 'MO-00001'));
  if (b.getString('status') !== 'draft') {
    throw util.fail(409, buildLabel(b) + ' is ' + b.getString('status') + '. Only drafts are deleted' + (b.getString('status') === 'done' ? '; void a completed build instead.' : '.'), 'not_deletable', { status: b.getString('status') });
  }
  const label = buildLabel(b);
  if (util.bool(p, 'preview', false)) return { preview: true, id: b.id, number: b.getString('number'), label: label, summary: 'Deletes the draft ' + label + '. Nothing was posted, so no stock or entry changes.' };
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('builds', b.id);
    draftOnly(r, 'deleted');
    for (const f of tx.findRecordsByFilter('field_marks', "entity = 'builds' && ref = {:r}", '', 0, 0, { r: r.id })) tx.delete(tx.findRecordById('field_marks', f.id));
    tx.delete(r);
    audit().write(tx, ctx, { kind: 'delete', entity: 'builds', ref: b.id, label: label, summary: 'Deleted the draft ' + label });
  });
  return { deleted: true, id: b.id, number: b.getString('number') };
}

module.exports = {
  listBoms: listBoms,
  getBom: getBom,
  addBom: addBom,
  updateBom: updateBom,
  deleteBom: deleteBom,
  listBuilds: listBuilds,
  getBuild: getBuild,
  createBuild: createBuild,
  updateBuild: updateBuild,
  completeBuild: completeBuild,
  previewComplete: previewComplete,
  voidBuild: voidBuild,
  previewVoid: previewVoid,
  deleteBuild: deleteBuild,
  plan: plan,
};
