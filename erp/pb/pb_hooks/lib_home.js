/// <reference path="../pb_data/types.d.ts" />
/**
 * Home, Needs you and search: one call each, shaped by the caller's rights.
 * A section appears only when the caller may see it and its module is on.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

function sees(ctx, module, level) {
  return auth().moduleOn(ctx.app, module) && (ctx.isAgent || auth().can(ctx, module, level || 'view'));
}

/**
 * Everyone below an employee (direct and indirect reports, ten levels) as a
 * SQL subquery on the bind `{:tm}`: used inside queries, never as a list of
 * ids in JS (an owner over 5,000 people would mean 5,000 ids pasted into SQL).
 */
const TEAM_SUB =
  "(WITH RECURSIVE t(id, depth) AS (SELECT id, 1 FROM employees WHERE manager = {:tm} AND id != {:tm} AND status != 'left' UNION SELECT e.id, t.depth + 1 FROM employees e JOIN t ON e.manager = t.id WHERE t.depth < 10 AND e.status != 'left' AND e.id != {:tm}) SELECT id FROM t)";

/** Whether an employee manages anyone (a direct report is enough). */
function hasReports(app, employeeId) {
  if (!employeeId) return false;
  return u().one(app, "SELECT COUNT(id) AS n FROM (SELECT id FROM employees WHERE manager = {:m} AND id != {:m} AND status != 'left' LIMIT 1)", { n: 0 }, { m: employeeId }).n > 0;
}

/** How many people are below an employee. */
function teamCount(app, employeeId) {
  if (!employeeId) return 0;
  return u().one(app, 'SELECT COUNT(id) AS n FROM ' + TEAM_SUB, { n: 0 }, { tm: employeeId }).n;
}

/** Overdue invoices, oldest due first. */
function overdueInvoices(app, today, limit) {
  const util = u();
  return util
    .rows(app, "SELECT d.id AS id, d.number AS number, IFNULL(pa.name, '') AS party, d.due_date AS due_date, d.balance AS balance, d.currency AS currency FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.type = 'invoice' AND d.state = 'posted' AND d.balance > 0 AND d.due_date != '' AND d.due_date < {:t} ORDER BY d.due_date LIMIT " + limit, { id: '', number: '', party: '', due_date: '', balance: 0, currency: '' }, { t: today })
    .map((r) => ({ id: r.id, number: r.number, party: r.party, due_date: r.due_date, balance: r.balance, currency: r.currency, days: util.daysBetween(r.due_date, today) }));
}

/** Bills due within a week (and late ones), soonest first; `days` until due (negative when late). */
function billsDue(app, today, limit) {
  const util = u();
  return util
    .rows(app, "SELECT d.id AS id, d.number AS number, IFNULL(pa.name, '') AS party, d.due_date AS due_date, d.balance AS balance, d.currency AS currency FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.type = 'bill' AND d.state = 'posted' AND d.balance > 0 AND d.due_date <= {:t} ORDER BY d.due_date LIMIT " + limit, { id: '', number: '', party: '', due_date: '', balance: 0, currency: '' }, { t: util.addDays(today, 7) })
    .map((r) => ({ id: r.id, number: r.number, party: r.party, due_date: r.due_date, balance: r.balance, currency: r.currency, days: util.daysBetween(today, r.due_date) }));
}

/**
 * Revenue and net profit per month from the monthly ledger cache, in one
 * query (the same figures as the profit and loss: revenue is income of the
 * revenue subtype; net is all income less all expenses).
 */
function profitByMonth(app, months) {
  const util = u();
  const out = {};
  for (const m of months) out[m] = { month: m, revenue: 0, net: 0 };
  const rows = util.rows(
    app,
    "SELECT lm.month AS month, a.type AS type, a.subtype AS subtype, IFNULL(SUM(lm.credit - lm.debit), 0) AS v FROM ledger_months lm JOIN accounts a ON a.id = lm.account WHERE a.type IN ('income', 'expense') AND lm.month >= {:f} AND lm.month <= {:t} GROUP BY lm.month, a.type, a.subtype",
    { month: '', type: '', subtype: '', v: 0 },
    { f: months[0], t: months[months.length - 1] },
  );
  for (const r of rows) {
    const o = out[r.month];
    if (o === undefined) continue;
    o.net += r.v;
    if (r.type === 'income' && r.subtype === 'revenue') o.revenue += r.v;
  }
  return months.map((m) => out[m]);
}

function inList(ids) {
  return ids.length === 0 ? "('')" : '(' + ids.map((x) => "'" + String(x).replace(/[^a-z0-9]/g, '') + "'").join(', ') + ')';
}

function bucketsFor(app, type, today) {
  const util = u();
  const b = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0, overdue: 0, count: 0 };
  for (const r of util.rows(app, "SELECT due_date, balance, fx_e8 FROM documents WHERE type = {:t} AND state = 'posted' AND balance > 0", { due_date: '', balance: 0, fx_e8: 0 }, { t: type })) {
    const v = Math.round((r.balance * (r.fx_e8 || 100000000)) / 100000000);
    const days = r.due_date === '' ? 0 : util.daysBetween(r.due_date, today);
    if (days <= 0) b.current += v;
    else if (days <= 30) b.d30 += v;
    else if (days <= 60) b.d60 += v;
    else if (days <= 90) b.d90 += v;
    else b.over90 += v;
    if (days > 0) b.overdue += v;
    b.total += v;
    b.count++;
  }
  return b;
}

function summary(ctx) {
  const util = u();
  const app = ctx.app;
  const today = util.today();
  const month = today.slice(0, 7);
  const last = util.addMonths(month, -1);
  const s = core().settings(app);
  const cur = core().currency(app);
  const out = { today: today, currency: cur, company: s.getString('company_name'), name: ctx.isAgent ? 'your AI agent' : ctx.name, sections: [] };

  // Cash.
  if (sees(ctx, 'banking')) {
    const banks = require(`${__hooks}/lib_banking.js`).list(ctx, {});
    const ids = app.findRecordsByFilter('banks', "archived = false && kind != 'card'", '', 0, 0).filter((b) => (b.getString('currency') || cur) === cur).map((b) => b.getString('account'));
    const series = [];
    if (ids.length > 0) {
      const from = util.addDays(today, -29);
      const opening = util.one(app, 'SELECT IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS b FROM journal_lines WHERE account IN ' + inList(ids) + ' AND date < {:f}', { b: 0 }, { f: from }).b;
      const byDay = {};
      for (const r of util.rows(app, 'SELECT date, IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS n FROM journal_lines WHERE account IN ' + inList(ids) + ' AND date >= {:f} GROUP BY date', { date: '', n: 0 }, { f: from })) byDay[r.date] = r.n;
      let run = opening;
      for (let i = 29; i >= 0; i--) {
        const d = util.addDays(today, -i);
        run += byDay[d] || 0;
        series.push({ date: d, balance: run });
      }
    }
    const unmatched = util.one(app, "SELECT COUNT(id) AS n FROM bank_lines WHERE status = 'unmatched'", { n: 0 }).n;
    out.cash = { total: banks.total, banks: banks.banks.slice(0, 6), series: series, unmatched: unmatched };
  }
  // Money owed to the company.
  if (sees(ctx, 'sales')) {
    out.receivables = bucketsFor(app, 'invoice', today);
    out.overdue_invoices = overdueInvoices(app, today, 6);
    const sales = (m) => util.one(app, "SELECT IFNULL(SUM(CASE WHEN d.type = 'invoice' THEN dl.net_base ELSE -dl.net_base END), 0) AS v FROM document_lines dl JOIN documents d ON d.id = dl.doc WHERE d.type IN ('invoice', 'credit_note') AND d.state = 'posted' AND d.date >= {:f} AND d.date <= {:t}", { v: 0 }, { f: m + '-01', t: util.monthEnd(m) }).v;
    const byDay = {};
    for (const r of util.rows(app, "SELECT d.date AS date, IFNULL(SUM(CASE WHEN d.type = 'invoice' THEN dl.net_base ELSE -dl.net_base END), 0) AS v FROM document_lines dl JOIN documents d ON d.id = dl.doc WHERE d.type IN ('invoice', 'credit_note') AND d.state = 'posted' AND d.date >= {:f} AND d.date <= {:t} GROUP BY d.date", { date: '', v: 0 }, { f: month + '-01', t: today })) byDay[r.date] = r.v;
    const days = [];
    const end = Number(util.monthEnd(month).slice(8, 10));
    for (let i = 1; i <= end; i++) {
      const d = month + '-' + (i < 10 ? '0' + i : i);
      days.push({ date: d, value: byDay[d] || 0, future: d > today });
    }
    // Last month by the same day, for a fair comparison.
    const sameDay = util.addMonths(month, -1) + '-' + today.slice(8, 10);
    const lastToDate = util.one(app, "SELECT IFNULL(SUM(CASE WHEN d.type = 'invoice' THEN dl.net_base ELSE -dl.net_base END), 0) AS v FROM document_lines dl JOIN documents d ON d.id = dl.doc WHERE d.type IN ('invoice', 'credit_note') AND d.state = 'posted' AND d.date >= {:f} AND d.date <= {:t}", { v: 0 }, { f: last + '-01', t: sameDay > util.monthEnd(last) ? util.monthEnd(last) : sameDay }).v;
    out.sales = { this_month: sales(month), last_month: sales(last), last_month_to_date: lastToDate, days: days };
    out.top_customers = util.rows(app, "SELECT d.party AS id, IFNULL(pa.name, '') AS name, IFNULL(SUM(CASE WHEN d.type = 'invoice' THEN d.total_base - 0 ELSE -d.total_base END), 0) AS value FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.type IN ('invoice', 'credit_note') AND d.state = 'posted' AND d.date >= {:f} GROUP BY d.party ORDER BY value DESC LIMIT 5", { id: '', name: '', value: 0 }, { f: util.addMonths(month, -2) + '-01' });
    out.orders_to_deliver = util.one(app, "SELECT COUNT(id) AS n, IFNULL(SUM(total_base), 0) AS v FROM documents WHERE type = 'sales_order' AND state = 'open' AND fulfil_status != 'full'", { n: 0, v: 0 });
    out.quotes_open = util.one(app, "SELECT COUNT(id) AS n, IFNULL(SUM(total_base), 0) AS v FROM documents WHERE type = 'quote' AND state = 'open' AND (valid_until = '' OR valid_until >= {:t})", { n: 0, v: 0 }, { t: today });
  }
  // Money the company owes.
  if (sees(ctx, 'purchasing')) {
    out.payables = bucketsFor(app, 'bill', today);
    out.bills_due = billsDue(app, today, 6);
    out.orders_to_receive = util.one(app, "SELECT COUNT(id) AS n, IFNULL(SUM(total_base), 0) AS v FROM documents WHERE type = 'purchase_order' AND state = 'open' AND fulfil_status != 'full'", { n: 0, v: 0 });
  }
  // Profit.
  if (sees(ctx, 'accounting') || sees(ctx, 'reports')) {
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(util.addMonths(month, -i));
    const pm = profitByMonth(app, months);
    const cur2 = pm[pm.length - 1];
    const prev = pm[pm.length - 2];
    out.profit = { revenue: cur2.revenue, expenses: cur2.revenue - cur2.net, net: cur2.net, last_net: prev.net, months: pm };
  }
  // Stock.
  if (sees(ctx, 'inventory')) {
    const items = require(`${__hooks}/lib_items.js`).list(ctx, { limit: 6, status: 'reorder', sort: 'on_hand', desc: false });
    out.stock = { value: util.one(app, 'SELECT IFNULL(SUM(value), 0) AS v FROM valuation', { v: 0 }).v, counts: items.counts, reorder: items.items };
  }
  if (sees(ctx, 'manufacturing')) out.builds = util.one(app, "SELECT COUNT(id) AS n FROM builds WHERE status = 'draft'", { n: 0 }).n;
  // Projects.
  if (sees(ctx, 'projects')) {
    out.projects = {
      active: util.one(app, "SELECT COUNT(id) AS n FROM projects WHERE status = 'active'", { n: 0 }).n,
      hours_this_month: util.one(app, 'SELECT IFNULL(SUM(hours), 0) AS h FROM timesheets WHERE date >= {:f}', { h: -0 }, { f: month + '-01' }).h,
    };
  }
  // Me.
  if (ctx.employeeId !== '') {
    const emp = util.byId(app, 'employees', ctx.employeeId);
    const year = today.slice(0, 4);
    const types = app.findRecordsByFilter('leave_types', 'archived = false && days_per_year > 0', 'sort,name', 3, 0);
    const leave = types.map((t) => {
      const taken = util.one(app, "SELECT IFNULL(SUM(days), 0) AS d FROM leave_requests WHERE employee = {:e} AND type = {:t} AND status = 'approved' AND substr(\"from\", 1, 4) = {:y}", { d: -0 }, { e: ctx.employeeId, t: t.id, y: year }).d;
      const pending = util.one(app, "SELECT IFNULL(SUM(days), 0) AS d FROM leave_requests WHERE employee = {:e} AND type = {:t} AND status = 'submitted' AND substr(\"from\", 1, 4) = {:y}", { d: -0 }, { e: ctx.employeeId, t: t.id, y: year }).d;
      const adj = util.one(app, 'SELECT IFNULL(SUM(days), 0) AS d FROM leave_adjustments WHERE employee = {:e} AND type = {:t} AND year = {:y}', { d: -0 }, { e: ctx.employeeId, t: t.id, y: Number(year) }).d;
      const entitled = t.getFloat('days_per_year') + adj;
      return { type: t.getString('name'), icon: t.getString('icon'), entitled: entitled, taken: taken, pending: pending, remaining: entitled - taken - pending };
    });
    const monday = util.addDays(today, -(util.weekday(today) - 1));
    out.me = {
      employee: emp !== null ? { id: emp.id, name: emp.getString('name'), job_title: emp.getString('job_title') } : null,
      leave: leave,
      upcoming_leave: util.rows(app, "SELECT lr.id AS id, IFNULL(lt.name, '') AS type, lr.\"from\" AS start, lr.\"to\" AS end, lr.days AS days, lr.status AS status FROM leave_requests lr LEFT JOIN leave_types lt ON lt.id = lr.type WHERE lr.employee = {:e} AND lr.\"to\" >= {:t} AND lr.status IN ('submitted', 'approved') ORDER BY lr.\"from\" LIMIT 3", { id: '', type: '', start: '', end: '', days: -0, status: '' }, { e: ctx.employeeId, t: today }),
      claims: util.rows(app, "SELECT status, COUNT(id) AS n, IFNULL(SUM(total), 0) AS v FROM expense_claims WHERE employee = {:e} AND status IN ('draft', 'submitted', 'approved', 'posted') GROUP BY status", { status: '', n: 0, v: 0 }, { e: ctx.employeeId }),
      hours_this_week: util.one(app, 'SELECT IFNULL(SUM(hours), 0) AS h FROM timesheets WHERE employee = {:e} AND date >= {:m} AND date <= {:t}', { h: -0 }, { e: ctx.employeeId, m: monday, t: util.addDays(monday, 6) }).h,
      next_holiday: util.one(app, "SELECT date, name FROM holidays WHERE date >= {:t} ORDER BY date LIMIT 1", { date: '', name: '' }, { t: today }),
      latest_payslip: util.one(app, "SELECT ps.id AS id, pr.month AS month, ps.net AS net FROM payslips ps JOIN payroll_runs pr ON pr.id = ps.run WHERE ps.employee = {:e} AND pr.status IN ('posted', 'paid') ORDER BY pr.month DESC LIMIT 1", { id: '', month: '', net: 0 }, { e: ctx.employeeId }),
      team: teamCount(app, ctx.employeeId),
    };
  }
  // Your AI agent.
  const agentToday = util.one(app, "SELECT COUNT(id) AS n FROM audit WHERE actor = 'agent' AND created >= {:t}", { n: 0 }, { t: util.dayStartTs(today) }).n;
  out.agent = {
    today: agentToday,
    proposals: require(`${__hooks}/lib_agent.js`).list(ctx, { limit: 5 }).total,
    inbox: util.one(app, "SELECT COUNT(id) AS n FROM inbox WHERE status IN ('waiting', 'reading')", { n: 0 }).n,
    recent: util.rows(app, "SELECT kind, entity, ref, label, summary, created FROM audit WHERE actor = 'agent' AND NOT (kind = 'propose' AND entity != 'proposals') ORDER BY created DESC LIMIT 5", { kind: '', entity: '', ref: '', label: '', summary: '', created: '' }),
  };
  out.needs = needCounts(ctx);
  // Setup checklist, until the basics exist.
  if (ctx.admin) {
    const has = (sql) => util.one(app, sql, { n: 0 }).n > 0;
    const steps = [
      { key: 'company', label: 'Company details', done: s.getString('address') !== '' || s.getString('tax_id') !== '', page: 'settings' },
      { key: 'banks', label: 'Bank accounts', done: has("SELECT COUNT(id) AS n FROM banks WHERE account_number != ''") || has('SELECT COUNT(id) AS n FROM bank_lines'), page: 'banking' },
      { key: 'parties', label: 'Customers and suppliers', done: has('SELECT COUNT(id) AS n FROM parties'), page: 'customers' },
      { key: 'items', label: 'Products and services', done: has('SELECT COUNT(id) AS n FROM items'), page: 'items' },
      { key: 'opening', label: 'Opening balances', done: has("SELECT COUNT(id) AS n FROM journals WHERE kind = 'opening'"), page: 'opening' },
      { key: 'people', label: 'Invite your team', done: has("SELECT COUNT(id) AS n FROM members WHERE status != 'disabled'") && util.one(app, 'SELECT COUNT(id) AS n FROM members', { n: 0 }).n > 1, page: 'members' },
    ];
    if (steps.some((x) => !x.done)) out.setup = steps;
  }
  return out;
}

/** How much waits on the caller, by kind (badges and the Home strip). */
function needCounts(ctx) {
  const util = u();
  const app = ctx.app;
  const today = util.today();
  const out = { proposals: 0, leave: 0, claims: 0, timesheets: 0, overdue: 0, bills_due: 0, bank: 0, inbox_failed: 0, agent_drafts: 0, total: 0 };
  out.proposals = require(`${__hooks}/lib_agent.js`).list(ctx, { limit: 1 }).total;
  const hr = auth().can(ctx, 'people', 'full') && auth().moduleOn(app, 'people');
  const pm = auth().can(ctx, 'projects', 'full');
  const manager = (!hr || !pm) && hasReports(app, ctx.employeeId);
  const tm = { tm: ctx.employeeId || '-' };
  if (auth().moduleOn(app, 'people') && (hr || manager)) {
    out.leave = util.one(app, "SELECT COUNT(id) AS n FROM leave_requests WHERE status = 'submitted'" + (hr ? '' : ' AND employee IN ' + TEAM_SUB), { n: 0 }, tm).n;
    out.claims = util.one(app, "SELECT COUNT(id) AS n FROM expense_claims WHERE status = 'submitted'" + (hr ? '' : ' AND employee IN ' + TEAM_SUB), { n: 0 }, tm).n;
  }
  if (auth().moduleOn(app, 'projects') && (pm || manager)) {
    out.timesheets = util.one(app, "SELECT COUNT(DISTINCT employee) AS n FROM timesheets WHERE status = 'submitted'" + (pm ? '' : ' AND employee IN ' + TEAM_SUB), { n: 0 }, tm).n;
  }
  if (sees(ctx, 'sales')) out.overdue = util.one(app, "SELECT COUNT(id) AS n FROM documents WHERE type = 'invoice' AND state = 'posted' AND balance > 0 AND due_date != '' AND due_date < {:t}", { n: 0 }, { t: today }).n;
  if (sees(ctx, 'purchasing')) out.bills_due = util.one(app, "SELECT COUNT(id) AS n FROM documents WHERE type = 'bill' AND state = 'posted' AND balance > 0 AND due_date <= {:t}", { n: 0 }, { t: util.addDays(today, 7) }).n;
  if (sees(ctx, 'banking')) out.bank = util.one(app, "SELECT COUNT(id) AS n FROM bank_lines WHERE status = 'unmatched'", { n: 0 }).n;
  out.inbox_failed = util.one(app, "SELECT COUNT(id) AS n FROM inbox WHERE status = 'failed'" + (ctx.admin || auth().can(ctx, 'accounting', 'view') ? '' : " AND added_by = '" + String(ctx.memberId).replace(/[^a-z0-9]/g, '') + "'"), { n: 0 }).n;
  if (sees(ctx, 'sales', 'edit') || sees(ctx, 'purchasing', 'edit')) out.agent_drafts = util.one(app, "SELECT COUNT(id) AS n FROM documents WHERE state = 'draft' AND prepared_actor = 'agent'", { n: 0 }).n;
  // Actionable now: decisions and approvals (overdue and due items inform, they are counted apart).
  out.total = out.proposals + out.leave + out.claims + out.timesheets + out.inbox_failed + out.agent_drafts;
  return out;
}

/** Needs you: the lists behind the counts. */
function needs(ctx) {
  const util = u();
  const app = ctx.app;
  const today = util.today();
  const out = { counts: needCounts(ctx) };
  out.proposals = require(`${__hooks}/lib_agent.js`).list(ctx, { limit: 50 }).proposals;
  const hr = auth().can(ctx, 'people', 'full');
  const pm = auth().can(ctx, 'projects', 'full');
  const manager = (!hr || !pm) && hasReports(app, ctx.employeeId);
  const me = { me: ctx.employeeId || '-', tm: ctx.employeeId || '-' };
  if (auth().moduleOn(app, 'people') && (hr || manager)) {
    const scope = hr ? '' : ' AND lr.employee IN ' + TEAM_SUB;
    out.leave = util.rows(app, "SELECT lr.id AS id, IFNULL(e.name, '') AS employee, IFNULL(lt.name, '') AS type, lr.\"from\" AS start, lr.\"to\" AS end, lr.days AS days, lr.reason AS reason, lr.created AS created FROM leave_requests lr LEFT JOIN employees e ON e.id = lr.employee LEFT JOIN leave_types lt ON lt.id = lr.type WHERE lr.status = 'submitted' AND lr.employee != {:me}" + scope + ' ORDER BY lr."from" LIMIT 100', { id: '', employee: '', type: '', start: '', end: '', days: -0, reason: '', created: '' }, me);
    const cscope = hr ? '' : ' AND c.employee IN ' + TEAM_SUB;
    out.claims = util.rows(app, "SELECT c.id AS id, c.number AS number, IFNULL(e.name, '') AS employee, c.title AS title, c.date AS date, c.total AS total FROM expense_claims c LEFT JOIN employees e ON e.id = c.employee WHERE c.status = 'submitted' AND c.employee != {:me}" + cscope + ' ORDER BY c.date LIMIT 100', { id: '', number: '', employee: '', title: '', date: '', total: 0 }, me);
  }
  if ((auth().can(ctx, 'accounting', 'full') || auth().can(ctx, 'people', 'full')) && auth().moduleOn(app, 'people')) {
    out.claims_to_post = util.rows(app, "SELECT c.id AS id, c.number AS number, IFNULL(e.name, '') AS employee, c.title AS title, c.total AS total FROM expense_claims c LEFT JOIN employees e ON e.id = c.employee WHERE c.status = 'approved' ORDER BY c.date LIMIT 100", { id: '', number: '', employee: '', title: '', total: 0 });
  }
  if (auth().can(ctx, 'banking', 'full') && auth().moduleOn(app, 'people')) {
    out.claims_to_pay = util.rows(app, "SELECT c.id AS id, c.number AS number, IFNULL(e.name, '') AS employee, c.title AS title, c.total AS total FROM expense_claims c LEFT JOIN employees e ON e.id = c.employee WHERE c.status = 'posted' ORDER BY c.date LIMIT 100", { id: '', number: '', employee: '', title: '', total: 0 });
  }
  if (auth().moduleOn(app, 'projects') && (pm || manager)) {
    const tscope = pm ? '' : ' AND t.employee IN ' + TEAM_SUB;
    out.timesheets = util.rows(app, "SELECT t.employee AS employee_id, IFNULL(e.name, '') AS employee, MIN(t.date) AS start, MAX(t.date) AS end, IFNULL(SUM(t.hours), 0) AS hours, COUNT(t.id) AS entries FROM timesheets t LEFT JOIN employees e ON e.id = t.employee WHERE t.status = 'submitted' AND t.employee != {:me}" + tscope + ' GROUP BY t.employee ORDER BY start LIMIT 100', { employee_id: '', employee: '', start: '', end: '', hours: -0, entries: 0 }, me);
  }
  if (sees(ctx, 'sales')) out.overdue = overdueInvoices(app, today, 50);
  if (sees(ctx, 'purchasing')) out.bills_due = billsDue(app, today, 50);
  if (sees(ctx, 'banking')) out.bank = util.rows(app, "SELECT b.id AS id, b.name AS name, COUNT(bl.id) AS n, IFNULL(SUM(bl.amount), 0) AS net FROM bank_lines bl JOIN banks b ON b.id = bl.bank WHERE bl.status = 'unmatched' GROUP BY b.id ORDER BY n DESC", { id: '', name: '', n: 0, net: 0 });
  if (sees(ctx, 'sales', 'edit') || sees(ctx, 'purchasing', 'edit')) {
    out.agent_drafts = util.rows(app, "SELECT d.id AS id, d.type AS type, d.number AS number, IFNULL(pa.name, '') AS party, d.total AS total, d.currency AS currency, d.agent_note AS note, d.created AS created FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.state = 'draft' AND d.prepared_actor = 'agent' ORDER BY d.created DESC LIMIT 50", { id: '', type: '', number: '', party: '', total: 0, currency: '', note: '', created: '' });
  }
  out.inbox_failed = require(`${__hooks}/lib_agent.js`).inboxList(ctx, { status: 'failed', limit: 50 }).files;
  return out;
}

/** Search everything the caller may see. */
function search(ctx, p) {
  const util = u();
  const app = ctx.app;
  const q = util.req(p, 'q');
  const limit = util.int(p, 'limit', 5, 1, 20);
  const like = util.like(q);
  const out = [];
  const add = (kind, rows) => {
    for (const r of rows) out.push(Object.assign({ kind: kind }, r));
  };
  const types = [];
  for (const t of ['quote', 'sales_order', 'delivery', 'invoice', 'credit_note']) if (sees(ctx, t === 'delivery' ? 'sales' : 'sales') || (t === 'delivery' && sees(ctx, 'inventory'))) types.push(t);
  for (const t of ['purchase_order', 'goods_receipt', 'bill', 'supplier_credit']) if (sees(ctx, 'purchasing') || (t === 'goods_receipt' && sees(ctx, 'inventory'))) types.push(t);
  if (types.length > 0) {
    add(
      'document',
      util.rows(
        app,
        "SELECT d.id AS id, d.type AS type, d.number AS title, IFNULL(pa.name, '') AS subtitle, d.total AS amount, d.currency AS currency, d.state AS state FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.type IN (" + types.map((t) => "'" + t + "'").join(', ') + ") AND (d.number LIKE {:q} ESCAPE '\\' OR d.reference LIKE {:q} ESCAPE '\\' OR pa.name LIKE {:q} ESCAPE '\\') ORDER BY (LOWER(d.number) = LOWER({:raw})) DESC, d.date DESC LIMIT " + limit * 2,
        { id: '', type: '', title: '', subtitle: '', amount: 0, currency: '', state: '' },
        { q: like, raw: q },
      ),
    );
  }
  if (sees(ctx, 'sales') || sees(ctx, 'purchasing')) {
    add('party', util.rows(app, "SELECT id, name AS title, code AS subtitle, is_customer, is_supplier FROM parties WHERE archived = FALSE AND (name LIKE {:q} ESCAPE '\\' OR code LIKE {:q} ESCAPE '\\' OR email LIKE {:q} ESCAPE '\\') ORDER BY name COLLATE NOCASE LIMIT " + limit, { id: '', title: '', subtitle: '', is_customer: false, is_supplier: false }, { q: like }));
  }
  if (sees(ctx, 'inventory') || sees(ctx, 'sales') || sees(ctx, 'purchasing')) {
    add('item', util.rows(app, "SELECT id, name AS title, sku AS subtitle, kind FROM items WHERE archived = FALSE AND (name LIKE {:q} ESCAPE '\\' OR sku LIKE {:q} ESCAPE '\\' OR barcode = {:raw}) ORDER BY name COLLATE NOCASE LIMIT " + limit, { id: '', title: '', subtitle: '', kind: '' }, { q: like, raw: q }));
  }
  if (auth().moduleOn(app, 'people')) {
    add('employee', util.rows(app, "SELECT id, name AS title, job_title AS subtitle, number FROM employees WHERE status != 'left' AND (name LIKE {:q} ESCAPE '\\' OR number LIKE {:q} ESCAPE '\\' OR email LIKE {:q} ESCAPE '\\' OR job_title LIKE {:q} ESCAPE '\\') ORDER BY name COLLATE NOCASE LIMIT " + limit, { id: '', title: '', subtitle: '', number: '' }, { q: like }));
  }
  if (sees(ctx, 'projects')) {
    add('project', util.rows(app, "SELECT id, name AS title, code AS subtitle, status FROM projects WHERE name LIKE {:q} ESCAPE '\\' OR code LIKE {:q} ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT " + limit, { id: '', title: '', subtitle: '', status: '' }, { q: like }));
  }
  if (sees(ctx, 'accounting')) {
    add('account', util.rows(app, "SELECT id, name AS title, code AS subtitle, type FROM accounts WHERE archived = FALSE AND (name LIKE {:q} ESCAPE '\\' OR code LIKE {:q} ESCAPE '\\') ORDER BY code LIMIT " + limit, { id: '', title: '', subtitle: '', type: '' }, { q: like }));
    add('journal', util.rows(app, "SELECT id, number AS title, memo AS subtitle, kind FROM journals WHERE number LIKE {:q} ESCAPE '\\' ORDER BY date DESC LIMIT " + limit, { id: '', title: '', subtitle: '', kind: '' }, { q: like }));
  }
  if (sees(ctx, 'banking') || sees(ctx, 'sales') || sees(ctx, 'purchasing')) {
    add('payment', util.rows(app, "SELECT p.id AS id, p.number AS title, IFNULL(pa.name, '') AS subtitle, p.direction AS direction, p.amount AS amount, p.currency AS currency FROM payments p LEFT JOIN parties pa ON pa.id = p.party WHERE p.number LIKE {:q} ESCAPE '\\' OR p.reference LIKE {:q} ESCAPE '\\' ORDER BY p.date DESC LIMIT " + limit, { id: '', title: '', subtitle: '', direction: '', amount: 0, currency: '' }, { q: like }));
  }
  return { q: q, results: out };
}

module.exports = { hasReports: hasReports, teamCount: teamCount, summary: summary, needCounts: needCounts, needs: needs, search: search };
