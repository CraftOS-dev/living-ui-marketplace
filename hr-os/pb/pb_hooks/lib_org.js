/// <reference path="../pb_data/types.d.ts" />
/**
 * Organisation: legal entities (each with a country, currency, time zone,
 * fiscal year and its statutory packs), locations (with geofence and kiosk
 * code), departments (with head and approver), job titles, grades, cost
 * centres and employment types.
 *
 * Creating an entity seeds its country defaults from lib_countries: the
 * public holiday calendar of its country and region (every year the country
 * data has), a standard work week and the employment types; it enables the
 * country's packs and emits `entity.created { entity, country, region }` so
 * modules seed theirs (leave types, pay components, policies).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/* ------------------------------------------------------------- entity */

function entityRef(app, ref) {
  return u().byIdOrName(app, 'entities', ref, 'name', 'entities.list');
}

function entityView(app, r) {
  const util = u();
  const countries = L('lib_countries');
  const c = countries.info(r.getString('country'));
  return {
    id: r.id,
    name: r.getString('name'),
    code: r.getString('code'),
    legal_name: r.getString('legal_name'),
    country: r.getString('country'),
    country_name: c ? c.name : r.getString('country'),
    region: r.getString('region'),
    currency: r.getString('currency'),
    timezone: r.getString('timezone'),
    fiscal_year_start: r.getString('fiscal_year_start'),
    week_start: r.getInt('week_start'),
    date_format: c ? c.date_format : 'YYYY-MM-DD',
    tax_ids: util.jsonOf(r, 'tax_ids', {}) || {},
    address: util.jsonOf(r, 'address', {}) || {},
    registration: util.jsonOf(r, 'registration', {}) || {},
    packs: util.jsonOf(r, 'packs', []) || [],
    bank: util.jsonOf(r, 'bank', {}) || {},
    default_calendar: r.getString('default_calendar'),
    default_schedule: r.getString('default_schedule'),
    default_pay_schedule: r.getString('default_pay_schedule'),
    default_leave_policy: r.getString('default_leave_policy'),
    default_onboarding_template: r.getString('default_onboarding_template'),
    active: r.getBool('active'),
    people: util.count(app, "SELECT COUNT(*) AS n FROM employments WHERE entity = {:e} AND status != 'ended'", { e: r.id }),
  };
}

function checkZone(zone) {
  if (!u().isZone(zone)) throw u().fail(400, 'Unknown time zone "' + zone + '". Use one of: ' + Object.keys(u().ZONES).join(', '), 'invalid_timezone', { param: 'timezone' });
}

/** The holiday calendar of a country and region, made and filled from the country data when missing. */
function countryCalendar(app, countryCode, region) {
  const util = u();
  const countries = L('lib_countries');
  const c = countries.get(countryCode);
  const regionalRows = (c.holidays || []).filter((h) => h.region && h.region === region);
  const code = c.code + (region && regionalRows.length > 0 ? '-' + region : '');
  let cal = util.findOne(app, 'holiday_calendars', 'code = {:c}', { c: code });
  if (cal !== null) return cal;
  const regionName = ((c.regions || []).filter((x) => x.code === region)[0] || {}).name || region;
  cal = util.newRecord(app, 'holiday_calendars');
  cal.set('code', code);
  cal.set('name', c.name + (code !== c.code ? ' (' + regionName + ')' : '') + ' public holidays');
  cal.set('country', c.code);
  cal.set('region', code !== c.code ? region : '');
  cal.set('builtin', true);
  cal.set('seeded_years', []);
  app.save(cal);
  L('lib_calendar').seedYears(app, cal, null);
  return app.findRecordById('holiday_calendars', cal.id);
}

/** A standard work week from the country's default. */
function countrySchedule(app, entityRec, countryCode) {
  const util = u();
  const sch = L('lib_countries').schedule(countryCode);
  const week = (sch.days || [1, 2, 3, 4, 5]).map((d) => ({ dow: d, start: sch.start || '09:00', end: sch.end || '17:30', break_min: sch.break_min === undefined ? 60 : sch.break_min }));
  const rec = util.newRecord(app, 'work_schedules');
  rec.set('name', 'Standard week (' + entityRec.getString('name') + ')');
  rec.set('entity', entityRec.id);
  rec.set('week', week);
  rec.set('hours_per_week', L('lib_calendar').weekHours(week));
  rec.set('flexible', false);
  rec.set('grace_min', 5);
  rec.set('night_from', '22:00');
  rec.set('night_to', '05:00');
  app.save(rec);
  return rec;
}

function seedEmploymentTypes(app, countryCode) {
  const util = u();
  let sort = util.count(app, 'SELECT COUNT(*) AS n FROM employment_types');
  for (const t of L('lib_countries').employmentTypes(countryCode)) {
    const code = String(t.code || '').trim();
    if (code === '') continue;
    let rec = util.findOne(app, 'employment_types', 'code = {:c}', { c: code });
    if (rec === null) {
      rec = util.newRecord(app, 'employment_types');
      rec.set('code', code);
      rec.set('name', t.name || code);
      rec.set('statutory', {});
      rec.set('sort', ++sort);
    }
    if (t.statutory) {
      const st = util.jsonOf(rec, 'statutory', {}) || {};
      st[countryCode] = t.statutory;
      rec.set('statutory', st);
    }
    app.save(rec);
  }
}

/** Read and check the editable entity fields from params into a record. */
function applyEntity(ctx, rec, p, creating) {
  const util = u();
  const app = ctx.app;
  if (util.has(p, 'name') || creating) {
    const n = util.squash(util.text(p, 'name', 160, ''));
    if (n === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
    const dup = util.rows(app, 'SELECT id FROM entities WHERE LOWER(name) = LOWER({:n}) AND id != {:x}', { id: '' }, { n: n, x: rec.id || '' });
    if (dup.length > 0) throw util.fail(409, 'There is already an entity called ' + n + '.', 'duplicate');
    rec.set('name', n);
  }
  if (util.has(p, 'code')) rec.set('code', util.text(p, 'code', 20, '').toUpperCase());
  if (util.has(p, 'legal_name')) rec.set('legal_name', util.text(p, 'legal_name', 200, ''));
  if (util.has(p, 'region')) rec.set('region', util.text(p, 'region', 10, '').toUpperCase());
  if (util.has(p, 'currency') && util.str(p, 'currency', '') !== '') {
    const c = util.str(p, 'currency', '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'currency is a three-letter code such as SGD.', 'invalid_param', { param: 'currency' });
    if (!creating && c !== rec.getString('currency') && util.count(app, 'SELECT COUNT(*) AS n FROM employments WHERE entity = {:e}', { e: rec.id }) > 0) throw util.fail(409, 'This entity has people paid in ' + rec.getString('currency') + '; its currency cannot change.', 'in_use');
    rec.set('currency', c);
  }
  if (util.has(p, 'timezone') && util.str(p, 'timezone', '') !== '') {
    const z = util.str(p, 'timezone', '');
    checkZone(z);
    rec.set('timezone', z);
  }
  if (util.has(p, 'fiscal_year_start') && util.str(p, 'fiscal_year_start', '') !== '') {
    const f = util.str(p, 'fiscal_year_start', '');
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(f)) throw util.fail(400, 'fiscal_year_start is MM-DD, e.g. 04-01.', 'invalid_param', { param: 'fiscal_year_start' });
    rec.set('fiscal_year_start', f);
  }
  if (util.has(p, 'week_start')) rec.set('week_start', util.int(p, 'week_start', 1, 0, 6));
  for (const k of ['tax_ids', 'address', 'registration', 'bank']) {
    const v = util.obj(p, k);
    if (v !== undefined) rec.set(k, v);
  }
  if (util.has(p, 'packs')) rec.set('packs', (util.list(p, 'packs') || []).map(String));
  if (util.has(p, 'default_calendar')) rec.set('default_calendar', util.str(p, 'default_calendar', '') === '' ? '' : L('lib_calendar').calendarRef(app, util.str(p, 'default_calendar', '')).id);
  if (util.has(p, 'default_schedule')) rec.set('default_schedule', util.str(p, 'default_schedule', '') === '' ? '' : L('lib_calendar').scheduleRef(app, util.str(p, 'default_schedule', '')).id);
  for (const k of ['default_pay_schedule', 'default_leave_policy', 'default_onboarding_template']) if (util.has(p, k)) rec.set(k, util.text(p, k, 30, ''));
  if (util.has(p, 'active')) rec.set('active', util.bool(p, 'active', true));
}

/**
 * Create an entity with its country defaults, on ctx.app (callers wrap it in
 * a transaction and emit entity.created afterwards). Returns the view.
 */
function createEntity(ctx, p) {
  const util = u();
  const app = ctx.app;
  const countries = L('lib_countries');
  const c = countries.get(util.req(p, 'country', 'SG'));
  const rec = util.newRecord(app, 'entities');
  rec.set('country', c.code);
  rec.set('currency', c.currency);
  rec.set('timezone', c.timezone);
  rec.set('fiscal_year_start', c.fiscal_year_start || '01-01');
  rec.set('week_start', typeof c.week_start === 'number' ? c.week_start : 1);
  rec.set('active', true);
  rec.set('tax_ids', {});
  rec.set('address', {});
  rec.set('registration', {});
  rec.set('bank', {});
  applyEntity(ctx, rec, p, true);
  checkZone(rec.getString('timezone'));
  const region = rec.getString('region');
  if (region !== '' && (c.regions || []).length > 0 && !(c.regions || []).some((x) => x.code === region)) {
    throw util.fail(400, 'Unknown region "' + region + '" for ' + c.name + '. Regions: ' + c.regions.map((x) => x.code).join(', '), 'invalid_param', { param: 'region' });
  }
  if (!util.has(p, 'packs')) rec.set('packs', countries.packsFor(c.code, region));
  app.save(rec);
  const cal = countryCalendar(app, c.code, region);
  const sch = countrySchedule(app, rec, c.code);
  seedEmploymentTypes(app, c.code);
  rec.set('default_calendar', cal.id);
  rec.set('default_schedule', sch.id);
  app.save(rec);
  return entityView(app, rec);
}

function entitiesList(ctx, p) {
  const util = u();
  const auth = L('lib_auth');
  const all = util.bool(p, 'all', false);
  const rows = util.findMany(ctx.app, 'entities', all ? '1=1' : 'active = true', 'created');
  return { entities: rows.filter((r) => auth.inScope(ctx, r.id)).map((r) => entityView(ctx.app, r)) };
}

function entitiesGet(ctx, p) {
  const rec = entityRef(ctx.app, u().req(p, 'entity'));
  if (!L('lib_auth').inScope(ctx, rec.id)) throw u().fail(403, 'You cannot see this entity.', 'not_permitted');
  const app = ctx.app;
  const view = entityView(app, rec);
  view.profile_fields = L('lib_countries').profileFields(view.packs, u().today(app, rec.id));
  view.locations = u()
    .findMany(app, 'locations', 'entity = {:e} && archived = false', 'name', 0, { e: rec.id })
    .map((x) => locationOut(ctx, x));
  view.departments = u()
    .findMany(app, 'departments', 'entity = {:e} && archived = false', 'name', 0, { e: rec.id })
    .map((x) => departmentView(app, x));
  return { entity: view };
}

function entitiesAdd(ctx, p) {
  let view = null;
  ctx.app.runInTransaction((tx) => {
    view = createEntity(L('lib_auth').withApp(ctx, tx), p);
  });
  L('lib_audit').note(ctx, { collection: 'entities', record: view.id, summary: 'Added the entity ' + view.name + ' (' + view.country + ')', after: view });
  const events = L('lib_events').emit(ctx, 'entity.created', { entity: view.id, country: view.country, region: view.region });
  return { entity: entityView(ctx.app, ctx.app.findRecordById('entities', view.id)), events: events };
}

function entitiesUpdate(ctx, p) {
  const util = u();
  const rec = entityRef(ctx.app, util.req(p, 'entity'));
  const before = entityView(ctx.app, rec);
  applyEntity(ctx, rec, p, false);
  ctx.app.save(rec);
  const after = entityView(ctx.app, rec);
  L('lib_audit').note(ctx, { collection: 'entities', record: rec.id, summary: 'Changed the entity ' + after.name, before: before, after: after });
  return { entity: after };
}

/* -------------------------------------------------- generic org tables */

const KINDS = {
  location: {
    collection: 'locations',
    label: 'location',
    list: 'locations.list',
    unique: 'name',
    fields: {
      entity: { type: 'rel', target: 'entities', required: true },
      name: { type: 'text', max: 120, required: true },
      address: { type: 'json' },
      country: { type: 'country' },
      region: { type: 'text', max: 10, upper: true },
      timezone: { type: 'zone' },
      lat: { type: 'num', min: -90, max: 90 },
      lng: { type: 'num', min: -180, max: 180 },
      radius_m: { type: 'int', min: 0, max: 100000 },
      calendar: { type: 'rel', target: 'holiday_calendars' },
      kiosk_code: { type: 'text', max: 20 },
      archived: { type: 'bool' },
    },
    refs: [['job_records', 'location']],
  },
  department: {
    collection: 'departments',
    label: 'department',
    list: 'departments.list',
    unique: 'name',
    fields: {
      name: { type: 'text', max: 120, required: true },
      code: { type: 'text', max: 40 },
      entity: { type: 'rel', target: 'entities' },
      parent: { type: 'rel', target: 'departments' },
      head: { type: 'employee' },
      approver: { type: 'employee' },
      cost_center: { type: 'rel', target: 'cost_centers' },
      archived: { type: 'bool' },
    },
    refs: [['job_records', 'department'], ['departments', 'parent']],
  },
  title: {
    collection: 'job_titles',
    label: 'job title',
    list: 'titles.list',
    unique: 'name',
    fields: {
      name: { type: 'text', max: 160, required: true },
      family: { type: 'text', max: 120 },
      grade: { type: 'rel', target: 'grades' },
      description: { type: 'text', max: 4000 },
      archived: { type: 'bool' },
    },
    refs: [['job_records', 'job_title']],
  },
  grade: {
    collection: 'grades',
    label: 'grade',
    list: 'grades.list',
    unique: 'code',
    fields: {
      code: { type: 'text', max: 40, required: true },
      name: { type: 'text', max: 120, required: true },
      entity: { type: 'rel', target: 'entities' },
      currency: { type: 'currency' },
      pay_min: { type: 'money', field: 'pay_min_minor' },
      pay_max: { type: 'money', field: 'pay_max_minor' },
      sort: { type: 'int', min: 0, max: 10000 },
      archived: { type: 'bool' },
    },
    refs: [['job_records', 'grade'], ['job_titles', 'grade']],
  },
  cost_center: {
    collection: 'cost_centers',
    label: 'cost centre',
    list: 'cost-centers.list',
    unique: 'code',
    fields: {
      code: { type: 'text', max: 40, required: true },
      name: { type: 'text', max: 120, required: true },
      entity: { type: 'rel', target: 'entities' },
      archived: { type: 'bool' },
    },
    refs: [['job_records', 'cost_center'], ['departments', 'cost_center']],
  },
  employment_type: {
    collection: 'employment_types',
    label: 'employment type',
    list: 'employment-types.list',
    unique: 'code',
    fields: {
      code: { type: 'text', max: 40, required: true },
      name: { type: 'text', max: 120, required: true },
      statutory: { type: 'json' },
      sort: { type: 'int', min: 0, max: 10000 },
      archived: { type: 'bool' },
    },
    refs: [['job_records', 'employment_type']],
  },
};

function kindRef(app, kind, ref) {
  const k = KINDS[kind];
  const util = u();
  const r = String(ref || '').trim();
  const byId = util.byId(app, k.collection, r);
  if (byId !== null) return byId;
  if (k.unique === 'code') {
    const byCode = util.findOne(app, k.collection, 'code = {:c}', { c: r });
    if (byCode !== null) return byCode;
  }
  return util.byIdOrName(app, k.collection, r, 'name', k.list);
}

function viewOf(app, kind, rec) {
  const k = KINDS[kind];
  const util = u();
  const out = { id: rec.id };
  for (const name of Object.keys(k.fields)) {
    const f = k.fields[name];
    if (f.type === 'money') {
      const cur = rec.getString('currency');
      out[f.field] = rec.getInt(f.field);
      out[name] = cur !== '' ? L('lib_money').fromMinor(rec.getInt(f.field), cur) : '';
    } else if (f.type === 'json') out[name] = util.jsonOf(rec, name, {}) || {};
    else if (f.type === 'bool') out[name] = rec.getBool(name);
    else if (f.type === 'int') out[name] = rec.getInt(name);
    else if (f.type === 'num') out[name] = rec.getFloat(name);
    else out[name] = rec.getString(name);
  }
  return out;
}

/** A location without its kiosk code (the code opens the office time clock). */
function locationView(app, rec) {
  const v = viewOf(app, 'location', rec);
  const ent = u().byId(app, 'entities', v.entity);
  v.entity_name = ent ? ent.getString('name') : '';
  v.has_kiosk_code = v.kiosk_code !== '';
  delete v.kiosk_code;
  return v;
}

/** May the caller see kiosk codes? Time editors, administrators and your AI agent. */
function canSeeKiosk(ctx) {
  const auth = L('lib_auth');
  return ctx.isAgent || ctx.actor === 'system' || auth.can(ctx, 'time', 'edit') || auth.can(ctx, 'admin', 'edit');
}

/** A location for this caller: the kiosk code only when they may see it. */
function locationOut(ctx, rec) {
  const v = locationView(ctx.app, rec);
  if (canSeeKiosk(ctx)) v.kiosk_code = rec.getString('kiosk_code');
  return v;
}

function departmentView(app, rec) {
  const util = u();
  const v = viewOf(app, 'department', rec);
  const people = L('lib_people');
  const head = util.byId(app, 'employees', v.head);
  const appr = util.byId(app, 'employees', v.approver);
  v.head_name = head ? people.displayName(head) : '';
  v.approver_name = appr ? people.displayName(appr) : '';
  return v;
}

function applyKind(ctx, kind, rec, p, creating) {
  const k = KINDS[kind];
  const util = u();
  const app = ctx.app;
  for (const name of Object.keys(k.fields)) {
    const f = k.fields[name];
    const target = f.field || name;
    if (!util.has(p, name)) {
      if (creating && f.required) throw util.fail(400, name + ' is required', 'missing_param', { param: name });
      continue;
    }
    if (f.type === 'text') {
      let v = util.squash(util.text(p, name, f.max || 200, ''));
      if (f.upper) v = v.toUpperCase();
      if (f.required && v === '') throw util.fail(400, name + ' cannot be empty', 'invalid_param', { param: name });
      rec.set(target, v);
    } else if (f.type === 'bool') rec.set(target, util.bool(p, name, false));
    else if (f.type === 'int') rec.set(target, util.int(p, name, 0, f.min, f.max));
    else if (f.type === 'num') rec.set(target, util.num(p, name, { min: f.min, max: f.max }) || 0);
    else if (f.type === 'json') rec.set(target, util.obj(p, name) || {});
    else if (f.type === 'country') {
      const c = util.str(p, name, '').toUpperCase();
      if (c !== '') L('lib_countries').get(c);
      rec.set(target, c);
    } else if (f.type === 'currency') {
      const c = util.str(p, name, '').toUpperCase();
      if (c !== '' && !/^[A-Z]{3}$/.test(c)) throw util.fail(400, name + ' is a three-letter code.', 'invalid_param', { param: name });
      rec.set(target, c);
    } else if (f.type === 'zone') {
      const z = util.str(p, name, '');
      if (z !== '') checkZone(z);
      rec.set(target, z);
    } else if (f.type === 'rel') {
      const ref = util.str(p, name, '');
      if (ref === '') {
        if (f.required) throw util.fail(400, name + ' is required', 'missing_param', { param: name });
        rec.set(target, '');
      } else {
        let t;
        if (f.target === 'entities') t = entityRef(app, ref);
        else if (f.target === 'holiday_calendars') t = L('lib_calendar').calendarRef(app, ref);
        else if (f.target === 'departments') t = kindRef(app, 'department', ref);
        else if (f.target === 'cost_centers') t = kindRef(app, 'cost_center', ref);
        else if (f.target === 'grades') t = kindRef(app, 'grade', ref);
        else t = util.byIdOrName(app, f.target, ref, 'name');
        rec.set(target, t.id);
      }
    } else if (f.type === 'employee') {
      const ref = util.str(p, name, '');
      rec.set(target, ref === '' ? '' : L('lib_people').employeeRef(app, ref).id);
    } else if (f.type === 'money') {
      const cur = util.str(p, 'currency', '') || rec.getString('currency');
      if (cur === '') throw util.fail(400, 'Give the currency for ' + name + '.', 'missing_param', { param: 'currency' });
      rec.set(target, util.money(p, name, cur) || 0);
    }
  }
  if (rec.getString('entity') !== '' && !L('lib_auth').inScope(ctx, rec.getString('entity'))) throw util.fail(403, 'You cannot change records of that entity.', 'not_permitted');
  const uq = k.unique;
  const val = rec.getString(uq);
  const scopeSql = k.collection === 'locations' ? ' AND entity = {:e}' : '';
  const dup = util.rows(app, 'SELECT id FROM ' + k.collection + ' WHERE LOWER(' + uq + ') = LOWER({:v}) AND id != {:x}' + scopeSql, { id: '' }, { v: val, x: rec.id || '', e: rec.getString('entity') });
  if (dup.length > 0) throw util.fail(409, 'There is already a ' + k.label + ' ' + val + '.', 'duplicate');
  if (kind === 'department' && rec.getString('parent') !== '') {
    let cur = rec.getString('parent');
    const seen = {};
    while (cur !== '') {
      if (cur === rec.id) throw util.fail(400, 'A department cannot sit under itself.', 'invalid_param', { param: 'parent' });
      if (seen[cur]) break;
      seen[cur] = true;
      const pr = util.byId(app, 'departments', cur);
      cur = pr ? pr.getString('parent') : '';
    }
  }
  if (kind === 'grade' && rec.getInt('pay_max_minor') > 0 && rec.getInt('pay_min_minor') > rec.getInt('pay_max_minor')) throw util.fail(400, 'pay_min is more than pay_max.', 'invalid_param');
}

function kindList(ctx, kind, p) {
  const k = KINDS[kind];
  const util = u();
  const auth = L('lib_auth');
  const where = [];
  const bind = {};
  if (!util.bool(p, 'archived', false)) where.push('archived = false');
  const ent = util.str(p, 'entity', '');
  if (ent !== '' && k.fields.entity) {
    where.push(kind === 'location' ? 'entity = {:e}' : "(entity = {:e} || entity = '')");
    bind.e = entityRef(ctx.app, ent).id;
  }
  const rows = util.findMany(ctx.app, k.collection, where.length > 0 ? where.join(' && ') : '1=1', k.fields.sort ? 'sort,' + k.unique : k.unique, 0, bind);
  const out = rows.filter((r) => !k.fields.entity || r.getString('entity') === '' || auth.inScope(ctx, r.getString('entity'))).map((r) => (kind === 'department' ? departmentView(ctx.app, r) : kind === 'location' ? locationOut(ctx, r) : viewOf(ctx.app, kind, r)));
  if (kind === 'department') {
    for (const d of out) d.people = util.count(ctx.app, 'SELECT COUNT(DISTINCT j.employment) AS n FROM job_records j WHERE j.department = {:d}', { d: d.id });
  }
  return out;
}

function kindAdd(ctx, kind, p) {
  const k = KINDS[kind];
  const rec = u().newRecord(ctx.app, k.collection);
  if (kind === 'location') {
    const ent = entityRef(ctx.app, u().req(p, 'entity'));
    rec.set('country', ent.getString('country'));
    rec.set('region', ent.getString('region'));
    rec.set('timezone', ent.getString('timezone'));
    rec.set('calendar', ent.getString('default_calendar'));
    rec.set('address', {});
  }
  if (kind === 'grade' && !u().has(p, 'currency') && u().str(p, 'entity', '') !== '') rec.set('currency', entityRef(ctx.app, u().str(p, 'entity', '')).getString('currency'));
  if (k.fields.statutory) rec.set('statutory', {});
  applyKind(ctx, kind, rec, p, true);
  ctx.app.save(rec);
  const view = kind === 'department' ? departmentView(ctx.app, rec) : kind === 'location' ? locationOut(ctx, rec) : viewOf(ctx.app, kind, rec);
  L('lib_audit').note(ctx, { collection: k.collection, record: rec.id, summary: 'Added the ' + k.label + ' ' + (rec.getString('name') || rec.getString('code')), after: view });
  return view;
}

function kindUpdate(ctx, kind, p) {
  const k = KINDS[kind];
  const ref = u().req(p, kind === 'cost_center' ? 'cost_center' : kind === 'employment_type' ? 'employment_type' : kind);
  const rec = kindRef(ctx.app, kind, ref);
  const before = viewOf(ctx.app, kind, rec);
  const q = Object.assign({}, p);
  delete q[kind];
  applyKind(ctx, kind, rec, q, false);
  ctx.app.save(rec);
  const view = kind === 'department' ? departmentView(ctx.app, rec) : kind === 'location' ? locationOut(ctx, rec) : viewOf(ctx.app, kind, rec);
  L('lib_audit').note(ctx, { collection: k.collection, record: rec.id, summary: 'Changed the ' + k.label + ' ' + (rec.getString('name') || rec.getString('code')), before: before, after: view });
  return view;
}

function kindDelete(ctx, kind, p) {
  const k = KINDS[kind];
  const util = u();
  const rec = kindRef(ctx.app, kind, util.req(p, kind));
  for (const [col, field] of k.refs) {
    const n = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM ' + col + ' WHERE ' + field + ' = {:id}', { id: rec.id });
    if (n > 0) throw util.fail(409, 'This ' + k.label + ' is used by ' + n + ' record' + (n === 1 ? '' : 's') + '. Archive it instead (update with --archived true).', 'in_use', { count: n });
  }
  ctx.app.delete(rec);
  L('lib_audit').note(ctx, { collection: k.collection, record: rec.id, summary: 'Deleted the ' + k.label + ' ' + (rec.getString('name') || rec.getString('code')) });
  return { deleted: true };
}

/** A new random kiosk code for a location (time clock kiosks sign in with it). */
function locationsKiosk(ctx, p) {
  const util = u();
  const rec = kindRef(ctx.app, 'location', util.req(p, 'location'));
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = $security.randomStringWithAlphabet(8, '23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
    if (util.findOne(ctx.app, 'locations', 'kiosk_code = {:c}', { c: code }) === null) break;
  }
  rec.set('kiosk_code', code);
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'locations', record: rec.id, summary: 'New kiosk code for ' + rec.getString('name') });
  return { location: locationOut(ctx, rec) };
}

module.exports = {
  KINDS: KINDS,
  entityRef: entityRef,
  entityView: entityView,
  createEntity: createEntity,
  countryCalendar: countryCalendar,
  kindRef: kindRef,
  viewOf: viewOf,
  departmentView: departmentView,
  locationView: locationView,
  locationOut: locationOut,
  canSeeKiosk: canSeeKiosk,
  entitiesList: entitiesList,
  entitiesGet: entitiesGet,
  entitiesAdd: entitiesAdd,
  entitiesUpdate: entitiesUpdate,
  locationsList: (ctx, p) => ({ locations: kindList(ctx, 'location', p) }),
  locationsAdd: (ctx, p) => ({ location: kindAdd(ctx, 'location', p) }),
  locationsUpdate: (ctx, p) => ({ location: kindUpdate(ctx, 'location', p) }),
  locationsDelete: (ctx, p) => kindDelete(ctx, 'location', p),
  locationsKiosk: locationsKiosk,
  departmentsList: (ctx, p) => ({ departments: kindList(ctx, 'department', p) }),
  departmentsAdd: (ctx, p) => ({ department: kindAdd(ctx, 'department', p) }),
  departmentsUpdate: (ctx, p) => ({ department: kindUpdate(ctx, 'department', p) }),
  departmentsDelete: (ctx, p) => kindDelete(ctx, 'department', p),
  titlesList: (ctx, p) => ({ titles: kindList(ctx, 'title', p) }),
  titlesAdd: (ctx, p) => ({ title: kindAdd(ctx, 'title', p) }),
  titlesUpdate: (ctx, p) => ({ title: kindUpdate(ctx, 'title', p) }),
  titlesDelete: (ctx, p) => kindDelete(ctx, 'title', p),
  gradesList: (ctx, p) => ({ grades: kindList(ctx, 'grade', p) }),
  gradesAdd: (ctx, p) => ({ grade: kindAdd(ctx, 'grade', p) }),
  gradesUpdate: (ctx, p) => ({ grade: kindUpdate(ctx, 'grade', p) }),
  gradesDelete: (ctx, p) => kindDelete(ctx, 'grade', p),
  costCentersList: (ctx, p) => ({ cost_centers: kindList(ctx, 'cost_center', p) }),
  costCentersAdd: (ctx, p) => ({ cost_center: kindAdd(ctx, 'cost_center', p) }),
  costCentersUpdate: (ctx, p) => ({ cost_center: kindUpdate(ctx, 'cost_center', p) }),
  costCentersDelete: (ctx, p) => kindDelete(ctx, 'cost_center', p),
  employmentTypesList: (ctx, p) => ({ employment_types: kindList(ctx, 'employment_type', p) }),
  employmentTypesAdd: (ctx, p) => ({ employment_type: kindAdd(ctx, 'employment_type', p) }),
  employmentTypesUpdate: (ctx, p) => ({ employment_type: kindUpdate(ctx, 'employment_type', p) }),
  employmentTypesDelete: (ctx, p) => kindDelete(ctx, 'employment_type', p),
};
