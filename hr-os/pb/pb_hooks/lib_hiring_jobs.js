/// <reference path="../pb_data/types.d.ts" />
/**
 * Job openings (collection `openings`, ops `openings.*`): made from an
 * approved requisition or directly, with a markdown description your AI
 * agent may draft or improve as a proposal (the job_post_draft trigger), the
 * work place, remote mode, employment type, the pay range in the entity's
 * currency (a warning where pay transparency law wants it), pipeline stages
 * per opening, the hiring team, and the board of its candidates. Interview
 * kits (criteria and questions) live here too.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function h() {
  return L('lib_hiring');
}

const STATUS = ['draft', 'open', 'on_hold', 'closed'];
const KIT_KINDS = ['phone', 'video', 'onsite', 'technical', 'panel', 'other'];

function openingRef(ctx, ref) {
  const util = u();
  const s = String(ref || '').trim();
  if (s === '') throw util.fail(400, 'Give the opening id or number (J0001).', 'missing_param', { param: 'opening' });
  const r = util.byId(ctx.app, 'openings', s) || util.findOne(ctx.app, 'openings', 'number = {:n}', { n: s.toUpperCase() });
  if (r === null) throw util.fail(404, 'No opening ' + s + '. Run openings.list.', 'not_found');
  return r;
}

/** Counts of active applications per stage key, and the hired count. */
function stageCounts(app, openingId) {
  const util = u();
  const counts = {};
  for (const r of util.rows(app, "SELECT stage, COUNT(*) AS n FROM applications WHERE opening = {:j} AND status = 'active' GROUP BY stage", { stage: '', n: 0 }, { j: openingId })) counts[r.stage] = r.n;
  const closed = {};
  for (const r of util.rows(app, "SELECT status, COUNT(*) AS n FROM applications WHERE opening = {:j} AND status != 'active' GROUP BY status", { status: '', n: 0 }, { j: openingId })) closed[r.status] = r.n;
  return { stages: counts, hired: closed.hired || 0, rejected: closed.rejected || 0, withdrawn: closed.withdrawn || 0 };
}

function payText(currency, lo, hi, per) {
  const money = L('lib_money');
  if (lo <= 0 && hi <= 0) return '';
  const a = lo > 0 ? money.format(lo, currency) : '';
  const b = hi > 0 ? money.format(hi, currency).replace(currency.toUpperCase() + ' ', '') : '';
  return (a !== '' && b !== '' ? a + ' to ' + b : a !== '' ? 'From ' + a : 'Up to ' + money.format(hi, currency)) + (per ? ' a ' + per : '');
}

function openingView(ctx, r, access, opts) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const money = L('lib_money');
  const o = opts || {};
  const cache = o.cache || {};
  const cur = r.getString('currency');
  const counts = stageCounts(app, r.id);
  const lo = r.getInt('salary_min_minor');
  const hi = r.getInt('salary_max_minor');
  const ent = util.byId(app, 'entities', r.getString('entity'));
  const req = r.getString('requisition') !== '' ? util.byId(app, 'requisitions', r.getString('requisition')) : null;
  const stages = hh.stagesOf(r).map((s) => ({ key: s.key, name: s.name, kind: s.kind, kit: s.kit || '', kit_name: s.kit ? hh.nameOf(app, 'interview_kits', s.kit) : '', count: s.kind === 'hired' ? counts.hired : counts.stages[s.key] || 0 }));
  const rule = hh.payRule(r.getString('country'), r.getString('region'), r.getString('remote'));
  const active = Object.keys(counts.stages).reduce((a, k) => a + counts.stages[k], 0);
  const out = {
    id: r.id,
    number: r.getString('number'),
    requisition: r.getString('requisition'),
    requisition_number: req !== null ? req.getString('number') : '',
    entity: r.getString('entity'),
    entity_name: ent !== null ? ent.getString('name') : '',
    entity_country: ent !== null ? ent.getString('country') : '',
    department: r.getString('department'),
    department_name: hh.nameOf(app, 'departments', r.getString('department')),
    title: r.getString('title'),
    job_title: r.getString('job_title'),
    job_title_name: hh.nameOf(app, 'job_titles', r.getString('job_title')),
    location: r.getString('location'),
    location_name: hh.nameOf(app, 'locations', r.getString('location')),
    location_text: r.getString('location_text'),
    country: r.getString('country'),
    region: r.getString('region'),
    remote: r.getString('remote'),
    employment_type: r.getString('employment_type'),
    employment_type_name: hh.nameOf(app, 'employment_types', r.getString('employment_type')),
    currency: cur,
    salary_min_minor: lo,
    salary_max_minor: hi,
    salary_min: lo > 0 && cur !== '' ? money.fromMinor(lo, cur) : '',
    salary_max: hi > 0 && cur !== '' ? money.fromMinor(hi, cur) : '',
    pay_per: r.getString('pay_per'),
    pay_text: cur !== '' ? payText(cur, lo, hi, r.getString('pay_per')) : '',
    show_pay: r.getBool('show_pay'),
    pay_rule: rule,
    issues: hh.jobIssues(r),
    status: r.getString('status'),
    positions: r.getInt('positions'),
    hired: counts.hired,
    active: active,
    rejected: counts.rejected,
    withdrawn: counts.withdrawn,
    stages: stages,
    opened_at: r.getString('opened_at'),
    closed_at: r.getString('closed_at'),
    close_reason: r.getString('close_reason'),
    hiring_manager: r.getString('hiring_manager'),
    hiring_manager_name: hh.memberName(app, r.getString('hiring_manager'), cache),
    owner: r.getString('owner'),
    owner_name: hh.memberName(app, r.getString('owner'), cache),
    team: hh.membersBrief(app, util.jsonOf(r, 'team', []) || [], cache),
    agent: L('lib_agent').view(r, 'job_post_draft'),
    access: access,
    can: { edit: hh.writable(ctx, access) && hh.agentMay(ctx, 'openings.update'), publish: hh.isFull(ctx) && hh.agentMay(ctx, 'openings.set-status'), add: hh.writable(ctx, access) && hh.agentMay(ctx, 'applications.add') && ['draft', 'open', 'on_hold'].indexOf(r.getString('status')) >= 0 },
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
  if (o.description !== false) out.description = r.getString('description');
  return out;
}

function needOpening(ctx, ref, write) {
  const r = openingRef(ctx, ref);
  const a = h().needJob(ctx, r, write);
  return { rec: r, access: a };
}

/* ------------------------------------------------------------------ ops */

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  if (hh.level(ctx) === 'none') return { openings: [], total: 0 };
  const bind = {};
  const where = [hh.jobWhere(ctx, bind, 'j')];
  const status = util.str(p, 'status', 'active');
  if (status === 'active') where.push("j.status IN ('draft', 'open', 'on_hold')");
  else if (status !== 'all') {
    if (STATUS.indexOf(status) < 0) throw util.fail(400, 'status is active, all or one of ' + STATUS.join(', '), 'invalid_param', { param: 'status' });
    where.push('j.status = {:s}');
    bind.s = status;
  }
  const ent = util.str(p, 'entity', '');
  if (ent !== '') {
    where.push('j.entity = {:e}');
    bind.e = L('lib_org').entityRef(app, ent).id;
  }
  const dep = util.str(p, 'department', '');
  if (dep !== '') {
    where.push('j.department = {:d}');
    bind.d = L('lib_org').kindRef(app, 'department', dep).id;
  }
  if (util.bool(p, 'mine', false) && ctx.memberId) {
    where.push('(j.hiring_manager = {:me} OR j.owner = {:me} OR j.team LIKE {:met})');
    bind.me = ctx.memberId;
    bind.met = '%"' + ctx.memberId + '"%';
  }
  const q = util.squash(util.str(p, 'q', ''));
  if (q !== '') {
    where.push("(j.title LIKE {:q} ESCAPE '\\' OR j.number LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const pg = util.page(p, 50, 300);
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM openings j WHERE ' + w, bind);
  const ids = util.rows(app, "SELECT j.id AS id FROM openings j WHERE " + w + " ORDER BY CASE j.status WHEN 'open' THEN 0 WHEN 'on_hold' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, j.opened_at DESC, j.created DESC LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const cache = {};
  return {
    openings: ids.map((x) => {
      const r = app.findRecordById('openings', x.id);
      return openingView(ctx, r, hh.jobAccess(ctx, r), { cache: cache, description: false });
    }),
    total: total,
    can_add: hh.atLeast(ctx, 'edit') && hh.agentMay(ctx, 'openings.add'),
  };
}

function get(ctx, p) {
  const util = u();
  const x = needOpening(ctx, util.req(p, 'opening'), false);
  const v = openingView(ctx, x.rec, x.access, {});
  v.kits = kitsFor(ctx.app, x.rec.id).map(kitView);
  return { opening: v };
}

/** Fill the fields shared by openings.add and openings.update. */
function fill(ctx, r, p, isNew) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const hh = h();
  if (isNew || util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 160, ''));
    // A new opening from a requisition keeps the requisition's title when none is given.
    if (t !== '') r.set('title', t);
    else if (!(isNew && r.getString('title') !== '')) throw util.fail(400, 'title is required, e.g. --title "Backend engineer"', 'missing_param', { param: 'title' });
  }
  if (util.has(p, 'description')) r.set('description', util.text(p, 'description', 60000, ''));
  if (util.has(p, 'department')) r.set('department', util.str(p, 'department', '') === '' ? '' : org.kindRef(app, 'department', util.str(p, 'department', '')).id);
  if (util.has(p, 'job_title')) r.set('job_title', util.str(p, 'job_title', '') === '' ? '' : org.kindRef(app, 'title', util.str(p, 'job_title', '')).id);
  if (util.has(p, 'location')) {
    const loc = util.str(p, 'location', '') === '' ? null : org.kindRef(app, 'location', util.str(p, 'location', ''));
    r.set('location', loc === null ? '' : loc.id);
    if (loc !== null && !util.has(p, 'country')) {
      if (loc.getString('country') !== '') r.set('country', loc.getString('country'));
      if (!util.has(p, 'region')) r.set('region', loc.getString('region'));
    }
  }
  if (util.has(p, 'location_text')) r.set('location_text', util.text(p, 'location_text', 160, ''));
  if (util.has(p, 'country')) {
    const c = util.str(p, 'country', '').toUpperCase();
    if (c !== '' && !/^[A-Z]{2}$/.test(c)) throw util.fail(400, 'country is a two-letter code, e.g. US', 'invalid_param', { param: 'country' });
    r.set('country', c);
  }
  if (util.has(p, 'region')) r.set('region', util.text(p, 'region', 10, '').toUpperCase());
  if (util.has(p, 'remote')) r.set('remote', util.oneOf(p, 'remote', hh.REMOTE, 'onsite'));
  if (r.getString('remote') === '') r.set('remote', 'onsite');
  if (util.has(p, 'employment_type')) r.set('employment_type', util.str(p, 'employment_type', '') === '' ? '' : org.kindRef(app, 'employment_type', util.str(p, 'employment_type', '')).id);
  const cur = r.getString('currency');
  if (util.has(p, 'salary_min')) r.set('salary_min_minor', util.money(p, 'salary_min', cur) || 0);
  if (util.has(p, 'salary_max')) r.set('salary_max_minor', util.money(p, 'salary_max', cur) || 0);
  if (util.has(p, 'pay_per')) r.set('pay_per', util.oneOf(p, 'pay_per', hh.PER, ''));
  if (r.getString('pay_per') === '') r.set('pay_per', ['US', 'CA', 'GB', 'AU', 'NZ', 'IE'].indexOf(r.getString('country')) >= 0 ? 'year' : 'month');
  if (util.has(p, 'show_pay')) r.set('show_pay', util.bool(p, 'show_pay', false));
  if (util.has(p, 'positions')) r.set('positions', util.int(p, 'positions', 1, 1, 1000));
  if (r.getInt('positions') < 1) r.set('positions', 1);
  if (util.has(p, 'hiring_manager')) r.set('hiring_manager', util.str(p, 'hiring_manager', '') === '' ? '' : hh.memberIds(app, [util.str(p, 'hiring_manager', '')], 'hiring_manager')[0]);
  if (util.has(p, 'team')) r.set('team', hh.memberIds(app, util.list(p, 'team') || [], 'team'));
}

function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const hh = h();
  const r = util.newRecord(app, 'openings');
  const reqRef = util.str(p, 'requisition', '');
  if (reqRef !== '') {
    const x = L('lib_hiring_plans').reqRef(ctx, reqRef);
    const q = x.rec;
    if (q.getString('status') !== 'approved') throw util.fail(409, 'Requisition ' + q.getString('number') + ' is ' + q.getString('status') + '; an opening is made once it is approved.', 'not_approved');
    r.set('requisition', q.id);
    r.set('entity', q.getString('entity'));
    r.set('department', q.getString('department'));
    r.set('title', q.getString('title'));
    r.set('job_title', q.getString('job_title'));
    r.set('location', q.getString('location'));
    r.set('remote', q.getString('remote') || 'onsite');
    r.set('employment_type', q.getString('employment_type'));
    r.set('currency', q.getString('currency'));
    r.set('salary_min_minor', q.getInt('pay_min_minor'));
    r.set('salary_max_minor', q.getInt('pay_max_minor'));
    r.set('pay_per', q.getString('pay_per'));
    r.set('hiring_manager', q.getString('hiring_manager'));
    r.set('positions', Math.max(1, q.getInt('headcount')));
  } else if (util.str(p, 'copy_from', '') !== '') {
    // A new opening like an earlier one (the template): post, place, pay, stages and team.
    const src = needOpening(ctx, util.str(p, 'copy_from', ''), false).rec;
    for (const k of ['entity', 'department', 'title', 'job_title', 'description', 'location', 'location_text', 'country', 'region', 'remote', 'employment_type', 'currency', 'salary_min_minor', 'salary_max_minor', 'pay_per', 'show_pay', 'hiring_manager']) r.set(k, src.get(k));
    r.set('team', util.jsonOf(src, 'team', []) || []);
    r.set('stages', hh.stagesOf(src));
    r.set('positions', 1);
  } else {
    const ent = org.entityRef(app, util.req(p, 'entity', 'Northwind Pte Ltd'));
    r.set('entity', ent.id);
    r.set('currency', ent.getString('currency'));
    r.set('positions', 1);
  }
  const ent = app.findRecordById('entities', r.getString('entity'));
  if (!ctx.isAgent && hh.broad(ctx) && !L('lib_auth').inScope(ctx, ent.id)) throw util.fail(403, 'You cannot open roles in ' + ent.getString('name') + '.', 'not_permitted');
  if (r.getString('country') === '') {
    r.set('country', ent.getString('country'));
    r.set('region', ent.getString('region'));
  }
  if (r.getString('location') !== '' && util.str(p, 'copy_from', '') === '') {
    const loc = util.byId(app, 'locations', r.getString('location'));
    if (loc !== null && loc.getString('country') !== '') {
      r.set('country', loc.getString('country'));
      r.set('region', loc.getString('region'));
    }
  }
  if (util.has(p, 'entity') && reqRef !== '') {
    const e2 = org.entityRef(app, util.str(p, 'entity', ''));
    if (e2.id !== r.getString('entity')) throw util.fail(400, 'The opening belongs to the requisition\'s entity.', 'invalid_param', { param: 'entity' });
  }
  fill(ctx, r, p, true);
  if (r.getString('employment_type') === '') {
    const ft = util.findOne(app, 'employment_types', "code = 'full_time'", {});
    if (ft !== null) r.set('employment_type', ft.id);
  }
  if (util.has(p, 'stages')) r.set('stages', hh.cleanStages(util.list(p, 'stages'), 'stages'));
  else if (hh.stagesOf(r).length === 0) r.set('stages', hh.defaultStages(app));
  r.set('status', 'draft');
  r.set('team', util.jsonOf(r, 'team', []) || []);
  r.set('owner', ctx.memberId || '');
  if (!ctx.isAgent && !hh.broad(ctx) && r.getString('hiring_manager') === '') r.set('hiring_manager', ctx.memberId || '');
  r.set('number', 'J' + String(util.nextNumber(app, 'opening')).padStart(4, '0'));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'openings', record: r.id, summary: 'Drafted opening ' + r.getString('number') + ' (' + r.getString('title') + ')' + (r.getString('requisition') !== '' ? ' from a requisition' : util.str(p, 'copy_from', '') !== '' ? ' like an earlier one' : '') });
  return { opening: openingView(ctx, r, hh.jobAccess(ctx, r) || 'team', {}) };
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  h().needChange(p, 'opening');
  const x = needOpening(ctx, util.req(p, 'opening'), true);
  const r = x.rec;
  const before = openingView(ctx, r, x.access, {});
  if (util.has(p, 'currency')) {
    const c = util.str(p, 'currency', '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'currency is a three-letter code', 'invalid_param', { param: 'currency' });
    if (c !== r.getString('currency') && !util.has(p, 'salary_min') && !util.has(p, 'salary_max') && (r.getInt('salary_min_minor') > 0 || r.getInt('salary_max_minor') > 0)) throw util.fail(409, 'Give the pay range again in ' + c + '.', 'conflict');
    r.set('currency', c);
  }
  fill(ctx, r, p, false);
  if (r.getInt('salary_min_minor') > 0 && r.getInt('salary_max_minor') > 0 && r.getInt('salary_min_minor') > r.getInt('salary_max_minor')) throw util.fail(400, 'salary_min is above salary_max.', 'invalid_param', { param: 'salary_min' });
  app.save(r);
  const after = openingView(ctx, r, x.access, {});
  const changed = ['title', 'description', 'department_name', 'job_title_name', 'location_name', 'location_text', 'country', 'region', 'remote', 'employment_type_name', 'salary_min', 'salary_max', 'pay_per', 'show_pay', 'positions', 'hiring_manager_name'].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  L('lib_audit').note(ctx, { collection: 'openings', record: r.id, summary: 'Changed opening ' + r.getString('number') + (changed.length > 0 ? ' (' + changed.join(', ') + ')' : ''), before: pick(before, changed), after: pick(after, changed) });
  if (util.has(p, 'description') && ctx.actor === 'person') L('lib_agent').end(app, r, 'job_post_draft', 'closed', 'The description was changed in the app.');
  return { opening: after };
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

/** Proposal preview of openings.update (your AI agent's job post drafts). */
function previewUpdate(ctx, p) {
  const util = u();
  const r = openingRef(ctx, util.str(p, 'opening', ''));
  const fields = [];
  const show = (name, before, after) => {
    if (String(before) !== String(after)) fields.push({ name: name, before: before, after: after });
  };
  const cur = r.getString('currency');
  const money = L('lib_money');
  if (util.has(p, 'title')) show('title', r.getString('title'), util.str(p, 'title', ''));
  if (util.has(p, 'description')) show('description', r.getString('description'), util.str(p, 'description', ''));
  if (util.has(p, 'location_text')) show('location_text', r.getString('location_text'), util.str(p, 'location_text', ''));
  if (util.has(p, 'remote')) show('remote', r.getString('remote'), util.str(p, 'remote', ''));
  if (util.has(p, 'salary_min')) show('salary_min', r.getInt('salary_min_minor') > 0 ? money.fromMinor(r.getInt('salary_min_minor'), cur) : '', util.str(p, 'salary_min', ''));
  if (util.has(p, 'salary_max')) show('salary_max', r.getInt('salary_max_minor') > 0 ? money.fromMinor(r.getInt('salary_max_minor'), cur) : '', util.str(p, 'salary_max', ''));
  for (const k of ['department', 'job_title', 'location', 'country', 'region', 'employment_type', 'pay_per', 'show_pay', 'positions', 'hiring_manager', 'team', 'currency']) if (util.has(p, k)) show(k, k === 'team' ? JSON.stringify(util.jsonOf(r, 'team', [])) : String(r.get(k) === undefined || r.get(k) === null ? '' : r.get(k)), typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k]));
  return { label: (util.has(p, 'description') ? 'Job post for ' : 'Change opening ') + r.getString('number') + ' ' + r.getString('title'), target: 'openings:' + r.id, fields: fields, notes: [], risk: 'low' };
}

/** Proposal preview of openings.add: "Draft opening <title> (<entity>)", where it comes from, and what is set. */
function previewAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  let title = util.squash(util.str(p, 'title', ''));
  let entity = '';
  let from = '';
  try {
    if (util.str(p, 'requisition', '') !== '') {
      const q = L('lib_hiring_plans').reqRef(ctx, util.str(p, 'requisition', '')).rec;
      if (title === '') title = q.getString('title');
      entity = hh.nameOf(app, 'entities', q.getString('entity'));
      from = ' from requisition ' + q.getString('number');
    } else if (util.str(p, 'copy_from', '') !== '') {
      const src = openingRef(ctx, util.str(p, 'copy_from', ''));
      if (title === '') title = src.getString('title');
      entity = hh.nameOf(app, 'entities', src.getString('entity'));
      from = ' like ' + src.getString('number');
    } else if (util.str(p, 'entity', '') !== '') {
      entity = L('lib_org').entityRef(app, util.str(p, 'entity', '')).getString('name');
    }
  } catch {
    // The dry run has already checked the params; a name that does not resolve here stays out of the label.
  }
  const post = util.str(p, 'description', '') !== '';
  const fields = Object.keys(p)
    .filter((k) => k !== 'why' && util.has(p, k) && hh.shownValue(p[k]) !== '')
    .map((k) => ({ name: k, before: '', after: k === 'entity' && entity !== '' ? entity : hh.shownValue(p[k]) }));
  return { label: 'Draft opening ' + (title !== '' ? title : 'without a title') + (entity !== '' ? ' (' + entity + ')' : '') + from + (post ? ' with its job post' : ''), target: '', fields: fields, notes: ['It starts as a draft; a person opens it with openings.set-status.'], risk: 'low' };
}

/** Proposal preview of openings.stages: the stage names before and after. */
function previewStages(ctx, p) {
  const util = u();
  const hh = h();
  const r = openingRef(ctx, util.str(p, 'opening', ''));
  const names = (list) => list.map((s) => String((s && s.name) || '')).join(', ');
  let next = [];
  try {
    next = util.list(p, 'stages') || [];
  } catch {
    next = [];
  }
  const fields = [{ name: 'stages', before: names(hh.stagesOf(r)), after: names(next) }];
  if (util.has(p, 'moves')) fields.push({ name: 'moves', before: '', after: hh.shownValue(p.moves) });
  return { label: 'Stages of ' + r.getString('number') + ' ' + r.getString('title'), target: 'openings:' + r.id, fields: fields, notes: [], risk: 'low' };
}

/** Proposal preview of interview-kits.save. */
function previewKit(ctx, p) {
  const util = u();
  const out = h().savePreview(ctx, p, { collection: 'interview_kits', id: 'kit', noun: 'interview kit', name: 'name', nameParam: 'name', fields: { name: 'name', kind: 'kind', duration_min: 'duration_min', criteria: 'criteria', questions: 'questions', archived: 'archived' }, json: ['criteria', 'questions'] });
  if (util.str(p, 'kit', '') === '' && util.str(p, 'opening', '') !== '') {
    try {
      const r = openingRef(ctx, util.str(p, 'opening', ''));
      out.label += ' for ' + r.getString('number') + ' ' + r.getString('title');
    } catch {
      // checked by the dry run
    }
  }
  return out;
}

function setStages(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = needOpening(ctx, util.req(p, 'opening'), true);
  const r = x.rec;
  const old = hh.stagesOf(r);
  const next = hh.cleanStages(util.list(p, 'stages'), 'stages');
  const moves = util.obj(p, 'moves') || {};
  const keys = next.map((s) => s.key);
  const counts = stageCounts(app, r.id).stages;
  const plan = [];
  for (const s of old) {
    if (keys.indexOf(s.key) >= 0) continue;
    const n = counts[s.key] || 0;
    if (n === 0) continue;
    const to = String(moves[s.key] || '');
    if (keys.indexOf(to) < 0) throw util.fail(409, n + ' candidate' + (n === 1 ? ' is' : 's are') + ' in "' + s.name + '". Say where they go: --moves \'{"' + s.key + '":"<stage key>"}\'.', 'stage_in_use', { stage: s.key, count: n });
    if (next.filter((y) => y.key === to)[0].kind === 'hired') throw util.fail(400, 'Candidates reach the hired stage only when they are hired.', 'invalid_param', { param: 'moves' });
    plan.push({ from: s.key, to: to, n: n });
  }
  const hiredKey = next.filter((s) => s.kind === 'hired')[0].key;
  app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const rec = tx.findRecordById('openings', r.id);
    rec.set('stages', next);
    tx.save(rec);
    for (const m of plan) {
      for (const a of u().findMany(tx, 'applications', "opening = {:j} && stage = {:s} && status = 'active'", '', 0, { j: r.id, s: m.from })) {
        a.set('stage', m.to);
        a.set('stage_since', u().nowIso());
        tx.save(a);
        hh.event(t, { candidate: a.getString('candidate'), application: a.id, kind: 'moved', from: m.from, to: m.to, text: 'Stage removed from the opening' });
      }
    }
    u().exec(tx, "UPDATE applications SET stage = {:h} WHERE opening = {:j} AND status = 'hired'", { h: hiredKey, j: r.id });
    L('lib_audit').write(t, { op: 'openings.stages', collection: 'openings', record: r.id, summary: 'Changed the stages of opening ' + r.getString('number') + ': ' + next.map((s) => s.name).join(', '), before: old, after: next });
  });
  ctx.audited = true;
  const fresh = app.findRecordById('openings', r.id);
  return { opening: openingView(ctx, fresh, x.access, {}), moved: plan };
}

function setStatus(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = needOpening(ctx, util.req(p, 'opening'), true);
  const r = x.rec;
  const status = util.oneOf(p, 'status', ['open', 'on_hold', 'closed', 'draft'], '');
  if (status === '') throw util.fail(400, 'status is open, on_hold, closed or draft', 'missing_param', { param: 'status' });
  const was = r.getString('status');
  if (was === status) return { opening: openingView(ctx, r, x.access, {}), active_left: 0 };
  if (status === 'draft' && util.count(app, 'SELECT COUNT(*) AS n FROM applications WHERE opening = {:j}', { j: r.id }) > 0) throw util.fail(409, 'This opening has candidates; put it on hold instead.', 'conflict');
  if (status === 'open' && util.squash(r.getString('title')) === '') throw util.fail(400, 'Give the opening a title first.', 'missing_param');
  r.set('status', status);
  if (status === 'open' && r.getString('opened_at') === '') r.set('opened_at', util.nowIso());
  if (status === 'closed') {
    r.set('closed_at', util.nowIso());
    r.set('close_reason', util.oneOf(p, 'close_reason', ['filled', 'cancelled', 'other'], stageCounts(app, r.id).hired >= r.getInt('positions') ? 'filled' : 'cancelled'));
  } else {
    r.set('closed_at', '');
    r.set('close_reason', '');
  }
  app.save(r);
  const left = util.count(app, "SELECT COUNT(*) AS n FROM applications WHERE opening = {:j} AND status = 'active'", { j: r.id });
  const words = { open: 'Opened', on_hold: 'Put on hold', closed: 'Closed', draft: 'Moved back to draft' };
  L('lib_audit').note(ctx, { collection: 'openings', record: r.id, summary: words[status] + ' opening ' + r.getString('number') + ' (' + r.getString('title') + ')', before: { status: was }, after: { status: status } });
  return { opening: openingView(ctx, r, x.access, {}), active_left: status === 'closed' ? left : 0, issues: status === 'open' ? h().jobIssues(r) : [] };
}

function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const x = needOpening(ctx, util.req(p, 'opening'), true);
  const r = x.rec;
  const n = util.count(app, 'SELECT COUNT(*) AS n FROM applications WHERE opening = {:j}', { j: r.id });
  if (n > 0) throw util.fail(409, 'This opening has ' + n + ' candidate' + (n === 1 ? '' : 's') + '; close it instead.', 'in_use', { applications: n });
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'openings', record: r.id, summary: 'Deleted opening ' + r.getString('number') + ' (' + r.getString('title') + ')' });
  return { deleted: true };
}

/** agent.retry on job_post_draft: hiring edit rights on the opening. */
function mayAsk(ctx, rec) {
  needOpening(ctx, rec.id, true);
}

/** Ask your AI agent to draft or improve the job post (job_post_draft with the opening's id; its answer is a proposal). */
function draftPost(ctx, p) {
  const util = u();
  const x = needOpening(ctx, util.req(p, 'opening'), true);
  const r = x.rec;
  const a = L('lib_agent').ask(ctx, r, 'job_post_draft', { note: util.text(p, 'notes', 2000, '') });
  L('lib_audit').note(ctx, { collection: 'openings', record: r.id, summary: (a.asked ? 'Asked your AI agent to draft the job post for ' : 'Your AI agent is already asked about the job post for ') + r.getString('number'), after: { trigger: 'job_post_draft', request: a.request } });
  return { asked: a.asked, agent: L('lib_agent').view(ctx.app.findRecordById('openings', r.id), 'job_post_draft') };
}

/** The pipeline board: active applications per stage, plus how many were closed. */
function board(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const x = needOpening(ctx, util.req(p, 'opening'), false);
  const r = x.rec;
  const sort = util.oneOf(p, 'sort', ['waiting', 'applied', 'name'], 'waiting');
  const status = util.oneOf(p, 'status', ['active', 'rejected', 'withdrawn', 'hired', 'closed'], 'active');
  const order = sort === 'name' ? 'c.name' : sort === 'applied' ? 'a.applied_at DESC, a.created DESC' : 'a.stage_since, a.created';
  const where = status === 'closed' ? "a.status != 'active'" : 'a.status = {:st}';
  const rows = util.rows(
    app,
    "SELECT a.id AS id, a.stage AS stage, a.stage_since AS since, a.status AS status, a.applied_at AS applied_at, a.source AS source, a.referral AS referral, a.closed_at AS closed_at, COALESCE(rr.name, '') AS reason, c.id AS candidate, c.name AS name, c.current_title AS current_title, c.current_company AS current_company, c.tags AS tags, c.resume AS resume FROM applications a JOIN candidates c ON c.id = a.candidate LEFT JOIN rejection_reasons rr ON rr.id = a.rejected_reason WHERE a.opening = {:j} AND " + where + ' ORDER BY ' + order + ' LIMIT 2000',
    { id: '', stage: '', since: '', status: '', applied_at: '', source: '', referral: '', closed_at: '', reason: '', candidate: '', name: '', current_title: '', current_company: '', tags: '', resume: '' },
    { j: r.id, st: status },
  );
  const nowIso = new Date().toISOString();
  const nextIv = {};
  for (const iv of util.rows(app, "SELECT application, MIN(at) AS at FROM interviews WHERE opening = {:j} AND status = 'scheduled' AND at >= {:now} GROUP BY application", { application: '', at: '' }, { j: r.id, now: nowIso })) nextIv[iv.application] = iv.at;
  const cards = {};
  for (const sc of util.rows(app, "SELECT a.id AS application, CAST(COALESCE(SUM(CASE WHEN f.status = 'submitted' THEN 1 ELSE 0 END), 0) AS INTEGER) AS done, COUNT(f.id) AS total FROM applications a JOIN interview_feedback f ON f.application = a.id WHERE a.opening = {:j} GROUP BY a.id", { application: '', done: 0, total: 0 }, { j: r.id })) cards[sc.application] = { submitted: sc.done, total: sc.total };
  const offers = {};
  for (const o of util.rows(app, "SELECT application, status FROM offers WHERE opening = {:j} AND status NOT IN ('withdrawn') ORDER BY created", { application: '', status: '' }, { j: r.id })) offers[o.application] = o.status;
  const items = rows.map((a) => {
    let tags = [];
    try {
      tags = JSON.parse(a.tags || '[]') || [];
    } catch {
      tags = [];
    }
    const since = String(a.since || '').slice(0, 10);
    return {
      application: a.id,
      candidate: a.candidate,
      name: a.name,
      current_title: a.current_title,
      current_company: a.current_company,
      stage: a.stage,
      status: a.status,
      since: a.since,
      days_in_stage: util.isDay(since) ? Math.max(0, Math.floor((Date.now() - Date.parse(String(a.since).replace(' ', 'T'))) / 86400000) || 0) : 0,
      applied_at: a.applied_at,
      source: a.source,
      referred: a.referral !== '',
      has_resume: a.resume !== '',
      tags: tags,
      next_interview: nextIv[a.id] || '',
      scorecards: cards[a.id] || { submitted: 0, total: 0 },
      offer: offers[a.id] || '',
      reason: a.reason,
      closed_at: a.closed_at,
    };
  });
  const stages = hh.stagesOf(r);
  const columns = stages.map((s) => ({ key: s.key, name: s.name, kind: s.kind, cards: status === 'active' ? items.filter((c) => c.stage === s.key) : [] }));
  const counts = stageCounts(app, r.id);
  return {
    opening: openingView(ctx, r, x.access, { description: false }),
    columns: columns,
    closed: status === 'active' ? [] : items,
    totals: { active: items.length, hired: counts.hired, rejected: counts.rejected, withdrawn: counts.withdrawn },
    sort: sort,
    status: status,
  };
}

/** Open roles anyone signed in may see (referrals, internal moves). */
function openList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hh = h();
  const q = util.squash(util.str(p, 'q', ''));
  const bind = {};
  let w = "j.status = 'open'";
  if (q !== '') {
    w += " AND j.title LIKE {:q} ESCAPE '\\'";
    bind.q = util.like(q);
  }
  const rows = util.rows(app, 'SELECT j.id AS id FROM openings j WHERE ' + w + ' ORDER BY j.opened_at DESC LIMIT 200', { id: '' }, bind);
  return {
    openings: rows.map((x) => {
      const r = app.findRecordById('openings', x.id);
      const v = openingView(ctx, r, 'all', {});
      return { id: v.id, number: v.number, title: v.title, entity_name: v.entity_name, department_name: v.department_name, location: v.location_name || v.location_text, remote: v.remote, employment_type_name: v.employment_type_name, description: v.description, currency: v.show_pay ? v.currency : '', salary_min_minor: v.show_pay ? v.salary_min_minor : null, salary_max_minor: v.show_pay ? v.salary_max_minor : null, pay_per: v.show_pay ? v.pay_per : '', opened_at: v.opened_at };
    }),
    can_refer: hh.agentMay(ctx, 'referrals.add') && ctx.memberId !== '',
  };
}

/* ---------------------------------------------------------------- kits */

function kitsFor(app, openingId) {
  return u().findMany(app, 'interview_kits', "archived = false && (opening = '' || opening = {:j})", 'name', 0, { j: openingId || '-' });
}

function kitView(r) {
  const util = u();
  return { id: r.id, name: r.getString('name'), opening: r.getString('opening'), kind: r.getString('kind'), duration_min: r.getInt('duration_min'), criteria: util.jsonOf(r, 'criteria', []) || [], questions: util.jsonOf(r, 'questions', []) || [], archived: r.getBool('archived') };
}

function kitsList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const op = util.str(p, 'opening', '');
  let rows;
  if (op !== '') {
    const x = needOpening(ctx, op, false);
    rows = kitsFor(app, x.rec.id);
  } else rows = util.findMany(app, 'interview_kits', util.bool(p, 'archived', false) ? "opening = ''" : "opening = '' && archived = false", 'name');
  return { kits: rows.map(kitView) };
}

function cleanCriteria(raw) {
  const util = u();
  const out = [];
  const keys = {};
  (raw || []).forEach((c, i) => {
    util.keysOnly(c, ['key', 'name', 'description'], 'criterion ' + (i + 1));
    const name = util.clip(util.squash(c.name), 80);
    if (name === '') throw util.fail(400, 'criterion ' + (i + 1) + ': name is required.', 'invalid_param', { param: 'criteria' });
    let key = String(c.key || '').trim() || util.slug(name).replace(/-/g, '_').slice(0, 30) || 'c' + (i + 1);
    if (!/^[a-z0-9_]{1,40}$/.test(key)) key = 'c' + (i + 1);
    while (keys[key]) key = key + '_' + (i + 1);
    keys[key] = true;
    out.push({ key: key, name: name, description: util.clip(String(c.description || ''), 400) });
  });
  if (out.length > 20) throw util.fail(400, 'At most 20 criteria.', 'invalid_param', { param: 'criteria' });
  return out;
}

function cleanQuestions(raw, criteria) {
  const util = u();
  const ck = criteria.map((c) => c.key);
  const out = [];
  (raw || []).forEach((q, i) => {
    util.keysOnly(q, ['key', 'text', 'criterion', 'guidance'], 'question ' + (i + 1));
    const text = util.clip(util.squash(q.text), 600);
    if (text === '') throw util.fail(400, 'question ' + (i + 1) + ': text is required.', 'invalid_param', { param: 'questions' });
    const crit = String(q.criterion || '');
    if (crit !== '' && ck.indexOf(crit) < 0) throw util.fail(400, 'question ' + (i + 1) + ': criterion "' + crit + '" is not one of the kit criteria (' + ck.join(', ') + ').', 'invalid_param', { param: 'questions' });
    out.push({ key: String(q.key || 'q' + (i + 1)).slice(0, 40), text: text, criterion: crit, guidance: util.clip(String(q.guidance || ''), 1000) });
  });
  if (out.length > 40) throw util.fail(400, 'At most 40 questions.', 'invalid_param', { param: 'questions' });
  return out;
}

function kitsSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'kit', '');
  if (id !== '') h().needChange(p, 'kit');
  const r = id !== '' ? util.byId(app, 'interview_kits', id) : util.newRecord(app, 'interview_kits');
  if (r === null) throw util.fail(404, 'No interview kit ' + id + '. Run interview-kits.list.', 'not_found');
  if (r.getString('opening') !== '') needOpening(ctx, r.getString('opening'), true);
  const before = id !== '' ? kitView(r) : null;
  if (id === '' && util.str(p, 'opening', '') !== '') r.set('opening', needOpening(ctx, util.str(p, 'opening', ''), true).rec.id);
  else if (id === '' && !h().isFull(ctx)) throw util.fail(403, 'Kits for every opening are set by people with full hiring access; add a kit to your opening (--opening).', 'not_permitted');
  if (id === '' || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name is required, e.g. --name "Phone screen"', 'missing_param', { param: 'name' });
    r.set('name', n);
  }
  if (util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', KIT_KINDS, 'video'));
  else if (id === '') r.set('kind', 'video');
  if (util.has(p, 'duration_min')) r.set('duration_min', util.int(p, 'duration_min', 45, 0, 600));
  else if (id === '') r.set('duration_min', 45);
  let criteria = util.jsonOf(r, 'criteria', []) || [];
  if (util.has(p, 'criteria')) criteria = cleanCriteria(util.list(p, 'criteria'));
  r.set('criteria', criteria);
  if (util.has(p, 'questions')) r.set('questions', cleanQuestions(util.list(p, 'questions'), criteria));
  else r.set('questions', cleanQuestions(util.jsonOf(r, 'questions', []) || [], criteria));
  if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'interview_kits', record: r.id, summary: (id === '' ? 'Added' : 'Changed') + ' the interview kit "' + r.getString('name') + '"', before: before, after: kitView(r) });
  return { kit: kitView(r) };
}

function kitsDelete(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'interview_kits', util.req(p, 'kit'));
  if (r === null) throw util.fail(404, 'No such interview kit.', 'not_found');
  if (r.getString('opening') !== '') needOpening(ctx, r.getString('opening'), true);
  else if (!h().isFull(ctx)) throw util.fail(403, 'Only people with full hiring access remove shared kits.', 'not_permitted');
  const used = util.count(app, 'SELECT COUNT(*) AS n FROM interviews WHERE kit = {:k}', { k: r.id });
  if (used > 0) {
    r.set('archived', true);
    app.save(r);
    L('lib_audit').note(ctx, { collection: 'interview_kits', record: r.id, summary: 'Archived the interview kit "' + r.getString('name') + '" (used by ' + used + ' interviews)' });
    return { archived: true, used: used };
  }
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'interview_kits', record: r.id, summary: 'Deleted the interview kit "' + r.getString('name') + '"' });
  return { deleted: true };
}

module.exports = {
  mayAsk: mayAsk,
  STATUS: STATUS,
  KIT_KINDS: KIT_KINDS,
  openingRef: openingRef,
  needOpening: needOpening,
  openingView: openingView,
  stageCounts: stageCounts,
  payText: payText,
  list: list,
  get: get,
  add: add,
  update: update,
  previewUpdate: previewUpdate,
  previewAdd: previewAdd,
  previewStages: previewStages,
  previewKit: previewKit,
  setStages: setStages,
  setStatus: setStatus,
  remove: remove,
  draftPost: draftPost,
  board: board,
  openList: openList,
  kitsFor: kitsFor,
  kitView: kitView,
  kitsList: kitsList,
  kitsSave: kitsSave,
  kitsDelete: kitsDelete,
};
