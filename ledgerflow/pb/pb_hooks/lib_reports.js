/// <reference path="../pb_data/types.d.ts" />
/**
 * Reports, all in the home currency from posted entries.
 *
 *   pnl          profit and loss (accrual or cash basis), with columns by
 *                month or quarter and a comparison period
 *   balance      balance sheet as of a date; earnings of earlier fiscal
 *                years fold into retained earnings
 *   cashflow     where cash came from and went (direct method, by each
 *                account's cash flow class)
 *   trial        trial balance (debits equal credits)
 *   aged         aged receivables or payables by due date
 *   tax          sales tax / VAT summary per tax code (UK return boxes for
 *                the UK region)
 *   budget       budget against actual by month
 *   networth     assets, liabilities and net worth month by month
 *   spending     where money went: categories and payees
 *
 * Signs in report rows are natural: income, expenses, assets, liabilities
 * and equity all show as positive amounts when they have their usual balance.
 */

const DOC_KINDS = "'invoice','bill','credit_note','vendor_credit'";

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Resolve { range | from, to } into dates. */
function span(app, p, dflt) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  const fy = s.getInt('fiscal_year_start') || 1;
  if (p.range && p.range !== 'custom') {
    const r = dates.range(p.range, fy);
    if (!r) throw fail(400, 'range must be one of this_month, last_month, this_quarter, last_quarter, this_year, last_year, ytd, last_12_months, custom');
    return r;
  }
  if (p.from || p.to) {
    const from = p.from ? dates.parse(p.from, 'from') : '1900-01-01';
    const to = p.to ? dates.parse(p.to, 'to') : dates.today();
    if (from > to) throw fail(400, 'from is after to');
    return { from: from, to: to };
  }
  return dates.range(dflt || 'this_month', fy);
}

function accountsMap(app) {
  const out = {};
  for (const a of app.findRecordsByFilter('accounts', 'id != ""', 'code', 0, 0)) {
    out[a.id] = { id: a.id, code: a.getString('code'), name: a.getString('name'), type: a.getString('type'), subtype: a.getString('subtype'), parent: a.getString('parent'), system: a.getString('system'), cashflow: a.getString('cashflow'), archived: a.getBool('archived'), currency: a.getString('currency') };
  }
  return out;
}

/** Accrual sums per account between two dates (inclusive). */
function sums(app, from, to) {
  const rows = arrayOf(new DynamicModel({ account: '', s: 0 }));
  app
    .db()
    .newQuery("SELECT account, COALESCE(SUM(home_amount),0) AS s FROM postings WHERE status = 'posted' AND date >= {:f} AND date <= {:t} GROUP BY account")
    .bind({ f: from, t: to })
    .all(rows);
  const out = {};
  for (const r of rows) out[r.account] = r.s;
  return out;
}

/**
 * Cash basis sums for income and expense accounts: entries that are not
 * invoices or bills count when dated; an invoice or bill counts in the
 * proportion paid (or credited, or written off) when that happens.
 */
function cashSums(app, from, to) {
  const out = {};
  const rows = arrayOf(new DynamicModel({ account: '', s: 0 }));
  app
    .db()
    .newQuery(
      "SELECT p.account AS account, COALESCE(SUM(p.home_amount),0) AS s FROM postings p JOIN transactions t ON t.id = p.txn JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND p.date >= {:f} AND p.date <= {:t} AND (a.type = 'income' OR a.type = 'expense') AND t.kind NOT IN (" +
        DOC_KINDS +
        ') GROUP BY p.account',
    )
    .bind({ f: from, t: to })
    .all(rows);
  for (const r of rows) out[r.account] = r.s;
  const allocs = app.findRecordsByFilter('allocations', 'date >= {:f} && date <= {:t}', '', 0, 0, { f: from, t: to });
  const cache = {};
  const share = (docId, amount) => {
    if (!docId) return;
    let d = cache[docId];
    if (d === undefined) {
      d = null;
      try {
        const doc = app.findRecordById('documents', docId);
        if (doc.getString('txn') && doc.getInt('total') > 0) {
          const ps = [];
          const q = arrayOf(new DynamicModel({ account: '', h: 0 }));
          app
            .db()
            .newQuery("SELECT p.account AS account, p.home_amount AS h FROM postings p JOIN accounts a ON a.id = p.account WHERE p.txn = {:t} AND p.status = 'posted' AND (a.type = 'income' OR a.type = 'expense')")
            .bind({ t: doc.getString('txn') })
            .all(q);
          for (const x of q) ps.push({ account: x.account, h: x.h });
          d = { total: doc.getInt('total'), postings: ps };
        }
      } catch {
        d = null;
      }
      cache[docId] = d;
    }
    if (!d) return;
    const f = amount / d.total;
    for (const p of d.postings) out[p.account] = (out[p.account] || 0) + Math.round(p.h * f);
  };
  for (const a of allocs) {
    share(a.getString('document'), a.getInt('amount'));
    if (a.getString('kind') === 'credit') share(a.getString('credit_doc'), a.getInt('amount'));
  }
  return out;
}

const PNL_SECTIONS = [
  { key: 'income', label: 'Income', type: 'income', test: (a) => a.type === 'income' && a.subtype !== 'other_income', sign: -1 },
  { key: 'cogs', label: 'Cost of sales', type: 'expense', test: (a) => a.type === 'expense' && a.subtype === 'cogs', sign: 1 },
  { key: 'expense', label: 'Expenses', type: 'expense', test: (a) => a.type === 'expense' && a.subtype !== 'cogs' && a.subtype !== 'other_expense', sign: 1 },
  { key: 'other_income', label: 'Other income', type: 'income', test: (a) => a.type === 'income' && a.subtype === 'other_income', sign: -1 },
  { key: 'other_expense', label: 'Other expenses', type: 'expense', test: (a) => a.type === 'expense' && a.subtype === 'other_expense', sign: 1 },
];

/** Column spans for a range: total, month or quarter. */
function columnsFor(from, to, by) {
  const dates = require(`${__hooks}/lib_dates.js`);
  if (by !== 'month' && by !== 'quarter') return [{ label: from + ' – ' + to, from: from, to: to }];
  const step = by === 'month' ? 1 : 3;
  const out = [];
  let s = dates.monthStart(from);
  for (let i = 0; i < 36 && s <= to; i++) {
    const e = dates.monthEnd(dates.addMonths(s, step - 1));
    out.push({ label: by === 'month' ? s.slice(0, 7) : s.slice(0, 7) + ' Q', from: s < from ? from : s, to: e > to ? to : e });
    s = dates.addMonths(s, step);
  }
  return out;
}

/** Profit and loss. p: { range|from,to, basis: accrual|cash, by: total|month|quarter, compare: none|previous_period|previous_year } */
function pnl(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const r = span(app, p, 'this_month');
  const basis = p.basis === 'cash' ? 'cash' : 'accrual';
  const cols = columnsFor(r.from, r.to, p.by);
  if (p.compare === 'previous_period' || p.compare === 'previous_year') {
    const c = dates.compareRange(r.from, r.to, p.compare);
    cols.push({ label: p.compare === 'previous_year' ? 'Previous year' : 'Previous period', from: c.from, to: c.to, compare: true });
  }
  const accs = accountsMap(app);
  const data = cols.map((c) => (basis === 'cash' ? cashSums(app, c.from, c.to) : sums(app, c.from, c.to)));
  const sections = PNL_SECTIONS.map((sec) => {
    const rows = [];
    for (const id of Object.keys(accs)) {
      const a = accs[id];
      if (!sec.test(a)) continue;
      const values = data.map((d) => sec.sign * (d[id] || 0));
      if (values.every((v) => v === 0) && a.archived) continue;
      if (values.every((v) => v === 0) && !p.zero) continue;
      rows.push({ account: id, code: a.code, name: a.name, parent: a.parent, system: a.system, values: values });
    }
    rows.sort((x, y) => (x.code < y.code ? -1 : 1));
    const total = cols.map((_, i) => rows.reduce((s, row) => s + row.values[i], 0));
    return { key: sec.key, label: sec.label, rows: rows, total: total };
  });
  const by = {};
  for (const s of sections) by[s.key] = s.total;
  const gross = cols.map((_, i) => by.income[i] - by.cogs[i]);
  const operating = cols.map((_, i) => gross[i] - by.expense[i]);
  const net = cols.map((_, i) => operating[i] + by.other_income[i] - by.other_expense[i]);
  return { report: 'pnl', basis: basis, from: r.from, to: r.to, columns: cols, sections: sections, gross: gross, operating: operating, net: net, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
}

const BS_GROUPS = [
  { key: 'current_assets', label: 'Current assets', side: 'assets', test: (a) => a.type === 'asset' && ['fixed_asset', 'contra_asset', 'investment'].indexOf(a.subtype) < 0 },
  { key: 'fixed_assets', label: 'Fixed assets and investments', side: 'assets', test: (a) => a.type === 'asset' && ['fixed_asset', 'contra_asset', 'investment'].indexOf(a.subtype) >= 0 },
  { key: 'current_liabilities', label: 'Current liabilities', side: 'liabilities', test: (a) => a.type === 'liability' && a.subtype !== 'loan' },
  { key: 'long_term', label: 'Long-term liabilities', side: 'liabilities', test: (a) => a.type === 'liability' && a.subtype === 'loan' },
  { key: 'equity', label: 'Equity', side: 'equity', test: (a) => a.type === 'equity' },
];

function balanceCol(app, accs, to) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  const fyStart = dates.fiscalYearStart(to, s.getInt('fiscal_year_start') || 1);
  const all = sums(app, '1900-01-01', to);
  const prior = sums(app, '1900-01-01', dates.addDays(fyStart, -1));
  let current = 0;
  let before = 0;
  for (const id of Object.keys(accs)) {
    const t = accs[id].type;
    if (t !== 'income' && t !== 'expense') continue;
    current += (all[id] || 0) - (prior[id] || 0);
    before += prior[id] || 0;
  }
  return { all: all, current_earnings: -current, prior_earnings: -before };
}

/** Balance sheet. p: { to | range, compare: none|previous_year|previous_period(month) } */
function balance(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const to = p.to ? dates.parse(p.to, 'to') : p.range ? span(app, p).to : dates.today();
  const cols = [{ label: 'As of ' + to, to: to }];
  if (p.compare === 'previous_year') cols.push({ label: 'A year earlier', to: dates.addMonths(to, -12), compare: true });
  else if (p.compare === 'previous_period') cols.push({ label: 'A month earlier', to: dates.monthEnd(dates.addMonths(dates.monthStart(to), -1)), compare: true });
  const accs = accountsMap(app);
  const data = cols.map((c) => balanceCol(app, accs, c.to));
  const groups = BS_GROUPS.map((g) => {
    const sign = g.side === 'assets' ? 1 : -1;
    const rows = [];
    for (const id of Object.keys(accs)) {
      const a = accs[id];
      if (!g.test(a)) continue;
      const values = data.map((d) => sign * (d.all[id] || 0));
      if (values.every((v) => v === 0) && !p.zero) continue;
      rows.push({ account: id, code: a.code, name: a.name, parent: a.parent, system: a.system, values: values });
    }
    if (g.key === 'equity') {
      rows.push({ account: '', code: '', name: 'Earnings of earlier years', computed: true, values: data.map((d) => d.prior_earnings) });
      rows.push({ account: '', code: '', name: 'Earnings this year', computed: true, values: data.map((d) => d.current_earnings) });
    }
    rows.sort((x, y) => (x.computed ? 1 : y.computed ? -1 : x.code < y.code ? -1 : 1));
    return { key: g.key, label: g.label, side: g.side, rows: rows, total: cols.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0)) };
  });
  const tot = (side) => cols.map((_, i) => groups.filter((g) => g.side === side).reduce((s, g) => s + g.total[i], 0));
  const assets = tot('assets');
  const liabilities = tot('liabilities');
  const equity = tot('equity');
  return {
    report: 'balance',
    to: to,
    columns: cols,
    groups: groups,
    assets: assets,
    liabilities: liabilities,
    equity: equity,
    balanced: cols.map((_, i) => assets[i] === liabilities[i] + equity[i]),
    currency: require(`${__hooks}/lib_ledger.js`).home(app),
  };
}

/** Cash flow (direct). p: { range|from,to } */
function cashflow(app, p) {
  const r = span(app, p, 'this_month');
  const accs = accountsMap(app);
  const isCash = (id) => accs[id] && accs[id].cashflow === 'cash';
  const rows = arrayOf(new DynamicModel({ txn: '', account: '', h: 0 }));
  app
    .db()
    .newQuery(
      "SELECT p.txn AS txn, p.account AS account, p.home_amount AS h FROM postings p WHERE p.status = 'posted' AND p.date >= {:f} AND p.date <= {:t} AND p.txn IN (SELECT p2.txn FROM postings p2 JOIN accounts a2 ON a2.id = p2.account WHERE a2.cashflow = 'cash' AND p2.status = 'posted' AND p2.date >= {:f} AND p2.date <= {:t})",
    )
    .bind({ f: r.from, t: r.to })
    .all(rows);
  const byTxn = {};
  for (const x of rows) (byTxn[x.txn] = byTxn[x.txn] || []).push({ account: x.account, h: x.h });
  const lines = {};
  for (const id of Object.keys(byTxn)) {
    const ps = byTxn[id];
    for (const p2 of ps) {
      if (isCash(p2.account)) continue;
      const a = accs[p2.account];
      const cls = a ? a.cashflow || 'operating' : 'operating';
      const k = cls + '|' + p2.account;
      lines[k] = (lines[k] || 0) - p2.h;
    }
  }
  const classes = ['operating', 'investing', 'financing'].map((cls) => {
    const items = Object.keys(lines)
      .filter((k) => k.indexOf(cls + '|') === 0 && lines[k] !== 0)
      .map((k) => {
        const id = k.slice(cls.length + 1);
        const a = accs[id];
        return { account: id, code: a ? a.code : '', name: a ? a.name : id, value: lines[k] };
      })
      .sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
    return { key: cls, label: cls === 'operating' ? 'Operating activities' : cls === 'investing' ? 'Investing activities' : 'Financing activities', rows: items, total: items.reduce((s, i) => s + i.value, 0) };
  });
  const dates = require(`${__hooks}/lib_dates.js`);
  const before = sums(app, '1900-01-01', dates.addDays(r.from, -1));
  const after = sums(app, '1900-01-01', r.to);
  let opening = 0;
  let closing = 0;
  const accounts = [];
  for (const id of Object.keys(accs)) {
    if (!isCash(id)) continue;
    opening += before[id] || 0;
    closing += after[id] || 0;
    if ((before[id] || 0) !== 0 || (after[id] || 0) !== 0) accounts.push({ account: id, code: accs[id].code, name: accs[id].name, opening: before[id] || 0, closing: after[id] || 0 });
  }
  const net = classes.reduce((s, c) => s + c.total, 0);
  return { report: 'cashflow', from: r.from, to: r.to, classes: classes, net: net, opening: opening, closing: closing, accounts: accounts, reconciles: opening + net === closing, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
}

/** Trial balance as of a date (income and expenses from the fiscal year start). */
function trial(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const to = p.to ? dates.parse(p.to, 'to') : dates.today();
  const accs = accountsMap(app);
  const col = balanceCol(app, accs, to);
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  const fyStart = dates.fiscalYearStart(to, s.getInt('fiscal_year_start') || 1);
  const fy = sums(app, fyStart, to);
  const rows = [];
  let dr = 0;
  let cr = 0;
  for (const id of Object.keys(accs)) {
    const a = accs[id];
    let v = a.type === 'income' || a.type === 'expense' ? fy[id] || 0 : col.all[id] || 0;
    if (a.system === 'retained') v -= col.prior_earnings;
    if (v === 0) continue;
    rows.push({ account: id, code: a.code, name: a.name, type: a.type, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 });
    if (v > 0) dr += v;
    else cr -= v;
  }
  if (col.prior_earnings !== 0 && !Object.keys(accs).some((id) => accs[id].system === 'retained')) {
    const v = -col.prior_earnings;
    rows.push({ account: '', code: '', name: 'Earnings of earlier years', type: 'equity', debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 });
    if (v > 0) dr += v;
    else cr -= v;
  }
  rows.sort((x, y) => (x.code < y.code ? -1 : 1));
  return { report: 'trial', to: to, rows: rows, debit: dr, credit: cr, balanced: dr === cr, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
}

/** Aged receivables or payables. p: { side: receivables|payables, to } */
function aged(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const docsLib = require(`${__hooks}/lib_docs.js`);
  const to = p.to ? dates.parse(p.to, 'to') : dates.today();
  const side = p.side === 'payables' ? 'payables' : 'receivables';
  const kinds = side === 'receivables' ? "(kind = 'invoice' || kind = 'credit_note')" : "(kind = 'bill' || kind = 'vendor_credit')";
  const docs = app.findRecordsByFilter('documents', kinds + " && status = 'approved' && issue_date <= {:t}", 'due_date', 0, 0, { t: to });
  const buckets = ['current', '1_30', '31_60', '61_90', '90_plus'];
  const byContact = {};
  const totals = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0 };
  for (const d of docs) {
    const allocs = app.findRecordsByFilter('allocations', '(document = {:d} || credit_doc = {:d}) && date <= {:t}', '', 0, 0, { d: d.id, t: to });
    const paid = allocs.reduce((s, a) => s + a.getInt('amount'), 0);
    let open = d.getInt('total') - paid;
    if (open <= 0) continue;
    const credit = docsLib.CREDIT[d.getString('kind')] === true;
    const home = Math.round((d.getInt('home_total') * open) / (d.getInt('total') || 1)) * (credit ? -1 : 1);
    const due = d.getString('due_date') || d.getString('issue_date');
    const late = dates.daysBetween(due, to);
    const b = credit || late <= 0 ? 'current' : late <= 30 ? '1_30' : late <= 60 ? '31_60' : late <= 90 ? '61_90' : '90_plus';
    const cid = d.getString('contact');
    if (!byContact[cid]) {
      let name = '';
      try {
        name = app.findRecordById('contacts', cid).getString('name');
      } catch {
        name = '(no contact)';
      }
      byContact[cid] = { contact: cid, name: name, current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0, docs: [] };
    }
    const row = byContact[cid];
    row[b] += home;
    row.total += home;
    totals[b] += home;
    totals.total += home;
    row.docs.push({ id: d.id, kind: d.getString('kind'), number: d.getString('number'), issue_date: d.getString('issue_date'), due_date: due, days: late > 0 ? late : 0, open: open, currency: d.getString('currency'), home: home, bucket: b });
  }
  const rows = Object.keys(byContact)
    .map((k) => byContact[k])
    .sort((a, b) => b.total - a.total);
  return { report: 'aged', side: side, to: to, buckets: buckets, rows: rows, totals: totals, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
}

/** Sales tax / VAT summary. p: { range|from,to } */
function tax(app, p) {
  const r = span(app, p, 'last_quarter');
  const setup = require(`${__hooks}/lib_setup.js`);
  const s = setup.row(app);
  const rows = arrayOf(new DynamicModel({ txn: '', tax_code: '', tax_role: '', h: 0, type: '' }));
  app
    .db()
    .newQuery("SELECT p.txn AS txn, p.tax_code AS tax_code, p.tax_role AS tax_role, p.home_amount AS h, a.type AS type FROM postings p JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND p.tax_code != '' AND p.date >= {:f} AND p.date <= {:t}")
    .bind({ f: r.from, t: r.to })
    .all(rows);
  const codes = {};
  for (const c of app.findRecordsByFilter('tax_codes', 'id != ""', 'sort,code', 0, 0)) codes[c.id] = { id: c.id, code: c.getString('code'), name: c.getString('name'), rate: c.getString('rate'), group: c.getString('group'), sales_base: 0, sales_tax: 0, purchase_base: 0, purchase_tax: 0 };
  // Which side each transaction's tax belongs to, from its base lines.
  const sideOf = {};
  for (const x of rows) if (x.tax_role === 'base') sideOf[x.txn + '|' + x.tax_code] = x.type === 'income' ? 'sales' : 'purchases';
  let rcOutput = 0;
  for (const x of rows) {
    const c = codes[x.tax_code];
    if (!c) continue;
    if (x.tax_role === 'base') {
      if (x.type === 'income') c.sales_base += -x.h;
      else c.purchase_base += x.h;
      continue;
    }
    if (c.group === 'reverse') {
      if (x.h > 0) c.purchase_tax += x.h;
      else {
        c.sales_tax += -x.h;
        rcOutput += -x.h;
      }
      continue;
    }
    const side = sideOf[x.txn + '|' + x.tax_code] || (x.h < 0 ? 'sales' : 'purchases');
    if (side === 'sales') c.sales_tax += -x.h;
    else c.purchase_tax += x.h;
  }
  const list = Object.keys(codes)
    .map((k) => codes[k])
    .filter((c) => c.sales_base || c.sales_tax || c.purchase_base || c.purchase_tax || p.zero);
  const output = list.reduce((a, c) => a + c.sales_tax, 0);
  const input = list.reduce((a, c) => a + c.purchase_tax, 0);
  const out = { report: 'tax', from: r.from, to: r.to, region: s.getString('region') || 'none', codes: list, output_tax: output, input_tax: input, net: output - input, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
  // Payments to or refunds from the tax authority in the period (tax control lines without a tax code).
  try {
    const ledger = require(`${__hooks}/lib_ledger.js`);
    const taxAcc = ledger.sys(app, 'tax');
    const pay = new DynamicModel({ s: 0 });
    app.db().newQuery("SELECT COALESCE(SUM(home_amount),0) AS s FROM postings WHERE account = {:a} AND status = 'posted' AND tax_code = '' AND date >= {:f} AND date <= {:t}").bind({ a: taxAcc.id, f: r.from, t: r.to }).one(pay);
    out.settled = pay.s;
    out.control_balance = -ledger.balanceOf(app, taxAcc.id, r.to).home;
  } catch {
    out.settled = 0;
    out.control_balance = 0;
  }
  if (out.region === 'uk_vat') {
    const sales = list.reduce((a, c) => a + (c.group === 'reverse' ? 0 : c.sales_base), 0);
    const purchases = list.reduce((a, c) => a + c.purchase_base, 0);
    out.boxes = [
      { box: 1, label: 'VAT due on sales and other outputs', value: output },
      { box: 2, label: 'VAT due on acquisitions from EU member states (Northern Ireland)', value: 0 },
      { box: 3, label: 'Total VAT due (box 1 + box 2)', value: output },
      { box: 4, label: 'VAT reclaimed on purchases and other inputs', value: input },
      { box: 5, label: 'Net VAT to pay or reclaim (box 3 − box 4)', value: output - input },
      { box: 6, label: 'Total value of sales excluding VAT', value: sales },
      { box: 7, label: 'Total value of purchases excluding VAT', value: purchases },
      { box: 8, label: 'Total value of goods supplied to EU member states (Northern Ireland)', value: 0 },
      { box: 9, label: 'Total value of goods acquired from EU member states (Northern Ireland)', value: 0 },
    ];
    out.reverse_charge_output = rcOutput;
  }
  return out;
}

/** Budget against actual for a fiscal year. p: { year } (the year the fiscal year starts in) */
function budget(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  const fyM = s.getInt('fiscal_year_start') || 1;
  const year = parseInt(p.year, 10) || Number(dates.fiscalYearStart(dates.today(), fyM).slice(0, 4));
  const start = year + '-' + (fyM < 10 ? '0' : '') + fyM + '-01';
  const end = dates.addDays(dates.addMonths(start, 12), -1);
  const cols = columnsFor(start, end, 'month');
  const accs = accountsMap(app);
  const data = cols.map((c) => sums(app, c.from, c.to));
  const u = require(`${__hooks}/lib_util.js`);
  const budgets = {};
  for (const b of app.findRecordsByFilter('budgets', 'year = {:y}', '', 0, 0, { y: year })) budgets[b.getString('account')] = u.json(b, 'months', []) || [];
  const rows = [];
  for (const id of Object.keys(accs)) {
    const a = accs[id];
    if (a.type !== 'income' && a.type !== 'expense') continue;
    const sign = a.type === 'income' ? -1 : 1;
    const actual = data.map((d) => sign * (d[id] || 0));
    const plan = cols.map((_, i) => Number((budgets[id] || [])[i] || 0));
    if (!budgets[id] && actual.every((v) => v === 0)) continue;
    const at = actual.reduce((x, y) => x + y, 0);
    const pt = plan.reduce((x, y) => x + y, 0);
    rows.push({ account: id, code: a.code, name: a.name, type: a.type, budget: plan, actual: actual, budget_total: pt, actual_total: at, variance: a.type === 'income' ? at - pt : pt - at, has_budget: !!budgets[id] });
  }
  rows.sort((x, y) => (x.code < y.code ? -1 : 1));
  return { report: 'budget', year: year, from: start, to: end, columns: cols, rows: rows, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
}

/** Net worth month by month. p: { months } */
function networth(app, p) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const n = Math.max(2, Math.min(36, parseInt(p.months, 10) || 12));
  const accs = accountsMap(app);
  const points = [];
  const t = dates.today();
  for (let i = n - 1; i >= 0; i--) {
    const end = i === 0 ? t : dates.monthEnd(dates.addMonths(dates.monthStart(t), -i));
    const all = sums(app, '1900-01-01', end);
    let assets = 0;
    let liabilities = 0;
    for (const id of Object.keys(accs)) {
      if (accs[id].type === 'asset') assets += all[id] || 0;
      if (accs[id].type === 'liability') liabilities -= all[id] || 0;
    }
    points.push({ date: end, assets: assets, liabilities: liabilities, net: assets - liabilities });
  }
  // Months before the books started carry nothing.
  while (points.length > 2 && points[0].assets === 0 && points[0].liabilities === 0) points.shift();
  return { report: 'networth', points: points, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
}

/** Where money went: expense categories and payees. p: { range|from,to } */
function spending(app, p) {
  const r = span(app, p, 'this_month');
  const accs = accountsMap(app);
  const s = sums(app, r.from, r.to);
  const cats = [];
  let total = 0;
  for (const id of Object.keys(s)) {
    const a = accs[id];
    if (!a || a.type !== 'expense' || s[id] === 0) continue;
    cats.push({ account: id, code: a.code, name: a.name, value: s[id] });
    total += s[id];
  }
  cats.sort((x, y) => y.value - x.value);
  const rows = arrayOf(new DynamicModel({ contact: '', s: 0, n: 0 }));
  app
    .db()
    .newQuery(
      "SELECT t.contact AS contact, COALESCE(SUM(p.home_amount),0) AS s, COUNT(DISTINCT t.id) AS n FROM postings p JOIN transactions t ON t.id = p.txn JOIN accounts a ON a.id = p.account WHERE p.status = 'posted' AND a.type = 'expense' AND p.date >= {:f} AND p.date <= {:t} AND t.contact != '' GROUP BY t.contact ORDER BY s DESC LIMIT 15",
    )
    .bind({ f: r.from, t: r.to })
    .all(rows);
  const payees = [];
  for (const x of rows) {
    let name = '';
    try {
      name = app.findRecordById('contacts', x.contact).getString('name');
    } catch {
      continue;
    }
    payees.push({ contact: x.contact, name: name, value: x.s, count: x.n });
  }
  return { report: 'spending', from: r.from, to: r.to, total: total, categories: cats.map((c) => Object.assign(c, { share: total ? c.value / total : 0 })), payees: payees, currency: require(`${__hooks}/lib_ledger.js`).home(app) };
}

/** The entries behind a number: an account between two dates. */
function drill(app, p) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const acc = ledger.account(app, p.account);
  const r = p.from || p.to || p.range ? span(app, p) : { from: '', to: '' };
  const reg = ledger.register(app, acc.id, { from: r.from || undefined, to: r.to || undefined, limit: p.limit || 500 });
  return { account: ledger.serializeAccount(acc), from: r.from, to: r.to, opening: reg.opening, closing: reg.closing, total: reg.total, rows: reg.rows };
}

/**
 * One-glance numbers for the title bar and the AI agent: cash, cards, what
 * customers owe, what is owed to suppliers, tax owed, what is waiting.
 */
function summary(app) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const docs = require(`${__hooks}/lib_docs.js`);
  const accs = accountsMap(app);
  const bal = ledger.balances(app, {});
  let cash = 0;
  let cards = 0;
  for (const id of Object.keys(accs)) {
    const a = accs[id];
    if (a.archived) continue;
    if (a.subtype === 'bank' || a.subtype === 'cash') cash += (bal[id] || { home: 0 }).home;
    if (a.subtype === 'card') cards -= (bal[id] || { home: 0 }).home;
  }
  const count = (sql, prm) => {
    const m = new DynamicModel({ n: 0 });
    app.db().newQuery(sql).bind(prm || {}).one(m);
    return m.n;
  };
  const tm = dates.range('this_month', 1);
  const lm = dates.range('last_month', 1);
  const pl = (rg) => {
    const s = sums(app, rg.from, rg.to);
    let inc = 0;
    let exp = 0;
    for (const id of Object.keys(s)) {
      if (!accs[id]) continue;
      if (accs[id].type === 'income') inc -= s[id];
      if (accs[id].type === 'expense') exp += s[id];
    }
    return { income: inc, expense: exp, net: inc - exp };
  };
  let taxOwed = 0;
  try {
    taxOwed = -(bal[ledger.sys(app, 'tax').id] || { home: 0 }).home;
  } catch {
    taxOwed = 0;
  }
  let uncategorized = 0;
  for (const role of ['uncat_income', 'uncat_expense', 'suspense']) {
    try {
      const a = ledger.sys(app, role);
      uncategorized += count("SELECT COUNT(*) AS n FROM postings WHERE account = {:a} AND status = 'posted'", { a: a.id });
    } catch {
      /* no such account */
    }
  }
  const s = require(`${__hooks}/lib_setup.js`).row(app);
  return {
    currency: ledger.home(app),
    cash: cash,
    cards: cards,
    receivables: docs.summary(app, 'sales'),
    payables: docs.summary(app, 'purchases'),
    tax_owed: taxOwed,
    inbox: count("SELECT COUNT(*) AS n FROM statement_lines WHERE status = 'new' OR status = 'proposed'"),
    inbox_agent: count("SELECT COUNT(*) AS n FROM statement_lines WHERE (status = 'new' OR status = 'proposed') AND agent_state IN ('waiting','working')"),
    proposed: count("SELECT COUNT(*) AS n FROM transactions WHERE status = 'proposed'"),
    files_inbox: count("SELECT COUNT(*) AS n FROM files WHERE status = 'inbox' OR status = 'reading'"),
    uncategorized: uncategorized,
    this_month: pl(tm),
    last_month: pl(lm),
    lock_date: s.getString('lock_date'),
    agent_lock_date: s.getString('agent_lock_date'),
  };
}

module.exports = { span: span, sums: sums, cashSums: cashSums, pnl: pnl, balance: balance, cashflow: cashflow, trial: trial, aged: aged, tax: tax, budget: budget, networth: networth, spending: spending, drill: drill, summary: summary, columnsFor: columnsFor };
