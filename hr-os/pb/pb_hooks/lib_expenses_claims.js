/// <reference path="../pb_data/types.d.ts" />
/**
 * Expense claims and their lines (operations claims.* and claim-lines.*).
 *
 * An employee adds an expense in one line (amount, category, day) or by a
 * photo of the receipt: the photo makes a draft line and asks your AI
 * agent to read the claim's receipts (the receipt_review trigger with the
 * claim's id, once while that ask is open). It opens each file by its local
 * path (claim-lines.receipt) and writes what it read (claim-lines.read-
 * result); the last receipt read closes the ask. The reading is a suggestion on the line that the employee uses
 * or dismisses; when the owner set expenses changes to automatic it fills
 * the fields the person has not typed. Your AI agent never submits,
 * approves or marks anything paid.
 *
 * Submitting opens an approval of kind `claim` (its flow, plus finance at or
 * above the entity's finance amount). Approvers may reject single lines
 * with a reason before they approve the rest.
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

/* ------------------------------------------------------------ helpers */

function actorOf(ctx) {
  return ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system';
}

function needDraft(claim) {
  if (claim.getString('status') !== 'draft') throw u().fail(409, 'Claim ' + claim.getString('number') + ' is ' + claim.getString('status') + ': only a draft can change.' + (claim.getString('status') === 'rejected' ? ' Reopen it first (claims.reopen).' : claim.getString('status') === 'submitted' ? ' Withdraw it first (claims.withdraw).' : ''), 'not_draft', { status: claim.getString('status') });
}

/** A new draft claim for an employment. */
function newClaim(ctx, m, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const ent = E.entityInfo(app, m.getString('entity'));
  const pol = E.policyOf(app, ent.id);
  const rec = util.newRecord(app, 'claims');
  rec.set('number', E.nextNumber(app, 'expense_claim', 'EXP'));
  rec.set('employment', m.id);
  rec.set('employee', m.getString('employee'));
  rec.set('entity', ent.id);
  rec.set('title', util.squash(util.text(p, 'title', 160, '')));
  rec.set('currency', ent.currency);
  rec.set('status', 'draft');
  rec.set('pay_via', pol.pay_via);
  if (util.str(p, 'pay_via', '') !== '') {
    if (!E.isAdminFor(ctx, ent.id, 'edit')) throw util.fail(403, 'HR or finance chooses how a claim is paid.', 'not_permitted', { param: 'pay_via' });
    rec.set('pay_via', util.oneOf(p, 'pay_via', ['payroll', 'bank'], pol.pay_via));
  }
  setLinks(ctx, rec, m, p);
  rec.set('note', util.text(p, 'note', 2000, ''));
  rec.set('flags', {});
  rec.set('created_by', ctx.memberId || '');
  rec.set('actor', actorOf(ctx));
  app.save(rec);
  return rec;
}

/** travel and advance links (both must belong to the same employment). */
function setLinks(ctx, rec, m, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  if (util.has(p, 'travel')) {
    const ref = util.str(p, 'travel', '');
    if (ref === '') rec.set('travel', '');
    else {
      const t = E.travelRef(app, ref);
      if (t.getString('employment') !== m.id) throw util.fail(400, 'Trip ' + t.getString('number') + ' belongs to someone else.', 'invalid_param', { param: 'travel' });
      if (['requested', 'approved'].indexOf(t.getString('status')) < 0) throw util.fail(400, 'Trip ' + t.getString('number') + ' is ' + t.getString('status') + '; link a requested or approved trip.', 'invalid_param', { param: 'travel' });
      rec.set('travel', t.id);
    }
  }
  if (util.has(p, 'advance')) {
    const ref = util.str(p, 'advance', '');
    if (ref === '') rec.set('advance', '');
    else {
      const a = E.advanceRef(app, ref);
      if (a.getString('employment') !== m.id) throw util.fail(400, 'Advance ' + a.getString('number') + ' belongs to someone else.', 'invalid_param', { param: 'advance' });
      if (['approved', 'paid'].indexOf(a.getString('status')) < 0) throw util.fail(400, 'Advance ' + a.getString('number') + ' is ' + a.getString('status') + '; link an approved or paid advance.', 'invalid_param', { param: 'advance' });
      rec.set('advance', a.id);
    }
  }
}

/** The newest draft of an employment, or null. */
function openDraft(app, employmentId) {
  const r = u().findMany(app, 'claims', "employment = {:m} && status = 'draft'", '-updated', 1, { m: employmentId });
  return r.length > 0 ? r[0] : null;
}

function currencyParam(p, name, dflt) {
  const util = u();
  const v = util.str(p, name, '').toUpperCase();
  if (v === '') return dflt;
  if (!/^[A-Z]{3}$/.test(v)) throw util.fail(400, name + ' must be a three-letter currency code, e.g. SGD', 'invalid_param', { param: name });
  return v;
}

/**
 * Amounts of a line from its fields: mileage is distance times the
 * category rate; another currency converts at the rate of the day (or the
 * rate the person typed).
 */
function price(app, line, claim, cat, opts) {
  const util = u();
  const money = L('lib_money');
  const cur = claim.getString('currency');
  const o = opts || {};
  if (cat !== null && cat.getString('kind') === 'mileage') {
    if (o.rateChanged || !(line.getFloat('rate_minor') > 0)) {
      line.set('rate_minor', cat.getFloat('mileage_rate_minor'));
      line.set('unit', cat.getString('unit') || 'km');
    }
    const amount = money.round(line.getFloat('distance') * line.getFloat('rate_minor'));
    line.set('currency', cur);
    line.set('amount_minor', amount);
    line.set('fx_rate', 1);
    line.set('fx_day', '');
    line.set('fx_source', '');
    line.set('base_minor', amount);
    return;
  }
  line.set('distance', 0);
  line.set('rate_minor', 0);
  const lc = line.getString('currency') || cur;
  const amount = line.getInt('amount_minor');
  if (lc === cur) {
    line.set('fx_rate', 1);
    line.set('fx_day', '');
    line.set('fx_source', '');
    line.set('base_minor', amount);
    return;
  }
  const typed = line.getString('fx_source') === 'person' && line.getFloat('fx_rate') > 0;
  if (!typed && (o.rateChanged || !(line.getFloat('fx_rate') > 0))) {
    const got = amount > 0 ? L('lib_expenses_fx').rateOf(app, lc, cur, line.getString('day')) : null;
    line.set('fx_rate', got !== null ? got.rate : 0);
    line.set('fx_day', got !== null ? got.day : '');
    line.set('fx_source', got !== null ? got.source : '');
  }
  const rate = line.getFloat('fx_rate');
  line.set('base_minor', rate > 0 ? Math.max(0, money.majorToMinor(money.toMajor(amount, lc) * rate, cur)) : 0);
}

function addEdited(line, fields) {
  const util = u();
  const have = util.jsonOf(line, 'edited', []) || [];
  for (const f of fields) if (have.indexOf(f) < 0) have.push(f);
  line.set('edited', have);
}

/**
 * Set a line's fields from params. Returns { days, rateChanged, category,
 * receipt } so the caller can price, save and refresh.
 */
function applyFields(ctx, line, claim, p, creating) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const entity = claim.getString('entity');
  const touched = [];
  const oldDay = line.getString('day');
  let rateChanged = creating;
  let cat = line.getString('category') !== '' ? util.byId(app, 'expense_categories', line.getString('category')) : null;
  if (util.has(p, 'category')) {
    const ref = util.str(p, 'category', '');
    const next = ref === '' ? null : E.categoryRef(app, entity, ref, false);
    if ((next ? next.id : '') !== (cat ? cat.id : '')) rateChanged = true;
    cat = next;
    line.set('category', cat ? cat.id : '');
    touched.push('category');
  }
  if (util.has(p, 'day') || creating) {
    const d = util.day(p, 'day', creating ? util.today(app, entity) : oldDay);
    if (d !== oldDay) rateChanged = true;
    line.set('day', d);
    if (util.has(p, 'day')) touched.push('day');
  }
  const prevCur = line.getString('currency') || claim.getString('currency');
  let cur = prevCur;
  if (util.has(p, 'currency')) {
    const next = currencyParam(p, 'currency', claim.getString('currency'));
    if (next !== cur) {
      rateChanged = true;
      if (line.getString('fx_source') === 'person') line.set('fx_source', '');
    }
    cur = next;
    touched.push('currency');
  }
  line.set('currency', cur);
  if (util.has(p, 'amount')) {
    const a = util.money(p, 'amount', cur, {});
    if (a !== null && a < 0) throw util.fail(400, 'amount must be 0 or more', 'invalid_amount', { param: 'amount' });
    line.set('amount_minor', a === null ? 0 : a);
    rateChanged = true;
    touched.push('amount');
  } else if (cur !== prevCur && !creating) {
    // The same amount in another currency: keep the major-unit figure, at the new currency's decimals.
    line.set('amount_minor', L('lib_money').majorToMinor(L('lib_money').toMajor(line.getInt('amount_minor'), prevCur), cur));
  }
  if (util.has(p, 'tax')) {
    const t = util.money(p, 'tax', cur, {});
    line.set('tax_minor', t === null ? 0 : Math.max(0, t));
    touched.push('tax');
  }
  if (line.getInt('tax_minor') > line.getInt('amount_minor') && line.getInt('amount_minor') > 0) throw util.fail(400, 'The tax is more than the amount.', 'invalid_param', { param: 'tax' });
  if (util.has(p, 'fx_rate')) {
    const r = util.num(p, 'fx_rate', { min: 0 });
    if (r !== null && r > 0) {
      line.set('fx_rate', r);
      line.set('fx_day', line.getString('day'));
      line.set('fx_source', 'person');
    } else line.set('fx_source', '');
    rateChanged = true;
  }
  if (util.has(p, 'distance')) {
    line.set('distance', util.num(p, 'distance', { min: 0, max: 100000 }) || 0);
    touched.push('distance');
  }
  for (const [k, max] of [['merchant', 160], ['description', 1000], ['attendees', 600], ['reason', 1000]]) {
    if (!util.has(p, k)) continue;
    line.set(k, k === 'merchant' ? util.squash(util.text(p, k, max, '')) : util.text(p, k, max, ''));
    if (k === 'merchant' || k === 'description') touched.push(k);
  }
  let receipt = null;
  if (util.bool(p, 'clear_receipt', false)) {
    line.set('receipt', null);
    line.set('receipt_status', 'none');
    receipt = 'cleared';
  }
  const f = L('lib_files').fileParam(ctx, p, 'receipt', 'path');
  if (f !== null) {
    line.set('receipt', f);
    receipt = 'new';
  }
  if (!ctx.isAgent && touched.length > 0) addEdited(line, touched);
  return { oldDay: oldDay, rateChanged: rateChanged, category: cat, receipt: receipt };
}

function nextSort(app, claimId) {
  const r = u().one(app, 'SELECT CAST(COALESCE(MAX(sort), 0) AS INTEGER) AS n FROM claim_lines WHERE claim = {:c}', { n: 0 }, { c: claimId });
  return (r === null ? 0 : r.n) + 10;
}

function afterLine(app, line, claim, days) {
  const E = X();
  E.refreshDays(app, claim.getString('employee'), days.filter((d) => d !== ''));
  E.reflag(app, app.findRecordById('claim_lines', line.id), app.findRecordById('claims', claim.id), {});
  return E.refreshClaim(app, app.findRecordById('claims', claim.id));
}

/* ------------------------------------------------------------- claims */

function listQuery(ctx, p) {
  const util = u();
  const E = X();
  const auth = L('lib_auth');
  const app = ctx.app;
  const bind = {};
  const where = [];
  const admin = ctx.isAgent || auth.can(ctx, 'expenses', 'view');
  const view = util.oneOf(p, 'view', ['mine', 'team', 'all'], admin ? 'all' : ctx.teamScope ? 'team' : 'mine');
  const keys = (ids, prefix) => ids.map((x, i) => ((bind[prefix + i] = x), '{:' + prefix + i + '}')).join(',');
  if (view === 'all') {
    if (!admin) throw util.fail(403, 'Your role cannot see every claim (needs view access to Expenses). Use --view mine or --view team.', 'not_permitted');
    const sc = auth.scope(ctx);
    if (sc.length > 0) where.push('c.entity IN (' + keys(sc, 's') + ')');
  } else if (view === 'team') {
    const ids = E.teamEmployments(ctx);
    where.push(ids.length === 0 ? '1 = 0' : 'c.employment IN (' + keys(ids, 'r') + ')');
  } else {
    where.push(ctx.employeeId === '' ? '1 = 0' : 'c.employee = {:self}');
    bind.self = ctx.employeeId;
  }
  const status = util.oneOf(p, 'status', ['active', 'open', 'draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled', 'any'], view === 'mine' ? 'any' : 'active');
  if (status === 'active') where.push("c.status NOT IN ('draft', 'cancelled')");
  else if (status === 'open') where.push("c.status IN ('draft', 'submitted')");
  else if (status !== 'any') {
    where.push('c.status = {:st}');
    bind.st = status;
  }
  if (util.str(p, 'entity', '') !== '') {
    where.push('c.entity = {:ent}');
    bind.ent = L('lib_org').entityRef(app, util.str(p, 'entity', '')).id;
  }
  if (util.str(p, 'employee', '') !== '') {
    where.push('c.employee = {:emp}');
    bind.emp = L('lib_people').employeeRef(app, util.str(p, 'employee', '')).id;
  }
  if (util.str(p, 'department', '') !== '') {
    bind.dep = L('lib_org').kindRef(app, 'department', util.str(p, 'department', '')).id;
    bind.today = util.today(app);
    where.push('c.employment IN (SELECT m.id FROM employments m JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= {:today} ORDER BY j2.effective_from DESC LIMIT 1) WHERE j.department = {:dep})');
  }
  if (util.str(p, 'travel', '') !== '') {
    where.push('c.travel = {:trv}');
    bind.trv = E.travelRef(app, util.str(p, 'travel', '')).id;
  }
  if (util.bool(p, 'flagged', false)) where.push('c.flag_count > 0');
  if (util.str(p, 'pay_via', '') !== '') {
    where.push('c.pay_via = {:via}');
    bind.via = util.oneOf(p, 'pay_via', ['payroll', 'bank'], 'payroll');
  }
  const dayOf = "substr(CASE WHEN c.submitted_at != '' THEN c.submitted_at ELSE c.created END, 1, 10)";
  if (util.day(p, 'from', '') !== '') {
    where.push(dayOf + ' >= {:from}');
    bind.from = util.day(p, 'from', '');
  }
  if (util.day(p, 'to', '') !== '') {
    where.push(dayOf + ' <= {:to}');
    bind.to = util.day(p, 'to', '');
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(c.number LIKE {:q} ESCAPE '\\' OR c.title LIKE {:q} ESCAPE '\\' OR e.legal_name LIKE {:q} ESCAPE '\\' OR e.preferred_name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const sort = util.oneOf(p, 'sort', ['recent', 'oldest', 'amount'], status === 'submitted' ? 'oldest' : 'recent');
  const order = sort === 'oldest' ? dayOf + ' ASC, c.created ASC' : sort === 'amount' ? 'c.total_minor DESC, c.created DESC' : 'c.updated DESC, c.created DESC';
  return { where: where.length > 0 ? where.join(' AND ') : '1 = 1', bind: bind, order: order, view: view, status: status };
}

function claimsList(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const q = listQuery(ctx, p);
  const pg = util.page(p, 50, 500);
  const from = ' FROM claims c JOIN employees e ON e.id = c.employee WHERE ' + q.where;
  const total = util.count(app, 'SELECT COUNT(*) AS n' + from, q.bind);
  const ids = util.rows(app, 'SELECT c.id AS id' + from + ' ORDER BY ' + q.order + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, q.bind).map((r) => r.id);
  const totals = util
    .rows(
      app,
      "SELECT c.currency AS currency, COUNT(*) AS n, CAST(COALESCE(SUM(c.total_minor), 0) AS INTEGER) AS total_minor, CAST(COALESCE(SUM(CASE WHEN c.status = 'approved' THEN c.approved_minor - c.advance_applied_minor ELSE 0 END), 0) AS INTEGER) AS awaiting_minor" + from + ' GROUP BY c.currency ORDER BY c.currency',
      { currency: '', n: 0, total_minor: 0, awaiting_minor: 0 },
      q.bind,
    )
    .map((r) => ({ currency: r.currency, claims: r.n, total_minor: r.total_minor, awaiting_minor: r.awaiting_minor }));
  const receipts = {};
  if (ids.length > 0) {
    const bind = {};
    const keys = ids.map((id, i) => ((bind['i' + i] = id), '{:i' + i + '}')).join(',');
    for (const r of util.rows(app, "SELECT claim, COUNT(*) AS n FROM claim_lines WHERE receipt != '' AND claim IN (" + keys + ') GROUP BY claim', { claim: '', n: 0 }, bind)) receipts[r.claim] = r.n;
  }
  const nm = E.names(app);
  const today = util.today(app);
  const people = L('lib_people');
  const depCache = {};
  const rows = ids.map((id) => {
    const rec = app.findRecordById('claims', id);
    const v = E.claimView(app, rec, nm);
    v.receipts = receipts[id] || 0;
    const emp = rec.getString('employment');
    if (depCache[emp] === undefined) {
      const job = people.rowOn(app, 'job_records', emp, today);
      const dep = job !== null && job.getString('department') !== '' ? util.byId(app, 'departments', job.getString('department')) : null;
      depCache[emp] = { department: dep ? dep.id : '', department_name: dep ? dep.getString('name') : '' };
    }
    v.department = depCache[emp].department;
    v.department_name = depCache[emp].department_name;
    return v;
  });
  return { claims: rows, total: total, totals: totals, view: q.view, status: q.status, limit: pg.limit, offset: pg.offset };
}

function approvalsOf(app, collection, id) {
  const ap = L('lib_approvals');
  return u()
    .findMany(app, 'approvals', 'ref_collection = {:c} && ref_id = {:r}', 'created', 50, { c: collection, r: id })
    .map((r) => ap.view(app, r));
}

function pendingApproval(app, rec) {
  const id = rec.getString('approval');
  if (id === '') return null;
  const a = u().byId(app, 'approvals', id);
  return a !== null && a.getString('status') === 'pending' ? a : null;
}

function claimsGet(ctx, p) {
  const util = u();
  const E = X();
  const auth = L('lib_auth');
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  const access = E.needSee(ctx, c);
  const nm = E.names(app);
  const view = E.claimView(app, c, nm);
  const lines = util.findMany(app, 'claim_lines', 'claim = {:c}', 'sort,created', 0, { c: c.id }).map((l) => E.lineView(app, l, nm));
  const pending = pendingApproval(app, c);
  const standing = pending !== null ? L('lib_approvals').standing(ctx, pending) : '';
  const status = c.getString('status');
  const write = E.canWriteFor(ctx, c);
  const full = !ctx.isAgent && E.isAdminFor(ctx, c.getString('entity'), 'full');
  view.lines = lines;
  view.approvals = approvalsOf(app, 'claims', c.id);
  view.settlements = util.findMany(app, 'advance_settlements', 'claim = {:c}', 'created', 50, { c: c.id }).map((s) => ({ id: s.id, advance: s.getString('advance'), advance_number: nm.advance(s.getString('advance')), amount_minor: s.getInt('amount_minor'), day: s.getString('day'), kind: s.getString('kind') }));
  view.travel_detail = c.getString('travel') !== '' ? E.travelView(app, app.findRecordById('travel_requests', c.getString('travel')), nm) : null;
  view.advance_detail = c.getString('advance') !== '' ? E.advanceView(app, app.findRecordById('advances', c.getString('advance')), nm) : null;
  view.history = L('lib_audit').forRecord(app, 'claims', c.id, 40).map((h) => ({ at: h.at, who: h.who, actor: h.actor, summary: h.summary }));
  view.access = access;
  view.can = {
    edit: status === 'draft' && write,
    submit: status === 'draft' && write && !ctx.isAgent && lines.length > 0,
    withdraw: status === 'submitted' && pending !== null && !ctx.isAgent && (pending.getString('requester') === ctx.memberId || full),
    reopen: status === 'rejected' && write,
    cancel: (status === 'draft' || status === 'rejected') && write && !ctx.isAgent,
    delete: status === 'draft' && write,
    decide: standing !== '',
    reject_lines: standing !== '',
    mark_paid: status === 'approved' && full,
    set_payment: status === 'approved' && full,
    flag: ctx.isAgent || (!ctx.isAgent && E.isAdminFor(ctx, c.getString('entity'), 'edit')),
    clear_flag: !ctx.isAgent && (E.isAdminFor(ctx, c.getString('entity'), 'edit') || standing !== ''),
  };
  view.pending_approval = pending !== null ? L('lib_approvals').view(app, pending) : null;
  if (view.can.edit) view.categories = util.findMany(app, 'expense_categories', 'entity = {:e} && archived = false', 'sort,name', 0, { e: c.getString('entity') }).map(E.categoryView);
  view.policy = E.policyOf(app, c.getString('entity'));
  if (!auth.can(ctx, 'expenses', 'view') && !ctx.isAgent) delete view.policy.note;
  return { claim: view };
}

function claimsCreate(ctx, p) {
  const E = X();
  const m = E.employmentFor(ctx, p);
  const rec = newClaim(ctx, m, p);
  L('lib_audit').note(ctx, { collection: 'claims', record: rec.id, summary: 'Started expense claim ' + rec.getString('number') + ' for ' + E.names(ctx.app).employee(rec.getString('employee')) });
  return { claim: E.claimView(ctx.app, rec) };
}

function claimsUpdate(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  E.needWrite(ctx, c);
  needDraft(c);
  const before = E.claimView(app, c);
  if (util.has(p, 'title')) c.set('title', util.squash(util.text(p, 'title', 160, '')));
  if (util.has(p, 'note')) c.set('note', util.text(p, 'note', 2000, ''));
  if (util.has(p, 'pay_via')) {
    if (!E.isAdminFor(ctx, c.getString('entity'), 'edit')) throw util.fail(403, 'HR or finance chooses how a claim is paid.', 'not_permitted', { param: 'pay_via' });
    c.set('pay_via', util.oneOf(p, 'pay_via', ['payroll', 'bank'], c.getString('pay_via')));
  }
  setLinks(ctx, c, app.findRecordById('employments', c.getString('employment')), p);
  app.save(c);
  const after = E.claimView(app, c);
  L('lib_audit').note(ctx, { collection: 'claims', record: c.id, summary: 'Changed expense claim ' + c.getString('number'), before: before, after: after });
  return { claim: after };
}

function claimsSubmit(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c0 = E.claimRef(app, util.req(p, 'claim'));
  E.needWrite(ctx, c0);
  needDraft(c0);
  const lines0 = util.findMany(app, 'claim_lines', 'claim = {:c}', 'sort,created', 0, { c: c0.id });
  if (lines0.length === 0) throw util.fail(400, 'Add at least one expense to ' + c0.getString('number') + ' first.', 'empty_claim');
  const days = {};
  for (const l of lines0) days[l.getString('day')] = true;
  E.refreshDays(app, c0.getString('employee'), Object.keys(days));
  const c1 = app.findRecordById('claims', c0.id);
  const lines = util.findMany(app, 'claim_lines', 'claim = {:c}', 'sort,created', 0, { c: c0.id });
  const blocked = [];
  for (const l of lines) {
    const b = (util.jsonOf(l, 'flags', []) || []).filter((f) => f.severity === 'blocker' || f.severity === 'wait');
    if (b.length > 0) blocked.push({ line: l.id, day: l.getString('day'), merchant: l.getString('merchant'), codes: b.map((f) => f.code), messages: b.map((f) => f.message) });
  }
  if (blocked.length > 0) throw util.fail(409, 'Fix ' + blocked.length + ' expense' + (blocked.length === 1 ? '' : 's') + ' first: ' + blocked.map((x) => x.messages[0]).join('; ') + '.', 'claim_blocked', { lines: blocked });
  const total = c1.getInt('total_minor');
  if (total <= 0) throw util.fail(400, 'The claim adds up to nothing.', 'empty_claim');
  const pol = E.policyOf(app, c1.getString('entity'));
  const name = E.names(app).employee(c1.getString('employee'));
  const flagged = lines.filter((l) => l.getInt('flag_count') > 0).length;
  const codes = Object.keys((util.jsonOf(c1, 'flags', {}) || {}).codes || {});
  let approval = null;
  let finance = false;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const c = tx.findRecordById('claims', c0.id);
    c.set('status', 'submitted');
    c.set('submitted_at', util.nowIso());
    c.set('decided_at', '');
    c.set('decided_note', '');
    c.set('approved_minor', 0);
    c.set('approved_day', '');
    c.set('advance_applied_minor', 0);
    tx.save(c);
    for (const l of util.findMany(tx, 'claim_lines', "claim = {:c} && (receipt_status = 'waiting' || receipt_status = 'reading')", '', 0, { c: c.id })) {
      l.set('receipt_status', 'none');
      tx.save(l);
    }
    for (const l of util.findMany(tx, 'claim_lines', "claim = {:c} && reject_reason != ''", '', 0, { c: c.id })) {
      l.set('reject_reason', '');
      l.set('rejected_by', '');
      tx.save(l);
    }
    approval = L('lib_approvals').open(t, {
      kind: 'claim',
      ref_collection: 'claims',
      ref_id: c.id,
      employment: c.getString('employment'),
      entity: c.getString('entity'),
      summary: 'Expense claim ' + c.getString('number') + ' from ' + name + ' (' + lines.length + ' expense' + (lines.length === 1 ? '' : 's') + (flagged > 0 ? ', ' + flagged + ' flagged' : '') + ')',
      amount_minor: total,
      currency: c.getString('currency'),
      facts: [{ type: 'text', key: 'claim', label: 'Claim', value: c.getString('title') !== '' ? c.getString('title') : c.getString('number') }, { type: 'money', key: 'total', label: 'Total', amount_minor: total, currency: c.getString('currency') }, { type: 'number', key: 'lines', label: 'Expenses', value: lines.length, unit: lines.length === 1 ? 'expense' : 'expenses' }].concat(flagged > 0 ? [{ type: 'number', key: 'flagged', label: 'Flagged', value: flagged, unit: 'flagged' }] : []),
      payload: { claim: c.id, number: c.getString('number'), title: c.getString('title'), lines: lines.length, flagged: flagged, codes: codes, receipts: lines.filter((l) => l.getString('receipt') !== '').length, pay_via: c.getString('pay_via') },
    });
    finance = E.addFinanceStep(tx, approval, total, pol);
    const c2 = tx.findRecordById('claims', c0.id);
    c2.set('approval', approval.id);
    tx.save(c2);
    L('lib_audit').write(t, { op: 'claims.submit', collection: 'claims', record: c0.id, summary: 'Submitted expense claim ' + c0.getString('number') + (finance ? '; finance also approves it' : '') + (c2.getString('status') === 'approved' ? '; approved by rule' : ''), after: { total_minor: total, currency: c2.getString('currency') } });
  });
  ctx.audited = true;
  E.settleReceipts(app, c0.id, 'closed');
  const rec = app.findRecordById('claims', c0.id);
  return { claim: E.claimView(app, rec), approval: L('lib_approvals').view(app, app.findRecordById('approvals', approval.id)), finance_step: finance };
}

function claimsWithdraw(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  E.needSee(ctx, c);
  if (c.getString('status') !== 'submitted') throw util.fail(409, 'Claim ' + c.getString('number') + ' is ' + c.getString('status') + '; only a submitted claim can be withdrawn.', 'not_submitted');
  const a = pendingApproval(app, c);
  if (a === null) throw util.fail(409, 'This claim has no approval waiting.', 'conflict');
  L('lib_approvals').cancel(ctx, a.id, util.text(p, 'note', 1000, '') || 'Withdrawn to change it');
  return { claim: E.claimView(app, app.findRecordById('claims', c.id)) };
}

function claimsReopen(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  E.needWrite(ctx, c);
  if (c.getString('status') !== 'rejected') throw util.fail(409, 'Only a rejected claim can be reopened (this one is ' + c.getString('status') + ').', 'not_rejected');
  c.set('status', 'draft');
  c.set('approval', '');
  app.save(c);
  const days = {};
  for (const l of util.findMany(app, 'claim_lines', 'claim = {:c}', '', 0, { c: c.id })) {
    days[l.getString('day')] = true;
    if (l.getString('status') !== 'included') {
      l.set('status', 'included');
      app.save(l);
    }
  }
  E.refreshDays(app, c.getString('employee'), Object.keys(days));
  E.refreshClaim(app, app.findRecordById('claims', c.id));
  L('lib_audit').note(ctx, { collection: 'claims', record: c.id, summary: 'Reopened expense claim ' + c.getString('number') + ' to fix and submit again' });
  return { claim: E.claimView(app, app.findRecordById('claims', c.id)) };
}

/** The claim is cancelled: its receipts are no longer waiting for your AI agent. */
function closeReceiptAsk(app, claimId) {
  const util = u();
  for (const l of util.findMany(app, 'claim_lines', "claim = {:c} && (receipt_status = 'waiting' || receipt_status = 'reading')", '', 0, { c: claimId })) {
    l.set('receipt_status', 'none');
    app.save(l);
  }
  X().settleReceipts(app, claimId, 'closed');
}

function claimsCancel(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  E.needWrite(ctx, c);
  if (c.getString('status') !== 'draft' && c.getString('status') !== 'rejected') throw util.fail(409, 'Only a draft or a rejected claim can be cancelled (this one is ' + c.getString('status') + ').', 'conflict');
  c.set('status', 'cancelled');
  app.save(c);
  closeReceiptAsk(app, c.id);
  const days = util.rows(app, 'SELECT DISTINCT day FROM claim_lines WHERE claim = {:c}', { day: '' }, { c: c.id }).map((r) => r.day);
  E.refreshDays(app, c.getString('employee'), days);
  L('lib_audit').note(ctx, { collection: 'claims', record: c.id, summary: 'Cancelled expense claim ' + c.getString('number') });
  return { claim: E.claimView(app, app.findRecordById('claims', c.id)) };
}

function claimsDelete(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  E.needWrite(ctx, c);
  needDraft(c);
  const days = util.rows(app, 'SELECT DISTINCT day FROM claim_lines WHERE claim = {:c}', { day: '' }, { c: c.id }).map((r) => r.day);
  const number = c.getString('number');
  const employee = c.getString('employee');
  app.delete(c);
  E.refreshDays(app, employee, days);
  L('lib_audit').note(ctx, { collection: 'claims', record: c.id, summary: 'Deleted the draft expense claim ' + number });
  return { deleted: true, number: number };
}

function claimsRejectLines(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  if (c.getString('status') !== 'submitted') throw util.fail(409, 'Lines can be rejected only while the claim waits for approval.', 'not_submitted');
  const a = pendingApproval(app, c);
  if (a === null || L('lib_approvals').standing(ctx, a) === '') throw util.fail(403, 'Only an approver of this claim can reject its lines.', 'not_permitted');
  const undo = util.bool(p, 'undo', false);
  const reason = util.text(p, 'reason', 1000, '');
  if (!undo && reason === '') throw util.fail(400, 'Say why, so the person knows what to fix.', 'missing_param', { param: 'reason' });
  const ids = (util.list(p, 'lines') || []).map(String);
  if (ids.length === 0) throw util.fail(400, 'Give the lines, e.g. --lines \'["<line id>"]\'.', 'missing_param', { param: 'lines' });
  let n = 0;
  for (const id of ids) {
    const l = E.lineRef(app, id);
    if (l.getString('claim') !== c.id) throw util.fail(400, 'Line ' + id + ' is not on ' + c.getString('number') + '.', 'invalid_param', { param: 'lines' });
    l.set('status', undo ? 'included' : 'rejected');
    l.set('reject_reason', undo ? '' : reason);
    l.set('rejected_by', undo ? '' : ctx.memberId);
    app.save(l);
    n++;
  }
  E.refreshClaim(app, app.findRecordById('claims', c.id));
  L('lib_audit').note(ctx, { collection: 'claims', record: c.id, summary: (undo ? 'Put back ' : 'Rejected ') + n + ' expense' + (n === 1 ? '' : 's') + ' on ' + c.getString('number') + (undo ? '' : ': ' + util.clip(reason, 160)) });
  const nm = E.names(app);
  return { claim: E.claimView(app, app.findRecordById('claims', c.id), nm), lines: util.findMany(app, 'claim_lines', 'claim = {:c}', 'sort,created', 0, { c: c.id }).map((l) => E.lineView(app, l, nm)) };
}

function claimsMarkPaid(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const refs = (util.list(p, 'claims') || []).map(String);
  if (util.str(p, 'claim', '') !== '') refs.push(util.str(p, 'claim', ''));
  if (refs.length === 0) throw util.fail(400, 'Give --claim EXP-0001 or --claims \'["EXP-0001","EXP-0002"]\'.', 'missing_param', { param: 'claims' });
  if (refs.length > 500) throw util.fail(400, 'At most 500 claims at once.', 'too_many');
  const reference = util.text(p, 'reference', 120, '');
  if (reference === '') throw util.fail(400, 'Give the payment reference (the bank transfer or batch id), so the payment can be traced.', 'missing_param', { param: 'reference' });
  const out = [];
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    for (const ref of refs) {
      const c = E.claimRef(tx, ref);
      if (!E.isAdminFor(t, c.getString('entity'), 'full')) throw util.fail(403, 'You cannot pay claims of ' + E.names(tx).entity(c.getString('entity')) + '.', 'not_permitted');
      if (c.getString('status') !== 'approved') throw util.fail(409, c.getString('number') + ' is ' + c.getString('status') + '; only approved claims can be marked paid.', 'not_approved', { claim: c.getString('number') });
      const day = util.day(p, 'day', util.today(tx, c.getString('entity')));
      c.set('status', 'paid');
      c.set('paid_via', 'bank');
      c.set('paid_reference', reference);
      c.set('paid_by', ctx.memberId);
      c.set('paid_at', util.nowIso());
      c.set('paid_day', day);
      tx.save(c);
      L('lib_notify').toEmployee(tx, c.getString('employee'), { kind: 'expenses', title: 'Paid: expense claim ' + c.getString('number'), body: E.fmt(c.getInt('approved_minor') - c.getInt('advance_applied_minor'), c.getString('currency')) + ', reference ' + reference, link: '#/expenses/claims/' + c.id, email: false, facts: [{ type: 'state', key: 'status', value: 'paid' }, { type: 'money', key: 'paid', label: 'Paid', amount_minor: c.getInt('approved_minor') - c.getInt('advance_applied_minor'), currency: c.getString('currency') }, { type: 'day', key: 'paid_day', label: 'Paid on', value: day }, { type: 'text', key: 'reference', label: 'Reference', value: reference }] });
      L('lib_audit').write(t, { op: 'claims.mark-paid', collection: 'claims', record: c.id, summary: 'Marked ' + c.getString('number') + ' paid by bank (reference ' + reference + ')', after: { paid_minor: c.getInt('approved_minor') - c.getInt('advance_applied_minor'), currency: c.getString('currency'), reference: reference } });
      out.push(c.id);
    }
  });
  ctx.audited = true;
  const nm = E.names(app);
  return { paid: out.length, claims: out.map((id) => E.claimView(app, app.findRecordById('claims', id), nm)) };
}

function claimsSetPayment(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const c = E.claimRef(app, util.req(p, 'claim'));
  if (!E.isAdminFor(ctx, c.getString('entity'), 'full')) throw util.fail(403, 'Finance chooses how a claim is paid.', 'not_permitted');
  if (c.getString('status') !== 'approved' && c.getString('status') !== 'draft' && c.getString('status') !== 'submitted') throw util.fail(409, c.getString('number') + ' is ' + c.getString('status') + '.', 'conflict');
  const via = util.oneOf(p, 'pay_via', ['payroll', 'bank'], '');
  if (via === '') throw util.fail(400, 'pay_via is payroll or bank.', 'missing_param', { param: 'pay_via' });
  const before = c.getString('pay_via');
  c.set('pay_via', via);
  app.save(c);
  L('lib_audit').note(ctx, { collection: 'claims', record: c.id, summary: c.getString('number') + ' is paid ' + (via === 'payroll' ? 'with the next pay run' : 'by bank transfer'), before: { pay_via: before }, after: { pay_via: via } });
  return { claim: E.claimView(app, c) };
}

function claimsExport(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const q = listQuery(ctx, Object.assign({}, p, { view: 'all' }));
  const level = util.oneOf(p, 'level', ['claims', 'lines'], 'claims');
  const from = ' FROM claims c JOIN employees e ON e.id = c.employee WHERE ' + q.where;
  const ids = util.rows(app, 'SELECT c.id AS id' + from + ' ORDER BY ' + q.order + ' LIMIT 5000', { id: '' }, q.bind).map((r) => r.id);
  const money = L('lib_money');
  const nm = E.names(app);
  let rows;
  if (level === 'claims') {
    rows = [['number', 'employee_number', 'employee', 'entity', 'title', 'status', 'submitted', 'approved_day', 'currency', 'total', 'approved', 'advance_applied', 'payable', 'pay_via', 'paid_day', 'paid_reference', 'lines', 'flags']];
    for (const id of ids) {
      const v = E.claimView(app, app.findRecordById('claims', id), nm);
      rows.push([v.number, v.employee_number, v.employee_name, v.entity_name, v.title, v.status, v.submitted_at.slice(0, 10), v.approved_day, v.currency, money.fromMinor(v.total_minor, v.currency), money.fromMinor(v.approved_minor, v.currency), money.fromMinor(v.advance_applied_minor, v.currency), money.fromMinor(v.payable_minor, v.currency), v.pay_via, v.paid_day, v.paid_reference, v.line_count, v.flag_count]);
    }
  } else {
    rows = [['claim', 'employee_number', 'employee', 'entity', 'claim_status', 'line_status', 'day', 'category', 'gl_account', 'merchant', 'description', 'amount', 'currency', 'fx_rate', 'claim_currency', 'base', 'tax', 'distance', 'unit', 'receipt', 'flags']];
    for (const id of ids) {
      const c = app.findRecordById('claims', id);
      const v = E.claimView(app, c, nm);
      for (const l of util.findMany(app, 'claim_lines', 'claim = {:c}', 'sort,created', 0, { c: id })) {
        const lv = E.lineView(app, l, nm);
        const cat = nm.category(l.getString('category'));
        rows.push([v.number, v.employee_number, v.employee_name, v.entity_name, v.status, lv.status, lv.day, lv.category_name, cat ? cat.getString('gl_account') : '', lv.merchant, lv.description, money.fromMinor(lv.amount_minor, lv.currency), lv.currency, lv.fx_rate, v.currency, money.fromMinor(lv.base_minor, v.currency), money.fromMinor(lv.tax_minor, lv.currency), lv.distance || '', lv.kind === 'mileage' ? lv.unit : '', lv.receipt ? 'yes' : 'no', lv.flags.map((f) => f.code).join(' ')]);
      }
    }
  }
  L('lib_audit').write(ctx, { op: 'claims.export', collection: 'claims', summary: 'Exported ' + (rows.length - 1) + ' ' + (level === 'claims' ? 'claims' : 'expense lines') + ' to CSV' });
  return { filename: 'expenses-' + level + '-' + util.today(app) + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

/* -------------------------------------------------------------- lines */

function linesAdd(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  let claim;
  let started = false;
  if (util.str(p, 'claim', '') !== '') {
    claim = E.claimRef(app, util.str(p, 'claim', ''));
    E.needWrite(ctx, claim);
    needDraft(claim);
  } else {
    const m = E.employmentFor(ctx, p);
    claim = openDraft(app, m.id);
    if (claim === null) {
      claim = newClaim(ctx, m, {});
      started = true;
    }
  }
  const line = util.newRecord(app, 'claim_lines');
  line.set('claim', claim.id);
  line.set('employee', claim.getString('employee'));
  line.set('entity', claim.getString('entity'));
  line.set('status', 'included');
  line.set('receipt_status', 'none');
  line.set('flags', []);
  line.set('agent_flags', []);
  line.set('edited', []);
  line.set('sort', nextSort(app, claim.id));
  const a = applyFields(ctx, line, claim, p, true);
  const hasAmount = line.getInt('amount_minor') > 0 || line.getFloat('distance') > 0;
  if (a.receipt === null && !hasAmount) throw util.fail(400, a.category !== null && a.category.getString('kind') === 'mileage' ? 'Give the distance driven.' : 'Give the amount (and the category), or a photo of the receipt.', 'missing_param', { param: a.category !== null && a.category.getString('kind') === 'mileage' ? 'distance' : 'amount' });
  const read = a.receipt === 'new' && util.bool(p, 'read', !hasAmount);
  if (read) line.set('receipt_status', 'waiting');
  price(app, line, claim, a.category, { rateChanged: true });
  app.save(line);
  const c0 = afterLine(app, line, claim, [line.getString('day')]);
  const asked = read && !ctx.isAgent ? E.askRead(ctx, c0) : null;
  const c = asked !== null ? app.findRecordById('claims', claim.id) : c0;
  const nm = E.names(app);
  const lv = E.lineView(app, app.findRecordById('claim_lines', line.id), nm);
  L('lib_audit').note(ctx, { collection: 'claims', record: claim.id, summary: 'Added ' + (lv.category_name || 'an expense') + (read ? ' (receipt waiting for your AI agent)' : '') + ' to ' + claim.getString('number'), after: { amount_minor: lv.amount_minor, currency: lv.currency, day: lv.day, request: asked !== null ? asked.request : undefined } });
  return { line: lv, claim: E.claimView(app, c, nm), started: started, asked: asked !== null && asked.asked };
}

function lineAndClaim(ctx, p) {
  const util = u();
  const E = X();
  const line = E.lineRef(ctx.app, util.req(p, 'line'));
  const claim = ctx.app.findRecordById('claims', line.getString('claim'));
  return { line: line, claim: claim };
}

function linesUpdate(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  E.needWrite(ctx, x.claim);
  needDraft(x.claim);
  const before = E.lineView(app, x.line);
  const a = applyFields(ctx, x.line, x.claim, p, false);
  const read = a.receipt === 'new' && util.bool(p, 'read', !(x.line.getInt('amount_minor') > 0));
  if (read) x.line.set('receipt_status', 'waiting');
  const typedOver = !read && !ctx.isAgent && x.line.getInt('amount_minor') > 0 && (x.line.getString('receipt_status') === 'waiting' || x.line.getString('receipt_status') === 'reading');
  if (typedOver) {
    x.line.set('receipt_status', 'none');
  }
  price(app, x.line, x.claim, a.category, { rateChanged: a.rateChanged });
  app.save(x.line);
  const c0 = afterLine(app, x.line, x.claim, [a.oldDay, x.line.getString('day')]);
  const asked = read && !ctx.isAgent ? E.askRead(ctx, c0) : null;
  if (typedOver) E.settleReceipts(app, x.claim.id, 'closed');
  const c = asked !== null || typedOver ? app.findRecordById('claims', x.claim.id) : c0;
  const nm = E.names(app);
  const after = E.lineView(app, app.findRecordById('claim_lines', x.line.id), nm);
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: 'Changed ' + (after.category_name || 'an expense') + ' on ' + x.claim.getString('number'), before: before, after: after });
  return { line: after, claim: E.claimView(app, c, nm), asked: asked !== null && asked.asked };
}

function linesDelete(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  E.needWrite(ctx, x.claim);
  needDraft(x.claim);
  const day = x.line.getString('day');
  const what = E.lineView(app, x.line);
  app.delete(x.line);
  E.settleReceipts(app, x.claim.id, 'closed');
  E.refreshDays(app, x.claim.getString('employee'), [day]);
  const c = E.refreshClaim(app, app.findRecordById('claims', x.claim.id));
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: 'Removed ' + (what.category_name || 'an expense') + ' from ' + x.claim.getString('number'), before: { amount_minor: what.amount_minor, currency: what.currency, day: what.day } });
  return { deleted: true, claim: E.claimView(app, c) };
}

function linesReceipt(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  E.needSee(ctx, x.claim);
  if (x.line.getString('receipt') === '') throw util.fail(404, 'This expense has no receipt.', 'not_found');
  if (ctx.isAgent && x.line.getString('receipt_status') === 'waiting') {
    x.line.set('receipt_status', 'reading');
    app.save(x.line);
  }
  const out = L('lib_files').serve(ctx, x.line, 'receipt', 'receipt-' + x.claim.getString('number') + '-' + x.line.getString('day'), util.bool(p, 'download', false));
  if (out && out.__streamed !== true) {
    out.line = E.lineView(app, x.line);
    out.claim = { id: x.claim.id, number: x.claim.getString('number'), currency: x.claim.getString('currency'), entity: x.claim.getString('entity'), status: x.claim.getString('status') };
    out.categories = util.findMany(app, 'expense_categories', 'entity = {:e} && archived = false', 'sort,name', 0, { e: x.claim.getString('entity') }).map((c) => ({ code: c.getString('code'), name: c.getString('name'), kind: c.getString('kind'), description: c.getString('description') }));
  }
  return out;
}

function linesReadAgain(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  E.needWrite(ctx, x.claim);
  needDraft(x.claim);
  if (x.line.getString('receipt') === '') throw util.fail(400, 'Attach the receipt first.', 'no_receipt');
  x.line.set('receipt_status', 'waiting');
  app.save(x.line);
  E.reflag(app, x.line, x.claim, {});
  E.refreshClaim(app, x.claim);
  const asked = E.askRead(ctx, app.findRecordById('claims', x.claim.id));
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: 'Asked your AI agent to read a receipt on ' + x.claim.getString('number'), after: { trigger: 'receipt_review', request: asked.request } });
  return { line: E.lineView(app, app.findRecordById('claim_lines', x.line.id)), claim: E.claimView(app, app.findRecordById('claims', x.claim.id)), asked: asked.asked };
}

/** Put reading values on the line (fields: which of READING_FIELDS; skip: fields to leave). */
function applyReading(app, line, claim, reading, fields, skip) {
  const util = u();
  const applied = [];
  const want = (f) => fields.indexOf(f) >= 0 && skip.indexOf(f) < 0;
  if (want('category') && reading.category) {
    const cat = util.byId(app, 'expense_categories', reading.category);
    if (cat !== null && !cat.getBool('archived') && cat.getString('entity') === claim.getString('entity')) {
      line.set('category', cat.id);
      applied.push('category');
    }
  }
  if (want('merchant') && reading.merchant) {
    line.set('merchant', reading.merchant);
    applied.push('merchant');
  }
  if (want('description') && reading.description) {
    line.set('description', reading.description);
    applied.push('description');
  }
  if (want('day') && util.isDay(reading.day || '')) {
    line.set('day', reading.day);
    applied.push('day');
  }
  if (want('amount') && reading.amount_minor > 0 && reading.currency) {
    line.set('currency', reading.currency);
    line.set('amount_minor', reading.amount_minor);
    if (line.getString('fx_source') === 'person') line.set('fx_source', '');
    applied.push('amount', 'currency');
  }
  if (want('tax') && reading.tax_minor >= 0 && reading.currency === line.getString('currency')) {
    line.set('tax_minor', Math.min(reading.tax_minor, line.getInt('amount_minor')));
    applied.push('tax');
  }
  return applied;
}

function needAgent(ctx, op) {
  if (!ctx.isAgent) throw u().fail(403, op + ' is for your AI agent; people change the expense itself.', 'not_permitted');
}

function linesReadResult(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  needAgent(ctx, 'claim-lines.read-result');
  const x = lineAndClaim(ctx, p);
  const line = x.line;
  const claim = x.claim;
  if (claim.getString('status') === 'cancelled') throw util.fail(409, 'The claim was cancelled; nothing to read.', 'conflict');
  const cur = currencyParam(p, 'currency', claim.getString('currency'));
  const amount = util.money(p, 'amount', cur, {});
  const tax = util.money(p, 'tax', cur, {});
  let cat = null;
  if (util.str(p, 'category', '') !== '') cat = E.categoryRef(app, claim.getString('entity'), util.str(p, 'category', ''), false);
  const flags = (util.list(p, 'flags') || []).map(String);
  for (const f of flags) if (E.AGENT_FLAGS.indexOf(f) < 0) throw util.fail(400, 'Unknown flag "' + f + '". Flags: ' + E.AGENT_FLAGS.join(', '), 'invalid_param', { param: 'flags' });
  const draft = claim.getString('status') === 'draft';
  const auto = draft && L('lib_settings').autoAllowed(app, 'expenses');
  const reading = {
    merchant: util.squash(util.text(p, 'merchant', 160, '')),
    day: util.day(p, 'day', ''),
    amount_minor: amount === null ? 0 : Math.max(0, amount),
    currency: cur,
    tax_minor: tax === null ? 0 : Math.max(0, tax),
    category: cat ? cat.id : '',
    category_code: cat ? cat.getString('code') : '',
    category_name: cat ? cat.getString('name') : '',
    description: util.text(p, 'description', 1000, ''),
    confidence: util.oneOf(p, 'confidence', ['high', 'medium', 'low'], 'medium'),
    flags: flags,
    note: util.text(p, 'note', 1000, ''),
    read_at: util.nowIso(),
    state: draft ? (auto ? 'applied' : 'proposed') : 'late',
    applied: [],
  };
  if (reading.tax_minor > reading.amount_minor && reading.amount_minor > 0) throw util.fail(400, 'The tax is more than the total.', 'invalid_param', { param: 'tax' });
  const oldDay = line.getString('day');
  if (auto) reading.applied = applyReading(app, line, claim, reading, E.READING_FIELDS, util.jsonOf(line, 'edited', []) || []);
  const af = util.jsonOf(line, 'agent_flags', []) || [];
  for (const f of flags) if (!af.some((x2) => x2.code === f)) af.push({ code: f, note: reading.note, at: reading.read_at, by: 'agent' });
  line.set('agent_flags', af);
  line.set('agent_read', reading);
  line.set('receipt_status', 'read');
  const catNow = line.getString('category') !== '' ? util.byId(app, 'expense_categories', line.getString('category')) : null;
  if (draft) price(app, line, claim, catNow, { rateChanged: reading.applied.length > 0 });
  app.save(line);
  const c = draft ? afterLine(app, line, claim, [oldDay, line.getString('day')]) : E.refreshClaim(app, claim);
  if (!draft) E.reflag(app, app.findRecordById('claim_lines', line.id), claim, {});
  E.settleReceipts(app, claim.id, 'done');
  if (draft) {
    const what = (reading.amount_minor > 0 ? E.fmt(reading.amount_minor, reading.currency) : 'the receipt') + (reading.merchant !== '' ? ' at ' + reading.merchant : '');
    L('lib_notify').toEmployee(app, claim.getString('employee'), { kind: 'expenses', title: 'Your AI agent read your receipt', body: (auto ? 'Filled in ' : 'Suggested ') + what + '. Check it and submit ' + claim.getString('number') + '.', link: '#/expenses/claims/' + claim.id, email: false });
  }
  L('lib_audit').note(ctx, { collection: 'claims', record: claim.id, summary: 'Your AI agent read a receipt on ' + claim.getString('number') + (reading.merchant !== '' ? ' (' + reading.merchant + ')' : '') + (auto ? ': filled in' : draft ? ': waiting for the person to check' : ': after it was submitted, not applied'), after: { amount_minor: reading.amount_minor, currency: reading.currency, day: reading.day } });
  return { line: E.lineView(app, app.findRecordById('claim_lines', line.id)), claim: E.claimView(app, c), state: reading.state, applied: reading.applied };
}

function linesReadFailed(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  needAgent(ctx, 'claim-lines.read-failed');
  const x = lineAndClaim(ctx, p);
  const code = util.oneOf(p, 'code', ['not_a_receipt', 'unreadable', 'no_total', 'other'], 'unreadable');
  const reason = util.text(p, 'reason', 600, '') || 'Your AI agent could not read this receipt.';
  const reading = Object.assign({}, util.jsonOf(x.line, 'agent_read', {}) || {}, { state: 'failed', code: code, reason: reason, read_at: util.nowIso() });
  x.line.set('agent_read', reading);
  x.line.set('receipt_status', 'failed');
  if (code === 'not_a_receipt') {
    const af = util.jsonOf(x.line, 'agent_flags', []) || [];
    if (!af.some((f) => f.code === 'not_a_receipt')) af.push({ code: 'not_a_receipt', note: reason, at: reading.read_at, by: 'agent' });
    x.line.set('agent_flags', af);
  }
  app.save(x.line);
  E.reflag(app, x.line, x.claim, {});
  E.refreshClaim(app, x.claim);
  E.settleReceipts(app, x.claim.id, 'done');
  if (x.claim.getString('status') === 'draft') L('lib_notify').toEmployee(app, x.claim.getString('employee'), { kind: 'expenses', title: 'Your AI agent could not read a receipt', body: reason + ' Type the amount in on ' + x.claim.getString('number') + '.', link: '#/expenses/claims/' + x.claim.id, email: false });
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: 'Your AI agent could not read a receipt on ' + x.claim.getString('number') + ': ' + util.clip(reason, 160) });
  return { line: E.lineView(app, app.findRecordById('claim_lines', x.line.id)) };
}

function linesAcceptReading(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  E.needWrite(ctx, x.claim);
  needDraft(x.claim);
  const reading = util.jsonOf(x.line, 'agent_read', {}) || {};
  if (reading.state !== 'proposed' && reading.state !== 'applied') throw util.fail(409, 'There is no reading of your AI agent to use on this expense.', 'no_reading');
  const fields = (util.list(p, 'fields') || E.READING_FIELDS).map(String);
  for (const f of fields) if (E.READING_FIELDS.indexOf(f) < 0) throw util.fail(400, 'Unknown field ' + f + '. Fields: ' + E.READING_FIELDS.join(', '), 'invalid_param', { param: 'fields' });
  const oldDay = x.line.getString('day');
  const applied = applyReading(app, x.line, x.claim, reading, fields, []);
  reading.state = 'accepted';
  reading.applied = applied;
  x.line.set('agent_read', reading);
  addEdited(x.line, applied);
  const cat = x.line.getString('category') !== '' ? util.byId(app, 'expense_categories', x.line.getString('category')) : null;
  price(app, x.line, x.claim, cat, { rateChanged: true });
  app.save(x.line);
  const c = afterLine(app, x.line, x.claim, [oldDay, x.line.getString('day')]);
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: "Used your AI agent's reading of a receipt on " + x.claim.getString('number') });
  return { line: E.lineView(app, app.findRecordById('claim_lines', x.line.id)), claim: E.claimView(app, c), applied: applied };
}

function linesDismissReading(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  E.needWrite(ctx, x.claim);
  needDraft(x.claim);
  const reading = util.jsonOf(x.line, 'agent_read', {}) || {};
  if (reading.state !== 'proposed') throw util.fail(409, 'There is no suggestion of your AI agent waiting on this expense.', 'no_reading');
  reading.state = 'dismissed';
  x.line.set('agent_read', reading);
  app.save(x.line);
  E.reflag(app, x.line, x.claim, {});
  const c = E.refreshClaim(app, x.claim);
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: "Dismissed your AI agent's reading of a receipt on " + x.claim.getString('number') });
  return { line: E.lineView(app, app.findRecordById('claim_lines', x.line.id)), claim: E.claimView(app, c) };
}

function linesFlag(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  if (!ctx.isAgent && !E.isAdminFor(ctx, x.claim.getString('entity'), 'edit')) throw util.fail(403, 'Your AI agent and HR with expenses edit access flag expenses.', 'not_permitted');
  if (x.claim.getString('status') === 'cancelled') throw util.fail(409, 'The claim was cancelled.', 'conflict');
  const code = util.oneOf(p, 'code', E.AGENT_FLAGS, '');
  if (code === '') throw util.fail(400, 'code is one of ' + E.AGENT_FLAGS.join(', '), 'missing_param', { param: 'code' });
  const note = util.text(p, 'note', 600, '');
  const af = util.jsonOf(x.line, 'agent_flags', []) || [];
  const have = af.filter((f) => f.code === code)[0];
  if (have !== undefined && have.cleared) return { line: E.lineView(app, x.line), message: 'A person already cleared this flag (' + (have.cleared_note || 'no note') + '); it stays cleared.' };
  if (have !== undefined) {
    have.note = note || have.note;
    have.at = util.nowIso();
  } else af.push({ code: code, note: note, at: util.nowIso(), by: ctx.isAgent ? 'agent' : ctx.memberId });
  x.line.set('agent_flags', af);
  app.save(x.line);
  E.reflag(app, x.line, x.claim, {});
  const c = E.refreshClaim(app, x.claim);
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: (ctx.isAgent ? 'Your AI agent flagged' : 'Flagged') + ' an expense on ' + x.claim.getString('number') + ': ' + code.replace(/_/g, ' ') + (note !== '' ? ' (' + util.clip(note, 160) + ')' : '') });
  return { line: E.lineView(app, app.findRecordById('claim_lines', x.line.id)), claim: E.claimView(app, c) };
}

function linesClearFlag(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const x = lineAndClaim(ctx, p);
  const a = pendingApproval(app, x.claim);
  const approver = a !== null && L('lib_approvals').standing(ctx, a) !== '';
  if (!approver && !E.isAdminFor(ctx, x.claim.getString('entity'), 'edit')) throw util.fail(403, 'An approver of this claim or HR with expenses edit access clears flags.', 'not_permitted');
  const code = util.oneOf(p, 'code', E.AGENT_FLAGS, '');
  const af = util.jsonOf(x.line, 'agent_flags', []) || [];
  const have = af.filter((f) => f.code === code && !f.cleared)[0];
  if (have === undefined) throw util.fail(404, 'This expense has no open flag ' + code + '.', 'not_found');
  have.cleared = true;
  have.cleared_by = ctx.memberId;
  have.cleared_by_name = ctx.name;
  have.cleared_at = util.nowIso();
  have.cleared_note = util.text(p, 'note', 600, '');
  x.line.set('agent_flags', af);
  app.save(x.line);
  E.reflag(app, x.line, x.claim, {});
  const c = E.refreshClaim(app, x.claim);
  L('lib_audit').note(ctx, { collection: 'claims', record: x.claim.id, summary: 'Cleared the flag ' + code.replace(/_/g, ' ') + ' on ' + x.claim.getString('number') + (have.cleared_note !== '' ? ' (' + util.clip(have.cleared_note, 160) + ')' : '') });
  return { line: E.lineView(app, app.findRecordById('claim_lines', x.line.id)), claim: E.claimView(app, c) };
}

/** agent.retry on receipt_review: the claim's owner (or expenses edit) asks again, while it is a draft. */
function mayAskReceipts(ctx, claim) {
  X().needWrite(ctx, claim);
  needDraft(claim);
}

function linesWaiting(ctx, p) {
  const util = u();
  const E = X();
  const auth = L('lib_auth');
  const app = ctx.app;
  if (!ctx.isAgent && !auth.can(ctx, 'expenses', 'view')) throw util.fail(403, 'Your role cannot see the receipts of other people.', 'not_permitted');
  const sc = auth.scope(ctx);
  const bind = {};
  let scope = sc.length > 0 ? ' AND l.entity IN (' + sc.map((x, i) => ((bind['s' + i] = x), '{:s' + i + '}')).join(',') + ')' : '';
  if (util.str(p, 'claim', '') !== '') {
    bind.claim = E.claimRef(app, util.str(p, 'claim', '')).id;
    scope += ' AND l.claim = {:claim}';
  }
  const rows = util.rows(app, "SELECT l.id AS id FROM claim_lines l JOIN claims c ON c.id = l.claim WHERE l.receipt_status IN ('waiting', 'reading') AND c.status = 'draft'" + scope + ' ORDER BY l.created LIMIT ' + util.int(p, 'limit', 50, 1, 200), { id: '' }, bind);
  const nm = E.names(app);
  return {
    lines: rows.map((r) => {
      const l = app.findRecordById('claim_lines', r.id);
      const c = app.findRecordById('claims', l.getString('claim'));
      return { line: l.id, claim: c.id, claim_number: c.getString('number'), employee_name: nm.employee(c.getString('employee')), entity: c.getString('entity'), entity_name: nm.entity(c.getString('entity')), currency: c.getString('currency'), day: l.getString('day'), receipt_status: l.getString('receipt_status'), created: l.getString('created') };
    }),
    total: util.count(app, "SELECT COUNT(*) AS n FROM claim_lines l JOIN claims c ON c.id = l.claim WHERE l.receipt_status IN ('waiting', 'reading') AND c.status = 'draft'" + scope, bind),
  };
}

module.exports = {
  mayAskReceipts: mayAskReceipts,
  claimsList: claimsList,
  claimsGet: claimsGet,
  claimsCreate: claimsCreate,
  claimsUpdate: claimsUpdate,
  claimsSubmit: claimsSubmit,
  claimsWithdraw: claimsWithdraw,
  claimsReopen: claimsReopen,
  claimsCancel: claimsCancel,
  claimsDelete: claimsDelete,
  claimsRejectLines: claimsRejectLines,
  claimsMarkPaid: claimsMarkPaid,
  claimsSetPayment: claimsSetPayment,
  claimsExport: claimsExport,
  linesAdd: linesAdd,
  linesUpdate: linesUpdate,
  linesDelete: linesDelete,
  linesReceipt: linesReceipt,
  linesReadAgain: linesReadAgain,
  linesReadResult: linesReadResult,
  linesReadFailed: linesReadFailed,
  linesAcceptReading: linesAcceptReading,
  linesDismissReading: linesDismissReading,
  linesFlag: linesFlag,
  linesClearFlag: linesClearFlag,
  linesWaiting: linesWaiting,
  openDraft: openDraft,
  approvalsOf: approvalsOf,
  pendingApproval: pendingApproval,
};
