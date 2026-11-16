/// <reference path="../pb_data/types.d.ts" />
/**
 * Expenses home for HR, finance and managers (what waits, what is flagged,
 * what is approved and not paid, spend by category and department), the
 * employee's own view, spend reports, and the settings: categories and the
 * policy of each legal entity (operations expenses.* and
 * expense-categories.*).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function X() {
  return L('lib_expenses');
}

/* ---------------------------------------------------------------- scope */

/** Who the caller sees on Home and reports: { kind: 'admin'|'team', where (alias c), bind }. */
function viewerScope(ctx, p, alias) {
  const util = u();
  const auth = L('lib_auth');
  const E = X();
  const a = alias || 'c';
  const bind = {};
  const where = [];
  const keys = (ids, prefix) => ids.map((x, i) => ((bind[prefix + i] = x), '{:' + prefix + i + '}')).join(',');
  let kind = '';
  if (ctx.isAgent || auth.can(ctx, 'expenses', 'view')) {
    kind = 'admin';
    const sc = auth.scope(ctx);
    if (sc.length > 0) where.push(a + '.entity IN (' + keys(sc, 's') + ')');
  } else if (ctx.teamScope) {
    kind = 'team';
    const ids = E.teamEmployments(ctx);
    where.push(ids.length === 0 ? '1 = 0' : a + '.employment IN (' + keys(ids, 'r') + ')');
  } else throw util.fail(403, 'Your role sees only your own expenses: open them with expenses.me.', 'not_permitted');
  let entity = '';
  if (util.str(p, 'entity', '') !== '') {
    entity = L('lib_org').entityRef(ctx.app, util.str(p, 'entity', '')).id;
    if (!auth.inScope(ctx, entity)) throw util.fail(403, 'You cannot see this entity.', 'not_permitted');
    where.push(a + '.entity = {:ent}');
    bind.ent = entity;
  }
  return { kind: kind, where: where.length > 0 ? where.join(' AND ') : '1 = 1', bind: bind, entity: entity };
}

/** The currency a set is shown in: the one entity's, the only currency spent, else the reporting currency. */
function shownCurrency(app, entityId, spent) {
  if (entityId) return X().entityInfo(app, entityId).currency;
  if (spent && spent.length === 1) return spent[0];
  const rep = L('lib_settings').row(app).getString('reporting_currency');
  if (rep !== '') return rep;
  const r = u().one(app, "SELECT currency FROM entities WHERE currency != '' ORDER BY created LIMIT 1", { currency: '' });
  return r !== null ? r.currency : 'USD';
}

function converter(app, to, day) {
  const cache = {};
  return (minor, from) => {
    if (from === to || minor === 0) return minor;
    if (cache[from] === undefined) {
      const got = L('lib_expenses_fx').rateOf(app, from, to, day);
      cache[from] = got !== null ? got.rate : null;
    }
    const r = cache[from];
    if (r === null) return null;
    const money = L('lib_money');
    return money.majorToMinor(money.toMajor(minor, from) * r, to);
  };
}

/* ----------------------------------------------------------------- spend */

/**
 * Spend from claim lines by day of spending: approved and paid (approved_minor)
 * and still waiting (waiting_minor), grouped, in one currency.
 */
function spendData(ctx, p, sc) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const today = util.today(app, sc.entity || undefined);
  let from = util.day(p, 'from', '');
  let to = util.day(p, 'to', '');
  const month = util.str(p, 'month', '');
  if (month !== '') {
    if (!/^\d{4}-\d{2}$/.test(month)) throw util.fail(400, 'month is YYYY-MM, e.g. 2026-11', 'invalid_param', { param: 'month' });
    from = month + '-01';
    to = util.monthEnd(from);
  }
  if (from === '') from = today.slice(0, 7) + '-01';
  if (to === '') to = util.monthEnd(from);
  const groupBy = util.oneOf(p, 'group_by', ['category', 'department', 'entity', 'employee', 'day'], 'category');
  const bind = Object.assign({ from: from, to: to }, sc.bind);
  const rows = util.rows(
    app,
    "SELECT c.employment AS employment, c.employee AS employee, c.entity AS entity, c.currency AS currency, c.status AS status, COALESCE(k.code, '') AS code, COALESCE(k.name, '') AS cname, COALESCE(k.icon, '') AS icon, " +
      (groupBy === 'day' ? 'l.day' : "''") +
      " AS day, CAST(COALESCE(SUM(l.base_minor), 0) AS INTEGER) AS n FROM claim_lines l JOIN claims c ON c.id = l.claim LEFT JOIN expense_categories k ON k.id = l.category WHERE l.status = 'included' AND c.status IN ('submitted', 'approved', 'paid') AND l.day >= {:from} AND l.day <= {:to} AND " +
      sc.where +
      ' GROUP BY c.employment, c.employee, c.entity, c.currency, c.status, k.code, k.name, k.icon' +
      (groupBy === 'day' ? ', l.day' : ''),
    { employment: '', employee: '', entity: '', currency: '', status: '', code: '', cname: '', icon: '', day: '', n: 0 },
    bind,
  );
  const spent = {};
  for (const r of rows) spent[r.currency] = true;
  const currency = shownCurrency(app, sc.entity, Object.keys(spent));
  const conv = converter(app, currency, to > today ? today : to);
  const nm = X().names(app);
  const deps = {};
  const depOf = (employment) => {
    if (deps[employment] === undefined) {
      const job = people.rowOn(app, 'job_records', employment, to);
      const d = job !== null && job.getString('department') !== '' ? util.byId(app, 'departments', job.getString('department')) : null;
      deps[employment] = d ? { key: d.id, label: d.getString('name') } : { key: '', label: 'No department' };
    }
    return deps[employment];
  };
  const groups = {};
  const unconverted = {};
  for (const r of rows) {
    const v = conv(r.n, r.currency);
    if (v === null) {
      unconverted[r.currency] = (unconverted[r.currency] || 0) + r.n;
      continue;
    }
    let key;
    let label;
    let icon = '';
    if (groupBy === 'category') {
      key = r.code || 'none';
      label = r.cname || 'No category';
      icon = r.icon;
    } else if (groupBy === 'department') {
      const d = depOf(r.employment);
      key = d.key || 'none';
      label = d.label;
    } else if (groupBy === 'entity') {
      key = r.entity;
      label = nm.entity(r.entity);
    } else if (groupBy === 'employee') {
      key = r.employee;
      label = nm.employee(r.employee);
    } else {
      key = r.day;
      label = r.day;
    }
    if (groups[key] === undefined) groups[key] = { key: key, label: label, icon: icon, approved_minor: 0, waiting_minor: 0, total_minor: 0 };
    if (r.status === 'submitted') groups[key].waiting_minor += v;
    else groups[key].approved_minor += v;
    groups[key].total_minor += v;
  }
  const list = Object.keys(groups).map((k) => groups[k]);
  if (groupBy === 'day') list.sort((a, b) => (a.key < b.key ? -1 : 1));
  else list.sort((a, b) => b.total_minor - a.total_minor || (a.label < b.label ? -1 : 1));
  return {
    from: from,
    to: to,
    currency: currency,
    group_by: groupBy,
    groups: list,
    total_minor: list.reduce((s, g) => s + g.total_minor, 0),
    approved_minor: list.reduce((s, g) => s + g.approved_minor, 0),
    waiting_minor: list.reduce((s, g) => s + g.waiting_minor, 0),
    unconverted: Object.keys(unconverted).map((c) => ({ currency: c, amount_minor: unconverted[c] })),
  };
}

function spend(ctx, p) {
  return spendData(ctx, p, viewerScope(ctx, p, 'c'));
}

/* ------------------------------------------------------------------ home */

function home(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const sc = viewerScope(ctx, p, 'c');
  const nm = E.names(app);
  const listOf = (extra, order, limit) => util.rows(app, 'SELECT c.id AS id FROM claims c WHERE ' + sc.where + ' AND ' + extra + ' ORDER BY ' + order + ' LIMIT ' + limit, { id: '' }, sc.bind).map((r) => E.claimView(app, app.findRecordById('claims', r.id), nm));
  const countOf = (extra) => util.count(app, 'SELECT COUNT(*) AS n FROM claims c WHERE ' + sc.where + ' AND ' + extra, sc.bind);
  const totalsOf = (extra, field) =>
    util.rows(app, 'SELECT c.currency AS currency, COUNT(*) AS n, CAST(COALESCE(SUM(' + field + '), 0) AS INTEGER) AS amount_minor FROM claims c WHERE ' + sc.where + ' AND ' + extra + ' GROUP BY c.currency ORDER BY c.currency', { currency: '', n: 0, amount_minor: 0 }, sc.bind).map((r) => ({ currency: r.currency, claims: r.n, amount_minor: r.amount_minor }));
  const mine = ctx.member !== null ? L('lib_approvals').pendingFor(ctx).filter((a) => a.kind === 'claim' || a.kind === 'advance' || a.kind === 'travel') : [];
  const sa = viewerScope(ctx, p, 'a');
  const adv = (extra) => util.count(app, 'SELECT COUNT(*) AS n FROM advances a WHERE ' + sa.where + ' AND ' + extra, sa.bind);
  const out = {
    scope: sc.kind,
    entity: sc.entity,
    today: util.today(app, sc.entity || undefined),
    for_you: { total: mine.length, claims: mine.filter((a) => a.kind === 'claim').length, advances: mine.filter((a) => a.kind === 'advance').length, trips: mine.filter((a) => a.kind === 'travel').length, approvals: mine.slice(0, 8) },
    waiting: { total: countOf("c.status = 'submitted'"), totals: totalsOf("c.status = 'submitted'", 'c.total_minor'), claims: listOf("c.status = 'submitted'", 'c.submitted_at ASC', 8) },
    flagged: { total: countOf("c.status = 'submitted' AND c.flag_count > 0"), claims: listOf("c.status = 'submitted' AND c.flag_count > 0", 'c.flag_count DESC, c.submitted_at ASC', 8) },
    approved_unpaid: {
      total: countOf("c.status = 'approved'"),
      payroll: totalsOf("c.status = 'approved' AND c.pay_via = 'payroll'", 'c.approved_minor - c.advance_applied_minor'),
      bank: totalsOf("c.status = 'approved' AND c.pay_via = 'bank'", 'c.approved_minor - c.advance_applied_minor'),
      claims: listOf("c.status = 'approved'", 'c.approved_day ASC, c.created ASC', 8),
    },
    advances: {
      requested: adv("a.status = 'requested'"),
      to_pay: adv("a.status = 'approved' AND a.pay_via = 'bank'"),
      outstanding: util.rows(app, "SELECT a.currency AS currency, COUNT(*) AS n, CAST(COALESCE(SUM(a.balance_minor), 0) AS INTEGER) AS amount_minor FROM advances a WHERE " + sa.where + " AND a.status = 'paid' GROUP BY a.currency ORDER BY a.currency", { currency: '', n: 0, amount_minor: 0 }, sa.bind).map((r) => ({ currency: r.currency, advances: r.n, amount_minor: r.amount_minor })),
    },
    receipts_waiting: sc.kind === 'admin' ? util.count(app, "SELECT COUNT(*) AS n FROM claim_lines l JOIN claims c ON c.id = l.claim WHERE l.receipt_status IN ('waiting', 'reading') AND c.status = 'draft' AND " + sc.where, sc.bind) : 0,
    spend_by_category: spendData(ctx, Object.assign({}, p, { group_by: 'category' }), sc),
    spend_by_department: spendData(ctx, Object.assign({}, p, { group_by: 'department' }), sc),
    entities: sc.kind === 'admin' ? util.findMany(app, 'entities', 'active = true', 'created').filter((e) => L('lib_auth').inScope(ctx, e.id)).map((e) => ({ id: e.id, name: e.getString('name'), currency: e.getString('currency'), country: e.getString('country') })) : [],
    can: { pay: !ctx.isAgent && L('lib_auth').can(ctx, 'expenses', 'full'), settings: !ctx.isAgent && L('lib_auth').can(ctx, 'expenses', 'full'), export: !ctx.isAgent && L('lib_auth').can(ctx, 'expenses', 'view') },
  };
  return out;
}

/* -------------------------------------------------------------------- me */

function me(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(400, 'expenses.me is the view of a signed-in person; use claims.list --employee for someone.', 'not_permitted');
  if (ctx.employeeId === '') return { employee: null, employments: [], drafts: [], recent: [], advances: [], trips: [], awaiting: [], waiting_approval: 0 };
  const nm = E.names(app);
  const today = util.today(app);
  const emps = util.findMany(app, 'employments', "employee = {:e} && (end_day = '' || end_day >= {:d})", 'start_day', 0, { e: ctx.employeeId, d: util.dayAdd(today, -120) });
  const primary = L('lib_people').primaryEmployment(app, ctx.employeeId, today);
  const employments = emps.map((m) => {
    const ent = E.entityInfo(app, m.getString('entity'));
    const pol = E.policyOf(app, ent.id);
    return {
      id: m.id,
      number: m.getString('number'),
      entity: ent.id,
      entity_name: ent.name,
      currency: ent.currency,
      primary: m.id === primary,
      status: m.getString('status'),
      categories: util.findMany(app, 'expense_categories', 'entity = {:e} && archived = false', 'sort,name', 0, { e: ent.id }).map(E.categoryView),
      policy: { pay_via: pol.pay_via, max_age_days: pol.max_age_days, flag_weekends: pol.flag_weekends },
      draft: (() => {
        const d = L('lib_expenses_claims').openDraft(app, m.id);
        return d !== null ? d.id : '';
      })(),
    };
  });
  const claims = (filter, sort, limit) => util.findMany(app, 'claims', 'employee = {:e} && ' + filter, sort, limit, { e: ctx.employeeId }).map((c) => E.claimView(app, c, nm));
  const drafts = claims("status = 'draft'", '-updated', 20).map((c) => {
    c.lines = util.findMany(app, 'claim_lines', 'claim = {:c}', 'sort,created', 0, { c: c.id }).map((l) => E.lineView(app, l, nm));
    return c;
  });
  return {
    employee: { id: ctx.employeeId, name: nm.employee(ctx.employeeId), number: nm.employeeNumber(ctx.employeeId) },
    employments: employments,
    drafts: drafts,
    recent: claims("status != 'draft' && status != 'cancelled'", '-updated', 30),
    awaiting: util.rows(app, "SELECT currency, CAST(COALESCE(SUM(approved_minor - advance_applied_minor), 0) AS INTEGER) AS amount_minor, COUNT(*) AS n FROM claims WHERE employee = {:e} AND status = 'approved' GROUP BY currency", { currency: '', amount_minor: 0, n: 0 }, { e: ctx.employeeId }).map((r) => ({ currency: r.currency, amount_minor: r.amount_minor, claims: r.n })),
    waiting_approval: util.count(app, "SELECT COUNT(*) AS n FROM claims WHERE employee = {:e} AND status = 'submitted'", { e: ctx.employeeId }),
    advances: util.findMany(app, 'advances', "employee = {:e} && (status = 'requested' || status = 'approved' || status = 'paid' || updated >= {:t})", '-updated', 20, { e: ctx.employeeId, t: util.dayAdd(today, -90) + ' 00:00:00.000Z' }).map((a) => E.advanceView(app, a, nm)),
    trips: util.findMany(app, 'travel_requests', "employee = {:e} && status != 'cancelled' && to_day >= {:d}", 'from_day', 20, { e: ctx.employeeId, d: util.dayAdd(today, -60) }).map((t) => E.travelView(app, t, nm)),
  };
}

/* ---------------------------------------------------------------- policy */

function entityParam(ctx, p) {
  const util = u();
  const auth = L('lib_auth');
  const app = ctx.app;
  let id = '';
  if (util.str(p, 'entity', '') !== '') id = L('lib_org').entityRef(app, util.str(p, 'entity', '')).id;
  else if (ctx.employeeId !== '') {
    const m = L('lib_people').primaryEmployment(app, ctx.employeeId, util.today(app));
    if (m !== '') id = app.findRecordById('employments', m).getString('entity');
  }
  if (id === '') {
    const first = util.findMany(app, 'entities', 'active = true', 'created').filter((e) => auth.inScope(ctx, e.id))[0];
    if (first === undefined) throw util.fail(404, 'Add a legal entity first.', 'no_entity');
    id = first.id;
  }
  const own = ctx.employeeId !== '' && util.count(app, 'SELECT COUNT(*) AS n FROM employments WHERE employee = {:e} AND entity = {:n}', { e: ctx.employeeId, n: id }) > 0;
  if (!auth.inScope(ctx, id) && !own) throw util.fail(403, 'You cannot see this entity.', 'not_permitted');
  return id;
}

function policyGet(ctx, p) {
  return { policy: X().policyOf(ctx.app, entityParam(ctx, p)) };
}

const POLICY_KEYS = ['finance_over', 'max_age_days', 'flag_weekends', 'pay_via', 'advance_pay_via', 'advance_recover_via', 'recover_after_days', 'note'];

function policyValues(ctx, p, cur) {
  const util = u();
  const out = {};
  if (util.has(p, 'finance_over')) {
    const v = util.money(p, 'finance_over', cur.currency, {});
    out.finance_over_minor = v === null ? 0 : Math.max(0, v);
  }
  if (util.has(p, 'max_age_days')) out.max_age_days = util.int(p, 'max_age_days', cur.max_age_days, 0, 3650);
  if (util.has(p, 'flag_weekends')) out.flag_weekends = util.bool(p, 'flag_weekends', cur.flag_weekends);
  if (util.has(p, 'pay_via')) out.pay_via = util.oneOf(p, 'pay_via', ['payroll', 'bank'], cur.pay_via);
  if (util.has(p, 'advance_pay_via')) out.advance_pay_via = util.oneOf(p, 'advance_pay_via', ['payroll', 'bank'], cur.advance_pay_via);
  if (util.has(p, 'advance_recover_via')) out.advance_recover_via = util.oneOf(p, 'advance_recover_via', ['payroll', 'claim'], cur.advance_recover_via);
  if (util.has(p, 'recover_after_days')) out.recover_after_days = util.int(p, 'recover_after_days', cur.recover_after_days, 0, 730);
  if (util.has(p, 'note')) out.note = util.text(p, 'note', 2000, '');
  return out;
}

function shownPolicyValue(k, v, currency) {
  if (k === 'finance_over_minor') return v > 0 ? X().fmt(v, currency) : 'never';
  return v;
}

function previewPolicy(ctx, p) {
  const util = u();
  const E = X();
  const ent = L('lib_org').entityRef(ctx.app, util.req(p, 'entity'));
  const cur = E.policyOf(ctx.app, ent.id);
  const next = policyValues(ctx, p, cur);
  const fields = Object.keys(next)
    .filter((k) => String(next[k]) !== String(cur[k]))
    .map((k) => ({ name: k, before: shownPolicyValue(k, cur[k], cur.currency), after: shownPolicyValue(k, next[k], cur.currency) }));
  return { label: 'Change the expenses policy of ' + ent.getString('name'), target: 'expense_policies:' + ent.id, fields: fields, notes: [], risk: 'medium' };
}

function policySave(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const ent = L('lib_org').entityRef(app, util.req(p, 'entity'));
  if (!E.isAdminFor(ctx, ent.id, 'full')) throw util.fail(403, 'You cannot change the expenses policy of this entity.', 'not_permitted');
  const cur = E.policyOf(app, ent.id);
  const next = policyValues(ctx, p, cur);
  let rec = E.policyRow(app, ent.id);
  if (rec === null) {
    rec = util.newRecord(app, 'expense_policies');
    rec.set('entity', ent.id);
    for (const k of ['finance_over_minor', 'max_age_days', 'flag_weekends', 'pay_via', 'advance_pay_via', 'advance_recover_via', 'recover_after_days', 'note']) rec.set(k, cur[k]);
  }
  for (const k of Object.keys(next)) rec.set(k, next[k]);
  app.save(rec);
  const after = E.policyOf(app, ent.id);
  L('lib_audit').note(ctx, { collection: 'expense_policies', record: rec.id, summary: 'Changed the expenses policy of ' + ent.getString('name'), before: cur, after: after });
  return { policy: after };
}

/* ------------------------------------------------------------ categories */

function categoriesList(ctx, p) {
  const util = u();
  const E = X();
  const auth = L('lib_auth');
  const app = ctx.app;
  const entity = entityParam(ctx, p);
  const all = util.bool(p, 'archived', false);
  const rows = util.findMany(app, 'expense_categories', 'entity = {:e}' + (all ? '' : ' && archived = false'), 'sort,name', 0, { e: entity });
  const used = {};
  const admin = ctx.isAgent || auth.can(ctx, 'expenses', 'view');
  if (admin) for (const r of util.rows(app, "SELECT category, COUNT(*) AS n FROM claim_lines WHERE entity = {:e} AND category != '' GROUP BY category", { category: '', n: 0 }, { e: entity })) used[r.category] = r.n;
  const ent = E.entityInfo(app, entity);
  return {
    entity: entity,
    entity_name: ent.name,
    currency: ent.currency,
    country: ent.country,
    categories: rows.map((r) => Object.assign(E.categoryView(r), admin ? { used: used[r.id] || 0 } : {})),
    policy: E.policyOf(app, entity),
    can_edit: !ctx.isAgent && E.isAdminFor(ctx, entity, 'full'),
  };
}

/** A per-unit rate in major units ("0.725") -> minor units with up to four decimals (72.5). */
function rateParam(p, name, currency) {
  const util = u();
  const raw = String(util.str(p, name, '')).trim();
  if (raw === '') return 0;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw util.fail(400, name + ' is the amount per km or mile in ' + currency + ', e.g. 0.725', 'invalid_param', { param: name });
  const v = Number(raw) * Math.pow(10, L('lib_money').exponent(currency));
  return Math.round(v * 10000) / 10000;
}

function categoryValues(ctx, p, entityId, currency, creating) {
  const util = u();
  const out = {};
  if (util.has(p, 'name') || creating) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'Give the category a name.', 'missing_param', { param: 'name' });
    out.name = n;
  }
  if (util.has(p, 'code') || creating) {
    const c = (util.str(p, 'code', '') || util.slug(out.name || '').replace(/-/g, '_')).toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(c)) throw util.fail(400, 'code is lower case letters, digits and _, e.g. client_meals', 'invalid_param', { param: 'code' });
    out.code = c;
  }
  if (util.has(p, 'description')) out.description = util.text(p, 'description', 400, '');
  if (util.has(p, 'icon')) {
    const i = util.str(p, 'icon', '');
    if (i !== '' && !/^[A-Z][A-Za-z0-9]{1,39}$/.test(i)) throw util.fail(400, 'icon is a lucide icon name such as Utensils or Plane', 'invalid_param', { param: 'icon' });
    out.icon = i;
  }
  if (util.has(p, 'kind') || creating) out.kind = util.oneOf(p, 'kind', ['standard', 'mileage'], 'standard');
  for (const k of ['limit', 'per_day_limit', 'receipt_over']) {
    if (!util.has(p, k)) continue;
    const v = util.money(p, k, currency, {});
    out[k + '_minor'] = v === null ? 0 : Math.max(0, v);
  }
  if (util.has(p, 'receipt_rule') || creating) out.receipt_rule = util.oneOf(p, 'receipt_rule', ['always', 'over', 'never'], (out.kind || 'standard') === 'mileage' ? 'never' : 'always');
  if (util.has(p, 'mileage_rate')) out.mileage_rate_minor = rateParam(p, 'mileage_rate', currency);
  if (util.has(p, 'unit') || creating) out.unit = util.oneOf(p, 'unit', ['km', 'mile'], 'km');
  if (util.has(p, 'taxable')) out.taxable = util.bool(p, 'taxable', false);
  if (util.has(p, 'component') || creating) {
    const c = (util.str(p, 'component', '') || 'REIMB').toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(c)) throw util.fail(400, 'component is a pay component code such as REIMB', 'invalid_param', { param: 'component' });
    out.component = c;
  }
  if (util.has(p, 'gl_account')) out.gl_account = util.text(p, 'gl_account', 60, '');
  if (util.has(p, 'sort')) out.sort = util.int(p, 'sort', 0, 0, 100000);
  if (util.has(p, 'archived')) out.archived = util.bool(p, 'archived', false);
  return out;
}

function shownCategoryValue(k, v, currency) {
  if (/_minor$/.test(k) && k !== 'mileage_rate_minor') return v > 0 ? X().fmt(v, currency) : 'none';
  return v;
}

function previewCategory(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const id = util.str(p, 'category', '');
  if (id !== '') {
    const rec = util.byId(app, 'expense_categories', id);
    if (rec === null) throw util.fail(404, 'No such category.', 'not_found');
    const cur = E.entityInfo(app, rec.getString('entity')).currency;
    const before = E.categoryView(rec);
    const next = categoryValues(ctx, p, rec.getString('entity'), cur, false);
    const fields = Object.keys(next)
      .filter((k) => String(next[k]) !== String(before[k]))
      .map((k) => ({ name: k, before: shownCategoryValue(k, before[k], cur), after: shownCategoryValue(k, next[k], cur) }));
    return { label: 'Change the expense category ' + before.name, target: 'expense_categories:' + rec.id, fields: fields, notes: [], risk: 'low' };
  }
  const ent = L('lib_org').entityRef(app, util.req(p, 'entity'));
  const cur = E.entityInfo(app, ent.id).currency;
  const next = categoryValues(ctx, p, ent.id, cur, true);
  return { label: 'Add the expense category ' + next.name + ' to ' + ent.getString('name'), target: '', fields: Object.keys(next).map((k) => ({ name: k, before: '', after: shownCategoryValue(k, next[k], cur) })), notes: [], risk: 'low' };
}

function categoriesSave(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const id = util.str(p, 'category', '');
  let rec;
  let before = null;
  if (id !== '') {
    rec = util.byId(app, 'expense_categories', id);
    if (rec === null) throw util.fail(404, 'No expense category ' + id + '. Run expense-categories.list.', 'not_found');
    before = E.categoryView(rec);
  } else {
    rec = util.newRecord(app, 'expense_categories');
    rec.set('entity', L('lib_org').entityRef(app, util.req(p, 'entity')).id);
    rec.set('archived', false);
    rec.set('taxable', false);
    const r = util.one(app, 'SELECT CAST(COALESCE(MAX(sort), 0) AS INTEGER) AS n FROM expense_categories WHERE entity = {:e}', { n: 0 }, { e: rec.getString('entity') });
    rec.set('sort', (r === null ? 0 : r.n) + 10);
  }
  const entity = rec.getString('entity');
  if (!E.isAdminFor(ctx, entity, 'full')) throw util.fail(403, 'You cannot change the expense categories of this entity.', 'not_permitted');
  const cur = E.entityInfo(app, entity).currency;
  const v = categoryValues(ctx, p, entity, cur, id === '');
  if (v.kind !== undefined && before !== null && v.kind !== before.kind && util.count(app, 'SELECT COUNT(*) AS n FROM claim_lines WHERE category = {:c}', { c: rec.id }) > 0) throw util.fail(409, 'This category has expenses; it cannot switch between mileage and amounts. Add a new category instead.', 'in_use');
  if (v.code !== undefined) {
    const clash = util.findOne(app, 'expense_categories', 'entity = {:e} && code = {:c} && id != {:id}', { e: entity, c: v.code, id: rec.id || '-' });
    if (clash !== null) throw util.fail(409, 'Another category of this entity has the code ' + v.code + '.', 'duplicate');
  }
  for (const k of Object.keys(v)) rec.set(k, v[k]);
  if (rec.getString('icon') === '') rec.set('icon', rec.getString('kind') === 'mileage' ? 'Car' : 'Receipt');
  app.save(rec);
  const after = E.categoryView(rec);
  L('lib_audit').note(ctx, { collection: 'expense_categories', record: rec.id, summary: (before === null ? 'Added' : 'Changed') + ' the expense category ' + after.name, before: before, after: after });
  return { category: after };
}

function categoriesSeed(ctx, p) {
  const util = u();
  const E = X();
  const ent = L('lib_org').entityRef(ctx.app, util.req(p, 'entity'));
  if (!E.isAdminFor(ctx, ent.id, 'full')) throw util.fail(403, 'You cannot change the expense categories of this entity.', 'not_permitted');
  const added = E.seedEntity(ctx.app, ent.id);
  L('lib_audit').note(ctx, { collection: 'expense_categories', summary: added.length > 0 ? 'Added the standard expense categories ' + added.join(', ') + ' to ' + ent.getString('name') : 'The standard expense categories were all there for ' + ent.getString('name') });
  return { added: added, categories: categoriesList(ctx, { entity: ent.id }).categories };
}

function categoriesDelete(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const rec = util.byId(app, 'expense_categories', util.req(p, 'category'));
  if (rec === null) throw util.fail(404, 'No such category.', 'not_found');
  if (!E.isAdminFor(ctx, rec.getString('entity'), 'full')) throw util.fail(403, 'You cannot change the expense categories of this entity.', 'not_permitted');
  const n = util.count(app, 'SELECT COUNT(*) AS n FROM claim_lines WHERE category = {:c}', { c: rec.id });
  if (n > 0) throw util.fail(409, rec.getString('name') + ' is on ' + n + ' expense' + (n === 1 ? '' : 's') + '; stop using it instead (expense-categories.save --archived true).', 'in_use');
  app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'expense_categories', record: rec.id, summary: 'Deleted the expense category ' + rec.getString('name') });
  return { deleted: true };
}

module.exports = {
  POLICY_KEYS: POLICY_KEYS,
  viewerScope: viewerScope,
  spend: spend,
  spendData: spendData,
  home: home,
  me: me,
  policyGet: policyGet,
  policySave: policySave,
  previewPolicy: previewPolicy,
  categoriesList: categoriesList,
  categoriesSave: categoriesSave,
  previewCategory: previewCategory,
  categoriesSeed: categoriesSeed,
  categoriesDelete: categoriesDelete,
};
