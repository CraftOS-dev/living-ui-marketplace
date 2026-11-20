/// <reference path="../pb_data/types.d.ts" />
/**
 * Separations: resignation, termination, retirement, end of contract (and
 * death, other) with the notice day, the last day, the reason and rehire
 * eligibility. A separation waits for the approval kind `separation` (the
 * flow seeded in the lifecycle migration: the manager, then HR). On
 * approval: the employment ends on the last day through the kernel
 * (lib_people.endEmployment), the offboarding checklist starts from the
 * entity's default template, and `separation.approved { separation,
 * employment, last_day, kind }` is emitted (payroll answers `{ payrun }`
 * with the termination run it made, kept as settlement_payrun).
 *
 * The exit interview (questions of the exit form, answers) and the reason
 * are for HR only: managers see the kind, the days and the status; your AI
 * agent never sees exit interview answers. The full and final statement
 * reads the other modules' contracts: lib_expenses.payInputs and
 * advanceRecovery, lib_leave.balance of encashable leave types, active
 * loans, the termination run, and the assets the person still holds.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function lc() {
  return L('lib_lifecycle');
}

const KINDS = ['resignation', 'termination', 'retirement', 'end_of_contract', 'death', 'other'];
const KIND_LABEL = { resignation: 'Resignation', termination: 'Termination', retirement: 'Retirement', end_of_contract: 'End of contract', death: 'Death', other: 'Other' };
const REASONS = ['better_opportunity', 'compensation', 'career_change', 'relocation', 'personal', 'health', 'study', 'performance', 'conduct', 'redundancy', 'restructuring', 'probation', 'contract_end', 'retirement', 'death', 'other'];
const SELF_KINDS = ['resignation', 'retirement'];
const QUESTION_TYPES = ['text', 'rating', 'choice', 'yes_no'];

/* ---------------------------------------------------------------- views */

function separationRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.byId(app, 'separations', r) || util.findOne(app, 'separations', 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null) throw util.fail(404, 'No separation ' + r + '. Run separations.list.', 'not_found');
  return rec;
}

/** How the caller sees a separation: hr | agent | self | manager | ''. */
function seeSeparation(ctx, s) {
  if (ctx.actor === 'system') return 'hr';
  if (ctx.isAgent) return 'agent';
  if (lc().hrCan(ctx, s.getString('entity'), 'view')) return 'hr';
  if (L('lib_auth').selfEmployee(ctx) === s.getString('employee')) return 'self';
  if (ctx.teamScope && L('lib_auth').isManagerOf(ctx, s.getString('employment'), u().today(ctx.app))) return 'manager';
  return '';
}

function separationView(ctx, s, full) {
  const util = u();
  const app = ctx.app;
  const see = seeSeparation(ctx, s);
  const e = util.byId(app, 'employees', s.getString('employee'));
  const cl = L('lib_lifecycle_checklists');
  const list = util.findOne(app, 'checklists', "separation = {:s} && status != 'cancelled'", { s: s.id }) || cl.openChecklist(app, s.getString('employment'), 'offboarding');
  const ei = util.jsonOf(s, 'exit_interview', {}) || {};
  const v = {
    id: s.id,
    number: s.getString('number'),
    employee: s.getString('employee'),
    employee_name: e !== null ? L('lib_people').displayName(e) : '',
    employee_number: e !== null ? e.getString('number') : '',
    employment: s.getString('employment'),
    entity: s.getString('entity'),
    entity_name: lc().entityName(app, s.getString('entity')),
    kind: s.getString('kind'),
    kind_label: KIND_LABEL[s.getString('kind')] || s.getString('kind'),
    notice_day: s.getString('notice_day'),
    last_day: s.getString('last_day'),
    last_day_shown: lc().dayIn(app, s.getString('entity'), s.getString('last_day')),
    days_left: util.daysBetween(util.today(app, s.getString('entity')), s.getString('last_day')),
    status: s.getString('status'),
    approval: s.getString('approval'),
    requested_actor: s.getString('requested_actor'),
    requested_by_name: s.getString('requested_actor') === 'agent' ? 'Your AI agent' : lc().memberName(app, s.getString('requested_by')),
    decided_at: s.getString('decided_at'),
    completed_at: s.getString('completed_at'),
    settlement_payrun: s.getString('settlement_payrun'),
    checklist: list === null ? null : cl.progressOf(app, list),
    exit_interview_done: (ei.done_at || '') !== '',
    see: see,
    created: s.getString('created'),
  };
  if (see === 'hr' || see === 'agent') {
    v.reason_code = s.getString('reason_code');
    v.rehire_eligible = s.getString('rehire_eligible');
    v.reason = s.getString('reason');
    v.events = util.jsonOf(s, 'events', []) || [];
  }
  if (see === 'self') v.reason = s.getString('reason');
  if (see === 'hr') {
    v.hr_note = s.getString('hr_note');
    if (full) v.exit_interview = ei;
  }
  if (full && see === 'self') v.exit_interview = { done_at: ei.done_at || '', questions: ei.done_at ? [] : formFor(app, s).questions, answers: ei.done_at ? {} : ei.answers || {} };
  return v;
}

/* -------------------------------------------------------------- reading */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 50, 300);
  const where = [];
  const bind = {};
  const status = util.oneOf(p, 'status', ['open', 'pending', 'approved', 'completed', 'rejected', 'withdrawn', 'all'], 'open');
  if (status === 'open') where.push("s.status IN ('pending', 'approved')");
  else if (status !== 'all') {
    where.push('s.status = {:st}');
    bind.st = status;
  }
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    where.push('s.kind = {:k}');
    bind.k = kind;
  }
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    where.push('s.employee = {:e}');
    bind.e = L('lib_people').employeeRef(app, empRef).id;
  }
  if (lc().hrCan(ctx, '', 'view')) where.push(lc().scopeSql(ctx, 's', bind));
  else {
    const parts = ['s.employee = {:self}'];
    bind.self = ctx.employeeId || '-';
    if (ctx.teamScope && ctx.employeeId !== '') {
      const ids = L('lib_people').reportsOf(app, ctx.employeeId, util.today(app), true).map((r) => r.employment);
      if (ids.length > 0) parts.push("(s.status != 'rejected' AND s.employment IN (" + ids.map((id, i) => ((bind['r' + i] = id), '{:r' + i + '}')).join(',') + '))');
    }
    where.push('(' + parts.join(' OR ') + ')');
  }
  const w = where.length > 0 ? where.join(' AND ') : '1 = 1';
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM separations s WHERE ' + w, bind);
  const rows = util.rows(app, "SELECT s.id AS id FROM separations s WHERE " + w + " ORDER BY s.status = 'pending' DESC, s.last_day " + (status === 'open' ? 'ASC' : 'DESC') + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return { separations: rows.map((r) => separationView(ctx, app.findRecordById('separations', r.id), false)), total: total, kinds: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })), reasons: REASONS, limit: pg.limit, offset: pg.offset };
}

function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = separationRef(app, util.req(p, 'separation'));
  const see = seeSeparation(ctx, s);
  if (see === '') throw util.fail(403, 'You cannot see this separation.', 'not_permitted');
  const v = separationView(ctx, s, true);
  if (see === 'hr' || see === 'agent' || see === 'manager') v.assets = util.findMany(app, 'assets', "employee = {:e} && status = 'issued'", 'name', 200, { e: s.getString('employee') }).map((a) => L('lib_lifecycle_assets').assetView(app, a, see !== 'manager'));
  if (see === 'hr') v.form = formFor(app, s);
  const hrEdit = !ctx.isAgent && lc().hrCan(ctx, s.getString('entity'), 'edit');
  const status = s.getString('status');
  v.can = {
    edit: hrEdit && (status === 'pending' || status === 'approved'),
    withdraw: !ctx.isAgent && status === 'pending' && (hrEdit || s.getString('requested_by') === ctx.memberId),
    exit_interview: !ctx.isAgent && (status === 'pending' || status === 'approved' || status === 'completed') && (see === 'hr' ? hrEdit : see === 'self' && !v.exit_interview_done),
    complete: hrEdit && status === 'approved',
    settlement: hrEdit,
  };
  return { separation: v };
}

/* -------------------------------------------------------------- writing */

/** separations.request: someone resigns (themself), or HR or a manager starts a separation; it waits for approval. */
function request(ctx, p) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const auth = L('lib_auth');
  const ref = util.str(p, 'employment', '');
  let m;
  if (ref === '') {
    if (auth.selfEmployee(ctx) === '') throw util.fail(400, 'employment is required, e.g. --employment E0001', 'missing_param', { param: 'employment' });
    const id = people.primaryEmployment(app, ctx.employeeId, util.today(app));
    if (id === '') throw util.fail(409, 'You have no employment to resign from.', 'invalid');
    m = app.findRecordById('employments', id);
  } else m = people.employmentRef(app, ref);
  const own = auth.selfEmployee(ctx) === m.getString('employee');
  const hr = lc().hrCan(ctx, m.getString('entity'), 'edit') && !ctx.isAgent;
  const today = util.today(app, m.getString('entity'));
  const manager = !own && !hr && ctx.teamScope && auth.isManagerOf(ctx, m.id, today);
  if (!own && !hr && !manager) throw util.fail(403, 'You cannot start a separation for this person.', 'not_permitted');
  const kind = util.oneOf(p, 'kind', KINDS, 'resignation');
  if (own && !hr && SELF_KINDS.indexOf(kind) < 0) throw util.fail(403, 'You can resign or retire here; other kinds are started by HR.', 'not_permitted', { param: 'kind' });
  if (manager && ['resignation', 'termination', 'end_of_contract', 'retirement'].indexOf(kind) < 0) throw util.fail(403, 'Ask HR to record this kind of separation.', 'not_permitted', { param: 'kind' });
  const last = util.day(p, 'last_day', '');
  if (last === '') throw util.fail(400, 'last_day is required, e.g. --last_day 2026-12-31', 'missing_param', { param: 'last_day' });
  const notice = util.day(p, 'notice_day', today);
  if (last < m.getString('start_day')) throw util.fail(400, 'The last day is before the first day (' + m.getString('start_day') + ').', 'invalid_param', { param: 'last_day' });
  if (notice > last) throw util.fail(400, 'The notice day is after the last day.', 'invalid_param', { param: 'notice_day' });
  if (m.getString('end_day') !== '' && m.getString('end_day') < today) throw util.fail(409, 'This employment already ended on ' + m.getString('end_day') + '.', 'ended');
  const open = util.findOne(app, 'separations', "employment = {:m} && (status = 'pending' || status = 'approved')", { m: m.id });
  if (open !== null) throw util.fail(409, 'There is already a separation for this employment (' + open.getString('number') + ', ' + open.getString('status') + ').', 'duplicate', { separation: open.id });
  const reasonCode = util.oneOf(p, 'reason_code', REASONS, kind === 'retirement' ? 'retirement' : kind === 'end_of_contract' ? 'contract_end' : kind === 'death' ? 'death' : '');
  const name = lc().employeeName(app, m.getString('employee'));
  let id = '';
  lc().inTx(app, (tx) => {
    const tctx = auth.withApp(ctx, tx);
    const s = util.newRecord(tx, 'separations');
    s.set('number', 'S' + String(util.nextNumber(tx, 'separation')).padStart(4, '0'));
    s.set('employment', m.id);
    s.set('employee', m.getString('employee'));
    s.set('entity', m.getString('entity'));
    s.set('kind', kind);
    s.set('notice_day', notice);
    s.set('last_day', last);
    s.set('reason', util.text(p, 'reason', 4000, ''));
    s.set('reason_code', reasonCode);
    s.set('rehire_eligible', hr ? util.oneOf(p, 'rehire_eligible', ['yes', 'no', 'unsure'], 'unsure') : 'unsure');
    s.set('hr_note', hr ? util.text(p, 'hr_note', 4000, '') : '');
    s.set('status', 'pending');
    s.set('requested_by', ctx.memberId || '');
    s.set('requested_actor', ctx.isAgent ? 'agent' : 'person');
    s.set('exit_interview', {});
    s.set('events', []);
    tx.save(s);
    id = s.id;
    const ap = L('lib_approvals').open(tctx, {
      kind: 'separation',
      ref_collection: 'separations',
      ref_id: s.id,
      employment: m.id,
      summary: KIND_LABEL[kind] + ' of ' + name + ', last day ' + last,
      facts: [{ type: 'day', key: 'last_day', label: 'Last day', value: last }, { type: 'state', key: 'kind', label: 'Kind', value: kind }].concat(notice !== '' ? [{ type: 'day', key: 'notice_day', label: 'Notice given', value: notice }] : []),
      payload: { separation: s.id, number: s.getString('number'), kind: kind, notice_day: notice, last_day: last },
      due: notice,
    });
    const fresh = tx.findRecordById('separations', s.id);
    if (fresh.getString('approval') === '') {
      fresh.set('approval', ap.id);
      tx.save(fresh);
    }
    lc().auditFrom(tctx, { op: 'separations.request', collection: 'separations', record: s.id, summary: (own ? 'Resigned' : 'Started the separation of ' + name) + ' (' + KIND_LABEL[kind] + ', last day ' + last + ')' });
  });
  ctx.audited = true;
  return get(ctx, { separation: id });
}

/** The approval subscriber of kind `separation` (inside the decision's transaction). */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const s = util.byId(app, 'separations', approval.ref_id);
  if (s === null) throw util.fail(404, 'The separation of this approval is gone.', 'not_found');
  s.set('approval', approval.id);
  if (decision === 'rejected') {
    s.set('status', 'rejected');
    s.set('decided_at', util.nowIso());
    app.save(s);
    return { status: 'rejected' };
  }
  if (decision === 'cancelled') {
    s.set('status', 'withdrawn');
    s.set('decided_at', util.nowIso());
    app.save(s);
    return { status: 'withdrawn' };
  }
  const m = app.findRecordById('employments', s.getString('employment'));
  const last = s.getString('last_day');
  s.set('status', 'approved');
  s.set('decided_at', util.nowIso());
  app.save(s);
  const cl = L('lib_lifecycle_checklists');
  let checklist = '';
  if (cl.openChecklist(app, m.id, 'offboarding') === null) {
    const tpl = cl.defaultTemplate(app, m.getString('entity'), 'offboarding');
    if (tpl !== null) checklist = cl.startChecklist(ctx, { employment: m, kind: 'offboarding', template: tpl, anchor_day: last, separation: s.id, deferAgent: true }).id;
  } else {
    const c = cl.openChecklist(app, m.id, 'offboarding');
    c.set('separation', s.id);
    app.save(c);
    checklist = c.id;
  }
  L('lib_people').endEmployment(ctx, m.id, last, KIND_LABEL[s.getString('kind')]);
  const m2 = app.findRecordById('employments', m.id);
  m2.set('notice_day', s.getString('notice_day'));
  app.save(m2);
  const results = L('lib_events').emit(ctx, 'separation.approved', { separation: s.id, employment: m.id, last_day: last, kind: s.getString('kind') });
  const fresh = app.findRecordById('separations', s.id);
  for (const r of results) if (r.ok && r.result && typeof r.result.payrun === 'string' && r.result.payrun !== '') fresh.set('settlement_payrun', r.result.payrun);
  fresh.set('events', results.map((r) => ({ module: r.module, ok: r.ok, error: r.error || '', result: r.ok ? r.result : null })));
  app.save(fresh);
  return { status: 'approved', checklist: checklist, events: results.length };
}

/** separations.update: HR changes the details; after approval a new last day re-ends the employment and moves the offboarding due days. */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = separationRef(app, util.req(p, 'separation'));
  lc().needHr(ctx, s.getString('entity'), 'edit', 'change separations');
  const status = s.getString('status');
  if (status !== 'pending' && status !== 'approved') throw util.fail(409, 'This separation is ' + status + '.', 'conflict');
  const before = separationView(ctx, s, false);
  if (util.has(p, 'kind')) {
    if (status !== 'pending') throw util.fail(409, 'The kind changes only while the separation waits for approval.', 'conflict');
    s.set('kind', util.oneOf(p, 'kind', KINDS, s.getString('kind')));
  }
  if (util.has(p, 'notice_day')) s.set('notice_day', util.day(p, 'notice_day', s.getString('notice_day')));
  const m = app.findRecordById('employments', s.getString('employment'));
  let moved = false;
  if (util.has(p, 'last_day')) {
    const last = util.day(p, 'last_day', '');
    if (last === '') throw util.fail(400, 'last_day cannot be empty', 'invalid_param', { param: 'last_day' });
    if (last < m.getString('start_day')) throw util.fail(400, 'The last day is before the first day.', 'invalid_param', { param: 'last_day' });
    moved = last !== s.getString('last_day');
    s.set('last_day', last);
  }
  if (s.getString('notice_day') > s.getString('last_day')) throw util.fail(400, 'The notice day is after the last day.', 'invalid_param', { param: 'notice_day' });
  if (util.has(p, 'reason')) s.set('reason', util.text(p, 'reason', 4000, ''));
  if (util.has(p, 'reason_code')) s.set('reason_code', util.oneOf(p, 'reason_code', REASONS, ''));
  if (util.has(p, 'rehire_eligible')) s.set('rehire_eligible', util.oneOf(p, 'rehire_eligible', ['yes', 'no', 'unsure'], 'unsure'));
  if (util.has(p, 'hr_note')) s.set('hr_note', util.text(p, 'hr_note', 4000, ''));
  let events = [];
  lc().inTx(app, (tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    tx.save(s);
    if (moved && status === 'approved') {
      L('lib_people').endEmployment(tctx, m.id, s.getString('last_day'), KIND_LABEL[s.getString('kind')]);
      const c = util.findOne(tx, 'checklists', "separation = {:s} && status = 'open'", { s: s.id });
      if (c !== null) {
        const shift = util.daysBetween(c.getString('anchor_day'), s.getString('last_day'));
        c.set('anchor_day', s.getString('last_day'));
        tx.save(c);
        const today = util.today(tx, s.getString('entity'));
        for (const t of util.findMany(tx, 'tasks', "checklist = {:c} && status = 'open' && due != ''", '', 0, { c: c.id })) {
          // Moved by the same days; a task that was not late does not become late by the move (it is due today).
          const was = t.getString('due');
          const moved2 = util.dayAdd(was, shift);
          t.set('due', moved2 < today && was >= today ? today : moved2);
          tx.save(t);
        }
      }
      events = L('lib_events').emit(tctx, 'separation.changed', { separation: s.id, employment: m.id, last_day: s.getString('last_day'), kind: s.getString('kind') });
    }
    if (moved && status === 'pending' && s.getString('approval') !== '') {
      const ap = util.byId(tx, 'approvals', s.getString('approval'));
      if (ap !== null) {
        const pl = util.jsonOf(ap, 'payload', {}) || {};
        pl.last_day = s.getString('last_day');
        ap.set('payload', pl);
        ap.set('summary', KIND_LABEL[s.getString('kind')] + ' of ' + lc().employeeName(tx, s.getString('employee')) + ', last day ' + s.getString('last_day'));
        tx.save(ap);
      }
    }
  });
  L('lib_audit').note(ctx, { collection: 'separations', record: s.id, summary: 'Changed the separation ' + s.getString('number') + ' of ' + before.employee_name, before: before, after: separationView(ctx, s, false) });
  const out = get(ctx, { separation: s.id });
  out.events = events;
  return out;
}

/** separations.withdraw: the person who asked (or HR) withdraws a separation waiting for approval. */
function withdraw(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = separationRef(app, util.req(p, 'separation'));
  if (s.getString('status') !== 'pending') throw util.fail(409, 'Only a separation waiting for approval can be withdrawn; this one is ' + s.getString('status') + '.', 'conflict');
  const mine = ctx.memberId !== '' && s.getString('requested_by') === ctx.memberId;
  // The kernel lets the requester or a people:full administrator cancel the approval.
  if (!mine) lc().needHr(ctx, s.getString('entity'), 'full', 'withdraw a separation someone else asked for');
  const note = util.text(p, 'note', 2000, '');
  const ap = util.byId(app, 'approvals', s.getString('approval'));
  if (ap !== null && ap.getString('status') === 'pending') {
    // The kernel cancels the approval and calls onDecision with 'cancelled' (status withdrawn).
    L('lib_approvals').cancel(ctx, ap.id, note || 'Withdrawn');
    if (app.findRecordById('separations', s.id).getString('status') === 'pending') {
      const fresh = app.findRecordById('separations', s.id);
      fresh.set('status', 'withdrawn');
      app.save(fresh);
    }
  } else {
    s.set('status', 'withdrawn');
    app.save(s);
  }
  L('lib_audit').note(ctx, { collection: 'separations', record: s.id, summary: 'Withdrew the separation ' + s.getString('number') + ' of ' + lc().employeeName(app, s.getString('employee')) });
  return get(ctx, { separation: s.id });
}

/** separations.complete: HR closes an approved separation once the last day passed. */
function complete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = separationRef(app, util.req(p, 'separation'));
  lc().needHr(ctx, s.getString('entity'), 'edit', 'complete separations');
  if (s.getString('status') !== 'approved') throw util.fail(409, 'Only an approved separation can be completed; this one is ' + s.getString('status') + '.', 'conflict');
  if (s.getString('last_day') > util.today(app, s.getString('entity'))) throw util.fail(409, 'The last day (' + s.getString('last_day') + ') is still ahead.', 'too_early');
  s.set('status', 'completed');
  s.set('completed_at', util.nowIso());
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'separations', record: s.id, summary: 'Completed the separation ' + s.getString('number') + ' of ' + lc().employeeName(app, s.getString('employee')) });
  return get(ctx, { separation: s.id });
}

/** The daily job: approved separations past their last day with offboarding done (or none) are completed. */
function completeDue(app, entityId, day) {
  const util = u();
  let n = 0;
  for (const s of util.findMany(app, 'separations', "entity = {:e} && status = 'approved' && last_day < {:d}", '', 0, { e: entityId, d: day })) {
    const open = util.count(app, "SELECT COUNT(*) AS n FROM checklists WHERE separation = {:s} AND status = 'open'", { s: s.id });
    if (open > 0) continue;
    s.set('status', 'completed');
    s.set('completed_at', util.nowIso());
    app.save(s);
    n++;
  }
  return n;
}

/* ------------------------------------------------------- exit interview */

function formView(r) {
  return { id: r.id, name: r.getString('name'), entity: r.getString('entity'), questions: u().jsonOf(r, 'questions', []) || [], is_default: r.getBool('is_default'), builtin: r.getBool('builtin'), archived: r.getBool('archived') };
}

/** The exit form of a separation: the questions kept with its answers, else the entity's or the company's default form. */
function formFor(app, s) {
  const util = u();
  const ei = util.jsonOf(s, 'exit_interview', {}) || {};
  if (Array.isArray(ei.questions) && ei.questions.length > 0) return { id: ei.form || '', name: ei.form_name || 'Exit interview', questions: ei.questions };
  const r =
    util.findOne(app, 'exit_forms', 'entity = {:e} && is_default = true && archived = false', { e: s.getString('entity') }) ||
    util.findOne(app, 'exit_forms', "entity = '' && is_default = true && archived = false", {}) ||
    util.findOne(app, 'exit_forms', 'archived = false', {});
  if (r === null) return { id: '', name: 'Exit interview', questions: L('lib_lifecycle_defaults').EXIT_QUESTIONS };
  return { id: r.id, name: r.getString('name'), questions: util.jsonOf(r, 'questions', []) || [] };
}

function readAnswers(questions, raw) {
  const util = u();
  const out = {};
  const byKey = {};
  for (const q of questions) byKey[q.key] = q;
  for (const k of Object.keys(raw || {})) {
    const q = byKey[k];
    if (q === undefined) throw util.fail(400, 'answers: unknown question "' + k + '". Questions: ' + questions.map((x) => x.key).join(', '), 'invalid_param', { param: 'answers' });
    const v = raw[k];
    if (v === null || v === undefined || v === '') continue;
    if (q.type === 'rating') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw util.fail(400, 'answers.' + k + ' is a rating from 1 to 5.', 'invalid_param', { param: 'answers' });
      out[k] = n;
    } else if (q.type === 'yes_no') {
      const s = String(v);
      if (s !== 'yes' && s !== 'no') throw util.fail(400, 'answers.' + k + ' is yes or no.', 'invalid_param', { param: 'answers' });
      out[k] = s;
    } else if (q.type === 'choice') {
      const s = String(v);
      if ((q.options || []).indexOf(s) < 0) throw util.fail(400, 'answers.' + k + ' is one of: ' + (q.options || []).join(', '), 'invalid_param', { param: 'answers' });
      out[k] = s;
    } else {
      const s = String(v);
      if (s.length > 4000) throw util.fail(400, 'answers.' + k + ' is too long.', 'invalid_param', { param: 'answers' });
      out[k] = s;
    }
  }
  return out;
}

/** separations.exit-interview: the leaving person (once) or HR saves the answers; --done true submits. */
function exitInterview(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = separationRef(app, util.req(p, 'separation'));
  const see = seeSeparation(ctx, s);
  const hr = see === 'hr' && lc().hrCan(ctx, s.getString('entity'), 'edit');
  if (!hr && see !== 'self') throw util.fail(403, 'The exit interview is for the person leaving and HR.', 'not_permitted');
  if (['pending', 'approved', 'completed'].indexOf(s.getString('status')) < 0) throw util.fail(409, 'This separation is ' + s.getString('status') + '.', 'conflict');
  const ei = util.jsonOf(s, 'exit_interview', {}) || {};
  if (!hr && ei.done_at) throw util.fail(409, 'You already sent your exit interview. Thank you.', 'conflict');
  const form = formFor(app, s);
  const answers = Object.assign({}, ei.answers || {}, readAnswers(form.questions, util.obj(p, 'answers') || {}));
  const done = util.bool(p, 'done', false);
  const next = { form: form.id, form_name: form.name, questions: form.questions, answers: answers, done_at: done ? util.nowIso() : ei.done_at || '', by: ctx.memberId || '', by_actor: see === 'self' ? 'person' : 'hr', updated_at: util.nowIso() };
  s.set('exit_interview', next);
  app.save(s);
  // Answers stay out of the audit trail: they are confidential to HR.
  L('lib_audit').note(ctx, { collection: 'separations', record: s.id, summary: (done ? 'Sent' : 'Saved') + ' the exit interview of ' + lc().employeeName(app, s.getString('employee')) });
  return get(ctx, { separation: s.id });
}

function exitFormsList(ctx) {
  return { forms: u().findMany(ctx.app, 'exit_forms', 'archived = false', 'name', 100).map(formView), question_types: QUESTION_TYPES };
}

function readQuestions(raw) {
  const util = u();
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) throw util.fail(400, 'questions is a JSON list of 1 to 40 {key, label, type, options}.', 'invalid_param', { param: 'questions' });
  const seen = {};
  return raw.map((q, i) => {
    const where = 'question ' + (i + 1);
    util.keysOnly(q, ['key', 'label', 'type', 'options'], where);
    const label = util.squash(q.label);
    if (label === '' || label.length > 300) throw util.fail(400, where + ': label is 1 to 300 characters.', 'invalid_param', { param: 'questions' });
    const type = QUESTION_TYPES.indexOf(q.type) >= 0 ? q.type : 'text';
    let key = util.slug(q.key || label).replace(/-/g, '_').slice(0, 30) || 'q' + (i + 1);
    while (seen[key]) key = key + '_' + (i + 1);
    seen[key] = true;
    const out = { key: key, label: label, type: type };
    if (type === 'choice') {
      const opts = (Array.isArray(q.options) ? q.options : []).map((o) => util.squash(o)).filter((o) => o !== '');
      if (opts.length < 2) throw util.fail(400, where + ': a choice needs at least two options.', 'invalid_param', { param: 'questions' });
      out.options = opts.slice(0, 20);
    }
    return out;
  });
}

function exitFormsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'form', '');
  const r = ref !== '' ? util.byId(app, 'exit_forms', ref) : util.newRecord(app, 'exit_forms');
  if (r === null) throw util.fail(404, 'No exit form ' + ref + '.', 'not_found');
  lc().needHr(ctx, r.getString('entity'), 'edit', 'change exit forms');
  const before = ref !== '' ? formView(r) : null;
  if (ref === '' || util.has(p, 'name')) r.set('name', util.squash(util.text(p, 'name', 120, '')) || 'Exit interview');
  if (ref === '' || util.has(p, 'questions')) r.set('questions', readQuestions(util.list(p, 'questions')));
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  const makeDefault = util.has(p, 'is_default') ? util.bool(p, 'is_default', false) : ref === '' ? util.count(app, 'SELECT COUNT(*) AS n FROM exit_forms WHERE is_default = TRUE AND archived = FALSE') === 0 : r.getBool('is_default');
  r.set('is_default', makeDefault);
  if (ref === '') r.set('builtin', false);
  lc().inTx(app, (tx) => {
    tx.save(r);
    if (makeDefault) util.exec(tx, "UPDATE exit_forms SET is_default = FALSE WHERE entity = {:e} AND id != {:id}", { e: r.getString('entity'), id: r.id });
  });
  L('lib_bus').touch('exit_forms');
  L('lib_audit').note(ctx, { collection: 'exit_forms', record: r.id, summary: (ref === '' ? 'Added' : 'Changed') + ' the exit form ' + r.getString('name'), before: before, after: formView(r) });
  return { form: formView(r) };
}

/* ------------------------------------------------ full and final statement */

/**
 * separations.settlement: what the company owes and recovers at the end.
 *
 * Totals: the final pay run's payslip of the person (gross, deductions,
 * reimbursements, net) once payroll calculated it; before that an estimate from the
 * modules' contracts (claims and advance payouts to pay, advances, loans
 * and assets not returned to recover). Leave to pay out, exactly what
 * final pay pays: the encash lines of that payslip (days and amount), else
 * the leave module's approved exit cash-ins of this separation (made on
 * separation.approved and .changed), else (before those exist) the balances
 * of the types paid out on exit (`payout_on_exit`); until the payslip
 * exists the days are valued in final pay (payroll exposes no daily rate).
 */
function settlement(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = separationRef(app, util.req(p, 'separation'));
  lc().needHr(ctx, s.getString('entity'), 'edit', 'see full and final statements');
  const m = app.findRecordById('employments', s.getString('employment'));
  const ent = app.findRecordById('entities', m.getString('entity'));
  const cur = ent.getString('currency');
  const last = s.getString('last_day');
  const seePay = L('lib_people').canSeePay(ctx, m);
  const money = (minor) => (seePay ? minor : null);
  const pay = [];
  const recover = [];
  for (const c of L('lib_expenses').payInputs(app, m.id, last, cur, { via: 'any' })) {
    const label = c.kind === 'advance' ? 'Advance ' + (c.number || '') + ' to pay out' : 'Expense claim ' + (c.number || '') + ' to reimburse';
    pay.push({ kind: c.kind === 'advance' ? 'advance_payout' : 'claim', label: util.squash(label), ref: c.ref || c.claim || c.advance || '', amount_minor: money(c.amount_minor), currency: c.currency || cur });
  }
  for (const a of L('lib_expenses').advanceRecovery(app, m.id, last)) recover.push({ kind: 'advance', label: util.squash('Advance ' + (a.number || '') + ' not settled'), ref: a.advance, amount_minor: money(a.amount_minor), currency: a.currency || cur });
  for (const l of util.rows(app, "SELECT id, kind, balance_minor, currency FROM loans WHERE employment = {:m} AND status = 'active'", { id: '', kind: '', balance_minor: 0, currency: '' }, { m: m.id })) {
    recover.push({ kind: 'loan', label: 'Loan balance' + (l.kind ? ' (' + l.kind.replace(/_/g, ' ') + ')' : ''), ref: l.id, amount_minor: money(l.balance_minor), currency: l.currency || cur });
  }
  const assets = util.findMany(app, 'assets', "employee = {:e} && status = 'issued'", 'name', 200, { e: s.getString('employee') }).map((a) => ({ id: a.id, tag: a.getString('tag'), name: a.getString('name'), category: a.getString('category'), value_minor: a.getInt('value_minor') > 0 ? money(a.getInt('value_minor')) : null, currency: a.getString('currency') || cur }));
  for (const a of assets) recover.push({ kind: 'asset', label: 'Not returned: ' + a.name + ' (' + a.tag + ')', ref: a.id, amount_minor: a.value_minor, currency: a.currency });

  // The final pay run and the person's payslip in it.
  let run = null;
  let slip = null;
  if (s.getString('settlement_payrun') !== '') {
    const r = util.one(app, "SELECT id, COALESCE(number, '') AS number, kind, status, period_start, period_end, pay_date, currency FROM payruns WHERE id = {:id}", { id: '', number: '', kind: '', status: '', period_start: '', period_end: '', pay_date: '', currency: '' }, { id: s.getString('settlement_payrun') });
    if (r !== null) {
      slip = util.one(
        app,
        "SELECT id, currency, status, CAST(COALESCE(gross_minor, 0) AS INTEGER) AS gross, CAST(COALESCE(deductions_minor, 0) AS INTEGER) AS deductions, CAST(COALESCE(reimbursement_minor, 0) AS INTEGER) AS reimb, CAST(COALESCE(net_minor, 0) AS INTEGER) AS net FROM payslips WHERE payrun = {:r} AND employment = {:m} AND status != 'void' ORDER BY created DESC LIMIT 1",
        { id: '', currency: '', status: '', gross: 0, deductions: 0, reimb: 0, net: 0 },
        { r: r.id, m: m.id },
      );
      run = { id: r.id, number: r.number, kind: r.kind, status: r.status, period_start: r.period_start, period_end: r.period_end, pay_date: r.pay_date, currency: r.currency || cur, calculated: slip !== null, net_minor: slip !== null ? money(slip.net) : null };
    }
  }

  // Leave to pay out.
  let leave = [];
  let leaveFrom = 'balance';
  if (slip !== null) {
    leave = util
      .rows(app, "SELECT code, name, qty, rate, CAST(COALESCE(amount_minor, 0) AS INTEGER) AS amount FROM payslip_lines WHERE payslip = {:s} AND ref_kind = 'encash' ORDER BY sort", { code: '', name: '', qty: -0, rate: -0, amount: 0 }, { s: slip.id })
      .map((x) => ({ type: x.code, name: x.name, unit: 'day', balance: Number(x.qty), amount_minor: money(x.amount), currency: slip.currency || cur, valued: 'payrun' }));
    leaveFrom = 'payrun';
  }
  if (leave.length === 0) {
    const reqs = util.rows(
      app,
      "SELECT q.id AS id, q.days AS days, q.status AS status, COALESCE(t.code, '') AS code, COALESCE(t.name, '') AS name FROM leave_encash_requests q LEFT JOIN leave_types t ON t.id = q.type WHERE q.employment = {:m} AND q.kind = 'exit' AND q.separation = {:s} AND q.status = 'approved' ORDER BY q.created",
      { id: '', days: -0, status: '', code: '', name: '' },
      { m: m.id, s: s.id },
    );
    if (reqs.length > 0) {
      leave = reqs.map((x) => ({ type: x.code, name: x.name, unit: 'day', balance: Number(x.days), amount_minor: null, currency: cur, valued: 'final_pay', request: x.id, status: x.status }));
      leaveFrom = 'requests';
    }
  }
  if (leave.length === 0 && slip === null) {
    for (const t of util.rows(app, "SELECT code, name FROM leave_types WHERE payout_on_exit = TRUE AND archived = FALSE AND (entity = {:e} OR entity = '') ORDER BY name", { code: '', name: '' }, { e: ent.id })) {
      const bal = L('lib_leave').balance(app, m.id, t.code, last);
      if (!bal || Number(bal.balance) === 0) continue;
      leave.push({ type: t.code, name: t.name, unit: bal.unit || 'day', balance: Number(bal.balance), amount_minor: null, currency: cur, valued: 'final_pay' });
    }
    leaveFrom = 'balance';
  }

  // Totals: the payslip once it exists, else the estimate.
  let totals = [];
  if (slip !== null) {
    totals = [{ currency: slip.currency || cur, source: 'payrun', gross_minor: money(slip.gross), deductions_minor: money(slip.deductions), reimbursement_minor: money(slip.reimb), net_minor: money(slip.net), pay_minor: null, recover_minor: null }];
  } else {
    const est = {};
    const addTo = (list, sign) => {
      for (const x of list) {
        if (x.amount_minor === null) continue;
        if (est[x.currency] === undefined) est[x.currency] = { pay_minor: 0, recover_minor: 0, net_minor: 0 };
        if (sign > 0) est[x.currency].pay_minor += x.amount_minor;
        else est[x.currency].recover_minor += x.amount_minor;
        est[x.currency].net_minor += sign * x.amount_minor;
      }
    };
    addTo(pay, 1);
    addTo(recover, -1);
    totals = Object.keys(est).map((k) => ({ currency: k, source: 'estimate', gross_minor: null, deductions_minor: null, reimbursement_minor: null, pay_minor: est[k].pay_minor, recover_minor: est[k].recover_minor, net_minor: est[k].net_minor }));
  }
  return {
    separation: separationView(ctx, s, false),
    entity: { id: ent.id, name: ent.getString('name'), legal_name: ent.getString('legal_name') || ent.getString('name'), currency: cur, country: ent.getString('country') },
    last_day: last,
    pay_hidden: !seePay,
    pay: pay,
    recover: recover,
    leave: leave,
    leave_from: leaveFrom,
    assets: assets,
    payrun: run,
    totals: totals,
    today: util.today(app, ent.id),
  };
}

module.exports = {
  KINDS: KINDS,
  KIND_LABEL: KIND_LABEL,
  REASONS: REASONS,
  separationRef: separationRef,
  separationView: separationView,
  list: list,
  get: get,
  request: request,
  onDecision: onDecision,
  update: update,
  withdraw: withdraw,
  complete: complete,
  completeDue: completeDue,
  formFor: formFor,
  exitInterview: exitInterview,
  exitFormsList: exitFormsList,
  exitFormsSave: exitFormsSave,
  settlement: settlement,
};
