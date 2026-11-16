/// <reference path="../pb_data/types.d.ts" />
/**
 * Payroll reports from locked and paid runs: the payroll register, cost by
 * entity, department or cost centre in the reporting currency (FX at the
 * pay date), statutory remittance by payee, year to date per employee, and
 * headcount with average pay by month. Every sum is COALESCE and CAST.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const LOCKED = "r.status IN ('locked','paid') AND s.status != 'void'";

function range(p, today) {
  const u = L('lib_util');
  const to = u.day(p, 'to', today);
  const from = u.day(p, 'from', to.slice(0, 4) + '-01-01');
  if (from > to) throw u.fail(400, 'from is after to.', 'invalid_param', { param: 'from' });
  return { from: from, to: to };
}

function scopeSql(ids, prefix) {
  const bind = {};
  const marks = ids.map((id, i) => {
    bind[prefix + i] = id;
    return '{:' + prefix + i + '}';
  });
  return { sql: marks.length ? marks.join(',') : "''", bind: bind };
}

function jobOn(app, employmentId, day, cache) {
  const key = employmentId + '|' + day;
  if (cache[key] !== undefined) return cache[key];
  const u = L('lib_util');
  const j = u.one(app, 'SELECT department, cost_center FROM job_records WHERE employment = {:e} AND effective_from <= {:d} ORDER BY effective_from DESC LIMIT 1', { department: '', cost_center: '' }, { e: employmentId, d: day });
  cache[key] = j || { department: '', cost_center: '' };
  return cache[key];
}

function labelOf(app, collection, id, cache) {
  if (!id) return '';
  const key = collection + '|' + id;
  if (cache[key] !== undefined) return cache[key];
  try {
    const r = app.findRecordById(collection, id);
    cache[key] = collection === 'cost_centers' && r.getString('code') !== '' ? r.getString('code') + ' ' + r.getString('name') : r.getString('name') || r.getString('code');
  } catch {
    cache[key] = '';
  }
  return cache[key];
}

/* ---------------------------------------------------------------- ops */

/** The payroll register: one row per payslip (a run, or locked runs between two pay dates). */
function register(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  po.gatePay(ctx);
  let where;
  const bind = {};
  let run = null;
  if (u.str(p, 'payrun', '') !== '') {
    run = po.runRec(ctx, p.payrun);
    where = 's.payrun = {:run} AND s.status != \'void\'';
    bind.run = run.id;
  } else {
    const ids = po.entityIds(ctx, p.entity);
    const rg = range(p, u.today(ctx.app));
    const sc = scopeSql(ids, 'e');
    Object.assign(bind, sc.bind, { f: rg.from, t: rg.to });
    where = 'r.entity IN (' + sc.sql + ') AND ' + LOCKED + ' AND s.pay_date >= {:f} AND s.pay_date <= {:t}';
  }
  const pg = u.page(p, 500, 5000);
  const rows = u.rows(ctx.app,
    'SELECT s.id AS id, s.employment AS employment, s.employee AS employee, r.number AS run, r.entity AS entity, s.pay_date AS pay_date, s.period_end AS period_end, s.currency AS currency, s.gross_minor AS gross, s.pre_minor AS pre, s.statutory_minor AS statutory, s.post_minor AS post, s.deductions_minor AS deductions, s.employer_minor AS employer, s.reimbursement_minor AS reimbursement, s.net_minor AS net, s.pay_method AS method ' +
      'FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE ' + where + ' ORDER BY s.pay_date, r.number, s.employee LIMIT ' + pg.limit + ' OFFSET ' + pg.offset,
    { id: '', employment: '', employee: '', run: '', entity: '', pay_date: '', period_end: '', currency: '', gross: 0, pre: 0, statutory: 0, post: 0, deductions: 0, employer: 0, reimbursement: 0, net: 0, method: '' }, bind);
  const cache = {};
  const out = rows.map((r) => {
    const emp = u.byId(ctx.app, 'employees', r.employee);
    const job = jobOn(ctx.app, r.employment, r.period_end, cache);
    return {
      payslip: r.id, run: r.run, pay_date: r.pay_date, employee_number: emp ? emp.getString('number') : '', name: emp ? L('lib_people').displayName(emp) : '', entity_name: labelOf(ctx.app, 'entities', r.entity, cache),
      department: labelOf(ctx.app, 'departments', job.department, cache), cost_center: labelOf(ctx.app, 'cost_centers', job.cost_center, cache), currency: r.currency, method: r.method,
      gross_minor: r.gross, pre_minor: r.pre, statutory_minor: r.statutory, post_minor: r.post, deductions_minor: r.deductions, employer_minor: r.employer, reimbursement_minor: r.reimbursement, net_minor: r.net,
    };
  });
  const totals = {};
  for (const r of out) {
    const t = totals[r.currency] || (totals[r.currency] = { currency: r.currency, people: 0, gross_minor: 0, pre_minor: 0, statutory_minor: 0, post_minor: 0, deductions_minor: 0, employer_minor: 0, reimbursement_minor: 0, net_minor: 0 });
    t.people += 1;
    for (const k of ['gross_minor', 'pre_minor', 'statutory_minor', 'post_minor', 'deductions_minor', 'employer_minor', 'reimbursement_minor', 'net_minor']) t[k] += r[k];
  }
  return { rows: out, totals: Object.keys(totals).map((k) => totals[k]), run: run ? po.runView(ctx.app, run) : null };
}

/** Employer cost by entity, department or cost centre in the reporting currency, with a month series. */
function cost(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  po.gatePay(ctx);
  const ids = po.entityIds(ctx, p.entity);
  const rg = range(p, u.today(ctx.app));
  const by = u.oneOf(p, 'group', ['entity', 'department', 'cost_center'], 'department');
  const reporting = L('lib_settings').row(ctx.app).getString('reporting_currency') || 'USD';
  const sc = scopeSql(ids, 'e');
  const rows = u.rows(ctx.app,
    'SELECT s.employment AS employment, r.entity AS entity, s.pay_date AS pay_date, s.period_end AS period_end, s.currency AS currency, s.gross_minor AS gross, s.employer_minor AS employer, s.reimbursement_minor AS reimbursement FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE r.entity IN (' + sc.sql + ') AND ' + LOCKED + ' AND s.pay_date >= {:f} AND s.pay_date <= {:t}',
    { employment: '', entity: '', pay_date: '', period_end: '', currency: '', gross: 0, employer: 0, reimbursement: 0 }, Object.assign({ f: rg.from, t: rg.to }, sc.bind));
  const cache = {};
  const groups = {};
  const months = {};
  const missing = {};
  const conv = (minor, cur, day) => (cur === reporting ? minor : L('lib_fx').convert(ctx.app, minor, cur, reporting, day));
  for (const r of rows) {
    const gross = conv(r.gross, r.currency, r.pay_date);
    const er = conv(r.employer, r.currency, r.pay_date);
    const re = conv(r.reimbursement, r.currency, r.pay_date);
    if (gross === null || er === null || re === null) {
      // no rate for that day: the payslip stays out of the totals, and the answer says which
      missing[r.currency + ' ' + r.pay_date.slice(0, 7)] = true;
      continue;
    }
    let key = r.entity;
    let label = labelOf(ctx.app, 'entities', r.entity, cache);
    if (by !== 'entity') {
      const job = jobOn(ctx.app, r.employment, r.period_end, cache);
      key = by === 'department' ? job.department : job.cost_center;
      label = key ? labelOf(ctx.app, by === 'department' ? 'departments' : 'cost_centers', key, cache) : by === 'department' ? 'No department' : 'No cost centre';
    }
    const g = groups[key] || (groups[key] = { key: key, label: label, people: {}, gross_minor: 0, employer_minor: 0, reimbursement_minor: 0, cost_minor: 0 });
    g.people[r.employment] = true;
    g.gross_minor += gross;
    g.employer_minor += er;
    g.reimbursement_minor += re;
    g.cost_minor += gross + er + re;
    const m = r.pay_date.slice(0, 7);
    months[m] = (months[m] || 0) + gross + er + re;
  }
  const list = Object.keys(groups).map((k) => {
    const g = groups[k];
    return { key: g.key, label: g.label, people: Object.keys(g.people).length, gross_minor: g.gross_minor, employer_minor: g.employer_minor, reimbursement_minor: g.reimbursement_minor, cost_minor: g.cost_minor };
  }).sort((a, b) => b.cost_minor - a.cost_minor);
  let total = 0;
  for (const g of list) total += g.cost_minor;
  return { group: by, currency: reporting, from: rg.from, to: rg.to, groups: list, total_minor: total, months: Object.keys(months).sort().map((m) => ({ month: m, cost_minor: months[m] })), missing_fx: Object.keys(missing) };
}

/** What is owed to each authority or fund: statutory deductions and employer lines by payee, filing and month. */
function remittance(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  po.gatePay(ctx);
  const ids = po.entityIds(ctx, p.entity);
  const rg = range(p, u.today(ctx.app));
  const sc = scopeSql(ids, 'e');
  const rows = u.rows(ctx.app,
    "SELECT r.entity AS entity, l.payee AS payee, l.filing AS filing, l.kind AS kind, l.code AS code, MAX(l.name) AS name, substr(s.pay_date, 1, 7) AS month, s.currency AS currency, CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS amount " +
      'FROM payslip_lines l JOIN payslips s ON s.id = l.payslip JOIN payruns r ON r.id = l.payrun WHERE r.entity IN (' + sc.sql + ') AND ' + LOCKED + " AND s.pay_date >= {:f} AND s.pay_date <= {:t} AND l.payee != '' AND l.kind IN ('deduction','employer') " +
      'GROUP BY r.entity, l.payee, l.filing, l.kind, l.code, month, s.currency ORDER BY l.payee, l.filing, l.code, month',
    { entity: '', payee: '', filing: '', kind: '', code: '', name: '', month: '', currency: '', amount: 0 }, Object.assign({ f: rg.from, t: rg.to }, sc.bind));
  const cache = {};
  const payees = {};
  const months = {};
  for (const r of rows) {
    const key = r.entity + '|' + r.payee + '|' + r.currency;
    const pe = payees[key] || (payees[key] = { entity: r.entity, entity_name: labelOf(ctx.app, 'entities', r.entity, cache), payee: r.payee, currency: r.currency, employee_minor: 0, employer_minor: 0, total_minor: 0, filings: {}, codes: {}, months: {} });
    if (r.kind === 'employer') pe.employer_minor += r.amount;
    else pe.employee_minor += r.amount;
    pe.total_minor += r.amount;
    if (r.filing) pe.filings[r.filing] = true;
    const c = pe.codes[r.code] || (pe.codes[r.code] = { code: r.code, name: r.name, kind: r.kind, amount_minor: 0 });
    c.amount_minor += r.amount;
    pe.months[r.month] = (pe.months[r.month] || 0) + r.amount;
    months[r.month] = true;
  }
  return {
    from: rg.from, to: rg.to, months: Object.keys(months).sort(),
    payees: Object.keys(payees).map((k) => {
      const pe = payees[k];
      return Object.assign({}, pe, { filings: Object.keys(pe.filings), codes: Object.keys(pe.codes).map((c) => pe.codes[c]) });
    }),
  };
}

/** Year to date per employee for the entity's tax year (from the country's main pack). */
function ytd(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  po.gatePay(ctx);
  const entity = po.entityRec(ctx, p.entity);
  const today = u.today(ctx.app, entity.id);
  const start = taxStartOf(ctx.app, entity);
  let year = u.str(p, 'year', '') !== '' ? u.int(p, 'year', 2026, 2000, 2100) : Number(today.slice(0, 4));
  if (u.str(p, 'year', '') === '' && today.slice(5) < start) year -= 1;
  const docs = L('lib_payroll_docs');
  const rg = docs.yearRange({ year_start: start }, year);
  const rows = u.rows(ctx.app,
    'SELECT s.employment AS employment, s.employee AS employee, COUNT(*) AS slips, CAST(COALESCE(SUM(s.gross_minor),0) AS INTEGER) AS gross, CAST(COALESCE(SUM(s.pre_minor),0) AS INTEGER) AS pre, CAST(COALESCE(SUM(s.statutory_minor),0) AS INTEGER) AS statutory, CAST(COALESCE(SUM(s.post_minor),0) AS INTEGER) AS post, CAST(COALESCE(SUM(s.employer_minor),0) AS INTEGER) AS employer, CAST(COALESCE(SUM(s.reimbursement_minor),0) AS INTEGER) AS reimbursement, CAST(COALESCE(SUM(s.net_minor),0) AS INTEGER) AS net ' +
      'FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE r.entity = {:e} AND ' + LOCKED + ' AND s.pay_date >= {:f} AND s.pay_date <= {:t} GROUP BY s.employment, s.employee',
    { employment: '', employee: '', slips: 0, gross: 0, pre: 0, statutory: 0, post: 0, employer: 0, reimbursement: 0, net: 0 }, { e: entity.id, f: rg.start, t: rg.end });
  const codes = u.rows(ctx.app,
    "SELECT l.employment AS employment, l.code AS code, CAST(COALESCE(SUM(l.amount_minor),0) AS INTEGER) AS amount FROM payslip_lines l JOIN payslips s ON s.id = l.payslip JOIN payruns r ON r.id = l.payrun WHERE r.entity = {:e} AND " + LOCKED + " AND s.pay_date >= {:f} AND s.pay_date <= {:t} AND l.stage = 'statutory' GROUP BY l.employment, l.code",
    { employment: '', code: '', amount: 0 }, { e: entity.id, f: rg.start, t: rg.end });
  const byEmp = {};
  const codeSet = {};
  for (const c of codes) {
    (byEmp[c.employment] = byEmp[c.employment] || {})[c.code] = c.amount;
    codeSet[c.code] = true;
  }
  const out = rows.map((r) => {
    const emp = u.byId(ctx.app, 'employees', r.employee);
    return { employment: r.employment, employee_number: emp ? emp.getString('number') : '', name: emp ? L('lib_people').displayName(emp) : '', slips: r.slips, gross_minor: r.gross, pre_minor: r.pre, statutory_minor: r.statutory, post_minor: r.post, employer_minor: r.employer, reimbursement_minor: r.reimbursement, net_minor: r.net, by_code: byEmp[r.employment] || {} };
  }).sort((a, b) => a.employee_number.localeCompare(b.employee_number));
  return { entity: entity.id, entity_name: entity.getString('name'), currency: entity.getString('currency'), year: year, label: rg.label, from: rg.start, to: rg.end, codes: Object.keys(codeSet).sort(), rows: out };
}

function taxStartOf(app, entity) {
  const c = L('lib_payroll_out').countryOf(entity);
  const main = ((c && c.packs) || [])[0];
  if (main) {
    const r = L('lib_util').findMany(app, 'rule_packs', 'code = {:c}', '-effective_from', 1, { c: main });
    if (r.length > 0) {
      const b = L('lib_util').jsonOf(r[0], 'body', {}) || {};
      if (b.tax_year && b.tax_year.start) return b.tax_year.start;
    }
  }
  return '01-01';
}

/** People paid and average pay by month (reporting currency). */
function headcount(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  po.gatePay(ctx);
  const ids = po.entityIds(ctx, p.entity);
  const today = u.today(ctx.app);
  const rg = range(Object.assign({ from: u.dayAdd(today, -365) }, p), today);
  const reporting = L('lib_settings').row(ctx.app).getString('reporting_currency') || 'USD';
  const sc = scopeSql(ids, 'e');
  const rows = u.rows(ctx.app,
    'SELECT substr(s.pay_date, 1, 7) AS month, s.currency AS currency, COUNT(DISTINCT s.employment) AS people, CAST(COALESCE(SUM(s.gross_minor),0) AS INTEGER) AS gross, CAST(COALESCE(SUM(s.net_minor),0) AS INTEGER) AS net, MAX(s.pay_date) AS day ' +
      "FROM payslips s JOIN payruns r ON r.id = s.payrun WHERE r.entity IN (" + sc.sql + ') AND ' + LOCKED + " AND r.kind IN ('regular','termination') AND s.pay_date >= {:f} AND s.pay_date <= {:t} GROUP BY month, s.currency ORDER BY month",
    { month: '', currency: '', people: 0, gross: 0, net: 0, day: '' }, Object.assign({ f: rg.from, t: rg.to }, sc.bind));
  const months = {};
  const missing = {};
  for (const r of rows) {
    const m = months[r.month] || (months[r.month] = { month: r.month, people: 0, gross_minor: 0, net_minor: 0 });
    const conv = (v) => (r.currency === reporting ? v : L('lib_fx').convert(ctx.app, v, r.currency, reporting, r.day));
    const g = conv(r.gross);
    const n = conv(r.net);
    if (g === null || n === null) {
      // without a rate the month's averages would be wrong: leave these people out and say so
      missing[r.currency + ' ' + r.month] = true;
      continue;
    }
    m.people += r.people;
    m.gross_minor += g;
    m.net_minor += n;
  }
  const list = Object.keys(months).sort().map((k) => {
    const m = months[k];
    return Object.assign(m, { avg_gross_minor: m.people ? Math.round(m.gross_minor / m.people) : 0, avg_net_minor: m.people ? Math.round(m.net_minor / m.people) : 0 });
  });
  return { currency: reporting, from: rg.from, to: rg.to, months: list, missing_fx: Object.keys(missing) };
}

module.exports = { register: register, cost: cost, remittance: remittance, ytd: ytd, headcount: headcount };
