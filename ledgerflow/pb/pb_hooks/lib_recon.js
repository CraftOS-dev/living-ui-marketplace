/// <reference path="../pb_data/types.d.ts" />
/**
 * Reconciliation: proving an account against its statement.
 *
 * A session has a statement date and the statement's closing balance. Tick
 * the entries the statement shows (they become `cleared`; matching a bank
 * line clears its entry automatically). The session can finish only when
 *   opening balance (everything reconciled before) + cleared entries
 *   = statement balance
 * and finishing marks those entries `reconciled`: from then on they cannot
 * change until that reconciliation is undone (only the latest can be).
 * Amounts are minor units of the account's currency.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function serialize(rec) {
  return {
    id: rec.id,
    account: rec.getString('account'),
    statement_date: rec.getString('statement_date'),
    statement_balance: rec.getInt('statement_balance'),
    opening_balance: rec.getInt('opening_balance'),
    status: rec.getString('status') || 'open',
    finished_at: rec.getString('finished_at'),
    cleared_count: rec.getInt('cleared_count'),
    adjustment: rec.getString('adjustment'),
    note: rec.getString('note'),
    added_by: rec.getString('added_by') || 'user',
    created: rec.getString('created'),
  };
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'reconciliations', id);
  if (!rec) throw fail(404, 'No reconciliation ' + id + '; see reconcile.list');
  return rec;
}

/** Sum of reconciled entries on an account (account currency). */
function reconciledBalance(app, accountId) {
  const row = new DynamicModel({ s: 0 });
  app.db().newQuery("SELECT COALESCE(SUM(amount),0) AS s FROM postings WHERE account = {:a} AND status = 'posted' AND recon_state = 'reconciled'").bind({ a: accountId }).one(row);
  return row.s;
}

function openFor(app, accountId) {
  const rows = app.findRecordsByFilter('reconciliations', "account = {:a} && status = 'open'", '-created', 1, 0, { a: accountId });
  return rows.length > 0 ? rows[0] : null;
}

function lastFinished(app, accountId) {
  const rows = app.findRecordsByFilter('reconciliations', "account = {:a} && status = 'finished'", '-statement_date,-created', 1, 0, { a: accountId });
  return rows.length > 0 ? rows[0] : null;
}

/** The closing balance the newest imported statement reported, if any. */
function statementHint(app, accountId) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = app.findRecordsByFilter('statement_imports', "account = {:a} && status = 'done'", '-period_to,-created', 10, 0, { a: accountId });
  for (const r of rows) {
    const b = u.json(r, 'balances', {}) || {};
    if (b.closing !== undefined && b.closing !== null) return { balance: b.closing, date: b.date || r.getString('period_to'), file_name: r.getString('file_name') };
  }
  return null;
}

/** Start (or return the open) session for an account. */
function start(app, accountRef, statementDate, statementBalance, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const acc = ledger.account(app, accountRef);
  const t = acc.getString('type');
  if (t !== 'asset' && t !== 'liability') throw fail(400, 'Only balance sheet accounts (banks, cards, loans, ...) are reconciled');
  const open = openFor(app, acc.id);
  const date = dates.parse(statementDate, 'statement_date');
  const last = lastFinished(app, acc.id);
  if (last && date <= last.getString('statement_date')) throw fail(409, 'The account is already reconciled through ' + last.getString('statement_date') + '; pick a later statement date');
  const ccy = acc.getString('currency') || ledger.home(app);
  // Cards and loans: the statement shows what is owed as a positive number.
  const bal = (t === 'liability' ? -1 : 1) * money.amount(statementBalance, ccy, 'statement_balance');
  const rec = open || new Record(app.findCollectionByNameOrId('reconciliations'));
  rec.set('account', acc.id);
  rec.set('statement_date', date);
  rec.set('statement_balance', bal);
  rec.set('opening_balance', reconciledBalance(app, acc.id));
  rec.set('status', 'open');
  if (!open) rec.set('added_by', who.actor === 'agent' ? 'agent' : 'user');
  app.save(rec);
  return rec;
}

/**
 * The session's working view: entries up to the statement date that are not
 * reconciled yet, with the running totals.
 */
function state(app, rec) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const accountId = rec.getString('account');
  const acc = app.findRecordById('accounts', accountId);
  const to = rec.getString('statement_date');
  const posts = app.findRecordsByFilter('postings', "account = {:a} && status = 'posted' && recon_state != 'reconciled' && date <= {:t}", 'date,created', 0, 0, { a: accountId, t: to });
  const later = app.findRecordsByFilter('postings', "account = {:a} && status = 'posted' && recon_state = 'cleared' && date > {:t}", 'date', 0, 0, { a: accountId, t: to });
  const txnIds = {};
  for (const p of posts) txnIds[p.getString('txn')] = true;
  const txns = {};
  for (const id of Object.keys(txnIds)) {
    try {
      txns[id] = app.findRecordById('transactions', id);
    } catch {
      /* gone */
    }
  }
  let cleared = 0;
  let clearedN = 0;
  let deposits = 0;
  let payments = 0;
  const rows = posts.map((p) => {
    const t = txns[p.getString('txn')];
    const isCleared = p.getString('recon_state') === 'cleared';
    if (isCleared) {
      cleared += p.getInt('amount');
      clearedN++;
      if (p.getInt('amount') > 0) deposits += p.getInt('amount');
      else payments += p.getInt('amount');
    }
    return {
      posting: p.id,
      txn: p.getString('txn'),
      date: p.getString('date'),
      narration: t ? t.getString('narration') : '',
      contact: t ? t.getString('contact') : '',
      reference: t ? t.getString('reference') : '',
      amount: p.getInt('amount'),
      cleared: isCleared,
      matched: p.getString('statement_line') !== '',
      memo: p.getString('memo'),
    };
  });
  const opening = rec.getInt('opening_balance');
  const clearedBalance = opening + cleared;
  const sb = rec.getInt('statement_balance');
  return {
    session: serialize(rec),
    account: ledger.serializeAccount(acc),
    currency: acc.getString('currency') || ledger.home(app),
    sign: acc.getString('type') === 'liability' ? -1 : 1,
    opening: opening,
    cleared_total: cleared,
    cleared_count: clearedN,
    deposits: deposits,
    payments: payments,
    cleared_balance: clearedBalance,
    statement_balance: sb,
    difference: sb - clearedBalance,
    book_balance: ledger.balanceOf(app, accountId, to).amount,
    rows: rows,
    later_cleared: later.length,
    hint: statementHint(app, accountId),
  };
}

/** Tick or untick entries in an open session. */
function toggle(app, rec, postingIds, cleared, who) {
  if (rec.getString('status') !== 'open') throw fail(409, 'This reconciliation is not open');
  const out = [];
  for (const id of postingIds) {
    let p;
    try {
      p = app.findRecordById('postings', id);
    } catch {
      throw fail(404, 'No entry ' + id);
    }
    if (p.getString('account') !== rec.getString('account')) throw fail(400, 'That entry is on another account');
    if (p.getString('recon_state') === 'reconciled') throw fail(409, 'That entry is already reconciled');
    if (p.getString('status') !== 'posted') throw fail(409, 'Only posted entries can be ticked');
    if (!cleared && p.getString('statement_line') !== '') throw fail(409, 'That entry is matched to a bank statement line; unmatch it in the Inbox to untick it');
    p.set('recon_state', cleared ? 'cleared' : '');
    app.save(p);
    out.push(p.id);
  }
  return out;
}

/**
 * Finish: the difference must be zero, or `adjust` books it (to the account
 * given, or Suspense) so the session can close.
 */
function finish(app, rec, adjust, adjustAccount, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  if (rec.getString('status') !== 'open') throw fail(409, 'This reconciliation is not open');
  let st = state(app, rec);
  if (st.difference !== 0) {
    if (!adjust) throw fail(409, 'The difference is ' + money.format(st.difference, st.currency) + '; tick or fix entries until it is zero, or finish with an adjustment');
    const acc = app.findRecordById('accounts', rec.getString('account'));
    const other = adjustAccount ? ledger.account(app, adjustAccount) : ledger.sys(app, 'suspense');
    const r = ledger.create(
      app,
      {
        date: rec.getString('statement_date'),
        narration: 'Reconciliation adjustment · ' + acc.getString('name'),
        kind: 'reconciliation',
        postings: [
          { account: acc, amount: st.difference, recon_state: 'cleared' },
          { account: other, amount: -st.difference, currency: acc.getString('currency') || ledger.home(app) },
        ],
        reason: 'Statement and books differed by ' + money.format(st.difference, st.currency) + ' at ' + rec.getString('statement_date'),
      },
      who,
    );
    rec.set('adjustment', r.txn.id);
    st = state(app, rec);
  }
  let n = 0;
  for (const row of st.rows) {
    if (!row.cleared) continue;
    const p = app.findRecordById('postings', row.posting);
    p.set('recon_state', 'reconciled');
    p.set('reconciliation', rec.id);
    app.save(p);
    n++;
  }
  rec.set('status', 'finished');
  rec.set('finished_at', new Date().toISOString());
  rec.set('cleared_count', n);
  app.save(rec);
  return rec;
}

/** Undo the latest finished reconciliation of its account. */
function undo(app, rec, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  if (rec.getString('status') !== 'finished') throw fail(409, 'Only a finished reconciliation can be undone');
  const last = lastFinished(app, rec.getString('account'));
  if (!last || last.id !== rec.id) throw fail(409, 'Undo the later reconciliation of this account first (' + (last ? last.getString('statement_date') : '') + ')');
  ledger.checkLock(app, rec.getString('statement_date'), who);
  const posts = app.findRecordsByFilter('postings', 'reconciliation = {:r}', '', 0, 0, { r: rec.id });
  for (const p of posts) {
    p.set('recon_state', 'cleared');
    p.set('reconciliation', '');
    app.save(p);
  }
  rec.set('status', 'undone');
  app.save(rec);
  return rec;
}

/** Cancel an open session (ticks stay as cleared). */
function cancel(app, rec) {
  if (rec.getString('status') !== 'open') throw fail(409, 'This reconciliation is not open');
  app.delete(rec);
}

/** Reconciliation status per balance sheet account with activity. */
function overview(app) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const accs = app.findRecordsByFilter('accounts', "archived = false && (subtype = 'bank' || subtype = 'cash' || subtype = 'card' || subtype = 'loan' || subtype = 'clearing')", 'code', 0, 0);
  const bal = ledger.balances(app, {});
  return accs.map((a) => {
    const last = lastFinished(app, a.id);
    const open = openFor(app, a.id);
    const unrec = new DynamicModel({ n: 0, s: 0 });
    app.db().newQuery("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM postings WHERE account = {:a} AND status = 'posted' AND recon_state != 'reconciled'").bind({ a: a.id }).one(unrec);
    const inbox = new DynamicModel({ n: 0 });
    app.db().newQuery("SELECT COUNT(*) AS n FROM statement_lines WHERE account = {:a} AND (status = 'new' OR status = 'proposed')").bind({ a: a.id }).one(inbox);
    return {
      account: ledger.serializeAccount(a, (bal[a.id] || { home: 0 }).home),
      balance_ccy: (bal[a.id] || { amount: 0 }).amount,
      last: last ? serialize(last) : null,
      open: open ? serialize(open) : null,
      unreconciled: unrec.n,
      unreconciled_total: unrec.s,
      inbox: inbox.n,
      hint: statementHint(app, a.id),
    };
  });
}

function list(app, accountId) {
  const filter = accountId ? 'account = {:a}' : 'id != ""';
  return app.findRecordsByFilter('reconciliations', filter, '-statement_date,-created', 200, 0, { a: accountId || '' }).map(serialize);
}

module.exports = { serialize: serialize, mustGet: mustGet, reconciledBalance: reconciledBalance, openFor: openFor, lastFinished: lastFinished, statementHint: statementHint, start: start, state: state, toggle: toggle, finish: finish, undo: undo, cancel: cancel, overview: overview, list: list };
