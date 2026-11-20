/**
 * Days in the firm's zone: business days, reply SLA due days, days in stage
 * and stalls (REPORT Table 33).
 *
 * - A local day is the 'YYYY-MM-DD' of an instant in an IANA zone. Goja has
 *   no Intl, so zones come from the table below (HR OS's table with the
 *   Chatham rule fixed and a few zones added), each checked against the IANA
 *   database in the tests.
 * - Business days skip the weekend days (configurable, 0 Sunday .. 6
 *   Saturday; Saturday and Sunday unless told) and the given holidays.
 * - addBusinessDays(day, n) is the n-th business day after `day`;
 *   businessDaysBetween(a, b) counts business days d with a < d <= b.
 * - Reply SLA: due = addBusinessDays(local day of receipt, sla_days).
 * - Stall: calendar days in stage; stalled when they exceed the stage's
 *   stall_days; stall_days 0 never stalls.
 *
 * Pure: no PocketBase globals. `now` is always passed in.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

// Standard offset in minutes east of UTC, and the daylight saving rule:
// none | us (2nd Sun Mar to 1st Sun Nov, 02:00 local) | eu (last Sun Mar to
// last Sun Oct, 01:00 UTC) | au (1st Sun Oct to 1st Sun Apr, 02:00 local
// standard) | nz (last Sun Sep to 1st Sun Apr, 02:00 NZST, the same UTC
// instant for Chatham) | il (Fri before last Sun Mar 02:00 local to last
// Sun Oct 02:00 local daylight) | eg (last Fri Apr 00:00 local to the end of
// the last Thu Oct, Egypt since 2023).
const ZONES = {
  UTC: [0, 'none'],
  'Asia/Singapore': [480, 'none'],
  'Asia/Tokyo': [540, 'none'],
  'Asia/Kolkata': [330, 'none'],
  'Asia/Kuala_Lumpur': [480, 'none'],
  'Asia/Kuching': [480, 'none'],
  'Asia/Manila': [480, 'none'],
  'Asia/Jakarta': [420, 'none'],
  'Asia/Makassar': [480, 'none'],
  'Asia/Jayapura': [540, 'none'],
  'Asia/Bangkok': [420, 'none'],
  'Asia/Ho_Chi_Minh': [420, 'none'],
  'Asia/Hong_Kong': [480, 'none'],
  'Asia/Shanghai': [480, 'none'],
  'Asia/Seoul': [540, 'none'],
  'Asia/Taipei': [480, 'none'],
  'Asia/Dubai': [240, 'none'],
  'Asia/Riyadh': [180, 'none'],
  'Asia/Qatar': [180, 'none'],
  'Asia/Bahrain': [180, 'none'],
  'Asia/Kuwait': [180, 'none'],
  'Asia/Tbilisi': [240, 'none'],
  'Asia/Karachi': [300, 'none'],
  'Asia/Dhaka': [360, 'none'],
  'Asia/Kathmandu': [345, 'none'],
  'Asia/Colombo': [330, 'none'],
  'Asia/Jerusalem': [120, 'il'],
  'Africa/Johannesburg': [120, 'none'],
  'Africa/Lagos': [60, 'none'],
  'Africa/Nairobi': [180, 'none'],
  'Africa/Cairo': [120, 'eg'],
  'Africa/Accra': [0, 'none'],
  'Africa/Kigali': [120, 'none'],
  'America/Sao_Paulo': [-180, 'none'],
  'America/Manaus': [-240, 'none'],
  'America/Fortaleza': [-180, 'none'],
  'America/Noronha': [-120, 'none'],
  'America/Rio_Branco': [-300, 'none'],
  'America/Argentina/Buenos_Aires': [-180, 'none'],
  'America/Mexico_City': [-360, 'none'],
  'America/Monterrey': [-360, 'none'],
  'America/Chihuahua': [-360, 'none'],
  'America/Cancun': [-300, 'none'],
  'America/Hermosillo': [-420, 'none'],
  'America/Tijuana': [-480, 'us'],
  'America/Whitehorse': [-420, 'none'],
  'Atlantic/Canary': [0, 'eu'],
  'Pacific/Chatham': [765, 'nz'],
  'America/Bogota': [-300, 'none'],
  'America/Lima': [-300, 'none'],
  'America/Phoenix': [-420, 'none'],
  'America/Regina': [-360, 'none'],
  'Pacific/Honolulu': [-600, 'none'],
  'Australia/Brisbane': [600, 'none'],
  'Australia/Darwin': [570, 'none'],
  'Australia/Perth': [480, 'none'],
  'America/New_York': [-300, 'us'],
  'America/Detroit': [-300, 'us'],
  'America/Indiana/Indianapolis': [-300, 'us'],
  'America/Chicago': [-360, 'us'],
  'America/Denver': [-420, 'us'],
  'America/Boise': [-420, 'us'],
  'America/Los_Angeles': [-480, 'us'],
  'America/Anchorage': [-540, 'us'],
  'America/Toronto': [-300, 'us'],
  'America/Vancouver': [-480, 'us'],
  'America/Edmonton': [-420, 'us'],
  'America/Winnipeg': [-360, 'us'],
  'America/Halifax': [-240, 'us'],
  'America/St_Johns': [-210, 'us'],
  'Europe/London': [0, 'eu'],
  'Europe/Dublin': [0, 'eu'],
  'Europe/Lisbon': [0, 'eu'],
  'Europe/Berlin': [60, 'eu'],
  'Europe/Paris': [60, 'eu'],
  'Europe/Amsterdam': [60, 'eu'],
  'Europe/Brussels': [60, 'eu'],
  'Europe/Luxembourg': [60, 'eu'],
  'Europe/Madrid': [60, 'eu'],
  'Europe/Rome': [60, 'eu'],
  'Europe/Vienna': [60, 'eu'],
  'Europe/Zurich': [60, 'eu'],
  'Europe/Stockholm': [60, 'eu'],
  'Europe/Oslo': [60, 'eu'],
  'Europe/Copenhagen': [60, 'eu'],
  'Europe/Warsaw': [60, 'eu'],
  'Europe/Prague': [60, 'eu'],
  'Europe/Budapest': [60, 'eu'],
  'Europe/Athens': [120, 'eu'],
  'Europe/Helsinki': [120, 'eu'],
  'Europe/Bucharest': [120, 'eu'],
  'Europe/Tallinn': [120, 'eu'],
  'Europe/Riga': [120, 'eu'],
  'Europe/Vilnius': [120, 'eu'],
  'Europe/Istanbul': [180, 'none'],
  'Australia/Sydney': [600, 'au'],
  'Australia/Melbourne': [600, 'au'],
  'Australia/Hobart': [600, 'au'],
  'Australia/Canberra': [600, 'au'],
  'Australia/Adelaide': [570, 'au'],
  'Pacific/Auckland': [720, 'nz'],
};

const DEFAULT_WEEKEND = [0, 6];

/** Day of month of the n-th (1-based) weekday `wd` in month `m` (0-based) of year y; n = -1 for the last. */
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lastWd = new Date(Date.UTC(y, m, lastDay)).getUTCDay();
  return lastDay - ((lastWd - wd + 7) % 7);
}

function isZone(zone) {
  return typeof zone === 'string' && Object.prototype.hasOwnProperty.call(ZONES, zone);
}

function zoneOf(zone) {
  if (!isZone(zone)) throw C().fail(400, 'Unknown time zone ' + zone + '. Use one of: ' + Object.keys(ZONES).join(', '), 'invalid_timezone', { value: C().isNil(zone) ? null : zone });
  return ZONES[zone];
}

/** Minutes east of UTC for `zone` at instant `at` (ms or date-time text). */
function offsetMinutes(zone, at) {
  const z = zoneOf(zone);
  const ms = C().instant(at, 'at');
  const std = z[0];
  const rule = z[1];
  if (rule === 'none') return std;
  const y = new Date(ms + std * 60000).getUTCFullYear();
  const local = (m, d, h, offMin) => Date.UTC(y, m, d, h, 0) - offMin * 60000;
  let dst = false;
  if (rule === 'us') dst = ms >= local(2, nthWeekday(y, 2, 0, 2), 2, std) && ms < local(10, nthWeekday(y, 10, 0, 1), 2, std + 60);
  else if (rule === 'eu') dst = ms >= Date.UTC(y, 2, nthWeekday(y, 2, 0, -1), 1, 0) && ms < Date.UTC(y, 9, nthWeekday(y, 9, 0, -1), 1, 0);
  else if (rule === 'au') dst = ms >= local(9, nthWeekday(y, 9, 0, 1), 2, std) || ms < local(3, nthWeekday(y, 3, 0, 1), 3, std + 60);
  else if (rule === 'nz') dst = ms >= local(8, nthWeekday(y, 8, 0, -1), 2, 720) || ms < local(3, nthWeekday(y, 3, 0, 1), 3, 780);
  else if (rule === 'il') dst = ms >= local(2, nthWeekday(y, 2, 0, -1) - 2, 2, std) && ms < local(9, nthWeekday(y, 9, 0, -1), 2, std + 60);
  else if (rule === 'eg') dst = ms >= local(3, nthWeekday(y, 3, 5, -1), 0, std) && ms < local(9, nthWeekday(y, 9, 4, -1) + 1, 0, std + 60);
  return dst ? std + 60 : std;
}

/** The local day 'YYYY-MM-DD' of an instant in `zone`. */
function localDay(zone, at) {
  const ms = C().instant(at, 'at');
  return new Date(ms + offsetMinutes(zone, ms) * 60000).toISOString().slice(0, 10);
}

/** Today in `zone` at `now`. */
function today(zone, now) {
  return localDay(zone, now);
}

/** The calendar { weekend, holidays } checked; throws invalid_calendar. */
function calendar(cal) {
  const c = C();
  const x = cal || {};
  const weekend = c.isNil(x.weekend) ? DEFAULT_WEEKEND : x.weekend;
  if (!Array.isArray(weekend) || weekend.length > 6 || !weekend.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || weekend.some((d, i) => weekend.indexOf(d) !== i)) {
    throw c.fail(400, 'weekend is a list of distinct weekdays 0 (Sunday) to 6 (Saturday), at most 6', 'invalid_calendar', { field: 'weekend' });
  }
  const holidays = {};
  const list = c.isNil(x.holidays) ? [] : x.holidays;
  if (!Array.isArray(list)) throw c.fail(400, 'holidays is a list of days YYYY-MM-DD', 'invalid_calendar', { field: 'holidays' });
  for (const h of list) {
    c.dayNum(h, 'holidays');
    holidays[h] = true;
  }
  const off = [false, false, false, false, false, false, false];
  for (const d of weekend) off[d] = true;
  return { off: off, holidays: holidays, weekend: weekend.slice() };
}

function isBusinessDayIn(day, k) {
  return !k.off[C().weekday(day)] && k.holidays[day] !== true;
}

/** Is `day` a business day under cal { weekend, holidays }? */
function isBusinessDay(day, cal) {
  C().dayNum(day, 'day');
  return isBusinessDayIn(day, calendar(cal));
}

/** The n-th business day after `day` (n < 0: before; n = 0: `day` itself). */
function addBusinessDays(day, n, cal) {
  const c = C();
  let d = c.dayNum(day, 'day');
  if (!Number.isInteger(n) || Math.abs(n) > 3660) throw c.fail(400, 'n must be a whole number of business days up to 3660', 'invalid_param', { field: 'n' });
  const k = calendar(cal);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  let guard = 0;
  while (left > 0) {
    d += step;
    if (isBusinessDayIn(c.dayText(d), k)) left--;
    if (++guard > 40000) throw c.fail(400, 'No business day found', 'invalid_calendar', {});
  }
  return c.dayText(d);
}

/** Business days d with from < d <= to (negative when to is before from). */
function businessDaysBetween(fromDay, toDay, cal) {
  const c = C();
  const a = c.dayNum(fromDay, 'from_day');
  const b = c.dayNum(toDay, 'to_day');
  const k = calendar(cal);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo > 40000) throw c.fail(400, 'Range too long', 'invalid_param', {});
  let n = 0;
  for (let d = lo + 1; d <= hi; d++) if (isBusinessDayIn(c.dayText(d), k)) n++;
  return b >= a ? n : -n;
}

/**
 * Reply SLA. input: { received_at, zone, days, weekend?, holidays? }
 * -> { received_day, due_day, days }
 */
function slaDue(input) {
  const c = C();
  const x = input || {};
  if (!Number.isInteger(x.days) || x.days < 0 || x.days > 365) throw c.fail(400, 'days must be 0 to 365 business days', 'invalid_param', { field: 'days' });
  const received = localDay(x.zone, x.received_at);
  return { received_day: received, due_day: addBusinessDays(received, x.days, x), days: x.days };
}

/**
 * Where a due day stands today. input: { due_day, today, weekend?, holidays? }
 * -> { state: open|due_today|overdue, business_days_left (negative when overdue) }
 */
function slaState(input) {
  const x = input || {};
  const n = businessDaysBetween(x.today, x.due_day, x);
  const c = C();
  const cmp = c.dayNum(x.due_day, 'due_day') - c.dayNum(x.today, 'today');
  const state = cmp > 0 ? 'open' : cmp === 0 ? 'due_today' : 'overdue';
  return { state: state, business_days_left: n };
}

/** Calendar days from the local day of `entered_at` to the local day of `now`. */
function daysInStage(input) {
  const x = input || {};
  const c = C();
  return c.dayNum(localDay(x.zone, x.now), 'now') - c.dayNum(localDay(x.zone, x.entered_at), 'entered_at');
}

/**
 * Stall. input: { entered_at, now, zone, stall_days }
 * -> { days_in_stage, stall_days, stalled, stalls_on (first stalled day, or null when stall_days is 0) }
 */
function stall(input) {
  const c = C();
  const x = input || {};
  if (!Number.isInteger(x.stall_days) || x.stall_days < 0 || x.stall_days > 3650) throw c.fail(400, 'stall_days must be 0 to 3650', 'invalid_param', { field: 'stall_days' });
  const days = daysInStage(x);
  if (x.stall_days === 0) return { days_in_stage: days, stall_days: 0, stalled: false, stalls_on: null };
  const entered = localDay(x.zone, x.entered_at);
  return { days_in_stage: days, stall_days: x.stall_days, stalled: days > x.stall_days, stalls_on: c.addDays(entered, x.stall_days + 1) };
}

module.exports = {
  ZONES: ZONES,
  DEFAULT_WEEKEND: DEFAULT_WEEKEND,
  isZone: isZone,
  offsetMinutes: offsetMinutes,
  localDay: localDay,
  today: today,
  isBusinessDay: isBusinessDay,
  addBusinessDays: addBusinessDays,
  businessDaysBetween: businessDaysBetween,
  slaDue: slaDue,
  slaState: slaState,
  daysInStage: daysInStage,
  stall: stall,
};
