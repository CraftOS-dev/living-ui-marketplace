/// <reference path="../pb_data/types.d.ts" />
/**
 * Books health and month-end close.
 *
 * checks(app, from, to) runs the questions an accountant asks before a
 * period is called done; each answers ok / warn / fail with a count and
 * where to fix it. A period (YYYY-MM) has a checklist: the automatic checks
 * plus manual items the person ticks. Signing a period off can move the lock
 * date to its last day, after which nobody (the AI agent included) changes
 * entries dated inside it until the lock moves back.
 */

const MANUAL = [
  { key: 'statements', label: 'Every bank and card statement for the month is imported' },
  { key: 'receipts', label: 'Receipts are attached to purchases that need them' },
  { key: 'payroll', label: 'Payroll, loans and other non-bank entries are recorded' },
  { key: 'review', label: 'The profit and loss and balance sheet look right' },
];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function count(app, sql, prm) {
  const m = new DynamicModel({ n: 0, s: 0 });
  app.db().newQuery(sql).bind(prm || {}).one(m);
  return m;
}

/** Health checks for a date range. */
function checks(app, from, to) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const home = ledger.home(app);
  const out = [];
  const add = (key, label, status, n, detail, go, agent) => out.push({ key: key, label: label, status: status, count: n, detail: detail, go: go || null, agent: !!agent });
  const prm = { f: from, t: to };

  const inbox = count(app, "SELECT COUNT(*) AS n FROM statement_lines WHERE (status = 'new' OR status = 'proposed') AND date >= {:f} AND date <= {:t}", prm).n;
  add('inbox', 'Bank lines are all booked', inbox === 0 ? 'ok' : 'fail', inbox, inbox === 0 ? 'Nothing waiting in the inbox for this period' : inbox + ' bank line' + (inbox === 1 ? '' : 's') + ' still waiting', { view: 'inbox', from: from, to: to }, true);

  const proposed = count(app, "SELECT COUNT(*) AS n FROM transactions WHERE status = 'proposed' AND date >= {:f} AND date <= {:t}", prm).n;
  add('proposed', 'No entries waiting for approval', proposed === 0 ? 'ok' : 'warn', proposed, proposed === 0 ? 'Nothing proposed' : proposed + ' proposed entr' + (proposed === 1 ? 'y' : 'ies') + ' (not in reports until approved)', { view: 'ledger', status: 'proposed' });

  for (const role of [
    ['uncat_expense', 'Uncategorized expense is empty'],
    ['uncat_income', 'Uncategorized income is empty'],
    ['suspense', 'Suspense is empty'],
    ['transfers', 'Transfers in transit are settled'],
  ]) {
    try {
      const a = ledger.sys(app, role[0]);
      const r = count(app, "SELECT COUNT(*) AS n, COALESCE(SUM(home_amount),0) AS s FROM postings WHERE account = {:a} AND status = 'posted' AND date <= {:t}" + (role[0].indexOf('uncat') === 0 ? ' AND date >= {:f}' : ''), { a: a.id, f: from, t: to });
      add(role[0], role[1], r.s === 0 ? 'ok' : 'warn', r.n, r.s === 0 ? a.getString('name') + ' is clear' : a.getString('name') + ' holds ' + money.format(Math.abs(r.s), home), { view: 'ledger', account: a.id }, true);
    } catch {
      /* account missing */
    }
  }

  // Bank and card accounts reconciled through the period end.
  const banks = app.findRecordsByFilter('accounts', "archived = false && (subtype = 'bank' || subtype = 'card')", 'code', 0, 0);
  const behind = [];
  for (const a of banks) {
    const used = count(app, "SELECT COUNT(*) AS n FROM postings WHERE account = {:a} AND status = 'posted' AND date <= {:t}", { a: a.id, t: to }).n;
    if (used === 0) continue;
    const last = app.findRecordsByFilter('reconciliations', "account = {:a} && status = 'finished'", '-statement_date', 1, 0, { a: a.id });
    if (last.length === 0 || last[0].getString('statement_date') < to) behind.push(a.getString('name') + (last.length > 0 ? ' (through ' + last[0].getString('statement_date') + ')' : ' (never)'));
  }
  add('reconciled', 'Bank and card accounts are reconciled', behind.length === 0 ? 'ok' : 'warn', behind.length, behind.length === 0 ? 'All reconciled through ' + to : 'Not reconciled through ' + to + ': ' + behind.join(', '), { view: 'reconcile' });

  const drafts = count(app, "SELECT COUNT(*) AS n FROM documents WHERE status = 'draft' AND issue_date <= {:t}", prm).n;
  add('drafts', 'No draft invoices or bills left behind', drafts === 0 ? 'ok' : 'warn', drafts, drafts === 0 ? 'No drafts' : drafts + ' draft' + (drafts === 1 ? '' : 's') + ' dated in or before the period', { view: 'sales', state: 'draft' });

  const files = count(app, "SELECT COUNT(*) AS n FROM files WHERE status = 'inbox' OR status = 'reading'").n;
  add('files', 'Receipts and documents are filed', files === 0 ? 'ok' : 'warn', files, files === 0 ? 'No unfiled receipts' : files + ' receipt' + (files === 1 ? '' : 's') + ' or document' + (files === 1 ? '' : 's') + ' not linked yet', { view: 'inbox', tab: 'files' }, true);

  // Possible duplicates: same account, date, amount and text.
  const dup = count(
    app,
    "SELECT COUNT(*) AS n FROM (SELECT p.account, p.date, p.amount, t.narration, COUNT(*) AS c FROM postings p JOIN transactions t ON t.id = p.txn JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND a.cashflow = 'cash' AND p.date >= {:f} AND p.date <= {:t} AND t.kind NOT IN ('transfer') GROUP BY p.account, p.date, p.amount, t.narration HAVING c > 1)",
    prm,
  ).n;
  add('duplicates', 'No likely duplicate entries', dup === 0 ? 'ok' : 'warn', dup, dup === 0 ? 'No two entries share account, date, amount and description' : dup + ' group' + (dup === 1 ? '' : 's') + ' of entries with the same account, date, amount and description', { view: 'ledger', from: from, to: to, dupes: true }, true);

  // Overdrawn cash accounts.
  const neg = [];
  for (const a of app.findRecordsByFilter('accounts', "archived = false && subtype = 'cash'", 'code', 0, 0)) {
    const b = ledger.balanceOf(app, a.id, to).amount;
    if (b < 0) neg.push(a.getString('name'));
  }
  add('negative_cash', 'Cash accounts are not negative', neg.length === 0 ? 'ok' : 'fail', neg.length, neg.length === 0 ? 'No cash account below zero' : 'Below zero: ' + neg.join(', ') + ' (a missing deposit or a wrong account)', { view: 'ledger' });

  const overdue = require(`${__hooks}/lib_docs.js`).summary(app, 'sales');
  add('overdue', 'Overdue invoices are followed up', overdue.overdue_count === 0 ? 'ok' : 'info', overdue.overdue_count, overdue.overdue_count === 0 ? 'No overdue invoices' : overdue.overdue_count + ' overdue, ' + money.format(overdue.overdue, home) + ' in total', { view: 'sales', state: 'overdue' }, true);

  const future = count(app, "SELECT COUNT(*) AS n FROM transactions WHERE status = 'posted' AND date > {:t}", { t: require(`${__hooks}/lib_dates.js`).addDays(require(`${__hooks}/lib_dates.js`).today(), 31) }).n;
  if (future > 0) add('future', 'No entries dated far in the future', 'warn', future, future + ' entr' + (future === 1 ? 'y is' : 'ies are') + ' dated more than a month ahead (a typo in the year?)', { view: 'ledger' });

  // Foreign-currency cash accounts that would move with a revaluation.
  const fx = app.findRecordsByFilter('accounts', "archived = false && currency != '' && currency != {:h} && (subtype = 'bank' || subtype = 'cash' || subtype = 'card')", '', 0, 0, { h: home });
  if (fx.length > 0) {
    const rev = count(app, "SELECT COUNT(*) AS n FROM transactions WHERE kind = 'fx' AND status = 'posted' AND date = {:t}", { t: to }).n;
    add('revaluation', 'Foreign-currency accounts revalued at period end', rev > 0 ? 'ok' : 'info', fx.length, rev > 0 ? 'Revalued at ' + to : fx.length + ' account' + (fx.length === 1 ? '' : 's') + ' in other currencies; revalue at ' + to + ' if you report unrealized gains', { view: 'setup', tab: 'currencies' });
  }
  return out;
}

function serializePeriod(app, rec, withChecks) {
  const u = require(`${__hooks}/lib_util.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const b = dates.periodBounds(rec.getString('period'));
  const out = {
    id: rec.id,
    period: rec.getString('period'),
    from: b.from,
    to: b.to,
    status: rec.getString('status') || 'open',
    checklist: u.json(rec, 'checklist', {}) || {},
    signed_off_at: rec.getString('signed_off_at'),
    notes: rec.getString('notes'),
    agent_state: rec.getString('agent_state'),
    agent_note: rec.getString('agent_note'),
    agent_at: rec.getString('agent_at'),
    manual: MANUAL,
  };
  if (withChecks) out.checks = checks(app, b.from, b.to);
  return out;
}

/** The period row (created on first use). */
function period(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  dates.periodBounds(p);
  const rows = app.findRecordsByFilter('periods', 'period = {:p}', '', 1, 0, { p: p });
  if (rows.length > 0) return rows[0];
  const rec = new Record(app.findCollectionByNameOrId('periods'));
  rec.set('period', p);
  rec.set('status', 'open');
  rec.set('checklist', {});
  app.save(rec);
  return rec;
}

/** Months from the first entry to this month, newest first, with their status. */
function periods(app) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const first = count(app, "SELECT COUNT(*) AS n FROM transactions WHERE status = 'posted'").n;
  const today = dates.today();
  const m = new DynamicModel({ d: '' });
  app.db().newQuery("SELECT COALESCE(MIN(date),'') AS d FROM transactions WHERE status = 'posted'").one(m);
  let start = m.d || today;
  if (first === 0) start = today;
  const startP = dates.period(dates.addMonths(dates.monthStart(today), -2) < start ? dates.addMonths(dates.monthStart(today), -2) : start);
  const rows = {};
  for (const r of app.findRecordsByFilter('periods', 'id != ""', '-period', 0, 0)) rows[r.getString('period')] = r;
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  const lock = s.getString('lock_date');
  const out = [];
  let cur = dates.period(today);
  for (let i = 0; i < 60 && cur >= startP; i++) {
    const b = dates.periodBounds(cur);
    const r = rows[cur];
    const inbox = count(app, "SELECT COUNT(*) AS n FROM statement_lines WHERE (status = 'new' OR status = 'proposed') AND date >= {:f} AND date <= {:t}", { f: b.from, t: b.to }).n;
    out.push({ period: cur, from: b.from, to: b.to, status: r ? r.getString('status') || 'open' : 'open', locked: lock !== '' && b.to <= lock, signed_off_at: r ? r.getString('signed_off_at') : '', agent_state: r ? r.getString('agent_state') : '', inbox: inbox });
    cur = dates.period(dates.addMonths(b.from, -1));
  }
  return out;
}

/** Tick or untick a manual checklist item, or set notes. */
function tick(app, rec, key, done) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!MANUAL.some((m) => m.key === key)) throw fail(400, 'item must be one of: ' + MANUAL.map((m) => m.key).join(', '));
  const c = u.json(rec, 'checklist', {}) || {};
  c[key] = done ? new Date().toISOString() : null;
  rec.set('checklist', c);
  app.save(rec);
  return rec;
}

/**
 * Sign a period off. With `lock`, the books lock date moves to its last day
 * (never backwards). Failing checks block unless `force`.
 */
function signOff(app, rec, lock, force, who) {
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  if (who.actor === 'agent') throw fail(403, 'Only the person signs a period off; prepare it and tell them what is left');
  const b = require(`${__hooks}/lib_dates.js`).periodBounds(rec.getString('period'));
  const failing = checks(app, b.from, b.to).filter((c) => c.status === 'fail');
  if (failing.length > 0 && !force) throw fail(409, 'Not ready: ' + failing.map((c) => c.detail).join('; ') + '. Fix these, or sign off anyway.');
  rec.set('status', 'closed');
  rec.set('signed_off_at', new Date().toISOString());
  app.save(rec);
  if (lock && (s.getString('lock_date') === '' || s.getString('lock_date') < b.to)) {
    s.set('lock_date', b.to);
    app.save(s);
  }
  return rec;
}

/** Reopen a period: the lock date moves back to the day before it starts. */
function reopen(app, rec, who) {
  const dates = require(`${__hooks}/lib_dates.js`);
  if (who.actor === 'agent') throw fail(403, 'Only the person reopens a closed period');
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  const b = dates.periodBounds(rec.getString('period'));
  rec.set('status', 'open');
  rec.set('signed_off_at', '');
  app.save(rec);
  if (s.getString('lock_date') !== '' && s.getString('lock_date') >= b.from) {
    s.set('lock_date', dates.addDays(b.from, -1));
    app.save(s);
  }
  return rec;
}

module.exports = { MANUAL: MANUAL, checks: checks, serializePeriod: serializePeriod, period: period, periods: periods, tick: tick, signOff: signOff, reopen: reopen };
