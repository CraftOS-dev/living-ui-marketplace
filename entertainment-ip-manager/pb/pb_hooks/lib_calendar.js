/// <reference path="../pb_data/types.d.ts" />
/**
 * Office closure calendars and working days. A statutory deadline that
 * falls on a day the office is closed moves to the next day it is open
 * (37 CFR 2.196; Art. 72 EUTMDR; JP Trademark Act Art. 77 with Patent Act
 * Art. 3(2); CN, KR and TW office practice). Business-day periods (approval
 * SLAs, customs and DMCA windows) count only the office's working days.
 *
 * US, EM, JP and WO calendars are generated per year on first use and
 * stored in office_calendars (source "computed"). CN, KR and TW follow
 * lunar calendars and government notices, so their days are loaded from
 * the official lists (source "official"); China and Taiwan also publish
 * make-up working days, stored as rows with working_day = true. Admins can
 * add or remove days in Settings. Japan is refreshed monthly from the
 * Cabinet Office's official list.
 */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}
function ymd(y, m, d) {
  return y + '-' + pad(m) + '-' + pad(d);
}
function dow(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function shift(dayStr, n) {
  const p = dayStr.split('-');
  const t = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) + n * 86400000;
  const x = new Date(t);
  return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

/** Gregorian Easter Sunday (anonymous algorithm). */
function easter(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

/** n-th weekday (0=Sun) of a month; n=-1 for the last one. */
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = dow(y, m, 1);
    const day = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return ymd(y, m, day);
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = dow(y, m, last);
  return ymd(y, m, last - ((lastDow - wd + 7) % 7));
}

/** US federal holidays with weekend observance (5 U.S.C. 6103). */
function usHolidays(y) {
  const out = [];
  function observed(day, name) {
    const p = day.split('-');
    const w = dow(Number(p[0]), Number(p[1]), Number(p[2]));
    if (w === 6) out.push({ date: shift(day, -1), name: name + ' (observed)' });
    else if (w === 0) out.push({ date: shift(day, 1), name: name + ' (observed)' });
    else out.push({ date: day, name: name });
  }
  observed(ymd(y, 1, 1), "New Year's Day");
  out.push({ date: nthWeekday(y, 1, 1, 3), name: 'Martin Luther King Jr. Day' });
  if ((y - 2021) % 4 === 0 && y >= 2025) {
    const inaug = ymd(y, 1, 20);
    const w = dow(y, 1, 20);
    out.push({ date: w === 0 ? shift(inaug, 1) : inaug, name: 'Inauguration Day (Washington, DC)' });
  }
  out.push({ date: nthWeekday(y, 2, 1, 3), name: "Washington's Birthday" });
  out.push({ date: nthWeekday(y, 5, 1, -1), name: 'Memorial Day' });
  observed(ymd(y, 6, 19), 'Juneteenth National Independence Day');
  observed(ymd(y, 7, 4), 'Independence Day');
  out.push({ date: nthWeekday(y, 9, 1, 1), name: 'Labor Day' });
  out.push({ date: nthWeekday(y, 10, 1, 2), name: 'Columbus Day' });
  observed(ymd(y, 11, 11), 'Veterans Day');
  out.push({ date: nthWeekday(y, 11, 4, 4), name: 'Thanksgiving Day' });
  observed(ymd(y, 12, 25), 'Christmas Day');
  return out;
}

/** EPO closure days (Munich-based list; the EPO publishes the binding list each year). */
function epHolidays(y) {
  const e = easter(y);
  return [
    { date: ymd(y, 1, 1), name: "New Year's Day" },
    { date: shift(e, -2), name: 'Good Friday' },
    { date: shift(e, 1), name: 'Easter Monday' },
    { date: ymd(y, 5, 1), name: 'Labour Day' },
    { date: shift(e, 39), name: 'Ascension Day' },
    { date: shift(e, 50), name: 'Whit Monday' },
    { date: shift(e, 60), name: 'Corpus Christi' },
    { date: ymd(y, 10, 3), name: 'Day of German Unity' },
    { date: ymd(y, 11, 1), name: "All Saints' Day" },
    { date: ymd(y, 12, 24), name: 'Christmas Eve' },
    { date: ymd(y, 12, 25), name: 'Christmas Day' },
    { date: ymd(y, 12, 26), name: "St Stephen's Day" },
    { date: ymd(y, 12, 31), name: "New Year's Eve" },
  ];
}

/** EUIPO (Alicante) closure days; published yearly by decision of the Executive Director. */
function emHolidays(y) {
  const e = easter(y);
  return [
    { date: ymd(y, 1, 1), name: "New Year's Day" },
    { date: ymd(y, 1, 6), name: 'Epiphany' },
    { date: shift(e, -3), name: 'Maundy Thursday' },
    { date: shift(e, -2), name: 'Good Friday' },
    { date: shift(e, 1), name: 'Easter Monday' },
    { date: ymd(y, 5, 1), name: 'Labour Day' },
    { date: ymd(y, 5, 9), name: 'Europe Day' },
    { date: ymd(y, 8, 15), name: 'Assumption' },
    { date: ymd(y, 10, 12), name: 'Spanish National Day' },
    { date: ymd(y, 11, 1), name: "All Saints' Day" },
    { date: ymd(y, 12, 6), name: 'Constitution Day' },
    { date: ymd(y, 12, 8), name: 'Immaculate Conception' },
    { date: ymd(y, 12, 24), name: 'Christmas Eve' },
    { date: ymd(y, 12, 25), name: 'Christmas Day' },
    { date: ymd(y, 12, 26), name: "St Stephen's Day" },
    { date: ymd(y, 12, 31), name: "New Year's Eve" },
  ];
}

/** WIPO (Geneva) closure days. */
function woHolidays(y) {
  const e = easter(y);
  // Jeûne genevois: Thursday after the first Sunday of September.
  const firstSun = nthWeekday(y, 9, 0, 1);
  return [
    { date: ymd(y, 1, 1), name: "New Year's Day" },
    { date: ymd(y, 1, 2), name: "Berchtold's Day" },
    { date: shift(e, -2), name: 'Good Friday' },
    { date: shift(e, 1), name: 'Easter Monday' },
    { date: shift(e, 39), name: 'Ascension Day' },
    { date: shift(e, 50), name: 'Whit Monday' },
    { date: ymd(y, 8, 1), name: 'Swiss National Day' },
    { date: shift(firstSun, 4), name: 'Jeûne genevois' },
    { date: ymd(y, 12, 24), name: 'Christmas Eve' },
    { date: ymd(y, 12, 25), name: 'Christmas Day' },
    { date: ymd(y, 12, 31), name: 'Restoration of the Republic' },
  ];
}

/**
 * Japanese national holidays (Act on National Holidays) plus the
 * administrative year-end closure 29 Dec to 3 Jan (Act on Holidays of
 * Administrative Organs Art. 1(1)). Equinox days use the standard
 * astronomical approximation valid 1980-2099; the monthly job replaces
 * computed days with the Cabinet Office's official list.
 */
function jpHolidays(y) {
  const base = [];
  function add(day, name) {
    base.push({ date: day, name: name });
  }
  add(ymd(y, 1, 1), "New Year's Day");
  add(nthWeekday(y, 1, 1, 2), 'Coming of Age Day');
  add(ymd(y, 2, 11), 'National Foundation Day');
  add(ymd(y, 2, 23), "Emperor's Birthday");
  const vernal = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  add(ymd(y, 3, vernal), 'Vernal Equinox Day');
  add(ymd(y, 4, 29), 'Showa Day');
  add(ymd(y, 5, 3), 'Constitution Memorial Day');
  add(ymd(y, 5, 4), 'Greenery Day');
  add(ymd(y, 5, 5), "Children's Day");
  add(nthWeekday(y, 7, 1, 3), 'Marine Day');
  add(ymd(y, 8, 11), 'Mountain Day');
  add(nthWeekday(y, 9, 1, 3), 'Respect for the Aged Day');
  const autumnal = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  add(ymd(y, 9, autumnal), 'Autumnal Equinox Day');
  add(nthWeekday(y, 10, 1, 2), 'Sports Day');
  add(ymd(y, 11, 3), 'Culture Day');
  add(ymd(y, 11, 23), 'Labour Thanksgiving Day');

  const set = {};
  for (const h of base) set[h.date] = h.name;
  const out = base.slice();
  // Citizens' holiday: a weekday sandwiched between two holidays.
  for (const h of base) {
    const next2 = shift(h.date, 2);
    const mid = shift(h.date, 1);
    if (set[next2] && !set[mid]) {
      const p = mid.split('-');
      if (dow(Number(p[0]), Number(p[1]), Number(p[2])) !== 0) {
        set[mid] = "Citizens' Holiday";
        out.push({ date: mid, name: "Citizens' Holiday" });
      }
    }
  }
  // Substitute holiday: a holiday on Sunday moves to the next non-holiday day.
  for (const h of base) {
    const p = h.date.split('-');
    if (dow(Number(p[0]), Number(p[1]), Number(p[2])) === 0) {
      let sub = shift(h.date, 1);
      while (set[sub]) sub = shift(sub, 1);
      set[sub] = 'Substitute Holiday';
      out.push({ date: sub, name: 'Substitute Holiday' });
    }
  }
  // Administrative year-end and new-year closure.
  for (const d of [ymd(y, 1, 2), ymd(y, 1, 3), ymd(y, 12, 29), ymd(y, 12, 30), ymd(y, 12, 31)]) {
    if (!set[d]) {
      set[d] = 'Year-end closure';
      out.push({ date: d, name: 'Year-end and New Year closure' });
    }
  }
  return out;
}

const GENERATORS = { US: usHolidays, EP: epHolidays, EM: emHolidays, JP: jpHolidays, WO: woHolidays };
/** Offices whose calendars come only from official rows (no generator). */
const OFFICIAL_ONLY = { CN: true, KR: true, TW: true };
/** EU customs periods count working days at the EUIPO calendar. */
const ALIAS = { EU: 'EM' };

function norm(office) {
  const o = String(office || '').toUpperCase();
  return ALIAS[o] || o;
}

function supported(office) {
  const o = norm(office);
  return Object.prototype.hasOwnProperty.call(GENERATORS, o) || OFFICIAL_ONLY[o] === true;
}

/** Make sure closure days for (office, year) exist in office_calendars. */
function ensureCalendar(app, office, year) {
  const o = norm(office);
  if (!Object.prototype.hasOwnProperty.call(GENERATORS, o) || !year) return;
  try {
    app.findFirstRecordByFilter('calendar_years', 'office = {:o} && year = {:y}', { o: o, y: year });
    return;
  } catch {
    /* not generated yet */
  }
  try {
    const days = GENERATORS[o](year);
    const col = app.findCollectionByNameOrId('office_calendars');
    const seen = {};
    for (const h of days) {
      if (seen[h.date]) continue;
      seen[h.date] = true;
      let exists = null;
      try {
        exists = app.findFirstRecordByFilter('office_calendars', 'office = {:o} && date = {:d}', {
          o: o,
          d: h.date + ' 00:00:00.000Z',
        });
      } catch {
        exists = null;
      }
      if (exists !== null) continue;
      const rec = new Record(col);
      rec.set('office', o);
      rec.set('date', h.date + ' 00:00:00.000Z');
      rec.set('name', h.name);
      rec.set('source', 'computed');
      rec.set('working_day', false);
      app.save(rec);
    }
    const marker = new Record(app.findCollectionByNameOrId('calendar_years'));
    marker.set('office', o);
    marker.set('year', year);
    app.save(marker);
  } catch (err) {
    console.error('ensureCalendar failed for ' + o + ' ' + year + ':', err);
  }
}

/** Calendar rows for one office and year: { closed: { day: name }, working: { day: name } }. */
function closures(app, office, year) {
  const o = norm(office);
  const out = { closed: {}, working: {} };
  if (o === '' || o === '*') return out;
  ensureCalendar(app, o, year);
  try {
    const rows = app.findRecordsByFilter(
      'office_calendars',
      'office = {:o} && date >= {:a} && date <= {:b}',
      '',
      0,
      0,
      { o: o, a: year + '-01-01 00:00:00.000Z', b: year + '-12-31 23:59:59.999Z' },
    );
    for (const r of rows) {
      const d = r.getString('date').slice(0, 10);
      if (r.getBool('working_day')) out.working[d] = r.getString('name');
      else out.closed[d] = r.getString('name');
    }
  } catch {
    /* none */
  }
  return out;
}

/** Whether the office has a calendar for a year (CN, KR and TW need official rows). */
function hasYear(app, office, year) {
  const o = norm(office);
  if (Object.prototype.hasOwnProperty.call(GENERATORS, o)) return true;
  try {
    app.findFirstRecordByFilter('office_calendars', 'office = {:o} && date >= {:a} && date <= {:b}', {
      o: o,
      a: year + '-01-01 00:00:00.000Z',
      b: year + '-12-31 23:59:59.999Z',
    });
    return true;
  } catch {
    return false;
  }
}

function makeCache(app, office) {
  const cache = {};
  return function (y) {
    if (!cache[y]) cache[y] = closures(app, office, y);
    return cache[y];
  };
}

/** Is the office open on this day? { open, reason } with a bilingual reason when closed. */
function dayStatus(app, office, day, getYear) {
  const u = require(`${__hooks}/lib_util.js`);
  const y = Number(day.slice(0, 4));
  const cal = getYear ? getYear(y) : closures(app, office, y);
  if (cal.working[day]) return { open: true, reason: null };
  const w = u.weekday(day);
  if (w === 0 || w === 6) {
    return {
      open: false,
      reason: u.bi(u.human(day) + ' is a ' + u.weekdayName(day) + '.', u.humanJa(day) + 'は' + u.weekdayNameJa(day) + 'です。'),
    };
  }
  if (cal.closed[day]) {
    return {
      open: false,
      reason: u.bi(
        u.human(day) + ' is a closure day at the ' + officeName(office) + ' (' + cal.closed[day] + ').',
        u.humanJa(day) + 'は' + officeNameJa(office) + 'の閉庁日です（' + cal.closed[day] + '）。',
      ),
    };
  }
  return { open: true, reason: null };
}

function missingYearStep(u, o, year) {
  return u.bi(
    'No official holiday list is loaded for the ' + officeName(o) + ' in ' + year + '; only weekends were skipped. Add the list in Settings, Office closure days.',
    year + '年の' + officeNameJa(o) + 'の祝日一覧が未登録のため、土日のみを考慮しました。設定の「閉庁日」で登録してください。',
  );
}

/**
 * Roll a day forward past weekends and office closures.
 * Returns { date, steps: [{ en, ja }] } where steps explain each move.
 */
function rollForward(app, office, day) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = norm(office);
  let d = day;
  const steps = [];
  if (o === '' || o === '*') return { date: d, steps: steps };
  const getYear = makeCache(app, o);
  for (let guard = 0; guard < 40; guard++) {
    const st = dayStatus(app, o, d, getYear);
    if (st.open) break;
    steps.push(st.reason);
    d = u.addDays(d, 1);
  }
  if (!hasYear(app, o, Number(d.slice(0, 4)))) steps.push(missingYearStep(u, o, d.slice(0, 4)));
  return { date: d, steps: steps };
}

/**
 * Add n working days (n may be negative) at an office. The start day is not
 * counted. Returns { date, steps } with one bilingual summary step.
 */
function addBusinessDays(app, office, day, n) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = norm(office) || 'JP';
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(n);
  let d = day;
  let skipped = 0;
  const getYear = makeCache(app, o);
  for (let guard = 0; guard < 2000 && left > 0; guard++) {
    d = u.addDays(d, step);
    if (dayStatus(app, o, d, getYear).open) left -= 1;
    else skipped += 1;
  }
  const steps = [
    u.bi(
      Math.abs(n) + ' working days ' + (n >= 0 ? 'after ' : 'before ') + u.human(day) + ' at the ' + officeName(o) + ' is ' + u.human(d) +
        (skipped ? ' (' + skipped + ' weekend or closure days skipped).' : '.'),
      officeNameJa(o) + 'の執務日で' + u.humanJa(day) + (n >= 0 ? 'から' : 'の') + Math.abs(n) + '日' + (n >= 0 ? '後' : '前') + 'は' + u.humanJa(d) +
        (skipped ? 'です（土日・閉庁日' + skipped + '日を除外）。' : 'です。'),
    ),
  ];
  if (!hasYear(app, o, Number(d.slice(0, 4)))) steps.push(missingYearStep(u, o, d.slice(0, 4)));
  return { date: d, steps: steps };
}

/** Count working days after a, up to and including b. */
function businessDaysBetween(app, office, a, b) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = norm(office) || 'JP';
  if (u.d10(a) === '' || u.d10(b) === '' || b <= a) return 0;
  const getYear = makeCache(app, o);
  let n = 0;
  let d = a;
  for (let guard = 0; guard < 4000 && d < b; guard++) {
    d = u.addDays(d, 1);
    if (dayStatus(app, o, d, getYear).open) n += 1;
  }
  return n;
}

function officeName(office) {
  const o = norm(office);
  const names = {
    US: 'USPTO',
    EP: 'EPO',
    EM: 'EUIPO',
    JP: 'JPO',
    WO: 'WIPO',
    CN: 'CNIPA',
    KR: 'KIPO',
    TW: 'TIPO',
    GB: 'UK IPO',
  };
  return names[o] || (o ? o + ' office' : 'office');
}

function officeNameJa(office) {
  const o = norm(office);
  const names = {
    US: '米国特許商標庁',
    EP: '欧州特許庁',
    EM: '欧州連合知的財産庁',
    JP: '特許庁',
    WO: '世界知的所有権機関',
    CN: '中国国家知識産権局',
    KR: '韓国特許庁',
    TW: '台湾智慧財産局',
    GB: '英国知的財産庁',
  };
  return names[o] || (o ? o + 'の官庁' : '官庁');
}

/** Replace Japan's computed days with the Cabinet Office's official list. */
function refreshJapanOfficial(app) {
  const res = $http.send({ url: 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv', method: 'GET', timeout: 30 });
  if (res.statusCode !== 200) throw new Error('Cabinet Office holiday list returned HTTP ' + res.statusCode);
  // The CSV is Shift_JIS; dates are ASCII ("2026/1/1,..."), names are replaced by our own labels.
  let text = '';
  try {
    text = toString(res.body);
  } catch {
    const raw = res.body || [];
    for (let i = 0; i < raw.length; i++) text += String.fromCharCode(raw[i] & 0xff);
  }
  const lines = text.split(/\r?\n/);
  const official = {};
  for (const line of lines) {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),/.exec(line);
    if (!m) continue;
    official[ymd(Number(m[1]), Number(m[2]), Number(m[3]))] = true;
  }
  const years = {};
  for (const d of Object.keys(official)) years[d.slice(0, 4)] = true;
  const col = app.findCollectionByNameOrId('office_calendars');
  let added = 0;
  let removed = 0;
  for (const yStr of Object.keys(years)) {
    const y = Number(yStr);
    if (y < new Date().getFullYear() - 1) continue;
    ensureCalendar(app, 'JP', y);
    const rows = app.findRecordsByFilter(
      'office_calendars',
      'office = "JP" && date >= {:a} && date <= {:b}',
      '',
      0,
      0,
      { a: y + '-01-01 00:00:00.000Z', b: y + '-12-31 23:59:59.999Z' },
    );
    const have = {};
    for (const r of rows) {
      const d = r.getString('date').slice(0, 10);
      have[d] = r;
      const isYearEnd = /-12-(29|30|31)$/.test(d) || /-01-0[23]$/.test(d);
      if (!official[d] && !isYearEnd && r.getString('source') === 'computed') {
        app.delete(r);
        removed += 1;
      } else if (official[d] && r.getString('source') === 'computed') {
        r.set('source', 'official');
        app.save(r);
      }
    }
    for (const d of Object.keys(official)) {
      if (d.slice(0, 4) !== yStr || have[d]) continue;
      const rec = new Record(col);
      rec.set('office', 'JP');
      rec.set('date', d + ' 00:00:00.000Z');
      rec.set('name', 'National holiday');
      rec.set('source', 'official');
      rec.set('working_day', false);
      app.save(rec);
      added += 1;
    }
  }
  return { added: added, removed: removed, years: Object.keys(years).length };
}

module.exports = {
  easter: easter,
  usHolidays: usHolidays,
  epHolidays: epHolidays,
  emHolidays: emHolidays,
  jpHolidays: jpHolidays,
  woHolidays: woHolidays,
  supported: supported,
  ensureCalendar: ensureCalendar,
  closures: closures,
  hasYear: hasYear,
  rollForward: rollForward,
  addBusinessDays: addBusinessDays,
  businessDaysBetween: businessDaysBetween,
  officeName: officeName,
  officeNameJa: officeNameJa,
  refreshJapanOfficial: refreshJapanOfficial,
};
