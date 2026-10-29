/// <reference path="../pb_data/types.d.ts" />
/**
 * The chart of accounts, contacts and tax codes: creating, editing,
 * opening balances and merging duplicate contacts.
 */

const SUBTYPES = {
  asset: ['bank', 'cash', 'receivable', 'current_asset', 'fixed_asset', 'contra_asset', 'investment', 'clearing'],
  liability: ['card', 'payable', 'tax', 'loan', 'current_liability', 'clearing'],
  equity: ['equity', 'retained', 'opening'],
  income: ['income', 'other_income'],
  expense: ['expense', 'cogs', 'other_expense'],
};
const BASE = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 6000, cogs: 5000 };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function defaultCashflow(type, subtype) {
  if (subtype === 'bank' || subtype === 'cash') return 'cash';
  if (subtype === 'fixed_asset' || subtype === 'contra_asset' || subtype === 'investment') return 'investing';
  if (subtype === 'loan' || type === 'equity') return 'financing';
  return 'operating';
}

function nextCode(app, type, subtype) {
  const base = subtype === 'cogs' ? BASE.cogs : BASE[type];
  let max = base - 10;
  for (const a of app.findRecordsByFilter('accounts', 'id != ""', '', 0, 0)) {
    const n = parseInt(a.getString('code'), 10);
    if (isFinite(n) && n >= base && n < base + 1000 && n > max) max = n;
  }
  return String(max + 10);
}

function create(app, p, who) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const type = u.oneOf(p, 'type', Object.keys(SUBTYPES), '');
  if (!type) throw fail(400, 'type is required: asset, liability, equity, income or expense');
  const subtype = u.oneOf(p, 'subtype', SUBTYPES[type], SUBTYPES[type][type === 'asset' ? 3 : 0]);
  if (['receivable', 'payable', 'tax', 'retained', 'opening'].indexOf(subtype) >= 0 && subtype !== 'tax') {
    if (app.findRecordsByFilter('accounts', 'subtype = {:s}', '', 1, 0, { s: subtype }).length > 0) throw fail(409, 'The books already have a ' + subtype + ' account');
  }
  const name = u.squash(u.req(p, 'name')).slice(0, 120);
  let code = u.str(p, 'code', '');
  if (code === '') code = nextCode(app, type, subtype);
  if (!/^[A-Za-z0-9.\-]{1,12}$/.test(code)) throw fail(400, 'code must be 1 to 12 letters, digits, dots or dashes');
  if (app.findRecordsByFilter('accounts', 'code = {:c}', '', 1, 0, { c: code }).length > 0) throw fail(409, 'The code ' + code + ' is already used');
  if (app.findRecordsByFilter('accounts', 'name = {:n} && archived = false', '', 1, 0, { n: name }).length > 0) throw fail(409, 'An account named "' + name + '" already exists');
  const ccy = (u.str(p, 'currency', '') || ledger.home(app)).toUpperCase();
  if (!money.known(ccy)) throw fail(400, 'Unknown currency ' + ccy);
  const a = new Record(app.findCollectionByNameOrId('accounts'));
  a.set('code', code);
  a.set('name', name);
  a.set('type', type);
  a.set('subtype', subtype);
  a.set('currency', ccy);
  a.set('description', u.text(p, 'description', '').slice(0, 500));
  a.set('cashflow', u.oneOf(p, 'cashflow', ['cash', 'operating', 'investing', 'financing'], defaultCashflow(type, subtype)));
  a.set('bank_name', u.str(p, 'bank_name', '').slice(0, 80));
  a.set('bank_number', u.str(p, 'bank_number', '').slice(0, 4));
  a.set('sort', parseInt(code, 10) || 0);
  if (u.has(p, 'parent') && u.str(p, 'parent', '') !== '') {
    const parent = ledger.account(app, u.str(p, 'parent', ''));
    if (parent.getString('type') !== type) throw fail(400, 'A sub-account has the same type as its parent');
    a.set('parent', parent.id);
  }
  app.save(a);
  if (u.has(p, 'opening_balance') && u.str(p, 'opening_balance', '') !== '') {
    opening(app, u.str(p, 'opening_date', '') || require(`${__hooks}/lib_dates.js`).today(), [{ account: a.id, amount: u.str(p, 'opening_balance', '0') }], who);
  }
  return a;
}

function update(app, a, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const used = app.findRecordsByFilter('postings', 'account = {:a}', '', 1, 0, { a: a.id }).length > 0;
  if (u.has(p, 'name')) {
    const name = u.squash(u.str(p, 'name', '')).slice(0, 120);
    if (name === '') throw fail(400, 'name cannot be empty');
    if (app.findRecordsByFilter('accounts', 'name = {:n} && id != {:id} && archived = false', '', 1, 0, { n: name, id: a.id }).length > 0) throw fail(409, 'An account named "' + name + '" already exists');
    a.set('name', name);
  }
  if (u.has(p, 'code')) {
    const code = u.str(p, 'code', '');
    if (!/^[A-Za-z0-9.\-]{1,12}$/.test(code)) throw fail(400, 'code must be 1 to 12 letters, digits, dots or dashes');
    if (app.findRecordsByFilter('accounts', 'code = {:c} && id != {:id}', '', 1, 0, { c: code, id: a.id }).length > 0) throw fail(409, 'The code ' + code + ' is already used');
    a.set('code', code);
  }
  if (u.has(p, 'type') || u.has(p, 'subtype')) {
    const type = u.oneOf(p, 'type', Object.keys(SUBTYPES), a.getString('type'));
    if (type !== a.getString('type') && (used || a.getString('system') !== '')) throw fail(409, 'The type of an account in use cannot change; create a new account and move the entries');
    const subtype = u.oneOf(p, 'subtype', SUBTYPES[type], SUBTYPES[type].indexOf(a.getString('subtype')) >= 0 ? a.getString('subtype') : SUBTYPES[type][0]);
    if (a.getString('system') !== '' && subtype !== a.getString('subtype')) throw fail(409, 'A system account keeps its kind');
    a.set('type', type);
    a.set('subtype', subtype);
  }
  if (u.has(p, 'currency')) {
    const c = u.str(p, 'currency', '').toUpperCase() || ledger.home(app);
    if (c !== (a.getString('currency') || ledger.home(app)) && used) throw fail(409, 'The currency of an account with entries cannot change');
    if (!require(`${__hooks}/lib_money.js`).known(c)) throw fail(400, 'Unknown currency ' + c);
    a.set('currency', c);
  }
  if (u.has(p, 'description')) a.set('description', u.text(p, 'description', '').slice(0, 500));
  if (u.has(p, 'cashflow')) a.set('cashflow', u.oneOf(p, 'cashflow', ['cash', 'operating', 'investing', 'financing'], 'operating'));
  if (u.has(p, 'bank_name')) a.set('bank_name', u.str(p, 'bank_name', '').slice(0, 80));
  if (u.has(p, 'bank_number')) a.set('bank_number', u.str(p, 'bank_number', '').slice(0, 4));
  if (u.has(p, 'parent')) {
    const ref = u.str(p, 'parent', '');
    if (ref === '') a.set('parent', '');
    else {
      const parent = ledger.account(app, ref);
      if (parent.id === a.id) throw fail(400, 'An account cannot be its own parent');
      if (parent.getString('type') !== a.getString('type')) throw fail(400, 'A sub-account has the same type as its parent');
      a.set('parent', parent.id);
    }
  }
  app.save(a);
  return a;
}

/**
 * Opening balances on a date against Opening balance equity. Amounts are as
 * a statement shows them: assets positive, cards and loans what is owed.
 */
function opening(app, date, items, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const eq = ledger.sys(app, 'opening');
  const rows = [];
  let homeSum = 0;
  const homeCcy = ledger.home(app);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const a = ledger.account(app, it.account);
    const t = a.getString('type');
    if (t === 'income' || t === 'expense') throw fail(400, a.getString('name') + ' is an income or expense account; opening balances are for balance sheet accounts');
    if (a.getString('system') === 'ar' || a.getString('system') === 'ap') throw fail(400, 'Enter what customers owe and what you owe suppliers as invoices and bills, not opening balances');
    const ccy = a.getString('currency') || homeCcy;
    const v = money.amount(it.amount, ccy, 'balances[' + i + '].amount');
    const signed = t === 'asset' ? v : -v;
    if (signed === 0) continue;
    let home = signed;
    if (ccy !== homeCcy) {
      const rate = it.rate ? String(it.rate) : ledger.rateFor(app, ccy, date);
      if (!rate) throw fail(409, 'No ' + ccy + ' rate on ' + date + ' for ' + a.getString('name') + '; give rate');
      home = money.toHome(signed, ccy, homeCcy, rate);
    }
    rows.push({ account: a, amount: signed, currency: ccy, home_amount: home, memo: 'Opening balance' });
    homeSum += home;
  }
  if (rows.length === 0) throw fail(400, 'Every balance is zero');
  rows.push({ account: eq, amount: -homeSum, currency: homeCcy, home_amount: -homeSum, memo: 'Opening balances' });
  return ledger.create(app, { date: date, narration: 'Opening balances', kind: 'opening', postings: rows }, who);
}

/* ---------------------------------------------------------------- contacts */

function serializeContact(c) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: c.id,
    name: c.getString('name'),
    kind: c.getString('kind') || 'other',
    email: c.getString('email'),
    phone: c.getString('phone'),
    address: c.getString('address'),
    tax_id: c.getString('tax_id'),
    currency: c.getString('currency'),
    terms: c.getInt('terms'),
    default_account: c.getString('default_account'),
    default_tax: c.getString('default_tax'),
    aliases: u.json(c, 'aliases', []) || [],
    notes: c.getString('notes'),
    archived: c.getBool('archived'),
    created: c.getString('created'),
  };
}

function saveContact(app, c, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const rec = c || new Record(app.findCollectionByNameOrId('contacts'));
  if (!c || u.has(p, 'name')) {
    const name = u.squash(u.req(p, 'name')).slice(0, 160);
    if (app.findRecordsByFilter('contacts', 'name = {:n} && id != {:id}', '', 1, 0, { n: name, id: rec.id || '' }).length > 0) throw fail(409, 'A contact named "' + name + '" already exists; use it or merge them');
    rec.set('name', name);
  }
  if (!c || u.has(p, 'kind')) rec.set('kind', u.oneOf(p, 'kind', ['customer', 'vendor', 'both', 'other'], c ? c.getString('kind') : 'other'));
  const texts = { email: 200, phone: 60, address: 500, tax_id: 60, notes: 2000 };
  for (const k of Object.keys(texts)) if (u.has(p, k)) rec.set(k, u.text(p, k, '').slice(0, texts[k]));
  if (u.has(p, 'currency')) {
    const ccy = u.str(p, 'currency', '').toUpperCase();
    if (ccy !== '' && !require(`${__hooks}/lib_money.js`).known(ccy)) throw fail(400, 'Unknown currency ' + ccy);
    rec.set('currency', ccy);
  }
  if (u.has(p, 'terms')) rec.set('terms', u.int(p, 'terms', 0, 0, 365));
  if (u.has(p, 'default_account')) rec.set('default_account', u.str(p, 'default_account', '') ? ledger.account(app, u.str(p, 'default_account', '')).id : '');
  if (u.has(p, 'default_tax')) rec.set('default_tax', u.str(p, 'default_tax', '') ? ledger.taxCode(app, u.str(p, 'default_tax', '')).id : '');
  if (u.has(p, 'aliases')) rec.set('aliases', (u.list(p, 'aliases', true) || []).map((x) => String(x).trim().slice(0, 120)).filter((x) => x !== '').slice(0, 30));
  app.save(rec);
  return rec;
}

/** Contacts with what they owe or are owed (home currency). */
function contacts(app, o) {
  const parts = [o.archived ? 'id != ""' : 'archived = false'];
  const prm = {};
  if (o.kind) {
    parts.push(o.kind === 'customer' ? "(kind = 'customer' || kind = 'both')" : o.kind === 'vendor' ? "(kind = 'vendor' || kind = 'both')" : 'kind = {:k}');
    prm.k = o.kind;
  }
  if (o.q) {
    parts.push('(name ~ {:q} || email ~ {:q} || aliases ~ {:q})');
    prm.q = o.q;
  }
  const rows = app.findRecordsByFilter('contacts', parts.join(' && '), 'name', o.limit || 500, 0, prm);
  const owed = {};
  for (const d of app.findRecordsByFilter('documents', "status = 'approved'", '', 0, 0)) {
    const open = d.getInt('total') - d.getInt('allocated');
    if (open <= 0) continue;
    const home = Math.round((d.getInt('home_total') * open) / (d.getInt('total') || 1));
    const k = d.getString('contact');
    const x = (owed[k] = owed[k] || { receivable: 0, payable: 0, overdue: 0 });
    const kind = d.getString('kind');
    if (kind === 'invoice') x.receivable += home;
    if (kind === 'credit_note') x.receivable -= home;
    if (kind === 'bill') x.payable += home;
    if (kind === 'vendor_credit') x.payable -= home;
    if (require(`${__hooks}/lib_docs.js`).derived(d) === 'overdue') x.overdue += home;
  }
  return { contacts: rows.map((c) => Object.assign(serializeContact(c), owed[c.id] || { receivable: 0, payable: 0, overdue: 0 })) };
}

function contactDetail(app, ref) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const docs = require(`${__hooks}/lib_docs.js`);
  const c = ledger.contact(app, ref);
  const out = serializeContact(c);
  out.documents = docs.list(app, { contact: c.id, state: 'all', limit: 100 }).docs;
  const txns = app.findRecordsByFilter('transactions', "contact = {:c} && status != 'voided'", '-date,-created', 50, 0, { c: c.id });
  out.transactions = txns.map((t) => {
    const s = ledger.serializeTxn(t, ledger.postingsOf(app, t.id));
    delete s.postings;
    return s;
  });
  const sp = new DynamicModel({ s: 0, n: 0 });
  app
    .db()
    .newQuery("SELECT COALESCE(SUM(p.home_amount),0) AS s, COUNT(DISTINCT p.txn) AS n FROM postings p JOIN accounts a ON a.id = p.account JOIN transactions t ON t.id = p.txn WHERE p.status = 'posted' AND a.type = 'expense' AND t.contact = {:c} AND p.date >= {:f}")
    .bind({ c: c.id, f: require(`${__hooks}/lib_dates.js`).addMonths(require(`${__hooks}/lib_dates.js`).today(), -12) })
    .one(sp);
  out.spent_12m = sp.s;
  const rv = new DynamicModel({ s: 0 });
  app
    .db()
    .newQuery("SELECT COALESCE(SUM(p.home_amount),0) AS s FROM postings p JOIN accounts a ON a.id = p.account JOIN transactions t ON t.id = p.txn WHERE p.status = 'posted' AND a.type = 'income' AND t.contact = {:c} AND p.date >= {:f}")
    .bind({ c: c.id, f: require(`${__hooks}/lib_dates.js`).addMonths(require(`${__hooks}/lib_dates.js`).today(), -12) })
    .one(rv);
  out.earned_12m = -rv.s;
  return { contact: out };
}

/** Merge one contact into another: entries, documents and aliases move over. */
function merge(app, fromRef, intoRef) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const from = ledger.contact(app, fromRef);
  const into = ledger.contact(app, intoRef);
  if (from.id === into.id) throw fail(400, 'Pick two different contacts');
  let moved = 0;
  for (const col of ['transactions', 'postings', 'documents']) {
    for (const r of app.findRecordsByFilter(col, 'contact = {:c}', '', 0, 0, { c: from.id })) {
      r.set('contact', into.id);
      app.save(r);
      moved++;
    }
  }
  const aliases = u.json(into, 'aliases', []) || [];
  for (const a of [from.getString('name')].concat(u.json(from, 'aliases', []) || [])) if (aliases.indexOf(a) < 0) aliases.push(a);
  into.set('aliases', aliases.slice(0, 30));
  if (into.getString('kind') !== from.getString('kind') && from.getString('kind') !== 'other') into.set('kind', into.getString('kind') === 'other' ? from.getString('kind') : 'both');
  for (const k of ['email', 'phone', 'address', 'tax_id', 'default_account', 'default_tax', 'currency']) if (!into.getString(k) && from.getString(k)) into.set(k, from.getString(k));
  app.save(into);
  const name = from.getString('name');
  app.delete(from);
  return { from: name, into: into, moved: moved };
}

/* --------------------------------------------------------------- tax codes */

function serializeTax(t) {
  return {
    id: t.id,
    code: t.getString('code'),
    name: t.getString('name'),
    rate: t.getString('rate'),
    scope: t.getString('scope') || 'both',
    group: t.getString('group') || 'standard',
    account: t.getString('account'),
    description: t.getString('description'),
    archived: t.getBool('archived'),
    sort: t.getInt('sort'),
  };
}

function saveTax(app, rec, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const r = rec || new Record(app.findCollectionByNameOrId('tax_codes'));
  if (!rec || u.has(p, 'code')) {
    const code = u.req(p, 'code').toUpperCase().slice(0, 12);
    if (app.findRecordsByFilter('tax_codes', 'code = {:c} && id != {:id}', '', 1, 0, { c: code, id: r.id || '' }).length > 0) throw fail(409, 'The tax code ' + code + ' already exists');
    r.set('code', code);
  }
  if (!rec || u.has(p, 'name')) r.set('name', u.squash(u.str(p, 'name', '') || u.str(p, 'code', '')).slice(0, 80));
  if (!rec || u.has(p, 'rate')) {
    const rate = money.decimal(u.str(p, 'rate', ''), 'rate');
    if (Number(rate) < 0 || Number(rate) > 100) throw fail(400, 'rate is a percent from 0 to 100');
    r.set('rate', rate);
  }
  if (!rec || u.has(p, 'scope')) r.set('scope', u.oneOf(p, 'scope', ['sales', 'purchases', 'both'], 'both'));
  if (!rec || u.has(p, 'group')) r.set('group', u.oneOf(p, 'group', ['standard', 'reduced', 'zero', 'exempt', 'reverse', 'outside'], 'standard'));
  if (u.has(p, 'description')) r.set('description', u.text(p, 'description', '').slice(0, 300));
  if (u.has(p, 'archived')) r.set('archived', u.bool(p, 'archived', false));
  if (!rec || u.has(p, 'account')) r.set('account', u.str(p, 'account', '') ? ledger.account(app, u.str(p, 'account', '')).id : ledger.sys(app, 'tax').id);
  if (!rec) r.set('sort', app.findRecordsByFilter('tax_codes', 'id != ""', '', 0, 0).length * 10 + 10);
  app.save(r);
  return r;
}

module.exports = { SUBTYPES: SUBTYPES, defaultCashflow: defaultCashflow, nextCode: nextCode, create: create, update: update, opening: opening, serializeContact: serializeContact, saveContact: saveContact, contacts: contacts, contactDetail: contactDetail, merge: merge, serializeTax: serializeTax, saveTax: saveTax };
