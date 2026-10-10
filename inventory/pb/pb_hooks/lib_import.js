/// <reference path="../pb_data/types.d.ts" />
/**
 * Importing items from a spreadsheet (CSV), and undoing an import.
 *
 * Every CSV is stored as an `imports` record first (from a local path given
 * by the AI agent, or a file uploaded in the app), previewed, then imported
 * in one transaction. Columns are matched by their header to a fixed set of
 * fields (exact header names, listed in FIELDS); the user or the agent can
 * point any field at any column. The same plan() feeds the preview and the
 * import, so what was previewed is exactly what gets written.
 *
 * Rows are matched to existing items by SKU (else by exact name): matched
 * items are updated, others created. Quantities either set the stock at the
 * row's location (a stock take) or add to it (a delivery). Missing
 * categories, suppliers and locations are created when allowed.
 *
 * Undo deletes the items the import created, puts back the fields it
 * changed, reverses its stock changes, and removes categories, suppliers
 * and locations it created that nothing uses any more.
 */

const FIELDS = [
  { key: 'name', label: 'Name', headers: ['name', 'item', 'item name', 'product', 'product name', 'title'] },
  { key: 'sku', label: 'SKU', headers: ['sku', 'item code', 'product code', 'part number', 'part no', 'article number', 'code'] },
  { key: 'barcode', label: 'Barcode', headers: ['barcode', 'barcodes', 'upc', 'ean', 'gtin'] },
  { key: 'category', label: 'Category', headers: ['category', 'group'] },
  { key: 'unit', label: 'Unit', headers: ['unit', 'uom', 'unit of measure'] },
  { key: 'quantity', label: 'Quantity', headers: ['quantity', 'qty', 'on hand', 'stock', 'in stock', 'quantity on hand'] },
  { key: 'location', label: 'Location', headers: ['location', 'place', 'bin', 'shelf', 'warehouse'] },
  { key: 'min_qty', label: 'Reorder point', headers: ['reorder point', 'min', 'minimum', 'min qty', 'reorder level', 'low stock alert'] },
  { key: 'max_qty', label: 'Target level', headers: ['target level', 'max', 'maximum', 'max qty', 'par level', 'target'] },
  { key: 'unit_cost', label: 'Unit cost', headers: ['unit cost', 'cost', 'purchase price', 'cost price', 'unit price', 'price'] },
  { key: 'supplier', label: 'Supplier', headers: ['supplier', 'vendor'] },
  { key: 'description', label: 'Description', headers: ['description', 'notes', 'note', 'details'] },
];

const QUANTITIES = ['set', 'add'];

function normHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

function filePath(app, imp) {
  return require(`${__hooks}/lib_util.js`).filePath(app, imp, 'file');
}

function basename(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || 'items.csv';
}

/** The import to work on: an existing one (import_id) or a new one from path / upload. */
function source(app, p, ev) {
  const u = require(`${__hooks}/lib_util.js`);
  const id = u.str(p, 'import_id', '');
  if (id !== '') {
    const imp = u.byId(app, 'imports', id);
    if (imp === null) throw u.fail(404, 'No import "' + id + '".', 'Start with import.preview --path <file>.');
    return imp;
  }
  let file = null;
  let filename = '';
  const path = u.str(p, 'path', '');
  if (path !== '') {
    file = u.localFile(path, 'path');
    filename = basename(path);
  } else {
    file = u.uploaded(ev, 'file');
    if (file !== null) filename = String(file.originalName || 'items.csv');
  }
  if (file === null) throw u.fail(400, 'Give path (the absolute path of a CSV file), import_id, or upload a file');
  const rec = new Record(app.findCollectionByNameOrId('imports'));
  rec.set('file', file);
  rec.set('filename', filename.slice(0, 255));
  rec.set('status', 'previewed');
  rec.set('rows', 0);
  rec.set('added', 0);
  rec.set('changed', 0);
  rec.set('skipped', 0);
  rec.set('mapping', {});
  rec.set('result', {});
  app.save(rec);
  return rec;
}

function readJson(rec, field) {
  const raw = rec.getString(field);
  if (raw === '' || raw === 'null') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function table(app, imp) {
  const u = require(`${__hooks}/lib_util.js`);
  const csv = require(`${__hooks}/lib_csv.js`);
  const text = csv.readText(filePath(app, imp));
  const rows = csv.parseRows(text, csv.detectDelimiter(text));
  if (rows.length === 0) throw u.fail(400, 'The file is empty');
  const header = rows[0];
  return { header: header, rows: rows.slice(1) };
}

/** Options = the mapping remembered from the last preview, then the params. */
function options(app, imp, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const saved = readJson(imp, 'mapping');
  const t = table(app, imp);
  const mapping = {};
  for (const f of FIELDS) {
    let idx = -1;
    if (saved.mapping && saved.mapping[f.key] !== undefined) idx = saved.mapping[f.key];
    else {
      for (let i = 0; i < t.header.length; i++) {
        if (f.headers.indexOf(normHeader(t.header[i])) >= 0) {
          idx = i;
          break;
        }
      }
    }
    const param = 'map_' + f.key;
    if (u.has(p, param)) {
      const v = u.str(p, param, '');
      if (v === '' || v === '-1' || v === 'none') idx = -1;
      else if (/^\d+$/.test(v) && Number(v) < t.header.length) idx = Number(v);
      else {
        const byName = t.header.map((h) => normHeader(h)).indexOf(normHeader(v));
        if (byName < 0) throw u.fail(400, param + ' must be a column number (0 is the first) or a header from the file: ' + t.header.join(', '));
        idx = byName;
      }
    }
    mapping[f.key] = idx;
  }
  return {
    mapping: mapping,
    quantities: u.oneOf(p, 'quantities', QUANTITIES, saved.quantities || 'set'),
    create_missing: u.bool(p, 'create_missing', saved.create_missing !== undefined ? saved.create_missing : true),
    table: t,
  };
}

/** A number cell: "1,234.5" (commas only between thousands) or "12". null when empty. */
function numberCell(v) {
  const s = String(v || '').trim().replace(/\s/g, '');
  if (s === '') return { empty: true };
  if (!/^-?(\d{1,3}(,\d{3})+|\d*)(\.\d+)?$/.test(s) || s === '-' || s === '.') return { bad: true };
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? { value: n } : { bad: true };
}

/** A money cell: "$4.25", "4.25 USD", "1,200" -> ten-thousandths. */
function costCell(v) {
  const u = require(`${__hooks}/lib_util.js`);
  const t = String(v || '').trim().replace(/\s/g, '');
  // A currency sign in front is fine; a minus is not (a cost is never negative).
  if ((t.match(/^[^\d.]*/) || [''])[0].indexOf('-') >= 0) return { bad: true };
  const s = t
    .replace(/^[^\d.]+/, '')
    .replace(/[^\d.,]+$/, '');
  if (s === '') return { empty: String(v || '').trim() === '' , bad: String(v || '').trim() !== '' };
  if (!/^(\d{1,3}(,\d{3})+|\d*)(\.\d+)?$/.test(s)) return { bad: true };
  const e4 = u.toE4(s.replace(/,/g, ''));
  return e4 === null ? { bad: true } : { value: e4 };
}

/** Look up a location by code, name or path without throwing; null when absent. */
function findLocation(ix, value) {
  const u = require(`${__hooks}/lib_util.js`);
  const v = u.squash(value);
  const lower = v.toLowerCase();
  const byCode = ix.list.filter((l) => l.code.toLowerCase() === lower);
  if (byCode.length === 1) return { id: byCode[0].id };
  const byPath = ix.list.filter((l) => ix.path(l.id).toLowerCase() === lower.split(/\s*\/\s*/).join(' / '));
  if (byPath.length === 1) return { id: byPath[0].id };
  const byName = ix.list.filter((l) => l.name.toLowerCase() === lower);
  if (byName.length === 1) return { id: byName[0].id };
  if (byName.length > 1) return { ambiguous: byName.map((l) => ix.path(l.id)) };
  return null;
}

/** What importing with these options would do, row by row. */
function plan(app, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const locs = require(`${__hooks}/lib_locations.js`);
  const t = opts.table;
  const m = opts.mapping;
  const ix = locs.index(app);
  const cell = (row, key) => (m[key] >= 0 && m[key] < row.length ? String(row[m[key]] || '').trim() : '');
  const seenSku = {};
  const firstRow = {};
  const seenCode = {};
  const newCats = {};
  const newSups = {};
  const newLocs = {};
  const counts = { rows: t.rows.length, create: 0, update: 0, skip: 0, invalid: 0 };
  const out = [];
  const defaultLoc = ix.roots.length > 0 ? ix.roots[0] : '';
  // A new item spread over several rows is fractional when any of its rows has a decimal.
  const decimalsOf = {};
  for (const row of t.rows) {
    const sku = cell(row, 'sku');
    const id = sku !== '' ? 'sku:' + sku.toLowerCase() : 'name:' + u.squash(cell(row, 'name')).toLowerCase();
    for (const key of ['quantity', 'min_qty', 'max_qty']) {
      const c = numberCell(cell(row, key));
      if (!c.bad && !c.empty && !Number.isInteger(u.q3(c.value))) decimalsOf[id] = true;
    }
  }
  for (let i = 0; i < t.rows.length; i++) {
    const row = t.rows[i];
    const errors = [];
    const vals = {};
    for (const f of FIELDS) vals[f.key] = cell(row, f.key);
    const any = FIELDS.some((f) => vals[f.key] !== '');
    if (!any) {
      counts.skip += 1;
      out.push({ n: i + 2, action: 'skip', name: '', sku: '', errors: [], values: vals });
      continue;
    }
    // Which item: by SKU, else by exact name. One item may span several rows
    // (one per location); the first row creates it, later rows add to it.
    let existing = null;
    const identity = vals.sku !== '' ? 'sku:' + vals.sku.toLowerCase() : 'name:' + u.squash(vals.name).toLowerCase();
    const placeKey = identity + '|' + u.squash(vals.location).toLowerCase();
    if (seenSku[placeKey] !== undefined) errors.push('The same item and location are also on row ' + seenSku[placeKey]);
    seenSku[placeKey] = i + 2;
    // Only a valid row starts an item; until one does, the next row of it is its first.
    const laterRow = firstRow[identity] !== undefined;
    if (vals.sku !== '') {
      if (/\s/.test(vals.sku)) errors.push('SKU "' + vals.sku + '" contains spaces');
      const ids = u.idsNocase(app, 'items', 'sku', vals.sku, 1);
      if (ids.length > 0) existing = u.byId(app, 'items', ids[0]);
      else {
        const owner = core.codeOwner(app, vals.sku, '', '');
        if (owner !== null) errors.push('SKU "' + vals.sku + '" is already used by ' + owner.label);
      }
    } else if (vals.name !== '') {
      const ids = u.idsNocase(app, 'items', 'name', u.squash(vals.name), 3);
      if (ids.length > 1) errors.push('More than one item is called "' + vals.name + '"; add a SKU column to say which');
      else if (ids.length === 1) existing = u.byId(app, 'items', ids[0]);
    }
    if (existing === null && vals.name === '' && !laterRow) errors.push('A new item needs a name');

    const num = {};
    for (const key of ['quantity', 'min_qty', 'max_qty']) {
      const c = numberCell(vals[key]);
      if (c.bad) errors.push(FIELDS.filter((f) => f.key === key)[0].label + ' "' + vals[key] + '" is not a number');
      else if (!c.empty) {
        if (c.value < 0) errors.push(FIELDS.filter((f) => f.key === key)[0].label + ' cannot be negative');
        num[key] = u.q3(c.value);
      }
    }
    const decimals = Object.keys(num).some((k) => !Number.isInteger(num[k]));
    const fractional = existing !== null ? existing.getBool('fractional') : decimalsOf[identity] === true;
    if (existing !== null && decimals && !fractional) errors.push('"' + existing.getString('name') + '" is counted in whole units, so its numbers must be whole');
    const min = num.min_qty !== undefined ? num.min_qty : existing !== null ? existing.getFloat('min_qty') : 0;
    const max = num.max_qty !== undefined ? num.max_qty : existing !== null ? existing.getFloat('max_qty') : 0;
    if (max > 0 && max < min) errors.push('Target level ' + max + ' is below the reorder point ' + min);
    let cost = null;
    if (vals.unit_cost !== '') {
      const c = costCell(vals.unit_cost);
      if (c.bad) errors.push('Unit cost "' + vals.unit_cost + '" is not an amount');
      else cost = c.value;
    }
    const barcodes = vals.barcode !== '' ? vals.barcode.split(/\s*[|;]\s*/).filter((x) => x !== '') : [];
    for (const b of barcodes) {
      if (seenCode[b] !== undefined && seenCode[b].identity !== identity) errors.push('Barcode "' + b + '" is also on row ' + seenCode[b].row);
      if (seenCode[b] === undefined) seenCode[b] = { row: i + 2, identity: identity };
      const owner = core.codeOwner(app, b, existing !== null ? existing.id : '', '');
      if (owner !== null) errors.push('Barcode "' + b + '" is already used by ' + owner.label);
    }
    let categoryId = null;
    if (vals.category !== '') {
      const ids = u.idsNocase(app, 'categories', 'name', u.squash(vals.category), 1);
      if (ids.length > 0) categoryId = ids[0];
      else if (opts.create_missing) newCats[u.squash(vals.category).toLowerCase()] = u.squash(vals.category);
      else errors.push('No category "' + vals.category + '"');
    }
    let supplierId = null;
    if (vals.supplier !== '') {
      const ids = u.idsNocase(app, 'suppliers', 'name', u.squash(vals.supplier), 1);
      if (ids.length > 0) supplierId = ids[0];
      else if (opts.create_missing) newSups[u.squash(vals.supplier).toLowerCase()] = u.squash(vals.supplier);
      else errors.push('No supplier "' + vals.supplier + '"');
    }
    let locationId = null;
    let locationPath = '';
    if (vals.location !== '') {
      const hit = findLocation(ix, vals.location);
      if (hit !== null && hit.id) locationId = hit.id;
      else if (hit !== null && hit.ambiguous) errors.push('Location "' + vals.location + '" matches several places: ' + hit.ambiguous.join(', ') + '. Use the full path or code.');
      else if (opts.create_missing) {
        locationPath = vals.location.split('/').map((x) => u.squash(x)).filter((x) => x !== '').join(' / ');
        // The levels that do not exist yet must fit inside the deepest one that does.
        const names = locationPath.split(' / ');
        let have = 0;
        let parentKind = '';
        for (let i = 0; i < names.length; i++) {
          const sub = names.slice(0, i + 1).join(' / ').toLowerCase();
          const found = ix.list.filter((l) => ix.path(l.id).toLowerCase() === sub)[0];
          if (found === undefined) break;
          have = i + 1;
          parentKind = found.kind;
        }
        const sim = locs.newPathKinds(parentKind, names.length - have);
        if (sim.error) errors.push('Cannot create "' + locationPath + '": ' + sim.error);
        else newLocs[locationPath.toLowerCase()] = locationPath;
      } else errors.push('No location "' + vals.location + '"');
    } else if (num.quantity !== undefined) {
      const d = existing !== null && existing.getString('default_location') !== '' ? existing.getString('default_location') : defaultLoc;
      if (d === '') errors.push('Quantity needs a location, and there are no locations yet');
      else locationId = d;
    }
    if (!laterRow && errors.length === 0) firstRow[identity] = i + 2;
    const action = errors.length > 0 ? 'invalid' : existing !== null || laterRow ? 'update' : 'create';
    counts[action] += 1;
    out.push({
      n: i + 2,
      action: action,
      identity: identity,
      name: existing !== null && vals.name === '' ? existing.getString('name') : u.squash(vals.name),
      sku: vals.sku !== '' ? vals.sku : existing !== null ? existing.getString('sku') : '',
      errors: errors,
      values: vals,
      item_id: existing !== null ? existing.id : null,
      fractional: fractional,
      num: num,
      cost: cost,
      barcodes: barcodes,
      category_id: categoryId,
      supplier_id: supplierId,
      location_id: locationId,
      location_path: locationPath,
    });
  }
  return {
    columns: t.header,
    mapping: opts.mapping,
    quantities: opts.quantities,
    create_missing: opts.create_missing,
    rows: out,
    counts: counts,
    creates: {
      categories: Object.keys(newCats).map((k) => newCats[k]),
      suppliers: Object.keys(newSups).map((k) => newSups[k]),
      locations: Object.keys(newLocs).map((k) => newLocs[k]),
    },
  };
}

function savedMapping(pl) {
  return { mapping: pl.mapping, quantities: pl.quantities, create_missing: pl.create_missing };
}

function previewOut(imp, pl, show) {
  return {
    import_id: imp.id,
    filename: imp.getString('filename'),
    status: imp.getString('status'),
    columns: pl.columns,
    fields: FIELDS.map((f) => ({ key: f.key, label: f.label, column: pl.mapping[f.key] })),
    quantities: pl.quantities,
    create_missing: pl.create_missing,
    counts: pl.counts,
    creates: pl.creates,
    rows: pl.rows.slice(0, show).map((r) => ({ n: r.n, action: r.action, name: r.name, sku: r.sku, errors: r.errors, values: r.values })),
    invalid: pl.rows.filter((r) => r.action === 'invalid').slice(0, 200).map((r) => ({ n: r.n, errors: r.errors })),
  };
}

const ITEM_FIELDS = ['name', 'sku', 'category', 'unit', 'fractional', 'min_qty', 'max_qty', 'unit_cost', 'supplier', 'description', 'default_location'];

/** Import the valid rows in one transaction. */
function run(app, imp, opts, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  if (imp.getString('status') !== 'previewed') throw u.fail(400, 'This file was already imported (' + imp.getString('status') + '). Upload it again to import it again.');
  const pl = plan(app, opts);
  const todo = pl.rows.filter((r) => r.action === 'create' || r.action === 'update');
  if (todo.length === 0) throw u.fail(400, 'Nothing to import: ' + pl.counts.invalid + ' rows have problems and ' + pl.counts.skip + ' are empty');
  const result = { created: [], updated: {}, codes: [], categories: [], suppliers: [], locations: [], batch: '' };
  app.runInTransaction((tx) => {
    // Checked again inside the transaction, so a double click cannot import twice.
    if (tx.findRecordById('imports', imp.id).getString('status') !== 'previewed') throw u.fail(400, 'This file was already imported. Upload it again to import it again.');
    const catIds = {};
    for (const name of pl.creates.categories) {
      const c = new Record(tx.findCollectionByNameOrId('categories'));
      c.set('name', name);
      c.set('icon', 'package');
      c.set('sort', 100);
      tx.save(c);
      catIds[name.toLowerCase()] = c.id;
      result.categories.push(c.id);
    }
    const supIds = {};
    for (const name of pl.creates.suppliers) {
      const s = new Record(tx.findCollectionByNameOrId('suppliers'));
      s.set('name', name);
      s.set('lead_time_days', 0);
      tx.save(s);
      supIds[name.toLowerCase()] = s.id;
      result.suppliers.push(s.id);
    }
    const locIds = {};
    for (const path of pl.creates.locations) {
      // Create each missing level of the path, reusing levels that exist.
      const lib = require(`${__hooks}/lib_locations.js`);
      const ix = lib.index(tx);
      let parent = '';
      let parentKind = '';
      let kinds = null;
      const names = path.split(' / ');
      for (let i = 0; i < names.length; i++) {
        const sub = names.slice(0, i + 1).join(' / ').toLowerCase();
        const found = ix.list.filter((l) => ix.path(l.id).toLowerCase() === sub)[0];
        if (found !== undefined) {
          parent = found.id;
          parentKind = found.kind;
          continue;
        }
        // Kinds for every missing level at once, so each fits inside the one above.
        if (kinds === null) {
          const sim = lib.newPathKinds(parentKind, names.length - i);
          if (sim.error) throw u.fail(400, 'Cannot create "' + path + '": ' + sim.error);
          kinds = sim.kinds;
        }
        const l = new Record(tx.findCollectionByNameOrId('locations'));
        l.set('name', names[i]);
        l.set('code', '');
        l.set('kind', kinds.shift());
        l.set('parent', parent);
        l.set('sort', 100);
        tx.save(l);
        result.locations.push(l.id);
        parent = l.id;
        ix.list.push({ id: l.id, name: names[i], code: l.getString('code'), kind: l.getString('kind'), parent: l.getString('parent'), notes: '', sort: 100 });
        ix.byId[l.id] = ix.list[ix.list.length - 1];
      }
      locIds[path.toLowerCase()] = parent;
    }

    const lines = [];
    const madeHere = {};
    for (const r of todo) {
      const v = r.values;
      let rec = r.item_id !== null ? tx.findRecordById('items', r.item_id) : madeHere[r.identity] !== undefined ? tx.findRecordById('items', madeHere[r.identity]) : null;
      const creating = rec === null;
      const sameRun = !creating && madeHere[r.identity] !== undefined;
      if (creating) {
        rec = new Record(tx.findCollectionByNameOrId('items'));
        rec.set('fractional', r.fractional);
        rec.set('unit', 'pcs');
        rec.set('min_qty', 0);
        rec.set('max_qty', 0);
        rec.set('unit_cost', 0);
        rec.set('lead_time_days', 0);
        rec.set('archived', false);
      } else if (!sameRun && result.updated[rec.id] === undefined) {
        const prev = {};
        for (const f of ITEM_FIELDS) prev[f] = rec.get(f);
        result.updated[rec.id] = prev;
      }
      if (v.name !== '') rec.set('name', v.name);
      if (v.sku !== '') rec.set('sku', v.sku);
      if (v.unit !== '') rec.set('unit', v.unit);
      if (v.description !== '') rec.set('description', v.description.slice(0, 2000));
      if (r.num.min_qty !== undefined) rec.set('min_qty', r.num.min_qty);
      if (r.num.max_qty !== undefined) rec.set('max_qty', r.num.max_qty);
      if (v.category !== '') rec.set('category', r.category_id !== null ? r.category_id : catIds[u.squash(v.category).toLowerCase()]);
      if (v.supplier !== '') rec.set('supplier', r.supplier_id !== null ? r.supplier_id : supIds[u.squash(v.supplier).toLowerCase()]);
      const loc = r.location_id !== null ? r.location_id : r.location_path !== '' ? locIds[r.location_path.toLowerCase()] : null;
      if (creating && loc !== null && loc !== undefined) rec.set('default_location', loc);
      // New items take the cost as given; in "add" mode an existing item's cost
      // is averaged with the delivery's instead (by the ledger).
      if (r.cost !== null && (creating || opts.quantities === 'set')) rec.set('unit_cost', r.cost);
      tx.save(rec);
      if (creating) {
        result.created.push(rec.id);
        madeHere[r.identity] = rec.id;
      }
      for (const b of r.barcodes) {
        const have = u.findOne(tx, 'codes', 'code = {:c} && item = {:i}', { c: b, i: rec.id });
        if (have !== null) continue;
        const c = new Record(tx.findCollectionByNameOrId('codes'));
        c.set('code', b);
        c.set('item', rec.id);
        tx.save(c);
        result.codes.push(c.id);
      }
      if (r.num.quantity !== undefined && loc !== null && loc !== undefined) {
        if (creating || sameRun) {
          if (r.num.quantity > 0) lines.push({ item: rec.id, location: loc, qty: r.num.quantity, kind: 'in', reason: 'opening', unit_cost: r.cost !== null ? r.cost : undefined });
        } else if (opts.quantities === 'add') {
          if (r.num.quantity > 0) lines.push({ item: rec.id, location: loc, qty: r.num.quantity, kind: 'in', reason: 'received', unit_cost: r.cost !== null ? r.cost : undefined });
        } else {
          const delta = u.q3(r.num.quantity - ledger.balance(tx, rec.id, loc));
          if (delta !== 0) lines.push({ item: rec.id, location: loc, qty: delta, kind: 'adjust', reason: 'correction' });
        }
      }
    }
    if (lines.length > 0) {
      const posted = ledger.post(tx, lines, { actor: actor, ref_type: 'import', ref: imp.id, allowNegative: true });
      result.batch = posted.batch;
    }
    const im = tx.findRecordById('imports', imp.id);
    im.set('status', 'imported');
    im.set('rows', pl.counts.rows);
    im.set('added', pl.counts.create);
    im.set('changed', pl.counts.update);
    im.set('skipped', pl.counts.invalid + pl.counts.skip);
    im.set('mapping', savedMapping(pl));
    im.set('result', result);
    tx.save(im);
  });
  return {
    import_id: imp.id,
    added: pl.counts.create,
    changed: pl.counts.update,
    skipped: pl.counts.invalid + pl.counts.skip,
    invalid: pl.rows.filter((r) => r.action === 'invalid').slice(0, 200).map((r) => ({ n: r.n, errors: r.errors })),
    created: { categories: result.categories.length, suppliers: result.suppliers.length, locations: result.locations.length },
    message:
      'Added ' + pl.counts.create + (pl.counts.create === 1 ? ' item' : ' items') + ', updated ' + pl.counts.update + (pl.counts.invalid > 0 ? ', skipped ' + pl.counts.invalid + ' rows with problems' : ''),
  };
}

/** Undo an import: the app goes back to how it was before it. */
function undo(app, imp, actor) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  if (imp.getString('status') !== 'imported') throw u.fail(400, 'Only an imported file can be undone (this one is ' + imp.getString('status') + ')');
  const res = readJson(imp, 'result');
  const created = res.created || [];
  const updated = res.updated || {};
  let removed = 0;
  app.runInTransaction((tx) => {
    // Stock changes on items that stay: post the opposite.
    if (res.batch) {
      const rows = tx.findRecordsByFilter('movements', 'batch = {:b}', 'created', 0, 0, { b: res.batch });
      const back = rows
        .slice()
        .reverse()
        .filter((m) => created.indexOf(m.getString('item')) < 0)
        .map((m) => ({ item: m.getString('item'), location: m.getString('location'), qty: -m.getFloat('qty'), kind: m.getString('kind'), reason: 'undo' }));
      if (back.length > 0) ledger.post(tx, back, { actor: actor, reverses: res.batch, ref_type: 'import', ref: imp.id, allowNegative: true });
    }
    for (const id of created) {
      const it = u.byId(tx, 'items', id);
      if (it !== null) {
        tx.delete(it);
        removed += 1;
      }
    }
    for (const id of Object.keys(updated)) {
      const it = u.byId(tx, 'items', id);
      if (it === null) continue;
      for (const f of ITEM_FIELDS) it.set(f, updated[id][f]);
      tx.save(it);
    }
    for (const id of res.codes || []) {
      const c = u.byId(tx, 'codes', id);
      if (c !== null) tx.delete(c);
    }
    for (const id of res.categories || []) {
      const c = u.byId(tx, 'categories', id);
      if (c !== null && u.findOne(tx, 'items', 'category = {:c}', { c: id }) === null) tx.delete(c);
    }
    for (const id of res.suppliers || []) {
      const s = u.byId(tx, 'suppliers', id);
      if (s !== null && u.findOne(tx, 'items', 'supplier = {:s}', { s: id }) === null && u.findOne(tx, 'orders', 'supplier = {:s}', { s: id }) === null) tx.delete(s);
    }
    // Deepest places first; only ones that are empty and hold no other places.
    const locIds = (res.locations || []).slice().reverse();
    for (const id of locIds) {
      const l = u.byId(tx, 'locations', id);
      if (l === null) continue;
      const kids = u.findOne(tx, 'locations', 'parent = {:l}', { l: id });
      const stock = u.findOne(tx, 'stock', 'location = {:l} && qty != 0', { l: id });
      if (kids === null && stock === null) tx.delete(l);
    }
    const im = tx.findRecordById('imports', imp.id);
    im.set('status', 'undone');
    tx.save(im);
  });
  return { removed: removed, restored: Object.keys(updated).length, message: 'Removed ' + removed + ' items and restored ' + Object.keys(updated).length };
}

function list(app, limit) {
  const recs = app.findRecordsByFilter('imports', "status != 'previewed'", '-created', limit, 0);
  return {
    imports: recs.map((r) => ({
      id: r.id,
      filename: r.getString('filename'),
      status: r.getString('status'),
      rows: r.getInt('rows'),
      added: r.getInt('added'),
      changed: r.getInt('changed'),
      skipped: r.getInt('skipped'),
      created: r.getString('created'),
      updated: r.getString('updated'),
    })),
  };
}

/** The header row of a CSV the app reads back exactly (the import template). */
function templateHeader() {
  return FIELDS.map((f) => f.label);
}

module.exports = {
  FIELDS: FIELDS,
  QUANTITIES: QUANTITIES,
  source: source,
  options: options,
  plan: plan,
  savedMapping: savedMapping,
  previewOut: previewOut,
  run: run,
  undo: undo,
  list: list,
  templateHeader: templateHeader,
};
