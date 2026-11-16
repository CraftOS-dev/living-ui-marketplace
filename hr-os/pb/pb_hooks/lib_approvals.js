/// <reference path="../pb_data/types.d.ts" />
/**
 * Generic approvals with flows (SPEC 3.2).
 *
 *   open(ctx, { kind, ref_collection, ref_id, entity, employment, summary,
 *               amount_minor, currency, payload, needs_pin, days, facts })   -> approval view
 *       (facts: the days, amounts and states screens format, lib_util.facts shape;
 *        summary stays the plain text for the CLI)
 *   decide(ctx, approvalId, 'approved' | 'rejected', note, pin)          -> approval view
 *   cancel(ctx, approvalId, note)                                         -> approval view
 *   pendingFor(ctx)                                                       -> [approval view]
 *
 * A kind can be opened only when some module subscribes to it in the
 * `approvals` map of its events_<module>.js; on the final decision (and on
 * cancel) the kernel calls that subscriber as fn(ctx, approval, decision,
 * note) inside the same transaction (ctx.app is the transaction; throw to
 * refuse the decision).
 *
 * Flow: the approval_flows row for the kind that matches best (kind +
 * entity + department, kind + entity, kind + department, kind), else one
 * step: the manager. Steps: { type: 'manager' } | { type: 'manager_of_manager' }
 * | { type: 'department_approver' } | { type: 'role', role: '<code>' } |
 * { type: 'member', member: '<id>' }. A step nobody can take goes to the
 * administrators. auto: { max_amount_minor, currency, max_days } approves
 * at once when the request is within it.
 *
 * Nobody approves their own request or a request about themself, except
 * the only administrator of a company (logged in the audit trail). With
 * needs_pin (bank details, pay runs) approving needs the approver's PIN.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const STEP_TYPES = ['manager', 'manager_of_manager', 'department_approver', 'role', 'member'];

function view(app, r) {
  const util = u();
  const mn = (id) => {
    if (!id) return '';
    const m = util.byId(app, 'members', id);
    return m ? m.getString('name') : '';
  };
  const emp = r.getString('employment') !== '' ? util.byId(app, 'employments', r.getString('employment')) : null;
  const person = emp ? util.byId(app, 'employees', emp.getString('employee')) : null;
  return {
    id: r.id,
    kind: r.getString('kind'),
    ref_collection: r.getString('ref_collection'),
    ref_id: r.getString('ref_id'),
    entity: r.getString('entity'),
    employment: r.getString('employment'),
    employee: person ? person.id : '',
    employee_name: person ? L('lib_people').displayName(person) : '',
    requester: r.getString('requester'),
    requester_name: r.getString('requester_actor') === 'agent' ? 'Your AI agent' : mn(r.getString('requester')),
    requester_actor: r.getString('requester_actor'),
    steps: util.jsonOf(r, 'steps', []) || [],
    step: r.getInt('step'),
    approvers: util.jsonOf(r, 'approvers', []) || [],
    approver_names: (util.jsonOf(r, 'approvers', []) || []).map(mn),
    approver_role: r.getString('approver_role'),
    status: r.getString('status'),
    decided_by: r.getString('decided_by'),
    decided_by_name: mn(r.getString('decided_by')),
    decided_at: r.getString('decided_at'),
    note: r.getString('note'),
    summary: r.getString('summary'),
    amount_minor: r.getInt('amount_minor'),
    currency: r.getString('currency'),
    payload: util.jsonOf(r, 'payload', {}) || {},
    facts: factsOf(r),
    history: util.jsonOf(r, 'history', []) || [],
    needs_pin: r.getBool('needs_pin'),
    due: r.getString('due'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

/** The facts a screen shows (from open(); the amount when none were given). */
function factsOf(r) {
  const util = u();
  const f = util.jsonOf(r, 'facts', []) || [];
  if (f.length > 0) return f;
  return r.getInt('amount_minor') !== 0 && r.getString('currency') !== '' ? [{ type: 'money', key: 'amount', amount_minor: r.getInt('amount_minor'), currency: r.getString('currency') }] : [];
}

/** The flow for a kind: the best matching active approval_flows row, or one manager step. */
function flowFor(app, kind, entity, department) {
  const util = u();
  const rows = util.findMany(app, 'approval_flows', 'kind = {:k} && active = true', 'created', 0, { k: kind });
  let best = null;
  let bestScore = -1;
  for (const r of rows) {
    const e = r.getString('entity');
    const d = r.getString('department');
    if (e !== '' && e !== entity) continue;
    if (d !== '' && d !== department) continue;
    const score = (e !== '' ? 2 : 0) + (d !== '' ? 1 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (best === null) return { id: '', steps: [{ type: 'manager' }], auto: {} };
  return { id: best.id, steps: util.jsonOf(best, 'steps', []) || [{ type: 'manager' }], auto: util.jsonOf(best, 'auto', {}) || {} };
}

/** Members who are active administrators (admin edit or more). */
function admins(app) {
  const util = u();
  const auth = L('lib_auth');
  const out = [];
  for (const m of util.findMany(app, 'members', "status = 'active'", 'created')) {
    const role = util.byId(app, 'roles', m.getString('role'));
    if (role === null) continue;
    const lv = auth.levelsOfRole(role);
    if (role.getString('code') === 'owner' || auth.rank(lv.admin) >= auth.rank('edit')) out.push(m.id);
  }
  return out;
}

function memberOfEmployee(app, employeeId) {
  if (!employeeId) return '';
  const e = u().byId(app, 'employees', employeeId);
  if (e === null) return '';
  const mid = e.getString('member');
  if (mid === '') return '';
  const m = u().byId(app, 'members', mid);
  return m !== null && m.getString('status') === 'active' ? m.id : '';
}

/** Member ids who may take a step (before the self rules). */
function resolveStep(app, step, approvalRec) {
  const util = u();
  const people = L('lib_people');
  const employment = approvalRec.getString('employment');
  const day = util.today(app, approvalRec.getString('entity') || undefined);
  const type = step.type;
  if (type === 'manager' || type === 'manager_of_manager') {
    if (employment === '') return [];
    let mgr = people.managerOf(app, employment, day);
    if (type === 'manager_of_manager' && mgr !== null) {
      const me = people.primaryEmployment(app, mgr.id, day);
      mgr = me !== '' ? people.managerOf(app, me, day) : null;
    }
    const mid = mgr ? memberOfEmployee(app, mgr.id) : '';
    return mid !== '' ? [mid] : [];
  }
  if (type === 'department_approver') {
    if (employment === '') return [];
    const job = people.rowOn(app, 'job_records', employment, day);
    const dep = job !== null ? util.byId(app, 'departments', job.getString('department')) : null;
    if (dep === null) return [];
    const mid = memberOfEmployee(app, dep.getString('approver') || dep.getString('head'));
    return mid !== '' ? [mid] : [];
  }
  if (type === 'role') {
    const role = L('lib_auth').roleByCode(app, step.role);
    const owner = L('lib_auth').roleByCode(app, 'owner');
    const ids = [];
    for (const m of util.findMany(app, 'members', "status = 'active' && (role = {:r} || role = {:o})", 'created', 0, { r: role ? role.id : '-', o: owner.id })) {
      const ents = util.jsonOf(m, 'entities', []) || [];
      const ent = approvalRec.getString('entity');
      if (ent !== '' && ents.length > 0 && ents.indexOf(ent) < 0 && m.getString('role') !== owner.id) continue;
      ids.push(m.id);
    }
    return ids;
  }
  if (type === 'member') {
    const m = util.byId(app, 'members', step.member || '');
    return m !== null && m.getString('status') === 'active' ? [m.id] : [];
  }
  return [];
}

/** Who is excluded by the self rules: the requester and the person the request is about. */
function selfIds(app, r) {
  const out = [];
  if (r.getString('requester') !== '') out.push(r.getString('requester'));
  const emp = r.getString('employment') !== '' ? u().byId(app, 'employments', r.getString('employment')) : null;
  if (emp !== null) {
    const mid = memberOfEmployee(app, emp.getString('employee'));
    if (mid !== '') out.push(mid);
  }
  return out;
}

/**
 * Set the approvers of the current step (skipping steps nobody can take to
 * the administrators). Returns the member ids.
 */
function assign(app, r) {
  const steps = u().jsonOf(r, 'steps', []) || [];
  const step = steps[r.getInt('step')] || { type: 'manager' };
  const self = selfIds(app, r);
  let ids = resolveStep(app, step, r).filter((x) => self.indexOf(x) < 0);
  let role = step.type === 'role' ? step.role : '';
  if (ids.length === 0) {
    ids = admins(app).filter((x) => self.indexOf(x) < 0);
    role = 'admin';
  }
  if (ids.length === 0) {
    // The only administrator may approve their own request (logged at decision).
    ids = admins(app);
    role = 'sole_admin';
  }
  r.set('approvers', ids);
  r.set('approver_member', ids.length === 1 ? ids[0] : '');
  r.set('approver_role', role);
  return ids;
}

function handlerOf(kind) {
  const h = L('lib_events').approvalHandler(kind);
  if (h === null) throw u().fail(400, 'No module handles approvals of kind "' + kind + '". Kinds: ' + L('lib_events').approvalKinds().join(', '), 'unknown_kind', { kind: kind });
  return h;
}

function within(auto, amountMinor, currency, days) {
  if (!auto) return false;
  if (auto.max_amount_minor !== undefined && auto.max_amount_minor !== null && amountMinor > 0) {
    if (auto.currency && auto.currency !== currency) return false;
    return amountMinor <= Number(auto.max_amount_minor);
  }
  if (auto.max_days !== undefined && auto.max_days !== null && days !== undefined && days !== null) return Number(days) <= Number(auto.max_days);
  return false;
}

function notifyApprovers(app, r) {
  const ids = u().jsonOf(r, 'approvers', []) || [];
  if (ids.length === 0) return;
  L('lib_notify').notify(app, ids, { kind: 'approval', title: 'To approve: ' + r.getString('summary'), body: '', link: '#/inbox/approvals/' + r.id, facts: [{ type: 'text', key: 'kind', value: r.getString('kind') }].concat(factsOf(r)) });
}

/** Open an approval (inside the caller's transaction when there is one). */
function open(ctx, o) {
  const util = u();
  const app = ctx.app;
  const kind = String(o.kind || '');
  const h = handlerOf(kind);
  const r = util.newRecord(app, 'approvals');
  r.set('kind', kind);
  r.set('ref_collection', o.ref_collection || '');
  r.set('ref_id', o.ref_id || '');
  let entity = o.entity || '';
  let department = '';
  if (o.employment) {
    const emp = app.findRecordById('employments', o.employment);
    r.set('employment', emp.id);
    if (entity === '') entity = emp.getString('entity');
    const job = L('lib_people').rowOn(app, 'job_records', emp.id, util.today(app, emp.getString('entity')));
    department = job !== null ? job.getString('department') : '';
  }
  r.set('entity', entity);
  r.set('requester', ctx.memberId || '');
  r.set('requester_actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  r.set('summary', util.clip(o.summary || kind, 600));
  r.set('amount_minor', Math.round(Number(o.amount_minor) || 0));
  r.set('currency', o.currency || '');
  r.set('payload', o.payload || {});
  r.set('facts', util.facts(o.facts));
  r.set('needs_pin', o.needs_pin === true);
  r.set('due', o.due || '');
  const flow = flowFor(app, kind, entity, department);
  for (const s of flow.steps) if (STEP_TYPES.indexOf(s.type) < 0) throw util.fail(500, 'approval flow ' + flow.id + ' has an unknown step type ' + s.type);
  r.set('steps', flow.steps);
  r.set('step', 0);
  r.set('history', [{ at: util.nowIso(), event: 'opened', by: ctx.memberId || '', actor: ctx.isAgent ? 'agent' : ctx.actor || 'system' }]);
  r.set('status', 'pending');
  if (within(flow.auto, r.getInt('amount_minor'), r.getString('currency'), o.days) && !r.getBool('needs_pin')) {
    r.set('status', 'approved');
    r.set('decided_at', util.nowIso());
    r.set('note', 'Approved by rule (within the limits of the approval flow).');
    r.set('approvers', []);
    app.save(r);
    h.fn(Object.assign({}, ctx), view(app, r), 'approved', r.getString('note'));
    L('lib_audit').write(ctx, { op: 'approvals.auto', collection: 'approvals', record: r.id, summary: 'Approved by rule: ' + r.getString('summary') });
    return view(app, r);
  }
  assign(app, r);
  app.save(r);
  notifyApprovers(app, r);
  return view(app, r);
}

function ref(app, id) {
  const r = u().byId(app, 'approvals', String(id || ''));
  if (r === null) throw u().fail(404, 'No approval ' + id + '. Run approvals.list.', 'not_found');
  return r;
}

/** May ctx decide this approval now? Returns 'approver' | 'override' | '' . */
function standing(ctx, r) {
  if (ctx.isAgent || ctx.member === null) return '';
  const ids = u().jsonOf(r, 'approvers', []) || [];
  if (ids.indexOf(ctx.memberId) >= 0) return 'approver';
  const self = selfIds(ctx.app, r);
  if (self.indexOf(ctx.memberId) >= 0) return '';
  const module = moduleOf(r.getString('kind'));
  if (module !== '' && L('lib_auth').can(ctx, module, 'full') && L('lib_auth').inScope(ctx, r.getString('entity'))) return 'override';
  return '';
}

const KIND_MODULE = {
  leave_request: 'leave', leave_encash: 'leave', comp_off: 'leave',
  attendance_request: 'time', shift_request: 'time', timesheet: 'time', overtime: 'time',
  claim: 'expenses', advance: 'expenses', travel: 'expenses',
  pay_change: 'payroll', payrun: 'payroll', loan: 'payroll', tax_declaration: 'payroll', bank_account: 'payroll',
  requisition: 'hiring', offer: 'hiring', separation: 'people', review_signoff: 'performance',
};

function moduleOf(kind) {
  return KIND_MODULE[kind] || '';
}

function decide(ctx, approvalId, decision, note, pin) {
  const util = u();
  const app = ctx.app;
  if (decision !== 'approved' && decision !== 'rejected') throw util.fail(400, 'decision must be approved or rejected', 'invalid_param');
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent cannot approve or reject. ' + L('lib_auth').handOff('approvals.decide'), 'agent_not_permitted', { op: 'approvals.decide', route_with: 'inbox.route' });
  const r0 = ref(app, approvalId);
  if (r0.getString('status') !== 'pending') throw util.fail(409, 'This request is already ' + r0.getString('status') + '.', 'conflict');
  const how = standing(ctx, r0);
  if (how === '') throw util.fail(403, 'You are not an approver of this request.', 'not_permitted');
  if (decision === 'approved' && r0.getBool('needs_pin')) L('lib_auth').verifyPin(ctx, pin);
  const h = handlerOf(r0.getString('kind'));
  const selfDecision = selfIds(app, r0).indexOf(ctx.memberId) >= 0;
  let out = null;
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    const r = tx.findRecordById('approvals', r0.id);
    const hist = util.jsonOf(r, 'history', []) || [];
    hist.push({ at: util.nowIso(), event: decision, step: r.getInt('step'), by: ctx.memberId, as: how, note: util.clip(note || '', 1000) });
    r.set('history', hist);
    const steps = util.jsonOf(r, 'steps', []) || [];
    const last = r.getInt('step') >= steps.length - 1;
    if (decision === 'approved' && !last) {
      r.set('step', r.getInt('step') + 1);
      assign(tx, r);
      tx.save(r);
      notifyApprovers(tx, r);
    } else {
      r.set('status', decision);
      r.set('decided_by', ctx.memberId);
      r.set('decided_at', util.nowIso());
      r.set('note', util.clip(note || '', 2000));
      tx.save(r);
      h.fn(tctx, view(tx, r), decision, note || '');
      if (r.getString('requester') !== '' && r.getString('requester') !== ctx.memberId) L('lib_notify').notify(tx, [r.getString('requester')], { kind: 'approval', title: (decision === 'approved' ? 'Approved: ' : 'Not approved: ') + r.getString('summary'), body: note || '', link: '#/inbox/requests/' + r.id, facts: [{ type: 'state', key: 'status', value: decision }, { type: 'text', key: 'kind', value: r.getString('kind') }].concat(factsOf(r)) });
    }
    L('lib_audit').write(tctx, { op: 'approvals.decide', collection: 'approvals', record: r.id, summary: (decision === 'approved' ? 'Approved' : 'Rejected') + (how === 'override' ? ' as administrator' : '') + (selfDecision ? ' (self-approval as the only administrator)' : '') + ': ' + r.getString('summary') + (note ? ' (' + util.clip(note, 160) + ')' : '') });
    out = view(tx, r);
  });
  ctx.audited = true;
  return out;
}

function cancel(ctx, approvalId, note) {
  const util = u();
  const app = ctx.app;
  const r0 = ref(app, approvalId);
  if (r0.getString('status') !== 'pending') return view(app, r0);
  const mine = ctx.memberId !== '' && r0.getString('requester') === ctx.memberId;
  const module = moduleOf(r0.getString('kind'));
  if (!mine && !(module !== '' && L('lib_auth').can(ctx, module, 'full')) && ctx.actor !== 'system') throw util.fail(403, 'Only the person who asked (or an administrator) can cancel this request.', 'not_permitted');
  const h = handlerOf(r0.getString('kind'));
  const run = (tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    const r = tx.findRecordById('approvals', r0.id);
    const hist = util.jsonOf(r, 'history', []) || [];
    hist.push({ at: util.nowIso(), event: 'cancelled', by: ctx.memberId || '', note: util.clip(note || '', 1000) });
    r.set('history', hist);
    r.set('status', 'cancelled');
    r.set('decided_at', util.nowIso());
    r.set('note', util.clip(note || '', 2000));
    tx.save(r);
    h.fn(tctx, view(tx, r), 'cancelled', note || '');
    L('lib_audit').write(tctx, { op: 'approvals.cancel', collection: 'approvals', record: r.id, summary: 'Cancelled: ' + r.getString('summary') });
  };
  if (app.isTransactional()) run(app);
  else app.runInTransaction((tx) => run(tx));
  ctx.audited = true;
  return view(app, app.findRecordById('approvals', r0.id));
}

/** Pending approvals the caller can take now (as approver; administrators also see what they may override with view: 'all'). */
function pendingFor(ctx) {
  const util = u();
  if (ctx.member === null) return [];
  return util
    .findMany(ctx.app, 'approvals', "status = 'pending' && approvers ~ {:m}", 'created', 500, { m: ctx.memberId })
    .filter((r) => (util.jsonOf(r, 'approvers', []) || []).indexOf(ctx.memberId) >= 0)
    .map((r) => view(ctx.app, r));
}

/**
 * Pending approvals the caller is not an approver of but oversees: the owner
 * sees every one; an administrator of the kind's module (full level) those
 * of their entities. They may decide them as administrator (standing
 * 'override') unless the request is their own or about them.
 */
function overseenBy(ctx) {
  const util = u();
  const auth = L('lib_auth');
  if (ctx.member === null) return [];
  return util
    .findMany(ctx.app, 'approvals', "status = 'pending'", 'created', 500)
    .filter((r) => {
      if ((util.jsonOf(r, 'approvers', []) || []).indexOf(ctx.memberId) >= 0) return false;
      const mod = moduleOf(r.getString('kind'));
      return ctx.owner || (mod !== '' && auth.can(ctx, mod, 'full') && auth.inScope(ctx, r.getString('entity')));
    })
    .map((r) => Object.assign(view(ctx.app, r), { can_decide: standing(ctx, r) !== '' }));
}

/* ------------------------------------------------------------------- ops */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const which = util.oneOf(p, 'view', ['mine', 'overseen', 'requested', 'all'], 'mine');
  const status = util.oneOf(p, 'status', ['pending', 'approved', 'rejected', 'cancelled', 'decided', 'any'], 'pending');
  const kind = util.str(p, 'kind', '');
  const pg = util.page(p, 50, 500);
  if (which === 'mine' && status === 'pending') {
    let rows = pendingFor(ctx);
    if (kind !== '') rows = rows.filter((r) => r.kind === kind);
    return { approvals: rows.slice(pg.offset, pg.offset + pg.limit), total: rows.length, overseen: overseenBy(ctx).length };
  }
  if (which === 'overseen') {
    let rows = overseenBy(ctx);
    if (kind !== '') rows = rows.filter((r) => r.kind === kind);
    return { approvals: rows.slice(pg.offset, pg.offset + pg.limit), total: rows.length };
  }
  const where = [];
  const bind = {};
  if (status === 'decided') where.push("status != 'pending'");
  else if (status !== 'any') {
    where.push('status = {:s}');
    bind.s = status;
  }
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  if (which === 'requested') {
    if (ctx.member === null) return { approvals: [], total: 0 };
    where.push('requester = {:m}');
    bind.m = ctx.memberId;
  } else if (which === 'mine') {
    where.push("(approvers ~ {:m} || decided_by = {:m})");
    bind.m = ctx.memberId || '-';
  }
  const auth = L('lib_auth');
  const rows = util.findMany(app, 'approvals', where.length > 0 ? where.join(' && ') : '1=1', '-created', 2000, bind).filter((r) => {
    if (which !== 'all') return true;
    if (ctx.isAgent) return true;
    const mod = moduleOf(r.getString('kind'));
    return (mod !== '' && auth.can(ctx, mod, 'view') && auth.inScope(ctx, r.getString('entity'))) || auth.can(ctx, 'admin', 'view');
  });
  return { approvals: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => view(app, r)), total: rows.length };
}

function get(ctx, p) {
  const util = u();
  const r = ref(ctx.app, util.req(p, 'approval'));
  const v = view(ctx.app, r);
  const auth = L('lib_auth');
  const mod = moduleOf(v.kind);
  const visible = ctx.isAgent || v.approvers.indexOf(ctx.memberId) >= 0 || v.requester === ctx.memberId || v.decided_by === ctx.memberId || (mod !== '' && auth.can(ctx, mod, 'view')) || auth.can(ctx, 'admin', 'view') || (v.employee !== '' && v.employee === auth.selfEmployee(ctx));
  if (!visible) throw util.fail(403, 'You cannot see this request.', 'not_permitted');
  v.can_decide = standing(ctx, r) !== '';
  return { approval: v };
}

function decideOp(ctx, p) {
  const util = u();
  return { approval: decide(ctx, util.req(p, 'approval'), util.oneOf(p, 'decision', ['approved', 'rejected'], ''), util.text(p, 'note', 2000, ''), util.str(p, 'pin', '')) };
}

function cancelOp(ctx, p) {
  const util = u();
  return { approval: cancel(ctx, util.req(p, 'approval'), util.text(p, 'note', 2000, '')) };
}

function flowView(app, r) {
  const util = u();
  return { id: r.id, kind: r.getString('kind'), entity: r.getString('entity'), department: r.getString('department'), steps: util.jsonOf(r, 'steps', []) || [], auto: util.jsonOf(r, 'auto', {}) || {}, active: r.getBool('active'), note: r.getString('note') };
}

function flowsList(ctx) {
  return { flows: u().findMany(ctx.app, 'approval_flows', '1=1', 'kind,created').map((r) => flowView(ctx.app, r)), kinds: L('lib_events').approvalKinds(), step_types: STEP_TYPES };
}

function readSteps(app, p) {
  const util = u();
  const raw = util.list(p, 'steps');
  if (raw === undefined) return undefined;
  if (raw.length === 0 || raw.length > 6) throw util.fail(400, 'A flow has 1 to 6 steps.', 'invalid_param', { param: 'steps' });
  return raw.map((s, i) => {
    util.keysOnly(s, ['type', 'role', 'member'], 'step ' + (i + 1));
    if (STEP_TYPES.indexOf(s.type) < 0) throw util.fail(400, 'step ' + (i + 1) + ': type is one of ' + STEP_TYPES.join(', '), 'invalid_param');
    if (s.type === 'role') {
      if (L('lib_auth').roleByCode(app, String(s.role || '')) === null) throw util.fail(400, 'step ' + (i + 1) + ': unknown role ' + s.role, 'invalid_param');
      return { type: 'role', role: String(s.role) };
    }
    if (s.type === 'member') return { type: 'member', member: L('lib_auth').memberRef(app, String(s.member || '')).id };
    return { type: s.type };
  });
}

function flowsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'flow', '');
  const rec = id !== '' ? util.byId(app, 'approval_flows', id) : util.newRecord(app, 'approval_flows');
  if (rec === null) throw util.fail(404, 'No such flow.', 'not_found');
  const before = id !== '' ? flowView(app, rec) : null;
  if (id === '' || util.has(p, 'kind')) {
    const kind = util.req(p, 'kind', 'leave_request');
    if (L('lib_events').approvalKinds().indexOf(kind) < 0) throw util.fail(400, 'Unknown kind ' + kind + '. Kinds: ' + L('lib_events').approvalKinds().join(', '), 'unknown_kind');
    rec.set('kind', kind);
  }
  if (util.has(p, 'entity')) rec.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  if (util.has(p, 'department')) rec.set('department', util.str(p, 'department', '') === '' ? '' : L('lib_org').kindRef(app, 'department', util.str(p, 'department', '')).id);
  const steps = readSteps(app, p);
  if (steps !== undefined) rec.set('steps', steps);
  else if (id === '') rec.set('steps', [{ type: 'manager' }]);
  if (util.has(p, 'auto')) {
    const a = util.obj(p, 'auto') || {};
    util.keysOnly(a, ['max_amount', 'currency', 'max_days'], 'auto');
    const out = {};
    if (a.max_days !== undefined && a.max_days !== '') out.max_days = Number(a.max_days);
    if (a.max_amount !== undefined && a.max_amount !== '') {
      if (!a.currency) throw util.fail(400, 'auto.currency is needed with auto.max_amount.', 'invalid_param');
      out.currency = String(a.currency).toUpperCase();
      out.max_amount_minor = util.money({ v: a.max_amount }, 'v', out.currency, { required: true });
    }
    rec.set('auto', out);
  } else if (id === '') rec.set('auto', {});
  if (util.has(p, 'active')) rec.set('active', util.bool(p, 'active', true));
  else if (id === '') rec.set('active', true);
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 400, ''));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'approval_flows', record: rec.id, summary: (id === '' ? 'Added' : 'Changed') + ' the approval flow for ' + rec.getString('kind'), before: before, after: flowView(app, rec) });
  return { flow: flowView(app, rec) };
}

function flowsDelete(ctx, p) {
  const util = u();
  const rec = util.byId(ctx.app, 'approval_flows', util.req(p, 'flow'));
  if (rec === null) throw util.fail(404, 'No such flow.', 'not_found');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'approval_flows', record: rec.id, summary: 'Deleted the approval flow for ' + rec.getString('kind') });
  return { deleted: true };
}

module.exports = {
  STEP_TYPES: STEP_TYPES,
  KIND_MODULE: KIND_MODULE,
  view: view,
  flowFor: flowFor,
  open: open,
  decide: decide,
  cancel: cancel,
  pendingFor: pendingFor,
  overseenBy: overseenBy,
  standing: standing,
  list: list,
  get: get,
  decideOp: decideOp,
  cancelOp: cancelOp,
  flowsList: flowsList,
  flowsSave: flowsSave,
  flowsDelete: flowsDelete,
};
