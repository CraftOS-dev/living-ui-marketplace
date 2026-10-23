/// <reference path="../pb_data/types.d.ts" />
/**
 * Reports, read from the ledger (whole months from the `ledger_months`
 * cache, partial months and dimension filters from the journal lines).
 *
 * Signs: every report value is in its natural direction (revenue and
 * liabilities positive when credited, assets and expenses positive when
 * debited), in integer minor units of the base currency.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function ledger() {
  return require(`${__hooks}/lib_ledger.js`);
}

function accounts(app) {
  const out = {};
  for (const a of app.findRecordsByFilter('accounts', '', 'code', 0, 0)) {
    out[a.id] = { id: a.id, code: a.getString('code'), name: a.getString('name'), type: a.getString('type'), subtype: a.getString('subtype'), system_key: a.getString('system_key') };
  }
  return out;
}

function debitNatured(type) {
  return type === 'asset' || type === 'expense';
}

function natural(acc, b) {
  if (b === undefined) return 0;
  return debitNatured(acc.type) ? b.debit - b.credit : b.credit - b.debit;
}

/** Movement per account in a range, optionally for one department or project. */
function movement(app, from, to, dims) {
  const util = u();
  const d = dims || {};
  if (!d.department && !d.project) return ledger().balances(app, from, to);
  const where = ['date >= {:f}', 'date <= {:t}'];
  const bind = { f: from === '' ? '0000-00-00' : from, t: to };
  if (d.department) {
    where.push('department = {:dep}');
    bind.dep = d.department;
  }
  if (d.project) {
    where.push('project = {:prj}');
    bind.prj = d.project;
  }
  const out = {};
  for (const r of util.rows(app, 'SELECT account, IFNULL(SUM(debit), 0) AS d, IFNULL(SUM(credit), 0) AS c FROM journal_lines WHERE ' + where.join(' AND ') + ' GROUP BY account', { account: '', d: 0, c: 0 }, bind)) {
    out[r.account] = { debit: r.d, credit: r.c };
  }
  return out;
}

function period(p) {
  const util = u();
  const today = util.today();
  const from = util.day(p, 'from', today.slice(0, 7) + '-01');
  const to = util.day(p, 'to', today);
  if (from > to) throw util.fail(400, 'from is after to.', 'invalid_param');
  return { from: from, to: to };
}

function shiftYears(day, n) {
  const util = u();
  const y = Number(day.slice(0, 4)) + n;
  const m = day.slice(5, 7);
  const end = util.monthEnd(y + '-' + m);
  const d = day.slice(8, 10);
  return y + '-' + m + '-' + (d > end.slice(8, 10) ? end.slice(8, 10) : d);
}

function dimsOf(app, p) {
  const util = u();
  const dep = core().resolveOpt(app, 'departments', util.str(p, 'department', ''));
  const prj = core().resolveOpt(app, 'projects', util.str(p, 'project', ''));
  return { department: dep ? dep.id : '', project: prj ? prj.id : '', labels: { department: dep ? dep.getString('name') : '', project: prj ? prj.getString('name') : '' } };
}

/** First day of the fiscal year that contains `day`. */
function fiscalStart(app, day) {
  const fm = core().settings(app).getInt('fiscal_start_month') || 1;
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return (m >= fm ? y : y - 1) + '-' + pad(fm) + '-01';
}

/* ================================================================== P&L */

const PNL_SECTIONS = [
  { key: 'revenue', label: 'Revenue', type: 'income', subtypes: ['revenue'] },
  { key: 'cogs', label: 'Cost of sales', type: 'expense', subtypes: ['cogs'] },
  { key: 'opex', label: 'Operating expenses', type: 'expense', subtypes: ['expense', 'payroll_expense', 'depreciation'] },
  { key: 'other_income', label: 'Other income', type: 'income', subtypes: ['other_income'] },
  { key: 'other_expense', label: 'Other expenses', type: 'expense', subtypes: ['other_expense'] },
];

function pnlColumns(p) {
  const util = u();
  const pr = period(p);
  const by = util.oneOf(p, 'by', ['total', 'month'], 'total');
  const compare = util.oneOf(p, 'compare', ['none', 'previous', 'last_year'], 'none');
  const cols = [];
  if (by === 'month') {
    for (const m of util.monthsBetween(pr.from.slice(0, 7), pr.to.slice(0, 7))) {
      const f = m === pr.from.slice(0, 7) ? pr.from : m + '-01';
      const t = m === pr.to.slice(0, 7) ? pr.to : util.monthEnd(m);
      cols.push({ key: m, label: m, from: f, to: t });
    }
  } else cols.push({ key: 'current', label: pr.from + ' to ' + pr.to, from: pr.from, to: pr.to });
  if (by === 'total' && compare === 'previous') {
    const days = util.daysBetween(pr.from, pr.to);
    const t = util.addDays(pr.from, -1);
    cols.push({ key: 'previous', label: 'Previous period', from: util.addDays(t, -days), to: t });
  }
  if (by === 'total' && compare === 'last_year') cols.push({ key: 'last_year', label: 'A year earlier', from: shiftYears(pr.from, -1), to: shiftYears(pr.to, -1) });
  return { from: pr.from, to: pr.to, columns: cols };
}

function pnlData(app, cols, dims) {
  const accs = accounts(app);
  const mvs = cols.map((c) => movement(app, c.from, c.to, dims));
  const sections = PNL_SECTIONS.map((sec) => {
    const rows = [];
    for (const id of Object.keys(accs)) {
      const a = accs[id];
      if (a.type !== sec.type || sec.subtypes.indexOf(a.subtype) < 0) continue;
      const values = mvs.map((mv) => natural(a, mv[id]));
      if (values.every((v) => v === 0)) continue;
      rows.push({ id: a.id, code: a.code, name: a.name, values: values });
    }
    rows.sort((x, y) => (x.code < y.code ? -1 : 1));
    const totals = cols.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0));
    return { key: sec.key, label: sec.label, accounts: rows, totals: totals };
  });
  const t = (k) => sections.find((s) => s.key === k).totals;
  const gross = cols.map((_, i) => t('revenue')[i] - t('cogs')[i]);
  const operating = cols.map((_, i) => gross[i] - t('opex')[i]);
  const net = cols.map((_, i) => operating[i] + t('other_income')[i] - t('other_expense')[i]);
  return { sections: sections, gross: gross, operating: operating, net: net };
}

function pnl(ctx, p) {
  const app = ctx.app;
  const c = pnlColumns(p);
  const dims = dimsOf(app, p);
  const d = pnlData(app, c.columns, dims);
  return Object.assign({ report: 'pnl', from: c.from, to: c.to, columns: c.columns, currency: core().currency(app), filters: dims.labels }, d);
}

/** Net profit (income minus expenses) over a range. */
function netIncome(app, from, to) {
  const accs = accounts(app);
  const mv = ledger().balances(app, from, to);
  let net = 0;
  for (const id of Object.keys(mv)) {
    const a = accs[id];
    if (a === undefined) continue;
    if (a.type === 'income') net += mv[id].credit - mv[id].debit;
    if (a.type === 'expense') net -= mv[id].debit - mv[id].credit;
  }
  return net;
}

/* ======================================================= balance sheet */

const BS = [
  { key: 'current_assets', label: 'Current assets', side: 'assets', type: 'asset', subtypes: ['cash', 'bank', 'receivable', 'inventory', 'current_asset', 'tax_receivable'] },
  { key: 'fixed_assets', label: 'Fixed and other assets', side: 'assets', type: 'asset', subtypes: ['fixed_asset', 'accumulated_depreciation', 'other_asset'] },
  { key: 'current_liabilities', label: 'Current liabilities', side: 'liabilities', type: 'liability', subtypes: ['payable', 'current_liability', 'tax_payable', 'payroll_liability'] },
  { key: 'long_term_liabilities', label: 'Long-term liabilities', side: 'liabilities', type: 'liability', subtypes: ['long_term_liability'] },
  { key: 'equity', label: 'Equity', side: 'equity', type: 'equity', subtypes: ['equity', 'opening_balance', 'retained_earnings'] },
];

function bsAt(app, date) {
  const util = u();
  const accs = accounts(app);
  const bal = ledger().balances(app, '', date);
  const fy = fiscalStart(app, date);
  const prior = netIncome(app, '', util.addDays(fy, -1));
  const current = netIncome(app, fy, date);
  const sections = BS.map((sec) => {
    const rows = [];
    for (const id of Object.keys(accs)) {
      const a = accs[id];
      if (a.type !== sec.type || sec.subtypes.indexOf(a.subtype) < 0) continue;
      const v = natural(a, bal[id]);
      if (v === 0) continue;
      rows.push({ id: a.id, code: a.code, name: a.name, value: v });
    }
    rows.sort((x, y) => (x.code < y.code ? -1 : 1));
    if (sec.key === 'equity') {
      if (prior !== 0) rows.push({ id: '', code: '', name: 'Earnings of earlier years', value: prior, computed: true });
      rows.push({ id: '', code: '', name: 'Current year earnings', value: current, computed: true });
    }
    return { key: sec.key, label: sec.label, side: sec.side, accounts: rows, total: rows.reduce((s, r) => s + r.value, 0) };
  });
  const sum = (side) => sections.filter((s) => s.side === side).reduce((s, x) => s + x.total, 0);
  const assets = sum('assets');
  const liabilities = sum('liabilities');
  const equity = sum('equity');
  return { date: date, sections: sections, assets: assets, liabilities: liabilities, equity: equity, balanced: assets === liabilities + equity, difference: assets - liabilities - equity, current_earnings: current, fiscal_year_start: fy };
}

function balanceSheet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const date = util.day(p, 'date', util.today());
  const compare = util.oneOf(p, 'compare', ['none', 'last_year', 'last_month'], 'none');
  const out = { report: 'balance-sheet', currency: core().currency(app), current: bsAt(app, date) };
  if (compare === 'last_year') out.compare = bsAt(app, shiftYears(date, -1));
  if (compare === 'last_month') out.compare = bsAt(app, util.addDays(date.slice(0, 7) + '-01', -1));
  return out;
}

/* ============================================================ cash flow */

function cashFlow(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = period(p);
  const accs = accounts(app);
  const mv = ledger().balances(app, pr.from, pr.to);
  const change = (pred) => {
    let v = 0;
    const rows = [];
    for (const id of Object.keys(mv)) {
      const a = accs[id];
      if (a === undefined || !pred(a)) continue;
      // Cash effect: an asset going up uses cash; a liability or equity going up brings it.
      const effect = a.type === 'asset' ? -(mv[id].debit - mv[id].credit) : mv[id].credit - mv[id].debit;
      if (effect === 0) continue;
      v += effect;
      rows.push({ id: a.id, code: a.code, name: a.name, value: effect });
    }
    rows.sort((x, y) => (x.code < y.code ? -1 : 1));
    return { total: v, rows: rows };
  };
  const net = netIncome(app, pr.from, pr.to);
  let dep = 0;
  for (const id of Object.keys(mv)) {
    const a = accs[id];
    if (a !== undefined && a.type === 'expense' && a.subtype === 'depreciation') dep += mv[id].debit - mv[id].credit;
  }
  const working = change((a) => (a.type === 'asset' && ['receivable', 'inventory', 'current_asset', 'tax_receivable'].indexOf(a.subtype) >= 0) || (a.type === 'liability' && ['payable', 'current_liability', 'tax_payable', 'payroll_liability'].indexOf(a.subtype) >= 0));
  const investing = change((a) => a.type === 'asset' && ['fixed_asset', 'other_asset'].indexOf(a.subtype) >= 0);
  const financing = change((a) => (a.type === 'liability' && a.subtype === 'long_term_liability') || a.type === 'equity');
  const operating = net + dep + working.total;
  const cashAccs = Object.keys(accs).filter((id) => accs[id].type === 'asset' && (accs[id].subtype === 'cash' || accs[id].subtype === 'bank'));
  const openBal = ledger().balances(app, '', util.addDays(pr.from, -1));
  const closeBal = ledger().balances(app, '', pr.to);
  const opening = cashAccs.reduce((s, id) => s + (openBal[id] ? openBal[id].debit - openBal[id].credit : 0), 0);
  const closing = cashAccs.reduce((s, id) => s + (closeBal[id] ? closeBal[id].debit - closeBal[id].credit : 0), 0);
  const computed = operating + investing.total + financing.total;
  return {
    report: 'cash-flow',
    from: pr.from,
    to: pr.to,
    currency: core().currency(app),
    net_income: net,
    depreciation: dep,
    working_capital: working,
    operating: operating,
    investing: investing,
    financing: financing,
    net_change: computed,
    opening_cash: opening,
    closing_cash: closing,
    actual_change: closing - opening,
    unexplained: closing - opening - computed,
  };
}

/* ======================================================== trial balance */

function trialBalance(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = period(p);
  const accs = accounts(app);
  const open = ledger().balances(app, '', util.addDays(pr.from, -1));
  const mv = ledger().balances(app, pr.from, pr.to);
  const rows = [];
  const tot = { opening_debit: 0, opening_credit: 0, debit: 0, credit: 0, closing_debit: 0, closing_credit: 0 };
  for (const id of Object.keys(accs)) {
    const a = accs[id];
    const o = open[id] || { debit: 0, credit: 0 };
    const m = mv[id] || { debit: 0, credit: 0 };
    const ob = o.debit - o.credit;
    const cb = ob + m.debit - m.credit;
    if (ob === 0 && m.debit === 0 && m.credit === 0) continue;
    const row = {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      opening_debit: ob > 0 ? ob : 0,
      opening_credit: ob < 0 ? -ob : 0,
      debit: m.debit,
      credit: m.credit,
      closing_debit: cb > 0 ? cb : 0,
      closing_credit: cb < 0 ? -cb : 0,
    };
    for (const k of Object.keys(tot)) tot[k] += row[k];
    rows.push(row);
  }
  rows.sort((x, y) => (x.code < y.code ? -1 : 1));
  return { report: 'trial-balance', from: pr.from, to: pr.to, currency: core().currency(app), accounts: rows, totals: tot, balanced: tot.debit === tot.credit && tot.closing_debit === tot.closing_credit && tot.opening_debit === tot.opening_credit };
}

function generalLedger(ctx, p) {
  const util = u();
  const app = ctx.app;
  const accRef = util.str(p, 'account', '');
  if (accRef !== '') return require(`${__hooks}/lib_accounts.js`).get(ctx, p);
  const pr = period(p);
  const pg = util.page(p, 50, 2000);
  const total = util.one(app, 'SELECT COUNT(id) AS n FROM journal_lines WHERE date >= {:f} AND date <= {:t}', { n: 0 }, { f: pr.from, t: pr.to }).n;
  const rows = util.rows(
    app,
    "SELECT jl.date AS date, a.code AS code, a.name AS account, jl.debit AS debit, jl.credit AS credit, jl.memo AS memo, IFNULL(pa.name, '') AS party, j.number AS journal, j.kind AS kind, j.source_label AS label, j.source_entity AS entity, j.source_id AS source FROM journal_lines jl JOIN accounts a ON a.id = jl.account JOIN journals j ON j.id = jl.journal LEFT JOIN parties pa ON pa.id = jl.party WHERE jl.date >= {:f} AND jl.date <= {:t} ORDER BY a.code, jl.date, j.created, jl.sort LIMIT " + pg.limit + ' OFFSET ' + pg.offset,
    { date: '', code: '', account: '', debit: 0, credit: 0, memo: '', party: '', journal: '', kind: '', label: '', entity: '', source: '' },
    { f: pr.from, t: pr.to },
  );
  return { report: 'ledger', from: pr.from, to: pr.to, currency: core().currency(app), lines: rows, total: total };
}

/* ================================================================ aging */

function aging(ctx, p) {
  const util = u();
  const app = ctx.app;
  const side = util.oneOf(p, 'side', ['receivable', 'payable'], 'receivable');
  const date = util.day(p, 'date', util.today());
  const type = side === 'receivable' ? 'invoice' : 'bill';
  const credit = side === 'receivable' ? 'credit_note' : 'supplier_credit';
  const dir = side === 'receivable' ? 'in' : 'out';
  const docs = util.rows(
    app,
    // What was settled by the day, from each side of an allocation (two indexed lookups, not an OR
    // scan); only documents still open come back, so long histories stay quick.
    'SELECT * FROM (' +
      "SELECT d.id AS id, d.type AS type, d.number AS number, d.party AS party, IFNULL(pa.name, '') AS name, d.date AS date, d.due_date AS due, d.total AS total, d.fx_e8 AS fx, d.currency AS currency, " +
      "IFNULL((SELECT SUM(a.amount) FROM allocations a WHERE a.document = d.id AND a.state = 'active' AND a.date <= {:d}), 0) + IFNULL((SELECT SUM(a.amount) FROM allocations a WHERE a.credit = d.id AND a.state = 'active' AND a.date <= {:d}), 0) AS settled " +
      "FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.type IN ({:t}, {:c}) AND (d.state = 'posted' OR (d.state = 'void' AND d.voided_at > {:ts})) AND d.date <= {:d}" +
      ') WHERE total - settled > 0',
    { id: '', type: '', number: '', party: '', name: '', date: '', due: '', total: 0, fx: 0, currency: '', settled: 0 },
    { t: type, c: credit, d: date, ts: util.dayStartTs(util.addDays(date, 1)) },
  );
  const pays = util.rows(
    app,
    "SELECT * FROM (SELECT p.id AS id, p.number AS number, p.party AS party, IFNULL(pa.name, '') AS name, p.date AS date, p.amount AS amount, p.fx_e8 AS fx, IFNULL((SELECT SUM(a.amount) FROM allocations a WHERE a.payment = p.id AND a.state = 'active' AND a.date <= {:d}), 0) AS used FROM payments p LEFT JOIN parties pa ON pa.id = p.party WHERE p.direction = {:dir} AND p.date <= {:d} AND (p.state = 'posted' OR (p.state = 'void' AND p.voided_at > {:ts}))) WHERE amount - used > 0",
    { id: '', number: '', party: '', name: '', date: '', amount: 0, fx: 0, used: 0 },
    { dir: dir, d: date, ts: util.dayStartTs(util.addDays(date, 1)) },
  );
  const parties = {};
  const row = (id, name) => {
    if (parties[id] === undefined) parties[id] = { id: id, name: name, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, credits: 0, total: 0, documents: [] };
    return parties[id];
  };
  const base = (amount, fx) => Math.round((amount * (fx || 100000000)) / 100000000);
  for (const d of docs) {
    const open = d.total - d.settled;
    if (open <= 0) continue;
    const r = row(d.party, d.name);
    const v = base(open, d.fx);
    if (d.type === credit) {
      r.credits -= v;
      r.total -= v;
      continue;
    }
    const days = d.due === '' ? 0 : util.daysBetween(d.due, date);
    const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'over90';
    r[bucket] += v;
    r.total += v;
    r.documents.push({ id: d.id, number: d.number, date: d.date, due_date: d.due, open: open, currency: d.currency, base: v, days: Math.max(0, days), bucket: bucket });
  }
  for (const p2 of pays) {
    const left = p2.amount - p2.used;
    if (left <= 0) continue;
    const r = row(p2.party, p2.name);
    const v = base(left, p2.fx);
    r.credits -= v;
    r.total -= v;
  }
  const list = Object.keys(parties)
    .map((k) => parties[k])
    .filter((r) => r.total !== 0 || r.documents.length > 0)
    .sort((a, b) => b.total - a.total);
  const totals = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, credits: 0, total: 0 };
  for (const r of list) for (const k of Object.keys(totals)) totals[k] += r[k];
  return { report: 'aging', side: side, date: date, currency: core().currency(app), parties: list, totals: totals };
}

/* ======================================================= sales, purchases */

function salesLike(ctx, p, side) {
  const util = u();
  const app = ctx.app;
  const pr = period(p);
  const by = util.oneOf(p, 'by', side === 'sales' ? ['customer', 'item', 'category', 'month'] : ['supplier', 'item', 'month'], side === 'sales' ? 'customer' : 'supplier');
  const main = side === 'sales' ? 'invoice' : 'bill';
  const back = side === 'sales' ? 'credit_note' : 'supplier_credit';
  // One pass in SQL: each group's revenue, quantity, cost (the recorded cost of goods, else
  // estimated at the current average cost) and documents.
  const sign = 'CASE WHEN d.type = {:m} THEN 1 ELSE -1 END';
  const estimate = "i.kind = 'stock' AND dl.cost_value = 0 AND IFNULL(v.qty, 0) > 0";
  const costExpr = side === 'sales' ? "SUM(CASE WHEN i.kind = 'stock' THEN (" + sign + ') * (CASE WHEN ' + estimate + ' THEN CAST(ROUND(dl.qty * v.value * 1.0 / v.qty) AS INTEGER) ELSE dl.cost_value END) ELSE 0 END)' : '0';
  const keyExpr = by === 'customer' || by === 'supplier' ? 'd.party' : by === 'item' ? 'dl.item' : by === 'category' ? "IFNULL(c.name, '')" : 'substr(d.date, 1, 7)';
  const labelExpr = by === 'customer' || by === 'supplier' ? "IFNULL(MAX(pa.name), '')" : by === 'item' ? "IFNULL(MAX(i.name), '') || ' (' || IFNULL(MAX(i.sku), '') || ')'" : "''";
  const rows = util.rows(
    app,
    'SELECT ' + keyExpr + ' AS gkey, ' + labelExpr + ' AS label, IFNULL(SUM((' + sign + ') * dl.net_base), 0) AS revenue, IFNULL(SUM((' + sign + ') * dl.qty), 0) AS qty, IFNULL(' + costExpr + ', 0) AS cost, ' +
      (side === 'sales' ? 'IFNULL(SUM(CASE WHEN ' + estimate + ' THEN 1 ELSE 0 END), 0)' : '0') +
      ' AS estimated, COUNT(DISTINCT d.id) AS documents' +
      ' FROM document_lines dl JOIN documents d ON d.id = dl.doc LEFT JOIN parties pa ON pa.id = d.party LEFT JOIN items i ON i.id = dl.item LEFT JOIN item_categories c ON c.id = i.category LEFT JOIN valuation v ON v.item = dl.item' +
      " WHERE d.type IN ({:m}, {:b}) AND d.state = 'posted' AND d.date >= {:f} AND d.date <= {:t} AND d.reference != 'Opening balance' GROUP BY " +
      keyExpr,
    { gkey: '', label: '', revenue: 0, qty: -0, cost: 0, estimated: 0, documents: 0 },
    { m: main, b: back, f: pr.from, t: pr.to },
  );
  let estimated = false;
  const list = rows
    .map((r) => {
      const raw = r.gkey;
      const key = by === 'item' ? raw || '_other' : by === 'category' ? raw || '_none' : raw;
      const label = by === 'item' ? (raw !== '' ? r.label : 'Lines without an item') : by === 'category' ? (raw !== '' ? raw : 'No category') : by === 'month' ? raw : r.label;
      const revenue = r.revenue;
      const out = { key: key, label: label, revenue: revenue, documents: r.documents };
      if (by === 'item') out.qty = util.q3(r.qty);
      if (side === 'sales') {
        const c = r.cost;
        if (r.estimated > 0) estimated = true;
        out.cost = c;
        out.margin = revenue - c;
        out.margin_pct = revenue !== 0 ? Math.round(((revenue - c) / revenue) * 1000) / 10 : 0;
      }
      return out;
    })
    .sort((a, b) => (by === 'month' ? (a.key < b.key ? -1 : 1) : b.revenue - a.revenue));
  const total = list.reduce((s, g) => s + g.revenue, 0);
  const cost = list.reduce((s, g) => s + (g.cost || 0), 0);
  return { report: side, by: by, from: pr.from, to: pr.to, currency: core().currency(app), rows: list, total: total, cost: side === 'sales' ? cost : undefined, margin: side === 'sales' ? total - cost : undefined, cost_estimated: estimated };
}

function sales(ctx, p) {
  return salesLike(ctx, p, 'sales');
}

function purchases(ctx, p) {
  return salesLike(ctx, p, 'purchases');
}

/* ============================================================ stock */

function stockValuation(ctx, p) {
  const util = u();
  const app = ctx.app;
  const whRef = util.str(p, 'warehouse', '');
  const wh = whRef !== '' ? core().resolve(app, 'warehouses', whRef) : null;
  const rows = wh === null
    ? util.rows(app, "SELECT i.id AS id, i.sku AS sku, i.name AS name, i.unit AS unit, IFNULL(c.name, '') AS category, v.qty AS qty, v.value AS value FROM valuation v JOIN items i ON i.id = v.item LEFT JOIN item_categories c ON c.id = i.category WHERE v.qty != 0 OR v.value != 0 ORDER BY i.name COLLATE NOCASE", { id: '', sku: '', name: '', unit: '', category: '', qty: -0, value: 0 })
    : util.rows(app, "SELECT i.id AS id, i.sku AS sku, i.name AS name, i.unit AS unit, IFNULL(c.name, '') AS category, s.qty AS qty, CASE WHEN v.qty > 0 THEN CAST(ROUND(s.qty * 1.0 * v.value / v.qty) AS INTEGER) ELSE 0 END AS value FROM stock s JOIN items i ON i.id = s.item JOIN valuation v ON v.item = s.item LEFT JOIN item_categories c ON c.id = i.category WHERE s.warehouse = {:w} AND s.qty != 0 ORDER BY i.name COLLATE NOCASE", { id: '', sku: '', name: '', unit: '', category: '', qty: -0, value: 0 }, { w: wh.id });
  const cur = core().currency(app);
  const money = require(`${__hooks}/lib_money.js`);
  const items = rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, unit: r.unit, category: r.category, qty: util.q3(r.qty), value: r.value, avg_cost: r.qty > 0 ? money.e4Text(money.unitCostE4(r.value, r.qty, cur), cur) : '0' }));
  const total = items.reduce((s, r) => s + r.value, 0);
  const inv = core().systemAccount(app, 'inventory');
  const book = ledger().balanceOf(app, inv.id, '9999-12-31');
  return { report: 'stock', warehouse: wh !== null ? { id: wh.id, name: wh.getString('name') } : null, currency: cur, items: items, total: total, book: wh === null ? book : null, difference: wh === null ? book - total : null };
}

/* ============================================================== tax */

function tax(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = period(p);
  const rows = util.rows(
    app,
    "SELECT d.type AS type, dl.tax AS tax, IFNULL(t.code, '') AS code, IFNULL(t.name, '') AS name, IFNULL(t.recoverable, 0) AS recoverable, IFNULL(SUM(dl.net_base), 0) AS taxable, IFNULL(SUM(dl.tax_base), 0) AS amount FROM document_lines dl JOIN documents d ON d.id = dl.doc LEFT JOIN taxes t ON t.id = dl.tax WHERE d.state = 'posted' AND d.type IN ('invoice', 'credit_note', 'bill', 'supplier_credit') AND d.date >= {:f} AND d.date <= {:t} GROUP BY d.type, dl.tax",
    { type: '', tax: '', code: '', name: '', recoverable: false, taxable: 0, amount: 0 },
    { f: pr.from, t: pr.to },
  );
  const taxes = {};
  for (const r of rows) {
    const key = r.tax || '_none';
    const t = taxes[key] || { id: r.tax, code: r.code || '', name: r.name || 'No tax', recoverable: r.recoverable, sales_taxable: 0, sales_tax: 0, purchase_taxable: 0, purchase_tax: 0 };
    const sign = r.type === 'invoice' || r.type === 'bill' ? 1 : -1;
    if (r.type === 'invoice' || r.type === 'credit_note') {
      t.sales_taxable += sign * r.taxable;
      t.sales_tax += sign * r.amount;
    } else {
      t.purchase_taxable += sign * r.taxable;
      t.purchase_tax += sign * r.amount;
    }
    taxes[key] = t;
  }
  const list = Object.keys(taxes).map((k) => taxes[k]);
  const collected = list.reduce((s, t) => s + t.sales_tax, 0);
  const claimable = list.filter((t) => t.recoverable).reduce((s, t) => s + t.purchase_tax, 0);
  // Tax booked outside documents (bank entries, manual entries, claims).
  const payable = core().systemAccount(app, 'tax_payable').id;
  const receivable = core().systemAccount(app, 'tax_receivable').id;
  const other = util.one(
    app,
    "SELECT IFNULL(SUM(CASE WHEN jl.account = {:p} THEN jl.credit - jl.debit ELSE 0 END), 0) AS out_tax, IFNULL(SUM(CASE WHEN jl.account = {:r} THEN jl.debit - jl.credit ELSE 0 END), 0) AS in_tax FROM journal_lines jl JOIN journals j ON j.id = jl.journal WHERE jl.date >= {:f} AND jl.date <= {:t} AND jl.account IN ({:p}, {:r}) AND j.kind NOT IN ('invoice', 'credit_note', 'bill', 'supplier_credit', 'reversal')",
    { out_tax: 0, in_tax: 0 },
    { p: payable, r: receivable, f: pr.from, t: pr.to },
  );
  return {
    report: 'tax',
    from: pr.from,
    to: pr.to,
    currency: core().currency(app),
    taxes: list,
    collected: collected,
    claimable: claimable,
    other_collected: other.out_tax,
    other_claimable: other.in_tax,
    net: collected + other.out_tax - claimable - other.in_tax,
  };
}

/* ============================================================ budget */

function budget(ctx, p) {
  const util = u();
  const app = ctx.app;
  const fm = core().settings(app).getInt('fiscal_start_month') || 1;
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  const thisFy = fiscalStart(app, util.today());
  const year = util.int(p, 'year', Number(thisFy.slice(0, 4)), 1970, 2100);
  const first = year + '-' + pad(fm);
  const months = util.monthsBetween(first, util.addMonths(first, 11));
  const accs = accounts(app);
  const budgets = {};
  for (const r of util.rows(app, 'SELECT account, month, amount FROM budgets WHERE month >= {:a} AND month <= {:b}', { account: '', month: '', amount: 0 }, { a: months[0], b: months[11] })) {
    budgets[r.account + '|' + r.month] = r.amount;
  }
  const actual = {};
  for (const r of util.rows(app, 'SELECT account, month, debit, credit FROM ledger_months WHERE month >= {:a} AND month <= {:b}', { account: '', month: '', debit: 0, credit: 0 }, { a: months[0], b: months[11] })) {
    actual[r.account + '|' + r.month] = { debit: r.debit, credit: r.credit };
  }
  const rows = [];
  for (const id of Object.keys(accs)) {
    const a = accs[id];
    if (a.type !== 'income' && a.type !== 'expense') continue;
    const b = months.map((m) => budgets[id + '|' + m] || 0);
    const act = months.map((m) => natural(a, actual[id + '|' + m]));
    if (b.every((x) => x === 0) && act.every((x) => x === 0)) continue;
    const tb = b.reduce((s, x) => s + x, 0);
    const ta = act.reduce((s, x) => s + x, 0);
    rows.push({ id: a.id, code: a.code, name: a.name, type: a.type, budget: b, actual: act, total_budget: tb, total_actual: ta, variance: a.type === 'income' ? ta - tb : tb - ta });
  }
  rows.sort((x, y) => (x.code < y.code ? -1 : 1));
  return { report: 'budget', year: year, months: months, currency: core().currency(app), accounts: rows };
}

/* ============================================================ export */

function exportCsv(ctx, p) {
  const util = u();
  const csv = require(`${__hooks}/lib_csv.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const cur = core().currency(ctx.app);
  const m = (v) => money.minorText(v, cur);
  const kind = util.oneOf(p, 'report', ['pnl', 'balance-sheet', 'trial-balance', 'ledger', 'aging', 'sales', 'purchases', 'stock', 'tax'], '');
  const q = Object.assign({}, p);
  delete q.report;
  let rows = [];
  if (kind === 'pnl') {
    const r = pnl(ctx, q);
    rows.push(['Section', 'Code', 'Account'].concat(r.columns.map((c) => c.label)));
    for (const s of r.sections) {
      for (const a of s.accounts) rows.push([s.label, a.code, a.name].concat(a.values.map(m)));
      rows.push([s.label, '', 'Total ' + s.label.toLowerCase()].concat(s.totals.map(m)));
    }
    rows.push(['', '', 'Gross profit'].concat(r.gross.map(m)));
    rows.push(['', '', 'Operating profit'].concat(r.operating.map(m)));
    rows.push(['', '', 'Net profit'].concat(r.net.map(m)));
  } else if (kind === 'balance-sheet') {
    const r = balanceSheet(ctx, q).current;
    rows.push(['Section', 'Code', 'Account', 'Amount']);
    for (const s of r.sections) {
      for (const a of s.accounts) rows.push([s.label, a.code, a.name, m(a.value)]);
      rows.push([s.label, '', 'Total', m(s.total)]);
    }
  } else if (kind === 'trial-balance') {
    const r = trialBalance(ctx, q);
    rows.push(['Code', 'Account', 'Opening debit', 'Opening credit', 'Debit', 'Credit', 'Closing debit', 'Closing credit']);
    for (const a of r.accounts) rows.push([a.code, a.name, m(a.opening_debit), m(a.opening_credit), m(a.debit), m(a.credit), m(a.closing_debit), m(a.closing_credit)]);
  } else if (kind === 'ledger') {
    const r = generalLedger(ctx, Object.assign({}, q, { limit: 2000 }));
    rows.push(['Date', 'Account', 'Journal', 'Source', 'Party', 'Memo', 'Debit', 'Credit']);
    for (const l of r.lines) rows.push([l.date, (l.code ? l.code + ' ' : '') + (l.account || ''), l.journal, l.label, l.party, l.memo, m(l.debit), m(l.credit)]);
  } else if (kind === 'aging') {
    const r = aging(ctx, q);
    rows.push(['Party', 'Current', '1-30', '31-60', '61-90', 'Over 90', 'Credits', 'Total']);
    for (const a of r.parties) rows.push([a.name, m(a.current), m(a.d30), m(a.d60), m(a.d90), m(a.over90), m(a.credits), m(a.total)]);
  } else if (kind === 'sales' || kind === 'purchases') {
    const r = kind === 'sales' ? sales(ctx, q) : purchases(ctx, q);
    rows.push(['Group', 'Quantity', 'Amount', 'Cost', 'Margin', 'Documents']);
    for (const g of r.rows) rows.push([g.label, g.qty === undefined ? '' : g.qty, m(g.revenue), g.cost === undefined ? '' : m(g.cost), g.margin === undefined ? '' : m(g.margin), g.documents]);
  } else if (kind === 'stock') {
    const r = stockValuation(ctx, q);
    rows.push(['SKU', 'Item', 'Category', 'Quantity', 'Unit', 'Average cost', 'Value']);
    for (const i of r.items) rows.push([i.sku, i.name, i.category, i.qty, i.unit, i.avg_cost, m(i.value)]);
  } else if (kind === 'tax') {
    const r = tax(ctx, q);
    rows.push(['Tax', 'Sales taxable', 'Tax collected', 'Purchases taxable', 'Tax paid', 'Claimable']);
    for (const t of r.taxes) rows.push([t.name, m(t.sales_taxable), m(t.sales_tax), m(t.purchase_taxable), m(t.purchase_tax), t.recoverable ? 'yes' : 'no']);
  } else throw util.fail(400, 'report is required', 'missing_param');
  return { filename: kind + '-' + util.today() + '.csv', csv: csv.toCsv(rows) };
}

module.exports = {
  accounts: accounts,
  movement: movement,
  fiscalStart: fiscalStart,
  netIncome: netIncome,
  pnl: pnl,
  balanceSheet: balanceSheet,
  bsAt: bsAt,
  cashFlow: cashFlow,
  trialBalance: trialBalance,
  generalLedger: generalLedger,
  aging: aging,
  sales: sales,
  purchases: purchases,
  stockValuation: stockValuation,
  tax: tax,
  budget: budget,
  exportCsv: exportCsv,
};
