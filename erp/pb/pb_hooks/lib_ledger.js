/// <reference path="../pb_data/types.d.ts" />
/**
 * The general ledger: the only writer of journals and journal lines.
 *
 * - post() writes one balanced journal entry (debits equal credits, in base
 *   minor units) and keeps `ledger_months` (balance per account and month)
 *   in step, in the caller's transaction.
 * - Entries are never edited or deleted. reverse() writes the mirror entry
 *   and marks the original reversed.
 * - Lock dates: nothing posts on or before the hard lock; only people with
 *   full Accounting rights post on or before the soft lock.
 * - Control accounts (receivable, payable, inventory, goods received not
 *   invoiced) take lines only from their documents (opts.allowControl).
 *
 * Every function that writes takes the transaction handle and uses only it.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/** Throw unless `date` may be posted by ctx. */
function checkDate(app, ctx, date) {
  const util = u();
  if (!util.isDay(date)) throw util.fail(400, 'The posting date must be YYYY-MM-DD.', 'invalid_param');
  const s = require(`${__hooks}/lib_core.js`).settings(app);
  const hard = s.getString('hard_lock_date');
  if (hard !== '' && date <= hard) throw util.fail(409, 'The books are locked through ' + hard + '. Post on a later date.', 'period_locked', { lock: hard });
  const soft = s.getString('soft_lock_date');
  if (soft !== '' && date <= soft) {
    const auth = require(`${__hooks}/lib_auth.js`);
    if (ctx.isAgent || !auth.can(ctx, 'accounting', 'full')) {
      throw util.fail(409, 'The books are closed through ' + soft + '. Post on a later date, or ask someone with full Accounting rights.', 'period_closed', { lock: soft });
    }
  }
}

/** The first date that is not locked for ctx (today when nothing is locked after it). */
function firstOpenDate(app, ctx, wanted) {
  const util = u();
  const s = require(`${__hooks}/lib_core.js`).settings(app);
  const auth = require(`${__hooks}/lib_auth.js`);
  let lock = s.getString('hard_lock_date');
  const soft = s.getString('soft_lock_date');
  if (soft !== '' && (ctx.isAgent || !auth.can(ctx, 'accounting', 'full')) && soft > lock) lock = soft;
  if (lock === '' || wanted > lock) return wanted;
  const next = util.addDays(lock, 1);
  const t = util.today();
  return next > t ? next : t;
}

function accountRec(app, id, cache) {
  if (cache[id] !== undefined) return cache[id];
  const rec = u().byId(app, 'accounts', id);
  cache[id] = rec;
  return rec;
}

/**
 * Merge lines that hit the same account with the same party and dimensions
 * on the same side (an invoice of 200 lines to one income account becomes
 * one line), keeping order.
 */
function compact(lines) {
  const out = [];
  const index = {};
  for (const l of lines) {
    const side = l.debit > 0 ? 'd' : 'c';
    const key = [l.account, l.party || '', l.employee || '', l.department || '', l.project || '', l.doc || '', l.currency || '', side, l.keep ? out.length : ''].join('|');
    const at = index[key];
    if (at === undefined) {
      index[key] = out.length;
      out.push(Object.assign({}, l));
    } else {
      const t = out[at];
      t.debit += l.debit;
      t.credit += l.credit;
      t.amount_cur = (t.amount_cur || 0) + (l.amount_cur || 0);
    }
  }
  return out;
}

/**
 * Write one journal entry.
 *   entry: { kind, date, memo, source: {entity, id, label}, lines: [{account,
 *            debit, credit, party, employee, department, project, doc, memo,
 *            currency, amount_cur}] }
 *   opts:  { allowControl, compact (default true) }
 * Returns the journal record, or null when every line is zero.
 */
function post(tx, ctx, entry, opts) {
  const util = u();
  const o = opts || {};
  const core = require(`${__hooks}/lib_core.js`);
  checkDate(tx, ctx, entry.date);
  let lines = [];
  for (const l of entry.lines || []) {
    const d = Math.round(Number(l.debit || 0));
    const c = Math.round(Number(l.credit || 0));
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c) || d < 0 || c < 0) throw util.fail(400, 'A journal line amount is not a whole positive number of minor units.', 'invalid');
    if (d > 0 && c > 0) {
      // A line with both sides nets to one side.
      const net = d - c;
      if (net === 0) continue;
      lines.push(Object.assign({}, l, { debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 }));
    } else if (d > 0 || c > 0) lines.push(Object.assign({}, l, { debit: d, credit: c }));
  }
  if (o.compact !== false) lines = compact(lines);
  let td = 0;
  let tc = 0;
  for (const l of lines) {
    td += l.debit;
    tc += l.credit;
  }
  if (td !== tc) throw util.fail(409, 'The entry does not balance: debits ' + td + ' and credits ' + tc + ' (minor units).', 'unbalanced', { debit: td, credit: tc });
  if (td === 0) return null;
  const cache = {};
  for (const l of lines) {
    const acc = accountRec(tx, l.account, cache);
    if (acc === null) throw util.fail(400, 'A journal line has no valid account.', 'invalid');
    if (acc.getBool('archived')) throw util.fail(409, 'The account ' + acc.getString('code') + ' ' + acc.getString('name') + ' is archived. Restore it or use another.', 'account_archived');
    if (acc.getBool('control') && !o.allowControl) {
      throw util.fail(409, acc.getString('code') + ' ' + acc.getString('name') + ' is a control account: it changes only through its documents (invoices, bills, payments, stock).', 'control_account');
    }
  }
  const month = entry.date.slice(0, 7);
  const j = util.newRecord(tx, 'journals');
  j.set('number', core.nextNumber(tx, 'journal'));
  j.set('date', entry.date);
  j.set('month', month);
  j.set('kind', entry.kind);
  j.set('memo', String(entry.memo || '').slice(0, 500));
  const src = entry.source || {};
  j.set('source_entity', src.entity || '');
  j.set('source_id', src.id || '');
  j.set('source_label', String(src.label || '').slice(0, 80));
  j.set('state', 'posted');
  j.set('total', td);
  j.set('actor', ctx.actor === 'agent' ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  j.set('member', ctx.memberId || '');
  if (ctx.approving) j.set('approved_by', ctx.memberId || '');
  if (entry.reverses) j.set('reverses', entry.reverses);
  tx.save(j);
  const col = tx.findCollectionByNameOrId('journal_lines');
  const sums = {};
  lines.forEach((l, i) => {
    const r = new Record(col);
    r.set('journal', j.id);
    r.set('account', l.account);
    r.set('date', entry.date);
    r.set('month', month);
    r.set('debit', l.debit);
    r.set('credit', l.credit);
    r.set('party', l.party || '');
    r.set('employee', l.employee || '');
    r.set('department', l.department || '');
    r.set('project', l.project || '');
    r.set('doc', l.doc || '');
    r.set('memo', String(l.memo || '').slice(0, 300));
    r.set('currency', l.currency || '');
    r.set('amount_cur', Math.round(l.amount_cur || 0));
    r.set('sort', i);
    tx.save(r);
    const s = sums[l.account] || { d: 0, c: 0 };
    s.d += l.debit;
    s.c += l.credit;
    sums[l.account] = s;
  });
  for (const acc of Object.keys(sums)) bumpMonth(tx, acc, month, sums[acc].d, sums[acc].c);
  return j;
}

/** Add to an account's balance for a month (the cache the reports read). */
function bumpMonth(tx, account, month, debit, credit) {
  const util = u();
  const res = util.exec(tx, 'UPDATE ledger_months SET debit = debit + {:d}, credit = credit + {:c} WHERE account = {:a} AND month = {:m}', { d: debit, c: credit, a: account, m: month });
  let n = 0;
  try {
    n = res.rowsAffected();
  } catch {
    n = 0;
  }
  if (n === 0) {
    const r = util.newRecord(tx, 'ledger_months');
    r.set('account', account);
    r.set('month', month);
    r.set('debit', debit);
    r.set('credit', credit);
    tx.save(r);
  }
}

/** The lines of a journal as plain objects. */
function linesOf(app, journalId) {
  return app.findRecordsByFilter('journal_lines', 'journal = {:j}', 'sort', 0, 0, { j: journalId }).map((l) => ({
    account: l.getString('account'),
    debit: l.getInt('debit'),
    credit: l.getInt('credit'),
    party: l.getString('party'),
    employee: l.getString('employee'),
    department: l.getString('department'),
    project: l.getString('project'),
    doc: l.getString('doc'),
    memo: l.getString('memo'),
    currency: l.getString('currency'),
    amount_cur: l.getInt('amount_cur'),
  }));
}

/**
 * Reverse a journal: the mirror entry dated `date` (the original's date when
 * that is open, else the first open day), linked both ways.
 */
function reverse(tx, ctx, journalId, opts) {
  const util = u();
  const o = opts || {};
  const j = tx.findRecordById('journals', journalId);
  if (j.getString('state') === 'reversed') throw util.fail(409, 'Journal ' + j.getString('number') + ' is already reversed.', 'already_reversed');
  if (j.getString('kind') === 'reversal') throw util.fail(409, 'A reversal cannot itself be reversed. Post a new entry instead.', 'invalid');
  const date = o.date || firstOpenDate(tx, ctx, j.getString('date'));
  const lines = linesOf(tx, j.id).map((l) =>
    Object.assign({}, l, { debit: l.credit, credit: l.debit, amount_cur: -l.amount_cur, keep: true }),
  );
  const r = post(
    tx,
    ctx,
    {
      kind: o.kind || 'reversal',
      date: date,
      memo: o.memo || 'Reverses ' + j.getString('number') + (j.getString('memo') !== '' ? ': ' + j.getString('memo') : ''),
      source: o.source || { entity: j.getString('source_entity'), id: j.getString('source_id'), label: j.getString('source_label') },
      lines: lines,
      reverses: j.id,
    },
    { allowControl: true, compact: false },
  );
  j.set('state', 'reversed');
  if (r !== null) j.set('reversed_by', r.id);
  tx.save(j);
  return r;
}

/* ------------------------------------------------------------- reading */

/** Balance (debit minus credit) of accounts as of the end of `to` (inclusive), optionally from `from`. */
function balances(app, from, to) {
  const util = u();
  // Whole months from the cache, then the partial months from the lines.
  const out = {};
  const add = (acc, d, c) => {
    const b = out[acc] || { debit: 0, credit: 0 };
    b.debit += d;
    b.credit += c;
    out[acc] = b;
  };
  const toM = to.slice(0, 7);
  const toWhole = to === util.monthEnd(toM);
  const fromM = from === '' ? '' : from.slice(0, 7);
  const fromWhole = from === '' || from === util.monthStart(fromM);
  const firstFull = from === '' ? '0000-00' : fromWhole ? fromM : util.addMonths(fromM, 1);
  const lastFull = toWhole ? toM : util.addMonths(toM, -1);
  if (firstFull <= lastFull) {
    for (const r of util.rows(app, 'SELECT account, SUM(debit) AS d, SUM(credit) AS c FROM ledger_months WHERE month >= {:a} AND month <= {:b} GROUP BY account', { account: '', d: 0, c: 0 }, { a: firstFull, b: lastFull })) {
      add(r.account, r.d, r.c);
    }
  }
  const partial = [];
  if (from !== '' && !fromWhole) partial.push([from, fromM === toM ? to : util.monthEnd(fromM)]);
  if (!toWhole && !(from !== '' && !fromWhole && fromM === toM)) partial.push([toM === fromM && from !== '' ? from : util.monthStart(toM), to]);
  for (const range of partial) {
    for (const r of util.rows(app, 'SELECT account, SUM(debit) AS d, SUM(credit) AS c FROM journal_lines WHERE date >= {:a} AND date <= {:b} GROUP BY account', { account: '', d: 0, c: 0 }, { a: range[0], b: range[1] })) {
      add(r.account, r.d, r.c);
    }
  }
  return out;
}

/** One account's balance (debit minus credit) through `to`. */
function balanceOf(app, accountId, to) {
  const util = u();
  const r = util.one(app, 'SELECT IFNULL(SUM(debit), 0) AS d, IFNULL(SUM(credit), 0) AS c FROM journal_lines WHERE account = {:a} AND date <= {:t}', { d: 0, c: 0 }, { a: accountId, t: to || '9999-12-31' });
  return r.d - r.c;
}

/** A journal for screens and the agent. */
function journalOut(app, j, withLines) {
  const util = u();
  const cur = require(`${__hooks}/lib_core.js`).currency(app);
  const out = {
    id: j.id,
    number: j.getString('number'),
    date: j.getString('date'),
    kind: j.getString('kind'),
    memo: j.getString('memo'),
    source: { entity: j.getString('source_entity'), id: j.getString('source_id'), label: j.getString('source_label') },
    state: j.getString('state'),
    total: j.getInt('total'),
    total_text: require(`${__hooks}/lib_money.js`).minorText(j.getInt('total'), cur),
    actor: j.getString('actor'),
    who: j.getString('actor') === 'agent' ? 'Your AI agent' : require(`${__hooks}/lib_audit.js`).memberName(app, j.getString('member'), {}),
    approved_by: j.getString('approved_by') !== '' ? require(`${__hooks}/lib_audit.js`).memberName(app, j.getString('approved_by'), {}) : '',
    reverses: j.getString('reverses'),
    reversed_by: j.getString('reversed_by'),
    created: j.getString('created'),
    currency: cur,
  };
  if (withLines) {
    const accs = {};
    const names = {};
    out.lines = app.findRecordsByFilter('journal_lines', 'journal = {:j}', 'sort', 0, 0, { j: j.id }).map((l) => {
      const acc = accountRec(app, l.getString('account'), accs);
      const party = l.getString('party');
      if (party !== '' && names[party] === undefined) {
        const pr = util.byId(app, 'parties', party);
        names[party] = pr ? pr.getString('name') : '';
      }
      return {
        account: acc ? { id: acc.id, code: acc.getString('code'), name: acc.getString('name'), type: acc.getString('type') } : null,
        debit: l.getInt('debit'),
        credit: l.getInt('credit'),
        party: party !== '' ? { id: party, name: names[party] } : null,
        employee: l.getString('employee'),
        department: l.getString('department'),
        project: l.getString('project'),
        doc: l.getString('doc'),
        memo: l.getString('memo'),
        currency: l.getString('currency'),
        amount_cur: l.getInt('amount_cur'),
      };
    });
  }
  return out;
}

/** Plain journal lines (account ids) -> display lines with account names (for previews). */
function describeLines(app, lines) {
  const accs = {};
  const util = u();
  const names = {};
  return lines
    .filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0)
    .map((l) => {
      const acc = accountRec(app, l.account, accs);
      if (l.party && names[l.party] === undefined) {
        const pr = util.byId(app, 'parties', l.party);
        names[l.party] = pr ? pr.getString('name') : '';
      }
      return {
        account: acc ? { id: acc.id, code: acc.getString('code'), name: acc.getString('name') } : { id: l.account, code: '?', name: 'Missing account' },
        debit: l.debit || 0,
        credit: l.credit || 0,
        party: l.party ? names[l.party] : '',
        memo: l.memo || '',
      };
    });
}

module.exports = {
  checkDate: checkDate,
  firstOpenDate: firstOpenDate,
  post: post,
  reverse: reverse,
  linesOf: linesOf,
  balances: balances,
  balanceOf: balanceOf,
  journalOut: journalOut,
  describeLines: describeLines,
  compact: compact,
};
