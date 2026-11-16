/**
 * The company globe on the admin Home (home-reports module): what each
 * office holds right now, read inside home.admin (one request for the page).
 *
 *   offices   one per entity; with a single entity, one per location (and
 *             one for the entity's people without a location). Each sits at
 *             its location's coordinates when they are set, else at the
 *             centre of its region or country (lib_home_geo), in its time
 *             zone, with headcount (distinct people in work today), in now,
 *             remote and on leave today (the time module's board for each
 *             entity's own today; without time access in now and remote are
 *             null and on leave comes from approved leave), clock-ins of the
 *             last 30 minutes, open roles and the next pay day (with payroll
 *             access).
 *   next_pay  the soonest pay day of every schedule the caller may see, with
 *             the moment it starts in that entity's zone.
 *   payroll_month  gross plus employer cost of this month's calculated,
 *             approved, locked and paid runs, in the reporting currency at
 *             today's rate (each pay currency's own total when a rate is
 *             missing); only when the caller may see pay.
 *   floors    the office view: one floor per entity (head first) with its
 *             city, time zone and local time, counts, and its departments
 *             with their people (employee number, name, title, state:
 *             in_now, remote, on_leave, late, not_in, or unknown without
 *             access to Time; minutes late; minutes since today's clock-in).
 *             At most PEOPLE_CAP people in all; the rest are counted in
 *             each floor's `more`.
 *
 * Every query is bounded by the caller's entity scope.
 */
let _m = {};
function L(n) {
  if (_m[n] === undefined) _m[n] = require(`${__hooks}/${n}.js`);
  return _m[n];
}
const u = () => L('lib_util');

/** Clock-ins this recent count as live on the globe (pulse rings). */
const RECENT_MIN = 30;
/** People drawn in the office view at most (the rest are counted per floor). */
const PEOPLE_CAP = 300;
/** Today's clock-ins looked back this far for minutes since clock-in. */
const SINCE_HOURS = 16;

function hasCoords(l) {
  return !(Number(l.lat) === 0 && Number(l.lng) === 0);
}

function inList(ids, bind, col, prefix) {
  return col + ' IN (' + ids.map((id, i) => ((bind[prefix + i] = id), '{:' + prefix + i + '}')).join(',') + ')';
}

/**
 * o: { pop (lib_reports population today, in scope), pay (Home's pay panel
 * or null), payVisible, reporting (currency), today }.
 */
function globe(ctx, o) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  const geo = L('lib_home_geo');
  const countries = L('lib_countries');
  const sc = auth.scope(ctx);
  const ents = util
    .rows(app, "SELECT id, name, code, country, region, timezone, COALESCE(json_extract(address, '$.city'), '') AS city FROM entities WHERE active = TRUE ORDER BY created", { id: '', name: '', code: '', country: '', region: '', timezone: '', city: '' })
    .filter((e) => sc.length === 0 || sc.indexOf(e.id) >= 0);
  if (ents.length === 0) return null;
  const byEnt = {};
  for (const e of ents) byEnt[e.id] = e;
  const locs = util
    .rows(app, 'SELECT id, entity, name, country, region, timezone, lat, lng FROM locations WHERE archived = FALSE ORDER BY created', { id: '', entity: '', name: '', country: '', region: '', timezone: '', lat: -0, lng: -0 })
    .filter((l) => byEnt[l.entity] !== undefined);
  const mode = ents.length === 1 ? 'locations' : 'entities';
  const pop = o.pop || [];

  const perLoc = {};
  for (const r of pop) if (r.location !== '') perLoc[r.location] = (perLoc[r.location] || 0) + 1;
  const zoneOf = (e) => e.timezone || ((countries.info(e.country) || {}).timezone || 'UTC');
  const placeOfEntity = (e) => {
    const mine = locs.filter((l) => l.entity === e.id && hasCoords(l)).sort((a, b) => (perLoc[b.id] || 0) - (perLoc[a.id] || 0));
    if (mine.length > 0) return { lat: mine[0].lat, lng: mine[0].lng, source: 'location' };
    return geo.centre(e.country, e.region) || { lat: 0, lng: 0, source: 'none' };
  };
  const placeOfLocation = (l, e) => {
    if (hasCoords(l)) return { lat: l.lat, lng: l.lng, source: 'location' };
    const other = l.country !== '' && l.country !== e.country;
    return geo.centre(other ? l.country : e.country, l.region !== '' ? l.region : other ? '' : e.region) || placeOfEntity(e);
  };

  const offices = [];
  const officeOf = {};
  const add = (x) => {
    const box = Object.assign(x, { headcount: 0, in_now: 0, remote: 0, on_leave: 0, open_roles: 0, ins_recent: 0, last_in: '', next_pay: '' });
    offices.push(box);
    officeOf[box.key] = box;
    return box;
  };
  const entityOffice = (e) => {
    const key = 'e:' + e.id;
    if (officeOf[key] !== undefined) return officeOf[key];
    const p = placeOfEntity(e);
    return add({ key: key, kind: 'entity', id: e.id, entity: e.id, entity_name: e.name, name: e.name, code: e.code, country: e.country, lat: p.lat, lng: p.lng, source: p.source, timezone: zoneOf(e) });
  };
  if (mode === 'entities') for (const e of ents) entityOffice(e);
  else {
    const e = ents[0];
    for (const l of locs) {
      if (!hasCoords(l) && !perLoc[l.id]) continue;
      const p = placeOfLocation(l, e);
      add({ key: 'l:' + l.id, kind: 'location', id: l.id, entity: e.id, entity_name: e.name, name: l.name, code: '', country: l.country !== '' ? l.country : e.country, lat: p.lat, lng: p.lng, source: p.source, timezone: l.timezone || zoneOf(e) });
    }
  }
  /** The office of a person (or an opening) at an entity and location. */
  const officeFor = (entity, location) => {
    const e = byEnt[entity];
    if (e === undefined) return null;
    if (mode === 'locations' && location !== '' && officeOf['l:' + location] !== undefined) return officeOf['l:' + location];
    return entityOffice(e);
  };

  /* headcount: distinct people in work today */
  const seen = {};
  const officeOfEmployment = {};
  for (const r of pop) {
    const box = officeFor(r.entity, r.location);
    if (box === null) continue;
    officeOfEmployment[r.employment] = box;
    const s = seen[box.key] || (seen[box.key] = {});
    if (!s[r.employee]) {
      s[r.employee] = true;
      box.headcount++;
    }
  }

  /* in now, remote, on leave: the time module's board for each entity's own today */
  const timeView = ctx.isAgent || auth.can(ctx, 'time', 'view');
  // Each person's state for the office view (employment id -> { state, late }).
  const stateOf = {};
  if (timeView) {
    for (const e of ents) {
      const b = L('lib_ops').runAs(ctx, 'attendance.board', { entity: e.id });
      for (const row of b.people || []) {
        const st = row.state === 'in' || row.state === 'break' ? 'in_now' : row.state === 'remote' || row.state === 'on_duty' ? 'remote' : row.state === 'on_leave' ? 'on_leave' : row.state === 'late' ? 'late' : 'not_in';
        stateOf[row.employment] = { state: st, late: row.late_min || 0 };
        const box = officeFor(row.entity || e.id, row.location || '');
        if (box === null) continue;
        officeOfEmployment[row.employment] = officeOfEmployment[row.employment] || box;
        if (st === 'in_now') box.in_now++;
        else if (st === 'remote') box.remote++;
        else if (st === 'on_leave') box.on_leave++;
      }
    }
    // Clock-ins of the last half hour mark live offices.
    const since = new Date(Date.now() - RECENT_MIN * 60000).toISOString().replace('T', ' ');
    for (const c of util.rows(app, "SELECT employment, at FROM checkins WHERE voided = FALSE AND kind = 'in' AND at >= {:s} ORDER BY at", { employment: '', at: '' }, { s: since })) {
      const box = officeOfEmployment[c.employment];
      if (box === undefined) continue;
      box.ins_recent++;
      if (c.at > box.last_in) box.last_in = c.at;
    }
  } else {
    for (const box of offices) {
      box.in_now = null;
      box.remote = null;
      box.ins_recent = null;
    }
    for (const e of ents) {
      const bind = { d: util.today(app, e.id), e: e.id };
      for (const r of util.rows(app, "SELECT DISTINCT r.employment AS employment FROM leave_requests r JOIN employments m ON m.id = r.employment WHERE m.entity = {:e} AND r.status IN ('approved', 'cancelling') AND [[r.start]] <= {:d} AND [[r.end]] >= {:d}", { employment: '' }, bind)) {
        stateOf[r.employment] = { state: 'on_leave', late: 0 };
        const box = officeOfEmployment[r.employment];
        if (box !== undefined) box.on_leave++;
      }
    }
  }

  /* open roles */
  const rb = {};
  for (const r of util.rows(app, "SELECT o.entity AS entity, COALESCE(o.location, '') AS location, CAST(COALESCE(SUM(CASE WHEN o.positions > 0 THEN o.positions ELSE 1 END), 0) AS INTEGER) AS n FROM openings o WHERE o.status = 'open' AND " + inList(ents.map((e) => e.id), rb, 'o.entity', 'oe') + ' GROUP BY o.entity, o.location', { entity: '', location: '', n: 0 }, rb)) {
    const box = officeFor(r.entity, r.location);
    if (box !== null) box.open_roles += r.n;
  }

  /* next pay day (from the pay panel the caller may see) */
  let next = null;
  if (o.pay !== null && o.pay !== undefined) {
    for (const s of o.pay.schedules) {
      if (s.pay_date === '' || byEnt[s.entity] === undefined) continue;
      for (const box of offices) if (box.entity === s.entity && (box.next_pay === '' || s.pay_date < box.next_pay)) box.next_pay = s.pay_date;
      if (next === null || s.pay_date < next.day) next = { day: s.pay_date, entity: s.entity, entity_name: s.entity_name, schedule: s.name, days: s.days_to_pay, people: s.people };
    }
    if (next !== null) next.at = new Date(util.utcOf(zoneOf(byEnt[next.entity]), next.day, '00:00')).toISOString();
  }

  /* payroll this month */
  let month = null;
  if (o.payVisible) {
    const m = o.today.slice(0, 7);
    const mb = { a: m + '-01', b: util.monthEnd(m + '-01') };
    const rows = util.rows(
      app,
      "SELECT s.currency AS currency, CAST(COALESCE(SUM(s.gross_minor), 0) AS INTEGER) AS gross, CAST(COALESCE(SUM(s.employer_minor), 0) AS INTEGER) AS employer, COUNT(DISTINCT s.payrun) AS runs, COUNT(DISTINCT CASE WHEN pr.status IN ('locked', 'paid') THEN s.payrun END) AS locked FROM payslips s JOIN payruns pr ON pr.id = s.payrun WHERE pr.status IN ('calculated', 'approved', 'locked', 'paid') AND s.status != 'void' AND s.pay_date >= {:a} AND s.pay_date <= {:b} AND " +
        inList(ents.map((e) => e.id), mb, 's.entity', 'pe') +
        ' GROUP BY s.currency',
      { currency: '', gross: 0, employer: 0, runs: 0, locked: 0 },
      mb,
    );
    let total = 0;
    let missing = false;
    for (const r of rows) {
      const v = L('lib_reports').toReporting(app, r.gross + r.employer, r.currency, o.reporting, o.today);
      if (v === null) missing = true;
      else total += v;
    }
    month = {
      month: m,
      currency: o.reporting,
      minor: rows.length > 0 && !missing ? total : null,
      parts: rows.map((r) => ({ currency: r.currency, minor: r.gross + r.employer })).sort((x, y) => y.minor - x.minor),
      runs: rows.reduce((a, r) => a + r.runs, 0),
      locked: rows.reduce((a, r) => a + r.locked, 0),
    };
  }

  const floors = floorsOf(ctx, ents, pop, stateOf, timeView, zoneOf);
  const sum = (k) => (timeView || (k !== 'in_now' && k !== 'remote') ? offices.reduce((a, x) => a + (x[k] || 0), 0) : null);
  let head = offices[0] || null;
  if (mode === 'entities') head = officeOf['e:' + ents[0].id] || head;
  else for (const x of offices) if (head === null || x.headcount > head.headcount) head = x;
  return {
    mode: mode,
    head: head !== null ? head.key : '',
    time_visible: timeView,
    offices: offices,
    totals: { in_now: sum('in_now'), remote: sum('remote'), on_leave: sum('on_leave'), open_roles: sum('open_roles') },
    next_pay: next,
    payroll_month: month,
    floors: floors,
  };
}

/**
 * The office view: one floor per entity in scope (head first), each with its
 * departments and their people in work today, in name order (so a desk keeps
 * its place as states change).
 */
function floorsOf(ctx, ents, pop, stateOf, timeView, zoneOf) {
  const util = u();
  const app = ctx.app;
  const names = L('lib_reports').namer(app);
  const now = Date.now();
  // Minutes since each person's latest clock-in today.
  const sinceOf = {};
  if (timeView) {
    const from = new Date(now - SINCE_HOURS * 3600000).toISOString().replace('T', ' ');
    for (const c of util.rows(app, "SELECT employment, MAX(at) AS at FROM checkins WHERE voided = FALSE AND kind = 'in' AND at >= {:s} GROUP BY employment", { employment: '', at: '' }, { s: from })) {
      const t = Date.parse(String(c.at).replace(' ', 'T'));
      if (Number.isFinite(t)) sinceOf[c.employment] = Math.max(0, Math.round((now - t) / 60000));
    }
  }
  const firstLoc = {};
  for (const l of util.rows(app, 'SELECT entity, name FROM locations WHERE archived = FALSE ORDER BY created', { entity: '', name: '' })) if (firstLoc[l.entity] === undefined) firstLoc[l.entity] = l.name;
  let left = PEOPLE_CAP;
  return ents.map((e) => {
    const zone = zoneOf(e);
    const depts = {};
    const order = [];
    const seen = {};
    const f = { entity: e.id, name: e.name, code: e.code, country: e.country, city: e.city !== '' ? e.city : firstLoc[e.id] || '', timezone: zone, local_time: util.localAt(zone, now).time, headcount: 0, in_now: timeView ? 0 : null, remote: timeView ? 0 : null, on_leave: 0, departments: [], more: 0 };
    for (const r of pop) {
      if (r.entity !== e.id || seen[r.employee]) continue;
      seen[r.employee] = true;
      const st = stateOf[r.employment] || { state: timeView ? 'not_in' : 'unknown', late: 0 };
      f.headcount++;
      if (st.state === 'in_now') f.in_now++;
      else if (st.state === 'remote') f.remote++;
      else if (st.state === 'on_leave') f.on_leave++;
      if (left <= 0) {
        f.more++;
        continue;
      }
      left--;
      const key = r.department || '';
      if (depts[key] === undefined) {
        depts[key] = { id: key, name: key !== '' ? names.department(key) : '', people: [] };
        order.push(key);
      }
      depts[key].people.push({ id: names.employee(r.employee).number, name: r.name, title: r.title, state: st.state, late_min: st.late, since_min: st.state === 'in_now' && sinceOf[r.employment] !== undefined ? sinceOf[r.employment] : null });
    }
    // Rooms in name order, people without a department last.
    f.departments = order.map((k) => depts[k]).sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return f;
  });
}

module.exports = { globe: globe, RECENT_MIN: RECENT_MIN, PEOPLE_CAP: PEOPLE_CAP };
