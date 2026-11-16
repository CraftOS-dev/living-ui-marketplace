/// <reference path="../pb_data/types.d.ts" />
/**
 * Shifts: shift types per entity, repeating patterns (the bulk shift
 * assignment tool), the week grid by person with draft and published
 * states (people see and are paid by what was published; publishing tells
 * only the people whose shifts changed), copy week, leave conflicts, and
 * shift requests (change my shift, swap with a colleague who agrees first)
 * decided as approvals of kind shift_request.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function T() {
  return L('lib_time');
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(d) {
  return DOW[u().weekday(d)] + ' ' + Number(d.slice(8, 10)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1];
}

function rangeLabel(a, b) {
  if (a === b) return dayLabel(a);
  return Number(a.slice(8, 10)) + (a.slice(5, 7) !== b.slice(5, 7) ? ' ' + MONTHS[Number(a.slice(5, 7)) - 1] : '') + ' to ' + Number(b.slice(8, 10)) + ' ' + MONTHS[Number(b.slice(5, 7)) - 1];
}

/* ---------------------------------------------------------- shift types */

function shiftTypeRef(app, ref, entityId) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'Give the shift type id, code or name.', 'missing_param');
  const byId = util.byId(app, 'shift_types', r);
  if (byId !== null) return byId;
  const where = entityId ? 'entity = {:e} && (code = {:r} || name = {:r})' : '(code = {:r} || name = {:r})';
  const rows = util.findMany(app, 'shift_types', where, 'created', 3, { e: entityId || '', r: r });
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw util.fail(409, 'More than one shift type is called "' + r + '". Use the id or give --entity.', 'ambiguous');
  throw util.fail(404, 'No shift type "' + r + '". Run shift-types.list.', 'not_found');
}

function applyShiftType(ctx, rec, p, creating) {
  const util = u();
  const app = ctx.app;
  if (creating) {
    const ent = L('lib_org').entityRef(app, util.req(p, 'entity'));
    if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'This entity is outside your scope.', 'not_permitted');
    rec.set('entity', ent.id);
  }
  if (creating || util.has(p, 'name')) rec.set('name', util.squash(util.req(p, 'name', 'Day')).slice(0, 80));
  if (util.has(p, 'code') || creating) rec.set('code', util.text(p, 'code', 12, '').toUpperCase());
  for (const k of ['start', 'end']) {
    if (!creating && !util.has(p, k)) continue;
    const v = util.str(p, k, '');
    if (!util.isTime(v)) throw util.fail(400, k + ' is HH:MM, e.g. 09:00.', 'invalid_param', { param: k });
    rec.set(k, v);
  }
  if (util.has(p, 'break_min') || creating) rec.set('break_min', util.int(p, 'break_min', 0, 0, 600));
  if (util.has(p, 'color') || creating) rec.set('color', util.oneOf(p, 'color', T().SHIFT_COLORS, 'grey'));
  if (util.has(p, 'grace_in_min') || creating) rec.set('grace_in_min', util.int(p, 'grace_in_min', 5, 0, 240));
  if (util.has(p, 'grace_out_min') || creating) rec.set('grace_out_min', util.int(p, 'grace_out_min', 0, 0, 240));
  if (util.has(p, 'half_day_below_min') || creating) rec.set('half_day_below_min', util.int(p, 'half_day_below_min', 0, 0, 1440));
  if (util.has(p, 'absent_below_min') || creating) rec.set('absent_below_min', util.int(p, 'absent_below_min', 0, 0, 1440));
  if (util.has(p, 'auto_attendance') || creating) rec.set('auto_attendance', util.bool(p, 'auto_attendance', true));
  if (util.has(p, 'sort')) rec.set('sort', util.int(p, 'sort', 0, 0, 10000));
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
  if (util.has(p, 'location')) {
    const l = util.str(p, 'location', '');
    if (l === '') rec.set('location', '');
    else {
      const loc = L('lib_org').kindRef(app, 'location', l);
      if (loc.getString('entity') !== rec.getString('entity')) throw util.fail(400, 'The location belongs to another entity.', 'invalid_param', { param: 'location' });
      rec.set('location', loc.id);
    }
  }
  rec.set('overnight', rec.getString('end') <= rec.getString('start'));
  const minutes = T().shiftMinutes(rec.getString('start'), rec.getString('end'), rec.getInt('break_min'));
  if (minutes <= 0) throw util.fail(400, 'The break is as long as the shift.', 'invalid_param', { param: 'break_min' });
}

function shiftTypesList(ctx, p) {
  const util = u();
  const auth = L('lib_auth');
  const ent = util.str(p, 'entity', '');
  const where = [];
  const bind = {};
  if (ent !== '') {
    where.push('entity = {:e}');
    bind.e = L('lib_org').entityRef(ctx.app, ent).id;
  }
  if (!util.bool(p, 'archived', false)) where.push('archived = false');
  return {
    shift_types: util
      .findMany(ctx.app, 'shift_types', where.length > 0 ? where.join(' && ') : '1=1', 'sort,start,name', 0, bind)
      .filter((r) => auth.inScope(ctx, r.getString('entity')))
      .map((r) => T().shiftTypeView(r)),
    colors: T().SHIFT_COLORS,
  };
}

function shiftTypesAdd(ctx, p) {
  const rec = u().newRecord(ctx.app, 'shift_types');
  applyShiftType(ctx, rec, p, true);
  ctx.app.save(rec);
  const v = T().shiftTypeView(rec);
  L('lib_audit').note(ctx, { collection: 'shift_types', record: rec.id, summary: 'Added the shift type ' + v.name + ' (' + v.start + ' to ' + v.end + ')', after: v });
  return { shift_type: v };
}

function shiftTypesUpdate(ctx, p) {
  const util = u();
  const rec = shiftTypeRef(ctx.app, util.req(p, 'shift_type'), '');
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'This shift type is outside your entities.', 'not_permitted');
  const before = T().shiftTypeView(rec);
  applyShiftType(ctx, rec, p, false);
  ctx.app.save(rec);
  const after = T().shiftTypeView(rec);
  L('lib_audit').note(ctx, { collection: 'shift_types', record: rec.id, summary: 'Changed the shift type ' + after.name, before: before, after: after });
  return { shift_type: after };
}

function shiftTypesDelete(ctx, p) {
  const util = u();
  const rec = shiftTypeRef(ctx.app, util.req(p, 'shift_type'), '');
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'This shift type is outside your entities.', 'not_permitted');
  const used = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM shift_assignments WHERE shift_type = {:s}', { s: rec.id }) + util.count(ctx.app, 'SELECT COUNT(*) AS n FROM attendance WHERE shift_type = {:s}', { s: rec.id });
  if (used > 0) throw util.fail(409, 'This shift type is on the schedule or in attendance. Archive it instead (shift-types.update --archived true).', 'in_use');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'shift_types', record: rec.id, summary: 'Deleted the shift type ' + rec.getString('name') });
  return { deleted: true };
}

/* ------------------------------------------------------------- patterns */

function patternView(app, r) {
  const util = u();
  const days = util.jsonOf(r, 'days', []) || [];
  return { id: r.id, entity: r.getString('entity'), name: r.getString('name'), cycle: r.getInt('cycle'), days: days, note: r.getString('note'), archived: r.getBool('archived') };
}

function patternRef(app, ref) {
  return u().byIdOrName(app, 'shift_patterns', ref, 'name', 'shift-patterns.list');
}

function patternsList(ctx, p) {
  const util = u();
  const auth = L('lib_auth');
  const ent = util.str(p, 'entity', '');
  const bind = {};
  const where = [util.bool(p, 'archived', false) ? '1=1' : 'archived = false'];
  if (ent !== '') {
    where.push('entity = {:e}');
    bind.e = L('lib_org').entityRef(ctx.app, ent).id;
  }
  return { patterns: util.findMany(ctx.app, 'shift_patterns', where.join(' && '), 'name', 0, bind).filter((r) => auth.inScope(ctx, r.getString('entity'))).map((r) => patternView(ctx.app, r)) };
}

function patternsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'pattern', '');
  const rec = id !== '' ? patternRef(app, id) : util.newRecord(app, 'shift_patterns');
  const before = id !== '' ? patternView(app, rec) : null;
  if (id === '') {
    const ent = L('lib_org').entityRef(app, util.req(p, 'entity'));
    if (!L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'This entity is outside your scope.', 'not_permitted');
    rec.set('entity', ent.id);
  } else if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'This pattern is outside your entities.', 'not_permitted');
  if (id === '' || util.has(p, 'name')) rec.set('name', util.squash(util.req(p, 'name', 'Two on two off')).slice(0, 80));
  const raw = util.list(p, 'days');
  if (raw === undefined && id === '') throw util.fail(400, 'days is required: a JSON list, one item per day of the cycle, each a shift type (id, code or name) or "" for a day off, e.g. ["D","D","",""].', 'missing_param', { param: 'days' });
  if (raw !== undefined) {
    if (raw.length < 1 || raw.length > 56) throw util.fail(400, 'A pattern has 1 to 56 days.', 'invalid_param', { param: 'days' });
    const days = raw.map((x) => (x === '' || x === null ? '' : shiftTypeRef(app, String(x), rec.getString('entity')).id));
    for (const sid of days) if (sid !== '' && app.findRecordById('shift_types', sid).getString('entity') !== rec.getString('entity')) throw util.fail(400, 'Every shift type of a pattern belongs to its entity.', 'invalid_param', { param: 'days' });
    rec.set('days', days);
    rec.set('cycle', days.length);
  }
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 400, ''));
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'shift_patterns', record: rec.id, summary: (id === '' ? 'Added' : 'Changed') + ' the shift pattern ' + rec.getString('name'), before: before, after: patternView(app, rec) });
  return { pattern: patternView(app, rec) };
}

function patternsDelete(ctx, p) {
  const util = u();
  const rec = patternRef(ctx.app, util.req(p, 'pattern'));
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'This pattern is outside your entities.', 'not_permitted');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'shift_patterns', record: rec.id, summary: 'Deleted the shift pattern ' + rec.getString('name') });
  return { deleted: true };
}

/* ---------------------------------------------------------- the grid */

function cellView(r) {
  const util = u();
  const snap = util.jsonOf(r, 'published', null);
  return { id: r.id, employment: r.getString('employment'), day: r.getString('day'), shift_type: r.getString('shift_type'), location: r.getString('location'), status: r.getString('status'), published_shift_type: snap ? snap.shift_type || '' : '', published_location: snap ? snap.location || '' : '', changed: r.getString('status') !== 'published', source: r.getString('source'), note: r.getString('note') };
}

/** The week start used for a grid: the entity's, else the company's first entity's. */
function weekStartFor(app, entityId) {
  const util = u();
  const ent = entityId ? util.byId(app, 'entities', entityId) : util.findMany(app, 'entities', 'active = true', 'created', 1)[0] || null;
  return ent ? ent.getInt('week_start') : 1;
}

function weekRange(app, p) {
  const util = u();
  const rules = L('lib_time_rules');
  const entity = util.str(p, 'entity', '') !== '' ? L('lib_org').entityRef(app, util.str(p, 'entity', '')).id : '';
  const ws = weekStartFor(app, entity);
  const ref = util.day(p, 'week', util.today(app, entity || undefined));
  const from = rules.weekStartOf(ref, ws);
  return { entity: entity, from: from, to: util.dayAdd(from, 6), week_start: ws };
}

/** shifts.week: the grid for a week (people by days) with leave conflicts, holidays, hours and what is not published yet. */
function shiftsWeek(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const auth = L('lib_auth');
  const wr = weekRange(app, p);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(util.dayAdd(wr.from, i));
  const people = t.roster(ctx, wr.from, wr.to, { entity: wr.entity, location: util.str(p, 'location', ''), department: util.str(p, 'department', ''), team: util.bool(p, 'team', false) });
  const R = t.resolver(app);
  const rows = [];
  const types = {};
  const entities = {};
  let unpublished = 0;
  const totals = days.map((d) => ({ day: d, shifts: 0, minutes: 0 }));
  for (const person of people) {
    entities[person.entity] = true;
    const m = R.emp(person.employment);
    R.loadAssignments(person.employment, wr.from, wr.to);
    R.loadLeave(person.employment, wr.from, wr.to);
    const cells = {};
    let minutes = 0;
    const issues = [];
    days.forEach((d, i) => {
      if (d < m.start || (m.end !== '' && d > m.end)) {
        cells[d] = { outside: true };
        return;
      }
      const a = R.assignment(person.employment, d);
      const plan = t.planOf(R, person.employment, d);
      const lv = R.leaveOn(person.employment, d);
      const cell = { day: d, assignment: a !== null ? cellView(a) : null, plan: { kind: plan.kind, source: plan.source, start: plan.start, end: plan.end, minutes: plan.expected_min }, holiday: plan.holiday ? plan.holiday.name : '', leave: lv !== null ? { type: lv.type, name: lv.name, half: lv.half, hours: lv.hours } : null, conflict: '' };
      let sid = '';
      if (a !== null && a.getString('status') !== 'removed') sid = a.getString('shift_type');
      if (a !== null && a.getString('status') !== 'published') unpublished++;
      if (sid !== '') {
        const st = R.shiftType(sid);
        if (st) {
          types[sid] = st;
          minutes += st.minutes;
          totals[i].shifts++;
          totals[i].minutes += st.minutes;
        }
        if (lv !== null && !lv.half && !(lv.hours > 0)) cell.conflict = 'On approved leave (' + (lv.name || lv.type) + ')';
        else if (lv !== null) cell.conflict = 'Half day of leave';
        else if (plan.holiday && !plan.holiday.half) cell.conflict = 'Public holiday: ' + plan.holiday.name;
      } else if (a === null && plan.source === 'schedule') {
        minutes += plan.expected_min;
      }
      if (cell.conflict !== '') issues.push({ day: d, message: cell.conflict });
      cells[d] = cell;
    });
    const rs = R.ruleSet(person.employment, wr.to);
    const weekly = (rs.rules || []).filter((r) => r.when === 'weekly_over').map((r) => r.threshold_min).sort((a, b) => a - b)[0];
    if (weekly !== undefined && minutes > weekly) issues.push({ day: '', message: 'Planned ' + t.hm(minutes) + ', over the ' + t.hm(weekly) + ' weekly overtime threshold' });
    let editable = false;
    try {
      t.needEdit(ctx, m.rec);
      editable = true;
    } catch {
      editable = false;
    }
    rows.push(Object.assign({}, person, { cells: cells, minutes: minutes, issues: issues, editable: editable }));
  }
  const typeList = util
    .findMany(app, 'shift_types', 'archived = false', 'sort,start,name')
    .filter((r) => (wr.entity !== '' ? r.getString('entity') === wr.entity : entities[r.getString('entity')] === true || (people.length === 0 && auth.inScope(ctx, r.getString('entity')))))
    .map((r) => t.shiftTypeView(r));
  for (const st of typeList) types[st.id] = st;
  const canEdit = !ctx.isAgent && (auth.can(ctx, 'time', 'edit') || ctx.teamScope);
  return {
    from: wr.from,
    to: wr.to,
    week_start: wr.week_start,
    days: days,
    people: rows,
    shift_types: typeList,
    types: types,
    totals: totals,
    unpublished: unpublished,
    can: { edit: canEdit || ctx.isAgent, publish: canEdit },
  };
}

/** Set one cell (shift type id or '' to clear) as a draft; returns the cell view or null. */
function setCell(app, ctx, m, day, shiftTypeId, locationId, source) {
  const util = u();
  let rec = util.findOne(app, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: m.id, d: day });
  const snap = rec !== null ? util.jsonOf(rec, 'published', null) : null;
  if (shiftTypeId === '') {
    if (rec === null) return null;
    if (snap === null) {
      app.delete(rec);
      return null;
    }
    rec.set('status', 'removed');
  } else {
    if (rec === null) {
      rec = util.newRecord(app, 'shift_assignments');
      rec.set('employment', m.id);
      rec.set('day', day);
      rec.set('published', null);
    }
    rec.set('shift_type', shiftTypeId);
    rec.set('location', locationId || '');
    const same = snap !== null && snap.shift_type === shiftTypeId && (snap.location || '') === (locationId || '');
    rec.set('status', same ? 'published' : 'draft');
    rec.set('source', source || 'manual');
  }
  if (ctx.memberId) rec.set('changed_by', ctx.memberId);
  app.save(rec);
  return cellView(rec);
}

function checkCellTarget(ctx, m, day, st) {
  const util = u();
  if (!util.isDay(day)) throw util.fail(400, 'day must be YYYY-MM-DD.', 'invalid_param');
  if (day < m.getString('start_day') || (m.getString('end_day') !== '' && day > m.getString('end_day'))) throw util.fail(400, m.getString('number') + ' is not employed on ' + day + '.', 'invalid_param');
  if (st !== null) {
    if (st.getString('entity') !== m.getString('entity')) throw util.fail(400, 'The shift type ' + st.getString('name') + ' belongs to another entity than ' + m.getString('number') + '.', 'invalid_param');
    if (st.getBool('archived')) throw util.fail(400, 'The shift type ' + st.getString('name') + ' is archived.', 'invalid_param');
  }
}

/** shifts.set: draft changes to cells ([{employment, day, shift_type, location}] or one cell by params). */
function shiftsSet(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const people = L('lib_people');
  let items = util.list(p, 'cells');
  if (items === undefined) items = [{ employment: util.req(p, 'employment'), day: util.req(p, 'day'), shift_type: util.str(p, 'shift_type', ''), location: util.str(p, 'location', '') }];
  if (items.length === 0) throw util.fail(400, 'Give at least one cell.', 'missing_param', { param: 'cells' });
  if (items.length > 500) throw util.fail(400, 'At most 500 cells at a time.', 'invalid_param', { param: 'cells' });
  const emps = {};
  const out = [];
  app.runInTransaction((tx) => {
    for (let i = 0; i < items.length; i++) {
      const c = items[i];
      util.keysOnly(c, ['employment', 'day', 'shift_type', 'location'], 'cell ' + (i + 1));
      const key = String(c.employment || '');
      if (emps[key] === undefined) {
        const m = people.employmentRef(tx, key);
        t.needEdit(ctx, m, 'change this person\'s shifts');
        emps[key] = m;
      }
      const m = emps[key];
      const st = c.shift_type ? shiftTypeRef(tx, String(c.shift_type), m.getString('entity')) : null;
      checkCellTarget(ctx, m, String(c.day || ''), st);
      let loc = '';
      if (c.location) {
        const l = L('lib_org').kindRef(tx, 'location', String(c.location));
        if (l.getString('entity') !== m.getString('entity')) throw util.fail(400, 'cell ' + (i + 1) + ': the location belongs to another entity.', 'invalid_param');
        loc = l.id;
      }
      const v = setCell(tx, ctx, m, String(c.day), st ? st.id : '', loc, ctx.isAgent ? 'agent' : 'manual');
      out.push({ employment: m.id, day: String(c.day), cell: v });
    }
  });
  L('lib_audit').note(ctx, { collection: 'shift_assignments', summary: 'Changed ' + out.length + ' shift' + (out.length === 1 ? '' : 's') + ' on the draft schedule' });
  return { cells: out, unpublished: unpublishedCount(ctx, util.dayAdd(util.today(app), -60), util.dayAdd(util.today(app), 400)) };
}

function unpublishedCount(ctx, from, to) {
  const util = u();
  const ids = T()
    .roster(ctx, from, to, {})
    .map((r) => r.employment);
  if (ids.length === 0) return 0;
  const bind = { f: from, t: to };
  const keys = ids.map((id, i) => ((bind['i' + i] = id), '{:i' + i + '}'));
  return util.count(ctx.app, "SELECT COUNT(*) AS n FROM shift_assignments WHERE status != 'published' AND day >= {:f} AND day <= {:t} AND employment IN (" + keys.join(',') + ')', bind);
}

/** shifts.copy-week: copy a week's shifts to another week as drafts (fill empty cells, or replace). */
function shiftsCopyWeek(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const src = weekRange(app, { entity: util.str(p, 'entity', ''), week: util.req(p, 'from_week') });
  const dst = weekRange(app, { entity: util.str(p, 'entity', ''), week: util.day(p, 'to_week', util.dayAdd(src.from, 7)) });
  if (src.from === dst.from) throw util.fail(400, 'Pick a different week to copy to.', 'invalid_param');
  const mode = util.oneOf(p, 'mode', ['fill', 'replace'], 'fill');
  const ids = util.list(p, 'employments');
  const people = t.roster(ctx, dst.from, dst.to, { entity: src.entity, location: util.str(p, 'location', ''), department: util.str(p, 'department', '') });
  let copied = 0;
  let skipped = 0;
  app.runInTransaction((tx) => {
    for (const person of people) {
      if (ids !== undefined && ids.length > 0 && ids.indexOf(person.employment) < 0 && ids.indexOf(person.number) < 0) continue;
      const m = tx.findRecordById('employments', person.employment);
      try {
        t.needEdit(ctx, m);
      } catch {
        continue;
      }
      const have = {};
      for (const r of util.findMany(tx, 'shift_assignments', 'employment = {:e} && day >= {:f} && day <= {:t}', '', 0, { e: m.id, f: src.from, t: src.to })) if (r.getString('status') !== 'removed') have[util.daysBetween(src.from, r.getString('day'))] = r;
      for (let i = 0; i < 7; i++) {
        const d = util.dayAdd(dst.from, i);
        if (d < m.getString('start_day') || (m.getString('end_day') !== '' && d > m.getString('end_day'))) continue;
        const cur = util.findOne(tx, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: m.id, d: d });
        const curOn = cur !== null && cur.getString('status') !== 'removed';
        const s = have[i];
        if (s === undefined) {
          if (mode === 'replace' && curOn) setCell(tx, ctx, m, d, '', '', 'copy');
          continue;
        }
        if (curOn && mode === 'fill') {
          skipped++;
          continue;
        }
        setCell(tx, ctx, m, d, s.getString('shift_type'), s.getString('location'), 'copy');
        copied++;
      }
    }
  });
  L('lib_audit').note(ctx, { collection: 'shift_assignments', summary: 'Copied the week of ' + src.from + ' to the week of ' + dst.from + ': ' + copied + ' shifts (' + mode + ')' });
  return { copied: copied, skipped: skipped, from_week: src.from, to_week: dst.from, mode: mode };
}

/** shifts.assign-pattern: lay a repeating pattern over many people for a date range (drafts). */
function shiftsAssignPattern(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const pat = patternRef(app, util.req(p, 'pattern'));
  const days = util.jsonOf(pat, 'days', []) || [];
  const from = util.day(p, 'from', '');
  const to = util.day(p, 'to', '');
  if (from === '' || to === '') throw util.fail(400, 'from and to are required (YYYY-MM-DD).', 'missing_param');
  if (to < from || util.daysBetween(from, to) > 183) throw util.fail(400, 'from to to is at most six months.', 'invalid_param');
  const offset = util.int(p, 'offset', 0, 0, 55);
  const mode = util.oneOf(p, 'mode', ['fill', 'replace'], 'replace');
  const refs = util.list(p, 'employments') || [];
  if (refs.length === 0) throw util.fail(400, 'employments is a JSON list of the people to give the pattern, e.g. ["E0004","E0005"].', 'missing_param', { param: 'employments' });
  if (refs.length > 300) throw util.fail(400, 'At most 300 people at a time.', 'invalid_param');
  const people = L('lib_people');
  let n = 0;
  let skipped = 0;
  const who = [];
  app.runInTransaction((tx) => {
    for (const ref of refs) {
      const m = people.employmentRef(tx, String(ref));
      t.needEdit(ctx, m, 'change this person\'s shifts');
      if (m.getString('entity') !== pat.getString('entity')) throw util.fail(400, m.getString('number') + ' works for another entity than the pattern ' + pat.getString('name') + '.', 'invalid_param');
      who.push(m.getString('number'));
      for (let d = from, i = 0; d <= to; d = util.dayAdd(d, 1), i++) {
        if (d < m.getString('start_day') || (m.getString('end_day') !== '' && d > m.getString('end_day'))) continue;
        const sid = days[(i + offset) % days.length] || '';
        const cur = util.findOne(tx, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: m.id, d: d });
        const curOn = cur !== null && cur.getString('status') !== 'removed';
        if (mode === 'fill' && curOn) {
          skipped++;
          continue;
        }
        if (sid === '' && !curOn) continue;
        setCell(tx, ctx, m, d, sid, '', 'pattern');
        n++;
      }
    }
  });
  L('lib_audit').note(ctx, { collection: 'shift_assignments', summary: 'Gave ' + who.length + ' people the pattern ' + pat.getString('name') + ' from ' + from + ' to ' + to + ' (' + n + ' cells, drafts)' });
  return { cells: n, skipped: skipped, people: who.length, from: from, to: to, pattern: patternView(app, pat) };
}

/** shifts.discard: drop draft changes (back to what was published) in a range. */
function shiftsDiscard(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const wr = weekRange(app, p);
  const from = util.day(p, 'from', wr.from);
  const to = util.day(p, 'to', wr.to);
  const people = t.roster(ctx, from, to, { entity: wr.entity, team: util.bool(p, 'team', false) });
  let n = 0;
  app.runInTransaction((tx) => {
    for (const person of people) {
      const m = tx.findRecordById('employments', person.employment);
      try {
        t.needEdit(ctx, m);
      } catch {
        continue;
      }
      for (const r of util.findMany(tx, 'shift_assignments', "employment = {:e} && day >= {:f} && day <= {:t} && status != 'published'", '', 0, { e: m.id, f: from, t: to })) {
        const snap = util.jsonOf(r, 'published', null);
        if (snap === null) tx.delete(r);
        else {
          r.set('shift_type', snap.shift_type);
          r.set('location', snap.location || '');
          r.set('status', 'published');
          tx.save(r);
        }
        n++;
      }
    }
  });
  L('lib_audit').note(ctx, { collection: 'shift_assignments', summary: 'Discarded ' + n + ' draft shift change' + (n === 1 ? '' : 's') + ' from ' + from + ' to ' + to });
  return { discarded: n, from: from, to: to };
}

function typeLabel(R, sid) {
  const st = R.shiftType(sid);
  return st ? st.name + ' ' + st.start + ' to ' + st.end : 'a shift';
}

/** shifts.publish: make drafts visible; notify only the people whose shifts changed. */
function shiftsPublish(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const wr = weekRange(app, p);
  const from = util.day(p, 'from', wr.from);
  const to = util.day(p, 'to', wr.to);
  if (to < from || util.daysBetween(from, to) > 400) throw util.fail(400, 'from to to is at most about a year.', 'invalid_param');
  const people = t.roster(ctx, from, to, { entity: wr.entity, location: util.str(p, 'location', ''), department: util.str(p, 'department', ''), team: util.bool(p, 'team', false) });
  const R = t.resolver(app);
  const changes = {};
  let published = 0;
  let removed = 0;
  app.runInTransaction((tx) => {
    for (const person of people) {
      const m = tx.findRecordById('employments', person.employment);
      try {
        t.needEdit(ctx, m);
      } catch {
        continue;
      }
      for (const r of util.findMany(tx, 'shift_assignments', "employment = {:e} && day >= {:f} && day <= {:t} && status != 'published'", 'day', 0, { e: m.id, f: from, t: to })) {
        const snap = util.jsonOf(r, 'published', null);
        const d = r.getString('day');
        if (changes[m.id] === undefined) changes[m.id] = { person: person, lines: [], days: [] };
        if (r.getString('status') === 'removed') {
          changes[m.id].lines.push(dayLabel(d) + ': no shift' + (snap ? ' (was ' + typeLabel(R, snap.shift_type) + ')' : ''));
          tx.delete(r);
          removed++;
        } else {
          changes[m.id].lines.push(dayLabel(d) + ': ' + typeLabel(R, r.getString('shift_type')) + (snap ? ' (was ' + typeLabel(R, snap.shift_type) + ')' : ''));
          r.set('published', { shift_type: r.getString('shift_type'), location: r.getString('location') });
          r.set('status', 'published');
          r.set('published_at', util.nowIso());
          tx.save(r);
          published++;
        }
        changes[m.id].days.push(d);
      }
    }
    // Past days whose plan changed are worked out again.
    for (const id of Object.keys(changes)) {
      const past = changes[id].days.filter((d) => d <= R.today(id)).sort();
      if (past.length > 0) t.processRange(tx, id, past[0], past[past.length - 1]);
    }
  });
  let notified = 0;
  for (const id of Object.keys(changes)) {
    const c = changes[id];
    const sent = L('lib_notify').toEmployee(app, c.person.employee, { kind: 'time', title: 'Your shifts ' + rangeLabel(c.days[0], c.days[c.days.length - 1]) + ' changed', body: c.lines.slice(0, 14).join('\n') + (c.lines.length > 14 ? '\n...' : ''), facts: [T().fact.days('days', 'Days', c.days[0], c.days[c.days.length - 1]), T().fact.count('changed', 'Days changed', c.days.length)], link: '#/time/schedule' });
    notified += sent.length;
  }
  L('lib_audit').note(ctx, { collection: 'shift_assignments', summary: 'Published the schedule ' + rangeLabel(from, to) + ': ' + published + ' shifts, ' + removed + ' removed, ' + Object.keys(changes).length + ' people told' });
  return { published: published, removed: removed, people: Object.keys(changes).length, notified: notified, from: from, to: to };
}

function previewPublish(ctx, p) {
  const util = u();
  const wr = weekRange(ctx.app, p);
  const from = util.day(p, 'from', wr.from);
  const to = util.day(p, 'to', wr.to);
  const n = unpublishedCount(ctx, from, to);
  return { label: 'Publish the schedule ' + rangeLabel(from, to), target: '', fields: [{ name: 'changes to publish', before: '', after: String(n) }], notes: ['People whose shifts changed are told.'], risk: 'medium' };
}

/** Published shifts (and the work week where there is none) of one person for a range. */
function scheduleOf(ctx, m, from, to) {
  const util = u();
  const t = T();
  const R = t.resolver(ctx.app);
  R.loadAssignments(m.id, from, to);
  R.loadLeave(m.id, from, to);
  const days = [];
  for (let d = from; d <= to; d = util.dayAdd(d, 1)) {
    const plan = t.planOf(R, m.id, d);
    if (plan.kind === 'outside') continue;
    const lv = R.leaveOn(m.id, d);
    const loc = R.location(plan.location);
    days.push({ day: d, kind: plan.kind, source: plan.source, shift_type: plan.shift_type, shift_name: plan.shift_name, shift_code: plan.shift_code, start: plan.start, end: plan.end, minutes: plan.expected_min, holiday: plan.holiday ? plan.holiday.name : '', leave: lv !== null ? { type: lv.type, name: lv.name, half: lv.half } : null, location: plan.location, location_name: loc ? loc.getString('name') : '' });
  }
  return days;
}

function shiftsMine(ctx, p) {
  const util = u();
  const t = T();
  const m = t.selfEmployment(ctx, util.str(p, 'employment', ''));
  const wr = weekRange(ctx.app, { entity: m.getString('entity'), week: util.str(p, 'from', '') || undefined });
  const from = util.day(p, 'from', wr.from);
  const to = util.day(p, 'to', util.dayAdd(from, 13));
  if (to < from || util.daysBetween(from, to) > 92) throw util.fail(400, 'from to to is at most three months.', 'invalid_param');
  const pending = util.findMany(ctx.app, 'shift_requests', "(employment = {:e} || swap_with = {:e}) && (status = 'pending' || status = 'awaiting_peer')", '-created', 20, { e: m.id }).map((r) => requestView(ctx.app, r));
  return { employment: m.id, from: from, to: to, days: scheduleOf(ctx, m, from, to), requests: pending };
}

function shiftsOf(ctx, p) {
  const util = u();
  const t = T();
  const m = t.employmentFor(ctx, util.str(p, 'employment', ''));
  const today = t.resolver(ctx.app).today(m.id);
  const from = util.day(p, 'from', today);
  const to = util.day(p, 'to', util.dayAdd(from, 13));
  if (to < from || util.daysBetween(from, to) > 92) throw util.fail(400, 'from to to is at most three months.', 'invalid_param');
  return { employment: m.id, from: from, to: to, days: scheduleOf(ctx, m, from, to) };
}

/** shifts.colleagues: people at my location or in my department on a day, with their published shift (to pick a swap). */
function shiftsColleagues(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = t.selfEmployment(ctx, util.str(p, 'employment', ''));
  const R = t.resolver(app);
  const day = util.day(p, 'day', R.today(m.id));
  const mine = R.jobOn(m.id, day);
  const loc = mine !== null ? mine.getString('location') : '';
  const dep = mine !== null ? mine.getString('department') : '';
  const out = [];
  for (const x of L('lib_people').activeEmployments(app, { entity: m.getString('entity'), from: day, to: day })) {
    if (x.id === m.id) continue;
    const j = R.jobOn(x.id, day);
    if (j === null || !((loc !== '' && j.getString('location') === loc) || (dep !== '' && j.getString('department') === dep))) continue;
    const sid = currentShift(app, x.id, day);
    const st = sid ? R.shiftType(sid) : null;
    out.push({ employment: x.id, number: x.employee_number, name: x.name, shift_type: sid, shift_name: st ? st.name : '', start: st ? st.start : '', end: st ? st.end : '' });
  }
  out.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  return { day: day, colleagues: out };
}

/* ------------------------------------------------------ shift requests */

function requestView(app, r) {
  const util = u();
  const people = L('lib_people');
  const nameOfEmp = (id) => {
    const m = id ? util.byId(app, 'employments', id) : null;
    const e = m ? util.byId(app, 'employees', m.getString('employee')) : null;
    return e ? people.displayName(e) : '';
  };
  const st = util.byId(app, 'shift_types', r.getString('shift_type'));
  return {
    id: r.id,
    employment: r.getString('employment'),
    name: nameOfEmp(r.getString('employment')),
    kind: r.getString('kind'),
    from_day: r.getString('from_day'),
    to_day: r.getString('to_day') || r.getString('from_day'),
    shift_type: r.getString('shift_type'),
    shift_name: st ? st.getString('name') : '',
    swap_with: r.getString('swap_with'),
    swap_name: nameOfEmp(r.getString('swap_with')),
    swap_day: r.getString('swap_day'),
    reason: r.getString('reason'),
    status: r.getString('status'),
    approval: r.getString('approval'),
    peer_note: r.getString('peer_note'),
    decided_note: r.getString('decided_note'),
    created: r.getString('created'),
  };
}

function currentShift(app, empId, day) {
  const util = u();
  const r = util.findOne(app, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: empId, d: day });
  const snap = r !== null ? util.jsonOf(r, 'published', null) : null;
  return snap ? snap.shift_type || '' : '';
}

function openShiftApproval(ctx, req, m) {
  const util = u();
  const app = ctx.app;
  const R = T().resolver(app);
  const v = requestView(app, req);
  let summary = '';
  const payload = { request: req.id, kind: v.kind, from_day: v.from_day, to_day: v.to_day };
  if (v.kind === 'change') {
    summary = 'Shift change for ' + v.name + ': ' + rangeLabel(v.from_day, v.to_day) + ' to ' + (v.shift_name || 'a day off');
    const days = [];
    for (let d = v.from_day; d <= v.to_day; d = util.dayAdd(d, 1)) {
      const cur = currentShift(app, m.id, d);
      days.push({ day: d, from: cur ? typeLabel(R, cur) : 'no shift', to: v.shift_type ? typeLabel(R, v.shift_type) : 'no shift', leave: R.leaveOn(m.id, d) !== null });
    }
    payload.days = days;
  } else {
    summary = 'Shift swap: ' + v.name + ' (' + dayLabel(v.from_day) + ') with ' + v.swap_name + ' (' + dayLabel(v.swap_day) + ')';
    const a = currentShift(app, m.id, v.from_day);
    const b = currentShift(app, v.swap_with, v.swap_day);
    payload.swap = { requester: { name: v.name, day: v.from_day, shift: a ? typeLabel(R, a) : 'no shift' }, peer: { name: v.swap_name, day: v.swap_day, shift: b ? typeLabel(R, b) : 'no shift' } };
  }
  payload.reason = v.reason;
  const F = T().fact;
  const facts = v.kind === 'change' ? [F.days('days', 'Days', v.from_day, v.to_day), F.text('shift', 'New shift', v.shift_name || 'Day off')] : [F.days('day', v.name, v.from_day), F.days('swap_day', v.swap_name, v.swap_day)];
  const ap = L('lib_approvals').open(ctx, { kind: 'shift_request', ref_collection: 'shift_requests', ref_id: req.id, employment: m.id, summary: summary, facts: facts, payload: payload });
  const fresh = app.findRecordById('shift_requests', req.id);
  fresh.set('approval', ap.id);
  if (ap.status === 'pending') fresh.set('status', 'pending');
  app.save(fresh);
  return ap;
}

/** shift-requests.add: ask to change my shift on some days, or to swap a day with a colleague. */
function shiftRequestsAdd(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const people = L('lib_people');
  const m = t.selfEmployment(ctx, util.str(p, 'employment', ''));
  const kind = util.oneOf(p, 'kind', ['change', 'swap'], 'change');
  const from = util.day(p, 'from_day', '');
  if (from === '') throw util.fail(400, 'from_day is required.', 'missing_param', { param: 'from_day' });
  const reason = util.text(p, 'reason', 2000, '');
  const rec = util.newRecord(app, 'shift_requests');
  rec.set('employment', m.id);
  rec.set('kind', kind);
  rec.set('from_day', from);
  rec.set('reason', reason);
  rec.set('requester', ctx.memberId || '');
  let peer = null;
  if (kind === 'change') {
    const to = util.day(p, 'to_day', from);
    if (to < from || util.daysBetween(from, to) > 30) throw util.fail(400, 'A shift change covers at most 31 days.', 'invalid_param');
    rec.set('to_day', to);
    const sref = util.str(p, 'shift_type', '');
    if (sref !== '') {
      const st = shiftTypeRef(app, sref, m.getString('entity'));
      checkCellTarget(ctx, m, from, st);
      rec.set('shift_type', st.id);
    }
    rec.set('status', 'pending');
  } else {
    peer = people.employmentRef(app, util.req(p, 'swap_with'));
    if (peer.id === m.id) throw util.fail(400, 'Swap with someone else.', 'invalid_param');
    if (peer.getString('entity') !== m.getString('entity')) throw util.fail(400, 'Swaps are within one entity.', 'invalid_param');
    const sd = util.day(p, 'swap_day', from);
    if (currentShift(app, m.id, from) === '' && currentShift(app, peer.id, sd) === '') throw util.fail(400, 'Neither of you has a published shift on those days.', 'invalid_param');
    rec.set('to_day', from);
    rec.set('swap_with', peer.id);
    rec.set('swap_day', sd);
    rec.set('status', 'awaiting_peer');
  }
  let ap = null;
  app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    tx.save(rec);
    if (kind === 'change') ap = openShiftApproval(tctx, rec, m);
  });
  const v = requestView(app, app.findRecordById('shift_requests', rec.id));
  if (peer !== null) L('lib_notify').toEmployee(app, peer.getString('employee'), { kind: 'time', title: v.name + ' asks to swap shifts with you on ' + dayLabel(v.swap_day), body: reason, facts: [T().fact.days('your_day', 'Your day', v.swap_day), T().fact.days('their_day', v.name, v.from_day)], link: '#/time/schedule' });
  L('lib_audit').note(ctx, { collection: 'shift_requests', record: rec.id, summary: kind === 'change' ? 'Asked for a shift change ' + rangeLabel(v.from_day, v.to_day) : 'Asked ' + v.swap_name + ' to swap shifts on ' + v.from_day });
  return { request: v, approval: ap };
}

/** shift-requests.respond: the colleague agrees to a swap (then it goes for approval) or declines it. */
function shiftRequestsRespond(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'shift_requests', util.req(p, 'request'));
  if (rec === null) throw util.fail(404, 'No such shift request.', 'not_found');
  if (rec.getString('status') !== 'awaiting_peer') throw util.fail(409, 'This request is ' + rec.getString('status') + '.', 'conflict');
  const peer = app.findRecordById('employments', rec.getString('swap_with'));
  if (ctx.employeeId === '' || peer.getString('employee') !== ctx.employeeId) throw util.fail(403, 'Only the colleague asked can answer this swap.', 'not_permitted');
  const answer = util.oneOf(p, 'answer', ['accept', 'decline'], '');
  if (answer === '') throw util.fail(400, 'answer is accept or decline.', 'missing_param', { param: 'answer' });
  const note = util.text(p, 'note', 1000, '');
  const m = app.findRecordById('employments', rec.getString('employment'));
  let ap = null;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('shift_requests', rec.id);
    r.set('peer_note', note);
    if (answer === 'decline') {
      r.set('status', 'declined');
      tx.save(r);
    } else {
      tx.save(r);
      const reqCtx = Object.assign({}, L('lib_auth').withApp(ctx, tx), { memberId: r.getString('requester') });
      ap = openShiftApproval(reqCtx, r, m);
    }
  });
  const v = requestView(app, app.findRecordById('shift_requests', rec.id));
  if (rec.getString('requester') !== '') L('lib_notify').notify(app, [rec.getString('requester')], { kind: 'time', title: v.swap_name + (answer === 'accept' ? ' agreed to swap; it now waits for approval' : ' declined the swap'), body: note, facts: [T().fact.state('answer', 'Answer', answer === 'accept' ? 'accepted' : 'declined'), T().fact.days('day', 'Your day', v.from_day)], link: '#/time/schedule' });
  L('lib_audit').note(ctx, { collection: 'shift_requests', record: rec.id, summary: (answer === 'accept' ? 'Agreed to' : 'Declined') + ' a shift swap with ' + v.name });
  return { request: v, approval: ap };
}

function shiftRequestsList(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const status = util.oneOf(p, 'status', ['open', 'pending', 'awaiting_peer', 'approved', 'rejected', 'declined', 'cancelled', 'all'], 'open');
  const which = util.oneOf(p, 'view', ['mine', 'team'], 'mine');
  const where = [];
  const bind = {};
  if (status === 'open') where.push("(status = 'pending' || status = 'awaiting_peer')");
  else if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  let ids = [];
  if (which === 'mine') {
    if (ctx.employeeId === '') return { requests: [] };
    ids = util.rows(app, 'SELECT id FROM employments WHERE employee = {:e}', { id: '' }, { e: ctx.employeeId }).map((r) => r.id);
  } else {
    const today = util.today(app);
    ids = t.roster(ctx, util.dayAdd(today, -90), util.dayAdd(today, 90), { entity: util.str(p, 'entity', '') }).map((r) => r.employment);
  }
  if (ids.length === 0) return { requests: [] };
  const keys = ids.map((id, i) => ((bind['i' + i] = id), '{:i' + i + '}'));
  const inList = '(' + keys.join(',') + ')';
  const sql = 'SELECT id FROM shift_requests WHERE (employment IN ' + inList + ' OR swap_with IN ' + inList + ')' + (where.length > 0 ? ' AND ' + where.join(' AND ').replace(/\|\|/g, 'OR') : '') + ' ORDER BY created DESC LIMIT 200';
  return { requests: util.rows(app, sql, { id: '' }, bind).map((x) => requestView(app, app.findRecordById('shift_requests', x.id))) };
}

function shiftRequestsCancel(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'shift_requests', util.req(p, 'request'));
  if (rec === null) throw util.fail(404, 'No such shift request.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  const mine = ctx.employeeId !== '' && m.getString('employee') === ctx.employeeId;
  if (!mine && !L('lib_auth').can(ctx, 'time', 'full')) throw util.fail(403, 'Only the person who asked (or HR) can cancel this request.', 'not_permitted');
  if (['pending', 'awaiting_peer'].indexOf(rec.getString('status')) < 0) return { request: requestView(app, rec) };
  if (rec.getString('approval') !== '' && rec.getString('status') === 'pending') L('lib_approvals').cancel(ctx, rec.getString('approval'), util.text(p, 'note', 500, ''));
  else {
    rec.set('status', 'cancelled');
    app.save(rec);
  }
  L('lib_audit').note(ctx, { collection: 'shift_requests', record: rec.id, summary: 'Cancelled a shift request' });
  return { request: requestView(app, app.findRecordById('shift_requests', rec.id)) };
}

/** Approval subscriber (kind shift_request): apply an approved change or swap as published shifts. */
function onDecision(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const rec = util.byId(app, 'shift_requests', approval.ref_id);
  if (rec === null) return null;
  rec.set('decided_note', util.clip(note || '', 2000));
  if (decision !== 'approved') {
    rec.set('status', decision === 'rejected' ? 'rejected' : 'cancelled');
    app.save(rec);
    return { status: rec.getString('status') };
  }
  const m = app.findRecordById('employments', rec.getString('employment'));
  const publish = (empId, day, sid, loc) => {
    let r = util.findOne(app, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: empId, d: day });
    if (sid === '') {
      if (r !== null) app.delete(r);
      return;
    }
    if (r === null) {
      r = util.newRecord(app, 'shift_assignments');
      r.set('employment', empId);
      r.set('day', day);
    }
    r.set('shift_type', sid);
    r.set('location', loc || '');
    r.set('status', 'published');
    r.set('published', { shift_type: sid, location: loc || '' });
    r.set('published_at', util.nowIso());
    r.set('source', 'request');
    app.save(r);
  };
  const touched = [[m.id, rec.getString('from_day'), rec.getString('to_day') || rec.getString('from_day')]];
  if (rec.getString('kind') === 'change') {
    for (let d = rec.getString('from_day'); d <= (rec.getString('to_day') || rec.getString('from_day')); d = util.dayAdd(d, 1)) publish(m.id, d, rec.getString('shift_type'), '');
  } else {
    const peer = rec.getString('swap_with');
    const a = util.findOne(app, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: m.id, d: rec.getString('from_day') });
    const b = util.findOne(app, 'shift_assignments', 'employment = {:e} && day = {:d}', { e: peer, d: rec.getString('swap_day') });
    const sa = a !== null ? util.jsonOf(a, 'published', null) : null;
    const sb = b !== null ? util.jsonOf(b, 'published', null) : null;
    publish(m.id, rec.getString('from_day'), sb ? sb.shift_type : '', sb ? sb.location : '');
    publish(peer, rec.getString('swap_day'), sa ? sa.shift_type : '', sa ? sa.location : '');
    touched.push([peer, rec.getString('swap_day'), rec.getString('swap_day')]);
    L('lib_notify').toEmployee(app, app.findRecordById('employments', peer).getString('employee'), { kind: 'time', title: 'Shift swap approved for ' + dayLabel(rec.getString('swap_day')), body: '', facts: [T().fact.days('day', 'Day', rec.getString('swap_day'))], link: '#/time/schedule' });
  }
  const t = T();
  for (const x of touched) {
    const today = t.resolver(app).today(x[0]);
    if (x[1] <= today) t.processRange(app, x[0], x[1], x[2] < today ? x[2] : today);
  }
  rec.set('status', 'approved');
  app.save(rec);
  return { status: 'approved' };
}

module.exports = {
  dayLabel: dayLabel,
  rangeLabel: rangeLabel,
  shiftTypeRef: shiftTypeRef,
  shiftTypesList: shiftTypesList,
  shiftTypesAdd: shiftTypesAdd,
  shiftTypesUpdate: shiftTypesUpdate,
  shiftTypesDelete: shiftTypesDelete,
  patternsList: patternsList,
  patternsSave: patternsSave,
  patternsDelete: patternsDelete,
  weekRange: weekRange,
  shiftsWeek: shiftsWeek,
  shiftsSet: shiftsSet,
  shiftsCopyWeek: shiftsCopyWeek,
  shiftsAssignPattern: shiftsAssignPattern,
  shiftsDiscard: shiftsDiscard,
  shiftsPublish: shiftsPublish,
  previewPublish: previewPublish,
  scheduleOf: scheduleOf,
  shiftsMine: shiftsMine,
  shiftsOf: shiftsOf,
  shiftsColleagues: shiftsColleagues,
  requestView: requestView,
  shiftRequestsAdd: shiftRequestsAdd,
  shiftRequestsRespond: shiftRequestsRespond,
  shiftRequestsList: shiftRequestsList,
  shiftRequestsCancel: shiftRequestsCancel,
  onDecision: onDecision,
};
