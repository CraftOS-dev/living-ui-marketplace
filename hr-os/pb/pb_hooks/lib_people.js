/// <reference path="../pb_data/types.d.ts" />
/**
 * People: employees, their employments (one per legal entity), the
 * effective-dated records (job, pay, tax), contacts and dependants,
 * identity documents and bank accounts (numbers sealed), documents with
 * acknowledgement, skills, the directory and the org chart.
 *
 * Contract for other modules (SPEC 3.2; plain objects, no permission
 * filtering, for module code that already checked the caller):
 *
 *   asOf(app, employmentId, day)  -> { employee, employment, entity, job, pay, tax, location, schedule, calendar }
 *   activeEmployments(app, { entity, from, to, ids }) -> [employment view + name, employee_number]
 *   managerOf(app, employmentId, day) -> { id, number, name, member } | null   (the manager's employee)
 *   reportsOf(app, employeeId, day, deep) -> [{ employee, employment, name, number, title, depth }]
 *   ageOn(employee, day) -> whole years | null
 *
 * Who sees whom (access): people:view and up within the caller's entities;
 * a manager (role with team_scope) their direct and indirect reports;
 * everyone themself. Pay figures need payroll:view, or self, or a manager
 * when the company lets managers see team pay; your AI agent sees pay
 * when the owner allows it. Sealed numbers are masked for everyone.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const PERSONAL = ['birth_date', 'gender', 'nationality', 'personal_email', 'address', 'emergency', 'dependants', 'kana', 'notes'];
const SELF_EDITABLE = ['preferred_name', 'phone', 'personal_email', 'address', 'emergency', 'dependants', 'kana', 'gender'];
const JOB_FIELDS = ['title', 'job_title', 'department', 'location', 'manager', 'grade', 'employment_type', 'fte', 'schedule', 'calendar', 'cost_center'];
const JOB_REASONS = ['hire', 'promotion', 'transfer', 'change', 'correction'];
const PAY_REASONS = ['hire', 'raise', 'promotion', 'adjustment', 'correction', 'change'];

/* ---------------------------------------------------------- references */

function displayName(emp) {
  if (!emp) return '';
  const get = (k) => (typeof emp.getString === 'function' ? emp.getString(k) : emp[k] || '');
  const pref = get('preferred_name');
  if (pref !== '') return pref;
  const fam = get('family_name');
  const giv = get('given_name');
  if (fam !== '' || giv !== '') return (get('name_order') === 'family_first' ? [fam, giv] : [giv, fam]).filter((x) => x !== '').join(' ');
  return get('legal_name');
}

/**
 * An employee by id, number (E0001), work email or name (legal, preferred,
 * or given and family name, ignoring case). Several people with that name:
 * 409 listing them; none: 404 with close names.
 */
function employeeRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the employee number (E0001), id, work email or name.', 'missing_param');
  const rec = util.byId(app, 'employees', r) || util.findOne(app, 'employees', 'number = {:n}', { n: r.toUpperCase() }) || (r.indexOf('@') > 0 ? util.findOne(app, 'employees', 'work_email = {:e}', { e: r.toLowerCase() }) : null);
  if (rec !== null) return rec;
  const sq = util.squash(r);
  const hits = util.rows(
    app,
    "SELECT id FROM employees WHERE LOWER(legal_name) = LOWER({:n}) OR LOWER(preferred_name) = LOWER({:n}) OR LOWER(TRIM(given_name || ' ' || family_name)) = LOWER({:n}) OR LOWER(TRIM(family_name || ' ' || given_name)) = LOWER({:n}) ORDER BY archived, number LIMIT 20",
    { id: '' },
    { n: sq },
  );
  // A single name (Priya, Kenji, Sam): exact given, family or preferred name, or the first word of the preferred or legal name.
  if (hits.length === 0 && sq.indexOf(' ') < 0) {
    const one = util.rows(
      app,
      "SELECT id FROM employees WHERE archived = FALSE AND (LOWER(given_name) = LOWER({:n}) OR LOWER(family_name) = LOWER({:n}) OR LOWER(preferred_name) = LOWER({:n}) OR INSTR(LOWER(preferred_name) || ' ', LOWER({:n}) || ' ') = 1 OR INSTR(LOWER(legal_name) || ' ', LOWER({:n}) || ' ') = 1 OR INSTR(LOWER(given_name) || ' ', LOWER({:n}) || ' ') = 1) ORDER BY number LIMIT 20",
      { id: '' },
      { n: sq },
    );
    for (const h of one) hits.push(h);
  }
  if (hits.length === 1) return app.findRecordById('employees', hits[0].id);
  if (hits.length > 1) {
    const matches = hits.map((h) => {
      const e = app.findRecordById('employees', h.id);
      return { number: e.getString('number'), name: displayName(e), work_email: e.getString('work_email'), status: e.getString('status') };
    });
    throw util.fail(409, 'More than one person is called "' + sq + '": ' + matches.map((m) => m.number + ' ' + m.name + (m.work_email ? ' (' + m.work_email + ')' : '')).join(', ') + '. Use the number.', 'ambiguous', { ref: r, matches: matches });
  }
  const like = util.rows(app, "SELECT number, legal_name, preferred_name FROM employees WHERE legal_name LIKE {:q} ESCAPE '\\' OR preferred_name LIKE {:q} ESCAPE '\\' ORDER BY archived, number LIMIT 5", { number: '', legal_name: '', preferred_name: '' }, { q: util.like(sq) });
  if (like.length > 0) throw util.fail(404, 'No employee "' + r + '". Did you mean ' + like.map((x) => x.number + ' ' + (x.preferred_name || x.legal_name)).join(', ') + '?', 'not_found', { ref: r, matches: like.map((x) => ({ number: x.number, name: x.preferred_name || x.legal_name })) });
  throw util.fail(404, 'No employee ' + r + '. Run people.directory --q <name> to find them.', 'not_found', { ref: r });
}

function employmentRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the employment id or number.', 'missing_param');
  const rec = util.byId(app, 'employments', r) || util.findOne(app, 'employments', 'number = {:n}', { n: r.toUpperCase() });
  if (rec !== null) return rec;
  // An employee reference (number, email or name) stands for their primary employment.
  const emp = employeeRef(app, r);
  const id = primaryEmployment(app, emp.id, util.today(app));
  if (id !== '') return app.findRecordById('employments', id);
  throw util.fail(404, displayName(emp) + ' (' + emp.getString('number') + ') has no employment yet.', 'not_found', { ref: r });
}

/** The employment of an employee in effect on `day` (primary first, else the latest started); '' when none. */
function primaryEmployment(app, employeeId, day) {
  const rows = u().rows(
    app,
    "SELECT id, [[primary]] AS p, start_day, end_day FROM employments WHERE employee = {:e} ORDER BY start_day DESC",
    { id: '', p: false, start_day: '', end_day: '' },
    { e: employeeId },
  );
  if (rows.length === 0) return '';
  const live = rows.filter((r) => r.start_day <= day && (r.end_day === '' || r.end_day >= day));
  const pool = live.length > 0 ? live : rows;
  const prim = pool.filter((r) => r.p)[0];
  return (prim || pool[0]).id;
}

/* ---------------------------------------------------------------- views */

function employeeView(app, rec, level) {
  const util = u();
  const v = {
    id: rec.id,
    number: rec.getString('number'),
    name: displayName(rec),
    legal_name: rec.getString('legal_name'),
    preferred_name: rec.getString('preferred_name'),
    family_name: rec.getString('family_name'),
    given_name: rec.getString('given_name'),
    name_order: rec.getString('name_order') || 'given_first',
    work_email: rec.getString('work_email'),
    phone: rec.getString('phone'),
    photo: rec.getString('photo') !== '',
    status: rec.getString('status'),
    archived: rec.getBool('archived'),
    member: rec.getString('member'),
  };
  if (level !== 'team') {
    v.kana = util.jsonOf(rec, 'kana', {}) || {};
    v.birth_date = rec.getString('birth_date');
    v.gender = rec.getString('gender');
    v.nationality = rec.getString('nationality');
    v.personal_email = rec.getString('personal_email');
    v.address = util.jsonOf(rec, 'address', {}) || {};
    v.emergency = util.jsonOf(rec, 'emergency', []) || [];
    v.dependants = util.jsonOf(rec, 'dependants', []) || [];
    if (level !== 'self') v.notes = rec.getString('notes');
  }
  return v;
}

function employmentView(rec) {
  return {
    id: rec.id,
    employee: rec.getString('employee'),
    entity: rec.getString('entity'),
    number: rec.getString('number'),
    start_day: rec.getString('start_day'),
    end_day: rec.getString('end_day'),
    notice_day: rec.getString('notice_day'),
    probation_end: rec.getString('probation_end'),
    status: rec.getString('status'),
    primary: rec.getBool('primary'),
    end_reason: rec.getString('end_reason'),
  };
}

function nameOf(app, collection, id, field) {
  if (!id) return '';
  const r = u().byId(app, collection, id);
  if (r === null) return '';
  if (collection === 'employees') return displayName(r);
  return r.getString(field || 'name');
}

function jobView(app, rec) {
  if (rec === null) return null;
  return {
    id: rec.id,
    employment: rec.getString('employment'),
    effective_from: rec.getString('effective_from'),
    title: rec.getString('title'),
    job_title: rec.getString('job_title'),
    job_title_name: nameOf(app, 'job_titles', rec.getString('job_title')),
    department: rec.getString('department'),
    department_name: nameOf(app, 'departments', rec.getString('department')),
    location: rec.getString('location'),
    location_name: nameOf(app, 'locations', rec.getString('location')),
    manager: rec.getString('manager'),
    manager_name: nameOf(app, 'employees', rec.getString('manager')),
    grade: rec.getString('grade'),
    grade_code: nameOf(app, 'grades', rec.getString('grade'), 'code'),
    employment_type: rec.getString('employment_type'),
    employment_type_code: nameOf(app, 'employment_types', rec.getString('employment_type'), 'code'),
    employment_type_name: nameOf(app, 'employment_types', rec.getString('employment_type')),
    fte: rec.getFloat('fte'),
    schedule: rec.getString('schedule'),
    schedule_name: nameOf(app, 'work_schedules', rec.getString('schedule')),
    calendar: rec.getString('calendar'),
    calendar_code: nameOf(app, 'holiday_calendars', rec.getString('calendar'), 'code'),
    cost_center: rec.getString('cost_center'),
    cost_center_code: nameOf(app, 'cost_centers', rec.getString('cost_center'), 'code'),
    reason: rec.getString('reason'),
    note: rec.getString('note'),
    approved_by: rec.getString('approved_by'),
    created: rec.getString('created'),
  };
}

function payView(rec) {
  if (rec === null) return null;
  const cur = rec.getString('currency');
  return {
    id: rec.id,
    employment: rec.getString('employment'),
    effective_from: rec.getString('effective_from'),
    basis: rec.getString('basis'),
    amount_minor: rec.getInt('amount_minor'),
    amount: L('lib_money').fromMinor(rec.getInt('amount_minor'), cur),
    currency: cur,
    per: rec.getString('per'),
    pay_schedule: rec.getString('pay_schedule'),
    reason: rec.getString('reason'),
    note: rec.getString('note'),
    approved_by: rec.getString('approved_by'),
    created: rec.getString('created'),
  };
}

function taxView(rec) {
  if (rec === null) return null;
  const util = u();
  return {
    id: rec.id,
    employment: rec.getString('employment'),
    effective_from: rec.getString('effective_from'),
    country: rec.getString('country'),
    packs: util.jsonOf(rec, 'packs', []) || [],
    fields: util.jsonOf(rec, 'fields', {}) || {},
    note: rec.getString('note'),
    created: rec.getString('created'),
  };
}

/** The effective-dated row of `collection` in effect on `day` (greatest effective_from <= day), or null. */
function rowOn(app, collection, employmentId, day) {
  const r = app.findRecordsByFilter(collection, 'employment = {:e} && effective_from <= {:d}', '-effective_from', 1, 0, { e: employmentId, d: day });
  return r.length > 0 ? r[0] : null;
}

/* ------------------------------------------------------------- contract */

function asOf(app, employmentId, day) {
  const util = u();
  const emp = util.byId(app, 'employments', employmentId);
  if (emp === null) throw util.fail(404, 'No employment ' + employmentId + '.', 'not_found');
  const d = day || util.today(app, emp.getString('entity'));
  const employee = app.findRecordById('employees', emp.getString('employee'));
  const ent = app.findRecordById('entities', emp.getString('entity'));
  const job = rowOn(app, 'job_records', emp.id, d);
  const loc = job !== null ? util.byId(app, 'locations', job.getString('location')) : null;
  const cal = L('lib_calendar');
  return {
    employee: employeeView(app, employee, 'full'),
    employment: employmentView(emp),
    entity: L('lib_org').entityView(app, ent),
    job: jobView(app, job),
    pay: payView(rowOn(app, 'pay_records', emp.id, d)),
    tax: taxView(rowOn(app, 'tax_profiles', emp.id, d)),
    location: loc !== null ? L('lib_org').locationView(app, loc) : null,
    schedule: cal.scheduleOf(app, emp.id, d),
    calendar: cal.calendarOf(app, emp.id, d),
    day: d,
  };
}

function activeEmployments(app, opts) {
  const util = u();
  const o = opts || {};
  const from = o.from || util.today(app);
  const to = o.to || from;
  const where = ["m.start_day <= {:to}", "(m.end_day = '' OR m.end_day >= {:from})"];
  const bind = { from: from, to: to };
  if (o.entity) {
    where.push('m.entity = {:ent}');
    bind.ent = o.entity;
  }
  if (Array.isArray(o.ids)) {
    if (o.ids.length === 0) return [];
    const keys = [];
    o.ids.forEach((id, i) => {
      keys.push('{:i' + i + '}');
      bind['i' + i] = String(id);
    });
    where.push('m.id IN (' + keys.join(',') + ')');
  }
  const rows = util.rows(
    app,
    'SELECT m.id AS id FROM employments m WHERE ' + where.join(' AND ') + ' ORDER BY m.number',
    { id: '' },
    bind,
  );
  return rows.map((r) => {
    const m = app.findRecordById('employments', r.id);
    const e = app.findRecordById('employees', m.getString('employee'));
    return Object.assign(employmentView(m), { name: displayName(e), employee_number: e.getString('number') });
  });
}

function managerOf(app, employmentId, day) {
  const util = u();
  const d = day || util.today(app);
  const job = rowOn(app, 'job_records', employmentId, d);
  if (job === null || job.getString('manager') === '') return null;
  const m = util.byId(app, 'employees', job.getString('manager'));
  if (m === null) return null;
  return { id: m.id, number: m.getString('number'), name: displayName(m), member: m.getString('member') };
}

function directReports(app, employeeId, day) {
  return u().rows(
    app,
    "SELECT m.id AS employment, m.employee AS employee, COALESCE(j.title, '') AS title FROM employments m JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= {:d} ORDER BY j2.effective_from DESC LIMIT 1) WHERE j.manager = {:e} AND m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d})",
    { employment: '', employee: '', title: '' },
    { e: employeeId, d: day },
  );
}

function reportsOf(app, employeeId, day, deep) {
  const util = u();
  const d = day || util.today(app);
  const out = [];
  const seen = {};
  seen[employeeId] = true;
  let frontier = [employeeId];
  let depth = 1;
  while (frontier.length > 0 && depth <= 30) {
    const next = [];
    for (const mgr of frontier) {
      for (const r of directReports(app, mgr, d)) {
        if (seen[r.employee] && out.some((x) => x.employment === r.employment)) continue;
        const e = util.byId(app, 'employees', r.employee);
        out.push({ employee: r.employee, employment: r.employment, name: e ? displayName(e) : '', number: e ? e.getString('number') : '', title: r.title, depth: depth, manager: mgr });
        if (!seen[r.employee]) {
          seen[r.employee] = true;
          next.push(r.employee);
        }
      }
    }
    if (!deep) break;
    frontier = next;
    depth++;
  }
  return out;
}

function ageOn(employee, day) {
  const b = employee ? (typeof employee.getString === 'function' ? employee.getString('birth_date') : employee.birth_date || '') : '';
  if (!u().isDay(b) || !u().isDay(day)) return null;
  let age = Number(day.slice(0, 4)) - Number(b.slice(0, 4));
  if (day.slice(5) < b.slice(5)) age--;
  return age;
}

/* --------------------------------------------------------------- access */

/** Entity ids of an employee's employments. */
function entitiesOf(app, employeeId) {
  return u()
    .rows(app, 'SELECT DISTINCT entity FROM employments WHERE employee = {:e}', { entity: '' }, { e: employeeId })
    .map((r) => r.entity);
}

/**
 * What the caller may see of an employee: 'full' | 'edit' | 'view'
 * (module rights within their entities), 'self', 'team' (a manager of a
 * report), or 'none'. Your AI agent: 'view'.
 */
function access(ctx, emp) {
  const auth = L('lib_auth');
  if (ctx.isAgent || ctx.actor === 'system') return ctx.isAgent ? 'view' : 'full';
  const lvl = auth.level(ctx, 'people');
  if (lvl !== 'none') {
    const sc = auth.scope(ctx);
    const ents = entitiesOf(ctx.app, emp.id);
    if (sc.length === 0 || ents.length === 0 || ents.some((x) => sc.indexOf(x) >= 0)) return lvl;
  }
  if (auth.selfEmployee(ctx) === emp.id) return 'self';
  if (ctx.teamScope && ctx.employeeId !== '') {
    const d = u().today(ctx.app);
    for (const r of u().rows(ctx.app, 'SELECT id FROM employments WHERE employee = {:e}', { id: '' }, { e: emp.id })) if (auth.isManagerOf(ctx, r.id, d)) return 'team';
  }
  return 'none';
}

function canSeeEmployee(ctx, emp) {
  return access(ctx, emp) !== 'none';
}

/** Throw 403 unless the caller may see this employment's person. */
function needSee(ctx, employmentRec) {
  const emp = ctx.app.findRecordById('employees', employmentRec.getString('employee'));
  const a = access(ctx, emp);
  if (a === 'none') throw u().fail(403, 'You cannot see this person.', 'not_permitted');
  return a;
}

function canEditEmployee(ctx, emp) {
  const a = access(ctx, emp);
  return a === 'full' || a === 'edit' || ctx.isAgent;
}

function needEdit(ctx, emp) {
  if (!canEditEmployee(ctx, emp)) throw u().fail(403, (ctx.isAgent ? 'Your AI agent' : 'Your role') + ' cannot change this person (needs edit access to People).', 'not_permitted');
}

/** May the caller see pay figures of this employment? */
function canSeePay(ctx, employmentRec) {
  const auth = L('lib_auth');
  const s = L('lib_settings').row(ctx.app);
  if (ctx.isAgent) return s.getBool('agent_sees_pay');
  if (ctx.actor === 'system') return true;
  if (auth.can(ctx, 'payroll', 'view') && auth.inScope(ctx, employmentRec.getString('entity'))) return true;
  if (auth.selfEmployee(ctx) === employmentRec.getString('employee')) return true;
  if (s.getBool('managers_see_pay') && auth.isManagerOf(ctx, employmentRec.id, u().today(ctx.app))) return true;
  return false;
}

/* ------------------------------------------------------------ directory */

function visibleWhere(ctx, day, bind) {
  const auth = L('lib_auth');
  if (ctx.isAgent || auth.can(ctx, 'people', 'view')) {
    const sc = auth.scope(ctx);
    if (sc.length === 0) return '1 = 1';
    const keys = sc.map((id, i) => {
      bind['s' + i] = id;
      return '{:s' + i + '}';
    });
    return 'm.entity IN (' + keys.join(',') + ')';
  }
  const ids = [];
  if (ctx.teamScope && ctx.employeeId !== '') for (const r of reportsOf(ctx.app, ctx.employeeId, day, true)) ids.push(r.employment);
  const parts = ['m.employee = {:self}'];
  bind.self = ctx.employeeId || '-';
  if (ids.length > 0) {
    const keys = ids.map((id, i) => {
      bind['r' + i] = id;
      return '{:r' + i + '}';
    });
    parts.push('m.id IN (' + keys.join(',') + ')');
  }
  return '(' + parts.join(' OR ') + ')';
}

function directory(ctx, p) {
  const util = u();
  const app = ctx.app;
  const day = util.day(p, 'as_of', util.today(app));
  const pg = util.page(p, 50, 500);
  const bind = { d: day };
  const where = [visibleWhere(ctx, day, bind)];
  const status = util.oneOf(p, 'status', ['current', 'upcoming', 'former', 'all'], 'current');
  if (status === 'current') where.push("m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d})");
  else if (status === 'upcoming') where.push('m.start_day > {:d}');
  else if (status === 'former') where.push("m.end_day != '' AND m.end_day < {:d}");
  if (!util.bool(p, 'archived', false)) where.push('e.archived = FALSE');
  const f = (name, sql, ref) => {
    const v = util.str(p, name, '');
    if (v === '') return;
    where.push(sql);
    bind[name] = ref(v);
  };
  f('entity', 'm.entity = {:entity}', (v) => L('lib_org').entityRef(app, v).id);
  f('department', 'j.department = {:department}', (v) => L('lib_org').kindRef(app, 'department', v).id);
  f('location', 'j.location = {:location}', (v) => L('lib_org').kindRef(app, 'location', v).id);
  f('manager', 'j.manager = {:manager}', (v) => employeeRef(app, v).id);
  f('employment_type', 'j.employment_type = {:employment_type}', (v) => L('lib_org').kindRef(app, 'employment_type', v).id);
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(e.legal_name LIKE {:q} ESCAPE '\\' OR e.preferred_name LIKE {:q} ESCAPE '\\' OR e.family_name LIKE {:q} ESCAPE '\\' OR e.given_name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\' OR e.work_email LIKE {:q} ESCAPE '\\' OR COALESCE(j.title, '') LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const from =
    ' FROM employments m JOIN employees e ON e.id = m.employee' +
    ' LEFT JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id ORDER BY CASE WHEN j2.effective_from <= {:d} THEN 0 ELSE 1 END, CASE WHEN j2.effective_from <= {:d} THEN j2.effective_from END DESC, j2.effective_from LIMIT 1)' +
    ' LEFT JOIN departments d ON d.id = j.department LEFT JOIN locations l ON l.id = j.location LEFT JOIN entities n ON n.id = m.entity' +
    ' WHERE ' +
    where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n' + from, bind);
  const sort = util.oneOf(p, 'sort', ['name', 'number', 'start_day', 'department'], 'name');
  const order = sort === 'number' ? 'e.number' : sort === 'start_day' ? 'm.start_day DESC' : sort === 'department' ? "COALESCE(d.name, '') COLLATE NOCASE, e.legal_name COLLATE NOCASE" : "COALESCE(NULLIF(e.preferred_name, ''), e.legal_name) COLLATE NOCASE";
  const rows = util.rows(
    app,
    "SELECT m.id AS employment, m.number AS employment_number, m.entity AS entity, COALESCE(n.name, '') AS entity_name, m.start_day AS start_day, m.end_day AS end_day, m.status AS employment_status, e.id AS employee, e.number AS number, e.legal_name AS legal_name, e.preferred_name AS preferred_name, e.family_name AS family_name, e.given_name AS given_name, e.name_order AS name_order, e.work_email AS work_email, e.phone AS phone, e.status AS status, e.photo AS photo, COALESCE(j.title, '') AS title, COALESCE(j.department, '') AS department, COALESCE(d.name, '') AS department_name, COALESCE(j.location, '') AS location, COALESCE(l.name, '') AS location_name, COALESCE(j.manager, '') AS manager" +
      from +
      ' ORDER BY ' +
      order +
      ' LIMIT ' +
      pg.limit +
      ' OFFSET ' +
      pg.offset,
    { employment: '', employment_number: '', entity: '', entity_name: '', start_day: '', end_day: '', employment_status: '', employee: '', number: '', legal_name: '', preferred_name: '', family_name: '', given_name: '', name_order: '', work_email: '', phone: '', status: '', photo: '', title: '', department: '', department_name: '', location: '', location_name: '', manager: '' },
    bind,
  );
  const mgrNames = {};
  const people = rows.map((r) => {
    if (r.manager !== '' && mgrNames[r.manager] === undefined) mgrNames[r.manager] = nameOf(app, 'employees', r.manager);
    return {
      employee: r.employee,
      employment: r.employment,
      number: r.number,
      name: displayName(r),
      legal_name: r.legal_name,
      title: r.title,
      department: r.department,
      department_name: r.department_name,
      location: r.location,
      location_name: r.location_name,
      entity: r.entity,
      entity_name: r.entity_name,
      manager: r.manager,
      manager_name: r.manager !== '' ? mgrNames[r.manager] : '',
      work_email: r.work_email,
      phone: r.phone,
      photo: r.photo !== '',
      status: r.status,
      employment_status: r.employment_status,
      start_day: r.start_day,
      end_day: r.end_day,
    };
  });
  return { people: people, total: total, limit: pg.limit, offset: pg.offset, as_of: day };
}

/** Org chart as of a day: nodes with their manager (employee ids), within what the caller sees. */
function orgChart(ctx, p) {
  const util = u();
  const app = ctx.app;
  const day = util.day(p, 'as_of', util.today(app));
  const q = { as_of: day, status: 'current', limit: 500 };
  if (util.str(p, 'entity', '') !== '') q.entity = util.str(p, 'entity', '');
  if (util.str(p, 'department', '') !== '') q.department = util.str(p, 'department', '');
  const all = [];
  let offset = 0;
  for (let i = 0; i < 40; i++) {
    const r = directory(ctx, Object.assign({}, q, { offset: offset }));
    for (const x of r.people) all.push(x);
    offset += r.people.length;
    if (offset >= r.total || r.people.length === 0) break;
  }
  const seen = {};
  const nodes = [];
  for (const x of all) {
    if (seen[x.employee]) continue;
    seen[x.employee] = true;
    nodes.push({ employee: x.employee, employment: x.employment, number: x.number, name: x.name, title: x.title, department_name: x.department_name, location_name: x.location_name, entity_name: x.entity_name, manager: x.manager, photo: x.photo, reports: 0 });
  }
  const byId = {};
  for (const n of nodes) byId[n.employee] = n;
  for (const n of nodes) if (n.manager !== '' && byId[n.manager]) byId[n.manager].reports++;
  const roots = nodes.filter((n) => n.manager === '' || byId[n.manager] === undefined).map((n) => n.employee);
  return { as_of: day, nodes: nodes, roots: roots, total: nodes.length };
}

/* -------------------------------------------------------------- profile */

function timelineRows(app, collection, employmentId, today, view) {
  return u()
    .findMany(app, collection, 'employment = {:e}', 'effective_from', 0, { e: employmentId })
    .map((r, i, arr) => {
      const v = view(app, r);
      const next = arr[i + 1];
      v.state = r.getString('effective_from') > today ? 'scheduled' : next && next.getString('effective_from') <= today ? 'past' : 'current';
      return v;
    });
}

function employmentDetail(ctx, m, day, seePay) {
  const app = ctx.app;
  const v = employmentView(m);
  const ent = app.findRecordById('entities', m.getString('entity'));
  v.entity_name = ent.getString('name');
  v.currency = ent.getString('currency');
  v.country = ent.getString('country');
  v.packs = u().jsonOf(ent, 'packs', []) || [];
  v.profile_fields = L('lib_countries').profileFields(v.packs, day);
  // Before the first day (a pre-hire) the records of the first day show.
  const at = day < m.getString('start_day') ? m.getString('start_day') : day;
  v.job = jobView(app, rowOn(app, 'job_records', m.id, at));
  v.pay = seePay ? payView(rowOn(app, 'pay_records', m.id, at)) : null;
  v.pay_hidden = !seePay;
  v.tax = seePay ? taxView(rowOn(app, 'tax_profiles', m.id, at)) : null;
  const upcoming = [];
  for (const r of u().findMany(app, 'job_records', 'employment = {:e} && effective_from > {:d}', 'effective_from', 0, { e: m.id, d: at })) upcoming.push({ kind: 'job', effective_from: r.getString('effective_from'), id: r.id, reason: r.getString('reason') });
  if (seePay) for (const r of u().findMany(app, 'pay_records', 'employment = {:e} && effective_from > {:d}', 'effective_from', 0, { e: m.id, d: at })) upcoming.push({ kind: 'pay', effective_from: r.getString('effective_from'), id: r.id, reason: r.getString('reason') });
  upcoming.sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  v.upcoming = upcoming;
  return v;
}

function bankView(rec) {
  return {
    id: rec.id,
    employee: rec.getString('employee'),
    label: rec.getString('label'),
    country: rec.getString('country'),
    currency: rec.getString('currency'),
    bank_name: rec.getString('bank_name'),
    bank_code: rec.getString('bank_code'),
    branch_code: rec.getString('branch_code'),
    account_type: rec.getString('account_type'),
    holder: rec.getString('holder'),
    number_masked: rec.getString('number_masked'),
    iban_masked: rec.getString('iban_masked'),
    swift: rec.getString('swift'),
    split: u().jsonOf(rec, 'split', { kind: 'rest' }) || { kind: 'rest' },
    status: rec.getString('status'),
    approval: rec.getString('approval'),
    approved_by: rec.getString('approved_by'),
    approved_at: rec.getString('approved_at'),
    created: rec.getString('created'),
  };
}

function idView(rec) {
  return {
    id: rec.id,
    employee: rec.getString('employee'),
    type: rec.getString('type'),
    country: rec.getString('country'),
    number_masked: rec.getString('number_masked'),
    issued: rec.getString('issued'),
    expires: rec.getString('expires'),
    has_file: rec.getString('file') !== '',
    note: rec.getString('note'),
    created: rec.getString('created'),
  };
}

function documentView(rec) {
  return {
    id: rec.id,
    employee: rec.getString('employee'),
    employment: rec.getString('employment'),
    category: rec.getString('category'),
    title: rec.getString('title'),
    has_file: rec.getString('file') !== '',
    file_name: rec.getString('file'),
    visible_to_employee: rec.getBool('visible_to_employee'),
    needs_ack: rec.getBool('needs_ack'),
    acked_at: rec.getString('acked_at'),
    expires: rec.getString('expires'),
    source: rec.getString('source'),
    note: rec.getString('note'),
    created: rec.getString('created'),
  };
}

function skillView(rec) {
  return { id: rec.id, employee: rec.getString('employee'), skill: rec.getString('skill'), level: rec.getInt('level'), verified_by: rec.getString('verified_by'), note: rec.getString('note') };
}

function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = employeeRef(app, util.req(p, 'employee'));
  const level = access(ctx, emp);
  if (level === 'none') throw util.fail(403, 'You cannot see this person.', 'not_permitted');
  const day = util.day(p, 'as_of', util.today(app));
  const auth = L('lib_auth');
  const own = auth.selfEmployee(ctx) === emp.id;
  const employments = util.findMany(app, 'employments', 'employee = {:e}', '-start_day', 0, { e: emp.id }).map((m) => employmentDetail(ctx, m, day, canSeePay(ctx, m)));
  const primary = primaryEmployment(app, emp.id, day);
  const out = {
    employee: employeeView(app, emp, level),
    access: level,
    can: {
      edit: canEditEmployee(ctx, emp),
      edit_self: own,
      hire: !ctx.isAgent && auth.can(ctx, 'people', 'full'),
      job: ctx.isAgent || auth.can(ctx, 'people', 'edit'),
      pay: ctx.isAgent || auth.can(ctx, 'payroll', 'edit'),
      bank: own || (!ctx.isAgent && (auth.can(ctx, 'people', 'full') || auth.can(ctx, 'payroll', 'edit'))),
      reveal: !ctx.isAgent && (own || auth.can(ctx, 'people', 'full') || auth.can(ctx, 'payroll', 'edit')),
    },
    employments: employments,
    primary_employment: primary,
    manager: primary !== '' ? managerOf(app, primary, day) : null,
    reports: reportsOf(app, emp.id, day, false).length,
    as_of: day,
  };
  if (level !== 'team') {
    out.bank_accounts = util.findMany(app, 'bank_accounts', 'employee = {:e}', 'sort,created', 0, { e: emp.id }).map(bankView);
    out.identity_docs = util.findMany(app, 'identity_docs', 'employee = {:e}', 'type', 0, { e: emp.id }).map(idView);
    out.skills = util.findMany(app, 'employee_skills', 'employee = {:e}', 'skill', 0, { e: emp.id }).map(skillView);
    out.documents = util
      .findMany(app, 'documents', own && level === 'self' ? 'employee = {:e} && visible_to_employee = true' : 'employee = {:e}', '-created', 100, { e: emp.id })
      .map(documentView);
  }
  out.facts = primary !== '' ? L('lib_events').profileFacts(ctx, primary) : [];
  return out;
}

function timeline(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = employmentRef(app, util.req(p, 'employment'));
  needSee(ctx, m);
  const today = util.today(app, m.getString('entity'));
  const seePay = canSeePay(ctx, m);
  return {
    employment: employmentView(m),
    today: today,
    job: timelineRows(app, 'job_records', m.id, today, jobView),
    pay: seePay ? timelineRows(app, 'pay_records', m.id, today, (a, r) => payView(r)) : null,
    tax: seePay ? timelineRows(app, 'tax_profiles', m.id, today, (a, r) => taxView(r)) : null,
    pay_hidden: !seePay,
    changes: L('lib_audit').forRecord(app, 'employments', m.id, 30),
  };
}

/* ------------------------------------------------------------- writing */

function personFields(ctx, rec, p, allowed) {
  const util = u();
  const set = (k, v) => {
    if (allowed.indexOf(k) < 0) throw util.fail(403, 'You cannot change ' + k + ' here.', 'not_permitted', { param: k });
    rec.set(k, v);
  };
  const texts = { legal_name: 200, preferred_name: 120, family_name: 120, given_name: 120, gender: 60, phone: 40, notes: 4000 };
  for (const k of Object.keys(texts)) if (util.has(p, k)) set(k, util.squash(util.text(p, k, texts[k], '')));
  if (util.has(p, 'name_order')) set('name_order', util.oneOf(p, 'name_order', ['family_first', 'given_first'], 'given_first'));
  if (util.has(p, 'birth_date')) set('birth_date', util.day(p, 'birth_date', ''));
  if (util.has(p, 'nationality')) {
    const c = util.str(p, 'nationality', '').toUpperCase();
    if (c !== '' && !/^[A-Z]{2}$/.test(c)) throw util.fail(400, 'nationality is a two-letter country code.', 'invalid_param', { param: 'nationality' });
    set('nationality', c);
  }
  for (const k of ['personal_email', 'work_email']) {
    if (!util.has(p, k)) continue;
    const v = util.str(p, k, '').toLowerCase();
    if (v !== '') L('lib_auth').checkEmail(v);
    if (k === 'work_email' && v !== '') {
      const dup = util.findOne(ctx.app, 'employees', 'work_email = {:e} && id != {:x}', { e: v, x: rec.id || '' });
      if (dup !== null) throw util.fail(409, v + ' is the work email of ' + displayName(dup) + '.', 'duplicate', { param: k });
    }
    set(k, v);
  }
  if (util.has(p, 'address')) set('address', util.obj(p, 'address'));
  if (util.has(p, 'kana')) set('kana', util.obj(p, 'kana'));
  if (util.has(p, 'emergency')) {
    const list = util.list(p, 'emergency');
    if (list.length > 10) throw util.fail(400, 'At most 10 emergency contacts.', 'invalid_param');
    set(
      'emergency',
      list.map((c, i) => {
        util.keysOnly(c, ['name', 'relation', 'phone', 'email', 'address', 'primary'], 'emergency contact ' + (i + 1));
        if (!c.name || String(c.name).trim() === '') throw util.fail(400, 'emergency contact ' + (i + 1) + ' needs a name.', 'invalid_param');
        return { name: util.clip(util.squash(c.name), 120), relation: util.clip(c.relation || '', 60), phone: util.clip(c.phone || '', 40), email: util.clip(c.email || '', 160), address: util.clip(c.address || '', 400), primary: c.primary === true };
      }),
    );
  }
  if (util.has(p, 'dependants')) {
    const list = util.list(p, 'dependants');
    if (list.length > 20) throw util.fail(400, 'At most 20 dependants.', 'invalid_param');
    set(
      'dependants',
      list.map((c, i) => {
        util.keysOnly(c, ['name', 'relation', 'birth_date', 'tax_dependant', 'disabled', 'note'], 'dependant ' + (i + 1));
        if (!c.name || String(c.name).trim() === '') throw util.fail(400, 'dependant ' + (i + 1) + ' needs a name.', 'invalid_param');
        if (c.birth_date && !util.isDay(c.birth_date)) throw util.fail(400, 'dependant ' + (i + 1) + ': birth_date is YYYY-MM-DD.', 'invalid_param');
        return { name: util.clip(util.squash(c.name), 120), relation: util.clip(c.relation || '', 60), birth_date: c.birth_date || '', tax_dependant: c.tax_dependant === true, disabled: c.disabled === true, note: util.clip(c.note || '', 400) };
      }),
    );
  }
}

/** Resolve job fields from params into a plain object of record values (ids). */
function jobValues(ctx, p, base) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const cal = L('lib_calendar');
  const v = Object.assign({}, base || {});
  const ref = (name, fn) => {
    if (!util.has(p, name)) return;
    const r = util.str(p, name, '');
    v[name] = r === '' ? '' : fn(r).id;
  };
  if (util.has(p, 'title')) v.title = util.squash(util.text(p, 'title', 160, ''));
  ref('job_title', (r) => org.kindRef(app, 'title', r));
  ref('department', (r) => org.kindRef(app, 'department', r));
  ref('location', (r) => org.kindRef(app, 'location', r));
  ref('manager', (r) => employeeRef(app, r));
  ref('grade', (r) => org.kindRef(app, 'grade', r));
  ref('employment_type', (r) => org.kindRef(app, 'employment_type', r));
  ref('schedule', (r) => cal.scheduleRef(app, r));
  ref('calendar', (r) => cal.calendarRef(app, r));
  ref('cost_center', (r) => org.kindRef(app, 'cost_center', r));
  if (util.has(p, 'fte')) v.fte = util.num(p, 'fte', { min: 0.01, max: 1.5 });
  if (v.title === '' && v.job_title) v.title = nameOf(app, 'job_titles', v.job_title);
  return v;
}

function jobBase(rec) {
  if (rec === null) return { fte: 1 };
  const out = {};
  for (const k of JOB_FIELDS) out[k] = k === 'fte' ? rec.getFloat('fte') : rec.getString(k);
  return out;
}

function writeJob(app, employmentId, day, values, reason, note, approvedBy) {
  const util = u();
  const rec = util.newRecord(app, 'job_records');
  rec.set('employment', employmentId);
  rec.set('effective_from', day);
  for (const k of JOB_FIELDS) if (values[k] !== undefined) rec.set(k, values[k]);
  if (!values.fte) rec.set('fte', 1);
  rec.set('reason', reason);
  rec.set('note', util.clip(note || '', 2000));
  rec.set('approved_by', approvedBy || '');
  app.save(rec);
  return rec;
}

/** Pay params (pay_basis, pay_amount, pay_per, pay_schedule) -> record values, or null when no amount is given. */
function payValues(p, currency, prefix) {
  const util = u();
  const k = (n) => (prefix ? prefix + n : n);
  if (!util.has(p, k('amount')) || util.str(p, k('amount'), '') === '') return null;
  const basis = util.oneOf(p, k('basis'), ['salary', 'hourly', 'daily'], 'salary');
  const per = util.oneOf(p, k('per'), ['year', 'month', 'week', 'day', 'hour'], basis === 'hourly' ? 'hour' : basis === 'daily' ? 'day' : 'month');
  if (basis === 'hourly' && per !== 'hour') throw util.fail(400, 'An hourly rate is per hour.', 'invalid_param', { param: k('per') });
  if (basis === 'daily' && per !== 'day') throw util.fail(400, 'A daily rate is per day.', 'invalid_param', { param: k('per') });
  return { basis: basis, amount_minor: util.money(p, k('amount'), currency, { required: true }), currency: currency, per: per, pay_schedule: util.text(p, k('schedule'), 30, '') || '' };
}

function writePay(app, employmentId, day, values, reason, note, approvedBy) {
  const util = u();
  const rec = util.newRecord(app, 'pay_records');
  rec.set('employment', employmentId);
  rec.set('effective_from', day);
  for (const k of ['basis', 'amount_minor', 'currency', 'per', 'pay_schedule']) rec.set(k, values[k]);
  rec.set('reason', reason);
  rec.set('note', util.clip(note || '', 2000));
  rec.set('approved_by', approvedBy || '');
  app.save(rec);
  return rec;
}

function writeTax(app, employmentId, day, country, packs, fields, note) {
  const util = u();
  const rec = util.newRecord(app, 'tax_profiles');
  rec.set('employment', employmentId);
  rec.set('effective_from', day);
  rec.set('country', country);
  rec.set('packs', packs || []);
  rec.set('fields', fields || {});
  rec.set('note', util.clip(note || '', 2000));
  app.save(rec);
  return rec;
}

function statusFor(startDay, endDay, today) {
  if (startDay > today) return 'pre_hire';
  if (endDay !== '' && endDay < today) return 'ended';
  if (endDay !== '') return 'notice';
  return 'active';
}

function employeeStatus(app, employeeId, today) {
  const rows = u().rows(app, 'SELECT start_day, end_day, status FROM employments WHERE employee = {:e}', { start_day: '', end_day: '', status: '' }, { e: employeeId });
  if (rows.length === 0) return 'pre_hire';
  const st = rows.map((r) => (r.status === 'on_leave' ? 'on_leave' : statusFor(r.start_day, r.end_day, today)));
  if (st.indexOf('active') >= 0) return 'active';
  if (st.indexOf('on_leave') >= 0) return 'on_leave';
  if (st.indexOf('notice') >= 0) return 'leaving';
  if (st.indexOf('pre_hire') >= 0) return 'pre_hire';
  return 'left';
}

/**
 * people.hire: a new person (or, with --employee, a new employment of an
 * existing one): employee, employment, first job record, optional first pay
 * record and a tax profile with the entity's packs. Emits employment.hired.
 */
function hire(ctx, p) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const ent = org.entityRef(app, util.req(p, 'entity'));
  if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'You cannot hire into ' + ent.getString('name') + '.', 'not_permitted');
  const start = util.day(p, 'start_day', '');
  if (start === '') throw util.fail(400, 'start_day is required, e.g. --start_day 2026-12-01', 'missing_param', { param: 'start_day' });
  const probation = util.day(p, 'probation_end', '');
  if (probation !== '' && probation < start) throw util.fail(400, 'probation_end is before start_day.', 'invalid_param');
  const existingRef = util.str(p, 'employee', '');
  const currency = ent.getString('currency');
  const pay = payValues({ amount: p.pay_amount, basis: p.pay_basis, per: p.pay_per, schedule: p.pay_schedule }, currency);
  const today = util.today(app, ent.id);
  const taxFields = util.obj(p, 'tax_fields') || {};
  const taxPacks = util.has(p, 'tax_packs') ? (util.list(p, 'tax_packs') || []).map(String) : util.jsonOf(ent, 'packs', []) || [];
  const fromApp = util.str(p, 'from_application', '');
  let employee = null;
  let employment = null;
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    if (existingRef !== '') {
      employee = employeeRef(tx, existingRef);
      const overlap = util.rows(tx, "SELECT id FROM employments WHERE employee = {:e} AND entity = {:n} AND (end_day = '' OR end_day >= {:s})", { id: '' }, { e: employee.id, n: ent.id, s: start });
      if (overlap.length > 0) throw util.fail(409, displayName(employee) + ' is already employed by ' + ent.getString('name') + ' on that day.', 'overlap');
    } else {
      const legal = util.squash(util.text(p, 'legal_name', 200, ''));
      if (legal === '') throw util.fail(400, 'legal_name is required', 'missing_param', { param: 'legal_name' });
      employee = util.newRecord(tx, 'employees');
      employee.set('number', 'E' + String(util.nextNumber(tx, 'employee')).padStart(4, '0'));
      employee.set('status', statusFor(start, '', today) === 'pre_hire' ? 'pre_hire' : 'active');
      employee.set('name_order', (L('lib_countries').info(ent.getString('country')) || {}).name_order || 'given_first');
      employee.set('address', {});
      employee.set('emergency', []);
      employee.set('dependants', []);
      employee.set('kana', {});
      personFields(tctx, employee, p, ['legal_name', 'preferred_name', 'family_name', 'given_name', 'name_order', 'birth_date', 'gender', 'nationality', 'personal_email', 'work_email', 'phone', 'address', 'kana', 'emergency', 'dependants', 'notes']);
      tx.save(employee);
    }
    const count = util.count(tx, 'SELECT COUNT(*) AS n FROM employments WHERE employee = {:e}', { e: employee.id });
    employment = util.newRecord(tx, 'employments');
    employment.set('employee', employee.id);
    employment.set('entity', ent.id);
    employment.set('number', employee.getString('number') + (count > 0 ? '-' + (count + 1) : ''));
    employment.set('start_day', start);
    employment.set('probation_end', probation);
    employment.set('status', statusFor(start, '', today));
    employment.set('primary', count === 0 || util.bool(p, 'primary', false));
    tx.save(employment);
    if (employment.getBool('primary') && count > 0) util.exec(tx, 'UPDATE employments SET [[primary]] = FALSE WHERE employee = {:e} AND id != {:m}', { e: employee.id, m: employment.id });
    const jv = jobValues(tctx, p, { fte: 1, schedule: '', calendar: '' });
    if (!jv.employment_type) {
      const ft = util.findOne(tx, 'employment_types', "code = 'full_time'", {});
      if (ft !== null) jv.employment_type = ft.id;
    }
    writeJob(tx, employment.id, start, jv, 'hire', util.text(p, 'note', 2000, ''), ctx.memberId);
    if (pay !== null) writePay(tx, employment.id, start, pay, 'hire', '', ctx.memberId);
    writeTax(tx, employment.id, start, ent.getString('country'), taxPacks, taxFields, '');
    const fresh = tx.findRecordById('employees', employee.id);
    if (existingRef !== '') {
      fresh.set('status', employeeStatus(tx, employee.id, today));
      tx.save(fresh);
    }
    L('lib_audit').write(tctx, { op: 'people.hire', collection: 'employments', record: employment.id, summary: (existingRef !== '' ? 'New employment for ' : 'Hired ') + displayName(fresh) + ' (' + fresh.getString('number') + ') at ' + ent.getString('name') + ' from ' + start, after: { employee: fresh.getString('number'), entity: ent.getString('name'), start_day: start, title: jv.title || '' } });
  });
  ctx.audited = true;
  const events = L('lib_events').emit(ctx, 'employment.hired', { employment: employment.id, employee: employee.id, entity: ent.id, start_day: start, from_application: fromApp });
  return { employee: employeeView(app, app.findRecordById('employees', employee.id), 'full'), employment: employmentView(app.findRecordById('employments', employment.id)), events: events };
}

/** people.update: personal fields (people:edit for anyone in reach; a person their own contact details). */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = employeeRef(app, util.req(p, 'employee'));
  const a = access(ctx, emp);
  let allowed;
  if (a === 'full' || a === 'edit' || ctx.isAgent) allowed = ['legal_name', 'preferred_name', 'family_name', 'given_name', 'name_order', 'birth_date', 'gender', 'nationality', 'personal_email', 'work_email', 'phone', 'address', 'kana', 'emergency', 'dependants', 'notes'];
  else if (a === 'self') allowed = SELF_EDITABLE;
  else throw util.fail(403, 'You cannot change this person.', 'not_permitted');
  const before = employeeView(app, emp, 'full');
  const q = Object.assign({}, p);
  delete q.employee;
  personFields(ctx, emp, q, allowed);
  if (emp.getString('legal_name') === '') throw util.fail(400, 'legal_name cannot be empty', 'invalid_param');
  app.save(emp);
  const after = employeeView(app, emp, 'full');
  L('lib_audit').note(ctx, { collection: 'employees', record: emp.id, summary: 'Updated the details of ' + displayName(emp), before: before, after: after });
  L('lib_events').emit(ctx, 'employee.updated', { employee: emp.id, fields: Object.keys(q) });
  return { employee: employeeView(app, emp, a === 'self' ? 'self' : 'full') };
}

function archive(ctx, p) {
  const util = u();
  const emp = employeeRef(ctx.app, util.req(p, 'employee'));
  needEdit(ctx, emp);
  const on = util.bool(p, 'archived', true);
  if (on && employeeStatus(ctx.app, emp.id, util.today(ctx.app)) === 'active') throw util.fail(409, displayName(emp) + ' is still employed. End the employment first.', 'still_employed');
  emp.set('archived', on);
  ctx.app.save(emp);
  L('lib_audit').note(ctx, { collection: 'employees', record: emp.id, summary: (on ? 'Archived ' : 'Restored ') + displayName(emp) });
  return { employee: employeeView(ctx.app, emp, 'full') };
}

/** people.delete (PIN): only people never paid; their records go with them. */
function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = employeeRef(app, util.req(p, 'employee'));
  needEdit(ctx, emp);
  const name = displayName(emp);
  const number = emp.getString('number');
  try {
    app.runInTransaction((tx) => {
      const m = util.findOne(tx, 'members', 'employee = {:e}', { e: emp.id });
      if (m !== null) {
        m.set('employee', '');
        tx.save(m);
      }
      for (const r of util.findMany(tx, 'employments', 'employee = {:e}', '', 0, { e: emp.id })) tx.delete(r);
      tx.delete(tx.findRecordById('employees', emp.id));
      L('lib_audit').write(L('lib_auth').withApp(ctx, tx), { op: 'people.delete', collection: 'employees', record: emp.id, summary: 'Deleted ' + name + ' (' + number + ')' });
    });
  } catch (err) {
    if (err && err.status) throw err;
    console.error('[hr] people.delete ' + emp.id + ':', err);
    throw util.fail(409, name + ' has records in other parts of HR OS (time, leave, pay). Archive them instead.', 'has_history');
  }
  ctx.audited = true;
  return { deleted: true, number: number };
}

/** End an employment (separations call this too): sets the last day, emits employment.ended. */
function endEmployment(ctx, employmentId, endDay, reason) {
  const util = u();
  const app = ctx.app;
  const m = app.findRecordById('employments', employmentId);
  if (!util.isDay(endDay)) throw util.fail(400, 'end_day must be YYYY-MM-DD.', 'invalid_param', { param: 'end_day' });
  if (endDay < m.getString('start_day')) throw util.fail(400, 'end_day is before the start day ' + m.getString('start_day') + '.', 'invalid_param', { param: 'end_day' });
  const today = util.today(app, m.getString('entity'));
  const before = employmentView(m);
  m.set('end_day', endDay);
  m.set('end_reason', util.clip(reason || '', 400));
  m.set('status', statusFor(m.getString('start_day'), endDay, today));
  app.save(m);
  const emp = app.findRecordById('employees', m.getString('employee'));
  emp.set('status', employeeStatus(app, emp.id, today));
  app.save(emp);
  L('lib_audit').write(ctx, { op: ctx.op || 'employments.end', collection: 'employments', record: m.id, summary: 'Employment of ' + displayName(emp) + ' ends on ' + endDay, before: before, after: employmentView(m) });
  return L('lib_events').emit(ctx, 'employment.ended', { employment: m.id, employee: emp.id, entity: m.getString('entity'), end_day: endDay, reason: reason || '' });
}

function employmentsEnd(ctx, p) {
  const util = u();
  const m = employmentRef(ctx.app, util.req(p, 'employment'));
  needEdit(ctx, ctx.app.findRecordById('employees', m.getString('employee')));
  const events = endEmployment(ctx, m.id, util.day(p, 'end_day', ''), util.text(p, 'reason', 400, ''));
  return { employment: employmentView(ctx.app.findRecordById('employments', m.id)), events: events };
}

function employmentsUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = employmentRef(app, util.req(p, 'employment'));
  needEdit(ctx, app.findRecordById('employees', m.getString('employee')));
  const before = employmentView(m);
  if (util.has(p, 'probation_end')) m.set('probation_end', util.day(p, 'probation_end', ''));
  if (util.has(p, 'notice_day')) m.set('notice_day', util.day(p, 'notice_day', ''));
  if (util.has(p, 'start_day')) {
    const s = util.day(p, 'start_day', '');
    if (s === '') throw util.fail(400, 'start_day cannot be empty', 'invalid_param');
    const first = rowOn(app, 'job_records', m.id, '9999-12-31');
    if (util.count(app, 'SELECT COUNT(*) AS n FROM job_records WHERE employment = {:e}', { e: m.id }) > 1) throw util.fail(409, 'This employment has later job changes; correct the start day by editing the hire record instead.', 'invalid');
    m.set('start_day', s);
    if (first !== null) {
      first.set('effective_from', s);
      app.save(first);
    }
    for (const col of ['pay_records', 'tax_profiles']) {
      const rows = util.findMany(app, col, 'employment = {:e}', 'effective_from', 0, { e: m.id });
      if (rows.length === 1) {
        rows[0].set('effective_from', s);
        app.save(rows[0]);
      }
    }
  }
  if (util.has(p, 'on_leave')) m.set('status', util.bool(p, 'on_leave', false) ? 'on_leave' : statusFor(m.getString('start_day'), m.getString('end_day'), util.today(app, m.getString('entity'))));
  if (util.has(p, 'primary') && util.bool(p, 'primary', false)) {
    util.exec(app, 'UPDATE employments SET [[primary]] = FALSE WHERE employee = {:e} AND id != {:m}', { e: m.getString('employee'), m: m.id });
    m.set('primary', true);
  }
  app.save(m);
  const emp = app.findRecordById('employees', m.getString('employee'));
  emp.set('status', employeeStatus(app, emp.id, util.today(app)));
  app.save(emp);
  L('lib_audit').note(ctx, { collection: 'employments', record: m.id, summary: 'Changed the employment ' + m.getString('number'), before: before, after: employmentView(m) });
  return { employment: employmentView(m) };
}

/* ------------------------------------------- effective-dated records */

const REC = {
  job: { collection: 'job_records', reasons: JOB_REASONS, label: 'job' },
  pay: { collection: 'pay_records', reasons: PAY_REASONS, label: 'pay' },
  tax: { collection: 'tax_profiles', reasons: null, label: 'tax profile' },
};

function needRecordRight(ctx, kind, m) {
  const util = u();
  const auth = L('lib_auth');
  const emp = ctx.app.findRecordById('employees', m.getString('employee'));
  if (kind === 'job') return needEdit(ctx, emp);
  if (kind === 'tax' && auth.selfEmployee(ctx) === emp.id) return null;
  if (ctx.isAgent) return null;
  if (!auth.can(ctx, 'payroll', 'edit') || !auth.inScope(ctx, m.getString('entity'))) throw util.fail(403, 'Your role cannot change pay or tax records (needs edit access to Payroll).', 'not_permitted');
  return null;
}

function recordValues(ctx, kind, m, p, base) {
  const util = u();
  if (kind === 'job') return jobValues(ctx, p, base);
  if (kind === 'pay') {
    const cur = ctx.app.findRecordById('entities', m.getString('entity')).getString('currency');
    const merged = { amount: util.has(p, 'amount') ? p.amount : base.amount_minor !== undefined ? L('lib_money').fromMinor(base.amount_minor, cur) : '', basis: util.has(p, 'basis') ? p.basis : base.basis, per: util.has(p, 'per') ? p.per : base.per, schedule: util.has(p, 'pay_schedule') ? p.pay_schedule : base.pay_schedule };
    const v = payValues(merged, cur);
    if (v === null) throw util.fail(400, 'Enter the amount, for example ' + exampleAmount(cur) + '.', 'missing_param', { param: 'amount', currency: cur });
    return v;
  }
  const fields = util.obj(p, 'fields');
  const out = { country: base.country || ctx.app.findRecordById('entities', m.getString('entity')).getString('country'), packs: util.has(p, 'packs') ? (util.list(p, 'packs') || []).map(String) : base.packs || [], fields: Object.assign({}, base.fields || {}) };
  if (fields !== undefined) {
    if (util.bool(p, 'replace_fields', false)) out.fields = fields;
    else for (const k of Object.keys(fields)) out.fields[k] = fields[k];
  }
  return out;
}

function baseOf(kind, rec) {
  if (rec === null) return kind === 'job' ? { fte: 1 } : {};
  if (kind === 'job') return jobBase(rec);
  if (kind === 'pay') return { basis: rec.getString('basis'), amount_minor: rec.getInt('amount_minor'), per: rec.getString('per'), pay_schedule: rec.getString('pay_schedule') };
  return { country: rec.getString('country'), packs: u().jsonOf(rec, 'packs', []) || [], fields: u().jsonOf(rec, 'fields', {}) || {} };
}

function viewRec(app, kind, rec) {
  return kind === 'job' ? jobView(app, rec) : kind === 'pay' ? payView(rec) : taxView(rec);
}

/** Words for the reasons of an Update (refusals are sentences, never field names). */
const REASON_WORDS = { hire: 'starting pay (hire)', raise: 'a raise', promotion: 'a promotion', adjustment: 'an adjustment', correction: 'a correction', change: 'a change', transfer: 'a transfer' };
const UPDATE_WHAT = { job: 'A job change', pay: 'Pay', tax: 'A tax profile change' };

function orList(words) {
  return words.length <= 1 ? words.join('') : words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1];
}

/** An example amount in a currency's decimals (6500.00, 650000 for JPY). */
function exampleAmount(currency) {
  const e = L('lib_money').exponent(currency);
  return e > 0 ? '6500.' + '0'.repeat(e) : '650000';
}

/** The reasons an Update takes: pay may be a joiner's starting pay (hire); a job's hire record comes from people.hire only. */
function updateReasons(kind) {
  const k = REC[kind];
  if (k.reasons === null) return null;
  return kind === 'pay' ? k.reasons : k.reasons.filter((r) => r !== 'hire');
}

/** The day an Update takes effect when none is given: the first day of work for the employment's first record of that kind, else today. */
function updateDay(app, kind, m) {
  const util = u();
  if (util.findOne(app, REC[kind].collection, 'employment = {:e}', { e: m.id }) === null) return m.getString('start_day');
  return util.today(app, m.getString('entity'));
}

/** A pay amount refusal as a sentence (the money parser names the param). */
function plainPayError(err, currency) {
  const util = u();
  const param = err && err.extra ? err.extra.param : '';
  if (err && err.code === 'invalid_amount' && param === 'amount') {
    const e = L('lib_money').exponent(currency);
    return util.fail(400, 'The amount is in ' + currency + (e > 0 ? ' with at most ' + e + ' decimals' : ' with no decimals') + ' and more than 0, for example ' + exampleAmount(currency) + '.', 'invalid_amount', { param: 'amount', currency: currency, decimals: e });
  }
  return err;
}

/** Update: a new effective-dated row (history kept, reason required for job and pay). */
function recUpdate(ctx, kind, p) {
  const util = u();
  const app = ctx.app;
  const k = REC[kind];
  const m = employmentRef(app, util.req(p, 'employment'));
  needRecordRight(ctx, kind, m);
  const what = UPDATE_WHAT[kind];
  const start = m.getString('start_day');
  const end = m.getString('end_day');
  const raw = util.has(p, 'effective_from') ? String(p.effective_from).trim() : '';
  if (raw !== '' && !util.isDay(raw)) throw util.fail(400, 'The day is not a real date: write it as YYYY-MM-DD, for example ' + start + '.', 'invalid_param', { param: 'effective_from' });
  const day = raw !== '' ? raw : updateDay(app, kind, m);
  if (day < start) throw util.fail(400, what + ' can start on the first day of work (' + start + ') or later.', 'before_start', { param: 'effective_from', start_day: start });
  if (end !== '' && day > end) throw util.fail(400, what + ' can start on the last day of work (' + end + ') or earlier.', 'after_end', { param: 'effective_from', end_day: end });
  const same = util.findOne(app, k.collection, 'employment = {:e} && effective_from = {:d}', { e: m.id, d: day });
  if (same !== null) throw util.fail(409, 'There is already a ' + k.label + ' record from ' + day + ': correct that one instead (' + kind + '.edit).', 'exists', { effective_from: day, record: same.id });
  let reason = '';
  const reasons = updateReasons(kind);
  if (reasons !== null) {
    reason = util.str(p, 'reason', '');
    const say = orList(reasons.map((r) => REASON_WORDS[r] || r));
    if (reason === '') throw util.fail(400, 'Say why the ' + k.label + ' changes: ' + say + '.', 'missing_param', { param: 'reason', reasons: reasons });
    if (reasons.indexOf(reason) < 0) throw util.fail(400, 'The reason is ' + say + '.', 'invalid_param', { param: 'reason', reasons: reasons });
    if (reason === 'hire') {
      const first = util.findMany(app, k.collection, 'employment = {:e} && effective_from < {:d}', 'effective_from', 1, { e: m.id, d: day });
      if (first.length > 0) {
        const who = displayName(app.findRecordById('employees', m.getString('employee')));
        throw util.fail(400, 'Starting pay is the first pay record, and ' + who + ' has pay from ' + first[0].getString('effective_from') + '. Choose ' + orList(reasons.filter((r) => r !== 'hire').map((r) => REASON_WORDS[r] || r)) + '.', 'not_first', { param: 'reason', first_day: first[0].getString('effective_from') });
      }
    }
  }
  const prev = rowOn(app, k.collection, m.id, day);
  const before = viewRec(app, kind, prev);
  let values;
  try {
    values = recordValues(ctx, kind, m, p, baseOf(kind, prev));
  } catch (err) {
    throw kind === 'pay' ? plainPayError(err, app.findRecordById('entities', m.getString('entity')).getString('currency')) : err;
  }
  const note = util.text(p, 'note', 2000, '');
  let rec;
  if (kind === 'job') {
    if (values.manager && values.manager === m.getString('employee')) throw util.fail(400, 'A person cannot be their own manager.', 'invalid_param', { param: 'manager' });
    rec = writeJob(app, m.id, day, values, reason, note, ctx.memberId);
  } else if (kind === 'pay') rec = writePay(app, m.id, day, values, reason, note, ctx.memberId);
  else rec = writeTax(app, m.id, day, values.country, values.packs, values.fields, note);
  const after = viewRec(app, kind, rec);
  const emp = app.findRecordById('employees', m.getString('employee'));
  L('lib_audit').note(ctx, { collection: k.collection, record: rec.id, summary: 'New ' + k.label + ' record for ' + displayName(emp) + ' from ' + day + (reason ? ' (' + reason + ')' : ''), before: kind === 'pay' && !canSeePay(ctx, m) ? undefined : before, after: after });
  const events = L('lib_events').emit(ctx, 'employment.changed', { employment: m.id, kind: kind, record: rec.id, effective_from: day });
  return { record: after, events: events };
}

/** Edit: correct a row in place (audited with before and after), unless a module (payroll) blocks it. */
function recEdit(ctx, kind, p) {
  const util = u();
  const app = ctx.app;
  const k = REC[kind];
  const rec = util.byId(app, k.collection, util.req(p, 'record'));
  if (rec === null) throw util.fail(404, 'No such ' + k.label + ' record. Run ' + kind + '.history.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  needRecordRight(ctx, kind, m);
  const blocks = L('lib_events')
    .emit(ctx, 'record.editing', { collection: k.collection, id: rec.id, employment: m.id, effective_from: rec.getString('effective_from') })
    .filter((r) => r.ok && r.result && r.result.block);
  if (blocks.length > 0) throw util.fail(409, blocks.map((b) => b.result.block).join(' ') + ' Make the change with ' + kind + '.update from a new day instead.', 'locked', { blocks: blocks.map((b) => b.result.block) });
  const before = viewRec(app, kind, rec);
  const values = recordValues(ctx, kind, m, p, baseOf(kind, rec));
  if (kind === 'job') {
    for (const f of JOB_FIELDS) if (values[f] !== undefined) rec.set(f, values[f]);
    if (values.manager && values.manager === m.getString('employee')) throw util.fail(400, 'A person cannot be their own manager.', 'invalid_param', { param: 'manager' });
  } else if (kind === 'pay') {
    for (const f of ['basis', 'amount_minor', 'per', 'pay_schedule']) rec.set(f, values[f]);
  } else {
    rec.set('packs', values.packs);
    rec.set('fields', values.fields);
  }
  if (k.reasons !== null && util.has(p, 'reason')) {
    const r = util.oneOf(p, 'reason', k.reasons, rec.getString('reason'));
    if (r === 'hire' && rec.getString('reason') !== 'hire') throw util.fail(400, 'Only the first record is the hire.', 'invalid_param');
    rec.set('reason', r);
  }
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
  app.save(rec);
  const after = viewRec(app, kind, rec);
  const emp = app.findRecordById('employees', m.getString('employee'));
  L('lib_audit').note(ctx, { collection: k.collection, record: rec.id, summary: 'Corrected the ' + k.label + ' record of ' + displayName(emp) + ' from ' + rec.getString('effective_from'), before: before, after: after });
  const events = L('lib_events').emit(ctx, 'employment.changed', { employment: m.id, kind: kind, record: rec.id, effective_from: rec.getString('effective_from'), edited: true });
  return { record: after, events: events };
}

/** Remove a scheduled (future) row. */
function recDelete(ctx, kind, p) {
  const util = u();
  const app = ctx.app;
  const k = REC[kind];
  const rec = util.byId(app, k.collection, util.req(p, 'record'));
  if (rec === null) throw util.fail(404, 'No such ' + k.label + ' record.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  needRecordRight(ctx, kind, m);
  if (rec.getString('effective_from') <= util.today(app, m.getString('entity'))) throw util.fail(409, 'Only scheduled (future) changes can be removed. Correct a past record with ' + kind + '.edit.', 'not_scheduled');
  const before = viewRec(app, kind, rec);
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: k.collection, record: rec.id, summary: 'Removed the scheduled ' + k.label + ' change from ' + before.effective_from, before: before });
  return { deleted: true };
}

function recHistory(ctx, kind, p) {
  const util = u();
  const app = ctx.app;
  const m = employmentRef(app, util.req(p, 'employment'));
  needSee(ctx, m);
  if (kind !== 'job' && !canSeePay(ctx, m)) throw util.fail(403, 'You cannot see pay and tax records of this person.', 'not_permitted');
  const today = util.today(app, m.getString('entity'));
  return { employment: m.id, today: today, records: timelineRows(app, REC[kind].collection, m.id, today, (a, r) => viewRec(a, kind, r)) };
}

/* ------------------------------------------------------------ previews */

const REF_COLLECTION = { job_title: 'job_titles', department: 'departments', location: 'locations', manager: 'employees', grade: 'grades', employment_type: 'employment_types', schedule: 'work_schedules', calendar: 'holiday_calendars', cost_center: 'cost_centers' };

function shownValue(app, kind, field, value, currency) {
  if (value === undefined || value === null) return '';
  if (kind === 'job' && REF_COLLECTION[field]) return value === '' ? '' : nameOf(app, REF_COLLECTION[field], value, field === 'grade' || field === 'employment_type' || field === 'calendar' || field === 'cost_center' ? 'code' : 'name');
  if (kind === 'pay' && field === 'amount_minor') return L('lib_money').format(value, currency);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** Before and after of a job, pay or tax Update or Edit, for a proposal. */
function previewRecord(ctx, kind, p, editing) {
  const util = u();
  const app = ctx.app;
  const k = REC[kind];
  let m;
  let prev;
  let day;
  if (editing) {
    prev = util.byId(app, k.collection, String(p.record || ''));
    if (prev === null) throw util.fail(404, 'No such ' + k.label + ' record.', 'not_found');
    m = app.findRecordById('employments', prev.getString('employment'));
    day = prev.getString('effective_from');
  } else {
    m = employmentRef(app, String(p.employment || ''));
    day = util.isDay(String(p.effective_from || '')) ? String(p.effective_from) : updateDay(app, kind, m);
    prev = rowOn(app, k.collection, m.id, day);
  }
  const base = baseOf(kind, prev);
  const values = recordValues(ctx, kind, m, p, base);
  const cur = app.findRecordById('entities', m.getString('entity')).getString('currency');
  const fields = [];
  for (const f of Object.keys(values)) {
    if (kind === 'pay' && f === 'currency') continue;
    const b = shownValue(app, kind, f, base[f], cur);
    const a = shownValue(app, kind, f, values[f], cur);
    if (JSON.stringify(b) !== JSON.stringify(a)) fields.push({ name: f === 'amount_minor' ? 'amount' : f, before: b, after: a });
  }
  const emp = app.findRecordById('employees', m.getString('employee'));
  return {
    label: (editing ? 'Correct the ' : 'Change the ') + k.label + ' of ' + displayName(emp) + (editing ? ' record from ' : ' from ') + day + (p.reason ? ' (' + p.reason + ')' : ''),
    target: 'employments:' + m.id,
    fields: fields,
    notes: day > util.today(app, m.getString('entity')) ? ['This is a scheduled change: it takes effect on ' + day + '.'] : [],
    risk: kind === 'pay' ? 'high' : 'medium',
  };
}

/** The hire as a person will see it: references resolved to their names, pay formatted. */
function previewHire(ctx, p) {
  const app = ctx.app;
  const ent = L('lib_org').entityRef(app, String(p.entity || ''));
  const who = p.employee ? displayName(employeeRef(app, String(p.employee))) : String(p.preferred_name || p.legal_name || '');
  const jv = jobValues(ctx, p, {});
  const fields = [];
  const add = (name, value) => {
    if (value !== undefined && value !== null && value !== '') fields.push({ name: name, before: '', after: value });
  };
  for (const k of ['legal_name', 'preferred_name', 'start_day', 'work_email']) add(k, p[k]);
  add('title', jv.title);
  for (const k of ['job_title', 'department', 'location', 'manager', 'employment_type', 'grade', 'cost_center', 'schedule', 'calendar']) if (jv[k]) add(k, shownValue(app, 'job', k, jv[k], ''));
  const pay = payValues({ amount: p.pay_amount, basis: p.pay_basis, per: p.pay_per, schedule: p.pay_schedule }, ent.getString('currency'));
  if (pay !== null) add('pay', L('lib_money').format(pay.amount_minor, pay.currency) + ' per ' + pay.per);
  return { label: 'Hire ' + who + ' at ' + ent.getString('name') + ' from ' + p.start_day, target: 'entities:' + ent.id, fields: fields, notes: [], risk: 'medium' };
}

/* --------------------------------------------------- bank, ids, docs */

function needBankRight(ctx, emp) {
  const auth = L('lib_auth');
  if (auth.selfEmployee(ctx) === emp.id) return 'self';
  if (canSeeEmployee(ctx, emp) && (auth.can(ctx, 'people', 'full') || auth.can(ctx, 'payroll', 'edit'))) return 'admin';
  throw u().fail(403, 'You cannot change bank details of this person.', 'not_permitted');
}

function bankList(ctx, p) {
  const util = u();
  const emp = employeeRef(ctx.app, util.req(p, 'employee'));
  const a = access(ctx, emp);
  if (a === 'none' || a === 'team') throw util.fail(403, 'You cannot see bank details of this person.', 'not_permitted');
  return { bank_accounts: util.findMany(ctx.app, 'bank_accounts', 'employee = {:e}', 'sort,created', 0, { e: emp.id }).map(bankView) };
}

/** A new bank account: pending until a payroll administrator approves it with their PIN. */
function bankAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const seal = L('lib_seal');
  const emp = employeeRef(app, util.req(p, 'employee'));
  needBankRight(ctx, emp);
  const number = String(util.req(p, 'number')).replace(/[\s-]/g, '');
  if (!/^[A-Za-z0-9]{4,34}$/.test(number)) throw util.fail(400, 'number is the account number: 4 to 34 letters and digits.', 'invalid_param', { param: 'number' });
  const iban = String(util.str(p, 'iban', '')).replace(/\s/g, '').toUpperCase();
  if (iban !== '' && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) throw util.fail(400, 'iban does not look like an IBAN.', 'invalid_param', { param: 'iban' });
  const split = util.obj(p, 'split') || { kind: 'rest' };
  util.keysOnly(split, ['kind', 'value'], 'split');
  if (['rest', 'percent', 'fixed'].indexOf(split.kind) < 0) throw util.fail(400, 'split.kind is rest, percent or fixed.', 'invalid_param');
  if (split.kind !== 'rest' && !(Number(split.value) > 0)) throw util.fail(400, 'split.value is needed for percent and fixed splits.', 'invalid_param');
  const primary = primaryEmployment(app, emp.id, util.today(app));
  const ent = primary !== '' ? app.findRecordById('entities', app.findRecordById('employments', primary).getString('entity')) : null;
  let rec = null;
  let approval = null;
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    rec = util.newRecord(tx, 'bank_accounts');
    rec.set('employee', emp.id);
    rec.set('label', util.text(p, 'label', 80, '') || 'Salary account');
    rec.set('country', (util.str(p, 'country', '') || (ent ? ent.getString('country') : '')).toUpperCase());
    rec.set('currency', (util.str(p, 'currency', '') || (ent ? ent.getString('currency') : '')).toUpperCase());
    rec.set('bank_name', util.text(p, 'bank_name', 160, ''));
    rec.set('bank_code', util.text(p, 'bank_code', 40, ''));
    rec.set('branch_code', util.text(p, 'branch_code', 40, ''));
    rec.set('account_type', util.text(p, 'account_type', 40, ''));
    rec.set('holder', util.text(p, 'holder', 200, '') || emp.getString('legal_name'));
    rec.set('number_sealed', seal.seal(tx, number));
    rec.set('number_masked', seal.mask(number, 'last4'));
    rec.set('iban_sealed', iban === '' ? '' : seal.seal(tx, iban));
    rec.set('iban_masked', iban === '' ? '' : seal.mask(iban, 'last4'));
    rec.set('swift', util.text(p, 'swift', 20, '').toUpperCase());
    rec.set('split', split);
    rec.set('status', 'pending');
    rec.set('requested_by', ctx.memberId);
    rec.set('sort', util.count(tx, 'SELECT COUNT(*) AS n FROM bank_accounts WHERE employee = {:e}', { e: emp.id }));
    tx.save(rec);
    approval = L('lib_approvals').open(tctx, {
      kind: 'bank_account',
      ref_collection: 'bank_accounts',
      ref_id: rec.id,
      entity: ent ? ent.id : '',
      employment: primary,
      summary: 'New bank account ' + rec.getString('number_masked') + ' for ' + displayName(emp),
      payload: { employee: emp.id, label: rec.getString('label'), bank_name: rec.getString('bank_name'), number_masked: rec.getString('number_masked'), split: split },
      facts: [{ type: 'text', key: 'account', label: 'Account', value: rec.getString('number_masked') }, { type: 'text', key: 'bank', label: 'Bank', value: rec.getString('bank_name') }, { type: 'text', key: 'person', label: 'Person', value: displayName(emp) }],
      needs_pin: true,
    });
    rec.set('approval', approval.id);
    tx.save(rec);
    L('lib_audit').write(tctx, { op: 'bank.add', collection: 'bank_accounts', record: rec.id, summary: 'Added bank account ' + rec.getString('number_masked') + ' for ' + displayName(emp) + ' (waiting for approval)', after: bankView(rec) });
  });
  ctx.audited = true;
  return { bank_account: bankView(app.findRecordById('bank_accounts', rec.id)), approval: approval };
}

/** Approval subscriber for kind bank_account. */
function onBankDecision(ctx, approval, decision) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'bank_accounts', approval.ref_id);
  if (rec === null) return;
  if (decision === 'approved') {
    const split = util.jsonOf(rec, 'split', { kind: 'rest' }) || { kind: 'rest' };
    if (split.kind === 'rest') {
      for (const o of util.findMany(app, 'bank_accounts', "employee = {:e} && status = 'active' && id != {:x}", '', 0, { e: rec.getString('employee'), x: rec.id })) {
        const s2 = util.jsonOf(o, 'split', { kind: 'rest' }) || { kind: 'rest' };
        if (s2.kind === 'rest') {
          o.set('status', 'retired');
          app.save(o);
        }
      }
    }
    rec.set('status', 'active');
    rec.set('approved_by', ctx.memberId);
    rec.set('approved_at', util.nowIso());
    app.save(rec);
    L('lib_events').emit(ctx, 'bank_account.approved', { bank_account: rec.id, employee: rec.getString('employee') });
  } else {
    rec.set('status', decision === 'rejected' ? 'rejected' : 'retired');
    app.save(rec);
  }
}

function bankRetire(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'bank_accounts', util.req(p, 'bank_account'));
  if (rec === null) throw util.fail(404, 'No such bank account.', 'not_found');
  const emp = app.findRecordById('employees', rec.getString('employee'));
  needBankRight(ctx, emp);
  if (rec.getString('status') === 'pending' && rec.getString('approval') !== '') L('lib_approvals').cancel(ctx, rec.getString('approval'), 'The bank account was withdrawn.');
  rec.set('status', 'retired');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'bank_accounts', record: rec.id, summary: 'Retired bank account ' + rec.getString('number_masked') + ' of ' + displayName(emp) });
  return { bank_account: bankView(rec) };
}

function idsList(ctx, p) {
  const util = u();
  const emp = employeeRef(ctx.app, util.req(p, 'employee'));
  const a = access(ctx, emp);
  if (a === 'none' || a === 'team') throw util.fail(403, 'You cannot see identity documents of this person.', 'not_permitted');
  return { identity_docs: util.findMany(ctx.app, 'identity_docs', 'employee = {:e}', 'type', 0, { e: emp.id }).map(idView), types: idTypesFor(ctx.app, emp) };
}

function idTypesFor(app, emp) {
  const util = u();
  const countries = L('lib_countries');
  const seen = {};
  const out = [];
  const codes = [emp.getString('nationality')].concat(util.rows(app, 'SELECT DISTINCT n.country AS c FROM employments m JOIN entities n ON n.id = m.entity WHERE m.employee = {:e}', { c: '' }, { e: emp.id }).map((r) => r.c));
  for (const c of codes) {
    if (!c || !countries.has(c)) continue;
    for (const t of countries.idTypes(c)) {
      if (seen[c + t.code]) continue;
      seen[c + t.code] = true;
      out.push(Object.assign({ country: c }, t));
    }
  }
  out.push({ country: '', code: 'passport', label: 'Passport', mask: 'last4' });
  return out;
}

function needIdRight(ctx, emp) {
  const auth = L('lib_auth');
  if (auth.selfEmployee(ctx) === emp.id) return;
  if (canSeeEmployee(ctx, emp) && auth.can(ctx, 'people', 'full')) return;
  throw u().fail(403, 'You cannot change identity documents of this person.', 'not_permitted');
}

function idsAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const seal = L('lib_seal');
  const emp = employeeRef(app, util.req(p, 'employee'));
  needIdRight(ctx, emp);
  const type = util.req(p, 'type', 'passport');
  const country = util.str(p, 'country', '').toUpperCase();
  const t = idTypesFor(app, emp).filter((x) => x.code === type && (country === '' || x.country === country || x.country === ''))[0];
  const number = String(util.req(p, 'number')).trim();
  if (t && t.pattern && !new RegExp(t.pattern).test(number.replace(/[\s-]/g, ''))) throw util.fail(400, 'That does not look like a ' + t.label + ' number.', 'invalid_param', { param: 'number' });
  const rec = util.newRecord(app, 'identity_docs');
  rec.set('employee', emp.id);
  rec.set('type', type);
  rec.set('country', country || (t ? t.country : ''));
  rec.set('number_sealed', seal.seal(app, number));
  rec.set('number_masked', seal.mask(number, t ? t.mask : 'last4'));
  rec.set('issued', util.day(p, 'issued', ''));
  rec.set('expires', util.day(p, 'expires', ''));
  rec.set('note', util.text(p, 'note', 1000, ''));
  const f = L('lib_files').fileParam(ctx, p, 'file', 'path');
  if (f !== null) rec.set('file', f);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'identity_docs', record: rec.id, summary: 'Added ' + (t ? t.label : type) + ' ' + rec.getString('number_masked') + ' for ' + displayName(emp), after: idView(rec) });
  return { identity_doc: idView(rec) };
}

function idsUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'identity_docs', util.req(p, 'identity_doc'));
  if (rec === null) throw util.fail(404, 'No such identity document.', 'not_found');
  const emp = app.findRecordById('employees', rec.getString('employee'));
  needIdRight(ctx, emp);
  const before = idView(rec);
  if (util.has(p, 'number')) {
    const seal = L('lib_seal');
    const n = String(util.req(p, 'number')).trim();
    rec.set('number_sealed', seal.seal(app, n));
    rec.set('number_masked', seal.mask(n, 'last4'));
  }
  if (util.has(p, 'issued')) rec.set('issued', util.day(p, 'issued', ''));
  if (util.has(p, 'expires')) rec.set('expires', util.day(p, 'expires', ''));
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 1000, ''));
  const f = L('lib_files').fileParam(ctx, p, 'file', 'path');
  if (f !== null) rec.set('file', f);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'identity_docs', record: rec.id, summary: 'Changed the ' + rec.getString('type') + ' of ' + displayName(emp), before: before, after: idView(rec) });
  return { identity_doc: idView(rec) };
}

function idsDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'identity_docs', util.req(p, 'identity_doc'));
  if (rec === null) throw util.fail(404, 'No such identity document.', 'not_found');
  const emp = app.findRecordById('employees', rec.getString('employee'));
  needIdRight(ctx, emp);
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'identity_docs', record: rec.id, summary: 'Removed the ' + rec.getString('type') + ' of ' + displayName(emp), before: idView(rec) });
  return { deleted: true };
}

function idsFile(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'identity_docs', util.req(p, 'identity_doc'));
  if (rec === null || rec.getString('file') === '') throw util.fail(404, 'No file.', 'not_found');
  const emp = ctx.app.findRecordById('employees', rec.getString('employee'));
  needIdRight(ctx, emp);
  return L('lib_files').serve(ctx, rec, 'file', rec.getString('type') + '-' + emp.getString('number'), util.bool(p, 'download', false));
}

function documentsList(ctx, p) {
  const util = u();
  const emp = employeeRef(ctx.app, util.req(p, 'employee'));
  const a = access(ctx, emp);
  if (a === 'none' || a === 'team') throw util.fail(403, 'You cannot see documents of this person.', 'not_permitted');
  const where = a === 'self' ? 'employee = {:e} && visible_to_employee = true' : 'employee = {:e}';
  const cat = util.str(p, 'category', '');
  return { documents: util.findMany(ctx.app, 'documents', where + (cat !== '' ? ' && category = {:c}' : ''), '-created', 500, { e: emp.id, c: cat }).map(documentView) };
}

function documentsAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = employeeRef(app, util.req(p, 'employee'));
  const own = L('lib_auth').selfEmployee(ctx) === emp.id;
  if (!own) needEdit(ctx, emp);
  const rec = util.newRecord(app, 'documents');
  rec.set('employee', emp.id);
  if (util.str(p, 'employment', '') !== '') rec.set('employment', employmentRef(app, util.str(p, 'employment', '')).id);
  rec.set('category', util.text(p, 'category', 60, '') || 'other');
  rec.set('title', util.squash(util.req(p, 'title')));
  rec.set('visible_to_employee', own ? true : util.bool(p, 'visible_to_employee', true));
  rec.set('needs_ack', own ? false : util.bool(p, 'needs_ack', false));
  rec.set('expires', util.day(p, 'expires', ''));
  rec.set('source', ctx.isAgent ? 'agent' : util.oneOf(p, 'source', ['upload', 'letter', 'payslip'], 'upload'));
  rec.set('note', util.text(p, 'note', 2000, ''));
  rec.set('added_by', ctx.memberId);
  const f = L('lib_files').fileParam(ctx, p, 'file', 'path');
  if (f !== null) rec.set('file', f);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'documents', record: rec.id, summary: 'Added the document ' + rec.getString('title') + ' for ' + displayName(emp) });
  if (rec.getBool('needs_ack') && emp.getString('member') !== '') L('lib_notify').notify(app, [emp.getString('member')], { kind: 'document', title: 'Please read and acknowledge: ' + rec.getString('title'), body: '', link: '#/me/documents' });
  return { document: documentView(rec) };
}

function documentsUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'documents', util.req(p, 'document'));
  if (rec === null) throw util.fail(404, 'No such document.', 'not_found');
  const emp = app.findRecordById('employees', rec.getString('employee'));
  needEdit(ctx, emp);
  const before = documentView(rec);
  if (util.has(p, 'title')) rec.set('title', util.squash(util.req(p, 'title')));
  if (util.has(p, 'category')) rec.set('category', util.text(p, 'category', 60, ''));
  for (const k of ['visible_to_employee', 'needs_ack']) if (util.has(p, k)) rec.set(k, util.bool(p, k, false));
  if (util.has(p, 'expires')) rec.set('expires', util.day(p, 'expires', ''));
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'documents', record: rec.id, summary: 'Changed the document ' + rec.getString('title'), before: before, after: documentView(rec) });
  return { document: documentView(rec) };
}

function documentsDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'documents', util.req(p, 'document'));
  if (rec === null) throw util.fail(404, 'No such document.', 'not_found');
  const emp = app.findRecordById('employees', rec.getString('employee'));
  needEdit(ctx, emp);
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'documents', record: rec.id, summary: 'Deleted the document ' + rec.getString('title') + ' of ' + displayName(emp) });
  return { deleted: true };
}

function documentsFile(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'documents', util.req(p, 'document'));
  if (rec === null || rec.getString('file') === '') throw util.fail(404, 'No file.', 'not_found');
  const emp = ctx.app.findRecordById('employees', rec.getString('employee'));
  const a = access(ctx, emp);
  if (a === 'none' || a === 'team' || (a === 'self' && !rec.getBool('visible_to_employee'))) throw util.fail(403, 'You cannot open this document.', 'not_permitted');
  return L('lib_files').serve(ctx, rec, 'file', rec.getString('title'), util.bool(p, 'download', false));
}

/** The employee acknowledges a document they were asked to read. */
function documentsAck(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'documents', util.req(p, 'document'));
  if (rec === null) throw util.fail(404, 'No such document.', 'not_found');
  if (L('lib_auth').selfEmployee(ctx) !== rec.getString('employee')) throw util.fail(403, 'Only the person it is for can acknowledge a document.', 'not_permitted');
  if (!rec.getBool('needs_ack')) throw util.fail(409, 'This document needs no acknowledgement.', 'invalid');
  if (rec.getString('acked_at') === '') {
    rec.set('acked_at', util.nowIso());
    app.save(rec);
  }
  L('lib_audit').note(ctx, { collection: 'documents', record: rec.id, summary: 'Acknowledged ' + rec.getString('title') });
  return { document: documentView(rec) };
}

/* -------------------------------------------------------------- photos */

/** The employee photo (anyone who may see the person; your AI agent gets the path). */
function photo(ctx, p) {
  const util = u();
  const emp = employeeRef(ctx.app, util.req(p, 'employee'));
  if (!canSeeEmployee(ctx, emp)) throw util.fail(403, 'You cannot see this person.', 'not_permitted');
  if (emp.getString('photo') === '') throw util.fail(404, 'No photo yet.', 'not_found');
  return L('lib_files').serve(ctx, emp, 'photo', 'photo-' + emp.getString('number'), false);
}

/** Set (or clear with --clear true) a photo: the person themself or people:edit. */
function photoSet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = employeeRef(app, util.req(p, 'employee'));
  const a = access(ctx, emp);
  if (!(a === 'self' || a === 'full' || a === 'edit' || ctx.isAgent)) throw util.fail(403, 'You cannot change the photo of this person.', 'not_permitted');
  if (util.bool(p, 'clear', false)) emp.set('photo', '');
  else {
    const f = L('lib_files').fileParam(ctx, p, 'photo', 'path');
    if (f === null) throw util.fail(400, 'Upload a photo (JPEG, PNG or WebP, up to 5 MB) in the photo field, or give --path.', 'missing_param', { param: 'photo' });
    emp.set('photo', f);
  }
  app.save(emp);
  L('lib_audit').note(ctx, { collection: 'employees', record: emp.id, summary: (emp.getString('photo') === '' ? 'Removed the photo of ' : 'New photo for ') + displayName(emp) });
  return { employee: employeeView(app, emp, a === 'self' ? 'self' : a === 'team' ? 'team' : 'full') };
}

/* -------------------------------------------------------------- skills */

function skillsList(ctx, p) {
  const util = u();
  const emp = employeeRef(ctx.app, util.req(p, 'employee'));
  if (!canSeeEmployee(ctx, emp)) throw util.fail(403, 'You cannot see this person.', 'not_permitted');
  return { skills: util.findMany(ctx.app, 'employee_skills', 'employee = {:e}', 'skill', 0, { e: emp.id }).map(skillView) };
}

function skillsSet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = employeeRef(app, util.req(p, 'employee'));
  const a = access(ctx, emp);
  if (!(a === 'self' || a === 'full' || a === 'edit' || a === 'team' || ctx.isAgent)) throw util.fail(403, 'You cannot change skills of this person.', 'not_permitted');
  const skill = util.squash(util.req(p, 'skill', 'Excel'));
  let rec = util.rows(app, 'SELECT id FROM employee_skills WHERE employee = {:e} AND LOWER(skill) = LOWER({:s})', { id: '' }, { e: emp.id, s: skill })[0];
  rec = rec ? app.findRecordById('employee_skills', rec.id) : util.newRecord(app, 'employee_skills');
  rec.set('employee', emp.id);
  rec.set('skill', util.clip(skill, 120));
  rec.set('level', util.int(p, 'level', rec.getInt('level') || 3, 1, 5));
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 1000, ''));
  if (util.bool(p, 'verified', false) && a !== 'self' && !ctx.isAgent) rec.set('verified_by', ctx.memberId);
  if (a === 'self') rec.set('verified_by', '');
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'employee_skills', record: rec.id, summary: 'Set ' + skill + ' (level ' + rec.getInt('level') + ') for ' + displayName(emp) });
  return { skill: skillView(rec) };
}

function skillsRemove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'employee_skills', util.req(p, 'skill'));
  if (rec === null) throw util.fail(404, 'No such skill entry.', 'not_found');
  const emp = app.findRecordById('employees', rec.getString('employee'));
  const a = access(ctx, emp);
  if (!(a === 'self' || a === 'full' || a === 'edit' || a === 'team' || ctx.isAgent)) throw util.fail(403, 'You cannot change skills of this person.', 'not_permitted');
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'employee_skills', record: rec.id, summary: 'Removed ' + rec.getString('skill') + ' from ' + displayName(emp) });
  return { deleted: true };
}

/* ------------------------------------------------------ import, export */

const IMPORT_COLUMNS = ['number', 'legal_name', 'preferred_name', 'family_name', 'given_name', 'work_email', 'personal_email', 'phone', 'birth_date', 'gender', 'nationality', 'entity', 'start_day', 'probation_end', 'title', 'department', 'location', 'manager', 'employment_type', 'grade', 'fte', 'pay_basis', 'pay_amount', 'pay_per'];

/** Check every row of a people CSV; returns { rows, plan, report }. Changes nothing. */
function importPlan(ctx, csvText) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const parsed = util.csvObjects(csvText);
  const report = { rows: parsed.items.length, ok: 0, errors: [], unknown_columns: parsed.header.filter((h) => IMPORT_COLUMNS.indexOf(h) < 0) };
  for (const need of ['legal_name', 'entity', 'start_day']) if (parsed.header.indexOf(need) < 0) throw util.fail(400, 'The CSV needs the columns legal_name, entity and start_day. Found: ' + parsed.header.join(', '), 'bad_csv');
  if (parsed.items.length > 5000) throw util.fail(400, 'At most 5,000 rows in one import.', 'too_many');
  const fileNumbers = {};
  const fileEmails = {};
  parsed.items.forEach((r, i) => {
    if (r.number) fileNumbers[r.number.toUpperCase()] = i;
    if (r.work_email) fileEmails[r.work_email.toLowerCase()] = i;
  });
  const plan = [];
  const cache = {};
  const look = (key, fn) => {
    if (cache[key] === undefined) {
      try {
        cache[key] = { ok: fn() };
      } catch (err) {
        cache[key] = { err: String((err && err.message) || err) };
      }
    }
    if (cache[key].err !== undefined) throw new Error(cache[key].err);
    return cache[key].ok;
  };
  parsed.items.forEach((r, i) => {
    const line = i + 2;
    const errs = [];
    const bad = (field, message) => errs.push({ line: line, field: field, message: message });
    const row = { line: line, src: r };
    if (r.legal_name === '') bad('legal_name', 'legal_name is empty');
    let ent = null;
    try {
      ent = r.entity === '' ? null : look('e:' + r.entity.toLowerCase(), () => org.entityRef(app, r.entity));
      if (ent === null) bad('entity', 'entity is empty');
      else if (!L('lib_auth').inScope(ctx, ent.id)) bad('entity', 'you cannot hire into ' + ent.getString('name'));
    } catch (err) {
      bad('entity', String(err.message));
    }
    row.entity = ent;
    if (!util.isDay(r.start_day)) bad('start_day', 'start_day must be YYYY-MM-DD (got "' + r.start_day + '")');
    for (const k of ['birth_date', 'probation_end']) if (r[k] && !util.isDay(r[k])) bad(k, k + ' must be YYYY-MM-DD');
    for (const k of ['work_email', 'personal_email']) if (r[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r[k])) bad(k, k + ' is not an email address');
    if (r.work_email) {
      if (fileEmails[r.work_email.toLowerCase()] !== i) bad('work_email', 'the same work_email is on another row');
      else if (util.findOne(app, 'employees', 'work_email = {:e}', { e: r.work_email.toLowerCase() }) !== null) bad('work_email', r.work_email + ' already belongs to someone in HR OS');
    }
    if (r.number) {
      if (!/^[A-Za-z0-9-]{1,20}$/.test(r.number)) bad('number', 'number is letters, digits and - (at most 20)');
      else if (util.findOne(app, 'employees', 'number = {:n}', { n: r.number.toUpperCase() }) !== null) bad('number', r.number + ' is already used');
      else if (fileNumbers[r.number.toUpperCase()] !== i) bad('number', 'the same number is on another row');
    }
    if (r.nationality && !/^[A-Za-z]{2}$/.test(r.nationality)) bad('nationality', 'nationality is a two-letter country code');
    const refs = { department: (v) => org.kindRef(app, 'department', v), location: (v) => org.kindRef(app, 'location', v), employment_type: (v) => org.kindRef(app, 'employment_type', v), grade: (v) => org.kindRef(app, 'grade', v) };
    row.refs = {};
    for (const k of Object.keys(refs)) {
      if (!r[k]) continue;
      try {
        row.refs[k] = look(k + ':' + r[k].toLowerCase(), () => refs[k](r[k])).id;
      } catch (err) {
        bad(k, String(err.message));
      }
    }
    if (r.manager) {
      const key = r.manager.indexOf('@') > 0 ? r.manager.toLowerCase() : r.manager.toUpperCase();
      const inFile = r.manager.indexOf('@') > 0 ? fileEmails[key] : fileNumbers[key];
      if (inFile !== undefined) {
        if (inFile === i) bad('manager', 'a person cannot be their own manager');
        else row.managerRow = inFile;
      } else {
        try {
          row.managerId = look('m:' + key, () => employeeRef(app, r.manager)).id;
        } catch (err) {
          bad('manager', String(err.message));
        }
      }
    }
    if (r.fte) {
      const n = Number(r.fte);
      if (!(n > 0 && n <= 1.5)) bad('fte', 'fte is a number from 0.01 to 1.5');
    }
    if (r.pay_amount && ent !== null) {
      try {
        row.pay = payValues({ amount: r.pay_amount, basis: r.pay_basis || undefined, per: r.pay_per || undefined }, ent.getString('currency'));
      } catch (err) {
        bad('pay_amount', String(err.message));
      }
    }
    if (errs.length > 0) for (const e of errs) report.errors.push(e);
    else report.ok++;
    plan.push(row);
  });
  return { plan: plan, report: report };
}

function importCheck(ctx, p) {
  const csv = L('lib_files').csvInput(ctx, p, 'file', 'csv');
  const out = importPlan(ctx, csv);
  const id = L('lib_files').recordImport(ctx, 'people', 'dry_run', out.report, out.report.rows);
  L('lib_audit').note(ctx, { collection: 'imports', record: id, summary: 'Checked a people CSV: ' + out.report.ok + ' of ' + out.report.rows + ' rows ready, ' + out.report.errors.length + ' problems' });
  return { dry_run: true, import: id, report: out.report, preview: out.plan.slice(0, 20).map((r) => ({ line: r.line, legal_name: r.src.legal_name, entity: r.entity ? r.entity.getString('name') : '', start_day: r.src.start_day, title: r.src.title || '' })) };
}

/** Commit a people CSV (all rows or none): employees, employments, job, pay and tax records. */
function importCommit(ctx, p) {
  const util = u();
  const app = ctx.app;
  const csv = L('lib_files').csvInput(ctx, p, 'file', 'csv');
  const out = importPlan(ctx, csv);
  if (out.report.errors.length > 0) {
    L('lib_files').recordImport(ctx, 'people', 'failed', out.report, out.report.rows);
    throw util.fail(400, 'The CSV has ' + out.report.errors.length + ' problems; nothing was imported. Run people.import-check to see them.', 'bad_csv', { errors: out.report.errors.slice(0, 50) });
  }
  const made = [];
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    const ids = [];
    for (const row of out.plan) {
      const r = row.src;
      const ent = row.entity;
      const today = util.today(tx, ent.id);
      const e = util.newRecord(tx, 'employees');
      e.set('number', r.number ? r.number.toUpperCase() : 'E' + String(util.nextNumber(tx, 'employee')).padStart(4, '0'));
      e.set('status', statusFor(r.start_day, '', today) === 'pre_hire' ? 'pre_hire' : 'active');
      e.set('name_order', (L('lib_countries').info(ent.getString('country')) || {}).name_order || 'given_first');
      e.set('address', {});
      e.set('emergency', []);
      e.set('dependants', []);
      e.set('kana', {});
      const fields = {};
      for (const k of ['legal_name', 'preferred_name', 'family_name', 'given_name', 'work_email', 'personal_email', 'phone', 'birth_date', 'gender', 'nationality']) if (r[k]) fields[k] = r[k];
      personFields(tctx, e, fields, Object.keys(fields));
      tx.save(e);
      const m = util.newRecord(tx, 'employments');
      m.set('employee', e.id);
      m.set('entity', ent.id);
      m.set('number', e.getString('number'));
      m.set('start_day', r.start_day);
      m.set('probation_end', r.probation_end || '');
      m.set('status', statusFor(r.start_day, '', today));
      m.set('primary', true);
      tx.save(m);
      ids.push({ employee: e.id, employment: m.id, entity: ent.id, start_day: r.start_day });
      made.push(ids[ids.length - 1]);
      const ft = row.refs.employment_type || (util.findOne(tx, 'employment_types', "code = 'full_time'", {}) || { id: '' }).id;
      writeJob(tx, m.id, r.start_day, { title: r.title || '', department: row.refs.department || '', location: row.refs.location || '', grade: row.refs.grade || '', employment_type: ft, manager: row.managerId || '', fte: r.fte ? Number(r.fte) : 1 }, 'hire', 'Imported from CSV', ctx.memberId);
      if (row.pay) writePay(tx, m.id, r.start_day, row.pay, 'hire', 'Imported from CSV', ctx.memberId);
      writeTax(tx, m.id, r.start_day, ent.getString('country'), util.jsonOf(ent, 'packs', []) || [], {}, '');
    }
    out.plan.forEach((row, i) => {
      if (row.managerRow === undefined) return;
      const j = rowOn(tx, 'job_records', ids[i].employment, '9999-12-31');
      j.set('manager', ids[row.managerRow].employee);
      tx.save(j);
    });
    const id = L('lib_files').recordImport(tctx, 'people', 'committed', out.report, out.report.rows);
    L('lib_audit').write(tctx, { op: 'people.import', collection: 'imports', record: id, summary: 'Imported ' + ids.length + ' people from a CSV' });
  });
  ctx.audited = true;
  for (const x of made) L('lib_events').emit(ctx, 'employment.hired', { employment: x.employment, employee: x.employee, entity: x.entity, start_day: x.start_day, from_application: '' });
  return { imported: made.length, report: out.report };
}

/** CSV of the people the caller sees (pay columns only for those whose pay they may see). */
function exportCsv(ctx, p) {
  const util = u();
  const app = ctx.app;
  const day = util.day(p, 'as_of', util.today(app));
  const withPay = util.bool(p, 'include_pay', false);
  const q = { as_of: day, status: util.oneOf(p, 'status', ['current', 'upcoming', 'former', 'all'], 'current'), limit: 500 };
  if (util.str(p, 'entity', '') !== '') q.entity = util.str(p, 'entity', '');
  const rows = [['number', 'legal_name', 'preferred_name', 'work_email', 'phone', 'entity', 'start_day', 'end_day', 'title', 'department', 'location', 'manager', 'status'].concat(withPay ? ['pay_basis', 'pay_amount', 'pay_currency', 'pay_per'] : [])];
  let offset = 0;
  for (let i = 0; i < 100; i++) {
    const page = directory(ctx, Object.assign({}, q, { offset: offset }));
    for (const x of page.people) {
      const mgr = x.manager !== '' ? util.byId(app, 'employees', x.manager) : null;
      const line = [x.number, x.legal_name, x.name !== x.legal_name ? x.name : '', x.work_email, x.phone, x.entity_name, x.start_day, x.end_day, x.title, x.department_name, x.location_name, mgr ? mgr.getString('number') : '', x.employment_status];
      if (withPay) {
        const m = app.findRecordById('employments', x.employment);
        const pay = canSeePay(ctx, m) ? payView(rowOn(app, 'pay_records', m.id, day)) : null;
        line.push(pay ? pay.basis : '', pay ? pay.amount : '', pay ? pay.currency : '', pay ? pay.per : '');
      }
      rows.push(line);
    }
    offset += page.people.length;
    if (offset >= page.total || page.people.length === 0) break;
  }
  L('lib_audit').write(ctx, { op: 'people.export', collection: 'employees', summary: 'Exported ' + (rows.length - 1) + ' people to CSV' + (withPay ? ' with pay' : '') });
  return { filename: 'people-' + day + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

/* ------------------------------------------------------ status refresh */

/** Daily: pre-hires start, notices end; employee statuses follow. */
function refreshStatuses(app) {
  const util = u();
  let n = 0;
  for (const m of util.findMany(app, 'employments', "status != 'ended'", '', 0)) {
    const today = util.today(app, m.getString('entity'));
    const want = m.getString('status') === 'on_leave' && m.getString('start_day') <= today && (m.getString('end_day') === '' || m.getString('end_day') >= today) ? 'on_leave' : statusFor(m.getString('start_day'), m.getString('end_day'), today);
    if (want !== m.getString('status')) {
      m.set('status', want);
      app.save(m);
      const e = app.findRecordById('employees', m.getString('employee'));
      e.set('status', employeeStatus(app, e.id, today));
      app.save(e);
      n++;
    }
  }
  return n;
}

module.exports = {
  PERSONAL: PERSONAL,
  SELF_EDITABLE: SELF_EDITABLE,
  JOB_FIELDS: JOB_FIELDS,
  displayName: displayName,
  employeeRef: employeeRef,
  employmentRef: employmentRef,
  primaryEmployment: primaryEmployment,
  employeeView: employeeView,
  employmentView: employmentView,
  jobView: jobView,
  payView: payView,
  taxView: taxView,
  bankView: bankView,
  idView: idView,
  documentView: documentView,
  rowOn: rowOn,
  asOf: asOf,
  activeEmployments: activeEmployments,
  managerOf: managerOf,
  reportsOf: reportsOf,
  ageOn: ageOn,
  access: access,
  canSeeEmployee: canSeeEmployee,
  needSee: needSee,
  canEditEmployee: canEditEmployee,
  canSeePay: canSeePay,
  statusFor: statusFor,
  employeeStatus: employeeStatus,
  writeJob: writeJob,
  writePay: writePay,
  writeTax: writeTax,
  payValues: payValues,
  personFields: personFields,
  directory: directory,
  orgChart: orgChart,
  get: get,
  timeline: timeline,
  hire: hire,
  update: update,
  archive: archive,
  remove: remove,
  endEmployment: endEmployment,
  employmentsEnd: employmentsEnd,
  employmentsUpdate: employmentsUpdate,
  jobUpdate: (ctx, p) => recUpdate(ctx, 'job', p),
  jobEdit: (ctx, p) => recEdit(ctx, 'job', p),
  jobDelete: (ctx, p) => recDelete(ctx, 'job', p),
  jobHistory: (ctx, p) => recHistory(ctx, 'job', p),
  payUpdate: (ctx, p) => recUpdate(ctx, 'pay', p),
  payEdit: (ctx, p) => recEdit(ctx, 'pay', p),
  payDelete: (ctx, p) => recDelete(ctx, 'pay', p),
  payHistory: (ctx, p) => recHistory(ctx, 'pay', p),
  taxUpdate: (ctx, p) => recUpdate(ctx, 'tax', p),
  taxEdit: (ctx, p) => recEdit(ctx, 'tax', p),
  taxDelete: (ctx, p) => recDelete(ctx, 'tax', p),
  taxHistory: (ctx, p) => recHistory(ctx, 'tax', p),
  previewHire: previewHire,
  previewJobUpdate: (ctx, p) => previewRecord(ctx, 'job', p, false),
  previewJobEdit: (ctx, p) => previewRecord(ctx, 'job', p, true),
  previewPayUpdate: (ctx, p) => previewRecord(ctx, 'pay', p, false),
  previewPayEdit: (ctx, p) => previewRecord(ctx, 'pay', p, true),
  previewTaxUpdate: (ctx, p) => previewRecord(ctx, 'tax', p, false),
  previewTaxEdit: (ctx, p) => previewRecord(ctx, 'tax', p, true),
  bankList: bankList,
  bankAdd: bankAdd,
  bankRetire: bankRetire,
  onBankDecision: onBankDecision,
  idsList: idsList,
  idsAdd: idsAdd,
  idsUpdate: idsUpdate,
  idsDelete: idsDelete,
  idsFile: idsFile,
  documentsList: documentsList,
  documentsAdd: documentsAdd,
  documentsUpdate: documentsUpdate,
  documentsDelete: documentsDelete,
  documentsFile: documentsFile,
  documentsAck: documentsAck,
  photo: photo,
  photoSet: photoSet,
  skillsList: skillsList,
  skillsSet: skillsSet,
  skillsRemove: skillsRemove,
  IMPORT_COLUMNS: IMPORT_COLUMNS,
  importCheck: importCheck,
  importCommit: importCommit,
  exportCsv: exportCsv,
  refreshStatuses: refreshStatuses,
};
