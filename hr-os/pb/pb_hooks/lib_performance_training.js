/// <reference path="../pb_data/types.d.ts" />
/**
 * Training (Frappe training program, training event, attendees, training
 * result, training feedback):
 *
 *   programs      the course, workshop or certification (provider, hours,
 *                 how long a completion stays valid)
 *   trainings     a scheduled session of a program (days, times, place or
 *                 link, capacity, cost in minor units, status planned,
 *                 open for enrolment, done, cancelled)
 *   attendees     a person on a session (enrolled, attended, completed,
 *                 no show, cancelled) or an external completion, with the
 *                 score and result, the attendee's feedback and rating,
 *                 a certificate (protected file, served through an op),
 *                 completed_on and expires_on
 *   requirements  a program everyone in an entity, department or job title
 *                 must hold: by a day (due_day) and/or within N days of
 *                 starting (due_days); renewals follow the program's
 *                 valid_months. Compliance is computed, never stored.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function core() {
  return L('lib_performance');
}

const KINDS = ['course', 'workshop', 'certification'];
const STATUSES = ['planned', 'open', 'done', 'cancelled'];
const SEATED = ['enrolled', 'invited', 'attended', 'completed'];

function hrEdit(ctx) {
  return ctx.isAgent || ctx.actor === 'system' || L('lib_auth').can(ctx, 'performance', 'edit');
}

function needHrEdit(ctx) {
  if (!hrEdit(ctx)) throw u().fail(403, 'HR (performance edit) manages the training catalogue and sessions.', 'not_permitted');
}

/* ------------------------------------------------------------- programs */

function programView(app, r) {
  const util = u();
  return {
    id: r.id,
    name: r.getString('name'),
    kind: r.getString('kind'),
    provider: r.getString('provider'),
    description: r.getString('description'),
    duration_hours: r.getFloat('duration_hours'),
    valid_months: r.getInt('valid_months'),
    link: r.getString('link'),
    entity: r.getString('entity'),
    archived: r.getBool('archived'),
    sessions: util.count(app, 'SELECT COUNT(*) AS n FROM trainings WHERE program = {:p}', { p: r.id }),
    upcoming: util.count(app, "SELECT COUNT(*) AS n FROM trainings WHERE program = {:p} AND status IN ('planned', 'open') AND start >= {:d}", { p: r.id, d: util.today(app) }),
    completions: util.count(app, "SELECT COUNT(*) AS n FROM training_attendees WHERE program = {:p} AND status = 'completed'", { p: r.id }),
    required: util.count(app, 'SELECT COUNT(*) AS n FROM training_requirements WHERE program = {:p} AND active = TRUE', { p: r.id }),
  };
}

function programRef(app, ref) {
  return u().byIdOrName(app, 'training_programs', ref, 'name', 'training-programs.list');
}

function programsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  if (!util.bool(p, 'archived', false)) where.push('archived = FALSE');
  const kind = util.oneOf(p, 'kind', KINDS.concat(['']), '');
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(name LIKE {:q} ESCAPE '\\' OR provider LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const rows = util.rows(app, 'SELECT id FROM training_programs' + (where.length > 0 ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY name COLLATE NOCASE LIMIT 500', { id: '' }, bind);
  return { programs: rows.map((r) => programView(app, app.findRecordById('training_programs', r.id))), can_edit: !ctx.isAgent && L('lib_auth').can(ctx, 'performance', 'edit') };
}

function programSave(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  needHrEdit(ctx);
  const isNew = rec.isNew();
  const before = isNew ? null : programView(app, rec);
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(util.req(p, 'name', '"Fire safety"'));
    if (name.length > 160) throw util.fail(400, 'name is too long (at most 160 characters)', 'invalid_param', { param: 'name' });
    if (util.count(app, 'SELECT COUNT(*) AS n FROM training_programs WHERE LOWER(name) = LOWER({:n}) AND id != {:id}', { n: name, id: rec.id || '-' }) > 0) throw util.fail(409, 'There is already a program called "' + name + '".', 'conflict');
    rec.set('name', name);
  }
  if (isNew || util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', KINDS, isNew ? 'course' : rec.getString('kind')));
  if (util.has(p, 'provider')) rec.set('provider', util.text(p, 'provider', 160, ''));
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 4000, ''));
  if (util.has(p, 'duration_hours')) rec.set('duration_hours', util.num(p, 'duration_hours', { min: 0, max: 10000 }) || 0);
  if (util.has(p, 'valid_months')) rec.set('valid_months', util.int(p, 'valid_months', 0, 0, 240));
  if (util.has(p, 'link')) rec.set('link', util.text(p, 'link', 500, ''));
  if (util.has(p, 'entity')) rec.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'training_programs', record: rec.id, summary: (isNew ? 'Added' : 'Changed') + ' the training program ' + rec.getString('name'), before: before, after: programView(app, rec) });
  return { program: programView(app, rec) };
}

function programsAdd(ctx, p) {
  return programSave(ctx, p, u().newRecord(ctx.app, 'training_programs'));
}

function programsUpdate(ctx, p) {
  return programSave(ctx, p, programRef(ctx.app, u().req(p, 'program')));
}

function programsDelete(ctx, p) {
  const util = u();
  const rec = programRef(ctx.app, util.req(p, 'program'));
  if (util.count(ctx.app, 'SELECT COUNT(*) AS n FROM training_attendees WHERE program = {:p}', { p: rec.id }) > 0 || util.count(ctx.app, 'SELECT COUNT(*) AS n FROM trainings WHERE program = {:p}', { p: rec.id }) > 0) throw util.fail(409, 'This program has sessions or completions; archive it instead (training-programs.update --archived true).', 'in_use');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'training_programs', record: rec.id, summary: 'Deleted the training program ' + rec.getString('name') });
  return { deleted: true };
}

/* ------------------------------------------------------------- sessions */

function seats(app, trainingId) {
  return u().count(app, "SELECT COUNT(*) AS n FROM training_attendees WHERE training = {:t} AND status IN ('enrolled', 'invited', 'attended', 'completed')", { t: trainingId });
}

function sessionView(ctx, r) {
  const util = u();
  const app = ctx.app;
  const prog = util.byId(app, 'training_programs', r.getString('program'));
  const mine = ctx.employeeId ? util.findOne(app, 'training_attendees', 'training = {:t} && employee = {:e}', { t: r.id, e: ctx.employeeId }) : null;
  const taken = seats(app, r.id);
  return {
    id: r.id,
    program: r.getString('program'),
    program_name: prog !== null ? prog.getString('name') : '',
    valid_months: prog !== null ? prog.getInt('valid_months') : 0,
    title: r.getString('title'),
    kind: r.getString('kind'),
    provider: r.getString('provider'),
    entity: r.getString('entity'),
    start: r.getString('start'),
    end: r.getString('end'),
    start_time: r.getString('start_time'),
    end_time: r.getString('end_time'),
    location: r.getString('location'),
    link: r.getString('link'),
    capacity: r.getInt('capacity'),
    seats_taken: taken,
    full: r.getInt('capacity') > 0 && taken >= r.getInt('capacity'),
    status: r.getString('status'),
    cost_minor: r.getInt('cost_minor'),
    currency: r.getString('currency'),
    trainer: r.getString('trainer'),
    description: r.getString('description'),
    my: mine !== null ? { attendee: mine.id, status: mine.getString('status'), result: mine.getString('result'), rating: mine.getInt('rating'), has_feedback: mine.getString('feedback') !== '' } : null,
    created: r.getString('created'),
  };
}

function sessionRef(ctx, id) {
  const r = u().byId(ctx.app, 'trainings', String(id || ''));
  if (r === null) throw u().fail(404, 'No training session ' + id + '. Run trainings.list.', 'not_found');
  return r;
}

function trainingsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const which = util.oneOf(p, 'view', ['upcoming', 'past', 'mine', 'all'], 'upcoming');
  const where = [];
  const bind = { d: today };
  if (which === 'upcoming') where.push("(COALESCE(NULLIF(t.[[end]], ''), t.start) >= {:d}) AND t.status != 'cancelled'");
  else if (which === 'past') where.push("COALESCE(NULLIF(t.[[end]], ''), t.start) < {:d}");
  else if (which === 'mine') {
    where.push('EXISTS (SELECT 1 FROM training_attendees a WHERE a.training = t.id AND a.employee = {:me})');
    bind.me = ctx.employeeId || '-';
  }
  const prog = util.str(p, 'program', '');
  if (prog !== '') {
    where.push('t.program = {:p}');
    bind.p = programRef(app, prog).id;
  }
  const st = util.oneOf(p, 'status', STATUSES.concat(['']), '');
  if (st !== '') {
    where.push('t.status = {:st}');
    bind.st = st;
  }
  if (!hrEdit(ctx) && which !== 'mine') where.push("(t.status IN ('open', 'done') OR EXISTS (SELECT 1 FROM training_attendees a2 WHERE a2.training = t.id AND a2.employee = {:me2}))");
  bind.me2 = ctx.employeeId || '-';
  const pg = util.page(p, 50, 300);
  const sql = ' FROM trainings t' + (where.length > 0 ? ' WHERE ' + where.join(' AND ') : '');
  const total = util.count(app, 'SELECT COUNT(*) AS n' + sql, bind);
  const rows = util.rows(app, 'SELECT t.id AS id' + sql + ' ORDER BY t.start ' + (which === 'past' ? 'DESC' : 'ASC') + ', t.start_time LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return { trainings: rows.map((r) => sessionView(ctx, app.findRecordById('trainings', r.id))), total: total, limit: pg.limit, offset: pg.offset, can_edit: !ctx.isAgent && L('lib_auth').can(ctx, 'performance', 'edit'), today: today };
}

function attendeeView(ctx, a) {
  const util = u();
  return {
    id: a.id,
    program: a.getString('program'),
    training: a.getString('training'),
    employee: core().chip(ctx, a.getString('employee')),
    status: a.getString('status'),
    score: a.getFloat('score'),
    result: a.getString('result'),
    completed_on: a.getString('completed_on'),
    expires_on: a.getString('expires_on'),
    feedback: a.getString('feedback'),
    rating: a.getInt('rating'),
    has_certificate: a.getString('certificate') !== '',
    verified: a.getString('verified_by') !== '',
    source: a.getString('source'),
    note: a.getString('note'),
    created: a.getString('created'),
  };
}

function canSeeAttendee(ctx, a) {
  return core().relation(ctx, a.getString('employee')).any || ctx.isAgent;
}

function trainingsGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = sessionRef(ctx, util.req(p, 'training'));
  const v = sessionView(ctx, r);
  const rows = util.findMany(app, 'training_attendees', 'training = {:t}', 'created', 0, { t: r.id });
  const visible = rows.filter((a) => canSeeAttendee(ctx, a));
  v.attendees = visible.map((a) => attendeeView(ctx, a));
  v.attendees_hidden = rows.length - visible.length;
  const fb = rows.filter((a) => a.getInt('rating') > 0);
  v.feedback_summary = { count: fb.length, avg_rating: fb.length > 0 ? Math.round((fb.reduce((s, a) => s + a.getInt('rating'), 0) / fb.length) * 10) / 10 : 0 };
  v.can = { edit: !ctx.isAgent && L('lib_auth').can(ctx, 'performance', 'edit'), enrol_self: !ctx.isAgent && !!ctx.employeeId && v.my === null && r.getString('status') === 'open' && !v.full, enrol_team: !ctx.isAgent && Object.keys(core().teamOf(ctx)).length > 0 && (r.getString('status') === 'open' || r.getString('status') === 'planned') };
  return { training: v };
}

function sessionSave(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  needHrEdit(ctx);
  const isNew = rec.isNew();
  const before = isNew ? null : sessionView(ctx, rec);
  if (isNew || util.has(p, 'program') || util.has(p, 'program_name')) {
    let prog;
    if (util.str(p, 'program', '') !== '') prog = programRef(app, util.str(p, 'program', ''));
    else if (util.str(p, 'program_name', '') !== '') {
      const name = util.squash(util.str(p, 'program_name', ''));
      const hit = util.rows(app, 'SELECT id FROM training_programs WHERE LOWER(name) = LOWER({:n}) LIMIT 1', { id: '' }, { n: name })[0];
      if (hit) prog = app.findRecordById('training_programs', hit.id);
      else {
        prog = util.newRecord(app, 'training_programs');
        programSave(ctx, { name: name, kind: util.oneOf(p, 'kind', KINDS, 'course'), provider: util.str(p, 'provider', '') }, prog);
      }
    } else throw util.fail(400, 'Give --program (a program id or name) or --program_name to start a new program.', 'missing_param', { param: 'program' });
    rec.set('program', prog.id);
    if (isNew) {
      rec.set('kind', prog.getString('kind'));
      rec.set('provider', prog.getString('provider'));
    }
    if (isNew && !util.has(p, 'title')) rec.set('title', prog.getString('name'));
  }
  if (util.has(p, 'title')) {
    const t = util.squash(util.str(p, 'title', ''));
    if (t === '' || t.length > 200) throw util.fail(400, 'title is 1 to 200 characters', 'invalid_param', { param: 'title' });
    rec.set('title', t);
  }
  if (util.has(p, 'kind')) rec.set('kind', util.oneOf(p, 'kind', KINDS, rec.getString('kind')));
  if (util.has(p, 'provider')) rec.set('provider', util.text(p, 'provider', 160, ''));
  if (util.has(p, 'entity')) rec.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  if (isNew || util.has(p, 'start')) rec.set('start', util.day(p, 'start', isNew ? util.dayAdd(util.today(app), 14) : rec.getString('start')));
  if (util.has(p, 'end')) rec.set('end', util.day(p, 'end', ''));
  if (rec.getString('end') !== '' && rec.getString('end') < rec.getString('start')) throw util.fail(400, 'The session ends before it starts.', 'invalid_param', { param: 'end' });
  for (const k of ['start_time', 'end_time']) {
    if (!util.has(p, k)) continue;
    const v = util.str(p, k, '');
    if (v !== '' && !util.isTime(v)) throw util.fail(400, k + ' is HH:MM', 'invalid_param', { param: k });
    rec.set(k, v);
  }
  if (util.has(p, 'location')) rec.set('location', util.text(p, 'location', 200, ''));
  if (util.has(p, 'link')) rec.set('link', util.text(p, 'link', 500, ''));
  if (util.has(p, 'capacity')) rec.set('capacity', util.int(p, 'capacity', 0, 0, 100000));
  if (util.has(p, 'trainer')) rec.set('trainer', util.text(p, 'trainer', 160, ''));
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 4000, ''));
  if (util.has(p, 'currency') || util.has(p, 'cost')) {
    let cur = util.str(p, 'currency', '').toUpperCase() || rec.getString('currency');
    if (cur === '') {
      const ent = rec.getString('entity') !== '' ? util.byId(app, 'entities', rec.getString('entity')) : util.findOne(app, 'entities', 'active = true', {});
      cur = ent !== null ? ent.getString('currency') : 'USD';
    }
    if (!/^[A-Z]{3}$/.test(cur)) throw util.fail(400, 'currency is a three-letter code', 'invalid_param', { param: 'currency' });
    rec.set('currency', cur);
    if (util.has(p, 'cost')) rec.set('cost_minor', util.money(p, 'cost', cur) || 0);
  }
  const oldStatus = rec.getString('status');
  if (isNew || util.has(p, 'status')) rec.set('status', util.oneOf(p, 'status', STATUSES, isNew ? 'open' : oldStatus));
  if (isNew) rec.set('created_by', ctx.memberId || '');
  app.save(rec);
  if (!isNew && oldStatus !== 'cancelled' && rec.getString('status') === 'cancelled') {
    for (const a of util.findMany(app, 'training_attendees', "training = {:t} && (status = 'enrolled' || status = 'invited')", '', 0, { t: rec.id })) core().notifyEmployee(app, a.getString('employee'), { kind: 'performance', title: 'Cancelled: ' + rec.getString('title'), link: '#/performance/training/' + rec.id });
  }
  L('lib_audit').note(ctx, { collection: 'trainings', record: rec.id, summary: (isNew ? 'Scheduled' : 'Changed') + ' the training ' + rec.getString('title') + ' on ' + rec.getString('start'), before: before, after: sessionView(ctx, rec) });
  return { training: sessionView(ctx, rec) };
}

function trainingsAdd(ctx, p) {
  return sessionSave(ctx, p, u().newRecord(ctx.app, 'trainings'));
}

function trainingsUpdate(ctx, p) {
  return sessionSave(ctx, p, sessionRef(ctx, u().req(p, 'training')));
}

function trainingsDelete(ctx, p) {
  const util = u();
  const r = sessionRef(ctx, util.req(p, 'training'));
  if (util.count(ctx.app, "SELECT COUNT(*) AS n FROM training_attendees WHERE training = {:t} AND status != 'cancelled'", { t: r.id }) > 0) throw util.fail(409, 'People are on this session; cancel it instead (trainings.update --status cancelled).', 'in_use');
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'trainings', record: r.id, summary: 'Deleted the training session ' + r.getString('title') });
  return { deleted: true };
}

/** Enrol yourself (no --employees) or people you manage (managers, HR). */
function trainingsEnrol(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = sessionRef(ctx, util.req(p, 'training'));
  if (r.getString('status') === 'cancelled' || r.getString('status') === 'done') throw util.fail(409, 'This session is ' + r.getString('status') + '.', 'conflict');
  const listIn = util.list(p, 'employees');
  const self = listIn === undefined || listIn.length === 0;
  const ids = self ? [core().selfOrFail(ctx)] : listIn.map((x) => L('lib_people').employeeRef(app, String(x)).id);
  if (self && r.getString('status') !== 'open') throw util.fail(409, 'This session is not open for enrolment yet.', 'conflict');
  if (ids.length > 200) throw util.fail(400, 'Enrol at most 200 people at once.', 'too_many');
  for (const id of ids) if (!(id === ctx.employeeId) && !core().canManage(ctx, id) && !ctx.isAgent) throw util.fail(403, 'You enrol yourself, or people you manage.', 'not_permitted');
  const cap = r.getInt('capacity');
  let taken = seats(app, r.id);
  const added = [];
  let already = 0;
  for (const id of ids) {
    const old = util.findOne(app, 'training_attendees', 'training = {:t} && employee = {:e}', { t: r.id, e: id });
    if (old !== null && old.getString('status') !== 'cancelled') {
      already++;
      continue;
    }
    if (cap > 0 && taken >= cap) throw util.fail(409, 'The session is full (' + cap + ' seats). ' + added.length + ' enrolled before it filled.', 'full', { added: added.length });
    const a = old !== null ? old : util.newRecord(app, 'training_attendees');
    a.set('program', r.getString('program'));
    a.set('training', r.id);
    a.set('employee', id);
    a.set('status', 'enrolled');
    a.set('source', 'session');
    a.set('enrolled_by', ctx.memberId || '');
    app.save(a);
    taken++;
    added.push(a.id);
    if (id !== ctx.employeeId) core().notifyEmployee(app, id, { kind: 'performance', title: 'You are enrolled: ' + r.getString('title'), link: '#/performance/training/' + r.id });
  }
  L('lib_audit').note(ctx, { collection: 'training_attendees', summary: 'Enrolled ' + added.length + ' in ' + r.getString('title') + ' (' + r.getString('start') + ')' });
  return { enrolled: added.length, already: already, training: sessionView(ctx, r) };
}

function completionDays(app, a, onDay) {
  const util = u();
  const prog = util.byId(app, 'training_programs', a.getString('program'));
  const months = prog !== null ? prog.getInt('valid_months') : 0;
  return { completed_on: onDay, expires_on: months > 0 ? util.addMonths(onDay, months) : '' };
}

/** Mark attendance and results for several attendees: rows [{ attendee | employee, status, score, result }]. */
function trainingsAttendance(ctx, p) {
  const util = u();
  const app = ctx.app;
  needHrEdit(ctx);
  const r = sessionRef(ctx, util.req(p, 'training'));
  const rowsIn = util.list(p, 'rows') || [];
  if (rowsIn.length === 0) throw util.fail(400, 'Give --rows: [{"attendee":"<id>","status":"completed","score":92,"result":"pass"}].', 'missing_param', { param: 'rows' });
  const day = r.getString('end') || r.getString('start');
  const out = [];
  app.runInTransaction((tx) => {
    for (let i = 0; i < rowsIn.length; i++) {
      const x = rowsIn[i];
      util.keysOnly(x, ['attendee', 'employee', 'status', 'score', 'result'], 'row ' + (i + 1));
      let a = null;
      if (x.attendee) a = u().byId(tx, 'training_attendees', String(x.attendee));
      else if (x.employee) {
        const e = L('lib_people').employeeRef(tx, String(x.employee));
        a = u().findOne(tx, 'training_attendees', 'training = {:t} && employee = {:e}', { t: r.id, e: e.id });
        if (a === null) {
          a = u().newRecord(tx, 'training_attendees');
          a.set('program', r.getString('program'));
          a.set('training', r.id);
          a.set('employee', e.id);
          a.set('source', 'session');
          a.set('enrolled_by', ctx.memberId || '');
        }
      }
      if (a === null || (a.getString('training') !== '' && a.getString('training') !== r.id)) throw util.fail(404, 'row ' + (i + 1) + ': no such attendee on this session.', 'not_found');
      const st = String(x.status || a.getString('status') || 'attended');
      if (['enrolled', 'attended', 'completed', 'no_show', 'cancelled'].indexOf(st) < 0) throw util.fail(400, 'row ' + (i + 1) + ': status is enrolled, attended, completed, no_show or cancelled.', 'invalid_param', { param: 'rows' });
      a.set('status', st);
      if (x.score !== undefined && x.score !== '' && x.score !== null) {
        const s = Number(x.score);
        if (!Number.isFinite(s) || s < 0) throw util.fail(400, 'row ' + (i + 1) + ': score is a number.', 'invalid_param', { param: 'rows' });
        a.set('score', s);
      }
      if (x.result !== undefined) {
        if (['pass', 'fail', ''].indexOf(String(x.result)) < 0) throw util.fail(400, 'row ' + (i + 1) + ': result is pass, fail or empty.', 'invalid_param', { param: 'rows' });
        a.set('result', String(x.result));
      }
      if (st === 'completed' && a.getString('result') !== 'fail') {
        const d = completionDays(tx, a, day);
        a.set('completed_on', d.completed_on);
        a.set('expires_on', d.expires_on);
      } else if (st !== 'completed') {
        a.set('completed_on', '');
        a.set('expires_on', '');
      }
      tx.save(a);
      out.push(a.id);
    }
    if (r.getString('status') !== 'done' && day <= u().today(tx)) {
      const s2 = tx.findRecordById('trainings', r.id);
      s2.set('status', 'done');
      tx.save(s2);
    }
  });
  for (const id of out) {
    const a = app.findRecordById('training_attendees', id);
    if (a.getString('status') === 'completed') L('lib_events').emit(ctx, 'training.completed', { attendee: a.id, employee: a.getString('employee'), program: a.getString('program'), completed_on: a.getString('completed_on') });
  }
  L('lib_audit').note(ctx, { collection: 'training_attendees', summary: 'Marked attendance for ' + out.length + ' in ' + r.getString('title') });
  return { updated: out.length, training: trainingsGet(ctx, { training: r.id }).training };
}

/** The attendee's own feedback on a session they attended. */
function trainingsFeedback(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = sessionRef(ctx, util.req(p, 'training'));
  const me = core().selfOrFail(ctx);
  const a = util.findOne(app, 'training_attendees', 'training = {:t} && employee = {:e}', { t: r.id, e: me });
  if (a === null || ['attended', 'completed'].indexOf(a.getString('status')) < 0) throw util.fail(409, 'Feedback is for people who attended this session.', 'conflict');
  const rating = util.int(p, 'rating', a.getInt('rating'), 1, 5);
  const fb = util.text(p, 'feedback', 4000, a.getString('feedback'));
  a.set('rating', rating || 0);
  a.set('feedback', fb);
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'training_attendees', record: a.id, summary: 'Gave feedback on ' + r.getString('title') });
  return { attendee: attendeeView(ctx, a) };
}

function attendeeRef(ctx, id) {
  const a = u().byId(ctx.app, 'training_attendees', String(id || ''));
  if (a === null) throw u().fail(404, 'No attendee ' + id + '.', 'not_found');
  return a;
}

function certificateSet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = attendeeRef(ctx, util.req(p, 'attendee'));
  const rel = core().relation(ctx, a.getString('employee'));
  if (!(rel.self || core().atLeast(rel.hr, 'edit'))) throw util.fail(403, 'The person or HR adds a certificate.', 'not_permitted');
  const f = L('lib_files').fileParam(ctx, p, 'file', 'path');
  if (f === null) throw util.fail(400, 'Attach the certificate (a PDF or an image).', 'missing_param', { param: 'file' });
  a.set('certificate', f);
  if (rel.self && !core().atLeast(rel.hr, 'edit')) a.set('verified_by', '');
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'training_attendees', record: a.id, summary: 'Added a certificate for ' + (core().chip(ctx, a.getString('employee')) || { name: '' }).name });
  return { attendee: attendeeView(ctx, a) };
}

function certificateFile(ctx, p) {
  const util = u();
  const a = attendeeRef(ctx, util.req(p, 'attendee'));
  if (!canSeeAttendee(ctx, a)) throw util.fail(403, 'You cannot open this certificate.', 'not_permitted');
  if (a.getString('certificate') === '') throw util.fail(404, 'No certificate.', 'not_found');
  const prog = util.byId(ctx.app, 'training_programs', a.getString('program'));
  return L('lib_files').serve(ctx, a, 'certificate', 'Certificate ' + (prog !== null ? prog.getString('name') : ''), util.bool(p, 'download', false));
}

/** Record a completion outside a session (an external course or certificate): the person (waits for HR to verify) or HR. */
function recordExternal(ctx, p) {
  const util = u();
  const app = ctx.app;
  const emp = core().employeeParam(ctx, p, 'employee');
  const rel = core().relation(ctx, emp);
  if (!(rel.self || core().atLeast(rel.hr, 'edit') || rel.team)) throw util.fail(403, 'The person, their manager or HR records a completion.', 'not_permitted');
  let prog;
  if (util.str(p, 'program', '') !== '') prog = programRef(app, util.str(p, 'program', ''));
  else {
    const name = util.squash(util.req(p, 'program_name', '"AWS Solutions Architect"'));
    const hit = util.rows(app, 'SELECT id FROM training_programs WHERE LOWER(name) = LOWER({:n}) LIMIT 1', { id: '' }, { n: name })[0];
    if (hit) prog = app.findRecordById('training_programs', hit.id);
    else {
      prog = util.newRecord(app, 'training_programs');
      prog.set('name', name.slice(0, 160));
      prog.set('kind', util.oneOf(p, 'kind', KINDS, 'certification'));
      prog.set('provider', util.text(p, 'provider', 160, ''));
      prog.set('valid_months', util.int(p, 'valid_months', 0, 0, 240));
      app.save(prog);
    }
  }
  const day = util.day(p, 'completed_on', util.today(app));
  const a = util.newRecord(app, 'training_attendees');
  a.set('program', prog.id);
  a.set('training', '');
  a.set('employee', emp);
  a.set('status', 'completed');
  a.set('source', 'external');
  a.set('completed_on', day);
  const months = prog.getInt('valid_months');
  a.set('expires_on', util.day(p, 'expires_on', months > 0 ? util.addMonths(day, months) : ''));
  if (util.has(p, 'score')) a.set('score', util.num(p, 'score', { min: 0 }) || 0);
  a.set('result', util.oneOf(p, 'result', ['pass', 'fail', ''], 'pass'));
  a.set('note', util.text(p, 'note', 2000, ''));
  a.set('enrolled_by', ctx.memberId || '');
  if (core().atLeast(rel.hr, 'edit') || rel.team) a.set('verified_by', ctx.memberId || '');
  const f = L('lib_files').fileParam(ctx, p, 'file', 'path');
  if (f !== null) a.set('certificate', f);
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'training_attendees', record: a.id, summary: 'Recorded ' + prog.getString('name') + ' completed on ' + day + ' for ' + (core().chip(ctx, emp) || { name: '' }).name });
  L('lib_events').emit(ctx, 'training.completed', { attendee: a.id, employee: emp, program: prog.id, completed_on: day });
  return { attendee: attendeeView(ctx, a) };
}

function verify(ctx, p) {
  const util = u();
  const a = attendeeRef(ctx, util.req(p, 'attendee'));
  const rel = core().relation(ctx, a.getString('employee'));
  if (rel.self || !(core().atLeast(rel.hr, 'edit') || rel.team)) throw util.fail(403, 'A manager or HR verifies a completion (not the person).', 'not_permitted');
  a.set('verified_by', ctx.memberId || '');
  ctx.app.save(a);
  L('lib_audit').note(ctx, { collection: 'training_attendees', record: a.id, summary: 'Verified a training completion of ' + (core().chip(ctx, a.getString('employee')) || { name: '' }).name });
  return { attendee: attendeeView(ctx, a) };
}

function cancelAttendee(ctx, p) {
  const util = u();
  const a = attendeeRef(ctx, util.req(p, 'attendee'));
  const rel = core().relation(ctx, a.getString('employee'));
  if (!(rel.self || rel.team || core().atLeast(rel.hr, 'edit'))) throw util.fail(403, 'You cancel your own place, or one for people you manage.', 'not_permitted');
  if (a.getString('status') !== 'enrolled' && a.getString('status') !== 'invited') throw util.fail(409, 'Only an enrolment that has not happened yet is cancelled.', 'conflict');
  a.set('status', 'cancelled');
  ctx.app.save(a);
  L('lib_audit').note(ctx, { collection: 'training_attendees', record: a.id, summary: 'Cancelled a training place of ' + (core().chip(ctx, a.getString('employee')) || { name: '' }).name });
  return { attendee: attendeeView(ctx, a) };
}

/* --------------------------------------------------------- requirements */

function requirementView(app, r) {
  const util = u();
  const prog = util.byId(app, 'training_programs', r.getString('program'));
  const nm = (c, id) => {
    if (!id) return '';
    const x = util.byId(app, c, id);
    return x === null ? '' : x.getString('name');
  };
  return {
    id: r.id,
    program: r.getString('program'),
    program_name: prog !== null ? prog.getString('name') : '',
    program_kind: prog !== null ? prog.getString('kind') : '',
    valid_months: prog !== null ? prog.getInt('valid_months') : 0,
    entity: r.getString('entity'),
    entity_name: nm('entities', r.getString('entity')),
    department: r.getString('department'),
    department_name: nm('departments', r.getString('department')),
    job_title: r.getString('job_title'),
    job_title_name: nm('job_titles', r.getString('job_title')),
    due_days: r.getInt('due_days'),
    due_day: r.getString('due_day'),
    active: r.getBool('active'),
    note: r.getString('note'),
  };
}

function requirementRef(ctx, id) {
  const r = u().byId(ctx.app, 'training_requirements', String(id || ''));
  if (r === null) throw u().fail(404, 'No training requirement ' + id + '.', 'not_found');
  return r;
}

function requirementSave(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  needHrEdit(ctx);
  const isNew = rec.isNew();
  const before = isNew ? null : requirementView(app, rec);
  if (isNew || util.has(p, 'program')) rec.set('program', programRef(app, util.req(p, 'program')).id);
  for (const [k, kind] of [['department', 'department'], ['job_title', 'title']]) if (util.has(p, k)) rec.set(k, util.str(p, k, '') === '' ? '' : L('lib_org').kindRef(app, kind, util.str(p, k, '')).id);
  if (util.has(p, 'entity')) rec.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  if (util.has(p, 'due_days')) rec.set('due_days', util.int(p, 'due_days', 0, 0, 3650));
  if (util.has(p, 'due_day')) rec.set('due_day', util.day(p, 'due_day', ''));
  if (isNew && !util.has(p, 'due_days') && !util.has(p, 'due_day')) rec.set('due_days', 30);
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 1000, ''));
  rec.set('active', util.has(p, 'active') ? util.bool(p, 'active', true) : isNew ? true : rec.getBool('active'));
  app.save(rec);
  const v = requirementView(app, rec);
  L('lib_audit').note(ctx, { collection: 'training_requirements', record: rec.id, summary: (isNew ? 'Required ' : 'Changed the requirement for ') + v.program_name + (v.department_name ? ' in ' + v.department_name : v.entity_name ? ' in ' + v.entity_name : ' for everyone'), before: before, after: v });
  return { requirement: v };
}

function requirementsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const rows = util.findMany(app, 'training_requirements', util.bool(p, 'inactive', false) ? '1=1' : 'active = true', 'created', 500).map((r) => {
    const v = requirementView(app, r);
    const c = { done: 0, expiring: 0, due: 0, overdue: 0 };
    for (const x of complianceFor(ctx, [r], null, today)) c[x.state]++;
    v.counts = c;
    return v;
  });
  return { requirements: rows, can_edit: !ctx.isAgent && L('lib_auth').can(ctx, 'performance', 'edit') };
}

function requirementsAdd(ctx, p) {
  return requirementSave(ctx, p, u().newRecord(ctx.app, 'training_requirements'));
}

function requirementsUpdate(ctx, p) {
  return requirementSave(ctx, p, requirementRef(ctx, u().req(p, 'requirement')));
}

function requirementsDelete(ctx, p) {
  const r = requirementRef(ctx, u().req(p, 'requirement'));
  const v = requirementView(ctx.app, r);
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'training_requirements', record: r.id, summary: 'Removed the requirement for ' + v.program_name });
  return { deleted: true };
}

/* ----------------------------------------------------------- compliance */

/** People a requirement applies to on `today` (within `ids` when given): [{ employee, employment, start_day, entity }]. */
function appliesTo(app, req, ids, today) {
  const util = u();
  const bind = { d: today };
  let sql = "SELECT m.id AS employment, m.employee AS employee, m.start_day AS start_day, m.entity AS entity FROM employments m JOIN employees e ON e.id = m.employee LEFT JOIN job_records j ON j.id = (SELECT j2.id FROM job_records j2 WHERE j2.employment = m.id AND j2.effective_from <= {:d} ORDER BY j2.effective_from DESC LIMIT 1) WHERE m.start_day <= {:d} AND (m.end_day = '' OR m.end_day >= {:d}) AND e.archived = FALSE";
  if (req.getString('entity') !== '') {
    sql += ' AND m.entity = {:ent}';
    bind.ent = req.getString('entity');
  }
  if (req.getString('department') !== '') {
    sql += ' AND j.department = {:dep}';
    bind.dep = req.getString('department');
  }
  if (req.getString('job_title') !== '') {
    sql += ' AND j.job_title = {:jt}';
    bind.jt = req.getString('job_title');
  }
  if (ids !== null) sql += ' AND ' + core().inList('m.employee', ids, bind, 'i');
  const seen = {};
  return util.rows(app, sql + ' ORDER BY m.start_day', { employment: '', employee: '', start_day: '', entity: '' }, bind).filter((r) => {
    if (seen[r.employee]) return false;
    seen[r.employee] = true;
    return true;
  });
}

/** Compliance rows: one per (person, requirement): state done | expiring | due | overdue. */
function complianceFor(ctx, reqs, ids, today) {
  const util = u();
  const app = ctx.app;
  const out = [];
  for (const req of reqs) {
    const prog = req.getString('program');
    for (const x of appliesTo(app, req, ids, today)) {
      const last = util.one(app, "SELECT id, completed_on, expires_on, verified_by, source FROM training_attendees WHERE employee = {:e} AND program = {:p} AND status = 'completed' AND result != 'fail' ORDER BY completed_on DESC LIMIT 1", { id: '', completed_on: '', expires_on: '', verified_by: '', source: '' }, { e: x.employee, p: prog });
      const valid = last !== null && (last.expires_on === '' || last.expires_on >= today);
      let due = '';
      if (valid) due = last.expires_on;
      else {
        if (req.getString('due_day') !== '') due = req.getString('due_day');
        if (req.getInt('due_days') > 0) {
          // The clock starts on the later of the first day and the day the requirement was added.
          const added = req.getString('created').slice(0, 10);
          const from = util.isDay(added) && added > x.start_day ? added : x.start_day;
          const d2 = util.dayAdd(from, req.getInt('due_days'));
          if (due === '' || d2 > due) due = d2;
        }
        if (last !== null && last.expires_on !== '' && last.expires_on < today) due = last.expires_on;
      }
      let state;
      if (valid) state = last.expires_on !== '' && util.daysBetween(today, last.expires_on) <= 30 ? 'expiring' : 'done';
      else state = due !== '' && due < today ? 'overdue' : 'due';
      const upcoming = util.one(app, "SELECT t.id AS id, t.start AS start FROM training_attendees a JOIN trainings t ON t.id = a.training WHERE a.employee = {:e} AND a.program = {:p} AND a.status = 'enrolled' AND t.start >= {:d} ORDER BY t.start LIMIT 1", { id: '', start: '' }, { e: x.employee, p: prog, d: today });
      out.push({ requirement: req.id, program: prog, employee: x.employee, state: state, due: due, completed_on: last !== null ? last.completed_on : '', expires_on: last !== null ? last.expires_on : '', unverified: last !== null && last.source === 'external' && last.verified_by === '', enrolled: upcoming !== null ? { training: upcoming.id, start: upcoming.start } : null });
    }
  }
  return out;
}

function compliance(ctx, p) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app);
  const auth = L('lib_auth');
  const hr = ctx.isAgent || auth.can(ctx, 'performance', 'view');
  let ids;
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    const e = L('lib_people').employeeRef(app, empRef);
    core().needSee(ctx, e.id);
    ids = [e.id];
  } else if (hr) ids = core().visibleIds(ctx);
  else ids = (ctx.employeeId ? [ctx.employeeId] : []).concat(Object.keys(core().teamOf(ctx)));
  let reqs = util.findMany(app, 'training_requirements', 'active = true', 'created', 0);
  const reqRef = util.str(p, 'requirement', '');
  if (reqRef !== '') reqs = reqs.filter((r) => r.id === reqRef);
  let rows = complianceFor(ctx, reqs, ids, today);
  const dep0 = util.str(p, 'department', '');
  const dep = dep0 !== '' ? L('lib_org').kindRef(app, 'department', dep0).id : '';
  const st = util.oneOf(p, 'state', ['done', 'expiring', 'due', 'overdue', 'open', ''], '');
  if (st === 'open') rows = rows.filter((r) => r.state !== 'done');
  else if (st !== '') rows = rows.filter((r) => r.state === st);
  const progNames = {};
  const out = rows
    .map((r) => {
      if (progNames[r.program] === undefined) progNames[r.program] = (util.byId(app, 'training_programs', r.program) || { getString: () => '' }).getString('name');
      return Object.assign({}, r, { employee: core().chip(ctx, r.employee), program_name: progNames[r.program] });
    })
    .filter((r) => dep === '' || (r.employee && core().person(ctx, r.employee.id).department === dep));
  const order = { overdue: 0, due: 1, expiring: 2, done: 3 };
  out.sort((a, b) => order[a.state] - order[b.state] || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const counts = { done: 0, expiring: 0, due: 0, overdue: 0 };
  for (const r of out) counts[r.state]++;
  const pg = util.page(p, 100, 500);
  return { rows: out.slice(pg.offset, pg.offset + pg.limit), total: out.length, counts: counts, today: today };
}

/** A person's requirements that are not done (due, overdue, expiring). */
function dueFor(ctx, employeeId, today) {
  const util = u();
  const reqs = util.findMany(ctx.app, 'training_requirements', 'active = true', 'created', 0);
  const names = {};
  return complianceFor(ctx, reqs, [employeeId], today)
    .filter((r) => r.state !== 'done')
    .map((r) => {
      if (names[r.program] === undefined) names[r.program] = (util.byId(ctx.app, 'training_programs', r.program) || { getString: () => '' }).getString('name');
      return Object.assign({}, r, { program_name: names[r.program] });
    })
    .sort((a, b) => (a.due < b.due ? -1 : 1));
}

function teamOverdue(ctx, today) {
  const team = Object.keys(core().teamOf(ctx));
  if (team.length === 0) return 0;
  const reqs = u().findMany(ctx.app, 'training_requirements', 'active = true', 'created', 0);
  return complianceFor(ctx, reqs, team, today).filter((r) => r.state === 'overdue').length;
}

function upcomingFor(ctx, employeeId, today, n) {
  const util = u();
  return util
    .rows(ctx.app, "SELECT t.id AS id FROM training_attendees a JOIN trainings t ON t.id = a.training WHERE a.employee = {:e} AND a.status IN ('enrolled', 'invited') AND t.status != 'cancelled' AND COALESCE(NULLIF(t.[[end]], ''), t.start) >= {:d} ORDER BY t.start LIMIT " + (n || 5), { id: '' }, { e: employeeId, d: today })
    .map((r) => sessionView(ctx, ctx.app.findRecordById('trainings', r.id)));
}

function historyOf(ctx, employeeId, today) {
  const util = u();
  const app = ctx.app;
  const rows = util.findMany(app, 'training_attendees', 'employee = {:e}', '-created', 200, { e: employeeId }).map((a) => {
    const v = attendeeView(ctx, a);
    const prog = util.byId(app, 'training_programs', a.getString('program'));
    const s = a.getString('training') !== '' ? util.byId(app, 'trainings', a.getString('training')) : null;
    v.program_name = prog !== null ? prog.getString('name') : '';
    v.kind = prog !== null ? prog.getString('kind') : '';
    v.session = s !== null ? { id: s.id, title: s.getString('title'), start: s.getString('start'), end: s.getString('end'), status: s.getString('status') } : null;
    return v;
  });
  return { attendance: rows, due: dueFor(ctx, employeeId, today) };
}

function completedIn(ctx, employeeId, from, to) {
  const util = u();
  return util
    .rows(ctx.app, "SELECT a.id AS id FROM training_attendees a WHERE a.employee = {:e} AND a.status = 'completed' AND a.completed_on >= {:f} AND a.completed_on <= {:t} ORDER BY a.completed_on", { id: '' }, { e: employeeId, f: from, t: to })
    .map((r) => {
      const a = ctx.app.findRecordById('training_attendees', r.id);
      const v = attendeeView(ctx, a);
      v.program_name = (util.byId(ctx.app, 'training_programs', a.getString('program')) || { getString: () => '' }).getString('name');
      return v;
    });
}

function exportCsv(ctx, p) {
  const util = u();
  const res = compliance(ctx, Object.assign({}, p, { limit: 500 }));
  const rows = [['number', 'name', 'department', 'program', 'state', 'due', 'completed_on', 'expires_on', 'unverified']];
  for (const r of res.rows) rows.push([r.employee ? r.employee.number : '', r.employee ? r.employee.name : '', r.employee ? r.employee.department_name : '', r.program_name, r.state, r.due, r.completed_on, r.expires_on, r.unverified ? 'yes' : '']);
  L('lib_audit').write(ctx, { op: 'trainings.export', collection: 'training_attendees', summary: 'Exported training compliance (' + (rows.length - 1) + ' rows) to CSV' });
  return { filename: 'training-' + util.today(ctx.app) + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

/** Cron helper: once a week (Mondays, 09:00 local; force: now), remind people of required trainings overdue or due within 14 days. */
function remindDue(ctx, force) {
  const util = u();
  const app = ctx.app;
  const reqs = util.findMany(app, 'training_requirements', 'active = true', 'created', 0);
  if (reqs.length === 0) return 0;
  const localByEntity = {};
  const per = {};
  const today = util.today(app);
  for (const r of complianceFor(ctx, reqs, null, today)) {
    if (r.state === 'done' || r.state === 'expiring') continue;
    if (r.state === 'due' && !(r.due !== '' && util.daysBetween(today, r.due) <= 14)) continue;
    const pr = core().person(ctx, r.employee);
    if (pr === null) continue;
    if (localByEntity[pr.entity] === undefined) localByEntity[pr.entity] = util.localNow(app, pr.entity || undefined);
    const ln = localByEntity[pr.entity];
    if (!force && (ln.hour !== 9 || ln.weekday !== 1)) continue;
    if (!core().nudgeOnce(app, 'tr:' + r.requirement + ':' + r.employee + ':' + ln.day, ln.day)) continue;
    per[r.employee] = (per[r.employee] || 0) + 1;
  }
  let n = 0;
  for (const emp of Object.keys(per)) {
    core().notifyEmployee(app, emp, { kind: 'performance', title: per[emp] + ' required training' + (per[emp] === 1 ? '' : 's') + ' to complete', link: '#/performance/training', facts: [{ type: 'number', key: 'trainings', label: 'To complete', value: per[emp], unit: per[emp] === 1 ? 'training' : 'trainings' }] });
    n++;
  }
  return n;
}

module.exports = {
  KINDS: KINDS,
  STATUSES: STATUSES,
  programsList: programsList,
  programsAdd: programsAdd,
  programsUpdate: programsUpdate,
  programsDelete: programsDelete,
  trainingsList: trainingsList,
  trainingsGet: trainingsGet,
  trainingsAdd: trainingsAdd,
  trainingsUpdate: trainingsUpdate,
  trainingsDelete: trainingsDelete,
  trainingsEnrol: trainingsEnrol,
  trainingsAttendance: trainingsAttendance,
  trainingsFeedback: trainingsFeedback,
  certificateSet: certificateSet,
  certificateFile: certificateFile,
  recordExternal: recordExternal,
  verify: verify,
  cancelAttendee: cancelAttendee,
  requirementsList: requirementsList,
  requirementsAdd: requirementsAdd,
  requirementsUpdate: requirementsUpdate,
  requirementsDelete: requirementsDelete,
  compliance: compliance,
  dueFor: dueFor,
  teamOverdue: teamOverdue,
  upcomingFor: upcomingFor,
  historyOf: historyOf,
  completedIn: completedIn,
  exportCsv: exportCsv,
  remindDue: remindDue,
};
