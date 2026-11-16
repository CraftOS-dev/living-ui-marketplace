/**
 * Reports (home-reports module): the shared machinery and the people
 * analytics (headcount, joiners and leavers with turnover, tenure, span of
 * control, diversity). Pay reports live in lib_reports_pay.js, time, hiring
 * and training in lib_reports_ops.js.
 *
 * Every report is a read: SQL over the collections with COALESCE and CAST on
 * aggregates, never a sealed value. Each answers `filters` (what it was run
 * with), a chart-ready block and `table` ({ columns, rows }) that
 * reports.export turns into CSV. Filters: entity, department (with its
 * sub-departments), location, from and to (days), currency (reporting
 * currency for money, converted with the kernel exchange rates).
 */
let _m = {};
function L(n) {
  if (_m[n] === undefined) _m[n] = require(`${__hooks}/${n}.js`);
  return _m[n];
}
const u = () => L('lib_util');

/* ------------------------------------------------------------- filters */

/** The month keys 'YYYY-MM' from the month of `from` to the month of `to`. */
function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(y + '-' + (m < 10 ? '0' + m : String(m)));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 240) break;
  }
  return out;
}

function monthStart(key) {
  return key + '-01';
}

function monthEnd(key) {
  return u().monthEnd(key + '-01');
}

/** Ids of a department and every department under it. */
function deptTree(app, root) {
  const all = u().rows(app, 'SELECT id, COALESCE(parent, \'\') AS parent FROM departments', { id: '', parent: '' });
  const kids = {};
  for (const d of all) (kids[d.parent] = kids[d.parent] || []).push(d.id);
  const out = [root];
  for (let i = 0; i < out.length && out.length < 2000; i++) for (const k of kids[out[i]] || []) out.push(k);
  return out;
}

/**
 * Parse the common filters. `span` is the default period in months ending
 * today (12), `maxMonths` caps it. Entities outside the caller's scope are
 * refused; with no entity the caller's scope applies.
 */
function filters(ctx, p, opts) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const o = opts || {};
  const today = util.today(app);
  const f = { today: today, entity: '', entity_name: '', department: '', department_name: '', location: '', location_name: '', from: '', to: '', currency: '', entities: [], departments: [] };
  const eref = util.str(p, 'entity', '');
  if (eref !== '') {
    const e = util.byIdOrName(app, 'entities', eref, 'name', 'entities.list');
    if (!auth.inScope(ctx, e.id)) throw util.fail(403, 'That entity is outside what you may see.', 'not_permitted');
    f.entity = e.id;
    f.entity_name = e.getString('name');
    f.entities = [e.id];
  } else f.entities = auth.scope(ctx).slice();
  const dref = util.str(p, 'department', '');
  if (dref !== '') {
    const d = util.byIdOrName(app, 'departments', dref, 'name', 'departments.list');
    f.department = d.id;
    f.department_name = d.getString('name');
    f.departments = deptTree(app, d.id);
  }
  const lref = util.str(p, 'location', '');
  if (lref !== '') {
    const l = util.byIdOrName(app, 'locations', lref, 'name', 'locations.list');
    f.location = l.id;
    f.location_name = l.getString('name');
  }
  const span = o.span === undefined ? 12 : o.span;
  f.to = util.day(p, 'to', today);
  f.from = util.day(p, 'from', span > 0 ? util.addMonths(f.to.slice(0, 7) + '-01', -(span - 1)) : f.to);
  if (f.from > f.to) throw util.fail(400, 'from is after to.', 'invalid_param', { param: 'from' });
  if (o.maxMonths && monthsBetween(f.from, f.to).length > o.maxMonths) throw util.fail(400, 'Choose at most ' + o.maxMonths + ' months.', 'invalid_param', { param: 'from' });
  const s = L('lib_settings').row(app);
  f.currency = util.str(p, 'currency', '').toUpperCase() || s.getString('reporting_currency') || firstCurrency(app);
  if (!/^[A-Z]{3}$/.test(f.currency)) throw util.fail(400, 'currency must be a three-letter code, e.g. USD.', 'invalid_param', { param: 'currency' });
  return f;
}

function firstCurrency(app) {
  const r = u().one(app, 'SELECT currency FROM entities WHERE active = TRUE ORDER BY created LIMIT 1', { currency: '' });
  return r ? r.currency : 'USD';
}

/** The filters as the answer shows them. */
function shown(f) {
  return { entity: f.entity, entity_name: f.entity_name, department: f.department, department_name: f.department_name, location: f.location, location_name: f.location_name, from: f.from, to: f.to, currency: f.currency };
}

/** "m.entity IN (...)" for the filter's entities ('' when all). */
function entityWhere(f, bind, col) {
  if (f.entities.length === 0) return '';
  return ' AND ' + col + ' IN (' + f.entities.map((id, i) => ((bind['en' + i] = id), '{:en' + i + '}')).join(',') + ')';
}

function listWhere(ids, bind, col, key) {
  return col + ' IN (' + ids.map((id, i) => ((bind[key + i] = id), '{:' + key + i + '}')).join(',') + ')';
}

/* ---------------------------------------------------------- population */

const JOB_ON = "LEFT JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= {:d} ORDER BY j2.effective_from DESC LIMIT 1)";
const POP_SHAPE = { employment: '', employee: '', entity: '', number: '', start_day: '', end_day: '', status: '', department: '', location: '', manager: '', grade: '', job_title: '', title: '', employment_type: '', schedule: '', fte_milli: 0, name: '', gender: '', birth_date: '', nationality: '' };

/**
 * Employments in work on `day` (started, not ended) with their job record of
 * that day, inside the filters. One row per employment.
 */
function population(app, f, day) {
  const bind = { d: day };
  let where = "m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d})" + entityWhere(f, bind, 'm.entity');
  if (f.departments.length > 0) where += ' AND ' + listWhere(f.departments, bind, 'j.department', 'dp');
  if (f.location !== '') {
    bind.loc = f.location;
    where += ' AND j.location = {:loc}';
  }
  return u().rows(
    app,
    'SELECT m.id AS employment, m.employee AS employee, m.entity AS entity, m.number AS number, m.start_day AS start_day, m.end_day AS end_day, m.status AS status, ' +
      "COALESCE(j.department, '') AS department, COALESCE(j.location, '') AS location, COALESCE(j.manager, '') AS manager, COALESCE(j.grade, '') AS grade, COALESCE(j.job_title, '') AS job_title, COALESCE(j.title, '') AS title, COALESCE(j.employment_type, '') AS employment_type, COALESCE(j.schedule, '') AS schedule, CAST(ROUND(COALESCE(j.fte, 1) * 1000) AS INTEGER) AS fte_milli, " +
      "COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name, COALESCE(e.gender, '') AS gender, COALESCE(e.birth_date, '') AS birth_date, COALESCE(e.nationality, '') AS nationality " +
      'FROM employments m JOIN employees e ON e.id = m.employee ' +
      JOB_ON +
      ' WHERE ' +
      where +
      ' ORDER BY name',
    POP_SHAPE,
    bind,
  );
}

/** Distinct people in a population (one person may hold two employments). */
function headcountOf(rows) {
  const s = {};
  for (const r of rows) s[r.employee] = true;
  return Object.keys(s).length;
}

/** Employments that started (field start_day) or ended (end_day) between two days, inside the filters, with the job record of that day. */
function movers(app, f, field, from, to) {
  const bind = { a: from, b: to };
  const dayCol = 'm.' + field;
  let where = dayCol + ' >= {:a} AND ' + dayCol + " <= {:b} AND " + dayCol + " != ''" + entityWhere(f, bind, 'm.entity');
  const jobOn = 'LEFT JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= ' + dayCol + ' ORDER BY j2.effective_from DESC LIMIT 1)';
  if (f.departments.length > 0) where += ' AND ' + listWhere(f.departments, bind, 'j.department', 'dp');
  if (f.location !== '') {
    bind.loc = f.location;
    where += ' AND j.location = {:loc}';
  }
  return u().rows(
    app,
    'SELECT m.id AS employment, m.employee AS employee, m.entity AS entity, m.number AS number, m.start_day AS start_day, m.end_day AS end_day, ' +
      "COALESCE(j.department, '') AS department, COALESCE(j.location, '') AS location, COALESCE(j.title, '') AS title, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name " +
      'FROM employments m JOIN employees e ON e.id = m.employee ' +
      jobOn +
      ' WHERE ' +
      where +
      ' ORDER BY ' +
      dayCol,
    { employment: '', employee: '', entity: '', number: '', start_day: '', end_day: '', department: '', location: '', title: '', name: '' },
    bind,
  );
}

/* --------------------------------------------------------------- names */

/** Names of org records by id, read once per call. */
function namer(app) {
  const cache = {};
  const load = (col, field) => {
    if (cache[col] === undefined) {
      cache[col] = {};
      for (const r of u().rows(app, 'SELECT id, COALESCE([[' + field + ']], \'\') AS name FROM ' + col, { id: '', name: '' })) cache[col][r.id] = r.name;
    }
    return cache[col];
  };
  return {
    entity: (id) => (id === '' ? '' : load('entities', 'name')[id] || ''),
    department: (id) => (id === '' ? '' : load('departments', 'name')[id] || ''),
    location: (id) => (id === '' ? '' : load('locations', 'name')[id] || ''),
    grade: (id) => (id === '' ? '' : load('grades', 'name')[id] || ''),
    employee: (id) => {
      if (id === '') return '';
      if (cache.emp === undefined) {
        cache.emp = {};
        for (const r of u().rows(app, "SELECT id, COALESCE(NULLIF(preferred_name, ''), legal_name) AS name, number FROM employees", { id: '', name: '', number: '' })) cache.emp[r.id] = { name: r.name, number: r.number };
      }
      return cache.emp[id] || { name: '', number: '' };
    },
  };
}

/** The key and label of a row for a group_by dimension. */
function groupOf(names, row, by) {
  if (by === 'department') return { key: row.department, label: names.department(row.department) };
  if (by === 'location') return { key: row.location, label: names.location(row.location) };
  return { key: row.entity, label: names.entity(row.entity) };
}

/* ---------------------------------------------------------------- money */

/** Convert minor units to the reporting currency on a day; null when no rate. */
/**
 * Minor units of `from` in `to` at the kernel rate of `day` (the latest on or
 * before it). A day before the company's first rate for these currencies
 * (rates are fetched from the day the company starts) takes the first rate
 * known after it. Null when no rate is known at all.
 */
function toReporting(app, minor, from, to, day) {
  if (from === to) return minor;
  const fx = L('lib_fx');
  const v = fx.convert(app, minor, from, to, day);
  if (v !== null) return v;
  const next = u().one(app, 'SELECT COALESCE(MIN(day), \'\') AS d FROM fx_rates WHERE day > {:d} AND (base IN ({:f}, {:t}) OR quote IN ({:f}, {:t}))', { d: '' }, { d: day, f: from, t: to });
  return next !== null && next.d !== '' ? fx.convert(app, minor, from, to, next.d) : null;
}

/** May the caller see pay figures in reports (payroll view; your AI agent only when the company allows it)? */
function seesPay(ctx) {
  if (ctx.isAgent) return L('lib_settings').row(ctx.app).getBool('agent_sees_pay');
  return L('lib_auth').can(ctx, 'payroll', 'view');
}

function needPay(ctx) {
  if (seesPay(ctx)) return;
  throw u().fail(403, ctx.isAgent ? 'The company has turned off pay figures for your AI agent.' : 'Pay figures need view access to Payroll.', ctx.isAgent ? 'pay_hidden' : 'not_permitted');
}

/* ---------------------------------------------------------------- helpers */

function pct(n, d, dp) {
  if (!d) return 0;
  const k = Math.pow(10, dp === undefined ? 1 : dp);
  return Math.round((n / d) * 100 * k) / k;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function median(xs) {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function yearsBetween(a, b) {
  return u().daysBetween(a, b) / 365.25;
}

function table(columns, rows) {
  return { columns: columns, rows: rows };
}

/* ------------------------------------------------------------ headcount */

const GROUPS = ['entity', 'department', 'location'];

/** Headcount at each month end (today for the current month), by entity, department or location, with joiners and leavers per month. */
function headcount(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = filters(ctx, p, { span: 12, maxMonths: 36 });
  const by = util.oneOf(p, 'group_by', GROUPS, 'entity');
  const names = namer(app);
  const months = monthsBetween(f.from, f.to);
  const groups = {};
  const total = [];
  const joined = [];
  const left = [];
  months.forEach((mk, i) => {
    const end = monthEnd(mk) > f.to ? f.to : monthEnd(mk);
    const rows = population(app, f, end);
    total.push(headcountOf(rows));
    const per = {};
    for (const r of rows) {
      const g = groupOf(names, r, by);
      const k = g.key;
      if (groups[k] === undefined) groups[k] = { key: k, label: g.label, values: months.map(() => 0) };
      per[k] = per[k] || {};
      per[k][r.employee] = true;
    }
    for (const k of Object.keys(per)) groups[k].values[i] = Object.keys(per[k]).length;
    const start = monthStart(mk) < f.from ? f.from : monthStart(mk);
    joined.push(movers(app, f, 'start_day', start, end).length);
    left.push(movers(app, f, 'end_day', start, end).length);
  });
  const series = Object.keys(groups)
    .map((k) => groups[k])
    .sort((a, b) => b.values[b.values.length - 1] - a.values[a.values.length - 1] || (a.label < b.label ? -1 : 1));
  const last = total.length > 0 ? total[total.length - 1] : 0;
  const first = total.length > 0 ? total[0] : 0;
  const rows = [];
  months.forEach((mk, i) => {
    for (const s of series) rows.push({ month: mk, group: s.label || 'Not set', headcount: s.values[i] });
  });
  return {
    filters: shown(f),
    group_by: by,
    months: months,
    total: total,
    joined: joined,
    left: left,
    series: series.map((s) => ({ key: s.key, label: s.label || 'Not set', values: s.values })),
    readouts: { now: last, start: first, change: last - first, change_pct: pct(last - first, first), joined: joined.reduce((a, b) => a + b, 0), left: left.reduce((a, b) => a + b, 0) },
    table: table(
      [
        { key: 'month', label: 'Month', kind: 'month' },
        { key: 'group', label: by === 'department' ? 'Department' : by === 'location' ? 'Location' : 'Entity', kind: 'text' },
        { key: 'headcount', label: 'Headcount', kind: 'number' },
      ],
      rows,
    ),
  };
}

/* ------------------------------------------------------------- movement */

/** Separation kinds (lifecycle) as voluntary, involuntary or other. */
const LEAVE_KIND = { resignation: 'voluntary', retirement: 'voluntary', termination: 'involuntary', end_of_contract: 'involuntary', death: 'other', other: 'other' };

/** The separation kind of each employment that ended (approved or completed separations). */
function separationKinds(app, ids) {
  const out = {};
  if (ids.length === 0) return out;
  const bind = {};
  for (const r of u().rows(app, "SELECT employment, kind, COALESCE(reason_code, '') AS reason_code FROM separations WHERE status IN ('approved', 'completed') AND " + listWhere(ids, bind, 'employment', 'sx'), { employment: '', kind: '', reason_code: '' }, bind)) out[r.employment] = { kind: r.kind, reason_code: r.reason_code };
  return out;
}

/** Joiners and leavers by month, turnover (voluntary, involuntary, other, not recorded) against the average headcount, and tenure at leaving. */
function movement(ctx, p) {
  const app = ctx.app;
  const f = filters(ctx, p, { span: 12, maxMonths: 36 });
  const names = namer(app);
  const months = monthsBetween(f.from, f.to);
  const out = [];
  let leaversAll = [];
  let joinersAll = [];
  const heads = [];
  for (const mk of months) {
    const start = monthStart(mk) < f.from ? f.from : monthStart(mk);
    const end = monthEnd(mk) > f.to ? f.to : monthEnd(mk);
    const j = movers(app, f, 'start_day', start, end);
    const l = movers(app, f, 'end_day', start, end);
    const hStart = headcountOf(population(app, f, start));
    const hEnd = headcountOf(population(app, f, end));
    heads.push((hStart + hEnd) / 2);
    joinersAll = joinersAll.concat(j);
    leaversAll = leaversAll.concat(l);
    out.push({ month: mk, joined: j.length, left: l.length, headcount: hEnd, l: l });
  }
  const kinds = separationKinds(
    app,
    leaversAll.map((x) => x.employment),
  );
  const counts = { voluntary: 0, involuntary: 0, other: 0, not_recorded: 0 };
  const reasons = {};
  const tenures = [];
  const rows = [];
  for (const m of out) {
    m.voluntary = 0;
    m.involuntary = 0;
    m.other = 0;
    m.not_recorded = 0;
    for (const x of m.l) {
      const s = kinds[x.employment];
      const k = s ? LEAVE_KIND[s.kind] || 'other' : 'not_recorded';
      m[k]++;
      counts[k]++;
      if (s && s.reason_code !== '') reasons[s.reason_code] = (reasons[s.reason_code] || 0) + 1;
      const tn = yearsBetween(x.start_day, x.end_day);
      tenures.push(tn);
      rows.push({ day: x.end_day, movement: 'left', number: x.number, name: x.name, title: x.title, entity: names.entity(x.entity), department: names.department(x.department), kind: k, separation: s ? s.kind : '', tenure_years: round1(tn) });
    }
    delete m.l;
  }
  for (const x of joinersAll) rows.push({ day: x.start_day, movement: 'joined', number: x.number, name: x.name, title: x.title, entity: names.entity(x.entity), department: names.department(x.department), kind: '', separation: '', tenure_years: '' });
  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const avgHead = heads.length > 0 ? heads.reduce((a, b) => a + b, 0) / heads.length : 0;
  const scale = months.length > 0 ? 12 / months.length : 1;
  const left = leaversAll.length;
  return {
    filters: shown(f),
    months: out,
    readouts: {
      joined: joinersAll.length,
      left: left,
      net: joinersAll.length - left,
      average_headcount: round1(avgHead),
      turnover_pct: pct(left, avgHead),
      turnover_annual_pct: pct(left * scale, avgHead),
      voluntary_pct: pct(counts.voluntary, avgHead),
      involuntary_pct: pct(counts.involuntary, avgHead),
      tenure_at_leaving_years: round1(tenures.length > 0 ? tenures.reduce((a, b) => a + b, 0) / tenures.length : 0),
    },
    kinds: counts,
    reasons: Object.keys(reasons)
      .map((k) => ({ reason: k, count: reasons[k] }))
      .sort((a, b) => b.count - a.count),
    table: table(
      [
        { key: 'day', label: 'Day', kind: 'day' },
        { key: 'movement', label: 'Movement', kind: 'enum' },
        { key: 'number', label: 'Number', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'entity', label: 'Entity', kind: 'text' },
        { key: 'department', label: 'Department', kind: 'text' },
        { key: 'kind', label: 'Turnover', kind: 'enum' },
        { key: 'separation', label: 'Separation', kind: 'enum' },
        { key: 'tenure_years', label: 'Years', kind: 'number' },
      ],
      rows,
    ),
  };
}

/* --------------------------------------------------------------- tenure */

const TENURE_BANDS = [
  { key: 'lt1', label: 'Under 1 year', lo: 0, hi: 1 },
  { key: '1_2', label: '1 to 2 years', lo: 1, hi: 2 },
  { key: '2_5', label: '2 to 5 years', lo: 2, hi: 5 },
  { key: '5_10', label: '5 to 10 years', lo: 5, hi: 10 },
  { key: '10p', label: '10 years or more', lo: 10, hi: 1000 },
];

/** Tenure of the people in work on the last day: bands, average and median, by entity, department or location. */
function tenure(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = filters(ctx, p, { span: 0 });
  const by = util.oneOf(p, 'group_by', GROUPS, 'department');
  const names = namer(app);
  const day = f.to;
  const rows = population(app, f, day);
  const bands = TENURE_BANDS.map((b) => ({ key: b.key, label: b.label, count: 0 }));
  const groups = {};
  const years = [];
  const out = [];
  for (const r of rows) {
    const y = yearsBetween(r.start_day, day);
    years.push(y);
    const bi = TENURE_BANDS.findIndex((b) => y >= b.lo && y < b.hi);
    if (bi >= 0) bands[bi].count++;
    const g = groupOf(names, r, by);
    const gg = (groups[g.key] = groups[g.key] || { key: g.key, label: g.label || 'Not set', years: [] });
    gg.years.push(y);
    out.push({ number: r.number, name: r.name, title: r.title, entity: names.entity(r.entity), department: names.department(r.department), start_day: r.start_day, tenure_years: round1(y) });
  }
  return {
    filters: shown(f),
    group_by: by,
    day: day,
    bands: bands,
    readouts: { people: rows.length, average_years: round1(years.length ? years.reduce((a, b) => a + b, 0) / years.length : 0), median_years: round1(median(years)), under_1_pct: pct(bands[0].count, rows.length) },
    groups: Object.keys(groups)
      .map((k) => ({ key: k, label: groups[k].label, people: groups[k].years.length, average_years: round1(groups[k].years.reduce((a, b) => a + b, 0) / groups[k].years.length), median_years: round1(median(groups[k].years)) }))
      .sort((a, b) => b.people - a.people),
    table: table(
      [
        { key: 'number', label: 'Number', kind: 'text' },
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'entity', label: 'Entity', kind: 'text' },
        { key: 'department', label: 'Department', kind: 'text' },
        { key: 'start_day', label: 'Start', kind: 'day' },
        { key: 'tenure_years', label: 'Years', kind: 'number' },
      ],
      out.sort((a, b) => b.tenure_years - a.tenure_years),
    ),
  };
}

/* ----------------------------------------------------------------- span */

const SPAN_BANDS = [
  { key: '1', label: '1', lo: 1, hi: 1 },
  { key: '2_3', label: '2 to 3', lo: 2, hi: 3 },
  { key: '4_6', label: '4 to 6', lo: 4, hi: 6 },
  { key: '7_10', label: '7 to 10', lo: 7, hi: 10 },
  { key: '11p', label: '11 or more', lo: 11, hi: 100000 },
];

/** Span of control on a day: every manager with direct and total reports, the distribution and the average. */
function span(ctx, p) {
  const app = ctx.app;
  const f = filters(ctx, p, { span: 0 });
  const names = namer(app);
  const day = f.to;
  const rows = population(app, f, day);
  const byEmployee = {};
  for (const r of rows) byEmployee[r.employee] = r;
  const direct = {};
  for (const r of rows) if (r.manager !== '' && r.manager !== r.employee) (direct[r.manager] = direct[r.manager] || {})[r.employee] = true;
  const total = (m, seen) => {
    let n = 0;
    for (const k of Object.keys(direct[m] || {})) {
      if (seen[k]) continue;
      seen[k] = true;
      n += 1 + total(k, seen);
    }
    return n;
  };
  const managers = Object.keys(direct).map((m) => {
    const me = byEmployee[m];
    const info = names.employee(m);
    const d = Object.keys(direct[m]).length;
    return { employee: m, number: info.number, name: info.name, title: me ? me.title : '', department: me ? names.department(me.department) : '', entity: me ? names.entity(me.entity) : '', direct: d, total: total(m, {}), in_filter: me !== undefined };
  });
  managers.sort((a, b) => b.direct - a.direct || (a.name < b.name ? -1 : 1));
  const spans = managers.map((m) => m.direct);
  const bands = SPAN_BANDS.map((b) => ({ key: b.key, label: b.label, count: spans.filter((s) => s >= b.lo && s <= b.hi).length }));
  const noManager = rows.filter((r) => r.manager === '').length;
  return {
    filters: shown(f),
    day: day,
    bands: bands,
    readouts: { managers: managers.length, people: rows.length, average_span: round1(spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0), median_span: round1(median(spans)), widest: spans.length ? Math.max.apply(null, spans) : 0, single_report: bands[0].count, no_manager: noManager },
    table: table(
      [
        { key: 'number', label: 'Number', kind: 'text' },
        { key: 'name', label: 'Manager', kind: 'text' },
        { key: 'title', label: 'Title', kind: 'text' },
        { key: 'department', label: 'Department', kind: 'text' },
        { key: 'entity', label: 'Entity', kind: 'text' },
        { key: 'direct', label: 'Direct reports', kind: 'number' },
        { key: 'total', label: 'All reports', kind: 'number' },
      ],
      managers,
    ),
  };
}

/* ------------------------------------------------------------ diversity */

const MIN_GROUP = 5;
const AGE_BANDS = [
  { key: 'u25', label: 'Under 25', lo: 0, hi: 25 },
  { key: '25_34', label: '25 to 34', lo: 25, hi: 35 },
  { key: '35_44', label: '35 to 44', lo: 35, hi: 45 },
  { key: '45_54', label: '45 to 54', lo: 45, hi: 55 },
  { key: '55_64', label: '55 to 64', lo: 55, hi: 65 },
  { key: '65p', label: '65 or over', lo: 65, hi: 1000 },
];

/**
 * Hide groups under the minimum size. When exactly one group is hidden its
 * count could be worked out from the total, so the next smallest group is
 * hidden too. Hidden groups carry count null.
 */
function suppress(groups, total) {
  if (total < MIN_GROUP) return groups.map((g) => ({ key: g.key, label: g.label, count: null, share: null, hidden: true }));
  const out = groups.map((g) => ({ key: g.key, label: g.label, count: g.count, share: pct(g.count, total), hidden: g.count < MIN_GROUP }));
  const hidden = out.filter((g) => g.hidden).length;
  if (hidden === 1) {
    const open = out.filter((g) => !g.hidden).sort((a, b) => a.count - b.count);
    if (open.length > 0) open[0].hidden = true;
  }
  for (const g of out)
    if (g.hidden) {
      g.count = null;
      g.share = null;
    }
  return out;
}

/** Aggregate counts only (gender, age band, nationality), each group of fewer than 5 people shown as "fewer than 5". */
function diversity(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = filters(ctx, p, { span: 0 });
  const dim = util.oneOf(p, 'dimension', ['gender', 'age', 'nationality'], 'gender');
  const day = f.to;
  const rows = population(app, f, day);
  const seen = {};
  const people = [];
  for (const r of rows) {
    if (seen[r.employee]) continue;
    seen[r.employee] = true;
    people.push(r);
  }
  const counts = {};
  const label = {};
  for (const r of people) {
    let key = '';
    let lab = '';
    if (dim === 'gender') {
      key = r.gender.trim().toLowerCase();
      // Shown as written, with a capital first letter ("female" reads "Female").
      lab = r.gender.trim().charAt(0).toUpperCase() + r.gender.trim().slice(1);
    } else if (dim === 'age') {
      if (r.birth_date !== '') {
        const age = Math.floor(yearsBetween(r.birth_date, day));
        const b = AGE_BANDS.find((x) => age >= x.lo && age < x.hi);
        key = b ? b.key : '';
        lab = b ? b.label : '';
      }
    } else {
      key = r.nationality;
      if (label[key] === undefined && key !== '') {
        const c = L('lib_countries').has(key) ? L('lib_countries').get(key) : null;
        lab = c ? c.name : key;
      }
    }
    counts[key] = (counts[key] || 0) + 1;
    if (label[key] === undefined) label[key] = key === '' ? 'Not given' : lab;
  }
  let groups = Object.keys(counts).map((k) => ({ key: k, label: label[k], count: counts[k] }));
  if (dim === 'age') groups.sort((a, b) => AGE_BANDS.findIndex((x) => x.key === a.key) - AGE_BANDS.findIndex((x) => x.key === b.key));
  else groups.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  if (dim === 'age') {
    const nb = groups.filter((g) => g.key === '');
    groups = groups.filter((g) => g.key !== '').concat(nb);
  }
  const total = people.length;
  const out = suppress(groups, total);
  return {
    filters: shown(f),
    dimension: dim,
    day: day,
    min_group: MIN_GROUP,
    total: total < MIN_GROUP ? null : total,
    groups: out,
    table: table(
      [
        { key: 'label', label: dim === 'gender' ? 'Gender' : dim === 'age' ? 'Age' : 'Nationality', kind: 'text' },
        { key: 'count', label: 'People', kind: 'count_min5' },
        { key: 'share', label: 'Share %', kind: 'number' },
      ],
      out.map((g) => ({ label: g.label, count: g.count, share: g.share })),
    ),
  };
}

/* ------------------------------------------------------------- catalog */

/** Every report of this module with its operation, for the hub and your AI agent. */
const CATALOG = [
  { key: 'headcount', op: 'reports.headcount', group: 'people', title: 'Headcount over time', desc: 'People at each month end by entity, department or location, with joiners and leavers.' },
  { key: 'movement', op: 'reports.movement', group: 'people', title: 'Joiners, leavers and turnover', desc: 'Turnover against the average headcount, voluntary and involuntary, with tenure at leaving.' },
  { key: 'tenure', op: 'reports.tenure', group: 'people', title: 'Tenure', desc: 'How long people have been with the company, in bands and by group.' },
  { key: 'span', op: 'reports.span', group: 'people', title: 'Span of control', desc: 'Managers with their direct and indirect reports.' },
  { key: 'diversity', op: 'reports.diversity', group: 'people', title: 'Diversity', desc: 'Aggregate counts by gender, age and nationality; groups under 5 are hidden.' },
  { key: 'comp-bands', op: 'reports.comp-bands', group: 'pay', title: 'Pay against grade ranges', desc: 'Where each person sits in their grade range, below, inside or above.', pay: true },
  { key: 'cost', op: 'reports.cost', group: 'pay', title: 'Payroll cost', desc: 'Gross pay and employer costs of locked runs by month, in the reporting currency.', pay: true },
  { key: 'leave-liability', op: 'reports.leave-liability', group: 'time', title: 'Leave liability', desc: 'Leave owed in days and, with pay access, in money.' },
  { key: 'absence', op: 'reports.absence', group: 'time', title: 'Absence and overtime', desc: 'Absence rate, leave taken and overtime hours by month and department.' },
  { key: 'hiring', op: 'reports.hiring', group: 'hiring', title: 'Hiring funnel and time to hire', desc: 'Applications through each stage, conversion and days to hire.' },
  { key: 'training', op: 'reports.training', group: 'growth', title: 'Training completion', desc: 'Completion of training sessions by program and department.' },
];

function list(ctx) {
  const pay = seesPay(ctx);
  return { reports: CATALOG.map((r) => Object.assign({}, r, { available: !r.pay || pay })) };
}

/* -------------------------------------------------------------- export */

const RUNNERS = {
  headcount: 'lib_reports.headcount',
  movement: 'lib_reports.movement',
  tenure: 'lib_reports.tenure',
  span: 'lib_reports.span',
  diversity: 'lib_reports.diversity',
  'comp-bands': 'lib_reports_pay.compBands',
  cost: 'lib_reports_pay.cost',
  'leave-liability': 'lib_reports_pay.leaveLiability',
  absence: 'lib_reports_ops.absence',
  hiring: 'lib_reports_ops.hiring',
  training: 'lib_reports_ops.training',
};

function csvValue(v, kind) {
  if (v === null || v === undefined) return kind === 'count_min5' ? 'fewer than 5' : '';
  return v;
}

/** A report as CSV (the same filters as the report itself). */
function exportCsv(ctx, p) {
  const util = u();
  const key = util.oneOf(p, 'report', Object.keys(RUNNERS), '');
  if (key === '') throw util.fail(400, 'Give the report: ' + Object.keys(RUNNERS).join(', ') + '.', 'missing_param', { param: 'report' });
  const parts = RUNNERS[key].split('.');
  const r = L(parts[0])[parts[1]](ctx, p);
  const cols = r.table.columns;
  const lines = [cols.map((c) => c.label)];
  for (const row of r.table.rows) lines.push(cols.map((c) => csvValue(row[c.key], c.kind)));
  const f = r.filters;
  L('lib_audit').write(ctx, { op: 'reports.export', collection: '', summary: 'Exported the ' + key + ' report to CSV (' + r.table.rows.length + ' rows)' });
  return { filename: 'report-' + key + '-' + (f.from && f.from !== f.to ? f.from + '-to-' : '') + f.to + '.csv', rows: r.table.rows.length, csv: util.csvText(lines) };
}

module.exports = {
  CATALOG: CATALOG,
  MIN_GROUP: MIN_GROUP,
  monthsBetween: monthsBetween,
  monthStart: monthStart,
  monthEnd: monthEnd,
  filters: filters,
  shown: shown,
  entityWhere: entityWhere,
  listWhere: listWhere,
  population: population,
  headcountOf: headcountOf,
  movers: movers,
  namer: namer,
  groupOf: groupOf,
  toReporting: toReporting,
  seesPay: seesPay,
  needPay: needPay,
  pct: pct,
  round1: round1,
  median: median,
  yearsBetween: yearsBetween,
  table: table,
  suppress: suppress,
  headcount: headcount,
  movement: movement,
  tenure: tenure,
  span: span,
  diversity: diversity,
  list: list,
  exportCsv: exportCsv,
};
