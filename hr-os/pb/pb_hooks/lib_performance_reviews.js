/// <reference path="../pb_data/types.d.ts" />
/**
 * Review cycles (Frappe appraisal cycle, appraisal, appraisee; Lattice and
 * Culture Amp review cycles):
 *
 *   template   sections: goals (weight, rated per goal), competencies
 *              [{ key, name, description }] rated on the scale, questions
 *              [{ key, text, required }]; scale { points 3..7, labels };
 *              overall_kinds (self, manager) give an overall rating.
 *   cycle      draft -> active (launch snapshots the template and creates
 *              participants and their reviews) -> closed. Phases with
 *              dates (goals, self, peer, upward, manager, calibration,
 *              sharing) drive what each person owes, due days and the
 *              daily reminders; people can still submit late while the
 *              cycle is active.
 *   participant one per person: stage open -> submitted (manager review in)
 *              -> shared (with the employee) -> acknowledged, or signoff
 *              (an HR sign-off approval, kind review_signoff, where the
 *              entity requires it) -> signed. final = the calibrated rating
 *              (every change has a reason, kept in calibration history and
 *              the audit trail); no automatic curve.
 *   review     per reviewer: self, manager, peer, upward; draft (autosaved)
 *              -> submitted, or declined (peer and upward).
 *
 * Your AI agent never writes, rates, ranks or decides a review: it can only
 * draft a neutral summary (review_summary_draft trigger -> review-summaries.submit)
 * that the manager may use or ignore; the summary has no rating field.
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

const KINDS = ['self', 'manager', 'peer', 'upward'];
const PHASES = ['goals', 'self', 'peer', 'upward', 'manager', 'calibration', 'sharing'];
const CYCLE_KINDS = ['annual', 'half_year', 'quarterly', 'probation', 'project'];
const SECTION_KINDS = ['goals', 'competencies', 'questions'];
const AFTER_SHARE = ['shared', 'acknowledged', 'signoff', 'signed'];
const PHASE_LABEL = { goals: 'Goal setting', self: 'Self reviews', peer: 'Peer reviews', upward: 'Upward reviews', manager: 'Manager reviews', calibration: 'Calibration', sharing: 'Sharing' };

/* ------------------------------------------------------------ templates */

function sectionKey(util, s, i, used) {
  let k = util.slug(s.key || s.title || s.kind).replace(/-/g, '_').slice(0, 30) || 'section_' + (i + 1);
  while (used[k]) k = k + '_' + (i + 1);
  used[k] = true;
  return k;
}

function readScale(p, existing) {
  const util = u();
  if (!util.has(p, 'scale')) return existing;
  const s = util.obj(p, 'scale') || {};
  util.keysOnly(s, ['points', 'labels'], 'scale');
  const points = Number(s.points || (Array.isArray(s.labels) ? s.labels.length : 5));
  if (!Number.isInteger(points) || points < 3 || points > 7) throw util.fail(400, 'scale.points is 3 to 7.', 'invalid_param', { param: 'scale' });
  const labels = Array.isArray(s.labels) ? s.labels.map((x) => util.clip(util.squash(x), 40)) : [];
  if (labels.length !== points || labels.some((x) => x === '')) throw util.fail(400, 'scale.labels needs ' + points + ' labels, lowest first.', 'invalid_param', { param: 'scale' });
  return { points: points, labels: labels };
}

function readSections(p, existing) {
  const util = u();
  const raw = util.list(p, 'sections');
  if (raw === undefined) return existing;
  if (raw.length === 0 || raw.length > 8) throw util.fail(400, 'A template has 1 to 8 sections.', 'invalid_param', { param: 'sections' });
  const used = {};
  let goals = 0;
  return raw.map((s, i) => {
    util.keysOnly(s, ['key', 'kind', 'title', 'weight', 'kinds', 'rate', 'items'], 'section ' + (i + 1));
    if (SECTION_KINDS.indexOf(s.kind) < 0) throw util.fail(400, 'section ' + (i + 1) + ': kind is one of ' + SECTION_KINDS.join(', ') + '.', 'invalid_param', { param: 'sections' });
    if (s.kind === 'goals' && ++goals > 1) throw util.fail(400, 'Only one goals section.', 'invalid_param', { param: 'sections' });
    const title = util.clip(util.squash(s.title || (s.kind === 'goals' ? 'Goals' : s.kind === 'competencies' ? 'Competencies' : 'Questions')), 80);
    const dflt = s.kind === 'goals' ? ['self', 'manager'] : KINDS;
    const kinds = Array.isArray(s.kinds) ? s.kinds.filter((k) => KINDS.indexOf(k) >= 0) : dflt;
    if (kinds.length === 0) throw util.fail(400, 'section ' + (i + 1) + ': kinds lists who answers it (self, manager, peer, upward).', 'invalid_param', { param: 'sections' });
    const out = { key: sectionKey(util, s, i, used), kind: s.kind, title: title, kinds: s.kind === 'goals' ? kinds.filter((k) => k === 'self' || k === 'manager') : kinds };
    if (s.kind !== 'questions') {
      const w = s.weight === undefined || s.weight === '' ? (s.kind === 'goals' ? 50 : 50) : Number(s.weight);
      if (!Number.isFinite(w) || w < 0 || w > 100) throw util.fail(400, 'section ' + (i + 1) + ': weight is 0 to 100.', 'invalid_param', { param: 'sections' });
      out.weight = Math.round(w);
    }
    if (s.kind === 'goals') out.rate = s.rate !== false;
    if (s.kind !== 'goals') {
      const items = Array.isArray(s.items) ? s.items : [];
      if (items.length === 0 || items.length > 30) throw util.fail(400, 'section ' + (i + 1) + ': 1 to 30 items.', 'invalid_param', { param: 'sections' });
      const ik = {};
      out.items = items.map((it, j) => {
        const where = 'section ' + (i + 1) + ' item ' + (j + 1);
        if (s.kind === 'competencies') {
          const item = typeof it === 'string' ? { name: it } : it;
          util.keysOnly(item, ['key', 'name', 'description'], where);
          const name = util.squash(item.name || '');
          if (name === '' || name.length > 120) throw util.fail(400, where + ': a name of 1 to 120 characters.', 'invalid_param', { param: 'sections' });
          let key = util.slug(item.key || name).replace(/-/g, '_').slice(0, 30) || 'c' + (j + 1);
          while (ik[key]) key = key + '_' + (j + 1);
          ik[key] = true;
          return { key: key, name: name, description: util.clip(util.squash(item.description || ''), 600) };
        }
        const item = typeof it === 'string' ? { text: it } : it;
        util.keysOnly(item, ['key', 'text', 'help', 'required'], where);
        const text0 = util.squash(item.text || '');
        if (text0 === '' || text0.length > 300) throw util.fail(400, where + ': a question of 1 to 300 characters.', 'invalid_param', { param: 'sections' });
        let key = util.slug(item.key || text0).replace(/-/g, '_').slice(0, 30) || 'q' + (j + 1);
        while (ik[key]) key = key + '_' + (j + 1);
        ik[key] = true;
        return { key: key, text: text0, help: util.clip(util.squash(item.help || ''), 300), required: item.required === true };
      });
    }
    return out;
  });
}

function readOverallKinds(p, existing) {
  const util = u();
  const raw = util.list(p, 'overall_kinds');
  if (raw === undefined) return existing;
  const out = raw.filter((k) => k === 'self' || k === 'manager');
  if (out.length !== raw.length) throw util.fail(400, 'overall_kinds lists self and/or manager (peers and upward reviewers never give an overall rating).', 'invalid_param', { param: 'overall_kinds' });
  return out;
}

function templateView(app, r) {
  const util = u();
  const used = util.count(app, "SELECT COUNT(*) AS n FROM review_cycles WHERE template = {:t}", { t: r.id });
  return {
    id: r.id,
    name: r.getString('name'),
    description: r.getString('description'),
    entity: r.getString('entity'),
    scale: util.jsonOf(r, 'scale', { points: 5, labels: [] }),
    sections: util.jsonOf(r, 'sections', []) || [],
    overall_kinds: util.jsonOf(r, 'overall_kinds', []) || [],
    builtin: r.getBool('builtin'),
    archived: r.getBool('archived'),
    used_by: used,
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

function templateRef(app, ref) {
  return u().byIdOrName(app, 'review_templates', ref, 'name', 'templates.list');
}

function templatesList(ctx, p) {
  const util = u();
  const all = util.bool(p, 'archived', false);
  return { templates: util.findMany(ctx.app, 'review_templates', all ? '1=1' : 'archived = false', 'sort,name', 200).map((r) => templateView(ctx.app, r)) };
}

function templatesGet(ctx, p) {
  return { template: templateView(ctx.app, templateRef(ctx.app, u().req(p, 'template'))) };
}

function templateSave(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  const isNew = rec.id === '' || rec.isNew();
  const before = isNew ? null : templateView(app, rec);
  if (isNew || util.has(p, 'name')) {
    const name = util.squash(util.req(p, 'name', '"Annual review 2027"'));
    if (name.length > 120) throw util.fail(400, 'name is too long (at most 120 characters)', 'invalid_param', { param: 'name' });
    rec.set('name', name);
  }
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 1000, ''));
  if (util.has(p, 'entity')) rec.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  const scale = readScale(p, isNew ? { points: 5, labels: ['Below expectations', 'Partly meets', 'Meets expectations', 'Exceeds', 'Outstanding'] } : util.jsonOf(rec, 'scale', null));
  const sections = readSections(p, isNew ? null : util.jsonOf(rec, 'sections', []));
  if (sections === null) throw util.fail(400, 'Give --sections (a JSON list of goals, competencies and questions sections).', 'missing_param', { param: 'sections' });
  rec.set('scale', scale);
  rec.set('sections', sections);
  rec.set('overall_kinds', readOverallKinds(p, isNew ? ['self', 'manager'] : util.jsonOf(rec, 'overall_kinds', [])));
  if (util.has(p, 'archived')) rec.set('archived', util.bool(p, 'archived', false));
  if (isNew) {
    rec.set('builtin', false);
    rec.set('sort', 100);
  }
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'review_templates', record: rec.id, summary: (isNew ? 'Added' : 'Changed') + ' the review template ' + rec.getString('name'), before: before, after: templateView(app, rec) });
  return { template: templateView(app, rec) };
}

function templatesCreate(ctx, p) {
  const util = u();
  const rec = util.newRecord(ctx.app, 'review_templates');
  const from = util.str(p, 'copy_of', '');
  if (from !== '') {
    const src = templateRef(ctx.app, from);
    const q = Object.assign({}, p);
    if (!util.has(q, 'sections')) q.sections = util.jsonOf(src, 'sections', []);
    if (!util.has(q, 'scale')) q.scale = util.jsonOf(src, 'scale', {});
    if (!util.has(q, 'overall_kinds')) q.overall_kinds = util.jsonOf(src, 'overall_kinds', []);
    if (!util.has(q, 'description')) q.description = src.getString('description');
    delete q.copy_of;
    return templateSave(ctx, q, rec);
  }
  return templateSave(ctx, p, rec);
}

function templatesUpdate(ctx, p) {
  const rec = templateRef(ctx.app, u().req(p, 'template'));
  return templateSave(ctx, p, rec);
}

function templatesDelete(ctx, p) {
  const util = u();
  const rec = templateRef(ctx.app, util.req(p, 'template'));
  if (util.count(ctx.app, 'SELECT COUNT(*) AS n FROM review_cycles WHERE template = {:t}', { t: rec.id }) > 0) throw util.fail(409, 'Cycles use this template; archive it instead (templates.update --archived true).', 'in_use');
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: 'review_templates', record: rec.id, summary: 'Deleted the review template ' + rec.getString('name') });
  return { deleted: true };
}

/* --------------------------------------------------------------- cycles */

function snapshotOf(app, cycle) {
  const util = u();
  const snap = util.jsonOf(cycle, 'template_snapshot', null);
  if (snap && snap.sections) return snap;
  const t = util.byId(app, 'review_templates', cycle.getString('template'));
  if (t === null) return { name: '', scale: { points: 5, labels: ['1', '2', '3', '4', '5'] }, sections: [], overall_kinds: [] };
  return { template: t.id, name: t.getString('name'), scale: util.jsonOf(t, 'scale', {}), sections: util.jsonOf(t, 'sections', []) || [], overall_kinds: util.jsonOf(t, 'overall_kinds', []) || [] };
}

function phasesOf(cycle, today) {
  const util = u();
  const raw = util.jsonOf(cycle, 'phases', []) || [];
  return raw
    .map((ph) => Object.assign({}, ph, { label: PHASE_LABEL[ph.key] || ph.key, state: today < ph.start ? 'upcoming' : today > ph.end ? 'done' : 'open', days_left: today <= ph.end ? util.daysBetween(today, ph.end) : 0 }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : PHASES.indexOf(a.key) - PHASES.indexOf(b.key)));
}

function phaseOf(cycle, key) {
  return (u().jsonOf(cycle, 'phases', []) || []).filter((x) => x.key === key)[0] || null;
}

function readPhases(p, cycleKind, start) {
  const util = u();
  const raw = util.list(p, 'phases');
  if (raw === undefined) return undefined;
  const seen = {};
  const out = raw.map((ph, i) => {
    util.keysOnly(ph, ['key', 'start', 'end'], 'phase ' + (i + 1));
    if (PHASES.indexOf(ph.key) < 0) throw util.fail(400, 'phase ' + (i + 1) + ': key is one of ' + PHASES.join(', ') + '.', 'invalid_param', { param: 'phases' });
    if (seen[ph.key]) throw util.fail(400, 'The ' + ph.key + ' phase is listed twice.', 'invalid_param', { param: 'phases' });
    seen[ph.key] = true;
    if (!util.isDay(ph.start) || !util.isDay(ph.end)) throw util.fail(400, 'phase ' + ph.key + ': start and end are days (YYYY-MM-DD).', 'invalid_param', { param: 'phases' });
    if (ph.end < ph.start) throw util.fail(400, 'phase ' + ph.key + ' ends before it starts.', 'invalid_param', { param: 'phases' });
    return { key: ph.key, start: ph.start, end: ph.end };
  });
  if (!seen.self && !seen.manager) throw util.fail(400, 'A cycle needs a self review or a manager review phase.', 'invalid_param', { param: 'phases' });
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "November 2026" for a day: a cycle name reads as words, never an ISO month. */
function monthYear(day) {
  return MONTHS[Number(day.slice(5, 7)) - 1] + ' ' + day.slice(0, 4);
}

/** Suggested period, name and phases for a kind of cycle starting on a day. */
function defaultsFor(kind, today, entityFy) {
  const util = u();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  let ps;
  let pe;
  let name;
  if (kind === 'annual') {
    const fy = entityFy && /^\d{2}-\d{2}$/.test(entityFy) ? entityFy : '01-01';
    ps = y + '-' + fy;
    if (ps > today) ps = y - 1 + '-' + fy;
    pe = util.dayAdd(util.addMonths(ps, 12), -1);
    name = 'Annual review ' + (fy === '01-01' ? ps.slice(0, 4) : ps.slice(0, 4) + '-' + pe.slice(2, 4));
  } else if (kind === 'half_year') {
    ps = m <= 6 ? y + '-01-01' : y + '-07-01';
    pe = m <= 6 ? y + '-06-30' : y + '-12-31';
    name = (m <= 6 ? 'First' : 'Second') + ' half review ' + y;
  } else if (kind === 'quarterly') {
    const q = Math.floor((m - 1) / 3);
    ps = y + '-' + util.pad(q * 3 + 1) + '-01';
    pe = util.monthEnd(y + '-' + util.pad(q * 3 + 3) + '-01');
    name = 'Q' + (q + 1) + ' check-in ' + y;
  } else if (kind === 'probation') {
    ps = util.dayAdd(today, -90);
    pe = util.dayAdd(today, 30);
    name = 'Probation reviews ' + monthYear(today);
  } else {
    ps = util.dayAdd(today, -90);
    pe = today;
    name = 'Project review ' + monthYear(today);
  }
  const at = (a, b) => ({ start: util.dayAdd(today, a), end: util.dayAdd(today, b) });
  let phases;
  if (kind === 'probation') phases = [Object.assign({ key: 'manager' }, at(0, 6)), Object.assign({ key: 'sharing' }, at(7, 13))];
  else if (kind === 'quarterly') phases = [Object.assign({ key: 'self' }, at(0, 6)), Object.assign({ key: 'manager' }, at(3, 10)), Object.assign({ key: 'sharing' }, at(11, 17))];
  else if (kind === 'project') phases = [Object.assign({ key: 'peer' }, at(0, 9)), Object.assign({ key: 'manager' }, at(0, 9)), Object.assign({ key: 'sharing' }, at(10, 16))];
  else phases = [Object.assign({ key: 'self' }, at(0, 13)), Object.assign({ key: 'manager' }, at(7, 20)), Object.assign({ key: 'calibration' }, at(21, 27)), Object.assign({ key: 'sharing' }, at(28, 41))];
  const template = kind === 'probation' ? 'Probation review' : kind === 'quarterly' ? 'Quarterly check-in' : 'Annual review';
  return { kind: kind, name: name, period_start: ps, period_end: pe, phases: phases, template_name: template };
}

function cyclesDefaults(ctx, p) {
  const util = u();
  const app = ctx.app;
  const kind = util.oneOf(p, 'kind', CYCLE_KINDS, 'annual');
  const entRef = util.str(p, 'entity', '');
  const ent = entRef !== '' ? L('lib_org').entityRef(app, entRef) : null;
  const d = defaultsFor(kind, util.day(p, 'start', util.today(app, ent ? ent.id : undefined)), ent ? ent.getString('fiscal_year_start') : '');
  const t = util.findOne(app, 'review_templates', 'name = {:n} && archived = false', { n: d.template_name });
  d.template = t !== null ? t.id : '';
  return { defaults: d, phases: PHASES.map((k) => ({ key: k, label: PHASE_LABEL[k] })) };
}

function readRule(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.obj(p, 'participants');
  if (r === undefined) return undefined;
  util.keysOnly(r, ['entities', 'departments', 'employees', 'exclude', 'started_before', 'probation_ending'], 'participants');
  const ids = (list, fn, name) => {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw util.fail(400, 'participants.' + name + ' must be a list.', 'invalid_param', { param: 'participants' });
    if (list.length > 2000) throw util.fail(400, 'participants.' + name + ': at most 2000.', 'invalid_param', { param: 'participants' });
    return list.map((x) => fn(String(x)).id);
  };
  const out = {
    entities: ids(r.entities, (x) => L('lib_org').entityRef(app, x), 'entities'),
    departments: ids(r.departments, (x) => L('lib_org').kindRef(app, 'department', x), 'departments'),
    employees: ids(r.employees, (x) => L('lib_people').employeeRef(app, x), 'employees'),
    exclude: ids(r.exclude, (x) => L('lib_people').employeeRef(app, x), 'exclude'),
    started_before: '',
    probation_ending: r.probation_ending === true,
  };
  if (r.started_before) {
    if (!util.isDay(String(r.started_before))) throw util.fail(400, 'participants.started_before is a day (YYYY-MM-DD).', 'invalid_param', { param: 'participants' });
    out.started_before = String(r.started_before);
  }
  return out;
}

/** The employments a cycle's participant rule picks on `day`: [{ employment, employee, entity }]. */
function resolveParticipants(ctx, cycle, day) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const rule = util.jsonOf(cycle, 'participants', {}) || {};
  const auth = L('lib_auth');
  const sc = auth.scope(ctx);
  const cycleEnt = cycle.getString('entity');
  const listOnly = (rule.employees || []).length > 0 && (rule.entities || []).length === 0 && (rule.departments || []).length === 0 && !rule.probation_ending;
  const pool = {};
  const add = (e) => {
    if (cycleEnt !== '' && e.entity !== cycleEnt) return;
    if (sc.length > 0 && sc.indexOf(e.entity) < 0) return;
    if (pool[e.employee] !== undefined) return;
    pool[e.employee] = { employment: e.id, employee: e.employee, entity: e.entity, start_day: e.start_day, probation_end: e.probation_end, name: e.name, number: e.employee_number };
  };
  if (!listOnly) {
    const ents = (rule.entities || []).length > 0 ? rule.entities : [cycleEnt];
    for (const ent of ents) {
      for (const e of people.activeEmployments(app, { entity: ent || undefined, from: day, to: day })) {
        if (rule.probation_ending && !(e.probation_end !== '' && e.probation_end >= cycle.getString('period_start') && e.probation_end <= cycle.getString('period_end'))) continue;
        if ((rule.departments || []).length > 0) {
          const job = people.rowOn(app, 'job_records', e.id, day);
          if (job === null || rule.departments.indexOf(job.getString('department')) < 0) continue;
        }
        add(e);
      }
    }
  }
  for (const emp of rule.employees || []) {
    const id = people.primaryEmployment(app, emp, day);
    if (id === '') continue;
    const e = people.activeEmployments(app, { ids: [id], from: day, to: day })[0];
    if (e !== undefined) add(e);
  }
  const out = [];
  for (const k of Object.keys(pool)) {
    const x = pool[k];
    if ((rule.exclude || []).indexOf(x.employee) >= 0) continue;
    if (rule.started_before && x.start_day > rule.started_before) continue;
    out.push(x);
  }
  out.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  return out;
}

function cycleRef(ctx, id) {
  const r = u().byId(ctx.app, 'review_cycles', String(id || ''));
  if (r === null) throw u().fail(404, 'No review cycle ' + id + '. Run cycles.list.', 'not_found');
  return r;
}

/** HR who may run this cycle (performance full in its entity). */
function canRun(ctx, cycle) {
  if (ctx.actor === 'system') return true;
  const auth = L('lib_auth');
  if (!auth.can(ctx, 'performance', 'full')) return false;
  const ent = cycle.getString('entity');
  return ent === '' ? auth.scope(ctx).length === 0 : auth.inScope(ctx, ent);
}

function needRun(ctx, cycle) {
  if (!canRun(ctx, cycle)) throw u().fail(403, 'Only HR with full performance access to this entity runs this cycle.', 'not_permitted');
}

function cycleCounts(app, cycleId) {
  const util = u();
  const by = {};
  for (const k of KINDS) by[k] = { total: 0, submitted: 0, declined: 0 };
  for (const r of util.rows(app, "SELECT r.kind AS kind, r.status AS status, COUNT(*) AS n FROM reviews r JOIN review_participants p ON p.id = r.participant WHERE r.cycle = {:c} AND p.stage != 'removed' GROUP BY r.kind, r.status", { kind: '', status: '', n: 0 }, { c: cycleId })) {
    by[r.kind].total += r.n;
    if (r.status === 'submitted') by[r.kind].submitted += r.n;
    if (r.status === 'declined') by[r.kind].declined += r.n;
  }
  const stages = {};
  for (const r of util.rows(app, 'SELECT stage, COUNT(*) AS n FROM review_participants WHERE cycle = {:c} GROUP BY stage', { stage: '', n: 0 }, { c: cycleId })) stages[r.stage] = r.n;
  let people = 0;
  for (const k of Object.keys(stages)) if (k !== 'removed') people += stages[k];
  return { reviews: by, stages: stages, participants: people };
}

function cycleView(ctx, r, today) {
  const util = u();
  const app = ctx.app;
  const d = today || util.today(app, r.getString('entity') || undefined);
  const snap = snapshotOf(app, r);
  const ent = r.getString('entity') !== '' ? util.byId(app, 'entities', r.getString('entity')) : null;
  return {
    id: r.id,
    name: r.getString('name'),
    kind: r.getString('kind'),
    entity: r.getString('entity'),
    entity_name: ent !== null ? ent.getString('name') : '',
    period_start: r.getString('period_start'),
    period_end: r.getString('period_end'),
    status: r.getString('status'),
    template: r.getString('template'),
    template_name: snap.name || '',
    scale: snap.scale,
    phases: phasesOf(r, d),
    participants_rule: util.jsonOf(r, 'participants', {}) || {},
    launched_at: r.getString('launched_at'),
    closed_at: r.getString('closed_at'),
    note: r.getString('note'),
    counts: cycleCounts(app, r.id),
    can: { run: !ctx.isAgent && canRun(ctx, r) },
    created: r.getString('created'),
  };
}

/** Cycles the caller takes part in, reviews in, manages people in, or runs as HR. */
function cycleIdsFor(ctx) {
  const util = u();
  const app = ctx.app;
  const ids = {};
  if (ctx.isAgent || L('lib_auth').can(ctx, 'performance', 'view')) {
    const sc = L('lib_auth').scope(ctx);
    for (const r of util.rows(app, 'SELECT id, entity FROM review_cycles', { id: '', entity: '' })) if (sc.length === 0 || r.entity === '' || sc.indexOf(r.entity) >= 0) ids[r.id] = true;
  }
  if (ctx.employeeId) {
    for (const r of util.rows(app, "SELECT DISTINCT cycle FROM review_participants WHERE employee = {:e} AND stage != 'removed'", { cycle: '' }, { e: ctx.employeeId })) ids[r.cycle] = true;
    for (const r of util.rows(app, 'SELECT DISTINCT cycle FROM reviews WHERE reviewer = {:e}', { cycle: '' }, { e: ctx.employeeId })) ids[r.cycle] = true;
    const team = Object.keys(core().teamOf(ctx));
    if (team.length > 0) {
      const bind = {};
      for (const r of util.rows(app, 'SELECT DISTINCT cycle FROM review_participants WHERE ' + core().inList('employee', team, bind, 't'), { cycle: '' }, bind)) ids[r.cycle] = true;
    }
  }
  return ids;
}

function cyclesList(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['draft', 'active', 'closed', 'open', 'all'], 'all');
  const ids = cycleIdsFor(ctx);
  const where = status === 'all' ? '1=1' : status === 'open' ? "status != 'closed'" : 'status = {:s}';
  const today = util.today(ctx.app);
  const rows = util
    .findMany(ctx.app, 'review_cycles', where, '-period_end,-created', 500, { s: status })
    .filter((r) => ids[r.id] && (r.getString('status') !== 'draft' || canRun(ctx, r) || ctx.isAgent))
    .map((r) => cycleView(ctx, r, today));
  return { cycles: rows, total: rows.length, can_create: !ctx.isAgent && L('lib_auth').can(ctx, 'performance', 'full') };
}

function cyclesGet(ctx, p) {
  const util = u();
  const r = cycleRef(ctx, util.req(p, 'cycle'));
  if (!cycleIdsFor(ctx)[r.id] || (r.getString('status') === 'draft' && !canRun(ctx, r) && !ctx.isAgent)) throw util.fail(403, 'You cannot see this cycle.', 'not_permitted');
  const v = cycleView(ctx, r);
  v.template_snapshot = snapshotOf(ctx.app, r);
  v.my = ctx.employeeId ? { participant: (util.findOne(ctx.app, 'review_participants', 'cycle = {:c} && employee = {:e}', { c: r.id, e: ctx.employeeId }) || { id: '' }).id, to_write: util.count(ctx.app, "SELECT COUNT(*) AS n FROM reviews WHERE cycle = {:c} AND reviewer = {:e} AND status = 'draft'", { c: r.id, e: ctx.employeeId }) } : null;
  return { cycle: v };
}

function cycleSave(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  const isNew = rec.isNew();
  const before = isNew ? null : cycleView(ctx, rec);
  const draft = isNew || rec.getString('status') === 'draft';
  if (!isNew) needRun(ctx, rec);
  if (!draft) {
    for (const k of ['kind', 'entity', 'template', 'participants', 'period_start', 'period_end']) if (util.has(p, k)) throw util.fail(409, 'The cycle is ' + rec.getString('status') + '; only its name, note and phase dates change now (' + k + ' is fixed at launch).', 'conflict', { param: k });
    if (rec.getString('status') === 'closed') throw util.fail(409, 'This cycle is closed.', 'conflict');
  }
  const kind = isNew ? util.oneOf(p, 'kind', CYCLE_KINDS, 'annual') : util.has(p, 'kind') ? util.oneOf(p, 'kind', CYCLE_KINDS, rec.getString('kind')) : rec.getString('kind');
  rec.set('kind', kind);
  if (isNew || util.has(p, 'entity')) {
    const er = util.str(p, 'entity', '');
    const ent = er !== '' ? L('lib_org').entityRef(app, er) : null;
    if (ent !== null && !L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'This entity is outside your entities.', 'not_permitted');
    if (ent === null && L('lib_auth').scope(ctx).length > 0 && !ctx.isAgent) throw util.fail(400, 'Pick the entity this cycle is for (you work in some entities only).', 'missing_param', { param: 'entity' });
    rec.set('entity', ent !== null ? ent.id : '');
  }
  const ent = rec.getString('entity') !== '' ? util.byId(app, 'entities', rec.getString('entity')) : null;
  const today = util.today(app, ent ? ent.id : undefined);
  const d = defaultsFor(kind, today, ent ? ent.getString('fiscal_year_start') : '');
  if (isNew || util.has(p, 'name')) rec.set('name', util.clip(util.squash(util.str(p, 'name', '') || (isNew ? d.name : rec.getString('name'))), 160));
  if (rec.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
  if (isNew || util.has(p, 'period_start')) rec.set('period_start', util.day(p, 'period_start', isNew ? d.period_start : rec.getString('period_start')));
  if (isNew || util.has(p, 'period_end')) rec.set('period_end', util.day(p, 'period_end', isNew ? d.period_end : rec.getString('period_end')));
  if (rec.getString('period_end') < rec.getString('period_start')) throw util.fail(400, 'The period ends before it starts.', 'invalid_param', { param: 'period_end' });
  if (isNew || util.has(p, 'template')) {
    const tr = util.str(p, 'template', '');
    let t = tr !== '' ? templateRef(app, tr) : util.findOne(app, 'review_templates', 'name = {:n} && archived = false', { n: d.template_name });
    if (t === null) t = util.findOne(app, 'review_templates', 'archived = false', {});
    if (t === null) throw util.fail(400, 'Add a review template first (templates.create).', 'missing_param', { param: 'template' });
    rec.set('template', t.id);
  }
  const rule = readRule(ctx, p);
  if (rule !== undefined) rec.set('participants', rule);
  else if (isNew) rec.set('participants', { entities: [], departments: [], employees: [], exclude: [], started_before: '', probation_ending: kind === 'probation' });
  const phases = readPhases(p, kind, today);
  if (phases !== undefined) rec.set('phases', phases);
  else if (isNew) rec.set('phases', d.phases);
  if (util.has(p, 'note')) rec.set('note', util.text(p, 'note', 2000, ''));
  if (isNew) {
    rec.set('status', 'draft');
    rec.set('created_by', ctx.memberId || '');
  }
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'review_cycles', record: rec.id, summary: (isNew ? 'Drafted' : 'Changed') + ' the review cycle ' + rec.getString('name'), before: before, after: cycleView(ctx, rec) });
  return { cycle: cycleView(ctx, rec) };
}

function cyclesCreate(ctx, p) {
  return cycleSave(ctx, p, u().newRecord(ctx.app, 'review_cycles'));
}

function cyclesUpdate(ctx, p) {
  return cycleSave(ctx, p, cycleRef(ctx, u().req(p, 'cycle')));
}

function cyclesPreview(ctx, p) {
  const util = u();
  const r = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, r);
  const day = util.today(ctx.app, r.getString('entity') || undefined);
  const list0 = resolveParticipants(ctx, r, day);
  const noManager = list0.filter((x) => L('lib_people').managerOf(ctx.app, x.employment, day) === null).length;
  return { total: list0.length, without_manager: noManager, people: list0.slice(0, 500).map((x) => ({ employee: x.employee, employment: x.employment, name: x.name, number: x.number, start_day: x.start_day })) };
}

/** Create a participant and its reviews (inside the caller's transaction). Returns the reviewer employee ids. */
function addParticipant(ctx, cycle, e, day) {
  const util = u();
  const app = ctx.app;
  const people = L('lib_people');
  const job = people.rowOn(app, 'job_records', e.employment, day);
  const mgr = people.managerOf(app, e.employment, day);
  const pr = util.newRecord(app, 'review_participants');
  pr.set('cycle', cycle.id);
  pr.set('employee', e.employee);
  pr.set('employment', e.employment);
  pr.set('entity', e.entity);
  pr.set('department', job !== null ? job.getString('department') : '');
  pr.set('manager', mgr !== null ? mgr.id : '');
  pr.set('title', job !== null ? job.getString('title') : '');
  pr.set('stage', 'open');
  pr.set('calibration', []);
  app.save(pr);
  const keys = (util.jsonOf(cycle, 'phases', []) || []).map((x) => x.key);
  const reviewers = [];
  const make = (kind, reviewer) => {
    const r = util.newRecord(app, 'reviews');
    r.set('cycle', cycle.id);
    r.set('participant', pr.id);
    r.set('employee', e.employee);
    r.set('reviewer', reviewer);
    r.set('kind', kind);
    r.set('status', 'draft');
    r.set('answers', {});
    r.set('ratings', {});
    r.set('added_by', ctx.memberId || '');
    app.save(r);
    if (reviewer !== '') reviewers.push(reviewer);
  };
  if (keys.indexOf('self') >= 0) make('self', e.employee);
  if (keys.indexOf('manager') >= 0) make('manager', mgr !== null ? mgr.id : '');
  if (keys.indexOf('upward') >= 0) for (const rep of people.reportsOf(app, e.employee, day, false)) make('upward', rep.employee);
  return { participant: pr, reviewers: reviewers };
}

function notifyReviewers(app, cycle, reviewerIds) {
  const counts = {};
  for (const id of reviewerIds) counts[id] = (counts[id] || 0) + 1;
  for (const id of Object.keys(counts)) core().notifyEmployee(app, id, { kind: 'performance', title: cycle.getString('name') + ': ' + counts[id] + ' review' + (counts[id] === 1 ? '' : 's') + ' to write', link: '#/performance', facts: [{ type: 'number', key: 'reviews', label: 'To write', value: counts[id], unit: counts[id] === 1 ? 'review' : 'reviews' }, { type: 'text', key: 'cycle', label: 'Cycle', value: cycle.getString('name') }] });
}

function cyclesLaunch(ctx, p) {
  const util = u();
  const r0 = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, r0);
  if (r0.getString('status') !== 'draft') throw util.fail(409, 'This cycle is already ' + r0.getString('status') + '.', 'conflict');
  const day = util.today(ctx.app, r0.getString('entity') || undefined);
  const list0 = resolveParticipants(ctx, r0, day);
  if (list0.length === 0) throw util.fail(400, 'No one matches the participants of this cycle on ' + day + '. Change who takes part (cycles.update --participants).', 'no_participants');
  const snap = snapshotOf(ctx.app, r0);
  if ((snap.sections || []).length === 0) throw util.fail(400, 'The template has no sections.', 'invalid_template');
  let reviewers = [];
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const c = tx.findRecordById('review_cycles', r0.id);
    c.set('template_snapshot', snap);
    c.set('status', 'active');
    c.set('launched_at', util.nowIso());
    c.set('launched_by', ctx.memberId || '');
    tx.save(c);
    for (const e of list0) {
      const out = addParticipant(t, c, e, day);
      reviewers = reviewers.concat(out.reviewers);
      n++;
    }
    notifyReviewers(tx, c, reviewers);
  });
  L('lib_audit').note(ctx, { collection: 'review_cycles', record: r0.id, summary: 'Launched the review cycle ' + r0.getString('name') + ' for ' + n + ' people (' + reviewers.length + ' reviews)' });
  L('lib_events').emit(ctx, 'review_cycle.launched', { cycle: r0.id, participants: n });
  return { cycle: cycleView(ctx, cycleRef(ctx, r0.id)), participants: n, reviews: reviewers.length };
}

function cyclesPhase(ctx, p) {
  const util = u();
  const r = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, r);
  if (r.getString('status') === 'closed') throw util.fail(409, 'This cycle is closed.', 'conflict');
  const key = util.oneOf(p, 'phase', PHASES, '');
  if (key === '') throw util.fail(400, 'phase is required', 'missing_param', { param: 'phase' });
  const action = util.oneOf(p, 'action', ['start_now', 'end_now', 'set', 'remove'], 'set');
  const today = util.today(ctx.app, r.getString('entity') || undefined);
  const before = util.jsonOf(r, 'phases', []) || [];
  const phases = before.map((x) => Object.assign({}, x));
  let ph = phases.filter((x) => x.key === key)[0];
  if (action === 'remove') {
    if (r.getString('status') !== 'draft') throw util.fail(409, 'Phases are removed only while the cycle is a draft; end it now instead.', 'conflict');
    const left = phases.filter((x) => x.key !== key);
    if (!left.some((x) => x.key === 'self' || x.key === 'manager')) throw util.fail(400, 'A cycle needs a self review or a manager review phase.', 'invalid_param');
    r.set('phases', left);
  } else {
    if (ph === undefined) {
      if (r.getString('status') !== 'draft' && ['self', 'manager', 'upward'].indexOf(key) >= 0) throw util.fail(409, 'The ' + key + ' phase cannot be added after launch (its reviews are made at launch).', 'conflict');
      ph = { key: key, start: today, end: util.dayAdd(today, 13) };
      phases.push(ph);
    }
    if (action === 'start_now') {
      ph.start = today;
      if (ph.end < today) ph.end = util.dayAdd(today, 6);
    } else if (action === 'end_now') {
      ph.end = today < ph.start ? ph.start : util.dayAdd(today, -1) < ph.start ? ph.start : util.dayAdd(today, -1);
    } else {
      const s = util.day(p, 'start', ph.start);
      const e = util.day(p, 'end', ph.end);
      if (e < s) throw util.fail(400, 'The phase ends before it starts.', 'invalid_param', { param: 'end' });
      ph.start = s;
      ph.end = e;
    }
    r.set('phases', phases);
  }
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'review_cycles', record: r.id, summary: (PHASE_LABEL[key] || key) + ': ' + action.replace('_', ' ') + ' in ' + r.getString('name'), before: { phases: before }, after: { phases: util.jsonOf(r, 'phases', []) } });
  return { cycle: cycleView(ctx, r) };
}

function cyclesClose(ctx, p) {
  const util = u();
  const r = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, r);
  if (r.getString('status') !== 'active') throw util.fail(409, 'Only an active cycle closes (this one is ' + r.getString('status') + ').', 'conflict');
  r.set('status', 'closed');
  r.set('closed_at', util.nowIso());
  r.set('closed_by', ctx.memberId || '');
  ctx.app.save(r);
  const c = cycleCounts(ctx.app, r.id);
  L('lib_audit').note(ctx, { collection: 'review_cycles', record: r.id, summary: 'Closed the review cycle ' + r.getString('name') + ' (' + c.reviews.manager.submitted + ' of ' + c.reviews.manager.total + ' manager reviews in)' });
  return { cycle: cycleView(ctx, r) };
}

function cyclesDelete(ctx, p) {
  const util = u();
  const r = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, r);
  if (r.getString('status') !== 'draft') throw util.fail(409, 'Only a draft cycle can be deleted; close an active one instead.', 'conflict');
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'review_cycles', record: r.id, summary: 'Deleted the draft cycle ' + r.getString('name') });
  return { deleted: true };
}

function cyclesRemind(ctx, p) {
  const util = u();
  const r = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, r);
  if (r.getString('status') !== 'active') throw util.fail(409, 'Reminders go out for active cycles only.', 'conflict');
  const n = remindCycle(ctx, r, true);
  L('lib_audit').note(ctx, { collection: 'review_cycles', record: r.id, summary: 'Reminded ' + n + ' reviewers in ' + r.getString('name') });
  return { reminded: n };
}

/* --------------------------------------------------------- participants */

function participantRef(ctx, id) {
  const r = u().byId(ctx.app, 'review_participants', String(id || ''));
  if (r === null) throw u().fail(404, 'No review participant ' + id + '.', 'not_found');
  return r;
}

function ratingLabel(snap, n) {
  if (!n || !snap || !snap.scale || !Array.isArray(snap.scale.labels)) return '';
  return snap.scale.labels[n - 1] || String(n);
}

/** May the caller see the ratings of this participant? */
function seesRating(ctx, pr) {
  const rel = core().relation(ctx, pr.getString('employee'));
  if (ctx.isAgent) return true;
  if (core().atLeast(rel.hr, 'view') || rel.team) return true;
  if (rel.self) return AFTER_SHARE.indexOf(pr.getString('stage')) >= 0;
  return false;
}

function reviewStatusOf(app, participantId) {
  const util = u();
  const out = { self: null, manager: null, peer: { total: 0, submitted: 0 }, upward: { total: 0, submitted: 0 } };
  for (const r of util.rows(app, 'SELECT id, kind, status, reviewer FROM reviews WHERE participant = {:p}', { id: '', kind: '', status: '', reviewer: '' }, { p: participantId })) {
    if (r.kind === 'self' || r.kind === 'manager') out[r.kind] = { id: r.id, status: r.status, reviewer: r.reviewer };
    else {
      if (r.status !== 'declined') out[r.kind].total++;
      if (r.status === 'submitted') out[r.kind].submitted++;
    }
  }
  return out;
}

function participantView(ctx, pr, snap) {
  const util = u();
  const app = ctx.app;
  const see = seesRating(ctx, pr);
  const rating = pr.getInt('final') || pr.getInt('overall');
  const st = reviewStatusOf(app, pr.id);
  const dep = pr.getString('department') !== '' ? util.byId(app, 'departments', pr.getString('department')) : null;
  return {
    id: pr.id,
    cycle: pr.getString('cycle'),
    employee: core().chip(ctx, pr.getString('employee')),
    employment: pr.getString('employment'),
    department: pr.getString('department'),
    department_name: dep !== null ? dep.getString('name') : '',
    manager: pr.getString('manager') !== '' ? core().chip(ctx, pr.getString('manager')) : null,
    title: pr.getString('title'),
    stage: pr.getString('stage'),
    reviews: st,
    score: see ? pr.getFloat('score') : null,
    overall: see ? pr.getInt('overall') : null,
    final: see ? pr.getInt('final') : null,
    rating: see ? rating : null,
    rating_label: see ? ratingLabel(snap, rating) : '',
    calibrated: see ? pr.getInt('final') > 0 : false,
    final_reason: see ? pr.getString('final_reason') : '',
    shared_at: pr.getString('shared_at'),
    acknowledged_at: pr.getString('acknowledged_at'),
    ack_comment: pr.getString('ack_comment'),
    signoff: pr.getString('signoff'),
    signed_at: pr.getString('signed_at'),
    returned_note: pr.getString('returned_note'),
    note: pr.getString('note'),
  };
}

function participantsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = cycleRef(ctx, util.req(p, 'cycle'));
  if (!cycleIdsFor(ctx)[c.id]) throw util.fail(403, 'You cannot see this cycle.', 'not_permitted');
  const snap = snapshotOf(app, c);
  const bind = { c: c.id };
  const where = ['p.cycle = {:c}'];
  const rel = L('lib_auth').can(ctx, 'performance', 'view') || ctx.isAgent;
  if (!rel) where.push(core().inList('p.employee', Object.keys(core().teamOf(ctx)), bind, 't'));
  else {
    const ids = core().visibleIds(ctx);
    where.push(core().inList('p.employee', ids, bind, 'v'));
  }
  const stage = util.str(p, 'stage', '');
  if (stage !== '') {
    where.push('p.stage = {:st}');
    bind.st = stage;
  } else where.push("p.stage != 'removed'");
  const dep = util.str(p, 'department', '');
  if (dep !== '') {
    where.push('p.department = {:d}');
    bind.d = L('lib_org').kindRef(app, 'department', dep).id;
  }
  const missing = util.oneOf(p, 'missing', ['self', 'manager', 'peer', 'upward', 'any', ''], '');
  if (missing !== '') {
    where.push("EXISTS (SELECT 1 FROM reviews r WHERE r.participant = p.id AND r.status = 'draft'" + (missing !== 'any' ? ' AND r.kind = {:mk}' : '') + ')');
    bind.mk = missing;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("EXISTS (SELECT 1 FROM employees e WHERE e.id = p.employee AND (e.legal_name LIKE {:q} ESCAPE '\\' OR e.preferred_name LIKE {:q} ESCAPE '\\' OR e.number LIKE {:q} ESCAPE '\\'))");
    bind.q = util.like(q);
  }
  const pg = util.page(p, 100, 500);
  const from = ' FROM review_participants p LEFT JOIN employees e2 ON e2.id = p.employee WHERE ' + where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n' + from, bind);
  const rows = util.rows(app, "SELECT p.id AS id" + from + " ORDER BY COALESCE(NULLIF(e2.preferred_name, ''), e2.legal_name) COLLATE NOCASE LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  return { participants: rows.map((r) => participantView(ctx, app.findRecordById('review_participants', r.id), snap)), total: total, limit: pg.limit, offset: pg.offset, scale: snap.scale };
}

function participantsGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = participantRef(ctx, util.req(p, 'participant'));
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  const rel = core().relation(ctx, pr.getString('employee'));
  const reviewer = ctx.employeeId && util.count(app, 'SELECT COUNT(*) AS n FROM reviews WHERE participant = {:p} AND reviewer = {:e}', { p: pr.id, e: ctx.employeeId }) > 0;
  if (!rel.any && !reviewer && !ctx.isAgent) throw util.fail(403, 'You cannot see this review.', 'not_permitted');
  const snap = snapshotOf(app, c);
  const v = participantView(ctx, pr, snap);
  v.cycle = cycleView(ctx, c);
  v.reviews_list = util
    .findMany(app, 'reviews', 'participant = {:p}', 'kind,created', 100, { p: pr.id })
    .filter((r) => canSeeReview(ctx, r, pr))
    .map((r) => reviewBrief(ctx, r, pr, snap));
  v.calibration = seesRating(ctx, pr) && !rel.self ? util.jsonOf(pr, 'calibration', []) || [] : [];
  v.can = participantCan(ctx, pr, c);
  return { participant: v };
}

function participantCan(ctx, pr, c) {
  const rel = core().relation(ctx, pr.getString('employee'));
  const st = reviewStatusOf(ctx.app, pr.id);
  const stage = pr.getString('stage');
  const active = c.getString('status') === 'active';
  const mgrWriter = st.manager && st.manager.reviewer !== '' && st.manager.reviewer === ctx.employeeId;
  const sharing = phaseOf(c, 'sharing');
  const today = u().today(ctx.app, c.getString('entity') || undefined);
  const shareOpen = sharing === null || today >= sharing.start;
  return {
    share: !ctx.isAgent && active && stage === 'submitted' && ((mgrWriter && shareOpen) || canRun(ctx, c)),
    acknowledge: !ctx.isAgent && rel.self && stage === 'shared',
    add_peer: !ctx.isAgent && active && phaseOf(c, 'peer') !== null && AFTER_SHARE.indexOf(stage) < 0 && (rel.self || rel.team || core().atLeast(rel.hr, 'edit')),
    calibrate: !ctx.isAgent && active && stage === 'submitted' && !rel.self && (core().atLeast(rel.hr, 'edit') || rel.team),
    remove: !ctx.isAgent && active && canRun(ctx, c) && stage !== 'removed',
    reassign: !ctx.isAgent && active && canRun(ctx, c),
  };
}

function participantsAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, c);
  if (c.getString('status') !== 'active') throw util.fail(409, 'People are added to an active cycle (a draft takes them from its participants rule).', 'conflict');
  const emp = L('lib_people').employeeRef(app, util.req(p, 'employee'));
  const day = util.today(app, c.getString('entity') || undefined);
  const id = L('lib_people').primaryEmployment(app, emp.id, day);
  const e = id !== '' ? L('lib_people').activeEmployments(app, { ids: [id], from: day, to: day })[0] : undefined;
  if (e === undefined) throw util.fail(400, L('lib_people').displayName(emp) + ' has no employment on ' + day + '.', 'not_employed');
  const old = util.findOne(app, 'review_participants', 'cycle = {:c} && employment = {:m}', { c: c.id, m: e.id });
  if (old !== null) {
    if (old.getString('stage') !== 'removed') throw util.fail(409, L('lib_people').displayName(emp) + ' is already in this cycle.', 'conflict');
    old.set('stage', 'open');
    app.save(old);
    L('lib_audit').note(ctx, { collection: 'review_participants', record: old.id, summary: 'Put ' + L('lib_people').displayName(emp) + ' back into ' + c.getString('name') });
    return { participant: participantView(ctx, old, snapshotOf(app, c)) };
  }
  let out = null;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const cc = tx.findRecordById('review_cycles', c.id);
    const res = addParticipant(t, cc, { employment: e.id, employee: emp.id, entity: e.entity }, day);
    notifyReviewers(tx, cc, res.reviewers);
    out = res.participant.id;
  });
  L('lib_audit').note(ctx, { collection: 'review_participants', record: out, summary: 'Added ' + L('lib_people').displayName(emp) + ' to ' + c.getString('name') });
  return { participant: participantView(ctx, app.findRecordById('review_participants', out), snapshotOf(app, c)) };
}

function participantsRemove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = participantRef(ctx, util.req(p, 'participant'));
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  needRun(ctx, c);
  if (AFTER_SHARE.indexOf(pr.getString('stage')) >= 0) throw util.fail(409, 'This review was already shared with the person; it stays in the cycle.', 'conflict');
  pr.set('stage', 'removed');
  pr.set('note', util.text(p, 'note', 1000, '') || pr.getString('note'));
  app.save(pr);
  L('lib_audit').note(ctx, { collection: 'review_participants', record: pr.id, summary: 'Took ' + (core().chip(ctx, pr.getString('employee')) || { name: '' }).name + ' out of ' + c.getString('name') });
  return { participant: participantView(ctx, pr, snapshotOf(app, c)) };
}

/* -------------------------------------------------------------- reviews */

function reviewRef(ctx, id) {
  const r = u().byId(ctx.app, 'reviews', String(id || ''));
  if (r === null) throw u().fail(404, 'No review ' + id + '.', 'not_found');
  return r;
}

/** May the caller see this review's content? */
function canSeeReview(ctx, rv, pr) {
  if (ctx.isAgent || ctx.actor === 'system') return true;
  if (ctx.employeeId && rv.getString('reviewer') === ctx.employeeId) return true;
  const rel = core().relation(ctx, rv.getString('employee'));
  const submitted = rv.getString('status') === 'submitted';
  const kind = rv.getString('kind');
  if (rel.self) {
    if (kind === 'self') return true;
    if (kind === 'manager') return submitted && AFTER_SHARE.indexOf(pr.getString('stage')) >= 0;
    return false;
  }
  if (core().atLeast(rel.hr, 'full')) return true;
  if (core().atLeast(rel.hr, 'view')) return submitted;
  if (rel.team) return submitted;
  return false;
}

function dueOf(cycle, kind) {
  const ph = phaseOf(cycle, kind);
  return ph !== null ? ph.end : cycle.getString('period_end');
}

/** The sections a review kind answers, with the goals section filled with the person's goals. */
function sectionsFor(ctx, snap, kind, rv, cycle) {
  const out = [];
  for (const s of snap.sections || []) {
    if ((s.kinds || KINDS).indexOf(kind) < 0) continue;
    const sec = Object.assign({}, s);
    if (s.kind === 'goals') {
      sec.goals = L('lib_performance_goals')
        .forReview(ctx, rv.getString('employee'), cycle)
        .map((g) => ({ id: g.id, title: g.title, kind: g.kind, weight: g.weight, progress: g.progress, status: g.status, due: g.due, key_results: g.key_results }));
    }
    out.push(sec);
  }
  return out;
}

function reviewBrief(ctx, rv, pr, snap) {
  const see = canSeeReview(ctx, rv, pr);
  const anon = rv.getString('kind') === 'upward' && !(ctx.employeeId && rv.getString('reviewer') === ctx.employeeId) && !core().atLeast(core().relation(ctx, rv.getString('employee')).hr, 'view') && !ctx.isAgent;
  return {
    id: rv.id,
    kind: rv.getString('kind'),
    status: rv.getString('status'),
    reviewer: rv.getString('reviewer') !== '' && !anon ? core().chip(ctx, rv.getString('reviewer')) : null,
    anonymous: anon,
    submitted_at: rv.getString('submitted_at'),
    answers: see ? u().jsonOf(rv, 'answers', {}) || {} : {},
    ratings: see ? u().jsonOf(rv, 'ratings', {}) || {} : {},
    overall: see ? rv.getInt('overall') : 0,
    overall_label: see ? ratingLabel(snap, rv.getInt('overall')) : '',
    score: see ? rv.getFloat('score') : null,
    hidden: !see,
    declined_reason: rv.getString('declined_reason'),
  };
}

function reviewView(ctx, rv, opts) {
  const util = u();
  const app = ctx.app;
  const pr = app.findRecordById('review_participants', rv.getString('participant'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  const snap = snapshotOf(app, c);
  const kind = rv.getString('kind');
  const see = canSeeReview(ctx, rv, pr);
  const mine = !ctx.isAgent && ctx.employeeId !== '' && rv.getString('reviewer') === ctx.employeeId;
  const open = c.getString('status') === 'active' && pr.getString('stage') !== 'removed' && rv.getString('status') === 'draft' && !(kind === 'manager' && AFTER_SHARE.indexOf(pr.getString('stage')) >= 0);
  const out = reviewBrief(ctx, rv, pr, snap);
  out.cycle = { id: c.id, name: c.getString('name'), kind: c.getString('kind'), status: c.getString('status'), period_start: c.getString('period_start'), period_end: c.getString('period_end') };
  out.employee = core().chip(ctx, rv.getString('employee'));
  out.participant = participantView(ctx, pr, snap);
  out.scale = snap.scale;
  out.overall_enabled = (snap.overall_kinds || []).indexOf(kind) >= 0;
  out.sections = see ? sectionsFor(ctx, snap, kind, rv, c) : [];
  out.due = dueOf(c, kind);
  out.started_at = rv.getString('started_at');
  out.saved_at = rv.getString('saved_at');
  out.mine = mine;
  out.can = {
    write: mine && open,
    submit: mine && open,
    decline: mine && open && (kind === 'peer' || kind === 'upward'),
    reopen: !ctx.isAgent && rv.getString('status') === 'submitted' && c.getString('status') === 'active' && AFTER_SHARE.indexOf(pr.getString('stage')) < 0 && canRun(ctx, c),
    request_summary: mine && open && (kind === 'manager' || kind === 'self'),
  };
  if (opts && opts.related) {
    out.related = util
      .findMany(app, 'reviews', 'participant = {:p} && id != {:id}', 'kind,created', 100, { p: pr.id, id: rv.id })
      .filter((r) => canSeeReview(ctx, r, pr) && r.getString('status') === 'submitted')
      .map((r) => reviewBrief(ctx, r, pr, snap));
    out.summaries = mine || ctx.isAgent ? util.findMany(app, 'review_summaries', 'review = {:r}', '-created', 10, { r: rv.id }).map((s) => summaryView(ctx, s)) : [];
  }
  return out;
}

function reviewsGet(ctx, p) {
  const util = u();
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const pr = ctx.app.findRecordById('review_participants', rv.getString('participant'));
  const rel = core().relation(ctx, rv.getString('employee'));
  const mine = ctx.employeeId && rv.getString('reviewer') === ctx.employeeId;
  if (!mine && !rel.any && !ctx.isAgent) throw util.fail(403, 'You cannot see this review.', 'not_permitted');
  if (!canSeeReview(ctx, rv, pr) && rel.self) throw util.fail(403, 'This review is not shared with you yet.', 'not_shared');
  return { review: reviewView(ctx, rv, { related: true }) };
}

/** Reviews of the caller: to write (default), about them, or of their team. */
function reviewsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const which = util.oneOf(p, 'view', ['to_write', 'written', 'about_me', 'team'], 'to_write');
  if (ctx.isAgent) return { reviews: [], total: 0 };
  const me = core().selfOrFail(ctx);
  const bind = { me: me };
  let where;
  if (which === 'to_write') where = "r.reviewer = {:me} AND r.status = 'draft' AND c.status = 'active' AND p.stage != 'removed'";
  else if (which === 'written') where = "r.reviewer = {:me} AND r.status != 'draft'";
  else if (which === 'about_me') where = "r.employee = {:me} AND (r.kind = 'self' OR (r.kind = 'manager' AND r.status = 'submitted' AND p.stage IN ('shared', 'acknowledged', 'signoff', 'signed')))";
  else where = core().inList('r.employee', Object.keys(core().teamOf(ctx)), bind, 't') + " AND p.stage != 'removed' AND c.status != 'draft'";
  const rows = util.rows(app, 'SELECT r.id AS id FROM reviews r JOIN review_participants p ON p.id = r.participant JOIN review_cycles c ON c.id = r.cycle WHERE ' + where + ' ORDER BY c.period_end DESC, r.kind LIMIT 500', { id: '' }, bind);
  return {
    reviews: rows.map((x) => {
      const rv = app.findRecordById('reviews', x.id);
      const pr = app.findRecordById('review_participants', rv.getString('participant'));
      const c = app.findRecordById('review_cycles', rv.getString('cycle'));
      const b = reviewBrief(ctx, rv, pr, snapshotOf(app, c));
      b.answers = {};
      b.ratings = {};
      b.employee = core().chip(ctx, rv.getString('employee'));
      b.cycle = { id: c.id, name: c.getString('name'), status: c.getString('status') };
      b.participant = pr.id;
      b.stage = pr.getString('stage');
      b.due = dueOf(c, rv.getString('kind'));
      b.started = rv.getString('started_at') !== '';
      return b;
    }),
    total: rows.length,
  };
}

/** Keys a review kind may answer and rate: { answers: {key: true}, ratings: {key: true} }. */
function keysFor(ctx, snap, kind, rv, cycle) {
  const answers = { overall: true };
  const ratings = {};
  for (const s of sectionsFor(ctx, snap, kind, rv, cycle)) {
    if (s.kind === 'goals') {
      for (const g of s.goals || []) {
        answers[s.key + '.' + g.id] = true;
        if (s.rate !== false) ratings[s.key + '.' + g.id] = true;
      }
    } else if (s.kind === 'competencies') {
      for (const it of s.items || []) {
        answers[s.key + '.' + it.key] = true;
        ratings[s.key + '.' + it.key] = true;
      }
    } else for (const it of s.items || []) answers[s.key + '.' + it.key] = true;
  }
  return { answers: answers, ratings: ratings };
}

/** Weighted score of a review's ratings (null when nothing is rated). */
function scoreOf(snap, sections, ratings) {
  let total = 0;
  let weights = 0;
  for (const s of sections) {
    if (s.kind === 'questions' || !(s.weight > 0)) continue;
    let sum = 0;
    let w = 0;
    if (s.kind === 'goals') {
      if (s.rate === false) continue;
      const goals = s.goals || [];
      const allZero = goals.every((g) => !(g.weight > 0));
      for (const g of goals) {
        const v = ratings[s.key + '.' + g.id];
        if (!(v > 0)) continue;
        const gw = allZero ? 1 : g.weight || 0;
        sum += v * gw;
        w += gw;
      }
    } else {
      for (const it of s.items || []) {
        const v = ratings[s.key + '.' + it.key];
        if (!(v > 0)) continue;
        sum += v;
        w += 1;
      }
    }
    if (w === 0) continue;
    total += (sum / w) * s.weight;
    weights += s.weight;
  }
  if (weights === 0) return null;
  return Math.round((total / weights) * 100) / 100;
}

function needWriter(ctx, rv, pr, c) {
  const util = u();
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent never writes or rates reviews; it can draft a neutral summary for the manager.', 'agent_not_permitted');
  if (!ctx.employeeId || rv.getString('reviewer') !== ctx.employeeId) throw util.fail(403, 'Only the reviewer writes this review.', 'not_permitted');
  if (c.getString('status') !== 'active') throw util.fail(409, 'The cycle is ' + c.getString('status') + '.', 'conflict');
  if (pr.getString('stage') === 'removed') throw util.fail(409, 'This person was taken out of the cycle.', 'conflict');
  if (rv.getString('status') !== 'draft') throw util.fail(409, 'This review is already ' + rv.getString('status') + '.', 'conflict');
  if (rv.getString('kind') === 'manager' && AFTER_SHARE.indexOf(pr.getString('stage')) >= 0) throw util.fail(409, 'This review was shared; it no longer changes.', 'conflict');
}

function mapParam(p, name) {
  const util = u();
  if (!util.has(p, name)) return null;
  const o = util.obj(p, name);
  return o === undefined ? null : o;
}

/** Autosave a draft (answers and ratings merge; an empty answer or rating 0 removes it). */
function reviewsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const pr = app.findRecordById('review_participants', rv.getString('participant'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  needWriter(ctx, rv, pr, c);
  const snap = snapshotOf(app, c);
  const keys = keysFor(ctx, snap, rv.getString('kind'), rv, c);
  const points = (snap.scale && snap.scale.points) || 5;
  const answers = util.jsonOf(rv, 'answers', {}) || {};
  const ratings = util.jsonOf(rv, 'ratings', {}) || {};
  const ain = mapParam(p, 'answers');
  if (ain !== null) {
    for (const k of Object.keys(ain)) {
      if (!keys.answers[k]) throw util.fail(400, 'This review has no question or item "' + k + '".', 'invalid_param', { param: 'answers', key: k });
      const v = ain[k] === null || ain[k] === undefined ? '' : String(ain[k]);
      if (v.length > 6000) throw util.fail(400, 'An answer is at most 6000 characters.', 'invalid_param', { param: 'answers', key: k });
      if (v.trim() === '') delete answers[k];
      else answers[k] = v;
    }
  }
  const rin = mapParam(p, 'ratings');
  if (rin !== null) {
    for (const k of Object.keys(rin)) {
      if (!keys.ratings[k]) throw util.fail(400, 'This review rates no item "' + k + '".', 'invalid_param', { param: 'ratings', key: k });
      const v = rin[k] === null || rin[k] === '' ? 0 : Number(rin[k]);
      if (!Number.isInteger(v) || v < 0 || v > points) throw util.fail(400, 'Ratings are whole numbers from 1 to ' + points + ' (0 clears).', 'invalid_param', { param: 'ratings', key: k });
      if (v === 0) delete ratings[k];
      else ratings[k] = v;
    }
  }
  if (util.has(p, 'overall')) {
    if ((snap.overall_kinds || []).indexOf(rv.getString('kind')) < 0) throw util.fail(400, 'This review has no overall rating.', 'invalid_param', { param: 'overall' });
    rv.set('overall', util.int(p, 'overall', 0, 0, points));
  }
  rv.set('answers', answers);
  rv.set('ratings', ratings);
  const s = scoreOf(snap, sectionsFor(ctx, snap, rv.getString('kind'), rv, c), ratings);
  rv.set('score', s === null ? 0 : s);
  if (rv.getString('started_at') === '') rv.set('started_at', util.nowIso());
  rv.set('saved_at', util.nowIso());
  app.save(rv);
  ctx.audited = true;
  return { saved_at: rv.getString('saved_at'), score: s, answered: Object.keys(answers).length, rated: Object.keys(ratings).length };
}

function missingFor(ctx, snap, rv, c) {
  const kind = rv.getString('kind');
  const answers = u().jsonOf(rv, 'answers', {}) || {};
  const ratings = u().jsonOf(rv, 'ratings', {}) || {};
  const out = [];
  for (const s of sectionsFor(ctx, snap, kind, rv, c)) {
    if (s.kind === 'questions') {
      for (const it of s.items || []) if (it.required && !(answers[s.key + '.' + it.key] || '').trim()) out.push({ key: s.key + '.' + it.key, label: it.text, what: 'answer' });
    } else if (kind === 'manager' && s.kind === 'competencies') {
      for (const it of s.items || []) if (!(ratings[s.key + '.' + it.key] > 0)) out.push({ key: s.key + '.' + it.key, label: it.name, what: 'rating' });
    } else if (kind === 'manager' && s.kind === 'goals' && s.rate !== false) {
      for (const g of s.goals || []) if (!(ratings[s.key + '.' + g.id] > 0)) out.push({ key: s.key + '.' + g.id, label: g.title, what: 'rating' });
    }
  }
  if ((snap.overall_kinds || []).indexOf(kind) >= 0 && !(rv.getInt('overall') > 0)) out.push({ key: 'overall', label: 'Overall rating', what: 'rating' });
  return out;
}

function reviewsSubmit(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (util.has(p, 'answers') || util.has(p, 'ratings') || util.has(p, 'overall')) reviewsSave(ctx, p);
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const pr = app.findRecordById('review_participants', rv.getString('participant'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  needWriter(ctx, rv, pr, c);
  const snap = snapshotOf(app, c);
  const missing = missingFor(ctx, snap, rv, c);
  if (missing.length > 0) throw util.fail(400, missing.length + ' item' + (missing.length === 1 ? '' : 's') + ' still to fill: ' + missing.slice(0, 5).map((m) => m.label).join('; ') + (missing.length > 5 ? '; ...' : ''), 'incomplete', { missing: missing });
  const kind = rv.getString('kind');
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('reviews', rv.id);
    r.set('status', 'submitted');
    r.set('submitted_at', util.nowIso());
    tx.save(r);
    if (kind === 'manager') {
      const pp = tx.findRecordById('review_participants', pr.id);
      pp.set('overall', r.getInt('overall'));
      pp.set('score', r.getFloat('score'));
      if (pp.getString('stage') === 'open') pp.set('stage', 'submitted');
      pp.set('returned_note', '');
      tx.save(pp);
    }
  });
  const who = core().chip(ctx, rv.getString('employee'));
  if (kind === 'self' && pr.getString('manager') !== '') core().notifyEmployee(app, pr.getString('manager'), { kind: 'performance', title: (who ? who.name : '') + ' submitted their self review (' + c.getString('name') + ')', link: '#/performance/reviews/' + rv.id });
  L('lib_audit').note(ctx, { collection: 'reviews', record: rv.id, summary: 'Submitted the ' + kind + ' review of ' + (who ? who.name : '') + ' in ' + c.getString('name') });
  L('lib_events').emit(ctx, 'review.submitted', { review: rv.id, cycle: c.id, kind: kind, employee: rv.getString('employee') });
  return { review: reviewView(ctx, reviewRef(ctx, rv.id), { related: false }) };
}

function reviewsReopen(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const pr = app.findRecordById('review_participants', rv.getString('participant'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  needRun(ctx, c);
  if (rv.getString('status') !== 'submitted') throw util.fail(409, 'Only a submitted review reopens.', 'conflict');
  if (AFTER_SHARE.indexOf(pr.getString('stage')) >= 0) throw util.fail(409, 'This review was shared with the person; it stays as it is.', 'conflict');
  rv.set('status', 'draft');
  rv.set('submitted_at', '');
  app.save(rv);
  if (rv.getString('kind') === 'manager') {
    pr.set('stage', 'open');
    app.save(pr);
  }
  const note = util.text(p, 'note', 1000, '');
  if (rv.getString('reviewer') !== '') core().notifyEmployee(app, rv.getString('reviewer'), { kind: 'performance', title: 'Reopened for changes: your ' + rv.getString('kind') + ' review in ' + c.getString('name'), body: note, link: '#/performance/reviews/' + rv.id, facts: [{ type: 'state', key: 'status', value: 'draft' }, { type: 'state', key: 'kind', label: 'Review', value: rv.getString('kind') }, { type: 'text', key: 'cycle', label: 'Cycle', value: c.getString('name') }].concat(note ? [{ type: 'text', key: 'note', label: 'Note', value: note }] : []) });
  L('lib_audit').note(ctx, { collection: 'reviews', record: rv.id, summary: 'Reopened the ' + rv.getString('kind') + ' review of ' + (core().chip(ctx, rv.getString('employee')) || { name: '' }).name + (note ? ' (' + note + ')' : '') });
  return { review: reviewView(ctx, rv, {}) };
}

function reviewsAddPeer(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = participantRef(ctx, util.req(p, 'participant'));
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  if (!participantCan(ctx, pr, c).add_peer) throw util.fail(403, 'Peers are added by the person, their managers or HR while the cycle has a peer phase and the review is not shared.', 'not_permitted');
  const peers = (util.list(p, 'reviewers') || []).concat(util.str(p, 'reviewer', '') !== '' ? [util.str(p, 'reviewer', '')] : []);
  if (peers.length === 0) throw util.fail(400, 'Give --reviewer (an employee) or --reviewers (a JSON list).', 'missing_param', { param: 'reviewer' });
  const have = util.count(app, "SELECT COUNT(*) AS n FROM reviews WHERE participant = {:p} AND kind = 'peer' AND status != 'declined'", { p: pr.id });
  if (have + peers.length > 10) throw util.fail(400, 'At most 10 peer reviewers for one person.', 'too_many');
  const added = [];
  for (const ref0 of peers) {
    const e = L('lib_people').employeeRef(app, String(ref0));
    if (e.id === pr.getString('employee')) throw util.fail(400, 'A person is not their own peer reviewer.', 'invalid_param');
    if (util.findOne(app, 'reviews', "participant = {:p} && reviewer = {:e} && kind = 'peer'", { p: pr.id, e: e.id }) !== null) continue;
    const r = util.newRecord(app, 'reviews');
    r.set('cycle', c.id);
    r.set('participant', pr.id);
    r.set('employee', pr.getString('employee'));
    r.set('reviewer', e.id);
    r.set('kind', 'peer');
    r.set('status', 'draft');
    r.set('answers', {});
    r.set('ratings', {});
    r.set('added_by', ctx.memberId || '');
    app.save(r);
    added.push(r.id);
    const who = core().chip(ctx, pr.getString('employee'));
    core().notifyEmployee(app, e.id, { kind: 'performance', title: 'Peer review requested: ' + (who ? who.name : '') + ' (' + c.getString('name') + ')', link: '#/performance/reviews/' + r.id });
  }
  L('lib_audit').note(ctx, { collection: 'reviews', summary: 'Asked ' + added.length + ' peer reviewer' + (added.length === 1 ? '' : 's') + ' for ' + (core().chip(ctx, pr.getString('employee')) || { name: '' }).name });
  return { added: added.length, reviews: added };
}

function reviewsDecline(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const pr = app.findRecordById('review_participants', rv.getString('participant'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  needWriter(ctx, rv, pr, c);
  if (rv.getString('kind') !== 'peer' && rv.getString('kind') !== 'upward') throw util.fail(400, 'Only peer and upward reviews can be declined.', 'invalid');
  rv.set('status', 'declined');
  rv.set('declined_reason', util.text(p, 'reason', 1000, ''));
  app.save(rv);
  L('lib_audit').note(ctx, { collection: 'reviews', record: rv.id, summary: 'Declined a ' + rv.getString('kind') + ' review' });
  return { review: reviewView(ctx, rv, {}) };
}

function reviewsReassign(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  needRun(ctx, c);
  if (rv.getString('status') !== 'draft') throw util.fail(409, 'Only a review still in draft changes reviewer.', 'conflict');
  const e = L('lib_people').employeeRef(app, util.req(p, 'reviewer'));
  if (rv.getString('kind') !== 'self' && e.id === rv.getString('employee')) throw util.fail(400, 'A person does not write this review about themself.', 'invalid_param');
  if (rv.getString('kind') === 'self') throw util.fail(400, 'A self review stays with the person.', 'invalid_param');
  const before = rv.getString('reviewer');
  rv.set('reviewer', e.id);
  rv.set('answers', {});
  rv.set('ratings', {});
  rv.set('overall', 0);
  rv.set('score', 0);
  rv.set('started_at', '');
  rv.set('saved_at', '');
  app.save(rv);
  if (rv.getString('kind') === 'manager') {
    const pr = app.findRecordById('review_participants', rv.getString('participant'));
    pr.set('manager', e.id);
    app.save(pr);
  }
  core().notifyEmployee(app, e.id, { kind: 'performance', title: 'Review to write: ' + (core().chip(ctx, rv.getString('employee')) || { name: '' }).name + ' (' + c.getString('name') + ')', link: '#/performance/reviews/' + rv.id });
  L('lib_audit').note(ctx, { collection: 'reviews', record: rv.id, summary: 'Gave the ' + rv.getString('kind') + ' review of ' + (core().chip(ctx, rv.getString('employee')) || { name: '' }).name + ' to ' + L('lib_people').displayName(e), before: { reviewer: before }, after: { reviewer: e.id } });
  return { review: reviewView(ctx, rv, {}) };
}

function reviewsRemove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  needRun(ctx, c);
  if (rv.getString('kind') !== 'peer' && rv.getString('kind') !== 'upward') throw util.fail(400, 'Only peer and upward reviews are removed; take the person out of the cycle instead.', 'invalid');
  if (rv.getString('status') === 'submitted') throw util.fail(409, 'A submitted review stays.', 'conflict');
  app.delete(rv);
  L('lib_audit').note(ctx, { collection: 'reviews', record: rv.id, summary: 'Removed a ' + rv.getString('kind') + ' review request' });
  return { deleted: true };
}

/* -------------------------------------------- sharing and sign-off */

function shareOne(ctx, pr, c) {
  const util = u();
  const app = ctx.app;
  pr.set('stage', 'shared');
  pr.set('shared_at', util.nowIso());
  pr.set('shared_by', ctx.memberId || '');
  app.save(pr);
  const mgr = util.findOne(app, 'reviews', "participant = {:p} && kind = 'manager'", { p: pr.id });
  core().notifyEmployee(app, pr.getString('employee'), { kind: 'performance', title: 'Your review is ready to read: ' + c.getString('name'), link: '#/performance/reviews/' + (mgr !== null ? mgr.id : '') });
  L('lib_events').emit(ctx, 'review.shared', { participant: pr.id, cycle: c.id, employee: pr.getString('employee') });
}

function reviewsShare(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = participantRef(ctx, util.req(p, 'participant'));
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  if (!participantCan(ctx, pr, c).share) {
    if (pr.getString('stage') !== 'submitted') throw util.fail(409, pr.getString('stage') === 'open' ? 'The manager review is not submitted yet.' : 'This review is already ' + pr.getString('stage') + '.', 'conflict');
    throw util.fail(403, 'The manager shares from the sharing phase on; HR can share at any time.', 'not_permitted');
  }
  shareOne(ctx, pr, c);
  L('lib_audit').note(ctx, { collection: 'review_participants', record: pr.id, summary: 'Shared the ' + c.getString('name') + ' review with ' + (core().chip(ctx, pr.getString('employee')) || { name: '' }).name });
  return { participant: participantView(ctx, pr, snapshotOf(app, c)) };
}

function reviewsShareAll(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = cycleRef(ctx, util.req(p, 'cycle'));
  needRun(ctx, c);
  if (c.getString('status') !== 'active') throw util.fail(409, 'The cycle is ' + c.getString('status') + '.', 'conflict');
  const bind = { c: c.id };
  const ids = core().visibleIds(ctx);
  const rows = util.rows(app, "SELECT id FROM review_participants WHERE cycle = {:c} AND stage = 'submitted' AND " + core().inList('employee', ids, bind, 'v'), { id: '' }, bind);
  for (const r of rows) shareOne(ctx, app.findRecordById('review_participants', r.id), c);
  L('lib_audit').note(ctx, { collection: 'review_cycles', record: c.id, summary: 'Shared ' + rows.length + ' reviews of ' + c.getString('name') + ' with the people they are about' });
  return { shared: rows.length };
}

function reviewsAcknowledge(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = participantRef(ctx, util.req(p, 'participant'));
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  if (ctx.isAgent || ctx.employeeId !== pr.getString('employee')) throw util.fail(403, 'Only the person the review is about acknowledges it.', 'not_permitted');
  if (pr.getString('stage') !== 'shared') throw util.fail(409, pr.getString('stage') === 'acknowledged' || pr.getString('stage') === 'signoff' || pr.getString('stage') === 'signed' ? 'You already acknowledged this review.' : 'This review is not shared with you yet.', 'conflict');
  const comment = util.text(p, 'comment', 2000, '');
  const needsSignoff = core().signoffFor(app, pr.getString('entity'));
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const pp = tx.findRecordById('review_participants', pr.id);
    pp.set('acknowledged_at', util.nowIso());
    pp.set('ack_comment', comment);
    pp.set('stage', needsSignoff ? 'signoff' : 'acknowledged');
    tx.save(pp);
    if (needsSignoff) {
      const snap = snapshotOf(tx, c);
      const rating = pp.getInt('final') || pp.getInt('overall');
      const ap = L('lib_approvals').open(t, {
        kind: 'review_signoff',
        ref_collection: 'review_participants',
        ref_id: pp.id,
        entity: pp.getString('entity'),
        employment: pp.getString('employment'),
        summary: 'Sign off the ' + c.getString('name') + ' review of ' + (core().chip(t, pp.getString('employee')) || { name: '' }).name,
        facts: [{ type: 'state', key: 'stage', label: 'Stage', value: 'signoff' }, { type: 'text', key: 'cycle', label: 'Cycle', value: c.getString('name') }].concat(rating > 0 && ratingLabel(snap, rating) ? [{ type: 'text', key: 'rating', label: 'Rating', value: ratingLabel(snap, rating) }] : []),
        payload: { cycle: c.id, cycle_name: c.getString('name'), participant: pp.id, rating: rating, rating_label: ratingLabel(snap, rating), comment: comment },
      });
      const again = tx.findRecordById('review_participants', pp.id);
      again.set('signoff', ap.id);
      tx.save(again);
    }
  });
  if (pr.getString('manager') !== '') core().notifyEmployee(app, pr.getString('manager'), { kind: 'performance', title: (core().chip(ctx, pr.getString('employee')) || { name: '' }).name + ' acknowledged their review (' + c.getString('name') + ')', body: comment, link: '#/performance/cycles/' + c.id + '?participant=' + pr.id });
  L('lib_audit').note(ctx, { collection: 'review_participants', record: pr.id, summary: 'Acknowledged the ' + c.getString('name') + ' review' + (needsSignoff ? '; HR sign-off requested' : '') });
  L('lib_events').emit(ctx, 'review.acknowledged', { participant: pr.id, cycle: c.id, employee: pr.getString('employee'), signoff: needsSignoff });
  return { participant: participantView(ctx, participantRef(ctx, pr.id), snapshotOf(app, c)) };
}

/** Approval subscriber for kind review_signoff. */
function onSignoff(ctx, approval, decision, note) {
  const util = u();
  const app = ctx.app;
  const pr = util.byId(app, 'review_participants', approval.ref_id);
  if (pr === null) return;
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  if (decision === 'approved') {
    pr.set('stage', 'signed');
    pr.set('signed_at', util.nowIso());
    app.save(pr);
    core().notifyEmployee(app, pr.getString('employee'), { kind: 'performance', title: 'Your ' + c.getString('name') + ' review is signed off', link: '#/performance', facts: [{ type: 'state', key: 'stage', label: 'Stage', value: 'signed' }, { type: 'text', key: 'cycle', label: 'Cycle', value: c.getString('name') }] });
    L('lib_events').emit(ctx, 'review.signed', { participant: pr.id, cycle: c.id, employee: pr.getString('employee') });
  } else if (decision === 'rejected') {
    pr.set('stage', 'open');
    pr.set('shared_at', '');
    pr.set('acknowledged_at', '');
    pr.set('signoff', '');
    pr.set('returned_note', util.clip(note || '', 2000));
    app.save(pr);
    const mgr = util.findOne(app, 'reviews', "participant = {:p} && kind = 'manager'", { p: pr.id });
    if (mgr !== null) {
      mgr.set('status', 'draft');
      mgr.set('submitted_at', '');
      app.save(mgr);
      if (mgr.getString('reviewer') !== '') core().notifyEmployee(app, mgr.getString('reviewer'), { kind: 'performance', title: 'HR asked for changes: the ' + c.getString('name') + ' review of ' + (core().chip(ctx, pr.getString('employee')) || { name: '' }).name, body: note || '', link: '#/performance/reviews/' + mgr.id, facts: [{ type: 'state', key: 'status', value: 'draft' }, { type: 'text', key: 'cycle', label: 'Cycle', value: c.getString('name') }].concat(note ? [{ type: 'text', key: 'note', label: 'Note', value: note }] : []) });
    }
  } else {
    pr.set('stage', 'acknowledged');
    pr.set('signoff', '');
    app.save(pr);
  }
}

/* ---------------------------------------------------------- calibration */

function calibrationView(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = cycleRef(ctx, util.req(p, 'cycle'));
  const auth = L('lib_auth');
  const hr = ctx.isAgent || auth.can(ctx, 'performance', 'view');
  const team = Object.keys(core().teamOf(ctx));
  if (!hr && team.length === 0) throw util.fail(403, 'Calibration is for HR and people leaders.', 'not_permitted');
  if (!cycleIdsFor(ctx)[c.id]) throw util.fail(403, 'You cannot see this cycle.', 'not_permitted');
  const snap = snapshotOf(app, c);
  const points = (snap.scale && snap.scale.points) || 5;
  const bind = { c: c.id };
  const where = ["cycle = {:c}", "stage != 'removed'", hr ? core().inList('employee', core().visibleIds(ctx), bind, 'v') : core().inList('employee', team, bind, 't')];
  const dep = util.str(p, 'department', '');
  if (dep !== '') {
    where.push('department = {:d}');
    bind.d = L('lib_org').kindRef(app, 'department', dep).id;
  }
  const recs = util.rows(app, 'SELECT id FROM review_participants WHERE ' + where.join(' AND '), { id: '' }, bind).map((r) => app.findRecordById('review_participants', r.id));
  const rows = [];
  let pending = 0;
  const byDept = {};
  const all = { department: '', name: 'Everyone', counts: [], total: 0 };
  for (let i = 0; i < points; i++) all.counts.push(0);
  for (const pr of recs) {
    if (pr.getString('stage') === 'open') {
      pending++;
      continue;
    }
    const v = participantView(ctx, pr, snap);
    v.history = util.jsonOf(pr, 'calibration', []) || [];
    v.can_adjust = !ctx.isAgent && pr.getString('stage') === 'submitted' && c.getString('status') === 'active' && participantCan(ctx, pr, c).calibrate;
    rows.push(v);
    const rating = v.rating || 0;
    const dk = v.department || '-';
    if (byDept[dk] === undefined) {
      byDept[dk] = { department: v.department, name: v.department_name || 'No department', counts: [], total: 0 };
      for (let i = 0; i < points; i++) byDept[dk].counts.push(0);
    }
    if (rating >= 1 && rating <= points) {
      byDept[dk].counts[rating - 1]++;
      byDept[dk].total++;
      all.counts[rating - 1]++;
      all.total++;
    }
  }
  rows.sort((a, b) => (a.department_name === b.department_name ? (a.employee && b.employee && a.employee.name < b.employee.name ? -1 : 1) : a.department_name < b.department_name ? -1 : 1));
  const depts = Object.keys(byDept)
    .map((k) => byDept[k])
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  return { cycle: cycleView(ctx, c), scale: snap.scale, distribution: [all].concat(depts), rows: rows, pending: pending, calibrated: rows.filter((r) => r.calibrated).length };
}

function calibrationAdjust(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = participantRef(ctx, util.req(p, 'participant'));
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent never changes ratings.', 'agent_not_permitted');
  if (!participantCan(ctx, pr, c).calibrate) {
    if (pr.getString('stage') !== 'submitted') throw util.fail(409, pr.getString('stage') === 'open' ? 'The manager review is not submitted yet.' : 'This review was already shared; its rating no longer changes.', 'conflict');
    throw util.fail(403, 'HR and the people leaders above this person calibrate; nobody calibrates their own rating.', 'not_permitted');
  }
  const snap = snapshotOf(app, c);
  const points = (snap.scale && snap.scale.points) || 5;
  const final = util.int(p, 'final', -1, 0, points);
  if (final < 0) throw util.fail(400, 'final is required: a rating from 1 to ' + points + ' (0 goes back to the manager\'s rating).', 'missing_param', { param: 'final' });
  const reason = util.text(p, 'reason', 2000, '');
  if (reason === '') throw util.fail(400, 'Write the reason for the change (it is kept with the rating).', 'missing_param', { param: 'reason' });
  const before = { final: pr.getInt('final'), overall: pr.getInt('overall'), reason: pr.getString('final_reason') };
  const from = pr.getInt('final') || pr.getInt('overall');
  const to = final || pr.getInt('overall');
  const hist = util.jsonOf(pr, 'calibration', []) || [];
  hist.push({ at: util.nowIso(), by: ctx.memberId, by_name: ctx.name, from: from, to: to, from_label: ratingLabel(snap, from), to_label: ratingLabel(snap, to), reason: reason });
  pr.set('calibration', hist);
  pr.set('final', final);
  pr.set('final_reason', final === 0 ? '' : reason);
  pr.set('calibrated_by', ctx.memberId || '');
  pr.set('calibrated_at', util.nowIso());
  app.save(pr);
  L('lib_audit').note(ctx, { collection: 'review_participants', record: pr.id, summary: 'Calibrated ' + (core().chip(ctx, pr.getString('employee')) || { name: '' }).name + ' in ' + c.getString('name') + ': ' + ratingLabel(snap, from) + ' to ' + ratingLabel(snap, to) + ' (' + util.clip(reason, 160) + ')', before: before, after: { final: final, overall: pr.getInt('overall'), reason: reason } });
  return { participant: participantView(ctx, pr, snap), history: hist };
}

/* ------------------------------------------------- summaries and context */

function summaryView(ctx, s) {
  const util = u();
  return { id: s.id, review: s.getString('review'), status: s.getString('status'), text: s.getString('text'), sources: util.jsonOf(s, 'sources', []) || [], error: s.getString('error'), requested_by: s.getString('requested_by'), agent: L('lib_agent').view(s, 'review_summary_draft'), created: s.getString('created'), updated: s.getString('updated') };
}

/** agent.retry on review_summary_draft: the reviewer who may write the review, while the summary is requested. */
function mayAskSummary(ctx, s) {
  const app = ctx.app;
  const rv = reviewRef(ctx, s.getString('review'));
  needWriter(ctx, rv, app.findRecordById('review_participants', rv.getString('participant')), app.findRecordById('review_cycles', rv.getString('cycle')));
  if (s.getString('status') !== 'requested') throw u().fail(409, 'This summary is already ' + s.getString('status') + '.', 'conflict');
}

function requestSummary(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const pr = app.findRecordById('review_participants', rv.getString('participant'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  needWriter(ctx, rv, pr, c);
  if (rv.getString('kind') !== 'manager' && rv.getString('kind') !== 'self') throw util.fail(400, 'Summaries are for manager and self reviews.', 'invalid');
  const open = util.findOne(app, 'review_summaries', "review = {:r} && status = 'requested'", { r: rv.id });
  if (open !== null && summaryView(ctx, open).status === 'requested') return { summary: summaryView(ctx, open), already: true };
  const who = core().chip(ctx, rv.getString('employee'));
  const s = util.newRecord(app, 'review_summaries');
  s.set('review', rv.id);
  s.set('participant', pr.id);
  s.set('employee', rv.getString('employee'));
  s.set('requested_by', ctx.memberId || '');
  s.set('status', 'requested');
  s.set('sources', []);
  s.set('agent_asks', {});
  app.save(s);
  const a = L('lib_agent').ask(ctx, s, 'review_summary_draft', { defer: true });
  L('lib_audit').note(ctx, { collection: 'review_summaries', record: s.id, summary: 'Asked your AI agent for a neutral summary for the ' + rv.getString('kind') + ' review of ' + (who ? who.name : ''), after: { trigger: 'review_summary_draft', request: a.request } });
  return { summary: summaryView(ctx, app.findRecordById('review_summaries', s.id)) };
}

const SOURCE_KINDS = ['goal', 'checkin', 'feedback', 'praise', 'training', 'review'];

function submitSummary(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) throw util.fail(403, 'review-summaries.submit is for your AI agent (it answers a summary request).', 'not_permitted');
  const s = util.byId(app, 'review_summaries', util.req(p, 'summary'));
  if (s === null) throw util.fail(404, 'No summary request ' + util.str(p, 'summary', '') + '.', 'not_found');
  if (s.getString('status') !== 'requested') throw util.fail(409, 'This summary is already ' + s.getString('status') + '.', 'conflict');
  const text0 = util.text(p, 'text', 8000, '');
  if (text0.trim() === '') throw util.fail(400, 'text is required: the neutral summary for the reviewer.', 'missing_param', { param: 'text' });
  const raw = util.list(p, 'sources') || [];
  if (raw.length > 100) throw util.fail(400, 'At most 100 sources.', 'invalid_param', { param: 'sources' });
  const sources = raw.map((x, i) => {
    util.keysOnly(x, ['kind', 'id', 'note'], 'source ' + (i + 1));
    if (SOURCE_KINDS.indexOf(x.kind) < 0) throw util.fail(400, 'source ' + (i + 1) + ': kind is one of ' + SOURCE_KINDS.join(', ') + '.', 'invalid_param', { param: 'sources' });
    return { kind: x.kind, id: util.clip(String(x.id || ''), 30), note: util.clip(util.squash(x.note || ''), 200) };
  });
  s.set('text', text0);
  s.set('sources', sources);
  s.set('status', 'ready');
  app.save(s);
  L('lib_agent').end(app, s, 'review_summary_draft', 'done');
  const who = core().chip(ctx, s.getString('employee'));
  if (s.getString('requested_by') !== '') L('lib_notify').notify(app, [s.getString('requested_by')], { kind: 'agent', title: 'Your AI agent drafted a summary for the review of ' + (who ? who.name : ''), link: '#/performance/reviews/' + s.getString('review') });
  L('lib_audit').note(ctx, { collection: 'review_summaries', record: s.id, summary: 'Your AI agent drafted a neutral summary for the review of ' + (who ? who.name : '') });
  return { summary: summaryView(ctx, app.findRecordById('review_summaries', s.id)) };
}

function markSummary(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = util.byId(app, 'review_summaries', util.req(p, 'summary'));
  if (s === null) throw util.fail(404, 'No such summary.', 'not_found');
  const rv = app.findRecordById('reviews', s.getString('review'));
  if (ctx.isAgent || rv.getString('reviewer') !== ctx.employeeId) throw util.fail(403, 'Only the reviewer decides what to do with the summary.', 'not_permitted');
  const st = util.oneOf(p, 'status', ['used', 'dismissed'], '');
  if (st === '') throw util.fail(400, 'status is used or dismissed', 'missing_param', { param: 'status' });
  s.set('status', st);
  app.save(s);
  L('lib_agent').end(app, s, 'review_summary_draft', 'closed', 'The reviewer marked it ' + st + '.');
  L('lib_audit').note(ctx, { collection: 'review_summaries', record: s.id, summary: (st === 'used' ? 'Used' : 'Dismissed') + " your AI agent's summary" });
  return { summary: summaryView(ctx, s) };
}

/** The caller as the review's reviewer would see things (your AI agent works for the person who asked). */
function asReviewer(ctx, rv, p) {
  const util = u();
  if (!ctx.isAgent) return ctx;
  const sid = util.str(p, 'summary', '');
  let member = null;
  if (sid !== '') {
    const s = util.byId(ctx.app, 'review_summaries', sid);
    if (s !== null && s.getString('requested_by') !== '') member = util.byId(ctx.app, 'members', s.getString('requested_by'));
  }
  if (member === null && rv.getString('reviewer') !== '') {
    const e = util.byId(ctx.app, 'employees', rv.getString('reviewer'));
    if (e !== null && e.getString('member') !== '') member = util.byId(ctx.app, 'members', e.getString('member'));
  }
  if (member === null) throw util.fail(409, 'The reviewer has no sign-in, so there is no view to work from. Ask HR to invite them.', 'no_member');
  return L('lib_auth').contextFor(ctx.app, member);
}

/** What a reviewer has at hand for one review: goals and check-ins, feedback and praise, trainings and earlier reviews in the period. */
function reviewsContext(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rv = reviewRef(ctx, util.req(p, 'review'));
  const pr = app.findRecordById('review_participants', rv.getString('participant'));
  const c = app.findRecordById('review_cycles', rv.getString('cycle'));
  const mine = ctx.employeeId && rv.getString('reviewer') === ctx.employeeId;
  if (!ctx.isAgent && !mine && !core().relation(ctx, rv.getString('employee')).any) throw util.fail(403, 'You cannot see this review.', 'not_permitted');
  const as = asReviewer(ctx, rv, p);
  const emp = rv.getString('employee');
  const from = c.getString('period_start');
  const to = c.getString('period_end');
  // Peers and upward reviewers see what everyone may see (praise, their own words); goals, check-ins and trainings are for the person, their managers and HR.
  const close = core().relation(as, emp).any || as.actor === 'system';
  return {
    employee: core().chip(as, emp),
    period: { start: from, end: to },
    as_reviewer: as !== ctx ? as.name : ctx.name,
    goals: close ? L('lib_performance_goals').forReview(as, emp, c) : [],
    checkins: close ? L('lib_performance_goals').checkinsIn(as, emp, from, to) : [],
    feedback: L('lib_performance_feedback').aboutIn(as, emp, from, to),
    trainings: close ? L('lib_performance_training').completedIn(as, emp, from, to) : [],
    earlier_reviews: historyOf(as, emp).filter((h) => h.cycle !== c.id),
    note: 'Only what the reviewer may see. Ratings and rankings are the reviewer\'s; a summary describes, it never rates.',
  };
}

/* -------------------------------------------------- home, profile, cron */

function activeCyclesFor(ctx, today) {
  const util = u();
  const ids = cycleIdsFor(ctx);
  return util
    .findMany(ctx.app, 'review_cycles', "status = 'active'", '-period_end', 50)
    .filter((r) => ids[r.id])
    .map((r) => {
      const v = cycleView(ctx, r, today);
      return { id: v.id, name: v.name, kind: v.kind, period_start: v.period_start, period_end: v.period_end, phases: v.phases, counts: v.counts, can: v.can };
    });
}

function owedBy(ctx, employeeId, today) {
  const util = u();
  const app = ctx.app;
  const rows = util.rows(app, "SELECT r.id AS id FROM reviews r JOIN review_participants p ON p.id = r.participant JOIN review_cycles c ON c.id = r.cycle WHERE r.reviewer = {:e} AND r.status = 'draft' AND c.status = 'active' AND p.stage IN ('open', 'submitted') ORDER BY c.period_end LIMIT 200", { id: '' }, { e: employeeId });
  const out = [];
  for (const x of rows) {
    const rv = app.findRecordById('reviews', x.id);
    const pr = app.findRecordById('review_participants', rv.getString('participant'));
    if (rv.getString('kind') === 'manager' && pr.getString('stage') !== 'open') continue;
    const c = app.findRecordById('review_cycles', rv.getString('cycle'));
    const ph = phaseOf(c, rv.getString('kind'));
    if (ph !== null && today < ph.start) continue;
    const due = dueOf(c, rv.getString('kind'));
    out.push({ review: rv.id, kind: rv.getString('kind'), employee: core().chip(ctx, rv.getString('employee')), cycle: { id: c.id, name: c.getString('name') }, due: due, overdue: due < today, started: rv.getString('started_at') !== '' });
  }
  out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return out;
}

function toAcknowledge(ctx, employeeId) {
  const util = u();
  const app = ctx.app;
  return util.findMany(app, 'review_participants', "employee = {:e} && stage = 'shared'", '-shared_at', 20, { e: employeeId }).map((pr) => {
    const c = app.findRecordById('review_cycles', pr.getString('cycle'));
    const mgr = util.findOne(app, 'reviews', "participant = {:p} && kind = 'manager'", { p: pr.id });
    return { participant: pr.id, review: mgr !== null ? mgr.id : '', cycle: { id: c.id, name: c.getString('name') }, shared_at: pr.getString('shared_at') };
  });
}

function teamMissing(ctx) {
  const util = u();
  const team = Object.keys(core().teamOf(ctx));
  if (team.length === 0) return 0;
  const bind = {};
  return util.count(ctx.app, "SELECT COUNT(*) AS n FROM reviews r JOIN review_cycles c ON c.id = r.cycle JOIN review_participants p ON p.id = r.participant WHERE c.status = 'active' AND p.stage != 'removed' AND r.status = 'draft' AND r.kind IN ('self', 'manager') AND " + core().inList('r.employee', team, bind, 't'), bind);
}

/** The person's cycles: stage, rating (when the caller may see it) and the reviews the caller may open. */
function historyOf(ctx, employeeId) {
  const util = u();
  const app = ctx.app;
  return util
    .findMany(app, 'review_participants', "employee = {:e} && stage != 'removed'", '-created', 50, { e: employeeId })
    .map((pr) => {
      const c = app.findRecordById('review_cycles', pr.getString('cycle'));
      const snap = snapshotOf(app, c);
      const see = seesRating(ctx, pr);
      const rating = pr.getInt('final') || pr.getInt('overall');
      const reviews = util
        .findMany(app, 'reviews', 'participant = {:p}', 'kind', 50, { p: pr.id })
        .filter((r) => canSeeReview(ctx, r, pr))
        .map((r) => ({ id: r.id, kind: r.getString('kind'), status: r.getString('status') }));
      return { participant: pr.id, cycle: c.id, cycle_name: c.getString('name'), cycle_status: c.getString('status'), period_start: c.getString('period_start'), period_end: c.getString('period_end'), stage: pr.getString('stage'), rating: see && AFTER_SHARE.concat(['submitted']).indexOf(pr.getString('stage')) >= 0 ? rating : null, rating_label: see ? ratingLabel(snap, rating) : '', reviews: reviews };
    })
    .filter((h) => h.reviews.length > 0 || core().relation(ctx, employeeId).hr !== 'none' || ctx.isAgent);
}

function lastShared(ctx, employeeId) {
  const util = u();
  const app = ctx.app;
  const pr = util.findOne(app, 'review_participants', "employee = {:e} && (stage = 'shared' || stage = 'acknowledged' || stage = 'signoff' || stage = 'signed')", { e: employeeId });
  if (pr === null) return null;
  const c = app.findRecordById('review_cycles', pr.getString('cycle'));
  const mgr = util.findOne(app, 'reviews', "participant = {:p} && kind = 'manager'", { p: pr.id });
  if (mgr === null || !canSeeReview(ctx, mgr, pr)) return null;
  const see = seesRating(ctx, pr);
  return { cycle_name: c.getString('name'), review: mgr.id, rating_label: see ? ratingLabel(snapshotOf(app, c), pr.getInt('final') || pr.getInt('overall')) : '' };
}

/** Remind reviewers of one cycle (force: now, every draft in an open phase; else the phases ending within the reminder window or overdue). */
function remindCycle(ctx, c, force) {
  const util = u();
  const app = ctx.app;
  const today = util.today(app, c.getString('entity') || undefined);
  const days = core().settingsOf(app).reminder_days;
  let n = 0;
  const per = {};
  for (const ph of phasesOf(c, today)) {
    if (KINDS.indexOf(ph.key) < 0 || ph.state === 'upcoming') continue;
    if (!force && ph.state === 'open' && ph.days_left > days) continue;
    for (const r of util.rows(app, "SELECT r.id AS id, r.reviewer AS reviewer FROM reviews r JOIN review_participants p ON p.id = r.participant WHERE r.cycle = {:c} AND r.kind = {:k} AND r.status = 'draft' AND r.reviewer != '' AND p.stage = 'open'", { id: '', reviewer: '' }, { c: c.id, k: ph.key })) {
      if (!core().nudgeOnce(app, (force ? 'revm:' : 'rev:') + r.id + ':' + today, today)) continue;
      per[r.reviewer] = (per[r.reviewer] || 0) + 1;
      util.exec(app, 'UPDATE reviews SET reminded_on = {:d} WHERE id = {:id}', { d: today, id: r.id });
    }
  }
  for (const emp of Object.keys(per)) {
    core().notifyEmployee(app, emp, { kind: 'performance', title: 'Reminder: ' + per[emp] + ' review' + (per[emp] === 1 ? '' : 's') + ' to finish in ' + c.getString('name'), link: '#/performance', facts: [{ type: 'number', key: 'reviews', label: 'To finish', value: per[emp], unit: per[emp] === 1 ? 'review' : 'reviews' }, { type: 'text', key: 'cycle', label: 'Cycle', value: c.getString('name') }] });
    n++;
  }
  return n;
}

/** Cron: each active cycle at 09:00 in its entity's time zone (the first entity for company-wide cycles). */
function remindDue(ctx, force) {
  const util = u();
  let n = 0;
  for (const c of util.findMany(ctx.app, 'review_cycles', "status = 'active'", '', 0)) {
    if (!force && util.localNow(ctx.app, c.getString('entity') || undefined).hour !== 9) continue;
    n += remindCycle(ctx, c, false);
  }
  return n;
}

/* --------------------------------------------------------------- export */

function cyclesExport(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = cycleRef(ctx, util.req(p, 'cycle'));
  if (!cycleIdsFor(ctx)[c.id]) throw util.fail(403, 'You cannot see this cycle.', 'not_permitted');
  const res = participantsList(ctx, { cycle: c.id, limit: 500 });
  const rows = [['number', 'name', 'department', 'manager', 'stage', 'self_review', 'manager_review', 'peers_submitted', 'peers_total', 'score', 'manager_rating', 'final_rating', 'rating_label', 'calibration_reason', 'shared_at', 'acknowledged_at', 'signed_at']];
  for (const x of res.participants) {
    rows.push([x.employee ? x.employee.number : '', x.employee ? x.employee.name : '', x.department_name, x.manager ? x.manager.name : '', x.stage, x.reviews.self ? x.reviews.self.status : '', x.reviews.manager ? x.reviews.manager.status : '', x.reviews.peer.submitted, x.reviews.peer.total, x.score === null ? '' : x.score, x.overall || '', x.final || '', x.rating_label, x.final_reason, x.shared_at.slice(0, 10), x.acknowledged_at.slice(0, 10), x.signed_at.slice(0, 10)]);
  }
  L('lib_audit').write(ctx, { op: 'cycles.export', collection: 'review_cycles', record: c.id, summary: 'Exported ' + (rows.length - 1) + ' review results of ' + c.getString('name') + ' to CSV' });
  return { filename: util.slug(c.getString('name')) + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

module.exports = {
  mayAskSummary: mayAskSummary,
  KINDS: KINDS,
  PHASES: PHASES,
  CYCLE_KINDS: CYCLE_KINDS,
  templatesList: templatesList,
  templatesGet: templatesGet,
  templatesCreate: templatesCreate,
  templatesUpdate: templatesUpdate,
  templatesDelete: templatesDelete,
  cyclesList: cyclesList,
  cyclesGet: cyclesGet,
  cyclesDefaults: cyclesDefaults,
  cyclesCreate: cyclesCreate,
  cyclesUpdate: cyclesUpdate,
  cyclesPreview: cyclesPreview,
  cyclesLaunch: cyclesLaunch,
  cyclesPhase: cyclesPhase,
  cyclesClose: cyclesClose,
  cyclesDelete: cyclesDelete,
  cyclesRemind: cyclesRemind,
  cyclesExport: cyclesExport,
  participantsList: participantsList,
  participantsGet: participantsGet,
  participantsAdd: participantsAdd,
  participantsRemove: participantsRemove,
  reviewsGet: reviewsGet,
  reviewsList: reviewsList,
  reviewsSave: reviewsSave,
  reviewsSubmit: reviewsSubmit,
  reviewsReopen: reviewsReopen,
  reviewsAddPeer: reviewsAddPeer,
  reviewsDecline: reviewsDecline,
  reviewsReassign: reviewsReassign,
  reviewsRemove: reviewsRemove,
  reviewsShare: reviewsShare,
  reviewsShareAll: reviewsShareAll,
  reviewsAcknowledge: reviewsAcknowledge,
  reviewsContext: reviewsContext,
  onSignoff: onSignoff,
  calibrationView: calibrationView,
  calibrationAdjust: calibrationAdjust,
  requestSummary: requestSummary,
  submitSummary: submitSummary,
  markSummary: markSummary,
  activeCyclesFor: activeCyclesFor,
  owedBy: owedBy,
  toAcknowledge: toAcknowledge,
  teamMissing: teamMissing,
  historyOf: historyOf,
  lastShared: lastShared,
  remindDue: remindDue,
  scoreOf: scoreOf,
  defaultsFor: defaultsFor,
};
