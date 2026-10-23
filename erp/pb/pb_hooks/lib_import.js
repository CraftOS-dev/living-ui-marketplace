/// <reference path="../pb_data/types.d.ts" />
/**
 * Import from CSV (customers and suppliers, items, accounts, employees,
 * opening balances) and export to CSV.
 *
 * Import is two steps with a stored record: preview (columns matched to
 * fields by their header name, every row checked, nothing written) and run
 * (all rows in one transaction). Records an import created can be removed
 * again while nothing uses them (undo).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function money() {
  return require(`${__hooks}/lib_money.js`);
}

/** Fields per kind: [field, required, header names it is known by]. */
const FIELDS = {
  parties: [
    ['name', true, ['name', 'customer', 'supplier', 'company', 'customer name', 'supplier name', 'party']],
    ['code', false, ['code', 'customer code', 'supplier code', 'account number', 'id']],
    ['role', false, ['role', 'type', 'customer or supplier']],
    ['email', false, ['email', 'e-mail', 'email address']],
    ['phone', false, ['phone', 'telephone', 'mobile', 'phone number']],
    ['website', false, ['website', 'web', 'url']],
    ['tax_id', false, ['tax id', 'tax number', 'vat number', 'gst number', 'tin', 'sst number']],
    ['billing_address', false, ['address', 'billing address']],
    ['shipping_address', false, ['shipping address', 'delivery address']],
    ['contact_name', false, ['contact', 'contact name', 'contact person']],
    ['terms', false, ['terms', 'payment terms']],
    ['currency', false, ['currency']],
    ['credit_limit', false, ['credit limit']],
    ['notes', false, ['notes', 'note', 'comments']],
  ],
  items: [
    ['name', true, ['name', 'item', 'item name', 'product', 'product name', 'description']],
    ['sku', false, ['sku', 'code', 'item code', 'product code', 'part number']],
    ['kind', false, ['kind', 'type', 'item type']],
    ['category', false, ['category', 'group']],
    ['unit', false, ['unit', 'uom', 'unit of measure']],
    ['barcode', false, ['barcode', 'ean', 'upc', 'gtin']],
    ['sale_price', false, ['sale price', 'price', 'selling price', 'unit price']],
    ['purchase_price', false, ['purchase price', 'cost', 'cost price', 'buy price']],
    ['sale_tax', false, ['sales tax', 'tax', 'tax code']],
    ['purchase_tax', false, ['purchase tax']],
    ['min_qty', false, ['reorder point', 'min', 'minimum', 'min qty']],
    ['max_qty', false, ['target', 'max', 'maximum', 'max qty']],
    ['lead_time_days', false, ['lead time', 'lead time days']],
    ['supplier', false, ['supplier', 'vendor', 'preferred supplier']],
  ],
  accounts: [
    ['code', true, ['code', 'account code', 'account number', 'number']],
    ['name', true, ['name', 'account', 'account name']],
    ['type', true, ['type', 'account type']],
    ['subtype', false, ['subtype', 'detail type']],
    ['description', false, ['description']],
  ],
  employees: [
    ['name', true, ['name', 'employee', 'full name', 'employee name']],
    ['number', false, ['number', 'employee number', 'employee id', 'staff id', 'id']],
    ['email', false, ['email', 'work email']],
    ['phone', false, ['phone', 'mobile']],
    ['job_title', false, ['job title', 'title', 'position', 'role']],
    ['department', false, ['department', 'team']],
    ['manager', false, ['manager', 'reports to', 'manager email', 'supervisor']],
    ['start_date', false, ['start date', 'joined', 'hire date', 'date joined']],
    ['employment', false, ['employment', 'contract', 'employment type']],
    ['pay_basic', false, ['basic pay', 'salary', 'pay', 'monthly salary']],
    ['pay_frequency', false, ['pay frequency', 'frequency']],
  ],
  opening_accounts: [
    ['account', true, ['account', 'account code', 'code']],
    ['debit', false, ['debit', 'dr']],
    ['credit', false, ['credit', 'cr']],
  ],
  opening_documents: [
    ['type', true, ['type', 'invoice or bill']],
    ['party', true, ['party', 'customer', 'supplier', 'name']],
    ['number', false, ['number', 'invoice number', 'bill number', 'document number', 'reference']],
    ['date', false, ['date', 'invoice date', 'bill date']],
    ['due_date', false, ['due date', 'due']],
    ['amount', true, ['amount', 'open amount', 'balance', 'amount due', 'outstanding']],
    ['currency', false, ['currency']],
  ],
  opening_stock: [
    ['item', true, ['item', 'sku', 'item code', 'product']],
    ['qty', true, ['qty', 'quantity', 'on hand', 'stock']],
    ['unit_cost', false, ['unit cost', 'cost', 'average cost']],
  ],
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

function needFor(ctx, kind) {
  const a = auth();
  if (kind === 'parties') {
    if (!ctx.isAgent && !a.can(ctx, 'sales', 'edit') && !a.can(ctx, 'purchasing', 'edit')) a.need(ctx, 'sales', 'edit', 'import customers and suppliers');
  } else if (kind === 'items') {
    if (!ctx.isAgent && !a.can(ctx, 'inventory', 'edit') && !a.can(ctx, 'sales', 'edit') && !a.can(ctx, 'purchasing', 'edit')) a.need(ctx, 'inventory', 'edit', 'import items');
  } else if (kind === 'accounts') {
    if (!ctx.isAgent) a.need(ctx, 'accounting', 'edit', 'import accounts');
  } else if (kind === 'employees') {
    if (!ctx.isAgent) a.need(ctx, 'people', 'edit', 'import employees');
  } else {
    if (ctx.isAgent) throw u().fail(403, 'Opening balances are imported by a person with full Accounting rights.', 'agent_not_permitted');
    a.need(ctx, 'accounting', 'full', 'import opening balances');
  }
}

/** Read the stored CSV and work out the mapping (headers, then the given mapping). */
function readImport(app, rec, p) {
  const util = u();
  const csv = require(`${__hooks}/lib_csv.js`);
  const kind = rec.getString('kind');
  const t = csv.table(csv.readStored(app, rec, 'file'));
  if (t.rows.length < 2) throw util.fail(400, 'The file needs a header row and at least one row.', 'empty');
  const header = t.rows[0];
  const data = t.rows.slice(1);
  const fields = FIELDS[kind];
  const saved = util.jsonOf(rec, 'mapping') || {};
  const map = {};
  for (const f of fields) {
    let idx = -1;
    // Known header names compare in the same normalized form ("E-mail" is "e mail" on both sides).
    for (let i = 0; i < header.length && idx < 0; i++) if (f[2].some((a) => norm(a) === norm(header[i])) || norm(header[i]) === norm(f[0])) idx = i;
    map[f[0]] = saved[f[0]] !== undefined ? saved[f[0]] : idx;
  }
  const given = util.obj(p, 'mapping');
  if (given !== undefined) {
    for (const k of Object.keys(given)) {
      if (!fields.some((f) => f[0] === k)) throw util.fail(400, 'Unknown field ' + k + '. Fields: ' + fields.map((f) => f[0]).join(', '), 'invalid_param');
      const v = given[k];
      if (v === null || v === '' || v === -1 || v === 'none') map[k] = -1;
      else map[k] = csv.resolveColumn(v, header);
    }
  }
  return { header: header, data: data, map: map, fields: fields };
}

function cell(row, map, f) {
  const i = map[f];
  return i === undefined || i < 0 ? '' : String(row[i] === undefined ? '' : row[i]).trim();
}

/** Check one row: { status: create|update|invalid, problems, values, match }. */
function checkRow(app, kind, row, map, opts) {
  const util = u();
  const c = core();
  const v = {};
  const problems = [];
  for (const f of FIELDS[kind]) {
    v[f[0]] = cell(row, map, f[0]);
    if (f[1] && v[f[0]] === '') problems.push(f[0] + ' is empty');
  }
  let match = null;
  const tryRef = (col, ref) => {
    try {
      return c.resolveOpt(app, col, ref);
    } catch (err) {
      problems.push(String(err.message));
      return null;
    }
  };
  if (kind === 'parties') {
    if (v.code !== '') match = util.findOne(app, 'parties', 'code = {:c}', { c: v.code });
    if (match === null && v.name !== '') {
      const ids = util.rows(app, 'SELECT id FROM parties WHERE LOWER(name) = LOWER({:n}) LIMIT 2', { id: '' }, { n: v.name });
      if (ids.length === 1) match = app.findRecordById('parties', ids[0].id);
    }
    if (v.terms !== '') tryRef('payment_terms', v.terms);
    if (v.credit_limit !== '' && money().toMinor(v.credit_limit, c.currency(app), false) === null) problems.push('credit limit is not an amount');
    if (v.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) problems.push('email is not an email address');
  } else if (kind === 'items') {
    if (v.sku !== '') match = util.findOne(app, 'items', 'sku = {:s}', { s: v.sku });
    if (v.kind !== '' && ['stock', 'service', 'non_stock'].indexOf(norm(v.kind).replace(' ', '_')) < 0) problems.push('kind must be stock, service or non_stock');
    for (const f of ['sale_price', 'purchase_price']) if (v[f] !== '' && money().toE4(v[f].replace(/[^\d.,]/g, '').replace(/,/g, ''), false) === null) problems.push(f.replace('_', ' ') + ' is not a price');
    for (const f of ['min_qty', 'max_qty']) if (v[f] !== '' && util.decimal(v[f]) === null) problems.push(f.replace('_', ' ') + ' is not a number');
    if (v.supplier !== '') tryRef('parties', v.supplier);
    if (v.sale_tax !== '') tryRef('taxes', v.sale_tax);
    if (v.purchase_tax !== '') tryRef('taxes', v.purchase_tax);
  } else if (kind === 'accounts') {
    match = v.code !== '' ? util.findOne(app, 'accounts', 'code = {:c}', { c: v.code }) : null;
    const t = norm(v.type);
    if (['asset', 'liability', 'equity', 'income', 'expense'].indexOf(t) < 0) problems.push('type must be asset, liability, equity, income or expense');
    if (match !== null && match.getString('type') !== t) problems.push('the account exists with type ' + match.getString('type'));
  } else if (kind === 'employees') {
    if (v.number !== '') match = util.findOne(app, 'employees', 'number = {:n}', { n: v.number });
    if (match === null && v.email !== '') match = util.findOne(app, 'employees', 'email = {:e}', { e: v.email.toLowerCase() });
    if (v.start_date !== '' && !util.isDay(v.start_date)) problems.push('start date must be YYYY-MM-DD');
    if (v.pay_basic !== '' && money().toMinor(v.pay_basic, c.currency(app), false) === null) problems.push('basic pay is not an amount');
  } else if (kind === 'opening_accounts') {
    const a = tryRef('accounts', v.account);
    if (a !== null && a.getBool('control')) problems.push(a.getString('name') + ' is a control account (use the documents or stock import)');
    const cur = c.currency(app);
    if ((v.debit === '') === (v.credit === '')) problems.push('give a debit or a credit');
    if (v.debit !== '' && money().toMinor(v.debit, cur, false) === null) problems.push('debit is not an amount');
    if (v.credit !== '' && money().toMinor(v.credit, cur, false) === null) problems.push('credit is not an amount');
  } else if (kind === 'opening_documents') {
    const t = norm(v.type);
    if (t !== 'invoice' && t !== 'bill') problems.push('type must be invoice or bill');
    tryRef('parties', v.party);
    if (v.amount !== '' && money().toMinor(v.amount, (v.currency || c.currency(app)).toUpperCase(), false) === null) problems.push('amount is not an amount');
    if (v.date !== '' && !util.isDay(v.date)) problems.push('date must be YYYY-MM-DD');
    if (v.due_date !== '' && !util.isDay(v.due_date)) problems.push('due date must be YYYY-MM-DD');
  } else if (kind === 'opening_stock') {
    const it = tryRef('items', v.item);
    if (it !== null && it.getString('kind') !== 'stock') problems.push(it.getString('name') + ' is not a stock item');
    if (util.decimal(v.qty) === null || util.decimal(v.qty) <= 0) problems.push('qty must be a positive number');
  }
  void opts;
  return { values: v, problems: problems, match: match, status: problems.length > 0 ? 'invalid' : match !== null ? 'update' : 'create' };
}

function preview(ctx, p) {
  const util = u();
  const app = ctx.app;
  let rec = null;
  const existing = util.str(p, 'import_id', '');
  if (existing !== '') {
    rec = core().resolve(app, 'imports', existing);
    if (rec.getString('status') !== 'previewed') throw util.fail(409, 'That import already ran.', 'invalid_state');
  } else {
    const kind = util.oneOf(p, 'kind', Object.keys(FIELDS), '');
    if (kind === '') throw util.fail(400, 'kind is required: ' + Object.keys(FIELDS).join(', '), 'missing_param');
    needFor(ctx, kind);
    const f = util.fileParam(ctx, p, 'file', 'path');
    if (f === null) throw util.fail(400, 'Upload the CSV, or give --path "<absolute path>".', 'missing_param');
    rec = util.newRecord(app, 'imports');
    rec.set('kind', kind);
    rec.set('file', f);
    rec.set('filename', String(f.originalName || f.name || 'import.csv').slice(0, 200));
    rec.set('status', 'previewed');
    rec.set('actor', ctx.isAgent ? 'agent' : 'person');
    rec.set('member', ctx.memberId);
    app.save(rec);
  }
  needFor(ctx, rec.getString('kind'));
  const r = readImport(app, rec, p);
  const counts = { rows: r.data.length, create: 0, update: 0, invalid: 0 };
  const rows = r.data.map((row, i) => {
    const c = checkRow(app, rec.getString('kind'), row, r.map, p);
    counts[c.status]++;
    return { row: i + 2, status: c.status, problems: c.problems, values: c.values };
  });
  rec.set('mapping', r.map);
  rec.set('rows', r.data.length);
  app.save(rec);
  return {
    import_id: rec.id,
    kind: rec.getString('kind'),
    filename: rec.getString('filename'),
    columns: r.header.map((h, i) => ({ index: i, name: h })),
    fields: r.fields.map((f) => ({ field: f[0], required: f[1], column: r.map[f[0]] })),
    counts: counts,
    rows: rows.slice(0, 100),
    problems: rows.filter((x) => x.status === 'invalid').slice(0, 200).map((x) => ({ row: x.row, problems: x.problems })),
  };
}

function setFields(rec, vals, pairs) {
  for (const pr of pairs) if (vals[pr] !== undefined && vals[pr] !== '') rec.set(pr, vals[pr]);
}

function run(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = core().resolve(app, 'imports', util.req(p, 'import_id'));
  if (rec.getString('status') !== 'previewed') throw util.fail(409, 'That import already ran.', 'invalid_state');
  const kind = rec.getString('kind');
  needFor(ctx, kind);
  const r = readImport(app, rec, p);
  const checked = r.data.map((row) => checkRow(app, kind, row, r.map, p));
  const valid = checked.filter((c) => c.status !== 'invalid');
  const c = core();
  const cur = c.currency(app);
  const date = util.day(p, 'date', util.today());
  // Opening balances go through their own operations, all at once.
  if (kind === 'opening_accounts') {
    const lines = valid.map((x) => ({ account: x.values.account, debit: x.values.debit, credit: x.values.credit }));
    const j = require(`${__hooks}/lib_accounts.js`).openingAccounts(ctx, { date: date, lines: lines });
    finish(app, rec, { journal: j.id }, valid.length, checked.length - valid.length);
    return { added: valid.length, skipped: checked.length - valid.length, journal: j.number };
  }
  if (kind === 'opening_documents') {
    const out = { invoice: [], bill: [] };
    for (const x of valid) out[norm(x.values.type)].push({ party: x.values.party, number: x.values.number, date: x.values.date, due_date: x.values.due_date, amount: x.values.amount, currency: x.values.currency });
    const made = [];
    for (const t of ['invoice', 'bill']) if (out[t].length > 0) made.push.apply(made, require(`${__hooks}/lib_accounts.js`).openingDocuments(ctx, { type: t, date: date, lines: out[t] }).documents);
    finish(app, rec, { documents: made.map((d) => d.id) }, made.length, checked.length - valid.length);
    return { added: made.length, skipped: checked.length - valid.length };
  }
  if (kind === 'opening_stock') {
    const ch = require(`${__hooks}/lib_accounts.js`).openingStock(ctx, { date: date, warehouse: util.str(p, 'warehouse', ''), lines: valid.map((x) => ({ item: x.values.item, qty: x.values.qty, unit_cost: x.values.unit_cost })) });
    finish(app, rec, { change: ch.id }, valid.length, checked.length - valid.length);
    return { added: valid.length, skipped: checked.length - valid.length, change: ch.number };
  }
  const created = [];
  let updated = 0;
  app.runInTransaction((tx) => {
    for (const x of valid) {
      const v = x.values;
      if (kind === 'parties') {
        const prt = x.match !== null ? tx.findRecordById('parties', x.match.id) : util.newRecord(tx, 'parties');
        prt.set('name', util.squash(v.name).slice(0, 160));
        if (x.match === null) {
          prt.set('code', v.code !== '' ? v.code.slice(0, 20) : c.nextNumber(tx, 'party'));
          prt.set('archived', false);
        }
        const role = norm(v.role);
        if (role.indexOf('supplier') >= 0 || role.indexOf('vendor') >= 0) prt.set('is_supplier', true);
        if (role === '' || role.indexOf('customer') >= 0 || role.indexOf('client') >= 0) prt.set('is_customer', x.match === null ? true : prt.getBool('is_customer') || role !== '');
        if (!prt.getBool('is_customer') && !prt.getBool('is_supplier')) prt.set('is_customer', true);
        setFields(prt, v, ['email', 'phone', 'website', 'tax_id', 'billing_address', 'shipping_address', 'contact_name', 'notes']);
        if (v.terms !== '') prt.set('terms', c.resolve(tx, 'payment_terms', v.terms).id);
        if (v.currency !== '') prt.set('currency', v.currency.toUpperCase() === cur ? '' : v.currency.toUpperCase().slice(0, 3));
        if (v.credit_limit !== '') prt.set('credit_limit', money().toMinor(v.credit_limit, cur, false) || 0);
        tx.save(prt);
        if (x.match === null) created.push(prt.id);
        else updated++;
      } else if (kind === 'items') {
        const it = x.match !== null ? tx.findRecordById('items', x.match.id) : util.newRecord(tx, 'items');
        it.set('name', util.squash(v.name).slice(0, 200));
        if (x.match === null) {
          it.set('sku', v.sku !== '' ? v.sku.slice(0, 40) : c.nextNumber(tx, 'item'));
          it.set('kind', v.kind !== '' ? norm(v.kind).replace(' ', '_') : 'stock');
          it.set('unit', v.unit || 'pcs');
          it.set('archived', false);
        } else if (v.kind !== '' && it.getString('kind') !== norm(v.kind).replace(' ', '_')) {
          // The kind of an existing item stays (it may have stock history).
        }
        if (v.unit !== '') it.set('unit', v.unit.slice(0, 20));
        if (v.barcode !== '') it.set('barcode', v.barcode.slice(0, 60));
        if (v.category !== '') {
          let cat = util.findOne(tx, 'item_categories', 'name = {:n}', { n: v.category });
          if (cat === null) {
            cat = util.newRecord(tx, 'item_categories');
            cat.set('name', v.category.slice(0, 60));
            cat.set('icon', 'package');
            cat.set('sort', 100);
            tx.save(cat);
          }
          it.set('category', cat.id);
        }
        for (const f of ['sale_price', 'purchase_price']) if (v[f] !== '') it.set(f, money().toE4(v[f].replace(/[^\d.,]/g, '').replace(/,/g, ''), false) || 0);
        for (const f of ['min_qty', 'max_qty']) if (v[f] !== '') it.set(f, util.decimal(v[f]));
        if (v.lead_time_days !== '') it.set('lead_time_days', Math.max(0, Math.round(Number(v.lead_time_days) || 0)));
        if (v.supplier !== '') it.set('supplier', c.resolve(tx, 'parties', v.supplier).id);
        if (v.sale_tax !== '') it.set('sale_tax', c.resolve(tx, 'taxes', v.sale_tax).id);
        if (v.purchase_tax !== '') it.set('purchase_tax', c.resolve(tx, 'taxes', v.purchase_tax).id);
        tx.save(it);
        if (x.match === null) created.push(it.id);
        else updated++;
      } else if (kind === 'accounts') {
        const a = x.match !== null ? tx.findRecordById('accounts', x.match.id) : util.newRecord(tx, 'accounts');
        a.set('code', v.code.slice(0, 20));
        a.set('name', util.squash(v.name).slice(0, 120));
        if (x.match === null) {
          const t = norm(v.type);
          a.set('type', t);
          const subs = require(`${__hooks}/lib_accounts.js`).SUBTYPES[t];
          const st = norm(v.subtype).replace(/ /g, '_');
          a.set('subtype', subs.indexOf(st) >= 0 ? st : subs[t === 'asset' ? 4 : t === 'liability' || t === 'expense' ? 1 : 0]);
          a.set('system_key', '');
          a.set('control', false);
          a.set('archived', false);
        }
        if (v.description !== '') a.set('description', v.description.slice(0, 500));
        tx.save(a);
        if (x.match === null) created.push(a.id);
        else updated++;
      } else if (kind === 'employees') {
        const em = x.match !== null ? tx.findRecordById('employees', x.match.id) : util.newRecord(tx, 'employees');
        em.set('name', util.squash(v.name).slice(0, 120));
        if (x.match === null) {
          em.set('number', v.number !== '' ? v.number.slice(0, 20) : c.nextNumber(tx, 'employee'));
          em.set('status', 'active');
          em.set('employment', 'full_time');
          em.set('pay_frequency', 'monthly');
        }
        if (v.email !== '') em.set('email', v.email.toLowerCase().slice(0, 160));
        setFields(em, v, ['phone', 'job_title']);
        if (v.start_date !== '') em.set('start_date', v.start_date);
        if (v.employment !== '') {
          const t = norm(v.employment).replace(/ /g, '_');
          if (['full_time', 'part_time', 'contractor', 'intern', 'temporary'].indexOf(t) >= 0) em.set('employment', t);
        }
        if (v.pay_frequency !== '') {
          const t = norm(v.pay_frequency).replace(/ /g, '_');
          if (['monthly', 'semi_monthly', 'biweekly', 'weekly'].indexOf(t) >= 0) em.set('pay_frequency', t);
        }
        if (v.pay_basic !== '') em.set('pay_basic', money().toMinor(v.pay_basic, cur, false) || 0);
        if (v.department !== '') {
          let d = util.findOne(tx, 'departments', 'name = {:n}', { n: v.department });
          if (d === null) {
            d = util.newRecord(tx, 'departments');
            d.set('name', v.department.slice(0, 80));
            d.set('archived', false);
            d.set('sort', 100);
            tx.save(d);
          }
          em.set('department', d.id);
        }
        tx.save(em);
        if (x.match === null) created.push(em.id);
        else updated++;
      }
    }
    // Managers after everyone exists.
    if (kind === 'employees') {
      for (const x of valid) {
        if (x.values.manager === '') continue;
        const em = x.match !== null ? tx.findRecordById('employees', x.match.id) : null;
        const target = em !== null ? em : util.findOne(tx, 'employees', 'name = {:n}', { n: util.squash(x.values.name) });
        let mgr = null;
        try {
          mgr = c.resolve(tx, 'employees', x.values.manager);
        } catch {
          mgr = null;
        }
        if (target !== null && mgr !== null && mgr.id !== target.id) {
          const t2 = tx.findRecordById('employees', target.id);
          t2.set('manager', mgr.id);
          tx.save(t2);
        }
      }
    }
    const x = tx.findRecordById('imports', rec.id);
    x.set('status', 'imported');
    x.set('added', created.length);
    x.set('skipped', checked.length - valid.length);
    x.set('mapping', r.map);
    x.set('result', { created: created, updated: updated });
    tx.save(x);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'import', entity: kind, ref: rec.id, label: rec.getString('filename'), summary: 'Imported ' + kind.replace(/_/g, ' ') + ': ' + created.length + ' added, ' + updated + ' updated, ' + (checked.length - valid.length) + ' skipped' });
  });
  return { added: created.length, updated: updated, skipped: checked.length - valid.length };
}

function finish(app, rec, result, added, skipped) {
  const x = app.findRecordById('imports', rec.id);
  x.set('status', 'imported');
  x.set('added', added);
  x.set('skipped', skipped);
  x.set('result', result);
  app.save(x);
}

function list(ctx, p) {
  const util = u();
  const kind = util.oneOf(p, 'kind', Object.keys(FIELDS), '');
  const recs = ctx.app.findRecordsByFilter('imports', kind !== '' ? 'kind = {:k}' : "kind != 'bank'", '-created', 50, 0, { k: kind });
  return {
    imports: recs.map((r) => ({ id: r.id, kind: r.getString('kind'), filename: r.getString('filename'), status: r.getString('status'), rows: r.getInt('rows'), added: r.getInt('added'), skipped: r.getInt('skipped'), created: r.getString('created'), who: r.getString('actor') === 'agent' ? 'Your AI agent' : require(`${__hooks}/lib_audit.js`).memberName(ctx.app, r.getString('member'), {}) })),
  };
}

function undo(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = core().resolve(app, 'imports', util.req(p, 'import_id'));
  const kind = rec.getString('kind');
  needFor(ctx, kind);
  if (rec.getString('status') !== 'imported') throw util.fail(409, 'Only an import that ran can be undone.', 'invalid_state');
  if (['parties', 'items', 'accounts', 'employees'].indexOf(kind) < 0) throw util.fail(409, 'Opening balances are corrected with new entries (reverse the journal, void the documents), not undone.', 'invalid');
  const res = util.jsonOf(rec, 'result') || {};
  const ids = res.created || [];
  let removed = 0;
  const kept = [];
  app.runInTransaction((tx) => {
    for (const id of ids) {
      const r = util.byId(tx, kind, id);
      if (r === null) continue;
      let used = 0;
      if (kind === 'parties') used = util.one(tx, 'SELECT (SELECT COUNT(id) FROM documents WHERE party = {:i}) + (SELECT COUNT(id) FROM payments WHERE party = {:i}) + (SELECT COUNT(id) FROM journal_lines WHERE party = {:i}) AS n', { n: 0 }, { i: id }).n;
      if (kind === 'items') used = util.one(tx, 'SELECT (SELECT COUNT(id) FROM document_lines WHERE item = {:i}) + (SELECT COUNT(id) FROM stock_moves WHERE item = {:i}) + (SELECT COUNT(id) FROM bom_lines WHERE item = {:i}) AS n', { n: 0 }, { i: id }).n;
      if (kind === 'accounts') used = util.one(tx, 'SELECT COUNT(id) AS n FROM journal_lines WHERE account = {:i}', { n: 0 }, { i: id }).n;
      if (kind === 'employees') used = util.one(tx, 'SELECT (SELECT COUNT(id) FROM leave_requests WHERE employee = {:i}) + (SELECT COUNT(id) FROM expense_claims WHERE employee = {:i}) + (SELECT COUNT(id) FROM timesheets WHERE employee = {:i}) + (SELECT COUNT(id) FROM payslips WHERE employee = {:i}) + (SELECT COUNT(id) FROM members WHERE employee = {:i}) AS n', { n: 0 }, { i: id }).n;
      if (used > 0) {
        kept.push(id);
        continue;
      }
      if (kind === 'employees') {
        for (const e2 of tx.findRecordsByFilter('employees', 'manager = {:i}', '', 0, 0, { i: id })) {
          const x = tx.findRecordById('employees', e2.id);
          x.set('manager', '');
          tx.save(x);
        }
      }
      tx.delete(tx.findRecordById(kind, id));
      removed++;
    }
    const x = tx.findRecordById('imports', rec.id);
    x.set('status', 'undone');
    tx.save(x);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'import_undo', entity: kind, ref: rec.id, label: rec.getString('filename'), summary: 'Undid an import: removed ' + removed + ', kept ' + kept.length + ' in use' });
  });
  return { removed: removed, kept_in_use: kept.length, updated_not_reverted: res.updated || 0 };
}

function template(ctx, p) {
  const util = u();
  const kind = util.oneOf(p, 'kind', Object.keys(FIELDS), '');
  if (kind === '') throw util.fail(400, 'kind is required', 'missing_param');
  const csv = require(`${__hooks}/lib_csv.js`);
  return { filename: kind + '-template.csv', csv: csv.toCsv([FIELDS[kind].map((f) => f[0])]) };
}

/* ================================================================ export */

function exportCsv(ctx, p) {
  const util = u();
  const app = ctx.app;
  const csv = require(`${__hooks}/lib_csv.js`);
  const a = auth();
  const kind = util.str(p, 'kind', '');
  const cur = core().currency(app);
  const m = (v) => money().minorText(v, cur);
  const from = util.day(p, 'from', '0000-01-01');
  const to = util.day(p, 'to', '9999-12-31');
  let rows = [];
  if (kind === 'parties') {
    if (!ctx.isAgent && !a.can(ctx, 'sales', 'view') && !a.can(ctx, 'purchasing', 'view')) a.need(ctx, 'sales', 'view');
    rows.push(['code', 'name', 'role', 'email', 'phone', 'website', 'tax_id', 'billing_address', 'shipping_address', 'contact_name', 'currency', 'credit_limit', 'notes', 'archived']);
    for (const r of app.findRecordsByFilter('parties', '', 'name', 0, 0)) {
      rows.push([r.getString('code'), r.getString('name'), [r.getBool('is_customer') ? 'customer' : '', r.getBool('is_supplier') ? 'supplier' : ''].filter((x) => x).join(' and '), r.getString('email'), r.getString('phone'), r.getString('website'), r.getString('tax_id'), r.getString('billing_address'), r.getString('shipping_address'), r.getString('contact_name'), r.getString('currency'), m(r.getInt('credit_limit')), r.getString('notes'), r.getBool('archived') ? 'yes' : '']);
    }
  } else if (kind === 'items' || kind === 'stock') {
    const list = require(`${__hooks}/lib_items.js`).list(ctx, { limit: 1000000, archived: 'all' });
    rows.push(['sku', 'name', 'kind', 'category', 'unit', 'sale_price', 'purchase_price', 'on_hand', 'value', 'avg_cost', 'reorder_point', 'target', 'supplier', 'archived']);
    for (const r of list.items) rows.push([r.sku, r.name, r.kind, r.category ? r.category.name : '', r.unit, r.sale_price, r.purchase_price, r.on_hand, m(r.value), r.avg_cost, r.min_qty, r.max_qty, r.supplier ? r.supplier.name : '', r.archived ? 'yes' : '']);
  } else if (kind === 'accounts' || kind === 'trial_balance') {
    if (!ctx.isAgent) a.need(ctx, 'accounting', 'view');
    if (kind === 'trial_balance') return require(`${__hooks}/lib_reports.js`).exportCsv(ctx, { report: 'trial-balance', from: util.day(p, 'from', util.today().slice(0, 7) + '-01'), to: util.day(p, 'to', util.today()) });
    rows.push(['code', 'name', 'type', 'subtype', 'description', 'archived']);
    for (const r of app.findRecordsByFilter('accounts', '', 'code', 0, 0)) rows.push([r.getString('code'), r.getString('name'), r.getString('type'), r.getString('subtype'), r.getString('description'), r.getBool('archived') ? 'yes' : '']);
  } else if (kind === 'journal_lines') {
    if (!ctx.isAgent) a.need(ctx, 'accounting', 'view');
    rows.push(['date', 'journal', 'kind', 'source', 'account_code', 'account', 'debit', 'credit', 'party', 'memo']);
    for (const r of util.rows(app, "SELECT jl.date AS date, j.number AS journal, j.kind AS kind, j.source_label AS label, a.code AS code, a.name AS account, jl.debit AS debit, jl.credit AS credit, IFNULL(pa.name, '') AS party, jl.memo AS memo FROM journal_lines jl JOIN journals j ON j.id = jl.journal JOIN accounts a ON a.id = jl.account LEFT JOIN parties pa ON pa.id = jl.party WHERE jl.date >= {:f} AND jl.date <= {:t} ORDER BY jl.date, j.created, jl.sort LIMIT 500000", { date: '', journal: '', kind: '', label: '', code: '', account: '', debit: 0, credit: 0, party: '', memo: '' }, { f: from, t: to })) {
      rows.push([r.date, r.journal, r.kind, r.label, r.code, r.account, m(r.debit), m(r.credit), r.party, r.memo]);
    }
  } else if (kind === 'documents' || kind === 'document_lines') {
    const type = util.oneOf(p, 'type', require(`${__hooks}/lib_doclines.js`).TYPE_NAMES, 'invoice');
    a.needDoc(ctx, type, 'view');
    if (kind === 'documents') {
      rows.push(['number', 'state', 'date', 'due_date', 'party', 'reference', 'currency', 'subtotal', 'tax', 'total', 'paid', 'balance', 'total_base']);
      for (const r of util.rows(app, "SELECT d.number AS number, d.state AS state, d.date AS date, d.due_date AS due, IFNULL(pa.name, '') AS party, d.reference AS reference, d.currency AS currency, d.subtotal AS subtotal, d.tax AS tax, d.total AS total, d.paid AS paid, d.balance AS balance, d.total_base AS total_base FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.type = {:t} AND d.date >= {:f} AND d.date <= {:to} ORDER BY d.date, d.number", { number: '', state: '', date: '', due: '', party: '', reference: '', currency: '', subtotal: 0, tax: 0, total: 0, paid: 0, balance: 0, total_base: 0 }, { t: type, f: from, to: to })) {
        rows.push([r.number, r.state, r.date, r.due, r.party, r.reference, r.currency, money().minorText(r.subtotal, r.currency), money().minorText(r.tax, r.currency), money().minorText(r.total, r.currency), money().minorText(r.paid, r.currency), money().minorText(r.balance, r.currency), m(r.total_base)]);
      }
    } else {
      rows.push(['number', 'date', 'party', 'sku', 'description', 'qty', 'unit', 'unit_price', 'discount_pct', 'tax', 'net', 'tax_amount', 'total', 'currency']);
      for (const r of util.rows(app, "SELECT d.number AS number, d.date AS date, IFNULL(pa.name, '') AS party, IFNULL(i.sku, '') AS sku, dl.description AS description, dl.qty AS qty, dl.unit AS unit, dl.unit_price AS price, dl.discount_bp AS disc, IFNULL(t.code, '') AS tax, dl.net AS net, dl.tax_amount AS tax_amount, dl.total AS total, d.currency AS currency FROM document_lines dl JOIN documents d ON d.id = dl.doc LEFT JOIN parties pa ON pa.id = d.party LEFT JOIN items i ON i.id = dl.item LEFT JOIN taxes t ON t.id = dl.tax WHERE d.type = {:t} AND d.date >= {:f} AND d.date <= {:to} ORDER BY d.date, d.number, dl.sort", { number: '', date: '', party: '', sku: '', description: '', qty: -0, unit: '', price: 0, disc: 0, tax: '', net: 0, tax_amount: 0, total: 0, currency: '' }, { t: type, f: from, to: to })) {
        rows.push([r.number, r.date, r.party, r.sku, r.description, util.q3(r.qty), r.unit, money().e4Text(r.price, r.currency), money().bpText(r.disc), r.tax, money().minorText(r.net, r.currency), money().minorText(r.tax_amount, r.currency), money().minorText(r.total, r.currency), r.currency]);
      }
    }
  } else if (kind === 'payments') {
    if (!ctx.isAgent && !a.can(ctx, 'banking', 'view') && !a.can(ctx, 'sales', 'view') && !a.can(ctx, 'purchasing', 'view')) a.need(ctx, 'banking', 'view');
    rows.push(['number', 'direction', 'state', 'date', 'party', 'bank', 'method', 'reference', 'currency', 'amount', 'unallocated', 'amount_base']);
    for (const r of util.rows(app, "SELECT p.number AS number, p.direction AS direction, p.state AS state, p.date AS date, IFNULL(pa.name, '') AS party, IFNULL(b.name, '') AS bank, p.method AS method, p.reference AS reference, p.currency AS currency, p.amount AS amount, p.unallocated AS unallocated, p.amount_base AS base FROM payments p LEFT JOIN parties pa ON pa.id = p.party LEFT JOIN banks b ON b.id = p.bank WHERE p.date >= {:f} AND p.date <= {:t} ORDER BY p.date", { number: '', direction: '', state: '', date: '', party: '', bank: '', method: '', reference: '', currency: '', amount: 0, unallocated: 0, base: 0 }, { f: from, t: to })) {
      rows.push([r.number, r.direction, r.state, r.date, r.party, r.bank, r.method, r.reference, r.currency, money().minorText(r.amount, r.currency), money().minorText(r.unallocated, r.currency), m(r.base)]);
    }
  } else if (kind === 'employees') {
    const full = ctx.isAgent || a.can(ctx, 'payroll', 'view') || a.can(ctx, 'people', 'full');
    if (!ctx.isAgent && !a.can(ctx, 'people', 'view')) a.need(ctx, 'people', 'view');
    rows.push(['number', 'name', 'email', 'phone', 'job_title', 'department', 'manager', 'status', 'employment', 'start_date', 'end_date'].concat(full ? ['pay_basic', 'pay_frequency'] : []));
    for (const r of util.rows(app, "SELECT e.number AS number, e.name AS name, e.email AS email, e.phone AS phone, e.job_title AS job_title, IFNULL(d.name, '') AS dept, IFNULL(mg.name, '') AS manager, e.status AS status, e.employment AS employment, e.start_date AS start, e.end_date AS end, e.pay_basic AS pay, e.pay_frequency AS freq FROM employees e LEFT JOIN departments d ON d.id = e.department LEFT JOIN employees mg ON mg.id = e.manager ORDER BY e.name", { number: '', name: '', email: '', phone: '', job_title: '', dept: '', manager: '', status: '', employment: '', start: '', end: '', pay: 0, freq: '' })) {
      rows.push([r.number, r.name, r.email, r.phone, r.job_title, r.dept, r.manager, r.status, r.employment, r.start, r.end].concat(full ? [m(r.pay), r.freq] : []));
    }
  } else if (kind === 'timesheets') {
    if (!ctx.isAgent) a.need(ctx, 'projects', 'view');
    rows.push(['date', 'employee', 'project', 'task', 'hours', 'billable', 'status', 'description']);
    for (const r of util.rows(app, "SELECT t.date AS date, IFNULL(e.name, '') AS employee, IFNULL(pr.name, '') AS project, IFNULL(tk.title, '') AS task, t.hours AS hours, t.billable AS billable, t.status AS status, t.description AS description FROM timesheets t LEFT JOIN employees e ON e.id = t.employee LEFT JOIN projects pr ON pr.id = t.project LEFT JOIN project_tasks tk ON tk.id = t.task WHERE t.date >= {:f} AND t.date <= {:t} ORDER BY t.date", { date: '', employee: '', project: '', task: '', hours: -0, billable: false, status: '', description: '' }, { f: from, t: to })) {
      rows.push([r.date, r.employee, r.project, r.task, r.hours, r.billable ? 'yes' : 'no', r.status, r.description]);
    }
  } else throw util.fail(400, 'kind must be parties, items, stock, accounts, journal_lines, documents, document_lines, payments, employees, timesheets or trial_balance', 'invalid_param');
  return { filename: kind + '-' + util.today() + '.csv', rows: rows.length - 1, csv: csv.toCsv(rows) };
}

module.exports = { FIELDS: FIELDS, preview: preview, run: run, list: list, undo: undo, template: template, exportCsv: exportCsv };
