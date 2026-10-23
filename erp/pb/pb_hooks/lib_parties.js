/// <reference path="../pb_data/types.d.ts" />
/**
 * Customers and suppliers: one directory of parties (a party can be both).
 * What a party owes, and is owed, is read from the ledger (receivable and
 * payable lines carry the party), so it always agrees with the books.
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

function canView(ctx) {
  return ctx.isAgent || auth().can(ctx, 'sales', 'view') || auth().can(ctx, 'purchasing', 'view');
}

function needView(ctx) {
  if (!canView(ctx)) throw u().fail(403, 'Your role cannot see customers and suppliers (needs Sales or Purchasing).', 'not_permitted');
}

function needEdit(ctx, customer, supplier) {
  const util = u();
  if (ctx.isAgent) return;
  if (customer && !auth().can(ctx, 'sales', 'edit')) throw util.fail(403, 'Your role cannot change customers (needs edit access to Sales).', 'not_permitted');
  if (supplier && !auth().can(ctx, 'purchasing', 'edit')) throw util.fail(403, 'Your role cannot change suppliers (needs edit access to Purchasing).', 'not_permitted');
  if (!customer && !supplier && !auth().can(ctx, 'sales', 'edit') && !auth().can(ctx, 'purchasing', 'edit')) throw util.fail(403, 'Your role cannot change customers or suppliers.', 'not_permitted');
}

/** What a party owes the company (receivable, base minor units). */
function receivable(app, partyId) {
  const ar = core().systemAccount(app, 'ar').id;
  const r = u().one(app, 'SELECT IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS b FROM journal_lines WHERE party = {:p} AND account = {:a}', { b: 0 }, { p: partyId, a: ar });
  return r.b;
}

/** What the company owes a party (payable, base minor units, positive). */
function payable(app, partyId) {
  const ap = core().systemAccount(app, 'ap').id;
  const r = u().one(app, 'SELECT IFNULL(SUM(credit), 0) - IFNULL(SUM(debit), 0) AS b FROM journal_lines WHERE party = {:p} AND account = {:a}', { b: 0 }, { p: partyId, a: ap });
  return r.b;
}

function partyOut(app, r, balances) {
  const util = u();
  const terms = util.byId(app, 'payment_terms', r.getString('terms'));
  const st = util.byId(app, 'taxes', r.getString('sale_tax'));
  const pt = util.byId(app, 'taxes', r.getString('purchase_tax'));
  const out = {
    id: r.id,
    code: r.getString('code'),
    name: r.getString('name'),
    is_customer: r.getBool('is_customer'),
    is_supplier: r.getBool('is_supplier'),
    email: r.getString('email'),
    phone: r.getString('phone'),
    website: r.getString('website'),
    tax_id: r.getString('tax_id'),
    billing_address: r.getString('billing_address'),
    shipping_address: r.getString('shipping_address'),
    contact_name: r.getString('contact_name'),
    terms: terms !== null ? { id: terms.id, name: terms.getString('name') } : null,
    currency: r.getString('currency'),
    credit_limit: r.getInt('credit_limit'),
    sale_tax: st !== null ? { id: st.id, code: st.getString('code'), name: st.getString('name') } : null,
    purchase_tax: pt !== null ? { id: pt.id, code: pt.getString('code'), name: pt.getString('name') } : null,
    notes: r.getString('notes'),
    archived: r.getBool('archived'),
    created: r.getString('created'),
  };
  if (balances) {
    out.receivable = receivable(app, r.id);
    out.payable = payable(app, r.id);
  }
  return out;
}

function list(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const pg = util.page(p, 50, 1000);
  const where = ['1 = 1'];
  const bind = {};
  const role = util.oneOf(p, 'role', ['customer', 'supplier', 'all'], 'all');
  if (role === 'customer') where.push('pa.is_customer = TRUE');
  if (role === 'supplier') where.push('pa.is_supplier = TRUE');
  const archived = util.oneOf(p, 'archived', ['active', 'archived', 'all'], 'active');
  if (archived === 'active') where.push('pa.archived = FALSE');
  if (archived === 'archived') where.push('pa.archived = TRUE');
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(pa.name LIKE {:q} ESCAPE '\\' OR pa.code LIKE {:q} ESCAPE '\\' OR pa.email LIKE {:q} ESCAPE '\\' OR pa.contact_name LIKE {:q} ESCAPE '\\' OR pa.phone LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const ar = core().systemAccount(app, 'ar').id;
  const ap = core().systemAccount(app, 'ap').id;
  bind.ar = ar;
  bind.ap = ap;
  bind.today = util.today();
  // Overdue (the open balance in base of posted invoices or bills past due) and the latest
  // activity come from grouped tables joined once: correlated subqueries per party picked the
  // due-date index and scanned every overdue document for each party (seconds at 2,000 parties).
  const overdueTable = (type) =>
    "(SELECT d.party AS party, CAST(SUM(ROUND(d.balance * 1.0 * d.fx_e8 / 100000000)) AS INTEGER) AS v FROM documents d WHERE d.type = '" +
    type +
    "' AND d.state = 'posted' AND d.balance > 0 AND d.due_date != '' AND d.due_date < {:today} GROUP BY d.party)";
  const joins =
    ' LEFT JOIN ' + overdueTable('invoice') + ' odr ON odr.party = pa.id' +
    ' LEFT JOIN ' + overdueTable('bill') + ' odp ON odp.party = pa.id' +
    " LEFT JOIN (SELECT d.party AS party, MAX(d.date) AS v FROM documents d WHERE d.state != 'draft' GROUP BY d.party) lad ON lad.party = pa.id" +
    " LEFT JOIN (SELECT py.party AS party, MAX(py.date) AS v FROM payments py WHERE py.state = 'posted' GROUP BY py.party) lap ON lap.party = pa.id";
  const recSql = '(SELECT IFNULL(SUM(debit - credit), 0) FROM journal_lines WHERE party = pa.id AND account = {:ar})';
  const paySql = '(SELECT IFNULL(SUM(credit - debit), 0) FROM journal_lines WHERE party = pa.id AND account = {:ap})';
  const figures = recSql + ' AS receivable, ' + paySql + ' AS payable, IFNULL(odr.v, 0) AS overdue_receivable, IFNULL(odp.v, 0) AS overdue_payable, ' + "MAX(IFNULL(lad.v, ''), IFNULL(lap.v, '')) AS last_activity";
  // What counts as owing and overdue follows the role asked for.
  const owesSql = role === 'customer' ? 'x.receivable > 0' : role === 'supplier' ? 'x.payable > 0' : '(x.receivable > 0 OR x.payable > 0)';
  const lateSql = role === 'customer' ? 'x.overdue_receivable > 0' : role === 'supplier' ? 'x.overdue_payable > 0' : '(x.overdue_receivable > 0 OR x.overdue_payable > 0)';
  const owing = util.str(p, 'owing', '');
  if (owing === 'receivable') where.push(recSql + ' > 0');
  if (owing === 'payable') where.push(paySql + ' > 0');
  if (owing === 'overdue') where.push(role === 'customer' ? 'IFNULL(odr.v, 0) > 0' : role === 'supplier' ? 'IFNULL(odp.v, 0) > 0' : '(IFNULL(odr.v, 0) > 0 OR IFNULL(odp.v, 0) > 0)');
  const sorts = { name: 'pa.name COLLATE NOCASE', code: 'pa.code', created: 'pa.created', receivable: 'receivable', payable: 'payable', recent: 'last_activity' };
  const sortKey = util.oneOf(p, 'sort', Object.keys(sorts), 'name');
  const desc = util.bool(p, 'desc', sortKey === 'receivable' || sortKey === 'payable' || sortKey === 'created' || sortKey === 'recent');
  const whereSql = ' WHERE ' + where.join(' AND ');
  const total = util.one(app, 'SELECT COUNT(pa.id) AS n FROM parties pa' + (owing === 'overdue' ? joins : '') + whereSql, { n: 0 }, bind).n;
  const rows = util.rows(
    app,
    'SELECT pa.id AS id, pa.code AS code, pa.name AS name, pa.is_customer AS is_customer, pa.is_supplier AS is_supplier, pa.email AS email, pa.phone AS phone, pa.contact_name AS contact_name, pa.currency AS currency, pa.archived AS archived, ' +
      figures +
      ' FROM parties pa' +
      joins +
      whereSql +
      ' ORDER BY ' + sorts[sortKey] + (desc ? ' DESC' : ' ASC') + ', pa.name COLLATE NOCASE LIMIT ' + pg.limit + ' OFFSET ' + pg.offset,
    { id: '', code: '', name: '', is_customer: false, is_supplier: false, email: '', phone: '', contact_name: '', currency: '', archived: false, receivable: 0, payable: 0, overdue_receivable: 0, overdue_payable: 0, last_activity: '' },
    bind,
  );
  const counts = util.one(app, 'SELECT IFNULL(SUM(CASE WHEN is_customer AND NOT archived THEN 1 ELSE 0 END), 0) AS customers, IFNULL(SUM(CASE WHEN is_supplier AND NOT archived THEN 1 ELSE 0 END), 0) AS suppliers, IFNULL(SUM(CASE WHEN archived THEN 1 ELSE 0 END), 0) AS archived FROM parties', { customers: 0, suppliers: 0, archived: 0 });
  // What the active parties of this role owe and are owed, and how much of it is overdue (base currency).
  const roleSql = role === 'customer' ? ' AND pa.is_customer = TRUE' : role === 'supplier' ? ' AND pa.is_supplier = TRUE' : '';
  const sums = util.one(
    app,
    'SELECT IFNULL(SUM(x.receivable), 0) AS receivable, IFNULL(SUM(x.payable), 0) AS payable, IFNULL(SUM(x.overdue_receivable), 0) AS overdue_receivable, IFNULL(SUM(x.overdue_payable), 0) AS overdue_payable, ' +
      'IFNULL(SUM(CASE WHEN ' + owesSql + ' THEN 1 ELSE 0 END), 0) AS owing, IFNULL(SUM(CASE WHEN ' + lateSql + ' THEN 1 ELSE 0 END), 0) AS overdue FROM (SELECT ' +
      figures +
      ' FROM parties pa' +
      joins +
      ' WHERE pa.archived = FALSE' + roleSql + ') x',
    { receivable: 0, payable: 0, overdue_receivable: 0, overdue_payable: 0, owing: 0, overdue: 0 },
    { ar: ar, ap: ap, today: bind.today },
  );
  const countsOut = { customers: counts.customers, suppliers: counts.suppliers, archived: counts.archived, owing: sums.owing, overdue: sums.overdue };
  const totals = { receivable: sums.receivable, payable: sums.payable, overdue_receivable: sums.overdue_receivable, overdue_payable: sums.overdue_payable };
  return { parties: rows, total: total, counts: countsOut, totals: totals, currency: core().currency(app) };
}

function aging(app, partyId, side, today) {
  const util = u();
  const type = side === 'receivable' ? 'invoice' : 'bill';
  const rows = util.rows(app, "SELECT due_date, balance, fx_e8 FROM documents WHERE party = {:p} AND type = {:t} AND state = 'posted' AND balance > 0", { due_date: '', balance: 0, fx_e8: 0 }, { p: partyId, t: type });
  const b = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  for (const r of rows) {
    const base = Math.round((r.balance * (r.fx_e8 || 100000000)) / 100000000);
    const days = r.due_date === '' ? 0 : util.daysBetween(r.due_date, today);
    if (days <= 0) b.current += base;
    else if (days <= 30) b.d30 += base;
    else if (days <= 60) b.d60 += base;
    else if (days <= 90) b.d90 += base;
    else b.over90 += base;
  }
  return b;
}

function get(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const r = core().resolve(app, 'parties', util.req(p, 'party'));
  const out = partyOut(app, r, true);
  const today = util.today();
  out.aging_receivable = aging(app, r.id, 'receivable', today);
  out.aging_payable = aging(app, r.id, 'payable', today);
  out.contacts = app.findRecordsByFilter('contacts', 'party = {:p}', '-primary,name', 0, 0, { p: r.id }).map((c) => ({ id: c.id, name: c.getString('name'), email: c.getString('email'), phone: c.getString('phone'), title: c.getString('title'), primary: c.getBool('primary') }));
  const year = today.slice(0, 4);
  const sales = util.one(app, "SELECT IFNULL(SUM(CASE WHEN type = 'invoice' THEN total_base ELSE -total_base END), 0) AS s FROM documents WHERE party = {:p} AND type IN ('invoice','credit_note') AND state = 'posted' AND date >= {:y}", { s: 0 }, { p: r.id, y: year + '-01-01' }).s;
  const purchases = util.one(app, "SELECT IFNULL(SUM(CASE WHEN type = 'bill' THEN total_base ELSE -total_base END), 0) AS s FROM documents WHERE party = {:p} AND type IN ('bill','supplier_credit') AND state = 'posted' AND date >= {:y}", { s: 0 }, { p: r.id, y: year + '-01-01' }).s;
  out.sales_this_year = sales;
  out.purchases_this_year = purchases;
  // Twelve months of invoiced sales (or bills), for the chart.
  const from = util.addMonths(today.slice(0, 7), -11);
  const byMonth = {};
  for (const row of util.rows(app, "SELECT substr(date, 1, 7) AS m, IFNULL(SUM(CASE WHEN type IN ('invoice','bill') THEN total_base ELSE -total_base END), 0) AS v FROM documents WHERE party = {:p} AND state = 'posted' AND type IN ({:a}, {:b}) AND date >= {:f} GROUP BY m", { m: '', v: 0 }, { p: r.id, a: r.getBool('is_customer') ? 'invoice' : 'bill', b: r.getBool('is_customer') ? 'credit_note' : 'supplier_credit', f: from + '-01' })) byMonth[row.m] = row.v;
  out.months = util.monthsBetween(from, today.slice(0, 7)).map((m) => ({ month: m, value: byMonth[m] || 0 }));
  out.recent = util.rows(app, "SELECT id, type, number, state, date, due_date, total, balance, currency FROM documents WHERE party = {:p} ORDER BY date DESC, created DESC LIMIT 12", { id: '', type: '', number: '', state: '', date: '', due_date: '', total: 0, balance: 0, currency: '' }, { p: r.id });
  out.unallocated = util.rows(app, "SELECT id, direction, number, date, unallocated, currency FROM payments WHERE party = {:p} AND state = 'posted' AND unallocated > 0 ORDER BY date", { id: '', direction: '', number: '', date: '', unallocated: 0, currency: '' }, { p: r.id });
  out.open = {
    invoices: util.one(app, "SELECT COUNT(id) AS n FROM documents WHERE party = {:p} AND type = 'invoice' AND state = 'posted' AND balance > 0", { n: 0 }, { p: r.id }).n,
    bills: util.one(app, "SELECT COUNT(id) AS n FROM documents WHERE party = {:p} AND type = 'bill' AND state = 'posted' AND balance > 0", { n: 0 }, { p: r.id }).n,
    orders: util.one(app, "SELECT COUNT(id) AS n FROM documents WHERE party = {:p} AND type IN ('sales_order','purchase_order') AND state = 'open'", { n: 0 }, { p: r.id }).n,
    quotes: util.one(app, "SELECT COUNT(id) AS n FROM documents WHERE party = {:p} AND type = 'quote' AND state = 'open'", { n: 0 }, { p: r.id }).n,
  };
  out.base_currency = core().currency(app);
  // What a new document for this party starts with when nothing else is given
  // (the party's own setting, else the company default), so a screen can show
  // the due date and the tax before anything is saved.
  const defaults = core().defaults(app);
  const pick = (own, fallback) => (own !== '' ? own : typeof fallback === 'string' ? fallback : '');
  const termsRec = util.byId(app, 'payment_terms', pick(r.getString('terms'), defaults.terms));
  out.effective_terms = termsRec !== null ? { id: termsRec.id, name: termsRec.getString('name'), days: termsRec.getInt('days'), end_of_month: termsRec.getBool('end_of_month') } : null;
  const taxOut = (id) => {
    const t = util.byId(app, 'taxes', id);
    return t !== null && !t.getBool('archived') ? { id: t.id, code: t.getString('code'), name: t.getString('name'), rate_bp: t.getInt('rate_bp'), scope: t.getString('scope') } : null;
  };
  const saleTax = taxOut(pick(r.getString('sale_tax'), defaults.sale_tax));
  const purchaseTax = taxOut(pick(r.getString('purchase_tax'), defaults.purchase_tax));
  out.effective_sale_tax = saleTax !== null && (saleTax.scope === 'both' || saleTax.scope === 'sales') ? saleTax : null;
  out.effective_purchase_tax = purchaseTax !== null && (purchaseTax.scope === 'both' || purchaseTax.scope === 'purchase') ? purchaseTax : null;
  out.last_activity = util.one(app, "SELECT MAX(IFNULL((SELECT MAX(date) FROM documents WHERE party = {:p} AND state != 'draft'), ''), IFNULL((SELECT MAX(date) FROM payments WHERE party = {:p} AND state = 'posted'), '')) AS d", { d: '' }, { p: r.id }).d;
  out.can = {
    edit: ctx.isAgent || (r.getBool('is_customer') ? auth().can(ctx, 'sales', 'edit') : true) && (r.getBool('is_supplier') ? auth().can(ctx, 'purchasing', 'edit') : true),
  };
  return out;
}

function readParty(ctx, app, r, p, isNew) {
  const util = u();
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 160, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    r.set('name', n);
  }
  if (isNew && r.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.has(p, 'is_customer')) r.set('is_customer', util.bool(p, 'is_customer', false));
  if (util.has(p, 'is_supplier')) r.set('is_supplier', util.bool(p, 'is_supplier', false));
  if (isNew && !r.getBool('is_customer') && !r.getBool('is_supplier')) r.set('is_customer', true);
  for (const f of [['email', 160], ['phone', 40], ['website', 160], ['tax_id', 60], ['billing_address', 600], ['shipping_address', 600], ['contact_name', 120], ['notes', 2000]]) {
    if (util.has(p, f[0])) r.set(f[0], util.text(p, f[0], f[1], ''));
  }
  if (util.has(p, 'email') && r.getString('email') !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.getString('email'))) throw util.fail(400, 'email does not look like an email address', 'invalid_param');
  if (util.has(p, 'code')) {
    const c = util.text(p, 'code', 20, '');
    if (c !== '') {
      const other = util.findOne(app, 'parties', 'code = {:c} && id != {:i}', { c: c, i: r.id || '' });
      if (other !== null) throw util.fail(409, 'The code ' + c + ' is taken by ' + other.getString('name') + '.', 'duplicate');
    }
    r.set('code', c);
  }
  if (util.has(p, 'terms')) {
    const t = core().resolveOpt(app, 'payment_terms', util.str(p, 'terms', ''));
    r.set('terms', t !== null ? t.id : '');
  }
  if (util.has(p, 'currency')) {
    const c = util.str(p, 'currency', '').toUpperCase();
    if (c !== '' && !/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'currency must be a 3-letter code', 'invalid_param');
    r.set('currency', c === core().currency(app) ? '' : c);
  }
  if (util.has(p, 'credit_limit')) r.set('credit_limit', util.money(p, 'credit_limit', core().currency(app)) || 0);
  if (util.has(p, 'sale_tax')) {
    const t = core().resolveOpt(app, 'taxes', util.str(p, 'sale_tax', ''));
    r.set('sale_tax', t !== null ? t.id : '');
  }
  if (util.has(p, 'purchase_tax')) {
    const t = core().resolveOpt(app, 'taxes', util.str(p, 'purchase_tax', ''));
    r.set('purchase_tax', t !== null ? t.id : '');
  }
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
}

function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  const cust = util.has(p, 'is_customer') ? util.bool(p, 'is_customer', false) : !util.bool(p, 'is_supplier', false);
  const supp = util.bool(p, 'is_supplier', false);
  needEdit(ctx, cust, supp);
  let id = '';
  app.runInTransaction((tx) => {
    const r = util.newRecord(tx, 'parties');
    r.set('archived', false);
    readParty(ctx, tx, r, p, true);
    if (!util.has(p, 'is_customer') && !util.has(p, 'is_supplier')) r.set('is_customer', true);
    if (r.getString('code') === '') r.set('code', core().nextNumber(tx, 'party'));
    if (!util.has(p, 'terms')) {
      const d = core().defaults(tx);
      if (typeof d.terms === 'string') r.set('terms', d.terms);
    }
    // A person may add the same name twice (two "John Smith"). Your AI agent must say so with
    // same_name, so a call retried after a timeout does not add the party a second time.
    if (ctx.isAgent && !util.bool(p, 'same_name', false)) {
      const hit = util.one(tx, 'SELECT id FROM parties WHERE name = {:n} COLLATE NOCASE AND archived = FALSE LIMIT 1', { id: '' }, { n: r.getString('name') });
      const twin = hit !== null ? util.byId(tx, 'parties', hit.id) : null;
      if (twin !== null) {
        throw util.fail(409, 'There is already ' + (twin.getBool('is_customer') ? 'a customer' : 'a supplier') + ' called ' + twin.getString('name') + ' (' + twin.getString('code') + '). Use it, or pass same_name true to add a different one with the same name.', 'duplicate_name', { party: { id: twin.id, code: twin.getString('code'), name: twin.getString('name') } });
      }
    }
    tx.save(r);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'create', entity: 'parties', ref: r.id, label: r.getString('name'), summary: 'Added ' + (r.getBool('is_customer') ? 'customer ' : 'supplier ') + r.getString('name') });
    id = r.id;
  });
  return get(ctx, { party: id });
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = core().resolve(app, 'parties', util.req(p, 'party'));
  needEdit(ctx, r.getBool('is_customer') || util.bool(p, 'is_customer', false), r.getBool('is_supplier') || util.bool(p, 'is_supplier', false));
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('parties', r.id);
    readParty(ctx, tx, x, p, false);
    if (!x.getBool('is_customer') && !x.getBool('is_supplier')) throw util.fail(400, 'A party is a customer, a supplier, or both.', 'invalid_param');
    tx.save(x);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'update', entity: 'parties', ref: x.id, label: x.getString('name'), summary: 'Changed ' + x.getString('name') });
  });
  return get(ctx, { party: r.id });
}

function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = core().resolve(app, 'parties', util.req(p, 'party'));
  needEdit(ctx, r.getBool('is_customer'), r.getBool('is_supplier'));
  const docs = util.one(app, 'SELECT COUNT(id) AS n FROM documents WHERE party = {:p}', { n: 0 }, { p: r.id }).n;
  const pays = util.one(app, 'SELECT COUNT(id) AS n FROM payments WHERE party = {:p}', { n: 0 }, { p: r.id }).n;
  const lines = util.one(app, 'SELECT COUNT(id) AS n FROM journal_lines WHERE party = {:p}', { n: 0 }, { p: r.id }).n;
  if (docs + pays + lines > 0) throw util.fail(409, r.getString('name') + ' has ' + docs + ' documents and ' + pays + ' payments. Archive them instead, so the history keeps the name.', 'has_history');
  if (util.bool(p, 'preview', false)) return { preview: true, name: r.getString('name') };
  app.runInTransaction((tx) => {
    for (const t of ['items', 'projects']) {
      const field = t === 'items' ? 'supplier' : 'customer';
      for (const x of tx.findRecordsByFilter(t, field + ' = {:p}', '', 0, 0, { p: r.id })) {
        const y = tx.findRecordById(t, x.id);
        y.set(field, '');
        tx.save(y);
      }
    }
    tx.delete(tx.findRecordById('parties', r.id));
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'delete', entity: 'parties', ref: r.id, label: r.getString('name'), summary: 'Deleted ' + r.getString('name') });
  });
  return { deleted: true };
}

/** A statement: opening balance, every receivable (or payable) entry in the range, closing. */
function statement(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const r = core().resolve(app, 'parties', util.req(p, 'party'));
  const side = util.oneOf(p, 'side', ['receivable', 'payable'], r.getBool('is_customer') ? 'receivable' : 'payable');
  const today = util.today();
  const from = util.day(p, 'from', util.addMonths(today.slice(0, 7), -2) + '-01');
  const to = util.day(p, 'to', today);
  const acc = core().systemAccount(app, side === 'receivable' ? 'ar' : 'ap').id;
  const sign = side === 'receivable' ? 1 : -1;
  const open = util.one(app, 'SELECT IFNULL(SUM(debit - credit), 0) AS b FROM journal_lines WHERE party = {:p} AND account = {:a} AND date < {:f}', { b: 0 }, { p: r.id, a: acc, f: from }).b * sign;
  const rows = util.rows(app, 'SELECT jl.date AS date, jl.debit AS debit, jl.credit AS credit, jl.memo AS memo, j.number AS journal, j.kind AS kind, j.source_entity AS entity, j.source_id AS source, j.source_label AS label FROM journal_lines jl JOIN journals j ON j.id = jl.journal WHERE jl.party = {:p} AND jl.account = {:a} AND jl.date >= {:f} AND jl.date <= {:t} ORDER BY jl.date, j.created', { date: '', debit: 0, credit: 0, memo: '', journal: '', kind: '', entity: '', source: '', label: '' }, { p: r.id, a: acc, f: from, t: to });
  let bal = open;
  const lines = rows.map((x) => {
    const amount = (x.debit - x.credit) * sign;
    bal += amount;
    return { date: x.date, kind: x.kind, label: x.label, entity: x.entity, source: x.source, memo: x.memo, journal: x.journal, amount: amount, balance: bal };
  });
  return { party: { id: r.id, name: r.getString('name'), code: r.getString('code'), email: r.getString('email'), billing_address: r.getString('billing_address') }, side: side, from: from, to: to, opening: open, closing: bal, lines: lines, currency: core().currency(app), company: core().settings(app).getString('company_name') };
}

/* --------------------------------------------------------------- contacts */

function addContact(ctx, p) {
  const util = u();
  const r = core().resolve(ctx.app, 'parties', util.req(p, 'party'));
  needEdit(ctx, r.getBool('is_customer'), r.getBool('is_supplier'));
  const c = util.newRecord(ctx.app, 'contacts');
  c.set('party', r.id);
  saveContact(ctx, c, p, true);
  return { id: c.id };
}

function saveContact(ctx, c, p, isNew) {
  const util = u();
  if (util.has(p, 'name')) c.set('name', util.squash(util.text(p, 'name', 120, '')));
  if (isNew && c.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.has(p, 'email')) c.set('email', util.text(p, 'email', 160, ''));
  if (util.has(p, 'phone')) c.set('phone', util.text(p, 'phone', 40, ''));
  if (util.has(p, 'title')) c.set('title', util.text(p, 'title', 80, ''));
  if (util.has(p, 'primary')) c.set('primary', util.bool(p, 'primary', false));
  ctx.app.runInTransaction((tx) => {
    if (c.getBool('primary')) {
      for (const o of tx.findRecordsByFilter('contacts', 'party = {:p} && primary = true', '', 0, 0, { p: c.getString('party') })) {
        if (o.id === c.id) continue;
        const x = tx.findRecordById('contacts', o.id);
        x.set('primary', false);
        tx.save(x);
      }
    }
    tx.save(c);
  });
}

function updateContact(ctx, p) {
  const util = u();
  const c = core().resolve(ctx.app, 'contacts', util.req(p, 'contact'));
  const r = ctx.app.findRecordById('parties', c.getString('party'));
  needEdit(ctx, r.getBool('is_customer'), r.getBool('is_supplier'));
  saveContact(ctx, c, p, false);
  return { id: c.id };
}

function removeContact(ctx, p) {
  const util = u();
  const c = core().resolve(ctx.app, 'contacts', util.req(p, 'contact'));
  const r = ctx.app.findRecordById('parties', c.getString('party'));
  needEdit(ctx, r.getBool('is_customer'), r.getBool('is_supplier'));
  ctx.app.delete(c);
  return { deleted: true };
}

module.exports = {
  receivable: receivable,
  payable: payable,
  partyOut: partyOut,
  aging: aging,
  list: list,
  get: get,
  add: add,
  update: update,
  remove: remove,
  statement: statement,
  addContact: addContact,
  updateContact: updateContact,
  removeContact: removeContact,
};
