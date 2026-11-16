/// <reference path="../pb_data/types.d.ts" />
/**
 * Clocking in and out: the employee's own clock (web or phone, with an
 * optional location snapshot taken only at the punch, flagged when outside
 * the location's geofence and never blocked), the shared kiosk tablet
 * (a device started by HR, then each person picks their name and types a
 * personal 4 to 6 digit kiosk PIN, with or without a member account), and
 * punch corrections by HR or a manager (a correction never edits a punch:
 * it adds one, or voids one with a reason).
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

const KINDS = ['in', 'out', 'break_start', 'break_end'];
const KIND_LABEL = { in: 'Clock in', out: 'Clock out', break_start: 'Start break', break_end: 'End break' };
const DOUBLE_TAP_MS = 90000;
const PIN_FAILS = 5;
const PIN_LOCK_MIN = 15;

/** Distance in metres between two points (haversine). */
function metres(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dlat = (lat2 - lat1) * rad;
  const dlng = (lng2 - lng1) * rad;
  const a = Math.sin(dlat / 2) * Math.sin(dlat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlng / 2) * Math.sin(dlng / 2);
  return Math.round(2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function geofenceOf(loc) {
  if (loc === null) return null;
  const lat = loc.getFloat('lat');
  const lng = loc.getFloat('lng');
  const radius = loc.getInt('radius_m');
  if (radius <= 0 || (lat === 0 && lng === 0)) return null;
  return { lat: lat, lng: lng, radius_m: radius };
}

function locationBrief(loc) {
  if (loc === null) return null;
  const g = geofenceOf(loc);
  return { id: loc.id, name: loc.getString('name'), lat: g ? g.lat : null, lng: g ? g.lng : null, radius_m: g ? g.radius_m : 0, geofence: g !== null };
}

/** The next punches allowed from a state; the first is the main one. */
function nextKinds(state) {
  if (state === 'in') return ['out', 'break_start'];
  if (state === 'break') return ['break_end', 'out'];
  return ['in'];
}

/** What an employee's clock shows: today's plan, punches, state, next actions, the location to check against. */
function statusFor(app, m) {
  const util = u();
  const t = T();
  const R = t.resolver(app);
  const id = m.id;
  const today = R.today(id);
  const plan = t.planOf(R, id, today);
  const zone = plan.zone;
  const st = t.clockState(app, id);
  const yesterday = util.dayAdd(today, -1);
  const rows = util.findMany(app, 'checkins', 'employment = {:e} && day >= {:f} && day <= {:t}', 'at,created', 0, { e: id, f: yesterday, t: today });
  const views = rows.map((r) => t.checkinView(r, zone));
  // An open session that began yesterday (a night shift) belongs on today's clock too.
  let fromMs = util.utcOf(zone, today, '00:00');
  if (st.state !== 'out' && st.last !== null) {
    const live = rows.filter((r) => !r.getBool('voided'));
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].getString('kind') === 'in') {
        fromMs = Math.min(fromMs, t.ms(live[i].getString('at')));
        break;
      }
    }
  }
  const shown = views.filter((v) => t.ms(v.at) >= fromMs);
  const live = rows.filter((r) => !r.getBool('voided') && t.ms(r.getString('at')) >= fromMs).map((r) => ({ id: r.id, t: t.ms(r.getString('at')), kind: r.getString('kind'), flagged: r.getBool('flagged') }));
  let worked = 0;
  let breakMs = 0;
  const now = Date.now();
  for (const s of t.sessionsOf(live)) {
    if (s.orphan) continue;
    const end = s.out !== null ? s.out : now;
    let b = 0;
    for (const br of s.breaks) b += Math.max(0, br[1] - br[0]);
    if (s.brk !== null && s.out === null) b += Math.max(0, now - s.brk);
    breakMs += b;
    worked += Math.max(0, end - s.in - b);
  }
  const loc = R.location(plan.location);
  const lv = R.leaveOn(id, today);
  const att = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: id, d: today });
  const ent = R.entity(m.getString('entity'));
  const emps = util
    .rows(app, "SELECT id, number, entity FROM employments WHERE employee = {:e} AND start_day <= {:d} AND (end_day = '' OR end_day >= {:d}) ORDER BY [[primary]] DESC, start_day", { id: '', number: '', entity: '' }, { e: m.getString('employee'), d: today })
    .map((x) => {
      const en = R.entity(x.entity);
      return { id: x.id, number: x.number, entity: x.entity, entity_name: en ? en.getString('name') : '' };
    });
  const pin = util.findOne(app, 'kiosk_pins', 'employee = {:e}', { e: m.getString('employee') });
  return {
    employment: { id: id, number: m.getString('number'), entity: m.getString('entity'), entity_name: ent ? ent.getString('name') : '' },
    employments: emps,
    today: today,
    zone: zone,
    now: util.nowIso(),
    time: util.localAt(zone, now).time,
    plan: {
      kind: plan.kind,
      source: plan.source,
      shift_type: plan.shift_type,
      shift_name: plan.shift_name,
      start: plan.start,
      end: plan.end,
      overnight: plan.overnight,
      break_min: plan.break_min,
      expected_min: plan.expected_min,
      holiday: plan.holiday,
      leave: lv !== null ? { type: lv.type, name: lv.name, half: lv.half, hours: lv.hours } : null,
    },
    state: st.state,
    since: st.since,
    since_time: st.since ? t.localTime(zone, t.ms(st.since)) : '',
    next: nextKinds(st.state),
    punches: shown,
    worked_min: Math.round(worked / 60000),
    break_min: Math.round(breakMs / 60000),
    location: locationBrief(loc),
    ask_location: geofenceOf(loc) !== null,
    attendance: att !== null ? t.attendanceView(att, zone) : null,
    kiosk_pin: pin !== null,
  };
}

/** Save one punch and recompute the days it touches. o: { kind, at (ms), source, lat, lng, accuracy, note, device, location, by_member, flags }. */
function addPunch(app, m, o) {
  const util = u();
  const t = T();
  const R = t.resolver(app);
  const at = o.at;
  const zone = R.zone(m.id, util.localAt(R.zone(m.id, util.today(app, m.getString('entity'))), at).day);
  const day = util.localAt(zone, at).day;
  // A punch is a fact and is never refused: on a day a locked run used, the
  // difference becomes an adjustment for the next run (lib_time.noteAfterLock).
  const plan = t.planOf(R, m.id, day);
  const locId = o.location || plan.location;
  const loc = R.location(locId);
  const flags = (o.flags || []).slice();
  let flagged = false;
  let distance = 0;
  const g = geofenceOf(loc);
  if (o.lat !== null && o.lat !== undefined && o.lng !== null && o.lng !== undefined) {
    if (g !== null) {
      distance = metres(o.lat, o.lng, g.lat, g.lng);
      const slack = Math.min(Math.max(Number(o.accuracy) || 0, 0), 200);
      if (distance > g.radius_m + slack) {
        flagged = true;
        flags.push('outside_geofence');
      }
    }
  } else if (g !== null && o.source !== 'kiosk' && o.source !== 'manual' && o.source !== 'request' && o.source !== 'import') flags.push('no_location');
  const r = util.newRecord(app, 'checkins');
  r.set('employment', m.id);
  r.set('at', t.iso(at));
  r.set('day', day);
  r.set('kind', o.kind);
  r.set('source', o.source);
  if (loc !== null) r.set('location', loc.id);
  if (o.lat !== null && o.lat !== undefined) r.set('lat', Math.round(Number(o.lat) * 1e6) / 1e6);
  if (o.lng !== null && o.lng !== undefined) r.set('lng', Math.round(Number(o.lng) * 1e6) / 1e6);
  if (o.accuracy) r.set('accuracy_m', Math.max(0, Math.round(Number(o.accuracy))));
  r.set('distance_m', distance);
  r.set('flagged', flagged);
  r.set('flags', flags);
  r.set('note', util.clip(o.note || '', 500));
  r.set('device', util.clip(o.device || '', 120));
  if (o.by_member) r.set('by_member', o.by_member);
  if (o.replaces) r.set('replaces', o.replaces);
  r.set('voided', false);
  app.save(r);
  recomputeAround(app, m.id, day, o.kind);
  return r;
}

/** Recompute a punch's day, and the day before when the punch may close a night shift. */
function recomputeAround(app, empId, day, kind) {
  const t = T();
  if (kind !== 'in') t.processRange(app, empId, u().dayAdd(day, -1), day);
  else t.processDay(app, empId, day);
}

/* --------------------------------------------------------- own clock */

function clockStatus(ctx, p) {
  const m = T().selfEmployment(ctx, u().str(p, 'employment', ''));
  return statusFor(ctx.app, m);
}

function clockPunch(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = t.selfEmployment(ctx, util.str(p, 'employment', ''));
  if (m.getString('status') === 'ended') throw util.fail(409, 'This employment has ended.', 'ended');
  const st = t.clockState(app, m.id);
  const allowed = nextKinds(st.state);
  const kind = util.oneOf(p, 'kind', KINDS, '') || allowed[0];
  if (allowed.indexOf(kind) < 0) {
    const msg = st.state === 'in' ? 'You are already clocked in.' : st.state === 'break' ? 'You are on a break: end it first.' : 'You are not clocked in.';
    throw util.fail(409, msg, 'invalid_punch', { state: st.state, next: allowed, status: statusFor(app, m) });
  }
  const now = Date.now();
  if (st.last !== null && st.last.getString('kind') === kind && now - t.ms(st.last.getString('at')) < DOUBLE_TAP_MS) {
    return { punch: t.checkinView(st.last, t.resolver(app).zone(m.id, st.last.getString('day'))), repeated: true, status: statusFor(app, m) };
  }
  const lat = util.num(p, 'lat', { min: -90, max: 90 });
  const lng = util.num(p, 'lng', { min: -180, max: 180 });
  let rec = null;
  app.runInTransaction((tx) => {
    rec = addPunch(tx, tx.findRecordById('employments', m.id), {
      kind: kind,
      at: now,
      source: util.oneOf(p, 'source', ['web', 'phone'], 'web'),
      lat: lat,
      lng: lat === null ? null : lng,
      accuracy: util.num(p, 'accuracy_m', { min: 0, max: 100000 }),
      note: util.text(p, 'note', 500, ''),
      device: util.text(p, 'device', 120, ''),
      by_member: ctx.memberId,
    });
  });
  const status = statusFor(app, m);
  L('lib_audit').note(ctx, { collection: 'checkins', record: rec.id, summary: KIND_LABEL[kind] + ' at ' + status.time + (rec.getBool('flagged') ? ' (outside the location area)' : '') });
  return { punch: t.checkinView(rec, status.zone), repeated: false, status: status };
}

const UNDO_MS = 5 * 60000;

/** clock.undo: take back your own latest punch within five minutes of it (kept in history as taken out). */
function clockUndo(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const rec = util.byId(app, 'checkins', util.req(p, 'punch'));
  if (rec === null) throw util.fail(404, 'No such punch.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  if (ctx.employeeId === '' || m.getString('employee') !== ctx.employeeId) throw util.fail(403, 'You can undo only your own punch.', 'not_permitted');
  if (rec.getBool('voided')) return { undone: true, status: statusFor(app, m) };
  const st = t.clockState(app, m.id);
  if (st.last === null || st.last.id !== rec.id) throw util.fail(409, 'Only your latest punch can be undone. Ask your manager to fix older ones.', 'conflict');
  if (Date.now() - t.ms(rec.getString('created')) > UNDO_MS) throw util.fail(409, 'A punch can be undone only in the first five minutes. Ask your manager to fix it.', 'too_late');
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('checkins', rec.id);
    r.set('voided', true);
    r.set('void_reason', 'Undone by the person right after the punch');
    tx.save(r);
    recomputeAround(tx, m.id, rec.getString('day'), rec.getString('kind'));
  });
  L('lib_audit').note(ctx, { collection: 'checkins', record: rec.id, summary: 'Undid a punch (' + KIND_LABEL[rec.getString('kind')] + ') right after it' });
  return { undone: true, status: statusFor(app, m) };
}

/* -------------------------------------------------------- corrections */

function readLocalInstant(R, m, p) {
  const util = u();
  const day = util.day(p, 'day', '');
  if (day === '') throw util.fail(400, 'day is required (YYYY-MM-DD).', 'missing_param', { param: 'day' });
  const time = util.str(p, 'time', '');
  if (!util.isTime(time)) throw util.fail(400, 'time is the local time HH:MM, e.g. 09:00.', 'invalid_param', { param: 'time' });
  const zone = R.zone(m.id, day);
  const at = util.utcOf(zone, day, time);
  if (at > Date.now() + 5 * 60000) throw util.fail(400, 'A punch cannot be in the future.', 'invalid_param', { param: 'time' });
  return { day: day, time: time, at: at, zone: zone };
}

/** checkins.add: a punch added by HR, a manager, or (as a proposal) your AI agent. */
function checkinsAdd(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = L('lib_people').employmentRef(app, util.req(p, 'employment'));
  t.needEdit(ctx, m, 'correct this person\'s punches');
  const R = t.resolver(app);
  const w = readLocalInstant(R, m, p);
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind === '') throw util.fail(400, 'kind is one of ' + KINDS.join(', '), 'missing_param', { param: 'kind' });
  const note = util.text(p, 'note', 500, '');
  if (note === '') throw util.fail(400, 'Say why in note (for example: "forgot to clock out, left at 18:00").', 'missing_param', { param: 'note' });
  let rec = null;
  app.runInTransaction((tx) => {
    rec = addPunch(tx, tx.findRecordById('employments', m.id), { kind: kind, at: w.at, source: ctx.isAgent ? 'agent' : 'manual', note: note, by_member: ctx.memberId, flags: ['correction'] });
  });
  const att = util.findOne(app, 'attendance', 'employment = {:e} && day = {:d}', { e: m.id, d: w.day });
  const kept = att !== null && att.getString('source') !== 'auto';
  L('lib_audit').note(ctx, { collection: 'checkins', record: rec.id, summary: 'Added a punch (' + KIND_LABEL[kind] + ' ' + w.time + ') on ' + w.day + ' for ' + m.getString('number') + ': ' + note });
  return { punch: t.checkinView(rec, w.zone), attendance: att !== null ? t.attendanceView(att, w.zone) : null, kept_manual: kept, message: kept ? 'The day was set by hand, so its attendance did not change. Run attendance.reset to follow the punches again.' : '' };
}

function previewCheckinAdd(ctx, p) {
  const util = u();
  const m = L('lib_people').employmentRef(ctx.app, util.str(p, 'employment', ''));
  const emp = ctx.app.findRecordById('employees', m.getString('employee'));
  return { label: 'Add a punch for ' + L('lib_people').displayName(emp), target: 'employments:' + m.id, fields: [{ name: 'punch on ' + util.str(p, 'day', ''), before: '', after: (KIND_LABEL[util.str(p, 'kind', '')] || util.str(p, 'kind', '')) + ' ' + util.str(p, 'time', '') }], notes: [util.str(p, 'note', '')].filter((x) => x !== ''), risk: 'low' };
}

/** checkins.void: take a wrong punch out (kept in history with the reason). */
function checkinsVoid(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const rec = util.byId(app, 'checkins', util.req(p, 'checkin'));
  if (rec === null) throw util.fail(404, 'No such punch. Run checkins.list.', 'not_found');
  const m = app.findRecordById('employments', rec.getString('employment'));
  t.needEdit(ctx, m, 'correct this person\'s punches');
  if (rec.getBool('voided')) throw util.fail(409, 'This punch is already taken out.', 'conflict');
  const reason = util.text(p, 'reason', 500, '');
  if (reason === '') throw util.fail(400, 'Say why in reason.', 'missing_param', { param: 'reason' });
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('checkins', rec.id);
    r.set('voided', true);
    r.set('void_reason', reason);
    if (ctx.memberId) r.set('voided_by', ctx.memberId);
    r.set('voided_at', util.nowIso());
    tx.save(r);
    recomputeAround(tx, m.id, rec.getString('day'), rec.getString('kind'));
  });
  L('lib_audit').note(ctx, { collection: 'checkins', record: rec.id, summary: 'Took out a punch (' + KIND_LABEL[rec.getString('kind')] + ') on ' + rec.getString('day') + ' for ' + m.getString('number') + ': ' + reason });
  const zone = t.resolver(app).zone(m.id, rec.getString('day'));
  return { punch: t.checkinView(app.findRecordById('checkins', rec.id), zone) };
}

function previewCheckinVoid(ctx, p) {
  const util = u();
  const t = T();
  const rec = util.byId(ctx.app, 'checkins', util.str(p, 'checkin', ''));
  if (rec === null) return { label: 'Take out a punch', fields: [], notes: ['That punch no longer exists.'], risk: 'low' };
  const zone = t.resolver(ctx.app).zone(rec.getString('employment'), rec.getString('day'));
  const v = t.checkinView(rec, zone);
  return { label: 'Take out a punch on ' + v.day, target: 'checkins:' + rec.id, fields: [{ name: 'punch', before: KIND_LABEL[v.kind] + ' ' + v.time, after: 'taken out' }], notes: [util.str(p, 'reason', '')].filter((x) => x !== ''), risk: 'low' };
}

/** checkins.list: punches of one person between two days (corrections and voided ones included). */
function checkinsList(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const m = t.employmentFor(ctx, util.str(p, 'employment', ''));
  const R = t.resolver(app);
  const today = R.today(m.id);
  const from = util.day(p, 'from', util.dayAdd(today, -6));
  const to = util.day(p, 'to', today);
  if (util.daysBetween(from, to) > 120) throw util.fail(400, 'Ask for at most 120 days at a time.', 'invalid_param');
  const voided = util.bool(p, 'voided', true);
  const rows = util.findMany(app, 'checkins', 'employment = {:e} && day >= {:f} && day <= {:t}' + (voided ? '' : ' && voided = false'), 'at,created', 0, { e: m.id, f: from, t: to });
  const locs = {};
  return {
    employment: m.id,
    from: from,
    to: to,
    punches: rows.map((r) => {
      const v = t.checkinView(r, R.zone(m.id, r.getString('day')));
      const l = v.location;
      if (l && locs[l] === undefined) {
        const lr = R.location(l);
        locs[l] = lr ? lr.getString('name') : '';
      }
      v.location_name = l ? locs[l] : '';
      return v;
    }),
  };
}

/** checkins.flagged: punches outside a location's area, newest first (for review; never blocked). */
function checkinsFlagged(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const today = util.today(app);
  const from = util.day(p, 'from', util.dayAdd(today, -13));
  const to = util.day(p, 'to', today);
  const people = t.roster(ctx, from, to, { entity: util.str(p, 'entity', ''), team: util.bool(p, 'team', false) });
  const byId = {};
  for (const r of people) byId[r.employment] = r;
  const ids = Object.keys(byId);
  if (ids.length === 0) return { punches: [], from: from, to: to };
  const bind = { f: from, t: to };
  const keys = ids.map((id, i) => ((bind['i' + i] = id), '{:i' + i + '}'));
  const rows = util.rows(app, 'SELECT id FROM checkins WHERE flagged = TRUE AND voided = FALSE AND day >= {:f} AND day <= {:t} AND employment IN (' + keys.join(',') + ') ORDER BY at DESC LIMIT 300', { id: '' }, bind);
  const R = t.resolver(app);
  return {
    from: from,
    to: to,
    punches: rows.map((x) => {
      const r = app.findRecordById('checkins', x.id);
      const v = t.checkinView(r, R.zone(r.getString('employment'), r.getString('day')));
      const who = byId[v.employment];
      v.name = who ? who.name : '';
      v.number = who ? who.number : '';
      const l = R.location(v.location);
      v.location_name = l ? l.getString('name') : '';
      return v;
    }),
  };
}

/* ------------------------------------------------------------- kiosk */

function locationByCode(app, code) {
  const util = u();
  const c = String(code || '')
    .trim()
    .toUpperCase();
  if (c === '') throw util.fail(400, 'This kiosk needs its location code in the address (#/time/kiosk/<code>).', 'missing_param', { param: 'code' });
  const loc = util.findOne(app, 'locations', 'kiosk_code = {:c} && archived = false', { c: c });
  if (loc === null) throw util.fail(404, 'No location has the kiosk code ' + c + '. Ask HR for the current kiosk link.', 'kiosk_unknown');
  return loc;
}

/** The kiosk tablet's token: the X-Kiosk-Device header (kept out of query strings and logs). */
function kioskToken(ctx) {
  try {
    return String((ctx.e && ctx.e.request && ctx.e.request.header.get('X-Kiosk-Device')) || '');
  } catch {
    return '';
  }
}

/** The kiosk device (by its token) of a location, or a 401 the kiosk page turns into "start the kiosk here". */
function deviceOf(app, loc, token) {
  const util = u();
  const tok = String(token || '').trim();
  if (tok === '') throw util.fail(403, 'This tablet is not started as a kiosk for ' + loc.getString('name') + '.', 'kiosk_not_started');
  const d = util.findOne(app, 'kiosk_devices', 'token_hash = {:h} && location = {:l}', { h: util.sha(tok), l: loc.id });
  if (d === null || d.getBool('revoked')) throw util.fail(403, 'This tablet is not started as a kiosk for ' + loc.getString('name') + ' (or it was stopped).', 'kiosk_not_started');
  const seen = T().ms(d.getString('last_seen'));
  if (!Number.isFinite(seen) || Date.now() - seen > 5 * 60000) {
    try {
      util.exec(app, 'UPDATE kiosk_devices SET last_seen = {:t} WHERE id = {:id}', { t: util.nowIso().replace('T', ' '), id: d.id });
    } catch {
      /* a courtesy */
    }
  }
  return d;
}

function deviceView(r) {
  return { id: r.id, location: r.getString('location'), name: r.getString('name'), created_by: r.getString('created_by'), last_seen: r.getString('last_seen'), revoked: r.getBool('revoked'), created: r.getString('created') };
}

/** kiosk.start: HR starts this tablet as the location's kiosk; the token is shown once and kept by the page. */
function kioskStart(ctx, p) {
  const util = u();
  const app = ctx.app;
  const org = L('lib_org');
  const ref = util.req(p, 'location');
  let loc = util.findOne(app, 'locations', 'kiosk_code = {:c}', { c: ref.toUpperCase() });
  if (loc === null) loc = org.kindRef(app, 'location', ref);
  if (!L('lib_auth').inScope(ctx, loc.getString('entity'))) throw util.fail(403, 'This location is outside your entities.', 'not_permitted');
  if (loc.getString('kiosk_code') === '') {
    org.locationsKiosk(ctx, { location: loc.id });
    loc = app.findRecordById('locations', loc.id);
  }
  const token = util.token(40);
  const d = util.newRecord(app, 'kiosk_devices');
  d.set('location', loc.id);
  d.set('name', util.text(p, 'name', 80, '') || 'Kiosk ' + (util.count(app, 'SELECT COUNT(*) AS n FROM kiosk_devices WHERE location = {:l}', { l: loc.id }) + 1));
  d.set('token_hash', util.sha(token));
  if (ctx.memberId) d.set('created_by', ctx.memberId);
  d.set('revoked', false);
  app.save(d);
  L('lib_audit').note(ctx, { collection: 'kiosk_devices', record: d.id, summary: 'Started a kiosk tablet (' + d.getString('name') + ') at ' + loc.getString('name') });
  return { device: deviceView(d), token: token, code: loc.getString('kiosk_code'), location: { id: loc.id, name: loc.getString('name') }, link: '#/time/kiosk/' + loc.getString('kiosk_code') };
}

function kioskDevices(ctx, p) {
  const util = u();
  const app = ctx.app;
  const locRef = util.str(p, 'location', '');
  const where = locRef !== '' ? 'location = {:l}' : '1=1';
  const bind = locRef !== '' ? { l: L('lib_org').kindRef(app, 'location', locRef).id } : {};
  const auth = L('lib_auth');
  // Kiosk codes only for people who may start kiosks (as the kernel's location reads).
  const seeCode = ctx.isAgent || auth.can(ctx, 'time', 'edit') || auth.can(ctx, 'admin', 'edit');
  return {
    devices: util
      .findMany(app, 'kiosk_devices', where, '-created', 200, bind)
      .filter((d) => {
        const l = util.byId(app, 'locations', d.getString('location'));
        return l !== null && auth.inScope(ctx, l.getString('entity'));
      })
      .map((d) => {
        const v = deviceView(d);
        const l = util.byId(app, 'locations', v.location);
        v.location_name = l ? l.getString('name') : '';
        if (seeCode) v.code = l ? l.getString('kiosk_code') : '';
        return v;
      }),
  };
}

function kioskStop(ctx, p) {
  const util = u();
  const d = util.byId(ctx.app, 'kiosk_devices', util.req(p, 'device'));
  if (d === null) throw util.fail(404, 'No such kiosk tablet. Run kiosk.devices.', 'not_found');
  const l = util.byId(ctx.app, 'locations', d.getString('location'));
  if (l !== null && !L('lib_auth').inScope(ctx, l.getString('entity'))) throw util.fail(403, 'This kiosk is outside your entities.', 'not_permitted');
  d.set('revoked', true);
  ctx.app.save(d);
  L('lib_audit').note(ctx, { collection: 'kiosk_devices', record: d.id, summary: 'Stopped the kiosk tablet ' + d.getString('name') });
  return { device: deviceView(d) };
}

/** The people a kiosk lists: active at the location's entity, working at the location today (by job or shift) first. */
function kioskPeople(app, loc, all) {
  const util = u();
  const t = T();
  const people = L('lib_people');
  const R = t.resolver(app);
  const entity = loc.getString('entity');
  const today = util.today(app, entity);
  const out = [];
  const shiftHere = {};
  for (const a of util.findMany(app, 'shift_assignments', 'day = {:d}', '', 0, { d: today })) {
    const snap = util.jsonOf(a, 'published', null);
    if (snap && snap.location === loc.id) shiftHere[a.getString('employment')] = true;
  }
  for (const m of people.activeEmployments(app, { entity: entity, from: today, to: today })) {
    const here = R.locationOn(m.id, today) === loc.id || shiftHere[m.id] === true;
    if (!all && !here) continue;
    const st = t.clockState(app, m.id);
    const emp = app.findRecordById('employees', m.employee);
    out.push({ employee: m.employee, employment: m.id, number: m.employee_number, name: m.name, family_name: emp.getString('family_name'), given_name: emp.getString('given_name'), name_order: emp.getString('name_order'), photo: emp.getString('photo') !== '', state: st.state, here: here, has_pin: util.findOne(app, 'kiosk_pins', 'employee = {:e}', { e: m.employee }) !== null });
  }
  out.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  return out;
}

function kioskRoster(ctx, p) {
  const util = u();
  const app = ctx.app;
  const loc = locationByCode(app, util.req(p, 'code'));
  deviceOf(app, loc, kioskToken(ctx));
  const ent = app.findRecordById('entities', loc.getString('entity'));
  const zone = loc.getString('timezone') || ent.getString('timezone') || 'UTC';
  const now = util.localAt(zone, Date.now());
  return { location: { id: loc.id, name: loc.getString('name') }, entity: { id: ent.id, name: ent.getString('name') }, zone: zone, day: now.day, time: now.time, people: kioskPeople(app, loc, util.bool(p, 'all', false)) };
}

function pinSecret(employeeId, pin) {
  return 'hr-kiosk:' + employeeId + ':' + pin;
}

function checkPinFormat(pin) {
  const s = String(pin === undefined || pin === null ? '' : pin).trim();
  if (!/^\d{4,6}$/.test(s)) throw u().fail(400, 'A kiosk PIN is 4 to 6 digits.', 'invalid_pin');
  if (s.split('').every((c) => c === s.charAt(0))) throw u().fail(400, 'Choose a PIN that is not one digit repeated.', 'weak_pin');
  return s;
}

/** Check an employee's kiosk PIN (with lockout); throws on a wrong, missing or locked PIN. */
function verifyKioskPin(app, employeeId, pin) {
  const util = u();
  const v = util.findOne(app, 'kiosk_pins', 'employee = {:e}', { e: employeeId });
  if (v === null) throw util.fail(409, 'No kiosk PIN yet. Set one in Me, or ask HR.', 'kiosk_pin_not_set');
  const until = T().ms(v.getString('locked_until'));
  if (Number.isFinite(until) && until > Date.now()) {
    const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    throw util.fail(423, 'Too many wrong PINs. Try again in ' + mins + (mins === 1 ? ' minute.' : ' minutes.'), 'pin_locked', { minutes: mins });
  }
  const s = String(pin === undefined || pin === null ? '' : pin).trim();
  if (!/^\d{4,6}$/.test(s) || !v.validatePassword(pinSecret(employeeId, s))) {
    const fails = v.getInt('fails') + 1;
    if (fails >= PIN_FAILS) {
      v.set('fails', 0);
      v.set('locked_until', new Date(Date.now() + PIN_LOCK_MIN * 60000).toISOString());
    } else v.set('fails', fails);
    app.save(v);
    const left = Math.max(0, PIN_FAILS - fails);
    throw util.fail(403, left > 0 ? 'That PIN is not right. ' + left + (left === 1 ? ' try left.' : ' tries left.') : 'That PIN is not right. Locked for ' + PIN_LOCK_MIN + ' minutes.', 'wrong_pin', { left: left });
  }
  if (v.getInt('fails') > 0) {
    v.set('fails', 0);
    app.save(v);
  }
}

function kioskPunch(ctx, p) {
  const util = u();
  const t = T();
  const app = ctx.app;
  const loc = locationByCode(app, util.req(p, 'code'));
  const dev = deviceOf(app, loc, kioskToken(ctx));
  const emp = L('lib_people').employeeRef(app, util.req(p, 'employee'));
  const entity = loc.getString('entity');
  const today = util.today(app, entity);
  const row = util.one(app, "SELECT id FROM employments WHERE employee = {:e} AND entity = {:n} AND start_day <= {:d} AND (end_day = '' OR end_day >= {:d}) ORDER BY [[primary]] DESC LIMIT 1", { id: '' }, { e: emp.id, n: entity, d: today });
  if (row === null) throw util.fail(403, 'This person does not work at ' + loc.getString('name') + '\'s company today.', 'not_permitted');
  verifyKioskPin(app, emp.id, util.str(p, 'pin', ''));
  const m = app.findRecordById('employments', row.id);
  const st = t.clockState(app, m.id);
  const allowed = nextKinds(st.state);
  const kind = util.oneOf(p, 'kind', KINDS, '') || allowed[0];
  if (allowed.indexOf(kind) < 0) throw util.fail(409, st.state === 'in' ? 'You are already clocked in.' : st.state === 'break' ? 'You are on a break.' : 'You are not clocked in.', 'invalid_punch', { state: st.state, next: allowed });
  const now = Date.now();
  let rec = null;
  if (st.last !== null && st.last.getString('kind') === kind && now - t.ms(st.last.getString('at')) < DOUBLE_TAP_MS) rec = st.last;
  else {
    app.runInTransaction((tx) => {
      rec = addPunch(tx, tx.findRecordById('employments', m.id), { kind: kind, at: now, source: 'kiosk', lat: loc.getFloat('lat') || null, lng: loc.getFloat('lng') || null, location: loc.id, device: dev.getString('name'), note: '' });
    });
  }
  const zone = t.resolver(app).zone(m.id, today);
  const after = t.clockState(app, m.id);
  L('lib_audit').note(ctx, { collection: 'checkins', record: rec.id, summary: KIND_LABEL[kind] + ' at the ' + loc.getString('name') + ' kiosk for ' + emp.getString('number') });
  return { name: L('lib_people').displayName(emp), kind: kind, label: KIND_LABEL[kind], time: t.localTime(zone, t.ms(rec.getString('at'))), state: after.state, next: nextKinds(after.state) };
}

function kioskPhoto(ctx, p) {
  const util = u();
  const app = ctx.app;
  const loc = locationByCode(app, util.req(p, 'code'));
  deviceOf(app, loc, kioskToken(ctx));
  const emp = L('lib_people').employeeRef(app, util.req(p, 'employee'));
  const ok = util.count(app, "SELECT COUNT(*) AS n FROM employments WHERE employee = {:e} AND entity = {:n} AND (end_day = '' OR end_day >= {:d})", { e: emp.id, n: loc.getString('entity'), d: util.today(app, loc.getString('entity')) });
  if (ok === 0 || emp.getString('photo') === '') throw util.fail(404, 'No photo.', 'not_found');
  return L('lib_files').serve(ctx, emp, 'photo', 'photo-' + emp.getString('number'), false);
}

/** The employee a PIN op acts on: --employee (HR with time edit, in scope) or the caller themself. */
function pinTarget(ctx, p) {
  const util = u();
  const auth = L('lib_auth');
  const ref = util.str(p, 'employee', '');
  if (ref === '' || (ctx.employeeId !== '' && L('lib_people').employeeRef(ctx.app, ref).id === ctx.employeeId)) {
    if (ctx.employeeId === '') throw util.fail(409, 'Your sign-in is not linked to an employee record.', 'no_employee');
    return { emp: ctx.app.findRecordById('employees', ctx.employeeId), self: true };
  }
  const emp = L('lib_people').employeeRef(ctx.app, ref);
  const ents = util.rows(ctx.app, 'SELECT DISTINCT entity FROM employments WHERE employee = {:e}', { entity: '' }, { e: emp.id }).map((r) => r.entity);
  if (!auth.can(ctx, 'time', 'edit') || !(ents.length === 0 || ents.some((x) => auth.inScope(ctx, x)))) throw util.fail(403, 'Only the person or HR (edit access to Time) sets a kiosk PIN.', 'not_permitted');
  return { emp: emp, self: false };
}

function kioskPinSet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const tg = pinTarget(ctx, p);
  const pin = checkPinFormat(util.str(p, 'pin', ''));
  let v = util.findOne(app, 'kiosk_pins', 'employee = {:e}', { e: tg.emp.id });
  if (v === null) {
    v = util.newRecord(app, 'kiosk_pins');
    v.set('employee', tg.emp.id);
    v.set('email', tg.emp.id.toLowerCase() + '@kiosk-pin.invalid');
  }
  v.setPassword(pinSecret(tg.emp.id, pin));
  if (ctx.memberId) v.set('set_by', ctx.memberId);
  v.set('set_at', util.nowIso());
  v.set('fails', 0);
  v.set('locked_until', '');
  app.save(v);
  L('lib_audit').note(ctx, { collection: 'kiosk_pins', record: v.id, summary: (tg.self ? 'Set my kiosk PIN' : 'Set the kiosk PIN of ' + tg.emp.getString('number')) });
  return { employee: tg.emp.id, set: true, set_at: v.getString('set_at') };
}

function kioskPinClear(ctx, p) {
  const util = u();
  const tg = pinTarget(ctx, p);
  const v = util.findOne(ctx.app, 'kiosk_pins', 'employee = {:e}', { e: tg.emp.id });
  if (v !== null) ctx.app.delete(v);
  L('lib_audit').note(ctx, { collection: 'kiosk_pins', record: tg.emp.id, summary: 'Removed the kiosk PIN of ' + tg.emp.getString('number') });
  return { employee: tg.emp.id, set: false };
}

function kioskPinStatus(ctx, p) {
  const util = u();
  if (util.str(p, 'employee', '') === '' && ctx.employeeId === '') return { employee: '', set: false, set_at: '', locked: false, no_employee: true };
  const tg = pinTarget(ctx, p);
  const v = util.findOne(ctx.app, 'kiosk_pins', 'employee = {:e}', { e: tg.emp.id });
  const until = v !== null ? T().ms(v.getString('locked_until')) : NaN;
  return { employee: tg.emp.id, set: v !== null, set_at: v !== null ? v.getString('set_at') : '', locked: Number.isFinite(until) && until > Date.now() };
}

module.exports = {
  clockUndo: clockUndo,
  KINDS: KINDS,
  KIND_LABEL: KIND_LABEL,
  metres: metres,
  nextKinds: nextKinds,
  statusFor: statusFor,
  addPunch: addPunch,
  recomputeAround: recomputeAround,
  clockStatus: clockStatus,
  clockPunch: clockPunch,
  checkinsAdd: checkinsAdd,
  previewCheckinAdd: previewCheckinAdd,
  checkinsVoid: checkinsVoid,
  previewCheckinVoid: previewCheckinVoid,
  checkinsList: checkinsList,
  checkinsFlagged: checkinsFlagged,
  kioskStart: kioskStart,
  kioskDevices: kioskDevices,
  kioskStop: kioskStop,
  kioskRoster: kioskRoster,
  kioskPunch: kioskPunch,
  kioskPhoto: kioskPhoto,
  kioskPinSet: kioskPinSet,
  kioskPinClear: kioskPinClear,
  kioskPinStatus: kioskPinStatus,
  verifyKioskPin: verifyKioskPin,
};
