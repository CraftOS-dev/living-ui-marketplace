/// <reference path="../pb_data/types.d.ts" />
/**
 * Employee advances and travel requests (operations advances.* and travel.*).
 *
 * Advance: requested -> approved (approval kind `advance`) -> paid (finance
 * marks it paid with a reference, or payroll pays it out at lock) -> settled
 * (later claims use it up, the person pays back the rest, or payroll
 * recovers it through advanceRecovery). Its balance is the amount paid
 * less its settlements (advance_settlements), never typed in.
 *
 * Travel: draft -> requested (approval kind `travel`) -> approved; claims
 * made on the trip link to it, so the trip shows what was spent against its
 * estimate.
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

const MODES = ['flight', 'train', 'car', 'bus', 'boat', 'other'];

function actorOf(ctx) {
  return ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system';
}

/** The where clause of a list: mine, my team, or everything the caller may see. */
function scopeWhere(ctx, p, alias) {
  const util = u();
  const E = X();
  const auth = L('lib_auth');
  const bind = {};
  const where = [];
  const admin = ctx.isAgent || auth.can(ctx, 'expenses', 'view');
  const view = util.oneOf(p, 'view', ['mine', 'team', 'all'], admin ? 'all' : ctx.teamScope ? 'team' : 'mine');
  const keys = (ids, prefix) => ids.map((x, i) => ((bind[prefix + i] = x), '{:' + prefix + i + '}')).join(',');
  if (view === 'all') {
    if (!admin) throw util.fail(403, 'Your role cannot see everyone (needs view access to Expenses). Use --view mine or --view team.', 'not_permitted');
    const sc = auth.scope(ctx);
    if (sc.length > 0) where.push(alias + '.entity IN (' + keys(sc, 's') + ')');
  } else if (view === 'team') {
    const ids = E.teamEmployments(ctx);
    where.push(ids.length === 0 ? '1 = 0' : alias + '.employment IN (' + keys(ids, 'r') + ')');
  } else {
    where.push(ctx.employeeId === '' ? '1 = 0' : alias + '.employee = {:self}');
    bind.self = ctx.employeeId;
  }
  if (util.str(p, 'entity', '') !== '') {
    where.push(alias + '.entity = {:ent}');
    bind.ent = L('lib_org').entityRef(ctx.app, util.str(p, 'entity', '')).id;
  }
  if (util.str(p, 'employee', '') !== '') {
    where.push(alias + '.employee = {:emp}');
    bind.emp = L('lib_people').employeeRef(ctx.app, util.str(p, 'employee', '')).id;
  }
  return { where: where, bind: bind, view: view };
}

function pendingApproval(app, rec) {
  const id = rec.getString('approval');
  if (id === '') return null;
  const a = u().byId(app, 'approvals', id);
  return a !== null && a.getString('status') === 'pending' ? a : null;
}

/* ----------------------------------------------------------- advances */

function advancesList(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const s = scopeWhere(ctx, p, 'a');
  const status = util.oneOf(p, 'status', ['open', 'requested', 'approved', 'paid', 'settled', 'rejected', 'cancelled', 'any'], 'open');
  if (status === 'open') s.where.push("a.status IN ('requested', 'approved', 'paid')");
  else if (status !== 'any') {
    s.where.push('a.status = {:st}');
    s.bind.st = status;
  }
  const w = s.where.length > 0 ? s.where.join(' AND ') : '1 = 1';
  const pg = util.page(p, 50, 500);
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM advances a WHERE ' + w, s.bind);
  const ids = util.rows(app, 'SELECT a.id AS id FROM advances a WHERE ' + w + ' ORDER BY a.updated DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, s.bind);
  const totals = util.rows(app, "SELECT a.currency AS currency, CAST(COALESCE(SUM(CASE WHEN a.status = 'paid' THEN a.balance_minor ELSE 0 END), 0) AS INTEGER) AS outstanding_minor, CAST(COALESCE(SUM(CASE WHEN a.status = 'approved' THEN a.amount_minor ELSE 0 END), 0) AS INTEGER) AS to_pay_minor FROM advances a WHERE " + w + ' GROUP BY a.currency ORDER BY a.currency', { currency: '', outstanding_minor: 0, to_pay_minor: 0 }, s.bind);
  const nm = E.names(app);
  return { advances: ids.map((r) => E.advanceView(app, app.findRecordById('advances', r.id), nm)), total: total, totals: totals, view: s.view, status: status };
}

function advancesGet(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const a = E.advanceRef(app, util.req(p, 'advance'));
  const access = E.needSee(ctx, a, 'advance');
  const nm = E.names(app);
  const v = E.advanceView(app, a, nm);
  v.settlements = util.findMany(app, 'advance_settlements', 'advance = {:a}', 'created', 200, { a: a.id }).map((s) => ({ id: s.id, kind: s.getString('kind'), claim: s.getString('claim'), claim_number: s.getString('claim') !== '' ? (util.byId(app, 'claims', s.getString('claim')) || { getString: () => '' }).getString('number') : '', amount_minor: s.getInt('amount_minor'), day: s.getString('day'), payrun: s.getString('payrun'), reference: s.getString('reference'), note: s.getString('note'), by_name: s.getString('actor') === 'agent' ? 'Your AI agent' : nm.member(s.getString('by')), created: s.getString('created') }));
  v.approvals = L('lib_expenses_claims').approvalsOf(app, 'advances', a.id);
  const pending = pendingApproval(app, a);
  const standing = pending !== null ? L('lib_approvals').standing(ctx, pending) : '';
  const full = !ctx.isAgent && E.isAdminFor(ctx, a.getString('entity'), 'full');
  const status = a.getString('status');
  v.access = access;
  v.pending_approval = pending !== null ? L('lib_approvals').view(app, pending) : null;
  v.can = {
    decide: standing !== '',
    cancel: !ctx.isAgent && (status === 'requested' ? pending !== null && (pending.getString('requester') === ctx.memberId || full) : status === 'approved' && (E.isOwn(ctx, a.getString('employee')) || full)),
    mark_paid: status === 'approved' && full,
    settle: status === 'paid' && full,
    update: (status === 'approved' || status === 'paid') && full,
  };
  v.history = L('lib_audit').forRecord(app, 'advances', a.id, 30).map((h) => ({ at: h.at, who: h.who, actor: h.actor, summary: h.summary }));
  return { advance: v };
}

function advancesRequest(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const m = E.employmentFor(ctx, p);
  const ent = E.entityInfo(app, m.getString('entity'));
  const pol = E.policyOf(app, ent.id);
  const admin = E.isAdminFor(ctx, ent.id, 'edit');
  const amount = util.money(p, 'amount', ent.currency, { required: true, positive: true });
  const purpose = util.squash(util.text(p, 'purpose', 600, ''));
  if (purpose === '') throw util.fail(400, 'Say what the advance is for.', 'missing_param', { param: 'purpose' });
  let travel = null;
  if (util.str(p, 'travel', '') !== '') {
    travel = E.travelRef(app, util.str(p, 'travel', ''));
    if (travel.getString('employment') !== m.id) throw util.fail(400, 'Trip ' + travel.getString('number') + ' belongs to someone else.', 'invalid_param', { param: 'travel' });
    if (['requested', 'approved'].indexOf(travel.getString('status')) < 0) throw util.fail(400, 'Trip ' + travel.getString('number') + ' is ' + travel.getString('status') + '.', 'invalid_param', { param: 'travel' });
  }
  for (const k of ['pay_via', 'recover_via']) if (util.has(p, k) && !admin) throw util.fail(403, 'HR or finance chooses how an advance is paid and recovered.', 'not_permitted', { param: k });
  const today = util.today(app, ent.id);
  const neededBy = util.day(p, 'needed_by', '');
  const base = travel !== null ? travel.getString('to_day') : neededBy !== '' ? neededBy : today;
  const recoverFrom = util.day(p, 'recover_from', util.dayAdd(base, pol.recover_after_days));
  const name = E.names(app).employee(m.getString('employee'));
  let id = '';
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const r = util.newRecord(tx, 'advances');
    r.set('number', E.nextNumber(tx, 'expense_advance', 'ADV'));
    r.set('employment', m.id);
    r.set('employee', m.getString('employee'));
    r.set('entity', ent.id);
    r.set('travel', travel !== null ? travel.id : '');
    r.set('purpose', purpose);
    r.set('currency', ent.currency);
    r.set('amount_minor', amount);
    r.set('balance_minor', 0);
    r.set('status', 'requested');
    r.set('pay_via', util.oneOf(p, 'pay_via', ['payroll', 'bank'], pol.advance_pay_via));
    r.set('recover_via', util.oneOf(p, 'recover_via', ['payroll', 'claim'], pol.advance_recover_via));
    r.set('recover_from', recoverFrom);
    r.set('needed_by', neededBy);
    r.set('requested_by', ctx.memberId || '');
    r.set('actor', actorOf(ctx));
    r.set('note', util.text(p, 'note', 2000, ''));
    tx.save(r);
    id = r.id;
    const view = L('lib_approvals').open(t, {
      kind: 'advance',
      ref_collection: 'advances',
      ref_id: r.id,
      employment: m.id,
      entity: ent.id,
      summary: 'Advance ' + r.getString('number') + ' for ' + name + ': ' + util.clip(purpose, 120),
      amount_minor: amount,
      currency: ent.currency,
      facts: [{ type: 'text', key: 'purpose', label: 'For', value: util.clip(purpose, 120) }, { type: 'money', key: 'amount', label: 'Advance', amount_minor: amount, currency: ent.currency }].concat(neededBy !== '' ? [{ type: 'day', key: 'needed_by', label: 'Needed by', value: neededBy }] : []),
      payload: { advance: r.id, number: r.getString('number'), purpose: purpose, travel: travel !== null ? travel.getString('number') : '', needed_by: neededBy, pay_via: r.getString('pay_via') },
      due: neededBy,
    });
    const r2 = tx.findRecordById('advances', r.id);
    r2.set('approval', view.id);
    tx.save(r2);
    L('lib_audit').write(t, { op: 'advances.request', collection: 'advances', record: r.id, summary: 'Asked for advance ' + r.getString('number') + ': ' + util.clip(purpose, 120), after: { amount_minor: amount, currency: ent.currency } });
  });
  ctx.audited = true;
  return { advance: E.advanceView(app, app.findRecordById('advances', id)) };
}

function advancesCancel(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const a = E.advanceRef(app, util.req(p, 'advance'));
  E.needSee(ctx, a, 'advance');
  const note = util.text(p, 'note', 1000, '');
  if (a.getString('status') === 'requested') {
    const ap = pendingApproval(app, a);
    if (ap === null) throw util.fail(409, 'This advance has no approval waiting.', 'conflict');
    L('lib_approvals').cancel(ctx, ap.id, note || 'Cancelled');
  } else if (a.getString('status') === 'approved') {
    if (!E.isOwn(ctx, a.getString('employee')) && !E.isAdminFor(ctx, a.getString('entity'), 'full')) throw util.fail(403, 'Only the person (or finance) can cancel this advance.', 'not_permitted');
    a.set('status', 'cancelled');
    a.set('decided_note', note);
    app.save(a);
    L('lib_audit').note(ctx, { collection: 'advances', record: a.id, summary: 'Cancelled advance ' + a.getString('number') + ' before it was paid' });
  } else throw util.fail(409, 'Advance ' + a.getString('number') + ' is ' + a.getString('status') + '; only a requested or approved advance can be cancelled.', 'conflict');
  return { advance: E.advanceView(app, app.findRecordById('advances', a.id)) };
}

function advancesMarkPaid(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const a = E.advanceRef(app, util.req(p, 'advance'));
  if (!E.isAdminFor(ctx, a.getString('entity'), 'full')) throw util.fail(403, 'Finance pays advances.', 'not_permitted');
  if (a.getString('status') !== 'approved') throw util.fail(409, 'Advance ' + a.getString('number') + ' is ' + a.getString('status') + '; only an approved advance can be paid.', 'not_approved');
  const reference = util.text(p, 'reference', 120, '');
  if (reference === '') throw util.fail(400, 'Give the payment reference (the bank transfer id).', 'missing_param', { param: 'reference' });
  a.set('status', 'paid');
  a.set('pay_via', 'bank');
  a.set('balance_minor', a.getInt('amount_minor'));
  a.set('paid_reference', reference);
  a.set('paid_by', ctx.memberId);
  a.set('paid_at', util.nowIso());
  a.set('paid_day', util.day(p, 'day', util.today(app, a.getString('entity'))));
  app.save(a);
  L('lib_notify').toEmployee(app, a.getString('employee'), { kind: 'expenses', title: 'Paid: advance ' + a.getString('number'), body: E.fmt(a.getInt('amount_minor'), a.getString('currency')) + ', reference ' + reference, link: '#/expenses/advances/' + a.id, email: false, facts: [{ type: 'state', key: 'status', value: 'paid' }, { type: 'money', key: 'amount', label: 'Paid', amount_minor: a.getInt('amount_minor'), currency: a.getString('currency') }, { type: 'day', key: 'paid_day', label: 'Paid on', value: a.getString('paid_day') }, { type: 'text', key: 'reference', label: 'Reference', value: reference }] });
  L('lib_audit').note(ctx, { collection: 'advances', record: a.id, summary: 'Marked advance ' + a.getString('number') + ' paid (reference ' + reference + ')', after: { amount_minor: a.getInt('amount_minor'), currency: a.getString('currency'), reference: reference } });
  return { advance: E.advanceView(app, a) };
}

function advancesSettle(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const a0 = E.advanceRef(app, util.req(p, 'advance'));
  if (!E.isAdminFor(ctx, a0.getString('entity'), 'full')) throw util.fail(403, 'Finance settles advances.', 'not_permitted');
  if (a0.getString('status') !== 'paid') throw util.fail(409, 'Advance ' + a0.getString('number') + ' is ' + a0.getString('status') + '; only a paid advance with a balance can be settled.', 'conflict');
  const kind = util.oneOf(p, 'kind', ['repayment', 'claim'], 'repayment');
  const cur = a0.getString('currency');
  let amount = util.money(p, 'amount', cur, { positive: true });
  let claim = null;
  if (kind === 'claim') {
    claim = E.claimRef(app, util.req(p, 'claim', 'EXP-0001'));
    if (claim.getString('employment') !== a0.getString('employment') || claim.getString('currency') !== cur) throw util.fail(400, claim.getString('number') + ' is not a claim of the same person in ' + cur + '.', 'invalid_param', { param: 'claim' });
    if (claim.getString('status') !== 'approved') throw util.fail(409, claim.getString('number') + ' is ' + claim.getString('status') + '; settle against an approved claim that is not paid yet.', 'conflict');
    const payable = claim.getInt('approved_minor') - claim.getInt('advance_applied_minor');
    if (amount === null) amount = Math.min(payable, a0.getInt('balance_minor'));
    if (amount > payable) throw util.fail(400, 'Only ' + E.fmt(payable, cur) + ' of ' + claim.getString('number') + ' is left to pay.', 'invalid_amount', { param: 'amount' });
  }
  if (amount === null) amount = a0.getInt('balance_minor');
  if (amount > a0.getInt('balance_minor')) throw util.fail(400, 'Only ' + E.fmt(a0.getInt('balance_minor'), cur) + ' is left on ' + a0.getString('number') + '.', 'invalid_amount', { param: 'amount' });
  const reference = util.text(p, 'reference', 120, '');
  if (kind === 'repayment' && reference === '') throw util.fail(400, 'Give the reference of the repayment (the transfer or receipt id).', 'missing_param', { param: 'reference' });
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const a = tx.findRecordById('advances', a0.id);
    const s = util.newRecord(tx, 'advance_settlements');
    s.set('advance', a.id);
    s.set('claim', claim !== null ? claim.id : '');
    s.set('kind', kind);
    s.set('amount_minor', amount);
    s.set('day', util.day(p, 'day', util.today(tx, a.getString('entity'))));
    s.set('reference', reference);
    s.set('note', util.text(p, 'note', 1000, ''));
    s.set('by', ctx.memberId);
    s.set('actor', 'person');
    tx.save(s);
    a.set('balance_minor', a.getInt('balance_minor') - amount);
    if (a.getInt('balance_minor') === 0) a.set('status', 'settled');
    tx.save(a);
    if (claim !== null) {
      const c = tx.findRecordById('claims', claim.id);
      c.set('advance_applied_minor', c.getInt('advance_applied_minor') + amount);
      if (c.getString('advance') === '') c.set('advance', a.id);
      if (c.getInt('approved_minor') - c.getInt('advance_applied_minor') <= 0) {
        c.set('status', 'paid');
        c.set('paid_via', 'advance');
        c.set('paid_reference', 'Settled against advance ' + a.getString('number'));
        c.set('paid_at', util.nowIso());
        c.set('paid_day', s.getString('day'));
        c.set('paid_by', ctx.memberId);
      }
      tx.save(c);
    }
    L('lib_audit').write(t, { op: 'advances.settle', collection: 'advances', record: a.id, summary: 'Settled part of advance ' + a.getString('number') + (kind === 'claim' ? ' against ' + claim.getString('number') : ' (paid back, reference ' + reference + ')'), after: { amount_minor: amount, currency: cur } });
  });
  ctx.audited = true;
  return { advance: E.advanceView(app, app.findRecordById('advances', a0.id)) };
}

function advancesUpdate(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const a = E.advanceRef(app, util.req(p, 'advance'));
  if (!E.isAdminFor(ctx, a.getString('entity'), 'full')) throw util.fail(403, 'Finance changes how an advance is paid and recovered.', 'not_permitted');
  if (['approved', 'paid', 'requested'].indexOf(a.getString('status')) < 0) throw util.fail(409, 'Advance ' + a.getString('number') + ' is ' + a.getString('status') + '.', 'conflict');
  const before = E.advanceView(app, a);
  if (util.has(p, 'pay_via')) {
    if (a.getString('status') === 'paid') throw util.fail(409, 'This advance is paid already.', 'conflict', { param: 'pay_via' });
    a.set('pay_via', util.oneOf(p, 'pay_via', ['payroll', 'bank'], a.getString('pay_via')));
  }
  if (util.has(p, 'recover_via')) a.set('recover_via', util.oneOf(p, 'recover_via', ['payroll', 'claim'], a.getString('recover_via')));
  if (util.has(p, 'recover_from')) a.set('recover_from', util.day(p, 'recover_from', ''));
  if (util.has(p, 'note')) a.set('note', util.text(p, 'note', 2000, ''));
  app.save(a);
  const after = E.advanceView(app, a);
  L('lib_audit').note(ctx, { collection: 'advances', record: a.id, summary: 'Changed advance ' + a.getString('number'), before: before, after: after });
  return { advance: after };
}

/* ------------------------------------------------------------- travel */

function travelList(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const s = scopeWhere(ctx, p, 't');
  const status = util.oneOf(p, 'status', ['open', 'draft', 'requested', 'approved', 'rejected', 'cancelled', 'upcoming', 'any'], 'open');
  if (status === 'open') s.where.push("t.status IN ('draft', 'requested', 'approved')");
  else if (status === 'upcoming') {
    s.where.push("t.status IN ('requested', 'approved') AND t.to_day >= {:today}");
    s.bind.today = util.today(app);
  } else if (status !== 'any') {
    s.where.push('t.status = {:st}');
    s.bind.st = status;
  }
  if (s.view !== 'mine') s.where.push("t.status != 'draft'");
  const w = s.where.join(' AND ');
  const pg = util.page(p, 50, 500);
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM travel_requests t WHERE ' + w, s.bind);
  const ids = util.rows(app, 'SELECT t.id AS id FROM travel_requests t WHERE ' + w + ' ORDER BY t.from_day DESC, t.created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, s.bind);
  const nm = E.names(app);
  return { trips: ids.map((r) => withSpend(app, E.travelView(app, app.findRecordById('travel_requests', r.id), nm))), total: total, view: s.view, status: status };
}

function withSpend(app, v) {
  const util = u();
  const r = util.one(app, "SELECT COUNT(*) AS n, CAST(COALESCE(SUM(CASE WHEN status IN ('approved', 'paid') THEN approved_minor ELSE total_minor END), 0) AS INTEGER) AS spent FROM claims WHERE travel = {:t} AND status IN ('submitted', 'approved', 'paid') AND currency = {:c}", { n: 0, spent: 0 }, { t: v.id, c: v.currency });
  v.claims = r === null ? 0 : r.n;
  v.spent_minor = r === null ? 0 : r.spent;
  return v;
}

function travelGet(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const t = E.travelRef(app, util.req(p, 'travel'));
  const access = E.needSee(ctx, t, 'trip');
  const nm = E.names(app);
  const v = withSpend(app, E.travelView(app, t, nm));
  v.claims_list = util.findMany(app, 'claims', "travel = {:t} && status != 'cancelled'", '-created', 100, { t: t.id }).map((c) => E.claimView(app, c, nm));
  v.advances = util.findMany(app, 'advances', 'travel = {:t}', '-created', 50, { t: t.id }).map((a) => E.advanceView(app, a, nm));
  v.approvals = L('lib_expenses_claims').approvalsOf(app, 'travel_requests', t.id);
  const pending = pendingApproval(app, t);
  const standing = pending !== null ? L('lib_approvals').standing(ctx, pending) : '';
  const write = E.canWriteFor(ctx, t);
  const status = t.getString('status');
  v.access = access;
  v.pending_approval = pending !== null ? L('lib_approvals').view(app, pending) : null;
  v.can = {
    edit: status === 'draft' && write,
    submit: status === 'draft' && write && !ctx.isAgent,
    decide: standing !== '',
    cancel: !ctx.isAgent && ['draft', 'requested', 'approved'].indexOf(status) >= 0 && (write || (pending !== null && pending.getString('requester') === ctx.memberId)),
    advance: !ctx.isAgent && (status === 'requested' || status === 'approved') && (E.isOwn(ctx, t.getString('employee')) || E.isAdminFor(ctx, t.getString('entity'), 'edit')),
    claim: (status === 'requested' || status === 'approved') && write,
  };
  v.categories = util.findMany(app, 'expense_categories', 'entity = {:e} && archived = false', 'sort,name', 0, { e: t.getString('entity') }).map(E.categoryView);
  v.history = L('lib_audit').forRecord(app, 'travel_requests', t.id, 30).map((h) => ({ at: h.at, who: h.who, actor: h.actor, summary: h.summary }));
  return { trip: v };
}

function readTrip(ctx, rec, p, entityId, currency) {
  const util = u();
  const app = ctx.app;
  if (util.has(p, 'purpose') || rec.getString('purpose') === '') rec.set('purpose', util.oneOf(p, 'purpose', X().TRAVEL_PURPOSES, rec.getString('purpose') || 'other'));
  if (util.has(p, 'details')) rec.set('details', util.text(p, 'details', 2000, ''));
  if (util.has(p, 'from_day')) rec.set('from_day', util.day(p, 'from_day', ''));
  if (util.has(p, 'to_day')) rec.set('to_day', util.day(p, 'to_day', ''));
  if (!util.isDay(rec.getString('from_day'))) throw util.fail(400, 'from_day is required (the first day of the trip).', 'missing_param', { param: 'from_day' });
  if (!util.isDay(rec.getString('to_day'))) rec.set('to_day', rec.getString('from_day'));
  if (rec.getString('to_day') < rec.getString('from_day')) throw util.fail(400, 'The trip ends before it starts.', 'invalid_param', { param: 'to_day' });
  if (util.daysBetween(rec.getString('from_day'), rec.getString('to_day')) > 366) throw util.fail(400, 'A trip is at most a year long.', 'invalid_param', { param: 'to_day' });
  if (util.has(p, 'destinations')) {
    const list = util.list(p, 'destinations') || [];
    if (list.length > 20) throw util.fail(400, 'At most 20 destinations.', 'invalid_param', { param: 'destinations' });
    rec.set(
      'destinations',
      list.map((d, i) => {
        if (typeof d === 'string') return { city: util.clip(util.squash(d), 80), country: '' };
        util.keysOnly(d, ['city', 'country'], 'destination ' + (i + 1));
        return { city: util.clip(util.squash(d.city || ''), 80), country: util.clip(String(d.country || '').toUpperCase(), 2) };
      }),
    );
  }
  if (util.has(p, 'itinerary')) {
    const list = util.list(p, 'itinerary') || [];
    if (list.length > 60) throw util.fail(400, 'At most 60 legs.', 'invalid_param', { param: 'itinerary' });
    rec.set(
      'itinerary',
      list.map((x, i) => {
        util.keysOnly(x, ['day', 'from', 'to', 'mode', 'note'], 'leg ' + (i + 1));
        const day = String(x.day || '');
        if (day !== '' && !util.isDay(day)) throw util.fail(400, 'leg ' + (i + 1) + ': day must be YYYY-MM-DD.', 'invalid_param', { param: 'itinerary' });
        const mode = String(x.mode || 'other');
        if (MODES.indexOf(mode) < 0) throw util.fail(400, 'leg ' + (i + 1) + ': mode is one of ' + MODES.join(', ') + '.', 'invalid_param', { param: 'itinerary' });
        return { day: day, from: util.clip(util.squash(x.from || ''), 80), to: util.clip(util.squash(x.to || ''), 80), mode: mode, note: util.clip(String(x.note || ''), 300) };
      }),
    );
  }
  if (util.has(p, 'costs')) {
    const list = util.list(p, 'costs') || [];
    if (list.length > 40) throw util.fail(400, 'At most 40 cost lines.', 'invalid_param', { param: 'costs' });
    let sum = 0;
    rec.set(
      'costs',
      list.map((x, i) => {
        util.keysOnly(x, ['category', 'amount', 'note'], 'cost ' + (i + 1));
        const cat = String(x.category || '') !== '' ? X().categoryRef(app, entityId, String(x.category), false) : null;
        const amount = util.money({ v: x.amount }, 'v', currency, { required: true });
        if (amount < 0) throw util.fail(400, 'cost ' + (i + 1) + ': the amount is negative.', 'invalid_amount', { param: 'costs' });
        sum += amount;
        return { category: cat ? cat.getString('code') : '', category_name: cat ? cat.getString('name') : '', amount_minor: amount, note: util.clip(String(x.note || ''), 300) };
      }),
    );
    rec.set('estimate_minor', sum);
  }
}

function travelSave(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const ref = util.str(p, 'travel', '');
  let rec;
  let before = null;
  if (ref !== '') {
    rec = E.travelRef(app, ref);
    E.needWrite(ctx, rec, 'trip');
    if (rec.getString('status') !== 'draft') throw util.fail(409, 'Trip ' + rec.getString('number') + ' is ' + rec.getString('status') + '; only a draft changes. Cancel it and ask again to change a requested trip.', 'not_draft');
    before = E.travelView(app, rec);
  } else {
    const m = E.employmentFor(ctx, p);
    const ent = E.entityInfo(app, m.getString('entity'));
    rec = util.newRecord(app, 'travel_requests');
    rec.set('number', E.nextNumber(app, 'expense_travel', 'TRV'));
    rec.set('employment', m.id);
    rec.set('employee', m.getString('employee'));
    rec.set('entity', ent.id);
    rec.set('currency', ent.currency);
    rec.set('status', 'draft');
    rec.set('destinations', []);
    rec.set('itinerary', []);
    rec.set('costs', []);
    rec.set('estimate_minor', 0);
    rec.set('created_by', ctx.memberId || '');
    rec.set('actor', actorOf(ctx));
  }
  readTrip(ctx, rec, p, rec.getString('entity'), rec.getString('currency'));
  app.save(rec);
  const after = E.travelView(app, rec);
  L('lib_audit').note(ctx, { collection: 'travel_requests', record: rec.id, summary: (before === null ? 'Started trip ' : 'Changed trip ') + rec.getString('number') + ': ' + E.travelLabel(rec), before: before, after: after });
  return { trip: after };
}

function travelSubmit(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const t0 = E.travelRef(app, util.req(p, 'travel'));
  E.needWrite(ctx, t0, 'trip');
  if (t0.getString('status') !== 'draft') throw util.fail(409, 'Trip ' + t0.getString('number') + ' is ' + t0.getString('status') + '.', 'not_draft');
  const dests = util.jsonOf(t0, 'destinations', []) || [];
  if (dests.length === 0) throw util.fail(400, 'Add where you are going first.', 'missing_param', { param: 'destinations' });
  const name = E.names(app).employee(t0.getString('employee'));
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const r = tx.findRecordById('travel_requests', t0.id);
    r.set('status', 'requested');
    r.set('submitted_at', util.nowIso());
    r.set('decided_at', '');
    r.set('decided_note', '');
    tx.save(r);
    const days = util.daysBetween(r.getString('from_day'), r.getString('to_day')) + 1;
    const view = L('lib_approvals').open(t, {
      kind: 'travel',
      ref_collection: 'travel_requests',
      ref_id: r.id,
      employment: r.getString('employment'),
      entity: r.getString('entity'),
      summary: 'Trip ' + r.getString('number') + ' for ' + name + ': ' + E.travelLabel(r),
      amount_minor: r.getInt('estimate_minor'),
      currency: r.getString('currency'),
      facts: [{ type: 'text', key: 'where', label: 'Trip', value: dests.map((d) => d.city || d.country || '').filter((x) => x !== '').join(', ') || r.getString('purpose') }, { type: 'range', key: 'dates', label: 'Dates', from: r.getString('from_day'), to: r.getString('to_day') }, { type: 'number', key: 'days', label: 'Days', value: days, unit: days === 1 ? 'day' : 'days' }].concat(r.getInt('estimate_minor') > 0 ? [{ type: 'money', key: 'estimate', label: 'Estimate', amount_minor: r.getInt('estimate_minor'), currency: r.getString('currency') }] : []),
      payload: { travel: r.id, number: r.getString('number'), purpose: r.getString('purpose'), from_day: r.getString('from_day'), to_day: r.getString('to_day'), destinations: dests, days: days },
      days: days,
      due: r.getString('from_day'),
    });
    const r2 = tx.findRecordById('travel_requests', r.id);
    r2.set('approval', view.id);
    tx.save(r2);
    L('lib_audit').write(t, { op: 'travel.submit', collection: 'travel_requests', record: r.id, summary: 'Asked for trip ' + r.getString('number') + ': ' + E.travelLabel(r) });
  });
  ctx.audited = true;
  return { trip: withSpend(app, E.travelView(app, app.findRecordById('travel_requests', t0.id))) };
}

function travelCancel(ctx, p) {
  const util = u();
  const E = X();
  const app = ctx.app;
  const t = E.travelRef(app, util.req(p, 'travel'));
  E.needSee(ctx, t, 'trip');
  const status = t.getString('status');
  const note = util.text(p, 'note', 1000, '');
  if (status === 'requested') {
    const ap = pendingApproval(app, t);
    if (ap === null) throw util.fail(409, 'This trip has no approval waiting.', 'conflict');
    L('lib_approvals').cancel(ctx, ap.id, note || 'Trip cancelled');
  } else if (status === 'draft' || status === 'approved') {
    E.needWrite(ctx, t, 'trip');
  } else throw util.fail(409, 'Trip ' + t.getString('number') + ' is ' + status + '.', 'conflict');
  const r = app.findRecordById('travel_requests', t.id);
  r.set('status', 'cancelled');
  if (note !== '') r.set('decided_note', note);
  app.save(r);
  if (status !== 'requested') L('lib_audit').note(ctx, { collection: 'travel_requests', record: t.id, summary: 'Cancelled trip ' + t.getString('number') });
  return { trip: E.travelView(app, r) };
}

module.exports = {
  MODES: MODES,
  advancesList: advancesList,
  advancesGet: advancesGet,
  advancesRequest: advancesRequest,
  advancesCancel: advancesCancel,
  advancesMarkPaid: advancesMarkPaid,
  advancesSettle: advancesSettle,
  advancesUpdate: advancesUpdate,
  travelList: travelList,
  travelGet: travelGet,
  travelSave: travelSave,
  travelSubmit: travelSubmit,
  travelCancel: travelCancel,
};
