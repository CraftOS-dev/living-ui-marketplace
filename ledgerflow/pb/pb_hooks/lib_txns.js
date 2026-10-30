/// <reference path="../pb_data/types.d.ts" />
/**
 * Transactions as the ops see them: reading params into a ledger spec
 * (quick forms or journal lines), listing with filters, and the full detail
 * of one entry with its files, statement line, document and history.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * A ledger spec from op params. Quick forms: kind expense (from, category),
 * income (to, category), transfer (from, to, amount_to) with amount and
 * optional tax_code/inclusive. Journal: postings [{ account, amount | debit
 * | credit, memo, tax_code }]. Amounts are decimals in each account's currency.
 */
function specFrom(app, p, who, existing) {
  const u = require(`${__hooks}/lib_util.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const spec = {};
  if (!existing || u.has(p, 'date')) spec.date = dates.parse(u.str(p, 'date', '') || dates.today(), 'date');
  if (u.has(p, 'narration')) spec.narration = u.text(p, 'narration', '').slice(0, 500);
  if (u.has(p, 'reference')) spec.reference = u.str(p, 'reference', '').slice(0, 80);
  if (u.has(p, 'tags')) spec.tags = (u.list(p, 'tags', true) || []).map((t) => String(t).trim().slice(0, 40)).filter((t) => t !== '').slice(0, 10);
  if (u.has(p, 'contact')) {
    const c = u.str(p, 'contact', '');
    spec.contact = c === '' ? '' : ledger.contact(app, c, 'other').id;
  }
  const kind = u.oneOf(p, 'kind', ['expense', 'income', 'transfer', 'journal'], existing ? '' : 'journal');
  if (!existing) {
    spec.kind = kind;
    spec.status = u.oneOf(p, 'status', ['posted', 'proposed'], who.actor === 'agent' ? 'proposed' : 'posted');
    spec.method = 'manual';
    spec.added_by = who.actor === 'agent' ? 'agent' : 'user';
    if (who.actor === 'agent') {
      spec.reason = u.text(p, 'reason', '').slice(0, 1000);
      spec.confidence = u.oneOf(p, 'confidence', ['high', 'medium', 'low'], '');
    }
  }
  const useKind = kind || (existing ? existing.getString('kind') : 'journal');
  if (u.has(p, 'postings')) {
    const list = u.list(p, 'postings') || [];
    spec.postings = list.map((x, i) => {
      if (!x || typeof x !== 'object') throw fail(400, 'postings[' + i + '] must be { "account": "..", "debit": "12.50" } or { "account": "..", "amount": "-12.50" }');
      const acc = ledger.account(app, x.account);
      const ccy = String(x.currency || acc.getString('currency') || ledger.home(app)).toUpperCase();
      let amt;
      if (x.amount !== undefined && x.amount !== null && x.amount !== '') amt = money.amount(x.amount, ccy, 'postings[' + i + '].amount');
      else {
        const d = x.debit !== undefined && x.debit !== '' && x.debit !== null ? Math.abs(money.amount(x.debit, ccy, 'postings[' + i + '].debit')) : 0;
        const c = x.credit !== undefined && x.credit !== '' && x.credit !== null ? Math.abs(money.amount(x.credit, ccy, 'postings[' + i + '].credit')) : 0;
        amt = d - c;
      }
      const row = { account: acc, amount: amt, currency: ccy, memo: String(x.memo || '').slice(0, 300) };
      if (x.tax_code) {
        row.tax_code = ledger.taxCode(app, x.tax_code).id;
        row.tax_role = x.tax_role === 'tax' ? 'tax' : 'base';
      }
      if (x.rate) row.rate = String(x.rate);
      if (x.home_amount !== undefined && x.home_amount !== '') row.home_amount = money.amount(x.home_amount, ledger.home(app), 'postings[' + i + '].home_amount');
      if (spec.contact) row.contact = spec.contact;
      return row;
    });
  } else if (u.has(p, 'amount')) {
    if (useKind === 'journal') throw fail(400, 'A journal entry takes postings; for a simple entry give kind expense, income or transfer');
    const payRef = useKind === 'income' ? u.req(p, 'to') : u.req(p, 'from');
    const pay = ledger.account(app, payRef);
    const ccy = pay.getString('currency') || ledger.home(app);
    const f = {
      from: u.str(p, 'from', ''),
      to: u.str(p, 'to', ''),
      category: u.str(p, 'category', ''),
      amount: Math.abs(money.amount(u.req(p, 'amount'), ccy, 'amount')),
      tax_code: u.str(p, 'tax_code', ''),
      inclusive: u.bool(p, 'inclusive', true),
      memo: u.text(p, 'memo', ''),
      contact: spec.contact || '',
      date: spec.date || (existing ? existing.getString('date') : ''),
      rate: u.str(p, 'rate', ''),
    };
    if (useKind === 'transfer' && u.has(p, 'amount_to')) {
      const to = ledger.account(app, u.req(p, 'to'));
      f.amount_to = Math.abs(money.amount(u.str(p, 'amount_to', ''), to.getString('currency') || ledger.home(app), 'amount_to'));
    }
    if (useKind !== 'transfer' && f.category === '') throw fail(400, 'category is required: the income or expense account');
    spec.postings = ledger.expand(app, useKind, f);
    if (!spec.narration && !existing) {
      const other = useKind === 'transfer' ? 'Transfer to ' + ledger.account(app, f.to).getString('name') : ledger.account(app, f.category).getString('name');
      spec.narration = other;
    }
  } else if (!existing) throw fail(400, 'Give amount with kind expense|income|transfer (and from/to/category), or postings for a journal entry');
  return spec;
}

function describe(app, txn) {
  const money = require(`${__hooks}/lib_money.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  let total = 0;
  for (const p of ledger.postingsOf(app, txn.id)) if (p.getInt('home_amount') > 0) total += p.getInt('home_amount');
  return '"' + (txn.getString('narration') || txn.getString('kind')) + '" (' + money.format(total, ledger.home(app)) + ', ' + txn.getString('date') + ')';
}

function names(app, col) {
  const out = {};
  for (const r of app.findRecordsByFilter(col, 'id != ""', '', 0, 0)) out[r.id] = col === 'accounts' ? r.getString('code') + ' ' + r.getString('name') : r.getString('name');
  return out;
}

function chunkIds(app, col, field, ids, extra) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const prm = {};
    const f = chunk.map((id, k) => {
      prm['i' + k] = id;
      return field + ' = {:i' + k + '}';
    });
    for (const r of app.findRecordsByFilter(col, '(' + f.join(' || ') + ')' + (extra || ''), '', 0, 0, prm)) out.push(r);
  }
  return out;
}

/** Filtered transactions, newest first, with compact postings. */
function list(app, f) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const parts = [];
  const prm = {};
  if (f.status === 'all') parts.push('id != ""');
  else if (f.status) {
    parts.push('status = {:st}');
    prm.st = f.status;
  } else parts.push("status != 'voided'");
  if (f.from) {
    parts.push('date >= {:f}');
    prm.f = f.from;
  }
  if (f.to) {
    parts.push('date <= {:t}');
    prm.t = f.to;
  }
  if (f.contact) {
    parts.push('contact = {:c}');
    prm.c = ledger.contact(app, f.contact).id;
  }
  if (f.kind) {
    parts.push('kind = {:k}');
    prm.k = f.kind;
  }
  if (f.added_by) {
    parts.push('added_by = {:ab}');
    prm.ab = f.added_by;
  }
  if (f.run) {
    parts.push('run = {:run}');
    prm.run = f.run;
  }
  if (f.method) {
    parts.push('method = {:m}');
    prm.m = f.method;
  }
  let rows = app.findRecordsByFilter('transactions', parts.join(' && '), '-date,-created', 20000, 0, prm);
  if (f.account) {
    const acc = ledger.account(app, f.account);
    const pf = ['account = {:a}'];
    const pp = { a: acc.id };
    if (f.from) {
      pf.push('date >= {:f}');
      pp.f = f.from;
    }
    if (f.to) {
      pf.push('date <= {:t}');
      pp.t = f.to;
    }
    const keep = {};
    for (const p of app.findRecordsByFilter('postings', pf.join(' && '), '', 0, 0, pp)) keep[p.getString('txn')] = true;
    rows = rows.filter((t) => keep[t.id]);
  }
  const contactNames = names(app, 'contacts');
  if (f.q) {
    const q = String(f.q).toLowerCase();
    let amt = null;
    try {
      amt = /^-?[\d,]*\.?\d+$/.test(q.trim()) ? Math.abs(money.amount(q.trim(), ledger.home(app), 'q')) : null;
    } catch {
      amt = null;
    }
    const amtHit = {};
    if (amt !== null) for (const p of app.findRecordsByFilter('postings', 'amount = {:a} || amount = {:b}', '', 2000, 0, { a: amt, b: -amt })) amtHit[p.getString('txn')] = true;
    rows = rows.filter((t) => amtHit[t.id] || (t.getString('narration') + ' ' + t.getString('reference') + ' ' + (contactNames[t.getString('contact')] || '')).toLowerCase().indexOf(q) >= 0);
  }
  const total = rows.length;
  let page = rows.slice(f.offset || 0, (f.offset || 0) + (f.limit || 200));
  const posts = chunkIds(
    app,
    'postings',
    'txn',
    page.map((t) => t.id),
  );
  const byTxn = {};
  for (const p of posts) (byTxn[p.getString('txn')] = byTxn[p.getString('txn')] || []).push(p);
  const fileRows = chunkIds(
    app,
    'files',
    'linked_id',
    page.map((t) => t.id),
    " && linked_type = 'transaction'",
  );
  const files = {};
  for (const r of fileRows) files[r.getString('linked_id')] = (files[r.getString('linked_id')] || 0) + 1;
  let out = page.map((t) => {
    const ps = (byTxn[t.id] || []).sort((a, b) => a.getInt('line') - b.getInt('line'));
    let sum = 0;
    for (const p of ps) if (p.getInt('home_amount') > 0) sum += p.getInt('home_amount');
    return {
      id: t.id,
      date: t.getString('date'),
      narration: t.getString('narration'),
      contact: t.getString('contact'),
      contact_name: contactNames[t.getString('contact')] || '',
      kind: t.getString('kind'),
      status: t.getString('status'),
      reference: t.getString('reference'),
      document: t.getString('document'),
      source_line: t.getString('source_line'),
      added_by: t.getString('added_by') || 'user',
      run: t.getString('run'),
      method: t.getString('method') || 'manual',
      confidence: t.getString('confidence'),
      reason: t.getString('reason'),
      total: sum,
      files: files[t.id] || 0,
      postings: ps.map((p) => ({ account: p.getString('account'), amount: p.getInt('amount'), currency: p.getString('currency'), home_amount: p.getInt('home_amount'), recon_state: p.getString('recon_state'), memo: p.getString('memo') })),
    };
  });
  if (f.dupes) {
    const seen = {};
    for (const t of out) {
      const k = t.date + '|' + t.total + '|' + t.narration.toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
    }
    out = out.filter((t) => seen[t.date + '|' + t.total + '|' + t.narration.toLowerCase()] > 1);
  }
  return { total: total, transactions: out };
}

/** One entry with everything around it. */
function detail(app, id) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const act = require(`${__hooks}/lib_activity.js`);
  const t = ledger.mustTxn(app, id);
  const out = ledger.serializeTxn(t, ledger.postingsOf(app, t.id));
  const accs = {};
  for (const a of app.findRecordsByFilter('accounts', 'id != ""', '', 0, 0)) accs[a.id] = a;
  for (const p of out.postings) {
    const a = accs[p.account];
    p.account_code = a ? a.getString('code') : '';
    p.account_name = a ? a.getString('name') : '';
    p.account_type = a ? a.getString('type') : '';
    if (p.tax_code) {
      try {
        p.tax_code_label = app.findRecordById('tax_codes', p.tax_code).getString('code');
      } catch {
        p.tax_code_label = '';
      }
    }
  }
  try {
    out.contact_name = t.getString('contact') ? app.findRecordById('contacts', t.getString('contact')).getString('name') : '';
  } catch {
    out.contact_name = '';
  }
  out.files = require(`${__hooks}/lib_files.js`).linkedTo(app, 'transaction', t.id);
  out.lines = app.findRecordsByFilter('statement_lines', 'txn = {:t}', 'date', 10, 0, { t: t.id }).map((l) => require(`${__hooks}/lib_inbox.js`).serializeLine(l));
  if (t.getString('document')) {
    try {
      const d = app.findRecordById('documents', t.getString('document'));
      out.document_info = { id: d.id, kind: d.getString('kind'), number: d.getString('number') };
    } catch {
      out.document_info = null;
    }
  }
  const allocs = app.findRecordsByFilter('allocations', 'payment = {:p}', '', 0, 0, { p: t.id });
  out.allocations = allocs.map((a) => {
    let num = '';
    try {
      num = app.findRecordById('documents', a.getString('document')).getString('number');
    } catch {
      num = '';
    }
    return { id: a.id, document: a.getString('document'), number: num, amount: a.getInt('amount'), kind: a.getString('kind') };
  });
  const rev = app.findRecordsByFilter('transactions', 'reverses = {:t}', '', 1, 0, { t: t.id });
  out.reversed_by = rev.length > 0 ? rev[0].id : '';
  out.history = act.list(app, { target: t.id, limit: 20 });
  out.locked = (function () {
    try {
      ledger.checkLock(app, t.getString('date'), { actor: 'user' });
      return false;
    } catch {
      return true;
    }
  })();
  return out;
}

module.exports = { specFrom: specFrom, describe: describe, list: list, detail: detail };
