/// <reference path="../pb_data/types.d.ts" />
/**
 * What every part of the app shares: the settings row, record lookups, the
 * person's calendar (a day starts at `day_starts_hour`, so 1 a.m. still
 * belongs to yesterday), the ten area kinds, habit drawings, money amounts
 * and the checks on names people see (no emoji).
 *
 * Days are local calendar dates as text, YYYY-MM-DD, worked out from this
 * machine's clock (`new Date()` in the hooks runs in the machine's time
 * zone), never from UTC timestamps. Money is a whole number of the
 * currency's minor unit.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}

/* ------------------------------------------------------------- records */

function settings(app) {
  const r = app.findRecordsByFilter('settings', '', '', 1, 0);
  if (r.length === 0) throw u().fail(500, 'The settings row is missing.', 'error');
  return r[0];
}

/*
 * A per-VM memo stamped with the app's write version: every saved or
 * deleted record bumps `lo_v` (hooks.pb.js), so a memo is used only while
 * nothing has changed since it was made. Inside a transaction nothing is
 * memoized (the transaction may see its own writes first).
 */
const MEMO = {};

function memo(app, key, fn) {
  if (app.isTransactional()) return fn();
  const v = app.store().get('lo_v') || 0;
  const hit = MEMO[key];
  if (hit !== undefined && hit.v === v) return hit.val;
  const val = fn();
  MEMO[key] = { v: v, val: val };
  return val;
}

/** The settings most handlers need (memoized). */
function prefs(app) {
  return memo(app, 'prefs', () => {
    const s = settings(app);
    return {
      owner_name: s.getString('owner_name'),
      day_starts_hour: s.getInt('day_starts_hour'),
      week_starts_on: s.getString('week_starts_on') === 'sunday' ? 0 : 1,
      units: s.getString('units') || 'metric',
      currency: s.getString('currency') || 'USD',
      month_budget: s.getInt('month_budget'),
      lat: s.getFloat('lat'),
      lon: s.getFloat('lon'),
      has_place: s.getString('city') !== '' || s.getFloat('lat') !== 0 || s.getFloat('lon') !== 0,
      reflections_to_agent: s.getString('reflections_to_agent') || 'when_shared',
      water_goal: s.getInt('water_goal') || 8,
      sleep_goal: s.getFloat('sleep_goal') || 8,
      steps_goal: s.getInt('steps_goal'),
    };
  });
}

/** A record or a 404 that names what was looked for. */
/** The field that names a record, for collections an id is often looked up for. */
const NAMED = { people: 'name', habits: 'name', goals: 'title', trips: 'title', projects: 'title', tasks: 'title', bills: 'name', chores: 'name', books: 'title', money_pots: 'name' };

function need(app, collection, id, label) {
  const util = u();
  if (typeof id !== 'string' || id.trim() === '') throw util.fail(400, (label || 'record') + ' id is required', 'missing_param');
  const r = util.byId(app, collection, id.trim());
  if (r === null) {
    // Help the caller find the right id: the records with exactly this name, or some to choose from.
    const f = NAMED[collection];
    if (!f) throw util.fail(404, 'No ' + (label || 'record') + ' with id ' + id + '. List them to find the id.', 'not_found');
    const tpl = { id: '', name: '' };
    const same = util.rows(app, 'SELECT id, ' + f + ' AS name FROM ' + collection + ' WHERE lower(' + f + ') = lower({:n}) LIMIT 5', tpl, { n: id.trim() });
    if (same.length > 0) throw util.fail(404, '"' + id + '" is a name, not an id. Its id: ' + same.map((x) => x.id + ' (' + x.name + ')').join(', ') + '.', 'not_found', { matches: same });
    const some = util.rows(app, 'SELECT id, ' + f + ' AS name FROM ' + collection + ' ORDER BY updated DESC LIMIT 12', tpl, {});
    throw util.fail(404, 'No ' + (label || 'record') + ' with id ' + id + '.' + (some.length > 0 ? ' Some: ' + some.map((x) => x.id + ' (' + x.name + ')').join(', ') + '.' : ''), 'not_found', { some: some });
  }
  return r;
}

/** "a", "a and b", "a, b and c". */
function listWords(xs) {
  return xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

/** Every goal as a brief, by id (memoized). */
function goalMap(app) {
  return memo(app, 'goalMap', () => {
    const m = {};
    app.findRecordsByFilter('goals', '', '', 0, 0).forEach((g) => {
      m[g.id] = { id: g.id, title: g.getString('title'), state: g.getString('state'), area: g.getString('area'), progress: g.getFloat('progress') };
    });
    return m;
  });
}

/** Every project as a brief, by id (memoized). */
function projectMap(app) {
  return memo(app, 'projectMap', () => {
    const m = {};
    app.findRecordsByFilter('projects', '', '', 0, 0).forEach((p) => {
      m[p.id] = { id: p.id, title: p.getString('title'), area: p.getString('area'), state: p.getString('state'), look: p.getInt('look') };
    });
    return m;
  });
}

/** Every person as a brief, by id (memoized). */
function personMap(app) {
  return memo(app, 'personMap', () => {
    const m = {};
    app.findRecordsByFilter('people', '', '', 0, 0).forEach((p) => {
      m[p.id] = { id: p.id, name: p.getString('name'), look: p.getInt('look'), circle: p.getString('circle') };
    });
    return m;
  });
}

/* ------------------------------------------------------------ calendar */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function fmt(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/*
 * Day numbers: days since 1970-01-01 in the proleptic calendar, computed
 * with integer arithmetic (H. Hinnant's civil-day algorithms). Dates in a
 * person's calendar have no time zone, and the hooks' JS engine is slow
 * with Date objects, so loops over days use these.
 */
const DNUM = {};

/** YYYY-MM-DD to a day number. */
function dnum(day) {
  const hit = DNUM[day];
  if (hit !== undefined) return hit;
  let y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (m <= 2) y -= 1;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const n = era * 146097 + doe - 719468;
  DNUM[day] = n;
  return n;
}

/** A day number to YYYY-MM-DD. */
function dstr(z0) {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return y + '-' + pad(m) + '-' + pad(d);
}

/** 0 Sunday to 6 Saturday, for a day number. */
function wdOf(n) {
  return ((n % 7) + 7 + 4) % 7;
}

function addDays(day, n) {
  return dstr(dnum(day) + n);
}

function addMonths(day, n) {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + n;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = new Date(ty, tm + 1, 0, 12).getDate();
  return ty + '-' + pad(tm + 1) + '-' + pad(Math.min(Number(day.slice(8, 10)), last));
}

/** Whole days from a to b (b - a). */
function between(a, b) {
  return dnum(b) - dnum(a);
}

/** 0 Sunday to 6 Saturday. */
function weekday(day) {
  return wdOf(dnum(day));
}

/** Now on this machine: the calendar date, time and the person's day (which starts at day_starts_hour). */
function now(app) {
  const d = new Date();
  let startHour = 4;
  try {
    startHour = prefs(app).day_starts_hour;
  } catch {
    startHour = 4;
  }
  const shifted = new Date(d.getTime());
  if (d.getHours() < startHour) shifted.setDate(shifted.getDate() - 1);
  return {
    date: fmt(d),
    today: fmt(shifted),
    time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
    hour: d.getHours(),
    minute: d.getMinutes(),
    weekday: d.getDay(),
    stamp: fmt(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()),
    iso: d.toISOString(),
    offset_minutes: -d.getTimezoneOffset(),
  };
}

/** The person's today (a day starts at day_starts_hour). */
function today(app) {
  return now(app).today;
}

function weekStartsOn(app) {
  try {
    return prefs(app).week_starts_on;
  } catch {
    return 1;
  }
}

/** The first day of the week holding `day`. */
function weekStart(app, day) {
  const first = weekStartsOn(app);
  const wd = weekday(day);
  return addDays(day, -((wd - first + 7) % 7));
}

function monthStart(day) {
  return day.slice(0, 8) + '01';
}

function monthEnd(day) {
  return addDays(addMonths(monthStart(day), 1), -1);
}

/** The season of a day for the pictures (meteorological seasons; south of the equator they turn round). */
function season(app, day) {
  const m = Number(day.slice(5, 7));
  let south = false;
  try {
    south = prefs(app).lat < 0;
  } catch {
    south = false;
  }
  const s = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  if (!south) return s;
  return { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' }[s];
}

const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day as people write it in a sentence: "Wed Oct 21" (with the year when it is not this year's). */
function words(app, day) {
  if (typeof day !== 'string' || day.length !== 10) return String(day || '');
  const y = day.slice(0, 4);
  const m = Number(day.slice(5, 7)) - 1;
  const d = Number(day.slice(8, 10));
  return WD3[weekday(day)] + ' ' + MON3[m] + ' ' + d + (y !== today(app).slice(0, 4) ? ', ' + y : '');
}

/** HH:MM to minutes after midnight (-1 when it is not a time). */
function minutesOf(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return -1;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return -1;
  return h * 60 + mi;
}

function time(p, name, dflt) {
  const util = u();
  const v = util.str(p, name, '');
  if (v === '') return dflt;
  if (minutesOf(v) < 0) throw util.fail(400, name + ' must be a time written HH:MM (24 hours), e.g. 07:30', 'invalid_param', { param: name });
  return v;
}

/** A birthday: MM-DD, or YYYY-MM-DD when the year is known. */
function birthday(p, name) {
  const util = u();
  if (!util.has(p, name)) return undefined;
  const v = util.str(p, name, '');
  if (v === '') return '';
  if (/^\d{2}-\d{2}$/.test(v) && util.isDay('2000-' + v)) return v;
  if (util.isDay(v)) return v;
  throw util.fail(400, name + ' is MM-DD, or YYYY-MM-DD when the year is known, e.g. 03-21', 'invalid_param', { param: name });
}

/** The next date a MM-DD (or YYYY-MM-DD) birthday falls on, from `day` (inclusive), and the age then if the year is known. */
function nextBirthday(bday, day) {
  if (bday === '') return null;
  const md = bday.length === 10 ? bday.slice(5) : bday;
  let y = Number(day.slice(0, 4));
  let date = y + '-' + md;
  if (md === '02-29' && !u().isDay(date)) date = y + '-03-01';
  if (date < day) {
    y += 1;
    date = y + '-' + md;
    if (md === '02-29' && !u().isDay(date)) date = y + '-03-01';
  }
  return { date: date, in_days: between(day, date), age: bday.length === 10 ? y - Number(bday.slice(0, 4)) : null };
}

/* ---------------------------------------------------------------- names */

function hasEmoji(s) {
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) {
    let c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) {
      const lo = t.charCodeAt(i + 1);
      c = (c - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
      i++;
    }
    if ((c >= 0x1f000 && c <= 0x1faff) || (c >= 0x2600 && c <= 0x27bf) || (c >= 0x2b00 && c <= 0x2bff) || c === 0xfe0f || c === 0x200d || (c >= 0x1f1e6 && c <= 0x1f1ff) || c === 0x2300 || (c >= 0x231a && c <= 0x23ff) || c === 0x3030 || c === 0x303d || c === 0x3297 || c === 0x3299) {
      return true;
    }
  }
  return false;
}

/** A display name: required (unless dflt is given), trimmed, at most `max`, no emoji. */
function name(p, field, max, dflt) {
  const util = u();
  const v = util.text(p, field, max, undefined);
  if (v === undefined) {
    if (dflt !== undefined) return dflt;
    throw util.fail(400, field + ' is required', 'missing_param', { param: field });
  }
  const t = util.squash(v);
  if (t === '' && dflt === undefined) throw util.fail(400, field + ' is required', 'missing_param', { param: field });
  if (hasEmoji(t)) throw util.fail(400, field + ' cannot hold emoji; the app draws its own pictures.', 'emoji_not_allowed', { param: field });
  return t;
}

/* ------------------------------------------------------------- the areas */

const KINDS = ['health', 'money', 'relationships', 'work', 'home', 'growth', 'fun', 'mind'];
const KIND_NAMES = { health: 'Health', money: 'Money', relationships: 'Friends and family', work: 'Work', home: 'Home', growth: 'Growth', fun: 'Fun', mind: 'Mind' };

/** An area kind param ('' clears it when allowed). */
function kind(p, field, required) {
  const util = u();
  if (!util.has(p, field)) {
    if (required) throw util.fail(400, field + ' is required: one of ' + KINDS.join(', '), 'missing_param', { param: field });
    return undefined;
  }
  const v = util.str(p, field, '');
  if (v === '') {
    if (required) throw util.fail(400, field + ' is required: one of ' + KINDS.join(', '), 'missing_param', { param: field });
    return '';
  }
  if (KINDS.indexOf(v) < 0) {
    const near = util.nearest(v, KINDS);
    throw util.fail(400, field + ' must be one of: ' + KINDS.join(', ') + (near !== '' ? ' (did you mean ' + near + '?)' : ''), 'invalid_param', { param: field });
  }
  return v;
}

/** The kinds a person has switched on, in their order (memoized). */
function enabledKinds(app) {
  return memo(app, 'kinds', () =>
    app
      .findRecordsByFilter('areas', 'enabled = true', 'rank', 0, 0)
      .map((a) => a.getString('kind')),
  );
}

/** The habit drawings the screens have (lib art.tsx HABIT_ARTS). */
const HABIT_ARTS = ['water', 'run', 'walk', 'workout', 'yoga', 'read', 'meditate', 'sleep', 'veggies', 'fruit', 'journal', 'gratitude', 'nophone', 'teeth', 'vitamins', 'tidy', 'plants', 'music', 'language', 'save', 'outside', 'coffee', 'study', 'sprout'];

function art(p, field, dflt) {
  const util = u();
  const v = util.str(p, field, '');
  if (v === '') return dflt;
  if (HABIT_ARTS.indexOf(v) < 0) {
    const near = util.nearest(v, HABIT_ARTS);
    throw util.fail(400, field + ' must be one of the drawings: ' + HABIT_ARTS.join(', ') + (near !== '' ? ' (did you mean ' + near + '?)' : ''), 'invalid_param', { param: field });
  }
  return v;
}

/* ---------------------------------------------------------------- money */

const ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'PYG', 'XAF', 'XOF', 'TWD', 'IDR'];

/** Digits after the decimal point for the person's currency. */
function digits(app) {
  return ZERO_DECIMAL.indexOf(prefs(app).currency) >= 0 ? 0 : 2;
}

/** An amount param ("12.50", 12.5) as whole minor units, refusing more decimals than the currency has. */
function amount(app, p, field, required) {
  const util = u();
  if (!util.has(p, field) || util.scalar(p[field]) === '') {
    if (required) throw util.fail(400, field + ' is required, e.g. --' + field + ' 12.50', 'missing_param', { param: field });
    return undefined;
  }
  const raw = String(util.scalar(p[field])).trim().replace(/,/g, '');
  const dg = digits(app);
  const re = dg === 0 ? /^\d{1,12}$/ : /^\d{1,12}(\.\d{1,2})?$/;
  if (!re.test(raw)) throw util.fail(400, field + ' must be a plain amount' + (dg === 0 ? ' with no decimals' : ' with at most two decimals') + ', e.g. ' + (dg === 0 ? '1200' : '12.50'), 'invalid_param', { param: field });
  const n = dg === 0 ? Number(raw) : Math.round(Number(raw) * 100);
  return n;
}

/** Minor units back to a plain amount for messages ("12.50"). */
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', KRW: '₩' };

/** An amount in minor units as people write it: "€1,234.50", "MYR 12.00". */
function money(app, minor) {
  const dg = digits(app);
  const cur = String(prefs(app).currency || 'USD');
  const n = Math.abs(minor);
  const fixed = dg === 0 ? String(Math.round(n)) : (n / 100).toFixed(2);
  const parts = fixed.split('.');
  // Thousands commas by hand: the JS engine's lookahead regex doubles them.
  let whole = '';
  for (let i = 0; i < parts[0].length; i++) whole += (i > 0 && (parts[0].length - i) % 3 === 0 ? ',' : '') + parts[0][i];
  const body = parts.length > 1 ? whole + '.' + parts[1] : whole;
  const sym = SYMBOLS[cur];
  return (minor < 0 ? '-' : '') + (sym ? sym + body : cur + ' ' + body);
}

/* ---------------------------------------------------------------- misc */

/** A relation id param that must name an existing record (or "" to clear it). */
function ref(app, p, field, collection, label) {
  const util = u();
  if (!util.has(p, field)) return undefined;
  const v = util.str(p, field, '');
  if (v === '') return '';
  return need(app, collection, v, label).id;
}

/** Next rank at the end of a list. */
function nextRank(app, collection, filter, bind) {
  const util = u();
  const r = util.one(app, 'SELECT IFNULL(MAX(rank), 0) AS n FROM ' + collection + (filter ? ' WHERE ' + filter : ''), { n: 0 }, bind || {});
  return (r === null ? 0 : r.n) + 1;
}

module.exports = {
  listWords: listWords,
  settings: settings,
  memo: memo,
  prefs: prefs,
  need: need,
  goalMap: goalMap,
  projectMap: projectMap,
  personMap: personMap,
  pad: pad,
  fmt: fmt,
  dnum: dnum,
  dstr: dstr,
  wdOf: wdOf,
  addDays: addDays,
  addMonths: addMonths,
  between: between,
  weekday: weekday,
  now: now,
  today: today,
  weekStartsOn: weekStartsOn,
  weekStart: weekStart,
  monthStart: monthStart,
  monthEnd: monthEnd,
  season: season,
  words: words,
  minutesOf: minutesOf,
  time: time,
  birthday: birthday,
  nextBirthday: nextBirthday,
  hasEmoji: hasEmoji,
  name: name,
  KINDS: KINDS,
  KIND_NAMES: KIND_NAMES,
  kind: kind,
  enabledKinds: enabledKinds,
  HABIT_ARTS: HABIT_ARTS,
  art: art,
  digits: digits,
  amount: amount,
  money: money,
  ref: ref,
  nextRank: nextRank,
};
