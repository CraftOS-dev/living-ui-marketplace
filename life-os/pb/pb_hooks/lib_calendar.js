/// <reference path="../pb_data/types.d.ts" />
/**
 * A read-only mirror of the person's Google Calendar (when they switch it
 * on in Settings and have Google Calendar connected in their AI agent's
 * integrations). Events land on Today's schedule, the Week and the
 * calendars. Nothing is ever written to the calendar from here.
 *
 * The mirror says honestly what happened: "not connected" (the integration
 * is missing or refused), "unreachable" (the bridge did not answer), or the
 * time of the last good sync. No stand-in events are ever shown.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}

const EVERY_MINUTES = 15;

/** The events array in whatever envelope the action answered with. */
function eventsOf(res) {
  const pick = (x) => (Array.isArray(x) ? x : null);
  if (res === null || typeof res !== 'object') return null;
  const r = res.result !== undefined ? res.result : res.data !== undefined ? res.data : res;
  return pick(r && r.events) || pick(r && r.items) || pick(r) || pick(res.events) || pick(res.items) || null;
}

function localIso(day, hh) {
  // Midnight local of `day` as an ISO instant (the action wants RFC 3339).
  const d = core().parse(day);
  d.setHours(hh || 0, 0, 0, 0);
  return d.toISOString();
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/** An RFC 3339 time as local "YYYY-MM-DD HH:MM" (all-day events keep their date). */
function localStamp(v) {
  if (typeof v !== 'string' || v === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** calendar.sync: read the next five weeks (and the last one) into the mirror. */
function sync(app) {
  const util = u();
  const C = core();
  const s = C.settings(app);
  const today = C.today(app);
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const res = bridge.callAction('list_google_calendar_events', { calendar_id: s.getString('calendar_id') || 'primary', time_min: localIso(C.addDays(today, -7)), time_max: localIso(C.addDays(today, 36)), max_results: 250 });
  const status = Number(res && res.status);
  const list = eventsOf(res);
  const st = C.settings(app);
  if (list === null || (Number.isFinite(status) && status >= 400)) {
    st.set('calendar_state', status === 502 || status === 503 || status === 504 ? 'unreachable' : 'not_connected');
    st.set('calendar_error', String((res && (res.error || res.message)) || 'No events came back.').slice(0, 400));
    app.saveNoValidate(st);
    return { state: st.getString('calendar_state'), error: st.getString('calendar_error'), events: 0 };
  }
  const now = util.nowIso();
  const seen = {};
  app.runInTransaction((tx) => {
    list.forEach((ev) => {
      if (ev === null || typeof ev !== 'object' || ev.status === 'cancelled') return;
      const start = ev.start && (ev.start.dateTime || ev.start.date);
      const end = ev.end && (ev.end.dateTime || ev.end.date);
      const allDay = !!(ev.start && ev.start.date && !ev.start.dateTime);
      const s1 = localStamp(String(start || ''));
      if (s1 === '') return;
      const e1 = localStamp(String(end || ''));
      // An all-day event spanning days appears on each of them.
      const first = s1.slice(0, 10);
      let last = allDay && e1 !== '' ? C.addDays(e1.slice(0, 10), -1) : first;
      if (C.between(first, last) < 0) last = first;
      for (let d = first, i = 0; C.between(d, last) >= 0 && i < 40; d = C.addDays(d, 1), i++) {
        const ext = String(ev.id || ev.iCalUID || s1 + (ev.summary || '')).slice(0, 300);
        const r = util.findOne(tx, 'calendar_events', 'external_id = {:x} && date = {:d}', { x: ext, d: d }) || util.newRecord(tx, 'calendar_events');
        r.set('external_id', ext);
        r.set('date', d);
        r.set('calendar', s.getString('calendar_id') || 'primary');
        r.set('start', allDay ? d : s1);
        r.set('end', allDay ? d : e1);
        r.set('all_day', allDay);
        r.set('title', String(ev.summary || '(no title)').slice(0, 300));
        r.set('location', String(ev.location || '').slice(0, 300));
        r.set('synced_at', now);
        tx.save(r);
        seen[r.id] = true;
      }
    });
    // Events no longer in the calendar (inside the window) leave the mirror.
    tx.findRecordsByFilter('calendar_events', 'date >= {:a} && date <= {:b}', '', 0, 0, { a: C.addDays(today, -7), b: C.addDays(today, 35) }).forEach((r) => {
      if (!seen[r.id]) tx.delete(r);
    });
    const s2 = C.settings(tx);
    s2.set('calendar_state', 'ok');
    s2.set('calendar_error', '');
    s2.set('calendar_synced_at', now);
    tx.saveNoValidate(s2);
  });
  return { state: 'ok', events: Object.keys(seen).length, synced_at: now };
}

/** The tick: sync every 15 minutes while switched on. */
function due(app) {
  const C = core();
  const s = C.settings(app);
  if (!s.getBool('calendar_enabled')) return;
  const last = Date.parse(String(s.getString('calendar_synced_at') || '').replace(' ', 'T'));
  const tried = Number(app.store().get('lo_cal_tried') || 0);
  if (Date.now() - tried < EVERY_MINUTES * 60000) return;
  if (Number.isFinite(last) && Date.now() - last < EVERY_MINUTES * 60000) return;
  app.store().set('lo_cal_tried', Date.now());
  sync(app);
}

/** calendar.sync (operation) */
function syncOp(ctx) {
  const C = core();
  if (!C.settings(ctx.app).getBool('calendar_enabled')) throw u().fail(409, 'The calendar is switched off (Settings).', 'calendar_off');
  ctx.app.store().set('lo_cal_tried', Date.now());
  return sync(ctx.app);
}

/** calendar.status */
function status(ctx) {
  const s = core().settings(ctx.app);
  return { enabled: s.getBool('calendar_enabled'), calendar_id: s.getString('calendar_id') || 'primary', state: s.getBool('calendar_enabled') ? s.getString('calendar_state') || 'off' : 'off', error: s.getString('calendar_error'), synced_at: s.getString('calendar_synced_at'), events: u().count(ctx.app, 'SELECT COUNT(*) AS n FROM calendar_events', {}) };
}

/** calendar.events: the mirror between two days. */
function events(ctx, p) {
  const util = u();
  const C = core();
  const t0 = C.today(ctx.app);
  const from = util.day(p, 'from', t0);
  const to = util.day(p, 'to', C.addDays(from, 6));
  const recs = ctx.app.findRecordsByFilter('calendar_events', 'date >= {:a} && date <= {:b}', 'date,start', 1000, 0, { a: from, b: to });
  return { events: recs.map((r) => ({ id: r.id, date: r.getString('date'), start: r.getString('start'), end: r.getString('end'), all_day: r.getBool('all_day'), title: r.getString('title'), location: r.getString('location') })) };
}

module.exports = { sync: sync, due: due, syncOp: syncOp, status: status, events: events, eventsOf: eventsOf, localStamp: localStamp };
