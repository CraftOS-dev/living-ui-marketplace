/// <reference path="../pb_data/types.d.ts" />
/**
 * Closing the books and budgets.
 *
 * The month-end checklist is computed from the data (nothing to tick by
 * hand): drafts dated in the month, statement lines not reconciled, goods
 * received but not billed, approved claims not posted, payroll not posted,
 * depreciation not run, and the trial balance. Closing a month sets the soft
 * lock date to its last day.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function money() {
  return require(`${__hooks}/lib_money.js`);
}

function status(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today();
  const month = util.monthParam(p, 'month', util.addMonths(today.slice(0, 7), -1));
  const from = util.monthStart(month);
  const to = util.monthEnd(month);
  const s = core().settings(app);
  const cur = core().currency(app);
  const checks = [];
  const add = (key, label, count, ok, detail, link) => checks.push({ key: key, label: label, count: count, ok: ok, detail: detail, link: link || null });

  const drafts = util.rows(app, "SELECT type, COUNT(id) AS n FROM documents WHERE state = 'draft' AND type IN ('delivery','invoice','credit_note','goods_receipt','bill','supplier_credit') AND date <= {:t} GROUP BY type", { type: '', n: 0 }, { t: to });
  const nDrafts = drafts.reduce((s2, r) => s2 + r.n, 0);
  add('drafts', 'Drafts dated in or before ' + month + ' are posted or deleted', nDrafts, nDrafts === 0, drafts.map((r) => r.n + ' ' + r.type.replace(/_/g, ' ') + (r.n === 1 ? '' : 's')).join(', '), { page: 'documents' });

  const lines = util.one(app, "SELECT COUNT(id) AS n, IFNULL(SUM(amount), 0) AS s FROM bank_lines WHERE status = 'unmatched' AND date <= {:t}", { n: 0, s: 0 }, { t: to });
  add('bank', 'Every statement line through ' + month + ' is reconciled', lines.n, lines.n === 0, lines.n > 0 ? lines.n + ' lines, net ' + money().fmt(lines.s, cur) : '', { page: 'banking' });

  const grni = core().systemAccount(app, 'grni');
  const grniBal = require(`${__hooks}/lib_ledger.js`).balanceOf(app, grni.id, to);
  add('grni', 'Goods received are billed (goods received not invoiced)', grniBal === 0 ? 0 : 1, grniBal === 0, grniBal !== 0 ? money().fmt(-grniBal, cur) + ' received and not billed' : '', { page: 'docs', type: 'purchase_order', status: 'to_bill' });

  const claims = util.one(app, "SELECT COUNT(id) AS n FROM expense_claims WHERE status = 'approved' AND date <= {:t}", { n: 0 }, { t: to }).n;
  add('claims', 'Approved expense claims are posted', claims, claims === 0, '', { page: 'claims' });

  const payroll = util.findOne(app, 'payroll_runs', 'month = {:m}', { m: month });
  const mods = util.jsonOf(s, 'modules') || {};
  if (mods.payroll !== false && mods.payroll !== undefined) {
    const ok = payroll !== null && (payroll.getString('status') === 'posted' || payroll.getString('status') === 'paid');
    add('payroll', 'Payroll for ' + month + ' is posted', ok ? 0 : 1, ok, payroll === null ? 'No pay run yet' : 'The pay run is ' + payroll.getString('status'), { page: 'payroll' });
  }

  const assets = util.one(app, "SELECT COUNT(id) AS n FROM assets WHERE status = 'active' AND start <= {:t} AND (last_month = '' OR last_month < {:m})", { n: 0 }, { t: to, m: month }).n;
  add('depreciation', 'Depreciation is posted through ' + month, assets, assets === 0, assets > 0 ? assets + ' assets not depreciated through ' + month : '', { page: 'assets' });

  const tb = require(`${__hooks}/lib_reports.js`).trialBalance(ctx, { from: from, to: to });
  add('trial_balance', 'The trial balance balances', tb.balanced ? 0 : 1, tb.balanced, '', { page: 'reports', report: 'trial-balance' });

  const proposals = util.one(app, "SELECT COUNT(id) AS n FROM proposals WHERE status = 'waiting'", { n: 0 }).n;
  add('proposals', 'No proposals from your AI agent are waiting', proposals, proposals === 0, '', { page: 'needs' });

  const soft = s.getString('soft_lock_date');
  const closed = soft !== '' && soft >= to;
  const pnl = require(`${__hooks}/lib_reports.js`).pnl(ctx, { from: from, to: to });
  return {
    month: month,
    from: from,
    to: to,
    closed: closed,
    soft_lock_date: soft,
    hard_lock_date: s.getString('hard_lock_date'),
    checks: checks,
    ready: checks.every((c) => c.ok),
    net_profit: pnl.net[0],
    revenue: pnl.sections[0].totals[0],
    currency: cur,
    months: util.monthsBetween(util.addMonths(today.slice(0, 7), -11), today.slice(0, 7)).map((m) => ({ month: m, closed: soft !== '' && soft >= util.monthEnd(m) })),
  };
}

function closeMonth(ctx, p) {
  const util = u();
  const app = ctx.app;
  const month = util.monthParam(p, 'month', '');
  if (month === '') throw util.fail(400, 'month is required (YYYY-MM)', 'missing_param');
  const end = util.monthEnd(month);
  if (end >= util.today()) throw util.fail(409, month + ' has not ended yet.', 'too_early');
  const s = core().settings(app);
  if (s.getString('soft_lock_date') !== '' && s.getString('soft_lock_date') >= end) throw util.fail(409, month + ' is already closed.', 'already_closed');
  s.set('soft_lock_date', end);
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'lock', entity: 'settings', ref: s.id, label: month, summary: 'Closed the books through ' + end });
  return status(ctx, { month: month });
}

function reopen(ctx, p) {
  const util = u();
  const app = ctx.app;
  require(`${__hooks}/lib_auth.js`).needAdmin(ctx, 'reopen closed months');
  const month = util.monthParam(p, 'month', '');
  if (month === '') throw util.fail(400, 'month is required (YYYY-MM)', 'missing_param');
  const s = core().settings(app);
  const hard = s.getString('hard_lock_date');
  const back = util.addDays(util.monthStart(month), -1);
  if (hard !== '' && back < hard) throw util.fail(409, 'The books are locked through ' + hard + '; that cannot be reopened here.', 'period_locked');
  s.set('soft_lock_date', s.getString('soft_lock_date') !== '' && s.getString('soft_lock_date') > back ? back : s.getString('soft_lock_date'));
  app.save(s);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'lock', entity: 'settings', ref: s.id, label: month, summary: 'Reopened the books from ' + month });
  return status(ctx, { month: month });
}

/* ============================================================ budgets */

function getBudget(ctx, p) {
  return require(`${__hooks}/lib_reports.js`).budget(ctx, p);
}

function setBudget(ctx, p) {
  const util = u();
  const app = ctx.app;
  const cur = core().currency(app);
  const writes = [];
  const list = util.list(p, 'lines');
  if (list !== undefined) {
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      util.keysOnly(x, ['account', 'month', 'amount'], 'Line ' + (i + 1));
      const acc = core().resolve(app, 'accounts', String(x.account || ''));
      if (acc.getString('type') !== 'income' && acc.getString('type') !== 'expense') throw util.fail(400, 'Budgets are for income and expense accounts.', 'invalid_param');
      const m = String(x.month || '');
      if (!util.isMonth(m)) throw util.fail(400, 'month must be YYYY-MM', 'invalid_param');
      const amount = x.amount === '' || x.amount === null || x.amount === undefined ? 0 : money().toMinor(String(x.amount), cur, true);
      if (amount === null) throw util.fail(400, 'amount must be like 5000.00', 'invalid_amount');
      writes.push({ account: acc.id, month: m, amount: amount });
    }
  }
  const accRef = util.str(p, 'account', '');
  if (accRef !== '') {
    const acc = core().resolve(app, 'accounts', accRef);
    const year = util.int(p, 'year', Number(require(`${__hooks}/lib_reports.js`).fiscalStart(app, util.today()).slice(0, 4)), 1970, 2100);
    const annual = util.money(p, 'annual', cur, { required: true, allowNegative: false });
    const fm = core().settings(app).getInt('fiscal_start_month') || 1;
    const first = year + '-' + (fm < 10 ? '0' + fm : fm);
    const months = util.monthsBetween(first, util.addMonths(first, 11));
    let left = annual;
    months.forEach((m, i) => {
      const part = i === 11 ? left : Math.floor(annual / 12);
      left -= part;
      writes.push({ account: acc.id, month: m, amount: part });
    });
  }
  if (writes.length === 0) throw util.fail(400, 'Give lines, or account with year and annual.', 'missing_param');
  app.runInTransaction((tx) => {
    for (const w of writes) {
      let r = util.findOne(tx, 'budgets', 'account = {:a} && month = {:m}', { a: w.account, m: w.month });
      if (r === null) {
        if (w.amount === 0) continue;
        r = util.newRecord(tx, 'budgets');
        r.set('account', w.account);
        r.set('month', w.month);
      }
      r.set('amount', w.amount);
      tx.save(r);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'budget', entity: 'accounts', ref: writes[0].account, label: 'Budget', summary: 'Set ' + writes.length + ' budget amounts' });
  });
  return { saved: writes.length };
}

module.exports = { status: status, closeMonth: closeMonth, reopen: reopen, getBudget: getBudget, setBudget: setBudget };
