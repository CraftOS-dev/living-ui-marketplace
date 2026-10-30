/// <reference path="../pb_data/types.d.ts" />
/**
 * The ledger core: the only place transactions and postings are written.
 *
 * A transaction holds postings: amount > 0 is a debit, < 0 a credit, in
 * minor units of the posting's currency, with `home_amount` in the home
 * currency. Every transaction balances to zero in the home currency (and in
 * its currency when it has only one). Statuses: proposed (waiting for the
 * person; not in any report), posted, voided (kept, out of every balance).
 *
 * Rules enforced here for every writer (the person, the AI agent, rules,
 * imports): accounts must exist and be open, the date must be after the
 * books lock date (and after the agent lock date for the AI agent), posted
 * reconciled lines cannot change, and a transaction that belongs to an
 * invoice or bill is changed only through that document.
 */

const DEBIT_NORMAL = { asset: true, expense: true };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---------------------------------------------------------------- lookups */

function settings(app) {
  return require(`${__hooks}/lib_setup.js`).row(app);
}

function home(app) {
  return settings(app).getString('home_currency') || 'USD';
}

/** The account with a system role (ar, ap, tax, opening, ...). */
function sys(app, role) {
  const rows = app.findRecordsByFilter('accounts', 'system = {:r}', 'code', 1, 0, { r: role });
  if (rows.length === 0) throw fail(409, 'The books have no ' + role + ' account; run setup.apply first');
  return rows[0];
}

function account(app, ref) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = String(ref || '').trim();
  if (s === '') throw fail(400, 'account is required (an account id, code or exact name; see accounts.list)');
  let rec = u.byId(app, 'accounts', s);
  if (!rec) {
    const rows = app.findRecordsByFilter('accounts', 'code = {:s} || name = {:s}', 'code', 1, 0, { s: s });
    rec = rows.length > 0 ? rows[0] : null;
  }
  if (!rec) throw fail(404, 'No account "' + s + '"; see accounts.list');
  return rec;
}

function contact(app, ref, create) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = String(ref || '').trim();
  if (s === '') return null;
  let rec = u.byId(app, 'contacts', s);
  if (rec) return rec;
  const rows = app.findRecordsByFilter('contacts', 'name = {:s}', '', 1, 0, { s: s });
  if (rows.length > 0) return rows[0];
  if (!create) throw fail(404, 'No contact "' + s + '"; see contacts.list or give a new name with create');
  rec = new Record(app.findCollectionByNameOrId('contacts'));
  rec.set('name', s.slice(0, 160));
  rec.set('kind', create === true ? 'other' : create);
  app.save(rec);
  return rec;
}

function taxCode(app, ref) {
  const u = require(`${__hooks}/lib_util.js`);
  const s = String(ref || '').trim();
  if (s === '') return null;
  let rec = u.byId(app, 'tax_codes', s);
  if (rec) return rec;
  const rows = app.findRecordsByFilter('tax_codes', 'code = {:s} || name = {:s}', '', 1, 0, { s: s });
  if (rows.length > 0) return rows[0];
  throw fail(404, 'No tax code "' + s + '"; see tax.list');
}

/** Latest rate on or before a date: home units per 1 unit of the currency. */
function rateFor(app, currency, date) {
  const rows = app.findRecordsByFilter('fx_rates', 'currency = {:c} && date <= {:d}', '-date', 1, 0, { c: currency, d: date });
  return rows.length > 0 ? rows[0].getString('rate') : '';
}

/* ------------------------------------------------------------------ locks */

/** Throw when a date is inside a locked period for this writer. */
function checkLock(app, date, who) {
  const s = settings(app);
  const lock = s.getString('lock_date');
  if (lock !== '' && date <= lock) throw fail(409, 'The books are locked through ' + lock + '. Move the lock date (Close) to change entries dated ' + date + '.');
  if (who && who.actor === 'agent') {
    const al = s.getString('agent_lock_date');
    if (al !== '' && date <= al) throw fail(409, 'Your AI agent may not change entries dated on or before ' + al + ' (agent lock date). Propose the change to the person instead.');
  }
}

/* -------------------------------------------------------------- serialize */

function serializeAccount(rec, bal) {
  return {
    id: rec.id,
    code: rec.getString('code'),
    name: rec.getString('name'),
    type: rec.getString('type'),
    subtype: rec.getString('subtype'),
    parent: rec.getString('parent'),
    currency: rec.getString('currency'),
    description: rec.getString('description'),
    system: rec.getString('system'),
    cashflow: rec.getString('cashflow'),
    archived: rec.getBool('archived'),
    sort: rec.getInt('sort'),
    bank_name: rec.getString('bank_name'),
    bank_number: rec.getString('bank_number'),
    balance: bal === undefined ? null : bal,
  };
}

function serializePosting(rec) {
  return {
    id: rec.id,
    txn: rec.getString('txn'),
    date: rec.getString('date'),
    status: rec.getString('status'),
    account: rec.getString('account'),
    amount: rec.getInt('amount'),
    currency: rec.getString('currency'),
    home_amount: rec.getInt('home_amount'),
    rate: rec.getString('rate'),
    contact: rec.getString('contact'),
    tax_code: rec.getString('tax_code'),
    tax_role: rec.getString('tax_role'),
    memo: rec.getString('memo'),
    recon_state: rec.getString('recon_state'),
    reconciliation: rec.getString('reconciliation'),
    statement_line: rec.getString('statement_line'),
    line: rec.getInt('line'),
  };
}

function serializeTxn(rec, postings) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = {
    id: rec.id,
    date: rec.getString('date'),
    narration: rec.getString('narration'),
    contact: rec.getString('contact'),
    kind: rec.getString('kind'),
    status: rec.getString('status'),
    reference: rec.getString('reference'),
    tags: u.json(rec, 'tags', []) || [],
    document: rec.getString('document'),
    source_line: rec.getString('source_line'),
    reverses: rec.getString('reverses'),
    recurring: rec.getString('recurring'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    method: rec.getString('method') || 'manual',
    confidence: rec.getString('confidence'),
    reason: rec.getString('reason'),
    evidence: u.json(rec, 'evidence', null),
    void_reason: rec.getString('void_reason'),
    version: rec.getInt('version'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
  if (postings) {
    out.postings = postings.map(serializePosting);
    let total = 0;
    for (const p of out.postings) if (p.home_amount > 0) total += p.home_amount;
    out.total = total;
  }
  return out;
}

function postingsOf(app, txnId) {
  return app.findRecordsByFilter('postings', 'txn = {:t}', 'line', 0, 0, { t: txnId });
}

/** Postings carry their transaction's date and status; keep them in step. */
function syncPostings(app, txn) {
  for (const p of postingsOf(app, txn.id)) {
    if (p.getString('date') === txn.getString('date') && p.getString('status') === txn.getString('status')) continue;
    p.set('date', txn.getString('date'));
    p.set('status', txn.getString('status'));
    app.save(p);
  }
}

function mustTxn(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'transactions', id);
  if (!rec) throw fail(404, 'No transaction ' + id + '; see transactions.list');
  return rec;
}

/* ------------------------------------------------------------- validation */

/**
 * Turn posting specs into checked rows. A spec: { account, amount (minor,
 * signed), currency?, rate?, home_amount?, contact?, tax_code?, tax_role?,
 * memo?, recon_state?, statement_line?, reconciliation? }.
 */
function prepare(app, date, specs) {
  const money = require(`${__hooks}/lib_money.js`);
  const homeCcy = home(app);
  const rows = [];
  for (const s of specs) {
    const acc = typeof s.account === 'object' && s.account !== null && s.account.id ? s.account : account(app, s.account);
    if (acc.getBool('archived')) throw fail(409, 'The account ' + acc.getString('code') + ' ' + acc.getString('name') + ' is archived');
    const amount = money.int(s.amount, 'amount');
    if (amount === 0 && !s.keep_zero) continue;
    const ccy = String(s.currency || acc.getString('currency') || homeCcy).toUpperCase();
    let rate = s.rate ? String(s.rate) : '';
    let homeAmount = s.home_amount;
    if (ccy === homeCcy) {
      rate = '';
      homeAmount = amount;
    } else if (homeAmount === undefined || homeAmount === null) {
      if (rate === '') rate = rateFor(app, ccy, date);
      if (rate === '') throw fail(409, 'No ' + ccy + ' rate on or before ' + date + '; give a rate or add one with fx.set');
      homeAmount = money.toHome(amount, ccy, homeCcy, rate);
    }
    rows.push({
      account: acc,
      amount: amount,
      currency: ccy,
      rate: rate,
      home_amount: money.int(homeAmount, 'home_amount'),
      contact: s.contact || '',
      tax_code: s.tax_code || '',
      tax_role: s.tax_role || '',
      memo: String(s.memo || '').slice(0, 300),
      recon_state: s.recon_state || '',
      statement_line: s.statement_line || '',
      reconciliation: s.reconciliation || '',
    });
  }
  if (rows.length < 2) throw fail(400, 'A transaction needs at least two non-zero postings (debits and credits)');
  let sum = 0;
  for (const r of rows) sum += r.home_amount;
  if (sum !== 0) {
    // Postings in other currencies may leave a cent or two after conversion.
    const foreign = rows.some((r) => r.currency !== homeCcy);
    if (foreign && Math.abs(sum) <= rows.length) {
      rows.push({ account: sys(app, 'rounding'), amount: -sum, currency: homeCcy, rate: '', home_amount: -sum, contact: '', tax_code: '', tax_role: '', memo: 'Currency rounding', recon_state: '', statement_line: '', reconciliation: '' });
    } else {
      throw fail(400, 'The postings do not balance: debits minus credits is ' + money.toDecimal(sum, homeCcy) + ' ' + homeCcy + ' (it must be 0)');
    }
  }
  const ccys = {};
  for (const r of rows) ccys[r.currency] = (ccys[r.currency] || 0) + r.amount;
  const keys = Object.keys(ccys);
  if (keys.length === 1 && ccys[keys[0]] !== 0) throw fail(400, 'The postings do not balance in ' + keys[0]);
  return rows;
}

function writePostings(app, txn, rows) {
  const col = app.findCollectionByNameOrId('postings');
  const out = [];
  rows.forEach((r, i) => {
    const p = new Record(col);
    p.set('txn', txn.id);
    p.set('date', txn.getString('date'));
    p.set('status', txn.getString('status'));
    p.set('account', r.account.id);
    p.set('amount', r.amount);
    p.set('currency', r.currency);
    p.set('home_amount', r.home_amount);
    p.set('rate', r.rate);
    p.set('contact', r.contact);
    p.set('tax_code', r.tax_code);
    p.set('tax_role', r.tax_role);
    p.set('memo', r.memo);
    p.set('recon_state', r.recon_state);
    p.set('statement_line', r.statement_line);
    p.set('reconciliation', r.reconciliation);
    p.set('line', i);
    app.save(p);
    out.push(p);
  });
  return out;
}

/* ------------------------------------------------------------------ write */

/**
 * Create a transaction. spec: { date, narration, contact, kind, status,
 * reference, tags, postings, document, source_line, reverses, recurring,
 * method, confidence, reason, evidence }. `who` = { actor, run }.
 * Call inside a transaction (app may be the tx).
 */
function create(app, spec, who) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const date = dates.parse(spec.date, 'date');
  const status = spec.status || 'posted';
  checkLock(app, date, who);
  const rows = prepare(app, date, spec.postings || []);
  const rec = new Record(app.findCollectionByNameOrId('transactions'));
  rec.set('date', date);
  rec.set('narration', String(spec.narration || '').slice(0, 500));
  rec.set('contact', spec.contact || '');
  rec.set('kind', spec.kind || 'journal');
  rec.set('status', status);
  rec.set('reference', String(spec.reference || '').slice(0, 80));
  rec.set('tags', spec.tags || []);
  rec.set('document', spec.document || '');
  rec.set('source_line', spec.source_line || '');
  rec.set('reverses', spec.reverses || '');
  rec.set('recurring', spec.recurring || '');
  rec.set('added_by', spec.added_by || (who && who.actor === 'agent' ? 'agent' : 'user'));
  rec.set('run', (who && who.run) || '');
  rec.set('method', spec.method || 'manual');
  rec.set('confidence', spec.confidence || '');
  rec.set('reason', String(spec.reason || '').slice(0, 1000));
  rec.set('evidence', spec.evidence || null);
  rec.set('version', 1);
  app.save(rec);
  const posts = writePostings(app, rec, rows);
  return { txn: rec, postings: posts };
}

/** What may not change on a transaction: reconciled or statement-matched postings. */
function guardPostings(app, txn, nextRows, nextDate) {
  const olds = postingsOf(app, txn.id);
  for (const p of olds) {
    const locked = p.getString('recon_state') === 'reconciled';
    const matched = p.getString('statement_line') !== '';
    if (!locked && !matched) continue;
    const same = nextRows ? nextRows.find((r) => r.account.id === p.getString('account') && r.amount === p.getInt('amount') && !r.__used) : null;
    if (locked && ((nextRows !== null && !same) || nextDate !== txn.getString('date'))) throw fail(409, 'This transaction has a reconciled line (account statement ' + p.getString('reconciliation') + '). Undo that reconciliation first.');
    if (matched && nextRows !== null && !same) throw fail(409, 'The line on ' + p.getString('account') + ' is matched to a bank statement line; keep its account and amount, or unmatch it first (inbox.unmatch).');
    if (same) {
      same.__used = true;
      same.recon_state = p.getString('recon_state');
      same.statement_line = p.getString('statement_line');
      same.reconciliation = p.getString('reconciliation');
    }
  }
  return olds;
}

/** Edit a transaction in place (not a document's own transaction). */
function replace(app, txnId, spec, who) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const act = require(`${__hooks}/lib_activity.js`);
  const txn = mustTxn(app, txnId);
  if (txn.getString('status') === 'voided') throw fail(409, 'This transaction is void; it cannot be edited');
  if (txn.getString('document') !== '' && !spec.from_document) throw fail(409, 'This transaction belongs to a document; edit the invoice or bill instead');
  const before = act.snapshot(txn);
  const date = spec.date !== undefined ? dates.parse(spec.date, 'date') : txn.getString('date');
  checkLock(app, txn.getString('date'), who);
  checkLock(app, date, who);
  let rows = null;
  if (spec.postings) rows = prepare(app, date, spec.postings);
  // When only the date moves, the postings follow (syncPostings).
  const olds = guardPostings(app, txn, rows, date);
  for (const k of ['narration', 'contact', 'reference', 'tags', 'kind']) if (spec[k] !== undefined) txn.set(k, spec[k]);
  txn.set('date', date);
  txn.set('version', txn.getInt('version') + 1);
  if (spec.method !== undefined) txn.set('method', spec.method);
  app.save(txn);
  if (rows !== null) {
    for (const p of olds) app.delete(p);
    writePostings(app, txn, rows);
  } else syncPostings(app, txn);
  return { txn: txn, before: before, before_postings: olds.map((p) => act.snapshot(p)) };
}

/** Void: kept for the record, removed from every balance. */
function voidTxn(app, txnId, reason, who, fromDocument) {
  const txn = mustTxn(app, txnId);
  if (txn.getString('status') === 'voided') return txn;
  if (txn.getString('document') !== '' && !fromDocument) throw fail(409, 'This transaction belongs to a document; void the invoice or bill instead');
  checkLock(app, txn.getString('date'), who);
  const posts = postingsOf(app, txn.id);
  for (const p of posts) if (p.getString('recon_state') === 'reconciled') throw fail(409, 'This transaction has a reconciled line; undo that reconciliation first');
  if ((txn.getString('kind') === 'payment' || txn.getString('kind') === 'writeoff') && !fromDocument) {
    const allocs = app.findRecordsByFilter('allocations', 'payment = {:p}', '', 0, 0, { p: txn.id });
    if (allocs.length > 0) {
      require(`${__hooks}/lib_docs.js`).removeAllocations(app, allocs);
    }
  }
  // Release statement lines matched to it so they return to the inbox.
  for (const p of posts) {
    const lineId = p.getString('statement_line');
    if (lineId === '') continue;
    try {
      const line = app.findRecordById('statement_lines', lineId);
      line.set('status', 'new');
      line.set('txn', '');
      app.save(line);
    } catch {
      /* line removed with its import */
    }
    p.set('statement_line', '');
    p.set('recon_state', '');
    app.save(p);
  }
  txn.set('status', 'voided');
  txn.set('void_reason', String(reason || '').slice(0, 500));
  txn.set('version', txn.getInt('version') + 1);
  app.save(txn);
  syncPostings(app, txn);
  return txn;
}

/** Approve a proposed transaction. */
function post(app, txnId, who) {
  const txn = mustTxn(app, txnId);
  if (txn.getString('status') !== 'proposed') throw fail(409, 'Only a proposed transaction can be posted (this one is ' + txn.getString('status') + ')');
  checkLock(app, txn.getString('date'), who);
  txn.set('status', 'posted');
  txn.set('version', txn.getInt('version') + 1);
  app.save(txn);
  syncPostings(app, txn);
  return txn;
}

/** A new transaction with every posting negated, dated `date`. */
function reverse(app, txnId, date, who) {
  const txn = mustTxn(app, txnId);
  if (txn.getString('status') !== 'posted') throw fail(409, 'Only a posted transaction can be reversed');
  const posts = postingsOf(app, txn.id);
  return create(
    app,
    {
      date: date,
      narration: 'Reversal of ' + (txn.getString('narration') || txn.getString('kind')),
      contact: txn.getString('contact'),
      kind: 'reversal',
      reverses: txn.id,
      postings: posts.map((p) => ({
        account: p.getString('account'),
        amount: -p.getInt('amount'),
        currency: p.getString('currency'),
        rate: p.getString('rate'),
        home_amount: -p.getInt('home_amount'),
        contact: p.getString('contact'),
        tax_code: p.getString('tax_code'),
        tax_role: p.getString('tax_role'),
        memo: p.getString('memo'),
      })),
    },
    who,
  );
}

/* ------------------------------------------------------------ quick forms */

/**
 * Expand a simple form into postings.
 *   expense:  { from (bank/card/cash), category, amount, tax_code?, inclusive? }
 *   income:   { to, category, amount, tax_code?, inclusive? }
 *   transfer: { from, to, amount, amount_to? (other currency) }
 * Amounts are minor units in the paying account's currency.
 */
function expand(app, kind, f) {
  const money = require(`${__hooks}/lib_money.js`);
  if (kind === 'transfer') {
    const from = account(app, f.from);
    const to = account(app, f.to);
    if (from.id === to.id) throw fail(400, 'Transfer needs two different accounts');
    const amount = money.int(f.amount);
    const fromCcy = from.getString('currency') || home(app);
    const toCcy = to.getString('currency') || home(app);
    const amountTo = fromCcy === toCcy ? amount : f.amount_to !== undefined && f.amount_to !== null ? money.int(f.amount_to) : null;
    if (amountTo === null) throw fail(400, 'The accounts use different currencies (' + fromCcy + ' to ' + toCcy + '); give amount_to as received');
    const rows = [
      { account: from, amount: -Math.abs(amount), currency: fromCcy, memo: f.memo, contact: f.contact },
      { account: to, amount: Math.abs(amountTo), currency: toCcy, memo: f.memo, contact: f.contact },
    ];
    // Between currencies the money paid sets the home value of the money
    // received (the implied rate); no exchange gain arises on the transfer.
    if (fromCcy !== toCcy) {
      const homeCcy = home(app);
      if (fromCcy === homeCcy) rows[1].home_amount = Math.abs(amount);
      else if (toCcy === homeCcy) rows[0].home_amount = -Math.abs(amountTo);
      else {
        const rate = f.rate || rateFor(app, fromCcy, f.date || require(`${__hooks}/lib_dates.js`).today());
        if (!rate) throw fail(409, 'No ' + fromCcy + ' rate; add one or give rate');
        const h = money.toHome(Math.abs(amount), fromCcy, homeCcy, rate);
        rows[0].home_amount = -h;
        rows[1].home_amount = h;
      }
    }
    return rows;
  }
  const cash = account(app, kind === 'expense' ? f.from : f.to);
  const cat = account(app, f.category);
  const ccy = cash.getString('currency') || home(app);
  const gross = Math.abs(money.int(f.amount));
  const sign = kind === 'expense' ? 1 : -1;
  const tc = f.tax_code ? taxCode(app, f.tax_code) : null;
  const rows = [];
  if (tc) {
    const rate = tc.getString('rate') || '0';
    const group = tc.getString('group');
    const taxAcc = tc.getString('account') || sys(app, 'tax').id;
    if (group === 'reverse') {
      const t = money.tax(gross, rate, false);
      rows.push({ account: cat, amount: sign * gross, currency: ccy, tax_code: tc.id, tax_role: 'base', memo: f.memo, contact: f.contact });
      rows.push({ account: taxAcc, amount: sign * t, currency: ccy, tax_code: tc.id, tax_role: 'tax', memo: 'Reverse charge input', contact: f.contact });
      rows.push({ account: taxAcc, amount: -sign * t, currency: ccy, tax_code: tc.id, tax_role: 'tax', memo: 'Reverse charge output', contact: f.contact, keep_zero: true });
    } else {
      const inclusive = f.inclusive !== false;
      const t = money.tax(gross, rate, inclusive);
      const net = inclusive ? gross - t : gross;
      const total = inclusive ? gross : gross + t;
      rows.push({ account: cat, amount: sign * net, currency: ccy, tax_code: tc.id, tax_role: 'base', memo: f.memo, contact: f.contact });
      if (t !== 0) rows.push({ account: taxAcc, amount: sign * t, currency: ccy, tax_code: tc.id, tax_role: 'tax', memo: f.memo, contact: f.contact });
      rows.push({ account: cash, amount: -sign * total, currency: ccy, memo: f.memo, contact: f.contact });
      return rows;
    }
  } else {
    rows.push({ account: cat, amount: sign * gross, currency: ccy, memo: f.memo, contact: f.contact });
  }
  rows.push({ account: cash, amount: -sign * gross, currency: ccy, memo: f.memo, contact: f.contact });
  return rows;
}

/* ---------------------------------------------------------------- queries */

/**
 * Home-currency balances per account from posted postings.
 * opts: { from?, to?, status? } -> { accountId: { home, amount } }
 */
function balances(app, opts) {
  const o = opts || {};
  const parts = ["status = 'posted'"];
  const prm = {};
  if (o.from) {
    parts.push('date >= {:from}');
    prm.from = o.from;
  }
  if (o.to) {
    parts.push('date <= {:to}');
    prm.to = o.to;
  }
  const rows = arrayOf(new DynamicModel({ account: '', home: 0, amount: 0, n: 0 }));
  app
    .db()
    .newQuery('SELECT account, COALESCE(SUM(home_amount), 0) AS home, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n FROM postings WHERE ' + parts.join(' AND ') + ' GROUP BY account')
    .bind(prm)
    .all(rows);
  const out = {};
  for (const r of rows) out[r.account] = { home: r.home, amount: r.amount, n: r.n };
  return out;
}

/** Balance of one account (home and account currency) up to a date. */
function balanceOf(app, accountId, to) {
  const b = balances(app, { to: to });
  return b[accountId] || { home: 0, amount: 0, n: 0 };
}

/** Accounts with balances, sorted by code; `archived` included on request. */
function accounts(app, opts) {
  const o = opts || {};
  const bal = balances(app, { to: o.to });
  const rows = app.findRecordsByFilter('accounts', o.archived ? 'id != ""' : 'archived = false', 'code', 0, 0);
  return rows.map((a) => {
    const b = bal[a.id] || { home: 0, amount: 0 };
    const out = serializeAccount(a, b.home);
    out.balance_ccy = b.amount;
    out.debit_normal = DEBIT_NORMAL[a.getString('type')] === true;
    return out;
  });
}

/**
 * An account register: postings with running balance (account currency),
 * newest first by default. opts: { from, to, q, status, limit, offset }.
 */
function register(app, accountId, opts) {
  const o = opts || {};
  const parts = ['account = {:a}'];
  const prm = { a: accountId };
  parts.push(o.include_proposed ? "status != 'voided'" : "status = 'posted'");
  if (o.from) {
    parts.push('date >= {:from}');
    prm.from = o.from;
  }
  if (o.to) {
    parts.push('date <= {:to}');
    prm.to = o.to;
  }
  if (o.recon === 'uncleared') parts.push("recon_state = ''");
  if (o.recon === 'cleared') parts.push("recon_state = 'cleared'");
  if (o.recon === 'reconciled') parts.push("recon_state = 'reconciled'");
  const posts = app.findRecordsByFilter('postings', parts.join(' && '), 'date,created,line', 0, 0, prm);
  // Opening balance before the window.
  let run = 0;
  if (o.from) {
    const row = new DynamicModel({ s: 0 });
    app.db().newQuery("SELECT COALESCE(SUM(amount),0) AS s FROM postings WHERE account = {:a} AND status = 'posted' AND date < {:f}").bind({ a: accountId, f: o.from }).one(row);
    run = row.s;
  }
  const opening = run;
  const txnIds = {};
  for (const p of posts) txnIds[p.getString('txn')] = true;
  const txns = {};
  const ids = Object.keys(txnIds);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const f = chunk.map((_, k) => 'id = {:i' + k + '}').join(' || ');
    const prm2 = {};
    chunk.forEach((id, k) => (prm2['i' + k] = id));
    for (const t of app.findRecordsByFilter('transactions', f, '', 0, 0, prm2)) txns[t.id] = t;
  }
  const rows = [];
  for (const p of posts) {
    if (p.getString('status') === 'posted') run += p.getInt('amount');
    const t = txns[p.getString('txn')];
    rows.push({
      posting: p.id,
      txn: p.getString('txn'),
      date: p.getString('date'),
      status: p.getString('status'),
      narration: t ? t.getString('narration') : '',
      kind: t ? t.getString('kind') : '',
      contact: (t && t.getString('contact')) || p.getString('contact'),
      reference: t ? t.getString('reference') : '',
      amount: p.getInt('amount'),
      home_amount: p.getInt('home_amount'),
      currency: p.getString('currency'),
      memo: p.getString('memo'),
      recon_state: p.getString('recon_state'),
      added_by: t ? t.getString('added_by') : '',
      method: t ? t.getString('method') : '',
      document: t ? t.getString('document') : '',
      balance: run,
    });
  }
  let list = rows;
  if (o.q) {
    const q = String(o.q).toLowerCase();
    list = list.filter((r) => (r.narration + ' ' + r.memo + ' ' + r.reference).toLowerCase().indexOf(q) >= 0);
  }
  list.reverse();
  const total = list.length;
  const off = o.offset || 0;
  const lim = o.limit || 500;
  return { opening: opening, closing: run, total: total, rows: list.slice(off, off + lim) };
}

module.exports = {
  DEBIT_NORMAL: DEBIT_NORMAL,
  fail: fail,
  settings: settings,
  home: home,
  sys: sys,
  account: account,
  contact: contact,
  taxCode: taxCode,
  rateFor: rateFor,
  checkLock: checkLock,
  serializeAccount: serializeAccount,
  serializePosting: serializePosting,
  serializeTxn: serializeTxn,
  postingsOf: postingsOf,
  syncPostings: syncPostings,
  mustTxn: mustTxn,
  prepare: prepare,
  create: create,
  replace: replace,
  voidTxn: voidTxn,
  post: post,
  reverse: reverse,
  expand: expand,
  balances: balances,
  balanceOf: balanceOf,
  accounts: accounts,
  register: register,
};
