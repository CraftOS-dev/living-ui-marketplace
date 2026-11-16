/// <reference path="../pb_data/types.d.ts" />
/**
 * Leave reads for the screens and your AI agent: the HR home (who is out,
 * what waits, balances that need attention), the employee's own view, the
 * team wallchart, the balance table and one balance explained, the ledger,
 * who is out on given days, the Japanese five-day obligation and the
 * 年次有給休暇管理簿 (annual paid leave register, kept for the grant period
 * and three years after), and the daily notices.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function lv() {
  return L('lib_leave');
}
function rq() {
  return L('lib_leave_req');
}

/* -------------------------------------------------------------- scope */

/**
 * Employments the caller sees in leave lists on a day, and how:
 * { mode: 'all' | 'team' | 'peers', ids, types: bool (may see the leave type) }.
 */
function visible(ctx, day, p) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const people = L('lib_people');
  const entRef = util.str(p || {}, 'entity', '');
  const ent = entRef !== '' ? L('lib_org').entityRef(app, entRef).id : '';
  const from = (p && p.from) || day;
  const to = (p && p.to) || day;
  if (ctx.isAgent || auth.can(ctx, 'leave', 'view')) {
    const sc = auth.scope(ctx);
    const bind = { f: from, t: to, e: ent };
    let ids = util
      .rows(app, "SELECT id, entity FROM employments WHERE start_day <= {:t} AND (end_day = '' OR end_day >= {:f})" + (ent !== '' ? ' AND entity = {:e}' : '') + ' ORDER BY number', { id: '', entity: '' }, bind)
      .filter((m) => sc.length === 0 || sc.indexOf(m.entity) >= 0)
      .map((m) => m.id);
    const dep = util.str(p || {}, 'department', '');
    if (dep !== '') {
      const d = L('lib_org').kindRef(app, 'department', dep).id;
      const r = lv().roster(lv().session(app), ids, from);
      ids = ids.filter((id) => r[id] && r[id].job !== null && r[id].job.department === d);
    }
    return { mode: 'all', ids: ids, types: true };
  }
  const self = auth.selfEmployee(ctx);
  const own = self !== '' ? util.rows(app, "SELECT id FROM employments WHERE employee = {:e} AND start_day <= {:t} AND (end_day = '' OR end_day >= {:f})", { id: '' }, { e: self, f: from, t: to }).map((r) => r.id) : [];
  if (ctx.teamScope && self !== '') {
    const team = people.reportsOf(app, self, day, true).map((r) => r.employment);
    return { mode: 'team', ids: own.concat(team.filter((x) => own.indexOf(x) < 0)), types: true, own: own };
  }
  const peers = {};
  for (const id of own) for (const x of rq().teamOf(app, app.findRecordById('employments', id), day)) peers[x] = true;
  for (const id of own) delete peers[id];
  return { mode: 'peers', ids: own.concat(Object.keys(peers)), types: false, own: own };
}

function inIds(bind, ids, prefix) {
  return ids.map((id, i) => ((bind[prefix + i] = id), '{:' + prefix + i + '}')).join(',');
}

/** Leave of the given employments overlapping [from, to], as views the caller may see. */
function leaveBetween(ctx, vis, from, to, statuses, S0) {
  const util = u();
  const app = ctx.app;
  if (vis.ids.length === 0) return [];
  const S = S0 || lv().session(app);
  const bind = { f: from, t: to };
  const st = statuses || ['approved', 'cancelling', 'pending'];
  const rows = util.rows(app, 'SELECT id FROM leave_requests WHERE [[start]] <= {:t} AND [[end]] >= {:f} AND status IN (' + st.map((s, i) => ((bind['st' + i] = s), '{:st' + i + '}')).join(',') + ') AND employment IN (' + inIds(bind, vis.ids, 'i') + ') ORDER BY [[start]]', { id: '' }, bind);
  const own = vis.own || [];
  const recs = {};
  for (let i = 0; i < rows.length; i += 500) for (const r of app.findRecordsByIds('leave_requests', rows.slice(i, i + 500).map((x) => x.id))) recs[r.id] = r;
  const empIds = Object.keys(Object.keys(recs).reduce((a, k) => ((a[recs[k].getString('employment')] = true), a), {}));
  lv().loadEmployments(S, empIds);
  lv().roster(S, empIds.filter((id) => !S.people || S.people[id] === undefined), from);
  return rows.map((x) => {
    const v = rq().requestView(app, recs[x.id], S);
    const t = lv().typeById(S, v.type_id);
    const hide = !vis.types && own.indexOf(v.employment) < 0;
    const hideType = hide || (t && t.getString('visibility') === 'away' && vis.mode !== 'all' && own.indexOf(v.employment) < 0);
    return hideType ? rq().awayView(v) : v;
  });
}

/* --------------------------------------------------------------- home */

/** Members with full access to Leave who cover an entity. */
function leaveAdmins(app, entityId) {
  const util = u();
  const auth = L('lib_auth');
  const out = [];
  for (const m of util.findMany(app, 'members', "status = 'active'", 'created')) {
    const role = util.byId(app, 'roles', m.getString('role'));
    if (role === null) continue;
    const lvl = auth.levelsOfRole(role).leave;
    if (role.getString('code') !== 'owner' && lvl !== 'full') continue;
    const ents = util.jsonOf(m, 'entities', []) || [];
    if (ents.length > 0 && ents.indexOf(entityId) < 0 && role.getString('code') !== 'owner') continue;
    out.push(m.id);
  }
  return out;
}

/** The five-day rule (Japan) for one employment: the current grant window and the one that just closed. */
function obligationOf(S, empRec, t, day, walked) {
  const util = u();
  const rule = lv().ruleFor(S, empRec, t.getString('code'), day);
  if (!rule || rule.method !== 'statutory_jp' || rule.obligation === false) return [];
  const sim = walked || lv().simulate(S, empRec, t, day, {});
  const out = [];
  for (const e of sim.timeline) {
    if (!e.meta || !e.meta.jp || !e.meta.obligation) continue;
    const base = e.meta.base;
    const deadline = e.meta.deadline;
    if (deadline < util.dayAdd(day, -60) || base > day) continue;
    let taken = 0;
    let planned = 0;
    for (const r of util.findMany(S.app, 'leave_requests', "employment = {:e} && type = {:t} && start <= {:to} && end >= {:f} && (status = 'approved' || status = 'cancelling') && hours = 0", 'start', 0, { e: empRec.id, t: t.id, f: base, to: deadline })) {
      for (const d of util.jsonOf(r, 'day_list', []) || []) {
        if (d.day < base || d.day > deadline || Number(d.hours) > 0) continue;
        if (d.day > day) planned += Number(d.days) || 0;
        else taken += Number(d.days) || 0;
      }
    }
    const done = lv().r2(taken + planned);
    const short = Math.max(0, lv().r2(5 - done));
    const left = util.daysBetween(day, deadline);
    const status = short === 0 ? 'done' : deadline < day ? 'missed' : left <= 90 ? 'at_risk' : 'on_track';
    out.push({ base: base, deadline: deadline, granted: e.meta.granted, taken: lv().r2(taken), planned: lv().r2(planned), short: short, days_left: left, status: status });
  }
  return out;
}

function overview(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const today = util.day(p, 'day', util.today(app));
  const weekEnd = util.dayAdd(today, 6);
  const vis = visible(ctx, today, { entity: util.str(p, 'entity', ''), department: util.str(p, 'department', ''), from: today, to: weekEnd });
  const outToday = leaveBetween(ctx, vis, today, today, ['approved', 'cancelling']);
  const outWeek = leaveBetween(ctx, vis, today, weekEnd, ['approved', 'cancelling', 'pending']);
  const bind = {};
  const waitingRows =
    vis.ids.length > 0
      ? util.rows(app, "SELECT id FROM leave_requests WHERE status IN ('pending', 'cancelling') AND employment IN (" + inIds(bind, vis.ids, 'i') + ') ORDER BY created', { id: '' }, bind)
      : [];
  const waiting = waitingRows.slice(0, 20).map((x) => rq().requestView(app, app.findRecordById('leave_requests', x.id), S));
  const setup = [];
  if (ctx.isAgent || L('lib_auth').can(ctx, 'leave', 'full')) {
    for (const e of util.rows(app, 'SELECT id, name, country FROM entities WHERE active = TRUE ORDER BY created', { id: '', name: '', country: '' })) {
      if (!L('lib_auth').inScope(ctx, e.id)) continue;
      if (util.count(app, 'SELECT COUNT(*) AS n FROM leave_types WHERE entity = {:e}', { e: e.id }) === 0) setup.push({ entity: e.id, name: e.name, country: e.country });
    }
  }
  const bind2 = {};
  const extra =
    vis.ids.length > 0 && vis.mode !== 'peers'
      ? {
          encash: util.count(app, "SELECT COUNT(*) AS n FROM leave_encash_requests WHERE status = 'pending' AND employment IN (" + inIds(bind2, vis.ids, 'i') + ')', bind2),
          comp_off: util.count(app, "SELECT COUNT(*) AS n FROM leave_comp_offs WHERE status = 'pending' AND employment IN (" + inIds(bind2, vis.ids, 'i') + ')', bind2),
        }
      : { encash: 0, comp_off: 0 };
  return {
    today: today,
    week_end: weekEnd,
    mode: vis.mode,
    people: vis.ids.length,
    out_today: outToday,
    out_week: outWeek,
    waiting: waiting,
    waiting_total: waitingRows.length,
    waiting_other: extra,
    setup: setup,
  };
}

/** The leave_attention rows of employments (written by the sync), with their type. */
function attentionRows(app, ids, where, bind0) {
  const util = u();
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const bind = Object.assign({}, bind0 || {});
    const keys = ids.slice(i, i + 500).map((id, j) => ((bind['e' + j] = id), '{:e' + j + '}')).join(',');
    for (const r of util.rows(
      app,
      'SELECT a.employment AS employment, a.kind AS kind, a.day AS day, a.amount AS amount, a.detail AS detail, t.code AS code, t.name AS tname, t.color AS color, t.icon AS icon, t.unit AS unit FROM leave_attention a JOIN leave_types t ON t.id = a.type WHERE t.archived = FALSE AND a.employment IN (' + keys + ')' + (where ? ' AND ' + where : '') + ' ORDER BY a.day',
      { employment: '', kind: '', day: '', amount: -0, detail: '', code: '', tname: '', color: '', icon: '', unit: '' },
      bind,
    )) {
      let d = {};
      try {
        d = JSON.parse(r.detail || '{}') || {};
      } catch (e) {
        d = {};
      }
      out.push({ employment: r.employment, kind: r.kind, day: r.day, amount: r.amount, code: r.code, tname: r.tname, color: r.color, icon: r.icon, unit: r.unit, detail: d });
    }
  }
  return out;
}

/**
 * Balances that need attention: the five-day rule, days that lapse within 60 days, balances below zero.
 * Read from leave_attention, which the sync keeps for every change and the daily run renews.
 */
function attentionOp(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const today = util.day(p, 'day', util.today(app));
  const vis = visible(ctx, today, { entity: util.str(p, 'entity', ''), department: util.str(p, 'department', ''), from: today, to: today });
  const attention = { obligation: [], expiring: [], negative: [] };
  if (vis.mode !== 'peers' && vis.ids.length > 0) {
    const rows = attentionRows(app, vis.ids, '', {});
    const ids = Object.keys(rows.reduce((a, r) => ((a[r.employment] = true), a), {}));
    const ros = lv().roster(S, ids, today);
    for (const r of rows) {
      const person = ros[r.employment] ? ros[r.employment].person : { number: '', name: '' };
      const unit = r.unit || 'day';
      const base = { employment: r.employment, number: person.number, name: person.name, type: r.code };
      if (r.kind === 'expiring' && r.day >= today) attention.expiring.push(Object.assign(base, { type_name: r.tname, color: r.color, icon: r.icon, unit: unit, amount: r.amount, day: r.day, expires: r.detail.expires || '' }));
      else if (r.kind === 'negative') attention.negative.push(Object.assign(base, { type_name: r.tname, unit: unit, balance: r.amount }));
      else if (r.kind === 'obligation') attention.obligation.push(Object.assign(base, r.detail, { days_left: util.daysBetween(today, r.detail.deadline), status: r.detail.deadline < today ? 'missed' : r.detail.status }));
    }
    attention.expiring.sort((a, b) => (a.day < b.day ? -1 : 1));
    attention.obligation.sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  }
  return { day: today, mode: vis.mode, attention: attention };
}

/* ---------------------------------------------------------------- mine */

function mine(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const auth = L('lib_auth');
  const empRef = util.str(p, 'employment', '');
  let emp = null;
  if (empRef !== '') {
    emp = L('lib_people').employmentRef(app, empRef);
    lv().needSee(ctx, emp);
  } else {
    const self = auth.selfEmployee(ctx);
    if (self === '') return { employment: null, reason: ctx.isAgent ? 'Your AI agent has no leave of its own; give --employment.' : 'Your account is not linked to an employee yet. Ask HR to link it.' };
    const id = L('lib_people').primaryEmployment(app, self, util.today(app));
    if (id === '') return { employment: null, reason: 'You have no employment yet.' };
    emp = app.findRecordById('employments', id);
  }
  const today = lv().todayOf(S, emp.getString('entity'));
  const person = lv().personOf(app, emp);
  const ent = app.findRecordById('entities', emp.getString('entity'));
  const types = [];
  const balances = [];
  for (const t of lv().typesFor(S, emp.getString('entity'), false)) {
    const rule = lv().ruleFor(S, emp, t.getString('code'), today >= emp.getString('start_day') ? today : emp.getString('start_day'));
    if (rule === null) continue;
    const b = lv().balanceInfo(S, emp, t, today, {});
    balances.push(b);
    const v = lv().typeView(t);
    v.tracked = b.tracked;
    v.available = b.available;
    v.method = rule.method;
    types.push(v);
  }
  const reqs = util.findMany(app, 'leave_requests', 'employment = {:e}', '-start', 200, { e: emp.id }).map((r) => rq().requestView(app, r, S));
  // The type a new request opens with: the one this person asked for most in the last year.
  const uses = {};
  const yearAgo = util.addMonths(today, -12);
  for (const r of reqs) if (r.start >= yearAgo && ['pending', 'approved', 'cancelling'].indexOf(r.status) >= 0) uses[r.type] = (uses[r.type] || 0) + 1;
  let usual = '';
  for (const c of Object.keys(uses)) if (usual === '' || uses[c] > uses[usual]) usual = c;
  for (const v of types) v.usual = v.code === usual;
  const upcoming = reqs.filter((r) => r.end >= today && ['pending', 'approved', 'cancelling'].indexOf(r.status) >= 0).sort((a, b) => (a.start < b.start ? -1 : 1));
  const history = reqs.filter((r) => upcoming.indexOf(r) < 0).slice(0, 60);
  const obligation = [];
  for (const t of lv().typesFor(S, emp.getString('entity'), false)) for (const o of obligationOf(S, emp, t, today)) obligation.push(Object.assign({ type: t.getString('code'), type_name: t.getString('name') }, o));
  const employments = auth.selfEmployee(ctx) !== '' ? util.rows(app, 'SELECT m.id AS id, m.number AS number, e.name AS ename FROM employments m JOIN entities e ON e.id = m.entity WHERE m.employee = {:x} ORDER BY m.start_day', { id: '', number: '', ename: '' }, { x: emp.getString('employee') }).map((r) => ({ id: r.id, number: r.number, entity_name: r.ename })) : [];
  return {
    employment: emp.id,
    person: person,
    entity: { id: ent.id, name: ent.getString('name'), country: ent.getString('country'), week_start: ent.getInt('week_start') },
    today: today,
    start_day: emp.getString('start_day'),
    end_day: emp.getString('end_day'),
    balances: balances,
    types: types,
    upcoming: upcoming,
    history: history,
    obligation: obligation,
    encash: rq().encashList(ctx, { employment: emp.id }).encashments.slice(0, 20),
    comp_offs: rq().compOffList(ctx, { employment: emp.id }).comp_offs.slice(0, 20),
    employments: employments,
    access: lv().access(ctx, emp),
  };
}

/* ------------------------------------------------------------ balances */

function balancesTable(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const auth = L('lib_auth');
  if (!ctx.isAgent && !auth.can(ctx, 'leave', 'view') && !ctx.teamScope) throw util.fail(403, 'Your role sees its own balances (leave.mine).', 'not_permitted');
  const entRef = util.str(p, 'entity', '');
  let entityId = entRef !== '' ? L('lib_org').entityRef(app, entRef).id : '';
  let day = util.day(p, 'day', entityId !== '' ? lv().todayOf(S, entityId) : util.today(app));
  const vis = visible(ctx, day, { entity: entityId, department: util.str(p, 'department', ''), from: day, to: day });
  lv().loadEmployments(S, vis.ids);
  if (entityId === '' && vis.ids.length > 0) {
    entityId = lv().employmentOf(S, vis.ids[0]).getString('entity');
    if (!util.has(p, 'day')) day = lv().todayOf(S, entityId);
  }
  const typeCode = util.str(p, 'type', '');
  const q = util.squash(util.str(p, 'q', '')).toLowerCase();
  const pg = util.page(p, 50, 500);
  let ids = vis.ids.filter((id) => entityId === '' || lv().employmentOf(S, id).getString('entity') === entityId);
  const ros = lv().roster(S, ids, day);
  const all = ids.filter((id) => ros[id] !== undefined).map((id) => ({ emp: lv().employmentOf(S, id), person: ros[id].person, department_name: ros[id].department_name }));
  const filtered = all.filter((x) => q === '' || x.person.name.toLowerCase().indexOf(q) >= 0 || x.person.number.toLowerCase().indexOf(q) >= 0).sort((a, b) => (a.person.name < b.person.name ? -1 : 1));
  const types = entityId !== '' ? lv().typesFor(S, entityId, false).filter((t) => typeCode === '' || t.getString('code') === typeCode) : [];
  const pageRows = filtered.slice(pg.offset, pg.offset + pg.limit);
  const pageIds = pageRows.map((x) => x.emp.id);
  // The sync's balance views of today (leave_balances), with the requests waiting added now; people
  // without one for the day (a day asked for, or before the daily run) are worked out here.
  const snap = {};
  for (let i = 0; i < pageIds.length; i += 500) {
    const bind = {};
    const keys = pageIds.slice(i, i + 500).map((id, j) => ((bind['e' + j] = id), '{:e' + j + '}')).join(',');
    for (const r of util.rows(app, 'SELECT employment, type, computed, balance, taken, booked, expiring FROM leave_balances WHERE employment IN (' + keys + ')', { employment: '', type: '', computed: '', balance: -0, taken: -0, booked: -0, expiring: '' }, bind)) {
      if (snap[r.employment] === undefined) snap[r.employment] = { computed: r.computed, types: {} };
      snap[r.employment].types[r.type] = r;
    }
  }
  const fresh = (x) => snap[x.emp.id] !== undefined && snap[x.emp.id].computed === day && day === lv().todayOf(S, x.emp.getString('entity'));
  lv().preload(S, pageRows.filter((x) => !fresh(x)).map((x) => x.emp.id));
  const waiting = lv().pendingTotals(S, pageRows.filter(fresh).map((x) => x.emp.id));
  const rows = pageRows.map((x) => {
    const out = { employment: x.emp.id, number: x.person.number, name: x.person.name, department_name: x.department_name, balances: {} };
    const sn = fresh(x) ? snap[x.emp.id] : null;
    for (const t of types) {
      const unit = t.getString('unit') || 'day';
      if (sn !== null) {
        const r = sn.types[t.id];
        if (r === undefined) continue;
        let exp = [];
        try {
          exp = JSON.parse(r.expiring || '[]') || [];
        } catch (e) {
          exp = [];
        }
        const pend = waiting[x.emp.id + ':' + t.id] || 0;
        out.balances[t.getString('code')] = { balance: r.balance, available: lv().r2(r.balance - r.booked - pend), taken: r.taken, pending: pend, booked: r.booked, expiring: exp[0] || null, unit: unit };
        continue;
      }
      const rule = lv().ruleFor(S, x.emp, t.getString('code'), day);
      if (!lv().tracked(rule)) continue;
      const b = lv().balanceInfo(S, x.emp, t, day, {});
      out.balances[t.getString('code')] = { balance: b.balance, available: b.available, taken: b.taken, pending: b.pending, booked: b.booked, expiring: b.expiring[0] || null, unit: b.unit };
    }
    return out;
  });
  const shown = types.filter((t) => rows.some((r) => r.balances[t.getString('code')] !== undefined)).map((t) => lv().typeView(t));
  return { entity: entityId, day: day, types: shown, type_count: types.length, rows: rows, total: filtered.length, mode: vis.mode };
}

function balanceDetail(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const emp = lv().employmentParam(ctx, p);
  lv().needSee(ctx, emp);
  const t = lv().typeRef(S, emp.getString('entity'), util.req(p, 'type', 'annual'));
  const today = lv().todayOf(S, emp.getString('entity'));
  const day = util.day(p, 'day', today);
  const proj = util.day(p, 'project_to', '');
  const b = lv().balanceInfo(S, emp, t, day, { explain: true, projectTo: proj });
  b.person = lv().personOf(app, emp);
  b.employment = emp.id;
  b.lots = lv()
    .simulate(S, emp, t, day, {})
    .lots.map((l) => Object.assign(l, { use_by: l.expires !== '' ? util.dayAdd(l.expires, -1) : '' }));
  const rule = lv().ruleFor(S, emp, t.getString('code'), day);
  b.rule = rule;
  const seg = lv().segmentOn(S, emp, day);
  b.policy = seg && seg.policy ? { id: seg.policy.id, name: seg.policy.name, from: seg.assigned_from } : null;
  return b;
}

function ledgerList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const emp = lv().employmentParam(ctx, p);
  lv().needSee(ctx, emp);
  const where = ['employment = {:e}'];
  const bind = { e: emp.id };
  const tref = util.str(p, 'type', '');
  if (tref !== '') {
    where.push('type = {:t}');
    bind.t = lv().typeRef(S, emp.getString('entity'), tref).id;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('day >= {:f}');
    bind.f = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('day <= {:to}');
    bind.to = to;
  }
  const pg = util.page(p, 200, 2000);
  const rows = util.findMany(app, 'leave_ledger', where.join(' && '), '-day,-created', pg.limit, bind);
  return {
    rows: rows.map((r) => {
      const t = lv().typeById(S, r.getString('type'));
      return { id: r.id, day: r.getString('day'), type: t ? t.getString('code') : '', type_name: t ? t.getString('name') : '', amount: r.getFloat('amount'), kind: r.getString('kind'), key: r.getString('key'), expires: r.getString('expires'), ref: r.getString('ref'), note: r.getString('note'), actor: r.getString('actor'), created: r.getString('created') };
    }),
  };
}

/* ------------------------------------------------------------ calendar */

function calendar(ctx, p) {
  const util = u();
  const app = ctx.app;
  const cal = L('lib_calendar');
  const today = util.today(app);
  const from = util.day(p, 'from', today.slice(0, 8) + '01');
  const to = util.day(p, 'to', util.monthEnd(from));
  if (to < from || util.daysBetween(from, to) > 62) throw util.fail(400, 'Show at most two months at a time (from <= to).', 'invalid_param');
  const vis = visible(ctx, today, { entity: util.str(p, 'entity', ''), department: util.str(p, 'department', ''), from: from, to: to });
  const q = util.squash(util.str(p, 'q', '')).toLowerCase();
  const S = lv().session(app);
  const rows = [];
  const cals = {};
  const ros = lv().roster(S, vis.ids, from);
  const selfEmp = L('lib_auth').selfEmployee(ctx);
  for (const id of vis.ids) {
    const o = ros[id];
    if (!o) continue;
    const person = o.person;
    if (q !== '' && person.name.toLowerCase().indexOf(q) < 0 && person.number.toLowerCase().indexOf(q) < 0) continue;
    const job = o.job;
    const c = o.calendar || '';
    if (c !== '' && cals[c] === undefined) cals[c] = cal.holidaysBetween(app, c, from, to).filter((h) => h.kind !== 'optional').map((h) => ({ day: h.day, name: h.name, half: h.half, kind: h.kind }));
    rows.push({
      employment: id,
      employee: person.id,
      number: person.number,
      name: person.name,
      title: job ? job.title : '',
      department: job ? job.department : '',
      department_name: o.department_name,
      entity: o.entity,
      calendar: c,
      week_off: o.week_off,
      start_day: o.start_day,
      end_day: o.end_day,
      self: (vis.own || []).indexOf(id) >= 0 || selfEmp === person.id,
    });
  }
  rows.sort((a, b) => (a.self !== b.self ? (a.self ? -1 : 1) : a.department_name !== b.department_name ? (a.department_name < b.department_name ? -1 : 1) : a.name < b.name ? -1 : 1));
  const shownIds = rows.map((r) => r.employment);
  const bars = leaveBetween(ctx, Object.assign({}, vis, { ids: shownIds }), from, to, ['approved', 'cancelling', 'pending'], S);
  const blocks = L('lib_leave_admin').blocksList(ctx, { from: from, to: to }).blocks;
  const legend = {};
  for (const b of bars) if (b.type !== '') legend[b.type] = { code: b.type, name: b.type_name, color: b.color, icon: b.icon };
  return { from: from, to: to, today: today, mode: vis.mode, rows: rows, bars: bars, holidays: cals, blocks: blocks, legend: Object.keys(legend).map((k) => legend[k]) };
}

/** Who is out on a day or between two days. */
function out(ctx, p) {
  const util = u();
  const app = ctx.app;
  const from = util.day(p, 'from', util.today(app));
  const to = util.day(p, 'to', from);
  if (to < from || util.daysBetween(from, to) > 62) throw util.fail(400, 'Ask for at most two months (from <= to).', 'invalid_param');
  const vis = visible(ctx, from, { entity: util.str(p, 'entity', ''), department: util.str(p, 'department', ''), from: from, to: to });
  const bars = leaveBetween(ctx, vis, from, to, util.bool(p, 'include_pending', false) ? ['approved', 'cancelling', 'pending'] : ['approved', 'cancelling']);
  const byDay = {};
  for (let d = from; d <= to; d = util.dayAdd(d, 1)) byDay[d] = 0;
  for (const b of bars) for (const d of b.day_list || []) if (byDay[d.day] !== undefined) byDay[d.day] += 1;
  for (const b of bars) if (!b.day_list) for (let d = b.start > from ? b.start : from; d <= (b.end < to ? b.end : to); d = util.dayAdd(d, 1)) byDay[d] += 1;
  return { from: from, to: to, mode: vis.mode, people: bars, per_day: Object.keys(byDay).map((d) => ({ day: d, out: byDay[d] })) };
}

/* ------------------------------------------------- Japan: 5 days, register */

function jpEmployments(ctx, p, day) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const vis = visible(ctx, day, { entity: util.str(p, 'entity', ''), department: util.str(p, 'department', ''), from: util.dayAdd(day, -800), to: day });
  if (vis.mode === 'peers') throw util.fail(403, 'Your role sees its own leave (leave.mine).', 'not_permitted');
  const empRef = util.str(p, 'employment', '');
  let ids = vis.ids;
  if (empRef !== '') {
    const emp = L('lib_people').employmentRef(app, empRef);
    lv().needSee(ctx, emp);
    ids = [emp.id];
  }
  const out = [];
  for (const id of ids) {
    const emp = lv().employmentOf(S, id);
    for (const t of lv().typesFor(S, emp.getString('entity'), true)) {
      let jp = false;
      for (const s of lv().segments(S, emp)) for (const h of s.policy ? s.policy.history : []) for (const r of h.rules || []) if (r && r.type === t.getString('code') && r.method === 'statutory_jp') jp = true;
      if (jp) out.push({ emp: emp, type: t });
    }
  }
  return { S: S, list: out };
}

function obligation(ctx, p) {
  const util = u();
  const app = ctx.app;
  const day = util.day(p, 'day', util.today(app));
  const j = jpEmployments(ctx, p, day);
  const rows = [];
  for (const x of j.list) {
    const person = lv().personOf(app, x.emp);
    for (const o of obligationOf(j.S, x.emp, x.type, lv().todayOf(j.S, x.emp.getString('entity')) > day ? day : lv().todayOf(j.S, x.emp.getString('entity')))) rows.push(Object.assign({ employment: x.emp.id, number: person.number, name: person.name, type: x.type.getString('code'), type_name: x.type.getString('name') }, o));
  }
  const order = { missed: 0, at_risk: 1, on_track: 2, done: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.deadline < b.deadline ? -1 : 1));
  const counts = { done: 0, on_track: 0, at_risk: 0, missed: 0 };
  for (const r of rows) counts[r.status]++;
  return { day: day, rows: rows, counts: counts, rule: 'Everyone granted 10 or more days of 年次有給休暇 must take at least 5 of them within a year of the grant date (労働基準法39条7項). Full and half days count, hours do not; leave planned and approved counts.' };
}

/** 年次有給休暇管理簿: per person and grant year, the base date, days carried and granted, every day taken, what remains. */
function registerRows(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const from = util.day(p, 'from', util.addMonths(today, -12));
  const to = util.day(p, 'to', today);
  const j = jpEmployments(ctx, p, to);
  const rows = [];
  for (const x of j.list) {
    const S = j.S;
    const emp = x.emp;
    const t = x.type;
    const person = lv().personOf(app, emp);
    const d = lv().todayOf(S, emp.getString('entity'));
    const sim = lv().simulate(S, emp, t, d > to ? d : to, {});
    const job = L('lib_people').rowOn(app, 'job_records', emp.id, to);
    const dep = job !== null ? util.byId(app, 'departments', job.getString('department')) : null;
    for (let i = 0; i < sim.timeline.length; i++) {
      const e = sim.timeline[i];
      if (!e.meta || !e.meta.jp) continue;
      const base = e.meta.base;
      const deadline = e.meta.deadline;
      if (deadline < from || base > to) continue;
      let carried = 0;
      for (let k = i - 1; k >= 0; k--) {
        if (sim.timeline[k].day <= base) {
          carried = sim.timeline[k].balance;
          break;
        }
      }
      const taken = [];
      let takenDays = 0;
      let takenHours = 0;
      for (const r of util.findMany(app, 'leave_requests', "employment = {:e} && type = {:t} && start <= {:to} && end >= {:f} && (status = 'approved' || status = 'cancelling')", 'start', 0, { e: emp.id, t: t.id, f: base, to: deadline })) {
        const days = (util.jsonOf(r, 'day_list', []) || []).filter((z) => z.day >= base && z.day <= deadline);
        if (days.length === 0) continue;
        let dd = 0;
        let hh = 0;
        for (const z of days) {
          if (Number(z.hours) > 0) hh += Number(z.hours);
          else dd += Number(z.days) || 0;
        }
        takenDays += dd;
        takenHours += hh;
        taken.push({ request: r.id, start: days[0].day, end: days[days.length - 1].day, days: lv().r2(dd), hours: lv().r2(hh), applied: r.getString('created').slice(0, 10), approved: r.getString('decided_at').slice(0, 10) });
      }
      let remaining = 0;
      const until = deadline < d ? deadline : d;
      for (const z of sim.timeline) if (z.day <= until) remaining = z.balance;
      const ob = e.meta.obligation ? obligationOf(S, emp, t, deadline < d ? deadline : d).filter((o) => o.base === base)[0] || null : null;
      rows.push({
        employment: emp.id,
        number: person.number,
        name: person.name,
        department_name: dep ? dep.getString('name') : '',
        hire_day: emp.getString('start_day'),
        base: base,
        deadline: deadline,
        carried: lv().r2(carried),
        granted: e.meta.granted,
        basis: e.meta.basis,
        taken: taken,
        taken_days: lv().r2(takenDays),
        taken_hours: lv().r2(takenHours),
        remaining: lv().r2(remaining),
        obligation: ob ? ob.status : 'not_applicable',
        keep_until: util.dayAdd(util.addMonths(util.dayAdd(deadline, 1), 36), -1),
      });
    }
  }
  rows.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : a.base < b.base ? -1 : 1));
  return { from: from, to: to, rows: rows };
}

function register(ctx, p) {
  const r = registerRows(ctx, p);
  r.note = '年次有給休暇管理簿 (労働基準法施行規則24条の7): kept for each grant period and three years after it. HR OS never deletes ledger rows or decided requests, so the register can be produced again for any period.';
  return r;
}

function registerExport(ctx, p) {
  const util = u();
  const r = registerRows(ctx, p);
  const STATUS = { done: '達成 (done)', on_track: '未達 (on track)', at_risk: '未達 (at risk)', missed: '未達 (missed)', not_applicable: '対象外 (not applicable)' };
  const head = ['社員番号 Number', '氏名 Name', '部署 Department', '入社日 Hire date', '基準日 Base date', '期限 Use by', '前年度繰越日数 Carried over', '付与日数 Granted', '取得日数 Days taken', '取得時間 Hours taken', '取得時季 Dates taken', '残日数 Remaining', '年5日 5-day rule', '保存期限 Keep until'];
  const lines = [head];
  for (const x of r.rows) lines.push([x.number, x.name, x.department_name, x.hire_day, x.base, x.deadline, x.carried, x.granted, x.taken_days, x.taken_hours, x.taken.map((t) => (t.start === t.end ? t.start : t.start + '~' + t.end) + ' (' + (t.hours > 0 ? t.hours + 'h' : t.days + 'd') + ')').join('; '), x.remaining, STATUS[x.obligation] || x.obligation, x.keep_until]);
  L('lib_audit').note(ctx, { collection: 'leave_requests', record: '', summary: 'Exported the annual paid leave register (' + r.rows.length + ' rows, ' + r.from + ' to ' + r.to + ')' });
  return { filename: 'nenkyu_kanribo_' + r.from + '_' + r.to + '.csv', csv: util.csvText(lines), rows: r.rows.length };
}

/* ------------------------------------------------------------- notices */

function noticeOnce(app, memberId, kind, title, link, facts) {
  const util = u();
  if (!memberId) return false;
  if (util.count(app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m} AND kind = {:k} AND title = {:t}', { m: memberId, k: kind, t: title }) > 0) return false;
  L('lib_notify').notify(app, [memberId], { kind: kind, title: title, body: '', link: link, facts: facts || [] });
  return true;
}

/** Run by the daily run: leave about to expire (30 days), and on Mondays the five-day rule (Japan). */
function dailyNotices(app, entityId, today) {
  const util = u();
  const S = lv().session(app);
  const monday = util.weekday(today) === 1;
  const short = [];
  // The run has just renewed every employment's leave_attention rows.
  const ids = util.rows(app, "SELECT id FROM employments WHERE entity = {:e} AND start_day <= {:d} AND (end_day = '' OR end_day >= {:d}) ORDER BY number", { id: '' }, { e: entityId, d: today }).map((m) => m.id);
  const rows = attentionRows(app, ids, "a.kind IN ('expiring', 'obligation')", {});
  const ros = lv().roster(S, Object.keys(rows.reduce((a, r) => ((a[r.employment] = true), a), {})), today);
  for (const r of rows) {
    const person = ros[r.employment] ? ros[r.employment].person : { member: '', name: '' };
    if (r.kind === 'expiring' && r.day >= today && r.day <= util.dayAdd(today, 30)) noticeOnce(app, person.member, 'leave_expiry', r.amount + ' ' + (r.unit === 'hour' ? 'hours' : 'days') + ' of ' + r.tname + ' expire after ' + r.day + ' unless taken', '#/leave', [{ type: 'number', key: 'amount', label: 'Expiring', value: r.amount, unit: r.unit === 'hour' ? 'hours' : 'days' }, { type: 'day', key: 'last_day', label: 'Use by', value: r.day }, { type: 'text', key: 'type', label: 'Type', value: r.tname }]);
    if (monday && r.kind === 'obligation' && r.detail.status === 'at_risk') {
      short.push({ name: person.name, short: r.detail.short, deadline: r.detail.deadline });
      noticeOnce(app, person.member, 'leave_obligation', 'Take ' + r.detail.short + ' more ' + (r.detail.short === 1 ? 'day' : 'days') + ' of annual paid leave by ' + r.detail.deadline + ' (' + today + ')', '#/leave', [{ type: 'number', key: 'short', label: 'Days still to take', value: r.detail.short, unit: r.detail.short === 1 ? 'day' : 'days' }].concat(util.isDay(String(r.detail.deadline || '')) ? [{ type: 'day', key: 'deadline', label: 'Deadline', value: r.detail.deadline }] : []));
    }
  }
  if (short.length > 0) {
    const ent = app.findRecordById('entities', entityId);
    for (const m of leaveAdmins(app, entityId)) noticeOnce(app, m, 'leave_obligation', short.length + (short.length === 1 ? ' person' : ' people') + ' in ' + ent.getString('name') + ' still need to take annual paid leave under the five-day rule (' + today + ')', '#/leave/register', [{ type: 'number', key: 'people', label: 'People short', value: short.length, unit: short.length === 1 ? 'person' : 'people' }, { type: 'day', key: 'day', label: 'As of', value: today }]);
  }
  return short.length;
}

module.exports = {
  visible: visible,
  leaveBetween: leaveBetween,
  leaveAdmins: leaveAdmins,
  obligationOf: obligationOf,
  overview: overview,
  attentionOp: attentionOp,
  mine: mine,
  balancesTable: balancesTable,
  balanceDetail: balanceDetail,
  ledgerList: ledgerList,
  calendar: calendar,
  out: out,
  obligation: obligation,
  registerRows: registerRows,
  register: register,
  registerExport: registerExport,
  dailyNotices: dailyNotices,
};
