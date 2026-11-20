/**
 * Reports with money: payroll cost of locked runs by month, pay against the
 * grade ranges, and leave liability (days for everyone with the report,
 * money only with pay access). Amounts are minor units; reporting-currency
 * figures use the kernel exchange rates of the day (a group without a rate
 * is left out of the totals and listed in `missing_fx`).
 */
let _m = {};
function L(n) {
  if (_m[n] === undefined) _m[n] = require(`${__hooks}/${n}.js`);
  return _m[n];
}
const u = () => L('lib_util');
const R = () => L('lib_reports');

/* ----------------------------------------------------------------- cost */

/** Gross pay, employer costs and net of locked and paid runs by pay month, in the reporting currency, with headcount. */
function cost(ctx, p) {
  const util = u();
  const r = R();
  const app = ctx.app;
  r.needPay(ctx);
  const f = r.filters(ctx, p, { span: 12, maxMonths: 36 });
  // Without a last day the period runs to the end of this month: a locked run paying later this month counts.
  if (!util.has(p, 'to') || util.str(p, 'to', '') === '') f.to = r.monthEnd(f.to.slice(0, 7));
  const names = r.namer(app);
  const bind = { a: f.from, b: f.to };
  let where = "pr.status IN ('locked', 'paid') AND s.status IN ('locked', 'published') AND s.pay_date >= {:a} AND s.pay_date <= {:b}" + r.entityWhere(f, bind, 's.entity');
  let join = '';
  if (f.departments.length > 0 || f.location !== '') {
    join = ' LEFT JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = s.employment AND j2.effective_from <= s.pay_date ORDER BY j2.effective_from DESC LIMIT 1)';
    if (f.departments.length > 0) where += ' AND ' + r.listWhere(f.departments, bind, 'j.department', 'dp');
    if (f.location !== '') {
      bind.loc = f.location;
      where += ' AND j.location = {:loc}';
    }
  }
  const groups = util.rows(
    app,
    'SELECT substr(s.pay_date, 1, 7) AS month, s.entity AS entity, s.currency AS currency, ' +
      'CAST(COALESCE(SUM(s.gross_minor), 0) AS INTEGER) AS gross, CAST(COALESCE(SUM(s.employer_minor), 0) AS INTEGER) AS employer, CAST(COALESCE(SUM(s.net_minor), 0) AS INTEGER) AS net, ' +
      'CAST(COALESCE(SUM(s.deductions_minor), 0) AS INTEGER) AS deductions, CAST(COALESCE(SUM(s.reimbursement_minor), 0) AS INTEGER) AS reimb, COUNT(DISTINCT s.employee) AS people, COUNT(DISTINCT s.payrun) AS runs ' +
      'FROM payslips s JOIN payruns pr ON pr.id = s.payrun' +
      join +
      ' WHERE ' +
      where +
      ' GROUP BY substr(s.pay_date, 1, 7), s.entity, s.currency ORDER BY month',
    { month: '', entity: '', currency: '', gross: 0, employer: 0, net: 0, deductions: 0, reimb: 0, people: 0, runs: 0 },
    bind,
  );
  const months = r.monthsBetween(f.from, f.to);
  const byMonth = {};
  for (const mk of months) byMonth[mk] = { month: mk, gross_minor: 0, employer_minor: 0, net_minor: 0, deductions_minor: 0, cost_minor: 0, people: 0, headcount: 0 };
  const missing = [];
  const rows = [];
  const byEntity = {};
  for (const g of groups) {
    const day = r.monthEnd(g.month);
    const conv = (v) => r.toReporting(app, v, g.currency, f.currency, day);
    const gross = conv(g.gross);
    const employer = conv(g.employer);
    const net = conv(g.net);
    const ded = conv(g.deductions);
    const row = { month: g.month, entity: names.entity(g.entity), currency: g.currency, people: g.people, runs: g.runs, gross_minor: g.gross, employer_minor: g.employer, net_minor: g.net, gross_rep_minor: gross, employer_rep_minor: employer, cost_rep_minor: gross === null || employer === null ? null : gross + employer };
    rows.push(row);
    if (gross === null || employer === null || net === null || ded === null) {
      missing.push({ month: g.month, entity: names.entity(g.entity), currency: g.currency });
      continue;
    }
    const m = byMonth[g.month];
    if (m === undefined) continue;
    m.gross_minor += gross;
    m.employer_minor += employer;
    m.net_minor += net;
    m.deductions_minor += ded;
    m.cost_minor += gross + employer;
    m.people += g.people;
    const e = (byEntity[g.entity] = byEntity[g.entity] || { entity: g.entity, name: names.entity(g.entity), currency: g.currency, gross_minor: 0, employer_minor: 0, cost_rep_minor: 0 });
    e.gross_minor += g.gross;
    e.employer_minor += g.employer;
    e.cost_rep_minor += gross + employer;
  }
  for (const mk of months) {
    const end = r.monthEnd(mk) > f.today ? f.today : r.monthEnd(mk);
    byMonth[mk].headcount = r.headcountOf(r.population(app, f, end));
  }
  const series = months.map((mk) => byMonth[mk]);
  const paid = series.filter((x) => x.cost_minor > 0);
  const last = paid.length > 0 ? paid[paid.length - 1] : null;
  const prev = paid.length > 1 ? paid[paid.length - 2] : null;
  const total = series.reduce((a, x) => a + x.cost_minor, 0);
  return {
    filters: r.shown(f),
    currency: f.currency,
    months: series,
    entities: Object.keys(byEntity).map((k) => byEntity[k]),
    missing_fx: missing,
    readouts: {
      total_cost_minor: total,
      total_gross_minor: series.reduce((a, x) => a + x.gross_minor, 0),
      total_employer_minor: series.reduce((a, x) => a + x.employer_minor, 0),
      last_month: last ? last.month : '',
      last_cost_minor: last ? last.cost_minor : 0,
      change_pct: last && prev ? r.pct(last.cost_minor - prev.cost_minor, prev.cost_minor) : null,
      cost_per_head_minor: last && last.people > 0 ? Math.round(last.cost_minor / last.people) : 0,
    },
    table: r.table(
      [
        { key: 'month', label: 'Month', kind: 'month' },
        { key: 'entity', label: 'Entity', kind: 'text' },
        { key: 'runs', label: 'Runs', kind: 'number' },
        { key: 'people', label: 'People paid', kind: 'number' },
        { key: 'currency', label: 'Pay currency', kind: 'text' },
        { key: 'gross_minor', label: 'Gross', kind: 'money', currency_key: 'currency' },
        { key: 'employer_minor', label: 'Employer costs', kind: 'money', currency_key: 'currency' },
        { key: 'net_minor', label: 'Net', kind: 'money', currency_key: 'currency' },
        { key: 'cost_rep_minor', label: 'Cost (' + f.currency + ')', kind: 'money', currency: f.currency },
      ],
      rows,
    ),
  };
}

/* ---------------------------------------------------------- comp bands */

const PER_YEAR = { year: 1, month: 12, week: 52 };

/**
 * Hours and days a week of a person's work schedule (the job record's, else
 * the entity default, as lib_calendar resolves it), read once per schedule;
 * 40 and 5 when there is none (flagged). `x` is a population row.
 */
function weekResolver(app) {
  const util = u();
  const ents = {};
  const scheds = {};
  return (x) => {
    if (ents[x.entity] === undefined) {
      const e = util.byId(app, 'entities', x.entity);
      ents[x.entity] = e ? e.getString('default_schedule') : '';
    }
    const id = x.schedule !== '' ? x.schedule : ents[x.entity];
    if (scheds[id] === undefined) {
      const s = id !== '' ? util.byId(app, 'work_schedules', id) : null;
      const week = s ? util.jsonOf(s, 'week', []) || [] : [];
      const days = week.filter((w) => w && w.start && w.end).length;
      const hours = s ? s.getFloat('hours_per_week') : 0;
      scheds[id] = { hours: hours > 0 ? hours : 40, days: days > 0 ? days : 5, assumed: !(hours > 0 && days > 0) };
    }
    return scheds[id];
  };
}

/** Yearly pay (minor units) of a pay record, scaled to full time; null when unknown. `week` is weekResolver(app)(x). */
function annualOf(pay, week, fte) {
  if (pay === null) return null;
  let year = 0;
  let assumed = false;
  if (PER_YEAR[pay.per] !== undefined) year = pay.amount_minor * PER_YEAR[pay.per];
  else {
    assumed = week.assumed;
    year = pay.amount_minor * (pay.per === 'day' ? week.days : week.hours) * 52;
  }
  const full = fte > 0 && pay.basis === 'salary' ? year / fte : year;
  return { minor: Math.round(full), assumed: assumed };
}

const PAY_SHAPE = { employment: '', basis: '', amount_minor: 0, currency: '', per: '' };

/** The pay record in effect on a day for many employments at once. */
function payOn(app, ids, day) {
  const out = {};
  if (ids.length === 0) return out;
  const bind = { d: day };
  const rows = u().rows(
    app,
    'SELECT p.employment AS employment, p.basis AS basis, p.amount_minor AS amount_minor, p.currency AS currency, p.per AS per FROM pay_records p WHERE p.id = (SELECT p2.id FROM pay_records p2 WHERE p2.employment = p.employment AND p2.effective_from <= {:d} ORDER BY p2.effective_from DESC LIMIT 1) AND ' + R().listWhere(ids, bind, 'p.employment', 'pe'),
    PAY_SHAPE,
    bind,
  );
  for (const r of rows) out[r.employment] = r;
  return out;
}

/** Pay of each graded person against their grade range (yearly, full time) on a day. */
function compBands(ctx, p) {
  const util = u();
  const r = R();
  const app = ctx.app;
  r.needPay(ctx);
  const f = r.filters(ctx, p, { span: 0 });
  const day = f.to;
  const names = r.namer(app);
  const pop = r.population(app, f, day);
  const grades = {};
  for (const g of util.rows(app, "SELECT id, code, name, COALESCE(currency, '') AS currency, CAST(COALESCE(pay_min_minor, 0) AS INTEGER) AS lo, CAST(COALESCE(pay_max_minor, 0) AS INTEGER) AS hi, CAST(COALESCE(sort, 0) AS INTEGER) AS sort FROM grades WHERE archived = FALSE ORDER BY sort, code", { id: '', code: '', name: '', currency: '', lo: 0, hi: 0, sort: 0 })) {
    grades[g.id] = { grade: g.id, code: g.code, name: g.name, currency: g.currency, min_minor: g.lo, max_minor: g.hi, mid_minor: Math.round((g.lo + g.hi) / 2), people: 0, below: 0, inside: 0, above: 0, no_pay: 0, compa: [], has_range: g.hi > 0 && g.currency !== '' };
  }
  const pays = payOn(
    app,
    pop.map((x) => x.employment),
    day,
  );
  const weekOf = weekResolver(app);
  const people = [];
  let ungraded = 0;
  const missing = [];
  for (const x of pop) {
    const g = grades[x.grade];
    if (g === undefined) {
      ungraded++;
      continue;
    }
    g.people++;
    const pay = pays[x.employment] || null;
    const ann = annualOf(pay, weekOf(x), x.fte_milli / 1000);
    const row = { number: x.number, name: x.name, title: x.title, entity: names.entity(x.entity), department: names.department(x.department), grade: g.code, grade_name: g.name, pay_currency: pay ? pay.currency : '', annual_pay_minor: ann ? ann.minor : null, currency: g.currency, annual_minor: null, min_minor: g.min_minor, max_minor: g.max_minor, position: '', compa: null, range_pct: null, assumed_hours: ann ? ann.assumed : false };
    if (ann === null) {
      g.no_pay++;
      row.position = 'no_pay';
      people.push(row);
      continue;
    }
    const inGrade = g.has_range ? r.toReporting(app, ann.minor, pay.currency, g.currency, day) : null;
    if (g.has_range && inGrade === null) missing.push({ name: x.name, from: pay.currency, to: g.currency });
    row.annual_minor = inGrade;
    if (inGrade !== null) {
      row.position = inGrade < g.min_minor ? 'below' : inGrade > g.max_minor ? 'above' : 'inside';
      g[row.position]++;
      row.compa = g.mid_minor > 0 ? Math.round((inGrade / g.mid_minor) * 100) / 100 : null;
      row.range_pct = g.max_minor > g.min_minor ? Math.round(((inGrade - g.min_minor) / (g.max_minor - g.min_minor)) * 1000) / 10 : null;
      if (row.compa !== null) g.compa.push(row.compa);
    } else row.position = g.has_range ? 'no_rate' : 'no_range';
    people.push(row);
  }
  const list = Object.keys(grades)
    .map((k) => grades[k])
    .filter((g) => g.people > 0)
    .map((g) => {
      const c = g.compa;
      delete g.compa;
      return Object.assign(g, { compa_avg: c.length ? Math.round((c.reduce((a, b) => a + b, 0) / c.length) * 100) / 100 : null });
    });
  const inside = list.reduce((a, g) => a + g.inside, 0);
  const placed = list.reduce((a, g) => a + g.inside + g.below + g.above, 0);
  people.sort((a, b) => (a.grade < b.grade ? -1 : a.grade > b.grade ? 1 : (b.range_pct || 0) - (a.range_pct || 0)));
  return {
    filters: r.shown(f),
    day: day,
    grades: list,
    people: people,
    missing_fx: missing,
    readouts: { graded: placed, ungraded: ungraded, inside_pct: r.pct(inside, placed), below: list.reduce((a, g) => a + g.below, 0), above: list.reduce((a, g) => a + g.above, 0) },
    table: r.table(
      [
        { key: 'number', label: 'Number', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'grade', label: 'Grade', kind: 'text' },
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'department', label: 'Department', kind: 'text' },
        { key: 'annual_minor', label: 'Yearly pay', kind: 'money', currency_key: 'currency' },
        { key: 'min_minor', label: 'Minimum', kind: 'money', currency_key: 'currency' },
        { key: 'max_minor', label: 'Maximum', kind: 'money', currency_key: 'currency' },
        { key: 'compa', label: 'Compa-ratio', kind: 'number' },
        { key: 'position', label: 'Position', kind: 'enum' },
      ],
      people,
    ),
  };
}

/* ------------------------------------------------------ leave liability */

/** Leave owed on a day: balance per person and type in days (hours for hour types), and its value at the daily (hourly) rate with pay access. */
function leaveLiability(ctx, p) {
  const util = u();
  const r = R();
  const app = ctx.app;
  const auth = L('lib_auth');
  if (!ctx.isAgent && !auth.can(ctx, 'reports', 'view') && !auth.can(ctx, 'leave', 'view')) throw util.fail(403, 'Leave liability needs view access to Reports or Leave.', 'not_permitted');
  const f = r.filters(ctx, p, { span: 0 });
  const basis = util.oneOf(p, 'basis', ['payout', 'paid'], 'payout');
  const money = r.seesPay(ctx);
  const day = f.to;
  const names = r.namer(app);
  const pop = r.population(app, f, day);
  // Balances of everyone on the day, counted once for the company (lib_reports_cache), kept to the filters here.
  const bal = L('lib_reports_cache').balancesOn(app, day, util.bool(p, 'fresh', false));
  const pays = money
    ? payOn(
        app,
        pop.map((x) => x.employment),
        day,
      )
    : {};
  const weekOf = weekResolver(app);
  const rows = [];
  const byType = {};
  const byGroup = {};
  const missing = [];
  let days = 0;
  let hours = 0;
  let value = 0;
  for (const x of pop) {
    for (const v of bal.rows[x.employment] || []) {
      if (basis === 'payout' && v.x !== true) continue;
      const t = { id: v.t, code: v.c, name: v.n, unit: v.u };
      const b = { balance: v.b };
      const amount = Math.round(b.balance * 100) / 100;
      let rate = null;
      let worth = null;
      let worthRep = null;
      let cur = '';
      if (money) {
        const pay = pays[x.employment] || null;
        if (pay !== null) {
          cur = pay.currency;
          const w = weekOf(x);
          const year = PER_YEAR[pay.per] !== undefined ? pay.amount_minor * PER_YEAR[pay.per] : pay.amount_minor * (pay.per === 'day' ? w.days : w.hours) * 52;
          rate = Math.round(t.unit === 'hour' ? year / (w.hours * 52) : year / (w.days * 52));
          worth = Math.round(rate * amount);
          worthRep = r.toReporting(app, worth, cur, f.currency, day);
          if (worthRep === null) missing.push({ name: x.name, from: cur, to: f.currency });
        }
      }
      if (t.unit === 'hour') hours += amount;
      else days += amount;
      if (worthRep !== null) value += worthRep;
      const tk = t.code + ':' + t.unit;
      const tt = (byType[tk] = byType[tk] || { type: t.code, name: t.name, unit: t.unit, amount: 0, value_minor: 0, people: 0 });
      tt.amount += amount;
      tt.people++;
      if (worthRep !== null) tt.value_minor += worthRep;
      const gk = x.department;
      const gg = (byGroup[gk] = byGroup[gk] || { key: gk, label: names.department(gk) || 'Not set', days: 0, hours: 0, value_minor: 0 });
      if (t.unit === 'hour') gg.hours += amount;
      else gg.days += amount;
      if (worthRep !== null) gg.value_minor += worthRep;
      const row = { number: x.number, name: x.name, entity: names.entity(x.entity), department: names.department(x.department), type: t.name, unit: t.unit, balance: amount };
      if (money) Object.assign(row, { rate_minor: rate, value_minor: worth, currency: cur, value_rep_minor: worthRep });
      rows.push(row);
    }
  }
  const round2 = (v) => Math.round(v * 100) / 100;
  const cols = [
    { key: 'number', label: 'Number', kind: 'text' },
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'entity', label: 'Entity', kind: 'text' },
    { key: 'department', label: 'Department', kind: 'text' },
    { key: 'type', label: 'Leave type', kind: 'text' },
    { key: 'unit', label: 'Unit', kind: 'enum' },
    { key: 'balance', label: 'Balance', kind: 'number' },
  ];
  if (money) cols.push({ key: 'rate_minor', label: 'Rate', kind: 'money', currency_key: 'currency' }, { key: 'value_minor', label: 'Value', kind: 'money', currency_key: 'currency' }, { key: 'value_rep_minor', label: 'Value (' + f.currency + ')', kind: 'money', currency: f.currency });
  return {
    filters: r.shown(f),
    counted_at: bal.computed_at,
    day: day,
    basis: basis,
    money: money,
    currency: f.currency,
    readouts: { days: round2(days), hours: round2(hours), value_minor: money ? value : null, people: Object.keys(rows.reduce((a, x) => ((a[x.number] = true), a), {})).length },
    types: Object.keys(byType).map((k) => Object.assign(byType[k], { amount: round2(byType[k].amount), value_minor: money ? byType[k].value_minor : null })),
    groups: Object.keys(byGroup)
      .map((k) => Object.assign(byGroup[k], { days: round2(byGroup[k].days), hours: round2(byGroup[k].hours), value_minor: money ? byGroup[k].value_minor : null }))
      .sort((a, b) => b.days + b.hours / 8 - (a.days + a.hours / 8)),
    missing_fx: missing,
    table: r.table(
      cols,
      rows.sort((a, b) => b.balance - a.balance),
    ),
  };
}

module.exports = { cost: cost, compBands: compBands, leaveLiability: leaveLiability, payOn: payOn, annualOf: annualOf, weekResolver: weekResolver };
