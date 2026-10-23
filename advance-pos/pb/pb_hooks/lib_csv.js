/// <reference path="../pb_data/types.d.ts" />
/**
 * CSV import and export of products and customers, so a store can move in
 * from another system and take its data out.
 *
 * Products: one row per variant. Rows with the same name (and option
 * names) become one product; option1_value..option3_value tell variants
 * apart. Existing variants are matched by SKU, then by barcode; existing
 * single-variant products by name. A dry run reports what would happen.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a BOM. */
function parse(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** The CSV text of a request: the `csv` param or an uploaded `file`. */
function input(e, p) {
  const util = u();
  const text = util.str(p, 'csv', '');
  if (text !== '') return text;
  const f = util.uploaded(e, 'file');
  if (f !== null) {
    try {
      const reader = f.reader.open();
      try {
        return toString(reader, 20 * 1024 * 1024);
      } finally {
        reader.close();
      }
    } catch (err) {
      throw util.fail(400, 'Could not read the uploaded file: ' + String((err && err.message) || err));
    }
  }
  throw util.fail(400, 'Give csv (the text) or upload a file');
}

function headerIndex(header, allowed) {
  const util = u();
  const idx = {};
  header.forEach((h, i) => {
    const k = String(h).trim().toLowerCase().replace(/\s+/g, '_');
    if (k === '') return;
    if (allowed.indexOf(k) < 0) throw util.fail(400, 'Unknown column "' + h + '". Columns: ' + allowed.join(', '));
    if (idx[k] !== undefined) throw util.fail(400, 'Column ' + k + ' appears twice');
    idx[k] = i;
  });
  return idx;
}

const PRODUCT_COLUMNS = ['name', 'category', 'price', 'cost', 'sku', 'barcode', 'stock', 'low_at', 'tax', 'description', 'favorite', 'sold_by', 'unit', 'option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value'];

function truthy(v) {
  return ['1', 'true', 'yes', 'y'].indexOf(String(v || '').trim().toLowerCase()) >= 0;
}

/**
 * Import products. dry_run=true answers what would be created and changed.
 * Stock in the file opens new variants; for existing variants a different
 * stock becomes a count (with history).
 */
function importProducts(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_catalog', p, { what: 'Importing products' });
  const money = require(`${__hooks}/lib_money.js`).of(c.settings);
  const rows = parse(input(e, p));
  if (rows.length < 2) throw util.fail(400, 'The file needs a header row and at least one product');
  if (rows.length > 20001) throw util.fail(400, 'At most 20000 rows per import');
  const idx = headerIndex(rows[0], PRODUCT_COLUMNS);
  if (idx.name === undefined || idx.price === undefined) throw util.fail(400, 'The columns name and price are required');
  const get = (r, k) => (idx[k] === undefined ? '' : String(r[idx[k]] === undefined ? '' : r[idx[k]]).trim());
  // Group rows into products.
  const groups = [];
  const byKey = {};
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = util.squash(get(r, 'name'));
    if (name === '') throw util.fail(400, 'Row ' + line + ': name is empty');
    const optNames = [1, 2, 3].map((n) => util.squash(get(r, 'option' + n + '_name'))).filter((x) => x !== '');
    const key = name.toLowerCase() + '|' + optNames.join('|').toLowerCase();
    if (!byKey[key]) {
      byKey[key] = { name: name, optionNames: optNames, rows: [] };
      groups.push(byKey[key]);
    }
    const values = [1, 2, 3].slice(0, optNames.length).map((n) => util.squash(get(r, 'option' + n + '_value')));
    if (values.some((v) => v === '')) throw util.fail(400, 'Row ' + line + ': give a value for each option (' + optNames.join(', ') + ')');
    let price;
    try {
      price = money.toMinor(get(r, 'price'), 'price');
    } catch (err) {
      throw util.fail(400, 'Row ' + line + ': ' + err.message);
    }
    const row = { line: line, options: values, price: price, raw: r };
    for (const k of ['cost', 'sku', 'barcode', 'stock', 'low_at', 'category', 'tax', 'description', 'favorite', 'sold_by', 'unit']) row[k] = get(r, k);
    if (row.cost !== '') {
      try {
        money.toMinor(row.cost, 'cost');
      } catch (err) {
        throw util.fail(400, 'Row ' + line + ': ' + err.message);
      }
    }
    if (row.stock !== '' && !isFinite(Number(row.stock))) throw util.fail(400, 'Row ' + line + ': stock must be a number');
    if (row.sold_by !== '' && ['each', 'weight'].indexOf(row.sold_by.toLowerCase()) < 0) throw util.fail(400, 'Row ' + line + ': sold_by is each or weight');
    byKey[key].rows.push(row);
  });
  const report = { products_created: 0, products_updated: 0, variants_created: 0, variants_updated: 0, stock_counted: 0, categories_created: 0, rows: rows.length - 1 };
  const dry = util.bool(p, 'dry_run', false);
  const C = require(`${__hooks}/lib_catalog.js`);
  const stock = require(`${__hooks}/lib_stock.js`);
  const run = (tx) => {
    const catIds = {};
    for (const r of tx.findRecordsByFilter('categories', '', '', 0, 0)) catIds[r.getString('name').toLowerCase()] = r.id;
    const taxIds = {};
    for (const r of tx.findRecordsByFilter('taxes', '', '', 0, 0)) taxIds[r.getString('name').toLowerCase()] = r.id;
    const seenCodes = {};
    for (const g of groups) {
      // Find the product: by a SKU or barcode of one of its rows, else by name.
      let prod = null;
      for (const row of g.rows) {
        for (const code of [row.sku, row.barcode]) {
          if (code === '' || prod !== null) continue;
          const v = C.findCode(tx, code);
          if (v !== null) prod = tx.findRecordById('products', v.getString('product'));
        }
      }
      if (prod === null) {
        const same = tx.findRecordsByFilter('products', 'name = {:n} && archived = false', '', 2, 0, { n: g.name });
        if (same.length === 1) prod = same[0];
      }
      const first = g.rows[0];
      const fresh = prod === null;
      if (fresh) {
        prod = new Record(tx.findCollectionByNameOrId('products'));
        prod.set('name', g.name.slice(0, 120));
        prod.set('color', 'neutral');
        prod.set('option_names', g.optionNames);
        report.products_created++;
      } else report.products_updated++;
      if (first.category !== '') {
        const key = first.category.toLowerCase();
        if (!catIds[key]) {
          const cat = new Record(tx.findCollectionByNameOrId('categories'));
          cat.set('name', util.squash(first.category).slice(0, 60));
          cat.set('color', 'neutral');
          cat.set('sort', Object.keys(catIds).length);
          tx.save(cat);
          catIds[key] = cat.id;
          report.categories_created++;
        }
        prod.set('category', catIds[key]);
      }
      if (first.tax !== '') {
        const t = first.tax.toLowerCase();
        if (t === 'none' || t === 'exempt') prod.set('tax_exempt', true);
        else if (taxIds[t]) {
          prod.set('tax', taxIds[t]);
          prod.set('tax_exempt', false);
        } else throw util.fail(400, 'Row ' + first.line + ': no tax rate "' + first.tax + '" (add it in Settings first, or use none)');
      }
      if (first.description !== '') prod.set('description', first.description.slice(0, 2000));
      if (first.favorite !== '') prod.set('favorite', truthy(first.favorite));
      if (first.sold_by !== '') prod.set('sold_by', first.sold_by.toLowerCase());
      if (first.unit !== '') prod.set('unit', first.unit.slice(0, 12));
      if (!fresh && JSON.stringify(util.getJson(prod, 'option_names') || []) !== JSON.stringify(g.optionNames)) {
        throw util.fail(400, 'Row ' + first.line + ': ' + g.name + ' already exists with options ' + JSON.stringify(util.getJson(prod, 'option_names') || []) + '; the file gives ' + JSON.stringify(g.optionNames));
      }
      tx.save(prod);
      const existing = tx.findRecordsByFilter('variants', 'product = {:p}', 'position', 0, 0, { p: prod.id });
      g.rows.forEach((row, k) => {
        let v = null;
        for (const code of [row.sku, row.barcode]) {
          if (code === '' || v !== null) continue;
          const hit = C.findCode(tx, code);
          if (hit !== null && hit.getString('product') === prod.id) v = hit;
        }
        if (v === null) v = existing.find((x) => JSON.stringify(util.getJson(x, 'options') || []) === JSON.stringify(row.options)) || null;
        if (v === null && g.optionNames.length === 0 && existing.length === 1) v = existing[0];
        const isNew = v === null;
        if (isNew) {
          v = new Record(tx.findCollectionByNameOrId('variants'));
          v.set('product', prod.id);
          v.set('stock', 0);
          v.set('position', existing.length + k);
          report.variants_created++;
        } else report.variants_updated++;
        v.set('options', row.options);
        v.set('title', row.options.join(' / '));
        v.set('price', row.price);
        if (row.cost !== '') v.set('cost', money.toMinor(row.cost, 'cost'));
        for (const kk of ['sku', 'barcode']) {
          if (row[kk] === '') continue;
          if (seenCodes[row[kk].toLowerCase()]) throw util.fail(400, 'Row ' + row.line + ': the code ' + row[kk] + ' appears twice in the file');
          seenCodes[row[kk].toLowerCase()] = true;
          try {
            C.checkCode(tx, row[kk], v.id || '', kk);
          } catch (err) {
            throw util.fail(400, 'Row ' + row.line + ': ' + err.message);
          }
          v.set(kk, row[kk]);
        }
        if (row.low_at !== '') v.set('low_at', Math.max(0, Number(row.low_at) || 0));
        if (row.stock !== '') v.set('track_stock', true);
        v.set('archived', false);
        tx.save(v);
        if (row.stock !== '') {
          const qty = Math.round(Number(row.stock) * 1000) / 1000;
          const delta = Math.round((qty - v.getFloat('stock')) * 1000) / 1000;
          if (delta !== 0) {
            stock.move(tx, c, v, delta, isNew ? 'opening' : 'count', { name: prod.getString('name') + (v.getString('title') ? ' (' + v.getString('title') + ')' : ''), note: 'Imported' });
            if (!isNew) report.stock_counted++;
          }
        }
      });
    }
    require(`${__hooks}/lib_audit.js`).log(tx, 'catalog', c, { approver: approver, detail: 'Imported products: ' + report.products_created + ' new, ' + report.products_updated + ' updated, ' + report.variants_created + ' new variants' });
    if (dry) throw new Error('__dry_run__');
  };
  try {
    app.runInTransaction(run);
  } catch (err) {
    if (!(err && String(err.message || err).indexOf('__dry_run__') >= 0)) throw err;
  }
  return Object.assign({ dry_run: dry }, report);
}

function exportProducts(app, e, p) {
  const c = auth().context(app, e, p);
  auth().need(app, c, 'manage_catalog', p, { what: 'Exporting products' });
  const money = require(`${__hooks}/lib_money.js`).of(c.settings);
  const util = u();
  const R = require(`${__hooks}/lib_reports.js`);
  const cats = {};
  for (const r of app.findRecordsByFilter('categories', '', '', 0, 0)) cats[r.id] = r.getString('name');
  const taxes = {};
  for (const r of app.findRecordsByFilter('taxes', '', '', 0, 0)) taxes[r.id] = r.getString('name');
  const out = [];
  for (const prod of app.findRecordsByFilter('products', util.bool(p, 'archived', false) ? '' : 'archived = false', 'name', 0, 0)) {
    const names = util.getJson(prod, 'option_names') || [];
    for (const v of app.findRecordsByFilter('variants', 'product = {:p} && archived = false', 'position', 0, 0, { p: prod.id })) {
      const opts = util.getJson(v, 'options') || [];
      out.push([
        prod.getString('name'),
        cats[prod.getString('category')] || '',
        money.plain(v.getInt('price')),
        money.plain(Math.round(v.getFloat('cost'))),
        v.getString('sku'),
        v.getString('barcode'),
        v.getBool('track_stock') ? v.getFloat('stock') : '',
        v.getFloat('low_at') || '',
        prod.getBool('tax_exempt') ? 'none' : taxes[prod.getString('tax')] || '',
        prod.getString('description'),
        prod.getBool('favorite') ? 'yes' : '',
        prod.getString('sold_by') || 'each',
        prod.getString('unit'),
        names[0] || '',
        opts[0] || '',
        names[1] || '',
        opts[1] || '',
        names[2] || '',
        opts[2] || '',
      ]);
    }
  }
  return { filename: 'products.csv', csv: R.csv(PRODUCT_COLUMNS, out), rows: out.length };
}

const CUSTOMER_COLUMNS = ['name', 'phone', 'email', 'notes', 'tags', 'tax_exempt', 'marketing', 'birthday', 'points', 'credit'];

function importCustomers(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  A.need(app, c, 'manage_customers', p, { what: 'Importing customers' });
  const money = require(`${__hooks}/lib_money.js`).of(c.settings);
  const rows = parse(input(e, p));
  if (rows.length < 2) throw util.fail(400, 'The file needs a header row and at least one customer');
  if (rows.length > 50001) throw util.fail(400, 'At most 50000 rows per import');
  const idx = headerIndex(rows[0], CUSTOMER_COLUMNS);
  if (idx.name === undefined) throw util.fail(400, 'The column name is required');
  const balances = idx.points !== undefined || idx.credit !== undefined;
  const balApprover = balances ? A.need(app, c, 'adjust_balances', p, { what: 'Importing points and credit' }) : null;
  const get = (r, k) => (idx[k] === undefined ? '' : String(r[idx[k]] === undefined ? '' : r[idx[k]]).trim());
  const Cu = require(`${__hooks}/lib_customers.js`);
  const report = { created: 0, updated: 0, rows: rows.length - 1 };
  const dry = util.bool(p, 'dry_run', false);
  try {
    app.runInTransaction((tx) => {
      rows.slice(1).forEach((r, i) => {
        const line = i + 2;
        const name = util.squash(get(r, 'name'));
        if (name === '') throw util.fail(400, 'Row ' + line + ': name is empty');
        let email = '';
        let phone = '';
        try {
          email = Cu.cleanEmail(get(r, 'email'));
          phone = Cu.cleanPhone(get(r, 'phone'));
        } catch (err) {
          throw util.fail(400, 'Row ' + line + ': ' + err.message);
        }
        let rec = null;
        if (email !== '') rec = util.findOne(tx, 'customers', 'email = {:e}', { e: email });
        if (rec === null && phone !== '') rec = util.findOne(tx, 'customers', 'phone = {:p}', { p: phone });
        const fresh = rec === null;
        if (fresh) {
          rec = new Record(tx.findCollectionByNameOrId('customers'));
          for (const k of ['points', 'credit', 'visits', 'spent']) rec.set(k, 0);
          report.created++;
        } else report.updated++;
        rec.set('name', name.slice(0, 120));
        if (email !== '') rec.set('email', email);
        if (phone !== '') rec.set('phone', phone);
        if (get(r, 'notes') !== '') rec.set('notes', get(r, 'notes').slice(0, 2000));
        if (get(r, 'tags') !== '') rec.set('tags', get(r, 'tags').split(/[;|]/).map((t) => util.squash(t).toLowerCase()).filter((t) => t !== '').slice(0, 20));
        if (get(r, 'tax_exempt') !== '') rec.set('tax_exempt', truthy(get(r, 'tax_exempt')));
        if (get(r, 'marketing') !== '') rec.set('marketing', truthy(get(r, 'marketing')));
        if (get(r, 'birthday') !== '') {
          if (!/^(\d{4}-)?\d{2}-\d{2}$/.test(get(r, 'birthday'))) throw util.fail(400, 'Row ' + line + ': birthday is like 1990-04-12');
          rec.set('birthday', get(r, 'birthday'));
        }
        tx.save(rec);
        if (get(r, 'points') !== '') {
          const target = Number(get(r, 'points'));
          if (!Number.isInteger(target) || target < 0) throw util.fail(400, 'Row ' + line + ': points must be a whole number');
          const d = target - tx.findRecordById('customers', rec.id).getInt('points');
          if (d !== 0) Cu.moveBalance(tx, c, { account: 'points', customer: rec.id, delta: d, reason: 'adjust', note: 'Imported' });
        }
        if (get(r, 'credit') !== '') {
          let target;
          try {
            target = money.toMinor(get(r, 'credit'), 'credit');
          } catch (err) {
            throw util.fail(400, 'Row ' + line + ': ' + err.message);
          }
          if (target < 0) throw util.fail(400, 'Row ' + line + ': credit cannot be negative');
          const d = target - tx.findRecordById('customers', rec.id).getInt('credit');
          if (d !== 0) Cu.moveBalance(tx, c, { account: 'credit', customer: rec.id, delta: d, reason: 'adjust', note: 'Imported' });
        }
      });
      if (balApprover !== null || balances) require(`${__hooks}/lib_audit.js`).log(tx, 'balance', c, { approver: balApprover, detail: 'Imported customers with balances: ' + report.created + ' new, ' + report.updated + ' updated' });
      if (dry) throw new Error('__dry_run__');
    });
  } catch (err) {
    if (!(err && String(err.message || err).indexOf('__dry_run__') >= 0)) throw err;
  }
  return Object.assign({ dry_run: dry }, report);
}

function exportCustomers(app, e, p) {
  const c = auth().context(app, e, p);
  auth().need(app, c, 'manage_customers', p, { what: 'Exporting customers' });
  const money = require(`${__hooks}/lib_money.js`).of(c.settings);
  const util = u();
  const out = app.findRecordsByFilter('customers', '', 'name', 0, 0).map((r) => [
    r.getString('name'),
    r.getString('phone'),
    r.getString('email'),
    r.getString('notes'),
    (util.getJson(r, 'tags') || []).join(';'),
    r.getBool('tax_exempt') ? 'yes' : '',
    r.getBool('marketing') ? 'yes' : '',
    r.getString('birthday'),
    r.getInt('points'),
    money.plain(r.getInt('credit')),
  ]);
  return { filename: 'customers.csv', csv: require(`${__hooks}/lib_reports.js`).csv(CUSTOMER_COLUMNS, out), rows: out.length };
}

module.exports = { parse: parse, PRODUCT_COLUMNS: PRODUCT_COLUMNS, CUSTOMER_COLUMNS: CUSTOMER_COLUMNS, importProducts: importProducts, exportProducts: exportProducts, importCustomers: importCustomers, exportCustomers: exportCustomers };
