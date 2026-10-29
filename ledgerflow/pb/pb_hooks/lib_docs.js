/// <reference path="../pb_data/types.d.ts" />
/**
 * Invoices, bills, credit notes and vendor credits.
 *
 * A document is a draft (no effect on the books), approved (posted through
 * receivables or payables, numbered) or void. What is still owed is
 * `total - allocated`; payments, applied credits and write-offs are
 * allocations. The shown status is derived: paid, partial, overdue or open.
 *
 * Amounts are minor units of the document currency. A document in another
 * currency is booked at its rate; the difference when it is paid at another
 * rate is an exchange gain or loss.
 */

const SALES = { invoice: true, credit_note: true };
const CREDIT = { credit_note: true, vendor_credit: true };
const LABEL = { invoice: 'Invoice', bill: 'Bill', credit_note: 'Credit note', vendor_credit: 'Vendor credit' };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = String(id || '').trim();
  let rec = u.byId(app, 'documents', s);
  if (!rec && s !== '') {
    const rows = app.findRecordsByFilter('documents', 'number = {:n}', '-created', 1, 0, { n: s });
    rec = rows.length > 0 ? rows[0] : null;
  }
  if (!rec) throw fail(404, 'No document ' + s + '; see docs.list');
  return rec;
}

/* ---------------------------------------------------------------- status */

function derived(rec) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const st = rec.getString('status');
  if (st !== 'approved') return st;
  const open = rec.getInt('total') - rec.getInt('allocated');
  if (open <= 0) return CREDIT[rec.getString('kind')] ? 'applied' : 'paid';
  if (rec.getInt('allocated') > 0) return 'partial';
  const due = rec.getString('due_date');
  if (due !== '' && due < dates.today() && !CREDIT[rec.getString('kind')]) return 'overdue';
  return 'open';
}

function serializeLine(l) {
  return {
    id: l.id,
    description: l.getString('description'),
    quantity: l.getString('quantity') || '1',
    unit_price: l.getInt('unit_price'),
    account: l.getString('account'),
    tax_code: l.getString('tax_code'),
    subtotal: l.getInt('subtotal'),
    tax: l.getInt('tax'),
    total: l.getInt('total'),
    sort: l.getInt('sort'),
  };
}

function serializeAlloc(a) {
  return {
    id: a.id,
    payment: a.getString('payment'),
    document: a.getString('document'),
    credit_doc: a.getString('credit_doc'),
    kind: a.getString('kind') || 'payment',
    amount: a.getInt('amount'),
    home_amount: a.getInt('home_amount'),
    fx_diff: a.getInt('fx_diff'),
    date: a.getString('date'),
  };
}

function serialize(app, rec, full) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const total = rec.getInt('total');
  const allocated = rec.getInt('allocated');
  const due = rec.getString('due_date');
  const st = derived(rec);
  const out = {
    id: rec.id,
    kind: rec.getString('kind'),
    number: rec.getString('number'),
    contact: rec.getString('contact'),
    issue_date: rec.getString('issue_date'),
    due_date: due,
    currency: rec.getString('currency'),
    rate: rec.getString('rate'),
    inclusive: rec.getBool('inclusive'),
    status: rec.getString('status'),
    state: st,
    subtotal: rec.getInt('subtotal'),
    tax_total: rec.getInt('tax_total'),
    total: total,
    home_total: rec.getInt('home_total'),
    allocated: allocated,
    open: rec.getString('status') === 'approved' ? Math.max(0, total - allocated) : 0,
    days_overdue: st === 'overdue' ? dates.daysBetween(due, dates.today()) : 0,
    notes: rec.getString('notes'),
    terms: rec.getString('terms'),
    reference: rec.getString('reference'),
    txn: rec.getString('txn'),
    file: rec.getString('file'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    reminder: rec.getString('reminder'),
    reminded_at: rec.getString('reminded_at'),
    sent_at: rec.getString('sent_at'),
    recurring: rec.getString('recurring'),
    void_reason: rec.getString('void_reason'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
  try {
    const c = rec.getString('contact') ? app.findRecordById('contacts', rec.getString('contact')) : null;
    out.contact_name = c ? c.getString('name') : '';
  } catch {
    out.contact_name = '';
  }
  if (full) {
    out.lines = app.findRecordsByFilter('doc_lines', 'document = {:d}', 'sort,created', 0, 0, { d: rec.id }).map(serializeLine);
    out.allocations = app.findRecordsByFilter('allocations', 'document = {:d} || credit_doc = {:d}', 'date,created', 0, 0, { d: rec.id }).map(serializeAlloc);
  }
  return out;
}

/* ---------------------------------------------------------------- totals */

/**
 * Compute line and document totals. lines: [{ quantity, unit_price, tax_code
 * (record or null) }]. Reverse-charge codes add no tax to the document (the
 * buyer accounts for it). Rounding per line, or per tax code over the document.
 */
function totals(lines, inclusive, rounding) {
  const money = require(`${__hooks}/lib_money.js`);
  const rows = lines.map((l) => {
    const amount = money.mul(l.unit_price, l.quantity || '1');
    const tc = l.tax_code;
    const charge = tc && tc.getString('group') !== 'reverse';
    const rate = charge ? tc.getString('rate') || '0' : '0';
    return { amount: amount, rate: rate, code: tc ? tc.id : '', tax: 0 };
  });
  if (rounding === 'document') {
    const groups = {};
    rows.forEach((r, i) => {
      if (r.rate === '0') return;
      const g = (groups[r.code] = groups[r.code] || { rate: r.rate, sum: 0, idx: [] });
      g.sum += r.amount;
      g.idx.push(i);
    });
    for (const k of Object.keys(groups)) {
      const g = groups[k];
      const t = money.tax(Math.abs(g.sum), g.rate, inclusive) * Math.sign(g.sum || 1);
      const parts = money.split(t, g.idx.map((i) => Math.abs(rows[i].amount) || 1));
      g.idx.forEach((i, n) => (rows[i].tax = parts[n]));
    }
  } else {
    for (const r of rows) r.tax = r.rate === '0' ? 0 : money.tax(Math.abs(r.amount), r.rate, inclusive) * Math.sign(r.amount || 1);
  }
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  for (const r of rows) {
    r.subtotal = inclusive ? r.amount - r.tax : r.amount;
    r.total = r.subtotal + r.tax;
    subtotal += r.subtotal;
    tax += r.tax;
    total += r.total;
  }
  return { rows: rows, subtotal: subtotal, tax_total: tax, total: total };
}

/** The default account for a line with none given. */
function defaultAccount(app, kind, contact) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  if (contact && contact.getString('default_account')) return contact.getString('default_account');
  if (SALES[kind]) {
    const rows = app.findRecordsByFilter('accounts', "type = 'income' && archived = false && system != 'uncat_income'", 'code', 1, 0);
    if (rows.length > 0) return rows[0].id;
    return ledger.sys(app, 'uncat_income').id;
  }
  return ledger.sys(app, 'uncat_expense').id;
}

/**
 * Create or update a document. spec: { kind, contact (id or name; created
 * if new), issue_date, due_date | terms_days, currency, rate, inclusive,
 * lines [{ description, quantity, unit_price (decimal), account, tax_code }],
 * number (bills: the supplier's number), reference, notes, terms, file }.
 * Approved documents without payments can be edited; their entry is rewritten.
 */
function save(app, existing, spec, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const setup = require(`${__hooks}/lib_setup.js`);
  const s = setup.row(app);
  const rec = existing || new Record(app.findCollectionByNameOrId('documents'));
  const kind = existing ? rec.getString('kind') : spec.kind;
  if (!LABEL[kind]) throw fail(400, 'kind must be invoice, bill, credit_note or vendor_credit');
  if (existing && rec.getString('status') === 'void') throw fail(409, 'This document is void');
  const wasApproved = existing && rec.getString('status') === 'approved';
  if (wasApproved && rec.getInt('allocated') > 0) throw fail(409, 'This ' + LABEL[kind].toLowerCase() + ' has payments or credits applied; remove them before editing it');

  // Contact
  let contact = null;
  if (spec.contact !== undefined) {
    contact = ledger.contact(app, spec.contact, SALES[kind] ? 'customer' : 'vendor');
    rec.set('contact', contact ? contact.id : '');
  } else if (rec.getString('contact')) contact = ledger.contact(app, rec.getString('contact'));
  if (!contact) throw fail(400, (SALES[kind] ? 'A customer' : 'A supplier') + ' is required (contact: a name or id)');

  if (!existing) {
    rec.set('kind', kind);
    rec.set('status', 'draft');
    rec.set('added_by', spec.added_by || (who.actor === 'agent' ? 'agent' : 'user'));
    rec.set('run', who.run || '');
    rec.set('allocated', 0);
  }
  const issue = spec.issue_date !== undefined ? dates.parse(spec.issue_date, 'issue_date') : rec.getString('issue_date') || dates.today();
  rec.set('issue_date', issue);
  if (spec.due_date !== undefined && spec.due_date !== '') rec.set('due_date', dates.parse(spec.due_date, 'due_date'));
  else if (spec.terms_days !== undefined) rec.set('due_date', dates.addDays(issue, Math.max(0, parseInt(spec.terms_days, 10) || 0)));
  else if (!rec.getString('due_date') || spec.issue_date !== undefined) {
    const days = contact.getInt('terms') || s.getInt('payment_terms') || 0;
    if (!CREDIT[kind]) rec.set('due_date', dates.addDays(issue, days));
  }
  if (rec.getString('due_date') !== '' && rec.getString('due_date') < issue) throw fail(400, 'The due date is before the issue date');
  const homeCcy = ledger.home(app);
  const ccy = String(spec.currency || rec.getString('currency') || contact.getString('currency') || homeCcy).toUpperCase();
  if (!money.known(ccy)) throw fail(400, 'Unknown currency ' + ccy);
  rec.set('currency', ccy);
  if (ccy === homeCcy) rec.set('rate', '');
  else if (spec.rate !== undefined && String(spec.rate).trim() !== '') {
    const r = String(spec.rate).trim();
    if (!(Number(r) > 0)) throw fail(400, 'rate must be a positive number (home currency per 1 ' + ccy + ')');
    rec.set('rate', r);
  } else if (!rec.getString('rate')) {
    const r = ledger.rateFor(app, ccy, issue);
    if (r === '') throw fail(409, 'No ' + ccy + ' rate on or before ' + issue + '; give rate or add one in Setup, Currencies');
    rec.set('rate', r);
  }
  if (spec.inclusive !== undefined) rec.set('inclusive', !!spec.inclusive);
  for (const k of ['notes', 'terms', 'reference', 'file']) if (spec[k] !== undefined) rec.set(k, String(spec[k] || ''));
  if (spec.number !== undefined) {
    const n = String(spec.number || '').trim().slice(0, 40);
    if (n !== '' && SALES[kind]) {
      const clash = app.findRecordsByFilter('documents', 'number = {:n} && kind = {:k} && id != {:id}', '', 1, 0, { n: n, k: kind, id: rec.id || '' });
      if (clash.length > 0) throw fail(409, LABEL[kind] + ' number ' + n + ' is already used');
    }
    rec.set('number', n);
  }

  // Lines
  let lineSpecs = null;
  if (spec.lines !== undefined) {
    if (!Array.isArray(spec.lines) || spec.lines.length === 0) throw fail(400, 'lines must be a list of { description, quantity, unit_price, account, tax_code }');
    if (spec.lines.length > 200) throw fail(400, 'At most 200 lines');
    const fallback = defaultAccount(app, kind, contact);
    lineSpecs = spec.lines.map((l, i) => {
      const q = String(l.quantity === undefined || l.quantity === null || l.quantity === '' ? '1' : l.quantity).trim();
      if (!/^-?\d+(\.\d+)?$/.test(q)) throw fail(400, 'lines[' + i + '].quantity must be a number');
      const acc = ledger.account(app, l.account || fallback);
      if (acc.getBool('archived')) throw fail(409, 'The account ' + acc.getString('name') + ' is archived');
      if (acc.getString('system') === 'ar' || acc.getString('system') === 'ap') throw fail(400, 'A line cannot post to receivables or payables directly');
      const tcRef = l.tax_code !== undefined ? l.tax_code : contact.getString('default_tax');
      return {
        description: String(l.description || '').slice(0, 500),
        quantity: q,
        unit_price: money.amount(l.unit_price === undefined ? 0 : l.unit_price, ccy, 'lines[' + i + '].unit_price'),
        account: acc.id,
        tax_code: tcRef ? ledger.taxCode(app, tcRef) : null,
      };
    });
  } else if (existing) {
    lineSpecs = app.findRecordsByFilter('doc_lines', 'document = {:d}', 'sort,created', 0, 0, { d: rec.id }).map((l) => ({
      description: l.getString('description'),
      quantity: l.getString('quantity') || '1',
      unit_price: l.getInt('unit_price'),
      account: l.getString('account'),
      tax_code: l.getString('tax_code') ? ledger.taxCode(app, l.getString('tax_code')) : null,
    }));
  } else throw fail(400, 'lines are required');

  const t = totals(lineSpecs, rec.getBool('inclusive'), s.getString('rounding') || 'line');
  if (t.total < 0) throw fail(400, 'The total is negative; use a ' + (SALES[kind] ? 'credit note' : 'vendor credit') + ' instead');
  rec.set('subtotal', t.subtotal);
  rec.set('tax_total', t.tax_total);
  rec.set('total', t.total);
  rec.set('home_total', ccy === homeCcy ? t.total : money.toHome(t.total, ccy, homeCcy, rec.getString('rate')));
  if (wasApproved) ledger.checkLock(app, rec.getString('issue_date'), who);
  app.save(rec);

  if (spec.lines !== undefined || !existing) {
    for (const old of app.findRecordsByFilter('doc_lines', 'document = {:d}', '', 0, 0, { d: rec.id })) app.delete(old);
    const col = app.findCollectionByNameOrId('doc_lines');
    lineSpecs.forEach((l, i) => {
      const r = new Record(col);
      r.set('document', rec.id);
      r.set('description', l.description);
      r.set('quantity', l.quantity);
      r.set('unit_price', l.unit_price);
      r.set('account', l.account);
      r.set('tax_code', l.tax_code ? l.tax_code.id : '');
      r.set('subtotal', t.rows[i].subtotal);
      r.set('tax', t.rows[i].tax);
      r.set('total', t.rows[i].total);
      r.set('sort', i);
      app.save(r);
    });
  }
  if (wasApproved) {
    ledger.replace(app, rec.getString('txn'), { from_document: true, date: rec.getString('issue_date'), contact: contact.id, narration: narration(rec, contact), postings: postingsFor(app, rec) }, who);
  }
  return { doc: rec, warnings: warnings(app, rec) };
}

function narration(rec, contact) {
  return LABEL[rec.getString('kind')] + ' ' + (rec.getString('number') || '') + (contact ? ' · ' + contact.getString('name') : '');
}

/** Possible duplicates: a bill with the same supplier number, or the same supplier and total within a week. */
function warnings(app, rec) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const out = [];
  if (SALES[rec.getString('kind')]) return out;
  const near = app.findRecordsByFilter('documents', "kind = {:k} && contact = {:c} && id != {:id} && status != 'void'", '-issue_date', 50, 0, { k: rec.getString('kind'), c: rec.getString('contact'), id: rec.id });
  for (const d of near) {
    const sameNo = rec.getString('number') !== '' && d.getString('number') === rec.getString('number');
    const sameAmt = d.getInt('total') === rec.getInt('total') && Math.abs(dates.daysBetween(d.getString('issue_date'), rec.getString('issue_date'))) <= 7;
    if (sameNo || sameAmt) out.push({ kind: 'duplicate', document: d.id, number: d.getString('number'), reason: sameNo ? 'Same supplier number' : 'Same supplier and total within a week' });
  }
  return out;
}

/* ---------------------------------------------------------------- posting */

/** The postings that book an approved document. */
function postingsFor(app, rec) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const kind = rec.getString('kind');
  const ccy = rec.getString('currency');
  const rate = rec.getString('rate');
  const contactId = rec.getString('contact');
  // Sales: income is a credit. Purchases: costs are debits. Credits flip it.
  const sign = (SALES[kind] ? -1 : 1) * (CREDIT[kind] ? -1 : 1);
  const control = ledger.sys(app, SALES[kind] ? 'ar' : 'ap');
  const lines = app.findRecordsByFilter('doc_lines', 'document = {:d}', 'sort,created', 0, 0, { d: rec.id });
  const rows = [];
  const taxByAccount = {};
  for (const l of lines) {
    const tc = l.getString('tax_code') ? ledger.taxCode(app, l.getString('tax_code')) : null;
    if (l.getInt('subtotal') !== 0) rows.push({ account: l.getString('account'), amount: sign * l.getInt('subtotal'), currency: ccy, rate: rate, contact: contactId, tax_code: tc ? tc.id : '', tax_role: tc ? 'base' : '', memo: l.getString('description').slice(0, 300) });
    if (!tc) continue;
    const taxAcc = tc.getString('account') || ledger.sys(app, 'tax').id;
    if (tc.getString('group') === 'reverse' && !SALES[kind]) {
      // The buyer self-accounts: input and output tax cancel out.
      const t = money.tax(Math.abs(l.getInt('subtotal')), tc.getString('rate') || '0', false);
      if (t !== 0) {
        rows.push({ account: taxAcc, amount: sign * t, currency: ccy, rate: rate, contact: contactId, tax_code: tc.id, tax_role: 'tax', memo: 'Reverse charge input' });
        rows.push({ account: taxAcc, amount: -sign * t, currency: ccy, rate: rate, contact: contactId, tax_code: tc.id, tax_role: 'tax', memo: 'Reverse charge output' });
      }
      continue;
    }
    if (l.getInt('tax') !== 0) {
      const k = taxAcc + '|' + tc.id;
      taxByAccount[k] = (taxByAccount[k] || 0) + l.getInt('tax');
    }
  }
  for (const k of Object.keys(taxByAccount)) {
    const parts = k.split('|');
    rows.push({ account: parts[0], amount: sign * taxByAccount[k], currency: ccy, rate: rate, contact: contactId, tax_code: parts[1], tax_role: 'tax', memo: 'Tax' });
  }
  rows.push({ account: control, amount: -sign * rec.getInt('total'), currency: ccy, rate: rate, contact: contactId, memo: LABEL[kind] + ' ' + rec.getString('number') });
  return rows;
}

function nextNumber(app, kind) {
  const setup = require(`${__hooks}/lib_setup.js`);
  const s = setup.row(app);
  const pre = kind === 'invoice' ? 'invoice' : 'credit';
  const prefix = s.getString(pre + '_prefix');
  let n = s.getInt(pre + '_next') || 1;
  for (let i = 0; i < 1000; i++) {
    const num = prefix + n;
    const clash = app.findRecordsByFilter('documents', 'number = {:n} && kind = {:k}', '', 1, 0, { n: num, k: kind });
    if (clash.length === 0) {
      s.set(pre + '_next', n + 1);
      app.save(s);
      return num;
    }
    n++;
  }
  throw fail(409, 'Could not find a free number; set the next number in Setup');
}

/** Approve a draft: number it and post it. */
function approve(app, rec, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  if (rec.getString('status') !== 'draft') throw fail(409, 'Only a draft can be approved (this one is ' + rec.getString('status') + ')');
  if (rec.getInt('total') <= 0) throw fail(400, 'A document needs a total above zero');
  ledger.checkLock(app, rec.getString('issue_date'), who);
  const kind = rec.getString('kind');
  if (SALES[kind] && rec.getString('number') === '') rec.set('number', nextNumber(app, kind));
  rec.set('status', 'approved');
  app.save(rec);
  const contact = ledger.contact(app, rec.getString('contact'));
  const r = ledger.create(
    app,
    {
      date: rec.getString('issue_date'),
      narration: narration(rec, contact),
      contact: rec.getString('contact'),
      kind: kind,
      reference: rec.getString('number'),
      document: rec.id,
      postings: postingsFor(app, rec),
      method: 'document',
      added_by: rec.getString('added_by') === 'recurring' ? 'recurring' : who.actor === 'agent' ? 'agent' : 'user',
    },
    who,
  );
  rec.set('txn', r.txn.id);
  app.save(rec);
  return rec;
}

/** Void an approved document (or discard a draft). */
function voidDoc(app, rec, reason, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const st = rec.getString('status');
  if (st === 'void') throw fail(409, 'Already void');
  if (st === 'draft') {
    rec.set('status', 'void');
    rec.set('void_reason', String(reason || 'Draft discarded').slice(0, 500));
    app.save(rec);
    return rec;
  }
  const allocs = app.findRecordsByFilter('allocations', 'document = {:d} || credit_doc = {:d}', '', 0, 0, { d: rec.id });
  if (allocs.length > 0) throw fail(409, 'Remove its ' + allocs.length + ' payment' + (allocs.length === 1 ? '' : 's') + ' or credit' + (allocs.length === 1 ? '' : 's') + ' first');
  if (rec.getString('txn')) ledger.voidTxn(app, rec.getString('txn'), reason || LABEL[rec.getString('kind')] + ' voided', who, true);
  rec.set('status', 'void');
  rec.set('void_reason', String(reason || '').slice(0, 500));
  app.save(rec);
  return rec;
}

/* ---------------------------------------------------------------- payments */

/** Home value of part of a document, at the rate it was booked. */
function bookedHome(rec, part) {
  const total = rec.getInt('total');
  if (total === 0) return 0;
  return Math.round((rec.getInt('home_total') * part) / total);
}

/**
 * Record a payment against one or more approved documents of one contact.
 * p: { documents: [rec], amounts?: [minor per doc, document currency],
 * account (bank/cash/card), amount (minor, account currency, positive),
 * date, rate?, statement_line?, method?, line_amount?, memo? }.
 */
function recordPayment(app, p, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const docs = p.documents;
  if (!docs || docs.length === 0) throw fail(400, 'Which documents does this pay?');
  const first = docs[0];
  const kind = first.getString('kind');
  const side = SALES[kind] ? 'sales' : 'purchases';
  for (const d of docs) {
    if (d.getString('status') !== 'approved') throw fail(409, (d.getString('number') || 'A draft') + ' is not approved yet; approve it before recording a payment');
    if ((SALES[d.getString('kind')] ? 'sales' : 'purchases') !== side) throw fail(400, 'Pay invoices and bills separately');
    if (d.getString('contact') !== first.getString('contact')) throw fail(400, 'All documents in one payment must be for the same contact');
    if (d.getString('currency') !== first.getString('currency')) throw fail(400, 'All documents in one payment must be in the same currency');
  }
  const bank = p.account && typeof p.account === 'object' && p.account.id ? p.account : ledger.account(app, p.account);
  if (!require(`${__hooks}/lib_inbox.js`).cashLike(bank)) throw fail(400, 'Payments go through a bank, card or cash account');
  const date = dates.parse(p.date || dates.today(), 'date');
  const homeCcy = ledger.home(app);
  const docCcy = first.getString('currency');
  const bankCcy = bank.getString('currency') || homeCcy;
  const amount = Math.abs(money.int(p.amount, 'amount'));
  if (amount === 0) throw fail(400, 'amount must be above zero');

  // How much of each document this settles (document currency).
  let parts;
  if (Array.isArray(p.amounts) && p.amounts.length === docs.length) parts = p.amounts.map((a) => Math.abs(money.int(a, 'amounts')));
  else {
    let left = bankCcy === docCcy ? amount : p.doc_amount !== undefined ? Math.abs(money.int(p.doc_amount, 'doc_amount')) : null;
    if (left === null) throw fail(400, 'The account is in ' + bankCcy + ' and the document in ' + docCcy + '; give doc_amount (what it settles in ' + docCcy + ')');
    parts = docs.map((d) => {
      const take = Math.min(left, d.getInt('total') - d.getInt('allocated'));
      left -= take;
      return take;
    });
    if (left > 0) throw fail(400, 'The payment is ' + money.format(left, bankCcy === docCcy ? docCcy : docCcy) + ' more than is owed; record the extra separately');
  }
  docs.forEach((d, i) => {
    const open = d.getInt('total') - d.getInt('allocated');
    if (parts[i] > open) throw fail(400, (d.getString('number') || 'The document') + ' has only ' + money.format(open, docCcy) + ' open');
  });
  const applied = parts.reduce((a, b) => a + b, 0);
  if (applied === 0) throw fail(400, 'Nothing is open on these documents');
  if (bankCcy === docCcy && applied !== amount) throw fail(400, 'The amounts applied (' + money.format(applied, docCcy) + ') must equal the payment (' + money.format(amount, docCcy) + ')');

  // In: debit bank, credit receivables. Out: credit bank, debit payables.
  // Credits flip (a refund paid to a customer, a refund received from a supplier).
  const inbound = (side === 'sales') !== !!CREDIT[kind];
  const control = ledger.sys(app, side === 'sales' ? 'ar' : 'ap');
  let bankHome;
  if (bankCcy === homeCcy) bankHome = amount;
  else {
    const r = p.rate ? String(p.rate) : ledger.rateFor(app, bankCcy, date);
    if (!r) throw fail(409, 'No ' + bankCcy + ' rate on or before ' + date + '; give rate');
    bankHome = money.toHome(amount, bankCcy, homeCcy, r);
  }
  const rows = [{ account: bank, amount: inbound ? amount : -amount, currency: bankCcy, home_amount: inbound ? bankHome : -bankHome, statement_line: p.statement_line || '', recon_state: p.statement_line ? 'cleared' : '', memo: p.memo || '' }];
  let controlHome = 0;
  const homes = docs.map((d, i) => bookedHome(d, parts[i]));
  docs.forEach((d, i) => {
    if (parts[i] === 0) return;
    controlHome += homes[i];
    rows.push({ account: control, amount: inbound ? -parts[i] : parts[i], currency: docCcy, home_amount: inbound ? -homes[i] : homes[i], contact: d.getString('contact'), memo: LABEL[d.getString('kind')] + ' ' + d.getString('number') });
  });
  const diff = (inbound ? bankHome : -bankHome) + (inbound ? -controlHome : controlHome);
  if (diff !== 0) rows.push({ account: ledger.sys(app, 'fx'), amount: -diff, currency: homeCcy, home_amount: -diff, memo: 'Exchange difference on payment' });
  const contact = ledger.contact(app, first.getString('contact'));
  const r = ledger.create(
    app,
    {
      date: date,
      narration: (inbound ? 'Payment from ' : 'Payment to ') + (contact ? contact.getString('name') : '') + ' · ' + docs.map((d) => d.getString('number') || LABEL[d.getString('kind')]).join(', '),
      contact: first.getString('contact'),
      kind: 'payment',
      postings: rows,
      source_line: p.statement_line || '',
      method: p.method || 'manual',
      added_by: who.actor === 'agent' ? 'agent' : who.actor === 'rule' ? 'rule' : 'user',
    },
    who,
  );
  const col = app.findCollectionByNameOrId('allocations');
  docs.forEach((d, i) => {
    if (parts[i] === 0) return;
    const a = new Record(col);
    a.set('payment', r.txn.id);
    a.set('document', d.id);
    a.set('kind', 'payment');
    a.set('amount', parts[i]);
    a.set('home_amount', homes[i]);
    a.set('fx_diff', docs.length === 1 ? diff : 0);
    a.set('date', date);
    app.save(a);
    d.set('allocated', d.getInt('allocated') + parts[i]);
    app.save(d);
  });
  return { txn: r.txn, applied: applied, fx_diff: diff };
}

/** Apply a credit note to an invoice (or a vendor credit to a bill). */
function applyCredit(app, credit, target, amount, date, who) {
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const pair = { credit_note: 'invoice', vendor_credit: 'bill' };
  if (pair[credit.getString('kind')] !== target.getString('kind')) throw fail(400, 'Apply a credit note to an invoice, or a vendor credit to a bill');
  if (credit.getString('status') !== 'approved' || target.getString('status') !== 'approved') throw fail(409, 'Both must be approved');
  if (credit.getString('contact') !== target.getString('contact')) throw fail(400, 'Both must be for the same contact');
  if (credit.getString('currency') !== target.getString('currency')) throw fail(400, 'Both must be in the same currency');
  const d = dates.parse(date || dates.today(), 'date');
  ledger.checkLock(app, d, who);
  const ccy = credit.getString('currency');
  const avail = Math.min(credit.getInt('total') - credit.getInt('allocated'), target.getInt('total') - target.getInt('allocated'));
  const amt = amount === undefined || amount === null || amount === '' ? avail : Math.abs(money.amount(amount, ccy, 'amount'));
  if (amt <= 0) throw fail(400, 'Nothing left to apply');
  if (amt > avail) throw fail(400, 'At most ' + money.format(avail, ccy) + ' can be applied');
  const a = new Record(app.findCollectionByNameOrId('allocations'));
  a.set('document', target.id);
  a.set('credit_doc', credit.id);
  a.set('kind', 'credit');
  a.set('amount', amt);
  a.set('home_amount', bookedHome(target, amt));
  a.set('date', d);
  app.save(a);
  target.set('allocated', target.getInt('allocated') + amt);
  credit.set('allocated', credit.getInt('allocated') + amt);
  app.save(target);
  app.save(credit);
  return a;
}

/** Write off what is left on an invoice as a bad debt. */
function writeOff(app, rec, date, reason, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  if (rec.getString('kind') !== 'invoice') throw fail(400, 'Only an invoice can be written off');
  if (rec.getString('status') !== 'approved') throw fail(409, 'Only an approved invoice can be written off');
  const open = rec.getInt('total') - rec.getInt('allocated');
  if (open <= 0) throw fail(409, 'Nothing is owed on this invoice');
  const d = dates.parse(date || dates.today(), 'date');
  const home = bookedHome(rec, open);
  const ccy = rec.getString('currency');
  const r = ledger.create(
    app,
    {
      date: d,
      narration: 'Write-off · Invoice ' + rec.getString('number') + (reason ? ' · ' + reason : ''),
      contact: rec.getString('contact'),
      kind: 'writeoff',
      postings: [
        { account: ledger.sys(app, 'bad_debt'), amount: home, currency: ledger.home(app), home_amount: home, contact: rec.getString('contact'), memo: reason || '' },
        { account: ledger.sys(app, 'ar'), amount: -open, currency: ccy, home_amount: -home, contact: rec.getString('contact'), memo: 'Invoice ' + rec.getString('number') },
      ],
      reason: reason || '',
    },
    who,
  );
  const a = new Record(app.findCollectionByNameOrId('allocations'));
  a.set('payment', r.txn.id);
  a.set('document', rec.id);
  a.set('kind', 'writeoff');
  a.set('amount', open);
  a.set('home_amount', home);
  a.set('date', d);
  app.save(a);
  rec.set('allocated', rec.getInt('allocated') + open);
  app.save(rec);
  return { txn: r.txn, amount: open };
}

/** Take allocations off their documents (their payment entry is voided by the caller). */
function removeAllocations(app, allocs) {
  for (const a of allocs) {
    for (const id of [a.getString('document'), a.getString('credit_doc')]) {
      if (!id) continue;
      try {
        const d = app.findRecordById('documents', id);
        d.set('allocated', Math.max(0, d.getInt('allocated') - a.getInt('amount')));
        app.save(d);
      } catch {
        /* document gone */
      }
    }
    app.delete(a);
  }
}

/** Remove one allocation: a credit is unapplied; a payment or write-off is voided. */
function removeAllocation(app, allocId, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const a = u.byId(app, 'allocations', allocId);
  if (!a) throw fail(404, 'No allocation ' + allocId);
  if (a.getString('kind') === 'credit') {
    ledger.checkLock(app, a.getString('date'), who);
    removeAllocations(app, [a]);
    return null;
  }
  // voidTxn removes every allocation of the payment.
  return ledger.voidTxn(app, a.getString('payment'), 'Payment removed', who, false);
}

/* --------------------------------------------------------------- queries */

/** Documents filtered. opts: { kind, side, state, contact, q, from, to, limit } */
function list(app, opts) {
  const o = opts || {};
  const parts = [];
  const prm = {};
  if (o.kind) {
    parts.push('kind = {:k}');
    prm.k = o.kind;
  } else if (o.side === 'sales') parts.push("(kind = 'invoice' || kind = 'credit_note')");
  else if (o.side === 'purchases') parts.push("(kind = 'bill' || kind = 'vendor_credit')");
  if (o.contact) {
    parts.push('contact = {:c}');
    prm.c = o.contact;
  }
  if (o.from) {
    parts.push('issue_date >= {:f}');
    prm.f = o.from;
  }
  if (o.to) {
    parts.push('issue_date <= {:t}');
    prm.t = o.to;
  }
  if (o.state === 'draft' || o.state === 'void') parts.push("status = '" + o.state + "'");
  else if (o.state && o.state !== 'all') parts.push("status = 'approved'");
  else if (!o.state) parts.push("status != 'void'");
  const rows = app.findRecordsByFilter('documents', parts.length ? parts.join(' && ') : 'id != ""', '-issue_date,-created', 0, 0, prm);
  let out = rows.map((r) => serialize(app, r, false));
  if (o.state && ['open', 'overdue', 'partial', 'paid', 'applied', 'unpaid'].indexOf(o.state) >= 0) {
    out = out.filter((d) => (o.state === 'unpaid' ? d.open > 0 : d.state === o.state));
  }
  if (o.q) {
    const q = String(o.q).toLowerCase();
    out = out.filter((d) => (d.number + ' ' + d.contact_name + ' ' + d.reference + ' ' + d.notes).toLowerCase().indexOf(q) >= 0);
  }
  const total = out.length;
  return { total: total, docs: out.slice(o.offset || 0, (o.offset || 0) + (o.limit || 300)) };
}

/** Totals for the Sales or Purchases header: open, overdue, drafts, paid in the last 30 days (home currency). */
function summary(app, side) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const kinds = side === 'sales' ? "(kind = 'invoice')" : "(kind = 'bill')";
  const rows = app.findRecordsByFilter('documents', kinds + " && status != 'void'", '', 0, 0);
  const out = { open: 0, open_count: 0, overdue: 0, overdue_count: 0, draft_count: 0, paid_30: 0, due_7: 0 };
  const today = dates.today();
  const week = dates.addDays(today, 7);
  for (const d of rows) {
    if (d.getString('status') === 'draft') {
      out.draft_count++;
      continue;
    }
    const open = d.getInt('total') - d.getInt('allocated');
    if (open <= 0) continue;
    const home = bookedHome(d, open);
    out.open += home;
    out.open_count++;
    const st = derived(d);
    if (st === 'overdue') {
      out.overdue += home;
      out.overdue_count++;
    } else if (d.getString('due_date') !== '' && d.getString('due_date') <= week) out.due_7 += home;
  }
  const since = dates.addDays(today, -30);
  const allocs = app.findRecordsByFilter('allocations', "kind = 'payment' && date >= {:s}", '', 0, 0, { s: since });
  for (const a of allocs) {
    try {
      const d = app.findRecordById('documents', a.getString('document'));
      if (d.getString('kind') === (side === 'sales' ? 'invoice' : 'bill')) out.paid_30 += a.getInt('home_amount');
    } catch {
      /* gone */
    }
  }
  return out;
}

module.exports = {
  SALES: SALES,
  CREDIT: CREDIT,
  LABEL: LABEL,
  mustGet: mustGet,
  derived: derived,
  serialize: serialize,
  totals: totals,
  save: save,
  postingsFor: postingsFor,
  approve: approve,
  voidDoc: voidDoc,
  recordPayment: recordPayment,
  applyCredit: applyCredit,
  writeOff: writeOff,
  removeAllocations: removeAllocations,
  removeAllocation: removeAllocation,
  list: list,
  summary: summary,
  warnings: warnings,
};
