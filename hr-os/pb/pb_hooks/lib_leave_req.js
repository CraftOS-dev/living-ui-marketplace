/// <reference path="../pb_data/types.d.ts" />
/**
 * Leave requests: the day count (working days of the person's schedule and
 * holiday calendar, half days, hours), the checks before submit (balance
 * after, notice, longest stretch, locked dates, certificates, who else in
 * the team is away), the approval (kind leave_request through the kernel's
 * flows), withdrawing and cancelling (after approval a cancellation of leave
 * that already started goes back for approval), cashing in leave (kind
 * leave_encash, which payroll pays through payInputs) and compensatory
 * leave for days worked (kind comp_off).
 *
 * Severity of a check: 'stop' (never possible: overlaps, not in the policy,
 * longer than allowed), 'block' (the person cannot submit; their manager or
 * HR can, with override and a note), 'warn' and 'info' (shown, stored on the
 * request for the approver).
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

const OPEN = ['pending', 'approved', 'cancelling'];

/* --------------------------------------------------------------- views */

function fmtRange(a, b) {
  return a === b ? a : a + ' to ' + b;
}

function unitWord(unit, n) {
  return unit === 'hour' ? (n === 1 ? 'hour' : 'hours') : n === 1 ? 'day' : 'days';
}

function requestView(app, r, S0) {
  const util = u();
  const S = lv().sess(S0, app);
  const t = lv().typeById(S, r.getString('type'));
  const emp = lv().employmentOf(S, r.getString('employment'));
  const person = emp ? lv().personIn(S, emp) : { id: '', number: '', name: '' };
  return {
    id: r.id,
    employment: r.getString('employment'),
    employee: person.id,
    number: person.number,
    name: person.name,
    entity: emp ? emp.getString('entity') : '',
    type: t ? t.getString('code') : '',
    type_id: r.getString('type'),
    type_name: t ? t.getString('name') : '',
    color: t ? t.getString('color') : 'ink',
    icon: t ? t.getString('icon') : '',
    paid: t ? t.getBool('paid') : true,
    start: r.getString('start'),
    end: r.getString('end'),
    start_half: r.getString('start_half'),
    end_half: r.getString('end_half'),
    hours: r.getFloat('hours'),
    days: r.getFloat('days'),
    amount: r.getFloat('amount'),
    unit: r.getString('unit') || 'day',
    day_list: util.jsonOf(r, 'day_list', []) || [],
    reason: r.getString('reason'),
    has_attachment: r.getString('attachment') !== '',
    status: r.getString('status'),
    approval: r.getString('approval'),
    cancel_approval: r.getString('cancel_approval'),
    cancel_from: r.getString('cancel_from'),
    cancel_reason: r.getString('cancel_reason'),
    decided_note: r.getString('decided_note'),
    decided_at: r.getString('decided_at'),
    requested_by: r.getString('requested_by'),
    actor: r.getString('actor'),
    warnings: util.jsonOf(r, 'warnings', []) || [],
    recorded: r.getBool('recorded'),
    created: r.getString('created'),
  };
}

/** A view for people who may only see that someone is away (no type, no reason). */
function awayView(v) {
  return { id: v.id, employment: v.employment, employee: v.employee, number: v.number, name: v.name, start: v.start, end: v.end, start_half: v.start_half, end_half: v.end_half, days: v.days, status: v.status === 'pending' ? 'pending' : 'approved', type: '', type_name: '', color: 'ink', icon: '', away_only: true };
}

/* ------------------------------------------------------------ day plan */

/** The days a request takes: [{ day, days, amount, hours, half }] in the type's unit. */
function dayPlan(S, empRec, t, start, end, sh, eh, hours) {
  const util = u();
  const cal = L('lib_calendar');
  const app = S.app;
  if (util.daysBetween(start, end) > 400) throw util.fail(400, 'A request covers at most about a year; split longer leave into parts.', 'invalid_param');
  const wd = cal.workingDays(app, empRec.id, start, end);
  if (wd.outside.length > 0) throw util.fail(400, wd.outside[0] < empRec.getString('start_day') ? 'That is before the first day of work (' + empRec.getString('start_day') + ').' : 'That is after the last day of work (' + empRec.getString('end_day') + ').', 'outside_employment');
  const off = {};
  for (const d of wd.off) off[d] = true;
  const hol = {};
  for (const h of wd.holidays) hol[h.day] = h;
  const unit = t.getString('unit') || 'day';
  const shape = lv().weekShape(S, empRec.id, start);
  const avgHours = shape.days > 0 ? shape.hours / shape.days : 8;
  const out = [];
  let days = 0;
  let amount = 0;
  let hrs = 0;
  for (let d = start; d <= end; d = util.dayAdd(d, 1)) {
    let base = 1;
    if (t.getBool('counts_weekends')) base = 1;
    else if (off[d]) base = 0;
    else if (hol[d]) base = t.getBool('counts_holidays') ? 1 : hol[d].half ? 0.5 : 0;
    if (base === 0) continue;
    let part = 1;
    let half = '';
    if (start === end && sh !== '') {
      part = 0.5;
      half = sh;
    } else {
      if (d === start && sh === 'pm') {
        part = 0.5;
        half = 'pm';
      }
      if (d === end && eh === 'am' && start !== end) {
        part = 0.5;
        half = 'am';
      }
    }
    const dayHours = (cal.expectedMinutes(app, empRec.id, d) || 0) / 60 || avgHours;
    let dDays;
    let dAmount;
    let dHours = 0;
    if (hours > 0) {
      const exp = (cal.expectedMinutes(app, empRec.id, d) || 0) / 60;
      if (exp <= 0) throw util.fail(400, d + ' is not a working day for this person; hours of leave need a working day.', 'invalid_param');
      if (hours > exp + 0.001) throw util.fail(400, 'That day has ' + lv().r2(exp) + ' working hours; take a full day instead.', 'invalid_param');
      dDays = lv().r2(Math.min(base, hours / exp));
      dHours = hours;
      dAmount = unit === 'hour' ? lv().r2(hours) : dDays;
    } else {
      dDays = base * part;
      dAmount = unit === 'hour' ? lv().r2(dayHours * dDays) : dDays;
      if (unit === 'hour') dHours = dAmount;
    }
    if (dAmount <= 0) continue;
    out.push({ day: d, days: lv().r2(dDays), amount: dAmount, hours: dHours, half: half });
    days += dDays;
    amount += dAmount;
    hrs += dHours;
  }
  const inRange = wd.holidays.map((h) => ({ day: h.day, name: h.name, half: h.half }));
  return { day_list: out, days: lv().r2(days), amount: lv().r2(amount), hours: lv().r2(hrs), unit: unit, holidays: inRange, off: wd.off };
}

/* -------------------------------------------------------------- checks */

/** The people whose absence matters to this one: same department or same manager in the same entity, and the manager. */
function teamOf(app, empRec, day) {
  const util = u();
  const people = L('lib_people');
  const job = people.rowOn(app, 'job_records', empRec.id, day);
  const dep = job !== null ? job.getString('department') : '';
  const mgr = job !== null ? job.getString('manager') : '';
  const ids = {};
  const rows = util.rows(
    app,
    "SELECT m.id AS id, COALESCE(j.department, '') AS dep, COALESCE(j.manager, '') AS mgr FROM employments m LEFT JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= {:d} ORDER BY j2.effective_from DESC LIMIT 1) WHERE m.entity = {:e} AND m.id != {:x} AND m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d})",
    { id: '', dep: '', mgr: '' },
    { e: empRec.getString('entity'), x: empRec.id, d: day },
  );
  for (const r of rows) if ((dep !== '' && r.dep === dep) || (mgr !== '' && r.mgr === mgr) || r.mgr === empRec.getString('employee')) ids[r.id] = true;
  if (mgr !== '') {
    const me = people.primaryEmployment(app, mgr, day);
    if (me !== '') ids[me] = true;
  }
  delete ids[empRec.id];
  return Object.keys(ids);
}

/** Leave of these employments overlapping [from, to] (approved, waiting or being cancelled). */
function awayBetween(app, ids, from, to, S) {
  const util = u();
  if (ids.length === 0) return [];
  const bind = { f: from, t: to };
  const keys = ids.map((id, i) => {
    bind['i' + i] = id;
    return '{:i' + i + '}';
  });
  return util
    .rows(app, "SELECT id FROM leave_requests WHERE [[start]] <= {:t} AND [[end]] >= {:f} AND status IN ('pending', 'approved', 'cancelling') AND employment IN (" + keys.join(',') + ') ORDER BY [[start]]', { id: '' }, bind)
    .map((x) => requestView(app, app.findRecordById('leave_requests', x.id), S));
}

function warn(list, code, severity, message, extra) {
  list.push(Object.assign({ code: code, severity: severity, message: message }, extra || {}));
}

/**
 * Everything the form shows before submit, and what submit enforces:
 * { employment, person, type, plan, before, after, warnings, clashes, blocks, needs_attachment, can_override }.
 */
function evaluate(ctx, p, S) {
  const util = u();
  const app = ctx.app;
  const emp = lv().employmentParam(ctx, p);
  const access = lv().needAct(ctx, emp);
  const t = lv().typeRef(S, emp.getString('entity'), util.req(p, 'type', 'annual'));
  if (t.getBool('archived')) throw util.fail(409, t.getString('name') + ' is no longer used.', 'invalid');
  const start = util.day(p, 'start', '');
  if (start === '') throw util.fail(400, 'start is required, e.g. --start 2026-12-21', 'missing_param', { param: 'start' });
  const end = util.day(p, 'end', start);
  if (end < start) throw util.fail(400, 'end is before start.', 'invalid_param', { param: 'end' });
  const sh = util.oneOf(p, 'start_half', ['am', 'pm', ''], '');
  const eh = util.oneOf(p, 'end_half', ['am', ''], '');
  const hours = util.num(p, 'hours', { min: 0, max: 24 }) || 0;
  if ((sh !== '' || eh !== '') && !t.getBool('allow_half')) throw util.fail(400, t.getString('name') + ' is taken in whole days.', 'invalid_param');
  if (hours > 0 && !t.getBool('allow_hours')) throw util.fail(400, t.getString('name') + ' is not taken in hours.', 'invalid_param');
  if (hours > 0 && (start !== end || sh !== '' || eh !== '')) throw util.fail(400, 'Hours of leave are for one day without half days.', 'invalid_param');
  const code = t.getString('code');
  const rule = lv().ruleFor(S, emp, code, start);
  const person = lv().personOf(app, emp);
  if (rule === null) throw util.fail(400, t.getString('name') + ' is not in the leave policy ' + (L('lib_auth').selfEmployee(ctx) === emp.getString('employee') ? 'you follow' : person.name + ' follows') + ' on ' + start + '.', 'not_in_policy', { type: code });
  const plan = dayPlan(S, emp, t, start, end, sh, eh, hours);
  if (plan.amount <= 0) throw util.fail(400, 'Those days are all days off or holidays: there is nothing to take.', 'no_days');
  const today = lv().todayOf(S, emp.getString('entity'));
  const warnings = [];
  const ignore = util.str(p, 'request', '');
  // Overlaps with this person's own leave (half days on different halves may share a day).
  const mine = util.findMany(app, 'leave_requests', "employment = {:e} && start <= {:t} && end >= {:f} && (status = 'pending' || status = 'approved' || status = 'cancelling')", 'start', 0, { e: emp.id, f: start, t: end }).filter((r) => r.id !== ignore);
  for (const r of mine) {
    const other = util.jsonOf(r, 'day_list', []) || [];
    for (const d of plan.day_list) {
      const o = other.filter((x) => x.day === d.day)[0];
      if (!o) continue;
      const hoursBoth = d.hours > 0 && Number(o.hours) > 0 && !d.half && !o.half && (Number(o.days) || 0) + d.days <= 1;
      const halves = d.half !== '' && o.half !== '' && d.half !== o.half;
      if (!hoursBoth && !halves) {
        warn(warnings, 'overlap', 'stop', 'There is already leave on ' + d.day + ' (' + lv().typeById(S, r.getString('type')).getString('name') + ', ' + r.getString('status') + ').', { request: r.id });
        break;
      }
    }
  }
  const maxRun = t.getInt('max_consecutive_days');
  const span = t.getBool('counts_weekends') ? util.daysBetween(start, end) + 1 : plan.days;
  if (maxRun > 0 && span > maxRun) warn(warnings, 'too_long', 'stop', t.getString('name') + ' is at most ' + maxRun + ' days at a time; this is ' + span + '.');
  const notice = t.getInt('min_notice_days');
  if (notice > 0 && util.daysBetween(today, start) < notice) warn(warnings, 'notice', 'block', t.getString('name') + ' needs ' + notice + (notice === 1 ? ' day' : ' days') + "' notice; this starts " + (start < today ? 'in the past' : util.daysBetween(today, start) === 0 ? 'today' : 'in ' + util.daysBetween(today, start) + ' days') + '.');
  const blocks = L('lib_leave_admin').blocksFor(app, emp, start, end, code);
  for (const b of blocks) warn(warnings, 'locked', 'block', 'Leave is locked from ' + b.from + ' to ' + b.to + ': ' + b.reason + '.', { block: b.id });
  const after = t.getInt('attachment_after_days');
  const needsAttachment = after > 0 && plan.days >= after;
  if (needsAttachment) warn(warnings, 'attachment', 'warn', 'A certificate is needed for ' + (after === 1 ? 'any ' : after + ' days or more of ') + t.getString('name').toLowerCase() + '; add it now or later.');
  // The balance, with this request and what is already waiting.
  let before = null;
  let afterBal = null;
  const balanceCheck = (tt, label) => {
    const r = lv().ruleFor(S, emp, tt.getString('code'), start);
    if (!lv().tracked(r)) return null;
    const pend = lv().pendingOf(S, emp.id, tt.id).filter((x) => x.id !== ignore);
    const extra = [];
    for (const x of pend) for (const d of x.days) extra.push({ day: d.day, amount: Number(d.amount) || 0, ref: x.id });
    for (const d of plan.day_list) extra.push({ day: d.day, amount: d.amount, ref: 'new' });
    let horizon = end;
    for (const x of extra) if (x.day > horizon) horizon = x.day;
    for (const row of lv().ledgerRows(S, emp.id, tt.id)) if (row.day > horizon && row.kind === 'take') horizon = row.day;
    const sim = lv().simulate(S, emp, tt, horizon, { extra: extra, minFrom: start });
    const base = lv().balanceInfo(S, emp, tt, today > start ? start : today, {});
    const floor = tt.getBool('allow_negative') ? (tt.getFloat('max_negative') > 0 ? -tt.getFloat('max_negative') : -Infinity) : 0;
    const low = sim.min === null ? sim.balance : sim.min;
    if (low < floor - 0.001) {
      const unit = tt.getString('unit');
      warn(warnings, 'balance', 'block', (label ? label + ': ' : '') + 'Not enough ' + tt.getString('name') + ': ' + (base.available === null ? 0 : base.available) + ' ' + unitWord(unit, base.available) + ' available, this needs ' + plan.amount + '.' + (floor < 0 && floor > -Infinity ? ' At most ' + -floor + ' below zero is allowed.' : ''), { type: tt.getString('code') });
    }
    return { available: base.available, after: lv().r2(low), balance_after: sim.balance, unit: tt.getString('unit') };
  };
  const own = balanceCheck(t, '');
  if (own !== null) {
    before = own.available;
    afterBal = lv().r2((own.available || 0) - plan.amount);
  }
  for (const other of lv().typesFor(S, emp.getString('entity'), false)) {
    if (other.id === t.id) continue;
    const r = lv().ruleFor(S, emp, other.getString('code'), start);
    if (r && Array.isArray(r.includes) && r.includes.indexOf(code) >= 0) balanceCheck(other, other.getString('name') + ' (it includes ' + t.getString('name').toLowerCase() + ')');
  }
  // Hours of leave per year (Japan: at most 5 days a year in hours).
  if (hours > 0 && rule.max_hours_per_year > 0) {
    const sim = lv().simulate(S, emp, t, today, {});
    const frame = lv().frameOf(S, emp, t, start, sim);
    let used = 0;
    for (const r of util.findMany(app, 'leave_requests', "employment = {:e} && type = {:t} && hours > 0 && start >= {:f} && start <= {:to} && (status = 'pending' || status = 'approved' || status = 'cancelling')", '', 0, { e: emp.id, t: t.id, f: frame.start, to: frame.end })) if (r.id !== ignore) used += r.getFloat('hours');
    if (used + hours > rule.max_hours_per_year + 0.001) warn(warnings, 'hours_cap', 'block', 'At most ' + rule.max_hours_per_year + ' hours of ' + t.getString('name') + ' a year are taken by the hour; ' + lv().r2(used) + ' are used.');
  }
  // Who else is away.
  const team = teamOf(app, emp, start);
  const seeTypes = access === 'team' || access === 'view' || access === 'edit' || access === 'full' || ctx.isAgent;
  const clashes = awayBetween(app, team, start, end, S).map((v) => (seeTypes && L('lib_leave').typeById(S, v.type_id).getString('visibility') !== 'away' ? v : awayView(v)));
  if (clashes.length > 0) warn(warnings, 'clash', 'info', clashes.length + (clashes.length === 1 ? ' person' : ' people') + ' in the team ' + (clashes.length === 1 ? 'is' : 'are') + ' away on some of these days.');
  const canOverride = access === 'team' || access === 'edit' || access === 'full';
  return { employment: emp, access: access, person: person, type: t, rule: rule, start: start, end: end, sh: sh, eh: eh, hours: hours, plan: plan, before: before, after: afterBal, warnings: warnings, clashes: clashes, blocks: blocks, needs_attachment: needsAttachment, can_override: canOverride, today: today };
}

function evaluationOut(ev) {
  const stop = ev.warnings.filter((w) => w.severity === 'stop');
  const block = ev.warnings.filter((w) => w.severity === 'block');
  return {
    employment: ev.employment.id,
    person: ev.person,
    type: lv().typeView(ev.type),
    method: ev.rule ? ev.rule.method : '',
    start: ev.start,
    end: ev.end,
    start_half: ev.sh,
    end_half: ev.eh,
    hours: ev.hours,
    days: ev.plan.days,
    amount: ev.plan.amount,
    unit: ev.plan.unit,
    day_list: ev.plan.day_list,
    holidays: ev.plan.holidays,
    before: ev.before,
    after: ev.after,
    warnings: ev.warnings,
    clashes: ev.clashes,
    blocks: ev.blocks,
    needs_attachment: ev.needs_attachment,
    can_submit: stop.length === 0 && block.length === 0,
    can_override: ev.can_override && stop.length === 0 && block.length > 0,
  };
}

/** leave.check: the preview of a request (nothing is written). */
function check(ctx, p) {
  const S = lv().session(ctx.app);
  return evaluationOut(evaluate(ctx, p, S));
}

/* ------------------------------------------------------------ requests */

/** "Annual leave, 3 days (Sam Wong)": the days themselves travel as fields (start, end, days) for the client to format. */
/** Structured facts of a request for approvals and notifications (lib_util.facts shape); the summary stays for the CLI. */
function requestFacts(v) {
  const hours = v.unit === 'hour';
  return [
    { type: 'range', key: 'dates', label: 'Dates', from: v.start, to: v.end },
    { type: 'number', key: 'amount', label: hours ? 'Hours' : 'Days', value: hours ? v.amount : v.days, unit: unitWord(v.unit, hours ? v.amount : v.days) },
    { type: 'text', key: 'type', label: 'Type', value: v.type_name },
  ];
}

function summaryOf(v, person) {
  const half = v.start === v.end && v.start_half !== '' ? (v.start_half === 'am' ? ', morning' : ', afternoon') : '';
  return v.type_name + ', ' + v.days + (v.days === 1 ? ' day' : ' days') + (v.hours > 0 ? ' (' + v.hours + ' h)' : '') + half + ' (' + person + ')';
}

/** Ledger rows for the days of a request (and the types that include its type), from `fromDay` on. sign -1 takes, +1 gives back. */
function writeTakes(ctx, tx, reqRec, sign, fromDay, note) {
  const util = u();
  const S = lv().session(tx);
  const emp = tx.findRecordById('employments', reqRec.getString('employment'));
  const t = tx.findRecordById('leave_types', reqRec.getString('type'));
  const code = t.getString('code');
  const list = (util.jsonOf(reqRec, 'day_list', []) || []).filter((d) => d.day >= (fromDay || ''));
  const others = lv()
    .typesFor(S, emp.getString('entity'), true)
    .filter((o) => o.id !== t.id);
  let n = 0;
  for (const d of list) {
    const targets = [];
    if (lv().tracked(lv().ruleFor(S, emp, code, d.day))) targets.push({ type: t, why: '' });
    for (const o of others) {
      const r = lv().ruleFor(S, emp, o.getString('code'), d.day);
      if (r && lv().tracked(r) && Array.isArray(r.includes) && r.includes.indexOf(code) >= 0) targets.push({ type: o, why: ' (counts toward ' + o.getString('name') + ')' });
    }
    for (const x of targets) {
      const amt = x.type.id === t.id ? Number(d.amount) || 0 : x.type.getString('unit') === t.getString('unit') ? Number(d.amount) || 0 : Number(d.days) || 0;
      if (amt === 0) continue;
      L('lib_leave_admin').writeRow(ctx, tx, emp.id, x.type.id, d.day, sign < 0 ? -amt : amt, 'take', reqRec.id, (note || (sign < 0 ? 'Leave ' : 'Given back: ') + fmtRange(reqRec.getString('start'), reqRec.getString('end'))) + x.why, '');
      n++;
    }
  }
  lv().syncEmployment(null, tx, emp.id);
  return n;
}

function request(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const ev = evaluate(ctx, p, S);
  const stop = ev.warnings.filter((w) => w.severity === 'stop');
  if (stop.length > 0) throw util.fail(409, stop[0].message, stop[0].code, { warnings: ev.warnings });
  const blocking = ev.warnings.filter((w) => w.severity === 'block');
  const override = util.bool(p, 'override', false);
  if (blocking.length > 0 && !(override && ev.can_override)) throw util.fail(409, blocking[0].message + (ev.can_override ? ' Submit with override to go ahead.' : ''), blocking[0].code, { warnings: ev.warnings, can_override: ev.can_override });
  const record = util.bool(p, 'record', false);
  if (record && !(ev.access === 'full' && !ctx.isAgent)) throw util.fail(403, 'Recording leave without approval needs full access to Leave.', 'not_permitted');
  const reason = util.text(p, 'reason', 2000, '');
  if (override && blocking.length > 0 && util.squash(reason) === '') throw util.fail(400, 'Say why in the reason when you go past ' + blocking.map((w) => w.code).join(', ') + '.', 'missing_param', { param: 'reason' });
  const file = L('lib_files').fileParam(ctx, p, 'attachment', 'path');
  let rec = null;
  let approval = null;
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    rec = util.newRecord(tx, 'leave_requests');
    rec.set('employment', ev.employment.id);
    rec.set('type', ev.type.id);
    rec.set('start', ev.start);
    rec.set('end', ev.end);
    rec.set('start_half', ev.sh);
    rec.set('end_half', ev.eh);
    rec.set('hours', ev.plan.hours > 0 && ev.hours > 0 ? ev.hours : 0);
    rec.set('days', ev.plan.days);
    rec.set('amount', ev.plan.amount);
    rec.set('unit', ev.plan.unit);
    rec.set('day_list', ev.plan.day_list);
    rec.set('reason', reason);
    if (file !== null) rec.set('attachment', file);
    rec.set('status', record ? 'approved' : 'pending');
    rec.set('requested_by', ctx.memberId || '');
    rec.set('actor', ctx.isAgent ? 'agent' : 'person');
    rec.set('warnings', ev.warnings.map((w) => Object.assign({}, w, w.severity === 'block' ? { overridden: true } : {})));
    rec.set('recorded', record);
    if (record) {
      rec.set('decided_note', 'Recorded by ' + ctx.name);
      rec.set('decided_at', util.nowIso());
    }
    tx.save(rec);
    const v = requestView(tx, rec);
    if (record) writeTakes(tctx, tx, rec, -1, '', '');
    else {
      approval = L('lib_approvals').open(tctx, { kind: 'leave_request', ref_collection: 'leave_requests', ref_id: rec.id, employment: ev.employment.id, summary: summaryOf(v, ev.person.name), days: ev.plan.days, facts: requestFacts(v), payload: { action: 'request', type: v.type, type_name: v.type_name, start: v.start, end: v.end, days: v.days, amount: v.amount, unit: v.unit, hours: v.hours, overridden: blocking.map((w) => w.code), needs_attachment: ev.needs_attachment } });
      const fresh = tx.findRecordById('leave_requests', rec.id);
      fresh.set('approval', approval.id);
      tx.save(fresh);
    }
    L('lib_audit').write(tctx, { op: ctx.op || 'leave.request', collection: 'leave_requests', record: rec.id, summary: (record ? 'Recorded ' : 'Requested ') + summaryOf(v, ev.person.name) + (blocking.length > 0 ? ' (past: ' + blocking.map((w) => w.code).join(', ') + ')' : ''), after: { type: v.type, start: v.start, end: v.end, days: v.days } });
  });
  ctx.audited = true;
  const out = requestView(app, app.findRecordById('leave_requests', rec.id));
  if (ev.person.member !== '' && ev.person.member !== ctx.memberId) L('lib_notify').notify(app, [ev.person.member], { kind: 'leave', title: (record ? 'Leave recorded for you: ' : 'Leave requested for you: ') + ev.type.getString('name') + ', ' + fmtRange(ev.start, ev.end), body: '', link: '#/leave/requests/' + rec.id, facts: [{ type: 'state', key: 'status', value: out.status }].concat(requestFacts(out)) });
  return { request: out, approval: approval, next: out.status === 'approved' ? 'approved' : 'waiting' };
}

/** Proposal preview of a request your AI agent drafted: days, balance before and after, warnings. */
function previewRequest(ctx, p) {
  const S = lv().session(ctx.app);
  const ev = evaluate(ctx, p, S);
  const fields = [
    { name: 'type', before: '', after: ev.type.getString('name') },
    { name: 'days', before: '', after: fmtRange(ev.start, ev.end) + ' (' + ev.plan.days + ' ' + unitWord('day', ev.plan.days) + ')' },
  ];
  if (ev.before !== null) fields.push({ name: 'available', before: ev.before, after: ev.after });
  return { label: 'Request ' + ev.type.getString('name') + ' for ' + ev.person.name + ', ' + fmtRange(ev.start, ev.end), target: 'employments:' + ev.employment.id, fields: fields, notes: ev.warnings.map((w) => w.message), risk: ev.warnings.some((w) => w.severity !== 'info') ? 'medium' : 'low' };
}

function reqRef(app, id) {
  const r = u().byId(app, 'leave_requests', String(id || ''));
  if (r === null) throw u().fail(404, 'No leave request ' + id + '. Run leave.requests.', 'not_found');
  return r;
}

/** Withdraw a request that is still waiting. */
function withdraw(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reqRef(app, util.req(p, 'request'));
  const emp = app.findRecordById('employments', r.getString('employment'));
  lv().needAct(ctx, emp);
  if (r.getString('status') !== 'pending') throw util.fail(409, 'Only a request that is waiting can be withdrawn; this one is ' + r.getString('status') + '. Cancel it instead.', 'conflict');
  const ap = util.byId(app, 'approvals', r.getString('approval'));
  const note = util.text(p, 'note', 2000, '');
  if (ap !== null && ap.getString('status') === 'pending') {
    const mine = ctx.memberId !== '' && ap.getString('requester') === ctx.memberId;
    const actor = mine || L('lib_auth').can(ctx, 'leave', 'full') ? ctx : L('lib_auth').systemCtx(app);
    L('lib_approvals').cancel(actor, ap.id, note || 'Withdrawn by ' + ctx.name);
  } else {
    r.set('status', 'withdrawn');
    app.save(r);
  }
  ctx.audited = false;
  L('lib_audit').note(ctx, { collection: 'leave_requests', record: r.id, summary: 'Withdrew the leave request ' + fmtRange(r.getString('start'), r.getString('end')) });
  return { request: requestView(app, app.findRecordById('leave_requests', r.id)) };
}

/** Give back the days of an approved request from `from` on; shorten it or mark it cancelled. */
function applyCancel(ctx, tx, r, from, reason) {
  const util = u();
  const start = r.getString('start');
  const day = from && from > start ? from : start;
  writeTakes(ctx, tx, r, +1, day, 'Cancelled: ' + fmtRange(day, r.getString('end')));
  if (day > start) {
    const list = (util.jsonOf(r, 'day_list', []) || []).filter((d) => d.day < day);
    r.set('day_list', list);
    r.set('end', util.dayAdd(day, -1));
    let days = 0;
    let amount = 0;
    for (const d of list) {
      days += Number(d.days) || 0;
      amount += Number(d.amount) || 0;
    }
    r.set('days', lv().r2(days));
    r.set('amount', lv().r2(amount));
    r.set('end_half', '');
    r.set('status', 'approved');
  } else r.set('status', 'cancelled');
  r.set('cancel_from', day);
  r.set('cancel_reason', util.clip(reason || '', 2000));
  tx.save(r);
}

/**
 * Cancel approved leave (or withdraw a waiting request). Leave that has not
 * started is cancelled at once; leave that started goes back for approval,
 * unless HR (full access to Leave) cancels it.
 */
function cancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reqRef(app, util.req(p, 'request'));
  const emp = app.findRecordById('employments', r.getString('employment'));
  const access = lv().needAct(ctx, emp);
  const status = r.getString('status');
  if (status === 'pending') return withdraw(ctx, { request: r.id, note: util.str(p, 'reason', '') });
  if (status === 'cancelling') throw util.fail(409, 'A cancellation of this leave is already waiting for a decision.', 'conflict');
  if (status !== 'approved') throw util.fail(409, 'This request is ' + status + '.', 'conflict');
  const today = lv().todayOf(lv().session(app), emp.getString('entity'));
  const from = util.day(p, 'from', r.getString('start'));
  if (from < r.getString('start') || from > r.getString('end')) throw util.fail(400, 'from must be a day of the leave (' + fmtRange(r.getString('start'), r.getString('end')) + ').', 'invalid_param', { param: 'from' });
  const reason = util.text(p, 'reason', 2000, '');
  const started = r.getString('start') <= today;
  const person = lv().personOf(app, emp);
  const t = app.findRecordById('leave_types', r.getString('type'));
  let approval = null;
  let direct = !started || access === 'full' || r.getBool('recorded');
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    const fresh = tx.findRecordById('leave_requests', r.id);
    if (direct) {
      applyCancel(tctx, tx, fresh, from, reason);
      L('lib_audit').write(tctx, { op: 'leave.cancel', collection: 'leave_requests', record: r.id, summary: 'Cancelled ' + t.getString('name') + ' of ' + person.name + ' from ' + from + (reason ? ' (' + util.clip(reason, 160) + ')' : '') });
    } else {
      approval = L('lib_approvals').open(tctx, { kind: 'leave_request', ref_collection: 'leave_requests', ref_id: r.id, employment: emp.id, summary: 'Cancel ' + (from > r.getString('start') ? 'the rest of ' : '') + t.getString('name') + ' (' + person.name + ')', days: 0, facts: [{ type: 'state', key: 'action', label: 'Asks to', value: 'cancel' }, { type: 'range', key: 'dates', label: 'Cancel', from: from, to: r.getString('end') }, { type: 'text', key: 'type', label: 'Type', value: t.getString('name') }], payload: { action: 'cancel', from: from, type: t.getString('code'), type_name: t.getString('name'), start: r.getString('start'), end: r.getString('end'), reason: reason } });
      const again = tx.findRecordById('leave_requests', r.id);
      if (approval.status === 'pending') {
        again.set('status', 'cancelling');
        again.set('cancel_approval', approval.id);
        again.set('cancel_from', from);
        again.set('cancel_reason', util.clip(reason, 2000));
        tx.save(again);
      }
      L('lib_audit').write(tctx, { op: 'leave.cancel', collection: 'leave_requests', record: r.id, summary: 'Asked to cancel ' + t.getString('name') + ' of ' + person.name + ' from ' + from + ' (it had started)' });
    }
  });
  ctx.audited = true;
  return { request: requestView(app, app.findRecordById('leave_requests', r.id)), approval: approval, cancelled: direct };
}

/** The kernel calls this on every final decision of leave_request (requests and cancellations). */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const tx = ctx.app;
  const r = tx.findRecordById(approval.ref_collection === 'leave_requests' ? 'leave_requests' : approval.ref_collection, approval.ref_id);
  const action = (approval.payload && approval.payload.action) || 'request';
  const person = lv().personOf(tx, tx.findRecordById('employments', r.getString('employment')));
  if (action === 'cancel') {
    if (r.getString('status') !== 'cancelling') return;
    if (decision === 'approved') {
      r.set('decided_note', util.clip(note || '', 2000));
      applyCancel(ctx, tx, r, approval.payload.from || r.getString('start'), approval.payload.reason || '');
    } else {
      r.set('status', 'approved');
      r.set('cancel_from', '');
      tx.save(r);
    }
  } else {
    if (r.getString('status') !== 'pending') return;
    if (decision === 'approved') {
      r.set('status', 'approved');
      r.set('decided_note', util.clip(note || '', 2000));
      r.set('decided_at', util.nowIso());
      tx.save(r);
      writeTakes(ctx, tx, r, -1, '', '');
    } else {
      r.set('status', decision === 'rejected' ? 'rejected' : 'withdrawn');
      r.set('decided_note', util.clip(note || '', 2000));
      r.set('decided_at', util.nowIso());
      tx.save(r);
    }
  }
  if (person.member !== '' && person.member !== approval.requester && decision !== 'cancelled') L('lib_notify').notify(tx, [person.member], { kind: 'leave', title: (decision === 'approved' ? 'Approved: ' : 'Not approved: ') + approval.summary, body: note || '', link: '#/leave/requests/' + r.id, facts: [{ type: 'state', key: 'status', value: decision }].concat(approval.facts || []).concat(note ? [{ type: 'text', key: 'note', label: 'Note', value: note }] : []) });
}

function attach(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reqRef(app, util.req(p, 'request'));
  lv().needAct(ctx, app.findRecordById('employments', r.getString('employment')));
  const f = L('lib_files').fileParam(ctx, p, 'attachment', 'path');
  if (f === null) throw util.fail(400, 'Add the file (a photo or a PDF of the certificate).', 'missing_param', { param: 'attachment' });
  r.set('attachment', f);
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'leave_requests', record: r.id, summary: 'Added a certificate to the leave request ' + fmtRange(r.getString('start'), r.getString('end')) });
  return { request: requestView(app, r) };
}

function attachmentFile(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reqRef(app, util.req(p, 'request'));
  const a = lv().access(ctx, app.findRecordById('employments', r.getString('employment')));
  const approver = (() => {
    const ap = util.byId(app, 'approvals', r.getString('approval'));
    return ap !== null && (util.jsonOf(ap, 'approvers', []) || []).indexOf(ctx.memberId) >= 0;
  })();
  if (a === 'none' && !approver) throw util.fail(403, 'You cannot open this certificate.', 'not_permitted');
  return L('lib_files').serve(ctx, r, 'attachment', 'Leave certificate ' + r.getString('start'), util.bool(p, 'download', false));
}

/* -------------------------------------------------------------- reads */

/** Employment ids the caller may list in a view: mine | team | all. */
function scopeIds(ctx, which, day) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  if (which === 'mine') {
    const self = auth.selfEmployee(ctx);
    if (self === '') return [];
    return util.rows(app, 'SELECT id FROM employments WHERE employee = {:e}', { id: '' }, { e: self }).map((r) => r.id);
  }
  if (which === 'team') {
    if (!ctx.teamScope || ctx.employeeId === '') return [];
    return L('lib_people')
      .reportsOf(app, ctx.employeeId, day, true)
      .map((r) => r.employment);
  }
  return null;
}

function requestsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const S = lv().session(app);
  const today = util.today(app);
  const which = util.oneOf(p, 'view', ['mine', 'team', 'all'], ctx.isAgent || auth.can(ctx, 'leave', 'view') ? 'all' : ctx.teamScope ? 'team' : 'mine');
  const pg = util.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  const status = util.str(p, 'status', '');
  if (status !== '' && status !== 'any') {
    const list = status === 'open' ? OPEN : status.split(',');
    where.push('r.status IN (' + list.map((s, i) => ((bind['st' + i] = s), '{:st' + i + '}')).join(',') + ')');
  }
  const empRef = util.str(p, 'employment', '');
  if (empRef !== '') {
    const emp = L('lib_people').employmentRef(app, empRef);
    lv().needSee(ctx, emp);
    where.push('r.employment = {:emp}');
    bind.emp = emp.id;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('[[r.end]] >= {:from}');
    bind.from = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('[[r.start]] <= {:to}');
    bind.to = to;
  }
  const typeCode = util.str(p, 'type', '');
  if (typeCode !== '') {
    where.push('(t.code = {:tc} OR t.id = {:tc})');
    bind.tc = typeCode;
  }
  const entRef = util.str(p, 'entity', '');
  if (entRef !== '') {
    where.push('m.entity = {:ent}');
    bind.ent = L('lib_org').entityRef(app, entRef).id;
  }
  if (empRef === '') {
    const ids = scopeIds(ctx, which, today);
    if (ids !== null) {
      if (ids.length === 0) return { requests: [], total: 0, view: which };
      where.push('r.employment IN (' + ids.map((id, i) => ((bind['i' + i] = id), '{:i' + i + '}')).join(',') + ')');
    } else {
      if (!ctx.isAgent && !auth.can(ctx, 'leave', 'view')) throw util.fail(403, 'Your role sees its own and its team\'s leave only.', 'not_permitted');
      const sc = auth.scope(ctx);
      if (sc.length > 0) where.push('m.entity IN (' + sc.map((id, i) => ((bind['s' + i] = id), '{:s' + i + '}')).join(',') + ')');
    }
  }
  const sql = ' FROM leave_requests r JOIN employments m ON m.id = r.employment JOIN leave_types t ON t.id = r.type WHERE ' + where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n' + sql, bind);
  const order = util.oneOf(p, 'sort', ['start', 'recent'], 'recent') === 'start' ? '[[r.start]], r.created' : "r.status = 'pending' DESC, r.created DESC";
  const rows = util.rows(app, 'SELECT r.id AS id' + sql + ' ORDER BY ' + order + ' LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return { requests: rows.map((x) => requestView(app, app.findRecordById('leave_requests', x.id), S)), total: total, view: which };
}

function requestGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reqRef(app, util.req(p, 'request'));
  const emp = app.findRecordById('employments', r.getString('employment'));
  const ap = util.byId(app, 'approvals', r.getString('approval'));
  const cap = util.byId(app, 'approvals', r.getString('cancel_approval'));
  const isApprover = (a) => a !== null && (util.jsonOf(a, 'approvers', []) || []).indexOf(ctx.memberId) >= 0;
  const a = lv().access(ctx, emp);
  if (a === 'none' && !isApprover(ap) && !isApprover(cap)) throw util.fail(403, 'You cannot see this request.', 'not_permitted');
  const v = requestView(app, r);
  const today = util.today(app, emp.getString('entity'));
  const canAct = a === 'self' || a === 'team' || a === 'edit' || a === 'full';
  const S = lv().session(app);
  const t = lv().typeById(S, r.getString('type'));
  return {
    request: v,
    approval: ap !== null ? L('lib_approvals').view(app, ap) : null,
    cancel_approval: cap !== null ? L('lib_approvals').view(app, cap) : null,
    balance: a !== 'none' ? lv().balanceInfo(S, emp, t, today, {}) : null,
    can: {
      withdraw: canAct && v.status === 'pending',
      cancel: canAct && v.status === 'approved',
      attach: canAct && ['pending', 'approved', 'cancelling'].indexOf(v.status) >= 0,
      started: v.start <= today,
      decide: (ap !== null && ap.getString('status') === 'pending' && L('lib_approvals').standing(ctx, ap) !== '') || (cap !== null && cap.getString('status') === 'pending' && L('lib_approvals').standing(ctx, cap) !== ''),
    },
  };
}

/* --------------------------------------------------------- cash in leave */

function encashView(app, r, S) {
  const t = lv().typeById(S, r.getString('type'));
  const emp = lv().employmentOf(S, r.getString('employment'));
  const person = emp ? lv().personOf(app, emp) : { number: '', name: '' };
  return { id: r.id, employment: r.getString('employment'), number: person.number, name: person.name, type: t ? t.getString('code') : '', type_name: t ? t.getString('name') : '', days: r.getFloat('days'), reason: r.getString('reason'), status: r.getString('status'), approval: r.getString('approval'), pay_on: r.getString('pay_on'), payrun: r.getString('payrun'), paid_at: r.getString('paid_at'), reserved_for: r.getString('reserved_for'), kind: r.getString('kind') || 'voluntary', separation: r.getString('separation'), pay_history: u().jsonOf(r, 'pay_history', []) || [], decided_note: r.getString('decided_note'), created: r.getString('created') };
}

function encashRequest(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const emp = lv().employmentParam(ctx, p);
  lv().needAct(ctx, emp);
  const t = lv().typeRef(S, emp.getString('entity'), util.req(p, 'type', 'annual'));
  if (!t.getBool('encashable')) throw util.fail(400, t.getString('name') + ' cannot be cashed in.', 'not_encashable');
  const days = util.num(p, 'days', { min: 0.5, max: 365 });
  if (days === null) throw util.fail(400, 'days is required, e.g. --days 3', 'missing_param', { param: 'days' });
  if (Math.round(days * 2) !== days * 2) throw util.fail(400, 'days is in half days (0.5, 1, 1.5 ...).', 'invalid_param');
  const today = lv().todayOf(S, emp.getString('entity'));
  const b = lv().balanceInfo(S, emp, t, today, {});
  const pendingEnc = util.rows(app, "SELECT COALESCE(SUM(days), 0) AS n FROM leave_encash_requests WHERE employment = {:e} AND type = {:t} AND status = 'pending'", { n: -0 }, { e: emp.id, t: t.id })[0].n;
  if (!b.tracked || (b.available || 0) - pendingEnc < days - 0.001) throw util.fail(409, 'Not enough ' + t.getString('name') + ' to cash in: ' + lv().r2((b.available || 0) - pendingEnc) + ' available.', 'balance');
  const rule = lv().ruleFor(S, emp, t.getString('code'), today);
  if (rule && rule.encash_max > 0) {
    const used = util.rows(app, "SELECT COALESCE(SUM(days), 0) AS n FROM leave_encash_requests WHERE employment = {:e} AND type = {:t} AND status IN ('pending', 'approved', 'paid') AND created >= {:f}", { n: -0 }, { e: emp.id, t: t.id, f: b.period.start + ' 00:00:00.000Z' })[0].n;
    if (used + days > rule.encash_max + 0.001) throw util.fail(409, 'At most ' + rule.encash_max + ' days of ' + t.getString('name') + ' can be cashed in a leave year; ' + used + ' are already.', 'encash_limit');
  }
  const person = lv().personOf(app, emp);
  let rec = null;
  let approval = null;
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    rec = util.newRecord(tx, 'leave_encash_requests');
    rec.set('employment', emp.id);
    rec.set('type', t.id);
    rec.set('days', days);
    rec.set('reason', util.text(p, 'reason', 2000, ''));
    rec.set('status', 'pending');
    rec.set('kind', 'voluntary');
    rec.set('pay_on', util.day(p, 'pay_on', ''));
    rec.set('requested_by', ctx.memberId || '');
    rec.set('actor', ctx.isAgent ? 'agent' : 'person');
    tx.save(rec);
    approval = L('lib_approvals').open(tctx, { kind: 'leave_encash', ref_collection: 'leave_encash_requests', ref_id: rec.id, employment: emp.id, summary: 'Cash in ' + days + (days === 1 ? ' day' : ' days') + ' of ' + t.getString('name') + ' (' + person.name + ')', days: days, facts: [{ type: 'number', key: 'days', label: 'Days to cash in', value: days, unit: unitWord('day', days) }, { type: 'text', key: 'type', label: 'Type', value: t.getString('name') }].concat(rec.getString('pay_on') !== '' ? [{ type: 'day', key: 'pay_on', label: 'Paid on', value: rec.getString('pay_on') }] : []), payload: { type: t.getString('code'), type_name: t.getString('name'), days: days } });
    const fresh = tx.findRecordById('leave_encash_requests', rec.id);
    fresh.set('approval', approval.id);
    tx.save(fresh);
    L('lib_audit').write(tctx, { op: 'leave.encash-request', collection: 'leave_encash_requests', record: rec.id, summary: 'Asked to cash in ' + days + ' days of ' + t.getString('name') + ' for ' + person.name });
  });
  ctx.audited = true;
  return { encash: encashView(app, app.findRecordById('leave_encash_requests', rec.id), S), approval: approval };
}

function onEncashDecision(ctx, approval, decision, note) {
  const util = u();
  const tx = ctx.app;
  const r = tx.findRecordById('leave_encash_requests', approval.ref_id);
  if (r.getString('status') !== 'pending') return;
  r.set('decided_note', util.clip(note || '', 2000));
  if (decision === 'approved') {
    const emp = tx.findRecordById('employments', r.getString('employment'));
    const day = r.getString('pay_on') || util.today(tx, emp.getString('entity'));
    r.set('pay_on', day);
    r.set('status', 'approved');
    tx.save(r);
    L('lib_leave_admin').writeRow(ctx, tx, emp.id, r.getString('type'), day, -r.getFloat('days'), 'encash', r.id, 'Cashed in (paid with the pay run covering ' + day + ')', '');
    lv().syncEmployment(null, tx, emp.id);
  } else {
    r.set('status', decision === 'rejected' ? 'rejected' : 'withdrawn');
    tx.save(r);
  }
}

function encashWithdraw(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'leave_encash_requests', util.req(p, 'encash'));
  if (r === null) throw util.fail(404, 'No such request to cash in leave.', 'not_found');
  lv().needAct(ctx, app.findRecordById('employments', r.getString('employment')));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'Only a waiting request can be withdrawn (this one is ' + r.getString('status') + ').', 'conflict');
  const ap = util.byId(app, 'approvals', r.getString('approval'));
  if (ap !== null && ap.getString('status') === 'pending') L('lib_approvals').cancel(ctx.memberId !== '' && ap.getString('requester') === ctx.memberId ? ctx : L('lib_auth').systemCtx(app), ap.id, 'Withdrawn by ' + ctx.name);
  L('lib_audit').note(ctx, { collection: 'leave_encash_requests', record: r.id, summary: 'Withdrew a request to cash in leave' });
  return { encash: encashView(app, app.findRecordById('leave_encash_requests', r.id), lv().session(app)) };
}

function encashList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const auth = L('lib_auth');
  const empRef = util.str(p, 'employment', '');
  let rows;
  if (empRef !== '') {
    const emp = L('lib_people').employmentRef(app, empRef);
    lv().needSee(ctx, emp);
    rows = util.findMany(app, 'leave_encash_requests', 'employment = {:e}', '-created', 200, { e: emp.id });
  } else if (ctx.isAgent || auth.can(ctx, 'leave', 'view') || auth.can(ctx, 'payroll', 'view')) {
    const st = util.str(p, 'status', '');
    rows = util.findMany(app, 'leave_encash_requests', st !== '' ? 'status = {:s}' : '1=1', '-created', 500, { s: st }).filter((r) => auth.inScope(ctx, app.findRecordById('employments', r.getString('employment')).getString('entity')) || ctx.isAgent);
  } else {
    const ids = scopeIds(ctx, 'mine', util.today(app));
    rows = util.findMany(app, 'leave_encash_requests', '1=1', '-created', 200).filter((r) => ids.indexOf(r.getString('employment')) >= 0);
  }
  return { encashments: rows.map((r) => encashView(app, r, S)) };
}

/* ------------------------------------------------- pay out on termination */

/**
 * Unused leave paid out on termination (types with payout_on_exit). A
 * separation (separation.approved, separation.changed) gives each such type of
 * the leaver one approved cash-in of kind `exit` for the balance on the last
 * day (accrual and grants prorated to it); payroll pays it with the final pay
 * through payInputs().encash. While it is unpaid, every later change (leave
 * taken before the last day, a moved last day, an adjustment) keeps it equal to
 * the balance; at zero it is withdrawn. A paid one never changes: more balance
 * later is a second cash-in, less is noted for payroll.
 * Hours types pay hours / the person's hours a day as days.
 */
function exitPayouts(ctx, tx, empId, separationId) {
  const util = u();
  const S = lv().session(tx);
  const emp = lv().employmentOf(S, empId);
  if (emp === null) return { changed: 0, payouts: [] };
  const sys = L('lib_auth').systemCtx(tx);
  const actx = ctx ? L('lib_auth').withApp(ctx, tx) : sys;
  const last = emp.getString('end_day');
  const existing = util.findMany(tx, 'leave_encash_requests', "employment = {:e} && kind = 'exit'", 'created', 0, { e: emp.id });
  const sep = separationId || (existing.length > 0 ? existing[existing.length - 1].getString('separation') : '');
  if (sep === '') return { changed: 0, payouts: [] };
  const byType = {};
  for (const r of existing) (byType[r.getString('type')] = byType[r.getString('type')] || []).push(r);
  const person = lv().personOf(tx, emp);
  const rowsOf = (r) => util.rows(tx, 'SELECT day, amount FROM leave_ledger WHERE employment = {:e} AND type = {:t} AND ref = {:r}', { day: '', amount: -0 }, { e: emp.id, t: r.getString('type'), r: r.id });
  const sumOf = (rows) => lv().r2(rows.reduce((a, x) => a + x.amount, 0));
  const shape = lv().weekShape(S, emp.id, last !== '' ? last : emp.getString('start_day'));
  const perDay = shape.days > 0 && shape.hours > 0 ? shape.hours / shape.days : 8;
  let changed = 0;
  const payouts = [];
  for (const t of lv().typesFor(S, emp.getString('entity'), true)) {
    const reqs = byType[t.id] || [];
    const pays = t.getBool('payout_on_exit') && !t.getBool('archived') && last !== '';
    if (!pays && reqs.length === 0) continue;
    const unit = t.getString('unit') || 'day';
    const asDays = (n) => (unit === 'hour' ? lv().r2(n / perDay) : n);
    const fixed = reqs.filter((r) => r.getString('status') === 'paid' || (r.getString('status') === 'approved' && r.getString('reserved_for') !== ''));
    const open = reqs.filter((r) => r.getString('status') === 'approved' && r.getString('reserved_for') === '');
    let fixedUnits = 0;
    for (const r of fixed) fixedUnits = lv().r2(fixedUnits - sumOf(rowsOf(r)));
    let target = 0;
    if (pays) {
      const b = lv().balanceInfo(S, emp, t, last, {});
      if (b.tracked) {
        // The balance on the last day before any payout on leaving.
        let exitRows = 0;
        for (const r of reqs) for (const x of rowsOf(r)) if (x.day <= last) exitRows = lv().r2(exitRows + x.amount);
        target = Math.max(0, lv().r2(b.balance - exitRows));
      }
    }
    const want = lv().r2(target - fixedUnits);
    if (want < -0.004 && separationId) L('lib_audit').write(actx, { op: 'leave.exit-payout', collection: 'employments', record: emp.id, summary: person.name + ': ' + lv().r2(-want) + ' ' + unit + 's of ' + t.getString('name') + ' were paid out on leaving beyond the balance on the last day ' + last + '; payroll may recover them' });
    // Withdraw every open payout but one (the one kept is corrected below).
    const keep = want > 0.004 ? open[0] || null : null;
    for (const r of open) {
      if (r === keep) continue;
      const rows = rowsOf(r);
      const byDay = {};
      for (const x of rows) byDay[x.day] = lv().r2((byDay[x.day] || 0) + x.amount);
      for (const d of Object.keys(byDay)) if (Math.abs(byDay[d]) >= 0.005) L('lib_leave_admin').writeRow(sys, tx, emp.id, t.id, d, -byDay[d], 'encash', r.id, 'Payout on leaving withdrawn (no unused balance on the last day ' + (last || '-') + ')', '');
      r.set('status', 'withdrawn');
      r.set('decided_note', util.clip('No unused balance to pay out on the last day ' + (last || '-') + '.', 2000));
      tx.save(r);
      L('lib_audit').write(actx, { op: 'leave.exit-payout', collection: 'leave_encash_requests', record: r.id, summary: 'Withdrew the payout on leaving of ' + t.getString('name') + ' for ' + person.name + ' (no unused balance on the last day)' });
      changed++;
    }
    if (want <= 0.004) continue;
    const note = 'Unused balance paid out on leaving (last day ' + last + ')';
    if (keep !== null) {
      const rows = rowsOf(keep);
      const cur = lv().r2(-sumOf(rows));
      const moved = keep.getString('pay_on') !== last;
      if (moved) {
        const byDay = {};
        for (const x of rows) byDay[x.day] = lv().r2((byDay[x.day] || 0) + x.amount);
        for (const d of Object.keys(byDay)) if (Math.abs(byDay[d]) >= 0.005) L('lib_leave_admin').writeRow(sys, tx, emp.id, t.id, d, -byDay[d], 'encash', keep.id, 'Last day moved to ' + last, '');
        L('lib_leave_admin').writeRow(sys, tx, emp.id, t.id, last, -want, 'encash', keep.id, note, '');
      } else if (Math.abs(want - cur) >= 0.005) L('lib_leave_admin').writeRow(sys, tx, emp.id, t.id, last, -(want - cur), 'encash', keep.id, note + ' (corrected from ' + cur + ')', '');
      if (moved || Math.abs(want - cur) >= 0.005 || keep.getString('separation') !== sep) {
        keep.set('days', asDays(want));
        keep.set('pay_on', last);
        keep.set('separation', sep);
        keep.set('reason', util.clip(note + ': ' + want + ' ' + unit + (want === 1 ? '' : 's') + '.', 2000));
        tx.save(keep);
        L('lib_audit').write(actx, { op: 'leave.exit-payout', collection: 'leave_encash_requests', record: keep.id, summary: 'Payout on leaving of ' + t.getString('name') + ' for ' + person.name + ' is now ' + want + ' ' + unit + 's (was ' + cur + ', last day ' + last + ')', before: { days: cur }, after: { days: want, pay_on: last } });
        changed++;
      }
      payouts.push({ encash: keep.id, type: t.getString('code'), amount: want, unit: unit, days: asDays(want) });
      continue;
    }
    const rec = util.newRecord(tx, 'leave_encash_requests');
    rec.set('employment', emp.id);
    rec.set('type', t.id);
    rec.set('days', asDays(want));
    rec.set('reason', util.clip(note + ': ' + want + ' ' + unit + (want === 1 ? '' : 's') + '.', 2000));
    rec.set('status', 'approved');
    rec.set('kind', 'exit');
    rec.set('separation', sep);
    rec.set('pay_on', last);
    rec.set('requested_by', '');
    rec.set('actor', 'system');
    tx.save(rec);
    L('lib_leave_admin').writeRow(sys, tx, emp.id, t.id, last, -want, 'encash', rec.id, note, '');
    L('lib_audit').write(actx, { op: 'leave.exit-payout', collection: 'leave_encash_requests', record: rec.id, summary: 'Pay out ' + want + ' ' + unit + (want === 1 ? '' : 's') + ' of ' + t.getString('name') + ' to ' + person.name + ' with the final pay (last day ' + last + ')' });
    payouts.push({ encash: rec.id, type: t.getString('code'), amount: want, unit: unit, days: asDays(want) });
    changed++;
  }
  return { changed: changed, payouts: payouts };
}

/** separation.approved and separation.changed { separation, employment, last_day, kind }: balances to the last day, then the payouts on leaving. */
function onSeparation(ctx, payload) {
  const empId = String(payload.employment || '');
  if (empId === '') return null;
  let out = null;
  const run = (tx) => {
    lv().syncEmployment(null, tx, empId, true);
    out = exitPayouts(ctx, tx, empId, String(payload.separation || ''));
    // The payouts change the balance: renew the derived rows.
    const S = lv().session(tx);
    const emp = lv().employmentOf(S, empId);
    if (emp !== null) lv().writeDerived(S, tx, emp, lv().todayOf(S, emp.getString('entity')), null);
  };
  if (ctx.app.isTransactional()) run(ctx.app);
  else ctx.app.runInTransaction((tx) => run(tx));
  return out;
}

/* ---------------------------------------------------- compensatory leave */

function compView(app, r, S) {
  const t = lv().typeById(S, r.getString('type'));
  const emp = lv().employmentOf(S, r.getString('employment'));
  const person = emp ? lv().personOf(app, emp) : { number: '', name: '' };
  return { id: r.id, employment: r.getString('employment'), number: person.number, name: person.name, type: t ? t.getString('code') : '', type_name: t ? t.getString('name') : '', worked_day: r.getString('worked_day'), hours: r.getFloat('hours'), days: r.getFloat('days'), reason: r.getString('reason'), status: r.getString('status'), approval: r.getString('approval'), expires: r.getString('expires'), decided_note: r.getString('decided_note'), created: r.getString('created') };
}

function compOffRequest(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const emp = lv().employmentParam(ctx, p);
  lv().needAct(ctx, emp);
  const entity = emp.getString('entity');
  let t = null;
  const tref = util.str(p, 'type', '');
  if (tref !== '') t = lv().typeRef(S, entity, tref);
  else t = lv().typesFor(S, entity, false).filter((x) => x.getBool('comp_off'))[0] || null;
  if (t === null || !t.getBool('comp_off')) throw util.fail(400, 'There is no compensatory leave type here. Add one in Leave settings (a type with comp_off on).', 'no_comp_off_type');
  const today = lv().todayOf(S, entity);
  const worked = util.day(p, 'worked_day', '');
  if (worked === '') throw util.fail(400, 'worked_day is required: the rest day or holiday you worked.', 'missing_param', { param: 'worked_day' });
  if (worked > today) throw util.fail(400, 'Ask for compensatory leave after the day you worked.', 'invalid_param');
  if (worked < emp.getString('start_day')) throw util.fail(400, 'That is before the first day of work.', 'invalid_param');
  const days = util.num(p, 'days', { min: 0.5, max: 2 }) || 1;
  if (Math.round(days * 2) !== days * 2) throw util.fail(400, 'days is in half days (0.5, 1, 1.5, 2).', 'invalid_param');
  const hours = util.num(p, 'hours', { min: 0, max: 24 }) || 0;
  const rule = lv().ruleFor(S, emp, t.getString('code'), worked) || lv().ruleFor(S, emp, t.getString('code'), today);
  if (rule === null) throw util.fail(400, t.getString('name') + ' is not in the leave policy on ' + worked + '.', 'not_in_policy');
  const months = Number(rule.grant_expiry_months) || 0;
  const expires = months > 0 ? util.addMonths(worked, months) : '';
  if (expires !== '' && expires <= today) throw util.fail(409, 'Compensatory leave for ' + worked + ' would already have expired (' + months + ' months).', 'expired');
  const dup = util.findOne(app, 'leave_comp_offs', "employment = {:e} && worked_day = {:d} && (status = 'pending' || status = 'approved')", { e: emp.id, d: worked });
  if (dup !== null) throw util.fail(409, 'There is already compensatory leave for ' + worked + '.', 'duplicate');
  const minutes = L('lib_calendar').expectedMinutes(app, emp.id, worked);
  const notes = minutes > 0 ? ['Scheduled working day: ' + worked + ' (usually only rest days and holidays earn compensatory leave)'] : [];
  const person = lv().personOf(app, emp);
  let rec = null;
  let approval = null;
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    rec = util.newRecord(tx, 'leave_comp_offs');
    rec.set('employment', emp.id);
    rec.set('type', t.id);
    rec.set('worked_day', worked);
    rec.set('hours', hours);
    rec.set('days', days);
    rec.set('reason', util.text(p, 'reason', 2000, ''));
    rec.set('status', 'pending');
    rec.set('expires', expires);
    rec.set('requested_by', ctx.memberId || '');
    rec.set('actor', ctx.isAgent ? 'agent' : 'person');
    tx.save(rec);
    approval = L('lib_approvals').open(tctx, { kind: 'comp_off', ref_collection: 'leave_comp_offs', ref_id: rec.id, employment: emp.id, summary: t.getString('name') + ', ' + days + (days === 1 ? ' day' : ' days') + ' for a day worked (' + person.name + ')', days: days, facts: [{ type: 'day', key: 'worked_day', label: 'Day worked', value: worked }, { type: 'number', key: 'days', label: 'Days earned', value: days, unit: unitWord('day', days) }, { type: 'text', key: 'type', label: 'Type', value: t.getString('name') }].concat(expires !== '' ? [{ type: 'day', key: 'expires', label: 'Expires', value: expires }] : []), payload: { worked_day: worked, days: days, hours: hours, type: t.getString('code'), type_name: t.getString('name'), expires: expires, notes: notes } });
    const fresh = tx.findRecordById('leave_comp_offs', rec.id);
    fresh.set('approval', approval.id);
    tx.save(fresh);
    L('lib_audit').write(tctx, { op: 'leave.comp-off-request', collection: 'leave_comp_offs', record: rec.id, summary: 'Asked for ' + days + ' days of ' + t.getString('name') + ' for working ' + worked + ' (' + person.name + ')' });
  });
  ctx.audited = true;
  return { comp_off: compView(app, app.findRecordById('leave_comp_offs', rec.id), S), approval: approval, notes: notes };
}

function onCompOffDecision(ctx, approval, decision, note) {
  const util = u();
  const tx = ctx.app;
  const r = tx.findRecordById('leave_comp_offs', approval.ref_id);
  if (r.getString('status') !== 'pending') return;
  r.set('decided_note', util.clip(note || '', 2000));
  if (decision === 'approved') {
    const emp = tx.findRecordById('employments', r.getString('employment'));
    r.set('status', 'approved');
    tx.save(r);
    const day = util.today(tx, emp.getString('entity'));
    L('lib_leave_admin').writeRow(ctx, tx, emp.id, r.getString('type'), day, r.getFloat('days'), 'comp_off', r.id, 'For working ' + r.getString('worked_day'), r.getString('expires'));
    lv().syncEmployment(null, tx, emp.id);
  } else {
    r.set('status', decision === 'rejected' ? 'rejected' : 'withdrawn');
    tx.save(r);
  }
}

function compOffWithdraw(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'leave_comp_offs', util.req(p, 'comp_off'));
  if (r === null) throw util.fail(404, 'No such compensatory leave request.', 'not_found');
  lv().needAct(ctx, app.findRecordById('employments', r.getString('employment')));
  if (r.getString('status') !== 'pending') throw util.fail(409, 'Only a waiting request can be withdrawn (this one is ' + r.getString('status') + ').', 'conflict');
  const ap = util.byId(app, 'approvals', r.getString('approval'));
  if (ap !== null && ap.getString('status') === 'pending') L('lib_approvals').cancel(ctx.memberId !== '' && ap.getString('requester') === ctx.memberId ? ctx : L('lib_auth').systemCtx(app), ap.id, 'Withdrawn by ' + ctx.name);
  L('lib_audit').note(ctx, { collection: 'leave_comp_offs', record: r.id, summary: 'Withdrew a compensatory leave request' });
  return { comp_off: compView(app, app.findRecordById('leave_comp_offs', r.id), lv().session(app)) };
}

function compOffList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const auth = L('lib_auth');
  const empRef = util.str(p, 'employment', '');
  let rows;
  if (empRef !== '') {
    const emp = L('lib_people').employmentRef(app, empRef);
    lv().needSee(ctx, emp);
    rows = util.findMany(app, 'leave_comp_offs', 'employment = {:e}', '-worked_day', 200, { e: emp.id });
  } else if (ctx.isAgent || auth.can(ctx, 'leave', 'view')) {
    rows = util.findMany(app, 'leave_comp_offs', '1=1', '-worked_day', 500).filter((r) => auth.inScope(ctx, app.findRecordById('employments', r.getString('employment')).getString('entity')) || ctx.isAgent);
  } else {
    const ids = scopeIds(ctx, 'mine', util.today(app)).concat(scopeIds(ctx, 'team', util.today(app)));
    rows = util.findMany(app, 'leave_comp_offs', '1=1', '-worked_day', 300).filter((r) => ids.indexOf(r.getString('employment')) >= 0);
  }
  return { comp_offs: rows.map((r) => compView(app, r, S)) };
}

/* ---------------------------------------------------- approval context */

/** What an approver needs on the Inbox card: the request, the balance before and after, who else is away, the checks. */
function approvalContext(ctx, p) {
  const util = u();
  const app = ctx.app;
  const S = lv().session(app);
  const ap = util.byId(app, 'approvals', util.req(p, 'approval'));
  if (ap === null) throw util.fail(404, 'No such approval.', 'not_found');
  const kind = ap.getString('kind');
  if (['leave_request', 'leave_encash', 'comp_off'].indexOf(kind) < 0) throw util.fail(400, 'Not a leave approval.', 'invalid');
  const emp = app.findRecordById('employments', ap.getString('employment'));
  const approver = (util.jsonOf(ap, 'approvers', []) || []).indexOf(ctx.memberId) >= 0 || ap.getString('decided_by') === ctx.memberId || ap.getString('requester') === ctx.memberId;
  const a = lv().access(ctx, emp);
  if (!approver && a === 'none') throw util.fail(403, 'You cannot see this request.', 'not_permitted');
  const person = lv().personOf(app, emp);
  const today = lv().todayOf(S, emp.getString('entity'));
  const job = L('lib_people').rowOn(app, 'job_records', emp.id, today);
  const out = { kind: kind, person: person, title: job ? job.getString('title') : '', today: today };
  if (kind === 'leave_request') {
    const r = reqRef(app, ap.getString('ref_id'));
    const v = requestView(app, r, S);
    const t = lv().typeById(S, r.getString('type'));
    const action = (util.jsonOf(ap, 'payload', {}) || {}).action || 'request';
    const b = lv().balanceInfo(S, emp, t, today, {});
    out.request = v;
    out.action = action;
    if (b.tracked) {
      const own = r.getString('status') === 'pending' ? v.amount : 0;
      const before = lv().r2((b.available || 0) + own);
      const back = action === 'cancel' ? v.day_list.filter((d) => d.day >= (r.getString('cancel_from') || v.start)).reduce((s, d) => s + (Number(d.amount) || 0), 0) : 0;
      out.balance = { unit: b.unit, before: before, after: action === 'cancel' ? lv().r2(before + back) : lv().r2(before - v.amount), name: b.name };
    } else out.balance = null;
    out.away = awayBetween(app, teamOf(app, emp, v.start), v.start, v.end, S).filter((x) => x.id !== v.id);
    out.blocks = L('lib_leave_admin').blocksFor(app, emp, v.start, v.end, v.type);
    out.warnings = v.warnings;
    out.holidays = L('lib_calendar').workingDays(app, emp.id, v.start, v.end).holidays;
  } else if (kind === 'leave_encash') {
    const r = util.byId(app, 'leave_encash_requests', ap.getString('ref_id'));
    const t = lv().typeById(S, r.getString('type'));
    const b = lv().balanceInfo(S, emp, t, today, {});
    out.encash = encashView(app, r, S);
    out.balance = { unit: b.unit, name: b.name, before: b.available, after: lv().r2((b.available || 0) - r.getFloat('days')) };
  } else {
    const r = util.byId(app, 'leave_comp_offs', ap.getString('ref_id'));
    const t = lv().typeById(S, r.getString('type'));
    const b = lv().balanceInfo(S, emp, t, today, {});
    const worked = r.getString('worked_day');
    out.comp_off = compView(app, r, S);
    out.balance = { unit: b.unit, name: b.name, before: b.available, after: lv().r2((b.available || 0) + r.getFloat('days')) };
    const cal = L('lib_calendar');
    const wd = cal.workingDays(app, emp.id, worked, worked);
    out.worked = { day: worked, holiday: wd.holidays[0] || null, rest_day: wd.off.indexOf(worked) >= 0, scheduled_minutes: cal.expectedMinutes(app, emp.id, worked) };
  }
  return out;
}

module.exports = {
  requestView: requestView,
  awayView: awayView,
  dayPlan: dayPlan,
  teamOf: teamOf,
  awayBetween: awayBetween,
  evaluate: evaluate,
  check: check,
  request: request,
  previewRequest: previewRequest,
  writeTakes: writeTakes,
  withdraw: withdraw,
  cancel: cancel,
  onDecision: onDecision,
  attach: attach,
  attachmentFile: attachmentFile,
  scopeIds: scopeIds,
  requestsList: requestsList,
  requestGet: requestGet,
  encashRequest: encashRequest,
  onEncashDecision: onEncashDecision,
  encashWithdraw: encashWithdraw,
  exitPayouts: exitPayouts,
  onSeparation: onSeparation,
  encashList: encashList,
  compOffRequest: compOffRequest,
  onCompOffDecision: onCompOffDecision,
  compOffWithdraw: compOffWithdraw,
  compOffList: compOffList,
  approvalContext: approvalContext,
};
