/**
 * Home (home-reports module): the facts each kind of viewer sees first.
 *
 *   home.admin    what needs you (approvals, proposals, pay run blockers,
 *                 documents expiring, people starting or leaving without a
 *                 checklist, probations ending), people readouts and twelve
 *                 months of headcount (and payroll cost with pay access),
 *                 your AI agent's recent work, and the company globe (every
 *                 office now: people in, remote, on leave, open roles, the
 *                 next pay day and this month's payroll; lib_home_globe).
 *   home.manager  the team: size, out today, leave this month, probations
 *                 ending, approvals waiting.
 *   home.me       the person: who they are here, the facts every module
 *                 shows on a profile, documents to acknowledge, answers from
 *                 your AI agent, requests waiting.
 *
 * Items that can be acted on carry an `action` ({ op, params, label }) the
 * screen runs as it is, so one tap does the job.
 */
let _m = {};
function L(n) {
  if (_m[n] === undefined) _m[n] = require(`${__hooks}/${n}.js`);
  return _m[n];
}
const u = () => L('lib_util');
const R = () => L('lib_reports');

const MAX_ITEMS = 6;

/**
 * Another module's read for this page, run as the caller through the kernel
 * (its permission and param checks, its handler): one request carries the
 * whole page. Called only where the caller may run it.
 */
function read(ctx, name, params) {
  return L('lib_ops').runAs(ctx, name, params || {});
}

/** The pay runs of every schedule the caller may see (payroll.home), for the Home panel. */
function payPanel(ctx) {
  const h = read(ctx, 'payroll.home', {});
  return {
    schedules: (h.schedules || []).map((s) => ({ schedule: s.schedule, name: s.name, entity: s.entity, entity_name: s.entity_name, currency: s.currency, frequency: s.frequency, people: s.people, pay_date: s.pay_date, cutoff_day: s.cutoff_day, days_to_pay: s.days_to_pay, days_to_cutoff: s.days_to_cutoff, run: s.run || null })),
    blockers: (h.blockers || []).map((b) => ({ payrun: b.payrun, number: b.number, entity_name: b.entity_name, blockers: b.blockers, link: b.link })),
  };
}

/** Today's board for the caller's team or scope (attendance.board), for Team today. */
function teamPanel(ctx) {
  const b = read(ctx, 'attendance.board', {});
  return { people: (b.people || []).map((r) => ({ employment: r.employment, employee: r.employee, name: r.name, title: r.title, state: r.state, late_min: r.late_min, first_in_time: r.first_in_time, last_out_time: r.last_out_time, holiday: r.holiday, leave: r.leave, shift_over: r.shift_over === true })) };
}

/** The caller's clock today (clock.status), for the clock card; null without an employee record. */
function clockPanel(ctx) {
  if (ctx.isAgent || ctx.employeeId === '') return null;
  // The time module's whole answer: the card draws from it and punches with it (no second read).
  return read(ctx, 'clock.status', {});
}

function approvalItem(a) {
  return { id: a.id, kind: a.kind, title: a.summary, person: a.employee_name, sub: a.requester_name !== '' && a.requester_name !== a.employee_name ? a.requester_name : '', due: a.due ? String(a.due) : '', created: a.created, amount_minor: a.amount_minor, currency: a.currency, needs_pin: a.needs_pin, link: '#/inbox' };
}

function group(key, items, total, link) {
  return { key: key, count: total === undefined ? items.length : total, items: items.slice(0, MAX_ITEMS), link: link || '' };
}

/** "m.entity IN (...)" for the caller's scope. */
function scopeWhere(ctx, bind, col) {
  const sc = L('lib_auth').scope(ctx);
  if (sc.length === 0) return '';
  return ' AND ' + col + ' IN (' + sc.map((id, i) => ((bind['sc' + i] = id), '{:sc' + i + '}')).join(',') + ')';
}

/* ---------------------------------------------------------------- admin */

/**
 * Payroll cost (gross plus employer costs) of locked and paid runs by pay
 * month: summed in each pay currency, then converted to the reporting
 * currency with the kernel rates (lib_reports.toReporting). The chart's
 * currency is the reporting currency, or the one pay currency when every
 * payslip is in it and no rate to the reporting currency is known (a figure
 * in its own currency, never a zero). Returns { currency, months: { month:
 * { gross, employer } }, missing: [{ month, currency }] (left out for want of
 * a rate), native: { month: { currency: minor } } }.
 */
function costByMonth(ctx, from, to, reporting) {
  const util = u();
  const app = ctx.app;
  const bind = { a: from, b: to };
  const rows = util.rows(
    app,
    "SELECT substr(s.pay_date, 1, 7) AS month, s.currency AS currency, CAST(COALESCE(SUM(s.gross_minor), 0) AS INTEGER) AS gross, CAST(COALESCE(SUM(s.employer_minor), 0) AS INTEGER) AS employer FROM payslips s JOIN payruns pr ON pr.id = s.payrun WHERE pr.status IN ('locked', 'paid') AND s.status IN ('locked', 'published') AND s.pay_date >= {:a} AND s.pay_date <= {:b}" +
      scopeWhere(ctx, bind, 's.entity') +
      ' GROUP BY substr(s.pay_date, 1, 7), s.currency',
    { month: '', currency: '', gross: 0, employer: 0 },
    bind,
  );
  const native = {};
  const used = {};
  for (const r of rows) {
    native[r.month] = native[r.month] || {};
    native[r.month][r.currency] = (native[r.month][r.currency] || 0) + r.gross + r.employer;
    used[r.currency] = true;
  }
  const converted = {};
  const missing = [];
  for (const r of rows) {
    const day = R().monthEnd(r.month);
    const g = R().toReporting(app, r.gross, r.currency, reporting, day);
    const e = R().toReporting(app, r.employer, r.currency, reporting, day);
    if (g === null || e === null) {
      missing.push({ month: r.month, currency: r.currency });
      continue;
    }
    const m = (converted[r.month] = converted[r.month] || { gross: 0, employer: 0 });
    m.gross += g;
    m.employer += e;
  }
  const one = Object.keys(used);
  if (missing.length > 0 && one.length === 1) {
    const months = {};
    for (const r of rows) {
      const m = (months[r.month] = months[r.month] || { gross: 0, employer: 0 });
      m.gross += r.gross;
      m.employer += r.employer;
    }
    return { currency: one[0], months: months, missing: [], native: native };
  }
  return { currency: reporting, months: converted, missing: missing, native: native };
}

function admin(ctx, p) {
  const util = u();
  const r = R();
  const auth = L('lib_auth');
  const app = ctx.app;
  const today = util.today(app);
  const s = L('lib_settings').row(app);
  const f = r.filters(ctx, {}, { span: 12 });
  const names = r.namer(app);
  const people = ctx.isAgent || auth.can(ctx, 'people', 'view');
  const payView = ctx.isAgent || auth.can(ctx, 'payroll', 'view');
  const pay = r.seesPay(ctx);
  const out = { today: today, company: { name: s.getString('company_name'), reporting_currency: f.currency, entities: util.count(app, 'SELECT COUNT(*) AS n FROM entities WHERE active = TRUE') } };

  /* readouts and twelve months */
  const monthStart = today.slice(0, 7) + '-01';
  const pop = r.population(app, f, today);
  const months = r.monthsBetween(f.from, today);
  const cost = pay ? costByMonth(ctx, f.from, r.monthEnd(today.slice(0, 7)), f.currency) : { currency: f.currency, months: {}, missing: [], native: {} };
  out.series = months.map((mk) => {
    const end = r.monthEnd(mk) > today ? today : r.monthEnd(mk);
    const c = cost.months[mk];
    return {
      month: mk,
      headcount: mk === today.slice(0, 7) ? r.headcountOf(pop) : r.headcountOf(r.population(app, f, end)),
      joined: r.movers(app, f, 'start_day', r.monthStart(mk), end).length,
      left: r.movers(app, f, 'end_day', r.monthStart(mk), end).length,
      gross_minor: pay ? (c ? c.gross : 0) : null,
      employer_minor: pay ? (c ? c.employer : 0) : null,
    };
  });
  const bind = { d: today, e30: util.dayAdd(today, 30), ms: monthStart };
  const sc = scopeWhere(ctx, bind, 'm.entity');
  const last = out.series.length > 1 ? out.series[out.series.length - 2] : null;
  // The last month a locked run paid in, converted or not (a month whose rates are missing is still the last one paid).
  const ranMonths = Object.keys(cost.native).sort();
  const lastMonth = ranMonths.length > 0 ? ranMonths[ranMonths.length - 1] : '';
  const lastPaid = lastMonth !== '' ? out.series.find((x) => x.month === lastMonth) || null : null;
  out.readouts = {
    headcount: r.headcountOf(pop),
    headcount_month_ago: last ? last.headcount : null,
    joined_month: out.series.length ? out.series[out.series.length - 1].joined : 0,
    left_month: out.series.length ? out.series[out.series.length - 1].left : 0,
    starting_30: util.count(app, "SELECT COUNT(*) AS n FROM employments m WHERE m.start_day > {:d} AND m.start_day <= {:e30}" + sc, bind),
    leaving_30: util.count(app, "SELECT COUNT(*) AS n FROM employments m WHERE m.end_day != '' AND m.end_day >= {:d} AND m.end_day <= {:e30}" + sc, bind),
    out_today: util.count(app, "SELECT COUNT(DISTINCT r.employment) AS n FROM leave_requests r JOIN employments m ON m.id = r.employment WHERE r.status IN ('approved', 'cancelling') AND [[r.start]] <= {:d} AND [[r.end]] >= {:d}" + sc, bind),
    open_roles: util.count(app, "SELECT CAST(COALESCE(SUM(CASE WHEN o.positions > 0 THEN o.positions ELSE 1 END), 0) AS INTEGER) AS n FROM openings o WHERE o.status = 'open'" + scopeWhere(ctx, bind, 'o.entity'), bind),
    cost_month: lastMonth,
    // In cost_currency; null when part of the month has no rate (then cost_month_parts says it in each currency).
    cost_month_minor: lastPaid && lastPaid.gross_minor !== null && !cost.missing.some((x) => x.month === lastMonth) ? lastPaid.gross_minor + lastPaid.employer_minor : null,
    cost_month_parts: lastMonth !== '' ? Object.keys(cost.native[lastMonth] || {}).map((c) => ({ currency: c, minor: cost.native[lastMonth][c] })).sort((x, y) => y.minor - x.minor) : [],
    cost_month_unconverted: cost.missing.filter((x) => x.month === lastMonth).map((x) => x.currency),
    entities: out.company.entities,
  };
  out.cost_missing_fx = cost.missing;
  out.cost_currency = cost.currency;
  out.pay_visible = pay;

  /* what needs you */
  const groups = [];
  if (ctx.member !== null) {
    const ap = L('lib_approvals').pendingFor(ctx);
    if (ap.length > 0) groups.push(group('approvals', ap.map(approvalItem), ap.length, '#/inbox'));
  }
  const props = L('lib_proposals').list(ctx, { status: 'pending', limit: MAX_ITEMS });
  if (props.total > 0)
    groups.push(
      group(
        'proposals',
        props.proposals.map((x) => ({ id: x.id, title: x.title, sub: x.why, created: x.created, link: '#/inbox?view=proposals', risk: x.risk })),
        props.total,
        '#/inbox?view=proposals',
      ),
    );
  if (payView) {
    const b = {};
    const blk = util.rows(
      app,
      "SELECT pr.id AS id, pr.number AS number, pr.pay_date AS pay_date, pr.status AS status, pr.entity AS entity, COALESCE(ps.name, '') AS schedule, CAST(COALESCE(json_extract(pr.issues, '$.blockers'), 0) AS INTEGER) AS blockers FROM payruns pr LEFT JOIN pay_schedules ps ON ps.id = pr.schedule WHERE pr.status IN ('draft', 'calculated', 'approved') AND CAST(COALESCE(json_extract(pr.issues, '$.blockers'), 0) AS INTEGER) > 0" +
        scopeWhere(ctx, b, 'pr.entity') +
        ' ORDER BY pr.pay_date',
      { id: '', number: '', pay_date: '', status: '', entity: '', schedule: '', blockers: 0 },
      b,
    );
    if (blk.length > 0) groups.push(group('blockers', blk.map((x) => ({ id: x.id, title: x.number + (x.schedule !== '' ? ' · ' + x.schedule : ''), sub: names.entity(x.entity), count: x.blockers, due: x.pay_date, link: '#/payroll/runs/' + x.id + '?tab=issues' })), undefined, '#/payroll'));
  }
  if (people) {
    const b = { d: today, e60: util.dayAdd(today, 60), p30: util.dayAdd(today, -30) };
    const cur = "AND EXISTS (SELECT 1 FROM employments m WHERE m.employee = e.id AND m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d})" + scopeWhere(ctx, b, 'm.entity') + ')';
    const ids = util.rows(app, "SELECT d.id AS id, d.type AS type, d.expires AS expires, e.number AS number, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name FROM identity_docs d JOIN employees e ON e.id = d.employee WHERE d.expires != '' AND d.expires >= {:p30} AND d.expires <= {:e60} " + cur + ' ORDER BY d.expires', { id: '', type: '', expires: '', number: '', name: '' }, b);
    const docs = util.rows(app, "SELECT d.id AS id, d.title AS title, d.expires AS expires, e.number AS number, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name FROM documents d JOIN employees e ON e.id = d.employee WHERE d.expires != '' AND d.expires >= {:p30} AND d.expires <= {:e60} " + cur + ' ORDER BY d.expires', { id: '', title: '', expires: '', number: '', name: '' }, b);
    const exp = ids
      .map((x) => ({ id: x.id, kind: 'id', doc_type: x.type, title: x.type, person: x.name, due: x.expires, link: '#/people/' + x.number + '?tab=bank' }))
      .concat(docs.map((x) => ({ id: x.id, kind: 'document', doc_type: '', title: x.title, person: x.name, due: x.expires, link: '#/people/' + x.number + '?tab=documents' })))
      .sort((a, b2) => (a.due < b2.due ? -1 : 1));
    if (exp.length > 0) groups.push(group('documents', exp, undefined, '#/people'));

    const canEdit = ctx.isAgent || auth.can(ctx, 'people', 'edit');
    const b2 = { d: today, s14: util.dayAdd(today, 14), p7: util.dayAdd(today, -7), e30: util.dayAdd(today, 30) };
    const starting = util.rows(
      app,
      "SELECT m.id AS id, m.start_day AS day, e.number AS number, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name, m.entity AS entity FROM employments m JOIN employees e ON e.id = m.employee WHERE m.start_day >= {:p7} AND m.start_day <= {:s14} AND NOT EXISTS (SELECT 1 FROM checklists c WHERE c.employment = m.id AND c.kind = 'onboarding' AND c.status != 'cancelled')" +
        scopeWhere(ctx, b2, 'm.entity') +
        ' ORDER BY m.start_day',
      { id: '', day: '', number: '', name: '', entity: '' },
      b2,
    );
    if (starting.length > 0) groups.push(group('starting', starting.map((x) => ({ id: x.id, title: x.name, person: x.name, sub: names.entity(x.entity), due: x.day, link: '#/people/' + x.number, action: canEdit ? { op: 'checklists.start', params: { employment: x.id, kind: 'onboarding' }, label: 'start_onboarding' } : null })), undefined, '#/lifecycle'));
    const b3 = { d: today, e30: util.dayAdd(today, 30) };
    const leaving = util.rows(
      app,
      "SELECT m.id AS id, m.end_day AS day, e.number AS number, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name, m.entity AS entity FROM employments m JOIN employees e ON e.id = m.employee WHERE m.end_day != '' AND m.end_day >= {:d} AND m.end_day <= {:e30} AND NOT EXISTS (SELECT 1 FROM checklists c WHERE c.employment = m.id AND c.kind = 'offboarding' AND c.status != 'cancelled')" +
        scopeWhere(ctx, b3, 'm.entity') +
        ' ORDER BY m.end_day',
      { id: '', day: '', number: '', name: '', entity: '' },
      b3,
    );
    if (leaving.length > 0) groups.push(group('leaving', leaving.map((x) => ({ id: x.id, title: x.name, person: x.name, sub: names.entity(x.entity), due: x.day, link: '#/people/' + x.number, action: canEdit ? { op: 'checklists.start', params: { employment: x.id, kind: 'offboarding' }, label: 'start_offboarding' } : null })), undefined, '#/lifecycle'));
    const b4 = { d: today, e14: util.dayAdd(today, 14) };
    const prob = util.rows(
      app,
      "SELECT m.id AS id, m.probation_end AS day, e.number AS number, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name, m.entity AS entity FROM employments m JOIN employees e ON e.id = m.employee WHERE m.probation_end != '' AND m.probation_end >= {:d} AND m.probation_end <= {:e14} AND (m.end_day = '' OR m.end_day > m.probation_end)" +
        scopeWhere(ctx, b4, 'm.entity') +
        ' ORDER BY m.probation_end',
      { id: '', day: '', number: '', name: '', entity: '' },
      b4,
    );
    if (prob.length > 0) groups.push(group('probation', prob.map((x) => ({ id: x.id, title: x.name, person: x.name, sub: names.entity(x.entity), due: x.day, link: '#/people/' + x.number + '?tab=job' })), undefined, '#/people'));
  }
  out.attention = groups;
  if (ctx.isAgent || auth.can(ctx, 'admin', 'edit')) out.setup = L('lib_settings').progress(app);
  out.pay = pay && payView ? payPanel(ctx) : null;
  // The company globe: every office now (one read for the page; lib_home_globe).
  out.globe = out.readouts.headcount + out.readouts.starting_30 > 0 ? L('lib_home_globe').globe(ctx, { pop: pop, pay: out.pay, payVisible: pay, reporting: f.currency, today: today }) : null;
  out.team = !ctx.isAgent && ctx.teamScope && ctx.employeeId !== '' && L('lib_people').reportsOf(app, ctx.employeeId, today, false).length > 0 ? teamPanel(ctx) : null;

  /* your AI agent: what it did (the audit trail); screens follow its requests themselves */
  const acts = util.rows(app, "SELECT id, COALESCE(op, '') AS op, COALESCE(summary, '') AS summary, created FROM audit WHERE actor = 'agent' AND summary != '' ORDER BY created DESC LIMIT 5", { id: '', op: '', summary: '', created: '' });
  out.agent = {
    done_30: util.count(app, "SELECT COUNT(*) AS n FROM audit WHERE actor = 'agent' AND op != '' AND created >= {:d}", { d: util.dayAdd(today, -30) }),
    proposals_accepted_30: util.count(app, "SELECT COUNT(*) AS n FROM proposals WHERE status IN ('accepted', 'partial') AND decided_at >= {:d}", { d: util.dayAdd(today, -30) }),
    actions: acts.map((a) => ({ id: a.id, op: a.op, summary: a.summary, at: a.created })),
  };
  return out;
}

/* -------------------------------------------------------------- manager */

function manager(ctx) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  // An empty board (not null) when nobody reports to the caller: the page says so instead of waiting.
  const out = { today: today, manager: false, direct: 0, team: 0, readouts: { out_today: 0, leave_days_month: 0, probation_30: 0, starting_30: 0 }, attention: [], people: [], board: { people: [] }, clock: null };
  if (ctx.isAgent) return out;
  // Approvals waiting for the caller come whether or not anyone reports to them (or they have an employee record).
  const ap = ctx.member !== null ? L('lib_approvals').pendingFor(ctx) : [];
  if (ap.length > 0) out.attention = [group('approvals', ap.map(approvalItem), ap.length, '#/inbox')];
  out.clock = clockPanel(ctx);
  if (ctx.employeeId === '' || !ctx.teamScope) return out;
  const pl = L('lib_people');
  const reps = pl.reportsOf(app, ctx.employeeId, today, true);
  out.manager = reps.length > 0;
  out.direct = reps.filter((x) => x.depth === 1).length;
  out.team = reps.length;
  if (reps.length === 0) return out;
  const bind = { d: today, ms: today.slice(0, 7) + '-01', me: util.monthEnd(today), e30: util.dayAdd(today, 30) };
  const inTeam = R().listWhere(
    reps.map((x) => x.employment),
    bind,
    'm.id',
    'tm',
  );
  out.readouts.out_today = util.count(app, "SELECT COUNT(DISTINCT r.employment) AS n FROM leave_requests r JOIN employments m ON m.id = r.employment WHERE r.status IN ('approved', 'cancelling') AND [[r.start]] <= {:d} AND [[r.end]] >= {:d} AND " + inTeam, bind);
  const lv = util.one(app, "SELECT CAST(ROUND(COALESCE(SUM(r.days), 0) * 10) AS INTEGER) AS n FROM leave_requests r JOIN employments m ON m.id = r.employment WHERE r.status IN ('approved', 'cancelling') AND r.unit = 'day' AND [[r.start]] <= {:me} AND [[r.end]] >= {:ms} AND " + inTeam, { n: 0 }, bind);
  out.readouts.leave_days_month = lv ? lv.n / 10 : 0;
  const prob = util.rows(app, "SELECT m.id AS id, m.probation_end AS day, e.number AS number, COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) AS name FROM employments m JOIN employees e ON e.id = m.employee WHERE m.probation_end != '' AND m.probation_end >= {:d} AND m.probation_end <= {:e30} AND " + inTeam + ' ORDER BY m.probation_end', { id: '', day: '', number: '', name: '' }, bind);
  out.readouts.probation_30 = prob.length;
  const groups = out.attention.slice();
  if (prob.length > 0) groups.push(group('probation', prob.map((x) => ({ id: x.id, title: x.name, person: x.name, due: x.day, link: '#/people/' + x.number + '?tab=job' })), undefined, '#/people'));
  out.attention = groups;
  out.board = teamPanel(ctx);
  out.people = reps.slice(0, 200).map((x) => ({ employee: x.employee, employment: x.employment, number: x.number, name: x.name, title: x.title, depth: x.depth }));
  return out;
}

/* ------------------------------------------------------------------- me */

function me(ctx, p) {
  const places = u().bool(p || {}, 'places', false);
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const out = { today: today, employee: null, employments: [], facts: [], documents: [], answers: [], requests_pending: 0, requests: [], requests_total: 0, clock: null, hub: null };
  if (ctx.member !== null) {
    out.requests_pending = util.count(app, "SELECT COUNT(*) AS n FROM approvals WHERE requester = {:m} AND status = 'pending'", { m: ctx.memberId });
    const req = read(ctx, 'approvals.list', { view: 'requested', status: 'any', limit: 6 });
    out.requests = req.approvals || [];
    out.requests_total = typeof req.total === 'number' ? req.total : out.requests.length;
    out.answers = util.findMany(app, 'agent_questions', 'asked_by = {:m}', '-created', 8, { m: ctx.memberId }).map((q) => ({ id: q.id, question: q.getString('question'), status: q.getString('status'), answer: q.getString('answer'), created: q.getString('created'), done_at: q.getString('answered_at'), ask: L('lib_agent').view(q, 'question_asked') }));
  }
  if (ctx.isAgent || ctx.employeeId === '') return out;
  const pl = L('lib_people');
  const e = util.byId(app, 'employees', ctx.employeeId);
  if (e === null) return out;
  const names = R().namer(app);
  const ems = util.findMany(app, 'employments', 'employee = {:e}', '-primary,-start_day', 10, { e: e.id });
  const primary = pl.primaryEmployment(app, e.id, today);
  for (const m of ems) {
    const v = pl.asOf(app, m.id, today >= m.getString('start_day') ? today : m.getString('start_day'));
    const job = v.job || {};
    const mgr = pl.managerOf(app, m.id, today);
    out.employments.push({ id: m.id, number: m.getString('number'), entity: m.getString('entity'), entity_name: names.entity(m.getString('entity')), currency: v.entity ? v.entity.currency : '', country: v.entity ? v.entity.country : '', status: m.getString('status'), start_day: m.getString('start_day'), end_day: m.getString('end_day'), probation_end: m.getString('probation_end'), primary: primary === m.id, title: job.title || '', department: job.department || '', department_name: names.department(job.department || ''), location_name: names.location(job.location || ''), manager: mgr ? { number: mgr.number, name: mgr.name } : null });
  }
  out.employee = { id: e.id, number: e.getString('number'), name: pl.displayName(e), legal_name: e.getString('legal_name'), photo: e.getString('photo') !== '', work_email: e.getString('work_email'), phone: e.getString('phone'), status: e.getString('status') };
  const main = out.employments.find((x) => x.primary) || out.employments[0] || null;
  if (places && main !== null) out.facts = L('lib_events').profileFacts(ctx, main.id).filter((x) => x.facts !== undefined && x.error === undefined);
  out.documents = util
    .findMany(app, 'documents', "employee = {:e} && needs_ack = true && acked_at = '' && visible_to_employee = true", '-created', 20, { e: e.id })
    .map((d) => ({ id: d.id, title: d.getString('title'), category: d.getString('category'), source: d.getString('source'), created: d.getString('created'), expires: d.getString('expires') }));
  if (!places) {
    out.clock = clockPanel(ctx);
    return out;
  }
  // The counts of the Me places, read here so the page needs one request.
  const tasks = read(ctx, 'tasks.list', { view: 'mine', status: 'open', limit: 1 });
  const pages = read(ctx, 'handbook.list', { view: 'read' });
  const slips = read(ctx, 'payslips.mine', { limit: 1 });
  const pin = read(ctx, 'kiosk.pin-status', {});
  const slip = (slips.payslips || [])[0] || null;
  out.hub = {
    tasks_open: typeof tasks.total === 'number' ? tasks.total : (tasks.tasks || []).length,
    to_read: (pages.pages || []).filter((x) => x.to_ack === true).length,
    last_payslip: slip ? { id: slip.id, pay_date: slip.pay_date } : null,
    kiosk_pin: pin.set === true,
  };
  return out;
}

/* ------------------------------------------------------------ directory */

/**
 * The company directory everyone may read: people in work today with their
 * work details only (name, title, department, location, entity, work email,
 * manager). No personal, pay or sealed data.
 */
function directory(ctx, p) {
  const util = u();
  const r = R();
  const app = ctx.app;
  const today = util.today(app);
  const f = r.filters(ctx, p, { span: 0 });
  const q = util.str(p, 'q', '').trim().toLowerCase();
  const pg = util.page(p, 60, 200);
  const names = r.namer(app);
  const seen = {};
  let rows = [];
  for (const x of r.population(app, f, today)) {
    if (seen[x.employee]) continue;
    seen[x.employee] = true;
    rows.push(x);
  }
  const emails = {};
  if (rows.length > 0) {
    const b = {};
    for (const e of util.rows(app, "SELECT id, COALESCE(work_email, '') AS work_email, CASE WHEN COALESCE(photo, '') != '' THEN 1 ELSE 0 END AS photo FROM employees WHERE " + r.listWhere(rows.map((x) => x.employee), b, 'id', 'em'), { id: '', work_email: '', photo: 0 }, b)) emails[e.id] = e;
  }
  let out = rows.map((x) => {
    const mgr = x.manager !== '' ? names.employee(x.manager) : { name: '', number: '' };
    return { employee: x.employee, number: x.number, name: x.name, title: x.title, department: x.department, department_name: names.department(x.department), location_name: names.location(x.location), entity_name: names.entity(x.entity), work_email: (emails[x.employee] || {}).work_email || '', manager_name: mgr.name, photo: ((emails[x.employee] || {}).photo || 0) === 1 };
  });
  if (q !== '') out = out.filter((x) => (x.name + ' ' + x.title + ' ' + x.department_name + ' ' + x.location_name + ' ' + x.work_email).toLowerCase().indexOf(q) >= 0);
  const departments = {};
  for (const x of out) if (x.department !== '') departments[x.department] = { id: x.department, name: x.department_name, people: ((departments[x.department] || {}).people || 0) + 1 };
  return { total: out.length, people: out.slice(pg.offset, pg.offset + pg.limit), departments: Object.keys(departments).map((k) => departments[k]).sort((a, b) => (a.name < b.name ? -1 : 1)) };
}

module.exports = { admin: admin, manager: manager, me: me, directory: directory };
