/// <reference path="../pb_data/types.d.ts" />
/**
 * Read models: the month overview (Home, Insights, Budgets), the multi-month
 * trend and the CSV export. All sums are integer minor units.
 */

function inRange(app, from, to) {
  return app.findRecordsByFilter('expenses', 'date >= {:f} && date < {:t}', 'date,created', 0, 0, { f: from, t: to });
}

function month(app, monthStr) {
  const u = require(`${__hooks}/lib_util.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const ex = require(`${__hooks}/lib_expenses.js`);
  const ctx = ex.context(app);
  const exp = money.exponent(ctx.currency);
  const major = (n) => money.toMajor(n, exp);
  const range = u.monthRange(monthStr);
  const rows = inRange(app, range.from, range.to);
  const y = Number(monthStr.slice(0, 4));
  const m = Number(monthStr.slice(5, 7));
  const dim = u.daysInMonth(y, m);
  const today = u.today();
  const thisMonth = today.slice(0, 7);
  const isCurrent = monthStr === thisMonth;
  const isFuture = monthStr > thisMonth;
  const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : isFuture ? 0 : dim;

  let total = 0;
  const daily = [];
  for (let i = 0; i < dim; i++) daily.push(0);
  const byCat = {};
  let uncategorized = 0;
  for (const r of rows) {
    const a = r.getInt('amount');
    total += a;
    daily[Number(r.getString('date').slice(8, 10)) - 1] += a;
    const c = r.getString('category');
    const key = c === '' ? '' : c;
    if (key === '') uncategorized++;
    if (!byCat[key]) byCat[key] = { total: 0, count: 0 };
    byCat[key].total += a;
    byCat[key].count += 1;
  }

  // Same point last month: the first N days, N = today's day (capped).
  const prevMonth = u.addMonths(monthStr, -1);
  const prevRange = u.monthRange(prevMonth);
  const prevDim = u.daysInMonth(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)));
  const prevCut = isCurrent ? Math.min(dayOfMonth, prevDim) : prevDim;
  const prevTo = isCurrent ? u.addDays(prevMonth + '-' + u.pad(prevCut), 1) : prevRange.to;
  let prevTotal = 0;
  for (const r of inRange(app, prevRange.from, prevTo)) prevTotal += r.getInt('amount');

  const settings = ex.settings(app);
  const budget = settings.getInt('monthly_budget');
  const cats = ex.categoryList(app);
  const categories = [];
  for (const c of cats) {
    const s = byCat[c.id];
    const b = c.getInt('budget');
    if (!s && b === 0) continue;
    categories.push({
      id: c.id,
      name: c.getString('name'),
      icon: c.getString('icon'),
      total: major(s ? s.total : 0),
      total_minor: s ? s.total : 0,
      count: s ? s.count : 0,
      budget: b > 0 ? major(b) : null,
      budget_minor: b,
      share: total > 0 && s ? Math.round((s.total / total) * 1000) / 10 : 0,
    });
  }
  if (byCat['']) {
    categories.push({
      id: null,
      name: 'Uncategorized',
      icon: '',
      total: major(byCat[''].total),
      total_minor: byCat[''].total,
      count: byCat[''].count,
      budget: null,
      budget_minor: 0,
      share: total > 0 ? Math.round((byCat[''].total / total) * 1000) / 10 : 0,
    });
  }
  categories.sort((a, b) => b.total_minor - a.total_minor || a.name.localeCompare(b.name));

  const biggest = rows
    .slice()
    .sort((a, b) => b.getInt('amount') - a.getInt('amount'))
    .slice(0, 5)
    .map((r) => ex.serialize(r, ctx));

  const daysLeft = isCurrent ? dim - dayOfMonth + 1 : isFuture ? dim : 0;
  return {
    month: monthStr,
    currency: ctx.currency,
    total: major(total),
    total_minor: total,
    count: rows.length,
    uncategorized: uncategorized,
    days_in_month: dim,
    day_of_month: dayOfMonth,
    days_left: daysLeft,
    daily_average: dayOfMonth > 0 ? major(Math.round(total / dayOfMonth)) : major(0),
    daily_average_minor: dayOfMonth > 0 ? Math.round(total / dayOfMonth) : 0,
    daily: daily.map((v, i) => ({ date: monthStr + '-' + u.pad(i + 1), total: major(v), total_minor: v })),
    previous: {
      month: prevMonth,
      through_day: prevCut,
      total: major(prevTotal),
      total_minor: prevTotal,
    },
    budget:
      budget > 0
        ? { amount: major(budget), amount_minor: budget, left: major(budget - total), left_minor: budget - total, used_pct: Math.round((total / budget) * 1000) / 10 }
        : null,
    categories: categories,
    biggest: biggest,
  };
}

function trend(app, endMonth, months) {
  const u = require(`${__hooks}/lib_util.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const ex = require(`${__hooks}/lib_expenses.js`);
  const cur = ex.homeCurrency(app);
  const exp = money.exponent(cur);
  const start = u.addMonths(endMonth, -(months - 1));
  const rows = inRange(app, start + '-01', u.addMonths(endMonth, 1) + '-01');
  const totals = {};
  const counts = {};
  for (let i = 0; i < months; i++) {
    const k = u.addMonths(start, i);
    totals[k] = 0;
    counts[k] = 0;
  }
  for (const r of rows) {
    const k = r.getString('date').slice(0, 7);
    if (totals[k] === undefined) continue;
    totals[k] += r.getInt('amount');
    counts[k] += 1;
  }
  const out = Object.keys(totals)
    .sort()
    .map((k) => ({ month: k, total: money.toMajor(totals[k], exp), total_minor: totals[k], count: counts[k] }));
  const sum = out.reduce((a, b) => a + b.total_minor, 0);
  const withData = out.filter((x) => x.count > 0).length;
  return {
    currency: cur,
    months: out,
    average: money.toMajor(withData > 0 ? Math.round(sum / withData) : 0, exp),
    average_minor: withData > 0 ? Math.round(sum / withData) : 0,
  };
}

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.split('"').join('""') + '"';
  return s;
}

/** Expenses from `from` to `to` inclusive as CSV text. */
function exportCsv(app, from, to) {
  const u = require(`${__hooks}/lib_util.js`);
  const ex = require(`${__hooks}/lib_expenses.js`);
  const ctx = ex.context(app);
  const rows = inRange(app, from, u.addDays(to, 1));
  const lines = [['Date', 'Amount', 'Currency', 'Category', 'Note', 'Added by', 'Original amount', 'Original currency'].join(',')];
  for (const r of rows) {
    const s = ex.serialize(r, ctx);
    lines.push(
      [s.date, s.amount, s.currency, s.category || '', s.note, s.source, s.original_amount || '', s.original_currency || '']
        .map(csvCell)
        .join(','),
    );
  }
  return {
    filename: 'expenses_' + from + '_to_' + to + '.csv',
    content: lines.join('\r\n') + '\r\n',
    rows: rows.length,
  };
}

module.exports = { month: month, trend: trend, exportCsv: exportCsv };
