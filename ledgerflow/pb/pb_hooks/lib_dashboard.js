/// <reference path="../pb_data/types.d.ts" />
/**
 * The home dashboard in one answer: headline numbers for a period against
 * the period before, the cash balance day by day, money in and out by month,
 * where money went, who owes what by age, what is due soon, account
 * balances with their trend, budgets, what needs the person, and what the
 * AI agent did. All in the home currency, minor units.
 */

const CASH = "('bank','cash')";

/** Daily cash balance (bank and cash accounts) from `from` to `to`, one point per day. */
function cashSeries(app, from, to) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const open = new DynamicModel({ s: 0 });
  app
    .db()
    .newQuery("SELECT COALESCE(SUM(p.home_amount),0) AS s FROM postings p JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND a.subtype IN " + CASH + ' AND p.date < {:f}')
    .bind({ f: from })
    .one(open);
  const rows = arrayOf(new DynamicModel({ date: '', s: 0 }));
  app
    .db()
    .newQuery("SELECT p.date AS date, COALESCE(SUM(p.home_amount),0) AS s FROM postings p JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND a.subtype IN " + CASH + ' AND p.date >= {:f} AND p.date <= {:t} GROUP BY p.date ORDER BY p.date')
    .bind({ f: from, t: to })
    .all(rows);
  const byDay = {};
  for (const r of rows) byDay[r.date] = r.s;
  const out = [];
  let run = open.s;
  let d = from;
  for (let i = 0; i < 800 && d <= to; i++) {
    run += byDay[d] || 0;
    out.push({ date: d, value: run });
    d = dates.addDays(d, 1);
  }
  // Days before the books started carry nothing.
  while (out.length > 31 && out[0].value === 0 && out[1].value === 0) out.shift();
  return out;
}

/** Income and expenses per month for the last n months (ending with the current one). */
function monthly(app, n, today) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const start = dates.addMonths(dates.monthStart(today), -(n - 1));
  const rows = arrayOf(new DynamicModel({ m: '', type: '', s: 0 }));
  app
    .db()
    .newQuery("SELECT substr(p.date,1,7) AS m, a.type AS type, COALESCE(SUM(p.home_amount),0) AS s FROM postings p JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND a.type IN ('income','expense') AND p.date >= {:f} AND p.date <= {:t} GROUP BY m, a.type")
    .bind({ f: start, t: dates.monthEnd(today) })
    .all(rows);
  const months = [];
  for (let i = 0; i < n; i++) {
    const m = dates.period(dates.addMonths(start, i));
    months.push({ month: m, income: 0, expense: 0, net: 0 });
  }
  const idx = {};
  months.forEach((x, i) => (idx[x.month] = i));
  for (const r of rows) {
    const x = months[idx[r.m]];
    if (!x) continue;
    if (r.type === 'income') x.income += -r.s;
    else x.expense += r.s;
  }
  for (const x of months) x.net = x.income - x.expense;
  return months;
}

/** Totals for income and expenses between two dates. */
function pl(app, from, to) {
  const m = new DynamicModel({ inc: 0, exp: 0 });
  app
    .db()
    .newQuery(
      "SELECT COALESCE(SUM(CASE WHEN a.type = 'income' THEN -p.home_amount ELSE 0 END),0) AS inc, COALESCE(SUM(CASE WHEN a.type = 'expense' THEN p.home_amount ELSE 0 END),0) AS exp FROM postings p JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND a.type IN ('income','expense') AND p.date >= {:f} AND p.date <= {:t}",
    )
    .bind({ f: from, t: to })
    .one(m);
  return { income: m.inc, expense: m.exp, net: m.inc - m.exp };
}

/** Expenses by account in a period: the top ones and the rest. */
function categories(app, from, to, type) {
  const rows = arrayOf(new DynamicModel({ account: '', name: '', code: '', s: 0 }));
  app
    .db()
    .newQuery('SELECT p.account AS account, a.name AS name, a.code AS code, COALESCE(SUM(p.home_amount),0) AS s FROM postings p JOIN accounts a ON a.id = p.account WHERE p.status = \'posted\' AND a.type = {:ty} AND p.date >= {:f} AND p.date <= {:t} GROUP BY p.account ORDER BY s ' + (type === 'income' ? 'ASC' : 'DESC'))
    .bind({ f: from, t: to, ty: type })
    .all(rows);
  const list = [];
  let total = 0;
  for (const r of rows) {
    const v = type === 'income' ? -r.s : r.s;
    if (v <= 0) continue;
    list.push({ account: r.account, name: r.name, code: r.code, value: v });
    total += v;
  }
  const top = list.slice(0, 7);
  const rest = list.slice(7).reduce((s, x) => s + x.value, 0);
  if (rest > 0) top.push({ account: '', name: 'Everything else', code: '', value: rest });
  return { total: total, items: top.map((x) => Object.assign(x, { share: total ? x.value / total : 0 })) };
}

/** Bank, card and cash accounts with balance and a 30-day trend. */
function accountTrends(app, today) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const from = dates.addDays(today, -29);
  const accs = app.findRecordsByFilter('accounts', "archived = false && (subtype = 'bank' || subtype = 'cash' || subtype = 'card')", 'code', 0, 0);
  const open = arrayOf(new DynamicModel({ account: '', s: 0, h: 0 }));
  app.db().newQuery("SELECT account, COALESCE(SUM(amount),0) AS s, COALESCE(SUM(home_amount),0) AS h FROM postings WHERE status = 'posted' AND date < {:f} GROUP BY account").bind({ f: from }).all(open);
  const openBy = {};
  for (const r of open) openBy[r.account] = r.s;
  const rows = arrayOf(new DynamicModel({ account: '', date: '', s: 0 }));
  app.db().newQuery("SELECT account, date, COALESCE(SUM(amount),0) AS s FROM postings WHERE status = 'posted' AND date >= {:f} AND date <= {:t} GROUP BY account, date").bind({ f: from, t: today }).all(rows);
  const moves = {};
  for (const r of rows) (moves[r.account] = moves[r.account] || {})[r.date] = r.s;
  const bal = ledger.balances(app, {});
  const inbox = arrayOf(new DynamicModel({ account: '', n: 0 }));
  app.db().newQuery("SELECT account, COUNT(*) AS n FROM statement_lines WHERE status = 'new' OR status = 'proposed' GROUP BY account").all(inbox);
  const inboxBy = {};
  for (const r of inbox) inboxBy[r.account] = r.n;
  return accs.map((a) => {
    const series = [];
    let run = openBy[a.id] || 0;
    let d = from;
    for (let i = 0; i < 30; i++) {
      run += (moves[a.id] || {})[d] || 0;
      series.push(run);
      d = dates.addDays(d, 1);
    }
    const sign = a.getString('type') === 'liability' ? -1 : 1;
    const b = bal[a.id] || { amount: 0, home: 0 };
    return {
      id: a.id,
      name: a.getString('name'),
      subtype: a.getString('subtype'),
      currency: a.getString('currency') || ledger.home(app),
      balance: sign * b.amount,
      home: sign * b.home,
      series: series.map((v) => sign * v),
      inbox: inboxBy[a.id] || 0,
    };
  });
}

function dashboard(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const reports = require(`${__hooks}/lib_reports.js`);
  const docs = require(`${__hooks}/lib_docs.js`);
  const setup = require(`${__hooks}/lib_setup.js`);
  const s = setup.row(app);
  const fy = s.getInt('fiscal_year_start') || 1;
  const today = dates.today();
  const rangeName = ['this_month', 'last_month', 'this_quarter', 'ytd', 'last_12_months'].indexOf(p.range) >= 0 ? p.range : 'this_month';
  const r = dates.range(rangeName, fy, today);
  // This month so far compares with the same days of last month.
  let prev = dates.compareRange(r.from, r.to, rangeName === 'ytd' ? 'previous_year' : 'previous_period');
  const to = r.to > today ? today : r.to;
  if (r.to > today) prev = { from: prev.from, to: dates.addDays(prev.from, dates.daysBetween(r.from, today)) };

  const now = pl(app, r.from, to);
  const before = pl(app, prev.from, prev.to);
  const cash = cashSeries(app, dates.addDays(today, -179), today);
  const cashNow = cash.length ? cash[cash.length - 1].value : 0;
  const cash30 = cash.length > 30 ? cash[cash.length - 31].value : cash.length ? cash[0].value : 0;
  const months = monthly(app, 12, today);
  // Average monthly costs over the last three full months, for runway.
  const full = months.slice(-4, -1);
  const avgExp = full.length ? Math.round(full.reduce((t, x) => t + x.expense, 0) / full.length) : 0;
  const ar = reports.aged(app, { side: 'receivables', to: today });
  const ap = reports.aged(app, { side: 'payables', to: today });
  const summary = reports.summary(app);

  // Due soon: open invoices and bills due within two weeks, and overdue ones.
  const soon = dates.addDays(today, 14);
  const due = app
    .findRecordsByFilter('documents', "status = 'approved' && (kind = 'invoice' || kind = 'bill') && due_date != '' && due_date <= {:s}", 'due_date', 60, 0, { s: soon })
    .filter((d) => d.getInt('total') - d.getInt('allocated') > 0)
    .slice(0, 8)
    .map((d) => {
      let name = '';
      try {
        name = app.findRecordById('contacts', d.getString('contact')).getString('name');
      } catch {
        name = '';
      }
      return { id: d.id, kind: d.getString('kind'), number: d.getString('number'), contact: name, due_date: d.getString('due_date'), open: d.getInt('total') - d.getInt('allocated'), currency: d.getString('currency'), days: dates.daysBetween(d.getString('due_date'), today) };
    });
  const recurring = app.findRecordsByFilter('recurring', "active = true && next_date != '' && next_date <= {:s}", 'next_date', 5, 0, { s: dates.addDays(today, 31) }).map((x) => ({ id: x.id, name: x.getString('name'), kind: x.getString('kind'), next_date: x.getString('next_date') }));

  // What waits in the inbox, by how it would be booked.
  const mix = { rule: 0, match: 0, agent: 0, memory: 0, none: 0, ai_working: 0 };
  for (const l of app.findRecordsByFilter('statement_lines', "status = 'new' || status = 'proposed'", '', 0, 0)) {
    const raw = l.getString('suggestion');
    let sug = null;
    try {
      sug = raw && raw !== 'null' ? JSON.parse(raw) : null;
    } catch {
      sug = null;
    }
    const st = l.getString('agent_state');
    if ((st === 'waiting' || st === 'working') && !sug) mix.ai_working++;
    else if (!sug) mix.none++;
    else if (sug.method === 'rule') mix.rule++;
    else if (sug.method === 'agent') mix.agent++;
    else if (sug.method === 'memory') mix.memory++;
    else mix.match++;
  }

  // Unreconciled bank and card accounts.
  const recon = [];
  for (const a of app.findRecordsByFilter('accounts', "archived = false && (subtype = 'bank' || subtype = 'card')", 'code', 0, 0)) {
    const last = app.findRecordsByFilter('reconciliations', "account = {:a} && status = 'finished'", '-statement_date', 1, 0, { a: a.id });
    const used = app.findRecordsByFilter('postings', "account = {:a} && status = 'posted'", '', 1, 0, { a: a.id }).length > 0;
    if (!used) continue;
    recon.push({ id: a.id, name: a.getString('name'), through: last.length ? last[0].getString('statement_date') : '' });
  }

  // Budgets this month.
  const fyStart = dates.fiscalYearStart(today, fy);
  const monthIndex = (Number(today.slice(0, 4)) - Number(fyStart.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(fyStart.slice(5, 7));
  const thisMonth = pl(app, dates.monthStart(today), today);
  const budgetRows = [];
  const spentBy = {};
  const spentAll = arrayOf(new DynamicModel({ account: '', s: 0 }));
  app.db().newQuery("SELECT p.account AS account, COALESCE(SUM(p.home_amount),0) AS s FROM postings p WHERE p.status = 'posted' AND p.date >= {:f} AND p.date <= {:t} GROUP BY p.account").bind({ f: dates.monthStart(today), t: today }).all(spentAll);
  for (const x of spentAll) spentBy[x.account] = x.s;
  for (const b of app.findRecordsByFilter('budgets', 'year = {:y}', '', 0, 0, { y: Number(fyStart.slice(0, 4)) })) {
    let months12 = [];
    try {
      months12 = JSON.parse(b.getString('months') || '[]') || [];
    } catch {
      months12 = [];
    }
    const plan = Number(months12[monthIndex] || 0);
    if (!plan) continue;
    let acc = null;
    try {
      acc = app.findRecordById('accounts', b.getString('account'));
    } catch {
      continue;
    }
    const sign = acc.getString('type') === 'income' ? -1 : 1;
    budgetRows.push({ account: acc.id, name: acc.getString('name'), type: acc.getString('type'), budget: plan, actual: sign * (spentBy[acc.id] || 0) });
  }
  budgetRows.sort((a, b) => b.actual / (b.budget || 1) - a.actual / (a.budget || 1));

  const act = require(`${__hooks}/lib_activity.js`);
  const recent = act.list(app, { limit: 7 });
  const runs = act.runs(app, 3);

  return {
    currency: ledger.home(app),
    entity: s.getString('entity') || 'both',
    today: today,
    range: { name: rangeName, from: r.from, to: to, prev_from: prev.from, prev_to: prev.to },
    kpi: {
      cash: cashNow,
      cash_30: cash30,
      income: now.income,
      income_prev: before.income,
      expense: now.expense,
      expense_prev: before.expense,
      net: now.net,
      net_prev: before.net,
      receivables: summary.receivables.open,
      overdue: summary.receivables.overdue,
      overdue_count: summary.receivables.overdue_count,
      payables: summary.payables.open,
      payables_due_7: summary.payables.due_7,
      tax_owed: summary.tax_owed,
      cards: summary.cards,
      avg_monthly_expense: avgExp,
      runway_months: avgExp > 0 ? Math.round((cashNow / avgExp) * 10) / 10 : null,
      savings_rate: now.income > 0 ? Math.round((now.net / now.income) * 1000) / 10 : null,
      month_income: thisMonth.income,
      month_expense: thisMonth.expense,
    },
    cash: cash,
    months: months,
    spending: categories(app, r.from, to, 'expense'),
    earning: categories(app, r.from, to, 'income'),
    aged: { receivables: ar.totals, payables: ap.totals, debtors: ar.rows.slice(0, 5).map((x) => ({ contact: x.contact, name: x.name, total: x.total, late: x.total - x.current })) },
    due: due,
    recurring: recurring,
    accounts: accountTrends(app, today),
    budgets: budgetRows.slice(0, 6),
    inbox: { total: summary.inbox, mix: mix, files: summary.files_inbox, proposed: summary.proposed },
    reconcile: recon,
    activity: recent,
    runs: runs,
  };
}

module.exports = { dashboard: dashboard, cashSeries: cashSeries, monthly: monthly, categories: categories };
