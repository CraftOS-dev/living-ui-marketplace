/// <reference path="../pb_data/types.d.ts" />
/**
 * Hiring plans: staffing plans per entity (lines per department and job
 * title with planned headcount and budget, against the headcount the
 * kernel holds today) and requisitions (a request for new people that an
 * approver decides, approval kind `requisition`). An approved requisition
 * becomes one or more job openings (lib_hiring_jobs); it is filled when as
 * many people were hired as it asked for.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function h() {
  return L('lib_hiring');
}

const REASONS = ['new_role', 'replacement', 'growth'];
const REQ_STATUS = ['draft', 'pending', 'approved', 'rejected', 'filled', 'closed'];

/* ------------------------------------------------------- staffing plans */

/** Active people in an entity (and department, job title) on a day, from the job records in effect. */
function headcount(app, entityId, departmentId, jobTitleId, day) {
  const util = u();
  const bind = { e: entityId, d: day };
  let extra = '';
  if (departmentId) {
    extra += ' AND j.department = {:dep}';
    bind.dep = departmentId;
  }
  if (jobTitleId) {
    extra += ' AND j.job_title = {:jt}';
    bind.jt = jobTitleId;
  }
  return util.count(
    app,
    "SELECT COUNT(*) AS n FROM employments m JOIN job_records j ON j.employment = m.id WHERE m.entity = {:e} AND m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d}) AND j.effective_from = (SELECT MAX(j2.effective_from) FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= {:d})" + extra,
    bind,
  );
}

function lineView(app, line, plan, pay) {
  const util = u();
  const money = L('lib_money');
  const cur = plan.getString('currency');
  const day = util.today(app, plan.getString('entity'));
  const current = headcount(app, plan.getString('entity'), line.getString('department'), line.getString('job_title'), day);
  const reqs = util.one(app, "SELECT CAST(COALESCE(SUM(headcount), 0) AS INTEGER) AS n FROM requisitions WHERE plan_line = {:l} AND status IN ('pending', 'approved')", { n: 0 }, { l: line.id });
  const hired = util.count(app, "SELECT COUNT(*) AS n FROM applications a JOIN openings j ON j.id = a.opening JOIN requisitions r ON r.id = j.requisition WHERE r.plan_line = {:l} AND a.status = 'hired'", { l: line.id });
  const inReqs = reqs === null ? 0 : reqs.n;
  const planned = line.getInt('planned');
  return {
    id: line.id,
    plan: plan.id,
    department: line.getString('department'),
    department_name: h().nameOf(app, 'departments', line.getString('department')),
    job_title: line.getString('job_title'),
    job_title_name: h().nameOf(app, 'job_titles', line.getString('job_title')),
    title: line.getString('title'),
    planned: planned,
    current: current,
    requested: inReqs,
    hired: hired,
    gap: Math.max(0, planned - current - inReqs),
    budget_minor: pay ? line.getInt('budget_minor') : null,
    budget: pay && cur !== '' ? money.fromMinor(line.getInt('budget_minor'), cur) : '',
    note: line.getString('note'),
    sort: line.getInt('sort'),
  };
}

function planView(ctx, plan, withLines) {
  const util = u();
  const app = ctx.app;
  const pay = h().seesPay(ctx, 'all');
  const lines = util.findMany(app, 'staffing_plan_lines', 'plan = {:p}', 'sort,created', 0, { p: plan.id }).map((l) => lineView(app, l, plan, pay));
  const sum = (k) => lines.reduce((a, l) => a + (l[k] || 0), 0);
  const out = {
    id: plan.id,
    entity: plan.getString('entity'),
    entity_name: h().nameOf(app, 'entities', plan.getString('entity')),
    name: plan.getString('name'),
    from_day: plan.getString('from_day'),
    to_day: plan.getString('to_day'),
    currency: plan.getString('currency'),
    status: plan.getString('status'),
    note: plan.getString('note'),
    totals: { planned: sum('planned'), current: sum('current'), requested: sum('requested'), hired: sum('hired'), gap: sum('gap'), budget_minor: pay ? sum('budget_minor') : null },
    lines: withLines ? lines : undefined,
    line_count: lines.length,
    created: plan.getString('created'),
    updated: plan.getString('updated'),
  };
  if (!withLines) delete out.lines;
  return out;
}

function planRef(ctx, ref) {
  const util = u();
  const r = util.byId(ctx.app, 'staffing_plans', util.str({ v: ref }, 'v', ''));
  if (r === null) throw util.fail(404, 'No staffing plan ' + ref + '. Run staffing-plans.list.', 'not_found');
  if (!h().broad(ctx) || !L('lib_auth').inScope(ctx, r.getString('entity'))) throw util.fail(404, 'No staffing plan ' + ref + ' that you can see.', 'not_found');
  return r;
}

function plansList(ctx, p) {
  const util = u();
  if (!h().broad(ctx)) return { plans: [], total: 0, limited: true };
  const where = ['1 = 1'];
  const bind = {};
  const ent = util.str(p, 'entity', '');
  if (ent !== '') {
    where.push('entity = {:e}');
    bind.e = L('lib_org').entityRef(ctx.app, ent).id;
  }
  const status = util.oneOf(p, 'status', ['draft', 'active', 'closed', 'all'], 'all');
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const rows = util.findMany(ctx.app, 'staffing_plans', where.join(' && '), '-from_day,-created', 500, bind).filter((r) => L('lib_auth').inScope(ctx, r.getString('entity')));
  return { plans: rows.map((r) => planView(ctx, r, false)), total: rows.length };
}

function plansGet(ctx, p) {
  return { plan: planView(ctx, planRef(ctx, u().req(p, 'plan')), true) };
}

function plansSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'plan', '');
  if (id !== '') h().needChange(p, 'plan');
  const r = id !== '' ? planRef(ctx, id) : util.newRecord(app, 'staffing_plans');
  const before = id !== '' ? planView(ctx, r, false) : null;
  if (id === '' || util.has(p, 'entity')) {
    const ent = L('lib_org').entityRef(app, util.req(p, 'entity', 'Northwind Pte Ltd'));
    if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'You cannot plan for ' + ent.getString('name') + '.', 'not_permitted');
    r.set('entity', ent.id);
    if (id === '' && !util.has(p, 'currency')) r.set('currency', ent.getString('currency'));
  }
  if (id === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 160, ''));
    if (n === '') throw util.fail(400, 'name is required, e.g. --name "2027 plan"', 'missing_param', { param: 'name' });
    r.set('name', n);
  }
  if (util.has(p, 'from_day')) r.set('from_day', util.day(p, 'from_day', ''));
  if (util.has(p, 'to_day')) r.set('to_day', util.day(p, 'to_day', ''));
  if (r.getString('from_day') !== '' && r.getString('to_day') !== '' && r.getString('to_day') < r.getString('from_day')) throw util.fail(400, 'to_day is before from_day.', 'invalid_param');
  if (util.has(p, 'currency')) {
    const c = util.str(p, 'currency', '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'currency is a three-letter code, e.g. SGD', 'invalid_param', { param: 'currency' });
    if (id !== '' && c !== r.getString('currency') && util.count(app, 'SELECT COUNT(*) AS n FROM staffing_plan_lines WHERE plan = {:p} AND budget_minor > 0', { p: r.id }) > 0) throw util.fail(409, 'Lines already have budgets in ' + r.getString('currency') + '; clear them before changing the currency.', 'conflict');
    r.set('currency', c);
  }
  if (util.has(p, 'status')) r.set('status', util.oneOf(p, 'status', ['draft', 'active', 'closed'], 'draft'));
  else if (id === '') r.set('status', 'draft');
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 2000, ''));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'staffing_plans', record: r.id, summary: (id === '' ? 'Added' : 'Changed') + ' the staffing plan "' + r.getString('name') + '"', before: before, after: planView(ctx, r, false) });
  return { plan: planView(ctx, r, true) };
}

function lineSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const lineId = util.str(p, 'line', '');
  let line = null;
  let plan = null;
  if (lineId !== '') {
    h().needChange(p, 'line');
    line = util.byId(app, 'staffing_plan_lines', lineId);
    if (line === null) throw util.fail(404, 'No plan line ' + lineId + '.', 'not_found');
    plan = planRef(ctx, line.getString('plan'));
  } else {
    plan = planRef(ctx, util.req(p, 'plan'));
    line = util.newRecord(app, 'staffing_plan_lines');
    line.set('plan', plan.id);
    line.set('sort', util.count(app, 'SELECT COUNT(*) AS n FROM staffing_plan_lines WHERE plan = {:p}', { p: plan.id }) + 1);
  }
  const before = lineId !== '' ? lineView(app, line, plan, true) : null;
  if (util.has(p, 'department')) line.set('department', util.str(p, 'department', '') === '' ? '' : org.kindRef(app, 'department', util.str(p, 'department', '')).id);
  if (util.has(p, 'job_title')) line.set('job_title', util.str(p, 'job_title', '') === '' ? '' : org.kindRef(app, 'title', util.str(p, 'job_title', '')).id);
  if (util.has(p, 'title')) line.set('title', util.text(p, 'title', 160, ''));
  if (line.getString('title') === '' && line.getString('job_title') !== '') line.set('title', h().nameOf(app, 'job_titles', line.getString('job_title')));
  if (lineId === '' && line.getString('department') === '' && line.getString('job_title') === '' && line.getString('title') === '') throw util.fail(400, 'Give the line a department, a job title or a title.', 'missing_param', { param: 'department' });
  if (util.has(p, 'planned')) line.set('planned', util.int(p, 'planned', 0, 0, 100000));
  else if (lineId === '') line.set('planned', 0);
  if (util.has(p, 'budget')) line.set('budget_minor', util.money(p, 'budget', plan.getString('currency') || 'USD') || 0);
  if (util.has(p, 'note')) line.set('note', util.text(p, 'note', 1000, ''));
  if (util.has(p, 'sort')) line.set('sort', util.int(p, 'sort', 0, 0, 10000));
  app.save(line);
  L('lib_audit').note(ctx, { collection: 'staffing_plan_lines', record: line.id, summary: (lineId === '' ? 'Added a line to' : 'Changed a line of') + ' the staffing plan "' + plan.getString('name') + '"', before: before, after: lineView(app, line, plan, true) });
  return { line: lineView(app, line, plan, h().seesPay(ctx, 'all')), plan: planView(ctx, plan, true) };
}

/** Proposal preview of staffing-plans.save. */
function previewPlan(ctx, p) {
  const util = u();
  const out = h().savePreview(ctx, p, { collection: 'staffing_plans', id: 'plan', noun: 'staffing plan', name: 'name', nameParam: 'name', fields: { name: 'name', from_day: 'from_day', to_day: 'to_day', currency: 'currency', status: 'status', note: 'note' } });
  if (util.str(p, 'entity', '') !== '') {
    try {
      const ent = L('lib_org').entityRef(ctx.app, util.str(p, 'entity', ''));
      out.label += ' (' + ent.getString('name') + ')';
      out.fields.push({ name: 'entity', before: '', after: ent.getString('name') });
    } catch {
      // checked by the dry run
    }
  }
  return out;
}

/** Proposal preview of staffing-plans.line-save: 'Add line "<label>" to plan "<plan>"'. */
function previewLine(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const line = util.str(p, 'line', '') !== '' ? util.byId(app, 'staffing_plan_lines', util.str(p, 'line', '')) : null;
  const plan = util.byId(app, 'staffing_plans', line !== null ? line.getString('plan') : util.str(p, 'plan', ''));
  const label = util.squash(util.str(p, 'title', '')) || (line !== null ? line.getString('title') : '') || util.str(p, 'job_title', '') || util.str(p, 'department', '');
  const fields = [];
  for (const k of ['department', 'job_title', 'title', 'planned', 'budget', 'note', 'sort']) {
    if (!util.has(p, k)) continue;
    let before = '';
    if (line !== null) {
      if (k === 'budget') before = line.getInt('budget_minor') > 0 ? L('lib_money').fromMinor(line.getInt('budget_minor'), plan !== null ? plan.getString('currency') : 'USD') : '';
      else if (k === 'department') before = hh.nameOf(app, 'departments', line.getString('department'));
      else if (k === 'job_title') before = hh.nameOf(app, 'job_titles', line.getString('job_title'));
      else before = hh.shownValue(line.get(k));
    }
    const after = hh.shownValue(p[k]);
    if (String(before) !== after) fields.push({ name: k, before: String(before), after: after });
  }
  return { label: (line !== null ? 'Change line' : 'Add line') + (label !== '' ? ' "' + label + '"' : '') + (plan !== null ? (line !== null ? ' of plan "' : ' to plan "') + plan.getString('name') + '"' : ''), target: line !== null ? 'staffing_plan_lines:' + line.id : '', fields: fields, notes: [], risk: 'low' };
}

function lineDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const line = util.byId(app, 'staffing_plan_lines', util.req(p, 'line'));
  if (line === null) throw util.fail(404, 'No such plan line.', 'not_found');
  const plan = planRef(ctx, line.getString('plan'));
  const reqs = util.count(app, 'SELECT COUNT(*) AS n FROM requisitions WHERE plan_line = {:l}', { l: line.id });
  if (reqs > 0) throw util.fail(409, reqs + ' requisition' + (reqs === 1 ? ' uses' : 's use') + ' this line; it stays.', 'in_use', { requisitions: reqs });
  app.delete(line);
  L('lib_audit').note(ctx, { collection: 'staffing_plan_lines', record: line.id, summary: 'Removed a line from the staffing plan "' + plan.getString('name') + '"' });
  return { deleted: true, plan: planView(ctx, plan, true) };
}

function plansDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const plan = planRef(ctx, util.req(p, 'plan'));
  const reqs = util.count(app, 'SELECT COUNT(*) AS n FROM requisitions r JOIN staffing_plan_lines l ON l.id = r.plan_line WHERE l.plan = {:p}', { p: plan.id });
  if (reqs > 0) throw util.fail(409, reqs + ' requisition' + (reqs === 1 ? ' is' : 's are') + ' linked to this plan; close the plan instead.', 'in_use', { requisitions: reqs });
  app.delete(plan);
  L('lib_audit').note(ctx, { collection: 'staffing_plans', record: plan.id, summary: 'Deleted the staffing plan "' + plan.getString('name') + '"' });
  return { deleted: true };
}

/* ---------------------------------------------------------- requisitions */

function reqAccess(ctx, r) {
  if (ctx.isAgent || ctx.actor === 'system') return 'all';
  const hh = h();
  if (hh.level(ctx) === 'none') return '';
  if (hh.broad(ctx) && L('lib_auth').inScope(ctx, r.getString('entity'))) return 'all';
  const me = ctx.memberId || '';
  if (me !== '' && (r.getString('requested_by') === me || r.getString('hiring_manager') === me)) return 'team';
  return '';
}

function reqView(ctx, r, access) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const money = L('lib_money');
  const cache = {};
  const pay = hh.seesPay(ctx, access);
  const cur = r.getString('currency');
  const openings = util.rows(app, 'SELECT id, number, title, status, positions FROM openings WHERE requisition = {:r} ORDER BY created', { id: '', number: '', title: '', status: '', positions: 0 }, { r: r.id });
  const hired = util.count(app, "SELECT COUNT(*) AS n FROM applications a JOIN openings j ON j.id = a.opening WHERE j.requisition = {:r} AND a.status = 'hired'", { r: r.id });
  const ap = r.getString('approval') !== '' ? util.byId(app, 'approvals', r.getString('approval')) : null;
  const rep = r.getString('replaces') !== '' ? util.byId(app, 'employees', r.getString('replaces')) : null;
  const line = r.getString('plan_line') !== '' ? util.byId(app, 'staffing_plan_lines', r.getString('plan_line')) : null;
  const plan = line !== null ? util.byId(app, 'staffing_plans', line.getString('plan')) : null;
  const m = (k) => (pay && cur !== '' && r.getInt(k) > 0 ? money.fromMinor(r.getInt(k), cur) : '');
  return {
    id: r.id,
    number: r.getString('number'),
    entity: r.getString('entity'),
    entity_name: hh.nameOf(app, 'entities', r.getString('entity')),
    department: r.getString('department'),
    department_name: hh.nameOf(app, 'departments', r.getString('department')),
    plan_line: r.getString('plan_line'),
    plan: plan !== null ? { id: plan.id, name: plan.getString('name') } : null,
    title: r.getString('title'),
    job_title: r.getString('job_title'),
    job_title_name: hh.nameOf(app, 'job_titles', r.getString('job_title')),
    headcount: r.getInt('headcount'),
    reason: r.getString('reason'),
    replaces: r.getString('replaces'),
    replaces_name: rep !== null ? L('lib_people').displayName(rep) : '',
    employment_type: r.getString('employment_type'),
    employment_type_name: hh.nameOf(app, 'employment_types', r.getString('employment_type')),
    location: r.getString('location'),
    location_name: hh.nameOf(app, 'locations', r.getString('location')),
    remote: r.getString('remote'),
    currency: cur,
    budget_minor: pay ? r.getInt('budget_minor') : null,
    budget: m('budget_minor'),
    pay_min_minor: pay ? r.getInt('pay_min_minor') : null,
    pay_max_minor: pay ? r.getInt('pay_max_minor') : null,
    pay_min: m('pay_min_minor'),
    pay_max: m('pay_max_minor'),
    pay_per: r.getString('pay_per'),
    hiring_manager: r.getString('hiring_manager'),
    hiring_manager_name: hh.memberName(app, r.getString('hiring_manager'), cache),
    target_start_day: r.getString('target_start_day'),
    justification: r.getString('justification'),
    status: r.getString('status'),
    approval: r.getString('approval'),
    approval_status: ap !== null ? ap.getString('status') : '',
    requested_by: r.getString('requested_by'),
    requested_by_name: r.getString('requested_actor') === 'agent' ? 'Your AI agent' : hh.memberName(app, r.getString('requested_by'), cache),
    decided_note: r.getString('decided_note'),
    closed_reason: r.getString('closed_reason'),
    closed_at: r.getString('closed_at'),
    openings: openings.map((o) => ({ id: o.id, number: o.number, title: o.title, status: o.status, positions: o.positions })),
    hired: hired,
    access: access,
    can: {
      edit: hh.writable(ctx, access) && ['draft', 'rejected'].indexOf(r.getString('status')) >= 0 && hh.agentMay(ctx, 'requisitions.save'),
      submit: hh.writable(ctx, access) && ['draft', 'rejected'].indexOf(r.getString('status')) >= 0 && hh.agentMay(ctx, 'requisitions.submit'),
      open: hh.writable(ctx, access) && r.getString('status') === 'approved' && hh.agentMay(ctx, 'openings.add'),
      close: hh.isFull(ctx) && ['filled', 'closed'].indexOf(r.getString('status')) < 0 && hh.agentMay(ctx, 'requisitions.close'),
    },
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

function reqRef(ctx, ref) {
  const util = u();
  const s = String(ref || '').trim();
  const r = util.byId(ctx.app, 'requisitions', s) || (s !== '' ? util.findOne(ctx.app, 'requisitions', 'number = {:n}', { n: s.toUpperCase() }) : null);
  if (r === null) throw util.fail(404, 'No requisition ' + ref + '. Run requisitions.list.', 'not_found');
  const a = reqAccess(ctx, r);
  if (a === '') throw util.fail(404, 'No requisition ' + ref + ' that you can see.', 'not_found');
  return { rec: r, access: a };
}

function reqsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  if (hh.level(ctx) === 'none') return { requisitions: [], total: 0 };
  const bind = {};
  const where = [];
  if (hh.broad(ctx)) where.push(hh.reqScopeWhere(ctx, bind));
  else {
    where.push('(r.requested_by = {:me} OR r.hiring_manager = {:me})');
    bind.me = ctx.memberId || '-';
  }
  const status = util.str(p, 'status', 'open');
  if (status === 'open') where.push("r.status IN ('draft', 'pending', 'approved', 'rejected')");
  else if (status !== 'all') {
    if (REQ_STATUS.indexOf(status) < 0) throw util.fail(400, 'status is open, all or one of ' + REQ_STATUS.join(', '), 'invalid_param', { param: 'status' });
    where.push('r.status = {:s}');
    bind.s = status;
  }
  const ent = util.str(p, 'entity', '');
  if (ent !== '') {
    where.push('r.entity = {:e}');
    bind.e = L('lib_org').entityRef(app, ent).id;
  }
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(r.title LIKE {:q} ESCAPE '\\' OR r.number LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const pg = util.page(p, 50, 300);
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM requisitions r WHERE ' + w, bind);
  const ids = util.rows(app, 'SELECT r.id AS id FROM requisitions r WHERE ' + w + ' ORDER BY r.updated DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return { requisitions: ids.map((x) => { const r = app.findRecordById('requisitions', x.id); return reqView(ctx, r, reqAccess(ctx, r)); }), total: total };
}

function reqsGet(ctx, p) {
  const x = reqRef(ctx, u().req(p, 'requisition'));
  return { requisition: reqView(ctx, x.rec, x.access) };
}

function reqsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const hh = h();
  const id = util.str(p, 'requisition', '');
  let r;
  let access = 'all';
  if (id !== '') {
    const x = reqRef(ctx, id);
    r = x.rec;
    access = x.access;
    if (!hh.writable(ctx, access)) throw util.fail(403, 'Your role can look at this requisition but not change it.', 'not_permitted');
    if (['draft', 'rejected'].indexOf(r.getString('status')) < 0) throw util.fail(409, 'This requisition is ' + r.getString('status') + '; only a draft (or a rejected one) can be changed.', 'conflict');
  } else {
    r = util.newRecord(app, 'requisitions');
    r.set('status', 'draft');
    r.set('requested_by', ctx.memberId || '');
    r.set('requested_actor', ctx.isAgent ? 'agent' : 'person');
    r.set('headcount', 1);
    r.set('reason', 'new_role');
    if (!ctx.isAgent && !hh.broad(ctx)) r.set('hiring_manager', ctx.memberId || '');
  }
  const before = id !== '' ? reqView(ctx, r, access) : null;
  if (id === '' || util.has(p, 'entity')) {
    const ent = org.entityRef(app, util.req(p, 'entity', 'Northwind Pte Ltd'));
    if (hh.broad(ctx) && !L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'You cannot ask for people in ' + ent.getString('name') + '.', 'not_permitted');
    if (r.getString('currency') !== '' && r.getString('currency') !== ent.getString('currency') && (r.getInt('budget_minor') > 0 || r.getInt('pay_min_minor') > 0 || r.getInt('pay_max_minor') > 0) && !util.has(p, 'budget')) throw util.fail(409, 'The amounts are in ' + r.getString('currency') + '; give them again in ' + ent.getString('currency') + '.', 'conflict');
    r.set('entity', ent.id);
    r.set('currency', ent.getString('currency'));
  }
  if (id === '' || util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 160, ''));
    if (t === '' && util.str(p, 'job_title', '') === '') throw util.fail(400, 'title is required, e.g. --title "Backend engineer"', 'missing_param', { param: 'title' });
    if (t !== '') r.set('title', t);
  }
  if (util.has(p, 'job_title')) {
    const jt = util.str(p, 'job_title', '') === '' ? null : org.kindRef(app, 'title', util.str(p, 'job_title', ''));
    r.set('job_title', jt === null ? '' : jt.id);
    if (r.getString('title') === '' && jt !== null) r.set('title', jt.getString('name'));
  }
  if (util.has(p, 'department')) r.set('department', util.str(p, 'department', '') === '' ? '' : org.kindRef(app, 'department', util.str(p, 'department', '')).id);
  if (util.has(p, 'plan_line')) {
    const lid = util.str(p, 'plan_line', '');
    if (lid === '') r.set('plan_line', '');
    else {
      const line = util.byId(app, 'staffing_plan_lines', lid);
      if (line === null) throw util.fail(404, 'No plan line ' + lid + '.', 'not_found');
      const plan = app.findRecordById('staffing_plans', line.getString('plan'));
      if (plan.getString('entity') !== r.getString('entity')) throw util.fail(400, 'That plan line belongs to another entity.', 'invalid_param', { param: 'plan_line' });
      r.set('plan_line', line.id);
      if (r.getString('department') === '' && line.getString('department') !== '') r.set('department', line.getString('department'));
    }
  }
  if (util.has(p, 'headcount')) r.set('headcount', util.int(p, 'headcount', 1, 1, 1000));
  if (util.has(p, 'reason')) r.set('reason', util.oneOf(p, 'reason', REASONS, 'new_role'));
  if (util.has(p, 'replaces')) r.set('replaces', util.str(p, 'replaces', '') === '' ? '' : L('lib_people').employeeRef(app, util.str(p, 'replaces', '')).id);
  if (util.has(p, 'employment_type')) r.set('employment_type', util.str(p, 'employment_type', '') === '' ? '' : org.kindRef(app, 'employment_type', util.str(p, 'employment_type', '')).id);
  if (util.has(p, 'location')) r.set('location', util.str(p, 'location', '') === '' ? '' : org.kindRef(app, 'location', util.str(p, 'location', '')).id);
  if (util.has(p, 'remote')) r.set('remote', util.oneOf(p, 'remote', hh.REMOTE, ''));
  const cur = r.getString('currency');
  if (util.has(p, 'budget')) r.set('budget_minor', util.money(p, 'budget', cur) || 0);
  if (util.has(p, 'pay_min')) r.set('pay_min_minor', util.money(p, 'pay_min', cur) || 0);
  if (util.has(p, 'pay_max')) r.set('pay_max_minor', util.money(p, 'pay_max', cur) || 0);
  if (r.getInt('pay_min_minor') > 0 && r.getInt('pay_max_minor') > 0 && r.getInt('pay_min_minor') > r.getInt('pay_max_minor')) throw util.fail(400, 'pay_min is above pay_max.', 'invalid_param', { param: 'pay_min' });
  if (util.has(p, 'pay_per')) r.set('pay_per', util.oneOf(p, 'pay_per', hh.PER, ''));
  if (util.has(p, 'hiring_manager')) r.set('hiring_manager', util.str(p, 'hiring_manager', '') === '' ? '' : hh.memberIds(app, [util.str(p, 'hiring_manager', '')], 'hiring_manager')[0]);
  if (util.has(p, 'target_start_day')) r.set('target_start_day', util.day(p, 'target_start_day', ''));
  if (util.has(p, 'justification')) r.set('justification', util.text(p, 'justification', 4000, ''));
  if (r.getString('status') === 'rejected') r.set('status', 'draft');
  if (r.getString('number') === '') r.set('number', 'R' + String(util.nextNumber(app, 'requisition')).padStart(4, '0'));
  app.save(r);
  const v = reqView(ctx, r, reqAccess(ctx, r) || access);
  L('lib_audit').note(ctx, { collection: 'requisitions', record: r.id, summary: (id === '' ? 'Drafted' : 'Changed') + ' requisition ' + r.getString('number') + ' (' + r.getString('title') + ')', before: before, after: v });
  return { requisition: v };
}

function reqsSubmit(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = reqRef(ctx, util.req(p, 'requisition'));
  const r = x.rec;
  if (!hh.writable(ctx, x.access)) throw util.fail(403, 'Your role can look at this requisition but not send it for approval.', 'not_permitted');
  if (['draft', 'rejected'].indexOf(r.getString('status')) < 0) throw util.fail(409, 'This requisition is already ' + r.getString('status') + '.', 'conflict');
  if (r.getString('title') === '') throw util.fail(400, 'Give the requisition a title first.', 'missing_param', { param: 'title' });
  const v = reqView(ctx, r, 'all');
  const money = L('lib_money');
  const fmt = (k) => (r.getInt(k) > 0 && r.getString('currency') !== '' ? money.format(r.getInt(k), r.getString('currency')) : '');
  const range = [fmt('pay_min_minor'), fmt('pay_max_minor')].filter((s) => s !== '').join(' to ');
  const pay = range !== '' ? range + (v.pay_per !== '' ? ' a ' + v.pay_per : '') : '';
  let out = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const rec = tx.findRecordById('requisitions', r.id);
    rec.set('status', 'pending');
    rec.set('decided_note', '');
    tx.save(rec);
    const ap = L('lib_approvals').open(t, {
      kind: 'requisition',
      ref_collection: 'requisitions',
      ref_id: rec.id,
      entity: rec.getString('entity'),
      summary: 'New role ' + rec.getString('number') + ': ' + rec.getString('title') + (rec.getInt('headcount') > 1 ? ' (' + rec.getInt('headcount') + ' people)' : '') + (v.department_name !== '' ? ', ' + v.department_name : '') + ', ' + v.entity_name,
      amount_minor: rec.getInt('budget_minor'),
      currency: rec.getString('currency'),
      facts: [{ type: 'number', key: 'headcount', label: 'Headcount', value: rec.getInt('headcount'), unit: rec.getInt('headcount') === 1 ? 'person' : 'people' }, { type: 'text', key: 'title', label: 'Role', value: rec.getString('title') }, { type: 'text', key: 'where', label: 'Team', value: [v.department_name, v.entity_name].filter((x) => x !== '').join(', ') }]
        .concat(rec.getInt('budget_minor') > 0 && rec.getString('currency') !== '' ? [{ type: 'money', key: 'budget', label: 'Budget', amount_minor: rec.getInt('budget_minor'), currency: rec.getString('currency') }] : [])
        .concat(rec.getInt('pay_min_minor') > 0 && rec.getString('currency') !== '' ? [{ type: 'money', key: 'pay_min', label: 'Pay from', amount_minor: rec.getInt('pay_min_minor'), currency: rec.getString('currency') }] : [])
        .concat(rec.getInt('pay_max_minor') > 0 && rec.getString('currency') !== '' ? [{ type: 'money', key: 'pay_max', label: 'Pay up to', amount_minor: rec.getInt('pay_max_minor'), currency: rec.getString('currency') }] : [])
        .concat(rec.getString('target_start_day') !== '' ? [{ type: 'day', key: 'target_start_day', label: 'Target start', value: rec.getString('target_start_day') }] : []),
      payload: { requisition: rec.id, number: rec.getString('number'), title: rec.getString('title'), headcount: rec.getInt('headcount'), reason: rec.getString('reason'), entity_name: v.entity_name, department_name: v.department_name, replaces_name: v.replaces_name, currency: rec.getString('currency'), pay_min_minor: rec.getInt('pay_min_minor'), pay_max_minor: rec.getInt('pay_max_minor'), pay_per: rec.getString('pay_per'), budget_minor: rec.getInt('budget_minor'), target_start_day: rec.getString('target_start_day'), justification: rec.getString('justification'), plan: v.plan ? v.plan.name : '' },
    });
    const fresh = tx.findRecordById('requisitions', rec.id);
    fresh.set('approval', ap.id);
    tx.save(fresh);
    L('lib_audit').write(t, { op: 'requisitions.submit', collection: 'requisitions', record: rec.id, summary: 'Sent requisition ' + rec.getString('number') + ' (' + rec.getString('title') + ') for approval' });
    out = ap;
  });
  ctx.audited = true;
  const fresh = app.findRecordById('requisitions', r.id);
  return { requisition: reqView(ctx, fresh, reqAccess(ctx, fresh)), approval: out };
}

/** The approval subscriber of kind `requisition`. */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const r = util.byId(ctx.app, 'requisitions', approval.ref_id);
  if (r === null) return;
  if (decision === 'approved') r.set('status', 'approved');
  else if (decision === 'rejected') r.set('status', 'rejected');
  else r.set('status', 'draft');
  r.set('decided_note', util.clip(note || '', 2000));
  ctx.app.save(r);
}

function reqsClose(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = reqRef(ctx, util.req(p, 'requisition'));
  const r = x.rec;
  if (['filled', 'closed'].indexOf(r.getString('status')) >= 0) throw util.fail(409, 'This requisition is already ' + r.getString('status') + '.', 'conflict');
  if (r.getString('status') === 'pending' && r.getString('approval') !== '') L('lib_approvals').cancel(ctx, r.getString('approval'), 'Requisition closed');
  const fresh = app.findRecordById('requisitions', r.id);
  fresh.set('status', 'closed');
  fresh.set('closed_reason', util.text(p, 'reason', 400, ''));
  fresh.set('closed_at', util.nowIso());
  app.save(fresh);
  const open = util.count(app, "SELECT COUNT(*) AS n FROM openings WHERE requisition = {:r} AND status IN ('draft', 'open', 'on_hold')", { r: r.id });
  L('lib_audit').note(ctx, { collection: 'requisitions', record: r.id, summary: 'Closed requisition ' + r.getString('number') + (fresh.getString('closed_reason') !== '' ? ' (' + fresh.getString('closed_reason') + ')' : '') });
  return { requisition: reqView(ctx, fresh, x.access), openings_still_open: open };
}

function reqsDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = reqRef(ctx, util.req(p, 'requisition'));
  const r = x.rec;
  if (!h().writable(ctx, x.access)) throw util.fail(403, 'Your role cannot delete this requisition.', 'not_permitted');
  if (['draft', 'rejected'].indexOf(r.getString('status')) < 0) throw util.fail(409, 'Only a draft or rejected requisition can be deleted; close it instead.', 'conflict');
  if (util.count(app, 'SELECT COUNT(*) AS n FROM openings WHERE requisition = {:r}', { r: r.id }) > 0) throw util.fail(409, 'Openings were made from this requisition; close it instead.', 'in_use');
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'requisitions', record: r.id, summary: 'Deleted requisition ' + r.getString('number') + ' (' + r.getString('title') + ')' });
  return { deleted: true };
}

/** After a hire: a requisition with as many hires as it asked for is filled. */
function refreshFilled(app, requisitionId) {
  const util = u();
  if (!requisitionId) return '';
  const r = util.byId(app, 'requisitions', requisitionId);
  if (r === null) return '';
  const hired = util.count(app, "SELECT COUNT(*) AS n FROM applications a JOIN openings j ON j.id = a.opening WHERE j.requisition = {:r} AND a.status = 'hired'", { r: r.id });
  if (hired >= r.getInt('headcount') && r.getString('status') === 'approved') {
    r.set('status', 'filled');
    r.set('closed_at', util.nowIso());
    app.save(r);
  }
  return r.getString('status');
}

module.exports = {
  REASONS: REASONS,
  headcount: headcount,
  plansList: plansList,
  plansGet: plansGet,
  plansSave: plansSave,
  plansDelete: plansDelete,
  lineSave: lineSave,
  previewPlan: previewPlan,
  previewLine: previewLine,
  lineDelete: lineDelete,
  reqAccess: reqAccess,
  reqView: reqView,
  reqRef: reqRef,
  reqsList: reqsList,
  reqsGet: reqsGet,
  reqsSave: reqsSave,
  reqsSubmit: reqsSubmit,
  reqsClose: reqsClose,
  reqsDelete: reqsDelete,
  onDecision: onDecision,
  refreshFilled: refreshFilled,
};
