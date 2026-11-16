/// <reference path="../pb_data/types.d.ts" />
// SCRATCH ONLY (kernel-backend tests). Records what the kernel calls in settings.extra.testkit.
function log(app, key, value) {
  const s = require(`${__hooks}/lib_settings.js`).row(app);
  const extra = require(`${__hooks}/lib_util.js`).jsonOf(s, 'extra', {}) || {};
  const t = extra.testkit || {};
  if (!t[key]) t[key] = [];
  t[key].push(value);
  extra.testkit = t;
  s.set('extra', extra);
  app.save(s);
}
function onHired(ctx, p) { log(ctx.app, 'hired', p); return { seen: true }; }
function onEditing(ctx, p) { return p.effective_from < '2023-01-01' ? { block: 'Used by a locked pay run (test).' } : null; }
function onPing(ctx, p) { log(ctx.app, 'ping', p); return 'pong'; }
function cronPing(app) { log(app, 'cron', { at: new Date().toISOString() }); }
function onPingFail() { throw new Error('ping subscriber fails on purpose'); }
function onDecision(ctx, approval, decision, note) { log(ctx.app, 'decisions', { id: approval.id, decision: decision, note: note, step: approval.step }); }
function facts(ctx, employmentId) { return [{ label: 'Test fact', value: employmentId }]; }
function open(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const people = require(`${__hooks}/lib_people.js`);
  const m = p.employment ? people.employmentRef(ctx.app, p.employment) : null;
  return { approval: require(`${__hooks}/lib_approvals.js`).open(ctx, { kind: p.kind || 'test_kind', ref_collection: 'employments', ref_id: m ? m.id : '', employment: m ? m.id : '', summary: p.summary || 'Test request', amount_minor: Number(p.amount_minor || 0), currency: p.currency || '', payload: { days: Number(p.days || 0) }, days: p.days === undefined ? undefined : Number(p.days), needs_pin: p.needs_pin === true }) };
}
function emit(ctx, p) { return { results: require(`${__hooks}/lib_events.js`).emit(ctx, 'test.ping', { n: Number(p.n || 1) }) }; }
function state(ctx) { const s = require(`${__hooks}/lib_settings.js`).row(ctx.app); return (require(`${__hooks}/lib_util.js`).jsonOf(s, 'extra', {}) || {}).testkit || {}; }
function contract(ctx, p) {
  const people = require(`${__hooks}/lib_people.js`);
  const cal = require(`${__hooks}/lib_calendar.js`);
  const m = people.employmentRef(ctx.app, p.employment);
  const day = p.day;
  return {
    asOf: people.asOf(ctx.app, m.id, day),
    manager: people.managerOf(ctx.app, m.id, day),
    reports: people.reportsOf(ctx.app, m.getString('employee'), day, true),
    age: people.ageOn(ctx.app.findRecordById('employees', m.getString('employee')), day),
    active: people.activeEmployments(ctx.app, { entity: m.getString('entity'), from: day, to: day }).length,
    working: cal.workingDays(ctx.app, m.id, p.from || day, p.to || day),
    expected: cal.expectedMinutes(ctx.app, m.id, day),
    calendar: cal.calendarOf(ctx.app, m.id, day),
    schedule: cal.scheduleOf(ctx.app, m.id, day),
    holiday: cal.isHoliday(ctx.app, (cal.calendarOf(ctx.app, m.id, day) || {}).id, day),
    localNow: require(`${__hooks}/lib_util.js`).localNow(ctx.app, m.getString('entity')),
  };
}
function tick(ctx) { require(`${__hooks}/lib_agent.js`).sendDeferred(ctx.app); require(`${__hooks}/lib_people.js`).refreshStatuses(ctx.app); return { ok: true, cron: require(`${__hooks}/lib_events.js`).runDue(ctx.app, Date.now()) }; }
module.exports = { cronPing: cronPing, onHired: onHired, onEditing: onEditing, onPing: onPing, onPingFail: onPingFail, onDecision: onDecision, facts: facts, open: open, emit: emit, state: state, contract: contract, tick: tick };
